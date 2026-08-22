// LE GATE DE L HORIZON DE RESERVATION (2026-08-22).
//
// CE QUI A ETE MESURE EN PRODUCTION le 2026-08-22 : le champ date du tunnel
// portait un `min` (aujourd hui) mais AUCUN `max`. Une reservation au
// 15/07/2028 etait acceptee, et /api/public-availability rendait de vrais
// creneaux pour cette date. Or la table des conges scolaires, seule source de
// verite du projet, s arrete au 22/08/2027 : au-dela, plus aucune vacance
// n existe pour le systeme, les horaires de vacances ne s appliquent jamais et
// les formules « noHolidays » ne sont jamais bloquees. Le moteur repondait donc
// avec une confiance qu il n avait pas.
//
// CE QUI EST MESURE ICI :
//   [1] le verdict de bookingDateOutOfRange sur les bornes exactes ;
//   [2] le VRAI handler POST /api/public-reservations refuse une date hors
//       horizon, avant toute lecture de base ;
//   [3] contre-epreuve : sans la garde, le handler va plus loin et le refus
//       change de nature.
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/booking-horizon-check.js

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_PATH = path.join(ROOT, 'api', 'public-reservations.js');
const HANDLER_SRC = fs.readFileSync(HANDLER_PATH, 'utf8');

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}
function section(title) { console.log(`\n${title}`); }

// pg est remplace AVANT tout require du depot : la garde d horizon tombe avant
// le moindre acces base, mais le module database ouvre un Pool a l import.
const PG_PATH = require.resolve('pg');
require.cache[PG_PATH] = {
  id: PG_PATH,
  filename: PG_PATH,
  loaded: true,
  exports: {
    Pool: function FakePool() {
      return { query: async () => { throw new Error('la base ne doit pas etre touchee pour une date hors horizon'); }, end: async () => {} };
    },
  },
};

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
  const out = { statusCode: 200, body: null, headers: {} };
  return {
    out,
    setHeader(key, value) { out.headers[key] = value; },
    get statusCode() { return out.statusCode; },
    set statusCode(value) { out.statusCode = value; },
    end(payload) { if (payload != null && out.body == null) out.body = payload; },
    json(payload) { out.body = JSON.stringify(payload); },
  };
}

let ipCounter = 0;
async function postReservation(body) {
  purgeRepoModules();
  const handler = require(HANDLER_PATH);
  ipCounter += 1;
  const ip = `10.9.0.${ipCounter}`;
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = 'POST';
  req.url = '/api/public-reservations';
  req.headers = { host: 'gate.local', 'content-type': 'application/json', 'x-forwarded-for': ip };
  req.socket = { remoteAddress: ip };
  const res = fakeRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.out.body); } catch (error) { json = null; }
  return { status: res.out.statusCode, json };
}

function shift(todayStr, days) {
  const [y, m, d] = todayStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function body(date) {
  return {
    centerId: 'libramont', type: 'bowling', date, startTime: '14:00', pax: 4, duration: 1,
    name: 'Gate Horizon', email: 'gate@example.com', phone: '0470000000', lanes: [1],
  };
}

(async () => {
  let failed = 0;
  try {
    purgeRepoModules();
    const cfg = require(path.join(ROOT, 'lib', 'booking-config.js'));
    const today = cfg.todayStr();
    const H = cfg.BOOKING_HORIZON_DAYS;

    section(`[1] Le verdict sur les bornes exactes (horizon ${H} jours, aujourd hui ${today})`);
    record('une date d hier est refusee', cfg.bookingDateOutOfRange(shift(today, -1)) === 'past', cfg.bookingDateOutOfRange(shift(today, -1)));
    record('aujourd hui est accepte', cfg.bookingDateOutOfRange(today) === '', cfg.bookingDateOutOfRange(today) || 'ok');
    record('la derniere date de l horizon est acceptee', cfg.bookingDateOutOfRange(shift(today, H)) === '', cfg.bookingDateOutOfRange(shift(today, H)) || 'ok');
    record('le lendemain de l horizon est refuse', cfg.bookingDateOutOfRange(shift(today, H + 1)) === 'far', cfg.bookingDateOutOfRange(shift(today, H + 1)));
    record('une date illisible est refusee', cfg.bookingDateOutOfRange('pas-une-date') === 'invalid', cfg.bookingDateOutOfRange('pas-une-date'));

    section('[2] Le VRAI handler refuse, sans toucher la base');
    {
      const far = await postReservation(body(shift(today, H + 40)));
      record('une date hors horizon est refusee', far.status === 422, `status=${far.status}`);
      record(
        'le refus explique la limite au client',
        !!(far.json && /jusqu/i.test(String(far.json.message || '')) && String(far.json.message).includes(String(H))),
        (far.json && far.json.message) || '(aucun message)',
      );
      const past = await postReservation(body(shift(today, -3)));
      record('une date passee est refusee', past.status === 422, `status=${past.status}`);
      record(
        'le refus du passe le dit clairement',
        !!(past.json && /pass/i.test(String(past.json.message || ''))),
        (past.json && past.json.message) || '(aucun message)',
      );
    }

    section('[3] CONTRE-EPREUVE : sans la garde, la date lointaine passe la porte');
    {
      const anchor = "    const dateVerdict = bookingDateOutOfRange(body && body.date);";
      const occurrences = HANDLER_SRC.split(anchor).length - 1;
      if (occurrences !== 1) throw new Error(`ancre de mutation introuvable ou ambigue (${occurrences})`);
      try {
        fs.writeFileSync(HANDLER_PATH, HANDLER_SRC.replace(anchor, "    const dateVerdict = '';"));
        const broken = await postReservation(body(shift(today, H + 40)));
        record(
          'sans la garde : la date lointaine n est plus refusee pour cette raison, ce gate ROUGIRAIT',
          !(broken.status === 422 && broken.json && String(broken.json.message || '').includes(String(H))),
          `status=${broken.status} message=${(broken.json && broken.json.message) || ''}`,
        );
      } finally {
        fs.writeFileSync(HANDLER_PATH, HANDLER_SRC); // ECRITURE INVERSE exacte
        purgeRepoModules();
      }
      record('api/public-reservations.js est restaure a l identique', fs.readFileSync(HANDLER_PATH, 'utf8') === HANDLER_SRC);
    }
  } catch (error) {
    console.error('\nERREUR DU GATE:', error && (error.stack || error.message || error));
    failed = 1;
  }

  const red = checks.filter(c => !c.ok).length;
  console.log(`\n${red || failed ? 'ECHEC' : 'ALL OK'} : ${checks.length - red}/${checks.length} verifications`);
  process.exit(red || failed ? 1 : 0);
})();

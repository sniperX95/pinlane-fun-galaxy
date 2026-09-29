// LE GATE DU STATUT PUBLIC D UN CENTRE (2026-08-22).
//
// CE QUI A ETE MESURE EN PRODUCTION le 2026-08-22 : le statut d un centre
// (active | planned | closed) etait stocke, valide a l ecriture et affiche dans
// la console (« Prevu », « Actif »), mais AUCUNE surface publique ne le lisait.
//
//   /reserver/ciney, centre « en preparation », servait un tunnel COMPLET :
//   le nom du centre, les 14 formules du catalogue, leurs prix, la grille
//   bowling, des horaires « 10h - 22h », et des cartes affichees comme
//   reservables. Chaque essai finissait sur « Aucune combinaison disponible ce
//   jour-la. Essayez une autre date. » On invitait donc un visiteur a reessayer
//   indefiniment pour un centre qui n existe pas encore.
//
// CE QUE CE GATE VERROUILLE : un centre qui n est pas ouvert refuse l ecriture
// et DIT pourquoi en lecture. Un centre actif, lui, n est pas touche : c est la
// contre-mesure qui empeche de « corriger » en fermant tout le monde.
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/center-status-public-check.js

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_PATH = path.join(ROOT, 'api', 'public-reservations.js');
// La porte du statut du centre vit dans lib/demande-publique.js (partagee avec
// le blocage des horaires, 2026-09-29) : c est elle que la contre-epreuve casse.
const PORTE_PATH = path.join(ROOT, 'lib', 'demande-publique.js');
const PORTE_SRC = fs.readFileSync(PORTE_PATH, 'utf8');

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}
function section(title) { console.log(`\n${title}`); }

// La garde tombe avant tout acces base : un pool qui explose au premier appel
// PROUVE que rien n a ete lu quand le centre est refuse.
const PG_PATH = require.resolve('pg');
require.cache[PG_PATH] = {
  id: PG_PATH,
  filename: PG_PATH,
  loaded: true,
  exports: {
    Pool: function FakePool() {
      return { query: async () => { throw new Error('base injoignable (attendu pour ce gate)'); }, end: async () => {} };
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
  const ip = `10.7.0.${ipCounter}`;
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = 'POST';
  req.url = '/api/public-reservations';
  req.headers = { host: 'gate.local', 'content-type': 'application/json', 'x-forwarded-for': ip };
  req.socket = { remoteAddress: ip };
  const res = fakeRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.out.body); } catch (error) { json = null; }
  return { status: res.out.statusCode, message: (json && json.message) || '' };
}

function bodyFor(centerId, date) {
  return {
    centerId, type: 'bowling', date, startTime: '14:00', pax: 4, duration: 1,
    name: 'Gate Statut', email: 'gate@example.com', phone: '0470000000', lanes: [1],
  };
}

(async () => {
  let failed = 0;
  try {
    purgeRepoModules();
    const cfg = require(path.join(ROOT, 'lib', 'booking-config.js'));
    const ops = require(path.join(ROOT, 'lib', 'ops-knowledge.js'));
    const today = cfg.todayStr();
    const [y, m, d] = today.split('-').map(Number);
    const soon = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);

    // Le socle fichier porte ciney en « planned » et libramont en « active » :
    // ce gate n invente aucune donnee, il lit celle du depot.
    section('[1] Le verdict, centre par centre, tel que le socle les declare');
    record('un centre en preparation est refuse', /pas encore/i.test(ops.publicBookingBlockReason('ciney')), ops.publicBookingBlockReason('ciney') || '(vide)');
    record('un centre actif passe', ops.publicBookingBlockReason('libramont') === '', ops.publicBookingBlockReason('libramont') || 'ok');
    record('un centre inconnu ne bloque rien (fail-soft)', ops.publicBookingBlockReason('centre-qui-n-existe-pas') === '', ops.publicBookingBlockReason('centre-qui-n-existe-pas') || 'ok');

    section('[2] Le VRAI handler refuse le centre pas encore ouvert, sans toucher la base');
    {
      const planned = await postReservation(bodyFor('ciney', soon));
      record('l ecriture est refusee', planned.status === 422, `status=${planned.status}`);
      record('le refus dit que le centre n ouvre pas encore', /pas encore/i.test(planned.message), planned.message || '(aucun message)');

      // LA CONTRE-MESURE : le meme corps sur un centre ACTIF ne se fait pas
      // refuser pour cette raison la. Il echoue plus loin (pas de base dans ce
      // gate), et c est exactement ce qui prouve que la garde est ciblee.
      const active = await postReservation(bodyFor('libramont', soon));
      record(
        'un centre ACTIF n est pas refuse pour cette raison',
        !/pas encore|ne prend plus/i.test(active.message),
        `status=${active.status} message=${active.message || '(vide)'}`,
      );
    }

    section('[3] CONTRE-EPREUVE : sans la garde, le centre en preparation encaisse');
    {
      const anchor = '  const centerBlock = publicBookingBlockReason(requestedCenterId);';
      const occurrences = PORTE_SRC.split(anchor).length - 1;
      if (occurrences !== 1) throw new Error(`ancre de mutation introuvable ou ambigue (${occurrences})`);
      try {
        fs.writeFileSync(PORTE_PATH, PORTE_SRC.replace(anchor, "  const centerBlock = '';"));
        const broken = await postReservation(bodyFor('ciney', soon));
        record(
          'sans la garde : le refus « pas encore ouvert » disparait, ce gate ROUGIRAIT',
          !/pas encore/i.test(broken.message),
          `status=${broken.status} message=${broken.message || '(vide)'}`,
        );
      } finally {
        fs.writeFileSync(PORTE_PATH, PORTE_SRC); // ECRITURE INVERSE exacte
        purgeRepoModules();
      }
      record('lib/demande-publique.js est restaure a l identique', fs.readFileSync(PORTE_PATH, 'utf8') === PORTE_SRC);
    }
  } catch (error) {
    console.error('\nERREUR DU GATE:', error && (error.stack || error.message || error));
    failed = 1;
  }

  const red = checks.filter(c => !c.ok).length;
  console.log(`\n${red || failed ? 'ECHEC' : 'ALL OK'} : ${checks.length - red}/${checks.length} verifications`);
  process.exit(red || failed ? 1 : 0);
})();

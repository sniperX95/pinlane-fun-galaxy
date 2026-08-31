// UNE INSTALLATION COMPTEE NE SE VEND PAS DEUX FOIS.
//
// Le catalogue distingue deux familles d activites (lib/activity-catalog.js) :
// les PLANIFIEES (bowling, laser) qui occupent une ressource comptee, et les
// LIBRES que "le centre absorbe". Cette frontiere est juste pour un minigolf ou
// une plaine de jeux : rien ne s y epuise.
//
// Elle est FAUSSE des qu une activite libre declare une DOTATION FINIE. Mesure
// du 2026-08-31 sur la donnee de PROD de Fun Galaxy Libramont :
//
//   duckpin_bowling : planned=false, resourceType=duckpin_lane,
//                     units=2, capacityPerUnit=6, unitIds=["9","10"]
//
// Deux pistes physiques, nommees. Le moteur ne les comptait jamais : six
// groupes de 12 personnes reservaient le meme creneau de 15:00, six fois
// HTTP 201, 12 pistes vendues pour 2 qui existent, et le bloc pose etant
// `soft_capacity`, le planning du samedi n en montrait AUCUNE. Le comptoir
// decouvrait les groupes en trop a leur arrivee. Toutes les autres activites
// libres de ce centre ont units=null : elles restent absorbables, et ce gate
// verifie AUSSI qu on ne les a pas bridees par exces de zele.
//
// Trois proprietes de comportement, sur les vrais handlers HTTP :
//   A. TEMOIN : le bowling refuse au-dela de ses pistes (la borne existe la ou
//      le moteur connait la ressource).
//   B. SUJET : une activite a dotation finie refuse au-dela de sa dotation.
//   C. NON-REGRESSION : une activite SANS dotation (units=null) n est pas
//      bridee, la doctrine "le centre absorbe" reste vraie.
//
// Puis une CONTRE-EPREUVE par mutation : on neutralise la garde, on prouve que
// le gate rougit, on restaure par edition inverse.
//
// Lancement : node scripts/finite-endowment-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OPS = path.join(ROOT, 'lib/reservation-ops.js');
const PORT = Number(process.env.PINLANE_ENDOWMENT_PORT || 4493);
const BASE = `http://127.0.0.1:${PORT}`;

function mock(rel, exports) {
  const resolu = require.resolve(path.join(ROOT, rel));
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
// Le limiteur garde un etat par IP : ce gate tire des rafales, ce n est pas lui
// qu on teste, et un autre gate le couvre.
mock('lib/rate-limit', {
  enforceRateLimit: () => false,
  checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  getClientIp: () => 'gate',
});

const database = require(path.join(ROOT, 'lib/database'));

// La base est remplacee par une liste en memoire, mais les HANDLERS sont les
// vrais : c est le chemin de decision qu on mesure, pas le stockage.
const STORE = [];
let nextId = 1;
database.readStaffState = async (date, centerId = 'libramont') => ({
  date, centerId, laneStatuses: {}, blocks: [],
  reservations: STORE.filter((r) => r.date === date && (r.centerId || 'libramont') === centerId),
});
database.readAvailabilitySnapshot = database.readStaffState;
database.createOpsEvent = async () => ({});
database.createReservation = async (payload) => {
  const row = { ...payload, id: nextId += 1 };
  STORE.push(row);
  return row;
};
const rops = require(path.join(ROOT, 'lib/reservation-ops'));
rops.afterReservationCreated = async () => ({ communications: [], warnings: [] });

const availability = require(path.join(ROOT, 'api/public-availability.js'));
const reservationsApi = require(path.join(ROOT, 'api/public-reservations.js'));
const { listCenterActivities } = require(path.join(ROOT, 'lib/activity-catalog'));

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, BASE);
      if (url.pathname === '/api/public-availability') return void await availability(req, res);
      if (url.pathname === '/api/public-reservations') return void await reservationsApi(req, res);
      res.writeHead(404);
      res.end('non');
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }));
    }
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

function post(payload) {
  const data = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/public-reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': data.length },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (error) { resolve({ status: res.statusCode, body: { brut: body.slice(0, 200) } }); }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

// Un samedi STRICTEMENT futur : le meme jour, la borne "depart passe" du moteur
// raboterait la journee et fausserait les comptes.
function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();
const CENTRE = 'libramont';
const HEURE = '15:00';

function corps(activityId, pax, index) {
  return {
    name: `Groupe ${index}`,
    phone: '+32470000000',
    email: `groupe${index}@exemple.be`,
    date: DATE,
    startTime: HEURE,
    duration: 1,
    totalDuration: 1,
    pax,
    type: 'visite',
    program: [{ activityId, duration: 1 }],
    centerId: CENTRE,
    channel: 'public',
  };
}

// Combien de dossiers le serveur accepte-t-il d affilee sur la meme heure ?
async function combienPassent(activityId, pax, plafondEssais) {
  STORE.length = 0;
  let acceptes = 0;
  let premierRefus = '';
  for (let i = 1; i <= plafondEssais; i += 1) {
    const r = await post(corps(activityId, pax, i));
    if (r.status >= 200 && r.status < 300) acceptes += 1;
    else { premierRefus = `${i}e refuse (${r.status}) ${String((r.body || {}).message || '').slice(0, 60)}`; break; }
  }
  return { acceptes, premierRefus };
}

async function main() {
  const server = await serve();
  try {
    console.log(`[date] samedi de reference : ${DATE}`);
    const catalogue = listCenterActivities(CENTRE);
    const parId = new Map(catalogue.map((a) => [a.id, a]));

    // --- A. TEMOIN : la borne existe la ou le moteur connait la ressource ----
    // 12 joueurs = 2 pistes par dossier, 8 pistes au centre : le 5e doit tomber.
    const temoin = await combienPassent('bowling', 12, 7);
    ok(temoin.acceptes === 4 && Boolean(temoin.premierRefus),
      `temoin bowling : 4 dossiers de 2 pistes passent sur 8 pistes, le 5e est refuse (${temoin.acceptes} passes, ${temoin.premierRefus || 'AUCUN REFUS'})`);

    // --- B. SUJET : une dotation finie doit se compter ----------------------
    const finies = catalogue.filter((a) => !a.planned && Number(a.units) > 0);
    ok(finies.length > 0, `au moins une activite libre declare une dotation finie (${finies.map((a) => `${a.id}:${a.units}`).join(', ') || 'aucune'})`);
    for (const activite of finies) {
      const parUnite = Math.max(1, Number(activite.capacityPerUnit) || 1);
      const pax = parUnite * Number(activite.units); // un groupe qui prend TOUTE la dotation
      const essai = await combienPassent(activite.id, pax, 6);
      ok(essai.acceptes === 1 && Boolean(essai.premierRefus),
        `${activite.id} (dotation ${activite.units}) : un groupe de ${pax} prend tout, le suivant est refuse (${essai.acceptes} passes, ${essai.premierRefus || 'AUCUN REFUS SUR 6'})`);
      // Et deux demi-groupes tiennent, eux : la borne compte des UNITES, pas des dossiers.
      const moitie = await combienPassent(activite.id, parUnite, 6);
      ok(moitie.acceptes === Number(activite.units),
        `${activite.id} : ${activite.units} groupes d une unite tiennent ensemble (${moitie.acceptes} passes, attendu ${activite.units})`);
    }

    // --- C. NON-REGRESSION : sans dotation, le centre absorbe ---------------
    const absorbables = catalogue.filter((a) => !a.planned && !(Number(a.units) > 0));
    ok(absorbables.length > 0, `des activites restent absorbables (${absorbables.map((a) => a.id).join(', ')})`);
    for (const activite of absorbables.slice(0, 3)) {
      const essai = await combienPassent(activite.id, 4, 5);
      ok(essai.acceptes === 5,
        `${activite.id} sans dotation n est pas bridee (${essai.acceptes} dossiers sur 5${essai.premierRefus ? ` - ${essai.premierRefus}` : ''})`);
    }
  } finally {
    server.close();
  }

  if (failures) {
    console.error(`\nfinite-endowment-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nfinite-endowment-check: ALL OK (dotation finie comptee, activites absorbables intactes)');
}

// Contre-epreuve : `--mutate` neutralise la garde, relance le gate et attend un
// ECHEC, puis restaure a l identique.
if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(OPS, 'utf8');
  const marqueur = 'const manque = dotationDepassee(';
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : la garde attendue est introuvable dans lib/reservation-ops.js');
    process.exit(1);
  }
  const mute = source.replace(marqueur, 'const manque = false && dotationDepassee(');
  fs.writeFileSync(OPS, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(OPS, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert sans la garde.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : sans la garde, le gate rougit ; moteur restaure a l identique.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

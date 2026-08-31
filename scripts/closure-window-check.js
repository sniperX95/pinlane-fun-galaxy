// UNE FERMETURE PONCTUELLE ARRETE CE QUI LA TRAVERSE, PAS SEULEMENT CE QUI Y
// COMMENCE.
//
// Le centre privatise sa soiree depuis la console : blocage de portee "centre",
// samedi, de 18:00 a 24:00. Mesure du 2026-08-31 : le tunnel proposait toujours
// un bowling de deux heures a 17:00, la reservation partait en HTTP 201, piste
// attribuee, et elle occupait la piste jusqu a 19:00 - une heure pleine DANS la
// soiree privatisee. Le comptoir se retrouvait avec deux groupes sur la meme
// piste.
//
// La cause est une seule fonction : isCenterClosedAt ne prenait qu une MINUTE,
// celle du depart. Ses trois appelants (la garde d ecriture et les deux
// generateurs de creneaux) calculaient pourtant deja la fin de la fenetre et la
// jetaient. Les blocages de PISTE et d ACTIVITE, eux, testaient bien la fenetre
// entiere depuis toujours (blockCoversWindow) : c est la portee "centre", la
// plus large, qui etait la plus permissive.
//
// Trois proprietes de comportement, sur les vrais handlers HTTP :
//   A. UNE VISITE QUI TRAVERSE la fermeture est refusee.
//   B. UNE VISITE QUI FINIT PILE au debut de la fermeture est ACCEPTEE. C est
//      la regle du proprietaire ("les activites qui finissent a la fermeture
//      pile doivent passer"), et le chevauchement demi-ouvert la preserve.
//   C. SANS BLOCAGE, rien ne change : la journee entiere reste vendable.
//
// Puis une CONTRE-EPREUVE par mutation : on remet le test sur la seule minute
// de depart, on prouve que le gate rougit, on restaure par edition inverse.
//
// Lancement : node scripts/closure-window-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BLOCKS = path.join(ROOT, 'lib/availability-blocks.js');
const PORT = Number(process.env.PINLANE_CLOSURE_PORT || 4497);
const BASE = `http://127.0.0.1:${PORT}`;

function mock(rel, exports) {
  const resolu = require.resolve(path.join(ROOT, rel));
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
mock('lib/rate-limit', {
  enforceRateLimit: () => false,
  checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  getClientIp: () => 'gate',
});

const database = require(path.join(ROOT, 'lib/database'));

let BLOCAGES = [];
const STORE = [];
let nextId = 1;
database.readStaffState = async (date, centerId = 'libramont') => ({
  date, centerId, laneStatuses: {}, blocks: BLOCAGES,
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
        catch (error) { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function get(chemin) {
  return new Promise((resolve, reject) => {
    http.get(BASE + chemin, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (error) { resolve({ status: res.statusCode, body: {} }); }
      });
    }).on('error', reject);
  });
}

function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();
const CENTRE = 'libramont';

// La soiree privatisee : blocage de portee centre, 18:00 -> 24:00.
const SOIREE_PRIVEE = [{
  id: 1, centerId: CENTRE, date: DATE, scopeType: 'center', scopeRef: null,
  startMin: 18 * 60, endMin: 24 * 60, recurrence: 'none', reason: 'Soiree privatisee',
}];

function corps(heure, dureeHeures, index) {
  return {
    name: `Groupe ${index}`,
    phone: '+32470000000',
    email: `g${index}@exemple.be`,
    date: DATE,
    startTime: heure,
    duration: dureeHeures,
    totalDuration: dureeHeures,
    pax: 6,
    type: 'bowling',
    centerId: CENTRE,
    channel: 'public',
  };
}

async function main() {
  const server = await serve();
  try {
    console.log(`[date] samedi de reference : ${DATE} | fermeture ponctuelle 18:00-24:00`);

    BLOCAGES = SOIREE_PRIVEE;

    // --- A. LA GARDE D ECRITURE, appelee directement -----------------------
    // Le double de base court-circuite createReservation : passer par HTTP ne
    // mesurerait ici que le double. On appelle donc la garde reelle, celle qui
    // tourne dans la transaction verrouillee du vrai serveur.
    const garde = (heure, heures) => {
      try {
        database.validateReservationResources(
          { ...corps(heure, heures, 0), lanes: [], laneCount: 1, opsPlan: null },
          [], {}, SOIREE_PRIVEE, DATE,
        );
        return 'acceptee';
      } catch (error) {
        return `refusee : ${String(error.message).slice(0, 50)}`;
      }
    };
    const traverse = garde('17:00', 2); // 17:00 -> 19:00
    ok(traverse.startsWith('refusee'),
      `garde d ecriture : un bowling de 2 h a 17:00 (fin 19:00) traverse la soiree privatisee (${traverse})`);
    const dedans = garde('19:00', 1);
    ok(dedans.startsWith('refusee'),
      `garde d ecriture : un bowling a 19:00 est entierement dans la fermeture (${dedans})`);

    // --- B. Ce qui FINIT PILE au debut de la fermeture passe ---------------
    const pile = garde('16:00', 2); // 16:00 -> 18:00
    ok(pile === 'acceptee',
      `garde d ecriture : un bowling de 2 h a 16:00 finit PILE a 18:00 et doit passer (${pile})`);

    // --- ... et la liste des creneaux dit la meme chose ---------------------
    STORE.length = 0;
    const params = new URLSearchParams({ date: DATE, type: 'bowling', pax: '6', duration: '2', centerId: CENTRE });
    const grille = await get('/api/public-availability?' + params.toString());
    const heures = ((grille.body && grille.body.slots) || []).map((s) => String(s.time).slice(0, 5));
    const traversantes = heures.filter((h) => {
      const debut = Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
      return debut + 120 > 18 * 60 && debut < 24 * 60;
    });
    ok(traversantes.length === 0,
      `aucune heure proposee ne traverse la fermeture (${traversantes.length ? traversantes.join(', ') : 'aucune'})`);
    ok(heures.includes('16:00'),
      `16:00 reste propose : il finit pile a la fermeture (${heures.length} heures offertes)`);

    // --- C. Sans blocage, la journee entiere reste vendable ----------------
    BLOCAGES = [];
    STORE.length = 0;
    let libre = 'refusee';
    try {
      database.validateReservationResources({ ...corps('19:00', 1, 4), lanes: [], laneCount: 1, opsPlan: null }, [], {}, [], DATE);
      libre = 'acceptee';
    } catch (error) { libre = `refusee : ${error.message.slice(0, 40)}`; }
    ok(libre === 'acceptee', `sans blocage, 19:00 passe la garde d ecriture (${libre})`);
    const grilleLibre = await get('/api/public-availability?' + params.toString());
    const heuresLibres = ((grilleLibre.body && grilleLibre.body.slots) || []).length;
    ok(heuresLibres > heures.length,
      `sans blocage la grille est plus large (${heuresLibres} heures contre ${heures.length} avec la soiree privatisee)`);
  } finally {
    server.close();
  }

  if (failures) {
    console.error(`\nclosure-window-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nclosure-window-check: ALL OK (la fermeture arrete ce qui la traverse, laisse passer ce qui finit pile)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(BLOCKS, 'utf8');
  const marqueur = 'function isCenterClosedDuring(blocks, dateISO, startMin, endMin) {';
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : isCenterClosedDuring est introuvable dans lib/availability-blocks.js');
    process.exit(1);
  }
  // On remet le comportement d avant : seule la minute de depart compte.
  // Remplacement cible dans le corps de isCenterClosedDuring, tolerant aux
  // fins de ligne du fichier (CRLF ici).
  const debut = source.indexOf(marqueur);
  const fin = source.indexOf('}', source.indexOf('blockCoversWindow', debut));
  const corps = source.slice(debut, fin);
  if (!corps.includes('blockCoversWindow(block, startMin, endMin)')) {
    console.error('mutation impossible : le corps attendu de isCenterClosedDuring a change.');
    process.exit(1);
  }
  const mute = source.slice(0, debut)
    + corps.replace('blockCoversWindow(block, startMin, endMin)', 'blockCoversMinute(block, startMin)')
    + source.slice(fin);
  fs.writeFileSync(BLOCKS, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(BLOCKS, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert avec le test sur la seule minute de depart.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : revenu a la minute de depart, le gate rougit ; module restaure a l identique.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

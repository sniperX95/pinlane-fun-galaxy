// LE GATE DU DEUXIEME CLIENT (2026-08-08).
//
// LA QUESTION POSEE, la seule qui compte pour Movsar : peut-on signer un
// deuxieme client aujourd'hui ? Autrement dit, un centre monte DEPUIS LA
// CONSOLE (jamais par un commit dans ops-knowledge/centers.json) peut-il :
//   [1] exister aux yeux du moteur ;
//   [2] servir SON catalogue et SES horaires sur son tunnel public ;
//   [3] prendre une reservation ;
//   [4] la montrer a SON staff ;
//   [5] envoyer un mail signe de SON identite ;
//   [6] porter SES couleurs, pas celles de Fun Galaxy ;
//   [7] etre selectionne par la ligne d'installation (?center=), prouve dans un
//       vrai navigateur.
//
// LES QUATRE BLOCAGES QU'IL VERROUILLE (tous mesures reels le 2026-08-08) :
//   A. getCenter() ne connaissait que le FICHIER. rebuildMergedCenters ne
//      faisait que fusionner des overrides PAR-DESSUS les trois centres du
//      fichier : un centre cree en console levait « Centre inconnu », donc
//      createReservation refusait tout, et public-availability avalait
//      l'erreur pour retomber sur l'horaire ET le catalogue de Fun Galaxy.
//   B. embed.js posait ?center=<slug> et PERSONNE ne lisait ce parametre ;
//      l'API attend centerId et retombe sur 'libramont'.
//   C. assets/pinlane-client.css posait le magenta Fun Galaxy en dur.
//   D. anniversaire / reactivation / sequences personnalisees partaient sans
//      identite d'expediteur du centre (repli plateforme « Fun Galaxy »).
//
// HONNETETE DU GATE : chaque etape exerce le VRAI code (handlers d'API, moteur,
// sweeps), jamais une reformulation. Le contraste avec Fun Galaxy est verifie a
// chaque fois qu'il a un sens : un test qui ne prouve que « ca repond » ne
// prouve pas que ca repond POUR LE BON CENTRE. Une contre-preuve par mutation
// termine le gate.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif. La base de production n'est jamais touchee.
// Lancement : node scripts/second-client-onboarding-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-second-client-secret-2026';
process.env.STAFF_DIRECTION_CODE = 'GATE-DIRECTION-2026-AAAA';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-2026-BBBB';

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_SECOND_CLIENT_PORT || 4219);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// Un samedi A VENIR (jamais aujourd'hui : les creneaux deja passes sont filtres,
// ce qui rendrait le gate dependant de l'heure a laquelle il tourne).
// Fun Galaxy Libramont ouvre 10h-Minuit ce jour-la ; le deuxieme client declare
// 11h-19h. Deux grilles differentes : c'est ce qui rend le contraste lisible au
// lieu d'etre une coincidence.
// La constante figee ne tenait pas la promesse de son propre commentaire : le
// 2026-08-15 etait « a venir » le jour ou ce gate a ete ecrit, et devenait le
// jour meme une semaine plus tard, puis une date passee. C'est exactement le
// defaut qui a rendu visit-booking-check rouge tout un apres-midi. On CALCULE
// donc le prochain samedi, qui est toujours devant nous.
function nextSaturday() {
  // Le produit raisonne en heure de Bruxelles : c'est ce fuseau qui decide du jour.
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  // do/while : on avance d'au moins un jour, donc jamais aujourd'hui meme un samedi.
  do { cursor.setUTCDate(cursor.getUTCDate() + 1); } while (cursor.getUTCDay() !== 6);
  return cursor.toISOString().slice(0, 10);
}
const DATE = nextSaturday();

let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}
function section(title) { console.log(`\n${title}`); }

function hashSecret(value) {
  return crypto
    .createHash('sha256')
    .update(`${process.env.STAFF_AUTH_SECRET}:${String(value || '').trim()}`)
    .digest('hex');
}

// ── L'UNIVERS : deux clients Pinlane ────────────────────────────────────────
// Fun Galaxy est deja la (ses centres sont dans le FICHIER). Strike Namur est
// le deuxieme client : il n'existe QUE dans les tables, monte par la console.
const SECOND_CLIENT_ID = 'strike-namur-sarl';
const SECOND_CENTER_ID = 'strike-namur';
const SECOND_CENTER_NAME = 'Strike Namur';
const SECOND_SENDER_EMAIL = 'reservations@strike-namur.be';
const SECOND_SENDER_LABEL = 'Strike Namur';
// La SEULE couleur que Movsar tape dans le formulaire. Tout le reste (variante
// sombre, tons derives) est produit par la console : ce gate ne l'ecrit nulle
// part, il le RECOIT de l'ecran et le suit jusqu'au tunnel.
const SECOND_ACCENT = '#1f6f43';
// Une couleur qu'un gerant peut tres bien choisir et qui ne se lit pas : elle
// sert a prouver que l'ecran AVERTIT sans jamais bloquer la saisie.
const UNREADABLE_ACCENT = '#ffe600';
// Ce que la console a reellement produit et envoye (rempli a l'etape [1]).
let consoleBranding = null;

// Table `clients`.
const clientRows = [
  { id: 'fungalaxy', name: 'Fun Galaxy', status: 'active', plan: 'standard' },
];
// Table `centers`. Les trois Fun Galaxy sont la PROJECTION des centres fichier.
const centerRows = [
  { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
];
const reservationRows = [];
const communicationRows = [];
// VIDE au depart, et c'est le coeur du gate : l'identite d'expediteur du
// deuxieme client n'est PAS pre-posee ici. Si elle finit par exister, c'est que
// le formulaire de la console l'a creee. Une ligne semee d'avance rendrait
// l'etape [7] vraie sans que personne n'ait pu la saisir dans un ecran.
const emailIdentityRows = [];
let nextIdentityId = 10;
// Le catalogue vendu par CE centre (table `activities`, ligne de centre). Le
// deuxieme client vend du bowling et du minigolf ; il n'a PAS de laser game.
const activityRows = [
  {
    center_id: SECOND_CENTER_ID, id: 'minigolf_blacklight', name: 'Minigolf Namur', resource_type: 'free_activity',
    duration_model: { defaultMinutes: 45, minMinutes: 45, maxMinutes: 45, stepMinutes: 30 },
    booking: { bookable: true, priceType: 'per_pax', priceValue: 9, unitLabel: 'par personne', order: 3 },
    active: true,
  },
];
let nextReservationId = 5000;
let nextCommunicationId = 900;

const sqlLog = [];

function normalizeSql(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text, params = []) {
    const sql = normalizeSql(text);
    sqlLog.push({ sql, params });

    if (/^(begin|commit|rollback|savepoint|release savepoint|rollback to savepoint)/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/^(create|alter|drop|comment on|insert into schema_migrations)/i.test(sql)) return { rows: [], rowCount: 0 };

    // -- clients ------------------------------------------------------------
    if (/insert into clients/i.test(sql)) {
      const [id, name, status, plan] = params;
      const existing = clientRows.find((row) => row.id === id);
      if (existing) Object.assign(existing, { name, status, plan });
      else clientRows.push({ id, name, status, plan });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (/from clients where id = \$1/i.test(sql)) {
      const row = clientRows.find((item) => item.id === params[0]);
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    // -- centers ------------------------------------------------------------
    if (/insert into centers/i.test(sql)) {
      const [id, name, status, timezone] = params;
      const existing = centerRows.find((row) => row.id === id);
      if (existing) {
        Object.assign(existing, { name, status, timezone });
        return { rows: [{ ...existing }], rowCount: 1 };
      }
      const created = { id, name, status, timezone, settings: null, client_id: null, client_name: null };
      centerRows.push(created);
      return { rows: [{ ...created }], rowCount: 1 };
    }
    if (/update centers set client_id/i.test(sql)) {
      const row = centerRows.find((item) => item.id === params[0]);
      if (row) {
        row.client_id = params[1];
        row.client_name = (clientRows.find((c) => c.id === params[1]) || {}).name || null;
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (/update centers set settings = jsonb_set/i.test(sql)) {
      const row = centerRows.find((item) => item.id === params[0]);
      if (!row) return { rows: [], rowCount: 0 };
      row.settings = { ...(row.settings || {}), config: JSON.parse(params[1]) };
      row.status = params[2];
      return { rows: [], rowCount: 1 };
    }
    if (/select settings from centers where id = \$1/i.test(sql)) {
      const row = centerRows.find((item) => item.id === params[0]);
      return row ? { rows: [{ settings: row.settings }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/from centers\b/i.test(sql)) {
      const wanted = params.map((value) => String(value == null ? '' : value));
      const scoped = /where/i.test(sql) && wanted.length
        ? centerRows.filter((row) => wanted.includes(row.id))
        : centerRows;
      return { rows: scoped.map((row) => ({ ...row })), rowCount: scoped.length };
    }

    // -- staff auth ---------------------------------------------------------
    if (/select id, access_code_hash from staff_members where id = any/i.test(sql)) {
      const ids = Array.isArray(params[0]) ? params[0] : [];
      const rows = ids.map((id) => ({
        id,
        access_code_hash: id.endsWith(':platform-owner')
          ? hashSecret(process.env.PLATFORM_OWNER_CODE)
          : hashSecret(process.env.STAFF_DIRECTION_CODE),
      }));
      return { rows, rowCount: rows.length };
    }
    if (/from staff_sessions s/i.test(sql) && /s\.token_hash = \$1/.test(sql)) {
      const row = SESSION_BY_HASH.get(String(params[0] || ''));
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/insert into staff_roles/i.test(sql)) {
      return { rows: [{ center_id: params[0], id: params[1], name: params[2], code: params[3], permissions: JSON.parse(params[6]), locked: false }], rowCount: 1 };
    }
    if (/from staff_roles/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/insert into staff_access_events|insert into audit_log/i.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };

    // -- catalogue ----------------------------------------------------------
    if (/from activities/i.test(sql)) {
      return { rows: activityRows.map((row) => ({ ...row })), rowCount: activityRows.length };
    }
    if (/from formulas/i.test(sql)) return { rows: [], rowCount: 0 };

    // -- reservations -------------------------------------------------------
    if (/insert into reservations/i.test(sql)) {
      const row = {
        id: (nextReservationId += 1),
        center_id: params[0], channel: params[1], name: params[2], phone: params[3], email: params[4],
        date: params[5], start_time: params[6], duration: params[7], total_duration: params[8],
        lanes: params[9], pax: params[10], status: params[11], base_price: params[12], price: params[13],
        type: params[14], formule_id: params[15], label: params[16], occasion: params[17],
        extras: JSON.parse(params[18] || '[]'), payment_method: params[19], notes: params[20],
        ops_plan: JSON.parse(params[21] || 'null'), risk_level: params[22], risk_score: params[23],
        validation_status: params[24], activity_progress: JSON.parse(params[25] || 'null'),
        program: JSON.parse(params[26] || 'null'),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      reservationRows.push(row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (/from reservations/i.test(sql)) {
      // Le filtre centre n'est applique QUE si le SQL le porte : c'est ce qui
      // permet a une regression de scope de faire rougir ce gate.
      const wantedDate = params[0];
      const wantedCenter = params[1];
      const scoped = reservationRows.filter((row) => {
        if (/date = \$1/.test(sql) && row.date !== wantedDate) return false;
        if (/center_id = \$2/.test(sql) && row.center_id !== wantedCenter) return false;
        if (/center_id = \$1/.test(sql) && row.center_id !== params[0]) return false;
        if (/status <> 'cancelled'/.test(sql) && row.status === 'cancelled') return false;
        return true;
      });
      return { rows: scoped.map((row) => ({ ...row })), rowCount: scoped.length };
    }

    // -- lanes / blocs ------------------------------------------------------
    if (/from lane_statuses/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/from availability_blocks/i.test(sql)) return { rows: [], rowCount: 0 };

    // -- communications -----------------------------------------------------
    if (/insert into communications/i.test(sql)) {
      const row = {
        id: (nextCommunicationId += 1),
        center_id: params[0], reservation_id: params[1], channel: params[2], direction: params[3],
        template_id: params[4], recipient: params[5], subject: params[6], body: params[7],
        status: params[8], scheduled_at: params[9], payload: JSON.parse(params[10] || '{}'),
        idempotency_key: params[11], attempts: 0, max_attempts: 3, priority: 50,
      };
      communicationRows.push(row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (/from communications/i.test(sql)) return { rows: [], rowCount: 0 };

    // -- identites d'expediteur --------------------------------------------
    if (/update email_identities set is_default = false/i.test(sql)) {
      emailIdentityRows.forEach((row) => { if (row.center_id === params[0]) row.is_default = false; });
      return { rows: [], rowCount: 0 };
    }
    if (/insert into email_identities/i.test(sql)) {
      const row = {
        id: (nextIdentityId += 1),
        center_id: params[0], label: params[1], email: params[2], is_default: Boolean(params[3]),
      };
      emailIdentityRows.push(row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (/update email_identities set label/i.test(sql)) {
      const row = emailIdentityRows.find((item) => item.id === Number(params[0]) && item.center_id === params[1]);
      if (!row) return { rows: [], rowCount: 0 };
      Object.assign(row, { label: params[2], email: params[3], is_default: Boolean(params[4]) });
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (/from email_identities/i.test(sql)) {
      // Recherche par adresse (idempotence du provisionnement) ou liste du centre.
      if (/lower\(email\) = \$2/i.test(sql)) {
        const hit = emailIdentityRows.find((row) => row.center_id === params[0] && String(row.email).toLowerCase() === String(params[1]).toLowerCase());
        return hit ? { rows: [{ id: hit.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      const scoped = emailIdentityRows.filter((row) => row.center_id === params[0]);
      scoped.sort((a, b) => (Number(b.is_default) - Number(a.is_default)) || (a.id - b.id));
      return { rows: scoped.map((row) => ({ ...row })), rowCount: scoped.length };
    }

    if (/from center_automation_settings/i.test(sql)) {
      return { rows: [{ settings: { birthday_j30: { enabled: true } } }], rowCount: 1 };
    }
    if (/from marketing_suppressions/i.test(sql)) return { rows: [], rowCount: 0 };

    return { rows: [], rowCount: 0 };
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }

  async end() {}
}

// ── Sessions staff forgees ──────────────────────────────────────────────────
const ALL_PERMISSIONS = [
  'dashboard.view', 'direction.view', 'centers.switch', 'reports.export',
  'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'planning.past',
  'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel',
  'reservations.status', 'reservations.quick',
  'clients.view', 'clients.edit', 'payments.view', 'payments.markPaid', 'exports.download',
  'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents',
  'pricing.manage', 'users.manage', 'settings.manage', 'security.codes', 'ai.ops',
];
const STRIKE_TOKEN = 'fgs_gate_direction_strike';
const FUNGALAXY_TOKEN = 'fgs_gate_direction_fungalaxy';
// Movsar lui-meme : c'est SA session qui execute le formulaire "Nouveau client".
const OWNER_TOKEN = 'fgs_gate_platform_owner';
function sessionRow({ token, centerId, memberId, memberName, permissions = ALL_PERMISSIONS, roleId = 'direction', roleName = 'Direction' }) {
  return {
    token_hash: hashSecret(token),
    center_id: centerId,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    member_id: memberId,
    member_name: memberName,
    contact: '',
    member_status: 'active',
    role_id: roleId,
    role_name: roleName,
    role_code: roleName.slice(0, 2).toUpperCase(),
    permissions,
    locked: true,
  };
}
const SESSION_BY_HASH = new Map([
  [hashSecret(STRIKE_TOKEN), sessionRow({ token: STRIKE_TOKEN, centerId: SECOND_CENTER_ID, memberId: `${SECOND_CENTER_ID}:direction-local`, memberName: 'Direction Strike Namur' })],
  [hashSecret(FUNGALAXY_TOKEN), sessionRow({ token: FUNGALAXY_TOKEN, centerId: 'libramont', memberId: 'libramont:direction-local', memberName: 'Direction Fun Galaxy' })],
  [hashSecret(OWNER_TOKEN), sessionRow({
    token: OWNER_TOKEN,
    centerId: 'libramont',
    memberId: 'libramont:platform-owner',
    memberName: 'Movsar',
    permissions: [...ALL_PERMISSIONS, 'platform.admin'],
    roleId: 'platform-owner',
    roleName: 'Proprietaire',
  })],
]);

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };

// ── Faux req / res ──────────────────────────────────────────────────────────
function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    removeHeader(name) { delete this.headers[String(name).toLowerCase()]; },
    end(payload) { if (payload !== undefined && this.body === null) this.body = payload; this.ended = true; },
    write(chunk) { this.body = (this.body || '') + chunk; },
  };
  return res;
}
// Une VRAIE requete lisible : readJson (lib/http.js) itere le flux. Un objet
// nu ne suffit pas, et un stub de readJson testerait le stub.
function fakeReq({ method = 'GET', url = '/', token = '', body = null } = {}) {
  const headers = { host: '127.0.0.1', 'x-forwarded-for': '203.0.113.7' };
  if (token) headers['x-staff-session'] = token;
  const payload = body === null ? '' : JSON.stringify(body);
  const req = {
    method,
    url,
    headers,
    socket: { remoteAddress: '203.0.113.7' },
    async *[Symbol.asyncIterator]() { if (payload) yield Buffer.from(payload, 'utf8'); },
  };
  return req;
}
function jsonOf(res) {
  try { return JSON.parse(String(res.body || '')); } catch (error) { return null; }
}

// ── Le code applicatif REEL ────────────────────────────────────────────────
// api/ops.js est le SEUL chemin d'ecriture utilise par ce gate pour monter le
// client : plus aucun appel direct a provisionClient / saveCenterConfigOverride.
// Ce que la console poste, ce gate le rejoue tel quel.
const opsHandler = require(path.join(ROOT, 'api', 'ops.js'));
const { getCenter, refreshCenterOverrides } = require(path.join(ROOT, 'lib', 'ops-knowledge.js'));
const { getPool } = require(path.join(ROOT, 'lib', 'database.js'));
const { refreshCatalog } = require(path.join(ROOT, 'lib', 'catalog-store.js'));
const opsCommunications = require(path.join(ROOT, 'lib', 'ops-communications.js'));
const metaHandler = require(path.join(ROOT, 'api', 'public-booking-meta.js'));
const availabilityHandler = require(path.join(ROOT, 'api', 'public-availability.js'));
const reservationsHandler = require(path.join(ROOT, 'api', 'public-reservations.js'));
const staffStateHandler = require(path.join(ROOT, 'api', 'staff-state.js'));

// La config que la direction du deuxieme client saisit dans « Etablissement ».
// Elle sert de POINT DE DEPART a l'ecran dans le navigateur : le gate ne
// l'ecrit plus en base lui-meme, c'est le formulaire qui la renvoie (etape [3]).
// Aucune couleur ici : la marque est saisie au provisionnement, etape [1].
const SECOND_CENTER_CONFIG = {
  status: 'active',
  timezone: 'Europe/Brussels',
  resources: {
    bowling: { laneCount: 12, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, preferAdjacentLanes: true },
    laser: null,
    partyTables: null,
  },
  defaultSchedule: {
    regular: {
      0: { open: '11:00', close: '19:00' },
      1: { open: '11:00', close: '19:00' },
      2: { open: '11:00', close: '19:00' },
      3: { open: '11:00', close: '19:00' },
      4: { open: '11:00', close: '19:00' },
      5: { open: '11:00', close: '19:00' },
      6: { open: '11:00', close: '19:00' },
    },
    holiday: {
      0: { open: '11:00', close: '19:00' },
      1: { open: '11:00', close: '19:00' },
      2: { open: '11:00', close: '19:00' },
      3: { open: '11:00', close: '19:00' },
      4: { open: '11:00', close: '19:00' },
      5: { open: '11:00', close: '19:00' },
      6: { open: '11:00', close: '19:00' },
    },
  },
  // Ce centre ne vend PAS de laser game, et vend un minigolf.
  activityAvailability: { bowling: true, laser_game: false, minigolf_blacklight: true },
};

async function run() {
  const pool = getPool();

  // TOUT ce que ce gate ecrit part de LA CONSOLE. Le navigateur remplit les deux
  // ecrans (Nouveau client, puis Etablissement) et rend les corps de requete
  // EXACTS que les boutons envoient ; le gate les rejoue ensuite dans le vrai
  // handler d'API. Aucun appel a la main, aucune ligne semee d'avance.
  const journey = await captureConsoleJourney();

  section('[1] Le deuxieme client est monte DEPUIS L ECRAN, pas depuis un terminal');
  const fileCenters = require(path.join(ROOT, 'ops-knowledge', 'centers.json')).centers.map((c) => c.id);
  ok(!fileCenters.includes(SECOND_CENTER_ID),
    `le centre ${SECOND_CENTER_ID} n'est PAS dans ops-knowledge/centers.json (fichier: ${fileCenters.join(', ')})`);
  const provisionBody = journey.provisioning && journey.provisioning.body;
  ok(Boolean(provisionBody) && provisionBody.action === 'createClient',
    `le bouton "Enregistrer" du formulaire poste createClient (obtenu ${provisionBody ? provisionBody.action : 'aucun envoi'})`);
  ok(provisionBody?.center?.id === SECOND_CENTER_ID,
    `le formulaire porte le centre saisi (obtenu ${provisionBody?.center?.id || 'aucun'})`);
  ok(provisionBody?.center?.branding?.accent === SECOND_ACCENT,
    `le formulaire porte la COULEUR saisie (obtenu ${provisionBody?.center?.branding?.accent || 'aucune'})`);
  ok(provisionBody?.center?.sender?.email === SECOND_SENDER_EMAIL,
    `le formulaire porte l ADRESSE D EXPEDITEUR saisie (obtenu ${provisionBody?.center?.sender?.email || 'aucune'})`);
  ok(provisionBody?.center?.sender?.label === SECOND_SENDER_LABEL,
    `le formulaire porte le NOM D EXPEDITEUR saisi (obtenu ${provisionBody?.center?.sender?.label || 'aucun'})`);
  const derivedKeys = Object.keys(provisionBody?.center?.branding || {});
  ok(['accentStrong', 'accentSoft', 'accentContrast', 'dark'].every((key) => derivedKeys.includes(key)),
    `une seule couleur tapee suffit : l ecran derive le jeu complet (obtenu ${derivedKeys.join(', ') || 'rien'})`);
  consoleBranding = provisionBody?.center?.branding || null;

  // Le corps de la console, rejoue TEL QUEL dans le vrai handler d'API.
  const createRes = await callHandler(opsHandler, {
    method: 'POST', url: '/api/ops', token: OWNER_TOKEN, body: provisionBody,
  });
  ok(createRes.res.statusCode === 200,
    `l API accepte le formulaire (obtenu ${createRes.res.statusCode}${createRes.res.statusCode !== 200 ? ` : ${createRes.json?.error || createRes.res.body}` : ''})`);
  ok(createRes.json?.center?.id === SECOND_CENTER_ID, `le centre est cree (obtenu ${createRes.json?.center?.id})`);
  ok(centerRows.some((row) => row.id === SECOND_CENTER_ID && row.client_id === SECOND_CLIENT_ID),
    'la ligne centers porte bien le client_id du deuxieme client');
  ok(centerRows.find((row) => row.id === SECOND_CENTER_ID)?.settings?.config?.branding?.accent === SECOND_ACCENT,
    'la couleur du formulaire est persistee sur la ligne du centre, sans aucun appel supplementaire');
  ok(emailIdentityRows.some((row) => row.center_id === SECOND_CENTER_ID && row.email === SECOND_SENDER_EMAIL && row.is_default),
    `l identite d expediteur est creee par le MEME envoi (lignes: ${emailIdentityRows.length})`);
  ok(!emailIdentityRows.some((row) => row.center_id !== SECOND_CENTER_ID),
    'aucune identite n a fuite vers un autre centre');

  section('[2] La couleur est MESUREE : contraste faible = avertissement, jamais blocage');
  const okNote = journey.provisioning?.noticeOk || '';
  const badNote = journey.provisioning?.noticeUnreadable || '';
  ok(/contraste tenu/i.test(okNote),
    `la couleur retenue affiche un verdict de contraste tenu (obtenu "${okNote}")`);
  ok(/sous le seuil de 3:1/.test(badNote),
    `${UNREADABLE_ACCENT} est signalee sous le seuil composant (obtenu "${badNote}")`);
  ok(journey.provisioning?.unreadableStillSavable === true,
    'une couleur illisible reste enregistrable : l ecran avertit, il ne bloque pas');
  ok(journey.provisioning?.invalidRefused === true,
    'une saisie qui n est pas une couleur, elle, est refusee avec un message');
  // CONTRE-EPREUVE des champs : sans saisie, RIEN ne part, et l'ecran annonce
  // ce qui se passera. Sans cela, les preuves de l'etape [1] pourraient venir
  // d'un defaut cache plutot que des champs remplis.
  const bare = journey.provisioning?.bareBody || null;
  ok(Boolean(bare) && bare.center && bare.center.branding === undefined && bare.center.sender === undefined,
    `le meme formulaire laisse vide n envoie NI couleur NI expediteur (obtenu ${bare ? Object.keys(bare.center || {}).join(', ') : 'aucun envoi'})`);
  ok(/accent Pinlane/i.test(journey.provisioning?.bareNote || ''),
    `l etat par defaut est annonce, pas subi (obtenu "${journey.provisioning?.bareNote || ''}")`);

  section('[3] La config d exploitation est saisie dans Etablissement, meme console');
  const estabBodies = journey.establishment?.bodies || [];
  const estabConfig = estabBodies.find((body) => body.action === 'saveCenterConfig') || null;
  const estabCenter = estabBodies.find((body) => body.action === 'saveCenter') || null;
  ok(Boolean(estabConfig), `le bouton "Enregistrer" poste saveCenterConfig (obtenu ${estabBodies.map((b) => b.action).join(', ') || 'aucun envoi'})`);
  ok(Number(estabConfig?.config?.resources?.bowling?.laneCount) === 12,
    `l ecran renvoie SES 12 pistes (obtenu ${estabConfig?.config?.resources?.bowling?.laneCount})`);
  ok(estabConfig?.config?.branding?.accent === SECOND_ACCENT,
    `l ecran Etablissement sait AUSSI porter la couleur (obtenu ${estabConfig?.config?.branding?.accent || 'aucune'})`);
  if (estabCenter) {
    await callHandler(opsHandler, { method: 'POST', url: '/api/ops', token: STRIKE_TOKEN, body: estabCenter });
  }
  const saveConfigRes = await callHandler(opsHandler, {
    method: 'POST', url: '/api/ops', token: STRIKE_TOKEN, body: estabConfig,
  });
  ok(saveConfigRes.res.statusCode === 200,
    `l API accepte la config de l ecran (obtenu ${saveConfigRes.res.statusCode}${saveConfigRes.res.statusCode !== 200 ? ` : ${saveConfigRes.json?.error || saveConfigRes.res.body}` : ''})`);
  ok(Boolean(centerRows.find((row) => row.id === SECOND_CENTER_ID)?.settings?.config),
    'la config saisie dans Etablissement est persistee sur la ligne du centre');
  ok(centerRows.find((row) => row.id === SECOND_CENTER_ID)?.settings?.config?.branding?.accent === SECOND_ACCENT,
    'enregistrer la config ne fait pas disparaitre la couleur posee au provisionnement');

  section('[4] Le moteur CONNAIT ce centre (blocage A)');
  await refreshCenterOverrides(pool, { force: true });
  await refreshCatalog(pool, { force: true });
  let secondCenter = null;
  let getCenterError = '';
  try { secondCenter = getCenter(SECOND_CENTER_ID); } catch (error) { getCenterError = error.message; }
  ok(Boolean(secondCenter), `getCenter('${SECOND_CENTER_ID}') rend une fiche${getCenterError ? ` (leve: ${getCenterError})` : ''}`);
  ok(secondCenter?.name === SECOND_CENTER_NAME, `la fiche porte SON nom (obtenu "${secondCenter?.name}")`);
  ok(Number(secondCenter?.resources?.bowling?.laneCount) === 12,
    `la fiche porte SES 12 pistes (obtenu ${secondCenter?.resources?.bowling?.laneCount})`);
  // « Pas de laser du tout » n'est PAS exprimable dans l'ecran Etablissement :
  // il propose un nombre d'armes, pas une case « aucune arene ». Ce que la
  // console sait dire, c'est ZERO arme, et c'est ce qu'on verifie ici. Ce qui
  // decide de ce qui est VENDU, c'est le catalogue (etape [5]) : laser_game y
  // est absent, et c'est la seule chose qu'un client verra.
  ok(Number(secondCenter?.resources?.laser?.weaponCount) === 0,
    `la fiche declare zero arme laser, ce que l ecran sait exprimer (obtenu ${secondCenter?.resources?.laser?.weaponCount})`);
  ok(getCenter('libramont')?.name === 'Fun Galaxy Libramont',
    'les centres du fichier restent intacts (non-regression)');

  section('[5] Le tunnel public sert SES horaires et SON catalogue (blocage A, suite)');
  const metaSecond = await callHandler(metaHandler, { url: `/api/public-booking-meta?centerId=${SECOND_CENTER_ID}&date=${DATE}` });
  const metaFunGalaxy = await callHandler(metaHandler, { url: `/api/public-booking-meta?centerId=libramont&date=${DATE}` });
  const scheduleSecond = metaSecond.json?.center?.day?.schedule || null;
  const scheduleFunGalaxy = metaFunGalaxy.json?.center?.day?.schedule || null;
  ok(metaSecond.res.statusCode === 200, `le tunnel du deuxieme client repond 200 (obtenu ${metaSecond.res.statusCode})`);
  ok(metaSecond.json?.center?.id === SECOND_CENTER_ID, `le payload porte SON id (obtenu ${metaSecond.json?.center?.id})`);
  ok(scheduleSecond?.open === 11 && scheduleSecond?.close === 19,
    `SES horaires (11h-19h) sont servis (obtenu ${scheduleSecond?.label})`);
  ok(scheduleFunGalaxy && scheduleSecond
    && (scheduleFunGalaxy.open !== scheduleSecond.open || scheduleFunGalaxy.close !== scheduleSecond.close),
    `contraste : Fun Galaxy affiche ${scheduleFunGalaxy?.label}, le deuxieme client ${scheduleSecond?.label}`);
  const idsSecond = (metaSecond.json?.activities || []).map((a) => a.id);
  const idsFunGalaxy = (metaFunGalaxy.json?.activities || []).map((a) => a.id);
  ok(idsSecond.includes('bowling'), `SON catalogue contient le bowling (obtenu: ${idsSecond.join(', ') || 'vide'})`);
  ok(!idsSecond.includes('laser_game'), 'SON catalogue ne contient PAS le laser game, qu il ne vend pas');
  ok(idsFunGalaxy.includes('laser_game'), 'contraste : le catalogue Fun Galaxy contient bien le laser game');

  section('[6] Le tunnel public sert SES creneaux, dans SES heures');
  const availabilitySecond = await callHandler(availabilityHandler, {
    url: `/api/public-availability?centerId=${SECOND_CENTER_ID}&date=${DATE}&type=bowling&pax=4&duration=1`,
  });
  const slotsSecond = availabilitySecond.json?.slots || [];
  ok(availabilitySecond.res.statusCode === 200, `la disponibilite repond 200 (obtenu ${availabilitySecond.res.statusCode})`);
  ok(slotsSecond.length > 0, `des creneaux sont proposes (${slotsSecond.length})`);
  const outsideHours = slotsSecond.filter((slot) => {
    const hour = Number(String(slot.time).slice(0, 2));
    return hour < 11 || hour >= 19;
  });
  ok(outsideHours.length === 0,
    `aucun creneau hors 11h-19h (${outsideHours.length} hors plage${outsideHours.length ? ` : ${outsideHours.slice(0, 3).map((s) => s.time).join(', ')}` : ''})`);
  const maxLane = Math.max(0, ...slotsSecond.flatMap((slot) => slot.lanes || []));
  ok(maxLane <= 12, `les pistes proposees restent dans SON parc de 12 (max vu: ${maxLane})`);

  section('[7] Une reservation passe VRAIMENT sur ce centre');
  const before = reservationRows.length;
  // Le corps EXACT que le tunnel poste : le creneau choisi, avec les pistes que
  // le serveur vient de proposer (buildReservationApiPayload les recopie).
  const chosenSlot = slotsSecond[0] || null;
  const reservationRes = await callHandler(reservationsHandler, {
    method: 'POST',
    url: '/api/public-reservations',
    body: {
      centerId: SECOND_CENTER_ID,
      channel: 'public',
      name: 'Camille Dubois',
      phone: '+32470112233',
      email: 'camille.dubois@exemple.be',
      date: DATE,
      startTime: chosenSlot?.time || '14:00',
      duration: 1,
      pax: 4,
      type: 'bowling',
      lanes: chosenSlot?.lanes || [1],
      laneCount: (chosenSlot?.lanes || [1]).length,
      requiresLanes: true,
    },
  });
  const created = reservationRes.json?.reservation || null;
  ok(reservationRes.res.statusCode === 201,
    `la reservation est acceptee (obtenu ${reservationRes.res.statusCode}${reservationRes.res.statusCode !== 201 ? ` : ${reservationRes.json?.error || reservationRes.res.body}` : ''})`);
  ok(reservationRows.length === before + 1, `une ligne est bien ecrite en base (${reservationRows.length - before})`);
  ok(created?.centerId === SECOND_CENTER_ID, `la ligne porte SON centre (obtenu ${created?.centerId})`);

  section('[8] Elle apparait cote STAFF de ce client, et nulle part ailleurs');
  const staffSecond = await callHandler(staffStateHandler, {
    url: `/api/staff-state?date=${DATE}&centerId=${SECOND_CENTER_ID}`,
    token: STRIKE_TOKEN,
  });
  const staffIds = (staffSecond.json?.reservations || []).map((r) => Number(r.id));
  ok(staffSecond.res.statusCode === 200, `le staff du deuxieme client lit son etat (obtenu ${staffSecond.res.statusCode})`);
  ok(created && staffIds.includes(Number(created.id)),
    `la reservation ${created?.id} est visible cote staff (vues: ${staffIds.join(', ') || 'aucune'})`);
  const staffFunGalaxy = await callHandler(staffStateHandler, {
    url: `/api/staff-state?date=${DATE}&centerId=libramont`,
    token: FUNGALAXY_TOKEN,
  });
  const funGalaxyIds = (staffFunGalaxy.json?.reservations || []).map((r) => Number(r.id));
  ok(!funGalaxyIds.includes(Number(created?.id)),
    `contraste : Fun Galaxy ne voit PAS cette reservation (vues: ${funGalaxyIds.join(', ') || 'aucune'})`);

  section('[9] Les sequences automatiques partent avec SON identite d expediteur (blocage D)');
  const senderIdentity = await opsCommunications.resolveCenterSenderIdentity(SECOND_CENTER_ID, {
    query: (t, p) => pool.query(t, p),
  });
  ok(senderIdentity.fromEmail === SECOND_SENDER_EMAIL,
    `l identite du centre est resolue (obtenu ${senderIdentity.fromEmail || 'aucune'})`);
  const enqueued = [];
  const sweep = await opsCommunications.runBirthdayJ30Sweep(SECOND_CENTER_ID, {
    query: (t, p) => birthdayQuery(t, p),
    enqueue: async (input) => { enqueued.push(input); return { id: 1 }; },
  }, { today: DATE });
  ok(sweep.enqueued === 1, `la sequence anniversaire enfile 1 message (obtenu ${sweep.enqueued})`);
  ok(enqueued[0]?.payload?.fromEmail === SECOND_SENDER_EMAIL,
    `le message porte l expediteur du centre (obtenu ${enqueued[0]?.payload?.fromEmail || 'aucun'})`);
  ok(enqueued[0]?.payload?.fromLabel === SECOND_SENDER_LABEL,
    `le message porte le libelle du centre (obtenu ${enqueued[0]?.payload?.fromLabel || 'aucun'})`);
  // Ce que Resend recevra vraiment : on capture l appel HTTP, on n envoie rien.
  const sentFrom = await captureSendEmailFrom({
    centerId: SECOND_CENTER_ID,
    channel: 'email',
    recipient: 'camille.dubois@exemple.be',
    subject: enqueued[0]?.subject || 'Anniversaire',
    body: enqueued[0]?.body || '',
    payload: enqueued[0]?.payload || {},
  });
  ok(sentFrom === `${SECOND_SENDER_LABEL} <${SECOND_SENDER_EMAIL}>`,
    `l en-tete From part au nom du centre (obtenu "${sentFrom}")`);
  const sentFromNoIdentity = await captureSendEmailFrom({
    centerId: SECOND_CENTER_ID,
    channel: 'email',
    recipient: 'camille.dubois@exemple.be',
    subject: 'Sans identite configuree',
    body: 'corps',
    payload: {},
  });
  ok(!/Fun Galaxy/.test(sentFromNoIdentity),
    `sans identite configuree, le repli n est PLUS "Fun Galaxy" (obtenu "${sentFromNoIdentity}")`);

  section('[10] Le tunnel porte SES couleurs, et le CSS n en ecrit AUCUNE (blocage C)');
  const clientCss = fs.readFileSync(path.join(ROOT, 'assets', 'pinlane-client.css'), 'utf8');
  const accentBlock = clientCss.slice(0, clientCss.indexOf('/* ---', clientCss.indexOf('body.client-mode, body.public-form')));
  ok(!/--accent(-strong|-soft|-contrast)?\s*:\s*#[0-9a-f]{3,8}/i.test(clientCss),
    'assets/pinlane-client.css n affecte plus AUCUNE couleur en dur a un jeton d accent');
  ok(!/#a1289a|#c74fbf|#7d2478|#e59ede/i.test(clientCss),
    'le magenta Fun Galaxy a quitte la feuille de style');
  ok(/var\(--tenant-accent\)/.test(accentBlock || clientCss),
    'le parcours client consomme bien le jeton --tenant-accent');
  const brandingSecond = metaSecond.json?.center?.branding || null;
  const brandingFunGalaxy = metaFunGalaxy.json?.center?.branding || null;
  ok(brandingSecond?.accent === SECOND_ACCENT,
    `le tunnel du deuxieme client recoit SA couleur (obtenu ${brandingSecond?.accent || 'aucune'})`);
  // La variante sombre n'est PAS ecrite dans ce fichier : on verifie qu'on
  // recoit exactement celle que l'ecran a derivee de la couleur tapee.
  ok(Boolean(consoleBranding?.dark?.accent) && brandingSecond?.dark?.accent === consoleBranding.dark.accent,
    `sa variante sombre, derivee par l ecran, est servie telle quelle (obtenu ${brandingSecond?.dark?.accent || 'aucune'}, attendu ${consoleBranding?.dark?.accent || 'inconnue'})`);
  ok(brandingSecond?.accentContrast === consoleBranding?.accentContrast,
    `le jeton de texte sur bouton suit le meme chemin (obtenu ${brandingSecond?.accentContrast || 'aucun'})`);
  ok(brandingFunGalaxy?.accent === '#a1289a',
    `contraste : Fun Galaxy garde son magenta, en DONNEE cette fois (obtenu ${brandingFunGalaxy?.accent || 'aucune'})`);

  section('[11] La ligne d installation selectionne le centre, prouve au navigateur (blocage B)');
  await proveEmbedSelectsCenter();

  section('[12] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
  await mutationCounterProof();
}

// -- Etape 7 : jeu de donnees anniversaire ----------------------------------
function birthdayQuery(text, params) {
  const sql = normalizeSql(text);
  if (/from center_automation_settings/i.test(sql)) {
    return Promise.resolve({ rows: [{ settings: { birthday_j30: { enabled: true } } }], rowCount: 1 });
  }
  if (/from email_identities/i.test(sql)) {
    const scoped = emailIdentityRows.filter((row) => row.center_id === params[0]);
    return Promise.resolve({ rows: scoped.map((row) => ({ ...row })), rowCount: scoped.length });
  }
  if (/occasion = 'anniversaire'/i.test(sql)) {
    // Une fete d il y a presque un an chez CE centre : la cible exacte du J-30.
    const party = new Date(`${DATE}T12:00:00Z`);
    party.setUTCDate(party.getUTCDate() - 335);
    return Promise.resolve({
      rows: [{ id: 1, name: 'Lena Martin', phone: '+32470998877', email: 'lena.martin@exemple.be', date: party.toISOString().slice(0, 10) }],
      rowCount: 1,
    });
  }
  if (/from marketing_suppressions/i.test(sql)) return Promise.resolve({ rows: [], rowCount: 0 });
  if (/from communications/i.test(sql)) return Promise.resolve({ rows: [], rowCount: 0 });
  return Promise.resolve({ rows: [], rowCount: 0 });
}

// Capture l en-tete From que sendEmail poserait, sans jamais sortir sur le
// reseau : fetch est remplace le temps de l appel.
async function captureSendEmailFrom(communication) {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.RESEND_FROM;
  const previousFetch = global.fetch;
  process.env.RESEND_API_KEY = 'gate-fake-key';
  process.env.RESEND_FROM = 'no-reply@pinlane.be';
  let captured = '';
  global.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body || '{}'));
    captured = String(body.from || '');
    return { ok: true, status: 200, json: async () => ({ id: 'gate-message-id' }), text: async () => '{}' };
  };
  try {
    // La VRAIE fonction d envoi (deja exposee sous __test pour le gate de
    // separation des desinscriptions) : c'est elle qui compose l en-tete From.
    await opsCommunications.__test.sendEmail(communication);
  } catch (error) {
    captured = captured || `ERREUR ${error.message}`;
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM; else process.env.RESEND_FROM = previousFrom;
  }
  return captured;
}

// -- Appel d un handler d API reel ------------------------------------------
async function callHandler(handler, options) {
  const req = fakeReq(options);
  const res = fakeRes();
  await handler(req, res);
  return { req, res, json: jsonOf(res) };
}

// -- Etape 9 : la preuve navigateur -----------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '' || url.pathname === '/reserver') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// ── LE PARCOURS CONSOLE, DANS UN VRAI NAVIGATEUR ────────────────────────────
//
// C'est la partie qui repond a la question posee : accueillir un client
// demande-t-il encore d'ouvrir un terminal ? On ne simule pas les ecrans, on
// les ouvre : le formulaire "Nouveau client" et l'ecran "Etablissement" sont
// remplis champ par champ (evenements input reels, clic reel sur le bouton), et
// on capture les corps de requete EXACTS qu'ils envoient. Le reste du gate ne
// rejoue que ceux-la. Si un reglage n'est atteignable que par un appel a la
// main, il n'apparait dans aucun corps capture, et les etapes qui en dependent
// rougissent.
async function launchGateBrowser() {
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch (error) {
    ok(false, `playwright-core indisponible : le parcours console ne peut pas etre prouve (${error.message})`);
    return null;
  }
  if (!fs.existsSync(BROWSER_PATH)) {
    ok(false, `navigateur introuvable (${BROWSER_PATH}) : le parcours console ne peut pas etre prouve. Definir E2E_BROWSER_PATH.`);
    return null;
  }
  return chromium.launch({ executablePath: BROWSER_PATH, headless: true });
}

function gateStaffSession(centerId, permissions) {
  return {
    token: 'qa-gate',
    cookieBacked: false,
    centerId,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    member: { id: `${centerId}:qa`, name: 'Movsar', roleId: 'direction' },
    role: { id: 'direction', name: 'Direction', locked: true },
    permissions,
  };
}

async function installConsoleMock(page, { session, platformClients, centerConfig }) {
  await page.addInitScript(({ session, platformClients, centerConfig }) => {
    window.__QA_POSTS__ = [];
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const method = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') {
        return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: session.member.id, roles: [], members: [], events: [], permissions: session.permissions } });
      }
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: session.centerId });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: session.centerId });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: '2026-08-15', durationOptions: [], formules: [], activities: [], center: { id: session.centerId, status: 'active' } });
      if (u.pathname === '/api/ops' && method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        window.__QA_POSTS__.push(body);
        // Reponse minimale mais REALISTE : le formulaire enchaine sur l'etape
        // « acces crees » avec ce que le serveur lui rend.
        return J({
          ok: true,
          client: { id: body.id, name: body.name },
          center: body.center ? { id: body.center.id, name: body.center.name || body.center.id, branding: body.center.branding || null, sender: body.center.sender || null } : null,
          accessCodes: [{ centerId: body.center && body.center.id, role: 'Direction', code: 'QA-DIRECTION-0001' }],
        });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'platformClients') return J(platformClients);
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'centerConfig') return J(centerConfig);
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {}, blocks: [] });
      return nativeFetch(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
  }, { session, platformClients, centerConfig });
}

async function captureConsoleJourney() {
  const empty = { provisioning: null, establishment: null };
  const browser = await launchGateBrowser();
  if (!browser) return empty;
  const server = await serveStatic();
  const ownerSession = gateStaffSession('libramont', [...ALL_PERMISSIONS, 'platform.admin']);
  const platformClients = {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    clients: [{ id: 'fungalaxy', name: 'Fun Galaxy', status: 'active', plan: 'standard', monthlyPrice: null, revenue30d: 0, centers: [], centerCount: 0, staffCount: 0 }],
    platform: { mrr: 0, activeClients: 1, activeCenters: 3, revenue30dAll: 0, clientsWithPrice: 0, clientCount: 1, centerCount: 3 },
    orphanCenters: [],
  };
  const out = { provisioning: null, establishment: null };
  try {
    // ---- Ecran 1 : "Clients Pinlane" > Nouveau client -----------------------
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    await installConsoleMock(page, { session: ownerSession, platformClients, centerConfig: { ok: true, centers: [], activities: [] } });
    await page.goto(`${BASE_URL}/?v=second-client-console`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.renderPlatformClientsPage === 'function' && Boolean(window.PinlaneBrand), null, { timeout: 15000 });
    out.provisioning = await page.evaluate(async ({ clientId, clientName, centerId, centerName, accent, senderLabel, senderEmail, unreadable }) => {
      const host = document.getElementById('staffCockpitPage');
      host.classList.remove('hidden');
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // L'app finit son propre demarrage avant qu'on rende la page : sinon son
      // premier rendu remplacerait le conteneur qu'on vient de peupler.
      await wait(500);
      window.renderPlatformClientsPage(host);
      await wait(400);

      // Saisie REELLE : on ecrit dans le champ et on declenche l'evenement que
      // la frappe declencherait. Un fcpSet() appele a la main testerait la
      // fonction, pas le formulaire.
      const type = (input, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const byLabel = (text) => {
        const fields = Array.from(document.querySelectorAll('.fcp-overlay .fcp-field'));
        const field = fields.find((f) => ((f.querySelector('label') || {}).textContent || '').trim().toLowerCase().startsWith(String(text).toLowerCase()));
        const input = field ? field.querySelector('input') : null;
        if (!input) {
          const seen = fields.map((f) => ((f.querySelector('label') || {}).textContent || '').trim()).join(' | ');
          const overlay = document.querySelector('.fcp-overlay');
          throw new Error(`champ introuvable pour "${text}" ; libelles vus : ${seen || 'aucun'} ; overlay: ${overlay ? overlay.innerHTML.slice(0, 400) : 'absent'}`);
        }
        return input;
      };
      const fill = (accentValue) => {
        type(byLabel('identifiant (slug)'), clientId);
        type(byLabel('raison sociale'), clientName);
        type(byLabel('identifiant du centre'), centerId);
        type(byLabel('nom du centre'), centerName);
        type(document.getElementById('fcpAccentText'), accentValue);
        type(byLabel("nom d'expediteur"), senderLabel);
        type(byLabel("adresse d'expediteur"), senderEmail);
      };
      const noteText = () => String((document.getElementById('fcpBrandNote') || {}).textContent || '').trim();
      const errorText = () => {
        const el = document.querySelector('.fcp-modal-error');
        return el ? el.textContent.trim() : '';
      };
      const primary = () => document.querySelector('.fcp-modal-foot .pv2-btn.primary');

      // Chaque tour rouvre le formulaire comme un humain le ferait : on FERME
      // la modale (bouton Fermer) avant d'en rouvrir une, sinon on tape dans
      // l'etape « acces crees » de la precedente.
      const openForm = async () => {
        if (document.querySelector('.fcp-overlay')) { window.fcpCloseModal(); await wait(150); }
        window.fcpOpenNew();
        await wait(150);
        if (!document.querySelector('.fcp-panel .fcp-field')) {
          throw new Error(`le formulaire ne s'est pas ouvert (hote: ${host.innerHTML.length} caracteres)`);
        }
      };

      // (a) La couleur retenue : le verdict de contraste affiche sous le champ.
      await openForm();
      fill(accent);
      const noticeOk = noteText();

      // (b) Une couleur illisible : l'ecran doit AVERTIR et laisser passer.
      type(document.getElementById('fcpAccentText'), unreadable);
      const noticeUnreadable = noteText();
      primary().click();
      await wait(400);
      const unreadableStillSavable = window.__QA_POSTS__.length === 1
        && (window.__QA_POSTS__[0].center || {}).branding
        && window.__QA_POSTS__[0].center.branding.accent === unreadable;

      // (c) Une saisie qui n'est PAS une couleur : refusee, avec un message.
      window.__QA_POSTS__ = [];
      await openForm();
      fill('vert sapin');
      primary().click();
      await wait(300);
      const invalidRefused = window.__QA_POSTS__.length === 0 && /couleur/i.test(errorText());

      // (d) CONTRE-EPREUVE : le meme formulaire, sans couleur ni expediteur.
      // Si le corps envoye portait quand meme une marque, les preuves de
      // l'etape [1] ne viendraient pas des champs mais d'un defaut cache.
      window.__QA_POSTS__ = [];
      await openForm();
      type(byLabel('identifiant (slug)'), `${clientId}-nu`);
      type(byLabel('raison sociale'), `${clientName} (sans marque)`);
      type(byLabel('identifiant du centre'), `${centerId}-nu`);
      type(byLabel('nom du centre'), `${centerName} (sans marque)`);
      const bareNote = noteText();
      primary().click();
      await wait(400);
      const bareBody = window.__QA_POSTS__[0] || null;

      // (e) Le vrai envoi, avec la couleur retenue.
      window.__QA_POSTS__ = [];
      await openForm();
      fill(accent);
      primary().click();
      await wait(500);
      return {
        bareBody,
        bareNote,
        body: window.__QA_POSTS__[0] || null,
        noticeOk,
        noticeUnreadable,
        unreadableStillSavable: Boolean(unreadableStillSavable),
        invalidRefused: Boolean(invalidRefused),
        codesStep: Boolean(document.querySelector('.fcp-codes-warn')),
      };
    }, {
      clientId: SECOND_CLIENT_ID,
      clientName: 'Strike Namur SARL',
      centerId: SECOND_CENTER_ID,
      centerName: SECOND_CENTER_NAME,
      accent: SECOND_ACCENT,
      senderLabel: SECOND_SENDER_LABEL,
      senderEmail: SECOND_SENDER_EMAIL,
      unreadable: UNREADABLE_ACCENT,
    });
    await page.close().catch(() => {});

    // ---- Ecran 2 : "Etablissement" du nouveau centre ------------------------
    // Il demarre exactement dans l'etat que l'ecran 1 vient de creer : la
    // couleur est deja posee, le reste (pistes, horaires, catalogue) est ce que
    // la direction du client saisit.
    const centerConfig = buildEstablishmentSeed(out.provisioning && out.provisioning.body);
    const page2 = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    await installConsoleMock(page2, {
      session: gateStaffSession(SECOND_CENTER_ID, ALL_PERMISSIONS),
      platformClients,
      centerConfig,
    });
    await page2.goto(`${BASE_URL}/?v=second-client-estab`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page2.waitForFunction(() => typeof window.setView === 'function' && typeof window.renderStaffUtilityPage === 'function', null, { timeout: 15000 });
    out.establishment = await page2.evaluate(async ({ centerId, accent }) => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      state.currentDate = '2026-08-15';
      state.staffMenuPage = 'establishment';
      state.establishmentTab = 'centre';
      state.establishmentEditing = false;
      state.establishmentCenterId = centerId;
      state.adminCenterId = centerId;
      save();
      setView('staff');
      await wait(600);
      startEstablishmentEdit();
      await wait(300);
      const accentField = document.getElementById('estab-accent');
      const hasField = Boolean(accentField);
      // On RETAPE la couleur dans le champ : si l'ecran ne savait pas la
      // porter, elle ne repartirait pas dans le payload.
      if (accentField) {
        accentField.value = accent;
        accentField.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const note = (document.getElementById('estab-brand-note') || {}).textContent || '';
      window.__QA_POSTS__ = [];
      await submitCenterConfig(centerId);
      return { bodies: window.__QA_POSTS__.slice(), hasField, note: note.trim() };
    }, { centerId: SECOND_CENTER_ID, accent: SECOND_ACCENT });
    await page2.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  return out;
}

// L'etat de depart de l'ecran Etablissement : la projection que le serveur rend
// vraiment (lib/center-scope), construite avec le VRAI normaliseur de config.
function buildEstablishmentSeed(provisionBody) {
  const cc = require(path.join(ROOT, 'lib', 'center-config.js'));
  const knowledge = require(path.join(ROOT, 'ops-knowledge', 'activities.json'));
  const posed = (provisionBody && provisionBody.center && provisionBody.center.branding) || null;
  const config = cc.normalizeCenterConfig({ ...SECOND_CENTER_CONFIG, branding: posed }, SECOND_CENTER_ID);
  return {
    ok: true,
    centers: [{
      id: SECOND_CENTER_ID,
      name: SECOND_CENTER_NAME,
      clientId: SECOND_CLIENT_ID,
      clientName: 'Strike Namur SARL',
      status: config.status,
      timezone: config.timezone,
      resources: config.resources,
      defaultSchedule: config.defaultSchedule == null ? null : config.defaultSchedule,
      activityAvailability: config.activityAvailability,
      holidaySettings: config.holidaySettings,
      offerAvailability: config.offerAvailability,
      classification: config.classification,
      customActivities: config.customActivities,
      branding: config.branding || null,
    }],
    activities: (knowledge.activities || []).map((activity) => ({
      id: activity.id,
      label: activity.label || activity.name || activity.id,
    })),
  };
}

async function proveEmbedSelectsCenter() {
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch (error) {
    ok(false, `playwright-core indisponible : la preuve de bout en bout ne peut pas tourner (${error.message})`);
    return;
  }
  if (!fs.existsSync(BROWSER_PATH)) {
    ok(false, `navigateur introuvable (${BROWSER_PATH}) : la preuve de bout en bout ne peut pas tourner. Definir E2E_BROWSER_PATH.`);
    return;
  }
  const server = await serveStatic();
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
    const page = await browser.newPage();
    await installTunnelMock(page);
    // La page EXACTE que sert embed.js : /reserver?embed=1&center=<slug>.
    await page.goto(`${BASE_URL}/reserver?embed=1&center=${SECOND_CENTER_ID}&v=second-client`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate((d) => {
      state.view = 'client';
      state.booking.date = d;
      state.booking.type = 'bowling';
      state.booking.pax = 4;
      state.booking.duration = 1;
    }, DATE);
    await page.evaluate(() => loadCenterScheduleConfig(state.booking.date));
    await page.evaluate(() => fetchSlots({ showLoading: false }));
    await page.waitForFunction(() => window.__QA_CALLS__.meta.length > 0 && window.__QA_CALLS__.availability.length > 0, null, { timeout: 15000 });

    const calls = await page.evaluate(() => window.__QA_CALLS__);
    const metaCenters = calls.meta.map((search) => new URLSearchParams(search).get('centerId'));
    const availabilityCenters = calls.availability.map((search) => new URLSearchParams(search).get('centerId'));
    ok(metaCenters.every((id) => id === SECOND_CENTER_ID) && metaCenters.length > 0,
      `le catalogue est demande POUR ce centre (obtenu: ${metaCenters.join(', ') || 'aucun appel'})`);
    ok(availabilityCenters.every((id) => id === SECOND_CENTER_ID) && availabilityCenters.length > 0,
      `les creneaux sont demandes POUR ce centre (obtenu: ${availabilityCenters.join(', ') || 'aucun appel'})`);

    // Les couleurs REELLEMENT calculees par le navigateur.
    const accent = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent').trim());
    ok(accent.toLowerCase() === SECOND_ACCENT,
      `le tunnel calcule SA couleur d accent (obtenu "${accent}")`);

    // Le POST de reservation part-il avec le bon centre ?
    const postedCenter = await page.evaluate(() => {
      const payload = buildReservationApiPayload({ type: 'bowling', pax: 4, lanes: [1], formuleId: '' }, { channel: 'public' });
      return payload.centerId;
    });
    ok(postedCenter === SECOND_CENTER_ID, `le POST de reservation porte ce centre (obtenu ${postedCenter})`);

    // AUCUN CLIGNOTEMENT au chargement suivant : la marque est memorisee par
    // centre et rappelee AVANT la premiere peinture (index.html), comme le
    // theme. Sonde posee avant tout script : elle voit la toute premiere frame.
    await page.reload({ waitUntil: 'commit', timeout: 45000 });
    const firstFrameAccent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tenant-accent').trim());
    ok(firstFrameAccent.toLowerCase() === SECOND_ACCENT,
      `au rechargement, la marque est la des la premiere peinture, sans attendre le serveur (obtenu "${firstFrameAccent}")`);

    // CONTRE-EPREUVE : sans ?center=, on garde le comportement historique. Et
    // la marque memorisee du deuxieme client ne doit PAS teinter la premiere
    // peinture d'un autre centre : la memoire est clefee par centre. On lit
    // AVANT que le serveur ait repondu (waitUntil 'commit'), c'est la seule
    // fenetre ou une fuite serait visible.
    const page2 = await browser.newPage();
    await installTunnelMock(page2);
    await page2.goto(`${BASE_URL}/reserver?embed=1&center=libramont&v=second-client-autre`, { waitUntil: 'commit', timeout: 45000 });
    const otherFirstFrame = await page2.evaluate(() => document.documentElement.style.getPropertyValue('--tenant-accent').trim());
    ok(otherFirstFrame !== SECOND_ACCENT,
      `la marque du deuxieme client ne teinte PAS la premiere peinture d un autre centre (obtenu "${otherFirstFrame || 'aucune'}")`);
    await page2.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });

    const page3 = await browser.newPage();
    await installTunnelMock(page3);
    await page3.goto(`${BASE_URL}/reserver?embed=1&v=second-client-nocenter`, { waitUntil: 'networkidle', timeout: 45000 });
    await page3.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    const defaultCenter = await page3.evaluate(() => getTunnelCenterId());
    ok(defaultCenter === 'libramont', `sans ?center=, le comportement historique tient (obtenu ${defaultCenter})`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

// La marque de Fun Galaxy telle qu'elle vit DANS LA DONNEE (fichier socle) :
// le banc d'essai ne la reecrit pas, il la lit, sinon on testerait une copie.
function baselineBranding(centerId) {
  const baseline = require(path.join(ROOT, 'ops-knowledge', 'centers.json'));
  const center = (baseline.centers || []).find((c) => c.id === centerId);
  return (center && center.branding) || null;
}

async function installTunnelMock(page) {
  const SECOND_BRANDING = consoleBranding;
  const OTHER_BRANDING = baselineBranding('libramont');
  await page.addInitScript(({ DATE, SECOND_CENTER_ID, SECOND_BRANDING, OTHER_BRANDING }) => {
    window.__QA_CALLS__ = { meta: [], availability: [], reservations: [] };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/public-booking-meta') {
        window.__QA_CALLS__.meta.push(u.search);
        const asked = u.searchParams.get('centerId');
        // Le serveur ne repond QUE pour le centre demande : si le tunnel
        // demandait libramont, la couleur et les horaires seraient ceux de
        // Fun Galaxy, et les assertions rougiraient.
        const isSecond = asked === SECOND_CENTER_ID;
        return J({
          ok: true, today: DATE, durationOptions: [], formules: [],
          activities: [{ id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 }],
          center: {
            id: asked, status: 'active',
            branding: isSecond ? SECOND_BRANDING : OTHER_BRANDING,
            defaultSchedule: { regular: { 0: { open: '11:00', close: '19:00' }, 1: { open: '11:00', close: '19:00' }, 2: { open: '11:00', close: '19:00' }, 3: { open: '11:00', close: '19:00' }, 4: { open: '11:00', close: '19:00' }, 5: { open: '11:00', close: '19:00' }, 6: { open: '11:00', close: '19:00' } }, holiday: {} },
            holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
            offerAvailability: {},
            day: { date: DATE, open: true, schedule: { open: 11, close: 19, label: '11h - 19h' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
          },
        });
      }
      if (u.pathname === '/api/public-availability') {
        window.__QA_CALLS__.availability.push(u.search);
        return J({ ok: true, date: DATE, slots: [{ time: '14:00', lanes: [1], freeCount: 11 }], laneCount: 1, duration: 1, totalDuration: 1, price: 26, requiresLanes: true, label: 'Bowling', anchors: null, message: '' });
      }
      if (u.pathname === '/api/public-reservations') {
        const body = JSON.parse(String(init.body || '{}'));
        window.__QA_CALLS__.reservations.push(body);
        return new Response(JSON.stringify({ ok: true, reservation: { id: 1, ...body, lanes: [1], status: 'pending' }, ops: {}, communications: [], warnings: [] }), { status: 201, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return nativeFetch(input, init);
    };
  }, { DATE, SECOND_CENTER_ID, SECOND_BRANDING, OTHER_BRANDING });
}

// -- Etape 10 : la mutation qui doit faire rougir ---------------------------
//
// On remet le bug A (le centre ne vient QUE du fichier) en vidant la liste des
// centres que la base rend, puis on verifie que getCenter redevient incapable
// de connaitre le deuxieme client. Restauration par edition inverse, jamais par
// git checkout.
async function mutationCounterProof() {
  const { applyCenterRecords } = require(path.join(ROOT, 'lib', 'ops-knowledge.js'));
  applyCenterRecords([]);
  let stillKnown = true;
  try { getCenter(SECOND_CENTER_ID); } catch (error) { stillKnown = false; }
  ok(!stillKnown, 'sans la lecture base, le centre redevient inconnu : ce gate SAIT rougir');
  await refreshCenterOverrides(getPool(), { force: true });
  let restored = false;
  try { restored = Boolean(getCenter(SECOND_CENTER_ID)); } catch (error) { restored = false; }
  ok(restored, 'restauration inverse : la lecture base le fait revenir');
}

run()
  .then(() => {
    if (failures) {
      console.error(`\nsecond-client-onboarding-check: FAIL ${failures} assertion(s)`);
      process.exit(1);
    }
    console.log('\nsecond-client-onboarding-check: ALL OK');
  })
  .catch((error) => {
    console.error(`\nsecond-client-onboarding-check: ERREUR ${error && (error.stack || error.message)}`);
    process.exit(1);
  });

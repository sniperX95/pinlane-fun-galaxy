'use strict';
// LE REGISTRE : AUCUNE DONNEE PERDUE (2026-10-05).
//
// Movsar : chaque reservation et chaque donnee saisie, sur le formulaire
// public comme dans la console, doit etre gardee en entier et rester
// recuperable apres une erreur, une panne ou une intrusion. Ce gate le prouve
// contre un VRAI Postgres LOCAL, en passant par les VRAIS handlers (auth et
// envoi de mails remplaces, rien d autre) :
//
//   [A] l instantane d une reservation est derive des clefs REELLES de
//       mapReservation : aucune clef de l objet ne manque (contre-epreuve : la
//       liste figee d origin/main aurait rougi, elle oubliait nom, telephone,
//       notes) ;
//   [B] creer au comptoir ecrit une ligne d audit avec l acteur, le nom, le
//       telephone, l e-mail et la note en texte complet ;
//   [C] modifier nom, telephone et note ecrit l ancien ET le nouveau texte,
//       et l etat complet avant / apres ;
//   [D] supprimer copie la ligne ENTIERE dans reservation_archive, dans la
//       transaction du DELETE ; la ligne d audit porte tout le dossier ;
//   [E] restaurer rend une ligne IDENTIQUE (meme identifiant, memes colonnes),
//       refuse une deuxieme restauration et un identifiant deja repris, et
//       demande le droit de supprimer ; la liste des archives se lit ;
//   [F] une reservation EN LIGNE ecrit une ligne d audit signee
//       « client (formulaire public) », instantane complet ;
//   [G] une demande sur mesure est journalisee a la creation (client) et a
//       chaque suivi du staff (statut, note), avant / apres ;
//   [H] une note client editee deux fois : les deux versions precedentes se
//       relisent en texte complet ;
//   [I] un dossier hors norme (note de 12 000 caracteres, extras enormes) :
//       nom, telephone, e-mail et note ne sont JAMAIS tronques, la troncature
//       du reste est dite ;
//   [J] le journal tombe en panne : la reservation est quand meme enregistree,
//       la perte crie ([registre]) et laisse une ligne ops_events ;
//   [K] la copie d archive tombe en panne : la suppression est REFUSEE, la
//       reservation reste ;
//   [L] le cablage statique (migrations, rollbacks, RLS, worker, npm).
//
// Lancement : DATABASE_URL=postgres://... node scripts/registre-check.js
// Sans DATABASE_URL le gate se saute en le disant ; un hote non local est
// REFUSE (ce gate ecrit et supprime des lignes de test).
// Contre-preuve : le meme fichier, joue sur le code d origin/main avec cette
// base, rougit sur B a K (voir le rapport du chantier).

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');

// La base de ce gate se donne par sa PROPRE variable : le poste qui porte la
// DATABASE_URL de production (celui qui lance db:migrate) saute ce gate au
// lieu de le voir refuser, et test:ops:all reste vert sans base locale.
if (!process.env.PINLANE_TEST_DATABASE_URL) {
  console.log('registre-check: PINLANE_TEST_DATABASE_URL absent, gate saute. Il demande un Postgres LOCAL (ex. postgres://postgres@localhost:55432/pin_registre).');
  console.log('GATE-SAUTE PINLANE_TEST_DATABASE_URL absent');
  process.exit(0);
}
process.env.DATABASE_URL = process.env.PINLANE_TEST_DATABASE_URL;
function hoteLocal(url) {
  try {
    const parsed = new URL(url);
    const host = String(parsed.hostname || '').toLowerCase();
    const socket = String(parsed.searchParams.get('host') || '');
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || socket.startsWith('/');
  } catch (error) {
    return false;
  }
}
if (!hoteLocal(process.env.DATABASE_URL)) {
  console.error('registre-check: REFUS. Ce gate ecrit et supprime des lignes de test : il ne tourne que contre un hote local (localhost, 127.0.0.1 ou socket). DATABASE_URL pointe ailleurs.');
  process.exit(2);
}

process.env.NODE_ENV = 'test';
process.env.PINLANE_CALENDAR_SYNC = 'off';
process.env.DATABASE_SSL = process.env.DATABASE_SSL || 'disable';
process.env.STAFF_AUTH_SECRET = process.env.STAFF_AUTH_SECRET || 'registre-gate-secret-2026';
delete process.env.VERCEL;
delete process.env.RESEND_API_KEY;

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `\n      ${String(detail).slice(0, 400)}` : ''}`);
  if (!cond) failures += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }
const lire = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// Les voisins remplaces : la session staff et les envois. Rien d autre.
// ---------------------------------------------------------------------------
const PREFIX = 'Registre QA';
const SESSION = {
  centerId: 'libramont',
  authorizedCenterId: 'libramont',
  member: { id: 'm-registre', name: 'Registre QA Direction', roleId: 'direction' },
  role: { id: 'direction', name: 'Direction', locked: true },
  permissions: ['dashboard.view', 'planning.view', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel', 'reservations.status', 'clients.view', 'clients.edit', 'ai.ops', 'emails.view'],
};
const permissionsDemandees = [];

function remplacer(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
}

remplacer('lib/staff-auth.js', {
  getStaffSessionFromRequest: async () => SESSION,
  requireStaffPermission: async (req, res, permission) => {
    permissionsDemandees.push(Array.isArray(permission) ? permission.join('|') : String(permission));
    return SESSION;
  },
});
remplacer('lib/ops-communications.js', {
  enqueueReservationCommunications: async () => [],
  dispatchDueCommunications: async () => ({ dispatched: [] }),
  sendCustomRequestAck: async () => ({ ok: false, skipped: true, reason: 'gate' }),
});

const db = require('../lib/database');
// Absent sur un code sans registre (contre-preuve sur origin/main) : les
// sections qui en dependent rougissent au lieu de faire planter le gate.
let registre = null;
try { registre = require('../lib/registre'); } catch (error) { registre = null; }
const audit = require('../lib/audit-log');
const staffReservations = require('../api/staff-reservations');
const publicReservations = require('../api/public-reservations');
const bookingMeta = require('../api/public-booking-meta');
const staffNotes = require('../api/staff-customer-notes');
const ops = require('../api/ops');

const pool = db.getPool();

function fakeReq(method, url, body) {
  const payload = Buffer.from(body === undefined ? '' : JSON.stringify(body));
  const req = Readable.from([payload]);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost', 'content-type': 'application/json', 'content-length': String(payload.length), 'user-agent': 'registre-check' };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}
function fakeRes() {
  const res = {
    statusCode: 0, body: '', headers: {}, headersSent: false,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(code) { this.statusCode = code; this.headersSent = true; return this; },
    end(chunk) { this.body += chunk == null ? '' : String(chunk); this.headersSent = true; },
  };
  res.json = () => { try { return JSON.parse(res.body || '{}'); } catch (error) { return { brut: res.body }; } };
  return res;
}
async function appeler(handler, method, url, body) {
  const res = fakeRes();
  await handler(fakeReq(method, url, body), res);
  return { status: res.statusCode, json: res.json() };
}

// Le jour de test : un samedi a plus de trois semaines, heure de Bruxelles.
function samediDans(jours) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  c.setUTCDate(c.getUTCDate() + jours);
  while (c.getUTCDay() !== 6) c.setUTCDate(c.getUTCDate() + 1);
  return c.toISOString().slice(0, 10);
}
const DATE = samediDans(22);
const CENTRE = 'libramont';
const TEL_NOTE = '0470 31 41 59';
const TEL_PATCH = '0470 99 88 77';

// La colonne pg `date` arrive en Date a minuit local : on la compare en jour.
function jourLocal(value) {
  if (!(value instanceof Date)) return value;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

async function tableExiste(nom) {
  const r = await pool.query('select to_regclass($1) as t;', [nom]);
  return Boolean(r.rows[0] && r.rows[0].t);
}

async function purger() {
  await pool.query("delete from audit_log where center_id = $1 and (changes::text like $2 or context::text like $2 or actor_label like $3);", [CENTRE, `%${PREFIX}%`, `${PREFIX}%`]);
  const ids = (await pool.query('select id from reservations where center_id = $1 and (name like $2 or email like $3);', [CENTRE, `${PREFIX}%`, 'registre-qa%'])).rows.map((r) => Number(r.id));
  if (ids.length) {
    await pool.query('delete from ops_events where reservation_id = any($1::bigint[]);', [ids]);
    await pool.query('delete from communications where reservation_id = any($1::bigint[]);', [ids]).catch(() => null);
    await pool.query('delete from ops_jobs where reservation_id = any($1::bigint[]);', [ids]).catch(() => null);
    await pool.query('delete from reservations where id = any($1::bigint[]);', [ids]);
  }
  await pool.query("delete from ops_events where center_id = $1 and event_type = 'audit_write_failed';", [CENTRE]).catch(() => null);
  if (await tableExiste('reservation_archive')) await pool.query("delete from reservation_archive where center_id = $1 and payload->>'name' like $2;", [CENTRE, `${PREFIX}%`]);
  await pool.query('delete from custom_requests where center_id = $1 and contact_name like $2;', [CENTRE, `${PREFIX}%`]);
  // Les deux telephones du dossier (celui de B, celui de C) sous tous leurs formats.
  const notes = require('../lib/customer-notes');
  const cles = [TEL_NOTE, TEL_PATCH].flatMap((tel) => notes.phoneAliases(notes.customerKey({ phone: tel })));
  if (await tableExiste('client_note_versions')) await pool.query('delete from client_note_versions where center_id = $1 and client_key = any($2::text[]);', [CENTRE, cles]);
  await pool.query('delete from client_notes where center_id = $1 and client_key = any($2::text[]);', [CENTRE, cles]);
}

async function lignesAudit(where, params) {
  const r = await pool.query(`select * from audit_log where ${where} order by id desc;`, params);
  return r.rows;
}
async function derniereLigne(action, entityId, surface = '') {
  const rows = await lignesAudit(`action = $1 and entity_id = $2${surface ? ' and surface = $3' : ''}`, surface ? [action, String(entityId), surface] : [action, String(entityId)]);
  return rows[0] || null;
}
async function ligneSql(id) {
  const r = await pool.query('select * from reservations where id = $1;', [Number(id)]);
  return r.rows[0] || null;
}
function normaliserLigne(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
}

(async () => {
  console.log(`registre-check : base ${new URL(process.env.DATABASE_URL).pathname}, centre ${CENTRE}, jour de test ${DATE}`);
  const tables = { archive: await tableExiste('reservation_archive'), versions: await tableExiste('client_note_versions'), audit: await tableExiste('audit_log') };
  ok(tables.audit, 'la table audit_log existe');
  ok(tables.archive, 'la table reservation_archive existe (migration 0052 appliquee)');
  ok(tables.versions, 'la table client_note_versions existe (migration 0053 appliquee)');
  await purger();

  // =========================================================================
  section('A. l instantane derive des clefs REELLES de l objet reservation');
  // =========================================================================
  if (!registre || typeof db.mapReservation !== 'function') {
    ok(false, 'lib/registre.js et database.mapReservation existent (aucun instantane derive des clefs reelles)');
  } else {
    const clefs = Object.keys(db.mapReservation({})).filter((k) => !registre.RESERVATION_VOLATILE_FIELDS.includes(k));
    ok(JSON.stringify(registre.RESERVATION_FIELDS_FALLBACK) === JSON.stringify(clefs), 'la copie de secours des clefs est EGALE aux clefs reelles de mapReservation (une colonne ajoutee la fait rougir)');
    const instantane = registre.reservationSnapshot(db.mapReservation({ id: 1, name: 'x', phone: 'y', date: '2026-01-01' }));
    const manquantes = clefs.filter((k) => !Object.prototype.hasOwnProperty.call(instantane, k));
    ok(manquantes.length === 0, `chaque clef de mapReservation est dans l instantane (${clefs.length} clefs)`, `manquantes : ${manquantes.join(', ')}`);
    for (const identite of ['name', 'phone', 'email', 'notes', 'price', 'status', 'paymentMethod', 'program', 'lanes', 'opsPlan']) {
      ok(clefs.includes(identite) && Object.prototype.hasOwnProperty.call(instantane, identite), `le champ ${identite} est journalise`);
    }
    // Contre-epreuve : la liste FIGEE d origin/main, passee au meme controle.
    const listeMain = ['price', 'program', 'basePrice', 'date', 'startTime', 'duration', 'totalDuration', 'pax', 'lanes', 'status', 'validationStatus', 'formuleId', 'paymentMethod', 'occasion', 'extras', 'clientName', 'email'];
    const oublies = clefs.filter((k) => !listeMain.includes(k));
    ok(oublies.includes('name') && oublies.includes('phone') && oublies.includes('notes'),
      `contre-epreuve : la liste figee d origin/main AURAIT ROUGI ici (elle oubliait ${oublies.join(', ')})`);
  }

  // =========================================================================
  section('B. creer au comptoir : l acteur, le nom, le telephone, la note');
  // =========================================================================
  const dossier = {
    centerId: CENTRE, date: DATE, startTime: '14:00', type: 'bowling', pax: 4, duration: 1, lanes: [1],
    name: `${PREFIX} Dupont`, phone: TEL_NOTE, email: 'registre-qa@example.com', notes: 'Allergie arachides. Gateau a 16h.',
  };
  const creation = await appeler(staffReservations, 'POST', '/api/staff-reservations', dossier);
  ok(creation.status === 201, `POST staff cree la reservation (${creation.status})`, JSON.stringify(creation.json).slice(0, 300));
  const idStaff = creation.json.reservation && creation.json.reservation.id;
  {
    const ligne = idStaff ? await derniereLigne('createReservation', idStaff, 'api/staff-reservations.js') : null;
    ok(Boolean(ligne), 'une ligne d audit createReservation existe');
    const c = (ligne && ligne.changes) || {};
    ok(ligne && ligne.actor_member_id === 'm-registre' && ligne.actor_kind === 'staff', `l acteur est le membre de session (${ligne && ligne.actor_member_id})`);
    ok(c.name && c.name.after === dossier.name, `le NOM du client est journalise (${c.name && c.name.after})`);
    ok(c.phone && c.phone.after === dossier.phone, `le TELEPHONE est journalise (${c.phone && c.phone.after})`);
    ok(c.email && c.email.after === dossier.email, 'l e-mail est journalise');
    ok(c.notes && c.notes.after === dossier.notes, 'la NOTE est journalisee en texte complet');
    ok(c.price && typeof c.price.after === 'number' && c.status && c.lanes && c.opsPlan && c.opsPlan.after && Array.isArray(c.opsPlan.after.blocs), 'prix, statut, pistes et resume du plan sont journalises');
  }

  // =========================================================================
  section('C. modifier nom, telephone et note : l ancien et le nouveau texte');
  // =========================================================================
  const avantPatch = idStaff ? await ligneSql(idStaff) : null;
  const patch = { id: idStaff, centerId: CENTRE, name: `${PREFIX} Dupont-Martin`, phone: TEL_PATCH, notes: 'Allergie arachides. Gateau a 16h. Table pres de la fenetre, poussette.', baseUpdatedAt: avantPatch ? new Date(avantPatch.updated_at).toISOString() : undefined };
  const modif = idStaff ? await appeler(staffReservations, 'PATCH', '/api/staff-reservations', patch) : { status: 0, json: {} };
  ok(modif.status === 200, `PATCH staff modifie la reservation (${modif.status})`, JSON.stringify(modif.json).slice(0, 300));
  {
    const ligne = idStaff ? await derniereLigne('updateReservation', idStaff) : null;
    const c = (ligne && ligne.changes) || {};
    ok(Boolean(ligne), 'une ligne d audit updateReservation existe');
    ok(c.name && c.name.before === dossier.name && c.name.after === patch.name, 'nom : ancien et nouveau');
    ok(c.phone && c.phone.before === dossier.phone && c.phone.after === patch.phone, 'telephone : ancien et nouveau');
    ok(c.notes && c.notes.before === dossier.notes && c.notes.after === patch.notes, 'note : ancien et nouveau texte, en entier');
    const r = (ligne && ligne.context && ligne.context.registre) || {};
    ok(r.avant && r.avant.name === dossier.name && r.apres && r.apres.name === patch.name && r.apres.phone === patch.phone, 'le contexte porte l etat COMPLET avant et apres');
  }

  // =========================================================================
  section('D. supprimer : la ligne entiere est archivee dans la transaction');
  // =========================================================================
  const avantSuppression = idStaff ? await ligneSql(idStaff) : null;
  const suppression = idStaff ? await appeler(staffReservations, 'DELETE', '/api/staff-reservations', { id: idStaff, centerId: CENTRE, reason: 'test registre' }) : { status: 0, json: {} };
  ok(suppression.status === 200, `DELETE staff supprime la reservation (${suppression.status})`, JSON.stringify(suppression.json).slice(0, 300));
  ok(idStaff && !(await ligneSql(idStaff)), 'la ligne a quitte reservations');
  const archiveId = suppression.json.archiveId;
  ok(Number(archiveId) > 0, `la reponse porte l identifiant d archive (${archiveId})`);
  {
    const a = tables.archive && idStaff ? (await pool.query('select * from reservation_archive where reservation_id = $1 order by id desc;', [idStaff])).rows[0] : null;
    ok(Boolean(a), 'une ligne reservation_archive existe pour cette reservation');
    const payload = (a && a.payload) || {};
    const attendu = normaliserLigne(avantSuppression);
    const colonnes = Object.keys(attendu);
    const absentes = colonnes.filter((col) => !Object.prototype.hasOwnProperty.call(payload, col));
    ok(colonnes.length > 0 && absentes.length === 0, `la copie porte TOUTES les colonnes de la ligne (${colonnes.length})`, `absentes : ${absentes.join(', ')}`);
    const differentes = colonnes.filter((col) => JSON.stringify(payload[col]) !== JSON.stringify(col === 'date' ? jourLocal(avantSuppression.date) : attendu[col]) && !['created_at', 'updated_at'].includes(col) && !(typeof attendu[col] === 'string' && typeof payload[col] === 'number' && Number(attendu[col]) === payload[col]));
    ok(payload.date === DATE, `la copie porte le jour de visite attendu (${payload.date} = ${DATE}) : aucun decalage de fuseau`);
    ok(differentes.length === 0, 'chaque valeur de la copie est celle de la ligne (nom, telephone, note, plan compris)', `differentes : ${differentes.join(', ')}`);
    ok(a && a.archived_by && a.archived_by.includes('m-registre') && a.reason === 'test registre', `qui et pourquoi sont gardes (${a && a.archived_by} / ${a && a.reason})`);
    const ligne = idStaff ? await derniereLigne('deleteReservation', idStaff) : null;
    const c = (ligne && ligne.changes) || {};
    ok(c.name && c.name.before === patch.name && c.phone && c.phone.before === patch.phone && c.notes && c.notes.before === patch.notes, 'la ligne d audit de suppression porte le dossier entier (nom, telephone, note)');
    ok(ligne && ligne.context && Number(ligne.context.archiveId) === Number(archiveId), 'la ligne d audit pointe la copie d archive');
  }

  // =========================================================================
  section('E. restaurer : une ligne identique, les refus clairs, le droit');
  // =========================================================================
  permissionsDemandees.length = 0;
  const restauration = archiveId ? await appeler(ops, 'POST', '/api/ops?action=restoreReservation', { action: 'restoreReservation', centerId: CENTRE, archiveId }) : { status: 0, json: {} };
  ok(restauration.status === 200 && restauration.json.ok, `POST ops restoreReservation (${restauration.status})`, JSON.stringify(restauration.json).slice(0, 300));
  ok(permissionsDemandees.includes('reservations.cancel') && ops.getRequiredOpsPermission('POST', 'restoreReservation') === 'reservations.cancel', 'restaurer demande le droit de supprimer (reservations.cancel)');
  {
    const apres = idStaff ? await ligneSql(idStaff) : null;
    ok(Boolean(apres), `la reservation n° ${idStaff} est revenue avec son identifiant d origine`);
    const a = normaliserLigne(avantSuppression);
    const b = normaliserLigne(apres);
    const diff = Object.keys(a).filter((col) => JSON.stringify(a[col]) !== JSON.stringify(b[col]));
    ok(diff.length === 0 && Object.keys(a).length === Object.keys(b).length, 'la ligne restauree est IDENTIQUE, colonne par colonne (horodatages compris)', `differentes : ${diff.join(', ')}`);
    const ligne = idStaff ? await derniereLigne('restoreReservation', idStaff) : null;
    ok(ligne && ligne.actor_member_id === 'm-registre' && ligne.entity_type === 'reservation' && ligne.changes && ligne.changes.name && ligne.changes.name.after === patch.name && Number(ligne.context.archiveId) === Number(archiveId), 'la restauration est journalisee avec l acteur, l entite et le dossier entier');
    const encore = archiveId ? await appeler(ops, 'POST', '/api/ops?action=restoreReservation', { action: 'restoreReservation', centerId: CENTRE, archiveId }) : { status: 0, json: {} };
    ok(encore.status === 409 && /déjà été restaurée/.test(encore.json.message || ''), `une deuxieme restauration est refusee en clair (${encore.status} : ${encore.json.message})`);
    // L identifiant deja repris : une archive non restauree alors que la ligne existe.
    if (archiveId) await pool.query('update reservation_archive set restored_at = null where id = $1;', [archiveId]);
    const repris = archiveId ? await appeler(ops, 'POST', '/api/ops?action=restoreReservation', { action: 'restoreReservation', centerId: CENTRE, archiveId }) : { status: 0, json: {} };
    ok(repris.status === 409 && /existe déjà/.test(repris.json.message || ''), `un identifiant deja repris est refuse en clair (${repris.status} : ${repris.json.message})`);
    if (archiveId) await pool.query('update reservation_archive set restored_at = now() where id = $1;', [archiveId]);
    // Un autre centre ne voit pas cette archive.
    const ailleurs = archiveId ? await appeler(ops, 'POST', '/api/ops?action=restoreReservation', { action: 'restoreReservation', centerId: 'gembloux', archiveId }) : { status: 0, json: {} };
    ok(ailleurs.status === 404, `l archive d un autre centre est introuvable (${ailleurs.status})`);
    permissionsDemandees.length = 0;
    const liste = await appeler(ops, 'GET', `/api/ops?action=reservationArchive&centerId=${CENTRE}&from=${DATE}&to=${DATE}`);
    const archives = (liste.json && liste.json.archives) || [];
    const trouvee = archives.find((item) => Number(item.id) === Number(archiveId));
    ok(liste.status === 200 && Boolean(trouvee), `la liste des archives du centre rend la suppression (${archives.length} ligne(s))`);
    ok(trouvee && trouvee.reservation && trouvee.reservation.name === patch.name && trouvee.reservation.notes === patch.notes && Boolean(trouvee.restoredAt), 'la liste porte le dossier complet et sa restauration');
    ok(permissionsDemandees.includes('reservations.cancel') && ops.getRequiredOpsPermission('GET', 'reservationArchive') === 'reservations.cancel', 'lire les archives demande le droit de supprimer');
  }

  // =========================================================================
  section('F. une reservation en ligne est journalisee, signee par le client');
  // =========================================================================
  const enLigne = { centerId: CENTRE, date: DATE, startTime: '16:00', type: 'bowling', pax: 4, duration: 1, name: `${PREFIX} Client`, phone: '0470 55 66 77', email: 'registre-qa-client@example.com', notes: 'Anniversaire de Lea, 8 ans.' };
  const publique = await appeler(publicReservations, 'POST', '/api/public-reservations', enLigne);
  ok(publique.status === 201, `POST public cree la reservation (${publique.status})`, JSON.stringify(publique.json).slice(0, 300));
  const idPublic = publique.json.reservation && publique.json.reservation.id;
  {
    const ligne = idPublic ? await derniereLigne('createReservation', idPublic, 'api/public-reservations.js') : null;
    const c = (ligne && ligne.changes) || {};
    ok(Boolean(ligne), 'une ligne d audit existe pour la reservation en ligne');
    ok(ligne && ligne.actor_kind === 'public' && ligne.actor_label === 'client (formulaire public)', `l auteur est « client (formulaire public) » (${ligne && ligne.actor_label})`);
    ok(c.name && c.name.after === enLigne.name && c.phone && c.phone.after === enLigne.phone && c.email && c.email.after === enLigne.email && c.notes && c.notes.after === enLigne.notes, 'nom, telephone, e-mail et note du client sont journalises');
  }

  // =========================================================================
  section('G. une demande sur mesure : creation (client) et suivis (staff)');
  // =========================================================================
  const demande = { kind: 'custom-request', centerId: CENTRE, contactName: `${PREFIX} Entreprise`, company: 'Registre SA', email: 'registre-qa-entreprise@example.com', phone: '0470 12 34 56', requestedDate: 'un samedi de novembre', pax: 40, occasion: 'entreprise', message: 'Team building de 40 personnes, bowling puis repas.' };
  const creeDemande = await appeler(bookingMeta, 'POST', '/api/public-booking-meta', demande);
  ok(creeDemande.status === 201, `POST demande sur mesure (${creeDemande.status})`, JSON.stringify(creeDemande.json).slice(0, 300));
  const idDemande = creeDemande.json.id;
  {
    const ligne = idDemande ? await derniereLigne('createCustomRequest', idDemande) : null;
    const c = (ligne && ligne.changes) || {};
    ok(ligne && ligne.actor_kind === 'public' && ligne.actor_label === 'client (formulaire public)' && ligne.entity_type === 'custom_request', 'la creation est journalisee, signee par le client');
    ok(c.contactName && c.contactName.after === demande.contactName && c.email && c.email.after === demande.email && c.phone && c.phone.after === demande.phone && c.message && c.message.after === demande.message && c.company && c.company.after === demande.company, 'contact, e-mail, telephone, organisation et message sont journalises');
    const statut = idDemande ? await appeler(ops, 'POST', '/api/ops?action=customRequestStatus', { action: 'customRequestStatus', centerId: CENTRE, id: idDemande, status: 'in_progress' }) : { status: 0, json: {} };
    ok(statut.status === 200, `POST ops customRequestStatus (${statut.status})`, JSON.stringify(statut.json).slice(0, 200));
    const ls = idDemande ? await derniereLigne('customRequestStatus', idDemande) : null;
    const cs = (ls && ls.changes) || {};
    ok(ls && ls.actor_member_id === 'm-registre' && ls.entity_type === 'custom_request', 'le changement de statut est journalise avec le membre du staff');
    ok(cs.status && cs.status.before === 'new' && cs.status.after === 'in_progress', `statut : avant ${cs.status && cs.status.before}, apres ${cs.status && cs.status.after}`);
    ok(cs.suivi && cs.suivi.after && Array.isArray(cs.suivi.after.evenements) && cs.suivi.after.evenements[0].type === 'prise-en-charge', 'le suivi ajoute (prise en charge) est journalise');
    const note = idDemande ? await appeler(ops, 'POST', '/api/ops?action=customRequestNote', { action: 'customRequestNote', centerId: CENTRE, id: idDemande, texte: 'Rappeler le directeur mardi.' }) : { status: 0, json: {} };
    ok(note.status === 200, `POST ops customRequestNote (${note.status})`);
    const ln = idDemande ? await derniereLigne('customRequestNote', idDemande) : null;
    const cn = (ln && ln.changes) || {};
    ok(cn.suivi && cn.suivi.after && Array.isArray(cn.suivi.after.notes) && cn.suivi.after.notes[0].texte === 'Rappeler le directeur mardi.', 'la note d equipe est journalisee en texte complet');
  }

  // =========================================================================
  section('H. une note client editee deux fois : les versions se relisent');
  // =========================================================================
  if (idStaff) {
    const fiche = await appeler(staffNotes, 'GET', `/api/staff-customer-notes?centerId=${CENTRE}&reservationId=${idStaff}`);
    const cle = fiche.json.clientKey;
    ok(fiche.status === 200 && Boolean(cle), `la fiche note du client se lit (cle ${cle ? 'presente' : 'absente'})`);
    const v1 = await appeler(staffNotes, 'PATCH', '/api/staff-customer-notes', { centerId: CENTRE, reservationId: idStaff, clientKey: cle, baseUpdatedAt: null, body: 'Version 1 : client fidele, prefere la piste 3.' });
    const v2 = v1.status === 200 ? await appeler(staffNotes, 'PATCH', '/api/staff-customer-notes', { centerId: CENTRE, reservationId: idStaff, clientKey: cle, baseUpdatedAt: v1.json.note.updatedAt, body: 'Version 2 : client fidele, prefere la piste 3, allergie arachides.' }) : { status: 0, json: {} };
    const v3 = v2.status === 200 ? await appeler(staffNotes, 'PATCH', '/api/staff-customer-notes', { centerId: CENTRE, reservationId: idStaff, clientKey: cle, baseUpdatedAt: v2.json.note.updatedAt, body: 'Version 3 : texte efface par erreur.' }) : { status: 0, json: {} };
    ok(v1.status === 200 && v2.status === 200 && v3.status === 200, `trois enregistrements successifs (${v1.status}, ${v2.status}, ${v3.status})`, JSON.stringify(v1.json).slice(0, 200));
    const historique = await appeler(staffNotes, 'GET', `/api/staff-customer-notes?centerId=${CENTRE}&reservationId=${idStaff}&versions=1`);
    const versions = (historique.json && historique.json.versions) || [];
    const corps = versions.map((v) => v.body);
    ok(historique.status === 200 && versions.length === 3, `l historique rend les trois versions (${versions.length})`);
    ok(corps.includes('Version 1 : client fidele, prefere la piste 3.') && corps.includes('Version 2 : client fidele, prefere la piste 3, allergie arachides.'), 'les DEUX versions precedentes se relisent en texte complet');
    ok(corps[0] === 'Version 3 : texte efface par erreur.' && versions[0].updatedBy === SESSION.member.name, 'la version courante est la premiere, avec son auteur');
    const la = await derniereLigne('saveCustomerNote', idStaff);
    ok(la && la.context && Number(la.context.versionId) === Number(versions[0].id), 'la ligne d audit pointe la version ecrite');
  } else {
    ok(false, 'section H sautee : pas de reservation staff');
  }

  // =========================================================================
  section('I. un dossier hors norme : l identite n est jamais tronquee');
  // =========================================================================
  if (idStaff && registre && typeof db.mapReservation === 'function') {
    const courant = await ligneSql(idStaff);
    const enorme = `${'Consigne longue. '.repeat(700)}FIN-DE-NOTE`;
    const modifEnorme = await appeler(staffReservations, 'PATCH', '/api/staff-reservations', { id: idStaff, centerId: CENTRE, notes: enorme, baseUpdatedAt: new Date(courant.updated_at).toISOString() });
    ok(modifEnorme.status === 200, `PATCH avec une note de ${enorme.length} caracteres (${modifEnorme.status})`, JSON.stringify(modifEnorme.json).slice(0, 200));
    const ligne = await derniereLigne('updateReservation', idStaff);
    const c = (ligne && ligne.changes) || {};
    ok(c.notes && c.notes.after === enorme, `la note est journalisee en entier (${c.notes && c.notes.after ? c.notes.after.length : 0} caracteres, pas de [tronque)`);
    // Au niveau du module : identite + un champ de plusieurs centaines de Ko.
    const base = db.mapReservation(await ligneSql(idStaff));
    const extras = Array.from({ length: 150 }, (_, i) => ({ id: `extra-${i}`, label: 'x'.repeat(3000) }));
    const gros = { ...base, notes: enorme, extras, opsPlan: { ...(base.opsPlan || {}), resourceBlocks: Array.from({ length: 500 }, (_, i) => ({ activityId: 'bowling', resourceType: 'bowling_lane', startTime: '14:00', endTime: '15:00', lanes: [1], players: 4, bruit: 'y'.repeat(500), i })) } };
    const changes = registre.reservationChanges({}, gros);
    const brut = Buffer.byteLength(JSON.stringify(changes), 'utf8');
    const ecrit = await audit.writeAuditLog({ centerId: CENTRE, actorKind: 'staff', actorMemberId: 'm-registre', actorLabel: `${PREFIX} Direction`, surface: 'scripts/registre-check.js', action: 'registreHorsNorme', method: 'TEST', entityType: 'reservation', entityId: idStaff, outcome: 'success', changes, context: { taille: brut } });
    const r = ecrit.id ? (await pool.query('select changes from audit_log where id = $1;', [ecrit.id])).rows[0] : null;
    const ch = (r && r.changes) || {};
    ok(brut > audit.MAX_JSON_BYTES, `le diff brut depasse le plafond (${brut} octets > ${audit.MAX_JSON_BYTES})`);
    ok(ch.name && ch.name.after === base.name && ch.phone && ch.phone.after === base.phone && ch.email && ch.email.after === base.email, 'nom, telephone et e-mail sont intacts');
    ok(ch.notes && ch.notes.after === enorme, 'la note est intacte, en entier');
    ok(ch._tronque === true && Array.isArray(ch._champsTronques) && ch._champsTronques.includes('extras') && !ch._champsTronques.some((k) => ['name', 'phone', 'email', 'notes'].includes(k)), `la troncature est dite et ne touche que le surplus (${(ch._champsTronques || []).join(', ')})`);
    ok(ch.opsPlan && ch.opsPlan.after && ch.opsPlan.after.nbBlocs === 500 && ch.opsPlan.after.blocs.length === 60, 'le plan est resume (60 blocs gardes, le compte reel est dit)');
    ok(Buffer.byteLength(JSON.stringify(ch), 'utf8') <= audit.MAX_JSON_BYTES + 2048, 'la ligne ecrite tient sous le plafond');
  } else {
    ok(false, 'section I sautee : pas de reservation staff ou pas de registre');
  }

  // =========================================================================
  section('J. le journal tombe en panne : la reservation est gardee, la perte crie');
  // =========================================================================
  {
    const queryReelle = pool.query.bind(pool);
    let pannes = 0;
    pool.query = (text, params, cb) => {
      if (/insert into audit_log/i.test(String(text && text.text ? text.text : text))) { pannes += 1; return Promise.reject(new Error('audit_log indisponible (simule)')); }
      return queryReelle(text, params, cb);
    };
    const erreurs = [];
    const consoleError = console.error;
    console.error = (...args) => { erreurs.push(args.map(String).join(' ')); };
    let panne;
    try {
      panne = await appeler(staffReservations, 'POST', '/api/staff-reservations', { ...dossier, startTime: '18:00', lanes: [2], name: `${PREFIX} Panne journal` });
    } finally {
      pool.query = queryReelle;
      console.error = consoleError;
    }
    const idPanne = panne.json.reservation && panne.json.reservation.id;
    ok(panne.status === 201 && Boolean(idPanne), `la reservation est quand meme creee (${panne.status})`, JSON.stringify(panne.json).slice(0, 200));
    ok(pannes >= 1 && idPanne && Boolean(await ligneSql(idPanne)), 'la ligne est bien en base alors que le journal a echoue');
    ok(erreurs.some((e) => e.includes('[registre] TRACE PERDUE')), 'la perte est criee avec le prefixe [registre]');
    ok((panne.json.warnings || []).some((w) => w && w.code === 'audit_write_failed'), 'la reponse porte l avertissement audit_write_failed');
    const ev = idPanne ? (await pool.query("select * from ops_events where center_id = $1 and event_type = 'audit_write_failed' and payload->>'entityId' = $2 order by id desc;", [CENTRE, String(idPanne)])).rows[0] : null;
    ok(Boolean(ev) && ev.payload.action === 'createReservation' && ev.payload.actorMemberId === 'm-registre', 'une ligne ops_events audit_write_failed garde la trace du manque (action, entite, acteur)');
  }

  // =========================================================================
  section('K. la copie d archive tombe en panne : la suppression est REFUSEE');
  // =========================================================================
  if (idStaff) {
    // pg appelle pool.connect avec un rappel depuis pool.query : le remplacant
    // honore les deux formes, sinon toute requete hors transaction attend sans fin.
    const connectReel = pool.connect.bind(pool);
    const habiller = (client) => {
      const q = client.query.bind(client);
      client.query = (text, params, cb) => {
        if (/insert into reservation_archive/i.test(String(text))) return Promise.reject(new Error('reservation_archive indisponible (simule)'));
        return q(text, params, cb);
      };
      return client;
    };
    pool.connect = (cb) => {
      const promesse = connectReel().then(habiller);
      if (typeof cb === 'function') { promesse.then((client) => cb(null, client, client.release), (error) => cb(error)); return undefined; }
      return promesse;
    };
    const erreurs = [];
    const consoleError = console.error;
    console.error = (...args) => { erreurs.push(args.map(String).join(' ')); };
    let refus;
    try {
      refus = await appeler(staffReservations, 'DELETE', '/api/staff-reservations', { id: idStaff, centerId: CENTRE });
    } finally {
      pool.connect = connectReel;
      console.error = consoleError;
    }
    ok(refus.status === 503 && /Suppression refusée/.test(refus.json.message || ''), `la suppression est refusee en clair (${refus.status} : ${refus.json.message})`);
    ok(Boolean(await ligneSql(idStaff)), 'la reservation est toujours la');
    const nb = (await pool.query('select count(*)::int as n from reservation_archive where reservation_id = $1 and restored_at is null;', [idStaff])).rows[0].n;
    ok(nb === 0, 'aucune copie d archive fantome');
    ok(erreurs.some((e) => e.includes('[registre] ARCHIVE IMPOSSIBLE')), 'le refus est crie avec le prefixe [registre]');
    const dl = await lignesAudit("action = 'deleteReservation' and entity_id = $1", [String(idStaff)]);
    ok(dl.length === 1, 'aucune ligne d audit de suppression n est ecrite pour un refus (seule celle de D existe)');
  } else {
    ok(false, 'section K sautee : pas de reservation staff');
  }

  // =========================================================================
  section('L. le cablage statique');
  // =========================================================================
  {
    const runner = lire('scripts/run-db-migrations.js');
    ok(/id: '0052_reservation_archive'/.test(runner) && /database\/reservation-archive-schema\.sql/.test(runner), 'la migration 0052 est enregistree');
    ok(/id: '0053_client_note_versions'/.test(runner) && /database\/client-note-versions-schema\.sql/.test(runner), 'la migration 0053 est enregistree');
    ok(fs.existsSync(path.join(ROOT, 'database/rollbacks/0052_reservation_archive.down.sql')) && fs.existsSync(path.join(ROOT, 'database/rollbacks/0053_client_note_versions.down.sql')), 'les deux rollbacks existent');
    const rls = lire('database/rls-tenant-isolation.sql');
    ok(/'reservation_archive'/.test(rls) && /'client_note_versions'/.test(rls), 'les deux tables sont dans le modele d isolation RLS');
    const worker = lire('workers/ops-worker.js');
    const idx = worker.indexOf('const OPS_LOG_TABLES');
    const tableau = worker.slice(idx, worker.indexOf(']', idx));
    ok(!/reservation_archive|client_note_versions/.test(tableau), 'aucune des deux tables n est purgee par le worker');
    const pkg = JSON.parse(lire('package.json'));
    ok(pkg.scripts['test:registre'] === 'node scripts/registre-check.js', 'npm run test:registre existe');
    ok(/npm run test:registre/.test(pkg.scripts['test:ops:all'] || ''), 'test:registre est dans test:ops:all');
    const dbSource = lire('lib/database.js');
    const idxDelete = dbSource.indexOf('async function deleteReservation');
    const corps = dbSource.slice(idxDelete, dbSource.indexOf('\n}\n', idxDelete));
    ok(/archiverReservation\(client/.test(corps) && corps.indexOf('archiverReservation(client') < corps.indexOf('delete from reservations'), 'deleteReservation archive AVANT de supprimer, dans la meme transaction');
    const notes = lire('lib/customer-notes.js');
    ok(/insert into client_note_versions/.test(notes) && notes.indexOf('insert into client_note_versions') < notes.indexOf("await client.query('commit')"), 'saveCustomerNote ecrit la version avant le commit');
    ok(/ACTEUR_FORMULAIRE_PUBLIC/.test(lire('api/public-reservations.js')) && /ACTEUR_FORMULAIRE_PUBLIC/.test(lire('api/public-booking-meta.js')), 'les deux surfaces publiques signent « client (formulaire public) »');
  }

  await purger();
  await pool.end();
  if (failures) {
    console.error(`\nregistre-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\nregistre-check: ALL OK');
})().catch(async (error) => {
  console.error('registre-check: exception', error);
  try { await pool.end(); } catch (e) { /* deja ferme */ }
  process.exit(1);
});

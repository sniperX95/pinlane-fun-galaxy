const { getPool } = require('./database');
const { normalizeClientKey } = require('./ops-communications');

function fail(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, expose: true, ...extra });
}

// Keep the CRM's existing identity and table. A name never identifies a customer.
function customerKey(reservation = {}) {
  const phone = String(reservation.phone || '').replace(/[^\d+]/g, '');
  const email = String(reservation.email || '').trim().toLowerCase();
  if (/^\+?\d{8,15}$/.test(phone)) return normalizeClientKey({ phone });
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254) return normalizeClientKey({ email });
  return '';
}

function validateAddress(centerId, reservationId) {
  if (typeof centerId !== 'string' || !centerId.trim() || centerId === 'all' || centerId.length > 100) throw fail('Centre requis.', 422);
  if (!Number.isSafeInteger(Number(reservationId)) || Number(reservationId) <= 0) throw fail('Réservation requise.', 422);
}

function phoneAliases(clientKey) {
  let national = '';
  if (/^04\d{8}$/.test(clientKey)) national = clientKey.slice(1);
  else if (/^\+324\d{8}$/.test(clientKey)) national = clientKey.slice(3);
  else if (/^00324\d{8}$/.test(clientKey)) national = clientKey.slice(4);
  return national ? ['+32' + national, '0' + national, '0032' + national] : [clientKey];
}

function resolvedNote(clientKey, rows) {
  const selected = phoneAliases(clientKey).flatMap((k) => rows.filter((r) => r.client_key === k));
  const nonempty = selected.filter((row) => String(row.body || '').trim());
  if (new Set(nonempty.map((row) => String(row.body).trim())).size > 1) return { eligible: false, clientKey, note: null, conflict: true, message: 'Plusieurs notes différentes existent pour les formats de ce téléphone. Vérifie les fiches client avant de modifier.' };
  const row = nonempty[0] || selected[0];
  return { eligible: true, clientKey: row?.client_key || phoneAliases(clientKey)[0], note: noteFromRow(row) };
}

function noteFromRow(row) {
  return row ? { body: row.body || '', updatedAt: String(row.version), updatedBy: row.updated_by || '' } : null;
}

async function reservationIdentity(db, centerId, reservationId, lock = false) {
  const result = await db.query(`select id, phone, email from reservations where id = $1 and center_id = $2${lock ? ' for share' : ''};`, [Number(reservationId), centerId]);
  if (!result.rows.length) throw fail('Réservation introuvable dans ce centre.', 404);
  return customerKey(result.rows[0]);
}

async function readNote(db, centerId, clientKey, lock = false) {
  const result = await db.query(`select body, updated_at::text as version, updated_by from client_notes where center_id = $1 and client_key = $2${lock ? ' for update' : ''};`, [centerId, clientKey]);
  return noteFromRow(result.rows[0]);
}

async function getCustomerNotes({ centerId, reservationIds }, pool = getPool()) {
  if (!Array.isArray(reservationIds) || !reservationIds.length || reservationIds.length > 200) throw fail('Choisis entre 1 et 200 réservations.', 422);
  reservationIds.forEach((id) => validateAddress(centerId, id));
  const ids = [...new Set(reservationIds.map(Number))];
  const reservations = await pool.query('select id, phone, email from reservations where center_id = $1 and id = any($2::bigint[]);', [centerId, ids]);
  const keys = [...new Set(reservations.rows.map(customerKey).filter(Boolean).flatMap(phoneAliases))];
  const notes = keys.length ? await pool.query('select client_key, body, updated_at::text as version, updated_by from client_notes where center_id = $1 and client_key = any($2::text[]);', [centerId, keys]) : { rows: [] };
  return { notesByReservationId: Object.fromEntries(reservations.rows.map((row) => {
    const clientKey = customerKey(row);
    return [String(row.id), clientKey ? resolvedNote(clientKey, notes.rows) : { eligible: false, clientKey, note: null }];
  })) };
}

async function getCustomerNote({ centerId, reservationId }, pool = getPool()) {
  validateAddress(centerId, reservationId);
  const clientKey = await reservationIdentity(pool, centerId, reservationId);
  if (!clientKey) return { eligible: false, clientKey, note: null };
  const result = await pool.query('select client_key, body, updated_at::text as version, updated_by from client_notes where center_id = $1 and client_key = any($2::text[]);', [centerId, phoneAliases(clientKey)]);
  return resolvedNote(clientKey, result.rows);
}

async function saveCustomerNote(input, pool = getPool(), resolveKey = null) {
  const { centerId, reservationId, clientKey, baseUpdatedAt, body, updatedBy = '' } = input;
  validateAddress(centerId, reservationId);
  if (typeof body !== 'string' || body.length > 4000) throw fail('La note doit contenir au maximum 4 000 caractères.', 422);
  if (!Object.prototype.hasOwnProperty.call(input, 'baseUpdatedAt') || (baseUpdatedAt !== null && (typeof baseUpdatedAt !== 'string' || !Number.isFinite(Date.parse(baseUpdatedAt))))) throw fail('Version de la note requise.', 422);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const savedKey = resolveKey ? resolveKey() : await reservationIdentity(client, centerId, reservationId, true);
    if (!savedKey) throw fail('Ajoute un téléphone ou un e-mail valide au client avant de garder une note.', 422);
    const aliases = phoneAliases(savedKey);
    if (!aliases.includes(clientKey)) throw fail('Les coordonnées du client ont changé. Recharge sa note.', 409);
    // Locks even initial creation, when no row exists yet. No contact in logs.
    await client.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2));', [centerId, aliases[0]]);
    const existing = await client.query('select client_key, body, updated_at::text as version, updated_by from client_notes where center_id = $1 and client_key = any($2::text[]) for update;', [centerId, aliases]);
    const resolved = resolvedNote(savedKey, existing.rows);
    if (resolved.conflict) throw fail(resolved.message, 409, { conflict: true });
    if (resolved.clientKey !== clientKey) throw fail('La fiche client a changé. Recharge sa note.', 409);
    const current = resolved.note;
    if ((current?.updatedAt || null) !== baseUpdatedAt) throw fail('Cette note a été modifiée par un autre membre. Recharge-la avant de modifier.', 409, { note: current });
    const result = await client.query(`insert into client_notes (center_id, client_key, body, updated_at, updated_by)
      values ($1, $2, $3, clock_timestamp(), $4)
      on conflict (center_id, client_key) do update set body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by
      where client_notes.updated_at::text is not distinct from $5::text
      returning body, updated_at::text as version, updated_by;`, [centerId, clientKey, body.replace(/\r\n?/g, '\n').trim(), String(updatedBy).slice(0, 80), baseUpdatedAt]);
    if (!result.rows.length) throw fail('Cette note a été modifiée par un autre membre. Recharge-la avant de modifier.', 409, { note: await readNote(client, centerId, clientKey) });
    if (existing.rows.length > 1) await client.query('update client_notes set body = $3, updated_at = $4::timestamptz, updated_by = $5 where center_id = $1 and client_key = any($2::text[]);', [centerId, aliases, result.rows[0].body, result.rows[0].version, result.rows[0].updated_by]);
    await client.query('commit');
    return { eligible: true, clientKey, note: noteFromRow(result.rows[0]) };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally { client.release(); }
}

// CRM uses the same memory and optimistic writer, without inventing a reservation.
async function saveCustomerNoteForKey(input, pool = getPool()) {
  const safeKey = customerKey({ phone: input.clientKey, email: input.clientKey });
  if (!safeKey) throw fail('Coordonnées client invalides.', 422);
  validateAddress(input.centerId, 1);
  const existing = await pool.query('select client_key, body, updated_at::text as version, updated_by from client_notes where center_id = $1 and client_key = any($2::text[]);', [input.centerId, phoneAliases(safeKey)]);
  const resolved = resolvedNote(safeKey, existing.rows);
  if (resolved.conflict) throw fail(resolved.message, 409);
  return saveCustomerNote({ ...input, reservationId: 1, clientKey: resolved.clientKey }, pool, () => safeKey);
}

module.exports = { getCustomerNote, getCustomerNotes, saveCustomerNote, saveCustomerNoteForKey, customerKey, phoneAliases, resolvedNote };

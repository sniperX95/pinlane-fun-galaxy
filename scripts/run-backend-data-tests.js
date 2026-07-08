const assert = require('assert');
const Module = require('module');
const { getSchedule, parseLocalDate, todayStr } = require('../lib/booking-config');
const { planningAgent } = require('../lib/ops-agents');
const { normalizeReservationRequest } = require('../lib/reservation-request');

const originalLoad = Module._load;

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function findFutureOpenDate() {
  for (let offset = 1; offset <= 370; offset += 1) {
    const date = addDays(todayStr(), offset);
    if (getSchedule(date)) return date;
  }
  throw new Error('Aucune date ouverte future trouvee pour les tests backend data.');
}

function reservationRow(overrides = {}) {
  return {
    id: overrides.id || 1,
    center_id: overrides.centerId || 'libramont',
    channel: overrides.channel || 'staff',
    name: overrides.name || 'Client test',
    phone: overrides.phone || '0470000000',
    email: overrides.email || 'client@example.test',
    date: overrides.date,
    start_time: overrides.startTime || '14:00',
    duration: overrides.duration || 1,
    total_duration: overrides.totalDuration || overrides.duration || 1,
    lanes: overrides.lanes || [1],
    pax: overrides.pax || 6,
    status: overrides.status || 'pending',
    base_price: overrides.basePrice || 0,
    price: overrides.price || 0,
    type: overrides.type || 'bowling',
    formule_id: overrides.formuleId || '',
    label: overrides.label || 'Bowling Classique',
    extras: overrides.extras || [],
    payment_method: overrides.paymentMethod || '',
    notes: overrides.notes || '',
    ops_plan: overrides.opsPlan || null,
    risk_level: overrides.riskLevel || '',
    risk_score: overrides.riskScore ?? null,
    validation_status: overrides.validationStatus || 'confirmed',
    created_at: overrides.createdAt || new Date('2026-01-01T10:00:00Z'),
    updated_at: overrides.updatedAt || new Date('2026-01-01T10:00:00Z'),
  };
}

function makeFakePg({ reservations = [], laneStatuses = [] } = {}) {
  const state = {
    queries: [],
    reservations,
    laneStatuses,
    released: false,
  };
  let client;

  class FakePool {
    async query(sql, params = []) {
      state.queries.push({ target: 'pool', sql: String(sql), params });
      return { rows: [], rowCount: 0 };
    }

    async connect() {
      return client;
    }
  }

  client = {
    async query(sql, params = []) {
      const text = String(sql);
      state.queries.push({ target: 'client', sql: text, params });

      if (/from\s+reservations/i.test(text) && /where\s+date\s*=\s*\$1/i.test(text)) {
        const filtersCancelled = /status\s*<>\s*'cancelled'/i.test(text);
        const requestedDate = params[0];
        const requestedCenter = params[1];
        const rows = filtersCancelled
          ? state.reservations.filter((reservation) =>
            reservation.status !== 'cancelled'
            && (!requestedDate || reservation.date === requestedDate)
            && (!requestedCenter || reservation.center_id === requestedCenter))
          : state.reservations.filter((reservation) =>
            (!requestedDate || reservation.date === requestedDate)
            && (!requestedCenter || reservation.center_id === requestedCenter));
        return { rows, rowCount: rows.length };
      }

      if (/update\s+reservations/i.test(text) && /start_time\s*=\s*\$2/i.test(text) && params.length === 5) {
        const row = state.reservations.find((reservation) => Number(reservation.id) === Number(params[0]));
        if (!row) return { rows: [], rowCount: 0 };
        row.start_time = params[1];
        row.lanes = params[2];
        row.ops_plan = params[3] ? JSON.parse(params[3]) : null;
        row.notes = params[4];
        row.updated_at = new Date();
        return { rows: [row], rowCount: 1 };
      }

      if (/from\s+lane_statuses/i.test(text)) {
        const requestedCenter = params[0];
        const rows = state.laneStatuses.filter((laneStatus) =>
          !requestedCenter || laneStatus.center_id === requestedCenter);
        return { rows, rowCount: rows.length };
      }

      return { rows: [], rowCount: 0 };
    },

    release() {
      state.released = true;
    },
  };

  return {
    state,
    pg: { Pool: FakePool },
  };
}

async function withFakeDatabase(options, run) {
  const fake = makeFakePg(options);
  const databasePath = require.resolve('../lib/database');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousDatabaseSsl = process.env.DATABASE_SSL;

  Module._load = function load(request, parent, isMain) {
    if (request === 'pg') return fake.pg;
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[databasePath];
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
  process.env.DATABASE_SSL = 'disable';

  try {
    const database = require('../lib/database');
    await run(database, fake.state);
  } finally {
    delete require.cache[databasePath];
    Module._load = originalLoad;
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousDatabaseSsl === undefined) {
      delete process.env.DATABASE_SSL;
    } else {
      process.env.DATABASE_SSL = previousDatabaseSsl;
    }
  }
}

function findDecisionLogDeleteQuery(state) {
  const found = state.queries.find((query) => /delete\s+from\s+ops_decision_logs/i.test(query.sql));
  assert.ok(found, 'deleteSimulationData doit supprimer les decision logs de simulation de facon ciblee');
  return found;
}

function assertStrictSimulationLogDelete(query) {
  assert.match(query.sql, /payload->>'simulation'\s*=\s*'true'/i, 'la suppression doit exiger payload.simulation=true');
  assert.match(query.sql, /coalesce\(run_id,\s*''\)\s*<>\s*''/i, 'la suppression doit exiger un run_id non vide');
  assert.doesNotMatch(
    query.sql,
    /delete\s+from\s+ops_decision_logs\s+where\s+center_id\s*=\s*\$1\s*;/i,
    'la suppression ne doit jamais etre limitee au seul centre',
  );
}

async function testSimulationResetKeepsRealDecisionLogs() {
  await withFakeDatabase({}, async (database, state) => {
    await database.deleteSimulationData({ centerId: 'libramont' });
    const query = findDecisionLogDeleteQuery(state);
    assertStrictSimulationLogDelete(query);
    assert.match(query.sql, /run_id\s+in\s*\(/i, 'un reset global doit rester borne aux runs de simulation connus');
    assert.deepStrictEqual(query.params, ['libramont']);
  });

  await withFakeDatabase({}, async (database, state) => {
    await database.deleteSimulationData({ centerId: 'libramont', runId: 'sim_libramont_20260704_123456' });
    const query = findDecisionLogDeleteQuery(state);
    assertStrictSimulationLogDelete(query);
    assert.match(query.sql, /run_id\s*=\s*\$2/i, 'un reset par run doit cibler exactement le run_id demande');
    assert.deepStrictEqual(query.params, ['libramont', 'sim_libramont_20260704_123456']);
  });
}

async function testStaffPlanningIgnoresCancelledReservations() {
  const date = findFutureOpenDate();
  const cancelledBlockers = Array.from({ length: 8 }, (_, index) => reservationRow({
    id: 100 + index,
    date,
    lanes: [index + 1],
    status: 'cancelled',
  }));

  await withFakeDatabase({ reservations: cancelledBlockers }, async (database) => {
    const snapshot = await database.readStaffState(date, 'libramont');
    assert.deepStrictEqual(snapshot.reservations, [], 'readStaffState ne doit pas exposer les reservations cancelled');

    const result = planningAgent({
      centerId: 'libramont',
      channel: 'staff',
      date,
      type: 'bowling',
      pax: 6,
      startTime: '14:00',
      duration: 1,
    }, {
      reservations: snapshot.reservations,
      laneStatuses: snapshot.laneStatuses,
    });

    assert.strictEqual(result.ok, true, 'le planning staff ne doit pas etre bloque par des reservations annulees');
    assert.strictEqual(result.plan.recommended.startTime, '14:00');
  });
}

async function testLaneStatusesAreScopedByCenter() {
  const date = findFutureOpenDate();
  await withFakeDatabase({
    laneStatuses: [
      {
        center_id: 'gembloux',
        lane_number: 3,
        status: 'maintenance',
        updated_at: new Date('2026-01-01T10:00:00Z'),
      },
      {
        center_id: 'libramont',
        lane_number: 3,
        status: 'active',
        updated_at: new Date('2026-01-01T10:00:00Z'),
      },
    ],
  }, async (database, state) => {
    const gemblouxSnapshot = await database.readStaffState(date, 'gembloux');
    assert.strictEqual(gemblouxSnapshot.laneStatuses[3], 'maintenance');

    const libramontSnapshot = await database.readStaffState(date, 'libramont');
    assert.strictEqual(libramontSnapshot.laneStatuses[3], 'active');

    const laneQueries = state.queries.filter((query) => /from\s+lane_statuses/i.test(query.sql));
    assert.ok(laneQueries.length >= 2, 'readStaffState doit lire les pistes par centre');
    for (const query of laneQueries) {
      assert.match(query.sql, /center_id\s*=\s*\$1/i, 'lane_statuses doit etre filtre par center_id');
    }
    assert.deepStrictEqual(laneQueries[0].params, ['gembloux']);
    assert.deepStrictEqual(laneQueries[1].params, ['libramont']);
  });
}

// Plan de retard : les décalages en cascade (heures + pistes + plans) partent
// dans UNE transaction et sont validés sur l'état FINAL — un update séquentiel
// échouerait sur l'état transitoire (A décalé sur le créneau que B occupe
// encore). Vérifie aussi qu'un plan périmé est refusé AVANT toute écriture.
async function testApplyReservationScheduleUpdatesIsAtomic() {
  const date = findFutureOpenDate();
  const rows = [
    reservationRow({ id: 1, name: 'Groupe Retarde', startTime: '14:00', lanes: [1], date }),
    reservationRow({ id: 2, name: 'Groupe Suivant', startTime: '15:00', lanes: [1], date }),
  ];

  await withFakeDatabase({ reservations: rows.map((row) => ({ ...row })) }, async (database, state) => {
    const updated = await database.applyReservationScheduleUpdates({
      centerId: 'libramont',
      date,
      updates: [
        { id: 1, startTime: '14:15', lanes: [1], noteAppend: 'Retard +15 min applique.' },
        { id: 2, startTime: '15:15', lanes: [1], noteAppend: 'Decale de 15 min suite retard.' },
      ],
    });

    assert.strictEqual(updated.length, 2, 'les deux reservations doivent etre mises a jour en un seul appel');
    assert.strictEqual(updated.find((item) => item.id === 1).startTime, '14:15');
    assert.strictEqual(updated.find((item) => item.id === 2).startTime, '15:15');
    assert.ok(updated.find((item) => item.id === 1).notes.includes('Retard +15 min'), 'la trace audit doit etre ajoutee aux notes');

    const queries = state.queries.map((query) => query.sql);
    const beginIndex = queries.findIndex((sql) => /^begin$/i.test(sql.trim()));
    const commitIndex = queries.findIndex((sql) => /^commit$/i.test(sql.trim()));
    const updateIndexes = state.queries
      .map((query, index) => (/update\s+reservations/i.test(query.sql) ? index : -1))
      .filter((index) => index >= 0);
    assert.ok(beginIndex >= 0 && commitIndex > beginIndex, 'les updates doivent vivre dans une transaction');
    assert.ok(updateIndexes.every((index) => index > beginIndex && index < commitIndex), 'chaque update doit etre dans la transaction');
    assert.ok(queries.some((sql) => /pg_advisory_xact_lock/i.test(sql)), 'la date doit etre verrouillee pendant l application');
  });

  // Plan périmé : la validation d'état final refuse AVANT toute écriture.
  await withFakeDatabase({ reservations: rows.map((row) => ({ ...row })) }, async (database, state) => {
    await assert.rejects(
      () => database.applyReservationScheduleUpdates({
        centerId: 'libramont',
        date,
        updates: [{ id: 1, startTime: '15:00', lanes: [1] }],
      }),
      /planning vient de changer/i,
      'un plan qui recouvre une reservation non deplacee doit etre refuse',
    );
    assert.ok(
      !state.queries.some((query) => /update\s+reservations/i.test(query.sql)),
      'aucune ecriture ne doit partir quand le plan est refuse',
    );
    assert.strictEqual(state.reservations.find((row) => Number(row.id) === 1).start_time, '14:00', 'la reservation reste intacte');
  });
}

// Chantier 3 — l'email est OBLIGATOIRE à la création (staff ET public). La
// validation vit dans normalizeReservationRequest (chemin commun POST) : un
// POST sans email valide est refusé AVANT toute écriture en base.
function testEmailRequiredOnCreation() {
  const base = {
    name: 'Client Test',
    phone: '+32470000000',
    date: '2026-07-11',
    startTime: '16:00',
    duration: 1,
    totalDuration: 1,
    type: 'bowling',
    pax: 4,
    centerId: 'libramont',
  };

  // STAFF : contact LIBRE. Le vrai POST staff (api/staff-reservations.js) appelle
  // normalizeReservationRequest SANS requireEmail => une résa staff sans email ne
  // doit PLUS être refusée (le serveur ne bloque pas).
  assert.doesNotThrow(
    () => normalizeReservationRequest({ ...base }, { channel: 'staff' }),
    'staff : un POST sans email ne doit PAS être refusé (contact libre)',
  );

  // PUBLIC (POST, requireEmail) : l'email reste OBLIGATOIRE côté client public.
  assert.throws(
    () => normalizeReservationRequest({ ...base, email: '' }, { channel: 'public', requireEmail: true }),
    (error) => /email requis/i.test(error.message) && Number(error.statusCode) === 422,
    'public : un POST sans email doit être refusé (422)',
  );

  // PUBLIC : email mal formé => rejet.
  assert.throws(
    () => normalizeReservationRequest({ ...base, email: 'pas-un-email' }, { channel: 'public', requireEmail: true }),
    (error) => /email invalide/i.test(error.message) && Number(error.statusCode) === 422,
    'public : un email mal formé doit être refusé',
  );

  // Réutilisation interne (alternatives / prep ops) : PAS de requireEmail =>
  // ne doit jamais throw sur email manquant (sinon on casserait le calcul
  // d'alternatives et la recherche de créneaux).
  assert.doesNotThrow(
    () => normalizeReservationRequest({ ...base }, { channel: 'public' }),
    'réutilisation interne sans requireEmail ne doit pas exiger l\'email',
  );

  // Un email renseigné (staff ou public) est conservé (trim) tel quel.
  const ok = normalizeReservationRequest({ ...base, email: '  Marie@Domaine.com ' }, { channel: 'staff' });
  assert.strictEqual(ok.email, 'Marie@Domaine.com', 'un email valide est conservé (trim)');
  console.log('  ok  email libre côté staff / obligatoire côté public validé serveur');
}

(async () => {
  await testSimulationResetKeepsRealDecisionLogs();
  await testStaffPlanningIgnoresCancelledReservations();
  await testLaneStatusesAreScopedByCenter();
  await testApplyReservationScheduleUpdatesIsAtomic();
  testEmailRequiredOnCreation();
  console.log('backend-data-tests-ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

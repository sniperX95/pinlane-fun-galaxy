const fs = require('fs');
const path = require('path');
const { getPool } = require('../lib/database');

const root = path.resolve(__dirname, '..');

const MIGRATIONS = [
  {
    id: '0001_core_reservations',
    file: 'database/schema.sql',
    description: 'Core reservations and lane statuses',
  },
  {
    id: '0002_ops_engine',
    file: 'database/ops-schema.sql',
    description: 'Ops engine, communications, simulations, decision logs',
  },
  {
    id: '0003_staff_access_control',
    file: 'database/staff-auth-schema.sql',
    description: 'Staff roles, members, sessions, and access events',
  },
  {
    id: '0004_communications_worker_queue',
    file: 'database/communications-worker-schema.sql',
    description: 'Worker-safe communication queue for Railway and frequent dispatch',
  },
  {
    id: '0005_ops_automation',
    file: 'database/ops-automation-schema.sql',
    description: 'Durable ops jobs, worker health, and delay incident tracking',
  },
];

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      id text primary key,
      description text not null default '',
      file_path text not null default '',
      checksum text not null default '',
      applied_at timestamptz not null default now()
    );
  `);
}

function checksum(content) {
  return require('crypto').createHash('sha256').update(content).digest('hex');
}

function readMigrationFile(migration) {
  const absoluteFile = path.join(root, migration.file);
  const sql = fs.readFileSync(absoluteFile, 'utf8');
  return {
    absoluteFile,
    sql,
    checksum: checksum(sql),
  };
}

function getMigrationPlan() {
  return MIGRATIONS.map((migration) => {
    const file = readMigrationFile(migration);
    return {
      id: migration.id,
      description: migration.description,
      file: migration.file,
      checksum: file.checksum,
    };
  });
}

async function runMigration(client, migration) {
  const file = readMigrationFile(migration);
  const sql = file.sql;
  const hash = file.checksum;
  const existing = await client.query('select id, checksum from schema_migrations where id = $1;', [migration.id]);
  if (existing.rows[0]) {
    if (existing.rows[0].checksum !== hash) {
      throw new Error(`Migration ${migration.id} a change apres application. Creer une nouvelle migration.`);
    }
    return { id: migration.id, status: 'skipped' };
  }

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'insert into schema_migrations (id, description, file_path, checksum) values ($1,$2,$3,$4);',
      [migration.id, migration.description, migration.file, hash],
    );
    await client.query('COMMIT');
    return { id: migration.id, status: 'applied' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (process.argv.includes('--plan')) {
    console.log(JSON.stringify({ ok: true, mode: 'plan', migrations: getMigrationPlan() }, null, 2));
    return;
  }

  const client = await getPool().connect();
  try {
    await ensureMigrationsTable(client);
    const results = [];
    for (const migration of MIGRATIONS) {
      results.push(await runMigration(client, migration));
    }
    console.log(JSON.stringify({ ok: true, migrations: results }, null, 2));
  } finally {
    client.release();
    await getPool().end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  MIGRATIONS,
  checksum,
  getMigrationPlan,
};

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
  {
    id: '0006_center_lane_statuses',
    file: 'database/center-lane-statuses-schema.sql',
    description: 'Scope lane statuses per center',
  },
  {
    id: '0007_pilot_leads',
    file: 'database/pilot-leads-schema.sql',
    description: 'Pilot lead capture from the marketing landing',
  },
  {
    id: '0008_tenant_integrity',
    file: 'database/tenant-integrity-schema.sql',
    description: 'Foreign keys from center_id columns to centers(id)',
  },
  {
    id: '0009_reservation_occasion',
    file: 'database/reservation-occasion-schema.sql',
    description: 'Client-declared reservation occasion (birthday, company, school, ...)',
  },
  {
    id: '0010_custom_requests',
    file: 'database/custom-requests-schema.sql',
    description: 'Custom / bespoke enquiry leads (companies, special needs)',
  },
  {
    id: '0011_staff_access_code_enc',
    file: 'database/staff-access-code-enc-schema.sql',
    description: 'Reversible AES-256-GCM encrypted staff access codes (copy without regenerating)',
  },
  {
    id: '0012_direction_reports',
    file: 'database/direction-reports-schema.sql',
    description: 'Editable weekly/monthly direction reports generated from analytics',
  },
  {
    id: '0013_email_studio',
    file: 'database/email-studio-schema.sql',
    description: 'Email studio: custom templates and sender identities per center',
  },
  {
    id: '0014_lane_maintenance_window',
    file: 'database/lane-maintenance-window-schema.sql',
    description: 'Dated maintenance windows on lanes (auto-lift outside the window)',
  },
  {
    id: '0015_campaigns',
    file: 'database/campaigns-schema.sql',
    description: 'Real email campaigns targeting CRM segments via the communications pipeline',
  },
  {
    id: '0016_activity_progress',
    file: 'database/activity-progress-schema.sql',
    description: 'Per-reservation formula activity completion tracking (survives ops replan)',
  },
  {
    id: '0017_daily_metrics',
    file: 'database/daily-metrics-schema.sql',
    description: 'Daily center metrics warehouse (visitors/revenue/weather/holidays) + marketing insights lifecycle',
  },
  {
    id: '0018_client_notes_automation',
    file: 'database/client-notes-schema.sql',
    description: 'Persistent client notes (terrain memory) + per-center automation sequence toggles',
  },
  {
    id: '0019_email_agent',
    file: 'database/email-agent-schema.sql',
    description: 'Email agent memory (staff-corrected replies) + received status for inbound emails',
  },
  {
    id: '0020_competitor_watch',
    file: 'database/competitor-watch-schema.sql',
    description: 'Competitor watch: configurable competitors + website snapshots with change detection',
  },
  {
    id: '0021_propositions',
    file: 'database/proposition-schema.sql',
    description: 'Unified propositions (Le Brief): widen kind check + payload jsonb + due_date on marketing_insights',
  },
  {
    id: '0022_marketing_patterns',
    file: 'database/marketing-patterns-schema.sql',
    description: 'Learning memory: per-context aggregated net effect of published actions (closes the marketing feedback loop)',
  },
  {
    id: '0023_competitor_intel',
    file: 'database/competitor-intel-schema.sql',
    description: 'Competitor intel: structured signals per snapshot + Google Places rating/review-count snapshot per competitor',
  },
  {
    id: '0024_llm_spend',
    file: 'database/llm-budget-schema.sql',
    description: 'LLM spend ledger (monthly USD cap): hard budget guard, falls back to deterministic at the ceiling',
  },
  {
    id: '0025_marketing_arms',
    file: 'database/marketing-arms-schema.sql',
    description: 'Angle bandit arms (Thompson sampling): per-center success/failure counts fed by measured net effect',
  },
  {
    id: '0026_marketing_dna',
    file: 'database/marketing-dna-schema.sql',
    description: 'Sector DNA (agents second brain): sourced, adversarially-verified copy rules used as PRIOR when measured patterns are thin',
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

function sha256(content) {
  return require('crypto').createHash('sha256').update(content).digest('hex');
}

// Le checksum ignore les fins de ligne.
//
// Avant : on hachait les octets bruts. Le meme fichier de migration donnait donc
// un hash different sous Windows (CRLF) et sous Linux (LF), et git convertit les
// fins de ligne tout seul au checkout (core.autocrlf). Resultat : une migration
// appliquee depuis Linux devenait « modifiee apres application » des qu'on
// rejouait le runner sous Windows, alors que le SQL etait identique au caractere
// pres. Constate le 2026-07-16 : 0011 appliquee en LF, 0007 en CRLF, plus aucun
// runner ne passait sur cette machine.
//
// Le SQL ne change pas de sens selon la fin de ligne : on normalise avant de
// hacher. L'immutabilite reste totale sur le CONTENU, qui est la seule chose
// qu'on veut proteger.
function checksum(content) {
  return sha256(String(content).replace(/\r\n/g, '\n'));
}

// Hash historique (octets bruts), uniquement pour reconnaitre les migrations
// enregistrees avant cette normalisation et re-sceller leur checksum.
function legacyChecksum(content) {
  return sha256(String(content));
}

function readMigrationFile(migration) {
  const absoluteFile = path.join(root, migration.file);
  const sql = fs.readFileSync(absoluteFile, 'utf8');
  return {
    absoluteFile,
    sql,
    checksum: checksum(sql),
    legacyChecksum: legacyChecksum(sql),
    legacyChecksumLf: legacyChecksum(String(sql).replace(/\r\n/g, '\n')),
    legacyChecksumCrLf: legacyChecksum(String(sql).replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')),
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
    const stored = existing.rows[0].checksum;
    if (stored === hash) return { id: migration.id, status: 'skipped' };
    // Enregistree avant la normalisation des fins de ligne : le SQL est le meme,
    // seul l'encodage des sauts de ligne differait. On re-scelle sur le hash
    // normalise, une fois, puis ce cas disparait pour toujours.
    const legacyMatch = [file.legacyChecksum, file.legacyChecksumLf, file.legacyChecksumCrLf].includes(stored);
    if (legacyMatch) {
      await client.query('update schema_migrations set checksum = $2 where id = $1;', [migration.id, hash]);
      return { id: migration.id, status: 'resealed' };
    }
    throw new Error(`Migration ${migration.id} a change apres application. Creer une nouvelle migration.`);
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

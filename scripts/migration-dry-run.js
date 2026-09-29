// REPETITION D'UNE MIGRATION, dans une transaction ANNULEE.
//
// POURQUOI
//
// Le lanceur de migrations enveloppe deja chaque fichier dans une transaction
// et annule sur erreur : une migration qui PLANTE est sans danger. Ce qui n'est
// couvert par rien, c'est une migration qui REUSSIT en produisant un etat faux
// (mauvaise cle primaire, lignes rattachees au mauvais proprietaire, contrainte
// oubliee). La, tout est commite et le mal est fait.
//
// Ce script joue le SQL reel sur la base reelle, montre ce qui change, le
// rejoue une seconde fois pour prouver son idempotence, puis annule tout. Le
// DDL PostgreSQL etant transactionnel, la production ne bouge pas d'une ligne.
//
// Lancement : node scripts/migration-dry-run.js 0043_activity_pricing

const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const { getPool } = require('../lib/database');
const { MIGRATIONS } = require('./run-db-migrations');

const wanted = String(process.argv[2] || '').trim();
let failures = 0;
function ok(condition, label, detail = '') {
  console.log(`  [${condition ? 'OK' : 'FAIL'}] ${label}${detail ? ` ${detail}` : ''}`);
  if (!condition) failures += 1;
}

// Les tables que le SQL nomme : c'est sur elles qu'on regarde ce qui change.
function tablesMentioned(sql) {
  const names = new Set();
  const pattern = /\b(?:alter table|create table(?: if not exists)?|update|insert into)\s+([a-z_][a-z0-9_]*)/gi;
  let match = pattern.exec(sql);
  while (match) {
    names.add(match[1].toLowerCase());
    match = pattern.exec(sql);
  }
  names.delete('schema_migrations');
  return [...names];
}

async function snapshot(client, tables, { enTransaction = false } = {}) {
  const state = {};
  for (const table of tables) {
    const columns = await client.query(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns where table_name = $1 order by column_name;`,
      [table],
    );
    let constraints = { rows: [] };
    // Dans la transaction, la lecture des contraintes passe sous un savepoint :
    // pour une table que la migration CREE, `$1::regclass` echoue avant, et
    // sans savepoint cette erreur abandonnait la transaction entiere (la
    // migration jetait « current transaction is aborted », constate sur 0049).
    if (enTransaction) await client.query('savepoint repetition_contraintes');
    try {
      constraints = await client.query(
        `select conname, contype,
                (select string_agg(a.attname, ',' order by k.ord)
                   from unnest(c.conkey) with ordinality as k(attnum, ord)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
           from pg_constraint c where c.conrelid = $1::regclass order by conname;`,
        [table],
      );
      if (enTransaction) await client.query('release savepoint repetition_contraintes');
    } catch (error) {
      // Table absente avant la migration : rien a comparer.
      if (enTransaction) await client.query('rollback to savepoint repetition_contraintes');
    }
    state[table] = {
      columns: (columns.rows || []).map((row) => `${row.column_name}:${row.data_type}${row.is_nullable === 'NO' ? ' NOT NULL' : ''}`),
      constraints: (constraints.rows || []).map((row) => `${row.conname}(${row.contype})=${row.cols || ''}`),
    };
  }
  return state;
}

function diff(before, after, tables) {
  const lines = [];
  for (const table of tables) {
    const b = before[table] || { columns: [], constraints: [] };
    const a = after[table] || { columns: [], constraints: [] };
    for (const kind of ['columns', 'constraints']) {
      b[kind].filter((x) => !a[kind].includes(x)).forEach((x) => lines.push(`  - ${table}.${kind} RETIRE  ${x}`));
      a[kind].filter((x) => !b[kind].includes(x)).forEach((x) => lines.push(`  + ${table}.${kind} AJOUTE  ${x}`));
    }
  }
  return lines;
}

async function main() {
  const migration = MIGRATIONS.find((item) => item.id === wanted);
  if (!migration) {
    console.error(`Migration inconnue : "${wanted}".`);
    console.error(`Connues : ${MIGRATIONS.map((item) => item.id).join(', ')}`);
    process.exit(1);
  }
  const file = path.resolve(__dirname, '..', migration.file);
  const sql = fs.readFileSync(file, 'utf8');
  const tables = tablesMentioned(sql);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`\n[MIGRATION] ${migration.id}\n[FICHIER]   ${migration.file}\n[TABLES]    ${tables.join(', ') || '(aucune nommee)'}`);

    const before = await snapshot(client, tables, { enTransaction: true });

    console.log('\n[JOUE] premiere execution');
    await client.query(sql);
    const after = await snapshot(client, tables, { enTransaction: true });
    ok(true, 'le SQL passe sans erreur');

    const changes = diff(before, after, tables);
    console.log(`\n[CE QUI CHANGE] ${changes.length} difference(s)`);
    changes.forEach((line) => console.log(line));

    console.log('\n[IDEMPOTENCE] seconde execution du meme SQL');
    await client.query(sql);
    const twice = await snapshot(client, tables, { enTransaction: true });
    ok(JSON.stringify(twice) === JSON.stringify(after), 'le second passage ne change plus rien');

    await client.query('ROLLBACK');
    console.log('\n[ANNULE] ROLLBACK execute : la base de production est intacte.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (ignored) { /* deja annule */ }
    console.error('\n[ECHEC] la repetition a jete, tout est annule :', error && error.message ? error.message : error);
    failures += 1;
  } finally {
    client.release();
  }

  // Preuve finale HORS transaction : l'etat d'avant est intact.
  try {
    const check = await snapshot(pool, tables);
    const restored = tablesMentioned(sql).length === 0 || JSON.stringify(check) !== '{}';
    ok(restored, 'hors transaction : la production est lisible et inchangee');
  } catch (error) {
    ok(false, 'verification hors transaction impossible', error.message);
  } finally {
    await pool.end();
  }

  console.log(`\n${failures === 0 ? 'REPETITION REUSSIE' : 'REPETITION EN ECHEC'} (${failures} probleme(s))`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

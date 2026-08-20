// REPETITION de la migration 0042, dans une transaction ANNULEE.
//
// Pourquoi : une migration qui echoue est deja sans danger (le runner
// l'enveloppe dans BEGIN/COMMIT et le DDL PostgreSQL est transactionnel). Ce
// qui n'est PAS couvert, c'est une migration qui REUSSIT en produisant un etat
// faux. Ce script joue le SQL reel sur la base reelle, VERIFIE l'etat obtenu,
// puis annule tout : aucune ligne, aucune contrainte, aucun index de production
// n'est modifie.
//
// Lancement : node scripts/migration-0042-dry-run.js

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

const MIGRATION_FILE = path.resolve(__dirname, '..', 'database', 'catalog-client-scope-schema.sql');

let failures = 0;
function ok(condition, label, detail = '') {
  if (condition) {
    console.log(`  [OK] ${label}${detail ? ` ${detail}` : ''}`);
    return;
  }
  failures += 1;
  console.log(`  [FAIL] ${label}${detail ? ` ${detail}` : ''}`);
}

const PK_QUERY = `
  select string_agg(a.attname, ',' order by k.ord) as cols
    from pg_constraint c
    join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = $1::regclass and c.contype = 'p';`;

async function main() {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('\n[AVANT] etat de production');
    const before = await client.query(
      `select count(*)::int as formulas from formulas`,
    );
    const beforeSteps = await client.query(`select count(*)::int as steps from formula_steps`);
    const beforeActivities = await client.query(`select count(*)::int as activities from activities`);
    console.log(`  formulas=${before.rows[0].formulas} formula_steps=${beforeSteps.rows[0].steps} activities=${beforeActivities.rows[0].activities}`);

    console.log('\n[JOUE] database/catalog-client-scope-schema.sql');
    await client.query(sql);
    console.log('  le SQL passe sans erreur');

    console.log('\n[APRES] verifications dans la transaction');
    const pkFormulas = (await client.query(PK_QUERY, ['formulas'])).rows[0].cols;
    ok(pkFormulas === 'id,owner_client_id', 'cle primaire formulas', `= ${pkFormulas}`);

    const pkActivities = (await client.query(PK_QUERY, ['activities'])).rows[0].cols;
    ok(pkActivities === 'id,center_id,owner_client_id', 'cle primaire activities', `= ${pkActivities}`);

    const fk = await client.query(
      `select 1 from pg_constraint where conrelid = 'formula_steps'::regclass and conname = 'formula_steps_formula_scope_fkey'`,
    );
    ok(fk.rowCount === 1, 'cle etrangere composite formula_steps -> formulas');

    const uq = await client.query(
      `select 1 from pg_constraint where conrelid = 'formula_steps'::regclass and conname = 'formula_steps_scope_position_key'`,
    );
    ok(uq.rowCount === 1, 'unicite (formula_id, owner_client_id, position)');

    const oldFk = await client.query(
      `select 1 from pg_constraint where conrelid = 'formula_steps'::regclass and conname = 'formula_steps_formula_id_fkey'`,
    );
    ok(oldFk.rowCount === 0, 'ancienne cle etrangere retiree');

    const owners = await client.query(
      `select owner_client_id, count(*)::int as n from formulas group by owner_client_id order by owner_client_id`,
    );
    console.log(`  repartition formulas : ${JSON.stringify(owners.rows)}`);
    ok(owners.rows.length === 1 && owners.rows[0].owner_client_id === 'fungalaxy',
      'toutes les formules existantes sont rattachees a fungalaxy');
    ok(owners.rows[0].n === before.rows[0].formulas, 'aucune ligne perdue ni dupliquee');

    const stepOwners = await client.query(
      `select owner_client_id, count(*)::int as n from formula_steps group by owner_client_id order by owner_client_id`,
    );
    ok(stepOwners.rows.length === 1 && stepOwners.rows[0].owner_client_id === 'fungalaxy',
      'toutes les etapes suivent leur formule', `= ${JSON.stringify(stepOwners.rows)}`);

    const activityOwners = await client.query(
      `select owner_client_id, count(*)::int as n from activities group by owner_client_id order by owner_client_id`,
    );
    ok(activityOwners.rows.length === 1 && activityOwners.rows[0].owner_client_id === 'all',
      'les activites restent au catalogue PLATEFORME (backfill du fichier, aucune custom)',
      `= ${JSON.stringify(activityOwners.rows)}`);

    // Une deuxieme execution ne doit RIEN changer : la migration est idempotente.
    console.log('\n[IDEMPOTENCE] second passage du meme SQL');
    await client.query(sql);
    const pkAgain = (await client.query(PK_QUERY, ['formulas'])).rows[0].cols;
    ok(pkAgain === 'id,owner_client_id', 'cle primaire inchangee au second passage', `= ${pkAgain}`);
    const ownersAgain = await client.query(
      `select owner_client_id, count(*)::int as n from formulas group by owner_client_id`,
    );
    ok(ownersAgain.rows.length === 1 && ownersAgain.rows[0].owner_client_id === 'fungalaxy',
      'le second passage ne rattache rien de neuf', `= ${JSON.stringify(ownersAgain.rows)}`);

    // Une ecriture de client B ne doit PAS entrer en collision avec la ligne de A.
    console.log('\n[PORTEE] deux entreprises peuvent porter le meme id de formule');
    await client.query(
      `insert into formulas (id, name, source, active, owner_client_id)
       values ('f1', 'F1 chez N4', 'seed', true, 'n4-bowling');`,
    );
    const both = await client.query(`select owner_client_id from formulas where id = 'f1' order by owner_client_id`);
    ok(both.rowCount === 2, 'f1 existe pour deux entreprises sans conflit de cle',
      `= ${JSON.stringify(both.rows.map((r) => r.owner_client_id))}`);

    await client.query('ROLLBACK');
    console.log('\n[ANNULE] ROLLBACK execute : la base de production est intacte.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (ignored) { /* deja annule */ }
    console.error('\n[ECHEC] la repetition a jete, tout est annule :', error && error.message ? error.message : error);
    failures += 1;
  } finally {
    client.release();
  }

  // Preuve finale HORS transaction : la production n'a pas bouge. getPool rend
  // un singleton, d'ou la fermeture unique tout a la fin.
  try {
    const col = await pool.query(
      `select 1 from information_schema.columns where table_name = 'formulas' and column_name = 'owner_client_id'`,
    );
    ok(col.rowCount === 0, 'hors transaction : la colonne n existe toujours PAS en production',
      `(${col.rowCount} colonne trouvee)`);
  } catch (error) {
    ok(false, 'verification hors transaction impossible', error.message);
  } finally {
    await pool.end();
  }

  console.log(`\n${failures === 0 ? 'REPETITION REUSSIE' : 'REPETITION EN ECHEC'} (${failures} probleme(s))`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

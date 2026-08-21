// CE QUE LA MIGRATION 0044 CHANGE POUR CHAQUE CENTRE REEL, en transaction
// ANNULEE sur la vraie base.
//
// Pourquoi ce script en plus de scripts/migration-dry-run.js : celui-la compare
// la STRUCTURE (colonnes, types, contraintes) et rend « 0 difference » sur une
// migration qui ne deplace que des DONNEES. Ici on mesure ce qui compte
// vraiment : le catalogue SERVI a chaque centre avant et apres, en rejouant les
// lignes dans le VRAI lib/catalog-store.
//
// Aucune ecriture durable : BEGIN, mesure, ROLLBACK. La derniere verification
// relit la base HORS transaction pour prouver qu'elle est intacte.
//
// Lancement : node scripts/catalog-seed-migration-preview.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const { Pool } = require('pg');
const catalogStore = require(path.join(ROOT, 'lib', 'catalog-store.js'));
const MIGRATION_SQL = fs.readFileSync(path.join(ROOT, 'database', 'catalog-seed-ownership-schema.sql'), 'utf8');

function idsOf(list) { return (list || []).map((x) => x && x.id).filter(Boolean).sort(); }

async function snapshot(client) {
  const [formulas, steps, activities, centers] = await Promise.all([
    client.query('select * from formulas;'),
    client.query('select * from formula_steps;'),
    client.query('select * from activities;'),
    client.query('select id, client_id from centers order by id;'),
  ]);
  catalogStore.applyCatalogState({
    formulas: formulas.rows,
    steps: steps.rows,
    activities: activities.rows,
    centerClients: centers.rows.map((row) => ({ id: row.id, client_id: row.client_id })),
  });
  const perCenter = new Map();
  for (const row of centers.rows) {
    perCenter.set(row.id, {
      client: row.client_id || '(aucun)',
      formulas: idsOf(catalogStore.listBookingFormules(row.id)),
      activities: idsOf(catalogStore.listActivities(row.id)),
    });
  }
  const owners = await client.query('select owner_client_id, count(*)::int n from activities group by 1 order by 1;');
  return { perCenter, owners: owners.rows };
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  let problems = 0;
  try {
    await client.query('BEGIN');
    const before = await snapshot(client);
    await client.query(MIGRATION_SQL);
    const after = await snapshot(client);

    console.log('PORTEE DES ACTIVITES');
    console.log('  avant :', before.owners.map((r) => `${r.owner_client_id}=${r.n}`).join(' · '));
    console.log('  apres :', after.owners.map((r) => `${r.owner_client_id}=${r.n}`).join(' · '));

    console.log('\nCATALOGUE SERVI, CENTRE PAR CENTRE');
    for (const [centerId, av] of before.perCenter) {
      const ap = after.perCenter.get(centerId);
      const formulasChanged = av.formulas.join(',') !== ap.formulas.join(',');
      const activitiesChanged = av.activities.join(',') !== ap.activities.join(',');
      const retirees = av.activities.filter((id) => !ap.activities.includes(id));
      console.log(`\n  ${centerId} (client ${av.client})`);
      console.log(`    formules  : ${av.formulas.length} -> ${ap.formulas.length} ${formulasChanged ? '(CHANGE)' : '(inchange)'}`);
      console.log(`    activites : ${av.activities.length} -> ${ap.activities.length} ${activitiesChanged ? '(CHANGE)' : '(inchange)'}`);
      if (retirees.length) console.log(`    retirees  : ${retirees.join(', ')}`);
      console.log(`    restantes : ${ap.activities.join(', ') || '(aucune)'}`);
    }

    // Ce que la migration ne doit JAMAIS faire : retirer quoi que ce soit au
    // client qui a apporte le socle.
    for (const centerId of ['libramont', 'gembloux', 'ciney']) {
      const av = before.perCenter.get(centerId);
      const ap = after.perCenter.get(centerId);
      if (!av || !ap) continue;
      if (av.formulas.join(',') !== ap.formulas.join(',') || av.activities.join(',') !== ap.activities.join(',')) {
        problems += 1;
        console.log(`\n  [PROBLEME] ${centerId} a perdu quelque chose : c'est le proprietaire du socle.`);
      }
    }

    await client.query('ROLLBACK');
    console.log('\n[ANNULE] ROLLBACK execute.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERREUR:', error && error.message);
    problems += 1;
  } finally {
    client.release();
  }

  const check = await pool.query("select count(*)::int n from activities where owner_client_id = 'all';");
  console.log(`[VERIFIE] hors transaction, activites en portee plateforme : ${check.rows[0].n} (inchange = la production est intacte)`);
  await pool.end();
  process.exit(problems ? 1 : 0);
})().catch((error) => { console.error('ERREUR:', error && error.message); process.exit(1); });

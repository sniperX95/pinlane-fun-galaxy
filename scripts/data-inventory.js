// INVENTAIRE LECTURE SEULE de la base de production.
//
// Aucune ecriture, aucun DELETE : ce script sert a DECIDER quoi purger avant
// le lancement, pas a purger. Il repond a une seule question : parmi ce qui est
// en base, qu'est-ce qui est du test et qu'est-ce qui est du reel ?
//
// Usage : node --env-file=.env scripts/data-inventory.js
const { getPool } = require('../lib/database');

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

(async () => {
  const pool = getPool();
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

  console.log('=== CENTRES ===');
  const centers = await q(`
    select c.id, c.name, c.status, c.client_id,
           (select count(*) from reservations r where r.center_id = c.id)::int as resas
    from centers c order by c.id;`);
  centers.forEach((c) => console.log(
    `  ${pad(c.id, 14)} ${pad(c.name || '', 26)} statut=${pad(c.status || '', 10)} client=${pad(c.client_id || '-', 12)} resas=${num(c.resas, 5)}`));

  console.log('\n=== RESERVATIONS par centre x canal ===');
  const byChannel = await q(`
    select center_id, coalesce(channel, '(null)') as channel, count(*)::int as n,
           min(date)::text as premiere, max(date)::text as derniere,
           coalesce(sum(price), 0)::float as ca
    from reservations group by center_id, channel order by center_id, n desc;`);
  byChannel.forEach((r) => console.log(
    `  ${pad(r.center_id, 14)} ${pad(r.channel, 14)} n=${num(r.n, 5)}  du ${r.premiere} au ${r.derniere}  CA=${num(Math.round(r.ca), 7)} EUR`));

  console.log('\n=== FUTUR vs PASSE (ce qui est encore engageant) ===');
  const future = await q(`
    select center_id,
           count(*) filter (where date >= (now() at time zone 'Europe/Brussels')::date)::int as futures,
           count(*) filter (where date <  (now() at time zone 'Europe/Brussels')::date)::int as passees,
           count(*) filter (where status = 'cancelled')::int as annulees
    from reservations group by center_id order by center_id;`);
  future.forEach((r) => console.log(
    `  ${pad(r.center_id, 14)} futures=${num(r.futures, 5)}  passees=${num(r.passees, 5)}  annulees=${num(r.annulees, 5)}`));

  console.log('\n=== CREATION dans les 7 derniers jours (Seb et les testeurs) ===');
  const recent = await q(`
    select center_id, coalesce(channel,'(null)') as channel, to_char(created_at, 'YYYY-MM-DD') as jour, count(*)::int as n
    from reservations
    where created_at >= now() - interval '7 days'
    group by center_id, channel, jour order by jour desc, n desc limit 25;`);
  if (!recent.length) console.log('  (aucune creation recente)');
  recent.forEach((r) => console.log(`  ${r.jour}  ${pad(r.center_id, 14)} ${pad(r.channel, 14)} n=${num(r.n, 4)}`));

  console.log('\n=== AUTRES TABLES porteuses de donnees clients ===');
  for (const t of ['custom_requests', 'clients', 'communications', 'campaigns', 'pilot_leads']) {
    try {
      const rows = await q(`select count(*)::int as n from ${t};`);
      console.log(`  ${pad(t, 20)} ${num(rows[0].n, 6)} ligne(s)`);
    } catch (error) {
      console.log(`  ${pad(t, 20)} (table absente)`);
    }
  }

  console.log('\n=== ECHANTILLON des 12 dernieres reservations (noms tronques) ===');
  const sample = await q(`
    select id, center_id, coalesce(channel,'(null)') as channel, date::text as date,
           left(coalesce(name,''), 18) as nom, coalesce(price,0)::float as price, status
    from reservations order by created_at desc limit 12;`);
  sample.forEach((r) => console.log(
    `  #${num(r.id, 6)} ${pad(r.center_id, 12)} ${pad(r.channel, 13)} ${r.date} ${pad(r.nom, 20)} ${num(Math.round(r.price), 5)} EUR ${r.status}`));

  await pool.end();
  console.log('\n(lecture seule : rien n a ete modifie)');
})().catch((error) => {
  console.error('inventaire: erreur', error.message);
  process.exit(1);
});

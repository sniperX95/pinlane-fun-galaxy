// JEU DE DEMONSTRATION : un mois de reservations realistes, et retirable en une
// commande.
//
// Pourquoi ce script existe : la base a ete purgee avant les tests de Seb. Une
// console vide ne montre rien - ni le planning, ni le CRM, ni la Direction. Il
// faut donc un mois d'activite CREDIBLE pour verifier que tout tient la charge,
// et pouvoir l'effacer sans laisser de trace le jour ou de vrais clients
// arrivent.
//
// TROIS PRINCIPES
//  1. Rien n'est invente : les reservations passent par le VRAI chemin serveur
//     (normalizeReservationRequest -> prepareReservationOps -> createReservation).
//     Le moteur alloue les pistes, refuse ce qui ne tient pas, et c'est LUI qui
//     decide du plan. Un enregistrement direct en SQL produirait des lignes sans
//     opsPlan, invisibles sur les plannings (cf. journal du 2026-07-27).
//  2. Le prix vient de getBasePrice (la fonction qui facture le vrai tunnel),
//     jamais d'un montant tape a la main. Les disponibilites de formule
//     (jours valides, min. personnes, vacances) sont verifiees avec
//     getFormuleAvailability : le jeu de demo ne peut pas creer ce qu'un client
//     ne pourrait pas reserver.
//  3. Tout porte un marqueur : l'email finit par @demo.fungalaxy.test. La purge
//     ne supprime QUE ces lignes, et refuse de tourner si une ligne visee n'a
//     pas le marqueur.
//
// AUCUN EMAIL N'EST ENVOYE : afterReservationCreated (evenements, jobs,
// communications) n'est volontairement PAS appele. Le jeu de demo ne doit
// declencher aucune relance vers des adresses inexistantes.
//
// USAGE
//   node --env-file=.env scripts/seed-demo-month.js                  # plan (aucune ecriture)
//   node --env-file=.env scripts/seed-demo-month.js --apply          # cree
//   node --env-file=.env scripts/seed-demo-month.js --purge          # ce qui serait supprime
//   node --env-file=.env scripts/seed-demo-month.js --purge --apply  # supprime
// Options : --start=YYYY-MM-DD (defaut aujourd'hui) --days=30 --target=40000
//           --center=libramont

const fs = require('fs');
const path = require('path');
const { getPool, createReservation } = require('../lib/database');
const { normalizeReservationRequest } = require('../lib/reservation-request');
const { prepareReservationOps } = require('../lib/reservation-ops');
const {
  FORMULES, getBasePrice, getFormuleAvailability, getRequiredLaneCount,
} = require('../lib/booking-config');
const { getCenter } = require('../lib/ops-knowledge');
const { refreshCatalog } = require('../lib/catalog-store');
const { refreshFormuleOverrides } = require('../lib/catalog-overrides');

const DEMO_EMAIL_DOMAIN = 'demo.fungalaxy.test';
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const opt = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const APPLY = has('--apply');
const PURGE = has('--purge');
const CENTER = opt('center', 'libramont');
const DAYS = Math.max(1, Math.min(90, Number(opt('days', 30)) || 30));
const TARGET = Math.max(0, Number(opt('target', 40000)) || 40000);

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
const START = opt('start', todayISO());

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const money = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-BE')} €`;

// Aleatoire DETERMINISTE (mulberry32) : deux executions du meme script
// produisent le meme mois. Sans ca, impossible de rejouer un bug ni de
// comparer un avant / apres.
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = makeRandom(20260728);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const between = (min, max) => min + Math.floor(rnd() * (max - min + 1));

// Poids par jour de semaine : un centre de loisirs ne vit pas pareil un mardi et
// un samedi. (0 = dimanche)
const DAY_WEIGHT = [1.5, 0.7, 0.7, 1.3, 0.8, 1.2, 1.8];

const FIRST_NAMES = ['Lucas', 'Emma', 'Noah', 'Louise', 'Arthur', 'Alice', 'Jules', 'Mila', 'Liam', 'Olivia',
  'Hugo', 'Chloe', 'Nathan', 'Lea', 'Adam', 'Camille', 'Ethan', 'Manon', 'Sacha', 'Julia',
  'Maxime', 'Sarah', 'Antoine', 'Elise', 'Thomas', 'Zoe', 'Simon', 'Ines', 'Martin', 'Lina'];
const LAST_NAMES = ['Dubois', 'Lambert', 'Martin', 'Dupont', 'Simon', 'Laurent', 'Leroy', 'Michel', 'Lefevre', 'Bernard',
  'Petit', 'Moreau', 'Girard', 'Andre', 'Mercier', 'Blanc', 'Guerin', 'Boyer', 'Roussel', 'Marchal'];
const GROUP_LABELS = ['Ecole Saint-Joseph', 'Club de foot Libramont', 'Comite entreprise Ardennes', 'Mouvement de jeunesse',
  'Anniversaire Louis', 'Anniversaire Jade', 'Team building Wallonie', 'Stage sportif', 'EVJF Marion', 'Famille Toussaint'];

// Un carnet de clients FIXE : 40 % des reservations reprennent un client deja
// venu. Sans clients recurrents, la page Clients et la retention Direction
// afficheraient 100 % de nouveaux, ce qui n'existe dans aucun centre reel.
const CLIENT_BOOK = Array.from({ length: 90 }, (unused, i) => {
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  const last = LAST_NAMES[(i * 7) % LAST_NAMES.length];
  const slug = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
  return {
    name: `${first} ${last}`,
    email: `${slug}.${i + 1}@${DEMO_EMAIL_DOMAIN}`,
    phone: `+3247${String(1000000 + i * 7919).slice(0, 7)}`,
  };
});

function nextClient(index) {
  // 40 % de fideles (debut du carnet), 60 % de nouveaux (fin du carnet, en
  // rotation) : la courbe "nouveaux vs deja venus" a une forme credible.
  if (rnd() < 0.4) return CLIENT_BOOK[between(0, 24)];
  return CLIENT_BOOK[25 + (index % (CLIENT_BOOK.length - 25))];
}

// Creneaux realistes : le centre ouvre a 10h en vacances scolaires, mais les
// arrivees se concentrent l'apres-midi et en soiree.
const SLOTS = ['11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30'];
const WEIGHTED_SLOTS = SLOTS.concat(['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '14:30', '18:30']);

function buildCandidate(dateISO, index) {
  const client = nextClient(index);
  const roll = rnd();
  const startTime = pick(WEIGHTED_SLOTS);
  const channel = rnd() < 0.7 ? 'public' : 'staff';
  const center = getCenter(CENTER);

  if (roll < 0.45) {
    // FORMULE : on ne retient que celles reellement reservables ce jour-la, au
    // nombre de personnes tire (getFormuleAvailability = les vraies regles).
    const pax = between(6, 16);
    const usable = FORMULES.filter((f) => getFormuleAvailability(f, dateISO, pax, startTime, center).ok);
    if (!usable.length) return null;
    const formule = pick(usable);
    const laneCount = getRequiredLaneCount('formule', pax, formule.id, center?.resources?.bowling);
    return {
      type: 'formule', formuleId: formule.id, pax, startTime, duration: 1, laneCount, channel,
      occasion: /anniversaire/i.test(formule.family || '') && rnd() < 0.75 ? 'birthday' : '',
      name: rnd() < 0.35 ? pick(GROUP_LABELS) : client.name,
      email: client.email, phone: client.phone,
    };
  }

  if (roll < 0.8) {
    // BOWLING direct
    const pax = between(2, 8);
    const duration = pick([1, 1, 1, 1.5, 2, 0.5]);
    const laneCount = getRequiredLaneCount('bowling', pax, '', center?.resources?.bowling);
    return {
      type: 'bowling', pax, startTime, duration, laneCount, channel, occasion: '',
      name: client.name, email: client.email, phone: client.phone,
    };
  }

  // LASER direct
  const pax = between(4, 16);
  const duration = pick([0.5, 0.5, 1, 1.5]);
  return {
    type: 'laser', pax, startTime, duration, laneCount: 0, channel, occasion: '',
    name: client.name, email: client.email, phone: client.phone,
  };
}

// Statut credible : ce qui est deja passe aujourd'hui est encaisse ou sur place,
// ce qui vient est confirme, et quelques annulations (le taux d'annulation d'un
// centre reel n'est jamais nul).
function statusFor(dateISO, startTime, nowISO, nowHHMM) {
  if (rnd() < 0.045) return 'cancelled';
  if (dateISO < nowISO) return 'paid';
  if (dateISO === nowISO && startTime < nowHHMM) return rnd() < 0.75 ? 'paid' : 'arrived';
  return 'pending';
}

async function listDemoReservations(pool) {
  const rows = await pool.query(
    // date::text : pg rend un objet Date pour une colonne date, et
    // String(date) donne "Tue Jul 28 2026..." - le decoupage en ISO produisait
    // alors une date invalide pour la purge de l entrepot.
    `select id, date::text as date, name, email, price, status from reservations
      where lower(email) like $1 order by date, start_time;`,
    [`%@${DEMO_EMAIL_DOMAIN}`],
  );
  return rows.rows;
}

async function purge(pool) {
  const rows = await listDemoReservations(pool);
  if (!rows.length) {
    console.log(`Aucune reservation de demonstration en base (marqueur @${DEMO_EMAIL_DOMAIN}).`);
    return;
  }
  // Garde-fou : on ne supprime que ce qui porte le marqueur. Si une seule ligne
  // visee ne l'a pas, on s'arrete - c'est le signe que la requete a derape.
  const intrus = rows.filter((r) => !String(r.email || '').toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`));
  if (intrus.length) {
    console.error(`ARRET : ${intrus.length} ligne(s) visee(s) sans marqueur de demonstration.`);
    process.exit(1);
  }
  const total = rows.reduce((sum, r) => sum + Number(r.price || 0), 0);
  const dates = [...new Set(rows.map((r) => String(r.date).slice(0, 10)))];
  console.log(`${rows.length} reservations de demonstration, ${money(total)}, du ${dates[0]} au ${dates[dates.length - 1]}.`);
  if (!APPLY) {
    console.log('\nDRY-RUN : rien supprime. Relance avec --purge --apply pour supprimer.');
    return;
  }
  const ids = rows.map((r) => Number(r.id));
  // Tables enfants DECOUVERTES dans le schema (colonne reservation_id) plutot
  // qu'une liste ecrite en dur, qui derive des qu'une table est ajoutee.
  const children = (await pool.query(
    `select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'reservation_id';`,
  )).rows.map((r) => r.table_name);
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const table of children) {
      const res = await client.query(`delete from ${table} where reservation_id = any($1::int[]);`, [ids]);
      if (res.rowCount) console.log(`  ${table} : ${res.rowCount} ligne(s)`);
    }
    const del = await client.query('delete from reservations where id = any($1::int[]);', [ids]);
    // Entrepot quotidien : ces journees n'existaient que par la demo, leurs
    // agregats doivent disparaitre avec elle (sinon la Direction garderait des
    // chiffres sans reservation derriere).
    // SAVEPOINT obligatoire : sous Postgres, une requete en erreur AVORTE toute
    // la transaction - le `commit` qui suit se comporte alors en rollback. Le
    // premier essai a ainsi annonce « 217 supprimees » avec 217 residuelles.
    let metrics = { rowCount: 0 };
    try {
      await client.query('savepoint purge_metrics');
      metrics = await client.query(
        'delete from daily_center_metrics where center_id = $1 and date = any($2::date[]);',
        [CENTER, dates],
      );
      await client.query('release savepoint purge_metrics');
    } catch (error) {
      await client.query('rollback to savepoint purge_metrics');
      console.log(`  (entrepot quotidien non purge : ${error.message})`);
    }
    await client.query('commit');
    console.log(`  reservations : ${del.rowCount} ligne(s)`);
    if (metrics.rowCount) console.log(`  daily_center_metrics : ${metrics.rowCount} ligne(s) (l'entrepot se recalculera)`);
    const rest = await listDemoReservations(pool);
    console.log(`\nResiduel : ${rest.length} (attendu 0).`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function seed(pool) {
  // Catalogue et overrides charges AVANT tout calcul de prix : sinon on
  // facturerait le prix fichier la ou le centre applique le sien.
  try { await refreshCatalog(pool); } catch (error) { console.log('(catalogue fichier)'); }
  try { await refreshFormuleOverrides(pool); } catch (error) { console.log('(prix fichier)'); }

  // Garde d'idempotence : on refuse de re-semer la MEME fenetre (sinon on
  // empile deux mois l'un sur l'autre sans s'en rendre compte). Semer une autre
  // fenetre reste permis : le mois passe et le mois a venir se completent, et la
  // purge les retire ensemble puisqu'ils portent le meme marqueur.
  const existing = await listDemoReservations(pool);
  const windowEnd = addDays(START, DAYS - 1);
  const overlap = existing.filter((r) => r.date >= START && r.date <= windowEnd);
  if (overlap.length && APPLY) {
    console.error(`ARRET : ${overlap.length} reservations de demonstration existent deja entre ${START} et ${windowEnd}. Purge d'abord (--purge --apply).`);
    process.exit(1);
  }
  if (existing.length) {
    console.log(`(${existing.length} reservations de demonstration deja en base, hors de cette fenetre : elles sont conservees)\n`);
  }

  const now = new Date();
  const nowISO = todayISO();
  const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dates = Array.from({ length: DAYS }, (unused, i) => addDays(START, i));
  const weightSum = dates.reduce((sum, d) => sum + DAY_WEIGHT[new Date(`${d}T12:00:00Z`).getUTCDay()], 0);

  console.log(`Jeu de demonstration - centre ${CENTER}`);
  console.log(`Fenetre : ${dates[0]} -> ${dates[dates.length - 1]} (${DAYS} jours) · objectif ${money(TARGET)}`);
  console.log(`Mode : ${APPLY ? 'ECRITURE' : 'DRY-RUN (aucune ecriture)'}\n`);

  const created = [];
  const rejected = [];
  let index = 0;

  for (const dateISO of dates) {
    const weight = DAY_WEIGHT[new Date(`${dateISO}T12:00:00Z`).getUTCDay()];
    const dayTarget = (TARGET * weight) / weightSum;
    let dayRevenue = 0;
    let attempts = 0;
    const dayCreated = [];

    // On s'arrete au budget du jour, pas a un nombre de reservations : c'est le
    // chiffre d'affaires qui doit etre credible. Plafond d'essais pour ne jamais
    // boucler si le moteur refuse tout (journee bloquee, centre plein).
    while (dayRevenue < dayTarget && attempts < 60) {
      attempts += 1;
      index += 1;
      const candidate = buildCandidate(dateISO, index);
      if (!candidate) { rejected.push(`${dateISO} : aucune formule reservable`); continue; }

      const price = getBasePrice(
        candidate.type, candidate.duration, candidate.laneCount, candidate.pax, candidate.formuleId || '', CENTER,
      );
      if (!(price > 0)) { rejected.push(`${dateISO} ${candidate.type} : prix nul`); continue; }

      const status = statusFor(dateISO, candidate.startTime, nowISO, nowHHMM);
      const body = {
        ...candidate,
        date: dateISO,
        centerId: CENTER,
        price,
        basePrice: price,
        status,
      };

      if (!APPLY) {
        // En dry-run on ne touche pas au moteur (il lit la base) : on mesure le
        // volume et le chiffre, pas le placement.
        dayRevenue += status === 'cancelled' ? 0 : price;
        dayCreated.push({ ...body });
        created.push({ ...body });
        continue;
      }

      try {
        const request = normalizeReservationRequest(body, { channel: candidate.channel, requireEmail: true });
        const ops = await prepareReservationOps(request, 'staff');
        if (ops.blockOnlineConfirmation) {
          rejected.push(`${dateISO} ${candidate.startTime} ${candidate.type} : creneau non planifiable`);
          continue;
        }
        // Les pistes viennent du PLAN que le moteur vient de calculer sur l'etat
        // frais de la journee. Sans ca, createReservation compare un plan qui
        // pointe des pistes precises a une demande sans piste, et refuse : « Ce
        // creneau vient de changer » (223 refus au premier essai, dont presque
        // tout le bowling). Le vrai tunnel envoie ses pistes, ce script aussi.
        const planLanes = [...new Set((ops.opsPlan?.resourceBlocks || [])
          .filter((block) => block.resourceType === 'bowling_lane')
          .flatMap((block) => (block.lanes || []).map(Number))
          .filter((lane) => Number.isFinite(lane) && lane > 0))];
        // afterReservationCreated N'EST PAS appele : aucun email, aucun job.
        const reservation = await createReservation({
          ...request,
          ...ops,
          ...(planLanes.length ? { lanes: planLanes, laneCount: planLanes.length } : {}),
          price,
          basePrice: price,
          status,
        });
        dayRevenue += status === 'cancelled' ? 0 : Number(reservation.price || 0);
        dayCreated.push(reservation);
        created.push(reservation);
      } catch (error) {
        rejected.push(`${dateISO} ${candidate.startTime} ${candidate.type} : ${error.message}`);
      }
    }
    const pax = dayCreated.reduce((sum, r) => sum + Number(r.pax || 0), 0);
    console.log(`${dateISO} · ${String(dayCreated.length).padStart(2)} resa · ${String(pax).padStart(3)} joueurs · ${money(dayRevenue).padStart(10)}`);
  }

  const active = created.filter((r) => r.status !== 'cancelled');
  const total = active.reduce((sum, r) => sum + Number(r.price || 0), 0);
  const pax = active.reduce((sum, r) => sum + Number(r.pax || 0), 0);
  const byType = active.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {});
  console.log(`\n${created.length} reservations (${created.length - active.length} annulees) · ${pax} joueurs · ${money(total)}`);
  console.log(`Repartition : ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  if (rejected.length) {
    console.log(`\n${rejected.length} refus du moteur (creneaux non planifiables, formules indisponibles) :`);
    rejected.slice(0, 8).forEach((r) => console.log(`  ${r}`));
    if (rejected.length > 8) console.log(`  ... et ${rejected.length - 8} autres`);
  }

  if (!APPLY) {
    console.log('\nDRY-RUN : rien ecrit. Relance avec --apply pour creer.');
    return;
  }

  // Trace locale : la liste exacte des identifiants crees. La purge n'en depend
  // pas (elle filtre sur le marqueur email) mais c'est la preuve de ce qui a ete
  // fait, et de quoi verifier apres coup.
  const outDir = path.join(ROOT, 'artifacts');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (error) { /* deja la */ }
  const outFile = path.join(outDir, `seed-demo-${dates[0]}-${dates[dates.length - 1]}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    centerId: CENTER, start: dates[0], end: dates[dates.length - 1], marker: `@${DEMO_EMAIL_DOMAIN}`,
    count: created.length, revenue: total, ids: created.map((r) => r.id),
  }, null, 1));
  console.log(`\nTrace : ${path.relative(ROOT, outFile)}`);
  console.log(`Pour tout retirer : node --env-file=.env scripts/seed-demo-month.js --purge --apply`);
}

(async () => {
  const pool = getPool();
  try {
    if (PURGE) await purge(pool);
    else await seed(pool);
  } finally {
    await pool.end();
  }
})().catch((error) => { console.error('ERREUR:', error.message); process.exit(1); });

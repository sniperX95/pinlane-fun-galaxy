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
  {
    id: '0027_marketing_plans',
    file: 'database/marketing-plan-schema.sql',
    description: 'Le Stratege: multi-week marketing plan anchored on the calendar (the only thing solid at 8 weeks while measured patterns are empty)',
  },
  {
    id: '0028_ops_jobs_progress',
    file: 'database/ops-jobs-progress-schema.sql',
    description: 'Live job progress: timestamped real steps written by job handlers (never by the dispatch loop), nullable additive columns only',
  },
  {
    id: '0029_communications_status_repair',
    file: 'database/communications-status-repair-schema.sql',
    description: 'Repair communications dispatch broken by 0019: restore processing (worker claim status) lost when received was added',
  },
  {
    id: '0030_marketing_suppressions',
    file: 'database/marketing-suppressions-schema.sql',
    description: 'Marketing suppression list per center (unsubscribe link, staff add, complaint): filters marketing sends only, never transactional',
  },
  {
    id: '0031_audit_log',
    file: 'database/audit-log-schema.sql',
    description: 'Journal des modifications (qui/quoi/avant/apres/refus): fondation tracabilite des deux cockpits. Append-only, aucune purge automatique.',
  },
  {
    id: '0032_platform_owner_role',
    file: 'database/platform-owner-role-schema.sql',
    description: "Role plateforme 'platform-owner' porteur de platform.admin (cockpit fondateur): seed du role par centre + rattachement des membres proprietaires. Jamais confere par role.locked.",
  },
  {
    id: '0033_client_errors',
    file: 'database/client-errors-schema.sql',
    description: "Telemetrie d'erreurs des consoles staff (Plateforme > Incidents): le fondateur voit un bug avant qu'on le lui signale. Caps de taille + regroupement par stack_hash, rate-limit applicatif dans lib/client-errors.",
  },
  {
    id: '0034_catalog_overrides',
    file: 'database/catalog-overrides-schema.sql',
    description: "Overrides catalogue no-code (formule_overrides) fusionnes par-dessus formulas.json / booking-config (prix, nom, retrait, par centre ou 'all'); + dismiss incidents console (resolved_at/resolved_by sur client_errors). Override vide = comportement identique au fichier.",
  },
  {
    id: '0035_clients',
    file: 'database/clients-schema.sql',
    description: "Couche CLIENT (locataire Pinlane) au-dessus des centres : table clients + centers.client_id. Les 3 centres existants rattaches a un client 'fungalaxy' seed (comportement inchange). Base du provisioning cle en main cote proprietaire.",
  },
  {
    id: '0036_clients_billing',
    file: 'database/clients-billing-schema.sql',
    description: "Prix mensuel par client (clients.monthly_price, numeric nullable) : socle du MRR proprietaire et du revenu par client. Null = a definir, jamais compte comme un chiffre invente. Additive et idempotente.",
  },
  {
    id: '0037_availability_blocks',
    file: 'database/availability-blocks-schema.sql',
    description: "Blocage granulaire de la disponibilite (availability_blocks) : centre/piste/activite/formule, ponctuel (once) ou hebdo (weekly), jour entier ou plage horaire. Aucune ligne = dispo identique au comportement historique. Lecture fail-soft, re-verifiee dans la transaction de creation (anti-course). Additive et idempotente.",
  },
  {
    id: '0038_catalog',
    file: 'database/catalog-schema.sql',
    description: "Catalogue unifie (activities / formulas / formula_steps) : source DB unique fusionnee par-dessus les fichiers socle (activities.json, formulas.json, booking-config FORMULES) par lib/catalog-store.js. time_limit canonique en minutes depuis minuit ; is_birthday_formula remplace le regex famille ; hasBowling derive des steps. Aucune ligne = comportement identique aux fichiers ; apres backfill seed, comportement identique (prix/dispo/ancrage). Additive et idempotente.",
  },
  {
    id: '0039_activity_booking',
    file: 'database/activity-booking-schema.sql',
    description: "Reservabilite et tarif d'une activite (bookable, price_type, price_value, price_unit, booking_order) : le tunnel client peut proposer minigolf, billards, arcades... et le tarif devient une donnee de centre au lieu d'une constante du code. Colonnes nullables : NULL = valeur du socle, donc aucune ligne existante ne change de comportement.",
  },
  {
    id: '0040_reservation_program',
    file: 'database/reservation-program-schema.sql',
    description: "Programme d'une reservation (plusieurs activites dans une meme visite) en jsonb additif. `type` reste derive du programme pour ne pas toucher aux 260+ lectures existantes ; ops_plan.resource_blocks reste la verite du planning. NULL = reservation mono-activite, comportement inchange.",
  },
  {
    id: '0041_formula_effectif_ordre',
    file: 'database/formula-effectif-ordre-schema.sql',
    description: "Effectif (pax) et caractere optionnel PAR ETAPE de formule, contrainte d'ordre (order_constraints) PAR FORMULE. Colonnes additives : NULL/false = comportement historique exact. Le store detecte leur presence a la lecture (drapeau de capacite) : avant application, lecture et ecriture restent en forme historique.",
  },
  {
    id: '0042_catalog_client_scope',
    file: 'database/catalog-client-scope-schema.sql',
    description: "Portee ENTREPRISE du catalogue (owner_client_id sur formulas / formula_steps / activities, cles primaires composites). Deux clients Pinlane ne partagent plus rien ; deux centres d'un MEME client continuent de partager. Les lignes existantes vont a 'fungalaxy' (mesure : elles sont identiques au socle fichier, donc aucun catalogue servi ne change). Rollback : database/rollbacks/0042_catalog_client_scope.down.sql",
  },
  {
    id: '0043_activity_pricing',
    file: 'database/activity-pricing-schema.sql',
    description: "Tarif d'activite PAR JOUR ET PAR CRENEAU (activities.pricing, jsonb nullable) : une liste d'exceptions au prix de base, comme le bowling a recu la sienne. NULL = un seul prix, comportement inchange. Regle de surete : sans creneau choisi, c'est le prix de base qui s'affiche, donc le montant ne peut que baisser. Forme validee par lib/activity-pricing.js.",
  },
  {
    id: '0044_catalog_seed_ownership',
    file: 'database/catalog-seed-ownership-schema.sql',
    description: "Le catalogue livre dans le code appartient au client qui l a apporte. 0042 avait donne les FORMULES a 'fungalaxy' mais laisse les 12 ACTIVITES en portee plateforme ('all'), donc lisibles par toute entreprise : un bowling sans arene laser se voyait servir laser_game et minigolf_blacklight. Elles passent a 'fungalaxy'. Fun Galaxy ne perd rien, les autres cessent d heriter. Idempotente. Rollback : database/rollbacks/0044_catalog_seed_ownership.down.sql",
  },
  {
    id: '0045_email_claims',
    file: 'database/email-claims-schema.sql',
    description: "Qui est en train de repondre a ce mail. Deux personnes sur la meme boite ecrivaient chacune leur reponse sans savoir que l autre ecrivait la sienne : le client recevait deux reponses. Une prise par mail, avec une date d expiration plutot qu un verrou a liberer, pour qu un onglet ferme ne bloque jamais un message. Consultative : elle previent, elle n interdit pas. Idempotente (create table/index if not exists), aucune donnee existante touchee. Rollback : database/rollbacks/0045_email_claims.down.sql",
  },
  {
    id: '0046_email_claims_role',
    file: 'database/email-claims-role-schema.sql',
    description: "Le role de qui s occupe du mail. Un prenom seul ne suffit pas quand plusieurs personnes se relaient : savoir que c est la DIRECTRICE qui repond, et pas un equipier du bar, change ce qu on fait ensuite. Libelle copie au moment de la prise (une prise dure trois minutes ; on veut le role d alors, pas celui de demain). ORDRE : apres 0045, qui cree la table qu elle altere. Idempotente (add column if not exists), aucune donnee existante touchee. Rollback : database/rollbacks/0046_email_claims_role.down.sql",
  },
  {
    id: '0047_email_threads',
    file: 'database/email-threads-schema.sql',
    description: "Les fils de conversation des mails, le suivi de remise et les lectures par l equipe. Chaque reponse d un client faisait un message a part ; personne ne savait qui avait lu un mail recu ni si un mail envoye etait arrive, ouvert ou revenu en erreur. Table email_threads (bornee par centre), colonnes additives sur communications (thread_id, Message-ID / In-Reply-To / References, remis / ouvert / clique / rebond / plainte), table email_events (une ligne par evenement du fournisseur, cle unique svix-id, jamais d adresse IP), table communication_reads (qui a lu quoi). Rattrapage idempotent des mails existants sans fil, borne par centre. Rollback : database/rollbacks/0047_email_threads.down.sql",
  },
  {
    id: '0048_reservation_companions',
    file: 'database/reservation-companions-schema.sql',
    description: "Les accompagnants d un dossier : des adultes presents qui ne jouent pas et ne paient pas l offre (Kids Fun Day, reserve aux enfants de 5 a 12 ans : seuls les enfants paient la formule). pax reste le nombre de joueurs, celui du prix et de la capacite. Colonne additive a defaut 0, bornee 0 a 500 : aucune reecriture de table, les dossiers existants gardent 0. Rollback : database/rollbacks/0048_reservation_companions.down.sql",
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

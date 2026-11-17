'use strict';
// LES MISES A JOUR DE LA BASE QUE CE CODE ATTEND (2026-11-17).
//
// Le lanceur des migrations (scripts/run-db-migrations.js) et leurs fichiers SQL (database/) ne partent pas
// en production (.vercelignore) : le site en ligne ne savait donc pas quelles mises a jour il attend, et
// rien ne comparait le code a la base. Or le code tolere une table ou une colonne absente (une base pas
// encore migree repond « rien » au lieu de planter) : en avance sur la base, il ignorait en silence les
// creneaux retenus en ligne ou les fermetures.
//
// Cette liste part avec le site. La surveillance du quart d heure (lib/tour-controle.js,
// constatsDesMigrations) la compare a la table schema_migrations. UNE SEULE REGLE, DEUX FICHIERS : le gate
// scripts/migrations-attendues-check.js exige que cette liste soit, dans l ordre, celle du lanceur. Une
// migration ajoutee au lanceur s ajoute ici dans le meme commit, sinon la suite rougit.
const MIGRATIONS_ATTENDUES = [
  '0001_core_reservations',
  '0002_ops_engine',
  '0003_staff_access_control',
  '0004_communications_worker_queue',
  '0005_ops_automation',
  '0006_center_lane_statuses',
  '0007_pilot_leads',
  '0008_tenant_integrity',
  '0009_reservation_occasion',
  '0010_custom_requests',
  '0011_staff_access_code_enc',
  '0012_direction_reports',
  '0013_email_studio',
  '0014_lane_maintenance_window',
  '0015_campaigns',
  '0016_activity_progress',
  '0017_daily_metrics',
  '0018_client_notes_automation',
  '0019_email_agent',
  '0020_competitor_watch',
  '0021_propositions',
  '0022_marketing_patterns',
  '0023_competitor_intel',
  '0024_llm_spend',
  '0025_marketing_arms',
  '0026_marketing_dna',
  '0027_marketing_plans',
  '0028_ops_jobs_progress',
  '0029_communications_status_repair',
  '0030_marketing_suppressions',
  '0031_audit_log',
  '0032_platform_owner_role',
  '0033_client_errors',
  '0034_catalog_overrides',
  '0035_clients',
  '0036_clients_billing',
  '0037_availability_blocks',
  '0038_catalog',
  '0039_activity_booking',
  '0040_reservation_program',
  '0041_formula_effectif_ordre',
  '0042_catalog_client_scope',
  '0043_activity_pricing',
  '0044_catalog_seed_ownership',
  '0045_email_claims',
  '0046_email_claims_role',
  '0047_email_threads',
  '0048_reservation_companions',
  '0049_slot_holds',
  '0050_marketing_suppressions_form',
  '0051_customer_note_author',
  '0052_reservation_archive',
  '0053_client_note_versions',
  '0054_formule_override_validation',
  '0055_donnees_marketing',
  '0056_encaisse_absence',
  '0057_upsell_events',
  '0058_departs_epingles',
  '0059_assistant_conversations',
  '0060_formulaire_etapes',
  '0061_formulaire_heures_pleines',
];

// Ce qui manque a la base (le code est en avance : a dire) et ce qu elle a en plus (la base est en avance :
// normal entre une migration jouee et la mise en ligne du code qui la lit, jamais une alerte).
function ecartDesMigrations(appliquees) {
  const enBase = new Set((Array.isArray(appliquees) ? appliquees : []).map((id) => String(id)));
  const attendues = new Set(MIGRATIONS_ATTENDUES);
  return {
    manquantes: MIGRATIONS_ATTENDUES.filter((id) => !enBase.has(id)),
    enPlus: [...enBase].filter((id) => !attendues.has(id)).sort(),
  };
}

module.exports = { MIGRATIONS_ATTENDUES, ecartDesMigrations };

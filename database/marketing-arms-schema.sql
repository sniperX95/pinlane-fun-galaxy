-- Bandit d'angles (Phase 3, 2026-07-16). Un bras par (centre, angle) : compte
-- de succès/échecs alimenté par la mesure réelle J+14 (effet net > 0 = succès).
-- Sert au Thompson sampling qui choisit l'angle à tester à la génération.
-- Additif, idempotent, aucune donnée personnelle.
create table if not exists marketing_arms (
  center_id  text not null,
  angle_key  text not null,
  successes  integer not null default 0,
  failures   integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (center_id, angle_key)
);

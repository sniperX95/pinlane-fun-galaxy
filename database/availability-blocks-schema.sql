-- ============================================================================
-- availability_blocks : BLOCAGE GRANULAIRE de la disponibilite (Phase 1)
-- ============================================================================
--
-- POURQUOI CETTE TABLE
--
-- Aujourd'hui seule lane_statuses (status = 'maintenance', avec une fenetre de
-- DATES) retire une piste de bowling de la disponibilite. Il n'existe aucun
-- moyen de bloquer une HEURE, une FORMULE, une ACTIVITE, ni de poser une regle
-- RECURRENTE (chaque mardi 14h-16h). Cette table apporte le blocage granulaire :
-- un centre entier, une piste, une activite ou une formule, sur un jour precis
-- (once) ou chaque semaine (weekly), toute la journee ou sur une plage horaire.
--
-- INVARIANT CENTRAL, verrouille par scripts/availability-blocks-check.js :
--   AUCUNE ligne ici = disponibilite STRICTEMENT identique a aujourd'hui, au
--   creneau pres. La lecture des blocages est fail-soft : un incident base ne
--   doit jamais planter la dispo, il sert l'etat connu (ou aucun blocage).
--
-- PORTEE (scope_type / scope_ref)
--   * 'center'   : tout le centre. scope_ref NULL.
--   * 'lane'     : une piste de bowling. scope_ref = lane_number (en texte).
--   * 'activity' : une activite (ex. 'laser_game', 'bowling'). scope_ref = id.
--   * 'formula'  : une formule. scope_ref = formule_id (ex. 'f1', 'bts').
--
-- RECURRENCE
--   * 'once'   : un jour precis. `date` obligatoire.
--   * 'weekly' : chaque semaine. `day_of_week` obligatoire (0 = dimanche .. 6 =
--                samedi, aligne sur Date.getDay()). Bornes de validite
--                optionnelles [date_from, date_until] (NULL = illimite).
--
-- HEURES (start_time / end_time)
--   * NULL + NULL : blocage JOUR ENTIER.
--   * plage       : blocage sur [start_time, end_time). Chevauchement demi-ouvert.
--
-- Les BORNES et la coherence (scope_ref requis selon scope, date vs day_of_week,
-- end > start) sont validees COTE SERVEUR par lib/availability-blocks.js : la
-- table reste tolerante, le code valide. Aucune donnee client ici : ce sont des
-- reglages d'exploitation poses par le staff (permission settings.manage).
--
-- Additif et idempotent (create table if not exists) : rejouable sans effet.

create table if not exists availability_blocks (
  id          bigserial primary key,
  center_id   text not null,
  scope_type  text not null check (scope_type in ('center', 'lane', 'activity', 'formula')),
  scope_ref   text,
  recurrence  text not null default 'once' check (recurrence in ('once', 'weekly')),
  date        date,
  day_of_week smallint check (day_of_week >= 0 and day_of_week <= 6),
  date_from   date,
  date_until  date,
  start_time  time,
  end_time    time,
  reason      text not null default '',
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Lecture par centre + portee (l'editeur filtre par scope) et par centre + date
-- (blocages ponctuels du jour) et par centre + jour de semaine (regles hebdo).
create index if not exists availability_blocks_scope_idx
  on availability_blocks (center_id, scope_type, scope_ref);
create index if not exists availability_blocks_date_idx
  on availability_blocks (center_id, date);
create index if not exists availability_blocks_dow_idx
  on availability_blocks (center_id, day_of_week);

comment on table availability_blocks is
  'Blocage granulaire de la disponibilite (centre/piste/activite/formule ; ponctuel once ou recurrent weekly ; jour entier ou plage horaire). Aucune ligne = dispo identique au comportement historique. Bornes validees cote serveur (lib/availability-blocks.js).';

-- ============================================================================
-- Catalogue unifie (activites + formules + steps) : la SOURCE DB unique du
-- catalogue, fusionnee PAR-DESSUS les fichiers socle a la lecture
-- (lib/catalog-store.js).
-- ============================================================================
--
-- POURQUOI CES TABLES
--
-- Le catalogue vit AUJOURD'HUI en TROIS fichiers desynchronises :
--   * lib/booking-config.js FORMULES   -> pricing / eligibilite (tunnel client)
--   * ops-knowledge/formulas.json      -> steps / ancrage (moteur ops)
--   * ops-knowledge/activities.json    -> 11 activites (moteur ops)
-- Ces fichiers restent le SOCLE : traces et embarques par le bundler Vercel, ils
-- ne bougent pas. Ces tables ne stockent QUE ce qui est lu depuis une source DB
-- unique ; lib/catalog-store.js les fusionne par-dessus les fichiers a la lecture
-- et reconstruit les DEUX formats (formulas.json + booking-config) SANS changer
-- leur forme.
--
-- INVARIANT CENTRAL, verrouille par scripts/catalog-store-check.js :
--   AUCUNE ligne ici = comportement STRICTEMENT identique aux fichiers.
--   Apres le backfill seed (lignes = contenu des fichiers), comportement
--   IDENTIQUE au centime (prix), au verdict (dispo) et au deep-equal (steps).
--
-- CANONISATION (choix documentes dans scripts/backfill-catalog.js) :
--   * time_limit en MINUTES depuis minuit (unite canonique unique). Le format
--     'HH:MM' (formulas.json) et les heures numeriques (booking-config) en
--     derivent a la lecture.
--   * is_birthday_formula remplace le regex /anniversaire/ applique a la famille.
--   * description_lines = le desc[] d'affichage de booking-config. La DUREE ne
--     s'en deduit PLUS : elle vient des steps (formula_steps).
--   * hasBowling / bowlingDur ne sont PAS stockes : ils se derivent des steps.
--
-- Additive et idempotente : create table/index if not exists uniquement.

-- ── activites ────────────────────────────────────────────────────────────────
-- center_id = 'all' par defaut : une activite du catalogue commun. Un centre peut
-- (2b) poser sa propre ligne (id, center_id) qui prime sur 'all'. source='seed'
-- = backfill depuis activities.json ; source='custom' = ajoutee par la direction.
create table if not exists activities (
  id                text not null,
  center_id         text not null default 'all',
  name              text,
  resource_type     text,
  duration_model    jsonb,
  service_model     jsonb,
  risk_drivers      text[],
  planning_pressure text,
  source            text not null default 'seed' check (source in ('seed', 'custom')),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (id, center_id)
);

create index if not exists activities_center_idx on activities (center_id);

-- ── formules ─────────────────────────────────────────────────────────────────
-- time_limit_*_minutes : minutes depuis minuit (canonique). NULL = pas de borne.
-- valid_days : int[] (0=dimanche .. 6=samedi). NULL / vide = tous les jours.
-- is_birthday_formula : remplace /anniversaire/i.test(family). best : mise en
-- avant. description_lines : desc[] d'affichage (booking-config). price_type :
-- 'per_pax' | 'per_lane'. source='seed' = backfill ; 'custom' = ajoutee.
create table if not exists formulas (
  id                     text primary key,
  name                   text,
  family                 text,
  min_pax                integer,
  price_type             text,
  price_value            numeric(10, 2),
  price_old              numeric(10, 2),
  not_during_holidays    boolean default false,
  valid_days             integer[],
  time_limit_min_minutes integer,
  time_limit_max_minutes integer,
  human_validation       text,
  order_policy           text,
  is_birthday_formula    boolean default false,
  best                   boolean default false,
  description_lines      text[],
  sort_index             integer,
  source                 text not null default 'seed' check (source in ('seed', 'custom')),
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists formulas_source_idx on formulas (source);

-- ── steps de formule ─────────────────────────────────────────────────────────
-- L'ordre des etapes fait foi via (formula_id, position). duration_minutes NULL
-- = la duree vient du modele de l'activite. resource_type : override inline d'une
-- etape (ex. service_drinks, arcade_credit qui ne sont pas des activites du
-- catalogue). on delete cascade : supprimer une formule custom retire ses steps.
create table if not exists formula_steps (
  id               bigserial primary key,
  formula_id       text references formulas(id) on delete cascade,
  position         integer,
  activity_id      text,
  count            integer default 1,
  duration_minutes integer,
  label            text,
  critical         boolean default false,
  resource_type    text,
  unique (formula_id, position)
);

comment on table activities is
  'Catalogue activites (source DB unique) fusionne par-dessus ops-knowledge/activities.json. Aucune ligne = comportement identique au fichier.';
comment on table formulas is
  'Catalogue formules (source DB unique) fusionne par-dessus ops-knowledge/formulas.json + lib/booking-config FORMULES. time_limit en minutes depuis minuit. Aucune ligne = comportement identique aux fichiers.';
comment on table formula_steps is
  'Steps ordonnes d une formule (position fait foi). Alimente l ancrage du moteur ops et la derivation hasBowling/duree.';

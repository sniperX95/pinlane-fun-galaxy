-- Warehouse quotidien + insights marketing (northstar « data qui rapporte »).
--
-- daily_center_metrics : 1 ligne = 1 jour x centre. Matérialise ce que
-- readAdminRangeState/buildDirectionAnalytics recalculaient à la volée, ENRICHI
-- de la météo locale (Open-Meteo) et du calendrier (vacances FWB, fériés BE).
-- C'est la table sur laquelle l'agent marketing corrèle météo x fréquentation
-- avec contrôle jour-de-semaine — jamais de chiffre hors SQL.
--
-- weather_daily_forecast : prévisions J..J+14 rafraîchies par le cron. Sert de
-- fallback quand l'archive Open-Meteo (délai ~5 jours) n'a pas encore le jour
-- consolidé, et de déclencheur d'idées (« pluie annoncée samedi »).
--
-- marketing_insights : les idées/constats de l'agent avec leur cycle de vie
-- proposed -> applied/ignored -> validated/refuted/inconclusive. `data_basis`
-- contient les faits SQL qui justifient (grounding), `result` la mesure
-- avant/après contrôlée. `signature` = clé de dédupe (déclencheur + canal).

create table if not exists daily_center_metrics (
  center_id text not null default 'libramont',
  date date not null,
  visitors integer not null default 0,
  reservations_count integer not null default 0,
  cancellations_count integer not null default 0,
  revenue_total numeric(12,2) not null default 0,
  revenue_by_type jsonb not null default '{}'::jsonb,
  pax_by_type jsonb not null default '{}'::jsonb,
  new_clients_count integer not null default 0,
  avg_basket numeric(10,2) not null default 0,
  weather_tmax numeric(4,1),
  weather_tmin numeric(4,1),
  weather_precip_mm numeric(6,2),
  weather_code integer,
  is_school_holiday boolean not null default false,
  is_public_holiday boolean not null default false,
  holiday_label text not null default '',
  computed_at timestamptz not null default now(),
  primary key (center_id, date)
);

create index if not exists daily_center_metrics_date_idx
  on daily_center_metrics (date desc);

create table if not exists weather_daily_forecast (
  center_id text not null default 'libramont',
  date date not null,
  tmax numeric(4,1),
  tmin numeric(4,1),
  precip_mm numeric(6,2),
  weather_code integer,
  fetched_at timestamptz not null default now(),
  primary key (center_id, date)
);

create table if not exists marketing_insights (
  id bigserial primary key,
  center_id text not null default 'libramont',
  kind text not null default 'idea' check (kind in ('insight', 'idea', 'experiment')),
  title text not null default '',
  body text not null default '',
  channel text not null default '',
  ready_content text not null default '',
  data_basis jsonb not null default '[]'::jsonb,
  signature text not null default '',
  status text not null default 'proposed'
    check (status in ('proposed', 'applied', 'ignored', 'validated', 'refuted', 'inconclusive')),
  proposed_at timestamptz not null default now(),
  applied_at timestamptz,
  measured_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketing_insights_center_status_idx
  on marketing_insights (center_id, status);

create index if not exists marketing_insights_center_proposed_idx
  on marketing_insights (center_id, proposed_at desc);

create index if not exists marketing_insights_signature_idx
  on marketing_insights (center_id, signature, proposed_at desc);

-- FunGalaxy Ops Engine extension.
-- This migration is additive: it does not remove or rewrite current reservations.

create table if not exists centers (
  id text primary key,
  name text not null,
  status text not null default 'active' check (status in ('active', 'planned', 'closed')),
  timezone text not null default 'Europe/Brussels',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into centers (id, name, status, timezone)
values
  ('libramont', 'Fun Galaxy Libramont', 'active', 'Europe/Brussels'),
  ('gembloux', 'Fun Galaxy Gembloux', 'active', 'Europe/Brussels'),
  ('ciney', 'Fun Galaxy Ciney', 'planned', 'Europe/Brussels')
on conflict (id) do nothing;

alter table reservations
  add column if not exists center_id text not null default 'libramont',
  add column if not exists ops_plan jsonb,
  add column if not exists risk_level text,
  add column if not exists risk_score integer,
  add column if not exists validation_status text not null default 'confirmed'
    check (validation_status in ('draft', 'requested', 'staff_review', 'confirmed', 'rejected'));

create index if not exists reservations_center_date_idx on reservations (center_id, date, start_time);
create index if not exists reservations_validation_idx on reservations (validation_status, date);

create table if not exists ops_events (
  id bigserial primary key,
  center_id text not null default 'libramont',
  reservation_id bigint references reservations(id) on delete set null,
  formula_id text,
  activity_id text,
  event_type text not null,
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  planned_minutes numeric(8,2),
  actual_minutes numeric(8,2),
  reason_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ops_events_center_created_idx on ops_events (center_id, created_at desc);
create index if not exists ops_events_reservation_idx on ops_events (reservation_id);
create index if not exists ops_events_formula_activity_idx on ops_events (center_id, formula_id, activity_id);

create table if not exists ops_agent_suggestions (
  id bigserial primary key,
  center_id text not null default 'libramont',
  agent_id text not null,
  suggestion_type text not null,
  dedupe_key text,
  severity text not null default 'info' check (severity in ('info', 'medium', 'high', 'critical')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  confidence numeric(5,4) not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create index if not exists ops_agent_suggestions_status_idx on ops_agent_suggestions (status, created_at desc);
create index if not exists ops_agent_suggestions_center_idx on ops_agent_suggestions (center_id, created_at desc);

alter table ops_agent_suggestions add column if not exists dedupe_key text;
create unique index if not exists ops_agent_suggestions_dedupe_idx on ops_agent_suggestions (dedupe_key) where dedupe_key is not null;

create table if not exists communications (
  id bigserial primary key,
  center_id text not null default 'libramont',
  reservation_id bigint references reservations(id) on delete set null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'phone_note')),
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  template_id text,
  recipient text not null default '',
  subject text not null default '',
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'queued', 'sent', 'delivered', 'failed', 'cancelled')),
  provider_message_id text,
  idempotency_key text,
  attempts integer not null default 0,
  last_error text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists communications_reservation_idx on communications (reservation_id, created_at desc);
create index if not exists communications_scheduled_idx on communications (status, scheduled_at);

alter table communications add column if not exists idempotency_key text;
alter table communications add column if not exists attempts integer not null default 0;
alter table communications add column if not exists last_error text;
create unique index if not exists communications_idempotency_idx on communications (idempotency_key) where idempotency_key is not null;

alter table reservations drop constraint if exists reservations_pax_check;
alter table reservations
  add constraint reservations_pax_check check (pax > 0 and pax <= 240);

create table if not exists ops_simulation_runs (
  id text primary key,
  center_id text not null default 'libramont',
  sim_date date not null,
  scenario text not null default 'rush_day',
  status text not null default 'running' check (status in ('running', 'finished', 'failed', 'cancelled')),
  step_index integer not null default 0,
  total_steps integer not null default 0,
  speed_factor integer not null default 90,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists ops_simulation_runs_center_idx on ops_simulation_runs (center_id, sim_date desc, created_at desc);

create table if not exists ops_decision_logs (
  id bigserial primary key,
  center_id text not null default 'libramont',
  run_id text,
  reservation_id bigint references reservations(id) on delete set null,
  agent_id text not null,
  decision_type text not null,
  severity text not null default 'info' check (severity in ('info', 'medium', 'high', 'critical')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ops_decision_logs_center_idx on ops_decision_logs (center_id, created_at desc);
create index if not exists ops_decision_logs_run_idx on ops_decision_logs (run_id, created_at asc);

drop trigger if exists centers_set_updated_at on centers;
create trigger centers_set_updated_at
before update on centers
for each row
execute function set_updated_at();

drop trigger if exists ops_simulation_runs_set_updated_at on ops_simulation_runs;
create trigger ops_simulation_runs_set_updated_at
before update on ops_simulation_runs
for each row
execute function set_updated_at();

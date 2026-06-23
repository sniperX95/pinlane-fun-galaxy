alter table communications
  add column if not exists priority integer not null default 50,
  add column if not exists next_retry_at timestamptz,
  add column if not exists max_attempts integer not null default 3;

create index if not exists communications_dispatch_ready_idx
  on communications (status, coalesce(next_retry_at, scheduled_at, created_at), priority desc, id asc);

create table if not exists ops_jobs (
  id bigserial primary key,
  center_id text not null default 'libramont',
  reservation_id bigint references reservations(id) on delete set null,
  job_type text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed', 'cancelled')),
  priority integer not null default 50,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists ops_jobs_idempotency_idx
  on ops_jobs (idempotency_key)
  where idempotency_key is not null;

create index if not exists ops_jobs_due_idx
  on ops_jobs (status, run_at, priority desc, id asc);

drop trigger if exists ops_jobs_set_updated_at on ops_jobs;
create trigger ops_jobs_set_updated_at
before update on ops_jobs
for each row
execute function set_updated_at();

create table if not exists ops_worker_runs (
  id bigserial primary key,
  worker_name text not null default 'ops-worker',
  task_name text not null,
  status text not null default 'running' check (status in ('running', 'ok', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  checked_count integer not null default 0,
  result jsonb not null default '{}'::jsonb,
  error text
);

create index if not exists ops_worker_runs_recent_idx
  on ops_worker_runs (worker_name, started_at desc);

create table if not exists ops_delay_incidents (
  id bigserial primary key,
  center_id text not null default 'libramont',
  reservation_id bigint references reservations(id) on delete set null,
  delay_minutes integer not null default 0,
  reason text not null default '',
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'needs_staff', 'cancelled')),
  previous_start_time text,
  proposed_start_time text,
  impact jsonb not null default '{}'::jsonb,
  communications jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create unique index if not exists ops_delay_incidents_idempotency_idx
  on ops_delay_incidents (idempotency_key)
  where idempotency_key is not null;

create index if not exists ops_delay_incidents_center_idx
  on ops_delay_incidents (center_id, created_at desc);

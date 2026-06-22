create table if not exists reservations (
  id bigserial primary key,
  center_id text not null default 'libramont',
  channel text not null default 'public',
  name text not null,
  phone text not null,
  email text not null default '',
  date date not null,
  start_time time not null,
  duration numeric(5,2) not null check (duration > 0),
  total_duration numeric(5,2) not null check (total_duration > 0),
  lanes integer[] not null default '{}',
  pax integer not null check (pax > 0 and pax <= 240),
  status text not null default 'pending' check (status in ('pending', 'arrived', 'paid', 'cancelled')),
  base_price numeric(10,2) not null default 0,
  price numeric(10,2) not null default 0,
  type text not null default 'bowling',
  formule_id text,
  label text not null default 'Bowling Classique',
  extras jsonb not null default '[]'::jsonb,
  payment_method text,
  notes text not null default '',
  ops_plan jsonb,
  risk_level text,
  risk_score integer,
  validation_status text not null default 'confirmed' check (validation_status in ('draft', 'requested', 'staff_review', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reservations_date_time_idx on reservations (date, start_time);
create index if not exists reservations_center_date_idx on reservations (center_id, date, start_time);
create index if not exists reservations_status_date_idx on reservations (status, date);
create index if not exists reservations_updated_at_idx on reservations (updated_at desc);

create table if not exists lane_statuses (
  lane_number integer primary key check (lane_number between 1 and 8),
  status text not null default 'active' check (status in ('active', 'maintenance')),
  updated_at timestamptz not null default now()
);

insert into lane_statuses (lane_number, status)
values
  (1, 'active'),
  (2, 'active'),
  (3, 'active'),
  (4, 'active'),
  (5, 'active'),
  (6, 'active'),
  (7, 'active'),
  (8, 'active')
on conflict (lane_number) do nothing;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reservations_set_updated_at on reservations;
create trigger reservations_set_updated_at
before update on reservations
for each row
execute function set_updated_at();

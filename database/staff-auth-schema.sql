-- Staff access control schema.
-- Runtime note: lib/staff-auth.js also creates this schema automatically on first use.

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists staff_roles (
  center_id text not null default 'libramont',
  id text not null,
  name text not null,
  code text not null,
  summary text not null default '',
  description text not null default '',
  tone text not null default 'custom',
  permissions jsonb not null default '[]'::jsonb,
  access_code_hash text not null,
  access_code_hint text not null default '',
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (center_id, id)
);

create table if not exists staff_members (
  id text primary key,
  center_id text not null default 'libramont',
  name text not null,
  contact text not null default '',
  role_id text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
  access_code_hash text not null,
  access_code_hint text not null default '',
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (center_id, role_id) references staff_roles(center_id, id) on delete restrict
);

create index if not exists staff_members_center_idx on staff_members (center_id, role_id, status);

create table if not exists staff_sessions (
  token_hash text primary key,
  center_id text not null default 'libramont',
  member_id text not null references staff_members(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists staff_sessions_member_idx on staff_sessions (member_id, expires_at desc);

create table if not exists staff_access_events (
  id bigserial primary key,
  center_id text not null default 'libramont',
  actor_member_id text,
  event_type text not null,
  label text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_access_events_center_idx on staff_access_events (center_id, created_at desc);

drop trigger if exists staff_roles_set_updated_at on staff_roles;
create trigger staff_roles_set_updated_at
before update on staff_roles
for each row
execute function set_updated_at();

drop trigger if exists staff_members_set_updated_at on staff_members;
create trigger staff_members_set_updated_at
before update on staff_members
for each row
execute function set_updated_at();

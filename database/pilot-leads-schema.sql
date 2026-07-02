-- Pilot lead capture from the Pinlane marketing landing (pro.html).
-- Replaces the previous mailto flow that exposed a personal email address.

create table if not exists pilot_leads (
  id bigserial primary key,
  center_name text not null default '',
  contact_name text not null default '',
  email text not null default '',
  priority text not null default '',
  source text not null default 'landing',
  user_agent text not null default '',
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'archived')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pilot_leads_created_idx
  on pilot_leads (created_at desc);

create index if not exists pilot_leads_status_idx
  on pilot_leads (status, created_at desc);

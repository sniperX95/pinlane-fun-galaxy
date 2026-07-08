-- Demandes SUR MESURE (entreprises / besoins spéciaux) capturées depuis la page
-- client publique. Ce sont des LEADS, pas des réservations : ils n'occupent NI
-- créneau NI ressource dans le planning tant que le staff ne les convertit pas.
-- Table dédiée (comme pilot_leads) : zéro impact sur la table reservations.

create table if not exists custom_requests (
  id bigserial primary key,
  center_id text not null default 'libramont',
  contact_name text not null default '',
  company text not null default '',
  email text not null default '',
  phone text not null default '',
  requested_date text not null default '',
  pax integer not null default 0,
  occasion text not null default '',
  message text not null default '',
  source text not null default 'client',
  status text not null default 'new' check (status in ('new', 'in_progress', 'handled', 'archived')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists custom_requests_status_idx
  on custom_requests (center_id, status, created_at desc);

create index if not exists custom_requests_created_idx
  on custom_requests (created_at desc);

drop trigger if exists custom_requests_set_updated_at on custom_requests;
create trigger custom_requests_set_updated_at
before update on custom_requests
for each row
execute function set_updated_at();

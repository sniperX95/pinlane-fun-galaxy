-- Campagnes email réelles : segment CRM → envois via la pipeline
-- communications (templateId = 'campaign_<id>'). opens/clicks : structure
-- prête, non alimentée tant qu'aucun pixel/lien tracké n'existe (jamais de
-- faux chiffres).
create table if not exists campaigns (
  id bigserial primary key,
  center_id text not null default 'libramont' references centers (id),
  name text not null,
  objective text not null default '',
  segment text not null,
  subject text not null default '',
  body text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'cancelled')),
  scheduled_at timestamptz,
  recipient_count integer not null default 0,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  opens integer not null default 0,
  clicks integer not null default 0
);

create index if not exists campaigns_center_idx
  on campaigns (center_id, created_at desc);

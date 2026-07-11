-- Studio mails direction : modèles personnalisés + identités d'expéditeur.
create table if not exists email_templates (
  id bigserial primary key,
  center_id text not null default 'libramont' references centers (id),
  name text not null,
  category text not null default 'marketing'
    check (category in ('marketing', 'promotion', 'information', 'serieux', 'relance')),
  subject text not null default '',
  body text not null default '',
  created_by text not null default '',
  updated_at timestamptz not null default now(),
  archived boolean not null default false
);

create index if not exists email_templates_center_idx
  on email_templates (center_id, archived, category);

create table if not exists email_identities (
  id bigserial primary key,
  center_id text not null default 'libramont' references centers (id),
  label text not null,
  email text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists email_identities_center_idx
  on email_identities (center_id);

-- Notes client persistantes + config des séquences automatiques.
--
-- client_notes : la mémoire terrain par client (allergies, prénom de l'enfant,
-- préférences). Clé = phone|email normalisé (même clé que le CRM front).
--
-- center_automation_settings : ON/OFF des séquences d'emails automatiques
-- (confirmation, rappel 48 h, merci post-visite, anniversaire J-30,
-- réactivation dormants). Le jsonb `settings` ne stocke que les écarts aux
-- défauts — les défauts vivent dans lib/ops-communications.js
-- (AUTOMATION_DEFAULTS) pour rester versionnés avec le code.

create table if not exists client_notes (
  center_id text not null default 'libramont',
  client_key text not null,
  body text not null default '',
  updated_at timestamptz not null default now(),
  primary key (center_id, client_key)
);

create table if not exists center_automation_settings (
  center_id text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

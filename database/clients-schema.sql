-- Couche CLIENT (locataire Pinlane), 2026-07-21.
--
-- Jusqu'ici Pinlane etait mono-client : les centres (libramont, gembloux,
-- ciney) etaient le sommet du modele, et "Fun Galaxy" n'existait qu'implicitement.
-- Cette migration introduit la notion d'ENTREPRISE CLIENTE au-dessus des centres,
-- pour que le proprietaire de Pinlane (Movsar) gere ses clients : en ajouter,
-- provisionner leurs centres et leurs acces cle en main, suivre leur statut.
--
-- Additive et idempotente : les centres existants sont rattaches a un client
-- 'fungalaxy' seed ici, donc le comportement actuel est INCHANGE.

create table if not exists clients (
  id text primary key,                         -- slug kebab-case (bowling-du-lac)
  name text not null,                          -- raison sociale affichee
  status text not null default 'active'
    check (status in ('active', 'trial', 'suspended', 'churned')),
  plan text not null default 'standard',
  contact_email text not null default '',
  contact_phone text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rattachement des centres a leur client. Nullable + defaut au backfill : un
-- centre sans client reste exploitable (compat), mais l'UI proprietaire les
-- regroupe par client.
alter table centers add column if not exists client_id text;
create index if not exists centers_client_idx on centers (client_id);

-- Le client historique : Fun Galaxy possede les 3 centres existants.
insert into clients (id, name, status, plan)
values ('fungalaxy', 'Fun Galaxy', 'active', 'standard')
on conflict (id) do nothing;

update centers set client_id = 'fungalaxy' where client_id is null;

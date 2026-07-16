-- SECOND CERVEAU des agents marketing : l'ADN du secteur.
--
-- Deux memoires cohabitent, et elles ne disent pas la meme chose :
--
--   marketing_patterns = ce qui marche CHEZ NOUS, mesure (effet net vs baseline
--                        sur les vraies reservations des deux centres).
--   marketing_dna      = ce qui marche DANS LE SECTEUR, recherche depuis des
--                        sources publiques (sites, etudes, presse, benchmarks).
--
-- L'ADN est le PRIOR : il sert quand on n'a encore rien mesure (n faible, c'est
-- le cas d'un tenant a deux centres). Le mesure est le POSTERIOR : des qu'il
-- contredit l'ADN sur un contexte donne, c'est le mesure qui gagne. Un pattern
-- appris sur nos vraies reservations bat une regle lue dans un blog.
--
-- Legalite : aucune ligne d'ici ne peut venir d'un scraping d'Instagram, de
-- Facebook, de LinkedIn ou de TikTok (violation de leurs CGU, risque de ban des
-- pages du client). Les sources licites sont : le web public, les sites des
-- centres eux-memes, la presse, les etudes et benchmarks publies, et le
-- « colle-un-post » ou c'est l'HUMAIN qui apporte ce qu'il a vu. La colonne
-- source est obligatoire et non vide : une regle sans source ne rentre pas.

create table if not exists marketing_dna (
  id           bigserial primary key,
  angle        text not null,                    -- 'facebook-local', 'instagram-visuel', 'anniversaire'...
  channel      text not null default '',         -- '' = transverse, sinon facebook|instagram|tiktok|linkedin|email|sms
  nom          text not null,                    -- nom court du pattern
  regle        text not null,                    -- la regle actionnable, injectable telle quelle dans un prompt
  exemple      text not null default '',         -- exemple reel/reproduit, ou vide
  preuve       text not null default '',         -- pourquoi on sait que ca marche
  source       text not null,                    -- URL. Obligatoire : pas de source, pas de regle.
  confiance    text not null default 'speculatif',  -- solide | plausible | speculatif
  origine      text not null default 'recherche',   -- recherche | colle-un-post | mesure
  actif        boolean not null default true,    -- desactivable sans perdre l'historique
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Idempotence de l'ingestion : reingerer la meme recherche met a jour au lieu
  -- de dupliquer. Le workflow de recherche tourne en boucle, il DOIT converger.
  unique (angle, nom)
);

alter table marketing_dna add column if not exists channel text not null default '';
alter table marketing_dna add column if not exists origine text not null default 'recherche';
alter table marketing_dna add column if not exists actif boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'marketing_dna_confiance_check') then
    alter table marketing_dna add constraint marketing_dna_confiance_check
      check (confiance in ('solide', 'plausible', 'speculatif'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_dna_source_non_vide') then
    alter table marketing_dna add constraint marketing_dna_source_non_vide
      check (length(trim(source)) > 0);
  end if;
end $$;

-- Selection par canal : on tire les regles du canal + les transverses, les plus
-- solides d'abord. C'est la requete du chemin chaud (chaque generation).
create index if not exists marketing_dna_pick_idx
  on marketing_dna (actif, channel, confiance);

create index if not exists marketing_dna_angle_idx
  on marketing_dna (angle);

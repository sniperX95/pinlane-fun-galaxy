-- LE STRATEGE : le plan marketing pluri-semaines (Phase 4).
--
-- Une ligne = un plan pour un centre, sur un horizon date. Le detail des
-- semaines vit dans payload (jsonb) : la forme d'une semaine bougera plus vite
-- qu'un schema SQL, et personne ne requete l'interieur d'une semaine en SQL.
--
-- POURQUOI CE PLAN N'EST PAS UNE STRATEGIE INVENTEE
-- Constate le 2026-07-16 sur les vraies donnees de prod : marketing_patterns
-- contient 0 pattern mesure et le seul fait disponible est « donnees encore
-- jeunes (18 jours), tendances indicatives, pas de conclusion ferme ». Un
-- stratege qui pretendrait planifier sur « ce qui marche chez nous » mentirait,
-- comme l'IA mentait en promettant du Karting VR.
-- Le plan s'appuie donc sur ce qui est REELLEMENT solide a un horizon de
-- plusieurs semaines : le calendrier (conges scolaires FWB, jours feries
-- calcules, evenements locaux dates). La meteo ne porte qu'a 7 jours et ne peut
-- pas fonder un plan a 8 semaines : elle n'entre pas ici.
-- Chaque semaine porte sa confiance. Quand marketing_patterns se remplira, le
-- mesure prendra le dessus, et c'est le meme code qui le lira.
create table if not exists marketing_plans (
  id          bigserial primary key,
  center_id   text not null,
  from_date   date not null,
  to_date     date not null,
  status      text not null default 'proposed',   -- proposed | accepted | archived
  horizon     integer not null default 8,         -- nombre de semaines couvertes
  mode        text not null default 'rules',      -- rules | ai : qui a redige
  payload     jsonb not null default '{}'::jsonb, -- { weeks: [...], context: {...} }
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table marketing_plans add column if not exists mode text not null default 'rules';
alter table marketing_plans add column if not exists horizon integer not null default 8;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'marketing_plans_status_check') then
    alter table marketing_plans add constraint marketing_plans_status_check
      check (status in ('proposed', 'accepted', 'archived'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_plans_dates_check') then
    alter table marketing_plans add constraint marketing_plans_dates_check
      check (to_date >= from_date);
  end if;
end $$;

-- Un seul plan vivant par centre et par date de depart : regenerer remplace,
-- ne duplique pas. Le job tourne sur une queue avec retries, donc il DOIT etre
-- idempotent, sinon un retry cree un second plan.
create unique index if not exists marketing_plans_live_idx
  on marketing_plans (center_id, from_date)
  where status <> 'archived';

create index if not exists marketing_plans_center_idx
  on marketing_plans (center_id, created_at desc);

-- ============================================================================
-- Portee ENTREPRISE du catalogue (2026-08-20) : deux clients Pinlane ne
-- partagent plus rien, deux centres d'un MEME client continuent de partager.
-- ============================================================================
--
-- LE PROBLEME, mesure le 2026-08-20 sur la base de production
--
-- `formulas` avait `id text primary key` : AUCUNE portee. Consequences reelles,
-- pas theoriques :
--   * `createFormula` inserait une ligne globale -> la formule d'un client
--     apparaissait dans le tunnel de TOUS les autres.
--   * `updateFormula` sur une formule du socle materialisait la ligne et la
--     patchait pour tout le monde (prix compris).
--   * `deleteFormula` (soft delete `active=false`) la retirait chez TOUS.
-- `api/ops.js` l'ecrivait noir sur blanc : « Ces actions editent le catalogue
-- PARTAGE ». Trois entreprises existent deja en base (fungalaxy, mi12,
-- n4-bowling) : chaque jour de plus, demarcher un deuxieme bowling revenait a
-- risquer le catalogue du premier.
--
-- LA MAILLE EST L'ENTREPRISE, PAS LE CENTRE. Verbatim Movsar : « chaque centre
-- de pinlane doit etre completement isole sauf si c de la meme organisation ».
-- Libramont et Gembloux partagent : c'est voulu. Fun Galaxy et N4 ne partagent
-- rien.
--
-- LE MODELE : `owner_client_id` joue pour `formulas` EXACTEMENT le role que
-- `center_id` joue deja pour `activities` (migration 0038).
--   * 'all'        : catalogue PLATEFORME (le socle livre avec le produit et ce
--                    que le proprietaire edite pour tout le monde).
--   * '<clientId>' : propriete d'une entreprise. Sa ligne PRIME sur celle de la
--                    plateforme pour le meme id, et elle n'est lue que par les
--                    centres de cette entreprise.
-- Une entreprise qui n'a aucune ligne pour un id lit le socle : c'est ce qui
-- rend le changement invisible pour tout le monde le jour de son application.
--
-- POURQUOI LES LIGNES EXISTANTES VONT A 'fungalaxy'
-- Les 16 lignes de `formulas` en production ont ete ecrites par et pour Fun
-- Galaxy (14 seed backfillees + 2 customs de test desactivees). Mesure avant
-- d'ecrire cette migration : les 14 lignes seed sont IDENTIQUES au socle
-- fichier, zero ecart sur zero champ. Les rattacher a fungalaxy ne change donc
-- le catalogue de PERSONNE : Fun Galaxy lit ses propres lignes, les autres
-- retombent sur le fichier, meme contenu au champ pres.
--
-- `activities`, elle, ne contient que le backfill du FICHIER (12 lignes
-- source='seed', center_id='all', aucune custom) : c'est le catalogue
-- plateforme, il reste en 'all'.
--
-- Idempotente : chaque bloc verifie l'etat avant d'agir. Le runner enveloppe
-- deja chaque migration dans une transaction (BEGIN/COMMIT, ROLLBACK sur
-- erreur), et le DDL PostgreSQL est transactionnel : un echec ne laisse rien
-- a moitie applique. Rollback manuel : database/rollbacks/0042_catalog_client_scope.down.sql

alter table formulas      add column if not exists owner_client_id text not null default 'all';
alter table formula_steps add column if not exists owner_client_id text not null default 'all';
alter table activities    add column if not exists owner_client_id text not null default 'all';

-- ── formulas : cle primaire (id) -> (id, owner_client_id) ───────────────────
-- Le rattachement a fungalaxy vit DANS ce bloc : il ne doit s'executer qu'a la
-- toute premiere application, jamais sur une base deja portee (sinon il
-- happerait les lignes plateforme ecrites apres coup).
do $$
declare
  pk_cols text;
begin
  select string_agg(a.attname, ',' order by k.ord)
    into pk_cols
    from pg_constraint c
    join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'formulas'::regclass and c.contype = 'p';

  if pk_cols is distinct from 'id,owner_client_id' then
    update formulas      set owner_client_id = 'fungalaxy' where owner_client_id = 'all';
    update formula_steps set owner_client_id = 'fungalaxy' where owner_client_id = 'all';

    alter table formula_steps drop constraint if exists formula_steps_formula_id_fkey;
    alter table formulas      drop constraint if exists formulas_pkey;
    alter table formulas      add constraint formulas_pkey primary key (id, owner_client_id);
  end if;
end $$;

-- ── formula_steps : l'unicite et la cle etrangere suivent la portee ─────────
do $$
declare
  uq_cols text;
begin
  select string_agg(a.attname, ',' order by k.ord)
    into uq_cols
    from pg_constraint c
    join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'formula_steps'::regclass
     and c.contype = 'u'
     and c.conname = 'formula_steps_scope_position_key';

  if uq_cols is null then
    alter table formula_steps drop constraint if exists formula_steps_formula_id_position_key;
    alter table formula_steps
      add constraint formula_steps_scope_position_key unique (formula_id, owner_client_id, position);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'formula_steps'::regclass
       and conname = 'formula_steps_formula_scope_fkey'
  ) then
    alter table formula_steps
      add constraint formula_steps_formula_scope_fkey
      foreign key (formula_id, owner_client_id)
      references formulas (id, owner_client_id) on delete cascade;
  end if;
end $$;

-- ── activities : cle primaire (id, center_id) -> (id, center_id, owner_client_id) ──
do $$
declare
  pk_cols text;
begin
  select string_agg(a.attname, ',' order by k.ord)
    into pk_cols
    from pg_constraint c
    join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'activities'::regclass and c.contype = 'p';

  if pk_cols is distinct from 'id,center_id,owner_client_id' then
    alter table activities drop constraint if exists activities_pkey;
    alter table activities add constraint activities_pkey primary key (id, center_id, owner_client_id);
  end if;
end $$;

-- Lecture par portee : le catalogue se charge d'un coup, mais un centre ne lit
-- que 'all' plus sa propre entreprise.
create index if not exists formulas_owner_idx   on formulas (owner_client_id);
create index if not exists activities_owner_idx on activities (owner_client_id);

comment on column formulas.owner_client_id is
  'Portee ENTREPRISE de la formule. all = catalogue plateforme (socle + edition proprietaire), sinon clients.id : la ligne du client prime sur celle de la plateforme et n est lue que par SES centres.';
comment on column activities.owner_client_id is
  'Portee ENTREPRISE de l activite. Meme semantique que formulas.owner_client_id, combinee a center_id (all = tous les centres de cette portee).';

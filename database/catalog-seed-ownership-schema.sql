-- 0044 : LE CATALOGUE LIVRE DANS LE CODE APPARTIENT AU CLIENT QUI L A APPORTE.
--
-- La migration 0042 a donne les FORMULES a 'fungalaxy' mais a laisse les
-- ACTIVITES en portee plateforme ('all'), donc lisibles par toute entreprise.
-- Or ces 12 lignes sont le backfill du fichier ops-knowledge/activities.json :
-- laser game, minigolf blacklight, karting VR, golf o'Clock, fun run, plaine de
-- jeux... c'est le catalogue de Fun Galaxy, pas un socle generique.
--
-- Consequence mesuree le 2026-08-21 : N4, un bowling sans arene laser, se
-- voyait servir 13 activites dont laser_game et minigolf_blacklight, et MI12,
-- qui n'a rien configure, en voyait 12. Movsar : « pour N4 il doit rien avoir
-- comme activite ou quoi de Fun Galaxy, et ca pour tous les centres que je vais
-- creer aussi. »
--
-- CE QUE CETTE MIGRATION FAIT : elle deplace ces lignes vers leur proprietaire
-- reel. Fun Galaxy ne perd rien (ses trois centres lisent la portee
-- 'fungalaxy'), les autres entreprises cessent d'heriter de son catalogue.
--
-- IDEMPOTENTE : un second passage ne trouve plus aucune ligne 'all'. La garde
-- NOT EXISTS protege la cle primaire composite (id, center_id,
-- owner_client_id) posee par 0042 dans le cas ou la ligne cible existerait
-- deja.
--
-- Rollback : database/rollbacks/0044_catalog_seed_ownership.down.sql

-- ETAPE 1 : CHACUN GARDE CE QU IL UTILISE.
--
-- Une formule d'un autre client peut CITER une activite du socle : mesure le
-- 2026-08-21, « Anniversaire enfants » de N4 a une etape `party_table` (table
-- d'anniversaire et gouter), et party_table appartient au socle. Deplacer le
-- socle sans copier cette ligne casserait une formule VENDUE : son etape
-- citerait une activite absente de son catalogue.
--
-- On copie donc, pour chaque entreprise autre que le proprietaire du socle, les
-- activites du socle que SES etapes citent. La copie garde son id (les etapes y
-- referent), sa source et ses champs : c'est la meme activite, rangee chez son
-- utilisateur.
insert into activities (
  id, center_id, owner_client_id, name, resource_type, duration_model,
  service_model, risk_drivers, planning_pressure, source, active, bookable,
  price_type, price_value, price_unit, booking_order, pricing, created_at, updated_at
)
select
  base.id, base.center_id, users.owner_client_id, base.name, base.resource_type,
  base.duration_model, base.service_model, base.risk_drivers, base.planning_pressure,
  base.source, base.active, base.bookable, base.price_type, base.price_value,
  base.price_unit, base.booking_order, base.pricing, now(), now()
from activities as base
join (
  select distinct owner_client_id, activity_id
    from formula_steps
   where owner_client_id is not null
     and owner_client_id not in ('all', 'fungalaxy')
     and activity_id is not null
     and activity_id <> ''
) as users on users.activity_id = base.id
where base.owner_client_id = 'all'
  and not exists (
    select 1
      from activities as existing
     where existing.id = base.id
       and existing.center_id = base.center_id
       and existing.owner_client_id = users.owner_client_id
  );

-- ETAPE 2 : le socle rejoint son proprietaire.
update activities as a
   set owner_client_id = 'fungalaxy',
       updated_at = now()
 where a.owner_client_id = 'all'
   and not exists (
     select 1
       from activities as existing
      where existing.id = a.id
        and existing.center_id = a.center_id
        and existing.owner_client_id = 'fungalaxy'
   );

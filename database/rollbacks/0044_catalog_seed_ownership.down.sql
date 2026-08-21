-- Rollback de 0044 : les activites du socle repassent en portee plateforme,
-- donc de nouveau lisibles par TOUTE entreprise (c'est l'etat d'avant, avec sa
-- fuite : un nouveau client heritait du catalogue de Fun Galaxy).
--
-- A n'executer que si le code de catalog-store est lui aussi revenu en arriere :
-- avec le code du 2026-08-21, le socle FICHIER reste de toute facon reserve a
-- son proprietaire, donc ce rollback seul ne rendrait pas les activites aux
-- autres entreprises.
--
-- Ne touche QUE les lignes que 0044 a deplacees : celles qui portent un id du
-- socle fichier. Une activite creee par Fun Galaxy depuis la console (source
-- 'custom') reste a elle.

update activities as a
   set owner_client_id = 'all',
       updated_at = now()
 where a.owner_client_id = 'fungalaxy'
   and a.source = 'seed'
   and not exists (
     select 1
       from activities as existing
      where existing.id = a.id
        and existing.center_id = a.center_id
        and existing.owner_client_id = 'all'
   );

-- Retour en arriere de 0062. Les privatisations redeviennent des fermetures
-- nommees : leurs lignes restent dans availability_blocks (jour, plage, portee,
-- nom dans reason) et continuent de bloquer la disponibilite. Seuls le type et
-- le lien vers la reservation du groupe partent : rien ne se rouvre a la vente.
-- Le code tolere l absence des colonnes (lecture `select *`) ; seule la pose
-- d une nouvelle privatisation attend de nouveau la migration.
alter table availability_blocks drop constraint if exists availability_blocks_kind_check;
alter table availability_blocks drop column if exists reservation_id;
alter table availability_blocks drop column if exists kind;
delete from schema_migrations where id = '0062_privatisation';

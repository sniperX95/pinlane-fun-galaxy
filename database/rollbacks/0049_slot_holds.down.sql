-- Rollback de 0049 : les blocages provisoires disparaissent. Aucune
-- reservation n est touchee ; un client en train de finir la sienne perd
-- seulement la garantie de ses horaires (la creation reverifie tout, comme
-- avant 0049).
drop table if exists slot_holds;
-- Apres execution : delete from schema_migrations where id = '0049_slot_holds';

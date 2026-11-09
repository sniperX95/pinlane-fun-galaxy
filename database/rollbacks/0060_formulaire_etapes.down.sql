-- Retour en arriere de 0060. La table ne porte que des compteurs d ecrans du
-- formulaire public (aucune reservation, aucun client, aucun montant) : elle
-- part avec ses index. Le formulaire continue de marcher sans elle : l envoi
-- d une etape vers une table absente est ignore.
drop table if exists formulaire_etapes;
delete from schema_migrations where id = '0060_formulaire_etapes';

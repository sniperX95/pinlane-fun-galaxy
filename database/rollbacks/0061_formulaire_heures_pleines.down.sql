-- Retour en arriere de 0061. La table ne porte que des compteurs d heures
-- completes touchees dans le formulaire public (aucune reservation, aucun
-- client, aucun montant) : elle part avec ses index. Le formulaire continue
-- de marcher sans elle : l envoi vers une table absente est ignore, et la
-- console affiche un tableau vide.
drop table if exists formulaire_heures_pleines;
delete from schema_migrations where id = '0061_formulaire_heures_pleines';

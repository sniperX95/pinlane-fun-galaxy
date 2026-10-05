-- Retour en arriere de 0055. Les colonnes restent (elles portent des donnees
-- que rien d autre ne garde) : seuls le trigger, les fonctions et les index
-- partent. Pour retirer aussi les colonnes, le faire a la main APRES export.
drop trigger if exists reservations_donnees on reservations;
drop function if exists pinlane_reservation_donnees();
drop function if exists pinlane_client_key(text, text, text);
drop index if exists reservations_client_key_idx;
drop index if exists reservations_source_idx;
delete from schema_migrations where id = '0055_donnees_marketing';

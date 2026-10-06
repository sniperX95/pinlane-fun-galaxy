-- Retour en arriere de 0056. Les colonnes restent (elles portent des donnees
-- que rien d autre ne garde) : seuls le trigger, la fonction et l index partent.
drop trigger if exists reservations_encaisse on reservations;
drop function if exists pinlane_reservation_encaisse();
drop index if exists reservations_absent_idx;
delete from schema_migrations where id = '0056_encaisse_absence';

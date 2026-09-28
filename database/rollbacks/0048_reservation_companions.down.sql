-- Rollback de 0048 : la colonne des accompagnants disparait. Les dossiers du
-- Kids Fun Day perdent le compte des adultes ; leur prix, fait sur les enfants
-- seuls, ne bouge pas.
alter table reservations drop constraint if exists reservations_companions_range;
alter table reservations drop column if exists companions;
-- Apres execution : delete from schema_migrations where id = '0048_reservation_companions';

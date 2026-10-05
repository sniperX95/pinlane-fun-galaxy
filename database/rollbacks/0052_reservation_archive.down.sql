-- Retour en arriere de 0052. Le registre des suppressions porte des donnees
-- client qui n existent plus nulle part ailleurs : on ne le DROP pas, on le
-- met de cote sous un autre nom (un retour en avant recree une table vide,
-- l ancienne reste lisible pour un export a la main).
alter table if exists reservation_archive rename to reservation_archive_retiree_0052;
alter index if exists reservation_archive_center_idx rename to reservation_archive_retiree_0052_center_idx;
alter index if exists reservation_archive_center_date_idx rename to reservation_archive_retiree_0052_center_date_idx;
alter index if exists reservation_archive_reservation_idx rename to reservation_archive_retiree_0052_reservation_idx;
delete from schema_migrations where id = '0052_reservation_archive';

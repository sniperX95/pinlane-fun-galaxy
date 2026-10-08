-- Retour en arriere de 0058. Les epingles sont un reglage du gerant, pas une
-- donnee qu on retrouve ailleurs : on ne les DROP pas, on les met de cote sous
-- un autre nom (un retour en avant recree une table vide, l ancienne reste
-- lisible pour les recopier a la main).
alter table if exists reservation_departs_epingles rename to reservation_departs_epingles_retiree_0058;
delete from schema_migrations where id = '0058_departs_epingles';

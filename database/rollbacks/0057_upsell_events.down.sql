-- Retour en arriere de 0057. La table ne porte que des statistiques de la
-- fenetre des offres (aucune reservation, aucun montant facture) : elle part
-- avec ses index.
drop table if exists upsell_events;
delete from schema_migrations where id = '0057_upsell_events';

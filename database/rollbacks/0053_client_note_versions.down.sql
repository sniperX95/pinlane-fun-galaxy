-- Retour en arriere de 0053. L historique des notes porte du texte client qui
-- n existe plus nulle part ailleurs : pas de DROP, la table est mise de cote
-- sous un autre nom (un retour en avant en recree une vide).
alter table if exists client_note_versions rename to client_note_versions_retiree_0053;
alter index if exists client_note_versions_key_idx rename to client_note_versions_retiree_0053_key_idx;
delete from schema_migrations where id = '0053_client_note_versions';

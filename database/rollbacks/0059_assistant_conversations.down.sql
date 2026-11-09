-- Retour en arriere de 0059. Les conversations des personnes et ce que l equipe a appris a l IA ne
-- se retrouvent nulle part ailleurs : on ne les DROP pas, on les met de cote sous un autre nom.
alter table if exists assistant_conversations rename to assistant_conversations_retiree_0059;
alter table if exists assistant_faits rename to assistant_faits_retiree_0059;
delete from schema_migrations where id = '0059_assistant_conversations';

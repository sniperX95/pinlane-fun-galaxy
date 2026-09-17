-- Rollback de 0047 : les fils, les evenements du fournisseur et les lectures
-- disparaissent, ainsi que les colonnes de suivi ajoutees a communications.
-- PERTE ASSUMEE : le regroupement en fils (reconstruisible par le rattrapage
-- de 0047 rejoue), les lectures par l equipe et l historique des evenements
-- (remis, ouvert, clique). Les mails eux-memes ne bougent pas.
drop table if exists communication_reads;
drop index if exists email_events_comm_idx;
drop index if exists email_events_key_idx;
drop table if exists email_events;
drop index if exists communications_provider_idx;
drop index if exists communications_message_id_idx;
drop index if exists communications_thread_idx;
alter table communications drop column if exists complained_at;
alter table communications drop column if exists bounced_at;
alter table communications drop column if exists click_count;
alter table communications drop column if exists clicked_at;
alter table communications drop column if exists open_count;
alter table communications drop column if exists opened_at;
alter table communications drop column if exists delivered_at;
alter table communications drop column if exists references_ids;
alter table communications drop column if exists in_reply_to;
alter table communications drop column if exists message_id;
alter table communications drop column if exists thread_id;
drop index if exists email_threads_contact_idx;
drop index if exists email_threads_center_idx;
drop table if exists email_threads;

-- Agent email (Emails & relances v3) :
-- 1. Mémoire apprenante : quand le staff corrige une réponse proposée avant
--    envoi, la leçon est stockée et réinjectée dans le brain de l'agent.
-- 2. Statut 'received' : les emails ENTRANTS (webhook/collage) vivent dans la
--    table communications existante (direction='inbound'), il faut donc
--    étendre la contrainte de statut historique.

create table if not exists email_agent_memory (
  id serial primary key,
  center_id text not null,
  intent text not null default 'autre',
  question_excerpt text not null default '',
  learned_reply text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists email_agent_memory_center_idx
  on email_agent_memory (center_id, created_at desc);

alter table communications drop constraint if exists communications_status_check;
alter table communications add constraint communications_status_check
  check (status in ('draft', 'queued', 'sent', 'delivered', 'failed', 'cancelled', 'received'));

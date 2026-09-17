-- 0047 : LES FILS DE CONVERSATION, LE SUIVI DE REMISE ET LES LECTURES (2026-09-16).
--
-- POURQUOI. Chaque reponse d un client faisait un message a part dans la
-- boite ; personne ne savait qui avait lu un mail recu, ni si un mail envoye
-- etait arrive, ouvert, clique ou revenu en erreur. Trois tables et douze
-- colonnes, toutes additives, toutes idempotentes :
--
--   email_threads        : un fil par conversation (le message d origine, nos
--                          reponses, les reponses du client). Borne par centre.
--   communications.*     : le rattachement au fil, les en-tetes RFC 5322 qui
--                          permettent de le retrouver (Message-ID, In-Reply-To,
--                          References) et le suivi de remise reporte par les
--                          evenements du fournisseur.
--   email_events         : chaque evenement du fournisseur, une fois (cle
--                          unique = l identifiant de livraison Svix). Jamais
--                          d adresse IP dans `data`.
--   communication_reads  : qui, dans l equipe, a lu quel mail recu, et quand.
--
-- AUCUNE ligne existante n est modifiee autrement que par le RATTRAPAGE de fin
-- de fichier, qui ne touche que les mails sans fil et s arrete de lui-meme.
-- Rollback : database/rollbacks/0047_email_threads.down.sql

create table if not exists email_threads (
  id bigserial primary key,
  -- Pas de centre par defaut : un fil sans centre est une erreur, jamais un fil
  -- de Libramont.
  center_id text not null references centers (id),
  contact_email text not null default '',
  contact_name text not null default '',
  subject text not null default '',
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  origin text not null default 'inbound' check (origin in ('inbound', 'outbound')),
  root_communication_id bigint,
  message_count integer not null default 0,
  inbound_count integer not null default 0,
  outbound_count integer not null default 0,
  first_message_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_threads_center_idx on email_threads (center_id, last_message_at desc);
create index if not exists email_threads_contact_idx on email_threads (center_id, lower(contact_email));

alter table communications add column if not exists thread_id bigint references email_threads (id) on delete set null;
-- Message-ID RFC 5322, chevrons compris : c est ce que citent In-Reply-To et
-- References de la reponse du client.
alter table communications add column if not exists message_id text;
alter table communications add column if not exists in_reply_to text;
alter table communications add column if not exists references_ids text not null default '';
alter table communications add column if not exists delivered_at timestamptz;
-- Premiere ouverture ; le compteur suit les suivantes.
alter table communications add column if not exists opened_at timestamptz;
alter table communications add column if not exists open_count integer not null default 0;
alter table communications add column if not exists clicked_at timestamptz;
alter table communications add column if not exists click_count integer not null default 0;
alter table communications add column if not exists bounced_at timestamptz;
alter table communications add column if not exists complained_at timestamptz;
create index if not exists communications_thread_idx on communications (thread_id, created_at asc);
create index if not exists communications_message_id_idx on communications (message_id) where message_id is not null;
create index if not exists communications_provider_idx on communications (provider_message_id) where provider_message_id is not null;

create table if not exists email_events (
  id bigserial primary key,
  center_id text not null default '',
  communication_id bigint references communications (id) on delete cascade,
  provider text not null default 'resend',
  provider_email_id text not null default '',
  -- svix-id, sinon sha256(type|email_id|created_at) : une relivraison ne
  -- s insere jamais deux fois.
  event_key text not null,
  -- sent, delivered, delivery_delayed, opened, clicked, bounced, complained, failed
  event_type text not null,
  occurred_at timestamptz not null default now(),
  -- clic : {link, userAgent, timestamp} ; rebond : {type, message}. JAMAIS d adresse IP.
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists email_events_key_idx on email_events (event_key);
create index if not exists email_events_comm_idx on email_events (communication_id, occurred_at asc);

create table if not exists communication_reads (
  communication_id bigint not null references communications (id) on delete cascade,
  member_id text not null,
  member_name text not null default '',
  member_role text not null default '',
  first_read_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  read_count integer not null default 1,
  primary key (communication_id, member_id)
);

-- ---------------------------------------------------------------------------
-- RATTRAPAGE DES FILS EXISTANTS. Idempotent : seules les lignes email SANS fil
-- sont lues, et chaque etape se garde de recreer ce qui existe.
-- ---------------------------------------------------------------------------

-- 1. Un fil par message racine (aucun replyToCommunicationId), a son image :
--    contact, sujet sans prefixe de reponse, sens, statut.
--    N est PAS une racine : un entrant qui porte un prefixe de reponse (Re:,
--    TR:...) et qui repond a un message anterieur connu du meme centre, du meme
--    contact, au meme sujet sans prefixe, moins de 90 jours avant. C est la
--    reponse d un client a un mail deja en base : elle rejoint ce fil a
--    l etape 3b (meme regle que lib/email-threads.js au fil de l eau).
insert into email_threads (center_id, contact_email, contact_name, subject, status, origin, root_communication_id, first_message_at, last_message_at)
select c.center_id,
       lower(coalesce(c.recipient, '')),
       coalesce(c.payload->>'fromName', c.payload->>'clientName', c.payload->>'name', ''),
       btrim(regexp_replace(coalesce(c.subject, ''), '^\s*(((re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+)', '', 'i')),
       case
         when c.direction = 'inbound' and coalesce(c.payload->>'repliedAt', '') = '' then 'open'
         else 'answered'
       end,
       case when c.direction = 'inbound' then 'inbound' else 'outbound' end,
       c.id,
       c.created_at,
       c.created_at
from communications c
where c.channel = 'email'
  and c.thread_id is null
  and coalesce(c.payload->>'replyToCommunicationId', '') = ''
  and not exists (select 1 from email_threads t where t.root_communication_id = c.id)
  and not (
    c.direction = 'inbound'
    and c.subject ~* '^\s*(((re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+)'
    and exists (
      select 1 from communications p
      where p.channel = 'email'
        and p.center_id = c.center_id
        and p.id <> c.id
        and lower(coalesce(p.recipient, '')) = lower(coalesce(c.recipient, ''))
        and lower(btrim(regexp_replace(regexp_replace(coalesce(p.subject, ''), '^\s*(((re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+)', '', 'i'), '\s+', ' ', 'g')))
          = lower(btrim(regexp_replace(regexp_replace(coalesce(c.subject, ''), '^\s*(((re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+)', '', 'i'), '\s+', ' ', 'g')))
        and p.created_at < c.created_at
        and p.created_at > c.created_at - interval '90 days'
    )
  );

-- 2. Les racines rejoignent leur fil.
update communications
set thread_id = t.id
from email_threads t
where t.root_communication_id = communications.id
  and communications.thread_id is null;

-- 3. Les reponses prennent le fil du message repondu (meme centre).
update communications c
set thread_id = p.thread_id
from communications p
where c.channel = 'email'
  and c.thread_id is null
  and coalesce(c.payload->>'replyToCommunicationId', '') ~ '^[0-9]+$'
  and p.id = (c.payload->>'replyToCommunicationId')::bigint
  and p.center_id = c.center_id
  and p.thread_id is not null;

-- 3b. La reponse d un client (entrant a prefixe de reponse, ecarte de l etape 1)
--     rejoint le fil du message anterieur le plus recent qui en a un : meme
--     centre, meme contact, meme sujet sans prefixe, moins de 90 jours avant.
--     Une chaine « Re: Re: » remonte ainsi jusqu a la racine.
update communications c
set thread_id = (
  select p.thread_id from communications p
  where p.channel = 'email'
    and p.center_id = c.center_id
    and p.id <> c.id
    and p.thread_id is not null
    and lower(coalesce(p.recipient, '')) = lower(coalesce(c.recipient, ''))
    and lower(btrim(regexp_replace(regexp_replace(coalesce(p.subject, ''), '^\s*(((re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+)', '', 'i'), '\s+', ' ', 'g')))
      = lower(btrim(regexp_replace(regexp_replace(coalesce(c.subject, ''), '^\s*(((re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+)', '', 'i'), '\s+', ' ', 'g')))
    and p.created_at < c.created_at
    and p.created_at > c.created_at - interval '90 days'
  order by p.created_at desc, p.id desc
  limit 1
)
where c.channel = 'email'
  and c.thread_id is null
  and c.direction = 'inbound'
  and c.subject ~* '^\s*(((re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+)'
  and exists (
    select 1 from communications p
    where p.channel = 'email'
      and p.center_id = c.center_id
      and p.id <> c.id
      and p.thread_id is not null
      and lower(coalesce(p.recipient, '')) = lower(coalesce(c.recipient, ''))
      and lower(btrim(regexp_replace(regexp_replace(coalesce(p.subject, ''), '^\s*(((re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+)', '', 'i'), '\s+', ' ', 'g')))
        = lower(btrim(regexp_replace(regexp_replace(coalesce(c.subject, ''), '^\s*(((re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+)', '', 'i'), '\s+', ' ', 'g')))
      and p.created_at < c.created_at
      and p.created_at > c.created_at - interval '90 days'
  );

-- 3c. Garde-fou : tout mail encore sans fil (un cas que 1, 3 et 3b n ont pas
--     couvert) devient la racine de son propre fil, puis le rejoint.
insert into email_threads (center_id, contact_email, contact_name, subject, status, origin, root_communication_id, first_message_at, last_message_at)
select c.center_id,
       lower(coalesce(c.recipient, '')),
       coalesce(c.payload->>'fromName', c.payload->>'clientName', c.payload->>'name', ''),
       btrim(regexp_replace(coalesce(c.subject, ''), '^\s*(((re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+)', '', 'i')),
       case
         when c.direction = 'inbound' and coalesce(c.payload->>'repliedAt', '') = '' then 'open'
         else 'answered'
       end,
       case when c.direction = 'inbound' then 'inbound' else 'outbound' end,
       c.id,
       c.created_at,
       c.created_at
from communications c
where c.channel = 'email'
  and c.thread_id is null
  and not exists (select 1 from email_threads t where t.root_communication_id = c.id);

update communications
set thread_id = t.id
from email_threads t
where t.root_communication_id = communications.id
  and communications.thread_id is null;

-- 4. Compteurs et dates recalcules depuis les messages.
update email_threads t
set message_count = s.n,
    inbound_count = s.n_in,
    outbound_count = s.n_out,
    first_message_at = s.first_at,
    last_message_at = s.last_at,
    last_inbound_at = s.last_in,
    last_outbound_at = s.last_out,
    updated_at = now()
from (
  select thread_id,
         count(*)::int as n,
         count(*) filter (where direction = 'inbound')::int as n_in,
         count(*) filter (where direction <> 'inbound')::int as n_out,
         min(created_at) as first_at,
         max(created_at) as last_at,
         max(created_at) filter (where direction = 'inbound') as last_in,
         max(coalesce(sent_at, created_at)) filter (where direction <> 'inbound') as last_out
  from communications
  where thread_id is not null
  group by thread_id
) s
where s.thread_id = t.id;

-- 5. Le statut, d apres le DERNIER message du fil (meme regle qu au fil de
--    l eau) : un entrant sans reponse laisse le fil « open », tout le reste est
--    « answered ». Un fil termine a la main n est pas rouvert.
update email_threads t
set status = case
      when d.direction = 'inbound' and coalesce(d.payload->>'repliedAt', '') = '' then 'open'
      else 'answered'
    end,
    updated_at = now()
from (
  select distinct on (thread_id) thread_id, direction, payload
  from communications
  where thread_id is not null
  order by thread_id, created_at desc, id desc
) d
where d.thread_id = t.id
  and t.status <> 'closed'
  and t.status <> case
      when d.direction = 'inbound' and coalesce(d.payload->>'repliedAt', '') = '' then 'open'
      else 'answered'
    end;

-- LES CONVERSATIONS DE CHACUN ET CE QUE L IA APPREND (migration 0059, 2026-11-09).
--
-- Ansar : « chaque role chaque personne a ses propre conversation avec l ia c pas commun avec le
-- centre ». Deux tables, deux regles opposees, lues uniquement par lib/assistant-memoire.js :
--
--   assistant_conversations : A UNE PERSONNE. member_id est la ligne staff qui a ecrit, sans cle
--   etrangere car la session de secours n a pas de ligne staff. Personne d autre, direction
--   comprise, ne lit une conversation : chaque requete porte la liste des lignes de la personne.
--   Les messages contiennent ce que la personne a vu, noms de clients compris.
--
--   assistant_faits : AU CENTRE. Ce que l equipe a appris a l IA, avec qui et quand. Une ligne
--   n arrive ici que par une action de la page, donc par un geste humain. Rien n est efface :
--   retire_le la met de cote.
--
-- Ajout seul, idempotent, rien d existant n est touche. Tant que ce fichier n est pas joue, le code
-- detecte 42P01 : les conversations restent sur l appareil et l apprentissage dit qu il attend.
create table if not exists assistant_conversations (
  id text primary key,
  member_id text not null,
  center_id text not null references centers(id),
  titre text not null default '',
  modele text not null default 'haiku',
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  nb_messages integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_conversations_membre_idx
  on assistant_conversations (member_id, updated_at desc);

create table if not exists assistant_faits (
  id bigserial primary key,
  center_id text not null references centers(id),
  texte text not null check (char_length(texte) between 3 and 500),
  origine text not null default 'panneau' check (origine in ('panneau', 'proposition', 'correction')),
  contexte text not null default '',
  appris_par_id text not null default '',
  appris_par_nom text not null default '',
  modifie_par_nom text not null default '',
  modifie_le timestamptz,
  retire_le timestamptz,
  retire_par_nom text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists assistant_faits_centre_idx
  on assistant_faits (center_id, created_at desc)
  where retire_le is null;

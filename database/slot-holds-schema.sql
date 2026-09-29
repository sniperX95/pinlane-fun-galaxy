-- LES HORAIRES CHOISIS SONT BLOQUES PENDANT QUE LE CLIENT FINIT SA
-- RESERVATION (2026-09-29). Movsar : « quand un client choisit ses horaires,
-- ils sont bloques pour lui pendant 10 minutes max, et ca bloque vraiment :
-- s il prend 2 pistes, ca compte comme s il avait ces 2 pistes ; au bout du
-- timer, s il n a pas confirme, ca annule et c est relibere, pareil pour le
-- laser game [...] si 3 personnes sont sur la meme page au meme moment ».
--
-- Une ligne = une reservation PROVISOIRE : le meme dossier qu une
-- reservation (pistes attribuees, sessions de l arene, programme et ses
-- installations comptees), sans aucune donnee personnelle, avec une
-- echeance. Toute lecture d occupation la compte tant que `released_at` est
-- vide et que `expires_at` est a venir. Aucune tache n est necessaire pour
-- liberer : l echeance passee suffit, la ligne ne compte plus.
--
-- Le jeton du client ne quitte jamais son navigateur en clair : la base n en
-- garde que l empreinte (sha256). L adresse IP non plus : son empreinte sert
-- seulement a plafonner les blocages simultanes d un meme appareil.
--
-- Table additive : aucune table existante n est modifiee.

create table if not exists slot_holds (
  id bigserial primary key,
  center_id text not null references centers(id) on delete cascade,
  date date not null,
  start_time text not null default '',
  token_hash text not null,
  ip_hash text not null default '',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text,
  reservation_id bigint references reservations(id) on delete set null,
  constraint slot_holds_release_reason_check check (
    release_reason is null or release_reason in ('replaced', 'released', 'converted')
  )
);

-- Les blocages ACTIFS d une journee : la lecture de chaque verification,
-- faite sous le verrou de la journee.
create index if not exists slot_holds_actifs_idx
  on slot_holds (center_id, date, expires_at)
  where released_at is null;

-- Un jeton, un seul blocage actif : un nouveau choix libere l ancien dans la
-- meme transaction, et deux onglets ne peuvent pas en tenir deux.
create unique index if not exists slot_holds_jeton_actif_idx
  on slot_holds (token_hash)
  where released_at is null;

-- Le plafond par appareil.
create index if not exists slot_holds_appareil_actifs_idx
  on slot_holds (ip_hash, expires_at)
  where released_at is null;

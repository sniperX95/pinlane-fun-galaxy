-- LES DEPARTS EPINGLES DE LA FENETRE RESERVER (migration 0058, 2026-10-08).
--
-- La fenetre Reserver de la console ouvre sur des « departs rapides » : les
-- compositions que le centre vend le plus ce jour de la semaine (calculees a
-- la lecture, sur les reservations, sans table), plus celles que le gerant
-- epingle parce qu il veut les voir en premier (« Anniversaire laser », « Team
-- building 3 h »). Seules ces epingles sont stockees ici : une ligne par
-- centre, une liste courte (8 au plus, controlee par lib/departs-rapides.js)
-- de compositions nommees { libelle, type, formuleId, duration, laserGames,
-- pax, activites }. Aucune donnee de client.
--
-- La lecture est fail-soft (lib/database.js, lireEpinglesDeparts) : tant que
-- cette migration n est pas jouee, la fenetre s ouvre sans epingle ; seule
-- l ecriture refuse, avec un message qui dit quoi faire.
create table if not exists reservation_departs_epingles (
  center_id text primary key references centers(id),
  epingles jsonb not null default '[]'::jsonb check (jsonb_typeof(epingles) = 'array'),
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

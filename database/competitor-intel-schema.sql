-- Renseignement concurrent enrichi (Phase 2 « Éclaireur », 2026-07-16).
-- Additif et idempotent. Deux axes :
--   1. Extraction STRUCTURÉE du site (prix/offres/événements) par snapshot,
--      au lieu d'un simple diff texte → nourrit la génération et l'affichage.
--   2. Snapshot Google Places (note + nombre d'avis) par concurrent — on ne
--      stocke QUE la note et le compte (jamais le texte des avis : interdit par
--      les Maps Platform Terms), rafraîchi périodiquement.
alter table competitor_snapshots
  add column if not exists signals jsonb not null default '[]'::jsonb;

alter table marketing_competitors
  add column if not exists place_id text;
alter table marketing_competitors
  add column if not exists rating numeric;
alter table marketing_competitors
  add column if not exists reviews_count integer;
alter table marketing_competitors
  add column if not exists places_checked_at timestamptz;

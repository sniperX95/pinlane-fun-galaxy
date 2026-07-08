-- Occasion DÉCLARÉE par le client (anniversaire, amis, entreprise, ecole, autre).
-- Remplace la catégorisation devinée côté staff par une donnée déclarée.
-- Colonne additive nullable-safe (défaut '') : aucune réécriture de table, les
-- anciennes réservations gardent '' et retombent sur l'heuristique staff.

alter table reservations
  add column if not exists occasion text not null default '';

create index if not exists reservations_occasion_idx
  on reservations (center_id, occasion)
  where occasion <> '';

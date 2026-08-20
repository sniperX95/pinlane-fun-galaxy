-- ============================================================================
-- Tarif d'activite PAR JOUR ET PAR CRENEAU (2026-08-21).
-- ============================================================================
--
-- POURQUOI
--
-- Une activite du catalogue n'avait qu'UN prix (`price_value`). N4 Bowling vend
-- sa Kara Box 10,00 EUR par personne, et 7,50 EUR le mercredi apres-midi : ce
-- deuxieme tarif n'etait pas exprimable sur une activite, il vivait donc dans
-- une formule, au mauvais endroit. Le bowling a recu ce mecanisme en premier
-- (paliers par jour dans la config du centre) ; cette colonne l'ouvre a
-- n'importe quelle activite.
--
-- LA FORME (validee par lib/activity-pricing.js, jamais par la base) :
--   { "mode": "per_person",
--     "tiers": [ { "days": [3], "fromMinutes": 720, "untilMinutes": 1080,
--                  "price": 7.5, "label": "Mercredi apres-midi" } ] }
-- Une LISTE D'EXCEPTIONS au prix de base : le premier palier qui correspond
-- gagne, aucun ne correspond, `price_value` s'applique. Un palier sans jour ni
-- fenetre est refuse a la normalisation : ce serait un prix de base deguise.
--
-- REGLE DE SURETE : tant que le creneau n'est pas choisi, c'est le prix de BASE
-- qui s'affiche. Le montant ne peut donc que baisser une fois l'heure connue,
-- jamais monter.
--
-- PORTEE : la colonne vit sur `activities`, dont la cle primaire porte deja
-- l'entreprise depuis la migration 0042. Un tarif de N4 n'existe donc que chez
-- N4, comme le reste de son catalogue.
--
-- Additive et idempotente. NULL = un seul prix, comportement d'avant.

alter table activities add column if not exists pricing jsonb;

comment on column activities.pricing is
  'Paliers de tarif par jour et par creneau, en exception du prix de base (price_value). Forme et bornes validees par lib/activity-pricing.js. NULL = un seul prix. Portee entreprise heritee de la cle primaire (migration 0042).';

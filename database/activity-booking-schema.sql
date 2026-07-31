-- ============================================================================
-- Reservabilite et tarif d'une ACTIVITE (le catalogue devient vendeur).
-- ============================================================================
--
-- POURQUOI
--
-- Le tunnel client ne proposait que bowling, laser et formules : un centre qui
-- vend aussi minigolf, billards, arcades ou playground ne pouvait ni les faire
-- reserver, ni savoir que les gens venaient pour elles. La table activities
-- decrivait l'activite pour le MOTEUR (ressource, duree, risques) ; il lui
-- manquait ce qu'il faut pour la VENDRE.
--
-- CE QUE CES COLONNES AJOUTENT
--   bookable      : l'activite est proposee dans le tunnel client. NULL = suivre
--                   le socle (ops-knowledge/activities.json), jamais "non".
--   price_type    : grid_bowling | grid_laser (grilles existantes, inchangees)
--                   | per_pax | per_unit_hour | on_site.
--   price_value   : le tarif du centre. NULL = pas encore saisi -> le tunnel
--                   affiche "regle sur place" et la reservation reste possible.
--                   Un tarif est une donnee de centre, JAMAIS une constante du
--                   code : deux centres du meme reseau ne facturent pas pareil.
--   price_unit    : le libelle de l'unite ("par personne", "par table et par
--                   heure"). Ce qui est ecrit au client, pas une convention.
--   booking_order : ordre d'affichage dans le tunnel.
--
-- INVARIANT (identique a la migration 0038) : toutes ces colonnes NULL sur une
-- ligne existante = comportement STRICTEMENT identique au fichier socle. Les 11
-- lignes seed deja backfillees les recoivent a NULL et ne changent donc rien ;
-- lib/catalog-store.js retombe sur le socle champ par champ tant qu'une valeur
-- n'est pas posee (et NON "la ligne DB prime meme vide", qui aurait efface le
-- socle sur toutes les activites deja en base).
--
-- Additive et idempotente : add column if not exists uniquement.

alter table activities
  add column if not exists bookable      boolean,
  add column if not exists price_type    text,
  add column if not exists price_value   numeric(10, 2),
  add column if not exists price_unit    text,
  add column if not exists booking_order integer;

comment on column activities.bookable is
  'Activite proposee dans le tunnel client. NULL = valeur du socle ops-knowledge/activities.json.';
comment on column activities.price_value is
  'Tarif du centre pour cette activite. NULL = non saisi : le tunnel affiche "regle sur place".';

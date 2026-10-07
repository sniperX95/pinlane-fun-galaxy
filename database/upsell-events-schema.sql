-- CE QUE LES OFFRES DE FIN DE RESERVATION FONT VRAIMENT (2026-10-07).
--
-- Movsar : « tout repertorie dans les stats, qui a pris les add-on, les
-- raisons, etc., pour savoir les raisons qui font le plus prendre un add-on ».
-- Une ligne par geste du client dans la fenetre « Envie d un peu plus ? » :
--   vue       l offre etait a l ecran (rang 0 = mise en avant) ;
--   vedette   le client l a fait passer devant ;
--   ajout     il a touche « Ajouter » ;
--   acceptee  le serveur l a posee dans le panier ;
--   annulee   il l a retiree (« Annuler ») ;
--   fermee    la fenetre s est fermee sans ajout ;
--   reservee  la reservation est partie avec elle (reservation_id).
-- AUCUNE DONNEE PERSONNELLE : `visite` est un identifiant tire au hasard par le
-- formulaire pour une seule visite de la page, jamais relie a un nom, un mail
-- ou une adresse IP. La raison est le code du fait qui la portait (attente,
-- pause, suite, centre), la promo son pourcentage prouve. Table additive :
-- rien d existant ne change.
create table if not exists upsell_events (
  id bigserial primary key,
  center_id text not null references centers(id),
  visite text not null,
  evenement text not null check (evenement in ('vue', 'vedette', 'ajout', 'acceptee', 'annulee', 'fermee', 'reservee')),
  carte text not null default '',
  genre text not null default '',
  activite text not null default '',
  raison text not null default '',
  priorite smallint,
  rang smallint,
  promo smallint,
  montant numeric(10, 2),
  personnes smallint,
  reservation_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists upsell_events_centre_date_idx on upsell_events (center_id, created_at desc);
create index if not exists upsell_events_visite_idx on upsell_events (visite);

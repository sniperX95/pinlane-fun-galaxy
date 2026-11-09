-- OU LES GENS S ARRETENT DANS LE FORMULAIRE (2026-11-09).
--
-- Ansar : « sur le formulaire voir ou les gens s arretent ». Une ligne par
-- ecran atteint, une seule fois par visite de la page :
--   reservation : date, activites, heures, contact, recap, fin ;
--   sur-mesure  : sm-groupe, sm-date, sm-envies, sm-contact, sm-recap, fin.
-- La console lit l ecran le plus loin atteint par chaque visite : c est la
-- que la personne s est arretee. La liste des ecrans fait foi dans
-- lib/formulaire-etapes.js ; test:formulaire-etapes rougit si cette table
-- s en ecarte.
-- AUCUNE DONNEE PERSONNELLE : `visite` est le meme identifiant tire au hasard
-- que celui des offres (upsell_events), valable pour une seule visite de la
-- page, jamais relie a un nom, un mail, un telephone ou une adresse. Aucun
-- cookie. Table additive : rien d existant ne change.
create table if not exists formulaire_etapes (
  id bigserial primary key,
  center_id text not null references centers(id),
  visite text not null,
  parcours text not null,
  etape text not null,
  created_at timestamptz not null default now(),
  constraint formulaire_etapes_connue check (
    (parcours = 'reservation' and etape in ('date', 'activites', 'heures', 'contact', 'recap', 'fin'))
    or (parcours = 'sur-mesure' and etape in ('sm-groupe', 'sm-date', 'sm-envies', 'sm-contact', 'sm-recap', 'fin'))
  )
);

create index if not exists formulaire_etapes_centre_date_idx on formulaire_etapes (center_id, created_at desc);
-- Un ecran ne compte qu une fois par visite : la base refuse le doublon.
create unique index if not exists formulaire_etapes_une_fois_idx on formulaire_etapes (center_id, visite, parcours, etape);

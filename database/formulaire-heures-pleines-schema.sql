-- LES HEURES COMPLETES QUE LES GENS VOULAIENT (2026-11-10).
--
-- Ansar : « samedi 15 h demandé 40 fois, complet ». Dans le formulaire public,
-- une heure complete reste affichee et se touche. Une ligne par toucher, une
-- seule fois par visite pour un meme jour, une meme heure, une meme activite :
--   jour     : la date que la personne voulait ;
--   heure    : l heure touchee, « HH:MM » ;
--   activite : l identifiant de l activite du centre, ou « arrivee » (l heure
--              d arrivee d une visite), ou « formule » (l heure d une formule) ;
--   formule  : l identifiant de la formule quand la personne en reservait une,
--              vide sinon ;
--   joueurs  : la taille du groupe a ce moment-la.
-- La regle (ce qui entre, la lecture) fait foi dans lib/formulaire-heures.js ;
-- test:formulaire-heures rougit si cette table s en ecarte.
-- AUCUNE DONNEE PERSONNELLE : `visite` est le meme identifiant tire au hasard
-- que celui des ecrans du formulaire (formulaire_etapes), valable pour une
-- seule visite de la page, jamais relie a un nom, un mail, un telephone ou une
-- adresse. Aucun cookie, aucun texte libre. Table additive : rien d existant
-- ne change, et aucune regle du planning ne la lit.
create table if not exists formulaire_heures_pleines (
  id bigserial primary key,
  center_id text not null references centers(id),
  visite text not null,
  jour date not null,
  heure text not null,
  activite text not null,
  formule text not null default '',
  joueurs integer,
  created_at timestamptz not null default now(),
  constraint formulaire_heures_pleines_heure check (heure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint formulaire_heures_pleines_textes check (
    char_length(visite) between 16 and 40
    and char_length(activite) between 1 and 60
    and char_length(formule) <= 60
    and (activite <> 'formule' or formule <> '')
  ),
  constraint formulaire_heures_pleines_joueurs check (joueurs is null or joueurs between 1 and 500)
);

create index if not exists formulaire_heures_pleines_centre_date_idx on formulaire_heures_pleines (center_id, created_at desc);
-- La meme heure touchee deux fois dans la meme visite ne compte qu une fois : la base refuse le doublon.
create unique index if not exists formulaire_heures_pleines_une_fois_idx on formulaire_heures_pleines (center_id, visite, jour, heure, activite, formule);

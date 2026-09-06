-- QUI EST EN TRAIN DE REPONDRE A CE MAIL (2026-09-06).
--
-- Deux personnes peuvent ouvrir la meme boite. Avant cette table, chacune
-- ecrivait sa reponse sans savoir que l autre ecrivait la sienne : le client
-- recevait deux reponses, parfois contradictoires, et personne ne s en rendait
-- compte. La synchronisation vivante de la console ne suffit pas a l eviter :
-- elle montre une reponse une fois PARTIE, pas pendant qu on la redige.
--
-- Une ligne par mail en cours de traitement, avec une DATE D EXPIRATION plutot
-- qu un verrou a liberer. C est deliberé : un onglet ferme, un navigateur qui
-- plante, une personne qui part en pause ne doivent jamais laisser un mail
-- bloque pour toujours. L ecran rafraichit sa prise tant qu il est ouvert ; des
-- qu il ne le fait plus, la prise tombe d elle-meme.
--
-- Le verrou est CONSULTATIF, pas contraignant : il previent, il n interdit
-- pas. Une gerante qui voit « Untel repond depuis 2 minutes » decide seule si
-- elle passe outre. Le produit ne sait pas ce qui se passe dans la piece.
create table if not exists ops_email_claims (
  communication_id bigint primary key references communications(id) on delete cascade,
  center_id text not null default 'libramont',
  member_id text not null default '',
  member_name text not null default '',
  claimed_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- La lecture qui compte : « les prises encore vivantes de ce centre ».
create index if not exists ops_email_claims_center_idx
  on ops_email_claims (center_id, expires_at desc);

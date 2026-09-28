-- Les ACCOMPAGNANTS d un dossier : des personnes presentes qui ne jouent pas
-- et ne paient pas l offre. Kids Fun Day, reserve « aux enfants de 5 a 12
-- ans » : Movsar, 2026-09-28, « demander enfants / adultes ; seuls les enfants
-- paient la formule ». `pax` reste le nombre de JOUEURS, celui qui fait le prix
-- et la capacite ; `companions` compte les adultes qui les accompagnent.
-- Colonne additive a defaut 0 : aucune reecriture de table, les dossiers
-- existants gardent 0 et rien ne change pour eux.

alter table reservations
  add column if not exists companions integer not null default 0;

alter table reservations
  drop constraint if exists reservations_companions_range;

alter table reservations
  add constraint reservations_companions_range check (companions >= 0 and companions <= 500);

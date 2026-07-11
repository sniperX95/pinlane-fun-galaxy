-- Maintenance datée des pistes : le statut « maintenance » ne s'applique
-- qu'aux dates de la fenêtre [maintenance_from, maintenance_until]
-- (borne nulle = illimité de ce côté). Levée automatique après la fenêtre.
alter table lane_statuses add column if not exists maintenance_from date;
alter table lane_statuses add column if not exists maintenance_until date;
alter table lane_statuses add column if not exists maintenance_note text not null default '';

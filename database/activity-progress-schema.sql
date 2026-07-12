-- Suivi des activités de formule : état « fait / pas fait » par activité incluse
-- dans une réservation (bowling, laser, minigolf, arcades, boissons...).
--
-- Colonne DÉDIÉE et SÉPARÉE de ops_plan À DESSEIN : ops_plan est régénéré à chaque
-- replan (moteur ops sur POST/PATCH formule + flux retard) ; y stocker l'état de
-- complétion le perdrait. activity_progress est une colonne propre, préservée par
-- normalizeReservationPayload (defaults) et jamais touchée par le replan.
--
-- Forme : { "<activityId>-<countIndex>": { "done": true, "doneAt": "<iso>", "by": "<nom staff>" } }
-- Une clé absente = activité pas encore faite. Additive nullable-safe (défaut '{}').

alter table reservations
  add column if not exists activity_progress jsonb not null default '{}'::jsonb;

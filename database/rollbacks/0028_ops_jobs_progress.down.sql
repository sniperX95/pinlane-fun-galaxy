-- Rollback de 0028_ops_jobs_progress. A jouer A LA MAIN sur Neon uniquement
-- si le code qui lit/ecrit ces colonnes a d'abord ete retire de la prod
-- (commit de retour pousse et deploye AVANT ce drop).
-- Perte assumee : les journaux d'etapes deja ecrits disparaissent. Aucune
-- donnee metier (reservations, plans, communications) n'est touchee.

alter table ops_jobs
  drop column if exists steps,
  drop column if exists steps_total,
  drop column if exists started_at;

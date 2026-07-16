-- 0028 : progression live des jobs ops.
--
-- Additif et nullable UNIQUEMENT : pas de default, pas de not null, donc zero
-- reecriture de table sur une base chargee. Le code deploye avant/apres cette
-- migration tolere l'absence comme la presence de ces colonnes.
--
-- steps : journal horodate des etapes REELLEMENT franchies par le handler du
--   job (jamais par la boucle de dispatch) : [{ "label": "...", "at": "ISO" }].
--   Un seul jsonb plutot que des colonnes step/step_index : l'historique
--   complet est la donnee utile (l'ecran montre ce que le serveur a fait, pas
--   seulement l'etat courant) et l'index courant se deduit de la longueur.
-- steps_total : nombre d'etapes annonce par le handler quand son pipeline est
--   fixe. Reste null quand le nombre d'etapes depend du chemin execute : un
--   compteur "3/5" qui finit a 4 serait une fausse progression.
-- started_at : premiere ecriture d'etape (mesure du delai avant 1re etape).
--
-- Rollback (dans database/rollbacks/0028_ops_jobs_progress.down.sql) :
--   alter table ops_jobs drop column steps, drop column steps_total,
--   drop column started_at;

alter table ops_jobs
  add column if not exists steps jsonb,
  add column if not exists steps_total integer,
  add column if not exists started_at timestamptz;

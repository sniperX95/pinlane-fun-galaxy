-- ============================================================================
-- reservation_archive : AUCUNE RESERVATION N EST PERDUE (migration 0052)
-- ============================================================================
--
-- Jusqu ici, supprimer une reservation depuis la console faisait un DELETE
-- definitif (lib/database.js, deleteReservation) : nom, telephone, e-mail,
-- notes, plan de piste, tout disparaissait. Le journal d audit (0031) gardait
-- un diff plafonne a 8 Ko, SANS le nom ni le telephone (la liste de champs
-- nommait `clientName` alors que l objet porte `name`), et sans le texte des
-- notes. Une suppression par erreur, un poste compromis ou une fausse
-- manipulation un samedi de rush etaient irreparables.
--
-- Cette table est le REGISTRE des suppressions : AVANT le DELETE, dans la
-- MEME transaction, la ligne entiere est copiee ici telle qu elle etait
-- (`payload` = to_jsonb(reservations.*), donc TOUTES les colonnes, y compris
-- celles qu une migration future ajoutera : aucune liste de champs a tenir a
-- jour, donc aucune derive possible). Si la copie echoue, la transaction est
-- annulee et la suppression est REFUSEE : on ne supprime jamais sans copie.
--
-- Restaurer (lib/database.js, restoreArchivedReservation) reinsere la ligne
-- avec son identifiant d origine ; si cet identifiant est deja repris, la
-- restauration echoue avec un message clair, jamais en ecrasant.
--
-- PAS de drapeau « supprime » sur `reservations` (soft delete) : plus de 260
-- lectures de cette table auraient du apprendre a l ignorer, et une seule
-- oubliee aurait montre des dossiers fantomes au planning.
--
-- PAS de cle etrangere vers centers(id) : meme raison que audit_log. Une copie
-- de sauvegarde ne doit jamais echouer a s ecrire a cause de l etat d une
-- AUTRE table. La lecture est scopee par centre, en parametre SQL.
--
-- RETENTION : aucune purge. NE PAS ajouter a OPS_LOG_TABLES dans
-- workers/ops-worker.js (le journal s auto-detruirait a 7 jours).
-- ============================================================================

create table if not exists reservation_archive (
  id bigserial primary key,
  center_id text not null default 'libramont',

  -- L identifiant d origine de la reservation : c est lui que la restauration
  -- redonne a la ligne, pour que les e-mails, les evenements terrain et les
  -- incidents qui le citent redeviennent coherents.
  reservation_id bigint not null,

  -- La ligne COMPLETE, telle qu elle etait au moment de la suppression
  -- (to_jsonb de la ligne : colonnes en snake_case, valeurs brutes).
  payload jsonb not null,

  -- Qui a supprime (identifiant et nom du membre quand la session le dit),
  -- et pourquoi, en texte libre.
  archived_by text not null default '',
  archived_at timestamptz not null default now(),
  reason text not null default '',

  -- Pose a la restauration : une archive restauree ne se restaure pas deux
  -- fois, et la liste dit ce qui est revenu au planning.
  restored_at timestamptz,
  restored_by text
);

-- « Qu a-t-on supprime dans CE centre cette semaine ? »
create index if not exists reservation_archive_center_idx
  on reservation_archive (center_id, archived_at desc);

-- « Les suppressions pour CE jour de visite » (la date de la reservation).
create index if not exists reservation_archive_center_date_idx
  on reservation_archive (center_id, (payload->>'date'));

-- « Cette reservation a-t-elle deja ete supprimee ? »
create index if not exists reservation_archive_reservation_idx
  on reservation_archive (reservation_id);

comment on table reservation_archive is
  'Registre des reservations supprimees : copie complete de la ligne, ecrite dans la transaction du DELETE (sans copie, pas de suppression). Restaurable avec son identifiant d origine. Aucune purge. NE PAS ajouter a OPS_LOG_TABLES dans workers/ops-worker.js.';

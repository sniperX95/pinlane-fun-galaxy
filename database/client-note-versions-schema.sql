-- ============================================================================
-- client_note_versions : CHAQUE VERSION D UNE NOTE CLIENT EST GARDEE (0053)
-- ============================================================================
--
-- client_notes (0018) est la memoire terrain d un client (allergies, prenom
-- de l enfant, preferences) : UNE ligne par client et par centre, ecrasee a
-- chaque enregistrement (upsert). Le journal d audit ne gardait que la
-- longueur du texte. Une note effacee par erreur, ou remplacee par un poste
-- qui avait une vieille copie, etait perdue.
--
-- Chaque enregistrement ecrit ici une ligne avec le TEXTE COMPLET de la
-- version enregistree, dans la MEME transaction que l upsert
-- (lib/customer-notes.js, saveCustomerNote) : si cette ligne ne peut pas
-- s ecrire, la note n est pas remplacee. L historique complet d un client se
-- relit par (center_id, client_key) ; la version courante y figure aussi.
--
-- Choix de la table plutot que des lignes d audit : la transaction garantit
-- qu aucune version n est perdue (le journal d audit, lui, s ecrit apres le
-- COMMIT et n est pas bloquant), aucun plafond de taille ni expurgation par
-- motif de clef ne vient tronquer un texte libre, et la relecture par client
-- est une requete d une ligne.
--
-- PAS de cle etrangere (meme raison que audit_log et reservation_archive :
-- une sauvegarde ne depend de l etat d aucune autre table).
-- RETENTION : aucune purge. NE PAS ajouter a OPS_LOG_TABLES.
-- ============================================================================

create table if not exists client_note_versions (
  id bigserial primary key,
  center_id text not null default 'libramont',

  -- La meme clef que client_notes (telephone ou e-mail normalise).
  client_key text not null,

  -- Le texte complet de la version enregistree, et qui l a ecrite.
  body text not null default '',
  updated_by text not null default '',

  -- `version` = client_notes.updated_at de cette version (ce que la console
  -- renvoie comme baseUpdatedAt), `base_version` = la version qu elle a
  -- remplacee (nulle a la creation).
  version timestamptz not null,
  base_version timestamptz,

  -- La reservation depuis laquelle la note a ete editee, quand il y en a une
  -- (la fiche CRM ecrit sans reservation).
  reservation_id bigint,

  saved_at timestamptz not null default now()
);

-- « L historique de la note de CE client » : la lecture du registre.
create index if not exists client_note_versions_key_idx
  on client_note_versions (center_id, client_key, version desc);

comment on table client_note_versions is
  'Toutes les versions des notes client internes, texte complet, ecrites dans la transaction de chaque enregistrement. Aucune purge. NE PAS ajouter a OPS_LOG_TABLES dans workers/ops-worker.js.';

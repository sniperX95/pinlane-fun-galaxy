-- 0029 : repare le dispatch des communications, casse par 0019.
--
-- 0019 (email-agent-schema) a reecrit communications_status_check pour
-- ajouter 'received' (emails entrants) mais a PERDU 'processing', le statut
-- que le worker pose pour revendiquer un message sans double envoi (0004,
-- communications-worker-schema). Consequence prod constatee : plus AUCUN
-- envoi automatique depuis le 2026-07-14 17:09 UTC, le claim echouait toutes
-- les ~10 minutes avec "violates check constraint communications_status_check"
-- (ops_worker_runs), 5 messages clients coinces en 'queued'.
--
-- La liste ci-dessous est l'union COMPLETE : 0004 + le 'received' de 0019.
-- Le gate scripts/communications-status-contract-check.js verrouille ce
-- contrat : toute future reecriture de la contrainte qui perd un statut que
-- le code ecrit fait echouer le CI au lieu de casser la prod en silence.
--
-- Rollback (a ne jouer que si ce fix devait etre annule, il recasserait le
-- dispatch) : reposer la contrainte de 0019.

alter table communications drop constraint if exists communications_status_check;
alter table communications
  add constraint communications_status_check
  check (status in ('draft', 'queued', 'processing', 'sent', 'delivered', 'failed', 'cancelled', 'received'));

-- Railway/worker-safe communication queue.
-- Additive migration: allows a worker to claim due messages without double sending.

alter table communications add column if not exists locked_at timestamptz;

alter table communications drop constraint if exists communications_status_check;
alter table communications
  add constraint communications_status_check
  check (status in ('draft', 'queued', 'processing', 'sent', 'delivered', 'failed', 'cancelled'));

create index if not exists communications_dispatch_idx
  on communications (status, scheduled_at, locked_at, id);

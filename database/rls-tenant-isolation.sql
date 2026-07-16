-- ============================================================================
-- ROW LEVEL SECURITY — tenant isolation (NOT yet wired into run-db-migrations.js)
-- ============================================================================
--
-- This file is a REVIEWED-BUT-NOT-ENABLED proposal. Enabling RLS blind against
-- production would break every query the instant the application stops sending a
-- valid center scope, because a pooled connection with RLS on and no GUC set
-- returns zero rows. Validate it against a staging database FIRST.
--
-- Required application change before enabling (lib/database.js):
--   * At the start of every request/transaction, set the tenant scope on the
--     connection with a TRANSACTION-LOCAL setting so it never leaks across the
--     shared pg pool:
--         select set_config('app.center_id', $1, true);   -- true = local
--   * For platform-owner / cross-tenant reads (centerId = 'all'), set:
--         select set_config('app.center_scope', 'all', true);
--     and keep those queries on a role that is BYPASSRLS, or add an explicit
--     "scope = all" branch to each policy as below.
--   * The migration/worker/cron paths that legitimately touch every tenant must
--     run as a BYPASSRLS role or set app.center_scope = 'all'.
--
-- Rollout: enable table-by-table behind an env flag (ENABLE_TENANT_RLS) so a
-- single misconfigured query surfaces in staging, not in the client's rush hour.
-- ============================================================================

do $$
declare
  target text;
  tenant_tables text[] := array[
    'reservations',
    'lane_statuses',
    'ops_events',
    'ops_agent_suggestions',
    'communications',
    'ops_simulation_runs',
    'ops_decision_logs',
    'staff_roles',
    'staff_members',
    'staff_access_events',
    'ops_jobs',
    'ops_delay_incidents'
  ];
begin
  foreach target in array tenant_tables loop
    if to_regclass(target) is not null then
      execute format('alter table %I enable row level security;', target);
      execute format('drop policy if exists %I on %I;', target || '_tenant_isolation', target);
      execute format(
        $f$
          create policy %I on %I
          using (
            coalesce(current_setting('app.center_scope', true), '') = 'all'
            or center_id = current_setting('app.center_id', true)
          )
          with check (
            coalesce(current_setting('app.center_scope', true), '') = 'all'
            or center_id = current_setting('app.center_id', true)
          );
        $f$,
        target || '_tenant_isolation',
        target
      );
    end if;
  end loop;
end
$$;

-- Tenant referential integrity: every center_id must point to a real center.
--
-- Constraints are added NOT VALID so the migration never fails on legacy rows;
-- they still enforce integrity on every new insert/update. Run
--   alter table <t> validate constraint <t>_center_fk;
-- later, per table, once legacy rows are confirmed clean.
--
-- ops_worker_runs is intentionally excluded: it is a platform-global table
-- with no center_id.

-- Make sure the three known centers exist before wiring foreign keys to them.
insert into centers (id, name, status, timezone)
values
  ('libramont', 'Fun Galaxy Libramont', 'active', 'Europe/Brussels'),
  ('gembloux', 'Fun Galaxy Gembloux', 'active', 'Europe/Brussels'),
  ('ciney', 'Fun Galaxy Ciney', 'planned', 'Europe/Brussels')
on conflict (id) do nothing;

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
      execute format('alter table %I drop constraint if exists %I;', target, target || '_center_fk');
      execute format(
        'alter table %I add constraint %I foreign key (center_id) references centers(id) not valid;',
        target,
        target || '_center_fk'
      );
    end if;
  end loop;
end
$$;

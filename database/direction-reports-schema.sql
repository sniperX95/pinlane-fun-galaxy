-- Bilans périodiques direction (hebdo / mensuel), générés puis éditables.
create table if not exists direction_reports (
  id bigserial primary key,
  center_id text not null default 'libramont' references centers (id),
  period_type text not null check (period_type in ('week', 'month')),
  period_start date not null,
  period_end date not null,
  title text not null default '',
  body_md text not null default '',
  generated_by text not null default 'deterministic',
  generated_at timestamptz not null default now(),
  edited_at timestamptz,
  edited_by text,
  unique (center_id, period_type, period_start)
);

create index if not exists direction_reports_center_period_idx
  on direction_reports (center_id, period_type, period_start desc);

-- Scope lane statuses by center so one venue cannot affect another venue's lanes.

alter table lane_statuses
  add column if not exists center_id text not null default 'libramont';

alter table lane_statuses
  drop constraint if exists lane_statuses_pkey;

alter table lane_statuses
  add constraint lane_statuses_pkey primary key (center_id, lane_number);

create index if not exists lane_statuses_center_idx
  on lane_statuses (center_id);

with known_centers as (
  select id as center_id from centers
  union select 'libramont'
  union select 'gembloux'
  union select 'ciney'
)
insert into lane_statuses (center_id, lane_number, status)
select center_id, lane_number, 'active'
from known_centers
cross join generate_series(1, 8) as lane_number
on conflict (center_id, lane_number) do nothing;

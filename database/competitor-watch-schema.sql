-- Veille concurrence (cerveau marketing).
--
-- marketing_competitors : les concurrents que le gérant surveille. Configurable
-- depuis la page Marketing (nom, site, compte Instagram informatif, notes).
-- Le sweep quotidien ne visite QUE les sites web (Instagram n'est pas
-- scrapable de façon fiable sans service tiers — les observations Insta se
-- saisissent à la main et nourrissent marketing_social_observations).
--
-- competitor_snapshots : 1 ligne = 1 visite du site avec changement détecté
-- (le contenu est haché — pas de snapshot si rien n'a bougé). `diff_summary`
-- est rempli par l'IA quand une clé LLM est disponible, sinon le changement
-- est signalé brut. `extracted_text` est borné (8 000 caractères).

create table if not exists marketing_competitors (
  id bigserial primary key,
  center_id text not null default 'libramont',
  name text not null,
  website_url text not null default '',
  instagram_handle text not null default '',
  notes text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_competitors_center_idx
  on marketing_competitors (center_id, enabled);

create table if not exists competitor_snapshots (
  id bigserial primary key,
  competitor_id bigint not null references marketing_competitors(id) on delete cascade,
  content_hash text not null,
  extracted_text text not null default '',
  diff_summary text not null default '',
  fetched_at timestamptz not null default now()
);

create index if not exists competitor_snapshots_competitor_idx
  on competitor_snapshots (competitor_id, fetched_at desc);

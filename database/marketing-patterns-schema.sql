-- Mémoire d'apprentissage par contexte (« machine de guerre » marketing, 2026-07-16).
--
-- Le maillon manquant entre le CAPTEUR (mesure J+14 des insights) et le
-- GÉNÉRATEUR (cerveau + idées). Agrège l'effet NET mesuré (résidu vs baseline
-- jour × météo × vacances) de chaque action publiée, PAR CONTEXTE, pour répondre
-- « quel type d'action, dans quel contexte, convertit chez CE centre » — et pour
-- réinjecter ce savoir dans la génération (réinjection déterministe : on priorise
-- les contextes prouvés positifs).
--
-- Aucune donnée personnelle. Rempli par aggregateMarketingPatterns() au cron,
-- APRÈS measureAppliedInsights(). Idempotent (upsert par context_key).
create table if not exists marketing_patterns (
  id            bigserial primary key,
  center_id     text not null,
  context_key   text not null,               -- 'kind|channel|trigger', ex 'post|facebook|evenement'
  kind          text not null default 'post',
  channel       text not null default '',
  trigger       text not null default '',
  avg_net_delta numeric,                      -- effet NET moyen (% de baseline), null si non mesurable
  avg_raw_delta numeric,                      -- effet BRUT moyen (%) — fallback quand le net manque
  n             integer not null default 0,   -- observations mesurées (delta non nul) qui alimentent la moyenne
  wins          integer not null default 0,   -- combien de ces actions ont été 'validated'
  confidence    text not null default 'exploratoire', -- exploratoire | signal | solide
  updated_at    timestamptz not null default now(),
  unique (center_id, context_key)
);

create index if not exists marketing_patterns_center_idx
  on marketing_patterns (center_id, avg_net_delta desc nulls last);

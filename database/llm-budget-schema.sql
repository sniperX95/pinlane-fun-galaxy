-- Ledger de dépense LLM (budget guard, 2026-07-16). Une ligne par mois, coût
-- USD cumulé + nombre d'appels. Sert de plafond dur : au-delà du budget mensuel
-- (LLM_MONTHLY_BUDGET_USD, défaut 5), tous les appels LLM basculent en
-- déterministe. Additif, idempotent, aucune donnée personnelle.
create table if not exists llm_spend (
  month      text primary key,          -- 'YYYY-MM'
  cost_usd   numeric not null default 0,
  calls      integer not null default 0,
  updated_at timestamptz not null default now()
);

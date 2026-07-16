-- Propositions unifiées (« Le Brief », refonte marketing 2026-07-17).
--
-- Les trois producteurs (idées du cron, plan du cerveau, demandes du gérant)
-- convergent vers UN objet : la Proposition, stockée dans marketing_insights
-- (le cycle proposé → publié → mesuré J+14 y existe déjà : applied_at EST la
-- date de publication, measureAppliedInsights fait la mesure).
--
-- Ce patch : élargit le CHECK de kind (le POST « C'est fait » du plan insérait
-- kind='plan_action' que le CHECK refusait : bug latent attrapé à la refonte),
-- ajoute payload (textes par réseau générés à la demande : { networks: {
-- facebook: { text, photoIdea, imagePrompt, bestSlot } }, trigger, degraded })
-- et due_date (échéance de publication : le tri de la file).

alter table marketing_insights drop constraint if exists marketing_insights_kind_check;
alter table marketing_insights
  add constraint marketing_insights_kind_check
  check (kind in ('insight', 'idea', 'experiment', 'plan_action', 'proposition'));

alter table marketing_insights add column if not exists payload jsonb not null default '{}'::jsonb;
alter table marketing_insights add column if not exists due_date date;

create index if not exists marketing_insights_due_idx
  on marketing_insights (center_id, status, due_date);

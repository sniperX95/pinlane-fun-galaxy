-- LE MODE DE VALIDATION D UNE FORMULE, REGLABLE PAR CENTRE (2026-10-05).
--
-- Movsar : les mails « à valider » doivent partir « seulement quand c est
-- quasi vraiment impossible », et « l idee c est de pouvoir rendre ca
-- parametrable completement cote produit ». Le mode vit desormais aussi dans
-- la couche des surcharges par centre (Tarifs & formules) :
--   recommended               seulement si le moteur ne trouve pas de plan sur
--   required_when_laser_busy  aussi quand l arene laser serait partagee
--   required                  toujours (choix commercial, ex. N4)
-- NULL = le centre suit le catalogue. Colonne additive, aucune ligne effacee.
alter table formule_overrides add column if not exists human_validation text;

-- Fun Galaxy : les formules 2, 4 et 5 passaient en validation par principe
-- (la 4 TOUJOURS, la 2 et la 5 des que l arene etait partagee), un mail et un
-- simple « demande recue » au client a chaque fois. Mesure du 2026-10-05 sur de
-- vraies reservations en ligne : 3 F4 sur 3 en validation. Elles passent en
-- « seulement si impossible » dans les trois centres. Un reglage deja pose par
-- un centre n est jamais ecrase (coalesce).
insert into formule_overrides (formule_id, center_id, human_validation, removed, updated_at)
select f.id, c.id, 'recommended', false, now()
  from (values ('f2'), ('f4'), ('f5')) as f(id)
 cross join (values ('libramont'), ('gembloux'), ('ciney')) as c(id)
on conflict (formule_id, center_id) do update
  set human_validation = coalesce(formule_overrides.human_validation, excluded.human_validation),
      updated_at = now();

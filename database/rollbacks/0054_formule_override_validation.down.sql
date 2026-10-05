-- Retour en arriere de 0054. Les lignes qui ne portaient QUE la validation
-- (la graine Fun Galaxy, ou un reglage de validation seul) disparaissent ;
-- toute autre surcharge (prix, nom, retrait, ordre) reste, sans sa colonne de
-- validation. Le catalogue reprend la main sur le mode de chaque formule.
delete from formule_overrides
 where human_validation is not null
   and name is null and price_value is null and price_old is null
   and enabled is null and removed = false and sort_index is null;
alter table formule_overrides drop column if exists human_validation;
delete from schema_migrations where id = '0054_formule_override_validation';

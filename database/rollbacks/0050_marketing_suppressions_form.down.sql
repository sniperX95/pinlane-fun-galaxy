-- Retour en arriere de 0050. Une opposition ne se perd JAMAIS : les retraits
-- poses par le formulaire deviennent des retraits de l equipe ('staff'), leur
-- origine gardee en tete de `reason`, puis la contrainte revient a trois
-- origines.
update marketing_suppressions
   set source = 'staff', reason = left('[formulaire de reservation] ' || reason, 500)
 where source = 'form';
alter table marketing_suppressions drop constraint if exists marketing_suppressions_source_check;
alter table marketing_suppressions add constraint marketing_suppressions_source_check
  check (source in ('link', 'staff', 'complaint'));
delete from schema_migrations where id = '0050_marketing_suppressions_form';

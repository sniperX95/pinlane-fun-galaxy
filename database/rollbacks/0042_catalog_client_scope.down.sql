-- Rollback de 0042_catalog_client_scope.
--
-- A n'executer QUE si la portee entreprise doit etre retiree en urgence. Elle
-- rend le catalogue PARTAGE entre tous les clients : c'est exactement la faille
-- que 0042 ferme. Ne l'executer que le temps de corriger, jamais comme etat
-- durable.
--
-- Les lignes d'un client autre que fungalaxy entreraient en collision avec la
-- cle primaire (id) restauree : on les SUPPRIME d'abord, en le disant. Aucune
-- donnee de reservation n'est touchee (reservations.formule_id n'a pas de FK et
-- garde son libelle).
--
-- Apres execution : delete from schema_migrations where id = '0042_catalog_client_scope';

delete from formula_steps where owner_client_id not in ('all', 'fungalaxy');
delete from formulas      where owner_client_id not in ('all', 'fungalaxy');
delete from activities    where owner_client_id not in ('all', 'fungalaxy');

-- Une seule ligne par id peut survivre : celle du client historique prime.
delete from formulas a
 where a.owner_client_id = 'all'
   and exists (select 1 from formulas b where b.id = a.id and b.owner_client_id = 'fungalaxy');
delete from activities a
 where a.owner_client_id = 'all'
   and exists (
     select 1 from activities b
      where b.id = a.id and b.center_id = a.center_id and b.owner_client_id = 'fungalaxy'
   );

alter table formula_steps drop constraint if exists formula_steps_formula_scope_fkey;
alter table formula_steps drop constraint if exists formula_steps_scope_position_key;

alter table formulas drop constraint if exists formulas_pkey;
alter table formulas add constraint formulas_pkey primary key (id);

alter table activities drop constraint if exists activities_pkey;
alter table activities add constraint activities_pkey primary key (id, center_id);

alter table formula_steps
  add constraint formula_steps_formula_id_position_key unique (formula_id, position);
alter table formula_steps
  add constraint formula_steps_formula_id_fkey
  foreign key (formula_id) references formulas (id) on delete cascade;

drop index if exists formulas_owner_idx;
drop index if exists activities_owner_idx;

alter table formulas      drop column if exists owner_client_id;
alter table formula_steps drop column if exists owner_client_id;
alter table activities    drop column if exists owner_client_id;

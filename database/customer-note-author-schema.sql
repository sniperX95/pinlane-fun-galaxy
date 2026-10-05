-- Reuse existing CRM memory. Additive: existing notes retain unknown author.
alter table client_notes add column if not exists updated_by text not null default '';
comment on column client_notes.updated_by is 'Dernier membre ayant modifié la note interne du client. Jamais exposée dans le formulaire public.';

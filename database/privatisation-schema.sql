-- ============================================================================
-- 0062 : la PRIVATISATION, un blocage de disponibilite qui a un nom
-- ============================================================================
--
-- POURQUOI
--
-- Marius, manager de Gembloux (18/11) : « est-ce que tu as prevu un onglet
-- privatisation ? Genre comme ca je suis sur que personne ne rajoute de
-- reservation a ce moment-la. » Une privatisation, c est un jour, une plage,
-- tout le centre ou des activites choisies, et un nom (le client ou
-- l evenement). Elle s ecrit dans availability_blocks, la table des
-- fermetures : les memes gardes la font respecter partout (formulaire en ligne,
-- comptoir, glisser du planning, assistant). Deux colonnes de plus :
--
--   * kind           : 'closure' (une fermeture, comme avant) ou 'private'
--                      (une privatisation). Le nom est dans `reason`. Le droit
--                      de privatiser (reservations.edit) ne retire jamais une
--                      fermeture : la suppression filtre sur kind = 'private'.
--   * reservation_id : la reservation du groupe prive, que sa propre
--                      privatisation ne bloque pas. Pas de cle etrangere : une
--                      reservation supprimee puis restauree (reservation_archive)
--                      garde son numero, et la privatisation la retrouve ; une
--                      privatisation ne disparait jamais avec un dossier.
--
-- INVARIANT : sans privatisation (aucune ligne kind = 'private'), la
-- disponibilite est identique au creneau pres. Toutes les lignes existantes
-- deviennent kind = 'closure', ce qu elles sont.
--
-- Le code lit `select *` : une base qui n a pas encore ces colonnes lit tout
-- comme des fermetures, et seule l ecriture d une privatisation attend la
-- migration (« La privatisation attend une mise a jour de la base »).
--
-- Additive et idempotente : rejouable sans effet.

alter table availability_blocks
  add column if not exists kind text not null default 'closure';

alter table availability_blocks
  add column if not exists reservation_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'availability_blocks_kind_check'
       and conrelid = 'availability_blocks'::regclass
  ) then
    alter table availability_blocks
      add constraint availability_blocks_kind_check check (kind in ('closure', 'private'));
  end if;
end
$$;

comment on column availability_blocks.kind is
  'closure : fermeture (centre, piste, activite, formule). private : privatisation, le nom du client ou de l evenement dans reason. Seul le droit de privatiser retire une ligne private (lib/availability-blocks.js retirerPrivatisation).';

comment on column availability_blocks.reservation_id is
  'La reservation du groupe prive (kind = private), que sa propre privatisation ne bloque pas. Sans cle etrangere : une reservation restauree garde son numero.';

-- CE QUI A VRAIMENT ETE ENCAISSE, ET QUI N EST PAS VENU (2026-10-06).
--
-- Suite de 0055 (Movsar : « qui paie quoi, combien »). Le prix d un dossier
-- est celui annonce au client ; l accueil encaisse parfois autre chose (remise,
-- geste, joueur en moins). Et un groupe qui ne vient pas n avait aucune trace :
-- il restait « a venir » puis disparaissait des chiffres.
--   amount_paid      montant reellement encaisse ; NULL = le prix du dossier ;
--   discount_reason  pourquoi il differe (obligatoire cote API s il differe) ;
--   absent_at        le groupe n est pas venu, pointe par l accueil.
-- La base tient la coherence (trigger) : un dossier qui n est plus « payé »
-- perd son montant encaisse ; un groupe pointe arrive ou paye n est plus absent.
alter table reservations add column if not exists amount_paid numeric(10, 2);
alter table reservations add column if not exists discount_reason text;
alter table reservations add column if not exists absent_at timestamptz;

create or replace function pinlane_reservation_encaisse()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from 'paid' then
    new.amount_paid := null;
    new.discount_reason := null;
  end if;
  if new.status in ('arrived', 'paid') then
    new.absent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reservations_encaisse on reservations;
create trigger reservations_encaisse
  before update of status on reservations
  for each row execute function pinlane_reservation_encaisse();

create index if not exists reservations_absent_idx on reservations (center_id, absent_at) where absent_at is not null;

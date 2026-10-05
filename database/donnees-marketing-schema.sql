-- LES DONNEES POUR COMPRENDRE LES CLIENTS (2026-10-05).
--
-- Movsar : « qui paie quoi, combien, combien de fois ils sont venus, d ou ils
-- viennent », pour le SEO, Tag Manager, le SEA et l agent IA marketing.
-- Trois colonnes additives sur reservations, aucune ligne effacee :
--   acquisition  d ou vient la reservation (source, campagne, gclid, fbclid,
--                pages, appareil), ecrite par l API ; NULL avant cette date ;
--   client_key   LE client, une seule regle pour tout Pinlane : les 9 derniers
--                chiffres du telephone, sinon l e-mail, sinon le nom. Tenue par
--                la base elle-meme (trigger) : aucun ecran ne la recalcule ;
--   paid_at      quand le dossier est passe « payé », pose par la base.
alter table reservations add column if not exists acquisition jsonb;
alter table reservations add column if not exists client_key text;
alter table reservations add column if not exists paid_at timestamptz;

create or replace function pinlane_client_key(p_phone text, p_email text, p_name text)
returns text language sql immutable as $$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
      then 'p:' || right(regexp_replace(p_phone, '\D', '', 'g'), 9)
    when nullif(trim(coalesce(p_email, '')), '') is not null
      then 'e:' || lower(trim(p_email))
    when nullif(trim(coalesce(p_name, '')), '') is not null
      then 'n:' || lower(trim(p_name))
    else null
  end
$$;

create or replace function pinlane_reservation_donnees()
returns trigger language plpgsql as $$
begin
  new.client_key := pinlane_client_key(new.phone, new.email, new.name);
  if new.status = 'paid' and new.paid_at is null then
    new.paid_at := now();
  elsif new.status <> 'paid' then
    new.paid_at := null;
  end if;
  return new;
end
$$;

drop trigger if exists reservations_donnees on reservations;
create trigger reservations_donnees
  before insert or update of phone, email, name, status on reservations
  for each row execute function pinlane_reservation_donnees();

-- L existant : la cle pour tous ; pour les dossiers deja payes, la date de
-- paiement relue dans le journal quand il l a, sinon la derniere modification.
update reservations set client_key = pinlane_client_key(phone, email, name) where client_key is null;
update reservations r
   set paid_at = coalesce((
     select max(a.occurred_at) from audit_log a
      where a.entity_type = 'reservation' and a.entity_id = r.id::text
        and a.action = 'setReservationStatus' and a.outcome = 'success'
   ), r.updated_at)
 where r.status = 'paid' and r.paid_at is null;

create index if not exists reservations_client_key_idx on reservations (center_id, client_key);
create index if not exists reservations_source_idx on reservations ((acquisition ->> 'source'));

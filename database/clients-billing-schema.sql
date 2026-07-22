-- Facturation CLIENT (ce que le client paie a Pinlane), 2026-07-22.
--
-- Complement additif de la couche CLIENT (0035_clients) : le prix mensuel que
-- chaque client (locataire Pinlane) verse au proprietaire. C'est le socle du
-- MRR cote proprietaire (somme des prix des clients au statut 'active') et du
-- revenu par client dans la vue Clients Pinlane.
--
-- Nullable A DESSEIN : un prix non renseigne veut dire "a definir", pas 0. La
-- vue proprietaire compte alors le client comme sans prix (clientsWithPrice) et
-- ne fabrique aucun chiffre de MRR (buildPlatformClients : null compte comme 0
-- dans la somme, mais le champ clientsWithPrice dit combien de prix sont poses).
-- Additive et idempotente : aucun impact sur le comportement existant tant
-- qu'aucun prix n'est pose. La borne applicative (0..100000) vit dans
-- lib/platform-clients.setClientBilling.

alter table clients add column if not exists monthly_price numeric(10, 2);

-- 0050 : une quatrieme origine de retrait marketing, « form » (2026-09-30).
--
-- Le client coche, au moment de reserver en ligne, « Je ne souhaite pas
-- recevoir les offres de <centre> par e-mail ». Les offres envoyees aux
-- clients qui ne la cochent pas reposent sur l exception « client existant »
-- du droit belge (arrete royal du 4 avril 2003 sur les publicites par
-- courrier electronique) : coordonnees obtenues lors d une vente, offres
-- analogues du MEME centre, faculte de s opposer au moment de la collecte et
-- dans chaque message (le lien de retrait, source 'link'). La case cochee EST
-- cette opposition : elle s enregistre ici comme les autres, avec le numero
-- de la reservation dans `reason`.
--
-- Seule difference avec les trois autres origines : une nouvelle reservation
-- SANS la case leve un retrait 'form' (le client avait la meme case sous les
-- yeux et ne l a pas cochee). Un retrait par lien, par l equipe ou par plainte
-- ne se leve JAMAIS ainsi (lib/marketing-suppression, appliquerChoixDeReservation).
--
-- Le nom de la contrainte est celui que Postgres a donne a la contrainte de
-- colonne de 0030 (marketing_suppressions_source_check). Idempotent.
alter table marketing_suppressions drop constraint if exists marketing_suppressions_source_check;
alter table marketing_suppressions add constraint marketing_suppressions_source_check
  check (source in ('link', 'staff', 'complaint', 'form'));

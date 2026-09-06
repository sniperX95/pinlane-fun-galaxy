-- Rollback de 0045 : la table des prises disparait.
-- Sans risque de perte metier : elle ne contient que des prises TEMPORAIRES
-- (qui est en train de repondre, maintenant), jamais un mail ni une reponse.
drop index if exists ops_email_claims_center_idx;
drop table if exists ops_email_claims;

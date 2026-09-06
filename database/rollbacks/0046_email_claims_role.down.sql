-- Rollback de 0046 : la colonne de role disparait.
-- Sans risque : elle ne contient qu un libelle copie sur une prise temporaire,
-- jamais une donnee metier.
alter table ops_email_claims drop column if exists member_role;

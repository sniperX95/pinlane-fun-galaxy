-- Migration 0041 : effectif et caractere optionnel PAR ETAPE de formule (P2),
-- contrainte d'ordre PAR FORMULE (P3).
--
-- Pourquoi : le concurrent sait donner a chaque activite d'une formule son
-- effectif propre et son caractere obligatoire/optionnel, et imposer un ordre.
-- Le moteur Pinlane sait deja les honorer (ops-engine : step.pax repris par
-- buildTimeline, applyOptionalSelection, orderConstraints filtrant les ordres
-- generes ; prouve par scripts/scenario-chain-matrix-check.js). Ces colonnes
-- donnent a la donnee CATALOGUE le droit de les porter : sans elles, la
-- canonicalisation du store (lib/catalog-store.js) n'a nulle part ou les lire.
--
-- Compatibilite : lib/catalog-store.js detecte la presence de ces colonnes a la
-- lecture (drapeau de capacite). AVANT application, il lit et ecrit la forme
-- historique : rien ne casse, rien n'est degrade. APRES application, les champs
-- circulent de bout en bout sans redeploiement du store.
--
-- Idempotente (add column if not exists). Aucune ligne existante n'est
-- modifiee : pax NULL = l'effectif du groupe s'applique (comportement
-- historique), optional false = etape obligatoire (comportement historique),
-- order_constraints NULL = aucun ordre impose (comportement historique).

alter table formula_steps
  add column if not exists pax integer,
  add column if not exists optional boolean not null default false;

alter table formulas
  add column if not exists order_constraints jsonb;

comment on column formula_steps.pax is
  'Effectif propre de l etape (P2). NULL = l effectif du groupe entier s applique. Repris par le moteur pour les pistes, vagues et installations.';
comment on column formula_steps.optional is
  'Etape optionnelle (P2) : incluse par defaut, retirable par le client (preference.excludedOptionalActivityIds). false = obligatoire.';
comment on column formulas.order_constraints is
  'Contrainte d ordre (P3) : liste JSON de paires [avant, apres] (ids d activite). Le moteur ecarte tout ordre genere qui les viole. NULL = ordre libre.';

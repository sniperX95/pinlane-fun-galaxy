-- ============================================================================
-- formule_overrides : la couche d'OVERRIDES du catalogue no-code
-- ============================================================================
--
-- POURQUOI CETTE TABLE
--
-- Le catalogue de base (formules + prix) vit AUJOURD'HUI en dur dans
-- ops-knowledge/formulas.json (14 formules, price {type:'per_pax', value,
-- oldValue}). Ce fichier reste le SOCLE : il est trace et embarque par le
-- bundler Vercel, il ne bouge pas. Cette table ne stocke QUE les ecarts voulus
-- depuis le panneau fondateur (nom, prix, activation, retrait, ordre), fusionnes
-- PAR-DESSUS le fichier a la lecture (lib/catalog-overrides.js).
--
-- INVARIANT CENTRAL, verrouille par scripts/catalog-overrides-check.js :
--   AUCUNE ligne ici = comportement STRICTEMENT identique au fichier. Une
--   formule sans override se comporte a l'identique d'aujourd'hui.
--
-- PORTEE (colonne center_id)
--   * 'all'        : l'override s'applique a TOUS les centres (valeur par defaut).
--   * '<centerId>' : override propre a un centre, qui PRIME sur 'all'.
--   La cle primaire (formule_id, center_id) garantit au plus un override 'all'
--   et au plus un override par centre, pour chaque formule.
--
-- SEMANTIQUE DES COLONNES : une colonne NULL = "pas d'ecart, garder la valeur du
-- fichier". Une colonne renseignee REMPLACE la valeur du socle pour la portee.
--   * name        : remplace formula.name
--   * price_value : remplace formula.price.value
--   * price_old   : remplace formula.price.oldValue
--   * enabled     : false => formule EXCLUE pour cette portee (NULL / true = visible)
--   * removed     : true  => formule EXCLUE pour cette portee (retrait franc)
--   * sort_index  : ordre d'affichage propose a l'editeur. JAMAIS applique par
--                   applyFormuleOverrides : la liste fusionnee garde l'ordre du
--                   fichier (le socle), l'editeur consomme sort_index a part.
--
-- Les BORNES (price 0..1000, name <= 120) sont appliquees COTE SERVEUR par
-- lib/catalog-overrides.js (upsertFormuleOverride) : la table reste tolerante,
-- le code valide. Aucune donnee client ici : ce sont des reglages catalogue.

create table if not exists formule_overrides (
  formule_id  text not null,
  center_id   text not null default 'all',
  name        text,
  price_value numeric(10,2),
  price_old   numeric(10,2),
  enabled     boolean,
  removed     boolean not null default false,
  sort_index  integer,
  updated_at  timestamptz default now(),
  primary key (formule_id, center_id)
);

-- Lecture par portee : la fusion charge tous les overrides d'un coup, mais un
-- editeur ou un tunnel centre peut filtrer par center_id.
create index if not exists formule_overrides_center_idx
  on formule_overrides (center_id);

comment on table formule_overrides is
  'Overrides du catalogue no-code fusionnes par-dessus ops-knowledge/formulas.json (le fichier reste le socle). Portee center_id=all ou un centre precis (le centre prime). Aucune ligne = comportement identique au fichier. Bornes validees cote serveur (lib/catalog-overrides.js).';

-- ── Dismiss des incidents console (Plateforme > Incidents) ──────────────────
--
-- Le fondateur doit pouvoir ACQUITTER un groupe d'erreurs console (identifie par
-- son stack_hash) pour qu'il disparaisse de la liste des incidents OUVERTS, sans
-- effacer l'historique. On ajoute deux colonnes additives et nullables a
-- client_errors (0033) : la ligne reste, elle est juste marquee resolue. Aucune
-- reecriture de lib/client-errors.js : le filtre resolved_at is null vit dans
-- le nouveau loader lib/catalog-overrides.loadOpenIncidentGroups.
alter table client_errors add column if not exists resolved_at timestamptz;
alter table client_errors add column if not exists resolved_by text;

-- Lecture des incidents OUVERTS : filtre resolved_at is null puis tri par recence.
create index if not exists client_errors_open_idx
  on client_errors (resolved_at, occurred_at desc);

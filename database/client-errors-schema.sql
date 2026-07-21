-- ============================================================================
-- client_errors : telemetrie des erreurs JS des consoles staff
-- ============================================================================
--
-- POURQUOI CETTE TABLE
--
-- Quand la directrice ou le staff declenche une erreur JS dans la console, le
-- fondateur doit la voir dans son cockpit AVANT qu'on la lui signale. Cette
-- table est le puits de reception : le front envoie l'erreur, le serveur la
-- normalise et l'ecrit ici, le cockpit lit des GROUPES (par stack_hash), pas
-- des lignes brutes.
--
-- CE QUE LE SERVEUR GARANTIT (lib/client-errors.js, verrouille par
-- scripts/client-errors-check.js) :
--   * caps stricts sur chaque champ texte AVANT insertion : message 500,
--     source 300, stack_excerpt 1500, user_agent 200. La table ne fait pas
--     confiance au client sur la taille.
--   * stack_hash calcule COTE SERVEUR : sha1 hex du stack normalise (les
--     chiffres de ligne/colonne sont remplaces par N), pour que le meme bug
--     reste UN groupe malgre les bumps de version qui decalent les lignes.
--   * rate-limit comportemental : max 20 lignes par member_id par heure.
--     Au-dela, la ligne est silencieusement abandonnee ({ok:true, dropped:true}),
--     jamais d'erreur renvoyee au client. Une boucle d'erreurs sur un poste ne
--     peut donc pas inonder la table (plafond structurel : 480 lignes/jour/membre).
--   * AUCUN secret ni PII au-dela du member_id : les motifs emails, jetons
--     Bearer, cles sk-/re_, URLs postgres:// et JWT sont expurges des textes
--     avant ecriture. Pas d'email client, pas de corps de requete.
--
-- APPEND ONLY : le seul verbe applicatif ici est INSERT (et SELECT groupe en
-- lecture cockpit). Aucune colonne updated_at, aucun trigger.
--
-- RETENTION : aucune purge automatique dans ce chantier. Le volume est borne
-- par le rate-limit ; si un archivage devient necessaire, il se decide avec
-- des chiffres reels, pas dans une boucle de worker.

create table if not exists client_errors (
  id bigserial primary key,
  occurred_at timestamptz default now(),

  center_id text not null default 'libramont',

  -- La page du menu staff ou l'erreur a eu lieu (cle interne, ex. 'emails').
  page text not null default '',

  -- message de l'erreur JS. CAP 500 (applique cote serveur avant insert).
  message text not null,

  -- URL du script fautif. CAP 300.
  source text not null default '',

  lineno int,
  colno int,

  -- sha1 hex du stack NORMALISE (chiffres de ligne/colonne remplaces par N) :
  -- c'est la cle de regroupement du cockpit. Toujours calcule par le serveur.
  stack_hash text not null,

  -- Extrait du stack, expurge puis tronque. CAP 1500.
  stack_excerpt text not null default '',

  -- Seule identite conservee : l'id du membre staff (jamais d'email).
  member_id text not null default '',

  -- CAP 200.
  user_agent text not null default '',

  created_at timestamptz default now()
);

-- Lecture cockpit : groupes par bug, ordonnes par derniere occurrence.
create index if not exists client_errors_stack_hash_idx
  on client_errors (stack_hash, occurred_at desc);

-- Fenetre temporelle globale (sinceDays) et tri par recence.
create index if not exists client_errors_occurred_idx
  on client_errors (occurred_at desc);

comment on table client_errors is
  'Telemetrie des erreurs JS des consoles staff. Append-only, caps et expurgation cote serveur (lib/client-errors.js), rate-limit 20 lignes/membre/heure, regroupement cockpit par stack_hash normalise. Aucune PII au-dela de member_id.';

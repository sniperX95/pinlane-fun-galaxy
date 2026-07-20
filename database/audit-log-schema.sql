-- ============================================================================
-- audit_log : le journal des MODIFICATIONS du SaaS (qui / quoi / avant / apres)
-- Migration 0031. Fondation des deux cockpits (fondateur et direction).
-- ============================================================================
--
-- POURQUOI UNE QUATRIEME TABLE ALORS QUE TROIS EXISTENT DEJA
--
-- Aucune des trois ne repond a "qui a modifie quoi, et qu'est-ce qui a change".
--
--   ops_events          journal TERRAIN (prevu vs reel, minutes, retards).
--                       AUCUNE colonne d'acteur. api/staff-reservations.js
--                       emet un reservation_updated avec payload.fields =
--                       Object.keys(body), donc les NOMS des champs touches,
--                       jamais les valeurs, jamais l'auteur, alors que la
--                       session est disponible 40 lignes plus haut.
--   ops_decision_logs   journal des DECISIONS D'AGENTS IA (agent_id, severity).
--                       12 de ses 13 sites d'appel sont dans ops-simulation.
--                       audit_log ne le duplique pas : il pose un pointeur
--                       (context.runId) et laisse le raisonnement la-bas.
--   staff_access_events la plus proche du besoin (elle a un acteur), mais
--                       limitee au domaine identite, lue avec un limit 20 en
--                       dur (lib/staff-auth.js), et sans etat AVANT.
--
-- Les trois restent en place. audit_log ne les remplace pas : il repond a la
-- question qu'aucune ne couvre. staff_access_events sera depreciee plus tard,
-- une fois les cockpits construits, pas dans ce chantier (un ecran la lit).
--
-- ----------------------------------------------------------------------------
-- CE QUI EST CONSERVE, ET POURQUOI (regle T2, PII mesuree)
-- ----------------------------------------------------------------------------
-- Le prochain qui ajoute une colonne ici lit ce bloc d'abord.
--
-- CONSERVE :
--   * nom et email client UNIQUEMENT quand ils sont l'objet meme de la
--     modification (editer une reservation). Sans eux, "qui a modifie cette
--     reservation" ne designe rien d'identifiable et le journal perd son sens.
--   * les textes editoriaux en entier (sujet et corps d'un modele de mail).
--     Ce n'est pas de la PII : c'est du contenu de marque, et le garder permet
--     de restaurer une version.
--   * les diffs de configuration, de permissions et de tarifs, en entier.
--
-- JAMAIS :
--   * un corps de message envoye a un client (regle explicite du mandat).
--   * le contenu d'une note client (texte libre, PII non bornee). On garde un
--     booleen "modifiee" et une longueur.
--   * la liste nominative des destinataires d'une campagne. Le COMPTE suffit
--     pour auditer un envoi de masse.
--   * un telephone, sauf s'il est precisement le champ modifie.
--   * quoi que ce soit qui ressemble a un secret : voir redactSecrets dans
--     lib/audit-log.js, applique par MOTIF de nom de clef, recursivement,
--     AVANT serialisation. Une liste fixe serait perimee a la prochaine action.
--
-- ----------------------------------------------------------------------------
-- VOLUME ET RETENTION (regle T3) : note honnete, aucune purge automatique
-- ----------------------------------------------------------------------------
-- Ordre de grandeur, 3 centres, 50 a 200 actions d'ecriture par jour et par
-- centre en regime nominal :
--     150 a 600 lignes/jour  =  55 000 a 220 000 lignes/an
--     diff jsonb ~1 a 2 Ko moyen (plafonne a 8 Ko, voir lib/audit-log.js)
--     soit ~100 a 400 Mo/an, index compris.
-- Postgres avale cela sans broncher. Le poste de cout reel est le transfert
-- Neon, deja une contrainte vivante ici (la chaine 'data transfer quota'
-- figure dans le regex d'erreurs infra de api/staff-reservations.js).
--
-- PIEGE A NE PAS DECLENCHER : workers/ops-worker.js definit OPS_LOG_TABLES et
-- SUPPRIME a 7 jours. Ajouter audit_log a ce tableau par reflexe ferait
-- s'auto-detruire le journal chaque semaine, silencieusement. Un commentaire
-- explicite est pose a cet endroit du worker. NE PAS L'Y AJOUTER.
--
-- POSITION SUR LA PURGE : aucune, dans ce chantier. Effacer un journal d'audit
-- est une decision, pas une tache de maintenance. Ce qui est prevu a la place :
--   (a) la note de dimensionnement ci-dessus, ecrite la ou on la lira ;
--   (b) un point de decision date a 12 mois, avec des chiffres reels plutot que
--       ces estimations ;
--   (c) si une compression devient necessaire avant, elle prend la forme d'un
--       archivage froid (export, puis suppression elle-meme tracee), jamais
--       d'un DELETE silencieux dans une boucle de worker.
-- ============================================================================

create table if not exists audit_log (
  id bigserial primary key,

  -- Piste par centre. C'est la colonne qui rend le cockpit direction possible :
  -- une directrice ne lit QUE son centre (regle T6, gate tenant-write-scope).
  -- 'all' est admis pour les actions du fondateur qui ne visent aucun centre.
  center_id text not null default 'libramont',

  occurred_at timestamptz not null default now(),

  -- Une action automatique ne se juge pas comme une action humaine. C'est une
  -- colonne dediee et non un champ du jsonb, parce que c'est un critere de
  -- filtre de premiere classe dans les deux cockpits.
  actor_kind text not null default 'staff'
    check (actor_kind in ('staff', 'public', 'cron', 'worker', 'system')),

  -- actor_member_id peut pointer une ligne qui sera supprimee un jour.
  -- actor_label garde le nom lisible : un journal ne doit pas perdre son sens
  -- quand la ligne qu'il reference disparait. Volontairement PAS de foreign key
  -- pour cette raison.
  actor_member_id text,
  actor_label text not null default '',
  actor_role_id text,

  -- La paire (surface, action) identifie l'action de facon stable meme si le
  -- code est reorganise. surface = le fichier d'API, action = le nom dispatche.
  surface text not null default '',
  action text not null default '',
  method text not null default '',

  -- "Qui a modifie CETTE reservation" : recherche ciblee sur un objet.
  entity_type text,
  entity_id text,

  -- 'denied' est le signal le plus interessant en securite : une tentative
  -- refusee se voit. 'error' distingue l'echec technique du refus de droit.
  outcome text not null default 'success'
    check (outcome in ('success', 'denied', 'error')),

  -- Les trois cas exacts de requireStaffPermission (lib/staff-auth.js) :
  -- 401_no_session, 403_center_scope, 403_permission.
  denied_reason text,

  -- Le diff : { champ: { before, after } }. Expurge et plafonne.
  changes jsonb not null default '{}'::jsonb,

  -- Corps de requete expurge + pointeurs (runId vers ops_decision_logs...).
  context jsonb not null default '{}'::jsonb,

  -- Correle plusieurs lignes ecrites pendant la meme requete HTTP.
  request_id text
);

-- ----------------------------------------------------------------------------
-- INDEX : un par lecture reelle du mandat, pas un de plus.
-- ----------------------------------------------------------------------------

-- "Qu'est-ce qui a change dans CE centre cette semaine ?" (cockpit direction).
create index if not exists audit_log_center_idx
  on audit_log (center_id, occurred_at desc);

-- "Qu'a fait ce membre du staff aujourd'hui ?" (piste par acteur).
create index if not exists audit_log_center_actor_idx
  on audit_log (center_id, actor_member_id, occurred_at desc);

-- "Toutes les modifications de prix" (piste par action).
create index if not exists audit_log_center_action_idx
  on audit_log (center_id, action, occurred_at desc);

-- "L'historique de CETTE reservation" (piste par objet).
create index if not exists audit_log_entity_idx
  on audit_log (entity_type, entity_id, occurred_at desc);

-- Les refus sont rares et c'est ce qu'on relit le plus en securite. Un index
-- partiel sur une fraction des lignes coute presque rien a l'ecriture.
create index if not exists audit_log_denied_idx
  on audit_log (center_id, occurred_at desc)
  where outcome = 'denied';

-- ----------------------------------------------------------------------------
-- INTEGRITE TENANT
-- ----------------------------------------------------------------------------
-- PAS de cle etrangere vers centers(id) sur cette table. Decision explicite,
-- contraire au reflexe pose par database/tenant-integrity-schema.sql, et voici
-- les deux raisons.
--
-- 1. audit_log doit pouvoir tracer une action de portee PLATEFORME (le
--    fondateur agit sans viser un centre precis). Ce cas est ecrit 'all'. Pour
--    qu'une cle etrangere l'accepte, il faudrait inserer une ligne 'all' dans
--    centers. Or lib/center-config.js:462 fait
--        select id, name, status, timezone, settings from centers order by id
--    sans aucun filtre : ce faux centre apparaitrait dans le selecteur de
--    centre de la console, en production, des l'application de la migration.
--    Creer un objet metier fantome pour satisfaire une contrainte technique
--    est le mauvais sens de la dependance.
--
-- 2. Un journal d'audit ne doit pas pouvoir echouer a s'ecrire a cause de
--    l'etat d'une AUTRE table. Une cle etrangere transforme toute anomalie
--    referentielle en perte de trace, c'est-a-dire exactement le resultat que
--    ce chantier existe pour empecher.
--
-- Le prix paye : center_id n'est pas garanti referentiellement. Il est en
-- revanche toujours ecrit par le serveur (resolveEffectiveCenterId /
-- session.centerId), jamais par le client, et la LECTURE est scopee par
-- predicat parametre (voir readAuditLog dans lib/audit-log.js, verrouille par
-- scripts/audit-log-check.js). C'est le scope de lecture qui protege le
-- cloisonnement ici, pas l'integrite referentielle.
--
-- audit_log est enregistree dans database/rls-tenant-isolation.sql (fichier
-- relu mais NON joue par le runner). L'y omettre laisserait la table hors du
-- modele d'isolation le jour ou RLS sera active.

-- ----------------------------------------------------------------------------
-- APPEND ONLY : une ligne d'audit ne se modifie pas.
-- ----------------------------------------------------------------------------
-- Il n'y a volontairement AUCUN trigger set_updated_at et aucune colonne
-- updated_at : rien dans l'application ne doit faire un UPDATE ici. Le seul
-- verbe legitime sur cette table est INSERT (et SELECT en lecture scopee).

comment on table audit_log is
  'Journal des modifications du SaaS : qui a change quoi, quand, avant/apres, et ce qui a ete refuse. Append-only. Aucune purge automatique (voir la note de retention en tete de database/audit-log-schema.sql). NE PAS ajouter a OPS_LOG_TABLES dans workers/ops-worker.js.';

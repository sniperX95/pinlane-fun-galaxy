-- ============================================================================
-- 0032 : role plateforme 'platform-owner' (cockpit fondateur)
-- ============================================================================
--
-- POURQUOI. Le cockpit fondateur expose le cout de l'IA, la sante interne,
-- l'activite de TOUS les centres et les prospects. Il est gate cote serveur
-- par la permission 'platform.admin' (lib/staff-auth.js). Cette permission ne
-- fait PAS partie d'ALL_PERMISSIONS : le raccourci role.locked (Direction) ne
-- la confere jamais, et l'editeur de roles ne la propose pas. Elle n'existe
-- que portee EXPLICITEMENT par la liste de permissions d'un role en base.
-- Cette migration seed ce role, et lui rattache les membres proprietaires
-- plateforme deja provisionnes (`<centre>:platform-owner`).
--
-- Les installs neufs recoivent la meme chose via bootstrapCenterAccess
-- (lib/staff-auth.js) ; la prod, dont le schema staff-auth est deja
-- provisionne (fast-path staffAuthSchemaAlreadyProvisioned), passe par ici.
--
-- SANS AUCUN CODE DE ROLE : access_code_hash recoit un litteral qui ne peut
-- jamais egaler un digest hex de hashSecret. Personne ne se connecte "en tant
-- que role" platform-owner : seul le code MEMBRE (PLATFORM_OWNER_CODE) ouvre
-- une session porteuse de platform.admin. Le hash du membre n'est PAS touche.
--
-- Additive, idempotente, aucune operation destructive.

insert into staff_roles (
  center_id, id, name, code, summary, description, tone,
  permissions, access_code_hash, access_code_hint, locked
)
select
  c.id,
  'platform-owner',
  'Proprietaire plateforme',
  'PL',
  'Acces plateforme',
  'Cockpit fondateur Pinlane : tous les centres, couts IA, journal global.',
  'platform',
  '[
    "dashboard.view", "direction.view", "centers.switch", "reports.export",
    "planning.view", "planning.bowling", "planning.laser", "planning.drag", "planning.past",
    "reservations.view", "reservations.create", "reservations.edit", "reservations.cancel",
    "reservations.status", "reservations.quick",
    "clients.view", "clients.edit", "payments.view", "payments.markPaid", "exports.download",
    "emails.view", "emails.send", "campaigns.manage", "marketing.agents",
    "pricing.manage", "users.manage", "settings.manage", "security.codes", "ai.ops",
    "platform.admin"
  ]'::jsonb,
  'verrouille:aucun-code-de-role',
  '',
  true
from centers c
on conflict (center_id, id) do update set
  permissions = excluded.permissions,
  locked = true,
  updated_at = now();

-- Rattache le membre proprietaire plateforme de chaque centre au role
-- plateforme. Ne touche QUE les membres seedes `<centre>:platform-owner`
-- encore sur le role direction : un membre renomme ou deplace a la main
-- n'est pas ecrase.
update staff_members m
set role_id = 'platform-owner',
    updated_at = now()
where m.id = m.center_id || ':platform-owner'
  and m.role_id = 'direction'
  and exists (
    select 1 from staff_roles r
    where r.center_id = m.center_id and r.id = 'platform-owner'
  );

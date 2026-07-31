-- ============================================================================
-- Le PROGRAMME d'une reservation : ce que le groupe vient faire, en entier.
-- ============================================================================
--
-- POURQUOI
--
-- Une reservation ne portait qu'UNE activite (type = bowling | laser | formule).
-- Un groupe qui voulait bowling ET laser devait faire deux reservations ou
-- prendre une formule anniversaire, et rien ne disait qu'il comptait aussi faire
-- du minigolf, du billard ou des arcades : le comptoir le decouvrait a l'arrivee.
--
-- CE QUE PORTE LA COLONNE
--   { "items": [ { activityId, name, planned, duration|games|units|hours,
--                  minutes, price, priceKnown } ], "price": n, "priceComplete": bool }
--   Les activites PLANIFIEES (bowling, laser) restent, en plus, decrites par
--   ops_plan.resource_blocks : c'est lui qui fait foi pour le planning. Le
--   programme dit l'INTENTION du client ; ops_plan dit l'OCCUPATION des
--   ressources. Les deux ne se contredisent pas, ils ne repondent pas a la meme
--   question.
--
-- POURQUOI PAS UN 4e TYPE GENERALISE : la colonne `type` est lue a plus de 260
-- endroits (planning, filtres, statistiques, mails). Elle reste donc DERIVEE du
-- programme (bowling s'il y a du bowling, sinon laser, sinon 'activite' quand la
-- visite ne mobilise aucune ressource). Une reservation d'aujourd'hui produit
-- exactement la meme ligne qu'avant.
--
-- Additive et nullable : NULL = reservation mono-activite, comportement inchange.

alter table reservations
  add column if not exists program jsonb;

comment on column reservations.program is
  'Programme demande par le client (plusieurs activites). NULL = reservation mono-activite historique. ops_plan.resource_blocks reste la verite du planning.';

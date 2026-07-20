-- Liste de suppression marketing : les adresses qui ne veulent plus recevoir
-- d'envois MARKETING (campagnes, anniversaire J-30, reactivation, sequences
-- personnalisees). Elle ne touche JAMAIS les transactionnels : quelqu'un qui
-- se retire du marketing continue de recevoir la confirmation de la
-- reservation qu'il vient de faire, son rappel et son mail de retard.
--
-- PAR CENTRE, jamais globale : deux centres du meme groupe sont deux
-- expediteurs distincts pour un client, et un retrait chez l'un ne peut pas
-- etre decide a la place de l'autre. La colonne center_id porte donc la meme
-- contrainte de tenant que le reste du schema (references centers).
--
-- SOURCE = qui a decide du retrait. Les trois seules origines possibles :
--   link      : le client a clique le lien de retrait dans un mail marketing ;
--   staff     : ajout manuel depuis la console (appel telephonique, demande
--               orale, mail de reclamation traite a la main) ;
--   complaint : plainte (bouton SPAM remonte par le fournisseur d'envoi).
-- La contrainte ferme l'enum : une valeur inconnue est un bug, pas une ligne.
--
-- REASON = texte libre facultatif. Il documente, il ne decide rien.
create table if not exists marketing_suppressions (
  id bigserial primary key,
  center_id text not null default 'libramont' references centers (id),
  email text not null,
  source text not null default 'link'
    check (source in ('link', 'staff', 'complaint')),
  reason text not null default '',
  created_at timestamptz not null default now()
);

-- UN SEUL index, deux roles, et c'est voulu.
--   1. Unicite (centre, adresse en minuscules) : un double clic sur le lien de
--      retrait, ou un ajout manuel apres un clic, ne cree pas deux lignes.
--      L'insertion applicative est un upsert sur ce conflit.
--   2. C'est exactement la question posee AVANT CHAQUE ENVOI marketing :
--      « cette adresse est-elle exclue pour ce centre ? ». L'egalite porte sur
--      les deux colonnes de l'index dans l'ordre de l'index, donc la recherche
--      par lot (lower(email) = any(...)) le consomme directement.
-- L'index porte lower(email) et non email : c'est la forme normalisee qui fait
-- foi. Le stockage est deja normalise cote application, l'index garantit qu'une
-- ecriture directe en base ne peut pas creer de doublon casse.
create unique index if not exists marketing_suppressions_center_email_key
  on marketing_suppressions (center_id, lower(email));

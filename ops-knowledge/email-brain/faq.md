# FAQ email : réponses de référence (agent email du centre)

Source de vérité : `ops-knowledge/centers.json` (horaires, activités) et
`ops-knowledge/formulas.json` (formules, minimum anniversaire). AUCUN prix ici :
les tarifs ne sont pas dans la config → on confirme par retour, jamais inventé.
Format parsé par `lib/email-agent.js` : une section par intent, première ligne
`Objet : …`, le reste = corps. `{{prenom}}` est remplacé par le prénom du client
et `{{centre}}` par le NOM du centre qui répond : aucun nom de client en dur,
le même fichier sert chaque centre avec sa propre identité.
Les horaires exacts ne vivent PAS ici : ils changent par centre et par saison,
ils sont fournis au modèle par les FAITS DU CENTRE (buildCenterFacts). La
réponse de référence invite à les confirmer, elle ne les récite pas.

## intent:reservation
Objet : Votre demande de réservation, {{centre}}
Bonjour {{prenom}},

Merci pour votre message ! Le plus simple et le plus rapide : réservez directement en ligne depuis notre page de réservation, vous choisissez la date, l'heure et l'activité. La plupart des formules sont confirmées immédiatement ; pour quelques-unes, l'équipe valide d'abord et vous recevez la réponse par mail.

Si vous préférez, répondez à ce message avec la date souhaitée, l'heure et le nombre de personnes : on vous confirme le créneau par retour.

À très vite,
L'équipe {{centre}}

## intent:annulation
Objet : Votre demande d'annulation, {{centre}}
Bonjour {{prenom}},

Bien reçu votre demande concernant votre réservation. Pour l'annuler ou la déplacer, répondez simplement à ce message avec la date et le nom de la réservation : on s'en occupe et on vous confirme par retour.

Si vous souhaitez plutôt reporter, dites-nous la nouvelle date qui vous arrange, on vous propose le meilleur créneau.

À bientôt,
L'équipe {{centre}}

## intent:anniversaire
Objet : Un anniversaire chez {{centre}}, on s'occupe de tout
Bonjour {{prenom}},

Super idée ! Nos formules anniversaire sont prévues à partir de 6 enfants : activités, table décorée et boissons, vous profitez, on gère.

Dites-nous la date souhaitée, le nombre d'enfants et leur âge : on vous propose la formule adaptée et on vous confirme le tarif par retour. Vous pouvez aussi réserver directement en ligne.

À très vite,
L'équipe {{centre}}

## intent:prix
Objet : Nos tarifs, {{centre}}
Bonjour {{prenom}},

Merci pour votre message ! Les tarifs dépendent de l'activité, du jour et du nombre de personnes : dites-nous ce que vous prévoyez (activité, date, nombre de personnes) et on vous confirme le tarif exact par retour.

Toutes les activités et formules sont aussi visibles sur notre page de réservation en ligne.

À bientôt,
L'équipe {{centre}}

## intent:horaires
Objet : Nos horaires, {{centre}}
Bonjour {{prenom}},

Merci pour votre message ! Nos horaires varient selon le jour et les périodes de congés scolaires : dites-nous quand vous comptez venir et on vous confirme les heures d'ouverture par retour.

Vous pouvez aussi vérifier le créneau qui vous arrange directement sur notre page de réservation en ligne : elle affiche les horaires du jour choisi.

À très vite,
L'équipe {{centre}}

## intent:reclamation
Objet : Votre retour, {{centre}}
Bonjour {{prenom}},

Merci d'avoir pris le temps de nous écrire : et sincèrement désolés que votre expérience n'ait pas été à la hauteur. Votre message est transmis directement au responsable, qui revient vers vous rapidement.

Pour qu'on puisse bien faire les choses, pouvez-vous nous préciser la date de votre venue et ce qui s'est passé ? Vous pouvez aussi nous laisser un numéro : on vous rappelle.

Merci de votre confiance,
L'équipe {{centre}}

## intent:hors_sujet
Objet : Bien reçu, {{centre}}
Bonjour,

Merci pour votre message : il a bien été reçu et transmis à la personne concernée.

Bien à vous,
L'équipe {{centre}}

## intent:autre
Objet : Bien reçu, {{centre}}
Bonjour {{prenom}},

Merci pour votre message ! On revient vers vous rapidement avec une réponse précise.

Si c'est urgent, le plus rapide est de nous appeler directement au centre. Et pour réserver une activité, tout se fait depuis notre page de réservation en ligne.

À bientôt,
L'équipe {{centre}}

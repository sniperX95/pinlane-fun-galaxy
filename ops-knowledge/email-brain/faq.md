# FAQ email : réponses de référence (agent email Fun Galaxy)

Source de vérité : `ops-knowledge/centers.json` (horaires, activités) et
`ops-knowledge/formulas.json` (formules, minimum anniversaire). AUCUN prix ici :
les tarifs ne sont pas dans la config → on confirme par retour, jamais inventé.
Format parsé par `lib/email-agent.js` : une section par intent, première ligne
`Objet : …`, le reste = corps. `{{prenom}}` est remplacé par le prénom du client.

## intent:reservation
Objet : Votre demande de réservation, Fun Galaxy
Bonjour {{prenom}},

Merci pour votre message ! Le plus simple et le plus rapide : réservez directement en ligne sur www.mngfunglxy.com, vous choisissez la date, l'heure et l'activité, et c'est confirmé tout de suite.

Si vous préférez, répondez à ce message avec la date souhaitée, l'heure et le nombre de personnes : on vous confirme le créneau par retour.

À très vite,
L'équipe Fun Galaxy

## intent:annulation
Objet : Votre demande d'annulation, Fun Galaxy
Bonjour {{prenom}},

Bien reçu votre demande concernant votre réservation. Pour l'annuler ou la déplacer, répondez simplement à ce message avec la date et le nom de la réservation : on s'en occupe et on vous confirme par retour.

Si vous souhaitez plutôt reporter, dites-nous la nouvelle date qui vous arrange, on vous propose le meilleur créneau.

À bientôt,
L'équipe Fun Galaxy

## intent:anniversaire
Objet : Un anniversaire chez Fun Galaxy, on s'occupe de tout
Bonjour {{prenom}},

Super idée ! Nos formules anniversaire sont prévues à partir de 6 enfants : activités (bowling, laser game, minigolf…), table décorée et boissons, vous profitez, on gère.

Dites-nous la date souhaitée, le nombre d'enfants et leur âge : on vous propose la formule adaptée et on vous confirme le tarif par retour. Vous pouvez aussi réserver directement en ligne sur www.mngfunglxy.com.

À très vite,
L'équipe Fun Galaxy

## intent:prix
Objet : Nos tarifs, Fun Galaxy
Bonjour {{prenom}},

Merci pour votre message ! Les tarifs dépendent de l'activité, du jour et du nombre de personnes : dites-nous ce que vous prévoyez (activité, date, nombre de personnes) et on vous confirme le tarif exact par retour.

Toutes les activités et formules sont aussi visibles sur www.mngfunglxy.com, avec la réservation en ligne en 1 minute.

À bientôt,
L'équipe Fun Galaxy

## intent:horaires
Objet : Nos horaires, Fun Galaxy Libramont
Bonjour {{prenom}},

Voici nos horaires habituels :
- Lundi : fermé
- Mardi : 14h à 22h
- Mercredi : 12h à 22h
- Jeudi : 14h à 22h
- Vendredi : 14h à minuit
- Samedi : 10h à minuit
- Dimanche : 10h à 22h

Pendant les congés scolaires, on ouvre tous les jours dès 10h (jusqu'à 22h en semaine et dimanche, minuit le vendredi et le samedi).

À très vite,
L'équipe Fun Galaxy

## intent:reclamation
Objet : Votre retour, Fun Galaxy
Bonjour {{prenom}},

Merci d'avoir pris le temps de nous écrire : et sincèrement désolés que votre expérience n'ait pas été à la hauteur. Votre message est transmis directement au responsable, qui revient vers vous rapidement.

Pour qu'on puisse bien faire les choses, pouvez-vous nous préciser la date de votre venue et ce qui s'est passé ? Vous pouvez aussi nous laisser un numéro : on vous rappelle.

Merci de votre confiance,
L'équipe Fun Galaxy

## intent:autre
Objet : Bien reçu, Fun Galaxy
Bonjour {{prenom}},

Merci pour votre message ! On revient vers vous rapidement avec une réponse précise.

Si c'est urgent, le plus rapide est de nous appeler directement au centre. Et pour réserver une activité, tout se fait en ligne sur www.mngfunglxy.com.

À bientôt,
L'équipe Fun Galaxy

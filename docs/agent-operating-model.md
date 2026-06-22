# Agent Operating Model

## Principe

Les agents ne remplacent pas les regles metier. Ils travaillent au-dessus du moteur operationnel.

Ce modele evite le point dangereux: une IA qui invente une disponibilite ou qui decale une activite critique sans preuve.

## Planning Agent

Entrees:

- centre
- date
- formule ou bowling simple
- participants
- heure souhaitee
- preference client
- reservations existantes
- statuts pistes

Sorties:

- scenario recommande
- scenarios alternatifs
- timeline
- pistes proposees
- conflits
- niveau de risque
- justification staff

Decision:

- confirme automatiquement seulement les cas simples sans conflit
- demande validation staff pour les formules complexes ou risque eleve

## Delay Agent

Entrees:

- plan actuel
- retard ajoute
- raison du retard
- contexte reservations

Sorties:

- plan decale
- conflits crees
- actions staff
- severite

Actions typiques:

- absorber avec buffer
- changer l'ordre des activites
- decaler laser
- changer pistes
- prevenir client suivant

## Communication Agent

Entrees:

- client
- centre
- formule
- heure
- statut de validation

Sorties:

- sujet
- corps email
- rappels J-2 et jour J
- consignes d'arrivee

Regles:

- ne jamais promettre une formule confirmee si validation staff requise
- toujours rappeler l'arrivee en avance pour les formules avec laser
- garder un ton humain

## Director Agent

Entrees:

- reservations multi-centres
- risques
- revenus
- retards

Sorties:

- resume par centre
- alertes
- comparaisons
- points a traiter

## Learning Agent

Entrees:

- evenements reels
- durees prevues
- durees observees
- raisons de retard

Sorties:

- suggestions de buffer
- suggestions de duree
- niveau de confiance

Limite:

- aucune application automatique
- validation humaine obligatoire
- apprentissage separe par centre

## Donnees indispensables a collecter

Chaque fois que le staff clique une action, on doit enregistrer un evenement:

```json
{
  "centerId": "libramont",
  "reservationId": 123,
  "formulaId": "f4",
  "activityId": "laser_game",
  "eventType": "actual_duration",
  "plannedMinutes": 30,
  "actualMinutes": 41,
  "reasonId": "incomplete_group"
}
```

Plus on collecte ces evenements, plus les suggestions deviennent solides.

## Boucle continue

La boucle operationnelle est:

1. creation ou modification reservation
2. enregistrement `ops_events`
3. calcul du plan Ops et du risque
4. creation des communications en file d attente
5. dispatch cron des emails/SMS dus
6. collecte des durees reelles et raisons de retard
7. `learning-agent` genere des suggestions dedupliquees
8. validation humaine avant changement de regle

Ce fonctionnement evite les erreurs silencieuses: un agent peut proposer une amelioration, mais les regles critiques ne changent pas seules.

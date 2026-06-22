# FunGalaxy Ops Engine

## Objectif

Le projet ne doit pas etre un simple calendrier. Il doit devenir un moteur operationnel multi-centres qui protege les ressources sensibles:

- bowling
- laser game
- tables anniversaire
- bar / accueil / briefing
- communications client

La regle de securite produit est simple: les disponibilites critiques sont calculees par un moteur deterministe. Les agents proposent, expliquent et apprennent, mais ne modifient pas seuls les regles critiques.

## Centres

Les centres sont decrits dans `ops-knowledge/centers.json`.

- Libramont: 8 pistes, laser sensible, un lancement propre, groupe complet attendu.
- Gembloux: laser plus flexible, Golf o'Clock disponible.
- Ciney: centre prevu, donnees a completer avant ouverture.

Toutes les reservations futures doivent porter un `center_id`.

## Ressources critiques

### Bowling

- 8 pistes par centre actif.
- Capacite normale: 6 personnes par piste.
- 7 personnes sur une piste reste une exception staff.
- 8 personnes impose 2 pistes.
- Les pistes adjacentes sont privilegiees.

### Laser Game

- Partie reelle: 20-22 minutes.
- Briefing: 5-10 minutes.
- Capacite materielle: 30 armes.
- Libramont: le laser est critique, car un groupe incomplet peut bloquer toute la sequence.
- Gembloux: plusieurs lancements sont possibles, donc le risque est moins fort.

### Activites souples

Minigolf, arcade et playground sont utilises comme amortisseurs de retard quand la formule le permet. Ils restent modelises, mais ils ne doivent pas bloquer le planning comme le bowling ou le laser.

## Formules

Les formules sont stockees dans `ops-knowledge/formulas.json`.

Une formule n'est plus une duree fixe. C'est une suite d'etapes que le moteur peut reorganiser:

- bowling
- laser
- minigolf
- arcade
- table
- boissons
- pause

Le moteur teste plusieurs ordres et choisit celui qui minimise:

- conflits piste
- conflits laser
- attente client
- risque de retard
- pression bar / briefing

## Risque

Chaque scenario recoit:

- `risk.score`: 0-100
- `risk.level`: low, medium, high, critical
- `bufferMinutes`: marge operationnelle conseillee
- `conflicts`: conflits bloquants ou alertes
- `staffSummary`: explication courte pour le staff

Les formules complexes restent en validation humaine si le risque est eleve.

## Agents

Les agents sont dans `lib/ops-agents.js`.

- `planningAgent`: genere les scenarios et recommande un plan.
- `delayAgent`: simule un retard et donne les impacts.
- `communicationAgent`: prepare email/SMS humain.
- `directorAgent`: resume les donnees multi-centres.
- `learningAgent`: transforme les historiques en suggestions.

## Apprentissage

Le moteur apprend par observation:

- duree prevue
- duree reelle
- retard
- raison du retard
- centre
- formule
- activite

Le learning agent ne change jamais les regles automatiquement. Il cree des suggestions a valider:

```text
Formule 4 / Libramont / Laser Game:
10 echantillons
delta moyen +9 min
suggestion: ajouter +10 min de marge
validation humaine requise
```

## API

Endpoints ajoutes:

- `GET /api/ops?action=knowledge`
- `POST /api/ops` avec `action=plan`
- `POST /api/ops` avec `action=delay`
- `POST /api/ops` avec `action=communicationDraft`
- `POST /api/ops` avec `action=learning`
- `POST /api/ops` avec `action=event`
- `GET /api/ops?action=events`
- `GET /api/ops?action=suggestions`
- `POST /api/ops` avec `action=enqueueReservation`
- `POST /api/ops` avec `action=dispatchDue`
- `GET|POST /api/cron/dispatch-communications`

## Base de donnees

Extension SQL:

- `database/ops-schema.sql`

Elle ajoute:

- `centers`
- `ops_events`
- `ops_agent_suggestions`
- `communications`
- colonnes ops sur `reservations`

Cette migration est additive.

## Communications

Le systeme cree une file de communications persistante:

- confirmation ou demande recue
- demande de validation staff si formule complexe
- rappel email J-2
- rappel SMS le jour J

Les envois utilisent:

- Resend si `RESEND_API_KEY` est configure
- Twilio si `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et `TWILIO_FROM` sont configures

Si un fournisseur manque, le message reste en `queued`. Le systeme ne marque pas un message comme envoye sans preuve fournisseur.

Variables utiles:

- `CRON_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM`
- `STAFF_REVIEW_EMAIL`

Le cron `/api/cron/dispatch-communications` traite les messages dus. Il est protege par `Authorization: Bearer CRON_SECRET`.

# Flux reservation

## Reservation publique

1. Le client choisit date, nombre de joueurs et type.
2. Le moteur calcule les options faisables.
3. Le client choisit un creneau ou un programme.
4. La demande est envoyee a l'API.
5. La reservation est inscrite en base.
6. Les jobs email et suivi sont crees.
7. Le worker traite les relances en fond.

## Bowling

Contraintes principales:

- 8 pistes;
- 6 joueurs max par piste;
- 7 seulement en tolerance exceptionnelle;
- 8 joueurs ou plus implique plusieurs pistes;
- durees 30 min, 1h, 1h30, 2h;
- staff peut creer/modifier dans le passe;
- public ne peut pas reserver dans le passe.

## Laser Game

Contraintes principales:

- 30 armes;
- sessions partageables;
- duree partie environ 20-22 min;
- briefing 5-10 min;
- plusieurs parties peuvent etre enchainees ou separees;
- les parties restantes doivent rester visibles pour le staff.

## Formules

Les formules combinent activites.

Regle UX:

- si le client veut choisir, il doit pouvoir choisir l'ordre et les heures compatibles;
- si l'agent choisit, il propose le meilleur programme faisable;
- les boissons/cruches restent libres sur place;
- ne pas imposer une pause rigide.

## Retards

Le mecanisme attendu:

1. staff marque un retard estime: 5, 10, 15 min ou custom;
2. le moteur recalcule impacts bowling/laser;
3. si le plan tient, il decale proprement;
4. si le plan casse, il propose alternatives;
5. client/staff sont informes selon gravite.


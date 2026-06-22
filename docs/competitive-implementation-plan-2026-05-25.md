# Plan d'implementation concurrentielle - Fun Galaxy Ops

Date: 2026-05-25

Objectif: transformer le benchmark concurrents en fonctions visibles, vendables et utiles pour un centre bowling + laser game.

## Sources analysees

- Clubspeed: FEC operations, booking, gains de productivite, multi-activites.
- VenueSumo: online booking, POS, party/group bookings, QR ordering, waivers, CRM, channel management.
- RocketRez: ticketing/POS avec communication client IA contextualisee.
- ROLLER: booking, capacity, waivers, memberships, reporting et self-service client.
- QubicaAMF Conqueror Web & Kiosk: mobile booking, multi-centres, smart lane selection, automatic cleaning time, web offers, upsells.
- Party Center Software: party booking 24/7, real-time availability, add-ons, deposits.
- FECdesk: smart calendar drag and drop, galleries/invitations pour anniversaires, multi-location add-on.
- Funbutler: self-service activity booking, fewer calls/emails, add-on revenue, guests manage bookings themselves.

## Patterns gagnants retenus

1. Une seule source de verite capacite
   Client, staff et direction doivent lire les memes ressources.

2. Self-service client encadre
   Le client choisit, mais uniquement dans les combinaisons qui tiennent.

3. Sessions et ressources partagees
   Le Laser Game n'est pas un simple creneau: c'est une capacite partagee avec groupes, passages et places restantes.

4. Staff board en rush
   Le staff doit savoir en quelques secondes quoi faire, quoi encaisser, quoi surveiller.

5. Communication contextualisee
   Les meilleurs outils ne se contentent pas d'envoyer un mail: le message dépend du contexte, du centre et du risque.

6. Direction multi-centres
   Vue periodique, comparaison centre, exports et rapports propres.

7. Paiement, depot, waivers, kiosks
   Ce sont des standards marche, mais a brancher apres validation terrain pour ne pas durcir le parcours trop tot.

## Ce qui a ete implemente maintenant

- Page pro enrichie avec une lecture concurrence claire et une section maturite produit.
- Console Direction enrichie avec un module "Maturite marche" qui relie le produit aux standards des meilleurs concurrents.
- Langage commercial repositionne: moins "joli planning", plus "systeme d'exploitation terrain".
- Sources benchmark remises a jour sur la page pro.

## Ce qui doit rester une roadmap honnete

- Paiement/depot et politique no-show.
- Waivers et check-in QR.
- SMS client.
- Vrai POS/stock/inventory.
- Preuve terrain sur 1 a 2 semaines de donnees reelles.

## Angle de vente

Ne pas dire: "nous avons un systeme de reservation".

Dire: "nous avons un cockpit operationnel specialise Bowling + Laser Game, inspire des standards des meilleurs FEC softwares, mais focalise sur le probleme que les suites generalistes traitent mal: formules, retards, sessions partagees et decisions staff en rush."

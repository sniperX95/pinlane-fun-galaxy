# Fun Galaxy - base de donnees centrale

Le site garde son interface actuelle, mais les donnees critiques ne vivent plus dans le navigateur.

## Ce qui a ete ajoute

- une vraie couche serveur dans `api/`
- une connexion PostgreSQL via `DATABASE_URL`
- un schema SQL dans [database/schema.sql](C:/Users/movsa/Documents/Codex/2026-04-24/doctype-html-html-lang-fr-head/database/schema.sql)
- un endpoint public pour les demandes venant du formulaire Fungalaxy
- une page publique `public-form.html` prete a integrer sur le site Fungalaxy
- un endpoint public pour charger les creneaux disponibles
- des endpoints staff pour lire, modifier, encaisser, annuler et supprimer
- une synchro automatique cote staff

## Variables a prevoir

Copier `.env.example` vers `.env` puis remplir:

- `DATABASE_URL`
- `DATABASE_SSL` (`require` par defaut, `disable` si votre base locale n'utilise pas SSL, `no-verify` uniquement pour une base de test avec certificat non verifie)
- `PUBLIC_FORM_ORIGIN` pour limiter le CORS au vrai site Fungalaxy
- `STAFF_AUTH_SECRET` secret long utilise pour signer les sessions staff
- `STAFF_DIRECTION_CODE` code d'acces direction du client
- `PLATFORM_OWNER_CODE` code d'acces proprietaire de la plateforme
- `ALLOW_INSECURE_STAFF_CODES=false` en production

`SITE_PASSWORD` est conserve seulement pour compatibilite historique. Ne pas l'utiliser comme code staff en production.

## Mise en place de la base

1. Creer une base PostgreSQL.
2. En staging/production, lancer les migrations versionnees avec:

   ```bash
   npm run db:migrate
   ```

3. Pour verifier l'ordre et les checksums sans toucher a la base:

   ```bash
   npm run db:migrate:plan
   ```

4. Pour une base locale jetable uniquement, le schema principal reste dans [database/schema.sql](C:/Users/movsa/Documents/Codex/2026-04-24/doctype-html-html-lang-fr-head/database/schema.sql).
5. Verifier que les 8 lignes existent dans `lane_statuses`.

## Endpoints

- `POST /api/public-reservations`
  - pour le formulaire public integre au site Fungalaxy
  - accepte du JSON
  - gere la reservation centrale

- `POST /api/pilot-lead`
  - capture les demandes de pilote du formulaire de la landing `pro.html`
  - stocke le lead en base (`pilot_leads`), remplace l'ancien mailto

- `GET /api/public-booking-meta`
  - retourne les formules et les durees cote public

- `GET /api/public-availability?date=YYYY-MM-DD&type=bowling|formule&...`
  - retourne les creneaux disponibles sans exposer les donnees client

- `GET /api/staff-state?date=YYYY-MM-DD`
  - charge les reservations et l'etat des pistes pour une date

- `POST /api/staff-reservations`
  - creation rapide staff

- `PATCH /api/staff-reservations`
  - edition / changement de statut / caisse

- `DELETE /api/staff-reservations`
  - suppression definitive

- `PATCH /api/staff-lanes`
  - active / maintenance sur les pistes

## Flux prevu

- Le formulaire public envoie les demandes vers `POST /api/public-reservations`.
- La page `public-form.html` peut etre ouverte directement ou integree sur Fungalaxy.
- L'ecran staff recharge automatiquement les donnees et les ecritures passent toutes par l'API.
- Le navigateur n'est plus la source de verite: la base l'est.

## Point important

Pour de vraies grosses journees, la securite depend surtout de la base PostgreSQL et de la qualite du `DATABASE_URL` en production. Le site HTML est maintenant branche pour centraliser les reservations, mais il faudra brancher la vraie base et tester 2 ou 3 cas simultanes avant ouverture large.

## Garde-fous de developpement

Avant de deployer un changement qui touche aux reservations, lancer:

```bash
npm run test:ops:all
npm run test:e2e
```

`npm run test:e2e` ouvre le site dans Edge en headless, verifie la page publique et le verrou staff. Pour tester aussi une connexion reelle, definir `PINLANE_E2E_STAFF_CODE` avant la commande.

Cette suite couvre:

- moteur Bowling / Laser / Formules;
- agents et orchestration;
- simulation de rush;
- stress test deterministe;
- garde-fous contre les regressions critiques, dont les champs stale qui ne doivent jamais transformer un Bowling Simple en Formule.

Le workflow GitHub [quality-gates.yml](C:/Users/movsa/Documents/Codex/2026-04-24/doctype-html-html-lang-fr-head/.github/workflows/quality-gates.yml) est pret pour bloquer les futures PR si ces tests echouent.

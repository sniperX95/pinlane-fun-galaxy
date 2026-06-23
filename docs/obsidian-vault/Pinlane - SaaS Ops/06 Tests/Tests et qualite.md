# Tests et qualite

## Commande principale

```bash
npm run test:ops:all
```

Cette commande couvre:

- ops;
- security config;
- browser modules;
- agent stack;
- agent orchestration;
- marketing agents;
- simulation;
- stress ops;
- quality audit.

## Commandes utiles

```bash
npm run db:migrate:plan
npm run db:migrate
npm run worker:once
npm run test:e2e
npm run test:ops:nuclear
npm run test:agent:nuclear
```

## Critere de sortie

Avant de presenter a Seb:

- reservation bowling simple OK;
- reservation laser simple OK;
- formule bowling + laser OK;
- alternatives si impossible;
- no-show suivi;
- retard 5/10/15 min simule;
- emails en file + envoyes;
- page staff lisible;
- page direction exportable;
- aucun bouton fantome majeur.

## Derniere verification connue

`npm run test:ops:all` est passe avec succes apres ajout Railway/jobs.


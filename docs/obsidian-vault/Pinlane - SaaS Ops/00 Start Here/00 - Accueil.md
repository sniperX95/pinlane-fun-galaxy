# Pinlane - SaaS Ops

Cette base Obsidian sert de cockpit documentaire pour Pinlane.

Pinlane est le produit SaaS. Fun Galaxy est le premier client/tenant.

## A lire en premier

- [[01 - Carte Obsidian]]
- [[../01 Produit/Product Vision]]
- [[../02 Architecture/Architecture technique]]
- [[../03 Operations/Railway Vercel GitHub Runbook]]
- [[../04 Agents IA/Ecosysteme agents]]
- [[../06 Tests/Tests et qualite]]

## Etat actuel

- Site public: https://www.mngfunglxy.com
- GitHub: https://github.com/sniperX95/pinelane-fun-galaxy
- Railway: projet `PINLANE FUN GALAXY`
- Worker Railway: `ops-worker`
- Base: PostgreSQL Railway
- Emails: Resend
- Domaine: Vercel + alias `www.mngfunglxy.com`

## Principe important

Obsidian ne doit pas contenir de secrets en clair.

On documente:

- architecture;
- decisions;
- runbooks;
- flux reservation;
- agents;
- tests;
- risques;
- liens vers les fichiers importants.

On ne copie pas:

- cles API;
- mots de passe;
- `.env` complet;
- tokens Vercel, Railway, Resend ou GitHub.


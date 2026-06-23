# Obsidian Sync

Derniere synchronisation: 24/06/2026 00:39:47

Cette note documente le pont operationnel entre Codex, Obsidian, Railway, Vercel, GitHub et les tests.

## Ce qui est connecte

| Systeme | Role |
| --- | --- |
| Obsidian | Memoire lisible du projet, runbooks, decisions et etat live |
| Railway | Worker `ops-worker`, Postgres, jobs de fond |
| Vercel | Site public et fonctions API |
| GitHub | Source de verite du code versionne |
| Tests locaux | Verification moteur, agents, securite, simulation, qualite |

## Commandes utiles

```bash
npm run obsidian:sync
npm run obsidian:sync:tests
```

## Garanties

- La sync ecrit dans le vault Obsidian local et dans `docs/obsidian-vault`.
- Les secrets Railway/Vercel ne sont jamais copies dans Obsidian.
- Les variables sensibles sont affichees uniquement en presence oui/non.
- Les tests ne remplacent le rapport `Latest Test Run` que quand ils sont vraiment lances.

## Limite actuelle

Le worker Railway tourne et les agents metier executent les jobs codes. Un modele IA externe permanent necessite encore une vraie cle API serveur ou un gateway compatible.

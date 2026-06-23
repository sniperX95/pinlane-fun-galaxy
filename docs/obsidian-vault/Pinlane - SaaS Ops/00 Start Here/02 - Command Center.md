# Command Center

Derniere synchronisation: 24/06/2026 00:39:47

## Ouvrir vite

- [[00 - Accueil]]
- [[../03 Operations/Live Status]]
- [[../03 Operations/Railway Health]]
- [[../03 Operations/Vercel Health]]
- [[../04 Agents IA/Agent Activity Live]]
- [[../06 Tests/Latest Test Run]]

## Commandes

```bash
npm run obsidian:sync
npm run obsidian:sync:tests
npm run test:ops:all
railway logs --service ops-worker --lines 120 --json
npx vercel inspect www.mngfunglxy.com --timeout 120s
git status --short
```

## Etat express

- Site public: OK
- Railway worker: SUCCESS
- Tests: OK
- Git: changements locaux

## Prochaine action utile

Construire le module retard operationnel:

1. staff declare retard;
2. moteur recalcule impacts;
3. alternatives si conflit;
4. client/staff informes;
5. decision loggee dans Obsidian/ops.

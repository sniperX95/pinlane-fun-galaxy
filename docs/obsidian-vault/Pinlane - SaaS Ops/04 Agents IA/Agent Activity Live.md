# Agent Activity Live

Derniere synchronisation: 24/06/2026 04:04:08

## Ce qui tourne vraiment

- Railway execute le worker `ops-worker`.
- Le worker traite les boucles `communications`, `jobs` et `agents`.
- Les emails passent par Resend si les communications sont dues.
- Les decisions et jobs sont persistables en base.

## Logs detectes

```text
2026-06-24T02:00:51.536925196Z > worker:ops
2026-06-24T02:00:51.536930366Z > node workers/ops-worker.js
2026-06-24T02:00:51.536934976Z
2026-06-24T02:00:51.536938996Z loop:start
2026-06-24T02:00:52.054024044Z Starting Container
2026-06-24T02:00:53.085722486Z jobs:ok
2026-06-24T02:00:53.085726956Z communications:ok
2026-06-24T02:01:33.082958800Z jobs:ok
2026-06-24T02:02:03.083156745Z communications:ok
2026-06-24T02:02:03.083161255Z jobs:ok
2026-06-24T02:02:03.083165445Z agents:ok
2026-06-24T02:02:33.136481301Z jobs:ok
2026-06-24T02:03:03.106233186Z communications:ok
2026-06-24T02:03:03.106235516Z jobs:ok
2026-06-24T02:03:33.127060098Z jobs:ok
2026-06-24T02:04:03.131904096Z communications:ok
2026-06-24T02:04:03.131907726Z jobs:ok
2026-06-24T02:04:43.144212035Z jobs:ok
2026-06-24T02:05:03.144447300Z communications:ok
2026-06-24T02:05:05.373125209Z jobs:ok
```

## Lecture operationnelle

Si les lignes `communications:ok`, `jobs:ok` et `agents:ok` apparaissent regulierement, le moteur de fond respire.

Si elles disparaissent:

1. verifier Railway;
2. verifier variables DB/Resend;
3. lancer `railway logs --service ops-worker --lines 120 --json`;
4. verifier `npm run worker:once` localement si necessaire.

## Limite importante

Cette sync ne prouve pas qu'un modele IA externe est connecte. Pour cela, il faut une vraie cle API serveur ou un AI Gateway.

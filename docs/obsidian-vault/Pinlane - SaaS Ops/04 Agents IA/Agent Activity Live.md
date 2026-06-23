# Agent Activity Live

Derniere synchronisation: 24/06/2026 00:39:47

## Ce qui tourne vraiment

- Railway execute le worker `ops-worker`.
- Le worker traite les boucles `communications`, `jobs` et `agents`.
- Les emails passent par Resend si les communications sont dues.
- Les decisions et jobs sont persistables en base.

## Logs detectes

```text
2026-06-23T22:33:31.410315720Z jobs:ok
2026-06-23T22:33:51.401569139Z communications:ok
2026-06-23T22:33:55.249338995Z jobs:ok
2026-06-23T22:34:34.771193215Z jobs:ok
2026-06-23T22:34:54.772591345Z communications:ok
2026-06-23T22:34:58.706877843Z jobs:ok
2026-06-23T22:35:38.272980939Z jobs:ok
2026-06-23T22:35:58.270616595Z communications:ok
2026-06-23T22:36:03.217979426Z jobs:ok
2026-06-23T22:36:42.746419168Z jobs:ok
2026-06-23T22:36:50.801414960Z communications:ok
2026-06-23T22:37:10.802902374Z jobs:ok
2026-06-23T22:37:40.805073806Z jobs:ok
2026-06-23T22:38:00.387568285Z communications:ok
2026-06-23T22:38:09.003643754Z jobs:ok
2026-06-23T22:38:39.026053721Z agents:ok
2026-06-23T22:38:40.038457481Z jobs:ok
2026-06-23T22:38:59.644765250Z communications:ok
2026-06-23T22:39:19.650303212Z jobs:ok
2026-06-23T22:39:49.648007077Z jobs:ok
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

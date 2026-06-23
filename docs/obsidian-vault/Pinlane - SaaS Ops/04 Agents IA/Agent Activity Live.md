# Agent Activity Live

Derniere synchronisation: 23/06/2026 22:41:49

## Ce qui tourne vraiment

- Railway execute le worker `ops-worker`.
- Le worker traite les boucles `communications`, `jobs` et `agents`.
- Les emails passent par Resend si les communications sont dues.
- Les decisions et jobs sont persistables en base.

## Logs detectes

```text
2026-06-23T20:34:58.319286821Z communications:ok
2026-06-23T20:35:28.322733973Z jobs:ok
2026-06-23T20:35:58.320453897Z jobs:ok
2026-06-23T20:35:59.369597608Z communications:ok
2026-06-23T20:36:29.369761958Z jobs:ok
2026-06-23T20:36:59.370089217Z jobs:ok
2026-06-23T20:37:00.421834456Z communications:ok
2026-06-23T20:37:30.419815580Z jobs:ok
2026-06-23T20:38:00.420366798Z jobs:ok
2026-06-23T20:38:01.484193755Z communications:ok
2026-06-23T20:38:41.693454466Z jobs:ok
2026-06-23T20:39:11.686372011Z communications:ok
2026-06-23T20:39:11.686377601Z jobs:ok
2026-06-23T20:39:41.691320866Z jobs:ok
2026-06-23T20:40:11.697236235Z communications:ok
2026-06-23T20:40:11.697240435Z jobs:ok
2026-06-23T20:40:41.693301208Z jobs:ok
2026-06-23T20:41:11.579853617Z communications:ok
2026-06-23T20:41:11.579856487Z jobs:ok
2026-06-23T20:41:51.584645144Z jobs:ok
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

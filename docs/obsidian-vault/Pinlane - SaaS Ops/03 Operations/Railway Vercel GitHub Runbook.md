# Railway Vercel GitHub Runbook

## URLs

- Production: https://www.mngfunglxy.com
- GitHub: https://github.com/sniperX95/pinelane-fun-galaxy

## Railway

Projet: `PINLANE FUN GALAXY`

Services:

- `Postgres`
- `ops-worker`

Commandes utiles:

```bash
railway status --json
railway logs --service ops-worker --lines 120 --json
railway deployment list --service ops-worker --json
railway run --service ops-worker npm run db:migrate
```

Le worker doit afficher regulierement:

- `communications:ok`
- `jobs:ok`
- `agents:ok`

## Vercel

Commandes utiles:

```bash
npx vercel inspect www.mngfunglxy.com --timeout 120s
npx vercel env ls
npx vercel list doctype-html-html-lang-fr-head --format json --yes
```

Si un deploy GitHub devient `BLOCKED`, le code peut quand meme etre sain.

Workaround qui a fonctionne:

1. deploy direct depuis une copie propre sans metadata Git;
2. attendre `READY`;
3. alias vers `www.mngfunglxy.com`.

## GitHub

Commande de verification:

```bash
git status --short
git log --oneline -5
```

Ne jamais pousser de `.env`, tokens, cles API ou exports secrets.


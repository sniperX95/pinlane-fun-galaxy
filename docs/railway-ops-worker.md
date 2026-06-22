# Railway Ops Worker

Railway doit servir de moteur de fond, pas remplacer le site public.

## Architecture recommandee

- Vercel garde le site, les pages publiques, le staff/admin et les API HTTP.
- Postgres reste la source de verite unique via `DATABASE_URL`.
- Railway lance un service worker Node.js avec `npm run worker:ops`.
- Resend reste le fournisseur email.
- Twilio reste desactive tant que les SMS sont en pause.

## Ce que le worker fait

- Toutes les 60 secondes: envoie les communications dues.
- Toutes les 15 minutes: relance les agents ops, learning et marketing.
- Verrouille les emails en `processing` avant envoi pour eviter les doublons si deux workers tournent.
- Reprend automatiquement les messages bloques en `processing` depuis plus de 10 minutes.

## Variables Railway a mettre

Obligatoires:

- `DATABASE_URL`
- `DATABASE_SSL=true`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `STAFF_REVIEW_EMAIL`

Recommandees:

- `OPS_WORKER_COMMUNICATION_INTERVAL_MS=60000`
- `OPS_WORKER_COMMUNICATION_LIMIT=50`
- `OPS_WORKER_AGENT_INTERVAL_MS=900000`
- `OPS_WORKER_AGENT_DAYS=30`
- `OPS_WORKER_RUN_COMMUNICATIONS=true`
- `OPS_WORKER_RUN_AGENTS=true`

Optionnelles plus tard:

- `OPENAI_API_KEY`
- `OPENAI_MARKETING_MODEL`
- `META_ACCESS_TOKEN`
- `LINKEDIN_ACCESS_TOKEN`
- `TIKTOK_ACCESS_TOKEN`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM`

## Deploiement Railway

1. Connecter le repo GitHub dans Railway.
2. Choisir un service Node/Nixpacks.
3. Start command: `npm run worker:ops`.
4. Ajouter les variables ci-dessus.
5. Lancer `npm run db:migrate` une fois avant ou pendant le premier deploy.
6. Verifier les logs Railway: les lignes doivent afficher `communications:ok` puis `agents:ok`.

## Important

Quand Railway tourne en continu, les crons Vercel peuvent rester comme secours, mais idealement avec une frequence faible. La file est maintenant protegee, mais un seul worker principal reste plus propre.

# Emailing et relances

## Systeme actuel

Les emails passent par Resend.

Les communications sont stockees en base puis traitees par le worker.

Le systeme gere:

- envoi;
- retry;
- backoff;
- statut;
- erreurs;
- relances;
- follow-up.

## Variables critiques

Ne pas copier les valeurs dans Obsidian.

- `RESEND_API_KEY`
- `RESEND_FROM`
- `STAFF_REVIEW_EMAIL`
- `DATABASE_URL`

## Comportement attendu

Pour une reservation:

1. email de reception ou confirmation;
2. relance avant venue;
3. message si retard ou ajustement;
4. follow-up apres visite si necessaire.

## A surveiller

- taux d'echec email;
- destinataires invalides;
- communications bloquees en `failed`;
- absence de `communications:ok` dans Railway;
- volume Resend journalier.

## Prochaine amelioration importante

Ajouter une page direction claire:

- mails envoyes;
- mails echoues;
- files d'attente;
- relances a venir;
- raison de chaque decision.


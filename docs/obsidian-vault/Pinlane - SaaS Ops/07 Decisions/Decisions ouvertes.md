# Decisions ouvertes

## A trancher

### IA serveur

Choisir entre:

- OpenAI API directe;
- Vercel AI Gateway;
- autre provider.

Decision bloquante pour agents redacteurs/analyseurs 24/7.

### SMS

SMS en standby.

Options futures:

- Twilio;
- Brevo;
- MessageBird;
- autre provider local.

### Auth production

Le code staff actuel fonctionne, mais une vraie production devrait avoir:

- comptes;
- roles;
- logs d'acces;
- rotation de codes;
- reset securise.

### Multi-tenant

Pinlane doit clairement separer:

- proprietaire plateforme;
- client Fun Galaxy;
- centres;
- roles staff;
- donnees reservation.

### Retards

Construire le vrai module:

- declarer retard;
- recalculer impact;
- proposer alternatives;
- informer client/staff;
- log decision.


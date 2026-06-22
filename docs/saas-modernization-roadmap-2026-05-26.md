# Roadmap SaaS propre - Fun Galaxy Ops

Date: 2026-05-26

Objectif: transformer l'application actuelle en produit SaaS B2B fiable, vendable et maintenable, sans casser le moteur metier deja construit. Stripe / paiement en ligne est volontairement hors scope pour maintenant.

## Decision globale

On ne migre pas tout d'un coup. Le bon plan est une migration progressive:

1. Stabiliser le moteur de disponibilites comme source de verite unique.
2. Sortir l'interface client/staff/admin du gros fichier statique vers une app Next.js TypeScript.
3. Mettre les donnees dans un schema Postgres propre avec Drizzle.
4. Ajouter auth, roles et multi-centres.
5. Industrialiser les mails et les jobs de rappel.
6. Ajouter l'IA uniquement sur les zones ou elle apporte de la valeur: analyse, explication, suggestions, redaction, red team.

Regle produit: aucune IA ne doit inventer une disponibilite. Le planning reste deterministe. Les agents expliquent, testent, recommandent et surveillent.

## 1. Next.js + TypeScript

### Pourquoi

Le projet actuel est devenu trop dense dans un seul fichier. Pour une vraie entreprise, il faut:

- routes separees pour client, staff et direction;
- composants reutilisables;
- API routes structurees;
- types partages entre UI, API et moteur;
- chargement plus propre;
- base plus facile a tester.

### Choix

Utiliser Next.js App Router avec TypeScript.

Structure cible:

```text
src/
  app/
    (public)/reservation/page.tsx
    (staff)/staff/page.tsx
    (direction)/direction/page.tsx
    api/
      availability/route.ts
      reservations/route.ts
      communications/route.ts
      cron/dispatch-communications/route.ts
  components/
    ui/
    booking/
    staff/
    direction/
  lib/
    engine/
    db/
    auth/
    mail/
    ai/
  server/
    reservations/
    communications/
    analytics/
```

### A faire

- Creer une app Next.js parallele sans supprimer `index.html`.
- Extraire le moteur de planning dans `src/lib/engine`.
- Porter une page a la fois: client, puis staff, puis direction.
- Garder les endpoints actuels actifs pendant la transition.

### Definition de fini

- Le parcours client reserve bowling, laser et formule depuis Next.js.
- Les donnees staff/admin viennent des memes fonctions serveur que le client.
- Build Next.js vert sur Vercel.

## 2. Tailwind + shadcn/ui, mais design sobre

### Pourquoi

On veut une UI pro, coherente, lisible, sans repartir dans une interface "gadget".

### Choix

- Tailwind pour les tokens et layouts.
- shadcn/ui pour les composants accessibles et modifiables.
- Base Radix pour rester compatible avec les composants solides et les patterns dashboard.
- Theme maison: noir, blanc, gris, accent discret. Pas de gradients.

### A faire

- Definir des tokens: background, card, border, text, muted, accent, danger, success, warning.
- Creer des variantes de badges: reserve, en cours, termine, annule, paye, attente.
- Standardiser boutons, tabs, dialog, input, table, date picker.
- Interdire les couleurs inline non referencees par token.

### Definition de fini

- Client garde l'esprit Fun Galaxy.
- Staff/admin deviennent SaaS/ERP sobres.
- Toutes les tables restent lisibles en sombre et en clair.

## 3. Neon Postgres + Drizzle

### Pourquoi

Aujourd'hui, le systeme manipule beaucoup de donnees metier: centres, reservations, sessions laser, pistes, mails, logs agents, evenements terrain. Il faut une base relationnelle propre.

### Choix

- Neon Postgres pour le stockage serverless.
- Drizzle ORM pour schema TypeScript, migrations et requetes typees.
- `@neondatabase/serverless` ou `pg` selon runtime. Pour Vercel serverless, privilegier le driver serverless / pooling.

### Tables cibles

```text
centers
resources
reservations
reservation_segments
laser_sessions
communication_jobs
ops_events
agent_decisions
agent_suggestions
staff_users
audit_logs
```

### A faire

- Convertir `database/ops-schema.sql` en migrations Drizzle.
- Ajouter une table `reservation_segments` pour representer bowling, laser, arcade, formule.
- Ajouter `agent_decisions` pour journaliser chaque choix de l'algo.
- Ajouter contraintes DB: capacite laser, piste, centre, date, status.

### Definition de fini

- Une reservation formule est lisible segment par segment.
- Un changement drag and drop cree un audit log.
- Les exports direction lisent la DB, pas des aggregations fragiles cote client.

## 4. Auth, roles et multi-centres

### Pourquoi

Le produit doit pouvoir etre montre a une direction. Il faut savoir qui fait quoi:

- staff;
- manager centre;
- direction multi-centres;
- admin produit.

### Choix

Better Auth est coherent avec le besoin actuel: open-source, TypeScript, organisations, roles, permissions. Clerk reste une alternative tres rapide si on veut accelerer, mais Better Auth garde plus de controle dans notre code.

### Roles cibles

```text
staff:libramont
manager:libramont
direction:all
admin:product
```

### Permissions cibles

- `reservation.read`
- `reservation.write`
- `reservation.move`
- `reservation.cancel`
- `payment.mark_paid`
- `mail.read`
- `mail.retry`
- `direction.read`
- `settings.write`

### A faire

- Proteger `/staff` et `/direction`.
- Associer chaque utilisateur a un ou plusieurs centres.
- Journaliser les actions sensibles.

### Definition de fini

- Un staff Libramont ne voit pas Gembloux sauf permission.
- La direction peut changer de centre sans changer d'URL produit.
- Les exports ne sont accessibles qu'aux roles autorises.

## 5. Resend + emails operationnels

### Pourquoi

Seb a insiste sur la relation humaine. Le mail ne doit pas ressembler a une automation froide. Il doit etre simple, clair, presque comme ecrit par Rachel ou par l'equipe.

### Choix

- Resend pour l'envoi.
- React Email seulement pour structurer proprement les templates, sans design lourd.
- File persistante `communication_jobs`.
- Cron / worker pour envoyer les messages dus.

### Templates minimum

- Demande recue.
- Confirmation definitive.
- Rappel J-2.
- Rappel jour J.
- Retard / ajustement.
- Message staff si risque ou exception.

### Regles

- Le client ne recoit pas un mail "trop design".
- Pas de SMS affiche dans l'interface tant que le fournisseur SMS n'est pas pret.
- Les erreurs Resend restent visibles en admin, pas dans le parcours client.

### Definition de fini

- Chaque mail a un statut: queued, sent, failed, cancelled.
- Chaque echec a une erreur lisible.
- Le staff peut relancer un mail sans toucher au code.

## 6. Jobs, cron et fiabilite

### Pourquoi

Les rappels, apprentissages, exports et simulations ne doivent pas dependre d'un navigateur ouvert.

### Choix

- Vercel Cron Jobs pour les taches simples.
- Route protegee par `CRON_SECRET`.
- Plus tard, si besoin durable: Vercel Workflow ou une queue.

### Jobs cibles

- `dispatch-communications`: mails dus.
- `agent-orchestrator`: lecture des evenements et suggestions.
- `daily-center-summary`: resume direction.
- `simulation-rush`: tests internes hors production.

### Definition de fini

- Un cron ne peut pas envoyer deux fois le meme mail.
- Chaque execution cree un log.
- En cas d'erreur, elle apparait en direction/admin.

## 7. IA et agents utiles

### Pourquoi

Les agents ne doivent pas etre une illusion. Ils servent seulement si leurs actions sont auditees, bornees et utiles.

### Choix

Vercel AI SDK / ToolLoopAgent est adapte a un projet TypeScript/Vercel. Les agents ont des outils limites:

- lire disponibilites;
- lire reservations;
- lire evenements;
- proposer un message;
- proposer une action staff;
- lancer un test de coherence.

### Agents cibles

- `planning-critic`: verifie qu'un plan est coherent.
- `delay-advisor`: explique l'impact d'un retard.
- `communication-writer`: redige un mail humain.
- `ops-redteam`: cherche les scenarios qui cassent le planning.
- `director-analyst`: resume jour/semaine/mois par centre.

### Regle dure

L'agent ne confirme jamais une reservation si le moteur deterministe dit non.

### Definition de fini

- Chaque decision agent est stockee avec input, output, outils utilises, temps et resultat.
- Les suggestions sont visibles mais ne modifient pas les regles sans validation.
- Les tests de stress alimentent des cas de regression.

## 8. Observabilite et qualite

### Pourquoi

Pour vendre a une entreprise, il faut prouver que ca tient.

### Choix

- Vercel Observability pour fonctions et erreurs.
- Speed Insights / Web Analytics pour mesurer le front.
- Logs internes pour les decisions metier.
- Tests automatiques par niveau.

### Tests cibles

- Unitaire: moteur de disponibilite.
- Integration: API reservation.
- Stress: jour charge, retards, grosses formules.
- E2E: client reserve, staff deplace, direction exporte.
- Red team: reservation impossible ne doit jamais apparaitre comme disponible.

### Definition de fini

- Aucun slot propose au client ne doit echouer a la confirmation.
- Chaque bug ajoute un test de non-regression.
- Le dashboard direction affiche les erreurs critiques.

## 9. Ce qu'on ne fait pas maintenant

- Stripe / paiement en ligne.
- SMS visible cote produit.
- Migration totale en une seule passe.
- Agent autonome qui change les regles sans validation humaine.
- Refonte des regles metier sans preuve terrain.

## 10. Ordre de chantier recommande

### Phase 0 - Verrouiller l'existant

- Garder le site actuel en production.
- Ajouter tests de regression sur les bugs recents: bowling simple qui devient formule, laser 7 places, slots impossibles proposes.
- Nettoyer les variables sensibles et secrets.

### Phase 1 - Moteur central

- Extraire toutes les fonctions disponibilite/reservation dans un module pur.
- Le client, staff et admin doivent utiliser ce module.
- Ajouter `reservation_segments`.

### Phase 2 - DB propre

- Drizzle schema.
- Migrations Neon.
- Audit logs.
- Communication jobs.

### Phase 3 - Next.js shell

- Nouvelle app en parallele.
- Layouts public/staff/direction.
- Design system shadcn sobre.

### Phase 4 - Parcours client

- Bowling simple.
- Laser direct.
- Formules avec choix client et choix agent.
- Filtrage strict: seules les configurations confirmables s'affichent.

### Phase 5 - Staff production

- Planning bowling stable.
- Planning laser stable.
- Drag and drop avec validation serveur.
- Rush board: arrivees, retards, actions, encaissements.

### Phase 6 - Direction

- Multi-centres.
- Exports Excel propres.
- Rapport pro imprimable.
- Journaux agents/mails.

### Phase 7 - Agents bornes

- Analyse, redaction, red team, resume.
- Pas de modification automatique des regles.
- Suggestions approuvables.

## Sources officielles verifiees

- Next.js App Router: https://nextjs.org/docs/app
- Next.js project structure: https://nextjs.org/docs/app/getting-started/project-structure
- Next.js CSS / Tailwind: https://nextjs.org/docs/app/getting-started/css
- shadcn/ui installation: https://ui.shadcn.com/docs/installation
- shadcn/ui Next.js: https://ui.shadcn.com/docs/installation/next
- Drizzle PostgreSQL: https://orm.drizzle.team/docs/get-started-postgresql
- Neon serverless driver: https://neon.com/docs/serverless/serverless-driver
- Better Auth installation: https://better-auth.com/docs/installation
- Better Auth organization plugin: https://better-auth.com/docs/plugins/organization
- Resend Next.js: https://resend.com/nextjs
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
- Vercel Observability: https://vercel.com/docs/observability
- Vercel Speed Insights: https://vercel.com/docs/speed-insights
- Vercel AI SDK ToolLoopAgent: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
- Vercel AI SDK agents: https://ai-sdk.dev/docs/agents/building-agents

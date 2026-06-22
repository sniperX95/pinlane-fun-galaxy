# Fun Galaxy Agent Stack

Date: 2026-05-20

Ce document repertorie les meilleurs agents, frameworks et skills retenus pour le projet. Le but n'est pas d'ajouter de l'IA partout, mais de rendre le produit plus fiable, plus vendable et plus auditable pour des vrais centres.

## Decision courte

Le bon stack pour le projet est hybride:

- Moteur planning deterministe en source de verite.
- Agents metier bornes: planning, retard, communication, apprentissage, direction.
- Nouveaux agents de securite, red team, recherche et design pour fiabiliser le produit.
- LLM seulement pour les drafts, analyses et explications au depart.
- Red team et traces avant toute autonomie forte.

## Pourquoi pas juste CrewAI/LangGraph partout ?

Les frameworks multi-agents sont puissants, mais le coeur du probleme Fun Galaxy est un probleme de contraintes: heures, pistes, armes laser, groupes, retards, formules, satisfaction client. Un LLM ne doit pas inventer une disponibilite. Il doit aider a expliquer, analyser, rediger, red-teamer et ameliorer.

## Sources retenues

- OpenAI Agents SDK: agents specialises, outils, handoffs, guardrails, traces, evals.
- Vercel AI SDK ToolLoopAgent: agents TypeScript multi-etapes compatibles Vercel.
- LangGraph: persistence, checkpoints, reprise, human-in-the-loop.
- Promptfoo: red team automatique, injections, fuites, politiques, OWASP/NIST.
- OWASP GenAI Security Project: menaces LLM et agentic AI.
- NIST AI RMF + GenAI Profile: gouvernance et gestion du risque.
- AutoGen AgentChat: workflows multi-agents graph/swarm/selector.
- Codex Agent Skills: workflows reutilisables avec instructions, scripts et references.

## Agents du projet

| Agent | Statut | Role |
| --- | --- | --- |
| orchestrator-agent | live | Lit les donnees du site, route les agents et organise l'amelioration continue. |
| planning-agent | live | Trouve les scenarios Bowling/Laser/Formules compatibles. |
| delay-agent | live | Analyse l'impact des retards et incidents. |
| communication-agent | live | Prepare confirmations, rappels et messages humains. |
| learning-agent | live | Transforme les evenements terrain en suggestions controlees. |
| director-agent | live | Resume les donnees par centre et periode. |
| security-agent | nouveau | Controle OWASP/NIST, actions sensibles, fuite donnees, excessive agency. |
| qa-redteam-agent | nouveau | Genere cas limites et tests adversariaux. |
| research-agent | nouveau | Surveille frameworks, concurrents et opportunites produit. |
| design-agent | nouveau | Maintient lisibilite, coherence et qualite visuelle. |

## Skills prioritaires

1. Planning fiable: contraintes, ressources, buffers, explications.
2. Communication humaine: mails simples, rappels, relances.
3. Securite IA: OWASP, NIST, Promptfoo, permissions.
4. Observabilite/evals: traces, events, tests, comparaison.
5. Skills Codex projet: design QA, verification navigateur, exports pros.

## Roadmap d'activation

P1:

- Faire tourner le cron `agent-orchestrator` pour relire les donnees en fond.
- Ajouter red team Promptfoo sur endpoints sandbox.
- Journaliser chaque decision agent avec reservationId, centerId et scenario retenu.
- Brancher un LLM uniquement sur les brouillons email/analyse, jamais sur une confirmation directe.

## Orchestration runtime

Le chef d'orchestre ne se contente pas d'afficher le catalogue. Il lit:

- reservations de la periode;
- mails envoyes, en file ou en echec;
- suggestions agents;
- evenements terrain;
- connaissance centre/formules/activites;
- statuts pistes.

Il classe ensuite chaque agent en `active`, `monitor`, `collect`, `scheduled` ou `roadmap_only`. Cela evite de faire croire qu'un agent est autonome quand il est seulement en roadmap.

## Apprentissage continu

Le systeme peut tourner en fond via `/api/cron/agent-orchestrator`. Sur Vercel Hobby, le cron est configure en quotidien; un rythme horaire demandera un plan qui l'autorise et un changement explicite du schedule. Il ne modifie pas les regles automatiquement: il enregistre des suggestions dedupees, visibles et approuvables. C'est volontairement prudent, parce que changer une duree Laser ou un buffer sans validation peut casser le planning.

Les agents affiches comme `planned` sont des capacites de catalogue, de skill ou de test, pas des handlers autonomes en production. Les handlers runtime actuels sont: orchestrator, planning, retard, communication, apprentissage et direction.

P2:

- Ajouter Vercel AI SDK / AI Gateway si la configuration modele est prete.
- Ajouter workflow durable pour emails et validations exceptionnelles.
- Creer des skills Codex dedies au projet: planning audit, design QA, security review, export pro.

## Regle produit

Un agent qui ne peut pas expliquer sa decision ne doit pas modifier le planning.

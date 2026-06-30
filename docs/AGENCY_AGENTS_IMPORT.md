# Agency Agents Import

Date: 2026-06-26

Source: https://github.com/msitarzewski/agency-agents  
Licence: MIT  
Miroir local: `tmp/vendor/agency-agents`  
Registre Pinlane: `ops-knowledge/agency-agents-reference.json`

## Ce qui a ete importe

Le depot contient 251 agents repartis en 20 divisions: engineering, design, product, marketing, sales, testing, security, support, finance, strategy et autres specialites.

Pinlane ne doit pas charger ces 251 agents comme des boutons ou des cartes dans le produit. Ce serait illisible et faux. Le bon usage est de transformer cette bibliotheque en operating system interne.

## Equipe Pinlane retenue

| Role Pinlane | Inspiration Agency | Usage concret |
| --- | --- | --- |
| Executive Director / Chef d'orchestre | Multi-Agent Systems Architect, Product Manager, strategy playbooks | Decouper les demandes, router les roles utiles, garder les decisions traçables. |
| Planning Reliability | Software Architect, Backend Architect, Reality Checker | Bowling, Laser, formules, retards, conflits, alternatives et drag/drop. |
| UX / SaaS Product Design | UX Architect, UI Designer, Persona Walkthrough | Ecrans simples, lisibles, utilisables par staff et direction sans formation lourde. |
| Customer Communication | Email Strategist, PR Communications, Customer Success | Confirmations, rappels, alternatives aux refus, ton humain, no-show. |
| Simulation / QA / Evidence | API Tester, Evidence Collector, Test Results Analyzer | Simulations chargees, preuves, logs, regression et tests visuels. |
| Security / Governance | AppSec Engineer, Security Architect, Incident Commander | Secrets, permissions, actions sensibles, prompt injection, retries et couts. |
| Growth / Campaigns | Social Strategist, Growth Hacker, Offer Strategist | Campagnes et contenu bases sur les vraies activites des centres. |

## Regles d'utilisation

- Les agents servent a mieux penser et mieux verifier, pas a inventer une disponibilite.
- Les disponibilites restent calculees par le moteur planning deterministe.
- Les actions sensibles restent visibles, tracees et approuvables.
- Les agents generatifs commencent par des brouillons, analyses et recommandations.
- Toute page SaaS doit rester KISS: moins de bruit, moins de cartes, plus de decision claire.

## Prochaine evolution utile

1. Brancher le registre dans les tests agents pour verifier que les roles critiques existent.
2. Ajouter des logs de decision plus lisibles pour les refus avec alternatives.
3. Faire passer les pages staff par le filtre UX: "Seb ou la directrice comprennent en 3 secondes ?".
4. Ajouter des evals de simulation: refus sans alternative, conflit drag/drop, mail incomplet, retard absorbable.

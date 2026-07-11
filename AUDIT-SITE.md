# AUDIT-SITE — Audit total Pinlane (2026-07-09)

Méthode : 6 agents parallèles (client / staff / direction.html / adminView / marginales+inventaire / code), harnais local `run-visual-qa.js` (fetch stubbé — zéro écriture prod), screenshots light+dark × 1440×900 + 390×844 dans `artifacts/audit/<zone>/`. Baseline `npm run test:ops:all` **verte** avant toute modif (`artifacts/baseline-test-2026-07-09.log`, EXIT:0).

## 1. Inventaire exhaustif (fait foi)

| # | Page/route | Rôle | Screenshots | Statut audit |
|---|---|---|---|---|
| 1 | `index.html` — vue CLIENT (`/`, `/reserver`) | Flux résa public | `artifacts/audit/client/` (37) | ✅ audité |
| 2 | `index.html` — vues STAFF (Vue d'ensemble, Planning ×2, Réservations, Clients, Emails, Campagnes, Tarifs, Groupes, palette, menus) | Console staff | `artifacts/audit/staff/` (68) | ✅ audité |
| 3 | `index.html` — vue ADMIN `#adminView` (scoreboard, Établissement, Mails & agents, users) | Console direction intégrée | `artifacts/audit/admin/` | ✅ audité (agent complémentaire) |
| 4 | `direction.html` | Outil direction standalone : Mails, Modèles, Agents, Journal, Simulation rush | `artifacts/audit/direction/` (47) | ✅ audité |
| 5 | `public-form.html` | Formulaire embarquable (iframe fungalaxy.be) | `artifacts/audit/client/` (25) | ✅ audité |
| 6 | `pro.html` | Landing B2B/pilote | `artifacts/audit/marginal/` | ✅ audité |
| 7 | `menu/gembloux/index.html` + `qr.html` | Carte menu + chevalet QR (branding Fun Galaxy propre — jugés sur bugs/UX/a11y/perf, PAS sur tokens Pinlane) | `artifacts/audit/marginal/` | ✅ audité |
| 8 | `menu/libramont/index.html` + `qr.html` | idem | `artifacts/audit/marginal/` | ✅ audité |
| — | `api/*.js` (13) | JSON only — aucun ne sert de HTML (vérifié) | — | ✅ audité (code) |
| — | `tmp/**` (28 HTML), `.vercel/output/**` (4) | Débris locaux gitignorés, jamais déployés | — | hygiène, hors pages |
| — | `node_modules/**` (6 HTML) | vendored | — | hors périmètre |
| — | `/robots.txt`, `/sitemap.xml`, `/favicon.ico` | **absents** + 401 middleware | — | finding W1-3 |

Contradiction résolue : le journal disait « favicon ajouté 03-07 » — vrai pour `<link rel="icon">` (pinlane-mark.svg, 4 pages), mais `/favicon.ico` racine n'existe pas et est 401 par le middleware.

## 2. Findings consolidés

### P0 — bugs
| ID | Zone | Finding | Preuve |
|---|---|---|---|
| P0-1 | Staff | Panne de poll silencieuse : badge « Données en temps réel » figé, `remoteSyncFailureCount`/`remoteSyncLastFailure` calculés (`app-main.js:1602-1612`) mais consommés nulle part — après 6 échecs, backoff actif et UI identique, données périmées présentées comme live | `staff/68_erreur-repro-apres-6-echecs_dark_desktop.png` vs `67_…avant-panne` |
| P0-2 | Direction | « Simulation rush » crée de vraies lignes en table `reservations` prod (centre réel, date réelle, `channel sim-*` non filtré dans staff-state/admin-range) | `lib/ops-simulation.js:1140-1167`, `lib/database.js:1536-1547` |
| P0-3 | Direction | Reset simulation cassé en permanence : le front n'envoie ni `runId` ni `confirmResetAll`, le serveur exige l'un des deux → échec silencieux (pas de try/catch) | `direction.html:245-249` vs `api/simulation.js:89-96` |
| P0-4 | Client | Toggle light/dark = no-op sur TOUTE la zone client : `color-scheme:dark` figé + tokens en dur, une seule override light (logo) | `pinlane-client.css:2830` ; screenshots light/dark identiques |

### P1 — logique / design structurel
| ID | Zone | Finding | Preuve |
|---|---|---|---|
| P1-1 | Client | Zone client entière sur l'ancien skin Fun Galaxy (fond noir, violet `#944292`, glow néon) — viole les 3 interdits permanents de DESIGN.md §1 ; migration v2 inachevée (double définition `.card-icon.teal`) | `pinlane-client.css:2767-2831, 2936-2978, 220-224 vs 2907-2912` |
| P1-2 | Direction | `Promise.all` fail-fast sur 5 permissions : un rôle `emails.view` seul perd TOUT l'outil | `direction.html:81-87`, `api/ops.js:905-919` |
| P1-3 | Direction | Actions à risque sans try/catch ni disabled : `dispatchQueue` (25 emails réels, double-clic = double envoi), `startSimulation`, `resetSimulation` | `direction.html:214-249, 276-280` |
| P1-4 | Direction | Erreur de chargement masquée en « vide » (erreur écrite hors `render()`, re-render l'efface) | `direction.html:100-102` |
| P1-5 | Staff | Modale « Créer un rôle » en thème clair figé sur UI dark (couleurs en dur) | `staff/60_modale-creer-role_dark_desktop.png` |
| P1-6 | Staff | Groupes & anniversaires : seule page « Clients & marketing » restée chrome V1 (`renderStaffUtilityPage` `app-main.js:7407-7447`) + table `min-width:720px` qui déborde sans scrollbar visible (actions perdues) | `pinlane-staff.css:3801-3808`, `app-main.js:5765` ; `staff/09, 18` |
| P1-7 | Marginal | `pro.html` : ~70 % du contenu `opacity:0` sans scroll réel (IntersectionObserver seuil 0.16, pattern unique à cette page) — invisible pour bots/OG/print | `pinlane-landing.js:6-18`, `pinlane-landing.css:882-891` |
| P1-8 | Marginal | `/robots.txt`, `/sitemap.xml`, `/favicon.ico` : absents + 401 middleware (crawlers bloqués). NB : le catch-all Basic Auth sur chemins inconnus est VOLONTAIRE (protège lib/, scripts/, docs/ servis statiquement) — on whiteliste uniquement les 3 fichiers, on ne l'ouvre pas | `middleware.ts:66-93` ; curl prod 401 |
| P1-9 | Marginal | Cartes menu = JPG plat sans alternative textuelle (prix, mention légale alcool inaccessibles — WCAG 1.1.1) | `menu/gembloux/index.html:27-30` |
| P1-10 | Client | `public-form.html` duplique pricing/formules/laser en dur au lieu de `window.PinlaneBookingCore` — deux sources de vérité qui divergeront | `public-form.html:134-138` vs `booking-core.js:9-13` |
| P1-11 | Staff | Planning mobile 390px illisible (libellés 2-3 chars) — V1 protégé par décision proprio : fix minimal d'usabilité seulement, pas de refonte | `staff/20_planning-bowling_loaded_dark_mobile.png` |

### P2 — design/UX/a11y
| ID | Zone | Finding | Preuve |
|---|---|---|---|
| P2-1 | Client | Erreurs de formulaire : bannière générique sans `role="alert"`/`aria-live`, pas de bordure danger ni message par champ (DESIGN.md §6) | `app-main.js:2719-2723`, `index.html:133` |
| P2-2 | Client | Icônes occasion en emoji brut (🎂👥💼…) au lieu de SVG | `index.html:307-311`, `public-form.html:81-85` |
| P2-3 | Staff | Export CSV clients sans garde de chargement (`exportStaffClientsCsv` `app-main.js:10038-10054`) — le garde existe déjà côté admin (`exportAdminReport` `app-main.js:625`) : appliquer le même pattern | `staff/66_…`, `_export-before-load.csv` |
| P2-4 | Staff | Campagnes vide : 404 mappé « Élément introuvable ou déjà supprimé » (msg trompeur, `api-client.js:50`) | `staff/07_campagnes` |
| P2-5 | Direction | Badges `critical` et `high` identiques (danger) — hiérarchie perdue | `pinlane-client.css:2241-2246` |
| P2-6 | Direction | Tabs sans `role="tablist"/tab/aria-selected` ; modale aperçu sans `role="dialog"`, ni Escape, ni focus trap | `direction.html:33-37, 261-275` |
| P2-7 | Marginal | `qr.css` contrastes 3.05:1 (< 4.5:1) sur eyebrow/foot | `menu/assets/qr.css:22,39` |
| P2-8 | Marginal | Cartes menu 1,27 Mo / 1,09 Mo JPG 2645×3742 preloadés sans srcset/WebP | `ls menu/*/carte-1.jpg` |
| P2-9 | Marginal | Transition WebGL ~3,4 s à CHAQUE scan QR avant lecture carte (reduced-motion OK) | `viewer.js:821-824` ; screenshots transition |
| P2-10 | Client | Perf : la page publique charge tout le bundle staff/admin (~1,46 Mo non compressé : app-main 727 K + staff-v2 + admin/ops-console + pinlane-staff.css 297 K) | `index.html:16-24` |

### P3 — polish
| ID | Zone | Finding | Preuve |
|---|---|---|---|
| P3-1 | Staff | `#locSelect` phantom : DOM présent, display:none, texte figé « Libramont » | `index.html:51`, `app-main.js:2274` |
| P3-2 | Staff | Toggle thème dupliqué (segment inline sur Planning + entrée menu partout) | `staff/02` |
| P3-3 | Direction | Suggestion sans titre affiche l'ID technique brut ; preview vide = `<pre>` blanc | `direction.html:144, 267` |
| P3-4 | Direction | Segmented 5 onglets déborde en 390px | `direction/05_simulation…390` |
| P3-5 | Marginal | `pro.html` orpheline (aucun lien interne — probablement voulu, à confirmer proprio) | grep `pro.html` |
| P3-6 | Marginal | `tmp/` : 29 Mo de copies de staging datées juin, gitignorées — à purger localement | `du -sh tmp/*` |
| P3-7 | Client | Bouton « Accès SaaS » flottant sur le parcours client public | `index.html:72` |
| P3-8 | Client | 4 familles de polices (~158 Ko) au lieu des 2 de DESIGN.md §4 (Anton/Montserrat = skin legacy) | `index.html:9-12` |
| P3-9 | Client | États « vide » vs « panne » quasi identiques (guidance différente nécessaire) | screenshots `05` vs `10` |

### Zone CODE (API / logique / legacy / CSS / perf)

| ID | Prio | Finding | Preuve | Fix |
|---|---|---|---|---|
| C1 | P1 | Fuite d'erreurs brutes sur endpoints PUBLICS (catch-all renvoie `error.message` sans masquage infra, contrairement au pattern staff) | `api/public-availability.js:847`, `api/public-reservations.js:79-81` vs `api/staff-reservations.js:214-221` | Copier le filtre `isInfra` de staff-reservations |
| C2 | P1 | N+1 massif : `findReservationAlternatives` = jusqu'à 160 `prepareReservationOps` séquentiels, même date relue ~20-80× en DB, sur CHAQUE POST public échoué | `lib/reservation-alternatives.js:185,194-234` → `lib/reservation-ops.js:136` | Mémoïser le snapshot par date |
| C3 | P1 | Pas de `maxDuration` sur public-reservations → la recherche d'alternatives peut 504 au lieu du 409+alternatives | `vercel.json:5-9` | maxDuration + réduire maxChecks post-C2 |
| C4 | P1 | `getRequiredLaneCount` appelé SANS `bowlingConfig` dans les alternatives → fallback 8 pistes/6 joueurs même pour centre configuré autrement | `lib/reservation-alternatives.js:216` vs `lib/booking-config.js:457` | Passer la config centre |
| C5 | P1 | `allocateLanes` triplé : `api/public-availability.js:192-237` = copie byte-identique de `lib/database.js:751-793` ; verdict : ops-engine (plan) ET database (écriture) tournent tous les deux, convergence fragile via `ensureAssignableLanes:818-825` | les 3 fichiers | Supprimer la copie, exporter depuis database.js |
| C6 | P2 | PAIRS figé 8 pistes (`[[1,2],[3,4],[5,6],[7,8]]`) dans le chemin d'écriture alors que laneCount est per-center | `lib/booking-config.js:4`, `lib/database.js:764-776` | Générer PAIRS depuis laneCount |
| C7 | P2 | Front figé 8 pistes/6 joueurs/tarifs dupliqués du back (identiques aujourd'hui, zéro synchro) | `assets/booking-core.js:1-14,346-351` vs `lib/booking-config.js:2-28` | Servir via public-booking-meta (pattern déjà en place) |
| C8 | P1 | app-main.js : ~1 400-1 800 lignes mortes cartographiées (5 renderers écrasés par v2 + helpers exclusifs + bloc `legacy*` 9279-9509 + `renderStaffGroupWorkspace` 5317-5469). KEEP : couche data consommée par v2 (`getStaffReservationsMetrics:10530`, `getStaffClientRows:9907`, `getStaffEmailRows:7836`, `getPricingRows:7510`, `selectStaffReservationsDate:10756`) + `renderStaffUtilityPage:7407` | cartographie complète en fin d'audit agent (rangées exactes) | Purge fonction par fonction, jamais par tranche |
| C9 | P2 | `escapeHtml` divergent : copie staff-menu n'échappe pas l'apostrophe | `assets/staff-menu.js:155` vs `app-main.js:1614` | Utiliser l'officiel |
| C10 | P2 | Code mort : `api/cron/agent-orchestrator.js` + `api/cron/dispatch-communications.js` supersédés par `api/cron.js` (déjà exclus du deploy) | `.vercelignore:22-23`, `vercel.json:38-48` | Supprimer |
| C11 | P2 | ~45 littéraux couleur = bloc tokens tenant dans pinlane-client.css + littéraux épars (staff 22, client hors-bloc 4, landing 0 = le modèle) | `pinlane-client.css:2767-2831, 2479, 3341, 3482, 3496` | Absorbé par vague reskin (P1-1) |
| C12 | P3 | CSS morts réels : seulement ~55 lignes dans pinlane-staff.css (23 classes listées) — le « 14 CSS/1,2 Mo » du README = build stale `.vercel/output/` jamais référencé | liste agent (`.guest-*:2234-2265` etc.) | Purger les 55 lignes ; corriger le README projet |
| C13 | P3 | Composants doublonnés staff↔client (booking-alternatives, schedule-hint, info-box, cr-actions, keyframes) | `pinlane-staff.css:6206-6224`↔`pinlane-client.css:144-189` etc. | Remonter dans pinlane.css |
| C14 | P3 | index.html charge admin-console (92 K) + ops-console (75 K) pour tous les profils | `index.html:16-24` | Injection dynamique au premier `setView('admin')` (sans build step) |
| C15 | P3 | ~40 PNG d'audit (~5 Mo) à la racine du repo | `.vercelignore:16-18` | Déplacer dans artifacts/ |
| OK | — | Sains vérifiés : fusion pilot-lead sans code mort · zéro fuite de listeners · polling conforme (4 s/20 s + ETag 304) · a11y statique de base (lang, labels, defer, fonts preload) | — | — |

### Zone ADMIN (`#adminView` + pages staff Administration)

Correction de surface : `#adminView` = scoreboard + 5 onglets (Vue période, Réservations, Clients, Mails & agents, Exports) rendus par admin-console/ops-console ; Établissement et Users sont des pages STAFF (`app-main.js`, gardées par `STAFF_PAGE_PERMISSION_MAP:1979-1997`).

| ID | Prio | Finding | Preuve |
|---|---|---|---|
| A1 | **P0** | `setView('admin')` (`app-main.js:2263-2300`) et `applyInitialRouteFromHash` (`:14540-14545`) ne vérifient AUCUNE permission — un rôle sans `direction.view` atteint le scoreboard financier par le bouton header (`index.html:66`) ou `#admin/reservations`. Établissement/Users sont, eux, correctement gardés | `admin/21_…`, `22c_…` |
| A2 | **P0** | `api-client.js:110-124` : `response.clone()` appelé APRÈS consommation du body → TypeError brut « Failed to execute 'clone'… » affiché à la direction dès qu'une erreur API sort du format `{ok,message}` | `admin/06, 07_…error` |
| A3 | P1 | Formulaire Établissement : min/max HTML5 décoratifs (pas de `<form>`/`reportValidity`), `submitCenterConfig` (`app-main.js:6224-6277`) ne clampe rien — 0 piste, 999 joueurs, -5 armes, fermeture<ouverture acceptés et envoyés | `admin/10_…boundary` |
| A4 | P1 | « Enregistrer » Établissement jamais disabled pendant l'async → double-clic = 2 POST `saveCenterConfig` | `admin/12-14_…slow-save` |
| A5 | P1 | « Archiver » un centre : exécution instantanée sans confirmation — coupe la résa client en direct | `admin/17_…`, `app-main.js:6295-6304` |
| A6 | P1 | Vue période/Cockpit superpose largement le Dashboard staff sans lecture Direction distincte (multi-centre limité à 3 cartes) | `admin/01_…` |
| A7 | P2 | Exports générés (Excel compta, rapport exécutif) en Arial/gris/kaki `#E8DFC9` — hors DESIGN.md | `admin-console.js:456-460, 507-537` |
| A8 | P2 | Sous-onglet « Simulation rush » expose l'outillage QA interne brut dans la console direction | `admin/03_…` |
| A9 | P2 | `admin-tabs` sans wrap/overflow-x en 390px — « Exports » clippé hors zone tactile | `pinlane-staff.css:6925-6934`, `admin/01_…mobile` |
| A10 | P2 | Modale « Créer un rôle » : Échap OK mais focus retombe sur `<body>` au lieu du déclencheur | `app-main.js:6858-6862` |
| A11 | P3 | « Ajouter un centre » : panneau inline (pas modale), pas de contrôle de doublon ID côté front | `admin/15_…` |
| OK | — | Empty state Vue période propre ; modale rôle a `role="dialog"`+`aria-modal`+focus initial | `admin/04_…` |

## 3. Plan de vagues

- **Vague 1 — P0 + robustesse API** : signal de panne poll (P0-1) · Reset simulation + try/catch + disabled sur actions à risque (P0-3, P1-3, P1-4) · fuites d'erreurs publiques (C1) · N+1 alternatives + maxDuration + bowlingConfig (C2, C3, C4) · erreurs direction affichées dans render() (P1-4). NB P0-2 (simulation écrit en prod sans isolation) : fix code = filtre `channel sim-*` optionnel côté lecture ; la purge des lignes sim existantes = décision proprio (destructif).
- **Vague 2 — Unification logique métier** : allocateLanes dédoublonné (C5) · PAIRS dynamique (C6) · config front servie par l'API (C7, P1-10) · escapeHtml unifié (C9) · Promise.all par permission (P1-2) · gardes exports (P2-3) · message 404 campagnes (P2-4). Tests ops = juge objectif.
- **Vague 2bis — P0 admin + garde-fous** : garde de permission sur `setView('admin')` + hash routing (A1) · fix `response.clone()` api-client (A2) · validation réelle Établissement (A3) · disabled save (A4) · confirmation archivage (A5) · focus return modale (A10) · admin-tabs mobile (A9).
- **Vague 3 — Reskin client v2** (P1-1, P0-4, P2-1, P2-2, P3-7, P3-8, C11) : LE gros morceau, commit isolé, before/after complet light/dark/mobile. ⚠️ Changement le plus visible client — réversible en un revert.
- **Vague 4 — Design/a11y/statics** : modale rôle thème (P1-5) · Groupes V2 + table (P1-6) · badges critical/high (P2-5) · tabs+modale ARIA (P2-6) · contrastes qr.css (P2-7) · alt cartes menu (P1-9) · middleware whitelist + robots/sitemap/favicon.ico (P1-8) · pro.html reveal fallback (P1-7) · Planning mobile fix minimal (P1-11).
- **Vague 5 — Purge & perf** : legacy app-main.js ~1 500 lignes (C8, plan fonction par fonction) · CSS morts + doublons (C12, C13) · crons morts (C10) · injection dynamique admin/ops-console (C14) · images menu (P2-8) · PNG racine (C15) · polish P3 restants.
- **Passe adversariale finale** : agent frais, barre de qualité seule, boucle jusqu'à zéro finding sérieux.

Après chaque vague : `npm run test:ops:all` vert + re-screenshots des pages touchées (light/dark/mobile) + commit dédié — une vague sans preuve = non finie.

## 4. État des vagues (2026-07-10)

| Vague | Commit | Contenu | Preuves |
|---|---|---|---|
| 1 — P0 + robustesse API | `06a36c1` | P0-1, P0-3, P1-3, P1-4, C1, C2 (équivalence byte-identique, 29→2 reads), C3, C4 | `artifacts/audit/wave1/`, ops:all vert |
| 2 — Unification logique | `c9376dd` | C5, C6 (équiv. stricte n=8), C7+P1-10 (équiv. prix 1008 cas, diff vide), C9, P1-2, P2-3, P2-4 | `artifacts/audit/wave2/`, ops:all vert |
| 2bis — P0 admin + a11y | `52f4da2` | A1, A2, A3, A4, A5, A9, A10, P1-5 (déjà résolu, prouvé), P2-5, P2-6, P3-3, P3-4 | `artifacts/audit/wave2bis/`, ops:all vert |
| 4a — Statics & marginales | `d2a7e7f` | P1-7, P1-8, P1-9 (transcription réelle des cartes), P2-7 (5.82:1/5.64:1), P2-8 (-75 %), P2-9 + bonus setFace | `artifacts/audit/wave4a/`, security-config vert |
| 3 — Reskin client v2 | `98a5ff3` | P1-1 (couche fgx supprimée), P0-4, P2-1, P2-2, P3-7, P3-8 (-73 Ko fonts), P3-9, C11 | 134/134 assertions, `artifacts/audit/wave3/`, ops:all + visual verts |
| 4b — Staff Groupes + polish | `6203092` | P1-6, P1-11, P3-1, P3-2, A7 + réparation harnais test:visual (2 assertions flaky par construction) | `artifacts/audit/wave4b/`, visual + ops:all verts |
| 5 — Purge & perf | `d8d37b7` | C8 (app-main.js −~1 900 lignes legacy), C10 (2 crons morts supprimés), C12 (CSS morts purgés), C13 (doublons remontés dans pinlane.css), C14 (admin/ops-console lazy-loadés à la demande), C15 (0 PNG racine) | `artifacts/audit/wave5/` (17 shots + assertions réseau `scripts/wave5-manual-check.js`), ops:all + visual verts |
| Adversariale — fixes ADV-1..7 | `98f0c19` | Voir §5 : lazyfail admin (P0), centre perdu, sim step 500, contrastes AA tokens, empty state Modèles, role=alert bespoke, cr-badge tokens | `scripts/adversarial-manual-check.js` ALL OK, `artifacts/audit/adversarial/`, ops:all + visual verts |

**Décisions propriétaire — tranchées le 2026-07-11 (délégation Movsar)** :
- ✅ P0-2 purge `sim-*` prod : FAIT — 20 réservations + 167 artefacts liés (72 communications, 49 ops_events, 28 decision_logs, 18 ops_jobs) supprimés en transaction, backup complet `artifacts/backup-sim-purge-2026-07-11.json`. Restent 18 public + 13 staff ; file de mails propre (0 queued).
- ✅ P3-6 tmp/ : purgé (37 Mo → 0).
- ✅ P3-5 pro.html : reste volontairement orpheline — landing B2B partagée en lien direct, pas de lien depuis le parcours client (cohérent avec le retrait du bouton « Accès SaaS », P3-7).
- ⏸ A6 (lecture Direction distincte du scoreboard) et A8 (Simulation rush en console direction) : reportés à la checklist pré-lancement — refonte produit, et l'outil de simulation sert encore aux démos/formation tant que les données sont de la simulation. À retrancher au moment du wipe pré-lancement (avec le code founder).
- ⏸ Isolation writes simulation (table dédiée vs filtre channel) : même échéance — le besoin disparaît si la simulation est retirée de la console client au lancement.

## 5. Passe adversariale (2026-07-11)

Trois reviewers à contexte frais (zones client / staff+admin / direction+marginales+régression code), interdits de lire cet audit, briefés « prouve que c'est raté » : screenshots light/dark × desktop/mobile, capture pageerror systématique, scan contrastes/overflow instrumenté (`artifacts/adversarial/` : 233 preuves, `_scripts/adv-results.json`).

### Findings → tous corrigés (ce commit)

| ID | Prio | Finding | Preuve | Fix |
|---|---|---|---|---|
| ADV-1 | **P0** | Échec d'injection des consoles lazy (C14) → UI admin morte mais cliquable : le `.catch` de `setView('admin')` restaurait `pointer-events` alors que les onclick statiques de `#adminView` (`index.html:581-609`) pointent vers des fonctions du bundle absent → ReferenceError à chaque clic, aucune issue | `artifacts/adversarial/marginal/index-admin-lazyfail-after-click.png` | Panneau d'erreur `role=alert` + bouton Réessayer (`renderAdminConsoleLoadError`), chrome statique neutralisé pendant la panne ; la promesse rejetée étant purgée du cache, le retry réinjecte réellement |
| ADV-2 | P1 | Premier switch de centre ≠ Libramont silencieusement perdu : `setView('admin')` lance l'injection async puis `typeof setAdminCenter` échoue (le lazy-load garantit l'absence au premier appel) | `staff-menu.js:583` (avant fix) | `openAdminCenter()` mémorise `state.adminCenterId` avant injection (pattern `openAdminTab`) |
| ADV-3 | P1 | `stepSimulation` (onclick + boucle auto) sans try/catch : un 500 = unhandled rejection, zéro feedback, boucle auto morte qui affiche encore « Pause auto » | `run2.log` DIR-SIM-STEP-* | try/catch → bannière `actionError` (role=alert existant) + `stopSimulationAuto` |
| ADV-4 | P1 | Contrastes AA systématiques : dark = blanc sur `--accent` #3291ff à **3.17:1** sur TOUS les éléments actifs (seg-btn, dur-pill, anchor-chip, badge, slot) ; light = `--faint` #8f8f8f à **2.89-3.23** (prix barrés, meta formules, « optionnel », « À régler sur place ») ; texte accent 13px à 4.0-4.36 (kicker, pax-alert, eyebrow) | mesures `adv-results.json` | Tokens : `--accent-contrast` dark → `#0a0a0a` (6.25:1, corrige aussi blanc/success 1.9:1) · `--faint` → `#6f6f6f`/`#828282` (5.0:1+) · textes accent → `--accent-strong` + nouveau `--info-strong` (5.06-8.4:1) |
| ADV-5 | P2 | Onglet Modèles (direction.html) sans état vide : panneau nu quand 0 sample | `artifacts/adversarial/marginal/direction-empty-samples.png` | Empty state aligné sur Suggestions/Journal |
| ADV-6 | P2 | Erreurs « sur mesure » affichées sans `role=alert`/aria-live (index `bespokeError` + public-form `customRequestNotice`) | `adv-results.json` flow bespoke | `role="alert"` sur les deux conteneurs |
| ADV-7 | P3 | `.cr-badge-*` : 4 couleurs en dur + token inexistant `--text-2` (couleur invalide) | `pinlane-staff.css:7577-7580` (avant fix) | Tokens `warning`/`success`/`muted` |

### RAS prouvés (rien à corriger)

Client : 0 pageerror, 0 overflow horizontal sur tout le flux (14 étapes × 4 variantes), erreurs de validation avec 3 role=alert + aria-invalid, état 500 propre avec retry fonctionnel. Staff : 8 pages + palette + modale rôle propres light/dark/mobile ; deep-links `#admin/...` à froid OK ; recovery bundle lent OK. Direction : permissions partielles dégradées proprement (403 par section), erreur 500 affichée, empty states (sauf Modèles → ADV-5). Marginales : menus/QR/pro propres (reduced-motion OK, no-JS pro OK). Le « band » noir direction light et le « chevauchement CTA mobile » = artefacts de capture fullPage (overflow mesuré = 0, pixels sondés).

### Preuves du fix

`scripts/adversarial-manual-check.js` (harnais commité) : ALL OK — lazyfail → panneau + zéro ReferenceError au clic forcé + retry qui réinjecte et rend ; centre conservé à travers le lazy-load ; step 500 → bannière + auto stoppé + zéro rejection ; Modèles vide → état vide ; contrastes re-mesurés 4.55-8.4:1 light+dark sur chaque élément précédemment fautif. Screenshots : `artifacts/audit/adversarial/`.

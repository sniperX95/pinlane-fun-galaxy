---
name: "Pinlane Platform"
description: "Multi-tenant operations OS for bowling and leisure centres."
version: 2
northStar: "Precision Tooling"
colors:
  light:
    page: "#fafafa"
    surface: "#ffffff"
    raised: "#ffffff"
    subtle: "#f2f2f2"
    line: "#ebebeb"
    line-strong: "#d9d9d9"
    text: "#0a0a0a"
    muted: "#5e5e5e"
    faint: "#6c6c6c"
    accent: "#0070f3"
    accent-strong: "#0761d1"
    accent-soft: "#e8f1fd"
    success: "#0f7b3c"
    success-soft: "#e6f4ea"
    warning: "#a35200"
    warning-soft: "#fff3e0"
    danger: "#cb2a2f"
    danger-soft: "#fdecec"
    info: "#0070f3"
  dark:
    page: "#000000"
    surface: "#0a0a0a"
    raised: "#111111"
    subtle: "#1a1a1a"
    line: "#262626"
    line-strong: "#3d3d3d"
    text: "#ededed"
    muted: "#a1a1a1"
    faint: "#8a8a8a"
    accent: "#3291ff"
    accent-strong: "#52a8ff"
    accent-soft: "#0d2137"
    success: "#3dd68c"
    success-soft: "#0e2517"
    warning: "#f5a623"
    warning-soft: "#2a1e05"
    danger: "#f75555"
    danger-soft: "#2c1213"
    info: "#3291ff"
  console-light-page: "#f4f4f4"
  console-light-surface: "#ffffff"
  console-light-raised: "#fbfbfb"
  console-light-subtle: "#efefef"
  console-light-line: "#e1e1e1"
  console-light-line-strong: "#cacaca"
  console-light-control-border: "#888888"
  console-light-text: "#242424"
  console-light-muted: "#606060"
  console-light-faint: "#6b6b6b"
  console-light-accent: "#315d87"
  console-light-accent-strong: "#284e73"
  console-light-accent-soft: "#e8eef4"
  console-light-accent-contrast: "#ffffff"
  console-light-console-selected: "#242424"
  console-light-console-selected-text: "#ffffff"
  console-light-console-selected-surface: "#f4f4f4"
  console-light-console-input: "#ffffff"
  console-light-console-focus: "#315d87"
  console-dark-page: "#181818"
  console-dark-surface: "#222222"
  console-dark-raised: "#2b2b2b"
  console-dark-subtle: "#353535"
  console-dark-line: "#3e3e3e"
  console-dark-line-strong: "#595959"
  console-dark-control-border: "#878787"
  console-dark-text: "#f1f1f1"
  console-dark-muted: "#bcbcbc"
  console-dark-faint: "#b2b2b2"
  console-dark-accent: "#8eb7d9"
  console-dark-accent-strong: "#a5cae7"
  console-dark-accent-soft: "#293746"
  console-dark-accent-contrast: "#181818"
  console-dark-console-selected: "#e9e9e9"
  console-dark-console-selected-text: "#222222"
  console-dark-console-selected-surface: "#303030"
  console-dark-console-input: "#272727"
  console-dark-console-focus: "#8eb7d9"
typography:
  family:
    ui: "Geist, system-ui, -apple-system, 'Segoe UI', sans-serif"
    data: "'Geist Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace"
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  title:
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  label:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0"
  console-title:
    fontFamily: "Geist, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  console-title-mobile:
    fontFamily: "Geist, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  console-control:
    fontFamily: "Geist, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 600
  console-section:
    fontFamily: "Geist, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.01em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  console-overlay: "16px"
  full: "9999px"
spacing:
  unit: "4px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
shadows:
  border: "0 0 0 1px var(--line)"
  sm: "0 1px 2px rgba(0,0,0,.05)"
  md: "0 4px 12px rgba(0,0,0,.08)"
  overlay: "0 8px 30px rgba(0,0,0,.12)"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.line-strong}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 14px"
  card:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.line}"
    rounded: "{rounded.lg}"
    padding: "20px"
  console-button-primary:
    backgroundColor: "{colors.console-light-console-selected}"
    textColor: "{colors.console-light-console-selected-text}"
    rounded: "{rounded.md}"
    typography: "{typography.console-control}"
    height: "40px"
  console-button-primary-dark:
    backgroundColor: "{colors.console-dark-console-selected}"
    textColor: "{colors.console-dark-console-selected-text}"
    rounded: "{rounded.md}"
    typography: "{typography.console-control}"
    height: "40px"
  console-option:
    backgroundColor: "{colors.console-light-surface}"
    textColor: "{colors.console-light-text}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "8px 10px"
  console-option-selected:
    backgroundColor: "{colors.console-light-console-selected}"
    textColor: "{colors.console-light-console-selected-text}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "8px 10px"
  console-activity:
    backgroundColor: "{colors.console-light-raised}"
    textColor: "{colors.console-light-text}"
    rounded: "{rounded.lg}"
    padding: "14px"
  console-overlay:
    backgroundColor: "{colors.console-light-surface}"
    textColor: "{colors.console-light-text}"
    rounded: "{rounded.console-overlay}"
    width: "min(960px, calc(100vw - 32px))"
  console-stepper:
    backgroundColor: "{colors.console-light-console-input}"
    textColor: "{colors.console-light-text}"
    rounded: "{rounded.md}"
    height: "46px"
---

# Design System v2 : Pinlane Platform

## 0. Statut

Ce document **remplace intégralement** l'ancien système « The Operating Console » (fond #050609, accent platine #b8ad9b, Inter). Toute trace de l'ancien système (tokens `--v2-*`, `--pl-*`, `--pf-*`, `--pp-*`, couches CSS empilées) est obsolète et supprimée. Le CSS vit dans un ensemble consolidé unique (voir §8).

## 1. North Star : « Precision Tooling »

Pinlane est un outil de précision, dans le langage visuel de Vercel : surfaces neutres calibrées, bordures 1px, un seul accent bleu, typographie Geist, densité maîtrisée. Rien ne brille, rien ne flotte : la hiérarchie vient du contraste typographique, de l'espacement et des bordures, pas des ombres ni des dégradés.

Interdits permanents : dégradés violet/indigo, glassmorphism, glow néon, ombres portées molles « AI look », fonds quasi-noirs teintés, accent platine/champagne.

Deux univers, un même langage :

- **Console staff/admin** : dense, scannable, monochrome + bleu. L'opérateur lit un état en 2 secondes.
- **Client (tenant)** : mêmes composants, plus d'air (spacing ×1.5), titres plus grands, orienté réassurance et conversion.
- **Entrée plateforme** : une porte sobre à deux colonnes qui sépare l'accès équipe du tunnel public, avec preuve produit structurée par des filets plutôt que par des cartes décoratives.

## 2. Thèmes light / dark

- Attribut `data-theme="light" | "dark"` sur `<html>`. Défaut : `prefers-color-scheme`, persisté en `localStorage('pinlane-theme')`, togglable dans la navigation.
- Chaque token existe dans les deux thèmes (frontmatter ci-dessus). Le CSS ne référence **que** les variables : jamais une couleur en dur.
- Light = thème de référence (console de jour, impression). Dark = pur Vercel : page #000, surfaces #0a0a0a/#111, bordures #262626.

## 3. Couleur

- **Neutres** : 90 % de l'UI. Page, surface, subtle, line, c'est la structure.
- **Accent bleu** (`--accent`) : actions primaires, liens, états actifs de navigation, focus. Un seul accent, jamais deux couleurs vives côte à côte.
- **Statuts** (fonctionnels uniquement, jamais décoratifs) : badge = fond `-soft` + texte couleur pleine + pas de bordure. Vert = payée/active/réussie · Ambre = arrivée/attention · Bleu = confirmée · Rouge = échec/bloquée/annulée. Contraste texte/fond ≥ 4.5:1 dans les deux thèmes.
- **Tenant** : `--tenant-accent` (défaut = `--accent`). Le branding Fun Galaxy n'existe plus que par son logo ; magenta #b356ad et teal #5ec8c8 sont retirés de l'UI.

## 4. Typographie

- **Geist** (UI) et **Geist Mono** (data) : self-hostées, WOFF2 variables, `assets/fonts/`, `font-display: swap`, preload sur les 2 fichiers latin. ~84 KB au total. Inter et IBM Plex Mono ne sont plus chargées.
- Tout ce qui est **donnée** passe en Geist Mono avec `font-variant-numeric: tabular-nums` : heures, prix, capacités, compteurs, IDs, numéros de piste.
- Échelle (UI) : 12 (label/meta) · 13 (dense/table) · 14 (body) · 16 (section) · 20 (page title console) · 24-32 (titres client) · 40-56 (display d'entrée). Titres : weight 600, letter-spacing -0.02em. Le display de l'entrée plateforme resserre à -0.04em, line-height 1.02 et 13ch maximum. Jamais de texte < 12px, jamais d'UPPERCASE avec letter-spacing > 0.05em (l'ancien style « label espacé » disparaît).

## 5. Forme, profondeur, motion

- **Radius** : 6 (boutons, inputs, badges) · 8 (cellules planning, menus) · 12 (cartes, modales) · full (pills, avatars).
- **Profondeur** : bordure 1px d'abord. Ombres réservées aux surfaces flottantes (menus, modales, palette) : `shadows.overlay`. Aucune ombre sur les cartes posées.
- **Motion (console)** : 120-200ms, `cubic-bezier(0.25, 0.1, 0.25, 1)`, `transform`/`opacity` uniquement. Hover = changement de fond/bordure, pas de translation. Entrées de page : fade 8px une fois par navigation, jamais sur le poll 1,2s. `prefers-reduced-motion` : tout à 0.01ms.
- **Motion (tunnel client, 2026-08-17)** : le parcours public a sa grammaire LIQUIDE, décidée par Movsar (référence liquid-gooey). Scène horizontale : changement d'étape = glissement de piste au ressort (`--lq-spring`, `linear()` à léger rebond, retombée `cubic-bezier(0.30,1.25,0.42,1)`, 620ms) ; cascade `lq-pop` sur les blocs qui arrivent (500ms, délais 45ms, plafond 135ms) ; progression et pilule du sélecteur sous filtre gooey SVG (`#plGoo`, formes uniquement, jamais de texte). Exception ENCADRÉE à « transform/opacity seulement » : la largeur du fluide de progression et les bords de la pilule transitionnent en layout, parce qu'un métaball exige des formes dont la taille réelle change (un cercle en scaleX devient une ellipse) ; coût local à des calques absolus ≤26px, liste blanche tenue par le gate visit-motion. `prefers-reduced-motion` : tout se pose instantanément, piste comprise.

## 6. Composants de base

- **Bouton primaire** : fond `text`, texte `surface` (noir sur blanc en light, blanc sur noir en dark, signature Vercel). Hover : opacité fond 0.9. H 40px (32px en contexte dense), radius 6, weight 500.
- **Bouton secondaire** : fond `surface`, bordure `line-strong`, texte `text`. Hover : fond `subtle`.
- **Bouton danger** : fond `danger`, texte blanc. Ghost : texte `muted`, hover fond `subtle`.
- **Inputs** : fond `surface`, bordure `line-strong`, radius 6, H 40px, label visible 13px/500 au-dessus. Focus : bordure `accent` + ring 3px `accent-soft`. Erreur : bordure `danger` + message 12px sous le champ, `role="alert"`.
- **Cartes** : fond `surface`, bordure 1px `line`, radius 12, padding 20. Titre 16/600 + meta 12 `muted`.
- **Tables/listes** : header 12px/500 `muted`, lignes 13-14px séparées par `line`, hover `subtle`, colonnes numériques en Geist Mono alignées à droite.
- **Badges statut** : pill (radius full), 12px/500, padding 2px 10px, fond `-soft` + texte statut. Point 6px optionnel devant.
- **Navigation staff** : sidebar fond `surface`, bordure droite `line` ; item actif = fond `subtle` + texte `text` + barre 2px `accent` à gauche ; inactif = `muted`. Top bar 56px.
- **Entrée plateforme** : conteneur centré 1180px, navigation 76px avec filet bas, grille contenu/preuves `1.25fr / .75fr`, display 40-56px et deux vraies destinations. Sous 760px, la grille devient une colonne ; sous 640px, les deux actions occupent toute la largeur et toutes les cibles font au moins 44px.
- **Synthèse de réservation** : trois faits issus de l'état du moteur dans une grille bordée unique ; valeur en Geist Mono tabulaire, libellé et unité en 12px. Sur mobile, la grille reste à trois colonnes et compresse la typographie sans descendre sous 12px.
- **Planning** : grille bordures `line` ; créneau libre = `surface` ; réservé = fond `accent-soft` + bordure gauche 2px `accent` ; states via couleurs statut. Heures en Geist Mono.
- **Empty states** : icône trait 1.5px `faint`, titre 14/500, texte 13 `muted`, action secondaire.
- **Focus (tout élément interactif)** : `outline: 2px solid var(--accent); outline-offset: 2px`. Cibles tactiles ≥ 44px (mobile) / ≥ 32px + spacing (desktop dense).

## 7. Accessibilité (non négociable)

Contraste ≥ 4.5:1 (texte) et 3:1 (UI) dans les **deux** thèmes · focus visible partout · cibles ≥ 44px mobile · `prefers-reduced-motion` respecté · formulaires labellisés · pas d'info portée par la couleur seule (les statuts ont toujours un libellé).

## 8. Architecture CSS

7 fichiers, ordre de chargement fixe, aucune autre feuille autorisée :

| Fichier | Rôle | Pages |
|---|---|---|
| `assets/pinlane.css` | @font-face, tokens light/dark, reset, base, composants (§6) | toutes |
| `assets/pinlane-staff.css` | console staff + admin (sidebar, dashboard, planning, pages pv2, groupes) | index.html |
| `assets/pinlane-charts.css` | moteur de graphiques `window.PinlaneCharts` (classes `plc-`, ne consomme que les tokens) | index.html |
| `assets/pinlane-daterange.css` | sélecteur de plage de dates `window.PinlaneDateRange` (classes `pdr-`, ne consomme que les tokens) | index.html |
| `assets/pinlane-analytics-board.css` | tableau d'analyse customisable `window.PinlaneAnalyticsBoard` (classes `pab-`, widgets iOS-style) | index.html |
| `assets/pinlane-client.css` | entrée plateforme à la racine + parcours résa client (tunnel de réservation dans index.html) + direction.html | index.html, direction.html |
| `assets/pinlane-landing.css` | landing marketing (reconstruite sur les tokens) | pro.html |

Règles : zéro `!important` sauf `prefers-reduced-motion` et override d'un `style=""` inline historique (commenter la raison) · zéro couleur en dur hors définition des tokens · un composant nouveau se crée dans `pinlane.css`, jamais dans une couche page.

## 9. Product Rule (inchangée)

Le moteur déterministe fait foi. Aucun composant ne doit donner l'illusion d'une action (dispo, prix, confirmation) que le backend ne fournit pas. Un bouton déclenche une action réelle, navigue vers une page réelle, ouvre un menu réel, ou il est supprimé.

## 10. Vivant, jamais gadget (2026-09-25)

Movsar, devant l'interface d'Accountable : « plus vivant, plus pro, avec que des choses vraiment réelles ». Puis, devant une première version qui posait une quille de dessin animé sur l'accueil : « faut faire bcp plus pro pas gadget gamin, c'est du B2B avec des Sébastien 45 ans ». Le public est un gérant de centre, pas un joueur : la console reste un outil de précision, et la vie vient de ce qui est vrai.

- **Pas de mascotte, pas de personnage, pas d'illustration décorative** dans la console. L'état se lit à la COULEUR d'un badge de statut (rouge, ambre, bleu, vert, neutre), jamais à un dessin qui change d'humeur.
- **Ce qui rend vivant** : un compteur qui monte à l'arrivée, un indicateur « temps réel » qui dit la fraîcheur des données, une entrée de page courte une fois par navigation, une liste qui se vide quand on traite. Rien ne bouge sans qu'un état ait changé.
- **Une phrase vraie avant les chiffres** : un en-tête qui s'adresse à quelqu'un (« Bonjour Camille ») donne ce qui l'attend en comptant la liste qu'il annonce, à la couleur de sa ligne la plus grave. Le prénom ne vient que d'une personne (jamais du nom du centre, d'un rôle ou d'une session de secours). Un compte inconnu (lecture en cours, refusée, en panne) ne se dit jamais « à jour ».
- **La console vouvoie le gérant**, comme les mails, l'agent et la démo : « Posez votre question », « vos concurrents », jamais « ta » ni « tes ». Les faits sur le centre s'écrivent à la troisième personne (« le samedi est le jour le plus fort »), les légendes proposées aux clients suivent la doctrine de marque (vouvoiement par défaut, c'est le parent qui réserve). Pas de jargon de statisticien (« verdicts causaux ») : on dit ce qu'il manque, en jours. Le gate `voix-pro-check` le vérifie.
- **« À faire » réunit, il ne recopie pas** : une seule liste pour ce qui attend (alertes de la journée, mails à répondre, questions de l'agent, envois en échec), triée par gravité, chaque ligne menant à la page où ça se règle. Une donnée qui existe déjà ailleurs n'est pas redessinée : on y renvoie. Une tuile qui ne mesure rien (une constante affichée comme un état) est supprimée.


<!-- Scoped console record, 2026-10-04. Incumbent public tokens and sections retained. -->

## Overview

**Creative North Star: "Precision Tooling"**

Addendum staff/admin, enregistré depuis le bloc « Console 2026-10-03 » de `assets/pinlane-staff.css` et les composants de `assets/app-main.js` et `assets/staff-pages-v2.js`. Le brief SaaS est en mode Operate. La console livrée utilise papier et graphite, faits visibles, compteurs groupés et même finition en clair et sombre.

**Key Characteristics:**

- Neutres mesurés et sélection monochrome.
- Hiérarchie par texte, espace et filets.
- Contrôles homogènes et données réelles.
- Palette publique et tunnel client préservés.

Le frontmatter conserve intégralement les palettes publiques `colors.light` et `colors.dark`. Les clés `console-light-*` / `console-dark-*` sont des overrides supplémentaires, appliqués uniquement sous `body:is(.staff-mode, .admin-mode)`. Cet addendum fait autorité dans ce scope quand une description plus ancienne de la console le contredit.

## Colors

### Primary

L'action et la sélection console utilisent `console-*-console-selected` et `console-*-console-selected-text`. Le bleu mesuré (`console-*-accent`, `console-*-console-focus`) guide les liens et le focus ; les couleurs sémantiques du planning et des statuts restent fonctionnelles.

### Neutral

Les rôles page, surface, raised et subtle donnent les niveaux de structure. Les rôles line et line-strong sont les filets, control-border distingue les contrôles. Text, muted et faint structurent la lecture. Le fond de champ est console-input ; l'activité sélectionnée utilise console-selected-surface.

**The Scoped Palette Rule.** Les overrides staff/admin ne réassignent aucun jeton du tunnel public.

**The Selection Contrast Rule.** La sélection se lit par contraste plein et libellé, dans les deux thèmes.

## Typography

Geist demeure la police UI ; Geist Mono reste la police de données de la base. Le compteur livré est en police UI avec chiffres tabulaires : ne pas déclarer que tous les nombres sont déjà en chasse fixe.

- Titre de dossier : rôle console-title desktop, console-title-mobile sous 760px.
- Sections d'édition : console-section ; libellés 12px/500.
- Champs et boutons : texte dense 13px ; action à 600, champ sans renforcement artificiel.
- Faits du header : valeur 14px/600, interligne 1.4 ; libellé et complément 12px.
- Statut : 12px/600, casse naturelle, sans chasse décorative.

**The Functional Label Rule.** Le label nomme une donnée ou une action. Le titre de section livré remplace l'ancien kicker décoratif ; ce dernier n'est pas un rôle à transmettre.

## Layout

Le dossier a un maximum de 960px et un retrait viewport de 32px, padding horizontal 28px et vertical 24px. Le header expose identité et statut, puis Date, Horaires, Ressources et Groupe quand ces faits existent, avant les onglets. L'édition et les activités utilisent deux colonnes lorsque la place le permet. Les sections internes partagent la surface du dossier ; des filets séparent les groupes.

Sous 760px, retrait viewport 16px, padding horizontal 16px et vertical 20px, titre mobile et sections/activités à une colonne. Les faits gardent deux colonnes et les options se replient sans tronquer le label. Le calendrier mobile garde des cellules de 68px minimum : nombre et unité sur deux lignes, métadonnées secondaires masquées.

Le rythme partagé de 4px est conservé. Les valeurs locales 6/10/14/28px décrivent la composition livrée ; elles n'inventent pas une nouvelle échelle globale. Les règles publiques de layout et de motion restent celles du document incumbent.

## Elevation & Depth

Cartes posées plates, hiérarchie par fond et filets. Le dossier est la surface élevée : `--shadow-overlay` utilise une ombre adaptée au thème, enregistrée dans le sidecar. Le scrim demeure, le filtre de verre des overlays concernés est neutralisé, ainsi que reflets et translations de survol du cockpit concerné.

**The Flat Resting Surface Rule.** La profondeur distingue une surface flottante. Une carte posée ne gagne pas de glow ou de reflet au hover.

Les contrôles livrés ont des transitions de 150ms ease sur couleur, fond et bordure ; reduced-motion les supprime pour les sélecteurs ciblés. L'entrée de fiche se joue à l'ouverture, pas à chaque poll ou compteur. Le parcours public conserve sa motion liquide existante.

## Shapes

Angles de console : md pour boutons, champs, compteurs et options ; lg pour panneaux et activités ; console-overlay pour le dossier desktop, lg pour son mode mobile ; sm pour le statut et petits segments. Les valeurs se trouvent dans le frontmatter. Les filets sont d'un pixel. Les sections du dossier sont ouvertes ; le contour d'une activité garde sa fonction de choix et de compteur.

## Components

### Buttons

Actions monochromes, secondaires sur surface avec control-border. Minimum 40px desktop pour les contrôles généraux, 44px mobile ; sauvegarde de dossier et fermeture à 44px dès le desktop. Hover secondaire sur subtle, primaire à .9 d'opacité ; pas d'image de fond ou d'ombre décorative. Focus : outline 2px, offset 3px, couleur console-focus. Danger et avertissement gardent leur rôle fonctionnel.

### Inputs / Fields

Fond console-input, bordure control-border, angle md, texte 13px, placeholder opaque, label visible 12px dans l'édition. Champs généraux 40px desktop puis 44px mobile ; champs de la fiche 44px dès le desktop. Pas d'ombre.

### Cards / Containers

Panneaux console à angle lg. Sections ouvertes dans le dossier, notes et retards nommés sans bandes latérales décoratives. Panneau d'activité : padding 14px, gap 12px, frontière renforcée et fond calme quand sélectionné.

### Options

Options bowling, arcade et formule : hauteur 44px minimum, angle md, padding 8px 10px, label explicite et complément à 12px. Les listes se replient avec écart 6px. La sélection suit le même contraste plein que l'action principale ; les pistes gardent une cible 44px et montrent une disponibilité réelle.

### Compteur groupé

Moins, valeur et plus dans un seul groupe de 46px, angle md. Colonnes 44px / minmax(48px, 1fr) / 44px ; boutons internes de 44px, auxquels s'ajoutent les deux bordures du groupe. Valeur de hauteur minimale 44px, à 14px/600 en chiffres tabulaires, unité 12px. Les bornes réelles désactivent le geste concerné ; les boutons ont un label accessible. Le focus du groupe montre la relation. Même composant en création et édition.

### Navigation et dossier

Navigation active sur subtle, texte et marqueur monochromes. Infos/Modifier ont des cibles de 44px ; l'actif est renforcé avec un filet 2px, sans capsule. Identité et statut précèdent les faits. La fermeture utilise un SVG explicite et une cible 44px.

## Do's and Don'ts

### Do:

- **Do** préserver la Scoped Palette Rule et offrir la même hiérarchie en clair et sombre.
- **Do** afficher les faits avant le détail et garder le compteur proche du choix modifié.
- **Do** garder labels, limites réelles, focus visible et reduced-motion.
- **Do** conserver le moteur comme source d'état et les contraintes produit confirmées du document incumbent.

### Don't:

- **Don't** ajouter dégradé décoratif, glow, verre ou reflet dans la console concernée.
- **Don't** reprendre kicker, bande décorative ou boîte imbriquée comme nouvelle règle de surface.
- **Don't** propager la couche SaaS au formulaire public.

**Contradictions incumbent laissées hors scope :** les sections anciennes affirment encore une suppression totale des couches CSS, une source de couleur exclusivement centrale et des tokens de console noirs purs. Le code de cette branche contient des couches historiques et le bloc final scoped ; cet addendum documente la console effective sans migrer le système public ni réparer toute la documentation globale. Le sidecar est créé : aucun `.impeccable/design.json` n'existait dans ce checkout.

**Not canonized:** avertissements legacy du chantier, glyphes ou kickers résiduels hors du lot relu et effets historiques neutralisés ; ce sont des dettes ou vestiges, pas des tokens à hériter. Les 13px de texte dense, 20px de titre mobile et angles 8/12/16px sont des valeurs cohérentes et délibérément livrées.

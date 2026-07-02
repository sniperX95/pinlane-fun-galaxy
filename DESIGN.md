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
    muted: "#666666"
    faint: "#8f8f8f"
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
    faint: "#7d7d7d"
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
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
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
---

# Design System v2 : Pinlane Platform

## 0. Statut

Ce document **remplace intégralement** l'ancien système « The Operating Console » (fond #050609, accent platine #b8ad9b, Inter). Toute trace de l'ancien système (tokens `--v2-*`, `--pl-*`, `--pf-*`, `--pp-*`, couches CSS empilées) est obsolète et supprimée. Le CSS vit dans un ensemble consolidé unique (voir §8).

## 1. North Star : « Precision Tooling »

Pinlane est un outil de précision, dans le langage visuel de Vercel : surfaces neutres calibrées, bordures 1px, un seul accent bleu, typographie Geist, densité maîtrisée. Rien ne brille, rien ne flotte : la hiérarchie vient du contraste typographique, de l'espacement et des bordures — pas des ombres ni des dégradés.

Interdits permanents : dégradés violet/indigo, glassmorphism, glow néon, ombres portées molles « AI look », fonds quasi-noirs teintés, accent platine/champagne.

Deux univers, un même langage :

- **Console staff/admin** : dense, scannable, monochrome + bleu. L'opérateur lit un état en 2 secondes.
- **Client (tenant)** : mêmes composants, plus d'air (spacing ×1.5), titres plus grands, orienté réassurance et conversion.

## 2. Thèmes light / dark

- Attribut `data-theme="light" | "dark"` sur `<html>`. Défaut : `prefers-color-scheme`, persisté en `localStorage('pinlane-theme')`, togglable dans la navigation.
- Chaque token existe dans les deux thèmes (frontmatter ci-dessus). Le CSS ne référence **que** les variables — jamais une couleur en dur.
- Light = thème de référence (console de jour, impression). Dark = pur Vercel : page #000, surfaces #0a0a0a/#111, bordures #262626.

## 3. Couleur

- **Neutres** : 90 % de l'UI. Page, surface, subtle, line — c'est la structure.
- **Accent bleu** (`--accent`) : actions primaires, liens, états actifs de navigation, focus. Un seul accent, jamais deux couleurs vives côte à côte.
- **Statuts** (fonctionnels uniquement, jamais décoratifs) : badge = fond `-soft` + texte couleur pleine + pas de bordure. Vert = payée/active/réussie · Ambre = arrivée/attention · Bleu = confirmée · Rouge = échec/bloquée/annulée. Contraste texte/fond ≥ 4.5:1 dans les deux thèmes.
- **Tenant** : `--tenant-accent` (défaut = `--accent`). Le branding Fun Galaxy n'existe plus que par son logo ; magenta #b356ad et teal #5ec8c8 sont retirés de l'UI.

## 4. Typographie

- **Geist** (UI) et **Geist Mono** (data) — self-hostées, WOFF2 variables, `assets/fonts/`, `font-display: swap`, preload sur les 2 fichiers latin. ~84 KB au total. Inter et IBM Plex Mono ne sont plus chargées.
- Tout ce qui est **donnée** passe en Geist Mono avec `font-variant-numeric: tabular-nums` : heures, prix, capacités, compteurs, IDs, numéros de piste.
- Échelle (UI) : 12 (label/meta) · 13 (dense/table) · 14 (body) · 16 (section) · 20 (page title console) · 24-32 (titres client) · 40-56 (landing). Titres : weight 600, letter-spacing -0.02em. Jamais de texte < 12px, jamais d'UPPERCASE avec letter-spacing > 0.05em (l'ancien style « label espacé » disparaît).

## 5. Forme, profondeur, motion

- **Radius** : 6 (boutons, inputs, badges) · 8 (cellules planning, menus) · 12 (cartes, modales) · full (pills, avatars).
- **Profondeur** : bordure 1px d'abord. Ombres réservées aux surfaces flottantes (menus, modales, palette) : `shadows.overlay`. Aucune ombre sur les cartes posées.
- **Motion** : 120-200ms, `cubic-bezier(0.25, 0.1, 0.25, 1)`, `transform`/`opacity` uniquement. Hover = changement de fond/bordure, pas de translation. Entrées de page : fade 8px une fois par navigation, jamais sur le poll 1,2s. `prefers-reduced-motion` : tout à 0.01ms.

## 6. Composants de base

- **Bouton primaire** : fond `text`, texte `surface` (noir sur blanc en light, blanc sur noir en dark — signature Vercel). Hover : opacité fond 0.9. H 40px (32px en contexte dense), radius 6, weight 500.
- **Bouton secondaire** : fond `surface`, bordure `line-strong`, texte `text`. Hover : fond `subtle`.
- **Bouton danger** : fond `danger`, texte blanc. Ghost : texte `muted`, hover fond `subtle`.
- **Inputs** : fond `surface`, bordure `line-strong`, radius 6, H 40px, label visible 13px/500 au-dessus. Focus : bordure `accent` + ring 3px `accent-soft`. Erreur : bordure `danger` + message 12px sous le champ, `role="alert"`.
- **Cartes** : fond `surface`, bordure 1px `line`, radius 12, padding 20. Titre 16/600 + meta 12 `muted`.
- **Tables/listes** : header 12px/500 `muted`, lignes 13-14px séparées par `line`, hover `subtle`, colonnes numériques en Geist Mono alignées à droite.
- **Badges statut** : pill (radius full), 12px/500, padding 2px 10px, fond `-soft` + texte statut. Point 6px optionnel devant.
- **Navigation staff** : sidebar fond `surface`, bordure droite `line` ; item actif = fond `subtle` + texte `text` + barre 2px `accent` à gauche ; inactif = `muted`. Top bar 56px.
- **Planning** : grille bordures `line` ; créneau libre = `surface` ; réservé = fond `accent-soft` + bordure gauche 2px `accent` ; states via couleurs statut. Heures en Geist Mono.
- **Empty states** : icône trait 1.5px `faint`, titre 14/500, texte 13 `muted`, action secondaire.
- **Focus (tout élément interactif)** : `outline: 2px solid var(--accent); outline-offset: 2px`. Cibles tactiles ≥ 44px (mobile) / ≥ 32px + spacing (desktop dense).

## 7. Accessibilité (non négociable)

Contraste ≥ 4.5:1 (texte) et 3:1 (UI) dans les **deux** thèmes · focus visible partout · cibles ≥ 44px mobile · `prefers-reduced-motion` respecté · formulaires labellisés · pas d'info portée par la couleur seule (les statuts ont toujours un libellé).

## 8. Architecture CSS

4 fichiers, ordre de chargement fixe, aucune autre feuille autorisée :

| Fichier | Rôle | Pages |
|---|---|---|
| `assets/pinlane.css` | @font-face, tokens light/dark, reset, base, composants (§6) | toutes |
| `assets/pinlane-staff.css` | console staff + admin (sidebar, dashboard, planning, pages pv2, groupes) | index.html |
| `assets/pinlane-client.css` | parcours résa client + public-form + direction.html | index.html, public-form.html, direction.html |
| `assets/pinlane-landing.css` | landing marketing (reconstruite sur les tokens) | pro.html |

Règles : zéro `!important` sauf `prefers-reduced-motion` et override d'un `style=""` inline historique (commenter la raison) · zéro couleur en dur hors définition des tokens · un composant nouveau se crée dans `pinlane.css`, jamais dans une couche page.

## 9. Product Rule (inchangée)

Le moteur déterministe fait foi. Aucun composant ne doit donner l'illusion d'une action (dispo, prix, confirmation) que le backend ne fournit pas. Un bouton déclenche une action réelle, navigue vers une page réelle, ouvre un menu réel — ou il est supprimé.

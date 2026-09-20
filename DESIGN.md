---
name: "Pinlane Platform"
description: "Precision Tooling for the platform; a photographic booking world for the Fun Galaxy tenant."
colors:
  page-light: "#fafafa"
  surface-light: "#ffffff"
  subtle-light: "#f2f2f2"
  line-light: "#ebebeb"
  text-light: "#0a0a0a"
  muted-light: "#5e5e5e"
  accent-light: "#0070f3"
  page-dark: "#000000"
  surface-dark: "#0a0a0a"
  raised-dark: "#111111"
  line-dark: "#262626"
  text-dark: "#ededed"
  muted-dark: "#a1a1a1"
  accent-dark: "#3291ff"
  success: "#0f7b3c"
  warning: "#a35200"
  danger: "#cb2a2f"
  fg-page: "#050505"
  fg-surface: "#0c0c0e"
  fg-text: "#f7f4f2"
  fg-muted: "#918d96"
  fg-line: "#29272d"
  fg-magenta: "#b644b4"
  fg-magenta-hover: "#cf58ca"
  fg-cyan-edge: "#62c5ba"
typography:
  display:
    fontFamily: "FGDisplay, Impact, sans-serif"
    fontSize: "clamp(45px, 5vw, 96px)"
    fontWeight: 400
    lineHeight: 0.86
    letterSpacing: "0.01em"
  body:
    fontFamily: "FGSans, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.55
  platform-title:
    fontFamily: "Geist, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  data:
    fontFamily: "'Geist Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "FGSans, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.12em"
rounded:
  fg-sharp: "2px"
  fg-action: "3px"
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
components:
  fg-button-primary:
    backgroundColor: "{colors.fg-magenta}"
    textColor: "#ffffff"
    rounded: "{rounded.fg-action}"
    height: "50px"
    padding: "0 24px"
  fg-button-disabled:
    backgroundColor: "#181619"
    textColor: "#77727a"
    rounded: "{rounded.fg-action}"
    height: "50px"
  fg-input:
    backgroundColor: "#080809"
    textColor: "#ffffff"
    rounded: "{rounded.fg-sharp}"
    height: "48px"
    padding: "0 12px"
  platform-button-primary:
    backgroundColor: "{colors.text-light}"
    textColor: "{colors.surface-light}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 14px"
  platform-card:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: Pinlane Platform

## Overview

**Creative North Star: “Precision Tooling”**

Pinlane reste le système global : une interface de production calme, exacte et neutre, inspirée par Vercel. Geist, les filets de 1 px, les surfaces sobres et un seul accent bleu structurent les consoles staff, admin et l’entrée plateforme. Les états opérationnels restent fonctionnels et le moteur déterministe fait foi.

### Frontière tenant — Fun Galaxy

Le monde **Fun Galaxy Booking** est une exception client strictement bornée au tunnel public activé par `?center=libramont&theme=fun-galaxy` et par l’attribut `data-fun-galaxy-v2`. Il ne remplace ni les tokens, ni les composants, ni l’identité Pinlane ailleurs. Sa North Star est **“Cinematic Venue Booking”** : noir photographique, vraies images du centre, grands titres Anton, actions magenta et un filet cyan de précision.

Le tunnel pose une seule décision évidente par écran : date et groupe, activités, horaire, contact, récapitulatif. Le contenu utile domine le premier viewport ; navigation et contexte restent secondaires. Cette exception vit dans `assets/fungalaxy-client-v2.css` et ne doit pas fuir vers les surfaces plateforme.

**Key Characteristics:**

- Pinlane global : neutres, Geist, bleu fonctionnel, densité maîtrisée.
- Fun Galaxy uniquement : noir profond, photographie réelle, Anton + Montserrat, magenta rare et cyan limité au filet d’état.
- Hiérarchie par échelle, espace, contraste et règles de 1 px ; pas par empilement décoratif.
- États affichés fidèles au moteur : aucun créneau, prix, total ou CTA ne simule une disponibilité.

## Colors

La plateforme utilise ses neutres light/dark et son bleu fonctionnel. Le tunnel Fun Galaxy remplace localement cette palette par un noir photographique chaud et un accent magenta.

### Pinlane global

- **Page / Surface light** (`#fafafa` / `#ffffff`) : canevas des consoles de jour et de l’entrée plateforme.
- **Page / Surface dark** (`#000000` / `#0a0a0a`) : canevas sombre neutre, sans teinte violette.
- **Pinlane Blue** (`#0070f3` light, `#3291ff` dark) : action primaire, lien, navigation active et focus.
- **Statuts** : vert réussite, ambre attention, rouge échec ; toujours accompagnés d’un libellé.

### Fun Galaxy tenant

- **Photographic Black** (`#050505`) : page et espace négatif autour des scènes.
- **Venue Surface** (`#0c0c0e`) : surface technique plate, rarement distinguée du fond.
- **Warm White** (`#f7f4f2`) : titres, valeurs et actions secondaires importantes.
- **Venue Muted** (`#918d96`) : métadonnées et texte d’aide.
- **Fun Galaxy Magenta** (`#b644b4`) : CTA, sélection, étape active et mot clé du titre Contact. Le hover livré est `#cf58ca`.
- **Registration Cyan** (`#62c5ba`) : uniquement un filet de 1 px autour d’une action ou sélection active ; jamais une deuxième masse colorée.
- **Venue Line** (`#29272d`) : séparation des champs, créneaux et listes.

### Named Rules

**The Tenant Boundary Rule.** Les couleurs `fg-*` ne s’appliquent que sous `html[data-fun-galaxy-v2] body.client-mode #clientView`.

**The One Loud Color Rule.** Le magenta porte l’action ou le choix courant. Le cyan reste un trait de registre de 1 px ; les deux ne deviennent jamais deux aplats concurrents.

## Typography

**Platform UI Font:** Geist, avec fallbacks système.

**Platform Data Font:** Geist Mono, chiffres tabulaires.

**Fun Galaxy Display Font:** FGDisplay, police Anton auto-hébergée, fallback Impact.

**Fun Galaxy Body Font:** FGSans, police Montserrat auto-hébergée en 600 et 700, fallback Arial.

La plateforme est rationnelle et compacte. Le tenant Fun Galaxy oppose une voix d’affiche très condensée à une UI robuste et familière.

### Hierarchy

- **Fun Galaxy Display** (400, `clamp(45px, 5vw, 96px)`, line-height `0.86–0.92`) : une question dominante en capitales par écran. Les tailles mobiles observées se resserrent à `43–50px`.
- **Platform Title** (600, `24px`, line-height `1.2`) : titre de page de console.
- **Body** (600, `14px`, line-height `1.55`) : instructions, valeurs et libellés courants du tunnel.
- **Data** (400, `14px`, tabular nums) : heures, prix, capacités, IDs et données opérationnelles Pinlane.
- **Fun Galaxy Label** (700, `10px`, `0.10–0.12em`, uppercase) : labels de champ et métadonnées brèves. Aucun paragraphe n’adopte ce traitement.

### Named Rules

**The Question Is the Hero Rule.** Dans le tunnel, Anton formule la décision présente, pas une accroche marketing secondaire. Une seule question domine chaque écran.

## Layout

Pinlane global conserve sa grille de production, ses conteneurs neutres et son rythme de 4 px. La console est dense ; les parcours client disposent d’environ 1,5× plus d’air.

Le tunnel Fun Galaxy utilise un conteneur de `1280px` maximum avec gutters fluides `clamp(18px, 3vw, 42px)`. Sur desktop, le premier écran et Contact sont des splits photographie/contenu ; le récapitulatif utilise un split photo `48%` / données `52%`. Activités emploie une grille de quatre choix ; Horaire une grille de quatre créneaux. Les photos sont de vrais assets du centre, cadrés en plans larges et parfois découpés en diagonale.

Sous `900px`, les grilles de choix se réduisent. À `640px` et moins, le tunnel devient une colonne : la progression desktop disparaît, le CTA prend toute la largeur, la photographie devient un bandeau ou un bloc pleine largeur, et le contenu reste sans scroll interne. Les titres restent grands mais plafonnent autour de `43–50px`.

## Elevation & Depth

Le système est plat par défaut. Pinlane utilise d’abord les bordures ; seules les surfaces réellement flottantes reçoivent une ombre. Fun Galaxy supprime les ombres de carte et construit la profondeur avec les photographies, les aplats noirs, les filets et les découpes. L’unique “glow” autorisé dans le tunnel est en réalité un `box-shadow: 0 0 0 1px` cyan ou magenta : un second filet net, pas une lumière diffuse.

### Named Rules

**The Photographic Depth Rule.** Dans Fun Galaxy, la profondeur vient d’un plan photo réel derrière ou à côté de la décision, jamais d’une carte vitrée, d’un dégradé ou d’une ombre molle.

## Shapes

Pinlane global conserve les rayons `6 / 8 / 12px` et les pills fonctionnelles. Fun Galaxy est plus tranchant : champs et créneaux `2px`, CTA et tuiles d’activité `3px`, séparateurs de `1px`. Les cercles sont réservés aux icônes, contrôles de sélection et étapes de progression. Les découpes diagonales appartiennent aux photographies de transition, pas aux conteneurs de formulaire.

## Components

### Progression Fun Galaxy

- Logo du centre à gauche et rail horizontal discret sur desktop.
- Étape active en magenta avec filet cyan ; étapes terminées identifiables, labels secondaires atténués.
- Sur mobile, la progression complète cède la place au logo, au libellé d’étape et à une ligne simple.

### Buttons

- **Fun Galaxy Primary:** hauteur minimale `50px`, magenta `#b644b4`, texte blanc uppercase 12/700, rayon `3px`, filet cyan 1 px.
- **Hover:** magenta `#cf58ca`, déplacement net de `-1px / -1px`, sans ombre diffuse.
- **Disabled:** fond `#181619`, texte `#77727a`, curseur interdit ; il doit expliquer ou suivre la sélection manquante.
- **Secondary:** transparent, texte blanc, bord `#48454e`, rayon `2px`.
- **Pinlane Primary:** hauteur `40px`, contraste noir/blanc selon le thème, rayon `6px`.

### Activity Choices

- Grille de quatre colonnes desktop, deux sous `900px`.
- Chaque choix est une rangée plate : icône ronde 34px, nom, prix ou mode de règlement, contrôle circulaire.
- État sélectionné : bord magenta, fond sombre `#1a0b19`, filet cyan 1 px. Le CTA reste disabled tant que la sélection n’est pas vraie.

### Time Slots

- Créneaux en grille de quatre, hauteur minimale `58px`, fond `#0b0b0d`, bord `#4a4650`.
- L’état actif utilise fond `#231122`, bord magenta et filet cyan.
- Une consigne textuelle accompagne l’absence de sélection ; la couleur seule ne porte pas l’état.

### Inputs / Fields

- Fond `#080809`, bord `#3b3840`, rayon `2px`, texte blanc.
- Label uppercase 10px au-dessus ; placeholders atténués.
- Focus : bord et filet magenta 1 px. Contact empile les trois champs sur desktop dans la colonne de gauche ; la photo et le contexte de réservation occupent la droite.

### Contact Split

- Titre deux lignes “À QUI / RÉSERVE-T-ON ?”, deuxième ligne magenta.
- Formulaire à gauche, photographie bowling pleine hauteur à droite, petit contexte de réservation superposé en surface noire semi-opaque bordée.
- Les informations optionnelles sont retirées du premier viewport desktop ; l’action “Voir le récapitulatif” reste au bord de la décision.

### Recap Split

- Photo Duckpin à gauche, données de réservation à droite, sans carte englobante.
- Informations structurées par lignes horizontales ; total estimé séparé par un filet.
- CTA “Confirmer la réservation” magenta uniquement quand les données sont complètes. Les valeurs présentées proviennent de l’état réel du moteur.

## Do's and Don'ts

### Do:

- **Do** garder l’exception Fun Galaxy strictement sous `data-fun-galaxy-v2` et laisser le reste de Pinlane sur Precision Tooling.
- **Do** faire de la question courante le plus grand élément de l’écran.
- **Do** utiliser une photographie réelle du lieu comme plan de composition, avec un cadrage intentionnel.
- **Do** montrer explicitement sélection, horaire, total et état du CTA ; les données réelles priment sur la composition.
- **Do** empiler proprement sur mobile, sans scroll interne ni texte illisible.

### Don't:

- **Don't** appliquer Anton, le magenta ou les photos Fun Galaxy aux consoles staff/admin ou à l’entrée Pinlane.
- **Don't** utiliser de dégradé, glassmorphism, halo néon, carte dans une carte ou ombre décorative.
- **Don't** transformer chaque option en grande carte marketing ; les choix restent des rangées compactes et comparables.
- **Don't** ajouter du texte explicatif quand l’état, le libellé et l’action suffisent.
- **Don't** afficher une sélection, une disponibilité, un prix ou une confirmation que le moteur n’a pas fournis.

### Not canonized

Le build contient encore quelques sélecteurs de finition dupliqués et des `!important` de compatibilité locale. Ils ne sont pas une règle de système et ne doivent pas être copiés sur de nouvelles surfaces.

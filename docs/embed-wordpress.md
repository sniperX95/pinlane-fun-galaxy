# Installer le formulaire Pinlane sur un site WordPress

Document destiné à la personne qui gère le site (agence ou webmaster).
Durée : cinq minutes. Aucun plugin à installer, aucun thème à modifier.

## Le principe, en une phrase

**On ne supprime jamais le formulaire existant.** On le laisse dans la page et
on ajoute un script à côté. Le script masque l'ancien formulaire et affiche le
parcours Pinlane à sa place. Un interrupteur, côté Pinlane, rend l'ancien
formulaire en un clic, sans toucher au site ni redemander l'accès à WordPress.

C'est ce qui rend la mise en ligne réversible : le retour en arrière ne demande
personne.

## Les trois étapes

### 1. Repérer l'identifiant du formulaire actuel

Sur la page qui contient le formulaire (par exemple `/contact/`), afficher le
code source de la page dans le navigateur et repérer l'élément qui enveloppe le
formulaire. Avec Gravity Forms, c'est un identifiant de la forme
`gform_wrapper_1`, où `1` est le numéro du formulaire.

Ce qu'il faut noter, c'est le **sélecteur CSS** : `#gform_wrapper_1`.

> Si le formulaire vient d'un autre outil (Contact Form 7, WPForms, Elementor),
> le principe est le même : n'importe quel identifiant ou classe qui entoure le
> formulaire convient, par exemple `.wpcf7` ou `#mon-bloc-reservation`.

### 2. Coller le script juste après le formulaire

Dans l'éditeur WordPress, sur la même page, ajouter un bloc **HTML personnalisé**
immédiatement après le bloc du formulaire, et y coller ceci :

```html
<script src="https://app.pinlane.be/embed.js"
        data-center="libramont"
        data-fallback="#gform_wrapper_4"></script>
```

Deux attributs suffisent dans le cas simple. Les trois autres servent aux sites
qui ne se laissent pas faire :

| Attribut | À quoi il sert |
|---|---|
| `data-center` | Le centre concerné : `libramont`, `gembloux`, `ciney`. C'est lui qui décide des horaires, des formules et des tarifs affichés. |
| `data-fallback` | Le sélecteur relevé à l'étape 1. C'est l'ancien formulaire : il **reste dans la page**, masqué, et il sera rendu si on coupe. Le masquage résiste aux scripts du site : Gravity Forms, par exemple, réaffiche son propre formulaire quand il initialise sa logique conditionnelle, donc après nous. |
| `data-target` | Facultatif, et seulement si le script ne peut pas être collé à l'endroit voulu. Le sélecteur du bloc **dans lequel** afficher le parcours. Sans lui, le parcours s'affiche là où le script est collé. Il vise en général le parent de ce que masque `data-fallback`, pour que le parcours prenne exactement sa place. |
| `data-center-key` | Sur un site **multi-centres qui affiche le même bloc à tout le monde**, la clé que le site utilise déjà pour retenir le centre choisi par le visiteur (stockage local, puis cookie). Le parcours suit ce choix, et `data-center` sert de défaut quand rien n'a été choisi. Sans cet attribut, un visiteur de Gembloux se verrait proposer le planning de Libramont : mauvais horaires, mauvais tarifs, et personne ne s'en apercevrait avant une réservation impossible à honorer. **À ne pas mettre** quand le site sert déjà un bloc différent par centre : sa décision à lui fait foi. |
| `data-scroll-margin` | Facultatif. Hauteur en pixels de l'en-tête collé du site (80 par défaut), pour que la barre du parcours ne passe pas dessous. |

### 2 bis. Si aucun bloc HTML n'est possible à cet endroit

Beaucoup de thèmes sur mesure construisent la section de réservation eux-mêmes :
il n'y a alors **aucun champ libre** à cet endroit, et un compte éditeur ne peut
ni installer d'extension ni toucher au thème. Deux issues, dans cet ordre.

**a. Un champ HTML dans le formulaire lui-même.** Gravity Forms, Contact Form 7
et WPForms ont tous un champ « HTML » qui affiche du code brut à l'intérieur du
formulaire. On y colle le script, et on ajoute `data-target` pour que le
parcours s'affiche dans le bloc qui contient le formulaire plutôt que dans le
formulaire :

```html
<script src="https://app.pinlane.be/embed.js"
        data-center="libramont"
        data-target=".booking .container"
        data-fallback=".booking__container"></script>
```

**Viser large avec `data-fallback`.** Le réflexe est de masquer le formulaire
lui-même ; il vaut mieux masquer le **bloc entier** qui le contient, illustration
et décor compris. Deux raisons. La première est visuelle : sinon le parcours
s'affiche à l'intérieur du cadre décoré du site, avec son titre et son image
autour, au lieu de le remplacer. La seconde est solide : masquer un **ancêtre**
bat toute tentative du site de réafficher son formulaire, quel que soit le
script qui la fait et quand.

C'est souvent la **meilleure** solution, et pas seulement un pis-aller : le
script suit le formulaire sur **toutes** les pages où le site l'affiche, sans
qu'on ait à les retrouver une par une.

**Mais viser large n'est utile que si le bloc contient autre chose.** Relevé sur
le site du premier client (2026-09-08) : le conteneur du formulaire ne portait
QUE le formulaire, et le décor (illustration, titre) vivait dans un bloc voisin.
Masquer l'ancêtre aurait emporté le décor pour rien. Regarder la structure avant
de choisir :

```
section
  conteneur
    contenu      (illustration + titre)   <- à GARDER
    formulaire   (le wrapper, et rien d'autre)   <- à masquer
```

Le `data-fallback` vise alors le wrapper seul, et le `data-target` son parent :
le parcours prend exactement la place du formulaire, dans la mise en page du
site. L'argument du « viser large » (battre un script du site qui réaffiche son
formulaire) ne s'applique pas ici : la règle `!important` d'une feuille de style
l'emporte déjà sur le `style="display:block"` en ligne que pose ce genre de
script.

Si le site sert un formulaire **différent selon le centre**, chaque formulaire
reçoit le champ avec **son** `data-center`. C'est le serveur du site qui a déjà
tranché le centre en choisissant le formulaire : le suivre est plus sûr que
relire soi-même la sélection du visiteur.

**b. Le champ « Contenu » de la page.** Il fonctionne, mais le thème l'enveloppe
souvent dans une section à lui : on récupère une bande vide au milieu de la page.
À n'utiliser que si a. est impossible.

### 3. Publier, puis vérifier trois choses

1. La page affiche le parcours Pinlane, et **une seule fois** : l'ancien
   formulaire ne doit plus être visible.
2. Le cadre grandit et rétrécit selon l'étape, **sans ascenseur intérieur**.
3. Une réservation d'essai arrive bien dans Pinlane.

## Ce que le script fait, et ce qu'il ne fait pas

Il **fait** : afficher le parcours à l'endroit exact où le script est collé,
ajuster la hauteur à chaque étape, remonter le haut du cadre en vue quand
l'étape change, et envoyer un événement de mesure à chaque réservation prise
(`pinlane_booking` dans le `dataLayer`, plus un `CustomEvent` DOM). Le détail de
la mesure ne contient aucune donnée personnelle : voir `embed-tracking.md`.

Il **ne fait pas** : lire le contenu du site, écrire dans la base WordPress,
charger une bibliothèque tierce, poser un cookie sur le domaine du site. Le
fichier est servi tel quel, sans dépendance.

## Le retour en arrière

Depuis Pinlane, fiche du centre, section « Formulaire sur le site du client » :
un bouton rend l'ancien formulaire. L'effet est immédiat pour les nouveaux
visiteurs (au plus une minute, le temps du cache), et il n'y a **rien à faire
sur WordPress**.

Deux garanties qui comptent le jour où on s'en sert :

- l'ancien formulaire n'a jamais quitté la page, il était seulement masqué ;
- une panne de notre côté **ne déclenche pas** le retour en arrière. Basculer est
  une décision, pas un accident réseau : sans cette règle, le site changerait de
  formulaire au gré de la qualité du réseau, sans que personne ne l'ait voulu.

## Si le site est protégé par un pare-feu ou un CSP

Le parcours s'affiche dans une iframe servie par `https://app.pinlane.be`. Si le
site déclare une politique de sécurité de contenu, il faut y autoriser :

```
frame-src https://app.pinlane.be;
script-src https://app.pinlane.be;
connect-src https://app.pinlane.be;
```

Côté Pinlane, le domaine du site doit être déclaré dans les origines autorisées
(variable `EMBED_ORIGINS`). Nous le faisons de notre côté avant la mise en ligne.

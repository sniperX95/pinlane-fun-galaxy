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
        data-center-key="guest_selection"
        data-fallback=".booking__form"></script>
```

Trois attributs, et un seul est à adapter par site :

| Attribut | À quoi il sert |
|---|---|
| `data-center` | Le centre concerné : `libramont`, `gembloux`, `ciney`. C'est lui qui décide des horaires, des formules et des tarifs affichés. |
| `data-fallback` | Le sélecteur relevé à l'étape 1. C'est l'ancien formulaire, qui reste dans la page et sera rendu si on coupe. Viser le **conteneur** du formulaire, pas le formulaire lui-même : si le site le montre et le cache avec son propre script, il rouvrirait le sien par-dessus le nôtre et le visiteur en verrait deux. |
| `data-center-key` | Sur un site **multi-centres**, la clé que le site utilise déjà pour retenir le centre choisi par le visiteur (stockage local, puis cookie). Le parcours suit ce choix, et `data-center` sert de défaut quand rien n'a été choisi. Sans cet attribut, un visiteur de Gembloux se verrait proposer le planning de Libramont : mauvais horaires, mauvais tarifs, et personne ne s'en apercevrait avant une réservation impossible à honorer. |
| `data-scroll-margin` | Facultatif. Hauteur en pixels de l'en-tête collé du site (80 par défaut), pour que la barre du parcours ne passe pas dessous. |

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

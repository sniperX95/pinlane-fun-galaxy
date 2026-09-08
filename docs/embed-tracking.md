# Mesurer les reservations prises dans le formulaire Pinlane

Le formulaire de reservation s'installe sur le site du centre par une seule ligne :

```html
<script src="https://app.pinlane.be/embed.js" data-center="libramont"></script>
```

Il vit dans un cadre (iframe) sur le domaine `app.pinlane.be`. Les outils de
mesure du site (Google Tag Manager, GA4, Pixel Meta) ne voient pas ce qui se
passe a l'interieur d'un cadre d'une autre origine : c'est une regle des
navigateurs, pas un choix de Pinlane. Pour que le site continue de compter ses
conversions, le cadre lui envoie un evenement a chaque reservation prise.

## Ce que le site recoit, sans rien avoir a configurer

Au moment ou la reservation est enregistree (ecran « C'est note »), `embed.js`
appelle DIRECTEMENT les fonctions que la page hote a deja posees. Aucun
identifiant n'est necessaire : `fbq` et `gtag` portent deja le compte du site.

```js
// Pixel Meta, si le site en a un de charge
fbq('track', 'CompleteRegistration', {
  value: 208, currency: 'EUR', content_name: 'FORMULE 5', status: 'confirmed'
});

// GA4, si gtag est charge
gtag('event', 'purchase', {
  transaction_id: '4812', value: 208, currency: 'EUR',
  items: [{ item_id: 'f5', item_name: 'FORMULE 5', item_category: 'libramont',
            price: 208, quantity: 1 }]
});
```

`purchase` et non un nom maison : seuls les evenements RECOMMANDES par Google
alimentent les rapports d'eux-memes. Un nom invente obligerait le site a le
cocher comme evenement cle dans l'interface GA4, c'est-a-dire exactement le
travail qu'on lui epargne. Les quatre champs exiges par la specification sont
tous la : `currency`, `transaction_id`, `value`, `items`.

`status` est le parametre documente par Meta pour `CompleteRegistration`.

**Le consentement du site est respecte sans qu'on ait a le lire.** Si le
visiteur refuse les cookies, la banniere ne charge ni le Pixel ni gtag, donc les
globales n'existent pas et le `typeof` est faux : rien ne part.

## Deux reglages, si besoin

| Attribut | Effet |
|---|---|
| `data-track="datalayer"` | Coupe l'appel direct. Pour un site qui prefere cabler l'evenement lui-meme dans GTM : sans ce reglage il compterait deux fois. |
| `data-meta-event="Lead"` | Nomme l'evenement Meta quand ce n'est pas `CompleteRegistration`. |

## Le dataLayer, toujours pousse en parallele

En plus des appels directs, `embed.js` pousse dans `window.dataLayer` :

```js
{
  event: 'pinlane_booking',
  pinlane: {
    reservationId: '4812',      // numero du dossier cote Pinlane
    center: 'libramont',        // le data-center de la ligne d'installation
    amount: 208,                // montant total, celui que le centre facturera
    currency: 'EUR',
    pax: 8,                     // nombre de personnes
    date: '2026-09-12',         // jour de la visite
    startTime: '14:00',         // heure de la premiere activite
    type: 'formule',            // formule, visite, bowling ou laser
    formuleId: 'f5',            // identifiant de l'offre (vide hors formule)
    label: 'FORMULE 5',         // nom de l'offre
    status: 'confirmed'         // ou 'received' quand le centre doit relire le dossier
  }
}
```

et distribue un evenement DOM `pinlane:booking` sur `window`, avec le meme objet
dans `event.detail`, pour un site qui n'utilise ni GTM ni gtag.

Aucune donnee personnelle ne sort du cadre : ni nom, ni telephone, ni email.
Rien n'est envoye avant la confirmation (un visiteur qui abandonne ne produit
aucun evenement).

## Si le site veut cabler lui-meme dans GTM

Poser `data-track="datalayer"` sur la ligne d'installation, puis :

1. **Declencheur** : type « Evenement personnalise », nom `pinlane_booking`.
2. **Variables** (type « Variable de couche de donnees ») : `pinlane.amount`,
   `pinlane.currency`, `pinlane.center`, `pinlane.reservationId`,
   `pinlane.label`.
3. **Balises** branchees sur ce declencheur : le Pixel Meta existant et un
   evenement GA4 avec `value` = `{{pinlane.amount}}`.

## Pourquoi pas un conteneur GTM a l'interieur du cadre

Le cadre est un autre domaine : les cookies d'attribution du site (`_ga`,
`_fbp`, `gclid`, `fbclid`) n'y existent pas. Un conteneur charge dedans
compterait chaque reservation comme un visiteur inconnu, et l'attribution des
campagnes serait perdue. L'evenement ci-dessus se produit sur la page du site,
la ou ces cookies vivent : l'attribution reste celle de la visite.

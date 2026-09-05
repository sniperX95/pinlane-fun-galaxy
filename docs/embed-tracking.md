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

## Ce que le site recoit

Au moment ou la reservation est enregistree (ecran « C'est note »), `embed.js`
fait deux choses sur la page du site :

1. il pousse dans `window.dataLayer` :

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

2. il distribue un evenement DOM `pinlane:booking` sur `window`, avec le meme
   objet dans `event.detail`, pour un site qui n'utilise pas GTM.

Aucune donnee personnelle ne sort du cadre : ni nom, ni telephone, ni email.
Rien n'est envoye avant la confirmation (un visiteur qui abandonne ne produit
aucun evenement).

## Dans Google Tag Manager

1. **Variables** (type « Variable de couche de donnees ») : `pinlane.amount`,
   `pinlane.currency`, `pinlane.center`, `pinlane.reservationId`,
   `pinlane.status`, `pinlane.label`.
2. **Declencheur** : type « Evenement personnalise », nom de l'evenement
   `pinlane_booking`.
3. **Balise GA4** : evenement `reservation` (ou `generate_lead`), parametres
   `value` = `{{pinlane.amount}}`, `currency` = `{{pinlane.currency}}`,
   `center` = `{{pinlane.center}}`, declenchee par `pinlane_booking`.
4. **Balise Meta Pixel** (HTML personnalise, comme celle deja en place sur
   l'ancien formulaire), declenchee par `pinlane_booking` :

```html
<script>
  fbq('track', 'CompleteRegistration', {
    value: {{pinlane.amount}},
    currency: '{{pinlane.currency}}',
    content_name: '{{pinlane.label}}'
  });
</script>
```

Le consentement cookies du site s'applique tel quel : l'evenement est pousse
dans le dataLayer dans tous les cas, et ce sont les regles de consentement du
conteneur qui decident si les balises partent.

## Sans Google Tag Manager

```html
<script>
  window.addEventListener('pinlane:booking', function (event) {
    var r = event.detail;
    // gtag('event', 'reservation', { value: r.amount, currency: r.currency });
    // fbq('track', 'CompleteRegistration', { value: r.amount, currency: r.currency });
  });
</script>
```

## Pourquoi pas un conteneur GTM a l'interieur du cadre

Le cadre est un autre domaine : les cookies d'attribution du site (`_ga`,
`_fbp`, `gclid`, `fbclid`) n'y existent pas. Un conteneur charge dedans
compterait chaque reservation comme un visiteur inconnu, et l'attribution des
campagnes serait perdue. L'evenement ci-dessus se produit sur la page du site,
la ou ces cookies vivent : l'attribution reste celle de la visite.

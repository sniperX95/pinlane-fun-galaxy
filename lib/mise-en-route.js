'use strict';

// LA MISE EN ROUTE D UN CENTRE NEUF (2026-11-17, avant-lancement D7).
//
// Apres sa creation, un centre ne dans la console se reglait a la main et sans fil : horaires, activites,
// tarifs, coordonnees, puis le passage a « Ouvert a la reservation ». Rien ne disait ce qui manquait ni ou le
// regler, et un centre passe « ouvert » trop tot restait ferme en ligne (D2) sans que la direction sache
// pourquoi. La mise en route lit ce qui est fait dans la config du centre, avec les MEMES regles que le
// serveur applique au formulaire (lib/centre-publie.js), et donne pour chaque etape l endroit exact de la
// console ou la faire (la page Etablissement l affiche en haut, assets/app-main.js ebMiseEnRouteHtml).
//
// Les centres du fichier socle (Fun Galaxy et la demonstration) n en ont pas : ils sont en service depuis
// toujours. Un centre archive non plus : il a ete ferme expres.

const { activitesVendues, estDuSocle, manqueAPublier, tarifsAPoser } = require('./centre-publie');

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
function liste(noms) {
  const vus = [...new Set(noms.filter(Boolean))];
  if (vus.length <= 1) return vus.join('');
  const montres = vus.slice(0, 4);
  const reste = vus.length - montres.length;
  return reste > 0 ? `${montres.join(', ')} et ${pluriel(reste, 'autre')}` : `${montres.slice(0, -1).join(', ')} et ${montres[montres.length - 1]}`;
}

// null pour un centre du socle ou archive ; sinon les etapes, dans l ordre ou les faire.
// `activites` : pour un essai sans catalogue ; en service, celles que le centre vend.
function miseEnRoute(centre, { activites } = {}) {
  if (!centre || typeof centre !== 'object' || estDuSocle(centre)) return null;
  const statut = String(centre.status || '');
  if (statut === 'closed') return null;
  const vendues = Array.isArray(activites) ? activites : activitesVendues(centre);
  const jours = require('./center-facts').joursOuvertsDeclares(centre.defaultSchedule) || [];
  const sansPrix = tarifsAPoser(centre, { activites: vendues });
  const info = centre.publicInfo && typeof centre.publicInfo === 'object' ? centre.publicInfo : {};
  const adresse = String(info.address || '').trim();
  const telephone = String(info.phone || '').trim();
  const ouvert = statut === 'active';
  // En ligne : ouvert, publie au sens du formulaire (lib/centre-publie.js), et quelque chose a vendre.
  const enLigne = ouvert && vendues.length > 0 && !manqueAPublier(centre, { activites: vendues });
  // Ce qui garde le formulaire ferme d un centre deja passe « ouvert ».
  const bloque = [!jours.length && 'les horaires', !vendues.length && 'les activités', vendues.length > 0 && sansPrix.length > 0 && 'les prix'].filter(Boolean);
  const accorde = (noms, un, plusieurs) => `${liste(noms)} ${noms.length > 1 ? plusieurs : un}`;

  const etapes = [
    {
      cle: 'horaires',
      titre: 'Vos horaires',
      fait: jours.length > 0,
      phrase: jours.length ? `Ouvert ${jours.length} jour${jours.length > 1 ? 's' : ''} sur 7.` : 'Dites quels jours vous ouvrez, et à quelle heure.',
      bouton: jours.length ? 'Revoir' : 'Régler les horaires',
      aller: { page: 'establishment', rubrique: 'horaires' },
    },
    {
      cle: 'activites',
      titre: 'Ce que vos clients réservent',
      fait: vendues.length > 0,
      phrase: vendues.length ? `${accorde(vendues.map((a) => a.name || a.id), 'se réserve', 'se réservent')}.` : 'Choisissez les activités que vos clients peuvent réserver.',
      bouton: vendues.length ? 'Revoir' : 'Choisir les activités',
      aller: { page: 'establishment', rubrique: 'activites' },
    },
    {
      cle: 'tarifs',
      titre: 'Vos prix',
      fait: vendues.length > 0 && sansPrix.length === 0,
      phrase: !vendues.length
        ? 'Après les activités, posez le prix de chacune.'
        : sansPrix.length ? `${accorde(sansPrix.map((a) => a.name || a.id), 'n’a pas encore de prix', 'n’ont pas encore de prix')}.` : 'Chaque activité a son prix.',
      bouton: vendues.length && !sansPrix.length ? 'Revoir' : 'Poser les prix',
      aller: { page: 'prices' },
    },
    {
      cle: 'coordonnees',
      titre: 'Votre adresse et votre téléphone',
      fait: Boolean(adresse && telephone),
      phrase: adresse && telephone
        ? 'Ils partent dans chaque mail de confirmation.'
        : `Ajoutez ${!adresse && !telephone ? 'votre adresse et votre téléphone' : !adresse ? 'votre adresse' : 'votre téléphone'}. Ils partent dans chaque mail de confirmation.`,
      bouton: adresse && telephone ? 'Revoir' : 'Ajouter',
      aller: { page: 'establishment', rubrique: 'centre', champ: adresse ? 'estab-phone' : 'estab-address' },
    },
    {
      cle: 'ouvrir',
      titre: 'Ouvrir la réservation en ligne',
      fait: enLigne,
      phrase: enLigne
        ? 'Votre formulaire prend les réservations.'
        : ouvert
          ? `Votre centre est ouvert, mais le formulaire reste fermé tant que ${liste(bloque)} manquent.`
          : 'Quand tout le reste est fait, passez votre centre en « Ouvert à la réservation ».',
      bouton: 'Ouvrir le centre',
      aller: { page: 'establishment', rubrique: 'centre', champ: 'estab-status' },
    },
  ];
  const pret = etapes.slice(0, -1).every((etape) => etape.fait);
  if (!ouvert && pret) etapes[etapes.length - 1].phrase = 'Tout est prêt. Passez votre centre en « Ouvert à la réservation ».';
  return { enLigne, restantes: etapes.filter((etape) => !etape.fait).length, etapes };
}

// La liste des centres de la page Etablissement (api/ops.js, action centerConfig), chacun avec sa mise en
// route s il en a une.
function avecMiseEnRoute(centres) {
  return (Array.isArray(centres) ? centres : []).map((centre) => {
    const etapes = miseEnRoute(centre);
    return etapes ? { ...centre, miseEnRoute: etapes } : centre;
  });
}

module.exports = { avecMiseEnRoute, miseEnRoute };

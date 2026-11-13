// LES ALERTES QUI PARTENT A L INSTANT, AU GABARIT (2026-11-13, Ansar : « c'est pas clair,
// j'comprends rien »). Chaque route qui previent Ansar au moment d un incident prend son texte
// ici, et le gate test:alertes-lisibles fabrique ces memes textes : un seul endroit a relire.
//
// Chaque fonction rend { texte, liens, urgent }. `urgent` : seule une vraie panne sonne (un client
// ou l equipe bloques maintenant) ; ce qui est a regarder arrive sans sonnerie.
//
// Aucune donnee personnelle de client : ni nom, ni telephone, ni e-mail, et rien de ce qu un
// navigateur envoie n est recopie. Le prenom d une personne de l equipe peut partir.
'use strict';

const T = require('./alertes-texte');

const nomDuCentre = (id) => require('./garde-annonces').nomDuCentre(id);
const jourLisible = (date) => require('./garde-annonces').jourLisible(date);
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const avec = (b, urgent) => ({ ...b, urgent: Boolean(urgent) });

// Qui voit l erreur, selon le point d entree qui a casse.
function quiEstTouche(surface) {
  const s = String(surface || '');
  if (/^api\/cron:/.test(s)) return 'La tâche réessaie à son prochain passage.';
  if (s === 'api/inbound-email') return 'Le fournisseur des mails redonne le message plus tard : rien n’est perdu pour l’instant.';
  if (/^api\/(public-|pilot-lead|u$)/.test(s)) return 'Le client a vu un message d’erreur.';
  return 'La personne de l’équipe qui faisait ce geste a vu un message d’erreur.';
}

// Une panne du code dans une route (lib/garde-serveur.js).
function panneInterne({ surface, centre = '', message = '' } = {}) {
  const qui = centre && centre !== 'plateforme' ? nomDuCentre(centre) : 'Pinlane';
  return avec(T.bloc({
    quoi: `${qui} : une panne s’est produite ${T.lieuLisible(surface)}`,
    effet: `${T.causeLisible(message)} ${quiEstTouche(surface)}`,
    action: T.faire('si ça se répète, demande une réparation. Le détail technique est gardé dans les Incidents.'),
    lien: T.lienVers('plantages'),
  }), true);
}

// Un mail revenu, signale indesirable, ou que le fournisseur n a pas pu envoyer (lib/garde-mails.js).
const MODELES = {
  confirmation: 'la confirmation',
  reminder_48h: 'le rappel 48 h avant',
  post_visit_followup: 'le mail après la visite',
  custom_request_ack: 'l’accusé de la demande de groupe',
};
function evenementMail(type, m = {}) {
  const centre = nomDuCentre(m.center_id);
  const quel = MODELES[m.template_id] || 'un mail';
  const dossier = m.reservation_id
    ? `C’était ${quel} de la réservation n° ${m.reservation_id}${m.date ? ` (${jourLisible(m.date)}${m.start_time ? ` à ${String(m.start_time).slice(0, 5)}` : ''})` : ''}.`
    : `C’était ${quel}.`;
  if (type === 'complained') {
    return avec(T.bloc({ quoi: `${centre} : un client a classé un mail en indésirable`, effet: `${dossier} Il ne recevra plus d’offres du centre.`, action: T.rienAFaire('c’est son choix, il est retiré des envois.') }), false);
  }
  if (type === 'bounced') {
    return avec(T.bloc({ quoi: `${centre} : un mail n’est pas arrivé chez un client, sa boîte l’a refusé`, effet: `${dossier} L’adresse est sans doute fausse : le client ne l’a pas.`, action: T.faire(`demande à l’équipe de ${centre} d’appeler ce client, le numéro est dans le dossier.`) }), false);
  }
  return avec(T.bloc({ quoi: `${centre} : un mail n’a pas pu partir`, effet: `${dossier} Le fournisseur des mails l’a refusé : le client ne l’a pas.`, action: T.faire(`demande à l’équipe de ${centre} d’appeler ce client. Si d’autres mails ratent, demande une réparation.`) }), false);
}

// Une tache de fond qui rate un passage (lib/cron-tasks.js). Un passage rate ne sonne pas : la
// garde sonne quand la tache prend du retard.
function tacheRatee(tache = {}, raison = '') {
  const nom = tache.nom || 'Une tâche automatique';
  const sujet = `${nom.charAt(0).toLowerCase()}${nom.slice(1)}`;
  return avec(T.bloc({
    quoi: `Pinlane : ${sujet} ${/^Les /.test(nom) ? 'ont raté leur' : 'a raté son'} passage`,
    effet: `${T.causeLisible(raison)}${tache.alerte ? ` Un nouvel essai se fait au passage suivant. ${tache.effet || ''}` : ''}`,
    action: tache.alerte ? T.rienAFaire('si le retard dure, un autre message te le dira, avec la sonnerie.') : T.rienAFaire('aucun client n’est touché.'),
    lien: T.lienVers('tour'),
  }), false);
}

// La garde du quart d heure qui ne lit plus les donnees (api/cron.js).
function gardeBloquee() {
  return avec(T.bloc({
    quoi: 'Pinlane : la surveillance du quart d’heure n’arrive plus à lire les données',
    effet: 'Tant que ça dure, plus rien ne surveille les mails, les réservations ratées ni le secours. Le site peut encore marcher.',
    action: T.faire('ouvre le site pour voir s’il répond, puis demande une réparation.'),
    lien: T.lienVers('tour'),
  }), true);
}

// Les horaires que le formulaire ne garde plus de cote (api/public-reservations.js, la retenue).
function horairesNonRetenus(centre) {
  return avec(T.bloc({
    quoi: `${nomDuCentre(centre)} : le formulaire en ligne n’arrive plus à garder les horaires de côté pendant que le client remplit`,
    effet: 'Le client peut continuer : les horaires sont revérifiés quand il confirme.',
    action: T.rienAFaire('si une réservation échoue vraiment, un autre message te le dira.'),
  }), false);
}

// Une reservation en ligne qui echoue sur une panne (api/public-reservations.js).
function reservationEchouee({ centre, essai = {}, transmise = false } = {}) {
  const nom = nomDuCentre(centre);
  const quand = [essai.date ? jourLisible(essai.date) : '', essai.heure ? `à ${essai.heure}` : '', essai.joueurs ? pluriel(Number(essai.joueurs), 'personne', 'personnes') : ''].filter(Boolean).join(' ').replace(/ (\d+ personnes?)$/, ', $1');
  return avec(T.bloc({
    quoi: `${nom} : une réservation en ligne a échoué à cause d’une panne`,
    effet: `${quand ? `${quand.charAt(0).toUpperCase()}${quand.slice(1)}. ` : ''}${transmise ? 'La demande est partie par mail à la boîte de secours du centre.' : 'La demande n’a pas pu partir : le client doit réessayer.'}`,
    action: transmise ? T.faire(`préviens l’équipe de ${nom} de saisir la demande reçue par mail.`) : T.faire(`préviens l’équipe de ${nom}. Si ça se répète, demande une réparation.`),
    lien: T.lienVers('tour'),
  }), true);
}

// Une erreur dans le navigateur d un client, au formulaire (api/public-booking-meta.js).
const ETAPES = { activites: 'au choix des activités', contact: 'aux coordonnées', date: 'au choix de la date', fin: 'à la fin', heures: 'au choix de l’heure', recap: 'au récapitulatif', reserver: 'dans le formulaire' };
// `urgent` : la regle de la route (deux visiteurs differents dans l heure, api/public-booking-meta.js).
function formulairePlante({ centre, etape = '', visiteurs = 1, urgent = visiteurs >= 2 } = {}) {
  const nom = nomDuCentre(centre);
  const ou = ETAPES[etape] ? `, ${ETAPES[etape]}` : '';
  if (urgent) {
    return avec(T.bloc({ quoi: `${nom} : le formulaire en ligne a eu la même erreur chez ${visiteurs} clients différents${ou}`, effet: 'Des clients ne peuvent peut-être plus réserver en ligne.', action: T.faire('réserve toi-même sur le site pour vérifier. Si ça bloque, demande une réparation.'), lien: T.lienVers('plantages') }), true);
  }
  return avec(T.bloc({ quoi: `${nom} : le formulaire en ligne a eu une erreur chez un client${ou}`, effet: 'Un seul client pour l’instant : il a peut-être abandonné sa réservation.', action: T.rienAFaire('si un deuxième client a la même erreur, un autre message te le dira, avec la sonnerie.'), lien: T.lienVers('plantages') }), false);
}

// La copie d une reservation dans l ancien formulaire du site (api/public-booking-meta.js, miroir).
// Elle sonne : pendant l essai, l equipe du centre cherche ses reservations dans les mails de l ancien
// formulaire, et un client qu elle n y trouve pas arrive sans etre attendu. Ansar doit la prevenir
// vite. Rare : une seule par reservation et par heure, d une reservation qui existe en base.
function copieAncienFormulaire({ centre, numero, demande = false, envoyees = 0, lignes = 0, pourquoi = '' } = {}) {
  const nom = nomDuCentre(centre);
  const quoi = demande ? `la demande de groupe n° ${numero}` : `la réservation n° ${numero}`;
  const combien = lignes ? ` (${pluriel(envoyees, 'entrée recopiée', 'entrées recopiées')} sur ${lignes})` : '';
  return avec(T.bloc({
    quoi: `${nom} : la copie de ${quoi} dans l’ancien formulaire du site n’est pas passée entière${combien}`,
    effet: `Elle est bien dans Pinlane, mais l’équipe ne la trouvera pas, ou pas complète, dans les mails de l’ancien formulaire. Raison : ${pourquoi || 'leur site a répondu quelque chose de non reconnu'}.`,
    action: T.faire(`préviens l’équipe de ${nom} qu’elle est dans Pinlane.`),
  }), true);
}

// Une demande de groupe qui ne s enregistre pas (api/public-booking-meta.js).
function demandeNonEnregistree({ centre, participants = 0 } = {}) {
  const nom = nomDuCentre(centre);
  return avec(T.bloc({
    quoi: `${nom} : une demande de groupe n’a pas pu s’enregistrer${participants ? ` (${pluriel(Number(participants), 'personne', 'personnes')})` : ''}`,
    effet: 'Le client a lu « réessayez dans un instant » : sa demande n’est nulle part.',
    action: T.faire('si le client rappelle, prends sa demande au téléphone. Si ça se répète, demande une réparation.'),
    lien: T.lienVers('tour'),
  }), true);
}

// Une erreur dans la console d un centre (api/ops.js, logClientError).
function consolePlantee({ centre, qui = '', page = '' } = {}) {
  const nom = nomDuCentre(centre);
  const p = T.pageLisible(page);
  return avec(T.bloc({
    quoi: `${nom} : la console a eu une erreur${qui ? ` chez ${qui}` : ''}${p ? `, page ${p}` : ''}`,
    effet: `La page s’est peut-être figée pour ${qui || 'la personne qui l’utilisait'}.`,
    action: T.rienAFaire('recharger la page suffit en général. Si ça revient, demande une réparation.'),
    lien: T.lienVers('plantages'),
  }), false);
}

module.exports = { ETAPES, MODELES, consolePlantee, copieAncienFormulaire, demandeNonEnregistree, evenementMail, formulairePlante, gardeBloquee, horairesNonRetenus, panneInterne, quiEstTouche, reservationEchouee, tacheRatee };

// LES MAILS QUI N ARRIVENT PAS (2026-11-06, Ansar : « chaque donnee qui ne part pas (mail
// refuse ou parti en spam) »). Le fournisseur d envoi previent deja Pinlane de chaque
// rebond et de chaque plainte (lib/email-events.js, en base depuis le 2026-09-16), et la
// garde en faisait un compte toutes les 48 h. Chacun sonne maintenant dans Pannes, a
// l instant ou il arrive, avec ce qu il faut pour agir : quel mail, quel dossier, quel
// jour. Jamais l adresse : elle est dans le dossier.
//
// Ce qu aucun expediteur ne voit : un mail range dans les indesirables sans que le client
// le signale. Seule la plainte (le client clique « indesirable ») remonte.
'use strict';

const MODELES = {
  confirmation: 'la confirmation',
  reminder_48h: 'le rappel 48 h avant',
  post_visit_followup: 'le mail après la visite',
  custom_request_ack: 'l’accusé de la demande de groupe',
};

function texteEvenement(type, m) {
  const { nomDuCentre, jourLisible } = require('./garde-annonces');
  const centre = nomDuCentre(m.center_id);
  const quel = MODELES[m.template_id] || 'un mail';
  const dossier = m.reservation_id
    ? `Réservation n° ${m.reservation_id}${m.date ? ` (${jourLisible(m.date)}${m.start_time ? ` à ${String(m.start_time).slice(0, 5)}` : ''})` : ''}.`
    : '';
  if (type === 'bounced') {
    return ['URGENT Pinlane', `Un mail n’est pas arrivé chez un client de ${centre} : sa boîte l’a refusé (${quel}).`, dossier, 'À appeler : le numéro est dans le dossier.'].filter(Boolean).join('\n');
  }
  if (type === 'complained') {
    return ['À regarder, Pinlane', `Un client de ${centre} a classé ${quel} en indésirable. Il ne recevra plus d’offres.`, dossier].filter(Boolean).join('\n');
  }
  return ['URGENT Pinlane', `Le fournisseur n’a pas pu envoyer ${quel} de ${centre}.`, dossier, 'Le détail est dans la Tour de contrôle, page du dossier.'].filter(Boolean).join('\n');
}

const SONNENT = new Set(['bounced', 'complained', 'failed']);

// Ne jette jamais : le fournisseur rejouerait l evenement deja enregistre.
async function alerterEvenementMail(resultat, { query, env, fetcher } = {}) {
  try {
    if (!resultat || resultat.deduped || !resultat.communicationId || !SONNENT.has(resultat.type)) return { ok: true, rien: true };
    const q = query || ((sql, p) => require('./database').getPool().query(sql, p));
    const { rows } = await q(
      `select c.id, c.center_id, c.template_id, c.reservation_id, r.date::text as date, r.start_time::text as start_time
         from communications c left join reservations r on r.id = c.reservation_id
        where c.id = $1 limit 1;`,
      [resultat.communicationId],
    );
    if (!rows[0]) return { ok: true, rien: true };
    const { alerter } = require('./garde-alertes');
    // Le mail revenu sonne (un client sans confirmation, a appeler) ; la plainte, non.
    return await alerter(`mail:${resultat.type}:${resultat.communicationId}`, texteEvenement(resultat.type, rows[0]), { fenetreMs: 24 * 3600_000, env, fetcher, silencieux: resultat.type === 'complained' });
  } catch (error) {
    console.error('[garde] evenement de mail non signale', error && error.message);
    return { ok: false };
  }
}

module.exports = { alerterEvenementMail, texteEvenement };

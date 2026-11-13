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

// Le texte vit au gabarit des alertes (lib/alertes-messages.js, evenementMail). Aucun ne sonne
// (2026-11-13) : un mail revenu est une adresse a corriger par l equipe, pas une panne de Pinlane ;
// les mails qui ne partent plus du tout, la garde du quart d heure les dit, et ca sonne.
const texteEvenement = (type, m) => require('./alertes-messages').evenementMail(type, m).texte;

const SONNENT = new Set(['bounced', 'complained', 'failed']);

// Ne jette jamais : le fournisseur rejouerait l evenement deja enregistre.
async function alerterEvenementMail(resultat, { query, env, fetcher } = {}) {
  try {
    if (!resultat || resultat.deduped || !resultat.communicationId || !SONNENT.has(resultat.type)) return { ok: true, rien: true };
    const q = query || ((sql, p) => require('./database').getPool().query(sql, p));
    // Le filtre des simulations vit dans la sous-requete : communications a aussi une
    // colonne channel, le predicat y serait ambigu.
    const { simulationSqlExclusion } = require('./simulation-filter');
    const { rows } = await q(
      `select c.id, c.center_id, c.template_id, c.reservation_id, r.date::text as date, r.start_time::text as start_time
         from communications c
         left join (select id, date, start_time from reservations where ${simulationSqlExclusion()}) r on r.id = c.reservation_id
        where c.id = $1 limit 1;`,
      [resultat.communicationId],
    );
    if (!rows[0]) return { ok: true, rien: true };
    const { alerter } = require('./garde-alertes');
    const m = require('./alertes-messages').evenementMail(resultat.type, rows[0]);
    return await alerter(`mail:${resultat.type}:${resultat.communicationId}`, m.texte, { fenetreMs: 24 * 3600_000, env, fetcher, urgent: m.urgent, liens: m.liens });
  } catch (error) {
    console.error('[garde] evenement de mail non signale', error && error.message);
    return { ok: false };
  }
}

module.exports = { alerterEvenementMail, texteEvenement };

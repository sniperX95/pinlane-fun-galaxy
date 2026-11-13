// LES PLANTAGES DU SERVEUR (2026-11-06, Ansar : « chaque plantage (navigateur du client,
// API, taches de fond) »). Une erreur d infrastructure dans une route ne laissait qu une
// ligne dans les journaux de Vercel, gardes une heure, et la sonde ne la voit que si elle
// passe par le meme chemin. Elle entre maintenant dans la table des plantages du
// navigateur (client_errors, membre « serveur:<route> »), avec les memes gardes
// (expurgation des adresses et des cles, plafonds, 20 lignes par heure et par route), et
// sonne dans Pannes, une fois par heure et par plantage distinct.
//
// La reponse au client n attend rien : le signal continue apres elle (waitUntil de
// Vercel, comme le travail detache d api/ops.js). Ne jette jamais.
'use strict';

function garderEnVie(promesse) {
  try {
    require('@vercel/functions').waitUntil(promesse);
  } catch (error) {
    // Hors Vercel (bancs, node local) : la promesse tourne deja, rien a faire.
  }
  return promesse;
}

async function signaler(surface, error, { centerId = '', env, fetcher } = {}) {
  try {
    const nom = String(surface || 'api').replace(/[^a-z0-9/_.:-]/gi, '').slice(0, 60) || 'api';
    const brut = String((error && error.message) || error || 'erreur sans message');
    const code = error && error.code && !brut.includes(String(error.code)) ? `${String(error.code).slice(0, 20)} ` : '';
    const message = `${code}${brut}`.slice(0, 500);
    const centre = String(centerId || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
    const { recordClientError } = require('./client-errors');
    const inscrit = await recordClientError({
      centerId: centre || 'plateforme',
      page: `serveur:${nom}`,
      message,
      source: nom,
      stack: error && error.stack,
      memberId: `serveur:${nom}`,
    });
    // DEJA VU EN BASE (2026-11-13) : seule la premiere apparition d une panne se dit (ou son retour
    // apres un acquittement), une instance qui redemarre ne la redit plus. Au-dela de 20 lignes par
    // heure, elle est deja dite. Si la base n ecrit plus, on ne sait rien : le message part.
    if (inscrit && ((inscrit.dropped && inscrit.raison === 'limite') || (!inscrit.dropped && Number(inscrit.rang) > 1))) return { ok: true, deja: true };
    const empreinte = String((inscrit && inscrit.stackHash) || '').slice(0, 6);
    const { alerter } = require('./garde-alertes');
    // Le texte dit le geste qui a rate et sa cause en une phrase (lib/alertes-messages.js) : le
    // message technique reste dans les Incidents, jamais sur Telegram.
    const m = require('./alertes-messages').panneInterne({ surface: nom, centre, message });
    return await alerter(
      `serveur:${nom}:${empreinte}`,
      m.texte,
      { fenetreMs: 60 * 60_000, env, fetcher, urgent: m.urgent, liens: m.liens },
    );
  } catch (e) {
    console.error('[garde] panne serveur non signalée', e && e.message);
    return { ok: false };
  }
}

function signalerPanneServeur(surface, error, options = {}) {
  return garderEnVie(signaler(surface, error, options));
}

module.exports = { signalerPanneServeur };

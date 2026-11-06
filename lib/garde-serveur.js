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
    const code = error && error.code ? `${String(error.code).slice(0, 20)} ` : '';
    const message = `${code}${String((error && error.message) || error || 'erreur sans message')}`.slice(0, 500);
    const centre = String(centerId || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
    const { recordClientError, scrubSensitiveValues } = require('./client-errors');
    const inscrit = await recordClientError({
      centerId: centre || 'plateforme',
      page: `serveur:${nom}`,
      message,
      source: nom,
      stack: error && error.stack,
      memberId: `serveur:${nom}`,
    });
    const empreinte = String((inscrit && inscrit.stackHash) || '').slice(0, 6);
    const { alerter } = require('./garde-alertes');
    return await alerter(
      `serveur:${nom}:${empreinte}`,
      `URGENT Pinlane\nPanne du serveur, ${nom}${centre ? ` (${centre})` : ''}.\n${scrubSensitiveValues(message).replace(/\s+/g, ' ').slice(0, 160)}\nLe détail est dans la Tour de contrôle.`,
      { fenetreMs: 60 * 60_000, env, fetcher },
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

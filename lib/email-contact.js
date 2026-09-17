// LE VRAI CLIENT D UN MAIL RECU (2026-09-17).
//
// POURQUOI. Les demandes du site arrivent par son formulaire : l expediteur
// technique est une adresse du centre (info@fungalaxy.be), le client est ecrit
// dans le mail (« E-mail j.serre@exemple.be »). Pinlane prenait l expediteur
// pour le client : la conversation s appelait « info@fungalaxy.be », toutes les
// demandes du site se melangeaient sous ce nom, et la reponse partait au site
// au lieu du client.
//
// LA REGLE, dans l ordre :
//   1. l en-tete Reply-To, s il donne une adresse EXTERNE au centre : c est la
//      facon standard dont un formulaire dit « repondez a cette personne » ;
//   2. si l expediteur est un RELAIS (meme domaine que la boite qui a recu le
//      mail ou que l adresse publique du centre, ou une adresse de type
//      no-reply), l adresse externe ecrite dans le corps : celle qui suit une
//      etiquette E-mail / Courriel, sinon la SEULE adresse externe du corps.
//      Plusieurs adresses sans etiquette : on ne devine pas, l expediteur reste ;
//   3. sinon, l expediteur.
//
// Pur et sans base : la meme fonction sert a l ingestion au fil de l eau et au
// rattrapage des mails deja recus (scripts/backfill-email-contacts.js).
'use strict';

const ADRESSE_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const LOCAL_RELAIS_RX = /^(?:no-?reply|ne-?pas-?repondre|do-?not-?reply|wordpress|formulaire|forms?|contact-?form|notifications?|mailer-daemon)$/i;
const ETIQUETTE_RX = /(?:e-?mail|courriel|mail)\s*[:?]?\s*$/i;

function domaineDe(adresse) {
  const brut = String(adresse || '').trim().toLowerCase();
  const arobase = brut.lastIndexOf('@');
  return arobase > 0 ? brut.slice(arobase + 1) : '';
}

function premiereAdresse(valeur) {
  const trouve = String(valeur || '').match(ADRESSE_RX);
  return trouve ? trouve[0].toLowerCase() : '';
}

// « Julie Serre <j.serre@exemple.be> » -> « Julie Serre ».
function nomDeLEntete(valeur) {
  const brut = String(valeur || '').trim();
  const chevron = brut.indexOf('<');
  if (chevron <= 0) return '';
  return brut.slice(0, chevron).trim().replace(/^"+|"+$/g, '').trim();
}

function adresseDuClient({ from = '', fromName = '', replyTo = '', text = '', to = '', centerEmail = '' } = {}) {
  const expediteur = premiereAdresse(from) || String(from || '').trim().toLowerCase();
  const domainesDuCentre = new Set([domaineDe(premiereAdresse(to)), domaineDe(centerEmail)].filter(Boolean));
  const estDuCentre = (adresse) => domainesDuCentre.has(domaineDe(adresse));
  const estRelaisLocal = (adresse) => LOCAL_RELAIS_RX.test(String(adresse || '').split('@')[0]);
  const externe = (adresse) => Boolean(adresse) && adresse !== expediteur && !estDuCentre(adresse) && !estRelaisLocal(adresse);

  const reponseA = Array.isArray(replyTo) ? replyTo.join(', ') : String(replyTo || '');
  const adresseReponse = premiereAdresse(reponseA);
  if (externe(adresseReponse)) {
    return { email: adresseReponse, name: nomDeLEntete(reponseA), source: 'reply-to', relais: expediteur };
  }

  const relais = Boolean(expediteur) && (estDuCentre(expediteur) || estRelaisLocal(expediteur));
  if (!relais) return { email: expediteur, name: String(fromName || '').trim(), source: 'expediteur', relais: '' };

  const corps = String(text || '');
  const candidates = [];
  const regex = new RegExp(ADRESSE_RX.source, 'g');
  let trouve = regex.exec(corps);
  while (trouve) {
    const adresse = trouve[0].toLowerCase();
    if (externe(adresse)) candidates.push({ adresse, avant: corps.slice(Math.max(0, trouve.index - 40), trouve.index) });
    trouve = regex.exec(corps);
  }
  const etiquetee = candidates.find((candidate) => ETIQUETTE_RX.test(candidate.avant));
  if (etiquetee) return { email: etiquetee.adresse, name: '', source: 'corps', relais: expediteur };
  const distinctes = [...new Set(candidates.map((candidate) => candidate.adresse))];
  if (distinctes.length === 1) return { email: distinctes[0], name: '', source: 'corps', relais: expediteur };
  return { email: expediteur, name: String(fromName || '').trim(), source: 'expediteur', relais: '' };
}

module.exports = { adresseDuClient, __test: { domaineDe, premiereAdresse, nomDeLEntete } };

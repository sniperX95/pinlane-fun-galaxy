'use strict';
// OUVRIR UN JOUR AUTREMENT (2026-11-09, Ansar : « par exemple c 14-22 on puet ouvirr le centre
// a 10 h ou fermer a minuit »). Une ligne par jour dans la configuration du centre. Le moteur
// ne la lit que pour l equipe (pourLEquipe, lib/booking-config) : les clients en ligne gardent
// les horaires habituels.
//
// Une plage ne cache jamais une reservation deja posee : fermer plus tot qu un groupe, ou
// revenir aux horaires habituels alors qu un groupe joue en dehors, se refuse avec la raison.

const { getSchedule, numToTime, timeToNum } = require('./booking-config');
const { normalizeDaySchedule, normalizeOuvertures, saveCenterConfigOverride } = require('./center-config');
const { exigerOuverture, refus } = require('./droits-reservation');

// Une ligne passee reste un mois (le planning de ce jour-la garde sa plage), puis s en va.
const JOURS_GARDES = 31;
// Un quart d heure de marge : une fin de visite calculee peut mordre sur la fermeture.
const MARGE_FIN = 0.25;

function dateReelle(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function jourMoins(iso, jours) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - jours);
  return d.toISOString().slice(0, 10);
}

// Ce qu un dossier occupe vraiment : ses blocs de jeu, sinon son heure et sa duree. La table et
// le service suivent la visite, ils ne decident pas des horaires du centre.
function etendueDuDossier(r) {
  const blocs = (r && r.opsPlan && Array.isArray(r.opsPlan.resourceBlocks) ? r.opsPlan.resourceBlocks : [])
    .filter((b) => b && b.startTime && b.endTime && b.resourceType !== 'party_table' && b.resourceType !== 'service_drinks');
  if (blocs.length) {
    return {
      debut: Math.min(...blocs.map((b) => timeToNum(String(b.startTime).slice(0, 5)))),
      fin: Math.max(...blocs.map((b) => timeToNum(String(b.endTime).slice(0, 5)))),
    };
  }
  if (!r || !r.startTime) return null;
  const debut = timeToNum(String(r.startTime).slice(0, 5));
  return { debut, fin: debut + (Number(r.duration) || 0) };
}

function controlerLaPlage(reservations, plage) {
  const dossiers = (reservations || []).filter((r) => r && r.status !== 'cancelled' && r.status !== 'rejected')
    .map((r) => ({ r, e: etendueDuDossier(r) })).filter((x) => x.e);
  if (!dossiers.length) return;
  const nom = (r) => String(r.name || 'Un groupe').replace(/[<>]/g, '').trim().slice(0, 60);
  if (!plage) {
    throw refus('ouverture_reservations', `${nom(dossiers[0].r)} a une réservation ce jour-là, le centre ne peut pas rester fermé. Déplacez-la d’abord.`, 409);
  }
  const avant = dossiers.filter((x) => x.e.debut < plage.open).sort((a, b) => a.e.debut - b.e.debut)[0];
  if (avant) throw refus('ouverture_reservations', `${nom(avant.r)} commence à ${numToTime(avant.e.debut)}. Ouvrez à ${numToTime(avant.e.debut)} au plus tard, ou déplacez ce groupe.`, 409);
  const apres = dossiers.filter((x) => x.e.fin > plage.close + MARGE_FIN).sort((a, b) => b.e.fin - a.e.fin)[0];
  if (apres) throw refus('ouverture_reservations', `${nom(apres.r)} finit à ${numToTime(apres.e.fin)}. Fermez à ${numToTime(apres.e.fin)} au plus tôt, ou déplacez ce groupe.`, 409);
}

async function poserOuverture({ pool, centerId, session, date, open, close, motif, retirer = false, aujourdhui, lireLeJour, centre, rafraichir }) {
  exigerOuverture(session);
  if (!dateReelle(date)) throw refus('ouverture_date', 'Cette date n’existe pas.', 400);
  if (date < aujourdhui) throw refus('ouverture_date', 'Cette date est passée.', 400);
  await rafraichir();
  const center = centre();
  const liste = Array.isArray(center.ouverturesExceptionnelles) ? center.ouverturesExceptionnelles : [];
  const autres = liste.filter((x) => x && x.date !== date && x.date >= jourMoins(aujourdhui, JOURS_GARDES));
  const etat = await lireLeJour(date);
  const reservations = (etat && etat.reservations) || [];
  let ligne = null;
  if (retirer) {
    // (appele hors de pourLEquipe : getSchedule rend l horaire habituel)
    controlerLaPlage(reservations, getSchedule(date, center));
  } else {
    const horaire = normalizeDaySchedule({ open: String(open || ''), close: String(close || '') });
    if (!horaire) throw refus('ouverture_heures', 'Ces horaires ne se lisent pas. La fermeture doit venir après l’ouverture.', 400);
    controlerLaPlage(reservations, { open: timeToNum(horaire.open), close: timeToNum(horaire.close) });
    // (le fondateur ne signe pas l ouverture, lib/fondateur-invisible.js)
    ligne = { date, open: horaire.open, close: horaire.close, motif: String(motif || ''), par: require('./fondateur-invisible').signatureVisible(session, { avecId: false }), le: new Date().toISOString() };
  }
  const suite = normalizeOuvertures(ligne ? [...autres, ligne] : autres);
  await saveCenterConfigOverride(pool, centerId, { ouverturesExceptionnelles: suite });
  await rafraichir();
  return { ouverture: suite.find((x) => x.date === date) || null, ouvertures: suite };
}

module.exports = { poserOuverture, controlerLaPlage, etendueDuDossier };

// LES ANNONCES (2026-11-06, Ansar : « je dois recevoir chaque reservation et chaque
// demande de groupe »). Un message par reservation et par demande, dans le sujet
// Reservations, au moment ou elle s enregistre. Il part en meme temps que le mail de
// confirmation, pas apres : le client n attend rien de plus.
//
// Ce qui part : le centre, le jour, l heure, ce qui est reserve, le nombre, le prix, le
// canal et le numero du dossier. Jamais un nom, un telephone ou un e-mail : le dossier
// s ouvre dans la Tour de controle.
//
// RIEN NE SE PERD : l annonce dit son sort dans la ligne du journal d audit
// (context.annonce : ok, non, differee, essai). Une annonce ratee ou differee, la garde la
// refait au quart d heure suivant, marquee « en retard » (lib/garde-journal.js). Telegram
// en panne ne ralentit pas les reservations : apres un echec, plus d essai en direct
// pendant 2 minutes, la garde rattrape.
'use strict';

const { envoyerTelegram } = require('./garde-alertes');
const { isFabricatedReservation } = require('./simulation-filter');

const DELAI_DIRECT_MS = 2500;
const PAUSE_APRES_ECHEC_MS = 2 * 60_000;
let pauseJusqua = 0;

// « Fun Galaxy Gembloux » devient « Gembloux » ; un centre inconnu garde son identifiant.
function nomDuCentre(id) {
  const brut = String(id || '').trim();
  let nom = '';
  try {
    nom = String(require('./ops-knowledge').getCenter(brut).name || '').trim();
  } catch (error) {
    nom = '';
  }
  const fin = nom.split(/\s+/).pop() || '';
  if (nom && fin.toLowerCase() === brut.toLowerCase()) return fin;
  if (nom) return nom;
  return brut ? brut.charAt(0).toUpperCase() + brut.slice(1) : 'centre inconnu';
}

function jourLisible(date) {
  const texte = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texte)) return texte || 'date inconnue';
  const instant = new Date(`${texte}T12:00:00Z`);
  const semaine = new Intl.DateTimeFormat('fr-BE', { weekday: 'long', timeZone: 'UTC' }).format(instant);
  const [, mois, jour] = texte.split('-');
  return `${semaine} ${jour}/${mois}`;
}

const FORMAT_EUROS = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function euros(montant) {
  const n = Number(montant);
  if (!Number.isFinite(n)) return '';
  return `${FORMAT_EUROS.format(n)} €`;
}

const personnes = (n) => `${Number(n) || 0} ${Number(n) > 1 ? 'personnes' : 'personne'}`;

// Ce qui est reserve, en mots du catalogue : la formule, sinon les activites. Rien de ce
// que le client a tape.
function offreLisible(r) {
  const items = r && r.program && Array.isArray(r.program.items) ? r.program.items : [];
  const coupe = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (r && (r.type === 'formule' || r.formuleId)) return coupe(r.label || r.formuleId);
  if (items.length) return items.slice(0, 6).map((i) => coupe(i && (i.name || i.activityId))).filter(Boolean).join(', ');
  return coupe((r && (r.label || r.type)) || 'réservation');
}

const CANAUX = { public: 'en ligne', staff: 'au comptoir' };

function texteReservation(r, { par = '', retard = false } = {}) {
  const canal = CANAUX[r.channel] || String(r.channel || 'autre canal');
  const auteur = r.channel === 'public' || !String(par || '').trim() ? '' : ` (${String(par).trim().slice(0, 40)})`;
  const lignes = [
    `Nouvelle réservation, ${nomDuCentre(r.centerId)}, ${canal}${auteur}${retard ? ' (annoncée en retard)' : ''}`,
    `${jourLisible(r.date)} à ${String(r.startTime || '').slice(0, 5) || 'heure à fixer'}, ${personnes(r.pax)}`,
    offreLisible(r),
  ];
  if (Number(r.price) > 0) lignes.push(euros(r.price));
  if (r.validationStatus === 'staff_review') lignes.push('À valider par l’équipe');
  if (r.status === 'cancelled') lignes.push('Déjà annulée depuis');
  lignes.push(`Réservation n° ${r.id}`);
  return lignes.join('\n');
}

const OCCASIONS = { anniversaire: 'Anniversaire', amis: 'Entre amis', famille: 'En famille', entreprise: 'Entreprise', ecole: 'École', evg: 'EVG ou EVJF', autre: 'Autre occasion' };

function texteDemande(d, { retard = false } = {}) {
  const quand = String(d.requestedDate || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const lignes = [
    `Nouvelle demande de groupe, ${nomDuCentre(d.centerId)}${retard ? ' (annoncée en retard)' : ''}`,
    [OCCASIONS[d.occasion] || '', Number(d.pax) > 0 ? personnes(d.pax) : ''].filter(Boolean).join(', ') || 'Groupe',
  ];
  if (quand) lignes.push(quand);
  lignes.push(`Demande n° ${d.id}, à traiter dans la console`);
  return lignes.join('\n');
}

async function annoncer(texte, { env = process.env, fetcher = fetch, maintenant = Date.now() } = {}) {
  if (maintenant < pauseJusqua) return 'differee';
  const r = await envoyerTelegram(texte, { sujet: 'reservations', env, fetcher, delaiMs: DELAI_DIRECT_MS });
  if (r.ok) return 'ok';
  if (r.raison === 'canal absent') return 'non';
  pauseJusqua = maintenant + PAUSE_APRES_ECHEC_MS;
  console.error('[garde] annonce non partie', r.raison);
  return 'non';
}

// Ne jette jamais : une annonce ne refuse pas une reservation.
async function annoncerReservation(reservation, { par = '', env, fetcher } = {}) {
  try {
    if (!reservation || isFabricatedReservation(reservation)) return 'essai';
    return await annoncer(texteReservation(reservation, { par }), { env, fetcher });
  } catch (error) {
    console.error('[garde] annonce impossible', error && error.message);
    return 'non';
  }
}

async function annoncerDemande(demande, { env, fetcher } = {}) {
  try {
    if (!demande) return 'non';
    return await annoncer(texteDemande(demande), { env, fetcher });
  } catch (error) {
    console.error('[garde] annonce impossible', error && error.message);
    return 'non';
  }
}

const reprendreLesAnnonces = () => { pauseJusqua = 0; };

module.exports = {
  annoncer,
  annoncerDemande,
  annoncerReservation,
  euros,
  jourLisible,
  nomDuCentre,
  offreLisible,
  personnes,
  reprendreLesAnnonces,
  texteDemande,
  texteReservation,
};

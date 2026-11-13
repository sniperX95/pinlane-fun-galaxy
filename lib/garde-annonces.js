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

// AU GABARIT DES ALERTES (2026-11-13, lib/alertes-texte.js) : le centre et ce qui arrive, ce qui
// est reserve, ce qu il y a a faire, et le numero qui ouvre le dossier.
function texteReservation(r, { par = '', retard = false } = {}) {
  const canal = CANAUX[r.channel] || String(r.channel || 'autre canal');
  const auteur = r.channel === 'public' || !String(par || '').trim() ? '' : ` par ${String(par).trim().slice(0, 40)}`;
  const heure = String(r.startTime || '').slice(0, 5);
  const action = r.status === 'cancelled' ? 'Rien à faire : elle a déjà été annulée depuis.'
    : r.validationStatus === 'staff_review' ? 'Rien à faire : l’équipe doit la valider dans la console.'
      : 'Rien à faire : elle est dans le planning.';
  return [
    `${nomDuCentre(r.centerId)} : nouvelle réservation ${canal}${auteur}, ${jourLisible(r.date)}${heure ? ` à ${heure}` : ', heure à fixer'}${retard ? ' (annoncée en retard)' : ''}.`,
    `${[personnes(r.pax), offreLisible(r), Number(r.price) > 0 ? euros(r.price) : ''].filter(Boolean).join(', ')}.`,
    action,
    `Réservation n° ${r.id}`,
  ].join('\n');
}

const OCCASIONS = { anniversaire: 'Anniversaire', amis: 'Entre amis', famille: 'En famille', entreprise: 'Entreprise', ecole: 'École', evg: 'EVG ou EVJF', autre: 'Autre occasion' };

function texteDemande(d, { retard = false } = {}) {
  const quand = String(d.requestedDate || '').replace(/\s+/g, ' ').replace(/[.]+$/, '').trim().slice(0, 60);
  const quoi = [OCCASIONS[d.occasion] || '', Number(d.pax) > 0 ? personnes(d.pax) : '', quand].filter(Boolean).join(', ') || 'Ni date ni nombre de personnes pour l’instant';
  // Sans numero (2026-11-06) : celui d une demande ne se voyait nulle part dans la
  // console et ne se retrouvait pas. La derniere ligne s ouvre d un toucher (lienDeLaDemande).
  return [
    `${nomDuCentre(d.centerId)} : nouvelle demande de groupe${retard ? ' (annoncée en retard)' : ''}.`,
    `${quoi}.`,
    'Rien à faire : l’équipe y répond depuis Demandes sur mesure.',
    A_TRAITER,
  ].join('\n');
}
const A_TRAITER = 'À traiter dans la console';
// La demande s ouvre dans « Demandes sur mesure », dans son centre.
function lienDeLaDemande(d, env = process.env) {
  const id = Number(d && d.id);
  if (!Number.isSafeInteger(id) || id < 1) return [];
  const centre = String((d && d.centerId) || '').trim().toLowerCase();
  const { adresseDeLaConsole } = require('./garde-alertes');
  return [{ texte: A_TRAITER, url: `${adresseDeLaConsole(env)}/?demande=${id}${/^[a-z][a-z0-9-]{1,40}$/.test(centre) ? `&centre=${centre}` : ''}` }];
}

async function annoncer(texte, { env = process.env, fetcher = fetch, maintenant = Date.now(), liens = [] } = {}) {
  if (maintenant < pauseJusqua) return 'differee';
  const r = await envoyerTelegram(texte, { sujet: 'reservations', env, fetcher, delaiMs: DELAI_DIRECT_MS, liens });
  if (r.ok) return 'ok';
  if (r.raison === 'canal absent') return 'non';
  pauseJusqua = maintenant + PAUSE_APRES_ECHEC_MS;
  console.error('[garde] annonce non partie', r.raison);
  return 'non';
}

// Ne jette jamais : une annonce ne refuse pas une reservation. `essai` (la salle d essai) ne s annonce
// pas. Celle qu Ansar fait s annonce, sans son nom (2026-11-14, lib/essai-fondateur.js).
async function annoncerReservation(reservation, { par = '', session = null, essai = false, env, fetcher } = {}) {
  try {
    if (!reservation || isFabricatedReservation(reservation)) return 'essai';
    if (essai) return 'essai';
    const auteur = require('./essai-fondateur').estLeFondateur(session) ? '' : par;
    return await annoncer(texteReservation(reservation, { par: auteur }), { env, fetcher });
  } catch (error) {
    console.error('[garde] annonce impossible', error && error.message);
    return 'non';
  }
}

async function annoncerDemande(demande, { essai = false, env, fetcher } = {}) {
  try {
    if (!demande) return 'non';
    if (essai) return 'essai';
    return await annoncer(texteDemande(demande), { env, fetcher, liens: lienDeLaDemande(demande, env || process.env) });
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
  lienDeLaDemande,
  nomDuCentre,
  offreLisible,
  personnes,
  reprendreLesAnnonces,
  texteDemande,
  texteReservation,
};

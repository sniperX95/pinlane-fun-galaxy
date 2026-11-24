'use strict';

// TOUT EN ILLIMITE, RIEN A RESERVER : LE KIDS FUN DAY (2026-11-24, Ansar : « kids fun day c'est toutes les
// activités en illimité », « si bowling n'est pas dispo ou laser ils font autre chose, genre pas besoin de
// booker des places »).
//
// Sa fiche du catalogue portait un bowling de 5 h (Tarifs & formules) : le serveur tenait des pistes de 12:00
// a 17:00 pour chaque groupe, refusait la formule quand il n en restait plus, et Modifier montrait une carte
// Bowling a regler.
//
// LA REGLE SE LIT DANS LES MOTS DU CENTRE, comme l offre reservee aux enfants (formuleEnfants,
// lib/booking-config.js) : une formule a fenetre ouverte (isOpenWindowFormula, lib/ops-engine.js) dont une
// ligne de la carte dit « toutes les activités » et « illimitées » (ou « à volonté ») comprend tout ce que le
// centre propose. Quelles que soient ses etapes au catalogue, aucune ne prend de place : ni piste, ni arme,
// ni partie de laser a placer. Ses etapes jouees restent les activites libres ; ce qu elle comprend se lit
// sur l offre du centre (listCenterActivities), jamais sur elles. Le Matin Malin (« Laser Game illimité »)
// ne dit pas « toutes les activités » : rien ne change pour lui, ni pour l acces illimite
// (lib/formule-comptoir.js), qui garde ses pistes et ses departs.

const LIBELLE_ADAPTE = /\(adapt[ée]e\)/i;
const ACTIVITES_A_PLACE = new Set(['bowling', 'laser_game']);
const RESSOURCES_A_PLACE = new Set(['bowling_lane', 'laser_arena']);
// Ce que le moteur reserve d une fenetre ouverte : la demi-heure d arrivee (getFormuleBookedDuration).
const ARRIVEE_HEURES = 0.5;

const plat = (texte) => String(texte == null ? '' : texte).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// « Toutes les activités illimitées », « Accès illimité à toutes nos activités ». Pas « Toutes les activités de
// la formule doivent être terminées à 12h » (une note du Matin Malin).
function ditToutIllimite(ligne) {
  const texte = plat(ligne);
  return /\btoutes (?:les |nos )?activites\b(?! de la formule)/.test(texte) && /\billimite|\ba volonte\b/.test(texte);
}

// La politique d horaire et les lignes de la carte d une formule (lib/catalog-store.js buildCanonicalFormula).
function estToutIllimite(orderPolicy, lignes) {
  return String(orderPolicy || '') === 'open_window' && (Array.isArray(lignes) ? lignes : []).some(ditToutIllimite);
}

// Un bloc de plan, une etape du catalogue ou de la frise qui prend une piste ou une arme.
function prendUnePlace(bloc) {
  return Boolean(bloc) && (ACTIVITES_A_PLACE.has(String(bloc.activityId || '')) || RESSOURCES_A_PLACE.has(String(bloc.resourceType || '')));
}

function etapesSansPlace(etapes) {
  return (Array.isArray(etapes) ? etapes : []).filter((etape) => !prendUnePlace(etape));
}

// La formule d un dossier deja pris : le catalogue vivant, sinon celui du fichier (une formule retiree depuis).
function formuleToutIllimite(formuleId) {
  const id = String(formuleId || '').trim();
  if (!id) return false;
  try {
    const formule = require('./catalog-store').resolveBookingFormuleAnyScope(id) || require('./booking-config').FORMULES.find((f) => f.id === id);
    return Boolean(formule && formule.toutIllimite === true);
  } catch (error) {
    return false;
  }
}

// Un dossier de cette formule. Adaptee a la main avec un bowling ou un laser (lib/formule-adaptee.js), ou composee au
// comptoir, elle garde ce que l equipe y a pose ; adaptee sans aucune place (le bowling montre a tort, retire dans
// Modifier), elle comprend tout comme les autres.
function dossierToutIllimite(dossier) {
  if (!dossier || typeof dossier !== 'object' || dossier.type !== 'formule') return false;
  if (!formuleToutIllimite(dossier.formuleId || dossier.formulaId)) return false;
  const programme = dossier.program;
  if (programme && !Array.isArray(programme) && programme.formuleSurMesure) return false;
  const lignes = Array.isArray(programme) ? programme : programme && Array.isArray(programme.items) ? programme.items : [];
  return !(lignes.some(prendUnePlace) && LIBELLE_ADAPTE.test(String(dossier.label || '')));
}

// LES DOSSIERS DEJA ENREGISTRES NE TIENNENT RIEN NON PLUS, sans qu il faille les rouvrir. Lu de la base
// (mapReservation, lib/database.js), un dossier garde son heure, sa fin et son prix ; ses pistes, ses blocs de
// bowling et de laser et ses parties a placer ne se lisent plus. Une activite en plus, achetee a part, garde
// les siens (lib/formule-en-plus.js).
function dossierSansPlaces(dossier) {
  if (!dossierToutIllimite(dossier)) return dossier;
  const plan = dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : null;
  const reste = (bloc) => Boolean(bloc) && (bloc.enPlus === true || !prendUnePlace(bloc));
  const blocs = plan && Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks.filter(reste) : [];
  const pistes = [...new Set(blocs.filter((bloc) => bloc.resourceType === 'bowling_lane').flatMap((bloc) => bloc.lanes || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const duree = Number(dossier.duration) || 0;
  const net = { ...dossier, lanes: pistes, duration: duree > ARRIVEE_HEURES ? ARRIVEE_HEURES : dossier.duration };
  if (plan) {
    net.opsPlan = { ...plan };
    if (Array.isArray(plan.resourceBlocks)) net.opsPlan.resourceBlocks = blocs;
    if (Array.isArray(plan.timeline)) net.opsPlan.timeline = plan.timeline.filter(reste);
    if (Array.isArray(plan.assignedLanes)) net.opsPlan.assignedLanes = pistes;
    if (plan.laserPassPlan) net.opsPlan.laserPassPlan = null;
  }
  return net;
}

// CE QU UNE FORMULE TOUT ILLIMITE COMPREND : chaque activite que le centre propose. null : une autre formule.
function activitesComprises(formuleId, centerId) {
  if (!formuleToutIllimite(formuleId)) return null;
  try {
    return require('./activity-catalog').listCenterActivities(centerId || 'libramont').map((activite) => String(activite.id));
  } catch (error) {
    return [];
  }
}

// UNE ACTIVITE DEJA COMPRISE NE SE VEND PAS EN PLUS (2026-11-24) : la premiere des lignes demandees que la
// formule comprend, avec la phrase qui le dit, ou null. Celles que le dossier porte deja (`deja`) se reposent :
// l equipe les retire elle-meme.
function enPlusDejaCompris({ formuleId, centerId, lignes, deja = [] }) {
  const demandees = (Array.isArray(lignes) ? lignes : []).map((ligne) => String((ligne && ligne.activityId) || '')).filter(Boolean);
  const neuves = demandees.filter((id) => !deja.map(String).includes(id));
  if (!neuves.length) return null;
  const comprises = activitesComprises(formuleId, centerId);
  const id = comprises ? neuves.find((neuve) => comprises.includes(neuve)) : null;
  if (!id) return null;
  let nom = id;
  let formule = '';
  try {
    const activite = require('./activity-catalog').getCenterActivity(centerId || 'libramont', id);
    if (activite && activite.name) nom = String(activite.name);
    const carte = require('./catalog-store').resolveBookingFormuleAnyScope(String(formuleId));
    formule = String((carte && carte.name) || '');
  } catch (error) { /* les identifiants restent lisibles */ }
  return { activite: id, message: `« ${nom} » est déjà compris${formule ? ` dans ${formule}` : ''}, en illimité : rien à ajouter en plus.` };
}

module.exports = {
  activitesComprises,
  ditToutIllimite,
  dossierSansPlaces,
  dossierToutIllimite,
  enPlusDejaCompris,
  estToutIllimite,
  etapesSansPlace,
  formuleToutIllimite,
  prendUnePlace,
};

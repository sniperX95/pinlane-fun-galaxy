'use strict';

// UNE FORMULE ADAPTEE RESTE SA FORMULE (2026-11-20, dossier 1953 de Gembloux).
//
// Une Formule 5 (laser 2 parties, minigolf, 2 cruches) a laquelle « Modifier » ajoutait un bowling
// devenait une visite a la carte : l en-tete disait « À la carte », le laser se chiffrait 18 EUR par
// joueur, le minigolf « au comptoir », les cruches sortaient de l addition et le total ne valait plus
// rien. Le plan repartait pourtant bien de la formule (buildAdaptedFormula, lib/reservation-ops.js,
// garde sa table et ses boissons) : c est le programme envoye, relu comme une visite
// (lib/reservation-request.js applyProgram), qui ecrivait son type par-dessus celui de la formule.
//
// La regle, la meme pour le serveur, la base et les mails :
//   * le dossier garde sa formule, son nom et ce qu elle comprend ;
//   * la formule garde son prix du catalogue (par joueur ou par piste) ;
//   * une activite que sa carte n a pas s y ajoute, a son prix du catalogue ;
//   * retirer une activite de la formule ne baisse rien : le comptoir baisse le total a la main.
// Un acces illimite (lib/formule-comptoir.js) et une formule du comptoir (formuleSurMesure) gardent
// leurs regles : rien ici ne les touche.

const { getFormula } = require('./ops-knowledge');
const { formuleDuDossier } = require('./formula-choice');
const { estOrdreIllimite } = require('./formule-comptoir');
const { getBasePrice } = require('./booking-config');

// La table et le service suivent la formule (ETAPES_NON_EDITABLES, lib/reservation-ops.js).
const ETAPES_DE_SERVICE = new Set(['party_table', 'service_drinks']);
// Le mot que la console et la fenetre Reserver posent sur une formule adaptee (lib/droits-reservation.js).
const LIBELLE_ADAPTE = /\(adapt[ée]e\)/i;
// La marge de la console : sous 50 centimes, deux montants sont les memes.
const TOLERANCE_CENTIMES = 50;
const centimes = (valeur) => Math.round((Number(valeur) || 0) * 100);

function itemsDu(programme) {
  if (Array.isArray(programme)) return programme;
  return programme && Array.isArray(programme.items) ? programme.items : [];
}

// La formule du catalogue que ce dossier joue (sa variante comprise), ou null : pas de formule, une
// formule que le centre n a pas, un acces illimite, une formule du comptoir.
function formuleAdaptable(dossier) {
  if (!dossier || typeof dossier !== 'object') return null;
  const id = String(dossier.formuleId || dossier.formulaId || '').trim();
  if (!id) return null;
  const programme = dossier.program;
  if (programme && !Array.isArray(programme) && programme.formuleSurMesure) return null;
  let formule = null;
  try {
    formule = formuleDuDossier(getFormula(id, dossier.centerId || 'libramont'), dossier);
  } catch (error) {
    formule = null;
  }
  if (!formule || !Array.isArray(formule.steps) || !formule.steps.length || estOrdreIllimite(formule.orderPolicy)) return null;
  return formule;
}

// Deux noms pour les memes arcades : la carte des Formules 6 et 7 compte des credits (arcade_credit), le
// programme que la console envoie du temps de jeu (arcade_time). L un pour l autre n est pas un ajout.
const MEMES_ARCADES = ['arcade_time', 'arcade_credit'];
const famille = (id) => (MEMES_ARCADES.includes(id) ? MEMES_ARCADES[0] : id);

// Ce que la formule vend, sans la table ni le service (ses arcades sous leurs deux noms).
function activitesDeLaFormule(formule) {
  return new Set((formule && Array.isArray(formule.steps) ? formule.steps : [])
    .map((etape) => String((etape && etape.activityId) || ''))
    .filter((id) => id && !ETAPES_DE_SERVICE.has(id))
    .flatMap((id) => (MEMES_ARCADES.includes(id) ? MEMES_ARCADES : [id])));
}

// Les lignes du programme que la carte n a pas, leur montant (le prix du catalogue que
// lib/visit-program vient de poser sur chaque ligne) et si toutes en ont un. Une ligne sans tarif ne
// s invente pas : elle se regle sur place. Une formule tout illimite (lib/formule-tout-illimite.js) comprend
// chaque activite : aucune ne s y ajoute, elle ne se facture pas deux fois.
function ajoutsALaFormule(formule, programme) {
  const comprises = activitesDeLaFormule(formule);
  const comprise = (id) => comprises.has(id) || Boolean(formule && formule.toutIllimite && !ETAPES_DE_SERVICE.has(id));
  const ajoutees = itemsDu(programme).filter((item) => item && item.activityId && !comprise(String(item.activityId)));
  const connues = ajoutees.filter((item) => item.priceKnown === true && Number.isFinite(Number(item.price)));
  return {
    ajoutees,
    montant: connues.reduce((somme, item) => somme + centimes(item.price), 0) / 100,
    complet: connues.length === ajoutees.length,
  };
}

// Le programme ne vend-il plus ce que vend la carte : une activite en plus ou en moins ?
function contenuAdapte(formule, programme) {
  const comprises = new Set([...activitesDeLaFormule(formule)].map(famille));
  const ids = new Set(itemsDu(programme).map((item) => famille(String((item && item.activityId) || ''))).filter(Boolean));
  return [...ids].some((id) => !comprises.has(id)) || [...comprises].some((id) => !ids.has(id));
}

// Le prix de la formule pour ce groupe, au catalogue : par joueur, ou par piste (Crazy Student
// Strike). Sans bowling au programme, une formule a la piste garde les pistes du dossier.
function prixDeLaFormule(formule, dossier, laneCount) {
  const pistes = Math.max(0, Math.trunc(Number(laneCount) || 0))
    || (Array.isArray(dossier.lanes) ? dossier.lanes.length : 0)
    || Math.max(0, Math.trunc(Number(dossier.laneCount) || 0));
  const joueurs = Math.max(1, Math.trunc(Number(dossier.pax) || 1));
  return Number(getBasePrice('formule', Number(dossier.duration) || 0, pistes, joueurs, formule.id, dossier.centerId || 'libramont')) || 0;
}

// LA REFERENCE D UNE FORMULE ADAPTEE : le prix de la formule plus ses activites ajoutees.
function referenceDeLaFormuleAdaptee({ formule, dossier, programme, laneCount }) {
  const prixFormule = prixDeLaFormule(formule, dossier, laneCount);
  const ajouts = ajoutsALaFormule(formule, programme);
  return { prixFormule, ajouts, total: (centimes(prixFormule) + centimes(ajouts.montant)) / 100 };
}

// Le programme decrit-il ce dossier de formule ? Seulement quand son nom porte « (adaptée) » : une
// formule changee pour une autre garde en base le programme de l ancienne (normalizeReservationPayload
// le reprend), et il ne la decrit plus (illimiteDeSaCarte, assets/app-main.js, lit le meme mot).
function programmeDecritLaFormule(dossier) {
  if (!dossier || dossier.type !== 'formule' || !LIBELLE_ADAPTE.test(String(dossier.label || ''))) return false;
  if (!itemsDu(dossier.program).length) return false;
  return Boolean(formuleAdaptable(dossier));
}

// LES PISTES D UNE FORMULE ADAPTEE (lib/database.js reservationNeedsLanes) : son programme les dit, pas
// sa carte. Le bowling ajoute a une Formule 5 en tient ; une Formule 1 sans son bowling n en tient plus
// (la base lui en forcait une, libre au planning). null : le programme ne decrit pas le dossier, la
// carte decide, comme avant.
function pistesDuProgramme(payload) {
  if (!programmeDecritLaFormule(payload)) return null;
  return itemsDu(payload.program).some((item) => item && item.activityId === 'bowling');
}

// UN LASER AJOUTE A UNE FORMULE ADAPTEE dont la carte n en a pas (la Formule 3) : il se lit comme celui
// d une visite. Le plan qui le laisse a placer fait foi, rien ne fabrique ses parties
// (lib/reservation-activity-move.js) ; formulaFallbackLaserBlocks (lib/database.js), qui lit la carte, ne
// lui estime aucune session. Le jumeau de la console : laserAjouteALaFormule, assets/booking-core.js.
function laserAjouteALaFormule(dossier) {
  if (!programmeDecritLaFormule(dossier) || !itemsDu(dossier.program).some((item) => item && item.activityId === 'laser_game')) return false;
  return !activitesDeLaFormule(formuleAdaptable(dossier)).has('laser_game');
}

// LE LASER RETIRE D UNE FORMULE ADAPTEE (la Formule 1 sans son laser) : aucune session ne s estime pour
// lui (formulaFallbackLaserBlocks, lib/database.js), la base ne retient plus ses armes. Le jumeau de la
// console : getFormulaLaserFallbackWindows, assets/booking-core.js.
function laserRetireDeLaFormule(dossier) {
  return programmeDecritLaFormule(dossier) && !itemsDu(dossier.program).some((item) => item && item.activityId === 'laser_game');
}

// CE QUE L ADDITION ET LES MAILS DISENT D UNE FORMULE ADAPTEE. null : le programme ne decrit pas le
// dossier. Sinon, les activites que la formule comprend, et si les ajoutees se paient en plus : la
// reference du dossier le dit, le prix de la formule plus leur montant a 50 centimes pres. Une formule
// adaptee « au meme prix » (la fenetre Reserver avant le 2026-11-21 ; depuis, elle chiffre ses ajouts,
// lib/reserver-fenetre.js chiffrerLaFormuleAdaptee) les comprend dans son prix : elle se lit comme avant.
function lectureDeLaFormuleAdaptee(dossier) {
  if (!programmeDecritLaFormule(dossier)) return null;
  const formule = formuleAdaptable(dossier);
  const reference = referenceDeLaFormuleAdaptee({ formule, dossier, programme: dossier.program });
  const enPlus = reference.ajouts.ajoutees.length > 0
    && Math.abs(centimes(reference.total) - centimes(dossier.basePrice)) <= TOLERANCE_CENTIMES;
  const comprises = activitesDeLaFormule(formule);
  if (formule.toutIllimite) itemsDu(dossier.program).forEach((item) => { if (item && item.activityId && !ETAPES_DE_SERVICE.has(String(item.activityId))) comprises.add(String(item.activityId)); });
  return { formule, comprises, ajouts: reference.ajouts, prixFormule: reference.prixFormule, enPlus };
}

module.exports = {
  LIBELLE_ADAPTE,
  activitesDeLaFormule,
  ajoutsALaFormule,
  contenuAdapte,
  formuleAdaptable,
  laserAjouteALaFormule,
  laserRetireDeLaFormule,
  lectureDeLaFormuleAdaptee,
  pistesDuProgramme,
  programmeDecritLaFormule,
  referenceDeLaFormuleAdaptee,
};

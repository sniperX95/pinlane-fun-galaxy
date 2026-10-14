'use strict';

// LE CHOIX DANS UNE FORMULE (Movsar, 2026-10-13 : la Formule 4 de Fun Galaxy
// se joue avec « 2 parties de Laser Game » ou « 60 min d'arcades » a leur
// place, au meme prix). Une formule declare ses variantes dans son socle
// booking (`choices`, lib/booking-config FORMULES, relayees telles quelles par
// lib/catalog-store) : la premiere est le contenu de sa carte ; chacune des
// autres remplace les etapes de certaines activites (`replaces`) par les
// siennes (`steps`), a la place de la premiere etape remplacee, et dit son
// programme (`desc`). Aucun code ne nomme une formule : la donnee decide.
//
// LA REGLE D OR : sans variante demandee, avec la premiere, ou avec un
// identifiant que la formule ne declare pas, la formule reste LA MEME
// instance. Rien ne change, au caractere pres.
//
// Le plan d une formule jouee avec une variante la garde
// (`opsPlan.formulaChoice`) : de quoi refaire la formule du dossier sans
// relire le catalogue (la garde de la base, le deplacement d une activite,
// la modification au comptoir, la console).

function idDe(valeur) {
  return valeur === undefined || valeur === null ? '' : String(valeur).trim().slice(0, 40);
}

// Les variantes qui s appliquent a ces etapes : deux au moins, des
// identifiants uniques et nommes, et chaque variante autre que la premiere
// remplace des activites que la formule contient vraiment, par des etapes qui
// nomment leur activite. Une seule qui ne tient pas, et la formule n en
// propose aucune : un choix a moitie juste vendrait une formule qui n existe
// pas (un centre qui retire le laser de sa Formule 4 retire aussi le choix).
function choixApplicables(choices, steps) {
  const liste = Array.isArray(choices) ? choices : [];
  if (liste.length < 2) return [];
  const presentes = new Set((Array.isArray(steps) ? steps : []).map((step) => step && step.activityId).filter(Boolean));
  const vus = new Set();
  const valide = liste.every((choix, rang) => {
    const id = choix && typeof choix === 'object' ? idDe(choix.id) : '';
    if (!id || vus.has(id) || !String(choix.label || '').trim()) return false;
    vus.add(id);
    if (rang === 0) return true;
    const remplacees = Array.isArray(choix.replaces) ? choix.replaces : [];
    const etapes = Array.isArray(choix.steps) ? choix.steps : [];
    return remplacees.length > 0 && remplacees.every((activityId) => presentes.has(activityId))
      && etapes.length > 0 && etapes.every((step) => step && typeof step.activityId === 'string' && step.activityId.trim() !== '');
  });
  return valide ? JSON.parse(JSON.stringify(liste)) : [];
}

// Les variantes d une formule, lues au catalogue (format booking). Meme
// resolution que le moteur pour un identifiant deja choisi (lib/ops-knowledge
// getFormula sans centre) : toutes portees confondues.
function variantesDeLaFormule(formulaId) {
  const id = idDe(formulaId);
  if (!id) return [];
  let booking = null;
  try {
    booking = require('./catalog-store').resolveBookingFormuleAnyScope(id);
  } catch (error) {
    booking = null;
  }
  return booking && Array.isArray(booking.choices) && booking.choices.length > 1 ? booking.choices : [];
}

// La variante demandee, quand elle change quelque chose : null sans demande,
// pour la premiere (le contenu de la carte) et pour un identifiant inconnu.
function varianteDemandee(formulaId, choiceId) {
  const voulu = idDe(choiceId);
  if (!voulu) return null;
  const liste = variantesDeLaFormule(formulaId);
  const rang = liste.findIndex((choix) => choix && choix.id === voulu);
  return rang > 0 ? liste[rang] : null;
}

// Ce que le plan garde de la variante.
function empreinteDuChoix(choix) {
  const out = {
    id: idDe(choix.id),
    label: String(choix.label || ''),
    replaces: choix.replaces.map(String),
    steps: choix.steps.map((step) => ({ ...step })),
  };
  if (Array.isArray(choix.desc) && choix.desc.length) out.desc = choix.desc.map(String);
  return out;
}

// La formule jouee avec la variante : les etapes des activites remplacees
// laissent la place aux siennes, a la place de la premiere d entre elles.
// Sans variante, sans rien a remplacer, ou deja jouee (une formule adaptee
// au comptoir la porte deja) : la MEME instance.
function formuleAvecChoix(formula, choix) {
  if (!formula || typeof formula !== 'object' || formula.formulaChoice) return formula;
  if (!choix || !idDe(choix.id) || !Array.isArray(choix.replaces) || !Array.isArray(choix.steps) || !choix.steps.length) return formula;
  const remplacees = new Set(choix.replaces.map(String));
  const etapes = Array.isArray(formula.steps) ? formula.steps : [];
  if (!etapes.some((step) => step && remplacees.has(step.activityId))) return formula;
  const empreinte = empreinteDuChoix(choix);
  const steps = [];
  let posees = false;
  etapes.forEach((step) => {
    if (!step || !remplacees.has(step.activityId)) {
      steps.push(step);
      return;
    }
    if (posees) return;
    posees = true;
    empreinte.steps.forEach((etape) => steps.push({ ...etape }));
  });
  return { ...formula, steps, formulaChoice: empreinte };
}

// La variante que le plan d un dossier garde, bien formee, sinon null.
function choixDuDossier(dossier) {
  const garde = dossier && dossier.opsPlan && dossier.opsPlan.formulaChoice;
  if (!garde || typeof garde !== 'object' || !idDe(garde.id)) return null;
  return Array.isArray(garde.replaces) && Array.isArray(garde.steps) ? garde : null;
}

// LA FORMULE D UN DOSSIER, telle qu il l a achetee : le document du catalogue
// joue avec la variante que son plan garde. Sans elle, le document tel quel.
function formuleDuDossier(formula, dossier) {
  const garde = choixDuDossier(dossier);
  return garde ? formuleAvecChoix(formula, garde) : formula;
}

// L identifiant de variante d une demande : celui qu elle envoie, sinon, pour
// une modification, celui que son plan enregistre garde. Une demande qui
// envoie la premiere variante revient au contenu de la carte.
function choixDeLaDemande(request, { modification = false } = {}) {
  const pref = request && request.preference && typeof request.preference === 'object' ? request.preference : {};
  if (pref.formulaChoice !== undefined && pref.formulaChoice !== null) return idDe(pref.formulaChoice);
  if (!modification) return '';
  const garde = choixDuDossier(request);
  return garde ? idDe(garde.id) : '';
}

module.exports = {
  choixApplicables,
  choixDeLaDemande,
  choixDuDossier,
  formuleAvecChoix,
  formuleDuDossier,
  varianteDemandee,
  variantesDeLaFormule,
};

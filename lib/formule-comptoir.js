// LES FORMULES FAITES AU COMPTOIR (2026-11-05, Ansar : « pouvoir faire formule custom temporaire
// et choisir si on veut garder cette formule genre sauvegarder et choisir si afficher pour les
// clients sur reservation ou pas »).
//
// TEMPORAIRE : un nom et un prix sur UN dossier (program.formuleSurMesure). Rien au catalogue.
//
// GARDEE : une vraie ligne du catalogue (lib/catalog-store.js createFormula), donc le moteur, le
// planning et Tarifs & formules la lisent comme les autres. Le catalogue appartient a la societe,
// mais les centres sont dissocies : elle n existe que pour le centre qui l a faite, et son
// identifiant le dit, sm-<centre>--<nom>. Aucune migration.
//
// AU COMPTOIR SEULEMENT : human_validation vaut 'comptoir'. Le formulaire, la disponibilite
// publique et l agent ne la voient pas (getEffectiveFormules, lib/booking-config.js) ; le moteur
// lit ce mode comme le mode par defaut (modeValidationFormule, lib/validation-policy.js).
'use strict';

const PREFIXE = 'sm-';
const SEPARATEUR = '--';
const MODE_COMPTOIR = 'comptoir';
const FAMILLE = 'Formules sur mesure';
const NOM_MAX = 80;
const PRIX_MAX = 1000;
const LIGNES_MAX = 30;
const DUREE_SERVICE_MINUTES = 5;

// Le centre d une formule gardee, '' pour toute autre formule.
function centreDeLaFormule(id) {
  const texte = String(id ?? '');
  if (!texte.startsWith(PREFIXE)) return '';
  const fin = texte.indexOf(SEPARATEUR, PREFIXE.length);
  return fin > PREFIXE.length ? texte.slice(PREFIXE.length, fin) : '';
}

const estFormuleDuCentre = (id, centerId) => Boolean(centerId) && centreDeLaFormule(id) === String(centerId);
const prefixeDuCentre = (centerId) => `${PREFIXE}${String(centerId)}${SEPARATEUR}`;

function texteSur(valeur, max) {
  return String(valeur ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function refusDeSaisie(message) {
  return Object.assign(new Error(message), { statusCode: 422, expose: true });
}

// Ce que le dossier garde de sa formule temporaire : un nom, et son prix par joueur s il en a un
// (le prix suit alors le groupe, prixQuiSuit). null : pas de formule.
function normaliserFormuleSurMesure(valeur) {
  if (!valeur || typeof valeur !== 'object') return null;
  const nom = texteSur(valeur.nom, NOM_MAX);
  if (!nom) return null;
  const brut = valeur.prixParPersonne;
  const prix = brut === null || brut === undefined || brut === '' ? NaN : Number(brut);
  return { nom, ...(Number.isFinite(prix) && prix >= 0 && prix <= PRIX_MAX ? { prixParPersonne: Math.round(prix * 100) / 100 } : {}) };
}

// Une ligne du ticket, dite comme sur la carte : « Crêpe au sucre par personne », « Pizza × 2 ».
function ligneDite(ligne) {
  const nom = texteSur(ligne && ligne.nom, 80);
  if (!nom) return '';
  const qte = Math.trunc(Number(ligne.qte) || 1);
  return ligne.parPersonne === true ? `${nom} par personne` : qte > 1 ? `${nom} × ${qte}` : nom;
}

// Une activite, dans les mots du catalogue (« 1h de Bowling », « 2 parties Laser Game »).
function activiteDite(activite) {
  const id = String(activite.id);
  if (id === 'bowling') {
    const minutes = Math.trunc(Number(activite.minutes) || 60);
    const reste = minutes % 60;
    return minutes < 60 ? `${minutes} min de Bowling` : `${Math.floor(minutes / 60)}h${reste ? String(reste).padStart(2, '0') : ''} de Bowling`;
  }
  if (id === 'laser_game') {
    const parties = Math.max(1, Math.trunc(Number(activite.parties) || 1));
    return `${parties} partie${parties > 1 ? 's' : ''} Laser Game`;
  }
  if (id === 'minigolf_blacklight') return '1 partie Minigolf';
  if (id === 'arcade_time') return '30 min arcades';
  if (id === 'playground') return 'Plaine de jeux';
  return texteSur(activite.nom, 80);
}

// L ACCES ILLIMITE (2026-11-18, Marius, manager de Gembloux : « un petit team building qui vient,
// ils ont acces a toutes les activites, et donc je ne sais pas choisir ca, je suis oblige de
// choisir chaque activite »). Une formule gardee du centre qui comprend TOUTES ses activites, lues
// au catalogue du centre par le serveur (jamais la liste du navigateur), avec un prix par joueur
// et une duree de visite. Le bowling (1 h) et le laser (1 partie) restent des etapes a heure,
// critiques : le moteur leur pose une heure et retient pistes et arene comme pour toute formule,
// jamais une fenetre ouverte (orderPolicy 'open_window', qui ne retient rien). Les autres se
// jouent a volonte : elles se partagent le reste de la visite, pour que le plan dure ce qui a ete
// vendu. orderPolicy 'illimite' le dit au catalogue ; le moteur ne lit que 'open_window', il la
// planifie donc comme les autres formules.
const ORDRE_ILLIMITE = 'illimite';
const DUREE_ILLIMITEE = Object.freeze({ min: 60, max: 720, pas: 30, defaut: 180 });
const BOWLING_ILLIMITE_MINUTES = 60;
const LASER_ILLIMITE_MINUTES = 30;
const LIBRE_MINIMUM_MINUTES = 5;
const A_HEURE = ['bowling', 'laser_game'];

function dureeIllimiteeLue(brut) {
  const minutes = brut === null || brut === undefined || brut === '' ? DUREE_ILLIMITEE.defaut : Math.trunc(Number(brut));
  if (!Number.isFinite(minutes) || minutes < DUREE_ILLIMITEE.min || minutes > DUREE_ILLIMITEE.max || minutes % DUREE_ILLIMITEE.pas !== 0) {
    throw refusDeSaisie('La durée de la visite va de 1 h à 12 h, par demi-heure.');
  }
  return minutes;
}

function dureeDite(minutes) {
  const reste = minutes % 60;
  return `${Math.floor(minutes / 60)} h${reste ? ` ${String(reste).padStart(2, '0')}` : ''}`;
}

// Les etapes d un acces illimite, dans l ordre du catalogue du centre.
function etapesIllimitees(activitesDuCentre, dureeMinutes) {
  const vendables = (Array.isArray(activitesDuCentre) ? activitesDuCentre : []).filter((a) => a && a.id);
  const bowling = vendables.some((a) => String(a.id) === 'bowling');
  const laser = vendables.some((a) => String(a.id) === 'laser_game');
  const libres = vendables.filter((a) => !A_HEURE.includes(String(a.id)));
  const steps = [];
  if (bowling) steps.push({ activityId: 'bowling', count: 1, durationMinutes: BOWLING_ILLIMITE_MINUTES, critical: true });
  if (laser) steps.push({ activityId: 'laser_game', count: 1, critical: true });
  if (libres.length) {
    const reste = Math.max(libres.length * LIBRE_MINIMUM_MINUTES, dureeMinutes - (bowling ? BOWLING_ILLIMITE_MINUTES : 0) - (laser ? LASER_ILLIMITE_MINUTES : 0));
    const part = Math.floor(reste / libres.length);
    const surplus = reste - part * libres.length;
    libres.forEach((a, rang) => steps.push({ activityId: String(a.id), count: 1, durationMinutes: part + (rang < surplus ? 1 : 0), label: `${texteSur(a.name || a.id, 60)} à volonté` }));
  }
  return steps;
}

// La duree d une visite illimitee, relue sur ses etapes (celles qu etapesIllimitees a ecrites).
function dureeIllimitee(steps) {
  return (Array.isArray(steps) ? steps : []).reduce((total, step) => {
    if (!step || !step.activityId) return total;
    if (step.activityId === 'laser_game') return total + LASER_ILLIMITE_MINUTES * Math.max(1, Math.trunc(Number(step.count) || 1));
    return total + Math.max(0, Math.trunc(Number(step.durationMinutes) || 0));
  }, 0);
}

// Ce que la carte dit d un acces illimite : le mot que la console et le formulaire mettent en
// tete (« Toutes les activités illimitées »), ce qui se joue a heure, le reste, la duree.
function lignesIllimitees(activitesDuCentre, dureeMinutes) {
  const vendables = (Array.isArray(activitesDuCentre) ? activitesDuCentre : []).filter((a) => a && a.id);
  const nom = (a) => texteSur(a.name || a.id, 60);
  const aHeure = [
    vendables.some((a) => String(a.id) === 'bowling') ? 'Bowling 1 h' : '',
    vendables.some((a) => String(a.id) === 'laser_game') ? '1 partie de Laser Game' : '',
  ].filter(Boolean);
  const libres = vendables.filter((a) => !A_HEURE.includes(String(a.id))).map(nom);
  return [
    'Toutes les activités illimitées',
    aHeure.length ? `${aHeure.join(' et ')}, à l’heure réservée` : '',
    libres.length ? `À volonté : ${libres.join(', ')}` : '',
    `${dureeDite(dureeMinutes)} sur place`,
  ].filter(Boolean);
}

// Ce qui se change apres coup, dans Tarifs & formules.
function champsDeFormule(corps = {}) {
  const name = texteSur(corps.nom, NOM_MAX);
  if (!name) throw refusDeSaisie('Donnez un nom à la formule.');
  const brut = corps.prixParPersonne;
  const priceValue = brut === null || brut === undefined || brut === '' ? NaN : Number(brut);
  if (!Number.isFinite(priceValue) || priceValue < 0 || priceValue > PRIX_MAX) throw refusDeSaisie(`Indiquez un prix par joueur entre 0 et ${PRIX_MAX} ${require('./monnaie').signe(require('./monnaie').deviseEnCours())}.`);
  const minPax = Math.trunc(Number(corps.minPax) || 1);
  if (minPax < 1 || minPax > 240) throw refusDeSaisie('Le nombre de joueurs minimum va de 1 à 240.');
  return { name, minPax, priceValue: Math.round(priceValue * 100) / 100 };
}

// La formule telle que createFormula la veut, depuis ce que la fenetre envoie. Les bornes du
// catalogue (activite connue, prix, nom) restent celles de lib/catalog-store.js.
// `activitesDuCentre` : le catalogue vendable du centre (lib/activity-catalog.js
// listCenterActivities), lu par le serveur. Un acces illimite (corps.illimite) le prend tout
// entier et ignore les activites envoyees.
function formuleDepuisLeComptoir(corps = {}, { activitesDuCentre = [] } = {}) {
  if (corps.illimite === true) {
    const champs = champsDeFormule(corps);
    const duree = dureeIllimiteeLue(corps.dureeMinutes);
    const steps = etapesIllimitees(activitesDuCentre, duree);
    if (!steps.length) throw refusDeSaisie('Ce centre n’a encore aucune activité à vendre.');
    return {
      ...champs,
      family: FAMILLE,
      priceType: 'per_pax',
      descriptionLines: lignesIllimitees(activitesDuCentre, duree),
      steps,
      orderPolicy: ORDRE_ILLIMITE,
      humanValidation: corps.clients === true ? null : MODE_COMPTOIR,
    };
  }
  const champs = champsDeFormule(corps);
  const activites = (Array.isArray(corps.activites) ? corps.activites : []).slice(0, 12).filter((a) => a && a.id);
  if (!activites.length) throw refusDeSaisie('Une formule comprend au moins une activité.');
  const steps = activites.map((a) => {
    const id = String(a.id);
    if (id === 'bowling') return { activityId: id, count: 1, durationMinutes: Math.trunc(Number(a.minutes) || 60), critical: true };
    if (id === 'laser_game') return { activityId: id, count: Math.max(1, Math.trunc(Number(a.parties) || 1)), critical: true };
    const minutes = Math.trunc(Number(a.minutes) || 0);
    return { activityId: id, count: 1, ...(minutes > 0 ? { durationMinutes: minutes } : {}) };
  });
  // Ce qui se mange et se boit part en une seule etape de service : son libelle se lit la ou le
  // planning et les mails disent deja « 2 cruches boissons ».
  const compris = (Array.isArray(corps.lignes) ? corps.lignes : []).slice(0, LIGNES_MAX).map(ligneDite).filter(Boolean);
  if (compris.length) steps.push({ activityId: 'service_drinks', count: 1, label: compris.join(', ').slice(0, 200), resourceType: 'bar_service', durationMinutes: DUREE_SERVICE_MINUTES });
  const descriptionLines = [...activites.map(activiteDite).filter(Boolean), ...compris];
  return {
    ...champs,
    family: FAMILLE,
    priceType: 'per_pax',
    descriptionLines,
    steps,
    humanValidation: corps.clients === true ? null : MODE_COMPTOIR,
  };
}

module.exports = {
  DUREE_ILLIMITEE,
  FAMILLE,
  MODE_COMPTOIR,
  ORDRE_ILLIMITE,
  centreDeLaFormule,
  champsDeFormule,
  dureeIllimitee,
  estFormuleDuCentre,
  formuleDepuisLeComptoir,
  normaliserFormuleSurMesure,
  prefixeDuCentre,
};

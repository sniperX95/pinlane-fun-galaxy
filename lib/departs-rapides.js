'use strict';
// LES DEPARTS RAPIDES DE LA FENETRE RESERVER (2026-10-08, lot I2 de la console).
//
// La fenetre ouvre sur les compositions que le centre vend le plus CE jour de
// la semaine (« le samedi, c est bowling 1 h puis laser 2 parties »), plus
// celles que le gerant epingle, et le bouton « Refaire » reprend la derniere
// visite d un client deja venu. Ce module est pur : il lit des lignes deja
// chargees (lib/database.js) et ne decide que de leur forme. Une composition
// est ce qui se REFAIT : le type, la formule et les activites avec leurs
// parties ou leur duree ; jamais le nombre de joueurs, qui change a chaque
// groupe.

const DEPARTS_MAX = 4;
const EPINGLES_MAX = 8;
const ACTIVITES_MAX = 12;
const LIBELLE_MAX = 60;
const ACTIVITE_ID = /^[a-z0-9_]{1,60}$/;
const FORMULE_ID = /^[A-Za-z0-9_-]{1,60}$/;
const TYPES_EPINGLE = new Set(['bowling', 'laser', 'formule', 'visite', 'activite']);
// Ce qui dit la quantite d une activite (parties, heures, minutes, unites).
const QUANTITES = ['duration', 'games', 'minutes', 'units', 'hours'];
// La meme chose, plus les joueurs de la ligne, pour « Refaire ».
const CHAMPS_REFAIRE = [...QUANTITES, 'participants'];

function nombre(valeur) {
  if (valeur === undefined || valeur === null || valeur === '' || typeof valeur === 'boolean') return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

function lignesDuProgramme(program) {
  if (Array.isArray(program)) return program;
  return program && Array.isArray(program.items) ? program.items : [];
}

// Une ligne de programme reduite aux champs demandes : un champ absent reste
// absent (« Refaire » ne doit pas inventer une duree que la ligne n avait pas).
function ligneReduite(item, champs) {
  const activityId = String((item && (item.activityId || item.id)) || '');
  if (!ACTIVITE_ID.test(activityId)) return null;
  const ligne = { activityId };
  champs.forEach((champ) => {
    const valeur = nombre(item[champ]);
    if (valeur !== null && valeur > 0) ligne[champ] = valeur;
  });
  return ligne;
}

// Les parties d un laser seul : celles du programme, sinon celles que le plan
// a comptees, sinon la duree (une partie = 30 minutes, comme la grille). Le
// plan arrive reduit a ce seul nombre (`parties_plan`, du texte : la base le
// projette au lieu de transferer le plan entier).
function partiesLaser(ligne, items) {
  const laser = items.find((item) => item && item.activityId === 'laser_game');
  const duProgramme = laser ? nombre((laser.extraLaser && laser.extraLaser.games) || laser.games) : null;
  if (duProgramme) return duProgramme;
  const duPlan = nombre(ligne.parties_plan);
  if (duPlan) return duPlan;
  const duree = nombre(ligne.duration);
  return duree ? Math.max(1, Math.round(duree * 2)) : null;
}

// LA COMPOSITION D UNE RESERVATION, telle que la fenetre la recompose :
// { type, formuleId?, duration?, laserGames?, pax?, program: [...] }.
function compositionDeReservation(ligne) {
  if (!ligne || typeof ligne !== 'object') return null;
  const type = String(ligne.type || '');
  if (!type) return null;
  const items = lignesDuProgramme(ligne.program);
  const composition = { type };
  const formuleId = String(ligne.formule_id || ligne.formuleId || '');
  if (formuleId) composition.formuleId = formuleId;
  const duree = nombre(ligne.duration);
  if (duree !== null && duree > 0) composition.duration = duree;
  if (type === 'laser') {
    const parties = partiesLaser(ligne, items);
    if (parties) composition.laserGames = parties;
  }
  const pax = nombre(ligne.pax);
  if (pax !== null && pax > 0) composition.pax = Math.trunc(pax);
  composition.program = items.map((item) => ligneReduite(item, CHAMPS_REFAIRE)).filter(Boolean);
  return composition;
}

// La cle qui reconnait deux fois la meme composition : sans les joueurs.
function cleDeComposition(composition) {
  if (!composition) return '';
  const activites = (composition.program || [])
    .map((ligne) => [ligne.activityId, ...QUANTITES.filter((champ) => ligne[champ] != null).map((champ) => `${champ}=${ligne[champ]}`)].join(':'))
    .join(',');
  const quantite = activites
    ? ''
    : composition.type === 'laser' ? `parties=${composition.laserGames || ''}` : `duree=${composition.duration || ''}`;
  return [composition.type, composition.formuleId || '', quantite, activites].join('|');
}

// LES 4 COMPOSITIONS LES PLUS RESERVEES, avec leur compte. Les lignes arrivent
// de la plus recente a la plus ancienne : a egalite de compte, la composition
// vue le plus recemment passe devant, et son libelle le plus frequent la nomme.
function compterDeparts(lignes, { max = DEPARTS_MAX } = {}) {
  const parCle = new Map();
  (Array.isArray(lignes) ? lignes : []).forEach((ligne, rang) => {
    const composition = compositionDeReservation(ligne);
    if (!composition) return;
    const cle = cleDeComposition(composition);
    const entree = parCle.get(cle) || { cle, composition, compte: 0, rang, libelles: new Map() };
    entree.compte += 1;
    const libelle = String(ligne.label || '').trim();
    if (libelle) entree.libelles.set(libelle, (entree.libelles.get(libelle) || 0) + 1);
    parCle.set(cle, entree);
  });
  return [...parCle.values()]
    .sort((a, b) => (b.compte - a.compte) || (a.rang - b.rang))
    .slice(0, Math.max(0, Math.trunc(Number(max) || 0)))
    .map((entree) => {
      const { composition } = entree;
      const libelle = [...entree.libelles.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        cle: entree.cle,
        type: composition.type,
        ...(composition.formuleId ? { formuleId: composition.formuleId } : {}),
        ...(composition.program.length ? {} : composition.duration ? { duration: composition.duration } : {}),
        ...(composition.laserGames && !composition.program.length ? { laserGames: composition.laserGames } : {}),
        activites: composition.program.map((ligne) => ligneReduite(ligne, QUANTITES)).filter(Boolean),
        libelle: libelle ? libelle[0] : '',
        compte: entree.compte,
      };
    });
}

function refusEpingle(message) {
  const error = new Error(message);
  error.statusCode = 422;
  error.expose = true;
  return error;
}

// LES EPINGLES DU GERANT : une liste courte de compositions nommees. Ce qui
// n a pas la forme d une composition est refuse avec son numero, jamais
// corrige en silence : le gerant doit voir ce qui n a pas ete garde.
function normaliserEpingles(liste) {
  if (!Array.isArray(liste)) throw refusEpingle('Épingles invalides : une liste est attendue.');
  if (liste.length > EPINGLES_MAX) throw refusEpingle(`${EPINGLES_MAX} départs épinglés au plus.`);
  return liste.map((brute, index) => {
    const numero = index + 1;
    if (!brute || typeof brute !== 'object' || Array.isArray(brute)) throw refusEpingle(`Épingle n° ${numero} : départ invalide.`);
    const libelle = String(brute.libelle || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIBELLE_MAX);
    if (!libelle) throw refusEpingle(`Épingle n° ${numero} : donnez-lui un nom.`);
    const type = String(brute.type || '');
    if (!TYPES_EPINGLE.has(type)) throw refusEpingle(`Épingle n° ${numero} : type inconnu.`);
    const epingle = { libelle, type };
    const formuleId = String(brute.formuleId || '');
    if (type === 'formule' && !FORMULE_ID.test(formuleId)) throw refusEpingle(`Épingle n° ${numero} : formule manquante.`);
    if (formuleId) {
      if (!FORMULE_ID.test(formuleId)) throw refusEpingle(`Épingle n° ${numero} : formule invalide.`);
      epingle.formuleId = formuleId;
    }
    const duree = nombre(brute.duration);
    if (duree !== null) {
      if (!(duree > 0 && duree <= 12)) throw refusEpingle(`Épingle n° ${numero} : durée invalide.`);
      epingle.duration = duree;
    }
    const parties = nombre(brute.laserGames);
    if (parties !== null) {
      if (!Number.isInteger(parties) || parties < 1 || parties > 12) throw refusEpingle(`Épingle n° ${numero} : de 1 à 12 parties.`);
      epingle.laserGames = parties;
    }
    const pax = nombre(brute.pax);
    if (pax !== null) {
      if (!Number.isInteger(pax) || pax < 1 || pax > 240) throw refusEpingle(`Épingle n° ${numero} : nombre de personnes invalide.`);
      epingle.pax = pax;
    }
    const activites = brute.activites === undefined ? [] : brute.activites;
    if (!Array.isArray(activites) || activites.length > ACTIVITES_MAX) throw refusEpingle(`Épingle n° ${numero} : activités invalides.`);
    epingle.activites = activites.map((item) => {
      const ligne = ligneReduite(item, QUANTITES);
      if (!ligne) throw refusEpingle(`Épingle n° ${numero} : activité inconnue.`);
      if (QUANTITES.some((champ) => ligne[champ] != null && ligne[champ] > 1000)) throw refusEpingle(`Épingle n° ${numero} : quantité invalide.`);
      return ligne;
    });
    if (type === 'visite' && !epingle.activites.length) throw refusEpingle(`Épingle n° ${numero} : une visite porte au moins une activité.`);
    return epingle;
  });
}

module.exports = {
  ACTIVITES_MAX,
  DEPARTS_MAX,
  EPINGLES_MAX,
  cleDeComposition,
  compositionDeReservation,
  compterDeparts,
  normaliserEpingles,
};

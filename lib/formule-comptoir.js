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

// Ce qui se change apres coup, dans Tarifs & formules.
function champsDeFormule(corps = {}) {
  const name = texteSur(corps.nom, NOM_MAX);
  if (!name) throw refusDeSaisie('Donnez un nom à la formule.');
  const brut = corps.prixParPersonne;
  const priceValue = brut === null || brut === undefined || brut === '' ? NaN : Number(brut);
  if (!Number.isFinite(priceValue) || priceValue < 0 || priceValue > PRIX_MAX) throw refusDeSaisie(`Indiquez un prix par joueur entre 0 et ${PRIX_MAX} €.`);
  const minPax = Math.trunc(Number(corps.minPax) || 1);
  if (minPax < 1 || minPax > 240) throw refusDeSaisie('Le nombre de joueurs minimum va de 1 à 240.');
  return { name, minPax, priceValue: Math.round(priceValue * 100) / 100 };
}

// La formule telle que createFormula la veut, depuis ce que la fenetre envoie. Les bornes du
// catalogue (activite connue, prix, nom) restent celles de lib/catalog-store.js.
function formuleDepuisLeComptoir(corps = {}) {
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
  FAMILLE,
  MODE_COMPTOIR,
  centreDeLaFormule,
  champsDeFormule,
  estFormuleDuCentre,
  formuleDepuisLeComptoir,
  normaliserFormuleSurMesure,
  prefixeDuCentre,
};

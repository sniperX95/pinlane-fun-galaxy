// LA FENETRE RESERVER INTERROGE LE MOTEUR (2026-10-08, lot I2 de la console).
//
// Movsar sur la maquette v5 : l horloge doit dire ce qui tient POUR CE GROUPE
// (« deux points par heure, :00 et :30 »), le planning tranche avant la
// creation, et « tout doit suivre ». Ce module ne decide rien : il prepare des
// corps de demande et lit le verdict du MEME moteur que la creation
// (prepareReservationOps). Les fonctions sont pures ; l appelant fournit la
// planification (api/staff-reservations.js), sur une journee lue UNE fois.

const GRILLE_MINUTES = 30;
const CANDIDATS_MAX = 48;

function minutesDe(heure) {
  const trouve = /^(\d{1,2}):(\d{2})/.exec(String(heure || ''));
  if (!trouve) return null;
  const h = Number(trouve[1]);
  const m = Number(trouve[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function heureDe(minutes) {
  const total = Math.round(Number(minutes));
  if (!Number.isFinite(total) || total < 0 || total >= 24 * 60) return '';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// UNE HEURE DECALEE, ou '' si elle sort de la journee : un decalage ne doit
// jamais fabriquer une heure fausse (« 24:30 ») que le moteur lirait de travers.
function decalerHeure(valeur, ecart) {
  if (!valeur) return valeur;
  const base = minutesDe(valeur);
  if (base === null) return valeur;
  return heureDe(base + ecart);
}

// Le corps tel que la fenetre l enverrait si le staff avait choisi une autre
// heure de depart : TOUT l enchainement glisse du meme ecart (heure de depart,
// heure de chaque activite, heure de chaque partie de laser), rien d autre ne
// change. C est la regle de visitAnchorTimes appliquee avant la creation.
function decalerCorps(corps = {}, ecart = 0) {
  const copie = JSON.parse(JSON.stringify(corps || {}));
  if (!ecart) return copie;
  if (copie.startTime) copie.startTime = decalerHeure(copie.startTime, ecart);
  const preference = copie.preference && typeof copie.preference === 'object' ? copie.preference : null;
  if (preference) {
    if (preference.preferredTimes && typeof preference.preferredTimes === 'object') {
      Object.keys(preference.preferredTimes).forEach((cle) => {
        preference.preferredTimes[cle] = decalerHeure(preference.preferredTimes[cle], ecart);
      });
    }
    if (Array.isArray(preference.laserGameTimes)) {
      preference.laserGameTimes = preference.laserGameTimes.map((heure) => decalerHeure(heure, ecart));
    }
  }
  return copie;
}

// Les heures a essayer : sur la grille du moteur, dedoublonnees, bornees.
// Une heure hors grille n est pas « essayee puis refusee » : elle est ecartee
// a l entree, le moteur la refuserait pour une raison qui n a rien a voir avec
// la place disponible.
function candidatsValides(liste) {
  const vus = new Set();
  const sortie = [];
  (Array.isArray(liste) ? liste : []).forEach((valeur) => {
    const minutes = minutesDe(valeur);
    if (minutes === null || minutes % GRILLE_MINUTES !== 0) return;
    const heure = heureDe(minutes);
    if (!heure || vus.has(heure) || sortie.length >= CANDIDATS_MAX) return;
    vus.add(heure);
    sortie.push(heure);
  });
  return sortie;
}

// LE VERDICT D UN PLAN, dans les mots de l horloge. « ko » : le moteur n a pas
// de plan sur (place, fermeture, ancre refusee) et dit pourquoi ; « partage » :
// le plan tient mais une partie de laser se joue avec un autre groupe ; « ok » :
// tout tient, l arene a vous. L avertissement du moteur voyage tel quel.
function verdictDuPlan(ops = {}, dossier = {}) {
  const plan = dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : null;
  if (!plan || ops.planAvailable === false) {
    return { statut: 'ko', raison: String(ops.planRefusal || ops.planWarning || 'Pas de plan possible à cette heure.') };
  }
  const blocs = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const partagees = blocs.filter((bloc) => bloc && bloc.resourceType === 'laser_arena'
    && (bloc.sharedSession || Number(bloc.playersBefore) > 0));
  if (partagees.length) {
    const autres = Math.max(...partagees.map((bloc) => Number(bloc.playersBefore) || 0));
    return { statut: 'partage', raison: autres > 0 ? `Partie partagée avec ${autres} joueur${autres > 1 ? 's' : ''}.` : 'Partie partagée avec un autre groupe.' };
  }
  return { statut: 'ok', raison: '' };
}

// LES CANDIDATS, l un apres l autre, sur la MEME journee. `planifier(corps)`
// rend { ops, dossier } ; une erreur sur une heure ne casse pas les autres :
// elle devient un « ko » qui dit l erreur, jamais un « ok » par defaut.
async function simulerCandidats({ corps, candidats, planifier, finDuPlan }) {
  const base = minutesDe(corps && corps.startTime);
  if (base === null) throw Object.assign(new Error('Heure de départ manquante pour essayer d’autres heures.'), { expose: true, statusCode: 422 });
  const heures = candidatsValides(candidats);
  const resultats = [];
  for (const heure of heures) {
    const ecart = minutesDe(heure) - base;
    try {
      const { ops, dossier } = await planifier(decalerCorps(corps, ecart));
      const verdict = verdictDuPlan(ops, dossier);
      resultats.push({ heure, ...verdict, fin: verdict.statut === 'ko' || typeof finDuPlan !== 'function' ? '' : finDuPlan(dossier.opsPlan) });
    } catch (error) {
      resultats.push({ heure, statut: 'ko', raison: String((error && error.message) || 'Erreur du moteur.'), fin: '' });
    }
  }
  return resultats;
}

module.exports = {
  CANDIDATS_MAX,
  candidatsValides,
  decalerCorps,
  decalerHeure,
  heureDe,
  minutesDe,
  simulerCandidats,
  verdictDuPlan,
};

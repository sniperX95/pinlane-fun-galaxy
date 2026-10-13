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

// LES CONFLITS QUI RENDENT UNE HEURE IMPOSSIBLE. « plan » (le moteur n a pas
// de plan) et « arene » (l arene demandee pour le groupe seul est deja
// occupee : la base refuserait la creation) ferment l heure. « pistes » (une
// piste choisie est prise, le plan en prend une autre) la laisse ouverte :
// l ecran la montre en orange avec sa raison.
const CONFLITS_BLOQUANTS = new Set(['plan', 'arene']);

// LE VERDICT D UN PLAN, dans les mots de l horloge. « ko » : le moteur n a pas
// de plan sur (place, fermeture, ancre refusee) et dit pourquoi ; « partage » :
// le plan tient mais une partie de laser se joue avec un autre groupe ; « ok » :
// tout tient, l arene a vous. L avertissement du moteur voyage tel quel.
function verdictDuPlan(ops = {}, dossier = {}, conflits = []) {
  const plan = dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : null;
  if (!plan || ops.planAvailable === false) {
    return { statut: 'ko', raison: String(ops.planRefusal || ops.planWarning || 'Pas de plan possible à cette heure.') };
  }
  const bloquant = (Array.isArray(conflits) ? conflits : []).find((conflit) => conflit && CONFLITS_BLOQUANTS.has(conflit.type));
  if (bloquant) return { statut: 'ko', raison: String(bloquant.message || 'Pas de plan possible à cette heure.') };
  const blocs = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const partagees = blocs.filter((bloc) => bloc && bloc.resourceType === 'laser_arena'
    && (bloc.sharedSession || Number(bloc.playersBefore) > 0));
  if (partagees.length) {
    const autres = Math.max(...partagees.map((bloc) => Number(bloc.playersBefore) || 0));
    return { statut: 'partage', raison: autres > 0 ? `Partie partagée avec ${autres} joueur${autres > 1 ? 's' : ''}.` : 'Partie partagée avec un autre groupe.' };
  }
  return { statut: 'ok', raison: '' };
}

// UNE VARIANTE DE L HORLOGE (2026-10-08, complement du coordinateur). La
// fenetre essaie une heure avec SES choix pour cette heure-la (ses parties de
// laser, ses pistes, son nombre de pistes), pas seulement l enchainement
// decale : `{ heure, startTime, preference, lanes, laneCount }`. Seuls ces
// quatre champs, et seulement ceux que la variante porte, remplacent ceux du
// corps de base ; tout autre champ est ignore, sans erreur.
const CHAMPS_VARIANTE = ['startTime', 'preference', 'lanes', 'laneCount'];

function estVariante(entree) {
  return Boolean(entree) && typeof entree === 'object' && !Array.isArray(entree);
}

function corpsDeLaVariante(corps, variante) {
  const copie = JSON.parse(JSON.stringify(corps || {}));
  CHAMPS_VARIANTE.forEach((champ) => {
    if (!Object.prototype.hasOwnProperty.call(variante, champ)) return;
    if (variante[champ] === undefined) delete copie[champ];
    else copie[champ] = JSON.parse(JSON.stringify(variante[champ]));
  });
  return copie;
}

// Pourquoi une variante ne peut pas etre essayee, ou '' si elle le peut.
function refusDeLaVariante(variante, minutes) {
  if (minutes === null) return 'Heure manquante ou invalide pour cette variante.';
  if (minutes % GRILLE_MINUTES !== 0) return `Heure hors grille : ${heureDe(minutes)} (les départs se font à :00 et :30).`;
  const a = (champ) => Object.prototype.hasOwnProperty.call(variante, champ) && variante[champ] !== undefined;
  if (a('startTime') && minutesDe(variante.startTime) === null) return 'Heure de départ invalide pour cette variante.';
  if (a('preference') && !estVariante(variante.preference)) return 'Préférences invalides pour cette variante.';
  if (a('lanes') && !Array.isArray(variante.lanes)) return 'Pistes invalides pour cette variante.';
  if (a('laneCount')) {
    const nombre = Number(variante.laneCount);
    if (!Number.isInteger(nombre) || nombre < 0 || nombre > 50) return 'Nombre de pistes invalide pour cette variante.';
  }
  return '';
}

// Les essais, dans l ordre recu, bornes a CANDIDATS_MAX. Une chaine est une
// heure de la grille (tout l enchainement glisse, une heure hors grille est
// ecartee) ; un objet est une variante, et une variante invalide devient un
// essai refuse qui dit pourquoi, jamais une erreur pour tout l envoi.
function preparerEssais(corps, candidats) {
  const essais = [];
  const vues = new Set();
  let base;
  (Array.isArray(candidats) ? candidats : []).forEach((entree) => {
    if (essais.length >= CANDIDATS_MAX) return;
    if (estVariante(entree)) {
      const minutes = minutesDe(entree.heure);
      const refus = refusDeLaVariante(entree, minutes);
      const heure = minutes === null ? String(entree.heure == null ? '' : entree.heure).slice(0, 5) : heureDe(minutes);
      essais.push(refus ? { heure, refus } : { heure, corps: corpsDeLaVariante(corps, entree) });
      return;
    }
    const minutes = minutesDe(entree);
    if (minutes === null || minutes % GRILLE_MINUTES !== 0) return;
    const heure = heureDe(minutes);
    if (!heure || vues.has(heure)) return;
    if (base === undefined) base = minutesDe(corps && corps.startTime);
    if (base === null) throw Object.assign(new Error('Heure de départ manquante pour essayer d’autres heures.'), { expose: true, statusCode: 422 });
    vues.add(heure);
    essais.push({ heure, corps: decalerCorps(corps, minutes - base) });
  });
  return essais;
}

// LES CANDIDATS, l un apres l autre, sur la MEME journee. `planifier(corps)`
// rend { ops, dossier, conflits } ; une erreur sur une heure ne casse pas les
// autres : elle devient un « ko » qui dit l erreur, jamais un « ok » par
// defaut. Chaque resultat porte ses conflits (eventuellement aucun) : une
// piste choisie prise a cette heure ne ferme pas l heure, mais se dit.
async function simulerCandidats({ corps, candidats, planifier, finDuPlan }) {
  const aucuneVariante = !(Array.isArray(candidats) && candidats.some(estVariante));
  if (aucuneVariante && minutesDe(corps && corps.startTime) === null) {
    throw Object.assign(new Error('Heure de départ manquante pour essayer d’autres heures.'), { expose: true, statusCode: 422 });
  }
  const essais = preparerEssais(corps, candidats);
  const resultats = [];
  for (const essai of essais) {
    const { heure } = essai;
    if (essai.refus) {
      resultats.push({ heure, statut: 'ko', raison: essai.refus, fin: '', conflits: [] });
      continue;
    }
    try {
      const { ops, dossier, conflits } = await planifier(essai.corps);
      const liste = Array.isArray(conflits) ? conflits : [];
      const verdict = verdictDuPlan(ops, dossier, liste);
      // La fin de la VISITE, pas du dernier bloc (finDeLaVisite, 2026-10-13) :
      // le dossier porte le programme et ses activites sans heure.
      resultats.push({ heure, ...verdict, fin: verdict.statut === 'ko' || typeof finDuPlan !== 'function' ? '' : finDuPlan(dossier.opsPlan, dossier), conflits: liste });
    } catch (error) {
      resultats.push({ heure, statut: 'ko', raison: String((error && error.message) || 'Erreur du moteur.'), fin: '', conflits: [] });
    }
  }
  return resultats;
}

module.exports = {
  CANDIDATS_MAX,
  CHAMPS_VARIANTE,
  CONFLITS_BLOQUANTS,
  candidatsValides,
  corpsDeLaVariante,
  decalerCorps,
  decalerHeure,
  heureDe,
  minutesDe,
  simulerCandidats,
  verdictDuPlan,
};

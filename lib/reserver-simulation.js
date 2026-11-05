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

// LE MOT DE L HEURE (2026-11-03, Movsar : « quand ya des heures impossible ça affiche
// direct sur lheure comme ça on sait »). Deux ou trois mots du metier pour l heure
// refusee, tires des faits que le moteur pose sur ses conflits : ce qui manque
// (« 1 piste sur 2 », « 3 armes sur 8 »), « complet » quand il ne reste rien, « arène
// prise », « bloqué ». Sans ces faits, le motif de la phrase du moteur (« fermé », « trop
// tard », « dès 14:00 »), et « impossible » en dernier : jamais une raison que le moteur
// n a pas donnee. La phrase entiere reste dans `raison` ; `activite` dit ce qui coince
// (l ecran le nomme quand ce n est pas l activite de l heure touchee).
const ACTIVITE_DU_CONFLIT = { bowling_conflict: 'bowling', laser_conflict: 'laser_game', arene: 'laser_game' };

function compte(nombre, mot) {
  return `${nombre} ${mot}${nombre > 1 ? 's' : ''}`;
}

function motDuConflit(conflit) {
  if (!conflit) return '';
  if (conflit.bloque === true) return 'bloqué';
  const entier = (valeur) => (Number.isFinite(Number(valeur)) ? Math.max(0, Math.trunc(Number(valeur))) : null);
  if (conflit.type === 'bowling_conflict' && entier(conflit.libres) !== null && entier(conflit.voulues) > 0) {
    return entier(conflit.libres) ? `manque ${compte(Math.max(1, entier(conflit.voulues) - entier(conflit.libres)), 'piste')}` : 'complet';
  }
  if (conflit.type === 'laser_conflict' && entier(conflit.reste) !== null && entier(conflit.groupe) > 0) {
    return entier(conflit.reste) ? `manque ${compte(Math.max(1, entier(conflit.groupe) - entier(conflit.reste)), 'arme')}` : 'complet';
  }
  if (conflit.arenePrise === true || conflit.type === 'arene') return 'arène prise';
  return '';
}

// Les motifs des phrases du moteur (lib/ops-engine.js), dans l ordre ou ils se
// lisent : le premier qui tient donne le mot.
const MOTIFS_DU_MOTEUR = [
  [/blocage/i, () => 'bloqué'],
  [/arène laser déjà prise/i, () => 'arène prise'],
  [/il reste (\d+) places? sur \d+, il en faut (\d+)/i, (m) => `manque ${compte(Math.max(1, Number(m[2]) - Number(m[1])), 'arme')}`],
  [/plus aucune place|complet/i, () => 'complet'],
  [/pas assez de pistes/i, () => 'pistes prises'],
  [/centre est fermé|fermé à cette date/i, () => 'fermé'],
  [/déjà passée/i, () => 'déjà passée'],
  [/commence à partir de (\d{1,2}:\d{2})|commencer après (\d{1,2}:\d{2})/i, (m) => `dès ${m[1] || m[2]}`],
  [/terminer avant (\d{1,2}:\d{2})/i, (m) => `fin avant ${m[1]}`],
  [/trop tard|fin après|avant la fermeture|plus le temps/i, () => 'trop tard'],
  [/hors horaires|aucun départ possible/i, () => 'hors horaires'],
  [/chevauch/i, () => 'groupe occupé'],
  [/vacances|jours fériés/i, () => 'pas en vacances'],
  [/indisponible ce jour/i, () => 'pas ce jour'],
  [/désactivée/i, () => 'désactivée'],
  [/minimum (\d+)/i, (m) => `dès ${m[1]} joueurs`],
];

function motCourtDuRefus({ raison = '', conflits = [] } = {}) {
  const texte = String(raison || '');
  const bloquants = (Array.isArray(conflits) ? conflits : [])
    .filter((conflit) => conflit && (conflit.severity === 'blocking' || CONFLITS_BLOQUANTS.has(conflit.type)));
  const parSesFaits = (conflit) => {
    const mot = motDuConflit(conflit);
    return mot ? { court: mot, activite: ACTIVITE_DU_CONFLIT[conflit.type] || '' } : null;
  };
  // D abord le conflit dont le moteur a fait sa raison, puis le motif de la phrase,
  // puis le premier conflit bloquant qui a ses faits.
  const dit = bloquants.find((conflit) => conflit.message && texte.startsWith(String(conflit.message).split(' :')[0]));
  const motif = MOTIFS_DU_MOTEUR.map(([forme, dire]) => { const trouve = forme.exec(texte); return trouve ? dire(trouve) : ''; }).find(Boolean);
  const activite = /^bowling|pistes?\b/i.test(texte) ? 'bowling' : /^laser|arène/i.test(texte) ? 'laser_game' : '';
  return (dit && parSesFaits(dit))
    || (motif ? { court: motif, activite } : null)
    || bloquants.map(parSesFaits).find(Boolean)
    || { court: 'impossible', activite };
}

// Ce qui coince, activite par activite, avec son mot : une visite dont le bowling ne tient
// pas a 16:30 refuse aussi chaque heure du laser ; l ecran ne redit pas sous chacune ce qui
// coince deja au ticket, il lit ce que CETTE heure change.
function bloquantsParActivite(conflits = []) {
  const vus = new Map();
  (Array.isArray(conflits) ? conflits : []).forEach((conflit) => {
    if (!conflit || !(conflit.severity === 'blocking' || CONFLITS_BLOQUANTS.has(conflit.type))) return;
    const activite = ACTIVITE_DU_CONFLIT[conflit.type] || '';
    const court = motDuConflit(conflit);
    if (activite && court && !vus.has(activite)) vus.set(activite, { activite, court, raison: String(conflit.message || '') });
  });
  return [...vus.values()];
}

// UN REFUS, avec sa phrase, son mot et ce qui coince activite par activite.
function refusDHeure(raison, conflits = []) {
  const texte = String(raison || 'Pas de plan possible à cette heure.');
  return { statut: 'ko', raison: texte, ...motCourtDuRefus({ raison: texte, conflits }), bloquants: bloquantsParActivite(conflits) };
}

// LE VERDICT D UN PLAN, dans les mots de l horloge. « ko » : le moteur n a pas
// de plan sur (place, fermeture, ancre refusee) et dit pourquoi, en une phrase
// et en deux ou trois mots (refusDHeure) ; « partage » : le plan tient mais une
// partie de laser se joue avec un autre groupe ; « ok » : tout tient, l arene a
// vous. L avertissement du moteur voyage tel quel.
function verdictDuPlan(ops = {}, dossier = {}, conflits = []) {
  const plan = dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : null;
  const duMoteur = plan && Array.isArray(plan.conflicts) ? plan.conflicts : [];
  if (!plan || ops.planAvailable === false) {
    return refusDHeure(ops.planRefusal || ops.planWarning, duMoteur);
  }
  const bloquant = (Array.isArray(conflits) ? conflits : []).find((conflit) => conflit && CONFLITS_BLOQUANTS.has(conflit.type));
  if (bloquant) return refusDHeure(bloquant.message, [bloquant, ...duMoteur]);
  const blocs = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const partagees = blocs.filter((bloc) => bloc && bloc.resourceType === 'laser_arena'
    && (bloc.sharedSession || Number(bloc.playersBefore) > 0));
  if (partagees.length) {
    const autres = Math.max(...partagees.map((bloc) => Number(bloc.playersBefore) || 0));
    return { statut: 'partage', raison: autres > 0 ? `Partie partagée avec ${autres} joueur${autres > 1 ? 's' : ''}.` : 'Partie partagée avec un autre groupe.' };
  }
  return { statut: 'ok', raison: '' };
}

// Ce que le plan d une heure prend, bloc par bloc (2026-11-05) : la fenetre dit ce qui
// restera a cette heure, avec la meme journee que sur ses blocs bowling et laser.
function ceQuePrendLePlan(plan) {
  const blocs = plan && Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  return blocs.flatMap((bloc) => {
    if (bloc && bloc.resourceType === 'bowling_lane') return [{ t: 'piste', d: bloc.startTime, f: bloc.endTime, n: (bloc.lanes || []).length }];
    if (bloc && bloc.resourceType === 'laser_arena') return [{ t: 'arme', d: bloc.startTime, f: bloc.endTime, n: Number(bloc.players) || 0 }];
    return [];
  });
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
      resultats.push({ heure, ...refusDHeure(essai.refus), fin: '', conflits: [] });
      continue;
    }
    try {
      const { ops, dossier, conflits } = await planifier(essai.corps);
      const liste = Array.isArray(conflits) ? conflits : [];
      const verdict = verdictDuPlan(ops, dossier, liste);
      // La fin de la VISITE, pas du dernier bloc (finDeLaVisite, 2026-10-13) :
      // le dossier porte le programme et ses activites sans heure.
      resultats.push({ heure, ...verdict, fin: verdict.statut === 'ko' || typeof finDuPlan !== 'function' ? '' : finDuPlan(dossier.opsPlan, dossier), conflits: liste, prend: verdict.statut === 'ko' ? [] : ceQuePrendLePlan(dossier.opsPlan) });
    } catch (error) {
      resultats.push({ heure, ...refusDHeure((error && error.message) || 'Erreur du moteur.'), fin: '', conflits: [] });
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
  motCourtDuRefus,
  simulerCandidats,
  verdictDuPlan,
};

// TOUT LE GROUPE, DU MEME ECART (2026-11-23, Ansar devant la pop-up de l heure d un groupe : « il y a
// pas 15h, 15h30 parce que les autres activites sont a ces heures-la ; mais c est con, parce que si on
// veut tout avancer de 30 minutes, on peut pas »).
//
// Decaler tout le groupe, c est decaler toute sa visite d un bloc : son arrivee, l accueil, chaque
// activite, les transitions, la table et les boissons, du meme nombre de minutes. Leur place les unes
// par rapport aux autres ne change pas : une heure que les propres activites du groupe tenaient n est
// donc jamais un conflit. Ce qui se juge, c est la place de chaque activite a sa nouvelle heure, par le
// controle du glisser du planning (buildActivityMove a la minute : les horaires du jour, ceux de la
// formule ; puis `valider`, validateActivityMoveResources contre la journee : pistes, armes, fermetures,
// blocages), sans poser le groupe sur la place d un groupe qui joue (sansLesGroupesQuiJouent) ni caler
// une partie de laser en silence sur celle d un autre groupe (partieACaler). Les pistes du groupe
// restent les siennes ; prises a la nouvelle heure, il prend celles que la regle partagee choisit sur
// cette plage (tenirLeBowling). Une activite qui ne tient pas arrete tout : rien ne s ecrit, et son
// refus porte l activite et l heure qui coincent (`cleDuDeplacement`, `heureDuDeplacement`).
//   - lireDecalage, lireEcarts : le corps recu, sa forme seulement ;
//   - etapesDuDecalage : chaque activite a heure du groupe (activitesAHeure, la liste du retard) et sa
//     nouvelle heure ;
//   - decalerLeGroupe : le dossier decale, juge activite par activite ; l ecriture (lib/database.js,
//     ecrireLeGroupeDecale) et le calcul a blanc (api/staff-reservations.js, decalerABlanc) passent par
//     lui, sur la journee qu ils ont lue.
'use strict';

const ECART_MAX = 12 * 60;
const ECARTS_A_BLANC_MAX = 64;
const JOUR = 24 * 60;

function refus(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}
function minuteDe(valeur) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(valeur || '').slice(0, 5));
  return m && Number(m[1]) < 48 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
function heureDe(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function bord(block, nom) {
  if (block[`${nom}Time`]) return minuteDe(block[`${nom}Time`]);
  const valeur = Number(block[nom]);
  return Number.isFinite(valeur) ? Math.round(valeur <= 48 ? valeur * 60 : valeur) : NaN;
}

// L ecart, en minutes : jamais nul, au plus douze heures. `pistes` (facultatif) : les pistes que le
// bowling doit reprendre, celles d avant quand « Annuler » remet le groupe.
function lireEcart(valeur) {
  const ecart = Number(valeur);
  if (!Number.isInteger(ecart) || ecart === 0 || Math.abs(ecart) > ECART_MAX) throw refus('Choisissez un décalage valide : quelques minutes, au plus douze heures.', 400);
  return ecart;
}
function lireDecalage(corps) {
  const c = corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : null;
  if (!c) throw refus('Décalage du groupe invalide.', 400);
  const ecart = lireEcart(c.ecart);
  let pistes = null;
  if (c.pistes != null) {
    if (!Array.isArray(c.pistes) || !c.pistes.length || c.pistes.length > 24 || c.pistes.some((p) => !Number.isInteger(p) || p < 1 || p > 99) || new Set(c.pistes).size !== c.pistes.length) throw refus('Pistes du décalage invalides.', 400);
    pistes = c.pistes.slice().sort((a, b) => a - b);
  }
  return { ecart, pistes };
}
// Les ecarts que la pop-up demande a blanc : un par heure a essayer.
function lireEcarts(corps) {
  const c = corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : null;
  if (!c || !Array.isArray(c.ecarts) || !c.ecarts.length || c.ecarts.length > ECARTS_A_BLANC_MAX) throw refus('Décalage du groupe invalide.', 400);
  return c.ecarts.map(lireEcart);
}

// Les pistes que tient le bowling du groupe : celles de ses blocs (la meme lecture que buildActivityMove).
function pistesDuBowling(dossier) {
  const blocs = Array.isArray(dossier && dossier.opsPlan && dossier.opsPlan.resourceBlocks) ? dossier.opsPlan.resourceBlocks : [];
  return [...new Set(blocs.filter((b) => b && b.resourceType === 'bowling_lane').flatMap((b) => (Array.isArray(b.lanes) ? b.lanes : [])).map(Number))].sort((a, b) => a - b);
}

// CHAQUE ACTIVITE A HEURE DU GROUPE ET SA NOUVELLE HEURE, dans l ordre de la visite : le bowling (toutes
// ses pistes), chaque partie de laser, chaque autre activite a heure (sa premiere etape : ses etapes
// bougent du meme ecart). Ni la table, ni les boissons, ni la plaine : elles suivent avec le plan, sans
// place a juger. Un acces a volonte garde ses pistes et ses armes toute la visite : il se decale par
// Modifier.
function etapesDuDecalage(current, ecart, pistes = null) {
  const { activitesAHeure } = require('./retard-arrivee');
  if (!current || current.status === 'cancelled') throw refus('Cette réservation est annulée.');
  const plan = current.opsPlan && typeof current.opsPlan === 'object' ? current.opsPlan : {};
  const blocs = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  if (blocs.some((b) => b && b.aVolonte)) throw refus('Un accès à volonté garde ses pistes et ses armes toute la visite : changez son heure par Modifier.');
  const arrivee = minuteDe(current.startTime);
  if (!Number.isFinite(arrivee)) throw refus('L’heure de ce dossier est illisible : actualisez le planning.');
  if (arrivee + ecart < 0 || arrivee + ecart >= JOUR) throw refus('Tout le groupe ne change pas de jour d’ici : passez par Modifier.');
  const frise = Array.isArray(plan.timeline) ? plan.timeline : [];
  const etapes = activitesAHeure(current).map((etape) => {
    let debut = etape.debut;
    let move;
    if (etape.activityId === 'bowling') {
      const leurs = pistesDuBowling(current);
      if (!leurs.length) throw refus('Les pistes de ce groupe sont encore à attribuer : changez son heure par Modifier.');
      const voulues = pistes && pistes.length === leurs.length ? pistes : leurs;
      move = { activityId: 'bowling', startTime: heureDe(debut + ecart), lanes: voulues };
    } else if (etape.activityId === 'laser_game') {
      move = { activityId: 'laser_game', unitKey: etape.unitKey, startTime: heureDe(debut + ecart) };
    } else {
      // (ses etapes a heure bougent du meme ecart depuis la premiere : celle d ou buildActivityMove part)
      const leurs = frise.filter((b) => b && b.type === 'activity' && b.flexible !== true && String(b.activityId || '') === etape.activityId)
        .map((b) => [bord(b, 'start'), bord(b, 'end')]).filter(([a, z]) => Number.isFinite(a) && Number.isFinite(z) && z > a);
      if (leurs.length) debut = Math.min(...leurs.map(([a]) => a));
      move = { activityId: etape.activityId, startTime: heureDe(debut + ecart) };
    }
    if (debut + ecart < 0 || debut + ecart >= 2 * JOUR) throw refus('Tout le groupe ne change pas de jour d’ici : passez par Modifier.');
    return { cle: etape.cle, activityId: etape.activityId, avant: debut, apres: debut + ecart, duree: Math.max(1, etape.fin - etape.debut), move };
  });
  if (!etapes.length) throw refus('Ce groupe n’a aucune activité à heure à décaler.');
  return etapes;
}

// LE PLAN DECALE D UN BLOC : chaque bloc et chaque etape de la frise (l accueil, les transitions, la
// table, les boissons, les activites), et les heures du plan qui disent la visite et l arrivee. Les
// durees ne changent pas. Le reste du plan (ce que le client a vu, le retard note) reste tel quel,
// comme un glisser le laisse.
function decalerUneHeure(texte, ecart) {
  const m = minuteDe(texte);
  return Number.isFinite(m) ? heureDe(m + ecart) : texte;
}
function decalerUnBloc(bloc, ecart) {
  if (!bloc || typeof bloc !== 'object') return bloc;
  const debut = bord(bloc, 'start');
  if (!Number.isFinite(debut)) return bloc;
  const fin = bord(bloc, 'end');
  return {
    ...bloc,
    start: debut + ecart,
    startTime: heureDe(debut + ecart),
    ...(Number.isFinite(fin) ? { end: fin + ecart, endTime: heureDe(fin + ecart) } : {}),
  };
}
function decalerLesHeures(objet, ecart, champs) {
  if (!objet || typeof objet !== 'object' || Array.isArray(objet)) return objet;
  const sortie = { ...objet };
  champs.forEach((champ) => { if (typeof sortie[champ] === 'string') sortie[champ] = decalerUneHeure(sortie[champ], ecart); });
  return sortie;
}
function planDecale(plan, ecart) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return plan;
  const sortie = decalerLesHeures(plan, ecart, ['startTime', 'endTime', 'firstBowlingTime', 'firstLaserTime', 'arrivalTime']);
  if (Array.isArray(plan.resourceBlocks)) sortie.resourceBlocks = plan.resourceBlocks.map((b) => decalerUnBloc(b, ecart));
  if (Array.isArray(plan.timeline)) sortie.timeline = plan.timeline.map((b) => decalerUnBloc(b, ecart));
  if (plan.anchorPlan && typeof plan.anchorPlan === 'object') {
    sortie.anchorPlan = decalerLesHeures(plan.anchorPlan, ecart, ['arrivalTime', 'arcadeTime']);
    if (plan.anchorPlan.times && typeof plan.anchorPlan.times === 'object') sortie.anchorPlan.times = decalerLesHeures(plan.anchorPlan.times, ecart, Object.keys(plan.anchorPlan.times));
  }
  if (plan.arrivalPlan && typeof plan.arrivalPlan === 'object') sortie.arrivalPlan = decalerLesHeures(plan.arrivalPlan, ecart, ['arrivalTime', 'arcadeTime']);
  if (plan.laserPassPlan && Array.isArray(plan.laserPassPlan.scheduledPasses)) {
    sortie.laserPassPlan = { ...plan.laserPassPlan, scheduledPasses: plan.laserPassPlan.scheduledPasses.map((p) => decalerLesHeures(p, ecart, ['startTime'])) };
  }
  return sortie;
}

// LE GROUPE DECALE ET JUGE. `valider(essai, move)` : le controle de la journee (lib/database.js,
// validateActivityMoveResources), qui leve le refus ; `jour` : la journee lue (reservations sans ce
// dossier, statuts des pistes, blocages, date), pour chercher d autres pistes ; `autres`, `maintenant` :
// les groupes qui jouent. Rend le dossier decale, ses etapes (cle, avant, apres) et les pistes du
// bowling a la fin. Chaque activite se juge a sa place dans le plan decale : sa nouvelle heure est deja
// la sienne, le controle n y deplace rien.
function decalerLeGroupe(current, { ecart, pistes = null } = {}, { valider, jour = null, autres = [], maintenant = -Infinity, centreId = '' } = {}) {
  const { buildActivityMove } = require('./reservation-activity-move');
  const { sansLesGroupesQuiJouent, partieACaler } = require('./retard-arrivee');
  const { tenirLeBowling } = require('./heures-posees');
  const decalage = lireEcart(ecart);
  const etapes = etapesDuDecalage(current, decalage, pistes);
  let dossier = { ...current, startTime: heureDe(minuteDe(current.startTime) + decalage), opsPlan: planDecale(current.opsPlan, decalage) };
  etapes.forEach((etape, rang) => {
    const essayer = (move) => {
      const envoi = { ...move };
      delete envoi.dureeHeures;
      const essai = buildActivityMove(dossier, envoi, { aLaMinute: true });
      const verdict = sansLesGroupesQuiJouent(current, envoi, autres, maintenant, () => valider(essai, envoi));
      const calee = partieACaler(envoi, verdict);
      if (calee) throw calee;
      return verdict && verdict.opsPlan ? { ...essai, opsPlan: verdict.opsPlan } : essai;
    };
    try {
      dossier = etape.activityId === 'bowling' && jour
        ? tenirLeBowling({ ...etape.move, dureeHeures: etape.duree / 60 }, essayer, jour, centreId || current.centerId || 'libramont')
        : essayer(etape.move);
    } catch (error) {
      if (error && typeof error === 'object') {
        error.rangDuDeplacement = rang;
        error.cleDuDeplacement = etape.cle;
        error.heureDuDeplacement = heureDe(etape.apres);
      }
      throw error;
    }
  });
  // (le controle recompte le debut et la fin de la visite sur toutes les etapes, l accueil compris : la
  // visite decalee garde les siens, du meme ecart, et sa duree)
  const avant = current.opsPlan && typeof current.opsPlan === 'object' ? current.opsPlan : null;
  if (avant && dossier.opsPlan && typeof dossier.opsPlan === 'object') {
    const bornes = decalerLesHeures({ startTime: avant.startTime, endTime: avant.endTime }, decalage, ['startTime', 'endTime']);
    dossier = { ...dossier, opsPlan: { ...dossier.opsPlan, ...(typeof avant.startTime === 'string' ? { startTime: bornes.startTime } : {}), ...(typeof avant.endTime === 'string' ? { endTime: bornes.endTime } : {}), ...(Number.isFinite(Number(avant.totalMinutes)) && avant.totalMinutes !== null ? { totalMinutes: avant.totalMinutes } : {}) } };
  }
  return {
    dossier,
    etapes: etapes.map((etape) => ({ cle: etape.cle, activityId: etape.activityId, avant: heureDe(etape.avant), apres: heureDe(etape.apres) })),
    pistes: pistesDuBowling(dossier),
  };
}

module.exports = { ECART_MAX, ECARTS_A_BLANC_MAX, lireDecalage, lireEcarts, etapesDuDecalage, planDecale, decalerLeGroupe, pistesDuBowling };

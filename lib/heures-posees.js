'use strict';
// LES HEURES POSEES A LA MAIN AU COMPTOIR (2026-11-19, Ansar a Gembloux : « quand on réserve, on ne peut
// pas choisir l'heure pour chaque activité »). La fenetre Reserver propose les heures du moteur ; l employe
// peut poser a la main celle de chaque activite du ticket, dans une visite comme dans une formule. Le
// moteur place d abord tout le dossier, puis chaque heure posee s applique par le chemin de la fenetre
// Modifier : buildActivityMove (horaires du jour, horaires de la formule, chevauchement du groupe) puis
// validateActivityMoveResources sur la journee lue (pistes, arene, tables, blocages). Memes controles,
// memes phrases (« Piste 6 déjà prise de 16:00 à 17:30. », « Ce déplacement chevauche… »). Une heure
// posee reste posee : l ordre automatique du moteur ne la bouge plus, elle s applique apres lui.
const HEURES_MAX = 12;
const ACTIVITE = /^[a-z][a-z0-9_]{1,40}$/;
const HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function erreur(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

function minutes(heure) {
  const lu = HEURE.exec(String(heure || ''));
  return lu ? Number(lu[1]) * 60 + Number(lu[2]) : NaN;
}

function enHeure(valeur) {
  return `${String(Math.floor(valeur / 60)).padStart(2, '0')}:${String(valeur % 60).padStart(2, '0')}`;
}

function debutDuBloc(bloc) {
  const lu = /^(\d{1,2}):(\d{2})/.exec(String((bloc && bloc.startTime) || ''));
  return lu ? Number(lu[1]) * 60 + Number(lu[2]) : NaN;
}

// { activite: 'HH:MM' } -> [{ activityId, heure }], le bowling d abord, puis le laser, puis le reste (l ordre
// de Modifier). Un corps forge est refuse en entier, jamais rabote. Rien ne se joue a une heure a la table
// d anniversaire, au bar ni aux jetons d arcades remis au comptoir (la fenetre ne les propose pas).
function lireHeuresPosees(brut) {
  if (brut === undefined || brut === null) return [];
  if (typeof brut !== 'object' || Array.isArray(brut)) throw erreur('Heures d’activité invalides.');
  const entrees = Object.entries(brut);
  if (entrees.length > HEURES_MAX) throw erreur('Heures d’activité invalides.');
  const rang = (id) => (id === 'bowling' ? 0 : id === 'laser_game' ? 1 : 2);
  return entrees.map(([activityId, heure]) => {
    if (!ACTIVITE.test(activityId) || activityId === 'party_table' || activityId === 'arcade_credit' || /^service_/.test(activityId) || !Number.isFinite(minutes(heure))) throw erreur('Heures d’activité invalides.');
    return { activityId, heure: String(heure) };
  }).sort((a, b) => rang(a.activityId) - rang(b.activityId) || a.activityId.localeCompare(b.activityId));
}

// L heure qu a l activite dans le plan du moteur : le premier service du bowling, la premiere partie du
// laser, la premiere etape a heure d une autre activite (NaN quand elle est libre).
function heureDuPlan(dossier, activityId) {
  const plan = (dossier && dossier.opsPlan) || {};
  const blocs = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const etapes = Array.isArray(plan.timeline) ? plan.timeline : [];
  const premiere = (liste) => { const debuts = liste.map(debutDuBloc).filter(Number.isFinite); return debuts.length ? Math.min(...debuts) : NaN; };
  if (activityId === 'bowling') return premiere(blocs.filter((bloc) => bloc && bloc.resourceType === 'bowling_lane'));
  if (activityId === 'laser_game') return premiere(blocs.filter((bloc) => bloc && bloc.resourceType === 'laser_arena'));
  return premiere(etapes.filter((etape) => etape && etape.type === 'activity' && etape.activityId === activityId && etape.flexible !== true));
}

// Les deplacements qui posent cette heure, tels que Modifier les envoie : le bowling avec ses pistes, chaque
// partie du laser du meme ecart (la plus tardive d abord quand elles reculent), le reste par son heure.
function deplacementsDeLHeure(dossier, { activityId, heure }) {
  const plan = (dossier && dossier.opsPlan) || {};
  const blocs = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  if (activityId === 'bowling') {
    const pistes = [...new Set(blocs.filter((bloc) => bloc && bloc.resourceType === 'bowling_lane').flatMap((bloc) => bloc.lanes || []).map(Number))].sort((a, b) => a - b);
    return [{ activityId, startTime: heure, lanes: pistes }];
  }
  if (activityId === 'laser_game') {
    const parties = blocs.filter((bloc) => bloc && bloc.resourceType === 'laser_arena')
      .map((bloc) => ({ cle: `${Number(bloc.countIndex || 1)}.${Number(bloc.groupWaveIndex || 1)}`, debut: debutDuBloc(bloc) }))
      .filter((partie) => Number.isFinite(partie.debut))
      .sort((a, b) => a.debut - b.debut);
    if (!parties.length) return [{ activityId, unitKey: '1.1', startTime: heure }];
    const ecart = minutes(heure) - parties[0].debut;
    return (ecart > 0 ? parties.slice().reverse() : parties).map((partie) => ({ activityId, unitKey: partie.cle, startTime: enHeure(partie.debut + ecart) }));
  }
  return [{ activityId, startTime: heure }];
}

// UN ACCES ILLIMITE A VOLONTE (lib/a-volonte.js) garde ses pistes toute la visite et ses armes a chaque
// depart : le bowling et le laser gardes n ont pas d heure a poser (la fenetre ne la propose pas).
function gardeeAVolonte(dossier, activityId) {
  const plan = (dossier && dossier.opsPlan) || {};
  const blocs = [...(Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : []), ...(Array.isArray(plan.timeline) ? plan.timeline : [])];
  return blocs.some((bloc) => bloc && bloc.aVolonte === true && bloc.activityId === activityId);
}
const PHRASE_A_VOLONTE = {
  bowling: 'Le bowling à volonté garde ses pistes toute la visite : il n’a pas d’heure à poser.',
  laser_game: 'Le laser à volonté garde ses armes à chaque départ : il n’a pas d’heure à poser.',
};

// Le dossier planifie avec ses heures posees, ou le refus de la premiere qui ne passe pas (le dossier reste
// alors celui du moteur). `jour` : la journee lue par le plan (reservations, statuts des pistes, blocages).
function poserLesHeures(dossier, heures, jour = {}) {
  if (!Array.isArray(heures) || !heures.length || !dossier || !dossier.opsPlan) return { dossier, refus: null };
  const { buildActivityMove } = require('./reservation-activity-move');
  const { validateActivityMoveResources } = require('./database');
  let courant = dossier;
  for (const posee of heures) {
    if (gardeeAVolonte(courant, posee.activityId)) {
      return { dossier, refus: { activite: posee.activityId, heure: posee.heure, message: PHRASE_A_VOLONTE[posee.activityId] || 'Cette activité est gardée toute la visite : elle n’a pas d’heure à poser.' } };
    }
    if (heureDuPlan(courant, posee.activityId) === minutes(posee.heure)) continue;
    try {
      for (const move of deplacementsDeLHeure(courant, posee)) {
        const essai = buildActivityMove(courant, move);
        // (le controle relit le dossier comme une ecriture : une simulation n a pas encore de nom)
        validateActivityMoveResources({ ...essai, name: String(essai.name || '').trim() || 'Groupe' }, move, jour.reservations || [], jour.laneStatuses || {}, jour.blocks || [], jour.date || dossier.date);
        courant = essai;
      }
    } catch (error) {
      if (!error || !error.statusCode || error.statusCode >= 500) throw error;
      // (la phrase de Modifier, sans ce qui ne vaut que pour un dossier deja ecrit : rien n est encore « inchangé »)
      const message = String(error.message || 'Cette heure ne tient pas.').replace(/\s*(Cet horaire reste inchangé|Les autres horaires restent inchangés)\.\s*$/, '').trim();
      return { dossier, refus: { activite: posee.activityId, heure: posee.heure, message } };
    }
  }
  return { dossier: courant, refus: null };
}

module.exports = { HEURES_MAX, deplacementsDeLHeure, heureDuPlan, lireHeuresPosees, poserLesHeures };

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

// LE BOWLING ET LE LASER AJOUTES SONT DES ANCRES DU MOTEUR (2026-11-20, dossier 1953 de Gembloux : une
// Formule 5 qui prend un Bowling a 12:00 dans Modifier). Posee apres le moteur, l heure arrivait trop
// tard : une visite a ancres sans heure pour le bowling est refusee par le moteur (« Choisissez une heure
// pour Bowling. »), et le dossier s ecrivait avec un bowling que son plan n avait pas. L heure part donc
// avec celles que le moteur place lui-meme (preference.preferredTimes), sur la grille des demi-heures
// qu il impose a toute ancre. Une heure a la minute (15:10, 2026-11-22) part a la demi-heure d avant
// (15:00) : le moteur place le dossier, puis poserLesHeures la pose a sa minute, aux memes controles.
function ancresDuMoteur(heures) {
  const ancres = {};
  (Array.isArray(heures) ? heures : []).forEach((posee) => {
    if (posee.activityId !== 'bowling' && posee.activityId !== 'laser_game') return;
    const m = minutes(posee.heure);
    if (Number.isFinite(m)) ancres[posee.activityId] = enHeure(m - (m % 30));
  });
  return ancres;
}

// LES ACTIVITES D UN DOSSIER, celles que Modifier ajoute ou retire : les lignes de son programme, sinon
// les etapes de sa formule, sinon son activite (un bowling ou un laser sans programme). Ni la table
// d anniversaire, ni le bar, ni les jetons d arcades : ils suivent la formule, on ne les ajoute pas.
function activitesDuDossier(dossier) {
  const brut = dossier && dossier.program;
  const items = Array.isArray(brut) ? brut : brut && Array.isArray(brut.items) ? brut.items : [];
  let ids = items.map((item) => item && item.activityId);
  if (!items.length && dossier && dossier.formuleId) {
    try {
      const { getFormula } = require('./ops-knowledge');
      const { formuleDuDossier } = require('./formula-choice');
      const formule = formuleDuDossier(getFormula(dossier.formuleId), dossier);
      ids = ((formule && formule.steps) || []).map((etape) => etape && etape.activityId);
    } catch (error) { ids = []; }
  } else if (!items.length && dossier) {
    ids = dossier.type === 'bowling' ? ['bowling'] : dossier.type === 'laser' ? ['laser_game'] : [];
  }
  return new Set(ids.map((id) => String(id || '')).filter((id) => id && id !== 'party_table' && id !== 'arcade_credit' && !/^service_/.test(id)));
}

// Le debut de la visite dans un plan : sa premiere activite a heure (ni l accueil, ni le bar, ni une
// activite libre). NaN sans activite a heure.
function debutDesActivites(plan) {
  const blocs = [...((plan && plan.resourceBlocks) || []), ...((plan && plan.timeline) || [])].filter((bloc) => bloc && bloc.flexible !== true
    && (bloc.resourceType === 'bowling_lane' || bloc.resourceType === 'laser_arena'
      || (bloc.type === 'activity' && bloc.activityId && bloc.activityId !== 'party_table' && bloc.activityId !== 'arcade_credit' && !/^service_/.test(bloc.activityId))));
  const debuts = blocs.map(debutDuBloc).filter(Number.isFinite);
  return debuts.length ? Math.min(...debuts) : NaN;
}

function memesActivites(dossier, items) {
  const avant = activitesDuDossier(dossier);
  const apres = activitesDuDossier({ program: { items: Array.isArray(items) ? items : [] } });
  return avant.size === apres.size && [...avant].every((id) => apres.has(id));
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
// LES HEURES POSEES SE JUGENT ENSEMBLE, COMME UN SEUL JEU FINAL (2026-11-21, le gerant : « il me dit que
// les résas se chevauchent alors que non »). Sa Formule 1 de 14:30 : le bowling pose a 16:00, le laser a
// 17:00, les arcades a 17:30. Posees une a une, le bowling se jugeait contre le laser encore a sa place du
// moteur (16:00) : « Ce déplacement chevauche le Laser Game du groupe, de 16:00 à 16:25 ». Chaque heure
// posee ne se juge plus que contre les activites qui restent ou elles sont et contre celles deja posees :
// la place d avant d une activite qui bouge ensuite ne compte pas (buildActivityMove, `ensuite`).
// Chacune de sa vraie duree, celle du plan (le contenu de la formule, sinon le catalogue) : le laser pose
// a 17:45 chevauche les 30 min d arcades de 17:30, meme laissees a leur heure (`toutLeJeu`). Les jetons
// d arcades, vendus en credits, n ont pas d heure et ne chevauchent rien (jeuAHeure).
function poserLesHeures(dossier, heures, jour = {}) {
  if (!Array.isArray(heures) || !heures.length || !dossier || !dossier.opsPlan) return { dossier, refus: null };
  const { buildActivityMove } = require('./reservation-activity-move');
  const { validateActivityMoveResources } = require('./database');
  const bougent = heures.filter((posee) => heureDuPlan(dossier, posee.activityId) !== minutes(posee.heure)).map((posee) => posee.activityId);
  let courant = dossier;
  for (const posee of heures) {
    if (gardeeAVolonte(courant, posee.activityId)) {
      return { dossier, refus: { activite: posee.activityId, heure: posee.heure, message: PHRASE_A_VOLONTE[posee.activityId] || 'Cette activité est gardée toute la visite : elle n’a pas d’heure à poser.' } };
    }
    if (heureDuPlan(courant, posee.activityId) === minutes(posee.heure)) continue;
    const ensuite = bougent.slice(bougent.indexOf(posee.activityId) + 1);
    try {
      for (const move of deplacementsDeLHeure(courant, posee)) {
        const essai = buildActivityMove(courant, move, { ensuite, toutLeJeu: true, aLaMinute: true });
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
  // (le plan commence a l arrivee du groupe, ou a sa premiere activite si elle vient avant : buildActivityMove
  // recompte le debut sur toutes les etapes, l accueil de 10 min compris, « 15:50 » pour une visite de 16:00)
  const plan = courant.opsPlan || {};
  const debut = Math.min(...[minutes(String(courant.startTime || '').slice(0, 5)), debutDesActivites(plan)].filter(Number.isFinite));
  if (courant !== dossier && Number.isFinite(debut)) {
    const fin = minutes(String(plan.endTime || '').slice(0, 5));
    courant = { ...courant, opsPlan: { ...plan, startTime: enHeure(debut), ...(Number.isFinite(fin) && fin > debut ? { totalMinutes: fin - debut } : {}) } };
  }
  return { dossier: courant, refus: null };
}

module.exports = { HEURES_MAX, activitesDuDossier, ancresDuMoteur, debutDesActivites, deplacementsDeLHeure, heureDuPlan, lireHeuresPosees, memesActivites, poserLesHeures };

'use strict';
// LA RESERVATION QUE L ASSISTANT PREPARE (2026-11-11). Ansar : « fait moi une réservation de
// 5 personnes pour demain, du bowling, choisis la meilleure heure pour qu'ils soient
// tranquilles, et du laser game 2 parties mais à 3 ». L assistant ne savait poser qu une heure
// et un nombre de joueurs : le laser restait « à noter à la main ». Ici, le programme entier
// (chaque activite, sa duree ou ses parties, ses participants) passe par le MEME planificateur
// que la fenetre Reserver (planifierPourLaFenetre, lib/reserver-fenetre.js) : les heures qui
// tiennent, le prix, les pistes et les conflits sont ceux que la fenetre montrerait, et la
// creation est celle de la fenetre (creerDepuisLaFenetre, lib/reserver-creation.js).
//
// Rien ne se cree sans le clic de la personne : lib/assistant-outils.js ne fait que simuler,
// api/ops.js (assistantReservation) revoit tout au clic, avec les droits de sa session.

const ACTIVITES_MAX = 6;

const erreur = (message, statut = 422) => Object.assign(new Error(message), { statusCode: statut, expose: true });

function catalogue(centreId) {
  try {
    return require('./activity-catalog').listCenterActivities(centreId) || [];
  } catch (error) {
    return [];
  }
}

const estBowling = (a) => a && (a.id === 'bowling' || a.priceType === 'grid_bowling');
const estLaser = (a) => a && (a.id === 'laser_game' || a.priceType === 'grid_laser');

// Le programme, tel que la fenetre Reserver l envoie : { activityId, participants, duration
// (bowling, en heures) | games (laser) }. Une activite hors du catalogue du centre, un nombre
// de participants plus grand que le groupe ou une duree hors grille sont refuses avec leur
// raison : l assistant la lit et se corrige.
function programmeDe(activites, joueurs, centreId) {
  const liste = Array.isArray(activites) ? activites.slice(0, ACTIVITES_MAX + 1) : [];
  if (!liste.length) throw erreur('Donnez au moins une activité, par son identifiant du catalogue.');
  if (liste.length > ACTIVITES_MAX) throw erreur(`${ACTIVITES_MAX} activités au plus dans une réservation.`);
  const connues = catalogue(centreId);
  const vues = new Set();
  return liste.map((brute) => {
    const entree = brute && typeof brute === 'object' ? brute : {};
    const id = String(entree.activite || entree.id || entree.activityId || '').trim();
    const activite = connues.find((a) => a && a.id === id);
    if (!activite) throw erreur(`L’activité « ${id.slice(0, 40)} » n’existe pas dans ce centre. Lisez le catalogue pour son identifiant.`);
    if (vues.has(id)) throw erreur(`L’activité « ${activite.name || id} » est donnée deux fois.`);
    vues.add(id);
    const participants = entree.participants == null || entree.participants === '' ? joueurs : Math.trunc(Number(entree.participants));
    if (!(participants >= 1 && participants <= joueurs)) throw erreur(`${activite.name || id} : entre 1 et ${joueurs} participants.`);
    const ligne = { activityId: id, participants };
    if (estBowling(activite)) {
      const duree = entree.duree_heures == null || entree.duree_heures === '' ? 1 : Number(entree.duree_heures);
      if (!(duree > 0 && duree <= 4 && Math.round(duree * 2) === duree * 2)) throw erreur('Le bowling se réserve par demi-heure, de 30 min à 4 h.');
      ligne.duration = duree;
    } else if (estLaser(activite)) {
      const parties = entree.parties == null || entree.parties === '' ? 1 : Math.trunc(Number(entree.parties));
      if (!(parties >= 1 && parties <= 12)) throw erreur('Le laser se réserve de 1 à 12 parties.');
      ligne.games = parties;
    }
    return ligne;
  });
}

// LES HEURES DE CHAQUE ACTIVITE, comme la fenetre Reserver les pose d elle-meme (rvHeuresDesLignes et
// rvPreference, assets/app-main.js) : la premiere a l heure d arrivee, chaque bowling ou laser suivant
// « dans la foulee », a la demi-heure qui suit la fin du precedent, et une partie de laser toutes les
// 30 minutes. Sans elles, le moteur refusait tout (« Choisissez une heure pour Bowling. »).
const ANCRABLES = ['bowling', 'laser_game'];
const enMinutes = (h) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const enHeure = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
function preferenceDu(programme, heure) {
  const preferredTimes = {};
  let laserGameTimes = null;
  let fin = null;
  programme.forEach((ligne, i) => {
    const ancrable = ANCRABLES.includes(ligne.activityId);
    let debut = null;
    if (i === 0) debut = enMinutes(heure);
    else if (ancrable && fin != null) debut = Math.ceil(fin / 30) * 30;
    if (debut == null) return;
    if (ancrable) preferredTimes[ligne.activityId] = enHeure(debut);
    if (ligne.activityId === 'laser_game') laserGameTimes = Array.from({ length: ligne.games || 1 }, (_, k) => enHeure(debut + 30 * k));
    const minutes = ligne.activityId === 'bowling' ? Math.round((ligne.duration || 1) * 60) : ligne.activityId === 'laser_game' ? 30 * (ligne.games || 1) : 60;
    fin = debut + minutes;
  });
  return {
    activityOrder: programme.map((ligne) => ligne.activityId),
    ...(Object.keys(preferredTimes).length ? { preferredTimes } : {}),
    ...(laserGameTimes ? { laserGameTimes, laserPlacement: 'scheduled' } : {}),
  };
}

// Le corps que la fenetre Reserver enverrait pour ce programme. Le moteur lit le programme en
// tableau (lib/reservation-request.js applyProgram) : une chaine JSON y passait pour vide.
function corpsDe({ centreId, date, heure, joueurs, programme, nom = '', telephone = '', notes = '' }) {
  const { telephoneMisEnForme } = require('./telephone-du-client');
  return {
    centerId: centreId,
    date,
    startTime: heure,
    pax: joueurs,
    type: 'visite',
    program: programme.map((ligne) => ({ ...ligne })),
    preference: preferenceDu(programme, heure),
    name: String(nom || '').trim().slice(0, 120) || 'Client',
    phone: telephone ? telephoneMisEnForme(telephone).slice(0, 40) : '',
    email: '',
    notes: String(notes || '').slice(0, 500),
    channel: 'staff',
  };
}

function nomDActivite(centreId, id) {
  const a = catalogue(centreId).find((x) => x && x.id === id);
  return (a && a.name) || id;
}

// Ce que la carte montre : chaque activite a son heure, ses pistes et ses joueurs, le prix et
// la fin de la visite, lus dans le plan du moteur. Le prix ne part qu a qui voit les montants.
function resumeDu(prepare, { centreId, programme, montants }) {
  const plan = (prepare && prepare.plan) || {};
  const blocs = Array.isArray(plan.blocs) ? plan.blocs : [];
  const lignes = programme.map((p) => {
    const siens = blocs.filter((b) => b && b.activite === p.activityId);
    const debut = siens.map((b) => b.debut).filter(Boolean).sort()[0] || '';
    const fin = siens.map((b) => b.fin).filter(Boolean).sort().slice(-1)[0] || '';
    const pistes = [...new Set(siens.flatMap((b) => (Array.isArray(b.pistes) ? b.pistes : [])))].sort((a, b) => a - b);
    const detail = [
      p.duration ? `${String(p.duration).replace('.', ',')} h` : '',
      p.games ? `${p.games} partie${p.games > 1 ? 's' : ''}` : '',
      `${p.participants} joueur${p.participants > 1 ? 's' : ''}`,
      pistes.length ? `${pistes.length > 1 ? 'pistes' : 'piste'} ${pistes.join(', ')}` : '',
    ].filter(Boolean).join(', ');
    return { activite: p.activityId, nom: nomDActivite(centreId, p.activityId), debut, fin, detail };
  });
  const conflits = (prepare && Array.isArray(prepare.conflits) ? prepare.conflits : []).map((c) => String((c && c.message) || c || '')).filter(Boolean).slice(0, 4);
  return {
    disponible: Boolean(plan.disponible) && !conflits.length,
    debut: plan.debut || '',
    fin: plan.fin || '',
    lignes,
    prix: montants && Number.isFinite(Number(plan.prix)) ? Math.round(Number(plan.prix) * 100) / 100 : null,
    refus: plan.refus || (prepare && prepare.droits && prepare.droits.refus ? String(prepare.droits.refus.message || '') : ''),
    conflits,
  };
}

// Une lecture de la journee pour toutes les simulations d une meme question.
function lecteurDuJour() {
  const lectures = new Map();
  return (jour, centre) => {
    const cle = `${centre}|${jour}`;
    if (!lectures.has(cle)) lectures.set(cle, require('./database').readStaffState(jour, centre, { avecBlocages: true }));
    return lectures.get(cle);
  };
}

async function simuler(corps, session, { readState = lecteurDuJour() } = {}) {
  const { planifierPourLaFenetre } = require('./reserver-fenetre');
  return planifierPourLaFenetre(corps, session, { readState });
}

// Chaque heure de depart du jour, essayee sur la meme lecture de la journee (simulerCandidats,
// comme l horloge de la fenetre Reserver).
async function heuresQuiTiennent({ corps, session, heures, readState = lecteurDuJour() }) {
  const { simulerCandidats } = require('./reserver-simulation');
  const { planifierPourLaFenetre, finDeLaVisite } = require('./reserver-fenetre');
  return simulerCandidats({
    corps,
    candidats: heures,
    planifier: async (essai) => {
      const r = await planifierPourLaFenetre(essai, session, { readState });
      return { ops: r.ops, dossier: r.dossier, conflits: r.conflits };
    },
    finDuPlan: finDeLaVisite,
  });
}

// LA CREATION, au seul clic de la carte (api/ops.js). Tout est revu : le telephone, le plan sur
// la journee lue maintenant, les droits de la session. Un conflit apparu depuis la proposition
// arrete la creation et se dit.
async function creer(corps, session) {
  const { telephoneValide } = require('./telephone-du-client');
  if (!telephoneValide(corps.phone)) throw erreur('Le téléphone du client est obligatoire.');
  const prepare = await simuler(corps, session);
  const plan = prepare.plan || {};
  if (prepare.droits && prepare.droits.refus) throw erreur(String(prepare.droits.refus.message || 'Votre rôle ne permet pas cette réservation.'), 403);
  if (!plan.disponible) throw erreur(plan.refus || plan.avertissement || 'Le planning ne trouve plus de place pour ce programme à cette heure.', 409);
  const bloquant = (prepare.conflits || []).find(Boolean);
  if (bloquant) throw erreur(`Ce créneau n’est plus libre : ${String(bloquant.message || bloquant)}`, 409);
  const { creerDepuisLaFenetre } = require('./reserver-creation');
  return creerDepuisLaFenetre(prepare, session, {}, { surface: 'api/ops.js assistantReservation' });
}

module.exports = { ACTIVITES_MAX, programmeDe, corpsDe, resumeDu, simuler, heuresQuiTiennent, creer, lecteurDuJour };

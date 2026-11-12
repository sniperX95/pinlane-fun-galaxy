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
    if (entree.groupes != null && !estLaser(activite)) throw erreur(`${activite.name || id} : seuls les groupes du laser se donnent.`);
    if (estBowling(activite)) {
      const duree = entree.duree_heures == null || entree.duree_heures === '' ? 1 : Number(entree.duree_heures);
      if (!(duree > 0 && duree <= 4 && Math.round(duree * 2) === duree * 2)) throw erreur('Le bowling se réserve par demi-heure, de 30 min à 4 h.');
      ligne.duration = duree;
    } else if (estLaser(activite)) {
      const parties = entree.parties == null || entree.parties === '' ? 1 : Math.trunc(Number(entree.parties));
      if (!(parties >= 1 && parties <= 12)) throw erreur('Le laser se réserve de 1 à 12 parties.');
      ligne.games = parties;
      // LES GROUPES (2026-11-12, Ansar : « 2 parties de laser game, une partie avec 10 joueurs et une
      // autre avec 14 ») : le groupe joue chaque partie en plusieurs fois, un groupe par session de
      // l arene, dans l ordre dit. La somme fait les participants de la ligne ; sans participants
      // donnes, ce sont eux. Le programme de la visite les revalide (lib/visit-program.js).
      if (entree.groupes != null) {
        const groupes = Array.isArray(entree.groupes) ? entree.groupes.map((n) => Math.trunc(Number(n))) : [];
        if (groupes.length < 2 || groupes.length > 6 || groupes.some((n) => !(n >= 1))) throw erreur('Le laser se joue en 2 à 6 groupes, chacun d’au moins un joueur.');
        const somme = groupes.reduce((a, b) => a + b, 0);
        if (entree.participants == null || entree.participants === '') ligne.participants = somme;
        if (somme !== ligne.participants) throw erreur(`Les groupes du laser font ${somme} joueurs, la ligne en compte ${ligne.participants}.`);
        if (ligne.participants > joueurs) throw erreur(`${activite.name || id} : entre 1 et ${joueurs} participants.`);
        ligne.groupes = groupes;
      }
    }
    return ligne;
  });
}

// LES SUPPLEMENTS (2026-11-12, Ansar : « ensuite ils auront droit a une assiette apéritif ») : un
// article du catalogue des supplements du centre, lu par son nom, pour tout le groupe (un par
// joueur) ou en nombre, dans la forme exacte que la fenetre Reserver envoie (quickExtrasLignes,
// assets/app-main.js). Le prix vient du catalogue, jamais du modele ; au clic, le planificateur
// relit chaque ligne au catalogue avec les droits de la session (resoudreExtras,
// lib/droits-reservation.js).
const SUPPLEMENTS_MAX = 8;
const comparable = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Ce que le centre propose aujourd hui (categories ouvertes, articles actifs), le catalogue relu en
// base d abord : la carte, son clic et les gestes de l assistant lisent la meme liste.
async function articlesDuCentre(centreId) {
  const db = require('./database');
  try { await require('./ops-knowledge').refreshCenterOverrides(db.getPool()); } catch (e) { /* socle fichier */ }
  const CC = require('./center-config');
  return CC.surMesureChoisissable(CC.catalogueSurMesure(centreId)).articles;
}

// Le nom dit par la personne (« assiette apéritif ») contre celui du catalogue (« Assiette apéro ») :
// l identifiant ou le nom exact, sinon le seul article qui contient ce nom, sinon le seul dont les mots
// commencent comme chacun des siens. La carte montre toujours le nom du catalogue retenu.
const motsDe = (s) => comparable(s).split(' ').filter((m) => m.length >= 3).map((m) => m.slice(0, 4));
function articleDuNom(cle, proposes) {
  const exact = proposes.find((a) => a.id === cle) || proposes.find((a) => comparable(a.nom) === comparable(cle));
  if (exact) return { article: exact };
  const contient = proposes.filter((a) => comparable(a.nom).includes(comparable(cle)));
  if (contient.length) return contient.length === 1 ? { article: contient[0] } : { ambigus: contient };
  const demandes = motsDe(cle);
  const tous = demandes.length ? proposes.filter((a) => { const siens = motsDe(a.nom); return demandes.every((m) => siens.includes(m)); }) : [];
  if (tous.length) return tous.length === 1 ? { article: tous[0] } : { ambigus: tous };
  return { proches: proposes.filter((a) => { const siens = motsDe(a.nom); return demandes.some((m) => siens.includes(m)); }) };
}
function supplementsDe(liste, joueurs, articles) {
  if (liste == null || (Array.isArray(liste) && !liste.length)) return [];
  if (!Array.isArray(liste)) throw erreur('Les suppléments se donnent en liste.');
  if (liste.length > SUPPLEMENTS_MAX) throw erreur(`${SUPPLEMENTS_MAX} suppléments au plus.`);
  const proposes = Array.isArray(articles) ? articles : [];
  const { EXTRA_QTE_MAX } = require('./database');
  const vus = new Set();
  return liste.map((brut) => {
    const e = brut && typeof brut === 'object' ? brut : { article: brut };
    const cle = String(e.article ?? e.articleId ?? '').trim();
    if (!comparable(cle)) throw erreur('Nommez chaque supplément comme le catalogue du centre le nomme (catalogue_et_tarifs).');
    const lu = articleDuNom(cle, proposes);
    if (lu.ambigus) throw erreur(`« ${cle.slice(0, 60)} » peut être ${lu.ambigus.slice(0, 4).map((a) => a.nom).join(' ou ')} : nommez-le exactement.`);
    if (!lu.article) {
      const proches = (lu.proches || []).slice(0, 4).map((a) => a.nom);
      throw erreur(`« ${cle.slice(0, 60)} » n’est pas au catalogue des suppléments du centre. ${proches.length ? `Le plus proche : ${proches.join(', ')}.` : proposes.length ? 'Lisez catalogue_et_tarifs pour les noms exacts.' : 'Le centre ne propose aucun supplément.'}`);
    }
    const article = lu.article;
    if (vus.has(article.id)) throw erreur(`« ${article.nom} » est donné deux fois.`);
    vus.add(article.id);
    const sansQuantite = e.quantite == null || e.quantite === '';
    const parPersonne = e.par_personne === true || e.parPersonne === true || (sansQuantite && article.unite === 'joueur');
    const qte = parPersonne ? joueurs : sansQuantite ? 1 : Number(e.quantite);
    if (!(Number.isInteger(qte) && qte >= 1 && qte <= EXTRA_QTE_MAX)) throw erreur(`« ${article.nom} » : une quantité entière de 1 à ${EXTRA_QTE_MAX}.`);
    const prix = Number(article.prix) || 0;
    return { articleId: article.id, categorie: article.categorie, name: article.nom, qte, prixUnitaire: prix, price: Math.round(prix * qte * 100) / 100, ...(parPersonne ? { parPersonne: true } : {}) };
  });
}

// LE PRIX NEGOCIE (« tout ça pour 30 euros par personne ») : un montant pour toute la reservation et
// sa raison, comme la fenetre Reserver l envoie (« Raison du prix ? »). Le planificateur le juge avec
// les droits de la session (lib/droits-reservation.js jugerPrixDeCreation) : un role qui ne peut pas
// descendre si bas voit sa carte refusee, au clic comme a la preparation.
function prixNegocieDe(prix, raison) {
  if (prix == null || prix === '') return null;
  const montant = Number(prix);
  if (!(Number.isFinite(montant) && montant >= 0 && montant <= 100000)) throw erreur('Le prix négocié est invalide.');
  const texte = String(raison || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (texte.length < 3) throw erreur('Un prix négocié dit sa raison, par exemple « forfait 30 € par personne ».');
  return { price: Math.round(montant * 100) / 100, prixRaison: texte };
}

// LES HEURES DE CHAQUE ACTIVITE, comme la fenetre Reserver les pose d elle-meme (rvHeuresDesLignes et
// rvPreference, assets/app-main.js) : la premiere a l heure d arrivee, chaque bowling ou laser suivant
// « dans la foulee », a la demi-heure qui suit la fin du precedent, et une partie de laser toutes les
// 30 minutes. Sans elles, le moteur refusait tout (« Choisissez une heure pour Bowling. »).
const ANCRABLES = ['bowling', 'laser_game'];
const enMinutes = (h) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const enHeure = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
// Avec des groupes, les vagues d une partie se suivent de 30 en 30 minutes dans le moteur
// (lib/ops-engine.js vaguesDuLaser, un groupe plus grand que les armes se coupant encore) : la partie
// suivante attend donc la fin de toutes. Sans groupes, l espacement reste celui d avant.
function vaguesDUnePartie(ligne, armes) {
  if (!Array.isArray(ligne.groupes) || ligne.groupes.length < 2) return 1;
  const parVague = Math.max(1, Number(armes) || 0) || 1;
  return ligne.groupes.reduce((n, g) => n + Math.max(1, Math.ceil(Number(g) / parVague)), 0);
}
function preferenceDu(programme, heure, armes = 30) {
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
    const vagues = ligne.activityId === 'laser_game' ? vaguesDUnePartie(ligne, armes) : 1;
    if (ligne.activityId === 'laser_game') laserGameTimes = Array.from({ length: ligne.games || 1 }, (_, k) => enHeure(debut + 30 * vagues * k));
    const minutes = ligne.activityId === 'bowling' ? Math.round((ligne.duration || 1) * 60) : ligne.activityId === 'laser_game' ? 30 * vagues * (ligne.games || 1) : 60;
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
function armesDuCentre(centreId) {
  try {
    const centre = require('./ops-knowledge').getCenter(centreId);
    return Number(centre && centre.resources && centre.resources.laser && centre.resources.laser.weaponCount) || 30;
  } catch (error) {
    return 30;
  }
}
function corpsDe({ centreId, date, heure, joueurs, programme, nom = '', telephone = '', notes = '', supplements = [], prixNegocie = null }) {
  const { telephoneMisEnForme } = require('./telephone-du-client');
  return {
    centerId: centreId,
    date,
    startTime: heure,
    pax: joueurs,
    type: 'visite',
    program: programme.map((ligne) => ({ ...ligne, ...(Array.isArray(ligne.groupes) ? { groupes: ligne.groupes.slice() } : {}) })),
    preference: preferenceDu(programme, heure, armesDuCentre(centreId)),
    ...(Array.isArray(supplements) && supplements.length ? { extras: supplements.map((l) => ({ ...l })) } : {}),
    ...(prixNegocie ? { price: prixNegocie.price, prixRaison: prixNegocie.prixRaison } : {}),
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

// Ce que la carte montre : chaque activite a son heure, ses pistes et ses joueurs, les
// supplements, le prix et la fin de la visite, lus dans le plan du moteur. Les montants ne
// partent qu a qui les voit. Un prix negocie dit aussi le prix habituel (la reference du
// programme et ses supplements, prixAvecExtras) et sa raison.
const arrondi = (n) => Math.round(Number(n) * 100) / 100;
function resumeDu(prepare, { centreId, programme, montants, supplements = [], prixNegocie = null }) {
  const plan = (prepare && prepare.plan) || {};
  const blocs = Array.isArray(plan.blocs) ? plan.blocs : [];
  const lignes = programme.map((p) => {
    const siens = blocs.filter((b) => b && b.activite === p.activityId);
    const debut = siens.map((b) => b.debut).filter(Boolean).sort()[0] || '';
    const fin = siens.map((b) => b.fin).filter(Boolean).sort().slice(-1)[0] || '';
    const pistes = [...new Set(siens.flatMap((b) => (Array.isArray(b.pistes) ? b.pistes : [])))].sort((a, b) => a - b);
    const groupes = Array.isArray(p.groupes) && p.groupes.length > 1 ? ` en ${p.groupes.length} groupes (${p.groupes.join(' puis ')})` : '';
    const detail = [
      p.duration ? `${String(p.duration).replace('.', ',')} h` : '',
      p.games ? `${p.games} partie${p.games > 1 ? 's' : ''}` : '',
      `${p.participants} joueur${p.participants > 1 ? 's' : ''}${groupes}`,
      pistes.length ? `${pistes.length > 1 ? 'pistes' : 'piste'} ${pistes.join(', ')}` : '',
    ].filter(Boolean).join(', ');
    return { activite: p.activityId, nom: nomDActivite(centreId, p.activityId), debut, fin, detail };
  });
  const conflits = (prepare && Array.isArray(prepare.conflits) ? prepare.conflits : []).map((c) => String((c && c.message) || c || '')).filter(Boolean).slice(0, 4);
  const prix = montants && Number.isFinite(Number(plan.prix)) ? arrondi(plan.prix) : null;
  let habituel = null;
  if (prix !== null && prixNegocie && Number.isFinite(Number(plan.prixReference))) {
    const { prixAvecExtras } = require('./reservation-request');
    const extras = prepare && prepare.dossier && Array.isArray(prepare.dossier.extras) ? prepare.dossier.extras : [];
    habituel = arrondi(prixAvecExtras(Number(plan.prixReference), extras));
  }
  return {
    disponible: Boolean(plan.disponible) && !conflits.length,
    debut: plan.debut || '',
    fin: plan.fin || '',
    lignes,
    supplements: supplements.map((l) => ({ nom: l.name, qte: l.qte, ...(l.parPersonne ? { parPersonne: true } : {}) })),
    prix,
    ...(prixNegocie && prix !== null ? { prixNegocie: true, prixRaison: prixNegocie.prixRaison, ...(habituel !== null && habituel !== prix ? { prixHabituel: habituel } : {}) } : {}),
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

module.exports = { ACTIVITES_MAX, programmeDe, articlesDuCentre, supplementsDe, prixNegocieDe, corpsDe, resumeDu, simuler, heuresQuiTiennent, creer, lecteurDuJour };

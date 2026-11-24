'use strict';
// LA FENETRE RESERVER : UNE SEULE FACON DE PLANIFIER (2026-10-08, lot I2 de la
// console).
//
// La simulation (dryRun), la creation et le lot passent tous par
// planifierPourLaFenetre : le meme corps donne le meme plan, le meme prix et
// les memes conflits, que la fenetre essaie une heure, cree un dossier ou en
// cree cinq a la suite. Avant, le handler recopiait la preparation (corps
// normalise, formule adaptee, moteur) pour la simulation et pour la creation :
// deux copies, et la premiere divergence aurait montre un plan que la creation
// ne posait pas.
//
// Ce que la fonction rend : la demande normalisee, la sortie du moteur, le
// dossier exact que createReservation recevrait, ses conflits et le resume
// que la fenetre affiche. Elle n ecrit rien.

const { normalizeReservationRequest, prixAvecExtras, prixEnvoye, tarifDeReference } = require('./reservation-request');
const { prepareReservationOps } = require('./reservation-ops');
const { getBasePrice } = require('./booking-config');
const { getCenter, getFormula } = require('./ops-knowledge');
const { CONFLITS_BLOQUANTS, heureDe, minutesDe } = require('./reserver-simulation');
const { attenteDuSousGroupe, mesurerLaVisite } = require('./ops-engine');
const { attenteDesTours } = require('./visit-program');
const { ancresALaMinute, lireHeuresPosees, poserLesHeures } = require('./heures-posees');
const { sessionHasPermission } = require('./staff-auth');
const { corpsAdapteUneFormule, exigerAdaptationDeFormule, exigerFormuleDuCentre, exigerForcer, exigerPistesALaMain, jugerPrixDeCreation, nomDeSession, resoudreExtras } = require('./droits-reservation');

// UN DOSSIER NAIT ATTENDU, OU ARRIVE (2026-11-02). Depuis que la fenetre cree un
// client du comptoir « Arrivé », le statut du corps compte, et il ne demandait
// aucun droit : un role sans celui d encaisser pouvait creer un dossier deja paye.
// Le statut d une creation suit le droit du geste : « Arrivé » comme un pointage
// (la regle du PATCH, reservations.status ou .edit). Tout le reste nait attendu :
// encaisser ou annuler passe par le PATCH, son droit et son journal.
function statutDeCreation(statut, session) {
  return statut === 'arrived' && sessionHasPermission(session, ['reservations.status', 'reservations.edit']) ? 'arrived' : 'pending';
}

// ---------------------------------------------------------------------------
// LE RESUME DU PLAN (deplace de api/staff-reservations.js, inchange).
// ---------------------------------------------------------------------------
function heureDuPlan(valeur) {
  return typeof valeur === 'string' && /^\d{1,2}:\d{2}/.test(valeur) ? valeur.slice(0, 5) : '';
}
function nombreDuPlan(valeur) {
  return valeur === undefined || valeur === null || valeur === '' || !Number.isFinite(Number(valeur)) ? null : Number(valeur);
}
// La fin annoncee est celle des ACTIVITES : opsPlan.endTime ajoute la marge de
// risque du moteur (5 a 30 min), un tampon pour l equipe, pas une heure a
// dire au client.
function finDesActivites(plan) {
  const minutes = (heure) => { const [h, m] = String(heure || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
  const fins = [...(plan.resourceBlocks || []), ...(plan.timeline || [])].map((pas) => minutes(heureDuPlan(pas && pas.endTime))).filter((v) => v !== null);
  if (fins.length) { const fin = Math.max(...fins); return `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`; }
  const brute = minutes(heureDuPlan(plan.endTime));
  if (brute === null) return '';
  const fin = brute - (Number(plan.bufferMinutes) || 0);
  return `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`;
}
// LA FIN QUE L EQUIPE DIT AU CLIENT (2026-10-13) : celle de toute la visite.
// Le plan d une visite composee ne porte que le bowling et le laser : son
// dernier pas ignorait les activites sans heure (arcades, minigolf) et les
// parties de laser jouees dans la foulee apres lui. La fenetre annoncait
// « fin des activités 14:25 » une visite que le tunnel finissait a 16:15.
// Le libre se mesure comme dans le tunnel (mesurerLaVisite, lib/ops-engine.js :
// attente d un sous-groupe, trous nets de la foulee). La base reste le dernier
// pas, ou la fin du plan quand des parties de laser se jouent apres lui, comme
// l en-tete de la fiche (getStaffTerrainSpan, assets/app-main.js). Une
// formule porte deja ses activites libres dans son plan : rien n y change.
// UN DOSSIER ENREGISTRE (2026-10-15, la fin dite par mail) : son programme ne
// garde que ses lignes (un tableau, ou `items`), chacune marquee `planned` ;
// les listes du moteur (plannedItems, freeItems) s en relisent.
function finDeLaVisite(plan, dossier = {}) {
  const finPas = plan ? finDesActivites(plan) : '';
  const programme = dossier && dossier.program;
  const lignesDuDossier = Array.isArray(programme) ? programme : (programme && Array.isArray(programme.items) ? programme.items : []);
  const aHeure = programme && Array.isArray(programme.plannedItems) ? programme.plannedItems : lignesDuDossier.filter((ligne) => ligne && ligne.planned === true);
  if (!finPas || !programme || !aHeure.length) return finPas;
  const dernierPas = minutesDe(finPas);
  const debut = minutesDe(heureDuPlan(plan.startTime) || heureDuPlan(dossier.startTime));
  if (dernierPas === null || debut === null) return finPas;
  // L attente la plus longue du groupe : les vagues du plan, ou les tours
  // d une activite libre qui tourne (meme choix que le tunnel).
  const duPlan = attenteDuSousGroupe(plan.resourceBlocks);
  const desTours = attenteDesTours({ centerId: dossier.centerId, pax: dossier.pax, items: lignesDuDossier });
  const creux = !duPlan ? desTours : !desTours ? duPlan : (Number(desTours.minutes) > Number(duPlan.minutes) ? desTours : duPlan);
  // Le programme d un dossier ne garde que ses lignes (lib/reservation-request.js,
  // applyProgram) : le libre et sa part offerte pendant l attente se recomptent
  // sur les lignes sans heure, comme normalizeProgram les compte pour le tunnel.
  // Une activite que le plan a deja posee avant la premiere (« Venir plus tot », un autre
  // ordre, lib/autre-ordre.js) ne se joue pas une seconde fois : la regle des mails et de la
  // console (getVisiteLibreApres), ici aussi (2026-11-18).
  const posees = (Array.isArray(plan.timeline) ? plan.timeline : []).filter((pas) => pas && pas.avant === true && pas.flexible === false && pas.startTime);
  const libres = (Array.isArray(programme.freeItems) ? programme.freeItems : lignesDuDossier)
    .filter((ligne) => ligne && !ligne.planned && !(ligne.avant === true && posees.some((pas) => pas.activityId === ligne.activityId)));
  const somme = (lignes) => lignes.reduce((total, ligne) => total + Math.max(0, Math.round(Number(ligne.minutes) || 0)), 0);
  const mesure = mesurerLaVisite({ debut, plan, libre: somme(libres), libres, attenteLibre: somme(libres.filter((ligne) => ligne.waitOffer === true)), creux });
  const partiesApres = Boolean(plan.laserPassPlan && Array.isArray(plan.laserPassPlan.pendingPasses) && plan.laserPassPlan.pendingPasses.length);
  const base = partiesApres && mesure.apresLePlan > dernierPas ? mesure.apresLePlan : dernierPas;
  return heureDe(base + mesure.libreApres) || finPas;
}
// L ACCES ILLIMITE, DIT EN CLAIR (2026-11-19, Ansar : « le truc illimité est super mal expliqué »).
// Ce que le dossier comprend (ses activites, dans l ordre du catalogue), ce qu il garde toute la
// visite et ce qui se joue une fois a son heure : la phrase commune (assets/pinlane-a-volonte.js),
// lue sur le plan que la creation ecrirait. null pour toute autre reservation.
function accesIllimiteDuDossier(dossier = {}) {
  const plan = dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : null;
  const formuleId = String(dossier.formuleId || dossier.formulaId || '');
  if (!plan || !formuleId) return null;
  const centre = dossier.centerId || 'libramont';
  let formule = null;
  let catalogue = [];
  try {
    formule = require('./booking-config').getEffectiveFormules(centre, { comptoir: true }).find((f) => f && f.id === formuleId) || null;
    catalogue = require('./activity-catalog').listCenterActivities(centre);
  } catch (error) {
    return null;
  }
  if (!formule || !formule.illimite) return null;
  // Ce que le dossier comprend : son choix (2026-11-20, opsPlan.illimite, lib/formule-comptoir.js), sinon
  // le programme d une formule adaptee, sinon toute la formule.
  const choix = require('./formule-comptoir').choixQueLeDossierPorte(dossier, formuleId);
  const programme = dossier.program && Array.isArray(dossier.program.items) ? dossier.program.items : null;
  const ids = new Set((choix ? choix.activites : programme ? programme.map((item) => item && item.activityId) : formule.illimite.activites).filter(Boolean).map(String));
  const comprises = catalogue.filter((a) => ids.has(String(a.id))).map((a) => ({ id: String(a.id), nom: String(a.name || a.id) }));
  const resume = require('../assets/pinlane-a-volonte.js').resume(plan, { minutes: Number(formule.illimite.minutes) || 0, comprises });
  return resume ? { ...resume, comprises } : null;
}

// La plage de la formule seule dans un plan qui porte aussi ses activites en plus : de sa premiere activite a
// la fin de la derniere (le bar compris, comme la fin annoncee), sans l accueil.
function plageDeLaFormule(plan) {
  const minutes = (heure) => { const [h, m] = String(heure || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
  const siens = [...(plan.resourceBlocks || []), ...(plan.timeline || [])].filter((pas) => pas && !pas.enPlus && pas.flexible !== true && pas.type !== 'service');
  const debuts = siens.map((pas) => minutes(heureDuPlan(pas.startTime))).filter((v) => v !== null);
  const fins = siens.map((pas) => minutes(heureDuPlan(pas.endTime))).filter((v) => v !== null);
  const dire = (v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  return debuts.length && fins.length ? { debut: dire(Math.min(...debuts)), fin: dire(Math.max(...fins)) } : null;
}

// `dossier` est l objet exact que createReservation recevrait : le prix, le
// libelle et le plan se lisent la, jamais dans la requete d avant le moteur.
function resumerPlanPourLaFenetre(dossier = {}, ops = {}) {
  const plan = dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : null;
  const blocs = Array.isArray(plan && plan.resourceBlocks) ? plan.resourceBlocks : [];
  const etapes = Array.isArray(plan && plan.timeline) ? plan.timeline : [];
  const activiteDuBloc = (bloc) => String(bloc.activityId
    || (bloc.resourceType === 'bowling_lane' ? 'bowling' : bloc.resourceType === 'laser_arena' ? 'laser_game' : ''));
  return {
    disponible: Boolean(plan) && ops.planAvailable !== false,
    debut: heureDuPlan(plan && plan.startTime) || heureDuPlan(dossier.startTime),
    fin: plan ? finDeLaVisite(plan, dossier) : '',
    validation: ops.validationStatus || '',
    refus: ops.planRefusal ? String(ops.planRefusal) : '',
    avertissement: ops.planWarning ? String(ops.planWarning) : '',
    raison: (ops.validation && ops.validation.raison) || '',
    aSurveiller: ((ops.validation && ops.validation.aSurveiller) || []).map((item) => item && item.phrase).filter(Boolean),
    blocs: blocs.map((bloc) => ({
      activite: activiteDuBloc(bloc),
      ressource: String(bloc.resourceType || ''),
      debut: heureDuPlan(bloc.startTime),
      fin: heureDuPlan(bloc.endTime),
      pistes: Array.isArray(bloc.lanes) ? bloc.lanes.map(Number).filter(Number.isFinite) : [],
      joueurs: nombreDuPlan(bloc.players),
      // L arene pour vous seuls : `joueurs` y dit la place RETENUE (toute
      // l arene), `joueursReels` le groupe ; l ecran affiche le second.
      joueursReels: nombreDuPlan(bloc.joueursReels),
      arene: bloc.arene === 'seuls' ? 'seuls' : '',
      partie: nombreDuPlan(bloc.countIndex),
      vague: nombreDuPlan(bloc.groupWaveIndex),
      vagues: nombreDuPlan(bloc.groupWaveCount),
      joueursAvant: nombreDuPlan(bloc.playersBefore),
      placesRestantes: nombreDuPlan(bloc.remainingWeapons),
      partagee: Boolean(bloc.sharedSession),
      // Garde toute la visite (lib/a-volonte.js) : la piste ou l arene n est pas a cette seule heure.
      aVolonte: Boolean(bloc.aVolonte),
      // Le sous-groupe d un grand groupe (lib/grand-groupe.js) : le ticket dit qui joue ou.
      ...(Number(bloc.sousGroupe) > 0 ? { sousGroupe: nombreDuPlan(bloc.sousGroupe), sousGroupes: nombreDuPlan(bloc.sousGroupes) } : {}),
      // Une activite en plus de la formule (lib/formule-en-plus.js) : sa ligne, pas celle de la formule.
      enPlus: Boolean(bloc.enPlus),
    })),
    etapes: etapes.map((etape) => ({
      activite: String(etape.activityId || ''),
      debut: heureDuPlan(etape.startTime),
      fin: heureDuPlan(etape.endTime),
      libelle: String(etape.label || ''),
      libre: Boolean(etape.flexible),
      enPlus: Boolean(etape.enPlus),
    })).filter((etape) => etape.activite && etape.debut),
    // (la formule et ses activites en plus : la ligne de la formule dit ses heures a elle)
    ...(plan && plan.enPlus ? { formule: plageDeLaFormule(plan) } : {}),
    prix: nombreDuPlan(dossier.price),
    prixReference: nombreDuPlan(dossier.basePrice),
    libelle: String(dossier.label || ''),
    acces: plan ? accesIllimiteDuDossier(dossier) : null,
    // Ses sous-groupes, leurs tailles et l activite du groupe 1, quand le plan en a.
    ...(plan && plan.grandGroupe && typeof plan.grandGroupe === 'object' ? { grandGroupe: { ...plan.grandGroupe } } : {}),
    // Ce qui coince, groupe par groupe ({ groupe, activite, raison, partie }) : la page des groupes le dit sur la case.
    ...(Array.isArray(ops.groupesQuiCoincent) && ops.groupesQuiCoincent.length ? { coincent: ops.groupesQuiCoincent.map((x) => ({ groupe: Number(x.groupe) || 0, activite: String(x.activite || ''), raison: String(x.raison || ''), ...(Number(x.partie) > 0 ? { partie: Number(x.partie) } : {}) })) } : {}),
  };
}

// UNE FORMULE ADAPTEE DES LA CREATION (deplace de api/staff-reservations.js).
// La fiche savait deja adapter une formule apres coup : elle envoie la formule
// et son programme, et le moteur repart du document de la formule
// (buildAdaptedFormula, qui garde la table et les boissons). Une creation qui
// porte les deux est planifiee et enregistree comme une formule adaptee.
function formuleAdapteeDuCorps(body = {}) {
  const formuleId = String(body.formuleId || body.formulaId || '').trim();
  const program = body.program;
  const items = Array.isArray(program) ? program : (program && Array.isArray(program.items) ? program.items : []);
  return formuleId && items.length ? formuleId : '';
}

// UNE ACTIVITE AJOUTEE A LA FORMULE SE PAIE (2026-11-21). La Formule 5 a laquelle Reserver ajoutait un
// Bowling restait a 156 EUR, « au même prix » : le Bowling partait offert. Le calcul de Modifier
// (calculerLaModification, lib/formule-adaptee.js) : la reference est le prix de la formule plus ce que
// sa carte n a pas, au prix du catalogue que le plan vient de poser ; le programme ne compte que ces
// ajouts ; un prix envoye reste le prix facture. Retirer une activite ne baisse rien. null : un acces
// illimite ou une formule du comptoir, qui gardent le prix de leur formule.
function chiffrerLaFormuleAdaptee(request, ops, formuleId, envoye) {
  const { formuleAdaptable, referenceDeLaFormuleAdaptee } = require('./formule-adaptee');
  const programme = ops.program || request.program;
  const dossier = { ...request, ...ops, formuleId, program: programme };
  const formule = formuleAdaptable(dossier);
  if (!formule) return null;
  const reference = referenceDeLaFormuleAdaptee({ formule, dossier, programme, laneCount: ops.laneCount });
  request.basePrice = reference.total;
  request.price = envoye !== null ? envoye : prixAvecExtras(reference.total, request.extras);
  return { ...programme, price: reference.ajouts.montant, priceComplete: reference.ajouts.complet };
}

// LES ACTIVITES EN PLUS D UNE FORMULE (2026-11-22, lib/formule-en-plus.js). Seule une formule prise telle
// quelle (ou un acces illimite) en porte : une formule adaptee compose deja son programme, une visite n a pas
// de formule a garder.
function lireEnPlusDuCorps(corps, request, formuleAdaptee) {
  if (corps.enPlus === undefined || corps.enPlus === null) return [];
  const { lireEnPlus } = require('./formule-en-plus');
  const enPlus = lireEnPlus(corps.enPlus, { centerId: request.centerId, pax: request.pax });
  if (enPlus.length && (formuleAdaptee || request.type !== 'formule' || !String(request.formuleId || request.formulaId || '').trim() || request.program)) {
    throw Object.assign(new Error('Une activité en plus s’ajoute à une formule prise telle quelle.'), { statusCode: 422, expose: true });
  }
  // (une formule qui comprend tout n a rien a vendre en plus : lib/formule-tout-illimite.js)
  const compris = require('./formule-tout-illimite').enPlusDejaCompris({ formuleId: request.formuleId || request.formulaId, centerId: request.centerId, lignes: enPlus });
  if (compris) throw Object.assign(new Error(compris.message), { statusCode: 422, expose: true });
  return enPlus;
}

// Les activites en plus planifiees seules par le moteur, sur la journee du plan ou la formule compte comme
// un dossier de plus (reservationVirtuelle), puis jugees contre ce que la formule fait a heure fixe. Rend le
// dossier reuni et le montant des activites en plus, ou le refus de la premiere qui ne tient pas.
async function poserLesEnPlus({ corps, enPlus, dossier, request, session, jour }) {
  const { chevauchementAvecLaFormule, corpsDesEnPlus, formuleIllimitee, fusionnerLesEnPlus, lignesDesEnPlus } = require('./formule-en-plus');
  const visite = corpsDesEnPlus({ ...corps, centerId: request.centerId, date: request.date, pax: request.pax, startTime: request.startTime }, enPlus, dossier);
  const avecLaFormule = { ...jour, reservations: [...(Array.isArray(jour.reservations) ? jour.reservations : []), reservationVirtuelle(dossier, 0)] };
  const sous = await planifierPourLaFenetre(visite, session, { readState: async () => avecLaFormule });
  // (leurs lignes et leurs montants restent au dossier meme quand l heure coince : le ticket les garde, un
  // dossier « à placer » aussi)
  const lignes = lignesDesEnPlus(sous.dossier, enPlus, request.pax);
  const premiere = enPlus.find((ligne) => ligne.heure) || enPlus[0];
  const conflits = conflitsDArene(sous.ops);
  const bloquant = sous.conflits.find((conflit) => conflit && conflit.type !== 'plan' && CONFLITS_BLOQUANTS.has(conflit.type));
  if (sous.ops.planAvailable === false || !sous.dossier.opsPlan || sous.heureRefusee || bloquant) {
    const motif = String((sous.heureRefusee && sous.heureRefusee.message) || sous.ops.planRefusal || sous.ops.planWarning || (bloquant && bloquant.message) || 'Pas de place pour cette activité à cette heure.').trim();
    const visee = (sous.plan.heureRefusee && enPlus.find((ligne) => ligne.activityId === sous.plan.heureRefusee.activite)) || premiere;
    return { refus: { activite: visee.activityId, heure: visee.heure, message: motif, enPlus: true }, lignes, conflits };
  }
  const illimite = Boolean(request.illimite) || formuleIllimitee(request.formuleId || request.formulaId, request.centerId);
  const chevauche = chevauchementAvecLaFormule(dossier.opsPlan, sous.dossier.opsPlan, { illimite });
  if (chevauche) return { refus: { ...chevauche, enPlus: true }, lignes, conflits };
  return { dossier: fusionnerLesEnPlus(dossier, sous.dossier, enPlus), lignes, conflits };
}

// MODIFIER UN DOSSIER QUI A DES ACTIVITES EN PLUS DE SA FORMULE (2026-11-22). Le plan que Modifier refait (une
// heure, un groupe, un jour) les reprend a leur heure, decalees comme le dossier (lignesARePoser), jugees avec la
// formule comme a la creation (poserLesEnPlus) : elles ne partent jamais en silence. La journee est relue sans
// le dossier lui-meme. Rend le dossier reuni et leurs lignes, ou le refus de celle qui ne tient plus.
async function reposerLesEnPlus({ dossier, lignes, session, ignorer }) {
  const { lireEnPlus } = require('./formule-en-plus');
  const enPlus = lireEnPlus(lignes, { centerId: dossier.centerId, pax: dossier.pax });
  const lu = (await require('./database').readStaffState(dossier.date, dossier.centerId, { avecBlocages: true, avecFermetures: true })) || {};
  const blocks = Array.isArray(lu.blocks) ? lu.blocks : await fermeturesDuJour(dossier.date, dossier.centerId);
  const autres = (Array.isArray(lu.reservations) ? lu.reservations : []).filter((r) => Number(r && r.id) !== Number(ignorer));
  const jour = { ...lu, blocks, laneStatuses: lu.laneStatuses || {}, reservations: autres };
  return poserLesEnPlus({ corps: { ...dossier, allowPastStart: true }, enPlus, dossier, request: dossier, session, jour });
}

// Les lignes des activites en plus sans plan (la formule ne tient pas) : leur prix du catalogue seulement.
function lignesSansPlan({ corps, enPlus, dossier, request }) {
  const { corpsDesEnPlus, lignesDesEnPlus } = require('./formule-en-plus');
  try {
    const visite = normalizeReservationRequest(corpsDesEnPlus({ ...corps, centerId: request.centerId, date: request.date, pax: request.pax, startTime: request.startTime }, enPlus, dossier), { channel: 'staff', centerId: request.centerId });
    return lignesDesEnPlus(visite, enPlus, request.pax);
  } catch (error) {
    return lignesDesEnPlus(null, enPlus, request.pax);
  }
}

// ---------------------------------------------------------------------------
// LES PISTES DU PLAN ET LES CONFLITS.
// ---------------------------------------------------------------------------
function blocsDePistes(opsPlan) {
  return (opsPlan && Array.isArray(opsPlan.resourceBlocks) ? opsPlan.resourceBlocks : [])
    .filter((bloc) => bloc && bloc.resourceType === 'bowling_lane');
}

// Les pistes que le plan attribue, dans l ordre ou il les attribue. C est ce
// que la creation doit porter : sans elles, une visite avec bowling partait
// avec `lanes: []`, et la base refusait (« Ce créneau vient de changer »),
// faute de pouvoir rapprocher les pistes demandees (aucune) de celles du plan.
function lanesDuPlan(opsPlan) {
  return [...new Set(blocsDePistes(opsPlan)
    .flatMap((bloc) => (Array.isArray(bloc.lanes) ? bloc.lanes : []))
    .map(Number)
    .filter((piste) => Number.isInteger(piste) && piste > 0))];
}

// Un bord de bloc en minutes : l heure ecrite d abord, sinon `start`/`end`
// (en heures sous 48, en minutes au-dela), comme lib/reservation-activity-move.
function bordDuBloc(bloc, nom) {
  const ecrite = minutesDe(bloc && bloc[`${nom}Time`]);
  if (ecrite !== null) return ecrite;
  const valeur = Number(bloc && bloc[nom]);
  return Number.isFinite(valeur) ? Math.round(valeur <= 48 ? valeur * 60 : valeur) : null;
}

// Les fenetres de piste d un dossier deja dans la journee : les blocs bowling
// de son plan, sinon son heure, sa duree et ses pistes (la lecture de
// lib/database.js, laneWindowsFromReservation).
function fenetresDePistes(reservation) {
  const blocs = blocsDePistes(reservation && reservation.opsPlan)
    .map((bloc) => ({ debut: bordDuBloc(bloc, 'start'), fin: bordDuBloc(bloc, 'end'), pistes: (bloc.lanes || []).map(Number) }))
    .filter((fenetre) => fenetre.debut !== null && fenetre.fin !== null && fenetre.fin > fenetre.debut && fenetre.pistes.length);
  if (blocs.length) return blocs;
  const debut = minutesDe(reservation && reservation.startTime);
  const duree = Math.round((Number(reservation && reservation.duration) || 0) * 60);
  const pistes = (Array.isArray(reservation && reservation.lanes) ? reservation.lanes : []).map(Number).filter(Number.isInteger);
  return debut !== null && duree > 0 && pistes.length ? [{ debut, fin: debut + duree, pistes }] : [];
}

// Un dossier du meme envoi garde son nom quand il en a un (« Leroy (même
// envoi) ») ; sinon son rang dans l envoi, jamais le nom technique d une
// simulation (la fenetre envoyait « Simulation », vu a l ecran le 2026-10-12).
function nomDuDossier(reservation) {
  if (reservation.blocage) return 'une réservation en ligne en cours';
  const nom = String(reservation.name || '').replace(/[<>]/g, '').trim();
  if (reservation.virtuel) return nom ? `${nom} (même envoi)` : `la réservation ${Number(reservation.rang) || 1} de cet envoi`;
  // (sans nom, son numero, ecrit comme partout : tape dans la recherche, il l ouvre)
  return nom || `la réservation n° ${reservation.id}`;
}

function listeDePistes(pistes) {
  if (pistes.length <= 1) return `la piste ${pistes[0]}`;
  return `les pistes ${pistes.slice(0, -1).join(', ')} et ${pistes[pistes.length - 1]}`;
}

// LES PISTES DEMANDEES QUE LE PLAN N A PAS PU HONORER. Le moteur traite un
// choix de pistes comme un souhait : s il ne tient pas, il en prend d autres
// sans rien dire (preferredLanesFor, lib/ops-engine.js). La fenetre doit le
// dire, avec la raison : la piste, l heure, qui l occupe, et ce que le plan
// prend a la place. Ce n est pas un refus : l heure reste possible.
function conflitsDePistes({ demande = {}, dossier = {}, snapshot = {}, centerId = '' }) {
  const blocs = blocsDePistes(dossier.opsPlan);
  if (!blocs.length) return [];
  const prises = lanesDuPlan(dossier.opsPlan);
  const voulues = [...new Set((Array.isArray(demande.lanes) ? demande.lanes : [])
    .map(Number).filter((piste) => Number.isInteger(piste) && piste > 0))];
  let parc = 0;
  try { parc = Number(getCenter(centerId).resources.bowling.laneCount) || 0; } catch (error) { parc = 0; }
  const fenetres = blocs
    .map((bloc) => ({ debut: bordDuBloc(bloc, 'start'), fin: bordDuBloc(bloc, 'end') }))
    .filter((fenetre) => fenetre.debut !== null && fenetre.fin !== null && fenetre.fin > fenetre.debut);
  const autres = (Array.isArray(snapshot.reservations) ? snapshot.reservations : [])
    .filter((reservation) => reservation && Number(reservation.id) !== Number(dossier.id || 0));
  const statuts = snapshot.laneStatuses || {};
  const aLaPlace = prises.filter((piste) => !voulues.includes(piste));
  const conflits = [];
  let rang = 0;
  voulues.forEach((piste) => {
    if (prises.includes(piste)) return;
    const remplacante = aLaPlace[rang];
    rang += 1;
    const suite = remplacante ? ` : le plan prend la piste ${remplacante} à la place.` : ' : le plan ne la prend pas.';
    const base = { type: 'pistes', piste, ...(remplacante ? { remplacante } : {}) };
    if (parc && piste > parc) {
      conflits.push({ ...base, message: `Piste ${piste} inexistante, le centre en a ${parc}${suite}` });
      return;
    }
    if (statuts[piste] === 'maintenance') {
      conflits.push({ ...base, message: `Piste ${piste} en maintenance${suite}` });
      return;
    }
    for (const fenetre of fenetres) {
      for (const autre of autres) {
        const occupee = fenetresDePistes(autre).find((sienne) => sienne.pistes.includes(piste) && sienne.debut < fenetre.fin && fenetre.debut < sienne.fin);
        if (occupee) {
          const qui = nomDuDossier(autre);
          conflits.push({ ...base, heure: heureDe(occupee.debut), occupant: qui,
            message: `Piste ${piste} prise de ${heureDe(occupee.debut)} à ${heureDe(occupee.fin)} par ${qui}${suite}` });
          return;
        }
      }
    }
    const heure = fenetres.length ? heureDe(fenetres[0].debut) : '';
    conflits.push({ ...base, message: `Piste ${piste} libre${heure ? ` à ${heure}` : ''}, mais les pistes demandées ne tiennent pas ensemble${suite}` });
  });
  // Bowling seul : le nombre de pistes voulu au-dessus du minimum (S1).
  const voulu = Math.trunc(Number(demande.laneCount) || 0);
  if (dossier.type === 'bowling' && !dossier.program && voulu > prises.length && prises.length) {
    conflits.push({ type: 'pistes', message: `${voulu} pistes demandées, le plan en prend ${prises.length} (${listeDePistes(prises)}).` });
  }
  return conflits;
}

// Le moteur n a pas de plan : la raison qu il donne, sinon une phrase claire.
function conflitsDuPlan(ops = {}, dossier = {}) {
  if (dossier.opsPlan && ops.planAvailable !== false) return [];
  return [{ type: 'plan', message: String(ops.planRefusal || ops.planWarning || 'Pas de plan possible à cette heure.') }];
}

function conflitsDArene(ops = {}) {
  return (Array.isArray(ops.areneConflits) ? ops.areneConflits : [])
    .map((conflit) => ({ type: 'arene', message: String(conflit.message || ''), ...(conflit.heure ? { heure: conflit.heure } : {}), ...(conflit.joueurs ? { joueurs: conflit.joueurs } : {}) }))
    .filter((conflit) => conflit.message);
}

// Le prix ligne par ligne d une visite, tel que le programme normalise le
// porte : null quand la ligne se regle au comptoir (pas de tarif connu).
// Une formule adaptee dit les lignes de Modifier (2026-11-21) : la formule a son
// prix, puis chaque activite que sa carte n a pas, au sien ; ce qu elle comprend
// est dans son prix, sans ligne.
function lignesPrixDuDossier(dossier = {}) {
  // Une formule et ses activites en plus (2026-11-22, lib/formule-en-plus.js) : la formule a son prix, puis
  // chaque activite en plus le sien, sur sa ligne.
  const enPlus = dossier.type === 'formule' ? require('./formule-en-plus').enPlusDuDossier(dossier) : null;
  if (enPlus) {
    const prixFormule = Math.round(((Number(dossier.basePrice) || 0) - (Number(enPlus.prix) || 0)) * 100) / 100;
    return [{ activite: 'formule', libelle: String(dossier.label || ''), prix: prixFormule },
      ...enPlus.items.map((item) => ({ activite: String(item.activityId || ''), libelle: String(item.name || item.activityId || ''), prix: item.priceKnown === true ? Number(item.price) : null, enPlus: true }))];
  }
  const adaptee = require('./formule-adaptee').lectureDeLaFormuleAdaptee(dossier);
  const deModifier = Boolean(adaptee) && (adaptee.enPlus || !adaptee.ajouts.ajoutees.length);
  const items = deModifier ? adaptee.ajouts.ajoutees : (dossier.program && Array.isArray(dossier.program.items) ? dossier.program.items : []);
  const lignes = items.map((item) => ({
    activite: String(item.activityId || ''),
    libelle: String(item.name || item.activityId || ''),
    prix: item.priceKnown === true && Number.isFinite(Number(item.price)) ? Number(item.price) : null,
  })).filter((ligne) => ligne.activite);
  return deModifier ? [{ activite: 'formule', libelle: String(adaptee.formule.name || ''), prix: adaptee.prixFormule }, ...lignes] : lignes;
}

// ---------------------------------------------------------------------------
// « CRÉER QUAND MÊME » : LE DOSSIER À PLACER.
// ---------------------------------------------------------------------------
function nomDuMembre(session) {
  // Le fondateur ne signe pas la note « À placer » (2026-11-13, lib/fondateur-invisible.js).
  if (require('./fondateur-invisible').estFondateur(session)) return '';
  const membre = session && session.member ? session.member : null;
  const nom = String((membre && (membre.name || membre.displayName)) || '').replace(/[<>]/g, '').trim();
  return (nom || 'Équipe').slice(0, 80);
}

function partiesLaserDuDossier(dossier) {
  const items = dossier.program && Array.isArray(dossier.program.items) ? dossier.program.items : [];
  const laser = items.find((item) => item && item.activityId === 'laser_game');
  if (laser) return Math.max(0, Math.trunc(Number((laser.extraLaser && laser.extraLaser.games) || laser.games) || 0));
  if (dossier.type === 'laser') return Math.max(1, Math.trunc(Number(dossier.laserGames || dossier.games) || 1));
  if (dossier.type === 'formule' && dossier.formuleId) {
    // (un acces illimite choisi sans le laser n en a aucune a placer : formuleDuDossier lit son choix)
    try {
      return ((require('./formula-choice').formuleDuDossier(getFormula(dossier.formuleId), dossier) || {}).steps || [])
        .filter((step) => step.activityId === 'laser_game')
        .reduce((somme, step) => somme + (Number(step.count) || 1), 0);
    } catch (error) {
      return 0;
    }
  }
  return 0;
}

// Les parties a placer, dans la forme que le glisser d une partie relit
// (laserPassPlan, lib/reservation-activity-move.js) : la console les montre
// « a placer » et l equipe les pose une a une.
function partiesAPlacer(dossier) {
  const parties = partiesLaserDuDossier(dossier);
  if (!parties) return null;
  const items = dossier.program && Array.isArray(dossier.program.items) ? dossier.program.items : [];
  const laser = items.find((item) => item && item.activityId === 'laser_game');
  const joueurs = Math.max(1, Math.trunc(Number((laser && laser.participants) || dossier.pax) || 1));
  let armes = 30;
  try { armes = Number(getCenter(dossier.centerId || 'libramont').resources.laser.weaponCount) || 30; } catch (error) { armes = 30; }
  const vagues = Math.max(1, Math.ceil(joueurs / armes));
  const unites = [];
  for (let partie = 1; partie <= parties; partie += 1) {
    for (let vague = 1; vague <= vagues; vague += 1) {
      unites.push({ countIndex: partie, groupWaveIndex: vague, groupWaveCount: vagues, unitKey: `${partie}.${vague}`,
        pax: Math.floor(joueurs / vagues) + (vague <= joueurs % vagues ? 1 : 0) });
    }
  }
  return {
    mode: 'manual_after_first',
    totalGames: parties,
    scheduledGames: 0,
    remainingGames: parties,
    scheduledUnits: [],
    pendingUnits: unites,
    scheduledPasses: [],
    pendingPasses: Array.from({ length: parties }, (_, index) => ({ countIndex: index + 1, status: 'pending', pax: joueurs })),
  };
}

// UN DOSSIER « À PLACER » (2026-10-08). Le comptoir le cree malgre ses
// conflits : il existe, avec son client, son prix et son programme, mais il
// n occupe RIEN tant que l equipe ne lui a pas trouve sa place. Aucune piste
// (lanes [] et laneCount 0 ; reservationNeedsLanes, lib/database.js, ne lui
// en attribue pas d office), aucun bloc de ressource (resourceBlocks vide,
// laserManual : ni la base ni le moteur ne lui inventent de partie laser),
// validation « a verifier », et une note de l equipe qui dit pourquoi, signee
// par la personne de la session.
function versAPlacer(dossier, { conflits = [], session = {}, demande = {}, maintenant = new Date() } = {}) {
  const { NOTE_EQUIPE_TAG, lireNoteEquipe } = require('./database');
  const par = nomDuMembre(session);
  const notesClient = String(dossier.notes || '').trim();
  // `le` est aussi la cle de la note : jamais deux fois le meme instant.
  const pris = new Set(notesClient.split('\n').map((ligne) => (lireNoteEquipe(ligne) || {}).le).filter(Boolean));
  let instant = maintenant.getTime();
  while (pris.has(new Date(instant).toISOString())) instant += 1;
  const le = new Date(instant).toISOString();
  const messages = conflits.map((conflit) => String(conflit.message || '')).filter(Boolean);
  const texte = `À placer : créé malgré ${messages.length > 1 ? 'les conflits' : 'le conflit'}. ${messages.join(' ')}`
    .replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const note = `${NOTE_EQUIPE_TAG}${JSON.stringify({ t: texte, par, le })}`;
  const voulues = (Array.isArray(demande.lanes) ? demande.lanes : []).map(Number).filter((piste) => Number.isInteger(piste) && piste > 0);
  const avant = dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : {};
  const laserPassPlan = partiesAPlacer(dossier);
  // (le choix d un acces illimite reste au dossier a placer : il se planifiera avec lui)
  const { choixQueLeDossierPorte, empreinteDuChoix } = require('./formule-comptoir');
  const choixIllimite = choixQueLeDossierPorte(dossier);
  const opsPlan = {
    aPlacer: {
      le,
      par,
      conflits: conflits.map((conflit) => ({ type: conflit.type, message: String(conflit.message || '') })),
      souhait: { startTime: dossier.startTime || '', lanes: voulues, ...(Number(demande.laneCount) > 0 ? { laneCount: Math.trunc(Number(demande.laneCount)) } : {}) },
    },
    laserManual: true,
    resourceBlocks: [],
    timeline: [],
    ...(avant.arene === 'seuls' ? { arene: 'seuls' } : {}),
    ...(avant.formulaChoice ? { formulaChoice: avant.formulaChoice } : {}),
    ...(choixIllimite ? { illimite: empreinteDuChoix(choixIllimite, choixIllimite.formuleId) } : {}),
    // (les activites en plus d une formule restent au dossier a placer : leurs lignes et leurs montants)
    ...(avant.enPlus ? { enPlus: avant.enPlus } : {}),
    ...(laserPassPlan ? { laserPassPlan } : {}),
    ...(avant.validation ? { validation: avant.validation } : {}),
  };
  return {
    ...dossier,
    lanes: [],
    laneCount: 0,
    requiresLanes: false,
    validationStatus: 'staff_review',
    opsPlan,
    notes: [notesClient, note].filter(Boolean).join('\n'),
  };
}

// LE DOSSIER « À PLACER » QUI A TROUVE SA PLACE (2026-11-19, un autre ordre applique) : la note
// ecrite par versAPlacer ne dit plus vrai, elle part dans la meme ecriture. Elle se reconnait a
// son instant (celui de opsPlan.aPlacer) et a son texte intact : une note que l equipe a retouchee
// reste. Rend les notes sans elle, ou null quand il n y a rien a retirer.
function notesSansLaNoteAPlacer(dossier) {
  const { lireNoteEquipe } = require('./database');
  const plan = dossier && dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : {};
  const le = plan.aPlacer && plan.aPlacer.le;
  if (!le) return null;
  const lignes = String(dossier.notes || '').split('\n');
  const gardees = lignes.filter((ligne) => {
    const note = lireNoteEquipe(ligne);
    return !(note && note.le === le && /^À placer : créé malgré /.test(note.t));
  });
  return gardees.length === lignes.length ? null : gardees.join('\n');
}

// ---------------------------------------------------------------------------
// LES AUTRES DOSSIERS DU MEME ENVOI.
// ---------------------------------------------------------------------------
// Un dossier deja simule, pose dans la journee comme une reservation : les
// suivants le voient occuper ses pistes et son arene. Identifiant negatif,
// loin de ceux des blocages en ligne (-1, -2...).
function reservationVirtuelle(dossier, index) {
  return {
    id: -900000 - index,
    virtuel: true,
    rang: index + 1,
    name: String(dossier.name || '').trim(),
    centerId: dossier.centerId,
    date: dossier.date,
    startTime: dossier.startTime,
    duration: dossier.duration,
    totalDuration: dossier.totalDuration,
    lanes: Array.isArray(dossier.lanes) ? dossier.lanes : [],
    pax: dossier.pax,
    type: dossier.type,
    formuleId: dossier.formuleId || '',
    program: dossier.program || null,
    opsPlan: dossier.opsPlan || null,
    status: 'pending',
    validationStatus: dossier.validationStatus || 'confirmed',
    channel: 'staff',
  };
}

function aUnConflitBloquant(conflits) {
  return (Array.isArray(conflits) ? conflits : []).some((conflit) => conflit && CONFLITS_BLOQUANTS.has(conflit.type));
}

// ---------------------------------------------------------------------------
// LES FERMETURES ET LES PRIVATISATIONS DANS LE PLAN DU COMPTOIR (2026-11-18).
// ---------------------------------------------------------------------------
// Les blocages du jour, resolus a la date, par le cache du centre. Fail-soft :
// sans eux, rien n est ajoute, et la creation (relecture fraiche sous verrou)
// garde le dernier mot.
async function fermeturesDuJour(date, centre) {
  try {
    const { loadAvailabilityBlocks, resolveBlocksForDate } = require('./availability-blocks');
    return resolveBlocksForDate(await loadAvailabilityBlocks(require('./database').getPool(), centre), date);
  } catch (error) {
    return [];
  }
}

// Le droit de rattacher un dossier a une privatisation : celui de privatiser (api/ops.js,
// getRequiredOpsPermission('POST', 'privatiser')).
const DROIT_DE_PRIVATISER = ['reservations.edit', 'settings.manage'];

// « Réserver pour Dupont » : le corps designe un blocage de la privatisation (`privatisation`) ;
// le groupe entier suit (meme nom, meme plage), s il est encore sans reservation et si la session a
// le droit de privatiser. Sinon rien : la privatisation reste opposable, et la fenetre le dit.
function groupeDuCorps(corps, snapshot, date, session) {
  const voulu = corps && corps.privatisation;
  if (voulu === undefined || voulu === null || voulu === '') return null;
  if (!sessionHasPermission(session, DROIT_DE_PRIVATISER)) return null;
  const { groupeAPartirDUnBlocage } = require('./privatisation');
  return groupeAPartirDUnBlocage((snapshot && snapshot.blocks) || [], date, voulu);
}

// Le conflit « fermeture » du dossier, jugé par la garde de la creation elle-meme
// (blocageDuDossier, lib/database.js) : la meme phrase avant « Créer » et au refus. Une
// privatisation dit son nom, sa plage et, quand le droit le permet, qu elle peut recevoir le
// dossier de son groupe (`peutLier`).
// Un dossier enregistre que le serveur replanifie (2026-11-18, un autre ordre : lib/autre-ordre.js)
// n est jamais refuse par SA privatisation : l exemption de l ecriture (updateReservation) ; les
// autres restent opposables. Son numero vient du serveur (`options.dossierReplanifie`), jamais du corps.
function conflitDeFermeture(dossier, snapshot, date, groupe) {
  const blocs = snapshot && Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
  if (!blocs.length) return null;
  const dossierId = typeof dossier.dossierReplanifie === 'function' ? Number(dossier.dossierReplanifie()) || 0 : 0;
  const exemption = groupe || dossierId ? { ids: groupe ? groupe.ids : [], reservationId: dossierId || null } : null;
  let verdict = null;
  try {
    verdict = require('./database').blocageDuDossier({ ...dossier, channel: 'staff' }, blocs, date, exemption ? { exemption } : {});
  } catch (error) {
    verdict = null;
  }
  if (!verdict) return null;
  const resume = { type: verdict.privatisation ? 'privatisation' : 'fermeture', phrase: verdict.message };
  if (verdict.privatisation && verdict.block) {
    const { privatisationsDuJour } = require('./privatisation');
    const sienne = privatisationsDuJour(blocs, date).find((g) => g.ids.includes(Number(verdict.block.id)));
    if (sienne) {
      Object.assign(resume, { nom: sienne.nom, plage: sienne.plage, ids: sienne.ids.slice(), libre: !sienne.reservationId });
    }
  }
  return { conflit: { type: 'fermeture', message: verdict.message, ...(verdict.privatisation ? { privatisation: true } : {}) }, resume };
}

// ---------------------------------------------------------------------------
// LA FONCTION UNIQUE.
// ---------------------------------------------------------------------------
// `options.readState(date, centre)` : la lecture de la journee (une seule par
// planification ; la simulation passe la sienne, lue une fois pour toutes les
// heures). `options.virtuelles` : les dossiers du meme envoi deja simules.
// `options.forcer` : « Créer quand même », le dossier part à placer s il a des
// conflits ; sans conflit, rien ne change.
//
// LES DROITS (2026-11-03) se decident ici, sur ce que la session vaut, et le
// refus se leve a l ecriture (exigerLesDroits, avant createReservation) : la
// simulation montre le meme plan et le meme prix, elle ne refuse rien. La
// reference ne vient jamais du corps, et les notes d equipe y sont resignees.
async function planifierPourLaFenetre(body = {}, session = {}, options = {}) {
  // LE CENTRE DE LA SESSION, jamais celui d un dossier : le controle de droit
  // a porte sur lui (requireStaffPermission), un dossier d un lot ne peut pas
  // viser un autre centre en douce.
  const centreSession = String((session && session.authorizedCenterId) || '').trim();
  const corps = { ...(body || {}), ...(centreSession ? { centerId: centreSession } : {}) };
  corps.status = statutDeCreation(corps.status, session);
  delete corps.center_id;
  const { extras: extrasResolus, refus: refusDesExtras } = resoudreExtras({ extras: corps.extras, session, centerId: corps.centerId, pax: corps.pax });
  corps.extras = extrasResolus;
  if (typeof corps.notes === 'string') corps.notes = require('./database').signerNotesEquipe(corps.notes, { par: nomDeSession(session) });
  const request = normalizeReservationRequest(corps, { channel: 'staff', centerId: centreSession });
  const formuleAdaptee = formuleAdapteeDuCorps(corps);
  const envoye = prixEnvoye(corps.price);
  if (formuleAdaptee) {
    // Le prix de reference est celui de la formule ; le prix facture, celui
    // que la fenetre envoie, sinon la reference et les extras. Ses ajouts se
    // chiffrent apres le plan (chiffrerLaFormuleAdaptee).
    const reference = getBasePrice('formule', request.duration, Number(request.laneCount) || 0, Number(request.pax) || 1, formuleAdaptee, request.centerId);
    request.type = 'formule';
    request.basePrice = reference;
    request.price = envoye !== null ? envoye : prixAvecExtras(reference, request.extras);
  } else if (!request.program) {
    request.basePrice = tarifDeReference(request);
  }
  const lire = typeof options.readState === 'function'
    ? options.readState
    : (date, centre) => require('./database').readStaffState(date, centre, { avecBlocages: true, avecFermetures: true });
  const virtuelles = Array.isArray(options.virtuelles) ? options.virtuelles : [];
  let snapshot = null;
  const lecture = async (date, centre) => {
    if (!snapshot) {
      const lu = (await lire(date, centre)) || {};
      const memeJour = virtuelles.filter((virtuelle) => virtuelle && virtuelle.date === date && (!virtuelle.centerId || virtuelle.centerId === centre));
      // LES FERMETURES ET PRIVATISATIONS DU JOUR (2026-11-18) : celles que la lecture porte, sinon le
      // cache des blocages du centre (fail-soft : sans elles, la creation garde le dernier mot).
      const blocks = Array.isArray(lu.blocks) ? lu.blocks : await fermeturesDuJour(date, centre);
      snapshot = { ...lu, blocks, reservations: [...(Array.isArray(lu.reservations) ? lu.reservations : []), ...memeJour], laneStatuses: lu.laneStatuses || {} };
    }
    return snapshot;
  };
  // (une heure posee a la minute se juge a sa minute dans le moteur : prepareReservationOps, aLaMinute)
  const heuresPosees = lireHeuresPosees(corps.heuresPosees);
  const ops = await prepareReservationOps(formuleAdaptee ? { ...request, formuleId: formuleAdaptee } : request, 'staff', { readState: lecture, ...(ancresALaMinute(heuresPosees) ? { aLaMinute: true } : {}) });
  const programmeAdapte = formuleAdaptee ? chiffrerLaFormuleAdaptee(request, ops, formuleAdaptee, envoye) : null;
  const dossier = {
    ...request,
    ...ops,
    // Apres le plan : le moteur reecrit type, libelle et prix d un dossier a
    // programme ; une formule adaptee garde les siens.
    ...(formuleAdaptee ? {
      type: 'formule',
      formuleId: formuleAdaptee,
      label: request.label || ops.label || '',
      basePrice: request.basePrice,
      price: request.price,
      ...(programmeAdapte ? { program: programmeAdapte } : {}),
    } : {}),
    channel: request.channel || 'staff',
  };
  const pistes = lanesDuPlan(dossier.opsPlan);
  if (pistes.length) dossier.lanes = pistes;
  // LES HEURES POSEES A LA MAIN (lib/heures-posees.js, 2026-11-19) : apres le moteur, par le chemin de
  // Modifier, sur la journee que le plan vient de lire. Une heure qui ne passe pas rend le plan impossible,
  // avec la phrase de Modifier, et le dossier ne se cree pas sans « Créer quand même ».
  // UN PLAN EN SOUS-GROUPES (2026-11-22, lib/grand-groupe.js) pose lui-meme le bowling et le laser de
  // chaque sous-groupe depuis le premier depart demande, a la minute comprise (aLaMinute) : leurs heures
  // posees l ont deja ouvert. Rejouees par-dessus, elles deplacaient tous les passages d un bloc : un
  // laser pose a 21:40 pour un groupe qui tourne des 19:40 partait apres la fermeture. Les autres
  // activites gardent leur heure posee.
  const enSousGroupes = Boolean(dossier.opsPlan) && (Array.isArray(dossier.opsPlan.resourceBlocks) ? dossier.opsPlan.resourceBlocks : []).some((bloc) => bloc && Number(bloc.sousGroupe) > 0);
  const aPoser = enSousGroupes ? heuresPosees.filter((posee) => posee.activityId !== 'bowling' && posee.activityId !== 'laser_game') : heuresPosees;
  // (les activites en plus d une formule se lisent avant tout calcul : un corps forge est refuse en entier)
  const enPlus = lireEnPlusDuCorps(corps, request, formuleAdaptee);
  let heureRefusee = null;
  if (aPoser.length && dossier.opsPlan && ops.planAvailable !== false) {
    const jour = await lecture(request.date, request.centerId);
    const pose = poserLesHeures(dossier, aPoser, { reservations: jour.reservations, laneStatuses: jour.laneStatuses, blocks: jour.blocks, date: request.date });
    if (pose.refus) {
      heureRefusee = pose.refus;
      ops.planAvailable = false;
      ops.planRefusal = pose.refus.message;
      dossier.planAvailable = false;
    } else {
      dossier.opsPlan = pose.dossier.opsPlan;
      const posees = lanesDuPlan(dossier.opsPlan);
      if (posees.length) dossier.lanes = posees;
    }
  }
  // LES ACTIVITES EN PLUS D UNE FORMULE (2026-11-22, lib/formule-en-plus.js) : la formule planifiee telle
  // quelle, chaque activite en plus planifiee seule par le meme moteur sur la meme journee (la formule y
  // compte), a son heure, puis posee a cote. Une activite en plus qui ne tient pas, ou qui chevauche ce que
  // la formule fait a heure fixe, rend le plan impossible avec sa phrase, comme une heure posee.
  const conflitsEnPlus = [];
  if (enPlus.length) {
    // (la formule elle-meme ne tient pas : les activites en plus gardent leurs lignes et leurs montants, sans
    // plan a elles, le refus reste celui de la formule)
    const pose = dossier.opsPlan && ops.planAvailable !== false && !heureRefusee
      ? await poserLesEnPlus({ corps, enPlus, dossier, request, session, jour: await lecture(request.date, request.centerId) })
      : { lignes: lignesSansPlan({ corps, enPlus, dossier, request }), conflits: [], sansPlan: true };
    conflitsEnPlus.push(...pose.conflits);
    if (pose.sansPlan) dossier.opsPlan = dossier.opsPlan ? { ...dossier.opsPlan, enPlus: pose.lignes } : dossier.opsPlan;
    else if (pose.refus) {
      heureRefusee = pose.refus;
      ops.planAvailable = false;
      ops.planRefusal = pose.refus.message;
      dossier.planAvailable = false;
      dossier.opsPlan = { ...dossier.opsPlan, enPlus: pose.lignes };
    } else Object.assign(dossier, pose.dossier);
    // (la reference est le prix de la formule plus celui des activites en plus ; un prix envoye reste facture)
    const reference = Math.round(((Number(dossier.basePrice) || 0) + (Number(pose.lignes.prix) || 0)) * 100) / 100;
    dossier.basePrice = reference;
    dossier.price = envoye !== null ? envoye : prixAvecExtras(reference, request.extras);
    request.basePrice = reference;
  }
  // « Réserver pour Dupont » : le dossier du groupe prive, rattache a sa privatisation encore libre.
  // Jamais un champ du corps (un client n en envoie pas) : une fonction, posee ici, apres le droit.
  delete dossier.privatisationDuGroupe;
  const groupe = groupeDuCorps(corps, snapshot, request.date, session);
  if (groupe) dossier.privatisationDuGroupe = () => groupe.ids.slice();
  delete dossier.dossierReplanifie;
  const replanifie = Number(options.dossierReplanifie) || 0;
  if (replanifie > 0) dossier.dossierReplanifie = () => replanifie;
  const fermeture = conflitDeFermeture(dossier, snapshot, request.date, groupe);
  const conflits = [
    ...(fermeture ? [fermeture.conflit] : []),
    ...conflitsDuPlan(ops, dossier),
    ...conflitsDArene(ops),
    ...conflitsEnPlus,
    ...conflitsDePistes({ demande: corps, dossier, snapshot: snapshot || {}, centerId: request.centerId }),
  ];
  const plan = { ...resumerPlanPourLaFenetre(dossier, ops), conflits, lignesPrix: lignesPrixDuDossier(dossier) };
  // UNE FERMETURE OU UNE PRIVATISATION SE DIT AVANT « Créer » (2026-11-18). Le plan du moteur ne
  // lit pas les fermetures du centre (la garde de la creation, si) : la fenetre annoncait « possible »
  // puis la creation refusait. Le plan ne tient pas, et la phrase est celle de la creation.
  if (fermeture) {
    plan.disponible = false;
    plan.refus = fermeture.conflit.message;
    plan.fermeture = fermeture.resume;
  }
  if (groupe) plan.pourPrivatisation = { nom: groupe.nom, plage: groupe.plage, ids: groupe.ids.slice() };
  // (l heure posee qui coince se dit a son activite, sur le ticket ; celle d une activite en plus, a sa ligne)
  if (heureRefusee) plan.heureRefusee = { activite: heureRefusee.activite, heure: heureRefusee.heure, ...(heureRefusee.enPlus ? { enPlus: true } : {}) };
  const aPlacer = options.forcer === true && conflits.length > 0;
  const droits = { refus: null, notePrix: null };
  try {
    if (aPlacer) exigerForcer(session);
    if (sousLeConseil(request, dossier)) exigerPistesALaMain(session);
    // (une activite en plus d une formule demande le meme niveau que l adapter : le role qui ne le peut pas
    // reserve la formule telle quelle, ou retire la formule pour composer a la carte)
    if (corpsAdapteUneFormule(corps, formuleAdaptee) || corps.formuleSurMesure || enPlus.length) exigerAdaptationDeFormule(session);
    exigerFormuleDuCentre({ formuleId: corps.formuleId || corps.formulaId, centerId: request.centerId });
    if (refusDesExtras) throw refusDesExtras;
    droits.notePrix = jugerPrixDeCreation({ session, dossier, raison: corps.prixRaison });
  } catch (error) {
    if (!error || error.droit !== true) throw error;
    droits.refus = error;
  }
  const final = aPlacer ? versAPlacer(dossier, { conflits, session, demande: corps }) : dossier;
  return {
    request,
    ops,
    dossier: droits.notePrix
      ? { ...final, notes: require('./database').notesAvecPrix(final.notes, droits.notePrix) }
      : final,
    conflits,
    plan,
    aPlacer,
    droits,
    heureRefusee: heureRefusee && !aPlacer ? Object.assign(new Error(heureRefusee.message), { statusCode: 409, expose: true }) : null,
    groupesRefuses: aPlacer ? null : refusDesGroupes(ops, dossier.opsPlan),
  };
}

// « CRÉER » SUR DES GROUPES QUI NE TIENNENT PAS DIT LESQUELS (2026-11-23, lib/grand-groupe.js). Le moteur sait
// le groupe, l activite et l heure qui coincent (groupesQuiCoincent, la case rouge de la fenetre) ; sans eux, le
// dossier partait quand meme a la base, qui refusait plus loin : « Ce créneau vient de changer. Merci de
// relancer la recherche avant de confirmer. », alors que rien n avait change et sans dire quoi deplacer (60
// joueurs en 4 groupes, un autre dossier sur 4 pistes a 16:30 ; ou 20 joueurs d un autre dossier au laser).
// Rien ne se cree (sauf « Créer quand même », qui part a placer), et la phrase dit chaque groupe qui coince.
function refusDesGroupes(ops, opsPlan) {
  const coincent = ops && ops.planAvailable === false && Array.isArray(ops.groupesQuiCoincent) ? ops.groupesQuiCoincent : [];
  const dit = coincent.length ? phraseDesGroupesQuiCoincent(coincent, opsPlan) : '';
  if (!dit) return null;
  return Object.assign(new Error(`Ces groupes ne tiennent pas au planning : ${dit}`), { statusCode: 409, expose: true, coincent: coincent.map((x) => ({ ...x })) });
}

// Une phrase par groupe qui coince : son groupe, son activite et son heure, quand la raison du moteur ne les
// dit pas deja (« Groupe 2, bowling : pas assez de pistes libres à 16:30 : il en faut 3. »).
function phraseDesGroupesQuiCoincent(coincent, opsPlan) {
  const blocs = Array.isArray(opsPlan && opsPlan.resourceBlocks) ? opsPlan.resourceBlocks : [];
  const noms = { bowling: 'bowling', laser_game: 'laser' };
  const phrases = [];
  coincent.forEach((x) => {
    const n = Math.trunc(Number(x && x.groupe)) || 0;
    const raison = String((x && x.raison) || '').trim();
    if (!n || !raison) return;
    let phrase = raison;
    if (!new RegExp(`^Groupe ${n}\\b`).test(raison)) {
      const nom = noms[x.activite] || String(x.activite || '').replace(/_/g, ' ');
      const bloc = blocs.find((b) => b && Number(b.sousGroupe) === n && b.activityId === x.activite && /^\d{2}:\d{2}/.test(String(b.startTime || '')));
      const heure = bloc ? String(bloc.startTime).slice(0, 5) : '';
      const quoi = [nom && !raison.toLowerCase().includes(nom) ? nom : '', heure && !raison.includes(heure) ? `à ${heure}` : ''].filter(Boolean).join(' ');
      phrase = `Groupe ${n}${quoi ? `, ${quoi}` : ''} : ${raison.charAt(0).toLowerCase()}${raison.slice(1)}`;
    }
    if (!/[.!?]$/.test(phrase)) phrase += '.';
    if (!phrases.includes(phrase)) phrases.push(phrase);
  });
  return phrases.join(' ');
}

// Le plan met-il plus de joueurs sur ses pistes que le centre n en conseille, parce que le
// comptoir en a pose le nombre a la main ? Sans nombre pose, le moteur reste dans la regle.
function sousLeConseil(request, dossier) {
  // (les pistes d un groupe posees sur la page des groupes comptent comme un nombre pose a la main)
  const groupes = request.preference && request.preference.grandGroupe;
  const parGroupe = Boolean(groupes && Array.isArray(groupes.pistes) && groupes.pistes.some((n) => Number(n) > 0));
  const pose = Math.trunc(Number(request.pistesALaMain) || 0);
  if (!pose && !parGroupe) return false;
  const normale = Number(getCenter(request.centerId).resources?.bowling?.normalCapacityPerLane) || 6;
  return blocsDePistes(dossier.opsPlan).some((bloc) => (pose || Number(bloc.pistesALaMain) > 0) && (Number(bloc.players) || 0) > (Array.isArray(bloc.lanes) ? bloc.lanes.length : pose) * normale);
}

// LE PASSAGE OBLIGE AVANT createReservation : creerDepuisLaFenetre, pour la
// creation seule comme pour chaque dossier d un lot.
function exigerLesDroits(prepare) {
  if (prepare.droits.refus) throw prepare.droits.refus;
  // Une heure posee a la main qui ne tient pas : rien ne se cree (sauf « Créer quand même »).
  if (prepare.heureRefusee) throw prepare.heureRefusee;
  // Des groupes qui ne tiennent pas : de meme, et la phrase dit lesquels (refusDesGroupes).
  if (prepare.groupesRefuses) throw prepare.groupesRefuses;
}

// Les autres dossiers du meme envoi, simules dans l ordre avant le dossier
// principal, chacun sur la journee qui contient deja les precedents. Un
// dossier sans plan, ou que la base refuserait (conflit bloquant), n occupe
// rien : il n est pas pose dans la journee.
async function simulerAutres(autres, session, { readState } = {}) {
  const virtuelles = [];
  const plans = [];
  const liste = Array.isArray(autres) ? autres : [];
  for (let index = 0; index < liste.length; index += 1) {
    const corps = liste[index];
    if (!corps || typeof corps !== 'object' || Array.isArray(corps)) {
      plans.push({ index, erreur: 'Dossier invalide.' });
      continue;
    }
    try {
      const resultat = await planifierPourLaFenetre(corps, session, { readState, virtuelles: [...virtuelles] });
      plans.push({ index, plan: resultat.plan });
      if (resultat.dossier.opsPlan && resultat.ops.planAvailable !== false && !aUnConflitBloquant(resultat.conflits)) {
        virtuelles.push(reservationVirtuelle(resultat.dossier, index));
      }
    } catch (error) {
      plans.push({ index, erreur: String((error && error.message) || 'Erreur du moteur.') });
    }
  }
  return { virtuelles, plans };
}

module.exports = {
  aUnConflitBloquant,
  conflitsDePistes,
  exigerLesDroits,
  finDeLaVisite,
  finDesActivites,
  formuleAdapteeDuCorps,
  lanesDuPlan,
  lignesPrixDuDossier,
  notesSansLaNoteAPlacer,
  planifierPourLaFenetre,
  reposerLesEnPlus,
  reservationVirtuelle,
  resumerPlanPourLaFenetre,
  simulerAutres,
  versAPlacer,
};

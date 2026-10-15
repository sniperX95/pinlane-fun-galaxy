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

const { normalizeReservationRequest, prixAvecExtras, prixEnvoye } = require('./reservation-request');
const { prepareReservationOps } = require('./reservation-ops');
const { getBasePrice } = require('./booking-config');
const { getCenter, getFormula } = require('./ops-knowledge');
const { CONFLITS_BLOQUANTS, heureDe, minutesDe } = require('./reserver-simulation');
const { attenteDuSousGroupe, mesurerLaVisite } = require('./ops-engine');
const { attenteDesTours } = require('./visit-program');

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
  const libres = (Array.isArray(programme.freeItems) ? programme.freeItems : lignesDuDossier)
    .filter((ligne) => ligne && !ligne.planned);
  const somme = (lignes) => lignes.reduce((total, ligne) => total + Math.max(0, Math.round(Number(ligne.minutes) || 0)), 0);
  const mesure = mesurerLaVisite({ debut, plan, libre: somme(libres), libres, attenteLibre: somme(libres.filter((ligne) => ligne.waitOffer === true)), creux });
  const partiesApres = Boolean(plan.laserPassPlan && Array.isArray(plan.laserPassPlan.pendingPasses) && plan.laserPassPlan.pendingPasses.length);
  const base = partiesApres && mesure.apresLePlan > dernierPas ? mesure.apresLePlan : dernierPas;
  return heureDe(base + mesure.libreApres) || finPas;
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
    })),
    etapes: etapes.map((etape) => ({
      activite: String(etape.activityId || ''),
      debut: heureDuPlan(etape.startTime),
      fin: heureDuPlan(etape.endTime),
      libelle: String(etape.label || ''),
      libre: Boolean(etape.flexible),
    })).filter((etape) => etape.activite && etape.debut),
    prix: nombreDuPlan(dossier.price),
    prixReference: nombreDuPlan(dossier.basePrice),
    libelle: String(dossier.label || ''),
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
  return nom || `le dossier n° ${reservation.id}`;
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
function lignesPrixDuDossier(dossier = {}) {
  const items = dossier.program && Array.isArray(dossier.program.items) ? dossier.program.items : [];
  return items.map((item) => ({
    activite: String(item.activityId || ''),
    libelle: String(item.name || item.activityId || ''),
    prix: item.priceKnown === true && Number.isFinite(Number(item.price)) ? Number(item.price) : null,
  })).filter((ligne) => ligne.activite);
}

// ---------------------------------------------------------------------------
// « CRÉER QUAND MÊME » : LE DOSSIER À PLACER.
// ---------------------------------------------------------------------------
function nomDuMembre(session) {
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
    try {
      return ((getFormula(dossier.formuleId) || {}).steps || [])
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
// LA FONCTION UNIQUE.
// ---------------------------------------------------------------------------
// `options.readState(date, centre)` : la lecture de la journee (une seule par
// planification ; la simulation passe la sienne, lue une fois pour toutes les
// heures). `options.virtuelles` : les dossiers du meme envoi deja simules.
// `options.forcer` : « Créer quand même », le dossier part à placer s il a des
// conflits ; sans conflit, rien ne change.
async function planifierPourLaFenetre(body = {}, session = {}, options = {}) {
  // LE CENTRE DE LA SESSION, jamais celui d un dossier : le controle de droit
  // a porte sur lui (requireStaffPermission), un dossier d un lot ne peut pas
  // viser un autre centre en douce.
  const centreSession = String((session && session.authorizedCenterId) || '').trim();
  const corps = { ...(body || {}), ...(centreSession ? { centerId: centreSession } : {}) };
  delete corps.center_id;
  const request = normalizeReservationRequest(corps, { channel: 'staff', centerId: centreSession });
  const formuleAdaptee = formuleAdapteeDuCorps(corps);
  if (formuleAdaptee) {
    // Le prix de reference est celui de la formule ; le prix facture, celui
    // que la fenetre envoie, sinon la reference et les extras.
    const reference = getBasePrice('formule', request.duration, Number(request.laneCount) || 0, Number(request.pax) || 1, formuleAdaptee, request.centerId);
    request.type = 'formule';
    request.basePrice = reference;
    const envoye = prixEnvoye(corps.price);
    request.price = envoye !== null ? envoye : prixAvecExtras(reference, request.extras);
  }
  const lire = typeof options.readState === 'function'
    ? options.readState
    : (date, centre) => require('./database').readStaffState(date, centre, { avecBlocages: true });
  const virtuelles = Array.isArray(options.virtuelles) ? options.virtuelles : [];
  let snapshot = null;
  const lecture = async (date, centre) => {
    if (!snapshot) {
      const lu = (await lire(date, centre)) || {};
      const memeJour = virtuelles.filter((virtuelle) => virtuelle && virtuelle.date === date && (!virtuelle.centerId || virtuelle.centerId === centre));
      snapshot = { ...lu, reservations: [...(Array.isArray(lu.reservations) ? lu.reservations : []), ...memeJour], laneStatuses: lu.laneStatuses || {} };
    }
    return snapshot;
  };
  const ops = await prepareReservationOps(formuleAdaptee ? { ...request, formuleId: formuleAdaptee } : request, 'staff', { readState: lecture });
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
    } : {}),
    channel: request.channel || 'staff',
  };
  const pistes = lanesDuPlan(dossier.opsPlan);
  if (pistes.length) dossier.lanes = pistes;
  const conflits = [
    ...conflitsDuPlan(ops, dossier),
    ...conflitsDArene(ops),
    ...conflitsDePistes({ demande: corps, dossier, snapshot: snapshot || {}, centerId: request.centerId }),
  ];
  const plan = { ...resumerPlanPourLaFenetre(dossier, ops), conflits, lignesPrix: lignesPrixDuDossier(dossier) };
  const aPlacer = options.forcer === true && conflits.length > 0;
  return {
    request,
    ops,
    dossier: aPlacer ? versAPlacer(dossier, { conflits, session, demande: corps }) : dossier,
    conflits,
    plan,
    aPlacer,
  };
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
  finDeLaVisite,
  finDesActivites,
  formuleAdapteeDuCorps,
  lanesDuPlan,
  lignesPrixDuDossier,
  planifierPourLaFenetre,
  reservationVirtuelle,
  resumerPlanPourLaFenetre,
  simulerAutres,
  versAPlacer,
};

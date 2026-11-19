'use strict';
// LE GROUPE GARDE SES PISTES ET SES ARMES PENDANT TOUTE SA VISITE (2026-11-19).
//
// Ansar, le 19/11, a la question « bowling et laser compris une fois ou a volonte ? » : « pour
// illimite on peut choisir absolument toutes les activites en illimite, on peut choisir quoi et
// tout ». La demande vient de Marius, manager de Gembloux : un petit team building qui a acces a
// toutes les activites. Le choix vit dans la formule (lib/formule-comptoir.js, orderPolicy
// « illimite:bowling,laser_game ») ; ce module en fait des ressources gardees.
//
// LA REPRESENTATION, LA PLUS PETITE QUI SOIT HONNETE. Le moteur sait deja dire « cette ressource
// est prise de telle heure a telle heure » : c est un bloc de ressource du plan (resourceBlocks).
// Tout ce qui juge la place le lit deja : le moteur pour le groupe suivant (evaluateConflicts,
// allocateLanes), la base a l ecriture (lanesConflict, ensureLaserCapacity), la console
// (getOccupiedLanes, getLaserAvailability), le formulaire en ligne, le planning et la garde des
// surcharges du laser. Garder une ressource pendant toute une fenetre, c est donc poser ses blocs
// sur toute la fenetre, sans rien apprendre a ces lecteurs :
//   - BOWLING A VOLONTE : UN bloc de pistes du debut a la fin de la visite vendue. Le nombre de
//     pistes est celui du groupe (celui de son premier service quand il est trop grand pour les
//     pistes, les services tournent alors sur les memes pistes), et les pistes se choisissent par
//     la regle commune (assets/pinlane-pistes.js, via allocateLanes) sur toute la fenetre ;
//   - LASER A VOLONTE : un bloc d arene a CHAQUE depart de la visite (la grille :00/:30), avec
//     autant d armes que de joueurs, dans la limite de l arene. Un bloc d arene ne vaut qu une
//     partie (normalizeLaserArenaBlock, normalizeLaserArenaEnd) : un seul long bloc ne se lirait
//     qu au premier depart, et un autre groupe pourrait prendre les suivants.
// Pendant ce temps le groupe fait le reste : les activites libres gardent leur place dans le
// programme, comme aujourd hui. Les blocs gardes portent `aVolonte`, que les ecrans lisent pour le
// dire (assets/pinlane-a-volonte.js). Rien d autre ne change dans le plan.
//
// CE QUI N EST PAS GARDE : le duckpin et le billard. Le moteur ne les tient pas comme des
// ressources (ni dans CRITICAL_RESOURCE_TYPES, ni declares par un centre) : leur dotation n est
// comptee que pour une visite composee (dotationDepassee, lib/reservation-ops.js), avec les regles
// d aujourd hui. Les garder demanderait de les faire entrer dans le moteur, un autre chantier.
const { LASER_GAME_ARENA_MINUTES } = require('./booking-config');
const { activitesAVolonte, dureeIllimitee } = require('./formule-comptoir');

const GRILLE_DES_DEPARTS = 30;

function heure(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// La duree vendue : celle de la carte (une formule adaptee au comptoir a perdu les tranches des
// activites retirees, pas la duree de la visite), sinon celle des etapes recues.
function dureeVendue(formula) {
  let minutes = dureeIllimitee(formula && formula.steps);
  try {
    const { getFormula } = require('./ops-knowledge');
    const carte = formula && formula.id ? getFormula(formula.id) : null;
    if (carte && Array.isArray(carte.steps)) minutes = Math.max(minutes, dureeIllimitee(carte.steps));
  } catch (error) {
    // La formule n est pas au catalogue (une visite composee) : ses etapes font foi.
  }
  return minutes;
}

// Le scenario du moteur, ses pistes et ses armes gardees sur toute la visite. Sans activite a
// volonte, le scenario tel quel : une formule ordinaire ou illimitee « une fois » ne change pas.
function garderPourLaVisite({ center, formula, scenario }) {
  const gardees = activitesAVolonte(formula);
  if (!gardees.length || !scenario || !Array.isArray(scenario.resourceBlocks) || !Array.isArray(scenario.timeline)) return scenario;
  const debut = Number(scenario.start);
  const fin = Math.max(Number(scenario.end) || 0, debut + dureeVendue(formula));
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return scenario;
  const garderBowling = gardees.includes('bowling');
  const garderLaser = gardees.includes('laser_game');
  const pistes = garderBowling ? scenario.resourceBlocks.filter((bloc) => bloc && bloc.resourceType === 'bowling_lane') : [];
  const lasers = garderLaser ? scenario.resourceBlocks.filter((bloc) => bloc && bloc.resourceType === 'laser_arena') : [];
  if (!pistes.length && !lasers.length) return scenario;
  const remplace = (bloc) => Boolean(bloc) && ((pistes.length && bloc.resourceType === 'bowling_lane') || (lasers.length && bloc.resourceType === 'laser_arena'));
  const blocs = scenario.resourceBlocks.filter((bloc) => !remplace(bloc));
  const etapes = scenario.timeline.filter((etape) => !remplace(etape));

  if (pistes.length) {
    // Le service qui demande le plus de pistes : un groupe trop grand pour les pistes tourne sur
    // elles, il ne les double pas.
    const ref = pistes.reduce((a, b) => ((Number(b.requiredLanes) || 0) > (Number(a.requiredLanes) || 0) ? b : a));
    const bloc = {
      type: 'activity',
      activityId: 'bowling',
      label: 'Bowling',
      resourceType: 'bowling_lane',
      countIndex: 1,
      critical: true,
      aVolonte: true,
      start: debut,
      end: fin,
      startTime: heure(debut),
      endTime: heure(fin),
      durationMinutes: fin - debut,
      requiredLanes: Math.max(1, Number(ref.requiredLanes) || 1),
      players: Math.max(1, Number(ref.players) || 1),
      ...(Number(ref.pistesALaMain) > 0 ? { pistesALaMain: Number(ref.pistesALaMain) } : {}),
      ...(ref.games ? { games: ref.games } : {}),
      ...(Array.isArray(ref.preferredLanes) && ref.preferredLanes.length ? { preferredLanes: ref.preferredLanes.slice() } : {}),
    };
    blocs.push(bloc);
    etapes.push(bloc);
  }

  if (lasers.length) {
    const armes = Math.max(1, Number(center && center.resources && center.resources.laser && center.resources.laser.weaponCount) || 30);
    const groupe = Math.max(1, ...lasers.map((bloc) => Number(bloc.groupPlayers || bloc.players) || 0));
    const joueurs = Math.min(groupe, armes);
    const premier = Math.ceil(debut / GRILLE_DES_DEPARTS) * GRILLE_DES_DEPARTS;
    let rang = 0;
    for (let depart = premier; depart + LASER_GAME_ARENA_MINUTES <= fin; depart += GRILLE_DES_DEPARTS) {
      rang += 1;
      blocs.push({
        type: 'activity',
        activityId: 'laser_game',
        label: 'Laser Game',
        resourceType: 'laser_arena',
        countIndex: rang,
        critical: true,
        aVolonte: true,
        start: depart,
        end: depart + LASER_GAME_ARENA_MINUTES,
        startTime: heure(depart),
        endTime: heure(depart + LASER_GAME_ARENA_MINUTES),
        durationMinutes: LASER_GAME_ARENA_MINUTES,
        players: joueurs,
        groupPlayers: groupe,
        groupWaveIndex: 1,
        groupWaveCount: 1,
        weaponNeed: joueurs,
      });
    }
    // Le programme du groupe : le laser se joue quand il veut, d un depart a la fin de la visite.
    if (rang) {
      etapes.push({
        type: 'activity',
        activityId: 'laser_game',
        label: 'Laser Game',
        resourceType: 'laser_arena',
        countIndex: 1,
        critical: true,
        aVolonte: true,
        start: premier,
        end: fin,
        startTime: heure(premier),
        endTime: heure(fin),
        durationMinutes: fin - premier,
        players: joueurs,
        groupPlayers: groupe,
      });
    }
  }

  const parDebut = (a, b) => (Number(a.start) || 0) - (Number(b.start) || 0);
  return {
    ...scenario,
    resourceBlocks: blocs.sort(parDebut),
    // (l accueil, a la meme minute que la premiere activite, reste en tete : le tri garde l ordre des egaux)
    timeline: etapes.sort(parDebut),
    end: fin,
    totalMinutes: fin - debut,
    gardeAVolonte: { debut, fin, bowling: pistes.length > 0, laser: lasers.length > 0 },
  };
}

// CE QUI BLOQUE, EN CLAIR. Les refus du moteur parlent d une heure (« Pas assez de pistes libres a
// 15:30 », « Décalez le départ ») : pour une visite gardee, c est toute la fenetre qui compte. Les
// faits du conflit (pistes libres et voulues, armes restantes et voulues) restent : l horloge de la
// fenetre Reserver en tire son mot (« manque 1 piste », lib/reserver-simulation.js).
function phraserLaGarde(conflicts, scenario) {
  const garde = scenario && scenario.gardeAVolonte;
  if (!garde || !Array.isArray(conflicts) || !conflicts.length) return conflicts;
  const de = heure(garde.debut);
  const a = heure(garde.fin);
  return conflicts.map((conflit) => {
    if (!conflit || conflit.bloque === true) return conflit;
    if (garde.bowling && conflit.type === 'bowling_conflict') {
      const voulues = Math.max(1, Math.trunc(Number(conflit.voulues) || 1));
      const libres = Math.max(0, Math.trunc(Number(conflit.libres) || 0));
      const reste = libres === 0 ? 'aucune ne l’est' : libres === 1 ? 'une seule l’est' : `seulement ${libres} le sont`;
      return { ...conflit, aVolonte: true, message: `Bowling à volonté : il faut ${voulues} piste${voulues > 1 ? 's' : ''} libre${voulues > 1 ? 's' : ''} de ${de} à ${a}, ${reste}. Choisissez une autre heure.` };
    }
    if (garde.laser && conflit.type === 'laser_conflict') {
      const lue = /(\d{1,2}:\d{2})/.exec(String(conflit.message || ''));
      const quand = lue ? `au départ de ${lue[1]}` : 'à un départ de la visite';
      if (conflit.arenePrise) return { ...conflit, aVolonte: true, message: `Laser à volonté : l’arène est déjà prise ${quand}. Choisissez une autre heure.` };
      const reste = Number(conflit.reste);
      const groupe = Number(conflit.groupe);
      if (Number.isFinite(reste) && groupe > 0) {
        return { ...conflit, aVolonte: true, message: `Laser à volonté : ${reste > 0 ? `il reste ${reste} arme${reste > 1 ? 's' : ''}` : 'plus aucune arme n’est libre'} ${quand}, il en faut ${groupe} à chaque départ de ${de} à ${a}. Choisissez une autre heure.` };
      }
    }
    return conflit;
  });
}

module.exports = { garderPourLaVisite, phraserLaGarde };

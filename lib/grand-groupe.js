'use strict';
// UN GRAND GROUPE QUI TOURNE (2026-11-22).
//
// Ansar, au comptoir : « Quand ya grand groupe et qu on réserve sur côté staff logiciel avec
// réservation par exemple 60 personne pour bowling il gère pas dutout genre il est comme l autre
// qui sait diviser groupe etc pour multi activité en plus etc ». L autre, c est le formulaire en
// ligne : il coupe deja un groupe trop grand, le bowling en services (lib/booking-config.js
// splitGroupIntoBowlingServices), le laser en vagues (lib/ops-engine.js vaguesDuLaser).
//
// Avec deux activites, ces coupes se jouaient l une apres l autre : tout le bowling du groupe, puis
// tout son laser, et une moitie du groupe attendait a chaque fois (60 joueurs a Libramont : trois
// heures). Ici le groupe se coupe en SOUS-GROUPES QUI TOURNENT : le groupe 1 au bowling pendant
// que le groupe 2 joue au laser, puis ils échangent (deux heures).
//
// Ce module ne lit ni la base ni le centre. Le moteur (lib/ops-engine.js,
// composeAnchoredFormulaScenario) lui donne les parts que les regles du centre ont deja coupees,
// les durees et la place du centre ; il rend les sous-groupes et l heure de chacun a chaque
// activite. Les pistes se choisissent ensuite comme pour tout groupe (assets/pinlane-pistes.js),
// et la journee se juge par evaluateConflicts : rien n est decide deux fois.

const GRILLE = 30; // PROGRAM_GRID_MINUTES (lib/ops-engine.js) : les departs du bowling et du laser
const SOUS_GROUPES_MAX = 12;

function entier(valeur) {
  const n = Number(valeur);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// Un total reparti en `nombre` parts egales, les plus grandes d abord (61 en 2 : 31 et 30). C est
// la repartition des services du bowling et des vagues du laser : un sous-groupe n en vit jamais
// plus que l autre.
function partsEgales(total, nombre) {
  const n = Math.max(0, entier(total));
  const parts = Math.max(1, entier(nombre));
  const base = Math.floor(n / parts);
  const reste = n % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < reste ? 1 : 0));
}

// LES JOUEURS D UNE ACTIVITE QUE TOUT LE GROUPE NE JOUE PAS (le nombre par activite) : chaque
// sous-groupe en prend sa part, au prorata de sa taille, jamais plus que lui, et la somme fait les
// joueurs de l activite (les restes vont aux plus grosses fractions, puis aux premiers).
function partsAuProrata(joueurs, tailles) {
  const groupe = tailles.reduce((somme, taille) => somme + taille, 0);
  const n = Math.max(0, Math.min(entier(joueurs), groupe));
  if (!groupe) return tailles.map(() => 0);
  if (n === groupe) return tailles.slice();
  const exactes = tailles.map((taille) => (n * taille) / groupe);
  const parts = exactes.map((valeur) => Math.floor(valeur));
  let reste = n - parts.reduce((somme, part) => somme + part, 0);
  const ordre = exactes.map((valeur, index) => ({ index, fraction: valeur - Math.floor(valeur) }))
    .sort((a, b) => (b.fraction - a.fraction) || (a.index - b.index));
  for (const { index } of ordre) {
    if (reste <= 0) break;
    if (parts[index] < tailles[index]) { parts[index] += 1; reste -= 1; }
  }
  return parts;
}

// LES SOUS-GROUPES. `groupe` : les personnes. `activites` : [{ id, nom, joueurs, parts, capacite,
// capaciteDite }] ; `parts` est la coupe du centre pour les joueurs de l activite, `capacite` ce
// qu un sous-groupe peut y etre au plus d un coup, `capaciteDite` cette place en mots (« 8 pistes,
// 56 joueurs au plus »). Autant de sous-groupes que l activite la plus coupee. `tailles` : celles
// que le comptoir a posees ; elles se jugent, jamais ne se rabotent. `souple` : un dossier
// enregistre qui se replanifie (une modification) garde ses tailles tant qu elles font encore le
// groupe, sinon il repart de parts egales au lieu de refuser le geste.
// Rend { ok, nombre, tailles, parActivite: { id: [joueurs par sous-groupe] } } ou { ok: false, raison }.
function sousGroupes({ groupe, activites = [], tailles = null, souple = false } = {}) {
  const personnes = Math.max(1, entier(groupe));
  const liste = (Array.isArray(activites) ? activites : []).filter((activite) => activite && activite.id);
  const nombre = Math.min(SOUS_GROUPES_MAX, Math.max(1, ...liste.map((activite) => (Array.isArray(activite.parts) ? activite.parts.length : 1))));
  let choisies = partsEgales(personnes, nombre);
  const posees = Array.isArray(tailles) ? tailles.map(entier) : null;
  const tiennent = posees && posees.length === nombre && posees.every((taille) => taille >= 1)
    && posees.reduce((total, taille) => total + taille, 0) === personnes;
  if (posees && posees.length && !(souple && !tiennent)) {
    if (posees.length !== nombre) {
      return { ok: false, raison: `Ce groupe se joue en ${nombre} sous-groupes : donnez la taille de chacun.` };
    }
    if (posees.some((taille) => taille < 1)) return { ok: false, raison: 'Chaque sous-groupe compte au moins un joueur.' };
    const somme = posees.reduce((total, taille) => total + taille, 0);
    if (somme !== personnes) {
      return { ok: false, raison: `Les sous-groupes font ${somme} joueurs, le groupe en compte ${personnes}.` };
    }
    choisies = posees;
  }
  const parActivite = {};
  for (const activite of liste) {
    const joueurs = Math.min(personnes, Math.max(0, entier(activite.joueurs)));
    const parts = joueurs === personnes ? choisies.slice() : partsAuProrata(joueurs, choisies);
    const capacite = entier(activite.capacite);
    const trop = capacite > 0 ? parts.findIndex((part) => part > capacite) : -1;
    if (trop >= 0) {
      return {
        ok: false,
        raison: `Groupe ${trop + 1} : ${parts[trop]} joueurs au ${activite.nom || activite.id}, ${activite.capaciteDite || `${capacite} au plus`} à la fois.`,
      };
    }
    parActivite[activite.id] = parts;
  }
  return { ok: true, nombre, tailles: choisies, parActivite };
}

// L ordre d un sous-groupe : celui de base, decale de son rang. Deux activites et deux
// sous-groupes : le groupe 1 joue bowling puis laser, le groupe 2 laser puis bowling.
function ordreDuSousGroupe(base, rang) {
  if (!base.length) return [];
  const decalage = rang % base.length;
  return [...base.slice(decalage), ...base.slice(0, decalage)];
}

// La demi-heure suivante, sur la grille du premier depart : celle du centre (15:00, 15:30), ou, pour une
// rotation que le comptoir pose a la minute (15:10), 15:10, 15:40, 16:10.
const surLaGrille = (minutes, grille, origine = 0) => origine + Math.ceil((minutes - origine) / grille) * grille;

// Les pistes que le groupe tient deja sur [debut, fin) : la plus forte demi-heure.
function pistesDuGroupe(poses, debut, fin, grille) {
  let pire = 0;
  for (let t = debut; t < fin; t += grille) {
    const prises = poses
      .filter((pose) => pose.activite === 'bowling' && pose.debut <= t && t < pose.fin)
      .reduce((somme, pose) => somme + pose.pistes, 0);
    pire = Math.max(pire, prises);
  }
  return pire;
}

// L arene est-elle deja a un sous-groupe sur [debut, fin) ? Un seul sous-groupe y joue a la fois,
// comme les vagues d une partie.
function areneDuGroupe(poses, debut, fin) {
  return poses.some((pose) => pose.activite === 'laser_game' && pose.debut < fin && debut < pose.fin);
}

// LA ROTATION. `debut` : le premier depart (minutes). `tailles` et `parActivite` : sousGroupes.
// `ordre` : les activites dans l ordre du groupe 1. `bowling` : { minutes, pistesDe(joueurs) } ;
// `laser` : { parties, minutes, vaguesDe(joueurs) } ; `pistes` : les pistes du centre ce jour-la.
// Le sous-groupe libre le plus tot prend son activite suivante, a la premiere demi-heure ou le
// groupe lui-meme a la place (ses autres sous-groupes deja poses) ; ce que la journee a deja pris,
// evaluateConflicts le juge ensuite. Rend { ok, poses, fin } ; chaque pose : { sousGroupe,
// activite, debut, fin, joueurs, pistes } pour le bowling, { ..., partie, vague } pour le laser.
function poserLaRotation({ debut, tailles = [], parActivite = {}, ordre = [], bowling = null, laser = null, pistes = 0, grille = GRILLE } = {}) {
  const nombre = tailles.length;
  const activites = ordre.filter((id) => (id === 'bowling' && bowling) || (id === 'laser_game' && laser));
  if (!nombre || !activites.length || !Number.isFinite(Number(debut))) return { ok: false, raison: 'Rien à faire tourner.', poses: [] };
  const ordres = tailles.map((_, rang) => ordreDuSousGroupe(activites, rang));
  const curseur = tailles.map(() => Number(debut));
  const suivant = tailles.map(() => 0);
  const poses = [];
  const finDeLaJournee = Number(debut) + 24 * 60;
  const origine = ((Number(debut) % grille) + grille) % grille;
  for (let tour = 0; tour < nombre * activites.length; tour += 1) {
    let rang = -1;
    for (let k = 0; k < nombre; k += 1) {
      if (suivant[k] < ordres[k].length && (rang < 0 || curseur[k] < curseur[rang])) rang = k;
    }
    if (rang < 0) break;
    const id = ordres[rang][suivant[rang]];
    suivant[rang] += 1;
    const joueurs = entier((parActivite[id] || [])[rang]);
    if (joueurs <= 0) continue;
    if (id === 'bowling') {
      const voulues = Math.max(1, entier(bowling.pistesDe(joueurs)));
      if (voulues > pistes) return { ok: false, raison: `Groupe ${rang + 1} : il faut ${voulues} pistes, le centre en a ${pistes}.`, poses };
      let t = surLaGrille(curseur[rang], grille, origine);
      while (pistesDuGroupe(poses, t, t + bowling.minutes, grille) + voulues > pistes) {
        t += grille;
        if (t > finDeLaJournee) return { ok: false, raison: 'Le groupe ne tient pas sur les pistes du centre.', poses };
      }
      poses.push({ sousGroupe: rang + 1, activite: 'bowling', debut: t, fin: t + bowling.minutes, joueurs, pistes: voulues });
      curseur[rang] = t + bowling.minutes;
    } else {
      let t = curseur[rang];
      for (let partie = 1; partie <= Math.max(1, entier(laser.parties)); partie += 1) {
        laser.vaguesDe(joueurs).forEach((dansLaVague, rangVague) => {
          let depart = surLaGrille(t, grille, origine);
          while (areneDuGroupe(poses, depart, depart + laser.minutes)) depart += grille;
          poses.push({ sousGroupe: rang + 1, activite: 'laser_game', debut: depart, fin: depart + laser.minutes, joueurs: dansLaVague, partie, vague: rangVague + 1 });
          t = depart + laser.minutes;
        });
      }
      curseur[rang] = t;
    }
  }
  return { ok: true, poses, fin: Math.max(Number(debut), ...poses.map((pose) => pose.fin)) };
}

// L heure qui ouvre la rotation : le plus tot des departs demandes (bowling, laser, premiere partie).
function debutDeLaRotation(heures = []) {
  const valides = heures.map(Number).filter((minutes) => Number.isFinite(minutes));
  return valides.length ? Math.min(...valides) : null;
}

// La demande du comptoir, relue : les tailles posees (des entiers), l activite du groupe 1, et
// `impose` : le comptoir veut les sous-groupes (un bowling seul trop grand pour un service, ou
// « Faire tourner 2 groupes » touche). Sans lui, le moteur garde le plan d avant tant qu il tient
// (lib/ops-engine.js planFormulaWithAnchors). null quand la demande n en est pas une.
function lireGrandGroupe(brut) {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null;
  const tailles = Array.isArray(brut.tailles) && brut.tailles.length
    ? brut.tailles.slice(0, SOUS_GROUPES_MAX).map(entier)
    : null;
  const premier = brut.premier === 'laser_game' || brut.premier === 'bowling' ? brut.premier : '';
  return { tailles, premier, ...(brut.impose === true ? { impose: true } : {}), ...(brut.rejoue === true ? { rejoue: true } : {}) };
}

module.exports = {
  GRILLE,
  SOUS_GROUPES_MAX,
  debutDeLaRotation,
  lireGrandGroupe,
  ordreDuSousGroupe,
  partsAuProrata,
  partsEgales,
  poserLaRotation,
  sousGroupes,
};

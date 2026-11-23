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
// `nombre` (2026-11-23, Ansar : « choisir de diviser en plus de 2 groupes, genre 3, 4 ») : le nombre de
// sous-groupes que le comptoir a choisi, au lieu du plus petit que la place du centre demande. Il se juge
// comme les tailles : un groupe trop grand pour les armes ou les pistes le dit. Une modification (`souple`)
// garde le nombre choisi, jamais moins que ce que le groupe demande devenu plus grand.
// Rend { ok, nombre, tailles, parActivite: { id: [joueurs par sous-groupe] } } ou { ok: false, raison,
// groupe, activite } (le groupe et l activite qui coincent, quand c en est un).
function sousGroupes({ groupe, activites = [], tailles = null, souple = false, nombre: voulu = 0 } = {}) {
  const personnes = Math.max(1, entier(groupe));
  const liste = (Array.isArray(activites) ? activites : []).filter((activite) => activite && activite.id);
  const coupe = Math.max(1, ...liste.map((activite) => (Array.isArray(activite.parts) ? activite.parts.length : 1)));
  const choisi = entier(voulu) >= 2 ? (souple ? Math.max(entier(voulu), coupe) : entier(voulu)) : coupe;
  const nombre = Math.min(SOUS_GROUPES_MAX, personnes, choisi);
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
        groupe: trop + 1,
        activite: activite.id,
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

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesDe = (texte) => Number(String(texte).slice(0, 2)) * 60 + Number(String(texte).slice(3, 5));
const enHeure = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const NOMS = { bowling: 'bowling', laser_game: 'laser' };

// LES HEURES DU COMPTOIR, GROUPE PAR GROUPE (2026-11-23, Ansar : « choisir l'heure de passage [...] pouvoir
// mettre facilement quel groupe va où, et quand »). La rotation propose ; le comptoir corrige une case, et
// chaque sous-groupe joue alors chaque activite a l heure posee, a la minute, ses parties de laser de
// demi-heure en demi-heure depuis elle. Rien ne se decale en douce : ce qui coince (les pistes, les armes,
// un groupe a deux endroits) se juge ensuite, comme pour toute reservation (lib/ops-engine.js
// evaluateConflicts, composeAnchoredFormulaScenario), et se dit sur la case du groupe. `heures` : une
// entree par sous-groupe, { bowling: 'HH:MM', laser_game: 'HH:MM' }. Rend { ok, poses, fin } comme
// poserLaRotation, ou { ok: false, raison, groupe, activite }.
function poserAuxHeures({ heures = [], tailles = [], parActivite = {}, bowling = null, laser = null, pistes = 0, grille = GRILLE } = {}) {
  const nombre = tailles.length;
  const poses = [];
  if (!nombre || !Array.isArray(heures) || heures.length !== nombre) return { ok: false, raison: `Donnez l’heure de chacun des ${nombre} groupes.`, poses };
  for (let rang = 0; rang < nombre; rang += 1) {
    for (const id of ['bowling', 'laser_game']) {
      const regle = id === 'bowling' ? bowling : laser;
      const joueurs = entier((parActivite[id] || [])[rang]);
      if (!regle || joueurs <= 0) continue;
      const texte = String((heures[rang] || {})[id] || '');
      if (!HEURE.test(texte)) return { ok: false, raison: `Groupe ${rang + 1} : donnez l’heure du ${NOMS[id]}.`, groupe: rang + 1, activite: id, poses };
      const t = minutesDe(texte);
      if (id === 'bowling') {
        const voulues = Math.max(1, entier(bowling.pistesDe(joueurs)));
        if (voulues > pistes) return { ok: false, raison: `Groupe ${rang + 1} : il faut ${voulues} pistes, le centre en a ${pistes}.`, groupe: rang + 1, activite: id, poses };
        poses.push({ sousGroupe: rang + 1, activite: 'bowling', debut: t, fin: t + bowling.minutes, joueurs, pistes: voulues });
        continue;
      }
      // (les parties et leurs vagues partent aux demi-heures qui suivent la minute posee)
      const origine = ((t % grille) + grille) % grille;
      let curseur = t;
      for (let partie = 1; partie <= Math.max(1, entier(laser.parties)); partie += 1) {
        laser.vaguesDe(joueurs).forEach((dansLaVague, rangVague) => {
          const depart = surLaGrille(curseur, grille, origine);
          poses.push({ sousGroupe: rang + 1, activite: 'laser_game', debut: depart, fin: depart + laser.minutes, joueurs: dansLaVague, partie, vague: rangVague + 1 });
          curseur = depart + laser.minutes;
        });
      }
    }
  }
  if (!poses.length) return { ok: false, raison: 'Rien à faire jouer.', poses };
  return { ok: true, poses, fin: Math.max(...poses.map((pose) => pose.fin)) };
}

// Les heures de chaque sous-groupe d un plan pose : son premier passage a chaque activite. C est ce que
// la fenetre montre et renvoie quand le comptoir corrige une case.
function heuresDesPoses(poses = [], nombre = 0) {
  return Array.from({ length: Math.max(0, entier(nombre)) }, (_, rang) => {
    const heures = {};
    for (const id of ['bowling', 'laser_game']) {
      const debuts = poses.filter((pose) => pose.sousGroupe === rang + 1 && pose.activite === id).map((pose) => pose.debut);
      if (debuts.length) heures[id] = enHeure(Math.min(...debuts));
    }
    return heures;
  });
}

// Les heures de chaque sous-groupe d un plan enregistre, lues sur ses blocs et decalees de `ecart` minutes :
// une modification les garde, un glisser du planning les met a jour. null quand un groupe n a rien a heure.
function heuresDesBlocs(plan, ecart = 0) {
  const blocs = (Array.isArray(plan && plan.resourceBlocks) ? plan.resourceBlocks : [])
    .filter((bloc) => bloc && Number(bloc.sousGroupe) > 0 && ['bowling_lane', 'laser_arena'].includes(bloc.resourceType) && HEURE.test(String(bloc.startTime || '').slice(0, 5)));
  const nombre = Math.min(SOUS_GROUPES_MAX, Math.max(0, ...blocs.map((bloc) => entier(bloc.sousGroupe))));
  if (!nombre) return null;
  const poses = blocs.map((bloc) => ({ sousGroupe: entier(bloc.sousGroupe), activite: bloc.resourceType === 'bowling_lane' ? 'bowling' : 'laser_game', debut: minutesDe(bloc.startTime) + entier(ecart) }));
  const heures = heuresDesPoses(poses, nombre);
  return heures.every((siens) => Object.keys(siens).length) ? heures : null;
}

// Les heures envoyees par le comptoir, relues : une entree par sous-groupe, chaque heure en HH:MM. Une
// liste qui n en est pas une (une heure mal ecrite, trop de groupes) ne vaut rien : le moteur propose.
function lireHeuresDesGroupes(brut) {
  if (!Array.isArray(brut) || !brut.length || brut.length > SOUS_GROUPES_MAX) return null;
  const lues = brut.map((groupe) => {
    if (!groupe || typeof groupe !== 'object' || Array.isArray(groupe)) return null;
    const heures = {};
    for (const id of ['bowling', 'laser_game']) {
      const valeur = groupe[id];
      if (valeur === undefined || valeur === null || valeur === '') continue;
      const texte = String(valeur).slice(0, 5);
      if (!HEURE.test(texte)) return null;
      heures[id] = texte;
    }
    return Object.keys(heures).length ? heures : null;
  });
  return lues.every(Boolean) ? lues : null;
}

// L heure qui ouvre la rotation : le plus tot des departs demandes (bowling, laser, premiere partie).
function debutDeLaRotation(heures = []) {
  const valides = heures.map(Number).filter((minutes) => Number.isFinite(minutes));
  return valides.length ? Math.min(...valides) : null;
}

// La demande du comptoir, relue : les tailles posees (des entiers), l activite du groupe 1, et
// `impose` : le comptoir veut les sous-groupes (un bowling seul trop grand pour un service, ou
// « Faire tourner 2 groupes » touche). Sans lui, le moteur garde le plan d avant tant qu il tient
// (lib/ops-engine.js planFormulaWithAnchors). `nombre` : les sous-groupes choisis (2 a 12). `heures` :
// celles de chaque sous-groupe posees au comptoir (poserAuxHeures). null quand la demande n en est pas une.
function lireGrandGroupe(brut) {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null;
  const tailles = Array.isArray(brut.tailles) && brut.tailles.length
    ? brut.tailles.slice(0, SOUS_GROUPES_MAX).map(entier)
    : null;
  const premier = brut.premier === 'laser_game' || brut.premier === 'bowling' ? brut.premier : '';
  const nombre = entier(brut.nombre) >= 2 && entier(brut.nombre) <= SOUS_GROUPES_MAX && Number(brut.nombre) === entier(brut.nombre) ? entier(brut.nombre) : 0;
  const heures = lireHeuresDesGroupes(brut.heures);
  // (un nombre ou des heures choisis au comptoir, c est vouloir les groupes : rien n y bascule en douce)
  return {
    tailles,
    premier,
    ...(nombre ? { nombre } : {}),
    ...(heures ? { heures } : {}),
    ...(brut.impose === true || nombre || heures ? { impose: true } : {}),
    ...(brut.rejoue === true ? { rejoue: true } : {}),
  };
}

module.exports = {
  GRILLE,
  SOUS_GROUPES_MAX,
  debutDeLaRotation,
  heuresDesBlocs,
  heuresDesPoses,
  lireGrandGroupe,
  lireHeuresDesGroupes,
  ordreDuSousGroupe,
  partsAuProrata,
  partsEgales,
  poserAuxHeures,
  poserLaRotation,
  sousGroupes,
};

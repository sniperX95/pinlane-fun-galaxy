'use strict';

// LES ACTIVITES EN PLUS D UNE FORMULE (2026-11-22, Ansar au comptoir : « quand on prend une formule [...] on
// veut ajouter genre activité après la formule ou en plus, bah ça déplie la formule [...] surtout pour quand c
// illimité ça fait nimp et on arrive pas à choisir les heures qu'on veut, ça marque impossible partout »).
//
// Reserver ne savait ajouter une activite a une formule qu en l adaptant : la formule devenait une visite a
// la carte (« Formule 5, adaptée »), chacune de ses activites une ligne a regler, le moteur la replanifiait
// depuis l activite ajoutee (le laser de la formule partait de 16:00 a 17:00 derriere le bowling) et les
// heures de l ajout se jugeaient comme une ligne de cette visite. Un acces illimite y perdait son choix et
// ses heures a volonte.
//
// La regle : la formule reste entiere, telle que le moteur la planifie ; une activite en plus est une ligne a
// elle, a son prix du catalogue et a son heure, planifiee seule par le meme moteur sur la meme journee (la
// formule y compte), puis posee a cote. Le groupe ne peut pas etre a deux endroits : une activite en plus ne
// chevauche pas ce que la formule fait a heure fixe, aux vraies durees (la regle de poserLesHeures,
// lib/heures-posees.js : le bowling, chaque partie du laser, une etape a heure comme les 30 min d arcades) ;
// ce qui est a volonte ou libre ne compte pas (l acces illimite, la plaine, les arcades en argent, le bar).
// La meme activite que la formule peut se reprendre en plus (un deuxieme bowling apres la Formule 1).
// Le dossier garde sa formule, son nom et son prix ; ses activites en plus vivent dans son plan
// (opsPlan.enPlus : leurs lignes et leurs montants, leurs blocs marques `enPlus`), sa reference est le prix de
// la formule plus les leurs.

const ACTIVITE = /^[a-z][a-z0-9_]{1,40}$/;
const HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EN_PLUS_MAX = 4;
const LASER_MINUTES = 25;
const ANCRES = ['bowling', 'laser_game'];

function erreur(message) {
  return Object.assign(new Error(message), { statusCode: 422, expose: true });
}

function minutes(heure) {
  const lu = HEURE.exec(String(heure || ''));
  return lu ? Number(lu[1]) * 60 + Number(lu[2]) : NaN;
}

function enHeure(valeur) {
  const m = Math.round(Number(valeur));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Un bord de bloc en minutes : l heure ecrite, sinon `start`/`end` (en heures sous 48, en minutes au-dela).
function bord(bloc, nom) {
  const ecrite = minutes(String((bloc && bloc[`${nom}Time`]) || '').slice(0, 5));
  if (Number.isFinite(ecrite)) return ecrite;
  const valeur = Number(bloc && bloc[nom]);
  return Number.isFinite(valeur) ? Math.round(valeur <= 48 ? valeur * 60 : valeur) : NaN;
}

// Ce que le centre vend (le meme catalogue que l acces illimite et le programme a la carte).
function activitesDuCentre(centerId) {
  try {
    return new Set(require('./activity-catalog').listCenterActivities(centerId || 'libramont').map((a) => String(a.id)));
  } catch (error) {
    return new Set();
  }
}

// Le corps `enPlus` : une liste courte, une ligne par activite, l heure du bowling et du laser obligatoire sur
// la grille des demi-heures (le moteur n en pose pas d autre), celle d une autre activite facultative (sans
// heure, elle se joue librement pendant la visite). Un corps forge est refuse en entier, jamais rabote.
function lireEnPlus(brut, { centerId = '', pax = 1 } = {}) {
  if (brut === undefined || brut === null) return [];
  if (!Array.isArray(brut) || brut.length > EN_PLUS_MAX) throw erreur('Activités en plus invalides.');
  const vendues = activitesDuCentre(centerId);
  const groupe = Math.max(1, Math.trunc(Number(pax) || 1));
  const vues = new Set();
  return brut.map((entree) => {
    if (!entree || typeof entree !== 'object' || Array.isArray(entree)) throw erreur('Activités en plus invalides.');
    const id = String(entree.activityId || '');
    if (!ACTIVITE.test(id) || vues.has(id) || !vendues.has(id) || id === 'party_table' || id === 'arcade_credit' || /^service_/.test(id)) throw erreur('Activités en plus invalides.');
    vues.add(id);
    const heure = entree.heure === undefined || entree.heure === null || entree.heure === '' ? '' : String(entree.heure);
    if (heure && !HEURE.test(heure)) throw erreur('Activités en plus invalides.');
    if (ANCRES.includes(id) && (!heure || minutes(heure) % 30 !== 0)) throw erreur('Choisissez une heure pleine ou demie pour l’activité en plus.');
    const participants = entree.participants === undefined || entree.participants === null || entree.participants === '' ? groupe : Number(entree.participants);
    if (!Number.isInteger(participants) || participants < 1 || participants > groupe) throw erreur('Le nombre de joueurs d’une activité en plus dépasse le groupe.');
    const ligne = { activityId: id, participants, heure };
    if (id === 'bowling') {
      const duree = entree.duration === undefined || entree.duration === null ? 1 : Number(entree.duration);
      if (!(duree >= 0.5 && duree <= 6 && Number.isInteger(duree * 2))) throw erreur('Activités en plus invalides.');
      ligne.duration = duree;
    }
    if (id === 'laser_game') {
      const parties = entree.games === undefined || entree.games === null ? 1 : Number(entree.games);
      if (!Number.isInteger(parties) || parties < 1 || parties > 12) throw erreur('Activités en plus invalides.');
      ligne.games = parties;
    }
    return ligne;
  });
}

// Les departs des parties de laser en plus : une partie toutes les demi-heures depuis son heure.
function departsDuLaser(ligne) {
  const debut = minutes(ligne.heure);
  return Array.from({ length: Math.max(1, Number(ligne.games) || 1) }, (_, k) => enHeure(debut + 30 * k));
}

// LA VISITE DES ACTIVITES EN PLUS : le corps qu une visite a la carte enverrait, chacune a son heure (le
// bowling et le laser comme ancres du moteur, une autre activite posee a la main, sinon libre). Sans heure
// du tout, elle commence avec la formule.
function corpsDesEnPlus(corps, enPlus, formule) {
  const ordre = enPlus.slice().sort((a, b) => (a.heure ? minutes(a.heure) : 1e4) - (b.heure ? minutes(b.heure) : 1e4));
  const premiere = ordre.find((ligne) => ligne.heure);
  const depart = premiere ? premiere.heure : String((formule && formule.startTime) || corps.startTime || '').slice(0, 5);
  const preferredTimes = {};
  const heuresPosees = {};
  ordre.forEach((ligne) => {
    if (!ligne.heure) return;
    if (ANCRES.includes(ligne.activityId)) preferredTimes[ligne.activityId] = ligne.heure;
    else heuresPosees[ligne.activityId] = ligne.heure;
  });
  const laser = ordre.find((ligne) => ligne.activityId === 'laser_game');
  const preference = {
    activityOrder: ordre.map((ligne) => ligne.activityId),
    ...(Object.keys(preferredTimes).length ? { preferredTimes } : {}),
    ...(laser ? { laserGameTimes: departsDuLaser(laser), laserPlacement: 'scheduled' } : {}),
  };
  return {
    centerId: corps.centerId,
    date: corps.date,
    startTime: depart,
    pax: corps.pax,
    type: 'visite',
    program: ordre.map((ligne) => ({
      activityId: ligne.activityId,
      pax: Number(corps.pax) || 1,
      participants: ligne.participants,
      ...(ligne.duration ? { duration: ligne.duration } : {}),
      ...(ligne.games ? { games: ligne.games } : {}),
    })),
    preference,
    ...(Object.keys(heuresPosees).length ? { heuresPosees } : {}),
    lanes: [],
    status: 'pending',
    allowPastStart: corps.allowPastStart === true,
    extras: [],
    name: '',
    channel: 'staff',
  };
}

// CE QUE LA FORMULE FAIT A HEURE FIXE : chaque bloc de piste et chaque partie du laser (ses 25 min), puis,
// pour une formule du catalogue, chaque etape a heure de ce que le groupe joue (lib/reservation-activity-move.js
// jeuAHeure, les 30 min d arcades comprises). Ce qui est garde a volonte, une etape libre, la plaine, les
// jetons d arcades remis au bar, le bar et la table ne comptent pas. Un acces illimite ne fixe que son bowling
// et son laser « 1 fois » : le reste se joue a volonte.
function jeuAHeureDuPlan(plan, { illimite = false, enPlus = false } = {}) {
  const blocs = plan && Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const etapes = plan && Array.isArray(plan.timeline) ? plan.timeline : [];
  const garde = (bloc) => Boolean(bloc) && bloc.aVolonte !== true && Boolean(bloc.enPlus) === enPlus;
  const plages = [];
  blocs.filter(garde).forEach((bloc) => {
    if (bloc.resourceType !== 'bowling_lane' && bloc.resourceType !== 'laser_arena') return;
    const debut = bord(bloc, 'start');
    const fin = bloc.resourceType === 'laser_arena' ? Math.min(bord(bloc, 'end') || debut + LASER_MINUTES, debut + LASER_MINUTES) : bord(bloc, 'end');
    if (Number.isFinite(debut) && Number.isFinite(fin) && fin > debut) plages.push({ activite: bloc.resourceType === 'bowling_lane' ? 'bowling' : 'laser_game', debut, fin });
  });
  if (!illimite) {
    etapes.filter(garde).forEach((etape) => {
      const id = String(etape.activityId || '');
      if (etape.type !== 'activity' || etape.flexible === true || !id || ANCRES.includes(id) || etape.resourceType === 'bowling_lane' || etape.resourceType === 'laser_arena') return;
      if (['bar_service', 'party_table', 'transition'].includes(etape.resourceType) || id === 'party_table' || id === 'arcade_credit' || id === 'playground' || /^service_/.test(id)) return;
      const debut = bord(etape, 'start');
      const fin = bord(etape, 'end');
      if (Number.isFinite(debut) && Number.isFinite(fin) && fin > debut) plages.push({ activite: id, nom: String(etape.label || ''), debut, fin });
    });
  }
  return plages;
}

function nomDe(id, nom = '') {
  if (id === 'bowling') return 'le bowling';
  if (id === 'laser_game') return 'le laser';
  return nom ? `« ${nom} »` : 'une autre activité';
}

// LE GROUPE NE PEUT PAS ETRE A DEUX ENDROITS : la premiere activite en plus qui chevauche ce que la formule
// fait a heure fixe, avec la phrase qui le dit, ou null.
function chevauchementAvecLaFormule(planFormule, planEnPlus, { illimite = false } = {}) {
  const fixes = jeuAHeureDuPlan(planFormule, { illimite });
  const siennes = jeuAHeureDuPlan(planEnPlus, { illimite: false, enPlus: false });
  for (const sienne of siennes) {
    const autre = fixes.find((f) => sienne.debut < f.fin && f.debut < sienne.fin);
    if (!autre) continue;
    const quoi = sienne.activite === 'bowling' ? 'Le bowling en plus' : sienne.activite === 'laser_game' ? 'Le laser en plus' : 'L’activité en plus';
    return {
      activite: sienne.activite,
      heure: enHeure(sienne.debut),
      message: `${quoi} à ${enHeure(sienne.debut)} chevauche ${nomDe(autre.activite, autre.nom)} de la formule, de ${enHeure(autre.debut)} à ${enHeure(autre.fin)}.`,
    };
  }
  return null;
}

// LES LIGNES DES ACTIVITES EN PLUS, a leur prix du catalogue (celui que le moteur vient de poser sur la visite,
// lib/visit-program.js), leur heure et leurs joueurs. Une ligne sans tarif ne s invente pas : elle se regle sur
// place, son montant est null. Elles restent au dossier meme quand leur heure coince (un dossier « à placer »).
function lignesDesEnPlus(visite, enPlus, pax) {
  const programme = visite && visite.program && Array.isArray(visite.program.items) ? visite.program.items : [];
  const heureDe = (id) => ((enPlus.find((ligne) => ligne.activityId === id) || {}).heure || '');
  const lignes = programme.map((item) => ({
    activityId: String(item.activityId || ''),
    name: String(item.name || item.activityId || ''),
    participants: Number(item.participants) || Number(pax) || 1,
    ...(Number(item.duration) > 0 ? { duration: Number(item.duration) } : {}),
    ...(Number(item.games) > 0 ? { games: Number(item.games) } : {}),
    ...(Number(item.laneCount) > 0 ? { laneCount: Number(item.laneCount) } : {}),
    heure: heureDe(String(item.activityId || '')),
    price: item.priceKnown === true && Number.isFinite(Number(item.price)) ? Number(item.price) : null,
    priceKnown: item.priceKnown === true && Number.isFinite(Number(item.price)),
  }));
  const montant = Math.round(lignes.reduce((somme, ligne) => somme + (ligne.priceKnown ? ligne.price : 0), 0) * 100) / 100;
  return { items: lignes, prix: montant, complet: lignes.every((ligne) => ligne.priceKnown) };
}

// LE DOSSIER DE LA FORMULE ET SES ACTIVITES EN PLUS, EN UN : leurs blocs marques `enPlus` a cote de ceux de
// la formule (l accueil et le bar de leur visite restent dehors : le groupe est deja la), ce qui est libre
// sur toute la visite, les pistes reunies, la visite de la premiere a la derniere activite, et leurs lignes
// et leurs montants dans le plan. Le prix, lui, se pose par l appelant (la reference de la formule plus le
// leur).
function fusionnerLesEnPlus(formule, visite, enPlus) {
  const plan = formule.opsPlan || {};
  const sien = visite.opsPlan || {};
  const libres = new Set(enPlus.filter((ligne) => !ligne.heure && !ANCRES.includes(ligne.activityId)).map((ligne) => ligne.activityId));
  const marquer = (bloc) => ({ ...bloc, enPlus: true, ...(libres.has(String(bloc.activityId || '')) ? { flexible: true } : {}) });
  const ressources = (Array.isArray(sien.resourceBlocks) ? sien.resourceBlocks : []).map(marquer);
  const jeux = (Array.isArray(sien.timeline) ? sien.timeline : [])
    .filter((etape) => etape && etape.type === 'activity' && etape.activityId && !/^service/.test(String(etape.activityId)) && etape.activityId !== 'party_table')
    .map(marquer);
  const blocs = [...(Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : []), ...ressources];
  // CHAQUE BLOC GARDE SA CLE (partie.vague, celle du glisser au planning et du programme a cocher) : le bowling
  // et le laser en plus continuent les parties de la formule (sa partie 3 apres ses deux parties de laser, son
  // deuxieme bowling). La base lit leurs pistes comme des services du meme groupe (keepsBowlingServiceLanes).
  const suite = (type, id) => Math.max(0, ...blocs.filter((bloc) => bloc && bloc.resourceType === type && !bloc.enPlus).map((bloc) => Number(bloc.countIndex) || 1));
  const parties = { laser_arena: suite('laser_arena'), bowling_lane: suite('bowling_lane') };
  const apresLaFormule = (bloc) => {
    if (!bloc || !bloc.enPlus) return bloc;
    const type = bloc.resourceType === 'laser_arena' || bloc.activityId === 'laser_game' ? 'laser_arena' : bloc.resourceType === 'bowling_lane' || bloc.activityId === 'bowling' ? 'bowling_lane' : '';
    return type && parties[type] ? { ...bloc, countIndex: (Number(bloc.countIndex) || 1) + parties[type] } : bloc;
  };
  blocs.splice(0, blocs.length, ...blocs.map(apresLaFormule));
  jeux.splice(0, jeux.length, ...jeux.map(apresLaFormule));
  // (la visite se mesure sur ce que le groupe fait : ni l accueil, ni le bar)
  const aHeure = [...blocs, ...(Array.isArray(plan.timeline) ? plan.timeline : []), ...jeux].filter((bloc) => bloc && bloc.type === 'activity' && bloc.flexible !== true
    && !/^service/.test(String(bloc.activityId || '')) && Number.isFinite(bord(bloc, 'start')) && Number.isFinite(bord(bloc, 'end')));
  const premiere = Math.min(...aHeure.map((bloc) => bord(bloc, 'start')));
  const derniere = Math.max(...aHeure.map((bloc) => bord(bloc, 'end')));
  const finDuPlan = Math.max(Number.isFinite(minutes(String(plan.endTime || '').slice(0, 5))) ? minutes(String(plan.endTime).slice(0, 5)) : derniere, derniere);
  // (une activite en plus sans heure se joue librement pendant toute la visite)
  const surLaVisite = (bloc) => (bloc.flexible === true && Number.isFinite(premiere) && Number.isFinite(derniere)
    ? { ...bloc, start: premiere, end: derniere, startTime: enHeure(premiere), endTime: enHeure(derniere) } : bloc);
  blocs.splice(0, blocs.length, ...blocs.map((bloc) => (bloc.enPlus ? surLaVisite(bloc) : bloc)));
  const timeline = [...(Array.isArray(plan.timeline) ? plan.timeline : []), ...jeux.map(surLaVisite)];
  const pistes = [...new Set(blocs.filter((bloc) => bloc && bloc.resourceType === 'bowling_lane').flatMap((bloc) => bloc.lanes || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const opsPlan = {
    ...plan,
    resourceBlocks: blocs,
    timeline,
    ...(Number.isFinite(premiere) ? { startTime: enHeure(Math.min(premiere, minutes(String(plan.startTime || '').slice(0, 5)) || premiere)), endTime: enHeure(finDuPlan) } : {}),
    ...(Number.isFinite(premiere) && Number.isFinite(derniere) ? { totalMinutes: finDuPlan - Math.min(premiere, minutes(String(plan.startTime || '').slice(0, 5)) || premiere) } : {}),
    ...(pistes.length ? { assignedLanes: pistes } : {}),
    // (l arrivee de la formule seule : Modifier la replanifie depuis elle, jamais depuis une activite en plus
    // posee avant elle, lignesARePoser)
    enPlus: { ...lignesDesEnPlus(visite, enPlus, formule.pax), arrivee: String(formule.startTime || '').slice(0, 5) },
  };
  const debutFormule = minutes(String(formule.startTime || '').slice(0, 5));
  const debut = Number.isFinite(premiere) && Number.isFinite(debutFormule) ? Math.min(premiere, debutFormule) : debutFormule;
  const duree = Number.isFinite(debut) && Number.isFinite(derniere) ? Math.ceil((Math.max(derniere, finDuPlan) - debut) / 30) / 2 : 0;
  return {
    ...formule,
    ...(Number.isFinite(debut) ? { startTime: enHeure(debut) } : {}),
    ...(duree > Number(formule.totalDuration || 0) ? { totalDuration: duree } : {}),
    ...(pistes.length ? { lanes: pistes, laneCount: Math.max(Number(formule.laneCount) || 0, Number(visite.laneCount) || 0, 1), requiresLanes: true } : {}),
    opsPlan,
  };
}

// Un acces illimite (lib/formule-comptoir.js) : tout s y joue a volonte, sauf son bowling et son laser « 1 fois ».
function formuleIllimitee(formuleId, centerId) {
  const id = String(formuleId || '').trim();
  if (!id) return false;
  try {
    const formule = require('./ops-knowledge').getFormula(id, centerId || 'libramont');
    return Boolean(formule) && require('./formule-comptoir').estOrdreIllimite(formule.orderPolicy);
  } catch (error) {
    return false;
  }
}

// LES ACTIVITES EN PLUS D UN DOSSIER, A REPOSER (Modifier, 2026-11-22) : chacune a l heure ou son plan la
// montre (un glisser au planning compris), decalee comme le dossier ; ses joueurs bornes au groupe. Le bowling et
// le laser restent sur la grille des demi-heures.
function lignesARePoser(dossier, { pax, delta = 0 } = {}) {
  const enPlus = enPlusDuDossier(dossier);
  if (!enPlus) return [];
  const plan = dossier.opsPlan || {};
  const vus = [...(Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : []), ...(Array.isArray(plan.timeline) ? plan.timeline : [])]
    .filter((bloc) => bloc && bloc.enPlus && bloc.flexible !== true);
  const groupeAvant = Math.max(1, Number(dossier.pax) || 1);
  const groupe = Math.max(1, Number(pax) || groupeAvant);
  return enPlus.items.map((item) => {
    const id = String(item.activityId || '');
    const departs = vus.filter((bloc) => String(bloc.activityId || '') === id).map((bloc) => bord(bloc, 'start')).filter(Number.isFinite).sort((a, b) => a - b);
    const avant = departs.length ? departs[0] : minutes(item.heure);
    let heure = '';
    if (Number.isFinite(avant)) {
      const m = ANCRES.includes(id) ? Math.round((avant + delta) / 30) * 30 : avant + delta;
      if (m >= 0 && m < 24 * 60) heure = enHeure(m);
    }
    const joueurs = Number(item.participants) || groupeAvant;
    return {
      activityId: id,
      ...(heure ? { heure } : {}),
      ...(Number(item.duration) > 0 ? { duration: Number(item.duration) } : {}),
      ...(Number(item.games) > 0 ? { games: Number(item.games) } : {}),
      ...(joueurs < groupeAvant ? { participants: Math.min(joueurs, groupe) } : {}),
    };
  });
}

// Les activites en plus qu un dossier porte (son plan), ou null.
function enPlusDuDossier(dossier) {
  const plan = dossier && dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : null;
  const enPlus = plan && plan.enPlus && typeof plan.enPlus === 'object' ? plan.enPlus : null;
  return enPlus && Array.isArray(enPlus.items) && enPlus.items.length ? enPlus : null;
}

module.exports = {
  EN_PLUS_MAX,
  chevauchementAvecLaFormule,
  corpsDesEnPlus,
  enPlusDuDossier,
  formuleIllimitee,
  fusionnerLesEnPlus,
  jeuAHeureDuPlan,
  lignesARePoser,
  lignesDesEnPlus,
  lireEnPlus,
};

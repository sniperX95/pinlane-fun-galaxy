// QUAND L EQUIPE DOIT-ELLE VALIDER UNE RESERVATION ? (2026-10-05)
//
// Movsar : « les choses qui n ont pas su etre automatiquement placees doivent
// avoir une logique serieuse, que ce soit formule ou pas, meme une reservation
// multiple sans formule [...] juste quand il y a un moment ou ca peut poser un
// reel probleme [...] ca doit etre le moins possible ! notre algo doit trouver
// a chaque fois toute solution pour regler le truc et au dernier recours il
// nous demande, et tout doit etre comprehensible, clair, net et modifiable
// l intensite ».
//
// La decision ne se lit plus sur une etiquette de formule mais sur des FAITS
// MESURES dans le plan que le moteur vient de composer : une situation est
// detectee ou ne l est pas, chacune a un nom, une explication et un exemple
// que l ecran Etablissement montre tels quels. Le centre choisit un niveau
// (minimal, normal, prudent) et peut allumer ou eteindre chaque situation.
// « Aucune place sure » reste toujours active : c est la definition meme de
// « impossible sans un humain ».
//
// Ce module est PUR : il lit un plan et un reglage, il rend une decision et
// ses raisons. Il ne cherche pas lui-meme d autre solution : le moteur l a deja
// fait (pistes, ordre, vagues), et les heures alternatives sont proposees au
// client par le parcours public avant d en arriver la.
'use strict';

const SITUATIONS = [
  {
    id: 'impossible', toujours: true,
    mot: 'Aucune place sûre',
    explication: 'Le planning ne trouve aucune façon de placer ce groupe sans conflit (pistes, arène laser, tables).',
    exemple: 'Toutes les pistes sont déjà prises à cette heure-là.',
  },
  {
    id: 'bowling_secours',
    mot: 'Bowling en capacité de secours',
    explication: 'Le groupe ne tient qu’à 7 joueurs par piste au lieu de 6 : la partie sera plus longue.',
    exemple: '13 joueurs sur 2 pistes, répartis 7 + 6.',
  },
  {
    id: 'laser_plein',
    mot: 'Arène laser presque pleine',
    explication: 'La session laser est partagée avec un autre groupe et il ne reste que 3 armes ou moins.',
    exemple: '27 joueurs de deux groupes pour 30 armes.',
  },
  {
    id: 'apres_fermeture',
    mot: 'Dépasse la fermeture',
    explication: 'La dernière activité du groupe finit après l’heure de fermeture du centre.',
    exemple: 'Fin à 0 h 20 pour une fermeture à minuit.',
  },
  {
    id: 'laser_partage',
    mot: 'Laser partagé avec un autre groupe',
    explication: 'Le groupe jouera dans la même session laser qu’un autre groupe.',
    exemple: 'Un anniversaire placé avec 10 joueurs déjà inscrits.',
  },
  {
    id: 'enchainement_serre',
    mot: 'Enchaînement serré',
    explication: 'Moins de 5 minutes entre deux activités, pour un groupe de 12 personnes ou plus.',
    exemple: 'Bowling jusqu’à 16:00, laser à 16:00 pour 20 joueurs.',
  },
];
const PAR_ID = new Map(SITUATIONS.map((s) => [s.id, s]));

const NIVEAUX = {
  minimal: { mot: 'Minimal', dit: 'L’équipe n’est dérangée que si c’est impossible sans elle.', situations: ['impossible'] },
  normal: { mot: 'Normal', dit: 'Aussi quand la capacité est poussée au bout (bowling à 7, arène pleine) ou que le programme dépasse la fermeture.', situations: ['impossible', 'bowling_secours', 'laser_plein', 'apres_fermeture'] },
  prudent: { mot: 'Prudent', dit: 'Aussi quand le laser est partagé avec un autre groupe ou que les activités s’enchaînent sans marge.', situations: ['impossible', 'bowling_secours', 'laser_plein', 'apres_fermeture', 'laser_partage', 'enchainement_serre'] },
};
const NIVEAU_PAR_DEFAUT = 'minimal';
const ARMES_RESTANTES_MAX = 3;
const ECART_SERRE_MINUTES = 5;
const GROUPE_SERRE_MIN = 12;

// LE REGLAGE DU CENTRE, borne : un niveau connu et des interrupteurs connus.
function normaliserReglage(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const niveau = Object.prototype.hasOwnProperty.call(NIVEAUX, src.niveau) ? src.niveau : NIVEAU_PAR_DEFAUT;
  const situations = {};
  const brut = src.situations && typeof src.situations === 'object' && !Array.isArray(src.situations) ? src.situations : {};
  for (const s of SITUATIONS) {
    if (s.toujours) continue;
    if (typeof brut[s.id] === 'boolean') situations[s.id] = brut[s.id];
  }
  return { niveau, situations };
}

// Les situations qui comptent pour CE centre : celles de son niveau, plus ou
// moins ses interrupteurs. « impossible » ne s eteint jamais.
function situationsActives(reglage) {
  const r = normaliserReglage(reglage);
  const actives = new Set(NIVEAUX[r.niveau].situations);
  for (const [id, on] of Object.entries(r.situations)) {
    if (on) actives.add(id); else actives.delete(id);
  }
  actives.add('impossible');
  return actives;
}

function minutesDe(valeur) {
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return valeur;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(valeur || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function blocsDu(plan) {
  const blocs = plan && Array.isArray(plan.resourceBlocks) && plan.resourceBlocks.length
    ? plan.resourceBlocks
    : (plan && Array.isArray(plan.timeline) ? plan.timeline : []);
  return blocs.filter((b) => b && b.type !== 'service');
}
function heure(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// LES FAITS. Chaque situation detectee porte une phrase qui dit OU (l heure,
// le chiffre) : « il reste 2 armes a 15:00 », pas « risque eleve ».
function detecterSituations({ plan = null, request = {}, schedule = null, pax = 0 } = {}) {
  const trouvees = [];
  // `phrase` : la meme chose dite en une vraie phrase, pour le mail et la
  // console (pas de « Motif : x (y) »).
  const ajouter = (id, detail, phrase = '') => { if (!trouvees.some((t) => t.id === id)) trouvees.push({ id, mot: PAR_ID.get(id).mot, detail, phrase: phrase || `${PAR_ID.get(id).mot}.` }); };
  const conflitsBloquants = (plan && Array.isArray(plan.conflicts) ? plan.conflicts : []).filter((c) => c && c.severity === 'blocking');
  if (!plan || plan.ok === false || conflitsBloquants.length) {
    const raison = conflitsBloquants.length
      ? conflitsBloquants.map((c) => c.label || c.message).filter(Boolean).join(' ; ') || 'Conflit de ressource.'
      : (plan && (plan.reason || plan.warning)) || 'Aucun placement sûr trouvé.';
    const fin = /[.!?]$/.test(raison.trim()) ? '' : '.';
    ajouter('impossible', raison, `Le planning n’a pas trouvé de place sûre pour ce groupe. ${raison.trim()}${fin}`);
  }
  const blocs = blocsDu(plan);
  const groupe = Number(pax || request.pax) || 0;

  // Bowling a 7 : l avertissement du moteur d abord, sinon le calcul joueurs/pistes.
  const secours = request.emergencyWarning || (plan && plan.emergencyWarning) || '';
  if (secours) ajouter('bowling_secours', String(secours), 'Le groupe jouera à 7 sur au moins une piste au lieu de 6, la partie sera un peu plus longue.');
  else {
    for (const b of blocs) {
      if (b.resourceType !== 'bowling_lane') continue;
      const pistes = Array.isArray(b.lanes) && b.lanes.length ? b.lanes.length : Number(b.requiredLanes) || 0;
      const joueurs = Number(b.players) || 0;
      if (pistes > 0 && joueurs > pistes * 6) { ajouter('bowling_secours', `${joueurs} joueurs sur ${pistes} piste${pistes > 1 ? 's' : ''} à ${b.startTime || heure(b.start)}`, `${joueurs} joueurs sur ${pistes} piste${pistes > 1 ? 's' : ''} à ${b.startTime || heure(b.start)}, donc 7 sur une piste au lieu de 6. La partie sera un peu plus longue.`); break; }
    }
  }

  for (const b of blocs) {
    if (b.resourceType !== 'laser_arena') continue;
    const restantes = Number(b.remainingWeapons);
    const avecAutres = b.sharedSession === true || Number(b.playersBefore) > 0;
    // Un groupe SEUL qui prend toute l arene n est pas un probleme : c est sa
    // session. L arene « presque pleine » ne compte que partagee.
    if (avecAutres && Number.isFinite(restantes) && restantes <= ARMES_RESTANTES_MAX) ajouter('laser_plein', `il reste ${restantes} arme${restantes > 1 ? 's' : ''} à ${b.startTime || heure(b.start)}, session partagée`, restantes > 0 ? `Il ne restera que ${restantes} arme${restantes > 1 ? 's' : ''} libre${restantes > 1 ? 's' : ''} dans l’arène laser à ${b.startTime || heure(b.start)}, partagée avec un autre groupe.` : `L’arène laser sera pleine à ${b.startTime || heure(b.start)}, partagée avec un autre groupe.`);
    if (b.sharedSession === true || Number(b.playersBefore) > 0) ajouter('laser_partage', `${Number(b.playersBefore) || 0} joueur${Number(b.playersBefore) > 1 ? 's' : ''} d’un autre groupe à ${b.startTime || heure(b.start)}`, Number(b.playersBefore) > 0 ? `Le groupe partagera sa session laser de ${b.startTime || heure(b.start)} avec ${Number(b.playersBefore)} joueur${Number(b.playersBefore) > 1 ? 's' : ''} d’un autre groupe.` : `Le groupe partagera sa session laser de ${b.startTime || heure(b.start)} avec un autre groupe.`);
  }
  // Le moteur peut dire le partage sur le plan entier sans le porter sur un bloc.
  if (plan && plan.laserSharing && plan.laserSharing.sharedNow) ajouter('laser_partage', 'session laser partagée avec un autre groupe', 'Le groupe partagera sa session laser avec un autre groupe.');

  if (schedule && Number.isFinite(Number(schedule.close))) {
    const fermeture = Number(schedule.close) * 60;
    const fins = blocs.map((b) => minutesDe(b.end != null ? b.end : b.endTime)).filter((x) => x != null);
    // Un bloc qui « finit » avant son debut a passe minuit : il finit le lendemain.
    const fin = fins.length ? Math.max(...blocs.map((b) => {
      const s = minutesDe(b.start != null ? b.start : b.startTime);
      const e = minutesDe(b.end != null ? b.end : b.endTime);
      if (e == null) return -Infinity;
      return s != null && e < s ? e + 1440 : e;
    })) : null;
    if (fin != null && fin > fermeture) ajouter('apres_fermeture', `fin à ${heure(fin)}, fermeture à ${heure(fermeture)}`, `Le programme finit à ${heure(fin)}, après la fermeture de ${heure(fermeture)}.`);
  }

  if (groupe >= GROUPE_SERRE_MIN) {
    const activites = blocs
      .filter((b) => b.type === 'activity' || b.activityId)
      .map((b) => ({ id: b.activityId, s: minutesDe(b.start != null ? b.start : b.startTime), e: minutesDe(b.end != null ? b.end : b.endTime), h: b.startTime }))
      .filter((x) => x.s != null && x.e != null)
      .sort((a, b) => a.s - b.s);
    for (let i = 1; i < activites.length; i += 1) {
      const avant = activites[i - 1];
      const apres = activites[i];
      if (avant.id === apres.id) continue;
      const ecart = apres.s - avant.e;
      if (ecart >= 0 && ecart < ECART_SERRE_MINUTES) { ajouter('enchainement_serre', `${ecart} min entre ${heure(avant.e)} et ${apres.h || heure(apres.s)}`, ecart === 0 ? `Pour ${groupe} personnes, la deuxième activité commence à ${apres.h || heure(apres.s)}, à la minute où la première se termine.` : `Pour ${groupe} personnes, il n’y a que ${ecart} minute${ecart > 1 ? 's' : ''} entre deux activités (${heure(avant.e)} puis ${apres.h || heure(apres.s)}).`); break; }
    }
  }
  return trouvees;
}

// LA DECISION : l equipe valide si au moins une situation ACTIVE est detectee,
// ou si un centre a demande la validation de cette formule en particulier
// (reglage avance, choix commercial : modeFormule = 'required', ou
// 'required_when_laser_busy' qui allume « laser partage » pour elle seule).
function decisionValidation({ detectees = [], reglage = null, modeFormule = '' } = {}) {
  const actives = situationsActives(reglage);
  if (modeFormule === 'required_when_laser_busy') actives.add('laser_partage');
  const declencheurs = detectees.filter((s) => actives.has(s.id));
  const parFormule = modeFormule === 'required';
  return {
    requise: parFormule || declencheurs.length > 0,
    niveau: normaliserReglage(reglage).niveau,
    declencheurs,
    // Ce qui a ete vu mais ne derange personne a ce niveau : la fiche le
    // montre (« à surveiller »), aucun mail ne part.
    aSurveiller: detectees.filter((s) => !actives.has(s.id)),
    raison: parFormule ? 'Cette formule est réglée sur « toujours valider » dans Tarifs & formules.' : '',
  };
}

module.exports = {
  SITUATIONS,
  NIVEAUX,
  NIVEAU_PAR_DEFAUT,
  normaliserReglage,
  situationsActives,
  detecterSituations,
  decisionValidation,
};

'use strict';
// LES ACTIVITES A COCHER D UN GROUPE, COMME SA FICHE LES MONTRE (2026-11-12).
// Jumelle serveur de getGroupeProgramme (assets/app-main.js), reduite a ce que le serveur doit savoir
// pour cocher a la place de l equipe : la cle de chaque case (activityProgress, celle que
// toggleFormulaActivity envoie), son activite, sa partie, son heure, et si elle est faite. Les
// fenetres suivent les regles de la console (assets/booking-core.js : getResourceWindowsFromReservation,
// getLaserCandidateWindows, getFormulaLaserFallbackWindows, getPendingLaserPassesForReservation,
// getFormulaActivityChecklist) ; scripts/assistant-gestes-reservations-check.js joue la vraie console
// et cette jumelle sur la meme matrice de dossiers, cle par cle. Une cle que la fiche ne montre pas ne
// se coche jamais : le geste ne coche que ce que cette liste rend.

const BC = require('./booking-config');

const ARENE_MINUTES = BC.LASER_GAME_ARENA_MINUTES;
const POSTES_PAR_DEFAUT = BC.LASER_GAME_MAX_PLAYERS;
// Les parties de la grille laser ne changent pas d un centre a l autre, seuls leurs prix.
const OPTIONS_LASER = BC.LASER_GAME_OPTIONS;
// L estimation d une session sans plan lit les formules du fichier (getFormulaLaserFallbackWindows).
const FORMULES_DU_FICHIER = BC.FORMULES;
// Les activites a seances : chaque partie est une case (SESSION_ACTIVITIES).
const SEANCES = new Set(['laser_game', 'bowling']);
// Les noms de la fiche (FORMULA_ACTIVITY_LABELS, miroir de ops-knowledge/activities.json).
const NOMS = { bowling: 'Bowling', laser_game: 'Laser Game', minigolf_blacklight: 'Minigolf Blacklight', golf_oclock: "Golf o'Clock", arcade_time: 'Arcades', arcade_credit: 'Arcade', playground: 'Plaine de jeux', party_table: 'Table anniversaire', service_drinks: 'Boissons', duckpin_bowling: 'Duckpin Bowling' };
// Les etapes de chaque formule (FORMULA_ACTIVITY_STEPS, miroir de ce fichier, scripts/formula-activity-check.js).
// La fiche ecrit leurs libelles a sa facon (« 1 mètre de bière ») : ici le libelle du fichier ne sert
// qu a reconnaitre l etape dans les mots de la personne, la carte dit le nom de l activite.
const ETAPES = Object.fromEntries(require('../ops-knowledge/formulas.json').formulas
  .filter((f) => f && f.id && Array.isArray(f.steps))
  .map((f) => [f.id, f.steps.map((s) => ({ a: s.activityId, c: s.count, ...(s.label ? { libelle: s.label } : {}) }))]));

const heureNum = (t) => { if (!t) return 0; const [h, m] = String(t).split(':').map(Number); return h + (m / 60); };
const heureTexte = (n) => { const h = Math.floor(n); const m = Math.round((n - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
const caler = (h) => Math.ceil(Number(h || 0) * 2) / 2;
const sansAccents = (t) => String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const nomDe = (id, libelle) => libelle || NOMS[id] || String(id || 'Activité');

function heureDuBloc(bloc, cle, repli = 0) {
  const brut = Number(bloc && bloc[cle]);
  if (Number.isFinite(brut)) return brut > 24 ? brut / 60 : brut;
  const champ = cle === 'start' ? 'startTime' : 'endTime';
  if (bloc && bloc[champ]) return heureNum(bloc[champ]);
  return repli;
}
function dureeEnHeures(v) {
  const brut = Number(v);
  if (!Number.isFinite(brut) || brut <= 0) return 0;
  return brut > 24 ? brut / 60 : brut;
}
function finArene(debut, fin) {
  const limite = debut + (ARENE_MINUTES / 60);
  if (!Number.isFinite(Number(fin)) || fin <= debut) return limite;
  return Math.min(fin, limite);
}

function lignes(r) {
  const p = r && r.program;
  return Array.isArray(p) ? p : (p && Array.isArray(p.items) ? p.items : []);
}
function partiesDuProgramme(r) {
  const laser = lignes(r).find((i) => i && i.activityId === 'laser_game');
  return laser ? Math.max(0, Math.trunc(Number(laser.games) || 0), Math.trunc(Number(laser.extraLaser && laser.extraLaser.games) || 0)) : 0;
}
function joueursDe(r, activite) {
  const item = lignes(r).find((l) => l && l.activityId === activite);
  const groupe = Math.max(1, Math.trunc(Number(r && r.pax) || Number(item && item.participants) || 1));
  return Math.min(groupe, Math.max(1, Math.trunc(Number(item && item.participants) || groupe)));
}
function joueursDeLaPartie(r, partie = 1) {
  const laser = lignes(r).find((i) => i && i.activityId === 'laser_game');
  const base = joueursDe(r, 'laser_game');
  if (laser && laser.extraLaser && Number(partie) > Number(laser.games || 1)) return Math.min(base, Math.max(1, Math.trunc(Number(laser.extraLaser.participants) || base)));
  if (laser) return base;
  const plan = r && r.opsPlan && r.opsPlan.laserPassPlan;
  const explicite = [...((plan && plan.scheduledPasses) || []), ...((plan && plan.pendingPasses) || [])].find((x) => Number(x.countIndex) === Number(partie));
  return explicite && explicite.pax ? Math.min(base, Math.max(1, Math.trunc(Number(explicite.pax) || base))) : base;
}
function tailleDesVagues(joueurs, postes) {
  const n = Math.max(1, Number(joueurs) || 1);
  const nombre = Math.max(1, Math.ceil(n / postes));
  const base = Math.floor(n / nombre);
  const reste = n % nombre;
  return Array.from({ length: nombre }, (_, i) => base + (i < reste ? 1 : 0));
}

// getLaserGameCount : l option de la duree, sinon le palier, sinon la premiere option.
function partiesDeLaDuree(duree = 0.5) {
  const exacte = OPTIONS_LASER.find((o) => Number(o.value) === Number(duree));
  if (exacte) return exacte.games;
  const n = Number(duree) * 2;
  if (Number.isInteger(n) && n >= 1 && n <= 12) {
    const meme = OPTIONS_LASER.find((o) => Math.trunc(Number(o && o.games)) === n);
    if (meme) return meme.games;
    const liste = OPTIONS_LASER.map((o) => ({ games: Math.trunc(Number(o && o.games)), price: Number(o && o.price) })).filter((o) => o.games > 0 && Number.isFinite(o.price) && o.price >= 0);
    if (liste.some((o) => o.games < n) && liste.some((o) => o.games === 1)) return n;
  }
  return OPTIONS_LASER[0].games;
}
function choixDeFormule(r) {
  const choix = r && r.opsPlan && r.opsPlan.formulaChoice;
  return choix && typeof choix === 'object' && choix.id && Array.isArray(choix.replaces) && Array.isArray(choix.steps) ? choix : null;
}
function avecLeChoix(formule, r) {
  const choix = choixDeFormule(r);
  return formule && choix && Array.isArray(choix.desc) && choix.desc.length ? { ...formule, desc: choix.desc.slice() } : formule;
}
function partiesDeLaFormule(formule) {
  if (!formule) return 0;
  return (formule.desc || []).reduce((max, ligne) => {
    const t = sansAccents(ligne);
    if (!t.includes('laser game')) return max;
    const m = t.match(/(\d+)\s*part/);
    return Math.max(max, m ? Number(m[1]) : 1);
  }, 0);
}
// getLaserGameCountForReservation : le programme fait foi, puis la duree d un laser, puis la formule.
function partiesVendues(r, reglages) {
  const programme = partiesDuProgramme(r);
  if (programme) return programme;
  if (r.type === 'laser') return partiesDeLaDuree(Number(r.duration) || 0.5);
  const formule = r.formuleId ? (reglages.formules || []).find((f) => f && f.id === r.formuleId) || null : null;
  return partiesDeLaFormule(avecLeChoix(formule, r));
}
function laserLaisseAPlacer(r) {
  if (!r || r.type === 'formule' || r.type === 'laser' || r.formuleId) return false;
  const pass = r.opsPlan && r.opsPlan.laserPassPlan;
  return Boolean(pass) && (pass.pendingPasses || []).length > 0 && !(pass.scheduledPasses || []).length;
}

// Les sessions qu une console estime faute de plan (getLaserCandidateWindows).
function sessionsEstimees(debut, duree, joueurs, postes) {
  const parties = partiesDeLaDuree(duree === undefined ? 0.5 : duree);
  const tailles = tailleDesVagues(joueurs, postes);
  let curseur = caler(heureNum(debut));
  const out = [];
  for (let p = 0; p < parties; p += 1) {
    for (let v = 0; v < tailles.length; v += 1) {
      const start = curseur;
      const end = start + (ARENE_MINUTES / 60);
      out.push({ resourceType: 'laser_arena', start, end, duration: end - start, countIndex: p + 1, groupWaveIndex: v + 1, groupWaveCount: tailles.length, estimee: true });
      curseur = caler(end);
    }
  }
  return out;
}
function sessionsDeFormuleEstimees(r, reglages) {
  if (!(r.type === 'formule' || r.formuleId || partiesDuProgramme(r) > 0)) return [];
  const formule = r.formuleId ? avecLeChoix(FORMULES_DU_FICHIER.find((x) => x.id === r.formuleId), r) : null;
  const items = r.program && Array.isArray(r.program.items) ? r.program.items : [];
  const laserItem = items.find((i) => i && i.activityId === 'laser_game');
  const parties = laserItem && laserItem.extraLaser ? Number(laserItem.games) || 1 : partiesDuProgramme(r) || partiesDeLaFormule(formule);
  if (!parties) return [];
  const joueurs = Math.max(1, Number(joueursDe(r, 'laser_game')) || 1);
  const pass = r.opsPlan && r.opsPlan.laserPassPlan;
  const prefere = (r.preference && r.preference.preferredLaserTime) || (pass && Array.isArray(pass.scheduledPasses) && pass.scheduledPasses[0] && pass.scheduledPasses[0].startTime) || '';
  const bowling = fenetres(r, 'bowling_lane', reglages).sort((a, b) => Number(a.start) - Number(b.start));
  const premiere = prefere
    ? heureNum(prefere)
    : bowling.length ? caler(Math.max(...bowling.map((w) => Number(w.end || w.start))) + (5 / 60)) : caler(heureNum(r.startTime));
  const posees = pass && pass.scheduledPasses;
  return sessionsEstimees(heureTexte(premiere), parties * 0.5, joueurs, reglages.postes)
    .filter((w) => !(laserItem && laserItem.extraLaser) || !Array.isArray(posees) || posees.some((x) => Number(x.countIndex) === w.countIndex));
}

// getResourceWindowsFromReservation : les blocs du plan, sinon ce que la console estime.
function fenetres(r, type, reglages) {
  const blocs = Array.isArray(r.opsPlan && r.opsPlan.resourceBlocks) ? r.opsPlan.resourceBlocks : [];
  const pass = (r.opsPlan && r.opsPlan.laserPassPlan) || null;
  const partiesPosees = new Set(((pass && pass.scheduledPasses) || []).map((x) => Number(x.countIndex || 1)));
  const posees = blocs
    .filter((b) => b && b.resourceType === type)
    .filter((b) => !(type === 'laser_arena' && r.type === 'laser' && Number(b.countIndex || 1) > 1 && !b.manualLaserPass && pass && !partiesPosees.has(Number(b.countIndex || 1))))
    .map((b) => {
      const start = heureDuBloc(b, 'start');
      const brute = heureDuBloc(b, 'end', start + (Number(b.durationMinutes || ARENE_MINUTES) / 60));
      const end = type === 'laser_arena' ? finArene(start, brute) : brute;
      return { ...b, start, end, duration: Math.max(0, end - start), lanes: ((b.lanes && b.lanes.length) ? b.lanes : (r.lanes || [])).map(Number) };
    })
    .filter((w) => w.duration > 0);
  if (posees.length) return posees;
  if (type === 'laser_arena' && r.opsPlan && r.opsPlan.laserManual) return posees;
  if (type === 'laser_arena' && laserLaisseAPlacer(r)) return posees;
  if (type === 'bowling_lane' && (r.lanes || []).length) {
    const heures = dureeEnHeures(r.duration);
    return [{ resourceType: type, start: heureNum(r.startTime), end: heureNum(r.startTime) + heures, duration: heures, lanes: (r.lanes || []).map(Number) }];
  }
  if (type === 'laser_arena' && (r.type === 'formule' || r.formuleId || partiesDuProgramme(r) > 0)) return sessionsDeFormuleEstimees(r, reglages);
  if (type === 'laser_arena' && r.type === 'laser') {
    const parties = partiesVendues(r, reglages);
    return sessionsEstimees(r.startTime, r.duration, joueursDe(r, 'laser_game'), reglages.postes).filter((w) => parties <= 1 || Number(w.countIndex || 1) === 1);
  }
  return [];
}

// getPendingLaserPassesForReservation : les vagues qu aucun bloc ne pose encore.
function partiesAPlacer(r, laser, reglages) {
  if (!(r && r.status !== 'cancelled' && (r.type === 'laser' || r.type === 'formule' || r.formuleId || partiesDuProgramme(r) > 0))) return [];
  const parties = Math.max(1, partiesVendues(r, reglages));
  const unites = [];
  for (let p = 1; p <= parties; p += 1) tailleDesVagues(joueursDeLaPartie(r, p), reglages.postes).forEach((_, i) => unites.push({ countIndex: p, cle: `${p}.${i + 1}` }));
  const manuel = Boolean(r.opsPlan && r.opsPlan.laserManual);
  if (!(unites.length > 1 || manuel || laserLaisseAPlacer(r))) return [];
  const posees = new Set(laser.map((w) => `${Number(w.countIndex || 1)}.${Number(w.groupWaveIndex || 1)}`));
  const ancre = r.opsPlan && r.opsPlan.laserPassPlan ? false : (!manuel && r.type !== 'laser');
  return unites.filter((u, i) => !(ancre && i === 0) && !posees.has(u.cle));
}

// getFormulaActivityChecklist : les etapes de la formule (avec la variante achetee), sinon le plan.
function formuleSuivie(r) {
  if (!r) return false;
  if (Object.prototype.hasOwnProperty.call(ETAPES, idDeFormule(r))) return true;
  const formule = r.type === 'formule' || Boolean(r.formuleId) || Boolean(r.program && r.program.formuleSurMesure);
  const pas = Array.isArray(r.opsPlan && r.opsPlan.timeline) ? r.opsPlan.timeline : [];
  return formule && pas.some((s) => s && s.type === 'activity');
}
function idDeFormule(r) { return String((r && (r.formuleId || r.formulaId)) || '').trim(); }
function etapesDeLaFormule(r) {
  const etapes = Object.prototype.hasOwnProperty.call(ETAPES, idDeFormule(r)) ? ETAPES[idDeFormule(r)] : null;
  const choix = choixDeFormule(r);
  const remplacees = new Set(choix ? choix.replaces.map(String) : []);
  if (!Array.isArray(etapes) || !etapes.some((s) => remplacees.has(s.a))) return etapes;
  const out = [];
  let posees = false;
  etapes.forEach((s) => {
    if (!remplacees.has(s.a)) { out.push(s); return; }
    if (posees) return;
    posees = true;
    choix.steps.forEach((e) => out.push({ a: String(e.activityId), c: Math.max(1, Number(e.count) || 1), ...(e.label ? { label: String(e.label), libelle: String(e.label) } : {}) }));
  });
  return out;
}
function listeDeLaFormule(r) {
  const progression = r.activityProgress && typeof r.activityProgress === 'object' ? r.activityProgress : {};
  const heures = {};
  const vus = {};
  (Array.isArray(r.opsPlan && r.opsPlan.timeline) ? r.opsPlan.timeline : []).filter((s) => s && s.type === 'activity').forEach((s) => {
    const a = String(s.activityId || '');
    vus[a] = (vus[a] || 0) + 1;
    if (s.flexible) return;
    heures[`${a}-${Number(s.countIndex || vus[a])}`] = { startTime: s.startTime || '', endTime: s.endTime || '' };
  });
  const item = (a, occ, nom, libelle = '') => {
    const cle = `${a}-${occ}`;
    const t = heures[cle] || {};
    return { cle, activityId: a, partie: occ, nom, ...(libelle ? { libelle } : {}), startTime: t.startTime || '', endTime: t.endTime || '', fait: Boolean(progression[cle] && progression[cle].done) };
  };
  const etapes = etapesDeLaFormule(r);
  if (Array.isArray(etapes)) {
    const out = [];
    etapes.forEach((s) => {
      const a = String(s.a || 'activite');
      const n = Math.max(1, Number(s.c || 1));
      if (SEANCES.has(a) && n > 1) for (let i = 1; i <= n; i += 1) out.push(item(a, i, `${nomDe(a)} (${i}/${n})`));
      else out.push(item(a, 1, nomDe(a, s.label), s.libelle));
    });
    return out;
  }
  const occurrences = new Map();
  const out = [];
  (Array.isArray(r.opsPlan && r.opsPlan.timeline) ? r.opsPlan.timeline : []).filter((s) => s && s.type === 'activity').forEach((s) => {
    const a = String(s.activityId || 'activite');
    const occ = (occurrences.get(a) || 0) + 1;
    occurrences.set(a, occ);
    out.push(item(a, Number(s.countIndex || occ), nomDe(a, s.label)));
  });
  return out;
}

// Le nom d une activite libre du programme (nomActivite) : celui de sa ligne, sinon du catalogue.
function nomDeLaLigne(item) {
  if (item && item.name) return String(item.name);
  const id = item && item.activityId;
  if (!id) return 'Activité';
  const activite = require('./ops-knowledge').getActivity(id);
  return (activite && activite.name) || String(id).replace(/_/g, ' ');
}

// Le programme, dans l ordre de la fiche. reglages : { postes (les postes de l arene du centre),
// formules (le catalogue de formules du centre, celui de la console) }.
function etapesACocher(r, reglages = {}) {
  if (!r) return [];
  const postesLus = Number(reglages.postes);
  const R = { postes: Number.isFinite(postesLus) && postesLus > 0 ? Math.trunc(postesLus) : POSTES_PAR_DEFAUT, formules: Array.isArray(reglages.formules) ? reglages.formules : FORMULES_DU_FICHIER };
  const progression = r.activityProgress && typeof r.activityProgress === 'object' ? r.activityProgress : {};
  const faite = (cle) => Boolean(progression[cle] && progression[cle].done);
  const tout = [...fenetres(r, 'bowling_lane', R), ...fenetres(r, 'laser_arena', R)].sort((a, b) => Number(a.start) - Number(b.start));
  const bowling = tout.filter((f) => f.resourceType === 'bowling_lane');
  const laser = tout.filter((f) => f.resourceType === 'laser_arena');
  const etapes = [];
  bowling.forEach((f, i) => {
    const cle = bowling.length === 1 ? 'bowling-1' : `bowling-g${i + 1}`;
    etapes.push({ cle, activityId: 'bowling', nom: 'Bowling', partie: i + 1, parties: bowling.length, start: f.start, end: f.end, pistes: (f.lanes || []).filter(Number.isFinite), fait: faite(cle) });
  });
  laser.forEach((f) => {
    const partie = Math.max(1, Number(f.countIndex) || 1);
    const vagues = Math.max(1, Number(f.groupWaveCount) || 1);
    const vague = Number(f.groupWaveIndex) || 1;
    const cle = vagues === 1 ? `laser_game-${partie}` : `laser_game-${partie}-g${vague}`;
    etapes.push({ cle, activityId: 'laser_game', nom: 'Laser Game', partie, ...(vagues > 1 ? { groupe: vague, groupes: vagues } : {}), start: f.start, end: f.end, ...(f.estimee ? { estimee: true } : {}), fait: faite(cle) });
  });
  if (formuleSuivie(r)) {
    listeDeLaFormule(r).filter((x) => x.activityId !== 'bowling' && x.activityId !== 'laser_game').forEach((x) => {
      const libelle = x.libelle ? { libelle: x.libelle } : {};
      if (!x.startTime) { etapes.push({ cle: x.cle, activityId: x.activityId, nom: x.nom, ...libelle, partie: x.partie, start: null, end: null, libre: true, fait: x.fait }); return; }
      const start = heureNum(x.startTime);
      let end = x.endTime ? heureNum(x.endTime) : start;
      if (end < start) end += 24;
      etapes.push({ cle: x.cle, activityId: x.activityId, nom: x.nom, ...libelle, partie: x.partie, start, end, fait: x.fait });
    });
  }
  [...new Set(partiesAPlacer(r, laser, R).map((u) => Number(u.countIndex) || 1))].sort((a, b) => a - b).forEach((partie) => {
    const cle = `laser_game-${partie}`;
    etapes.push({ cle, activityId: 'laser_game', nom: 'Laser Game', partie, start: null, end: null, aPlacer: true, fait: faite(cle) });
  });
  const items = r.program && Array.isArray(r.program.items) ? r.program.items : [];
  const pas = r.opsPlan && Array.isArray(r.opsPlan.timeline) ? r.opsPlan.timeline : [];
  items.filter((item) => item && !item.planned && !item.waitOffer).forEach((item) => {
    const avant = item.avant === true ? pas.find((s) => s && s.activityId === item.activityId && s.flexible === false && s.startTime && s.endTime) || null : null;
    const cle = `libre-${item.activityId}`;
    etapes.push({ cle, activityId: item.activityId, nom: nomDeLaLigne(item), start: avant ? heureNum(avant.startTime) : null, end: avant ? heureNum(avant.endTime) : null, ...(avant ? {} : { libre: true }), fait: faite(cle) });
  });
  const rang = (e) => (e.start !== null && e.start !== undefined ? 0 : e.aPlacer ? 1 : 2);
  return etapes.sort((a, b) => rang(a) - rang(b) || (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0));
}

module.exports = { etapesACocher, heureTexte, __test: { NOMS, ETAPES } };

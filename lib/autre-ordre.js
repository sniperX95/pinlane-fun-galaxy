'use strict';
// UN AUTRE ORDRE, LA MEME ARRIVEE (2026-11-18).
//
// Marius, gerant de Gembloux (message vocal du 18/11) : un groupe veut venir a
// 15:15 pour le bowling, le minigolf et les arcades ; a cette heure, un groupe de
// 26 tient cinq pistes et un autre groupe en tient deux. « Comme je rajoute une
// reservation, l algo ne change pas en se disant : finalement, le bowling, je vais
// le remettre en dernier. Ils vont d abord commencer par Minigolf, Arcade. »
// Une visite garde l ordre de ses lignes : le bowling plein a l heure d arrivee,
// le comptoir decale toute la visite ou le dossier part « a valider ».
//
// Ici : la meme arrivee, les memes activites, les memes joueurs, et l ordre libre.
// Chaque ordre se joue a blanc par la porte de la fenetre Reserver
// (planifierPourLaFenetre, le meme moteur que la creation, `planifier`), et le
// meilleur revient avec ses heures. Rien ne s ecrit ici.
//
// LES HEURES D UN ORDRE. La premiere activite commence a l arrivee. Une activite
// libre (minigolf, arcades) prend sa duree a la suite. Le bowling et le laser
// partent sur leur grille (:00 et :30), a la demi-heure qui suit, dix minutes au
// moins apres l arrivee (l accueil) ; au comptoir, un bowling en premiere ligne a
// une heure pile part a l arrivee, comme aujourd hui. Les activites libres d avant
// la premiere activite a heure partent marquees « avant », avec l heure d arrivee
// (lib/visit-program poserLesActivitesDAvant) : le plan les pose a leur heure.
//
// LE MEILLEUR ORDRE. L ordre demande qui tient reste l ordre demande. Sinon : le
// moins d attente, puis la visite qui finit le plus tot, puis l ordre le plus
// proche de celui demande. Quand l heure naturelle d une activite a heure est
// prise, elle peut attendre une ou deux demi-heures (jamais plus d une heure).
// Rien ne tient : la raison du moteur, telle quelle.

const ANCRES = ['bowling', 'laser_game'];
const GRILLE = 30; // PROGRAM_GRID_MINUTES (lib/ops-engine.js)
const ACCUEIL = 10; // FORMULA_ARRIVAL_MINUTES (lib/ops-engine.js)
const PAS_ARRIVEE = 5; // une arrivee au comptoir se pose a cinq minutes pres
const ACTIVITES_MAX = 6; // au-dela, seul l ordre demande se joue (720 ordres)
const ESSAIS_MAX = 40; // les plans joues a blanc pour une demande, au plus
const ATTENTES = [0, 30, 60]; // ce qu une activite a heure peut attendre

function minutesDe(texte) {
  const lu = /^(\d{1,2}):(\d{2})/.exec(String(texte || ''));
  return lu && Number(lu[2]) < 60 ? Number(lu[1]) * 60 + Number(lu[2]) : null;
}
function heureDe(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 24 * 60) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
const estAncre = (id) => ANCRES.includes(id);

function lignesDuCorps(corps) {
  const p = corps && corps.program;
  return Array.isArray(p) ? p : (p && Array.isArray(p.items) ? p.items : []);
}

// La duree de chaque ligne, celle que le serveur compte : le programme normalise
// (lib/visit-program normalizeProgram, via normalizeReservationRequest). Le laser :
// ses parties l une apres l autre, chacune de ses vagues a la suite.
function dureesDesLignes(corps) {
  const { normalizeReservationRequest } = require('./reservation-request');
  const { getCenter } = require('./ops-knowledge');
  let items = [];
  try {
    const requete = normalizeReservationRequest({ ...corps, channel: 'staff' }, { channel: 'staff', centerId: corps.centerId });
    items = requete.program && Array.isArray(requete.program.items) ? requete.program.items : [];
  } catch (error) {
    items = [];
  }
  let armes = 30;
  try { armes = Number(getCenter(corps.centerId || 'libramont').resources.laser.weaponCount) || 30; } catch (error) { armes = 30; }
  const durees = new Map();
  const noms = new Map();
  const parties = new Map();
  items.forEach((item) => {
    const id = String(item.activityId || '');
    if (!id || durees.has(id)) return;
    noms.set(id, String(item.name || id));
    if (id === 'laser_game') {
      const joueurs = Math.max(1, Number(item.participants ?? corps.pax) || 1);
      const vagues = Math.max(1, Math.ceil(joueurs / armes));
      const nombre = Math.max(1, Math.trunc(Number((item.extraLaser && item.extraLaser.games) || item.games) || 1));
      parties.set(id, { nombre, pas: GRILLE * vagues });
      durees.set(id, nombre * GRILLE * vagues);
      return;
    }
    durees.set(id, Math.max(0, Math.round(Number(item.minutes) || (Number(item.duration) || 0) * 60 || 30)));
  });
  return { durees, noms, parties };
}

// Les ordres a essayer, l ordre demande en tete. Deux activites libres qui se
// suivent ne changent rien aux heures des activites a heure : elles gardent leur
// ordre de depart (« Minigolf puis Arcades »), un seul ordre les represente.
function permutations(liste) {
  if (liste.length <= 1) return [liste.slice()];
  const toutes = [];
  liste.forEach((id, rang) => {
    permutations([...liste.slice(0, rang), ...liste.slice(rang + 1)]).forEach((suite) => toutes.push([id, ...suite]));
  });
  return toutes;
}
function canonique(ordre, depart) {
  const sortie = [];
  let suite = [];
  const vider = () => { suite.sort((a, b) => depart.indexOf(a) - depart.indexOf(b)); sortie.push(...suite); suite = []; };
  ordre.forEach((id) => { if (estAncre(id)) { vider(); sortie.push(id); } else suite.push(id); });
  vider();
  return sortie;
}
function ordresCandidats(ids) {
  const vus = new Set();
  const ordres = [];
  const ajouter = (ordre) => {
    const forme = canonique(ordre, ids);
    const cle = forme.join('>');
    if (vus.has(cle)) return;
    vus.add(cle);
    ordres.push(forme);
  };
  ajouter(ids);
  if (ids.length <= ACTIVITES_MAX) permutations(ids).forEach(ajouter);
  return ordres;
}

// L ecart a l ordre demande : les paires de lignes inversees.
function ecartDOrdre(ordre, depart) {
  let n = 0;
  for (let i = 0; i < ordre.length; i += 1) {
    for (let j = i + 1; j < ordre.length; j += 1) if (depart.indexOf(ordre[i]) > depart.indexOf(ordre[j])) n += 1;
  }
  return n;
}

// Les heures d un ordre a partir de l arrivee. `attentes` : les minutes qu une
// activite a heure attend apres son heure naturelle ; `vraies` : les durees que le
// plan a vraiment posees (un groupe en deux services de bowling).
function horairesDeLOrdre({ ordre, arrivee, durees, parties, attentes = {}, vraies = {} }) {
  let curseur = arrivee;
  let attente = 0;
  const etapes = [];
  ordre.forEach((id, rang) => {
    const duree = Number.isFinite(vraies[id]) ? vraies[id] : (durees.get(id) || 0);
    if (!estAncre(id)) {
      etapes.push({ id, debut: curseur, fin: curseur + duree, ancre: false });
      curseur += duree;
      return;
    }
    const pile = rang === 0 && arrivee % GRILLE === 0;
    const naturelle = pile ? arrivee : Math.ceil(Math.max(curseur, arrivee + ACCUEIL) / GRILLE) * GRILLE;
    const debut = naturelle + (Number(attentes[id]) || 0);
    attente += rang === 0 ? debut - naturelle : debut - curseur;
    const partie = parties.get(id);
    etapes.push({ id, debut, fin: debut + duree, ancre: true, ...(partie ? { parties: partie.nombre, pas: partie.pas } : {}) });
    curseur = debut + duree;
  });
  const premiere = etapes.findIndex((etape) => etape.ancre);
  return {
    etapes,
    attente,
    fin: curseur,
    avant: premiere > 0 ? etapes.slice(0, premiere).map((etape) => etape.id) : [],
    // Une premiere activite libre, ou une arrivee hors de la grille : la visite se
    // compose a partir de l arrivee (lib/ops-engine chooseArrivalCombination).
    parArrivee: !etapes[0].ancre || arrivee % GRILLE !== 0,
  };
}

// Le corps que la fenetre enverrait pour cet ordre : les lignes dans l ordre, les
// libres d avant marquees, l heure de chaque activite a heure, l arrivee.
function corpsDeLOrdre(corps, ordre, horaire, arrivee) {
  const avant = new Set(horaire.avant);
  const lignes = lignesDuCorps(corps);
  const parId = new Map();
  lignes.forEach((ligne) => { const id = String(ligne.activityId || ''); if (id && !parId.has(id)) parId.set(id, ligne); });
  const program = ordre.map((id) => {
    const { avant: _avant, ...ligne } = parId.get(id) || { activityId: id };
    return avant.has(id) ? { ...ligne, avant: true } : ligne;
  });
  const preferredTimes = {};
  const laserGameTimes = [];
  horaire.etapes.filter((etape) => etape.ancre).forEach((etape) => {
    preferredTimes[etape.id] = heureDe(etape.debut);
    if (etape.id === 'laser_game') for (let k = 0; k < (etape.parties || 1); k += 1) laserGameTimes.push(heureDe(etape.debut + k * (etape.pas || GRILLE)));
  });
  const {
    activityOrder: _ordre, preferredTimes: _heures, preferredBowlingTime: _b, preferredLaserTime: _l,
    laserGameTimes: _parties, laserPlacement: _placement, arrivalTime: _arrivee, firstActivityId: _premiere, ...reste
  } = (corps.preference && typeof corps.preference === 'object') ? corps.preference : {};
  return {
    ...corps,
    startTime: heureDe(arrivee),
    program: Array.isArray(corps.program) ? program : { ...corps.program, items: program },
    preference: {
      ...reste,
      activityOrder: ordre.slice(),
      preferredTimes,
      laserGameTimes,
      laserPlacement: 'scheduled',
      ...(horaire.parArrivee ? { arrivalTime: heureDe(arrivee) } : {}),
    },
  };
}

// Les fenetres que le plan a vraiment posees, activite par activite.
function fenetresDuPlan(plan) {
  const fenetres = new Map();
  (plan && Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : []).forEach((bloc) => {
    if (!bloc) return;
    const id = bloc.resourceType === 'bowling_lane' ? 'bowling' : bloc.resourceType === 'laser_arena' ? 'laser_game' : '';
    const debut = minutesDe(bloc.startTime);
    const fin = minutesDe(bloc.endTime);
    if (!id || debut === null || fin === null) return;
    const deja = fenetres.get(id) || { debut, fin, pistes: [] };
    deja.debut = Math.min(deja.debut, debut);
    deja.fin = Math.max(deja.fin, fin);
    (Array.isArray(bloc.lanes) ? bloc.lanes : []).map(Number).forEach((piste) => { if (Number.isInteger(piste) && !deja.pistes.includes(piste)) deja.pistes.push(piste); });
    fenetres.set(id, deja);
  });
  fenetres.forEach((f) => f.pistes.sort((a, b) => a - b));
  return fenetres;
}

function aUnConflitBloquant(conflits) {
  return require('./reserver-fenetre').aUnConflitBloquant(conflits);
}

// Ce que le moteur dit d un plan qui ne tient pas : son refus, sinon son premier conflit.
function raisonDuRefus(resultat) {
  const plan = resultat && resultat.plan;
  if (plan && plan.refus) return String(plan.refus);
  const conflit = (resultat && Array.isArray(resultat.conflits) ? resultat.conflits : []).find((c) => c && c.message);
  return conflit ? String(conflit.message) : '';
}

// La demande peut-elle changer d ordre ? Un programme d au moins deux activites,
// dont une a heure, et une heure d arrivee. Une formule garde l ordre de sa carte.
function eligible(corps) {
  const lignes = lignesDuCorps(corps);
  const ids = [];
  lignes.forEach((ligne) => { const id = String((ligne && ligne.activityId) || ''); if (id && !ids.includes(id)) ids.push(id); });
  const arrivee = minutesDe(corps && corps.startTime);
  if (corps && (corps.formuleId || corps.formulaId)) return { ok: false, ids, raison: 'Une formule garde l’ordre de sa carte.' };
  if (ids.length < 2) return { ok: false, ids, raison: 'Une seule activité : il n’y a pas d’autre ordre.' };
  if (!ids.some(estAncre)) return { ok: false, ids, raison: 'Aucune activité à heure fixe : l’ordre se fait sur place.' };
  if (arrivee === null) return { ok: false, ids, raison: 'Sans heure d’arrivée, aucun ordre ne se calcule.' };
  if (arrivee % PAS_ARRIVEE !== 0) return { ok: false, ids, raison: 'L’heure d’arrivée se pose à cinq minutes près.' };
  return { ok: true, ids, arrivee };
}

// LA RECHERCHE. `planifier(corps)` rend ce que planifierPourLaFenetre rend
// ({ ops, dossier, conflits, plan }). Rend { ok, arrivee, ordreDemande, trouve,
// raison, essais } : `trouve` porte l ordre, ses etapes a l heure, l attente, la
// fin, sa cle et la modification a ecrire ; null quand rien ne tient.
async function chercherUnAutreOrdre({ corps, planifier }) {
  const base = eligible(corps || {});
  if (!base.ok) return { ok: true, arrivee: heureDe(minutesDe(corps && corps.startTime)), ordreDemande: base.ids, trouve: null, raison: base.raison, essais: 0 };
  const { ids, arrivee } = base;
  const { durees, noms, parties } = dureesDesLignes(corps);
  const ordres = ordresCandidats(ids);
  const refus = [];
  const tenus = [];
  let essais = 0;

  const jouer = async (ordre, attentes) => {
    let vraies = {};
    for (let passe = 0; passe < 2; passe += 1) {
      if (essais >= ESSAIS_MAX) return null;
      const horaire = horairesDeLOrdre({ ordre, arrivee, durees, parties, attentes, vraies });
      if (horaire.fin > 24 * 60 || horaire.etapes.some((etape) => !heureDe(etape.debut))) return null;
      const variante = corpsDeLOrdre(corps, ordre, horaire, arrivee);
      essais += 1;
      let resultat = null;
      try {
        resultat = await planifier(variante);
      } catch (error) {
        refus.push(String((error && error.message) || 'Erreur du moteur.'));
        return null;
      }
      const plan = resultat && resultat.dossier && resultat.dossier.opsPlan;
      if (!plan || !resultat.ops || resultat.ops.planAvailable === false || aUnConflitBloquant(resultat.conflits)) {
        const raison = raisonDuRefus(resultat);
        if (raison) refus.push(raison);
        return null;
      }
      // Le plan pose-t-il chaque activite a heure ou cet ordre l attend ? Une plus
      // longue (deux services de bowling) decale la suite : une seconde passe.
      const fenetres = fenetresDuPlan(plan);
      const decalees = horaire.etapes.filter((etape) => etape.ancre && (!fenetres.has(etape.id) || fenetres.get(etape.id).debut !== etape.debut));
      if (decalees.length) return null;
      const longues = horaire.etapes.filter((etape) => etape.ancre && fenetres.get(etape.id).fin > etape.fin);
      if (longues.length && passe === 0) {
        vraies = {};
        horaire.etapes.filter((etape) => etape.ancre).forEach((etape) => { vraies[etape.id] = fenetres.get(etape.id).fin - fenetres.get(etape.id).debut; });
        continue;
      }
      if (longues.length) return null;
      return { ordre, horaire, variante, resultat, fenetres };
    }
    return null;
  };

  const demande = ordres[0];
  const memeOrdre = await jouer(demande, {});
  if (memeOrdre) return reponse({ corps, ids, arrivee, noms, tenu: memeOrdre, inchange: true, essais });

  // Les autres ordres, sans attente d abord, puis une ou deux demi-heures
  // d attente pour une activite a heure dont l heure naturelle est prise.
  for (const attente of ATTENTES) {
    for (const ordre of ordres) {
      const ancres = ordre.filter(estAncre);
      const variantes = attente === 0 ? [{}] : ancres.map((id) => ({ [id]: attente }));
      for (const attentes of variantes) {
        if (attente === 0 && ordre === demande) continue;
        const tenu = await jouer(ordre, attentes);
        if (tenu) tenus.push(tenu);
      }
    }
    if (tenus.length || essais >= ESSAIS_MAX) break;
  }
  if (!tenus.length) {
    const distinctes = [...new Set(refus.filter(Boolean))].slice(0, 2);
    const raison = [`Aucun ordre ne tient en gardant l’arrivée à ${heureDe(arrivee)}.`, ...distinctes].join(' ');
    return { ok: true, arrivee: heureDe(arrivee), ordreDemande: ids, trouve: null, raison, essais };
  }
  tenus.sort((a, b) => (a.horaire.attente - b.horaire.attente)
    || (a.horaire.fin - b.horaire.fin)
    || (ecartDOrdre(a.ordre, ids) - ecartDOrdre(b.ordre, ids))
    || a.ordre.join('>').localeCompare(b.ordre.join('>')));
  return reponse({ corps, ids, arrivee, noms, tenu: tenus[0], inchange: false, essais });
}

function reponse({ ids, arrivee, noms, tenu, inchange, essais }) {
  const { ordre, horaire, variante, resultat, fenetres } = tenu;
  const etapes = horaire.etapes.map((etape) => ({
    id: etape.id,
    nom: noms.get(etape.id) || etape.id,
    debut: heureDe(etape.debut),
    fin: heureDe(etape.fin),
    ancre: etape.ancre,
    avant: horaire.avant.includes(etape.id),
    ...(etape.ancre && fenetres.get(etape.id) && fenetres.get(etape.id).pistes.length ? { pistes: fenetres.get(etape.id).pistes.slice() } : {}),
  }));
  return {
    ok: true,
    arrivee: heureDe(arrivee),
    ordreDemande: ids,
    trouve: {
      ordre: ordre.slice(),
      inchange,
      etapes,
      attente: horaire.attente,
      fin: heureDe(horaire.fin),
      parArrivee: horaire.parArrivee,
      // La cle de la proposition : l ordre, ses heures et ses pistes, ce que l employe a lu.
      // L application la redemande au serveur, qui refuse une proposition qui a change.
      cle: `${heureDe(arrivee)}|${etapes.map((etape) => `${etape.id}@${etape.debut}${etape.pistes ? `[${etape.pistes.join(',')}]` : ''}`).join('>')}`,
      // Ce que l application ecrit : rien d autre que l ordre, ses heures et l arrivee.
      modification: { startTime: variante.startTime, program: variante.program, preference: variante.preference },
      plan: resultat.plan || null,
    },
    raison: '',
    essais,
  };
}

// LE CORPS D UN DOSSIER ENREGISTRE : son programme, son groupe, son jour et son
// heure d arrivee, sans contact ni prix (le plan n en depend pas). Le dossier
// lui-meme ne compte pas dans la journee (ignoreReservationId) : sa propre place ne
// lui est jamais refusee.
// L ORDRE D UN DOSSIER est celui de son plan, pas celui de son programme (le serveur
// range le programme dans l ordre du catalogue, lib/visit-program normalizeProgram) :
// les activites posees avant la premiere, a leur heure ; puis le bowling et le laser a
// leur heure ; puis le reste du libre. Sans plan (un dossier « a placer »), l ordre du
// catalogue : le bowling et le laser d abord.
function ordreDuDossier(items, plan) {
  const debuts = new Map();
  const noter = (id, heure) => { const m = minutesDe(heure); if (id && m !== null && (!debuts.has(id) || m < debuts.get(id))) debuts.set(id, m); };
  (Array.isArray(plan.timeline) ? plan.timeline : []).forEach((pas) => { if (pas && pas.flexible !== true && pas.activityId) noter(String(pas.activityId), pas.startTime); });
  (Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : []).forEach((bloc) => {
    if (!bloc) return;
    noter(bloc.resourceType === 'bowling_lane' ? 'bowling' : bloc.resourceType === 'laser_arena' ? 'laser_game' : '', bloc.startTime);
  });
  const parHeure = (a, b) => (debuts.has(a.activityId) ? debuts.get(a.activityId) : Infinity) - (debuts.has(b.activityId) ? debuts.get(b.activityId) : Infinity);
  const avant = items.filter((item) => !estAncre(item.activityId) && item.avant === true && debuts.has(item.activityId)).sort(parHeure);
  const ancres = items.filter((item) => estAncre(item.activityId)).sort(parHeure);
  return [...avant, ...ancres, ...items.filter((item) => !avant.includes(item) && !ancres.includes(item))];
}

function corpsDuDossier(dossier) {
  const items = Array.isArray(dossier && dossier.program) ? dossier.program : ((dossier && dossier.program && dossier.program.items) || []);
  const plan = dossier && dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : {};
  const garder = ['activityId', 'pax', 'participants', 'duration', 'games', 'units', 'hours', 'minutes', 'sessionMinutes', 'arcadeMode', 'arcadeOfferId', 'cards', 'extraLaser', 'upsell', 'joueursParPartie', 'groupes', 'waitOffer', 'dayAccess', 'bowlingCapacity', 'laneCount'];
  const lignes = ordreDuDossier(items.filter((item) => item && item.activityId), plan).map((item) => {
    const ligne = {};
    garder.forEach((cle) => { if (item[cle] !== undefined && item[cle] !== null) ligne[cle] = item[cle]; });
    return ligne;
  });
  const pistesALaMain = Math.trunc(Number((plan.resourceBlocks || []).map((bloc) => bloc && bloc.pistesALaMain).find(Boolean)) || 0);
  return {
    centerId: dossier.centerId || 'libramont',
    date: dossier.date,
    startTime: String(dossier.startTime || '').slice(0, 5),
    pax: dossier.pax,
    ...(dossier.companions ? { companions: dossier.companions } : {}),
    type: 'visite',
    formuleId: dossier.formuleId || '',
    program: lignes,
    duration: dossier.duration,
    totalDuration: dossier.totalDuration,
    lanes: [],
    status: 'pending',
    name: '',
    phone: '',
    email: '',
    notes: '',
    occasion: '',
    extras: [],
    channel: 'staff',
    preference: plan.arene === 'seuls' ? { arene: 'seuls' } : {},
    ...(pistesALaMain ? { pistesALaMain } : {}),
    ignoreReservationId: Number(dossier.id),
  };
}

// LE PLAN ECRIT EST-IL CELUI QUE L EMPLOYE A LU ? Chaque activite a heure a son heure, et
// le bowling ses pistes. Sinon (une piste prise entre la lecture et le clic), rien ne s ecrit.
function planConformeALaProposition(plan, trouve) {
  if (!plan || !trouve || !Array.isArray(trouve.etapes)) return false;
  const fenetres = fenetresDuPlan(plan);
  return trouve.etapes.filter((etape) => etape.ancre).every((etape) => {
    const f = fenetres.get(etape.id);
    return Boolean(f) && heureDe(f.debut) === etape.debut
      && (!etape.pistes || f.pistes.join(',') === etape.pistes.join(','));
  });
}

module.exports = {
  ACCUEIL,
  ATTENTES,
  ESSAIS_MAX,
  canonique,
  chercherUnAutreOrdre,
  corpsDeLOrdre,
  corpsDuDossier,
  eligible,
  horairesDeLOrdre,
  ordresCandidats,
  planConformeALaProposition,
};

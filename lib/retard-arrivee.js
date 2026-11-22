// LE RETARD D UN GROUPE ET SES HEURES (2026-11-21). Le gerant : « quand on met quelqu un en
// retard, faut que ce soit super bien visible mais bien pro aussi [...] le temps bien visible,
// toutes les activites aussi », puis : le retard reste lisible apres « Arrivé » et « Payé », et
// un groupe pointe apres son heure ouvre une fenetre. Elle dit le retard, puis la nouvelle heure
// de chaque activite a venir, jugee par le controle du glisser du planning (buildActivityMove,
// puis validateActivityMoveResources contre la journee), celui du verdict de « Modifier »
// (deplacerABlanc). Le bouton « Retard » de la fiche passe par le meme calcul.
//   - etapesDuRetard : les nouvelles heures, calculees ICI sur le dossier. Chaque activite garde
//     sa vraie duree (le contenu de la formule, « 30 min arcades », sinon le catalogue) et ne
//     commence jamais avant la fin de la precedente : le retard pousse la suite si besoin (le
//     gerant, le 21/11 : un F1 « Retard +15 min » mettait les arcades a 14:15 et le laser a
//     14:30, les deux se chevauchaient). Des arcades vendues en argent (credits, montant) n ont
//     pas d heure calculable : elles passent « libre », hors de l enchainement ;
//   - lireRetard : le corps recu, sa forme seulement (le moteur juge le reste) ;
//   - jugerDeplacements : la derniere activite d abord (elle libere la place de celle d avant),
//     sur le dossier qui porte deja les deplacements qui passent ; une activite qui ne passe pas
//     garde son heure et dit pourquoi, en mots ;
//   - planAvecRetard : le retard note sur le plan (opsPlan.delayFlag, lib/delay-flag.js), que
//     les heures bougent ou non ;
//   - LES ACTIVITES COMMENCEES SONT GELEES (2026-11-21, vu en vrai par le gerant : un retard a
//     deplace un autre groupe en pleine partie, de la piste 1 a la piste 5 ; « personne ne
//     deplace des gens en pleine partie »). Le calcul n ecrit jamais un autre dossier que celui du
//     retard ; dans ce dossier, une activite commencee ou finie garde piste, armes et heure ; une
//     heure qui tomberait sur la place d un groupe qui joue ne passe pas, et la fenetre le dit
//     (sansLesGroupesQuiJouent : « Bowling 16:15 : la piste 3 est prise par un groupe qui joue. »).
'use strict';
const { stampDelayFlag } = require('./delay-flag');

const RETARD_MINUTES_MAX = 240;
const FUSEAU = 'Europe/Brussels';
// (le banc la regle : scripts/retard-visible-check.js, [G])
const horloge = { instant: () => new Date() };
const RETARD_ETAPES_MAX = 12;
const RETARD_CHOIX = ['tout', 'passe', 'garder'];

function refus(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}
function minuteDe(valeur) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(valeur || ''));
  return m && Number(m[1]) < 48 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
function heureDe(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function bord(block, nom) {
  if (block[`${nom}Time`]) return minuteDe(block[`${nom}Time`]);
  const valeur = Number(block[nom]);
  return Number.isFinite(valeur) ? Math.round(valeur <= 48 ? valeur * 60 : valeur) : NaN;
}
const cles = (liste) => (Array.isArray(liste) ? liste.map((cle) => String(cle || '')).filter(Boolean) : []);

// `ecriture` : le choix de la fenetre et les activites qu il touche (`cles`, celles que la
// fenetre a montrees). « Garder les heures » ne deplace rien, les deux autres au moins une.
function lireRetard(corps, { ecriture = false } = {}) {
  const c = corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : null;
  if (!c) throw refus('Retard invalide.', 400);
  const minutes = Math.round(Number(c.minutes));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > RETARD_MINUTES_MAX) throw refus(`Un retard compte de 1 à ${RETARD_MINUTES_MAX} minutes.`);
  const de = String(c.de || '');
  if (!Number.isFinite(minuteDe(de))) throw refus('Heure prévue du groupe invalide.');
  if ((c.faites != null && !Array.isArray(c.faites)) || cles(c.faites).length > RETARD_ETAPES_MAX * 2) throw refus('Activités faites invalides.', 400);
  const lu = { minutes, de, faites: cles(c.faites) };
  if (ecriture) {
    if (!RETARD_CHOIX.includes(c.choix)) throw refus('Choisissez « Tout décaler », « Décaler ce qui passe » ou « Garder les heures ».');
    if (!Array.isArray(c.cles) || cles(c.cles).length > RETARD_ETAPES_MAX) throw refus('Activités du retard invalides.', 400);
    lu.choix = c.choix;
    lu.cles = cles(c.cles);
    if (lu.choix === 'garder' && lu.cles.length) throw refus('« Garder les heures » ne déplace aucune activité.');
    if (lu.choix !== 'garder' && !lu.cles.length) throw refus('Aucune activité à décaler.');
    // (le retard deja note a l arrivee, retardALArrivee : la fenetre ne fait plus que decaler)
    lu.dejaNote = c.dejaNote === true;
    if (lu.dejaNote && lu.choix === 'garder') throw refus('Le retard est déjà noté : garder les heures n’écrit rien.');
  }
  return lu;
}

// LA VRAIE DUREE D UNE ACTIVITE. Le bowling et le laser : leur place au planning (l heure et les
// parties vendues). Les autres : la ligne du programme (ses minutes), sinon le contenu de la
// formule (« 30 min arcades »), sinon le catalogue du centre, sinon l etape du plan.
function dureeReelle(current, etape) {
  if (etape.activityId === 'bowling' || etape.activityId === 'laser_game') return etape.fin - etape.debut;
  const items = Array.isArray(current.program) ? current.program : (current.program && current.program.items) || [];
  const item = items.find((ligne) => ligne && ligne.activityId === etape.activityId) || null;
  if (Number(item && item.minutes) > 0) return Math.round(Number(item.minutes));
  if (current.formuleId) {
    try {
      const { getFormula } = require('./ops-knowledge');
      const { formuleDuDossier } = require('./formula-choice');
      const formule = formuleDuDossier(getFormula(current.formuleId), current);
      const pas = ((formule && formule.steps) || []).find((step) => step && step.activityId === etape.activityId);
      if (Number(pas && pas.durationMinutes) > 0) return Math.round(Number(pas.durationMinutes));
    } catch (error) { /* une formule illisible : le catalogue */ }
  }
  try {
    const activite = require('./activity-catalog').getCenterActivity(current.centerId || 'libramont', etape.activityId);
    if (Number(activite && activite.defaultMinutes) > 0) return Math.round(Number(activite.defaultMinutes));
  } catch (error) { /* hors catalogue : le plan */ }
  return etape.fin - etape.debut;
}

// Des arcades vendues en argent : des credits remis au bar, ou une carte chargee d un montant.
function arcadesEnArgent(current, activityId) {
  if (activityId === 'arcade_credit') return true;
  if (activityId !== 'arcade_time') return false;
  const items = Array.isArray(current.program) ? current.program : (current.program && current.program.items) || [];
  const item = items.find((ligne) => ligne && ligne.activityId === 'arcade_time') || null;
  return Boolean(item && item.arcadeMode && item.arcadeMode !== 'time');
}

// LES ACTIVITES A HEURE DU DOSSIER, telles que le glisser du planning les deplace : le bowling
// (toutes ses pistes), chaque partie de laser, chaque autre activite a heure. Ni la table
// d anniversaire, ni les boissons : rien ne s y joue a une heure. Ni la plaine de jeux (2026-11-21,
// le gerant : « c'est accès toute la journée, il n'y a pas d'heure, c'est vraiment libre tout le
// temps ») : elle ne se decale pas, ne pousse rien, ne « passe » ni « ne passe » pas.
const LIBRES_TOUTE_LA_JOURNEE = ['playground'];
function activitesAHeure(current) {
  const plan = current && current.opsPlan && typeof current.opsPlan === 'object' ? current.opsPlan : {};
  const blocs = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const frise = Array.isArray(plan.timeline) ? plan.timeline : [];
  const etapes = [];
  const bowling = blocs.filter((b) => b && b.resourceType === 'bowling_lane' && Number.isFinite(bord(b, 'start')) && Number.isFinite(bord(b, 'end')));
  if (bowling.length) {
    etapes.push({
      cle: 'bowling', activityId: 'bowling', debut: Math.min(...bowling.map((b) => bord(b, 'start'))), fin: Math.max(...bowling.map((b) => bord(b, 'end'))),
      lanes: [...new Set(bowling.flatMap((b) => (Array.isArray(b.lanes) && b.lanes.length ? b.lanes : (current.lanes || []))).map(Number))].sort((a, b) => a - b),
    });
  }
  const parties = new Map();
  blocs.filter((b) => b && b.resourceType === 'laser_arena' && Number.isFinite(bord(b, 'start')) && Number.isFinite(bord(b, 'end'))).forEach((b) => {
    const unitKey = `${Number(b.countIndex || 1)}.${Number(b.groupWaveIndex || 1)}`;
    if (!parties.has(unitKey)) parties.set(unitKey, { cle: `laser_game:${unitKey}`, activityId: 'laser_game', unitKey, debut: bord(b, 'start'), fin: bord(b, 'end') });
  });
  etapes.push(...parties.values());
  const vues = new Set();
  frise.forEach((b) => {
    const id = String((b && b.activityId) || '');
    if (!b || b.type !== 'activity' || b.flexible === true || !id || id === 'bowling' || id === 'laser_game' || id === 'party_table' || /^service_/.test(id) || vues.has(id)) return;
    if (LIBRES_TOUTE_LA_JOURNEE.includes(id)) return;
    const debut = bord(b, 'start');
    const fin = bord(b, 'end');
    if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return;
    vues.add(id);
    etapes.push({ cle: id, activityId: id, debut, fin });
  });
  return etapes.sort((a, b) => a.debut - b.debut);
}

// L HEURE DU CENTRE, en minutes depuis minuit, le jour du dossier : avant ce jour rien n a
// commence, apres ce jour tout.
function maintenantDuJour(dateISO) {
  const parts = new Intl.DateTimeFormat('fr-BE', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(horloge.instant());
  const lu = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  const aujourdhui = `${lu('year')}-${lu('month')}-${lu('day')}`;
  const jour = String(dateISO || '').slice(0, 10);
  if (jour === aujourdhui) return Number(lu('hour')) * 60 + Number(lu('minute'));
  return jour < aujourdhui ? Infinity : -Infinity;
}
// Le groupe est la : pointe « Arrivé », ou deja paye.
function surPlace(r) {
  return Boolean(r) && (r.status === 'arrived' || r.status === 'paid');
}
// Son propre retard note, ni retire ni pousse par celui d un autre groupe.
function retardNote(r) {
  const flag = r && r.opsPlan && typeof r.opsPlan === 'object' ? r.opsPlan.delayFlag : null;
  if (!flag || flag.cleared || (Number(flag.sourceId) > 0 && Number(flag.sourceId) !== Number(r.id))) return null;
  return flag;
}
// L HEURE OU LE GROUPE EN RETARD EST ARRIVE : l heure prevue de son retard note, plus ses minutes.
// Ce qui devait commencer avant, il ne l a pas commence : il n etait pas la (2026-11-21, « Arrivé »
// s ecrit avant la fenetre du retard, qui decale ensuite ce que le groupe a manque).
function arriveeDuGroupe(r) {
  const flag = surPlace(r) ? retardNote(r) : null;
  const de = flag ? minuteDe(flag.from) : NaN;
  return Number.isFinite(de) && Number(flag.minutes) > 0 ? de + Math.round(Number(flag.minutes)) : -Infinity;
}
// Les activites cochees « fait » au programme (lib/programme-a-cocher.js : bowling-1, bowling-g2,
// laser_game-1, laser_game-2-g1, minigolf-1), dans les cles de ce calcul.
function faitesDuDossier(current) {
  const progression = current && current.activityProgress && typeof current.activityProgress === 'object' ? current.activityProgress : {};
  const sortie = new Set();
  Object.keys(progression).forEach((cle) => {
    if (!progression[cle] || !progression[cle].done) return;
    const laser = /^laser_game-(\d+)(?:-g(\d+))?$/.exec(cle);
    const autre = /^([a-z][a-z0-9_]*)-\d+$/.exec(cle);
    if (/^bowling-/.test(cle)) sortie.add('bowling');
    else if (laser) sortie.add(`laser_game:${Number(laser[1])}.${Number(laser[2] || 1)}`);
    else if (autre) sortie.add(autre[1]);
  });
  return sortie;
}

// Les nouvelles heures, dans l ordre de la visite. UNE ACTIVITE COMMENCEE OU FINIE NE BOUGE PAS :
// cochee « fait » (`faites`, la fiche ; la progression du dossier), ou son heure passee quand le
// groupe est sur place, et l etait deja a cette heure-la. Un groupe pas encore pointe n a rien
// commence : ce qu il n a pas joue est a venir pour lui ; arrive en retard, ce qui devait commencer
// avant son arrivee aussi (arriveeDuGroupe). Une activite gelee tient jusqu a sa fin : la suivante ne
// part pas avant.
function etapesDuRetard(current, { minutes, faites = [], maintenant = maintenantDuJour(current && current.date) }) {
  const gelees = new Set([...faites, ...faitesDuDossier(current)]);
  const arrivee = arriveeDuGroupe(current);
  const commencee = (etape) => gelees.has(etape.cle) || (surPlace(current) && etape.debut <= maintenant && etape.debut >= arrivee);
  let finPrecedente = -Infinity;
  const sortie = [];
  activitesAHeure(current).forEach((etape) => {
    if (commencee(etape)) { finPrecedente = Math.max(finPrecedente, etape.fin); return; }
    const avant = heureDe(etape.debut);
    if (arcadesEnArgent(current, etape.activityId)) {
      sortie.push({ cle: etape.cle, activityId: etape.activityId, avant, apres: '', libre: true, move: { activityId: etape.activityId, libre: true } });
      return;
    }
    let debut = Math.max(etape.debut + minutes, finPrecedente);
    if (etape.activityId === 'bowling') debut = Math.ceil(debut / 30) * 30;
    finPrecedente = debut + dureeReelle(current, etape);
    const startTime = heureDe(debut);
    const move = etape.activityId === 'bowling' ? { activityId: 'bowling', startTime, lanes: etape.lanes }
      : etape.activityId === 'laser_game' ? { activityId: 'laser_game', unitKey: etape.unitKey, startTime }
        : { activityId: etape.activityId, startTime };
    sortie.push({ cle: etape.cle, activityId: etape.activityId, avant, apres: startTime, libre: false, move });
  });
  return sortie;
}

// UN GROUPE QUI JOUE DEJA NE BOUGE PAS (2026-11-22, la pop-up de l heure et le glisser du planning
// complet). La regle d etapesDuRetard, lue sur tout le dossier : une activite cochee « fait », ou dont
// l heure est passee quand le groupe est sur place (et l etait deja a cette heure-la), a commence. Des
// qu une activite a commence, le groupe joue : ni ses heures ni sa ligne ne se deplacent d un toucher.
// Rend l heure et la phrase qui le disent, sinon null.
function groupeEnJeu(current, maintenant = maintenantDuJour(current && current.date)) {
  if (!current || current.status === 'cancelled') return null;
  const gelees = faitesDuDossier(current);
  const arrivee = arriveeDuGroupe(current);
  const commencees = activitesAHeure(current).filter((etape) => gelees.has(etape.cle) || (surPlace(current) && etape.debut <= maintenant && etape.debut >= arrivee));
  if (!commencees.length) return null;
  const depuis = heureDe(Math.min(...commencees.map((etape) => etape.debut)));
  return { depuis, phrase: `${current.name || 'Ce groupe'} joue depuis ${depuis} : ses heures ne bougent plus.` };
}

// LES GROUPES QUI JOUENT. Une nouvelle heure qui tomberait sur la place d un groupe sur place dont
// l activite a commence : une piste ne se partage pas, le refus est immediat ; l arene et les
// autres installations se partagent, le controle du planning (`valider`) juge, et son refus dit
// alors qui tient la place. Le groupe qui joue n est jamais deplace.
function nomDeLActivite(current, activityId) {
  if (activityId === 'bowling') return 'Bowling';
  if (activityId === 'laser_game') return 'Laser Game';
  try {
    const activite = require('./activity-catalog').getCenterActivity((current && current.centerId) || 'libramont', activityId);
    if (activite && activite.name) return String(activite.name);
  } catch (error) { /* hors catalogue : son identifiant */ }
  return String(activityId || 'Activité').replace(/_/g, ' ');
}
function groupeQuiJoue(current, move, autres, maintenant) {
  if (!move || move.libre === true || !Number.isFinite(maintenant) || !Array.isArray(autres)) return null;
  const cle = move.activityId === 'laser_game' ? `laser_game:${move.unitKey}` : move.activityId;
  const etape = activitesAHeure(current).find((e) => e.cle === cle);
  const debut = minuteDe(move.startTime);
  if (!etape || !Number.isFinite(debut)) return null;
  const fin = debut + (etape.activityId === 'bowling' || etape.activityId === 'laser_game' ? etape.fin - etape.debut : dureeReelle(current, etape));
  const pistes = (Array.isArray(move.lanes) && move.lanes.length ? move.lanes : etape.lanes || []).map(Number);
  for (const autre of autres) {
    if (!autre || Number(autre.id) === Number(current.id) || !surPlace(autre)) continue;
    for (const joue of activitesAHeure(autre)) {
      if (joue.activityId !== etape.activityId || joue.debut > maintenant || joue.fin <= debut || joue.debut >= fin) continue;
      if (etape.activityId === 'bowling') {
        const piste = (joue.lanes || []).map(Number).find((l) => pistes.includes(l));
        if (piste !== undefined) return { exclusif: true, phrase: `Bowling ${move.startTime} : la piste ${piste} est prise par un groupe qui joue.` };
        continue;
      }
      return {
        exclusif: false,
        phrase: etape.activityId === 'laser_game' ? `Laser Game ${move.startTime} : les armes sont prises par un groupe qui joue.` : `${nomDeLActivite(current, etape.activityId)} ${move.startTime} : un groupe qui joue l’occupe encore.`,
      };
    }
  }
  return null;
}
// LE PLAN EN CASCADE, SON RETRAIT (lib/database.js, applyReservationScheduleUpdates : api/ops.js
// delayApply, delayRevert, et l assistant) : aucune activite commencee ne bouge, quel que soit le
// groupe. `paires` : [{ current, next }], lus sous le verrou de la journee. Un seul refus arrete tout.
function refuserSiUnGroupeQuiJoueBouge(paires, dateISO) {
  const maintenant = maintenantDuJour(dateISO);
  for (const { current, next } of paires || []) {
    if (!current || !next) continue;
    const gelees = faitesDuDossier(current);
    const apres = new Map(activitesAHeure(next).map((e) => [e.cle, e]));
    for (const etape of activitesAHeure(current)) {
      if (!gelees.has(etape.cle) && !(surPlace(current) && etape.debut <= maintenant)) continue;
      const nouvelle = apres.get(etape.cle);
      if (nouvelle && nouvelle.debut === etape.debut && nouvelle.fin === etape.fin && String(nouvelle.lanes || '') === String(etape.lanes || '')) continue;
      const pistes = etape.activityId === 'bowling' && etape.lanes && etape.lanes.length ? `, piste${etape.lanes.length > 1 ? 's' : ''} ${etape.lanes.join(', ')}` : '';
      throw refus(`${nomDeLActivite(current, etape.activityId)} ${heureDe(etape.debut)}${pistes} : ${current.name || 'ce groupe'} joue, il ne bouge pas. Rien n’est enregistré.`, 409);
    }
  }
}
function sansLesGroupesQuiJouent(current, move, autres, maintenant, valider) {
  const enJeu = groupeQuiJoue(current, move, autres, maintenant);
  if (enJeu && enJeu.exclusif) throw refus(enJeu.phrase, 409);
  try {
    return valider();
  } catch (error) {
    if (enJeu && error && error.statusCode === 409) error.message = enJeu.phrase;
    throw error;
  }
}

// La phrase du moteur, sans ce qui ne vaut que pour le glisser du planning.
function phraseDuRefus(message) {
  return String(message || '').replace(/\s*(Cet horaire reste inchangé|Les autres horaires restent inchangés)\.\s*$/, '').trim() || 'Le planning refuse cette heure.';
}

// `essayer(dossier, move)` rend le dossier deplace ou leve le refus du planning. Une panne, un
// droit refuse ou un dossier change entre-temps ne sont pas des refus du planning : ils remontent.
// Les arcades rendues libres d abord (elles ne tiennent plus d heure), puis la derniere activite.
function jugerDeplacements(current, moves, essayer) {
  const rang = (move) => (move.libre === true ? Infinity : minuteDe(move.startTime));
  const ordre = moves.map((move, i) => ({ move, i })).sort((a, b) => rang(b.move) - rang(a.move) || b.i - a.i);
  const etapes = moves.map(() => null);
  let dossier = current;
  for (const { move, i } of ordre) {
    try {
      dossier = essayer(dossier, move);
      etapes[i] = { passe: true };
    } catch (error) {
      if (!error || !error.statusCode || error.statusCode >= 500 || error.statusCode === 403 || error.code === 'reservation_modifiee') throw error;
      etapes[i] = { passe: false, raison: phraseDuRefus(error.message) };
    }
  }
  return { etapes, dossier, toutPasse: etapes.every((etape) => etape.passe) };
}

// Ce que la fenetre a montre, rejoue a l ecriture : « Tout décaler » touche toutes les activites
// a venir, « Décaler ce qui passe » une partie d entre elles. Un dossier qui a change entre-temps
// (une activite de plus ou de moins) arrete tout.
function deplacementsChoisis(etapes, { choix, cles: voulues }) {
  const parCle = new Map(etapes.map((etape) => [etape.cle, etape]));
  if (voulues.some((cle) => !parCle.has(cle)) || (choix === 'tout' && voulues.length !== etapes.length)) {
    throw refus('Le programme a changé : rien n’est enregistré, relisez la fenêtre.', 409);
  }
  return voulues.map((cle) => parCle.get(cle).move);
}

// Le seuil « En retard » du centre, en minutes : celui de la console (accueil.lateThresholdMinutes,
// l ecran Etablissement), sinon 5.
function seuilDuCentre(centerId) {
  try {
    const centre = require('./ops-knowledge').getCenter(centerId || 'libramont');
    const n = Number(centre && centre.accueil && centre.accueil.lateThresholdMinutes);
    if (Number.isFinite(n) && n >= 0) return Math.min(60, Math.trunc(n));
  } catch (error) { /* centre inconnu : le seuil par defaut */ }
  return 5;
}

// LE RETARD NOTE A L ARRIVEE (2026-11-21, le gerant : « Arrivé » et « Payé » s enregistrent tout de
// suite, en un geste ; la fenetre du retard s ouvre ensuite pour proposer le decalage ; fermee, le
// statut et le retard note restent, seules les heures ne bougent pas). Un groupe du jour, pas encore
// la, pointe arrive ou paye apres son heure prevue (sa premiere activite a heure, ou son arrivee
// quand elle vient avant), au-dela du seuil « En retard » du centre : ses minutes de retard, a noter
// dans la meme ecriture que le statut. Rien quand un retard est deja note, ni quand une activite
// cochee prouve qu il etait deja la.
function retardALArrivee(current, { status, maintenant = maintenantDuJour(current && current.date), seuil = seuilDuCentre(current && current.centerId) } = {}) {
  if (!current || !['arrived', 'paid'].includes(status) || !['pending', 'confirmed'].includes(current.status) || current.absentAt) return null;
  const flag = current.opsPlan && typeof current.opsPlan === 'object' ? current.opsPlan.delayFlag : null;
  if ((flag && !flag.cleared) || !Number.isFinite(maintenant)) return null;
  const progression = current.activityProgress && typeof current.activityProgress === 'object' ? current.activityProgress : {};
  if (Object.values(progression).some((p) => p && p.done)) return null;
  const debuts = activitesAHeure(current).filter((etape) => !arcadesEnArgent(current, etape.activityId)).map((etape) => etape.debut);
  const arrivee = minuteDe(String(current.startTime || '').slice(0, 5));
  if (Number.isFinite(arrivee)) debuts.push(arrivee);
  if (!debuts.length) return null;
  const prevu = Math.min(...debuts);
  const minutes = maintenant - prevu;
  // (le seuil de la console : « En retard » des qu il est atteint, 0 = des la minute pile ; une
  // minute au moins, comme la pastille « En retard · 1 min »)
  if (minutes < seuil) return null;
  return { minutes: Math.min(RETARD_MINUTES_MAX, Math.max(1, minutes)), de: heureDe(prevu) };
}

// L ARRIVEE ANNULEE (« Annuler » du toast, 2026-11-21) : le dossier redevient attendu, et le retard
// que CE pointage avait note (aLArrivee, setReservationStatus) s efface avec lui tant qu aucune heure
// n a ete decalee : le vrai retard se notera a la vraie arrivee. Rien sinon.
function planSansRetardDuPointage(current, { status } = {}) {
  if (!current || !['pending', 'confirmed'].includes(status) || !surPlace(current)) return null;
  const flag = retardNote(current);
  if (!flag || flag.aLArrivee !== true || flag.origin) return null;
  return { ...current.opsPlan, delayFlag: { ...flag, cleared: true, clearedAt: horloge.instant().toISOString() } };
}

// Le retard note : ses minutes, l heure prevue, l heure ou le groupe est la. Les heures deplacees
// gardent le creneau d avant (origin) : « Retirer le retard » les remet a leur place. Deja note a
// l arrivee (`dejaNote`), la fenetre ne fait que decaler : ses minutes ne s ajoutent pas une
// seconde fois.
function planAvecRetard(plan, current, { minutes, de, decale = false, dejaNote = false }) {
  const existant = current && current.opsPlan && typeof current.opsPlan === 'object' ? current.opsPlan.delayFlag : null;
  const origin = decale ? { startTime: current.startTime, opsPlan: current.opsPlan || null, lanes: Array.isArray(current.lanes) ? current.lanes : [] } : null;
  if (dejaNote && existant && !existant.cleared) {
    return { ...(plan && typeof plan === 'object' ? plan : {}), delayFlag: { ...existant, origin: existant.origin || origin } };
  }
  return stampDelayFlag(plan, {
    minutes,
    from: de,
    to: heureDe(minuteDe(de) + minutes),
    existingFlag: existant,
    origin,
  });
}

module.exports = {
  RETARD_MINUTES_MAX, lireRetard, etapesDuRetard, dureeReelle, jugerDeplacements, deplacementsChoisis, planAvecRetard, phraseDuRefus,
  maintenantDuJour, sansLesGroupesQuiJouent, refuserSiUnGroupeQuiJoueBouge, retardALArrivee, retardNote, planSansRetardDuPointage, groupeEnJeu, __horloge: horloge,
};

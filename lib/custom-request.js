// LA DEMANDE SUR MESURE (2026-09-28).
//
// Movsar : « tout groupe superieur a 30 donc a partir 31 tout groupe sera
// redirige vers une demande sur mesure ... ils auront une reponse max 24h
// ouvrable et ils peuvent pas reserver le jour meme prcq faut au moins 24h »,
// puis « il doit avoir son propre truc avec toutes formules dispo, si non
// pourquoi, choix des activites, un truc super complet ».
//
// Ce module porte les REGLES de la demande, celles que le serveur applique a
// l enregistrement et que le formulaire Fun Galaxy recopie a l ecran
// (assets/fungalaxy-booking.js, memes noms de regles) : les moments de la
// journee selon les horaires du jour, la regle des 24 heures, le verdict d une
// formule et d une activite pour la date, le moment et l age du groupe. Le
// gate sur-mesure-check compare les deux sur une grille complete.
//
// Rien n est invente : les jours, les vacances, les plages horaires et les
// ages viennent du catalogue du centre (formules, activityThemes, calendrier).
// Une demande n est pas une reservation : elle ne prend ni creneau ni
// ressource, l equipe y repond sous 24 heures ouvrables.

// Le type de groupe. `occasion` : la valeur rangee dans la colonne occasion
// (le domaine des reservations, OCCASION_VALUES de lib/database), pour que la
// console et les statistiques la comptent sans nouvelle valeur ; le type exact
// reste dans la demande.
const GROUP_TYPES = {
  ecole: { label: 'École, jeunesse', occasion: 'ecole', organisation: 'Nom de l’école ou du mouvement' },
  entreprise: { label: 'Entreprise, team building', occasion: 'entreprise', organisation: 'Nom de l’entreprise' },
  association: { label: 'Association, club', occasion: 'autre', organisation: 'Nom de l’association ou du club' },
  anniversaire: { label: 'Anniversaire', occasion: 'anniversaire', organisation: '' },
  evg: { label: 'EVG / EVJF', occasion: 'evg', organisation: '' },
  amis: { label: 'Amis, famille', occasion: 'amis', organisation: '' },
  autre: { label: 'Autre groupe', occasion: 'autre', organisation: '' },
};
const { DURATION_OPTIONS, LASER_GAME_OPTIONS, FUN_RUN_OPTIONS } = require('./booking-config');

function optionsActivite(choix, activite, participants) {
  const options = {};
  if (activite.id === 'arcade_time') {
    const quoted = require('./arcade-offers').quoteArcadeOffer(activite.arcadeOffers, choix, participants, activite.defaultMinutes);
    if (quoted) return quoted;
  }
  const choisir = (champ, valeurs) => {
    if (choix[champ] === undefined) return;
    const v = choix[champ];
    if (!['number', 'string'].includes(typeof v) || String(v).trim() === '' || !valeurs.includes(Number(v))) {
      throw new Error(`${activite.name} : option ${champ} indisponible.`);
    }
    options[champ] = Number(v);
  };
  if (activite.priceType === 'grid_bowling' || activite.resourceType === 'duckpin_lane') choisir('duration', DURATION_OPTIONS.map((x) => Number(x.value)));
  if (activite.priceType === 'grid_laser' || activite.id === 'laser_game') choisir('games', LASER_GAME_OPTIONS.map((x) => Number(x.games)));
  if (activite.priceType === 'grid_fun_run') choisir('minutes', FUN_RUN_OPTIONS.map((x) => Number(x.minutes)));
  if (activite.priceType === 'per_unit_hour') {
    const min = Number(activite.minMinutes) || 60;
    const maxMinutes = Math.min(360, Number(activite.maxMinutes) || min);
    const pas = Math.max(1, Number(activite.stepMinutes) || 60);
    const heures = [];
    for (let minutes = min; minutes <= maxMinutes; minutes += pas) heures.push(minutes / 60);
    choisir('hours', heures);
    const limites = [activite.units, activite.maxUnitsPerBooking].map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const max = limites.length ? Math.min(...limites) : 1;
    choisir('units', Array.from({ length: max }, (_, i) => i + 1));
  }
  return options;
}

function libelleActivite(a, groupe) {
  const n = Number(a.participants) || Number(groupe) || 0;
  const details = [`${n} joueur${n > 1 ? 's' : ''}`];
  if (a.arcadeOffer) return `${a.name} (${details[0]}, ${require('./arcade-offers').arcadeSummary(a)})`;
  if (a.duration) details.push(`${String(a.duration).replace('.', ',')} h`);
  if (a.games) details.push(`${a.games} partie${a.games > 1 ? 's' : ''}`);
  if (a.minutes) details.push(`${a.minutes} min par passage`);
  if (a.units) details.push(`${a.units} table${a.units > 1 ? 's' : ''}`);
  if (a.hours) details.push(`${String(a.hours).replace('.', ',')} h`);
  return `${a.name} (${details.join(', ')})`;
}
// Les types dont l organisation est demandee : c est elle qui recoit le devis.
const ORGANISATION_REQUIRED = new Set(['ecole', 'entreprise', 'association']);

// Les ages du groupe, en tranches qui tombent sur les regles du centre (laser
// des 7 ans, plaine de jeux de 4 a 12 ans, Kids Fun Day de 5 a 12 ans).
const AGES = {
  moins7: { label: 'Moins de 7 ans', min: 0, max: 6 },
  '7-12': { label: '7 à 12 ans', min: 7, max: 12 },
  '13-17': { label: '13 à 17 ans', min: 13, max: 17 },
  adultes: { label: 'Adultes', min: 18, max: 120 },
};

// Les moments de la journee. Les bornes sont celles des periodes de l ecran
// des horaires (periode() : avant 12 h, de 12 h a 18 h, apres 18 h).
// `fenetre` : la plage nominale, sans horaire du jour (verdict des formules).
const MOMENTS = {
  matin: { label: 'Matin', fenetre: [0, 12] },
  'apres-midi': { label: 'Après-midi', fenetre: [12, 18] },
  soiree: { label: 'Soirée', fenetre: [18, 24] },
  journee: { label: 'Toute la journée', fenetre: [0, 24] },
  indifferent: { label: 'Peu importe', fenetre: [0, 24] },
};
// Au moins une heure d ouverture dans la plage pour qu un moment existe.
const MOMENT_MIN_HOURS = 1;
// Le delai de preparation d une demande, en heures (« au moins 24h »).
const DELAI_MIN_HEURES = 24;

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function heureLisible(v) {
  const h = Math.floor(Number(v));
  const m = Math.round((Number(v) - h) * 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// Une date 'YYYY-MM-DD' valide, reconstruite (le 31 fevrier est refuse).
function isoValide(texte) {
  const m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(String(texte || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === texte ? texte : '';
}
function joursEntre(de, a) {
  const [y1, m1, d1] = de.split('-').map(Number);
  const [y2, m2, d2] = a.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function jourDeSemaine(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function libelleDate(iso) {
  const ok = isoValide(iso);
  if (!ok) return '';
  const [y, m, d] = ok.split('-').map(Number);
  return `${JOURS[jourDeSemaine(ok)]} ${d} ${MOIS[m - 1]} ${y}`;
}

// LES MOMENTS D UN JOUR, selon ses horaires ({ open, close } en heures
// decimales, ceux du calendrier servi). Un moment sans une heure d ouverture
// dans sa plage n existe pas ce jour-la, et le dit.
function momentsDuJour(schedule) {
  const open = Number(schedule && schedule.open);
  const close = Number(schedule && schedule.close);
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) return null;
  const plage = (s, e) => ({ start: s, end: e, ok: e - s >= MOMENT_MIN_HOURS });
  const matin = plage(open, Math.min(close, 12));
  const apresMidi = plage(Math.max(open, 12), Math.min(close, 18));
  const soiree = plage(Math.max(open, 18), close);
  if (!matin.ok) matin.raison = `Le centre ouvre à ${heureLisible(open)} ce jour-là.`;
  if (!apresMidi.ok) apresMidi.raison = close <= 13 ? `Le centre ferme à ${heureLisible(close)} ce jour-là.` : `Le centre ouvre à ${heureLisible(open)} ce jour-là.`;
  if (!soiree.ok) soiree.raison = `Le centre ferme à ${heureLisible(close)} ce jour-là.`;
  const journee = { start: open, end: close, ok: matin.ok && apresMidi.ok };
  if (!journee.ok) journee.raison = `Le centre n’est ouvert que de ${heureLisible(open)} à ${heureLisible(close)} ce jour-là.`;
  return { matin, 'apres-midi': apresMidi, soiree, journee, indifferent: { start: open, end: close, ok: true } };
}

// LE VERDICT D UN MOMENT, date comprise : le moment existe ce jour-la, et il
// commence au moins 24 heures apres maintenant (heure de Bruxelles).
// `today` 'YYYY-MM-DD' et `nowHour` (heures decimales) : l horloge du centre.
function verdictMoment({ date, moment, today, nowHour, schedule }) {
  const jour = momentsDuJour(schedule);
  if (!jour) return { ok: false, raison: 'Le centre est fermé ce jour-là.' };
  const m = jour[moment];
  if (!m) return { ok: false, raison: 'Moment inconnu.' };
  if (!m.ok) return { ok: false, raison: m.raison };
  const ecart = joursEntre(today, date) * 24 - Number(nowHour || 0);
  const avance = (debut) => ecart + debut >= DELAI_MIN_HEURES;
  if (moment === 'indifferent') {
    const possibles = ['matin', 'apres-midi', 'soiree'].filter((k) => jour[k].ok && avance(jour[k].start));
    return possibles.length ? { ok: true, raison: '' } : { ok: false, raison: 'Moins de 24 h d’ici là.' };
  }
  return avance(m.start) ? { ok: true, raison: '' } : { ok: false, raison: 'Moins de 24 h d’ici là.' };
}

// Les tranches d age choisies se croisent-elles avec [min, max] ?
function agesCroisent(ages, min, max) {
  return ages.some((cle) => AGES[cle] && AGES[cle].min <= max && AGES[cle].max >= min);
}
function agesSousLeMinimum(ages, minAge) {
  return ages.filter((cle) => AGES[cle] && AGES[cle].max < minAge);
}
// « 4 à 12 ans » -> [4, 12]
function plageAges(texte) {
  const m = /(\d{1,2})\s*(?:à|a|-)\s*(\d{1,2})\s*ans/i.exec(String(texte || ''));
  return m && Number(m[1]) < Number(m[2]) ? [Number(m[1]), Number(m[2])] : null;
}

function joursLisibles(liste) {
  const noms = (liste || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => JOURS[d]).filter(Boolean);
  if (!noms.length) return '';
  if (noms.length === 1) return `le ${noms[0]}`;
  return `les ${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
}
function plageLisible(limite) {
  if (!limite) return '';
  if (limite.min && limite.max) return `de ${heureLisible(limite.min)} à ${heureLisible(limite.max)}`;
  if (limite.max) return `avant ${heureLisible(limite.max)}`;
  if (limite.min) return `à partir de ${heureLisible(limite.min)}`;
  return '';
}

// LE VERDICT D UNE FORMULE POUR UNE DEMANDE. `jour` : l entree du calendrier
// servi pour la date (weekday, formulaHolidayOff, unavailableFormulaIds), ou
// null quand la date n est pas encore fixee. Refus (ok false) : la formule ne
// peut pas etre retenue a cette date ou a ce moment, et la raison le dit.
// Note (ok true) : elle reste possible, avec une precaution (l age).
function verdictFormuleSurMesure(f, { jour = null, moment = '', participants = 0, ages = [] } = {}) {
  if (!f) return { ok: false, raison: 'Formule inconnue.' };
  if (f.offerOff) return { ok: false, raison: 'Cette offre est momentanément suspendue.' };
  if (Array.isArray(f.missingActivityIds) && f.missingActivityIds.length) return { ok: false, raison: 'Cette formule n’est pas proposée dans ce centre.' };
  if (f.minPax && participants > 0 && participants < f.minPax) {
    return { ok: false, raison: `Cette formule demande au moins ${f.minPax} personnes.` };
  }
  if (jour) {
    if ((jour.unavailableFormulaIds || []).indexOf(f.id) >= 0) return { ok: false, raison: 'Une de ses activités n’est pas disponible ce jour-là.' };
    if (f.noHolidays && jour.formulaHolidayOff) return { ok: false, raison: 'Pas pendant les vacances scolaires ni les jours fériés.' };
    if (Array.isArray(f.validDays) && f.validDays.length && f.validDays.indexOf(jour.weekday) < 0) {
      return { ok: false, raison: `Seulement ${joursLisibles(f.validDays)}.` };
    }
  }
  const m = MOMENTS[moment];
  if (m && moment !== 'indifferent' && moment !== 'journee' && f.timeLimit) {
    const debut = Math.max(m.fenetre[0], Number(f.timeLimit.min) || 0);
    const fin = Math.min(m.fenetre[1], Number(f.timeLimit.max) || 24);
    if (fin <= debut) return { ok: false, raison: `Seulement ${plageLisible(f.timeLimit)}.` };
  }
  if (f.kidsOnly && ages.length && !agesCroisent(ages, f.kidsOnly.ageMin, f.kidsOnly.ageMax)) {
    return { ok: true, raison: '', note: `Réservée aux enfants de ${f.kidsOnly.ageMin} à ${f.kidsOnly.ageMax} ans.` };
  }
  return { ok: true, raison: '', note: '' };
}

// LE VERDICT D UNE ACTIVITE POUR UNE DEMANDE : indisponible ce jour-la (un
// blocage du centre), pas assez de joueurs, et les precautions d age tirees
// des faits du centre (minAge, minHeightCm, ageRange).
function verdictActiviteSurMesure(a, { jour = null, participants = 0, ages = [] } = {}) {
  if (!a) return { ok: false, raison: 'Activité inconnue.' };
  if (jour && (jour.unavailableActivityIds || []).indexOf(a.id) >= 0) return { ok: false, raison: 'Indisponible ce jour-là.' };
  if (a.minPax && participants > 0 && participants < a.minPax) return { ok: false, raison: `Il faut être au moins ${a.minPax} joueurs.` };
  if (ages.length && a.minAge) {
    const tropJeunes = agesSousLeMinimum(ages, a.minAge);
    if (tropJeunes.length) {
      const taille = a.minHeightCm ? ` et ${(a.minHeightCm / 100).toFixed(2).replace('.', ',')} m` : '';
      return { ok: true, raison: '', note: tropJeunes.length === ages.length ? `Dès ${a.minAge} ans${taille} : pas adapté à l’âge de votre groupe.` : `Dès ${a.minAge} ans${taille} : les plus jeunes ne pourront pas jouer.` };
    }
  }
  const plage = plageAges(a.ageRange);
  if (ages.length && plage && !agesCroisent(ages, plage[0], plage[1])) {
    return { ok: true, raison: '', note: `Prévu pour les ${plage[0]} à ${plage[1]} ans.` };
  }
  return { ok: true, raison: '', note: '' };
}

function texte(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
function entier(value, min, max) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}
function refus(message, champ = '') {
  return { ok: false, status: 422, message, champ };
}

// LA DEMANDE STRUCTUREE, VALIDEE. `input` : l objet `details` envoye par le
// formulaire. `ctx` : ce que le serveur sait du centre et de l heure :
//   today, nowHour, horizonDays, formules (catalogue effectif du centre, avec
//   offerOff et missingActivityIds), activites (vendables), jourDe(date) ->
//   l entree du calendrier (open, schedule, weekday, formulaHolidayOff,
//   unavailableFormulaIds, unavailableActivityIds).
// Rend { ok: true, demande } ou un refus lisible (le formulaire empeche deja
// chacun de ces cas : un refus ici vient d une page perimee ou forgee).
function normaliserDemande(input, ctx) {
  const src = input && typeof input === 'object' ? input : {};
  const type = texte(src.groupType, 20);
  if (!GROUP_TYPES[type]) return refus('Précisez le type de groupe.', 'groupType');
  const organisation = texte(src.organisation, 160);
  if (ORGANISATION_REQUIRED.has(type) && !organisation) {
    const champ = GROUP_TYPES[type].organisation;
    return refus(`Indiquez le ${champ.charAt(0).toLowerCase()}${champ.slice(1)}.`, 'organisation');
  }
  const participants = entier(src.participants, 0, 1000);
  if (!participants || participants < 1) return refus('Indiquez le nombre de participants.', 'participants');
  const accompagnants = entier(src.companions, 0, 1000) || 0;
  const ages = [...new Set((Array.isArray(src.ages) ? src.ages : []).map((x) => String(x)))].filter((cle) => AGES[cle]);

  const flexible = src.flexible === true;
  let date = '';
  let dateAlt = '';
  let periode = '';
  let jour = null;
  const moment = texte(src.moment, 20);
  if (!MOMENTS[moment]) return refus('Choisissez un moment de la journée.', 'moment');
  if (flexible) {
    periode = texte(src.period, 160);
    if (!periode) return refus('Dites-nous la période envisagée.', 'period');
  } else {
    date = isoValide(texte(src.date, 10));
    if (!date) return refus('Choisissez la date souhaitée.', 'date');
    if (date <= ctx.today) return refus('Pas le jour même : une demande sur mesure se prépare au moins 24 heures à l’avance.', 'date');
    if (joursEntre(ctx.today, date) > ctx.horizonDays) return refus(`Les demandes sont ouvertes jusqu’à ${ctx.horizonDays} jours à l’avance.`, 'date');
    jour = ctx.jourDe(date);
    if (!jour || !jour.open) return refus('Le centre est fermé à cette date.', 'date');
    const v = verdictMoment({ date, moment, today: ctx.today, nowHour: ctx.nowHour, schedule: jour.schedule });
    if (!v.ok) return refus(`${MOMENTS[moment].label} : ${v.raison}`, 'moment');
    const alt = texte(src.alternativeDate, 10);
    if (alt) {
      dateAlt = isoValide(alt);
      if (!dateAlt || dateAlt <= ctx.today || dateAlt === date) return refus('L’autre date possible n’est pas valable.', 'alternativeDate');
      if (joursEntre(ctx.today, dateAlt) > ctx.horizonDays) return refus(`Les demandes sont ouvertes jusqu’à ${ctx.horizonDays} jours à l’avance.`, 'alternativeDate');
      const jourAlt = ctx.jourDe(dateAlt);
      if (!jourAlt || !jourAlt.open) return refus('Le centre est fermé à l’autre date proposée.', 'alternativeDate');
      // L autre date suit la regle de la premiere, au meme moment : ce moment
      // existe ce jour-la et commence au moins 24 heures apres maintenant.
      const vAlt = verdictMoment({ date: dateAlt, moment, today: ctx.today, nowHour: ctx.nowHour, schedule: jourAlt.schedule });
      if (!vAlt.ok) return refus(`Autre date (${MOMENTS[moment].label.toLowerCase()}) : ${vAlt.raison}`, 'alternativeDate');
    }
  }

  const parIdF = new Map((ctx.formules || []).map((f) => [f.id, f]));
  const parIdA = new Map((ctx.activites || []).map((a) => [a.id, a]));
  const formules = [];
  for (const id of [...new Set((Array.isArray(src.formulas) ? src.formulas : []).map(String))].slice(0, 30)) {
    const f = parIdF.get(id);
    if (!f) return refus('Une formule choisie n’est plus proposée. Rechargez la page.', 'formulas');
    const v = verdictFormuleSurMesure(f, { jour, moment, participants, ages });
    if (!v.ok) return refus(`${f.name} : ${v.raison}`, 'formulas');
    formules.push({ id: f.id, name: f.name });
  }
  const activites = [];
  const activitesVues = new Set();
  for (const choix of (Array.isArray(src.activities) ? src.activities : []).slice(0, 30)) {
    const objet = choix && typeof choix === 'object' && !Array.isArray(choix);
    const id = String(objet ? choix.id : choix);
    if (activitesVues.has(id)) continue;
    activitesVues.add(id);
    const a = parIdA.get(id);
    if (!a) return refus('Une activité choisie n’est plus proposée. Rechargez la page.', 'activities');
    const valeur = objet ? choix.participants : undefined;
    const effectif = valeur === undefined ? participants : Number(valeur);
    if ((valeur !== undefined && !['number', 'string'].includes(typeof valeur)) || valeur === '' || !Number.isInteger(effectif) || effectif < 1 || effectif > participants) {
      return refus(`${a.name} : indiquez un nombre entier de joueurs entre 1 et ${participants}.`, 'activities');
    }
    if (Number(a.maxPax) > 0 && !(Number(a.capacityPerUnit) > 0) && effectif > Number(a.maxPax)) {
      return refus(`${a.name} : au plus ${a.maxPax} joueurs.`, 'activities');
    }
    const v = verdictActiviteSurMesure(a, { jour, participants: effectif, ages });
    if (!v.ok) return refus(`${a.name} : ${v.raison}`, 'activities');
    let options;
    try { options = optionsActivite(objet ? choix : {}, a, effectif); }
    catch (error) { return refus(error.message, 'activities'); }
    activites.push({ id: a.id, name: a.name, participants: effectif, ...options });
  }
  const conseil = src.advice === true;
  if (!formules.length && !activites.length && !conseil) return refus('Choisissez au moins une activité ou une formule, ou demandez conseil à l’équipe.', 'activities');
  const budget = entier(src.budgetPerPerson, 0, 1000) || 0;
  const facture = src.invoice === true;
  const tva = facture ? texte(src.vatNumber, 40).toUpperCase().replace(/[^A-Z0-9 .-]/g, '') : '';

  return {
    ok: true,
    demande: {
      version: 1,
      groupType: type,
      groupTypeLabel: GROUP_TYPES[type].label,
      organisation,
      participants,
      companions: accompagnants,
      ages,
      flexible,
      date,
      alternativeDate: dateAlt,
      period: periode,
      moment,
      momentLabel: MOMENTS[moment].label,
      formulas: formules,
      activities: activites,
      advice: conseil,
      budgetPerPerson: budget,
      contactRole: texte(src.contactRole, 80),
      invoice: facture,
      vatNumber: tva,
    },
  };
}

// La date telle que la colonne requested_date et l accuse la disent.
function libelleQuand(demande) {
  if (!demande) return '';
  if (demande.flexible) return `À fixer : ${demande.period}${demande.moment !== 'indifferent' ? `, ${MOMENTS[demande.moment].label.toLowerCase()}` : ''}`;
  const base = libelleDate(demande.date);
  const moment = demande.moment !== 'indifferent' ? `, ${MOMENTS[demande.moment].label.toLowerCase()}` : '';
  return `${base}${moment}${demande.alternativeDate ? ` (ou ${libelleDate(demande.alternativeDate)})` : ''}`;
}

module.exports = {
  libelleActivite,
  GROUP_TYPES,
  ORGANISATION_REQUIRED,
  AGES,
  MOMENTS,
  DELAI_MIN_HEURES,
  momentsDuJour,
  verdictMoment,
  verdictFormuleSurMesure,
  verdictActiviteSurMesure,
  normaliserDemande,
  libelleDate,
  libelleQuand,
  isoValide,
};

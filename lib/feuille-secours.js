'use strict';
// LA FEUILLE DE SECOURS (2026-10-05).
//
// L'accueil des centres écrit ses réservations à la main sur une grille
// imprimée (photos du classeur de Fun Galaxy : 3 pages A4 paysage, 10H-14H,
// 14H30-18H30, 19H-23H, cinq lignes par demi-heure, treize colonnes). Si
// Pinlane tombe, l'équipe doit retrouver LA MÊME feuille, déjà remplie avec
// les réservations du jour, et des lignes vides pour continuer au stylo.
//
// Ce module construit ce PDF, et rien d'autre : il ne lit pas la base, il
// reçoit les réservations (le format servi par l'API, mapReservation) et
// rend un Buffer. Les règles des cases sont celles confirmées par le patron
// et vivent dans des fonctions pures, testées une à une par le gate
// scripts/documents-secours-check.js :
//
//   Bowling (pistes) : une croix par piste réservée (« XX » = 2 pistes), et la
//     durée entre parenthèses SEULEMENT si elle n'est pas d'une heure :
//     « XX (1h30) », « X (30 min) ». Ni numéro de piste, ni heure.
//   Duckpin : même règle que le bowling (REGLES.duckpin = 'pistes') ; un seul
//     réglage pour passer à une croix unique (REGLES.duckpin = 'simple').
//   LG (laser game) : une croix par partie (« XX » = 2 parties). Pas d'heure.
//   Toutes les autres colonnes : une croix si l'activité est dans le dossier.
//   NOM : le nom du client, et l'étiquette « à confirmer » quand le dossier
//     attend encore la validation de l'équipe (validationStatus staff_review).
//   Une réservation va dans la demi-heure de son heure d'arrivée. Plus de
//     cinq dans la même demi-heure : le bloc grandit, jamais une réservation
//     n'est perdue ; les lignes se serrent un peu (3,1 mm au minimum) pour
//     tenir en trois pages, sinon la page continue sur une page « suite ».
//   Les activités sans colonne (lancer de hache, VR, table d'anniversaire,
//     boissons) ne sont que dans l'annexe « Détails de chaque réservation ».
//   Une ligne de note qui commence par « [equipe] » est une note interne de
//     l'équipe (lib/database.js, noterReservationEquipe) : elle ne s'imprime
//     JAMAIS, ni sur la feuille, ni dans l'annexe, ni dans l'export Excel.

const { PdfDocument, largeurTexte, couperTexte, POLICES } = require('./pdf-writer');
const surMesure = require('./custom-request');

// La grille, dans l'ordre du papier. `mm` : la largeur de la colonne.
// `activites` : les identifiants d'activité qui cochent la colonne.
// `regle` : 'pistes' (croix par piste + durée), 'parties' (croix par partie),
// sinon une croix simple.
const COL_HEURE_MM = 11;
const COLONNES = Object.freeze([
  { cle: 'nom', titre: 'NOM', mm: 54 },
  { cle: 'tel', titre: 'TEL', mm: 34 },
  { cle: 'formule', titre: 'Formule', mm: 22 },
  { cle: 'pers', titre: 'pers', mm: 10 },
  { cle: 'bowling', titre: 'Bowling (pistes)', mm: 24, activites: ['bowling'], regle: 'pistes' },
  { cle: 'duckpin', titre: 'Duckpin', mm: 15, activites: ['duckpin_bowling'], regle: 'pistes' },
  { cle: 'lg', titre: 'LG', mm: 19, activites: ['laser_game'], regle: 'parties' },
  { cle: 'pixel', titre: 'Pixel', mm: 15, activites: ['fun_run'] },
  { cle: 'arcades', titre: 'Arcades', mm: 16, activites: ['arcade_time', 'arcade_credit'] },
  { cle: 'golf', titre: 'Golf', mm: 15, activites: ['minigolf_blacklight'] },
  { cle: 'oclock', titre: 'O’Clock', mm: 16, activites: ['golf_oclock'] },
  { cle: 'playgr', titre: 'Playgr', mm: 15, activites: ['playground'] },
  { cle: 'billard', titre: 'Billard', mm: 15, activites: ['billards'] },
]);
const COLONNES_ACTIVITES = COLONNES.filter((c) => c.activites);
// Le réglage du Duckpin : 'pistes' = comme le bowling ; 'simple' = une croix.
const REGLES = Object.freeze({ duckpin: 'pistes' });
// Les trois pages du classeur, en minutes depuis minuit (bornes incluses).
const PLAGES = Object.freeze([
  { de: 10 * 60, a: 14 * 60 },
  { de: 14 * 60 + 30, a: 18 * 60 + 30 },
  { de: 19 * 60, a: 23 * 60 },
]);
const LIGNES_PAR_BLOC = 5;
const PAGE = Object.freeze({ largeur: 297, hauteur: 210, margeX: 8, margeY: 7 });
const HAUTEUR_LIGNE = Object.freeze({ min: 3.1, max: 4.6 });
const ENTETE = Object.freeze({ boite: 5, titres: 5.5 });
const PIED = 4;
const HAUTEUR_UTILE = PAGE.hauteur - 2 * PAGE.margeY - 2 * ENTETE.boite - ENTETE.titres - PIED;
const TRAIT = Object.freeze({ fin: 0.18, epais: 0.5 });
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MARQUE_EQUIPE = /^\s*\[[eé]quipe\]/i;

// ---------------------------------------------------------------------------
// Heures et dates
// ---------------------------------------------------------------------------
function minutesDe(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function hhmmDe(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
// « 10H », « 10H30 » : l'étiquette du papier.
function etiquetteHeure(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(m / 60)}H${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
}
// La demi-heure d'une heure d'arrivée (14:10 -> 14:00, 14:40 -> 14:30).
function blocDe(startTime) {
  const m = minutesDe(startTime);
  return m == null ? null : Math.floor(m / 30) * 30;
}
function partiesDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? { annee: Number(m[1]), mois: Number(m[2]), jour: Number(m[3]) } : null;
}
function jourDeLaSemaine(iso) {
  const p = partiesDate(iso);
  return p ? JOURS[new Date(Date.UTC(p.annee, p.mois - 1, p.jour)).getUTCDay()] : '';
}
function dateCourte(iso) {
  const p = partiesDate(iso);
  return p ? `${String(p.jour).padStart(2, '0')}/${String(p.mois).padStart(2, '0')}/${p.annee}` : '';
}
function dateLongue(iso) {
  const p = partiesDate(iso);
  return p ? `${jourDeLaSemaine(iso)} ${p.jour} ${MOIS[p.mois - 1]} ${p.annee}` : '';
}
function capitaliser(texte) {
  const t = String(texte || '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
// « 05/10/2026 à 09:00 », heure de Bruxelles. Une chaîne est gardée telle quelle.
function formaterInstant(valeur) {
  if (typeof valeur === 'string' && valeur.trim() && !/^\d{4}-\d{2}-\d{2}T/.test(valeur)) return valeur.trim();
  const d = valeur instanceof Date ? valeur : new Date(valeur || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const v = (type) => (parts.find((x) => x.type === type) || {}).value || '';
  return `${v('day')}/${v('month')}/${v('year')} à ${v('hour')}:${v('minute')}`;
}

// ---------------------------------------------------------------------------
// Ce qu'un dossier contient : les activités, lues dans le programme vendu
// (program.items) ET dans la timeline planifiée (opsPlan.timeline). Une
// formule n'a pas d'items : sa timeline fait foi ; une activité libre non
// planifiée n'a pas de timeline datée : ses items font foi.
// ---------------------------------------------------------------------------
function activitesDe(resa) {
  const r = resa && typeof resa === 'object' ? resa : {};
  const items = r.program && Array.isArray(r.program.items) ? r.program.items : [];
  const blocs = (r.opsPlan && Array.isArray(r.opsPlan.timeline) ? r.opsPlan.timeline : []).filter((t) => t && t.type === 'activity' && t.activityId);
  const map = new Map();
  const obtenir = (id) => { if (!map.has(id)) map.set(id, { id, items: [], blocs: [] }); return map.get(id); };
  for (const it of items) if (it && it.activityId) obtenir(it.activityId).items.push(it);
  for (const b of blocs) obtenir(b.activityId).blocs.push(b);
  if (!map.size) {
    // Dossier ancien, sans programme ni plan : le type dit l'essentiel.
    if (r.type === 'laser') obtenir('laser_game');
    else if (r.type === 'bowling' || (Array.isArray(r.lanes) && r.lanes.length)) obtenir('bowling');
  }
  return map;
}
function pistesDe(activite, resa) {
  const item = activite.items.find((i) => Number(i.laneCount) > 0);
  if (item) return Number(item.laneCount);
  const bloc = activite.blocs.find((b) => Number(b.requiredLanes) > 0);
  if (bloc) return Number(bloc.requiredLanes);
  if (activite.id === 'bowling') {
    const assignees = resa && resa.opsPlan && Array.isArray(resa.opsPlan.assignedLanes) ? resa.opsPlan.assignedLanes : [];
    if (assignees.length) return assignees.length;
    if (Array.isArray(resa && resa.lanes) && resa.lanes.length) return resa.lanes.length;
  }
  return 1;
}
function dureeMinutesDe(activite, resa) {
  const item = activite.items.find((i) => Number(i.minutes) > 0 || Number(i.duration) > 0);
  if (item) return Number(item.minutes) > 0 ? Number(item.minutes) : Math.round(Number(item.duration) * 60);
  const bloc = activite.blocs.find((b) => Number(b.durationMinutes) > 0);
  if (bloc) return Number(bloc.durationMinutes);
  const ecrit = activite.blocs.find((b) => minutesDe(b.startTime) != null && minutesDe(b.endTime) != null);
  if (ecrit) return minutesDe(ecrit.endTime) - minutesDe(ecrit.startTime);
  if (activite.id === 'bowling' && Number(resa && resa.duration) > 0) return Math.round(Number(resa.duration) * 60);
  return 60;
}
// Le nombre de parties de laser : ce qui a été vendu (items.games), sinon le
// plus grand numéro de partie planifié (countIndex : deux vagues du même
// groupe portent le même numéro), sinon le nombre de passages.
function partiesDe(activite) {
  const item = activite.items.find((i) => Number(i.games) > 0);
  if (item) return Number(item.games);
  const numeros = activite.blocs.map((b) => Number(b.countIndex) || 0);
  if (numeros.some((n) => n > 0)) return Math.max(...numeros);
  return Math.max(1, activite.blocs.length);
}
function joueursDe(activite, resa) {
  const bloc = activite.blocs.find((b) => Number(b.players) > 0);
  if (bloc) return Number(bloc.players);
  const item = activite.items.find((i) => Number(i.participants) > 0);
  if (item) return Number(item.participants);
  return Number(resa && resa.pax) || 0;
}

// ---------------------------------------------------------------------------
// Les règles des cases (pures, testées par le gate)
// ---------------------------------------------------------------------------
// « 30 min », « 1h », « 1h30 », « 2h ».
function libelleDuree(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m <= 0) return '';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  return reste ? `${h}h${String(reste).padStart(2, '0')}` : `${h}h`;
}
// Bowling et duckpin : une croix par piste, la durée si elle n'est pas 1 h.
function texteCasePistes(pistes, minutes) {
  const croix = 'X'.repeat(Math.max(1, Math.round(Number(pistes) || 1)));
  const m = Math.round(Number(minutes) || 60);
  return m === 60 ? croix : `${croix} (${libelleDuree(m)})`;
}
// Laser game : une croix par partie.
function texteCaseParties(parties) {
  return 'X'.repeat(Math.max(1, Math.round(Number(parties) || 1)));
}
// Le texte d'une colonne d'activité pour un dossier ('' si l'activité n'y est pas).
function texteCase(resa, colonne, regles = REGLES) {
  const col = typeof colonne === 'string' ? COLONNES.find((c) => c.cle === colonne) : colonne;
  if (!col || !col.activites) return '';
  const activites = activitesDe(resa);
  const presentes = col.activites.map((id) => activites.get(id)).filter(Boolean);
  if (!presentes.length) return '';
  const regle = col.cle === 'duckpin' ? (regles && regles.duckpin) || 'pistes' : col.regle;
  if (regle === 'pistes') return texteCasePistes(pistesDe(presentes[0], resa), dureeMinutesDe(presentes[0], resa));
  if (regle === 'parties') return texteCaseParties(partiesDe(presentes[0]));
  return 'X';
}
// Les neuf cases d'activité d'un dossier, par clé de colonne.
function casesActivites(resa, regles = REGLES) {
  const cases = {};
  for (const col of COLONNES_ACTIVITES) cases[col.cle] = texteCase(resa, col, regles);
  return cases;
}
// Les activités du dossier qui n'ont PAS de colonne (annexe seulement).
function activitesSansColonne(resa) {
  const avec = new Set(COLONNES_ACTIVITES.flatMap((c) => c.activites));
  return [...activitesDe(resa).keys()].filter((id) => !avec.has(id));
}
function estSurMesure(resa) {
  return Boolean(resa && (resa.type === 'custom' || resa.surMesure === true || (resa.customRequest && typeof resa.customRequest === 'object')));
}
function estAnnulee(resa) {
  return Boolean(resa && (resa.status === 'cancelled' || resa.validationStatus === 'rejected'));
}
function estPayee(resa) {
  return Boolean(resa && resa.status === 'paid');
}
function aConfirmer(resa) {
  return Boolean(resa && resa.validationStatus === 'staff_review');
}
// « MATIN MALIN » -> « Matin Malin » (un nom déjà mixte reste tel quel).
function capitaliserMots(texte) {
  const t = String(texte || '').trim();
  if (t && t === t.toUpperCase() && /[A-Z]/.test(t)) {
    return t.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (tout, sep, lettre) => `${sep}${lettre.toUpperCase()}`);
  }
  return t;
}
// « FORMULE 4 » -> « F4 », « MATIN MALIN » -> « Matin Malin » : la case de la grille.
function formuleCourte(nom) {
  const t = String(nom || '').trim();
  const m = /^FORMULE\s+(\d+)$/i.exec(t);
  if (m) return `F${m[1]}`;
  return capitaliserMots(t);
}
// « FORMULE 4 » -> « Formule 4 » : l'annexe et l'export.
function formuleLongue(nom) {
  return capitaliserMots(nom);
}
const OCCASIONS = { anniversaire: 'Anniversaire', amis: 'Amis', famille: 'Famille', entreprise: 'Entreprise', ecole: 'École', evg: 'EVG / EVJF', autre: 'Autre' };
function occasionFr(code) {
  const c = String(code || '').trim();
  return c ? OCCASIONS[c.toLowerCase()] || capitaliser(c) : '';
}
function nomFormule(id, formules) {
  if (!id || !formules) return '';
  if (Array.isArray(formules)) { const f = formules.find((x) => x && x.id === id); return f ? f.name || f.label || '' : ''; }
  if (formules instanceof Map) return formules.get(id) || '';
  const v = formules[id];
  return typeof v === 'string' ? v : (v && (v.name || v.label)) || '';
}
// La colonne Formule : le nom court, « Sur mesure », ou rien (à la carte).
function libelleFormule(resa, formules) {
  if (estSurMesure(resa)) return 'Sur mesure';
  const id = (resa && (resa.formuleId || resa.formulaId)) || '';
  if (!id) return '';
  return formuleCourte(nomFormule(id, formules) || id);
}
// Les notes sans les lignes internes de l'équipe.
function notesImprimables(notes) {
  return String(notes == null ? '' : notes).replace(/\r\n?/g, '\n').split('\n').filter((l) => !MARQUE_EQUIPE.test(l)).join('\n').trim();
}
function statutFr(resa) {
  const r = resa || {};
  if (r.status === 'cancelled') return 'Annulée';
  if (r.validationStatus === 'rejected') return 'Refusée';
  if (r.validationStatus === 'staff_review') return 'À confirmer';
  if (r.validationStatus === 'requested') return 'Demande reçue';
  if (r.validationStatus === 'draft') return 'Brouillon';
  if (r.status === 'paid') return 'Payée';
  if (r.status === 'arrived') return 'Arrivée';
  return 'Confirmée';
}
function canalFr(channel) {
  const c = String(channel || '').toLowerCase();
  if (c === 'public') return 'En ligne';
  if (c === 'sim-client') return 'En ligne (simulation)';
  if (c === 'sim-staff') return 'Comptoir (simulation)';
  return 'Comptoir';
}
function euros(n) {
  const v = Math.round(Number(n) * 100) / 100;
  if (!Number.isFinite(v)) return '';
  return Number.isInteger(v) ? `${v} €` : `${v.toFixed(2).replace('.', ',')} €`;
}
// Le prix, et le prix de référence quand il a été adapté.
function prixTexte(resa) {
  const r = resa || {};
  const prix = Number(r.price);
  const base = Number(r.basePrice);
  const inconnu = r.program && r.program.priceComplete === false && !(prix > 0);
  if (inconnu || !Number.isFinite(prix)) return 'Tarif à l’accueil';
  if (Number.isFinite(base) && base > 0 && Math.abs(base - prix) >= 0.005) return `${euros(prix)} (au lieu de ${euros(base)})`;
  return euros(prix);
}
function nomClient(resa) {
  return String((resa && (resa.name || resa.clientName)) || '').replace(/\s+/g, ' ').trim();
}
function pluriel(n, un, plusieurs) {
  return `${n} ${n > 1 ? plusieurs : un}`;
}

// Le programme détaillé : une ligne par bloc d'activité planifié (heure de
// début et de fin, pistes, parties, joueurs), puis les activités vendues sans
// heure. C'est ce que l'annexe et l'onglet « Programme détaillé » impriment.
function programmeDetaille(resa) {
  const r = resa && typeof resa === 'object' ? resa : {};
  const activites = activitesDe(r);
  const lignes = [];
  const blocs = [...activites.values()].flatMap((a) => a.blocs.map((b) => ({ a, b })));
  blocs.sort((x, y) => ((minutesDe(x.b.startTime) ?? 9999) - (minutesDe(y.b.startTime) ?? 9999)));
  const vues = new Set();
  for (const { a, b } of blocs) {
    const parties = a.id === 'laser_game' ? partiesDe(a) : 0;
    const numero = Number(b.countIndex) || 0;
    const item = a.items[0] || {};
    const date = minutesDe(b.startTime) != null;
    lignes.push({
      activiteId: a.id,
      activite: String(b.label || item.name || a.id),
      heureDebut: date ? b.startTime : '',
      heureFin: date && minutesDe(b.endTime) != null ? b.endTime : '',
      pistes: Number(b.requiredLanes) > 0 ? Number(b.requiredLanes) : (a.id === 'bowling' || a.id === 'duckpin_bowling' ? pistesDe(a, r) : 0),
      parties,
      numeroPartie: parties > 1 && numero ? numero : 0,
      // Un bloc sans heure (activité libre, non planifiée) prend les détails
      // de ce qui a été vendu.
      joueurs: Number(b.players) > 0 ? Number(b.players) : (date ? 0 : joueursDe(a, r)),
      minutes: Number(b.durationMinutes) > 0 ? Number(b.durationMinutes) : (date ? 0 : (Number(item.minutes) > 0 ? Number(item.minutes) : 0)),
      credit: a.id === 'arcade_credit' && item.arcadeOffer ? item.arcadeOffer : null,
    });
    vues.add(a.id);
  }
  for (const a of activites.values()) {
    if (vues.has(a.id)) continue;
    const item = a.items[0] || {};
    lignes.push({
      activiteId: a.id,
      activite: String(item.name || a.id),
      heureDebut: '',
      heureFin: '',
      pistes: a.id === 'bowling' || a.id === 'duckpin_bowling' ? pistesDe(a, r) : 0,
      parties: a.id === 'laser_game' ? partiesDe(a) : 0,
      numeroPartie: 0,
      joueurs: joueursDe(a, r),
      minutes: Number(item.minutes) > 0 ? Number(item.minutes) : (Number(item.duration) > 0 ? Math.round(Number(item.duration) * 60) : 0),
      credit: a.id === 'arcade_credit' && item.arcadeOffer ? item.arcadeOffer : null,
    });
  }
  return lignes;
}
// « 14:00-15:00 Bowling · 2 pistes · 10 joueurs »
function ligneProgramme(p) {
  const heure = p.heureDebut ? `${p.heureDebut}${p.heureFin ? `-${p.heureFin}` : ''} ` : '';
  const details = [];
  if (p.pistes > 0) details.push(pluriel(p.pistes, 'piste', 'pistes'));
  if (p.numeroPartie > 0) details.push(`partie ${p.numeroPartie}/${p.parties}`);
  else if (p.parties > 0 && !p.heureDebut) details.push(pluriel(p.parties, 'partie', 'parties'));
  // Sans heure, la durée dit ce qui a été vendu (avec l'heure, elle se lit).
  if (!p.heureDebut && p.minutes > 0) details.push(libelleDuree(p.minutes));
  if (p.joueurs > 0) details.push(pluriel(p.joueurs, 'joueur', 'joueurs'));
  return `${heure}${p.activite}${details.length ? ` · ${details.join(' · ')}` : ''}`;
}
function texteProgramme(resa) {
  const lignes = programmeDetaille(resa).map(ligneProgramme);
  return lignes.length ? lignes : [String((resa && resa.label) || '')].filter(Boolean);
}

// Ce que le client a demandé, pour un dossier sur mesure : la demande
// structurée du formulaire (payload.demande, lib/custom-request) ou la fiche
// libre (custom_requests : contact, pax, date, message).
function expliquerDemande(source) {
  if (!source || typeof source !== 'object') return '';
  const d = source.payload && source.payload.demande && typeof source.payload.demande === 'object'
    ? source.payload.demande
    : (source.demande && typeof source.demande === 'object' ? source.demande : (source.groupType ? source : null));
  const lignes = [];
  const contact = source.contactName || source.contact || '';
  if (contact) lignes.push(`Contact : ${contact}${d && d.contactRole ? ` (${d.contactRole})` : ''}.`);
  if (d) {
    const groupe = d.groupTypeLabel || (surMesure.GROUP_TYPES[d.groupType] || {}).label || d.groupType || '';
    const ages = (Array.isArray(d.ages) ? d.ages : []).map((k) => (surMesure.AGES[k] || {}).label).filter(Boolean);
    if (groupe || d.organisation) lignes.push(`Groupe : ${groupe}${d.organisation ? `, ${d.organisation}` : ''}.`);
    if (Number(d.participants) > 0) {
      lignes.push(`Effectif : ${pluriel(Number(d.participants), 'joueur', 'joueurs')}${Number(d.companions) > 0 ? ` et ${pluriel(Number(d.companions), 'accompagnateur qui ne joue pas', 'accompagnateurs qui ne jouent pas')}` : ''}${ages.length ? ` ; âges : ${ages.join(', ').toLowerCase()}` : ''}.`);
    }
    const moment = d.momentLabel || (surMesure.MOMENTS[d.moment] || {}).label || '';
    if (d.flexible) lignes.push(`Date : à fixer, période envisagée : ${d.period || '?'}${moment ? ` ; moment : ${moment.toLowerCase()}` : ''}.`);
    else if (d.date) lignes.push(`Date souhaitée : ${surMesure.libelleDate(d.date) || d.date}${d.alternativeDate ? ` (ou ${surMesure.libelleDate(d.alternativeDate) || d.alternativeDate})` : ''}${moment ? ` ; moment : ${moment.toLowerCase()}` : ''}.`);
    const envies = [
      ...(Array.isArray(d.formulas) ? d.formulas : []).map((f) => (f && (f.name || f.id)) || '').filter(Boolean).map((n) => `la formule ${formuleCourte(n)}`),
      ...(Array.isArray(d.activities) ? d.activities : []).filter((a) => a && a.name).map((a) => surMesure.libelleActivite(a, d.participants)),
    ];
    if (envies.length) lignes.push(`Envies : ${envies.join(', ')}.`);
    if (d.advice) lignes.push('Le client demande que l’équipe lui propose un programme.');
    if (Number(d.budgetPerPerson) > 0) lignes.push(`Budget indicatif : ${euros(d.budgetPerPerson)} par personne.`);
    if (d.invoice) lignes.push(`Facture demandée${d.organisation ? ` au nom de ${d.organisation}` : ''}${d.vatNumber ? ` (TVA ${d.vatNumber})` : ''}.`);
  } else {
    const libre = [source.company ? `pour ${source.company}` : '', Number(source.pax) > 0 ? `${source.pax} personnes` : '', source.requestedDate ? `souhait : ${source.requestedDate}` : ''].filter(Boolean);
    if (libre.length) lignes.push(`Demande libre ${libre.join(', ')}.`);
  }
  if (source.message) lignes.push(`Message du client : « ${String(source.message).replace(/\s+/g, ' ').trim()} »`);
  return lignes.join('\n');
}

// Les dossiers du jour qui comptent sur la feuille : la bonne date, ni
// annulés ni refusés, triés par heure d'arrivée puis par nom.
function filtrerReservationsDuJour(reservations, date) {
  const liste = (Array.isArray(reservations) ? reservations : []).filter((r) => r && typeof r === 'object');
  return liste
    .filter((r) => (!date || !r.date || String(r.date).slice(0, 10) === String(date).slice(0, 10)) && !estAnnulee(r))
    .sort((a, b) => ((minutesDe(a.startTime) ?? 9999) - (minutesDe(b.startTime) ?? 9999)) || nomClient(a).localeCompare(nomClient(b), 'fr'));
}

// ---------------------------------------------------------------------------
// Le plan des pages : quels blocs, combien de lignes, quelle hauteur.
// ---------------------------------------------------------------------------
function planifierGrille(reservations) {
  const parBloc = new Map();
  for (const r of reservations) {
    const bloc = blocDe(r.startTime) ?? PLAGES[0].de;
    if (!parBloc.has(bloc)) parBloc.set(bloc, []);
    parBloc.get(bloc).push(r);
  }
  const pages = [];
  PLAGES.forEach((plage, index) => {
    const debuts = [];
    if (index === 0) debuts.push(...[...parBloc.keys()].filter((m) => m < plage.de).sort((a, b) => a - b));
    for (let m = plage.de; m <= plage.a; m += 30) debuts.push(m);
    if (index === PLAGES.length - 1) debuts.push(...[...parBloc.keys()].filter((m) => m > plage.a).sort((a, b) => a - b));
    const blocs = debuts.map((debut) => {
      const resas = parBloc.get(debut) || [];
      // Au-delà de cinq dossiers, le bloc grandit et garde une ligne vide.
      const n = Math.max(LIGNES_PAR_BLOC, resas.length + (resas.length >= LIGNES_PAR_BLOC ? 1 : 0));
      return { debut, resas, n };
    });
    const total = blocs.reduce((s, b) => s + b.n, 0);
    const hauteurLigne = Math.max(HAUTEUR_LIGNE.min, Math.min(HAUTEUR_LIGNE.max, HAUTEUR_UTILE / total));
    const capacite = Math.max(1, Math.floor(HAUTEUR_UTILE / hauteurLigne + 1e-6));
    let courante = { plage, suite: false, hauteurLigne, blocs: [], lignes: 0 };
    for (const bloc of blocs) {
      let offset = 0;
      let restant = bloc.n;
      while (restant > 0) {
        const dispo = capacite - courante.lignes;
        // Un bloc qui tiendrait entier sur une page neuve n'est pas coupé.
        if (dispo <= 0 || (dispo < restant && restant <= capacite && courante.lignes > 0)) {
          pages.push(courante);
          courante = { plage, suite: true, hauteurLigne, blocs: [], lignes: 0 };
          continue;
        }
        const prend = Math.min(restant, dispo);
        courante.blocs.push({ debut: bloc.debut, resas: bloc.resas.slice(offset, offset + prend), n: prend, suite: offset > 0 });
        courante.lignes += prend;
        offset += prend;
        restant -= prend;
      }
    }
    pages.push(courante);
  });
  return pages;
}

// ---------------------------------------------------------------------------
// Le dessin
// ---------------------------------------------------------------------------
function dessinerPageGrille(doc, plan, ctx) {
  const page = doc.ajouterPage({ orientation: 'landscape' });
  const x0 = PAGE.margeX;
  const y0 = PAGE.margeY;
  const largeurGrille = COL_HEURE_MM + COLONNES.reduce((s, c) => s + c.mm, 0);
  const xFin = x0 + largeurGrille;
  const xCols = [];
  let x = x0 + COL_HEURE_MM;
  for (const col of COLONNES) { xCols.push(x); x += col.mm; }

  // En-tête : les boîtes « Jour » et « Date », chacune avec sa ligne à écrire.
  const boites = [['Jour', ctx.vierge ? '' : capitaliser(jourDeLaSemaine(ctx.date))], ['Date', ctx.vierge ? '' : dateCourte(ctx.date)]];
  boites.forEach(([titre, valeur], i) => {
    const bx = xCols[i];
    const bw = COLONNES[i].mm;
    page.rectangle(bx, y0, bw, 2 * ENTETE.boite, { contour: 0, epaisseur: TRAIT.epais });
    page.ligne(bx, y0 + ENTETE.boite, bx + bw, y0 + ENTETE.boite, { epaisseur: TRAIT.fin });
    page.texteDansBoite(titre, bx, y0, bw, ENTETE.boite, { police: POLICES.grasse, taille: 9, aligner: 'center' });
    if (valeur) page.texteDansBoite(valeur, bx, y0 + ENTETE.boite, bw, ENTETE.boite, { taille: 9.5, aligner: 'center' });
  });
  page.texte(ctx.centreNom, xFin, y0 + 3.8, { police: POLICES.grasse, taille: 9.5, aligner: 'right', maxLargeur: 120 });
  const plage = `${etiquetteHeure(plan.plage.de)} à ${etiquetteHeure(plan.plage.a)}${plan.suite ? ' (suite)' : ''}`;
  page.texte(`Page ${ctx.numero}/${ctx.total} · ${plage}`, xFin, y0 + 8.6, { taille: 7.5, gris: 0.35, aligner: 'right' });

  // La ligne des titres de colonnes.
  const yTitres = y0 + 2 * ENTETE.boite;
  page.rectangle(x0, yTitres, COL_HEURE_MM, ENTETE.titres, { contour: 0, epaisseur: TRAIT.fin });
  COLONNES.forEach((col, i) => {
    page.rectangle(xCols[i], yTitres, col.mm, ENTETE.titres, { contour: 0, epaisseur: TRAIT.fin });
    page.texteDansBoite(col.titre, xCols[i], yTitres, col.mm, ENTETE.titres, { police: POLICES.grasse, taille: 7.6, aligner: 'center', marge: 0.6 });
  });

  // Le corps : les blocs, cinq lignes ou plus, trait épais entre les blocs.
  const h = plan.hauteurLigne;
  const tailleTexte = h >= 3.8 ? 7.4 : h >= 3.4 ? 6.8 : 6.2;
  let y = yTitres + ENTETE.titres;
  const yCorps = y;
  for (const bloc of plan.blocs) {
    const yBloc = y;
    for (let i = 0; i < bloc.n; i += 1) {
      const resa = bloc.resas[i];
      if (i > 0) page.ligne(x0 + COL_HEURE_MM, y, xFin, y, { epaisseur: TRAIT.fin });
      if (resa) dessinerLigne(page, resa, xCols, y, h, tailleTexte, ctx);
      y += h;
    }
    page.texte(`${etiquetteHeure(bloc.debut)}${bloc.suite ? ' (suite)' : ''}`, x0 + 0.9, yBloc + Math.min(3.2, h * 0.82), { police: POLICES.grasse, taille: bloc.suite ? 6 : 8, maxLargeur: COL_HEURE_MM - 1.4 });
    page.ligne(x0, y, xFin, y, { epaisseur: TRAIT.epais });
  }
  // Les verticales, puis le cadre.
  page.ligne(x0 + COL_HEURE_MM, yCorps, x0 + COL_HEURE_MM, y, { epaisseur: TRAIT.fin });
  xCols.slice(1).forEach((xc) => page.ligne(xc, yCorps, xc, y, { epaisseur: TRAIT.fin }));
  page.rectangle(x0, yTitres, largeurGrille, y - yTitres, { contour: 0, epaisseur: TRAIT.epais });
  page.ligne(x0, yCorps, xFin, yCorps, { epaisseur: TRAIT.epais });

  // Le pied.
  const yPied = Math.min(PAGE.hauteur - PAGE.margeY - 0.5, y + 3.2);
  page.texte(ctx.pied, x0, yPied, { taille: 6.5, gris: 0.4, maxLargeur: largeurGrille - 30 });
  page.texte(`page ${ctx.numero}/${ctx.total}`, xFin, yPied, { taille: 6.5, gris: 0.4, aligner: 'right' });
  return page;
}

function dessinerLigne(page, resa, xCols, y, h, taille, ctx) {
  COLONNES.forEach((col, i) => {
    const x = xCols[i];
    if (col.cle === 'nom') {
      const nom = nomClient(resa);
      if (aConfirmer(resa)) {
        const etiquette = 'à confirmer';
        const tailleEtq = Math.max(4.8, taille - 1.9);
        const largeurEtq = largeurTexte(etiquette, POLICES.grasse, tailleEtq) + 1.6;
        const hauteurEtq = Math.min(h - 0.6, 2.7);
        const xEtq = x + col.mm - 1 - largeurEtq;
        page.texteDansBoite(nom, x, y, col.mm - largeurEtq - 1.4, h, { police: POLICES.grasse, taille, marge: 1.1 });
        page.rectangle(xEtq, y + (h - hauteurEtq) / 2, largeurEtq, hauteurEtq, { contour: 0, epaisseur: 0.15 });
        page.texteDansBoite(etiquette, xEtq, y, largeurEtq, h, { police: POLICES.grasse, taille: tailleEtq, aligner: 'center', marge: 0.3 });
      } else {
        page.texteDansBoite(nom, x, y, col.mm, h, { police: POLICES.grasse, taille, marge: 1.1 });
      }
    } else if (col.cle === 'tel') {
      page.texteDansBoite(String(resa.phone || ''), x, y, col.mm, h, { taille, marge: 1.1 });
    } else if (col.cle === 'formule') {
      page.texteDansBoite(libelleFormule(resa, ctx.formules), x, y, col.mm, h, { taille: taille - 0.2, marge: 1 });
    } else if (col.cle === 'pers') {
      page.texteDansBoite(Number(resa.pax) > 0 ? String(resa.pax) : '', x, y, col.mm, h, { police: POLICES.grasse, taille, aligner: 'center', marge: 0.5 });
    } else {
      page.texteDansBoite(texteCase(resa, col, ctx.regles), x, y, col.mm, h, { taille: taille - 0.2, aligner: 'center', marge: 0.6 });
    }
  });
}

// L'annexe : un tableau, une ligne par dossier, jamais coupée entre deux pages.
const ANNEXE = Object.freeze({
  colonnes: [
    { cle: 'heure', titre: 'Heure', mm: 11 },
    { cle: 'client', titre: 'Client', mm: 46 },
    { cle: 'contact', titre: 'Contact', mm: 44 },
    { cle: 'programme', titre: 'Programme', mm: 80 },
    { cle: 'prix', titre: 'Prix', mm: 24 },
    { cle: 'statut', titre: 'Statut', mm: 28 },
    { cle: 'notes', titre: 'Notes', mm: 48 },
  ],
  taille: 7.3,
  interligne: 3.2,
  marge: 1,
});
// La formule telle que l'annexe et l'export la nomment (« Formule 4 »).
function libelleFormuleLong(resa, formules) {
  if (estSurMesure(resa)) return 'Sur mesure';
  const id = (resa && (resa.formuleId || resa.formulaId)) || '';
  if (!id) return '';
  return formuleLongue(nomFormule(id, formules) || id);
}
// « Paiement : Espèces », « Non payée » : la ligne de paiement sous le statut.
function paiementTexte(resa) {
  const methode = String((resa && resa.paymentMethod) || '').trim();
  if (!estPayee(resa)) return 'Non payée';
  if (statutFr(resa) === 'Payée') return methode ? `Paiement : ${methode}` : '';
  return `Payée${methode ? ` · ${methode}` : ''}`;
}
function cellulesAnnexe(resa, ctx) {
  const client = [
    { texte: nomClient(resa), gras: true },
    { texte: [Number(resa.pax) > 0 ? `${pluriel(Number(resa.pax), 'pers.', 'pers.')}` : '', libelleFormuleLong(resa, ctx.formules)].filter(Boolean).join(' · ') },
  ];
  if (aConfirmer(resa)) client.push({ texte: 'À confirmer par l’équipe', gras: true });
  if (resa.occasion) client.push({ texte: `Occasion : ${occasionFr(resa.occasion)}` });
  const contact = [{ texte: String(resa.phone || '') }, { texte: String(resa.email || ''), gris: 0.3, taille: 6.6 }];
  const programme = texteProgramme(resa).map((t) => ({ texte: t }));
  const prix = [{ texte: prixTexte(resa) }];
  const statut = [
    { texte: statutFr(resa), gras: true },
    { texte: paiementTexte(resa) },
    { texte: canalFr(resa.channel) },
  ].filter((l) => l.texte);
  const notes = [];
  const texteNotes = notesImprimables(resa.notes);
  if (texteNotes) notes.push({ texte: texteNotes });
  if (estSurMesure(resa)) {
    const explication = expliquerDemande(resa.customRequest || resa.demande || null);
    notes.push({ texte: `Demande sur mesure${explication ? ` : ${explication}` : '.'}`, gris: 0.15 });
  }
  return { heure: [{ texte: String(resa.startTime || ''), gras: true }], client, contact, programme, prix, statut, notes };
}
function dessinerAnnexe(doc, reservations, ctx, pagesPrevues) {
  const x0 = PAGE.margeX;
  const largeur = ANNEXE.colonnes.reduce((s, c) => s + c.mm, 0);
  const xFin = x0 + largeur;
  const bas = PAGE.hauteur - PAGE.margeY - PIED;
  const xCols = [];
  let x = x0;
  for (const col of ANNEXE.colonnes) { xCols.push(x); x += col.mm; }
  let page = null;
  let y = 0;
  const nouvellePage = (suite) => {
    page = doc.ajouterPage({ orientation: 'landscape' });
    pagesPrevues.push({ page, type: 'annexe' });
    y = PAGE.margeY;
    page.texte(`${ctx.centreNom} · ${dateLongue(ctx.date)} · détails de chaque réservation${suite ? ' (suite)' : ''}`, x0, y + 3.6, { police: POLICES.grasse, taille: 11.5, maxLargeur: largeur });
    y += 5.6;
    if (!suite) {
      page.texte('Tout ce qui ne tient pas dans une case de la grille : programme heure par heure, prix, paiement, e-mail, notes. Trié par heure d’arrivée.', x0, y + 2.8, { taille: 7.5, gris: 0.35, maxLargeur: largeur });
      y += 4.6;
    } else {
      y += 1;
    }
    ANNEXE.colonnes.forEach((col, i) => page.texteDansBoite(col.titre, xCols[i], y, col.mm, 5, { police: POLICES.grasse, taille: 7.8, marge: ANNEXE.marge }));
    y += 5;
    page.ligne(x0, y, xFin, y, { epaisseur: TRAIT.epais });
    y += 0.8;
  };
  nouvellePage(false);
  if (!reservations.length) {
    page.texte('Aucune réservation ce jour-là.', x0 + ANNEXE.marge, y + 4, { taille: 8, gris: 0.3 });
    return;
  }
  for (const resa of reservations) {
    const cellules = cellulesAnnexe(resa, ctx);
    // Chaque cellule devient des lignes coupées à la largeur de sa colonne.
    const rendu = ANNEXE.colonnes.map((col) => {
      const lignes = [];
      for (const bloc of cellules[col.cle] || []) {
        const police = bloc.gras ? POLICES.grasse : POLICES.normale;
        const taille = bloc.taille || ANNEXE.taille;
        for (const l of couperTexte(bloc.texte, police, taille, col.mm - 2 * ANNEXE.marge)) lignes.push({ texte: l, police, taille, gris: bloc.gris || 0 });
      }
      return lignes;
    });
    const hauteur = Math.max(1, ...rendu.map((l) => l.length)) * ANNEXE.interligne + 1.6;
    if (y + hauteur > bas) nouvellePage(true);
    rendu.forEach((lignes, i) => {
      lignes.forEach((l, j) => page.texte(l.texte, xCols[i] + ANNEXE.marge, y + 0.8 + (j + 1) * ANNEXE.interligne - 0.7, { police: l.police, taille: l.taille, gris: l.gris }));
    });
    y += hauteur;
    page.ligne(x0, y, xFin, y, { epaisseur: 0.12, gris: 0.55 });
  }
}

// ---------------------------------------------------------------------------
// L'entrée : la feuille complète, en Buffer PDF.
// ---------------------------------------------------------------------------
// `reservations` : les dossiers du jour (format API). `date` : 'YYYY-MM-DD'.
// `centreNom` : « Fun Galaxy Libramont ». `formules` : { id: nom } (ou la
// liste du catalogue). `imprimeLe` : « 05/10/2026 à 09:00 », une Date, ou
// rien (maintenant). `vierge` : la grille vide, sans annexe, à imprimer
// d'avance. `regles` : le réglage des cases (REGLES par défaut).
function construireFeuilleSecours(reservations, options = {}) {
  const { date = '', centreNom = 'Fun Galaxy', formules = {}, imprimeLe = null, vierge = false, regles = REGLES } = options;
  const actives = vierge ? [] : filtrerReservationsDuJour(reservations, date);
  const personnes = actives.reduce((s, r) => s + (Number(r.pax) || 0), 0);
  const instant = formaterInstant(imprimeLe);
  const pied = vierge
    ? `Feuille de secours Pinlane · feuille vierge · imprimée le ${instant}`
    : `Feuille de secours Pinlane · imprimée le ${instant} · ${pluriel(actives.length, 'réservation', 'réservations')} · ${pluriel(personnes, 'personne', 'personnes')}`;
  const doc = new PdfDocument({
    titre: vierge ? `Feuille de secours vierge · ${centreNom}` : `Feuille de secours · ${centreNom} · ${dateCourte(date)}`,
    auteur: 'Pinlane',
    sujet: 'Réservations du jour, grille papier de l’accueil',
  });
  const plans = planifierGrille(actives);
  const ctx = { date, centreNom, formules, regles, vierge, pied, numero: 0, total: plans.length };
  const pagesPrevues = [];
  plans.forEach((plan, i) => {
    ctx.numero = i + 1;
    pagesPrevues.push({ page: dessinerPageGrille(doc, plan, ctx), type: 'grille' });
  });
  if (!vierge) {
    const debutAnnexe = pagesPrevues.length;
    dessinerAnnexe(doc, actives, ctx, pagesPrevues);
    const totalAnnexe = pagesPrevues.length - debutAnnexe;
    pagesPrevues.slice(debutAnnexe).forEach(({ page }, i) => {
      const yPied = PAGE.hauteur - PAGE.margeY - 0.5;
      page.texte(`${pied} · annexe`, PAGE.margeX, yPied, { taille: 6.5, gris: 0.4, maxLargeur: 230 });
      page.texte(`annexe ${i + 1}/${totalAnnexe}`, PAGE.largeur - PAGE.margeX, yPied, { taille: 6.5, gris: 0.4, aligner: 'right' });
    });
  }
  return doc.versBuffer();
}

module.exports = {
  construireFeuilleSecours,
  // Le plan et les règles, pour les tests et pour l'export Excel.
  COLONNES,
  COLONNES_ACTIVITES,
  COL_HEURE_MM,
  REGLES,
  PLAGES,
  LIGNES_PAR_BLOC,
  HAUTEUR_LIGNE,
  HAUTEUR_UTILE,
  planifierGrille,
  filtrerReservationsDuJour,
  activitesDe,
  activitesSansColonne,
  casesActivites,
  texteCase,
  texteCasePistes,
  texteCaseParties,
  libelleDuree,
  libelleFormule,
  libelleFormuleLong,
  formuleCourte,
  formuleLongue,
  nomFormule,
  occasionFr,
  notesImprimables,
  statutFr,
  canalFr,
  paiementTexte,
  prixTexte,
  euros,
  programmeDetaille,
  ligneProgramme,
  texteProgramme,
  expliquerDemande,
  estSurMesure,
  estAnnulee,
  estPayee,
  aConfirmer,
  nomClient,
  minutesDe,
  hhmmDe,
  blocDe,
  etiquetteHeure,
  dateCourte,
  dateLongue,
  jourDeLaSemaine,
  formaterInstant,
};

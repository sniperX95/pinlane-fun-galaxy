'use strict';
// LE CLASSEUR EXCEL DU JOUR (2026-10-05).
//
// Le pendant tableur de la feuille de secours : la même journée, les mêmes
// règles de cases (une croix par piste, par partie...), mais filtrable,
// triable et calculable. Cinq onglets :
//
//   Résumé               le centre, la date, les totaux, les comptes par
//                        activité et par créneau, ce qui reste à confirmer
//                        ou à encaisser ;
//   Réservations         une ligne par dossier, les neuf colonnes d'activité
//                        de la feuille papier, prix, paiement, statut, canal,
//                        notes (sans les lignes internes de l'équipe) ;
//   Programme détaillé   une ligne par bloc d'activité planifié ;
//   Demandes sur mesure  chaque demande avec tous ses champs et son suivi ;
//   Historique           les modifications (journal d'audit), si fournies.
//
// Pur : aucune lecture en base. Les réservations sont celles que l'API sert
// (mapReservation), les demandes celles de custom_requests (mapCustomRequest,
// payload.demande et payload.suivi), l'historique une liste
// { quand, qui, action, avant, après }. Les nombres sont des nombres, les
// heures et les dates des heures et des dates Excel : on peut sommer, trier
// et filtrer sans retaper.

const { Classeur, FOND } = require('./xlsx-writer');
const feuille = require('./feuille-secours');
const surMesure = require('./custom-request');

let CATALOGUE_ACTIVITES = {};
try {
  const catalogue = require('../ops-knowledge/activities.json');
  CATALOGUE_ACTIVITES = Object.fromEntries((catalogue.activities || []).map((a) => [a.id, a.name]));
} catch (error) { CATALOGUE_ACTIVITES = {}; }

const STATUTS_DEMANDE = { new: 'Nouvelle', in_progress: 'En cours', handled: 'Traitée', archived: 'Archivée' };
const TYPES_SUIVI = { 'prise-en-charge': 'Prise en charge', reponse: 'Réponse envoyée', statut: 'Statut', reservation: 'Réservation créée', note: 'Note' };

function nomActivite(id) {
  const col = feuille.COLONNES_ACTIVITES.find((c) => c.activites.includes(id));
  return CATALOGUE_ACTIVITES[id] || (col ? col.titre : id);
}
function dateHeureFr(valeur) {
  if (!valeur) return '';
  const d = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(d.getTime())) return String(valeur);
  return feuille.formaterInstant(d).replace(' à ', ' ');
}
function texteValeur(valeur) {
  if (valeur == null || valeur === '') return '';
  if (typeof valeur === 'string') return valeur;
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur);
  if (valeur instanceof Date) return dateHeureFr(valeur);
  if (Array.isArray(valeur)) return valeur.map(texteValeur).filter(Boolean).join(', ');
  if (typeof valeur === 'object') {
    return Object.entries(valeur).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} : ${typeof v === 'object' && v !== null ? JSON.stringify(v) : texteValeur(v)}`).join('\n');
  }
  return String(valeur);
}
function champ(objet, ...noms) {
  for (const nom of noms) if (objet && objet[nom] !== undefined && objet[nom] !== null) return objet[nom];
  return undefined;
}

// ---------------------------------------------------------------------------
// Résumé
// ---------------------------------------------------------------------------
function feuilleResume(classeur, { actives, annulees, date, centreNom, genereLe }) {
  const f = classeur.ajouterFeuille('Résumé', { figer: 0, filtre: false, bandes: false, paysage: false });
  f.definirColonnes([{ titre: 'Clé', largeur: 34 }, { titre: 'Valeur', largeur: 22 }, { titre: '', largeur: 16 }, { titre: '', largeur: 18 }]);
  f.titre(`${centreNom} · ${feuille.dateLongue(date) || date}`, 4);
  f.titre(`Classeur du jour Pinlane · généré le ${genereLe}`, 4, { style: 'sous-titre' });
  f.vide();
  const personnes = actives.reduce((s, r) => s + (Number(r.pax) || 0), 0);
  const chiffre = actives.reduce((s, r) => s + (Number.isFinite(Number(r.price)) ? Number(r.price) : 0), 0);
  const aConfirmer = actives.filter(feuille.aConfirmer);
  const payees = actives.filter(feuille.estPayee);
  const nonPayees = actives.filter((r) => !feuille.estPayee(r));
  const enLigne = actives.filter((r) => feuille.canalFr(r.channel).startsWith('En ligne'));
  f.entete(['Le jour en chiffres', '', '', '']);
  f.ligneCle('Centre', centreNom);
  f.ligneCle('Date', date, 'date');
  f.ligneCle('Réservations', actives.length, 'entier');
  f.ligneCle('Personnes attendues', personnes, 'entier');
  f.ligneCle('Chiffre d’affaires attendu', chiffre, 'euros');
  f.ligneCle('À confirmer par l’équipe', aConfirmer.length, 'entier');
  f.ligneCle('Payées', payees.length, 'entier');
  f.ligneCle('Encaissé', payees.reduce((s, r) => s + (Number(r.price) || 0), 0), 'euros');
  f.ligneCle('Non payées', nonPayees.length, 'entier');
  f.ligneCle('Reste à encaisser', nonPayees.reduce((s, r) => s + (Number(r.price) || 0), 0), 'euros');
  f.ligneCle('Réservées en ligne', enLigne.length, 'entier');
  f.ligneCle('Prises au comptoir', actives.length - enLigne.length, 'entier');
  f.ligneCle('Annulées ou refusées (non comptées)', annulees.length, 'entier');
  f.vide();

  // Par activité : dans l'ordre des colonnes du papier, puis les autres.
  const parActivite = new Map();
  for (const r of actives) {
    for (const [id, a] of feuille.activitesDe(r)) {
      if (!parActivite.has(id)) parActivite.set(id, { reservations: 0, personnes: 0, unites: 0 });
      const compte = parActivite.get(id);
      compte.reservations += 1;
      compte.personnes += Number(r.pax) || 0;
      const cases = feuille.casesActivites(r);
      const col = feuille.COLONNES_ACTIVITES.find((c) => c.activites.includes(id));
      if (col && (col.regle === 'pistes' || col.regle === 'parties')) {
        compte.unites += (cases[col.cle].match(/X/g) || []).length;
      }
      void a;
    }
  }
  const ordre = [...feuille.COLONNES_ACTIVITES.flatMap((c) => c.activites), ...[...parActivite.keys()].sort()];
  const ids = [...new Set(ordre)].filter((id) => parActivite.has(id));
  f.entete(['Par activité', 'Réservations', 'Personnes', 'Pistes ou parties']);
  if (!ids.length) f.ligneVide('Aucune activité réservée ce jour-là.');
  for (const id of ids) {
    const c = parActivite.get(id);
    const col = feuille.COLONNES_ACTIVITES.find((x) => x.activites.includes(id));
    const unites = col && (col.regle === 'pistes' || col.regle === 'parties') ? { v: c.unites, type: 'entier' } : { v: '', type: 'texte' };
    f.ajouterLigne([{ v: nomActivite(id), type: 'texte', gras: true, fond: FOND.cle }, { v: c.reservations, type: 'entier' }, { v: c.personnes, type: 'entier' }, unites]);
  }
  f.vide();

  // Par créneau : où la journée pousse.
  const parCreneau = new Map();
  for (const r of actives) {
    const bloc = feuille.blocDe(r.startTime);
    const cle = bloc == null ? -1 : bloc;
    if (!parCreneau.has(cle)) parCreneau.set(cle, { reservations: 0, personnes: 0 });
    parCreneau.get(cle).reservations += 1;
    parCreneau.get(cle).personnes += Number(r.pax) || 0;
  }
  f.entete(['Par créneau (demi-heure d’arrivée)', 'Réservations', 'Personnes', '']);
  if (!parCreneau.size) f.ligneVide('Aucune réservation ce jour-là.');
  for (const cle of [...parCreneau.keys()].sort((a, b) => a - b)) {
    const c = parCreneau.get(cle);
    f.ajouterLigne([{ v: cle < 0 ? 'Sans heure' : feuille.hhmmDe(cle), type: cle < 0 ? 'texte' : 'heure', gras: true, fond: FOND.cle, aligner: 'left' }, { v: c.reservations, type: 'entier' }, { v: c.personnes, type: 'entier' }, { v: '', type: 'texte' }]);
  }
  return f;
}

// ---------------------------------------------------------------------------
// Réservations
// ---------------------------------------------------------------------------
function feuilleReservations(classeur, { toutes, formules }) {
  const f = classeur.ajouterFeuille('Réservations', { figer: 1, filtre: true, bandes: true, paysage: true });
  f.definirColonnes([
    { titre: 'Heure', type: 'heure', largeur: 8 },
    { titre: 'Client', type: 'texte', wrap: true, largeur: 30 },
    { titre: 'Téléphone', type: 'texte', largeur: 18 },
    { titre: 'E-mail', type: 'texte', largeur: 30 },
    { titre: 'Formule', type: 'texte', largeur: 16 },
    { titre: 'Pers.', type: 'entier', largeur: 7 },
    ...feuille.COLONNES_ACTIVITES.map((c) => ({ titre: c.titre, type: 'texte', aligner: 'center', largeur: c.cle === 'bowling' ? 14 : 9 })),
    { titre: 'Prix', type: 'euros', largeur: 11 },
    { titre: 'Prix de référence', type: 'euros', largeur: 12 },
    { titre: 'Payé', type: 'booleen', largeur: 7, aligner: 'center' },
    { titre: 'Moyen de paiement', type: 'texte', largeur: 14 },
    { titre: 'Statut', type: 'texte', largeur: 13 },
    { titre: 'Canal', type: 'texte', largeur: 11 },
    { titre: 'Notes', type: 'texte', wrap: true, largeur: 45 },
    { titre: 'Référence', type: 'entier', largeur: 10 },
  ]);
  f.entete();
  if (!toutes.length) f.ligneVide('Aucune réservation ce jour-là.');
  for (const r of toutes) {
    const cases = feuille.casesActivites(r);
    const prix = Number(r.price);
    const base = Number(r.basePrice);
    const reference = Number.isFinite(base) && base > 0 && Number.isFinite(prix) && Math.abs(base - prix) >= 0.005 ? base : '';
    const notes = [feuille.notesImprimables(r.notes)];
    if (feuille.estSurMesure(r)) notes.push(`Demande sur mesure : ${feuille.expliquerDemande(r.customRequest || r.demande || null) || 'voir la demande'}`);
    f.ajouterLigne([
      r.startTime || '',
      feuille.nomClient(r),
      String(r.phone || ''),
      String(r.email || ''),
      feuille.libelleFormuleLong(r, formules),
      Number(r.pax) > 0 ? Number(r.pax) : '',
      ...feuille.COLONNES_ACTIVITES.map((c) => cases[c.cle]),
      Number.isFinite(prix) ? prix : '',
      reference,
      feuille.estPayee(r),
      feuille.estPayee(r) ? String(r.paymentMethod || '') : '',
      feuille.statutFr(r),
      feuille.canalFr(r.channel),
      notes.filter(Boolean).join('\n'),
      Number.isFinite(Number(r.id)) ? Number(r.id) : '',
    ]);
  }
  return f;
}

// ---------------------------------------------------------------------------
// Programme détaillé
// ---------------------------------------------------------------------------
function feuilleProgramme(classeur, { actives }) {
  const f = classeur.ajouterFeuille('Programme détaillé', { figer: 1, filtre: true, bandes: true, paysage: true });
  f.definirColonnes([
    { titre: 'Heure début', type: 'heure', largeur: 11 },
    { titre: 'Heure fin', type: 'heure', largeur: 10 },
    { titre: 'Client', type: 'texte', largeur: 30 },
    { titre: 'Activité', type: 'texte', largeur: 28 },
    { titre: 'Pistes / parties', type: 'texte', largeur: 15 },
    { titre: 'Joueurs', type: 'entier', largeur: 9 },
    { titre: 'Détail', type: 'texte', wrap: true, largeur: 30 },
  ]);
  f.entete();
  const lignes = [];
  for (const r of actives) {
    for (const p of feuille.programmeDetaille(r)) {
      const unites = p.pistes > 0 ? `${p.pistes} piste${p.pistes > 1 ? 's' : ''}` : p.numeroPartie > 0 ? `partie ${p.numeroPartie}/${p.parties}` : p.parties > 0 ? `${p.parties} partie${p.parties > 1 ? 's' : ''}` : '';
      const details = [];
      if (!p.heureDebut) details.push('Sans heure fixée');
      if (p.minutes > 0 && !p.heureDebut) details.push(feuille.libelleDuree(p.minutes));
      if (p.credit) details.push(`Crédit arcade : ${texteValeur(p.credit.totalCredits || p.credit.credits || '')} crédits`.replace(' :  crédits', ''));
      lignes.push({ tri: feuille.minutesDe(p.heureDebut) ?? 9999, client: feuille.nomClient(r), cellules: [p.heureDebut, p.heureFin, feuille.nomClient(r), p.activite, unites, p.joueurs > 0 ? p.joueurs : '', details.join(' · ')] });
    }
  }
  lignes.sort((a, b) => (a.tri - b.tri) || a.client.localeCompare(b.client, 'fr'));
  if (!lignes.length) f.ligneVide('Aucune activité planifiée ce jour-là.');
  for (const l of lignes) f.ajouterLigne(l.cellules);
  return f;
}

// ---------------------------------------------------------------------------
// Demandes sur mesure
// ---------------------------------------------------------------------------
function demandeDe(item) {
  const payload = champ(item, 'payload') || {};
  const d = payload.demande && typeof payload.demande === 'object' ? payload.demande : (item.demande && typeof item.demande === 'object' ? item.demande : null);
  return d;
}
function suiviTexte(item) {
  const payload = champ(item, 'payload') || {};
  const suivi = payload.suivi && typeof payload.suivi === 'object' ? payload.suivi : {};
  const historique = Array.isArray(suivi.historique) ? suivi.historique : [];
  return historique.map((e) => {
    if (!e || typeof e !== 'object') return '';
    const quand = dateHeureFr(e.le);
    let detail = TYPES_SUIVI[e.type] || e.type || '';
    if (e.type === 'reponse') detail += `${e.objet ? ` : ${e.objet}` : ''}${e.source ? ` (${e.source === 'ia' ? 'IA, relue' : 'brouillon du code'})` : ''}`;
    if (e.type === 'statut') detail += ` : ${STATUTS_DEMANDE[e.statut] || e.statut || ''}`;
    if (e.type === 'reservation') detail += `${e.reservationId ? ` n° ${e.reservationId}` : ''}${e.date ? ` le ${feuille.dateCourte(e.date)}` : ''}`;
    if (e.type === 'note') detail += `${e.texte ? ` : ${e.texte}` : ''}`;
    return `${quand ? `${quand} · ` : ''}${detail}${e.par ? ` · ${e.par}` : ''}`;
  }).filter(Boolean).join('\n');
}
function notesEquipeTexte(item) {
  const payload = champ(item, 'payload') || {};
  const suivi = payload.suivi && typeof payload.suivi === 'object' ? payload.suivi : {};
  return (Array.isArray(suivi.notes) ? suivi.notes : []).map((n) => (n && n.texte ? `${dateHeureFr(n.le)}${n.par ? ` · ${n.par}` : ''} : ${n.texte}` : '')).filter(Boolean).join('\n');
}
function feuilleDemandes(classeur, { demandes }) {
  const f = classeur.ajouterFeuille('Demandes sur mesure', { figer: 1, filtre: true, bandes: true, paysage: true });
  f.definirColonnes([
    { titre: 'Référence', type: 'entier', largeur: 10 },
    { titre: 'Reçue le', type: 'dateheure', largeur: 17 },
    { titre: 'Statut', type: 'texte', largeur: 11 },
    { titre: 'Contact', type: 'texte', largeur: 24 },
    { titre: 'Rôle du contact', type: 'texte', largeur: 16 },
    { titre: 'Organisation', type: 'texte', largeur: 24 },
    { titre: 'E-mail', type: 'texte', largeur: 28 },
    { titre: 'Téléphone', type: 'texte', largeur: 16 },
    { titre: 'Type de groupe', type: 'texte', largeur: 20 },
    { titre: 'Participants', type: 'entier', largeur: 12 },
    { titre: 'Accompagnants', type: 'entier', largeur: 14 },
    { titre: 'Âges', type: 'texte', largeur: 22 },
    { titre: 'Date souhaitée', type: 'date', largeur: 14 },
    { titre: 'Autre date possible', type: 'date', largeur: 14 },
    { titre: 'Période envisagée', type: 'texte', largeur: 22 },
    { titre: 'Moment', type: 'texte', largeur: 16 },
    { titre: 'Formules souhaitées', type: 'texte', wrap: true, largeur: 26 },
    { titre: 'Activités souhaitées', type: 'texte', wrap: true, largeur: 40 },
    { titre: 'Conseil demandé', type: 'booleen', largeur: 10, aligner: 'center' },
    { titre: 'Budget par personne', type: 'euros', largeur: 12 },
    { titre: 'Facture', type: 'booleen', largeur: 8, aligner: 'center' },
    { titre: 'N° TVA', type: 'texte', largeur: 16 },
    { titre: 'Occasion', type: 'texte', largeur: 14 },
    { titre: 'Message du client', type: 'texte', wrap: true, largeur: 50 },
    { titre: 'Source', type: 'texte', largeur: 10 },
    { titre: 'Suivi', type: 'texte', wrap: true, largeur: 50 },
    { titre: 'Notes de l’équipe', type: 'texte', wrap: true, largeur: 40 },
    { titre: 'Mise à jour', type: 'dateheure', largeur: 17 },
  ]);
  f.entete();
  if (!demandes.length) { f.ligneVide('Aucune demande sur mesure.'); return f; }
  for (const item of demandes) {
    const d = demandeDe(item) || {};
    const ages = (Array.isArray(d.ages) ? d.ages : []).map((k) => (surMesure.AGES[k] || {}).label || k).join(', ');
    const formulesTxt = (Array.isArray(d.formulas) ? d.formulas : []).map((x) => (x && (x.name || x.id)) || '').filter(Boolean).map(feuille.formuleLongue).join('\n');
    const activitesTxt = (Array.isArray(d.activities) ? d.activities : []).filter((a) => a && a.name).map((a) => surMesure.libelleActivite(a, d.participants)).join('\n');
    const statut = String(champ(item, 'status') || 'new');
    f.ajouterLigne([
      Number.isFinite(Number(champ(item, 'id'))) ? Number(champ(item, 'id')) : '',
      champ(item, 'createdAt', 'created_at') || '',
      STATUTS_DEMANDE[statut] || statut,
      String(champ(item, 'contactName', 'contact_name') || ''),
      String(d.contactRole || ''),
      String(champ(item, 'company') || d.organisation || ''),
      String(champ(item, 'email') || ''),
      String(champ(item, 'phone') || ''),
      String(d.groupTypeLabel || (surMesure.GROUP_TYPES[d.groupType] || {}).label || d.groupType || ''),
      Number(d.participants) > 0 ? Number(d.participants) : (Number(champ(item, 'pax')) > 0 ? Number(champ(item, 'pax')) : ''),
      Number(d.companions) > 0 ? Number(d.companions) : (d.participants ? 0 : ''),
      ages,
      d.date || (!d.flexible && champ(item, 'requestedDate', 'requested_date')) || '',
      d.alternativeDate || '',
      d.flexible ? String(d.period || '') : '',
      String(d.momentLabel || (surMesure.MOMENTS[d.moment] || {}).label || ''),
      formulesTxt,
      activitesTxt,
      d.advice === true,
      Number(d.budgetPerPerson) > 0 ? Number(d.budgetPerPerson) : '',
      d.invoice === true,
      String(d.vatNumber || ''),
      feuille.occasionFr(champ(item, 'occasion') || ''),
      String(champ(item, 'message') || ''),
      String(champ(item, 'source') || ''),
      suiviTexte(item),
      notesEquipeTexte(item),
      champ(item, 'updatedAt', 'updated_at') || '',
    ]);
  }
  return f;
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------
function feuilleHistorique(classeur, { historique }) {
  const f = classeur.ajouterFeuille('Historique', { figer: 1, filtre: true, bandes: true, paysage: true });
  f.definirColonnes([
    { titre: 'Quand', type: 'dateheure', largeur: 17 },
    { titre: 'Qui', type: 'texte', largeur: 24 },
    { titre: 'Action', type: 'texte', largeur: 30 },
    { titre: 'Avant', type: 'texte', wrap: true, largeur: 45 },
    { titre: 'Après', type: 'texte', wrap: true, largeur: 45 },
  ]);
  f.entete();
  if (!historique.length) { f.ligneVide('Aucune modification enregistrée.'); return f; }
  for (const e of historique) {
    if (!e || typeof e !== 'object') continue;
    f.ajouterLigne([
      champ(e, 'quand', 'createdAt', 'created_at', 'at', 'le') || '',
      texteValeur(champ(e, 'qui', 'actorLabel', 'actor', 'actorName', 'par') || ''),
      texteValeur(champ(e, 'action') || ''),
      texteValeur(champ(e, 'avant', 'before') || ''),
      texteValeur(champ(e, 'après', 'apres', 'after') || ''),
    ]);
  }
  return f;
}

// ---------------------------------------------------------------------------
// L'entrée
// ---------------------------------------------------------------------------
// `reservations` : les dossiers du jour. `date` : 'YYYY-MM-DD'. `centreNom`.
// `formules` : { id: nom }. `demandesSurMesure` : les lignes custom_requests
// (mapCustomRequest). `historique` : [{ quand, qui, action, avant, après }].
// `genereLe` : « 05/10/2026 à 09:00 », une Date, ou rien (maintenant).
function construireClasseurJour(reservations, options = {}) {
  const { date = '', centreNom = 'Fun Galaxy', formules = {}, demandesSurMesure = [], historique = [], genereLe = null } = options;
  const toutes = (Array.isArray(reservations) ? reservations : [])
    .filter((r) => r && typeof r === 'object' && (!date || !r.date || String(r.date).slice(0, 10) === String(date).slice(0, 10)))
    .sort((a, b) => ((feuille.minutesDe(a.startTime) ?? 9999) - (feuille.minutesDe(b.startTime) ?? 9999)) || feuille.nomClient(a).localeCompare(feuille.nomClient(b), 'fr'));
  const actives = toutes.filter((r) => !feuille.estAnnulee(r));
  const annulees = toutes.filter(feuille.estAnnulee);
  const classeur = new Classeur({ titre: `Pinlane · ${centreNom} · ${feuille.dateCourte(date) || date}`, auteur: 'Pinlane' });
  const ctx = { toutes, actives, annulees, date, centreNom, formules, genereLe: feuille.formaterInstant(genereLe) };
  feuilleResume(classeur, ctx);
  feuilleReservations(classeur, ctx);
  feuilleProgramme(classeur, ctx);
  feuilleDemandes(classeur, { demandes: (Array.isArray(demandesSurMesure) ? demandesSurMesure : []).filter((d) => d && typeof d === 'object') });
  feuilleHistorique(classeur, { historique: Array.isArray(historique) ? historique : [] });
  return classeur.versBuffer();
}

module.exports = {
  construireClasseurJour,
  NOMS_FEUILLES: ['Résumé', 'Réservations', 'Programme détaillé', 'Demandes sur mesure', 'Historique'],
  suiviTexte,
  notesEquipeTexte,
  nomActivite,
};

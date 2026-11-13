'use strict';
// L HISTORIQUE D UN DOSSIER ET SA DERNIERE MODIFICATION (2026-11-03).
//
// Movsar : « tout ce qui est sur mesure modifier ou prix ajuster tout bien
// visible sur le planning complet et sur les cartes des reservations ». Deux
// lectures d une meme chose, ce qui a change sur un dossier, dites avec les
// memes mots :
//   - l HISTORIQUE, lu dans audit_log a la demande (la fiche l ouvre), centre
//     verifie, au niveau « historique » du role ;
//   - la DERNIERE MODIFICATION, ecrite avec le dossier au moment ou il change
//     (opsPlan.derniereModif), pour que le staff-state la porte sans aucune
//     requete de plus.
//
// Pourquoi l ecrire plutot que la lire : le staff-state est relu par chaque
// poste a chaque releve, et la lire dans audit_log demanderait une requete de
// plus par releve sur une table qui ne se purge pas, dont chaque ligne pese
// l avant/apres complet du dossier (64 Ko au plus). L ecrire ne coute rien a la
// lecture : la ligne est deja lue (`select *`), et l ecriture a deja l avant et
// l apres en main. Elle ne depend pas non plus du journal, qui peut perdre une
// trace sans faire echouer l action (regime non bloquant, lib/audit-log.js).
//
// Les phrases sont courtes et sans jargon : « 12 → 14 joueurs », « Heure 15:00
// → 16:00 », « Prix 60 € → 40 €, geste commercial », « Ajout : Pizza × 6 ».
// Ce module ne charge rien a son chargement (lib/database.js le lit au sien) :
// le journal et les droits se lisent a la demande.

const FLECHE = ' → ';
const PHRASE_MAX = 140;
const QUOI_MAX = 6;
const ENTREE_QUOI_MAX = 10;
const HISTORIQUE_LIMITE = 80;
const NOTE_TAG = '[equipe] ';

const STATUTS = { pending: 'En attente', arrived: 'Arrivé', paid: 'Payé', cancelled: 'Annulé' };

function texte(valeur, longueur = PHRASE_MAX) {
  const propre = String(valeur ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return propre.length > longueur ? `${propre.slice(0, longueur - 1).trimEnd()}…` : propre;
}

function montant(valeur) {
  const arrondi = Math.round((Number(valeur) || 0) * 100) / 100;
  return `${Number.isInteger(arrondi) ? arrondi : arrondi.toFixed(2).replace('.', ',')} €`;
}

const centimes = (valeur) => Math.round((Number(valeur) || 0) * 100);

function heure(valeur) {
  const lu = /^(\d{1,2}):(\d{2})/.exec(String(valeur || ''));
  return lu ? `${lu[1].padStart(2, '0')}:${lu[2]}` : '';
}

function jour(valeur) {
  const iso = String(valeur || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-BE', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

function duree(heures) {
  const minutes = Math.round((Number(heures) || 0) * 60);
  if (minutes <= 0) return '';
  if (minutes < 60) return `${minutes} min`;
  const reste = minutes % 60;
  return `${Math.floor(minutes / 60)} h${reste ? ` ${String(reste).padStart(2, '0')}` : ''}`;
}

function liste(valeurs) {
  const v = valeurs.map(String);
  if (v.length <= 1) return v.join('');
  return `${v.slice(0, -1).join(', ')} et ${v[v.length - 1]}`;
}

function pistes(valeur) {
  return (Array.isArray(valeur) ? valeur : []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

const present = (objet, cle) => Boolean(objet) && Object.prototype.hasOwnProperty.call(objet, cle);

function lireNote(ligne) {
  const brute = String(ligne || '').trimStart();
  if (!brute.startsWith(NOTE_TAG)) return null;
  try {
    const note = JSON.parse(brute.slice(NOTE_TAG.length));
    return note && typeof note === 'object' && typeof note.t === 'string' ? note : null;
  } catch (error) {
    return null;
  }
}

function notesEquipe(notes) {
  return String(notes || '').split('\n').map(lireNote).filter(Boolean);
}

// Le mot du client et ce qu il a ecrit : ni les notes de l equipe, ni les
// traces du moteur (`[ops:...]`, `[SIM:...]`).
function motDuClient(notes) {
  return String(notes || '').split('\n')
    .filter((ligne) => !lireNote(ligne) && !/^\s*\[(ops:|SIM:)/.test(ligne))
    .map((ligne) => ligne.trim()).filter(Boolean).join('\n');
}

// Les notes d equipe nouvelles : celles dont la cle `le` n existait pas.
function notesNouvelles(avant, apres) {
  const connues = new Set(notesEquipe(avant).map((note) => note.le).filter(Boolean));
  return notesEquipe(apres).filter((note) => note.le && !connues.has(note.le));
}

// ---------------------------------------------------------------------------
// LES LIGNES DE SUR MESURE.
// ---------------------------------------------------------------------------
function nomSeul(nom) {
  return String(nom ?? '').replace(/\s+[×x]\s*\d{1,4}$/i, '').trim();
}

function cleDeLigne(ligne) {
  const base = ligne && ligne.articleId ? `a:${ligne.articleId}` : `n:${nomSeul(ligne && ligne.name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}`;
  return base;
}

function indexer(lignes) {
  const vus = new Map();
  const index = new Map();
  (Array.isArray(lignes) ? lignes : []).filter((ligne) => ligne && typeof ligne === 'object').forEach((ligne) => {
    const base = cleDeLigne(ligne);
    const rang = (vus.get(base) || 0) + 1;
    vus.set(base, rang);
    index.set(rang > 1 ? `${base}#${rang}` : base, ligne);
  });
  return index;
}

function nomDeLigne(ligne) {
  return texte(ligne && ligne.name, 80) || 'Extra';
}

function phrasesDesExtras(avant, apres) {
  const a = indexer(avant);
  const b = indexer(apres);
  const phrases = [];
  b.forEach((ligne, cle) => {
    const ancienne = a.get(cle);
    if (!ancienne) {
      const prix = Number(ligne.price) || 0;
      phrases.push(`Ajout : ${nomDeLigne(ligne)}${prix ? `, ${montant(prix)}` : ''}`);
      return;
    }
    if (nomDeLigne(ancienne) !== nomDeLigne(ligne)) phrases.push(`${nomDeLigne(ancienne)}${FLECHE}${nomDeLigne(ligne)}`);
    else if (centimes(ancienne.price) !== centimes(ligne.price)) phrases.push(`${nomDeLigne(ligne)} : ${montant(ancienne.price)}${FLECHE}${montant(ligne.price)}`);
    if (heure(ancienne.heure) !== heure(ligne.heure)) phrases.push(heure(ligne.heure) ? `${nomDeLigne(ligne)} à ${heure(ligne.heure)}` : `${nomDeLigne(ligne)} : sans heure`);
  });
  a.forEach((ligne, cle) => {
    if (!b.has(cle)) phrases.push(`Retrait : ${nomDeLigne(ligne)}`);
  });
  return phrases;
}

// ---------------------------------------------------------------------------
// LE PROGRAMME D UNE VISITE.
// ---------------------------------------------------------------------------
function itemsDu(programme) {
  const items = Array.isArray(programme) ? programme : (programme && Array.isArray(programme.items) ? programme.items : []);
  return items.filter((item) => item && typeof item === 'object' && (item.activityId || item.id));
}

const COMPOSITION = ['duration', 'games', 'units', 'hours', 'minutes', 'sessions', 'sessionMinutes'];

function phrasesDuProgramme(avant, apres) {
  const a = itemsDu(avant);
  const b = itemsDu(apres);
  const id = (item) => String(item.activityId || item.id);
  const nom = (item) => texte(item.name, 60) || id(item);
  const idsA = a.map(id);
  const idsB = b.map(id);
  const phrases = [];
  b.filter((item) => !idsA.includes(id(item))).forEach((item) => phrases.push(`Ajout : ${nom(item)}`));
  a.filter((item) => !idsB.includes(id(item))).forEach((item) => phrases.push(`Retrait : ${nom(item)}`));
  if (!phrases.length) {
    const composition = (items) => JSON.stringify(items.map((item) => [id(item), ...COMPOSITION.map((cle) => Number(item[cle]) || 0)]));
    if (a.length && composition(a) !== composition(b)) phrases.push('Programme ajusté');
  }
  return phrases;
}

// ---------------------------------------------------------------------------
// CE QUI A CHANGE ENTRE DEUX ETATS D UN DOSSIER.
// ---------------------------------------------------------------------------
// `avant` et `apres` sont deux dossiers (forme mapReservation) ou deux morceaux
// de dossier (l avant/apres d une ligne du journal) : un champ absent des deux
// cotes n a pas change. Rend `contenu` (ce qui se vend : le groupe, l heure, la
// date, l offre, le sur mesure, le prix...) et `suivi` (le statut, les notes,
// les coches), dans l ordre ou un gerant les lit.
function phrasesDuChangement(avant = {}, apres = {}) {
  const a = avant && typeof avant === 'object' ? avant : {};
  const b = apres && typeof apres === 'object' ? apres : {};
  const touche = (cle) => present(a, cle) || present(b, cle);
  const contenu = [];
  const suivi = [];

  if (touche('pax') && Number(a.pax) > 0 && Number(b.pax) > 0 && Number(a.pax) !== Number(b.pax)) {
    contenu.push(`${Number(a.pax)}${FLECHE}${Number(b.pax)} joueur${Number(b.pax) > 1 ? 's' : ''}`);
  }
  if (touche('startTime') && heure(a.startTime) && heure(b.startTime) && heure(a.startTime) !== heure(b.startTime)) {
    contenu.push(`Heure ${heure(a.startTime)}${FLECHE}${heure(b.startTime)}`);
  }
  if (touche('date') && jour(a.date) && jour(b.date) && String(a.date).slice(0, 10) !== String(b.date).slice(0, 10)) {
    contenu.push(`Date ${jour(a.date)}${FLECHE}${jour(b.date)}`);
  }
  if (touche('duration') && duree(a.duration) && duree(b.duration) && duree(a.duration) !== duree(b.duration)) {
    contenu.push(`Durée ${duree(a.duration)}${FLECHE}${duree(b.duration)}`);
  }
  if (touche('label') && texte(a.label) && texte(b.label) && texte(a.label) !== texte(b.label)) {
    const adaptee = (libelle) => /\(adapt[ée]e\)/i.test(String(libelle || ''));
    const nu = (libelle) => texte(String(libelle || '').replace(/\s*\(adapt[ée]e\)/i, ''), 70);
    if (nu(a.label) === nu(b.label)) contenu.push(adaptee(b.label) ? 'Formule adaptée' : 'Formule remise à sa carte');
    else contenu.push(`Offre ${nu(a.label)}${FLECHE}${nu(b.label)}`);
  } else if (touche('formuleId') && String(a.formuleId || '') !== String(b.formuleId || '') && (a.formuleId || b.formuleId)) {
    contenu.push('Formule changée');
  }
  if (touche('program')) contenu.push(...phrasesDuProgramme(a.program, b.program));
  if (touche('extras')) contenu.push(...phrasesDesExtras(a.extras, b.extras));

  // Le prix : la trace que le serveur ecrit avec un prix ajuste (type « prix »,
  // lib/database.js notesAvecPrix) porte la raison ; sinon les deux montants.
  const tracePrix = touche('notes') ? notesNouvelles(a.notes, b.notes).filter((note) => note.type === 'prix' && note.prix).pop() : null;
  if (tracePrix) {
    const raison = texte(tracePrix.prix.raison, 80);
    contenu.push(`Prix ${montant(tracePrix.prix.de)}${FLECHE}${montant(tracePrix.prix.a)}${raison ? `, ${raison}` : ''}`);
  } else if (touche('price') && centimes(a.price) !== centimes(b.price) && (present(a, 'price') && present(b, 'price'))) {
    contenu.push(`Prix ${montant(a.price)}${FLECHE}${montant(b.price)}`);
  }
  if (touche('companions') && (Number(a.companions) || 0) !== (Number(b.companions) || 0)) {
    contenu.push(`${Number(a.companions) || 0}${FLECHE}${Number(b.companions) || 0} accompagnant${(Number(b.companions) || 0) > 1 ? 's' : ''}`);
  }
  if (touche('occasion') && texte(a.occasion) !== texte(b.occasion)) {
    contenu.push(texte(b.occasion) ? `Occasion : ${texte(b.occasion, 60)}` : 'Occasion retirée');
  }
  if (touche('name') && texte(a.name) && texte(b.name) && texte(a.name) !== texte(b.name)) {
    contenu.push(`Nom ${texte(a.name, 50)}${FLECHE}${texte(b.name, 50)}`);
  }
  if (touche('phone') && texte(a.phone) !== texte(b.phone) && present(a, 'phone') && present(b, 'phone')) contenu.push('Téléphone modifié');
  if (touche('email') && texte(a.email) !== texte(b.email) && present(a, 'email') && present(b, 'email')) contenu.push('E-mail modifié');
  if (touche('lanes') && present(a, 'lanes') && present(b, 'lanes')) {
    const pa = pistes(a.lanes);
    const pb = pistes(b.lanes);
    if (pa.join(',') !== pb.join(',') && (pa.length || pb.length)) {
      contenu.push(`Piste${pa.length > 1 || pb.length > 1 ? 's' : ''} ${pa.length ? liste(pa) : 'aucune'}${FLECHE}${pb.length ? liste(pb) : 'aucune'}`);
    }
  }

  if (touche('status') && STATUTS[b.status] && a.status !== b.status) {
    const moyen = b.status === 'paid' && texte(b.paymentMethod) ? ` · ${texte(b.paymentMethod, 30)}` : '';
    suivi.push(STATUTS[a.status] ? `Statut ${STATUTS[a.status]}${FLECHE}${STATUTS[b.status]}${moyen}` : `Statut : ${STATUTS[b.status]}${moyen}`);
  } else if (touche('paymentMethod') && texte(b.paymentMethod) && texte(a.paymentMethod) !== texte(b.paymentMethod)) {
    suivi.push(`Paiement : ${texte(b.paymentMethod, 30)}`);
  }
  if (touche('validationStatus') && a.validationStatus !== b.validationStatus) {
    if (b.validationStatus === 'confirmed' && a.validationStatus) suivi.push('Demande validée');
    else if (b.validationStatus === 'rejected') suivi.push('Demande refusée');
  }
  if (touche('notes')) {
    const avantNotes = notesEquipe(a.notes);
    const apresNotes = notesEquipe(b.notes);
    const parCle = new Map(avantNotes.filter((note) => note.le).map((note) => [note.le, note]));
    const restantes = new Set(apresNotes.map((note) => note.le));
    apresNotes.forEach((note) => {
      const ancienne = parCle.get(note.le);
      // Le prix et le compte a l arrivee se disent deja plus haut.
      if (note.type === 'prix' || note.compte) return;
      if (!ancienne) suivi.push(`Note : « ${texte(note.t, 90)} »`);
      else if (texte(ancienne.t) !== texte(note.t)) suivi.push(`Note modifiée : « ${texte(note.t, 90)} »`);
    });
    avantNotes.filter((note) => note.le && !restantes.has(note.le)).forEach((note) => suivi.push(`Note retirée : « ${texte(note.t, 90)} »`));
    if (present(a, 'notes') && present(b, 'notes') && motDuClient(a.notes) !== motDuClient(b.notes)) suivi.push('Mot du client modifié');
  }
  if (touche('activityProgress')) {
    const faites = (suiviActivites) => new Set(Object.keys(suiviActivites && typeof suiviActivites === 'object' ? suiviActivites : {}).filter((cle) => suiviActivites[cle] && suiviActivites[cle].done));
    const fa = faites(a.activityProgress);
    const fb = faites(b.activityProgress);
    const cochees = [...fb].filter((cle) => !fa.has(cle)).length;
    const decochees = [...fa].filter((cle) => !fb.has(cle)).length;
    if (cochees) suivi.push(cochees > 1 ? `${cochees} activités cochées` : 'Activité cochée');
    if (decochees) suivi.push(decochees > 1 ? `${decochees} activités décochées` : 'Activité décochée');
  }
  const propres = (phrases) => [...new Set(phrases.map((phrase) => texte(phrase)).filter(Boolean))];
  return { contenu: propres(contenu), suivi: propres(suivi) };
}

// « Laser Game déplacé à 15:30 » : le deplacement d une activite seule
// (activityMove, api/staff-reservations.js), que les champs du dossier ne disent
// pas toujours (le plan bouge, l heure du dossier non).
function phraseDeDeplacement(deplacement) {
  if (!deplacement || typeof deplacement !== 'object') return '';
  const nom = deplacement.activityId === 'bowling' ? 'Bowling' : deplacement.activityId === 'laser_game' ? 'Laser Game' : 'Activité';
  if (deplacement.unplace === true) return `${nom} : partie retirée du planning`;
  const a = heure(deplacement.startTime);
  const voies = pistes(deplacement.lanes);
  return a ? `${nom} déplacé à ${a}${voies.length ? `, piste${voies.length > 1 ? 's' : ''} ${liste(voies)}` : ''}` : `${nom} déplacé`;
}

// ---------------------------------------------------------------------------
// LA DERNIERE MODIFICATION, ECRITE AVEC LE DOSSIER.
// ---------------------------------------------------------------------------
// { le, par, quoi } : quand, qui (le nom de la session, jamais un nom recu du
// corps), et ce qui se vend qui a change. null quand rien de vendu ne change
// (une note, un statut, une coche) : la derniere modification reste celle d avant.
function derniereModifDu(avant, apres, { par = '', maintenant = new Date(), deplacement = null } = {}) {
  const quoi = phrasesDuChangement(avant, apres).contenu;
  const bouge = phraseDeDeplacement(deplacement);
  if (bouge && !quoi.some((phrase) => phrase.startsWith('Heure '))) quoi.unshift(bouge);
  if (!quoi.length) return null;
  return {
    le: maintenant.toISOString(),
    par: texte(par, 80) || 'Équipe',
    quoi: quoi.slice(0, QUOI_MAX),
  };
}

// La derniere modification que porte un plan, ou null.
function derniereModifDe(plan) {
  const d = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan.derniereModif : null;
  return d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.quoi) ? d : null;
}

// Le plan avec CETTE derniere modification, et aucune autre : celle qu un corps
// apporterait dans son opsPlan (la console renvoie le dossier entier) ne
// s ecrit jamais. Sans plan, rien ne se cree : un dossier sans plan ne recoit
// pas un plan vide qui ferait croire qu il est place.
function avecDerniereModif(plan, derniere) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return plan;
  const actuelle = present(plan, 'derniereModif') ? plan.derniereModif : undefined;
  if (derniere ? JSON.stringify(actuelle) === JSON.stringify(derniere) : actuelle === undefined) return plan;
  const { derniereModif, ...reste } = plan;
  return derniere ? { ...reste, derniereModif: derniere } : reste;
}

// ---------------------------------------------------------------------------
// L HISTORIQUE, LU DANS LE JOURNAL.
// ---------------------------------------------------------------------------
// L avant/apres d une ligne du journal en deux morceaux de dossier. Les actions
// qui deplacent plusieurs dossiers (un retard en cascade, api/ops.js) prefixent
// chaque champ par l id du dossier : on ne garde que ceux de celui-ci.
function etatsDuJournal(changes, reservationId) {
  const avant = {};
  const apres = {};
  const prefixe = `${reservationId}.`;
  Object.entries(changes && typeof changes === 'object' ? changes : {}).forEach(([cle, valeur]) => {
    if (!valeur || typeof valeur !== 'object' || (!present(valeur, 'before') && !present(valeur, 'after'))) return;
    let champ = cle;
    if (cle.startsWith(prefixe)) champ = cle.slice(prefixe.length);
    else if (/^\d+\./.test(cle)) return;
    avant[champ] = valeur.before;
    apres[champ] = valeur.after;
  });
  return { avant, apres };
}

function auteurDuJournal(ligne) {
  const nom = texte(ligne.actorLabel, 80);
  if (nom) return nom;
  if (ligne.actorKind === 'public') return 'Client en ligne';
  if (ligne.actorKind === 'staff') return 'Équipe';
  return 'Pinlane';
}

function quoiDuJournal(ligne, reservationId) {
  const contexte = ligne.context && typeof ligne.context === 'object' ? ligne.context : {};
  const { avant, apres } = etatsDuJournal(ligne.changes, reservationId);
  const { contenu, suivi } = phrasesDuChangement(avant, apres);
  const action = String(ligne.action || '');
  if (action === 'createReservation') {
    const canal = String(contexte.canal || apres.channel || '').toLowerCase();
    return [`${canal === 'public' ? 'Réservé en ligne' : 'Dossier créé au comptoir'}${contexte.aPlacer ? ', à placer' : ''}`];
  }
  if (action === 'restoreReservation') return ['Dossier restauré'];
  if (action === 'noterEncaisse') {
    const e = contexte.encaisse && typeof contexte.encaisse === 'object' ? contexte.encaisse : null;
    if (!e) return ['Montant encaissé noté'];
    if (centimes(e.montant) === centimes(e.prix)) return [`Encaissé ${montant(e.montant)}, le prix du dossier`];
    const raison = texte(e.raison, 80);
    return [`Encaissé ${montant(e.montant)} au lieu de ${montant(e.prix)}${raison ? `, ${raison}` : ''}`];
  }
  if (action === 'noterAbsence') {
    if (contexte.absent === true) return ['Noté absent'];
    if (contexte.absent === false) return ['Absence retirée'];
    return ['Absence mise à jour'];
  }
  const debut = [];
  if (action === 'moveReservationActivity') debut.push(phraseDeDeplacement(contexte.activityMove));
  if (action === 'delayApply') debut.push(`Retard de ${Math.round(Number(contexte.delayMinutes) || 0)} min appliqué`);
  if (action === 'delayClear') debut.push('Indicateur de retard retiré');
  if (action === 'delayRevert') debut.push('Retard retiré, heure d’origine');
  return [...debut.filter(Boolean), ...contenu, ...suivi];
}

function entreeDuJournal(ligne, reservationId) {
  const quoi = [...new Set(quoiDuJournal(ligne, reservationId).map((phrase) => texte(phrase)).filter(Boolean))];
  if (!quoi.length) return null;
  const quand = ligne.occurredAt instanceof Date ? ligne.occurredAt.toISOString() : String(ligne.occurredAt || '');
  return { le: quand, par: auteurDuJournal(ligne), quoi: quoi.slice(0, ENTREE_QUOI_MAX) };
}

// L historique d UN dossier d UN centre, du plus recent au plus ancien. Le
// centre est celui que la session a le droit de lire, jamais 'all' ni vide
// (readAuditLog ne filtre plus rien avec 'all') ; chaque ligne rendue est
// relue contre lui : meme un predicat SQL faux ne laisserait rien passer d un
// autre centre, d un autre dossier, ni une tentative refusee.
// Ce que le fondateur a fait sur le dossier ne se lit que par lui (2026-11-13,
// lib/fondateur-invisible.js) : `avecFondateur` vient de sa session, jamais
// d une requete.
async function lireHistoriqueDossier({ centerId, reservationId, limite = HISTORIQUE_LIMITE, avecFondateur = false } = {}) {
  const centre = String(centerId || '').trim();
  const id = String(reservationId || '').trim();
  if (!centre || centre === 'all' || !/^\d+$/.test(id)) {
    throw Object.assign(new Error('Historique : centre et dossier requis.'), { statusCode: 422, expose: true });
  }
  const { readAuditLog } = require('./audit-log');
  const { estMembreFondateur } = require('./fondateur-invisible');
  const lignes = await readAuditLog({ centerId: centre, entityType: 'reservation', entityId: id, outcome: 'success', limit: Math.min(Math.max(Number(limite) || HISTORIQUE_LIMITE, 1), HISTORIQUE_LIMITE), avecFondateur: avecFondateur === true });
  return lignes
    .filter((ligne) => ligne && ligne.centerId === centre && String(ligne.entityId) === id && ligne.entityType === 'reservation' && ligne.outcome === 'success')
    .filter((ligne) => avecFondateur === true || !estMembreFondateur(ligne.actorMemberId))
    .map((ligne) => entreeDuJournal(ligne, id))
    .filter(Boolean);
}

module.exports = {
  avecDerniereModif,
  derniereModifDe,
  derniereModifDu,
  entreeDuJournal,
  lireHistoriqueDossier,
  phraseDeDeplacement,
  phrasesDuChangement,
};

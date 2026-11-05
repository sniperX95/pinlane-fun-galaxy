'use strict';
// LES DROITS A NIVEAUX AUX PORTES D ECRITURE (2026-11-03, Movsar : « gestion de
// qui peut le faire a quel niveau »).
//
// Les cinq reglages d un role (lib/staff-auth.js, DROITS_NIVEAUX) ne valent que
// s ils tombent ici, cote serveur : un ecran cache un bouton, il ne refuse rien.
// Toutes les portes staff qui ecrivent price, extras, label, program ou notes
// passent par ces fonctions : la creation seule, le lot (creerDepuisLaFenetre,
// lib/reserver-fenetre.js, passage oblige avant createReservation) et le PATCH
// (api/staff-reservations.js). Aucune d elles ne lit un droit dans le corps :
// le niveau vient de la session, relue en base a chaque requete.
//
// Un refus suit le contrat du fichier : statut, message simple, `code` stable
// (sendError le transmet), jamais un 500.

const { niveauEffectif, sessionHasPermission } = require('./staff-auth');
const { catalogueSurMesure, surMesureChoisissable } = require('./center-config');
const { tarifDeReference, totalExtrasComptoir } = require('./reservation-request');
const { getBowlingGameOptions } = require('./booking-config');
const { getCenter, getFormula } = require('./ops-knowledge');
const { formuleDuDossier } = require('./formula-choice');

const PRIX_MAX = 100000;
// La marge de la console (getReservationPriceState, assets/app-main.js) : sous
// 50 centimes, un prix n est pas « ajusté ».
const TOLERANCE_CENTIMES = 50;
const LIBELLE_ADAPTE = /\(adapt[ée]e\)/i;
// La table et le service ne sont pas des activites vendables : ils suivent la
// formule (ETAPES_NON_EDITABLES, lib/reservation-ops.js).
const ETAPES_DE_SERVICE = new Set(['party_table', 'service_drinks']);

function refus(code, message, statusCode = 403) {
  return Object.assign(new Error(message), { code, statusCode, expose: true, droit: true });
}

function estRefusDeDroit(error) {
  return Boolean(error && error.droit === true);
}

function nomDeSession(session) {
  const membre = session && session.member ? session.member : null;
  const nom = String((membre && (membre.name || membre.displayName)) || '').replace(/[<>]/g, '').trim();
  return (nom || 'Équipe').slice(0, 80);
}

const centimes = (valeur) => Math.round((Number(valeur) || 0) * 100);
const euros = (valeurCentimes) => valeurCentimes / 100;

// ---------------------------------------------------------------------------
// LE SUR MESURE.
// ---------------------------------------------------------------------------
function comparable(texte) {
  return String(texte ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, '\'').toLowerCase().replace(/\s+/g, ' ').trim();
}

// « Pizza × 6 » : le nom et la quantite, tels que la console les ecrit.
function nomEtQuantite(nom) {
  const texte = String(nom ?? '').trim();
  const lu = /^(.+?)\s+[×x]\s*(\d{1,4})$/i.exec(texte);
  return lu ? { nom: lu[1].trim(), qte: Number(lu[2]) } : { nom: texte, qte: 0 };
}

// Une ligne se reconnait a ce qui se facture : son nom et son prix. La console
// refait ses identifiants (`nourriture-1`) a chaque ouverture de Modifier.
const cleDeLigne = (ligne) => `${comparable(ligne && ligne.name)}|${centimes(ligne && ligne.price)}`;

// `choisissables` : surMesureChoisissable, les articles actifs des categories
// ouvertes.
function articleDeLaLigne(ligne, choisissables) {
  const id = String(ligne.articleId ?? '').trim();
  if (id) return choisissables.find((article) => article.id === id) || null;
  const nom = comparable(nomEtQuantite(ligne.name).nom);
  return nom ? choisissables.find((article) => comparable(article.nom) === nom) || null : null;
}

// La quantite : celle envoyee, sinon celle du libelle (« Pizza × 6 »), sinon le
// groupe pour un article par joueur. Hors de 1 a EXTRA_QTE_MAX, null : la ligne
// est refusee, jamais une quantite devinee.
function quantiteDeLaLigne(ligne, article, pax) {
  const { EXTRA_QTE_MAX } = require('./database');
  const envoyee = ligne.qte === undefined || ligne.qte === null || ligne.qte === ''
    ? nomEtQuantite(ligne.name).qte || null
    : Number(ligne.qte);
  if (envoyee === null) return article.unite === 'joueur' ? Math.max(1, Math.trunc(Number(pax)) || 1) : 1;
  return Number.isInteger(envoyee) && envoyee >= 1 && envoyee <= EXTRA_QTE_MAX ? envoyee : null;
}

// Le catalogue calcule : price = qte × prixUnitaire. A 0 l article veut dire
// « prix a saisir » : le prix tape reste, sans jamais passer sous zero.
function ligneDuCatalogue(ligne, article, { qte, par, le }) {
  const saisi = Number(ligne.prixUnitaire);
  const prixUnitaire = article.prix > 0
    ? article.prix
    : Number.isFinite(saisi) && saisi >= 0 ? saisi : euros(Math.round(centimes(ligne.price) / qte));
  return {
    ...(ligne.heure ? { heure: ligne.heure } : {}),
    ...(ligne.note ? { note: ligne.note } : {}),
    id: String(ligne.id || article.id),
    name: `${article.nom} × ${qte}`,
    price: euros(Math.round(prixUnitaire * qte * 100)),
    articleId: article.id,
    categorie: article.categorie,
    qte,
    prixUnitaire,
    par,
    le,
  };
}

// Juge les lignes qu un corps apporte. Une ligne deja en base passe telle
// quelle, son auteur compris : seules les nouvelles et les changees comptent, et
// a la creation elles le sont toutes. Ne leve jamais : la simulation doit
// montrer le meme prix que la creation (`refus` se leve a l ecriture).
function resoudreExtras({ extras, avant = [], session, centerId, pax, maintenant = new Date() }) {
  const niveau = niveauEffectif(session, 'surmesure');
  const prixLibre = niveauEffectif(session, 'prix') === 'libre';
  const enBase = new Map();
  avant.forEach((ligne) => {
    const cle = cleDeLigne(ligne);
    enBase.set(cle, [...(enBase.get(cle) || []), ligne]);
  });
  const par = nomDeSession(session);
  const le = maintenant.toISOString();
  let catalogue = null;
  let premierRefus = null;
  const noter = (erreur) => { premierRefus = premierRefus || erreur; };
  const lignes = (Array.isArray(extras) ? extras : []).filter((ligne) => ligne && typeof ligne === 'object').map((ligne) => {
    const deja = enBase.get(cleDeLigne(ligne));
    if (deja && deja.length) {
      const stockee = deja.shift();
      return { ...stockee, ...(ligne.heure !== undefined ? { heure: ligne.heure } : {}), ...(ligne.note !== undefined ? { note: ligne.note } : {}) };
    }
    const prix = Number(ligne.price ?? 0);
    const nom = nomEtQuantite(ligne.name).nom || 'Cette ligne';
    if (!Number.isFinite(prix) || Math.abs(prix) > PRIX_MAX) {
      noter(refus('prix_invalide', `Prix invalide pour « ${nom} » : entre -100 000 et 100 000 €.`, 422));
      return ligne;
    }
    if (prix < 0 && !(niveau === 'libre' && prixLibre)) {
      noter(refus('sur_mesure_negatif', `« ${nom} » : une ligne négative demande le sur mesure libre et le prix sans limite.`));
      return ligne;
    }
    if (niveau === 'non') {
      noter(refus('sur_mesure_refuse', 'Votre rôle ne permet pas d’ajouter du sur mesure à un dossier.'));
      return ligne;
    }
    if (niveau === 'catalogue') {
      catalogue = catalogue || surMesureChoisissable(catalogueSurMesure(centerId));
      const article = articleDeLaLigne(ligne, catalogue.articles);
      if (!article) {
        noter(refus('sur_mesure_hors_catalogue', `« ${nom} » n’est pas dans le catalogue du centre. Choisissez un article proposé.`));
        return ligne;
      }
      const qte = quantiteDeLaLigne(ligne, article, pax);
      if (qte === null) {
        noter(refus('quantite_invalide', `Quantité invalide pour « ${article.nom} » : de 1 à ${require('./database').EXTRA_QTE_MAX}.`, 422));
        return ligne;
      }
      const resolue = ligneDuCatalogue(ligne, article, { qte, par, le });
      if (Math.abs(resolue.price) > PRIX_MAX) {
        noter(refus('prix_invalide', `Prix invalide pour « ${article.nom} » : 100 000 € au plus.`, 422));
        return ligne;
      }
      return resolue;
    }
    const { articleId, categorie, qte, prixUnitaire, heure, note } = ligne;
    return { articleId, categorie, qte, prixUnitaire, heure, note, id: ligne.id, name: ligne.name, price: prix, par, le };
  });
  return { extras: lignes, refus: premierRefus };
}

// ---------------------------------------------------------------------------
// LE PRIX.
// ---------------------------------------------------------------------------
// Reference = base + extras, jamais sous zero. Rend ce que le serveur doit
// ecrire comme trace, ou leve. `reference` nulle : seul « libre » passe, un
// pourcentage de rien ne veut rien dire.
function jugerEcart({ session, prix, reference, raison }) {
  const ecart = Math.abs(centimes(prix) - centimes(reference));
  const niveau = niveauEffectif(session, 'prix');
  if (niveau === 'non') throw refus('prix_niveau_insuffisant', 'Votre rôle ne permet pas d’ajuster un prix.');
  if (niveau !== 'libre') {
    const pourcent = Number(niveau);
    if (centimes(reference) <= 0) throw refus('prix_niveau_insuffisant', 'Sans prix de référence, seul le niveau « Sans limite » peut fixer ce prix.');
    if (ecart * 100 > pourcent * centimes(reference)) {
      throw refus('prix_niveau_insuffisant', `Votre rôle permet d’ajuster un prix de ${pourcent} % au plus : ${euros(Math.floor(centimes(reference) * pourcent / 100))} € sur ce dossier.`);
    }
  }
  const motif = String(raison ?? '').trim();
  if (!motif) throw refus('prix_raison_requise', 'Indiquez la raison de ce prix.', 422);
  return motif;
}

// LE PRIX D UNE CREATION. Le dossier sort du moteur : sa base est celle du
// serveur (planifierPourLaFenetre retire celle du corps). Un prix qui colle a la
// reference ne demande rien.
function jugerPrixDeCreation({ session, dossier, raison }) {
  const prix = Number(dossier.price) || 0;
  if (prix > PRIX_MAX) throw refus('prix_invalide', 'Prix invalide : entre 0 et 100 000 €.', 422);
  const reference = Math.max(0, euros(centimes(dossier.basePrice) + centimes(totalExtrasComptoir(dossier.extras))));
  if (Math.abs(centimes(prix) - centimes(reference)) <= TOLERANCE_CENTIMES) return null;
  const motif = jugerEcart({ session, prix, reference, raison });
  return { de: reference, a: prix, raison: motif, par: nomDeSession(session) };
}

// LA REFERENCE D UNE MODIFICATION. Celle du corps n est jamais crue : elle ne
// sert au moteur qu a reconnaitre un prix saisi. Le moteur en donne une juste
// pour un programme et pour un plan de pistes, sauf un bowling vendu aux parties,
// ou il reprend celle qu on lui a passee.
function baseDuServeur({ current, demande, ops, contenuChange, jourChange, memesPistes = true }) {
  // Rien de ce qui se vend n a bouge, le meme jour, sur autant de pistes : le dossier garde
  // sa reference, meme si un tarif a ete publie depuis. Sinon une heure deplacee se lisait
  // « prix ajusté », et cet ecart fantome restait au prochain changement de contenu
  // (prixQuiSuit).
  const tarifGarde = !contenuChange && !jourChange && memesPistes && Number(current.basePrice) > 0;
  const donnee = tarifGarde ? Number(current.basePrice) : Number(ops.basePrice);
  if (ops.basePrice !== undefined && ops.basePrice !== null && Number.isFinite(donnee)) {
    if (ops.program) return donnee;
    const auxParties = demande.type === 'bowling'
      && getBowlingGameOptions(getCenter(demande.centerId).resources.bowling, demande.date, { pax: demande.pax, laneCount: ops.laneCount ?? demande.laneCount }) !== null;
    if (!auxParties) return donnee;
  }
  if (!contenuChange && !jourChange) return Number(current.basePrice) || 0;
  const tarif = tarifDeReference({ ...demande, ...(ops.laneCount != null ? { laneCount: ops.laneCount } : {}) });
  return tarif > 0 ? tarif : Number(current.basePrice) || 0;
}

// LE PRIX D UNE MODIFICATION. Un dossier dont rien ne bouge n est pas juge, et un
// ajustement deja en place se garde : ajouter un cafe a un prix d ami ne redemande
// rien. Rend la trace a ecrire, ou null.
function jugerPrixDeModification({ session, current, prix, base, extras, contenuChange, raison }) {
  const prixAvant = Number(current.price) || 0;
  const prixInchange = centimes(prix) === centimes(prixAvant);
  if (!contenuChange && prixInchange) return null;
  const reference = Math.max(0, euros(centimes(base) + centimes(totalExtrasComptoir(extras))));
  const ecart = centimes(prix) - centimes(reference);
  if (Math.abs(ecart) <= TOLERANCE_CENTIMES) return null;
  const ecartAvant = centimes(prixAvant) - centimes(Number(current.basePrice) || 0) - centimes(totalExtrasComptoir(current.extras));
  if (Math.abs(ecart - ecartAvant) <= TOLERANCE_CENTIMES) return null;
  const motif = jugerEcart({ session, prix, reference, raison });
  return { de: prixInchange ? reference : prixAvant, a: Number(prix) || 0, raison: motif, par: nomDeSession(session) };
}

// LE PRIX QUI SUIT LE CONTENU (2026-11-03). Le comptoir change les joueurs, une
// activite ou la formule sans taper de prix : la console n envoie ni prix ni
// raison, et le prix se pose ici, sur la reference du serveur. L estimation de
// l ecran ne tombait pas toujours pile sur la base du moteur (une activite que
// la console chiffre et pas le serveur : 258 EUR contre 168 pour une visite de
// 9) : l ecart s ecrivait en « Prix revu au comptoir », et un role plafonne
// etait refuse sans avoir touche a un prix. L ajustement deja en place (un prix
// d ami) se garde, comme jugerPrixDeModification le garde. Sans base ecrite
// avant, rien ne dit ce qui etait ajuste : le nouveau tarif. Sans reference
// apres (rien de chiffre), le prix du dossier plus ce que ses extras ont bouge,
// comme la console (prixSuiviEdition). Jamais sous zero.
function prixQuiSuit({ current, base, extras }) {
  const reference = centimes(base);
  const extrasApres = centimes(totalExtrasComptoir(extras));
  const extrasAvant = centimes(totalExtrasComptoir(current.extras));
  const prixAvant = centimes(current.price);
  const baseAvant = centimes(current.basePrice);
  const pose = reference > 0
    ? reference + extrasApres + (baseAvant > 0 ? prixAvant - baseAvant - extrasAvant : 0)
    : prixAvant + extrasApres - extrasAvant;
  return euros(Math.max(0, pose));
}

// L ENCAISSE PLUS BAS QUE LE PRIX (2026-11-03). Noter 40 € encaisses sur un
// dossier a 60 €, c est baisser son prix par la porte voisine : sans ce garde,
// un role qui encaisse sans avoir le droit d ajuster un prix le faisait d un
// geste d accueil (noterEncaisseOuAbsence, lib/database.js). Il se juge donc
// comme un prix (jugerEcart) : le montant encaisse contre la reference du
// dossier, base + extras, au niveau de la session, raison exigee. Un dossier
// sans reference se mesure a son prix, celui qu un role « Sans limite » a fixe.
// Ce qui ne baisse rien passe sans niveau : le prix encaisse tel quel (a
// 50 centimes pres), un montant au-dessus (un supplement regle au comptoir), une
// correction qui revient au prix. Pinlane n encaisse rien en ligne : aucun
// acompte n est a deduire ici, et l absence ne touche pas au prix.
function jugerEncaisse({ session, current, encaissement }) {
  if (!encaissement || typeof encaissement !== 'object' || !current || current.status !== 'paid') return;
  const montant = Math.round(Number(encaissement.montant) * 100) / 100;
  // Un montant illisible ou hors bornes, la base le refuse avec sa phrase.
  if (!Number.isFinite(montant) || montant < 0 || montant > PRIX_MAX) return;
  const prix = Number(current.price) || 0;
  if (centimes(prix) - centimes(montant) <= TOLERANCE_CENTIMES) return;
  const reference = Math.max(0, euros(centimes(current.basePrice) + centimes(totalExtrasComptoir(current.extras))));
  try {
    jugerEcart({ session, prix: montant, reference: reference > 0 ? reference : prix, raison: encaissement.raison });
  } catch (error) {
    // Le niveau est juge avant la raison : sans raison, la base refuse avec la
    // phrase du formulaire (« Dites pourquoi le montant differe du prix »), la
    // meme qu au-dessus du prix, et rien ne s ecrit.
    if (error.code !== 'prix_raison_requise') throw error;
  }
}

// ---------------------------------------------------------------------------
// LA FORMULE ET LE PLACEMENT.
// ---------------------------------------------------------------------------
function exigerAdaptationDeFormule(session) {
  if (niveauEffectif(session, 'formule') !== 'oui') {
    throw refus('formule_niveau_insuffisant', 'Votre rôle ne permet pas d’adapter une formule.');
  }
}

function exigerForcer(session) {
  if (niveauEffectif(session, 'forcer') !== 'oui') {
    throw refus('forcer_refuse', 'Votre rôle ne permet pas de créer un dossier à placer. Choisissez une autre heure ou demandez à un responsable.');
  }
}

// MOINS DE PISTES QUE LE CENTRE N EN CONSEILLE (2026-11-05, Ansar : « pouvoir mettre sur une seul
// piste mm si ils sont plus que 6 et ttout manuellement si on le desire », dans le respect du
// droit par role). Le meme niveau que prendre une heure qui coince : c est passer outre une regle
// du centre, en le disant. Plus de pistes que le conseil reste ouvert a qui reserve.
function exigerPistesALaMain(session) {
  if (niveauEffectif(session, 'forcer') !== 'oui') {
    throw refus('pistes_a_la_main_refuse', 'Votre rôle ne permet pas de mettre plus de joueurs par piste que le centre n’en conseille. Demandez à un responsable.');
  }
}

// Le nombre de pistes pose a la main sur un plan enregistre, 0 sans lui.
function pistesALaMainDuPlan(plan) {
  const blocs = plan && Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  return blocs.reduce((max, bloc) => (bloc && bloc.resourceType === 'bowling_lane' ? Math.max(max, Number(bloc.pistesALaMain) || 0) : max), 0);
}

// L HISTORIQUE D UN DOSSIER : qui a fait quoi et quand, une lecture du journal
// que le niveau « historique » ouvre (lib/historique-dossier.js). Le refus tombe
// avant toute lecture de la base : il ne dit pas si le dossier existe.
function exigerHistorique(session) {
  if (niveauEffectif(session, 'historique') !== 'oui') {
    throw refus('historique_refuse', 'Votre rôle ne permet pas de voir l’historique d’un dossier.');
  }
}

function formatDuProgramme(ligne) {
  const id = String(ligne.id);
  return `${id}:${ligne.duree || ''}:${ligne.parties || ''}`;
}

// CE QUE LA FORMULE VEND : ses activites, la duree du bowling, les parties de
// laser. Les joueurs n en font pas partie : un groupe qui grandit fait suivre
// son programme sans l adapter.
function compositionDesLignes(items) {
  return items.filter((ligne) => ligne.id && !ETAPES_DE_SERVICE.has(ligne.id)).map(formatDuProgramme).sort().join('|');
}

function compositionDuProgramme(program) {
  const items = Array.isArray(program) ? program : (program && Array.isArray(program.items) ? program.items : null);
  if (!items || !items.length) return null;
  return compositionDesLignes(items.map((item) => {
    const id = String((item && (item.activityId || item.id)) || '');
    return {
      id,
      duree: id === 'bowling' ? Number(item.duration) || 0 : 0,
      parties: id === 'laser_game' ? Number((item.extraLaser && item.extraLaser.games) || item.games) || 0 : 0,
    };
  }));
}

function compositionDeLaFormule(dossier) {
  let formule = null;
  try {
    formule = formuleDuDossier(getFormula(dossier.formuleId, dossier.centerId), dossier);
  } catch (error) {
    formule = null;
  }
  if (!formule || !Array.isArray(formule.steps)) return null;
  return compositionDesLignes(formule.steps.map((step) => ({
    id: String(step.activityId || ''),
    duree: step.activityId === 'bowling' ? (Number(step.durationMinutes) || 0) / 60 : 0,
    parties: step.activityId === 'laser_game' ? Number(step.count) || 0 : 0,
  })));
}

// Le corps adapte-t-il la formule de ce dossier ? « (adaptée) » pose ou retire,
// ou un programme qui ne vend plus la meme chose.
function patchAdapteLaFormule(patch, current) {
  const libelleAvant = LIBELLE_ADAPTE.test(String(current.label || ''));
  if (Object.prototype.hasOwnProperty.call(patch, 'label') && LIBELLE_ADAPTE.test(String(patch.label || '')) !== libelleAvant) return true;
  const formuleAvant = String(current.formuleId || '');
  const formuleApres = String(patch.formuleId ?? patch.formulaId ?? formuleAvant);
  if (!formuleAvant && current.type !== 'formule' && !formuleApres) return false;
  const apres = compositionDuProgramme(patch.program);
  if (apres === null) return false;
  // Le programme se mesure a ce que vend la formule qu il pretend suivre : la
  // meme, ou la carte de l autre. Passer a une autre formule sans programme
  // n adapte rien, elle repart de sa carte.
  const avant = formuleApres && formuleApres !== formuleAvant
    ? compositionDeLaFormule({ ...current, formuleId: formuleApres, opsPlan: null })
    : compositionDuProgramme(current.program) ?? compositionDeLaFormule(current);
  return avant !== null && avant !== apres;
}

// Une creation qui adapte une formule : un programme sur une formule, ou le mot.
function corpsAdapteUneFormule(corps, formuleAdaptee) {
  return Boolean(formuleAdaptee) || LIBELLE_ADAPTE.test(String(corps.label || ''));
}

// ---------------------------------------------------------------------------
// LES NOTES.
// ---------------------------------------------------------------------------
// Sans reservations.edit, un PATCH ne fait qu ajouter a la fin. Le signataire de
// toute ligne d equipe nouvelle est la session, pour tout le monde.
function notesDuPatch({ notes, current, session }) {
  const { notesSeulementAjoutees, signerNotesEquipe } = require('./database');
  if (!sessionHasPermission(session, 'reservations.edit') && !notesSeulementAjoutees(notes, current.notes)) {
    throw refus('notes_ajout_seulement', 'Votre rôle permet d’ajouter une note, pas de modifier ou retirer celles du dossier.');
  }
  return signerNotesEquipe(notes, { avant: current.notes, par: nomDeSession(session) });
}

function exigerRetraitDeNote(session) {
  if (!sessionHasPermission(session, 'reservations.edit')) {
    throw refus('notes_ajout_seulement', 'Votre rôle permet d’ajouter une note, pas de modifier ou retirer celles du dossier.');
  }
}

module.exports = {
  baseDuServeur,
  corpsAdapteUneFormule,
  estRefusDeDroit,
  exigerAdaptationDeFormule,
  exigerForcer,
  exigerHistorique,
  exigerPistesALaMain,
  exigerRetraitDeNote,
  jugerEncaisse,
  jugerPrixDeCreation,
  jugerPrixDeModification,
  nomDeSession,
  notesDuPatch,
  patchAdapteLaFormule,
  pistesALaMainDuPlan,
  prixQuiSuit,
  refus,
  resoudreExtras,
};

'use strict';
// LE FONDATEUR NE LAISSE AUCUNE TRACE CHEZ UN CENTRE (Ansar, 2026-11-13).
//
// « sur tout Pinlane, moi role fondateur Pinlane, j ouvre quelque chose ou quoi, ca doit pas afficher que
// c est ouvert ou lu ou fait par fondateur Pinlane, moi personne doit me voir, mais les autres roles du
// centre oui ». Et le journal de l equipe, que la Direction lisait, est a lui seul.
//
// UNE SEULE REGLE, ICI, pour tout le serveur :
//   - estFondateur(session) : la permission de plateforme, portee par la session elle-meme (le role
//     verrouille d un centre ne la donne jamais, lib/staff-auth.js). La session de secours la porte
//     aussi : elle est le fondateur.
//   - une ligne DEJA ECRITE est du fondateur quand son membre contient « :platform-owner » (le membre
//     `<centre>:platform-owner`, et `<centre>:platform-owner-emergency` en secours) : MOTIF_SQL en base,
//     estMembreFondateur en JavaScript. Jamais le role seul, jamais le nom seul.
//   - les vieux champs qui ne gardent qu un NOM (`par`, `sentBy`...) se reconnaissent au nom actuel du
//     membre fondateur, lu en base (nomsDuFondateur), plus son nom de naissance.
//
// A L ECRITURE, la trace visible du centre ne porte pas son nom (signatureVisible rend '').
// A LA LECTURE, toute reponse faite a une session qui n est pas la sienne passe par masquerFondateur
// (requireStaffPermission pose la marque, sendJson l applique, comme les montants) : un appel direct a
// l API ne rend pas plus que la console. Rien ne s efface en base : le journal d audit garde tout, la
// securite en a besoin, et un nettoyage des vieilles lignes attend Ansar.
//
// Ce module ne charge rien a son chargement : lib/staff-auth.js et lib/http.js le lisent.

const PERMISSION_FONDATEUR = 'platform.admin';
const MARQUE_MEMBRE = ':platform-owner';
const MOTIF_SQL = '%:platform-owner%';
// Le nom que le seed donne au membre fondateur (lib/staff-auth.js, ensurePlatformOwnerAccess).
const NOMS_DE_NAISSANCE = ['Proprietaire plateforme'];
const NOTE_TAG = '[equipe] ';
const DUREE_DU_CACHE_MS = 5 * 60 * 1000;
const PROFONDEUR_MAX = 40;

// Les cles qui disent QUI a fait une chose : un nom, rarement un identifiant. `par` (notes, suivi, prix,
// derniere modification, ouvertures), `by` (coche d une activite), `qui`, les `...Par` et `...By` (modifiePar,
// basculePar, updatedBy, createdBy, editedBy, archivedBy, sentBy...), leurs formes en base, et les noms d un
// membre (memberName, actorLabel). `name` n y est pas : c est aussi le nom d un client.
const CLE_D_AUTEUR = /^(?:par|by|qui|auteur|signataire|staffMember|memberName|member_name|actorLabel|actor_label|[a-z]+(?:Par|By)|[a-z_]+_(?:par|by|par_nom))$/;
// Les cles qui portent l identite d un membre : un objet qui la porte EST une trace de cette personne
// (une lecture, une prise, une reponse, une ligne du journal, un membre de l equipe).
const CLES_D_IDENTITE = ['id', 'memberId', 'member_id', 'actorMemberId', 'actor_member_id'];
const CLES_DE_NOM_DE_MEMBRE = ['memberName', 'member_name'];

function sansAccents(texte) {
  return String(texte ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// La meme regle que sessionHasPermission(session, 'platform.admin') : une permission de plateforme doit
// etre portee par la session, le raccourci du role verrouille ne la donne jamais.
function estFondateur(session) {
  return Boolean(session && Array.isArray(session.permissions) && session.permissions.includes(PERMISSION_FONDATEUR));
}

function estMembreFondateur(memberId) {
  return String(memberId ?? '').includes(MARQUE_MEMBRE);
}

// ---------------------------------------------------------------------------
// LES NOMS DU FONDATEUR, pour les vieux champs qui ne gardent qu un nom.
// ---------------------------------------------------------------------------
let cache = { noms: null, expire: 0 };

function ensembleDeNoms(noms) {
  return new Set([...NOMS_DE_NAISSANCE, ...(Array.isArray(noms) ? noms : [])].map(sansAccents).filter((nom) => nom.length >= 3));
}

// Le nom actuel du membre fondateur dans chaque centre (le meme partout aujourd hui), lu en base au plus
// toutes les cinq minutes. FAIL-SOFT : une base qui ne repond pas laisse le nom de naissance, jamais un refus.
async function nomsDuFondateur() {
  if (cache.noms && cache.expire > Date.now()) return cache.noms;
  let lus = [];
  try {
    const { getPool } = require('./database');
    const result = await getPool().query('select distinct name from staff_members where id like $1;', [MOTIF_SQL]);
    lus = (result && Array.isArray(result.rows) ? result.rows : []).map((row) => row && row.name).filter(Boolean);
  } catch (error) {
    lus = [];
  }
  cache = { noms: ensembleDeNoms(lus), expire: Date.now() + DUREE_DU_CACHE_MS };
  return cache.noms;
}

function oublierLesNoms() {
  cache = { noms: null, expire: 0 };
}

function lesNoms(noms) {
  return noms instanceof Set ? noms : ensembleDeNoms(noms);
}

function estNomDuFondateur(nom, noms) {
  const lu = sansAccents(nom);
  return Boolean(lu) && lesNoms(noms).has(lu);
}

// Une valeur qui designe le fondateur : son identifiant de membre (seul ou dans « id nom »), ou son nom.
function estTraceDuFondateur(valeur, noms) {
  if (typeof valeur !== 'string' || !valeur) return false;
  return valeur.includes(MARQUE_MEMBRE) || estNomDuFondateur(valeur, noms);
}

// ---------------------------------------------------------------------------
// A L ECRITURE : la signature d une trace visible du centre.
// ---------------------------------------------------------------------------
// Le nom du membre de session, et RIEN pour le fondateur : la note, le suivi, le prix ajuste ou la reponse
// sont alors signes par personne, et les rendus disent « l'équipe ». `repli` ne vaut que pour un membre
// sans nom : le fondateur ne recoit jamais un libelle a la place du sien.
function signatureVisible(session, { repli = '', avecId = true } = {}) {
  if (estFondateur(session)) return '';
  const membre = session && session.member && typeof session.member === 'object' ? session.member : {};
  return String(membre.name || membre.displayName || (avecId ? membre.id : '') || repli || '');
}

// ---------------------------------------------------------------------------
// A LA LECTURE : une reponse faite a une session du centre.
// ---------------------------------------------------------------------------
// Les notes d equipe vivent dans le texte du dossier, une ligne `[equipe] {json}` chacune : leur auteur et
// celui de leur derniere modification partent, le reste de la ligne ne bouge pas (sa cle `le` comprise, qui
// sert a la retirer ou a la modifier).
function notesSansFondateur(texte, noms) {
  if (typeof texte !== 'string' || !texte.includes(NOTE_TAG)) return texte;
  return texte.split('\n').map((ligne) => {
    const brute = ligne.trimStart();
    if (!brute.startsWith(NOTE_TAG)) return ligne;
    let note;
    try { note = JSON.parse(brute.slice(NOTE_TAG.length)); } catch (error) { return ligne; }
    if (!note || typeof note !== 'object' || Array.isArray(note)) return ligne;
    let touchee = false;
    for (const cle of ['par', 'modifiePar']) {
      if (estTraceDuFondateur(note[cle], noms)) { note[cle] = ''; touchee = true; }
    }
    return touchee ? `${ligne.slice(0, ligne.length - brute.length)}${NOTE_TAG}${JSON.stringify(note)}` : ligne;
  }).join('\n');
}

// Un objet qui est une trace de la personne du fondateur : son identifiant, ou son nom de membre.
function estPersonneDuFondateur(objet, noms) {
  if (!objet || typeof objet !== 'object' || Array.isArray(objet)) return false;
  if (CLES_D_IDENTITE.some((cle) => typeof objet[cle] === 'string' && estMembreFondateur(objet[cle]))) return true;
  return CLES_DE_NOM_DE_MEMBRE.some((cle) => typeof objet[cle] === 'string' && estNomDuFondateur(objet[cle], noms));
}

function estObjetSimple(valeur) {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return false;
  if (valeur instanceof Date || Buffer.isBuffer(valeur)) return false;
  const proto = Object.getPrototypeOf(valeur);
  return proto === Object.prototype || proto === null;
}

// Une copie de la valeur sans aucune trace du fondateur :
//   - une trace de sa personne (lecture, prise, reponse, ligne du journal, membre) sort d une liste, et
//     vaut null hors d une liste ;
//   - son nom ou son identifiant sous une cle d auteur devient vide ;
//   - son identifiant, ou qu il soit, devient vide ;
//   - les notes d equipe perdent sa signature.
// Profondeur bornee, comme sansMontants : une reponse n a pas 40 niveaux.
function masquerFondateur(valeur, noms, profondeur = 0, cle = '') {
  const ensemble = lesNoms(noms);
  if (profondeur > PROFONDEUR_MAX) return valeur;
  if (typeof valeur === 'string') {
    if (valeur.includes(MARQUE_MEMBRE)) return '';
    if (CLE_D_AUTEUR.test(cle) && estNomDuFondateur(valeur, ensemble)) return '';
    return valeur.includes(NOTE_TAG) ? notesSansFondateur(valeur, ensemble) : valeur;
  }
  if (Array.isArray(valeur)) {
    return valeur
      .filter((element) => !estPersonneDuFondateur(element, ensemble))
      .map((element) => masquerFondateur(element, ensemble, profondeur + 1, cle));
  }
  if (!estObjetSimple(valeur)) return valeur;
  if (estPersonneDuFondateur(valeur, ensemble)) return null;
  const copie = {};
  for (const [nom, contenu] of Object.entries(valeur)) {
    copie[nom] = typeof contenu === 'function' ? contenu : masquerFondateur(contenu, ensemble, profondeur + 1, nom);
  }
  // Un tableau compact (l assistant : `colonnes` nomme, `lignes` aligne les valeurs) : la colonne porte la
  // cle que la ligne n a plus.
  if (Array.isArray(copie.colonnes) && Array.isArray(copie.lignes) && copie.colonnes.every((c) => typeof c === 'string')) {
    copie.lignes = copie.lignes.map((ligne) => (Array.isArray(ligne)
      ? ligne.map((v, i) => (CLE_D_AUTEUR.test(copie.colonnes[i] || '') && estTraceDuFondateur(v, ensemble) ? '' : v))
      : ligne));
  }
  return copie;
}

// La valeur telle qu une session doit la lire : entiere pour le fondateur, sans lui pour toute autre.
async function pourLaSession(session, valeur) {
  if (estFondateur(session)) return valeur;
  return masquerFondateur(valeur, await nomsDuFondateur());
}

// ---------------------------------------------------------------------------
// LE CHEMIN DU RETOUR : ce qu une session du centre renvoie.
// ---------------------------------------------------------------------------
// La console renvoie les notes du dossier entieres. Une note du fondateur lui est arrivee sans signature :
// telle quelle, le serveur la croirait nouvelle et la signerait du nom de l employe, ou refuserait le geste
// d un role qui ne fait qu ajouter. Chaque ligne qui est, mot pour mot, la version masquee d une ligne en
// base redevient la ligne en base. Une ligne vraiment changee reste ce qu elle est.
function notesRendues(notesRecues, notesEnBase, noms) {
  if (typeof notesRecues !== 'string' || typeof notesEnBase !== 'string' || !notesEnBase.includes(NOTE_TAG)) return notesRecues;
  const ensemble = lesNoms(noms);
  const originales = new Map();
  notesEnBase.split('\n').forEach((ligne) => {
    const propre = ligne.trimEnd();
    const masquee = notesSansFondateur(propre, ensemble);
    if (masquee !== propre && !originales.has(masquee)) originales.set(masquee, propre);
  });
  if (!originales.size) return notesRecues;
  return notesRecues.replace(/\r\n?/g, '\n').split('\n').map((ligne) => originales.get(ligne.trimEnd()) || ligne).join('\n');
}

// La coche d une activite garde son auteur en base quand la console la renvoie sans lui, inchangee.
function suiviRendu(suiviRecu, suiviEnBase, noms) {
  if (!suiviRecu || typeof suiviRecu !== 'object' || Array.isArray(suiviRecu)) return suiviRecu;
  if (!suiviEnBase || typeof suiviEnBase !== 'object' || Array.isArray(suiviEnBase)) return suiviRecu;
  const ensemble = lesNoms(noms);
  const rendu = { ...suiviRecu };
  for (const [cle, entree] of Object.entries(suiviRecu)) {
    const enBase = suiviEnBase[cle];
    if (!entree || typeof entree !== 'object' || !enBase || typeof enBase !== 'object') continue;
    if (!estTraceDuFondateur(enBase.by, ensemble) || String(entree.by || '')) continue;
    if (Boolean(entree.done) === Boolean(enBase.done) && String(entree.doneAt || '') === String(enBase.doneAt || '')) rendu[cle] = { ...entree, by: enBase.by };
  }
  return rendu;
}

// Le fondateur coche sans signer : une coche nouvelle ou changee qu il envoie avec son nom le perd. Une coche
// deja en base, renvoyee telle quelle, ne bouge pas (rien ne s efface en base).
function suiviSansSignature(suiviRecu, suiviEnBase, noms) {
  if (!suiviRecu || typeof suiviRecu !== 'object' || Array.isArray(suiviRecu)) return suiviRecu;
  const ensemble = lesNoms(noms);
  const enBase = suiviEnBase && typeof suiviEnBase === 'object' && !Array.isArray(suiviEnBase) ? suiviEnBase : {};
  const rendu = { ...suiviRecu };
  for (const [cle, entree] of Object.entries(suiviRecu)) {
    if (!entree || typeof entree !== 'object' || !estTraceDuFondateur(entree.by, ensemble)) continue;
    const avant = enBase[cle];
    const inchangee = Boolean(avant) && typeof avant === 'object' && avant.by === entree.by
      && Boolean(avant.done) === Boolean(entree.done) && String(avant.doneAt || '') === String(entree.doneAt || '');
    if (!inchangee) rendu[cle] = { ...entree, by: '' };
  }
  return rendu;
}

module.exports = {
  MOTIF_SQL,
  MARQUE_MEMBRE,
  NOMS_DE_NAISSANCE,
  estFondateur,
  estMembreFondateur,
  estNomDuFondateur,
  estTraceDuFondateur,
  nomsDuFondateur,
  oublierLesNoms,
  signatureVisible,
  masquerFondateur,
  notesSansFondateur,
  pourLaSession,
  notesRendues,
  suiviRendu,
  suiviSansSignature,
};

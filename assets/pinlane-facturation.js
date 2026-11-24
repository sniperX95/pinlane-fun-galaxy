/* ============================================================================
   UN DOSSIER A FACTURER (2026-11-24)
   ----------------------------------------------------------------------------
   POURQUOI CE FICHIER EXISTE. Le gerant (Ansar), le 24/11 : « comme moyen de
   paiement ça serait bien de mettre facturé et ça ouvre une pop up vraiment pro
   pour compléter toutes les infos ». Une societe qui paie sur facture ne paie
   pas au comptoir : le dossier reste confirme ou arrive, jamais « payé », et il
   garde ce dont la facture a besoin. Entre deux assujettis belges, la facture
   passe par Peppol depuis le 01/01/2026 : raison sociale, numero de TVA,
   adresse, e-mail ; la reference du client si elle existe.

   OU CA VIT, SANS MIGRATION. Une ligne de note d equipe du dossier, la meme
   colonne et le meme marqueur que les autres (lib/database.js, NOTE_EQUIPE_TAG),
   avec `type: 'facture'` et les champs. Le serveur seul l ecrit (une ligne
   d equipe envoyee par le navigateur est resignee sans ses champs,
   signerNotesEquipe) ; tous les lecteurs qui montrent le mot du client
   l ecartent deja, comme toute note d equipe ; aucun e-mail ne lit la colonne.

   LA REGLE, UNE SEULE FOIS, ICI. Le serveur la lit par require, la console par
   window.PinlaneFacturation : la fenetre dit la meme erreur que le serveur.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PinlaneFacturation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAG = '[equipe] ';
  const TYPE = 'facture';

  // LES PAYS DE L UNION EUROPEENNE : le code de l adresse, le nom, le prefixe du
  // numero de TVA (la Grece ecrit EL) et la forme du numero apres le prefixe
  // (les formats publies par le systeme VIES de la Commission). La Belgique
  // d abord, puis les voisins, puis les autres dans l ordre alphabetique.
  const PAYS = [
    { code: 'BE', nom: 'Belgique', tva: 'BE', forme: /^[01]\d{9}$/, cp: /^[1-9]\d{3}$/, exemple: 'BE 0123.456.749' },
    { code: 'FR', nom: 'France', tva: 'FR', forme: /^[0-9A-HJ-NP-Z]{2}\d{9}$/, cp: /^\d{5}$/ },
    { code: 'LU', nom: 'Luxembourg', tva: 'LU', forme: /^\d{8}$/, cp: /^(L-?)?\d{4}$/ },
    { code: 'NL', nom: 'Pays-Bas', tva: 'NL', forme: /^\d{9}B\d{2}$/, cp: /^\d{4} ?[A-Z]{2}$/ },
    { code: 'DE', nom: 'Allemagne', tva: 'DE', forme: /^\d{9}$/, cp: /^\d{5}$/ },
    { code: 'AT', nom: 'Autriche', tva: 'AT', forme: /^U\d{8}$/ },
    { code: 'BG', nom: 'Bulgarie', tva: 'BG', forme: /^\d{9,10}$/ },
    { code: 'CY', nom: 'Chypre', tva: 'CY', forme: /^\d{8}[A-Z]$/ },
    { code: 'HR', nom: 'Croatie', tva: 'HR', forme: /^\d{11}$/ },
    { code: 'DK', nom: 'Danemark', tva: 'DK', forme: /^\d{8}$/ },
    { code: 'ES', nom: 'Espagne', tva: 'ES', forme: /^[0-9A-Z]\d{7}[0-9A-Z]$/ },
    { code: 'EE', nom: 'Estonie', tva: 'EE', forme: /^\d{9}$/ },
    { code: 'FI', nom: 'Finlande', tva: 'FI', forme: /^\d{8}$/ },
    { code: 'GR', nom: 'Grèce', tva: 'EL', forme: /^\d{9}$/ },
    { code: 'HU', nom: 'Hongrie', tva: 'HU', forme: /^\d{8}$/ },
    { code: 'IE', nom: 'Irlande', tva: 'IE', forme: /^(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/ },
    { code: 'IT', nom: 'Italie', tva: 'IT', forme: /^\d{11}$/ },
    { code: 'LV', nom: 'Lettonie', tva: 'LV', forme: /^\d{11}$/ },
    { code: 'LT', nom: 'Lituanie', tva: 'LT', forme: /^(\d{9}|\d{12})$/ },
    { code: 'MT', nom: 'Malte', tva: 'MT', forme: /^\d{8}$/ },
    { code: 'PL', nom: 'Pologne', tva: 'PL', forme: /^\d{10}$/ },
    { code: 'PT', nom: 'Portugal', tva: 'PT', forme: /^\d{9}$/ },
    { code: 'CZ', nom: 'Tchéquie', tva: 'CZ', forme: /^\d{8,10}$/ },
    { code: 'RO', nom: 'Roumanie', tva: 'RO', forme: /^\d{2,10}$/ },
    { code: 'SK', nom: 'Slovaquie', tva: 'SK', forme: /^\d{10}$/ },
    { code: 'SI', nom: 'Slovénie', tva: 'SI', forme: /^\d{8}$/ },
    { code: 'SE', nom: 'Suède', tva: 'SE', forme: /^\d{12}$/ },
  ];
  const PAR_CODE = new Map(PAYS.map((p) => [p.code, p]));
  const PAR_PREFIXE = new Map(PAYS.map((p) => [p.tva, p]));

  // Les bornes de chaque champ, celles du serveur et de la fenetre.
  const LONGUEURS = { societe: 160, tva: 20, rue: 160, codePostal: 10, ville: 80, pays: 2, email: 160, contact: 120, reference: 80 };
  const CHAMPS = ['societe', 'tva', 'rue', 'codePostal', 'ville', 'pays', 'email', 'contact', 'reference'];

  // Un texte d une ligne, sans balise ni caractere de controle.
  function texte(valeur, max) {
    return String(valeur == null ? '' : valeur).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function paysDe(code) {
    return PAR_CODE.get(String(code || '').toUpperCase()) || null;
  }

  // LE CHIFFRE DE CONTROLE BELGE : les deux derniers chiffres valent 97 moins le
  // reste de la division des huit premiers par 97.
  function controleBelge(numero) {
    const base = Number(numero.slice(0, 8));
    return 97 - (base % 97) === Number(numero.slice(8));
  }

  // LE NUMERO DE TVA, LU COMME LE CLIENT L ECRIT : « BE 0123.456.749 »,
  // « be0123456749 », « 0123 456 749 », l ancien belge a neuf chiffres
  // (« 123.456.749 »). Sans prefixe, c est un numero belge : les centres sont en
  // Belgique. Rendu : { vide } ou { ok, valeur, pays, affichage } ou { ok: false, message }.
  function lireTva(brut) {
    const propre = String(brut == null ? '' : brut).toUpperCase().replace(/[\s.\-/]/g, '');
    if (!propre) return { vide: true, ok: true, valeur: '' };
    let prefixe = 'BE';
    let numero = propre;
    if (/^[A-Z]{2}/.test(propre)) {
      prefixe = propre.slice(0, 2);
      numero = propre.slice(2);
    }
    const pays = PAR_PREFIXE.get(prefixe);
    if (!pays) {
      return { ok: false, message: prefixe === 'GR' ? 'Pour la Grèce, le numéro commence par EL.' : 'Ce numéro ne commence pas par un pays de l’Union européenne (BE, FR, NL, LU…).' };
    }
    if (pays.code === 'BE') {
      if (/^\d{9}$/.test(numero)) numero = `0${numero}`;
      if (!/^\d+$/.test(numero)) return { ok: false, message: 'Un numéro de TVA belge ne contient que des chiffres après BE.' };
      if (numero.length !== 10) return { ok: false, message: `Un numéro de TVA belge a 10 chiffres, par exemple ${pays.exemple}.` };
      if (!/^[01]/.test(numero)) return { ok: false, message: 'Un numéro de TVA belge commence par 0 ou 1 après BE.' };
      if (!controleBelge(numero)) return { ok: false, message: 'Ce numéro de TVA n’existe pas : un chiffre est faux. Vérifiez-le avec le client.' };
      return { ok: true, valeur: `BE${numero}`, pays: 'BE', affichage: `BE ${numero.slice(0, 4)}.${numero.slice(4, 7)}.${numero.slice(7)}` };
    }
    if (!pays.forme.test(numero)) return { ok: false, message: `Ce numéro ne ressemble pas à un numéro de TVA de ${pays.nom === 'Pays-Bas' ? 'des Pays-Bas' : pays.nom}.` };
    return { ok: true, valeur: `${pays.tva}${numero}`, pays: pays.code, affichage: `${pays.tva} ${numero}` };
  }

  function afficherTva(valeur) {
    const lu = lireTva(valeur);
    return lu.ok && !lu.vide ? lu.affichage : String(valeur || '');
  }

  function emailValide(adresse) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adresse);
  }

  // CE QUE LA FENETRE ENVOIE, JUGE CHAMP PAR CHAMP. Obligatoires : la societe,
  // l adresse (rue et numero, code postal, ville, pays) et l e-mail ou la
  // facture part. Le numero de TVA est controle des qu il est tape ; vide, la
  // facture part sans (une ecole, une association sans TVA). La personne de
  // contact et la reference sont facultatives.
  // Rendu : { ok, facturation, erreurs: { champ: message }, premier }.
  function lireFacturation(src) {
    const s = src && typeof src === 'object' && !Array.isArray(src) ? src : {};
    const erreurs = {};
    const f = {};
    CHAMPS.forEach((champ) => { f[champ] = texte(s[champ], LONGUEURS[champ] + 40); });
    f.pays = (f.pays || 'BE').toUpperCase();
    const pays = paysDe(f.pays);
    if (!pays) erreurs.pays = 'Choisissez un pays de la liste.';
    if (!f.societe) erreurs.societe = 'Indiquez le nom de la société.';
    else if (f.societe.length > LONGUEURS.societe) erreurs.societe = `Le nom tient en ${LONGUEURS.societe} caractères au plus.`;
    const tva = lireTva(f.tva);
    if (!tva.ok) erreurs.tva = tva.message;
    else f.tva = tva.valeur;
    if (!f.rue) erreurs.rue = 'Indiquez la rue et le numéro.';
    else if (f.rue.length > LONGUEURS.rue) erreurs.rue = `L’adresse tient en ${LONGUEURS.rue} caractères au plus.`;
    f.codePostal = f.codePostal.toUpperCase();
    if (!f.codePostal) erreurs.codePostal = 'Indiquez le code postal.';
    else if (pays && pays.cp && !pays.cp.test(f.codePostal)) erreurs.codePostal = pays.code === 'BE' ? 'Un code postal belge a 4 chiffres.' : `Ce code postal ne ressemble pas à un code de ${pays.nom === 'Pays-Bas' ? 'des Pays-Bas' : pays.nom}.`;
    else if (!/^[A-Z0-9][A-Z0-9 -]{1,9}$/.test(f.codePostal)) erreurs.codePostal = 'Ce code postal n’est pas lisible.';
    if (!f.ville) erreurs.ville = 'Indiquez la ville.';
    else if (f.ville.length > LONGUEURS.ville) erreurs.ville = `La ville tient en ${LONGUEURS.ville} caractères au plus.`;
    f.email = f.email.toLowerCase().replace(/\s/g, '');
    if (!f.email) erreurs.email = 'Indiquez l’adresse e-mail où envoyer la facture.';
    else if (f.email.length > LONGUEURS.email || !emailValide(f.email)) erreurs.email = 'Cette adresse e-mail n’est pas complète, par exemple compta@societe.be.';
    if (f.contact.length > LONGUEURS.contact) erreurs.contact = `Le nom tient en ${LONGUEURS.contact} caractères au plus.`;
    if (f.reference.length > LONGUEURS.reference) erreurs.reference = `La référence tient en ${LONGUEURS.reference} caractères au plus.`;
    const premier = CHAMPS.find((champ) => erreurs[champ]) || '';
    return { ok: !premier, facturation: f, erreurs, premier };
  }

  // « Société Lambert SA, TVA BE 0123.456.749 »
  function nomEtTva(f) {
    if (!f) return '';
    return [f.societe, f.tva ? `TVA ${afficherTva(f.tva)}` : ''].filter(Boolean).join(', ');
  }

  // « Rue de la Gare 12, 6800 Libramont, Belgique »
  function adresseEnLigne(f) {
    if (!f) return '';
    const pays = paysDe(f.pays);
    return [f.rue, [f.codePostal, f.ville].filter(Boolean).join(' '), pays ? pays.nom : f.pays].filter(Boolean).join(', ');
  }

  // LA LIGNE DE NOTE. `t` est la phrase qu un lecteur sans cette regle lit ; les
  // champs sont dans `facture`. Une seule ligne par dossier : la nouvelle
  // remplace l ancienne, `null` la retire.
  function lireLigne(ligne) {
    const brute = String(ligne || '').trimStart();
    if (!brute.startsWith(TAG)) return null;
    try {
      const note = JSON.parse(brute.slice(TAG.length));
      return note && note.type === TYPE && note.facture && typeof note.facture === 'object' ? note : null;
    } catch (e) {
      return null;
    }
  }

  // La facturation d un dossier, lue dans ses notes : la derniere ligne, ou null.
  function factureDesNotes(notes) {
    const lignes = String(notes == null ? '' : notes).split('\n').map(lireLigne).filter(Boolean);
    const derniere = lignes[lignes.length - 1];
    if (!derniere) return null;
    const f = {};
    CHAMPS.forEach((champ) => { f[champ] = texte(derniere.facture[champ], LONGUEURS[champ]); });
    return { ...f, par: texte(derniere.par, 80), le: texte(derniere.le, 40) };
  }

  function notesAvecFacture(notes, facturation, { par = '', maintenant = new Date() } = {}) {
    const lignes = String(notes == null ? '' : notes).replace(/\r\n?/g, '\n').split('\n').filter((ligne) => String(ligne).trim() && !lireLigne(ligne));
    if (!facturation) return lignes.join('\n');
    // `le` est la cle d une note d equipe : jamais deux fois le meme instant sur un dossier.
    const pris = new Set(lignes.map((ligne) => {
      const brute = String(ligne).trimStart();
      if (!brute.startsWith(TAG)) return '';
      try { return (JSON.parse(brute.slice(TAG.length)) || {}).le || ''; } catch (e) { return ''; }
    }).filter(Boolean));
    let instant = maintenant.getTime();
    while (pris.has(new Date(instant).toISOString())) instant += 1;
    const facture = {};
    CHAMPS.forEach((champ) => { facture[champ] = texte(facturation[champ], LONGUEURS[champ]); });
    lignes.push(TAG + JSON.stringify({ t: `À facturer : ${nomEtTva(facture)}`, type: TYPE, facture, par: texte(par, 80), le: new Date(instant).toISOString() }));
    return lignes.join('\n');
  }

  // UN DOSSIER A FACTURER : il a sa facturation et n est ni paye ni annule.
  // Paye ensuite au comptoir, il garde le nom de la societe pour la facture.
  function dossierAFacturer(r) {
    return Boolean(r && r.status !== 'paid' && r.status !== 'cancelled' && factureDesNotes(r.notes));
  }

  return {
    TYPE,
    PAYS,
    CHAMPS,
    LONGUEURS,
    paysDe,
    lireTva,
    afficherTva,
    lireFacturation,
    nomEtTva,
    adresseEnLigne,
    lireLigne,
    factureDesNotes,
    notesAvecFacture,
    dossierAFacturer,
  };
}));

'use strict';
// COMMENT LE CENTRE ECRIT A SON CLIENT.
//
// Source d autorite unique pour TOUT texte qui part chez un client : gabarits
// automatiques, messages composes par le produit, et reponses generees par
// l agent IA. Le prompt de l agent lit ces regles, et le gate les applique aux
// messages REELLEMENT composes. Deux copies auraient diverge, et c est le
// client qui aurait lu la difference.
//
// Ecrit apres le retour de Seb (rapporte par Movsar, 2026-09-18) sur ce qui
// « sonne IA » :
//
//   « pas de on, nous »
//   « language plus professionnel, moins familier »
//   « reponse moins robotisee, plus humaine, professionnelle »
//   « pas de promesse, pas de laisser sous-entendu que c est bon, mais plutot
//     dire que c est envoye et que ca reste a voir »
//   « une reponse precise sur la validite ou quoi sera donnee dans les 24 h
//     ouvrables » quand l IA ne sait pas trancher
//   « parler de modification de prix calcule apres une modification de prix »
//   et le tic des deux-points : « Rien a payer a l avance : le montant se regle
//   sur place le jour meme » sonne fabrique.
//
// CE QUI N EST PAS JUGE ICI : les textes du STAFF (demande de validation,
// alerte terrain, resumes d exploitation, libelles de console). Le staff lit
// entre deux groupes et a le droit d ecrire court et technique ; ce fichier ne
// parle que de ce qu un CLIENT lit.

// Les lettres, accents compris. `\w` s arrete a l ASCII : sans cette classe,
// « operation » couperait apres « op » et « on » serait trouve au milieu d un
// mot. L apostrophe n en fait PAS partie, pour que « qu on » soit bien vu.
const LETTRE = 'A-Za-zÀ-ÖØ-öø-ÿ0-9_';

function motEntier(motif) {
  return new RegExp(`(^|[^${LETTRE}])(${motif})(?![${LETTRE}])`, 'i');
}

// --- LES REGLES, chacune verifiable sur un texte -----------------------------

// « on » et « nous » : le centre nomme son equipe, ou s adresse directement au
// client. Le « on » collectif fait parler une entite floue, et le « nous »
// institutionnel sonne comme un formulaire administratif.
//
// La regle est PRISE AU MOT, y compris la forme accrochee au verbe
// (« appelez-nous », « contactez-nous »). Il aurait ete facile de s en exempter
// au motif qu elle n est pas familiere ; mais une exception ecrite pour laisser
// passer le texte existant, c est le gate qu on baillonne, pas la regle qu on
// tient. Et « Appelez le centre » se lit mieux de toute facon.
const PRONOMS_INTERDITS = [
  { motif: motEntier('on'), nom: 'le pronom « on »', remede: 'nommer l equipe ou le centre, ou s adresser au client' },
  { motif: motEntier('nous|notre|nos'), nom: 'le pronom « nous / notre / nos »', remede: 'nommer l equipe ou le centre' },
];

// Tournures familieres ou publicitaires. La liste est EXPLICITE : un jugement
// de style automatique produirait des faux positifs sur des phrases correctes.
// Chaque entree vient d un texte reellement envoye, ou d un exemple de Seb.
const TOURNURES_FAMILIERES = [
  { motif: /c[’']est officiel/i, nom: '« c est officiel »', remede: 'annoncer le fait, sans emphase' },
  { motif: /il ne vous reste plus qu/i, nom: '« il ne vous reste plus qu a »', remede: 'finir sur une information, pas sur une formule' },
  { motif: /rien à payer/i, nom: '« rien a payer »', remede: 'dire ou et quand le montant se regle' },
  { motif: /à très vite/i, nom: '« a tres vite »', remede: 'une formule de politesse professionnelle' },
  { motif: /d[’']un pouce/i, nom: '« pas d un pouce »', remede: 'dire ce qui ne change pas' },
  { motif: /rien que pour vous/i, nom: '« rien que pour vous »', remede: 'decrire l offre' },
  { motif: motEntier('hop'), nom: '« hop »', remede: 'retirer' },
  { motif: /\bp[’']?tit\b/i, nom: '« ptit »', remede: 'retirer' },
  { motif: motEntier('super'), nom: '« super »', remede: 'un adjectif precis' },
  { motif: /\bdu coup\b/i, nom: '« du coup »', remede: 'une liaison ecrite' },
];

// LE TIC DES DEUX-POINTS. C est l exemple que Seb a donne mot pour mot. Un
// « libelle : valeur » de temps en temps est naturel ; trois dans un mail
// donnent le rythme d une fiche technique.
//
// Ne comptent que les deux-points ENTOURES D ESPACES dans une ligne de PROSE.
// « 15:00 » et « Libramont: rappel » (prefixe SMS) n en sont pas, et les cartes
// de details ne passent pas par ici : ce sont des donnees.
const DEUX_POINTS_MAX = 1;
const LIGNE_DE_PROSE = 40;

// Ce qu un message NON CONFIRME n a pas le droit de laisser croire. « Pas de
// promesse, pas de laisser sous-entendu que c est bon. »
const PROMESSES_INTERDITES = [
  { motif: /est confirmée?\b/i, nom: 'une confirmation annoncee' },
  { motif: /reste (bien )?confirmée?\b/i, nom: 'une confirmation annoncee' },
  { motif: /votre créneau est (bloqué|réservé)/i, nom: 'un creneau annonce comme bloque' },
  { motif: /(déjà )?bloqué à votre nom/i, nom: 'un creneau annonce comme bloque' },
  { motif: /c[’']est (bon|réservé|confirmé)\b/i, nom: '« c est bon »' },
  { motif: /garanti|garantissons/i, nom: 'une garantie' },
];

// L ENGAGEMENT DE DELAI, mot pour mot. Quand la reponse ne peut pas etre donnee
// tout de suite (demande sur mesure, question que l agent ne tranche pas), le
// client doit lire QUAND il aura une reponse ferme. « On revient vers vous »
// n est pas un delai.
const DELAI_REPONSE = '24 heures ouvrables';
const MOTIF_DELAI = /24\s*(heures?|h)\s*ouvrables?/i;

// LE MONTANT APRES UN CHANGEMENT. « Parler de modification de prix calcule
// apres une modification de prix » : un client dont la reservation bouge se
// demande ce qu il va payer. Le message le dit, que le montant ait change ou
// non. Le silence, lui, se lit comme une mauvaise nouvelle.
const MOTIF_MONTANT = /montant|prix|tarif|€/i;

// --- LE JUGEMENT -------------------------------------------------------------

function lignesDe(texte) {
  return String(texte || '')
    .split(/\n+/)
    .map((ligne) => ligne.trim())
    .filter(Boolean);
}

// `texte` : ce que le client LIT, en prose (objet, titre, corps, pre-entete,
// mention de bas de page), une ligne par element. Les cartes de details
// (« Date », « Participants ») ne passent pas ici.
//
// `etat` :
//   'confirme'      le creneau est tenu ;
//   'sans-promesse' rien n est acquis, donc aucune promesse ;
//   'a-confirmer'   rien n est acquis ET l expediteur ne peut pas trancher
//                   maintenant : aucune promesse, ET un delai ferme annonce ;
//   'changement'    la reservation bouge, donc le montant se dit.
//
// La difference entre les deux etats du milieu vient du mot de Movsar :
// « quand tu envoies un mail genere par IA que l IA ne sait pas resoudre, dire
// qu une reponse precise sera donnee dans les 24 h ouvrables ». Le delai est
// du par celui qui NE PEUT PAS repondre (accuse automatique, agent IA bloque) ;
// un membre du staff qui propose un creneau, lui, EST la reponse. Lui imposer
// d annoncer un delai ferait ecrire une phrase fausse.
function verifierEcritureClient(texte, { etat = 'confirme' } = {}) {
  const corps = String(texte || '');
  const ecarts = [];
  const lignes = lignesDe(corps);

  const chercher = (regles, categorie, remedeParDefaut) => {
    regles.forEach((regle) => {
      lignes.forEach((ligne) => {
        if (regle.motif.test(ligne)) {
          ecarts.push({
            regle: categorie,
            quoi: regle.nom,
            remede: regle.remede || remedeParDefaut,
            extrait: ligne.slice(0, 120),
          });
        }
      });
    });
  };

  chercher(PRONOMS_INTERDITS, 'pronom');
  chercher(TOURNURES_FAMILIERES, 'familier');

  const prose = lignes.filter((ligne) => ligne.length > LIGNE_DE_PROSE);
  const deuxPoints = prose.reduce((total, ligne) => total + (ligne.match(/\s:\s/g) || []).length, 0);
  if (deuxPoints > DEUX_POINTS_MAX) {
    ecarts.push({
      regle: 'deux-points',
      quoi: `${deuxPoints} tournures « ... : ... » dans le meme message`,
      remede: `au plus ${DEUX_POINTS_MAX}, le reste en phrases`,
      extrait: prose.filter((ligne) => /\s:\s/.test(ligne)).join(' | ').slice(0, 200),
    });
  }

  if (etat === 'a-confirmer' || etat === 'sans-promesse') {
    chercher(PROMESSES_INTERDITES, 'promesse', 'dire ce qui est fait, et ce qui reste a verifier');
  }

  if (etat === 'a-confirmer') {
    if (!MOTIF_DELAI.test(corps)) {
      ecarts.push({
        regle: 'delai',
        quoi: `aucun delai de reponse ferme (${DELAI_REPONSE})`,
        remede: `annoncer une reponse precise sous ${DELAI_REPONSE}`,
        extrait: '',
      });
    }
  }

  if (etat === 'changement' && !MOTIF_MONTANT.test(corps)) {
    ecarts.push({
      regle: 'montant',
      quoi: 'un changement annonce sans un mot sur le montant',
      remede: 'dire le montant recalcule, ou qu il ne change pas',
      extrait: '',
    });
  }

  return ecarts;
}

// Les memes regles, en francais, pour le prompt de l agent IA. Elles ne sont
// pas reecrites : elles DERIVENT des motifs ci-dessus, donc elles ne peuvent
// pas se desynchroniser du gate qui juge les textes du produit.
function consignesPourLAgent() {
  return [
    'ECRITURE (les memes regles que les mails du centre, verifiees par un gate) :',
    `- N emploie jamais ${PRONOMS_INTERDITS.map((r) => r.nom).join(' ni ')}, meme accroche au verbe. Nomme l equipe ou le centre, ou adresse-toi directement au client.`,
    `- Evite les tournures familieres ou publicitaires, notamment ${TOURNURES_FAMILIERES.map((r) => r.nom).join(', ')}.`,
    `- Pas plus de ${DEUX_POINTS_MAX} tournure « ... : ... » par message : au-dela, le texte prend le rythme d une fiche technique et sonne fabrique.`,
    '- Ne promets rien, ne laisse pas entendre qu une demande est acceptee. Dis ce qui a ete fait, et ce qui reste a verifier.',
    `- Quand la reponse ne peut pas etre donnee tout de suite, annonce une reponse precise sous ${DELAI_REPONSE}.`,
    '- Quand une reservation change, dis le montant recalcule apres la modification, ou dis qu il ne change pas.',
    '- Ecris court, en phrases completes, sans emphase et sans emoji.',
  ].join('\n');
}

module.exports = {
  DELAI_REPONSE,
  MOTIF_DELAI,
  MOTIF_MONTANT,
  DEUX_POINTS_MAX,
  LIGNE_DE_PROSE,
  PRONOMS_INTERDITS,
  TOURNURES_FAMILIERES,
  PROMESSES_INTERDITES,
  verifierEcritureClient,
  consignesPourLAgent,
};

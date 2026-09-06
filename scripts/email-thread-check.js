// CE QUE LA PERSONNE A ECRIT, SEPARE DE CE QUE SON LOGICIEL A RECOPIE.
//
// Pourquoi ce gate existe. Sur un « Ok » de deux lettres, le logiciel du client
// colle trois ecrans de citation en dessous. A l ecran le message se perd
// dedans ; a l analyse, l agent lit la citation comme si le client venait de
// l ecrire et repond a cote. La meme regle sert donc les deux, et c est elle
// qu on mesure ici, sur les formes reelles que produisent Gmail, Outlook et
// Apple Mail.
//
// LE RISQUE PRINCIPAL N EST PAS DE GARDER UNE CITATION DE TROP : c est de
// ROGNER UNE VRAIE PHRASE. Un message ampute est invisible (rien ne signale ce
// qui manque) et fait repondre a cote. La regle est donc prudente, et une
// bonne moitie des controles ci-dessous verifie ce qu elle NE coupe PAS.
//
// LES SIX PROPRIETES :
//
//   [A] LA FORME GMAIL FRANCAISE EST COUPEE AU BON ENDROIT, attribution
//       comprise : « Le ... a ecrit : » appartient a la citation, pas au
//       message.
//
//   [B] LES AUTRES LOGICIELS AUSSI (Outlook, transfert, anglais).
//
//   [C] UN MESSAGE SANS CITATION N EST PAS TOUCHE. C est le cas le plus
//       frequent : un premier contact.
//
//   [D] ON NE COUPE JAMAIS AU POINT DE VIDER LE MESSAGE. Si la regle aboutit a
//       un message vide, elle s est trompee : on rend tout.
//
//   [E] UN CHEVRON QUI N EST PAS UNE CITATION NE DECLENCHE PAS DE COUPE
//       ABUSIVE... et quand il le fait quand meme, le message reste entier.
//
//   [F] LA CITATION DEPLIEE EST LISIBLE : les chevrons empiles disparaissent,
//       parce que c est exactement ce qui la rendait illisible.
//
// Usage : node scripts/email-thread-check.js
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { separerCitation, historiqueLisible } = require(path.join(ROOT, 'assets/email-thread.js'));

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// Le vrai mail reçu en production le 2026-09-06, recopié tel quel.
const REEL = [
  'Ok',
  '',
  'Le dim. 6 sept. 2026 à 20:54, Fun Galaxy Libramont <contact@pinlane.be> a',
  'écrit :',
  '',
  '> Bowling',
  '>',
  '> place.',
  '>',
  '> Fun Galaxy Libramont',
  '>',
  '> Réservation confirmée',
  '> On vous attend mardi 8 septembre',
].join('\n');

(async () => {
  // =====================================================================
  console.log('[A] la forme Gmail francaise est coupee au bon endroit');
  // =====================================================================
  const a = separerCitation(REEL);
  ok(a.message === 'Ok', '[A] le message garde EXACTEMENT ce que la personne a tape', JSON.stringify(a.message));
  ok(!/a\s*\n?écrit/.test(a.message), '[A] la phrase d attribution part avec la citation, pas avec le message');
  ok(/Réservation confirmée/.test(a.historique), '[A] et la citation, elle, est conservee (rien n est perdu)');

  const wrap = separerCitation('Bonjour, oui c est parfait.\n\nLe 6 sept. 2026, Marie <m@x.be> a écrit :\n\n> Vous confirmez ?');
  ok(wrap.message === 'Bonjour, oui c est parfait.', '[A] attribution sur UNE ligne : meme resultat', JSON.stringify(wrap.message));

  // =====================================================================
  console.log('\n[B] les autres logiciels aussi');
  // =====================================================================
  const outlook = separerCitation('Merci beaucoup.\n\n________________________________\nDe : Fun Galaxy <contact@pinlane.be>\nEnvoyé : dimanche 6 septembre\nObjet : Confirmation\n\nBonjour,');
  ok(outlook.message === 'Merci beaucoup.', '[B] Outlook (barre de soulignes puis « De : »)', JSON.stringify(outlook.message));
  const anglais = separerCitation('Sounds good, thanks!\n\nOn Sun, 6 Sep 2026 at 20:54, Fun Galaxy <contact@pinlane.be> wrote:\n\n> Your booking is confirmed');
  ok(anglais.message === 'Sounds good, thanks!', '[B] anglais (« wrote: »)', JSON.stringify(anglais.message));
  const transfert = separerCitation('Regarde ca.\n\n---------- Forwarded message ----------\nFrom: Marie <m@x.be>');
  ok(transfert.message === 'Regarde ca.', '[B] transfert', JSON.stringify(transfert.message));

  // =====================================================================
  console.log('\n[C] un message sans citation n est pas touche');
  // =====================================================================
  const premier = 'Bonjour,\n\nJe voudrais organiser un anniversaire pour mon fils samedi.\nNous serions 12 enfants.\n\nMerci,\nMarie';
  const c = separerCitation(premier);
  ok(c.message === premier.trim() && c.historique === '', '[C] un premier contact traverse intact', JSON.stringify(c.historique));
  const accents = separerCitation('Bonjour, est-ce que je peux amener mon propre gâteau ?');
  ok(accents.message === 'Bonjour, est-ce que je peux amener mon propre gâteau ?', '[C] une question simple aussi');

  // =====================================================================
  console.log('\n[D] on ne coupe jamais au point de vider le message');
  // =====================================================================
  const toutCite = separerCitation('> Bonjour,\n> Vous confirmez ?');
  ok(toutCite.message.includes('Bonjour') && toutCite.historique === '',
    '[D] un mail qui n est QUE de la citation est rendu entier plutot que vide', JSON.stringify(toutCite.message));
  const attributionSeule = separerCitation('Le 6 sept. 2026, Marie a écrit :');
  ok(attributionSeule.message.includes('a écrit'),
    '[D] une attribution en toute premiere ligne ne coupe rien', JSON.stringify(attributionSeule.message));
  const vide = separerCitation('');
  ok(vide.message === '' && vide.historique === '', '[D] un texte vide ne fabrique rien');
  const nul = separerCitation(null);
  ok(nul.message === '' && nul.historique === '', '[D] et une absence de texte non plus');

  // =====================================================================
  console.log('\n[E] une vraie phrase ne se fait pas rogner');
  // =====================================================================
  const longue = separerCitation('Bonjour,\n\nDeux questions :\n\n1. peut-on amener un gateau ?\n2. y a-t-il un parking ?\n\nMerci\n\nLe 6 sept. 2026, Fun Galaxy a écrit :\n\n> Confirmation');
  ok(/1\. peut-on amener un gateau \?/.test(longue.message) && /2\. y a-t-il un parking \?/.test(longue.message) && /Merci/.test(longue.message),
    '[E] tout ce qui precede la citation est conserve, y compris apres des lignes vides', JSON.stringify(longue.message.slice(0, 60)));
  ok(!/Confirmation/.test(longue.message), '[E] et rien de la citation ne deborde dans le message');

  // =====================================================================
  console.log('\n[F] la citation depliee est lisible');
  // =====================================================================
  const lisible = historiqueLisible(a.historique);
  ok(!/^\s*>/m.test(lisible), '[F] plus aucun chevron en debut de ligne', JSON.stringify(lisible.slice(0, 40)));
  ok(/Réservation confirmée/.test(lisible), '[F] et le contenu, lui, est intact');
  const imbrique = historiqueLisible('> > > Bonjour\n> > Merci\n> Au revoir');
  ok(imbrique === 'Bonjour\nMerci\nAu revoir', '[F] les niveaux empiles disparaissent tous', JSON.stringify(imbrique));

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nTous les controles passent.');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

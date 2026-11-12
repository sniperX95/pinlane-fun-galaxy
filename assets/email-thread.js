/* CE QUE LA PERSONNE A ECRIT, ET CE QUE SON LOGICIEL A RECOPIE (2026-09-06).
 *
 * Quand quelqu un repond a un mail, son logiciel colle en dessous TOUT
 * l historique de la conversation, prefixe de chevrons. Sur un simple « Ok »,
 * ca donne trois ecrans de citation pour deux lettres de contenu. Deux degats,
 * l un visible et l autre pas :
 *
 *   - a l ecran, le message se perd dans sa propre citation (« c est super
 *     moche », mot pour mot) ;
 *   - a l analyse, l agent lit la citation comme si le client venait de
 *     l ecrire, et repond a cote.
 *
 * D ou UNE seule regle, partagee par l ecran et par l agent : ils veulent
 * exactement la meme chose, « la partie que la personne a reellement tapee ».
 * Deux copies auraient diverge, et c est l agent qui aurait souffert en
 * silence.
 *
 * La regle est volontairement PRUDENTE : dans le doute, on garde tout dans le
 * message. Rogner trop ferait disparaitre une vraie phrase, ce qui est bien
 * pire qu une citation de trop.
 */
(function (global) {
  'use strict';

  // Les marques d attribution que collent les logiciels de messagerie avant la
  // citation. Ecrites larges : c est le point de coupe le plus fiable, et une
  // langue oubliee ne casse rien (on retombe sur les chevrons).
  var ATTRIBUTION = /(a\s+[ée]crit\s*:?\s*$)|(\bwrote\s*:?\s*$)|(^-{2,}\s*(message d.origine|original message|forwarded message)\s*-{2,})|(^\s*_{10,}\s*$)|(^\s*(de|from)\s*:\s.+)/i;

  function estCitee(ligne) {
    return /^\s*>/.test(ligne);
  }

  function separerCitation(texteBrut) {
    var texte = String(texteBrut == null ? '' : texteBrut).replace(/\r\n/g, '\n');
    if (!texte.trim()) return { message: '', historique: '' };
    var lignes = texte.split('\n');

    // Le premier chevron : la citation commence AU PLUS TARD la.
    var premierChevron = -1;
    for (var i = 0; i < lignes.length; i += 1) {
      if (estCitee(lignes[i])) { premierChevron = i; break; }
    }

    var coupe = premierChevron;

    // On remonte au-dessus du premier chevron pour attraper la phrase
    // d attribution (« Le 6 sept. 2026, Untel <x@y> a ecrit : »), qui appartient
    // a la citation et pas au message. Gmail la coupe parfois sur deux lignes :
    // on remonte donc jusqu a trois lignes, en sautant les lignes vides.
    if (coupe > 0) {
      var j = coupe - 1;
      while (j >= 0 && !lignes[j].trim()) j -= 1;
      var reculs = 0;
      var debutAttribution = -1;
      var accumule = '';
      while (j >= 0 && reculs < 3) {
        accumule = lignes[j] + ' ' + accumule;
        if (ATTRIBUTION.test(lignes[j].trim()) || ATTRIBUTION.test(accumule.trim())) {
          debutAttribution = j;
          break;
        }
        // Une ligne vide au-dessus met fin a la remontee : l attribution est
        // d un seul tenant, jamais separee du chevron par un paragraphe.
        if (!lignes[j].trim()) break;
        j -= 1;
        reculs += 1;
      }
      if (debutAttribution >= 0) coupe = debutAttribution;
    }

    // Aucun chevron : certains logiciels citent sans les mettre (Outlook avec sa
    // barre de soulignes, ou un transfert). L attribution seule fait alors foi.
    if (coupe < 0) {
      for (var k = 0; k < lignes.length; k += 1) {
        var l = lignes[k].trim();
        if (!l) continue;
        // Une attribution en TOUTE PREMIERE ligne ne coupe rien : ce serait un
        // message entierement vide, et on prefere tout garder.
        if (k > 0 && ATTRIBUTION.test(l)) { coupe = k; break; }
      }
    }

    if (coupe < 0) return { message: texte.trim(), historique: '' };

    var message = lignes.slice(0, coupe).join('\n').trim();
    var historique = lignes.slice(coupe).join('\n').trim();

    // PRUDENCE : si la coupe ne laisse RIEN au message, c est que la regle s est
    // trompee (un mail entierement cite n existe pas : la personne a bien ecrit
    // quelque chose, ou alors le mail est vide). On rend tout, plutot que de
    // faire disparaitre le contenu.
    if (!message) return { message: texte.trim(), historique: '' };

    return { message: message, historique: historique };
  }

  // La citation, debarrassee de ses chevrons, pour qu elle reste lisible quand
  // on la deplie. Les niveaux d imbrication disparaissent : personne ne lit un
  // fil a cinq chevrons, et les garder etait justement le probleme.
  function historiqueLisible(historique) {
    return String(historique || '')
      .split('\n')
      .map(function (ligne) { return ligne.replace(/^\s*(>\s?)+/, ''); })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* UN MAIL DE FORMULAIRE DE SITE (2026-11-12). Le site envoie chaque question
   * suivie de trois espaces et de sa reponse, les champs colles les uns aux
   * autres : « Choix du centre   Libramont Nombre de participants ?   15 ». A
   * l ecran, c etait un seul paragraphe ou plus rien ne se distinguait (« c est
   * chaud, on distingue pas »). On rend la liste des questions et de leurs
   * reponses. PRUDENT comme la citation : moins de trois champs, ou un
   * decoupage douteux, et on rend null ; l ecran montre alors le texte tel quel.
   */
  var SEPARATEUR_CHAMP = / {3,}|\t+/;

  // « Choix », « Téléphone », « E-mail » : une majuscule puis une minuscule.
  // « JULIE », « 0470 » ou « [x@y] » ne commencent jamais une question.
  function commenceUneQuestion(mot) {
    return /^\p{Lu}-?\p{Ll}/u.test(String(mot || ''));
  }

  // « valeur Question suivante » : la question suivante commence au dernier
  // retour a la ligne quand il y en a un, sinon au dernier mot qui commence par
  // une majuscule suivie d une minuscule (« JULIE EXEMPLE Choix du centre »).
  function couperValeurEtQuestion(morceau) {
    var texte = String(morceau || '');
    var ligne = texte.lastIndexOf('\n');
    var avant = ligne >= 0 ? texte.slice(0, ligne) : '';
    var derniere = ligne >= 0 ? texte.slice(ligne + 1) : texte;
    if (avant.trim() && commenceUneQuestion(derniere.trim())) {
      return { valeur: avant.trim(), question: derniere.trim() };
    }
    var mots = derniere.split(' ');
    for (var k = mots.length - 1; k >= 1; k -= 1) {
      if (!commenceUneQuestion(mots[k])) continue;
      var valeur = (avant ? avant + '\n' : '') + mots.slice(0, k).join(' ');
      var question = mots.slice(k).join(' ');
      if (valeur.trim() && question.trim()) return { valeur: valeur.trim(), question: question.trim() };
    }
    return null;
  }

  // « x@y.be [x@y.be] » : la conversion du HTML en texte recopie l adresse du
  // lien a cote de son texte. Une seule fois suffit.
  function nettoyerValeur(valeur) {
    return String(valeur || '').replace(/(\S+)\s+\[(?:mailto:)?([^\]\s]+)\]/g, function (tout, texte, lien) {
      return texte === lien ? texte : tout;
    }).trim();
  }

  function champsDuFormulaire(texteBrut) {
    var texte = String(texteBrut == null ? '' : texteBrut).replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim();
    if (!texte) return null;
    var morceaux = texte.split(SEPARATEUR_CHAMP);
    if (morceaux.length < 4) return null;
    var intro = '';
    var premiere = morceaux[0];
    var coupe = premiere.lastIndexOf('\n');
    if (coupe >= 0) { intro = premiere.slice(0, coupe).trim(); premiere = premiere.slice(coupe + 1); }
    var question = premiere.trim();
    var champs = [];
    var fin = '';
    for (var i = 1; i < morceaux.length; i += 1) {
      if (i === morceaux.length - 1) {
        // Ce qui suit la derniere reponse apres une ligne vide (une mention du
        // site) n est pas une reponse.
        var derniere = morceaux[i];
        var paragraphe = derniere.indexOf('\n\n');
        if (paragraphe >= 0) { fin = derniere.slice(paragraphe).trim(); derniere = derniere.slice(0, paragraphe); }
        champs.push({ question: question, valeur: derniere.trim() });
        break;
      }
      var decoupe = couperValeurEtQuestion(morceaux[i]);
      if (!decoupe) return null;
      champs.push({ question: question, valeur: decoupe.valeur });
      question = decoupe.question;
    }
    for (var c = 0; c < champs.length; c += 1) {
      if (!champs[c].question || champs[c].question.length > 160 || !champs[c].valeur) return null;
      champs[c].valeur = nettoyerValeur(champs[c].valeur);
    }
    if (champs.length < 3) return null;
    return { intro: intro, champs: champs, fin: fin };
  }

  /* LA REPONSE QUE LE CLIENT CITE (2026-11-12). Quand l equipe repond depuis
   * sa propre boite mail, Pinlane ne voit pas ce mail : il le retrouve cite
   * dans la reponse suivante du client. On lit la PREMIERE citation (celle a
   * laquelle le client repond) : son auteur, son adresse, sa date et son texte,
   * au premier niveau seulement. Rien de sur : null. */
  var MOIS = {
    janv: 0, janvier: 0, 'févr': 1, 'février': 1, fevr: 1, fevrier: 1, mars: 2, avr: 3, avril: 3, mai: 4, juin: 5,
    juil: 6, juillet: 6, 'août': 7, aout: 7, sept: 8, septembre: 8, oct: 9, octobre: 9, nov: 10, novembre: 10,
    'déc': 11, 'décembre': 11, dec: 11, decembre: 11,
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
    jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8, october: 9, november: 10, december: 11,
  };

  function dateDeCitation(texte) {
    var t = String(texte || '').toLowerCase();
    var jour; var mois; var annee; var heure = 0; var minute = 0; var x;
    x = t.match(/(\d{1,2})\s+([a-zéû]+)\.?\s+(\d{4})(?:[^\d]{1,6}(\d{1,2})[:h](\d{2}))?/);
    if (x && MOIS[x[2]] !== undefined) {
      jour = Number(x[1]); mois = MOIS[x[2]]; annee = Number(x[3]);
      if (x[4]) { heure = Number(x[4]); minute = Number(x[5]); }
    } else {
      x = t.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[^\d]{1,6}(\d{1,2}):(\d{2})\s*(am|pm)?)?/);
      if (x && MOIS[x[1]] !== undefined) {
        mois = MOIS[x[1]]; jour = Number(x[2]); annee = Number(x[3]);
        if (x[4]) {
          heure = Number(x[4]); minute = Number(x[5]);
          if (x[6] === 'pm' && heure < 12) heure += 12;
          if (x[6] === 'am' && heure === 12) heure = 0;
        }
      } else {
        x = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[^\d]{1,6}(\d{1,2})[:h](\d{2}))?/);
        if (x) {
          jour = Number(x[1]); mois = Number(x[2]) - 1; annee = Number(x[3]);
          if (x[4]) { heure = Number(x[4]); minute = Number(x[5]); }
        }
      }
    }
    if (annee === undefined) return null;
    var d = new Date(annee, mois, jour, heure, minute);
    // Une date se reconstruit : le 31 fevrier n existe pas.
    if (d.getFullYear() !== annee || d.getMonth() !== mois || d.getDate() !== jour) return null;
    return d.toISOString();
  }

  var FIN_ATTRIBUTION = /(a\s+[ée]crit|wrote)\s*:?\s*$/i;

  function premiereCitation(historique) {
    var lignes = String(historique || '').replace(/\r\n?/g, '\n').split('\n');
    var i = 0;
    while (i < lignes.length && !lignes[i].trim()) i += 1;
    if (i >= lignes.length) return null;
    var entete = '';
    var corps = [];
    var j;
    if (/^\s*(de|from)\s*:\s*\S/i.test(lignes[i])) {
      // Le bloc d Outlook : De, Envoye, A, Objet, puis le texte sans chevrons.
      var quand = '';
      j = i + 1;
      while (j < lignes.length && /^\s*(envoy[ée]|sent|date|[àa]|to|cc|objet|subject)\s*:/i.test(lignes[j])) {
        if (/^\s*(envoy[ée]|sent|date)\s*:/i.test(lignes[j])) quand = lignes[j];
        j += 1;
      }
      entete = lignes[i] + ' ' + quand;
      for (; j < lignes.length; j += 1) {
        var ligneOutlook = lignes[j];
        if (/^\s*(de|from)\s*:\s*\S/i.test(ligneOutlook) || /^\s*-{2,}\s*(message d.origine|original message)/i.test(ligneOutlook) || /^\s*_{10,}\s*$/.test(ligneOutlook)) break;
        corps.push(ligneOutlook.replace(/^\s*>\s?/, ''));
      }
    } else {
      // « Le lun. 15 sept. 2026 à 10:12, Untel <x@y> a écrit : », sur une a
      // trois lignes, puis les lignes a un chevron.
      var accumule = '';
      for (j = i; j < lignes.length && j < i + 3; j += 1) {
        accumule += (accumule ? ' ' : '') + lignes[j].trim();
        if (FIN_ATTRIBUTION.test(accumule)) break;
      }
      if (j >= lignes.length || !FIN_ATTRIBUTION.test(accumule)) return null;
      entete = accumule;
      for (j += 1; j < lignes.length; j += 1) {
        var ligne = lignes[j];
        if (!/^\s*>/.test(ligne)) {
          if (!ligne.trim()) { corps.push(''); continue; }
          break;
        }
        var niveauUn = ligne.replace(/^\s*>\s?/, '');
        if (/^\s*>/.test(niveauUn)) continue;
        if (FIN_ATTRIBUTION.test(niveauUn.trim())) break;
        corps.push(niveauUn);
      }
    }
    var texte = corps.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!texte) return null;
    var adresseTrouvee = entete.match(/<?([^\s<>"'(),;:]+@[^\s<>"'(),;:]+\.[a-z]{2,})>?/i);
    var adresse = adresseTrouvee ? adresseTrouvee[1].toLowerCase() : '';
    var avant = adresseTrouvee ? entete.slice(0, adresseTrouvee.index) : entete.replace(FIN_ATTRIBUTION, '');
    var heures = avant.match(/\d{1,2}[:h]\d{2}(\s*(am|pm))?/gi);
    if (heures) avant = avant.slice(avant.lastIndexOf(heures[heures.length - 1]) + heures[heures.length - 1].length);
    var auteur = avant
      .replace(/^\s*(de|from)\s*:\s*/i, '')
      .replace(/^[\s,]+|[\s,<"']+$/g, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    return { auteur: auteur, adresse: adresse, date: dateDeCitation(entete), texte: texte };
  }

  var api = {
    separerCitation: separerCitation,
    historiqueLisible: historiqueLisible,
    champsDuFormulaire: champsDuFormulaire,
    premiereCitation: premiereCitation,
  };
  global.PinlaneEmailThread = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

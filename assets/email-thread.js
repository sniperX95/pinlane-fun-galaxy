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

  var api = { separerCitation: separerCitation, historiqueLisible: historiqueLisible };
  global.PinlaneEmailThread = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

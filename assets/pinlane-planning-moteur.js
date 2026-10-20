// LE MOTEUR DU PLANNING GLOBAL (2026-10-20, planning global v3).
//
// Un calcul pur : une journee en donnees simples (construites par
// assets/pinlane-planning-global.js depuis la console), un ecran, une regle de
// mesure des textes. Il rend le plan complet de la grille : les colonnes et
// leurs largeurs en pixels entiers, les cartes et leurs rectangles, ce que
// chaque carte ecrit (et dans quel ordre elle le perd), les tetes, les filets
// d heure, les bandes hors horaires. Il ne touche ni au document, ni a
// window (hors son export), ni a l heure : maintenant lui est donne.
//
// Ce que Movsar a tranche et que le moteur garde (spec planning v3) :
//   - toute la journee d un coup, sans defilement vertical, a toute taille ;
//   - les heures a gauche, une colonne par activite dans l ordre du papier ;
//   - la couleur d une carte est celle de son STATUT, jamais de l activite ;
//   - chaque activite selon sa nature : le bowling en pistes, le laser en
//     parties et armes, la plaine en presences nommees, les credits d arcade
//     en compteur, les activites sans heure fixe en pointilles ;
//   - le nom passe d abord, jamais coupe au milieu d un mot : quand la place
//     manque, c est la forme du nom qui raccourcit, pas la police ;
//   - « armes » pour le laser, jamais un autre mot.
//
// La geometrie (largeurs, rectangles) ne depend que des donnees et de la
// place disponible : jamais de l heure, du groupe choisi ni du filtre. Rien
// ne bouge sous l oeil du comptoir ; la minute qui passe ne change que l etat
// des cartes (ghEtats) et, quand une carte porteuse change, son texte.
(function (fabrique) {
  var moteur = fabrique();
  if (typeof module === 'object' && module && module.exports) module.exports = moteur;
  if (typeof window !== 'undefined' && window) window.PinlanePlanningMoteur = moteur;
})(function () {
  'use strict';

  // ---- LES MESURES FIXES ------------------------------------------------------
  // (origine : la marge au-dessus de la premiere ligne et sous la derniere ;
  // carte : barre 3, marges 4 et 2, jeu 1 + 1 ; segment : barre 3, marges 3
  // et 2 ; partie : jeu 2, cadre 2, marges 2 ; le compte d une partie basse
  // tient a gauche de sa barre : « 22/30 » en Geist 650 10,5 px tabulaire
  // mesure 34 px, plus son jeu ; la spec donnait 34 px pour l ensemble)
  var ORIGINE = 8;
  var HEURE_MAX = 140;
  var CHROME_CARTE = 11;
  var CHROME_SEG = 8;
  var CHROME_PARTIE = 6;
  var CADRE_PARTIE_V = 4;
  var COMPTE_PARTIE = 36;
  var ECART_SEG = 1;
  var TOLERANCE_TOUCHER = 8;
  var PLANCHERS = { piste: 26, pisteToucher: 30, voie: 34, plaine: 28, laser: 64, vide: 40 };
  var PLAFONDS = { pisteEss: 72, pisteConf: 120, voieEss: 160, voieConf: 220, laser: 300, vide: 120 };
  var POIDS = { bowling: 1.5, laser: 1.25, defaut: 1, sansHeure: 0.75, vide: 0 };
  // LES PALIERS D ECRITURE, selon la hauteur d une demi-heure (spec 3.4). Le
  // nom ne descend jamais sous 11 px, jamais sous 12 px des que la
  // demi-heure fait 16 px ; l interligne depasse la police d au moins 1 px.
  var PALIERS = [
    { cle: 'p1', demi: 26, ligne: 15, nom: 13, petit: 12, bord: 1, marge: 1 },
    { cle: 'p2', demi: 20, ligne: 14, nom: 12.5, petit: 11.5, bord: 1, marge: 0 },
    { cle: 'p3', demi: 16, ligne: 13, nom: 12, petit: 11, bord: 0, marge: 0 },
    { cle: 'p4', demi: 0, ligne: 12, nom: 11, petit: 11, bord: 0, marge: 0, sansDetail: true },
  ];
  function ghTypo(demi) {
    var p = PALIERS[PALIERS.length - 1];
    for (var i = 0; i < PALIERS.length; i += 1) if (demi >= PALIERS[i].demi) { p = PALIERS[i]; break; }
    return {
      palier: p.cle, ligne: p.ligne, tailleNom: p.nom, taillePetit: p.petit, bord: p.bord, marge: p.marge,
      cadre: 2 * (p.bord + p.marge), sansDetail: Boolean(p.sansDetail),
      nom: '650 ' + p.nom + 'px', petit: '600 ' + p.petit + 'px', fort: '650 ' + p.petit + 'px', tag: '700 ' + p.petit + 'px',
    };
  }
  var POLICE_TETE = '650 13px';
  var POLICE_TETE_PETITE = '600 11px';
  var POLICE_PASTILLE = '650 11px';
  // (le compte d une partie basse, dans ses 34 px a gauche de la barre)
  var POLICE_COMPTE_BAS = '650 10.5px';

  // ---- LA MESURE ----------------------------------------------------------------
  // Une suite de n chiffres vaut n fois le plus large des dix chiffres (les
  // nombres s ecrivent en tabular-nums) ; chaque morceau mesure prend 1 px de
  // marge (la somme des morceaux d une ligne reste sous la ligne rendue).
  function mesureur(mesure, cache) {
    var memo = cache || new Map();
    var m = function (police, texte) {
      var k = police + '|' + texte;
      var v = memo.get(k);
      if (v == null) { v = Number(mesure(police, String(texte))) || 0; memo.set(k, v); }
      return v;
    };
    var chiffre = function (police) {
      var k = police + '|#chiffre';
      var v = memo.get(k);
      if (v == null) { v = 0; for (var d = 0; d <= 9; d += 1) v = Math.max(v, m(police, String(d))); memo.set(k, v); }
      return v;
    };
    var tab = function (police, texte) {
      var total = 0;
      String(texte).split(/(\d+)/).forEach(function (bout) {
        if (!bout) return;
        total += /^\d+$/.test(bout) ? bout.length * chiffre(police) : m(police, bout);
      });
      return total;
    };
    return { m: m, tab: tab, chiffre: chiffre };
  }

  // ---- L AXE DES HEURES -----------------------------------------------------------
  // Lineaire (spec 3.3) : y(t) = origine + round((t - debut) x hh). Le plan garde
  // l axe en donnees ; ghY et ghT le lisent ; ghAxe rend aussi y() et t().
  function ghY(axe, t) { return axe.origine + Math.round((t - axe.debut) * axe.hh); }
  function ghT(axe, y) { return axe.debut + (y - axe.origine) / axe.hh; }
  function axeDonnees(plage, hh, origine) {
    var axe = { debut: plage.debut, fin: plage.fin, hh: hh, demi: hh / 2, origine: origine == null ? ORIGINE : origine };
    axe.corps = ghY(axe, plage.fin) + axe.origine;
    return axe;
  }
  function ghAxe(plage, hh, origine) {
    var axe = axeDonnees(plage, hh, origine);
    return Object.assign({}, axe, { y: function (t) { return ghY(axe, t); }, t: function (y) { return ghT(axe, y); } });
  }
  function ghHauteurHeure(H, heures) {
    var hh = Math.floor(H / Math.max(0.5, heures) / 2) * 2;
    return Math.max(6, Math.min(HEURE_MAX, hh));
  }

  // ---- LES TEXTES ---------------------------------------------------------------
  function sansAccents(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function cleTexte(s) { return sansAccents(s).toLowerCase(); }
  function espaces(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function heureTexte(h) {
    if (h == null || !Number.isFinite(Number(h))) return '';
    var m = Math.round(Number(h) * 60);
    return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(((m % 60) + 60) % 60).padStart(2, '0');
  }
  function aligneDemi(h) { return Math.round(Number(h) * 60) % 30 === 0; }
  function pluriel(n, mot, motPluriel) { return n + ' ' + (n > 1 ? (motPluriel || mot + 's') : mot); }
  function hacher(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + '.' + s.length.toString(36);
  }
  function comparer(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function texteRuns(pistes) {
    var morceaux = [];
    pistes.forEach(function (p) { var d = morceaux[morceaux.length - 1]; if (d && p === d[1] + 1) d[1] = p; else morceaux.push([p, p]); });
    return morceaux.map(function (m) { return m[0] === m[1] ? String(m[0]) : m[0] + '-' + m[1]; }).join(', ');
  }

  // ---- LE PREFIXE DU JOUR (spec 9.1) ------------------------------------------------
  // Le plus long debut de nom qui finit par « · », « - » ou « : » entoure
  // d espaces, de 2 a 16 caracteres, porte par au moins 60 % des groupes du
  // jour et par au moins 3 (« DÉMO · »). Les cartes l enlevent ; le panneau,
  // la fiche, la recherche et le lecteur d ecran gardent le nom complet.
  var SEUIL_PREFIXE = 0.6;
  function ghPrefixe(noms) {
    var liste = (noms || []).map(function (n) { return String(n || ''); }).filter(Boolean);
    var n = liste.length;
    if (n < 3) return '';
    var seuil = Math.max(3, Math.ceil(n * SEUIL_PREFIXE - 1e-9));
    var compte = new Map();
    liste.forEach(function (nom) {
      var vus = new Set();
      var re = / [·:-] /g;
      var m;
      while ((m = re.exec(nom))) {
        var p = nom.slice(0, m.index + 3);
        re.lastIndex = m.index + 1;
        if (p.length < 2 || p.length > 16 || !nom.slice(p.length).trim() || vus.has(p)) continue;
        vus.add(p);
        compte.set(p, (compte.get(p) || 0) + 1);
      }
    });
    var meilleur = '';
    compte.forEach(function (c, p) { if (c >= seuil && (p.length > meilleur.length || (p.length === meilleur.length && p < meilleur))) meilleur = p; });
    return meilleur;
  }

  // ---- LES FORMES D UN NOM (spec 9.2, 9.3) ---------------------------------------
  var LIAISONS = new Set(['de', 'du', 'des', "d'", 'la', 'le', 'les', "l'", 'et', 'a', 'au', 'aux', 'en', 'ses', 'leurs', 'sur', 'pour', 'avec', 'entre', '&']);
  // Le dictionnaire du comptoir : les types de groupe et leur abreviation.
  var TYPES = { anniversaire: 'Anniv.', famille: 'Fam.', collegues: 'Coll.', collegue: 'Coll.', equipe: 'Éq.', entreprise: 'Entr.', federation: 'Féd.', seminaire: 'Sémin.', association: 'Asso.', groupe: 'Gr.', mouvement: 'Mvt' };
  var TYPES_SANS = new Set(['amis', 'cousins', 'club', 'team', 'tournoi', 'patro', 'kot', 'couple', 'duo', 'bande', 'scouts']);
  // Les mots faibles ne portent jamais seuls un nom.
  var FAIBLES = new Set(['fin', 'laser', 'bowling', 'minigolf', 'arcades', 'billard', 'groupe', 'team', 'club', 'royal', 'inter', 'soiree']);
  var ABREVIATIONS = new Set(['anniv.', 'fam.', 'coll.', 'eq.', 'entr.', 'fed.', 'semin.', 'asso.', 'gr.', 'mvt', 'evg', 'evjf', 'st', 'ste']);
  var VOYELLES = 'aeiouyàâäéèêëîïôöùûüÿæœ';

  function majusculeInitiale(t) { var c = t.charAt(0); return c && c !== c.toUpperCase() ? c.toUpperCase() + t.slice(1) : t; }
  function ghJetons(texte) {
    var jetons = [];
    espaces(texte).split(' ').filter(Boolean).forEach(function (mot) {
      var el = /^([dDlL])(['’])(.+)$/.exec(mot);
      if (el) { jetons.push({ t: el[1] + el[2], colle: true }); jetons.push({ t: el[3] }); return; }
      jetons.push({ t: mot });
    });
    return jetons;
  }
  function texteJetons(jetons) {
    var s = '';
    jetons.forEach(function (j, i) { s += j.t; if (i < jetons.length - 1 && !j.colle) s += ' '; });
    return s;
  }
  function estLiaison(j) { return Boolean(j.colle) || LIAISONS.has(cleTexte(j.t)); }
  function estType(j) { var k = cleTexte(j.t); return Boolean(j.abr) || Boolean(TYPES[k]) || TYPES_SANS.has(k); }
  function estFaible(j) { return FAIBLES.has(cleTexte(j.t)); }
  function aChiffre(t) { return /\d/.test(t); }
  function estSigle(t) {
    var lettres = String(t).replace(/[^A-Za-zÀ-ɏ]/g, '');
    return lettres.length >= 2 && lettres === lettres.toUpperCase() && lettres !== lettres.toLowerCase();
  }
  function commenceMajuscule(t) { var c = String(t).charAt(0); return c !== c.toLowerCase() && c === c.toUpperCase(); }
  // Un nom propre porte une capitale hors du premier mot, ou c est un sigle, ou
  // un mot avec chiffre ; le premier mot compte s il n est ni un type ni un
  // mot faible.
  function estPropre(j, i) {
    if (estLiaison(j) || estType(j) || estFaible(j)) return false;
    return i === 0 || commenceMajuscule(j.t) || estSigle(j.t) || aChiffre(j.t);
  }
  function estPorteur(j) { return !estLiaison(j) && !estType(j) && !estFaible(j); }
  // LE COEUR : la premiere suite de noms propres ou de codes sans liaison au
  // milieu ; un code a chiffre emmene le mot qui le precede (« foot U12 ») ;
  // sans nom propre, le premier mot porteur ; sans mot porteur, les deux
  // premiers mots avec leur liaison.
  function ghCoeur(jetons) {
    var n = jetons.length;
    for (var i = 0; i < n; i += 1) {
      if (!estPropre(jetons[i], i)) continue;
      var j = i;
      while (j + 1 < n && estPropre(jetons[j + 1], j + 1)) j += 1;
      var a = i;
      if (aChiffre(jetons[i].t) && i > 0 && !estLiaison(jetons[i - 1])) a = i - 1;
      return { a: a, b: j };
    }
    for (var k = 0; k < n; k += 1) if (estPorteur(jetons[k])) return { a: k, b: k };
    var mots = 0, b = 0;
    for (var q = 0; q < n; q += 1) { if (!estLiaison(jetons[q])) { mots += 1; b = q; if (mots === 2) break; } }
    return { a: 0, b: b };
  }
  // N3 : le dictionnaire du comptoir applique (types, EVG, EVJF, St-, Ste-).
  function appliquerDictionnaire(texte) {
    var s = String(texte)
      .replace(/enterrement de vie de jeune fille/gi, '\u0001EVJF')
      .replace(/enterrement de vie de gar[cç]on/gi, '\u0001EVG')
      .replace(/(^|[\s-])([Ss])ainte-/g, function (x, a, s0) { return a + s0 + 'te-'; })
      .replace(/(^|[\s-])([Ss])aint-/g, function (x, a, s0) { return a + s0 + 't-'; });
    return ghJetons(s).map(function (j) {
      if (j.t.charAt(0) === '\u0001') return { t: j.t.slice(1), abr: true };
      var abr = !j.colle && TYPES[cleTexte(j.t)];
      if (!abr) return j;
      return { t: commenceMajuscule(j.t) ? abr : abr.charAt(0).toLowerCase() + abr.slice(1), abr: true };
    });
  }
  // N9 : les 4 premieres lettres si la 4e est une consonne, sinon les 3
  // premieres si la 3e en est une, sinon les 4 premieres, suivies d un point.
  function abreviationCle(t) {
    var l3 = t.charAt(2).toLowerCase(), l4 = t.charAt(3).toLowerCase();
    if (l4 && VOYELLES.indexOf(l4) < 0) return t.slice(0, 4) + '.';
    if (l3 && VOYELLES.indexOf(l3) < 0) return t.slice(0, 3) + '.';
    return t.slice(0, 4) + '.';
  }
  // L ECHELLE BRUTE, de la plus longue a la plus courte, chaque forme une
  // fois : N1 le nom sans prefixe, N2 sans l age, N3 au dictionnaire, N4
  // coupee apres le coeur, N5 type abrege + coeur, N6 le coeur, N7 la cle,
  // N8 la cle composee abregee, N9 l abreviation de la cle.
  function ghFormesBrutes(nomComplet, prefixe) {
    var n1 = espaces(nomComplet);
    if (prefixe && n1.indexOf(prefixe) === 0 && n1.length > prefixe.length) n1 = espaces(n1.slice(prefixe.length));
    var formes = [];
    var ajouter = function (n, t) {
      t = espaces(t);
      if (n >= 4) t = majusculeInitiale(t);
      if (!t || formes.some(function (f) { return f.t === t; })) return;
      formes.push({ n: n, t: t });
    };
    ajouter(1, n1);
    var n2 = n1.replace(/\s*\(\s*\d+\s*ans?\s*\)\s*$/i, '');
    ajouter(2, n2);
    var j3 = appliquerDictionnaire(n2);
    if (!j3.length) return { formes: formes, cle: cleTexte(n1), cleForme: n1 };
    ajouter(3, texteJetons(j3));
    var c = ghCoeur(j3);
    if (c.b < j3.length - 1) {
      var avant = j3.slice(0, c.b + 1);
      if (avant.filter(function (j) { return !j.colle; }).length >= 2) ajouter(4, texteJetons(avant) + '…');
    }
    var coeur = j3.slice(c.a, c.b + 1);
    var type = j3.slice(0, c.a).find(function (j) { return j.abr; });
    if (type) ajouter(5, type.t + ' ' + texteJetons(coeur));
    ajouter(6, texteJetons(coeur));
    var cleJ = j3[c.a];
    var cleT = cleJ.t;
    var valide = !estLiaison(cleJ) && !estType(cleJ) && !estFaible(cleJ);
    if (valide) ajouter(7, cleT);
    var lettres = cleT.replace(/[^A-Za-zÀ-ɏ]/g, '').length;
    var propre = valide && commenceMajuscule(cleT) && !estSigle(cleT) && !aChiffre(cleT);
    if (propre && lettres > 5) {
      if (cleT.indexOf('-') > 0) {
        var parts = cleT.split('-');
        if (parts[0].length > 3 && parts[1]) ajouter(8, parts[0] + '-' + parts[1].charAt(0) + '.');
      } else {
        ajouter(9, abreviationCle(cleT));
      }
    }
    return { formes: formes, cle: cleTexte(cleT), cleForme: valide ? majusculeInitiale(cleT) : '' };
  }
  // L ECHELLE GARDEE : une forme n est gardee que si elle est au moins 10 %
  // plus etroite que la precedente gardee.
  function ghFormes(nom, contexte) {
    var ctx = contexte || {};
    var largeur = ctx.largeur || function (t) { return String(t).length * 7; };
    var gardees = [];
    ghFormesBrutes(nom, ctx.prefixe || '').formes.forEach(function (f) {
      var w = largeur(f.t);
      if (gardees.length && w > 0.9 * gardees[gardees.length - 1].w + 1e-9) return;
      gardees.push({ n: f.n, t: f.t, w: w });
    });
    return gardees;
  }
  // La forme distinctive : la cle si elle a survecu, sinon la plus courte des
  // formes N1 a N7 qui restent.
  function distinctive(e) {
    var i = e.cleForme ? e.formes.findIndex(function (f) { return f.base === e.cleForme; }) : -1;
    if (i >= 0) return i;
    var best = 0;
    e.formes.forEach(function (f, k) { if (f.n <= 7 && f.w < e.formes[best].w) best = k; });
    return best;
  }
  // L UNICITE SUR TOUTE LA GRILLE (spec 9.4) : deux groupes n ecrivent jamais
  // le meme texte. Une abreviation ambigue tombe (« Max. » quand il y a Maxime
  // et Maximilien), une abreviation du dictionnaire aussi (« Coll. » pour
  // Collard) ; deux noms complets identiques prennent leurs personnes, puis
  // l heure de leur premiere seance ; une forme partagee par deux groupes
  // tombe chez les deux.
  function ghUnicite(echelles, largeur) {
    var w = largeur || function (t) { return String(t).length * 7; };
    var liste = echelles.map(function (e) {
      return Object.assign({}, e, { formes: e.formes.map(function (f) { return Object.assign({}, f, { base: f.base || f.t }); }) });
    });
    liste.forEach(function (e) {
      e.formes = e.formes.filter(function (f, i) {
        if (i === 0 || /\s/.test(f.t) || !/\.$/.test(f.t)) return true;
        if (ABREVIATIONS.has(cleTexte(f.t))) return false;
        var base = cleTexte(f.t.replace(/\.$/, ''));
        return !liste.some(function (o) { return o !== e && o.cle && o.cle.indexOf(base) === 0; });
      });
    });
    var parNom = new Map();
    liste.forEach(function (e) { var k = cleTexte(e.formes[0].t); if (!parNom.has(k)) parNom.set(k, []); parNom.get(k).push(e); });
    parNom.forEach(function (homonymes) {
      if (homonymes.length < 2) return;
      homonymes.forEach(function (e) {
        var memes = homonymes.filter(function (o) { return o.personnes === e.personnes; }).length > 1;
        var suffixe = ' (' + e.personnes + ')' + (memes && e.heure ? ' · ' + e.heure : '');
        e.formes.forEach(function (f) { f.t = f.t + suffixe; f.w = w(f.t); });
      });
    });
    var porteurs = new Map();
    liste.forEach(function (e) {
      e.formes.forEach(function (f) {
        var k = cleTexte(f.t);
        if (!porteurs.has(k)) porteurs.set(k, new Set());
        porteurs.get(k).add(e.id);
      });
    });
    liste.forEach(function (e) {
      e.formes = e.formes.filter(function (f, i) { return i === 0 || porteurs.get(cleTexte(f.t)).size < 2; });
      e.distinctive = distinctive(e);
    });
    return liste;
  }
  // Tous les noms du jour : le prefixe, les echelles gardees, l unicite.
  function ghNoms(groupes, police, M) {
    var prefixe = ghPrefixe(groupes.map(function (g) { return g.nom; }));
    var largeur = function (t) { return M.m(police, t); };
    var echelles = groupes.map(function (g) {
      var brut = ghFormesBrutes(g.nom, prefixe);
      var formes = ghFormes(g.nom, { prefixe: prefixe, largeur: largeur });
      return { id: g.id, formes: formes, cle: brut.cle, cleForme: brut.cleForme, personnes: g.personnes, heure: g.heure || '' };
    });
    var parId = new Map();
    ghUnicite(echelles, largeur).forEach(function (e) { parId.set(e.id, e); });
    return { prefixe: prefixe, parId: parId };
  }

  // ---- LA COUPURE GLOUTONNE ------------------------------------------------------
  // La meme que le navigateur : on remplit la ligne tant que le morceau suivant
  // tient, on coupe aux espaces et apres un trait d union. Rend les lignes, ou
  // rien si un morceau ne tient pas ou s il faut plus de lignes. (largeurs :
  // la premiere ligne peut etre plus courte, la place du compte d une presence)
  function casser(unites, tw, Lmax, premiere) {
    var lignes = [];
    var cur = [];
    var larg = 0;
    var lim = function () { return lignes.length === 0 && premiere != null ? premiere : tw; };
    for (var i = 0; i < unites.length; i += 1) {
      var u = unites[i];
      if (!cur.length) { if (u.w > lim() + 1e-9) return null; cur = [u]; larg = u.w; continue; }
      var avec = larg + u.sep + u.w;
      if (avec <= lim() + 1e-9) { cur.push(u); larg = avec; continue; }
      lignes.push(cur);
      if (lignes.length >= Lmax || u.w > lim() + 1e-9) return null;
      cur = [u];
      larg = u.w;
    }
    if (cur.length) lignes.push(cur);
    return lignes.length <= Lmax ? lignes : null;
  }
  function largeurLigne(unites) {
    var s = 0;
    unites.forEach(function (u, i) { s += u.w + (i ? u.sep : 0); });
    return s;
  }
  // Les morceaux d un nom : ses mots, chacun coupable apres son trait d union.
  function unitesNom(texte, M, typo, esp) {
    var unites = [];
    String(texte).split(' ').forEach(function (mot) {
      mot.split(/(?<=-)(?=.)/).forEach(function (m, j) {
        unites.push({ k: 'nom', t: m, w: M.m(typo.nom, m) + 1, sep: j === 0 ? esp : 0, mot: j === 0 });
      });
    });
    return unites;
  }

  // ---- LES ETIQUETTES (spec 9.5) ------------------------------------------------------
  // Longues puis courtes : « retard 12 min » puis « +12 », « à valider » puis
  // « ? », « à clôturer » puis « € », « pas venu » puis « × », « laser à
  // placer » puis « laser ? », « conflit P3 » puis « ! », « piste ? ».
  var TAGS = {
    retard: { cls: 'is-retard', long: function (x) { return 'retard ' + x + ' min'; }, court: function (x) { return '+' + x; } },
    valider: { cls: 'is-valider', long: function () { return 'à valider'; }, court: function () { return '?'; } },
    cloturer: { cls: 'is-cloturer', long: function () { return 'à clôturer'; }, court: function () { return '€'; } },
    absent: { cls: 'is-absent', long: function () { return 'pas venu'; }, court: function () { return '×'; } },
    aplacer: { cls: 'is-valider', long: function () { return 'laser à placer'; }, court: function () { return 'laser ?'; } },
    conflit: { cls: 'is-conflit', long: function (x) { return 'conflit ' + x; }, court: function () { return '!'; } },
    piste: { cls: 'is-piste', long: function () { return 'piste ?'; }, court: function () { return 'piste ?'; } },
  };
  var ORDRE_TAGS = ['retard', 'valider', 'cloturer', 'absent', 'aplacer', 'conflit', 'piste'];
  function uniteTag(tag, forme, M, typo, esp) {
    var def = TAGS[tag.code];
    // (un retard se mesure au gabarit de ses chiffres : 12 et 99 ont la meme largeur)
    var mesure = tag.code === 'retard' ? '9'.repeat(Math.max(2, String(tag.v).length)) : tag.v;
    var t = forme === 'court' ? def.court(tag.v) : def.long(tag.v);
    var tm = forme === 'court' ? def.court(mesure) : def.long(mesure);
    return { k: 'tag', code: tag.code, forme: forme, t: t, v: tag.v, w: M.tab(typo.tag, tm) + (forme === 'court' ? 8 : 10) + 1, sep: esp };
  }

  // ---- LA COMPOSITION D UNE CARTE (spec 9.5) --------------------------------------
  // carte : { heure: {t, aligne} | null, arrivee, formes: [{t}], tags: [{code, v}],
  // pictos: n, detail: [t], detailBowling, infos: [t] }. Les niveaux, dans
  // l ordre : 1 tout ; 2 sans les infos ; 3 sans l heure alignee (la grille la
  // dit) ; 4 sans les pictos ; 5 sans le detail, element par element ; 6 sans
  // l heure restante ; 7 etiquettes courtes ; 8 le nom descend l echelle ;
  // 9 sans etiquettes, le nom reprend la plus longue forme qui tient ; 10 une
  // carte d arrivee laisse enfin son heure (et refait 8 et 9) ; 11 rien.
  function configsCarte(c, L, typo) {
    var configs = [];
    var nF = c.formes.length;
    var aHeure = Boolean(c.heure);
    var aligne = aHeure && c.heure.aligne;
    var arr = Boolean(c.arrivee);
    var detailMax = typo.sansDetail ? 0 : c.detail.length;
    var det = function (niveau) { return c.detailBowling && (niveau > 2 || L < 2) ? 0 : detailMax; };
    var cfg = { niveau: 1, heure: aHeure, nom: 0, tags: 'long', pictos: c.pictos > 0, det: det(1), infos: !typo.sansDetail && c.infos.length > 0 };
    configs.push(cfg);
    configs.push(cfg = Object.assign({}, cfg, { niveau: 2, infos: false }));
    configs.push(cfg = Object.assign({}, cfg, { niveau: 3, heure: aHeure && (!aligne || arr), det: det(3) }));
    configs.push(cfg = Object.assign({}, cfg, { niveau: 4, pictos: false }));
    for (var d = cfg.det - 1; d >= 0; d -= 1) configs.push(Object.assign({}, cfg, { niveau: 5, det: d }));
    cfg = Object.assign({}, cfg, { det: 0 });
    configs.push(cfg = Object.assign({}, cfg, { niveau: 6, heure: aHeure && arr }));
    configs.push(cfg = Object.assign({}, cfg, { niveau: 7, tags: 'court' }));
    for (var i = 1; i < nF; i += 1) configs.push(Object.assign({}, cfg, { niveau: 8, nom: i }));
    for (var k = 0; k < nF; k += 1) configs.push(Object.assign({}, cfg, { niveau: 9, nom: k, tags: 'aucun' }));
    if (arr && aHeure) {
      for (var a = 0; a < nF; a += 1) configs.push(Object.assign({}, cfg, { niveau: 10, nom: a, heure: false, tags: 'court' }));
      for (var b = 0; b < nF; b += 1) configs.push(Object.assign({}, cfg, { niveau: 10, nom: b, heure: false, tags: 'aucun' }));
    }
    return configs;
  }
  function essayer(c, cfg, tw, L, M, typo, esp) {
    var tete = [];
    if (cfg.heure) tete.push({ k: 'h', t: c.heure.t, w: M.tab(typo.petit, c.heure.t) + 1, sep: esp });
    c.unitesFormes[cfg.nom].forEach(function (u) { tete.push(u); });
    if (cfg.tags !== 'aucun') c.tags.forEach(function (t) { tete.push(uniteTag(t, cfg.tags, M, typo, esp)); });
    if (cfg.pictos) tete.push({ k: 'pictos', n: c.pictos, w: c.pictos * 13 + (c.pictos - 1) * 3 + 1, sep: esp });
    var basT = c.detail.slice(0, cfg.det).concat(cfg.infos ? c.infos : []).join(' · ');
    var bas = basT ? { k: 'bas', t: basT, w: M.tab(typo.petit, basT) + 1, sep: esp } : null;
    if (L >= 2 && bas) {
      if (bas.w > tw + 1e-9) return null;
      var lignes = casser(tete, tw, L - 1);
      return lignes ? { lignes: lignes, bas: bas } : null;
    }
    var l2 = casser(bas ? tete.concat([bas]) : tete, tw, L);
    return l2 ? { lignes: l2, bas: null } : null;
  }
  function preparer(carte, M, typo) {
    var esp = M.m(typo.nom, ' ');
    if (!carte.unitesFormes || carte.unitesTypo !== typo.nom) {
      carte.unitesFormes = carte.formes.map(function (f) { return unitesNom(f.t, M, typo, esp); });
      carte.unitesTypo = typo.nom;
    }
    return esp;
  }
  function ghComposer(carte, boite, typo, mesure, options) {
    var M = mesure && mesure.m ? mesure : mesureur(mesure);
    var L = boite.L, tw = boite.tw;
    if (!(L >= 1) || !(tw >= 1)) return null;
    var esp = preparer(carte, M, typo);
    var min = (options && options.niveauMin) || 1;
    var configs = configsCarte(carte, L, typo);
    for (var i = 0; i < configs.length; i += 1) {
      if (configs[i].niveau < min) continue;
      var r = essayer(carte, configs[i], tw, L, M, typo, esp);
      if (r) return { niveau: configs[i].niveau, cfg: configs[i], forme: configs[i].nom, lignes: r.lignes, bas: r.bas, tw: tw, L: L };
    }
    return null;
  }

  // LA COMPOSITION D UNE PRESENCE DE PLAINE (spec 7.2) : le nom a gauche, le
  // nombre d enfants a droite, 6 px au moins entre les deux, « 14 enf. » s il
  // reste 28 px, sinon « 14 » ; sous 40 px, le compte seul au centre ; des
  // 40 px, le nom passe avant le compte.
  function ghComposerPresence(p, boite, typo, mesure) {
    var M = mesure && mesure.m ? mesure : mesureur(mesure);
    var L = boite.L, tw = boite.tw;
    if (!(L >= 1) || !(tw >= 1)) return null;
    preparer(p, M, typo);
    var comptes = [p.enfants + ' enf.', String(p.enfants)].map(function (t) { return { t: t, w: M.tab(typo.tag, t) + 1 }; });
    var seul = function (niveau) { return comptes[1].w <= tw + 1e-9 ? { niveau: niveau, forme: -1, lignes: [], compte: comptes[1].t, seul: true, tw: tw, L: L } : null; };
    if (boite.bw < 40) return seul(1);
    for (var i = 0; i < p.unitesFormes.length; i += 1) {
      for (var k = 0; k < 2; k += 1) {
        var c = comptes[k];
        if (k === 0 && tw - c.w - 6 < 28) continue;
        var lignes = casser(p.unitesFormes[i], tw, L, tw - c.w - 6);
        if (lignes) return { niveau: 1 + k + 2 * i, forme: i, lignes: lignes, compte: c.t, tw: tw, L: L };
      }
      // (L >= 2 : le compte seul en haut a droite, le nom des la ligne 2)
      var dessous = L >= 2 && comptes[1].w <= tw + 1e-9 ? casser(p.unitesFormes[i], tw, L - 1) : null;
      if (dessous) return { niveau: 2 + 2 * i, forme: i, lignes: dessous, compte: comptes[1].t, sousCompte: true, tw: tw, L: L };
    }
    for (var q = 0; q < p.unitesFormes.length; q += 1) {
      var l = casser(p.unitesFormes[q], tw, L);
      if (l) return { niveau: 50 + q, forme: q, lignes: l, compte: null, tw: tw, L: L };
    }
    return seul(60);
  }

  // LA COMPOSITION D UN SEGMENT LASER (spec 6.4) : « Lina 12 », puis le nom
  // seul, puis les formes plus courtes, puis rien ; sur deux lignes de barre,
  // le nom puis « 12 armes ». Le nombre d armes tombe avant le nom.
  function ghComposerSegment(s, boite, typo, mesure) {
    var M = mesure && mesure.m ? mesure : mesureur(mesure);
    var L = boite.L, tw = boite.tw;
    if (!(L >= 1) || !(tw >= 1)) return null;
    var esp = M.m(typo.nom, ' ');
    var formes = s.formes.map(function (f) { return { t: f.t, w: M.m(typo.nom, f.t) + 1 }; });
    var court = { t: String(s.armes), w: M.tab(typo.fort, String(s.armes)) + 1 };
    if (L >= 2) {
      var long = { t: pluriel(s.armes, 'arme'), w: M.tab(typo.fort, pluriel(s.armes, 'arme')) + 1 };
      for (var i = 0; i < formes.length; i += 1) {
        if (formes[i].w > tw + 1e-9) continue;
        var armes = long.w <= tw + 1e-9 ? long : court.w <= tw + 1e-9 ? court : null;
        return { niveau: 1 + i, forme: i, nom: formes[i].t, armes: armes ? armes.t : null, deuxLignes: true, tw: tw, L: L };
      }
      return null;
    }
    if (formes.length && formes[0].w + esp + court.w <= tw + 1e-9) return { niveau: 1, forme: 0, nom: formes[0].t, armes: court.t, tw: tw, L: L };
    for (var k = 0; k < formes.length; k += 1) if (formes[k].w <= tw + 1e-9) return { niveau: 2 + k, forme: k, nom: formes[k].t, armes: null, tw: tw, L: L };
    return null;
  }

  // ---- LES VOIES D UNE COLONNE ---------------------------------------------------------
  // Deux groupes au meme moment sur la meme activite se partagent la colonne,
  // comme deux rendez-vous d un agenda : une grappe de seances qui se
  // chevauchent se coupe en voies. Puis l expansion a droite : une carte
  // s etend sur les voies suivantes tant qu elles sont libres pendant toute sa
  // duree dessinee.
  function ghVoies(liste, finDessinee) {
    liste.sort(function (a, b) { return a.start - b.start || finDessinee(b) - finDessinee(a) || comparer(String(a.id), String(b.id)); });
    var grappe = [], fins = [], finGrappe = -Infinity;
    var fermer = function () {
      var k = Math.max(1, fins.length);
      grappe.forEach(function (s) { s.k = k; });
      grappe.forEach(function (s) {
        s.span = 1;
        for (var v = s.voie + 1; v < k; v += 1) {
          if (grappe.some(function (o) { return o !== s && o.voie === v && o.start < finDessinee(s) - 1e-6 && finDessinee(o) > s.start + 1e-6; })) break;
          s.span += 1;
        }
      });
      grappe = [];
      fins = [];
      finGrappe = -Infinity;
    };
    liste.forEach(function (s) {
      if (grappe.length && s.start >= finGrappe - 1e-6) fermer();
      var v = fins.findIndex(function (f) { return f <= s.start + 1e-6; });
      if (v < 0) { v = fins.length; fins.push(0); }
      fins[v] = finDessinee(s);
      s.voie = v;
      grappe.push(s);
      finGrappe = Math.max(finGrappe, finDessinee(s));
    });
    if (grappe.length) fermer();
    return liste;
  }

  // ---- LES PARTIES LASER (spec 6.1) ------------------------------------------------
  // Une partie reunit les entrees qui commencent a 2 min au plus du debut de sa
  // premiere entree ; ses armes sont le maximum de ce que le serveur compte
  // pour chacune (l arene, getLaserSessionArenaPlayers, calculee par la page).
  var ECART_PARTIE = 2 / 60;
  function ghParties(entrees) {
    var triees = (entrees || []).slice().sort(function (a, b) { return a.debut - b.debut || comparer(String(a.groupe || ''), String(b.groupe || '')) || comparer(String(a.id), String(b.id)); });
    var parties = [];
    triees.forEach(function (e) {
      var p = parties[parties.length - 1];
      if (p && e.debut <= p.debut + ECART_PARTIE + 1e-6) p.entrees.push(e);
      else parties.push({ debut: e.debut, entrees: [e] });
    });
    parties.forEach(function (p) {
      p.fin = Math.max.apply(null, p.entrees.map(function (e) { return e.fin; }));
      p.finDessinee = Math.max(p.fin, p.debut + 0.5);
      p.armes = Math.max.apply(null, p.entrees.map(function (e) { return Number(e.arene) || Number(e.joueurs) || 0; }));
      p.siens = p.entrees.filter(function (e) { return !e.enLigne; }).reduce(function (a, e) { return a + (Number(e.joueurs) || 0); }, 0);
      p.enLigne = p.entrees.filter(function (e) { return e.enLigne; }).reduce(function (a, e) { return a + (Number(e.joueurs) || 0); }, 0);
      p.cle = 'laser|' + Math.round(p.debut * 60);
      p.start = p.debut;
      p.id = p.cle;
    });
    return parties;
  }
  // LA BARRE D UNE PARTIE (spec 6.3) : un segment par groupe a la mesure de ses
  // armes, jamais sous son essentiel ; « autres » (les lancements paralleles,
  // la reservation en ligne) ; puis les armes libres. Ce qui deborde se reprend
  // d abord aux libres, puis aux autres (jusqu a 18 px), puis a l exces des
  // groupes au-dessus de leur essentiel.
  function ghBarre(B, C, A, segs, autres) {
    var connu = C > 0;
    var libres = connu ? Math.max(0, C - A) : 0;
    var visibles = segs.length + (autres > 0 ? 1 : 0) + (libres > 0 ? 1 : 0);
    var Bu = Math.max(0, B - ECART_SEG * Math.max(0, visibles - 1));
    var w = segs.map(function (s) { return connu ? Math.max(s.ess, s.joueurs / C * Bu) : s.ess; });
    var wA = autres > 0 ? (connu ? Math.max(18, autres / C * Bu) : 18) : 0;
    var wL = libres > 0 ? libres / C * Bu : 0;
    var somme = function () { return w.reduce(function (a, x) { return a + x; }, 0) + wA + wL; };
    if (somme() > Bu + 1e-6) {
      wL = Math.max(0, wL - (somme() - Bu));
      if (somme() > Bu + 1e-6 && wA > 18) wA = Math.max(18, wA - (somme() - Bu));
      if (somme() > Bu + 1e-6) {
        var exces = segs.map(function (s, i) { return Math.max(0, w[i] - s.ess); });
        var tot = exces.reduce(function (a, x) { return a + x; }, 0);
        var trop = somme() - Bu;
        if (tot > 1e-9) w = w.map(function (x, i) { return x - Math.min(exces[i], trop * exces[i] / tot); });
      }
      if (somme() > Bu + 1e-6) {
        var ess = segs.reduce(function (a, s) { return a + s.ess; }, 0);
        var dispo = Math.max(0, Bu - wA);
        // (les formes les plus courtes d abord, si elles tiennent toutes : le
        // reste au prorata de ce qui manque a chacun pour son essentiel)
        var courts = segs.map(function (s) { return Math.min(s.ess, s.court || 0); });
        var sc = courts.reduce(function (a, x) { return a + x; }, 0);
        var ecart = ess - sc;
        if (sc > 0 && sc <= dispo + 1e-6 && ecart > 1e-9) w = segs.map(function (s, i) { return courts[i] + (dispo - sc) * (s.ess - courts[i]) / ecart; });
        else {
          // (jamais sous 18 px, tant que 18 px chacun tiennent dans la barre)
          var plancher = 18 * segs.length <= dispo + 1e-6 ? 18 : 0;
          w = segs.map(function (s) { return Math.max(plancher, ess > 0 ? dispo * s.ess / ess : dispo / segs.length); });
        }
      }
    } else if (somme() < Bu - 1e-6 && (!connu || A > C)) {
      var joueurs = segs.reduce(function (a, s) { return a + s.joueurs; }, 0);
      var reste = Math.max(0, Bu - wA - wL);
      w = segs.map(function (s) { return Math.max(s.ess, joueurs > 0 ? reste * s.joueurs / joueurs : reste / Math.max(1, segs.length)); });
    }
    if (wL > 0 && wL < 6) wL = 0;
    var bouts = w.map(function (x, i) { return { w: x, seg: i }; });
    if (wA > 0) bouts.push({ w: wA, autres: true, seg: -1 });
    if (wL > 0) bouts.push({ w: wL, libre: true, seg: -1 });
    var cible = Math.max(0, B - ECART_SEG * Math.max(0, bouts.length - 1));
    var entiers = bouts.map(function (b) { return Math.max(0, Math.floor(b.w + 1e-9)); });
    var total = entiers.reduce(function (a, x) { return a + x; }, 0);
    var large = 0;
    bouts.forEach(function (b, i) { if (entiers[i] > entiers[large]) large = i; });
    if (bouts.length && total !== cible) entiers[large] = Math.max(0, entiers[large] + cible - total);
    var x = 0;
    return bouts.map(function (b, i) {
      var r = { x: x, w: entiers[i], autres: Boolean(b.autres), libre: Boolean(b.libre), seg: b.seg };
      x += entiers[i] + ECART_SEG;
      return r;
    });
  }

  // ---- LES ETATS A L HEURE QU IL EST (spec 2.5, 9.6, 9.7) --------------------------
  // La regle de ghEtat de la console, sans la changer : finie, en cours, a
  // venir, en retard (un groupe en retard n est pas « en cours » de ce qu il
  // n a pas commence).
  function etatSeance(s, g, entree, maintenant) {
    if (entree.passe || g.parti || g.etat === 'closing' || s.fait) return 'fini';
    if (maintenant == null) return 'avenir';
    if (s.fin <= maintenant + 1e-6) return 'fini';
    if (g.retard && s.debut <= maintenant + 1e-6) return 'retard';
    if (s.libre) return 'avenir';
    if (s.debut <= maintenant + 1e-6) return 'encours';
    return 'avenir';
  }
  // Un groupe attendu : confirme, ni arrive, ni pas venu, ni en retard.
  function attendu(g) { return g.statut !== 'arr' && g.statut !== 'paid' && !g.absent && g.etat === 'upcoming' && !g.retard; }
  function minutesRetard(g, maintenant) { return Math.max(1, Math.round((maintenant - g.depuis) * 60)); }
  function tagsDuGroupe(g, maintenant) {
    var tags = [];
    if (g.retard && maintenant != null) tags.push({ code: 'retard', v: minutesRetard(g, maintenant) });
    if (g.valider) tags.push({ code: 'valider' });
    if (g.etat === 'closing') tags.push({ code: 'cloturer' });
    if (g.etat === 'absent' || g.absent) tags.push({ code: 'absent' });
    if (g.aPlacer) tags.push({ code: 'aplacer' });
    return tags;
  }
  // Les etiquettes qu un groupe POURRAIT porter dans la journee, au pire texte
  // (« retard 99 min ») : les largeurs ne dependent pas de l heure. Le retard,
  // la cloture et « pas venu » ne vont jamais ensemble.
  // Chaque etiquette ne compte que sur les cartes qui peuvent la porter : le
  // retard sur la premiere carte du groupe (sa premiere carte en retard) ; la
  // cloture et « pas venu » (tout est fini) sur sa carte la plus large,
  // estimee sur les donnees (les pistes, les voies couvertes) ; les autres
  // sur toutes ses cartes.
  function scenariosTags(g, entree, role) {
    var r = role || { premiere: true, large: true };
    var fixes = [];
    if (g.valider) fixes.push({ code: 'valider' });
    if (g.aPlacer) fixes.push({ code: 'aplacer' });
    var moments = [];
    var vivant = g.statut !== 'paid' && !g.absent;
    if (r.premiere && entree.aujourdhui && vivant && g.statut !== 'arr') moments.push({ code: 'retard', v: 99 });
    if (r.large && (entree.aujourdhui || entree.passe) && vivant) moments.push({ code: 'cloturer' });
    if (r.large && (g.absent || g.etat === 'absent')) moments.push({ code: 'absent' });
    var ordonner = function (liste) { return liste.slice().sort(function (a, b) { return ORDRE_TAGS.indexOf(a.code) - ORDRE_TAGS.indexOf(b.code); }); };
    if (!moments.length) return [ordonner(fixes)];
    return moments.map(function (m) { return ordonner(fixes.concat([m])); });
  }
  // LA CARTE PORTEUSE (spec 9.6) des etiquettes, des pictos et des infos d un
  // groupe : sa premiere carte en retard s il est en retard ; sinon, attendu,
  // sa premiere carte ; sinon sa carte en cours (la plus large) ; sinon celle
  // qui vit encore et a le plus de place ; sinon la plus large. LA CARTE
  // D ARRIVEE (spec 9.7) : la premiere d un groupe attendu, quand elle
  // commence dans les 30 min.
  function ghEtats(entree, maintenant, plan) {
    var groupes = new Map();
    entree.groupes.forEach(function (g) { groupes.set(g.id, g); });
    var seances = new Map();
    entree.seances.forEach(function (s) { var g = groupes.get(s.groupe); if (g) seances.set(s.id, etatSeance(s, g, entree, maintenant)); });
    var etats = {};
    var candidats = new Map();
    ((plan && plan.elements) || []).forEach(function (el) {
      if (el.k !== 'carte' && el.k !== 'presence' && el.k !== 'seg') return;
      etats[el.cle] = seances.get(el.sid) || 'avenir';
      var rang = el.k === 'carte' ? (el.secondaire ? 1 : 0) : el.k === 'presence' ? 2 : 3;
      if (!candidats.has(el.gid)) candidats.set(el.gid, []);
      candidats.get(el.gid).push({ el: el, rang: rang });
    });
    var porteuses = {}, arrivees = {}, tags = {}, retard = {};
    candidats.forEach(function (liste, gid) {
      var g = groupes.get(gid);
      if (!g) return;
      var rang = Math.min.apply(null, liste.map(function (x) { return x.rang; }));
      var c = liste.filter(function (x) { return x.rang === rang; }).map(function (x) { return x.el; });
      var tot = function (a, b) { return a.debut - b.debut || a.colonne - b.colonne || a.x - b.x; };
      var large = function (a, b) { return b.bw - a.bw || tot(a, b); };
      var place = function (a, b) { return (b.bw * b.h) - (a.bw * a.h) || tot(a, b); };
      var choix = null;
      if (g.retard && maintenant != null) choix = c.filter(function (el) { return etats[el.cle] === 'retard'; }).sort(tot)[0] || null;
      if (!choix && attendu(g)) choix = c.slice().sort(tot)[0];
      if (!choix) choix = c.filter(function (el) { return etats[el.cle] === 'encours'; }).sort(large)[0] || null;
      if (!choix) choix = c.filter(function (el) { return etats[el.cle] !== 'fini'; }).sort(place)[0] || null;
      if (!choix) choix = c.slice().sort(large)[0];
      if (choix) porteuses[gid] = choix.cle;
      if (maintenant != null && attendu(g)) {
        // (la premiere de la journee, presence et segment compris : une
        // presence ou un segment n ecrit pas d heure, mais il est l arrivee)
        var premiere = liste.map(function (x) { return x.el; }).filter(function (el) { return !el.secondaire; }).sort(tot)[0];
        if (premiere && premiere.debut >= maintenant - 1e-6 && premiere.debut <= maintenant + 0.5 + 1e-6) arrivees[gid] = premiere.cle;
      }
      tags[gid] = tagsDuGroupe(g, maintenant);
      if (g.retard && maintenant != null) retard[gid] = minutesRetard(g, maintenant);
    });
    var cleTags = Object.keys(tags).sort().map(function (gid) {
      return gid + ':' + tags[gid].map(function (t) { return t.code + (t.code === 'retard' ? '#' + Math.max(2, String(t.v).length) : ''); }).join(',');
    });
    var cle = hacher(JSON.stringify([
      Object.keys(porteuses).sort().map(function (k) { return k + '=' + porteuses[k]; }),
      Object.keys(arrivees).sort().map(function (k) { return k + '=' + arrivees[k]; }),
      cleTags,
    ]));
    return { seances: seances, elements: etats, porteuses: porteuses, arrivees: arrivees, tags: tags, retard: retard, compteurs: ghCompteurs(entree, maintenant, plan), cle: cle, maintenant: maintenant };
  }
  // LES COMPTEURS DES TETES, a l heure qu il est (spec 4.9, 5.3, 6.6, 7.5, 8).
  function ghCompteurs(entree, maintenant, plan) {
    var res = {};
    var dedans = function (s) { return maintenant != null && s.debut <= maintenant + 1e-6 && s.fin > maintenant + 1e-6; };
    var ressources = entree.ressources || {};
    (entree.colonnes || []).forEach(function (col) {
      var siennes = entree.seances.filter(function (s) { return s.colonne === col.cle; });
      if (col.nature === 'bowling') {
        var occ = new Set();
        siennes.forEach(function (s) { if (dedans(s)) (s.pistes || []).forEach(function (p) { occ.add(Number(p)); }); });
        var N = plan && plan.bowling ? plan.bowling.N : ((ressources.pistes && ressources.pistes.N) || 8);
        var maint = ((ressources.pistes && ressources.pistes.maintenance) || []).map(Number);
        var libres = 0;
        for (var i = 1; i <= N; i += 1) if (!occ.has(i) && maint.indexOf(i) < 0) libres += 1;
        res[col.cle] = { occupees: Array.from(occ).sort(function (a, b) { return a - b; }), libres: libres, N: N, maintenant: maintenant };
      } else if (col.nature === 'laser') {
        var parties = plan && plan.laser ? plan.laser.parties : [];
        var C = (ressources.laser && ressources.laser.capacite) || 0;
        var enCours = maintenant == null ? null : parties.find(function (p) { return p.debut <= maintenant + 1e-6 && p.fin > maintenant + 1e-6; });
        var prochaine = maintenant == null ? null : parties.find(function (p) { return p.debut > maintenant + 1e-6; });
        var p0 = enCours || prochaine;
        res[col.cle] = { aujourdhui: maintenant != null, parties: parties.length, partie: p0 ? { debut: p0.debut, armes: p0.armes } : null, finies: maintenant != null && !p0 && parties.length > 0, C: C };
      } else if (col.nature === 'plaine') {
        var tous = siennes.reduce(function (a, s) { return a + (Number(s.enfants) || 0); }, 0);
        var la = maintenant == null ? null : siennes.filter(dedans).reduce(function (a, s) { return a + (Number(s.enfants) || 0); }, 0);
        res[col.cle] = { tous: tous, la: la };
      } else if (col.unites && col.unites.total > 0) {
        var u = maintenant == null ? null : siennes.filter(function (s) { return dedans(s) && !s.libre; }).reduce(function (a, s) { return a + Math.max(1, Number(s.unites) || 1); }, 0);
        res[col.cle] = { unites: u, total: col.unites.total, mot: col.unites.mot };
      }
    });
    return res;
  }

  // ---- LES BESOINS D UNE COLONNE (spec 4.4) -------------------------------------
  // Par dichotomie au pixel entre le plancher et le plafond : la plus petite
  // largeur ou la carte ecrit au moins sa forme distinctive et ses etiquettes
  // courtes (l essentiel), puis son nom complet avec son heure (le confort).
  function dichotomie(lo, hi, ok) {
    lo = Math.max(1, Math.floor(lo));
    hi = Math.max(lo, Math.ceil(hi));
    if (!ok(hi)) return hi;
    if (ok(lo)) return lo;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (ok(mid)) hi = mid; else lo = mid; }
    return hi;
  }
  // LE NOM D ABORD : la plus petite largeur ou la carte ecrit sa forme
  // distinctive, ses etiquettes tombees (le niveau 9 de ghComposer les laisse
  // tomber avant le nom). La repartition sert ce besoin avant l essentiel.
  // Une carte qui ne l ecrit pas meme a son plafond ne tire rien : la largeur
  // qu elle prendrait n en nommerait aucune autre.
  function besoinNom(base, L, plancher, plafond, typo, M, forme) {
    if (L < 1) return 0;
    var c = Object.assign({}, base, { tags: [], arrivee: false });
    var vise = forme == null ? base.distinctive : forme;
    var ok = function (bw) {
      var r = ghComposer(c, { tw: bw - CHROME_CARTE, L: L }, typo, M);
      return Boolean(r) && r.forme <= vise;
    };
    return ok(Math.ceil(plafond)) ? dichotomie(plancher, plafond, ok) : 0;
  }
  function besoinCarte(base, L, scenarios, plancher, plafondEss, plafondConf, typo, M) {
    if (L < 1) return { court: 0, nom: 0, ess: 0, complet: 0, conf: 0 };
    var ess = 0, conf = 0;
    var nom = besoinNom(base, L, plancher, plafondEss, typo, M);
    var court = besoinNom(base, L, plancher, plafondEss, typo, M, base.formes.length - 1);
    var complet = besoinNom(base, L, plancher, plafondConf, typo, M, 0);
    scenarios.forEach(function (tags) {
      var c = Object.assign({}, base, { tags: tags, arrivee: false });
      var e = dichotomie(plancher, plafondEss, function (bw) {
        var r = ghComposer(c, { tw: bw - CHROME_CARTE, L: L }, typo, M);
        return Boolean(r) && r.forme <= base.distinctive && (r.cfg.tags !== 'aucun' || !tags.length);
      });
      var f = dichotomie(Math.max(plancher, e), Math.max(plafondConf, e), function (bw) {
        var r = ghComposer(c, { tw: bw - CHROME_CARTE, L: L }, typo, M);
        return Boolean(r) && r.forme === 0 && (r.cfg.heure || !base.heure);
      });
      ess = Math.max(ess, e);
      conf = Math.max(conf, f);
    });
    conf = Math.max(ess, conf);
    nom = Math.min(nom, ess);
    return { court: Math.min(court || nom, nom), nom: nom, ess: ess, complet: Math.min(conf, Math.max(ess, complet)), conf: conf };
  }
  function besoinPresence(p, L, typo, M) {
    if (L < 1) return { court: 0, nom: 0, ess: 0, complet: 0, conf: 0 };
    preparer(p, M, typo);
    var court = M.tab(typo.tag, String(p.enfants)) + 1;
    var long = M.tab(typo.tag, p.enfants + ' enf.') + 1;
    var dist = p.unitesFormes[p.distinctive] || p.unitesFormes[0];
    var e = dichotomie(40, PLAFONDS.voieEss, function (bw) { var tw = bw - CHROME_CARTE; return Boolean(casser(dist, tw, L, tw - court - 6)); });
    var derniere = p.unitesFormes[p.unitesFormes.length - 1];
    // (la forme la plus courte, elle aussi a cote du compte : la plaine est faite de presences nommees et comptees)
    var k = dichotomie(40, e, function (bw) { var tw = bw - CHROME_CARTE; return Boolean(casser(derniere, tw, L, tw - court - 6)); });
    var f = dichotomie(e, PLAFONDS.voieConf, function (bw) { var tw = bw - CHROME_CARTE; return tw - long - 6 >= 28 && Boolean(casser(p.unitesFormes[0], tw, L, tw - long - 6)); });
    return { court: Math.min(k, e), nom: e, ess: e, complet: Math.max(e, f), conf: Math.max(e, f) };
  }
  function besoinSegment(s, typo, M) {
    var dist = s.formes[s.distinctive] || s.formes[0];
    var ess = Math.ceil(M.m(typo.nom, dist.t) + 1 + CHROME_SEG);
    var court = Math.ceil(M.m(typo.nom, s.formes[s.formes.length - 1].t) + 1 + CHROME_SEG);
    var conf = Math.ceil(M.m(typo.nom, s.formes[0].t) + 1 + M.m(typo.nom, ' ') + M.tab(typo.fort, String(s.armes)) + 1 + CHROME_SEG);
    return { court: Math.min(court, ess), ess: ess, conf: Math.max(ess, conf) };
  }

  // ---- LA REPARTITION DES LARGEURS (spec 4.5) -------------------------------------------
  // Chaque colonne recoit son plancher ; le reste va vers l essentiel puis vers
  // le confort, par remplissage pondere par la priorite du comptoir ; ce qui
  // reste va d abord aux colonnes vides (jusqu a 120 px), puis a toutes les
  // colonnes utilisees au prorata de leurs sous-colonnes. Les pistes sont
  // egales ; pixels entiers, la somme vaut exactement la largeur.
  function remplirVers(besoins, alloc, poids, cle, R) {
    for (var tour = 0; tour < 64 && R >= 0.5; tour += 1) {
      var denom = 0;
      var actifs = [];
      for (var i = 0; i < besoins.length; i += 1) {
        var manque = besoins[i][cle] - alloc[i];
        if (manque > 1e-6 && poids[i] > 0) { actifs.push(i); denom += manque * poids[i]; }
      }
      if (!actifs.length || denom <= 0) break;
      var donne = 0;
      actifs.forEach(function (j) {
        var m = besoins[j][cle] - alloc[j];
        var d = Math.min(m, R * m * poids[j] / denom);
        alloc[j] += d;
        donne += d;
      });
      R -= donne;
      if (donne < 1e-9) break;
    }
    return R;
  }
  function ghRepartir(besoins, largeur, poids, ecran) {
    var n = besoins.length;
    var Wd = Math.max(0, Math.floor(largeur));
    var tel = Boolean(ecran && ecran.largeurFenetre < 768);
    var alloc = besoins.map(function (b) { return b.plancher; });
    var somme = function () { return alloc.reduce(function (a, x) { return a + x; }, 0); };
    var reduit = false, defile = false, essentielAtteint = true;
    var utilisees = besoins.map(function (b) { return !b.vide; });
    if (!utilisees.some(Boolean) && n) {
      // Jour vide ou ferme : parts egales, le bowling en prend deux.
      var parts = besoins.map(function (b) { return b.bowling ? 2 : 1; });
      var totParts = parts.reduce(function (a, x) { return a + x; }, 0);
      alloc = parts.map(function (p, i) { return Math.max(besoins[i].plancher, Wd * p / totParts); });
      if (somme() > Wd) {
        if (tel) { defile = true; Wd = Math.ceil(somme()); }
        else { var f0 = Wd / somme(); alloc = alloc.map(function (x, i) { return Math.max(besoins[i].sous * 20, x * f0); }); }
      }
    } else {
      if (tel) {
        alloc = besoins.map(function (b) { return Math.max(b.plancher, b.essentiel); });
        if (somme() > Wd) { defile = true; Wd = Math.ceil(somme()); }
      } else if (somme() > Wd) {
        reduit = true;
        var f = Wd / somme();
        alloc = besoins.map(function (b) { return Math.max(b.sous * 20, b.plancher * f); });
      }
      var R = Wd - somme();
      R = remplirVers(besoins, alloc, poids, 'court', R);
      R = remplirVers(besoins, alloc, poids, 'nom', R);
      R = remplirVers(besoins, alloc, poids, 'essentiel', R);
      for (var i = 0; i < n; i += 1) if (utilisees[i] && poids[i] > 0 && alloc[i] < besoins[i].essentiel - 0.5) essentielAtteint = false;
      if (R >= 0.5) R = remplirVers(besoins, alloc, poids, 'complet', R);
      if (R >= 0.5) R = remplirVers(besoins, alloc, poids, 'confort', R);
      for (var t = 0; t < 64 && R >= 0.5; t += 1) {
        var vides = [];
        for (var v = 0; v < n; v += 1) if (besoins[v].vide && alloc[v] < PLAFONDS.vide - 1e-6) vides.push(v);
        if (!vides.length) break;
        var part = R / vides.length;
        var donne = 0;
        vides.forEach(function (v2) { var d = Math.min(PLAFONDS.vide - alloc[v2], part); alloc[v2] += d; donne += d; });
        R -= donne;
        if (donne < 1e-9) break;
      }
      if (R >= 0.5) {
        var sousTot = 0;
        for (var u = 0; u < n; u += 1) if (utilisees[u]) sousTot += besoins[u].sous;
        for (var u2 = 0; u2 < n; u2 += 1) if (utilisees[u2]) alloc[u2] += R * besoins[u2].sous / sousTot;
      }
    }
    // Les pistes egales ; puis l arrondi : les pixels restants un a un aux
    // colonnes les plus larges hors bowling (sinon a la derniere piste).
    var largeurs = alloc.map(function (x) { return Math.floor(x + 1e-9); });
    var ib = besoins.findIndex(function (b) { return b.bowling; });
    var wL = 0;
    if (ib >= 0) { wL = Math.floor(alloc[ib] / besoins[ib].sous + 1e-9); largeurs[ib] = wL * besoins[ib].sous; }
    var D = Wd - largeurs.reduce(function (a, x) { return a + x; }, 0);
    var ordre = [];
    for (var k = 0; k < n; k += 1) if (k !== ib) ordre.push(k);
    ordre.sort(function (a, b) { return alloc[b] - alloc[a] || a - b; });
    var extraPiste = 0;
    if (D > 0) {
      if (ordre.length) for (var q = 0; q < D; q += 1) largeurs[ordre[q % ordre.length]] += 1;
      else if (ib >= 0) { largeurs[ib] += D; extraPiste = D; }
    } else if (D < 0) {
      for (var r = 0; r < 4096 && D < 0; r += 1) {
        var j = ordre.filter(function (x) { return largeurs[x] > besoins[x].sous * 20; }).sort(function (a, b) { return largeurs[b] - largeurs[a] || a - b; })[0];
        if (j == null) break;
        largeurs[j] -= 1;
        D += 1;
      }
    }
    return { largeurs: largeurs, wL: wL, extraPiste: extraPiste, reduit: reduit, defile: defile, essentielAtteint: essentielAtteint && !reduit, total: largeurs.reduce(function (a, x) { return a + x; }, 0) };
  }

  // ---- LES TETES (spec 4.9) ------------------------------------------------------
  // De la plus riche a la plus pauvre, la premiere qui tient : icone, titre et
  // pastille ; titre et pastille ; titre seul ; titre en 11 px, un mot par
  // ligne, deux lignes au plus ; icone seule. Un mot de titre n est jamais
  // abrege ni coupe (l activite inconnue : une ellipse en fin de deuxieme ligne).
  function lignesTitre(titre, w, M, police, max) {
    var mots = espaces(titre).split(' ');
    var lignes = [];
    var i = 0;
    while (i < mots.length && lignes.length < max) {
      var cur = mots[i];
      i += 1;
      while (i < mots.length && M.m(police, cur + ' ' + mots[i]) + 1 <= w) { cur += ' ' + mots[i]; i += 1; }
      lignes.push(cur);
    }
    if (i < mots.length) {
      var reste = lignes[lignes.length - 1].split(' ').concat(mots.slice(i));
      var t = '';
      for (var j = 0; j < reste.length; j += 1) {
        var essai = t ? t + ' ' + reste[j] : reste[j];
        if (M.m(police, essai + '…') + 1 <= w) t = essai; else break;
      }
      lignes[lignes.length - 1] = (t || reste[0]) + '…';
    }
    return lignes;
  }
  function ghTete(col, w, groupes, M) {
    var dispo = Math.max(0, w - 1 - 16);
    var dispoPetit = Math.max(0, w - 1 - 8);
    var titreW = M.m(POLICE_TETE, col.titre) + 1;
    var pastW = Math.max(18, M.tab(POLICE_PASTILLE, String(groupes)) + 10);
    var mots = espaces(col.titre).split(' ');
    var motsTiennent = mots.length <= 2 && mots.every(function (m) { return M.m(POLICE_TETE_PETITE, m) + 1 <= dispoPetit; });
    if (!groupes) {
      if (dispo >= 16 + 6 + titreW) return { forme: 1, lignes: [col.titre], icone: true, pastille: null, petit: false, vide: true, replie: false };
      return { forme: 4, lignes: col.inconnue || !motsTiennent ? lignesTitre(col.titre, dispoPetit, M, POLICE_TETE_PETITE, 2) : mots, icone: true, pastille: null, petit: true, vide: true, replie: true };
    }
    if (dispo >= 16 + 6 + titreW + 6 + pastW) return { forme: 1, lignes: [col.titre], icone: true, pastille: groupes, petit: false };
    if (dispo >= titreW + 6 + pastW) return { forme: 2, lignes: [col.titre], icone: false, pastille: groupes, petit: false };
    if (dispo >= titreW) return { forme: 3, lignes: [col.titre], icone: false, pastille: null, petit: false };
    if (motsTiennent) return { forme: 4, lignes: mots, icone: false, pastille: null, petit: true };
    if (col.inconnue) {
      // (deux lignes, une ellipse en fin de la deuxieme ; un mot qui ne tient
      // pas seul laisse l icone seule, jamais un mot coupe)
      var lignes = lignesTitre(col.titre, dispoPetit, M, POLICE_TETE_PETITE, 2);
      if (lignes.every(function (l) { return M.m(POLICE_TETE_PETITE, l) + 1 <= dispoPetit; })) return { forme: 4, lignes: lignes, icone: false, pastille: null, petit: true };
    }
    return { forme: 5, lignes: [], icone: true, pastille: null, petit: false };
  }
  // La sous-ligne d une tete, a l heure qu il est : la premiere forme qui tient.
  function ghSousLigne(col, comp, w, mesure) {
    var M = mesure && mesure.m ? mesure : mesureur(mesure);
    var dispo = Math.max(0, w - 1 - 8);
    var choisir = function (formes) { for (var i = 0; i < formes.length; i += 1) if (formes[i] && M.tab(POLICE_TETE_PETITE, formes[i]) + 1 <= dispo) return formes[i]; return ''; };
    if (col.nature === 'arcades' && col.credits > 0) return choisir([col.credits + ' cr.', String(col.credits)]);
    if (!comp) return '';
    if (col.nature === 'laser') {
      if (!comp.parties) return '';
      if (!comp.aujourdhui) return choisir([pluriel(comp.parties, 'partie'), String(comp.parties)]);
      if (comp.finies) return choisir(['parties finies', 'finies']);
      if (!comp.partie) return '';
      var c = comp.C > 0 ? comp.partie.armes + '/' + comp.C : pluriel(comp.partie.armes, 'arme');
      return choisir([heureTexte(comp.partie.debut) + ' · ' + c, c]);
    }
    if (col.nature === 'plaine') {
      if (!comp.tous) return '';
      if (comp.la == null) return choisir([comp.tous + ' enf.', String(comp.tous)]);
      return choisir([comp.la + ' enf. là', comp.la + ' là', String(comp.la)]);
    }
    if (comp.total > 0 && comp.unites != null) {
      if (col.cle === 'funrun') return comp.unites > 0 ? choisir([comp.unites + '/' + comp.total]) : '';
      return choisir([comp.unites + '/' + comp.total + ' ' + comp.mot + (comp.total > 1 ? 's' : ''), comp.unites + '/' + comp.total]);
    }
    return '';
  }
  // Ce que la tete dit en entier (son title et son aria-label).
  function ghTeteTexte(col, comp, groupes, maintenant) {
    if (!groupes) return col.titre + ', aucun groupe ce jour-là';
    var base = col.titre + ' : ' + pluriel(groupes, 'groupe');
    if (col.nature === 'arcades' && col.credits > 0) return base + ', ' + col.credits + ' crédits';
    if (!comp) return base;
    if (col.nature === 'bowling' && maintenant != null) return base + ', ' + pluriel(comp.libres, 'piste libre', 'pistes libres') + ' à ' + heureTexte(maintenant);
    if (col.nature === 'laser' && comp.partie) return base + ', partie de ' + heureTexte(comp.partie.debut) + ' · ' + comp.partie.armes + (comp.C > 0 ? '/' + comp.C : '') + ' armes';
    if (col.nature === 'laser' && comp.parties) return base + ', ' + pluriel(comp.parties, 'partie');
    if (col.nature === 'plaine') return comp.la == null ? base + ', ' + comp.tous + ' enfants sur la journée' : base + ', ' + comp.la + ' enfants en ce moment, ' + comp.tous + ' sur la journée';
    if (comp.total > 0 && comp.unites != null) return base + ', ' + comp.unites + '/' + comp.total + ' ' + comp.mot + (comp.total > 1 ? 's' : '') + ' en cours';
    return base;
  }

  // ---- LES ATTRIBUTS D ETAT : la meme fonction pour le rendu et le tic ------------
  var ETATS_LUS = { fini: 'fini', encours: 'en cours', avenir: 'à venir', retard: 'en retard, pas encore arrivé' };
  function ghClasses(el, etat, transitoire) {
    var t = transitoire || {};
    var c = el.classes + ' is-' + (etat || 'avenir');
    if (t.groupe && t.groupe === el.gid) c += ' is-groupe';
    if (t.choisi && t.choisi === el.gid) c += ' is-choisi';
    if (t.recherche && el.cherche.indexOf(t.recherche) < 0) c += ' is-terne';
    return c;
  }
  function ghAria(el, etat, etats) {
    var morceaux = [el.aria, ETATS_LUS[etat] || ETATS_LUS.avenir];
    if (el.porteuse && etats && etats.tags && etats.tags[el.gid]) etats.tags[el.gid].forEach(function (t) { morceaux.push(TAGS[t.code].long(t.v)); });
    (el.tagsFixes || []).forEach(function (t) { morceaux.push(TAGS[t.code].long(t.v)); });
    return morceaux.join(', ');
  }
  function ghClassesHeure(h, maintenant, axe) {
    var c = 'gh-h' + (h.pleine ? ' is-pleine' : '') + (h.minuit ? ' is-minuit' : '') + (h.hors ? ' is-hors' : '');
    if (maintenant != null) {
      if (h.t < maintenant - 1e-6) c += ' is-passe';
      if (maintenant >= axe.debut && maintenant <= axe.fin && Math.abs(h.y - ghY(axe, maintenant)) < 15) c += ' is-sous';
    }
    return c;
  }
  // La barre de l heure, sa pastille et le voile du passe.
  function ghMaintenant(axe, maintenant) {
    var vu = maintenant != null && maintenant >= axe.debut - 1e-6 && maintenant <= axe.fin + 1e-6;
    return { vu: vu, y: vu ? ghY(axe, maintenant) : axe.origine, texte: vu ? heureTexte(maintenant) : '', passe: maintenant != null && maintenant > axe.debut };
  }

  // ---- LE PLAN ------------------------------------------------------------------------
  // Les colonnes et leurs elements, sans largeur encore.
  function construireColonnes(entree, axe, typo, groupes) {
    var ressources = entree.ressources || {};
    var vertical = function (debut, finD) {
      var y = ghY(axe, debut) + 1;
      var h = Math.max(1, ghY(axe, finD) - ghY(axe, debut) - 2);
      return { y: y, h: h, L: Math.max(0, Math.floor((h - typo.cadre) / typo.ligne + 0.05)) };
    };
    return entree.colonnes.map(function (c, i) {
      var col = { i: i, cle: c.cle, titre: c.titre, nature: c.nature, icone: c.icone || '', inconnue: Boolean(c.inconnue), unites: c.unites || null, credits: c.credits || 0, reserve: Boolean(c.reserve), elements: [] };
      col.seances = entree.seances.filter(function (s) { return s.colonne === c.cle; });
      if (col.nature === 'bowling') construireBowling(col, ressources.pistes || {}, vertical, groupes);
      else if (col.nature === 'laser') construireLaser(col, ressources.laser || {}, vertical, typo, groupes);
      else construireAgenda(col, vertical, groupes);
      col.vide = !col.seances.length && !col.elements.length;
      if (col.vide && col.nature !== 'bowling') col.sous = 1;
      return col;
    });
  }
  // LE BOWLING, UNE FEUILLE DE PISTES (spec 5) : une carte occupe exactement
  // ses pistes ; des pistes non contigues font une carte par suite ; une
  // seance sans piste va dans la sous-colonne « ? » ; deux seances sur la meme
  // piste au meme moment (donnee fausse) se partagent la piste.
  function construireBowling(col, R, vertical, groupes) {
    var N = Math.max(1, Number(R.N) || 8);
    col.seances.forEach(function (s) { (s.pistes || []).forEach(function (p) { if (Number(p) > N) N = Number(p); }); });
    var sansPiste = col.seances.some(function (s) { return !(s.pistes && s.pistes.length); });
    col.N = N;
    col.sous = N + (sansPiste ? 1 : 0);
    col.sansPiste = sansPiste;
    col.maintenance = (R.maintenance || []).map(Number).filter(function (p) { return p >= 1 && p <= N; });
    col.paires = R.paires || [];
    var parPiste = new Map();
    col.seances.forEach(function (s) { (s.pistes || []).forEach(function (p) { p = Number(p); if (!parPiste.has(p)) parPiste.set(p, []); parPiste.get(p).push(s); }); });
    var conflits = new Map();
    parPiste.forEach(function (liste, p) {
      liste.forEach(function (a) {
        liste.forEach(function (b) {
          if (a === b || !(a.debut < b.fin - 1e-6 && b.debut < a.fin - 1e-6)) return;
          if (!conflits.has(a.id)) conflits.set(a.id, new Set());
          conflits.get(a.id).add(p);
        });
      });
    });
    col.seances.forEach(function (s) {
      var finD = Math.max(s.fin, s.debut + 0.5);
      var pistes = Array.from(new Set((s.pistes || []).map(Number))).sort(function (a, b) { return a - b; });
      var conf = conflits.get(s.id);
      var runs = [];
      if (!pistes.length) runs.push({ a: N + 1, b: N + 1, sansPiste: true });
      else if (conf) pistes.forEach(function (p) { runs.push({ a: p, b: p, conflit: conf.has(p) ? p : 0 }); });
      else pistes.forEach(function (p) { var r = runs[runs.length - 1]; if (r && p === r.b + 1) r.b = p; else runs.push({ a: p, b: p }); });
      var principal = 0;
      runs.forEach(function (r, i) { if (r.b - r.a > runs[principal].b - runs[principal].a) principal = i; });
      runs.forEach(function (r, i) {
        var v = vertical(s.debut, finD);
        col.elements.push({
          k: 'carte', nature: 'bowling', s: s, g: groupes.get(s.groupe), a: r.a, b: r.b, run: i, secondaire: i !== principal,
          sansPiste: Boolean(r.sansPiste), conflit: r.conflit || 0, debut: s.debut, fin: s.fin, finD: finD, y: v.y, h: v.h, L: v.L,
          pistesRun: pistes.filter(function (p) { return p >= r.a && p <= r.b; }),
        });
      });
    });
    var parLane = new Map();
    col.elements.forEach(function (el) { if (el.conflit) { if (!parLane.has(el.a)) parLane.set(el.a, []); parLane.get(el.a).push(el); } });
    parLane.forEach(function (liste) {
      var items = liste.map(function (el) { return { id: el.s.id + '|' + el.run, start: el.debut, el: el }; });
      ghVoies(items, function (x) { return x.el.finD; });
      items.forEach(function (x) { x.el.voie = x.voie; x.el.kv = x.k; });
    });
    // Les reservations en ligne en cours : un bloc neutre sur leurs pistes.
    (R.blocages || []).forEach(function (b, n) {
      var p = Number(b.piste);
      if (!(p >= 1 && p <= N)) return;
      var finD = Math.max(b.fin, b.debut + 0.5);
      var v = vertical(b.debut, finD);
      col.elements.push({ k: 'enligne', a: p, b: p, debut: b.debut, fin: b.fin, finD: finD, y: v.y, h: v.h, L: v.L, texte: b.texte || '', libre: b.libre || '', n: n });
    });
  }
  // LE LASER, DES PARTIES ET DES ARMES (spec 6).
  function construireLaser(col, R, vertical, typo, groupes) {
    var entrees = col.seances.map(function (s) { return { id: s.id, groupe: s.groupe, debut: s.debut, fin: s.fin, joueurs: s.joueurs, arene: s.arene, seance: s }; })
      .concat((R.enLigne || []).map(function (b, n) { return { id: 'enligne' + n, groupe: '', debut: b.debut, fin: b.fin, joueurs: b.joueurs, arene: b.arene, enLigne: true }; }));
    var parties = ghParties(entrees);
    ghVoies(parties, function (p) { return p.finDessinee; });
    col.parties = parties;
    col.sous = Math.max(1, Math.max.apply(null, [1].concat(parties.map(function (p) { return p.k || 1; }))));
    col.C = Number(R.capacite) || 0;
    parties.forEach(function (p) {
      var v = vertical(p.debut, p.finDessinee);
      var L = Math.max(0, Math.floor((v.h - CADRE_PARTIE_V) / typo.ligne + 0.05));
      var barreH = Math.max(1, v.h - CADRE_PARTIE_V - (L >= 2 ? typo.ligne : 0));
      var parGroupe = new Map();
      p.entrees.forEach(function (e) {
        if (e.enLigne) return;
        var x = parGroupe.get(e.groupe);
        if (!x) { x = { gid: e.groupe, joueurs: 0, seances: [], debut: e.debut, fin: e.fin }; parGroupe.set(e.groupe, x); }
        x.joueurs += Number(e.joueurs) || 0;
        x.seances.push(e.seance);
        x.fin = Math.max(x.fin, e.fin);
      });
      var segs = Array.from(parGroupe.values()).map(function (x) {
        return { gid: x.gid, g: groupes.get(x.gid), joueurs: x.joueurs, armes: x.joueurs, s: x.seances[0], debut: x.debut, fin: x.fin };
      }).sort(function (a, b) { return ((a.g && a.g.debut) || 0) - ((b.g && b.g.debut) || 0) || comparer(a.g ? a.g.nom : '', b.g ? b.g.nom : ''); });
      var autres = Math.max(0, p.armes - p.siens);
      col.elements.push({ k: 'partie', p: p, segs: segs, autres: autres, autresEnLigne: p.enLigne > 0 && p.enLigne >= autres, C: col.C, debut: p.debut, fin: p.fin, finD: p.finDessinee, y: v.y, h: v.h, L: L, barreH: barreH, Ls: Math.max(0, Math.floor(barreH / typo.ligne + 0.05)), voie: p.voie, kv: p.k });
    });
  }
  // L AGENDA (plaine, duckpin, Fun Run, billard, O Clock, minigolf, arcades,
  // activites inconnues) : les voies, avec expansion a droite.
  function construireAgenda(col, vertical, groupes) {
    var items = col.seances.map(function (s) { return { id: s.id, start: s.debut, s: s, finD: Math.max(s.fin, s.debut + 0.5) }; });
    ghVoies(items, function (x) { return x.finD; });
    col.sous = Math.max(1, Math.max.apply(null, [1].concat(items.map(function (x) { return x.k || 1; }))));
    items.forEach(function (x) {
      var v = vertical(x.s.debut, x.finD);
      col.elements.push({ k: col.nature === 'plaine' ? 'presence' : 'carte', nature: col.nature, s: x.s, g: groupes.get(x.s.groupe), debut: x.s.debut, fin: x.s.fin, finD: x.finD, y: v.y, h: v.h, L: v.L, voie: x.voie, kv: x.k, span: x.span || 1 });
    });
  }
  // Ce qu une carte peut ecrire, hors de l heure qu il est.
  function piecesCarte(el, echelle) {
    var s = el.s;
    var e = echelle(s.groupe);
    el.formes = e.formes;
    el.distinctive = e.distinctive;
    el.gid = s.groupe;
    if (el.k === 'presence') { el.enfants = Number(s.enfants) || Number(el.g && el.g.personnes) || 0; return; }
    el.heure = { t: (s.libre ? '≈ ' : '') + heureTexte(s.debut), aligne: aligneDemi(s.debut) && !s.libre };
    el.detail = [];
    if (el.nature === 'bowling' && el.pistesRun && el.pistesRun.length) el.detail.push('P' + texteRuns(el.pistesRun));
    else if (s.unites > 1) el.detail.push('×' + s.unites + (s.activite === 'billards' ? ' tables' : s.activite === 'duckpin_bowling' ? ' pistes' : ''));
    el.detailBowling = el.nature === 'bowling';
    el.tagsFixes = [];
    if (el.sansPiste) el.tagsFixes.push({ code: 'piste' });
    if (el.conflit) el.tagsFixes.push({ code: 'conflit', v: 'P' + el.conflit });
  }
  function carteBase(el, porteuse) {
    var g = el.g || {};
    return {
      heure: el.heure, arrivee: false, formes: el.formes, distinctive: el.distinctive, unitesFormes: el.unitesFormes, unitesTypo: el.unitesTypo,
      tags: [], pictos: porteuse ? Number(g.pictos) || 0 : 0, detail: el.secondaire ? [] : el.detail, detailBowling: el.detailBowling,
      infos: porteuse ? (g.infos || []) : [],
    };
  }
  function rolesCartes(colonnes) {
    var parGroupe = new Map();
    colonnes.forEach(function (col) {
      col.elements.forEach(function (el) {
        if (el.k !== 'carte' || el.secondaire) return;
        var gid = el.s.groupe;
        var large = el.nature === 'bowling' ? (el.b - el.a + 1) * PLANCHERS.piste : (el.span || 1) * PLANCHERS.voie;
        var x = parGroupe.get(gid);
        var cle = [el.debut, col.i, el.a || el.voie || 0];
        if (!x) { parGroupe.set(gid, { premiere: el, cle: cle, large: el, w: large }); return; }
        if (cle[0] < x.cle[0] - 1e-9 || (Math.abs(cle[0] - x.cle[0]) < 1e-9 && (cle[1] < x.cle[1] || (cle[1] === x.cle[1] && cle[2] < x.cle[2])))) { x.premiere = el; x.cle = cle; }
        if (large > x.w) { x.large = el; x.w = large; }
      });
    });
    return function (el) {
      var x = parGroupe.get(el.s.groupe);
      if (!x) return { premiere: true, large: true };
      return { premiere: x.premiere === el, large: x.large === el };
    };
  }
  function besoinsColonnes(colonnes, entree, typo, M, toucher, trace) {
    var role = rolesCartes(colonnes);
    var noter = function (col, el, bz, extra) { if (trace) trace.push(Object.assign({ colonne: col.cle, groupe: el.gid || (el.s && el.s.groupe), debut: el.debut, L: el.L, nom: bz.nom, ess: bz.ess, conf: bz.conf }, extra || {})); };
    var plancherPiste = toucher ? PLANCHERS.pisteToucher : PLANCHERS.piste;
    return colonnes.map(function (col) {
      if (col.vide && col.nature !== 'bowling') {
        var mot = Math.max.apply(null, espaces(col.titre).split(' ').map(function (m) { return M.m(POLICE_TETE_PETITE, m); }));
        var pv = Math.max(PLANCHERS.vide, Math.ceil(mot + 12));
        return { plancher: pv, court: pv, nom: pv, essentiel: pv, complet: pv, confort: pv, sous: 1, vide: true, bowling: false };
      }
      if (col.nature === 'bowling') {
        var courtP = 0, nomP = 0, essP = 0, compP = 0, confP = 0;
        col.elements.forEach(function (el) {
          if (el.k !== 'carte') return;
          var v = el.b - el.a + 1;
          preparer(el, M, typo);
          var sc = el.secondaire ? [[]] : scenariosTags(el.g || {}, entree, role(el)).map(function (tags) { return tags.concat(el.tagsFixes); });
          var bz = besoinCarte(carteBase(el, false), el.L, sc, v * plancherPiste, v * PLAFONDS.pisteEss, v * PLAFONDS.pisteConf, typo, M);
          var div = el.conflit ? 1 / Math.max(1, el.kv || 1) : v;
          noter(col, el, bz, { pistes: v });
          courtP = Math.max(courtP, bz.court / div);
          nomP = Math.max(nomP, bz.nom / div);
          compP = Math.max(compP, bz.complet / div);
          essP = Math.max(essP, bz.ess / div);
          confP = Math.max(confP, bz.conf / div);
        });
        var pl = col.sous * plancherPiste;
        var es = Math.max(pl, Math.ceil(col.sous * essP));
        var cfP = Math.max(es, Math.ceil(col.sous * confP));
        var nmP = Math.max(pl, Math.min(es, Math.ceil(col.sous * nomP)));
        return { plancher: pl, court: Math.max(pl, Math.min(nmP, Math.ceil(col.sous * courtP))), nom: nmP, essentiel: es, complet: Math.min(cfP, Math.max(es, Math.ceil(col.sous * compP))), confort: cfP, sous: col.sous, vide: col.vide, bowling: true };
      }
      if (col.nature === 'laser') {
        var courtV = 0, essV = 0, compV = 0, confV = 0;
        col.elements.forEach(function (el) {
          if (el.k !== 'partie') return;
          var gaps = ECART_SEG * Math.max(0, el.segs.length - 1 + (el.autres > 0 ? 1 : 0));
          var sumEss = el.segs.reduce(function (a, sg) { return a + sg.ess; }, 0) + gaps + (el.autres > 0 ? 18 : 0);
          var sumCourt = el.segs.reduce(function (a, sg) { return a + sg.court; }, 0) + gaps + (el.autres > 0 ? 18 : 0);
          var sumConf = el.segs.reduce(function (a, sg) { return a + sg.conf; }, 0) + gaps + (el.autres > 0 ? 56 : 0);
          // (le confort sous la regle de la barre : un segment n a que sa part
          // des armes, joueurs / C de la barre ; il faut la barre ou chaque
          // part atteint son confort)
          var J = el.segs.reduce(function (a, sg) { return a + sg.joueurs; }, 0);
          var parts = el.C > 0 && el.p.armes <= el.C ? el.C : Math.max(1, J);
          var gapsTout = gaps + (el.C > el.p.armes ? ECART_SEG : 0);
          var bConf = Math.max(sumConf, gapsTout + Math.max.apply(null, [0].concat(el.segs.map(function (sg) { return sg.conf * parts / Math.max(1, sg.joueurs); }))));
          var compte = el.p.armes + (el.C > 0 ? '/' + el.C : ' armes');
          var e = el.L >= 2 ? Math.max(M.tab(typo.fort, compte) + 1, sumEss) : el.L === 1 ? COMPTE_PARTIE + sumEss : sumEss;
          var k = el.L >= 2 ? Math.max(M.tab(typo.fort, compte) + 1, sumCourt) : el.L === 1 ? COMPTE_PARTIE + sumCourt : sumCourt;
          var c = el.L >= 2 ? Math.max(M.tab(typo.fort, heureTexte(el.p.debut) + ' · ' + compte + ' armes') + 1, bConf) : el.L === 1 ? COMPTE_PARTIE + bConf : bConf;
          var ev = Math.ceil(e + CHROME_PARTIE), cv = Math.ceil(c + CHROME_PARTIE);
          essV = Math.max(essV, ev);
          courtV = Math.max(courtV, Math.ceil(k + CHROME_PARTIE));
          confV = Math.max(confV, Math.min(PLAFONDS.laser, cv));
          // (une partie dont le confort passe le plafond ne tire pas le nom complet)
          compV = Math.max(compV, cv <= PLAFONDS.laser ? cv : ev);
        });
        var plL = col.sous * PLANCHERS.laser;
        var esL = Math.max(plL, col.sous * essV);
        var cfL = Math.max(esL, col.sous * confV);
        return { plancher: plL, court: Math.max(plL, Math.min(esL, col.sous * courtV)), nom: esL, essentiel: esL, complet: Math.min(cfL, Math.max(esL, col.sous * compV)), confort: cfL, sous: col.sous, vide: col.vide, bowling: false };
      }
      var plancherVoie = col.nature === 'plaine' ? PLANCHERS.plaine : PLANCHERS.voie;
      var courtC = 0, nomC = 0, essC = 0, compC = 0, confC = 0;
      col.elements.forEach(function (el) {
        var bz;
        if (el.k === 'presence') bz = besoinPresence(el, el.L, typo, M);
        else {
          preparer(el, M, typo);
          var sc = scenariosTags(el.g || {}, entree, role(el)).map(function (tags) { return tags.concat(el.tagsFixes || []); });
          bz = besoinCarte(carteBase(el, false), el.L, sc, el.span * plancherVoie, el.span * PLAFONDS.voieEss, el.span * PLAFONDS.voieConf, typo, M);
        }
        noter(col, el, bz, { k: el.kv, span: el.span });
        courtC = Math.max(courtC, bz.court * el.kv / el.span);
        nomC = Math.max(nomC, bz.nom * el.kv / el.span);
        compC = Math.max(compC, bz.complet * el.kv / el.span);
        essC = Math.max(essC, bz.ess * el.kv / el.span);
        confC = Math.max(confC, bz.conf * el.kv / el.span);
      });
      var plC = col.sous * plancherVoie;
      var esC = Math.max(plC, Math.ceil(essC));
      var cfC = Math.max(esC, Math.ceil(confC));
      var nmC = Math.max(plC, Math.min(esC, Math.ceil(nomC)));
      return { plancher: plC, court: Math.max(plC, Math.min(nmC, Math.ceil(courtC))), nom: nmC, essentiel: esC, complet: Math.min(cfC, Math.max(esC, Math.ceil(compC))), confort: cfC, sous: col.sous, vide: false, bowling: false };
    });
  }
  function poidsColonnes(colonnes, besoins) {
    return colonnes.map(function (col, i) {
      if (besoins[i].vide) return POIDS.vide;
      if (col.nature === 'bowling') return POIDS.bowling;
      if (col.nature === 'laser') return POIDS.laser;
      if (col.seances.length && col.seances.every(function (s) { return s.libre; })) return POIDS.sansHeure;
      return POIDS.defaut;
    });
  }
  // La geometrie horizontale, dans les coordonnees de chaque colonne.
  function placer(colonnes, rep) {
    var x0 = 0;
    colonnes.forEach(function (col, i) {
      col.x = x0;
      col.w = rep.largeurs[i];
      x0 += col.w;
      if (col.nature === 'bowling') {
        var wL = rep.wL;
        col.wL = wL;
        col.pistes = [];
        for (var p = 1; p <= col.sous; p += 1) col.pistes.push({ n: p <= col.N ? p : '?', x: (p - 1) * wL, w: wL + (p === col.sous ? rep.extraPiste : 0), maintenance: col.maintenance.indexOf(p) >= 0 });
        col.elements.forEach(function (el) {
          var ga = (el.a - 1) * wL, gb = el.b * wL + (el.b === col.sous ? rep.extraPiste : 0);
          if (el.conflit && el.kv > 1) { var part = (gb - ga) / el.kv; var g0 = Math.round(ga + el.voie * part); gb = Math.round(ga + (el.voie + 1) * part); ga = g0; }
          el.x = ga + 1; el.w = Math.max(1, gb - ga - 2); el.bw = gb - ga;
        });
      } else {
        col.elements.forEach(function (el) {
          var span = el.span || 1;
          var ga = Math.round(col.w * el.voie / el.kv), gb = Math.round(col.w * (el.voie + span) / el.kv);
          el.x = ga + 1; el.w = Math.max(1, gb - ga - 2); el.bw = gb - ga;
        });
      }
    });
    return x0;
  }

  function ghPlan(entree, cache) {
    var memo = cache || {};
    var M = mesureur(entree.mesure, memo.mesures);
    var ecran = entree.ecran || { W: 1200, H: 600, largeurFenetre: 1440 };
    var plage = entree.plage;
    var hh = ghHauteurHeure(ecran.H, plage.fin - plage.debut);
    var axe = axeDonnees(plage, hh, ORIGINE);
    var typo = ghTypo(axe.demi);
    var colH = ecran.largeurFenetre < 1200 ? 44 : 48;
    var toucher = Boolean(ecran.toucher);
    var groupes = new Map();
    entree.groupes.forEach(function (g) { groupes.set(g.id, g); });
    var noms = ghNoms(entree.groupes, typo.nom, M);
    var echelle = function (gid) { return noms.parId.get(gid) || { formes: [{ n: 1, t: '?', w: 7 }], distinctive: 0 }; };
    var esp = M.m(typo.nom, ' ');

    var colonnes = construireColonnes(entree, axe, typo, groupes);
    colonnes.forEach(function (col) {
      col.elements.forEach(function (el) {
        if (el.k === 'carte' || el.k === 'presence') piecesCarte(el, echelle);
        if (el.k === 'partie') el.segs.forEach(function (sg) {
          var e = echelle(sg.gid);
          sg.formes = e.formes;
          sg.distinctive = e.distinctive;
          var bz = besoinSegment(sg, typo, M);
          sg.court = bz.court;
          sg.ess = bz.ess;
          sg.conf = bz.conf;
        });
      });
    });

    // LES BESOINS, sur la journee non filtree, sans l heure ; gardes d un plan
    // a l autre tant que la journee et la hauteur ne changent pas (ouvrir le
    // panneau ne change que la largeur).
    var cleBesoins = entree.signature ? entree.signature + '|' + typo.palier + '|' + hh + '|' + toucher : null;
    var besoins = cleBesoins && memo.cleBesoins === cleBesoins ? memo.besoins : besoinsColonnes(colonnes, entree, typo, M, toucher, memo.trace);
    if (cleBesoins) { memo.besoins = besoins; memo.cleBesoins = cleBesoins; }
    var poids = poidsColonnes(colonnes, besoins);
    var rep = ghRepartir(besoins, Math.max(0, ecran.W - colH), poids, ecran);
    var largeurColonnes = placer(colonnes, rep);

    // LES ELEMENTS DU PLAN, a plat, dans l ordre du dessin.
    var plat = [];
    colonnes.forEach(function (col) {
      col.elements.forEach(function (el) {
        el.colonne = col.i;
        if (el.k === 'carte' || el.k === 'presence') {
          el.cle = el.s.groupe + '|' + col.cle + '|' + Math.round(el.s.debut * 60) + (el.nature === 'bowling' ? '|' + el.run : '') + (el.s.n ? '|' + el.s.n : '');
          el.sid = el.s.id;
          plat.push(el);
        } else if (el.k === 'partie') {
          el.cle = el.p.cle;
          var B = Math.max(1, el.w - 4 - (el.L === 1 ? COMPTE_PARTIE : 0));
          el.barre = { x: el.L === 1 ? COMPTE_PARTIE : 0, y: el.L >= 2 ? typo.ligne : 0, w: B, h: el.barreH };
          el.bouts = ghBarre(B, el.C, el.p.armes, el.segs.map(function (sg) { return { joueurs: sg.joueurs, ess: sg.ess, court: sg.court }; }), el.autres);
          plat.push(el);
          el.bouts.forEach(function (bt) {
            if (bt.seg < 0) return;
            var sg = el.segs[bt.seg];
            bt.cle = sg.gid + '|laser|' + Math.round(sg.s.debut * 60);
            plat.push({ k: 'seg', colonne: col.i, partie: el.cle, gid: sg.gid, g: sg.g, sid: sg.s.id, s: sg.s, cle: bt.cle, x: el.x + 2 + el.barre.x + bt.x, y: el.y + 2 + el.barre.y, w: bt.w, h: el.barreH, bw: bt.w, L: el.Ls, debut: sg.debut, fin: sg.fin, formes: sg.formes, distinctive: sg.distinctive, armes: sg.armes, ess: sg.ess, relX: bt.x });
          });
        } else if (el.k === 'enligne') {
          el.cle = 'enligne|' + el.a + '|' + Math.round(el.debut * 60) + '|' + el.n;
          plat.push(el);
        }
      });
    });
    var masques = entree.visibles ? new Set(entree.visibles) : null;

    // LES ETATS A L HEURE QU IL EST, puis ce que chaque carte ecrit.
    var resume = {
      elements: plat.map(function (el) { return { k: el.k, cle: el.cle, gid: el.gid, sid: el.sid, debut: el.debut, colonne: el.colonne, x: el.x, bw: el.bw, h: el.h, secondaire: Boolean(el.secondaire) }; }),
      bowling: colonnes.find(function (c) { return c.nature === 'bowling'; }) ? { N: colonnes.find(function (c) { return c.nature === 'bowling'; }).N } : null,
      laser: colonnes.find(function (c) { return c.nature === 'laser'; }) ? { parties: colonnes.find(function (c) { return c.nature === 'laser'; }).parties.map(function (p) { return { debut: p.debut, fin: p.fin, armes: p.armes }; }) } : null,
    };
    var etats = ghEtats(entree, entree.maintenant, resume);
    var stats = { nommes: 0, cartes: 0, sansTexte: 0, essentielAtteint: rep.essentielAtteint, corrections: 0 };
    var nommes = new Set();
    plat.forEach(function (el) {
      if (el.k === 'carte' || el.k === 'presence' || el.k === 'seg') el.arrivee = etats.arrivees[el.gid] === el.cle;
      if (el.k === 'carte') {
        el.porteuse = etats.porteuses[el.gid] === el.cle;
        preparer(el, M, typo);
        var base = carteBase(el, el.porteuse);
        base.tags = (el.porteuse ? etats.tags[el.gid] || [] : []).concat(el.tagsFixes || []);
        base.arrivee = el.arrivee;
        el.tw = el.bw - CHROME_CARTE;
        var niveauMin = entree.corrections && entree.corrections[el.cle];
        el.compo = ghComposer(base, { tw: el.tw, L: el.L }, typo, M, niveauMin ? { niveauMin: niveauMin } : null);
        el.suit = el.L >= 3 && el.finD - el.debut > 2 + 1e-6;
      } else if (el.k === 'presence') {
        el.porteuse = etats.porteuses[el.gid] === el.cle;
        el.tw = el.bw - CHROME_CARTE;
        el.compo = entree.corrections && entree.corrections[el.cle] ? null : ghComposerPresence(el, { tw: el.tw, L: el.L, bw: el.bw }, typo, M);
        el.suit = el.L >= 3;
      } else if (el.k === 'seg') {
        el.porteuse = etats.porteuses[el.gid] === el.cle;
        el.tw = el.bw - CHROME_SEG;
        el.compo = entree.corrections && entree.corrections[el.cle] ? null : ghComposerSegment(el, { tw: el.tw, L: el.L }, typo, M);
      }
      if (el.k === 'carte' || el.k === 'presence' || el.k === 'seg') {
        el.masque = Boolean(masques && !masques.has(el.gid));
        stats.cartes += 1;
        if (el.compo && el.compo.forme >= 0) nommes.add(el.gid);
        if (el.L >= 1 && !el.compo) stats.sansTexte += 1;
      }
    });
    stats.nommes = nommes.size;
    plat.forEach(function (el) {
      if (!el.gid) return;
      var g = el.g || groupes.get(el.gid) || {};
      var absent = g.absent || g.etat === 'absent';
      el.cherche = cleTexte(g.nom || '');
      var pre = el.k === 'presence' ? 'gh-c is-presence' : el.k === 'seg' ? 'gh-c gh-seg' : 'gh-c';
      el.classes = pre + ' t-' + (g.statut || 'conf') + (el.s && el.s.libre ? ' is-libre' : '') + (absent ? ' is-absent' : '') + (el.porteuse && el.k === 'carte' ? ' is-premiere' : '') + (el.suit ? ' peut-suivre' : '') + (el.compo ? '' : ' is-muette');
      el.aria = ariaElement(el, g, colonnes[el.colonne]);
    });

    // LES TETES.
    var tetes = colonnes.map(function (col) {
      var n = new Set(col.seances.map(function (s) { return s.groupe; })).size;
      return Object.assign({ cle: col.cle, groupes: n }, ghTete(col, col.w, n, M));
    });

    // LES FILETS, LES BANDES, LES LIBELLES D HEURE (spec 4.7, 14.2).
    var fen = entree.fenetre || { open: plage.debut, close: plage.fin, closed: false };
    var ouvre = Number(fen.open), ferme = Number(fen.close);
    var filets = [], libelles = [];
    for (var t = plage.debut; t <= plage.fin + 1e-6; t += 0.5) {
      var pleine = Math.abs(t - Math.round(t)) < 1e-6;
      var minuit = pleine && Math.round(t) % 24 === 0 && t > plage.debut + 1e-6;
      var hors = Boolean(fen.closed) || t > ferme + 1e-6 || t < ouvre - 1e-6;
      filets.push({ y: ghY(axe, t), type: minuit ? 'minuit' : pleine ? 'h' : 'd' });
      libelles.push({ t: t, y: ghY(axe, t), texte: heureTexte(t), pleine: pleine, minuit: minuit, hors: hors, titre: !hors ? '' : fen.closed ? 'centre fermé ce jour-là' : t > ferme ? 'après la fermeture (' + heureTexte(ferme) + ')' : 'avant l’ouverture (' + heureTexte(ouvre) + ')' });
    }
    var bandes = [];
    var fermeture = null;
    if (fen.closed) bandes.push({ y: ghY(axe, plage.debut), h: ghY(axe, plage.fin) - ghY(axe, plage.debut), type: 'ferme' });
    else {
      if (plage.debut < ouvre - 1e-6) bandes.push({ y: ghY(axe, plage.debut), h: ghY(axe, ouvre) - ghY(axe, plage.debut), type: 'avant' });
      if (plage.fin > ferme + 1e-6) { bandes.push({ y: ghY(axe, ferme), h: ghY(axe, plage.fin) - ghY(axe, ferme), type: 'apres' }); fermeture = ghY(axe, ferme); }
    }

    // LES OCCUPATIONS : le fantome « + 16:30 » et le clic d une case vide.
    var occupations = colonnes.map(function (col) {
      if (col.nature === 'bowling') {
        var parPiste = {};
        for (var p = 1; p <= col.sous; p += 1) parPiste[p] = [];
        col.elements.forEach(function (el) { for (var q = el.a; q <= el.b; q += 1) if (parPiste[q]) parPiste[q].push([el.debut, el.finD]); });
        return parPiste;
      }
      if (col.nature === 'laser') return { parties: col.parties.map(function (p2) { return [p2.debut, p2.finDessinee, p2.armes]; }) };
      return { cartes: col.elements.map(function (el) { return [el.debut, el.finD]; }) };
    });

    var plan = {
      version: 3,
      axe: axe, typo: typo, colH: colH, largeurColonnes: largeurColonnes, largeurTotale: colH + largeurColonnes, defile: rep.defile, reduit: rep.reduit,
      agrandir: !ecran.plein && (!rep.essentielAtteint || axe.demi < 16),
      prefixe: noms.prefixe,
      colonnes: colonnes.map(function (col, i) {
        return {
          cle: col.cle, titre: col.titre, nature: col.nature, icone: col.icone, inconnue: col.inconnue, x: col.x, w: col.w, vide: col.vide,
          reserve: col.reserve && !fen.closed, plancher: besoins[i].plancher, essentiel: besoins[i].essentiel, confort: besoins[i].confort, poids: poids[i], sous: besoins[i].sous,
          unites: col.unites, credits: col.credits, pistes: col.pistes || null, wL: col.wL || 0, N: col.N || 0, paires: col.paires || null, sansPiste: Boolean(col.sansPiste),
          tete: tetes[i], occupation: occupations[i],
        };
      }),
      elements: plat.map(function (el) { return exporter(el, typo, M); }),
      filets: filets, libelles: libelles, bandes: bandes, fermeture: fermeture,
      bowling: resume.bowling ? Object.assign({ colonne: colonnes.findIndex(function (c) { return c.nature === 'bowling'; }) }, resume.bowling) : null,
      laser: resume.laser ? { colonne: colonnes.findIndex(function (c) { return c.nature === 'laser'; }), parties: resume.laser.parties, capacite: Number(entree.ressources && entree.ressources.laser && entree.ressources.laser.capacite) || 0 } : null,
      stats: stats,
    };
    plan.etatsCle = etats.cle;
    plan.etats = etats;
    // (la cle du dessin : la geometrie et les textes, pas l etat ni les minutes de retard)
    plan.cle = hacher(JSON.stringify([plan.axe, plan.colH, plan.agrandir, plan.bandes, plan.filets.length,
      plan.colonnes.map(function (c) { return [c.cle, c.w, c.tete, c.reserve]; }),
      plan.elements.map(function (el) { return [el.k, el.cle, el.x, el.y, el.w, el.h, el.classes || '', el.aria || '', el.masque || false, cleCompo(el.compo), el.barre || null, el.bouts || null, el.tete || null]; })]));
    return plan;
  }
  function cleCompo(c) {
    if (!c) return null;
    return JSON.stringify(c).replace(/"t":"(retard |\+)\d+( min)?"/g, '"t":"$1#$2"').replace(/"v":\d+/g, '"v":#');
  }
  function ariaElement(el, g, col) {
    var s = el.s || {};
    var morceaux = [g.nom || '', pluriel(Number(g.personnes) || 0, 'personne'), col ? col.titre : ''];
    if (el.k === 'seg') {
      morceaux.push('partie de ' + heureTexte(el.debut) + ' à ' + heureTexte(el.fin), pluriel(el.armes, 'arme'));
      if (s.parties > 1) morceaux.push((s.partie === 1 ? '1re' : s.partie + 'e') + ' partie');
    } else {
      morceaux.push((s.libre ? 'sans heure fixe, vers ' : '') + heureTexte(el.debut) + ' à ' + heureTexte(el.fin));
      if (el.k === 'carte' && el.nature === 'bowling' && el.pistesRun && el.pistesRun.length) morceaux.push((el.pistesRun.length > 1 ? 'pistes ' : 'piste ') + texteRuns(el.pistesRun));
      if (el.k === 'presence') morceaux.push(pluriel(el.enfants, 'enfant'));
      if (el.k === 'carte' && el.nature !== 'bowling' && s.unites > 1) morceaux.push(el.detail[0] || '');
    }
    return morceaux.filter(Boolean).join(', ');
  }
  function exporter(el, typo, M) {
    var out = { k: el.k, cle: el.cle, colonne: el.colonne, x: el.x, y: el.y, w: el.w, h: el.h, bw: el.bw };
    if (el.k === 'carte' || el.k === 'presence' || el.k === 'seg') {
      Object.assign(out, {
        gid: el.gid, sid: el.sid, L: el.L, tw: el.tw, debut: el.debut, fin: el.fin, classes: el.classes, aria: el.aria, cherche: el.cherche, masque: el.masque,
        porteuse: Boolean(el.porteuse), arrivee: Boolean(el.arrivee), compo: el.compo ? exporterCompo(el.compo, el.k) : null, formes: el.formes.map(function (f) { return f.t; }), distinctive: el.distinctive,
        tagsFixes: el.tagsFixes || [],
      });
      if (el.k === 'carte') Object.assign(out, { secondaire: Boolean(el.secondaire), nature: el.nature, suit: Boolean(el.suit), libre: Boolean(el.s.libre), pistes: el.pistesRun || null, sansPiste: Boolean(el.sansPiste) });
      if (el.k === 'presence') Object.assign(out, { enfants: el.enfants, suit: Boolean(el.suit) });
      if (el.k === 'seg') Object.assign(out, { partie: el.partie, armes: el.armes, ess: el.ess, relX: el.relX });
      if (el.suit && el.compo) out.lignesTexte = (el.compo.lignes ? el.compo.lignes.length : 0) || 1;
    } else if (el.k === 'partie') {
      Object.assign(out, {
        L: el.L, Ls: el.Ls, debut: el.debut, fin: el.fin, armes: el.p.armes, C: el.C, autres: el.autres, autresEnLigne: el.autresEnLigne, barre: el.barre,
        bouts: el.bouts.map(function (b) { return { x: b.x, w: b.w, autres: b.autres, libre: b.libre, seg: b.seg, cle: b.cle || null, texte: texteNeutre(el, b, typo, M) }; }),
        tete: teteDePartie(el, typo, M), segs: el.segs.map(function (sg) { return sg.gid; }),
      });
    } else if (el.k === 'enligne') {
      var vu = ['En ligne' + (el.libre ? ' · libre à ' + el.libre : ''), 'En ligne'].find(function (t) { return M.m(typo.petit, t) + 1 <= el.w - 8; }) || '';
      Object.assign(out, { L: el.L, debut: el.debut, fin: el.fin, piste: el.a, texte: el.texte, libre: el.libre, vu: el.L >= 1 ? vu : '' });
    }
    return out;
  }
  function exporterCompo(c, k) {
    if (k === 'seg') return { niveau: c.niveau, forme: c.forme, nom: c.nom, armes: c.armes, deuxLignes: Boolean(c.deuxLignes) };
    var lignes = (c.lignes || []).map(function (l) {
      return l.map(function (u) {
        var o = { k: u.k, t: u.t };
        if (u.k === 'nom') o.mot = Boolean(u.mot);
        if (u.k === 'tag') { o.code = u.code; o.forme = u.forme; if (u.code === 'retard') o.v = u.v; }
        if (u.k === 'pictos') o.n = u.n;
        return o;
      });
    });
    var out = { niveau: c.niveau, forme: c.forme, lignes: lignes };
    if (k === 'presence') { out.compte = c.compte || null; out.seul = Boolean(c.seul); out.sousCompte = Boolean(c.sousCompte); } else out.bas = c.bas ? c.bas.t : null;
    return out;
  }
  // Le texte d un segment neutre (spec 6.3) : « 8 libres » des 52 px, « 8 »
  // des 20 px ; « 6 autres » ou « 6 en ligne » des 56 px ; toujours ce qui
  // tient (2 px de chaque cote), et seulement sur une ligne de barre.
  function texteNeutre(el, b, typo, M) {
    if (b.seg >= 0 || el.Ls < 1) return '';
    var tient = function (t) { return M.tab(typo.petit, t) + 1 + 4 <= b.w; };
    if (b.libre) {
      var n = Math.max(0, el.C - el.p.armes);
      return [b.w >= 52 ? n + ' libres' : '', b.w >= 20 ? String(n) : ''].find(function (t) { return t && tient(t); }) || '';
    }
    var a = el.autres + (el.autresEnLigne ? ' en ligne' : ' autres');
    return b.w >= 56 && tient(a) ? a : '';
  }
  // La tete d une partie : « 15:30 · 22/30 armes », puis « 15:30 · 22/30 »,
  // puis « 22/30 » ; basse, le compte seul a gauche de sa barre.
  function teteDePartie(el, typo, M) {
    var C = el.C, A = el.p.armes;
    var compte = C > 0 ? A + '/' + C : pluriel(A, 'arme');
    var depasse = C > 0 && A > C;
    var formes = [];
    var dispo = 0;
    if (el.L >= 2) { formes = [heureTexte(el.p.debut) + ' · ' + compte + (C > 0 ? ' armes' : ''), heureTexte(el.p.debut) + ' · ' + compte, compte]; dispo = el.w - 4; }
    else if (el.L === 1) { formes = [compte]; dispo = COMPTE_PARTIE; }
    var police = el.L >= 2 ? typo.fort : POLICE_COMPTE_BAS;
    var t = formes.find(function (f) { return M.tab(police, f) + 1 <= dispo; }) || '';
    return { t: t, danger: depasse, ligne: el.L >= 2, aria: ariaPartie(el, A, C) };
  }
  function ariaPartie(el, A, C) {
    var t = 'Partie de ' + heureTexte(el.p.debut) + ' à ' + heureTexte(el.p.fin) + ', ';
    if (C > 0 && A > C) return t + A + ' armes pour ' + C + ', dépasse la capacité';
    return t + (C > 0 ? A + ' armes sur ' + C : pluriel(A, 'arme'));
  }

  // LA TOLERANCE AU TOUCHER (spec 10) : la carte la plus proche d un point (en
  // coordonnees de sa colonne), sur les rectangles du plan, a 8 px au plus.
  function ghCarteProche(plan, colonne, x, y, tolerance) {
    var tol = tolerance == null ? TOLERANCE_TOUCHER : tolerance;
    var meilleur = null, dmin = Infinity;
    plan.elements.forEach(function (el) {
      if (el.colonne !== colonne || el.masque || (el.k !== 'carte' && el.k !== 'presence' && el.k !== 'seg')) return;
      var dx = Math.max(el.x - x, 0, x - (el.x + el.w));
      var dy = Math.max(el.y - y, 0, y - (el.y + el.h));
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < dmin) { dmin = d; meilleur = el; }
    });
    return { el: dmin <= tol ? meilleur : null, d: dmin };
  }
  // La demi-heure qu une case vide reserverait, ou null (piste en
  // maintenance, prise ou bloquee en ligne, jour ferme, plus d arme libre).
  function ghCaseLibre(plan, colonne, x, y) {
    var col = plan.colonnes[colonne];
    if (!col || !col.reserve) return null;
    var t = Math.floor(ghT(plan.axe, y) * 2) / 2;
    if (t < plan.axe.debut - 1e-6 || t >= plan.axe.fin - 1e-6) return null;
    var libre = function (liste) { return !liste.some(function (iv) { return iv[0] < t + 0.5 - 1e-6 && iv[1] > t + 1e-6; }); };
    if (col.nature === 'bowling') {
      var p = Math.floor(x / Math.max(1, col.wL)) + 1;
      if (p < 1 || p > col.N || col.pistes[p - 1].maintenance || !libre(col.occupation[p] || [])) return null;
      return { t: t, piste: p, x: (p - 1) * col.wL, w: col.pistes[p - 1].w };
    }
    if (col.nature === 'laser') {
      var C = plan.laser ? plan.laser.capacite : 0;
      var enJeu = col.occupation.parties.filter(function (iv) { return iv[0] < t + 0.5 - 1e-6 && iv[1] > t + 1e-6; }).reduce(function (a, iv) { return Math.max(a, iv[2]); }, 0);
      var libres = C > 0 ? C - enJeu : null;
      if ((libres != null && libres <= 0) || !libre(col.occupation.parties)) return null;
      return { t: t, libres: libres, x: 0, w: col.w };
    }
    return null;
  }

  return {
    PALIERS: PALIERS, PLANCHERS: PLANCHERS, PLAFONDS: PLAFONDS, POIDS: POIDS, CHROME_CARTE: CHROME_CARTE, CHROME_SEG: CHROME_SEG, TOLERANCE_TOUCHER: TOLERANCE_TOUCHER, TAGS: TAGS,
    ghTypo: ghTypo, mesureur: mesureur, ghAxe: ghAxe, ghY: ghY, ghT: ghT, ghHauteurHeure: ghHauteurHeure,
    ghPrefixe: ghPrefixe, ghFormesBrutes: ghFormesBrutes, ghFormes: ghFormes, ghUnicite: ghUnicite, ghNoms: ghNoms,
    ghVoies: ghVoies, ghParties: ghParties, ghBarre: ghBarre, ghEtats: ghEtats, ghCompteurs: ghCompteurs,
    ghComposer: ghComposer, ghComposerPresence: ghComposerPresence, ghComposerSegment: ghComposerSegment,
    ghRepartir: ghRepartir, ghPlan: ghPlan, ghClasses: ghClasses, ghAria: ghAria, ghClassesHeure: ghClassesHeure, ghMaintenant: ghMaintenant,
    ghTete: ghTete, ghSousLigne: ghSousLigne, ghTeteTexte: ghTeteTexte, ghCarteProche: ghCarteProche, ghCaseLibre: ghCaseLibre,
    casser: casser, largeurLigne: largeurLigne, unitesNom: unitesNom, heureTexte: heureTexte, cleTexte: cleTexte,
  };
});

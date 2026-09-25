/* SYNCHRONISATION VIVANTE DE LA CONSOLE (2026-09-06, etendue a toutes les
 * pages le 2026-09-25).
 *
 * Le probleme mesure : chaque page se chargeait UNE fois. Un mail, une demande,
 * un prix ou un blocage change sur un autre poste n existait pas a l ecran tant
 * que personne ne rechargeait la page a la main. Deux consequences, la seconde
 * bien pire que la premiere :
 *
 *   1. on croyait l ecran juste alors qu il ne l etait plus ;
 *   2. deux personnes pouvaient agir sur la meme chose, chacune persuadee
 *      d etre seule, parce que l action de l une n apparaissait jamais chez
 *      l autre.
 *
 * Rafraichir toutes les pages toutes les deux secondes couterait cher pour
 * rien : la quasi-totalite du temps, rien n a bouge. On lit donc d abord un
 * POULS (`/api/ops?action=pulse`) : une empreinte minuscule PAR DOMAINE
 * (reservations, pistes, demandes, catalogue, configuration, equipe, mails...),
 * sans aucune donnee metier. La page ne relit que les domaines qui ont bouge.
 *
 * Contrats de ce module :
 *   - cadence de base 2 s, recul x1,8 jusqu a 30 s sur erreur reseau, retour a
 *     la base des qu une lecture passe ;
 *   - onglet cache : AUCUNE requete (un onglet oublie ne coute rien), et
 *     lecture immediate au retour plutot que d attendre le prochain tour ;
 *   - la premiere lecture MEMORISE sans recharger : la page vient d etre
 *     chargee, la recharger aussitot serait un aller-retour pour rien ;
 *   - un changement de centre repart sur une nouvelle base, sans recharger les
 *     donnees du centre qu on vient de quitter ; un domaine qui APPARAIT (la
 *     journee affichee `jour:<date>` quand on change de date) aussi ;
 *   - jamais deux lectures en vol ;
 *   - un rechargement refuse (quelqu un ecrit) n est pas oublie : il repasse.
 *
 * Le moteur ne connait ni la page, ni le rendu : on lui donne « comment lire »,
 * « suis-je actif » et « recharge ces domaines », il ne fait que decider QUAND.
 */
(function (global) {
  'use strict';

  // 2 s : le pouls ne coute que 2 ms cote base (mesure en production le
  // 2026-09-25) et ne renvoie aucune donnee metier. La contrainte n est pas le
  // serveur, c est la sensation : au-dela de 3 secondes, on a le temps de se
  // demander si l autre ecran a bien pris la modification.
  var CADENCE_MS = 2000;
  var CADENCE_MAX_MS = 30000;
  var FACTEUR_RECUL = 1.8;

  // Ce que le serveur a repondu, sous une seule forme : un domaine -> une
  // empreinte. Un serveur d avant les domaines ne rend qu `empreinte` : elle
  // devient le domaine « * », qui touche toutes les pages.
  function vecteurDe(reponse) {
    if (!reponse || typeof reponse !== 'object') return null;
    var domaines = reponse.domaines;
    if (domaines && typeof domaines === 'object') {
      var vecteur = {};
      var n = 0;
      Object.keys(domaines).forEach(function (nom) {
        if (typeof domaines[nom] === 'string' && domaines[nom]) { vecteur[nom] = domaines[nom]; n += 1; }
      });
      if (n) return vecteur;
    }
    return reponse.empreinte ? { '*': String(reponse.empreinte) } : null;
  }

  // Les domaines qui ONT CHANGE : presents des deux cotes, avec deux valeurs.
  // Un domaine qui apparait est une nouvelle base, pas un changement ; un
  // domaine qui disparait ne dit rien.
  function domainesChanges(avant, apres) {
    return Object.keys(apres).filter(function (nom) {
      return Object.prototype.hasOwnProperty.call(avant, nom) && avant[nom] !== apres[nom];
    });
  }

  function creerSynchroLive(options) {
    var opts = options || {};
    var doc = opts.doc || (typeof document !== 'undefined' ? document : null);
    var lire = typeof opts.lire === 'function'
      ? opts.lire
      : function (centre) {
        return global.apiRequest('/api/ops?action=pulse&centerId=' + encodeURIComponent(centre));
      };
    var estActive = typeof opts.estActive === 'function' ? opts.estActive : function () { return true; };
    var recharger = typeof opts.recharger === 'function' ? opts.recharger : function () {};
    var centreActuel = typeof opts.centreActuel === 'function' ? opts.centreActuel : function () { return ''; };
    var programmer = opts.setTimeoutImpl || function (fn, ms) { return setTimeout(fn, ms); };
    var annuler = opts.clearTimeoutImpl || function (handle) { clearTimeout(handle); };
    var surErreur = typeof opts.surErreur === 'function' ? opts.surErreur : function () {};
    var cadenceDeBase = Number(opts.cadence) > 0 ? Number(opts.cadence) : CADENCE_MS;

    var cadence = cadenceDeBase;
    var timer = null;
    var arrete = true;
    var enVol = false;
    var memoire = null;
    var centreMemorise = null;
    var lectures = 0;
    var rechargements = 0;
    var reports = 0;
    var derniereLectureReussie = 0;

    function cache() {
      return Boolean(doc && doc.hidden);
    }

    function replanifier() {
      if (arrete) return;
      if (timer) { annuler(timer); }
      timer = programmer(tour, cadence);
    }

    async function tour() {
      timer = null;
      if (arrete) return;
      // Onglet cache ou page inactive : on ne consomme RIEN. Le retour sur
      // l onglet declenche une lecture immediate, donc rien n est perdu.
      if (cache() || !estActive()) { replanifier(); return; }
      if (enVol) { replanifier(); return; }
      var centre = String(centreActuel() || '');
      enVol = true;
      try {
        var reponse = await lire(centre);
        lectures += 1;
        var nouveau = vecteurDe(reponse);
        cadence = cadenceDeBase;
        // VIVANT = une lecture qui PORTE une empreinte. Une reponse sans
        // empreinte (un serveur qui ne connait pas le pouls) ne voit aucun
        // changement : le planning garde alors sa propre lecture a 4 s au lieu
        // de se reposer sur un pouls aveugle.
        if (nouveau) derniereLectureReussie = Date.now();
        if (!nouveau) {
          // Reponse sans empreinte : on ne conclut rien, ni changement ni
          // stabilite. Conclure « ca a bouge » ferait recharger en boucle.
        } else if (memoire === null || centreMemorise !== centre) {
          // NOUVELLE BASE, dans les deux cas ou comparer n aurait aucun sens :
          //   - la toute premiere lecture (la page vient d etre chargee, elle
          //     est deja a jour : la recharger serait un aller-retour pour rien
          //     a chaque ouverture, pour chaque personne) ;
          //   - un changement de centre (deux centres ont deux empreintes sans
          //     rapport ; les comparer ferait recharger les donnees du centre
          //     qu on vient de quitter).
          centreMemorise = centre;
          memoire = nouveau;
        } else {
          var changes = domainesChanges(memoire, nouveau);
          if (!changes.length) {
            // Rien n a bouge sur les domaines connus : on adopte la reponse,
            // ce qui range les domaines apparus (la nouvelle journee) et
            // oublie ceux qui ont disparu (l ancienne).
            memoire = nouveau;
          } else {
            // ON NE COUPE JAMAIS QUELQU UN QUI ECRIT. Un rechargement
            // reconstruit la page : si une gerante est en train de taper, elle
            // perdrait son curseur au milieu d une phrase, ou sa saisie, a
            // cause d une action d un collegue. `recharger` peut donc repondre
            // false, « pas maintenant ». Dans ce cas rien n est memorise : les
            // changements restent en attente et repassent au tour suivant.
            var fait = await recharger(changes);
            if (fait !== false) {
              memoire = nouveau;
              rechargements += 1;
            } else {
              reports += 1;
            }
          }
        }
      } catch (error) {
        cadence = Math.min(CADENCE_MAX_MS, Math.round(cadence * FACTEUR_RECUL));
        surErreur(error);
      } finally {
        enVol = false;
      }
      replanifier();
    }

    function surVisibilite() {
      if (arrete || cache()) return;
      // Retour sur l onglet : on ne fait pas attendre. C est le moment ou la
      // personne regarde l ecran, donc le moment ou il doit etre juste.
      if (timer) { annuler(timer); timer = null; }
      tour();
    }

    function demarrer() {
      if (!arrete) return api;
      arrete = false;
      cadence = cadenceDeBase;
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', surVisibilite);
      }
      tour();
      return api;
    }

    function arreter() {
      arrete = true;
      if (timer) { annuler(timer); timer = null; }
      if (doc && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('visibilitychange', surVisibilite);
      }
      return api;
    }

    var api = {
      demarrer: demarrer,
      arreter: arreter,
      // Lecture seule, pour les mesures : rien ici ne pilote le comportement.
      get cadence() { return cadence; },
      get memoire() { return memoire ? Object.assign({}, memoire) : null; },
      get lectures() { return lectures; },
      get rechargements() { return rechargements; },
      get reports() { return reports; },
      get enVol() { return enVol; },
      // Le pouls vit-il ? Le planning s en sert pour espacer sa propre lecture.
      get vivant() { return !arrete && derniereLectureReussie > 0 && (Date.now() - derniereLectureReussie) < Math.max(3 * cadenceDeBase, 8000); },
    };
    return api;
  }

  // ---------------------------------------------------------------------------
  // LE CABLAGE : quelle page est affichee, et ce qu elle relit.
  //
  // UNE SEULE BOUCLE POUR TOUTE LA CONSOLE. La table des pages vit dans
  // app-main (getLiveSyncPages), a cote des chargeurs qu elle appelle ; ce
  // module ne connait que la regle :
  //   1. les caches de TOUS les domaines changes sont invalides, quelle que
  //      soit la page affichee (invalidateLiveSyncCaches). Sans cela, un
  //      changement vu pendant qu on regarde une autre page serait « consomme »
  //      et la page concernee s ouvrirait plus tard sur ses donnees d avant ;
  //   2. la page affichee ne relit que si l un de SES domaines a bouge.
  // ---------------------------------------------------------------------------
  function tablePages(m) {
    var table = typeof m.getLiveSyncPages === 'function' ? m.getLiveSyncPages() : null;
    return table && typeof table === 'object' ? table : null;
  }

  // QUELLE PAGE EST DEVANT LES YEUX, parmi celles qu on sait recharger.
  function pageActive(monde) {
    var m = monde || global;
    var nom = typeof m.getLiveSyncPageName === 'function' ? String(m.getLiveSyncPageName() || '') : '';
    var table = tablePages(m);
    if (!nom || !table || !table[nom] || typeof table[nom].recharger !== 'function') return '';
    return nom;
  }

  // Un changement concerne une page si elle declare son domaine. « jour »
  // couvre toutes les journees (`jour:2026-09-25`) ; « * » (un serveur d avant
  // les domaines) les concerne toutes.
  function concerne(domainesDeLaPage, changes) {
    var liste = Array.isArray(domainesDeLaPage) ? domainesDeLaPage : [];
    return changes.some(function (nom) {
      if (nom === '*') return true;
      var deuxPoints = nom.indexOf(':');
      var famille = deuxPoints >= 0 ? nom.slice(0, deuxPoints) : nom;
      return liste.indexOf(famille) !== -1;
    });
  }

  function rechargerLaPageActive(monde, changes) {
    var m = monde || global;
    var liste = Array.isArray(changes) && changes.length ? changes : ['*'];
    var page = pageActive(m);
    if (!page) return undefined;
    var definition = tablePages(m)[page];
    if (!concerne(definition.domaines, liste)) return undefined;
    // Une page en mode edition (un formulaire ouvert qui garde son brouillon
    // ailleurs que dans ses champs) le dit : on ne la reconstruit pas sous les
    // doigts, le changement repasse au tour suivant.
    if (typeof definition.brouillon === 'function' && definition.brouillon()) return false;
    return definition.recharger(liste);
  }

  // « Est-ce que quelqu un est en train d ecrire ? » Le champ actif suffit a le
  // dire, et c est la premiere chose qu un rechargement peut casser.
  function enTrainDeSaisir() {
    if (typeof document === 'undefined') return false;
    var actif = document.activeElement;
    if (!actif) return false;
    if (actif.isContentEditable) return true;
    var balise = String(actif.tagName || '').toUpperCase();
    if (balise === 'TEXTAREA') return true;
    if (balise !== 'INPUT') return false;
    // Les cases a cocher et les boutons ne portent pas de texte en cours : les
    // compter ferait geler la synchronisation sur un simple filtre coche.
    var type = String(actif.type || 'text').toLowerCase();
    return ['button', 'checkbox', 'radio', 'submit', 'reset', 'file'].indexOf(type) === -1;
  }

  // « Y a-t-il une saisie pas encore enregistree ? » La deuxieme chose qu un
  // rechargement casse : un formulaire rempli puis quitte (la personne est
  // allee verifier quelque chose plus bas, ou dans un autre onglet) n a plus le
  // curseur, mais ses valeurs n existent que dans la page. On ne regarde que
  // les champs que la personne a VRAIMENT touches (evenement de confiance), et
  // seulement s ils different encore de la valeur que la page leur avait
  // donnee. Les filtres de liste (recherche, periode) gardent leur valeur dans
  // l etat de la page : ils sont marques `data-pl-libre` et ne retiennent rien.
  var ATTRIBUT_TOUCHE = 'data-pl-touche';

  function champLibre(el) {
    if (!el || typeof el.closest !== 'function') return true;
    if (String(el.type || '').toLowerCase() === 'search') return true;
    // Un champ qui recopie sa valeur dans l etat de la page a chaque frappe
    // (oninput ou onchange en ligne) est redessine avec elle : une
    // reconstruction ne lui fait rien perdre.
    if (el.hasAttribute('oninput') || el.hasAttribute('onchange')) return true;
    return Boolean(el.closest('[data-pl-libre]'));
  }

  function valeurModifiee(el) {
    var type = String(el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return el.checked !== el.defaultChecked;
    if (String(el.tagName || '').toUpperCase() === 'SELECT') {
      var options = el.options || [];
      var parDefaut = 0;
      for (var i = 0; i < options.length; i += 1) {
        if (options[i].defaultSelected) { parDefaut = i; break; }
      }
      return el.selectedIndex !== parDefaut;
    }
    return el.value !== el.defaultValue;
  }

  function saisieNonEnregistree() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return false;
    var champs = document.querySelectorAll('[' + ATTRIBUT_TOUCHE + ']');
    for (var i = 0; i < champs.length; i += 1) {
      var el = champs[i];
      if (!el.isConnected || champLibre(el)) continue;
      if (valeurModifiee(el)) return true;
    }
    return false;
  }

  function marquerLesChampsTouches() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    var marquer = function (evenement) {
      var cible = evenement && evenement.target;
      if (!evenement.isTrusted || !cible || typeof cible.setAttribute !== 'function') return;
      var balise = String(cible.tagName || '').toUpperCase();
      if (balise !== 'INPUT' && balise !== 'TEXTAREA' && balise !== 'SELECT') return;
      cible.setAttribute(ATTRIBUT_TOUCHE, '1');
    };
    document.addEventListener('input', marquer, true);
    document.addEventListener('change', marquer, true);
  }

  var boucle = null;

  function synchroniserLaConsole() {
    if (boucle) return boucle;
    marquerLesChampsTouches();
    boucle = creerSynchroLive({
      lire: function (centre) {
        // La journee affichee voyage avec le pouls : son empreinte propre
        // couvre aussi les dates hors de la fenetre du planning.
        var date = typeof global.getLiveSyncDate === 'function' ? String(global.getLiveSyncDate() || '') : '';
        return global.apiRequest('/api/ops?action=pulse&centerId=' + encodeURIComponent(centre)
          + (date ? '&date=' + encodeURIComponent(date) : ''));
      },
      estActive: function () {
        // Les pages qu on sait recharger, et elles seules : rafraichir pendant
        // qu un autre ecran est affiche couterait des lectures que personne ne
        // verrait. Au retour sur une page connue, la premiere lecture rattrape
        // tout ce qui a bouge entre-temps. Jamais d exception : elle tuerait la
        // boucle en silence, et la console redeviendrait figee.
        try { return Boolean(pageActive(global)); } catch (error) { return false; }
      },
      centreActuel: function () {
        return typeof global.getActiveOpsCenterId === 'function' ? global.getActiveOpsCenterId() : '';
      },
      recharger: function (changes) {
        // 1. Les caches de tous les domaines changes, sans toucher a l ecran :
        //    c est idempotent, on peut le refaire au tour suivant si la page,
        //    elle, doit attendre.
        if (typeof global.invalidateLiveSyncCaches === 'function') global.invalidateLiveSyncCaches(changes);
        // 2. Quelqu un ecrit, ou a laisse une saisie non enregistree : on
        //    repousse la reconstruction de la page. Le pouls redira au tour
        //    suivant qu il y a du neuf, et la mise a jour arrivera des que le
        //    champ est quitte, ou le formulaire enregistre ou annule.
        if (enTrainDeSaisir() || saisieNonEnregistree()) return false;
        return rechargerLaPageActive(global, changes);
      },
    });
    return boucle.demarrer();
  }

  global.creerSynchroLive = creerSynchroLive;
  global.pageActiveDeLaConsole = pageActive;
  global.rechargerLaPageActive = rechargerLaPageActive;
  global.synchroniserLaConsole = synchroniserLaConsole;
  global.saisieNonEnregistreeDansLaConsole = saisieNonEnregistree;
  global.pinlanePoulsVivant = function () { return Boolean(boucle && boucle.vivant); };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { synchroniserLaConsole(); });
    } else {
      synchroniserLaConsole();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      creerSynchroLive: creerSynchroLive,
      pageActive: pageActive,
      rechargerLaPageActive: rechargerLaPageActive,
      concerne: concerne,
      vecteurDe: vecteurDe,
      domainesChanges: domainesChanges,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);

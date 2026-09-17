/* SYNCHRONISATION VIVANTE DE LA CONSOLE (2026-09-06).
 *
 * Le probleme mesure : la page Emails se chargeait UNE fois. Un mail qui
 * arrivait ensuite n existait pas a l ecran tant que personne ne rechargeait la
 * page a la main. Deux consequences, la seconde bien pire que la premiere :
 *
 *   1. on croyait la boite vide alors qu elle ne l etait pas ;
 *   2. deux personnes sur la meme boite pouvaient repondre au meme message,
 *      chacune persuadee d etre seule, parce que la reponse de l une
 *      n apparaissait jamais chez l autre.
 *
 * Rafraichir les six blocs de la console toutes les quelques secondes couterait
 * cher pour rien : la quasi-totalite du temps, rien n a bouge. On lit donc
 * d abord un POULS (`/api/ops?action=pulse`), une empreinte minuscule qui ne
 * porte aucune donnee metier, et on ne recharge que lorsqu elle change.
 *
 * Contrats de ce module :
 *   - cadence de base 4 s, recul x1,8 jusqu a 30 s sur erreur reseau, retour a
 *     la base des qu une lecture passe ;
 *   - onglet cache : AUCUNE requete (un onglet oublie ne coute rien), et
 *     lecture immediate au retour plutot que d attendre le prochain tour ;
 *   - la premiere lecture MEMORISE sans recharger : la page vient d etre
 *     chargee, la recharger aussitot serait un aller-retour pour rien ;
 *   - un changement de centre repart sur une nouvelle base, sans recharger les
 *     donnees du centre qu on vient de quitter ;
 *   - jamais deux lectures en vol.
 *
 * Le module ne connait ni la page, ni le rendu : on lui donne « comment lire »,
 * « suis-je actif » et « recharge », il ne fait que decider QUAND.
 */
(function (global) {
  'use strict';

  // 2,5 s : le pouls ne coute que 26 ms cote base et ne renvoie aucune donnee
  // metier. La contrainte n est pas le serveur, c est la sensation : au-dela de
  // 3 secondes, on a le temps de se demander si la page est figee.
  var CADENCE_MS = 2500;
  var CADENCE_MAX_MS = 30000;
  var FACTEUR_RECUL = 1.8;

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

    var cadence = CADENCE_MS;
    var timer = null;
    var arrete = true;
    var enVol = false;
    var empreinte = null;
    var centreMemorise = null;
    var lectures = 0;
    var rechargements = 0;
    var reports = 0;

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
        var nouvelle = reponse && reponse.empreinte ? String(reponse.empreinte) : '';
        cadence = CADENCE_MS;
        if (!nouvelle) {
          // Reponse sans empreinte : on ne conclut rien, ni changement ni
          // stabilite. Conclure « ca a bouge » ferait recharger en boucle.
        } else if (empreinte === null || centreMemorise !== centre) {
          // NOUVELLE BASE, dans les deux cas ou comparer n aurait aucun sens :
          //   - la toute premiere lecture (la page vient d etre chargee, elle
          //     est deja a jour : la recharger serait un aller-retour pour rien
          //     a chaque ouverture, pour chaque personne) ;
          //   - un changement de centre (deux centres ont deux empreintes sans
          //     rapport ; les comparer ferait recharger les donnees du centre
          //     qu on vient de quitter).
          // Une seule regle plutot que deux branches : la seconde etait
          // inatteignable, donc jamais mesurable.
          centreMemorise = centre;
          empreinte = nouvelle;
        } else if (nouvelle !== empreinte) {
          // ON NE COUPE JAMAIS QUELQU UN QUI ECRIT. Un rechargement complet
          // reconstruit la page : si une gerante est en train de taper sa
          // reponse, elle perdrait son curseur au milieu d une phrase, a cause
          // d une action d un collegue. `recharger` peut donc repondre false,
          // « pas maintenant ». Dans ce cas l empreinte n est PAS memorisee :
          // le changement reste en attente et repassera au tour suivant. La
          // memoriser reviendrait a oublier definitivement la mise a jour.
          var fait = await recharger();
          if (fait !== false) {
            empreinte = nouvelle;
            rechargements += 1;
          } else {
            reports += 1;
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
      cadence = CADENCE_MS;
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
      get empreinte() { return empreinte; },
      get lectures() { return lectures; },
      get rechargements() { return rechargements; },
      get reports() { return reports; },
      get enVol() { return enVol; },
    };
    return api;
  }

  // UNE SEULE BOUCLE POUR TOUTE LA CONSOLE, et c est la PAGE AFFICHEE qui
  // decide ce qui se recharge. Une boucle par page se serait multipliee a
  // chaque nouvel ecran, avec autant de reglages a garder coherents ; et un
  // pouls unique repond a la seule question qui compte, « est-ce que quelque
  // chose a bouge dans ce centre ».
  //
  // Consequence assumee : sur la page Emails, une reservation prise ailleurs
  // fait aussi bouger l empreinte et provoque un rechargement de la console.
  // C est un aller-retour de plus, rare, contre une regle simple ; decouper
  // l empreinte par ecran serait plus fin, et plus facile a desynchroniser.
  //
  // Le rechargement est FORCE : le pouls vient de prouver qu il y a du neuf,
  // l anti-rebond de 8 secondes des chargeurs n a plus lieu d etre ici.
  var boucle = null;

  // QUELLE PAGE EST DEVANT LES YEUX. Extrait ici, avec son monde injectable,
  // pour que la regle « telle page, tel rechargement » soit mesurable au lieu
  // d etre enfouie dans le cablage.
  function pageActive(monde) {
    var m = monde || global;
    if (typeof m.isStaffEmailsActive === 'function' && m.isStaffEmailsActive() && typeof m.loadOpsAdmin === 'function') return 'emails';
    if (typeof m.isStaffUtilityActive === 'function' && m.isStaffUtilityActive() && typeof m.loadOpsAdmin === 'function') return 'utilitaire';
    if (typeof m.isStaffReservationsActive === 'function' && m.isStaffReservationsActive() && typeof m.loadStaffReservationsData === 'function') return 'reservations';
    return '';
  }

  function rechargerLaPageActive(monde) {
    var m = monde || global;
    var page = pageActive(m);
    // La page Emails v4 lit aussi des conversations et une vue globale, hors
    // de loadOpsAdmin : elle les relit elle-meme (pv2EmailsSurSynchro).
    if (page === 'emails' && typeof m.pv2EmailsSurSynchro === 'function') m.pv2EmailsSurSynchro();
    if (page === 'emails' || page === 'utilitaire') return m.loadOpsAdmin(true);
    if (page === 'reservations') return m.loadStaffReservationsData(true);
    return undefined;
  }

  // « Est-ce que quelqu un est en train d ecrire ? » Le champ actif suffit a le
  // dire, et c est la seule chose qu un rechargement peut casser.
  function enTrainDeSaisir() {
    if (typeof document === "undefined") return false;
    var actif = document.activeElement;
    if (!actif) return false;
    if (actif.isContentEditable) return true;
    var balise = String(actif.tagName || "").toUpperCase();
    if (balise === "TEXTAREA") return true;
    if (balise !== "INPUT") return false;
    // Les cases a cocher et les boutons ne portent pas de texte en cours : les
    // compter ferait geler la synchronisation sur un simple filtre coche.
    var type = String(actif.type || "text").toLowerCase();
    return ["button", "checkbox", "radio", "submit", "reset", "file"].indexOf(type) === -1;
  }

  function synchroniserLaConsole() {
    if (boucle) return boucle;
    boucle = creerSynchroLive({
      estActive: function () {
        // Les pages qu on sait recharger, et elles seules : rafraichir pendant
        // qu un autre ecran est affiche couterait un chargement complet que
        // personne ne verrait.
        return Boolean(pageActive(global));
      },
      centreActuel: function () {
        return typeof global.getActiveOpsCenterId === 'function' ? global.getActiveOpsCenterId() : '';
      },
      recharger: function () {
        // Quelqu un est en train d ecrire : on repousse. Le pouls redira au
        // tour suivant qu il y a du neuf, et la mise a jour arrivera des que le
        // champ est quitte. Perdre son curseur au milieu d une reponse a cause
        // d un mail arrive chez un collegue serait pire que le retard.
        if (enTrainDeSaisir()) return false;
        return rechargerLaPageActive(global);
      },
    });
    return boucle.demarrer();
  }

  global.creerSynchroLive = creerSynchroLive;
  global.pageActiveDeLaConsole = pageActive;
  global.rechargerLaPageActive = rechargerLaPageActive;
  global.synchroniserLaConsole = synchroniserLaConsole;

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { synchroniserLaConsole(); });
    } else {
      synchroniserLaConsole();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { creerSynchroLive: creerSynchroLive, pageActive: pageActive, rechargerLaPageActive: rechargerLaPageActive };
  }
})(typeof window !== 'undefined' ? window : globalThis);

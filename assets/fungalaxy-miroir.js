/*
 * LA COPIE DANS L ANCIEN FORMULAIRE DU SITE, CHARGEE A LA DEMANDE (2026-11-13).
 *
 * Ansar : « faut que ça fasse une resa en meme temps de exactement comme ils ont deja actuellement ... pour voir si
 * tout coincide ». Pendant l essai, la page du centre envoie chaque reservation aussi par son ancien formulaire,
 * masque (embed.js, data-miroir). A la confirmation, le cadre lui passe ce que le visiteur y aurait tape : une ligne
 * par activite, a son heure, ou la formule. Une demande de groupe y entre aussi, en une ligne « Demande de groupe »
 * (Ansar, le 13/11 : « et pour les groupes on fait quoi »). Ce fichier ne part que quand embed.js demande la copie (miroir=1) :
 * fungalaxy-booking.js le charge alors des l ouverture, le parcours de tous les autres n en paie rien.
 *
 * CE SONT DES DONNEES PERSONNELLES : elles ne partent que vers le site du centre lui-meme (identity.siteUrl, avec ou
 * sans www), jamais vers une autre page qui embarquerait le cadre. Le resultat revient de la page et part a Pinlane
 * sans rien de personnel (kind « miroir ») : une copie ratee sonne au lieu de se perdre.
 *
 * `window.FGMiroir(I)` : I porte l etat et les outils du formulaire (interne() dans fungalaxy-booking.js). La
 * fabrique ecoute la reponse de la page et rend { recopier(reservation, quand), recopierDemande(numero, ligne) }.
 */
(function () {
  'use strict';

  var JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

  window.FGMiroir = function (I) {
    var state = I.state;
    var parentOrigin = I.parentOrigin;

    function siteDuCentre(origine) {
      var m = I.meta;
      var site = m && m.center && m.center.identity && m.center.identity.siteUrl;
      try {
        var a = new URL(String(site || '')), b = new URL(String(origine || ''));
        var hote = function (u) { return u.hostname.toLowerCase().replace(/^www\./, ''); };
        return a.protocol === 'https:' && b.protocol === 'https:' && hote(a) === hote(b) && a.port === b.port;
      } catch (e) { return false; }
    }
    // « Samedi 21/11/2026 » : le jour se lit sans hesiter, l annee comprise (le champ de leur formulaire est libre).
    function jourDuMiroir(s) {
      var d = I.deIso(s);
      return JOURS[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    }
    function lignesDuMiroir(r, quand) {
      var m = I.meta;
      var commun = {
        nom: String(r.name || (state.contact.prenom + ' ' + state.contact.nom)).trim(),
        telephone: String(r.phone || state.contact.telephone || ''),
        email: String(r.email || state.contact.email || ''),
        centre: String((m && m.center && m.center.name) || ''),
        centreId: I.CENTER,
        jour: jourDuMiroir(quand.date),
      };
      if (state.onglet === 'formules') {
        var f = I.formuleChoisie() || {};
        return [Object.assign({ type: 'formule', formule: String(f.name || r.label || ''), formuleId: String(r.formuleId || state.formuleId || ''), heure: quand.heure, participants: quand.pax }, commun)];
      }
      // Chaque activite a l heure de sa premiere partie dans le plan rendu ; celles sans heure (l equipe les place)
      // a l heure de la reservation. L offre d attente se joue sur place : elle ne se reservait pas par l ancien
      // formulaire.
      var rep = (state.creneau || {}).reponse || {};
      var items = r.program && r.program.items ? r.program.items : (rep.program && rep.program.items) || [];
      var parties = quand.heure === state.heure && state.creneau ? I.partiesDuPlan(state.creneau) : [];
      return items.filter(function (it) { return it && it.activityId && it.waitOffer !== true; }).map(function (it) {
        var sienne = parties.filter(function (p) { return p.id === it.activityId; })[0];
        return Object.assign({
          type: 'activite', activite: String(it.name || I.nomActivite(it.activityId)), activiteId: String(it.activityId),
          heure: (sienne && sienne.debut) || quand.heure, participants: Number(it.participants) || I.joueursDe(I.activite(it.activityId)) || quand.pax,
        }, commun);
      }).sort(function (x, y) { return x.heure < y.heure ? -1 : x.heure > y.heure ? 1 : 0; });
    }
    function signaler(resultat) {
      try {
        // « d77 » : la demande de groupe n°77 (ses numeros ne sont pas ceux des reservations).
        var demande = /^d\d+$/.test(String(resultat.id));
        var corps = JSON.stringify({
          kind: 'miroir', centerId: I.CENTER, reservationId: demande ? 0 : Number(resultat.id) || 0,
          demandeId: demande ? Number(String(resultat.id).slice(1)) : 0, ok: resultat.ok === true,
          raison: String(resultat.raison || '').slice(0, 200), lignes: Number(resultat.lignes) || 0, envoyees: Number(resultat.envoyees) || 0,
        });
        if (navigator.sendBeacon && navigator.sendBeacon('/api/public-booking-meta', new Blob([corps], { type: 'application/json' }))) return;
        fetch('/api/public-booking-meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps, keepalive: true, credentials: 'omit' }).catch(function () {});
      } catch (e) { /* le signal ne casse jamais l ecran final */ }
    }

    var attendu = null;
    window.addEventListener('message', function (event) {
      if (!parentOrigin || event.origin !== parentOrigin || event.source !== window.parent) return;
      var d = event.data || {};
      if (d.type !== 'pinlane:miroir-fait' || !attendu || String(d.id) !== attendu.id) return;
      clearTimeout(attendu.minuteur);
      attendu = null;
      signaler(d);
    });

    // faireLignes ne se lit qu une fois la page reconnue : ce sont des donnees personnelles.
    function envoyer(id, faireLignes) {
      if (!id || !parentOrigin) return;
      // Une page qui n est pas le site de la fiche ne recoit rien ; que la copie n ait pas eu lieu se sait quand meme.
      if (!siteDuCentre(parentOrigin)) { signaler({ id: id, ok: false, raison: 'autre-site' }); return; }
      var lignes = faireLignes();
      if (!lignes.length) { signaler({ id: id, ok: false, raison: 'rien-a-copier' }); return; }
      if (attendu) clearTimeout(attendu.minuteur);
      attendu = { id: id, minuteur: setTimeout(function () {
        if (!attendu || attendu.id !== id) return;
        attendu = null;
        signaler({ id: id, ok: false, raison: 'sans-reponse', lignes: lignes.length });
      }, 60000) };
      I.poster({ type: 'pinlane:miroir', id: id, lignes: lignes });
    }
    function recopier(r, quand) {
      var id = /^\d{1,12}$/.test(String(r.id || '')) ? String(r.id) : '';
      envoyer(id, function () { return lignesDuMiroir(r, quand); });
    }
    // Une demande de groupe : une seule entree, que le module de la demande compose (ligneDuMiroirSm).
    function recopierDemande(numero, ligne) {
      var n = /^\d{1,12}$/.test(String(numero == null ? '' : numero)) ? String(numero) : '';
      envoyer(n ? 'd' + n : '', function () { return ligne ? [ligne] : []; });
    }

    return { recopier: recopier, recopierDemande: recopierDemande };
  };
}());

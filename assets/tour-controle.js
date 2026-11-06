/* LA TOUR DE CONTROLE (Ansar, 2026-11-05 : « un endroit ou jpeux voir toutes les
   reservations [...] avec tout info si ya eu des bugs [...] dont moi seul aura acces »).

   Page de la categorie Plateforme : le serveur exige platform.admin sur chaque lecture
   (api/ops.js, founderTour et founderTourDossier), le menu ne la montre qu a ce role.

   Elle se met a jour toute seule, toutes les 30 s, sans repeindre ses filtres : le champ
   de recherche garde son curseur, le dossier ouvert reste ouvert. Une section qui manque
   se dit, elle ne devient jamais un zero. La recherche par nom se fait ici, jamais dans
   l adresse : un nom dans une adresse finit dans les journaux. */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v ?? '') : String(v ?? ''));
  const FUSEAU = 'Europe/Brussels';
  const CADENCE_MS = 30000;
  const CLE_PAGE = 'cockpit-tour';

  const tour = {
    donnees: null,
    erreur: '',
    enCours: false,
    filtres: { centre: '', quand: '7j', canal: '', statut: '', visite: '' },
    cherche: '',
    ouvert: null,
    dossiers: {},
    minuteur: null,
    racine: null,
  };

  const heure = (iso) => (iso ? new Intl.DateTimeFormat('fr-BE', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
  const jourCourt = (iso) => (iso ? new Intl.DateTimeFormat('fr-BE', { timeZone: FUSEAU, day: '2-digit', month: '2-digit' }).format(new Date(iso)) : '');
  const jourDeVisite = (date) => {
    if (!date) return '';
    const d = new Date(`${date}T12:00:00Z`);
    return new Intl.DateTimeFormat('fr-BE', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);
  };
  const euros = (n) => new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n) || 0);
  function ilYA(iso) {
    if (!iso) return 'jamais';
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'à l’instant';
    if (minutes < 60) return `il y a ${minutes} min`;
    if (minutes < 2880) return `il y a ${Math.round(minutes / 60)} h`;
    return `il y a ${Math.round(minutes / 1440)} jours`;
  }
  const chip = (ton, mot) => `<span class="pv2-chip ${ton}">${esc(mot)}</span>`;
  const nomDuCentre = (id) => {
    const c = tour.donnees && (tour.donnees.centres || []).find((x) => x.id === id);
    return c ? c.nom : id;
  };
  function marqueCentre(id) {
    const teinte = typeof window.staffCenterTint === 'function' ? window.staffCenterTint(id) : null;
    const style = teinte ? ` style="background:${esc(teinte.fond)};color:${esc(teinte.encre)}"` : '';
    return `<span class="tour-centre"${style}>${esc(nomDuCentre(id))}</span>`;
  }

  // ---- Ce qui ne va pas -----------------------------------------------------
  function htmlEtat(d) {
    const problemes = d.problemes || [];
    const quand = `Dernier contrôle à ${heure(d.generatedAt)}. La page se met à jour toute seule.`;
    if (!problemes.length) {
      return `<div class="tour-etat is-ok" data-tour-etat="ok"><strong>Rien à signaler.</strong><span>${esc(quand)}</span></div>`;
    }
    const urgents = problemes.filter((p) => p.gravite === 'critique').length;
    const titre = urgents
      ? `${urgents} ${urgents > 1 ? 'problèmes urgents' : 'problème urgent'}${problemes.length > urgents ? `, et ${problemes.length - urgents} à regarder` : ''}.`
      : `${problemes.length} ${problemes.length > 1 ? 'points' : 'point'} à regarder.`;
    return `<div class="tour-etat ${urgents ? 'is-urgent' : 'is-attention'}" data-tour-etat="${urgents ? 'urgent' : 'attention'}"><strong>${esc(titre)}</strong><span>${esc(quand)}</span></div>
      <ul class="tour-problemes">${problemes.map((p) => `<li data-probleme="${esc(p.cle)}">${chip(p.gravite === 'critique' ? 'red' : 'amber', p.gravite === 'critique' ? 'Urgent' : 'À regarder')}<div><b>${esc(p.titre)}.</b> <span>${esc(p.detail || '')}</span></div></li>`).join('')}</ul>`;
  }

  // ---- Les centres ----------------------------------------------------------
  function htmlCentres(d) {
    const centres = (d.centres || []).filter((c) => c.garde);
    return centres.map((c) => {
      const secours = c.secours || {};
      const envoi = !secours.adresses
        ? '<span class="tour-attention">Aucune adresse de secours.</span>'
        : `Planning de secours envoyé ${secours.derniere ? `le ${esc(jourCourt(secours.derniere))} à ${esc(heure(secours.derniere))}` : 'pas encore'}, à ${secours.adresses} ${secours.adresses > 1 ? 'adresses' : 'adresse'}.`;
      const choisi = tour.filtres.centre === c.id;
      return `<div class="tour-bloc-centre${choisi ? ' is-choisi' : ''}" data-tour-centre="${esc(c.id)}">
        <span class="tour-bloc-nom">${esc(c.nom)}</span>
        <span>${c.enLigne ? 'Réservation en ligne ouverte.' : `<span class="tour-mauvais">${c.formulaireActif ? 'Ce centre n’ouvre pas encore ses réservations en ligne.' : 'Réservation en ligne coupée, l’ancien formulaire du site est revenu.'}</span>`}</span>
        <span>${c.recues ? `${c.recues} ${c.recues > 1 ? 'réservations reçues' : 'réservation reçue'} aujourd’hui, dont ${c.enLigneAujourdhui} en ligne.` : 'Aucune réservation reçue aujourd’hui.'}</span>
        <span>${c.visites ? `${c.visites} ${c.visites > 1 ? 'visites' : 'visite'} aujourd’hui, ${c.joueurs} ${c.joueurs > 1 ? 'joueurs' : 'joueur'}.` : 'Aucune visite aujourd’hui.'}</span>
        ${c.aValider ? `<span class="tour-attention">${c.aValider} à valider.</span>` : ''}
        <span>${envoi}</span>
        <div class="tour-bloc-gestes">
          ${secours.adresses ? '' : `<button type="button" class="pv2-btn ghost" data-tour-secours="${esc(c.id)}">Ajouter une adresse</button>`}
          <button type="button" class="pv2-btn ghost" data-tour-filtrer="${esc(c.id)}" aria-pressed="${choisi}">${choisi ? 'Voir tous les centres' : 'Voir ce centre seulement'}</button>
          <button type="button" class="pv2-btn ghost" data-tour-couper="${esc(c.id)}" data-actif="${c.formulaireActif ? '0' : '1'}">${c.formulaireActif ? 'Couper la réservation en ligne' : 'Remettre la réservation en ligne'}</button>
        </div>
      </div>`;
    }).join('');
  }

  // ---- Les reservations -----------------------------------------------------
  function statutDe(r) {
    if (r.statut === 'cancelled') return chip('red', 'Annulée');
    if (r.statut === 'paid') return chip('green', 'Payée');
    if (r.statut === 'arrived') return chip('green', 'Arrivée');
    if (r.aValider) return chip('amber', 'À valider');
    return chip('blue', 'Confirmée');
  }
  function mailDe(r) {
    const m = r.mails || {};
    if (m.echecs) return chip('red', m.echecs > 1 ? `${m.echecs} échecs` : 'Échec');
    if (m.attente) return chip('amber', 'En attente');
    if (m.envoyes) return chip('green', 'Parti');
    return '<span class="pv2-quiet">Aucun</span>';
  }
  const trouve = (r, q) => {
    if (!q) return true;
    // Le numero de la reservation, ecrit comme partout (« 1734 », « n° 1734 »).
    const numero = typeof numeroReservationDe === 'function' ? numeroReservationDe(q) : '';
    if (numero && String(r.id) === numero) return true;
    const chiffres = q.replace(/\D/g, '');
    const texte = `${r.nom} ${r.email} ${r.offre}`.toLowerCase();
    if (texte.includes(q)) return true;
    if (String(r.id) === q) return true;
    return chiffres.length >= 3 && String(r.telephone || '').replace(/\D/g, '').includes(chiffres);
  };
  function htmlListe(d) {
    const liste = d.reservations || { lignes: [], total: 0 };
    const q = tour.cherche.trim().toLowerCase();
    const lignes = liste.lignes.filter((r) => trouve(r, q));
    const compte = q
      ? `${lignes.length} sur ${liste.lignes.length}`
      : `${liste.total} ${liste.total > 1 ? 'réservations' : 'réservation'}${liste.total > liste.lignes.length ? `, les ${liste.lignes.length} dernières affichées` : ''}`;
    if (!lignes.length) {
      return `<p class="tour-compte" data-tour-compte>${esc(compte)}</p><p class="pv2-quiet tour-vide">Aucune réservation pour ces filtres.</p>`;
    }
    return `<p class="tour-compte" data-tour-compte>${esc(compte)}</p>
      <div class="tour-defile"><table class="tour-table">
        <thead><tr><th>Reçue</th><th>Centre</th><th>Client</th><th>Visite</th><th>Ce qu’il a pris</th><th class="num">Joueurs</th><th class="num">Prix</th><th>Par</th><th>État</th><th>Mail</th></tr></thead>
        <tbody>${lignes.map((r) => {
          const ouvert = tour.ouvert === r.id;
          return `<tr class="tour-ligne${ouvert ? ' is-ouvert' : ''}${r.statut === 'cancelled' ? ' is-annulee' : ''}" data-tour-ligne="${r.id}">
            <td class="tour-reçue">${esc(jourCourt(r.recuLe))} <b>${esc(heure(r.recuLe))}</b></td>
            <td>${marqueCentre(r.centre)}</td>
            <td><button type="button" class="tour-nom" aria-expanded="${ouvert}" data-tour-ouvrir="${r.id}">${esc(r.nom)}</button>${r.fabriquee ? ' <span class="pv2-chip">Essai</span>' : ''}</td>
            <td><b>${esc(r.heure)}</b> ${esc(jourDeVisite(r.date))}</td>
            <td class="tour-offre">${esc(r.offre)}</td>
            <td class="num">${r.joueurs}</td>
            <td class="num">${esc(euros(r.prix))}</td>
            <td>${r.canal === 'public' ? 'En ligne' : 'Comptoir'}</td>
            <td>${statutDe(r)}</td>
            <td>${mailDe(r)}</td>
          </tr>${ouvert ? `<tr class="tour-dossier-ligne"><td colspan="10">${htmlDossier(r.id)}</td></tr>` : ''}`;
        }).join('')}</tbody>
      </table></div>`;
  }

  // ---- Un dossier -----------------------------------------------------------
  const MOTS_MAIL = { request_received: 'Demande reçue', confirmation: 'Confirmation', reminder_48h: 'Rappel avant la venue', post_visit_followup: 'Merci après la visite', staff_review_request: 'À valider, pour l’équipe' };
  const MOTS_ETAT_MAIL = { sent: ['green', 'Parti'], delivered: ['green', 'Reçu'], queued: ['amber', 'En attente'], failed: ['red', 'Échec'], cancelled: ['', 'Annulé'], draft: ['', 'Brouillon'] };
  function htmlDossier(id) {
    const dossier = tour.dossiers[id];
    if (!dossier) return '<p class="pv2-quiet tour-vide">Chargement du dossier…</p>';
    if (dossier.erreur) return `<p class="pv2-quiet tour-vide">${esc(dossier.erreur)}</p>`;
    const r = dossier.reservation;
    const items = r.program && Array.isArray(r.program.items) ? r.program.items : [];
    const etapes = (dossier.plan && dossier.plan.etapes) || [];
    return `<div class="tour-dossier" data-tour-dossier="${r.id}">
      <section>
        <h3>Le client</h3>
        <p><b>${esc(r.name)}</b>, ${/^\d{1,12}$/.test(String(r.id)) ? `<button type="button" class="pv2-lien-numero" onclick="ouvrirReservationNumero('${r.id}')">réservation n°&nbsp;${r.id}</button>` : 'réservation sans numéro'}.</p>
        <p>${r.phone ? `<a href="tel:${esc(String(r.phone).replace(/[^0-9+]/g, ''))}">${esc(r.phone)}</a>` : 'Pas de téléphone.'}</p>
        <p>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : 'Pas d’adresse e-mail.'}</p>
        ${r.occasion ? `<p>Occasion, ${esc(r.occasion)}.</p>` : ''}
        ${r.notes ? `<p class="tour-note">${esc(r.notes)}</p>` : ''}
        <h3>La visite</h3>
        <p>${esc(jourDeVisite(r.date))} à ${esc(r.startTime)}, ${r.pax} ${r.pax > 1 ? 'joueurs' : 'joueur'}, ${esc(euros(r.price))}.</p>
        ${items.length ? `<ul class="tour-liste">${items.map((i) => `<li>${esc(i.name || i.activityId)}${i.participants ? `, ${i.participants} joueurs` : ''}${i.minutes ? `, ${i.minutes} min` : ''}${i.price !== undefined ? `, ${esc(euros(i.price))}` : ''}</li>`).join('')}</ul>` : ''}
        ${etapes.length ? `<h3>L’heure par heure</h3><ul class="tour-liste">${etapes.map((e) => `<li><b>${esc(e.debut)}</b>${e.fin ? ` à ${esc(e.fin)}` : ''}, ${esc(e.quoi)}</li>`).join('')}</ul>` : ''}
        ${r.lanes && r.lanes.length ? `<p>Pistes ${esc(r.lanes.join(', '))}.</p>` : ''}
      </section>
      <section>
        <h3>Les mails</h3>
        ${dossier.mails.length ? `<ul class="tour-liste">${dossier.mails.map((m) => {
          const etat = MOTS_ETAT_MAIL[m.statut] || ['', m.statut];
          return `<li data-tour-mail="${esc(m.statut)}">${chip(etat[0], etat[1])} <b>${esc(MOTS_MAIL[m.modele] || m.modele || m.objet)}</b>, à ${esc(m.a)}${m.envoyeLe ? `, le ${esc(jourCourt(m.envoyeLe))} à ${esc(heure(m.envoyeLe))}` : ''}.${m.essais > 1 ? ` ${m.essais} essais.` : ''}${m.evenements.length ? ` <span class="pv2-quiet">${esc(m.evenements.join(', '))}</span>` : ''}${m.erreur ? `<br><span class="tour-mauvais">${esc(m.erreur)}</span>` : ''}</li>`;
        }).join('')}</ul>` : '<p class="pv2-quiet">Aucun mail pour ce dossier.</p>'}
        <h3>Ce qui s’est passé</h3>
        ${dossier.histoire.length ? `<ul class="tour-liste">${dossier.histoire.map((h) => `<li><b>${esc(jourCourt(h.le))} ${esc(heure(h.le))}</b>, ${esc(h.par || '')} ${esc((h.quoi || []).join(', '))}</li>`).join('')}</ul>` : '<p class="pv2-quiet">Rien au journal pour ce dossier.</p>'}
        ${dossier.plan && dossier.plan.conflits.length ? `<h3>Ce que le moteur a signalé</h3><ul class="tour-liste">${dossier.plan.conflits.map((c) => `<li>${esc(c.texte)}</li>`).join('')}</ul>` : ''}
        ${dossier.plan && dossier.plan.validation && dossier.plan.validation.raison ? `<p>Validation demandée. ${esc(dossier.plan.validation.raison)}.</p>` : ''}
        <details class="tour-brut"><summary>Les données brutes</summary><pre>${esc(JSON.stringify(r, null, 1))}</pre></details>
      </section>
    </div>`;
  }

  // ---- Les essais qui n ont pas abouti, les plantages, les gardes -----------
  const MOTS_ESSAI = { 'reservation.refusee': 'Réservation refusée', 'blocage.refuse': 'Horaires refusés', 'reservation.panne': 'Panne à la confirmation', 'blocage.panne': 'Panne en retenant les horaires' };
  function htmlEssais(d) {
    const essais = d.essais || [];
    if (!essais.length) return '<p class="pv2-quiet tour-vide">Aucun essai raté depuis 24 h.</p>';
    return `<table class="tour-table tour-table--simple"><thead><tr><th>Centre</th><th>Quoi</th><th>Pourquoi</th><th class="num">Fois</th><th>Dernier</th></tr></thead><tbody>${essais.map((e) => `<tr data-tour-essai="${esc(e.action)}"><td>${e.centre === 'inconnu' ? 'Centre inconnu' : marqueCentre(e.centre)}</td><td>${esc(MOTS_ESSAI[e.action] || e.action)}</td><td>${esc(e.raison)}</td><td class="num">${e.n}</td><td>${esc(ilYA(e.dernier))}</td></tr>`).join('')}</tbody></table>`;
  }
  function htmlErreurs(d) {
    const erreurs = d.erreurs || [];
    if (!erreurs.length) return '<p class="pv2-quiet tour-vide">Aucun plantage depuis 24 h, ni chez les clients, ni dans la console.</p>';
    return `<table class="tour-table tour-table--simple"><thead><tr><th>Où</th><th>Centre</th><th>Message</th><th class="num">Fois</th><th>Dernier</th></tr></thead><tbody>${erreurs.map((e) => `<tr data-tour-erreur="${e.chezLeClient ? 'client' : 'console'}"><td>${e.chezLeClient ? chip('red', 'Chez un client') : chip('', 'Console')}</td><td>${marqueCentre(e.centre)}</td><td class="tour-message">${esc(e.message)}${e.page ? ` <span class="pv2-quiet">${esc(e.page)}</span>` : ''}</td><td class="num">${e.n}</td><td>${esc(ilYA(e.dernier))}</td></tr>`).join('')}</tbody></table>`;
  }
  function htmlGardes(d) {
    const taches = d.taches || [];
    const lignes = taches.map((t) => {
      const etat = t.enRetard && t.suivie ? chip('red', 'En retard') : t.statut === 'failed' ? chip('amber', 'Dernier passage raté') : t.dernierOk ? chip('green', 'En service') : chip('', 'Jamais passée');
      return `<tr data-tour-tache="${esc(t.id)}"><td><b>${esc(t.nom)}</b><br><span class="pv2-quiet">${esc(t.role)}</span></td><td>${esc(ilYA(t.dernierOk))}</td><td>${etat}</td></tr>`;
    }).join('');
    const canal = d.canal ? chip('green', 'Branchées') : chip('amber', 'Pas branchées');
    return `<table class="tour-table tour-table--simple"><thead><tr><th>Garde</th><th>Dernier passage réussi</th><th>État</th></tr></thead><tbody>${lignes}
      <tr data-tour-tache="canal"><td><b>Les alertes Telegram de l’application</b><br><span class="pv2-quiet">une réservation ratée, un mail perdu, une garde arrêtée</span></td><td></td><td>${canal}</td></tr></tbody></table>`;
  }
  function htmlAcces(d) {
    const acces = d.acces || [];
    if (!acces.length) return '<p class="pv2-quiet tour-vide">Aucune connexion propriétaire enregistrée.</p>';
    return `<p class="pv2-quiet tour-vide">Seul le rôle propriétaire ouvre cette page. Voici ses dernières connexions.</p><ul class="tour-liste">${acces.map((a) => `<li data-tour-acces><b>${esc(a.nom)}</b>, ${esc(nomDuCentre(a.centre))}, ${esc(ilYA(a.vuLe))}.</li>`).join('')}</ul>`;
  }

  // ---- Le squelette ---------------------------------------------------------
  const option = (valeur, mot, actuelle) => `<option value="${esc(valeur)}"${valeur === actuelle ? ' selected' : ''}>${esc(mot)}</option>`;
  function htmlFiltres() {
    const f = tour.filtres;
    return `<div class="tour-filtres" role="group" aria-label="Filtrer les réservations">
      <label>Lesquelles <select data-tour-filtre="quand">${option('aujourdhui', 'Reçues aujourd’hui', f.quand)}${option('7j', 'Reçues sur 7 jours', f.quand)}${option('30j', 'Reçues sur 30 jours', f.quand)}${option('avenir', 'Toutes les visites à venir', f.quand)}${option('tout', 'Toutes', f.quand)}</select></label>
      <label>Visite le <input type="date" data-tour-filtre="visite" value="${esc(f.visite)}"></label>
      <label>Centre <select data-tour-filtre="centre">${option('', 'Tous', f.centre)}${option('libramont', 'Libramont', f.centre)}${option('gembloux', 'Gembloux', f.centre)}</select></label>
      <label>Par <select data-tour-filtre="canal">${option('', 'Tous', f.canal)}${option('public', 'En ligne', f.canal)}${option('staff', 'Comptoir', f.canal)}</select></label>
      <label>État <select data-tour-filtre="statut">${option('', 'Tous', f.statut)}${option('pending', 'À venir', f.statut)}${option('arrived', 'Arrivées', f.statut)}${option('paid', 'Payées', f.statut)}${option('cancelled', 'Annulées', f.statut)}</select></label>
      <label class="tour-cherche">Chercher <input type="search" data-tour-cherche placeholder="Nom, téléphone, e-mail, n° de réservation" value="${esc(tour.cherche)}" autocomplete="off"></label>
    </div>`;
  }
  function html() {
    return `<div id="tourRacine" class="tour">
      <div id="tourEtat" aria-live="polite"><p class="pv2-quiet tour-vide">Lecture en cours…</p></div>
      <div id="tourCentres" class="tour-centres"></div>
      <section class="tour-partie"><h2>Toutes les réservations</h2>${htmlFiltres()}<div id="tourListe"></div></section>
      <section class="tour-partie"><h2>Les essais qui n’ont pas abouti, sur 24 h</h2><div id="tourEssais"></div></section>
      <section class="tour-partie"><h2>Ce qui a planté, sur 24 h</h2><div id="tourErreurs"></div></section>
      <section class="tour-partie"><h2>Les gardes</h2><div id="tourGardes"></div></section>
      <section class="tour-partie"><h2>Qui a accès</h2><div id="tourAcces"></div></section>
    </div>`;
  }

  function peindre() {
    const r = tour.racine;
    if (!r) return;
    const zone = (id) => r.querySelector(`#${id}`);
    if (!zone('tourEtat')) return;
    if (tour.erreur && !tour.donnees) {
      zone('tourEtat').innerHTML = `<div class="tour-etat is-urgent" data-tour-etat="panne"><strong>${esc(tour.erreur)}</strong><span>La page réessaie toute seule.</span></div>`;
      return;
    }
    const d = tour.donnees;
    if (!d) return;
    zone('tourEtat').innerHTML = (tour.erreur ? `<div class="tour-etat is-attention" data-tour-etat="vieux"><strong>La dernière mise à jour a échoué.</strong><span>${esc(tour.erreur)} Ce qui suit date de ${esc(heure(d.generatedAt))}.</span></div>` : '') + htmlEtat(d);
    zone('tourCentres').innerHTML = htmlCentres(d);
    zone('tourListe').innerHTML = htmlListe(d);
    zone('tourEssais').innerHTML = htmlEssais(d);
    zone('tourErreurs').innerHTML = htmlErreurs(d);
    zone('tourGardes').innerHTML = htmlGardes(d);
    zone('tourAcces').innerHTML = htmlAcces(d);
  }

  function arreter() {
    if (tour.minuteur) clearInterval(tour.minuteur);
    tour.minuteur = null;
  }

  // Une reponse lente d un ancien filtre ne remplace jamais la liste du filtre actuel.
  let numeroLecture = 0;
  // (la premiere lecture vient du montage : la console ne note la page ouverte qu apres ce premier rendu)
  async function charger(auMontage) {
    if (auMontage !== true && typeof state !== 'undefined' && state.staffMenuPage !== CLE_PAGE) { arreter(); return; }
    if (document.hidden) return;
    const numero = ++numeroLecture;
    tour.enCours = true;
    const f = tour.filtres;
    const p = new URLSearchParams({ action: 'founderTour' });
    if (f.quand) p.set('quand', f.quand);
    ['centre', 'canal', 'statut', 'visite'].forEach((cle) => { if (f[cle]) p.set(cle, f[cle]); });
    try {
      const reponse = await apiRequest(`/api/ops?${p.toString()}`);
      if (numero !== numeroLecture) return;
      tour.donnees = reponse;
      tour.erreur = '';
    } catch (error) {
      if (numero !== numeroLecture) return;
      tour.erreur = (error && error.userMessage) || (error && error.message) || 'La Tour de contrôle ne répond pas.';
    }
    tour.enCours = false;
    peindre();
  }

  async function ouvrirDossier(id) {
    tour.ouvert = tour.ouvert === id ? null : id;
    peindre();
    if (tour.ouvert === null) return;
    try {
      tour.dossiers[id] = await apiRequest(`/api/ops?action=founderTourDossier&id=${encodeURIComponent(id)}`);
    } catch (error) {
      tour.dossiers[id] = { erreur: (error && error.userMessage) || 'Ce dossier ne s’est pas chargé.' };
    }
    if (tour.ouvert === id) peindre();
  }

  // LE GESTE DE LA PANNE : l interrupteur que embed.js lit a chaque visite (setEmbedState, deja trace au journal). Le
  // formulaire Pinlane s efface du site du client en une minute, et son ancien formulaire revient, sans toucher au site.
  async function basculerCentre(id, actif) {
    const nom = nomDuCentre(id);
    const question = actif
      ? `Remettre la réservation en ligne de ${nom} ?`
      : `Couper la réservation en ligne de ${nom} ? En une minute, le formulaire Pinlane s’efface du site et l’ancien revient. Plus aucune réservation n’arrive ici jusqu’à ce que vous la remettiez.`;
    if (!window.confirm(question)) return;
    try {
      await apiRequest('/api/ops', { method: 'POST', body: JSON.stringify({ action: 'setEmbedState', centerId: id, actif }) });
    } catch (error) {
      tour.erreur = (error && error.userMessage) || 'Le changement n’a pas été enregistré.';
      peindre();
      return;
    }
    await charger();
  }

  function brancher(racine) {
    if (racine.dataset.tourBranche === '1') return;
    racine.dataset.tourBranche = '1';
    racine.addEventListener('click', (e) => {
      const couper = e.target.closest('[data-tour-couper]');
      if (couper) {
        basculerCentre(couper.getAttribute('data-tour-couper'), couper.getAttribute('data-actif') === '1');
        return;
      }
      const secoursCentre = e.target.closest('[data-tour-secours]');
      if (secoursCentre) {
        if (typeof ouvrirReglageSecours === 'function') ouvrirReglageSecours(secoursCentre.getAttribute('data-tour-secours'));
        return;
      }
      const centre = e.target.closest('[data-tour-filtrer]');
      if (centre) {
        const id = centre.getAttribute('data-tour-filtrer');
        tour.filtres.centre = tour.filtres.centre === id ? '' : id;
        const choix = racine.querySelector('[data-tour-filtre="centre"]');
        if (choix) choix.value = tour.filtres.centre;
        charger();
        return;
      }
      if (e.target.closest('a, summary, details, pre')) return;
      const ligne = e.target.closest('[data-tour-ligne]');
      if (ligne) ouvrirDossier(Number(ligne.getAttribute('data-tour-ligne')));
    });
    racine.addEventListener('change', (e) => {
      const cle = e.target.getAttribute && e.target.getAttribute('data-tour-filtre');
      if (!cle) return;
      tour.filtres[cle] = e.target.value;
      tour.ouvert = null;
      charger();
    });
    racine.addEventListener('input', (e) => {
      if (!e.target.matches || !e.target.matches('[data-tour-cherche]')) return;
      tour.cherche = e.target.value;
      if (tour.donnees) racine.querySelector('#tourListe').innerHTML = htmlListe(tour.donnees);
    });
  }

  function monter(racine) {
    tour.racine = racine;
    brancher(racine);
    peindre();
    if (!tour.surRetour) {
      tour.surRetour = true;
      document.addEventListener('visibilitychange', () => { if (!document.hidden && tour.minuteur) charger(); });
    }
    if (!tour.minuteur) {
      charger(true);
      tour.minuteur = setInterval(charger, CADENCE_MS);
    }
  }

  window.PinlaneTour = { html, monter, charger, quitter: arreter };
})();

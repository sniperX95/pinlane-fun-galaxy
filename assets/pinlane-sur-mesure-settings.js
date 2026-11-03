/* ============================================================================
   LE CATALOGUE SUR MESURE DU CENTRE (2026-11-03), Activites & tarifs.
   Movsar : « tout doit etre customissable ... rajouter des choses comme
   nourriture bouffe etc ». Le gerant gere lui-meme ses categories et ses
   articles : ajouter, renommer, chiffrer, l unite (piece ou par joueur), l heure
   a demander, propose ou masque, l ordre.

   Meme construction que les suggestions d upsell (pinlane-upsell-settings.js) :
   une vue de lecture, un brouillon hors du DOM, un formulaire qui le modifie,
   une validation avant l envoi. Le formulaire vit dans une fenetre montee dans
   document.body, comme les editeurs de la page Tarifs (pev, cev, aev) : la page
   se redessine au releve, la saisie en cours ne se perd pas.

   Le serveur fait foi : lecture entiere avec le droit Tarifs (api/ops.js
   surMesureGestion), ecriture par saveSurMesure, relue et bornee
   (lib/center-config.js normalizeSurMesure). Ce module ne decide d aucun droit.
   ========================================================================== */
(function (global) {
  'use strict';

  const MAX_CATEGORIES = 30;
  const MAX_ARTICLES = 400;
  const MAX_NOM = 80;
  const PRIX_MAX = 100000;
  const APERCU = 8;
  const ID = /^[a-z0-9][a-z0-9_-]{0,59}$/;

  const esc = (value) => (typeof escapeHtml === 'function' ? escapeHtml(value ?? '') : String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  // Un prix a la belge : 3, 3,50 (jamais 3.5).
  const prixSaisi = (value) => {
    const n = Math.round((Number(value) || 0) * 100) / 100;
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  };
  const prixLu = (value) => `${prixSaisi(value)} €`;
  const centre = () => (typeof getCurrentStaffCenterId === 'function' ? getCurrentStaffCenterId() : '');
  const peutGerer = () => typeof canUseStaffPermission !== 'function' || canUseStaffPermission('pricing.manage');
  const copie = (value) => JSON.parse(JSON.stringify(value));

  // L etat lu : un centre a la fois. `parDefaut` : le centre n a rien enregistre.
  const lecture = { centre: '', etat: 'vide', catalogue: null, parDefaut: false, message: '', ticket: 0 };
  // La fenetre ouverte : le brouillon, ce qui est replie, l envoi en cours.
  let fenetre = null;
  let serie = 0;
  const cleNeuve = (prefixe) => `${prefixe}${Date.now().toString(36)}${(serie += 1)}`;

  // -------------------------------------------------------------------------
  // LA LECTURE
  // -------------------------------------------------------------------------
  function charger(force = false) {
    const id = centre();
    if (!id || id === 'all' || !peutGerer() || typeof apiRequest !== 'function') return;
    if (!force && lecture.centre === id && (lecture.etat === 'ok' || lecture.etat === 'charge')) return;
    // Une lecture en panne ne se relance pas a chaque rendu : « Réessayer » le fait.
    if (!force && lecture.centre === id && lecture.etat === 'erreur') return;
    const ticket = (lecture.ticket += 1);
    Object.assign(lecture, { centre: id, etat: 'charge', message: '' });
    const ops = (typeof API_ENDPOINTS !== 'undefined' && API_ENDPOINTS.ops) || '/api/ops';
    apiRequest(`${ops}?action=surMesureGestion&centerId=${encodeURIComponent(id)}`)
      .then((reponse) => {
        if (ticket !== lecture.ticket) return;
        const surMesure = reponse && reponse.surMesure;
        if (!surMesure || !Array.isArray(surMesure.categories) || !Array.isArray(surMesure.articles)) throw new Error('Le serveur n’a pas rendu de catalogue.');
        Object.assign(lecture, { etat: 'ok', catalogue: surMesure, parDefaut: reponse.parDefaut === true });
      })
      .catch((error) => {
        if (ticket !== lecture.ticket) return;
        Object.assign(lecture, { etat: 'erreur', message: (error && error.message) || 'Lecture impossible.' });
      })
      .finally(() => {
        if (ticket === lecture.ticket) repeindrePage();
      });
  }

  function repeindrePage() {
    if (typeof isStaffPricingActive === 'function' && !isStaffPricingActive()) return;
    if (typeof global.renderStaffPricingPage === 'function') global.renderStaffPricingPage();
  }

  // Le nombre d articles du centre affiche, pour l onglet ; rien tant qu il n est
  // pas lu (un zero serait faux).
  function compte() {
    return lecture.etat === 'ok' && lecture.centre === centre() && lecture.catalogue ? lecture.catalogue.articles.length : undefined;
  }

  // -------------------------------------------------------------------------
  // LA VUE DE LECTURE (l onglet « Sur mesure » de Tarifs & formules)
  // -------------------------------------------------------------------------
  function detailsArticle(article) {
    return [article.unite === 'joueur' ? 'par joueur' : 'à la pièce', article.heure ? 'heure demandée' : ''].filter(Boolean).join(' · ');
  }

  function vueCategorie(categorie, articles) {
    const masquee = categorie.actif === false;
    const apercu = articles.slice(0, APERCU);
    const reste = articles.length - apercu.length;
    // (jamais de balise <header> : en console, body.staff-mode header l ecrase)
    return `<article class="sm-cat${masquee ? ' is-masquee' : ''}" data-sm-vue="${esc(categorie.id)}">
      <div class="sm-cat-tete">
        <strong>${esc(categorie.nom)}</strong>
        <span class="sm-compte">${articles.length} article${articles.length > 1 ? 's' : ''}</span>
        ${masquee ? '<span class="pv2-chip">Masquée</span>' : ''}
      </div>
      ${articles.length ? `<ul class="sm-lignes">${apercu.map((article) => `<li class="sm-ligne${article.actif === false ? ' is-masque' : ''}">
        <span class="sm-nom">${esc(article.nom)}${article.actif === false ? ' <span class="pv2-chip">Masqué</span>' : ''}</span>
        <span class="sm-detail">${esc(detailsArticle(article))}</span>
        <span class="sm-prix">${article.prix > 0 ? esc(prixLu(article.prix)) : 'au comptoir'}</span>
      </li>`).join('')}</ul>${reste > 0 ? `<p class="sm-reste">et ${reste} autre${reste > 1 ? 's' : ''} article${reste > 1 ? 's' : ''}</p>` : ''}` : '<p class="sm-reste">Aucun article.</p>'}
    </article>`;
  }

  function renderSection() {
    const id = centre();
    const tete = (compteur, bouton) => `<div class="pv2-section-head">
        <h3>Sur mesure</h3>${compteur ? `<span>${compteur}</span>` : ''}${bouton}
        <span class="pv2-section-legend">Ce que l’équipe ajoute à un dossier : nourriture, boissons, gâteaux, décoration. Reserver propose ces articles et le serveur reprend leur prix ; un article à 0 € se chiffre au comptoir.</span>
      </div>`;
    if (!peutGerer()) {
      return `<section class="pv2-catalog-section sm-section">${tete('', '')}<p class="sm-note">Le catalogue sur mesure se gère avec le droit Tarifs.</p></section>`;
    }
    if (!id || id === 'all') {
      return `<section class="pv2-catalog-section sm-section">${tete('', '')}<p class="sm-note">Choisissez un centre pour gérer son catalogue sur mesure.</p></section>`;
    }
    charger();
    if (lecture.centre !== id || lecture.etat === 'charge' || lecture.etat === 'vide') {
      return `<section class="pv2-catalog-section sm-section">${tete('', '')}<p class="sm-note" role="status">Chargement du catalogue…</p></section>`;
    }
    if (lecture.etat === 'erreur') {
      return `<section class="pv2-catalog-section sm-section">${tete('', '')}<div class="sm-panne" role="alert"><p>Catalogue indisponible : ${esc(lecture.message)}</p><button type="button" class="pv2-btn" data-sm-action="relire">Réessayer</button></div></section>`;
    }
    const { categories, articles } = lecture.catalogue;
    const masques = articles.filter((article) => article.actif === false).length;
    const compteur = `${articles.length} article${articles.length > 1 ? 's' : ''} · ${categories.length} catégorie${categories.length > 1 ? 's' : ''}${masques ? ` · ${masques} masqué${masques > 1 ? 's' : ''}` : ''}`;
    return `<section class="pv2-catalog-section sm-section" id="smSection">
      ${tete(compteur, '<button type="button" class="pv2-btn sm-ouvrir" data-sm-action="ouvrir" data-sm-focus="ouvrir">Modifier le catalogue</button>')}
      ${lecture.parDefaut ? '<p class="sm-note">Catalogue de départ proposé par Pinlane, prix à saisir au comptoir. Ajustez-le puis enregistrez : il devient celui de votre centre.</p>' : ''}
      <div class="sm-cats">${categories.map((categorie) => vueCategorie(categorie, articles.filter((article) => article.categorie === categorie.id))).join('')}</div>
    </section>`;
  }

  // -------------------------------------------------------------------------
  // LE BROUILLON
  // -------------------------------------------------------------------------
  // `cle` : la cle du brouillon, stable pendant la saisie ; `id` : celui du
  // serveur, vide pour ce qui n est pas encore enregistre. Un article designe sa
  // categorie par la cle du brouillon : une categorie neuve n a pas encore d id.
  function brouillonDe(catalogue) {
    const cles = new Map();
    const categories = catalogue.categories.map((categorie) => {
      const cle = cleNeuve('c');
      cles.set(categorie.id, cle);
      return { cle, id: categorie.id, nom: categorie.nom, actif: categorie.actif !== false, neuf: false };
    });
    const articles = catalogue.articles.filter((article) => cles.has(article.categorie)).map((article) => ({
      cle: cleNeuve('a'),
      id: article.id,
      nom: article.nom,
      categorie: cles.get(article.categorie),
      prix: prixSaisi(article.prix),
      unite: article.unite === 'joueur' ? 'joueur' : 'piece',
      heure: article.heure === true,
      actif: article.actif !== false,
      neuf: false,
    }));
    return { categories, articles };
  }

  function idDepuisNom(nom, pris, repli) {
    const base = String(nom || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    const racine = base && /^[a-z0-9]/.test(base) ? base : repli;
    let id = racine;
    let n = 2;
    while (pris.has(id)) { id = `${racine.slice(0, 50)}-${n}`; n += 1; }
    pris.add(id);
    return id;
  }

  // Le brouillon valide, dans la forme du serveur. Leve une erreur qui nomme le
  // champ fautif (`focus`) : la fenetre le montre et y met le curseur.
  function collecter(brouillon) {
    const faute = (message, focus) => Object.assign(new Error(message), { focus });
    if (brouillon.categories.length > MAX_CATEGORIES) throw faute(`${MAX_CATEGORIES} catégories au plus.`);
    if (brouillon.articles.length > MAX_ARTICLES) throw faute(`${MAX_ARTICLES} articles au plus.`);
    const pris = new Set(brouillon.categories.filter((c) => !c.neuf).map((c) => c.id));
    const idsCategories = new Map();
    const categories = brouillon.categories.map((categorie) => {
      const nom = String(categorie.nom || '').replace(/\s+/g, ' ').trim();
      if (!nom) throw faute('Donnez un nom à chaque catégorie.', `cat:${categorie.cle}:nom`);
      if (nom.length > MAX_NOM) throw faute(`Catégorie « ${nom.slice(0, 30)}… » : ${MAX_NOM} caractères au plus.`, `cat:${categorie.cle}:nom`);
      const id = categorie.neuf ? idDepuisNom(nom, pris, 'categorie') : categorie.id;
      idsCategories.set(categorie.cle, id);
      return categorie.actif ? { id, nom } : { id, nom, actif: false };
    });
    const prisArticles = new Set(brouillon.articles.filter((a) => !a.neuf).map((a) => a.id));
    const articles = brouillon.articles.map((article) => {
      const nom = String(article.nom || '').replace(/\s+/g, ' ').trim();
      const ici = `art:${article.cle}`;
      if (!nom) throw faute('Donnez un nom à chaque article.', `${ici}:nom`);
      if (nom.length > MAX_NOM) throw faute(`Article « ${nom.slice(0, 30)}… » : ${MAX_NOM} caractères au plus.`, `${ici}:nom`);
      const brut = String(article.prix ?? '').replace(',', '.').trim();
      const prix = brut === '' ? NaN : Number(brut);
      if (!Number.isFinite(prix) || prix < 0 || prix > PRIX_MAX) throw faute(`« ${nom} » : un prix de 0 à 100 000 €. Mettez 0 pour un prix saisi au comptoir.`, `${ici}:prix`);
      const id = article.neuf ? idDepuisNom(nom, prisArticles, 'article') : article.id;
      if (!ID.test(id)) throw faute(`« ${nom} » : identifiant illisible, retirez la ligne et recréez-la.`, `${ici}:nom`);
      return { id, nom, categorie: idsCategories.get(article.categorie), prix: Math.round(prix * 100) / 100, unite: article.unite === 'joueur' ? 'joueur' : 'piece', heure: article.heure === true, actif: article.actif !== false };
    });
    return { categories, articles };
  }

  // -------------------------------------------------------------------------
  // LA FENETRE
  // -------------------------------------------------------------------------
  function ouvrir() {
    if (!lecture.catalogue || lecture.centre !== centre()) return;
    const brouillon = brouillonDe(lecture.catalogue);
    fenetre = {
      centre: lecture.centre,
      brouillon,
      initial: JSON.stringify(collecterSansFaute(brouillon)),
      ouvertes: new Set(brouillon.categories.slice(0, 1).map((c) => c.cle)),
      envoi: false,
      erreur: '',
      quitter: false,
      retour: document.activeElement,
    };
    monter();
    const premier = document.querySelector('#smOverlay [data-sm-focus]');
    if (premier) premier.focus();
  }

  function collecterSansFaute(brouillon) {
    try { return collecter(brouillon); } catch (error) { return brouillon; }
  }

  function modifie() {
    return Boolean(fenetre) && JSON.stringify(collecterSansFaute(fenetre.brouillon)) !== fenetre.initial;
  }

  function fermer({ forcer = false } = {}) {
    if (!fenetre) return;
    if (!forcer && modifie() && !fenetre.quitter) {
      fenetre.quitter = true;
      peindrePied();
      const bouton = document.querySelector('#smOverlay [data-sm-action="fermer"].pv2-btn');
      if (bouton) bouton.focus();
      return;
    }
    const retour = fenetre.retour;
    fenetre = null;
    const overlay = document.getElementById('smOverlay');
    if (overlay) overlay.remove();
    const ouvrirBouton = document.querySelector('[data-sm-action="ouvrir"]');
    const cible = retour && document.contains(retour) ? retour : ouvrirBouton;
    if (cible) { try { cible.focus(); } catch (error) { /* bouton disparu */ } }
  }

  const fleche = (sens) => (sens < 0 ? '↑' : '↓');

  function ligneArticle(article, rang, total) {
    const ici = `art:${article.cle}`;
    const nom = article.nom || 'cet article';
    return `<tr class="sm-ed-art${article.actif ? '' : ' is-masque'}" data-sm-art="${esc(article.cle)}">
      <td class="sm-ed-nom"><input type="text" class="sm-input" maxlength="${MAX_NOM}" value="${esc(article.nom)}" data-sm-cle="nom" data-sm-focus="${ici}:nom" aria-label="Nom de l’article" placeholder="Nom de l’article"></td>
      <td class="sm-ed-prix"><span class="sm-euro"><input type="text" inputmode="decimal" class="sm-input" value="${esc(article.prix)}" data-sm-cle="prix" data-sm-focus="${ici}:prix" aria-label="Prix de ${esc(nom)} en euros" placeholder="0"><span aria-hidden="true">€</span></span></td>
      <td class="sm-ed-unite"><select class="sm-input" data-sm-cle="unite" data-sm-focus="${ici}:unite" aria-label="Unité de ${esc(nom)}">
        <option value="piece"${article.unite === 'piece' ? ' selected' : ''}>À la pièce</option>
        <option value="joueur"${article.unite === 'joueur' ? ' selected' : ''}>Par joueur</option>
      </select></td>
      <td class="sm-ed-case"><label class="sm-case"><input type="checkbox" data-sm-cle="heure" data-sm-focus="${ici}:heure"${article.heure ? ' checked' : ''}><span class="sm-case-mot" aria-hidden="true">Heure</span><span class="visually-hidden">Demander l’heure de service de ${esc(nom)}</span></label></td>
      <td class="sm-ed-case"><label class="sm-case"><input type="checkbox" data-sm-cle="actif" data-sm-focus="${ici}:actif"${article.actif ? ' checked' : ''}><span class="sm-case-mot" aria-hidden="true">Proposé</span><span class="visually-hidden">Proposer ${esc(nom)} à l’équipe</span></label></td>
      <td class="sm-ed-ordre">
        <button type="button" class="sm-mini" data-sm-action="art-monter" data-sm-focus="${ici}:monter" aria-label="Monter ${esc(nom)}"${rang === 0 ? ' disabled' : ''}>${fleche(-1)}</button>
        <button type="button" class="sm-mini" data-sm-action="art-descendre" data-sm-focus="${ici}:descendre" aria-label="Descendre ${esc(nom)}"${rang === total - 1 ? ' disabled' : ''}>${fleche(1)}</button>
        ${article.neuf ? `<button type="button" class="sm-mini sm-retirer" data-sm-action="art-retirer" data-sm-focus="${ici}:retirer" aria-label="Retirer ${esc(nom)}">Retirer</button>` : ''}
      </td>
    </tr>`;
  }

  function blocCategorie(categorie, rang, total) {
    const { brouillon, ouvertes } = fenetre;
    const articles = brouillon.articles.filter((article) => article.categorie === categorie.cle);
    const ouverte = ouvertes.has(categorie.cle);
    const ici = `cat:${categorie.cle}`;
    const nom = categorie.nom || 'cette catégorie';
    return `<section class="sm-ed-cat${categorie.actif ? '' : ' is-masquee'}" data-sm-cat="${esc(categorie.cle)}">
      <div class="sm-ed-cat-tete">
        <input type="text" class="sm-input sm-ed-cat-nom" maxlength="${MAX_NOM}" value="${esc(categorie.nom)}" data-sm-cle="nom" data-sm-focus="${ici}:nom" aria-label="Nom de la catégorie" placeholder="Nom de la catégorie">
        <label class="sm-bascule"><input type="checkbox" data-sm-cle="actif" data-sm-focus="${ici}:actif"${categorie.actif ? ' checked' : ''}><span>Proposée</span></label>
        <span class="sm-ordre">
          <button type="button" class="sm-mini" data-sm-action="cat-monter" data-sm-focus="${ici}:monter" aria-label="Monter ${esc(nom)}"${rang === 0 ? ' disabled' : ''}>${fleche(-1)}</button>
          <button type="button" class="sm-mini" data-sm-action="cat-descendre" data-sm-focus="${ici}:descendre" aria-label="Descendre ${esc(nom)}"${rang === total - 1 ? ' disabled' : ''}>${fleche(1)}</button>
          ${categorie.neuf && !articles.length ? `<button type="button" class="sm-mini sm-retirer" data-sm-action="cat-retirer" data-sm-focus="${ici}:retirer" aria-label="Retirer ${esc(nom)}">Retirer</button>` : ''}
        </span>
        <button type="button" class="sm-plier" data-sm-action="plier" data-sm-focus="${ici}:plier" aria-expanded="${ouverte}">${articles.length} article${articles.length > 1 ? 's' : ''}<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
      </div>
      ${categorie.actif ? '' : '<p class="sm-note">Masquée : ses articles ne sont plus proposés, les dossiers qui en ont gardent leurs lignes.</p>'}
      ${ouverte ? `${articles.length ? `<table class="sm-table">
        <thead><tr><th scope="col">Article</th><th scope="col">Prix</th><th scope="col">Unité</th><th scope="col">Heure</th><th scope="col">Proposé</th><th scope="col"><span class="visually-hidden">Ordre</span></th></tr></thead>
        <tbody>${articles.map((article, i) => ligneArticle(article, i, articles.length)).join('')}</tbody>
      </table>` : '<p class="sm-note">Aucun article dans cette catégorie.</p>'}
      <button type="button" class="pv2-btn sm-ajouter" data-sm-action="art-ajouter" data-sm-focus="${ici}:ajouter"${brouillon.articles.length >= MAX_ARTICLES ? ' disabled' : ''}>+ Ajouter un article</button>` : ''}
    </section>`;
  }

  function corpsHtml() {
    const { brouillon } = fenetre;
    return `<p class="sm-legende">Prix : à l’unité, 0 € pour un prix saisi au comptoir. Heure : l’équipe note quand servir l’article. Proposé : visible dans Réserver et dans la fiche.</p>
      ${brouillon.categories.map((categorie, i) => blocCategorie(categorie, i, brouillon.categories.length)).join('')}
      <button type="button" class="pv2-btn sm-ajouter" data-sm-action="cat-ajouter" data-sm-focus="cat-ajouter"${brouillon.categories.length >= MAX_CATEGORIES ? ' disabled' : ''}>+ Ajouter une catégorie</button>`;
  }

  function piedHtml() {
    const { envoi, erreur, quitter } = fenetre;
    return `${erreur ? `<p class="sm-erreur" role="alert">${esc(erreur)}</p>` : `<p class="sm-pied-note">${modifie() ? 'Modifications non enregistrées.' : 'Aucune modification.'}</p>`}
      <button type="button" class="pv2-btn" data-sm-action="fermer" data-sm-focus="fermer"${envoi ? ' disabled' : ''}>${quitter ? 'Quitter sans enregistrer' : 'Annuler'}</button>
      <button type="button" class="pv2-btn primary" data-sm-action="enregistrer" data-sm-focus="enregistrer"${envoi ? ' disabled aria-busy="true"' : ''}>${envoi ? 'Enregistrement…' : 'Enregistrer'}</button>`;
  }

  // La fenetre se monte dans document.body, hors de la page : le releve qui
  // redessine Tarifs & formules ne la touche pas.
  function monter() {
    const existante = document.getElementById('smOverlay');
    if (!fenetre) { if (existante) existante.remove(); return; }
    if (existante) return;
    const overlay = document.createElement('div');
    overlay.id = 'smOverlay';
    overlay.className = 'overlay-backdrop pev-overlay';
    fenetre.pied = piedHtml();
    overlay.innerHTML = `<div class="modal-surface pev-modal sm-modal" role="dialog" aria-modal="true" aria-labelledby="smTitre">
      <div class="pev-modal-head">
        <div><h3 id="smTitre">Catalogue sur mesure</h3><p>Ce que l’équipe peut ajouter à un dossier de ce centre.</p></div>
        <button type="button" class="pev-close" data-sm-action="fermer" aria-label="Fermer">&times;</button>
      </div>
      <div class="pev-modal-body sm-corps">${corpsHtml()}</div>
      <div class="pev-modal-foot sm-pied">${fenetre.pied}</div>
    </div>`;
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) fermer(); });
    document.body.appendChild(overlay);
  }

  // Redessine le corps en gardant le defilement et l element qui avait le focus.
  function peindreCorps(focus) {
    const corps = document.querySelector('#smOverlay .sm-corps');
    if (!corps || !fenetre) return;
    const actif = document.activeElement;
    const cle = focus || (actif && corps.contains(actif) ? actif.getAttribute('data-sm-focus') : '');
    const haut = corps.scrollTop;
    corps.innerHTML = corpsHtml();
    corps.scrollTop = haut;
    peindrePied();
    if (cle) {
      const cible = Array.from(corps.querySelectorAll('[data-sm-focus]')).find((n) => n.getAttribute('data-sm-focus') === cle && !n.disabled);
      if (cible) cible.focus({ preventScroll: false });
    }
  }

  // Le meme pied ne se redessine pas. Taper un prix puis cliquer « Enregistrer »
  // fait partir un « change » du champ a l appui : un pied redessine a ce
  // moment remplace le bouton entre l appui et la relache, et le clic se perd.
  function peindrePied() {
    const pied = document.querySelector('#smOverlay .sm-pied');
    if (!pied || !fenetre) return;
    const html = piedHtml();
    if (html === fenetre.pied) return;
    fenetre.pied = html;
    pied.innerHTML = html;
  }

  function deplacer(liste, element, sens, memeGroupe = () => true) {
    const indices = liste.map((x, i) => [x, i]).filter(([x]) => memeGroupe(x)).map(([, i]) => i);
    const position = indices.indexOf(liste.indexOf(element));
    const voisin = indices[position + sens];
    if (position < 0 || voisin === undefined) return false;
    const ici = indices[position];
    [liste[ici], liste[voisin]] = [liste[voisin], liste[ici]];
    return true;
  }

  async function enregistrer() {
    if (!fenetre || fenetre.envoi) return;
    let surMesure;
    try {
      surMesure = collecter(fenetre.brouillon);
    } catch (error) {
      fenetre.erreur = error.message;
      peindreCorps(error.focus);
      if (error.focus) {
        const cible = Array.from(document.querySelectorAll('#smOverlay [data-sm-focus]')).find((n) => n.getAttribute('data-sm-focus') === error.focus);
        if (cible) { cible.setAttribute('aria-invalid', 'true'); cible.focus(); }
      }
      return;
    }
    fenetre.envoi = true;
    fenetre.erreur = '';
    peindrePied();
    const ici = fenetre;
    try {
      const ops = (typeof API_ENDPOINTS !== 'undefined' && API_ENDPOINTS.ops) || '/api/ops';
      const reponse = await apiRequest(ops, { method: 'POST', body: JSON.stringify({ action: 'saveSurMesure', centerId: ici.centre, surMesure }) });
      if (!reponse || !reponse.surMesure) throw new Error('Le serveur n’a pas confirmé l’enregistrement.');
      if (lecture.centre === ici.centre) Object.assign(lecture, { etat: 'ok', catalogue: reponse.surMesure, parDefaut: false, message: '' });
      // Reserver et la fiche relisent le catalogue du centre.
      if (typeof oublierCatalogueSurMesure === 'function') oublierCatalogueSurMesure();
      // La page d abord, la fenetre ensuite : le focus revient au bouton
      // « Modifier le catalogue » de la page redessinee, pas a un bouton parti.
      repeindrePage();
      if (fenetre === ici) fermer({ forcer: true });
      if (typeof toast === 'function') toast('Catalogue sur mesure enregistré.');
    } catch (error) {
      if (fenetre !== ici) return;
      fenetre.envoi = false;
      fenetre.erreur = (error && error.message) || 'Enregistrement impossible. Réessayez.';
      peindrePied();
    }
  }

  // -------------------------------------------------------------------------
  // LES GESTES
  // -------------------------------------------------------------------------
  document.addEventListener('click', (event) => {
    const bouton = event.target.closest('[data-sm-action]');
    if (!bouton || bouton.disabled) return;
    const action = bouton.getAttribute('data-sm-action');
    if (action === 'ouvrir') { ouvrir(); return; }
    if (action === 'relire') { charger(true); repeindrePage(); return; }
    if (!fenetre || !bouton.closest('#smOverlay')) return;
    if (action === 'fermer') { fermer(); return; }
    if (action === 'enregistrer') { enregistrer(); return; }
    const { brouillon, ouvertes } = fenetre;
    const blocCat = bouton.closest('[data-sm-cat]');
    const categorie = blocCat ? brouillon.categories.find((c) => c.cle === blocCat.getAttribute('data-sm-cat')) : null;
    const ligne = bouton.closest('[data-sm-art]');
    const article = ligne ? brouillon.articles.find((a) => a.cle === ligne.getAttribute('data-sm-art')) : null;
    let focus = bouton.getAttribute('data-sm-focus');
    fenetre.quitter = false;
    fenetre.erreur = '';
    if (action === 'plier' && categorie) {
      if (ouvertes.has(categorie.cle)) ouvertes.delete(categorie.cle); else ouvertes.add(categorie.cle);
    } else if (action === 'cat-monter' && categorie) deplacer(brouillon.categories, categorie, -1);
    else if (action === 'cat-descendre' && categorie) deplacer(brouillon.categories, categorie, 1);
    else if (action === 'cat-retirer' && categorie && categorie.neuf) {
      brouillon.categories.splice(brouillon.categories.indexOf(categorie), 1);
      focus = 'cat-ajouter';
    } else if (action === 'cat-ajouter' && brouillon.categories.length < MAX_CATEGORIES) {
      const neuve = { cle: cleNeuve('c'), id: '', nom: '', actif: true, neuf: true };
      brouillon.categories.push(neuve);
      ouvertes.add(neuve.cle);
      focus = `cat:${neuve.cle}:nom`;
    } else if (action === 'art-ajouter' && categorie && brouillon.articles.length < MAX_ARTICLES) {
      const neuf = { cle: cleNeuve('a'), id: '', nom: '', categorie: categorie.cle, prix: '', unite: 'piece', heure: false, actif: true, neuf: true };
      const dernier = brouillon.articles.map((a) => a.categorie).lastIndexOf(categorie.cle);
      brouillon.articles.splice(dernier + 1, 0, neuf);
      focus = `art:${neuf.cle}:nom`;
    } else if (action === 'art-retirer' && article && article.neuf) {
      const groupe = article.categorie;
      brouillon.articles.splice(brouillon.articles.indexOf(article), 1);
      focus = `cat:${groupe}:ajouter`;
    } else if ((action === 'art-monter' || action === 'art-descendre') && article) {
      deplacer(brouillon.articles, article, action === 'art-monter' ? -1 : 1, (a) => a.categorie === article.categorie);
    } else return;
    peindreCorps(focus);
  });

  function saisir(event) {
    const champ = event.target;
    if (!fenetre || !champ.closest || !champ.closest('#smOverlay')) return;
    const cle = champ.getAttribute('data-sm-cle');
    if (!cle) return;
    const blocCat = champ.closest('[data-sm-cat]');
    const ligne = champ.closest('[data-sm-art]');
    const cible = ligne
      ? fenetre.brouillon.articles.find((a) => a.cle === ligne.getAttribute('data-sm-art'))
      : blocCat ? fenetre.brouillon.categories.find((c) => c.cle === blocCat.getAttribute('data-sm-cat')) : null;
    if (!cible) return;
    // Le « change » qui suit la saisie (au depart du champ : Echap, un clic sur
    // Enregistrer) n apporte rien de neuf : il ne desarme pas « Quitter sans
    // enregistrer » et ne redessine rien.
    const valeur = champ.type === 'checkbox' ? champ.checked : champ.value;
    if (cible[cle] === valeur) return;
    cible[cle] = valeur;
    champ.removeAttribute('aria-invalid');
    fenetre.quitter = false;
    if (fenetre.erreur) fenetre.erreur = '';
    // Masquer une categorie ou un article change ce qui se lit : on redessine.
    if (champ.type === 'checkbox' && cle === 'actif') peindreCorps(champ.getAttribute('data-sm-focus'));
    else peindrePied();
  }
  document.addEventListener('input', saisir);
  document.addEventListener('change', saisir);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !fenetre || fenetre.envoi) return;
    event.preventDefault();
    fermer();
  });

  global.PinlaneSurMesureSettings = { renderSection, compte, monter, charger, ouvrir, __test: { collecter, brouillonDe, idDepuisNom, lecture } };
})(window);

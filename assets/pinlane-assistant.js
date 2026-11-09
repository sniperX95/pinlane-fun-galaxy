/* L ASSISTANT DU CENTRE (2026-11-08, repris le 2026-11-09), la page Marketing. Ansar : « exactement
   meme interface que claude ou chatgpt [...] doit tout montrer pourquoi il pense ca [...] chaque
   role chaque personne a ses propre conversation [...] on peut se rendre et voir ou il cherche ».

   Les conversations sont a la personne connectee et vivent sur le serveur, sur tous ses appareils.
   Tant que la table n existe pas, elles restent sur l appareil, sans nom de client ecrit dessus,
   et remontent toutes seules le jour ou le serveur peut les garder. La recherche se peint par
   morceaux : les compteurs et les extraits viennent du flux, jamais d une animation qui simule.
   Le rendu n injecte jamais de HTML venu du modele, n affiche ni lien ni image, et le
   rafraichissement de la console ne touche pas la page deja montee. */
(function () {
  'use strict';

  const VERSION_STOCKAGE = 'pinlane-assistant:v1';
  const CONVERSATIONS_MAX = 30;
  const MESSAGES_MAX = 60;
  const LIGNES_GARDEES = 60;
  const QUESTION_MAX = 6000;
  const FAIT_MAX = 500;
  const MODELES = [
    { id: 'haiku', nom: 'Haiku 5.5', phrase: 'Rapide, pour les questions courantes.' },
    { id: 'sonnet', nom: 'Sonnet 5.5', phrase: 'Plus poussé, pour les décisions qui comptent.' },
  ];
  const SUGGESTIONS = [
    'Faut-il changer une formule ou en ajouter une ?',
    'Quelles heures restent vides et comment les remplir ?',
    'Quels bons clients ne reviennent plus ?',
    'Qui vient samedi et quels groupes ne sont pas encore payés ?',
    "D'où viennent mes réservations en ligne ?",
  ];
  const PAGES = {
    dashboard: { nom: 'Tableau de bord', cle: 'dashboard' },
    reservations: { nom: 'Réservations', cle: 'reservations' },
    planning: { nom: 'Planning', cle: 'planning' },
    clients: { nom: 'Clients', cle: 'clients' },
    emails: { nom: 'Emails', cle: 'emails' },
    formules: { nom: 'Formules', cle: 'formules' },
    demandes: { nom: 'Demandes', cle: 'requests' },
  };
  const FORMATS_GRAPHIQUE = { euro: 'euro', pct: 'percent', dec: 'dec1' };
  const ICONES = {
    plus: '<path d="M8 3v10M3 8h10"/>',
    corbeille: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5"/>',
    copier: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5A1 1 0 0 0 9.5 2.5h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
    refaire: '<path d="M13 8a5 5 0 1 1-1.5-3.5L13 6"/><path d="M13 2.5V6H9.5"/>',
    chevron: '<path d="M4.5 6.5 8 10l3.5-3.5"/>',
    fermer: '<path d="m4 4 8 8M12 4l-8 8"/>',
    fleche: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
    bas: '<path d="M8 3v10M3.5 8.5 8 13l4.5-4.5"/>',
    menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
    coche: '<path d="m3.5 8.5 3 3 6-7"/>',
    croix: '<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>',
    livre: '<path d="M3 3.5c2-1 4-1 5 0v9.5c-1-1-3-1-5 0zM13 3.5c-2-1-4-1-5 0v9.5c1-1 3-1 5 0z"/>',
    crayon: '<path d="m10.5 3 2.5 2.5L6 12.5l-3 .5.5-3z"/>',
  };
  const icone = (nom) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nom]}</svg>`;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const sansMouvement = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const A = {
    root: null, cle: '', conversations: [], actuelle: '', modele: 'haiku', flux: null, panneau: null,
    menuModele: false, aSupprimer: '', identites: Object.create(null), peintureDemandee: false, ouvreur: null,
    stockage: 'inconnu', carte: [], savoir: { charge: false, disponible: true, faits: [], edition: 0, aRetirer: 0, envoi: false, erreur: '' },
  };

  // ---- Ou l on est et ce qu on garde ---------------------------------------------
  function centreId() { return (typeof state !== 'undefined' && state.adminCenterId) || 'libramont'; }
  function membreId() { return (typeof getStaffSessionMemberId === 'function' && getStaffSessionMemberId()) || 'poste'; }
  function nomDuCentre() {
    const c = typeof getAdminCenter === 'function' ? getAdminCenter() : null;
    return (c && c.name) || 'votre centre';
  }
  function nomDUnCentre(id) {
    const c = (typeof getAdminCenters === 'function' ? getAdminCenters() : []).find((x) => x.id === id);
    return (c && c.name) || id;
  }
  const clePortee = () => `${VERSION_STOCKAGE}:${centreId()}:${membreId()}`;
  const courante = () => A.conversations.find((c) => c.id === A.actuelle) || null;

  function charger() {
    A.conversations = [];
    A.actuelle = '';
    A.panneau = null;
    A.identites = Object.create(null);
    A.stockage = 'inconnu';
    A.savoir = { charge: false, disponible: true, faits: [], edition: 0, aRetirer: 0, envoi: false, erreur: '' };
    try {
      const lu = JSON.parse(localStorage.getItem(A.cle) || 'null');
      if (lu && Array.isArray(lu.conversations)) A.conversations = lu.conversations.filter((c) => c && c.id && Array.isArray(c.messages));
      if (lu && MODELES.some((m) => m.id === lu.modele)) A.modele = lu.modele;
    } catch (erreur) { /* appareil sans stockage : la conversation vit le temps de la page */ }
    // Une reponse coupee par une fermeture de page n est plus en cours.
    A.conversations.forEach((c) => c.messages.forEach((m) => { if (m.statut === 'cours') m.statut = 'arrete'; }));
  }

  // Sur l appareil, seulement quand le serveur ne garde pas encore : les noms que l IA a vus
  // redeviennent des codes, les adresses et telephones disparaissent. La memoire du navigateur
  // d un poste partage ne porte aucune fiche de client.
  function masquer(valeur) {
    if (typeof valeur === 'string') {
      let t = valeur;
      for (const [code, nom] of Object.entries(A.identites)) if (nom && t.includes(nom)) t = t.split(nom).join(code);
      return t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[adresse retirée]').replace(/(?:\+|00)?\d[\d\s./-]{7,}\d/g, '[numéro retiré]');
    }
    if (Array.isArray(valeur)) return valeur.map(masquer);
    if (valeur && typeof valeur === 'object') return Object.fromEntries(Object.entries(valeur).map(([k, v]) => [k, masquer(v)]));
    return valeur;
  }

  const messagePourStockage = (m) => (m.role === 'user' ? { role: 'user', texte: m.texte } : { ...m, correction: undefined, sources: (m.sources || []).map((s) => ({ ...s, lignes: s.lignes.slice(0, LIGNES_GARDEES), coupe: s.coupe || s.lignes.length > LIGNES_GARDEES })) });

  function versStockage(attente) {
    const appareil = A.stockage !== 'serveur';
    return {
      modele: A.modele,
      conversations: (appareil ? A.conversations : attente || []).filter((c) => Array.isArray(c.messages) && c.messages.length).slice(0, CONVERSATIONS_MAX).map((c) => masquer({
        id: c.id,
        titre: c.titre,
        maj: c.maj,
        messages: c.messages.slice(-MESSAGES_MAX).map(messagePourStockage),
      })),
    };
  }
  function sauverSurAppareil(attente) {
    const donnees = versStockage(attente);
    for (let essai = 0; essai < 4; essai += 1) {
      try {
        localStorage.setItem(A.cle, JSON.stringify(donnees));
        return;
      } catch (erreur) {
        if (donnees.conversations.length <= 1) return;
        donnees.conversations.pop();
      }
    }
  }
  // La conversation part au serveur quand il peut la garder ; sinon, ou s il ne repond pas, elle
  // reste sur l appareil et remontera au prochain passage.
  function sauver(c) {
    if (A.stockage !== 'serveur' || !c) { sauverSurAppareil(); return; }
    sauverSurAppareil([]);
    appeler('sauver', { conversation: { id: c.id, titre: c.titre, modele: A.modele, messages: c.messages.slice(-MESSAGES_MAX).map(messagePourStockage), centerId: c.centerId } })
      .catch(() => sauverSurAppareil([c]));
  }

  async function appeler(action, corps = {}) {
    if (typeof isDemoRoute === 'function' && isDemoRoute()) return { demo: true };
    const r = await fetch('/api/assistant', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: staffAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ centerId: centreId(), action, ...corps }),
    });
    const donnees = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(donnees.message || "L'assistant est indisponible pour le moment."), { lisible: true, statut: r.status });
    return donnees;
  }

  function deserialiserServeur(liste) {
    return (liste || []).map((c) => ({ id: c.id, titre: c.titre, maj: c.maj, centerId: c.centerId, modele: c.modele, messages: null }));
  }

  // Ce qui est sur l appareil pour cette personne remonte une fois, tous centres confondus, et ne
  // part de l appareil qu une fois que le serveur montre qu il l a.
  function clesDeCetAppareil() {
    const trouvees = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const cle = localStorage.key(i);
        const m = new RegExp(`^${VERSION_STOCKAGE}:([^:]+):(.*)$`).exec(cle || '');
        if (m && m[2] === membreId()) trouvees.push({ cle, centre: m[1] });
      }
    } catch (erreur) { /* appareil sans stockage */ }
    return trouvees;
  }

  async function reprendreDepuisAppareil(surServeur) {
    const connus = new Set((surServeur || []).map((c) => c.id));
    const lues = clesDeCetAppareil().map(({ cle, centre }) => {
      try {
        const lu = JSON.parse(localStorage.getItem(cle) || 'null') || {};
        return { cle, centre, conversations: Array.isArray(lu.conversations) ? lu.conversations : [] };
      } catch (erreur) { return { cle, centre, conversations: [] }; }
    });
    const aReprendre = lues.flatMap((l) => l.conversations.filter((c) => c && c.id && Array.isArray(c.messages) && c.messages.length).map((c) => ({ ...c, centerId: l.centre })));
    const nouvelles = aReprendre.filter((c) => !connus.has(c.id));
    let reprises = [];
    if (nouvelles.length) {
      try {
        const reponse = await appeler('reprendre', { conversations: nouvelles });
        reprises = Array.isArray(reponse.reprises) ? reponse.reprises : [];
      } catch (erreur) {
        return false;
      }
    }
    const surLeServeur = new Set([...connus, ...reprises]);
    lues.forEach((l) => {
      if (!l.conversations.length) return;
      const restantes = l.conversations.filter((c) => !surLeServeur.has(c.id));
      try {
        const lu = JSON.parse(localStorage.getItem(l.cle) || '{}');
        localStorage.setItem(l.cle, JSON.stringify({ ...lu, conversations: restantes }));
      } catch (erreur) { /* appareil sans stockage */ }
    });
    return reprises.length > 0;
  }

  async function synchroniser() {
    let lu;
    try {
      lu = await appeler('conversations');
    } catch (erreur) {
      A.stockage = 'appareil';
      if (dom('.ast')) peindreListe();
      return;
    }
    if (!lu || lu.stockage !== 'serveur') {
      A.stockage = 'appareil';
      if (dom('.ast')) peindreListe();
      return;
    }
    A.stockage = 'serveur';
    const dejaIci = new Map(A.conversations.map((c) => [c.id, c]));
    const repris = await reprendreDepuisAppareil(lu.conversations);
    let liste = lu.conversations;
    // Ce qui vient de remonter n etait pas dans la premiere liste : on relit ce que le serveur a.
    if (repris) {
      try { liste = (await appeler('conversations')).conversations || liste; } catch (erreur) { /* on garde la premiere liste */ }
    }
    const fraiches = deserialiserServeur(liste).map((c) => {
      const ici = dejaIci.get(c.id);
      return ici && Array.isArray(ici.messages) && ici.messages.length ? { ...c, messages: ici.messages } : c;
    });
    A.conversations = fraiches;
    if (A.actuelle && !fraiches.some((c) => c.id === A.actuelle)) A.actuelle = '';
    if (!dom('.ast')) return;
    peindreListe();
    peindrePanneauSiSavoir();
    if (A.actuelle) peindreFil();
  }

  // ---- Les chiffres et le texte ----------------------------------------------------
  const nombre = (n, max = 2) => Number(n).toLocaleString('fr-BE', { maximumFractionDigits: max });
  function formater(valeur, type) {
    if (valeur === null || valeur === undefined || valeur === '') return '';
    if (type === 'client') return A.identites[valeur] || String(valeur);
    if (typeof valeur !== 'number') return String(valeur);
    if (type === 'euro') return `${Number.isInteger(valeur) ? nombre(valeur) : valeur.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    if (type === 'pct') return `${nombre(valeur, 1)} %`;
    if (type === 'dec') return nombre(valeur, 2);
    return nombre(valeur, 2);
  }

  function enLigne(brut, m) {
    let t = esc(brut);
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/\b[A-Z]\d{4}\b/g, (code) => (A.identites[code] ? esc(A.identites[code]) : code));
    t = t.replace(/[  ]?\[F(\d+)\]/g, (tout, n) => ((m.faitsCites || []).some((f) => String(f.id) === n) ? `<button type="button" class="ast-cite est-fait" data-ast-fait="${n}" title="${esc(((m.faitsCites || []).find((f) => String(f.id) === n) || {}).texte || '')}" aria-label="Fait appris par l'équipe">appris</button>` : ''));
    return t.replace(/[  ]?\[S(\d+)\]/g, (tout, n) => {
      const source = (m.sources || []).find((s) => s.id === `S${n}`);
      if (!source) return '';
      return `<button type="button" class="ast-cite" data-ast-source="S${n}" title="${esc(source.titre)}" aria-label="Source ${n}, ${esc(source.titre)}">${n}</button>`;
    });
  }

  const estDebutDeBloc = (l) => /^\s*(#{1,4}\s|[-*•]\s|\d+[.)]\s|\|)/.test(l) || /^\s*\[G\d+\]\s*$/.test(l);
  const celules = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  // Un rendu fait a la main sur ce que le modele ecrit vraiment. Tout passe par esc d abord.
  function markdown(brut, m) {
    const lignes = String(brut || '').replace(/\r/g, '').split('\n');
    let html = '';
    let i = 0;
    while (i < lignes.length) {
      const l = lignes[i];
      if (!l.trim()) { i += 1; continue; }
      const graphique = /^\s*\[(G\d+)\]\s*$/.exec(l);
      if (graphique) { html += `<figure class="ast-graph" data-ast-graph="${graphique[1]}"></figure>`; i += 1; continue; }
      const titre = /^\s*(#{1,4})\s+(.*)$/.exec(l);
      if (titre) { html += `<h3>${enLigne(titre[2], m)}</h3>`; i += 1; continue; }
      if (/\|/.test(l) && i + 1 < lignes.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lignes[i + 1]) && lignes[i + 1].includes('-')) {
        const tete = celules(l);
        i += 2;
        const corps = [];
        while (i < lignes.length && /\|/.test(lignes[i]) && lignes[i].trim()) { corps.push(celules(lignes[i])); i += 1; }
        html += `<div class="ast-table"><table><thead><tr>${tete.map((c) => `<th scope="col">${enLigne(c, m)}</th>`).join('')}</tr></thead><tbody>${corps.map((r) => `<tr>${tete.map((_, j) => `<td>${enLigne(r[j] || '', m)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        continue;
      }
      const puce = /^\s*[-*•]\s+/;
      const numero = /^\s*\d+[.)]\s+/;
      if (puce.test(l) || numero.test(l)) {
        const motif = puce.test(l) ? puce : numero;
        const balise = motif === puce ? 'ul' : 'ol';
        const items = [];
        while (i < lignes.length && motif.test(lignes[i])) { items.push(lignes[i].replace(motif, '')); i += 1; }
        html += `<${balise}>${items.map((x) => `<li>${enLigne(x, m)}</li>`).join('')}</${balise}>`;
        continue;
      }
      const paragraphe = [l];
      i += 1;
      while (i < lignes.length && lignes[i].trim() && !estDebutDeBloc(lignes[i])) { paragraphe.push(lignes[i]); i += 1; }
      html += `<p>${paragraphe.map((x) => enLigne(x, m)).join('<br>')}</p>`;
    }
    return html;
  }

  // ---- Peindre -----------------------------------------------------------------------
  const nomModele = (id) => {
    const t = String(id || '');
    if (/sonnet/i.test(t)) return 'Sonnet 5.5';
    if (/haiku/i.test(t)) return 'Haiku 5.5';
    return (MODELES.find((m) => m.id === t) || MODELES[0]).nom;
  };

  // LA RECHERCHE. Pendant qu elle cherche, on voit la carte des donnees et la ligne qui bouge.
  // Quand elle a fini, le bloc se replie en une phrase, et chaque etape reste ouvrable.
  const nombreEntier = (n) => Number(n || 0).toLocaleString('fr-BE');
  const mesureDe = (e) => {
    if (!e.lues) return '';
    return e.total && e.total > e.lues ? `${nombreEntier(e.lues)} sur ${nombreEntier(e.total)} lignes` : `${nombreEntier(e.lues)} ${e.lues > 1 ? 'lignes lues' : 'ligne lue'}`;
  };
  function bilanRecherche(m) {
    const lectures = (m.etapes || []).filter((e) => !e.note);
    const lues = lectures.reduce((s, e) => s + (Number(e.lues) || 0), 0);
    const duree = lectures.reduce((s, e) => s + (Number(e.duree) || 0), 0);
    const morceaux = [`${lectures.length} lecture${lectures.length > 1 ? 's' : ''} de vos données`];
    if (lues) morceaux.push(`${nombreEntier(lues)} lignes`);
    if (duree >= 1000) morceaux.push(`${Math.round(duree / 1000)} s`);
    return morceaux.join(', ');
  }

  function htmlExtraits(e, tous = false) {
    const lignes = (e.extraits || []).slice(tous ? -8 : -3).map((x) => `<p><time>${esc(x.t)}</time><span>${esc(x.d)}</span></p>`).join('');
    return `<div class="ast-et-extraits"><div class="ast-et-fil">${lignes}</div></div>`;
  }

  function htmlLigneEtape(e, enCours, ouverte, m) {
    if (e.note) return `<li class="ast-et is-note"><span class="ast-et-signe" aria-hidden="true"></span><p class="ast-et-ligne">${esc(e.libelle)}</p></li>`;
    const etat = e.etat || 'fini';
    const signe = etat === 'cours' ? '<span class="ast-et-pointe" aria-hidden="true"></span>' : (etat === 'echec' ? icone('croix') : icone('coche'));
    const source = e.source ? (m.sources || []).find((s) => s.id === e.source) : null;
    const lien = source && source.lien && PAGES[source.lien.page];
    const details = !enCours && ouverte
      ? `<div class="ast-et-detail">${htmlExtraits(e, true)}<div class="ast-et-actions">${source ? `<button type="button" class="ast-pill" data-ast-source="${esc(e.source)}">Voir les données</button>` : ''}${lien ? `<button type="button" class="ast-lien" data-ast-page="${esc(lien.cle)}">Ouvrir ${esc(lien.nom)}</button>` : ''}</div></div>`
      : '';
    return `<li class="ast-et is-${esc(etat)}${!enCours && (e.extraits || []).length ? ' est-ouvrable' : ''}" data-etape="${esc(e.id)}">
      <span class="ast-et-signe" aria-hidden="true">${signe}</span>
      <div class="ast-et-corps">
        <button type="button" class="ast-et-tete" ${enCours ? '' : `data-ast-etape-ouvrir="${esc(e.id)}"`} aria-expanded="${ouverte ? 'true' : 'false'}">
          <span class="ast-et-source">${esc(e.nomSource || 'Lecture')}</span>
          <span class="ast-et-phrase" data-et-phrase>${esc(e.phrase || e.libelle || '')}${etat === 'echec' ? ', échec' : ''}</span>
          <span class="ast-et-mesure" data-et-mesure>${esc(enCours ? mesureDe(e) : (e.trouve || mesureDe(e)))}</span>
        </button>
        ${enCours && etat === 'cours' ? `<div class="ast-et-barre"><i data-et-barre></i></div>${htmlExtraits(e)}` : ''}
        ${details}
      </div>
    </li>`;
  }

  function htmlRecherche(m) {
    const etapes = m.etapes || [];
    if (!etapes.length) return '';
    const enCours = m.statut === 'cours';
    const ouvert = enCours || m.etapesOuvertes;
    const carte = enCours && (m.carte || A.carte).length ? `<div class="ast-carte" data-ast-carte>${(m.carte || A.carte).map((c) => `<span class="ast-carte-mot" data-cle="${esc(c.cle)}"><span>${esc(c.nom)}</span><b data-carte-compte></b></span>`).join('')}<i class="ast-carte-repere" data-ast-repere aria-hidden="true"></i></div>` : '';
    return `<section class="ast-rech${enCours ? ' est-cours' : ''}${ouvert ? ' est-ouvert' : ''}" data-ast-recherche aria-busy="${enCours ? 'true' : 'false'}">
      <button type="button" class="ast-rech-tete" ${enCours ? '' : 'data-ast-etapes'} aria-expanded="${ouvert ? 'true' : 'false'}">
        <span class="ast-rech-titre">${enCours ? 'Je cherche dans vos données' : esc(bilanRecherche(m))}</span>
        ${enCours ? '' : icone('chevron')}
      </button>
      ${carte}
      <ol class="ast-rech-liste" ${ouvert ? '' : 'hidden'}>${etapes.map((e, i) => htmlLigneEtape(e, enCours, Boolean(e.id && (m.etapesDeroulees || {})[e.id]), m)).join('')}</ol>
    </section>`;
  }

  // Le bloc n est reconstruit qu au debut et a la fin : pendant la recherche, seuls les compteurs,
  // la barre et les extraits changent, pour que le mouvement se voie sans clignoter.
  function majRecherche(hote, m) {
    let bloc = hote.querySelector('[data-ast-recherche]');
    if (!bloc) {
      hote.innerHTML = htmlRecherche(m);
      bloc = hote.querySelector('[data-ast-recherche]');
      if (!bloc) return;
    }
    // Une phrase de l assistant s inscrit entre les lectures : la liste se redessine une fois.
    if (bloc.querySelectorAll('.is-note').length !== (m.etapes || []).filter((e) => e.note).length) {
      hote.innerHTML = htmlRecherche(m);
      bloc = hote.querySelector('[data-ast-recherche]');
    }
    const liste = bloc.querySelector('.ast-rech-liste');
    (m.etapes || []).forEach((e) => {
      if (e.note) return;
      let li = liste.querySelector(`[data-etape="${CSS.escape(e.id)}"]`);
      if (!li) {
        liste.insertAdjacentHTML('beforeend', htmlLigneEtape(e, true, false, m));
        li = liste.querySelector(`[data-etape="${CSS.escape(e.id)}"]`);
        if (li && !sansMouvement()) li.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' });
      }
      if (!li) return;
      li.className = `ast-et is-${e.etat || 'fini'}`;
      li.querySelector('[data-et-mesure]').textContent = e.etat === 'cours' ? mesureDe(e) : (e.trouve || mesureDe(e));
      const phrase = li.querySelector('[data-et-phrase]');
      const texte = e.phrase || e.libelle || '';
      if (phrase.textContent !== texte) phrase.textContent = texte;
      const barre = li.querySelector('[data-et-barre]');
      if (barre) {
        // Sans total connu, pas de barre : un pourcentage invente mentirait sur ce qui reste a lire.
        barre.parentElement.hidden = !e.total;
        if (e.total) barre.style.transform = `scaleX(${Math.min(1, e.lues / e.total)})`;
      }
      const fil = li.querySelector('.ast-et-fil');
      if (fil) {
        const deja = fil.children.length;
        const voulus = (e.extraits || []).slice(-3);
        if (voulus.length && (fil.dataset.dernier !== `${e.extraitsVus || 0}`)) {
          fil.dataset.dernier = `${e.extraitsVus || 0}`;
          fil.innerHTML = voulus.map((x) => `<p><time>${esc(x.t)}</time><span>${esc(x.d)}</span></p>`).join('');
          if (deja && !sansMouvement()) fil.animate([{ transform: 'translateY(1.6em)' }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' });
        }
      }
      // La source s allume sur la carte et y garde ses lignes.
      const mot = bloc.querySelector(`[data-cle="${CSS.escape(e.cleSource || '')}"]`);
      if (mot) {
        mot.classList.toggle('est-actif', e.etat === 'cours');
        mot.classList.toggle('est-lu', e.etat !== 'cours');
        const compte = mot.querySelector('[data-carte-compte]');
        const total = (m.etapes || []).filter((x) => x.cleSource === e.cleSource).reduce((s, x) => s + (Number(x.lues) || 0), 0);
        if (total) compte.textContent = nombreEntier(total);
      }
    });
    const actif = [...(m.etapes || [])].reverse().find((e) => e.etat === 'cours');
    const repere = bloc.querySelector('[data-ast-repere]');
    const carte = bloc.querySelector('[data-ast-carte]');
    if (repere && carte && actif) {
      const mot = carte.querySelector(`[data-cle="${CSS.escape(actif.cleSource || '')}"]`);
      if (mot) {
        repere.style.opacity = '1';
        repere.style.transform = `translate(${mot.offsetLeft}px, ${mot.offsetTop + mot.offsetHeight}px) scaleX(${mot.offsetWidth})`;
      }
    } else if (repere) {
      repere.style.opacity = '0';
    }
  }

  function htmlTexte(m) {
    if (m.statut === 'cours' && !m.texte) return (m.etapes || []).length ? '' : '<p class="ast-pense" role="status">Je regarde votre question<span class="ast-points" aria-hidden="true"></span></p>';
    // Pendant l ecriture, un renvoi coupe en deux ne s affiche pas a moitie.
    const texte = m.statut === 'cours' ? m.texte.replace(/\[[SGF]?\d*$/, '') : m.texte;
    let html = markdown(texte, m);
    // Un graphique demande mais jamais place dans le texte se montre a la fin.
    if (m.statut !== 'cours') (m.graphiques || []).forEach((g) => { if (!html.includes(`data-ast-graph="${g.id}"`)) html += `<figure class="ast-graph" data-ast-graph="${g.id}"></figure>`; });
    return html;
  }

  function htmlPropositions(m) {
    return (m.propositions || []).map((p, i) => {
      if (p.etat === 'retenu') return `<p class="ast-prop-fait">Retenu pour tout le centre. <button type="button" class="ast-lien" data-ast-savoir>Voir ce que l'IA a appris</button></p>`;
      if (p.etat === 'ecarte') return '';
      return `<div class="ast-prop" data-ast-prop="${i}">
        <p class="ast-prop-quoi">Je retiens ça pour tout le centre ?</p>
        <p class="ast-prop-texte">${esc(p.texte)}</p>
        <div class="ast-prop-actions">
          <button type="button" class="ast-bouton est-plein" data-ast-prop-oui="${i}">Retenir</button>
          <button type="button" class="ast-lien" data-ast-prop-non="${i}">Non merci</button>
        </div>
      </div>`;
    }).join('');
  }

  function htmlCorrection(m) {
    if (m.corrige) return '<p class="ast-prop-fait">Correction retenue pour tout le centre. <button type="button" class="ast-lien" data-ast-refaire>Refaire la réponse</button></p>';
    if (!m.correction) return '';
    return `<form class="ast-corriger" data-ast-corriger>
      <label class="ast-corriger-titre" for="ast-corr-${esc(m.id)}">Ce qui est faux, et ce qui est vrai</label>
      <textarea id="ast-corr-${esc(m.id)}" class="ast-champ-court" data-ast-correction-texte rows="2" maxlength="${FAIT_MAX}" placeholder="Par exemple, le KFD est complet le mercredi, pas le samedi."></textarea>
      ${m.correctionErreur ? `<p class="ast-erreur" role="alert">${esc(m.correctionErreur)}</p>` : ''}
      <div class="ast-prop-actions">
        <button type="submit" class="ast-bouton est-plein">Retenir la correction</button>
        <button type="button" class="ast-lien" data-ast-corriger-fermer>Annuler</button>
      </div>
    </form>`;
  }

  function htmlPied(m, dernier) {
    if (m.statut === 'cours') return '';
    if (m.statut === 'erreur') return `<p class="ast-erreur" role="alert">${esc(m.erreur)}</p><div class="ast-pied"><button type="button" class="ast-pill" data-ast-refaire>Réessayer</button></div>`;
    const nb = (m.sources || []).length;
    const sans = m.verite && Array.isArray(m.verite.chiffresSansSource) ? m.verite.chiffresSansSource : [];
    const alerte = sans.length
      ? `<p class="ast-alerte">${sans.length > 1 ? `${sans.length} chiffres de cette réponse ne viennent pas de vos données` : 'Un chiffre de cette réponse ne vient pas de vos données'}, ${esc(sans.join(', '))}. Vérifiez avant de vous en servir.</p>`
      : '';
    return `${m.statut === 'arrete' ? '<p class="ast-arrete">Réponse arrêtée.</p>' : ''}${alerte}${htmlPropositions(m)}
    <div class="ast-pied">
      <button type="button" class="ast-icone" data-ast-copier title="Copier" aria-label="Copier la réponse">${icone('copier')}</button>
      ${dernier ? `<button type="button" class="ast-icone" data-ast-refaire title="Refaire" aria-label="Refaire la réponse">${icone('refaire')}</button>` : ''}
      ${m.statut === 'fini' ? `<button type="button" class="ast-pill" data-ast-corriger-ouvrir aria-expanded="${m.correction ? 'true' : 'false'}">Corriger</button>` : ''}
      ${nb ? `<button type="button" class="ast-pill" data-ast-sources>${nb} source${nb > 1 ? 's' : ''}</button>` : ''}
      ${m.modele ? `<span class="ast-tag">${esc(nomModele(m.modele))}</span>` : ''}
    </div>${htmlCorrection(m)}`;
  }

  function htmlMessage(m, i, tous, neuf) {
    if (m.role === 'user') return `<div class="ast-q${neuf ? ' is-neuf' : ''}"><div class="ast-q-bulle">${esc(m.texte)}</div></div>`;
    return `<article class="ast-r${neuf ? ' is-neuf' : ''}" data-ast-i="${i}">
      <div data-ast-haut>${htmlRecherche(m)}</div>
      <div class="ast-r-texte" data-ast-texte>${htmlTexte(m)}</div>
      <div data-ast-basdepage>${htmlPied(m, i === tous.length - 1)}</div>
    </article>`;
  }

  function dessinerGraphiques(article, m) {
    if (!window.PinlaneCharts) return;
    article.querySelectorAll('[data-ast-graph]').forEach((figure) => {
      if (figure.dataset.astDessine) return;
      const g = (m.graphiques || []).find((x) => x.id === figure.dataset.astGraph);
      if (!g) { figure.remove(); return; }
      if (m.statut === 'cours') { figure.innerHTML = `<figcaption>${esc(g.titre)}</figcaption>`; return; }
      figure.dataset.astDessine = '1';
      figure.innerHTML = `<figcaption>${esc(g.titre)} <button type="button" class="ast-cite" data-ast-source="${esc(g.source)}">${esc(String(g.source).slice(1))}</button>${g.autres ? `<span class="ast-graph-note">Les ${g.series.length} plus importantes sur ${g.series.length + g.autres}.</span>` : ''}</figcaption><div class="ast-graph-corps"></div>`;
      const corps = figure.querySelector('.ast-graph-corps');
      if (Array.isArray(g.series)) window.PinlaneCharts.multiChart(corps, { labels: g.etiquettes, series: g.series, format: FORMATS_GRAPHIQUE[g.typeMesure] || 'int', height: 240 });
      else dessiner(corps, g.genre, g.etiquettes, g.valeurs, g.typeMesure, `${m.id}-${g.id}`);
    });
  }

  function dessiner(hote, genre, etiquettes, valeurs, type, motionKey) {
    const series = etiquettes.map((label, i) => ({ label, value: valeurs[i] }));
    const options = { series, format: FORMATS_GRAPHIQUE[type] || 'int', height: 220, motionKey: `assistant-${motionKey}` };
    if (genre === 'barres') window.PinlaneCharts.barChart(hote, options);
    else window.PinlaneCharts.lineChart(hote, options);
  }

  const dom = (sel) => (A.root ? A.root.querySelector(sel) : null);

  function peindreListe() {
    const hote = dom('[data-ast-convs]');
    if (!hote) return;
    majPied();
    if (!A.conversations.length) { hote.innerHTML = `<p class="ast-vide">${A.stockage === 'appareil' ? 'Vos conversations resteront ici, sur cet appareil.' : 'Vos conversations resteront ici, sur tous vos appareils.'}</p>`; return; }
    const debutJour = new Date(); debutJour.setHours(0, 0, 0, 0);
    const groupes = [["Aujourd'hui", (t) => t >= debutJour.getTime()], ['Cette semaine', (t) => t >= debutJour.getTime() - 6 * 864e5], ['Plus ancien', () => true]];
    const vus = new Set();
    let html = '';
    groupes.forEach(([nom, garde]) => {
      const lot = A.conversations.filter((c) => !vus.has(c.id) && garde(c.maj || 0));
      if (!lot.length) return;
      lot.forEach((c) => vus.add(c.id));
      html += `<p class="ast-groupe">${nom}</p>`;
      html += lot.map((c) => (A.aSupprimer === c.id
        ? `<div class="ast-conv est-confirmation"><span>Supprimer ?</span><button type="button" class="ast-lien" data-ast-suppr-oui="${esc(c.id)}">Oui</button><button type="button" class="ast-lien" data-ast-suppr-non>Non</button></div>`
        : `<div class="ast-conv${c.id === A.actuelle ? ' est-active' : ''}"><button type="button" class="ast-conv-titre" data-ast-conv="${esc(c.id)}"${c.id === A.actuelle ? ' aria-current="true"' : ''}><span class="ast-conv-nom">${esc(c.titre || 'Nouvelle conversation')}</span>${c.centerId && c.centerId !== centreId() ? `<span class="ast-conv-centre">${esc(nomDUnCentre(c.centerId).split(/s+/).pop())}</span>` : ''}</button><button type="button" class="ast-conv-suppr" data-ast-suppr="${esc(c.id)}" aria-label="Supprimer la conversation">${icone('corbeille')}</button></div>`)).join('');
    });
    hote.innerHTML = html;
  }

  function peindreFil({ neuf = 0 } = {}) {
    const hote = dom('[data-ast-colonne]');
    const racine = dom('.ast');
    if (!hote || !racine) return;
    const c = courante();
    const messages = c ? (c.messages || []) : [];
    racine.classList.toggle('est-vide', !c || !messages.length);
    if (!messages.length) {
      hote.innerHTML = c ? '<p class="ast-pense">Lecture de la conversation<span class="ast-points" aria-hidden="true"></span></p>' : `<h1 class="ast-salut">Que voulez-vous savoir sur ${esc(nomDuCentre())} ?</h1>`;
    } else {
      hote.innerHTML = messages.map((m, i) => htmlMessage(m, i, messages, i >= messages.length - neuf)).join('');
      hote.querySelectorAll('[data-ast-i]').forEach((a) => dessinerGraphiques(a, messages[Number(a.dataset.astI)]));
    }
    const sugg = dom('[data-ast-suggestions]');
    if (sugg) sugg.hidden = Boolean(messages.length);
    const titre = dom('[data-ast-tete-titre]');
    if (titre) titre.textContent = (c && c.titre) || 'Marketing';
    placerDerniereQuestion();
  }

  // Un seul message change pendant l ecriture : le reste de la page ne bouge pas.
  function demanderPeinture(m) {
    if (A.peintureDemandee) return;
    A.peintureDemandee = true;
    requestAnimationFrame(() => {
      A.peintureDemandee = false;
      peindreMessage(m);
    });
  }
  function peindreMessage(m) {
    const c = courante();
    if (!c || !A.root) return;
    const i = (c.messages || []).indexOf(m);
    if (i < 0) return;
    const article = dom(`[data-ast-i="${i}"]`);
    if (!article) return;
    const haut = article.querySelector('[data-ast-haut]');
    if (m.statut === 'cours') majRecherche(haut, m); else haut.innerHTML = htmlRecherche(m);
    article.querySelector('[data-ast-texte]').innerHTML = htmlTexte(m);
    article.querySelector('[data-ast-basdepage]').innerHTML = htmlPied(m, i === c.messages.length - 1);
    dessinerGraphiques(article, m);
    majDescendre();
  }

  function majDescendre() {
    const fil = dom('[data-ast-fil]');
    const bouton = dom('[data-ast-descendre]');
    if (fil && bouton) bouton.hidden = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 80;
  }

  function placerDerniereQuestion() {
    const fil = dom('[data-ast-fil]');
    if (!fil) return;
    const questions = fil.querySelectorAll('.ast-q');
    const q = questions[questions.length - 1];
    if (q && q.nextElementSibling) {
      q.nextElementSibling.style.minHeight = `${Math.max(0, fil.clientHeight - q.offsetHeight - 68)}px`;
      fil.scrollTop += q.getBoundingClientRect().top - fil.getBoundingClientRect().top - 16;
    }
    majDescendre();
  }

  function peindreCompo() {
    const envoi = dom('[data-ast-envoi]');
    const champ = dom('[data-ast-champ]');
    if (!envoi || !champ) return;
    const enCours = Boolean(A.flux);
    envoi.classList.toggle('est-arret', enCours);
    envoi.innerHTML = enCours ? '<span class="ast-carre" aria-hidden="true"></span>' : icone('fleche');
    envoi.setAttribute('aria-label', enCours ? 'Arrêter' : 'Envoyer');
    envoi.disabled = !enCours && !champ.value.trim();
    const bouton = dom('[data-ast-modele]');
    bouton.querySelector('span').textContent = nomModele(A.modele);
    bouton.setAttribute('aria-expanded', A.menuModele ? 'true' : 'false');
    const menu = dom('[data-ast-menu]');
    menu.hidden = !A.menuModele;
    menu.innerHTML = MODELES.map((m) => `<button type="button" role="menuitemradio" aria-checked="${m.id === A.modele ? 'true' : 'false'}" class="ast-option" data-ast-choix="${m.id}"><span class="ast-option-nom">${m.nom}</span><span class="ast-option-phrase">${m.phrase}</span>${m.id === A.modele ? icone('coche') : ''}</button>`).join('');
  }

  function ajusterChamp() {
    const champ = dom('[data-ast-champ]');
    if (!champ) return;
    champ.style.height = 'auto';
    champ.style.height = `${Math.min(champ.scrollHeight, 200)}px`;
    peindreCompo();
  }

  // La hauteur restante sous l en-tete de la console : la page ne defile jamais, seul le fil.
  function ajusterHauteur() {
    const racine = dom('.ast');
    if (!racine) return;
    const haut = Math.max(0, Math.round(racine.getBoundingClientRect().top + window.scrollY));
    racine.style.setProperty('--ast-haut', `${haut}px`);
  }

  // ---- Ce que l IA a appris ------------------------------------------------------------
  function majPied() {
    const n = A.savoir.faits.length;
    const compte = dom('[data-ast-savoir-compte]');
    if (compte) compte.textContent = A.savoir.charge && n ? String(n) : '';
    const etat = dom('[data-ast-stockage]');
    if (etat) etat.hidden = A.stockage !== 'appareil';
  }

  async function chargerSavoir() {
    try {
      const lu = await appeler('savoir');
      A.savoir.disponible = lu.disponible !== false && !lu.demo;
      A.savoir.faits = Array.isArray(lu.faits) ? lu.faits : [];
      A.savoir.charge = true;
    } catch (erreur) {
      A.savoir.disponible = false;
      A.savoir.charge = true;
    }
    majPied();
    peindrePanneauSiSavoir();
  }

  const quand = (ms) => (ms ? new Date(ms).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '');
  const ORIGINE_DITE = { proposition: 'En discutant avec l’IA', correction: 'En corrigeant une réponse' };

  function htmlSavoir() {
    const S = A.savoir;
    const fermer = `<button type="button" class="ast-icone" data-ast-panneau-fermer aria-label="Fermer">${icone('fermer')}</button>`;
    const tete = `<div class="ast-src-tete"><div><h2>Ce que l'IA a appris</h2><p class="ast-src-detail">Ce que votre équipe lui a appris. Elle s'en sert aussitôt, pour toutes les personnes du centre.</p></div>${fermer}</div>`;
    if (!S.charge) return `${tete}<p class="ast-pense">Lecture<span class="ast-points" aria-hidden="true"></span></p>`;
    if (!S.disponible) return `${tete}<p class="ast-vide">Le savoir de l'équipe sera actif après la prochaine mise à jour de la base.</p>`;
    const formulaire = `<form class="ast-savoir-form" data-ast-savoir-form>
      <label class="ast-corriger-titre" for="ast-savoir-texte">Apprendre quelque chose à l'IA</label>
      <textarea id="ast-savoir-texte" class="ast-champ-court" data-ast-savoir-texte rows="2" maxlength="${FAIT_MAX}" placeholder="Le KFD est complet le mercredi."></textarea>
      ${S.erreur ? `<p class="ast-erreur" role="alert">${esc(S.erreur)}</p>` : ''}
      <div class="ast-prop-actions"><button type="submit" class="ast-bouton est-plein"${S.envoi ? ' disabled' : ''}>Retenir</button></div>
    </form>`;
    if (!S.faits.length) return `${tete}${formulaire}<p class="ast-vide">Rien n'a encore été appris. Écrivez ci-dessus, ou dites à l'assistant « retiens que... » dans une conversation.</p>`;
    const lignes = S.faits.map((f) => {
      const meta = `${f.par ? `Appris par ${esc(f.par)}, ` : ''}${esc(quand(f.le))}${ORIGINE_DITE[f.origine] ? `. ${ORIGINE_DITE[f.origine]}` : ''}${f.modifieLe ? `. Modifié par ${esc(f.modifiePar || 'un collègue')}, ${esc(quand(f.modifieLe))}` : ''}`;
      if (S.aRetirer === f.id) return `<li class="ast-fait" data-ast-fait-ligne="${f.id}"><p>${esc(f.texte)}</p><p class="ast-fait-meta">Retirer ce fait pour tout le centre ?</p><div class="ast-prop-actions"><button type="button" class="ast-bouton est-plein" data-ast-fait-retirer-oui="${f.id}">Retirer</button><button type="button" class="ast-lien" data-ast-fait-retirer-non>Annuler</button></div></li>`;
      if (S.edition === f.id) return `<li class="ast-fait" data-ast-fait-ligne="${f.id}"><form data-ast-fait-form="${f.id}"><textarea class="ast-champ-court" data-ast-fait-texte rows="3" maxlength="${FAIT_MAX}" aria-label="Le fait à retenir">${esc(f.texte)}</textarea><div class="ast-prop-actions"><button type="submit" class="ast-bouton est-plein">Enregistrer</button><button type="button" class="ast-lien" data-ast-fait-annuler>Annuler</button></div></form></li>`;
      return `<li class="ast-fait" data-ast-fait-ligne="${f.id}"><p>${esc(f.texte)}</p><p class="ast-fait-meta">${meta}</p><div class="ast-fait-actions"><button type="button" class="ast-lien" data-ast-fait-modifier="${f.id}">Modifier</button><button type="button" class="ast-lien" data-ast-fait-retirer="${f.id}">Retirer</button></div></li>`;
    }).join('');
    return `${tete}${formulaire}<ol class="ast-faits">${lignes}</ol>`;
  }

  function peindrePanneauSiSavoir() {
    if (A.panneau && A.panneau.genre === 'savoir') peindrePanneau();
  }

  async function retenirFait(texte, origine, contexte) {
    const reponse = await appeler('savoir.ajouter', { texte, origine, contexte });
    if (reponse.fait) {
      A.savoir.faits = [reponse.fait, ...A.savoir.faits.filter((f) => f.id !== reponse.fait.id)];
      majPied();
      peindrePanneauSiSavoir();
    }
    return reponse.fait;
  }

  async function modifierFait(id, texte) {
    const r = await appeler('savoir.modifier', { id, texte });
    A.savoir.faits = A.savoir.faits.map((f) => (f.id === id ? r.fait : f));
    A.savoir.edition = 0;
    peindrePanneauSiSavoir();
  }

  async function retirerFait(id) {
    await appeler('savoir.retirer', { id });
    A.savoir.faits = A.savoir.faits.filter((f) => f.id !== id);
    A.savoir.aRetirer = 0;
    majPied();
    peindrePanneauSiSavoir();
  }

  // ---- Le panneau des sources et du savoir ---------------------------------------------
  function ouvrirPanneau(m, id, ouvreur) {
    A.panneau = { message: m, id };
    if (ouvreur) A.ouvreur = ouvreur;
    peindrePanneau();
  }
  function ouvrirSavoir(ouvreur) {
    A.panneau = { genre: 'savoir' };
    if (ouvreur) A.ouvreur = ouvreur;
    peindrePanneau();
    const fermer = dom('[data-ast-panneau-fermer]');
    if (fermer) fermer.focus({ preventScroll: true });
    // Relu a chaque ouverture : ce qu un collegue vient d apprendre se voit tout de suite.
    chargerSavoir();
  }
  function fermerPanneau() {
    A.panneau = null;
    peindrePanneau();
    if (A.ouvreur && A.ouvreur.isConnected) A.ouvreur.focus();
    A.ouvreur = null;
  }
  function peindrePanneau() {
    const hote = dom('[data-ast-panneau]');
    const racine = dom('.ast');
    if (!hote || !racine) return;
    racine.classList.toggle('a-source', Boolean(A.panneau));
    hote.hidden = !A.panneau;
    if (!A.panneau) { hote.innerHTML = ''; return; }
    if (A.panneau.genre === 'savoir') {
      // La liste se relit toute seule : ni le brouillon ni le focus ne se perdent au repeint.
      const champ = hote.querySelector('[data-ast-savoir-texte]');
      const brouillon = champ ? champ.value : '';
      const actif = hote.contains(document.activeElement) ? document.activeElement : null;
      const repere = actif && (actif.matches('[data-ast-panneau-fermer]') ? '[data-ast-panneau-fermer]' : (actif.matches('[data-ast-savoir-texte]') ? '[data-ast-savoir-texte]' : ''));
      hote.innerHTML = htmlSavoir();
      const neuf = hote.querySelector('[data-ast-savoir-texte]');
      if (neuf && brouillon) neuf.value = brouillon;
      if (repere) { const retrouve = hote.querySelector(repere); if (retrouve) retrouve.focus({ preventScroll: true }); }
      return;
    }
    const { message: m, id } = A.panneau;
    const sources = m.sources || [];
    const source = id ? sources.find((s) => s.id === id) : null;
    const fermer = `<button type="button" class="ast-icone" data-ast-panneau-fermer aria-label="Fermer">${icone('fermer')}</button>`;
    if (!source) {
      hote.innerHTML = `<div class="ast-src-tete"><h2>Sources de cette réponse</h2>${fermer}</div>
      <ol class="ast-src-liste">${sources.map((s) => `<li><button type="button" class="ast-src-ligne" data-ast-source="${esc(s.id)}"><span class="ast-cite">${esc(s.id.slice(1))}</span><span>${esc(s.titre)}</span></button></li>`).join('')}</ol>`;
    } else {
      const lien = source.lien && PAGES[source.lien.page];
      const tete = source.colonnes.map((c) => `<th scope="col"${c.type && c.type !== 'texte' ? ' class="est-chiffre"' : ''}>${esc(c.nom)}</th>`).join('');
      const corps = source.lignes.map((l) => {
        const cellules = source.colonnes.map((c) => {
          const type = c.type === 'auto' ? l.type : c.type;
          return `<td${type && type !== 'texte' && type !== 'client' ? ' class="est-chiffre"' : ''}>${esc(formater(l[c.cle], type))}</td>`;
        }).join('');
        return source.ouvrables && l.reservation ? `<tr class="est-ouvrable" data-ast-reservation="${esc(l.reservation)}" tabindex="0" title="Ouvrir la réservation">${cellules}</tr>` : `<tr>${cellules}</tr>`;
      }).join('');
      hote.innerHTML = `<div class="ast-src-tete"><div><p class="ast-src-no">Source ${esc(source.id.slice(1))}</p><h2>${esc(source.titre)}</h2></div>${fermer}</div>
      ${source.detail ? `<p class="ast-src-detail">${esc(source.detail)}</p>` : ''}
      <div class="ast-src-graph" data-ast-src-graph></div>
      ${source.lignes.length ? `<div class="ast-table"><table><thead><tr>${tete}</tr></thead><tbody>${corps}</tbody></table></div>` : '<p class="ast-src-detail">Aucune ligne.</p>'}
      ${source.coupe ? `<p class="ast-src-detail">Seules les ${LIGNES_GARDEES} premières lignes sont gardées avec la conversation.</p>` : ''}
      ${lien ? `<button type="button" class="ast-pill" data-ast-page="${esc(lien.cle)}">Ouvrir ${esc(lien.nom)}</button>` : ''}
      ${sources.length > 1 ? '<button type="button" class="ast-lien" data-ast-sources>Toutes les sources</button>' : ''}`;
      graphiqueDeSource(hote.querySelector('[data-ast-src-graph]'), source);
    }
    const premier = hote.querySelector('[data-ast-panneau-fermer]');
    if (premier) premier.focus({ preventScroll: true });
  }

  // Un tableau d au moins deux lignes avec une colonne de chiffres se lit aussi d un coup d oeil.
  function graphiqueDeSource(hote, source) {
    if (!hote || !window.PinlaneCharts || source.lignes.length < 2 || source.lignes.length > 40) return;
    const [axe, ...reste] = source.colonnes;
    const mesure = reste.find((c) => ['entier', 'euro', 'pct', 'dec'].includes(c.type));
    if (!axe || !mesure || axe.type !== 'texte' || reste.some((c) => c.type === 'texte')) return;
    const points = source.lignes.filter((l) => typeof l[mesure.cle] === 'number');
    if (points.length < 2) return;
    const temps = /^(jour|semaine|mois|annee)$/.test(axe.cle);
    dessiner(hote, temps ? 'courbe' : 'barres', points.map((l) => String(l[axe.cle])), points.map((l) => l[mesure.cle]), mesure.type, `src-${source.id}-${points.length}`);
  }

  // ---- Poser une question ------------------------------------------------------------
  function nouvelleConversation() {
    A.actuelle = '';
    A.panneau = null;
    peindrePanneau();
    peindreListe();
    peindreFil();
    const champ = dom('[data-ast-champ]');
    if (champ) champ.focus();
    fermerListe();
  }

  function pourLeServeur(conversation, jusqua) {
    return conversation.messages
      .slice(0, conversation.messages.indexOf(jusqua))
      .filter((m) => m.texte && m.statut !== 'erreur')
      .map((m) => ({ role: m.role, content: m.texte }));
  }

  async function poser(conversation, reponse) {
    const coupure = new AbortController();
    A.flux = coupure;
    peindreCompo();
    try {
      if (typeof isDemoRoute === 'function' && isDemoRoute()) {
        reponse.texte = "Cet assistant lit les vraies données d'un centre. Il ne répond pas dans la démonstration.";
        reponse.statut = 'fini';
        return;
      }
      const envoi = await fetch('/api/assistant', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: coupure.signal,
        headers: staffAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ centerId: conversation.centerId || centreId(), modele: A.modele, messages: pourLeServeur(conversation, reponse) }),
      });
      if (!/event-stream/.test(envoi.headers.get('content-type') || '')) {
        const corps = await envoi.json().catch(() => ({}));
        if (envoi.status === 401 && typeof clearStaffAuthSession === 'function') {
          clearStaffAuthSession();
          if (typeof applyAuthState === 'function') applyAuthState();
        }
        throw Object.assign(new Error(corps.message || "L'assistant est indisponible pour le moment."), { lisible: true });
      }
      await lireLeFlux(envoi, reponse);
      if (reponse.statut === 'cours') throw Object.assign(new Error("La réponse s'est arrêtée avant la fin. Réessayez."), { lisible: true });
    } catch (erreur) {
      if (erreur && erreur.name === 'AbortError') reponse.statut = 'arrete';
      else {
        reponse.statut = 'erreur';
        reponse.erreur = erreur && erreur.lisible ? erreur.message : 'La connexion a été coupée. Réessayez.';
      }
    } finally {
      A.flux = null;
      conversation.maj = Date.now();
      sauver(conversation);
      peindreMessage(reponse);
      peindreCompo();
      peindreListe();
    }
  }

  async function lireLeFlux(envoi, m) {
    const lecteur = envoi.body.getReader();
    const decodeur = new TextDecoder();
    let tampon = '';
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += decodeur.decode(value, { stream: true });
      let fin = tampon.indexOf('\n\n');
      while (fin >= 0) {
        traiter(tampon.slice(0, fin), m);
        tampon = tampon.slice(fin + 2);
        fin = tampon.indexOf('\n\n');
      }
    }
  }

  function traiter(bloc, m) {
    if (bloc.startsWith(':')) return;
    const type = /^event: (.*)$/m.exec(bloc);
    const data = /^data: (.*)$/m.exec(bloc);
    if (!type || !data) return;
    let d;
    try { d = JSON.parse(data[1]); } catch (erreur) { return; }
    switch (type[1]) {
      case 'debut': if (Array.isArray(d.sources)) { A.carte = d.sources; m.carte = d.sources; } break;
      case 'texte': m.texte += d.delta; break;
      case 'note': m.texte = ''; m.etapes.push({ note: true, libelle: String(d.texte).slice(0, 240) }); break;
      case 'etape': {
        const e = m.etapes.find((x) => x.id === d.id);
        if (e) Object.assign(e, d); else m.etapes.push({ ...d, lues: 0, total: 0, trouvees: 0, extraits: [], extraitsVus: 0 });
        break;
      }
      case 'lecture': {
        const e = m.etapes.find((x) => x.id === d.id);
        if (e) {
          e.lues = d.lues || e.lues;
          e.total = d.total || e.total;
          e.trouvees = d.trouvees || e.trouvees;
          if (Array.isArray(d.extraits) && d.extraits.length) {
            e.extraits = [...(e.extraits || []), ...d.extraits].slice(-8);
            e.extraitsVus = (e.extraitsVus || 0) + d.extraits.length;
          }
        }
        break;
      }
      case 'source': m.sources.push(d); break;
      case 'graphique': m.graphiques.push(d); break;
      case 'proposition': m.propositions = [...(m.propositions || []), { texte: d.texte, etat: '' }]; break;
      case 'annule': m.texte = ''; break;
      case 'fin':
        m.texte = d.texte;
        m.verite = d.verite || null;
        m.modele = d.modele || '';
        m.faitsCites = d.faitsCites || [];
        m.statut = 'fini';
        Object.assign(A.identites, d.identites || {});
        break;
      case 'erreur': throw Object.assign(new Error(d.message), { lisible: true });
      default: return;
    }
    demanderPeinture(m);
  }

  function envoyer(texte) {
    const question = String(texte || '').trim();
    if (!question || A.flux) return;
    if (question.length > QUESTION_MAX) { if (typeof toast === 'function') toast('Votre message est trop long.'); return; }
    let c = courante();
    if (!c) {
      c = { id: uid(), titre: question.slice(0, 60), maj: Date.now(), messages: [], centerId: centreId() };
      A.conversations.unshift(c);
      A.actuelle = c.id;
    }
    if (!Array.isArray(c.messages)) return;
    c.messages.push({ role: 'user', texte: question });
    const reponse = { id: uid(), role: 'assistant', texte: '', sources: [], graphiques: [], etapes: [], propositions: [], statut: 'cours' };
    c.messages.push(reponse);
    c.maj = Date.now();
    A.conversations = [c, ...A.conversations.filter((x) => x !== c)];
    const champ = dom('[data-ast-champ]');
    if (champ) { champ.value = ''; ajusterChamp(); }
    peindreListe();
    peindreFil({ neuf: 2 });
    poser(c, reponse);
  }

  function refaire() {
    const c = courante();
    if (!c || A.flux) return;
    const derniere = c.messages[c.messages.length - 1];
    if (!derniere || derniere.role !== 'assistant') return;
    Object.assign(derniere, { id: uid(), texte: '', sources: [], graphiques: [], etapes: [], propositions: [], statut: 'cours', verite: null, erreur: '', modele: '', correction: false, corrige: false, faitsCites: [] });
    A.panneau = null;
    peindrePanneau();
    peindreFil();
    poser(c, derniere);
  }

  function copier(m) {
    const propre = m.texte.replace(/[  ]?\[[SGF]\d+\]/g, '').replace(/\b[A-Z]\d{4}\b/g, (code) => A.identites[code] || code).trim();
    const dire = () => { if (typeof toast === 'function') toast('Réponse copiée.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(propre).then(dire).catch(() => {});
  }

  function ouvrirListe() { dom('.ast').classList.add('liste-ouverte'); }
  function fermerListe() { dom('.ast').classList.remove('liste-ouverte'); }

  function messageDe(cible) {
    const article = cible.closest('[data-ast-i]');
    const c = courante();
    return article && c ? c.messages[Number(article.dataset.astI)] : null;
  }

  function supprimer(id) {
    A.conversations = A.conversations.filter((c) => c.id !== id);
    if (A.actuelle === id) { A.actuelle = ''; A.panneau = null; peindrePanneau(); peindreFil(); }
    A.aSupprimer = '';
    sauverSurAppareil(A.stockage === 'serveur' ? [] : undefined);
    peindreListe();
    if (A.stockage === 'serveur') appeler('supprimer', { id }).catch(() => { if (typeof toast === 'function') toast("La suppression n'a pas pu se faire."); });
  }

  async function ouvrir(id) {
    A.actuelle = id;
    A.aSupprimer = '';
    A.panneau = null;
    peindrePanneau(); peindreListe(); peindreFil(); fermerListe();
    const c = courante();
    if (c && c.messages === null) {
      try {
        const lu = await appeler('conversation', { id });
        if (lu.conversation) c.messages = lu.conversation.messages;
      } catch (erreur) {
        if (erreur && erreur.statut === 404) A.conversations = A.conversations.filter((x) => x.id !== id);
        if (A.actuelle === id) A.actuelle = '';
        if (typeof toast === 'function') toast("Cette conversation n'a pas pu s'ouvrir.");
      }
      if (A.actuelle === id || !A.actuelle) { peindreListe(); peindreFil(); }
    }
  }

  // ---- Les gestes, tous par delegation sur la page -------------------------------------
  function surClic(e) {
    const t = e.target;
    const v = (sel) => t.closest(sel);
    let n;
    if (A.menuModele && !v('[data-ast-menu]') && !v('[data-ast-modele]')) { A.menuModele = false; peindreCompo(); }
    if ((n = v('[data-ast-nouvelle]'))) { nouvelleConversation(); return; }
    if ((n = v('[data-ast-ouvrir-liste]'))) { ouvrirListe(); return; }
    if ((n = v('[data-ast-voile]'))) { fermerListe(); return; }
    if ((n = v('[data-ast-conv]'))) { ouvrir(n.dataset.astConv); return; }
    if ((n = v('[data-ast-suppr]'))) { A.aSupprimer = n.dataset.astSuppr; peindreListe(); return; }
    if ((n = v('[data-ast-suppr-non]'))) { A.aSupprimer = ''; peindreListe(); return; }
    if ((n = v('[data-ast-suppr-oui]'))) { supprimer(n.dataset.astSupprOui); return; }
    if ((n = v('[data-ast-suggestion]'))) { envoyer(n.textContent); return; }
    if ((n = v('[data-ast-modele]'))) { A.menuModele = !A.menuModele; peindreCompo(); return; }
    if ((n = v('[data-ast-choix]'))) { A.modele = n.dataset.astChoix; A.menuModele = false; sauverSurAppareil(A.stockage === 'serveur' ? [] : undefined); peindreCompo(); dom('[data-ast-champ]').focus(); return; }
    if ((n = v('[data-ast-descendre]'))) { const fil = dom('[data-ast-fil]'); fil.scrollTop = fil.scrollHeight; return; }
    if ((n = v('[data-ast-panneau-fermer]'))) { fermerPanneau(); return; }
    if ((n = v('[data-ast-page]'))) { if (typeof location !== 'undefined') location.hash = `#/staff/${n.dataset.astPage}`; return; }
    if ((n = v('[data-ast-reservation]'))) { ouvrirReservation(n.dataset.astReservation); return; }
    if ((n = v('[data-ast-savoir]'))) { fermerListe(); ouvrirSavoir(n); return; }
    if ((n = v('[data-ast-fait]'))) { ouvrirSavoir(n); return; }
    if ((n = v('[data-ast-source]'))) {
      const dans = n.closest('[data-ast-panneau]');
      const m = dans && A.panneau ? A.panneau.message : messageDe(n);
      if (m) ouvrirPanneau(m, n.dataset.astSource, dans ? null : n);
      return;
    }
    if ((n = v('[data-ast-sources]'))) {
      const dans = n.closest('[data-ast-panneau]');
      const m = dans && A.panneau ? A.panneau.message : messageDe(n);
      if (m) ouvrirPanneau(m, null, dans ? null : n);
      return;
    }
    if ((n = v('[data-ast-etape-ouvrir]'))) {
      const m = messageDe(n);
      if (m && m.statut !== 'cours') {
        m.etapesDeroulees = { ...(m.etapesDeroulees || {}), [n.dataset.astEtapeOuvrir]: !(m.etapesDeroulees || {})[n.dataset.astEtapeOuvrir] };
        const hote = n.closest('[data-ast-haut]');
        hote.innerHTML = htmlRecherche(m);
      }
      return;
    }
    if ((n = v('[data-ast-etapes]'))) {
      const m = messageDe(n);
      if (m) { m.etapesOuvertes = !m.etapesOuvertes; peindreMessage(m); }
      return;
    }
    if ((n = v('[data-ast-copier]'))) { const m = messageDe(n); if (m) copier(m); return; }
    if ((n = v('[data-ast-refaire]'))) { refaire(); return; }
    if ((n = v('[data-ast-corriger-ouvrir]'))) {
      const m = messageDe(n);
      if (m) { m.correction = !m.correction; m.correctionErreur = ''; peindreMessage(m); if (m.correction) { const champ = dom(`[data-ast-i="${courante().messages.indexOf(m)}"] [data-ast-correction-texte]`); if (champ) champ.focus(); } }
      return;
    }
    if ((n = v('[data-ast-corriger-fermer]'))) { const m = messageDe(n); if (m) { m.correction = false; m.correctionErreur = ''; peindreMessage(m); } return; }
    if ((n = v('[data-ast-prop-oui]'))) {
      const m = messageDe(n);
      const p = m && m.propositions[Number(n.dataset.astPropOui)];
      if (p) {
        n.disabled = true;
        retenirFait(p.texte, 'proposition', '').then(() => { p.etat = 'retenu'; sauver(courante()); peindreMessage(m); }).catch((erreur) => { n.disabled = false; if (typeof toast === 'function') toast(erreur && erreur.lisible ? erreur.message : 'Cela n’a pas pu être retenu.'); });
      }
      return;
    }
    if ((n = v('[data-ast-prop-non]'))) {
      const m = messageDe(n);
      const p = m && m.propositions[Number(n.dataset.astPropNon)];
      if (p) { p.etat = 'ecarte'; sauver(courante()); peindreMessage(m); }
      return;
    }
    if ((n = v('[data-ast-fait-modifier]'))) { A.savoir.edition = Number(n.dataset.astFaitModifier); A.savoir.aRetirer = 0; peindrePanneau(); const champ = dom('[data-ast-fait-texte]'); if (champ) champ.focus(); return; }
    if ((n = v('[data-ast-fait-annuler]'))) { A.savoir.edition = 0; peindrePanneau(); return; }
    if ((n = v('[data-ast-fait-retirer]'))) { A.savoir.aRetirer = Number(n.dataset.astFaitRetirer); A.savoir.edition = 0; peindrePanneau(); return; }
    if ((n = v('[data-ast-fait-retirer-non]'))) { A.savoir.aRetirer = 0; peindrePanneau(); return; }
    if ((n = v('[data-ast-fait-retirer-oui]'))) {
      retirerFait(Number(n.dataset.astFaitRetirerOui)).catch((erreur) => { if (typeof toast === 'function') toast(erreur && erreur.lisible ? erreur.message : 'Ce fait n’a pas pu être retiré.'); });
      return;
    }
  }

  function surEnvoiFormulaire(e) {
    const t = e.target;
    if (t.matches('[data-ast-compo]')) {
      e.preventDefault();
      if (A.flux) { A.flux.abort(); return; }
      envoyer(dom('[data-ast-champ]').value);
      return;
    }
    if (t.matches('[data-ast-savoir-form]')) {
      e.preventDefault();
      const champ = t.querySelector('[data-ast-savoir-texte]');
      A.savoir.erreur = '';
      A.savoir.envoi = true;
      peindrePanneau();
      retenirFait(champ.value, 'panneau', '').then(() => {
        A.savoir.envoi = false;
        const encore = dom('[data-ast-savoir-texte]');
        if (encore) encore.value = '';
        peindrePanneauSiSavoir();
      }).catch((erreur) => {
        A.savoir.envoi = false;
        A.savoir.erreur = erreur && erreur.lisible ? erreur.message : 'Cela n’a pas pu être retenu.';
        peindrePanneauSiSavoir();
      });
      return;
    }
    if (t.matches('[data-ast-fait-form]')) {
      e.preventDefault();
      modifierFait(Number(t.dataset.astFaitForm), t.querySelector('[data-ast-fait-texte]').value).catch((erreur) => { if (typeof toast === 'function') toast(erreur && erreur.lisible ? erreur.message : 'Ce fait n’a pas pu être modifié.'); });
      return;
    }
    if (t.matches('[data-ast-corriger]')) {
      e.preventDefault();
      const m = messageDe(t);
      const champ = t.querySelector('[data-ast-correction-texte]');
      if (!m) return;
      retenirFait(champ.value, 'correction', String(m.texte || '').slice(0, 280)).then(() => {
        m.correction = false;
        m.corrige = true;
        sauver(courante());
        peindreMessage(m);
      }).catch((erreur) => {
        m.correctionErreur = erreur && erreur.lisible ? erreur.message : 'Cela n’a pas pu être retenu.';
        peindreMessage(m);
      });
    }
  }

  function ouvrirReservation(id) {
    if (typeof openStaffReservationDetail === 'function') openStaffReservationDetail(/^\d+$/.test(id) ? Number(id) : id);
  }

  function surTouche(e) {
    if (e.key === 'Escape') {
      if (A.menuModele) { A.menuModele = false; peindreCompo(); dom('[data-ast-modele]').focus(); return; }
      if (A.panneau) { fermerPanneau(); return; }
    }
    const ligne = e.target.closest && e.target.closest('[data-ast-reservation]');
    if (ligne && e.key === 'Enter') { ouvrirReservation(ligne.dataset.astReservation); return; }
    if (e.target.matches && e.target.matches('[data-ast-champ]') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      envoyer(e.target.value);
    }
  }

  function monter() {
    const plusieurs = typeof getAdminCenters === 'function' && getAdminCenters().filter((c) => c.id !== 'all').length > 1;
    const suggestions = (plusieurs ? [...SUGGESTIONS, 'Comparez mes centres sur les trois derniers mois.'] : SUGGESTIONS).map((s) => `<button type="button" class="ast-suggestion" data-ast-suggestion>${esc(s)}</button>`).join('');
    A.root.innerHTML = `<div class="ast est-vide">
      <div class="ast-voile" data-ast-voile></div>
      <aside class="ast-liste" aria-label="Conversations">
        <button type="button" class="ast-nouvelle" data-ast-nouvelle>${icone('plus')}<span>Nouvelle conversation</span></button>
        <nav class="ast-convs" data-ast-convs aria-label="Vos conversations"></nav>
        <div class="ast-liste-pied">
          <button type="button" class="ast-savoir-lien" data-ast-savoir>${icone('livre')}<span>Ce que l'IA a appris</span><b data-ast-savoir-compte></b></button>
          <p class="ast-stockage" data-ast-stockage hidden>Conversations gardées sur cet appareil pour l'instant.</p>
        </div>
      </aside>
      <section class="ast-chat" aria-label="Assistant du centre">
        <div class="ast-tete">
          <button type="button" class="ast-icone" data-ast-ouvrir-liste aria-label="Vos conversations">${icone('menu')}</button>
          <span class="ast-tete-titre" data-ast-tete-titre>Marketing</span>
          <button type="button" class="ast-icone" data-ast-nouvelle aria-label="Nouvelle conversation">${icone('plus')}</button>
        </div>
        <div class="ast-fil" data-ast-fil><div class="ast-colonne" data-ast-colonne></div></div>
        <button type="button" class="ast-descendre ast-icone" data-ast-descendre aria-label="Aller à la fin" hidden>${icone('bas')}</button>
        <div class="ast-bas">
          <form class="ast-compo" data-ast-compo>
            <textarea class="ast-champ" data-ast-champ rows="1" maxlength="${QUESTION_MAX}" placeholder="Posez votre question" aria-label="Votre question"></textarea>
            <div class="ast-compo-pied">
              <div class="ast-modele">
                <button type="button" class="ast-modele-bouton" data-ast-modele aria-haspopup="menu" aria-expanded="false" aria-label="Choisir le modèle"><span></span>${icone('chevron')}</button>
                <div class="ast-menu" data-ast-menu role="menu" aria-label="Modèle" hidden></div>
              </div>
              <button type="submit" class="ast-envoi" data-ast-envoi aria-label="Envoyer" disabled></button>
            </div>
          </form>
          <div class="ast-suggestions" data-ast-suggestions>${suggestions}</div>
          <p class="ast-avis">L'assistant lit vos données et ne modifie rien.</p>
        </div>
      </section>
      <aside class="ast-sources" data-ast-panneau aria-label="Source" hidden></aside>
    </div>`;
    const fil = dom('[data-ast-fil]');
    fil.addEventListener('scroll', majDescendre, { passive: true });
    const racine = dom('.ast');
    racine.addEventListener('click', surClic);
    racine.addEventListener('keydown', surTouche);
    racine.addEventListener('input', (e) => { if (e.target.matches('[data-ast-champ]')) ajusterChamp(); });
    racine.addEventListener('submit', surEnvoiFormulaire);
    peindreListe();
    peindreFil();
    ajusterChamp();
  }

  window.addEventListener('resize', () => { if (A.root && A.root.querySelector('.ast')) ajusterHauteur(); }, { passive: true });

  // Echap ferme le panneau meme quand le focus n est plus dans la page (apres un clic dans le vide).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && A.panneau && A.root && A.root.isConnected && dom('.ast') && !e.defaultPrevented && !A.menuModele) fermerPanneau();
  });

  // Revenir sur l onglet relit la liste : une conversation commencee sur un autre appareil apparait.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && A.root && A.root.isConnected && dom('.ast') && !A.flux && A.stockage !== 'inconnu') synchroniser();
  });

  // La console rappelle cette fonction a chaque rafraichissement : une page deja montee pour ce
  // centre et ce compte ne se touche pas, le champ et le fil gardent tout ce qu ils ont.
  window.renderStaffCampaignsPage = function renderStaffCampaignsPage() {
    const root = document.getElementById('staffCampaignsPage');
    if (!root) return;
    root.closest('.staff-wrap')?.classList.add('a-bureau-mkw');
    const cle = clePortee();
    if (A.root !== root || A.cle !== cle || !root.querySelector('.ast')) {
      if (A.flux) A.flux.abort();
      A.root = root;
      A.cle = cle;
      charger();
      monter();
      synchroniser();
      chargerSavoir();
      // La bande du haut peut grandir d un cheveu quand les polices arrivent.
      setTimeout(ajusterHauteur, 300);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajusterHauteur);
    }
    ajusterHauteur();
  };

  window.PinlaneAssistant = { markdown };
})();

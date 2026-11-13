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
  // Le detail lu pese : seules les dernieres reponses le gardent, une longue conversation doit tenir.
  const DETAILS_GARDES = 12;
  const QUESTION_MAX = 6000;
  const FAIT_MAX = 500;
  // LE MODELE QUI REFLECHIT (Ansar, 2026-11-11 : « l'IA n'est pas du tout assez smart, elle réfléchit pas
  // assez »). Sonnet par defaut : au banc, il a lu « 2 parties de laser à 3 » comme 3 joueurs sur 5, la ou
  // Haiku demandait ce que voulait dire « à 3 ». Opus pour les decisions qui comptent, Haiku pour une
  // question simple. Un choix garde d avant ce menu (MODELE_VERSION) etait le defaut d alors : il ne se
  // reprend pas.
  const MODELES = [
    { id: 'sonnet', nom: 'Sonnet 5.5', phrase: 'Réfléchi, pour la plupart des questions.' },
    { id: 'opus', nom: 'Opus 5.5', phrase: 'Le plus poussé, pour les décisions qui comptent.' },
    { id: 'haiku', nom: 'Haiku 5.5', phrase: 'Rapide, pour une question simple.' },
  ];
  const MODELE_VERSION = 2;
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
  // Les pages ou « M’y emmener » peut mener, et les rubriques d Etablissement (lib/carte-logiciel.js).
  const PAGES_OUVRABLES = ['dashboard', 'planning', 'reservations', 'formules', 'arrivals', 'clients', 'requests', 'emails', 'campaigns', 'prices', 'lanes', 'laserGame', 'users', 'establishment', 'secours', 'settings'];
  const RUBRIQUES = ['centre', 'horaires', 'activites', 'formules', 'reservations', 'accueil', 'formulaire'];
  // Les gestes que la personne peut faire faire, et les seules cles qui partent avec chacun.
  // ouvrirReserver ne part pas au serveur : il ouvre la fenetre Reserver preremplie, la personne confirme.
  // noteClient passe par la porte des notes du client (api/staff-customer-notes), qui revoit le droit et le centre.
  // assistantReservation part a api/ops.js, qui revoit tout (lib/assistant-reservation.js) : le programme,
  // le telephone du client tape sur la carte, le plan sur la journee lue au clic, les droits.
  const GESTES = { ouvertureExceptionnelle: ['date', 'open', 'close', 'motif'], customRequestStatus: ['id', 'status'], ouvrirReserver: ['date', 'startTime', 'pax', 'name'], noteClient: ['reservationId', 'texte'], assistantReservation: ['date', 'startTime', 'pax', 'programme', 'supplements', 'prix', 'raisonPrix', 'note', 'name', 'phone'], annulerReservation: ['reservationId', 'date'], effacerConversations: ['portee', 'jours'], assistantGeste: ['geste', 'params'] };
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
    root: null, cle: '', conversations: [], actuelle: '', modele: 'sonnet', flux: null, panneau: null,
    menuModele: false, aSupprimer: '', identites: Object.create(null), peintureDemandee: false, ouvreur: null,
    suivi: true, dernierGeste: 0, glisse: 0, vuHaut: 0, vuHauteur: 0, observateur: null,
    stockage: 'inconnu', carte: [], savoir: { charge: false, disponible: true, faits: [], edition: 0, aRetirer: 0, envoi: false, erreur: '' },
  };

  // ---- Ou l on est et ce qu on garde ---------------------------------------------
  function centreId() { return (typeof state !== 'undefined' && state.adminCenterId) || 'libramont'; }
  function membreId() { return (typeof getStaffSessionMemberId === 'function' && getStaffSessionMemberId()) || 'poste'; }
  function nomDuCentre() {
    const c = typeof getAdminCenter === 'function' ? getAdminCenter() : null;
    return (c && c.name) || 'votre centre';
  }
  // Le client a-t-il plusieurs centres ? Ceux de la console (2026-11-13 : A.centres n etait jamais rempli).
  function plusieursCentres() { return (typeof getAdminCenters === 'function' ? getAdminCenters() : []).filter((c) => c && c.id && c.id !== 'all').length > 1; }
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
      if (lu && lu.modeleV === MODELE_VERSION && MODELES.some((m) => m.id === lu.modele)) A.modele = lu.modele;
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

  // Les lignes lues pendant la recherche nomment des clients : elles ne quittent pas la session.
  const messagePourStockage = (m, i, liste) => (m.role === 'user' ? { role: 'user', texte: m.texte } : { ...m, correction: undefined, etapes: Array.isArray(m.etapes) ? m.etapes.map((e) => ({ ...e, extraits: undefined, lecture: A.stockage === 'serveur' ? e.lecture : undefined })) : m.etapes, repris: Array.isArray(m.repris) ? m.repris.map((r) => ({ ...r, lecture: A.stockage === 'serveur' ? r.lecture : undefined })) : [], sources: (m.sources || []).map((s) => ({ ...s, sections: A.stockage === 'serveur' && i >= liste.length - DETAILS_GARDES ? s.sections : undefined, lignes: s.lignes.slice(0, LIGNES_GARDEES), coupe: s.coupe || s.lignes.length > LIGNES_GARDEES })) });

  function versStockage(attente) {
    const appareil = A.stockage !== 'serveur';
    return {
      modele: A.modele,
      modeleV: MODELE_VERSION,
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
    if (A.actuelle) peindreFil({ garder: true });
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

  // Chaque chiffre de la reponse devient un bouton qui mene a sa preuve. La position vient du serveur.
  function marquer(texte, preuves) {
    let sortie = texte;
    (preuves || []).map((p, i) => ({ p, i })).sort((a, b) => b.p.d - a.p.d).forEach(({ p, i }) => {
      if (sortie.slice(p.d, p.f) === p.t) sortie = `${sortie.slice(0, p.d)}\u27E6${i}:${p.t}\u27E7${sortie.slice(p.f)}`;
    });
    return sortie;
  }
  function titreDePreuve(p) {
    if (p.e === 'inconnu') return "Ce chiffre n'a pas été retrouvé dans les données lues";
    if (p.e === 'appris') return "Appris par l'équipe du centre";
    return p.e === 'calcule' ? `Calculé, ${p.l}` : p.l;
  }

  function enLigne(brut, m) {
    let t = esc(brut);
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/\b[A-Z]\d{4}\b/g, (code) => (A.identites[code] ? esc(A.identites[code]) : code));
    t = t.replace(/\[((?:[SGF]\d+\s*[,;]\s*)+[SGF]\d+)\]/g, (tout, liste) => liste.split(/\s*[,;]\s*/).map((r) => `[${r}]`).join(''));
    t = t.replace(/\u27E6(\d+):([^\u27E7]*)\u27E7/g, (tout, i, chiffre) => {
      const p = (m.preuves || [])[Number(i)];
      return p ? `<button type="button" class="ast-chiffre${p.e === 'inconnu' ? ' est-douteux' : ''}" data-ast-preuve="${Number(i)}" style="--n:${Number(i)}" title="${esc(titreDePreuve(p))}">${chiffre}</button>` : chiffre;
    });
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
  // Il rend ses blocs un par un : pendant l ecriture, seul le bloc qui change se touche.
  function markdown(brut, m) { return blocsMarkdown(brut, m).join(''); }
  function blocsMarkdown(brut, m) {
    const lignes = String(brut || '').replace(/\r/g, '').split('\n');
    const blocs = [];
    let i = 0;
    while (i < lignes.length) {
      const l = lignes[i];
      if (!l.trim()) { i += 1; continue; }
      const graphique = /^\s*\[(G\d+)\]\s*$/.exec(l);
      if (graphique) { blocs.push(`<figure class="ast-graph" data-ast-graph="${graphique[1]}"></figure>`); i += 1; continue; }
      const titre = /^\s*(#{1,4})\s+(.*)$/.exec(l);
      if (titre) { blocs.push(`<h3>${enLigne(titre[2], m)}</h3>`); i += 1; continue; }
      if (/\|/.test(l) && i + 1 < lignes.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lignes[i + 1]) && lignes[i + 1].includes('-')) {
        const tete = celules(l);
        i += 2;
        const corps = [];
        while (i < lignes.length && /\|/.test(lignes[i]) && lignes[i].trim()) { corps.push(celules(lignes[i])); i += 1; }
        blocs.push(`<div class="ast-table"><table><thead><tr>${tete.map((c) => `<th scope="col">${enLigne(c, m)}</th>`).join('')}</tr></thead><tbody>${corps.map((r) => `<tr>${tete.map((_, j) => `<td>${enLigne(r[j] || '', m)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      const puce = /^\s*[-*•]\s+/;
      const numero = /^\s*\d+[.)]\s+/;
      if (puce.test(l) || numero.test(l)) {
        const motif = puce.test(l) ? puce : numero;
        const balise = motif === puce ? 'ul' : 'ol';
        const items = [];
        // Une liste numerotee coupee par une ligne vide ou par des puces garde ses numeros : chaque
        // point porte celui que le modele a ecrit, au lieu de repartir de 1.
        while (i < lignes.length && motif.test(lignes[i])) { items.push({ texte: lignes[i].replace(motif, ''), rang: motif === numero ? Number(/\d+/.exec(lignes[i])[0]) : 0 }); i += 1; }
        blocs.push(`<${balise}>${items.map((x) => `<li${x.rang ? ` value="${x.rang}"` : ''}>${enLigne(x.texte, m)}</li>`).join('')}</${balise}>`);
        continue;
      }
      const paragraphe = [l];
      i += 1;
      while (i < lignes.length && lignes[i].trim() && !estDebutDeBloc(lignes[i])) { paragraphe.push(lignes[i]); i += 1; }
      blocs.push(`<p>${paragraphe.map((x) => enLigne(x, m)).join('<br>')}</p>`);
    }
    return blocs;
  }

  // ---- Peindre -----------------------------------------------------------------------
  const nomModele = (id) => {
    const t = String(id || '');
    if (/sonnet/i.test(t)) return 'Sonnet 5.5';
    if (/haiku/i.test(t)) return 'Haiku 5.5';
    return (MODELES.find((m) => m.id === t) || MODELES[0]).nom;
  };

  // LA RECHERCHE. Pendant la lecture, une seule ligne dit ou l assistant lit et ce qu il cherche, et
  // dessous, un seul dessin, celui des vraies donnees de cette lecture, a une place qui ne bouge pas.
  // Chaque dessin entre une fois, vite, dans l ordre de ses donnees, puis plus rien ne bouge. Quand la
  // reponse commence, la ligne devient le bilan au passe et le texte prend la place du dessin.
  // Ansar, 2026-11-09 : « plus pro plus clean plus serieuse », puis « moins IA, moins dérangeant ».
  // Mouvements et durees : learning/resources/2026-11-09_claude-code-interface.
  const nombreEntier = (n) => Number(n || 0).toLocaleString('fr-BE');
  const mesureDe = (e) => {
    if (!e.lues) return '';
    return e.total && e.total > e.lues ? `${nombreEntier(e.lues)} sur ${nombreEntier(e.total)} lignes` : `${nombreEntier(e.lues)} ${e.lues > 1 ? 'lignes lues' : 'ligne lue'}`;
  };
  const compteLu = (affiche, total) => (total > affiche ? `${nombreEntier(affiche)} sur ${nombreEntier(total)} lignes` : `${nombreEntier(affiche)} ${affiche > 1 ? 'lignes lues' : 'ligne lue'}`);
  function bilanRecherche(m) {
    const lectures = (m.etapes || []).filter((e) => !e.note);
    const noms = [...new Set(lectures.filter((e) => e.cleSource !== 'calcul').map((e) => e.nomSource).filter(Boolean))];
    const calculs = lectures.filter((e) => e.cleSource === 'calcul').length;
    const lues = lectures.reduce((s, e) => s + (Number(e.lues) || 0), 0);
    const duree = lectures.reduce((s, e) => s + (Number(e.duree) || 0), 0);
    const morceaux = [];
    const vus = noms.length > 4 ? [...noms.slice(0, 3), `${noms.length - 3} autres`] : noms;
    if (vus.length) morceaux.push(`Lu dans ${vus.length > 1 ? `${vus.slice(0, -1).join(', ')} et ${vus[vus.length - 1]}` : vus[0]}`);
    else if (!calculs) morceaux.push(`${lectures.length} lecture${lectures.length > 1 ? 's' : ''} de vos données`);
    if (lues) morceaux.push(`${nombreEntier(lues)} ligne${lues > 1 ? 's' : ''}`);
    if (calculs) morceaux.push(`${calculs} calcul${calculs > 1 ? 's' : ''}`);
    if (duree >= 1000) morceaux.push(`${Math.round(duree / 1000)} s`);
    return morceaux.join(', ');
  }

  const TEINTE_SOURCE = { reservations: 1, planning: 2, clients: 4, catalogue: 3, mails: 5, communications: 5, campagnes: 4, notes: 3, demandes: 2, equipe: 1, journal: 3, bilans: 3, meteo: 5, site: 2, concurrents: 4, savoir: 1, calcul: 6 };
  const teinte = (cle) => TEINTE_SOURCE[cle] || 6;
  const scenes = new WeakMap();
  const JOUR_MS = 86400000;
  const isoVersMs = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const msVersIso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const phraseFinie = (p) => { const t = String(p || '').replace(/^(?:Je\s+(?!vous\b|me\b|ne\b|n['’])\S+\s+|J['’]\S+\s+)/i, ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  // LE SEUL SIGNE DE TRAVAIL DE LA PAGE : une goutte de lumiere bleue qui tourne sur elle-meme et
  // respire, sans phrase toute faite. Ansar, 2026-11-10 : « les rond qui tourne pour attednre une
  // reponse trop moche ». Elle remplace le cercle de chargement partout, a trois tailles.
  const SIGNE = '<span class="ast-orbe" aria-hidden="true"><i></i><i></i><i></i></span>';
  // Une lecture reste « en cours » au moins ce temps a l ecran, puis rend son resultat : les lectures
  // lancees ensemble finissent l une apres l autre, dans l ordre, au lieu de toutes d un coup.
  // Le decalage passe deux battements de 60 ms (2026-11-12) : a 110 ms, l ecart rendu tombait parfois a
  // un seul battement, 60 ms, a la limite de ce qui se voit.
  const LECTURE_VUE_MIN = 420;
  const LECTURE_DECALAGE = 130;

  // Le mois en barres : une par jour, a la hauteur de ses vraies reservations. Au-dela de deux mois
  // les jours se regroupent, la periode entiere reste visible.
  function seauxDeLaPeriode(e) {
    const debut = isoVersMs(e.plage.debut);
    const jours = Math.max(1, Math.round((isoVersMs(e.plage.fin) - debut) / JOUR_MS) + 1);
    const pas = Math.ceil(jours / 62);
    const seaux = [];
    for (let i = 0; i < jours; i += pas) {
      let total = 0;
      for (let j = i; j < Math.min(i + pas, jours); j += 1) total += Number((e.jours || {})[msVersIso(debut + j * JOUR_MS)]) || 0;
      seaux.push(total);
    }
    return seaux;
  }
  const jourCourt = (iso) => new Date(isoVersMs(iso)).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  function htmlPeriode(e) {
    const seaux = seauxDeLaPeriode(e);
    const max = Math.max(1, ...seaux);
    return `<div class="lu-dessin" data-lu-dessin aria-hidden="true"><div class="lu-barres">${seaux.map((v, i) => `<i data-o="${((i / Math.max(1, seaux.length - 1)) * 0.92).toFixed(3)}" style="--h:${(v / max).toFixed(3)}"></i>`).join('')}</div><div class="lu-axe"><span>${esc(jourCourt(e.plage.debut))}</span><span>${esc(jourCourt(e.plage.fin))}</span></div></div>`;
  }

  // La journee : les groupes du planning, a leur heure et sur leur piste.
  function htmlJournee(e) {
    const blocs = e.blocs;
    const de = Math.floor(Math.min(...blocs.map((b) => b.debut)));
    const a = Math.ceil(Math.max(...blocs.map((b) => b.fin)));
    const large = Math.max(1, a - de);
    const rangs = Math.max(...blocs.map((b) => Number(b.rang) || 0)) + 1;
    const pose = (b) => `<i data-o="${(((b.debut - de) / large) * 0.92).toFixed(4)}" style="left:${(((b.debut - de) / large) * 100).toFixed(2)}%;width:${(((b.fin - b.debut) / large) * 100).toFixed(2)}%;top:calc(${Number(b.rang) || 0} * 100% / var(--rangs))"></i>`;
    return `<div class="lu-dessin" data-lu-dessin aria-hidden="true"><div class="lu-plan" style="--rangs:${rangs}">${blocs.map(pose).join('')}</div><div class="lu-axe"><span>${de} h</span><span>${Math.round((de + a) / 2)} h</span><span>${a} h</span></div></div>`;
  }

  // ---- UN DESSIN POUR CHAQUE FORME DE DONNEES -----------------------------------------
  // Ansar, 2026-11-09 : « faut vrmmmm que ce soit differente pour chaque [...] parfaitement adapté ».
  // Chaque outil sait quelle table le raconte le mieux, et le dessin se construit sur SES vraies
  // lignes : deux lectures ne se ressemblent pas, parce que leurs donnees ne se ressemblent pas.
  // Chaque piece porte data-o, le moment ou elle arrive (de 0 a 1). La CSS dit comment elle arrive.
  const ordre = (i, n) => (n > 1 ? (i / (n - 1)) * 0.92 : 0).toFixed(3);
  const enNombre = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    return typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  const tableNommee = (s, titre) => (s.sections || []).find((t) => t.titre === titre) || null;
  const lignesDe = (s, titre) => { const t = tableNommee(s, titre); return t ? t.lignes : []; };
  const couper = (t, n) => { const s = String(t == null ? '' : t); return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s; };
  const zone = (classe, contenu, style = '') => `<div class="lu-dessin ${classe}" data-lu-dessin aria-hidden="true"${style ? ` style="${style}"` : ''}>${contenu}</div>`;
  const somme = (lignes, cle) => lignes.reduce((s, l) => s + (enNombre(l[cle]) || 0), 0);
  const JOURS_DANS_L_ORDRE = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const estIso = (t) => /^\d{4}-\d{2}-\d{2}/.test(String(t || ''));

  // Du plus grand au plus petit, chaque ligne a sa couleur et sa barre.
  function fClassement(rangees, type, trier = true) {
    const propres = rangees.map((r) => ({ n: r.n, v: enNombre(r.v) })).filter((r) => r.n && r.v !== null);
    if (!propres.length) return '';
    const liste = (trier ? [...propres].sort((a, b) => b.v - a.v) : propres).slice(0, 5);
    const max = Math.max(1e-9, ...liste.map((r) => Math.abs(r.v)));
    return zone('f-rang', liste.map((r, i) => `<div class="fr-l" data-t="${i + 1}" data-o="${ordre(i, liste.length)}"><span class="fr-n">${esc(couper(r.n, 34))}</span><span class="fr-p"><i style="--v:${(Math.abs(r.v) / max).toFixed(4)}"></i></span><span class="fr-v">${esc(formater(r.v, type))}</span></div>`).join(''));
  }

  // Ce que chacun pese dans le tout : une seule bande, partagee.
  function fParts(rangees, type) {
    const propres = rangees.map((r) => ({ n: r.n, v: enNombre(r.v) })).filter((r) => r.n && r.v > 0);
    const total = propres.reduce((s, r) => s + r.v, 0);
    if (propres.length < 2 || !total) return fClassement(rangees, type);
    const liste = [...propres].sort((a, b) => b.v - a.v).slice(0, 5);
    return zone('f-parts', `<div class="fp-b">${liste.map((r, i) => `<i data-t="${i + 1}" data-o="${ordre(i, liste.length)}" style="--p:${(r.v / total).toFixed(4)}"></i>`).join('')}</div><div class="fp-l">${liste.map((r, i) => `<span data-t="${i + 1}" data-o="${ordre(i, liste.length)}"><u></u>${esc(couper(r.n, 26))} <b>${nombre((r.v / total) * 100, 0)} %</b></span>`).join('')}</div>`);
  }

  // Ceux qui restent a chaque etape.
  function fEntonnoir(etapes) {
    const liste = etapes.map((x) => ({ n: x.n, v: enNombre(x.v) })).filter((x) => x.n && x.v !== null).slice(0, 5);
    if (liste.length < 2 || !liste[0].v) return '';
    return zone('f-ent', liste.map((x, i) => `<div class="fe" data-o="${ordre(i, liste.length)}" style="--v:${Math.min(1, x.v / liste[0].v).toFixed(4)}"><span class="fe-n">${esc(x.n)}</span><span class="fe-p"><i></i></span><b>${esc(nombreEntier(x.v))}</b></div>`).join(''));
  }

  // Cette periode contre la precedente.
  function fComparaison(rangees) {
    const liste = rangees.map((r) => ({ ...r, a: enNombre(r.a), b: enNombre(r.b) })).filter((r) => r.a !== null && r.b !== null).slice(0, 3);
    if (!liste.length) return '';
    return zone('f-aa', liste.map((r, i) => {
      const max = Math.max(1e-9, Math.abs(r.a), Math.abs(r.b));
      return `<div class="faa" data-o="${ordre(i, liste.length)}"><span class="faa-n">${esc(r.n)}</span><span class="faa-b"><i style="--v:${(Math.abs(r.a) / max).toFixed(4)}"></i><u style="--v:${(Math.abs(r.b) / max).toFixed(4)}"></u></span><span class="faa-v"><b>${esc(formater(r.a, r.type))}</b><small>${esc(formater(r.b, r.type))}</small></span></div>`;
    }).join(''));
  }

  // Quelques chiffres, cote a cote.
  function fChiffres(rangees) {
    const liste = rangees.filter((r) => enNombre(r.v) !== null).slice(0, 4);
    if (!liste.length) return '';
    return zone('f-chiffres', liste.map((r, i) => `<div data-o="${ordre(i, liste.length)}"><b>${esc(formater(enNombre(r.v), r.type))}</b><span>${esc(couper(r.n, 22))}</span></div>`).join(''));
  }

  // La semaine type : les jours en lignes, les heures en colonnes, plus c est fonce plus c est plein.
  function fSemaineType(lignes) {
    const cases = lignes.filter((l) => JOURS_DANS_L_ORDRE.includes(l.jour) && Number.isFinite(Number(l.heure)));
    if (cases.length < 3) return '';
    const heures = cases.map((l) => Number(l.heure));
    const de = Math.min(...heures);
    const colonnes = Math.max(...heures) - de + 1;
    const mesure = (l) => enNombre(l.remplissage_pistes_pct) ?? enNombre(l.groupes) ?? 0;
    const max = Math.max(1, ...cases.map(mesure));
    const lire = new Map(cases.map((l) => [`${l.jour}-${l.heure}`, mesure(l) / max]));
    const rangs = JOURS_DANS_L_ORDRE.map((j) => `<div class="fg-l"><span>${j[0].toUpperCase()}</span>${Array.from({ length: colonnes }, (_, c) => `<i data-o="${ordre(c, colonnes)}" style="--n:${(lire.get(`${j}-${de + c}`) || 0).toFixed(3)}"></i>`).join('')}</div>`).join('');
    return zone('f-grille', `${rangs}<div class="fg-axe"><span>${de} h</span><span>${de + colonnes} h</span></div>`, `--h:${colonnes}`);
  }

  // Les heures d ouverture de chaque jour, a leur vraie place dans la journee.
  function fHoraires(table) {
    if (!table) return '';
    const heureDe = (t) => { const m = /(\d{1,2})[:h](\d{2})?/.exec(t || ''); return m ? Number(m[1]) + (Number(m[2]) || 0) / 60 : null; };
    const jours = JOURS_DANS_L_ORDRE.map((j) => {
      const l = table.lignes.find((x) => String(x.jour).toLowerCase() === j);
      if (!l) return null;
      const [ouvre, ferme] = String(l.ouvert || '').split(/\s+à\s+/);
      const de = heureDe(ouvre);
      let a = heureDe(ferme);
      if (de !== null && a !== null && a <= de) a += 24;
      return { j, texte: l.ouvert, de, a };
    }).filter(Boolean);
    const ouverts = jours.filter((x) => x.de !== null && x.a !== null);
    if (!ouverts.length) return '';
    const min = Math.floor(Math.min(...ouverts.map((x) => x.de)));
    const large = Math.max(1, Math.ceil(Math.max(...ouverts.map((x) => x.a))) - min);
    return zone('f-semaine', jours.map((x, i) => `<div class="fs-l${x.de === null ? ' est-ferme' : ''}" data-o="${ordre(i, jours.length)}"><span>${esc(x.j.slice(0, 3))}.</span><span class="fs-t">${x.de === null ? '' : `<i style="left:${(((x.de - min) / large) * 100).toFixed(2)}%;width:${(((x.a - x.de) / large) * 100).toFixed(2)}%"></i>`}</span><small>${esc(couper(x.texte, 16))}</small></div>`).join(''));
  }

  // Tous les prix sur une meme regle, du moins cher au plus cher.
  function fPrix(rangees) {
    const liste = rangees.map((r) => ({ n: r.n, v: enNombre(r.v) })).filter((r) => r.n && r.v > 0).sort((a, b) => a.v - b.v);
    if (liste.length < 2) return '';
    const min = liste[0].v;
    const max = liste[liste.length - 1].v;
    const large = Math.max(1e-9, max - min);
    return zone('f-prix', `<div class="fx-e">${liste.map((r, i) => `<i data-o="${ordre(i, liste.length)}" style="left:${(((r.v - min) / large) * 100).toFixed(2)}%"></i>`).join('')}</div><div class="lu-axe"><span>${esc(couper(liste[0].n, 26))}, ${esc(formater(min, 'euro'))}</span><span>${esc(couper(liste[liste.length - 1].n, 26))}, ${esc(formater(max, 'euro'))}</span></div>`);
  }

  // Les notes des concurrents sur une echelle qui finit a 5.
  function fNotes(lignes) {
    const liste = lignes.map((l) => ({ n: l.nom, v: enNombre(l.note_google) })).filter((l) => l.n && l.v !== null).sort((a, b) => b.v - a.v).slice(0, 5);
    if (!liste.length) return '';
    const bas = Math.min(3, Math.floor(Math.min(...liste.map((x) => x.v))));
    return zone('f-rang f-notes', liste.map((x, i) => `<div class="fr-l" data-t="${i + 1}" data-o="${ordre(i, liste.length)}"><span class="fr-n">${esc(couper(x.n, 30))}</span><span class="fr-p"><u style="--v:${((x.v - bas) / (5 - bas)).toFixed(4)}"></u></span><span class="fr-v">${esc(x.v.toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))}</span></div>`).join(''));
  }

  // Le calcul se pose terme a terme, le resultat en dernier.
  function fCalcul(s) {
    const detail = String(s.detail || '').trim();
    if (!detail.includes('=')) return '';
    const morceaux = detail.split(/\s+/);
    return zone('f-calcul', morceaux.map((m, i) => `<span data-o="${ordre(i, morceaux.length)}"${i === morceaux.length - 1 ? ' class="est-res"' : ''}>${esc(m)}</span>`).join(' '));
  }

  // Un echange de mails : ce qu on a recu a gauche, ce qu on a envoye a droite.
  function fConversation(lignes) {
    const liste = lignes.slice(-4);
    if (!liste.length) return '';
    return zone('f-conv sans-fil', liste.map((l, i) => `<p class="${/envoy/i.test(l.sens) ? 'est-envoye' : 'est-recu'}" data-o="${ordre(i, liste.length)}">${esc(couper(l.texte, 120))}</p>`).join(''));
  }

  const etiquetteTemps = (v) => {
    const t = String(v);
    if (/^\d{4}-\d{2}$/.test(t)) return new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, 1)).toLocaleDateString('fr-BE', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return estIso(t) ? jourCourt(t.slice(0, 10)) : t;
  };

  // Une evolution dans le temps, mois apres mois ou semaine apres semaine.
  function fEvolution(lignes, cle, mesure) {
    const liste = lignes.filter((l) => enNombre(l[mesure]) !== null).slice(-62);
    if (liste.length < 2) return '';
    const max = Math.max(1e-9, ...liste.map((l) => Math.abs(enNombre(l[mesure]))));
    return zone('f-evolution', `<div class="lu-barres">${liste.map((l, i) => `<i data-o="${ordre(i, liste.length)}" style="--h:${(Math.abs(enNombre(l[mesure])) / max).toFixed(3)}"></i>`).join('')}</div><div class="lu-axe"><span>${esc(etiquetteTemps(liste[0][cle]))}</span><span>${esc(etiquetteTemps(liste[liste.length - 1][cle]))}</span></div>`);
  }

  // Des evenements a leur date : plus il y en a le meme jour, plus le trait monte.
  function fFrise(dates) {
    const jours = dates.filter(estIso).map((d) => String(d).slice(0, 10)).sort();
    if (jours.length < 2) return '';
    const debut = isoVersMs(jours[0]);
    const large = Math.max(JOUR_MS, isoVersMs(jours[jours.length - 1]) - debut);
    const parJour = new Map();
    jours.forEach((d) => parJour.set(d, (parJour.get(d) || 0) + 1));
    const max = Math.max(...parJour.values());
    const points = [...parJour.entries()];
    return zone('f-frise', `<div class="ff-e">${points.map(([d, n], i) => `<i data-o="${ordre(i, points.length)}" style="left:${(((isoVersMs(d) - debut) / large) * 100).toFixed(2)}%;--n:${(n / max).toFixed(3)}"></i>`).join('')}</div><div class="lu-axe"><span>${esc(jourCourt(jours[0]))}</span><span>${esc(jourCourt(jours[jours.length - 1]))}</span></div>`);
  }

  // Un ordre naturel (les jours, les heures, la taille des groupes) : des colonnes, dans cet ordre-la.
  function fColonnes(rangees, type) {
    const liste = rangees.map((r) => ({ n: r.n, v: enNombre(r.v) })).filter((r) => r.n != null && r.v !== null).slice(0, 24);
    if (liste.length < 2) return '';
    const max = Math.max(1e-9, ...liste.map((r) => Math.abs(r.v)));
    const sommet = liste.reduce((g, r, i) => (r.v > liste[g].v ? i : g), 0);
    return zone(`f-col${liste.length > 8 ? ' est-serre' : ''}`, liste.map((r, i) => `<div class="fc${i === sommet ? ' est-sommet' : ''}" data-o="${ordre(i, liste.length)}"><b>${esc(formater(r.v, type))}</b><i style="--h:${(Math.abs(r.v) / max).toFixed(3)}"></i><span>${esc(couper(r.n, 18))}</span></div>`).join(''), `--n:${liste.length}`);
  }

  // Deux axes croises : une ligne par valeur du premier, une colonne par valeur du second, et une vague en diagonale.
  function fMatrice(s, axeL, axeC, mesure) {
    const valeursDe = (cle) => {
      const v = [...new Set(s.lignes.map((l) => String(l[cle])))];
      if (cle === 'jour_semaine') return v.sort((a, b) => JOURS_DANS_L_ORDRE.indexOf(a) - JOURS_DANS_L_ORDRE.indexOf(b));
      if (cle === 'heure') return v.sort((a, b) => Number(a) - Number(b));
      return v;
    };
    const rangs = valeursDe(axeL.cle);
    const cols = valeursDe(axeC.cle);
    if (rangs.length < 2 || cols.length < 2 || rangs.length > 8 || cols.length > 14) return '';
    const lire = new Map(s.lignes.map((l) => [`${l[axeL.cle]}|${l[axeC.cle]}`, enNombre(l[mesure.cle]) || 0]));
    const max = Math.max(1e-9, ...lire.values());
    const vague = rangs.length + cols.length - 1;
    const etiquette = (v) => (axeL.cle === 'jour_semaine' ? v[0].toUpperCase() : couper(v, 14));
    const tete = cols.length <= 8 ? `<div class="fm-l"><span></span>${cols.map((c) => `<small>${esc(couper(axeC.cle === 'heure' ? `${c} h` : c, 9))}</small>`).join('')}</div>` : '';
    const corps = rangs.map((r, i) => `<div class="fm-l"><span>${esc(etiquette(r))}</span>${cols.map((c, j) => `<i data-o="${ordre(i + j, vague)}" style="--n:${((lire.get(`${r}|${c}`) || 0) / max).toFixed(3)}"></i>`).join('')}</div>`).join('');
    const pied = cols.length > 8 ? `<div class="lu-axe"><span>${esc(cols[0])}</span><span>${esc(cols[cols.length - 1])}</span></div>` : '';
    return zone('f-matrice', `${tete}${corps}${pied}`, `--h:${cols.length};--g:${axeL.cle === 'jour_semaine' ? 16 : 96}px`);
  }

  // Deux centres face a face : chaque barre part du milieu et va vers son camp.
  function fDuel(lignes) {
    const [a, b] = lignes;
    const mesures = [['Réservations', 'reservations', 'entier'], ['Joueurs', 'joueurs', 'entier'], ['Chiffre', 'chiffre', 'euro'], ['Panier moyen', 'panier_moyen', 'euro']]
      .filter(([, c]) => enNombre(a[c]) !== null && enNombre(b[c]) !== null);
    if (!mesures.length) return '';
    const nom = (x) => String(x.centre || '').replace(/^Fun Galaxy\s+/i, '');
    const rangs = mesures.map(([n, c, t], i) => {
      const x = enNombre(a[c]);
      const y = enNombre(b[c]);
      const max = Math.max(1e-9, Math.abs(x), Math.abs(y));
      return `<div class="fd" data-o="${ordre(i, mesures.length)}"><b>${esc(formater(x, t))}</b><span class="fd-g" data-t="1"><i style="--v:${(Math.abs(x) / max).toFixed(4)}"></i></span><span class="fd-n">${esc(n)}</span><span class="fd-d" data-t="2"><i style="--v:${(Math.abs(y) / max).toFixed(4)}"></i></span><b>${esc(formater(y, t))}</b></div>`;
    }).join('');
    return zone('f-duel', `<div class="fd-noms"><span data-t="1"><u></u>${esc(couper(nom(a), 24))}</span><span data-t="2">${esc(couper(nom(b), 24))}<u></u></span></div>${rangs}`);
  }

  // Combien de reservations prennent ce supplement : un anneau qui se remplit.
  function fAnneaux(lignes) {
    const liste = lignes.map((l) => ({ n: l.article, p: enNombre(l.part_reservations) })).filter((x) => x.n && x.p !== null).sort((a, b) => b.p - a.p).slice(0, 4);
    if (!liste.length) return '';
    return zone('f-ann', liste.map((x, i) => `<div data-t="${i + 1}" data-o="${ordre(i, liste.length)}"><svg viewBox="0 0 36 36"><circle class="fa-f" cx="18" cy="18" r="15.9"></circle><circle class="fa-v" cx="18" cy="18" r="15.9" pathLength="100" style="--p:${Math.min(100, Math.max(0, x.p)).toFixed(1)}"></circle></svg><b>${esc(nombre(x.p, 0))} %</b><span>${esc(couper(x.n, 20))}</span></div>`).join(''));
  }

  // Les activites prises ensemble : elles s accrochent l une a l autre, chacune garde sa couleur.
  function fChaine(lignes) {
    const liste = lignes.map((l) => ({ morceaux: String(l.combinaison || '').split(/\s*\+\s*/).filter(Boolean), v: enNombre(l.reservations) })).filter((x) => x.morceaux.length && x.v !== null).sort((a, b) => b.v - a.v).slice(0, 4);
    if (!liste.length) return '';
    const total = liste.reduce((s, x) => s + x.morceaux.length, 0);
    let rang = -1;
    const couleurs = new Map();
    const couleurDe = (m) => { if (!couleurs.has(m)) couleurs.set(m, (couleurs.size % 6) + 1); return couleurs.get(m); };
    const piece = () => { rang += 1; return ordre(rang, total); };
    return zone('f-chaine', liste.map((x) => `<div class="fch">${x.morceaux.map((m, j) => `${j ? '<em>+</em>' : ''}<span data-t="${couleurDe(m)}" data-o="${piece()}">${esc(couper(m, 22))}</span>`).join('')}<b>${esc(nombreEntier(x.v))}</b></div>`).join(''));
  }

  // Les membres de l equipe : un rond par personne, plus ou moins entoure selon ce qu elle a fait.
  function fVisages(lignes) {
    const liste = lignes.map((l) => ({ n: l.nom, a: enNombre(l.actions) })).filter((x) => x.n && x.a !== null).sort((a, b) => b.a - a.a).slice(0, 6);
    if (!liste.length) return '';
    const max = Math.max(1, ...liste.map((x) => x.a));
    const initiales = (t) => String(t).trim().split(/\s+/).filter((m) => /^\p{L}/u.test(m)).slice(0, 2).map((m) => m[0]).join('').toUpperCase();
    return zone('f-vis', liste.map((x, i) => `<div class="fv" data-t="${i + 1}" data-o="${ordre(i, liste.length)}" style="--v:${(x.a / max).toFixed(3)}"><u>${esc(initiales(x.n))}</u><b>${esc(nombreEntier(x.a))}</b><span>${esc(couper(x.n, 16))}</span></div>`).join(''));
  }

  // Les messages envoyes, et dedans, ceux qui ont ete ouverts.
  function fCouches(lignes) {
    const liste = lignes.map((l) => ({ n: l.modele, e: enNombre(l.envoyes), o: enNombre(l.ouverts) || 0 })).filter((x) => x.n && x.e > 0).sort((a, b) => b.e - a.e).slice(0, 4);
    if (!liste.length) return '';
    const max = Math.max(...liste.map((x) => x.e));
    return zone('f-couche', liste.map((x, i) => `<div class="fk" data-o="${ordre(i, liste.length)}"><span class="fk-n">${esc(couper(x.n, 26))}</span><span class="fk-p" style="--e:${(x.e / max).toFixed(4)};--o:${Math.min(1, x.o / x.e).toFixed(4)}"><u></u><i></i></span><b>${esc(nombreEntier(x.o))} ouverts sur ${esc(nombreEntier(x.e))}</b></div>`).join(''));
  }

  // Des textes reels (mails, notes, idees) : des cartes qui s empilent.
  function fCartes(rangees) {
    const liste = rangees.filter((r) => r.titre).slice(0, 3);
    if (!liste.length) return '';
    return zone('f-cartes sans-fil', liste.map((r, i) => `<div class="fb" data-o="${ordre(i, liste.length)}"><p>${esc(couper(r.titre, 110))}</p>${r.droite ? `<span>${esc(r.droite)}</span>` : ''}</div>`).join(''));
  }

  // Les grandes demandes a leur date : la bulle a la taille du groupe.
  function fBulles(points) {
    const liste = points.map((p) => ({ d: String(p.d || '').slice(0, 10), v: enNombre(p.v) })).filter((p) => estIso(p.d) && p.v > 0).sort((a, b) => (a.d < b.d ? -1 : 1)).slice(0, 20);
    if (!liste.length) return '';
    const debut = isoVersMs(liste[0].d);
    const large = Math.max(1, isoVersMs(liste[liste.length - 1].d) - debut);
    const max = Math.max(...liste.map((x) => x.v));
    const seule = liste.length === 1;
    const bulles = liste.map((x, i) => `<i data-o="${ordre(i, liste.length)}" style="left:${seule ? 50 : (((isoVersMs(x.d) - debut) / large) * 100).toFixed(2)}%;--t:${(8 + 24 * Math.sqrt(x.v / max)).toFixed(1)}px"></i>`).join('');
    return zone('f-bulles', `<div class="fo-e">${bulles}</div><div class="lu-axe"><span>${esc(jourCourt(liste[0].d))}</span><span>${esc(seule ? `${nombreEntier(liste[0].v)} personnes` : jourCourt(liste[liste.length - 1].d))}</span></div>`);
  }

  // Les visites d un client : venu, annule, pas venu ou a venir, chacun se reconnait.
  function fVisites(lignes) {
    const genre = (s) => (/annul/i.test(s) ? 'annule' : /pas venu|absent/i.test(s) ? 'absent' : /venir/i.test(s) ? 'futur' : 'venu');
    const liste = lignes.filter((l) => estIso(l.date)).map((l) => ({ d: String(l.date).slice(0, 10), g: genre(l.statut) })).sort((a, b) => (a.d < b.d ? -1 : 1));
    if (liste.length < 2) return '';
    const debut = isoVersMs(liste[0].d);
    const large = Math.max(1, isoVersMs(liste[liste.length - 1].d) - debut);
    const legende = [['venu', 'venue', 'venues'], ['futur', 'à venir', 'à venir'], ['annule', 'annulée', 'annulées'], ['absent', 'absence', 'absences']]
      .map(([g, un, plusieurs]) => { const n = liste.filter((x) => x.g === g).length; return n ? `<span data-s="${g}"><u></u>${n} ${n > 1 ? plusieurs : un}</span>` : ''; }).join('');
    return zone('f-visites', `<div class="fi-e">${liste.map((x, i) => `<i data-s="${x.g}" data-o="${ordre(i, liste.length)}" style="left:${(((isoVersMs(x.d) - debut) / large) * 100).toFixed(2)}%"></i>`).join('')}</div><div class="fi-l">${legende}</div><div class="lu-axe"><span>${esc(jourCourt(liste[0].d))}</span><span>${esc(jourCourt(liste[liste.length - 1].d))}</span></div>`);
  }

  // Les quatorze prochains jours : la lettre du jour, le monde attendu, un point s il pleut.
  function fPrevision(lignes) {
    const liste = lignes.filter((l) => estIso(l.date)).slice(0, 14);
    if (liste.length < 2 || !liste.some((l) => enNombre(l.attendus) > 0)) return '';
    const max = Math.max(1, ...liste.map((l) => enNombre(l.attendus) || 0));
    const lettre = (iso) => 'DLMMJVS'[new Date(isoVersMs(iso)).getUTCDay()];
    return zone('f-col f-prev est-serre', liste.map((l, i) => `<div class="fc${l.niveau === 'fort' ? ' est-fort' : (/creux|calme/.test(l.niveau) ? ' est-creux' : '')}${(enNombre(l.pluie_mm) || 0) >= 1 ? ' a-pluie' : ''}${l.raisons ? ' a-raison' : ''}" data-o="${ordre(i, liste.length)}"><b></b><i style="--h:${((enNombre(l.attendus) || 0) / max).toFixed(3)}"></i><span>${esc(lettre(l.date))}</span></div>`).join(''), `--n:${liste.length}`);
  }

  // Le monde jour par jour, et la temperature qui se trace par-dessus.
  function fMeteo(lignes) {
    const liste = lignes.filter((l) => estIso(l.date)).slice(-62);
    if (liste.length < 2) return '';
    const max = Math.max(1, ...liste.map((l) => enNombre(l.visiteurs) || 0));
    const temperatures = liste.map((l) => enNombre(l.temperature));
    const connues = temperatures.filter((t) => t !== null);
    let courbe = '';
    if (connues.length >= 2) {
      const bas = Math.min(...connues);
      const ecart = Math.max(1, Math.max(...connues) - bas);
      const points = temperatures.map((t, i) => (t === null ? '' : `${(((i + 0.5) / liste.length) * 100).toFixed(2)},${(32 - ((t - bas) / ecart) * 28).toFixed(2)}`)).filter(Boolean).join(' ');
      courbe = `<svg class="fm-c" data-o="0.04" viewBox="0 0 100 34" preserveAspectRatio="none"><polyline points="${points}"></polyline></svg>`;
    }
    return zone('f-meteo', `<div class="fm-z"><div class="lu-barres">${liste.map((l, i) => `<i data-o="${ordre(i, liste.length)}" style="--h:${((enNombre(l.visiteurs) || 0) / max).toFixed(3)}"${(enNombre(l.pluie_mm) || 0) >= 1 ? ' class="a-pluie"' : ''}></i>`).join('')}</div>${courbe}</div><div class="lu-axe"><span>${esc(jourCourt(String(liste[0].date).slice(0, 10)))}</span><span>${esc(jourCourt(String(liste[liste.length - 1].date).slice(0, 10)))}</span></div>`);
  }

  function dessinBilan(s) {
    const voulues = s.lignes.filter((l) => /^(réservations|joueurs|chiffre)/i.test(String(l.nom)));
    const base = (voulues.length ? voulues : s.lignes).filter((l) => enNombre(l.periode) !== null);
    const avecAvant = base.filter((l) => enNombre(l.avant));
    if (avecAvant.length) return fComparaison(avecAvant.map((l) => ({ n: l.nom, a: l.periode, b: l.avant, type: l.type })));
    return fChiffres(base.map((l) => ({ n: l.nom, v: l.periode, type: l.type })));
  }

  function dessinCroise(s) {
    const [axe, second] = s.colonnes;
    const mesure = s.colonnes.find((c) => ['entier', 'euro', 'dec', 'pct'].includes(c.type));
    if (!axe || !mesure) return '';
    const deuxAxes = second && second !== mesure && second.type === 'texte';
    if (deuxAxes) {
      const croise = fMatrice(s, axe, second, mesure);
      if (croise) return croise;
      return fClassement(s.lignes.map((l) => ({ n: `${l[axe.cle]}, ${l[second.cle]}`, v: l[mesure.cle] })), mesure.type);
    }
    if (/^(jour|semaine|mois|annee)$/.test(axe.cle)) return fEvolution(s.lignes, axe.cle, mesure.cle);
    const rangees = s.lignes.map((l) => ({ n: l[axe.cle], v: l[mesure.cle] }));
    if (axe.cle === 'jour_semaine') return fColonnes([...rangees].sort((a, b) => JOURS_DANS_L_ORDRE.indexOf(a.n) - JOURS_DANS_L_ORDRE.indexOf(b.n)).map((r) => ({ n: `${String(r.n).slice(0, 3)}.`, v: r.v })), mesure.type);
    if (axe.cle === 'heure') return fColonnes(rangees.filter((r) => Number.isFinite(Number(r.n))).sort((a, b) => Number(a.n) - Number(b.n)).map((r) => ({ n: `${r.n} h`, v: r.v })), mesure.type);
    if (axe.cle === 'taille_groupe' || axe.cle === 'delai_reservation') return fColonnes(rangees, mesure.type);
    return rangees.length <= 5 ? fParts(rangees, mesure.type) : fClassement(rangees, mesure.type);
  }

  const DESSINS = {
    creneaux: (s) => fSemaineType(s.lignes),
    croiser_reservations: dessinCroise,
    chiffres_periode: dessinBilan,
    provenance_et_site: (s) => {
      const sources = s.lignes.map((l) => ({ n: l.source, v: l.reservations }));
      if (sources.filter((r) => enNombre(r.v) > 0).length >= 2) return fParts(sources, 'entier');
      const total = lignesDe(s, 'Entonnoir total');
      const valeur = (t) => (total.find((l) => l.ligne === t) || {}).valeur;
      return fEntonnoir(['Créneaux retenus', 'Confirmés'].map((n) => ({ n, v: valeur(n) }))) || fClassement(sources, 'entier');
    },
    catalogue_et_tarifs: (s) => fPrix(lignesDe(s, 'Formules').map((l) => ({ n: l.nom, v: l.prix }))),
    fiche_centre: (s) => fHoraires(tableNommee(s, 'Horaires')),
    horaires_et_fermetures: (s) => fHoraires(tableNommee(s, 'Horaires')),
    clients: (s) => fParts(lignesDe(s, 'Repartition des visites').map((l) => ({ n: l.ligne, v: l.valeur })), 'entier'),
    fiche_client: (s) => fVisites(s.lignes),
    comparer_centres: (s) => { if (s.lignes.length === 2) { const duel = fDuel(s.lignes); if (duel) return duel; } const argent = s.lignes.some((l) => enNombre(l.chiffre) !== null); return fClassement(s.lignes.map((l) => ({ n: l.centre, v: argent ? l.chiffre : l.reservations })), argent ? 'euro' : 'entier'); },
    supplements: (s) => fAnneaux(s.lignes) || fClassement(s.lignes.map((l) => ({ n: l.article, v: l.reservations })), 'entier'),
    combinaisons_activites: (s) => fChaine(s.lignes),
    offres_et_ventes_additionnelles: (s) => fEntonnoir([['Vues', 'vues'], ['Ajoutées', 'ajouts'], ['Acceptées', 'acceptees'], ['Réservées', 'reservees']].map(([n, c]) => ({ n, v: somme(s.lignes, c) }))),
    campagnes: (s) => fEntonnoir([['Destinataires', 'destinataires'], ['Envoyés', 'envoyes'], ['Ouvertures', 'ouvertures'], ['Clics', 'clics']].map(([n, c]) => ({ n, v: somme(s.lignes, c) }))),
    communications_envoyees: (s) => fCouches(lignesDe(s, 'Par modèle')),
    mails_clients: (s) => fCartes(s.lignes.map((l) => ({ titre: l.objet, droite: `${nombreEntier(l.messages)} message${Number(l.messages) > 1 ? 's' : ''}` }))),
    lire_fil_mail: (s) => fConversation(s.lignes),
    equipe_et_activite: (s) => fVisages(s.lignes),
    journal_du_centre: (s) => fFrise(s.lignes.map((l) => l.quand)),
    notes_equipe: (s) => fCartes(s.lignes.map((l) => ({ titre: l.note, droite: estIso(l.date) ? jourCourt(String(l.date).slice(0, 10)) : '' }))),
    demandes_sur_mesure: (s) => fBulles(s.lignes.map((l) => ({ d: l.date_souhaitee, v: l.personnes }))),
    marketing_passe: (s) => fCartes(s.lignes.map((l) => ({ titre: l.idee, droite: l.canal }))) || fClassement(lignesDe(s, 'Campagnes').map((l) => ({ n: l.nom, v: l.envoyes })), 'entier'),
    concurrents_et_avis: (s) => fNotes(s.lignes),
    prevision_et_plan: (s) => fPrevision(s.lignes),
    meteo_et_calendrier: (s) => fMeteo(s.lignes),
    planning_du_jour: (s) => fColonnes(lignesDe(s, 'Occupation par heure').map((l) => ({ n: `${l.heure} h`, v: l.joueurs })), 'entier'),
    // Du texte relu : les vraies lignes qui passent le disent mieux qu un dessin.
    savoir_du_centre: () => '',
    bilans_direction: () => '',
    calculer: fCalcul,
  };

  // Un outil qui n est pas dans la liste a quand meme son dessin, tire de sa premiere table utile.
  function dessinGenerique(s) {
    for (const t of [{ colonnes: s.colonnes, lignes: s.lignes }, ...(s.sections || [])]) {
      const texte = t.colonnes.find((c) => c.type === 'texte');
      const chiffre = t.colonnes.find((c) => ['entier', 'euro', 'dec', 'pct'].includes(c.type));
      if (!texte || !chiffre || t.lignes.length < 2) continue;
      const noms = t.lignes.map((l) => l[texte.cle]);
      const valeurs = t.lignes.map((l) => enNombre(l[chiffre.cle]));
      // Des libelles qui se repetent ou des valeurs toutes egales ne racontent rien.
      if (new Set(noms).size === noms.length && new Set(valeurs).size > 1) return fClassement(t.lignes.map((l) => ({ n: l[texte.cle], v: l[chiffre.cle] })), chiffre.type);
    }
    return '';
  }

  const aUneJournee = (e) => e.cleSource === 'planning' && Array.isArray(e.blocs) && e.blocs.length > 0;
  function htmlDessin(e, source) {
    let html = '';
    if (source && !aUneJournee(e) && source.outil !== 'lister_reservations') {
      try { html = (DESSINS[source.outil] ? DESSINS[source.outil](source) : dessinGenerique(source)) || ''; } catch (erreur) { html = ''; }
    }
    if (html) return html;
    if (aUneJournee(e)) return htmlJournee(e);
    return e.plage ? htmlPeriode(e) : '';
  }

  // ---- LA PUCE D UNE LECTURE -------------------------------------------------------
  // Ansar, 2026-11-10 : « les animations la pour chaque recherche cest tout le temps les meme et
  // elles sont super cheap [...] surtout que ça change danimation c terrible [...] surtout le scan ».
  // La boite grise ou les dessins se remplacaient toutes les secondes et demie n existe plus. Chaque
  // lecture garde sa ligne, et au bout de la ligne un tout petit dessin fait de SES nombres : une
  // courbe pour une suite de dates, des barres pour une semaine ou un classement, une barre en parts
  // pour une repartition, des points pour une liste. Deux lectures ne se ressemblent que si leurs
  // donnees se ressemblent. Aucun texte dans la puce, donc aucun nom.
  const PUCE_BARRES = 14;
  const PUCE_POINTS = 28;
  function serieDeSource(s) {
    const tables = [...(s.sections || []), { colonnes: s.colonnes || [], lignes: s.lignes || [] }];
    for (const t of tables) {
      const lignes = t.lignes || [];
      const colonnes = t.colonnes || [];
      if (lignes.length < 2) continue;
      const cles = colonnes.map((c) => c.cle);
      // Une fiche « ligne, valeur » range cote a cote des nombres sans rapport : pas de dessin.
      if (cles.includes('ligne') && cles.includes('valeur')) continue;
      const numeriques = colonnes.filter((c) => !['texte', 'client', 'source'].includes(c.type) && lignes.filter((l) => typeof l[c.cle] === 'number').length >= 2);
      if (!numeriques.length) continue;
      const mesure = numeriques.find((c) => /^(reservations|groupes|joueurs|visites|clients|nombre|n|chiffre)$/.test(c.cle)) || numeriques[0];
      const nom = colonnes.find((c) => lignes.every((l) => typeof l[c.cle] === 'string' && l[c.cle]));
      return { noms: lignes.map((l) => (nom ? String(l[nom.cle]) : '')), valeurs: lignes.map((l) => Math.max(0, enNombre(l[mesure.cle]) || 0)) };
    }
    return null;
  }
  // Trop de valeurs pour la place : on les regroupe par paquets voisins, l allure reste.
  function resserrer(valeurs, max) {
    if (valeurs.length <= max) return valeurs;
    const pas = valeurs.length / max;
    return Array.from({ length: max }, (_, i) => { const lot = valeurs.slice(Math.floor(i * pas), Math.max(Math.floor(i * pas) + 1, Math.floor((i + 1) * pas))); return lot.reduce((a, b) => a + b, 0) / lot.length; });
  }
  function puceDe(s) {
    if (!s || s.outil === 'calculer') return '';
    const serie = serieDeSource(s);
    if (!serie) {
      const n = Math.min(10, (s.lignes || []).length);
      return n >= 2 ? `<span class="lu-puce est-points" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</span>` : '';
    }
    const { noms } = serie;
    let { valeurs } = serie;
    if (!valeurs.some((v) => v > 0)) return '';
    const dans = (v, max) => (max > 0 ? v / max : 0).toFixed(3);
    const temps = noms.every((n) => estIso(n) || /^\d{4}-\d{2}$/.test(n) || /^\d{1,2}\s?[:h]/.test(n));
    const semaine = noms.every((n) => JOURS_DANS_L_ORDRE.includes(n.toLowerCase()));
    if (temps && valeurs.length >= 8) {
      const v = resserrer(valeurs, PUCE_POINTS);
      const max = Math.max(...v);
      const x = (i) => ((i / (v.length - 1)) * 56).toFixed(1);
      const y = (val) => (15 - (max > 0 ? val / max : 0) * 13).toFixed(1);
      const trait = v.map((val, i) => `${i ? 'L' : 'M'}${x(i)} ${y(val)}`).join(' ');
      return `<svg class="lu-puce est-courbe" viewBox="0 0 56 16" width="56" height="16" aria-hidden="true"><path class="lu-puce-aire" d="${trait} L56 16 L0 16 Z"/><path class="lu-puce-trait" d="${trait}" pathLength="100"/></svg>`;
    }
    if (semaine) {
      const parJour = new Map(noms.map((n, i) => [n.toLowerCase(), valeurs[i]]));
      valeurs = JOURS_DANS_L_ORDRE.map((j) => parJour.get(j) || 0);
    } else if (!temps) valeurs = [...valeurs].sort((a, b) => b - a);
    if (!temps && !semaine && valeurs.length <= 6) {
      const total = valeurs.reduce((a, b) => a + b, 0);
      return `<span class="lu-puce est-parts" aria-hidden="true">${valeurs.filter((v) => v > 0).slice(0, 6).map((v, i) => `<i style="--p:${dans(v, total)};--i:${i}"></i>`).join('')}</span>`;
    }
    const v = resserrer(valeurs, PUCE_BARRES);
    const max = Math.max(...v);
    return `<span class="lu-puce est-barres" aria-hidden="true">${v.map((val, i) => `<i style="--h:${dans(val, max)};--i:${i}"></i>`).join('')}</span>`;
  }

  // Ce qui a deja ete lu plus tot dans la conversation et vient d etre refait en silence par le
  // serveur : une phrase, pas de recherche rejouee. Ansar, 2026-11-10 : « quand c deja analysé pas
  // besoin de reanalysé sauf si ya eu changement ».
  const enListe = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}` : noms[0] || '');
  function htmlRepris(m) {
    // Seulement une fois la reponse finie, et seulement pour ce qu elle cite : un bonjour ou une
    // question sur l assistant n annonce aucune lecture, meme reprise.
    if (m.statut === 'cours') return '';
    const cites = new Set((String(m.texte || '').match(/\[S\d+\]/g) || []).map((c) => c.slice(1, -1)));
    const repris = (m.repris || []).filter((r) => cites.has(r.source));
    if (!repris.length) return '';
    const noms = [...new Set(repris.map((r) => r.nomSource).filter(Boolean))];
    const bouges = [...new Set(repris.filter((r) => r.change === true).map((r) => r.nomSource).filter(Boolean))];
    const connus = repris.every((r) => r.change === true || r.change === false);
    const suite = bouges.length ? ` ${enListe(bouges)} ${bouges.length > 1 ? 'ont' : 'a'} changé depuis, je prends les nouveaux chiffres.` : (connus ? " Rien n'a changé depuis." : '');
    return `<p class="ast-repris" data-ast-repris><i class="lu-point" aria-hidden="true"></i><span>Je repars de ce que j'ai déjà lu dans ${esc(enListe(noms) || 'vos données')}.${esc(suite)}</span></p>`;
  }

  // Une lecture relue apres coup : sa ligne, et dessous son dessin, ses lignes et le lien vers sa donnee.
  function htmlLigneEtape(e, ouverte, m) {
    if (e.note) return `<li class="lu is-note"><p>${esc(e.libelle)}</p></li>`;
    const etat = e.etat || 'fini';
    const source = e.source ? (m.sources || []).find((s) => s.id === e.source) : null;
    const lien = source && source.lien && PAGES[source.lien.page];
    const lignes = (e.extraits || []).slice(-8).map((x) => `<p><time>${esc(x.t)}</time><span>${esc(x.d)}</span></p>`).join('');
    const dessin = htmlDessin(e, source);
    const ouvrable = Boolean(lignes || source || dessin);
    return `<li class="lu is-${esc(etat)}${ouverte ? ' est-ouvert' : ''}" data-etape="${esc(e.id)}" data-t="${teinte(e.cleSource)}">
      <button type="button" class="lu-tete" ${ouvrable ? `data-ast-etape-ouvrir="${esc(e.id)}"` : ''} aria-expanded="${ouverte ? 'true' : 'false'}">
        <span class="lu-marque" aria-hidden="true"><i class="lu-point"></i></span>
        <span class="lu-source">${esc(e.nomSource || 'Lecture')}</span>
        <span class="lu-phrase">${esc(phraseFinie(e.phrase || e.libelle || ''))}${etat === 'echec' ? ', échec' : ''}</span>
        <span class="lu-dessine">${puceDe(source)}</span>
        <span class="lu-res">${esc(e.trouve || mesureDe(e))}</span>
        ${ouvrable ? icone('chevron') : ''}
      </button>
      <div class="lu-plis"><div class="lu-pli">
        ${dessin}
        ${lignes ? `<div class="lu-lignes">${lignes}</div>` : ''}
        <div class="lu-actions">${source ? `<button type="button" class="ast-pill" data-ast-source="${esc(e.source)}">Voir les données</button>` : ''}${lien ? `<button type="button" class="ast-lien" data-ast-page="${esc(lien.cle)}">Ouvrir ${esc(lien.nom)}</button>` : ''}</div>
      </div></div>
    </li>`;
  }

  // La meme ligne pendant qu elle se lit : un anneau a la couleur de sa source, la source, la phrase
  // au present et ce que le serveur a deja parcouru. Le signe de travail, lui, est sous la liste.
  const htmlLigneEnCours = (e) => `<li class="lu is-cours" data-etape="${esc(e.id)}" data-t="${teinte(e.cleSource)}"><div class="lu-tete"><span class="lu-marque" aria-hidden="true"><i class="lu-point est-creux"></i></span><span class="lu-source" data-lu-source>${esc(e.nomSource || 'Lecture')}</span><span class="lu-phrase" data-lu-phrase>${esc(e.phrase || e.libelle || '')}</span><span class="lu-dessine" data-lu-dessine></span><span class="lu-res" data-lu-res></span></div></li>`;

  const htmlTeteRecherche = (m) => `<span class="ast-rech-titre">${esc(bilanRecherche(m))}</span>${icone('chevron')}`;

  function htmlRecherche(m) {
    const etapes = m.etapes || [];
    const repris = htmlRepris(m);
    if (!etapes.length) return repris;
    const enCours = m.statut === 'cours' && !m.texte;
    const ouvert = enCours || Boolean(m.etapesOuvertes);
    return `${repris}<section class="ast-rech${enCours ? ' est-cours' : ''}${ouvert ? ' est-ouvert' : ''}" data-ast-recherche aria-busy="${enCours ? 'true' : 'false'}">
      <button type="button" class="ast-rech-tete" data-ast-etapes aria-expanded="${ouvert ? 'true' : 'false'}">${enCours ? '' : htmlTeteRecherche(m)}</button>
      <div class="lu-plis"><ol class="ast-rech-liste"${enCours ? ' data-lu-direct' : ''}>${enCours ? '' : etapes.map((e) => htmlLigneEtape(e, Boolean(e.id && (m.etapesDeroulees || {})[e.id]), m)).join('')}</ol></div>
      ${enCours ? '<p class="ast-lu-sr" role="status" data-lect-dit></p>' : ''}
    </section>`;
  }

  // LA LECTURE EN DIRECT. Chaque lecture ajoute sa ligne sous les precedentes des que le serveur
  // l annonce. Elle montre ce qui est deja parcouru, puis rend son resultat et sa puce, et ne bouge
  // plus. Rien ne se remplace, rien ne remonte : la liste ne fait que grandir. Le signe de travail
  // reste sous la liste tant que la reponse n a pas commence.
  function demarrerLecture(bloc, m) {
    const liste = bloc.querySelector('.ast-rech-liste');
    const dit = bloc.querySelector('[data-lect-dit]');
    if (!liste || !dit) return null;
    const S = { lignes: new Map(), vivant: true, minuteur: 0 };
    const lectures = () => (m.etapes || []).filter((e) => !e.note);
    const resultatDe = (e) => (e.etat === 'echec' ? 'échec' : (e.trouve || mesureDe(e)));

    // Une nouvelle lecture : sa ligne s ajoute sous les autres.
    function entrer(e, now) {
      const moule = document.createElement('ol');
      moule.innerHTML = htmlLigneEnCours(e);
      const li = moule.firstElementChild;
      liste.appendChild(li);
      if (!sansMouvement()) li.animate([{ height: '0px', opacity: 0 }, { height: `${li.offsetHeight}px`, opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.165, .84, .44, 1)' });
      // Les lectures arrivees ensemble rendent leur resultat l une apres l autre, meme quand le flux les
      // pose de part et d autre d un battement : chacune finit au plus tot un decalage apres la precedente.
      const precedente = Math.max(0, ...[...S.lignes.values()].map((L) => L.finDes));
      S.lignes.set(e, { li, vue: now, finDes: Math.max(now + LECTURE_VUE_MIN, precedente + LECTURE_DECALAGE), ecrit: '', fini: false });
      dit.textContent = e.phrase || e.libelle || '';
    }

    // La lecture est finie : l anneau se remplit, la phrase passe au passe, le resultat et la puce
    // se posent. La ligne ne changera plus.
    function finir(e, L) {
      const { li } = L;
      L.fini = true;
      li.classList.remove('is-cours');
      li.classList.add(e.etat === 'echec' ? 'is-echec' : 'is-fini');
      li.querySelector('.lu-point').classList.remove('est-creux');
      ['source', 'phrase', 'res', 'dessine'].forEach((nom) => li.querySelector(`[data-lu-${nom}]`).removeAttribute(`data-lu-${nom}`));
      li.querySelector('.lu-phrase').textContent = `${phraseFinie(e.phrase || e.libelle || '')}${e.etat === 'echec' ? ', échec' : ''}`;
      li.querySelector('.lu-res').textContent = resultatDe(e);
      const source = e.source ? (m.sources || []).find((s) => s.id === e.source) : null;
      li.querySelector('.lu-dessine').innerHTML = puceDe(source);
    }

    function battre() {
      if (!S.vivant || !bloc.isConnected) return;
      const now = performance.now();
      lectures().forEach((e) => {
        let L = S.lignes.get(e);
        if (!L) { entrer(e, now); L = S.lignes.get(e); }
        if (L.fini) return;
        if (e.etat !== 'cours' && (sansMouvement() || now >= L.finDes)) { finir(e, L); return; }
        // Le compte s ecrit tel que le serveur le donne : aucun nombre ne defile.
        const compte = e.etat === 'cours' && e.lues ? compteLu(Number(e.lues), Number(e.total) || 0) : '';
        if (compte !== L.ecrit) { L.ecrit = compte; L.li.querySelector('.lu-res').textContent = compte; }
      });
      S.minuteur = setTimeout(battre, 60);
    }
    battre();
    S.arreter = () => { S.vivant = false; clearTimeout(S.minuteur); };
    return S;
  }

  function majRecherche(hote, m) {
    let bloc = hote.querySelector('[data-ast-recherche]');
    // Une recherche deja pliee qui reprend (le texte a ete retire) redevient une lecture en direct.
    if (!bloc || !bloc.querySelector('[data-lu-direct]')) {
      if (!(m.etapes || []).length) { const repris = htmlRepris(m); if (repris && !hote.querySelector('[data-ast-repris]')) hote.innerHTML = repris; return; }
      hote.innerHTML = htmlRecherche(m);
      bloc = hote.querySelector('[data-ast-recherche]');
      if (!bloc) return;
    }
    if (!scenes.get(bloc)) { const S = demarrerLecture(bloc, m); if (S) scenes.set(bloc, S); }
  }

  // La reponse commence : la liste s efface, puis le bilan et le texte prennent sa place. La hauteur
  // de la reponse reste tenue, rien ne redescend au-dessus pendant que le texte arrive. Renvoie vrai
  // tant que le pli est en cours.
  function replierLecture(hote, m, article) {
    const bloc = hote.querySelector('[data-ast-recherche]');
    const S = bloc && scenes.get(bloc);
    if (S) S.arreter();
    article.style.minHeight = `${article.offsetHeight}px`;
    if (!S || sansMouvement()) { hote.innerHTML = htmlRecherche(m); return false; }
    bloc.classList.add('vient-de-plier');
    bloc.setAttribute('aria-busy', 'false');
    bloc.dataset.pliage = '1';
    setTimeout(() => {
      if (!bloc.isConnected) return;
      hote.innerHTML = htmlRecherche(m);
      const neuf = hote.querySelector('[data-ast-recherche]');
      if (neuf) neuf.classList.add('vient-de-plier');
      demanderPeinture(m);
    }, 160);
    return true;
  }

  // Les barres : couleur de l entite, valeur au bout, elles poussent l une apres l autre.
  function barresMaison(hote, etiquettes, valeurs, type) {
    const nums = valeurs.map((v) => Number(v) || 0);
    const max = Math.max(1, ...nums);
    hote.innerHTML = `<div class="gb">${etiquettes.map((l, i) => `<div class="gb-l" data-t="${i < 5 ? i + 1 : 6}" style="--v:${(nums[i] / max).toFixed(4)};--i:${i}"><span class="gb-n">${esc(l)}</span><span class="gb-p"><i></i></span><span class="gb-val">${esc(formater(nums[i], type))}</span></div>`).join('')}</div>`;
  }

  function fermerLeGras(texte) {
    const t = texte.replace(/(^|[^*])\*$/, '$1');
    return (t.match(/\*\*/g) || []).length % 2 ? `${t}**` : t;
  }

  // Le texte a rendre. Pendant l ecriture, un renvoi coupe en deux ne s affiche pas a moitie, et un
  // blanc final attend le mot qui le suit : chaque image ne fait qu ajouter au texte deja pose.
  function htmlTexteBrut(m) {
    return m.statut === 'cours' ? fermerLeGras(m.texte.replace(/\[[SGF]?\d*$/, '').replace(/\s+$/, '')) : marquer(m.texte, m.preuves);
  }

  function htmlTexte(m) {
    if (m.statut === 'cours' && !m.texte) return `<p class="ast-pense${(m.etapes || []).length ? ' est-sous-la-liste' : ''}" role="status" aria-label="Réponse en préparation">${SIGNE}</p>`;
    let html = markdown(htmlTexteBrut(m), m);
    // Un graphique demande mais jamais place dans le texte se montre a la fin.
    if (m.statut !== 'cours') (m.graphiques || []).forEach((g) => { if (!html.includes(`data-ast-graph="${g.id}"`)) html += `<figure class="ast-graph" data-ast-graph="${g.id}"></figure>`; });
    return html;
  }

  // OU ALLER (2026-11-11) : le chemin des menus et le bouton qui y mene (lib/carte-logiciel.js). Seules
  // les pages de la console connues ici s ouvrent, quel que soit ce que le flux apporte.
  function htmlAllers(m) {
    const allers = (m.allers || []).filter((a) => PAGES_OUVRABLES.includes(a.page));
    return allers.length ? `<div class="ast-allers">${allers.map((a) => `<button type="button" class="ast-aller" data-ast-aller="${esc(a.id)}"><b>M’y emmener</b><span>${esc(a.chemin)}</span></button>`).join('')}</div>` : '';
  }

  // La note s ajoute a celle du client, comme « Ajouter » sur sa fiche : la note lue d abord, puis le tout
  // renvoye avec sa version, pour ne rien effacer de ce qu un collegue vient d ecrire (409 sinon).
  async function ajouterNoteClient(centre, reservationId, texte) {
    const appel = (url, options = {}) => (typeof apiRequest === 'function' ? apiRequest(url, options)
      : fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, headers: staffAuthHeaders({ 'Content-Type': 'application/json' }) }).then(async (x) => { const d = await x.json().catch(() => ({})); if (!x.ok || d.ok === false) throw new Error(d.message || d.error || ''); return d; }));
    const porte = '/api/staff-customer-notes';
    const lue = await appel(`${porte}?centerId=${encodeURIComponent(centre)}&reservationId=${encodeURIComponent(reservationId)}`);
    if (!lue || !lue.eligible) throw new Error('Ce client n’a ni téléphone ni e-mail : la note ne peut pas se garder sur sa fiche.');
    const avant = String((lue.note && lue.note.body) || '').trim();
    const body = [avant, String(texte || '').trim()].filter(Boolean).join('\n\n');
    const faite = await appel(porte, { method: 'PATCH', body: JSON.stringify({ centerId: centre, reservationId: Number(reservationId), body, clientKey: lue.clientKey, baseUpdatedAt: (lue.note && lue.note.updatedAt) || null }) });
    if (!faite || !faite.note) throw new Error('La note n’a pas été confirmée. Réessayez.');
    if (window.PinlaneStaffNotes && typeof window.PinlaneStaffNotes.invalidate === 'function') window.PinlaneStaffNotes.invalidate();
  }

  // FAIRE LE GESTE PROPOSE (2026-11-11) : seul ce clic l envoie, avec les droits de la personne, et le
  // serveur revoit tout (api/ops.js). Une action hors de cette liste ne part pas.
  async function faireGeste(m, p, { confirme = false } = {}) {
    const a = p.action || {};
    const cles = GESTES[a.action];
    if (!cles || p.etat === 'cours') return;
    // UN GESTE RISQUE SE CONFIRME DEUX FOIS (Ansar, 2026-11-11 : « double vérification à la personne qui
    // demande ») : le premier clic dit ce qui va se passer et ce qui ne se rattrape pas, le second fait.
    if (p.risque && !confirme) {
      p.confirmer = true;
      p.erreur = '';
      peindreMessage(m);
      const i = (m.propositions || []).indexOf(p);
      const bouton = A.root && A.root.querySelector(`[data-ast-geste-oui="${i}"][data-ast-confirme="1"]`);
      if (bouton) bouton.focus();
      return;
    }
    p.confirmer = false;
    if (a.action === 'effacerConversations') {
      const liste = conversationsAEffacer(a);
      liste.forEach((c) => supprimer(c.id));
      p.efface = liste.length;
      p.etat = 'fait'; p.faitA = Date.now();
      sauver(courante());
      peindreMessage(m);
      return;
    }
    if (a.action === 'annulerReservation') {
      if (p.centre && p.centre !== centreId()) { p.erreur = `Cette réservation est dans ${nomDUnCentre(p.centre)} : ouvrez ce centre dans la console, puis redemandez.`; peindreMessage(m); return; }
      if (typeof envoyerModificationReservation !== 'function' || typeof apiRequest !== 'function') { p.erreur = 'L’annulation n’est pas disponible ici.'; peindreMessage(m); return; }
      p.etat = 'cours';
      p.erreur = '';
      peindreMessage(m);
      try {
        // Le dossier relu au clic : c est sa version du moment qui part, avec les droits de la personne.
        const lu = await apiRequest(`${API_ENDPOINTS.staffReservations}?numero=${encodeURIComponent(a.reservationId)}&centerId=${encodeURIComponent(centreId())}`);
        const dossier = lu && lu.reservation;
        if (!dossier || String(dossier.id) !== String(a.reservationId) || (lu.centre && lu.centre !== centreId())) throw new Error('Cette réservation n’est plus dans ce centre.');
        if (dossier.status === 'cancelled') throw new Error('Cette réservation est déjà annulée.');
        const fait = await envoyerModificationReservation(dossier, (d) => ({ ...d, status: 'cancelled' }));
        if (fait && fait.reservation && typeof applyOptimisticReservation === 'function') applyOptimisticReservation(fait.reservation, { preserveEditState: true });
        p.etat = 'fait'; p.faitA = Date.now();
      } catch (erreur) {
        p.etat = '';
        p.erreur = (erreur && erreur.message) || 'L’annulation n’a pas pu se faire.';
      }
      sauver(courante());
      peindreMessage(m);
      return;
    }
    const corps = { action: a.action, centerId: p.centre || centreId() };
    cles.forEach((k) => { if (a[k] != null) corps[k] = a[k]; });
    if (a.action === 'ouvrirReserver') {
      // Reserver cree dans le centre affiche : une reservation preparee pour un autre centre ne s y ouvre pas.
      if (p.centre && p.centre !== centreId()) { p.erreur = `Cette réservation est pour ${nomDUnCentre(p.centre)} : ouvrez ce centre dans la console, puis redemandez.`; peindreMessage(m); return; }
      if (typeof openQuickBook !== 'function') { p.erreur = 'La fenêtre Réserver n’est pas disponible ici.'; peindreMessage(m); return; }
      openQuickBook({ date: corps.date, startTime: corps.startTime, heureSouhaitee: true, pax: corps.pax, ...(corps.name ? { name: corps.name } : {}) });
      p.etat = 'fait'; p.faitA = Date.now();
      sauver(courante());
      peindreMessage(m);
      return;
    }
    if (a.action === 'assistantReservation') {
      if (p.centre && p.centre !== centreId()) { p.erreur = `Cette réservation est pour ${nomDUnCentre(p.centre)} : ouvrez ce centre dans la console, puis redemandez.`; peindreMessage(m); return; }
      const i = (m.propositions || []).indexOf(p);
      const champTel = A.root && A.root.querySelector(`[data-ast-tel="${i}"]`);
      const champNom = A.root && A.root.querySelector(`[data-ast-nom="${i}"]`);
      const tel = champTel ? champTel.value.trim() : String(a.phone || '');
      const nom = champNom ? champNom.value.trim() : String(a.name || '');
      p.saisie = { tel, nom };
      if (!telephoneValide(tel)) {
        p.erreur = tel.replace(/\D/g, '').length > 2 ? 'Numéro incomplet : il faut au moins 8 chiffres après l’indicatif.' : 'Tapez le téléphone du client : il est obligatoire pour créer la réservation.';
        p.manqueTel = true;
        peindreMessage(m);
        const champ = A.root && A.root.querySelector(`[data-ast-tel="${i}"]`);
        if (champ) champ.focus();
        return;
      }
      corps.phone = tel;
      corps.name = nom;
      corps.programme = Array.isArray(a.programme) ? a.programme : [];
      p.etat = 'cours';
      p.erreur = '';
      p.manqueTel = false;
      peindreMessage(m);
      try {
        const r = typeof apiRequest === 'function' && typeof API_ENDPOINTS !== 'undefined'
          ? await apiRequest(API_ENDPOINTS.ops, { method: 'POST', body: JSON.stringify(corps) })
          : await fetch('/api/ops', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: staffAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(corps) }).then(async (x) => { const d = await x.json().catch(() => ({})); if (!x.ok || d.ok === false) throw new Error(d.message || 'La réservation n’a pas pu se créer.'); return d; });
        p.reservation = r && r.reservation ? { id: r.reservation.id, date: r.reservation.date || a.date, startTime: r.reservation.startTime || a.startTime, pax: r.reservation.pax || a.pax } : null;
        p.etat = 'fait'; p.faitA = Date.now();
        if (typeof syncDateReservations === 'function') syncDateReservations(a.date, { silent: true }).catch(() => {});
      } catch (erreur) {
        p.etat = '';
        p.erreur = (erreur && erreur.message) || 'La réservation n’a pas pu se créer.';
      }
      sauver(courante());
      peindreMessage(m);
      return;
    }
    p.etat = 'cours';
    p.erreur = '';
    peindreMessage(m);
    if (a.action === 'noteClient') {
      try {
        await ajouterNoteClient(corps.centerId, corps.reservationId, corps.texte);
        p.etat = 'fait'; p.faitA = Date.now();
      } catch (erreur) {
        p.etat = '';
        p.erreur = (erreur && erreur.message) || 'La note n’a pas pu s’enregistrer.';
      }
      sauver(courante());
      peindreMessage(m);
      return;
    }
    try {
      const r = typeof apiRequest === 'function' && typeof API_ENDPOINTS !== 'undefined'
        ? await apiRequest(API_ENDPOINTS.ops, { method: 'POST', body: JSON.stringify(corps) })
        : await fetch('/api/ops', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: staffAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(corps) }).then(async (x) => { const d = await x.json().catch(() => ({})); if (!x.ok || d.ok === false) throw new Error(d.message || d.error || ''); return d; });
      if (r && r.customRequest && typeof replaceStaffCustomRequest === 'function') replaceStaffCustomRequest(r.customRequest);
      // Un mail que l envoi a refuse (l essai, le renvoi) revient sans erreur, avec son statut : la carte
      // dit qu il n est pas parti, jamais qu il est parti.
      if (r && r.status === 'failed') throw new Error(`Le mail n’est pas parti${r.error ? ` (${String(r.error).slice(0, 160)})` : ''}. Rien n’est changé.`);
      p.etat = 'fait'; p.faitA = Date.now();
    } catch (erreur) {
      p.etat = '';
      p.erreur = (erreur && erreur.message) || 'Le geste n’a pas pu se faire.';
    }
    sauver(courante());
    peindreMessage(m);
  }

  // LES CARTES D ACTION (Ansar, 2026-11-11 : « il envoie un bouton moche ... c'est pas un truc vraiment
  // beau et déjà tout complété, on a juste à analyser et déployer »). Chaque geste a sa carte : ce qu il
  // fera, en lignes deja remplies, et UN bouton qui dit son verbe. Une reservation se cree depuis sa
  // carte une fois le telephone du client tape, obligatoire comme dans Reserver.
  const GESTE_VUE = {
    assistantReservation: { type: 'Réservation', verbe: 'Créer la réservation', cours: 'Création…' },
    ouvrirReserver: { type: 'Réservation', verbe: 'Ouvrir dans Réserver', cours: 'Ouverture…' },
    ouvertureExceptionnelle: { type: 'Horaires d’un jour', verbe: 'Changer les horaires', cours: 'Enregistrement…' },
    customRequestStatus: { type: 'Demande sur mesure', verbe: 'Classer la demande', cours: 'Enregistrement…' },
    noteClient: { type: 'Fiche du client', verbe: 'Ajouter la note', cours: 'Enregistrement…' },
    annulerReservation: { type: 'Annulation', verbe: 'Annuler la réservation', cours: 'Annulation…', confirmer: 'Oui, annuler', suite: 'Le créneau se libère et le dossier reste au journal. Pensez à prévenir le client.' },
    effacerConversations: { type: 'Conversations', verbe: 'Effacer', cours: 'Effacement…', confirmer: 'Oui, effacer', suite: 'Elles s’effacent pour de bon, sur tous vos appareils.' },
  };
  // UN GESTE DU REGISTRE (lib/assistant-gestes.js, « tout faire ») porte ses mots : son type, son verbe,
  // sa confirmation. Ce qui atteint les clients se lit sur la carte et revient dans la confirmation.
  function vueDuRegistre(p) {
    const v = p.vue || {};
    const r = p.resume || {};
    return { type: v.type || 'Geste', verbe: v.verbe || 'Faire', cours: v.cours || 'En cours…', confirmer: v.confirmer || 'Oui, faire', suite: r.clients || r.alerte || '' };
  }
  // Une ligne qui change dit avant puis apres ; un texte long se deplie en entier.
  function ddDe(v) {
    if (!v || typeof v !== 'object') return esc(v);
    const long = v.long ? `<details class="ast-carte-long"><summary>Voir le texte entier</summary><p>${esc(v.long)}</p></details>` : '';
    if (v.avant === undefined && v.apres === undefined) return `${esc(v.valeur)}${long}`;
    return `<span class="ast-avant">${esc(v.avant)}</span><span class="ast-fleche" aria-label="devient">→</span><b class="ast-apres">${esc(v.apres)}</b>${long}`;
  }

  // ---- LA CARTE D UN CHANGEMENT (Ansar, 2026-11-13 : « elle presente les choses qu elle modifie vrm pas
  // assez bien dutout ») ---------------------------------------------------------------------------------
  // En tete, ce qui va se passer, en une phrase. Dessous, ce qui change en grand, l ancien barre a cote du
  // nouveau ; un etat (allumee, en vente) en pastilles ; un mail comme Gmail le montre, entier, ses
  // variables en etiquettes et ses changements marques. Le detail reste en petit. Faite, la carte garde
  // ce qui a change et l heure ou c est fait.
  const svgDe = (chemins, taille = 16) => `<svg viewBox="0 0 16 16" width="${taille}" height="${taille}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${chemins}</svg>`;
  const ICONES_DOMAINE = {
    Prix: '<path d="M2.5 8.3V3.5a1 1 0 0 1 1-1h4.8l5.2 5.2a1 1 0 0 1 0 1.4l-4.4 4.4a1 1 0 0 1-1.4 0z"/><circle cx="5.6" cy="5.6" r="1"/>',
    Mails: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="m2.6 4.6 5.4 4 5.4-4"/>',
    Établissement: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.4"/>',
    Réservations: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.8h11M5.5 2v3M10.5 2v3"/>',
    Planning: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.8h11M5.5 2v3M10.5 2v3"/>',
    Clients: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.8-2.6 2.8-4 5-4s4.2 1.4 5 4"/>',
    Demandes: '<path d="M2.5 9.5 4 3.5h8l1.5 6v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M2.5 9.5h3l1 1.5h3l1-1.5h3"/>',
    Direction: '<path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5"/>',
    Conversations: ICONES.corbeille,
  };
  const DOMAINE_DES_ANCIENS = { assistantReservation: 'Réservations', ouvrirReserver: 'Réservations', annulerReservation: 'Réservations', ouvertureExceptionnelle: 'Établissement', customRequestStatus: 'Demandes', noteClient: 'Clients', effacerConversations: 'Conversations' };
  const CHEMIN_CLIENTS = '<circle cx="6" cy="6" r="2.2"/><path d="M2 13c.5-2.2 2-3.4 4-3.4s3.5 1.2 4 3.4M10.5 4a2 2 0 1 1 0 4M11.6 9.8c1.3.4 2.2 1.5 2.5 3.2"/>';
  const CHEMIN_ALERTE = '<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.4v.1"/>';
  const CHEMIN_SUITE = '<path d="M3 8h10M9 4l4 4-4 4"/>';
  // Deux etats que la personne connait (allume ou coupe, en vente ou retire) se lisent en pastilles.
  const ETAT_ALLUME = /^(allumée?|en vente|ouverte?|oui|active?|validée?|visible|publiée?|en ligne)$/i;
  const ETAT_ETEINT = /^(coupée?|retirée?|fermée?|non|inactive?|masquée?|archivée?|hors ligne)$/i;
  const etatDe = (v) => { const t = String(v == null ? '' : v).trim(); return ETAT_ALLUME.test(t) ? 'on' : (ETAT_ETEINT.test(t) ? 'off' : ''); };
  // Une variable d un mail se lit en etiquette : le logiciel la remplace pour chaque client a l envoi.
  const VARIABLES_DITES = { prenom: 'prénom', nom: 'nom', centre: 'nom du centre', date: 'date', heure: 'heure', formule: 'formule', pax: 'joueurs', numero: 'n° de réservation', prix: 'prix', date_fete: 'date de la fête', offre: 'offre', lien_avis: 'lien des avis', date_debut: 'date de début', date_fin: 'date de fin', geste: 'geste' };
  const avecVariables = (h) => h.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (t, nom) => `<span class="ast-var" title="Remplacé pour chaque client à l’envoi">${esc(VARIABLES_DITES[nom.toLowerCase()] || nom)}</span>`);
  // CE QUI CHANGE ENTRE DEUX TEXTES, mot a mot (la plus longue suite commune). Un texte trop long pour se
  // comparer vite rend null : la carte le montre alors sans marques. Garde par objet : une carte se repeint
  // a chaque morceau de reponse, la comparaison ne se refait pas.
  const DIFFERENCES = new WeakMap();
  function difference(avant, apres) {
    const a = String(avant || '').match(/\S+\s*|\s+/g) || [];
    const b = String(apres || '').match(/\S+\s*|\s+/g) || [];
    const n = a.length;
    const m = b.length;
    if (n * m > 2500000) return null;
    const at = a.map((s) => s.trimEnd());
    const bt = b.map((s) => s.trimEnd());
    const L = [];
    for (let i = 0; i <= n; i += 1) L.push(new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) L[i][j] = at[i] === bt[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const morceaux = [];
    const pousser = (t, s) => { const d = morceaux[morceaux.length - 1]; if (d && d.t === t) d.s += s; else morceaux.push({ t, s }); };
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (at[i] === bt[j]) { pousser('=', b[j]); i += 1; j += 1; } else if (L[i + 1][j] >= L[i][j + 1]) { pousser('-', a[i]); i += 1; } else { pousser('+', b[j]); j += 1; }
    }
    for (; i < n; i += 1) pousser('-', a[i]);
    for (; j < m; j += 1) pousser('+', b[j]);
    return { morceaux, commun: n + m ? (2 * L[0][0]) / (n + m) : 1 };
  }
  function differenceGardee(mail, cle) {
    if (!DIFFERENCES.has(mail)) DIFFERENCES.set(mail, {});
    const garde = DIFFERENCES.get(mail);
    if (!(cle in garde)) garde[cle] = difference(cle === 'objet' ? mail.objetAvant : mail.texteAvant, cle === 'objet' ? mail.objet : mail.texte);
    return garde[cle];
  }
  // L ajoute surligne, le retire barre ; l espace qui suit reste hors de la marque. Un retire suivi de son
  // remplacant ne garde pas son retour a la ligne : celui du nouveau texte suffit, une espace les separe.
  const htmlMarques = (morceaux) => morceaux.map((d, k) => {
    if (d.t === '=') return avecVariables(esc(d.s));
    const [, mot, blanc] = /^([\s\S]*?)(\s*)$/.exec(d.s);
    const balise = d.t === '+' ? 'ins' : 'del';
    const suivi = d.t === '-' && morceaux[k + 1] && morceaux[k + 1].t === '+';
    return `${mot ? `<${balise} class="ast-${balise}">${avecVariables(esc(mot))}</${balise}>` : ''}${suivi ? (mot ? ' ' : '') : esc(blanc)}`;
  }).join('');
  // LE MAIL TEL QUE LE CLIENT LE LIRA : de qui, pour qui, l objet, le texte entier. Avec un avant, deux
  // vues : ce qui change (marque) et tel qu il partira. Un texte reecrit presque en entier ne se marque
  // pas mot a mot, l ancien se deplie dessous.
  function htmlMail(p, i, mail, { fige = false } = {}) {
    if (!mail || (!mail.objet && !mail.texte)) return '';
    const aUnAvant = !fige && (mail.texteAvant !== undefined || mail.objetAvant !== undefined);
    const vue = aUnAvant && p.vueMail !== 'propre' ? 'changements' : 'propre';
    const dObjet = vue === 'changements' && mail.objetAvant !== undefined ? differenceGardee(mail, 'objet') : null;
    const dTexte = vue === 'changements' && mail.texteAvant !== undefined ? differenceGardee(mail, 'texte') : null;
    const reecrit = vue === 'changements' && mail.texteAvant !== undefined && (!dTexte || dTexte.commun < 0.3);
    const objet = dObjet ? htmlMarques(dObjet.morceaux) : avecVariables(esc(mail.objet || ''));
    const texte = dTexte && !reecrit ? htmlMarques(dTexte.morceaux) : avecVariables(esc(mail.texte || ''));
    const de = String(mail.de || '') || nomDUnCentre(p.centre || centreId()) || 'Le centre';
    const nomDe = de.replace(/\s*<[^>]*>\s*$/, '').trim() || de;
    const adresseDe = (/<([^>]+)>\s*$/.exec(de) || [])[1] || '';
    const long = String(mail.texte || '').split('\n').length > 14 || String(mail.texte || '').length > 900;
    const ouvert = Boolean(p.mailOuvert) || fige;
    return `<div class="ast-mail${long && !ouvert ? ' est-replie' : ''}" data-ast-mail="${i}">
      ${aUnAvant ? `<div class="ast-mail-vues" role="group" aria-label="Afficher le mail"><button type="button" data-ast-mail-vue="${i}" data-vue="changements" aria-pressed="${vue === 'changements'}">Ce qui change</button><button type="button" data-ast-mail-vue="${i}" data-vue="propre" aria-pressed="${vue === 'propre'}">Tel qu’il partira</button></div>` : ''}
      <div class="ast-mail-tete"><span class="ast-mail-avatar" aria-hidden="true">${esc((nomDe[0] || 'P').toUpperCase())}</span><div class="ast-mail-qui"><p><b>${esc(nomDe)}</b>${adresseDe ? ` <span>&lt;${esc(adresseDe)}&gt;</span>` : ''}</p>${mail.a ? `<p>à ${esc(mail.a)}</p>` : ''}</div></div>
      ${mail.enReponse ? `<p class="ast-mail-reponse">En réponse à « ${esc(mail.enReponse)} »</p>` : ''}
      <p class="ast-mail-objet">${objet || 'Sans objet'}</p>
      <div class="ast-mail-texte">${texte}</div>
      ${long && !fige ? `<button type="button" class="ast-mail-suite" data-ast-mail-suite="${i}" aria-expanded="${ouvert}">${ouvert ? 'Replier le mail' : 'Lire le mail en entier'}</button>` : ''}
      ${reecrit ? `<details class="ast-mail-ancien"><summary>Le texte est réécrit. Voir l’ancien</summary><div class="ast-mail-texte">${avecVariables(esc(mail.texteAvant || ''))}</div></details>` : ''}
    </div>`;
  }
  function htmlChange(k, v) {
    const avant = String(v.avant == null ? '' : v.avant);
    const apres = String(v.apres == null ? '' : v.apres);
    const etat = etatDe(avant) && etatDe(apres);
    const large = !etat && (avant.length > 28 || apres.length > 28);
    const long = v.long ? `<details class="ast-carte-long"><summary>Voir le texte entier</summary><p>${esc(v.long)}</p></details>` : '';
    return `<div class="ast-carte-ligne est-change${etat ? ' est-etat' : ''}${large ? ' est-large' : ''}"><dt>${esc(k)}</dt><dd><span class="ast-avant"${etat ? ` data-etat="${etatDe(avant)}"` : ''}>${esc(avant)}</span><span class="ast-fleche" role="img" aria-label="devient">${svgDe(CHEMIN_SUITE, 14)}</span><b class="ast-apres"${etat ? ` data-etat="${etatDe(apres)}"` : ''}>${esc(apres)}</b>${long}</dd></div>`;
  }
  // Faite, une ligne dit la valeur d a present, et l ancienne en petit.
  function htmlChangeFait(k, v) {
    const avant = String(v.avant == null ? '' : v.avant);
    const apres = String(v.apres == null ? '' : v.apres);
    const etat = etatDe(avant) && etatDe(apres);
    return `<div class="ast-carte-ligne est-change${etat ? ' est-etat' : ''}"><dt>${esc(k)}</dt><dd><b class="ast-apres"${etat ? ` data-etat="${etatDe(apres)}"` : ''}>${esc(apres)}</b>${avant && !etat ? `<span class="ast-avant-dit">au lieu de ${esc(avant)}</span>` : ''}</dd></div>`;
  }
  function heureFaite(t) {
    const d = new Date(Number(t));
    if (!Number(t) || Number.isNaN(d.getTime())) return '';
    const h = d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    return new Date().toDateString() === d.toDateString() ? `Fait à ${h}` : `Fait le ${d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' })} à ${h}`;
  }
  // Une ligne que l en-tete ou l apercu du mail dit deja ne se repete pas en dessous.
  const DANS_LE_MAIL = new Set(['Objet', 'Texte', 'Pour qui', 'À', 'De', 'Destinataires', 'Part à', 'En réponse à']);
  function lignesVues(p, titre, mail) {
    return lignesDuGeste(p).filter(([k, v]) => {
      if (v === '' || v == null) return false;
      if (mail && DANS_LE_MAIL.has(k)) return false;
      const simple = typeof v === 'string' ? v : (v.avant === undefined && v.apres === undefined ? String(v.valeur == null ? '' : v.valeur) : null);
      return !(simple && (simple === titre || titre.includes(`« ${simple} »`)));
    });
  }
  // Les conversations qu un effacement prendrait : jamais celle ou la personne ecrit.
  function conversationsAEffacer(a) {
    const age = a.portee === 'anciennes' ? Math.max(1, Number(a.jours) || 0) * 86400000 : 0;
    return (A.conversations || []).filter((c) => c && c.id !== A.actuelle && (!age || Date.now() - (Number(c.maj) || 0) > age));
  }
  const STATUTS_DITS = { in_progress: 'En cours', handled: 'Terminée', archived: 'Sans suite' };
  // La regle de la fenetre Reserver (rvTelephoneValide, assets/app-main.js ; lib/telephone-du-client.js).
  function telephoneValide(valeur) {
    const brut = String(valeur || '').replace(/\s+/g, ' ').trim();
    if (!brut) return false;
    const c = brut.replace(/\D/g, '');
    const chiffres = brut.startsWith('+') ? c : brut.startsWith('00') ? c.slice(2) : brut.startsWith('0') ? `32${c.slice(1)}` : `32${c}`;
    return chiffres.length <= 15 && chiffres.replace(/^32/, '').length >= 8;
  }
  function jourDit(iso) {
    try { return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch (erreur) { return String(iso || ''); }
  }
  function eurosDits(v) {
    try { return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: Number(v) % 1 ? 2 : 0 }).format(Number(v)); } catch (erreur) { return `${v} €`; }
  }
  function prixConvenuDit(r, pax) {
    const joueurs = Math.trunc(Number(pax)) || 0;
    const convenu = `${eurosDits(r.prix)}${joueurs > 1 ? `, soit ${eurosDits(Math.round((Number(r.prix) / joueurs) * 100) / 100)} par personne` : ''}`;
    return r.prixHabituel != null ? { avant: eurosDits(r.prixHabituel), apres: convenu } : convenu;
  }
  function lignesDuGeste(p) {
    const a = p.action || {};
    const r = p.resume || {};
    if (a.action === 'assistantGeste') {
      return (Array.isArray(r.lignes) ? r.lignes : []).slice(0, 12).map((l) => [l.libelle, l.avant !== undefined || l.apres !== undefined ? { avant: l.avant, apres: l.apres, long: l.long } : (l.long ? { valeur: l.valeur, long: l.long } : l.valeur)]);
    }
    if (a.action === 'assistantReservation') {
      return [
        ['Quand', `${r.quand || jourDit(a.date)}, ${a.startTime}${r.fin ? ` à ${r.fin}` : ''}`],
        ['Joueurs', String(a.pax)],
        ...(Array.isArray(r.lignes) ? r.lignes : []).map((l) => [l.nom, [l.debut ? (l.fin ? `${l.debut} à ${l.fin}` : l.debut) : '', l.detail].filter(Boolean).join(' · ')]),
        ...(Array.isArray(r.supplements) && r.supplements.length ? [['Suppléments', r.supplements.map((s) => `${s.nom} × ${s.qte}${s.parPersonne ? ', un par joueur' : ''}`).join(' ; ')]] : []),
        // Un prix convenu se lit contre le prix habituel, et par personne quand le groupe en compte plusieurs.
        ...(r.prix != null ? [['Prix', r.prixNegocie ? prixConvenuDit(r, a.pax) : eurosDits(r.prix)]] : []),
        ...(r.prixNegocie && r.prixRaison ? [['Raison du prix', r.prixRaison]] : []),
        ...(a.note ? [['Note pour l’équipe', a.note]] : []),
      ];
    }
    if (a.action === 'ouvrirReserver') return [['Quand', `${jourDit(a.date)}, ${a.startTime}`], ['Joueurs', String(a.pax)], ...(a.name ? [['Client', a.name]] : [])];
    if (a.action === 'ouvertureExceptionnelle') return [['Jour', jourDit(a.date)], ['Horaires', `${a.open} à ${a.close}`], ...(a.motif ? [['Motif', a.motif]] : [])];
    if (a.action === 'customRequestStatus') return [['Ce qui change', p.texte], ['Nouveau statut', STATUTS_DITS[a.status] || a.status]];
    if (a.action === 'noteClient') return [['Ce qui s’ajoute', p.texte]];
    if (a.action === 'annulerReservation') {
      return [
        ['Réservation', `n° ${a.reservationId}${r.client ? `, ${r.client}` : ''}`],
        ['Quand', `${r.quand || jourDit(a.date)}${r.heure ? `, ${r.heure}` : ''}`],
        ['Joueurs', r.joueurs ? String(r.joueurs) : ''],
        ['Activités', Array.isArray(r.activites) ? r.activites.join(', ') : ''],
        ...(r.prix != null ? [['Prix', eurosDits(r.prix)]] : []),
        ['Paiement', r.payee ? 'Déjà payée : le remboursement se fait à part' : 'Pas encore payée'],
      ];
    }
    if (a.action === 'effacerConversations') {
      const liste = conversationsAEffacer(a);
      return [
        ['Lesquelles', a.portee === 'anciennes' ? `Plus de ${a.jours} jours, sauf celle-ci` : 'Toutes les autres, sauf celle-ci'],
        ['Combien', liste.length ? `${liste.length} : ${liste.slice(0, 3).map((c) => c.titre || 'Sans titre').join(', ')}${liste.length > 3 ? '…' : ''}` : 'Aucune'],
      ];
    }
    return [['Ce qui change', p.texte]];
  }
  function htmlCarteGeste(p, i) {
    const a = p.action || {};
    const vue = a.action === 'assistantGeste' ? vueDuRegistre(p) : (GESTE_VUE[a.action] || { type: 'Geste', verbe: 'Faire', cours: 'En cours…' });
    const domaine = (p.vue && p.vue.domaine) || DOMAINE_DES_ANCIENS[a.action] || '';
    const mail = a.action === 'assistantGeste' && p.resume && p.resume.mail && typeof p.resume.mail === 'object' ? p.resume.mail : null;
    const titre = a.action === 'noteClient' ? 'Ajouter cette note à la fiche du client.' : String(p.texte || '');
    const lignes = lignesVues(p, titre, mail);
    const changes = lignes.filter(([, v]) => v && typeof v === 'object' && (v.avant !== undefined || v.apres !== undefined));
    const faits = lignes.filter((l) => !changes.includes(l));
    const centre = p.centre && plusieursCentres() ? `<span class="ast-carte-centre">${esc(nomDUnCentre(p.centre))}</span>` : '';
    if (p.etat === 'fait') {
      const dit = a.action === 'assistantReservation' && p.reservation
        ? `Réservation n° ${esc(p.reservation.id)} créée : ${esc(jourDit(p.reservation.date))} à ${esc(p.reservation.startTime)}, ${esc(p.reservation.pax)} joueurs.`
        : a.action === 'annulerReservation' ? `Réservation n° ${esc(a.reservationId)} annulée. Le créneau est libre.`
          : a.action === 'effacerConversations' ? (p.efface ? `${esc(p.efface)} conversation${p.efface > 1 ? 's effacées' : ' effacée'}.` : 'Aucune conversation à effacer.')
            : a.action === 'ouvrirReserver' ? 'La fenêtre Réserver est ouverte, préremplie : vérifiez-la et confirmez.'
              : a.action === 'assistantGeste' ? esc((p.resume && p.resume.fait) || `C’est fait. ${p.texte}`) : `C’est fait. ${esc(p.texte)}`;
      const voir = a.action === 'assistantReservation' && p.reservation ? `<button type="button" class="ast-bouton est-contour" data-ast-geste-voir="${i}">Voir au planning</button>` : '';
      const quand = heureFaite(p.faitA);
      return `<div class="ast-carte est-faite" data-ast-prop="${i}">
        <div class="ast-carte-tete"><span class="ast-carte-icone est-fait">${svgDe(ICONES.coche)}</span><div class="ast-carte-titres"><p class="ast-carte-sur"><span class="ast-carte-type">${esc(vue.type)}</span>${centre}${quand ? `<span class="ast-carte-quand">${esc(quand)}</span>` : ''}</p><p class="ast-carte-fait">${dit}</p></div></div>
        ${changes.length ? `<dl class="ast-carte-changes est-fige">${changes.map(([k, v]) => htmlChangeFait(k, v)).join('')}</dl>` : ''}
        ${mail ? `<details class="ast-carte-plie"><summary>${p.geste === 'essai_mail' ? 'Voir l’essai envoyé' : 'Voir le mail'}</summary>${htmlMail(p, i, mail, { fige: true })}</details>` : ''}
        ${voir ? `<div class="ast-carte-suite">${voir}</div>` : ''}
      </div>`;
    }
    const enCours = p.etat === 'cours';
    const saisie = p.saisie || {};
    const champs = a.action === 'assistantReservation' ? `<div class="ast-carte-champs">
        <label class="ast-carte-champ${p.manqueTel ? ' est-manque' : ''}"><span>Téléphone du client<em>obligatoire</em></span><input type="tel" inputmode="tel" data-ast-tel="${i}" value="${esc(saisie.tel != null ? saisie.tel : (a.phone || ''))}" placeholder="Ex. 0470 12 34 56" autocomplete="off" aria-required="true"${enCours ? ' disabled' : ''}></label>
        <label class="ast-carte-champ"><span>Nom</span><input data-ast-nom="${i}" value="${esc(saisie.nom != null ? saisie.nom : (a.name || ''))}" placeholder="Nom du client" autocomplete="off"${enCours ? ' disabled' : ''}></label>
      </div>` : '';
    const garde = a.action === 'assistantReservation' ? '<p class="ast-carte-garde">Vérifiée sur le planning à l’instant. Rien ne se crée avant votre clic, et le planning se revérifie à ce moment-là.</p>' : p.risque ? '<p class="ast-carte-garde">Rien ne change avant votre clic, et vous confirmerez une seconde fois.</p>' : p.geste === 'essai_mail' ? '<p class="ast-carte-garde">Rien ne part avant votre clic.</p>' : '<p class="ast-carte-garde">Rien ne change avant votre clic.</p>';
    const alerteDite = p.alerte || (a.action === 'assistantGeste' && p.resume && p.resume.alerte) || '';
    // A la confirmation, le pied redit une phrase de la carte : le bloc qui la portait se retire, pour
    // ne pas la lire deux fois l une sous l autre.
    const redit = p.confirmer ? (vue.suite || p.alerte || '') : '';
    const alerte = alerteDite && alerteDite !== redit ? `<p class="ast-carte-alerte">${svgDe(CHEMIN_ALERTE)}<span>${esc(alerteDite)}</span></p>` : '';
    const clients = a.action === 'assistantGeste' && p.resume && p.resume.clients && p.resume.clients !== redit ? `<p class="ast-carte-clients">${svgDe(CHEMIN_CLIENTS)}<span>${esc(p.resume.clients)}</span></p>` : '';
    const rien = a.action === 'effacerConversations' && !conversationsAEffacer(a).length;
    const modifier = a.action === 'assistantReservation' ? `<button type="button" class="ast-bouton est-contour" data-ast-geste-reserver="${i}"${enCours ? ' disabled' : ''}>Modifier dans Réserver</button>` : '';
    // LE PIED DE LA CARTE (2026-11-12, Ansar : « le bouton comme ça, cette couleur, c'est pas pro ») :
    // une bande sous les lignes, la phrase de garde a gauche, les boutons de la console a droite (le
    // second encadre, puis le principal bleu plein, comme une fenetre de la console).
    const pied = p.confirmer
      ? `<div class="ast-carte-pied ast-carte-confirmer" role="alert"><p class="ast-carte-garde"><b>Vous confirmez ?</b> ${esc(redit || 'Ce geste ne se rattrape pas d’un clic.')}</p>
        <div class="ast-carte-actions">
          <button type="button" class="ast-bouton est-contour" data-ast-geste-retour="${i}"${enCours ? ' disabled' : ''}>Retour</button>
          <button type="button" class="ast-bouton est-danger" data-ast-geste-oui="${i}" data-ast-confirme="1"${enCours ? ' disabled aria-busy="true"' : ''}>${esc(enCours ? vue.cours : (vue.confirmer || `Oui, ${vue.verbe.toLowerCase()}`))}</button>
        </div></div>`
      : `<div class="ast-carte-pied">${rien ? '' : garde}
        <div class="ast-carte-actions">
          <button type="button" class="ast-bouton est-contour" data-ast-prop-non="${i}"${enCours ? ' disabled' : ''}>Non merci</button>
          ${modifier}
          ${rien ? '' : `<button type="button" class="ast-bouton est-plein${p.risque ? ' est-risque' : ''}" data-ast-geste-oui="${i}"${enCours ? ' disabled aria-busy="true"' : ''}>${esc(enCours ? vue.cours : vue.verbe)}</button>`}
        </div></div>`;
    return `<div class="ast-carte${p.risque ? ' est-risque' : ''}${p.confirmer ? ' est-a-confirmer' : ''}" data-ast-prop="${i}">
      <div class="ast-carte-tete"><span class="ast-carte-icone">${svgDe(ICONES_DOMAINE[domaine] || ICONES.crayon)}</span><div class="ast-carte-titres"><p class="ast-carte-sur"><span class="ast-carte-type">${esc(vue.type)}</span>${centre}</p>${titre ? `<p class="ast-carte-titre">${esc(titre)}</p>` : ''}</div></div>
      ${changes.length ? `<dl class="ast-carte-changes">${changes.map(([k, v]) => htmlChange(k, v)).join('')}</dl>` : ''}
      ${mail ? htmlMail(p, i, mail) : ''}
      ${faits.length ? `<dl class="ast-carte-lignes">${faits.map(([k, v]) => `<div class="ast-carte-ligne"><dt>${esc(k)}</dt><dd>${ddDe(v)}</dd></div>`).join('')}</dl>` : ''}
      ${clients}
      ${champs}
      ${alerte}
      ${p.erreur ? `<p class="ast-carte-erreur" role="alert">${esc(p.erreur)}</p>` : ''}
      ${pied}
    </div>`;
  }

  // MODIFIER DANS RESERVER : la fenetre s ouvre avec tout le programme de la carte (activites, durees,
  // parties, participants), le nom et le telephone tapes ; la personne y change ce qu elle veut.
  function ouvrirDansReserver(m, p) {
    const a = p.action || {};
    if (p.centre && p.centre !== centreId()) { p.erreur = `Cette réservation est pour ${nomDUnCentre(p.centre)} : ouvrez ce centre dans la console, puis redemandez.`; peindreMessage(m); return; }
    if (typeof openQuickBook !== 'function') { p.erreur = 'La fenêtre Réserver n’est pas disponible ici.'; peindreMessage(m); return; }
    const i = (m.propositions || []).indexOf(p);
    const champTel = A.root && A.root.querySelector(`[data-ast-tel="${i}"]`);
    const champNom = A.root && A.root.querySelector(`[data-ast-nom="${i}"]`);
    const tel = champTel ? champTel.value.trim() : String(a.phone || '');
    const nom = champNom ? champNom.value.trim() : String(a.name || '');
    openQuickBook({ date: a.date, startTime: a.startTime, heureSouhaitee: true, pax: a.pax, ...(nom ? { name: nom } : {}), ...(tel ? { phone: tel } : {}) });
    const programme = Array.isArray(a.programme) ? a.programme : [];
    if (programme.length && typeof applyStaffRequestActivitiesToQuickBook === 'function') {
      applyStaffRequestActivitiesToQuickBook({ participants: a.pax, activities: programme.map((x) => ({ id: x.activityId, participants: x.participants, ...(x.duration != null ? { duration: x.duration } : {}), ...(x.games != null ? { games: x.games } : {}) })) });
    }
  }

  function htmlPropositions(m) {
    return (m.propositions || []).map((p, i) => {
      if (p.type === 'geste') {
        if (p.etat === 'ecarte') return '';
        return htmlCarteGeste(p, i);
      }
      if (p.etat === 'retenu') return `<p class="ast-prop-fait">Retenu pour tout le centre. <button type="button" class="ast-lien" data-ast-savoir>Voir ce que l'IA a appris</button></p>`;
      if (p.etat === 'ecarte') return '';
      return `<div class="ast-prop" data-ast-prop="${i}">
        <p class="ast-prop-quoi">Je retiens ça pour tout le centre ?</p>
        <p class="ast-prop-texte">${esc(p.texte)}</p>
        <div class="ast-prop-actions">
          <button type="button" class="ast-bouton est-plein" data-ast-prop-oui="${i}">Retenir</button>
          <button type="button" class="ast-bouton est-contour" data-ast-prop-non="${i}">Non merci</button>
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
        <button type="button" class="ast-bouton est-contour" data-ast-corriger-fermer>Annuler</button>
      </div>
    </form>`;
  }

  function htmlPied(m, dernier) {
    if (m.statut === 'cours') return m.verification ? `<p class="ast-verif ast-travail" role="status">${SIGNE}Vérification des chiffres</p>` : '';
    if (m.statut === 'erreur') return `<p class="ast-erreur" role="alert">${esc(m.erreur)}</p><div class="ast-pied"><button type="button" class="ast-pill" data-ast-refaire>Réessayer</button></div>`;
    const nb = (m.sources || []).length;
    const sans = (m.preuves || []).length && m.verite && Array.isArray(m.verite.chiffresSansSource) ? m.verite.chiffresSansSource : [];
    const alerte = sans.length
      ? `<p class="ast-alerte">${sans.length > 1 ? `Je n'ai pas retrouvé ${sans.length} chiffres dans vos données (${esc(sans.join(', '))}). Ils sont soulignés en orange, ne vous en servez pas sans les vérifier.` : `Je n'ai pas retrouvé un chiffre dans vos données (${esc(sans[0])}). Il est souligné en orange, ne vous en servez pas sans le vérifier.`}</p>`
      : '';
    const retire = m.retires ? `<p class="ast-retire">${m.retires > 1 ? `J'ai repris ${m.retires} chiffres que je ne retrouvais pas dans vos données avant de vous répondre.` : "J'ai repris un chiffre que je ne retrouvais pas dans vos données avant de vous répondre."}</p>` : '';
    return `${m.statut === 'arrete' ? '<p class="ast-arrete">Réponse arrêtée.</p>' : ''}${alerte}${retire}${htmlAllers(m)}${htmlPropositions(m)}
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
    if (genre === 'barres') barresMaison(hote, etiquettes, valeurs, type);
    else window.PinlaneCharts.lineChart(hote, options);
  }

  const dom = (sel) => (A.root ? A.root.querySelector(sel) : null);

  function peindreListe() {
    const hote = dom('[data-ast-convs]');
    if (!hote) return;
    majPied();
    const premiere = !hote.querySelector('.ast-conv');
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
    // La premiere fois que la liste se remplit, ses lignes arrivent l une apres l autre.
    if (premiere && !sansMouvement()) [...hote.children].slice(0, 14).forEach((x, i) => x.animate([{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: i * 20, easing: 'cubic-bezier(.165,.84,.44,1)', fill: 'backwards' }));
  }

  function peindreFil({ neuf = 0, garder = false } = {}) {
    const hote = dom('[data-ast-colonne]');
    const racine = dom('.ast');
    const fil = dom('[data-ast-fil]');
    if (!hote || !racine || !fil) return;
    const c = courante();
    const messages = c ? (c.messages || []) : [];
    const position = fil.scrollTop;
    racine.classList.toggle('est-vide', !c || !messages.length);
    if (!messages.length) {
      const phrase = `Que voulez-vous savoir sur ${nomDuCentre()} ?`;
      const salut = hote.querySelector('.ast-salut');
      // L accueil deja la ne rejoue pas son entree.
      if (c) hote.innerHTML = `<p class="ast-pense ast-travail">${SIGNE}Lecture de la conversation</p>`;
      else if (!salut || salut.textContent !== phrase) hote.innerHTML = `<h1 class="ast-salut">${esc(phrase)}</h1>`;
    } else {
      hote.innerHTML = messages.map((m, i) => htmlMessage(m, i, messages, i >= messages.length - neuf)).join('');
      hote.querySelectorAll('[data-ast-i]').forEach((a) => dessinerGraphiques(a, messages[Number(a.dataset.astI)]));
    }
    const sugg = dom('[data-ast-suggestions]');
    if (sugg) sugg.hidden = Boolean(messages.length);
    const titre = dom('[data-ast-tete-titre]');
    if (titre) titre.textContent = (c && c.titre) || 'Marketing';
    if (garder && !A.suivi) { fil.scrollTop = position; majDescendre(); } else versLeBas(false);
    ajusterHauteur();
  }

  // Le message envoye se pose a la fin du fil : les autres ne sont pas reconstruits.
  function poserDerniers(c, n) {
    const hote = dom('[data-ast-colonne]');
    const depart = c.messages.length - n;
    hote.insertAdjacentHTML('beforeend', c.messages.slice(depart).map((m, j) => htmlMessage(m, depart + j, c.messages, true)).join(''));
    const avant = c.messages[depart - 1];
    const article = avant && dom(`[data-ast-i="${depart - 1}"] [data-ast-basdepage]`);
    if (article) article.innerHTML = htmlPied(avant, false);
  }

  // Un seul message change pendant l ecriture : le reste de la page ne bouge pas.
  // Le texte qui arrive se fond vers le bas. A la fin, le fondu se retire au lieu de disparaitre d un coup.
  const VOILE_DU_TEXTE = 'linear-gradient(to bottom, #000 calc(100% - min(var(--ast-voile-bas, 0px), 45%)), transparent)';
  function marquerFlux(zone, enCours) {
    if (zone.classList.contains('est-flux') && !enCours && !sansMouvement()) {
      zone.animate([{ maskImage: VOILE_DU_TEXTE, '--ast-voile-bas': '44px' }, { maskImage: VOILE_DU_TEXTE, '--ast-voile-bas': '0px' }], { duration: 320, easing: 'ease-out' });
    }
    zone.classList.toggle('est-flux', enCours);
  }

  const dernierHtml = new WeakMap();
  function poserSiChange(hote, html) {
    if (dernierHtml.get(hote) === html && hote.firstChild) return;
    dernierHtml.set(hote, html);
    hote.innerHTML = html;
  }

  // LE TEXTE QUI S ECRIT (2026-11-12, Ansar : « pas d'effet dans ces messages pas d'animation »).
  // Pendant l ecriture, la zone n est plus refaite a chaque image. Un bloc deja pose ne bouge plus, un
  // bloc neuf entre en montant, et ce qui s ajoute au bloc en cours apparait en fondu, mot apres mot.
  // Un bloc qui change autrement que par un ajout (un tableau qui se forme, une liste qui commence)
  // se refait seul. A la fin, la reponse se pose une fois, avec ses chiffres relies a leur preuve.
  const ecritures = new WeakMap();
  const enNoeud = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; };
  // Les classes du fondu ne comptent pas : un element pose en fondu reste le meme element.
  const attributsDe = (el) => [...el.attributes].map((x) => `${x.name}=${x.name === 'class' ? x.value.replace(/\bast-(?:bloc-)?neuf\b/g, '').trim() : x.value}`).filter((x) => x !== 'class=').sort().join('|');
  const memeElement = (a, b) => Boolean(a && b) && a.nodeType === 1 && b.nodeType === 1 && a.tagName === b.tagName && attributsDe(a) === attributsDe(b);
  // Ajoute a l element vivant ce que le rendu neuf a de plus que l ancien, si le neuf ne fait que
  // prolonger l ancien par la fin. Faux sinon, et rien n est touche.
  function prolonger(vif, ancien, neuf) {
    const a = ancien.childNodes;
    const n = neuf.childNodes;
    if (n.length < a.length) return false;
    const k = a.length - 1;
    for (let i = 0; i < k; i += 1) if (!a[i].isEqualNode(n[i])) return false;
    const ajouts = [];
    if (k >= 0 && !a[k].isEqualNode(n[k])) {
      if (a[k].nodeType === 3 && n[k].nodeType === 3 && n[k].data.startsWith(a[k].data)) ajouts.push(document.createTextNode(n[k].data.slice(a[k].data.length)));
      else if (!(memeElement(a[k], n[k]) && memeElement(vif.lastElementChild, a[k]) && prolonger(vif.lastElementChild, a[k], n[k]))) return false;
    }
    for (let i = a.length; i < n.length; i += 1) ajouts.push(n[i].cloneNode(true));
    ajouts.forEach((x) => {
      if (x.nodeType === 1) { x.classList.add('ast-neuf'); vif.appendChild(x); return; }
      const mot = document.createElement('span');
      mot.className = 'ast-neuf';
      mot.appendChild(x);
      vif.appendChild(mot);
    });
    return true;
  }
  function poserTexte(zone, m) {
    if (m.statut !== 'cours' || !m.texte || sansMouvement()) {
      if (ecritures.has(zone)) { ecritures.delete(zone); dernierHtml.delete(zone); }
      poserSiChange(zone, htmlTexte(m));
      return;
    }
    const blocs = blocsMarkdown(htmlTexteBrut(m), m);
    let e = ecritures.get(zone);
    if (!e || zone.childElementCount !== e.noeuds.length) {
      // Rien d ecrit encore : les blocs entreront. Un fil repeint en pleine ecriture reprend son texte
      // tel quel, sans le rejouer.
      const depart = !zone.querySelector(':scope > :not(.ast-pense)');
      e = { html: [], noeuds: [] };
      ecritures.set(zone, e);
      dernierHtml.delete(zone);
      if (!depart) {
        zone.innerHTML = blocs.join('');
        e.html = blocs.slice();
        e.noeuds = blocs.map(enNoeud);
        return;
      }
      zone.textContent = '';
    }
    blocs.forEach((html, i) => {
      if (e.html[i] === html) return;
      const neuf = enNoeud(html);
      const vif = zone.children[i];
      if (!vif) {
        const bloc = neuf.cloneNode(true);
        bloc.classList.add('ast-bloc-neuf');
        zone.appendChild(bloc);
      } else if (!(memeElement(vif, e.noeuds[i]) && memeElement(e.noeuds[i], neuf) && prolonger(vif, e.noeuds[i], neuf))) {
        const bloc = neuf.cloneNode(true);
        if (vif.tagName !== bloc.tagName) bloc.classList.add('ast-bloc-neuf');
        zone.replaceChild(bloc, vif);
      }
      e.html[i] = html;
      e.noeuds[i] = neuf;
    });
    while (zone.childElementCount > blocs.length) zone.lastElementChild.remove();
    e.html.length = blocs.length;
    e.noeuds.length = blocs.length;
  }

  // LA REPONSE GRANDIT EN DOUCEUR (2026-11-13, Ansar : « le texte apparait en bas, c est pas fluide,
  // ca cree des petits sauts »). Chaque ligne neuve allongeait la reponse d un coup : la verification,
  // le pied et la vue qui suit le bas sautaient d une ligne a chaque fois. Pendant l ecriture, la zone
  // du texte rejoint la hauteur de son contenu en glissant (une approche douce, environ 200 ms pour
  // une ligne), la ligne neuve se decouvre sous le fondu, et tout ce qui suit glisse avec elle. A la
  // fin, la zone rend sa hauteur au contenu. Sans mouvement, rien de tout ca.
  const hauteursSuivies = new WeakMap();
  function hauteurDuContenu(zone) {
    const dernier = zone.lastElementChild;
    if (!dernier) return 0;
    const marge = parseFloat(getComputedStyle(dernier).marginBottom) || 0;
    return Math.max(0, dernier.getBoundingClientRect().bottom + marge - zone.getBoundingClientRect().top);
  }
  function lacherLaHauteur(zone, s) {
    if (s.image) cancelAnimationFrame(s.image);
    hauteursSuivies.delete(zone);
    zone.style.height = '';
    zone.style.overflow = '';
  }
  function pasDeHauteur(zone, s, t) {
    s.image = 0;
    if (!zone.isConnected) { hauteursSuivies.delete(zone); return; }
    const dt = Math.min(Math.max(t - s.avant, 0), 50);
    s.avant = t;
    const vise = hauteurDuContenu(zone);
    s.h += (vise - s.h) * (1 - Math.exp(-dt / 70));
    if (Math.abs(vise - s.h) < 0.5) s.h = vise;
    zone.style.height = `${s.h}px`;
    if (s.h === vise) {
      if (!s.enCours) lacherLaHauteur(zone, s);
      return;
    }
    s.image = requestAnimationFrame((x) => pasDeHauteur(zone, s, x));
  }
  function suivreLaHauteur(zone, enCours) {
    let s = hauteursSuivies.get(zone);
    if (sansMouvement()) { if (s) lacherLaHauteur(zone, s); return; }
    if (!s) {
      if (!enCours) return;
      s = { h: zone.getBoundingClientRect().height, image: 0, avant: 0, enCours: true };
      hauteursSuivies.set(zone, s);
      zone.style.overflow = 'hidden';
      zone.style.height = `${s.h}px`;
    }
    s.enCours = enCours;
    if (!s.image) { s.avant = performance.now(); s.image = requestAnimationFrame((t) => pasDeHauteur(zone, s, t)); }
  }

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
    // Pendant le pli, rien d autre ne se peint.
    if (haut.querySelector('[data-pliage]')) return;
    if (m.statut === 'cours' && !m.texte) majRecherche(haut, m);
    else if (haut.querySelector('[data-lu-direct]')) { if (replierLecture(haut, m, article)) return; }
    else if (m.statut !== 'cours' || !haut.querySelector('[data-ast-recherche]')) haut.innerHTML = htmlRecherche(m);
    const zone = article.querySelector('[data-ast-texte]');
    poserTexte(zone, m);
    marquerFlux(zone, m.statut === 'cours' && Boolean(m.texte));
    suivreLaHauteur(zone, m.statut === 'cours' && Boolean(m.texte));
    poserSiChange(article.querySelector('[data-ast-basdepage]'), htmlPied(m, i === c.messages.length - 1));
    dessinerGraphiques(article, m);
    majDescendre();
  }

  // ---- Suivre le texte, comme Claude Code -------------------------------------------
  // La vue reste au bas tant que la personne ne remonte pas elle-meme : un geste de moins de 150 ms,
  // a plus de 8 px du bas, et un contenu qui n a pas retreci. Le reste du temps, c est le programme
  // ou le texte qui bouge, et on ne decroche pas.
  const SEUIL_BAS = 8;
  const SEUIL_FLECHE = 200;
  const GESTE_RECENT = 150;

  function majDescendre() {
    const fil = dom('[data-ast-fil]');
    const bouton = dom('[data-ast-descendre]');
    const bande = dom('[data-ast-bande]');
    if (!fil || !bouton) return;
    const reste = fil.scrollHeight - fil.scrollTop - fil.clientHeight;
    const visible = !A.suivi && reste > SEUIL_FLECHE;
    bouton.classList.toggle('est-visible', visible);
    bouton.classList.toggle('est-flux', Boolean(A.flux));
    bouton.inert = !visible;
    if (bande) bande.classList.toggle('est-visible', !A.suivi && reste > SEUIL_BAS);
  }

  function arreterGlisse() {
    if (A.glisse) cancelAnimationFrame(A.glisse);
    A.glisse = 0;
  }

  // Le glissement dure 200 ms. Son pas de temps est plafonne : une image lente ne fait pas sauter la
  // vue. Un geste l interrompt. La cible se relit a chaque image, le texte peut pousser entre-temps.
  function versLeBas(doux) {
    const fil = dom('[data-ast-fil]');
    if (!fil) return;
    A.suivi = true;
    arreterGlisse();
    if (!doux || sansMouvement()) { fil.scrollTop = fil.scrollHeight; majDescendre(); return; }
    const depart = fil.scrollTop;
    const lance = performance.now();
    let cumul = 0;
    let avant = null;
    const pas = (t) => {
      if (A.dernierGeste > lance) { A.glisse = 0; return; }
      cumul += Math.min(avant === null ? 16 : t - avant, 34);
      avant = t;
      const p = Math.min(1, cumul / 200);
      const vise = fil.scrollHeight - fil.clientHeight;
      fil.scrollTop = depart + (vise - depart) * (1 - (1 - p) ** 3);
      if (p < 1) { A.glisse = requestAnimationFrame(pas); return; }
      A.glisse = 0;
      fil.scrollTop = fil.scrollHeight;
      majDescendre();
    };
    A.glisse = requestAnimationFrame(pas);
  }

  function arreterDeSuivre() {
    if (!A.flux) { A.suivi = false; arreterGlisse(); }
  }

  function surDefilement() {
    const fil = dom('[data-ast-fil]');
    if (!fil) return;
    const haut = fil.scrollTop;
    const hauteur = fil.scrollHeight;
    const monte = haut < A.vuHaut;
    const retreci = hauteur < A.vuHauteur;
    A.vuHaut = haut;
    A.vuHauteur = hauteur;
    const reste = Math.floor(hauteur - haut - fil.clientHeight);
    if (reste < SEUIL_BAS) A.suivi = true;
    else if (monte && !retreci && performance.now() - A.dernierGeste < GESTE_RECENT) { A.suivi = false; arreterGlisse(); }
    majDescendre();
  }

  // Le texte qui pousse, un graphique qui arrive ou la fenetre qui change recalent la vue au bas.
  function observerLeFil(fil, colonne) {
    if (A.observateur) A.observateur.disconnect();
    A.observateur = new ResizeObserver(() => {
      if (A.suivi && !A.glisse) fil.scrollTop = fil.scrollHeight;
      majDescendre();
    });
    A.observateur.observe(fil);
    A.observateur.observe(colonne);
  }

  function peindreCompo() {
    const envoi = dom('[data-ast-envoi]');
    const champ = dom('[data-ast-champ]');
    if (!envoi || !champ) return;
    const enCours = Boolean(A.flux);
    envoi.classList.toggle('est-arret', enCours);
    dom('.ast').classList.toggle('est-occupe', enCours);
    if (envoi.dataset.etat !== (enCours ? 'arret' : 'envoi')) {
      if (enCours) fantome(envoi.firstElementChild, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-16px)' }], { duree: 200 });
      envoi.dataset.etat = enCours ? 'arret' : 'envoi';
      envoi.innerHTML = enCours ? '<span class="ast-carre" aria-hidden="true"></span>' : icone('fleche');
    }
    envoi.setAttribute('aria-label', enCours ? 'Arrêter' : 'Envoyer');
    envoi.disabled = !enCours && !champ.value.trim();
    const bouton = dom('[data-ast-modele]');
    bouton.querySelector('span').textContent = nomModele(A.modele);
    bouton.setAttribute('aria-expanded', A.menuModele ? 'true' : 'false');
    const menu = dom('[data-ast-menu]');
    if (!A.menuModele && !menu.hidden) fantome(menu, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px) scale(.97)' }], { duree: 140 });
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
    const fil = dom('[data-ast-fil]');
    if (fil) racine.style.setProperty('--ast-goutte', `${fil.offsetWidth - fil.clientWidth}px`);
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
    const plusieurs = plusieursCentres();
    const tete = `<div class="ast-src-tete"><div><h2>Ce que l'IA a appris</h2><p class="ast-src-detail">Ce que votre équipe lui a appris. Elle s'en sert aussitôt, pour toutes les personnes ${plusieurs ? 'de vos centres' : 'du centre'}.</p></div>${fermer}</div>`;
    if (!S.charge) return `${tete}<p class="ast-pense ast-travail">${SIGNE}Lecture</p>`;
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
      // Un fait d un autre centre du client : l IA s en sert ici aussi ; il se change depuis son centre.
      if (f.centreId && f.centreId !== centreId()) return `<li class="ast-fait est-ailleurs" data-ast-fait-ligne="${f.id}"><p>${esc(f.texte)}</p><p class="ast-fait-meta"><span class="ast-fait-centre">Appris à ${esc(f.centre || f.centreId)}</span>. ${meta}</p></li>`;
      if (S.aRetirer === f.id) return `<li class="ast-fait" data-ast-fait-ligne="${f.id}"><p>${esc(f.texte)}</p><p class="ast-fait-meta">Retirer ce fait pour tout le centre ?</p><div class="ast-prop-actions"><button type="button" class="ast-bouton est-plein" data-ast-fait-retirer-oui="${f.id}">Retirer</button><button type="button" class="ast-bouton est-contour" data-ast-fait-retirer-non>Annuler</button></div></li>`;
      if (S.edition === f.id) return `<li class="ast-fait" data-ast-fait-ligne="${f.id}"><form data-ast-fait-form="${f.id}"><textarea class="ast-champ-court" data-ast-fait-texte rows="3" maxlength="${FAIT_MAX}" aria-label="Le fait à retenir">${esc(f.texte)}</textarea><div class="ast-prop-actions"><button type="submit" class="ast-bouton est-plein">Enregistrer</button><button type="button" class="ast-bouton est-contour" data-ast-fait-annuler>Annuler</button></div></form></li>`;
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
  function ouvrirPanneau(m, id, ouvreur, preuve = null) {
    A.panneau = { message: m, id, preuve };
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
    if (!A.panneau && !hote.hidden) fantome(hote, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px)' }], { duree: 200 });
    if (A.panneau && hote.hidden && !sansMouvement()) requestAnimationFrame(() => [...hote.children].slice(0, 8).forEach((x, i) => x.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: 50 + i * 35, easing: 'cubic-bezier(.165,.84,.44,1)', fill: 'backwards' })));
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
    const { message: m, id, preuve } = A.panneau;
    const blocPreuve = !preuve ? '' : `<div class="ast-preuve${preuve.e === 'inconnu' ? ' est-douteux' : ''}"><b>${esc(preuve.t)}</b><span>${esc(preuve.e === 'inconnu' ? "Ce chiffre n'a pas été retrouvé dans les données lues pour cette réponse. Vérifiez-le avant de vous en servir." : preuve.l || '')}</span>${(preuve.a || []).length ? `<span class="ast-preuve-aussi">Même valeur ici aussi, ${esc(preuve.a.map((x) => x.l).join(' · '))}</span>` : ''}</div>`;
    const sources = m.sources || [];
    const source = id ? sources.find((s) => s.id === id) : null;
    const fermer = `<button type="button" class="ast-icone" data-ast-panneau-fermer aria-label="Fermer">${icone('fermer')}</button>`;
    if (!source) {
      hote.innerHTML = `<div class="ast-src-tete"><h2>Sources de cette réponse</h2>${fermer}</div>${blocPreuve}
      <ol class="ast-src-liste">${sources.map((s) => `<li><button type="button" class="ast-src-ligne" data-ast-source="${esc(s.id)}"><span class="ast-cite">${esc(s.id.slice(1))}</span><span>${esc(s.titre)}</span></button></li>`).join('')}</ol>`;
    } else {
      const lien = source.lien && PAGES[source.lien.page];
      const tete = source.colonnes.map((c) => `<th scope="col"${c.type && c.type !== 'texte' ? ' class="est-chiffre"' : ''}>${esc(c.nom)}</th>`).join('');
      const pareilQueLeTableau = (t) => source.lignes.length > 0 && t.lignes.length === source.lignes.length && t.colonnes.every((c) => source.colonnes.some((x) => x.cle === c.cle)) && t.lignes.every((l, i) => t.colonnes.every((c) => l[c.cle] === source.lignes[i][c.cle]));
      const sectionDuTableau = (source.sections || []).findIndex(pareilQueLeTableau);
      const corps = source.lignes.map((l, ri) => {
        const repere = (c) => (sectionDuTableau >= 0 ? ` data-ast-case="${sectionDuTableau}:${ri}:${esc(c.cle)}"` : '');
        const cellules = source.colonnes.map((c) => {
          const type = c.type === 'auto' ? l.type : c.type;
          if (type === 'source') return `<td>${!l[c.cle] ? '' : l[c.cle] === 'hypothese' ? 'Hypothèse' : `<button type="button" class="ast-cite" data-ast-source="${esc(l[c.cle])}">${esc(String(l[c.cle]).slice(1))}</button>`}</td>`;
          return `<td${repere(c)}${type && type !== 'texte' && type !== 'client' ? ' class="est-chiffre"' : ''}>${esc(formater(l[c.cle], type))}</td>`;
        }).join('');
        return source.ouvrables && l.reservation ? `<tr class="est-ouvrable" data-ast-reservation="${esc(l.reservation)}" tabindex="0" title="Ouvrir la réservation">${cellules}</tr>` : `<tr>${cellules}</tr>`;
      }).join('');
      const sections = (source.sections || []).map((t, si) => si === sectionDuTableau ? '' : `<h3 class="ast-src-sec">${esc(t.titre)}</h3><div class="ast-table"><table><thead><tr>${t.colonnes.map((c) => `<th scope="col"${c.type !== 'texte' ? ' class="est-chiffre"' : ''}>${esc(c.nom)}</th>`).join('')}</tr></thead><tbody>${t.lignes.map((l, ri) => `<tr>${t.colonnes.map((c) => `<td data-ast-case="${si}:${ri}:${esc(c.cle)}"${typeof l[c.cle] === 'number' ? ' class="est-chiffre"' : ''}>${esc(formater(l[c.cle], c.type))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
      hote.innerHTML = `<div class="ast-src-tete"><div><p class="ast-src-no">Source ${esc(source.id.slice(1))}</p><h2>${esc(source.titre)}</h2></div>${fermer}</div>${blocPreuve}
      ${source.detail ? `<p class="ast-src-detail">${esc(source.detail)}</p>` : ''}
      <div class="ast-src-graph" data-ast-src-graph></div>
      ${source.lignes.length ? `<div class="ast-table"><table><thead><tr>${tete}</tr></thead><tbody>${corps}</tbody></table></div>` : (sections ? '' : '<p class="ast-src-detail">Aucune ligne.</p>')}
      ${sections}
      ${source.coupe ? `<p class="ast-src-detail">Seules les ${LIGNES_GARDEES} premières lignes sont gardées avec la conversation.</p>` : ''}
      ${lien ? `<button type="button" class="ast-pill" data-ast-page="${esc(lien.cle)}">Ouvrir ${esc(lien.nom)}</button>` : ''}
      ${sources.length > 1 ? '<button type="button" class="ast-lien" data-ast-sources>Toutes les sources</button>' : ''}`;
      graphiqueDeSource(hote.querySelector('[data-ast-src-graph]'), source);
      if (preuve && preuve.z) {
        const cases = new Map([...hote.querySelectorAll('[data-ast-case]')].map((n) => [n.dataset.astCase, n]));
        const eclairer = (z, classe) => { const n = cases.get(z.join(':')); if (n) n.classList.add(classe); return n; };
        (preuve.a || []).forEach((x) => eclairer(x.z, 'est-preuve-aussi'));
        const lue = eclairer(preuve.z, 'est-preuve');
        if (lue) lue.scrollIntoView({ block: 'center' });
      }
    }
    const premier = hote.querySelector('[data-ast-panneau-fermer]');
    if (premier) premier.focus({ preventScroll: true });
  }

  // Un tableau d au moins deux lignes avec une colonne de chiffres se lit aussi d un coup d oeil.
  function graphiqueDeSource(hote, source) {
    if (!hote || !window.PinlaneCharts || source.lignes.length < 2 || source.lignes.length > 40) return;
    const [axe, ...reste] = source.colonnes;
    const mesure = reste.find((c) => ['entier', 'euro', 'pct', 'dec'].includes(c.type));
    if (!axe || !mesure || axe.type !== 'texte' || reste.some((c) => c.type === 'texte' || c.type === 'source')) return;
    const points = source.lignes.filter((l) => typeof l[mesure.cle] === 'number');
    if (points.length < 2) return;
    const temps = /^(jour|semaine|mois|annee)$/.test(axe.cle);
    dessiner(hote, temps ? 'courbe' : 'barres', points.map((l) => String(l[axe.cle])), points.map((l) => l[mesure.cle]), mesure.type, `src-${source.id}-${points.length}`);
  }

  // ---- Les sorties ---------------------------------------------------------------------
  // Rien n attend une animation : ce qui s en va est retire tout de suite, et sa copie joue la sortie
  // au-dessus de la page, sans aucun attribut que le code pourrait retrouver.
  function fantome(el, images, { duree = 220, delai = 0, dans = dom('.ast') } = {}) {
    const racine = dans;
    if (!racine || !el || sansMouvement() || !el.getClientRects().length) return null;
    const r = el.getBoundingClientRect();
    const base = racine.getBoundingClientRect();
    const style = getComputedStyle(el);
    const copie = el.cloneNode(true);
    [copie, ...copie.querySelectorAll('*')].forEach((n) => {
      [...n.attributes].forEach((a) => { if (a.name === 'id' || a.name === 'for' || /^data-(ast|lu)/.test(a.name)) n.removeAttribute(a.name); });
      n.style.animation = 'none';
    });
    copie.classList.add('ast-fantome');
    copie.setAttribute('aria-hidden', 'true');
    copie.inert = true;
    Object.assign(copie.style, { left: `${r.left - base.left}px`, top: `${r.top - base.top}px`, width: `${r.width}px`, height: `${r.height}px`, color: style.color, textAlign: style.textAlign });
    racine.appendChild(copie);
    if (el.scrollTop) copie.scrollTop = el.scrollTop;
    const anim = copie.animate(images, { duration: duree, delay: delai, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'both' });
    anim.onfinish = () => copie.remove();
    anim.oncancel = () => copie.remove();
    return copie;
  }

  // Le premier envoi : la phrase d accueil monte et s efface, les suggestions descendent une a une.
  function sortirAccueil() {
    fantome(dom('.ast-salut'), [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-14px) scale(.985)' }], { duree: 260 });
    const puces = dom('[data-ast-suggestions]');
    if (puces) [...puces.children].forEach((x, i) => fantome(x, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px)' }], { duree: 180, delai: i * 26, dans: dom('.ast-chat') }));
  }

  // Changer de conversation : seuls les messages visibles jouent la sortie, coupes au bord du fil.
  function sortirFil() {
    const fil = dom('[data-ast-fil]');
    const hote = dom('[data-ast-colonne]');
    if (!fil || !hote || sansMouvement()) return;
    const vue = fil.getBoundingClientRect();
    [...hote.children].forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom <= vue.top || r.top >= vue.bottom) return;
      const copie = fantome(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px)' }], { duree: 180 });
      if (copie) copie.style.clipPath = `inset(${Math.max(0, vue.top - r.top)}px 0 ${Math.max(0, r.bottom - vue.bottom)}px 0)`;
    });
  }

  function entrerFil() {
    const hote = dom('[data-ast-colonne]');
    if (hote && !sansMouvement()) hote.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: 60, easing: 'cubic-bezier(.165,.84,.44,1)', fill: 'backwards' });
  }

  // ---- Poser une question ------------------------------------------------------------
  function nouvelleConversation() {
    const avant = hautDuChamp();
    if (courante()) sortirFil();
    A.actuelle = '';
    A.panneau = null;
    peindrePanneau();
    peindreListe();
    peindreFil();
    glisserLeChamp(avant);
    const champ = dom('[data-ast-champ]');
    if (champ) champ.focus();
    fermerListe();
  }

  function hautDuChamp() {
    const compo = dom('[data-ast-compo]');
    return compo ? compo.getBoundingClientRect().top : 0;
  }
  function glisserLeChamp(avant) {
    const bas = dom('.ast-bas');
    if (!bas || sansMouvement()) return;
    const ecart = avant - hautDuChamp();
    if (Math.abs(ecart) < 2) return;
    bas.animate([{ transform: `translateY(${ecart}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.32,.72,0,1)' });
  }

  function pourLeServeur(conversation, jusqua) {
    return conversation.messages
      .slice(0, conversation.messages.indexOf(jusqua))
      .filter((m) => m.texte && m.statut !== 'erreur')
      .map((m) => ({ role: m.role, content: m.texte }));
  }

  // Les lectures deja faites avant cette question : l outil et ses reglages, une fois chacune. Le
  // serveur les refait lui-meme, rien de ce qui est envoye ici n est cru sur parole.
  function dossierDe(conversation, jusqua) {
    const vues = new Map();
    conversation.messages.slice(0, conversation.messages.indexOf(jusqua)).forEach((m) => {
      if (m.role !== 'assistant' || m.statut === 'erreur') return;
      [...(m.etapes || []), ...(m.repris || [])].forEach((e) => {
        if (!e || !e.lecture || !e.lecture.outil) return;
        vues.set(`${e.lecture.outil} ${JSON.stringify(e.lecture.entree || {})}`, e.lecture);
      });
    });
    return [...vues.values()].slice(-24);
  }

  async function poser(conversation, reponse) {
    const coupure = new AbortController();
    A.flux = coupure;
    // Arreter montre tout de suite le texte deja recu.
    coupure.signal.addEventListener('abort', () => viderPlume(reponse));
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
        body: JSON.stringify({ centerId: conversation.centerId || centreId(), modele: A.modele, messages: pourLeServeur(conversation, reponse), dossier: dossierDe(conversation, reponse) }),
      });
      if (!/event-stream/.test(envoi.headers.get('content-type') || '')) {
        const corps = await envoi.json().catch(() => ({}));
        if (envoi.status === 401 && typeof clearStaffAuthSession === 'function') {
          clearStaffAuthSession();
          if (typeof applyAuthState === 'function') applyAuthState();
        }
        throw Object.assign(new Error(corps.message || "L'assistant est indisponible pour le moment."), { lisible: true });
      }
      await lireLeFlux(envoi, reponse, coupure.signal);
      if (reponse.statut === 'cours') throw Object.assign(new Error("La réponse s'est arrêtée avant la fin. Réessayez."), { lisible: true });
    } catch (erreur) {
      if (erreur && erreur.name === 'AbortError') reponse.statut = 'arrete';
      else {
        reponse.statut = 'erreur';
        reponse.erreur = erreur && erreur.lisible ? erreur.message : 'La connexion a été coupée. Réessayez.';
      }
    } finally {
      viderPlume(reponse);
      A.flux = null;
      conversation.maj = Date.now();
      sauver(conversation);
      peindreMessage(reponse);
      const ecrite = courante() === conversation ? dom(`[data-ast-i="${conversation.messages.indexOf(reponse)}"]`) : null;
      if (ecrite) ecrite.classList.add('vient-d-ecrire');
      peindreCompo();
      peindreListe();
    }
  }

  // LE RYTHME DU TEXTE (2026-11-12). Le modele envoie souvent sa reponse entiere en une seconde, et
  // elle tombait d un bloc. Le texte recu attend ici et s ecrit a un rythme qu on suit des yeux, un
  // mot entier a la fois, plus vite quand il en reste beaucoup : il n a jamais plus d une seconde
  // environ de retard. La fin, la verification et une erreur attendent qu il soit ecrit. Sans
  // mouvement, ou l onglet cache, tout s ecrit d un coup.
  const RYTHME_MIN = 180;
  const RYTHME_MAX = 1100;
  const RATTRAPAGE = 0.9;
  const plumes = new WeakMap();
  const plumesActives = new Set();
  function ecrire(m, morceau) {
    let p = plumes.get(m);
    if (!p) { p = { m, reste: '', credit: 0, image: 0, avant: 0, attentes: [] }; plumes.set(m, p); }
    p.reste += morceau;
    if (sansMouvement() || document.hidden) { viderPlume(m); return; }
    plumesActives.add(p);
    if (!p.image) { p.avant = performance.now(); p.image = requestAnimationFrame((t) => avancer(p, t)); }
  }
  function avancer(p, t) {
    p.image = 0;
    const dt = Math.min(Math.max(t - p.avant, 0), 50) / 1000;
    p.avant = t;
    p.credit += Math.min(RYTHME_MAX, Math.max(RYTHME_MIN, p.reste.length / RATTRAPAGE)) * dt;
    let n = Math.floor(p.credit);
    if (n > 0) {
      const blanc = p.reste.slice(n).search(/\s/);
      if (blanc >= 0 && blanc < 16) n += blanc;
      else if (blanc < 0 && p.reste.length - n < 16) n = p.reste.length;
      p.m.texte += p.reste.slice(0, n);
      p.reste = p.reste.slice(n);
      p.credit = Math.max(0, p.credit - n);
      demanderPeinture(p.m);
    }
    if (p.reste) p.image = requestAnimationFrame((x) => avancer(p, x));
    else finirPlume(p);
  }
  function finirPlume(p) {
    plumesActives.delete(p);
    p.credit = 0;
    const attentes = p.attentes;
    p.attentes = [];
    attentes.forEach((f) => f());
  }
  function viderPlume(m) {
    const p = plumes.get(m);
    if (!p) return;
    if (p.image) cancelAnimationFrame(p.image);
    p.image = 0;
    if (p.reste) { m.texte += p.reste; p.reste = ''; demanderPeinture(m); }
    finirPlume(p);
  }
  function oublierPlume(m) {
    const p = plumes.get(m);
    if (p) p.reste = '';
  }
  const texteEcrit = (m) => {
    const p = plumes.get(m);
    return !p || !p.reste ? Promise.resolve() : new Promise((r) => { p.attentes.push(r); });
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) [...plumesActives].forEach((p) => viderPlume(p.m)); });
  const ATTENDENT_LE_TEXTE = /^event: (fin|verification|erreur)$/m;

  // LE LECTEUR DU FLUX, PARTAGE (2026-11-13) : la page Marketing et la page des demandes sur mesure
  // lisent la meme reponse de /api/assistant. Chaque bloc « event / data » devient un appel
  // (type, donnees) ; un commentaire (« : pouls ») ou un bloc illisible ne donne rien. `avant` peut
  // faire attendre un bloc, la page Marketing y attend que le texte deja recu soit ecrit.
  function evenementDu(bloc) {
    if (bloc.startsWith(':')) return null;
    const type = /^event: (.*)$/m.exec(bloc);
    const data = /^data: (.*)$/m.exec(bloc);
    if (!type || !data) return null;
    try { return { type: type[1], donnees: JSON.parse(data[1]) }; } catch (erreur) { return null; }
  }

  async function lireEvenements(envoi, surEvenement, { signal = null, avant = null } = {}) {
    const lecteur = envoi.body.getReader();
    const decodeur = new TextDecoder();
    let tampon = '';
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += decodeur.decode(value, { stream: true });
      let fin = tampon.indexOf('\n\n');
      while (fin >= 0) {
        const bloc = tampon.slice(0, fin);
        tampon = tampon.slice(fin + 2);
        // eslint-disable-next-line no-await-in-loop
        if (avant) await avant(bloc);
        if (signal && signal.aborted) throw Object.assign(new Error('Réponse arrêtée.'), { name: 'AbortError' });
        const evenement = evenementDu(bloc);
        if (evenement) surEvenement(evenement.type, evenement.donnees);
        fin = tampon.indexOf('\n\n');
      }
    }
  }

  async function lireLeFlux(envoi, m, signal = null) {
    await lireEvenements(envoi, (type, d) => traiter(type, d, m), {
      signal,
      async avant(bloc) {
        if (ATTENDENT_LE_TEXTE.test(bloc)) await texteEcrit(m);
      },
    });
  }

  function traiter(type, d, m) {
    switch (type) {
      case 'debut': if (Array.isArray(d.sources)) { A.carte = d.sources; m.carte = d.sources; } break;
      case 'texte': ecrire(m, String(d.delta || '')); return;
      case 'note': oublierPlume(m); m.texte = ''; m.etapes.push({ note: true, libelle: String(d.texte).slice(0, 240) }); break;
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
          if (d.jours) e.jours = d.jours;
          if (d.plage) e.plage = d.plage;
          if (d.blocs) e.blocs = d.blocs;
          if (Array.isArray(d.extraits) && d.extraits.length) {
            e.extraits = [...(e.extraits || []), ...d.extraits].slice(-8);
            e.extraitsVus = (e.extraitsVus || 0) + d.extraits.length;
          }
        }
        break;
      }
      case 'source': m.sources.push(d); break;
      case 'repris': m.repris = Array.isArray(d.lectures) ? d.lectures.slice(0, 24) : []; break;
      case 'verification': m.verification = true; break;
      case 'graphique': m.graphiques.push(d); break;
      case 'proposition': m.propositions = [...(m.propositions || []), { texte: d.texte, etat: '', ...(d.type === 'geste' ? { type: 'geste', geste: d.geste || '', centre: d.centre, action: d.action, ...(d.resume && typeof d.resume === 'object' ? { resume: d.resume } : {}), ...(d.risque === true ? { risque: true } : {}), ...(d.vue && typeof d.vue === 'object' ? { vue: { type: String(d.vue.type || '').slice(0, 80), verbe: String(d.vue.verbe || '').slice(0, 60), cours: String(d.vue.cours || '').slice(0, 40), confirmer: String(d.vue.confirmer || '').slice(0, 60), danger: d.vue.danger === true, domaine: String(d.vue.domaine || '').slice(0, 40) } } : {}), ...(typeof d.alerte === 'string' && d.alerte ? { alerte: d.alerte.slice(0, 300) } : {}) } : {}) }]; break;
      case 'aller': if (PAGES_OUVRABLES.includes(d.page) && !(m.allers || []).some((a) => a.id === d.id)) m.allers = [...(m.allers || []), { id: d.id, page: d.page, rubrique: d.rubrique || '', chemin: d.chemin }]; break;
      case 'annule': oublierPlume(m); m.texte = ''; break;
      case 'fin':
        m.texte = d.texte;
        m.verite = d.verite || null;
        m.preuves = d.preuves || [];
        m.verification = false;
        m.modele = d.modele || '';
        m.faitsCites = d.faitsCites || [];
        m.retires = Number(d.corrige) || 0;
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
    const avant = hautDuChamp();
    let c = courante();
    const neuve = !c;
    if (!c) {
      c = { id: uid(), titre: question.slice(0, 60), maj: Date.now(), messages: [], centerId: centreId() };
      A.conversations.unshift(c);
      A.actuelle = c.id;
    }
    if (!Array.isArray(c.messages)) return;
    // La place gardee sous une reponse courte se rend au message suivant.
    if (A.root) A.root.querySelectorAll('[data-ast-i]').forEach((a) => { a.style.minHeight = ''; });
    const commence = !c.messages.length;
    c.messages.push({ role: 'user', texte: question });
    const reponse = { id: uid(), role: 'assistant', texte: '', sources: [], graphiques: [], etapes: [], repris: [], propositions: [], statut: 'cours' };
    c.messages.push(reponse);
    c.maj = Date.now();
    A.conversations = [c, ...A.conversations.filter((x) => x !== c)];
    const champ = dom('[data-ast-champ]');
    if (champ) { champ.value = ''; ajusterChamp(); }
    peindreListe();
    if (neuve) { const ligne = dom(`[data-ast-conv="${CSS.escape(c.id)}"]`); if (ligne) ligne.closest('.ast-conv').classList.add('is-neuve'); }
    if (commence) { sortirAccueil(); peindreFil({ neuf: 2 }); glisserLeChamp(avant); }
    else poserDerniers(c, 2);
    versLeBas(!commence);
    poser(c, reponse);
  }

  function refaire() {
    const c = courante();
    if (!c || A.flux) return;
    const derniere = c.messages[c.messages.length - 1];
    if (!derniere || derniere.role !== 'assistant') return;
    Object.assign(derniere, { id: uid(), texte: '', sources: [], graphiques: [], etapes: [], repris: [], retires: 0, propositions: [], statut: 'cours', verite: null, erreur: '', modele: '', correction: false, corrige: false, faitsCites: [] });
    A.panneau = null;
    peindrePanneau();
    const i = c.messages.length - 1;
    const article = dom(`[data-ast-i="${i}"]`);
    if (article) article.outerHTML = htmlMessage(derniere, i, c.messages, false);
    versLeBas(true);
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
    const ligne = dom(`[data-ast-suppr-oui="${CSS.escape(id)}"]`);
    if (ligne) fantome(ligne.closest('.ast-conv'), [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-12px)' }], { duree: 180 });
    if (A.actuelle === id) sortirFil();
    A.conversations = A.conversations.filter((c) => c.id !== id);
    if (A.actuelle === id) { A.actuelle = ''; A.panneau = null; peindrePanneau(); peindreFil(); }
    A.aSupprimer = '';
    sauverSurAppareil(A.stockage === 'serveur' ? [] : undefined);
    peindreListe();
    if (A.stockage === 'serveur') appeler('supprimer', { id }).catch(() => { if (typeof toast === 'function') toast("La suppression n'a pas pu se faire."); });
  }

  async function ouvrir(id) {
    const autre = id !== A.actuelle;
    const avant = hautDuChamp();
    if (autre) { if (courante()) sortirFil(); else sortirAccueil(); }
    A.actuelle = id;
    A.aSupprimer = '';
    A.panneau = null;
    peindrePanneau(); peindreListe(); peindreFil(); fermerListe();
    if (autre) { glisserLeChamp(avant); entrerFil(); }
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
    if ((n = v('[data-ast-descendre]'))) { versLeBas(true); return; }
    if ((n = v('[data-ast-panneau-fermer]'))) { fermerPanneau(); return; }
    if ((n = v('[data-ast-page]'))) { if (typeof location !== 'undefined') location.hash = `#/staff/${n.dataset.astPage}`; return; }
    if ((n = v('[data-ast-reservation]'))) { ouvrirReservation(n.dataset.astReservation); return; }
    if ((n = v('[data-ast-savoir]'))) { fermerListe(); ouvrirSavoir(n); return; }
    if ((n = v('[data-ast-fait]'))) { ouvrirSavoir(n); return; }
    if ((n = v('[data-ast-preuve]'))) {
      const m = messageDe(n);
      const p = m && (m.preuves || [])[Number(n.dataset.astPreuve)];
      if (p && p.e === 'appris') ouvrirSavoir(n);
      else if (p) ouvrirPanneau(m, p.s || null, n, p);
      return;
    }
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
        arreterDeSuivre();
        const ouverte = !(m.etapesDeroulees || {})[n.dataset.astEtapeOuvrir];
        m.etapesDeroulees = { ...(m.etapesDeroulees || {}), [n.dataset.astEtapeOuvrir]: ouverte };
        n.closest('.lu').classList.toggle('est-ouvert', ouverte);
        n.setAttribute('aria-expanded', ouverte ? 'true' : 'false');
      }
      return;
    }
    if ((n = v('[data-ast-etapes]'))) {
      const m = messageDe(n);
      if (m) {
        arreterDeSuivre();
        m.etapesOuvertes = !m.etapesOuvertes;
        n.closest('[data-ast-recherche]').classList.toggle('est-ouvert', m.etapesOuvertes);
        n.setAttribute('aria-expanded', m.etapesOuvertes ? 'true' : 'false');
      }
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
    if ((n = v('[data-ast-aller]'))) {
      const m = messageDe(n);
      const a = m && (m.allers || []).find((x) => x.id === n.dataset.astAller);
      if (a && PAGES_OUVRABLES.includes(a.page)) {
        if (a.page === 'establishment' && RUBRIQUES.includes(a.rubrique) && typeof setEstablishmentTab === 'function') setEstablishmentTab(a.rubrique);
        if (typeof location !== 'undefined') location.hash = `#/staff/${a.page}`;
      }
      return;
    }
    // L apercu du mail d une carte : ce qui change ou tel qu il partira, et le texte entier deplie.
    if ((n = v('[data-ast-mail-vue]'))) {
      const m = messageDe(n);
      const p = m && m.propositions[Number(n.dataset.astMailVue)];
      if (p) { p.vueMail = n.dataset.vue === 'propre' ? 'propre' : 'changements'; peindreMessage(m); }
      return;
    }
    if ((n = v('[data-ast-mail-suite]'))) {
      const m = messageDe(n);
      const p = m && m.propositions[Number(n.dataset.astMailSuite)];
      if (p) { p.mailOuvert = !p.mailOuvert; peindreMessage(m); }
      return;
    }
    if ((n = v('[data-ast-geste-oui]'))) {
      const m = messageDe(n);
      const p = m && m.propositions[Number(n.dataset.astGesteOui)];
      if (p && p.type === 'geste') faireGeste(m, p, { confirme: n.dataset.astConfirme === '1' });
      return;
    }
    if ((n = v('[data-ast-geste-retour]'))) {
      const m = messageDe(n);
      const p = m && m.propositions[Number(n.dataset.astGesteRetour)];
      if (p) { p.confirmer = false; peindreMessage(m); }
      return;
    }
    if ((n = v('[data-ast-geste-reserver]'))) {
      const m = messageDe(n);
      const p = m && m.propositions[Number(n.dataset.astGesteReserver)];
      if (p && p.type === 'geste') ouvrirDansReserver(m, p);
      return;
    }
    if ((n = v('[data-ast-geste-voir]'))) {
      const m = messageDe(n);
      const p = m && m.propositions[Number(n.dataset.astGesteVoir)];
      if (p && p.reservation) {
        if (typeof location !== 'undefined') location.hash = '#/staff/planning';
        if (typeof setStaffDateFromPicker === 'function') setStaffDateFromPicker(p.reservation.date);
      }
      return;
    }
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
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key) && !(e.target.matches && e.target.matches('textarea, input'))) A.dernierGeste = performance.now();
    if (e.key === 'Escape') {
      if (A.menuModele) { A.menuModele = false; peindreCompo(); dom('[data-ast-modele]').focus(); return; }
      if (A.panneau) { fermerPanneau(); return; }
      if (A.flux) A.flux.abort();
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
        <div class="ast-fond" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="ast-tete">
          <button type="button" class="ast-icone" data-ast-ouvrir-liste aria-label="Vos conversations">${icone('menu')}</button>
          <span class="ast-tete-titre" data-ast-tete-titre>Marketing</span>
          <button type="button" class="ast-icone" data-ast-nouvelle aria-label="Nouvelle conversation">${icone('plus')}</button>
        </div>
        <div class="ast-fil" data-ast-fil><div class="ast-colonne" data-ast-colonne></div></div>
        <div class="ast-bas">
          <div class="ast-ancre">
            <div class="ast-bande" data-ast-bande aria-hidden="true"></div>
            <button type="button" class="ast-descendre ast-icone" data-ast-descendre aria-label="Aller à la fin" inert>${icone('bas')}</button>
          </div>
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
          <p class="ast-avis" data-ast-avis>L'assistant lit vos données et ne modifie rien.</p>
        </div>
      </section>
      <aside class="ast-sources" data-ast-panneau aria-label="Source" hidden></aside>
    </div>`;
    // La Direction et le proprietaire font agir l assistant (2026-11-11) : la phrase sous le champ le dit.
    // Les droits se jugent au serveur ; ici, seulement ce que la personne lit.
    const session = (typeof normalizeStaffSession === 'function' && typeof state !== 'undefined' && normalizeStaffSession(state.staffAuthSession)) || (typeof readStoredStaffSession === 'function' && readStoredStaffSession()) || null;
    if (session && session.role && session.role.locked === true) dom('[data-ast-avis]').textContent = 'L’assistant prépare, rien ne se fait sans votre clic.';
    const fil = dom('[data-ast-fil]');
    const geste = () => { A.dernierGeste = performance.now(); };
    fil.addEventListener('scroll', surDefilement, { passive: true });
    fil.addEventListener('wheel', (e) => { if (e.deltaY) geste(); }, { passive: true });
    fil.addEventListener('touchmove', geste, { passive: true });
    fil.addEventListener('pointerdown', geste, { passive: true });
    fil.addEventListener('mousemove', (e) => { if (e.buttons) geste(); }, { passive: true });
    observerLeFil(fil, dom('[data-ast-colonne]'));
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

  // La page des demandes sur mesure lit le meme flux, dit ses lectures avec les memes mots et marque
  // ce qui change dans un mail par la meme comparaison mot a mot.
  window.PinlaneAssistant = { markdown, lireEvenements, difference, phraseFinie, mesureDe };
})();

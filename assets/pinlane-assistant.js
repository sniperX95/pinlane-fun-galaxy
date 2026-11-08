/* L ASSISTANT DU CENTRE (2026-11-08), la page Marketing. Ansar : « exactement meme interface que
   claude ou chatgpt [...] doit tout montrer pourquoi il pense ca [...] tout doit etre reference
   cite et accessible ».

   Une conversation par sujet, gardee sur cet appareil. Le texte arrive au fil de l eau, chaque
   chiffre porte un renvoi qui ouvre sa source a droite. Le rendu n injecte jamais de HTML venu
   du modele, n affiche ni lien ni image (une image distante ferait sortir des donnees), et le
   rafraichissement de la console ne touche pas la page deja montee. */
(function () {
  'use strict';

  const VERSION_STOCKAGE = 'pinlane-assistant:v1';
  const CONVERSATIONS_MAX = 30;
  const MESSAGES_MAX = 60;
  const LIGNES_GARDEES = 60;
  const QUESTION_MAX = 6000;
  const MODELES = [
    { id: 'haiku', nom: 'Haiku 5.5', phrase: 'Rapide, pour les questions courantes.' },
    { id: 'sonnet', nom: 'Sonnet 5.5', phrase: 'Plus poussé, pour les décisions qui comptent.' },
  ];
  const SUGGESTIONS = [
    'Faut-il changer une formule ou en ajouter une ?',
    'Quelles heures restent vides et comment les remplir ?',
    'Quels bons clients ne reviennent plus ?',
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
  };
  const icone = (nom) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nom]}</svg>`;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  const A = {
    root: null, cle: '', conversations: [], actuelle: '', modele: 'haiku', flux: null, panneau: null,
    menuModele: false, aSupprimer: '', identites: Object.create(null), peintureDemandee: false, ouvreur: null,
  };

  // ---- Ou l on est et ce qu on garde ---------------------------------------------
  function centreId() { return (typeof state !== 'undefined' && state.adminCenterId) || 'libramont'; }
  function membreId() { return (typeof getStaffSessionMemberId === 'function' && getStaffSessionMemberId()) || 'poste'; }
  function nomDuCentre() {
    const c = typeof getAdminCenter === 'function' ? getAdminCenter() : null;
    return (c && c.name) || 'votre centre';
  }
  const clePortee = () => `${VERSION_STOCKAGE}:${centreId()}:${membreId()}`;
  const courante = () => A.conversations.find((c) => c.id === A.actuelle) || null;

  function charger() {
    A.conversations = [];
    A.actuelle = '';
    A.panneau = null;
    A.identites = Object.create(null);
    try {
      const lu = JSON.parse(localStorage.getItem(A.cle) || 'null');
      if (lu && Array.isArray(lu.conversations)) A.conversations = lu.conversations.filter((c) => c && c.id && Array.isArray(c.messages));
      if (lu && MODELES.some((m) => m.id === lu.modele)) A.modele = lu.modele;
    } catch (erreur) { /* appareil sans stockage : la conversation vit le temps de la page */ }
    // Une reponse coupee par une fermeture de page n est plus en cours.
    A.conversations.forEach((c) => c.messages.forEach((m) => { if (m.statut === 'cours') m.statut = 'arrete'; }));
  }

  // Les noms des clients ne sont jamais ecrits sur l appareil : seuls les codes y restent.
  function versStockage() {
    return {
      modele: A.modele,
      conversations: A.conversations.slice(0, CONVERSATIONS_MAX).map((c) => ({
        id: c.id,
        titre: c.titre,
        maj: c.maj,
        messages: c.messages.slice(-MESSAGES_MAX).map((m) => (m.role === 'user' ? m : { ...m, sources: (m.sources || []).map((s) => ({ ...s, lignes: s.lignes.slice(0, LIGNES_GARDEES), coupe: s.coupe || s.lignes.length > LIGNES_GARDEES })) })),
      })),
    };
  }
  function sauver() {
    const donnees = versStockage();
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

  // ---- Les chiffres et le texte ----------------------------------------------------
  const nombre = (n, max = 2) => Number(n).toLocaleString('fr-BE', { maximumFractionDigits: max });
  function formater(valeur, type) {
    if (valeur === null || valeur === undefined || valeur === '') return '';
    if (type === 'client') return A.identites[valeur] || String(valeur);
    if (typeof valeur !== 'number') return String(valeur);
    if (type === 'euro') return `${Number.isInteger(valeur) ? nombre(valeur) : valeur.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    if (type === 'pct') return `${nombre(valeur, 1)} %`;
    if (type === 'dec') return nombre(valeur, 2);
    return nombre(valeur, 2);
  }

  function enLigne(brut, m) {
    let t = esc(brut);
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/\b[A-Z]\d{4}\b/g, (code) => (A.identites[code] ? esc(A.identites[code]) : code));
    return t.replace(/[  ]?\[S(\d+)\]/g, (tout, n) => {
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

  function htmlEtapes(m) {
    const etapes = m.etapes || [];
    if (!etapes.length) return '';
    const lectures = etapes.filter((e) => !e.note);
    const enCours = m.statut === 'cours';
    const derniere = [...etapes].reverse().find((e) => e.etat === 'cours') || etapes[etapes.length - 1];
    const resume = enCours ? derniere.libelle : `${lectures.length} lecture${lectures.length > 1 ? 's' : ''} de vos données`;
    const liste = etapes.map((e) => {
      if (e.note) return `<li class="ast-etape is-note"><span>${esc(e.libelle)}</span></li>`;
      const signe = e.etat === 'cours' ? '<span class="ast-tourne" aria-hidden="true"></span>' : (e.etat === 'echec' ? icone('croix') : icone('coche'));
      const lien = e.source ? ` <button type="button" class="ast-cite" data-ast-source="${esc(e.source)}">${esc(e.source.slice(1))}</button>` : '';
      return `<li class="ast-etape is-${esc(e.etat || 'fini')}">${signe}<span>${esc(e.libelle)}${e.etat === 'echec' ? ', échec' : ''}</span>${lien}</li>`;
    }).join('');
    return `<div class="ast-etapes${m.etapesOuvertes ? ' est-ouvert' : ''}">
      <button type="button" class="ast-etapes-tete" data-ast-etapes aria-expanded="${m.etapesOuvertes ? 'true' : 'false'}">${enCours ? '<span class="ast-tourne" aria-hidden="true"></span>' : ''}<span>${esc(resume)}</span>${icone('chevron')}</button>
      ${m.etapesOuvertes ? `<ol class="ast-etape-liste">${liste}</ol>` : ''}
    </div>`;
  }

  function htmlTexte(m) {
    if (m.statut === 'cours' && !m.texte) return (m.etapes || []).length ? '' : '<p class="ast-pense" role="status">Je regarde vos chiffres<span class="ast-points" aria-hidden="true"></span></p>';
    // Pendant l ecriture, un renvoi coupe en deux ne s affiche pas a moitie.
    const texte = m.statut === 'cours' ? m.texte.replace(/\[[SG]?\d*$/, '') : m.texte;
    let html = markdown(texte, m);
    // Un graphique demande mais jamais place dans le texte se montre a la fin.
    if (m.statut !== 'cours') (m.graphiques || []).forEach((g) => { if (!html.includes(`data-ast-graph="${g.id}"`)) html += `<figure class="ast-graph" data-ast-graph="${g.id}"></figure>`; });
    return html;
  }

  function htmlPied(m, dernier) {
    if (m.statut === 'cours') return '';
    if (m.statut === 'erreur') return `<p class="ast-erreur" role="alert">${esc(m.erreur)}</p><div class="ast-pied"><button type="button" class="ast-pill" data-ast-refaire>Réessayer</button></div>`;
    const nb = (m.sources || []).length;
    const sans = m.verite && Array.isArray(m.verite.chiffresSansSource) ? m.verite.chiffresSansSource : [];
    const alerte = sans.length
      ? `<p class="ast-alerte">${sans.length > 1 ? `${sans.length} chiffres de cette réponse ne viennent pas de vos données` : 'Un chiffre de cette réponse ne vient pas de vos données'}, ${esc(sans.join(', '))}. Vérifiez avant de vous en servir.</p>`
      : '';
    return `${m.statut === 'arrete' ? '<p class="ast-arrete">Réponse arrêtée.</p>' : ''}${alerte}
    <div class="ast-pied">
      <button type="button" class="ast-icone" data-ast-copier title="Copier" aria-label="Copier la réponse">${icone('copier')}</button>
      ${dernier ? `<button type="button" class="ast-icone" data-ast-refaire title="Refaire" aria-label="Refaire la réponse">${icone('refaire')}</button>` : ''}
      ${nb ? `<button type="button" class="ast-pill" data-ast-sources>${nb} source${nb > 1 ? 's' : ''}</button>` : ''}
      ${m.modele ? `<span class="ast-tag">${esc(nomModele(m.modele))}</span>` : ''}
    </div>`;
  }

  function htmlMessage(m, i, tous, neuf) {
    if (m.role === 'user') return `<div class="ast-q${neuf ? ' is-neuf' : ''}"><div class="ast-q-bulle">${esc(m.texte)}</div></div>`;
    return `<article class="ast-r${neuf ? ' is-neuf' : ''}" data-ast-i="${i}">
      <div data-ast-haut>${htmlEtapes(m)}</div>
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

  const dom = (sel) => A.root.querySelector(sel);

  function peindreListe() {
    const hote = dom('[data-ast-convs]');
    if (!hote) return;
    if (!A.conversations.length) { hote.innerHTML = '<p class="ast-vide">Vos conversations resteront ici, sur cet appareil.</p>'; return; }
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
        : `<div class="ast-conv${c.id === A.actuelle ? ' est-active' : ''}"><button type="button" class="ast-conv-titre" data-ast-conv="${esc(c.id)}"${c.id === A.actuelle ? ' aria-current="true"' : ''}>${esc(c.titre || 'Nouvelle conversation')}</button><button type="button" class="ast-conv-suppr" data-ast-suppr="${esc(c.id)}" aria-label="Supprimer la conversation">${icone('corbeille')}</button></div>`)).join('');
    });
    hote.innerHTML = html;
  }

  function peindreFil({ neuf = 0 } = {}) {
    const hote = dom('[data-ast-colonne]');
    const racine = dom('.ast');
    if (!hote || !racine) return;
    const c = courante();
    const messages = c ? c.messages : [];
    racine.classList.toggle('est-vide', !messages.length);
    if (!messages.length) {
      hote.innerHTML = `<h1 class="ast-salut">Que voulez-vous savoir sur ${esc(nomDuCentre())} ?</h1>`;
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
    const i = c.messages.indexOf(m);
    if (i < 0) return;
    const article = dom(`[data-ast-i="${i}"]`);
    if (!article) return;
    article.querySelector('[data-ast-haut]').innerHTML = htmlEtapes(m);
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

  // ---- Le panneau des sources --------------------------------------------------------
  function ouvrirPanneau(m, id, ouvreur) {
    A.panneau = { message: m, id };
    if (ouvreur) A.ouvreur = ouvreur;
    peindrePanneau();
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
      ${source.coupe ? `<p class="ast-src-detail">Seules les ${LIGNES_GARDEES} premières lignes sont gardées sur cet appareil.</p>` : ''}
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
        body: JSON.stringify({ centerId: centreId(), modele: A.modele, messages: pourLeServeur(conversation, reponse) }),
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
      sauver();
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
      case 'texte': m.texte += d.delta; break;
      case 'note': m.texte = ''; m.etapes.push({ note: true, libelle: String(d.texte).slice(0, 240) }); break;
      case 'etape': {
        const e = m.etapes.find((x) => x.id === d.id);
        if (e) Object.assign(e, d); else m.etapes.push({ id: d.id, libelle: d.libelle, etat: d.etat });
        break;
      }
      case 'source': m.sources.push(d); break;
      case 'graphique': m.graphiques.push(d); break;
      case 'annule': m.texte = ''; break;
      case 'fin':
        m.texte = d.texte;
        m.verite = d.verite || null;
        m.modele = d.modele || '';
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
      c = { id: uid(), titre: question.slice(0, 60), maj: Date.now(), messages: [] };
      A.conversations.unshift(c);
      A.actuelle = c.id;
    }
    c.messages.push({ role: 'user', texte: question });
    const reponse = { id: uid(), role: 'assistant', texte: '', sources: [], graphiques: [], etapes: [], statut: 'cours' };
    c.messages.push(reponse);
    c.maj = Date.now();
    A.conversations = [c, ...A.conversations.filter((x) => x !== c)];
    const champ = dom('[data-ast-champ]');
    if (champ) { champ.value = ''; ajusterChamp(); }
    sauver();
    peindreListe();
    peindreFil({ neuf: 2 });
    poser(c, reponse);
  }

  function refaire() {
    const c = courante();
    if (!c || A.flux) return;
    const derniere = c.messages[c.messages.length - 1];
    if (!derniere || derniere.role !== 'assistant') return;
    Object.assign(derniere, { id: uid(), texte: '', sources: [], graphiques: [], etapes: [], statut: 'cours', verite: null, erreur: '', modele: '' });
    A.panneau = null;
    peindrePanneau();
    peindreFil();
    poser(c, derniere);
  }

  function copier(m) {
    const propre = m.texte.replace(/[  ]?\[[SG]\d+\]/g, '').replace(/\b[A-Z]\d{4}\b/g, (code) => A.identites[code] || code).trim();
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

  // ---- Les gestes, tous par delegation sur la page -------------------------------------
  function surClic(e) {
    const t = e.target;
    const v = (sel) => t.closest(sel);
    let n;
    if (A.menuModele && !v('[data-ast-menu]') && !v('[data-ast-modele]')) { A.menuModele = false; peindreCompo(); }
    if ((n = v('[data-ast-nouvelle]'))) { nouvelleConversation(); return; }
    if ((n = v('[data-ast-ouvrir-liste]'))) { ouvrirListe(); return; }
    if ((n = v('[data-ast-voile]'))) { fermerListe(); return; }
    if ((n = v('[data-ast-conv]'))) {
      A.actuelle = n.dataset.astConv;
      A.aSupprimer = '';
      A.panneau = null;
      peindrePanneau(); peindreListe(); peindreFil(); fermerListe();
      return;
    }
    if ((n = v('[data-ast-suppr]'))) { A.aSupprimer = n.dataset.astSuppr; peindreListe(); return; }
    if ((n = v('[data-ast-suppr-non]'))) { A.aSupprimer = ''; peindreListe(); return; }
    if ((n = v('[data-ast-suppr-oui]'))) {
      const id = n.dataset.astSupprOui;
      A.conversations = A.conversations.filter((c) => c.id !== id);
      if (A.actuelle === id) { A.actuelle = ''; A.panneau = null; peindrePanneau(); peindreFil(); }
      A.aSupprimer = '';
      sauver();
      peindreListe();
      return;
    }
    if ((n = v('[data-ast-suggestion]'))) { envoyer(n.textContent); return; }
    if ((n = v('[data-ast-modele]'))) { A.menuModele = !A.menuModele; peindreCompo(); return; }
    if ((n = v('[data-ast-choix]'))) { A.modele = n.dataset.astChoix; A.menuModele = false; sauver(); peindreCompo(); dom('[data-ast-champ]').focus(); return; }
    if ((n = v('[data-ast-descendre]'))) { const fil = dom('[data-ast-fil]'); fil.scrollTop = fil.scrollHeight; return; }
    if ((n = v('[data-ast-panneau-fermer]'))) { fermerPanneau(); return; }
    if ((n = v('[data-ast-page]'))) { if (typeof location !== 'undefined') location.hash = `#/staff/${n.dataset.astPage}`; return; }
    if ((n = v('[data-ast-reservation]'))) { ouvrirReservation(n.dataset.astReservation); return; }
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
    if ((n = v('[data-ast-etapes]'))) {
      const m = messageDe(n);
      if (m) { m.etapesOuvertes = !m.etapesOuvertes; peindreMessage(m); }
      return;
    }
    if ((n = v('[data-ast-copier]'))) { const m = messageDe(n); if (m) copier(m); return; }
    if ((n = v('[data-ast-refaire]'))) { refaire(); return; }
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
    dom('[data-ast-compo]').addEventListener('submit', (e) => {
      e.preventDefault();
      if (A.flux) { A.flux.abort(); return; }
      envoyer(dom('[data-ast-champ]').value);
    });
    peindreListe();
    peindreFil();
    ajusterChamp();
  }

  window.addEventListener('resize', () => { if (A.root && A.root.querySelector('.ast')) ajusterHauteur(); }, { passive: true });

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
      // La bande du haut peut grandir d un cheveu quand les polices arrivent.
      setTimeout(ajusterHauteur, 300);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajusterHauteur);
    }
    ajusterHauteur();
  };

  window.PinlaneAssistant = { markdown };
})();

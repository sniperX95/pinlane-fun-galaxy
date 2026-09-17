#!/usr/bin/env node
'use strict';
/* ============================================================================
   GATE UI : la page « Emails & relances » en sections (spec emails v4, §5.4)

   Playwright pilote la VRAIE console servie par scripts/dev-console-server.js
   (fixtures conformes aux contrats §3.7, session staff simulee), sans aucun
   reseau externe : tout ce qui ne vient pas du serveur local est intercepte
   et compte. Le gate asserte d abord le MONTAGE (la situation est bien la :
   session, dix sections, donnees chargees), puis les COMPORTEMENTS :
     - sous-navigation au clavier (fleches, Home, End) et hash de l URL ;
     - tuiles de l Apercu -> sections et filtres ;
     - fil : messages dans l ordre, ligne de parcours entrant / sortant,
       markCommunicationRead appele UNE fois par fil ;
     - reponse dans le fil : replyToCommunicationId + threadId + signature ;
     - apparence : changement de gabarit -> emailDesignPreview avec le
       brouillon, et l iframe recoit le HTML du serveur ;
     - sequences : frappe -> automationPreview debounce (1 appel pour 6
       frappes rapides) et l iframe change ;
     - mobile 390 px sans debordement horizontal, theme sombre, zero erreur
       console.
   Code de sortie 0 seulement si TOUT passe.

   POURQUOI le serveur de dev et pas un bouchon fetch : les contrats §3.7 y
   sont ecrits une fois (le meme jeu que la verification visuelle), et le gate
   mesure la page telle qu elle tourne, requetes HTTP comprises.
   ========================================================================== */
const { chromium } = require('playwright-core');
const dev = require('./dev-console-server.js');

const PORT = Number(process.env.PINLANE_THREADS_UI_PORT || 4237);
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SECTIONS = ['apercu', 'recus', 'envoyes', 'sequences', 'modeles', 'apparence', 'expediteurs', 'agent', 'exclusions', 'campagnes'];
// index.html reference un script d analyse Vercel : le gate le neutralise (il
// ne doit rien charger hors du serveur local) et refuse toute AUTRE sortie.
const EXTERNES_TOLERES = [/^https:\/\/cdn\.vercel-insights\.com\//];

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function attendre(page, fn, arg, label, timeout = 10000) {
  try {
    await page.waitForFunction(fn, arg, { timeout });
    return true;
  } catch (error) {
    return ok(false, label, 'delai depasse');
  }
}

// Les appels /api enregistres par le script d amorcage (corps POST + reponse).
function appels(page, action) {
  return page.evaluate((a) => window.__APPELS__.filter((e) => e.method === 'POST' && e.action === a), action);
}

async function allerA(page, section) {
  await page.evaluate((s) => pv2EmailsGo(s), section);
  await dormir(400);
}

async function ouvrirPage(context, { hash = '#/staff/emails/apercu', theme = 'light' } = {}) {
  const page = await context.newPage();
  const journal = { console: [], pageErrors: [], manques: new Set() };
  page.on('console', (m) => { if (m.type() === 'error') journal.console.push(m.text()); });
  page.on('pageerror', (e) => journal.pageErrors.push(e.message));
  page.on('response', (r) => { if (r.status() === 404) { const u = new URL(r.url()); journal.manques.add(u.pathname + u.search); } });
  // Le script d amorcage enregistre chaque appel /api (corps et reponse) sans
  // rien bouchonner : le serveur de fixtures repond pour de vrai. Il ne tourne
  // que dans la page (les iframes sandbox des mails n ont rien a enregistrer).
  await page.addInitScript(() => {
    if (window !== window.top) return;
    window.__APPELS__ = [];
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      let u;
      try { u = new URL(url, location.origin); } catch (e) { return nf(input, init); }
      const method = String((init && init.method) || 'GET').toUpperCase();
      const entree = { method, path: u.pathname, action: u.searchParams.get('action') || '', body: null, status: 0, payload: null, fini: false };
      if (method === 'POST' && init && init.body) {
        try { entree.body = JSON.parse(init.body); entree.action = String(entree.body.action || ''); } catch (e) { entree.body = String(init.body); }
      }
      if (u.pathname.startsWith('/api/')) window.__APPELS__.push(entree);
      const res = await nf(input, init);
      if (u.pathname.startsWith('/api/')) {
        entree.status = res.status;
        try { entree.payload = await res.clone().json(); } catch (e) { entree.payload = null; }
        entree.fini = true;
      }
      return res;
    };
  });
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof window.pv2EmailsGo === 'function' && document.querySelector('#staffEmailsPage .pl-subnav'), null, { timeout: 20000 });
  if (theme === 'dark') { await page.evaluate(() => setStaffTheme('dark')); await dormir(200); }
  return { page, journal };
}

// Debordement horizontal a 390 px : la page ET son conteneur, en ignorant ce
// qui defile dans son propre cadre (pipeline, sous-nav) : un contenu qui
// defile chez lui n est pas un debordement de la page.
function mesurerDebordement() {
  const cw = document.documentElement.clientWidth;
  const dansDefileur = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  };
  const root = document.getElementById('staffEmailsPage');
  const fautifs = [...document.querySelectorAll('#staffEmailsPage *')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > cw + 1 && !dansDefileur(el); })
    .slice(0, 5)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}@${Math.round(el.getBoundingClientRect().right)}`);
  return { cw, sw: document.documentElement.scrollWidth, rootSw: root ? root.scrollWidth : 0, rootCw: root ? root.clientWidth : 0, fautifs };
}

async function main() {
  const serveur = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE }));
  await new Promise((resolve, reject) => { serveur.once('error', reject); serveur.listen(PORT, HOST, resolve); });
  // Zero reseau externe, garanti par le navigateur lui-meme : aucun nom
  // d hote ne se resout, sauf le serveur local. L interception de requetes
  // ci-dessous en est la deuxieme couche (et compte ce qui a tente de sortir).
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const externes = [];
  const brancherGardeReseau = async (context) => {
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(BASE) || /^(data|about|blob):/.test(url)) return route.continue();
      externes.push(url);
      // Repondre vide plutot qu echouer : un script qui ne charge pas
      // fabriquerait une erreur console qui ne vient pas de l application.
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    });
  };
  let desktop = null;
  let mobile = null;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    await brancherGardeReseau(context);
    desktop = await ouvrirPage(context);
    const { page } = desktop;

    // =====================================================================
    console.log('[MONTAGE] la situation est bien la');
    // =====================================================================
    const montage = await page.evaluate(() => ({
      session: (state.staffAuthSession && state.staffAuthSession.member && state.staffAuthSession.member.name) || '',
      hash: location.hash,
      section: document.querySelector('#pv2EmailsPanel').getAttribute('data-section'),
      tabs: [...document.querySelectorAll('#staffEmailsPage .pl-subnav-item')].map((b) => b.getAttribute('data-section')),
      tablist: !!document.querySelector('#staffEmailsPage .pl-subnav[role="tablist"]'),
      roles: [...document.querySelectorAll('#staffEmailsPage .pl-subnav-item')].every((b) => b.getAttribute('role') === 'tab' && b.hasAttribute('aria-selected') && b.getAttribute('aria-controls') === 'pv2EmailsPanel'),
      selection: [...document.querySelectorAll('#staffEmailsPage .pl-subnav-item')].filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.section),
      panelRole: document.querySelector('#pv2EmailsPanel').getAttribute('role'),
      tuiles: document.querySelectorAll('#staffEmailsPage .pv2-stat').length,
      sidebar: [...document.querySelectorAll('.fgx-menu-subitem[data-fgx-menu-section]')].map((b) => b.getAttribute('data-fgx-menu-section')),
    }));
    ok(montage.session === 'Camille Dev', 'session staff simulee (Camille Dev, Direction) : sans elle, tout le reste mesurerait un ecran de connexion', montage.session);
    ok(montage.section === 'apercu' && montage.hash === '#/staff/emails/apercu', `la page s ouvre sur l Apercu, hash ${montage.hash}`);
    ok(montage.tabs.join(',') === SECTIONS.join(','), 'la sous-navigation porte les dix sections dans l ordre', montage.tabs.join(' · '));
    ok(montage.tablist && montage.roles && montage.panelRole === 'tabpanel' && montage.selection.join() === 'apercu', 'motif tablist complet : role=tab, aria-selected unique, aria-controls -> tabpanel');
    ok(montage.tuiles === 4, `quatre tuiles chiffrees sur l Apercu (obtenu ${montage.tuiles})`);
    ok(montage.sidebar.join(',') === SECTIONS.join(','), 'la barre laterale expose les dix sections en enfants de « Emails & relances »', montage.sidebar.join(' · '));
    await attendre(page, () => pv2Overview.loaded && pv2Overview.data && pv2Threads.apercu.loaded, null, 'vue globale et conversations de l Apercu chargees');
    await dormir(200);
    const apercu = await page.evaluate(() => ({
      valeurs: [...document.querySelectorAll('#staffEmailsPage .pv2-stat-value')].map((el) => el.textContent.trim()),
      aRepondre: pv2Overview.data.aRepondre,
      convos: [...document.querySelectorAll('#staffEmailsPage .pv2-convo-mini .pv2-thread-row')].map((r) => r.getAttribute('data-thread-id')),
      badge: (document.querySelector('#staffEmailsPage .pl-subnav-badge') || {}).textContent || '',
    }));
    ok(apercu.valeurs.length === 4 && apercu.valeurs.every((v) => /^\d/.test(v)), 'les quatre tuiles portent des nombres venus de emailOverview', apercu.valeurs.join(' · '));
    ok(apercu.convos.length === 2 && apercu.convos.includes('901') && apercu.convos.includes('904'), 'les conversations a repondre listees sont celles des fixtures (901, 904)', apercu.convos.join(','));
    ok(Number(apercu.aRepondre) === 2 && apercu.badge === String(apercu.aRepondre), 'le badge de l onglet Recus = aRepondre de la vue globale', `${apercu.badge} / ${apercu.aRepondre}`);

    // =====================================================================
    console.log('\n[SOUS-NAV] clavier et hash');
    // =====================================================================
    await page.focus('#pv2EmailsTab-apercu');
    await page.keyboard.press('ArrowRight');
    await dormir(350);
    const lireNav = () => page.evaluate(() => ({
      hash: location.hash,
      section: state.staffEmailsSection,
      panel: document.querySelector('#pv2EmailsPanel').getAttribute('data-section'),
      focus: document.activeElement ? document.activeElement.id : '',
      moved: (document.querySelector('#staffEmailsPage .pl-subnav-indicator') || { getAttribute: () => '' }).getAttribute('data-moved'),
      selection: [...document.querySelectorAll('#staffEmailsPage .pl-subnav-item')].filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.section),
      tabindex: [...document.querySelectorAll('#staffEmailsPage .pl-subnav-item')].filter((b) => b.getAttribute('tabindex') === '0').map((b) => b.dataset.section),
      menuActif: [...document.querySelectorAll('.fgx-menu-subitem.active[data-fgx-menu-section]')].map((b) => b.getAttribute('data-fgx-menu-section')),
    }));
    const nav1 = await lireNav();
    ok(nav1.section === 'recus' && nav1.panel === 'recus' && nav1.hash === '#/staff/emails/recus', 'Fleche droite depuis Apercu : la section Recus s ouvre et le hash suit', nav1.hash);
    ok(nav1.focus === 'pv2EmailsTab-recus' && nav1.selection.join() === 'recus' && nav1.tabindex.join() === 'recus', 'le focus suit l onglet actif, seul porteur de aria-selected et de tabindex=0');
    ok(nav1.menuActif.join() === 'recus', 'la barre laterale marque la meme section', nav1.menuActif.join());
    await page.keyboard.press('End');
    await dormir(300);
    const nav2 = await lireNav();
    ok(nav2.section === 'campagnes' && nav2.focus === 'pv2EmailsTab-campagnes' && nav2.hash === '#/staff/emails/campagnes', 'End : derniere section (Campagnes)', nav2.section);
    await page.keyboard.press('Home');
    await dormir(300);
    const nav3 = await lireNav();
    ok(nav3.section === 'apercu' && nav3.focus === 'pv2EmailsTab-apercu', 'Home : retour a l Apercu', nav3.section);
    await page.keyboard.press('ArrowLeft');
    await dormir(300);
    const nav4 = await lireNav();
    ok(nav4.section === 'campagnes', 'Fleche gauche depuis la premiere boucle sur la derniere', nav4.section);
    await page.click('#pv2EmailsTab-envoyes');
    await dormir(300);
    const nav5 = await lireNav();
    ok(nav5.section === 'envoyes' && nav5.hash === '#/staff/emails/envoyes', 'un clic sur un onglet ouvre sa section et ecrit le hash', nav5.hash);
    // Le hash est une vraie adresse : le poser de l exterieur (lien colle,
    // favori) et revenir en arriere doivent piloter la page.
    await page.evaluate(() => { location.hash = '#/staff/emails/modeles'; });
    await dormir(400);
    const nav6 = await lireNav();
    ok(nav6.section === 'modeles' && nav6.panel === 'modeles' && nav6.selection.join() === 'modeles', 'poser #/staff/emails/modeles dans l URL ouvre Modeles', nav6.section);
    await page.goBack();
    await dormir(400);
    const nav7 = await lireNav();
    ok(nav7.section === 'envoyes' && nav7.hash === '#/staff/emails/envoyes', 'Precedent du navigateur ramene a la section precedente', nav7.hash);
    await page.click('.fgx-menu-subitem[data-fgx-menu-section="agent"]');
    await dormir(400);
    const nav8 = await lireNav();
    ok(nav8.section === 'agent' && nav8.hash === '#/staff/emails/agent', 'un enfant de la barre laterale ouvre sa section', nav8.section);
    // L indicateur GLISSE quand la section change et ne bouge pas sur un simple
    // re-rendu. Lecture SYNCHRONE juste apres le geste : le chargement des
    // donnees de la section qui suit re-rend la page et remet data-moved a 0
    // (c est voulu, un poll ne doit jamais faire bouger l indicateur).
    const indicateur = await page.evaluate(() => {
      const lire = () => {
        const nav = document.querySelector('#staffEmailsPage .pl-subnav');
        const ind = nav.querySelector('.pl-subnav-indicator');
        const actif = nav.querySelector('.pl-subnav-item.is-active');
        return { moved: ind.getAttribute('data-moved'), x: parseFloat(nav.style.getPropertyValue('--pl-subnav-x')), k: parseFloat(nav.style.getPropertyValue('--pl-subnav-k')), left: actif.offsetLeft, w: actif.offsetWidth, key: actif.getAttribute('data-section') };
      };
      const tab = document.getElementById('pv2EmailsTab-agent');
      tab.focus();
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      const apresGeste = lire();
      renderStaffEmailsPage();
      const apresRerendu = lire();
      return { apresGeste, apresRerendu };
    });
    ok(indicateur.apresGeste.key === 'exclusions' && indicateur.apresGeste.moved === '1', 'l indicateur GLISSE quand la section change au clavier (data-moved=1)', JSON.stringify(indicateur.apresGeste));
    ok(Math.abs(indicateur.apresGeste.x - indicateur.apresGeste.left) <= 1 && Math.abs(indicateur.apresGeste.k * 100 - indicateur.apresGeste.w) <= 1, 'et il est pose sur l onglet actif (position et largeur)', `x ${indicateur.apresGeste.x}/${indicateur.apresGeste.left}, largeur ${indicateur.apresGeste.k * 100}/${indicateur.apresGeste.w}`);
    ok(indicateur.apresRerendu.moved === '0' && indicateur.apresRerendu.key === 'exclusions', 'un simple re-rendu ne le fait pas bouger (data-moved=0)');

    // =====================================================================
    console.log('\n[APERCU] les tuiles menent aux sections');
    // =====================================================================
    const tuiles = await page.evaluate(async () => {
      const out = [];
      const stats = () => [...document.querySelectorAll('#staffEmailsPage .pv2-stat')];
      for (let i = 0; i < 4; i += 1) {
        pv2EmailsGo('apercu');
        await new Promise((r) => setTimeout(r, 250));
        const label = stats()[i].querySelector('.pv2-stat-label').textContent.trim();
        stats()[i].click();
        await new Promise((r) => setTimeout(r, 350));
        const pipe = document.querySelector('#staffEmailsPage .pv2-pipe.active');
        out.push({ label, section: state.staffEmailsSection, filtreFils: pv2Threads.filtre, pipe: pipe ? pipe.getAttribute('data-pipe') : '' });
      }
      pv2EmailsGo('apercu');
      await new Promise((r) => setTimeout(r, 250));
      [...document.querySelectorAll('#staffEmailsPage button')].find((b) => /Toutes les conversations/.test(b.textContent)).click();
      await new Promise((r) => setTimeout(r, 250));
      const toutes = state.staffEmailsSection;
      pv2EmailsGo('apercu');
      await new Promise((r) => setTimeout(r, 250));
      [...document.querySelectorAll('#staffEmailsPage button')].find((b) => /^\s*Gérer\s*$/.test(b.textContent)).click();
      await new Promise((r) => setTimeout(r, 250));
      return { out, toutes, gerer: state.staffEmailsSection };
    });
    ok(tuiles.out[0].section === 'recus' && tuiles.out[0].filtreFils === 'a-repondre', `tuile « ${tuiles.out[0].label} » -> Recus, filtre A repondre`, `${tuiles.out[0].section}/${tuiles.out[0].filtreFils}`);
    ok(tuiles.out[1].section === 'envoyes' && tuiles.out[1].pipe === 'sent', `tuile « ${tuiles.out[1].label} » -> Envoyes, segment Envoyes actif`, `${tuiles.out[1].section}/${tuiles.out[1].pipe}`);
    ok(tuiles.out[2].section === 'envoyes' && tuiles.out[2].pipe === 'failed', `tuile « ${tuiles.out[2].label} » -> Envoyes, segment Echecs actif`, `${tuiles.out[2].section}/${tuiles.out[2].pipe}`);
    ok(tuiles.out[3].section === 'envoyes' && tuiles.out[3].pipe === 'queued', `tuile « ${tuiles.out[3].label} » -> Envoyes, segment En attente actif`, `${tuiles.out[3].section}/${tuiles.out[3].pipe}`);
    ok(tuiles.toutes === 'recus' && tuiles.gerer === 'sequences', '« Toutes les conversations » -> Recus, « Gerer » -> Sequences', `${tuiles.toutes}/${tuiles.gerer}`);

    // =====================================================================
    console.log('\n[FIL] les messages dans l ordre, le parcours de chacun');
    // =====================================================================
    await page.evaluate(() => { pv2ThreadsFilter('a-repondre'); pv2EmailsGo('recus'); });
    await attendre(page, () => pv2Threads.loaded && document.querySelectorAll('#staffEmailsPage .pv2-thread-row').length >= 2, null, 'les conversations a repondre sont chargees');
    const liste = await page.evaluate(() => [...document.querySelectorAll('#staffEmailsPage .pv2-thread-row')].map((r) => ({
      id: r.getAttribute('data-thread-id'), nouveau: !!r.querySelector('.pv2-chip.is-new'), texte: r.textContent.replace(/\s+/g, ' ').trim(),
    })));
    ok(liste.map((l) => l.id).join(',') === '901,904', 'filtre A repondre : les fils 901 puis 904, le plus recent d abord', liste.map((l) => l.id).join(','));
    // Regle du 2026-09-17 : « Nouveau » tant que PERSONNE n a ouvert ; sinon la ligne dit qui.
    const l901 = liste.find((l) => l.id === '901') || {};
    const l904 = liste.find((l) => l.id === '904') || {};
    ok(!l901.nouveau && /Ouvert par Sophie Martin/.test(l901.texte || '') && l904.nouveau === true,
      '« Nouveau » seulement si personne n a ouvert : 901 deja ouvert par Sophie Martin (la ligne le dit), 904 jamais ouvert (Nouveau)', JSON.stringify({ l901: l901.nouveau, l904: l904.nouveau }));
    await page.click('#staffEmailsPage .pv2-thread-row[data-thread-id="901"]');
    await attendre(page, () => pv2Threads.detail.loaded && pv2Threads.detail.thread && String(pv2Threads.detail.thread.id) === '901' && document.querySelectorAll('#staffEmailsPage .pl-timeline-msg').length === 2, null, 'le fil 901 s ouvre avec ses deux messages');
    await dormir(200);
    const fil = await page.evaluate(() => {
      const msgs = [...document.querySelectorAll('#staffEmailsPage .pl-timeline .pl-timeline-msg')];
      const trace = (m) => [...m.querySelectorAll('.pl-timeline-trace > span')].map((s) => ({ cls: s.className, txt: s.textContent.replace(/\s+/g, ' ').trim() }));
      return {
        ordre: msgs.map((m) => m.getAttribute('data-message-id')),
        sens: msgs.map((m) => (m.classList.contains('is-inbound') ? 'in' : m.classList.contains('is-outbound') ? 'out' : '?')),
        voie41: (msgs[0].querySelector('.pv2-mail-voie') || {}).textContent || '',
        traces: msgs.map(trace),
        corps42: (msgs[1].querySelector('.pv2-mail-corps') || {}).textContent || '',
        citation: !!msgs[1].querySelector('.pv2-mail-plus'),
        analyse: (msgs[1].querySelector('.pv2-inbox-summary p') || {}).textContent || '',
        question: (msgs[1].querySelector('.pv2-thread-question') || {}).textContent || '',
        statut: (document.querySelector('#staffEmailsPage .pv2-thread-head .pv2-chip') || {}).textContent || '',
        tete: (document.querySelector('#staffEmailsPage .pv2-thread-title') || {}).textContent || '',
        sujetTete: (document.querySelector('#staffEmailsPage .pv2-thread-title strong') || {}).textContent || '',
        origineTete: (document.querySelector('#staffEmailsPage .pv2-thread-origine') || {}).textContent || '',
        avatarTete: !!document.querySelector('#staffEmailsPage .pv2-thread-head .pv2-thread-avatar'),
        signature: (document.querySelector('#staffEmailsPage .pv2-thread-reply-sign input[type="checkbox"]') || {}).checked,
        signataire: [...document.querySelectorAll('#staffEmailsPage .pv2-thread-reply-sign input:not([type="checkbox"])')].map((i) => i.value),
        sandbox: [...document.querySelectorAll('#staffEmailsPage iframe')].every((f) => f.getAttribute('sandbox') === ''),
      };
    });
    ok(fil.ordre.join(',') === '41,42' && fil.sens.join(',') === 'out,in', 'les messages sont dans l ordre chronologique : 41 envoye, puis 42 recu', `${fil.ordre.join(',')} / ${fil.sens.join(',')}`);
    ok(/^Envoyé/.test(fil.voie41), 'le message sortant dit par quelle voie il est parti', fil.voie41);
    const t41 = fil.traces[0];
    const t42 = fil.traces[1];
    ok(t41.some((s) => /is-done/.test(s.cls) && /^Envoyé/.test(s.txt)) && t41.some((s) => /is-done/.test(s.cls) && /^Remis/.test(s.txt)) && t41.some((s) => /is-done/.test(s.cls) && /^Ouvert/.test(s.txt)),
      'parcours SORTANT du 41 : Envoye, Remis, Ouvert en points pleins (evenements du fournisseur)', t41.map((s) => s.txt).join(' | '));
    ok(t42.some((s) => /is-done/.test(s.cls) && /^Reçu/.test(s.txt)) && t42.some((s) => /is-done/.test(s.cls) && /^Lu par Sophie Martin/.test(s.txt)) && t42.some((s) => /is-off/.test(s.cls) && /^Sans réponse/.test(s.txt)),
      'parcours ENTRANT du 42 : Recu, Lu par Sophie Martin, Sans reponse (point creux)', t42.map((s) => s.txt).join(' | '));
    ok(/propre gâteau/.test(fil.corps42) && fil.citation, 'le message recu est lisible, sa citation repliee derriere un bouton');
    ok(/gâteau/.test(fil.analyse), 'ce que l agent a compris est affiche sous le message', fil.analyse.slice(0, 60));
    ok(/L'agent ne sait pas/.test(fil.question), 'la question de l agent est rattachee au message qui l a posee');
    ok(fil.statut === 'À répondre' && /Ansar Bis/.test(fil.tete) && /ansarbis2\.0@gmail\.com/.test(fil.tete), 'en tete : le contact, son adresse, l etat « A repondre »', fil.statut);
    ok(/^Commencée par le centre/.test(fil.origineTete) && !fil.avatarTete && fil.sujetTete.trim().length > 0 && !/Ansar Bis/.test(fil.sujetTete),
      'en tete de CONVERSATION : l objet en titre et « Commencee par le centre » (41 est parti avant 42), sans l avatar du client qui faisait lire un mail recu', JSON.stringify({ sujet: fil.sujetTete, origine: fil.origineTete, avatar: fil.avatarTete }));
    ok(fil.signature === true && fil.signataire[0] === 'Camille Dev' && fil.signataire[1] === 'Direction', 'la signature est proposee (portee « manuels » active) avec MON nom et MON role', fil.signataire.join(' / '));
    ok(fil.sandbox, 'toute iframe de la page est sandbox=""');

    const lectures1 = await appels(page, 'markCommunicationRead');
    ok(lectures1.length === 1 && JSON.stringify(lectures1[0].body.communicationIds) === '[42]' && lectures1[0].payload && lectures1[0].payload.marques === 1,
      'ouvrir le fil 901 marque lu le message 42 : UN appel markCommunicationRead, [42], accepte par le serveur', JSON.stringify(lectures1.map((l) => l.body.communicationIds)));
    await attendre(page, () => /Lu par [^|]*vous/.test(document.querySelectorAll('#staffEmailsPage .pl-timeline-msg')[1].querySelector('.pl-timeline-trace').textContent), null, 'la trace montre aussitot « vous » parmi les lecteurs, sans recharger le fil');
    const chip901 = await page.evaluate(() => !!document.querySelector('#staffEmailsPage .pv2-thread-row[data-thread-id="901"] .pv2-chip.is-new'));
    ok(chip901 === false, 'la pastille « Nouveau » du fil 901 disparait de la liste');
    const ouvert901 = await page.evaluate(() => ((document.querySelector('#staffEmailsPage .pv2-thread-row[data-thread-id="901"] .pv2-chip.is-opened') || {}).textContent || ''));
    ok(/Ouvert par .*vous/.test(ouvert901), 'et la ligne dit tous ceux qui l ont ouvert, moi compris', ouvert901);
    const parUnCollegue = await page.evaluate(() => {
      const t = pv2Threads.threads.find((x) => String(x.id) === '904');
      const avant = { lecteurs: t.lecteurs, luParMoi: t.luParMoi };
      t.lecteurs = [{ memberId: 'libramont:sophie', memberName: 'Sophie Martin', memberRole: 'Direction' }];
      t.luParMoi = false;
      renderStaffEmailsPage();
      const r = document.querySelector('#staffEmailsPage .pv2-thread-row[data-thread-id="904"]');
      const res = { nouveau: !!(r && r.querySelector('.pv2-chip.is-new')), ouvert: ((r && r.querySelector('.pv2-chip.is-opened')) || {}).textContent || '' };
      t.lecteurs = avant.lecteurs;
      t.luParMoi = avant.luParMoi;
      renderStaffEmailsPage();
      return res;
    });
    ok(!parUnCollegue.nouveau && /Ouvert par Sophie Martin/.test(parUnCollegue.ouvert), 'ouvert par un collegue : plus de « Nouveau » pour personne, la ligne dit qui', JSON.stringify(parUnCollegue));
    const prises1 = await appels(page, 'claimInboundEmail');
    ok(prises1.length === 1 && Number(prises1[0].body.communicationId) === 42, 'ouvrir un fil a repondre, c est s en occuper : prise de main sur le message 42', JSON.stringify(prises1.map((p) => p.body.communicationId)));

    await page.click('#staffEmailsPage .pv2-thread-row[data-thread-id="904"]');
    await attendre(page, () => pv2Threads.detail.loaded && pv2Threads.detail.thread && String(pv2Threads.detail.thread.id) === '904', null, 'le fil 904 s ouvre');
    await dormir(300);
    const lectures2 = await appels(page, 'markCommunicationRead');
    ok(lectures2.length === 2 && JSON.stringify(lectures2[1].body.communicationIds) === '[49]', 'ouvrir le fil 904 marque son message 49 (un appel de plus)', JSON.stringify(lectures2.map((l) => l.body.communicationIds)));
    await page.waitForTimeout(400);
    const ligne904 = await page.evaluate(() => {
      const r = document.querySelector('#staffEmailsPage .pv2-thread-row[data-thread-id="904"]');
      return { nouveau: !!(r && r.querySelector('.pv2-chip.is-new')), ouvert: ((r && r.querySelector('.pv2-chip.is-opened')) || {}).textContent || '' };
    });
    ok(!ligne904.nouveau && /Ouvert par vous/.test(ligne904.ouvert), 'des que je l ouvre, 904 perd « Nouveau » et dit « Ouvert par vous »', JSON.stringify(ligne904));
    await page.click('#staffEmailsPage .pv2-thread-row[data-thread-id="901"]');
    await attendre(page, () => pv2Threads.detail.loaded && pv2Threads.detail.thread && String(pv2Threads.detail.thread.id) === '901', null, 'le fil 901 se rouvre');
    await page.evaluate(() => renderStaffEmailsPage());
    await dormir(400);
    const lectures3 = await appels(page, 'markCommunicationRead');
    ok(lectures3.length === 2, 'rouvrir 901 et re-rendre la page ne renvoient PAS markCommunicationRead : une fois par fil et par session', String(lectures3.length));
    const prises2 = await appels(page, 'claimInboundEmail');
    const relaches2 = await appels(page, 'releaseInboundEmail');
    ok(prises2.map((p) => Number(p.body.communicationId)).join(',') === '42,49,42' && relaches2.some((r) => Number(r.body.communicationId) === 42) && relaches2.some((r) => Number(r.body.communicationId) === 49),
      'changer de fil relache la main sur l ancien message et la prend sur le nouveau', `prises ${prises2.map((p) => p.body.communicationId).join(',')} / relaches ${relaches2.map((r) => r.body.communicationId).join(',')}`);

    // =====================================================================
    console.log('\n[REPONSE] dans le fil : replyTo + threadId + signature');
    // =====================================================================
    await page.click('#pv2ThreadReplyBody');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Oui, apportez votre gâteau, on s\'occupe des bougies.', { delay: 15 });
    await dormir(250);
    const brouillon = await page.evaluate(() => ({ body: pv2Threads.reply['901'].body, subject: pv2Threads.reply['901'].subject, focus: document.activeElement ? document.activeElement.id : '' }));
    ok(/apportez votre gâteau/.test(brouillon.body) && brouillon.focus === 'pv2ThreadReplyBody', 'la frappe alimente le brouillon du fil et garde le focus', brouillon.focus);
    ok(brouillon.subject === "Re: C'est confirmé : on vous attend mardi 8 septembre",
      'l objet de la reponse est « Re: » + l objet de la conversation, pas l objet propose par l agent (sinon Gmail range la reponse a part chez le client)', brouillon.subject);
    const objetAgentAutre = await page.evaluate(() => {
      const d = pv2Threads.detail;
      const cle = String(d.thread.id);
      const entrant = [...d.messages].reverse().find((m) => m.direction === 'inbound');
      const avant = { brouillon: pv2Threads.reply[cle], analyse: entrant ? entrant.analysis : null };
      delete pv2Threads.reply[cle];
      if (entrant) entrant.analysis = { ...(entrant.analysis || {}), reply: { subject: 'Bien reçu, Fun Galaxy Libramont', body: 'Bonjour,' } };
      renderStaffEmailsPage();
      const sujet = (pv2Threads.reply[cle] || {}).subject;
      pv2Threads.reply[cle] = avant.brouillon;
      if (entrant) entrant.analysis = avant.analyse;
      renderStaffEmailsPage();
      return { sujet, objetFil: d.thread.subject, agentMonte: Boolean(entrant) };
    });
    ok(objetAgentAutre.agentMonte && objetAgentAutre.sujet === `Re: ${objetAgentAutre.objetFil}`,
      'l agent propose un AUTRE objet (cas reel du 17/09) : la reponse garde « Re: » + l objet de la conversation', JSON.stringify(objetAgentAutre));
    await page.evaluate(() => [...document.querySelectorAll('#staffEmailsPage .pv2-thread-reply button')].find((b) => /Voir le mail final/.test(b.textContent)).click());
    await attendre(page, () => window.__APPELS__.some((e) => e.action === 'directEmailPreview' && e.fini) && document.querySelector('#emailPreviewOverlay iframe'), null, 'l apercu du mail final s ouvre');
    const apercuReponse = await page.evaluate(() => {
      const p = window.__APPELS__.filter((e) => e.action === 'directEmailPreview').slice(-1)[0];
      const f = document.querySelector('#emailPreviewOverlay iframe');
      const out = { body: p && p.body, sandbox: f ? f.getAttribute('sandbox') : null, srcdoc: f ? f.srcdoc : '' };
      if (typeof closeEmailPreview === 'function') closeEmailPreview();
      return out;
    });
    ok(apercuReponse.body && apercuReponse.body.signature === true && apercuReponse.body.signatoryName === 'Camille Dev' && apercuReponse.body.signatoryRole === 'Direction',
      'l apercu du mail final part avec la signature et le signataire', JSON.stringify({ s: apercuReponse.body && apercuReponse.body.signature, n: apercuReponse.body && apercuReponse.body.signatoryName }));
    ok(apercuReponse.sandbox === '' && /Camille Dev/.test(apercuReponse.srcdoc), 'le mail final s affiche dans une iframe sandbox et porte la signature de Camille Dev');
    await page.evaluate(() => [...document.querySelectorAll('#staffEmailsPage .pv2-thread-reply button')].find((b) => /Envoyer/.test(b.textContent)).click());
    await attendre(page, () => window.__APPELS__.some((e) => e.action === 'sendDirectEmail' && e.fini), null, 'la reponse part');
    await attendre(page, () => document.querySelectorAll('#staffEmailsPage .pl-timeline-msg').length === 3, null, 'le fil se recharge avec la reponse en plus');
    await dormir(300);
    const envoi = await page.evaluate(() => {
      const p = window.__APPELS__.filter((e) => e.action === 'sendDirectEmail').slice(-1)[0];
      const msgs = [...document.querySelectorAll('#staffEmailsPage .pl-timeline-msg')];
      const dernier = msgs[msgs.length - 1];
      return {
        body: p.body, status: p.status, payload: p.payload,
        ordre: msgs.map((m) => m.getAttribute('data-message-id')),
        dernierSortant: dernier.classList.contains('is-outbound'),
        dernierNom: (dernier.querySelector('.pv2-mail-entete strong') || {}).textContent || '',
        dernierVoie: (dernier.querySelector('.pv2-mail-voie') || {}).textContent || '',
        statut: (document.querySelector('#staffEmailsPage .pv2-thread-head .pv2-chip') || {}).textContent || '',
        releases: window.__APPELS__.filter((e) => e.action === 'releaseInboundEmail').map((e) => Number(e.body.communicationId)),
        listeARepondre: [...document.querySelectorAll('#staffEmailsPage .pv2-thread-row')].map((r) => r.getAttribute('data-thread-id')),
        filtre: pv2Threads.filtre,
        selection: String(pv2Threads.selectedId),
      };
    });
    const b = envoi.body || {};
    ok(Number(b.replyToCommunicationId) === 42 && String(b.threadId) === '901', 'sendDirectEmail porte replyToCommunicationId=42 et threadId=901', `${b.replyToCommunicationId} / ${b.threadId}`);
    ok(b.signature === true && b.signatoryName === 'Camille Dev' && b.signatoryRole === 'Direction', 'et la signature avec son signataire', `${b.signature} / ${b.signatoryName} / ${b.signatoryRole}`);
    ok(b.to === 'ansarbis2.0@gmail.com' && /apportez votre gâteau/.test(String(b.body)), 'au bon destinataire, avec le texte tape', b.to);
    ok(envoi.status === 200 && envoi.payload && envoi.payload.communication, 'le serveur de fixtures accepte la reponse');
    ok(envoi.ordre.length === 3 && envoi.dernierSortant && envoi.dernierNom === 'Camille Dev' && /Manuel/.test(envoi.dernierVoie), 'la reponse apparait en fin de fil, signee Camille Dev, voie « Envoye · Manuel »', `${envoi.dernierNom} / ${envoi.dernierVoie}`);
    ok(envoi.statut === 'Répondu', 'le fil passe en « Repondu »', envoi.statut);
    ok(envoi.releases.slice(-1)[0] === 42, 'la main est relachee sur le message 42 apres l envoi', envoi.releases.join(','));
    ok(envoi.filtre === 'repondus' && envoi.listeARepondre.includes('901') && envoi.selection === '901', 'le suivi suit la conversation : l onglet passe sur « Repondus », le fil y est, toujours ouvert', `${envoi.filtre} / ${envoi.listeARepondre.join(',')} / ${envoi.selection}`);
    await page.evaluate(() => pv2ThreadsFilter('a-repondre'));
    await page.waitForTimeout(900);
    const resteARepondre = await page.evaluate(() => [...document.querySelectorAll('#staffEmailsPage .pv2-thread-row')].map((r) => r.getAttribute('data-thread-id')));
    ok(resteARepondre.join(',') === '904', 'et il a quitte la liste « A repondre »', resteARepondre.join(','));

    // =====================================================================
    console.log('\n[APPARENCE] gabarit -> emailDesignPreview, l iframe recoit le HTML');
    // =====================================================================
    await allerA(page, 'apparence');
    await attendre(page, () => pv2Design.loaded && document.querySelectorAll('#staffEmailsPage .pv2-design-preset').length === 4 && window.__APPELS__.some((e) => e.action === 'emailDesignPreview' && e.fini), null, 'Apparence chargee : quatre gabarits et un premier apercu');
    await dormir(300);
    const lireDesign = () => page.evaluate(() => {
      const liste = window.__APPELS__.filter((e) => e.action === 'emailDesignPreview');
      const dernier = liste.slice(-1)[0];
      const f = document.querySelector('#staffEmailsPage iframe[data-pv2-frame="design"]');
      return {
        n: liste.length,
        corps: dernier ? dernier.body : null,
        htmlServeur: dernier && dernier.payload ? dernier.payload.html : '',
        preset: pv2Design.design.preset,
        actif: ((document.querySelector('#staffEmailsPage .pv2-design-preset.is-active') || {}).textContent || '').trim(),
        srcdoc: f ? f.srcdoc : null,
        sandbox: f ? f.getAttribute('sandbox') : null,
        etat: ((document.querySelector('#staffEmailsPage [data-pv2-apercu="design"] [data-pv2-apercu-etat]') || {}).textContent || '').trim(),
        sujet: ((document.querySelector('#staffEmailsPage [data-pv2-apercu="design"] [data-pv2-apercu-sujet]') || {}).textContent || '').trim(),
        enregistrerInactif: (document.querySelector('#staffEmailsPage .pv2-design-actions .pv2-btn.primary') || {}).disabled,
        note: ((document.querySelector('#staffEmailsPage .pv2-design-preview .pv2-note:last-child') || {}).textContent || '').trim(),
        dirty: pv2Design.dirty,
      };
    });
    const design0 = await lireDesign();
    ok(design0.preset === 'classique' && /Classique/.test(design0.actif), 'le gabarit en vigueur (Classique) est selectionne', design0.actif);
    ok(design0.sandbox === '' && Boolean(design0.srcdoc) && design0.srcdoc === design0.htmlServeur && /FIXTURE dev-console-server/.test(design0.srcdoc), 'l iframe sandbox affiche EXACTEMENT le HTML rendu par le serveur');
    ok(design0.etat === 'À jour' && Boolean(design0.sujet), 'etat « A jour » et objet du mail d exemple affiches', `${design0.etat} / ${design0.sujet}`);
    ok(design0.enregistrerInactif === true && design0.dirty === false, 'rien a enregistrer tant que rien n a change');
    await page.click('#staffEmailsPage .pv2-design-preset:has-text("Contraste")');
    await attendre(page, (n0) => {
      const liste = window.__APPELS__.filter((e) => e.action === 'emailDesignPreview');
      return liste.length === n0 + 1 && liste[liste.length - 1].fini;
    }, design0.n, 'un nouvel apercu part apres le changement de gabarit');
    await dormir(250);
    const design1 = await lireDesign();
    ok(design1.n === design0.n + 1 && design1.corps && design1.corps.design && design1.corps.design.preset === 'contraste' && design1.corps.sample === 'confirmation',
      'emailDesignPreview part avec le BROUILLON (preset contraste) et l exemple courant', JSON.stringify({ n: design1.n - design0.n, preset: design1.corps && design1.corps.design && design1.corps.design.preset }));
    ok(design1.srcdoc !== design0.srcdoc && design1.srcdoc === design1.htmlServeur, 'l iframe change et recoit exactement le HTML de la reponse');
    ok(/Contraste/.test(design1.actif) && design1.preset === 'contraste' && design1.dirty === true && design1.enregistrerInactif === false && /non enregistr/.test(design1.note),
      'Contraste est selectionne, le brouillon est marque non enregistre, Enregistrer s active', design1.note);
    await page.evaluate(() => [...document.querySelectorAll('#staffEmailsPage [data-pv2-apercu="design"] button')].find((b) => /Réponse/.test(b.textContent)).click());
    await attendre(page, (n1) => {
      const liste = window.__APPELS__.filter((e) => e.action === 'emailDesignPreview');
      return liste.length === n1 + 1 && liste[liste.length - 1].fini;
    }, design1.n, 'changer d exemple relance un apercu');
    await dormir(250);
    const design2 = await lireDesign();
    ok(design2.corps && design2.corps.sample === 'reponse' && design2.corps.design.preset === 'contraste' && /^Re: /.test(design2.sujet) && design2.srcdoc === design2.htmlServeur,
      'l exemple « Reponse » se rend avec le meme brouillon, objet « Re: … »', design2.sujet);
    await page.click('#staffEmailsPage .pv2-design-actions .pv2-btn.primary');
    await attendre(page, () => window.__APPELS__.some((e) => e.action === 'emailDesign' && e.fini), null, 'l enregistrement part');
    await dormir(400);
    const sauve = await page.evaluate(() => {
      const p = window.__APPELS__.filter((e) => e.action === 'emailDesign').slice(-1)[0];
      return {
        preset: p.body.design && p.body.design.preset, status: p.status, par: p.payload && p.payload.design && p.payload.design.updatedBy,
        dirty: pv2Design.dirty, note: ((document.querySelector('#staffEmailsPage .pv2-design-preview .pv2-note:last-child') || {}).textContent || '').trim(),
        enregistrerInactif: (document.querySelector('#staffEmailsPage .pv2-design-actions .pv2-btn.primary') || {}).disabled,
      };
    });
    ok(sauve.preset === 'contraste' && sauve.status === 200 && sauve.par === 'Camille Dev', 'POST emailDesign {design} accepte, signe par la personne connectee', `${sauve.preset} / ${sauve.par}`);
    ok(sauve.dirty === false && sauve.enregistrerInactif === true && /Camille Dev/.test(sauve.note), 'apres enregistrement : plus rien a enregistrer, la note dit qui a modifie et quand', sauve.note);

    // =====================================================================
    console.log('\n[SEQUENCES] frappe -> automationPreview debounce, l iframe change');
    // =====================================================================
    await allerA(page, 'sequences');
    // Six sequences Pinlane, plus la sequence perso des fixtures (carte
    // .pv2-seq-card, elle aussi une .mk-auto).
    await attendre(page, () => document.querySelectorAll('#staffEmailsPage .mk-auto:not(.pv2-seq-card)').length === 6 && document.querySelectorAll('#staffEmailsPage .pv2-seq-card').length === 1, null, 'les six sequences Pinlane et la sequence perso des fixtures sont chargees');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => c.querySelector('[data-switch-key="auto:confirmation"]'));
      card.querySelector('.mk-auto-edit-btn').click();
    });
    await attendre(page, () => {
      const liste = window.__APPELS__.filter((e) => e.action === 'automationPreview');
      return !!document.getElementById('mkAutoBody') && liste.length >= 1 && liste[liste.length - 1].fini;
    }, null, 'l editeur Confirmation s ouvre avec son apercu vivant');
    await dormir(300);
    const seq0 = await page.evaluate(() => ({
      n: window.__APPELS__.filter((e) => e.action === 'automationPreview').length,
      srcdoc: (document.querySelector('#staffEmailsPage iframe[data-pv2-frame="auto"]') || {}).srcdoc || '',
      etat: ((document.querySelector('#staffEmailsPage [data-pv2-apercu="auto"] [data-pv2-apercu-etat]') || {}).textContent || '').trim(),
    }));
    ok(Boolean(seq0.srcdoc) && /FIXTURE dev-console-server/.test(seq0.srcdoc) && seq0.etat === 'À jour', 'l apercu initial de la sequence est rendu par le serveur', seq0.etat);
    await page.click('#mkAutoBody');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Merci', { delay: 30 });
    await dormir(1200);
    const seq1 = await page.evaluate((n0) => {
      const liste = window.__APPELS__.filter((e) => e.action === 'automationPreview');
      const dernier = liste[liste.length - 1];
      const f = document.querySelector('#staffEmailsPage iframe[data-pv2-frame="auto"]');
      return {
        nouveaux: liste.length - n0,
        cle: dernier && dernier.body ? dernier.body.key : '',
        corps: dernier && dernier.body ? dernier.body.body : null,
        htmlServeur: dernier && dernier.payload ? dernier.payload.html : '',
        srcdoc: f ? f.srcdoc : '',
        focus: document.activeElement ? document.activeElement.id : '',
        // La valeur de l editeur a jetons est la verite du brouillon (l etat
        // interne n est pas expose ; l accesseur value l est).
        brouillon: document.getElementById('mkAutoBody').value,
      };
    }, seq0.n);
    ok(seq1.nouveaux === 1, `6 frappes rapides -> UN SEUL automationPreview (obtenu ${seq1.nouveaux})`);
    ok(seq1.cle === 'confirmation' && typeof seq1.corps === 'string' && /Merci$/.test(seq1.corps.trim()) && seq1.corps === seq1.brouillon, 'l appel porte la cle de la sequence et le brouillon complet tel que tape', JSON.stringify(seq1.corps));
    ok(seq1.srcdoc !== seq0.srcdoc && seq1.srcdoc === seq1.htmlServeur && /Merci/.test(seq1.srcdoc), 'l iframe change et montre le texte tape, rendu par le serveur');
    ok(seq1.focus === 'mkAutoBody', 'le focus est reste dans le champ pendant la mise a jour de l apercu', seq1.focus);

    // =====================================================================
    console.log('\n[THEME SOMBRE] chaque section, sans erreur');
    // =====================================================================
    const erreursAvantSombre = desktop.journal.console.length + desktop.journal.pageErrors.length;
    await page.evaluate(() => setStaffTheme('dark'));
    await dormir(200);
    const sombre = await page.evaluate(async () => {
      const fond = () => getComputedStyle(document.body).backgroundColor;
      const sombreFond = fond();
      const theme = document.documentElement.getAttribute('data-theme');
      const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
      const sections = [];
      for (const s of ['apercu', 'recus', 'envoyes', 'sequences', 'modeles', 'apparence', 'expediteurs', 'agent', 'exclusions', 'campagnes']) {
        pv2EmailsGo(s);
        await new Promise((r) => setTimeout(r, 350));
        sections.push(document.querySelector('#pv2EmailsPanel').getAttribute('data-section'));
      }
      setStaffTheme('light');
      await new Promise((r) => setTimeout(r, 150));
      return { theme, page, sombreFond, clairFond: fond(), sections };
    });
    ok(sombre.theme === 'dark' && sombre.sombreFond !== sombre.clairFond, 'le theme sombre s applique (data-theme=dark, fond different du clair)', `${sombre.sombreFond} vs ${sombre.clairFond}`);
    ok(sombre.sections.join(',') === SECTIONS.join(','), 'les dix sections se rendent en sombre');
    ok(desktop.journal.console.length + desktop.journal.pageErrors.length === erreursAvantSombre, 'aucune erreur console pendant la traversee en sombre');

    // =====================================================================
    console.log('\n[MOBILE 390] aucun debordement horizontal, section par section');
    // =====================================================================
    const contexteMobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await brancherGardeReseau(contexteMobile);
    mobile = await ouvrirPage(contexteMobile);
    const pm = mobile.page;
    for (const section of SECTIONS) {
      await pm.evaluate((s) => pv2EmailsGo(s), section);
      await dormir(500);
      if (section === 'recus') {
        await attendre(pm, () => document.querySelector('#staffEmailsPage .pv2-thread-row'), null, 'mobile : les conversations sont chargees');
        await pm.evaluate(() => { const r = document.querySelector('#staffEmailsPage .pv2-thread-row'); if (r) r.click(); });
        await attendre(pm, () => pv2Threads.detail.loaded && document.querySelector('#staffEmailsPage .pl-timeline-msg'), null, 'mobile : un fil est ouvert');
        await dormir(300);
      }
      if (section === 'sequences') {
        await attendre(pm, () => document.querySelector('#staffEmailsPage .mk-auto-edit-btn'), null, 'mobile : les sequences sont chargees');
        await pm.evaluate(() => { const b = document.querySelector('#staffEmailsPage .mk-auto-edit-btn'); if (b) b.click(); });
        await dormir(700);
      }
      if (section === 'apparence') {
        await attendre(pm, () => pv2Design.loaded && document.querySelector('#staffEmailsPage iframe[data-pv2-frame="design"]'), null, 'mobile : l apparence est chargee');
        await dormir(400);
      }
      const m = await pm.evaluate(mesurerDebordement);
      ok(m.sw <= m.cw && m.rootSw <= m.rootCw + 1 && m.fautifs.length === 0,
        `390 px, section ${section} : aucun debordement horizontal`, `document ${m.sw}/${m.cw}, page ${m.rootSw}/${m.rootCw}${m.fautifs.length ? ', fautifs ' + m.fautifs.join(' ') : ''}`);
    }

    // =====================================================================
    console.log('\n[CONSOLE ET RESEAU] zero erreur, zero sortie');
    // =====================================================================
    for (const [nom, j] of [['bureau', desktop.journal], ['mobile', mobile.journal]]) {
      ok(j.console.length === 0, `${nom} : aucune erreur console (${j.console.length})`, j.console.slice(0, 3).join(' | '));
      ok(j.pageErrors.length === 0, `${nom} : aucune erreur de page (${j.pageErrors.length})`, j.pageErrors.slice(0, 3).join(' | '));
      ok(j.manques.size === 0, `${nom} : aucune URL en 404 sur le serveur de fixtures`, [...j.manques].slice(0, 5).join(' · '));
    }
    const inconnues = externes.filter((u) => !EXTERNES_TOLERES.some((re) => re.test(u)));
    ok(inconnues.length === 0, `zero reseau externe : toute sortie est interceptee, et seule la reference connue (analytics Vercel de index.html) a ete vue (${externes.length} interceptee(s))`, inconnues.slice(0, 3).join(' | '));
  } catch (error) {
    console.error('\nemails-threads-ui-check FAIL :', error && error.stack || error);
    failures += 1;
  } finally {
    await browser.close();
    await new Promise((resolve) => serveur.close(resolve));
  }
  if (failures) { console.error(`\nemails-threads-ui-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nemails-threads-ui-check: ALL OK');
}

main().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

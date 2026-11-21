// LES GESTES DE LA CONSOLE BOUGENT, ET RIEN N'ATTEND LEUR MOUVEMENT (gate né le 2026-11-20).
//
// Ansar, le 20/11, sur la console : « il faut bcpppp plus » de mouvement, partout, et léger.
// La vague 2 (assets/pinlane-mouvement.js) donne un mouvement à chaque geste courant : le
// repère glisse sous l'onglet choisi, le planning glisse d'un jour à l'autre, les lignes
// filtrées arrivent en cascade, le petit menu naît de son bouton, les barres de l'accueil
// glissent d'un chiffre à l'autre, la page ouverte depuis le menu monte, le toast porte une
// mèche, le contenu de la fiche arrive du côté de l'onglet, un dépliant descend, une onde de
// la couleur du nouvel état passe sur la ligne pointée Arrivé.
//
// Un mouvement de ce genre casse sans bruit : un rendu qui finit les animations nées
// pendant lui, un gestionnaire qui arrête le clic (le menu le fait, stopPropagation), un
// dépliant rempli après qu'on l'a entendu s'ouvrir. Rien ne rougit, la console redevient
// sèche. Ce gate fait chaque vrai geste dans la console montée sur une fixture, horloge des
// animations ralentie dix fois, et vérifie que le mouvement attendu tourne juste après.
// Il vérifie aussi ce qui ne doit jamais attendre le mouvement (le toast disparaît à
// l'heure, même quand sa sortie traîne) et le mouvement réduit (aucun geste ne bouge).
//
// --contre-preuves : chaque morceau est cassé à son tour dans le module servi (le disque
// n'est jamais touché) ; le contrôle qui le garde doit rougir.
'use strict';
const F = require('./planning-v3-fixtures');
const { chromium } = require('playwright-core');

const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.PINLANE_MOUVEMENT_GESTES_PORT || 5276);
const CONTRE = process.argv.includes('--contre-preuves');
// L'horloge des animations tourne dix fois moins vite : une animation de 170 ms dure 1,7 s,
// assez pour être lue même sur la machine lente de GitHub.
const LENT = 0.1;

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
  if (!cond) echecs += 1;
  return cond;
}

const IMAGES = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const TOUT_FINIR = () => {
  document.getAnimations().forEach((a) => {
    const t = a.effect && a.effect.getComputedTiming();
    if (!t || t.iterations === Infinity || a.playState !== 'running') return;
    try { a.finish(); } catch (e) { /* une animation qui ne sait pas finir reste comme elle est */ }
  });
};

// Les animations du mouvement (créées en JavaScript, ni transition ni animation CSS) qui
// tournent sur une cible du sélecteur.
function compter(page, sel) {
  return page.evaluate((sel) => document.getAnimations().filter((a) => {
    if (a.playState !== 'running') return false;
    if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) return false;
    if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) return false;
    const t = a.effect && a.effect.target;
    return Boolean(t) && t.nodeType === 1 && t.matches(sel);
  }).length, sel);
}
// Les transitions CSS qui tournent (les barres du graphique glissent par transition).
function compterTransitions(page, sel) {
  return page.evaluate((sel) => document.getAnimations().filter((a) => {
    const t = a.effect && a.effect.target;
    return a.playState === 'running' && typeof CSSTransition !== 'undefined' && a instanceof CSSTransition && Boolean(t) && t.nodeType === 1 && t.matches(sel);
  }).length, sel);
}

// Ce qui tourne, en clair : le détail d'un contrôle rouge.
function releve(page) {
  return page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => {
    const t = a.effect && a.effect.target;
    const nom = typeof CSSTransition !== 'undefined' && a instanceof CSSTransition ? a.transitionProperty : (a.animationName || 'js');
    return nom + '@' + (t ? (t.id ? '#' + t.id : String(t.className && t.className.baseVal !== undefined ? t.className.baseVal : t.className || t.tagName).split(' ')[0]) : '?');
  }).slice(0, 12));
}

async function cliquer(page, sel) {
  const b = await page.locator(sel).filter({ visible: true }).first().boundingBox().catch(() => null);
  if (!b) return false;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  return true;
}
async function calmer(page) {
  await page.evaluate(TOUT_FINIR);
  await page.waitForTimeout(120);
  await page.evaluate(TOUT_FINIR);
}
async function apresLeGeste(page) { await page.evaluate(IMAGES); }
// Le bouton ▾ d'une ligne bien à l'écran, cliqué.
async function ouvrirPetitMenu(page) {
  const pret = await page.evaluate(() => {
    document.querySelectorAll('[data-gate-menu]').forEach((x) => x.removeAttribute('data-gate-menu'));
    const b = [...document.querySelectorAll('button.gf-gb--fleche, .gf-gb--statut')].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.top > 160 && r.bottom < innerHeight - 40; });
    if (b) b.setAttribute('data-gate-menu', '1');
    return Boolean(b);
  });
  return pret && cliquer(page, '[data-gate-menu="1"]');
}
// Le planning complet par le menu de gauche (son groupe déplié s'il le faut). `calme: false` :
// le clic part sans attendre, pour lire le mouvement qu'il lance.
async function allerAuPlanning(page, { calme = true } = {}) {
  if (!(await page.locator('[data-fgx-menu-key="complete"]').filter({ visible: true }).count())) {
    await cliquer(page, '[data-fgx-menu-toggle="planning"]');
    await page.waitForTimeout(400);
    await calmer(page);
  }
  const ok = await cliquer(page, '[data-fgx-menu-key="complete"]');
  if (calme) { await page.waitForTimeout(400); await calmer(page); }
  return ok;
}

// Chaque étape part de l'état où la console s'ouvre (le planning complet) ou s'y amène.
const ETAPES = {
  async onglets({ page }, v) {
    await calmer(page);
    v('onglets : Bowling est à l écran', await cliquer(page, '#staffTabBowling'));
    await apresLeGeste(page);
    v('onglets : le repère glisse sous l onglet choisi', (await compter(page, '.pl-repere')) >= 1);
    v('onglets : le planning choisi monte', (await compter(page, '#planningBox')) >= 1);
    await calmer(page);
    await cliquer(page, '#staffTabAll');
    await apresLeGeste(page);
    v('onglets : retour au planning complet, il monte', (await compter(page, '#globalPlanningBox')) >= 1);
    await calmer(page);
  },
  async jour({ page }, v) {
    await calmer(page);
    v('jour : le bouton du jour suivant est à l écran', await cliquer(page, '#staffNextDateBtn'));
    await apresLeGeste(page);
    v('jour : le planning glisse vers le jour suivant', (await compter(page, '#globalPlanningBox, #planningBox, #laserPlanningBox')) >= 1);
    v('jour : la date écrite roule', (await compter(page, '#staffDateShort, #staffDateLabel')) >= 1);
    await calmer(page);
    await cliquer(page, '#staffPrevDateBtn');
    await calmer(page);
  },
  async filtre({ page }, v) {
    await calmer(page);
    v('filtre : un filtre du planning complet est à l écran', await cliquer(page, '#planningBande button.gf-c:not(.is-on):not(.gf-c--tout)'));
    await apresLeGeste(page);
    v('filtre : les lignes arrivent en cascade', (await compter(page, '.gf-t tr.gf-r')) >= 3);
    await calmer(page);
    await cliquer(page, '#planningBande button.gf-c--tout');
    await calmer(page);
  },
  async petitMenu({ page }, v) {
    await calmer(page);
    v('petit menu : un bouton de statut est à l écran', await ouvrirPetitMenu(page));
    await apresLeGeste(page);
    v('petit menu : il naît de son bouton', (await compter(page, '.staff-action-popover')) >= 1);
    // Il se ferme, et ne reste jamais sur la page suivante (le 20/11, il y restait : le menu
    // de gauche arrête ses clics, la fermeture posée sur document ne les entendait pas).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    v('petit menu : Échap le ferme', await page.evaluate(() => !document.querySelector('.staff-action-popover')));
    await calmer(page);
    await ouvrirPetitMenu(page);
    await calmer(page);
    await cliquer(page, '[data-fgx-menu-key="dashboard"]');
    await page.waitForTimeout(200);
    v('petit menu : il ne reste pas ouvert sur la page suivante', await page.evaluate(() => state.staffMenuPage === 'dashboard' && !document.querySelector('.staff-action-popover')));
    await calmer(page);
    await allerAuPlanning(page);
  },
  async arrive({ page }, v) {
    await calmer(page);
    const pret = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.gf-t tr.gf-r [data-gf-arrive]')].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.top > 160 && r.bottom < innerHeight - 40; });
      if (b) b.setAttribute('data-gate-arrive', '1');
      return Boolean(b);
    });
    v('arrivé : un bouton Arrivé est à l écran', pret && await cliquer(page, '[data-gate-arrive="1"]'));
    await apresLeGeste(page);
    v('arrivé : une onde passe sur la ligne', (await compter(page, '.pl-onde')) >= 1);
    await calmer(page);
    v('arrivé : l onde ne laisse rien derrière elle', await page.evaluate(() => !document.querySelector('.pl-onde')));
    // (un groupe en retard : « Arrivé » ouvre d abord la fenetre du retard, 2026-11-21 ; elle
    // se ferme par son choix, sinon elle couvre les gestes suivants)
    if (await page.locator('#retardFenetre').count()) await page.locator('#retardFenetre [data-rt-choix="garder"]').click({ timeout: 4000 }).catch(() => null);
  },
  async barres({ page }, v) {
    await calmer(page);
    v('barres : l accueil s ouvre depuis le menu', await cliquer(page, '[data-fgx-menu-key="dashboard"]'));
    await page.waitForTimeout(400);
    await calmer(page);
    v('barres : une autre tuile est à l écran', await cliquer(page, '.plt-tuile[data-plt-tuile]:not(.is-on)'));
    await apresLeGeste(page);
    const glisse = await page.evaluate(() => Boolean(document.querySelector('.plc-glisse.plc-glisse-go')));
    const barres = await compterTransitions(page, '.plc-bar');
    v('barres : les barres glissent d un chiffre à l autre', glisse && barres >= 3, { glisse, barres });
    v('barres : le repère glisse sous la tuile choisie', (await compter(page, '.pl-repere')) >= 1);
    await calmer(page);
  },
  async menuPlanning({ page }, v) {
    await calmer(page);
    if (!(await page.evaluate(() => state.staffMenuPage === 'dashboard'))) {
      await cliquer(page, '[data-fgx-menu-key="dashboard"]');
      await page.waitForTimeout(400);
      await calmer(page);
    }
    v('menu : le planning complet est dans le menu', await allerAuPlanning(page, { calme: false }));
    await apresLeGeste(page);
    v('menu : la page du planning monte en cascade', (await compter(page, '#planningBarre, #globalPlanningBox, #planningBox')) >= 1);
    await calmer(page);
  },
  async toast({ page, cdp }, v) {
    await calmer(page);
    // Encore plus lent (vingt fois) : sa sortie de 160 ms dure 3,2 s. Le toast doit quand même
    // disparaître vers 2,8 s, à l'heure de sa minuterie.
    await cdp.send('Animation.setPlaybackRate', { playbackRate: LENT / 2 });
    const t0 = Date.now();
    await page.evaluate(() => toast('Essai du mouvement'));
    await apresLeGeste(page);
    v('toast : la mèche dit le temps qui reste', (await compter(page, '#toast .pl-meche')) >= 1);
    const reste = Math.max(0, 4000 - (Date.now() - t0));
    const cache = await page.waitForFunction(() => document.getElementById('toast').classList.contains('hidden'), null, { timeout: reste }).then(() => true).catch(() => false);
    v('toast : il disparaît à l heure, sans attendre son mouvement', cache, { apres_ms: Date.now() - t0 });
    await cdp.send('Animation.setPlaybackRate', { playbackRate: LENT });
    await calmer(page);
  },
  async fiche({ page }, v) {
    await calmer(page);
    // LA FICHE S'OUVRE VITE (20/11, le gérant : « pas fluide du tout », « trop lente »). Un vrai clic
    // sur le nom d'une ligne : la vraie fenêtre naît elle-même (opacité 0 à 1, échelle 0,98 à 1,
    // 160 à 200 ms, ease-out), le fond en 150 ms au plus, aucun calque ne vole, aucune seconde
    // animation. Les durées se lisent dans l'effet (getComputedTiming), que l'horloge ralentie
    // du gate ne change pas ; la visibilité se lit à 60 ms de la ligne de temps de la fenêtre.
    await page.evaluate(() => {
      document.querySelectorAll('[data-gate-nom]').forEach((x) => x.removeAttribute('data-gate-nom'));
      const n = [...document.querySelectorAll('.gf-t tr.gf-r:not(.gf-retenue) .gf-nom__t')].find((x) => { const r = x.getBoundingClientRect(); return r.width > 10 && r.top > 140 && r.bottom < innerHeight - 40; });
      if (n) n.setAttribute('data-gate-nom', '1');
    });
    const lire = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.nodeType === 1 && a.effect.getComputedTiming().iterations !== Infinity).map((a) => {
      const x = a.effect.target;
      const t = a.effect.getComputedTiming();
      const cle = a.effect.getKeyframes();
      const sur = x.matches('.pl-vol, .pl-voile') ? 'calque' : (x.id === 'posOverlay' ? 'voile' : (x.matches('.edit-modal') ? 'fenetre' : (x.closest('#posOverlay') ? 'dedans' : 'ailleurs')));
      return { sur, fin: t.endTime, css: typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation, ordre: cle.map((k) => k.opacity + '/' + (k.transform || '')).join(' > '), easing: t.easing, classe: String(x.className && x.className.baseVal !== undefined ? x.className.baseVal : x.className || '').split(' ')[0] };
    }));
    v('fiche : le nom d une ligne est à l écran', await cliquer(page, '[data-gate-nom="1"]'));
    await apresLeGeste(page);
    const ouv = await lire();
    const fen = ouv.filter((x) => x.sur === 'fenetre');
    const voile = ouv.filter((x) => x.sur === 'voile');
    v('fiche : la vraie fenêtre naît elle-même, une seule animation, sans retard', fen.length === 1 && fen[0].ordre === '0/scale(0.98) > 1/scale(1)', ouv);
    v('fiche : elle s ouvre en 160 à 200 ms', fen.length === 1 && fen[0].fin >= 160 && fen[0].fin <= 200, ouv);
    v('fiche : elle s ouvre en ease-out fort', fen.length === 1 && /cubic-bezier\(0\.23, 1, 0\.32, 1\)/.test(fen[0].easing), ouv);
    v('fiche : le fond apparaît en 150 ms au plus', voile.length >= 1 && voile.every((x) => x.fin <= 150), ouv);
    v('fiche : aucun calque ne vole, aucune ombre mise à l échelle', !ouv.some((x) => x.sur === 'calque') && (await page.locator('.pl-vol').count()) === 0, ouv);
    v('fiche : aucune seconde animation sur la fiche (ni .fade-in, ni entrée CSS)', !ouv.some((x) => x.css && x.sur !== 'ailleurs') && !ouv.some((x) => x.sur === 'dedans' && x.classe === 'pos-sheet') && (await page.locator('#posOverlay .pos-sheet.fade-in').count()) === 0, ouv);
    // Lisible tôt : à 60 ms de sa ligne de temps, la fenêtre est déjà visible (l'ancienne attendait 273 ms).
    const tot = await page.evaluate(() => {
      const a = document.getAnimations().find((x) => x.effect && x.effect.target && x.effect.target.matches && x.effect.target.matches('#posOverlay .edit-modal'));
      if (!a) return null;
      a.pause();
      a.currentTime = 60;
      const o = Number(getComputedStyle(a.effect.target).opacity);
      a.finish();
      return o;
    });
    v('fiche : lisible dès 60 ms (opacité d au moins 0,8)', tot !== null && tot >= 0.8, { tot });
    await calmer(page);
    await page.keyboard.press('Escape');
    await apresLeGeste(page);
    const fer = await lire();
    v('fiche : la fermeture prend 150 ms au plus', fer.length >= 1 && fer.every((x) => x.fin <= 150), fer);
    await page.evaluate(() => { const n = document.querySelector('[data-gate-nom="1"]'); if (n) n.click(); });
    await apresLeGeste(page);
    const re = await lire();
    v('fiche : rouverte à moins de 300 ms, sans animation', (await page.locator('#posOverlay:not(.hidden) .edit-modal').count()) === 1 && !re.some((x) => x.sur === 'fenetre' || x.sur === 'voile'), re);
    await calmer(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await calmer(page);
    await page.evaluate(() => {
      const r = state.reservations.find((x) => /Famille G.rard/.test(String(x.name || ''))) || state.reservations.find((x) => x.status === 'confirmed');
      openPos(r.id);
    });
    await page.waitForTimeout(Number(process.env.ATTENTE_FICHE || 300));
    await calmer(page);
    v('fiche : l onglet Modifier est à l écran', await cliquer(page, '#posOverlay .dossier-tabs .tab:not(.active)'));
    await apresLeGeste(page);
    v('fiche : le contenu arrive du côté de l onglet', (await compter(page, '#posOverlay .edit-modal-body > *')) >= 1);
    v('fiche : le repère glisse sous l onglet', (await compter(page, '.pl-repere')) >= 1, await releve(page));
    await calmer(page);
    await page.evaluate(() => { const d = document.querySelector('#posOverlay details.fm-pli'); if (d) d.scrollIntoView({ block: 'center' }); });
    await calmer(page);
    v('fiche : un dépliant de Modifier est à l écran', await cliquer(page, '#posOverlay details.fm-pli > summary'));
    await apresLeGeste(page);
    v('fiche : le dépliant descend en cascade', (await compter(page, '#posOverlay .fm-pli-corps')) >= 1);
    await calmer(page);
    await cliquer(page, '#posOverlay .dossier-tabs .tab:not(.active)');
    await page.waitForTimeout(200);
    await calmer(page);
    await page.evaluate(() => { const d = document.querySelector('#posOverlay details.fx-historique'); if (d) d.scrollIntoView({ block: 'center' }); });
    await calmer(page);
    v('fiche : l historique est à l écran', await cliquer(page, '#posOverlay details.fx-historique > summary'));
    await apresLeGeste(page);
    v('fiche : l historique descend une fois rempli', (await compter(page, '#posOverlay .fx-histo-corps')) >= 1);
    const arrive = await page.waitForFunction(() => document.querySelector('#posOverlay .fx-histo-panne, #posOverlay .fx-histo-entree, #posOverlay .fx-histo-etat:not([role="status"])'), null, { timeout: 5000 }).then(() => true).catch(() => false);
    v('fiche : la réponse de l historique entre en cascade', arrive && (await compter(page, '#posOverlay .fx-histo-panne, #posOverlay .fx-histo-entree, #posOverlay .fx-histo-etat')) >= 1, { arrive });
    await calmer(page);
  },
};
// (GESTES_ETAPES=fiche,toast : rejouer quelques étapes seulement, pour chercher une panne)
const ORDRE = process.env.GESTES_ETAPES ? process.env.GESTES_ETAPES.split(',') : ['onglets', 'jour', 'filtre', 'petitMenu', 'arrive', 'barres', 'menuPlanning', 'toast', 'fiche'];

async function scenario(navigateur, port, etapes, v) {
  const { ctx, page, erreurs } = await F.monter(navigateur, { fixture: 'pic', appareil: 'ordinateur', theme: 'light', heure: '15:10', port });
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: LENT });
    for (const e of etapes) await ETAPES[e]({ page, cdp }, v);
    v('aucune erreur JavaScript pendant les gestes', erreurs.length === 0, erreurs.slice(0, 2));
  } finally {
    await ctx.close();
  }
}

// Mouvement réduit : les mêmes gestes ne lancent aucun mouvement, et le toast part quand même.
async function scenarioReduit(navigateur, port, v) {
  const { ctx, page, erreurs } = await F.monter(navigateur, { fixture: 'pic', appareil: 'ordinateur', theme: 'light', heure: '15:10', port, mouvementReduit: true });
  try {
    await cliquer(page, '#staffTabBowling');
    await apresLeGeste(page);
    const onglets = await compter(page, '.pl-repere, #planningBox, #globalPlanningBox');
    await cliquer(page, '#staffNextDateBtn');
    await apresLeGeste(page);
    const jour = await compter(page, '#globalPlanningBox, #planningBox, #staffDateShort, #staffDateLabel');
    await page.evaluate(() => toast('Essai du mouvement réduit'));
    await apresLeGeste(page);
    const toast = await compter(page, '#toast, #toast .pl-meche');
    v('mouvement réduit : aucun geste ne lance de mouvement', onglets + jour + toast === 0, { onglets, jour, toast });
    const cache = await page.waitForFunction(() => document.getElementById('toast').classList.contains('hidden'), null, { timeout: 4000 }).then(() => true).catch(() => false);
    v('mouvement réduit : le toast disparaît quand même', cache);
    v('mouvement réduit : aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2));
  } finally {
    await ctx.close();
  }
}

// Chaque mutation casse un morceau dans le fichier servi ; le contrôle nommé doit rougir.
const MOUVEMENT = 'assets/pinlane-mouvement.js';
const MUTATIONS = [
  { nom: 'le repère des onglets retiré', fichier: MOUVEMENT, de: "  repere('.pb-seg', '.pb-seg__b.active');\n", vers: '\n', etape: 'onglets', rougit: 'onglets : le repère glisse sous l onglet choisi' },
  { nom: 'le planning ne glisse plus d un jour à l autre', fichier: MOUVEMENT, de: '    glisserJour(apres > avant ? 1 : -1);', vers: '    void 0;', etape: 'jour', rougit: 'jour : le planning glisse vers le jour suivant' },
  { nom: 'les lignes filtrées n entrent plus', fichier: MOUVEMENT, de: "    entrer(document.querySelectorAll('.gf-t tr.gf-r'), { dy: 8, pas: 18, duree: 260, max: 12 });", vers: '    void 0;', etape: 'filtre', rougit: 'filtre : les lignes arrivent en cascade' },
  { nom: 'le petit menu apparaît sec', fichier: MOUVEMENT, de: "    pop.animate([{ opacity: 0, translate: '0px ' + (dessus ? 6 : -6) + 'px' }, { opacity: 1, translate: '0px 0px' }], { id: ID, duration: 170, easing: SORTIE });", vers: '    void 0;', etape: 'petitMenu', rougit: 'petit menu : il naît de son bouton' },
  { nom: 'Échap ne ferme plus le petit menu', fichier: 'assets/app-main.js', de: '  closeStaffFloatingMenus();\n  if (ancre && ancre.isConnected', vers: '  if (ancre && ancre.isConnected', etape: 'petitMenu', rougit: 'petit menu : Échap le ferme' },
  { nom: 'un toucher arrêté ne ferme plus le petit menu (le défaut du 20/11)', fichier: 'assets/app-main.js', de: '  if (menu._ancre && menu._ancre.contains && menu._ancre.contains(event.target)) return;\n  closeStaffFloatingMenus();', vers: '  if (menu._ancre && menu._ancre.contains && menu._ancre.contains(event.target)) return;', etape: 'petitMenu', rougit: 'petit menu : il ne reste pas ouvert sur la page suivante' },
  { nom: 'Arrivé sans onde', fichier: MOUVEMENT, de: '    if (ligne && peutAnimer(ligne)) onde(ligne);', vers: '    void 0;', etape: 'arrive', rougit: 'arrivé : une onde passe sur la ligne' },
  { nom: 'l onde reste posée sur la ligne', fichier: MOUVEMENT, de: '    a.onfinish = a.oncancel = function () { c.remove(); };', vers: '    void 0;', etape: 'arrive', rougit: 'arrivé : l onde ne laisse rien derrière elle' },
  { nom: 'les barres repartent de zéro', fichier: 'assets/pinlane-charts.js', de: '    var glisse = animate && Boolean(avant) && !reducedMotion();', vers: '    var glisse = false;', etape: 'barres', rougit: 'barres : les barres glissent d un chiffre à l autre' },
  { nom: 'le relais des clics arrêtés par le menu retiré', fichier: MOUVEMENT, de: '    if (enAttente.length) requestAnimationFrame(apresLeGeste);', vers: '    void 0;', etape: 'menuPlanning', rougit: 'menu : la page du planning monte en cascade' },
  { nom: 'la mèche du toast retirée', fichier: MOUVEMENT, de: "    m._plA = m.animate([{ transform: 'scaleX(' + depart + ')' }, { transform: 'scaleX(0)' }], { duration: duree, easing: 'linear', fill: 'forwards' });", vers: '    m._plA = null;', etape: 'toast', rougit: 'toast : la mèche dit le temps qui reste' },
  { nom: 'le toast attend la fin de sa sortie', fichier: MOUVEMENT, de: '    setTimeout(finir, 260);', vers: '    void 0;', etape: 'toast', rougit: 'toast : il disparaît à l heure, sans attendre son mouvement' },
  { nom: 'le repère ne retrouve plus une barre qui a bougé (le défaut du 20/11)', fichier: MOUVEMENT, de: '    return visibles.length === 1 ? visibles[0] : null;', vers: '    return null;', etape: 'fiche', rougit: 'fiche : le repère glisse sous l onglet' },
  { nom: 'le nettoyage des rendus achève les gestes (le défaut du 20/11)', fichier: 'assets/app-main.js', de: "    if (animation.id === 'pl-mouvement') return;", vers: '    void 0;', etape: 'fiche', rougit: 'fiche : le repère glisse sous l onglet' },
  { nom: 'le contenu de la fiche ne glisse plus', fichier: MOUVEMENT, de: "    entrer(enfantsVisibles(document.querySelector('#posOverlay .edit-modal-body')), { dx: sens * 18, dy: 0, pas: 30, duree: 280, max: 6 });", vers: '    void 0;', etape: 'fiche', rougit: 'fiche : le contenu arrive du côté de l onglet' },
  { nom: 'les dépliants n écoutent plus leur ouverture', fichier: MOUVEMENT, de: "    document.addEventListener('toggle', deplie, true);", vers: '    void 0;', etape: 'fiche', rougit: 'fiche : le dépliant descend en cascade' },
  { nom: 'le dépliant joue avant d être rempli (le défaut du 20/11)', fichier: MOUVEMENT, de: "    requestAnimationFrame(function () {\n      if (!d.open || !d.isConnected) return;\n      entrer(Array.prototype.filter.call(d.children, function (c) { return c.tagName !== 'SUMMARY'; }), { dy: -6, pas: 30, duree: 240, max: 6 });\n    });", vers: "    entrer(Array.prototype.filter.call(d.children, function (c) { return c.tagName !== 'SUMMARY'; }), { dy: -6, pas: 30, duree: 240, max: 6 });", etape: 'fiche', rougit: 'fiche : l historique descend une fois rempli' },
  { nom: 'la réponse de l historique arrive sèche', fichier: 'assets/app-main.js', de: '  if (arrivee && mouvement', vers: '  if (false && mouvement', etape: 'fiche', rougit: 'fiche : la réponse de l historique entre en cascade' },
  { nom: 'la fiche met 440 ms à finir (l ancien minutage)', fichier: MOUVEMENT, de: '      { duration: o.duree || 180, easing: SORTIE }', vers: '      { duration: o.duree || 440, easing: SORTIE }', etape: 'fiche', rougit: 'fiche : elle s ouvre en 160 à 200 ms' },
  { nom: 'la fiche reste invisible jusqu à 273 ms (l ancien fondu retardé)', fichier: MOUVEMENT, de: "[{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'scale(1)' }],", vers: "[{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 0, transform: 'scale(0.98)', offset: 0.62 }, { opacity: 1, transform: 'scale(1)' }],", etape: 'fiche', rougit: 'fiche : lisible dès 60 ms (opacité d au moins 0,8)' },
  { nom: 'la forme et son ombre volent de nouveau', fichier: MOUVEMENT, de: '    if (!peutAnimer(surface) || reouverture()) return;\n', vers: '    if (!peutAnimer(surface) || reouverture()) return;\n    voler(boite(origine) || boite(surface), boite(surface), { duree: 300 });\n', etape: 'fiche', rougit: 'fiche : aucun calque ne vole, aucune ombre mise à l échelle' },
  { nom: 'le fond met 200 ms à venir', fichier: MOUVEMENT, de: "voileEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: SORTIE });", vers: "voileEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: SORTIE });", etape: 'fiche', rougit: 'fiche : le fond apparaît en 150 ms au plus' },
  { nom: 'le .fade-in revient sur la fiche (la double animation)', fichier: 'assets/app-main.js', de: "function posSheetClass() { return 'pos-sheet'; }", vers: "function posSheetClass() { return 'pos-sheet fade-in'; }", etape: 'fiche', rougit: 'fiche : aucune seconde animation sur la fiche (ni .fade-in, ni entrée CSS)' },
  { nom: 'la fermeture dure 440 ms', fichier: MOUVEMENT, de: 'borderRadius, duree: 150, courbe: SORTIE', vers: 'borderRadius, duree: 440, courbe: SORTIE', etape: 'fiche', rougit: 'fiche : la fermeture prend 150 ms au plus' },
  { nom: 'la réouverture rapide rejoue l animation', fichier: MOUVEMENT, de: 'if (!peutAnimer(surface) || reouverture()) return;', vers: 'if (!peutAnimer(surface)) return;', etape: 'fiche', rougit: 'fiche : rouverte à moins de 300 ms, sans animation' },
  { nom: 'le mouvement réduit ignoré', fichier: MOUVEMENT, de: '  function reduit() { return Boolean(mq && mq.matches); }', vers: '  function reduit() { return false; }', etape: 'reduit', rougit: 'mouvement réduit : aucun geste ne lance de mouvement' },
];

async function main() {
  const navigateur = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    if (!CONTRE) {
      const serveur = await F.servir({ port: PORT });
      try {
        const v = (label, cond, detail) => ok(cond, label, detail);
        console.log('\n[LES GESTES]');
        await scenario(navigateur, PORT, ORDRE, v);
        console.log('\n[MOUVEMENT REDUIT]');
        await scenarioReduit(navigateur, PORT, v);
      } finally { serveur.close(); }
    } else {
      let courante = null;
      const transformer = (rel, texte) => {
        if (!courante || rel !== courante.fichier) return texte;
        const t = texte.replace(/\r\n/g, '\n');
        courante.vu = Math.max(courante.vu, t.split(courante.de).length - 1);
        return t.split(courante.de).join(courante.vers);
      };
      const serveur = await F.servir({ port: PORT + 1, transformer });
      try {
        for (const m of MUTATIONS) {
          console.log(`\n[CONTRE-PREUVE] ${m.nom}`);
          courante = m;
          m.vu = 0;
          const res = {};
          const v = (label, cond) => { res[label] = Boolean(cond); };
          if (m.etape === 'reduit') await scenarioReduit(navigateur, PORT + 1, v);
          else await scenario(navigateur, PORT + 1, [m.etape], v);
          if (!ok(m.vu === 1, `la ligne visée est dans ${m.fichier}, une seule fois (vue ${m.vu} fois ; sinon la mutation ne prouverait rien)`)) continue;
          ok(res[m.rougit] === false, `« ${m.rougit} » rougit : le gate ROUGIRAIT`, res);
        }
      } finally { serveur.close(); }
    }
  } finally {
    await navigateur.close();
  }
  console.log(`\nmouvement-gestes-check${CONTRE ? ' --contre-preuves' : ''} : ${echecs ? echecs + ' FAIL' : 'tout vert'}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error('ECHEC', e); process.exit(1); });

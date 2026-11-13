#!/usr/bin/env node
'use strict';
/* ============================================================================
   GATE : Emails, Apparence ouverte par son adresse (2026-11-13)

   Le defaut vu par Ansar : ouvrir Apparence directement
   (#/staff/emails/apparence, ou recharger dessus) ecrivait en rouge sous le
   titre « Lecture de vos mails… Failed to set the 'innerHTML' property on
   'Element': The node to be removed is no longer a child of this node ».

   La course : la page se redessine (root.innerHTML) quand une donnee arrive.
   Si ce redessin retire un cadre qui charge encore (en prod, les vignettes
   de la galerie) et que rien d autre ne retient le document, le navigateur
   termine le chargement du document PENDANT le retrait et declenche « load »
   sur-le-champ. Le filet post-chargement d app-main.js y relancait setView :
   un second rendu de la meme page, imbrique dans le premier, qui trouvait
   ensuite des noeuds deja partis. Correctif : le filet part au tour suivant.

   LE MONTAGE EST POSE PAR LE GATE, pas laisse au minutage. Naturellement,
   les cadres d Apparence chargent en 130 ms environ et la donnee suivante
   arrive 110 ms apres eux (mesure le 13/11) : 20 ms de marge, qui changent
   d une machine a l autre, et le navigateur fait passer la fin du chargement
   avant les minuteurs de la page. Ici, tant que le document charge, la page
   porte en plus un cadre du banc qui ne finit jamais de charger
   (/api/banc-cadre-lent) : le document ne peut finir de charger qu au moment
   ou un redessin retire ce cadre, comme il retirait les vignettes en prod.
   Les redessins sont ceux de la page (l arrivee des mails, ops-console.js)
   et, si la page n en fait plus, un redessin du banc toutes les 300 ms, fait
   comme ops-console.js le fait (renderStaffEmailsPage, puis
   renderStaffEmailsPage(message) si le rendu leve).

   Le banc sert ce que sert la prod pour Apparence : tous les gabarits avec
   leurs familles (la galerie et ses cadres) et les vignettes de
   emailDesignGallery, rendues par le vrai moteur des mails.

   Le gate asserte d abord le MONTAGE (« load » est tombe pendant un redessin
   de la page), puis le COMPORTEMENT : aucun redessin n a leve, pas de
   « Failed to set » a l ecran, aucune erreur de page, et la page vit
   normalement ensuite (la galerie recoit ses vignettes).

   --contre-preuves : app-main.js est servi avec le filet rendu synchrone,
   comme avant le 13/11 (le disque n est jamais ecrit) ; avec le meme
   montage, le gate doit alors rougir, sinon il est aveugle.
   ========================================================================== */
const { chromium } = require('playwright-core');
const dev = require('./dev-console-server.js');
const emailDesign = require('../lib/email-design.js');

const PORT = Number(process.env.PINLANE_APPARENCE_PORT || 4299);
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CONTRE_PREUVES = process.argv.includes('--contre-preuves');
const EXTERNES_TOLERES = [/^https:\/\/cdn\.vercel-insights\.com\//];
const CADRE_LENT = '/api/banc-cadre-lent';
// Le filet d avant le 13/11 : la meme fonction, appelee tout de suite.
const MUTATION = {
  fichier: 'assets/app-main.js',
  de: "window.addEventListener('load', () => setTimeout(() => {",
  vers: "window.addEventListener('load', () => ((filet) => filet())(() => {",
};

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Le banc de la console, avec ce que la prod sert en plus pour Apparence, et
// le cadre qui ne finit jamais de charger.
function creerRepondeur() {
  const base = dev.creerRepondeurFixtures({ origine: BASE });
  return {
    async repondre(method, url, body) {
      if (url.pathname === CADRE_LENT) { await dormir(60000); return { status: 200, payload: { ok: true } }; }
      const action = (body && body.action) || url.searchParams.get('action') || '';
      if (action === 'emailDesignGallery') {
        const design = body && body.design && typeof body.design === 'object' ? body.design : {};
        const html = dev.rendreMail({ design: { ...design, preset: 'classique' }, subject: 'Votre réservation', body: 'Bonjour Marie,\n\nVotre réservation est confirmée.', signature: true, portee: 'sequences' });
        return { status: 200, payload: { ok: true, vignettes: emailDesign.EMAIL_DESIGN_PRESETS.map((p) => ({ id: p.id, sample: 'confirmation', html })) } };
      }
      const reponse = await base.repondre(method, url, body);
      if (action === 'emailDesign' && method === 'GET' && reponse && reponse.payload && reponse.payload.presets) {
        reponse.payload.presets = emailDesign.EMAIL_DESIGN_PRESETS.map((p) => ({ ...p }));
        reponse.payload.familles = emailDesign.EMAIL_DESIGN_FAMILLES.map((f) => ({ ...f }));
      }
      return reponse;
    },
  };
}

// Dans la page : ce qui leve, ou tombe « load », le cadre lent et les
// redessins du banc (voir l en-tete).
function amorce(cadreLent) {
  if (window !== window.top) return;
  const banc = { cadresLents: 0, redessins: 0, imbriques: 0, dansLaPage: 0, piles: [], erreursDesRedessins: [], loadDansRedessin: false, loadHorsRedessin: false };
  window.__BANC__ = banc;
  const poserCadreLent = (root) => {
    const cadre = document.createElement('iframe');
    cadre.src = cadreLent;
    cadre.hidden = true;
    cadre.tabIndex = -1;
    cadre.setAttribute('aria-hidden', 'true');
    cadre.setAttribute('data-banc-cadre', '');
    // DANS le bloc de la page, jamais a cote : avec un seul enfant, innerHTML
    // remplace cet enfant (le chemin de la panne) ; avec deux, le navigateur
    // vide puis ajoute, et le rendu imbrique ne leve plus (vu le 13/11).
    (root.firstElementChild || root).appendChild(cadre);
    banc.cadresLents += 1;
  };
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true,
    get: d.get,
    set(valeur) {
      const laPage = this.id === 'staffEmailsPage';
      if (laPage) { banc.dansLaPage += 1; if (banc.dansLaPage > 1) banc.imbriques += 1; }
      try {
        d.set.call(this, valeur);
        if (laPage && document.readyState !== 'complete') poserCadreLent(this);
      } catch (error) {
        banc.piles.push(`${error.message} (sur #${this.id || this.tagName})`);
        throw error;
      } finally { if (laPage) banc.dansLaPage -= 1; }
    },
  });
  window.addEventListener('load', (event) => {
    if (event.target !== document) return;
    if (banc.dansLaPage) banc.loadDansRedessin = true; else banc.loadHorsRedessin = true;
  }, true);
  const minuteur = setInterval(() => {
    if (document.readyState === 'complete' || banc.redessins >= 40) { clearInterval(minuteur); return; }
    if (typeof window.renderStaffEmailsPage !== 'function' || !document.querySelector('#staffEmailsPage [data-banc-cadre]')) return;
    banc.redessins += 1;
    try { window.renderStaffEmailsPage(); } catch (error) {
      banc.erreursDesRedessins.push(error.message);
      window.renderStaffEmailsPage(error.message || 'Console Ops indisponible.');
    }
  }, 300);
}

async function ouvrirApparence(browser, mutation) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const externes = [];
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (!url.startsWith(BASE)) {
      if (!EXTERNES_TOLERES.some((re) => re.test(url))) externes.push(url);
      return route.abort();
    }
    if (mutation && new URL(url).pathname === `/${mutation.fichier}`) {
      const reponse = await route.fetch();
      const source = await reponse.text();
      mutation.fois = source.split(mutation.de).length - 1;
      return route.fulfill({ response: reponse, body: mutation.fois === 1 ? source.replace(mutation.de, () => mutation.vers) : source });
    }
    return route.continue();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(amorce, CADRE_LENT);
  await page.goto(`${BASE}/#/staff/emails/apparence`, { waitUntil: 'load', timeout: 45000 });
  return { context, page, pageErrors, externes };
}

function lireEtat() {
  const root = document.getElementById('staffEmailsPage');
  const texte = root ? root.innerText : '';
  const galerie = [...document.querySelectorAll('#staffEmailsPage iframe[data-pv2-frame^="galerie-"]')];
  return {
    banc: window.__BANC__ || {},
    rouge: (texte.match(/Failed to set[^\n]*/) || [''])[0],
    section: location.hash,
    familles: document.querySelectorAll('#staffEmailsPage .em-galerie-famille').length,
    cadresGalerie: galerie.length,
    vignettesPeintes: galerie.filter((f) => f.__pv2Html).length,
    cadresDuBancRestes: document.querySelectorAll('[data-banc-cadre]').length,
  };
}

// Les verdicts du comportement, les memes dans les deux modes.
function verdicts(e, pageErrors) {
  return [
    { cle: 'sansLevee', cond: !e.banc.piles.length && !e.banc.erreursDesRedessins.length, label: 'aucun redessin de la page ne leve', detail: e.banc.piles.concat(e.banc.erreursDesRedessins).slice(0, 2).join(' | ') },
    { cle: 'sansRouge', cond: !e.rouge, label: 'pas de « Failed to set » sous le titre', detail: e.rouge },
    { cle: 'sansErreurPage', cond: !pageErrors.length, label: 'aucune erreur de page', detail: pageErrors.slice(0, 2).join(' | ') },
  ];
}
const decrireMontage = (e) => `cadres lents=${e.banc.cadresLents} redessins du banc=${e.banc.redessins} rendus imbriques=${e.banc.imbriques} loadDansRedessin=${e.banc.loadDansRedessin} loadHorsRedessin=${e.banc.loadHorsRedessin}`;

async function main() {
  const serveur = dev.creerServeur(creerRepondeur());
  await new Promise((resolve, reject) => { serveur.once('error', reject); serveur.listen(PORT, HOST, resolve); });
  // Zero reseau externe, garanti par le navigateur : aucun nom d hote ne se
  // resout, sauf le serveur local (la route ci-dessus compte ce qui a tente).
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  try {
    const mutation = CONTRE_PREUVES ? { ...MUTATION, fois: 0 } : null;
    const { context, page, pageErrors, externes } = await ouvrirApparence(browser, mutation);
    if (!CONTRE_PREUVES) {
      await page.waitForFunction(() => [...document.querySelectorAll('#staffEmailsPage iframe[data-pv2-frame^="galerie-"]')].some((f) => f.__pv2Html), null, { timeout: 15000 }).catch(() => {});
    } else {
      await page.waitForFunction(() => /Failed to set/.test((document.getElementById('staffEmailsPage') || document.body).innerText), null, { timeout: 6000 }).catch(() => {});
    }
    await page.waitForTimeout(500);
    const e = await page.evaluate(lireEtat);
    const montage = e.banc.cadresLents > 0 && e.banc.loadDansRedessin;
    if (!CONTRE_PREUVES) {
      ok(montage, '[montage] Apparence ouverte par son adresse : « load » tombe pendant un redessin de la page', decrireMontage(e));
      ok(/apparence/.test(e.section) && e.familles >= 2 && e.cadresGalerie >= 4, '[montage] la page est Apparence, avec sa galerie en familles', `section=${e.section} familles=${e.familles} cadres=${e.cadresGalerie}`);
      for (const v of verdicts(e, pageErrors)) ok(v.cond, v.label, v.detail);
      ok(e.vignettesPeintes > 0, 'la page vit normalement ensuite : la galerie recoit ses vignettes', `${e.vignettesPeintes}/${e.cadresGalerie}`);
      ok(e.cadresDuBancRestes === 0, 'le cadre lent du banc ne survit pas au chargement', `${e.cadresDuBancRestes} reste(s)`);
      ok(!externes.length, 'aucune requete hors du banc', externes.slice(0, 3).join(' '));
    } else {
      const rouges = verdicts(e, pageErrors).filter((v) => !v.cond);
      ok(mutation.fois === 1, `[contre-preuve] l ancre du filet est dans ${MUTATION.fichier}, une fois`, `trouvee ${mutation.fois} fois`);
      ok(montage, '[contre-preuve] montage : « load » tombe pendant un redessin', decrireMontage(e));
      ok(rouges.length > 0, '[contre-preuve] avec le filet synchrone d avant le 13/11, le gate rougit',
        rouges.length ? `rougit sur : ${rouges.map((v) => `${v.label} (${v.detail})`).join(' ; ')}` : `rien ne rougit : le gate est aveugle (${decrireMontage(e)})`);
    }
    await context.close();
  } finally {
    await browser.close();
    serveur.close();
  }
  const nom = CONTRE_PREUVES ? 'apparence-ouverture-directe-check --contre-preuves' : 'apparence-ouverture-directe-check';
  if (failures) { console.error(`\n${nom}: ${failures} FAIL`); process.exit(1); }
  console.log(`\n${nom}: tout passe`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

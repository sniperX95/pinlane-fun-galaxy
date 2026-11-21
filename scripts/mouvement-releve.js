// LE RELEVE DU MOUVEMENT DE LA CONSOLE (2026-11-21).
//
// Le gerant, apres la mise en ligne du 20/11 a 23 h 05 : « j'ai l'impression qu'il y a plus de
// motion du tout, partout ». Ce releve ne croit personne : il joue chaque geste de la vague 2
// (assets/pinlane-mouvement.js) dans la console montee sur la fixture du samedi charge, a la
// vraie vitesse, et lit A CHAQUE IMAGE ce qui bouge vraiment :
//   - les animations qui tournent sur les elements regardes (getAnimations : celles du
//     mouvement, les transitions et les animations CSS), sans fin exclues ;
//   - les images ou l opacite, transform, translate ou scale d un MEME element changent par
//     rapport a l image d avant (un element remplace par un rendu ne compte pas : seul ce qui
//     glisse, grandit ou se fond compte).
// Un geste « bouge » quand au moins 3 images changent.
//
// LA CONSOLE D UN AUTRE COMMIT, SANS AUTRE COPIE DU DEPOT : --commit=9614616 sert les js, css
// et html tels qu ils etaient a ce commit (git show, en memoire) ; la fixture et son API
// simulee restent celles du depot. Plusieurs commits separes par des virgules : un serveur
// chacun, la meme serie de gestes, un tableau qui les compare.
//
// Usage : node scripts/mouvement-releve.js [--commit=9614616,c5526ce] [--appareils=ordinateur,telephone]
//         [--reduit=non,oui] [--gestes=fiche-ouvrir,reserver-ouvrir] [--sortie=fichier.json]
// (sans --commit : le depot tel qu il est sur le disque ; « disque » se nomme aussi dans la liste)
'use strict';

const PORT = Number(process.env.PINLANE_MOUVEMENT_RELEVE_PORT || 6520);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..');

// Le transformateur du serveur des fixtures qui rend chaque js, css ou html tel qu il etait au
// commit `ref` (un fichier absent du commit garde son texte du disque).
function transformateurCommit(ref) {
  if (!ref || ref === 'disque') return null;
  const memoire = new Map();
  return (rel, texte) => {
    if (!memoire.has(rel)) {
      let lu = null;
      try { lu = execFileSync('git', ['show', `${ref}:${rel}`], { cwd: RACINE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { lu = null; }
      memoire.set(rel, lu);
    }
    const ancien = memoire.get(rel);
    return ancien == null ? texte : ancien;
  };
}

// ---------------------------------------------------------------------------
// DANS LA PAGE : la sonde des images.
// ---------------------------------------------------------------------------
function poserSonde() {
  if (window.__rel) return;
  const R = window.__rel = { actif: false, sel: '', t0: 0, images: [], ids: new WeakMap(), n: 0, bornes: new Map() };
  let avant = null;
  // L ampleur de ce qui bouge, element par element : l opacite, l echelle et le deplacement (px)
  // lus dans transform, translate et scale.
  const nombres = (v) => (v && v !== 'none' ? v.split(/[\s,()a-z]+/i).filter(Boolean).map(Number) : []);
  const mesure = (cs) => {
    const m = /^matrix\(([^)]+)\)/.exec(cs.transform || '');
    const k = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
    const tr = nombres(cs.translate);
    const sc = nombres(cs.scale);
    return { o: Number(cs.opacity), s: Math.hypot(k[0], k[1]) * (sc.length ? sc[0] : 1), x: k[4] + (tr[0] || 0), y: k[5] + (tr[1] || 0) };
  };
  const lire = () => {
    const vus = new Map();
    for (const el of document.querySelectorAll(R.sel)) {
      if (vus.size >= 60) break;
      let id = R.ids.get(el);
      if (!id) { id = ++R.n; R.ids.set(el, id); }
      const cs = getComputedStyle(el);
      vus.set(id, `${cs.opacity}|${cs.transform}|${cs.translate}|${cs.scale}`);
      const v = mesure(cs);
      const b = R.bornes.get(id);
      if (!b) R.bornes.set(id, { o: [v.o, v.o], s: [v.s, v.s], x: [v.x, v.x], y: [v.y, v.y] });
      else ['o', 's', 'x', 'y'].forEach((c) => { b[c][0] = Math.min(b[c][0], v[c]); b[c][1] = Math.max(b[c][1], v[c]); });
    }
    return vus;
  };
  const boucle = (t) => {
    if (R.actif && R.sel) {
      const vus = lire();
      let change = false;
      if (avant) for (const [id, v] of vus) { if (avant.has(id) && avant.get(id) !== v) { change = true; break; } }
      const anims = document.getAnimations().filter((a) => {
        const x = a.effect && a.effect.target;
        return a.playState === 'running' && x && x.nodeType === 1 && a.effect.getComputedTiming().iterations !== Infinity && x.matches(R.sel);
      }).length;
      R.images.push({ t: Math.round(t - R.t0), change, anims, n: vus.size });
      avant = vus;
    } else avant = null;
    requestAnimationFrame(boucle);
  };
  requestAnimationFrame(boucle);
}

// ---------------------------------------------------------------------------
// LES GESTES
// ---------------------------------------------------------------------------
async function cliquer(page, sel) {
  const b = await page.locator(sel).filter({ visible: true }).first().boundingBox().catch(() => null);
  if (!b || b.width < 2 || b.height < 2) return false;
  await page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 20));
  return true;
}
// Un element bien a l ecran (ni sous la barre du haut, ni au ras du bas), marque pour le clic.
async function marquer(page, sel, marque) {
  return page.evaluate(({ sel, marque }) => {
    document.querySelectorAll(`[data-releve="${marque}"]`).forEach((x) => x.removeAttribute('data-releve'));
    const el = [...document.querySelectorAll(sel)].find((x) => { const r = x.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.top > 120 && r.bottom < innerHeight - 30; });
    if (el) el.setAttribute('data-releve', marque);
    return Boolean(el);
  }, { sel, marque });
}
async function aller(page, cle, vue) {
  await page.evaluate(({ cle, vue }) => {
    /* global state, renderStaff */
    if (typeof closePos === 'function' && !document.getElementById('posOverlay').classList.contains('hidden')) closePos();
    if (typeof closeQuickBook === 'function' && !document.getElementById('quickBookOverlay').classList.contains('hidden')) closeQuickBook();
    if (typeof smFenetreFermer === 'function') smFenetreFermer();
    state.staffMenuPage = cle;
    if (vue) state.staffResourceView = vue;
    renderStaff();
    window.scrollTo(0, 0);
  }, { cle, vue });
  await page.waitForTimeout(500);
}
const F_REPOS = async (page) => { const F = require('./planning-v3-fixtures'); await F.repos(page, 300); };

// Le client d une demande sur mesure et le bouton « Voir sa fiche client » : la fixture n a pas
// de demande, le releve en pose une (le dossier, l etude du client) et le bouton qui ouvre sa
// fenetre, a un endroit qu on touche.
async function poserClient(page) {
  return page.evaluate(() => {
    /* global staffCustomRequestsCache, staffRequestStudies, getActiveOpsCenterId */
    if (typeof openStaffRequestClient !== 'function') return false;
    staffCustomRequestsCache.key = String(getActiveOpsCenterId());
    staffCustomRequestsCache.items = [{ id: 'releve-1', contactName: 'Famille Lambert', email: 'lambert@exemple.be', phone: '0471 12 34 56', status: 'new' }];
    staffRequestStudies['releve-1'] = { loaded: true, client: { visits: 3, depense: 186, absences: 0, venues: [{ date: '2026-12-05', label: 'Bowling', pax: 6, prix: 62 }, { date: '2026-10-18', label: 'Laser game', pax: 8, prix: 124 }] } };
    let b = document.getElementById('releveClient');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.id = 'releveClient';
      b.textContent = 'Voir sa fiche client';
      b.setAttribute('onclick', "openStaffRequestClient('releve-1')");
      b.style.cssText = 'position:fixed;left:30%;top:70%;z-index:60;padding:10px 14px;';
      document.body.appendChild(b);
    }
    return true;
  });
}

const PLANNING = async (page) => { await aller(page, 'planning', 'all'); };
const GESTES = [
  { cle: 'planning-onglet', nom: 'planning : onglet Bowling (repère, planning qui monte)', preparer: PLANNING,
    sel: '.pl-repere, .pb-seg__b, #planningBox, #globalPlanningBox, #laserPlanningBox',
    geste: (page) => cliquer(page, '#staffTabBowling'), apres: async (page) => { await cliquer(page, '#staffTabAll'); } },
  { cle: 'planning-jour', nom: 'planning : jour suivant (glisse, la date roule)', preparer: null,
    sel: '#globalPlanningBox, #planningBox, #laserPlanningBox, #staffDateShort, #staffDateLabel',
    geste: (page) => cliquer(page, '#staffNextDateBtn'), apres: async (page) => { await cliquer(page, '#staffPrevDateBtn'); } },
  { cle: 'planning-filtre', nom: 'planning : un filtre (lignes en cascade)', preparer: null,
    sel: '.gf-t tr.gf-r',
    geste: (page) => cliquer(page, '#planningBande button.gf-c:not(.is-on):not(.gf-c--tout)'), apres: async (page) => { await cliquer(page, '#planningBande button.gf-c--tout'); } },
  { cle: 'planning-survol', nom: 'planning : survol des lignes (surbrillance qui glisse)', preparer: null, ordinateur: true,
    sel: '.pl-surbrillance',
    geste: async (page) => {
      const pts = await page.evaluate(() => [...document.querySelectorAll('.gf-t tr.gf-r:not(.gf-retenue)')].map((tr) => tr.getBoundingClientRect()).filter((r) => r.top > 160 && r.bottom < innerHeight - 40).slice(0, 4).map((r) => ({ x: r.left + Math.min(300, r.width / 2), y: r.top + r.height / 2 })));
      if (pts.length < 3) return false;
      for (const p of pts) { await page.mouse.move(p.x, p.y, { steps: 3 }); await page.waitForTimeout(90); }
      return true;
    }, apres: async (page) => { await page.mouse.move(2, 2); } },
  { cle: 'petit-menu', nom: 'planning : petit menu d une ligne (naît de son bouton)', preparer: null,
    sel: '.staff-action-popover',
    geste: async (page) => (await marquer(page, 'button.gf-gb--fleche, .gf-gb--statut', 'menu')) && cliquer(page, '[data-releve="menu"]'),
    apres: async (page) => { await page.keyboard.press('Escape'); } },
  { cle: 'arrive', nom: 'planning : Arrivé (onde sur la ligne)', preparer: null,
    sel: '.pl-onde',
    geste: async (page) => (await marquer(page, '.gf-t tr.gf-r [data-gf-arrive]', 'arrive')) && cliquer(page, '[data-releve="arrive"]') },
  { cle: 'fiche-ouvrir', nom: 'fiche : ouverture depuis une ligne', preparer: PLANNING,
    sel: '#posOverlay, #posOverlay .edit-modal, #posOverlay .pos-sheet, .pl-calque',
    geste: async (page) => (await marquer(page, '.gf-t tr.gf-r:not(.gf-retenue) .gf-nom__t', 'nom')) && cliquer(page, '[data-releve="nom"]') },
  { cle: 'fiche-fermer', nom: 'fiche : fermeture (Échap)', preparer: null,
    sel: '#posOverlay, #posOverlay .edit-modal, .pl-calque',
    geste: async (page) => { if (await page.locator('#posOverlay:not(.hidden) .edit-modal').count() === 0) return false; await page.keyboard.press('Escape'); return true; } },
  { cle: 'fiche-modifier', nom: 'fiche : onglet Modifier (contenu de côté, repère)', ms: 900,
    preparer: async (page) => { await page.waitForTimeout(400); if (await marquer(page, '.gf-t tr.gf-r:not(.gf-retenue) .gf-nom__t', 'nom')) await cliquer(page, '[data-releve="nom"]'); await page.waitForTimeout(500); await F_REPOS(page); },
    sel: '#posOverlay .edit-modal, #posOverlay .edit-modal-body > *, .pl-repere',
    geste: (page) => cliquer(page, '#posOverlay .dossier-tabs .tab:not(.active)') },
  { cle: 'fiche-depliant', nom: 'fiche : un dépliant de Modifier (descend)', preparer: async (page) => { await page.evaluate(() => { const d = document.querySelector('#posOverlay details.fm-pli'); if (d) d.scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(200); },
    sel: '#posOverlay details.fm-pli > :not(summary), #posOverlay .fm-pli-corps, #posOverlay .fm-pli-corps > *',
    geste: (page) => cliquer(page, '#posOverlay details.fm-pli:not([open]) > summary'),
    apres: async (page) => { await page.evaluate(() => { if (typeof closePos === 'function') closePos(); }); } },
  { cle: 'reserver-ouvrir', nom: 'Réserver : ouverture depuis son bouton', preparer: PLANNING,
    sel: '#quickBookOverlay, #quickBookOverlay .qb-modal, .pl-calque',
    geste: (page) => cliquer(page, '#planningReserver') },
  { cle: 'reserver-joueurs', nom: 'Réserver : un autre nombre de joueurs (repère)',
    // (le repère glisse d un nombre choisi au suivant : on en choisit un d abord)
    preparer: async (page) => { await cliquer(page, '#quickBookOverlay .rs-ns button.rs-n[data-pax="4"]'); await page.waitForTimeout(300); },
    sel: '.pl-repere, #quickBookOverlay .rs-n',
    geste: (page) => cliquer(page, '#quickBookOverlay .rs-ns button.rs-n[data-pax="8"]') },
  { cle: 'reserver-fermer', nom: 'Réserver : fermeture (Échap)', preparer: null,
    sel: '#quickBookOverlay, #quickBookOverlay .qb-modal, .pl-calque',
    geste: async (page) => { if (await page.locator('#quickBookOverlay:not(.hidden) .qb-modal').count() === 0) return false; await page.keyboard.press('Escape'); await page.waitForTimeout(60); if (await page.locator('#quickBookOverlay:not(.hidden)').count()) await page.keyboard.press('Escape'); return true; } },
  { cle: 'client-ouvrir', nom: 'fenêtre client : ouverture depuis « Voir sa fiche client »', preparer: async (page) => { await PLANNING(page); await poserClient(page); },
    sel: '.bdg-fen-fond, .bdg-fen, .pl-calque',
    geste: (page) => cliquer(page, '#releveClient') },
  { cle: 'client-fermer', nom: 'fenêtre client : fermeture (Échap)', preparer: null,
    sel: '.bdg-fen-fond, .bdg-fen, .pl-calque',
    geste: async (page) => { if (await page.locator('.bdg-fen').count() === 0) return false; await page.keyboard.press('Escape'); return true; },
    apres: async (page) => { await page.evaluate(() => { const b = document.getElementById('releveClient'); if (b) b.remove(); }); } },
  { cle: 'menu-page', nom: 'menu : ouvrir l accueil (la page monte, repère du menu)', preparer: PLANNING, ms: 900,
    sel: '#staffView .staff-wrap > *, #staffView .staff-wrap > * > *, .pl-repere',
    geste: (page) => cliquer(page, '[data-fgx-menu-key="dashboard"]') },
  { cle: 'accueil-tuile', nom: 'accueil : une autre tuile (barres qui glissent, repère)', preparer: async (page) => { await aller(page, 'dashboard'); await F_REPOS(page); },
    sel: '.plc-bar, .pl-repere, .plc-glisse',
    geste: (page) => cliquer(page, '.plt-tuile[data-plt-tuile]:not(.is-on)') },
  { cle: 'clients-segment', nom: 'clients : un autre onglet (trait, lignes en cascade)', preparer: async (page) => { await aller(page, 'clients'); await page.waitForTimeout(600); await F_REPOS(page); },
    sel: '.pl-repere, #staffClientsPage .crm-table tbody tr',
    geste: (page) => cliquer(page, '.crm-segbar .crm-seg:not(.is-active)') },
  { cle: 'toast', nom: 'toast : la mèche, puis la sortie', preparer: PLANNING, ms: 3200,
    sel: '#toast, #toast .pl-meche',
    geste: async (page) => { await page.evaluate(() => toast('Essai du relevé')); return true; } },
];

async function mesurer(page, g) {
  await page.evaluate(({ sel }) => { const R = window.__rel; R.images = []; R.bornes = new Map(); R.sel = sel; R.t0 = performance.now(); R.actif = true; }, { sel: g.sel });
  let fait = false;
  try { fait = await g.geste(page); } catch (e) { fait = false; }
  await page.waitForTimeout(g.ms || 700);
  const lu = await page.evaluate(() => {
    const R = window.__rel;
    R.actif = false;
    // (l ampleur la plus forte d un seul element : un calque qui vole compte son vol, une
    // cascade ses quelques pixels, un fondu son opacite)
    let o = 0, s = 0, d = 0;
    R.bornes.forEach((b) => { o = Math.max(o, b.o[1] - b.o[0]); s = Math.max(s, b.s[1] - b.s[0]); d = Math.max(d, Math.hypot(b.x[1] - b.x[0], b.y[1] - b.y[0])); });
    return { images: R.images.slice(), ampleur: { o: Math.round(o * 100) / 100, s: Math.round(s * 1000) / 1000, d: Math.round(d) } };
  });
  if (!fait) return { absent: true };
  const im = lu.images;
  const changes = im.filter((x) => x.change);
  return {
    images: im.length,
    bougent: changes.length,
    anims: im.reduce((m, x) => Math.max(m, x.anims), 0),
    de: changes.length ? changes[0].t : null,
    a: changes.length ? changes[changes.length - 1].t : null,
    ...lu.ampleur,
  };
}

async function releve(navigateur, { port, appareil, reduit, gestes }) {
  const F = require('./planning-v3-fixtures');
  const { ctx, page, erreurs } = await F.monter(navigateur, { fixture: 'pic', appareil, theme: 'light', heure: '15:10', port, mouvementReduit: reduit });
  const res = {};
  try {
    await page.evaluate(poserSonde);
    for (const g of GESTES) {
      if (gestes.length && !gestes.includes(g.cle)) continue;
      if (g.ordinateur && appareil !== 'ordinateur') { res[g.cle] = { absent: true }; continue; }
      try {
        if (g.preparer) await g.preparer(page);
        await F.repos(page, 250);
        res[g.cle] = await mesurer(page, g);
        if (g.apres) await g.apres(page);
        await F.repos(page, 250);
      } catch (e) { res[g.cle] = { erreur: e.message.slice(0, 100) }; }
    }
  } finally { await ctx.close(); }
  return { res, erreurs };
}

const opt = (args, nom, defaut) => { const a = args.find((x) => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : defaut; };

async function main() {
  const { chromium } = require('playwright-core');
  const F = require('./planning-v3-fixtures');
  const args = process.argv.slice(2);
  const commits = opt(args, 'commit', 'disque').split(',').filter(Boolean);
  const appareils = opt(args, 'appareils', 'ordinateur,telephone').split(',').filter(Boolean);
  const reduits = opt(args, 'reduit', 'non,oui').split(',').filter(Boolean).map((x) => x === 'oui');
  const gestes = opt(args, 'gestes', '').split(',').filter(Boolean);
  const sortie = opt(args, 'sortie', '');
  for (const k of ['DATABASE_URL', 'RESEND_API_KEY', 'TELEGRAM_JETON', 'ANTHROPIC_API_KEY', 'VERCEL']) delete process.env[k];
  const navigateur = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const colonnes = [];
  try {
    for (let i = 0; i < commits.length; i++) {
      const serveur = await F.servir({ port: PORT + i, transformer: transformateurCommit(commits[i]) });
      try {
        for (const appareil of appareils) {
          for (const reduit of reduits) {
            const t = Date.now();
            const { res, erreurs } = await releve(navigateur, { port: PORT + i, appareil, reduit, gestes });
            colonnes.push({ commit: commits[i], appareil, reduit, res, erreurs });
            console.error(`${commits[i]} ${appareil}${reduit ? ' mouvement réduit' : ''} : relevé en ${Math.round((Date.now() - t) / 1000)} s`);
          }
        }
      } finally { serveur.close(); }
    }
  } finally { await navigateur.close(); }
  const cell = (r) => {
    if (!r) return '-';
    if (r.erreur) return 'erreur';
    if (r.absent) return 'absent';
    const ampleur = [r.d ? `${r.d}px` : '', r.s ? `x${r.s}` : '', r.o ? `o${r.o}` : ''].filter(Boolean).join(' ');
    return `${r.bougent >= 3 ? 'BOUGE' : 'sec'} ${r.bougent}i ${r.anims}a ${r.de == null ? '' : `${r.de}-${r.a}ms `}${ampleur}`;
  };
  console.log('Chaque case : BOUGE (au moins 3 images changent) ou sec ; images qui changent (i) ; animations au plus fort (a) ;');
  console.log('premier et dernier changement depuis le geste (ms) ; ampleur la plus forte d un element : deplacement (px), echelle (x), opacite (o)');
  for (const g of GESTES) {
    if (gestes.length && !gestes.includes(g.cle)) continue;
    console.log(`\n${g.nom}`);
    for (const c of colonnes) console.log(`  ${`${c.commit.slice(0, 7)} ${c.appareil}${c.reduit ? ' réduit' : ''}`.padEnd(28)} ${cell(c.res[g.cle])}`);
  }
  for (const c of colonnes) if (c.erreurs.length) console.log(`\nerreurs JavaScript ${c.commit} ${c.appareil}${c.reduit ? ' réduit' : ''} : ${c.erreurs.slice(0, 3).join(' | ')}`);
  if (sortie) fs.writeFileSync(sortie, JSON.stringify(colonnes, null, 2));
}

module.exports = { transformateurCommit };
if (require.main === module) main().catch((e) => { console.error('ECHEC', e); process.exit(1); });

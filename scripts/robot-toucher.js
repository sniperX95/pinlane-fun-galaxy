'use strict';
// LE ROBOT DU TOUCHER. Ansar a touche une ligne qui ne repondait pas (« jpeux pas changer lheure [...] ya rien ») alors que tous
// les gates etaient verts : ils posaient l etat a la main. Celui-ci fait ce que fait un client : sur chaque ecran du formulaire,
// il touche pour de vrai tout ce qui a l air touchable, et il dit ce qui ne repond pas, ce qui est couvert, ce qui est trop petit.
// Banc local, vrai code, reglages publics de la prod, base en memoire. Rien ne part en ligne en ecriture.
// A lancer avant de mettre en ligne un changement du formulaire (20 a 40 min, deux centres, en tache de fond) :
//   npm run robot:toucher            (telephone 390 px)
//   ROBOT_W=1280 npm run robot:toucher ; ROBOT_ECRANS=avant-pose,heures-une npm run robot:toucher
// Code de sortie 1 s il reste une chose morte, couverte, ou une erreur de page.
const fs = require('fs');
const path = require('path');
const { chargerReglages, creerServeur } = require('./banc/banc-complet.js');
const { lancer, ouvrir, attendre, calme } = require('./banc/banc.js');
const PORT = Number(process.env.ROBOT_PORT || 4391);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.ROBOT_OUT || path.join(require('os').tmpdir(), 'pinlane-robot');
fs.mkdirSync(OUT, { recursive: true });
const CENTRES = (process.env.ROBOT_CENTRES || 'gembloux,libramont').split(',');
const LARGEUR = Number(process.env.ROBOT_W || 390);
const SEULS = process.env.ROBOT_ECRANS ? process.env.ROBOT_ECRANS.split(',') : null;
const DATE = '2026-11-21';
// Ce qui se lit et ne se touche pas, regarde ecran par ecran le 2026-11-05 : l enseigne du centre, un conseil, le texte a cote d un bouton.
const SE_LIT = /^(span\.fg-centre|p\.fg-conseil|div\.fg-rise\.fg-sm-door|div\.fg-bar\.fg-dock\.fg-rise|div\.fg-hold|div\.fg-plus|p\.fg-done__row|div\.fg-rise\.fg-tabs)/;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
class Stop extends Error {}

const fermerVitrine = async (page) => {
  await attendre(page, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 4000);
  if (await page.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); })) { await page.click('#vitrine .fg-vitrine__non'); await dormir(350); }
};
// Les ecrans, chacun avec le chemin d un client pour y arriver.
const jusquAuxActivites = async (b, centre, activities, ensuite) => {
  try { await ouvrir(b, { base: BASE, centre, date: DATE, pax: 8, activities, w: LARGEUR, avantHeures: async () => { throw new Stop(); } }); } catch (e) { if (!(e instanceof Stop)) throw e; }
  const page = b.__dernierePage;
  if (ensuite) await ensuite(page);
  return { ctx: page.context(), page };
};
const heures = async (b, centre, activities, ensuite) => {
  const r = await ouvrir(b, { base: BASE, centre, date: DATE, pax: 8, activities, w: LARGEUR });
  if (ensuite) await ensuite(r.page);
  return r;
};
const toucherPuce = async (page, cle, t) => {
  const c = `.fg-etape[data-cle="${cle}"] .fg-chip[data-time="${t}"]`;
  await page.waitForSelector(c, { state: 'attached', timeout: 10000 });
  await page.click(c, { timeout: 6000 });
  await calme(page);
};
const versContact = async (page) => {
  await page.click('#goContact');
  await attendre(page, () => { const v = document.querySelector('#vitrine'); return (v && !v.hidden) || (document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering')); }, 12000);
  await fermerVitrine(page);
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 12000);
};
const versRecap = async (page) => {
  await versContact(page);
  await page.fill('#cPrenom', 'Essai'); await page.fill('#cNom', 'Banc'); await page.fill('#cEmail', 'qa@example.com'); await page.fill('#cTel', '0470000000');
  await page.click('.fg-occasion[data-occasion="amis"]');
  await page.evaluate(() => { const c = document.querySelector('#cConsent'); if (!c.checked) c.click(); });
  await page.click('#goRecap');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering'), 12000);
  await dormir(400);
  await fermerVitrine(page);
};
const ECRANS = [
  { nom: 'date', aller: async (b, c) => jusquAuxDate(b, c) },
  { nom: 'calendrier', zone: '#dayPop', aller: async (b, c) => { const r = await jusquAuxDate(b, c); await r.page.click('#dayBtn'); await dormir(500); return r; } },
  { nom: 'activites', aller: (b, c) => jusquAuxActivites(b, c, []) },
  { nom: 'activites-choisies', aller: (b, c) => jusquAuxActivites(b, c, ['bowling', 'laser_game', 'arcade_time']) },
  { nom: 'formules', aller: (b, c) => jusquAuxActivites(b, c, [], async (p) => { await p.click('#tabFor'); await dormir(500); }) },
  { nom: 'heures-une', aller: (b, c) => heures(b, c, ['bowling']) },
  { nom: 'heures-plusieurs', aller: (b, c) => heures(b, c, ['bowling', 'laser_game', 'minigolf_blacklight', 'arcade_time']) },
  { nom: 'heures-choisies', aller: (b, c) => heures(b, c, ['bowling', 'laser_game'], async (p) => { await toucherPuce(p, 'bowling', '16:00'); }) },
  { nom: 'avant-choix', aller: (b, c) => heures(b, c, ['bowling'], async (p) => { await toucherPuce(p, 'bowling', '16:00'); await p.click('[data-avant-ouvrir]'); await dormir(300); }) },
  { nom: 'avant-pose', aller: (b, c) => heures(b, c, ['bowling'], async (p) => { await toucherPuce(p, 'bowling', '16:00'); await p.click('[data-avant-ouvrir]'); await dormir(300); await p.click('[data-avant-choix]'); await calme(p); }) },
  { nom: 'formule', aller: async (b, c) => { const r = await ouvrir(b, { base: BASE, centre: c, date: DATE, pax: 8, formule: 'f1', w: LARGEUR }); return r; } },
  { nom: 'contact', aller: (b, c) => heures(b, c, ['bowling'], async (p) => { await versContact(p); }) },
  { nom: 'recap', aller: (b, c) => heures(b, c, ['bowling'], async (p) => { await versRecap(p); }) },
  { nom: 'fin', aller: (b, c) => heures(b, c, ['bowling'], async (p) => { await versRecap(p); await p.click('#confirmBtn'); await attendre(p, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 15000); await dormir(600); }) },
];
async function jusquAuxDate(b, centre) {
  const ctx = await b.newContext({ viewport: { width: LARGEUR, height: 844 }, hasTouch: LARGEUR < 700, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(9000);
  page.__erreurs = [];
  page.on('pageerror', (e) => page.__erreurs.push(String(e.message || e)));
  await page.goto(`${BASE}/fungalaxy/${centre}`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.body.classList.contains('is-ready') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  return { ctx, page };
}

// Tout ce qui a l air touchable, vu d un client : les vrais boutons, ce qui montre une main, et les « lignes » qui ressemblent a
// une rangee qu on toucherait (fond ou cadre, assez grandes, sans rien de touchable dedans).
function lister() {
  const INTERACTIF = 'button,a,input,select,textarea,summary,label,[role="button"],[role="tab"],[role="radio"],[role="checkbox"],[role="switch"]';
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || Number(cs.opacity) < 0.05) return false;
    for (let p = el; p && p !== document.body; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0) return false; }
    const r = el.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8;
  };
  const chemin = (el) => { const out = []; for (let n = el; n && n !== document.documentElement; n = n.parentElement) { const i = [...n.parentElement.children].indexOf(n) + 1; out.unshift(`${n.tagName.toLowerCase()}:nth-child(${i})`); } return `html > ${out.join(' > ')}`; };
  const signature = (el) => `${el.tagName.toLowerCase()}${[...el.classList].filter((c) => !/^(is-|has-)/.test(c)).sort().map((c) => `.${c}`).join('')}${[...el.attributes].filter((a) => /^data-/.test(a.name) && !/^data-(time|src|date|activity|formule|occasion|id)$/.test(a.name)).map((a) => `[${a.name}]`).join('')}`;
  const cibles = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('.fg-art, script, style, svg, noscript') && !el.matches('svg')) continue;
    if (el.matches('svg, path, use') || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const parentMain = el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer';
    const estInteractif = el.matches(INTERACTIF);
    const main = cs.cursor === 'pointer' && !parentMain;
    const r = el.getBoundingClientRect();
    const fond = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    const cadre = cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none';
    const ligne = !estInteractif && !main && (fond || cadre) && r.height >= 44 && r.height <= 140 && r.width >= 120 && el.textContent.trim().length > 0 && !el.closest(INTERACTIF) && getComputedStyle(el).cursor !== 'pointer';
    if (!estInteractif && !main && !ligne) continue;
    if (estInteractif && el.closest(INTERACTIF) !== el && el.parentElement.closest(INTERACTIF)) continue;
    cibles.push({
      chemin: chemin(el), signature: signature(el), texte: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 44) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '',
      genre: estInteractif ? 'bouton' : main ? 'main' : 'ligne', l: Math.round(r.width), h: Math.round(r.height), lien: el.closest('a[href]') ? el.closest('a[href]').getAttribute('href') : '', ferme: el.disabled === true || el.getAttribute('aria-disabled') === 'true' || (el.control && el.control.disabled === true),
    });
  }
  return cibles;
}
// D abord une seconde sans toucher a rien : ce qui change tout seul (un compte a rebours) est mis de cote.
const poserGuet = async (page) => {
  await page.evaluate(() => {
    if (window.__guet) { window.__guet.disconnect(); }
    window.__m = 0;
    window.__calibre = true;
    window.__bruit = new WeakSet();
    const bruit = (n) => { for (let p = n; p; p = p.parentElement) if (window.__bruit.has(p)) return true; return false; };
    window.__guet = new MutationObserver((l) => { for (const r of l) { const n = r.target.nodeType === 1 ? r.target : r.target.parentElement; if (!n || (n.closest && n.closest('.fg-art, #fgLive'))) continue; if (window.__calibre) { window.__bruit.add(n); continue; } if (!bruit(n)) window.__m += 1; } });
    window.__guet.observe(document.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
    if (!window.__ecoute) { window.__ecoute = true; for (const t of ['change', 'input']) document.addEventListener(t, () => { window.__m += 1; }, true); }
  });
  await dormir(1200);
  await page.evaluate(() => { window.__calibre = false; window.__m = 0; });
};
const toucher = async (page, cible) => {
  const avant = await page.evaluate((c) => {
    const el = document.querySelector(c.chemin);
    if (!el) return { absent: true };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    return { absent: false };
  }, cible);
  if (avant.absent) return { etat: 'introuvable' };
  await dormir(220);
  const ici = await page.evaluate((c) => {
    const el = document.querySelector(c.chemin);
    const r = el.getBoundingClientRect();
    const INTERACTIF = 'button,a,input,select,textarea,summary,label,[role="button"],[role="tab"],[role="radio"],[role="checkbox"],[role="switch"]';
    let x = r.left + r.width / 2; const y = r.top + r.height / 2;
    if (c.genre === 'ligne') {
      const nu = [0.5, 0.3, 0.7, 0.15, 0.85].map((f) => r.left + r.width * f).find((px) => { const d = document.elementFromPoint(px, y); return d && (d === el || el.contains(d)) && !d.closest(INTERACTIF); });
      if (nu === undefined) return { sansPartieNue: true };
      x = nu;
    }
    const dessus = document.elementFromPoint(x, y);
    const couvert = !dessus || !(dessus === el || el.contains(dessus) || dessus.contains(el));
    window.__m = 0;
    return { x, y, couvert, dessus: dessus ? `${dessus.tagName.toLowerCase()}.${[...dessus.classList].join('.')}` : '', actif: document.activeElement ? document.activeElement.tagName + (document.activeElement.id || '') : '', hauteur: document.documentElement.scrollHeight, sy: scrollY };
  }, cible);
  if (ici.sansPartieNue) return { etat: 'couvert-par-ses-boutons' };
  if (ici.y < 0 || ici.y > 844 || ici.x < 0 || ici.x > LARGEUR) return { etat: 'hors-ecran' };
  if (LARGEUR < 700) await page.touchscreen.tap(ici.x, ici.y); else { await page.mouse.move(ici.x, ici.y); await dormir(120); await page.evaluate(() => { window.__m = 0; }); await page.mouse.click(ici.x, ici.y); }
  await dormir(450);
  const apres = await page.evaluate(() => { const a = document.activeElement; const champ = a && (/^(TEXTAREA|SELECT)$/.test(a.tagName) || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit)$/.test(a.type))); return { m: window.__m, champ: Boolean(champ), actif: a ? a.tagName + (a.id || '') : '', sy: scrollY, url: location.pathname }; });
  const vivant = apres.m > 0 || (apres.champ && apres.actif !== ici.actif) || Math.abs(apres.sy - ici.sy) > 2;
  return { etat: vivant ? 'vivant' : 'mort', couvert: ici.couvert, dessus: ici.dessus, m: apres.m };
};

(async () => {
  await chargerReglages();
  const serveur = creerServeur();
  await new Promise((r) => serveur.listen(PORT, r));
  const bilan = [];
  const ecrire = () => fs.writeFileSync(path.join(OUT, `resultat-${LARGEUR}.json`), JSON.stringify(bilan, null, 1));
  const jouer = async (centre) => {
    const browser = await lancer();
    for (const e of ECRANS) {
      if (SEULS && !SEULS.includes(e.nom)) continue;
      const debut = Date.now();
      let cibles = [];
      let courant = null;
      const ligne = { centre, ecran: e.nom, total: 0, morts: [], couverts: [], petits: [], introuvables: 0, horsEcran: 0, erreurs: [], liens: [] };
      try {
        courant = await e.aller(browser, centre);
        await dormir(500);
        await courant.page.screenshot({ path: path.join(OUT, `${centre}-${e.nom}-${LARGEUR}.png`), fullPage: true });
        const toutes = await courant.page.evaluate(lister);
        // Calendrier ouvert : ce qui est dessous est couvert, c est normal.
        const brutes = e.zone ? await courant.page.evaluate(([l, z]) => l.filter((c) => { const n = document.querySelector(c.chemin); return n && n.closest(z); }), [toutes, e.zone]) : toutes;
        const vus = {};
        cibles = brutes.filter((c) => { vus[c.signature] = (vus[c.signature] || 0) + 1; return vus[c.signature] <= 2; });
        ligne.total = cibles.length;
        ligne.vu = brutes.length;
        for (const c of brutes) if (c.genre !== 'ligne' && (c.h < 36 || c.l < 36) && !ligne.petits.some((p) => p.s === c.signature)) ligne.petits.push({ s: c.signature, t: c.texte, l: c.l, h: c.h });
        await poserGuet(courant.page);
        for (const c of cibles) {
          if (c.lien && /^(https?:|mailto:|tel:)/.test(c.lien)) { ligne.liens.push(`${c.texte} -> ${c.lien}`.slice(0, 90)); continue; }
          let r;
          try { r = await toucher(courant.page, c); } catch (err) { r = { etat: 'erreur', message: String(err.message).slice(0, 120) }; }
          if (r.couvert && r.etat !== 'vivant') ligne.couverts.push({ s: c.signature, t: c.texte, dessus: r.dessus });
          if (r.etat === 'mort' && !(c.genre === 'ligne' && SE_LIT.test(c.signature))) ligne.morts.push({ g: c.genre, s: c.signature, t: c.texte, l: c.l, h: c.h, ferme: c.ferme });
          if (r.etat === 'introuvable') ligne.introuvables += 1;
          if (r.etat === 'hors-ecran') ligne.horsEcran += 1;
          if (r.etat === 'erreur') ligne.erreurs.push(`${c.signature} : ${r.message}`);
          if (courant.page.__erreurs && courant.page.__erreurs.length) { ligne.erreurs.push(...courant.page.__erreurs.splice(0)); }
          if (r.etat === 'vivant' || r.etat === 'erreur') {
            await courant.ctx.close().catch(() => {});
            courant = await e.aller(browser, centre);
            await dormir(350);
            await poserGuet(courant.page);
          }
        }
      } catch (err) {
        ligne.erreurs.push(`ECRAN : ${String(err.message).split('\n')[0].slice(0, 200)}`);
      }
      if (courant) await courant.ctx.close().catch(() => {});
      ligne.secondes = Math.round((Date.now() - debut) / 1000);
      bilan.push(ligne);
      ecrire();
      console.log(`${centre} ${e.nom} : ${ligne.total} cibles (${ligne.vu || 0} vues), ${ligne.morts.length} morts, ${ligne.couverts.length} couverts, ${ligne.introuvables} introuvables, ${ligne.horsEcran} hors ecran, ${ligne.erreurs.length} erreurs, ${ligne.secondes} s`);
    }
    await browser.close();
  };
  await Promise.all(CENTRES.map(jouer));
  serveur.close();
  // Le resume : une ligne par chose morte, sans doublon.
  const resume = {};
  for (const l of bilan) for (const m of l.morts) { const k = `${m.g} ${m.s}`; (resume[k] = resume[k] || { t: m.t, ecrans: new Set(), ferme: m.ferme, taille: `${m.l}x${m.h}` }).ecrans.add(`${l.centre[0]}:${l.ecran}`); }
  console.log('--- MORTS');
  for (const [k, v] of Object.entries(resume)) console.log(`${k}${v.ferme ? ' [ferme]' : ''} ${v.taille} « ${v.t} » ${[...v.ecrans].join(',')}`);
  console.log('--- COUVERTS');
  for (const l of bilan) for (const c of l.couverts) console.log(`${l.centre[0]}:${l.ecran} ${c.s} « ${c.t} » sous ${c.dessus}`);
  console.log('--- PETITS');
  const petits = new Set(); for (const l of bilan) for (const p of l.petits) petits.add(`${p.s} ${p.l}x${p.h} « ${p.t} »`);
  for (const p of petits) console.log(p);
  console.log('--- ERREURS');
  for (const l of bilan) for (const x of l.erreurs) console.log(`${l.centre[0]}:${l.ecran} ${x}`);
  console.log('--- LIENS');
  const liens = new Set(); for (const l of bilan) for (const x of l.liens) liens.add(x);
  for (const x of liens) console.log(x);
  const rouge = bilan.some((l) => l.morts.some((m) => !m.ferme) || l.couverts.length || l.erreurs.length);
  console.log(rouge ? 'robot-toucher : A REGARDER' : 'robot-toucher : tout repond');
  process.exit(rouge ? 1 : 0);
})().catch((e) => { console.error('ERREUR', e.stack || e.message); process.exit(1); });

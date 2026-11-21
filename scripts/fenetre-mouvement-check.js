// LA FENETRE SORT DE CE QU'ON A TOUCHE (gate ne le 2026-11-21).
//
// Le gerant, le 20/11 au soir, apres la mise en ligne de 23 h 05 : « j'ai l'impression qu'il
// y a plus de motion du tout, partout ». Mesure (scripts/mouvement-releve.js) : tout le reste
// de la vague 2 bougeait encore, mais les fenetres, le geste de toute la journee, ne bougeaient
// plus : la fiche passait de 0,98 a 1 (2 % de 1100 px), Reserver aussi, et leur fermeture
// n etait plus qu un fondu. Avant (9614616), une forme vide volait de la ligne a la fenetre :
// visible, mais elle saccadait et la fiche se lisait tard (« pas fluide », « trop lente »).
//
// La regle gardee ici, pour chaque fenetre ouverte depuis la console (la fiche depuis une ligne
// du planning, Reserver depuis son bouton, Modifier depuis son onglet, la fenetre client depuis
// « Voir sa fiche client »), par un VRAI toucher :
//   - une animation tourne sur la vraie fenetre pendant l ouverture (jamais un calque a sa
//     place, aucune forme ne vole) ;
//   - son transform change sur au moins 3 images ;
//   - elle part d une echelle d au plus 0,95 (grand ecran), ou monte d au moins 24 px du bas
//     sans changer de taille (telephone) ;
//   - elle grandit depuis le point touche (transform-origin dans ce qui a ete touche) ;
//   - l ouverture dure de 200 a 300 ms ;
//   - seuls transform et opacity s animent, sa boite de mise en page ne bouge jamais ;
//   - a 80 ms elle est entierement opaque, son voile compris (le dedoublement refuse le 21/11) ;
//   - a la fermeture, le fond se ferme tout de suite (l etat n attend rien), la forme vide de
//     la fenetre repart vers son origine en 150 a 180 ms, muette et sans rien a toucher, le
//     voile s eteint ; rien ne reste une demi-seconde plus tard ;
//   - rouverte a moins de 300 ms, elle n anime rien ; mouvement reduit : rien ne bouge.
// Les durees se lisent dans l effet (getComputedTiming), la visibilite sur l animation mise en
// pause a 80 ms : ni l un ni l autre ne depend de la vitesse de la machine.
//
// --contre-preuves : chaque morceau est casse a son tour dans le module servi (le disque n est
// jamais touche) ; le controle qui le garde doit rougir.
'use strict';
const PORT = Number(process.env.PINLANE_FENETRE_MOUVEMENT_PORT || 6540);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const F = require('./planning-v3-fixtures');
const { chromium } = require('playwright-core');

const CONTRE = process.argv.includes('--contre-preuves');

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 600) : ''}`);
  if (!cond) echecs += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// DANS LA PAGE : ce que la fenetre fait a chaque image.
// ---------------------------------------------------------------------------
function poserSonde() {
  if (window.__fm) return;
  const S = window.__fm = { actif: false, sel: '', t0: 0, images: [], ids: new WeakMap(), n: 0 };
  const PROPRES = ['offset', 'computedOffset', 'easing', 'composite'];
  const boucle = (t) => {
    if (S.actif && S.sel) {
      const el = document.querySelector(S.sel);
      // (une forme vide posee a la place de la fenetre, a cette image : celle qui volait le 19/11)
      S.vols = Math.max(S.vols || 0, [...document.querySelectorAll('.pl-calque.pl-vol')].filter((x) => Number(getComputedStyle(x).opacity) > 0.01).length);
      if (el) {
        let id = S.ids.get(el);
        if (!id) { id = ++S.n; S.ids.set(el, id); }
        const cs = getComputedStyle(el);
        let vue = 1;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) vue *= Number(getComputedStyle(n).opacity);
        const r = el.getBoundingClientRect();
        const anims = el.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => {
          const k = a.effect.getKeyframes();
          return {
            id: a.id || '', css: Boolean(a.animationName || a.transitionProperty),
            duree: a.effect.getComputedTiming().duration, easing: a.effect.getComputedTiming().easing,
            proprietes: [...new Set(k.flatMap((x) => Object.keys(x)))].filter((p) => !PROPRES.includes(p)),
            depart: (k[0] && k[0].transform) || '', opaciteDepart: k[0] && k[0].opacity !== undefined ? Number(k[0].opacity) : null,
          };
        });
        const muette = el.getAttribute('aria-hidden') === 'true' && !el.id && el.childElementCount === 0 && !el.textContent && cs.pointerEvents === 'none';
        S.images.push({ t: Math.round(t - S.t0), id, transform: cs.transform, origine: cs.transformOrigin, vue, muette, boite: [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight].join(','), rect: { l: r.left, t: r.top, w: r.width, h: r.height }, anims });
      } else S.images.push({ t: Math.round(t - S.t0), absente: true });
    }
    requestAnimationFrame(boucle);
  };
  requestAnimationFrame(boucle);
}

// L echelle et le deplacement d un transform : « matrix(a, b, c, d, e, f) » tel que le navigateur
// le calcule, ou les etapes ecrites (« translate(4px, -8px) scale(0.9) », « translateY(59px) »).
function lireTransform(texte) {
  const t = { s: 1, x: 0, y: 0 };
  if (!texte || texte === 'none') return t;
  const nombres = (x) => x.split(',').map((n) => parseFloat(n));
  const m = /^matrix\(([^)]+)\)/.exec(texte);
  if (m) { const k = nombres(m[1]); return { s: Math.hypot(k[0], k[1]), x: k[4], y: k[5] }; }
  for (const f of texte.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)) {
    const k = nombres(f[2]);
    if (f[1] === 'translate') { t.x += k[0] || 0; t.y += k.length > 1 ? k[1] : 0; }
    else if (f[1] === 'translateX') t.x += k[0];
    else if (f[1] === 'translateY') t.y += k[0];
    else if (f[1] === 'scale') t.s *= k[0];
  }
  return t;
}

// ---------------------------------------------------------------------------
// LES FENETRES ET LEURS GESTES
// ---------------------------------------------------------------------------
async function boiteDe(page, sel) {
  return page.locator(sel).filter({ visible: true }).first().boundingBox().catch(() => null);
}
// Le vrai toucher (un clic de confiance, isTrusted), au centre de ce qu on touche. (Au telephone
// aussi : le clic part dans la meme tache que l appui, la fenetre est lue juste apres.)
async function toucher(page, b) {
  const x = b.x + b.width / 2;
  const y = b.y + Math.min(b.height / 2, 20);
  await page.mouse.click(x, y);
  return { x, y };
}
// Une ligne du planning complet bien a l ecran, son nom marque pour le toucher.
async function marquerLigne(page) {
  return page.evaluate(() => {
    document.querySelectorAll('[data-gate-fm]').forEach((x) => x.removeAttribute('data-gate-fm'));
    const n = [...document.querySelectorAll('.gf-t tr.gf-r:not(.gf-retenue) .gf-nom__t')].find((x) => { const r = x.getBoundingClientRect(); return r.width > 10 && r.top > 140 && r.bottom < innerHeight - 60; });
    if (n) n.setAttribute('data-gate-fm', 'ligne');
    return Boolean(n);
  });
}
async function auPlanning(page) {
  await page.evaluate(() => {
    if (typeof closePos === 'function' && !document.getElementById('posOverlay').classList.contains('hidden')) closePos();
    if (typeof closeQuickBook === 'function' && !document.getElementById('quickBookOverlay').classList.contains('hidden')) closeQuickBook();
    if (typeof smFenetreFermer === 'function') smFenetreFermer();
    state.staffMenuPage = 'planning';
    state.staffResourceView = 'all';
    renderStaff();
    window.scrollTo(0, 0);
  });
  await F.repos(page, 400);
}
// La fixture n a pas de demande sur mesure : le gate pose un dossier, ce que la console sait
// de son client (l etude) et le bouton « Voir sa fiche client » qui ouvre la fenetre client.
async function poserClient(page) {
  return page.evaluate(() => {
    /* global staffCustomRequestsCache, staffRequestStudies, getActiveOpsCenterId */
    staffCustomRequestsCache.key = String(getActiveOpsCenterId());
    staffCustomRequestsCache.items = [{ id: 'gate-fm', contactName: 'Famille Lambert', email: 'lambert@exemple.be', phone: '0471 12 34 56', status: 'new' }];
    staffRequestStudies['gate-fm'] = { loaded: true, client: { visits: 3, depense: 186, absences: 0, venues: [{ date: '2026-12-05', label: 'Bowling', pax: 6, prix: 62 }] } };
    if (!document.getElementById('gateClient')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'gateClient';
      b.textContent = 'Voir sa fiche client';
      b.setAttribute('onclick', "openStaffRequestClient('gate-fm')");
      b.style.cssText = 'position:fixed;left:24%;top:72%;z-index:60;padding:10px 14px;';
      document.body.appendChild(b);
    }
    return typeof openStaffRequestClient === 'function';
  });
}

const FENETRES = {
  fiche: {
    nom: 'la fiche',
    surface: '#posOverlay:not(.hidden) .edit-modal',
    fond: '#posOverlay',
    async preparer(page) { await auPlanning(page); return marquerLigne(page); },
    cible: '[data-gate-fm="ligne"]',
  },
  reserver: {
    nom: 'Réserver',
    surface: '#quickBookOverlay:not(.hidden) .qb-modal',
    fond: '#quickBookOverlay',
    async preparer(page) { await auPlanning(page); return true; },
    cible: '#planningReserver',
  },
  modifier: {
    nom: 'Modifier',
    surface: '#posOverlay:not(.hidden) .edit-modal',
    fond: '#posOverlay',
    modifier: true,
    // (la fiche s ouvre d abord depuis sa ligne, au vrai toucher, et se pose)
    async preparer(page) {
      await auPlanning(page);
      if (!(await marquerLigne(page))) return false;
      const b = await boiteDe(page, '[data-gate-fm="ligne"]');
      if (!b) return false;
      await toucher(page, b);
      await page.waitForTimeout(500);
      await F.repos(page, 200);
      return (await page.locator('#posOverlay:not(.hidden) .dossier-tabs .tab:not(.active)').count()) === 1;
    },
    cible: '#posOverlay:not(.hidden) .dossier-tabs .tab:not(.active)',
  },
  client: {
    nom: 'la fenêtre client',
    surface: '.bdg-fen-fond .bdg-fen',
    fond: '.bdg-fen-fond',
    async preparer(page) { await auPlanning(page); return poserClient(page); },
    cible: '#gateClient',
  },
};

async function echantillonner(page, sel, geste, ms) {
  await page.evaluate((sel) => { const S = window.__fm; S.images = []; S.vols = 0; S.sel = sel; S.t0 = performance.now(); S.actif = true; }, sel);
  const r = await geste();
  await page.waitForTimeout(ms);
  const lu = await page.evaluate(() => { const S = window.__fm; S.actif = false; return { images: S.images.slice(), vols: S.vols }; });
  return { r, images: lu.images, vols: lu.vols };
}

// La fenetre a `ms` de sa ligne de temps : elle et son fond mis en pause, lus, puis finis.
function lireA({ surface, fond, ms }) {
  const el = document.querySelector(surface);
  const f = document.querySelector(fond);
  if (!el) return null;
  const toutes = [...el.getAnimations(), ...(f && f !== el ? f.getAnimations() : [])].filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity);
  toutes.forEach((a) => { a.pause(); a.currentTime = ms; });
  let vue = 1;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) vue *= Number(getComputedStyle(n).opacity);
  const propre = Number(getComputedStyle(el).opacity);
  toutes.forEach((a) => { try { a.finish(); } catch (e) { /* rien */ } });
  return { propre, vue, animations: toutes.length };
}

// Echap jusqu a la fermeture (Reserver ferme d abord ce qu il a ouvert dedans) ; rend combien de
// fenetres restent juste apres la touche qui l a fermee, dans la meme tache.
async function fermer(page, sel) {
  let reste = -1;
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    reste = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
    if (reste === 0) break;
    await page.waitForTimeout(80);
  }
  return reste;
}

// Une fenetre ouverte au vrai toucher, son ouverture lue image par image, puis sa fermeture.
async function jouerFenetre(page, appareil, cle, v, { reduit = false, seulement = null } = {}) {
  const fen = FENETRES[cle];
  const nom = `${appareil}, ${fen.nom}`;
  const veut = (k) => !seulement || seulement.includes(k);
  if (!v(`${nom} : ce qu on touche est à l écran`, await fen.preparer(page))) return;
  await F.repos(page, 150);
  const touchee = await boiteDe(page, fen.cible);
  if (!v(`${nom} : la cible du toucher a une boîte`, Boolean(touchee))) return;
  const { r: point, images, vols } = await echantillonner(page, fen.surface, () => toucher(page, touchee), 700);
  const vues = images.filter((x) => !x.absente);
  if (!v(`${nom} : la fenêtre s ouvre`, vues.length > 0, images.slice(0, 3))) return;
  const animees = vues.filter((x) => x.anims.length > 0);
  const a = animees.length ? animees[0].anims[0] : null;

  if (reduit) {
    v(`${nom}, mouvement réduit : rien ne bouge à l ouverture`, animees.length === 0, animees.slice(0, 2));
  } else {
    // Le transform d un meme element, d une image a l autre.
    let changes = 0;
    for (let i = 1; i < vues.length; i++) if (vues[i].id === vues[i - 1].id && vues[i].transform !== vues[i - 1].transform) changes += 1;
    const repos = vues[vues.length - 1];
    const depart = a ? lireTransform(a.depart) : null;
    // (la boite de mise en page, lue sur les images ou l entree joue)
    const boites = [...new Set(animees.filter((x) => x.id === animees[0].id).map((x) => x.boite))];
    if (veut('anime')) v(`${nom} : une animation tourne sur la vraie fenêtre pendant l ouverture`, Boolean(a) && !a.css, vues.slice(0, 2));
    if (veut('images')) v(`${nom} : son transform change sur au moins 3 images (${changes})`, changes >= 3, vues.map((x) => x.transform).slice(0, 6));
    if (veut('proprietes')) v(`${nom} : seuls transform et opacity s animent, sa boîte de mise en page ne bouge pas`, Boolean(a) && animees.every((x) => x.anims.every((y) => y.proprietes.every((p) => p === 'transform' || p === 'opacity'))) && boites.length === 1, { proprietes: a && a.proprietes, boites });
    if (veut('duree')) v(`${nom} : l ouverture dure de 200 à 300 ms (${a ? a.duree : '?'} ms)`, Boolean(a) && a.duree >= 200 && a.duree <= 300, a);
    if (veut('courbe')) v(`${nom} : elle part vite et se pose (cubic-bezier(0.23, 1, 0.32, 1))`, Boolean(a) && /cubic-bezier\(0\.23, 1, 0\.32, 1\)/.test(a.easing), a && a.easing);
    if (appareil === 'telephone') {
      if (veut('echelle')) v(`${nom} : au téléphone, elle monte du bas d au moins 24 px, sans changer de taille`, Boolean(depart) && depart.y >= 24 && Math.abs(depart.s - 1) < 0.001, { depart: a && a.depart });
    } else {
      const vuMin = Math.min(...vues.map((x) => lireTransform(x.transform).s));
      if (veut('echelle')) v(`${nom} : elle part d une échelle d au plus 0,95 (${depart ? depart.s.toFixed(3) : '?'}, vue à l écran jusqu à ${vuMin.toFixed(3)})`, Boolean(depart) && depart.s <= 0.95 && vuMin < 0.99, { depart: a && a.depart });
      // L origine, dans l ecran : la boite au repos plus le transform-origin lu pendant l entree.
      const pendant = animees.find((x) => /px/.test(x.origine));
      const o = pendant ? pendant.origine.split(' ').map(parseFloat) : null;
      const ox = o ? repos.rect.l + o[0] : NaN;
      const oy = o ? repos.rect.t + o[1] : NaN;
      const dans = o && ox >= touchee.x - 8 && ox <= touchee.x + touchee.width + 8 && oy >= touchee.y - 8 && oy <= touchee.y + touchee.height + 8;
      if (veut('origine')) v(`${nom} : elle grandit depuis ce qu on a touché (origine ${o ? `${Math.round(ox)}, ${Math.round(oy)}` : 'aucune'} ; toucher ${Math.round(point.x)}, ${Math.round(point.y)})`, Boolean(dans), { origine: pendant && pendant.origine, touchee, repos: repos.rect });
    }
    if (veut('calque')) v(`${nom} : aucune forme ne vole à sa place, à aucune image de l ouverture`, vols === 0, { vols });
  }
  await F.repos(page, 200);

  // LA FERMETURE : le fond se ferme dans la tache meme, la fenetre part a part.
  const f = await echantillonner(page, '.pl-sortie', () => fermer(page, fen.surface), 450);
  const parties = f.images.filter((x) => !x.absente);
  const anim = parties.flatMap((x) => x.anims)[0] || null;
  v(`${nom} : Échap la ferme tout de suite, l état n attend aucun mouvement`, f.r === 0, { apres: f.r });
  if (reduit) {
    v(`${nom}, mouvement réduit : rien ne part à la fermeture`, parties.length === 0);
  } else if (veut('fermeture')) {
    // (la vraie fenetre est deja partie : sa forme vide repart vers son origine, voir fermerFenetre)
    v(`${nom} : sa forme part en 150 à 180 ms, sur transform et opacity (${anim ? anim.duree : '?'} ms)`, Boolean(anim) && anim.duree >= 150 && anim.duree <= 180 && anim.proprietes.every((p) => p === 'transform' || p === 'opacity'), { anim, images: parties.length });
    v(`${nom} : la forme qui part est vide, muette, et ne se touche pas`, parties.length > 0 && parties.every((x) => x.muette));
    // Elle repart vers la ou la fenetre etait nee : son echelle descend au grand ecran, elle redescend au telephone.
    const fin = parties.length ? lireTransform(parties[parties.length - 1].transform) : null;
    v(`${nom} : elle repart vers son origine (${fin ? (appareil === 'telephone' ? `${Math.round(fin.y)} px plus bas` : `échelle ${fin.s.toFixed(3)}`) : '?'})`, Boolean(fin) && (appareil === 'telephone' ? fin.y >= 8 : fin.s < 0.99), parties.slice(-2).map((x) => x.transform));
  }
  await page.waitForTimeout(150);
  v(`${nom} : une demi-seconde après, rien ne reste (ni la fenêtre partie, ni le voile)`, await page.evaluate(() => !document.querySelector('.pl-sortie, .pl-calque.pl-voile')));
  if (reduit) return;

  // OPAQUE A 80 MS (21/11, le gérant refuse le dédoublement) : rouverte (après 300 ms), mise en
  // pause à 80 ms de son entrée. Son opacité ET celle de chaque parent (son voile) valent 1 :
  // une fenêtre pleine dans un voile à 0,65 laisse voir le planning à travers elle.
  if (!veut('lisible')) return;
  await page.waitForTimeout(250);
  if (!(await fen.preparer(page))) return;
  await F.repos(page, 150);
  const b = await boiteDe(page, fen.cible);
  if (!b) return;
  await toucher(page, b);
  const lu = await page.evaluate(lireA, { surface: fen.surface, fond: fen.fond, ms: 80 });
  v(`${nom} : à 80 ms elle est entièrement opaque, voile compris (vue à ${lu ? Math.round(lu.vue * 1000) / 10 : '?'} %)`, Boolean(lu) && lu.animations > 0 && lu.propre >= 0.999 && lu.vue >= 0.999, lu);
  await F.repos(page, 200);
  // Rouverte a moins de 300 ms : rien ne rejoue (un double toucher ne fait pas clignoter).
  if (!fen.modifier) {
    await fermer(page, fen.surface);
    await page.waitForTimeout(60);
    const b2 = await boiteDe(page, fen.cible);
    if (b2) {
      await toucher(page, b2);
      const re = await page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.getAnimations().filter((x) => x.playState === 'running').length : -1; }, fen.surface);
      v(`${nom} : rouverte à moins de 300 ms, elle n anime rien`, re === 0, { re });
      await F.repos(page, 200);
    }
  }
  await fermer(page, fen.surface);
  await F.repos(page, 300);
}

async function scenario(navigateur, port, appareil, fenetres, v, options = {}) {
  const { ctx, page, erreurs } = await F.monter(navigateur, { fixture: 'pic', appareil, theme: 'light', heure: '15:10', port, mouvementReduit: Boolean(options.reduit) });
  try {
    await page.evaluate(poserSonde);
    for (const cle of fenetres) await jouerFenetre(page, appareil, cle, v, options);
    v(`${appareil}${options.reduit ? ', mouvement réduit' : ''} : aucune erreur JavaScript`, erreurs.length === 0, erreurs.slice(0, 2));
  } finally {
    await ctx.close();
  }
}

// Chaque mutation casse un morceau du module servi ; le controle nomme doit rougir.
const MOUVEMENT = 'assets/pinlane-mouvement.js';
const NAITRE = "    var a = surface.animate(etapes, { id: ID, duration: telephone() ? OUVERTURE_TELEPHONE : OUVERTURE, easing: SORTIE });";
const MUTATIONS = [
  { nom: 'l animation de la fenêtre retirée', de: NAITRE, vers: '    var a = { onfinish: null, oncancel: null };', appareil: 'ordinateur', fenetre: 'fiche', seulement: ['anime'], rougit: 'ordinateur, la fiche : une animation tourne sur la vraie fenêtre pendant l ouverture' },
  { nom: 'l échelle de départ remise à 0,98', de: '  var ECHELLE_DEPART = 0.9;', vers: '  var ECHELLE_DEPART = 0.98;', appareil: 'ordinateur', fenetre: 'fiche', seulement: ['echelle'], rougit: /^ordinateur, la fiche : elle part d une échelle d au plus 0,95/ },
  { nom: 'la fenêtre animée par top, left et width', de: "        { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + d.echelle + ')' },\n        { transform: 'translate(0px, 0px) scale(1)' },", vers: "        { top: dy + 'px', left: dx + 'px', width: '90%' },\n        { top: '0px', left: '0px', width: '100%' },", appareil: 'ordinateur', fenetre: 'reserver', seulement: ['proprietes'], rougit: 'ordinateur, Réserver : seuls transform et opacity s animent, sa boîte de mise en page ne bouge pas' },
  { nom: 'l ouverture dure 600 ms', de: '  var OUVERTURE = 240;', vers: '  var OUVERTURE = 600;', appareil: 'ordinateur', fenetre: 'client', seulement: ['duree'], rougit: /^ordinateur, la fenêtre client : l ouverture dure de 200 à 300 ms/ },
  { nom: 'la fenêtre grandit depuis son centre, pas depuis ce qu on touche', de: "      surface.style.transformOrigin = Math.round(p.x - b.left) + 'px ' + Math.round(p.y - b.top) + 'px';", vers: "      surface.style.transformOrigin = '50% 50%';", appareil: 'ordinateur', fenetre: 'reserver', seulement: ['origine'], rougit: /^ordinateur, Réserver : elle grandit depuis ce qu on a touché/ },
  { nom: 'Modifier ne grandit plus depuis son onglet', de: "    if (apres === 'modifier') grandirFenetre(document.querySelector('#posOverlay:not(.hidden) .edit-modal'));", vers: '    void 0;', appareil: 'ordinateur', fenetre: 'modifier', seulement: ['anime'], rougit: 'ordinateur, Modifier : une animation tourne sur la vraie fenêtre pendant l ouverture' },
  { nom: 'au téléphone, la fenêtre ne monte plus', de: "      etapes = [{ transform: 'translateY(' + monte + 'px)' }, { transform: 'translateY(0px)' }];", vers: '      etapes = [{ opacity: 1 }, { opacity: 1 }];', appareil: 'telephone', fenetre: 'fiche', seulement: ['echelle'], rougit: 'telephone, la fiche : au téléphone, elle monte du bas d au moins 24 px, sans changer de taille' },
  { nom: 'l opacité étalée sur 240 ms (le dédoublement refusé le 21/11)', de: '  var OPACITE = 60;', vers: '  var OPACITE = 240;', appareil: 'ordinateur', fenetre: 'fiche', seulement: ['lisible'], rougit: /^ordinateur, la fiche : à 80 ms elle est entièrement opaque/ },
  { nom: 'la fermeture redevient sèche', de: "    var forme = calque('pl-vol pl-sortie');", vers: "    if (true) return;\n    var forme = calque('pl-vol pl-sortie');", appareil: 'ordinateur', fenetre: 'fiche', seulement: ['fermeture'], rougit: /^ordinateur, la fiche : sa forme part en 150 à 180 ms/ },
  { nom: 'la fermeture dure 440 ms', de: '  var FERMETURE = 160;', vers: '  var FERMETURE = 440;', appareil: 'ordinateur', fenetre: 'reserver', seulement: ['fermeture'], rougit: /^ordinateur, Réserver : sa forme part en 150 à 180 ms/ },
  { nom: 'la forme qui part reste sur place (ne repart plus vers son origine)', de: "    var fin = telephone() ? 'translateY(' + Math.round(Math.min(40, window.innerHeight * 0.045)) + 'px)' : 'scale(0.95)';", vers: "    var fin = 'none';", appareil: 'ordinateur', fenetre: 'client', seulement: ['fermeture'], rougit: /^ordinateur, la fenêtre client : elle repart vers son origine/ },
  { nom: 'une forme vole de nouveau à la place de la fenêtre', de: "    if (voileEl) voileEl._plPoint = p;", vers: "    if (voileEl) voileEl._plPoint = p;\n    voler(boite(surface), boite(surface), { duree: 300 });", appareil: 'ordinateur', fenetre: 'fiche', seulement: ['calque'], rougit: 'ordinateur, la fiche : aucune forme ne vole à sa place, à aucune image de l ouverture' },
  { nom: 'la réouverture rapide rejoue l animation', de: '    if (!peutAnimer(surface) || reouverture()) return null;', vers: '    if (!peutAnimer(surface)) return null;', appareil: 'ordinateur', fenetre: 'fiche', seulement: ['lisible'], rougit: 'ordinateur, la fiche : rouverte à moins de 300 ms, elle n anime rien' },
  { nom: 'le mouvement réduit ignoré', de: '  function reduit() { return Boolean(mq && mq.matches); }', vers: '  function reduit() { return false; }', appareil: 'ordinateur', fenetre: 'fiche', reduit: true, rougit: 'ordinateur, la fiche, mouvement réduit : rien ne bouge à l ouverture' },
];

async function main() {
  for (const k of ['DATABASE_URL', 'RESEND_API_KEY', 'TELEGRAM_JETON', 'ANTHROPIC_API_KEY', 'VERCEL']) delete process.env[k];
  const navigateur = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    if (!CONTRE) {
      const serveur = await F.servir({ port: PORT });
      try {
        const v = (label, cond, detail) => ok(cond, label, detail);
        for (const appareil of ['ordinateur', 'telephone']) {
          console.log(`\n[${appareil.toUpperCase()}]`);
          await scenario(navigateur, PORT, appareil, ['fiche', 'reserver', 'modifier', 'client'], v);
        }
        console.log('\n[MOUVEMENT REDUIT]');
        await scenario(navigateur, PORT, 'ordinateur', ['fiche', 'reserver'], v, { reduit: true });
      } finally { serveur.close(); }
    } else {
      let courante = null;
      const transformer = (rel, texte) => {
        if (!courante || rel !== MOUVEMENT) return texte;
        const t = texte.replace(/\r\n/g, '\n');
        courante.vu = t.split(courante.de).length - 1;
        return t.split(courante.de).join(courante.vers);
      };
      const serveur = await F.servir({ port: PORT + 1, transformer });
      try {
        // (FENETRE_MOUVEMENT_MUTATIONS=forme,téléphone : les contre-preuves dont le nom contient ces mots)
        const voulues = (process.env.FENETRE_MOUVEMENT_MUTATIONS || '').split(',').filter(Boolean);
        for (const m of MUTATIONS.filter((x) => !voulues.length || voulues.some((mot) => x.nom.includes(mot)))) {
          console.log(`\n[CONTRE-PREUVE] ${m.nom}`);
          courante = m;
          m.vu = 0;
          const res = {};
          const v = (label, cond) => { res[label] = Boolean(cond); return Boolean(cond); };
          await scenario(navigateur, PORT + 1, m.appareil, [m.fenetre], v, { reduit: Boolean(m.reduit), seulement: m.seulement || null });
          if (!ok(m.vu === 1, `la ligne visée est dans ${MOUVEMENT}, une seule fois (vue ${m.vu} fois ; sinon la mutation ne prouverait rien)`)) continue;
          const cles = Object.keys(res).filter((k) => (m.rougit instanceof RegExp ? m.rougit.test(k) : k === m.rougit));
          ok(cles.length >= 1 && cles.some((k) => res[k] === false), `« ${m.rougit instanceof RegExp ? m.rougit.source.replace(/^\^/, '') : m.rougit} » rougit : le gate ROUGIRAIT`, cles.length ? Object.fromEntries(cles.map((k) => [k, res[k]])) : res);
        }
      } finally { serveur.close(); }
    }
  } finally {
    await navigateur.close();
  }
  console.log(`\nfenetre-mouvement-check${CONTRE ? ' --contre-preuves' : ''} : ${echecs ? echecs + ' FAIL' : 'tout vert'}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error('ECHEC', e); process.exit(1); });

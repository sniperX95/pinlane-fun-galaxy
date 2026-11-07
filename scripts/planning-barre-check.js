// LA BARRE DES TROIS PLANNINGS ET LA LIGNE QUI MONTRE TOUT (2026-11-03).
//
// Movsar, 03/11 : « faut qu on puisse switcher de planning et que tout soit de la
// meme taille [...] que ce soit aux meme endroit pour pas perturber quand on switch
// et ça que ce soit normal ou en agrandit et pour le planning complet les cartes sont
// trop petite on comprend pas on a pas toute les infos visibile direct ». Puis les 23
// decisions de l audit independant du meme jour. Ce gate garde les deux, sur la vraie
// console (scripts/planning-v3-fixtures.js, 15:10, le samedi « pic », aucun reseau,
// aucune base), mesures au pixel, sur les vrais noeuds de texte. Compteurs et ratios,
// jamais de millisecondes absolues.
//   [A] LES COORDONNEES : a 1366x768, 1920x1080 et 1024x768, chaque controle aux memes
//       coordonnees et aux memes tailles sur les trois plannings, en normal et en agrandi
//       (tolerance 0), la largeur du contenu identique, 92 px au plus, aucun chevauchement,
//       rien de coupe sur la ligne 2 ;
//   [B] AGRANDIR : un vrai plein ecran, le rail s efface, le logo reste a sa place, le
//       contenu prend la place, plus aucun autre en-tete, le plein ecran survit au
//       changement de planning, Reduire rend tout, un refus du navigateur reste agrandi
//       dans la page, ce qui s ouvre passe au-dessus ;
//   [C] LA VRAIE BARRE DE DEFILEMENT : sur un PC Windows, rien ne bouge non plus ;
//   [D] LA BASCULE : instantanee (meme tache, aucune lecture reseau), la date gardee, au
//       clavier, ses nombres ;
//   [E] LA DATE : ‹ › et « Aujourd hui » ne deplacent rien, sur les trois ;
//   [F] COLLEE : en bas de journee, la date et la bascule restent a l ecran, la boite
//       tient sous la barre, a la souris et au doigt ;
//   [G] LE MENU DE GAUCHE : replie sur les trois, sans toucher au choix de l equipe, rendu
//       en quittant les plannings ;
//   [H] L INVENTAIRE : les anciens en-tetes sont partis, chacun de leurs gestes reste
//       atteignable et marche ;
//   [I] LE DOSSIER QUI A TOUT : tout se lit sur la ligne, sur les vrais noeuds de texte ;
//   [J] LA LIGNE : le telephone, le montant, le retard sur la ligne du nom, les colonnes
//       vides retirees, « Payé » est un etat, un autre jour ;
//   [K] LES COULEURS : une activite en cours, sa pastille en gras sur fond doux et sa case
//       nue, le seul bouton plein au retard le plus recent, la legende de la couleur de ce
//       qui est a l ecran ;
//   [L] LES MOTS : un seul mot par geste, un seul nom par ecran, rien a deviner ;
//   [M] LE COMPORTEMENT : la barre de l heure au tiers haut, un seul chiffre pour une meme
//       chose, l arrivee distinguee du debut ;
//   [N] LES PETITS ECRANS : la bascule toujours visible, Bowling en haut de l ecran, rien
//       ne deborde, 44 px au doigt ;
//   [O] LA LISIBILITE, qui remplace « 17 groupes a l ecran » : six groupes entiers un jour
//       normal, le dossier le plus charge sur la moitie de l ecran, tout ce qui s ecrit se
//       lit entier, a 1366x768, 1920x1080 et 1024x768 ;
//   [P] LE CONTRASTE de la barre, en clair et en sombre ;
//   [Q] LA RECHERCHE : un seul champ, sur les trois, qui trouve aussi les notes et les
//       extras.
// --contre-preuves : chaque regle retiree (au texte servi, le disque n est jamais
// touche) fait rougir sa lettre ; chaque ancre existe une fois et une seule.
//   PB_SCENARIOS, PB_MUTATIONS : un sous-ensemble, pour iterer ; PB_BAVARD : les lignes
//   des contre-preuves ; PB_ANCRES : les ancres seules, sans rien jouer.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
// 5211 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_PLANNING_BARRE_PORT || 5211);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PG = 'assets/pinlane-planning-global.js';
const PGC = 'assets/pinlane-planning-global.css';
const APP = 'assets/app-main.js';
const MENU = 'assets/staff-menu.js';
const STAFF = 'assets/pinlane-staff.css';
const HTML = 'index.html';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

FX.APPAREILS.comptoir = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
FX.APPAREILS.grandEcran = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'fr-BE' };
FX.APPAREILS.petitPc = { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
FX.APPAREILS.pc960 = { viewport: { width: 960, height: 720 }, deviceScaleFactor: 1, locale: 'fr-BE' };
const JOUR = FX.lireFixture('pic').staffState.date;
const GROUPES_DU_PIC = FX.lireFixture('pic').staffState.reservations.length;

let echecs = 0;
let silence = false;
let mutation = null;
const rouges = [];
// La contre-preuve en cours a mordu des que sa lettre rougit : la suite de ses
// scenarios n apporterait plus rien.
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  if (!cond && mutation && mordu(label)) throw new Mordu(label);
  return cond;
}
// Un rouge deja la sans mutation ne prouve rien : seul un rouge nouveau mord.
const mordu = (label) => label.startsWith(`[${mutation.lettre}]`) && !mutation.deDepart.has(label);
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// LE MONTAGE
// ---------------------------------------------------------------------------
function fauxServeur() {
  window.__fixtureServeur = async (corps) => {
    const journee = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
    const avant = journee.find((x) => String(x.id) === String(corps.id));
    const ecrit = Object.assign({}, avant, corps, { updatedAt: new Date().toISOString() });
    if ('absent' in corps) { ecrit.absentAt = corps.absent ? new Date().toISOString() : null; delete ecrit.absent; }
    return { statut: 200, json: { ok: true, reservation: ecrit } };
  };
}
// LE DOSSIER QUI A TOUT, pose en memoire sur le samedi de la fixture : elle n a ni extra,
// ni prix ajuste, ni note d equipe. Le mutateur attrape __FIXTURE__ a sa pose, la note
// permanente passe par l API de la fiche, comme en vrai. Chaque groupe a son telephone.
function dossiers() {
  const eq = (t, par, le) => `[equipe] ${JSON.stringify({ t, par, le })}`;
  const muter = (fx) => {
    const journee = fx.jours[fx.jour];
    journee.forEach((r, i) => { if (!r.phone) r.phone = `0476 12 ${String(10 + (i % 80)).padStart(2, '0')} ${String(10 + (i % 80)).padStart(2, '0')}`; });
    const camille = journee.find((r) => /Camille/.test(r.name));
    Object.assign(camille, {
      phone: '0476 12 34 56',
      label: `${camille.label} (adaptée)`,
      extras: [{ id: 'nourriture-1', name: 'Pizza margherita × 13', price: 0 }, { id: 'nourriture-2', name: 'Gâteau d’anniversaire', price: 0 }],
      basePrice: 280,
      price: 252,
      discountReason: '',
      notes: `Un enfant allergique aux arachides.\n${eq('Bougies au bar à 17:00', 'Julie', '2027-01-15T16:05:00.000Z')}\n${eq('Formule 7 (adaptée) : 252 € au lieu de 280 €. Geste commercial', 'Seb', '2027-01-15T16:06:00.000Z')}`,
    });
    // (un groupe de bowling et un groupe de laser : la recherche vaut sur leurs listes)
    Object.assign(journee.find((r) => /Amis de Clara/.test(r.name)), { extras: [{ id: 'nourriture-1', name: 'Hot-dog × 7', heure: '17:00', price: 0 }] });
    Object.assign(journee.find((r) => /Amis de Manon/.test(r.name)), { notes: 'Sans gluten pour deux enfants.' });
    // Depuis le 2026-11-03 le serveur ecrit la raison d un prix en note structuree : la
    // derniere decrit le prix du moment, une passee se tait.
    const prixServeur = (de, a, raison, par, le) => `[equipe] ${JSON.stringify({ t: `Prix ${de} € → ${a} €, ${raison}`, par, le, type: 'prix', prix: { de, a, raison } })}`;
    Object.assign(journee.find((r) => /Famille Gérard/.test(r.name)), {
      basePrice: 69,
      price: 59,
      discountReason: '',
      notes: `${prixServeur(69, 64, 'client fidèle', 'Seb', '2027-01-15T15:00:00.000Z')}\n${eq('Arrivent en deux voitures', 'Julie', '2027-01-15T15:10:00.000Z')}\n${prixServeur(64, 59, 'carte de fidélité pleine', 'Julie', '2027-01-15T15:30:00.000Z')}`,
    });
    Object.assign(journee.find((r) => /Famille Henrard/.test(r.name)), {
      basePrice: 39,
      price: 39,
      discountReason: '',
      notes: prixServeur(39, 30, 'geste', 'Seb', '2027-01-15T15:00:00.000Z'),
    });
  };
  let valeur;
  Object.defineProperty(window, '__FIXTURE__', { configurable: true, get() { return valeur; }, set(v) { valeur = v; muter(v); } });
  let courant = window.fetch;
  const envelopper = (f) => async function fetchAvecNote(input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.pathname === '/api/staff-customer-notes' && String((init && init.method) || 'GET').toUpperCase() === 'GET') {
      const camille = valeur.jours[valeur.jour].find((r) => /Camille/.test(r.name));
      const note = (id) => ({ eligible: true, clientKey: `fixture:${id}`, note: Number(id) === Number(camille.id) ? { body: 'Client fidèle, 3e anniversaire chez nous', updatedAt: '2026-12-01T10:00:00.000Z', updatedBy: 'Seb' } : null });
      const lot = url.searchParams.get('reservationIds');
      const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
      if (lot !== null) { const m = {}; lot.split(',').filter(Boolean).forEach((id) => { m[String(Number(id))] = note(id); }); return j({ ok: true, notesByReservationId: m }); }
      return j(Object.assign({ ok: true }, note(url.searchParams.get('reservationId'))));
    }
    return f.apply(this, arguments);
  };
  Object.defineProperty(window, 'fetch', { configurable: true, get() { return courant; }, set(f) { courant = envelopper(f); } });
}
async function ouvrir(browser, o = {}) {
  const { lettre, avantChargement, variante = [], ...reste } = o;
  return FX.monter(browser, {
    fixture: 'pic', appareil: 'comptoir', theme: 'light', port: PORT, ...reste,
    variante: ['sansdemo', ...variante],
    avantChargement: async (page) => {
      await page.addInitScript(fauxServeur);
      if (avantChargement) await avantChargement(page);
    },
  });
}
// Un scenario : son ecran, ses gestes, sa page sans erreur.
async function avec(browser, o, corps) {
  const m = await ouvrir(browser, o);
  try {
    await corps(m.page, m);
    ok(m.erreurs.length === 0, `[${o.lettre}] aucune erreur de page (${o.fixture || 'pic'}, ${o.appareil || 'comptoir'})`, m.erreurs.slice(0, 3));
  } finally { await m.ctx.close(); }
}

// La veille et le lendemain ont des groupes : la meme journee, recopiee.
const voisins = (page) => page.evaluate(() => {
  const F = window.__FIXTURE__;
  const decale = (n) => { const d = new Date(`${F.jour}T12:00:00`); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  [-1, 1].forEach((n) => { const j = decale(n); F.jours[j] = F.jours[F.jour].map((r) => Object.assign({}, r, { date: j })); });
});

const VUES = ['all', 'bowling', 'laser'];
const ONGLET = { all: '#staffTabAll', bowling: '#staffTabBowling', laser: '#staffTabLaser' };
const BOITE = { all: '#globalPlanningBox', bowling: '#planningBox', laser: '#laserPlanningBox' };
async function aller(page, vue) {
  await page.locator(ONGLET[vue]).click();
  await FX.repos(page, 150);
}
const agrandir = async (page) => { await page.locator('#planningAgrandir').click(); await FX.repos(page, 250); };

// Chaque controle de la barre, ses quatre valeurs au centieme de pixel.
const CONTROLES = {
  bascule: '#planningBarre .pb-seg',
  complet: '#staffTabAll',
  bowling: '#staffTabBowling',
  laser: '#staffTabLaser',
  datePrec: '#staffPrevDateBtn',
  date: '#staffDateShort',
  dateSuiv: '#staffNextDateBtn',
  recherche: '#globalPlanningSearchInput',
  reserver: '#planningReserver',
  agrandir: '#planningAgrandir',
  plus: '#planningPlus',
  ligne2: '#planningBande',
  direct: '#planningBande .pb-direct',
  legende: '#planningBande .pb-leg',
};
const mesurer = (page) => page.evaluate((sels) => {
  const o = {};
  Object.keys(sels).forEach((nom) => {
    const e = document.querySelector(sels[nom]);
    if (!e || !e.getClientRects().length) { o[nom] = null; return; }
    const b = e.getBoundingClientRect();
    o[nom] = [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 100) / 100);
  });
  return o;
}, CONTROLES);
const ecarts = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k} ${a[k]} / ${b[k]}`);
// La forme de la barre : sa hauteur, ses lignes, ce qui se recouvre, ce qui sort.
const formeDeLaBarre = (page) => page.evaluate(() => {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  const ligne1 = r('#planningBarre .pb-ligne');
  const ligne2 = r('#planningBande');
  const pieces = ['#staffTabAll', '#staffTabBowling', '#staffTabLaser', '#staffPrevDateBtn', '#staffDateShort', '#staffNextDateBtn', '#gfRecherche', '#planningReserver', '#planningAgrandir', '#planningPlus']
    .map((s) => document.querySelector(s)).filter((e) => e && e.getClientRects().length);
  const boites = pieces.map((e) => { const b = e.getBoundingClientRect(); return { nom: e.id, g: b.left, d: b.right, h: b.top, b: b.bottom }; });
  const chevauchements = [];
  boites.forEach((a, i) => boites.slice(i + 1).forEach((b) => { if (a.g < b.d - 0.5 && b.g < a.d - 0.5 && a.h < b.b - 0.5 && b.h < a.b - 0.5) chevauchements.push(`${a.nom}/${b.nom}`); }));
  const dehors = boites.filter((b) => b.g < 0 || b.d > innerWidth || b.h < 0 || b.b > innerHeight).map((b) => b.nom);
  const bande = document.getElementById('planningBande');
  const coupes = Array.from(bande.children).filter((e) => e.getClientRects().length).filter((e) => { const b = e.getBoundingClientRect(); return b.right > ligne2.right + 0.5 || b.left < ligne2.left - 0.5; }).map((e) => e.className || e.tagName);
  // (le texte de la ligne 2 se lit entier : un compteur rogne ne se voit pas a sa boite)
  const rognes = Array.from(bande.querySelectorAll('.gf-e, .gf-c, .pb-k')).filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 24));
  return { hauteur: Math.round(ligne2.bottom - ligne1.top), l1: Math.round(ligne1.height), l2: Math.round(ligne2.height), chevauchements, dehors, coupes, rognes, deborde: bande.scrollWidth > bande.clientWidth + 1 };
});
const contenu = (page, vue) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { g: Math.round(b.left * 100) / 100, d: Math.round(b.right * 100) / 100, h: Math.round(b.top * 100) / 100, b: Math.round(b.bottom * 100) / 100, l: Math.round(b.width * 100) / 100, t: Math.round(b.height * 100) / 100 }; }, BOITE[vue]);
const lireLogo = (page) => page.evaluate(() => {
  const e = document.querySelector('.ops-sidebar .fgx-menu-logo-frame');
  if (!e) return null;
  const b = e.getBoundingClientRect();
  const dessus = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return { x: [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 100) / 100), visible: getComputedStyle(e).visibility === 'visible', dessus: Boolean(dessus && e.contains(dessus)) };
});

// ---------------------------------------------------------------------------
// [A] LES COORDONNEES
// ---------------------------------------------------------------------------
async function coordonnees(browser) {
  for (const appareil of ['comptoir', 'grandEcran', 'petitPc']) {
    await avec(browser, { lettre: 'A', appareil }, async (page) => {
      const ref = await mesurer(page);
      // (sur petit PC, la legende cede sa place a l enseigne du centre : 85 px de trop a 1024 px)
      const manquants = Object.keys(ref).filter((k) => !ref[k] && !(appareil === 'petitPc' && k === 'legende'));
      ok(manquants.length === 0, `[A] ${appareil} : chaque controle de la barre est a l ecran`, manquants);
      const logo = await lireLogo(page);
      const larges = { normal: null, agrandi: null };
      for (const vue of VUES) {
        await aller(page, vue);
        const n = await mesurer(page);
        ok(ecarts(ref, n).length === 0, `[A] ${appareil} : ${vue}, chaque controle aux memes coordonnees, aux memes tailles`, ecarts(ref, n));
        const f = await formeDeLaBarre(page);
        ok(f.hauteur <= 92 && f.l1 === 42 && f.l2 === 44, `[A] ${appareil} : ${vue}, 92 px au plus, 42 et 44 par ligne`, f);
        ok(f.chevauchements.length === 0 && f.dehors.length === 0, `[A] ${appareil} : ${vue}, aucun chevauchement, rien hors de l ecran`, f);
        ok(!f.deborde && f.coupes.length === 0 && f.rognes.length === 0, `[A] ${appareil} : ${vue}, la ligne 2 se lit entiere`, f);
        const c = await contenu(page, vue);
        if (!larges.normal) larges.normal = c;
        ok(c.g === larges.normal.g && c.d === larges.normal.d && c.h === larges.normal.h, `[A] ${appareil} : ${vue}, le contenu a la meme largeur et le meme haut`, { vue: c, ref: larges.normal });
        await agrandir(page);
        const a = await mesurer(page);
        ok(ecarts(ref, a).length === 0, `[A] ${appareil} : ${vue} agrandi, chaque controle aux memes coordonnees, aux memes tailles`, ecarts(ref, a));
        const ca = await contenu(page, vue);
        if (!larges.agrandi) larges.agrandi = ca;
        ok(ca.g === larges.agrandi.g && ca.d === larges.agrandi.d && ca.h === larges.agrandi.h, `[A] ${appareil} : ${vue} agrandi, le contenu a la meme largeur et le meme haut`, { vue: ca, ref: larges.agrandi });
        const lg = await lireLogo(page);
        ok(lg && logo && JSON.stringify(lg.x) === JSON.stringify(logo.x) && lg.visible && lg.dessus, `[A] ${appareil} : ${vue} agrandi, le logo reste a sa place, visible`, { avant: logo, apres: lg });
        await agrandir(page);
        const r = await mesurer(page);
        ok(ecarts(ref, r).length === 0, `[A] ${appareil} : ${vue} reduit, tout revient`, ecarts(ref, r));
      }
    });
  }
  // A 960 px, l enseigne et les chiffres tiennent encore sur une rangee : c est le palier de la ligne 2 qui le permet.
  await avec(browser, { lettre: 'A', appareil: 'pc960' }, async (page) => {
    const f = await formeDeLaBarre(page);
    ok(f.l2 === 44 && !f.deborde, '[A] a 960 px : l enseigne et les chiffres tiennent sur une rangee', f);
  });
  // Le pire jour, a 1024 : deux chiffres partout, la ligne 2 tient encore.
  await avec(browser, { lettre: 'A', appareil: 'petitPc', fixture: 'pire' }, async (page) => {
    const f = await formeDeLaBarre(page);
    ok(!f.deborde && f.coupes.length === 0 && f.chevauchements.length === 0, '[A] petitPc, pire jour : la ligne 2 se lit entiere', f);
  });
}

// ---------------------------------------------------------------------------
// [B] AGRANDIR
// ---------------------------------------------------------------------------
const lireAgrandi = (page) => page.evaluate(() => {
  const vus = (s) => Array.from(document.querySelectorAll(s)).filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length;
  return {
    agrandi: document.body.classList.contains('pb-agrandi'),
    plein: Boolean(document.fullscreenElement),
    rail: getComputedStyle(document.querySelector('.ops-sidebar')).visibility,
    menus: vus('.ops-sidebar .fgx-menu-nav [data-fgx-menu-key], .ops-sidebar .fgx-menu-nav [data-fgx-menu-toggle]'),
    autres: vus('#staffView .planning-head, #staffView .staff-head, #staffView .kpi-grid, #staffView .staff-resource-tabs, #staffView .gf-tete'),
    liste: vus('#staffTableBox'),
    defile: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    bas: document.getElementById('planningBande').getBoundingClientRect().bottom,
    titre: document.getElementById('planningAgrandir').getAttribute('aria-label'),
    presse: document.getElementById('planningAgrandir').getAttribute('aria-pressed'),
    ih: innerHeight,
  };
});
async function agrandissement(browser) {
  await avec(browser, { lettre: 'B' }, async (page) => {
    for (const vue of VUES) {
      await aller(page, vue);
      const avant = await contenu(page, vue);
      await agrandir(page);
      const a = await lireAgrandi(page);
      ok(a.agrandi && a.plein, `[B] ${vue} : Agrandir passe vraiment en plein ecran`, a);
      ok(a.rail === 'hidden' && a.menus === 0, `[B] ${vue} : le rail s efface`, a);
      ok(a.autres === 0 && a.liste === 0, `[B] ${vue} : plus aucun autre en-tete`, a);
      ok(a.titre === 'Réduire le planning' && a.presse === 'true', `[B] ${vue} : le bouton dit Réduire`, a);
      const c = await contenu(page, vue);
      ok(c.l >= avant.l + 60, `[B] ${vue} : le contenu prend la largeur du rail`, { avant: avant.l, apres: c.l });
      ok(c.b >= a.ih - 8 && c.h >= a.bas && c.h <= a.bas + 8, `[B] ${vue} : le contenu va de la barre au bas de l ecran`, { contenu: c, barre: a.bas, ih: a.ih });
      await agrandir(page);
      const r = await lireAgrandi(page);
      ok(!r.agrandi && !r.plein && r.rail === 'visible' && r.titre === 'Agrandir le planning', `[B] ${vue} : Reduire rend tout, et quitte le plein ecran`, r);
    }
    // La bascule garde le plein ecran : un changement de planning n en sort pas.
    await aller(page, 'all');
    await agrandir(page);
    for (const vue of ['bowling', 'laser', 'all']) {
      await aller(page, vue);
      const s = await lireAgrandi(page);
      ok(s.agrandi && s.plein && (await page.evaluate(() => getStaffResourceView())) === vue, `[B] agrandi, la bascule change de planning sans quitter le plein ecran (${vue})`, s);
    }
    // Ce qui s ouvre passe au-dessus : la bulle, la fiche, Réserver, le calendrier.
    const auDessus = (selecteur) => page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e || !e.getClientRects().length) return { present: false };
      const b = e.getBoundingClientRect();
      const x = b.left + Math.min(b.width / 2, 120);
      const y = b.top + Math.min(b.height / 2, 80);
      const d = document.elementFromPoint(x, y);
      return { present: true, dessus: Boolean(d && e.contains(d)), sur: d ? d.className || d.tagName : '' };
    }, selecteur);
    await page.locator('#planningPlus').click();
    await FX.repos(page, 100);
    const menu = await auDessus('.staff-action-popover');
    ok(menu.present && menu.dessus, '[B] agrandi, le menu « ⋯ » passe au-dessus', menu);
    await page.evaluate(() => closeStaffFloatingMenus());
    await page.locator('#staffDateShort').click();
    await FX.repos(page, 200);
    const cal = await auDessus('.staff-calendar-pop');
    ok(cal.present && cal.dessus, '[B] agrandi, le calendrier passe au-dessus', cal);
    await page.evaluate(() => { if (typeof closeStaffCalendar === 'function') closeStaffCalendar(); closeStaffFloatingMenus(); });
    await page.locator('.gf-r .gf-nom__t').first().click();
    await FX.repos(page, 250);
    const fiche = await auDessus('#posOverlay');
    ok(fiche.present && fiche.dessus, '[B] agrandi, la fiche passe au-dessus', fiche);
    await page.evaluate(() => closePos());
    await FX.repos(page, 150);
    await page.locator('#planningReserver').click();
    await FX.repos(page, 250);
    const reserver = await auDessus('#quickBookOverlay');
    ok(reserver.present && reserver.dessus, '[B] agrandi, Réserver passe au-dessus', reserver);
    await page.evaluate(() => closeQuickBook());
    await FX.repos(page, 150);
    // Le navigateur en sort (Echap, F11) : le planning redevient normal.
    await page.evaluate(() => document.exitFullscreen());
    await FX.repos(page, 250);
    const sortie = await lireAgrandi(page);
    ok(!sortie.agrandi && !sortie.plein && sortie.rail === 'visible', '[B] sortir du plein ecran par le navigateur reduit le planning', sortie);
  });
  // Un navigateur qui refuse (iframe, reglage) : Agrandir reste dans la page, sans erreur.
  await avec(browser, { lettre: 'B', avantChargement: (page) => page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('refuse')); }) }, async (page) => {
    await agrandir(page);
    const a = await lireAgrandi(page);
    ok(a.agrandi && !a.plein && a.rail === 'hidden', '[B] plein ecran refuse : agrandi dans la page, sans erreur', a);
  });
}

// ---------------------------------------------------------------------------
// [C] LA VRAIE BARRE DE DEFILEMENT
// ---------------------------------------------------------------------------
// (le navigateur des gates cache ses barres : sur un PC Windows, elles prennent 15 px, et
// c est la qu un contenu en 100vw sautait d un planning a l autre)
async function vraiesBarres() {
  const navigateur = await chromium.launch({ executablePath: BROWSER_PATH, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    await avec(navigateur, { lettre: 'C' }, async (page) => {
      const largeur = () => page.evaluate(() => ({ client: document.documentElement.clientWidth, iw: innerWidth }));
      const l0 = await largeur();
      ok(l0.iw - l0.client > 0, '[C] le montage : une vraie barre de defilement prend sa place', l0);
      const ref = await mesurer(page);
      for (const vue of VUES) {
        await aller(page, vue);
        const n = await mesurer(page);
        ok(ecarts(ref, n).length === 0, `[C] ${vue} : rien ne bouge, barre de defilement comprise`, ecarts(ref, n));
        await agrandir(page);
        const a = await mesurer(page);
        ok(ecarts(ref, a).length === 0, `[C] ${vue} agrandi : rien ne bouge, barre de defilement comprise`, ecarts(ref, a));
        await agrandir(page);
      }
    });
  } finally { await navigateur.close(); }
}

// ---------------------------------------------------------------------------
// [D] LA BASCULE
// ---------------------------------------------------------------------------
async function bascule(browser) {
  await avec(browser, { lettre: 'D' }, async (page) => {
    await voisins(page);
    await page.evaluate(() => {
      window.__lectures = 0;
      const f = window.fetch;
      window.fetch = function (input) { const u = String(typeof input === 'string' ? input : input.url); if (/\/api\//.test(u)) window.__lectures += 1; return f.apply(this, arguments); };
    });
    // Dans la meme tache que le toucher : la grille est la, sans attendre rien.
    const direct = (vue) => page.evaluate(([o, b]) => {
      const avant = window.__lectures;
      document.querySelector(o).click();
      const boite = document.querySelector(b);
      return { visible: boite.getClientRects().length > 0, rempli: boite.querySelectorAll('*').length, lectures: window.__lectures - avant, choisi: document.querySelector(o).getAttribute('aria-selected') };
    }, [ONGLET[vue], BOITE[vue]]);
    for (const vue of ['bowling', 'laser', 'all']) {
      const d = await direct(vue);
      ok(d.visible && d.rempli > 20 && d.choisi === 'true', `[D] ${vue} : le planning est la dans la tache du toucher`, d);
      ok(d.lectures === 0, `[D] ${vue} : la bascule ne lit rien sur le reseau`, d);
      await FX.repos(page, 100);
    }
    // La date reste, en normal et en agrandi.
    await page.locator('#staffNextDateBtn').click();
    await FX.repos(page, 250);
    const date = await page.evaluate(() => state.currentDate);
    ok(date !== JOUR, '[D] le montage : le lendemain', date);
    for (const vue of ['bowling', 'laser', 'all']) {
      await aller(page, vue);
      const d = await page.evaluate(() => ({ date: state.currentDate, libelle: document.getElementById('staffDateShort').textContent }));
      ok(d.date === date, `[D] ${vue} : la date reste`, d);
    }
    await agrandir(page);
    for (const vue of ['bowling', 'laser', 'all']) {
      await aller(page, vue);
      ok((await page.evaluate(() => state.currentDate)) === date, `[D] ${vue} agrandi : la date reste`);
    }
    await agrandir(page);
    await page.evaluate(() => setStaffToday());
    await FX.repos(page, 250);
    // Au clavier : les fleches passent d un planning a l autre.
    await page.locator('#staffTabAll').focus();
    await page.keyboard.press('ArrowRight');
    await FX.repos(page, 150);
    ok((await page.evaluate(() => getStaffResourceView())) === 'bowling', '[D] la fleche droite passe a Bowling');
    await page.keyboard.press('ArrowLeft');
    await FX.repos(page, 150);
    ok((await page.evaluate(() => getStaffResourceView())) === 'all', '[D] la fleche gauche revient au Complet');
    // Chaque choix dit combien de groupes il montre.
    const nombres = await page.evaluate(() => ({
      all: Number(document.getElementById('staffAllCount').textContent),
      bowling: Number(document.getElementById('staffBowlingCount').textContent),
      laser: Number(document.getElementById('staffLaserCount').textContent),
      lignes: document.querySelectorAll('.gf-r').length,
      vraiB: scopedStaffReservations('bowling').length,
      vraiL: scopedStaffReservations('laser').length,
    }));
    ok(nombres.all === nombres.lignes && nombres.bowling === nombres.vraiB && nombres.laser === nombres.vraiL && nombres.bowling > 0 && nombres.laser > 0, '[D] chaque choix porte le nombre de ses groupes', nombres);
  });
}

// ---------------------------------------------------------------------------
// [E] LA DATE
// ---------------------------------------------------------------------------
async function date(browser) {
  await avec(browser, { lettre: 'E' }, async (page) => {
    await voisins(page);
    const direct = () => page.evaluate(() => {
      const d = document.querySelector('#planningBande .pb-direct');
      const b = d.querySelector('.staff-today-btn');
      const x = b ? b.getBoundingClientRect() : null;
      const c = d.getBoundingClientRect();
      return { bouton: Boolean(b), dedans: !x || (x.left >= c.left - 0.5 && x.right <= c.right + 0.5), heure: Boolean(d.querySelector('[data-gf-horloge]')) };
    });
    for (const vue of VUES) {
      await aller(page, vue);
      const ref = await mesurer(page);
      const auj = await direct();
      ok(!auj.bouton && auj.heure, `[E] ${vue} : aujourd hui, l heure, pas de bouton « Aujourd hui »`, auj);
      await page.locator('#staffNextDateBtn').click();
      await FX.repos(page, 250);
      const m = await mesurer(page);
      ok(ecarts(ref, m).length === 0, `[E] ${vue} : le jour suivant ne deplace rien`, ecarts(ref, m));
      const demain = await direct();
      ok(demain.bouton && demain.dedans && !demain.heure, `[E] ${vue} : un autre jour, « Aujourd hui » prend la place de l heure`, demain);
      await page.locator('#staffPrevDateBtn').click();
      await FX.repos(page, 250);
      await page.locator('#staffPrevDateBtn').click();
      await FX.repos(page, 250);
      ok(ecarts(ref, await mesurer(page)).length === 0, `[E] ${vue} : la veille ne deplace rien`);
      await page.locator('#planningBande .staff-today-btn').click();
      await FX.repos(page, 250);
      const retour = await page.evaluate(() => state.currentDate);
      ok(retour === JOUR && ecarts(ref, await mesurer(page)).length === 0, `[E] ${vue} : « Aujourd hui » ramene au jour, rien n a bouge`, retour);
    }
    // La date la plus longue de l annee tient dans son libelle.
    const libelle = await page.evaluate(() => {
      const b = document.getElementById('staffDateShort');
      const crayon = document.createElement('canvas').getContext('2d');
      const tester = (texte) => {
        const coupe = texte.lastIndexOf(' ');
        b.innerHTML = `${texte.slice(0, coupe)}<span class="pb-an">${texte.slice(coupe)}</span>`;
        const p = document.createRange();
        p.selectNodeContents(b);
        const r = p.getBoundingClientRect();
        const c = b.getBoundingClientRect();
        const an = b.querySelector('.pb-an');
        const s = getComputedStyle(an);
        crayon.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
        return { texte, plus: Math.ceil(r.width - c.width), espace: an.getBoundingClientRect().width - crayon.measureText(texte.slice(coupe + 1)).width };
      };
      return ['Mer. 29 sept. 2027', 'Mar. 28 févr. 2027'].map(tester);
    });
    ok(libelle.every((l) => l.plus <= 0 && l.espace >= 2), '[E] la date la plus longue tient dans son libelle, l annee detachee', libelle);
  });
}

// ---------------------------------------------------------------------------
// [F] COLLEE
// ---------------------------------------------------------------------------
async function collee(browser) {
  await avec(browser, { lettre: 'F' }, async (page) => {
    const ref = await mesurer(page);
    for (const vue of VUES) {
      await aller(page, vue);
      const c = await contenu(page, vue);
      const ih = await page.evaluate(() => innerHeight);
      ok(c.b <= ih, `[F] ${vue} : la boite tient sous la barre, jusqu au bas de l ecran`, { contenu: c, ih });
      // En bas de journee, dans la boite : la barre ne bouge pas.
      await page.evaluate((s) => { const b = document.querySelector(s); const d = Array.from(b.querySelectorAll('*')).concat([b]).find((e) => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY)); if (d) d.scrollTop = d.scrollHeight; }, BOITE[vue]);
      await FX.repos(page, 100);
      ok(ecarts(ref, await mesurer(page)).length === 0, `[F] ${vue} : en bas de journee, la barre ne bouge pas`);
      // En bas de page, sur la liste : la barre reste collee.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await FX.repos(page, 150);
      const y = await page.evaluate(() => window.scrollY);
      const m = await mesurer(page);
      ok(y > 100 && ecarts(ref, m).length === 0, `[F] ${vue} : en bas de page, la date et la bascule restent a leur place`, { y, ecarts: ecarts(ref, m) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await FX.repos(page, 100);
    }
  });
  // Au doigt, la barre fait 92 px : la boite se regle dessus.
  await avec(browser, { lettre: 'F', appareil: 'tablette' }, async (page) => {
    for (const vue of VUES) {
      await page.evaluate((v) => pbChanger(v), vue);
      await FX.repos(page, 200);
      const c = await contenu(page, vue);
      const ih = await page.evaluate(() => innerHeight);
      ok(c.b <= ih, `[F] tablette, ${vue} : la boite tient sous la barre, au doigt aussi`, { contenu: c, ih });
    }
  });
}

// ---------------------------------------------------------------------------
// [G] LE MENU DE GAUCHE
// ---------------------------------------------------------------------------
async function menuGauche(browser) {
  await avec(browser, { lettre: 'G' }, async (page) => {
    const lire = () => page.evaluate(() => ({
      replie: document.body.classList.contains('staff-menu-collapsed'),
      large: document.body.classList.contains('gf-large'),
      rail: Math.round(document.querySelector('.ops-sidebar').getBoundingClientRect().width),
      pref: Boolean(state.staffMenuCollapsed),
      gouttiere: document.documentElement.classList.contains('pb-page'),
      barre: getComputedStyle(document.getElementById('planningBarre')).display,
    }));
    for (const vue of VUES) {
      await aller(page, vue);
      const m = await lire();
      ok(m.replie && m.large && m.rail <= 80 && !m.pref, `[G] ${vue} : le menu est une barre d icones, le choix de l equipe ne bouge pas`, m);
    }
    await page.locator('[data-fgx-menu-key="reservations"]').first().click();
    await FX.repos(page, 400);
    const ailleurs = await lire();
    ok(!ailleurs.replie && !ailleurs.large && ailleurs.rail > 200 && !ailleurs.pref && !ailleurs.gouttiere, '[G] en quittant les plannings, le menu revient comme l equipe l a laisse', ailleurs);
    await page.locator('[data-fgx-menu-toggle="planning"], [data-fgx-menu-key="planning"]').first().click();
    await FX.repos(page, 300);
    await page.locator('[data-ops-resource="bowling"]').first().click();
    await FX.repos(page, 400);
    const retour = await lire();
    ok(retour.replie && retour.large && retour.rail <= 80 && !retour.pref && retour.barre !== 'none', '[G] en revenant sur un planning, la barre d icones revient', retour);
  });
}

// ---------------------------------------------------------------------------
// [H] L INVENTAIRE
// ---------------------------------------------------------------------------
const menuPlus = async (page) => {
  await page.evaluate(() => closeStaffFloatingMenus());
  await page.locator('#planningPlus').click();
  await FX.repos(page, 80);
  return page.evaluate(() => {
    const m = document.querySelector('.staff-action-popover');
    return m ? { boutons: Array.from(m.querySelectorAll('button')).map((b) => b.textContent.replace(/\s+/g, ' ').trim()), texte: m.textContent.replace(/\s+/g, ' ').trim() } : { boutons: [], texte: '' };
  });
};
const cliquerAuMenu = (page, mot) => page.locator('.staff-action-popover button', { hasText: mot }).first().click();
async function inventaire(browser) {
  await avec(browser, { lettre: 'H' }, async (page) => {
    await voisins(page);
    await page.evaluate(() => {
      window.__appels = [];
      ['telechargerSecours', 'exportStaffPlanningCsv', 'lpReserverAuProchain'].forEach((nom) => {
        window[nom] = function espion(...a) { window.__appels.push(`${nom}(${a.filter((x) => typeof x === 'string').join()})`); };
      });
      const f = window.refreshStaffPlanning;
      window.refreshStaffPlanning = function espion() { window.__appels.push('refreshStaffPlanning()'); return f.apply(this, arguments); };
    });
    const appels = () => page.evaluate(() => window.__appels.splice(0));
    const anciens = await page.evaluate(() => {
      const vus = (s) => Array.from(document.querySelectorAll(s)).filter((e) => e.getClientRects().length).length;
      return { tetes: vus('#staffView .staff-head, #staffView .kpi-grid, #staffView .staff-resource-tabs, #staffView .planning-head, #staffView .gf-tete'), champs: Array.from(document.querySelectorAll('#staffView input')).filter((e) => e.getClientRects().length && /text|search/.test(e.type)).map((e) => e.id) };
    });
    ok(anciens.tetes === 0, '[H] les titres, les tuiles et les anciens onglets sont partis', anciens);
    ok(anciens.champs.length === 1 && anciens.champs[0] === 'globalPlanningSearchInput', '[H] un seul champ de recherche', anciens);
    const communs = ['Filtres', 'Voir la liste des réservations', 'Imprimer la feuille de secours (PDF)', 'Actualiser les données', 'Exporter le jour en CSV'];
    const propres = { all: [], bowling: ['Nouvelle réservation ici'], laser: ['Nouvelle réservation ici', 'Réserver au prochain départ'] };
    for (const vue of VUES) {
      await aller(page, vue);
      const m = await menuPlus(page);
      const absents = communs.concat(propres[vue]).filter((b) => !m.boutons.includes(b));
      ok(absents.length === 0, `[H] ${vue} : le menu « ⋯ » garde tous ses gestes`, { absents, boutons: m.boutons });
      ok(/^Actions planning Ouvert \d/.test(m.texte), `[H] ${vue} : le menu dit les horaires d ouverture`, m.texte.slice(0, 60));
      ok(!m.boutons.some((b) => /Agrandir|Réduire/.test(b)), `[H] ${vue} : le menu ne redit pas Agrandir, la barre l a`, m.boutons);
      await cliquerAuMenu(page, 'Imprimer la feuille de secours');
      await FX.repos(page, 60);
      ok((await appels()).join() === 'telechargerSecours(feuille)', `[H] ${vue} : Imprimer lance la feuille de secours`);
      await menuPlus(page);
      await cliquerAuMenu(page, 'Actualiser les données');
      await FX.repos(page, 150);
      ok((await appels()).includes('refreshStaffPlanning()'), `[H] ${vue} : Actualiser relit la journee`);
      await menuPlus(page);
      await cliquerAuMenu(page, 'Exporter le jour en CSV');
      await FX.repos(page, 60);
      ok((await appels()).join().startsWith('exportStaffPlanningCsv'), `[H] ${vue} : Exporter lance le CSV`);
      // Les filtres : dans le meme menu, un filtre se dit sur la ligne 2 et s enleve.
      await page.evaluate(() => closeStaffFloatingMenus());
      await menuPlus(page);
      await cliquerAuMenu(page, 'Filtres');
      await FX.repos(page, 80);
      const f = await page.evaluate(() => Array.from(document.querySelectorAll('.staff-action-popover button')).map((b) => b.textContent.trim()));
      ok(f.includes('Tout voir') && f.includes('Terminées') && f.includes('Sur place') && f.length >= 5, `[H] ${vue} : Filtres ouvre les filtres du planning`, f);
      await page.locator('.staff-action-popover button', { hasText: 'Terminées' }).first().click();
      await FX.repos(page, 200);
      const puce = await page.evaluate(() => ({ filtre: normaliserFiltreListe(state.staffStatusFilter), puce: (document.querySelector('#planningBande .pb-filtre') || {}).textContent || '' }));
      ok(puce.filtre !== 'all' && /^Filtre : /.test(puce.puce), `[H] ${vue} : un filtre pose se dit sur la ligne 2`, puce);
      await page.locator('#planningBande .pb-filtre').click();
      await FX.repos(page, 200);
      ok((await page.evaluate(() => normaliserFiltreListe(state.staffStatusFilter))) === 'all', `[H] ${vue} : il s enleve d un toucher`);
      // La liste, depuis l agrandi : le planning se reduit, la liste vient sous la barre.
      await agrandir(page);
      await menuPlus(page);
      await cliquerAuMenu(page, 'Voir la liste des réservations');
      await FX.repos(page, 700);
      const l = await page.evaluate(() => ({ agrandi: document.body.classList.contains('pb-agrandi'), haut: document.getElementById('staffTableBox').getBoundingClientRect().top, bas: document.getElementById('planningBande').getBoundingClientRect().bottom, ih: innerHeight }));
      ok(!l.agrandi && l.haut >= l.bas - 1 && l.haut < l.ih / 2, `[H] ${vue} : Voir la liste mene a la liste, sous la barre`, l);
      await page.evaluate(() => window.scrollTo(0, 0));
      await FX.repos(page, 200);
    }
    // Les gestes propres a chaque planning.
    await aller(page, 'bowling');
    await menuPlus(page);
    await cliquerAuMenu(page, 'Nouvelle réservation ici');
    await FX.repos(page, 200);
    const bo = await page.evaluate(() => ({ ouvert: !document.getElementById('quickBookOverlay').classList.contains('hidden'), type: quickBookState && quickBookState.type }));
    ok(bo.ouvert && bo.type === 'bowling', '[H] Bowling : Nouvelle réservation ici ouvre Réserver, en bowling', bo);
    await page.evaluate(() => closeQuickBook());
    await FX.repos(page, 150);
    await aller(page, 'laser');
    const ml = await menuPlus(page);
    ok(ml.texte.length > 60, '[H] Laser : le sous-titre du laser reste au menu', ml.texte.slice(0, 120));
    await cliquerAuMenu(page, 'Réserver au prochain départ');
    await FX.repos(page, 80);
    ok((await appels()).join().startsWith('lpReserverAuProchain'), '[H] Laser : Réserver au prochain départ');
    await aller(page, 'all');
    const mc = await menuPlus(page);
    ok(/Départ laser de \d\d:\d\d/.test(mc.texte) && /en cours/.test(mc.texte) && /vers : sans heure fixe/.test(mc.texte), '[H] Complet : le depart laser et la legende des cases restent au menu', mc.texte.slice(-160));
    await page.evaluate(() => closeStaffFloatingMenus());
    // La ligne 2 de chaque planning : ses chiffres.
    const mots = {
      all: ['En retard', 'À venir', 'Sur place', 'À clôturer', 'Pistes', 'Laser', 'Confirmé', 'Arrivé', 'Payé'],
      bowling: ['Occupation', 'Réservations', 'Libres', 'Confirmé', 'Arrivé', 'Payé'],
      laser: ['Occupation', 'Réservations', 'Libres', 'Confirmé', 'Arrivé', 'Payé'],
    };
    for (const vue of VUES) {
      await aller(page, vue);
      const t = await page.evaluate(() => document.getElementById('planningBande').innerText.replace(/\s+/g, ' '));
      const absents = mots[vue].filter((m) => !t.includes(m));
      ok(absents.length === 0, `[H] ${vue} : la ligne 2 dit ses chiffres et la legende`, { absents, t });
    }
    // + Réservation : le geste du planning ouvert.
    await aller(page, 'bowling');
    await page.locator('#planningReserver').click();
    await FX.repos(page, 200);
    ok((await page.evaluate(() => quickBookState && quickBookState.type)) === 'bowling', '[H] + Réservation, sur Bowling : une partie de bowling');
    await page.evaluate(() => closeQuickBook());
    await FX.repos(page, 150);
    await aller(page, 'laser');
    await page.locator('#planningReserver').click();
    await FX.repos(page, 80);
    ok((await appels()).join().startsWith('lpReserverAuProchain'), '[H] + Réservation, sur Laser : le prochain depart');
    await aller(page, 'all');
    await page.locator('#planningReserver').click();
    await FX.repos(page, 200);
    ok(await page.evaluate(() => !document.getElementById('quickBookOverlay').classList.contains('hidden') && quickBookState.date === state.currentDate), '[H] + Réservation, sur le Complet : Réserver, a la date affichee');
    await page.evaluate(() => closeQuickBook());
  });
}

// ---------------------------------------------------------------------------
// [I] LE DOSSIER QUI A TOUT
// ---------------------------------------------------------------------------
// Les rubriques d une ligne, lues sur leurs noeuds de texte.
const rubriquesDe = (page, nom) => page.evaluate((n) => {
  const tr = Array.from(document.querySelectorAll('.gf-r')).find((x) => x.querySelector('.gf-nom__t').textContent.includes(n));
  const rub = {};
  const ordre = [];
  tr.querySelectorAll('.gf-i').forEach((d) => {
    // (une note porte son etiquette au debut de sa phrase depuis le 2026-11-06 : le texte
    // se lit sans elle, et une ligne se compte une fois meme si l etiquette depasse d un
    // pixel le texte qui la suit)
    const etiquette = d.querySelector('span');
    const mot = etiquette.textContent;
    const p = d.querySelector('p');
    const portee = document.createRange();
    portee.selectNodeContents(p);
    const hauts = Array.from(portee.getClientRects()).map((x) => x.top).sort((a, b) => a - b);
    const lignes = hauts.filter((t, i) => i === 0 || t - hauts[i - 1] > 6).length;
    ordre.push(mot);
    const texte = p.contains(etiquette) ? p.textContent.slice(p.textContent.indexOf(mot) + mot.length).trim() : p.textContent;
    rub[mot] = { texte, lignes, coupe: p.scrollHeight > p.clientHeight + 1, taille: parseFloat(getComputedStyle(etiquette).fontSize), bulle: p.getAttribute('title') };
  });
  return { rub, ordre, hauteur: Math.round(tr.getBoundingClientRect().height), formule: tr.querySelector('td.gf-f').textContent.replace(/\s+/g, ' '), reste: tr.querySelector('td.gf-reste').textContent.replace(/\s+/g, ' ').trim(), id: tr.getAttribute('data-gf-id') };
}, nom);
async function dossier(browser) {
  await avec(browser, { lettre: 'I', avantChargement: (page) => page.addInitScript(dossiers) }, async (page) => {
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.gf-i--fiche')).length > 0, null, { timeout: 8000 }).catch(() => null);
    await FX.repos(page, 150);
    const l = await rubriquesDe(page, 'Camille');
    ok(l.ordre.join() === 'Note du client,Note de l’équipe,Fiche,Table,Sur mesure,Prix', '[I] chaque rubrique a son libelle en toutes lettres, dans l ordre', l.ordre);
    const rub = l.rub;
    ok(/^Allergie Un enfant allergique aux arachides\.$/.test((rub['Note du client'] || {}).texte || ''), '[I] Note du client : le mot du client, l allergie en tete', rub['Note du client']);
    ok(/Bougies au bar à 17:00/.test((rub['Note de l’équipe'] || {}).texte || '') && /Julie/.test((rub['Note de l’équipe'] || {}).texte || '') && !/252/.test((rub['Note de l’équipe'] || {}).texte || ''), '[I] Équipe : la note et son auteur, sans la note de prix', rub['Équipe']);
    ok(((rub.Fiche || {}).texte || '') === 'Client fidèle, 3e anniversaire chez nous', '[I] Fiche : la note permanente du client, a part', rub.Fiche);
    ok(/^\d\d:\d\d à \d\d:\d\d(, .+ à \d\d:\d\d)?$/.test((rub.Table || {}).texte || ''), '[I] Table : de quand a quand, et les boissons', rub.Table);
    ok(((rub['Sur mesure'] || {}).texte || '') === '13 × Pizza margherita, Gâteau d’anniversaire', '[I] Sur mesure : quantite et nom lisibles', rub['Sur mesure']);
    ok(((rub.Prix || {}).texte || '') === '252 € au lieu de 280 €, geste commercial', '[I] Prix : le prix ajuste et sa raison', rub.Prix);
    const gerard = await rubriquesDe(page, 'Famille Gérard');
    ok(((gerard.rub.Prix || {}).texte || '') === '59 € au lieu de 69 €, carte de fidélité pleine', '[I] Prix : la derniere note du serveur donne la raison du prix du moment', gerard.rub.Prix);
    ok(/deux voitures/.test((gerard.rub['Note de l’équipe'] || {}).texte || '') && !/→|fidèle|fidélité/.test((gerard.rub['Note de l’équipe'] || {}).texte || ''), '[I] Équipe : aucune note de prix du serveur n y entre', gerard.rub['Équipe']);
    const henrard = await rubriquesDe(page, 'Famille Henrard');
    ok(!henrard.rub.Prix && !henrard.rub['Note de l’équipe'], '[I] une note de prix passee se tait : le prix est revenu au tarif', henrard.rub);
    ok(/adaptée/.test(l.formule), '[I] la formule adaptee se voit', l.formule);
    ok(/252\s*€/.test(l.reste), '[I] Reste : le montant du dossier', l.reste);
    ok(Object.values(rub).every((x) => !x.coupe && x.lignes <= 2 && x.taille >= 12), '[I] rien de coupe, deux lignes au plus, rien sous 12 px', rub);
    const texte = await texteEntier(page, `[data-gf-id="${l.id}"]`);
    ok(texte.ok, '[I] le texte de la ligne reste dans ses cases, mesure sur ses noeuds', texte);
    // L allergie, en rouge, ou qu elle soit ecrite.
    const rouge = await page.evaluate((id) => {
      const lire = (s) => String(s).match(/[0-9.]+/g).map(Number);
      const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const a = document.querySelector(`[data-gf-id="${id}"] .gf-i__a`);
      if (!a) return null;
      const s = getComputedStyle(a);
      const c = lire(s.color);
      const t = lire(getComputedStyle(a.closest('p')).color);
      const x = lum(c);
      // (en tete : rien avant elle que l etiquette d une note, « Note du client », depuis le 2026-11-06)
      const etiquette = a.parentElement.querySelector('.gf-i__mot');
      const avant = a.parentElement.textContent.split('Allergie')[0].replace(etiquette ? etiquette.textContent : '', '').trim();
      return { mot: a.textContent, poids: Number(s.fontWeight), rouge: c[0] > c[1] * 1.6 && c[0] > c[2] * 1.6, tete: avant === '', different: c.join() !== t.join(), contraste: 1.05 / (x + 0.05) };
    }, l.id);
    ok(rouge && rouge.mot === 'Allergie' && rouge.rouge && rouge.tete && rouge.different && rouge.poids >= 700 && rouge.contraste >= 4.5, '[I] l allergie : le mot Allergie, en rouge, en tete de sa rubrique', rouge);
    // Une rubrique vide ne prend aucune place.
    const vide = await page.evaluate(() => Math.min(...Array.from(document.querySelectorAll('.gf-r')).filter((tr) => !tr.querySelector('.gf-i')).map((tr) => Math.round(tr.getBoundingClientRect().height))));
    ok(vide >= 46 && vide <= 54, '[I] une ligne sans rubrique reste a 46 px', vide);
    ok(l.hauteur > vide + 60, '[I] une rubrique vide ne prend aucune place, la ligne grandit avec son contenu', { plein: l.hauteur, vide });
    // Un long mot : deux lignes, le texte entier dans la bulle.
    const long = 'Papa arrive plus tard avec le gâteau et les bougies, il faudra garder la table jusqu’à la fin de la partie de bowling et prévenir le bar pour les boissons, merci de ne pas oublier les ballons ni le ruban pour la photo de groupe.';
    await page.evaluate(([id, t]) => { const r = state.reservations.find((x) => String(x.id) === id); r.notes = t; renderStaff(); }, [l.id, long]);
    await FX.repos(page, 150);
    const lg = await page.evaluate((id) => {
      const p = document.querySelector(`[data-gf-id="${id}"] .gf-i--client p`);
      const h = parseFloat(getComputedStyle(p).lineHeight);
      return { lignes: Math.round(p.clientHeight / h), bulle: p.getAttribute('title') };
    }, l.id);
    ok(lg.lignes === 2 && lg.bulle === long, '[I] un mot long : deux lignes, pas une, le texte entier dans la bulle', lg);
    // Une allergie ecrite par l equipe ou sur la fiche se voit aussi.
    await page.evaluate((id) => { const r = state.reservations.find((x) => String(x.id) === id); r.notes = `[equipe] ${JSON.stringify({ t: 'Intolérance au lactose, voir la maman', par: 'Julie', le: '2027-01-15T16:05:00.000Z' })}`; renderStaff(); }, l.id);
    await FX.repos(page, 150);
    ok(await page.evaluate((id) => /^Note de l’équipe Allergie /.test((document.querySelector(`[data-gf-id="${id}"] .gf-i--equipe p`) || {}).textContent || ''), l.id), '[I] une allergie dans une note d equipe se voit de meme, juste apres son etiquette');
  });
}
// Pour chaque noeud de texte d une ligne : il reste dans sa case, et rien n est tronque par
// « ... » (la mesure de la coupure se fait sur le noeud, pas sur sa boite).
const texteEntier = (page, selecteur) => page.evaluate((sel) => {
  const sorties = [];
  let noeuds = 0;
  document.querySelectorAll(`${sel} > td`).forEach((td) => {
    const b = td.getBoundingClientRect();
    if (!b.width) return;
    const marcheur = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const portee = document.createRange();
      portee.selectNodeContents(n);
      const boites = Array.from(portee.getClientRects());
      if (!boites.length) continue;
      noeuds += 1;
      const g = Math.min(...boites.map((x) => x.left));
      const d = Math.max(...boites.map((x) => x.right));
      if (g < b.left - 0.5 || d > b.right + 0.5) sorties.push(`${n.nodeValue.trim().slice(0, 22)} (${td.className.split(' ')[0]}, ${Math.ceil(Math.max(b.left - g, d - b.right))} px)`);
      const el = n.parentElement;
      if (getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) sorties.push(`${n.nodeValue.trim().slice(0, 22)} coupe`);
    }
  });
  const uniques = Array.from(new Set(sorties));
  return { ok: noeuds > 0 && uniques.length === 0, noeuds, sorties: uniques.slice(0, 10) };
}, selecteur);

// ---------------------------------------------------------------------------
// [J] LA LIGNE
// ---------------------------------------------------------------------------
async function ligne(browser) {
  await avec(browser, { lettre: 'J', avantChargement: (page) => page.addInitScript(dossiers) }, async (page) => {
    const g = await page.evaluate(() => {
      const tout = (s, r = document) => Array.from(r.querySelectorAll(s));
      const lignes = tout('.gf-r');
      const tel = lignes.map((tr) => {
        const a = tr.querySelector('.gf-nom__l a.gf-nom__tel');
        const n = tr.querySelector('.gf-nom__t').getBoundingClientRect();
        const b = a ? a.getBoundingClientRect() : null;
        return { nom: tr.querySelector('.gf-nom__t').textContent, a: Boolean(a), href: a ? a.getAttribute('href') : '', meme: b ? b.top < n.bottom && b.bottom > n.top : false, cible: b ? Math.round(b.height) : 0 };
      });
      const reste = lignes.map((tr) => {
        const r = state.reservations.find((x) => String(x.id) === tr.getAttribute('data-gf-id'));
        const t = tr.querySelector('td.gf-reste').textContent.replace(/\s+/g, ' ').trim();
        return { nom: r.name, statut: r.status, prix: prixDossierConnu(r), t };
      });
      const entetes = tout('.gf-t thead th').map((th) => th.textContent.trim());
      // Une colonne d activite vide toute la journee n existe pas.
      const cols = tout('.gf-t thead th.gf-th--a').map((th) => th.textContent.trim());
      const pleines = cols.filter((c) => lignes.some((tr) => tr.querySelector(`td.gf-a[data-gf-titre="${c}"]`)));
      return {
        tel, reste, entetes, cols, pleines,
        retards: tout('.gf-r.is-retard').map((tr) => {
          const b = tr.querySelector('.gf-nom__l [data-gf-retarder]');
          const x = b ? b.getBoundingClientRect() : null;
          return { b: Boolean(b), hauteur: x ? Math.round(x.height) : 0, large: x ? Math.round(x.width) : 0, couleur: b ? getComputedStyle(b).color : '', texte: b ? b.textContent : '' };
        }),
        horsDuNom: tout('td.gf-h [data-gf-retarder]').length,
        barre: Math.round(document.querySelector('td.gf-h').getBoundingClientRect().width),
      };
    });
    ok(g.tel.length === GROUPES_DU_PIC && g.tel.every((t) => t.a && /^tel:\d+$/.test(t.href)), '[J] le telephone de chaque groupe est a cote de son nom, et se touche', g.tel.filter((t) => !t.a).slice(0, 3));
    const tete = g.tel.filter((t) => !t.meme);
    ok(tete.length === 0, '[J] le telephone est sur la ligne du nom', tete.slice(0, 3));
    ok(g.tel.every((t) => t.cible >= 32), '[J] le telephone : une cible de 32 px', g.tel.map((t) => t.cible).slice(0, 4));
    const sansMontant = g.reste.filter((r) => r.prix && !/\d\s*€/.test(r.t));
    ok(sansMontant.length === 0, '[J] le montant est toujours a droite, avant l arrivee et apres le paiement', sansMontant.slice(0, 3));
    const payes = g.reste.filter((r) => r.statut === 'paid');
    ok(payes.length > 0 && payes.every((r) => /payé/.test(r.t)), '[J] « payé » quand il l est', payes.slice(0, 3));
    ok(g.entetes.includes('Reste') && g.entetes.includes('Joueurs') && g.entetes.includes('À faire'), '[J] les colonnes Joueurs, Reste, À faire', g.entetes);
    ok(g.retards.length > 0 && g.retards.every((r) => r.b && r.hauteur >= 32 && /^\+/.test(r.texte)), '[J] le retard est sur la ligne du nom, 32 px au moins', g.retards.slice(0, 3));
    ok(g.horsDuNom === 0 && g.barre <= 4, '[J] le retard n occupe plus de colonne', { hors: g.horsDuNom, barre: g.barre });
    ok(g.retards.every((r) => { const c = r.couleur.match(/[0-9.]+/g).map(Number); return c[0] > c[1] * 1.6; }), '[J] le retard est en rouge', g.retards[0]);
    ok(g.cols.length > 0 && g.pleines.length === g.cols.length, '[J] une colonne d activite vide toute la journee est retiree', { cols: g.cols, pleines: g.pleines });
    // Le retard se touche.
    await page.locator('.gf-r.is-retard [data-gf-retarder]').first().click();
    await FX.repos(page, 100);
    const bulle = await page.evaluate(() => (document.querySelector('.staff-action-popover') || {}).textContent || '');
    ok(/Ils arrivent dans/.test(bulle), '[J] le retard se touche : « Ils arrivent dans »', bulle);
    await page.evaluate(() => closeStaffFloatingMenus());
    // « Payé » se lit comme un etat, a la teinte de son statut, et depuis le 2026-11-03
    // (Movsar : « on doit pouvoir appuyer et que ça mette direct sur confirmé ou payé ou
    // autre ») il ouvre tous les statuts, celui du dossier coche.
    const paye = await page.evaluate(() => {
      const e = Array.from(document.querySelectorAll('.gf-r.t-paid .gf-etat .gf-gb--statut'))[0];
      if (!e) return null;
      const lire = (s) => String(s).match(/[0-9.]+/g).map(Number);
      const c = lire(getComputedStyle(e).color);
      return { id: e.getAttribute('data-gf-statut'), texte: e.textContent.trim(), menu: e.getAttribute('aria-haspopup'), vert: c[1] > c[0] * 1.2 && c[1] > c[2] * 1.05 };
    });
    ok(paye && paye.texte === 'Payé' && paye.menu === 'menu' && paye.vert, '[J] « Payé » se lit comme un etat, en vert, et s ouvre', paye);
    if (paye) {
      await page.locator(`.gf-gb--statut[data-gf-statut="${paye.id}"]`).click();
      await FX.repos(page, 100);
      const liste = await page.evaluate(() => { const b = document.querySelector('.staff-action-popover'); return b ? Array.from(b.querySelectorAll('button')).map((x) => x.textContent.trim() + (x.classList.contains('is-actuel') ? ' *' : '')) : []; });
      const actuel = liste.filter((t) => t.endsWith(' *'));
      ok(['Confirmé', 'Arrivé', 'Payé carte', 'Payé espèces'].every((t) => liste.some((x) => x.replace(' *', '') === t)) && actuel.length === 1 && /^Payé /.test(actuel[0]), '[J] la liste des statuts : Confirmé, Arrivé, Payé carte ou espèces, le sien coche', liste);
      await page.evaluate(() => closeStaffFloatingMenus());
    }
    // Chaque ligne a sa fleche, toujours a la meme place.
    const fleches = await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('.gf-r [data-gf-statut]')).map((b) => Math.round(innerWidth - b.getBoundingClientRect().right)))));
    ok(fleches.length === 1, '[J] la fleche du statut, au meme bord sur chaque ligne', fleches);
    // Un statut qui change ne deplace aucune ligne (le detail est dans planning-grand-tableau).
    const ordre = () => page.evaluate(() => Array.from(document.querySelectorAll('.gf-r')).map((tr) => tr.getAttribute('data-gf-id')).join());
    const o0 = await ordre();
    await page.locator('.gf-r.is-premier [data-gf-arrive]').click();
    await FX.repos(page, 250);
    ok((await ordre()) === o0, '[J] « Arrivé » ne deplace aucune ligne');
  });
  // Moins d activites ce jour-la : Groupe prend la place.
  const largeur = (page) => page.evaluate(() => ({ groupe: Math.round(document.querySelector('.gf-t thead th.gf-th--nom').getBoundingClientRect().width), cols: document.querySelectorAll('.gf-t thead th.gf-th--a').length }));
  let pic = null;
  await avec(browser, { lettre: 'J' }, async (page) => { pic = await largeur(page); });
  await avec(browser, { lettre: 'J', fixture: 'calme' }, async (page) => {
    const calme = await largeur(page);
    ok(calme.cols < pic.cols && calme.groupe >= pic.groupe + (pic.cols - calme.cols) * 60, '[J] les colonnes retirees rendent leur largeur a Groupe', { pic, calme });
  });
  // Un autre jour : la colonne « À faire » n est plus vide.
  await avec(browser, { lettre: 'J', avantChargement: (page) => page.addInitScript(dossiers) }, async (page) => {
    await voisins(page);
    await page.evaluate(() => { shiftDate(1); });
    await page.waitForFunction(() => document.querySelectorAll('.gf-r').length > 0 && !document.querySelector('.gf-now'), null, { timeout: 8000 }).catch(() => null);
    await FX.repos(page, 200);
    const j = await page.evaluate(() => {
      const lignes = Array.from(document.querySelectorAll('.gf-r'));
      // (un etat ecrit, « Ils sont 10 », ou « Payé » qui ouvre les statuts : pas un groupe attendu)
      const attendus = lignes.filter((tr) => !tr.querySelector('td.gf-etat .gf-gb--etat, td.gf-etat .gf-gb--statut'));
      return { n: lignes.length, vides: lignes.filter((tr) => !tr.querySelector('td.gf-etat').textContent.trim()).length, attendus: attendus.length, tel: attendus.filter((tr) => tr.querySelector('td.gf-etat a[href^="tel:"]')).length, montants: lignes.filter((tr) => /\d\s*€/.test(tr.querySelector('td.gf-reste').textContent)).length };
    });
    ok(j.n === GROUPES_DU_PIC && j.vides === 0 && j.attendus > 20 && j.tel === j.attendus, '[J] un autre jour, « À faire » montre le telephone', j);
    ok(j.montants >= j.n - 4, '[J] un autre jour, le montant reste a droite', j);
  });
}

// ---------------------------------------------------------------------------
// [K] LES COULEURS
// ---------------------------------------------------------------------------
async function couleurs(browser) {
  await avec(browser, { lettre: 'K' }, async (page) => {
    const lum = `const lum = (s) => { const c = String(s).match(/[0-9.]+/g).map(Number); const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };`;
    // Une activite en cours : sa pastille, du gras sur un fond doux, le plus gros aplat n est
    // plus elle. La case reste nue, comme celle d a cote (2026-11-07, Ansar : « moi je veux
    // que ce soit que les heures »).
    const c = await page.evaluate((code) => {
      const lire = new Function(`${code} return lum;`)();
      const e = Array.from(document.querySelectorAll('.gf-x.is-encours'));
      const p = e.map((x) => x.querySelector('.gf-x__t')).filter(Boolean);
      const vide = getComputedStyle(document.querySelector('.gf-r td.gf-a.is-vide')).backgroundColor;
      const nue = (x) => { const s = getComputedStyle(x), td = getComputedStyle(x.closest('td')); return /^rgba\(0, 0, 0, 0\)$/.test(s.backgroundColor) && s.backgroundImage === 'none' && s.boxShadow === 'none' && td.backgroundColor === vide && td.backgroundImage === 'none'; };
      return { n: e.length, pastilles: p.length, doux: p.every((t) => lire(getComputedStyle(t).backgroundColor) > 0.6), gras: p.every((t) => Number(getComputedStyle(t).fontWeight) >= 700), nues: e.filter(nue).length };
    }, lum);
    ok(c.n > 0 && c.pastilles === c.n && c.doux && c.gras, '[K] une activite en cours : sa pastille, du gras sur un fond doux', c);
    ok(c.n > 0 && c.nues === c.n, '[K] une activite en cours ne peint pas sa case : seule l heure', c);
    // Le seul bouton plein : le retard le plus recent, pas le plus ancien.
    const p = await page.evaluate(() => {
      const min = (t) => { const m = /^\+(?:(\d+) min|(\d+)h(\d{2}))$/.exec(t || ''); return m ? (m[1] ? Number(m[1]) : Number(m[2]) * 60 + Number(m[3])) : NaN; };
      const lignes = Array.from(document.querySelectorAll('.gf-r.is-retard')).filter((tr) => tr.querySelector('[data-gf-arrive]'));
      const pleins = Array.from(document.querySelectorAll('.gf-gb--arrive')).filter((b) => getComputedStyle(b).backgroundColor === getComputedStyle(document.querySelector('.gf-r.is-premier .gf-gb--arrive')).backgroundColor);
      const retards = lignes.map((tr) => min(tr.querySelector('[data-gf-retard]').textContent));
      return { retards, premier: min((document.querySelector('.gf-r.is-premier [data-gf-retard]') || {}).textContent), pleins: pleins.length };
    });
    ok(p.retards.length > 1 && p.premier === Math.min(...p.retards) && p.pleins === 1, '[K] le seul bouton plein va au retard le plus recent', p);
    // La legende, de la couleur de ce qui est a l ecran, en clair et en sombre.
    for (const theme of ['clair', 'sombre']) {
      if (theme === 'sombre') { await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await FX.repos(page, 200); }
      const statuts = await page.evaluate(() => {
        // (trois lignes de statuts differents, sans dependre de l heure)
        const leg = (c) => getComputedStyle(document.querySelector(`#planningBande .gf-leg${c}`)).backgroundColor;
        const o = {};
        [['conf', '', '.t-conf'], ['arr', '.t-arr', '.t-arr'], ['paid', '.t-paid', '.t-paid']].forEach(([cle, l, s]) => {
          const td = document.querySelector(`.gf-r${s} td.gf-h`);
          o[cle] = { legende: leg(l), tableau: td ? getComputedStyle(td).backgroundColor : null };
        });
        return o;
      });
      ok(Object.values(statuts).every((x) => x.tableau && x.legende === x.tableau), `[K] ${theme}, Complet : la legende a les couleurs du tableau`, statuts);
      await aller(page, 'bowling');
      const bo = await page.evaluate(() => {
        const leg = (c) => getComputedStyle(document.querySelector(`#planningBande .gf-leg${c}`)).backgroundColor;
        const o = {};
        [['conf', '', '.booking:not(.arr):not(.paid):not(.is-passee):not(.is-delayed)'], ['arr', '.t-arr', '.booking.arr:not(.is-passee):not(.is-delayed)'], ['paid', '.t-paid', '.booking.paid:not(.is-passee):not(.is-delayed)']].forEach(([cle, l, s]) => {
          const b = document.querySelector(s);
          o[cle] = { legende: leg(l), carte: b ? getComputedStyle(b).borderLeftColor : null };
        });
        return o;
      });
      ok(Object.values(bo).every((x) => x.carte && x.legende === x.carte), `[K] ${theme}, Bowling : la legende a les couleurs des cartes`, bo);
      await aller(page, 'laser');
      const la = await page.evaluate(() => {
        const leg = (c) => getComputedStyle(document.querySelector(`#planningBande .gf-leg${c}`)).backgroundColor;
        const peint = (el) => { const i = document.createElement('i'); i.style.color = getComputedStyle(el).getPropertyValue('--lp-c'); document.body.appendChild(i); const c = getComputedStyle(i).color; i.remove(); return c; };
        const o = {};
        [['conf', '', '.lp .st-conf:not(.is-alt)'], ['arr', '.t-arr', '.lp .st-arr:not(.is-alt)'], ['paid', '.t-paid', '.lp .st-paid:not(.is-alt)']].forEach(([cle, l, s]) => {
          const b = document.querySelector(s);
          o[cle] = { legende: leg(l), carte: b ? peint(b) : null };
        });
        return o;
      });
      ok(Object.values(la).every((x) => x.carte && x.legende === x.carte), `[K] ${theme}, Laser : la legende a les couleurs des cartes`, la);
      await aller(page, 'all');
    }
  });
}

// ---------------------------------------------------------------------------
// [L] LES MOTS
// ---------------------------------------------------------------------------
const BANNIS = [
  [/\bArrivés? · /, '« Arrivé · N »'],
  [/\bIls sont là\b/, '« Ils sont là »'],
  [/Planning global/i, '« Planning global »'],
  [/^Toutes( les activités)?$/, '« Toutes »'],
  [/\bpers\.(\s|$)/, '« pers. »'],
  [/\bP\d{1,2}(-\d{1,2})?\b(?!\/)/, '« P1-2 »'],
  [/≈/, '« ≈ »'],
  [/cr\.\/enf\./, '« cr./enf. »'],
  [/Réservation rapide/, '« Réservation rapide »'],
  [/Rés\. rapide/, '« Rés. rapide »'],
];
const motsVisibles = (page) => page.evaluate(() => {
  const vus = new Set();
  const racines = [document.getElementById('staffView'), document.querySelector('.ops-sidebar'), ...document.querySelectorAll('.staff-action-popover, .fgx-menu-popover')].filter(Boolean);
  racines.forEach((racine) => {
    const m = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
    for (let n = m.nextNode(); n; n = m.nextNode()) {
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (t && n.parentElement.getClientRects().length && getComputedStyle(n.parentElement).visibility !== 'hidden') vus.add(t);
    }
    racine.querySelectorAll('[title], [aria-label]').forEach((e) => { ['title', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v && e.getClientRects().length) vus.add(v.replace(/\s+/g, ' ').trim()); }); });
  });
  return Array.from(vus);
});
async function mots(browser) {
  await avec(browser, { lettre: 'L', avantChargement: (page) => page.addInitScript(dossiers) }, async (page) => {
    const balayer = async (ou) => {
      const textes = await motsVisibles(page);
      BANNIS.forEach(([re, nom]) => {
        const trouves = textes.filter((t) => re.test(t));
        ok(trouves.length === 0, `[L] ${ou} : plus de ${nom}`, trouves.slice(0, 4));
      });
      return textes;
    };
    // Un groupe de chaque sorte, pour que chaque mot ait sa chance de sortir.
    for (const vue of VUES) {
      await aller(page, vue);
      await balayer(vue);
      await menuPlus(page);
      await balayer(`${vue}, menu « ⋯ »`);
      await page.evaluate(() => closeStaffFloatingMenus());
    }
    await aller(page, 'all');
    // Le nom de l ecran, partout.
    await page.evaluate(() => { document.documentElement.style.setProperty('--sonde', '1'); });
    const titres = await page.evaluate(() => ({ h1: document.querySelector('#planningBarre h1').textContent.replace(/\s+/g, ' ').trim(), bouton: document.getElementById('staffTabAll').textContent.replace(/\d+/g, '').trim(), reserver: document.getElementById('planningReserver').textContent.replace(/\s+/g, ' ').trim() }));
    ok(titres.bouton === 'Complet' && titres.reserver === '+ Réservation', '[L] « Complet », « + Réservation »', titres);
    await page.locator('[data-fgx-menu-toggle="planning"]').first().hover();
    await page.locator('[data-fgx-menu-toggle="planning"]').first().click();
    await FX.repos(page, 200);
    const pop = await page.evaluate(() => (document.querySelector('.fgx-menu-popover.planning') || {}).textContent || '');
    ok(/Complet/.test(pop) && !/Toutes/.test(pop), '[L] le menu de gauche dit « Complet »', pop.replace(/\s+/g, ' ').slice(0, 100));
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 500).catch(() => null);
    await page.evaluate(() => { closePos(); closeQuickBook(); closeStaffFloatingMenus(); });
    await FX.repos(page, 200);
    // La fenetre de reservation s appelle Réservation.
    await page.locator('#planningReserver').click();
    await FX.repos(page, 250);
    const fenetre = await page.evaluate(() => {
      const o = document.getElementById('quickBookOverlay');
      const t = o.querySelector('h1, h2, h3, [id$="Title"], .rv-titre');
      return { titre: t ? t.textContent.trim() : '', texte: o.textContent.replace(/\s+/g, ' ').slice(0, 80) };
    });
    ok(/^Réservation\b/.test(fenetre.titre) && !/rapide/i.test(fenetre.texte), '[L] la fenetre s appelle « Réservation »', fenetre);
    await page.evaluate(() => closeQuickBook());
    await FX.repos(page, 150);
    // Les mots des cases : entiers, en noir, 13 px au moins.
    const cases = await page.evaluate(() => {
      const tout = (s) => Array.from(document.querySelectorAll(s));
      const pistes = tout('.gf-x__d').filter((e) => /Pistes? \d/.test(e.textContent));
      const lire = (s) => String(s).match(/[0-9.]+/g).map(Number);
      return {
        pistes: pistes.length,
        tailles: Math.min(...pistes.map((e) => parseFloat(getComputedStyle(e).fontSize))),
        noires: pistes.filter((e) => !e.closest('.is-fini')).every((e) => { const s = getComputedStyle(e).color; const c = lire(s); return c[0] + c[1] + c[2] < 3 * 110 && s === getComputedStyle(e.closest('.gf-x')).color; }),
        vers: tout('.gf-x.is-libre').map((e) => e.textContent).slice(0, 3),
        credits: tout('.gf-x.is-credit').map((e) => e.textContent).slice(0, 3),
        joueurs: tout('.gf-bloc__in span').filter((e) => /joueur/.test(e.textContent)).length,
      };
    });
    ok(cases.pistes > 0 && cases.tailles >= 13 && cases.noires, '[L] « Pistes 1-2 » : le mot entier, 13 px au moins, en noir', cases);
    ok(cases.vers.length > 0 && cases.vers.every((t) => /^vers \d\d:\d\d/.test(t)), '[L] « vers 15:30 », pas « ≈ »', cases.vers);
    ok(cases.credits.length > 0 && cases.credits.every((t) => /crédits/.test(t)), '[L] « 8 crédits », pas « cr. »', cases.credits);
    ok(cases.joueurs > 0, '[L] « joueurs », dans la case d heure', cases);
    // Les accompagnants et le nombre reserve, en toutes lettres.
    const compte = await page.evaluate(() => {
      const r = state.reservations.find((x) => /Clara/.test(x.name));
      r.companions = 3;
      renderStaff();
      return document.querySelector(`[data-gf-id="${r.id}"] td.gf-n`).textContent.replace(/\s+/g, ' ');
    });
    ok(/et 3 accomp\./.test(compte) && !/\+3/.test(compte), '[L] « et 3 accomp. », pas « +3 »', compte);
    // « Arrivé » : un seul mot pour un seul geste, partout.
    const ap = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.gf-gb--arrive'));
      return Array.from(new Set(b.map((x) => x.textContent)));
    });
    ok(ap.length === 1 && ap[0] === 'Arrivé', '[L] un seul mot pour le geste : Arrivé', ap);
    await aller(page, 'laser');
    const laser = await page.evaluate(() => Array.from(document.querySelectorAll('#laserPlanningBox button')).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /^(Arriv|Ils sont)/.test(t)));
    ok(laser.length > 0 && laser.every((t) => /^(Arrivé|Ils sont \d+)$/.test(t)), '[L] au laser aussi : « Arrivé », « Ils sont N »', Array.from(new Set(laser)).slice(0, 6));
    await aller(page, 'all');
    await page.locator('.gf-r .gf-nom__t').first().click();
    await FX.repos(page, 250);
    await balayer('la fiche');
  });
}

// ---------------------------------------------------------------------------
// [M] LE COMPORTEMENT
// ---------------------------------------------------------------------------
const puces = (page) => page.evaluate(() => {
  const o = {};
  document.querySelectorAll('#resList .status-chip').forEach((b) => { const m = /^(.*?)\s*(\d+)$/.exec(b.textContent.replace(/\s+/g, ' ').trim()); if (m) o[m[1]] = Number(m[2]); });
  return o;
});
const compteurs = (page) => page.evaluate(() => {
  const o = {};
  document.querySelectorAll('#planningBande [data-gf-filtre]').forEach((e) => { const v = e.querySelector('.gf-c__v'); if (v) o[e.querySelector('.gf-c__l').textContent] = Number(v.textContent); });
  return o;
});
async function comportement(browser) {
  await avec(browser, { lettre: 'M' }, async (page) => {
    // La barre de l heure au tiers haut de l ecran.
    const lire = () => page.evaluate(() => {
      const d = document.querySelector('.gf-defile');
      const b = d.getBoundingClientRect();
      const hTete = d.querySelector('thead').getBoundingClientRect().height;
      const n = d.querySelector('.gf-now').getBoundingClientRect();
      const lignes = Array.from(d.querySelectorAll('.gf-r')).map((tr) => tr.getBoundingClientRect());
      const haut = b.top + hTete;
      const bas = Math.min(b.bottom, innerHeight);
      return { rang: (n.top - haut) / (bas - haut), dessus: lignes.filter((l) => l.top >= haut - 1 && l.bottom <= n.top + 1).length, dessous: lignes.filter((l) => l.top >= n.bottom - 1 && l.bottom <= bas + 1).length, coupee: lignes.filter((l) => l.top < haut - 1 && l.bottom > haut + 1).length };
    });
    const o = await lire();
    ok(o.rang > 0.05 && o.rang <= 0.45, '[M] a l ouverture, la barre de l heure est au tiers haut', o);
    ok(o.dessous >= o.dessus, '[M] on voit d abord qui arrive', o);
    ok(o.coupee === 0, '[M] aucune ligne coupee sous la tete', o);
    // Un seul chiffre pour une meme chose.
    const memes = async (ou) => {
      const c = await compteurs(page);
      const p = await puces(page);
      const faux = ['En retard', 'À venir', 'Sur place', 'À clôturer'].filter((m) => (c[m] || 0) !== (p[m] || 0));
      ok(faux.length === 0 && Object.keys(c).length === 4, `[M] ${ou} : la barre et la liste disent le meme chiffre`, { barre: c, liste: p });
      return { c, p };
    };
    const depart = await memes('a 15:10');
    ok(depart.c['Sur place'] > 0, '[M] le montage : des groupes sur place', depart.c);
    // Payer avant les activites ne perd pas le groupe (la regle du 10/10).
    const paie = await page.evaluate(() => {
      const moments = getStaffReservationMoments(todaysReservations());
      const r = todaysReservations().find((x) => x.status === 'arrived' && moments.get(String(x.id)) && moments.get(String(x.id)).etat === 'onsite');
      if (!r) return null;
      r.status = 'paid';
      r.paymentMethod = 'card';
      renderStaff();
      return String(r.id);
    });
    await FX.repos(page, 200);
    const apres = await memes('un groupe qui paie avant de jouer');
    ok(paie && apres.c['Sur place'] === depart.c['Sur place'], '[M] payer avant les activites ne perd pas le groupe', { avant: depart.c, apres: apres.c });
    // Sa visite finie a l heure et rien de coche, la liste le garde a suivre (la regle du
    // 10/10) : la barre dit le meme chiffre, sa ligne se lit comme partie.
    const fini = await page.evaluate(() => {
      const moments = getStaffReservationMoments(todaysReservations());
      const r = todaysReservations().find((x) => x.status === 'paid' && moments.get(String(x.id)) && moments.get(String(x.id)).etat === 'onsite' && getStaffTerrainSpan(x).end <= currentTimeDecimal());
      if (!r) return null;
      return { nom: r.name, partie: document.querySelector(`.gf-r[data-gf-id="${r.id}"]`).classList.contains('is-parti') };
    });
    ok(fini && fini.partie, '[M] paye, sa visite finie, rien de coche : sa ligne se lit comme partie', fini);
    await memes('une visite finie et payee');
    // Un jour passe, le meme chiffre.
    await voisins(page);
    await page.evaluate(() => {
      window.__FIXTURE__.jours[Object.keys(window.__FIXTURE__.jours).sort()[0]].forEach((r) => { if (r.status === 'arrived') r.status = 'paid'; });
      shiftDate(-1);
    });
    await page.waitForFunction(() => document.querySelectorAll('.gf-r').length > 0 && state.currentDate < todayStr(), null, { timeout: 8000 }).catch(() => null);
    await FX.repos(page, 400);
    await memes('la veille');
  });
  // L arrivee n est pas le debut : la fiche dit laquelle est laquelle.
  await avec(browser, { lettre: 'M' }, async (page) => {
    const l = await page.evaluate(() => {
      const r = state.reservations.find((x) => getStaffTerrainSpan(x).start < timeToNum(x.startTime) - 0.05);
      return r ? { id: String(r.id), debut: r.startTime.slice(0, 5) } : null;
    });
    ok(Boolean(l), '[M] le montage : un groupe accueilli avant son heure', l);
    const ligneHeure = await page.evaluate((id) => document.querySelector(`.gf-r[data-gf-id="${id}"] td.gf-h`).getAttribute('data-gf-heure'), l.id);
    ok(ligneHeure === l.debut, '[M] le tableau dit l heure reservee', { ligneHeure, l });
    await page.evaluate((id) => openPos(Number(id)), l.id);
    await FX.repos(page, 250);
    const tete = await page.evaluate(() => document.getElementById('posOverlay').textContent.replace(/\s+/g, ' '));
    ok(new RegExp(`Arrivée \\d\\d:\\d\\d, début ${l.debut} → \\d\\d:\\d\\d`).test(tete), '[M] la fiche distingue l arrivee du debut', tete.slice(0, 200));
    await page.evaluate(() => closePos());
  });
}

// ---------------------------------------------------------------------------
// [N] LES PETITS ECRANS
// ---------------------------------------------------------------------------
const lirePetit = (page) => page.evaluate(() => {
  const iw = innerWidth;
  const cibles = ['#staffTabAll', '#staffTabBowling', '#staffTabLaser', '#staffPrevDateBtn', '#staffDateShort', '#staffNextDateBtn', '#globalPlanningSearchInput', '#planningReserver', '#planningAgrandir', '#planningPlus']
    .map((s) => document.querySelector(s)).filter((e) => e && e.getClientRects().length)
    .map((e) => { const b = e.getBoundingClientRect(); return { nom: e.id, g: Math.round(b.left), d: Math.round(b.right), h: Math.round(b.height), l: Math.round(b.width), haut: Math.round(b.top) }; });
  const boites = cibles.map((c) => ({ ...c, b: c.haut + c.h }));
  const chevauchements = [];
  boites.forEach((a, i) => boites.slice(i + 1).forEach((b) => { if (a.g < b.d && b.g < a.d && a.haut < b.b && b.haut < a.b) chevauchements.push(`${a.nom}/${b.nom}`); }));
  return { iw, cibles, chevauchements, debord: document.documentElement.scrollWidth - document.documentElement.clientWidth, bandeBas: Math.round(document.getElementById('planningBande').getBoundingClientRect().bottom), bandeTaches: Array.from(document.querySelectorAll('#planningBande button')).filter((b) => b.getClientRects().length).map((b) => Math.round(b.getBoundingClientRect().height)) };
});
async function petitsEcrans(browser) {
  for (const appareil of ['telephone', 'tablette-portrait', 'tablette']) {
    await avec(browser, { lettre: 'N', appareil, avantChargement: (page) => page.addInitScript(() => { window.__sansRemiseEnHaut = true; }) }, async (page) => {
      const refs = {};
      for (const vue of VUES) {
        await page.evaluate((s) => document.querySelector(s).click(), ONGLET[vue]);
        await FX.repos(page, 250);
        await page.evaluate(() => window.scrollTo(0, 0));
        await FX.repos(page, 100);
        const p = await lirePetit(page);
        ok(p.cibles.filter((c) => /staffTab/.test(c.nom)).length === 3, `[N] ${appareil}, ${vue} : la bascule est visible`, p.cibles);
        ok(p.debord <= 0 && p.cibles.every((c) => c.g >= 0 && c.d <= p.iw), `[N] ${appareil}, ${vue} : rien ne deborde`, { debord: p.debord, cibles: p.cibles });
        ok(p.chevauchements.length === 0, `[N] ${appareil}, ${vue} : rien ne se recouvre`, p.chevauchements);
        const petites = p.cibles.filter((c) => c.h < 44);
        ok(petites.length === 0, `[N] ${appareil}, ${vue} : 44 px au doigt`, petites);
        ok(p.bandeTaches.every((h) => h >= 44), `[N] ${appareil}, ${vue} : 44 px sur la ligne 2`, p.bandeTaches);
        const pos = JSON.stringify(p.cibles.map((c) => [c.nom, c.g, c.haut, c.l, c.h]));
        if (!refs.pos) refs.pos = pos;
        ok(pos === refs.pos, `[N] ${appareil}, ${vue} : le meme ordre, aux memes coordonnees`, { pos, ref: refs.pos });
      }
      if (appareil === 'telephone') {
        const b = await page.evaluate(() => {
          document.getElementById('staffTabBowling').click();
          window.scrollTo(0, 0);
          return null;
        }).then(() => FX.repos(page, 300)).then(() => page.evaluate(() => {
          const boite = document.getElementById('planningBox').getBoundingClientRect();
          const barre = document.getElementById('planningBarre').getBoundingClientRect();
          return { haut: Math.round(boite.top), barre: Math.round(barre.bottom) };
        }));
        ok(b.haut <= 220 && b.haut >= b.barre - 1, '[N] telephone : Bowling commence sous la barre compacte, en haut de l ecran', b);
        // Le Complet ne garde pas de rangee vide pour le « ⋯ ».
        await page.evaluate(() => document.getElementById('staffTabAll').click());
        await FX.repos(page, 300);
        const r = await page.evaluate(() => {
          const seg = document.querySelector('.pb-seg').getBoundingClientRect();
          const plus = document.getElementById('planningPlus').getBoundingClientRect();
          const l = document.querySelector('#planningBarre .pb-ligne').getBoundingClientRect();
          const date = document.querySelector('.pb-date').getBoundingClientRect();
          return { memeRangee: Math.abs(seg.top - plus.top) <= 1, hauteur: Math.round(l.height), date: Math.round(date.bottom), l: Math.round(l.bottom) };
        });
        ok(r.memeRangee && r.hauteur <= 92 && r.date === r.l, '[N] telephone : deux rangees compactes, le « ⋯ » a cote de la bascule, pas de rangee vide', r);
        // La carte ouverte sur l heure ne passe pas sous la barre collee.
        await page.evaluate(() => { const w = document.getElementById('globalPlanningGridWrap'); w._gfRegle = null; document.querySelector('.gf-now').previousElementSibling.scrollIntoView({ block: 'start' }); });
        await FX.repos(page, 200);
        const c = await page.evaluate(() => {
          const barre = document.getElementById('planningBarre').getBoundingClientRect();
          const ligne = document.querySelector('.gf-now').previousElementSibling.getBoundingClientRect();
          return { barre: Math.round(barre.bottom), ligne: Math.round(ligne.top) };
        });
        ok(c.ligne >= c.barre - 1, '[N] telephone : une carte amenee en haut passe sous la barre, pas dessous', c);
        // Agrandir est au menu, et le menu dit Réduire une fois agrandi.
        await page.evaluate(() => document.getElementById('planningPlus').click());
        await FX.repos(page, 120);
        const texte = await page.evaluate(() => (document.querySelector('.staff-action-popover') || {}).textContent || '');
        ok(/Agrandir le planning/.test(texte), '[N] telephone : Agrandir vit dans le menu', texte.slice(0, 100));
        await page.evaluate(() => Array.from(document.querySelectorAll('.staff-action-popover button')).find((b) => /Agrandir/.test(b.textContent)).click());
        await FX.repos(page, 250);
        ok(await page.evaluate(() => document.body.classList.contains('pb-agrandi')), '[N] telephone : le menu agrandit');
        await page.evaluate(() => document.getElementById('planningPlus').click());
        await FX.repos(page, 120);
        const texte2 = await page.evaluate(() => (document.querySelector('.staff-action-popover') || {}).textContent || '');
        ok(/Réduire le planning/.test(texte2), '[N] telephone : le menu dit Réduire', texte2.slice(0, 100));
        await page.evaluate(() => closeStaffFloatingMenus());
      }
    });
  }
}

// ---------------------------------------------------------------------------
// [O] LA LISIBILITE
// ---------------------------------------------------------------------------
// (l ancien test, 17 groupes a l ecran, est tombe le 2026-11-03 : Movsar prefere tout le
// dossier sur la ligne a beaucoup de lignes)
async function lisibilite(browser) {
  for (const appareil of ['comptoir', 'grandEcran', 'petitPc']) {
    // Un jour normal : six groupes entiers au moins, sur tous les ecrans.
    await avec(browser, { lettre: 'O', appareil }, async (page) => {
      const entieres = await page.evaluate(() => {
        const d = document.querySelector('.gf-defile');
        const b = d.getBoundingClientRect();
        const hTete = d.querySelector('thead').getBoundingClientRect().height;
        return Array.from(document.querySelectorAll('.gf-r')).map((tr) => tr.getBoundingClientRect()).filter((l) => l.top >= b.top + hTete - 1 && l.bottom <= Math.min(b.bottom, innerHeight) + 1).length;
      });
      ok(entieres >= 6, `[O] ${appareil} : au moins six groupes entiers a l ecran, un jour normal`, entieres);
    });
    // Le dossier le plus charge prend la place qu il faut, et tient entier a l ecran.
    await avec(browser, { lettre: 'O', appareil, avantChargement: (page) => page.addInitScript(dossiers) }, async (page) => {
      const r = await page.evaluate(() => {
        const tout = (s) => Array.from(document.querySelectorAll(s));
        const d = document.querySelector('.gf-defile');
        const b = d.getBoundingClientRect();
        const hTete = d.querySelector('thead').getBoundingClientRect().height;
        const lignes = tout('.gf-r').map((tr) => tr.getBoundingClientRect());
        return {
          plusHaute: Math.max(...lignes.map((l) => Math.round(l.height))),
          place: Math.round(Math.min(b.bottom, innerHeight) - b.top - hTete),
          min: Math.min(...lignes.map((l) => Math.round(l.height))),
          taille: Math.min(...tout('#globalPlanningGridWrap *').filter((n) => Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim())).map((n) => parseFloat(getComputedStyle(n).fontSize))),
          groupe: Math.round(document.querySelector('.gf-t thead th.gf-th--nom').getBoundingClientRect().width),
          cote: d.scrollWidth - d.clientWidth,
        };
      });
      ok(r.plusHaute <= r.place / 2, `[O] ${appareil} : le dossier le plus charge tient sur la moitie de l ecran`, r);
      ok(r.min >= 46, `[O] ${appareil} : 46 px au moins par ligne`, r);
      ok(r.taille >= 12, `[O] ${appareil} : rien sous 12 px`, r);
      ok(r.groupe >= 166, `[O] ${appareil} : Groupe garde sa largeur`, r);
      ok(r.cote <= 0, `[O] ${appareil} : pas de defilement de cote`, r);
      const t = await texteEntier(page, '.gf-r');
      ok(t.ok, `[O] ${appareil} : tout ce qui s ecrit se lit entier, mesure sur les noeuds de texte`, t);
    });
  }
}

// ---------------------------------------------------------------------------
// [P] LE CONTRASTE
// ---------------------------------------------------------------------------
function lireContraste() {
  const lire = (s) => { const m = String(s).match(/-?[0-9.]+/g).map(Number); if (/^color\(srgb/.test(s)) return { r: m[0] * 255, g: m[1] * 255, b: m[2] * 255, a: m[3] === undefined ? 1 : m[3] }; return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] }; };
  const fond = (el) => { const pile = []; for (let n = el; n; n = n.parentElement) { const c = lire(getComputedStyle(n).backgroundColor); if (c.a > 0) { pile.push(c); if (c.a >= 1) break; } } let b = pile.length ? pile[pile.length - 1] : { r: 255, g: 255, b: 255, a: 1 }; for (let i = pile.length - 2; i >= 0; i -= 1) { const c = pile[i]; b = { r: c.r * c.a + b.r * (1 - c.a), g: c.g * c.a + b.g * (1 - c.a), b: c.b * c.a + b.b * (1 - c.a), a: 1 }; } return b; };
  const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const rapport = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mauvais = {};
  let vus = 0;
  document.querySelectorAll('#planningBarre *').forEach((el) => {
    if (!Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim())) return;
    if (!el.getClientRects().length || el.closest('.pb-titre')) return;
    vus += 1;
    const v = rapport(lire(getComputedStyle(el).color), fond(el));
    if (v < 4.5) mauvais[(el.className && String(el.className).split(' ')[0]) || el.tagName] = Math.round(v * 100) / 100;
  });
  return { vus, mauvais };
}
async function contraste(browser) {
  await avec(browser, { lettre: 'P' }, async (page) => {
    await voisins(page);
    for (const theme of ['clair', 'sombre']) {
      if (theme === 'sombre') { await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await FX.repos(page, 200); }
      for (const vue of VUES) {
        await aller(page, vue);
        const r = await page.evaluate(lireContraste);
        ok(r.vus >= 12 && Object.keys(r.mauvais).length === 0, `[P] ${theme}, ${vue} : contraste 4,5:1 sur la barre`, r);
      }
      await page.locator('#staffNextDateBtn').click();
      await FX.repos(page, 250);
      const r = await page.evaluate(lireContraste);
      ok(Object.keys(r.mauvais).length === 0, `[P] ${theme}, un autre jour : contraste 4,5:1 sur la barre`, r);
      await page.locator('#planningBande .staff-today-btn').click();
      await FX.repos(page, 250);
    }
  });
}

// ---------------------------------------------------------------------------
// [Q] LA RECHERCHE
// ---------------------------------------------------------------------------
async function recherche(browser) {
  await avec(browser, { lettre: 'Q', avantChargement: (page) => page.addInitScript(dossiers) }, async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('.gf-i--fiche').length > 0, null, { timeout: 8000 }).catch(() => null);
    const lignes = () => page.evaluate(() => Array.from(document.querySelectorAll('.gf-r .gf-nom__t')).map((e) => e.textContent));
    for (const mot of ['pizza', 'arachide', 'bougies', 'fidèle']) {
      await page.locator('#globalPlanningSearchInput').fill(mot);
      await page.waitForFunction(() => document.querySelectorAll('#resList .res-row').length < 40, null, { timeout: 4000 }).catch(() => null);
      await FX.repos(page, 200);
      const l = await lignes();
      ok(l.length === 1 && /Camille/.test(l[0]), `[Q] « ${mot} » trouve le dossier, sur le tableau`, l);
      const liste2 = await page.evaluate(() => Array.from(document.querySelectorAll('#resList .res-row')).length);
      ok(liste2 === 1, `[Q] « ${mot} » : la liste du dessous suit`, liste2);
    }
    await page.locator('#globalPlanningSearchInput').fill('');
    await page.waitForFunction(() => document.querySelectorAll('#resList .res-row').length > 40, null, { timeout: 4000 }).catch(() => null);
    await FX.repos(page, 200);
    // Le champ, sa croix et la liste, sur les trois plannings.
    for (const [vue, mot, nom] of [['bowling', 'hot-dog', 'Clara'], ['laser', 'gluten', 'Manon']]) {
      await aller(page, vue);
      const croixAvant = await page.evaluate(() => document.getElementById('gfEfface').hidden);
      await page.locator('#globalPlanningSearchInput').fill(mot);
      await FX.repos(page, 700);
      const c = await page.evaluate(() => ({ croix: !document.getElementById('gfEfface').hidden, lignes: Array.from(document.querySelectorAll('#resList .res-row')).map((x) => x.textContent.replace(/\s+/g, ' ').slice(0, 60)), valeur: state.searchTerm }));
      ok(croixAvant && c.croix, `[Q] ${vue} : la croix du champ apparait`, c);
      ok(c.lignes.length === 1 && c.lignes[0].includes(nom) && c.valeur === mot, `[Q] ${vue} : la liste suit le champ de la barre, notes et extras compris`, c);
      await page.locator('#gfEfface').click();
      await FX.repos(page, 200);
      const v = await page.evaluate(() => ({ valeur: document.getElementById('globalPlanningSearchInput').value, terme: state.searchTerm, croix: document.getElementById('gfEfface').hidden, focus: document.activeElement && document.activeElement.id }));
      ok(v.valeur === '' && !v.terme && v.croix && v.focus === 'globalPlanningSearchInput', `[Q] ${vue} : la croix vide le champ et garde le curseur`, v);
      // Taper de n importe ou, sur les trois ; Entree n y pointe personne.
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
      await page.keyboard.type('Cla', { delay: 15 });
      await FX.repos(page, 220);
      ok((await page.locator('#globalPlanningSearchInput').inputValue()) === 'Cla', `[Q] ${vue} : taper de n importe ou ecrit dans le champ`);
      const avant = await page.evaluate(() => window.__FIXTURE__.patchs.length);
      await page.keyboard.press('Enter');
      await FX.repos(page, 150);
      ok((await page.evaluate(() => window.__FIXTURE__.patchs.length)) === avant, `[Q] ${vue} : Entree cherche, ne pointe personne`);
      await page.keyboard.press('Escape');
      await FX.repos(page, 150);
    }
    await aller(page, 'all');
  });
}

// ---------------------------------------------------------------------------
// [R] LES CARTES DISENT LE DOSSIER (2026-11-03, Movsar : « tout ce qui est sur mesure
// modifier ou prix ajuster tout bien visible sur le planning complet et sur les cartes
// des reservations »). Les cartes Bowling et Laser portent des marqueurs courts, chacun
// dit tout au survol ; le Terrain ecrit l equipe, le sur mesure et le prix revu. Lu sur
// l ecran, a 1366 x 768 (et le nom des cartes garde sa place a 1024).
// ---------------------------------------------------------------------------
// Deux dossiers de plus pour ce scenario : une allergie sur une carte bowling d une heure
// (le coin replie), et un groupe laser qui a tout (note d equipe, extras, prix revu).
function dossiersDesCartes() {
  const avant = Object.getOwnPropertyDescriptor(window, '__FIXTURE__');
  let valeur;
  const eq = (t, par, le, prix) => `[equipe] ${JSON.stringify(prix ? { t, par, le, type: 'prix', prix } : { t, par, le })}`;
  Object.defineProperty(window, '__FIXTURE__', {
    configurable: true,
    get() { return avant ? avant.get() : valeur; },
    set(v) {
      if (avant) avant.set(v); else valeur = v;
      const j = v.jours[v.jour];
      Object.assign(j.find((r) => /Famille Noël/.test(r.name)), { notes: 'Allergie aux arachides.' });
      const modif = (r, quoi) => { r.opsPlan = Object.assign({}, r.opsPlan || {}, { derniereModif: { le: '2027-01-16T14:05:00.000Z', par: 'Rachel', quoi } }); };
      modif(j.find((r) => /Famille Gérard/.test(r.name)), ['4 → 6 joueurs']);
      const manon = j.find((r) => /Amis de Manon/.test(r.name));
      const de = Number(manon.price) || 100;
      Object.assign(manon, {
        basePrice: de,
        price: de - 15,
        discountReason: '',
        extras: [{ id: 'nourriture-1', name: 'Pizza × 6', heure: '16:30', price: 0 }],
        opsPlan: Object.assign({}, manon.opsPlan || {}, { derniereModif: { le: '2027-01-16T14:05:00.000Z', par: 'Rachel', quoi: ['Pizza × 6 ajoutée', '17:30 → 15:30'] } }),
        notes: `${manon.notes}\n${eq('Table près de l’arène', 'Seb', '2027-01-15T14:00:00.000Z')}\n${eq(`Prix ${de} € → ${de - 15} €, anniversaire offert`, 'Seb', '2027-01-15T14:05:00.000Z', { de, a: de - 15, raison: 'anniversaire offert' })}`,
      });
    },
  });
}
// Une carte bowling, lue sur son ecran : ses marqueurs (visibles, leur nom, leur
// infobulle), sa pastille de prix, son coin, son nom.
const lireCartesBowling = (page, noms) => page.evaluate((liste) => {
  const toile = document.createElement('canvas');
  toile.width = 1; toile.height = 1;
  const g = toile.getContext('2d', { willReadFrequently: true });
  const rgb = (s) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = s; g.fillRect(0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3)); };
  const vu = (e) => Boolean(e) && e.getBoundingClientRect().width > 1 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  return [...document.querySelectorAll('#planningGridWrap .booking')].filter((c) => liste.some((n) => ((c.querySelector('.booking-name') || {}).title || '').includes(n))).map((c) => {
    const nom = c.querySelector('.booking-name');
    const rc = c.getBoundingClientRect();
    const prix = c.querySelector('.bk-price');
    const coin = c.querySelector('.bk-coin');
    const avant = getComputedStyle(c, '::before');
    return {
      nom: nom.title,
      dens: (c.className.match(/\bdens-(xs|md|lg)\b/) || [])[1] || '',
      marques: [...c.querySelectorAll('.booking-head .bk-flag')].map((f) => {
        const b = f.getBoundingClientRect();
        return { cle: ((f.getAttribute('class') || '').match(/\bflag-(\w+)/) || [])[1] || '?', vu: vu(f), nom: f.getAttribute('aria-label') || '', bulle: f.getAttribute('title') || '', titre: (f.querySelector('svg > title') || {}).textContent || '', dedans: b.left >= rc.left - 0.5 && b.right <= rc.right + 0.5 && b.top >= rc.top - 0.5 && b.bottom <= rc.bottom + 0.5, couleur: rgb(getComputedStyle(f).color), encre: rgb(getComputedStyle(c).color) };
      }),
      prix: prix && vu(prix) ? { texte: prix.textContent.trim(), bulle: prix.getAttribute('title') || '', nom: prix.getAttribute('aria-label') || '' } : null,
      coin: coin && vu(coin) ? coin.getAttribute('title') : '',
      coinPeint: avant.content !== 'none' && parseFloat(avant.borderRightWidth) > 0 ? rgb(avant.borderRightColor) : null,
      nomLarge: Math.round(nom.getBoundingClientRect().width * 10) / 10,
      nomCoupe: nom.scrollWidth > nom.clientWidth + 0.5,
      deborde: c.scrollWidth - c.clientWidth > 1 || c.scrollHeight - c.clientHeight > 1,
    };
  });
}, noms);
// (rouge, pas ambre : l ambre du prix et des notes a r = 1,6 g)
const rouge = (c) => Boolean(c) && c[0] > c[1] * 2.5 && c[0] > c[2] * 2.5;
async function cartes(browser) {
  const avantChargement = async (page) => { await page.addInitScript(dossiers); await page.addInitScript(dossiersDesCartes); };
  await avec(browser, { lettre: 'R', avantChargement }, async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('.gf-i--fiche').length > 0, null, { timeout: 8000 }).catch(() => null);
    // La couleur du prix sur la ligne du Complet : le Terrain la reprend.
    const couleurPrixComplet = await page.evaluate(() => { const p = document.querySelector('.gf-i--prix > p'); return p ? getComputedStyle(p).color : ''; });
    // La derniere modification, en rubrique de la ligne du Complet.
    const gComplet = await rubriquesDe(page, 'Famille Gérard');
    ok(!gComplet.rub['Modifié'] && !gComplet.ordre.includes('Modifié') && Object.values(gComplet.rub).every((x) => !x.coupe && x.lignes <= 2), '[R] Complet : la derniere modification ne s ecrit plus sur la ligne (2026-11-06, Ansar : « ça prend trop de place »), la fiche et les cartes la gardent', gComplet);
    await aller(page, 'bowling');
    await FX.repos(page, 300);
    const b = await lireCartesBowling(page, ['Famille Gérard', 'Amis de Clara', 'Famille Henrard', 'Famille Noël']);
    const carte = (n) => b.find((x) => x.nom.includes(n));
    const marque = (c, cle) => (c ? c.marques.find((m) => m.cle === cle) : null);
    ok(b.length >= 4 && ['Famille Gérard', 'Amis de Clara', 'Famille Henrard', 'Famille Noël'].every((n) => carte(n)), '[R] MONTAGE : les cartes bowling du dossier sont sur la grille', b.map((x) => x.nom));
    const clara = carte('Amis de Clara');
    const mClara = marque(clara, 'mesure');
    ok(Boolean(mClara) && mClara.vu && mClara.dedans && mClara.nom === 'Sur mesure : 7 × Hot-dog à 17:00' && mClara.bulle === mClara.nom, '[R] bowling : le sur mesure se voit sur la carte, son infobulle dit quoi et a quelle heure', clara);
    const gerard = carte('Famille Gérard');
    const mGerard = marque(gerard, 'equipe');
    ok(Boolean(mGerard) && mGerard.vu && mGerard.dedans && mGerard.bulle === 'Équipe : Arrivent en deux voitures (Julie)', '[R] bowling : la note de l equipe a son marqueur, son infobulle dit la note et son auteur', gerard);
    ok(Boolean(mGerard) && !/→|fidèle|fidélité|€/.test(mGerard.bulle) && !marque(gerard, 'note'), '[R] bowling : une note de prix n est ni une note d equipe ni une bulle du client', gerard);
    const mModif = marque(gerard, 'modif');
    ok(Boolean(mModif) && mModif.vu && mModif.dedans && mModif.bulle === 'Modifié 15:05, Rachel : 4 → 6 joueurs' && mModif.nom === mModif.bulle, '[R] bowling : la derniere modification a son crayon, quand, qui et quoi au survol', gerard);
    ok(Boolean(gerard && gerard.prix) && gerard.prix.texte === '59 €' && gerard.prix.bulle === 'Prix ajusté 59 €, référence 69 €, carte de fidélité pleine' && /^Prix ajusté 59 €/.test(gerard.prix.nom), '[R] bowling : la pastille du prix revu dit le prix d avant et la raison au survol', gerard && gerard.prix);
    const henrard = carte('Famille Henrard');
    ok(Boolean(henrard) && henrard.marques.length === 0 && !henrard.prix && !henrard.coin, '[R] bowling : une note de prix passee se tait aussi sur la carte', henrard);
    const noel = carte('Famille Noël');
    const mNoel = marque(noel, 'note');
    ok(Boolean(noel) && noel.dens !== 'xs' && Boolean(mNoel) && /^Allergie/.test(mNoel.nom) && noel.coin === 'Allergie · Client : Allergie aux arachides.' && rouge(noel.coinPeint), '[R] bowling : une allergie rougit le coin replie, son survol dit tout', noel);
    ok(b.every((c) => c.marques.filter((m) => m.cle === 'equipe' || m.cle === 'mesure').every((m) => m.vu ? m.couleur.join() === m.encre.join() : true)), '[R] bowling : equipe et sur mesure a l encre de la carte, lisibles sur ses trois teintes', b.map((c) => c.marques));
    ok(b.every((c) => !c.deborde && (!c.nomCoupe || c.nomLarge >= 76)), '[R] bowling : la carte ne deborde pas, un nom coupe garde 76 px', b.map((c) => `${c.nom} ${c.nomLarge}${c.nomCoupe ? ' coupe' : ''}${c.deborde ? ' DEBORDE' : ''}`));
    // Le toucher ouvre ce que la carte ouvre deja : la fiche du groupe.
    const ouvert = await page.evaluate(() => {
      const f = Array.from(document.querySelectorAll('#planningGridWrap .booking .bk-flag.flag-mesure')).find((x) => x.getBoundingClientRect().width > 1);
      if (!f) return null;
      const id = f.closest('.booking').dataset.bookingResId;
      const vrai = window.openPos;
      const vus = [];
      window.openPos = (x) => { vus.push(String(x)); };
      const b = f.getBoundingClientRect();
      const cible = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (cible) cible.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }));
      window.openPos = vrai;
      return { id, vus };
    });
    ok(Boolean(ouvert) && ouvert.vus.length === 1 && ouvert.vus[0] === ouvert.id, '[R] bowling : toucher un marqueur ouvre la fiche, comme la carte', ouvert);
    // Le laser : la carte du prochain depart, qui montre ses pictos.
    await aller(page, 'laser');
    await FX.repos(page, 300);
    const l = await page.evaluate(() => {
      const toile = document.createElement('canvas');
      toile.width = 1; toile.height = 1;
      const g = toile.getContext('2d', { willReadFrequently: true });
      const rgb = (s) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = s; g.fillRect(0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3)); };
      const hote = Array.from(document.querySelectorAll('#laserPlanningGridWrap .lp-prochain .lp-groupe')).find((x) => /Amis de Manon/.test((x.querySelector('b') || {}).textContent || ''));
      if (!hote) return null;
      const cadre = hote.getBoundingClientRect();
      return Array.from(hote.querySelectorAll('.lp-pictos [role="img"]')).map((f) => {
        const r = f.getBoundingClientRect();
        return { cle: ((f.getAttribute('class') || '').match(/\bflag-(\w+)/) || [])[1] || '?', taille: `${Math.round(r.width)}x${Math.round(r.height)}`, nom: f.getAttribute('aria-label') || '', bulle: f.getAttribute('title') || '', titre: (f.querySelector('svg > title') || {}).textContent || '', couleur: rgb(getComputedStyle(f).color), dedans: r.right <= cadre.right + 0.5 && r.left >= cadre.left - 0.5 };
      });
    });
    const lm = (cle) => (l || []).find((m) => m.cle === cle);
    ok(Array.isArray(l) && l.map((m) => m.cle).join() === 'note,mesure,equipe,modif,prix' && l.every((m) => m.taille === '13x13' && m.dedans), '[R] laser : la carte porte la note, le sur mesure, l equipe, la modification et le prix, dans cet ordre, sur la ligne du nom', l);
    ok(Boolean(lm('note')) && rouge(lm('note').couleur) && lm('note').bulle === 'Allergie · Client : Sans gluten pour deux enfants.', '[R] laser : l allergie en rouge, son survol dit tout', lm('note'));
    ok(Boolean(lm('equipe')) && lm('equipe').bulle === 'Équipe : Table près de l’arène (Seb)' && Boolean(lm('mesure')) && lm('mesure').bulle === 'Sur mesure : 6 × Pizza à 16:30' && Boolean(lm('modif')) && lm('modif').bulle === 'Modifié 15:05, Rachel : Pizza × 6 ajoutée · 17:30 → 15:30', '[R] laser : l equipe, le sur mesure et la modification disent tout au survol', l);
    ok(Boolean(lm('prix')) && /^Prix ajusté [\d ,]+ €, référence [\d ,]+ €, anniversaire offert$/.test(lm('prix').bulle) && /^Prix ajusté/.test(lm('prix').nom), '[R] laser : le prix revu dit le prix d avant et la raison au survol', lm('prix'));
    // Dans une rangee serree (deux groupes au depart), les pictos cedent : le coin replie
    // dit la note, rouge avec une allergie, et l infobulle de la carte la dit en entier.
    const serree = await page.evaluate(() => {
      const toile = document.createElement('canvas');
      toile.width = 1; toile.height = 1;
      const g = toile.getContext('2d', { willReadFrequently: true });
      const rgb = (s) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = s; g.fillRect(0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3)); };
      return Array.from(document.querySelectorAll('#laserPlanningGridWrap .lp-qui > .lp-g')).filter((x) => /Amis de Manon/.test((x.querySelector('b') || {}).textContent || '')).map((x) => {
        const a = getComputedStyle(x, '::after');
        return { coin: a.content !== 'none' && parseFloat(a.borderRightWidth) >= 8 ? rgb(a.borderRightColor) : null, bulle: x.getAttribute('title') || '' };
      });
    });
    ok(serree.some((c) => c.coin) && serree.filter((c) => c.coin).every((c) => rouge(c.coin) && /· Allergie · Client : Sans gluten pour deux enfants\.$/.test(c.bulle)), '[R] laser : dans une rangee serree, le coin replie rougit avec l allergie, l infobulle de la carte dit la note', serree);
    // Le Terrain.
    await page.evaluate(() => { openStaffMenuPage('arrivals'); });
    await page.waitForFunction(() => document.querySelectorAll('#staffUtilityPage [data-terrain-id]').length > 0, null, { timeout: 8000 }).catch(() => null);
    await FX.repos(page, 200);
    const t = await page.evaluate(() => {
      const toile = document.createElement('canvas');
      toile.width = 1; toile.height = 1;
      const g = toile.getContext('2d', { willReadFrequently: true });
      const rgb = (s) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = s; g.fillRect(0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3)); };
      const J = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
      const o = {};
      ['Famille Gérard', 'Amis de Clara', 'Famille Henrard', 'Anniversaire Camille', 'Amis de Manon'].forEach((n) => {
        const r = J.find((x) => x.name.includes(n));
        const el = r && document.querySelector(`#staffUtilityPage [data-terrain-id="${r.id}"]`);
        if (!el) { o[n] = null; return; }
        const rub = {};
        el.querySelectorAll('.terrain-rub').forEach((p) => {
          const mot = p.querySelector('.terrain-rub__mot');
          const tx = p.querySelector('.terrain-rub__t');
          rub[mot.textContent] = { texte: tx.textContent.replace(/\s+/g, ' ').trim(), taille: Math.min(parseFloat(getComputedStyle(mot).fontSize), parseFloat(getComputedStyle(tx).fontSize)), couleur: getComputedStyle(tx).color, coupe: p.scrollWidth > p.clientWidth + 1, dedans: p.getBoundingClientRect().right <= el.getBoundingClientRect().right + 0.5 };
        });
        const client = el.querySelector('.res-special-request');
        const a = el.querySelector('.terrain-allergie');
        o[n] = { forme: el.classList.contains('terrain-row') ? 'ligne' : 'carte', rub, ordre: Array.from(el.querySelectorAll('.res-special-request, .terrain-rub')).map((p) => (p.classList.contains('terrain-rub') ? p.querySelector('.terrain-rub__mot').textContent : 'Client')), client: client ? client.textContent.replace(/\s+/g, ' ').trim() : '', allergie: a ? { mot: a.textContent, couleur: rgb(getComputedStyle(a).color), poids: Number(getComputedStyle(a).fontWeight) } : null };
      });
      return o;
    });
    const tg = t['Famille Gérard'];
    ok(Boolean(tg) && (tg.rub['Équipe'] || {}).texte === 'Arrivent en deux voitures Julie' && (tg.rub.Prix || {}).texte === '59 € au lieu de 69 €, carte de fidélité pleine', '[R] Terrain : la derniere note de l equipe avec son auteur, et le prix revu avec sa raison', tg);
    ok(Boolean(tg) && (tg.rub.Prix || {}).couleur === couleurPrixComplet && couleurPrixComplet !== '', '[R] Terrain : le prix revu a la couleur du prix du Complet', { terrain: tg && (tg.rub.Prix || {}).couleur, complet: couleurPrixComplet });
    ok(Boolean(t['Amis de Clara']) && (t['Amis de Clara'].rub['Sur mesure'] || {}).texte === '7 × Hot-dog à 17:00', '[R] Terrain : le sur mesure avec ses heures', t['Amis de Clara']);
    ok(Boolean(t['Famille Henrard']) && Object.keys(t['Famille Henrard'].rub).length === 0, '[R] Terrain : une note de prix passee se tait', t['Famille Henrard']);
    const tc = t['Anniversaire Camille'];
    ok(Boolean(tc) && tc.ordre.join() === 'Client,Équipe,Sur mesure,Prix' && (tc.rub['Équipe'] || {}).texte === 'Bougies au bar à 17:00 Julie' && (tc.rub['Sur mesure'] || {}).texte === 'formule adaptée, 13 × Pizza margherita, Gâteau d’anniversaire' && (tc.rub.Prix || {}).texte === '252 € au lieu de 280 €, geste commercial', '[R] Terrain : le mot du client, puis l equipe, le sur mesure et le prix, dans l ordre', tc);
    ok(Boolean(tc && tc.allergie) && tc.allergie.mot === 'Allergie' && rouge(tc.allergie.couleur) && tc.allergie.poids >= 600 && /^Allergie Un enfant allergique/.test(tc.client), '[R] Terrain : l allergie du client en rouge, devant son mot', tc && { allergie: tc.allergie, client: tc.client });
    ok(Object.values(t).filter(Boolean).every((x) => Object.values(x.rub).every((r) => r.taille >= 12 && !r.coupe && r.dedans)), '[R] Terrain : rien sous 12 px, rien de coupe ni hors de sa carte', t);
    // La liste du jour (page Reservations) : une ligne de rubriques, comme le Complet. Le
    // mois se lit par /api/admin-range : la journee du pic y est servie a chaque date.
    await page.evaluate(() => {
      const F = window.__FIXTURE__;
      const r = getStaffReservationsRange();
      for (let d = r.previousMonthStart; d <= r.gridEnd; d = addDays(d, 1)) F.jours[d] = F.jours[F.jour];
      openStaffMenuPage('reservations');
    });
    await page.waitForFunction(() => document.querySelectorAll('#staffReservationsPage .pv2-flow-item').length > 5, null, { timeout: 10000 }).catch(() => null);
    await FX.repos(page, 200);
    const jour = await page.evaluate(() => {
      const o = {};
      ['Famille Gérard', 'Amis de Clara', 'Famille Henrard'].forEach((n) => {
        const item = Array.from(document.querySelectorAll('#staffReservationsPage .pv2-flow-item')).find((x) => ((x.querySelector('.pv2-flow-body strong') || {}).textContent || '').includes(n));
        if (!item) { o[n] = null; return; }
        const rub = {};
        item.querySelectorAll('.res-rub').forEach((s) => {
          const b = s.querySelector('b');
          rub[b.textContent] = { texte: s.textContent.slice(b.textContent.length).trim(), taille: Math.min(parseFloat(getComputedStyle(s).fontSize), parseFloat(getComputedStyle(b).fontSize)), couleur: getComputedStyle(s).color, dedans: s.getBoundingClientRect().right <= item.getBoundingClientRect().right + 0.5 };
        });
        o[n] = rub;
      });
      return o;
    });
    const jg = jour['Famille Gérard'];
    ok(Boolean(jg) && (jg['Équipe'] || {}).texte === 'Arrivent en deux voitures (Julie)' && (jg.Prix || {}).texte === '59 € au lieu de 69 €, carte de fidélité pleine' && (jg.Prix || {}).couleur === couleurPrixComplet, '[R] liste du jour : l equipe et le prix revu, sa raison dans la couleur du prix du Complet', jg);
    ok(Boolean(jour['Amis de Clara']) && (jour['Amis de Clara']['Sur mesure'] || {}).texte === '7 × Hot-dog à 17:00' && Boolean(jour['Famille Henrard']) && Object.keys(jour['Famille Henrard']).length === 0, '[R] liste du jour : le sur mesure avec ses heures ; une note de prix passee se tait', jour);
    ok(Object.values(jour).filter(Boolean).every((x) => Object.values(x).every((r) => r.taille >= 12 && r.dedans)), '[R] liste du jour : rien sous 12 px, rien hors de sa ligne', jour);
    // LA LISTE SOUS LE PLANNING (#resList) DIT LE MEME DOSSIER (2026-11-03) : ses cartes de
    // groupe lisent les notes ecrites par l equipe, la raison du prix, le sur mesure et la
    // derniere modification par la meme regle que la ligne du Complet.
    await page.evaluate(() => { openStaffMenuPage('planning'); });
    await FX.repos(page, 300);
    // (la liste suit la vue ouverte : le scenario a fini sur le planning laser)
    await aller(page, 'all');
    await page.waitForFunction(() => document.querySelectorAll('#resList .gc[data-res-row-id]').length > 15, null, { timeout: 8000 }).catch(() => null);
    const groupes = await page.evaluate((noms) => {
      const cartes = Array.from(document.querySelectorAll('#resList .gc[data-res-row-id]'));
      const o = {};
      noms.forEach((n) => {
        const c = cartes.find((x) => ((x.querySelector('.res-row-name') || {}).textContent || '').trim() === n);
        o[n] = c ? Array.from(c.querySelectorAll('.gc-flag')).map((f) => ({ ton: (Array.from(f.classList).find((k) => k.startsWith('tone-')) || '').slice(5), titre: ((f.querySelector('b') || {}).textContent || '').trim(), texte: f.textContent.replace(/\s+/g, ' ').trim(), bulle: f.getAttribute('title') || '', deborde: f.scrollWidth > f.clientWidth + 1 || f.getBoundingClientRect().right > c.getBoundingClientRect().right + 1 })) : null;
      });
      return { cartes: cartes.length, groupes: o };
    }, ['Famille Gérard', 'Amis de Clara', 'Famille Henrard']);
    if (process.env.PB_PHOTO_LISTE) {
      // (une carte hors de l ecran n est peinte qu une fois amenee a la vue : content-visibility)
      const photo = page.locator('#resList .gc[data-res-row-id]', { hasText: 'Famille Gérard' }).first();
      await photo.scrollIntoViewIfNeeded();
      await FX.repos(page, 500);
      await photo.screenshot({ path: process.env.PB_PHOTO_LISTE });
    }
    const encadre = (liste, t) => (liste || []).find((e) => e.ton === t) || {};
    const lg = groupes.groupes['Famille Gérard'];
    ok(groupes.cartes > 0 && Boolean(lg), '[R] liste sous le planning : les cartes de groupe sont montees', groupes.cartes);
    ok(encadre(lg, 'equipe').titre === 'Note équipe' && /Arrivent en deux voitures/.test(encadre(lg, 'equipe').texte || '') && !/→|fidél/.test(encadre(lg, 'equipe').texte || ''), '[R] liste sous le planning : la note de l equipe, sans les notes de prix ni leur nombre', lg);
    ok(/carte de fidélité pleine/.test(encadre(lg, 'price').texte || '') && /carte de fidélité pleine/.test(encadre(lg, 'price').bulle || '') && /Rachel/.test(encadre(lg, 'modif').texte || ''), '[R] liste sous le planning : la raison du prix, aussi dans sa bulle, et qui a modifie', lg);
    ok(['Famille Gérard', 'Amis de Clara'].every((n) => (groupes.groupes[n] || []).every((e) => !e.deborde)), '[R] liste sous le planning : aucun encadre ne sort de sa carte', groupes.groupes);
    ok(/7 × Hot-dog à 17:00/.test(encadre(groupes.groupes['Amis de Clara'], 'mesure').texte || ''), '[R] liste sous le planning : le sur mesure et son heure', groupes.groupes['Amis de Clara']);
    const lh = groupes.groupes['Famille Henrard'];
    ok(Boolean(lh) && !encadre(lh, 'equipe').ton && !encadre(lh, 'price').ton, '[R] liste sous le planning : une note de prix passee ne fait ni note ni prix', lh);
  });
  // A 1024, des pistes de 110 px : les marqueurs du dossier cedent avant le nom (paliers
  // de pinlane-staff.css), et celui qui reste est entier sur la carte.
  await avec(browser, { lettre: 'R', appareil: 'petitPc', avantChargement: async (page) => { await page.addInitScript(dossiers); await page.addInitScript(dossiersDesCartes); } }, async (page) => {
    await aller(page, 'bowling');
    await FX.repos(page, 300);
    const b = await lireCartesBowling(page, ['Famille Gérard', 'Amis de Clara', 'Famille Noël']);
    ok(b.length >= 3 && b.every((c) => { const dossier = c.marques.filter((m) => (m.cle === 'equipe' || m.cle === 'mesure') && m.vu); return !c.deborde && dossier.every((m) => m.dedans) && (!dossier.length || !c.nomCoupe || c.nomLarge >= 76); }), '[R] 1024 : un marqueur du dossier cede avant le nom (76 px), celui qui reste est entier', b.map((c) => `${c.nom} ${c.nomLarge}${c.nomCoupe ? ' coupe' : ''}${c.deborde ? ' DEBORDE' : ''} ${c.marques.map((m) => `${m.cle}:${m.vu ? 'vu' : 'cache'}`).join(' ')}`));
  });
}

const SCENARIOS = { coordonnees, agrandissement, vraiesBarres, bascule, date, collee, menuGauche, inventaire, dossier, ligne, couleurs, mots, comportement, petitsEcrans, lisibilite, contraste, recherche, cartes };

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const SEUL = (fichier, de, vers = '') => [{ fichier, de, vers }];
const MUTATIONS = [
  // [A] les coordonnees
  { nom: 'ligne-1-trop-haute', lettre: 'A', scenarios: ['coordonnees'], editions: SEUL(PGC, '.pb { --pb-l1: 42px; --pb-l2: 44px;', '.pb { --pb-l1: 52px; --pb-l2: 44px;') },
  { nom: 'bascule-sans-largeurs', lettre: 'A', scenarios: ['coordonnees'], editions: SEUL(PGC, '#staffTabAll { width: 96px; }\n#staffTabBowling { width: 96px; }\n#staffTabLaser { width: 80px; }\n', '') },
  { nom: 'barre-deplacee-en-agrandi', lettre: 'A', scenarios: ['coordonnees'], editions: SEUL(PGC, 'body.pb-agrandi #planningBarre { position: static; flex: none; margin-left: var(--fgx-sidebar-width); }', 'body.pb-agrandi #planningBarre { position: static; flex: none; }') },
  { nom: 'logo-sous-le-cadre', lettre: 'A', scenarios: ['coordonnees'], editions: SEUL(PGC, 'body.pb-agrandi .ops-sidebar { z-index: 401; visibility: hidden; }', 'body.pb-agrandi .ops-sidebar { visibility: hidden; }') },
  { nom: 'logo-efface', lettre: 'A', scenarios: ['coordonnees'], editions: SEUL(PGC, 'body.pb-agrandi .ops-sidebar .fgx-menu-logo-frame { visibility: visible; }\n', '') },
  { nom: 'contenu-plus-etroit-au-laser', lettre: 'A', scenarios: ['coordonnees'], editions: SEUL(PGC, 'body.gf-large #staffView .global-planning-box:not(.expanded) { margin: 0 0 8px; }', 'body.gf-large #staffView .global-planning-box:not(.expanded) { margin: 0 0 8px; }\nbody.gf-large #laserPlanningBox:not(.hidden) { width: calc(100% - 24px); }') },
  { nom: 'ligne-2-sans-palier', lettre: 'A', scenarios: ['coordonnees'], editions: [...SEUL(PGC, '  .pb-bande { gap: 2px; padding: 0 6px 0 8px; }\n  .gf-c, .pb-k { gap: 4px; padding: 0 4px; }\n  .gf-e { margin-right: 4px; }\n  .pb-sep { margin: 0 3px; }\n', ''), ...SEUL(PGC, '  .pb-bande { gap: 2px; }\n  .pb-direct { width: 120px; }\n  .gf-c, .pb-k { padding: 0 4px; }\n', '  .pb-direct { width: 120px; }\n')] },
  { nom: 'legende-ailleurs-au-bowling', lettre: 'A', scenarios: ['coordonnees'], editions: SEUL(PG, "    pbPoser(h + '<span class=\"pb-sep\" aria-hidden=\"true\"></span>' + pbRechercheHtml() + pbFiltreHtml([]) + pbLegende(getStaffResourceView()), m);", "    pbPoser(h + pbRechercheHtml() + pbFiltreHtml([]) + pbLegende(getStaffResourceView()).replace('pb-leg', 'pb-leg pb-leg--gauche'), m);") .concat(SEUL(PGC, '.pb-leg > span { display: inline-flex;', '.pb-leg--gauche { margin-left: 0; }\n.pb-leg > span { display: inline-flex;')) },
  // [B] agrandir
  { nom: 'agrandir-sans-plein-ecran', lettre: 'B', scenarios: ['agrandissement'], editions: SEUL(APP, '  if (agrandir) pbEntrerPleinEcran();\n  else pbQuitterPleinEcran();\n', '  if (!agrandir) pbQuitterPleinEcran();\n') },
  { nom: 'rail-qui-reste', lettre: 'B', scenarios: ['agrandissement'], editions: SEUL(PGC, 'body.pb-agrandi .ops-sidebar { z-index: 401; visibility: hidden; }', 'body.pb-agrandi .ops-sidebar { z-index: 401; }') },
  { nom: 'liste-qui-reste', lettre: 'B', scenarios: ['agrandissement'], editions: SEUL(PGC, 'body.pb-agrandi #staffTableBox { display: none; }\n', '') },
  { nom: 'contenu-a-la-largeur-du-rail', lettre: 'B', scenarios: ['agrandissement'], editions: SEUL(PGC, 'body.pb-agrandi .planning-box.expanded:not(.hidden) { position: relative;', 'body.pb-agrandi .planning-box.expanded:not(.hidden) { margin-left: var(--fgx-sidebar-width) !important; position: relative;') },
  { nom: 'contenu-qui-ne-va-pas-en-bas', lettre: 'B', scenarios: ['agrandissement'], editions: SEUL(PGC, 'z-index: auto; flex: 1 1 0; min-height: 0; margin: 0; border: 1px solid var(--line);', 'z-index: auto; flex: 0 0 300px; min-height: 0; margin: 0; border: 1px solid var(--line);') },
  { nom: 'bascule-quitte-l-agrandi', lettre: 'B', scenarios: ['agrandissement'], editions: SEUL(APP, '  if (pbVueAgrandie()) goFullscreenResource(vue);\n  else setStaffResourceView(vue);\n', '  state.staffPlanningExpanded = false; state.staffLaserPlanningExpanded = false; state.staffGlobalExpanded = false;\n  setStaffResourceView(vue);\n') },
  { nom: 'sortie-du-navigateur-ignoree', lettre: 'B', scenarios: ['agrandissement'], editions: SEUL(APP, "document.addEventListener('fullscreenchange', () => {", "document.addEventListener('fullscreenchange-coupe', () => {") },
  { nom: 'refus-non-rattrape', lettre: 'B', scenarios: ['agrandissement'], editions: SEUL(APP, '  racine.requestFullscreen().catch(() => {});', '  racine.requestFullscreen();') },
  { nom: 'cadre-au-dessus-des-fenetres', lettre: 'B', scenarios: ['agrandissement'], editions: SEUL(PGC, 'body.pb-agrandi #staffView .staff-wrap { position: fixed; inset: 0; z-index: 400;', 'body.pb-agrandi #staffView .staff-wrap { position: fixed; inset: 0; z-index: 2147483000;') },
  // [C] la vraie barre de defilement
  { nom: 'gouttiere-retiree', lettre: 'C', scenarios: ['vraiesBarres'], editions: SEUL(PGC, 'html.pb-page { scrollbar-gutter: stable; }\n', '') },
  { nom: 'contenu-en-100vw', lettre: 'C', scenarios: ['vraiesBarres'], editions: SEUL(PGC, 'body.gf-large.staff-mode main { width: calc(100% - var(--fgx-sidebar-width)) !important; }', 'body.gf-large.staff-mode main { width: calc(100vw - var(--fgx-sidebar-width)) !important; }') },
  // [D] la bascule
  { nom: 'bascule-qui-relit', lettre: 'D', scenarios: ['bascule'], editions: SEUL(APP, 'function pbChanger(vue) {\n', "function pbChanger(vue) {\n  fetch('/api/staff-state');\n") },
  { nom: 'bascule-differee', lettre: 'D', scenarios: ['bascule'], editions: SEUL(APP, '  else setStaffResourceView(vue);\n}\n\nfunction pbEntrerPleinEcran() {', '  else setTimeout(() => setStaffResourceView(vue), 40);\n}\n\nfunction pbEntrerPleinEcran() {') },
  { nom: 'bascule-qui-perd-la-date', lettre: 'D', scenarios: ['bascule'], editions: SEUL(APP, 'function pbChanger(vue) {\n', 'function pbChanger(vue) {\n  state.currentDate = todayStr();\n') },
  { nom: 'fleches-sourdes', lettre: 'D', scenarios: ['bascule'], editions: SEUL(PG, "      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;\n      var tous =", '      return;\n      var tous =') },
  // [E] la date
  { nom: 'libelle-sans-largeur', lettre: 'E', scenarios: ['date'], editions: SEUL(PGC, '.pb .pb-date button.staff-date-label { box-sizing: border-box; width: 134px; min-width: 134px;', '.pb .pb-date button.staff-date-label { box-sizing: border-box; padding: 0 2px !important; width: auto; min-width: 0;') },
  { nom: 'heure-sans-largeur', lettre: 'E', scenarios: ['date'], editions: SEUL(PGC, 'gap: 6px; width: 142px; height: 100%; color: var(--muted); }', 'gap: 6px; height: 100%; color: var(--muted); }') },
  { nom: 'aujourd-hui-toujours-la', lettre: 'E', scenarios: ['date'], editions: SEUL(PG, "    if (m.aujourdHui && m.maintenant != null) return '<div class=\"pb-direct gf-horloge\">", "    if (false) return '<div class=\"pb-direct gf-horloge\">") },
  { nom: 'aujourd-hui-sourd', lettre: 'E', scenarios: ['date'], editions: SEUL(PG, '<button type="button" class="staff-today-btn" onclick="setStaffToday()">', '<button type="button" class="staff-today-btn">') },
  { nom: 'annee-collee', lettre: 'E', scenarios: ['date'], editions: SEUL(PGC, '.pb-an { white-space: pre; }\n', '') },
  // [F] collee
  { nom: 'barre-qui-part', lettre: 'F', scenarios: ['collee'], editions: SEUL(PGC, '--pb-seg-h: 36px; position: sticky; top: 0; z-index: 30;', '--pb-seg-h: 36px; position: relative; z-index: 30;') },
  { nom: 'boite-plus-haute-que-l-ecran', lettre: 'F', scenarios: ['collee'], editions: SEUL(PGC, 'height: calc(100dvh - var(--pb-bas, 88px) - var(--pb-g, 6px)); min-height: 320px; margin: 0 0 8px; }', 'height: 100dvh; min-height: 320px; margin: 0 0 8px; }') },
  { nom: 'bas-de-barre-oublie', lettre: 'F', scenarios: ['collee'], editions: SEUL(PG, "        document.documentElement.style.setProperty('--pb-bas', h + 'px');\n", '') },
  // [G] le menu de gauche
  { nom: 'menu-ouvert-hors-complet', lettre: 'G', scenarios: ['menuGauche'], editions: SEUL(MENU, '    return grandTableau() ? !menuRouvertIci : readPreference();', "    return grandTableau() && window.getStaffResourceView() === 'all' ? !menuRouvertIci : readPreference();") },
  { nom: 'large-partout', lettre: 'G', scenarios: ['menuGauche'], editions: SEUL(APP, "    corps.classList.toggle('gf-large', surPlanning);", "    corps.classList.add('gf-large');") },
  { nom: 'preference-ecrasee', lettre: 'G', scenarios: ['menuGauche'], editions: SEUL(MENU, '    return grandTableau() ? !menuRouvertIci : readPreference();', "    if (grandTableau()) { state.staffMenuCollapsed = true; return true; }\n    return readPreference();") },
  // [H] l inventaire
  { nom: 'second-champ-revenu', lettre: 'H', scenarios: ['inventaire'], editions: SEUL(PGC, 'body.gf-large #staffTableBox:not(.expanded) .search-wrap { display: none; }\n', '') },
  { nom: 'filtres-perdus', lettre: 'H', scenarios: ['inventaire'], editions: SEUL(APP, '    <button type="button" onclick="pbFiltres(event)">Filtres</button>\n', '') },
  { nom: 'agrandir-redit-au-menu', lettre: 'H', scenarios: ['inventaire'], editions: SEUL(APP, "  const agrandirVu = document.getElementById('planningAgrandir')?.getClientRects().length > 0;", '  const agrandirVu = false;') },
  { nom: 'agrandir-perdu-au-telephone', lettre: 'N', scenarios: ['petitsEcrans'], editions: SEUL(APP, "  const agrandirVu = document.getElementById('planningAgrandir')?.getClientRects().length > 0;", '  const agrandirVu = true;') },
  { nom: 'impression-perdue', lettre: 'H', scenarios: ['inventaire'], editions: SEUL(APP, "    <button type=\"button\" onclick=\"telechargerSecours('feuille'); closeStaffFloatingMenus();\">Imprimer la feuille de secours (PDF)</button>\n", '') },
  { nom: 'horaires-perdus', lettre: 'H', scenarios: ['inventaire'], editions: SEUL(APP, '    <div class="pb-menu__info" data-pb-horaires>${escapeHtml(horaires)}</div>\n', '') },
  { nom: 'filtre-muet', lettre: 'H', scenarios: ['inventaire'], editions: SEUL(PG, "    if (f === 'all' || dejaVus.indexOf(f) >= 0) return '';", "    return '';") },
  { nom: 'liste-derriere-l-agrandi', lettre: 'H', scenarios: ['inventaire'], editions: SEUL(APP, '  if (pbVueAgrandie()) pbAgrandir();\n  document.getElementById(\'staffTableBox\')', "  document.getElementById('staffTableBox')") },
  { nom: 'reserver-sans-son-planning', lettre: 'H', scenarios: ['inventaire'], editions: SEUL(APP, "  if (getStaffResourceView() === 'laser') { lpReserverAuProchain(ev); return; }\n  openQuickBook();", '  openQuickBook();') },
  { nom: 'legende-des-cases-perdue', lettre: 'H', scenarios: ['inventaire'], editions: SEUL(APP, "    ${vue === 'all' ? `<div class=\"gf-legende-menu\" role=\"note\" aria-label=\"Lire une case\">${PB_LEGENDE_CASES}</div>` : ''}\n", '') },
  // [I] le dossier qui a tout
  { nom: 'une-seule-ligne', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PGC, '.gf-i > p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;', '.gf-i > p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1;') },
  { nom: 'note-permanente-absente', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, "    if (fiche) liste.push(gfRubrique('fiche', 'Fiche', gpEsc(fiche), fiche, gfAllergie(fiche)));\n", '') },
  { nom: 'note-sans-auteur', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, " + (n.par ? ' <span class=\"gf-i__par\">' + gpEsc(n.par) + '</span>' : '')", '') },
  { nom: 'note-de-prix-dans-equipe', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, '      if (p) { if (!notePrix || p.a != null) notePrix = p; return; }\n', '') },
  { nom: 'premiere-note-de-prix-gardee', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, '      if (p) { if (!notePrix || p.a != null) notePrix = p; return; }\n', '      if (p) { if (!notePrix) notePrix = p; return; }\n') },
  { nom: 'note-du-serveur-illisible', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, "    if (n && n.type === 'prix' && n.prix) {", '    if (false) {') },
  { nom: 'note-de-prix-passee-bavarde', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, '    if (notePrix && notePrix.a != null && Math.round(notePrix.a * 100) !== Math.round((Number(r.price) || 0) * 100)) notePrix = null;\n', '') },
  { nom: 'table-absente', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, "    if (table) liste.push(gfRubrique('table', 'Table', gpEsc(table), table));\n", '') },
  { nom: 'extras-absents', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, "    if (g.extras.length) { var mesure = g.extras.join(', '); liste.push(gfRubrique('mesure', 'Sur mesure', gpEsc(mesure), mesure)); }\n", '') },
  { nom: 'prix-absent', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, "    if (prix) liste.push(gfRubrique('prix', 'Prix', gpEsc(prix), prix));\n", '') },
  { nom: 'raison-du-prix-perdue', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, '    if (raison) morceaux.push(gfEnMinuscule(gfUneLigne(raison)));\n', '') },
  { nom: 'allergie-muette', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, '  function gfAllergie(texte) { return GF_ALLERGIE.test(gfCle(texte).replace(/œ/g, \'oe\')); }', '  function gfAllergie(texte) { return false; }') },
  { nom: 'allergie-en-noir', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PGC, '.gf-i__a { color: var(--gf-rouge); font-weight: 700; }', '.gf-i__a { font-weight: 700; }') },
  { nom: 'adaptee-muette', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, "    if (g.formule && g.formule.adaptee) sous.push('adaptée');\n", '') },
  { nom: 'rubrique-vide-qui-reste', lettre: 'I', scenarios: ['dossier'], editions: SEUL(PG, "    if (mot) liste.push(gfRubrique('client', 'Note du client', gpEsc(mot), mot, gfAllergie(mot)));", "    liste.push(gfRubrique('client', 'Note du client', gpEsc(mot), mot, gfAllergie(mot)));") },
  // [J] la ligne
  { nom: 'telephone-seulement-en-retard', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PG, "    if (tel) tete += '<a class=\"gf-nom__tel\"", "    if (tel && g.retard) tete += '<a class=\"gf-nom__tel\"") },
  { nom: 'telephone-sous-le-nom', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PGC, '.gf-nom__l { display: flex; flex-wrap: wrap;', '.gf-nom__l { display: flex; flex-direction: column; flex-wrap: wrap;') },
  { nom: 'montant-cache-une-fois-paye', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PG, "      h = (regle ? gfDu(regle) : '') + '<span class=\"gf-du__paye\">payé</span>';", "      h = '<span class=\"gf-du__paye\">payé</span>';") },
  { nom: 'paye-muet', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PG, "      h = (regle ? gfDu(regle) : '') + '<span class=\"gf-du__paye\">payé</span>';", "      h = regle ? gfDu(regle) : '';") },
  { nom: 'montant-cache-avant-l-arrivee', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PG, '      else h = gfDu(du);\n', "      else h = g.teinte === 'conf' ? '' : gfDu(du);\n") },
  // (ancre suivie le 2026-11-07 : le retard est un bouton avec le droit, un texte sans)
  { nom: 'retard-hors-du-nom', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PG, '    if (g.retard && m.maintenant != null) {', '    if (false) {') },
  { nom: 'retard-sans-cible', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PGC, '.gf-h__retard { appearance: none; flex: none; display: inline-flex; align-items: center; min-height: 32px;', '.gf-h__retard { appearance: none; flex: none; display: inline-flex; align-items: center; min-height: 20px;') },
  { nom: 'retard-pas-rouge', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PGC, 'background: transparent; color: var(--gf-rouge); font: inherit; font-size: 13px; font-weight: 700; line-height: 20px; white-space: nowrap; cursor: pointer; }', 'background: transparent; color: var(--muted); font: inherit; font-size: 13px; font-weight: 700; line-height: 20px; white-space: nowrap; cursor: pointer; }') },
  { nom: 'colonnes-vides-gardees', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PG, '    var utilisees = colonnes.filter(function (c) { return c.groupes > 0; }).concat(inconnues);', '    var utilisees = colonnes.concat(inconnues);') },
  { nom: 'statut-sans-liste', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PG, 'if (statut) { gfBulleStatut(wrap, statut, e); return; }', 'if (statut) { return; }') },
  { nom: 'paye-sans-sa-teinte', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PGC, 'box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bk-barre) 35%, var(--surface)); color: var(--bk-encre-2); }', 'box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bk-barre) 35%, var(--surface)); }') },
  { nom: 'fleche-qui-bouge', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PGC, '.gf-gb--fleche { flex: 0 0 26px; padding: 0; color: var(--muted); }', '.gf-gb--fleche { flex: 0 0 26px; margin-right: 10px; padding: 0; color: var(--muted); }') },
  { nom: 'autre-jour-sans-geste', lettre: 'J', scenarios: ['ligne'], editions: SEUL(PG, "      if (tel) h = '<a class=\"gf-gb gf-gb--tel\"", "      if (false) h = '<a class=\"gf-gb gf-gb--tel\"") },
  // [K] les couleurs
  { nom: 'en-cours-en-aplat', lettre: 'K', scenarios: ['couleurs'], editions: SEUL(PGC, '.gf-x.is-encours .gf-x__t { background: var(--bk-cadre); color: var(--bk-encre); }', '.gf-x.is-encours .gf-x__t { background: var(--bk-barre); color: var(--bk-plein); }') },
  { nom: 'en-cours-sans-gras', lettre: 'K', scenarios: ['couleurs'], editions: SEUL(PGC, '.gf-x:is(.is-lancer, .is-encours, .is-retard) .gf-x__t { font-weight: 700; }', '.gf-x:is(.is-lancer, .is-retard) .gf-x__t { font-weight: 700; }') },
  { nom: 'en-cours-peint-sa-case', lettre: 'K', scenarios: ['couleurs'], editions: SEUL(PGC, '.gf-x.is-credit { font-size: 13px; }', '.gf-x.is-encours { background: var(--bk-haut); }\n.gf-x.is-credit { font-size: 13px; }') },
  { nom: 'bouton-plein-au-plus-ancien', lettre: 'K', scenarios: ['couleurs'], editions: SEUL(PG, 'var bouton = enRetard.length ? enRetard[enRetard.length - 1] :', 'var bouton = enRetard.length ? enRetard[0] :') },
  { nom: 'legende-laser-fausse', lettre: 'K', scenarios: ['couleurs'], editions: SEUL(PGC, '.pb-leg--laser .gf-leg { background: var(--lp-c); }\n', '') },
  // La carte Bowling prend une couleur que sa legende ne suit pas. (Decrocher la legende du
  // selecteur des cartes ne se voit plus en clair : depuis le 2026-11-03 l ambre et le vert
  // des cartes sont ceux du tableau, la legende retombait sur la bonne couleur.)
  { nom: 'legende-bowling-fausse', lettre: 'K', scenarios: ['couleurs'], editions: SEUL(STAFF, '.booking.arr, .pb-leg--bowling .gf-leg.t-arr {', '.booking.booking.arr { --bk-barre: #f5a623; }\n.booking.arr, .pb-leg--bowling .gf-leg.t-arr {') },
  { nom: 'legende-sombre-fausse', lettre: 'K', scenarios: ['couleurs'], editions: SEUL(STAFF, "[data-theme='dark'] .booking, [data-theme='dark'] .pb-leg--bowling .gf-leg {", "[data-theme='dark'] .booking {") },
  { nom: 'legende-du-tableau-fausse', lettre: 'K', scenarios: ['couleurs'], editions: SEUL(PGC, '.gf-r, .gf-leg { --bk-haut: #e3effd;', '.gf-leg { --bk-barre: #5500aa; }\n.gf-r { --bk-haut: #e3effd;') },
  // [L] les mots
  { nom: 'arrive-avec-son-nombre', lettre: 'L', scenarios: ['mots'], editions: SEUL(PG, "aria-label=\"' + gpEsc('Pointer ' + (r.name || 'le groupe') + ' arrivé') + '\">Arrivé</button>';", "aria-label=\"' + gpEsc('Pointer ' + (r.name || 'le groupe') + ' arrivé') + '\">Arrivé · ' + r.pax + '</button>';") },
  { nom: 'toutes-revient-au-menu', lettre: 'L', scenarios: ['mots'], editions: SEUL(MENU, "{ key: 'complete', label: 'Complet', resource: 'all' }", "{ key: 'complete', label: 'Toutes', resource: 'all' }") },
  { nom: 'pistes-abregees', lettre: 'L', scenarios: ['mots'], editions: SEUL(PG, "    return (liste.length > 1 ? 'Pistes ' : 'Piste ') + gpPistes(liste);", "    return 'P' + gpPistes(liste);") },
  { nom: 'pistes-en-gris', lettre: 'L', scenarios: ['mots'], editions: SEUL(PGC, '.gf-x__d { font-size: 13px; font-weight: 500; line-height: 16px; color: var(--text); white-space: normal; }', '.gf-x__d { font-size: 13px; font-weight: 500; line-height: 16px; color: var(--faint); white-space: normal; }') },
  { nom: 'vers-abrege', lettre: 'L', scenarios: ['mots'], editions: SEUL(PG, "(e.libre ? 'vers ' : '') + gpHeure(debut);\n      if (col.nature === 'bowling')", "(e.libre ? '≈' : '') + gpHeure(debut);\n      if (col.nature === 'bowling')") },
  { nom: 'credits-abreges', lettre: 'L', scenarios: ['mots'], editions: SEUL(PG, "      t = (cr.parEnfant ? cr.n : cr.total) + ' crédits';", "      t = (cr.parEnfant ? cr.n : cr.total) + ' cr./enf.';") },
  { nom: 'accompagnants-abreges', lettre: 'L', scenarios: ['mots'], editions: SEUL(PG, "gpEsc('et ' + avec + ' accomp.')", "gpEsc('+' + avec)") },
  { nom: 'pers-revient', lettre: 'L', scenarios: ['mots'], editions: SEUL(PG, "lignes.push({ html: '<span>' + gpEsc(gfPluriel(compte.pers, ['joueur', 'joueurs'])) + '</span>', hauteur: 1 });", "lignes.push({ html: '<span>' + compte.pers + ' pers.</span>', hauteur: 1 });") },
  { nom: 'fenetre-reserver', lettre: 'L', scenarios: ['mots'], editions: SEUL(APP, '<h3 id="qbTitle">Réservation</h3>', '<h3 id="qbTitle">Réserver</h3>') },
  // [M] le comportement
  { nom: 'barre-en-bas-de-l-ecran', lettre: 'M', scenarios: ['comportement'], editions: SEUL(PG, '    var y = now.offsetTop - hTete - vue / 3;', '    var y = now.offsetTop - hTete - vue * 0.8;') },
  { nom: 'barre-a-l-heure', lettre: 'M', scenarios: ['comportement'], editions: SEUL(PG, '    var moments = new Map(m.groupes.map(function (g) { return [g.id, { etat: g.etatListe, late: g.retard }]; }));', '    var moments = new Map(m.groupes.map(function (g) { return [g.id, { etat: g.etat, late: g.retard }]; }));') },
  { nom: 'payer-perd-le-groupe', lettre: 'M', scenarios: ['comportement'], editions: SEUL(APP, "      moment.etat = groupeToutFait(r) ? 'done' : 'onsite';", "      moment.etat = 'done';") },
  { nom: 'deux-comptes', lettre: 'M', scenarios: ['comportement'], editions: SEUL(PG, '    var moments = new Map(m.groupes.map(function (g) { return [g.id, { etat: g.etatListe, late: g.retard }]; }));', "    var moments = new Map(m.groupes.map(function (g) { return [g.id, { etat: g.etatListe === 'onsite' && g.r.status === 'paid' ? 'closing' : g.etatListe, late: g.retard }]; }));") },
  { nom: 'arrivee-sans-son-nom', lettre: 'M', scenarios: ['comportement'], editions: SEUL(APP, '  if (span.start < debut - 1 / 120) return `Arrivée ${formatClockDisplay(span.start)}, début ${formatClockDisplay(debut)} → ${fin}`;\n', '') },
  // [N] les petits ecrans
  { nom: 'bascule-cachee-au-telephone', lettre: 'N', scenarios: ['petitsEcrans'], editions: SEUL(PGC, '  .pb-seg { grid-column: 1 / 3; grid-row: 1; padding: 0; background: transparent; }', '  .pb-seg { display: none; grid-column: 1 / 3; grid-row: 1; padding: 0; background: transparent; }') },
  { nom: 'rangee-vide-pour-le-menu', lettre: 'N', scenarios: ['petitsEcrans'], editions: SEUL(PGC, '  .pb-ic--plus { grid-column: 3; grid-row: 1; }', '  .pb-ic--plus { grid-column: 3; grid-row: 3; }') },
  { nom: 'carte-sous-la-barre', lettre: 'N', scenarios: ['petitsEcrans'], editions: SEUL(PGC, ' scroll-margin-top: calc(var(--pb-bas, 152px) + 4px); }', ' }') },
  { nom: 'doigt-a-38', lettre: 'N', scenarios: ['petitsEcrans'], editions: SEUL(PGC, '  .pb { --pb-l1: 44px; --pb-l2: 44px; --pb-seg-h: 44px; }\n', '') },
  { nom: 'ligne-2-basse-au-doigt', lettre: 'N', scenarios: ['petitsEcrans'], editions: SEUL(PGC, '  .gf-c, .pb-k, .pb-filtre, #planningBarre .staff-today-btn { height: 44px; min-height: 44px; }\n', '') },
  { nom: 'barre-qui-deborde-au-telephone', lettre: 'N', scenarios: ['petitsEcrans'], editions: SEUL(PGC, '  .pb .pb-date button.staff-date-label { width: 112px; min-width: 112px; }', '  .pb .pb-date button.staff-date-label { width: 312px; min-width: 312px; }') },
  // [O] la lisibilite
  { nom: 'lignes-trop-hautes', lettre: 'O', scenarios: ['lisibilite'], editions: SEUL(PGC, '.gf-t { --gf-l: 46px;', '.gf-t { --gf-l: 170px;') },
  { nom: 'dossier-sur-tout-l-ecran', lettre: 'O', scenarios: ['lisibilite'], editions: SEUL(PGC, '.gf-i > span { font-size: 12px; color: var(--muted); white-space: nowrap; }', '.gf-i > span { display: block; margin-bottom: 40px; font-size: 12px; color: var(--muted); white-space: nowrap; }') },
  { nom: 'vers-qui-sort-de-sa-case', lettre: 'O', scenarios: ['lisibilite'], editions: SEUL(PGC, '.gf-x.is-libre { padding-left: 8px; color: var(--muted); font-size: 13px; white-space: normal; }', '.gf-x.is-libre { padding-left: 8px; color: var(--muted); font-size: 13px; }') },
  { nom: 'bloc-trop-etroit', lettre: 'O', scenarios: ['lisibilite'], editions: SEUL(PGC, '  .gf-t, .gf-t.is-dense, .gf-t.is-serre { --c-bloc: 64px; --c-nom: 166px;', '  .gf-t, .gf-t.is-dense, .gf-t.is-serre { --c-bloc: 52px; --c-nom: 166px;') },
  { nom: 'lignes-sous-46', lettre: 'O', scenarios: ['lisibilite'], editions: SEUL(PGC, '.gf-t { --gf-l: 46px;', '.gf-t { --gf-l: 30px;') .concat(SEUL(PGC, '.gf-gb { appearance: none; flex: 1 1 0; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-width: 0; height: 34px;', '.gf-gb { appearance: none; flex: 1 1 0; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-width: 0; height: 22px;')) },
  { nom: 'libelle-trop-petit', lettre: 'O', scenarios: ['lisibilite'], editions: SEUL(PGC, '.gf-i > span { font-size: 12px; color: var(--muted); white-space: nowrap; }', '.gf-i > span { font-size: 10px; color: var(--muted); white-space: nowrap; }') },
  // [P] le contraste
  { nom: 'libelle-pale', lettre: 'P', scenarios: ['contraste'], editions: SEUL(PGC, '.gf-c__l { color: color-mix(in srgb, var(--muted) 55%, var(--text)); font-weight: 500; }', '.gf-c__l { color: color-mix(in srgb, var(--muted) 35%, var(--surface)); font-weight: 500; }') },
  // [Q] la recherche
  { nom: 'notes-non-cherchees', lettre: 'Q', scenarios: ['recherche'], editions: SEUL(PG, '.concat(g.rubriques.map(function (x) { return x.texte; })).join(\' \')).indexOf(q) >= 0) return true;', ".join(' ')).indexOf(q) >= 0) return true;") },
  { nom: 'liste-sourde-aux-notes', lettre: 'Q', scenarios: ['recherche'], editions: SEUL(APP, ' ${getReservationLabel(r)} ${texteRecherchableDuDossier(r)}`.toLowerCase().includes(q));', ' ${getReservationLabel(r)}`.toLowerCase().includes(q));') },
  { nom: 'croix-du-seul-complet', lettre: 'Q', scenarios: ['recherche'], editions: SEUL(APP, "  syncStaffSearchCroix();\n  const run = () => {", '  const run = () => {') },
  { nom: 'croix-sourde', lettre: 'Q', scenarios: ['recherche'], editions: SEUL(PG, "    if (efface) efface.addEventListener('click', gfViderRecherche);\n", '') },
  { nom: 'entree-pointe-hors-du-tableau', lettre: 'Q', scenarios: ['recherche'], editions: SEUL(PG, "    if (!boite || boite.classList.contains('hidden')) return;\n", '') },
  { nom: 'taper-seulement-au-complet', lettre: 'Q', scenarios: ['recherche'], editions: SEUL(PG, "    if (!document.body.classList.contains('gf-large') || state.view !== 'staff') return;", "    if (getStaffResourceView() !== 'all' || state.view !== 'staff') return;") },
  // [R] les cartes disent le dossier
  { nom: 'marque-sur-mesure-absente', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, "  if (e && (e.mesure || e.adaptee)) {\n    marques.push({\n      cls: 'flag-mesure',", "  if (false) {\n    marques.push({\n      cls: 'flag-mesure',") },
  { nom: 'marque-equipe-absente', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, '  if (e && e.notes) {\n    const allergie = Boolean(e.allergies.notes);', '  if (false) {\n    const allergie = Boolean(e.allergies.notes);') },
  { nom: 'note-de-prix-sur-la-carte', lettre: 'R', scenarios: ['cartes'], editions: SEUL(PG, '      if (p) { if (!notePrix || p.a != null) notePrix = p; return; }\n', '') },
  { nom: 'prix-sans-sa-raison', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, "  const revu = options.essentiel && options.essentiel.raison ? `Prix ajusté ${montant}, référence ${formatMoneyCentimes(etat.reference)}, ${options.essentiel.raison}` : '';", "  const revu = '';") },
  { nom: 'coin-sans-survol', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, '        ${noteDuCoin ? `<span class="bk-coin" title="${escapeHtml(noteDuCoin)}" aria-hidden="true"></span>` : \'\'}\n', '') },
  { nom: 'coin-pas-rouge', lettre: 'R', scenarios: ['cartes'], editions: SEUL(STAFF, '.booking.a-allergie { --bk-coin: color-mix(in srgb, var(--danger) 82%, var(--text)); }\n', '') },
  { nom: 'allergie-pas-rouge', lettre: 'R', scenarios: ['cartes'], editions: SEUL(STAFF, '.bk-flag.is-allergie { color: color-mix(in srgb, var(--danger) 82%, var(--text)); }\n', '') },
  { nom: 'marques-pales', lettre: 'R', scenarios: ['cartes'], editions: SEUL(STAFF, '.bk-flag.flag-equipe, .bk-flag.flag-mesure { color: inherit; }\n', '') },
  { nom: 'marques-qui-ecrasent-le-nom', lettre: 'R', scenarios: ['cartes'], editions: SEUL(STAFF, '.bk-flag.flag-equipe, .bk-flag.flag-mesure { color: inherit; }', '.bk-flag.flag-equipe, .bk-flag.flag-mesure { color: inherit; min-width: 80px; }') },
  { nom: 'marqueur-qui-ecrase-le-nom-a-1024', lettre: 'R', scenarios: ['cartes'], editions: SEUL(STAFF, '@container piste (max-width: 116px) {\n  .booking.a-dossier:not(.dens-xs) .booking-head :is(.flag-mesure, .flag-equipe, .flag-modif) { display: none; }\n}\n', '') },
  { nom: 'coin-laser-pas-rouge', lettre: 'R', scenarios: ['cartes'], editions: SEUL(STAFF, '  .lp-g.a-allergie { --lp-coin: color-mix(in srgb, var(--danger) 82%, var(--text)); }', '') },
  { nom: 'carte-laser-sans-sa-note', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, "${noteLaser ? ` · ${noteLaser}` : ''}`)}\">", "`)}\">") },
  { nom: 'marque-modif-absente', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, '  if (modif) {\n    marques.push({\n      cls: \'flag-modif\',', '  if (false) {\n    marques.push({\n      cls: \'flag-modif\',') },
  { nom: 'complet-avec-modif', lettre: 'R', scenarios: ['cartes'], editions: SEUL(PG, "    if (prix) liste.push(gfRubrique('prix', 'Prix', gpEsc(prix), prix));\n", "    if (prix) liste.push(gfRubrique('prix', 'Prix', gpEsc(prix), prix));\n    var modif = typeof texteDerniereModif === 'function' ? texteDerniereModif(r, { max: 4 }) : '';\n    if (modif) liste.push(gfRubrique('modif', 'Modifié', gpEsc(modif.replace(/^Modifié\\s*/, '')), modif));\n") },
  { nom: 'marque-qui-garde-le-toucher', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, '<span class="bk-flag ${m.cls}" role="img"', '<span class="bk-flag ${m.cls}" onclick="event.stopPropagation()" role="img"') },
  { nom: 'liste-du-jour-sans-rubriques', lettre: 'R', scenarios: ['cartes'], editions: SEUL('assets/staff-pages-v2.js', "    return `<span class=\"pv2-flow-marks\">${prix}${note}${rubriques}</span>`;", "    return `<span class=\"pv2-flow-marks\">${prix}${note}</span>`;") },
  { nom: 'liste-du-jour-prix-gris', lettre: 'R', scenarios: ['cartes'], editions: SEUL(STAFF, '.pv2-flow-marks .res-rub--prix { color: var(--warning); font-weight: 600; }\n', '') },
  { nom: 'terrain-sans-equipe', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, "  if (e.derniere) lignes.push(rubrique('equipe',", "  if (false) lignes.push(rubrique('equipe',") },
  { nom: 'terrain-sans-sur-mesure', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, "  if (e.mesure || e.adaptee) lignes.push(rubrique('mesure',", "  if (false) lignes.push(rubrique('mesure',") },
  { nom: 'terrain-sans-prix', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, "  if (e.prix) lignes.push(rubrique('prix', 'Prix', escapeHtml(e.prix)));\n", '') },
  { nom: 'terrain-allergie-muette', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, "  const allergie = (oui) => (oui ? '<b class=\"terrain-allergie\">Allergie</b> ' : '');", "  const allergie = () => '';") },
  { nom: 'terrain-allergie-noire', lettre: 'R', scenarios: ['cartes'], editions: SEUL(STAFF, '.terrain-allergie { color: color-mix(in srgb, var(--danger) 82%, var(--text)); font-weight: 700; }', '.terrain-allergie { font-weight: 700; }') },
  { nom: 'terrain-prix-sans-sa-couleur', lettre: 'R', scenarios: ['cartes'], editions: SEUL(STAFF, '.terrain-rub--prix .terrain-rub__t { color: var(--warning); font-weight: 600; }\n', '') },
  // [R] la liste sous le planning (#resList) : les cartes de groupe (2026-11-03)
  { nom: 'liste-compte-les-notes-de-prix', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, 'const notesEquipe = aUneNote ? notesEquipeEcrites(r) : [];', 'const notesEquipe = aUneNote ? getReservationNotesEquipe(r) : [];') },
  { nom: 'liste-sans-raison-du-prix', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, "const raisonPrix = marquePrix && essentiel ? essentiel.raison : '';", "const raisonPrix = '';") },
  { nom: 'liste-sans-sur-mesure', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, "  if (essentiel && essentiel.mesure) encadres.push({ ton: 'mesure', titre: 'Sur mesure', texte: essentiel.mesure });\n", '') },
  { nom: 'liste-sans-modif', lettre: 'R', scenarios: ['cartes'], editions: SEUL(APP, "if (modif) encadres.push({ ton: 'modif', titre: 'Modifié',", "if (false) encadres.push({ ton: 'modif', titre: 'Modifié',") },
  { nom: 'notes-equipe-avec-les-traces', lettre: 'R', scenarios: ['cartes'], editions: SEUL(PG, 'window.pgNotesEquipe = function (r) { return gfNotesEquipe(r || {}).equipe; };', 'window.pgNotesEquipe = function (r) { return getReservationNotesEquipe(r || {}); };') },
];

async function jouer(browser, noms) {
  for (const n of noms) {
    if (!SCENARIOS[n]) throw new Error(`scenario inconnu : ${n}`);
    await SCENARIOS[n](browser);
  }
}
// Les rouges du scenario sans mutation, une fois par scenario.
const releves = new Map();
async function rougesDeDepart(browser, noms) {
  const tout = new Set();
  for (const n of noms) {
    if (!releves.has(n)) {
      const garde = rouges.length;
      const avant = echecs;
      silence = true;
      try { await jouer(browser, [n]); } catch (e) { rouges.push(`crash de depart ${n} : ${e.message}`); }
      silence = false;
      releves.set(n, rouges.slice(garde));
      rouges.length = garde;
      echecs = avant;
    }
    releves.get(n).forEach((l) => tout.add(l));
  }
  return tout;
}

async function main() {
  const serveur = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, liste(process.env.PB_SCENARIOS) || Object.keys(SCENARIOS));
    } else {
      console.log('[CP] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.PB_MUTATIONS || liste(process.env.PB_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[CP] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        if (process.env.PB_ANCRES) continue;
        const deDepart = await rougesDeDepart(browser, m.scenarios);
        const avant = echecs;
        const garde = rouges.length;
        mutation = { ...m, deDepart };
        silence = !process.env.PB_BAVARD;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        const vus = rouges.slice(garde);
        const mord = vus.some(mordu);
        mutation = null;
        rouges.length = garde;
        echecs = avant;
        ok(mord, `[CP] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nplanning-barre-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nplanning-barre-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

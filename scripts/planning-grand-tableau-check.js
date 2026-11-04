// LE GRAND TABLEAU, GESTE PAR GESTE (2026-11-02, planning global v5).
//
// Movsar, 02/11, devant la file d action : « ah non je preferais large en mode
// planning mais en bcp mieux fait ». Le planning global est devenu un grand
// tableau bord a bord : le menu se replie, un seul bandeau au-dessus, une grande
// case par demi-heure, le geste au bord droit. scripts/planning-global-check.js
// garde ce que le tableau ECRIT, ligne par ligne ; ce gate-ci garde ce qu il
// permet de FAIRE en plein rush, avec les vraies interactions, sur la vraie
// console (scripts/planning-v3-fixtures.js, 15:10, le samedi « pic », aucun
// reseau, aucune base), a 1366x768 : le PC du comptoir. Compteurs et ratios,
// jamais de millisecondes absolues.
//   [A] LA FORME : le tableau bord a bord sans defilement de cote, une case par
//       demi-heure et plus de rangee d en-tete, un seul bouton plein, le menu en barre
//       sans toucher au choix de l equipe, la barre de gauche dit le statut, rien sous
//       12 px, chaque geste a la meme place et la meme largeur (depuis le 2026-11-03, la
//       lisibilite passe avant le nombre de lignes : scripts/planning-barre-check.js [O]) ;
//   [B] UN « ARRIVÉ » ne reecrit qu une ligne : rien ne bouge d un pixel, l ordre
//       non plus, le bouton plein passe au groupe suivant, « Ils sont N » ;
//   [C] LES COMPTEURS filtrent, depuis le haut, et un second toucher revient ;
//   [D] TAPER UN NOM, de n importe ou ; Entree pointe le seul groupe attendu, et
//       rien s il en reste plusieurs ; un groupe sur place trouve Carte et Espèces ;
//   [E] « PAS VENU » : a partir de 15 min de retard, jamais sur un groupe qui a
//       annonce son retard, a la fin d une visite jamais pointee ; la ligne reste ;
//   [F] AGRANDIR : le plein ecran, le champ dans la barre, rien ne s y recouvre,
//       au moins autant de lignes ; Reduire rend tout ;
//   [G] LE MENU REPLIE reste utilisable ; quitter l ecran rend le menu et tout le
//       reste ; « Ouvrir le menu » vaut pour cet ecran, pas pour la preference ;
//   [H] LA BARRE COUPE UNE DEMI-HEURE : la suite reste dans son bloc ;
//   [I] UNE LIGNE EN RETARD : le telephone a cote du nom, le mot du client dans sa
//       rubrique, le contraste de tout ce qui s ecrit, en clair et en sombre ;
//   [J] LA MINUTE : la barre garde sa hauteur, la feuille suit, jamais sous une main ;
//   [K] UN AUTRE JOUR : ni barre ni compteur faux, « Aujourd hui » revient ; un jour
//       passe ne reserve plus, un jour a venir si ;
//   [L] LA BARRE AGRANDIE, de 390 a 1920 px : deux pieces ne se recouvrent pas ;
//   [M] LE TEXTE RESTE DANS SA CASE, en largeur partout, en hauteur dans la case
//       d heure (elle ne fait pas grandir ses lignes), montants longs, menu rouvert,
//       tablette, pire jour ;
//   [N] LES AUTRES JOURS : calme, ferme, vide, pire, rien ne deborde ;
//   [P] LA CASE D HEURE reserve a son heure, une case passee ne fait rien ;
//   [Q] LE BANDEAU : l etat du centre mene a son geste, chaque nom a sa fiche,
//       « pas là » pour un groupe absent ;
//   [R] LE RETARD se touche : 10, 20, 30 min, ajoutes a celui qui court ;
//   [S] ENCAISSER : le montant d un groupe sur place ouvre Carte et Espèces, le
//       paiement part avec son moyen, rien ne bouge ;
//   [T] UNE PISTE FERMEE se voit sur la ligne du groupe et mene a son bloc ;
//   [U] LE MENU « ⋯ » n a pas ce que la barre et le tableau font eux-memes ;
//   [V] AU TELEPHONE, la liste s ouvre sur l heure, une fois ;
//   [W] LA PERF SE GARDE A SA SOURCE : les surfaces cachees restent vides, geste
//       apres geste ; aucun selecteur qui recalcule tout (`:has()` suivi d un
//       descendant, `.x *` sur une classe qui bascule, `tr + tr`) n a prise sur cet
//       ecran, et la feuille du tableau n en porte aucun.
// --contre-preuves : chaque regle retiree (au texte servi, le disque n est jamais
// touche) fait rougir sa lettre ; chaque ancre existe une fois et une seule.
//   GT_SCENARIOS, GT_MUTATIONS : un sous-ensemble, pour iterer ; GT_BAVARD : les
//   lignes des contre-preuves.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
// 5207 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_GRAND_TABLEAU_PORT || 5207);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PG = 'assets/pinlane-planning-global.js';
const PGC = 'assets/pinlane-planning-global.css';
const APP = 'assets/app-main.js';
const MENU = 'assets/staff-menu.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

// Le PC du comptoir : le plus petit des ecrans de bureau, celui que le tableau vise.
FX.APPAREILS.comptoir = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
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
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`);
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
// LE MONTAGE. Le serveur simule rend ce qu on lui ecrit, comme le vrai : « absent »
// pose absentAt (noterEncaisseOuAbsence, lib/database.js). Ce qui part est releve
// dans __FIXTURE__.patchs, c est lui qui fait foi.
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

// Ce qui se voit dans la feuille a cet instant.
const vue = (page) => page.evaluate(() => {
  const d = document.querySelector('.gf-defile');
  const b = d.getBoundingClientRect();
  const hTete = d.querySelector('thead').getBoundingClientRect().height;
  const lignes = Array.from(d.querySelectorAll('.gf-r')).map((tr) => { const r = tr.getBoundingClientRect(); return { id: tr.getAttribute('data-gf-id'), haut: Math.round(r.top), bas: Math.round(r.bottom), h: Math.round(r.height) }; });
  const entieres = lignes.filter((l) => l.haut >= b.top + hTete - 1 && l.bas <= Math.min(b.bottom, innerHeight) + 1);
  const now = d.querySelector('.gf-now');
  const n = now ? now.getBoundingClientRect() : null;
  return { hauteurFeuille: Math.round(b.height), scrollTop: d.scrollTop, entieres: entieres.length, total: lignes.length, hauteurs: Array.from(new Set(lignes.map((l) => l.h))).sort((x, y) => x - y), defile: d.scrollWidth - d.clientWidth, barre: n ? n.top >= b.top + hTete - 1 && n.bottom <= Math.min(b.bottom, innerHeight) + 1 : false };
});
const lignesDuJour = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.gf-r')).map((tr) => ({
  id: tr.getAttribute('data-gf-id'),
  nom: tr.querySelector('.gf-nom__t').textContent,
  pax: Number(tr.querySelector('td.gf-n b').textContent),
  cls: tr.className,
  etat: tr.querySelector('.gf-etat').textContent.replace(/\s+/g, ' ').trim(),
  retard: (tr.querySelector('.gf-h__retard') || {}).textContent || '',
  pasVenu: Boolean(tr.querySelector('[data-gf-absent]')),
  caisse: (tr.querySelector('.gf-nom__caisse') || {}).textContent || '',
  du: (tr.querySelector('.gf-du') || {}).textContent || '',
})));
const minutesDe = (retard) => { const m = /^\+(?:(\d+) min|(\d+)h(\d{2}))$/.exec(retard); return m ? (m[1] ? Number(m[1]) : Number(m[2]) * 60 + Number(m[3])) : NaN; };
const ouvertures = (page) => page.evaluate(() => ({
  fiche: !document.getElementById('posOverlay').classList.contains('hidden'),
  reserver: !document.getElementById('quickBookOverlay').classList.contains('hidden'),
  heure: typeof quickBookState !== 'undefined' && quickBookState ? quickBookState.startTime : null,
  heureLue: (document.querySelector('#quickBookOverlay:not(.hidden) [id^="rvHeure-"]') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(),
  type: typeof quickBookState !== 'undefined' && quickBookState ? quickBookState.type : null,
  verrou: typeof quickBookState !== 'undefined' && quickBookState ? Boolean(quickBookState.lockStartTime) : false,
  groupe: !document.getElementById('posOverlay').classList.contains('hidden') && state.selectedRes ? String(state.selectedRes.id) : null,
  vue: state.staffResourceView,
  bowling: !document.getElementById('planningBox').classList.contains('hidden'),
}));
const fermer = (page) => page.evaluate(() => { closeQuickBook(); closePos(); closeStaffFloatingMenus(); });

// La tete de la boite agrandie : deux pieces ne se recouvrent pas, chaque piece est dans
// l ecran, et le doigt qui vise le champ touche bien le champ, d un bout a l autre.
const teteDegagee = (page) => page.evaluate(() => {
  const tete = document.getElementById('planningBarre');
  const pieces = Array.from(tete.querySelectorAll('.pb-seg, .pb-date, .gf-recherche, .pb-res, .pb-ic')).filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
  const boites = pieces.map((el) => { const r = el.getBoundingClientRect(); return { nom: el.id || el.className.toString().split(' ')[0], g: r.left, d: r.right, h: r.top, b: r.bottom }; });
  const chevauchements = [];
  boites.forEach((a, i) => boites.slice(i + 1).forEach((b) => { if (a.g < b.d - 0.5 && b.g < a.d - 0.5 && a.h < b.b - 0.5 && b.h < a.b - 0.5) chevauchements.push(`${a.nom} / ${b.nom}`); }));
  const horsEcran = boites.filter((b) => b.g < 0 || b.d > innerWidth || b.h < 0 || b.b > innerHeight).map((b) => b.nom);
  const champ = document.getElementById('globalPlanningSearchInput');
  const c = champ.getBoundingClientRect();
  const y = c.top + c.height / 2;
  const couvert = [c.left + 2, c.left + 45, c.left + c.width / 2, c.right - 45].filter((x) => document.elementFromPoint(x, y) !== champ).map(Math.round);
  // (la consigne du champ se lit en entier, marges comprises)
  const cs = getComputedStyle(champ);
  const crayon = document.createElement('canvas').getContext('2d');
  crayon.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const consigne = Math.ceil(crayon.measureText(champ.placeholder).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight));
  return { ok: pieces.length >= 3 && chevauchements.length === 0 && horsEcran.length === 0 && couvert.length === 0 && consigne <= c.width, chevauchements, horsEcran, couvert, largeurChamp: Math.round(c.width), consigne, hauteurTete: Math.round(tete.getBoundingClientRect().height), pieces: boites.length };
});

// Le texte reste dans sa case : pour chaque noeud de texte d une ligne, ses deux bords
// mesures sur le noeud lui-meme (la boite d un parent coupe ne dit pas ce qui est coupe).
// Dans la case d heure, la hauteur compte aussi : elle n a que celle de ses lignes.
const texteDansSaCase = (page) => page.evaluate(() => {
  const sorties = [];
  let noeuds = 0;
  document.querySelectorAll('.gf-r > td').forEach((td) => {
    const b = td.getBoundingClientRect();
    if (!b.width) return;
    const enHauteur = td.classList.contains('gf-bloc');
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
      const bas = Math.max(...boites.map((x) => x.bottom));
      const nom = `${n.nodeValue.trim().slice(0, 18)} (${td.className.split(' ')[0]}`;
      if (g < b.left - 0.5 || d > b.right + 0.5) sorties.push(`${nom}, ${Math.ceil(Math.max(b.left - g, d - b.right))} px)`);
      if (enHauteur && bas > b.bottom + 0.5) sorties.push(`${nom}, ${Math.ceil(bas - b.bottom)} px sous la case)`);
    }
  });
  // LA CASE D HEURE N A QUE LA HAUTEUR DE SES LIGNES. Elle est dans le flux : trop
  // pleine, elle ne deborde pas, elle fait grandir ses lignes. Celles-ci ont donc la meme
  // hauteur avec et sans son contenu (tant qu elle est une case du tableau ; sur un
  // telephone elle devient l en-tete de chaque carte).
  const lignes = Array.from(document.querySelectorAll('.gf-r'));
  const blocs = Array.from(document.querySelectorAll('.gf-r > td.gf-bloc')).filter((td) => getComputedStyle(td).display === 'table-cell');
  const dedans = blocs.map((td) => td.querySelector('.gf-bloc__in')).filter(Boolean);
  if (dedans.length) {
    const avec = lignes.map((l) => l.getBoundingClientRect().height);
    dedans.forEach((e) => { e.style.display = 'none'; });
    const sans = lignes.map((l) => l.getBoundingClientRect().height);
    dedans.forEach((e) => { e.style.display = ''; });
    lignes.forEach((l, i) => { if (avec[i] > sans[i] + 0.5) sorties.push(`ligne ${i + 1} grandie de ${Math.ceil(avec[i] - sans[i])} px par sa case d heure`); });
  }
  const uniques = Array.from(new Set(sorties));
  return { ok: noeuds > 0 && uniques.length === 0, noeuds, nombre: sorties.length, sorties: uniques.slice(0, 8) };
});

// ---------------------------------------------------------------------------
// [A] LA FORME
// ---------------------------------------------------------------------------
async function densite(browser) {
  await avec(browser, { lettre: 'A' }, async (page) => {
    const v0 = await vue(page);
    ok(v0.total === GROUPES_DU_PIC, `[A] le grand tableau est monte : ${GROUPES_DU_PIC} groupes sur ${GROUPES_DU_PIC}`, v0.total);
    ok(v0.defile <= 0, '[A] pas de defilement de cote', v0.defile);
    const g = await page.evaluate(() => {
      const tout = (s) => Array.from(document.querySelectorAll(s));
      const r = {};
      const t = document.querySelector('.gf-t').getBoundingClientRect();
      const rail = document.querySelector('.ops-sidebar').getBoundingClientRect();
      r.bord = { gauche: Math.round(t.left - rail.right), droite: Math.round(document.body.getBoundingClientRect().right - t.right), rail: Math.round(rail.width) };
      r.collapsed = document.body.classList.contains('staff-menu-collapsed');
      r.pref = Boolean(state.staffMenuCollapsed);
      r.lignesDEnTete = tout('.gf-demi').length;
      r.cases = tout('tr:not(.gf-libre) > td.gf-bloc[data-gf-bloc]').length;
      r.demiHeures = new Set(tout('.gf-r td.gf-h').map((td) => { const h = (td.querySelector('b') || {}).textContent || td.getAttribute('data-gf-heure'); const [a, b] = h.split(':').map(Number); return a * 2 + (b >= 30 ? 1 : 0); })).size;
      r.premier = tout('.is-premier').map((x) => x.getAttribute('data-gf-id'));
      const el = document.querySelector('.is-premier .gf-gb--arrive');
      r.fondPremier = el ? getComputedStyle(el).backgroundColor : null;
      r.fondsAutres = Array.from(new Set(tout('.gf-r:not(.is-premier) .gf-gb--arrive').map((b) => getComputedStyle(b).backgroundColor)));
      r.nbAutres = tout('.gf-r:not(.is-premier) .gf-gb--arrive').length;
      r.tailleMin = Math.min(...tout('#globalPlanningGridWrap *').filter((n) => Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim())).map((n) => parseFloat(getComputedStyle(n).fontSize)));
      r.surface = tout('#globalPlanningGridWrap *').length - tout('#globalPlanningGridWrap tr.gf-libre, #globalPlanningGridWrap tr.gf-libre *').length;
      r.lignes = tout('.gf-r').length;
      r.geste = Array.from(new Set(tout('.gf-gb--arrive, .gf-gb--etat').map((b) => { const x = b.getBoundingClientRect(); return `${Math.round(innerWidth - x.right)}/${Math.round(x.width)}`; })));
      // La barre de gauche : une couleur par statut, jamais deux pour le meme.
      const couleurs = {};
      tout('.gf-r').forEach((tr) => { const t = /\bt-(\w+)/.exec(tr.className)[1]; (couleurs[t] = couleurs[t] || new Set()).add(getComputedStyle(tr.querySelector('td.gf-h')).backgroundColor); });
      r.statuts = Object.keys(couleurs).map((t) => [t, couleurs[t].size]);
      r.distinctes = new Set(Object.values(couleurs).flatMap((s) => Array.from(s))).size;
      return r;
    });
    ok(g.bord.gauche >= 0 && g.bord.gauche <= 8 && g.bord.droite >= 0 && g.bord.droite <= 8, '[A] le tableau va bord a bord, du menu au bord de l ecran', g.bord);
    ok(g.lignesDEnTete === 0 && g.cases === g.demiHeures && g.cases > 0, '[A] plus de rangee d en-tete : une grande case par demi-heure', { lignes: g.lignesDEnTete, cases: g.cases, demiHeures: g.demiHeures });
    ok(g.premier.length === 1 && g.nbAutres > 0 && g.fondsAutres.length === 1 && g.fondsAutres[0] !== g.fondPremier, '[A] un seul bouton plein, le premier « Arrivé » a faire', { premier: g.premier, plein: g.fondPremier, autres: g.fondsAutres });
    ok(g.collapsed && g.bord.rail <= 80 && g.pref === false, '[A] le menu est une barre d icones, le choix de l equipe n a pas bouge', { rail: g.bord.rail, pref: g.pref });
    ok(g.tailleMin >= 12, '[A] rien sous 12 px', g.tailleMin);
    // (une ligne reste legere : sur ce plafond, 46 groupes tiennent en moins de 1 500
    // elements. Mesure 2026-11-02 : 29 par ligne, huit colonnes d activite comprises.)
    ok(g.surface / g.lignes <= 33, '[A] une ligne reste legere (33 elements au plus)', { surface: g.surface, lignes: g.lignes });
    ok(g.geste.length === 1, '[A] le geste : meme place, meme largeur, sur chaque ligne', g.geste);
    ok(g.statuts.length >= 3 && g.statuts.every((x) => x[1] === 1) && g.distinctes === g.statuts.length, '[A] la barre de gauche dit le statut, une couleur par statut', g.statuts);
  });
}

// ---------------------------------------------------------------------------
// [B] UN « ARRIVÉ » NE REECRIT QU UNE LIGNE, RIEN NE BOUGE
// ---------------------------------------------------------------------------
async function arrive(browser) {
  await avec(browser, { lettre: 'B' }, async (page) => {
    const lire = () => page.evaluate(() => {
      const rangs = Array.from(document.querySelectorAll('.gf-r'));
      return { ids: rangs.map((tr) => tr.getAttribute('data-gf-id')), pos: rangs.map((tr) => Math.round(tr.getBoundingClientRect().top)), top: document.querySelector('.gf-defile').scrollTop, premier: (document.querySelector('.is-premier') || { getAttribute: () => null }).getAttribute('data-gf-id') };
    });
    // Le temoin : les rangees elles-memes, pas leur contenu. Une table reecrite
    // entiere rend les memes textes avec d autres noeuds.
    await page.evaluate(() => { window.__rangees = new Set(document.querySelectorAll('.gf-t tbody > tr')); });
    const avant = await lire();
    ok(Boolean(avant.premier), '[B] le montage : il y a un premier « Arrivé » a faire', avant.premier);
    const pax = await page.evaluate((id) => Number(document.querySelector(`[data-gf-id="${id}"] td.gf-n b`).textContent), avant.premier);
    await page.locator('.is-premier [data-gf-arrive]').click();
    await page.waitForFunction((id) => document.querySelector(`[data-gf-id="${id}"] [data-compte-id]`), avant.premier, { timeout: 8000 }).catch(() => null);
    await FX.repos(page, 200);
    const apres = await lire();
    const reecrites = await page.evaluate(() => Array.from(document.querySelectorAll('.gf-t tbody > tr')).filter((tr) => !window.__rangees.has(tr)).length);
    const patchs = await page.evaluate(() => window.__FIXTURE__.patchs.filter((p) => p.status === 'arrived').map((p) => String(p.id)));
    ok(patchs.join() === avant.premier, '[B] « Arrivé » part au serveur, une fois, pour ce groupe', patchs);
    ok(JSON.stringify(avant.ids) === JSON.stringify(apres.ids), '[B] « Arrivé » : l ordre ne bouge pas');
    ok(JSON.stringify(avant.pos) === JSON.stringify(apres.pos) && avant.top === apres.top, '[B] « Arrivé » : aucune ligne ne bouge d un pixel', { top: [avant.top, apres.top] });
    ok(reecrites >= 1 && reecrites <= 2, '[B] « Arrivé » : une ou deux rangees reecrites, le reste de la table ne change pas', reecrites);
    ok(apres.premier && apres.premier !== avant.premier, '[B] le bouton plein passe au groupe suivant', apres.premier);
    const geste = await page.evaluate((id) => document.querySelector(`[data-gf-id="${id}"] .gf-etat`).textContent, avant.premier);
    ok(new RegExp(`Ils sont ${pax}\\b`).test(geste), `[B] « Ils sont ${pax} » a pris la place de « Arrivé »`, geste);
  });
}

// ---------------------------------------------------------------------------
// [C] LES COMPTEURS
// ---------------------------------------------------------------------------
async function compteurs(browser) {
  await avec(browser, { lettre: 'C' }, async (page) => {
    const depart = await vue(page);
    for (const f of ['late', 'upcoming', 'onsite', 'closing']) {
      const n = Number(await page.locator(`[data-gf-filtre="${f}"] .gf-c__v`).innerText());
      await page.locator(`button[data-gf-filtre="${f}"]`).click();
      await FX.repos(page, 150);
      const filtre = await vue(page);
      const presse = await page.locator(`button[data-gf-filtre="${f}"]`).getAttribute('aria-pressed');
      ok(n > 0 && filtre.total === n && filtre.scrollTop === 0 && presse === 'true', `[C] le compteur ${f} montre ses ${n} groupes, depuis le haut`, { n, total: filtre.total, top: filtre.scrollTop, presse });
      await page.locator(`button[data-gf-filtre="${f}"]`).click();
      await FX.repos(page, 150);
      const retour = await vue(page);
      ok(retour.total === depart.total && retour.barre, `[C] ${f} : un second toucher revient a toute la journee, sur l heure`, retour);
    }
    // « TOUT » SE CHOISIT (2026-11-03, Movsar : « ici on doit pouvoir choisir tout aussi ») :
    // d un filtre, « Tout » rend la journee ; un compteur a zero se touche aussi.
    await page.locator('button[data-gf-filtre="upcoming"]').click();
    await FX.repos(page, 150);
    const toutAvant = await page.locator('button[data-gf-filtre="all"]').getAttribute('aria-pressed');
    await page.locator('button[data-gf-filtre="all"]').click();
    await FX.repos(page, 150);
    const toutApres = await vue(page);
    const toutPresse = await page.locator('button[data-gf-filtre="all"]').getAttribute('aria-pressed');
    ok(toutAvant === 'false' && toutPresse === 'true' && toutApres.total === depart.total, '[C] « Tout » rend toute la journee, et se dit choisi', { toutAvant, toutPresse, total: toutApres.total, attendu: depart.total });
    const zeros = await page.evaluate(() => Array.from(document.querySelectorAll('#planningBande .gf-c.is-zero')).map((e) => e.tagName));
    ok(zeros.every((t) => t === 'BUTTON'), '[C] un compteur a zero se touche aussi', zeros);
  });
}

// ---------------------------------------------------------------------------
// [D] TAPER UN NOM, DE N IMPORTE OU
// ---------------------------------------------------------------------------
async function nom(browser) {
  await avec(browser, { lettre: 'D' }, async (page) => {
    const champ = () => page.locator('#globalPlanningSearchInput').inputValue();
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.type('Mass', { delay: 15 });
    await FX.repos(page, 150);
    const r1 = await vue(page);
    ok(await champ() === 'Mass' && r1.total === 1, '[D] taper de n importe ou ecrit dans le champ, le tableau ne garde que le groupe', { valeur: await champ(), total: r1.total });
    const id = await page.evaluate(() => document.querySelector('.gf-r').getAttribute('data-gf-id'));
    await page.keyboard.press('Enter');
    await FX.repos(page, 250);
    const pointe = await page.evaluate((i) => state.reservations.find((x) => String(x.id) === i).status, id);
    const focus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    ok(pointe === 'arrived' && await champ() === '' && focus === 'globalPlanningSearchInput', '[D] Entree pointe le seul groupe attendu, le champ se vide et garde le curseur', { pointe, focus });
    // Un mot commun a plusieurs groupes, le premier encore attendu : Entree ne choisit pas
    // a la place de celui qui est au comptoir.
    const terme = await page.evaluate(() => {
      const rangs = Array.from(document.querySelectorAll('.gf-r')).map((tr) => ({ nom: tr.querySelector('.gf-nom__t').textContent.toLowerCase(), attendu: Boolean(tr.querySelector('[data-gf-arrive]')) }));
      for (const r of rangs.filter((x) => x.attendu)) {
        const mot = r.nom.split(/\s+/).find((m) => /^\p{L}{3,}$/u.test(m) && rangs.find((x) => x.nom.includes(m)) === r && rangs.filter((x) => x.nom.includes(m)).length > 1);
        if (mot) return mot;
      }
      return '';
    });
    await page.keyboard.type(terme, { delay: 15 });
    await FX.repos(page, 150);
    const plusieurs = await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.gf-r')); return { total: r.length, attendu: Boolean(r[0] && r[0].querySelector('[data-gf-arrive]')) }; });
    ok(terme !== '' && plusieurs.total > 1 && plusieurs.attendu, '[D] le montage : plusieurs groupes restent, le premier encore attendu', { terme, plusieurs });
    const avant = await page.evaluate(() => window.__FIXTURE__.patchs.length);
    await page.keyboard.press('Enter');
    await FX.repos(page, 200);
    const apres = await page.evaluate(() => window.__FIXTURE__.patchs.length);
    ok(avant === apres, '[D] Entree ne pointe rien s il reste plusieurs groupes', { terme, avant, apres });
    await page.keyboard.press('Escape');
    await FX.repos(page, 150);
    ok(await champ() === '' && (await vue(page)).total === GROUPES_DU_PIC, '[D] Echap vide le champ, toute la journee revient');
    await page.keyboard.type('zzzz', { delay: 15 });
    await FX.repos(page, 150);
    const rien = await page.evaluate(() => (document.querySelector('.gf-rien') || { textContent: '' }).textContent);
    ok((await vue(page)).total === 0 && /zzzz/.test(rien), '[D] un nom inconnu le dit, avec ce qui a ete tape', rien);
    await page.keyboard.press('Escape');
    await FX.repos(page, 150);
    await page.keyboard.type('Arth', { delay: 15 });
    await FX.repos(page, 150);
    const double = await page.evaluate(() => { const r = document.querySelector('.gf-r'); return { texte: r.querySelector('.gf-etat').textContent.replace(/\s+/g, ' '), boutons: r.querySelectorAll('[data-gf-payer]').length, total: document.querySelectorAll('.gf-r').length }; });
    ok(double.total === 1 && /Ils sont/.test(double.texte) && double.boutons === 2, '[D] un nom tape sur un groupe sur place : son nombre, son montant, Carte et Espèces', double);
    await page.keyboard.press('Escape');
    await FX.repos(page, 150);
  });
}

// ---------------------------------------------------------------------------
// [E] « PAS VENU »
// ---------------------------------------------------------------------------
async function pasVenu(browser) {
  await avec(browser, { lettre: 'E' }, async (page) => {
    const lignes = await lignesDuJour(page);
    const retards = lignes.filter((l) => /\bis-retard\b/.test(l.cls)).map((l) => ({ ...l, min: minutesDe(l.retard) }));
    const tot = retards.filter((l) => l.min < 15);
    const tard = retards.filter((l) => l.min >= 15);
    ok(tot.length > 0 && tard.length > 0, '[E] le montage : des retards de moins de 15 min et d autres de plus', retards.map((l) => l.retard));
    ok(tot.every((l) => !l.pasVenu), '[E] sous 15 min de retard, pas de « Pas venu » (le groupe se gare)', tot.filter((l) => l.pasVenu).map((l) => l.nom));
    ok(tard.every((l) => l.pasVenu), '[E] a partir de 15 min de retard, « Pas venu » est la', tard.filter((l) => !l.pasVenu).map((l) => l.nom));
    const jamais = lignes.filter((l) => /^À clôturer/.test(l.caisse) && l.du.length <= 5);
    ok(jamais.length > 0 && jamais.every((l) => l.pasVenu), '[E] une visite finie sans jamais etre pointee a son « Pas venu »', jamais.map((l) => l.nom));
    // Un groupe qui a annonce son retard n est pas un groupe qui ne vient pas.
    const annonce = tard[0];
    await page.evaluate((id) => { const r = state.reservations.find((x) => String(x.id) === id); r.opsPlan = Object.assign({}, r.opsPlan, { delayFlag: { minutes: 30 } }); renderStaff(); }, annonce.id);
    await FX.repos(page, 150);
    const apresAnnonce = (await lignesDuJour(page)).find((l) => l.id === annonce.id);
    ok(!apresAnnonce.pasVenu && /\bis-retard\b/.test(apresAnnonce.cls), '[E] jamais sur un groupe qui a annonce son retard', apresAnnonce);
    // Le geste : il part au serveur, la ligne reste a sa place, grise.
    const cible = tard[1] || tot[0];
    const ordre = lignes.map((l) => l.id).join();
    await page.locator(`[data-gf-absent="${cible.id}"]`).click();
    await page.waitForFunction((id) => document.querySelector(`.gf-r.is-absent[data-gf-id="${id}"]`), cible.id, { timeout: 8000 }).catch(() => null);
    await FX.repos(page, 150);
    const envoi = await page.evaluate((id) => window.__FIXTURE__.patchs.filter((p) => String(p.id) === id && p.absent === true).length, cible.id);
    const apres = await lignesDuJour(page);
    const ligne = apres.find((l) => l.id === cible.id);
    ok(envoi === 1 && /\bis-absent\b/.test(ligne.cls) && /Pas venu/.test(ligne.etat) && !ligne.pasVenu && apres.map((l) => l.id).join() === ordre, '[E] « Pas venu » s ecrit, la ligne reste a sa place, grise', { envoi, ligne });
  });
}

// ---------------------------------------------------------------------------
// [F] AGRANDIR
// ---------------------------------------------------------------------------
async function plein(browser) {
  await avec(browser, { lettre: 'F' }, async (page) => {
    const v0 = await vue(page);
    await page.locator('#planningAgrandir').click();
    await FX.repos(page, 300);
    const p = await page.evaluate(() => {
      const boite = document.getElementById('globalPlanningBox');
      const b = boite.getBoundingClientRect();
      const champ = document.getElementById('globalPlanningSearchInput');
      const c = champ.getBoundingClientRect();
      const now = document.querySelector('.gf-now').getBoundingClientRect();
      const d = document.querySelector('.gf-defile').getBoundingClientRect();
      return { pleinEcran: Boolean(document.fullscreenElement) && document.body.getBoundingClientRect().width - b.width <= 14 && b.bottom >= innerHeight - 8, champVisible: c.width > 100 && c.top >= 0 && c.bottom < innerHeight, dansLaBarre: document.getElementById('planningBarre').contains(champ), barre: now.top >= d.top && now.bottom <= d.bottom };
    });
    ok(p.pleinEcran && p.champVisible && p.dansLaBarre && p.barre, '[F] Agrandir : plein ecran, le champ dans la barre, la barre de l heure a l ecran', p);
    const t = await teteDegagee(page);
    ok(t.ok, '[F] Agrandir : rien ne recouvre rien dans la barre', t);
    const vp = await vue(page);
    ok(vp.entieres >= v0.entieres, '[F] Agrandir montre au moins autant de lignes', { avant: v0.entieres, apres: vp.entieres });
    await page.locator('#planningAgrandir').click();
    await FX.repos(page, 300);
    const r = await page.evaluate(() => { const c = document.getElementById('globalPlanningSearchInput'); return { dansLaBarre: Boolean(c.closest('#planningBarre')), plein: Boolean(document.fullscreenElement), w: Math.round(c.getBoundingClientRect().width) }; });
    ok(r.dansLaBarre && !r.plein && r.w > 200, '[F] Reduire : le champ reste dans la barre, le plein ecran se quitte', r);
    ok((await vue(page)).barre, '[F] Reduire : le tableau revient sur la barre de l heure');
  });
}

// ---------------------------------------------------------------------------
// [G] LE MENU REPLIE RESTE UTILISABLE, QUITTER L ECRAN REND TOUT
// ---------------------------------------------------------------------------
async function menu(browser) {
  await avec(browser, { lettre: 'G' }, async (page) => {
    const lire = () => page.evaluate(() => ({ collapsed: document.body.classList.contains('staff-menu-collapsed'), large: document.body.classList.contains('gf-large'), rail: Math.round(document.querySelector('.ops-sidebar').getBoundingClientRect().width), vue: state.staffResourceView, pref: Boolean(state.staffMenuCollapsed), barre: getComputedStyle(document.getElementById('planningBarre')).display, champ: getComputedStyle(document.getElementById('gfRecherche')).display }));
    const barre = await lire();
    ok(barre.collapsed && barre.large && barre.rail <= 80, '[G] le montage : le grand tableau, le menu en barre', barre);
    await page.locator('[data-fgx-menu-toggle="planning"]').first().click();
    await FX.repos(page, 200);
    const pop = await page.evaluate(() => { const p = document.querySelector('.fgx-menu-popover.planning'); return p ? p.textContent.replace(/\s+/g, ' ') : ''; });
    ok(/Bowling/.test(pop) && /Laser/.test(pop) && /Complet/.test(pop), '[G] « Planning » sur la barre ouvre ses trois plannings', pop);
    await page.locator('.fgx-menu-popover.planning [data-ops-resource="bowling"]').click();
    await FX.repos(page, 400);
    const bowling = await lire();
    ok(bowling.vue === 'bowling' && bowling.collapsed && bowling.large && bowling.rail <= 80 && !bowling.pref && bowling.champ !== 'none' && bowling.barre !== 'none', '[G] Bowling : la meme barre, le meme menu replie, le choix de l equipe n a pas bouge', bowling);
    await page.locator('[data-fgx-menu-toggle="planning"]').first().click();
    await FX.repos(page, 200);
    await page.locator('.fgx-menu-popover.planning [data-ops-resource="all"]').click();
    await FX.repos(page, 400);
    const rev = await lire();
    ok(rev.collapsed && rev.large && rev.rail <= 80 && !rev.pref, '[G] Complet : la barre reste', rev);
    await page.locator('[data-fgx-menu-collapse]').click();
    await FX.repos(page, 400);
    const ouvert = await lire();
    const cote = await page.evaluate(() => { const d = document.querySelector('.gf-defile'); return d.scrollWidth - d.clientWidth; });
    ok(ouvert.rail > 200 && !ouvert.pref && ouvert.large, '[G] « Ouvrir le menu » rouvre ici, sans toucher au choix de l equipe', ouvert);
    ok(cote <= 0, '[G] menu rouvert : le tableau tient sans defiler de cote', cote);
    await page.locator('[data-fgx-menu-collapse]').click();
    await FX.repos(page, 300);
    await page.locator('[data-fgx-menu-key="reservations"]').first().click();
    await FX.repos(page, 400);
    const autre = await lire();
    ok(autre.rail > 200 && !autre.large && autre.barre === 'none', '[G] Réservations : le menu est entier, la barre des plannings n y est pas', autre);
  });
}

// ---------------------------------------------------------------------------
// [H] LA BARRE DANS UNE DEMI-HEURE : une heure qui n est pas pile
// ---------------------------------------------------------------------------
async function coupe(browser) {
  await avec(browser, { lettre: 'H', heure: '15:40' }, async (page) => {
    const c = await page.evaluate(() => {
      const r = state.reservations.find((x) => /Sacha/.test(x.name));
      r.startTime = '15:50';
      renderStaff();
      const t = Array.from(document.querySelectorAll('.gf-t tbody tr'));
      const i = t.findIndex((x) => x.classList.contains('gf-now'));
      const suivante = t[i + 1];
      const heure = suivante.querySelector('.gf-nom__h');
      return { avant: t[i - 1].querySelector('.gf-nom__t').textContent, apres: suivante.querySelector('.gf-nom__t').textContent, suite: Boolean(suivante.querySelector('.gf-bloc.is-suite')), heure: heure ? heure.textContent : '', voit: heure ? getComputedStyle(heure).display : 'none' };
    });
    ok(/Sacha/.test(c.apres), '[H] le montage : Sacha, 15:50, vient juste apres la barre de 15:40', c);
    ok(c.suite && c.voit !== 'none' && c.heure === '15:50', '[H] la barre coupe une demi-heure : la suite reste dans son bloc, son heure sur sa ligne', c);
  });
}

// ---------------------------------------------------------------------------
// [I] LA NOTE D UN GROUPE EN RETARD, LE CONTRASTE
// ---------------------------------------------------------------------------
function lireContraste() {
  const lire = (s) => { const m = String(s).match(/-?[0-9.]+/g).map(Number); if (/^color\(srgb/.test(s)) return { r: m[0] * 255, g: m[1] * 255, b: m[2] * 255, a: m[3] === undefined ? 1 : m[3] }; return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] }; };
  const fond = (el) => { const pile = []; for (let n = el; n; n = n.parentElement) { const c = lire(getComputedStyle(n).backgroundColor); if (c.a > 0) { pile.push(c); if (c.a >= 1) break; } } let b = pile.length ? pile[pile.length - 1] : { r: 255, g: 255, b: 255, a: 1 }; if (b.a < 1) b = { r: 255, g: 255, b: 255, a: 1 }; for (let i = pile.length - 2; i >= 0; i -= 1) { const c = pile[i]; b = { r: c.r * c.a + b.r * (1 - c.a), g: c.g * c.a + b.g * (1 - c.a), b: c.b * c.a + b.b * (1 - c.a), a: 1 }; } return b; };
  const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const rapport = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mauvais = {};
  let vus = 0;
  document.querySelectorAll('#globalPlanningGridWrap *, #gfRecherche input').forEach((el) => {
    if (!Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim())) return;
    if (el.closest('.gf-now')) return;
    vus += 1;
    const v = rapport(lire(getComputedStyle(el).color), fond(el));
    if (v >= 4.5) return;
    const ligne = el.closest('.gf-r');
    const cle = `${typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : el.tagName} ${ligne ? ligne.className.replace('gf-r ', '').split(' ').slice(0, 3).join('.') : ''}`;
    if (!mauvais[cle] || mauvais[cle] > v) mauvais[cle] = Math.round(v * 100) / 100;
  });
  return { vus, mauvais };
}
async function noteContraste(browser) {
  await avec(browser, { lettre: 'I' }, async (page) => {
    const note = await page.evaluate(() => {
      const r = state.reservations.find((x) => /Amis de Clara/.test(x.name));
      const autre = state.reservations.find((x) => /Zoé/.test(x.name));
      r.phone = '0471 23 45 67';
      r.notes = 'Gâteau apporté par les parents, à sortir à 16 h.';
      autre.phone = '0498 76 54 32';
      autre.notes = 'Un enfant allergique aux arachides, voir avec la maman au comptoir avant le goûter.';
      renderStaff();
      const l = document.querySelector(`.gf-r[data-gf-id="${r.id}"]`);
      const client = l.querySelector('.gf-i--client');
      const tel = l.querySelector('.gf-nom__l .gf-nom__tel');
      return { client: client ? client.textContent : '', tel: tel ? tel.getAttribute('href') : '', texteTel: tel ? tel.textContent : '', retard: l.classList.contains('is-retard') };
    });
    ok(note.retard, '[I] le montage : Amis de Clara sont en retard', note);
    ok(/0471/.test(note.texteTel) && /Gâteau/.test(note.client) && note.tel === 'tel:0471234567', '[I] une ligne en retard : le telephone a cote du nom, le mot du client dans sa rubrique', note);
    for (const theme of ['clair', 'sombre']) {
      if (theme === 'sombre') { await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await FX.repos(page, 150); }
      const res = await page.evaluate(lireContraste);
      ok(res.vus > 300 && Object.keys(res.mauvais).length === 0, `[I] contraste 4,5:1 en ${theme}, sur tout ce qui s ecrit`, res);
    }
  });
}

// ---------------------------------------------------------------------------
// [J] LA MINUTE PASSE, LA BARRE AVANCE, LA FEUILLE SUIT
// ---------------------------------------------------------------------------
async function minute(browser) {
  await avec(browser, { lettre: 'J' }, async (page) => {
    const y = () => page.evaluate(() => Math.round(document.querySelector('.gf-now').getBoundingClientRect().top));
    const passe = async (h) => { await page.clock.setFixedTime(FX.instant(JOUR, h)); await page.evaluate(() => tickHorlogeStaff()); await FX.repos(page, 150); };
    const y0 = await y();
    await passe('15:31');
    const suivi = await page.evaluate(() => ({ suit: document.getElementById('globalPlanningGridWrap')._gfSuit, h: document.querySelector('[data-gf-maintenant]').textContent, st: document.querySelector('.gf-defile').scrollTop }));
    ok(suivi.h === '15:31', '[J] le montage : la barre est passee a 15:31', suivi);
    ok(Math.abs((await y()) - y0) <= 2 && suivi.suit, '[J] la barre passe une demi-heure : elle reste a sa hauteur, la feuille suit', { y0, y: await y(), ...suivi });
    // LA BOITE QUI GRANDIT SOUS LA FEUILLE (2026-11-03, [N1] rouge de planning-global) : le
    // navigateur ramene le defilement au nouveau bout, 30 px au-dessus de la ligne du haut.
    // Ce n est pas une main : la feuille suit toujours l heure, aucune ligne coupee sous la tete.
    const grandit = await page.evaluate(async () => {
      const d = document.querySelector('.gf-defile');
      const s0 = d.scrollTop;
      if (s0 < 60) return { manque: true, s0 };
      const avant = d.style.height;
      d.style.height = (d.scrollHeight - (s0 - 30)) + 'px';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))));
      const haut = d.querySelector('thead th').getBoundingClientRect().bottom;
      const coupees = Array.from(d.querySelectorAll('tbody > tr')).filter((tr) => { const b = tr.getBoundingClientRect(); return b.top < haut - 1 && b.bottom > haut + 1; }).length;
      const lu = { s0, st: d.scrollTop, fond: d.scrollHeight - d.clientHeight, suit: document.getElementById('globalPlanningGridWrap')._gfSuit, coupees };
      d.style.height = avant;
      return lu;
    });
    await FX.repos(page, 150);
    ok(!grandit.manque && grandit.st < grandit.s0 && grandit.suit && grandit.coupees === 0, '[J] la boite grandit sous la feuille : elle suit toujours l heure, aucune ligne coupee sous la tete', grandit);
    // Une main sur la feuille : rien ne bouge sous elle.
    await page.mouse.move(700, 400);
    await page.mouse.move(705, 402);
    const avant = await page.evaluate(() => document.querySelector('.gf-defile').scrollTop);
    await passe('16:01');
    const apres = await page.evaluate(() => document.querySelector('.gf-defile').scrollTop);
    ok(avant === apres, '[J] une main qui bouge sur la feuille : la feuille ne saute pas sous elle', { avant, apres });
  });
}

// ---------------------------------------------------------------------------
// [K] UN AUTRE JOUR
// ---------------------------------------------------------------------------
async function autreJour(browser) {
  await avec(browser, { lettre: 'K' }, async (page) => {
    // La veille et le lendemain ont des groupes : la meme journee, recopiee.
    await page.evaluate(() => {
      const F = window.__FIXTURE__;
      const decale = (n) => { const d = new Date(`${F.jour}T12:00:00`); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
      [-1, 1].forEach((n) => { const j = decale(n); F.jours[j] = F.jours[F.jour].map((r) => Object.assign({}, r, { date: j })); });
    });
    const lire = () => page.evaluate(() => ({ auj: Boolean(document.querySelector('#planningBande [data-gf-horloge]')), btn: (() => { const b = document.querySelector('#planningBande .staff-today-btn'); return b ? getComputedStyle(b).display : 'none'; })(), lignes: document.querySelectorAll('.gf-r').length, now: document.querySelectorAll('.gf-now').length, reserver: document.querySelectorAll('td[data-gf-reserver]').length, horloge: document.querySelectorAll('[data-gf-horloge]').length, tete: document.getElementById('planningBande').textContent.replace(/\s+/g, ' ').slice(0, 60) }));
    await page.evaluate(() => { shiftDate(-1); });
    await page.waitForFunction(() => document.querySelectorAll('.gf-r').length > 0 && !document.querySelector('.gf-now'), null, { timeout: 8000 }).catch(() => null);
    await FX.repos(page, 200);
    const hier = await lire();
    ok(hier.lignes === GROUPES_DU_PIC, '[K] le montage : la veille a ses groupes', hier);
    ok(!hier.auj && hier.now === 0 && hier.horloge === 0 && hier.btn !== 'none', '[K] un jour passe : ni barre ni horloge, « Aujourd hui » revient', hier);
    ok(hier.reserver === 0, '[K] un jour passe ne reserve plus', hier.reserver);
    await page.evaluate(() => { shiftDate(2); });
    await page.waitForFunction(() => document.querySelectorAll('td[data-gf-reserver]').length > 0, null, { timeout: 8000 }).catch(() => null);
    await FX.repos(page, 200);
    const demain = await lire();
    ok(demain.lignes === GROUPES_DU_PIC && demain.now === 0 && demain.reserver > 0, '[K] un jour a venir : pas de barre, chaque demi-heure reserve', demain);
  });
}

// ---------------------------------------------------------------------------
// [L] LA BARRE AGRANDIE, A TOUTES LES LARGEURS
// ---------------------------------------------------------------------------
async function teteLargeurs(browser) {
  await avec(browser, { lettre: 'L' }, async (page) => {
    await page.evaluate(() => { toggleGlobalPlanningExpanded(); });
    await FX.repos(page, 250);
    for (const [l, h] of [[1920, 1080], [1640, 900], [1600, 900], [1400, 900], [1366, 768], [1280, 720], [1200, 800], [1199, 800], [1100, 800], [1024, 768], [900, 700], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width: l, height: h });
      await page.waitForTimeout(200);
      const t = await teteDegagee(page);
      ok(t.ok, `[L] agrandi a ${l} px : rien ne recouvre rien dans la barre`, t);
    }
  });
}

// Agrandie au telephone, la boite est fixe : c est la liste qui defile, elle s ouvre sur
// l heure, et la tete reste a l ecran.
async function agrandiTelephone(browser) {
  await avec(browser, { lettre: 'L', appareil: 'telephone', avantChargement: (page) => page.addInitScript(sansRemiseEnHaut) }, async (page) => {
    await page.evaluate(() => { toggleGlobalPlanningExpanded(); });
    await FX.repos(page, 300);
    const o = await page.evaluate(() => {
      const d = document.querySelector('.gf-defile');
      const b = d.getBoundingClientRect();
      const n = d.querySelector('.gf-now').getBoundingClientRect();
      const tete = document.getElementById('planningBarre').getBoundingClientRect();
      return { defile: d.scrollHeight > d.clientHeight + 1, overflow: getComputedStyle(d).overflowY, st: Math.round(d.scrollTop), haut: Math.round(n.top), bas: Math.round(n.bottom), liste: [Math.round(b.top), Math.round(b.bottom)], tete: Math.round(tete.top), ih: innerHeight };
    });
    ok(o.defile && /auto|scroll/.test(o.overflow), '[L] agrandie au telephone, la liste defile dans sa boite', o);
    ok(o.st > 0 && o.haut >= o.liste[0] - 1 && o.bas <= Math.min(o.liste[1], o.ih) + 1, '[L] et s ouvre sur l heure', o);
    ok(o.tete >= 0, '[L] sans pousser la barre hors de l ecran', o);
  });
}

// ---------------------------------------------------------------------------
// [M] LE TEXTE RESTE DANS SA CASE, PARTOUT
// ---------------------------------------------------------------------------
// (les montants du jour de test ont trois chiffres : on en essaie de plus longs)
async function montantsLongs(page) {
  const r = await page.evaluate(() => {
    let i = 0;
    state.reservations.forEach((x) => { if (x.status !== 'paid' && prixDossierConnu(x)) { x.price = i % 2 ? 1240 : 139.5; i += 1; } });
    renderStaff();
    return Array.from(new Set(Array.from(document.querySelectorAll('.gf-du:not(.is-sans)')).map((e) => e.textContent)));
  });
  await FX.repos(page, 150);
  return r;
}
const rouvrirLeMenu = async (page) => { await page.locator('[data-fgx-menu-collapse]').click(); await FX.repos(page, 300); };
async function texteCase(browser) {
  await avec(browser, { lettre: 'M' }, async (page) => {
    const vus = await montantsLongs(page);
    ok(vus.some((x) => /1.240/.test(x)), '[M] le montage : les montants longs sont a l ecran', vus);
  });
  for (const [nomCas, o, geste] of [
    ['montants longs, 1366 px', {}, montantsLongs],
    ['montants longs, menu rouvert', {}, async (p) => { await rouvrirLeMenu(p); await montantsLongs(p); }],
    ['montants longs, tablette', { appareil: 'tablette' }, montantsLongs],
    ['1366 px', {}, null],
    ['1366 px a 18:20', { heure: '18:20' }, null],
    ['1366 px, menu rouvert', {}, rouvrirLeMenu],
    ['1200 px, agrandi', {}, async (p) => { await p.setViewportSize({ width: 1200, height: 800 }); await p.evaluate(() => { toggleGlobalPlanningExpanded(); }); await FX.repos(p, 250); }],
    ['1920 px', {}, async (p) => { await p.setViewportSize({ width: 1920, height: 1080 }); await FX.repos(p, 250); }],
    ['tablette', { appareil: 'tablette' }, null],
    ['tablette a 18:20', { appareil: 'tablette', heure: '18:20' }, null],
    ['tablette debout', { appareil: 'tablette-portrait' }, null],
    ['pire jour', { fixture: 'pire' }, null],
    ['pire jour, tablette', { fixture: 'pire', appareil: 'tablette' }, null],
    ['pire jour, menu rouvert', { fixture: 'pire' }, rouvrirLeMenu],
  ]) {
    await avec(browser, { lettre: 'M', ...o }, async (page) => {
      if (geste) await geste(page);
      const t = await texteDansSaCase(page);
      ok(t.ok, `[M] le texte reste dans sa case : ${nomCas}`, t);
    });
  }
}

// ---------------------------------------------------------------------------
// [N] LES AUTRES JOURS
// ---------------------------------------------------------------------------
async function jours(browser) {
  for (const fixture of ['calme', 'ferme', 'vide', 'pire']) {
    await avec(browser, { lettre: 'N', fixture }, async (page) => {
      const m = await page.evaluate(() => { const d = document.querySelector('.gf-defile'); return { large: document.body.classList.contains('gf-large'), page: document.documentElement.scrollWidth - document.documentElement.clientWidth, cote: d ? d.scrollWidth - d.clientWidth : null, lignes: document.querySelectorAll('.gf-r').length, bandeau: (document.querySelector('.gf-bandeau:not([hidden])') || {}).textContent || '' }; });
      ok(m.large, `[N] ${fixture} : le grand tableau est monte`, m);
      ok(m.page <= 0 && (m.cote == null || m.cote <= 0), `[N] ${fixture} : rien ne deborde`, m);
      if (fixture === 'ferme') ok(/fermé/i.test(m.bandeau) && m.lignes === 0, '[N] ferme : le bandeau le dit, aucune ligne', m);
      if (fixture === 'vide') ok(/Aucune réservation/.test(m.bandeau) && m.lignes === 0, '[N] vide : le bandeau le dit, aucune ligne', m);
      if (fixture === 'ferme') ok(await page.evaluate(() => document.querySelectorAll('[data-gf-etat]').length) === 0, '[N] ferme : ni pistes libres ni prochain depart');
    });
  }
}

// ---------------------------------------------------------------------------
// [P] LA CASE D HEURE RESERVE A SON HEURE
// ---------------------------------------------------------------------------
async function caseHeure(browser) {
  await avec(browser, { lettre: 'P' }, async (page) => {
    // 17:00 : une heure ou quatre joueurs tiennent, loin de celle que Réserver prendrait
    // de lui-meme (il propose la plus proche, 15:00).
    const c = await page.evaluate(() => {
      const td = document.querySelector('td[data-gf-reserver="17:00"]');
      const passees = Array.from(document.querySelectorAll('td.gf-bloc[data-gf-bloc]:not([data-gf-reserver])'));
      return { heure: td ? td.getAttribute('data-gf-reserver') : null, bouton: td ? td.querySelector('.gf-bloc__in').tagName : '', passee: passees.length ? passees[passees.length - 1].getAttribute('data-gf-bloc') : null };
    });
    ok(Boolean(c.heure) && c.bouton === 'BUTTON', '[P] le montage : la case de 17:00 est ouverte, un bouton la porte au clavier', c);
    await page.locator(`td[data-gf-reserver="${c.heure}"]`).click({ position: { x: 6, y: 6 } });
    await FX.repos(page, 250);
    const o = await ouvertures(page);
    ok(o.reserver && !o.fiche && o.heure === c.heure, '[P] la case ouvre Réserver a son heure, pas la fiche du premier groupe', o);
    await fermer(page);
    await FX.repos(page, 150);
    // Au clavier : le meme geste.
    await page.locator(`td[data-gf-reserver="${c.heure}"] .gf-bloc__in`).focus();
    await page.keyboard.press('Enter');
    await FX.repos(page, 250);
    const k = await ouvertures(page);
    ok(k.reserver && !k.fiche && k.heure === c.heure, '[P] au clavier : Entree sur la case fait le meme geste', k);
    await fermer(page);
    await FX.repos(page, 150);
    // (une heure qui ne tient pas va sur la plus proche, et le dit : il faut le vrai serveur
    // pour le plan, scripts/comptoir-reserver-check.js [R2] le garde)
    // Ce qui est passe n a plus rien a offrir, et ne s ouvre sur rien.
    if (ok(Boolean(c.passee), '[P] le montage : une case passee est a l ecran', c)) {
      await page.locator(`td[data-gf-bloc="${c.passee}"]`).first().click({ position: { x: 6, y: 6 } });
      await FX.repos(page, 200);
      const p = await ouvertures(page);
      ok(!p.reserver && !p.fiche, '[P] une case passee n ouvre ni Réserver ni une fiche', p);
    }
  });
}

// ---------------------------------------------------------------------------
// [Q] LE BANDEAU : L ETAT DU CENTRE MENE A SON GESTE
// ---------------------------------------------------------------------------
async function bandeau(browser) {
  // (les noms du prochain depart ne se montrent qu au-dessus de 1300 px de barre)
  await avec(browser, { lettre: 'Q', appareil: 'ordinateur' }, async (page) => {
    const b = await page.evaluate(() => {
      const t = document.getElementById('planningBande');
      const present = (id) => { const tr = document.querySelector(`.gf-r[data-gf-id="${id}"]`); return tr ? /\bt-(arr|paid)\b/.test(tr.className) : null; };
      return {
        horloge: (t.querySelector('[data-gf-horloge]') || {}).textContent,
        direct: (t.querySelector('[data-gf-direct]') || {}).textContent,
        compteurs: t.querySelectorAll('[data-gf-filtre] .gf-c__v').length,
        tout: Boolean(t.querySelector('button[data-gf-filtre="all"]')),
        etats: Array.from(t.querySelectorAll('[data-gf-etat]')).map((e) => ({ cle: e.getAttribute('data-gf-etat'), haut: e.querySelector('.gf-e__h').tagName, v: e.querySelector('.gf-e__v').textContent })),
        groupes: Array.from(t.querySelectorAll('[data-gf-etat="laser"] .gf-e__g')).map((g) => ({ tag: g.tagName, id: g.getAttribute('data-gf-fiche'), texte: g.textContent, present: present(g.getAttribute('data-gf-fiche')) })),
      };
    });
    ok(b.horloge === '15:10' && Boolean(b.direct) && b.tout && b.compteurs === 4 && b.etats.map((e) => e.cle).join() === 'bowling,laser', '[Q] le bandeau : l heure, ce que vaut l ecran, « Tout » et quatre compteurs, les pistes, le laser', b);
    ok(b.etats.every((e) => e.haut === 'BUTTON'), '[Q] le haut de chaque etat est un bouton', b.etats);
    ok(b.groupes.length >= 2 && b.groupes.every((g) => g.tag === 'BUTTON' && g.id), '[Q] le montage : les groupes du prochain depart sont des boutons', b.groupes);
    ok(b.groupes.some((g) => g.present) && b.groupes.some((g) => !g.present), '[Q] le montage : un groupe du depart est la, un autre pas', b.groupes);
    ok(b.groupes.every((g) => /pas là/.test(g.texte) === !g.present), '[Q] « pas là » pour un groupe absent, et pour lui seul', b.groupes);
    // Un nom ouvre sa fiche, et rien d autre.
    const g = b.groupes[0];
    await page.locator(`.gf-e__g[data-gf-fiche="${g.id}"]`).click();
    await FX.repos(page, 250);
    const fiche = await ouvertures(page);
    ok(fiche.fiche && fiche.groupe === g.id && !fiche.reserver, '[Q] un nom du bandeau ouvre la fiche de ce groupe', fiche);
    await fermer(page);
    await FX.repos(page, 150);
    // Les pistes : « Pistes 4 libres » ouvre Réserver.
    await page.locator('[data-gf-etat="bowling"] .gf-e__h').click();
    await FX.repos(page, 250);
    const pistes = await ouvertures(page);
    ok(pistes.reserver && !pistes.fiche && pistes.type === 'bowling', '[Q] « Pistes » ouvre Réserver, au bowling', pistes);
    await fermer(page);
    await FX.repos(page, 150);
    // Le laser : sur son prochain depart, a l heure ou le groupe arrive (cinq a dix minutes
    // avant de jouer), et elle ne se change pas : c est ce depart-la qu on a touche.
    const depart = (/^(\d{2}:\d{2})/.exec(b.etats.find((e) => e.cle === 'laser').v) || [])[1];
    await page.locator('[data-gf-etat="laser"] .gf-e__h').click();
    await FX.repos(page, 250);
    const laser = await ouvertures(page);
    const enMinutes = (h) => { const [x, y] = String(h).split(':').map(Number); return x * 60 + y; };
    const avance = enMinutes(depart) - enMinutes(laser.heure);
    ok(Boolean(depart) && laser.reserver && laser.type === 'laser' && avance > 0 && avance <= 10 && laser.verrou && laser.heureLue.startsWith(laser.heure), '[Q] « Laser » ouvre Réserver sur son prochain depart, heure d arrivee verrouillee', { depart, avance, laser });
    await fermer(page);
    await FX.repos(page, 150);
    // Complet, son planning dit quand ca se libere.
    await page.evaluate(() => { Object.keys(state.laneStatuses).forEach((k) => { state.laneStatuses[k] = 'maintenance'; }); renderStaff(); });
    await FX.repos(page, 200);
    const complet = await page.evaluate(() => document.querySelector('[data-gf-etat="bowling"] .gf-e__v').textContent);
    ok(/complet/.test(complet), '[Q] le montage : plus une piste', complet);
    await page.locator('[data-gf-etat="bowling"] .gf-e__h').click();
    await FX.repos(page, 400);
    const plein2 = await ouvertures(page);
    ok(plein2.bowling && !plein2.reserver, '[Q] complet, « Pistes » ouvre le planning bowling, pas Réserver', plein2);
  });
}

// ---------------------------------------------------------------------------
// [R] LE RETARD SE TOUCHE
// ---------------------------------------------------------------------------
async function retard(browser) {
  await avec(browser, { lettre: 'R' }, async (page) => {
    // Le plan de retard part au serveur (/api/ops) : on releve ce qui part.
    await page.evaluate(() => {
      window.__ops = [];
      const f = window.fetch;
      window.fetch = (u, init) => { if (init && init.body && String(u.url || u).includes('/api/ops')) { try { window.__ops.push(JSON.parse(init.body)); } catch (e) { /* un corps sans JSON n interesse pas */ } } return f(u, init); };
    });
    const l = (await lignesDuJour(page)).find((x) => /\bis-retard\b/.test(x.cls) && minutesDe(x.retard) >= 15);
    const deja = minutesDe(l.retard);
    const tag = await page.evaluate((id) => document.querySelector(`[data-gf-id="${id}"] [data-gf-retarder]`).tagName, l.id);
    ok(tag === 'BUTTON' && deja >= 15, '[R] le montage : le retard est un bouton', { tag, retard: l.retard });
    await page.locator(`[data-gf-id="${l.id}"] [data-gf-retarder]`).click();
    await FX.repos(page, 200);
    const bulle = await page.evaluate(() => Array.from(document.querySelectorAll('.staff-action-popover button')).map((b) => b.textContent.trim()));
    ok(bulle.join() === '10 min,20 min,30 min', '[R] le retard ouvre sa bulle : 10, 20, 30 min', bulle);
    await page.locator('.staff-action-popover button', { hasText: '20 min' }).click();
    await FX.repos(page, 250);
    const envoi = await page.evaluate(() => window.__ops.filter((c) => c.action === 'delayImpact'));
    ok(envoi.length === 1 && String(envoi[0].reservationId) === l.id && envoi[0].delayMinutes === deja + 20, `[R] 20 min de plus : le plan de retard part pour ${deja + 20} min, ajoutees a celles qui courent`, envoi);
    const f = await ouvertures(page);
    ok(!f.fiche, '[R] le retard n ouvre pas la fiche', f);
  });
}

// ---------------------------------------------------------------------------
// [S] ENCAISSER D UN GESTE
// ---------------------------------------------------------------------------
async function encaisser(browser) {
  await avec(browser, { lettre: 'S' }, async (page) => {
    const lignes = await lignesDuJour(page);
    const lire = () => page.evaluate(() => ({ ids: Array.from(document.querySelectorAll('.gf-r')).map((tr) => tr.getAttribute('data-gf-id')).join(), top: document.querySelector('.gf-defile').scrollTop }));
    const payes = (id) => page.evaluate((i) => window.__FIXTURE__.patchs.filter((p) => String(p.id) === i && p.status === 'paid').map((p) => p.paymentMethod), id);
    const sur = await page.evaluate(() => { const b = document.querySelector('.gf-r:not(.is-caisse) button.gf-du--b[data-gf-encaisser]'); return b ? { id: b.getAttribute('data-gf-encaisser'), montant: b.textContent } : null; });
    ok(Boolean(sur) && lignes.find((l) => l.id === sur.id).du === sur.montant, '[S] le montant d un groupe sur place est un bouton', sur);
    const avant = await lire();
    await page.locator(`button[data-gf-encaisser="${sur.id}"]`).scrollIntoViewIfNeeded();
    await page.locator(`button[data-gf-encaisser="${sur.id}"]`).click();
    await FX.repos(page, 200);
    const bulle = await page.evaluate(() => ({ boutons: Array.from(document.querySelectorAll('.staff-action-popover button')).map((b) => b.textContent.trim()), titre: (document.querySelector('.staff-action-popover .staff-action-popover-title') || {}).textContent || '' }));
    ok(bulle.boutons.join() === 'Carte,Espèces' && bulle.titre.includes(sur.montant), '[S] il ouvre sa bulle : Carte, Espèces, et le montant', bulle);
    await page.locator('.staff-action-popover button', { hasText: 'Carte' }).click();
    await page.waitForFunction((id) => document.querySelector(`.gf-r.t-paid[data-gf-id="${id}"]`), sur.id, { timeout: 8000 }).catch(() => null);
    await FX.repos(page, 200);
    const moyens = await payes(sur.id);
    const ligne = (await lignesDuJour(page)).find((l) => l.id === sur.id);
    ok(moyens.length === 1 && /carte/i.test(moyens[0]) && /Payé/.test(ligne.etat), '[S] Carte : le paiement part avec son moyen, la ligne dit Payé', { moyens, ligne });
    ok((await lire()).ids === avant.ids, '[S] encaisser ne bouge aucune ligne');
    // A la caisse, les deux boutons sont sur la ligne.
    const caisse = await page.evaluate(() => { const b = document.querySelector('.gf-r.is-caisse [data-gf-payer][data-gf-moyen="Espèces"]'); return b ? b.getAttribute('data-gf-payer') : null; });
    ok(Boolean(caisse), '[S] le montage : un groupe a encaisser a ses deux boutons', caisse);
    await page.locator(`[data-gf-payer="${caisse}"][data-gf-moyen="Espèces"]`).scrollIntoViewIfNeeded();
    await page.locator(`[data-gf-payer="${caisse}"][data-gf-moyen="Espèces"]`).click();
    await page.waitForFunction((id) => !document.querySelector(`[data-gf-payer="${id}"]`), caisse, { timeout: 8000 }).catch(() => null);
    await FX.repos(page, 200);
    const especes = await payes(caisse);
    ok(especes.length === 1 && /espèces/i.test(especes[0]), '[S] Espèces, sur la ligne d un groupe a encaisser : le paiement part avec son moyen', especes);
    const f = await ouvertures(page);
    ok(!f.fiche, '[S] encaisser n ouvre pas la fiche', f);
  });
}

// ---------------------------------------------------------------------------
// [T] UNE PISTE FERMEE SE VOIT SUR LA LIGNE DU GROUPE
// ---------------------------------------------------------------------------
async function panne(browser) {
  await avec(browser, { lettre: 'T', variante: ['maintenance5'] }, async (page) => {
    const p = await page.evaluate(() => {
      const surLa5 = state.reservations.filter((r) => getBowlingWindowsFromReservation(r).some((w) => (w.lanes || []).map(Number).includes(5))).map((r) => String(r.id));
      const cases = Array.from(document.querySelectorAll('.gf-x.is-panne'));
      const lignes = (sel) => Array.from(new Set(Array.from(document.querySelectorAll(sel)).map((x) => x.closest('[data-gf-id]').getAttribute('data-gf-id'))));
      return {
        maintenance: state.laneStatuses[5],
        surLa5,
        enPanne: lignes('.gf-x.is-panne'),
        finies: Array.from(document.querySelectorAll('.gf-x.is-panne.is-fini')).length,
        textes: cases.map((x) => (x.querySelector('.gf-x__d') || {}).textContent),
        lien: cases.map((x) => x.getAttribute('data-gf-voir')),
      };
    });
    ok(p.maintenance === 'maintenance' && p.surLa5.length > 0, '[T] le montage : la piste 5 est fermee, des groupes y sont', p);
    ok(p.enPanne.length > 0 && p.enPanne.every((id) => p.surLa5.includes(id)), '[T] une piste fermee se voit sur la ligne de ses groupes, et d eux seuls', p);
    ok(p.finies === 0, '[T] une partie finie ne parle plus de sa piste fermee', p);
    ok(p.textes.every((t) => /Piste 5 fermée/.test(t)) && p.lien.every((v) => v === 'bowling'), '[T] la case dit quelle piste et mene au planning bowling', p);
    const id = p.enPanne[0];
    await page.locator(`[data-gf-id="${id}"] .gf-x.is-panne`).first().scrollIntoViewIfNeeded();
    await page.locator(`[data-gf-id="${id}"] .gf-x.is-panne`).first().click();
    await FX.repos(page, 500);
    const o = await ouvertures(page);
    ok(o.bowling && o.vue === 'bowling' && !o.fiche, '[T] un toucher mene a son bloc, au planning bowling, pas a la fiche', o);
  });
}

// ---------------------------------------------------------------------------
// [U] LE MENU « ⋯ »
// ---------------------------------------------------------------------------
async function menuPlus(browser) {
  await avec(browser, { lettre: 'U' }, async (page) => {
    await page.locator('#planningPlus').click();
    await FX.repos(page, 200);
    const m = await page.evaluate(() => {
      const p = document.querySelector('.staff-action-popover');
      return { boutons: p ? Array.from(p.querySelectorAll('button')).map((b) => b.textContent.trim()) : [], legende: Boolean(p && p.querySelector('.gf-legende-menu')) };
    });
    ok(m.boutons.length >= 3 && m.legende, '[U] le montage : le menu s ouvre, avec sa legende', m);
    ok(!m.boutons.some((b) => /Agrandir|Réduire/.test(b)), '[U] plus de « Agrandir le planning » au menu : la barre a sa porte', m.boutons);
    ok(!m.boutons.some((b) => /Nouvelle réservation/.test(b)), '[U] plus de « Nouvelle réservation ici » : la case d heure reserve', m.boutons);
    const porte = await page.evaluate(() => { const b = document.getElementById('planningAgrandir'); return b && b.getClientRects().length ? b.getAttribute('aria-label') : ''; });
    ok(/Agrandir/.test(porte), '[U] « Agrandir » reste sur la barre', porte);
  });
}

// ---------------------------------------------------------------------------
// [V] AU TELEPHONE, LA LISTE S OUVRE SUR L HEURE, UNE FOIS
// ---------------------------------------------------------------------------
// (le demarrage du banc remet la page en haut, la console ne le fait pas : ce geste du
// banc est neutralise, jusqu a ce que la console soit prete)
function sansRemiseEnHaut() {
  const natif = window.scrollTo.bind(window);
  window.scrollTo = (...a) => { if (window.__fixturePrete === true) natif(...a); };
}
async function telephone(browser) {
  await avec(browser, { lettre: 'V', appareil: 'telephone', avantChargement: (page) => page.addInitScript(sansRemiseEnHaut) }, async (page) => {
    const lire = () => page.evaluate(() => { const n = document.querySelector('.gf-now').getBoundingClientRect(); return { haut: Math.round(n.top), bas: Math.round(n.bottom), ih: innerHeight, y: Math.round(scrollY), cartes: getComputedStyle(document.querySelector('.gf-r')).display }; });
    const o = await lire();
    ok(o.cartes === 'grid', '[V] le montage : des cartes', o);
    ok(o.y > 0 && o.haut >= 0 && o.bas <= o.ih, '[V] la liste s ouvre sur l heure', o);
    // Une fois : ensuite, la page est a lui.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.clock.setFixedTime(FX.instant(JOUR, '15:11'));
    await page.evaluate(() => { tickHorlogeStaff(); renderStaff(); });
    await FX.repos(page, 200);
    const apres = await lire();
    ok(apres.y === 0, '[V] une fois : la minute et le rendu suivant ne ramenent pas la page', apres);
  });
}

// ---------------------------------------------------------------------------
// [W] LA PERF SE GARDE A SA SOURCE
// ---------------------------------------------------------------------------
// Les trois formes qui font recalculer des milliers d elements a chaque geste dans
// Blink, et qu un profil JS ne montre pas (2026-11-02 : un « Arrivé » coutait 5 recalculs
// de 9 700 elements) :
//   `#a:has(.b) .c`   marque tous les descendants invalides a chaque noeud ecrit ;
//   `.x *`            basculer .x recalcule tout le sous-arbre ;
//   `tr + tr`, `tr:first-child`  ecrire une rangee invalide tous les td du tbody.
// La feuille du tableau n en porte aucune. Dans les autres feuilles de la console, une
// forme sans prise sur le tableau ne lui coute rien : `.activity-grid:has(...) .x` vit dans
// le tunnel client, ecrire une ligne du tableau ne l invalide pas. Il y a prise quand ce
// que la forme vise contient le tableau, ou est dedans.
function decouper(selecteur) {
  const pieces = [];
  let prof = 0; let cur = ''; let comb = '';
  const pousser = () => { if (cur) { pieces.push({ texte: cur, avant: comb }); cur = ''; comb = ''; } };
  for (const c of selecteur) {
    if (c === '(' || c === '[') prof += 1;
    if (c === ')' || c === ']') prof -= 1;
    if (prof === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) { pousser(); if (c !== ' ') comb = c; else if (!comb) comb = ' '; continue; }
    cur += c;
  }
  pousser();
  return pieces;
}
const rejoindre = (pieces) => pieces.map((p, i) => `${i && p.avant !== ' ' ? `${p.avant} ` : ''}${p.texte}`).join(' ');
const sansHas = (texte) => { let t = texte; for (;;) { const i = t.indexOf(':has('); if (i < 0) return t || '*'; let prof = 0; let j = i + 4; for (; j < t.length; j += 1) { if (t[j] === '(') prof += 1; if (t[j] === ')') { prof -= 1; if (!prof) break; } } t = t.slice(0, i) + t.slice(j + 1); } };
// { forme, ancre } : ancre = ce qui doit etre a l ecran pour que la forme y ait prise.
function formesInterdites(selecteur, basculees) {
  const pieces = decouper(selecteur);
  const fautes = [];
  pieces.forEach((p, i) => {
    if (i < pieces.length - 1 && p.texte.includes(':has(')) fautes.push({ forme: ':has() suivi d un descendant', ancre: rejoindre(pieces.slice(0, i + 1).map((x) => ({ ...x, texte: sansHas(x.texte) }))) });
    if (i > 0 && /^tr\b/.test(p.texte) && /[+~]/.test(p.avant) && /^tr\b/.test(pieces[i - 1].texte)) fautes.push({ forme: 'tr + tr', ancre: rejoindre(pieces.slice(0, i + 1)) });
    if (/^tr\b.*:(first|last|nth)-/.test(p.texte)) fautes.push({ forme: 'tr:first-child', ancre: rejoindre(pieces.slice(0, i + 1).map((x) => ({ ...x, texte: x.texte.replace(/:(first|last|nth)-[\w-]+(\([^)]*\))?/g, '') }))) });
  });
  const dernier = pieces[pieces.length - 1];
  if (pieces.length > 1 && /^\*(::?[\w-]+)?$/.test(dernier.texte) && dernier.avant === ' ') {
    const classe = pieces.slice(0, -1).flatMap((p) => [...p.texte.matchAll(/\.([\w-]+)/g)].map((m) => m[1])).find((c) => basculees.has(c));
    if (classe) fautes.push({ forme: `.${classe} *`, ancre: null });
  }
  return fautes;
}
function classesQuiBasculent() {
  const classes = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'assets')).filter((x) => x.endsWith('.js'))) {
    for (const m of fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8').matchAll(/classList\.(?:add|remove|toggle)\(\s*['"`]([\w-]+)['"`]/g)) classes.add(m[1]);
  }
  return classes;
}
// (une derogation se pose a la ligne : le glisser d une carte ne se joue pas sur ce
// tableau, et son `user-select` vaut pour toute la page, une fois par glisser. Le tunnel
// client pose sa classe une fois, a son entree, et ne vise que lui)
const DEROGATIONS = new Map([
  ['body.staff-mode.bowling-dragging *', 'glisser une carte du planning bowling'],
  ['body.staff-mode.laser-dragging *', 'glisser une carte du planning laser'],
  ['body.lp-glisse *', 'glisser une partie au planning laser'],
  ['body.client-mode #clientView *', 'le tunnel client, une fois a son entree'],
]);
function lireSelecteurs() {
  const sortie = [];
  const parcourir = (regles, feuille) => { for (const r of regles) { if (r.selectorText) sortie.push({ s: r.selectorText, f: feuille }); if (r.cssRules) parcourir(r.cssRules, feuille); } };
  for (const feuille of document.styleSheets) {
    let regles;
    try { regles = feuille.cssRules; } catch (e) { continue; }
    parcourir(regles, (feuille.href || 'en ligne').replace(/^.*\/assets\//, '').replace(/\?.*$/, ''));
  }
  return sortie;
}
const couper = (texte) => { const sortie = []; let prof = 0; let cur = ''; for (const c of texte) { if (c === '(' || c === '[') prof += 1; if (c === ')' || c === ']') prof -= 1; if (c === ',' && !prof) { sortie.push(cur.trim()); cur = ''; } else cur += c; } if (cur.trim()) sortie.push(cur.trim()); return sortie; };

async function surfaces(browser) {
  await avec(browser, { lettre: 'W' }, async (page) => {
    const lire = () => page.evaluate(() => ({
      boites: ['planningBox', 'laserPlanningBox'].map((id) => document.getElementById(id).classList.contains('hidden')),
      bowling: document.querySelectorAll('#planningGridWrap *').length,
      laser: document.querySelectorAll('#laserPlanningGridWrap *').length,
    }));
    const propre = (x) => x.boites.every(Boolean) && x.bowling === 0 && x.laser === 0;
    const a = await lire();
    ok(a.boites.every(Boolean), '[W] le montage : les plannings Bowling et Laser sont caches', a);
    ok(propre(a), '[W] au chargement, les surfaces cachees sont vides', a);
    await page.locator('.is-premier [data-gf-arrive]').click();
    await FX.repos(page, 300);
    ok(propre(await lire()), '[W] apres un « Arrivé », elles sont toujours vides', await lire());
    await page.evaluate(() => { applyStaffSearch('Noah', { immediate: true }); applyStaffSearch('', { immediate: true }); setStaffStatusFilter('late'); setStaffStatusFilter('all'); tickHorlogeStaff(); });
    await FX.repos(page, 200);
    ok(propre(await lire()), '[W] apres une recherche, un filtre, la minute : toujours vides', await lire());

    // LES SELECTEURS, tels que le navigateur les a charges : ce qui part dans la page.
    const basculees = classesQuiBasculent();
    const lus = await page.evaluate(lireSelecteurs);
    const feuilles = new Set(lus.map((x) => x.f));
    ok(feuilles.has('pinlane-planning-global.css') && feuilles.has('pinlane-staff.css') && lus.length > 5000, '[W] le montage : les feuilles de la console sont lues', { feuilles: [...feuilles], selecteurs: lus.length });
    const trouves = [];
    for (const { s, f } of lus) for (const sel of couper(s)) for (const faute of formesInterdites(sel, basculees)) trouves.push({ ...faute, sel, f });
    const dansLeTableau = trouves.filter((x) => x.f === 'pinlane-planning-global.css');
    ok(dansLeTableau.length === 0, '[W] la feuille du tableau ne porte aucun selecteur qui recalcule tout', dansLeTableau.slice(0, 4).map((x) => `${x.forme} : ${x.sel}`));
    const etoiles = trouves.filter((x) => x.ancre === null && x.f !== 'pinlane-planning-global.css');
    const hors = etoiles.filter((x) => !DEROGATIONS.has(x.sel));
    ok(hors.length === 0, '[W] aucun `.x *` sur une classe qui bascule, dans toute la console', hors.slice(0, 4).map((x) => `${x.forme} : ${x.sel}`));
    const vivantes = [...DEROGATIONS.keys()].filter((sel) => !etoiles.some((x) => x.sel === sel));
    ok(vivantes.length === 0, '[W] chaque derogation vit encore (sinon elle se retire)', vivantes);
    const avecAncre = trouves.filter((x) => x.ancre !== null && x.f !== 'pinlane-planning-global.css');
    const prises = await page.evaluate((formes) => {
      const tableau = document.getElementById('globalPlanningGridWrap');
      return formes.filter((x) => {
        let vises;
        try { vises = Array.from(document.querySelectorAll(x.ancre)); } catch (e) { return true; }
        return vises.some((el) => el.contains(tableau) || tableau.contains(el));
      });
    }, avecAncre);
    ok(prises.length === 0, `[W] aucune des formes des autres feuilles n a prise sur le tableau (${avecAncre.length} lues)`, prises.slice(0, 4).map((x) => `${x.forme} : ${x.sel}`));
  });
}

const SCENARIOS = { densite, arrive, compteurs, nom, pasVenu, plein, menu, coupe, noteContraste, minute, autreJour, teteLargeurs, agrandiTelephone, texteCase, jours, caseHeure, bandeau, retard, encaisser, panne, menuPlus, telephone, surfaces };

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  // [A] la forme
  { nom: 'tous-les-boutons-pleins', lettre: 'A', scenarios: ['densite'], editions: [{ fichier: PGC, de: '.gf-t .gf-r.is-premier .gf-gb--arrive { background: var(--accent);', vers: '.gf-t .gf-r .gf-gb--arrive { background: var(--accent);' }] },
  { nom: 'menu-reste-ouvert', lettre: 'A', scenarios: ['densite'], editions: [{ fichier: MENU, de: '    return grandTableau() ? !menuRouvertIci : readPreference();', vers: '    return readPreference();' }] },
  { nom: 'barre-sans-statut', lettre: 'A', scenarios: ['densite'], editions: [{ fichier: PGC, de: '.gf-t .gf-r > td.gf-h { padding: 0; background: var(--bk-barre); }', vers: '.gf-t .gf-r > td.gf-h { padding: 0; background: var(--line-strong); }' }] },
  // [B] un « Arrivé » ne reecrit qu une ligne
  { nom: 'table-reecrite', lettre: 'B', scenarios: ['arrive'], editions: [{ fichier: PG, de: '    if (!avant || !tbody || avant.table !== p.table || avant.colonnes !== p.colonnes) { gfEcrireTout(wrap, defile, p); return; }', vers: '    gfEcrireTout(wrap, defile, p); return;' }] },
  // Une rangee reecrite perd la ligne du retard : celles du dessous remontent.
  { nom: 'hauteur-perdue', lettre: 'B', scenarios: ['arrive'], editions: [{ fichier: PG, de: "      if (tr.getBoundingClientRect().height < h - 0.5) tr.style.height = h + 'px';\n", vers: '' }] },
  { nom: 'ordre-qui-bouge', lettre: 'B', scenarios: ['arrive'], editions: [{ fichier: PG, de: '    groupes.sort(function (a, b) { return a.heure - b.heure ||', vers: "    groupes.sort(function (a, b) { return (a.r.status === 'arrived') - (b.r.status === 'arrived') || a.heure - b.heure ||" }, { fichier: PG, de: '      suite.sort(function (a, b) { return a.heure - b.heure; });', vers: "      suite.sort(function (a, b) { return Boolean(a.r && a.r.status === 'arrived') - Boolean(b.r && b.r.status === 'arrived') || a.heure - b.heure; });" }] },
  { nom: 'bouton-plein-perdu', lettre: 'B', scenarios: ['arrive'], editions: [{ fichier: PG, de: "      if (ligne) ligne.classList.add('is-premier');", vers: "      if (ligne && !wrap._gfPremier) ligne.classList.add('is-premier');" }] },
  // [C] les compteurs
  { nom: 'compteur-sourd', lettre: 'C', scenarios: ['compteurs'], editions: [{ fichier: PG, de: "      if (filtre) { gfFiltrer(wrapDe(), filtre.getAttribute('data-gf-filtre')); return; }", vers: '      if (filtre) return;' }] },
  { nom: 'second-toucher-sourd', lettre: 'C', scenarios: ['compteurs'], editions: [{ fichier: PG, de: "setStaffStatusFilter(actuel === f || f === 'all' ? 'all' : f);", vers: "setStaffStatusFilter(f === 'all' ? 'all' : f);" }] },
  { nom: 'tout-sourd', lettre: 'C', scenarios: ['compteurs'], editions: [{ fichier: PG, de: "setStaffStatusFilter(actuel === f || f === 'all' ? 'all' : f);", vers: "setStaffStatusFilter(actuel === f ? 'all' : f === 'all' ? actuel : f);" }] },
  // [D] taper un nom
  { nom: 'entree-pointe-tout', lettre: 'D', scenarios: ['nom'], editions: [{ fichier: PG, de: '    if (trouves.length !== 1 || !gfPeutArriver(trouves[0], m)) return;', vers: '    if (!trouves.length || !gfPeutArriver(trouves[0], m)) return;' }] },
  { nom: 'lettre-perdue', lettre: 'D', scenarios: ['nom'], editions: [{ fichier: PG, de: '    champ.focus();\n    champ.select();\n  });', vers: '  });' }] },
  // [E] « Pas venu »
  { nom: 'pas-venu-trop-tot', lettre: 'E', scenarios: ['pasVenu'], editions: [{ fichier: PG, de: '  var GF_PAS_VENU_MIN = 15;', vers: '  var GF_PAS_VENU_MIN = 1;' }] },
  { nom: 'pas-venu-sur-retard-annonce', lettre: 'E', scenarios: ['pasVenu'], editions: [{ fichier: PG, de: " && !(typeof getReservationDelayFlag === 'function' && getReservationDelayFlag(g.r));", vers: ';' }] },
  { nom: 'pas-venu-sourd', lettre: 'E', scenarios: ['pasVenu'], editions: [{ fichier: PG, de: "      if (absent) { basculerAbsence(Number(absent.getAttribute('data-gf-absent')), true, e); return; }", vers: '      if (absent) return;' }] },
  // [F] agrandir
  { nom: 'agrandi-sans-ligne-de-plus', lettre: 'F', scenarios: ['plein'], editions: [{ fichier: PGC, de: 'z-index: auto; flex: 1 1 0; min-height: 0; margin: 0; border: 1px solid var(--line);', vers: 'z-index: auto; flex: 0 0 240px; min-height: 0; margin: 0; border: 1px solid var(--line);' }] },
  { nom: 'agrandi-sans-plein-ecran', lettre: 'F', scenarios: ['plein'], editions: [{ fichier: APP, de: '  if (agrandir) pbEntrerPleinEcran();\n', vers: '' }] },
  // [G] le menu
  { nom: 'ecran-qui-ne-rend-rien', lettre: 'G', scenarios: ['menu'], editions: [{ fichier: APP, de: "    corps.classList.toggle('gf-large', surPlanning);", vers: "    corps.classList.add('gf-large');" }] },
  { nom: 'preference-ecrasee', lettre: 'G', scenarios: ['menu'], editions: [{ fichier: MENU, de: '    if (grandTableau()) menuRouvertIci = !menuRouvertIci;\n    else persistCollapsed(!readPreference());', vers: '    if (grandTableau()) menuRouvertIci = !menuRouvertIci;\n    persistCollapsed(!readPreference());' }] },
  // [H] la barre dans une demi-heure
  { nom: 'suite-sans-bloc', lettre: 'H', scenarios: ['coupe'], editions: [{ fichier: PG, de: 'courant = { b: b, lignes: [], suite: dernier === b, quand: quand };', vers: 'courant = { b: b, lignes: [], suite: false, quand: quand };' }] },
  // [I] la note, le contraste
  { nom: 'telephone-absent', lettre: 'I', scenarios: ['noteContraste'], editions: [{ fichier: PG, de: "    if (tel) tete += '<a class=\"gf-nom__tel\"", vers: "    if (false) tete += '<a class=\"gf-nom__tel\"" }] },
  { nom: 'libelle-pale', lettre: 'I', scenarios: ['noteContraste'], editions: [{ fichier: PGC, de: '.gf-i > span { font-size: 12px; color: var(--muted); white-space: nowrap; }', vers: '.gf-i > span { font-size: 12px; color: color-mix(in srgb, var(--muted) 35%, var(--surface)); white-space: nowrap; }' }] },
  // [J] la minute
  { nom: 'feuille-qui-ne-suit-pas', lettre: 'J', scenarios: ['minute'], editions: [{ fichier: PG, de: '      y = Math.max(0, now.offsetTop - wrap._gfRegle);', vers: '      y = defile.scrollTop;' }] },
  { nom: 'saute-sous-la-main', lettre: 'J', scenarios: ['minute'], editions: [{ fichier: PG, de: '      if (Math.abs(defile.scrollTop - y) > 1 && performance.now() - (wrap._gfMain || -GF_MAIN) < GF_MAIN) return;\n', vers: '' }] },
  { nom: 'boite-qui-grandit-decroche', lettre: 'J', scenarios: ['minute'], editions: [{ fichier: PG, de: '      if (wrap._gfSuit && wrap._gfPose > defile.scrollHeight - defile.clientHeight + 1) { wrap._gfRegle = null; gfAllerAMaintenant(wrap, false); return; }\n', vers: '' }] },
  // [K] un autre jour
  { nom: 'aujourd-hui-cache', lettre: 'K', scenarios: ['autreJour'], editions: [{ fichier: PGC, de: '#planningBarre .staff-today-btn { flex: none; box-sizing: border-box;', vers: '#planningBarre .staff-today-btn { display: none; flex: none; box-sizing: border-box;' }] },
  { nom: 'passe-en-vente', lettre: 'K', scenarios: ['autreJour'], editions: [{ fichier: PG, de: ' && !(m.maintenant == null && state.currentDate < todayStr());', vers: ';' }] },
  // [L] la barre agrandie
  { nom: 'barre-trop-etroite', lettre: 'L', scenarios: ['teteLargeurs'], editions: [{ fichier: PGC, de: '.gf-recherche { position: relative; flex: 1 1 auto; min-width: 0; height: var(--pb-l1); }', vers: '.gf-recherche { position: relative; flex: none; width: 720px; height: var(--pb-l1); }' }] },
  // Agrandie au telephone, la liste ne defile plus : le bas de la journee est perdu.
  { nom: 'agrandi-sans-defilement', lettre: 'L', scenarios: ['agrandiTelephone'], editions: [{ fichier: PGC, de: '  .planning-box.expanded .gf-defile { overflow: auto; }\n', vers: '' }] },
  // Agrandie au telephone, la liste s ouvre sur le matin.
  { nom: 'agrandi-sans-l-heure', lettre: 'L', scenarios: ['agrandiTelephone'], editions: [{ fichier: PG, de: '      else if (wrap._gfRegle == null) { wrap._gfRegle = 0; cible.scrollIntoView', vers: '      else if (wrap._gfRegle == null && !wrap._gfPlein) { wrap._gfRegle = 0; cible.scrollIntoView' }] },
  // [M] le texte dans sa case
  { nom: 'montant-long-qui-deborde', lettre: 'M', scenarios: ['texteCase'], editions: [{ fichier: PGC, de: '.gf-du.is-long { font-size: 13px; }', vers: '.gf-du.is-long { font-size: 26px; }' }] },
  { nom: 'case-d-heure-trop-pleine', lettre: 'M', scenarios: ['texteCase'], editions: [{ fichier: PG, de: '    var reste = seule ? 1 : part.lignes.length === 2 ? 3 : part.lignes.length * 2;', vers: '    var reste = 99;' }] },
  // [N] les autres jours
  { nom: 'table-trop-large', lettre: 'N', scenarios: ['jours'], editions: [{ fichier: PGC, de: '--c-nom: 210px; --c-n: 60px;', vers: '--c-nom: 1232px; --c-n: 60px;' }] },
  // [P] la case d heure
  { nom: 'case-ouvre-la-fiche', lettre: 'P', scenarios: ['caseHeure'], editions: [{ fichier: PG, de: "      if (reserver) { reserverAuComptoir({ startTime: reserver.getAttribute('data-gf-reserver') }); return; }", vers: "      if (reserver) { openPos(Number(reserver.closest('[data-gf-id]').getAttribute('data-gf-id'))); return; }" }] },
  { nom: 'case-sans-son-heure', lettre: 'P', scenarios: ['caseHeure'], editions: [{ fichier: PG, de: "reserverAuComptoir({ startTime: reserver.getAttribute('data-gf-reserver') });", vers: 'reserverAuComptoir({});' }] },
  { nom: 'case-passee-ouvre-la-fiche', lettre: 'P', scenarios: ['caseHeure'], editions: [{ fichier: PG, de: "      if (e.target.closest('td.gf-bloc')) return;\n", vers: '' }] },
  // [Q] le bandeau
  { nom: 'etat-sans-geste', lettre: 'Q', scenarios: ['bandeau'], editions: [{ fichier: PG, de: "      if (etat) gfDepuisBandeau(wrapDe(), etat.getAttribute('data-gf-etat'));", vers: '      if (etat) return;' }] },
  { nom: 'nom-sans-fiche', lettre: 'Q', scenarios: ['bandeau'], editions: [{ fichier: PG, de: "      if (fiche) { openPos(Number(fiche.getAttribute('data-gf-fiche'))); return; }\n      var etat = e.target.closest", vers: '      if (fiche) return;\n      var etat = e.target.closest' }] },
  { nom: 'pas-la-muet', lettre: 'Q', scenarios: ['bandeau'], editions: [{ fichier: PG, de: " + (la ? '' : ' pas là') });", vers: ' });' }] },
  { nom: 'complet-qui-reserve', lettre: 'Q', scenarios: ['bandeau'], editions: [{ fichier: PG, de: '    if (et.plein) window.pbChanger(cle);\n    else if (', vers: '    if (' }] },
  // [R] le retard
  { nom: 'retard-sourd', lettre: 'R', scenarios: ['retard'], editions: [{ fichier: PG, de: '      if (retarder) { gfBulleRetard(wrap, retarder, e); return; }', vers: '      if (retarder) return;' }] },
  { nom: 'retard-oublie-ce-qui-court', lettre: 'R', scenarios: ['retard'], editions: [{ fichier: PG, de: 'openDelayImpact(Number(id), Math.min(240, deja + Number(n)), ev);', vers: 'openDelayImpact(Number(id), Number(n), ev);' }] },
  // [S] encaisser
  { nom: 'montant-sourd', lettre: 'S', scenarios: ['encaisser'], editions: [{ fichier: PG, de: '      if (encaisser) { gfBulleEncaisser(encaisser, e); return; }', vers: '      if (encaisser) return;' }] },
  { nom: 'paiement-sans-moyen', lettre: 'S', scenarios: ['encaisser'], editions: [{ fichier: PG, de: 'function (valeur, ev) { encaisserReservation(id, valeur, ev); gfApresEncaisser(); }', vers: "function (valeur, ev) { encaisserReservation(id, '', ev); gfApresEncaisser(); }" }] },
  // [T] la piste fermee
  { nom: 'panne-muette', lettre: 'T', scenarios: ['panne'], editions: [{ fichier: PG, de: "        if (fermees.length && etat !== 'fini') {", vers: '        if (false) {' }] },
  { nom: 'panne-sans-lien', lettre: 'T', scenarios: ['panne'], editions: [{ fichier: PG, de: "      if (voir) { voirAuPlanning(Number(voir.closest('[data-gf-id]').getAttribute('data-gf-id')), voir.getAttribute('data-gf-voir'), e); return; }", vers: '      if (voir) return;' }] },
  // [U] le menu « ⋯ »
  { nom: 'agrandir-au-menu', lettre: 'U', scenarios: ['menuPlus'], editions: [{ fichier: APP, de: '    <button type="button" onclick="pbFiltres(event)">Filtres</button>\n', vers: '    <button type="button" onclick="pbFiltres(event)">Filtres</button>\n    <button type="button">Agrandir le planning</button>\n' }] },
  // [V] le telephone
  { nom: 'telephone-ouvert-en-haut', lettre: 'V', scenarios: ['telephone'], editions: [{ fichier: PG, de: "      else if (wrap._gfRegle == null) { wrap._gfRegle = 0; cible.scrollIntoView({ block: 'start' }); }\n", vers: '' }] },
  { nom: 'telephone-ramene-la-page', lettre: 'V', scenarios: ['telephone'], editions: [{ fichier: PG, de: "else if (wrap._gfRegle == null) { wrap._gfRegle = 0; cible.scrollIntoView({ block: 'start' }); }", vers: "else { cible.scrollIntoView({ block: 'start' }); }" }] },
  // [W] la perf
  { nom: 'bowling-cache-dessine', lettre: 'W', scenarios: ['surfaces'], editions: [{ fichier: APP, de: "  if (planningBox && planningBox.classList.contains('hidden')) return;\n  // Le re-render (polling", vers: '  // Le re-render (polling' }] },
  { nom: 'laser-cache-dessine', lettre: 'W', scenarios: ['surfaces'], editions: [{ fichier: APP, de: "  if (document.getElementById('laserPlanningBox')?.classList.contains('hidden')) return;\n", vers: '' }] },
  { nom: 'has-sur-toute-la-console', lettre: 'W', scenarios: ['surfaces'], editions: [{ fichier: PGC, de: '.pb-bande { box-sizing: border-box;', vers: '#staffView:has(.gf-r.is-retard) .planning-box { outline: 0; }\n.pb-bande { box-sizing: border-box;' }] },
  { nom: 'has-dans-une-autre-feuille', lettre: 'W', scenarios: ['surfaces'], editions: [{ fichier: 'assets/pinlane-staff.css', de: '.res-list .res-row { content-visibility: auto;', vers: '#staffView:has(.gf-r.is-retard) .staff-wrap { outline: 0; }\n.res-list .res-row { content-visibility: auto;' }] },
  { nom: 'etoile-sur-une-classe-qui-bascule', lettre: 'W', scenarios: ['surfaces'], editions: [{ fichier: 'assets/pinlane-staff.css', de: '.res-list .res-row { content-visibility: auto;', vers: '.is-repaint * { animation: none !important; }\n.res-list .res-row { content-visibility: auto;' }] },
  { nom: 'tr-plus-tr', lettre: 'W', scenarios: ['surfaces'], editions: [{ fichier: PGC, de: '.gf-r { cursor: pointer; }', vers: '.gf-r { cursor: pointer; }\n.gf-t tr.gf-r + tr.gf-r > td { outline: 0; }' }] },
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
      await jouer(browser, liste(process.env.GT_SCENARIOS) || Object.keys(SCENARIOS));
    } else {
      console.log('[CP] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.GT_MUTATIONS || liste(process.env.GT_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[CP] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const deDepart = await rougesDeDepart(browser, m.scenarios);
        const avant = echecs;
        const garde = rouges.length;
        mutation = { ...m, deDepart };
        silence = !process.env.GT_BAVARD;
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
  if (echecs) { console.error(`\nplanning-grand-tableau-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nplanning-grand-tableau-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

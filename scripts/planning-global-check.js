// LE PLANNING GLOBAL v3, DANS LA CONSOLE (spec planning global v3, 15.3).
//
// La console reelle, montee par scripts/planning-v3-fixtures.js sur six
// journees fixes de Fun Galaxy Libramont (calme, normal, pic, vide, ferme,
// pire), l API simulee dans la page (aucun reseau, aucune base), l heure
// figee par page.clock (15:10, 24:20 pour la nuit), un contexte neuf par
// scenario. Le moteur pur a son propre gate (scripts/planning-moteur-check.js).
//
// LA MATRICE (structure) : six journees x six ecrans (grand 1920, ordinateur
// 1440, portable 1280, tablette 1024, tablette-portrait 768, telephone 390) x
// vue normale et plein ecran x sombre et clair :
//   [T1] la journee entiere tient en hauteur ; [T2] de cote (le telephone
//   defile, ses heures restent a gauche) ; [T3] chaque heure pleine a son
//   libelle a sa ligne ; [T4] l axe est lineaire ;
//   [C1] rien ne se recouvre ; [C2] aucun texte ne deborde de sa carte ;
//   [N1] le nom ecrit est la forme de son echelle, jamais coupe ; [N2] un nom
//   des qu il tient ; [N3] deux groupes n ecrivent jamais le meme texte ;
//   [W1] la somme des colonnes vaut la grille, les planchers tiennent ;
//   [W2] une carte s etend sur les voies libres a sa droite ;
//   [B1] le bowling en pistes egales, numerotees, une carte sur ses pistes ;
//   [X2] chaque carte est un bouton nomme, sans title ; chaque tete a le sien ;
//   [X4] « Agrandir » se met en avant si et seulement si l essentiel manque ;
//   [G1] ni degrade, Geist partout (pas Mono), chiffres tabulaires ; la meme
//   geometrie en sombre et en clair ;
//   [K][A] l onglet « Planning global », sa boite, la liste dessous ;
//   [K][I] en plein ecran, la boite est agrandie et tout y tient.
// LES INVARIANTS CIBLES (sur la journee et l ecran qu ils nomment) : N4 W3
// W4 B2 B3 B4 L1 L2 P1 S1 R1 A1 H1 D1 D2 D3 J1 Z1 I1 V1 X1 X3 et les
// comportements gardes [K][F] [G] [H] [M] [N] [Q].
// --contre-preuves : chaque regle retiree (en memoire, au texte servi ; le
// disque n est jamais touche) fait rougir sa lettre ; chaque ancre existe une
// fois et une seule.
//   PG_FIXTURES, PG_APPAREILS, PG_MODES, PG_THEMES, PG_MUTATIONS : un
//   sous-ensemble, pour iterer (PG_SANS_EXTRAS, PG_SEULEMENT_EXTRAS : la
//   matrice seule, les scenarios a part seuls).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');
const MO = require('../assets/pinlane-planning-moteur.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_PLANNING_GLOBAL_PORT || 5191);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MOTEUR = 'assets/pinlane-planning-moteur.js';
const PG = 'assets/pinlane-planning-global.js';
const PGC = 'assets/pinlane-planning-global.css';
const AM = 'assets/app-main.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

let echecs = 0;
let silence = false;
const rouges = [];
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  return cond;
}
const sansFaute = (fautes) => !fautes || !fautes.length;

// ---------------------------------------------------------------------------
// LE SERVEUR : les fichiers du depot, une mutation au plus, en memoire.
// ---------------------------------------------------------------------------
let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// [D2] LE COMPTEUR DES LECTURES DE GEOMETRIE, pose avant tout script de la
// page : chaque lecture (getBoundingClientRect, getClientRects,
// getComputedStyle, offset*, scroll*, client*) quand il est arme, et celles
// qui suivent une ecriture (innerHTML, setAttribute) dans la meme tache.
// ---------------------------------------------------------------------------
function BIBLIO() {
  const L = { installe: false, arme: false, n: 0, apres: 0, ecrit: false, noms: [] };
  window.__lectures = L;
  const lu = (nom) => { if (!L.arme) return; L.n += 1; if (L.ecrit) L.apres += 1; if (L.noms.length < 40) L.noms.push(nom); };
  const ecrit = () => { if (L.arme) L.ecrit = true; };
  const envelopper = (P, noms) => noms.forEach((nom) => {
    const d = Object.getOwnPropertyDescriptor(P, nom);
    if (!d) return;
    if (d.get) Object.defineProperty(P, nom, Object.assign({}, d, { get() { lu(nom); return d.get.call(this); } }));
    else if (typeof d.value === 'function') { const f = d.value; Object.defineProperty(P, nom, Object.assign({}, d, { value: function () { lu(nom); return f.apply(this, arguments); } })); }
  });
  envelopper(Element.prototype, ['getBoundingClientRect', 'getClientRects', 'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft', 'clientWidth', 'clientHeight', 'clientTop', 'clientLeft']);
  envelopper(HTMLElement.prototype, ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent']);
  const gcs = window.getComputedStyle;
  window.getComputedStyle = function () { lu('getComputedStyle'); return gcs.apply(this, arguments); };
  const ih = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', Object.assign({}, ih, { set(v) { ecrit(); ih.set.call(this, v); } }));
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function () { ecrit(); return sa.apply(this, arguments); };
  L.installe = true;
}

// ---------------------------------------------------------------------------
// LA LECTURE DE LA GRILLE (dans la page) : toutes les fautes de structure,
// par lettre. Rien n y est ecrit.
// ---------------------------------------------------------------------------
function lireStructure() {
  const Mo = window.PinlanePlanningMoteur;
  const wrap = document.getElementById('globalPlanningGridWrap');
  const box = document.getElementById('globalPlanningBox');
  const plan = wrap && wrap._ghPlan;
  const entree = wrap && wrap._ghEntree;
  const racine = wrap && wrap._ghRacine;
  const grille = racine && racine.querySelector('.gh-grille');
  if (!plan || !grille || !Mo) return { manque: true };
  const F = {};
  const faute = (k, m) => { (F[k] = F[k] || []).push(m); };
  const R = (el) => el.getBoundingClientRect();
  const cs = (el) => getComputedStyle(el);
  const M = Mo.mesureur(window.__ghMesure);
  const typo = plan.typo;
  const plein = box.classList.contains('expanded');
  const ecran = racine.classList.contains('is-ecran');
  const tel = innerWidth < 768;
  const pileH = grille.querySelector('.gh-pile--h');
  const rH = R(pileH);
  const piles = Array.from(grille.querySelectorAll('.gh-pile[data-gh-col]'));
  const groupes = new Map(entree.groupes.map((g) => [g.id, g]));
  const parCle = new Map(plan.elements.map((el) => [el.cle, el]));
  const yDe = (t) => Mo.ghY(plan.axe, t);
  const out = { F, stats: Object.assign({}, window.__ghPlanStats), palier: typo.palier, demi: plan.axe.demi, hh: plan.axe.hh, defile: plan.defile };

  // [T1] LA HAUTEUR
  const rb = R(box);
  out.T1 = { sh: grille.scrollHeight, ch: grille.clientHeight, bas: Math.round(rb.bottom + (plein ? 0 : scrollY)), haut: Math.round(rb.height), ih: innerHeight, plein, ecran };
  if (grille.scrollHeight !== grille.clientHeight) faute('T1', `la grille defile en hauteur : ${grille.scrollHeight} > ${grille.clientHeight}`);
  if (ecran) { if (rb.height > innerHeight + 0.5) faute('T1', `mode ecran : la boite fait ${rb.height} > ${innerHeight}`); }
  // (en plein ecran la boite prend l ecran : c est le bas de la grille qui compte)
  else if (!plein && rb.bottom + scrollY > innerHeight - 14 + 0.5) faute('T1', `le bas de la boite ${Math.round(rb.bottom + scrollY)} > ${innerHeight - 14}`);
  else if (plein && R(grille).bottom > innerHeight - 10 + 0.5) faute('T1', `plein ecran : le bas de la grille ${Math.round(R(grille).bottom)} > ${innerHeight - 10}`);
  // [T2] LA LARGEUR (des 768 px)
  if (!tel && grille.scrollWidth !== grille.clientWidth) faute('T2', `la grille defile de cote : ${grille.scrollWidth} > ${grille.clientWidth}`);
  if (document.documentElement.scrollWidth > innerWidth + 1) faute('T2', `la page defile de cote : ${document.documentElement.scrollWidth}`);

  // [T3] LES HEURES
  const labels = Array.from(pileH.querySelectorAll('.gh-h[data-gh-t]'));
  let prec = -Infinity;
  labels.forEach((h) => {
    if (cs(h).display === 'none') return;
    const r = R(h);
    const c = (r.top + r.bottom) / 2 - rH.top;
    if (c <= prec) faute('T3', `libelles pas croissants a ${h.textContent}`);
    prec = c;
  });
  for (let t = Math.ceil(plan.axe.debut - 1e-9); t <= plan.axe.fin + 1e-9; t += 1) {
    const h = labels.find((x) => Math.abs(Number(x.getAttribute('data-gh-t')) - t) < 1e-6);
    if (!h) { faute('T3', `pas de libelle pour ${t}`); continue; }
    const s = cs(h);
    if ((s.display === 'none' || s.visibility === 'hidden') && !h.classList.contains('is-sous')) faute('T3', `${h.textContent} cache`);
    if (h.textContent !== formatClockDisplay(t)) faute('T3', `${t} ecrit « ${h.textContent} »`);
    const r = R(h);
    const c = (r.top + r.bottom) / 2 - rH.top;
    if (Math.abs(c - yDe(t)) > 1) faute('T3', `${h.textContent} a ${c.toFixed(1)} au lieu de ${yDe(t)}`);
  }
  // [T4] L AXE LINEAIRE
  const filets = Array.from(grille.querySelectorAll('.gh-lignes .gh-l')).map((f) => R(f).top).sort((a, b) => a - b);
  const ecarts = filets.slice(1).map((y, i) => y - filets[i]);
  if (ecarts.length && Math.max(...ecarts) - Math.min(...ecarts) > 1) faute('T4', `filets de ${Math.min(...ecarts).toFixed(1)} a ${Math.max(...ecarts).toFixed(1)} px`);
  if (filets.length && Math.abs(filets.length - Math.round((plan.axe.fin - plan.axe.debut) * 2 + 1)) > 0) faute('T4', `${filets.length} filets pour ${(plan.axe.fin - plan.axe.debut) * 2 + 1} demi-heures`);

  // [C1] AUCUN RECOUVREMENT ; deux cartes qui se suivent dans une voie : 1 px au moins.
  piles.forEach((pile) => {
    const items = Array.from(pile.children).filter((x) => x.matches('.gh-c, .gh-partie, .gh-enligne')).map((x) => ({ x, r: R(x) }));
    for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i].r, b = items[j].r;
      const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (dx > 0.5 && dy > 0.5) faute('C1', `${pile.getAttribute('data-gh-cle')} : ${items[i].x.getAttribute('data-gh-k') || items[i].x.className} sur ${items[j].x.getAttribute('data-gh-k') || items[j].x.className}`);
      else if (dx > 0.5 && dy > -0.99 && dy <= 0.5) faute('C1', `${pile.getAttribute('data-gh-cle')} : moins de 1 px entre ${items[i].x.getAttribute('data-gh-k')} et ${items[j].x.getAttribute('data-gh-k')}`);
    }
  });
  grille.querySelectorAll('.gh-barre').forEach((barre) => {
    const segs = Array.from(barre.children).map((x) => R(x));
    for (let i = 0; i < segs.length; i += 1) for (let j = i + 1; j < segs.length; j += 1) {
      if (Math.min(segs[i].right, segs[j].right) - Math.max(segs[i].left, segs[j].left) > 0.5) faute('C1', 'deux segments se recouvrent');
    }
  });
  // [C2] AUCUN DEBORDEMENT (Range, dans le gate seulement), mesure au noeud
  // de texte : de cote, le rectangle du texte ; en hauteur, sa ligne (la
  // boite de la police depasse une ligne serree de sa demi-interligne, sans
  // encre). Les etiquettes et les pictos, a leur boite.
  const dedans = (boite, cont, quoi) => {
    const rc = R(cont);
    const marcheur = document.createTreeWalker(boite, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = marcheur.nextNode())) {
      if (!n.textContent.trim()) continue;
      const lh = parseFloat(cs(n.parentElement).lineHeight) || 0;
      const rr = document.createRange();
      rr.selectNodeContents(n);
      Array.from(rr.getClientRects()).forEach((x) => {
        if (x.width < 0.5) return;
        const c = (x.top + x.bottom) / 2;
        const haut = lh ? c - lh / 2 : x.top, bas = lh ? c + lh / 2 : x.bottom;
        const d = Math.max(rc.left - x.left, x.right - rc.right, rc.top - haut, bas - rc.bottom);
        if (d > 0.5) faute('C2', `${quoi} : « ${n.textContent.slice(0, 20)} » deborde de ${d.toFixed(1)} px`);
      });
    }
    boite.querySelectorAll('.gp-tag, .gh-pictos').forEach((x) => {
      const r = R(x);
      const d = Math.max(rc.left - r.left, r.right - rc.right, rc.top - r.top, r.bottom - rc.bottom);
      if (d > 0.5) faute('C2', `${quoi} : ${x.className} deborde de ${d.toFixed(1)} px`);
    });
  };
  grille.querySelectorAll('.gh-c').forEach((c) => { if (c.textContent.trim()) dedans(c, c, c.getAttribute('data-gh-k')); });
  grille.querySelectorAll('.gh-partie__t, .gh-partie__n, .gh-seg-libre, .gh-seg-autres, .gh-enligne').forEach((x) => { if (x.textContent.trim()) dedans(x, x.closest('.gh-seg-libre, .gh-seg-autres') || x.closest('.gh-partie') || x, x.className); });
  grille.querySelectorAll('.gh-entete__t').forEach((t) => dedans(t, t.closest('.gh-entete'), 'tete ' + t.textContent));
  if (out.stats.corrections) faute('C2', `${out.stats.corrections} corrections apres le rendu`);

  // [N1] LES NOMS : la forme de l echelle, entiere ; [N3] un texte, un groupe.
  const noms = Mo.ghNoms(entree.groupes, typo.nom, M);
  const textes = new Map();
  grille.querySelectorAll('.gh-c[data-gh-forme]').forEach((c) => {
    const n = c.querySelector('.gh-c__nom');
    const k = Number(c.getAttribute('data-gh-forme'));
    const gid = c.getAttribute('data-gp-res');
    if (k < 0) return;
    if (!n) { faute('N1', `${c.getAttribute('data-gh-k')} sans nom`); return; }
    const e = noms.parId.get(gid);
    const attendu = e && e.formes[k] ? e.formes[k].t : '?';
    if (n.textContent !== attendu) faute('N1', `${c.getAttribute('data-gh-k')} ecrit « ${n.textContent} » au lieu de « ${attendu} »`);
    if (/DÉM(?!O)|^DÉMO ·/.test(n.textContent)) faute('N1', `« ${n.textContent} » garde le prefixe`);
    const s = cs(n);
    if (s.textOverflow === 'ellipsis' || cs(c).textOverflow === 'ellipsis') faute('N1', `« ${n.textContent} » en ellipse`);
    const fs = parseFloat(s.fontSize);
    if (fs < 11 - 1e-6 || (plan.axe.demi >= 16 && fs < 12 - 1e-6)) faute('N1', `« ${n.textContent} » en ${fs} px`);
    const t = n.textContent;
    if (!textes.has(t)) textes.set(t, new Set());
    textes.get(t).add(gid);
  });
  textes.forEach((s, t) => { if (t && s.size > 1) faute('N3', `« ${t} » ecrit par ${s.size} groupes`); });
  // [N2] UN NOM DES QU IL TIENT
  grille.querySelectorAll('[data-gh-k]').forEach((c) => {
    const el = parCle.get(c.getAttribute('data-gh-k'));
    if (!el || !(el.L >= 1) || !el.formes) return;
    const dist = el.formes[el.distinctive];
    if (!dist) return;
    let besoin = M.m(typo.nom, dist) + 1;
    if (el.k === 'presence') { if (el.bw < 40) return; besoin += 6 + M.tab(typo.tag, String(el.enfants)) + 1; }
    if (el.k === 'seg' && el.bw < 24) return;
    if (el.k === 'carte') {
      const etats = wrap._ghEtats || plan.etats;
      const tags = (el.porteuse ? (etats.tags[el.gid] || []) : []).concat(el.tagsFixes || []);
      tags.forEach((t) => { const def = Mo.TAGS[t.code]; const v = t.code === 'retard' ? '9'.repeat(Math.max(2, String(t.v).length)) : t.v; besoin += M.m(typo.nom, ' ') + M.tab(typo.tag, def.court(v)) + 8 + 1; });
      if (el.arrivee) besoin += M.m(typo.nom, ' ') + M.tab(typo.petit, formatClockDisplay(el.debut)) + 1;
    }
    const forme = el.compo ? el.compo.forme : -1;
    if (el.tw >= besoin && !(forme >= 0 && forme <= el.distinctive)) faute('N2', `${el.cle} : ${el.tw} px pour « ${dist} » (${Math.ceil(besoin)}), ecrit la forme ${forme}`);
  });

  // [W1] LES LARGEURS
  const cols = cs(grille).gridTemplateColumns.split(' ').map(parseFloat);
  const somme = cols.reduce((a, x) => a + x, 0);
  if (!tel && Math.abs(somme - grille.clientWidth) > 1) faute('W1', `colonnes ${somme} pour ${grille.clientWidth}`);
  const reduit = plan.reduit;
  // (la reduction de 4.5 : hors plein ecran elle pose gp-a-agrandir ; en plein ecran, il n y a plus a agrandir)
  plan.colonnes.forEach((c) => { if (!c.vide && c.w < c.plancher && !(reduit && (plein || box.classList.contains('gp-a-agrandir')))) faute('W1', `${c.cle} ${c.w} < plancher ${c.plancher}`); });
  const sousDistinctive = plan.elements.some((el) => (el.k === 'carte' || el.k === 'presence' || el.k === 'seg') && el.L >= 1 && el.formes && !(el.compo && el.compo.forme >= 0 && el.compo.forme <= el.distinctive));
  if (sousDistinctive) plan.colonnes.forEach((c) => { if (c.vide && c.w > c.plancher + 1) faute('W1', `vide ${c.cle} ${c.w} > plancher ${c.plancher} quand une carte est sous sa forme distinctive`); });
  // [W2] L EXPANSION A DROITE (colonnes d agenda)
  piles.forEach((pile) => {
    const col = plan.colonnes[Number(pile.getAttribute('data-gh-col'))];
    if (!col || col.nature === 'bowling' || col.nature === 'laser') return;
    const rp = R(pile);
    // (le chevauchement se lit a l heure, comme le moteur : une minute
    // commune peut tenir dans moins d un pixel)
    const finD = (el) => Math.max(el.fin, el.debut + 0.5);
    const cartes = Array.from(pile.children).filter((x) => x.matches('.gh-c')).map((x) => ({ x, r: R(x), el: parCle.get(x.getAttribute('data-gh-k')) })).filter((c) => c.el);
    cartes.forEach((a) => {
      const droite = cartes.filter((b) => b !== a && b.r.left > a.r.left + 0.5 && a.el.debut < finD(b.el) - 1e-6 && b.el.debut < finD(a.el) - 1e-6);
      const bord = rp.left + col.w - 1;
      if (!droite.length) { if (Math.abs(a.r.right - bord) > 1.5) faute('W2', `${a.x.getAttribute('data-gh-k')} s arrete a ${(a.r.right - rp.left).toFixed(0)} au lieu du bord ${col.w - 1}`); }
      else {
        const g = Math.min(...droite.map((b) => b.r.left));
        if (a.r.right > g + 0.5 || a.r.right < g - 3.5) faute('W2', `${a.x.getAttribute('data-gh-k')} finit a ${(a.r.right - rp.left).toFixed(0)}, la voie occupee suivante a ${(g - rp.left).toFixed(0)}`);
      }
    });
  });

  // [B1] LES PISTES
  const bi = plan.colonnes.findIndex((c) => c.nature === 'bowling');
  if (bi >= 0) {
    const col = plan.colonnes[bi];
    const N = typeof getAvailabilityLaneCount === 'function' ? getAvailabilityLaneCount() : 8;
    const pile = piles.find((p) => Number(p.getAttribute('data-gh-col')) === bi);
    const rp = R(pile);
    const nums = Array.from(grille.querySelectorAll('.gh-entete[data-gh-cle="bowling"] .gh-num'));
    const maxReserve = Math.max(0, ...entree.seances.filter((s) => s.colonne === 'bowling').map((s) => Math.max(0, ...(s.pistes || []))));
    const Nvu = Math.max(N, maxReserve);
    if (col.N !== Nvu) faute('B1', `${col.N} pistes au lieu de ${Nvu}`);
    const ws = col.pistes.filter((p) => p.n !== '?').map((p) => p.w);
    if (Math.max(...ws) - Math.min(...ws) > 1) faute('B1', `pistes inegales ${ws.join(',')}`);
    nums.filter((x) => x.textContent !== '?').forEach((x, i) => {
      if (x.textContent !== String(i + 1)) faute('B1', `numero ${x.textContent} au rang ${i + 1}`);
      const r = R(x);
      const p = col.pistes[i];
      if (p && Math.abs((r.left + r.right) / 2 - (rp.left + p.x + p.w / 2)) > 1) faute('B1', `numero ${x.textContent} pas centre sur sa piste`);
    });
    Array.from(pile.children).filter((x) => x.matches('.gh-c')).forEach((c) => {
      const el = parCle.get(c.getAttribute('data-gh-k'));
      if (!el || !el.pistes || !el.pistes.length || el.sansPiste) return;
      const a = Math.min(...el.pistes), b = Math.max(...el.pistes);
      const r = R(c);
      const pa = col.pistes[a - 1], pb = col.pistes[b - 1];
      if (!pa || !pb) return;
      if (Math.abs(r.left - (rp.left + pa.x + 1)) > 1 || Math.abs(r.right - (rp.left + pb.x + pb.w - 1)) > 1) faute('B1', `${el.cle} (pistes ${a}-${b}) de ${(r.left - rp.left).toFixed(0)} a ${(r.right - rp.left).toFixed(0)} au lieu de ${pa.x + 1} a ${pb.x + pb.w - 1}`);
    });
  }

  // [X2] L ACCESSIBILITE
  grille.querySelectorAll('.gh-c').forEach((c) => {
    const el = parCle.get(c.getAttribute('data-gh-k'));
    const g = el && groupes.get(el.gid);
    const aria = c.getAttribute('aria-label') || '';
    if (c.getAttribute('role') !== 'button' || c.getAttribute('tabindex') !== '0') faute('X2', `${c.getAttribute('data-gh-k')} n est pas un bouton`);
    if (c.hasAttribute('title')) faute('X2', `${c.getAttribute('data-gh-k')} a un title`);
    if (!g || !el) { faute('X2', `${c.getAttribute('data-gh-k')} hors du plan`); return; }
    const col = plan.colonnes[el.colonne];
    const manque = [];
    if (aria.indexOf(g.nom) < 0) manque.push('nom complet');
    if (!/\d+ personnes?/.test(aria)) manque.push('personnes');
    if (aria.indexOf(col.titre) < 0) manque.push('activite');
    if (!/\d{2}:\d{2} à \d{2}:\d{2}/.test(aria)) manque.push('heures');
    if (el.k === 'carte' && el.nature === 'bowling' && el.pistes && el.pistes.length && !/pistes? \d/.test(aria)) manque.push('piste');
    if (el.k === 'seg' && !/\d+ armes?/.test(aria)) manque.push('armes');
    if (el.k === 'presence' && !/\d+ enfants?/.test(aria)) manque.push('enfants');
    if (!/(fini|en cours|à venir|en retard)/.test(aria)) manque.push('etat');
    if (manque.length) faute('X2', `${el.cle} : aria sans ${manque.join(', ')}`);
  });
  grille.querySelectorAll('.gh-entete[data-gh-cle]').forEach((t) => { if (!t.getAttribute('title') || !t.getAttribute('aria-label') || t.getAttribute('role') !== 'columnheader') faute('X2', `tete ${t.getAttribute('data-gh-cle')} sans title`); });
  grille.querySelectorAll('.gh-enligne').forEach((b) => { if (b.getAttribute('role') !== 'note') faute('X2', 'bloc en ligne sans role note'); });

  // [X4] AGRANDIR
  const doit = !plein && (!plan.stats.essentielAtteint || plan.axe.demi < 16);
  if (box.classList.contains('gp-a-agrandir') !== doit) faute('X4', `gp-a-agrandir ${box.classList.contains('gp-a-agrandir')} au lieu de ${doit} (essentiel ${plan.stats.essentielAtteint}, demi ${plan.axe.demi})`);

  // [G1] LA GRAMMAIRE
  racine.querySelectorAll('*').forEach((x) => { const bi2 = cs(x).backgroundImage; if (bi2 && /gradient/.test(bi2)) faute('G1', `degrade sur ${x.className}`); });
  [['.gh-c', 'carte'], ['.gh-entete', 'tete'], ['.gh-h', 'heure'], ['.gh-panneau__in', 'panneau']].forEach(([sel, quoi]) => {
    const x = racine.querySelector(sel);
    if (!x) return;
    const fam = cs(x).fontFamily.replace(/["']/g, '').trim();
    if (!/^Geist\b/.test(fam) || /^Geist Mono/.test(fam)) faute('G1', `${quoi} en « ${fam.slice(0, 30)} »`);
  });
  ['.gh-h', '.gh-num', '.gh-seg__n', '.gh-pr__n', '.gh-entete__sous', '.gh-min', '.gh-partie__t', '.gh-partie__n', '.gh-c__h'].forEach((sel) => {
    racine.querySelectorAll(sel).forEach((x) => { if (!/tabular-nums/.test(cs(x).fontVariantNumeric)) faute('G1', `${sel} sans tabular-nums`); });
  });
  // (aucune animation d entree, mouvement reduit ou non : [X3])
  const animes = document.getAnimations().filter((a) => a.effect && a.effect.target && racine.contains(a.effect.target) && a.playState === 'running');
  if (animes.length) faute('X3', `${animes.length} animations sur la grille au repos`);

  // [K][A] L ONGLET ET LA BOITE
  const onglet = ((document.querySelector('#staffTabAll .main') || {}).textContent || '').trim();
  const listeBox = document.getElementById('staffTableBox');
  if (onglet !== 'Planning global' || box.classList.contains('hidden')) faute('A', `onglet « ${onglet} »`);
  if (!plein && listeBox && !listeBox.classList.contains('hidden') && R(listeBox).top < rb.bottom - 1) faute('A', 'la liste du jour n est pas sous la boite');
  if (plein) {
    const bouton = document.getElementById('globalPlanningToggle');
    if (!bouton || bouton.textContent.trim() !== 'Réduire') faute('I', `bouton « ${bouton && bouton.textContent.trim()} » en plein ecran`);
    if (F.T1) faute('I', 'en plein ecran, la journee ne tient pas');
  }

  // LA SIGNATURE DE LA GEOMETRIE (la meme en clair, a toute heure)
  out.geometrie = JSON.stringify([plan.colonnes.map((c) => [c.cle, c.w]), plan.elements.map((el) => [el.k, el.cle, el.x, el.y, el.w, el.h])]);
  out.cartes = grille.querySelectorAll('[data-gh-k]').length;
  out.colonnes = plan.colonnes.map((c) => ({ cle: c.cle, titre: c.titre, w: c.w, plancher: c.plancher, essentiel: c.essentiel, vide: c.vide, nature: c.nature }));
  out.nommes = plan.stats.nommes;
  return out;
}

// Les groupes nommes, et les cartes d au moins une ligne qui n ecrivent rien.
function lireNoms() {
  const wrap = document.getElementById('globalPlanningGridWrap');
  const plan = wrap._ghPlan;
  const vus = new Set();
  const muettes = [];
  const formes = [];
  plan.elements.forEach((el) => {
    if (el.k !== 'carte' && el.k !== 'presence' && el.k !== 'seg') return;
    if (el.compo && el.compo.forme >= 0) { vus.add(el.gid); formes.push({ cle: el.cle, k: el.k, forme: el.compo.forme, t: el.formes[el.compo.forme] }); }
    else if (el.L >= 1) muettes.push(`${el.cle} (${el.k}, ${el.bw} px)`);
  });
  return { nommes: vus.size, groupes: wrap._ghEntree.groupes.length, muettes, formes };
}

// ---------------------------------------------------------------------------
// LES PREUVES SUR LES PIXELS [V1] (une capture decodee ici)
// ---------------------------------------------------------------------------
function decoderPng(buf) {
  let i = 8, w = 0, h = 0, type = 0;
  const morceaux = [];
  while (i < buf.length) {
    const n = buf.readUInt32BE(i);
    const t = buf.toString('ascii', i + 4, i + 8);
    if (t === 'IHDR') { w = buf.readUInt32BE(i + 8); h = buf.readUInt32BE(i + 12); type = buf[i + 17]; }
    if (t === 'IDAT') morceaux.push(buf.slice(i + 8, i + 8 + n));
    i += 12 + n;
  }
  const brut = zlib.inflateSync(Buffer.concat(morceaux));
  const bpp = type === 6 ? 4 : 3;
  const ligne = w * bpp;
  const px = Buffer.alloc(ligne * h);
  for (let y = 0; y < h; y += 1) {
    const f = brut[y * (ligne + 1)];
    for (let x = 0; x < ligne; x += 1) {
      const v = brut[y * (ligne + 1) + 1 + x];
      const a = x >= bpp ? px[y * ligne + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * ligne + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * ligne + x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[y * ligne + x] = r & 255;
    }
  }
  return { w, h, pixel: (x, y) => { const k = Math.round(y) * ligne + Math.round(x) * bpp; return [px[k], px[k + 1], px[k + 2]]; } };
}
const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const lum = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// Le texte contre son fond : le fond est la couleur la plus frequente du
// rectangle, le texte le pixel qui s en eloigne le plus.
function contrasteTexte(img, r) {
  const compte = new Map();
  const pix = [];
  for (let y = Math.ceil(r.top) + 1; y < Math.floor(r.bottom) - 1; y += 1) for (let x = Math.ceil(r.left) + 1; x < Math.floor(r.right) - 1; x += 1) { const p = img.pixel(x, y); pix.push(p); const k = p.join(','); compte.set(k, (compte.get(k) || 0) + 1); }
  if (!pix.length) return null;
  const fond = Array.from(compte.entries()).sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  let mieux = 1;
  pix.forEach((p) => { mieux = Math.max(mieux, contraste(p, fond)); });
  return mieux;
}

// ---------------------------------------------------------------------------
// LES SCENARIOS
// ---------------------------------------------------------------------------
function ici(s) { return `${s.fixture} ${s.appareil} ${s.mode}${s.theme === 'light' ? ' clair' : ''}${s.heure ? ' ' + s.heure : ''}${s.variante ? ' +' + s.variante.join('+') : ''}${s.mouvementReduit ? ' mouvement-reduit' : ''}`; }
const ENTREES = Object.fromEntries(FX.FIXTURES.map((f) => [f, FX.lireEntree(f)]));
// Le nombre de cartes que la journee doit dessiner, calcule ici sur l entree
// gelee (il ne depend ni de l ecran ni de l heure).
const CARTES = Object.fromEntries(FX.FIXTURES.map((f) => {
  const e = Object.assign({}, JSON.parse(JSON.stringify(ENTREES[f])), { mesure: (p, t) => String(t).length * 7, ecran: { W: 1200, H: 600, largeurFenetre: 1440 } });
  return [f, MO.ghPlan(e).stats.cartes];
}));
const heureDe = (h) => { const [a, b] = String(h || '15:10').split(':').map(Number); return a + b / 60; };

async function monter(browser, s) {
  return FX.monter(browser, { fixture: s.fixture, appareil: s.appareil, theme: s.theme, plein: s.mode === 'plein', heure: s.heure || '', mouvementReduit: Boolean(s.mouvementReduit), variante: s.variante || [], port: PORT, avantChargement: (p) => p.addInitScript(BIBLIO) });
}
async function repos(page, ms = 250) { await FX.repos(page, ms); }

// LE PREREQUIS : la grille montee, ses cartes, l heure figee.
async function prerequis(page, s, label) {
  const p = await page.evaluate(() => {
    const wrap = document.getElementById('globalPlanningGridWrap');
    return {
      grille: Boolean(wrap && wrap._ghPlan && wrap._ghRacine && wrap._ghRacine.querySelector('.gh-grille')),
      cartes: wrap && wrap._ghPlan ? wrap._ghPlan.stats.cartes : -1,
      heure: typeof currentTimeDecimal === 'function' ? currentTimeDecimal() : null,
      lectures: Boolean(window.__lectures && window.__lectures.installe),
      polices: !document.fonts || document.fonts.status === 'loaded',
    };
  });
  const h = heureDe(s.heure) % 24;
  const attendu = s.variante && s.variante.length ? p.cartes : CARTES[s.fixture];
  return ok(p.grille && p.cartes === attendu && p.heure != null && Math.abs(p.heure - h) < 1 / 120 && p.lectures && p.polices, `[prerequis] ${label} : grille montee, ${attendu} cartes, ${s.heure || '15:10'}, polices chargees, compteur pose`, p);
}

const LETTRES_STRUCTURE = [['T1', 'la journee tient en hauteur'], ['T2', 'rien ne defile de cote'], ['T3', 'chaque heure pleine a son libelle a sa ligne'], ['T4', 'l axe est lineaire'], ['C1', 'rien ne se recouvre'], ['C2', 'aucun texte ne deborde'], ['N1', 'chaque nom est la forme de son echelle'], ['N2', 'un nom des qu il tient'], ['N3', 'deux groupes n ecrivent jamais le meme texte'], ['W1', 'les colonnes font la grille, les planchers tiennent'], ['W2', 'une carte s etend sur les voies libres'], ['B1', 'les pistes egales, numerotees, chaque carte sur ses pistes'], ['X2', 'chaque carte est un bouton nomme'], ['X4', 'Agrandir en avant si et seulement si l essentiel manque'], ['G1', 'ni degrade, Geist, chiffres tabulaires'], ['X3', 'aucune animation au repos'], ['A', 'l onglet, la boite, la liste dessous'], ['I', 'le plein ecran tient']];
function verifierStructure(lu, label, lettres = LETTRES_STRUCTURE) {
  if (lu.manque) return ok(false, `[T1] ${label} : la grille`, 'pas de grille');
  for (const [k, quoi] of lettres) {
    if (k === 'I' && !lu.T1.plein) continue;
    ok(sansFaute(lu.F[k]), `[${k === 'A' || k === 'I' ? 'K][' + k : k}] ${label} : ${quoi}`, (lu.F[k] || []).slice(0, 4));
  }
}

const geometries = new Map();
const COLONNES_CENTRE = ['bowling', 'duckpin', 'laser', 'funrun', 'arcades', 'minigolf', 'plaine', 'billard'];

async function scenario(browser, s) {
  const label = ici(s);
  const { ctx, page, erreurs } = await monter(browser, s);
  try {
    if (!(await prerequis(page, s, label))) return;
    const lu = await page.evaluate(lireStructure);
    verifierStructure(lu, label);
    // [G1] la meme geometrie en clair qu en sombre ; [W4] a toute heure.
    const cleGeo = `${s.fixture}|${s.appareil}|${s.mode}|${(s.variante || []).join('+')}`;
    if (!s.mouvementReduit && !s.variante) {
      if (geometries.has(cleGeo)) {
        const avant = geometries.get(cleGeo);
        ok(avant.geo === lu.geometrie, `[${s.heure && s.heure !== avant.heure ? 'W4' : 'G1'}] ${label} : la meme geometrie qu en ${avant.label}`);
      } else geometries.set(cleGeo, { geo: lu.geometrie, label, heure: s.heure || '' });
    }
    // Une entree gelee qui ne vieillit pas (le gate Node la lit).
    if (s.appareil === 'ordinateur' && s.mode === 'normal' && s.theme === 'dark' && !s.heure && !s.variante) {
      const vue = await page.evaluate(FX.lireEntreeDePage);
      ok(JSON.stringify(vue) === JSON.stringify(ENTREES[s.fixture]), `[prerequis] ${label} : l entree du moteur est celle de entree-${s.fixture}.json (sinon : node scripts/planning-v3-fixtures.js instantanes)`);
    }
    for (const c of CIBLES) {
      if (!c.quand(s)) continue;
      try { await c.faire(page, s, label, lu); } catch (e) { ok(false, `[${c.lettre}] ${label} : ${c.nom}`, 'crash ' + e.message.split('\n')[0]); }
    }
    ok(erreurs.length === 0, `[K][A] ${label} : zero erreur JS`, erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// LES INVARIANTS CIBLES : quand (le scenario) et faire (la page).
// ---------------------------------------------------------------------------
const estS = (f, a, m = 'normal', t = 'dark') => (s) => s.fixture === f && s.appareil === a && s.mode === m && s.theme === t && !s.heure && !s.variante && !s.mouvementReduit;
const CIBLES = [];
function cible(lettre, nom, quand, faire) { CIBLES.push({ lettre, nom, quand, faire }); }

// [T2] et [K][M] AU TELEPHONE : la grille defile de cote, les heures et les tetes restent.
cible('T2', 'au telephone, les heures restent a gauche', (s) => s.appareil === 'telephone' && !s.variante && !s.heure, async (page, s, label) => {
  const r = await page.evaluate(async () => {
    const g = document.querySelector('#globalPlanningBox .gh-grille');
    const h = g.querySelector('.gh-pile--h');
    const tete = g.querySelector('.gh-entete:not(.gh-entete--h)');
    const avant = { h: h.getBoundingClientRect().left, t: tete.getBoundingClientRect().top, sl: g.scrollLeft };
    g.scrollLeft = 200;
    await new Promise((x) => requestAnimationFrame(() => requestAnimationFrame(x)));
    const apres = { h: h.getBoundingClientRect().left, t: tete.getBoundingClientRect().top, sl: g.scrollLeft };
    g.scrollLeft = 0;
    return { avant, apres, snap: getComputedStyle(g).scrollSnapType, defile: g.scrollWidth > g.clientWidth };
  });
  ok(r.avant.sl === 0 && (!r.defile || (r.apres.sl > 0 && Math.abs(r.apres.h - r.avant.h) < 0.5 && /^x( proximity)?$/.test(r.snap))), `[T2] ${label} : la grille s ouvre a gauche, defile de cote, les heures restent a gauche (x proximity)`, r);
  ok(!r.defile || Math.abs(r.apres.t - r.avant.t) < 0.5, `[K][M] ${label} : les tetes restent en haut au defilement de cote`, r);
});

// [N4] LES GROUPES NOMMES
cible('N4', 'groupes nommes', (s) => (estS('pic', 'ordinateur')(s) || estS('pic', 'grand')(s) || estS('pire', 'grand')(s)), async (page, s, label) => {
  const n = await page.evaluate(lireNoms);
  const seuil = s.fixture === 'pic' ? (s.appareil === 'grand' ? 46 : 44) : 56;
  ok(n.nommes >= seuil, `[N4] ${label} : ${seuil} groupes nommes sur ${n.groupes} au moins`, { nommes: n.nommes, muettes: n.muettes.slice(0, 6) });
});
// (calme et normal : chaque carte d une ligne ecrit un nom, la ou la place
// le permet. A 1440 en vue normale et en dessous, la somme des formes les
// plus courtes depasse la grille (pistes egales, planchers des colonnes
// vides) : la spec n y est pas tenable, le gate le dit par ses mesures.)
cible('N4', 'chaque carte d une ligne ecrit un nom', (s) => ['calme', 'normal'].includes(s.fixture) && s.theme === 'dark' && !s.heure && !s.variante && !s.mouvementReduit && (s.appareil === 'grand' || (s.appareil === 'ordinateur' && s.mode === 'plein')), async (page, s, label) => {
  const n = await page.evaluate(lireNoms);
  ok(n.muettes.length === 0, `[N4] ${label} : chaque carte d au moins une ligne ecrit un nom`, n.muettes.slice(0, 6));
  if (s.appareil === 'grand' && s.mode === 'normal') {
    await page.locator('#globalPlanningBox .gh-c').first().click();
    await repos(page, 250);
    const p = await page.evaluate(lireNoms);
    const lu = await page.evaluate(lireStructure);
    ok(p.muettes.length === 0, `[N4] ${label} panneau ouvert : chaque carte d au moins une ligne ecrit un nom`, p.muettes.slice(0, 6));
    verifierStructure(lu, label + ' panneau ouvert', LETTRES_STRUCTURE.filter(([k]) => ['T1', 'T2', 'C1', 'C2', 'N1', 'W1'].includes(k)));
  }
});
cible('N4', 'au calme a 1440, les noms complets', estS('calme', 'ordinateur'), async (page, s, label) => {
  const n = await page.evaluate(lireNoms);
  // (un segment laser a la part de ses armes de la barre, spec 6.3 : « Amis
  // de Bastien », 8 armes sur 30, y ecrit sa cle ; les cartes, elles, tout)
  const courts = n.formes.filter((f) => f.k !== 'seg' && f.forme !== 0);
  ok(courts.length === 0 && n.muettes.length === 0, `[N4] ${label} : chaque carte ecrit son nom complet (N1)`, { courts: courts.slice(0, 4), muettes: n.muettes });
  ok(courts.length === 0, `[J1] ${label} : aucun nom raccourci`, courts.slice(0, 4));
});

// [W1] AU PIC A 1440 : le Fun Run plus etroit que le laser et la plaine, la plaine a 104 px.
cible('W1', 'les largeurs du pic', estS('pic', 'ordinateur'), async (page, s, label, lu) => {
  const c = Object.fromEntries(lu.colonnes.map((x) => [x.cle, x.w]));
  ok(c.funrun < c.laser && c.funrun < c.plaine && c.plaine >= 104, `[W1] ${label} : Fun Run (${c.funrun}) plus etroit que le laser (${c.laser}) et la plaine (${c.plaine}), plaine >= 104`, c);
  ok(c.plaine >= 104, `[P1] ${label} : la plaine fait au moins 2 x 52 px`, c.plaine);
});

// [P1] LA PLAINE
cible('P1', 'les presences', (s) => estS('pic', 'ordinateur')(s) || estS('normal', 'ordinateur')(s), async (page, s, label) => {
  const r = await page.evaluate(() => {
    const wrap = document.getElementById('globalPlanningGridWrap');
    const plan = wrap._ghPlan, entree = wrap._ghEntree;
    const now = entree.maintenant;
    const fautes = [];
    const pile = document.querySelector('#globalPlanningBox .gh-pile[data-gh-cle="plaine"]');
    const presences = Array.from(pile.querySelectorAll('.gh-c.is-presence'));
    const rects = [];
    presences.forEach((c) => {
      const el = plan.elements.find((x) => x.cle === c.getAttribute('data-gh-k'));
      const nom = c.querySelector('.gh-c__nom'), n = c.querySelector('.gh-pr__n');
      // (des 40 px le nom ; le compte aussi, des qu il a sa ligne ou qu ils tiennent ensemble)
      const M = window.PinlanePlanningMoteur.mesureur(window.__ghMesure);
      const ensemble = el.formes.some((t) => M.m(plan.typo.nom, t) + 1 + 6 + M.tab(plan.typo.tag, String(el.enfants)) + 1 <= el.tw);
      if (el.bw >= 40 && el.L >= 1 && !nom) fautes.push(`${el.cle} (${el.bw} px) sans nom`);
      if (el.bw >= 40 && (el.L >= 2 || ensemble) && !n) fautes.push(`${el.cle} (${el.bw} px, ${el.L} lignes) sans compte`);
      if (n) rects.push({ r: n.getBoundingClientRect(), k: el.cle });
      if (c.classList.contains('peut-suivre') && c.classList.contains('is-encours')) {
        const bloc = c.querySelector('.gh-c__t');
        const rp = pile.getBoundingClientRect();
        const yNow = rp.top + window.PinlanePlanningMoteur.ghY(plan.axe, now);
        const rb = bloc.getBoundingClientRect(), rc = c.getBoundingClientRect();
        const colle = Math.abs(rb.bottom - (rc.bottom - 1)) <= 2;
        if (!(rb.top >= yNow - 0.5 && rb.top <= yNow + plan.typo.ligne + 2.5) && !colle) fautes.push(`${el.cle} : le nom a ${(rb.top - yNow).toFixed(1)} px de maintenant`);
      }
    });
    for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i].r, b = rects[j].r;
      const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (dy > 0 && Math.max(b.left - a.right, a.left - b.right) < 4) fautes.push(`comptes de ${rects[i].k} et ${rects[j].k} a moins de 4 px`);
    }
    const la = entree.seances.filter((x) => x.colonne === 'plaine' && x.debut <= now + 1e-6 && x.fin > now + 1e-6).reduce((a, x) => a + (Number(x.enfants) || 0), 0);
    const sous = (document.querySelector('#globalPlanningBox .gh-entete[data-gh-cle="plaine"] .gh-entete__sous') || {}).textContent || '';
    return { fautes, la, sous, presences: presences.length, suivent: presences.filter((c) => c.classList.contains('peut-suivre') && c.classList.contains('is-encours')).length };
  });
  if (s.fixture === 'normal') ok(r.suivent > 0, `[prerequis] ${label} : une presence haute en cours (le Club des enfants du mercredi)`, r);
  ok(r.fautes.length === 0 && r.presences > 0, `[P1] ${label} : chaque presence de 40 px ecrit son nom, et ses enfants des qu ils ont leur place, les comptes ne se touchent pas, le nom suit maintenant (${r.suivent} en cours hautes)`, r.fautes.slice(0, 4));
  ok(new RegExp('^' + r.la + ' (enf\\. là|là)$|^' + r.la + '$').test(r.sous), `[P1] ${label} : la tete dit « ${r.la} enf. là »`, r.sous);
});

// [S1] COULEUR = STATUT
cible('S1', 'couleur = statut', (s) => estS('pic', 'ordinateur')(s) || estS('pic', 'ordinateur', 'normal', 'light')(s), async (page, s, label) => {
  const r = await page.evaluate(() => {
    const fautes = [];
    const cartes = Array.from(document.querySelectorAll('#globalPlanningBox .gh-c'));
    const etat = (c) => (c.className.match(/is-(fini|encours|avenir|retard)/) || [])[1];
    const statut = (c) => (c.className.match(/t-(conf|arr|paid|absent)/) || [])[1];
    const genre = (c) => (c.classList.contains('gh-seg') ? 'seg' : c.classList.contains('is-presence') ? 'presence' : 'carte') + (c.classList.contains('is-libre') ? '-libre' : '');
    const parGroupe = new Map(), parStatut = new Map();
    cartes.forEach((c) => {
      const s = getComputedStyle(c);
      const bar = s.borderLeftColor, fond = s.backgroundColor;
      const k1 = c.getAttribute('data-gp-res') + '|' + etat(c);
      if (!parGroupe.has(k1)) parGroupe.set(k1, new Set());
      parGroupe.get(k1).add(bar);
      const k2 = statut(c) + '|' + etat(c) + '|' + genre(c);
      if (!parStatut.has(k2)) parStatut.set(k2, new Map());
      parStatut.get(k2).set(bar + ' / ' + fond, c.getAttribute('data-gh-k'));
      // La barre : le jeton de son statut (le rouge du retard, le gris du fini).
      if (etat(c) !== 'retard' && etat(c) !== 'fini') {
        const sonde = document.createElement('i');
        sonde.style.cssText = 'position:absolute;width:0;height:0;border-left:1px solid var(--bk-barre)';
        c.appendChild(sonde);
        const jeton = getComputedStyle(sonde).borderLeftColor;
        sonde.remove();
        if (jeton !== bar) fautes.push(`${c.getAttribute('data-gh-k')} : barre ${bar} au lieu de ${jeton}`);
      }
    });
    parGroupe.forEach((v, k) => { if (v.size > 1) fautes.push(`le groupe ${k} a ${v.size} couleurs de barre`); });
    parStatut.forEach((v, k) => { if (v.size > 1) fautes.push(`${k} : ${v.size} couleurs (${Array.from(v.values()).slice(0, 3).join(', ')})`); });
    return fautes;
  });
  ok(r.length === 0, `[S1] ${label} : un groupe garde sa couleur partout, la couleur est celle du statut`, r.slice(0, 4));
});

// [R1] LA PORTEUSE ; [A1] LA CARTE D ARRIVEE
function lirePorteuses() {
  const wrap = document.getElementById('globalPlanningGridWrap');
  const plan = wrap._ghPlan, entree = wrap._ghEntree, etats = wrap._ghEtats || plan.etats;
  const now = entree.maintenant;
  const groupes = new Map(entree.groupes.map((g) => [g.id, g]));
  const fautes = [];
  const parGroupe = new Map();
  document.querySelectorAll('#globalPlanningBox [data-gh-k]').forEach((n) => {
    const el = plan.elements.find((x) => x.cle === n.getAttribute('data-gh-k'));
    if (!el) return;
    if (!parGroupe.has(el.gid)) parGroupe.set(el.gid, []);
    parGroupe.get(el.gid).push({ n, el, etat: etats.elements[el.cle] });
  });
  const attendu = (g) => g.statut !== 'arr' && g.statut !== 'paid' && !g.absent && g.etat === 'upcoming' && !g.retard;
  parGroupe.forEach((liste, gid) => {
    const g = groupes.get(gid);
    const rang = (x) => (x.el.k === 'carte' ? (x.el.secondaire ? 1 : 0) : x.el.k === 'presence' ? 2 : 3);
    const meilleur = Math.min(...liste.map(rang));
    const c = liste.filter((x) => rang(x) === meilleur);
    const tot = (a, b) => a.el.debut - b.el.debut || a.el.colonne - b.el.colonne || a.el.x - b.el.x;
    const large = (a, b) => b.el.bw - a.el.bw || tot(a, b);
    const place = (a, b) => b.el.bw * b.el.h - a.el.bw * a.el.h || tot(a, b);
    let choix = null;
    if (g.retard && now != null) choix = c.filter((x) => x.etat === 'retard').sort(tot)[0] || null;
    if (!choix && attendu(g)) choix = c.slice().sort(tot)[0];
    if (!choix) choix = c.filter((x) => x.etat === 'encours').sort(large)[0] || null;
    if (!choix) choix = c.filter((x) => x.etat !== 'fini').sort(place)[0] || null;
    if (!choix) choix = c.slice().sort(large)[0];
    const porteuses = liste.filter((x) => x.n.hasAttribute('data-gh-porteuse'));
    if (porteuses.length !== 1 || porteuses[0] !== choix) fautes.push(`${g.nom} : porteuse ${porteuses.map((x) => x.el.cle).join(',') || 'aucune'} au lieu de ${choix && choix.el.cle}`);
    liste.forEach((x) => { if (x !== choix && x.n.querySelector('.gp-tag:not(.is-piste):not(.is-conflit), .gh-pictos')) fautes.push(`${g.nom} : etiquette ou picto sur ${x.el.cle}, qui ne porte pas`); });
    if (g.retard && now != null && choix) {
      const tag = choix.n.querySelector('.gp-tag.is-retard');
      const min = Math.max(1, Math.round((now - g.depuis) * 60));
      if (tag && !(tag.textContent === `retard ${min} min` || tag.textContent === `+${min}`)) fautes.push(`${g.nom} : « ${tag.textContent} » pour ${min} min de retard`);
    }
  });
  // LA CARTE D ARRIVEE
  const arrivees = [];
  entree.groupes.forEach((g) => {
    const liste = (parGroupe.get(g.id) || []);
    const marquees = liste.filter((x) => x.n.hasAttribute('data-gh-arrivee'));
    const siennes = entree.seances.filter((x) => x.groupe === g.id);
    const premiere = Math.min(...siennes.map((x) => x.debut));
    const doit = attendu(g) && now != null && premiere >= now - 1e-6 && premiere <= now + 0.5 + 1e-6;
    if (!doit && marquees.length) fautes.push(`${g.nom} : carte d arrivee sans en etre une`);
    if (doit) {
      arrivees.push(g.nom);
      // (sa premiere carte de la journee, presence et segment compris ; seule
      // une carte ecrit une heure)
      const cartes = liste.filter((x) => !x.el.secondaire).sort((a, b) => a.el.debut - b.el.debut || a.el.colonne - b.el.colonne || a.el.x - b.el.x);
      if (marquees.length !== 1 || marquees[0] !== cartes[0]) fautes.push(`${g.nom} : ${marquees.length} cartes d arrivee, pas sa premiere`);
      else if (cartes[0].el.k === 'carte') {
        const el = cartes[0].el;
        const Mo = window.PinlanePlanningMoteur;
        const M = Mo.mesureur(window.__ghMesure);
        const court = el.formes[el.formes.length - 1];
        const h = (el.libre ? '≈ ' : '') + formatClockDisplay(el.debut);
        const besoin = M.tab(plan.typo.petit, h) + 1 + M.m(plan.typo.nom, ' ') + M.m(plan.typo.nom, court) + 1;
        const ecrit = cartes[0].n.querySelector('.gh-c__h');
        if (el.L >= 1 && el.tw >= besoin && !(ecrit && ecrit.textContent === h)) fautes.push(`${g.nom} : la carte d arrivee (${el.tw} px) n ecrit pas son heure ${h}`);
      }
    }
  });
  return { fautes, arrivees };
}
cible('R1', 'la porteuse', (s) => estS('pic', 'ordinateur')(s) || estS('pire', 'ordinateur')(s) || estS('normal', 'ordinateur')(s), async (page, s, label) => {
  const r = await page.evaluate(lirePorteuses);
  ok(r.fautes.filter((f) => !/arrivee/.test(f)).length === 0, `[R1] ${label} : les etiquettes d un groupe sur une seule carte, la bonne, le retard juste`, r.fautes.filter((f) => !/arrivee/.test(f)).slice(0, 4));
  if (s.fixture === 'pic') ok(r.fautes.filter((f) => /arrivee/.test(f)).length === 0 && r.arrivees.length > 0, `[A1] ${label} : chaque groupe attendu entre 15:10 et 15:40 a une carte d arrivee, sa premiere, qui garde son heure (${r.arrivees.length})`, r.fautes.filter((f) => /arrivee/.test(f)).slice(0, 4));
});

// [L1] LES PARTIES ; [L2] LES SEGMENTS
function lireParties() {
  const wrap = document.getElementById('globalPlanningGridWrap');
  const plan = wrap._ghPlan;
  const fautes = [];
  // Les parties, recalculees ici depuis les dossiers : les vagues d un groupe
  // a la meme minute, puis les debuts a 2 min pres.
  const fenetres = [];
  const entrees = [];
  todaysReservations().forEach((r) => {
    const parMinute = new Map();
    getLaserWindowsFromReservation(r).forEach((w) => {
      fenetres.push({ start: Number(w.start), end: Number(w.end), players: Math.max(0, Number(w.players || r.pax || 0)) });
      const k = Math.round(w.start * 60);
      const x = parMinute.get(k);
      if (x) { x.fin = Math.max(x.fin, w.end); return; }
      parMinute.set(k, { gid: String(r.id), debut: w.start, fin: w.end });
    });
    parMinute.forEach((x) => entrees.push(x));
  });
  (typeof getBlocagesEnLigne === 'function' ? getBlocagesEnLigne(state.currentDate) : []).forEach((b) => getLaserWindowsFromReservation(b).forEach((w) => fenetres.push({ start: Number(w.start), end: Number(w.end), players: Math.max(0, Number(w.players || b.pax || 0)) })));
  entrees.sort((a, b) => a.debut - b.debut);
  const parties = [];
  entrees.forEach((e) => { const p = parties[parties.length - 1]; if (p && e.debut <= p.debut + 2 / 60 + 1e-6) p.e.push(e); else parties.push({ debut: e.debut, e: [e] }); });
  const C = getAvailabilityLaserCapacity();
  const blocs = Array.from(document.querySelectorAll('#globalPlanningBox .gh-partie'));
  if (blocs.length !== parties.length) fautes.push(`${blocs.length} blocs pour ${parties.length} parties`);
  parties.forEach((p) => {
    const A = Math.max(...p.e.map((e) => getLaserSessionArenaPlayers({ start: e.debut, end: e.fin, players: 0 }, fenetres)));
    const el = plan.elements.find((x) => x.k === 'partie' && Math.abs(x.debut - p.debut) < 1e-6);
    const bloc = el && document.querySelector(`#globalPlanningBox .gh-partie[data-gh-partie="${el.cle}"]`);
    if (!bloc) { fautes.push(`pas de bloc pour la partie de ${formatClockDisplay(p.debut)}`); return; }
    const gids = new Set(p.e.map((e) => e.gid));
    const segs = Array.from(bloc.querySelectorAll('.gh-seg')).map((x) => x.getAttribute('data-gp-res'));
    if (segs.length !== gids.size || segs.some((g) => !gids.has(g))) fautes.push(`${formatClockDisplay(p.debut)} : ${segs.length} segments pour ${gids.size} groupes`);
    if (el.armes !== A) fautes.push(`${formatClockDisplay(p.debut)} : ${el.armes} armes au lieu de ${A}`);
    const t = (bloc.querySelector('.gh-partie__t, .gh-partie__n') || {}).textContent || '';
    if (t && t.indexOf(A + '/' + C) < 0) fautes.push(`${formatClockDisplay(p.debut)} : la tete dit « ${t} » au lieu de ${A}/${C}`);
    if (el.C !== C) fautes.push(`capacite ${el.C} au lieu de ${C}`);
  });
  const texte = document.querySelector('#globalPlanningBox .gh').outerHTML;
  if (/gilet/i.test(texte)) fautes.push('« gilet » dans le planning');
  return { fautes, parties: parties.length, C };
}
cible('L1', 'les parties', (s) => estS('pic', 'ordinateur')(s) || estS('pire', 'ordinateur')(s) || (s.variante && (s.variante.includes('vagues') || s.variante.includes('gembloux') || s.variante.includes('laser34'))), async (page, s, label) => {
  const r = await page.evaluate(lireParties);
  ok(r.fautes.length === 0 && r.parties > 0, `[L1] ${label} : chaque partie (debuts a 2 min) un bloc, un segment par groupe, A = max des arenes, capacite ${r.C}, aucun « gilet » (${r.parties} parties)`, r.fautes.slice(0, 4));
});
function lireSegments() {
  const wrap = document.getElementById('globalPlanningGridWrap');
  const plan = wrap._ghPlan;
  const laser = plan.colonnes.find((c) => c.nature === 'laser');
  const blocs = plan.elements.filter((x) => x.k === 'partie').map((p) => {
    const n = document.querySelector(`#globalPlanningBox .gh-partie[data-gh-partie="${p.cle}"]`);
    const segs = plan.elements.filter((x) => x.k === 'seg' && x.partie === p.cle);
    return {
      debut: p.debut, fin: p.fin, armes: p.armes, C: p.C, L: p.L, w: p.w, x: p.x, voie: Math.round(p.x),
      tete: ((n && n.querySelector('.gh-partie__t, .gh-partie__n')) || {}).textContent || '',
      danger: Boolean(n && n.classList.contains('is-danger')), aria: (n && n.getAttribute('aria-label')) || '',
      couleur: n && n.querySelector('.gh-partie__t, .gh-partie__n') ? getComputedStyle(n.querySelector('.gh-partie__t, .gh-partie__n')).color : '',
      segs: segs.map((sg) => ({ gid: sg.gid, w: sg.w, ess: sg.ess, armes: sg.armes, forme: sg.compo ? sg.compo.forme : -1, dist: sg.distinctive })),
      libre: (p.bouts.find((b) => b.libre) || {}).w || 0, autres: (p.bouts.find((b) => b.autres) || {}).w || 0, B: p.barre.w, bouts: p.bouts.length,
    };
  });
  const sonde = document.createElement('i');
  sonde.style.color = 'var(--danger)';
  document.querySelector('#globalPlanningBox .gh').appendChild(sonde);
  const danger = getComputedStyle(sonde).color;
  sonde.remove();
  return { blocs, laser: laser ? { w: laser.w, ess: laser.essentiel } : null, danger };
}
cible('L2', 'les segments', (s) => (s.fixture === 'pic' || s.fixture === 'pire') && s.theme === 'dark' && !s.heure && !s.mouvementReduit && !s.variante && (s.appareil === 'ordinateur' || s.appareil === 'grand'), async (page, s, label) => {
  const r = await page.evaluate(lireSegments);
  // Tout segment au moins a son essentiel ecrit sa forme distinctive.
  const muets = [];
  r.blocs.forEach((b) => b.segs.forEach((sg) => { if (b.L >= 1 && sg.w >= sg.ess && !(sg.forme >= 0 && sg.forme <= sg.dist)) muets.push(`${sg.gid} (${sg.w}/${sg.ess})`); }));
  ok(muets.length === 0, `[L2] ${label} : tout segment a son essentiel ecrit sa forme distinctive`, muets.slice(0, 4));
  // (un groupe de 8 armes dans une partie de 30 garde son essentiel : des que
  // la colonne a le sien, chaque segment a le sien)
  if (r.laser && r.laser.w >= r.laser.ess) {
    const sous = [];
    r.blocs.forEach((b) => b.segs.forEach((sg) => { if (sg.w < sg.ess - 1) sous.push(`${sg.gid} ${sg.armes} armes : ${sg.w} < ${sg.ess}`); }));
    ok(sous.length === 0, `[L2] ${label} : la colonne laser a son essentiel, chaque segment a le sien (le groupe de 8 armes d une partie de 30 compris)`, sous.slice(0, 4));
  }
  if (s.fixture === 'pic' && s.appareil === 'ordinateur' && s.mode === 'normal') {
    const p = r.blocs.find((b) => Math.abs(b.debut - 19) < 1e-6);
    ok(p && p.armes === 30 && p.segs.length === 3 && !p.libre && /30\/30/.test(p.tete), `[L2] ${label} : la partie de 19:00 (3 groupes, 30 armes) ecrit 30/30, 3 segments, aucun libre`, p);
  }
  // Une partie d un groupe de 10 armes : un segment libre d environ 20/30 de
  // la barre, quand les essentiels tiennent.
  // (les essentiels tiennent : la part du groupe, 10/30 de la barre, couvre
  // son essentiel ; au pic, c est le cas en plein ecran sur le grand ecran)
  const dix = r.blocs.filter((b) => b.segs.length === 1 && b.armes === 10 && b.C === 30 && b.segs[0].ess <= (b.B - (b.bouts - 1)) * 10 / 30);
  if (s.fixture === 'pic' && (dix.length || (s.appareil === 'grand' && s.mode === 'plein'))) {
    const p = dix[0];
    const attendu = p ? (p.B - (p.bouts - 1)) * 20 / 30 : 0;
    ok(p && Math.abs(p.libre - attendu) <= 2, `[L2] ${label} : la partie d un groupe de 10 armes a un segment libre de 20/30 de sa barre`, p ? { libre: p.libre, attendu, B: p.B } : 'aucune partie de 10 armes ou les essentiels tiennent');
  }
  if (s.fixture === 'pire' && s.appareil === 'ordinateur' && s.mode === 'normal') {
    const nuit = r.blocs.filter((b) => b.debut >= 23.5 - 1e-6 && b.fin <= 24 + 25 / 60 + 1e-6 && b.armes === 30);
    ok(nuit.length === 2 && nuit.every((b) => !b.libre && b.segs.length === 1 && b.segs[0].w >= b.B - 1), `[L2] ${label} : les deux parties de 30 armes jusqu a 00:25 sont deux blocs pleins`, nuit);
  }
});
cible('L2', 'laser a 34 armes', (s) => s.variante && s.variante.includes('laser34'), async (page, s, label) => {
  const r = await page.evaluate(lireSegments);
  const p = r.blocs.find((b) => Math.abs(b.debut - 19) < 1e-6);
  ok(p && p.armes === 34 && p.danger && p.couleur === r.danger && /dépasse la capacité/.test(p.aria) && !p.libre, `[L2] ${label} : 34 armes pour 30, le compte en --danger, l aria « dépasse la capacité », aucun libre`, p);
});
cible('L2', 'Gembloux', (s) => s.variante && s.variante.includes('gembloux'), async (page, s, label) => {
  const r = await page.evaluate(lireSegments);
  const trois = r.blocs.filter((b) => b.debut >= 15.5 - 1e-6 && b.debut <= 15 + 50 / 60 + 1e-6);
  const voies = new Set(trois.map((b) => b.voie));
  const autres = trois.some((b) => b.autres > 0);
  ok(trois.length === 3 && voies.size === 3 && autres && trois.every((b) => b.C === 20), `[L2] ${label} : trois lancements qui se chevauchent, trois voies cote a cote, un segment « autres », 20 armes`, trois.map((b) => ({ debut: b.debut, x: b.x, w: b.w, armes: b.armes, autres: b.autres })));
});
cible('L1', 'vagues fusionnees', (s) => s.variante && s.variante.includes('vagues'), async (page, s, label) => {
  const r = await page.evaluate(lireSegments);
  const a16 = r.blocs.filter((b) => Math.abs(b.debut - 16) < 1e-6);
  ok(a16.length === 1 && a16[0].segs.length === 2, `[L1] ${label} : les vagues fusionnees d Ethan et le groupe de 5 min font un seul bloc a 16:00, deux segments`, a16);
});

// [B1] LES PISTES : pire (8 pistes d un groupe, 8 groupes d une piste),
// pistes eparses, 6 pistes.
cible('B1', 'le bowling du pire', estS('pire', 'ordinateur'), async (page, s, label) => {
  const r = await page.evaluate(() => {
    const wrap = document.getElementById('globalPlanningGridWrap');
    const plan = wrap._ghPlan, entree = wrap._ghEntree;
    const nom = (gid) => (entree.groupes.find((g) => g.id === gid) || {}).nom || '';
    const cartes = plan.elements.filter((x) => x.k === 'carte' && x.nature === 'bowling');
    const fed = cartes.find((x) => /Fédération/.test(nom(x.gid)));
    const midi = cartes.filter((x) => Math.abs(x.debut - 12) < 1e-6);
    const ecrit = (gid) => { const n = document.querySelector(`#globalPlanningBox [data-gh-k][data-gp-res="${gid}"] .gh-c__nom`); return n ? n.textContent : ''; };
    return { fed: fed && { pistes: fed.pistes, w: fed.w, col: plan.colonnes.find((c) => c.nature === 'bowling').w }, midi: midi.map((x) => ({ p: x.pistes, nom: nom(x.gid).replace(/^DÉMO · /, ''), ecrit: ecrit(x.gid) })) };
  });
  ok(r.fed && r.fed.pistes.length === 8 && r.fed.w >= r.fed.col - 3, `[B1] ${label} : la Federation couvre les 8 pistes`, r.fed);
  const courts = r.midi.filter((x) => ['Li', 'Al', 'Ky'].includes(x.nom));
  ok(r.midi.length === 8 && new Set(r.midi.map((x) => x.p[0])).size === 8 && courts.length === 2 && courts.every((x) => x.ecrit === x.nom), `[B1] ${label} : a 12:00, 8 cartes, une par piste ; Al et Ky (Li n y joue pas) s ecrivent entiers`, r.midi);
});
cible('B1', 'pistes eparses', (s) => s.variante && s.variante.includes('eparses'), async (page, s, label) => {
  const r = await page.evaluate(() => Array.from(document.querySelectorAll('#globalPlanningBox .gh-pile[data-gh-cle="bowling"] .gh-c')).filter((c) => /Julie/.test(c.getAttribute('aria-label'))).map((c) => ({ res: c.getAttribute('data-gp-res'), nom: (c.querySelector('.gh-c__nom') || {}).textContent || '', w: c.getBoundingClientRect().width })));
  ok(r.length === 2 && r[0].res === r[1].res, `[B1] ${label} : les pistes 1, 2, 6, 7, 8 font deux cartes du meme groupe`, r);
});
cible('B1', '6 pistes', (s) => s.variante && s.variante.includes('pistes6'), async (page, s, label) => {
  const r = await page.evaluate(() => ({ nums: Array.from(document.querySelectorAll('#globalPlanningBox .gh-entete[data-gh-cle="bowling"] .gh-num')).map((x) => x.textContent), N: getAvailabilityLaneCount() }));
  ok(r.N === 6 && JSON.stringify(r.nums) === JSON.stringify(['1', '2', '3', '4', '5', '6']), `[B1] ${label} : un centre a 6 pistes, 6 sous-colonnes`, r);
});

// [B2] LES PISTES MAINTENANT
function lirePistesMaintenant() {
  const wrap = document.getElementById('globalPlanningGridWrap');
  const entree = wrap._ghEntree;
  const now = entree.maintenant;
  const occ = new Set();
  todaysReservations().forEach((r) => getBowlingWindowsFromReservation(r).forEach((w) => { if (now != null && w.start <= now + 1e-6 && w.end > now + 1e-6) (w.lanes || []).forEach((p) => occ.add(Number(p))); }));
  const nums = Array.from(document.querySelectorAll('#globalPlanningBox .gh-entete[data-gh-cle="bowling"] .gh-num'));
  const occupees = nums.filter((x) => x.classList.contains('is-occupee')).map((x) => Number(x.textContent));
  const maint = nums.filter((x) => x.classList.contains('is-maint')).map((x) => Number(x.textContent));
  const libresKpi = typeof getStaffBowlingLanesFreeNow === 'function' && getStaffBowlingLanesFreeNow() ? getStaffBowlingLanesFreeNow().libres.map((x) => x.lane) : null;
  const barre = nums.filter((x) => x.classList.contains('is-maint')).map((x) => getComputedStyle(x).textDecorationLine);
  return { occ: Array.from(occ).sort((a, b) => a - b), occupees, maint, N: nums.length, libresKpi, barre, teinte: document.querySelectorAll('#globalPlanningBox .gh-pile[data-gh-cle="bowling"] .gh-maint').length, aujourdhui: entree.aujourdhui };
}
cible('B2', 'les pistes maintenant', (s) => estS('pic', 'ordinateur')(s) || (s.fixture === 'pic' && s.variante && s.variante.includes('maintenance5')) || (s.fixture === 'pic' && s.heure === '34:00'), async (page, s, label) => {
  const r = await page.evaluate(lirePistesMaintenant);
  if (s.heure === '34:00') { ok(r.occupees.length === 0, `[B2] ${label} : un autre jour, aucune piste occupee`, r); return; }
  const libres = r.N - r.occupees.length - r.maint.length;
  ok(JSON.stringify(r.occupees) === JSON.stringify(r.occ.filter((p) => !r.maint.includes(p))) && r.libresKpi && libres === r.libresKpi.length, `[B2] ${label} : les numeros occupes sont les pistes reservees a 15:10, N - occupees - maintenance = « Libres maintenant » (${libres})`, r);
  if (!s.variante) ok(JSON.stringify(r.libresKpi) === JSON.stringify([1, 2, 5, 8]), `[B2] ${label} : au pic a 15:10, les pistes 1, 2, 5 et 8 sont libres`, r.libresKpi);
  else ok(JSON.stringify(r.maint) === '[5]' && r.barre[0] === 'line-through' && r.teinte === 1, `[B2] ${label} : la piste 5 en maintenance, son numero barre, sa sous-colonne teintee`, r);
});

// [B3] LA CASE VIDE ; [K][Q] la reservation rapide a son heure et sur sa piste.
async function cliquerCase(page, colonne, piste, t, espion = true) {
  return page.evaluate(({ colonne, piste, t, espion }) => {
    const wrap = document.getElementById('globalPlanningGridWrap');
    const plan = wrap._ghPlan;
    const ci = plan.colonnes.findIndex((c) => c.cle === colonne);
    const col = plan.colonnes[ci];
    const pile = document.querySelector(`#globalPlanningBox .gh-pile[data-gh-col="${ci}"]`);
    const rp = pile.getBoundingClientRect();
    const Mo = window.PinlanePlanningMoteur;
    const x = rp.left + (col.pistes ? col.pistes[piste - 1].x + col.pistes[piste - 1].w / 2 : col.w / 2);
    const y = rp.top + Mo.ghY(plan.axe, t + 0.25);
    const appels = [];
    const natif = window.quickFromCell;
    const natifL = window.lpReserver;
    if (espion) { window.quickFromCell = function (p, h) { appels.push(['bowling', p, h]); }; window.lpReserver = function (h) { appels.push(['laser', h]); }; }
    const cible = document.elementFromPoint(x, y);
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    cible.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'mouse' }, opts)));
    cible.dispatchEvent(new MouseEvent('click', opts));
    if (espion) { window.quickFromCell = natif; window.lpReserver = natifL; }
    return { appels, cible: cible.className, attendu: Math.floor(Mo.ghT(plan.axe, y - rp.top) * 2) / 2 };
  }, { colonne, piste, t, espion });
}
cible('B3', 'la case vide', (s) => estS('pic', 'ordinateur')(s) || (s.variante && s.variante.includes('maintenance5')) || (s.variante && s.variante.includes('enligne6')) || estS('ferme', 'ordinateur')(s), async (page, s, label) => {
  if (s.fixture === 'ferme') {
    const r = await cliquerCase(page, 'bowling', 3, 12);
    ok(r.appels.length === 0, `[B3] ${label} : un jour ferme, aucune case ne reserve`, r);
    return;
  }
  if (s.variante && s.variante.includes('maintenance5')) {
    const r = await cliquerCase(page, 'bowling', 5, 12);
    ok(r.appels.length === 0, `[B3] ${label} : aucune reservation sur la piste 5 en maintenance`, r);
    return;
  }
  if (s.variante && s.variante.includes('enligne6')) {
    const r = await cliquerCase(page, 'bowling', 6, 16);
    ok(r.appels.length === 0, `[B3] ${label} : aucune reservation sur la piste 6 bloquee en ligne`, r);
    return;
  }
  const r = await cliquerCase(page, 'bowling', 5, 12);
  ok(r.appels.length === 1 && r.appels[0][1] === 5 && r.appels[0][2] === r.attendu && r.attendu === 12, `[B3] ${label} : un clic sur la piste 5 a 12:15 appelle quickFromCell(5, 12)`, r);
  // [K][Q] pour de vrai : la reservation rapide s ouvre a 12:00 sur la piste 5.
  await cliquerCase(page, 'bowling', 5, 12, false);
  await repos(page, 300);
  const q = await page.evaluate(() => ({ ouverte: typeof quickBookState !== 'undefined' && Boolean(quickBookState), heure: typeof quickBookState !== 'undefined' && quickBookState ? quickBookState.startTime : null, pistes: typeof quickBookState !== 'undefined' && quickBookState ? quickBookState.lanes : null }));
  ok(q.ouverte && q.heure === '12:00' && JSON.stringify(q.pistes) === '[5]', `[K][Q] ${label} : une case vide du bowling ouvre la reservation rapide a son heure, sur sa piste`, q);
  await page.evaluate(() => { if (typeof closeQuickBook === 'function') closeQuickBook(); });
});

// [B4] LA RESERVATION EN LIGNE EN COURS
cible('B4', 'le bloc en ligne', (s) => s.variante && s.variante.includes('enligne6'), async (page, s, label) => {
  const r = await page.evaluate(async () => {
    const b = document.querySelector('#globalPlanningBox .gh-enligne[data-gh-enligne="6"]');
    if (!b) return { manque: true };
    const s2 = getComputedStyle(b);
    const blocage = getBlocagesEnLigne(state.currentDate)[0];
    const r = b.getBoundingClientRect();
    const sous = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    sous.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: 'mouse' }));
    await new Promise((x) => requestAnimationFrame(x));
    const f = document.querySelector('#globalPlanningBox .gh-ajout');
    return { role: b.getAttribute('role'), aria: b.getAttribute('aria-label'), texte: b.textContent, barre: s2.borderLeftWidth, attendu: texteBlocageEnLigne(blocage), fantome: Boolean(f && !f.hidden) };
  });
  ok(!r.manque && r.role === 'note' && r.aria.indexOf(r.attendu) >= 0 && /^Piste 6, 16:00/.test(r.aria) && /En ligne/.test(r.texte) && r.barre === '1px' && !r.fantome, `[B4] ${label} : un bloc neutre « En ligne » sur la piste 6 a 16:00, role note, sans barre de statut, aucun fantome`, r);
});

// [W3] LE FILTRE ET LA RECHERCHE ; [K][G] la recherche eteint sans retirer.
cible('W3', 'filtre et recherche', estS('pic', 'ordinateur'), async (page, s, label) => {
  const largeurs = () => page.evaluate(() => getComputedStyle(document.querySelector('#globalPlanningBox .gh-grille')).gridTemplateColumns);
  const avant = await largeurs();
  const n0 = await page.evaluate(() => document.querySelectorAll('#globalPlanningBox .gh-c').length);
  await page.evaluate(() => setStaffStatusFilter('onsite'));
  await repos(page, 250);
  const filtre = await largeurs();
  const n1 = await page.evaluate(() => document.querySelectorAll('#globalPlanningBox .gh-c').length);
  await page.evaluate(() => setStaffStatusFilter('all'));
  await repos(page, 250);
  const apres = await largeurs();
  await page.fill('#globalPlanningSearchInput', 'noah');
  await repos(page, 300);
  const ch = await page.evaluate(() => ({ l: getComputedStyle(document.querySelector('#globalPlanningBox .gh-grille')).gridTemplateColumns, cartes: document.querySelectorAll('#globalPlanningBox .gh-c').length, ternes: document.querySelectorAll('#globalPlanningBox .gh-c.is-terne').length, noah: Array.from(document.querySelectorAll('#globalPlanningBox .gh-c.is-terne')).some((c) => /Noah/.test(c.getAttribute('aria-label'))) }));
  await page.fill('#globalPlanningSearchInput', '');
  await repos(page, 300);
  const fin = await largeurs();
  ok(n1 < n0 && filtre === avant && apres === avant && ch.l === avant && fin === avant, `[W3] ${label} : un filtre puis une recherche, retires, les colonnes au pixel pres`, { avant, filtre, apres, n0, n1 });
  ok(ch.cartes === n0 && ch.ternes > 0 && !ch.noah, `[K][G] ${label} : la recherche eteint les autres groupes sans retirer de carte`, ch);
});

// [D3] LE FOCUS ET LE SURVOL RENDUS
cible('D3', 'focus et survol', estS('pic', 'ordinateur'), async (page, s, label) => {
  const carte = page.locator('#globalPlanningBox .gh-c:not(.gh-seg)', { hasText: 'Louise' }).first();
  await carte.hover();
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('#globalPlanningBox .gh-c')).find((x) => /Louise/.test(x.getAttribute('aria-label'))); c.focus(); window.__k = c.getAttribute('data-gh-k'); });
  // Un sondage qui change les donnees : un autre groupe passe arrive.
  await page.evaluate(() => {
    const r = state.reservations.find((x) => /Henrard/.test(x.name));
    r.status = 'arrived';
    renderGlobalPlanningSurface();
  });
  await repos(page, 200);
  const a = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.getAttribute('data-gh-k') === window.__k, survol: document.querySelectorAll('#globalPlanningBox .gh-c.is-groupe').length, henrard: Array.from(document.querySelectorAll('#globalPlanningBox .gh-c')).filter((c) => /Henrard/.test(c.getAttribute('aria-label'))).every((c) => c.classList.contains('t-arr')) }));
  await page.keyboard.press('Enter');
  await repos(page, 250);
  const b = await page.evaluate(() => ({ panneau: Boolean(document.querySelector('#globalPlanningBox .gh-panneau:not([hidden])')), focus: document.activeElement && document.activeElement.getAttribute('data-gh-k') === window.__k }));
  await page.keyboard.press('Escape');
  await repos(page, 200);
  ok(a.focus && a.survol >= 2 && a.henrard && b.panneau && b.focus, `[D3] ${label} : apres un sondage qui change les donnees et a l ouverture du panneau, la carte garde le focus et le groupe survole reste allume`, { a, b });
});

// [K][F] « ARRIVE » ECRIT LE POINTAGE
cible('F', 'Arrivé', estS('pic', 'ordinateur'), async (page, s, label) => {
  const id = await page.evaluate(() => {
    const wrap = document.getElementById('globalPlanningGridWrap');
    const g = wrap._ghModele.groupes.find((x) => x.retard && x.r.status !== 'paid' && x.r.status !== 'arrived');
    return g ? g.id : null;
  });
  await page.locator(`#globalPlanningBox .gh-c[data-gp-res="${id}"]`).first().click();
  await repos(page, 300);
  await page.locator('#globalPlanningBox .gh-panneau [data-gh-arrive]').click();
  await repos(page, 800);
  const r = await page.evaluate((id) => ({ patch: (window.__FIXTURE__.patchs || []).filter((p) => p.status === 'arrived').map((p) => String(p.id)), teintes: Array.from(document.querySelectorAll(`#globalPlanningBox .gh-c[data-gp-res="${id}"]`)).map((c) => (c.className.match(/t-\w+/) || [''])[0]) }), id);
  ok(id && r.patch.length === 1 && r.patch[0] === id && r.teintes.length > 0 && r.teintes.every((t) => t === 't-arr'), `[K][F] ${label} : « Arrivé » ecrit le pointage et toutes les cartes du groupe passent a l ambre`, { id, ...r });
});

// [D1] LE PANNEAU, DEFAUT 5 ; [N1] le prefixe garde dans le panneau ; [L1] aucun « gilet ».
async function lirePanneau(page) {
  return page.evaluate(() => {
    const pan = document.querySelector('#globalPlanningBox .gh-panneau:not([hidden])');
    if (!pan) return { ouvert: false };
    const lignes = Array.from(pan.querySelectorAll('.gh-p__prog li')).map((li) => {
      const h = li.querySelector('.gh-p__h');
      const icone = li.querySelector('svg');
      return { h: h.textContent, debord: h.scrollWidth > h.clientWidth, droite: h.getBoundingClientRect().right, icone: icone ? icone.getBoundingClientRect().left : null, act: (li.querySelector('.gh-p__act') || {}).firstChild ? li.querySelector('.gh-p__act').firstChild.textContent : '' };
    });
    return { ouvert: true, nom: (pan.querySelector('.gh-p__nom') || {}).textContent, lignes, texte: pan.textContent, gilet: /gilet/i.test(pan.innerHTML) };
  });
}
cible('D1', 'le panneau de Collegues de bureau', estS('pire', 'ordinateur'), async (page, s, label) => {
  await page.locator('#globalPlanningBox .gh-c[aria-label*="Collègues de bureau"]').first().click();
  await repos(page, 300);
  const p = await lirePanneau(page);
  const fautes = [];
  p.lignes.filter((l) => l.h !== '·').forEach((l) => { if (!/^(≈ )?\d{2}:\d{2}$/.test(l.h)) fautes.push(`« ${l.h} »`); if (l.debord) fautes.push(`${l.h} deborde`); if (l.icone != null && l.droite > l.icone + 0.5) fautes.push(`${l.h} touche son icone`); });
  const acts = p.lignes.map((l) => l.act);
  ok(p.ouvert && p.lignes.length >= 9 && fautes.length === 0 && !p.lignes.some((l) => /toute la visite/.test(l.h)), `[D1] ${label} : chaque cellule d heure ecrit une heure, sans deborder sur son icone (${p.lignes.length} lignes)`, fautes.slice(0, 4));
  ok(['Plaine', 'Minigolf', 'Fun Run'].every((a) => acts.includes(a)) && !acts.includes('Playground'), `[D1] ${label} : les activites s appellent Plaine, Minigolf et Fun Run`, acts);
  ok(!p.gilet, `[L1] ${label} : aucun « gilet » dans le panneau`);
  await page.keyboard.press('Escape');
  await repos(page, 200);
  await page.locator('#globalPlanningBox .gh-c[aria-label*="Famille Renard"]').first().click();
  await repos(page, 300);
  const renard = await lirePanneau(page);
  const debut = await page.evaluate(() => Array.from(document.querySelectorAll('#globalPlanningBox .gh-c__nom')).filter((n) => /^DÉMO · /.test(n.textContent)).length);
  ok(renard.nom === 'DÉMO · Famille Renard' && debut === 0, `[N1] ${label} : aucune carte ne commence par « DÉMO · », le panneau ecrit « DÉMO · Famille Renard »`, { nom: renard.nom, debut });
  await page.keyboard.press('Escape');
  await repos(page, 200);
});

// [D2] LA VITESSE, SANS SEUIL DE MACHINE
cible('D2', 'la vitesse', (s) => estS('pire', 'ordinateur')(s) || estS('pic', 'ordinateur')(s), async (page, s, label) => {
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const layouts = async () => (await client.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount').value;
  const installe = await page.evaluate(() => { const L = window.__lectures; L.arme = true; L.n = 0; document.body.getBoundingClientRect(); const n = L.n; L.arme = false; L.n = 0; return L.installe && n === 1; });
  ok(installe, `[D2] ${label} : le compteur des lectures est pose avant le module et compte`);
  const mesure = (quoi) => page.evaluate((quoi) => {
    const L = window.__lectures;
    const wrap = document.getElementById('globalPlanningGridWrap');
    let carte = null;
    if (quoi === 'rendu') window.__ghReinitialiser(wrap);
    if (quoi === 'ouvrir') carte = Array.from(document.querySelectorAll('#globalPlanningBox .gh-c')).find((c) => /Collègues de bureau|Anniversaire Noah/.test(c.getAttribute('aria-label')));
    L.arme = true; L.n = 0; L.apres = 0; L.ecrit = false; L.noms = [];
    const t0 = performance.now();
    if (quoi === 'rendu') window.renderGlobalPlanning(wrap);
    if (quoi === 'ouvrir') carte.click();
    if (quoi === 'fermer') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const t = performance.now() - t0;
    L.arme = false;
    return { n: L.n, apres: L.apres, noms: L.noms.slice(0, 12), t };
  }, quoi);
  const pas = async (quoi) => { const l0 = await layouts(); const m = await mesure(quoi); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); m.layouts = (await layouts()) - l0; return m; };
  const rendus = [], ouvertures = [], fermetures = [];
  for (let i = 0; i < 3; i += 1) {
    rendus.push(await pas('rendu'));
    ouvertures.push(await pas('ouvrir'));
    fermetures.push(await pas('fermer'));
  }
  const tous = rendus.concat(ouvertures, fermetures);
  ok(tous.every((m) => m.layouts <= 4), `[D2] ${label} : 4 mises en page au plus pour un rendu, une ouverture, une fermeture`, tous.map((m) => m.layouts));
  ok(tous.every((m) => m.n <= 8 && m.apres === 0), `[D2] ${label} : 8 lectures de geometrie au plus, aucune apres une ecriture`, tous.map((m) => [m.n, m.apres, m.noms.join(' ')]));
  const med = (l) => l.map((m) => m.t).sort((a, b) => a - b)[1];
  ok(med(ouvertures) / med(rendus) <= 1.5, `[D2] ${label} : ouvrir le panneau ne coute pas plus qu un rendu complet (${med(ouvertures).toFixed(1)} / ${med(rendus).toFixed(1)} ms)`);
  const src = [MOTEUR, PG].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  ok(!/createRange|getClientRects/.test(src), `[D2] ${label} : ni createRange ni getClientRects dans le moteur et PG`);
});

// [J1] ET [K][N] LES JOURNEES
cible('J1', 'les journees', (s) => estS('vide', 'ordinateur')(s) || estS('ferme', 'ordinateur')(s), async (page, s, label, lu) => {
  const r = await page.evaluate(() => {
    const wrap = document.getElementById('globalPlanningGridWrap');
    const plan = wrap._ghPlan, entree = wrap._ghEntree;
    const nums = Array.from(document.querySelectorAll('#globalPlanningBox .gh-entete[data-gh-cle="bowling"] .gh-num'));
    const libelles = plan.libelles.filter((l) => l.pleine).map((l) => l.texte);
    return {
      bandeau: (document.querySelector('#globalPlanningBox .gh-bandeau:not([hidden])') || {}).textContent || '',
      cartes: document.querySelectorAll('#globalPlanningBox [data-gh-k]').length,
      nums: nums.map((x) => x.textContent), muted: nums.every((x) => !x.classList.contains('is-occupee') && !x.classList.contains('is-maint')),
      colonnes: plan.colonnes.map((c) => ({ cle: c.cle, w: c.w })), premiere: libelles[0], derniere: libelles[libelles.length - 1],
      fenetre: typeof getPlanningWindow === 'function' ? getPlanningWindow(state.currentDate) : entree.fenetre, ferme: document.querySelectorAll('#globalPlanningBox .gh-hors.is-ferme').length, reserve: document.querySelectorAll('#globalPlanningBox .gh-pile.is-reserve').length,
    };
  });
  const cles = r.colonnes.map((c) => c.cle);
  const hors = r.colonnes.filter((c) => c.cle !== 'bowling').map((c) => c.w);
  const bo = (r.colonnes.find((c) => c.cle === 'bowling') || {}).w;
  ok(JSON.stringify(cles) === JSON.stringify(COLONNES_CENTRE) && r.premiere === formatClock(r.fenetre.open) && r.derniere === formatClock(r.fenetre.closed ? 22 : r.fenetre.close), `[K][N] ${label} : toute la grille, des heures d ouverture a la fermeture, toutes les colonnes du centre`, { cles, premiere: r.premiere, derniere: r.derniere });
  if (s.fixture === 'vide') ok(r.cartes === 0 && /Aucune réservation ce jour-là/.test(r.bandeau) && JSON.stringify(r.nums) === JSON.stringify(['1', '2', '3', '4', '5', '6', '7', '8']) && r.muted && Math.max(...hors) - Math.min(...hors) <= 2 && bo >= 2 * Math.min(...hors) - 11 && bo <= 2 * Math.max(...hors) + 2, `[J1] ${label} : 0 carte, « Aucune réservation ce jour-là », les pistes 1 a 8 en --muted, des colonnes egales a 2 px, le bowling double (a ses pistes egales pres)`, { bandeau: r.bandeau, colonnes: r.colonnes });
  else ok(/^Centre fermé ce jour-là/.test(r.bandeau) && r.premiere === '10:00' && r.derniere === '22:00' && r.ferme === 1 && r.reserve === 0, `[J1] ${label} : « Centre fermé ce jour-là », la grille 10:00-22:00 teintee, aucune case qui reserve`, r);
});
function formatClock(h) { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

// [I1] LES ACTIVITES INCONNUES
cible('I1', 'activites inconnues', estS('pire', 'ordinateur'), async (page, s, label) => {
  const r = await page.evaluate(() => Array.from(document.querySelectorAll('#globalPlanningBox .gh-entete[data-gh-cle]')).map((t) => ({ cle: t.getAttribute('data-gh-cle'), title: t.getAttribute('title'), lignes: Array.from(t.querySelectorAll('.gh-entete__t')).map((x) => x.innerHTML.split('<br>')).flat(), icone: Boolean(t.querySelector('svg')) })));
  const cles = r.map((x) => x.cle);
  const iB = cles.indexOf('billard');
  const inconnues = r.filter((x) => /^a-/.test(x.cle));
  const titres = { 'a-escape_room': 'Escape room', 'a-realite_virtuelle_multijoueur': 'Realite virtuelle multijoueur' };
  const fautes = [];
  inconnues.forEach((x) => {
    const t = titres[x.cle];
    if (!t || !x.title || x.title.indexOf(t) !== 0) fautes.push(`${x.cle} : title « ${x.title} »`);
    if (/_/.test(x.title)) fautes.push(`${x.cle} : underscore`);
    const mots = t ? t.split(' ') : [];
    x.lignes.forEach((l, i) => {
      const propre = l.replace(/…$/, '');
      if (/…$/.test(l) && i !== x.lignes.length - 1) fautes.push(`${x.cle} : ellipse avant la fin`);
      propre.split(' ').filter(Boolean).forEach((m) => { if (!mots.includes(m)) fautes.push(`${x.cle} : mot coupe « ${m} »`); });
    });
    if (x.lignes.length > 2) fautes.push(`${x.cle} : ${x.lignes.length} lignes`);
    if (!x.icone) fautes.push(`${x.cle} : sans icone`);
  });
  ok(inconnues.length === 2 && cles.indexOf('a-escape_room') > iB && cles.indexOf('a-realite_virtuelle_multijoueur') > iB && fautes.length === 0, `[I1] ${label} : Escape room et Realite virtuelle multijoueur apres le Billard, titres complets en title, jamais coupes au milieu d un mot`, { cles, fautes });
});

// [X1] LE TOUCHER ; [K][H] le premier toucher montre le programme, le second ouvre la fiche.
// (le toucher a 6 px est rejoue en evenements au point exact : un vrai tap
// passe par l ajustement de cible de Chromium, qui choisirait la carte a la
// place de la tolerance du planning)
function toucherAuPoint({ x, y }) {
  const cible = document.elementFromPoint(x, y);
  const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
  cible.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'touch', isPrimary: true }, o)));
  cible.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'touch', isPrimary: true }, o)));
  cible.dispatchEvent(new MouseEvent('click', o));
  return cible.className;
}
cible('X1', 'le toucher', estS('pic', 'tablette'), async (page, s, label) => {
  const point = await page.evaluate(() => {
    const wrap = document.getElementById('globalPlanningGridWrap');
    const plan = wrap._ghPlan;
    // Une carte du bowling : 6 px sous son bas (un toucher a cote d elle).
    const ci = plan.colonnes.findIndex((c) => c.nature === 'bowling');
    const pile = document.querySelector(`#globalPlanningBox .gh-pile[data-gh-col="${ci}"]`);
    const rp = pile.getBoundingClientRect();
    const libre = (x, y) => { const e = document.elementFromPoint(x, y); return e === pile; };
    const cartes = plan.elements.filter((el) => el.colonne === ci && el.k === 'carte');
    for (const el of cartes) {
      const x = rp.left + el.x + el.w / 2, y = rp.top + el.y + el.h + 6;
      const proche = window.PinlanePlanningMoteur.ghCarteProche(plan, ci, el.x + el.w / 2, el.y + el.h + 6, 8);
      if (libre(x, y) && proche.el && proche.el.cle === el.cle) return { x, y, k: el.cle, gid: el.gid };
    }
    return null;
  });
  ok(Boolean(point), `[X1] ${label} : une carte a toucher a 6 px`);
  if (!point) return;
  await page.evaluate(toucherAuPoint, point);
  await repos(page, 350);
  const a = await page.evaluate(() => { const p = document.getElementById('globalPlanningGridWrap')._ghP; return p ? p.k : null; });
  ok(a === point.k, `[X1] ${label} : un toucher a 6 px hors d une carte l ouvre`, { a, attendu: point.k });
  const premier = await page.evaluate(() => ({ panneau: Boolean(document.querySelector('#globalPlanningBox .gh-panneau:not([hidden]) .gh-p__prog')), fiche: Boolean(state.selectedRes) }));
  ok(premier.panneau && !premier.fiche, `[K][H] ${label} : au doigt, le premier toucher montre le programme du groupe, pas sa fiche`, premier);
  // [K][H] le second toucher sur la carte ouvre sa fiche.
  await page.locator(`#globalPlanningBox [data-gh-k="${point.k}"]`).tap();
  await repos(page, 400);
  const fiche = await page.evaluate(() => ({ fiche: state.selectedRes ? String(state.selectedRes.id) : null, panneau: Boolean(document.querySelector('#globalPlanningBox .gh-panneau:not([hidden])')) }));
  ok(fiche.fiche === point.gid && !fiche.panneau, `[K][H] ${label} : au doigt, le premier toucher montre le programme, le second ouvre la fiche`, fiche);
  await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
  await repos(page, 250);
  // Un toucher a 12 px de toute carte, dans une piste libre : la reservation.
  const vide = await page.evaluate(() => {
    const wrap = document.getElementById('globalPlanningGridWrap');
    const plan = wrap._ghPlan;
    const ci = plan.colonnes.findIndex((c) => c.nature === 'bowling');
    const pile = document.querySelector(`#globalPlanningBox .gh-pile[data-gh-col="${ci}"]`);
    const rp = pile.getBoundingClientRect();
    const Mo = window.PinlanePlanningMoteur;
    for (let t = plan.axe.debut; t < plan.axe.fin; t += 0.5) {
      for (let p = 1; p <= plan.colonnes[ci].N; p += 1) {
        const lx = plan.colonnes[ci].pistes[p - 1].x + plan.colonnes[ci].pistes[p - 1].w / 2, ly = Mo.ghY(plan.axe, t + 0.25);
        const proche = Mo.ghCarteProche(plan, ci, lx, ly, 8);
        if (proche.d >= 12 && Mo.ghCaseLibre(plan, ci, lx, ly)) return { x: rp.left + lx, y: rp.top + ly, t, p };
      }
    }
    return null;
  });
  if (vide) {
    await page.evaluate(() => { window.__appels = []; window.__qfc = window.quickFromCell; window.quickFromCell = function (p, h) { window.__appels.push([p, h]); }; });
    await page.evaluate(toucherAuPoint, vide);
    await repos(page, 300);
    const appels = await page.evaluate(() => { window.quickFromCell = window.__qfc; return window.__appels; });
    ok(appels.length === 1 && appels[0][0] === vide.p && appels[0][1] === vide.t, `[X1] ${label} : un toucher a 12 px de toute carte, dans une piste libre, reserve`, { appels, vide });
  } else ok(false, `[X1] ${label} : une case libre a 12 px de toute carte`);
});

// [X3] LE MOUVEMENT REDUIT
cible('X3', 'mouvement reduit', (s) => s.mouvementReduit, async (page, s, label) => {
  const c = page.locator('#globalPlanningBox .gh-c:not(.gh-seg)').first();
  await c.hover();
  await c.click();
  await page.waitForTimeout(80);
  const r = await page.evaluate(() => ({
    animations: document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#globalPlanningBox')).length,
    transitions: ['.gh-c', '.gh-seg', '.gh-partie', '.gh-entete'].map((sel) => { const x = document.querySelector('#globalPlanningBox ' + sel); return x ? getComputedStyle(x).transitionDuration : '0s'; }),
  }));
  ok(r.animations === 0 && r.transitions.every((d) => d.split(',').every((x) => parseFloat(x) <= 0.001)), `[X3] ${label} : apres survol et clic, aucune animation, aucune transition`, r);
});

// [V1] LE CONTRASTE, AU PIXEL
cible('V1', 'contraste', (s) => estS('pic', 'ordinateur')(s) || estS('pic', 'ordinateur', 'normal', 'light')(s), async (page, s, label) => {
  await page.mouse.move(2, 2);
  await repos(page, 200);
  const zones = await page.evaluate(() => {
    const out = { noms: {}, num: null, barres: [] };
    const surface = document.querySelector('#globalPlanningBox .gh-grille');
    Array.from(document.querySelectorAll('#globalPlanningBox .gh-c:not(.gh-seg):not(.is-presence)')).forEach((c) => {
      const etat = (c.className.match(/is-(fini|encours|avenir)\b/) || [])[1];
      const statut = (c.className.match(/t-(conf|arr|paid)/) || [])[1];
      const n = c.querySelector('.gh-c__nom');
      if (!etat || !statut || !n || c.classList.contains('is-libre') || c.classList.contains('is-retard')) return;
      const k = etat === 'avenir' ? statut : etat;
      if (out.noms[k]) return;
      const r = n.getBoundingClientRect();
      const rc = c.getBoundingClientRect();
      out.noms[k] = { top: r.top, bottom: r.bottom, left: Math.max(r.left, rc.left + 4), right: Math.min(r.right + 6, rc.right - 2) };
      if (out.barres.length < 4 && etat !== 'fini') out.barres.push({ x: rc.left + 1, y: (rc.top + rc.bottom) / 2, fond: { x: rc.left - 2, y: (rc.top + rc.bottom) / 2 } });
    });
    const libre = Array.from(document.querySelectorAll('#globalPlanningBox .gh-num')).find((x) => !x.classList.contains('is-occupee') && !x.classList.contains('is-maint'));
    if (libre) { const r = libre.getBoundingClientRect(); out.num = { top: r.top, bottom: r.bottom, left: r.left + r.width / 2 - 8, right: r.left + r.width / 2 + 8 }; }
    const seg = document.querySelector('#globalPlanningBox .gh-seg:not(.is-fini)');
    if (seg) { const r = seg.getBoundingClientRect(); out.barres.push({ x: r.left + 1, y: (r.top + r.bottom) / 2, fond: { x: r.left - 1, y: r.top - 4 } }); }
    // (le fond : --surface, resolu ici ; un pixel voisin peut tomber sur un filet de piste)
    const sonde = document.createElement('i');
    sonde.style.cssText = 'position:absolute;width:0;height:0;color:var(--surface)';
    surface.appendChild(sonde);
    out.surface = (getComputedStyle(sonde).color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    sonde.remove();
    return out;
  });
  const img = decoderPng(await page.screenshot());
  const noms = Object.fromEntries(Object.entries(zones.noms).map(([k, r]) => [k, contrasteTexte(img, r)]));
  const manquants = ['conf', 'arr', 'paid', 'encours', 'fini'].filter((k) => !(k in noms));
  ok(manquants.length === 0 && Object.values(noms).every((c) => c >= 4.5), `[V1] ${label} : le nom contre sa carte a 4,5:1 au moins (confirmé, arrivé, payé, en cours, fini)`, { noms, manquants });
  const num = zones.num ? contrasteTexte(img, zones.num) : 0;
  ok(num >= 4.5, `[V1] ${label} : les numeros de pistes libres a 4,5:1 au moins`, num);
  const barres = zones.barres.map((b) => contraste(img.pixel(b.x, b.y), zones.surface));
  ok(barres.length >= 2 && barres.every((c) => c >= 3), `[V1] ${label} : les barres de statut et les segments a 3:1 au moins contre le fond`, barres);
});

// LES SCENARIOS A PART : la nuit, l heure, les variantes, la minute.
const EXTRAS = [
  { fixture: 'pic', appareil: 'ordinateur', mode: 'normal', theme: 'dark', heure: '10:00' },
  { fixture: 'pic', appareil: 'ordinateur', mode: 'normal', theme: 'dark', heure: '22:00' },
  { fixture: 'pic', appareil: 'ordinateur', mode: 'normal', theme: 'dark', heure: '34:00' },
  { fixture: 'pire', appareil: 'ordinateur', mode: 'normal', theme: 'dark', heure: '24:20' },
  { fixture: 'pic', appareil: 'ordinateur', mode: 'normal', theme: 'dark', variante: ['maintenance5'] },
  { fixture: 'normal', appareil: 'ordinateur', mode: 'normal', theme: 'dark', variante: ['enligne6'] },
  { fixture: 'pic', appareil: 'ordinateur', mode: 'normal', theme: 'dark', variante: ['laser34'] },
  { fixture: 'calme', appareil: 'grand', mode: 'normal', theme: 'dark', variante: ['gembloux'] },
  { fixture: 'calme', appareil: 'ordinateur', mode: 'normal', theme: 'dark', variante: ['pistes6'] },
  { fixture: 'normal', appareil: 'ordinateur', mode: 'normal', theme: 'dark', variante: ['eparses'] },
  { fixture: 'normal', appareil: 'ordinateur', mode: 'normal', theme: 'dark', variante: ['vagues'] },
  { fixture: 'pic', appareil: 'ordinateur', mode: 'normal', theme: 'dark', mouvementReduit: true },
];
// [Z1] LA NUIT ; [T3] minuit
cible('Z1', 'la nuit', (s) => s.heure === '24:20', async (page, s, label) => {
  const r = await page.evaluate(() => {
    const wrap = document.getElementById('globalPlanningGridWrap');
    const plan = wrap._ghPlan, etats = wrap._ghEtats || plan.etats;
    const pileH = document.querySelector('#globalPlanningBox .gh-pile--h');
    const rh = pileH.getBoundingClientRect();
    const barre = document.querySelector('#globalPlanningBox .gh-maintenant.is-vu');
    const rb = barre && barre.getBoundingClientRect();
    const Mo = window.PinlanePlanningMoteur;
    const finies = plan.elements.filter((el) => (el.k === 'carte' || el.k === 'seg' || el.k === 'presence') && el.fin <= 24 + 20 / 60 + 1e-6 && etats.elements[el.cle] === 'encours').map((el) => el.cle);
    const laser = (document.querySelector('#globalPlanningBox .gh-entete[data-gh-cle="laser"] .gh-entete__sous') || {}).textContent || '';
    const p0 = plan.elements.find((el) => el.k === 'partie' && Math.abs(el.debut - 24) < 1e-6);
    const segs0 = p0 ? plan.elements.filter((el) => el.k === 'seg' && el.partie === p0.cle).map((el) => etats.elements[el.cle]) : [];
    const libelles = Array.from(pileH.querySelectorAll('.gh-h')).filter((h) => getComputedStyle(h).display !== 'none').map((h) => h.textContent);
    const minuit = document.querySelector('#globalPlanningBox .gh-l.is-minuit');
    return { fin: plan.axe.fin, barre: rb ? (rb.top + rb.bottom) / 2 - rh.top : null, attendu: Mo.ghY(plan.axe, 24 + 20 / 60), pastille: (document.querySelector('#globalPlanningBox .gh-maintenant-h.is-vu') || {}).textContent, finies, laser, segs0, libelles: libelles.slice(-6), minuit: minuit ? minuit.getBoundingClientRect().height : 0, hh: plan.axe.hh };
  });
  ok(r.fin === 25 && r.barre != null && Math.abs(r.barre - r.attendu) <= 1 && r.pastille === '00:20', `[Z1] ${label} : la grille va jusqu a 01:00, la barre a 00:20`, r);
  ok(r.finies.length === 0, `[Z1] ${label} : aucune carte finie avant 00:20 n est en cours`, r.finies.slice(0, 4));
  // (le groupe de minuit n est pas arrive : son segment est en retard, la partie, elle, se joue)
  ok(r.segs0.length > 0 && r.segs0.every((e) => e === 'encours' || e === 'retard') && r.laser === '00:00 · 30/30', `[Z1] ${label} : la partie de 00:00 est en cours, la tete laser dit « 00:00 · 30/30 »`, { segs: r.segs0, laser: r.laser });
  ok(r.libelles.includes('00:00') && r.libelles.includes('01:00') && (r.hh < 32 || r.libelles.includes('00:30')) && r.minuit === 2, `[T3] ${label} : 00:00, 01:00 (et 00:30), un filet de minuit de 2 px`, r);
});

// [H1] LA MINUTE QUI PASSE (deux scenarios a part)
async function minute(browser, { fixture, heure, label: nom, arrivee, fin }) {
  const s = { fixture, appareil: 'ordinateur', mode: 'normal', theme: 'dark', heure };
  const label = ici(s) + ' ' + nom;
  const { ctx, page } = await monter(browser, s);
  try {
    if (!(await prerequis(page, s, label))) return;
    const avant = await page.evaluate(() => {
      const g = document.querySelector('#globalPlanningBox .gh-grille');
      window.__mutations = [];
      window.__obs = new MutationObserver((l) => l.forEach((m) => window.__mutations.push({ type: m.type, attr: m.attributeName, cible: m.target.nodeType === 1 ? m.target.className || m.target.tagName : 'texte:' + (m.target.parentNode && m.target.parentNode.className), noeuds: Array.from(m.addedNodes).concat(Array.from(m.removedNodes)).map((n) => (n.nodeType === 1 ? n.className || n.tagName : '#texte')).join(',') })));
      window.__obs.observe(g, { subtree: true, attributes: true, childList: true, characterData: true });
      window.__plans = window.__ghPlanStats.plans;
      window.__ecritures = window.__ghPlanStats.ecritures;
      const plan = document.getElementById('globalPlanningGridWrap')._ghPlan;
      return { geo: JSON.stringify(plan.elements.map((el) => [el.cle, el.x, el.y, el.w, el.h])), arrivees: document.querySelectorAll('#globalPlanningBox [data-gh-arrivee]').length, encours: Array.from(document.querySelectorAll('#globalPlanningBox [data-gh-k].is-encours')).map((n) => n.getAttribute('data-gh-k')) };
    });
    const [h, m] = heure.split(':').map(Number);
    await page.clock.setFixedTime(FX.instant(FX.lireFixture(fixture).staffState.date, `${h + Math.floor((m + 1) / 60)}:${String((m + 1) % 60).padStart(2, '0')}`));
    await page.evaluate(() => tickHorlogeStaff());
    await repos(page, 200);
    const apres = await page.evaluate(() => {
      window.__obs.disconnect();
      const plan = document.getElementById('globalPlanningGridWrap')._ghPlan;
      const permis = (x) => {
        if (x.type === 'attributes' && x.attr === 'class') return true;
        if (x.type === 'attributes' && (x.attr === 'aria-label' || x.attr === 'title') ) return true;
        if (x.type === 'attributes' && x.attr === 'style' && /gh-grille/.test(x.cible)) return true;
        if ((x.type === 'characterData' || x.type === 'childList') && /gh-min|gh-maintenant-h|gh-entete__sous|texte:gh-min|texte:gh-maintenant-h|texte:gh-entete__sous/.test(x.cible)) return true;
        // (le fantome « + 16:30 » de la souris n est pas la minute)
        if (x.type === 'childList' && /^gh-ajout$/.test(x.noeuds)) return true;
        if (x.type === 'attributes' && x.attr === 'hidden' && /gh-entete__sous/.test(x.cible)) return true;
        return false;
      };
      const hors = window.__mutations.filter((x) => !permis(x));
      return { finies: Array.from(document.querySelectorAll('#globalPlanningBox [data-gh-k].is-fini')).map((n) => n.getAttribute('data-gh-k')), hors: hors.slice(0, 6), n: window.__mutations.length, plans: window.__ghPlanStats.plans - window.__plans, ecritures: window.__ghPlanStats.ecritures - window.__ecritures, geo: JSON.stringify(plan.elements.map((el) => [el.cle, el.x, el.y, el.w, el.h])), arrivees: document.querySelectorAll('#globalPlanningBox [data-gh-arrivee]').length, html: document.querySelector('#globalPlanningBox .gh-grille').outerHTML };
    });
    // La grille apres la minute = celle d un rendu frais a la meme heure.
    const frais = await page.evaluate(() => {
      const wrap = document.getElementById('globalPlanningGridWrap');
      const focus = null;
      window.__ghReinitialiser(wrap);
      window.renderGlobalPlanning(wrap);
      return document.querySelector('#globalPlanningBox .gh-grille').outerHTML + (focus || '');
    });
    if (fin) ok(avant.encours.some((k) => apres.finies.includes(k)), `[prerequis] ${label} : une carte en cours a 16:44 est finie a 16:45`);
    if (!arrivee) {
      ok(apres.hors.length === 0 && apres.ecritures === 0 && apres.n > 0, `[H1] ${label} : la minute ne change que les classes d etat, les minutes, la barre, la pastille, le voile, --gh-now-px et les compteurs`, apres.hors);
      ok(apres.html === frais, `[H1] ${label} : la grille apres la minute est celle d un rendu frais a la meme heure`, apres.html === frais ? '' : premiereDifference(apres.html, frais));
    } else {
      ok(apres.arrivees > avant.arrivees && apres.plans === 1 && apres.geo === avant.geo, `[H1] ${label} : la minute qui fait entrer des cartes d arrivee : un seul nouveau plan, les memes rectangles`, { avant: avant.arrivees, apres: apres.arrivees, plans: apres.plans });
    }
  } finally { await ctx.close(); }
}
function premiereDifference(a, b) { let i = 0; while (i < a.length && a[i] === b[i]) i += 1; return `${a.slice(Math.max(0, i - 80), i + 60)}  <>  ${b.slice(Math.max(0, i - 80), i + 60)}`; }
// La minute ou une carte d arrivee entre : la premiere seance d un groupe
// attendu, l horloge 30 min et une minute avant.
function heureArrivee() {
  const e = ENTREES.pic;
  const attendus = e.groupes.filter((g) => g.statut === 'conf' && !g.absent && g.etat === 'upcoming' && !g.retard);
  const premieres = attendus.map((g) => Math.min(...e.seances.filter((s) => s.groupe === g.id).map((s) => s.debut))).filter((t) => t >= 16).sort((a, b) => a - b);
  const t = premieres[0] - 0.5 - 1 / 60;
  const m = Math.round(t * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const PIC = { fixture: 'pic', appareil: 'ordinateur', mode: 'normal', theme: 'dark' };
const PIRE = { fixture: 'pire', appareil: 'ordinateur', mode: 'normal', theme: 'dark' };
const MUTATIONS = [
  { nom: 'heure-plus-2', lettre: 'T1', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '    return Math.max(6, Math.min(HEURE_MAX, hh));\n  }', vers: '    return Math.max(6, Math.min(HEURE_MAX, hh)) + 2;\n  }' }] },
  { nom: 'bowling-plus-40', lettre: 'T2', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '      col.w = rep.largeurs[i];\n', vers: "      col.w = rep.largeurs[i] + (col.nature === 'bowling' ? 40 : 0);\n" }] },
  { nom: 'sans-dernier-libelle', lettre: 'T3', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '    for (var t = plage.debut; t <= plage.fin + 1e-6; t += 0.5) {', vers: '    for (var t = plage.debut; t < plage.fin - 1e-6; t += 0.5) {' }] },
  { nom: 'heure-etiree', lettre: 'T4', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '  function ghY(axe, t) { return axe.origine + Math.round((t - axe.debut) * axe.hh); }', vers: '  function ghY(axe, t) { return axe.origine + Math.round((t - axe.debut) * axe.hh) + (t - axe.debut > 3 ? 10 : 0); }' }] },
  { nom: 'carte-decalee', lettre: 'C1', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '          el.x = ga + 1; el.w = Math.max(1, gb - ga - 2); el.bw = gb - ga;\n        });\n      } else {', vers: '          el.x = ga + 1 - (el.a > 1 ? 3 : 0); el.w = Math.max(1, gb - ga - 2); el.bw = gb - ga;\n        });\n      } else {' }] },
  { nom: 'texte-7px', lettre: 'C2', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '        el.tw = el.bw - CHROME_CARTE;\n        var niveauMin', vers: '        el.tw = el.bw - 7;\n        var niveauMin' }] },
  { nom: 'ellipse', lettre: 'N1', scenarios: [PIC], editions: [{ fichier: PGC, de: '.gh-c__nom { font-weight: 650; }', vers: '.gh-c__nom { font-weight: 650; text-overflow: ellipsis; overflow: hidden; }' }] },
  { nom: 'nom-court-d-abord', lettre: 'N2', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: "    var cfg = { niveau: 1, heure: aHeure, nom: 0, tags: 'long',", vers: "    var cfg = { niveau: 1, heure: aHeure, nom: Math.max(0, nF - 1), tags: 'long'," }] },
  { nom: 'sans-unicite', lettre: 'N3', scenarios: [PIRE], editions: [{ fichier: MOTEUR, de: '    ghUnicite(echelles, largeur).forEach(function (e) { parId.set(e.id, e); });', vers: '    echelles.forEach(function (e) { e.distinctive = 0; parId.set(e.id, e); });' }] },
  { nom: 'parts-egales', lettre: 'N4', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '    // Les pistes egales ; puis l arrondi', vers: '    alloc = alloc.map(function () { return Wd / Math.max(1, n); });\n    // Les pistes egales ; puis l arrondi' }] },
  { nom: 'parts-egales-largeurs', lettre: 'W1', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '    // Les pistes egales ; puis l arrondi', vers: '    alloc = alloc.map(function () { return Wd / Math.max(1, n); });\n    // Les pistes egales ; puis l arrondi' }] },
  { nom: 'sans-expansion', lettre: 'W2', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '          var span = el.span || 1;\n', vers: '          var span = 1;\n' }] },
  { nom: 'besoins-filtres', lettre: 'W3', scenarios: [PIC], editions: [{ fichier: PG, de: '    var seances = ghSeances(m);\n    var lu = ghLire(wrap);', vers: '    var seances = ghSeances(m).filter(function (s) { return !m.visibles || m.visibles.has(s.g.id); });\n    var lu = ghLire(wrap);' }] },
  { nom: 'poids-en-cours', lettre: 'W4', scenarios: [PIC, { ...PIC, heure: '10:00' }], editions: [{ fichier: MOTEUR, de: '    var poids = poidsColonnes(colonnes, besoins);', vers: '    var poids = poidsColonnes(colonnes, besoins).map(function (x, i) { return x + (colonnes[i].seances.some(function (s) { return entree.maintenant != null && s.debut <= entree.maintenant && s.fin > entree.maintenant; }) ? 2 : 0); });' }] },
  { nom: 'bowling-en-agenda', lettre: 'B1', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: "      if (col.nature === 'bowling') construireBowling(col, ressources.pistes || {}, vertical, groupes);", vers: "      if (false) construireBowling(col, ressources.pistes || {}, vertical, groupes);" }] },
  { nom: 'sans-laneStatuses', lettre: 'B2', scenarios: [{ ...PIC, variante: ['maintenance5'] }], editions: [{ fichier: PG, de: "        maintenance: Object.keys(state.laneStatuses || {}).filter(function (k) { return state.laneStatuses[k] === 'maintenance'; }).map(Number),", vers: '        maintenance: [],' }] },
  { nom: 'piste-zero', lettre: 'B3', scenarios: [PIC], editions: [{ fichier: PG, de: '    else quickFromCell(c.piste, c.t);', vers: '    else quickFromCell(0, c.t);' }] },
  { nom: 'sans-blocages', lettre: 'B4', scenarios: [{ fixture: 'normal', appareil: 'ordinateur', mode: 'normal', theme: 'dark', variante: ['enligne6'] }], editions: [{ fichier: MOTEUR, de: '    (R.blocages || []).forEach(function (b, n) {', vers: '    [].forEach(function (b, n) {' }] },
  { nom: 'partie-meme-fin', lettre: 'L1', scenarios: [{ fixture: 'normal', appareil: 'ordinateur', mode: 'normal', theme: 'dark', variante: ['vagues'] }], editions: [{ fichier: MOTEUR, de: '      if (p && e.debut <= p.debut + ECART_PARTIE + 1e-6) p.entrees.push(e);', vers: '      if (p && Math.abs(e.debut - p.debut) < 1e-9 && Math.abs(e.fin - p.entrees[0].fin) < 1e-9) p.entrees.push(e);' }] },
  { nom: 'barre-proportionnelle', lettre: 'L2', scenarios: [{ fixture: 'pic', appareil: 'grand', mode: 'normal', theme: 'dark' }], editions: [{ fichier: MOTEUR, de: '    var w = segs.map(function (s) { return connu ? Math.max(s.ess, s.joueurs / C * Bu) : s.ess; });', vers: '    var w = segs.map(function (s) { return connu ? s.joueurs / C * Bu : s.ess; });' }] },
  { nom: 'nom-fige', lettre: 'P1', scenarios: [{ fixture: 'normal', appareil: 'ordinateur', mode: 'normal', theme: 'dark' }], editions: [{ fichier: PGC, de: '.gh-c.peut-suivre.is-encours > .gh-c__t, .gh-c.peut-suivre.is-encours > .gh-pr__n { transform: translateY(clamp(0px, calc(var(--gh-now-px) - var(--gh-top) + 2px), calc(var(--gh-ht) - var(--gh-bloc)))); }', vers: '' }] },
  { nom: 'couleur-par-activite', lettre: 'S1', scenarios: [PIC], editions: [{ fichier: PGC, de: '.gh-c.is-libre { border-style: dashed;', vers: '.gh-pile[data-gh-cle="minigolf"] .gh-c { --bk-barre: #8a2be2; }\n.gh-c.is-libre { border-style: dashed;' }] },
  { nom: 'porteuse-la-plus-large', lettre: 'R1', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: "      if (g.retard && maintenant != null) choix = c.filter(function (el) { return etats[el.cle] === 'retard'; }).sort(tot)[0] || null;\n      if (!choix && attendu(g)) choix = c.slice().sort(tot)[0];", vers: '      choix = c.slice().sort(large)[0];' }] },
  // (la carte d arrivee lache son heure au niveau 3, comme les autres)
  { nom: 'arrivee-sans-heure', lettre: 'A1', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '    var arr = Boolean(c.arrivee);', vers: '    var arr = false;' }] },
  { nom: 'redessin-a-la-minute', lettre: 'H1', minute: true, editions: [{ fichier: PG, de: '      if (etats.cle === plan.etatsCle) {', vers: '      if (false) {' }, { fichier: PG, de: '    if (racine && wrap._ghPlan && plan.cle === wrap._ghPlan.cle) {', vers: '    if (false) {' }] },
  { nom: 'tic-garde-en-cours', lettre: 'H1', minute: true, editions: [{ fichier: PG, de: "      poser(n, 'class', MOTEUR.ghClasses(el, etat, t));\n      poser(n, 'aria-label',", vers: "      if (!/is-encours/.test(n.getAttribute('class'))) poser(n, 'class', MOTEUR.ghClasses(el, etat, t));\n      poser(n, 'aria-label'," }] },
  { nom: 'toute-la-visite', lettre: 'D1', scenarios: [PIRE], editions: [{ fichier: PG, de: "      var quand = (s.e.libre && !s.e.journee ? '≈ ' : '') + gpHeure(s.start);", vers: "      var quand = s.e.journee ? 'toute la visite' : (s.e.libre ? '≈ ' : '') + gpHeure(s.start);" }] },
  { nom: 'lecture-par-carte', lettre: 'D2', scenarios: [PIRE], editions: [{ fichier: PG, de: '    ghIndexer(wrap);\n    if (wrap._ghP) ghPanneauRemplir(wrap); else ghPanneauVider(wrap);', vers: '    ghIndexer(wrap);\n    wrap._ghNoeuds.forEach(function (n) { void n.scrollWidth; });\n    if (wrap._ghP) ghPanneauRemplir(wrap); else ghPanneauVider(wrap);' }] },
  { nom: 'sans-focus', lettre: 'D3', scenarios: [PIC], editions: [{ fichier: PG, de: '    if (focus && wrap._ghNoeuds.has(focus)) wrap._ghNoeuds.get(focus).focus({ preventScroll: true });', vers: '' }] },
  { nom: 'ferme-ignore', lettre: 'J1', scenarios: [{ fixture: 'ferme', appareil: 'ordinateur', mode: 'normal', theme: 'dark' }], editions: [{ fichier: PG, de: '      fenetre: { open: plage.ouvre, close: plage.ferme, closed: Boolean(m.fenetre && m.fenetre.closed) },', vers: '      fenetre: { open: plage.ouvre, close: plage.ferme, closed: false },' }] },
  { nom: 'nuit-sans-24h', lettre: 'Z1', scenarios: [{ ...PIRE, heure: '24:20' }], editions: [{ fichier: PG, de: '    var maintenant = jour === auj ? currentTimeDecimal() : nuit ? 24 + currentTimeDecimal() : null;', vers: '    var maintenant = jour === auj ? currentTimeDecimal() : nuit ? currentTimeDecimal() : null;' }] },
  { nom: 'titre-brut', lettre: 'I1', scenarios: [PIRE], editions: [{ fichier: PG, de: "        c = { cle: 'a-' + id, titre: gpNomActivite(id), activites: [id], groupes: 0, nature: 'agenda', inconnue: true };", vers: "        c = { cle: 'a-' + id, titre: id, activites: [id], groupes: 0, nature: 'agenda', inconnue: true };" }] },
  { nom: 'nom-pale', lettre: 'V1', scenarios: [PIC], editions: [{ fichier: PGC, de: '.gh-c__nom { font-weight: 650; }', vers: '.gh-c__nom { font-weight: 650; color: var(--faint); }' }] },
  { nom: 'degrade', lettre: 'G1', scenarios: [PIC], editions: [{ fichier: PGC, de: '.gh-c.is-libre { border-style: dashed;', vers: '.gh .gh-c.is-libre { background-image: repeating-linear-gradient(135deg, transparent 0 6px, rgba(0,0,0,.06) 6px 12px) !important; }\n.gh-c.is-libre { border-style: dashed;' }] },
  { nom: 'tolerance-zero', lettre: 'X1', scenarios: [{ fixture: 'pic', appareil: 'tablette', mode: 'normal', theme: 'dark' }], editions: [{ fichier: MOTEUR, de: '  var TOLERANCE_TOUCHER = 8;', vers: '  var TOLERANCE_TOUCHER = 0;' }] },
  { nom: 'segment-sans-aria', lettre: 'X2', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: '  function ghAria(el, etat, etats) {', vers: "  function ghAria(el, etat, etats) {\n    if (el.k === 'seg') return '';" }] },
  { nom: 'transition-200', lettre: 'X3', scenarios: [{ ...PIC, mouvementReduit: true }], editions: [{ fichier: PGC, de: '.gh-c.is-libre { border-style: dashed;', vers: '.gh .gh-c { transition: opacity 200ms !important; }\n.gh-c.is-libre { border-style: dashed;' }] },
  { nom: 'jamais-agrandir', lettre: 'X4', scenarios: [{ fixture: 'pic', appareil: 'tablette', mode: 'normal', theme: 'dark' }], editions: [{ fichier: PG, de: "    boite.classList.toggle('gp-a-agrandir', Boolean(plan.agrandir));", vers: "    boite.classList.toggle('gp-a-agrandir', false);" }] },
  // LES COMPORTEMENTS GARDES, recables.
  { nom: 'rendu-donnees', lettre: 'K][F', scenarios: [PIC], editions: [{ fichier: AM, de: '  renderLaserPlanning();\n  renderGlobalPlanningSurface();\n  renderTable();\n}\n\nfunction applyOptimisticReservation(', vers: '  renderLaserPlanning();\n  renderTable();\n}\n\nfunction applyOptimisticReservation(' }] },
  { nom: 'recherche-sans-effet', lettre: 'K][G', scenarios: [PIC], editions: [{ fichier: MOTEUR, de: "    if (t.recherche && el.cherche.indexOf(t.recherche) < 0) c += ' is-terne';", vers: '' }] },
  { nom: 'toucher-ouvre-la-fiche', lettre: 'K][H', scenarios: [{ fixture: 'pic', appareil: 'tablette', mode: 'normal', theme: 'dark' }], editions: [{ fichier: PG, de: '      if (p && p.k === c.getAttribute(\'data-gh-k\')) {', vers: '      if (true) {' }] },
  { nom: 'plein-ecran-deborde', lettre: 'K][I', scenarios: [{ ...PIC, mode: 'plein' }], editions: [{ fichier: PG, de: '    var bas = lu.plein ? GH.basPlein : GH.bas + 1;', vers: '    var bas = lu.plein ? -60 : GH.bas + 1;' }] },
  { nom: 'heures-pas-collees', lettre: 'K][M', scenarios: [{ fixture: 'pic', appareil: 'telephone', mode: 'normal', theme: 'dark' }], editions: [{ fichier: PGC, de: '.gh-pile--h { position: sticky; left: 0; z-index: 6;', vers: '.gh-pile--h { position: relative; left: 0; z-index: 6;' }, { fichier: PGC, de: '  position: sticky; top: 0; z-index: 7; box-sizing: border-box; height: 44px;', vers: '  position: relative; top: 0; z-index: 7; box-sizing: border-box; height: 44px;' }] },
  { nom: 'heures-hors-du-centre', lettre: 'K][N', scenarios: [{ fixture: 'vide', appareil: 'ordinateur', mode: 'normal', theme: 'dark' }], editions: [{ fichier: PG, de: "      fenetre: typeof getPlanningWindow === 'function' ? getPlanningWindow(jour) : { open: 10, close: 22, closed: false },", vers: '      fenetre: { open: 14, close: 20, closed: false },' }] },
  { nom: 'reserve-une-demi-heure-trop-tard', lettre: 'K][Q', scenarios: [PIC], editions: [{ fichier: PG, de: '    else quickFromCell(c.piste, c.t);', vers: '    else quickFromCell(c.piste, c.t + 0.5);' }] },
];
// (la contre-preuve [K][M] doit rougir [T2] ou [K][M] au telephone ; [K][Q]
// fait aussi rougir [B3], qui espionne le meme appel)

async function toutesLesMinutes(browser) {
  await minute(browser, { fixture: 'pic', heure: '15:10', label: 'une minute' });
  // (16:44 -> 16:45 : une carte finit, sans changer de carte porteuse)
  await minute(browser, { fixture: 'pic', heure: '16:44', label: 'une carte finit', fin: true });
  await minute(browser, { fixture: 'pic', heure: heureArrivee(), label: 'arrivee', arrivee: true });
}

async function main() {
  const serveur = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      const fixtures = liste(process.env.PG_FIXTURES) || FX.FIXTURES;
      const appareils = liste(process.env.PG_APPAREILS) || Object.keys(FX.APPAREILS);
      const modes = liste(process.env.PG_MODES) || ['normal', 'plein'];
      const themes = liste(process.env.PG_THEMES) || ['dark', 'light'];
      if (!process.env.PG_SEULEMENT_EXTRAS) for (const fixture of fixtures) for (const appareil of appareils) for (const mode of modes) for (const theme of themes) await scenario(browser, { fixture, appareil, mode, theme });
      if (!process.env.PG_SANS_EXTRAS) {
        for (const s of EXTRAS.filter((x) => fixtures.includes(x.fixture))) await scenario(browser, s);
        await toutesLesMinutes(browser);
      }
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.PG_MUTATIONS || liste(process.env.PG_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.PG_BAVARD;
        geometries.clear();
        try {
          if (m.minute) await toutesLesMinutes(browser);
          else for (const s of m.scenarios) await scenario(browser, s);
        } catch (e) { rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        const lettres = m.lettre === 'K][M' ? ['[K][M]', '[T2]'] : m.lettre === 'K][I' ? ['[K][I]'] : [`[${m.lettre}]`];
        ok(vus.some((l) => lettres.some((x) => l.startsWith(x))), `[K] mutation ${m.nom} : ${lettres.join(' ou ')} rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
      geometries.clear();
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nplanning-global-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nplanning-global-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

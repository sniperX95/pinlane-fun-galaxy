// LE PLANNING COMPLET : L HEURE SE TOUCHE ET SE GLISSE (2026-11-22).
//
// Ansar, ses notes du comptoir : « possibilité de drag and drop dans planning complet », puis
// « cliquer sur l'heure d'une activité genre pile l'heure et modifier l'heure dessus d'une traite
// avec une petite pop up avec une jolie animation [...] léger [...] et aussi pouvoir modifier
// facilement d'une traite dans la pop up quand on clique sur une resa en appuyant sur l'heure de
// l'activité et ça doit bien tout calculer hein pour voir possibilité et tout ».
//   [P1] la pastille d une heure se touche : une pop-up s ouvre contre elle (dessous ou dessus, a
//        quelques pixels, dans l ecran) et dit l activite, le groupe, l heure prevue ;
//   [P2] elle nait de la pastille : 200 a 300 ms, cubic-bezier(0.23, 1, 0.32, 1), une echelle partie
//        du centre de la pastille, rien d autre que transform, opacity, l arrondi et la teinte ; elle
//        rentre plus vite qu elle n est sortie ; en mouvement reduit, rien ne bouge ;
//   [P3] elle est legere : ni le tableau ni une ligne ne se reecrivent quand elle s ouvre, se remplit
//        et se ferme ; le jour charge (« pic »), la trace de rendu du navigateur le compte : elle ne
//        reprend en page qu une poignee d objets (un rendu du tableau en reprend des milliers), ne
//        recalcule le style que de ses elements, et l animation ne remet pas la page en page a chaque
//        image ;
//   [V1] elle ne propose que de vraies heures libres : celles que le controle du serveur laisse
//        passer (le verdict de « Modifier » : armes, pistes, chevauchement avec les autres activites
//        du groupe), les plus proches de l heure prevue ; jamais une heure complete ni une heure qui
//        chevauche le groupe ; une seule requete (les `essais` du calcul a blanc), rien d ecrit ;
//   [E1] un toucher sur une heure l enregistre tout de suite (un PATCH activityMove, rien d autre),
//        le tableau la montre, un toast le dit avec « Annuler » ; « Annuler » la remet, en base ;
//   [G1] a la souris, l heure se prend et se pose sur une demi-heure libre : l apercu suit, la cible
//        dit « libre », chaque demi-heure jugee a son trait, la surbrillance des lignes survolees
//        s efface le temps du geste, le depot enregistre et « Annuler » remet ;
//   [G2] posee sur une heure qui ne passe pas, la cible le dit (en rouge, la raison du serveur) et le
//        depot est refuse avec cette raison : rien ne part, rien ne s ecrit ;
//   [G3] au doigt (tablette) : un appui long leve l heure, le doigt la promene, le relacher la pose ;
//        un doigt qui part tout de suite ne leve rien et rien ne s ecrit ; une heure levee dans la bande
//        du bord ne fait pas defiler le tableau sous le doigt immobile ;
//   [G4] emmenee au bas du tableau, l heure le fait defiler ; Echap la repose et rien ne s ecrit ;
//   [L1] la ligne entiere d un groupe se prend : posee ou tout le groupe passe (le calcul a blanc de
//        « Modifier »), l heure du dossier change par son chemin, ses activites suivent, « Annuler »
//        la remet ; posee ou elle ne passe pas (pistes prises, heure deja passee), la raison se dit et
//        rien ne s ecrit ;
//   [F1] un groupe qui joue deja ne bouge pas : sa pop-up le dit sans proposer d heure, ni son heure
//        ni sa ligne ne se levent, rien ne s ecrit ; le serveur le redit (`gele`) ;
//   [F2] une console restee ouverte sur un etat perime envoie quand meme : le PATCH qui deplace une
//        activite (activityMove ou activityMoves) et le calcul a blanc de « Modifier » refusent ce
//        groupe avec la phrase de la pop-up, rien ne s ecrit ;
//   [W1] les deux groupes d une partie laser lancee ensemble (Ethan, 40 joueurs) bougent en bloc : un
//        toucher, un seul PATCH activityMoves, les deux a la nouvelle heure ; « Annuler » les remet
//        ensemble, d un seul PATCH ;
//   [W2] le serveur juge les groupes ensemble : le second coince, il refuse tout, dit lequel (`rang`)
//        et n ecrit rien ;
//   [W3] l arene se remplit entre la pop-up et le toucher : le second groupe coince au serveur, rien
//        ne bouge (ni l un ni l autre), et l avis dit lequel coince ;
//   [S1] le meme geste depuis la fiche : l heure du Programme ouvre la meme pop-up, contre elle, avec
//        les memes heures, et un toucher enregistre ;
//   [J1] aucune erreur JS.
// La console reelle (scripts/planning-v3-fixtures.js, journee « pic » de Fun Galaxy Libramont, samedi
// 16 janvier 2027 a 15:10) ; ses PATCH et ses calculs a blanc partent au VRAI handler
// api/staff-reservations.js, sur la base en memoire de scripts/reserver-banc.js (aucune base reelle,
// aucun reseau). L horloge du serveur est reglee sur celle de la page.
// --contre-preuves : chaque garde retiree (en memoire ; le disque n est jamais touche) fait rougir sa
// lettre ; chaque ancre existe une fois et une seule.
//   HG_SCENARIOS, HG_MUTATIONS : un sous-ensemble ; HG_BAVARD : les lignes des contre-preuves ;
//   HG_CAPTURES=<dossier> : les images (la pop-up, un glisser et sa cible, la pop-up de la fiche).
'use strict';
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout module de lib/.
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_HEURE_GLISSER_PORT || 7641);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MODULE = 'assets/pinlane-planning-global.js';
const FEUILLE = 'assets/pinlane-planning-global.css';
const FEUILLE_COMMUNE = 'assets/pinlane.css';
const CONSOLE = 'assets/app-main.js';
const API = 'api/staff-reservations.js';
const RETARD = 'lib/retard-arrivee.js';
const CAPTURES = process.env.HG_CAPTURES || '';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

const MANON = 1618; // laser 15:30 (1re partie) et 16:00 (2e), 8 joueurs : a 17:30, 19:00 et 19:30 les armes sont prises
const HENRARD = 1635; // bowling 16:00, piste 8, arrivee 16:00 : toute sa visite passe a 17:00
const NOEL = 1637; // bowling 16:30, piste 6 : a 16:00, le bowling est complet
const LINA = 1601; // arrivee, son laser a commence a 15:00 : elle joue
// (journee normale, variante « deux-groupes ») 40 joueurs : sa 1re partie de laser en deux groupes, 18 et
// 22, lances ensemble a 16:00 (1.1 et 1.2), sa 2e a 16:30 ; le basket (12) joue a 19:30
const ETHAN = 1588;

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}

let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel && !ed.serveur) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// LA BASE : la journee de la fixture, en colonnes (l inverse de mapReservation).
// ---------------------------------------------------------------------------
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
function ligneDepuis(r) {
  return {
    id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: r.name, phone: r.phone || '', email: r.email || '',
    date: r.date, start_time: r.startTime, duration: r.duration, total_duration: r.totalDuration ?? r.duration, lanes: (r.lanes || []).map(Number),
    pax: r.pax, status: r.status, base_price: r.basePrice, price: r.price, type: r.type, formule_id: r.formuleId || null, label: r.label,
    occasion: r.occasion || '', extras: r.extras || [], payment_method: r.paymentMethod || null, notes: r.notes || '',
    ops_plan: r.opsPlan || null, risk_level: r.riskLevel || '', risk_score: r.riskScore ?? null, validation_status: r.validationStatus || 'confirmed',
    activity_progress: r.activityProgress || {}, program: r.program || null, companions: r.companions || 0,
    created_at: new Date(r.createdAt), updated_at: new Date(r.updatedAt),
    acquisition: r.acquisition ?? null, client_key: r.clientKey || '', paid_at: r.paidAt ? new Date(r.paidAt) : null,
    amount_paid: r.amountPaid ?? null, discount_reason: r.discountReason || '', absent_at: r.absentAt ? new Date(r.absentAt) : null,
  };
}
const brut = (id) => JSON.stringify(B.base.reservations.get(Number(id)) || null);
function enBase(id) {
  const row = B.base.reservations.get(Number(id));
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {});
  const blocs = plan.resourceBlocks || [];
  const laser = {};
  blocs.filter((b) => b && b.resourceType === 'laser_arena').forEach((b) => { laser[`${b.countIndex || 1}.${b.groupWaveIndex || 1}`] = b.startTime; });
  return {
    debut: String(row.start_time).slice(0, 5),
    pistes: (row.lanes || []).map(Number).join(','),
    laser,
    bowling: blocs.filter((b) => b && b.resourceType === 'bowling_lane').map((b) => `${b.startTime}[${(b.lanes || []).join(',')}]`).join(' '),
    prix: Number(row.price),
    version: new Date(row.updated_at).toISOString(),
  };
}

// L HEURE DU SERVEUR EST CELLE DE LA PAGE : 15:10 a Libramont (UTC+1 en janvier). Le montage recharge
// les modules de lib/ : l horloge se regle apres lui.
function reglerHorloge(jour = JOUR) { require(path.join(ROOT, RETARD)).__horloge.instant = () => new Date(`${jour}T14:10:00Z`); }

async function monter(browser, { appareil = 'ordinateur', mouvementReduit = false, fixture = 'pic', variante = [] } = {}) {
  // (une autre journee ou une variante : la meme sur le serveur et dans la page, FX.varier)
  const journee = fixture === 'pic' && !variante.length ? FIXTURE.staffState : FX.varier(FX.lireFixture(fixture), FX.lireCentre(), variante).fixture.staffState;
  B.semer(journee.reservations.map(ligneDepuis));
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  reglerHorloge(journee.date);
  const patchs = [];
  const blancs = [];
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture, variante, appareil, theme: 'light', port: PORT, heure: '15:10', mouvementReduit,
    avantChargement: async (p) => {
      await p.exposeFunction('__fixtureServeur', async (corps) => { patchs.push(corps); return serveur.appeler('PATCH', '/api/staff-reservations', corps); });
      await p.exposeFunction('__fixtureBlanc', async (corps) => { blancs.push(corps); return serveur.appeler('POST', '/api/staff-reservations', corps); });
    },
  });
  return { ctx, page, erreurs, serveur, patchs, blancs };
}

// LES HEURES QUE LE SERVEUR LAISSE PASSER, demandees ici sans la console : chaque demi-heure du jour,
// un essai chacune (le meme controle que la pop-up, lu a part).
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutes = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
async function verdictsDuServeur(serveur, id, move) {
  const grille = [];
  for (let m = 10 * 60; m <= 23 * 60 + 30; m += 30) grille.push(hhmm(m));
  const rep = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', deplacement: { id, centerId: 'libramont', baseUpdatedAt: enBase(id).version, essais: grille.map((h) => [{ ...move, startTime: h }]) } });
  const v = new Map();
  ((rep.json && rep.json.essais) || []).forEach((e, i) => v.set(grille[i], e));
  return { v, json: rep.json };
}
// Ce que la pop-up doit montrer : les 12 plus proches de l heure prevue, apres 15:10, sans la sienne.
function heuresAttendues(v, prevue) {
  const libres = [...v.entries()].filter(([h, e]) => e.passe && minutes(h) >= 15 * 60 + 10 && h !== prevue).map(([h]) => h);
  return libres.sort((a, b) => Math.abs(minutes(a) - minutes(prevue)) - Math.abs(minutes(b) - minutes(prevue)) || minutes(a) - minutes(b)).slice(0, 12).sort((a, b) => minutes(a) - minutes(b));
}

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
const PASTILLE = (id, cle) => `#globalPlanningGridWrap tr[data-gf-id="${id}"] [data-gf-act="${cle}"]`;
function lirePop() {
  const p = document.getElementById('gfHeurePop');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return {
    r: { l: r.left, t: r.top, w: r.width, h: r.height, b: r.bottom, d: r.right },
    vw: document.documentElement.clientWidth, vh: window.innerHeight,
    texte: p.innerText.replace(/\s+/g, ' ').trim(),
    heures: Array.from(p.querySelectorAll('[data-gf-hp-choix]')).map((b) => b.childNodes[0].textContent.trim()),
    gele: ((p.querySelector('.gf-hp__gele') || {}).textContent || '').trim(),
    fiche: Boolean(p.querySelector('[data-gf-hp-fiche]')),
    rempli: p.classList.contains('is-rempli'),
  };
}
// La goutte, lue au moment ou elle nait : son animation, ses images clefs, son origine.
function lireGoutte() {
  const p = document.getElementById('gfHeurePop');
  if (!p) return null;
  const cs = getComputedStyle(p);
  const props = [];
  let depart = '';
  const fouiller = (regles) => {
    for (const x of regles) {
      if (x.type === CSSRule.KEYFRAMES_RULE && x.name === cs.animationName) {
        for (const k of x.cssRules) { for (let i = 0; i < k.style.length; i += 1) props.push(k.style[i]); if (k.keyText === '0%') depart = k.cssText; }
      } else if (x.cssRules) fouiller(x.cssRules);
    }
  };
  for (const f of document.styleSheets) { let regles = null; try { regles = f.cssRules; } catch (e) { regles = null; } if (regles) fouiller(regles); }
  return {
    nom: cs.animationName, duree: cs.animationDuration, courbe: cs.animationTimingFunction, classe: p.className,
    ox: parseFloat(p.style.getPropertyValue('--gf-hp-ox')) + parseFloat(p.style.left), oy: parseFloat(p.style.getPropertyValue('--gf-hp-oy')) + parseFloat(p.style.top),
    props: [...new Set(props)], depart,
  };
}
function lireToast() {
  const t = document.getElementById('toast');
  return { texte: t && !t.classList.contains('hidden') ? t.textContent.replace(/\s+/g, ' ').trim() : '', annuler: Boolean(t && !t.classList.contains('hidden') && t.querySelector('.toast-annuler')) };
}
function lireAvis() {
  const n = document.querySelector('.planning-move-notice');
  return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
}
async function capture(page, nom) {
  if (!CAPTURES || mutation || !nom) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}
// La ligne d un groupe en haut du tableau (60 px sous sa tete) : la suite de la journee se voit dessous.
async function ligneEnHaut(page, id) {
  await page.evaluate((i) => { const tr = document.querySelector(`#globalPlanningGridWrap tr[data-gf-id="${i}"]`); const d = tr.closest('.gf-defile'); d.scrollTop += tr.getBoundingClientRect().top - d.getBoundingClientRect().top - 60; }, id);
  await page.waitForTimeout(150);
}
async function demiHeureEnHaut(page, h) {
  await page.evaluate((x) => { const td = document.querySelector(`#globalPlanningGridWrap td.gf-bloc[data-gf-bloc="${x}"]`); const d = td.closest('.gf-defile'); const tete = d.querySelector('thead'); d.scrollTop += td.getBoundingClientRect().top - d.getBoundingClientRect().top - (tete ? tete.getBoundingClientRect().height : 0) - 4; }, h);
  await page.waitForTimeout(150);
}
async function centre(page, sel) {
  const b = await page.locator(sel).first().boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, b } : null;
}
// Le haut d une demi-heure du tableau, a l ecran, sous la colonne `x`.
async function demiHeure(page, h, x) {
  const r = await page.evaluate((v) => { const td = document.querySelector(`#globalPlanningGridWrap td.gf-bloc[data-gf-bloc="${v}"]`); if (!td) return null; const b = td.getBoundingClientRect(); return { haut: b.top, bas: b.bottom }; }, h);
  return r ? { x, y: r.haut + Math.min(22, (r.bas - r.haut) / 2), ...r } : null;
}
async function attendre(page, cond, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await cond()) return true; await page.waitForTimeout(60); }
  return false;
}
async function lirePendant(page) {
  await page.waitForFunction(() => { const c = document.querySelector('.gf-cible'); return Boolean(c) && !c.hidden && !c.classList.contains('is-calcul'); }, null, { timeout: 8000 }).catch(() => null);
  return page.evaluate(() => {
    const c = document.querySelector('.gf-cible');
    const a = document.querySelector('.gf-apercu');
    return {
      leve: Boolean(window.__gfHeure && window.__gfHeure.glisse()),
      ton: c && !c.hidden ? (/is-(\w+)/.exec(c.className) || [])[1] : '',
      cible: c && !c.hidden ? c.textContent.trim() : '',
      apercu: a ? a.textContent.trim() : '',
      reperes: { ok: document.querySelectorAll('.gf-repere.is-ok').length, non: document.querySelectorAll('.gf-repere.is-non').length },
      pris: document.querySelectorAll('#globalPlanningGridWrap .is-glisse').length,
      // (la surbrillance qui suit la ligne survolee, pinlane-mouvement.js : ses calques, et ceux qui se voient)
      surbrillance: (() => { const s = [...document.querySelectorAll('.pl-surbrillance')]; return { calques: s.length, vues: s.filter((el) => { const c = getComputedStyle(el); return c.visibility !== 'hidden' && c.display !== 'none' && Number(c.opacity) > 0.05; }).length }; })(),
    };
  });
}
async function glisserALaSouris(page, de, vers, nom = '') {
  await page.mouse.move(de.x, de.y);
  await page.mouse.down();
  await page.mouse.move(de.x + 3, de.y + 7, { steps: 2 });
  await page.mouse.move(vers.x, vers.y, { steps: 10 });
  const pendant = await lirePendant(page);
  await capture(page, nom);
  await page.mouse.up();
  await page.waitForTimeout(500);
  return pendant;
}
async function glisserAuDoigt(page, cdp, de, vers, nom = '') {
  const point = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  const defile = () => page.evaluate(() => document.querySelector('#globalPlanningGridWrap .gf-defile').scrollTop);
  const avant = await defile();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(de.x, de.y) });
  await page.waitForTimeout(520);
  // (ce que le tableau a defile sous le doigt immobile, l heure deja levee)
  const tenu = (await defile()) - avant;
  for (let i = 1; i <= 12; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(de.x + (vers.x - de.x) * i / 12, de.y + (vers.y - de.y) * i / 12) });
    await page.waitForTimeout(20);
  }
  const pendant = await lirePendant(page);
  pendant.tenu = tenu;
  await capture(page, nom);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  return pendant;
}

// ---------------------------------------------------------------------------
// [P1] [P2] [P3] [V1] [E1] : la pop-up d une heure, sur le laser de Manon (1re partie, 15:30).
// ---------------------------------------------------------------------------
async function scenarioPop(browser) {
  const { ctx, page, erreurs, serveur, patchs, blancs } = await monter(browser);
  try {
    const depart = brut(MANON);
    const attendues = verdictsDuServeur(serveur, MANON, { activityId: 'laser_game', unitKey: '1.1' });
    await ligneEnHaut(page, MANON);
    const sel = PASTILLE(MANON, 'laser_game:1.1');
    // (le premier geste de la page ouvre le son des nouvelles reservations : il se fait avant la mesure)
    await page.keyboard.press('Shift');
    // LA MESURE : ce que le navigateur recalcule, compte par lui-meme dans sa trace de rendu (les elements
    // que chaque recalcul de style touche, les objets que chaque mise en page reprend). Le tableau du jour
    // charge, rendu en entier, sert d etalon. Un compte, pas une duree : il ne depend ni de la machine ni de sa
    // charge (une duree bridee x4 allait d un a dix d un passage a l autre).
    const cdp = await ctx.newCDPSession(page);
    const tracer = async (geste) => {
      const evenements = [];
      const recevoir = (e) => { evenements.push(...e.value); };
      cdp.on('Tracing.dataCollected', recevoir);
      // (les deux categories de la chronologie, comme formulaire-fluide-check)
      await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] } });
      // (deux images et 100 ms au repos avant le geste)
      await page.evaluate(() => new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(fin, 100)))));
      await geste();
      const fini = new Promise((resolu) => cdp.once('Tracing.tracingComplete', resolu));
      await cdp.send('Tracing.end');
      await fini;
      cdp.off('Tracing.dataCollected', recevoir);
      const styles = evenements.filter((e) => e.name === 'UpdateLayoutTree' && e.args && Number.isFinite(Number(e.args.elementCount))).map((e) => Number(e.args.elementCount));
      const mises = evenements.filter((e) => e.name === 'Layout' && e.args && e.args.beginData).sort((a, b) => a.ts - b.ts).map((e) => ({ sales: Number(e.args.beginData.dirtyObjects) || 0, total: Number(e.args.beginData.totalObjects) || 0 }));
      const pages = mises.map((m) => m.sales);
      // (ou les recalculs et les mises en page sont sortis : leur categorie, pour lire un rouge)
      const categories = {};
      evenements.filter((e) => e.name === 'UpdateLayoutTree' || e.name === 'Layout').forEach((e) => { categories[e.cat] = (categories[e.cat] || 0) + 1; });
      // (totalFin : les objets de la page a la derniere mise en page de la trace)
      return { styleMax: styles.length ? Math.max(...styles) : 0, mises: pages.length, objetsMax: pages.length ? Math.max(...pages) : 0, totalFin: mises.length ? mises[mises.length - 1].total : 0, categories };
    };
    // L ETALON SE COMPTE EN OBJETS DE LA PAGE, SON TABLEAU BATI (2026-11-22, la suite GitHub du lot). .gf est un
    // conteneur (container: feuille / inline-size). Sous Chromium 157, celui des machines GitHub (Chrome 157 du
    // poste aussi), le style de ses descendants se calcule pendant la mise en page : un tableau reecrit n a pas
    // encore ses objets quand elle commence, et la trace lui en donne 10 a reprendre (beginData.dirtyObjects),
    // pour le meme travail, 25 ms environ, que les 3 422 d Edge 158. Le tableau se rend donc en entier, puis une sonde
    // d un pixel, posee et retiree, relance deux petites mises en page : la derniere compte les objets de la page,
    // tableau bati (2 876 sous les deux versions). Une mesure qui ne les voit pas se rejoue, deux fois au plus. La
    // pop-up, posee sur le body, hors du conteneur, se compte comme avant : les objets que ses mises en page
    // reprennent (les memes 40 sous les deux versions).
    const etalon = async () => {
      const avant = await page.evaluate(() => window.__gfStats.ecritures);
      const mesure = await tracer(() => page.evaluate(() => {
        const w = document.getElementById('globalPlanningGridWrap');
        w._gfParties = null;
        renderGlobalPlanning(w);
        let hauteur = document.body.offsetHeight;
        const sonde = document.createElement('div');
        sonde.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px';
        document.body.appendChild(sonde);
        hauteur += document.body.offsetHeight;
        sonde.remove();
        return hauteur + document.body.offsetHeight;
      }));
      return { ...mesure, ecrit: (await page.evaluate(() => window.__gfStats.ecritures)) - avant };
    };
    let tableau = await etalon();
    for (let essai = 2; essai <= 3 && tableau.totalFin < 1000; essai += 1) tableau = { ...(await etalon()), essai };
    await page.waitForTimeout(150);
    const puce = await centre(page, sel);
    // (la souris sur la pastille d abord : son survol n est pas la pop-up)
    await page.mouse.move(puce.x, puce.y);
    await page.waitForTimeout(250);
    const stats0 = await page.evaluate(() => Object.assign({}, window.__gfStats));
    let goutte = null;
    let ouvert = null;
    let avantChoix = null;
    let sortie = null;
    const pop = await tracer(async () => {
      await page.mouse.down();
      await page.mouse.up();
      goutte = await page.evaluate(lireGoutte);
      await page.waitForSelector('#gfHeurePop.is-rempli', { timeout: 10000 }).catch(() => null);
      await page.waitForTimeout(350);
      ouvert = await page.evaluate(lirePop);
      avantChoix = { patchs: patchs.length, intacte: brut(MANON) === depart };
      await page.keyboard.press('Escape');
      sortie = await page.evaluate(() => { const p = document.querySelector('.gf-hp.is-part'); return p ? { nom: getComputedStyle(p).animationName, duree: getComputedStyle(p).animationDuration } : null; });
      await page.waitForTimeout(400);
    });
    const stats1 = await page.evaluate(() => Object.assign({}, window.__gfStats));
    const restes = await page.evaluate(() => ({ pops: document.querySelectorAll('.gf-hp').length, focus: Boolean(document.activeElement && document.activeElement.matches('[data-gf-act]')) }));

    ok(ouvert && /Laser, 1re partie/.test(ouvert.texte) && /Amis de Manon/.test(ouvert.texte) && /Prévu à 15:30/.test(ouvert.texte),
      '[P1] la pastille « 15:30 » ouvre la pop-up : l activite, le groupe, l heure prevue', ouvert && ouvert.texte);
    const dessous = ouvert ? ouvert.r.t - (puce.b.y + puce.b.height) : -1;
    const dessus = ouvert ? puce.b.y - ouvert.r.b : -1;
    ok(ouvert && ((dessous >= 0 && dessous <= 12) || (dessus >= 0 && dessus <= 12)) && ouvert.r.l <= puce.b.x + 1 && (puce.b.x - ouvert.r.l <= 16 || ouvert.r.d >= ouvert.vw - 9) && ouvert.r.l >= 0 && ouvert.r.t >= 0 && ouvert.r.b <= ouvert.vh && ouvert.r.d <= ouvert.vw,
      '[P1] posee contre la pastille (a quelques pixels dessous ou dessus, son bord gauche contre elle), dans l ecran', { pop: ouvert && ouvert.r, puce: puce.b });
    const permises = /^(opacity|transform|background-color|border-(top|bottom)-(left|right)-radius)$/;
    ok(goutte && goutte.nom === 'gfHpGoutte' && /^0\.2[0-9]*s$|^0\.3s$/.test(goutte.duree) && parseFloat(goutte.duree) >= 0.2 && parseFloat(goutte.duree) <= 0.3 && goutte.courbe === 'cubic-bezier(0.23, 1, 0.32, 1)',
      '[P2] la goutte : 200 a 300 ms, cubic-bezier(0.23, 1, 0.32, 1)', goutte);
    ok(goutte && goutte.props.length && goutte.props.every((p) => permises.test(p)) && goutte.props.includes('transform') && /scale\(/.test(goutte.depart) && /border-/.test(goutte.props.join(' ')),
      '[P2] elle n anime que transform (une echelle depuis la pastille), opacity, l arrondi et la teinte', goutte && { props: goutte.props, depart: goutte.depart });
    ok(goutte && Math.abs(goutte.ox - puce.x) <= 2 && Math.abs(goutte.oy - puce.y) <= 2,
      '[P2] elle part du centre de la pastille touchee', goutte && { origine: [goutte.ox, goutte.oy], puce: [puce.x, puce.y] });
    ok(sortie && sortie.nom === 'gfHpRentre' && parseFloat(sortie.duree) < parseFloat((goutte && goutte.duree) || '0') && restes.pops === 0 && restes.focus,
      '[P2] Echap : elle rentre plus vite qu elle n est sortie, puis s en va ; le focus revient a la pastille', { sortie, restes });
    ok(stats1.ecritures === stats0.ecritures && stats1.rendus === stats0.rendus,
      '[P3] ouverte, remplie, fermee : le tableau ne s est ni rendu ni reecrit', { avant: stats0, apres: stats1 });
    // (l etalon d abord : la page du jour charge, son tableau bati, fait des milliers d objets ; et la trace a vu
    // la pop-up, au moins une mise en page : une trace qui ne la voit pas ne la dit pas legere)
    ok(tableau.totalFin >= 1000 && pop.mises >= 1 && pop.objetsMax * 20 <= tableau.totalFin && pop.styleMax <= 150 && pop.mises <= 14,
      `[P3] jour charge : la pop-up reprend au plus ${pop.objetsMax} objets en page (la page et son tableau : ${tableau.totalFin}), recalcule au plus ${pop.styleMax} elements, ${pop.mises} mises en page de l ouverture a la fermeture`, { pop, tableau });

    const { v } = await attendues;
    const prevues = heuresAttendues(v, '15:30');
    const essais = blancs.filter((c) => c.deplacement && Array.isArray(c.deplacement.essais) && Number(c.deplacement.id) === MANON);
    ok(ouvert && ouvert.heures.length > 0 && JSON.stringify(ouvert.heures) === JSON.stringify(prevues) && ouvert.heures.every((h) => v.get(h) && v.get(h).passe),
      '[V1] elle propose les heures que le serveur laisse passer, les plus proches de 15:30', { pop: ouvert && ouvert.heures, serveur: prevues });
    const raison = (h) => (v.get(h) || {}).raison || '';
    ok(['16:00', '17:30', '19:00', '19:30'].every((h) => !ouvert.heures.includes(h)) && /chevauche le Laser Game du groupe/.test(raison('16:00')) && ['17:30', '19:00', '19:30'].every((h) => /armes/.test(raison(h))),
      '[V1] jamais 16:00 (sa 2e partie), ni 17:30, 19:00, 19:30 (les armes sont prises)', { '16:00': raison('16:00'), '17:30': raison('17:30'), '19:00': raison('19:00') });
    ok(essais.length === 1 && avantChoix.patchs === 0 && avantChoix.intacte,
      '[V1] une seule requete, le calcul a blanc du serveur (ses essais) ; rien n est ecrit', { essais: essais.length, patchs: avantChoix.patchs });

    // [E1] un toucher enregistre, « Annuler » remet.
    await page.click(sel);
    await page.waitForSelector('#gfHeurePop.is-rempli', { timeout: 10000 }).catch(() => null);
    // (la goutte finie, la pop-up telle que le staff la lit)
    if (CAPTURES && !mutation) { await page.waitForTimeout(350); await capture(page, 'pop-heure'); }
    const choix = page.locator('#gfHeurePop [data-gf-hp-choix]', { hasText: '17:00' }).first();
    if (await choix.count()) await choix.click();
    await attendre(page, async () => patchs.length >= 1);
    await page.waitForTimeout(300);
    const corps = patchs[0] || {};
    const apres = enBase(MANON);
    const lu = await page.evaluate((s) => ({ toast: (() => { const t = document.getElementById('toast'); return t && !t.classList.contains('hidden') ? t.textContent.replace(/\s+/g, ' ').trim() : ''; })(), puce: ((document.querySelector(s) || {}).textContent || '').trim(), pop: Boolean(document.getElementById('gfHeurePop')) }), PASTILLE(MANON, 'laser_game:1.1'));
    ok(patchs.length === 1 && Object.keys(corps).sort().join(',') === 'activityMove,baseUpdatedAt,centerId,id' && JSON.stringify(corps.activityMove) === JSON.stringify({ activityId: 'laser_game', unitKey: '1.1', startTime: '17:00' })
      && apres.laser['1.1'] === '17:00' && apres.laser['2.1'] === '16:00' && lu.puce === '17:00' && !lu.pop,
      '[E1] « 17:00 » touche : un seul PATCH activityMove, en base et au tableau, la 2e partie ne bouge pas', { patchs, apres, puce: lu.puce });
    const toast = await page.evaluate(lireToast);
    ok(/Amis de Manon : Laser, 1re partie passe à 17:00\./.test(toast.texte) && toast.annuler,
      '[E1] un toast le dit, avec « Annuler »', toast);
    if (toast.annuler) await page.click('#toast .toast-annuler');
    await attendre(page, async () => patchs.length >= 2);
    await page.waitForTimeout(300);
    const remis = enBase(MANON);
    const toast2 = await page.evaluate(lireToast);
    ok(patchs.length === 2 && remis.laser['1.1'] === '15:30' && remis.laser['2.1'] === '16:00' && /revient à 15:30/.test(toast2.texte),
      '[E1] « Annuler » la remet a 15:30, en base, et le dit', { remis, toast: toast2.texte, patchs: patchs.length });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (la pop-up)', erreurs);
  } finally {
    await ctx.close();
  }
  // [P2] en mouvement reduit, rien ne bouge.
  const r = await monter(browser, { mouvementReduit: true });
  try {
    await ligneEnHaut(r.page, MANON);
    await r.page.click(PASTILLE(MANON, 'laser_game:1.1'));
    const goutte = await r.page.evaluate(lireGoutte);
    await r.page.waitForSelector('#gfHeurePop.is-rempli', { timeout: 10000 }).catch(() => null);
    await r.page.keyboard.press('Escape');
    await r.page.waitForTimeout(40);
    const restes = await r.page.evaluate(() => document.querySelectorAll('.gf-hp').length);
    ok(goutte && goutte.nom === 'none' && restes === 0, '[P2] mouvement reduit : elle s ouvre et se ferme sans bouger', { goutte: goutte && goutte.nom, restes });
    ok(r.erreurs.length === 0, '[J1] aucune erreur JS (mouvement reduit)', r.erreurs);
  } finally {
    await r.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [G1] [G2] : a la souris, l heure du laser de Manon.
// ---------------------------------------------------------------------------
async function scenarioSouris(browser) {
  const { ctx, page, erreurs, patchs } = await monter(browser);
  try {
    // [G1] la 1re partie (15:30) posee sur 16:30.
    await ligneEnHaut(page, MANON);
    const de = await centre(page, PASTILLE(MANON, 'laser_game:1.1'));
    const vers = await demiHeure(page, '16:30', de.x);
    const pendant = await glisserALaSouris(page, de, vers, 'glisser-cible');
    ok(pendant.leve && pendant.pris === 1 && pendant.ton === 'ok' && pendant.cible === '16:30 : libre' && /Laser, 1re partie · 15:30 → 16:30/.test(pendant.apercu) && pendant.reperes.ok > 0 && pendant.reperes.non > 0,
      '[G1] la pastille se prend : l apercu suit, la cible dit « 16:30 : libre », chaque demi-heure jugee a son trait', pendant);
    ok(pendant.surbrillance.calques > 0 && pendant.surbrillance.vues === 0,
      '[G1] le temps du geste, la surbrillance des lignes survolees s efface : seule la cible dit ou l heure se pose', pendant.surbrillance);
    await attendre(page, async () => patchs.length >= 1);
    await page.waitForTimeout(250);
    const apres = enBase(MANON);
    const toast = await page.evaluate(lireToast);
    const fiche = await page.evaluate(() => !document.getElementById('posOverlay').classList.contains('hidden'));
    ok(patchs.length === 1 && JSON.stringify((patchs[0] || {}).activityMove) === JSON.stringify({ activityId: 'laser_game', unitKey: '1.1', startTime: '16:30' }) && apres.laser['1.1'] === '16:30' && /passe à 16:30/.test(toast.texte) && toast.annuler && !fiche,
      '[G1] posee : enregistree en base (un PATCH activityMove), le toast avec « Annuler », la fiche ne s ouvre pas', { patchs, apres, toast, fiche });
    if (toast.annuler) await page.click('#toast .toast-annuler');
    await attendre(page, async () => patchs.length >= 2);
    await page.waitForTimeout(300);
    ok(enBase(MANON).laser['1.1'] === '15:30', '[G1] « Annuler » la remet a 15:30', enBase(MANON));

    // [G2] la 2e partie (16:00) posee sur 15:30 : elle chevaucherait la 1re.
    const depart = brut(MANON);
    await ligneEnHaut(page, MANON);
    const de2 = await centre(page, PASTILLE(MANON, 'laser_game:2.1'));
    const vers2 = await demiHeure(page, '15:30', de2.x);
    const n = patchs.length;
    const refus = await glisserALaSouris(page, de2, vers2, 'glisser-refus');
    await page.waitForTimeout(300);
    const avis = await page.evaluate(lireAvis);
    ok(refus.leve && refus.ton === 'non' && /^15:30 : Ce déplacement chevauche le Laser Game du groupe, de 15:30 à 15:55\.$/.test(refus.cible),
      '[G2] sur 15:30, la cible dit en rouge pourquoi : la 1re partie du groupe y est', refus);
    ok(patchs.length === n && brut(MANON) === depart && /Pas déplacé/.test(avis) && /chevauche le Laser Game du groupe/.test(avis),
      '[G2] posee la : refusee avec sa raison, rien ne part, rien ne s ecrit', { patchs: patchs.length - n, avis });

    // [G4] la 2e partie emmenee au bas du tableau : la feuille defile sous le pointeur ; Echap repose tout.
    await ligneEnHaut(page, MANON);
    const de4 = await centre(page, PASTILLE(MANON, 'laser_game:2.1'));
    const defile4 = () => page.evaluate(() => document.querySelector('#globalPlanningGridWrap .gf-defile').scrollTop);
    const bas4 = await page.evaluate(() => document.querySelector('#globalPlanningGridWrap .gf-defile').getBoundingClientRect().bottom);
    const n4 = patchs.length;
    const depart4 = brut(MANON);
    const avant4 = await defile4();
    await page.mouse.move(de4.x, de4.y);
    await page.mouse.down();
    await page.mouse.move(de4.x + 3, de4.y + 7, { steps: 2 });
    await page.mouse.move(de4.x, bas4 - 12, { steps: 10 });
    await page.waitForTimeout(400);
    const defile = (await defile4()) - avant4;
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(300);
    const restes4 = await page.evaluate(() => ({ leve: Boolean(window.__gfHeure.glisse()), apercus: document.querySelectorAll('.gf-apercu').length, fiche: !document.getElementById('posOverlay').classList.contains('hidden') }));
    ok(defile >= 40 && !restes4.leve && restes4.apercus === 0 && !restes4.fiche && patchs.length === n4 && brut(MANON) === depart4,
      '[G4] emmenee au bas du tableau, l heure le fait defiler ; Echap la repose, rien ne s ecrit', { defile, restes: restes4, patchs: patchs.length - n4 });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (la souris)', erreurs);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [G3] : au doigt, sur tablette.
// ---------------------------------------------------------------------------
async function scenarioDoigt(browser) {
  const { ctx, page, erreurs, patchs } = await monter(browser, { appareil: 'tablette' });
  try {
    const cdp = await ctx.newCDPSession(page);
    await ligneEnHaut(page, MANON);
    // Un doigt qui part tout de suite : le tableau defile, rien ne se leve.
    const de2 = await centre(page, PASTILLE(MANON, 'laser_game:2.1'));
    const point = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(de2.x, de2.y) });
    let leve = false;
    for (let i = 1; i <= 8; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(de2.x, de2.y - i * 18) });
      await page.waitForTimeout(12);
      leve = leve || await page.evaluate(() => Boolean(window.__gfHeure.glisse()) || document.querySelectorAll('.gf-apercu').length > 0);
    }
    await page.waitForTimeout(400);
    leve = leve || await page.evaluate(() => Boolean(window.__gfHeure.glisse()) || document.querySelectorAll('.gf-apercu').length > 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    ok(!leve && patchs.length === 0, '[G3] un doigt qui part tout de suite ne leve rien, rien ne s ecrit', { leve, patchs: patchs.length });

    // Un appui long leve la 1re partie, le doigt la pose sur 16:30.
    // (15:30 en haut : sur tablette, 16:30 tombe sinon dans les 44 px du bas ou le tableau defile tout seul,
    // et le doigt, le temps de la capture, finit sur 17:00. Le point vise reste hors de ces deux bords.)
    await demiHeureEnHaut(page, '15:30');
    const de = await centre(page, PASTILLE(MANON, 'laser_game:1.1'));
    const vers = await demiHeure(page, '16:30', de.x);
    const bords = await page.evaluate(() => { const d = document.querySelector('#globalPlanningGridWrap .gf-defile').getBoundingClientRect(); const t = document.querySelector('#globalPlanningGridWrap .gf-defile thead'); return { haut: d.top + (t ? t.getBoundingClientRect().height : 0) + 44, bas: d.bottom - 44 }; });
    vers.y = Math.min(vers.y, bords.bas - 8);
    const pendant = await glisserAuDoigt(page, cdp, de, vers, 'glisser-doigt');
    await attendre(page, async () => patchs.length >= 1);
    await page.waitForTimeout(250);
    const apres = enBase(MANON);
    ok(vers.y > vers.haut + 2 && vers.y < bords.bas && pendant.leve && pendant.ton === 'ok' && pendant.cible === '16:30 : libre' && patchs.length === 1 && apres.laser['1.1'] === '16:30',
      '[G3] un appui long leve l heure, le doigt la pose sur 16:30 : enregistree', { vers, bords, pendant, apres, patchs: patchs.length });
    // La pastille de Manon est dans la bande du haut (44 px sous la tete) : levee, elle ne fait pas
    // defiler le tableau tant que le doigt ne va pas vers ce bord.
    ok(de.y < bords.haut && pendant.tenu === 0, '[G3] une heure levee au bord du tableau ne le fait pas defiler sous un doigt immobile', { doigt: de.y, bande: bords.haut, defile: pendant.tenu });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (le doigt)', erreurs);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [L1] : la ligne entiere d un groupe.
// ---------------------------------------------------------------------------
async function scenarioLigne(browser) {
  const { ctx, page, erreurs, patchs, blancs } = await monter(browser);
  try {
    // Henrard, 16:00, posee sur 17:00 : tout le groupe passe.
    await ligneEnHaut(page, HENRARD);
    const nom = `#globalPlanningGridWrap tr[data-gf-id="${HENRARD}"] .gf-nom__t`;
    const de = await centre(page, nom);
    const vers = await demiHeure(page, '17:00', de.x);
    const pendant = await glisserALaSouris(page, de, vers, 'glisser-ligne');
    await attendre(page, async () => patchs.length >= 1);
    await page.waitForTimeout(300);
    const apres = enBase(HENRARD);
    const corps = patchs[0] || {};
    const toast = await page.evaluate(lireToast);
    const modifs = blancs.filter((c) => c.modification && Number(c.modification.id) === HENRARD);
    ok(pendant.leve && pendant.ton === 'ok' && pendant.cible === '17:00 : tout le groupe passe' && /Famille Henrard · 16:00 → 17:00/.test(pendant.apercu) && modifs.length > 0,
      '[L1] la ligne se prend : sur 17:00, le calcul a blanc de « Modifier » dit que tout le groupe passe', { pendant, modifs: modifs.length });
    ok(patchs.length === 1 && corps.startTime === '17:00' && !corps.activityMove && apres.debut === '17:00' && apres.bowling === '17:00[8]' && /Famille Henrard : réservation déplacée à 17:00, ses activités suivent\./.test(toast.texte) && toast.annuler,
      '[L1] posee : l heure du dossier passe a 17:00 par « Modifier », son bowling suit (piste 8), « Annuler » propose', { corps: { startTime: corps.startTime, activityMove: corps.activityMove }, apres, toast });
    if (toast.annuler) await page.click('#toast .toast-annuler');
    await attendre(page, async () => patchs.length >= 2);
    await page.waitForTimeout(300);
    const remis = enBase(HENRARD);
    ok(patchs.length === 2 && remis.debut === '16:00' && remis.bowling === '16:00[8]', '[L1] « Annuler » la remet a 16:00, piste 8', remis);

    // Noel, 16:30, posee sur 16:00 : le bowling est complet.
    const departNoel = brut(NOEL);
    await demiHeureEnHaut(page, '16:00');
    const deN = await centre(page, `#globalPlanningGridWrap tr[data-gf-id="${NOEL}"] .gf-nom__t`);
    const versN = await demiHeure(page, '16:00', deN.x);
    const n = patchs.length;
    const refus = await glisserALaSouris(page, deN, versN);
    await page.waitForTimeout(300);
    const avis = await page.evaluate(lireAvis);
    ok(refus.leve && refus.ton === 'non' && refus.cible === '16:00 : Pas de piste libre pour ce groupe à cette heure.' && patchs.length === n && brut(NOEL) === departNoel && /Pas déplacé/.test(avis) && /Pas de piste libre/.test(avis),
      '[L1] sur 16:00 (bowling complet), la cible le dit et le depot est refuse : rien ne s ecrit', { refus, avis, patchs: patchs.length - n });

    // Henrard posee sur 15:00 : l heure est deja passee.
    const departH = brut(HENRARD);
    await demiHeureEnHaut(page, '15:00');
    const deH = await centre(page, nom);
    const versH = await demiHeure(page, '15:00', deH.x);
    const passee = await glisserALaSouris(page, deH, versH);
    await page.waitForTimeout(300);
    ok(passee.leve && passee.ton === 'non' && passee.cible === '15:00 : 15:00 est déjà passé : il est 15:10.' && patchs.length === n && brut(HENRARD) === departH,
      '[L1] sur 15:00 : « 15:00 est déjà passé : il est 15:10. », rien ne s ecrit', passee);
    ok(erreurs.length === 0, '[J1] aucune erreur JS (la ligne)', erreurs);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [F1] : Lina joue depuis 15:00.
// ---------------------------------------------------------------------------
async function scenarioGele(browser) {
  const { ctx, page, erreurs, serveur, patchs, blancs } = await monter(browser);
  try {
    const depart = brut(LINA);
    const phrase = 'DÉMO · Anniversaire Lina (12 ans) joue depuis 15:00 : ses heures ne bougent plus.';
    await ligneEnHaut(page, LINA);
    const sel = PASTILLE(LINA, 'minigolf_blacklight');
    await page.click(sel);
    await page.waitForTimeout(500);
    const pop = await page.evaluate(lirePop);
    await capture(page, 'pop-gele');
    const essais = blancs.filter((c) => c.deplacement && Number(c.deplacement.id) === LINA && Array.isArray(c.deplacement.essais));
    ok(pop && pop.gele === phrase && pop.heures.length === 0 && pop.fiche && essais.length === 0,
      '[F1] sa pop-up dit qu elle joue, sans proposer d heure ; « Ouvrir la fiche » reste', { pop, essais: essais.length });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Son heure ne se leve pas.
    const de = await centre(page, sel);
    const vers = await demiHeure(page, '16:30', de.x);
    const heure = await glisserALaSouris(page, de, vers);
    await page.waitForTimeout(200);
    const avis = await page.evaluate(lireAvis);
    // Sa ligne non plus.
    await ligneEnHaut(page, LINA);
    const deL = await centre(page, `#globalPlanningGridWrap tr[data-gf-id="${LINA}"] .gf-nom__t`);
    const versL = await demiHeure(page, '16:30', deL.x);
    const ligne = await glisserALaSouris(page, deL, versL);
    await page.waitForTimeout(200);
    const avisL = await page.evaluate(lireAvis);
    ok(!heure.leve && !ligne.leve && patchs.length === 0 && brut(LINA) === depart && avis.includes(phrase) && /joue depuis 15:00 : sa ligne ne bouge pas\./.test(avisL),
      '[F1] ni son heure ni sa ligne ne se levent : la raison se dit, rien ne s ecrit', { heure: heure.leve, ligne: ligne.leve, avis, avisL, patchs: patchs.length });
    const rep = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', deplacement: { id: LINA, centerId: 'libramont', baseUpdatedAt: enBase(LINA).version, essais: [[{ activityId: 'minigolf_blacklight', startTime: '16:30' }]] } });
    ok(rep.statut === 200 && rep.json && rep.json.gele === phrase && Array.isArray(rep.json.essais) && rep.json.essais.length === 0 && brut(LINA) === depart,
      '[F1] le serveur le redit : son calcul a blanc rend `gele`, aucune heure', rep.json);
    // [F2] Une console restee ouverte sur l etat d avant envoie quand meme : le serveur refuse.
    const version = enBase(LINA).version;
    const minigolf = { activityId: 'minigolf_blacklight', startTime: '16:30' };
    const seul = await serveur.appeler('PATCH', '/api/staff-reservations', { id: LINA, centerId: 'libramont', baseUpdatedAt: version, activityMove: minigolf });
    const ensemble = await serveur.appeler('PATCH', '/api/staff-reservations', { id: LINA, centerId: 'libramont', baseUpdatedAt: version, activityMoves: [minigolf] });
    // (le verdict d une heure changee dans « Modifier », et celui de toute la modification qui la porte)
    const verdict = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', deplacement: { id: LINA, centerId: 'libramont', baseUpdatedAt: version, activityMoves: [minigolf] } });
    const modifier = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, modification: { id: LINA, centerId: 'libramont', baseUpdatedAt: version, deplacements: [minigolf] } });
    const refuse = (r) => r.statut === 409 && r.json && r.json.ok === false && r.json.message === phrase && r.json.code === 'groupe_en_jeu';
    const refusABlanc = (r) => Boolean(r.json && r.json.refus && r.json.refus.message === phrase && r.json.refus.code === 'groupe_en_jeu');
    ok(refuse(seul) && refuse(ensemble) && refusABlanc(verdict) && refusABlanc(modifier) && brut(LINA) === depart,
      '[F2] le PATCH qui deplace son activite, seul ou en bloc, et les verdicts de « Modifier » la refusent avec la phrase de la pop-up ; rien ne s ecrit',
      { seul: [seul.statut, seul.json], ensemble: [ensemble.statut, ensemble.json && ensemble.json.message], verdict: verdict.json && verdict.json.refus, modifier: modifier.json && modifier.json.refus });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (le groupe qui joue)', erreurs);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [W1] [W2] [W3] : les deux groupes de la 1re partie laser d Ethan (journee normale, « deux-groupes »).
// ---------------------------------------------------------------------------
// Un groupe arrive au comptoir pendant que la pop-up est ouverte : 10 joueurs dans l arene a `heure`
// (sur le modele du laser de Theo, la meme journee).
function groupeDeDerniereMinute(heure) {
  const r = JSON.parse(JSON.stringify(FX.lireFixture('normal').staffState.reservations.find((x) => x.id === 1584)));
  const debut = minutes(heure);
  const bloc = r.opsPlan.resourceBlocks.find((b) => b.resourceType === 'laser_arena');
  Object.assign(r, { id: 9902, name: 'DÉMO · Groupe de dernière minute', pax: 10, startTime: heure });
  r.opsPlan = { ...r.opsPlan, timeline: [], laserPassPlan: undefined, resourceBlocks: [{ ...bloc, start: debut, end: debut + 25, startTime: heure, endTime: hhmm(debut + 25), players: 10, weaponNeed: 10, groupPlayers: 10, playersTotal: 10, playersBefore: 0, countIndex: 1, groupWaveIndex: 1, groupWaveCount: 1 }] };
  return r;
}
async function scenarioVagues(browser) {
  const { ctx, page, erreurs, serveur, patchs } = await monter(browser, { fixture: 'normal', variante: ['deux-groupes'] });
  try {
    const sel = PASTILLE(ETHAN, 'laser_game:1.1+1.2');
    const ouvrir = async (heure) => {
      await ligneEnHaut(page, ETHAN);
      await page.click(sel);
      await page.waitForSelector('#gfHeurePop.is-rempli', { timeout: 10000 }).catch(() => null);
      await page.waitForTimeout(300);
      const choix = page.locator('#gfHeurePop [data-gf-hp-choix]', { hasText: heure }).first();
      return { offerte: (await choix.count()) > 0, choix };
    };
    const dits = (corps) => ((corps && corps.activityMoves) || []).map((m) => `${m.unitKey}>${m.startTime}`).join(' ');

    // [W2] Sans la console : le 1er groupe a 18:00, le 2e a 19:30, ou le basket joue a 12.
    const depart = brut(ETHAN);
    const refus = await serveur.appeler('PATCH', '/api/staff-reservations', { id: ETHAN, centerId: 'libramont', baseUpdatedAt: enBase(ETHAN).version, activityMoves: [{ activityId: 'laser_game', unitKey: '1.1', startTime: '18:00' }, { activityId: 'laser_game', unitKey: '1.2', startTime: '19:30' }] });
    ok(refus.statut === 409 && refus.json && refus.json.rang === 1 && refus.json.message === 'Laser Game complet de 19:30 à 19:55 : 34 joueurs pour 30 armes.' && brut(ETHAN) === depart,
      '[W2] le 2e groupe coince (19:30, 34 joueurs pour 30 armes) : le serveur refuse les deux, dit lequel (rang 1), rien n est ecrit', { statut: refus.statut, json: refus.json, apres: enBase(ETHAN) });

    // [W1] La pop-up : 18:00 touche, un seul PATCH, les deux groupes ensemble ; « Annuler » les remet ensemble.
    const a = await ouvrir('18:00');
    if (a.offerte) await a.choix.click();
    await attendre(page, async () => patchs.length >= 1);
    await page.waitForTimeout(300);
    const apres = enBase(ETHAN);
    const toast = await page.evaluate(lireToast);
    ok(a.offerte && patchs.length === 1 && !('activityMove' in patchs[0]) && dits(patchs[0]) === '1.1>18:00 1.2>18:00'
      && apres.laser['1.1'] === '18:00' && apres.laser['1.2'] === '18:00' && apres.laser['2.1'] === '16:30' && /Amis d.Ethan : Laser, 1re partie passe à 18:00\./.test(toast.texte) && toast.annuler,
      '[W1] « 18:00 » touche : un seul PATCH activityMoves, les deux groupes a 18:00 en base, le toast avec « Annuler »', { offerte: a.offerte, patchs, apres, toast });
    if (toast.annuler) await page.click('#toast .toast-annuler');
    await attendre(page, async () => patchs.length >= 2);
    await page.waitForTimeout(300);
    const remis = enBase(ETHAN);
    ok(patchs.length === 2 && dits(patchs[1]) === '1.1>16:00 1.2>16:00' && remis.laser['1.1'] === '16:00' && remis.laser['1.2'] === '16:00',
      '[W1] « Annuler » remet les deux groupes a 16:00, d un seul PATCH', { retour: dits(patchs[1]), remis, patchs: patchs.length });

    // [W3] La pop-up ouverte sur 18:00, un groupe de 10 entre dans l arene a 18:00, puis le toucher :
    // 18 + 10 tiennent, 22 + 10 non.
    const n = patchs.length;
    const avant = brut(ETHAN);
    const b = await ouvrir('18:00');
    B.base.reservations.set(9902, ligneDepuis(groupeDeDerniereMinute('18:00')));
    if (b.offerte) await b.choix.click();
    await attendre(page, async () => patchs.length > n);
    await page.waitForTimeout(500);
    const avis = await page.evaluate(lireAvis);
    const puce = await page.evaluate((s) => ((document.querySelector(s) || {}).textContent || '').trim(), sel);
    ok(b.offerte && patchs.length === n + 1 && dits(patchs[n]) === '1.1>18:00 1.2>18:00' && brut(ETHAN) === avant && puce === '16:00'
      && /Pas déplacé/.test(avis) && avis.includes('Laser, 1re partie, groupe 2 sur 2 à 18:00 : Laser Game complet de 18:00 à 18:25 : 32 joueurs pour 30 armes.') && avis.includes('Aucun groupe n’a bougé.'),
      '[W3] l arene remplie entre la pop-up et le toucher : le 2e groupe coince, aucun ne bouge, l avis dit lequel', { avis, puce, envoye: dits(patchs[n]), apres: enBase(ETHAN) });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (les deux groupes)', erreurs);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [S1] : depuis la fiche de Manon.
// ---------------------------------------------------------------------------
async function scenarioFiche(browser) {
  const { ctx, page, erreurs, serveur, patchs } = await monter(browser);
  try {
    const { v } = await verdictsDuServeur(serveur, MANON, { activityId: 'laser_game', unitKey: '1.1' });
    await page.evaluate((i) => { openPos(i); setTab('infos'); }, MANON);
    await page.waitForTimeout(400);
    const sel = `#posOverlay .gc-step-heure[data-pg-heure="laser_game:1.1"]`;
    const bouton = await centre(page, sel);
    const texte = bouton ? (await page.locator(sel).first().textContent()).trim() : '';
    if (bouton) await page.click(sel);
    await page.waitForSelector('#gfHeurePop.is-rempli', { timeout: 10000 }).catch(() => null);
    await page.waitForTimeout(350);
    const pop = await page.evaluate(lirePop);
    await capture(page, 'pop-fiche');
    const prevues = heuresAttendues(v, '15:30');
    const dessous = pop && bouton ? pop.r.t - (bouton.b.y + bouton.b.height) : -1;
    const dessus = pop && bouton ? bouton.b.y - pop.r.b : -1;
    ok(bouton && texte === '15:30' && pop && ((dessous >= 0 && dessous <= 12) || (dessus >= 0 && dessus <= 12)) && /Laser, 1re partie/.test(pop.texte) && JSON.stringify(pop.heures) === JSON.stringify(prevues),
      '[S1] dans la fiche, l heure « 15:30 » du Programme ouvre la meme pop-up, contre elle, avec les memes heures', { texte, pop: pop && { r: pop.r, heures: pop.heures }, bouton: bouton && bouton.b, prevues });
    const choix = page.locator('#gfHeurePop [data-gf-hp-choix]', { hasText: '17:00' }).first();
    if (await choix.count()) await choix.click();
    await attendre(page, async () => patchs.length >= 1);
    await page.waitForTimeout(400);
    const apres = enBase(MANON);
    const relu = await page.evaluate((s) => ((document.querySelector(s) || {}).textContent || '').trim(), sel);
    const toast = await page.evaluate(lireToast);
    ok(patchs.length === 1 && JSON.stringify((patchs[0] || {}).activityMove) === JSON.stringify({ activityId: 'laser_game', unitKey: '1.1', startTime: '17:00' }) && apres.laser['1.1'] === '17:00' && relu === '17:00' && toast.annuler,
      '[S1] un toucher enregistre : en base, dans la fiche, avec « Annuler »', { patchs, apres, relu, toast });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (la fiche)', erreurs);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : chaque garde retiree (en memoire) fait rougir sa lettre.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'pop-au-coin', lettre: 'P1', scenarios: ['pop'], editions: [{ fichier: MODULE, de: '    var top = Math.max(marge, dessous ? a.bottom + 6 : a.top - 6 - h);', vers: '    var top = marge;' }] },
  { nom: 'goutte-lente', lettre: 'P2', scenarios: ['pop'], editions: [{ fichier: FEUILLE, de: '  .gf-hp.is-nait { animation: gfHpGoutte 260ms cubic-bezier(0.23, 1, 0.32, 1) both; }', vers: '  .gf-hp.is-nait { animation: gfHpGoutte 600ms ease both; }' }] },
  { nom: 'goutte-qui-pousse', lettre: 'P2', scenarios: ['pop'], editions: [{ fichier: FEUILLE, de: '  from { opacity: .7; transform: scale(var(--gf-hp-sx, .2), var(--gf-hp-sy, .2));', vers: '  from { opacity: .7; max-height: 12px; transform: scale(var(--gf-hp-sx, .2), var(--gf-hp-sy, .2));' }] },
  { nom: 'goutte-du-coin', lettre: 'P2', scenarios: ['pop'], editions: [{ fichier: MODULE, de: "    el.style.setProperty('--gf-hp-ox', Math.round(a.left + a.width / 2 - left) + 'px');", vers: "    el.style.setProperty('--gf-hp-ox', '0px');" }] },
  // (le mouvement reduit tient a deux gardes : la regle de toute la console, assets/pinlane.css §12, et celle
  // de la goutte ; sans les deux, la goutte bouge)
  { nom: 'reduit-ignore', lettre: 'P2', scenarios: ['pop'], editions: [
    { fichier: FEUILLE, de: '@media (prefers-reduced-motion: no-preference) {\n  .gf-hp.is-nait {', vers: '@media all {\n  .gf-hp.is-nait {' },
    { fichier: FEUILLE_COMMUNE, de: '    animation-duration: 0.01ms !important;\n    animation-iteration-count: 1 !important;\n', vers: '' },
  ] },
  { nom: 'tableau-reecrit', lettre: 'P3', scenarios: ['pop'], editions: [{ fichier: MODULE, de: '    document.body.appendChild(el);\n    gfJetonPop += 1;', vers: "    document.body.appendChild(el);\n    var gw = document.getElementById('globalPlanningGridWrap'); if (gw) { gw._gfParties = null; renderGlobalPlanning(gw); }\n    gfJetonPop += 1;" }] },
  { nom: 'heures-sans-verdict', lettre: 'V1', scenarios: ['pop'], editions: [{ fichier: MODULE, de: '      var libres = debuts.filter(function (d) { var v = memo.verdicts.get(gfMinute(d)); return v && v.passe; });', vers: '      var libres = debuts.filter(function (d) { return memo.verdicts.has(gfMinute(d)); });' }] },
  { nom: 'essais-complaisants', lettre: 'V1', scenarios: ['pop'], editions: [{ fichier: API, serveur: true, de: '      return { passe: false, raison: phraseDuRefus(error.message) };', vers: '      return { passe: true };' }] },
  { nom: 'enregistre-pas', lettre: 'E1', scenarios: ['pop'], editions: [{ fichier: MODULE, de: '    if (r && v && v.passe) gfEnregistrerHeure(r, point, minute / 60, offset, v.moves);', vers: '' }] },
  { nom: 'annuler-vide', lettre: 'E1', scenarios: ['pop'], editions: [{ fichier: MODULE, de: 'toastAnnulable(dit, function () { gfDefaireHeure(ecrit.id, point, offset, retour); });', vers: 'toastAnnulable(dit, function () {});' }] },
  { nom: 'souris-morte', lettre: 'G1', scenarios: ['souris'], editions: [{ fichier: MODULE, de: "    wrap.addEventListener('pointerdown', function (e) { gfSourisBas(wrap, e); });", vers: '' }] },
  { nom: 'depot-sans-verdict', lettre: 'G2', scenarios: ['souris'], editions: [
    { fichier: MODULE, de: "    if (v.ton === 'non') { refuser(v.texte); return; }", vers: '' },
    { fichier: MODULE, de: "        if (vv && !vv.passe) { refuser(gpHeure(h) + ' : ' + vv.raison); return; }", vers: '' },
  ] },
  { nom: 'doigt-mort', lettre: 'G3', scenarios: ['doigt'], editions: [{ fichier: MODULE, de: "    wrap.addEventListener('touchstart', function (e) { gfDoigtDebut(wrap, e); }, { passive: true });", vers: '' }] },
  // (leve des que le doigt se pose : un doigt qui voulait faire defiler emporterait l heure)
  { nom: 'doigt-sans-appui-long', lettre: 'G3', scenarios: ['doigt'], editions: [{ fichier: MODULE, de: '    if (!src) return;\n    window.PinlaneTouchDrag.demarrer(e, {', vers: '    if (!src) return;\n    gfGlisse = Object.assign({}, src, { wrap: wrap, tactile: true, lance: false }); gfLancer(gfGlisse, e.touches[0].clientX, e.touches[0].clientY);\n    window.PinlaneTouchDrag.demarrer(e, {' }] },
  // (la surbrillance des lignes reste pendant le geste : une ligne grise suit le pointeur a cote de la cible)
  { nom: 'surbrillance-pendant', lettre: 'G1', scenarios: ['souris'], editions: [{ fichier: MODULE, de: "    document.body.classList.add('gf-en-glisse');\n", vers: '' }] },
  // (le bas ne s arme jamais : l heure emmenee au bord n y fait plus rien defiler)
  { nom: 'bord-jamais-arme', lettre: 'G4', scenarios: ['souris'], editions: [{ fichier: MODULE, de: '    if (g.y <= b.bas || g.y >= g.yLeve + 8) g.armeBas = true;\n', vers: '' }] },
  // (le bord defile des que l heure s y leve : le tableau part sous le doigt immobile)
  { nom: 'bord-sans-garde', lettre: 'G3', scenarios: ['doigt'], editions: [{ fichier: MODULE, de: '      var pas = g.y < b.haut && g.armeHaut ? -Math.ceil((b.haut - g.y) / 3) : g.y > b.bas && g.armeBas ? Math.ceil((g.y - b.bas) / 3) : 0;', vers: '      var pas = g.y < b.haut ? -Math.ceil((b.haut - g.y) / 3) : g.y > b.bas ? Math.ceil((g.y - b.bas) / 3) : 0;' }] },
  { nom: 'ligne-complaisante', lettre: 'L1', scenarios: ['ligne'], editions: [{ fichier: MODULE, de: "      if (rep.refus) return rep.refus.code === 'reservation_modifiee' ? null : { passe: false, raison: gfPhraseErreur(rep.refus) };", vers: "      if (rep.refus) return { passe: true, raison: '' };" }] },
  { nom: 'ligne-annuler-vide', lettre: 'L1', scenarios: ['ligne'], editions: [{ fichier: MODULE, de: '        gfDeplacerLeDossier(courant, avant, autres && pistesAvant.length ? pistesAvant : null).then(function (rendu) {', vers: '        Promise.resolve(null).then(function (rendu) {' }] },
  { nom: 'ligne-heure-passee', lettre: 'L1', scenarios: ['ligne'], editions: [{ fichier: MODULE, de: '    var maintenant = r.date === todayStr() ? Math.ceil(currentTimeDecimal() * 60 - 1e-6) / 60 : null;', vers: '    var maintenant = null;' }] },
  { nom: 'gele-ignore', lettre: 'F1', scenarios: ['gele'], editions: [
    { fichier: MODULE, de: '    if (!debuts.length) return null;\n', vers: '    if (true) return null;\n' },
    { fichier: RETARD, serveur: true, de: '  if (!commencees.length) return null;', vers: '  if (true) return null;' },
  ] },
  { nom: 'gele-serveur-muet', lettre: 'F1', scenarios: ['gele'], editions: [{ fichier: RETARD, serveur: true, de: '  if (!commencees.length) return null;', vers: '  if (true) return null;' }] },
  // (le PATCH deplace le groupe qui joue, pour une console restee sur l etat d avant)
  { nom: 'gele-patch-ouvert', lettre: 'F2', scenarios: ['gele'], editions: [{ fichier: API, serveur: true, de: '        refuserSiLeGroupeJoue(current, deplacements);\n', vers: '' }] },
  // (le verdict d une heure de « Modifier » le laisse passer)
  { nom: 'gele-heure-a-blanc', lettre: 'F2', scenarios: ['gele'], editions: [{ fichier: API, serveur: true, de: '    refuserSiLeGroupeJoue(current, deplacements);\n    let candidat = current;', vers: '    let candidat = current;' }] },
  // (le verdict de toute la modification le laisse passer)
  { nom: 'gele-modifier-a-blanc', lettre: 'F2', scenarios: ['gele'], editions: [{ fichier: API, serveur: true, de: '  // (le PATCH activityMove le refusera : le verdict le dit avant le clic)\n  refuserSiLeGroupeJoue(current, deplacements);\n', vers: '' }] },
  // (les groupes partent l un apres l autre, un PATCH chacun : le premier bouge meme si le second coince)
  { nom: 'vagues-une-a-une', lettre: 'W1', scenarios: ['vagues'], editions: [{ fichier: MODULE, de: '    var envoi = moves.length > 1 ? envoyerDeplacementsActivite(r, moves) : envoyerDeplacementActivite(r, moves[0]);', vers: '    var envoi = moves.reduce(function (s, m) { return s.then(function (p) { return envoyerDeplacementActivite((p && p.reservation) || r, m); }); }, Promise.resolve(null));' }] },
  // (la base n ecrit que le premier groupe)
  { nom: 'vagues-en-partie', lettre: 'W1', scenarios: ['vagues'], editions: [{ fichier: 'lib/database.js', serveur: true, de: '    const deplacements = Array.isArray(input.activityMoves) ? input.activityMoves : (input.activityMove ? [input.activityMove] : null);', vers: '    const deplacements = Array.isArray(input.activityMoves) ? input.activityMoves.slice(0, 1) : (input.activityMove ? [input.activityMove] : null);' }] },
  // (le refus ne dit plus quel groupe coince)
  { nom: 'vagues-sans-rang', lettre: 'W2', scenarios: ['vagues'], editions: [{ fichier: API, serveur: true, de: '    if (error && Number.isInteger(error.rangDuDeplacement)) extra.rang = error.rangDuDeplacement;\n', vers: '' }] },
  // (l avis tait le groupe qui coince)
  { nom: 'vagues-sans-nom', lettre: 'W3', scenarios: ['vagues'], editions: [{ fichier: MODULE, de: "    var vague = moves.length > 1 && Number.isInteger(lu.rang) && moves[lu.rang] ?", vers: "    var vague = false ?" }] },
  { nom: 'fiche-sans-heure', lettre: 'S1', scenarios: ['fiche'], editions: [{ fichier: CONSOLE, de: "    const cleHeure = options.coches && typeof window.pgCleHeure === 'function' ? window.pgCleHeure(r, etape) : '';", vers: "    const cleHeure = '';" }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'pop') await scenarioPop(browser);
    if (nom === 'souris') await scenarioSouris(browser);
    if (nom === 'doigt') await scenarioDoigt(browser);
    if (nom === 'ligne') await scenarioLigne(browser);
    if (nom === 'gele') await scenarioGele(browser);
    if (nom === 'fiche') await scenarioFiche(browser);
    if (nom === 'vagues') await scenarioVagues(browser);
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, liste(process.env.HG_SCENARIOS) || ['pop', 'souris', 'doigt', 'ligne', 'gele', 'fiche', 'vagues']);
    } else {
      console.log('[K] contre-preuves : chaque garde retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.HG_MUTATIONS || liste(process.env.HG_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.HG_BAVARD;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `[K] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveurHttp.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nplanning-heure-glisser-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nplanning-heure-glisser-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

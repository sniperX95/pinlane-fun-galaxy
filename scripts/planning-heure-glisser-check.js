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
//        ni sa ligne ne se levent, rien ne s ecrit ; le serveur le redit (`gele`), mot pour mot ; la
//        phrase dit ce que le serveur verifie (sur place et l heure d une activite passee, ou une
//        activite cochee a la main), jamais « joue » (2026-11-23 : la coche automatique est retiree) ;
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
//   [M1] l heure a la minute (2026-11-23, Ansar : « on peut pas choisir l'heure qu'on veut à la
//        minute ») : le champ et ses pas de 5 min (ceux de la fenetre du retard) ; le serveur juge
//        l heure du champ, « Déplacer » l enregistre (un PATCH activityMove), Entree aussi ; les heures
//        libres restent en raccourcis ; « Annuler » remet ;
//   [M2] une minute qui ne tient pas le dit (l activite, l heure, la raison du serveur) et rien ne
//        part ; une minute deja passee, ou d avant l arrivee du groupe, se dit sans demander au serveur ;
//   [T1] « Tout le groupe » (Ansar : « si on veut tout avancer de 30 minutes, on peut pas ») : seule, la
//        1re partie de Manon ne va pas a 16:00 (sa 2e y joue) ; tout le groupe, si (+30 min). Sacha : seul,
//        son bowling ne va ni a 17:00 ni a 17:30 (son laser) ; tout le groupe va a 16:00 (+30 min), pas a
//        16:30 ; une requete, le calcul a blanc du groupe. (Ses arcades ne retiennent pas son bowling seul :
//        le controle de Modifier, du glisser et de la pop-up ne les compte pas, seul Reserver le fait, 3db74d9.)
//   [T2] un toucher decale tout le groupe d un PATCH (toutLeGroupe), en base ; « Annuler » remet tout ;
//   [T3] a la minute, ce qui coince se dit : l activite et l heure qui coincent, meme quand ce n est pas
//        celle qu on a touchee ; ce qui passe dit chaque activite a sa nouvelle heure ;
//   [T4] des pistes se prennent entre le verdict et le toucher : le serveur refuse, l avis dit quelle
//        activite coince, a quelle heure, et que rien n a bouge ;
//   [D1] au telephone (390 px, au doigt) : toucher le champ de l heure ne ferme pas la pop-up, la saisie se
//        juge ; le clavier qui reduit la fenetre non plus, elle se repose entiere contre sa pastille ; sans le
//        champ en main, la page qui defile la ferme ;
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
// (comme grands-groupes-check : la creation d un grand groupe, [T5], passe par le vrai moteur, sans reseau ni vraie base)
delete process.env.RESEND_API_KEY;
delete process.env.POSTGRES_URL;
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';
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
const SACHA = 1604; // bowling 15:30 (pistes 1 et 2), arcades 16:35, laser 17:30 : tout le groupe passe a +30 min
const NATHAN = 1607; // bowling 17:00, pistes 1 et 2 (le modele du groupe de derniere minute)
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

async function monter(browser, { appareil = 'ordinateur', mouvementReduit = false, fixture = 'pic', variante = [], horlogeServeur = false } = {}) {
  // (une autre journee ou une variante : la meme sur le serveur et dans la page, FX.varier)
  const journee = fixture === 'pic' && !variante.length ? FIXTURE.staffState : FX.varier(FX.lireFixture(fixture), FX.lireCentre(), variante).fixture.staffState;
  B.semer(journee.reservations.map(ligneDepuis));
  // (horlogeServeur : le jour du serveur est celui de la fixture, a 15:10, comme grands-groupes-check : la creation d un grand groupe n est planifiee que dans l horizon du jour)
  if (horlogeServeur) globalThis.__comptoirMaintenant = FX.instant(journee.date, '15:10').getTime();
  const horloge = horlogeServeur ? [{ fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' }] : [];
  const serveur = B.monter({ mutations: [...horloge, ...(mutation ? mutation.editions.filter((ed) => ed.serveur) : [])], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
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
// [F1] : Lina, sur place, son laser de 15:00 passe ; Manon, une partie cochee a la main.
// ---------------------------------------------------------------------------
async function scenarioGele(browser) {
  const { ctx, page, erreurs, serveur, patchs, blancs } = await monter(browser);
  try {
    const depart = brut(LINA);
    // (2026-11-23 : personne ne l a cochee ; le serveur sait qu elle est la et que l heure de son laser est passee)
    const phrase = 'DÉMO · Anniversaire Lina (12 ans) : sur place, et l’heure de Laser Game (15:00) est passée. Ses heures ne bougent plus.';
    await ligneEnHaut(page, LINA);
    const sel = PASTILLE(LINA, 'minigolf_blacklight');
    await page.click(sel);
    await page.waitForTimeout(500);
    const pop = await page.evaluate(lirePop);
    await capture(page, 'pop-gele');
    const essais = blancs.filter((c) => c.deplacement && Number(c.deplacement.id) === LINA && Array.isArray(c.deplacement.essais));
    ok(pop && pop.gele === phrase && !/\bjoue/.test(pop.gele) && pop.heures.length === 0 && pop.fiche && essais.length === 0,
      '[F1] sa pop-up dit ce qui la gele (sur place, l heure de son laser passee), jamais « joue », sans proposer d heure ; « Ouvrir la fiche » reste', { pop, essais: essais.length });
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
    ok(!heure.leve && !ligne.leve && patchs.length === 0 && brut(LINA) === depart && avis.includes(phrase) && avisL.includes('DÉMO · Anniversaire Lina (12 ans) : sur place, et l’heure de Laser Game (15:00) est passée. Sa ligne ne bouge pas.'),
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
    // [F1] Une coche a la main : Manon, sa 1re partie cochee (15:30, l heure n est pas encore la). La pop-up
    // et le serveur disent la coche, mot pour mot.
    const manon = B.base.reservations.get(MANON);
    B.base.reservations.set(MANON, { ...manon, activity_progress: { 'laser_game-1': { done: true } } });
    await page.evaluate((id) => { const r = state.reservations.find((x) => Number(x.id) === id); r.activityProgress = { 'laser_game-1': { done: true } }; }, MANON);
    await ligneEnHaut(page, MANON);
    await page.click(PASTILLE(MANON, 'laser_game:1.1'));
    await page.waitForTimeout(500);
    const popM = await page.evaluate(lirePop);
    const repM = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', deplacement: { id: MANON, centerId: 'libramont', baseUpdatedAt: enBase(MANON).version, toutLeGroupe: { ecarts: [30] } } });
    const phraseM = `${manon.name} : une activité est cochée faite (Laser Game, 15:30). Ses heures ne bougent plus.`;
    ok(popM && popM.gele === phraseM && popM.heures.length === 0 && repM.json && repM.json.gele === phraseM,
      '[F1] une activite cochee a la main gele le groupe : la pop-up et le serveur disent « une activité est cochée faite (Laser Game, 15:30) »', { pop: popM && popM.gele, serveur: repM.json && repM.json.gele });
    await capture(page, 'pop-gele-coche');
    await page.keyboard.press('Escape');
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
    // (la phrase du comptoir depuis 1672d14 : les armes qui restent, celles qu il faut, la prochaine partie libre)
    ok(refus.statut === 409 && refus.json && refus.json.rang === 1 && refus.json.message === 'Plus assez d’armes pour le laser à 19:30 : il en reste 18 sur 30, il en faut 22. La prochaine partie libre est à 20:30.' && brut(ETHAN) === depart,
      '[W2] le 2e groupe coince (19:30 : 18 armes restent, il en faut 22) : le serveur refuse les deux, dit lequel (rang 1), rien n est ecrit', { statut: refus.statut, json: refus.json, apres: enBase(ETHAN) });

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
      && /Pas déplacé/.test(avis) && avis.includes('Laser, 1re partie, groupe 2 sur 2 à 18:00 : Plus assez d’armes pour le laser à 18:00 : il en reste 20 sur 30, il en faut 22. La prochaine partie libre est à 18:30.') && avis.includes('Aucun groupe n’a bougé.'),
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
// ---------------------------------------------------------------------------
// [M1] [M2] : l heure a la minute ; [T1] [T2] [T3] [T4] : tout le groupe (2026-11-23).
// ---------------------------------------------------------------------------
// Le champ, ses pas, son bouton, la ligne du verdict, ce qui bouge, et les raccourcis.
function lireMinute() {
  const p = document.getElementById('gfHeurePop');
  if (!p) return null;
  const champ = p.querySelector('[data-gf-hp-champ]');
  const bouton = p.querySelector('[data-gf-hp-valider]');
  const verdict = p.querySelector('[data-gf-hp-verdict]');
  const mode = p.querySelector('[data-gf-hp-mode][aria-pressed="true"]');
  const zone = p.querySelector('[data-gf-hp-heures]');
  return {
    texte: p.innerText.replace(/\s+/g, ' ').trim(),
    champ: champ ? champ.value : null,
    pas: Array.from(p.querySelectorAll('[data-gf-hp-pas]')).map((b) => b.textContent.trim()),
    bouton: bouton ? bouton.textContent.trim() : null,
    desactive: bouton ? bouton.disabled : null,
    verdict: verdict ? verdict.textContent.trim() : '',
    ton: verdict ? ((/is-(passe|bloque)/.exec(verdict.className) || [])[1] || '') : '',
    mode: mode ? mode.getAttribute('data-gf-hp-mode') : '',
    pour: zone ? zone.getAttribute('data-gf-hp-pour') || '' : '',
    heures: Array.from(p.querySelectorAll('[data-gf-hp-choix]')).map((b) => b.childNodes[0].textContent.trim()),
    raccourcis: Array.from(p.querySelectorAll('[data-gf-hp-ecart]')).map((b) => ({ heure: b.childNodes[0].textContent.trim(), ecart: ((b.querySelector('small') || {}).textContent || '').trim() })),
  };
}
// La ligne du verdict, une fois le serveur (ou le plancher) passe : elle nomme l heure jugee.
async function verdictLu(page, heure) {
  await page.waitForFunction((h) => {
    const v = document.querySelector('#gfHeurePop [data-gf-hp-verdict]');
    const t = v ? v.textContent : '';
    return t.indexOf(h) >= 0 && /passe|ne tient pas|ne répond pas/.test(t);
  }, heure, { timeout: 10000 }).catch(() => null);
  return page.evaluate(lireMinute);
}
async function ouvrirHeure(page, id, cle) {
  await ligneEnHaut(page, id);
  await page.click(PASTILLE(id, cle));
  await page.waitForSelector('#gfHeurePop.is-rempli', { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(300);
}

// Henrard (bowling 16:00, piste 8, seul a heure) et Noel (bowling 16:30, piste 6).
async function scenarioMinute(browser) {
  const { ctx, page, erreurs, patchs, blancs } = await monter(browser);
  try {
    await ouvrirHeure(page, HENRARD, 'bowling');
    const ouvert = await page.evaluate(lireMinute);
    ok(ouvert && ouvert.champ === '16:00' && ouvert.pas.join(' ') === '−5 +5' && ouvert.bouton === 'Déplacer' && ouvert.desactive === true && ouvert.mode === '' && ouvert.verdict === '' && ouvert.heures.length > 0,
      '[M1] la pop-up porte l heure a la minute : le champ (16:00), −5 et +5, « Déplacer » en attente ; les heures libres restent en raccourcis', ouvert);
    const n0 = blancs.length;
    await page.click('#gfHeurePop [data-gf-hp-pas="5"]');
    const plus5 = await verdictLu(page, '16:05');
    ok(plus5 && plus5.champ === '16:05' && plus5.verdict === '16:05 passe.' && plus5.ton === 'passe' && plus5.desactive === false && blancs.length === n0 + 1 && patchs.length === 0,
      '[M1] +5 : 16:05 ; le serveur la juge (un calcul a blanc) : « 16:05 passe. » ; rien n est ecrit avant le bouton', { plus5, blancs: blancs.length - n0, patchs: patchs.length });
    await capture(page, 'pop-minute');
    await page.click('#gfHeurePop [data-gf-hp-valider]');
    await attendre(page, async () => patchs.length >= 1);
    await page.waitForTimeout(300);
    const corps = patchs[0] || {};
    const toast = await page.evaluate(lireToast);
    ok(patchs.length === 1 && corps.activityMove && corps.activityMove.activityId === 'bowling' && corps.activityMove.startTime === '16:05' && !corps.toutLeGroupe && enBase(HENRARD).bowling === '16:05[8]'
      && /Famille Henrard : Bowling passe à 16:05\./.test(toast.texte) && toast.annuler,
      '[M1] « Déplacer » : un PATCH activityMove a 16:05, piste 8, en base ; un toast avec « Annuler »', { corps, base: enBase(HENRARD), toast });
    if (toast.annuler) await page.click('#toast .toast-annuler');
    await attendre(page, async () => patchs.length >= 2);
    await page.waitForTimeout(300);
    ok(patchs.length === 2 && enBase(HENRARD).bowling === '16:00[8]', '[M1] « Annuler » la remet a 16:00', enBase(HENRARD));

    // Tapee au clavier, puis Entree.
    await ouvrirHeure(page, HENRARD, 'bowling');
    await page.fill('#gfHeurePop [data-gf-hp-champ]', '16:17');
    const tape = await verdictLu(page, '16:17');
    await page.keyboard.press('Enter');
    await attendre(page, async () => patchs.length >= 3);
    await page.waitForTimeout(300);
    ok(tape && tape.verdict === '16:17 passe.' && patchs.length === 3 && patchs[2].activityMove && patchs[2].activityMove.startTime === '16:17' && enBase(HENRARD).bowling === '16:17[8]',
      '[M1] tapee au clavier, 16:17 se juge, Entree l enregistre', { tape: tape && tape.verdict, patch: patchs[2], base: enBase(HENRARD) });

    // [M2] Deja passee : 15:05, il est 15:10. Le serveur n est pas derange.
    await ouvrirHeure(page, HENRARD, 'bowling');
    const n1 = blancs.length;
    await page.fill('#gfHeurePop [data-gf-hp-champ]', '15:05');
    const passee = await verdictLu(page, '15:05');
    ok(passee && passee.verdict === 'Bowling ne tient pas à 15:05 : déjà passé, il est 15:10.' && passee.ton === 'bloque' && passee.desactive === true && blancs.length === n1,
      '[M2] 15:05 : « Bowling ne tient pas à 15:05 : déjà passé, il est 15:10. », sans demander au serveur', { passee, blancs: blancs.length - n1 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // [M2] Noel (bowling 16:30, arrive a 16:30). A 16:02, avant son arrivee : la pop-up le dit sans demander au
    // serveur. A 23:02, c est le serveur qui refuse (le bowling finirait apres minuit) : la ligne dit sa raison.
    const departNoel = brut(NOEL);
    const np = patchs.length;
    await ouvrirHeure(page, NOEL, 'bowling');
    const n2 = blancs.length;
    await page.fill('#gfHeurePop [data-gf-hp-champ]', '16:02');
    const avantArrivee = await verdictLu(page, '16:02');
    ok(avantArrivee && avantArrivee.verdict === 'Bowling ne tient pas à 16:02 : avant l’arrivée du groupe, à 16:30.' && avantArrivee.ton === 'bloque' && avantArrivee.desactive === true && blancs.length === n2,
      '[M2] Noel a 16:02 : « Bowling ne tient pas à 16:02 : avant l’arrivée du groupe, à 16:30. », sans demander au serveur', { avantArrivee, blancs: blancs.length - n2 });
    await page.fill('#gfHeurePop [data-gf-hp-champ]', '23:02');
    const refus = await verdictLu(page, '23:02');
    await capture(page, 'pop-minute-refus');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    ok(refus && /^Bowling ne tient pas à 23:02 : Hors des horaires d’ouverture : l’activité finirait à 00:02, le centre ferme à minuit/.test(refus.verdict) && refus.ton === 'bloque' && refus.desactive === true
      && blancs.length === n2 + 1 && patchs.length === np && brut(NOEL) === departNoel,
      '[M2] Noel a 23:02 : le serveur la refuse (un calcul a blanc), la ligne dit l activite, l heure et sa raison ; le bouton reste eteint, Entree n enregistre rien', { refus, blancs: blancs.length - n2, patchs: patchs.length - np });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (l heure a la minute)', erreurs);
  } finally {
    await ctx.close();
  }
}

// Manon (laser 15:30, 2e partie 16:00), puis Sacha : bowling 15:30 (pistes 1 et 2), arcades 16:35, laser 17:30.
async function scenarioGroupe(browser) {
  const { ctx, page, erreurs, patchs, blancs } = await monter(browser);
  try {
    // [T1] La demande d Ansar, sur Manon : seule, sa 1re partie ne va pas a 16:00, sa 2e y joue ; tout le
    // groupe, si (les deux parties bougent ensemble). Le serveur le dit aussi (decaler-groupe-check.js [B]).
    await ouvrirHeure(page, MANON, 'laser_game:1.1');
    const manonSeule = await page.evaluate(lireMinute);
    // (sans « Tout le groupe », rien a toucher : c est l assertion qui le dit, pas une attente qui casse)
    const boutonGroupe = await page.$('#gfHeurePop [data-gf-hp-mode="groupe"]');
    if (boutonGroupe) {
      await boutonGroupe.click();
      await page.waitForFunction(() => { const z = document.querySelector('#gfHeurePop [data-gf-hp-heures]'); return Boolean(z) && z.getAttribute('data-gf-hp-pour') === 'groupe'; }, null, { timeout: 10000 }).catch(() => null);
    }
    const manonGroupe = await page.evaluate(lireMinute);
    ok(manonSeule && manonSeule.mode === 'seul' && manonSeule.pour === 'seul' && manonSeule.heures.length > 0 && !manonSeule.heures.includes('16:00')
      && manonGroupe && manonGroupe.mode === 'groupe' && manonGroupe.raccourcis.some((x) => x.heure === '16:00' && x.ecart === '+30 min'),
      '[T1] Manon (laser 15:30, 2e partie 16:00) : seule, sa 1re partie ne va pas a 16:00 (sa 2e y joue) ; « Tout le groupe » propose 16:00 (+30 min)',
      { seule: manonSeule && manonSeule.heures, groupe: manonGroupe && manonGroupe.raccourcis });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    await ouvrirHeure(page, SACHA, 'bowling');
    const seul = await page.evaluate(lireMinute);
    ok(seul && seul.mode === 'seul' && seul.pour === 'seul' && /Cette activité/.test(seul.texte) && /Tout le groupe/.test(seul.texte) && seul.heures.length > 0 && !seul.heures.includes('17:00') && !seul.heures.includes('17:30'),
      '[T1] Sacha (bowling, arcades, laser) : « Cette activité » ou « Tout le groupe » ; seul, son bowling ne va ni a 17:00 ni a 17:30 (son laser de 17:30 y est)', seul);
    const n0 = blancs.length;
    await page.click('#gfHeurePop [data-gf-hp-mode="groupe"]');
    await page.waitForFunction(() => { const z = document.querySelector('#gfHeurePop [data-gf-hp-heures]'); return Boolean(z) && z.getAttribute('data-gf-hp-pour') === 'groupe'; }, null, { timeout: 10000 }).catch(() => null);
    const groupe = await page.evaluate(lireMinute);
    const demandes = blancs.slice(n0).filter((c) => c.deplacement && Number(c.deplacement.id) === SACHA);
    const raccourcis = (groupe && groupe.raccourcis) || [];
    ok(groupe && groupe.mode === 'groupe' && groupe.bouton === 'Tout décaler' && raccourcis.some((x) => x.heure === '16:00' && x.ecart === '+30 min') && !raccourcis.some((x) => x.heure === '16:30')
      && demandes.length === 1 && demandes[0].deplacement.toutLeGroupe && Array.isArray(demandes[0].deplacement.toutLeGroupe.ecarts),
      '[T1] « Tout le groupe » : 16:00 (+30 min) est proposee, 16:30 non (ses pistes y sont prises) ; une requete, le calcul a blanc du groupe', { raccourcis, demandes: demandes.length });
    await capture(page, 'pop-groupe');

    // [T2] Un toucher sur 16:00 : tout le groupe passe 30 min plus tard, « Annuler » le remet.
    const avant = enBase(SACHA);
    await page.click('#gfHeurePop [data-gf-hp-ecart="30"]');
    await attendre(page, async () => patchs.length >= 1);
    await page.waitForTimeout(300);
    const corps = patchs[0] || {};
    const apres = enBase(SACHA);
    const toast = await page.evaluate(lireToast);
    ok(patchs.length === 1 && Object.keys(corps).sort().join(',') === 'baseUpdatedAt,centerId,id,toutLeGroupe' && JSON.stringify(corps.toutLeGroupe) === '{"ecart":30}'
      && apres.debut === '16:00' && apres.bowling === '16:00[1,2]' && apres.laser['1.1'] === '18:00' && /: tout le groupe passe 30 min plus tard \(Bowling à 16:00\)\./.test(toast.texte) && toast.annuler,
      '[T2] un toucher : un seul PATCH toutLeGroupe (+30 min) ; l arrivee, le bowling (pistes 1 et 2) et le laser passent ensemble ; « Annuler » propose', { corps, avant, apres, toast });
    if (toast.annuler) await page.click('#toast .toast-annuler');
    await attendre(page, async () => patchs.length >= 2);
    await page.waitForTimeout(300);
    const remis = enBase(SACHA);
    const toast2 = await page.evaluate(lireToast);
    ok(patchs.length === 2 && JSON.stringify((patchs[1] || {}).toutLeGroupe) === '{"ecart":-30}' && remis.debut === '15:30' && remis.bowling === '15:30[1,2]' && remis.laser['1.1'] === '17:30' && /tout le groupe revient à ses heures\./.test(toast2.texte),
      '[T2] « Annuler » remet tout le groupe a ses heures, d un PATCH', { remis, toast: toast2.texte });

    // [T3] A la minute, pour tout le groupe.
    await ouvrirHeure(page, SACHA, 'bowling');
    await page.click('#gfHeurePop [data-gf-hp-mode="groupe"]');
    await page.click('#gfHeurePop [data-gf-hp-pas="5"]');
    const cinq = await verdictLu(page, '17:35');
    ok(cinq && cinq.champ === '15:35' && /^Laser ne tient pas à 17:35 : l’arène joue déjà la partie de 17:30/.test(cinq.verdict) && cinq.ton === 'bloque' && cinq.desactive === true,
      '[T3] +5 pour tout le groupe : ce n est pas le bowling touche qui coince, c est son laser, et la ligne le dit (« Laser ne tient pas à 17:35 : ... »)', cinq);
    await page.fill('#gfHeurePop [data-gf-hp-champ]', '16:30');
    const soixante = await verdictLu(page, '16:30');
    ok(soixante && soixante.verdict === 'Bowling ne tient pas à 16:30 : Pistes 1 et 2 déjà prises de 16:30 à 17:30.' && soixante.desactive === true,
      '[T3] 16:30 : « Bowling ne tient pas à 16:30 : Pistes 1 et 2 déjà prises de 16:30 à 17:30. »', soixante);
    await page.fill('#gfHeurePop [data-gf-hp-champ]', '16:00');
    const trente = await verdictLu(page, '16:00');
    ok(trente && /^Tout le groupe passe 30 min plus tard : Bowling 16:00 · .*Laser 18:00\.$/.test(trente.verdict) && trente.ton === 'passe' && trente.desactive === false && trente.bouton === 'Tout décaler',
      '[T3] 16:00 : « Tout le groupe passe 30 min plus tard », chaque activite a sa nouvelle heure ; « Tout décaler » s active', trente);
    await capture(page, 'pop-groupe-minute');

    // [T4] Un groupe de derniere minute prend les pistes 1 et 2 a 16:00, entre le verdict et le toucher.
    const { planDecale } = require(path.join(ROOT, 'lib/decaler-le-groupe.js'));
    const nathan = FIXTURE.staffState.reservations.find((x) => x.id === NATHAN);
    B.base.reservations.set(9903, { ...ligneDepuis(nathan), id: 9903, name: 'DÉMO · Groupe de dernière minute', start_time: '16:00', ops_plan: planDecale(nathan.opsPlan, -60) });
    const depart = brut(SACHA);
    const np = patchs.length;
    await page.click('#gfHeurePop [data-gf-hp-valider]');
    await attendre(page, async () => patchs.length > np);
    await page.waitForTimeout(500);
    const avis = await page.evaluate(lireAvis);
    await capture(page, 'groupe-refuse');
    ok(patchs.length === np + 1 && patchs[np].toutLeGroupe && patchs[np].toutLeGroupe.ecart === 30 && brut(SACHA) === depart && /Pas déplacé/.test(avis)
      && avis.includes('Tout le groupe : Bowling ne tient pas à 16:00 : Pistes 1 et 2 déjà prises de 16:00 à 17:00. Rien n’a bougé.'),
      '[T4] ses pistes se prennent entre le verdict et le toucher : le serveur refuse, l avis dit l activite et l heure qui coincent, et que rien n a bouge', { avis, patchs: patchs.length - np });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (tout le groupe)', erreurs);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [T5] « Tout le groupe » sur un GRAND GROUPE dont les heures ont ete posees au comptoir (2026-11-23).
// 60 joueurs en 4 groupes, chacun a son heure (groupes 1 et 2 : laser 15:30 puis bowling 16:30 ; groupes 3 et 4 :
// bowling 15:30 puis laser 16:30). Le serveur decale tout le groupe de +30 min : ou chaque groupe, chaque activite,
// passe du MEME ecart (et rien d autre ne bouge), ou il refuse avec une phrase et n ecrit rien. Jamais la moitie.
// ---------------------------------------------------------------------------
const heuresDesBlocs = (id) => {
  const row = B.base.reservations.get(Number(id));
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {});
  return (plan.resourceBlocks || []).filter((b) => b && (b.resourceType === 'laser_arena' || b.resourceType === 'bowling_lane'))
    .map((b) => `${b.resourceType === 'laser_arena' ? 'L' : 'B'}${Number(b.sousGroupe) || 0}@${b.startTime}`).sort();
};
async function scenarioGrandGroupe(browser) {
  const { ctx, page, erreurs, serveur } = await monter(browser, { fixture: 'vide', horlogeServeur: true });
  try {
    const jour = FX.lireFixture('vide').staffState.date;
    const decale = (liste, ecart) => liste.map((x) => { const [t, h] = x.split('@'); return `${t}@${hhmm(minutes(h) + ecart)}`; }).sort();
    // Deux groupes (30 + 30), puis quatre (15 x 4) : les groupes 1 et 2 au laser puis au bowling, les autres l inverse.
    for (const [nombre, tailles, heures] of [
      [2, [30, 30], [{ bowling: '16:30', laser_game: '15:30' }, { bowling: '15:30', laser_game: '16:30' }]],
      [4, [15, 15, 15, 15], [{ bowling: '16:30', laser_game: '15:30' }, { bowling: '16:30', laser_game: '15:30' }, { bowling: '15:30', laser_game: '16:30' }, { bowling: '15:30', laser_game: '16:30' }]],
    ]) {
      // (le dossier d avant s en va : la journee est vide pour le suivant, les memes heures)
      for (const [cle, ligne] of [...B.base.reservations]) if (/^DÉMO|^Groupe Posé/.test(String(ligne.name)) && /^Groupe Posé/.test(String(ligne.name))) B.base.reservations.delete(cle);
      const cree = await serveur.appeler('POST', '/api/staff-reservations', {
        name: `Groupe Posé ${nombre}`, phone: '0470111222', email: '', notes: '', occasion: '', date: jour, startTime: '15:30', duration: 1, totalDuration: 3, lanes: [], pax: 60, status: 'pending', type: 'visite', formuleId: '',
        program: [{ activityId: 'bowling', pax: 60, participants: 60, duration: 1 }, { activityId: 'laser_game', pax: 60, participants: 60, games: 1 }],
        laserGames: 0, extras: [], channel: 'staff', requiresLanes: true, centerId: 'libramont',
        preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { nombre, tailles, heures, impose: true } },
      });
      const id = cree.json && cree.json.reservation && cree.json.reservation.id;
      const avant = id ? heuresDesBlocs(id) : [];
      if (!ok(cree.statut === 201 && avant.length >= nombre * 2 && avant.some((x) => x.endsWith('@16:30')) && avant.some((x) => x.endsWith('@15:30')), `[T5] le grand groupe pose au comptoir nait en ${nombre} groupes, chacun a ses heures`, { statut: cree.statut, message: cree.json && cree.json.message, avant })) continue;
      const rep = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', baseUpdatedAt: enBase(id).version, toutLeGroupe: { ecart: 30 } });
      if (process.env.HG_DEBUG) console.log('DEBUG', nombre, rep.statut, JSON.stringify(rep.json).slice(0, 700));
      const apres = heuresDesBlocs(id);
      const tousDecales = JSON.stringify(apres) === JSON.stringify(decale(avant, 30));
      const refuse = rep.statut >= 400 && typeof (rep.json && rep.json.message) === 'string' && rep.json.message.length > 15 && JSON.stringify(apres) === JSON.stringify(avant);
      ok((rep.statut === 200 && tousDecales) || refuse,
        `[T5] « Tout le groupe » +30 min sur ${nombre} groupes poses : chaque groupe passe du meme ecart, ou le serveur refuse avec une phrase et rien ne bouge (reponse ${rep.statut}${rep.statut === 200 ? ', les passages decales' : ''})`, { statut: rep.statut, message: rep.json && rep.json.message, avant, apres });
      // (deux groupes : le plan tient, il DOIT passer ; la barre est plus haute que le refus)
      if (nombre === 2) ok(rep.statut === 200 && tousDecales, '[T5] deux groupes : « Tout le groupe » passe, les quatre passages decales de 30 min', { statut: rep.statut, message: rep.json && rep.json.message, avant, apres });
    }
    ok(erreurs.length === 0, '[J1] aucune erreur JS (grand groupe, tout le groupe)', erreurs);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [D1] : au telephone, le champ de l heure (Henrard, bowling 16:00).
// ---------------------------------------------------------------------------
function lireTelephone(id) {
  const p = document.getElementById('gfHeurePop');
  const a = document.querySelector(`#globalPlanningGridWrap tr[data-gf-id="${id}"] [data-gf-act="bowling"]`);
  const rp = p && p.getBoundingClientRect();
  const ra = a && a.getBoundingClientRect();
  const actif = document.activeElement;
  return {
    ouverte: Boolean(p),
    champEnMain: Boolean(actif && actif.matches && actif.matches('#gfHeurePop [data-gf-hp-champ]')),
    verdict: (((p && p.querySelector('[data-gf-hp-verdict]')) || {}).textContent || '').trim(),
    entiere: Boolean(rp) && rp.top >= 0 && rp.bottom <= window.innerHeight,
    contre: Boolean(rp && ra) && (Math.abs(rp.top - (ra.bottom + 6)) <= 1 || Math.abs(rp.bottom - (ra.top - 6)) <= 1),
  };
}
async function scenarioTelephone(browser) {
  const { ctx, page, erreurs, patchs } = await monter(browser, { appareil: 'telephone' });
  try {
    const sel = PASTILLE(HENRARD, 'bowling');
    // (le gerant cherche son groupe du doigt : la liste ne suit plus l heure, la page est a lui)
    const cdp = await ctx.newCDPSession(page);
    const point = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(200, 640) });
    for (let i = 1; i <= 12; i += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(200, 640 - i * 25) }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
    await page.waitForTimeout(300);
    await page.tap(sel);
    await page.waitForSelector('#gfHeurePop.is-rempli', { timeout: 10000 }).catch(() => null);
    await page.tap('#gfHeurePop [data-gf-hp-champ]');
    await page.waitForTimeout(300);
    const touche = await page.evaluate(lireTelephone, HENRARD);
    await page.keyboard.type('1607');
    await page.waitForFunction(() => /16:07 passe/.test(((document.querySelector('#gfHeurePop [data-gf-hp-verdict]') || {}).textContent || '')), null, { timeout: 10000 }).catch(() => null);
    const tape = await page.evaluate(lireTelephone, HENRARD);
    // Le clavier du telephone s ouvre : la fenetre perd 400 px (index.html, interactive-widget=resizes-content).
    await page.setViewportSize({ width: 390, height: 444 });
    await page.waitForTimeout(400);
    const clavier = await page.evaluate(lireTelephone, HENRARD);
    ok(touche.ouverte && touche.champEnMain && tape.ouverte && tape.verdict === '16:07 passe.' && clavier.ouverte && clavier.champEnMain && clavier.entiere && clavier.contre && patchs.length === 0,
      '[D1] au telephone : toucher le champ ne ferme pas la pop-up, 16:07 se juge ; le clavier qui reduit la fenetre non plus, elle se repose entiere contre sa pastille', { touche, tape, clavier });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    // Sans le champ en main, la page qui defile emporte la pastille : la pop-up se ferme.
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
    await page.waitForTimeout(300);
    await page.tap(sel);
    await page.waitForSelector('#gfHeurePop.is-rempli', { timeout: 10000 }).catch(() => null);
    const rouverte = await page.evaluate(lireTelephone, HENRARD);
    await page.evaluate(() => window.scrollBy(0, 120));
    await page.waitForTimeout(400);
    const defilee = await page.evaluate(lireTelephone, HENRARD);
    ok(rouverte.ouverte && !rouverte.champEnMain && !defilee.ouverte && patchs.length === 0, '[D1] sans le champ en main, la page qui defile ferme la pop-up', { rouverte, defilee });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (au telephone)', erreurs);
  } finally {
    await ctx.close();
  }
}

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
  { nom: 'tableau-reecrit', lettre: 'P3', scenarios: ['pop'], editions: [{ fichier: MODULE, de: '    document.body.appendChild(el);\n    gfPop = p;', vers: "    document.body.appendChild(el);\n    var gw = document.getElementById('globalPlanningGridWrap'); if (gw) { gw._gfParties = null; renderGlobalPlanning(gw); }\n    gfPop = p;" }] },
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
    { fichier: MODULE, de: '    if (!commencees.length) return null;\n', vers: '    if (true) return null;\n' },
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
  // (la phrase de la pop-up redit « joue depuis », quand personne n a coche)
  { nom: 'gele-phrase-joue', lettre: 'F1', scenarios: ['gele'], editions: [{ fichier: MODULE, de: "      : 'sur place, et l’heure de ' + gfNomDuGel(premiere.activityId) + ' (' + gpHeure(premiere.start) + ') est passée';", vers: "      : 'joue depuis ' + depuis;" }] },
  // (une coche a la main se dit comme une heure passee)
  { nom: 'gele-coche-muette', lettre: 'F1', scenarios: ['gele'], editions: [{ fichier: MODULE, de: '    var motif = cochees.length\n', vers: '    var motif = false\n' }] },
  // (le serveur redit « joue depuis » : la pop-up et lui ne disent plus la meme chose)
  { nom: 'gele-serveur-joue', lettre: 'F1', scenarios: ['gele'], editions: [{ fichier: RETARD, serveur: true, de: "  return { depuis, motif, phrase: `${current.name || 'Ce groupe'} : ${motif}. Ses heures ne bougent plus.` };", vers: "  return { depuis, motif, phrase: `${current.name || 'Ce groupe'} joue depuis ${depuis} : ses heures ne bougent plus.` };" }] },
  // (les pas de 5 min ne font rien)
  { nom: 'minute-sans-pas', lettre: 'M1', scenarios: ['minute'], editions: [{ fichier: MODULE, de: "    if (pas) { gfPasPop(Number(pas.getAttribute('data-gf-hp-pas'))); return; }", vers: '    if (pas) return;' }] },
  // (« Déplacer » ne fait rien)
  { nom: 'minute-sans-bouton', lettre: 'M1', scenarios: ['minute'], editions: [{ fichier: MODULE, de: "    if (ev.target.closest('[data-gf-hp-valider]')) { gfValiderPop(); return; }", vers: "    if (ev.target.closest('[data-gf-hp-valider]')) return;" }] },
  // (une minute refusee par le serveur se dit libre)
  { nom: 'minute-complaisante', lettre: 'M2', scenarios: ['minute'], editions: [{ fichier: MODULE, de: '        : { minute: m, mode: mode, passe: false, texte: gfNeTientPas(p.point.nom, p.point.activityId, heure, v.raison) });', vers: "        : { minute: m, mode: mode, passe: true, d: d, moves: [{ activityId: p.point.activityId, startTime: heure, lanes: p.point.pistes }], texte: heure + ' passe.' });" }] },
  // (une minute deja passee part au serveur)
  { nom: 'minute-passee-au-serveur', lettre: 'M2', scenarios: ['minute'], editions: [{ fichier: MODULE, de: '    if (d < plancher.h - 1e-6) {\n      var motif = plancher.maintenant', vers: '    if (false) {\n      var motif = plancher.maintenant' }] },
  // (pas de « Tout le groupe »)
  { nom: 'groupe-absent', lettre: 'T1', scenarios: ['groupe'], editions: [{ fichier: MODULE, de: "    var mode = p.groupe ? '<div class=\"gf-hp__mode\"", vers: "    var mode = false ? '<div class=\"gf-hp__mode\"" }] },
  // (les heures du groupe proposees sans le verdict du serveur)
  { nom: 'groupe-heures-sans-verdict', lettre: 'T1', scenarios: ['groupe'], editions: [{ fichier: MODULE, de: '      var libres = ecarts.filter(function (e) { var v = memo.verdicts.get(e); return v && v.passe; });', vers: '      var libres = ecarts.filter(function (e) { return memo.verdicts.has(e); });' }] },
  // (le calcul a blanc du groupe laisse tout passer)
  { nom: 'groupe-serveur-complaisant', lettre: 'T1', scenarios: ['groupe'], editions: [{ fichier: API, serveur: true, de: "        return { passe: false, raison: phraseDuRefus(error.message), ...(error.cleDuDeplacement ? { cle: String(error.cleDuDeplacement), heure: String(error.heureDuDeplacement || '') } : {}) };", vers: '        return { passe: true };' }] },
  // (« Annuler » ne remet rien)
  { nom: 'groupe-annuler-vide', lettre: 'T2', scenarios: ['groupe'], editions: [{ fichier: MODULE, de: 'toastAnnulable(dit, function () { gfDefaireGroupe(ecrit.id, ecart, autres ? pistesAvant : null); });', vers: 'toastAnnulable(dit, function () {});' }] },
  // (la ligne dit l activite touchee, pas celle qui coince)
  { nom: 'groupe-ligne-muette', lettre: 'T3', scenarios: ['groupe'], editions: [{ fichier: MODULE, de: "          : { minute: m, mode: mode, passe: false, texte: v.cle ? gfNeTientPas(gfNomDeCle(r, v.cle), gfActiviteDeCle(v.cle), v.heure || '', v.plancher ? 'déjà passé, il est ' + gpHeure(currentTimeDecimal()) + '.' : v.raison) : gfNeTientPas('Tout le groupe', '', '', v.raison) });", vers: '          : { minute: m, mode: mode, passe: false, texte: gfNeTientPas(p.point.nom, p.point.activityId, heure, v.raison) });' }] },
  // (l avis tait l activite et l heure qui coincent)
  { nom: 'groupe-avis-muet', lettre: 'T4', scenarios: ['groupe'], editions: [{ fichier: MODULE, de: "    var texte = (lu.cle ? gfNeTientPas(gfNomDeCle(r, lu.cle), gfActiviteDeCle(lu.cle), String(lu.heure || ''), gfPhraseErreur(erreur)) : gfPhraseErreur(erreur)).replace(/\\s*$/, '');", vers: '    var texte = gfPhraseErreur(erreur);' }] },
  // (Entree ne fait que juger : l heure qui passe ne s enregistre plus au clavier)
  { nom: 'minute-entree-morte', lettre: 'M1', scenarios: ['minute'], editions: [{ fichier: MODULE, de: '    if (p.juge && p.juge.passe === true && p.juge.minute === m && p.juge.mode === p.mode) { gfValiderPop(); return; }\n', vers: '' }] },
  // (« Tout le groupe » juge comme « Cette activité » : la 2e partie de Manon rebloque son 16:00, la demande d Ansar)
  { nom: 'groupe-juge-comme-seul', lettre: 'T1', scenarios: ['groupe'], editions: [{ fichier: MODULE, de: "    if (p.mode === 'groupe') { gfRemplirGroupe(r); return; }\n", vers: '' }] },
  // (un toucher sur une heure du groupe ne part pas)
  { nom: 'groupe-toucher-mort', lettre: 'T2', scenarios: ['groupe'], editions: [{ fichier: MODULE, de: '      if (r && ve && ve.passe) gfEnregistrerGroupe(r, point, offset, e);\n', vers: '' }] },
  // (le clavier du telephone qui reduit la fenetre ferme la pop-up, champ en main)
  { nom: 'telephone-clavier-ferme', lettre: 'D1', scenarios: ['telephone'], editions: [{ fichier: MODULE, de: "    if (p && actif && p.el.contains(actif) && actif.matches && actif.matches('[data-gf-hp-champ]')) { gfPoserPop(true); return; }\n", vers: '' }] },
  // (la page qui defile laisse la pop-up en l air)
  { nom: 'telephone-defile-reste', lettre: 'D1', scenarios: ['telephone'], editions: [{ fichier: MODULE, de: '    if (!p || (a && Math.abs(a.getBoundingClientRect().top - p.haut) < 8)) return;\n', vers: '    if (true) return;\n' }] },
  // (« Tout le groupe » sur un grand groupe pose : le groupe 2 reste a son heure pendant que les autres passent a +30 min, la moitie du dossier)
  { nom: 'tout-le-groupe-sauf-le-groupe-2', lettre: 'T5', scenarios: ['grand'], editions: [{ serveur: true, fichier: 'lib/decaler-le-groupe.js', de: '  if (Array.isArray(plan.resourceBlocks)) sortie.resourceBlocks = plan.resourceBlocks.map((b) => decalerUnBloc(b, ecart));', vers: '  if (Array.isArray(plan.resourceBlocks)) sortie.resourceBlocks = plan.resourceBlocks.map((b) => (Number(b.sousGroupe) === 2 ? b : decalerUnBloc(b, ecart)));' }] },
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
    if (nom === 'minute') await scenarioMinute(browser);
    if (nom === 'groupe') await scenarioGroupe(browser);
    if (nom === 'grand') await scenarioGrandGroupe(browser);
    if (nom === 'telephone') await scenarioTelephone(browser);
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, liste(process.env.HG_SCENARIOS) || ['pop', 'souris', 'doigt', 'ligne', 'gele', 'fiche', 'vagues', 'minute', 'groupe', 'grand', 'telephone']);
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

// LES PISTES ET LES ARMES SUIVENT LE GROUPE, SUR PLACE (2026-11-18, refait le 2026-11-20).
//
// Ansar, 18/11 : « quand on passe a plus de 6joueurs c normalement 2pistes etc
// faut que chaque fois quon change ça change aussi tu vois automatiquement ».
// Puis le 20/11, sur la carte qui le disait : « ça montre fait trop ia sa mere et
// c super moche genre ça nous redirige vers un autre truc ça nous sort et tout nn
// faut tout direct ». La regle : ou que le nombre de joueurs change (Modifier : le
// champ du haut, ses − et +, le Programme ; la bulle « Ils sont N » ; Reserver), les
// pistes suivent tout de suite par la regle commune (assets/pinlane-pistes.js, sa
// graine), et ce sont les pastilles des pistes qui le montrent, en place : celle
// qui arrive et celle qui part s eclairent un instant. Plus de carte, d icone, de
// phrase, de « OK » ni de « Modifier » ; plus de renvoi vers une autre fenetre.
//   [A1] Modifier, le champ du haut : 6 puis 5 joueurs ne bouge rien, 5 puis 8 pose
//        les pistes 5 et 6 (l etat tout de suite, les pastilles la frappe calmee),
//        la 6 s eclaire en arrivant ; aucune carte ; « + » bouge les pastilles tout
//        de suite ; Enregistrer ecrit ces pistes en base ;
//   [A2] Modifier, le Programme (les joueurs du bowling d une visite) : 8 puis 5
//        rend une piste tout de suite, sa pastille s eclaire en partant ; 5 puis 8 :
//        elle revient, et s eclaire en arrivant ;
//   [A3] LE GROUPE QUI BAISSE (2026-11-19, la decision d Ansar apres Gembloux) :
//        8 puis 5 joueurs, une piste suffit, l autre part toute seule ; sa pastille
//        se touche pour la remettre ; Enregistrer ecrit ce qui est a l ecran ;
//   [A4] « Seulement ces pistes, à la main » cochee : le groupe baisse, rien ne
//        bouge, rien ne s eclaire, et le serveur garde les pistes ;
//   [A5] des pistes posees a la main : rien ne bouge ni ne s eclaire a la hausse ;
//   [A6] rien ne s eclaire quand le nombre de pistes ne change pas ;
//   [A7] le laser : la ligne de sa rangee dit les vagues et suit le groupe en
//        place, « 2 vagues de 12 armes » pour 24 sur 20 armes, « 1 vague de 24
//        armes » sur 30 armes ;
//   [A8] Reserver : le groupe change, le ticket dit ses pistes, et aucune carte
//        n apparait dans la fenetre (ni la zone qui la portait) ;
//   [A9] Reserver : un nombre de pistes pose a la main survit au groupe qui change ;
//   [A10] taper « 1 » puis « 8 » (18 joueurs) : les pastilles ne montrent jamais
//        une piste, une seule pastille s eclaire, celle qui arrive pour 18 ;
//   [A11] le focus reste dans le champ qu on tape ; le lecteur d ecran entend les
//        pistes (zone polie, « Pistes 5 et 6 ») ; une pastille se touche toujours ;
//   [A12] le serveur a le dernier mot : son calcul a blanc ecrit d autres pistes, la
//        barre du bas le dit ; une piste qu il est seul a savoir prise, il refuse ;
//   [A13] au telephone (375 px), sur tablette (768 px) et a 1280 px : rien ne
//        deborde, « Enregistrer » se voit et se touche, les pastilles font 44 px au
//        doigt ;
//   [A14] l heure du bowling changee sur une piste prise : la piste libre que la
//        regle prend part tout de suite avec le bowling deplace (pastilles, barre
//        du bas), le serveur valide, Enregistrer l ecrit en base ;
//   [A16] la baisse d un grand groupe : 18 joueurs sur les pistes 5 a 7, la frappe
//        « 12 » (1 puis 2) : deux pistes parmi les siennes, jamais une autre,
//        jamais une seule a l ecran ; au telephone aussi ;
//   [A17] le serveur ecrit les pistes rendues et ne les remet pas en replanifiant :
//        la ligne et le plan du bowling, apres Modifier comme apres le compte ;
//   [A18] « Ils sont N », la case orange du planning (le compte a l arrivee) : la
//        bulle montre les pastilles « Pistes » du groupe, 10 puis 6 en rend une
//        (elle s eclaire en partant), sans carte ni « Modifier » ; Enregistrer
//        ecrit le compte, la note et le toast le disent ; une pastille touchee dans
//        la bulle part avec le compte, sans ouvrir la fiche ; au telephone la
//        bulle tient dans l ecran, rien sous 12 px, pastilles de 44 px ;
//   [A19] le laser a la baisse : 20 puis 12 joueurs sur 12 armes, la ligne dit
//        « 1 vague de 12 armes », et le serveur planifie une vague ;
//   [M1] mouvement reduit : les pastilles suivent, rien ne s anime ;
//   [G1] la regle commune avec une graine : elle garde la graine, donne la
//        voisine de paire, choisit parmi la graine quand il y en a trop (le
//        meilleur bloc, juge sur toutes les pistes libres) ; la console complete
//        une piste cliquee par la regle, plus « la premiere libre » ;
//   [J1] aucune erreur JS.
// La console reelle (scripts/planning-v3-fixtures.js, journee « pic » de Fun
// Galaxy Libramont, samedi 16 janvier 2027 a 15:10) ; ses PATCH et ses calculs a
// blanc partent au VRAI handler api/staff-reservations.js, sur la base en memoire
// de scripts/reserver-banc.js (aucune base reelle, aucun reseau).
// --contre-preuves : chaque garde retiree (en memoire ; le disque n est jamais
// touche) fait rougir sa lettre ; chaque ancre existe une fois et une seule.
//   AV_MUTATIONS : un sous-ensemble ; AV_BAVARD : les lignes des contre-preuves ;
//   AV_CAPTURES=<dossier> : les images, cas par cas ; AV_SCENARIOS : un sous-ensemble.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
// La base en memoire et le faux 'pg' s installent au require, avant tout
// module de lib/ (aucune base reelle n est jamais ouverte).
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_ATTRIBUTION_PORT || 5463);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const REGLE = 'assets/pinlane-pistes.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);
const CAPTURES = process.env.AV_CAPTURES || '';
// Les ecrans demandes : le telephone de 375 px, la tablette en hauteur, un portable de 1280 px.
FX.APPAREILS['telephone-375'] = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-BE' };

const MASSON = 1638; // bowling 18:00, 1 h, piste 5, 6 joueurs (a 18:00 les pistes 6, 7 et 8 sont libres)
const KEVIN = 1623; // bowling 18:30, 1 h, pistes 3 et 4, 8 joueurs
const COLLEGUES = 1622; // visite : bowling 8 (pistes 1 et 2 a 18:00), laser 8, minigolf 8
const JEUNESSE = 1620; // laser 17:30, 14 joueurs, deux parties
const JACQUES = 1621; // bowling 17:00, 1 h, piste 3, 4 joueurs (la 3 est prise a 18:30 par les Amis de Kevin)
const TEAM = 1627; // bowling 20:00, 2 h, pistes 5, 6 et 7, 18 joueurs (la 8 est libre)
const PIERRE = 1631; // bowling 22:00, 1 h 30, pistes 1 et 2, 10 joueurs, arrives (« Ils sont 10 »)
const ROMAIN = 1630; // laser 21:30, 20 joueurs, deux parties
const CALME = 900; // le calme d une frappe (600 ms, PISTES_CALME_MS), plus une marge

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
function enBase(id) {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {});
  return {
    pax: Number(row.pax),
    pistes: (row.lanes || []).map(Number).join(','),
    bowling: (plan.resourceBlocks || []).filter((b) => b && b.resourceType === 'bowling_lane').map((b) => `${b.startTime}[${(b.lanes || []).join(',')}]`).join(' '),
    // (le laser : une entree par depart, « partie.vague/vagues:joueurs »)
    laser: (plan.resourceBlocks || []).filter((b) => b && b.resourceType === 'laser_arena').map((b) => `${b.countIndex}.${b.groupWaveIndex}/${b.groupWaveCount}:${b.players}`).join(' '),
    notes: String(row.notes || '').split('\n').filter((l) => l.startsWith('[equipe] ')).map((l) => { try { return JSON.parse(l.slice(9)); } catch (e) { return null; } }).filter(Boolean),
  };
}
const centre = () => require(path.join(ROOT, 'lib/ops-knowledge.js')).getCenter('libramont');

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
// Ce que les pastilles montrent, une entree par changement (« 3,4 », « 3,4,5 ») ;
// et chaque pastille qui s anime (« +6 » : elle arrive, « -7 » : elle part).
function guetterPistes(selecteur) {
  window.__vuesPistes = [];
  window.__eclats = [];
  const lire = () => {
    const z = document.querySelector(selecteur);
    if (!z) return;
    const t = Array.from(z.querySelectorAll('.lane-chip.is-on')).map((b) => Number(b.textContent)).join(',');
    const vues = window.__vuesPistes;
    if (vues[vues.length - 1] !== t) vues.push(t);
  };
  lire();
  new MutationObserver(lire).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  if (!window.__animeGuette) {
    window.__animeGuette = true;
    const animer = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.classList && this.classList.contains('lane-chip')) window.__eclats.push(`${this.classList.contains('is-on') ? '+' : '-'}${this.textContent.trim()}`);
      return animer.apply(this, args);
    };
  }
}

// Ce que la carte d avant laissait : sa zone, la carte, ses gestes, sa quille.
const CARTE = '#editAttribution, #rsAttrZone, .attr-carte:not(.ordre-carte), [data-attr-geste], .attr-icone, [data-compte-focus="pistes"]';

async function lireModifier(carte) {
  // (deux images : l eclat d une pastille part a l image suivante)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const texte = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const actif = document.activeElement;
  return {
    fermee: !document.querySelector('#posOverlay .edit-modal') || !state.selectedRes,
    lanes: state.editState ? String(state.editState.lanesStr || '') : null,
    pax: state.editState ? Number(state.editState.pax) : null,
    puces: Array.from(document.querySelectorAll('#posOverlay .fm .lane-picker .lane-chip.is-on')).map((b) => Number(b.textContent)).join(','),
    cartes: document.querySelectorAll(carte).length,
    focus: actif ? (actif.id || (actif.classList.contains('lane-chip') ? `piste-${actif.textContent.trim()}` : actif.tagName)) : '',
    dites: texte(document.getElementById('editPistesDites')),
    poli: (() => { const z = document.getElementById('editPistesDites'); return z ? `${z.getAttribute('role')}|${z.getAttribute('aria-live')}` : ''; })(),
    vagues: texte(document.querySelector('#posOverlay [data-laser-vagues]')),
    verdict: texte(document.getElementById('editVerdict')),
    modifs: texte(document.getElementById('editModifs')),
    vues: (window.__vuesPistes || []).slice(),
    eclats: (window.__eclats || []).slice(),
    toast: ((document.getElementById('toast') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  };
}

async function verdictPose(page) {
  await page.waitForTimeout(120);
  await page.waitForFunction(() => { const z = document.getElementById('editVerdict'); return Boolean(z) && !z.classList.contains('is-calcul') && !verdictEdition().enCours; }, null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(150);
}

// Le calme de la frappe, puis le verdict du serveur.
async function calme(page) {
  await page.waitForTimeout(CALME);
  await verdictPose(page);
}

// Les gestes du comptoir.
// (un geste qui ne trouve pas sa cible echoue vite : une contre-preuve n attend pas 15 s)
const VITE = { timeout: 5000 };
const champJoueurs = (valeur) => async (page) => { await page.fill('#posOverlay #editPaxInput', String(valeur), VITE); };
// La frappe du comptoir, touche par touche, le nombre d avant selectionne.
const taperJoueurs = (texte) => async (page) => {
  await page.focus('#posOverlay #editPaxInput', VITE);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(String(texte), { delay: 160 });
};
const plusUn = async (page) => { await page.click('#posOverlay [aria-label="Un joueur de plus"]', VITE); };
const joueursProgramme = (id, sens, fois) => async (page) => {
  for (let k = 0; k < fois; k += 1) {
    await page.locator(`#posOverlay .fm-act[data-edit-activity="${id}"] .dossier-activity-count button[aria-label$="${sens > 0 ? 'ajouter un joueur' : 'retirer un joueur'}"]`).click(VITE);
    await page.waitForTimeout(60);
  }
};
const piste = (n) => async (page) => { await page.click(`#posOverlay .fm .lane-picker .lane-chip[onclick="toggleEditLane(${n})"]`, VITE); await page.waitForTimeout(100); };
// La piste rendue, remise a la main (celle des deux qui manque).
const remettre = (deux) => async (page) => {
  const manque = await page.evaluate((d) => d.find((x) => !String(state.editState.lanesStr).split(',').includes(String(x))), deux);
  if (manque) await piste(manque)(page);
};
const heure = (cle, valeur) => async (page) => {
  await page.locator(`#posOverlay [data-heure-cle="${cle}"]`).first().click(VITE);
  await page.fill(`#posOverlay [data-heure-champ="${cle}"]`, valeur, VITE);
};
const attendre = async (page) => { await calme(page); };

async function photo(page, nom, selecteur = '#posOverlay .edit-modal') {
  if (!CAPTURES || mutation || !nom) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  // (sans selecteur : l ecran entier, la bulle du compte posee sur son planning)
  if (selecteur === null) { await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) }); return; }
  const m = page.locator(selecteur);
  if (await m.count()) await m.first().screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  else await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

async function enregistrer(page) {
  await page.locator('#posOverlay .es-save').click();
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(120);
    const bouton = page.locator('.staff-confirm [data-role="confirm-ok"]');
    if (await bouton.count()) await bouton.click();
    const fini = await page.evaluate(() => !document.querySelector('#posOverlay .edit-modal') || !state.selectedRes || /Pas enregistré/.test((document.getElementById('editVerdict') || {}).textContent || ''));
    if (fini) break;
  }
  await page.waitForTimeout(250);
}

// La console montee sur la journee, la base semee, le vrai serveur branche.
async function monterConsole(browser, { appareil = 'ordinateur', armes = 0, enPlus = [], reecrireBlanc = null, mouvementReduit = false } = {}) {
  B.semer([...FIXTURE.staffState.reservations.map(ligneDepuis), ...enPlus]);
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const laser = centre().resources.laser;
  const armesAvant = laser.weaponCount;
  if (armes) laser.weaponCount = armes;
  const patchs = [];
  const blancs = [];
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil, theme: 'light', port: PORT, heure: '15:10', mouvementReduit,
    avantChargement: async (p) => {
      await p.exposeFunction('__fixtureServeur', async (corps) => { patchs.push(corps); return serveur.appeler('PATCH', '/api/staff-reservations', corps); });
      await p.exposeFunction('__fixtureBlanc', async (corps) => {
        blancs.push(corps);
        const rep = await serveur.appeler('POST', '/api/staff-reservations', corps);
        return reecrireBlanc ? reecrireBlanc(rep, corps) : rep;
      });
    },
  });
  if (armes) {
    // (la meme arene dans la console : la config du centre et celle du comptoir)
    await page.evaluate((n) => {
      const c = getAvailabilitySessionCenter();
      if (c && c.resources && c.resources.laser) c.resources.laser.weaponCount = n;
      /* global centerScheduleConfig */
      if (centerScheduleConfig && centerScheduleConfig.resources && centerScheduleConfig.resources.laser) centerScheduleConfig.resources.laser.weaponCount = n;
    }, armes);
  }
  return { ctx, page, erreurs, patchs, blancs, serveur, fin: async () => { laser.weaponCount = armesAvant; await ctx.close(); } };
}

// Un cas dans Modifier : la fiche ouverte, les gestes, la lecture.
async function jouerModifier(browser, { id, gestes = [], appareil = 'ordinateur', armes = 0, enPlus = [], reecrireBlanc = null, nom = '', mesure = null, clic = false, mouvementReduit = false }) {
  const c = await monterConsole(browser, { appareil, armes, enPlus, reecrireBlanc, mouvementReduit });
  const { page } = c;
  try {
    await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
    await page.waitForTimeout(200);
    await page.evaluate(guetterPistes, '#posOverlay .fm .lane-picker');
    const ouverture = await page.evaluate(lireModifier, CARTE);
    const lus = [];
    let photographiee = false;
    for (const g of gestes) {
      if (g === cliche) { await photo(page, nom); photographiee = true; continue; }
      if (typeof g === 'string') { lus.push(await page.evaluate(lireModifier, CARTE)); continue; }
      await g(page);
    }
    const final = await page.evaluate(lireModifier, CARTE);
    if (nom && !photographiee) await photo(page, nom);
    const mesures = mesure ? await mesure(page) : null;
    let apresClic = null;
    if (clic) { await enregistrer(page); apresClic = await page.evaluate(lireModifier, CARTE); }
    return { ouverture, lus, final, mesures, apresClic, base: enBase(id), patchs: c.patchs.slice(), blancs: c.blancs.slice(), erreurs: c.erreurs.slice() };
  } finally {
    await c.fin();
  }
}
const lire = 'lire'; // un point de lecture entre deux gestes
const cliche = 'cliche'; // l image du cas, a ce moment-la (AV_CAPTURES)
const nbPistes = (texte) => String(texte || '').split(',').filter(Boolean).length;

async function scenarioModifier(browser) {
  // [A1] Le champ du haut : 6 puis 5 (rien ne bouge), 5 puis 8 (une piste de plus), Enregistrer.
  const a = await jouerModifier(browser, {
    id: MASSON, clic: true, nom: 'modifier-5-a-8',
    gestes: [champJoueurs(5), attendre, lire, champJoueurs(8), lire, attendre, lire, cliche],
  });
  const [cinq, aussitot, huit] = a.lus;
  ok(a.ouverture.lanes === '5' && a.ouverture.puces === '5' && a.ouverture.cartes === 0, '[A1] a l ouverture : la piste 5 cochee, aucune carte', a.ouverture);
  ok(cinq.lanes === '5' && cinq.puces === '5' && cinq.eclats.length === 0 && cinq.vues.length === 1, '[A6] 6 puis 5 joueurs : une piste suffit toujours, rien ne bouge ni ne s eclaire', cinq);
  ok(aussitot.lanes === '5,6' && aussitot.puces === '5', '[A1] 5 puis 8 : les pistes 5 et 6 dans l etat tout de suite, les pastilles attendent la fin de la frappe', aussitot);
  ok(huit.puces === '5,6' && huit.eclats.join() === '+6' && huit.cartes === 0,
    '[A1] la frappe calmee : les pastilles 5 et 6 cochees, la 6 s eclaire en arrivant, aucune carte ni bouton', huit);
  ok(huit.focus === 'editPaxInput' && huit.poli === 'status|polite' && huit.dites === 'Pistes 5 et 6',
    '[A11] le focus reste dans le champ Joueurs ; le lecteur d ecran entend « Pistes 5 et 6 »', huit);
  ok(a.apresClic && a.apresClic.fermee && a.base.pistes === '5,6' && a.base.pax === 8, '[A1] Enregistrer : 8 joueurs sur les pistes 5 et 6, en base', { base: a.base, apres: a.apresClic && a.apresClic.verdict });

  // [A1] « + » : rien n attend, les pastilles suivent au toucher ; [A11] une pastille se touche.
  const p1 = await jouerModifier(browser, { id: MASSON, gestes: [plusUn, lire, piste(7), lire] });
  const [plus, touche] = p1.lus;
  ok(plus.pax === 7 && plus.lanes === '5,6' && plus.puces === '5,6' && plus.eclats.join() === '+6' && plus.cartes === 0,
    '[A1] « + » (6 puis 7 joueurs) : la piste 6 cochee au toucher, sans attendre, et elle s eclaire', plus);
  ok(touche.lanes === '5,6,7' && touche.puces === '5,6,7' && touche.focus === 'piste-7', '[A11] la pastille 7 touchee s ajoute, le focus reste sur elle', touche);

  // [A2] Le Programme : les joueurs du bowling des Collegues, 8 puis 5 (une piste part
  // toute seule), puis 5 puis 8 (elle revient).
  const p = await jouerModifier(browser, {
    id: COLLEGUES, nom: 'modifier-programme',
    gestes: [joueursProgramme('bowling', -1, 3), lire, joueursProgramme('bowling', 1, 3), lire, cliche],
  });
  const [baisse, remonte] = p.lus;
  const garde = baisse.lanes;
  const rendue = ['1', '2'].find((x) => x !== garde);
  ok(p.ouverture.lanes === '1,2' && ['1', '2'].includes(garde) && baisse.puces === garde && baisse.eclats.join() === `-${rendue}` && baisse.cartes === 0,
    '[A2] Programme, 8 puis 5 joueurs au bowling : une piste part tout de suite, sa pastille s eclaire en partant, aucune carte', { ouverture: p.ouverture.lanes, baisse });
  ok(remonte.lanes === '1,2' && remonte.puces === '1,2' && remonte.eclats.join() === `-${rendue},+${rendue}`,
    '[A2] Programme, 5 puis 8 : la piste revient tout de suite et s eclaire en arrivant', remonte);

  // [A3] Le groupe qui baisse : 8 puis 5, une piste part toute seule ; sa pastille la
  // remet ; Enregistrer ecrit ce qui est a l ecran (la main a le dernier mot).
  const g = await jouerModifier(browser, { id: KEVIN, nom: 'modifier-8-a-5', clic: true, gestes: [champJoueurs(5), attendre, lire, cliche, remettre([3, 4]), lire] });
  const [k1, k2] = g.lus;
  const gardeK = k1.lanes;
  const rendueK = ['3', '4'].find((x) => x !== gardeK);
  ok(['3', '4'].includes(gardeK) && k1.puces === gardeK && k1.eclats.join() === `-${rendueK}` && k1.cartes === 0,
    '[A3] 8 puis 5 joueurs : une piste part toute seule, sa pastille s eclaire en partant, aucune carte', k1);
  ok(k2.lanes === '3,4' && k2.puces === '3,4' && g.apresClic && g.apresClic.fermee && g.base.pax === 5 && g.base.pistes === '3,4',
    '[A3] la pastille rendue, touchee, revient : Enregistrer ecrit 5 joueurs sur les pistes 3 et 4', { lu: k2, base: g.base });

  // [A4] « Seulement ces pistes, à la main » : le groupe baisse, rien ne bouge.
  const h = await jouerModifier(browser, { id: KEVIN, nom: 'modifier-main', clic: true, gestes: [async (pg) => { await pg.click('#posOverlay #editPistesMain'); }, champJoueurs(5), attendre, lire] });
  ok(h.lus[0].lanes === '3,4' && h.lus[0].puces === '3,4' && h.lus[0].eclats.length === 0,
    '[A4] « Seulement ces pistes, à la main » puis 5 joueurs : les pistes 3 et 4 restent, rien ne s eclaire', h.lus[0]);
  ok(h.apresClic && h.apresClic.fermee && h.base.pax === 5 && h.base.pistes === '3,4' && h.base.bowling === '18:30[3,4]',
    '[A4] Enregistrer : 5 joueurs sur les pistes 3 et 4, le serveur les garde', { base: h.base, apres: h.apresClic && h.apresClic.verdict });

  // [A5] Des pistes posees a la main : rien ne bouge a la hausse.
  const mn = await jouerModifier(browser, { id: MASSON, gestes: [async (pg) => { await pg.click('#posOverlay #editPistesMain'); }, champJoueurs(8), attendre, lire] });
  ok(mn.lus[0].lanes === '5' && mn.lus[0].puces === '5' && mn.lus[0].eclats.length === 0, '[A5] « Seulement ces pistes, à la main » puis 8 joueurs : la piste 5 seule, rien ne s eclaire', mn.lus[0]);

  // [A10] Taper « 1 » puis « 8 » : jamais une piste a l ecran.
  const t = await jouerModifier(browser, { id: KEVIN, gestes: [taperJoueurs('18'), attendre, lire] });
  const tl = t.lus[0];
  ok(tl.pax === 18 && /^3,4,\d$/.test(tl.lanes) && tl.puces === tl.lanes && tl.vues.every((v) => nbPistes(v) !== 1) && tl.eclats.length === 1 && tl.eclats[0] === `+${tl.lanes.split(',')[2]}`,
    '[A10] « 1 » puis « 8 » : les pastilles ne montrent jamais une piste, une seule s eclaire (celle de 18 joueurs)', tl);
  ok(tl.focus === 'editPaxInput', '[A11] apres la frappe, le focus est toujours dans le champ Joueurs', tl.focus);

  // [A12] Le serveur a le dernier mot. Son calcul a blanc ecrit d autres pistes (un
  // poste voisin les a prises, le moteur a replace le groupe) : la barre dit l ecart.
  const autres = (rep, corps) => {
    if (!corps.modification || !rep.json || !rep.json.reservation) return rep;
    const r = JSON.parse(JSON.stringify(rep.json.reservation));
    r.lanes = [7, 8];
    ((r.opsPlan && r.opsPlan.resourceBlocks) || []).forEach((b) => { if (b.resourceType === 'bowling_lane') b.lanes = [7, 8]; });
    return { ...rep, json: { ...rep.json, reservation: r } };
  };
  const s = await jouerModifier(browser, { id: MASSON, reecrireBlanc: autres, gestes: [champJoueurs(8), attendre, lire] });
  ok(s.lus[0].lanes === '5,6' && s.lus[0].puces === '5,6' && /Ce sera pistes 7, 8, pas 5, 6/.test(s.lus[0].verdict) && s.lus[0].cartes === 0,
    '[A12] le calcul a blanc ecrit les pistes 7 et 8 : la barre du bas dit l ecart, sans carte', s.lus[0]);
  // Une piste que seul le serveur sait prise : il refuse, la barre le dit avant le clic.
  const serveurSeul = B.ligne(9901, { date: JOUR, start_time: '18:00', lanes: [6], name: 'Groupe connu du seul serveur', pax: 4, status: 'pending' });
  const sr = await jouerModifier(browser, { id: MASSON, enPlus: [serveurSeul], gestes: [champJoueurs(8), attendre, lire] });
  ok(/^Ne passera pas/.test(sr.lus[0].verdict) && sr.lus[0].puces === '5,6',
    '[A12] la 6 prise pour le seul serveur : le refus se lit dans la barre, avant le clic', sr.lus[0]);

  ok([a, p1, p, g, h, mn, t, s, sr].every((x) => !x.erreurs.length), '[J1] aucune erreur JS (Modifier)', [a, p1, p, g, h, mn, t, s, sr].flatMap((x) => x.erreurs).slice(0, 3));
}

// [M1] Mouvement reduit : les pastilles suivent, rien ne s anime.
async function scenarioReduit(browser) {
  const r = await jouerModifier(browser, { id: MASSON, mouvementReduit: true, gestes: [plusUn, lire] });
  ok(r.lus[0].puces === '5,6' && r.lus[0].eclats.length === 0, '[M1] mouvement reduit : « + » coche la piste 6 sans aucune animation', r.lus[0]);
  ok(!r.erreurs.length, '[J1] aucune erreur JS (mouvement reduit)', r.erreurs.slice(0, 3));
}

// [A16] [A17] La baisse d un grand groupe, et ce que le serveur en ecrit.
async function scenarioBaisse(browser) {
  const t = await jouerModifier(browser, { id: TEAM, clic: true, nom: 'modifier-baisse', gestes: [taperJoueurs('12'), attendre, lire] });
  const lu = t.lus[0];
  const gardees = lu.lanes.split(',');
  const rendue = ['5', '6', '7'].find((x) => !gardees.includes(x));
  ok(t.ouverture.lanes === '5,6,7' && lu.pax === 12 && gardees.length === 2 && gardees.every((x) => ['5', '6', '7'].includes(x)) && lu.puces === lu.lanes,
    '[A16] 18 puis « 12 » tape (1 puis 2) : deux pistes parmi les siennes (5, 6, 7), jamais une autre', { ouverture: t.ouverture.lanes, lu: lu.lanes, puces: lu.puces });
  ok(lu.vues.every((v) => nbPistes(v) >= 2) && lu.eclats.join() === `-${rendue}` && lu.cartes === 0,
    '[A16] jamais une seule piste a l ecran, une seule pastille s eclaire (celle qui part), aucune carte', lu);
  ok(lu.focus === 'editPaxInput', '[A16] le focus reste dans le champ Joueurs', lu.focus);
  ok(t.apresClic && t.apresClic.fermee && t.base.pax === 12 && t.base.pistes === gardees.join(',') && t.base.bowling === `20:00[${gardees.join(',')}]`,
    '[A17] Enregistrer : le serveur ecrit 12 joueurs sur ces deux pistes, la piste rendue ne revient pas dans le plan', { base: t.base, gardees, apres: t.apresClic && t.apresClic.verdict });
  // Au telephone.
  const tel = await jouerModifier(browser, { id: TEAM, appareil: 'telephone-375', nom: 'modifier-baisse-telephone', gestes: [champJoueurs(12), attendre, lire] });
  ok(nbPistes(tel.lus[0].lanes) === 2 && tel.lus[0].puces === tel.lus[0].lanes && tel.lus[0].eclats.length === 1 && tel.lus[0].cartes === 0,
    '[A16] au telephone : la meme baisse, les memes pastilles', tel.lus[0]);
  ok([t, tel].every((x) => !x.erreurs.length), '[J1] aucune erreur JS (baisse)', [t, tel].flatMap((x) => x.erreurs).slice(0, 3));
}

// [A18] [A17] « Ils sont N », la case orange du planning : le compte a l arrivee.
function lireBulle(carte) {
  const pop = document.getElementById('comptePop');
  if (!pop) return { ouverte: false, fiche: Boolean(document.querySelector('#posOverlay .edit-modal')) };
  const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const ok = pop.querySelector('.compte-pop__ok');
  const b = pop.getBoundingClientRect();
  const k = ok ? ok.getBoundingClientRect() : null;
  const auCentre = k ? document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2) : null;
  let petits = 0;
  const marche = document.createTreeWalker(pop, NodeFilter.SHOW_TEXT);
  for (let n = marche.nextNode(); n; n = marche.nextNode()) if (n.textContent.trim() && n.parentElement && n.parentElement.offsetParent !== null && parseFloat(getComputedStyle(n.parentElement).fontSize) < 12) petits += 1;
  const puces = Array.from(pop.querySelectorAll('.compte-pop__puces .lane-chip'));
  return {
    ouverte: true,
    fiche: Boolean(document.querySelector('#posOverlay .edit-modal')),
    n: Number(txt(pop.querySelector('output'))),
    etiquette: txt(pop.querySelector('#comptePopPistes')),
    puces: puces.filter((x) => x.classList.contains('is-on')).map((x) => Number(x.textContent)).join(','),
    hauteurs: puces.map((x) => Math.round(x.getBoundingClientRect().height)),
    cartes: pop.querySelectorAll(carte).length,
    enregistrer: Boolean(ok && auCentre && auCentre.closest('.compte-pop__ok') === ok),
    dedans: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight,
    erreur: txt(pop.querySelector('.compte-pop__erreur')),
    eclats: (window.__eclats || []).slice(),
    petits,
  };
}
async function ouvrirCompte(page, id) {
  const bouton = page.locator(`[data-gf-id="${id}"] [data-compte-id]`).first();
  await bouton.scrollIntoViewIfNeeded(VITE);
  await bouton.click(VITE);
  await page.waitForSelector('#comptePop', VITE);
  await page.evaluate(guetterPistes, '#comptePop .compte-pop__puces');
}
async function pasCompte(page, delta, fois) {
  for (let i = 0; i < fois; i += 1) await page.locator(`#comptePop [data-compte-pas="${delta}"]`).click(VITE);
  await page.waitForTimeout(150);
}
const toastDe = (page) => page.evaluate(() => ((document.getElementById('toast') || {}).textContent || '').replace(/\s+/g, ' ').trim());
async function enregistrerCompte(page) {
  await page.locator('#comptePop .compte-pop__ok').click(VITE);
  await page.waitForFunction(() => !document.getElementById('comptePop'), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(250);
}

async function scenarioCompte(browser) {
  // Au bureau : 10 puis 6, une piste part dans la bulle, Enregistrer l ecrit.
  const c = await monterConsole(browser, {});
  const vu = {};
  try {
    await ouvrirCompte(c.page, PIERRE);
    vu.dix = await c.page.evaluate(lireBulle, CARTE);
    await pasCompte(c.page, -1, 4);
    vu.six = await c.page.evaluate(lireBulle, CARTE);
    await photo(c.page, 'compte', null);
    await enregistrerCompte(c.page);
    vu.apres = await c.page.evaluate(lireBulle, CARTE);
    vu.toast = await toastDe(c.page);
    vu.base = enBase(PIERRE);
    vu.envoi = c.patchs[c.patchs.length - 1] || {};
    vu.erreurs = c.erreurs.slice();
  } finally { await c.fin(); }
  const garde = vu.six.puces;
  const rendue = ['1', '2'].find((x) => x !== garde);
  ok(vu.dix.ouverte && vu.dix.n === 10 && vu.dix.etiquette === 'Pistes' && vu.dix.puces === '1,2' && vu.dix.cartes === 0,
    '[A18] la bulle s ouvre sur « Ils sont 10 », ses pastilles « Pistes » 1 et 2 cochees, aucune carte', vu.dix);
  ok(vu.six.n === 6 && ['1', '2'].includes(garde) && vu.six.eclats.join() === `-${rendue}` && vu.six.cartes === 0,
    '[A18] 10 puis 6 : une piste part dans la bulle, sa pastille s eclaire en partant ; ni carte ni « Modifier »', vu.six);
  ok(vu.six.enregistrer && vu.six.dedans && !vu.six.erreur, '[A18] « Enregistrer » reste libre, la bulle tient dans l ecran', vu.six);
  ok(!vu.apres.ouverte && !vu.apres.fiche && vu.envoi.compteArrivee === true && Number(vu.envoi.pax) === 6 && (vu.envoi.lanes || []).join() === garde && new RegExp(`Piste ${rendue} libérée\\.`).test(vu.toast),
    '[A18] Enregistrer : le compte part avec ses pistes, la bulle se ferme sans ouvrir la fiche, le toast dit la piste libérée', { envoi: { pax: vu.envoi.pax, lanes: vu.envoi.lanes, compte: vu.envoi.compteArrivee }, toast: vu.toast, apres: vu.apres });
  ok(vu.base.pax === 6 && vu.base.pistes === garde && vu.base.bowling === `22:00[${garde}]` && vu.base.notes.some((n) => n.compte && n.compte.de === 10 && n.compte.a === 6),
    '[A17] apres le compte, le serveur ecrit 6 joueurs sur la piste gardee, la rendue ne revient pas en replanifiant ; la note du compte est la', vu.base);

  // Une pastille touchee dans la bulle : la piste revient, et part avec le compte.
  const m = await monterConsole(browser, {});
  const mv = {};
  try {
    await ouvrirCompte(m.page, PIERRE);
    await pasCompte(m.page, -1, 4);
    mv.six = await m.page.evaluate(lireBulle, CARTE);
    const manque = ['1', '2'].find((x) => x !== mv.six.puces);
    await m.page.locator(`#comptePop [data-compte-piste="${manque}"]`).click(VITE);
    await m.page.waitForTimeout(150);
    mv.remise = await m.page.evaluate(lireBulle, CARTE);
    mv.manque = manque;
    await enregistrerCompte(m.page);
    mv.apres = await m.page.evaluate(lireBulle, CARTE);
    mv.base = enBase(PIERRE);
    mv.erreurs = m.erreurs.slice();
  } finally { await m.fin(); }
  ok(mv.remise && mv.remise.ouverte && !mv.remise.fiche && mv.remise.puces === '1,2' && mv.remise.eclats.slice(-1)[0] === `+${mv.manque}`,
    '[A18] la pastille rendue, touchee dans la bulle : pistes 1 et 2, sans quitter la bulle ni ouvrir la fiche', mv.remise);
  ok(mv.base && mv.base.pax === 6 && mv.base.pistes === '1,2' && !mv.apres.ouverte && !mv.apres.fiche,
    '[A18] Enregistrer de la bulle ecrit 6 personnes sur les pistes 1 et 2', { base: mv.base, apres: mv.apres });

  // Au telephone.
  const tel = await monterConsole(browser, { appareil: 'telephone-375' });
  const tv = {};
  try {
    await ouvrirCompte(tel.page, PIERRE);
    await pasCompte(tel.page, -1, 4);
    tv.bulle = await tel.page.evaluate(lireBulle, CARTE);
    await photo(tel.page, 'compte-telephone', null);
    tv.erreurs = tel.erreurs.slice();
  } finally { await tel.fin(); }
  ok(tv.bulle && nbPistes(tv.bulle.puces) === 1 && tv.bulle.enregistrer && tv.bulle.dedans && tv.bulle.petits === 0 && tv.bulle.hauteurs.length > 0 && tv.bulle.hauteurs.every((x) => x >= 44),
    '[A18] au telephone : les pastilles dans la bulle (44 px au doigt), « Enregistrer » libre, la bulle dans l ecran, rien sous 12 px', tv.bulle);
  ok([vu, mv, tv].every((x) => !(x.erreurs || []).length), '[J1] aucune erreur JS (compte)', [vu, mv, tv].flatMap((x) => x.erreurs || []).slice(0, 3));
}

// [A19] Le laser a la baisse : 12 armes, 20 puis 12 joueurs.
async function scenarioLaserBaisse(browser) {
  const v = await jouerModifier(browser, { id: ROMAIN, armes: 12, clic: true, nom: 'modifier-laser-baisse', gestes: [champJoueurs(12), attendre, lire] });
  ok(v.ouverture.vagues === '2 vagues de 10 armes' && v.lus[0].vagues === '1 vague de 12 armes' && v.lus[0].cartes === 0,
    '[A19] 12 armes, 20 puis 12 joueurs : la ligne du laser passe de « 2 vagues de 10 armes » a « 1 vague de 12 armes »', { ouverture: v.ouverture.vagues, lu: v.lus[0] });
  const departs = v.base.laser.split(' ').filter(Boolean);
  const parties = ((FIXTURE.staffState.reservations.find((r) => r.id === ROMAIN).opsPlan || {}).resourceBlocks || []).filter((b) => b && b.resourceType === 'laser_arena').length;
  ok(v.apresClic && v.apresClic.fermee && v.base.pax === 12 && parties > 0 && departs.length === parties && departs.every((d) => /^\d\.1\/1:12$/.test(d)),
    '[A19] Enregistrer : le serveur planifie une vague de 12 a chaque partie', { base: v.base, apres: v.apresClic && v.apresClic.verdict });
  ok(!v.erreurs.length, '[J1] aucune erreur JS (laser a la baisse)', v.erreurs.slice(0, 3));
}

async function scenarioLaser(browser) {
  // [A7] 14 puis 24 joueurs : 20 armes, deux vagues de 12 ; 30 armes, une seule vague.
  const v = await jouerModifier(browser, { id: JEUNESSE, armes: 20, nom: 'modifier-laser', gestes: [champJoueurs(24), lire, attendre, lire] });
  ok(v.ouverture.vagues === '1 vague de 14 armes' && v.lus[0].vagues === '2 vagues de 12 armes' && v.lus[1].vagues === '2 vagues de 12 armes' && v.lus[1].cartes === 0,
    '[A7] 20 armes, 14 puis 24 joueurs : la ligne du laser dit « 2 vagues de 12 armes » tout de suite, sans carte', { ouverture: v.ouverture.vagues, aussitot: v.lus[0].vagues, lu: v.lus[1] });
  const u = await jouerModifier(browser, { id: JEUNESSE, gestes: [champJoueurs(24), attendre, lire] });
  ok(u.lus[0].vagues === '1 vague de 24 armes', '[A7] 30 armes, 14 puis 24 joueurs : « 1 vague de 24 armes »', u.lus[0].vagues);
  ok([v, u].every((x) => !x.erreurs.length), '[J1] aucune erreur JS (laser)', [v, u].flatMap((x) => x.erreurs).slice(0, 3));
}

// [A14] L heure du bowling sur une piste prise : la piste libre part tout de suite avec le bowling.
async function scenarioHeure(browser) {
  const j = await jouerModifier(browser, { id: JACQUES, clic: true, nom: 'modifier-heure', gestes: [heure('bowling', '18:30'), attendre, lire, cliche] });
  const [prise] = j.lus;
  const nouvelle = prise.puces;
  ok(/^\d$/.test(nouvelle) && nouvelle !== '3' && prise.eclats.includes(`+${nouvelle}`) && prise.eclats.includes('-3') && prise.cartes === 0,
    '[A14] le bowling a 18:30, ou la piste 3 est prise : une piste libre la remplace tout de suite, les deux pastilles s eclairent, aucune carte', prise);
  ok(prise.verdict === '' && new RegExp(`Bowling 17:00 → 18:30, piste ${nouvelle}`).test(prise.modifs),
    '[A14] la barre du bas dit le bowling a 18:30 sur la nouvelle piste, le serveur le valide', prise);
  const move = (j.patchs[0] || {}).activityMove || {};
  ok(j.apresClic && j.apresClic.fermee && j.patchs.length === 1 && move.startTime === '18:30' && (move.lanes || []).join() === nouvelle && j.base.bowling === `18:30[${nouvelle}]`,
    '[A14] Enregistrer : un seul deplacement, le bowling a 18:30 sur la piste libre, en base', { patchs: j.patchs, base: j.base });
  ok(!j.erreurs.length, '[J1] aucune erreur JS (heure)', j.erreurs.slice(0, 3));
}

// [A13] Les ecrans : rien ne deborde, rien ne cache « Enregistrer », 44 px au doigt.
async function scenarioEcrans(browser) {
  const mesure = async (page) => page.evaluate(() => {
    const m = document.querySelector('#posOverlay .edit-modal');
    const corps = m.querySelector('.edit-modal-body') || m;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const save = m.querySelector('.es-save');
    const sv = save ? save.getBoundingClientRect() : null;
    const auCentre = sv ? document.elementFromPoint(sv.left + sv.width / 2, sv.top + sv.height / 2) : null;
    return {
      vw, vh,
      defile: corps.scrollWidth - corps.clientWidth,
      debordent: Array.from(m.querySelectorAll('.fm-pied, .fm-pied *, .lane-picker, .lane-picker *')).filter((n) => { const b = n.getBoundingClientRect(); return b.width && (b.right > vw + 1 || b.left < -1); }).length,
      enregistrer: Boolean(sv && sv.top >= 0 && sv.bottom <= vh && auCentre && auCentre.closest('.es-save') === save),
      pastilles: Array.from(m.querySelectorAll('.lane-picker .lane-chip')).map((b) => { const x = b.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)]; }),
    };
  });
  const vus = [];
  for (const [appareil, doigt] of [['telephone-375', true], ['tablette-portrait', true], ['portable', false]]) {
    const c = await jouerModifier(browser, { id: KEVIN, appareil, nom: `ecran-${appareil}`, gestes: [champJoueurs(13), attendre, lire], mesure });
    const d = c.mesures;
    ok(nbPistes(c.lus[0].puces) === 3 && c.lus[0].cartes === 0 && d && d.defile <= 1 && d.debordent === 0, `[A13] ${appareil} (${d && d.vw} px) : trois pistes cochees, aucune carte, rien ne deborde`, { lu: c.lus[0].puces, d });
    ok(d && d.enregistrer, `[A13] ${appareil} : « Enregistrer » se voit et se touche`, d);
    ok(d && d.pastilles.length === 8 && d.pastilles.every(([l, hh]) => hh >= (doigt ? 44 : 32) && l >= (doigt ? 44 : 32)), `[A13] ${appareil} : les pastilles des pistes se touchent${doigt ? ' au doigt (44 px)' : ''}`, d && d.pastilles);
    vus.push(c);
  }
  ok(vus.every((x) => !x.erreurs.length), '[J1] aucune erreur JS (ecrans)', vus.flatMap((x) => x.erreurs).slice(0, 3));
}

// ---------------------------------------------------------------------------
// RESERVER.
// ---------------------------------------------------------------------------
function lireReserver(carte) {
  const s = quickBookState;
  const heure = s ? ((rvHeuresDesLignes().bowling || {}).heure || s.startTime) : '';
  return {
    pax: s ? Number(s.pax) : null,
    pistes: s && rvActivites().includes('bowling') ? [...rvPistesDuBowling(heure).pistes].map(Number).sort((a, b) => a - b).join(',') : '',
    aLaMain: s ? s.pistesALaMain : null,
    ticket: ((document.getElementById('rsLignes') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    cartes: document.querySelectorAll(`#quickBookOverlay :is(${carte})`).length + (document.getElementById('rsAttrZone') ? 1 : 0),
  };
}

async function jouerReserver(browser, { ouvrir, gestes = [], appareil = 'ordinateur', armes = 0, nom = '' }) {
  const c = await monterConsole(browser, { appareil, armes });
  const { page } = c;
  try {
    await page.evaluate(ouvrir);
    await page.waitForTimeout(400);
    const lus = [];
    let photographiee = false;
    for (const g of gestes) {
      if (g === cliche) { await photo(page, nom, '#quickBookOverlay .qb-modal'); photographiee = true; continue; }
      if (typeof g === 'string') { lus.push(await page.evaluate(lireReserver, CARTE)); continue; }
      await g(page);
    }
    if (nom && !photographiee) await photo(page, nom, '#quickBookOverlay .qb-modal');
    return { lus, erreurs: c.erreurs.slice() };
  } finally {
    await c.fin();
  }
}
// Le nombre de joueurs, la ou la fenetre le demande : sa question, sinon la rangee du haut.
const nombre = (n) => async (page) => {
  const question = await page.locator('#quickBookOverlay #rsQJ').count();
  await page.click(question ? `#quickBookOverlay #rsQJ [data-pax-q="${n}"]` : `#quickBookOverlay #rsHaut [data-pax="${n}"]`, VITE);
  await page.waitForTimeout(80);
};
const autreNombre = (n) => async (page) => { await page.fill('#quickBookOverlay #qbPax', String(n), VITE); await page.dispatchEvent('#quickBookOverlay #qbPax', 'change'); await page.waitForTimeout(80); };
const pause = async (page) => { await page.waitForTimeout(CALME); };
// (sans nombre : la fenetre part de 4 joueurs et pose la question « Combien de joueurs ? »)
const ouvrirBowling = (pax) => new Function(`openQuickBook({ date: state.currentDate, startTime: '18:00', type: 'bowling'${pax ? `, pax: ${pax}` : ''} });`);

async function scenarioReserver(browser) {
  // [A8] 5 puis 8 joueurs : le ticket dit deux pistes, aucune carte.
  const r = await jouerReserver(browser, { ouvrir: ouvrirBowling(5), nom: 'reserver-5-a-8', gestes: [lire, nombre(8), pause, lire, cliche] });
  const [cinq, huit] = r.lus;
  ok(nbPistes(cinq.pistes) === 1 && cinq.cartes === 0, '[A8] Reserver a 5 joueurs : une piste, aucune carte', cinq);
  ok(nbPistes(huit.pistes) === 2 && new RegExp(`pistes ${huit.pistes.split(',').join(' et ')}`).test(huit.ticket) && huit.cartes === 0,
    '[A8] 5 puis 8 : le ticket dit les deux pistes, aucune carte dans la fenetre', huit);
  // [A9] Un nombre de pistes pose a la main survit au groupe qui change.
  const mn = await jouerReserver(browser, { ouvrir: ouvrirBowling(8), gestes: [async (pg) => { await pg.evaluate(() => rsFixer(() => rsFixerPistes(1))); await pg.waitForTimeout(200); }, lire, nombre(10), pause, lire] });
  ok(mn.lus[0].aLaMain === 1 && mn.lus[1].aLaMain === 1 && nbPistes(mn.lus[1].pistes) === 1 && mn.lus[1].cartes === 0,
    '[A9] Reserver : une piste posee a la main pour 8, puis 10 joueurs : toujours une piste', mn.lus);
  // Le groupe qui baisse, dans Reserver aussi : 8 puis 5, une piste.
  const rb = await jouerReserver(browser, { ouvrir: ouvrirBowling(8), gestes: [lire, nombre(5), pause, lire] });
  ok(nbPistes(rb.lus[0].pistes) === 2 && nbPistes(rb.lus[1].pistes) === 1 && rb.lus[1].cartes === 0, '[A8] Reserver, 8 puis 5 : une piste, aucune carte', rb.lus);
  // Le laser : 12 puis 24 joueurs sur 20 armes, aucune carte.
  const lz = await jouerReserver(browser, { armes: 20, ouvrir: new Function("openQuickBook({ date: state.currentDate, startTime: '20:00', type: 'laser', pax: 12, duration: 0.5, totalDuration: 0.5 });"), nom: 'reserver-laser', gestes: [autreNombre(24), pause, lire] });
  ok(lz.lus[0].pax === 24 && lz.lus[0].cartes === 0, '[A8] Reserver, laser sur 20 armes, 12 puis 24 joueurs : aucune carte', lz.lus[0]);
  // Au telephone.
  const tel = await jouerReserver(browser, { appareil: 'telephone-375', ouvrir: ouvrirBowling(5), nom: 'reserver-telephone', gestes: [nombre(8), pause, lire] });
  ok(nbPistes(tel.lus[0].pistes) === 2 && tel.lus[0].cartes === 0, '[A8] Reserver au telephone (375 px) : deux pistes, aucune carte', tel.lus[0]);
  ok([r, mn, rb, lz, tel].every((x) => !x.erreurs.length), '[J1] aucune erreur JS (Reserver)', [r, mn, rb, lz, tel].flatMap((x) => x.erreurs).slice(0, 3));
}

// [G1] La regle commune avec une graine, et la console qui la suit.
async function scenarioGraine(browser) {
  const lu = (rel) => transformer(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const bac = vm.createContext({});
  vm.runInContext(lu(REGLE), bac, { filename: REGLE });
  const P = bac.PinlanePistes;
  const T = [1, 2, 3, 4, 5, 6, 7, 8];
  const c = (o) => JSON.stringify(P.choisirPistes({ pistes: 8, usage: {}, date: JOUR, ...o }));
  ok(c({ libres: T, nombre: 2, graine: [4] }) === '[3,4]' && c({ libres: T, nombre: 2, graine: [5] }) === '[5,6]', '[G1] une piste et une de plus : sa voisine de paire (4 donne 3 et 4, 5 donne 5 et 6)', [c({ libres: T, nombre: 2, graine: [4] }), c({ libres: T, nombre: 2, graine: [5] })]);
  ok(c({ libres: [3, 4, 6, 7, 8], nombre: 3, graine: [3, 4] }) === '[3,4,6]' && c({ libres: T, nombre: 7, graine: [8] }) === '[2,3,4,5,6,7,8]', '[G1] la graine reste, la regle choisit celles qui manquent (cote a cote)', [c({ libres: [3, 4, 6, 7, 8], nombre: 3, graine: [3, 4] }), c({ libres: T, nombre: 7, graine: [8] })]);
  ok(JSON.parse(c({ libres: T, nombre: 1, graine: [3, 4] })).every((p) => [3, 4].includes(p)) && c({ libres: [1, 3], nombre: 2, graine: [9] }) === '[1,3]' && c({ libres: [1], nombre: 2, graine: [1] }) === 'null',
    '[G1] trop de graine : la regle choisit parmi elle ; une graine prise ne compte pas ; il en manque : null', [c({ libres: T, nombre: 1, graine: [3, 4] }), c({ libres: [1, 3], nombre: 2, graine: [9] })]);
  // Le groupe qui baisse (2026-11-19) : le meilleur bloc parmi ses pistes, juge sur
  // toutes les pistes libres. Les pistes 6 et 7 vers une seule, la 5 libre, la 8
  // prise : la 7 reste, la 6 rendue refait une paire entiere avec la 5.
  const sept = JSON.parse(c({ libres: T, nombre: 5, graine: [1, 2, 3, 4, 5, 6, 7] }));
  ok(c({ libres: [5, 6, 7], nombre: 1, graine: [6, 7] }) === '[7]' && sept.length === 5 && sept.every((p, i) => p <= 7 && (i === 0 || p === sept[i - 1] + 1)),
    '[G1] le groupe qui baisse garde le meilleur bloc parmi ses pistes, juge sur toutes les pistes libres', [c({ libres: [5, 6, 7], nombre: 1, graine: [6, 7] }), sept]);
  // La console : a 10:00, la 1 est prise (Famille Dubois) ; une piste cliquee (4) qui grandit a deux pistes.
  const k = await monterConsole(browser);
  try {
    const console1 = await k.page.evaluate((jour) => [allocateLanesIncludingSeed(2, [4], jour, '10:00', 1), allocateLanesIncludingSeed(3, [8], jour, '10:00', 1)], JOUR);
    ok(JSON.stringify(console1[0]) === '[3,4]' && JSON.stringify(console1[1]) === '[6,7,8]', '[G1] la console complete une piste cliquee par la regle : 4 donne 3 et 4, 8 donne 6, 7 et 8 (plus « la premiere libre »)', console1);
    ok(!k.erreurs.length, '[J1] aucune erreur JS (graine)', k.erreurs.slice(0, 3));
  } finally { await k.fin(); }
}

const MOD = ['modifier'];
const MUTATIONS = [
  // Les pastilles ne suivent plus le groupe (seul un rendu entier les remettrait).
  { nom: 'pastilles-figees', lettre: 'A1', scenarios: MOD, editions: [{ fichier: JS, de: "    if (!retenir) {\n      bouton.classList.toggle('is-on', choisies.has(piste));", vers: "    if (false) {\n      bouton.classList.toggle('is-on', choisies.has(piste));" }] },
  // La piste qui arrive ne s eclaire pas.
  { nom: 'arrivee-muette', lettre: 'A1', scenarios: MOD, editions: [{ fichier: JS, de: '      if (arrivees.includes(piste)) eclatPastille(bouton, true);', vers: '      if (false) eclatPastille(bouton, true);' }] },
  // Tout s eclaire a chaque peinture, meme sans changement.
  { nom: 'eclat-sans-changement', lettre: 'A6', scenarios: MOD, editions: [{ fichier: JS, de: '  if (!arrivees.length && !parties.length) return;\n  requestAnimationFrame', vers: '  requestAnimationFrame' }, { fichier: JS, de: '      if (arrivees.includes(piste)) eclatPastille(bouton, true);', vers: '      if (arrivees.includes(piste) || !parties.includes(piste)) eclatPastille(bouton, true);' }] },
  { nom: 'programme-sans-pistes', lettre: 'A2', scenarios: MOD, editions: [{ fichier: JS, de: "  // l’enregistrement ».\n  if (typeof suivrePistesEdition === 'function') suivrePistesEdition();", vers: '  // l’enregistrement ».' }] },
  // Le groupe qui baisse garde toutes ses pistes (le lot du 18/11).
  { nom: 'descente-absente', lettre: 'A3', scenarios: MOD, editions: [{ fichier: JS, de: '  if (joueursBowlingEdition(e) < ref.joueurs) {', vers: '  if (false) {' }] },
  // « à la main » ignore a la baisse : la garde du depart, et le nombre pose a la main.
  { nom: 'main-oubliee-a-la-baisse', lettre: 'A4', scenarios: MOD, editions: [
    { fichier: JS, de: '  if (!e || e.pistesALaMain) return null;\n  const ref = referencePistesEdition();', vers: '  if (!e) return null;\n  const ref = referencePistesEdition();' },
    { fichier: JS, de: '  if (edition.pistesALaMain) {\n    const posees = Math.max(1, parseLaneInput(edition.lanesStr).length);', vers: '  if (false) {\n    const posees = Math.max(1, parseLaneInput(edition.lanesStr).length);' },
  ] },
  { nom: 'main-ignoree', lettre: 'A5', scenarios: MOD, editions: [{ fichier: JS, de: '  if (edition.pistesALaMain) {\n    const posees = Math.max(1, parseLaneInput(edition.lanesStr).length);', vers: '  if (false) {\n    const posees = Math.max(1, parseLaneInput(edition.lanesStr).length);' }] },
  // La ligne du laser reste celle de l ouverture.
  { nom: 'laser-fige', lettre: 'A7', scenarios: ['laser'], editions: [{ fichier: JS, de: '  if (ligne.textContent !== texte) ligne.textContent = texte;', vers: '' }] },
  // Une carte revient dans Reserver (le contrôle lit bien la fenetre).
  { nom: 'reserver-carte', lettre: 'A8', scenarios: ['reserver'], editions: [{ fichier: JS, de: '      <div class="rs-verdict" id="rvVerdict" aria-live="polite"></div>', vers: '      <div class="attr-carte rs-attr"><p class="attr-ligne">8 joueurs</p></div>\n      <div class="rs-verdict" id="rvVerdict" aria-live="polite"></div>' }] },
  { nom: 'rsnombre-efface', lettre: 'A9', scenarios: ['reserver'], editions: [{ fichier: JS, de: '    // mot. La main a parle, elle garde la parole.\n    setQuickPax(pax);', vers: '    // mot. La main a parle, elle garde la parole.\n    quickBookState.pistesALaMain = null;\n    setQuickPax(pax);' }] },
  // Les pastilles suivent chaque touche : « 1 » montre une piste.
  { nom: 'sans-retenue', lettre: 'A10', scenarios: MOD, editions: [{ fichier: JS, de: '  const retenir = !calmee && p.pour === state.editState && frappeDansLesPistesEdition();', vers: '  const retenir = false;' }] },
  // La pastille qui arrive prend le focus du champ qu on tape.
  { nom: 'focus-vole', lettre: 'A11', scenarios: MOD, editions: [{ fichier: JS, de: '      if (arrivees.includes(piste)) eclatPastille(bouton, true);', vers: '      if (arrivees.includes(piste)) { eclatPastille(bouton, true); bouton.focus(); }' }] },
  // Les pistes ne se disent plus au lecteur d ecran.
  { nom: 'pistes-muettes', lettre: 'A11', scenarios: MOD, editions: [{ fichier: JS, de: "    if (dites) dites.textContent = pistesEnMots(montrees)", vers: "    if (false) dites.textContent = pistesEnMots(montrees)" }] },
  { nom: 'verdict-ignore', lettre: 'A12', scenarios: MOD, editions: [{ fichier: JS, de: '  if (!envoi.jourChange && envoi.requiresLanes && voulues && voulues !== obtenues) {', vers: '  if (false) {' }] },
  { nom: 'pied-cache', lettre: 'A13', scenarios: ['ecrans'], editions: [{ fichier: CSS, de: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm .fm-pied.dossier-actions { position: sticky;', vers: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm .fm-pied.dossier-actions { visibility: hidden; position: sticky;' }] },
  { nom: 'pastilles-petites', lettre: 'A13', scenarios: ['ecrans'], editions: [{ fichier: CSS, de: 'body:is(.staff-mode, .admin-mode) :is(.lane-chip, .dossier-lanes button) { min-width: 44px; height: 44px;', vers: 'body:is(.staff-mode, .admin-mode) :is(.lane-chip, .dossier-lanes button) { min-width: 30px; height: 30px;' }] },
  { nom: 'heure-sans-pistes', lettre: 'A14', scenarios: ['heure'], editions: [{ fichier: JS, de: '  if (heure && heure.prises.length && heure.proposees) e.pistesDeLHeure =', vers: '  if (false) e.pistesDeLHeure =' }] },
  { nom: 'grand-groupe-sans-baisse', lettre: 'A16', scenarios: ['baisse'], editions: [{ fichier: JS, de: '  if (joueursBowlingEdition(e) < ref.joueurs) {', vers: '  if (false) {' }] },
  // La frappe repart des pistes qu elle vient de poser (« 1 » puis « 12 » : la piste
  // gardee pour 1 joueur, plus sa voisine, qui n est pas forcement au groupe).
  { nom: 'baisse-depuis-la-frappe', lettre: 'A16', scenarios: ['baisse'], editions: [{ fichier: JS, de: '  if (a.pour === e && a.base && a.base.bowling) return { joueurs: a.base.bowling.joueurs, pistes: a.base.bowling.pistes.slice() };', vers: '  if (a.pour === e && a.base && a.base.bowling) return { joueurs: a.base.bowling.joueurs, pistes: parseLaneInput(e.lanesStr) };' }] },
  // Le serveur remet les pistes rendues en replanifiant.
  { nom: 'serveur-remet-les-pistes', lettre: 'A17', scenarios: ['baisse'], editions: [{ fichier: 'api/staff-reservations.js', serveur: true, de: '  const operationalRequest = { ...current, ...patch };', vers: '  const operationalRequest = { ...current, ...patch, lanes: [...new Set([...(current.lanes || []), ...(patch.lanes || [])].map(Number))].sort((a, b) => a - b) };' }] },
  // La bulle ne montre pas les pistes ; le compte garde toutes ses pistes ; la pastille
  // touchee dans la bulle ne part pas.
  { nom: 'bulle-sans-pistes', lettre: 'A18', scenarios: ['compte'], editions: [{ fichier: JS, de: '    ${pistesCompteArriveeHtml(devis)}\n', vers: '' }] },
  { nom: 'compte-sans-baisse', lettre: 'A18', scenarios: ['compte'], editions: [{ fichier: JS, de: '  if (joueursBowlingEdition(e) < ref.joueurs) {', vers: '  if (false) {' }] },
  { nom: 'bulle-pistes-perdues', lettre: 'A18', scenarios: ['compte'], editions: [{ fichier: JS, de: '  const envoi = preparerCompte(r, n, compteArrivee().main);', vers: '  const envoi = preparerCompte(r, n);' }] },
  { nom: 'bulle-eclat-muet', lettre: 'A18', scenarios: ['compte'], editions: [{ fichier: JS, de: '      if (on !== montreesAvant.includes(piste)) eclatPastille(bouton, on);', vers: '' }] },
  { nom: 'bulle-petite', lettre: 'A18', scenarios: ['compte'], editions: [{ fichier: CSS, de: '  body:is(.staff-mode, .admin-mode) .compte-pop .lane-chip.compte-pop__piste { height: 44px; }', vers: '' }] },
  // La bulle, plus haute avec ses pastilles, sort de l ecran du telephone.
  { nom: 'bulle-hors-ecran', lettre: 'A18', scenarios: ['compte'], editions: [{ fichier: JS, de: '  const haut = Math.max(16, Math.min(plancher - hauteur, voulu));', vers: '  const haut = voulu;' }] },
  // La ligne du laser ne suit pas le groupe qui baisse.
  { nom: 'laser-baisse-figee', lettre: 'A19', scenarios: ['laserbaisse'], editions: [{ fichier: JS, de: '  if (ligne.textContent !== texte) ligne.textContent = texte;', vers: '' }] },
  // Le mouvement reduit n est plus respecte.
  { nom: 'reduit-ignore', lettre: 'M1', scenarios: ['reduit'], editions: [{ fichier: JS, de: "  if (!bouton || typeof bouton.animate !== 'function' || !mouvement || mouvement.reduit()) return;", vers: "  if (!bouton || typeof bouton.animate !== 'function' || !mouvement) return;" }] },
  // Le bloc d un groupe qui baisse, juge sur ses seules pistes (le choix d avant).
  { nom: 'graine-jugee-seule', lettre: 'G1', scenarios: ['graine'], editions: [{ fichier: REGLE, de: '    const estLibre = new Set(libres);', vers: '    const estLibre = new Set(graine.length >= nombre ? graine : libres);' }] },
  { nom: 'graine-ignoree', lettre: 'G1', scenarios: ['graine'], editions: [{ fichier: REGLE, de: '    if (graine.length) candidats.splice(0, candidats.length, ...autourDeLaGraine(graine, libres, nombre));\n', vers: '' }] },
  { nom: 'console-premiere-libre', lettre: 'G1', scenarios: ['graine'], editions: [{ fichier: JS, de: '  return allocateLanes(n, date, startTime, duration, ignoreId, [...new Set((seedLanes || []).map(Number))].filter(isFree));', vers: '  const libres = []; for (let i = 1; i <= laneCount; i++) if (isFree(i)) libres.push(i);\n  return [...new Set([...(seedLanes || []).map(Number).filter(isFree), ...libres])].slice(0, n).sort((a, b) => a - b);' }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'modifier') await scenarioModifier(browser);
    if (nom === 'reduit') await scenarioReduit(browser);
    if (nom === 'laser') await scenarioLaser(browser);
    if (nom === 'heure') await scenarioHeure(browser);
    if (nom === 'ecrans') await scenarioEcrans(browser);
    if (nom === 'reserver') await scenarioReserver(browser);
    if (nom === 'graine') await scenarioGraine(browser);
    if (nom === 'baisse') await scenarioBaisse(browser);
    if (nom === 'compte') await scenarioCompte(browser);
    if (nom === 'laserbaisse') await scenarioLaserBaisse(browser);
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, (liste(process.env.AV_SCENARIOS) || ['modifier', 'reduit', 'laser', 'heure', 'ecrans', 'reserver', 'graine', 'baisse', 'compte', 'laserbaisse']));
    } else {
      console.log('[K] contre-preuves : chaque garde retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.AV_MUTATIONS || liste(process.env.AV_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.AV_BAVARD;
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
  if (echecs) { console.error(`\nattribution-visible-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nattribution-visible-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

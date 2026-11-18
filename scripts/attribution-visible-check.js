// LES PISTES ET LES ARMES SUIVENT LE GROUPE, ET UNE CARTE LE DIT (2026-11-18).
//
// Ansar, 18/11 : « quand on passe a plus de 6joueurs c normalement 2pistes etc
// faut que chaque fois quon change ça change aussi tu vois automatiquement [...]
// et que ça le montre et on peut choisir genre une petite pop up styler qui
// montre les pistes attribué automatiquement ou arme pour laser et on peut
// choisir de modifieir [...] ça doit paas derangé ». La regle : ou que le nombre
// de joueurs change (Modifier : le champ du haut, le Programme ; Reserver), les
// pistes suivent tout de suite par la regle commune (assets/pinlane-pistes.js,
// sa graine), et une petite carte le dit, la frappe calmee, sans voler le focus
// ni cacher « Enregistrer » ; « OK » la ferme, « Modifier » ouvre le choix.
//   [A1] Modifier, le champ du haut : 6 puis 5 joueurs ne montre rien (une piste
//        suffit toujours), 5 puis 8 pose les pistes 5 et 6 tout de suite et la
//        carte dit « 8 joueurs : pistes 5 et 6 (avant : piste 5) » ; « OK » la
//        ferme sans rien changer ; Enregistrer ecrit ces pistes en base ;
//   [A2] Modifier, le Programme (les joueurs du bowling d une visite) : 8 puis 5
//        propose de liberer une piste sans l imposer ; liberee, puis 5 puis 8 :
//        la piste revient tout de suite (avant l enregistrement), la carte le dit ;
//   [A3] 8 puis 5 joueurs : les pistes du dossier restent, la carte propose de
//        liberer celle que la regle rendrait ; « Garder » ne change rien,
//        « Libérer » la rend ;
//   [A4] une piste cochee a la main ne part jamais : le groupe qui redescend
//        rend celle que Pinlane avait ajoutee, garde celle de la main et ne
//        propose rien pour elle ;
//   [A5] des pistes posees a la main (« Seulement ces pistes, à la main ») :
//        aucune carte, les pistes ne bougent pas ;
//   [A6] aucune carte sans changement du nombre de pistes ou de vagues ;
//   [A7] le laser : 14 puis 24 joueurs sur une arene de 20 armes, « 2 vagues de
//        12 armes » ; sur 30 armes, une seule vague, aucune carte ;
//   [A8] Reserver : 5 puis 8 joueurs, la carte dit les pistes que le ticket
//        montre (celles que le serveur gardera) ; « Modifier » ouvre la page
//        du bowling ; un premier nombre de joueurs ne montre rien ; le laser
//        aussi (« 2 vagues de 12 armes ») ;
//   [A9] Reserver : un nombre de pistes pose a la main survit au groupe qui
//        change, sans carte ;
//   [A10] taper « 1 » puis « 8 » (18 joueurs) : une seule carte, celle de 18 ;
//   [A11] la carte ne prend jamais le focus du champ qu on tape ; elle est
//        annoncee (role status, aria-live polite) ; « Modifier » ouvre les
//        pastilles des pistes, la piste choisie prete au clavier ;
//   [A12] le serveur a le dernier mot : une piste que seul le serveur sait prise,
//        la carte montre celles que son calcul a blanc ecrira ;
//   [A13] au telephone (375 px), sur tablette (768 px) et a 1280 px : rien ne
//        deborde, la carte ne couvre pas « Enregistrer » (ni « Créer » dans
//        Reserver), ses boutons se touchent au doigt (44 px) ;
//   [A14] l heure du bowling changee sur une piste prise : le refus du serveur
//        reste, la carte propose les pistes libres a cette heure, « Prendre »
//        les fait partir avec le bowling deplace, en base ;
//   [A15] Reserver : la carte ne couvre rien de la colonne (« Formules », les
//        heures, les nombres), a l ordinateur comme au telephone : elle vit
//        dans le ticket, au-dessus de « Créer » (posee en bas de la colonne,
//        elle cachait « Formules » : le gate du comptoir n y cliquait plus) ;
//   [G1] la regle commune avec une graine : elle garde la graine, donne la
//        voisine de paire, choisit parmi la graine quand il y en a trop ; la
//        console complete une piste cliquee par la regle, plus « la premiere
//        libre » ;
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
const CALME = 900; // le delai de calme de la carte (600 ms), plus une marge

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
  };
}
const centre = () => require(path.join(ROOT, 'lib/ops-knowledge.js')).getCenter('libramont');

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
// Les cartes vues, une par apparition (le meme texte redessine ne compte pas).
function guetterCartes(selecteur) {
  window.__cartesVues = [];
  const lire = () => {
    const z = document.querySelector(`${selecteur} .attr-lignes`);
    const t = z ? z.textContent.replace(/\s+/g, ' ').trim() : '';
    const vues = window.__cartesVues;
    if (vues[vues.length - 1] !== t && (t || vues.length)) vues.push(t);
  };
  new MutationObserver(lire).observe(document.body, { childList: true, subtree: true, characterData: true });
}

function lireModifier() {
  const zone = document.getElementById('editAttribution');
  const carte = zone ? zone.querySelector('.attr-carte') : null;
  const texte = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const actif = document.activeElement;
  return {
    fermee: !document.querySelector('#posOverlay .edit-modal') || !state.selectedRes,
    lanes: state.editState ? String(state.editState.lanesStr || '') : null,
    pax: state.editState ? Number(state.editState.pax) : null,
    carte: carte ? texte(carte.querySelector('.attr-lignes')) : '',
    motifs: carte ? Array.from(carte.querySelectorAll('[data-attr-motif]')).map((n) => n.getAttribute('data-attr-motif')) : [],
    gestes: carte ? Array.from(carte.querySelectorAll('[data-attr-geste]')).map((b) => `${b.getAttribute('data-attr-geste')}:${b.textContent.trim()}`) : [],
    neuves: carte ? Array.from(carte.querySelectorAll('.attr-piste.is-neuve')).map((n) => Number(n.textContent)) : [],
    zone: zone ? `${zone.getAttribute('role')}|${zone.getAttribute('aria-live')}` : '',
    focus: actif ? (actif.id || actif.getAttribute('data-attr-geste') || (actif.classList.contains('lane-chip') ? `piste-${actif.textContent.trim()}` : actif.tagName)) : '',
    verdict: texte(document.getElementById('editVerdict')),
    modifs: texte(document.getElementById('editModifs')),
    puces: Array.from(document.querySelectorAll('#posOverlay .fm .lane-picker .lane-chip.is-on')).map((b) => Number(b.textContent)),
    vues: (window.__cartesVues || []).slice(),
    toast: ((document.getElementById('toast') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  };
}

async function verdictPose(page) {
  await page.waitForTimeout(120);
  await page.waitForFunction(() => { const z = document.getElementById('editVerdict'); return Boolean(z) && !z.classList.contains('is-calcul') && !verdictEdition().enCours; }, null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(150);
}

// Le calme de la carte, puis le verdict du serveur.
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
const joueursProgramme = (id, sens, fois) => async (page) => {
  for (let k = 0; k < fois; k += 1) {
    await page.locator(`#posOverlay .fm-act[data-edit-activity="${id}"] .dossier-activity-count button[aria-label$="${sens > 0 ? 'ajouter un joueur' : 'retirer un joueur'}"]`).click(VITE);
    await page.waitForTimeout(60);
  }
};
const geste = (nom) => async (page) => { await page.click(`#posOverlay #editAttribution [data-attr-geste="${nom}"]`, VITE); await page.waitForTimeout(150); };
const piste = (n) => async (page) => { await page.click(`#posOverlay .fm .lane-picker .lane-chip[onclick="toggleEditLane(${n})"]`, VITE); await page.waitForTimeout(100); };
const heure = (cle, valeur) => async (page) => {
  await page.locator(`#posOverlay [data-heure-cle="${cle}"]`).first().click(VITE);
  await page.fill(`#posOverlay [data-heure-champ="${cle}"]`, valeur, VITE);
};
const attendre = async (page) => { await calme(page); };
const suite = (...gestes) => async (page) => { for (const g of gestes) await g(page); };

async function photo(page, nom, selecteur = '#posOverlay .edit-modal') {
  if (!CAPTURES || mutation || !nom) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
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
async function monterConsole(browser, { appareil = 'ordinateur', armes = 0, enPlus = [], reecrireBlanc = null } = {}) {
  B.semer([...FIXTURE.staffState.reservations.map(ligneDepuis), ...enPlus]);
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const laser = centre().resources.laser;
  const armesAvant = laser.weaponCount;
  if (armes) laser.weaponCount = armes;
  const patchs = [];
  const blancs = [];
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil, theme: 'light', port: PORT, heure: '15:10',
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
async function jouerModifier(browser, { id, gestes = [], appareil = 'ordinateur', armes = 0, enPlus = [], reecrireBlanc = null, nom = '', mesure = null, clic = false, avant = null }) {
  const c = await monterConsole(browser, { appareil, armes, enPlus, reecrireBlanc });
  const { page } = c;
  try {
    await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
    await page.waitForTimeout(200);
    if (avant) await avant(page);
    await page.evaluate(guetterCartes, '#editAttribution');
    const ouverture = await page.evaluate(lireModifier);
    const lus = [];
    let photographiee = false;
    for (const g of gestes) {
      if (g === cliche) { await photo(page, nom); photographiee = true; continue; }
      if (typeof g === 'string') { lus.push(await page.evaluate(lireModifier)); continue; }
      await g(page);
    }
    const final = await page.evaluate(lireModifier);
    if (nom && !photographiee) await photo(page, nom);
    const mesures = mesure ? await mesure(page) : null;
    let apresClic = null;
    if (clic) { await enregistrer(page); apresClic = await page.evaluate(lireModifier); }
    return { ouverture, lus, final, mesures, apresClic, base: enBase(id), patchs: c.patchs.slice(), blancs: c.blancs.slice(), erreurs: c.erreurs.slice() };
  } finally {
    await c.fin();
  }
}
const lire = 'lire'; // un point de lecture entre deux gestes
const cliche = 'cliche'; // l image du cas, a ce moment-la (AV_CAPTURES)

async function scenarioModifier(browser) {
  // [A1] Le champ du haut : 6 puis 5 (rien), 5 puis 8 (une piste de plus, dite), OK, Enregistrer.
  const a = await jouerModifier(browser, {
    id: MASSON, clic: true, nom: 'modifier-5-a-8',
    gestes: [champJoueurs(5), attendre, lire, champJoueurs(8), lire, attendre, lire, cliche, geste('ok'), lire],
  });
  const [cinq, aussitot, carte, ok1] = a.lus;
  ok(a.ouverture.lanes === '5' && a.ouverture.carte === '' && a.ouverture.zone === 'status|polite', '[A1] a l ouverture : piste 5, aucune carte, la zone est annoncee (status, polite)', a.ouverture);
  ok(cinq.lanes === '5' && cinq.carte === '' && cinq.vues.filter(Boolean).length === 0, '[A6] 6 puis 5 joueurs : une piste suffit toujours, aucune carte', cinq);
  ok(aussitot.lanes === '5,6' && aussitot.carte === '', '[A1] 5 puis 8 : les pistes 5 et 6 tout de suite, la carte attend la fin de la frappe', aussitot);
  ok(carte.carte === '8 joueurs : pistes 5 et 6 (avant : piste 5)' && carte.neuves.join() === '6' && carte.gestes.join() === 'modifier:Modifier,ok:OK',
    '[A1] la carte : « 8 joueurs : pistes 5 et 6 (avant : piste 5) », la 6 en couleur, « Modifier » et « OK »', carte);
  ok(carte.focus === 'editPaxInput', '[A11] la carte arrivee, le focus reste dans le champ Joueurs', carte.focus);
  ok(ok1.carte === '' && ok1.lanes === '5,6' && ok1.puces.join() === '5,6', '[A1] « OK » ferme la carte, rien ne change (pistes 5 et 6)', ok1);
  ok(a.apresClic && a.apresClic.fermee && a.base.pistes === '5,6' && a.base.pax === 8, '[A1] Enregistrer : 8 joueurs sur les pistes 5 et 6, en base', { base: a.base, apres: a.apresClic && a.apresClic.verdict });

  // [A11] « Modifier » ouvre les pastilles des pistes, la piste choisie prete au clavier.
  const m = await jouerModifier(browser, { id: MASSON, gestes: [champJoueurs(8), attendre, geste('modifier'), lire] });
  ok(m.lus[0].carte === '' && /^piste-[56]$/.test(m.lus[0].focus) && m.lus[0].lanes === '5,6', '[A11] « Modifier » ferme la carte et pose le focus sur une piste choisie', m.lus[0]);

  // [A2] Le Programme : les joueurs du bowling des Collegues, 8 puis 5 (offre), liberer, puis 5 puis 8.
  const p = await jouerModifier(browser, {
    id: COLLEGUES, nom: 'modifier-programme',
    gestes: [joueursProgramme('bowling', -1, 3), attendre, lire, geste('liberer'), lire, joueursProgramme('bowling', 1, 3), lire, attendre, lire, cliche],
  });
  const [offre, liberee, aussi, revenue] = p.lus;
  ok(p.ouverture.lanes === '1,2' && offre.lanes === '1,2' && offre.motifs.join() === 'liberer' && /^5 joueurs : 1 piste suffit, vous gardez les pistes 1 et 2\.$/.test(offre.carte) && /^liberer:Libérer la piste [12],garder:Garder$/.test(offre.gestes.join()),
    '[A2] Programme, 8 puis 5 joueurs au bowling : les pistes 1 et 2 restent, la carte propose d en liberer une', offre);
  const rendue = (/Libérer la piste (\d)/.exec(offre.gestes.join()) || [])[1];
  ok(liberee.carte === '' && liberee.lanes === ['1', '2'].filter((x) => x !== rendue).join(), '[A2] « Libérer » rend la piste proposee, la carte se ferme', { liberee, rendue });
  ok(aussi.lanes.split(',').length === 2 && aussi.lanes.includes(liberee.lanes), '[A2] Programme, 5 puis 8 : la piste revient tout de suite, avant l enregistrement', aussi);
  ok(revenue.carte === `8 joueurs : ${aussi.lanes.split(',').length > 1 ? `pistes ${aussi.lanes.split(',').join(' et ')}` : ''} (avant : piste ${liberee.lanes})`,
    '[A2] la carte dit la piste revenue (« 8 joueurs : pistes … (avant : piste …) »)', revenue);

  // [A3] 8 puis 5 joueurs : l offre, « Garder » puis « Libérer ».
  const g = await jouerModifier(browser, { id: KEVIN, nom: 'modifier-8-a-5', gestes: [champJoueurs(5), attendre, lire, cliche, geste('garder'), lire] });
  ok(g.lus[0].lanes === '3,4' && g.lus[0].motifs.join() === 'liberer' && /vous gardez les pistes 3 et 4/.test(g.lus[0].carte) && /Libérer la piste [34]/.test(g.lus[0].gestes.join()),
    '[A3] 8 puis 5 joueurs : les pistes 3 et 4 restent, la carte propose d en liberer une sans l imposer', g.lus[0]);
  ok(g.lus[1].carte === '' && g.lus[1].lanes === '3,4', '[A3] « Garder » ferme la carte, les pistes 3 et 4 restent', g.lus[1]);
  const l = await jouerModifier(browser, { id: KEVIN, gestes: [champJoueurs(5), attendre, lire, geste('liberer'), lire], clic: true });
  const rendueK = (/Libérer la piste (\d)/.exec(l.lus[0].gestes.join()) || [])[1];
  ok(l.lus[1].lanes.split(',').length === 1 && l.lus[1].lanes !== rendueK && l.base.pistes === l.lus[1].lanes && l.base.pax === 5,
    '[A3] « Libérer » rend la piste proposee ; Enregistrer ecrit 5 joueurs sur une piste', { lu: l.lus[1], base: l.base });

  // [A4] Une piste cochee a la main ne part jamais.
  const h = await jouerModifier(browser, { id: MASSON, nom: 'modifier-main', gestes: [champJoueurs(8), attendre, piste(7), lire, champJoueurs(5), attendre, lire] });
  ok(h.lus[0].lanes === '5,6,7', '[A4] 8 joueurs : 5 et 6 par Pinlane, la 7 cochee a la main', h.lus[0]);
  ok(h.lus[1].lanes === '5,7' && h.lus[1].motifs.join() === 'descend' && !h.lus[1].gestes.some((x) => x.startsWith('liberer')) && /Piste 7 gardée à la main\./.test(h.lus[1].carte),
    '[A4] puis 5 joueurs : la 6 (ajoutee par Pinlane) part, la 7 (a la main) reste, rien n est propose pour elle', h.lus[1]);

  // [A5] Des pistes posees a la main : aucune carte, rien ne bouge.
  const mn = await jouerModifier(browser, { id: MASSON, gestes: [async (pg) => { await pg.click('#posOverlay #editPistesMain'); }, champJoueurs(8), attendre, lire] });
  ok(mn.lus[0].lanes === '5' && mn.lus[0].carte === '' && mn.lus[0].vues.filter(Boolean).length === 0, '[A5] « Seulement ces pistes, à la main » puis 8 joueurs : la piste 5 seule, aucune carte', mn.lus[0]);

  // [A10] Taper « 1 » puis « 8 » : une seule carte.
  const t = await jouerModifier(browser, { id: KEVIN, gestes: [taperJoueurs('18'), attendre, lire] });
  ok(t.lus[0].pax === 18 && t.lus[0].vues.filter(Boolean).length === 1 && /^18 joueurs : pistes 3, 4 et \d \(avant : pistes 3 et 4\)$/.test(t.lus[0].carte),
    '[A10] « 1 » puis « 8 » : une seule carte, celle de 18 joueurs (jamais « 1 piste »)', t.lus[0]);
  ok(t.lus[0].focus === 'editPaxInput', '[A11] apres la frappe, le focus est toujours dans le champ Joueurs', t.lus[0].focus);

  // [A12] Le serveur a le dernier mot. Son calcul a blanc ecrit d autres pistes
  // (un poste voisin les a prises, le moteur a replace le groupe) : la carte
  // montre les siennes, la barre dit l ecart.
  const autres = (rep, corps) => {
    if (!corps.modification || !rep.json || !rep.json.reservation) return rep;
    const r = JSON.parse(JSON.stringify(rep.json.reservation));
    r.lanes = [7, 8];
    ((r.opsPlan && r.opsPlan.resourceBlocks) || []).forEach((b) => { if (b.resourceType === 'bowling_lane') b.lanes = [7, 8]; });
    return { ...rep, json: { ...rep.json, reservation: r } };
  };
  const s = await jouerModifier(browser, { id: MASSON, reecrireBlanc: autres, gestes: [champJoueurs(8), attendre, lire] });
  ok(s.lus[0].lanes === '5,6' && s.lus[0].carte === '8 joueurs : pistes 7 et 8 (avant : piste 5)' && /Ce sera pistes 7, 8, pas 5, 6/.test(s.lus[0].verdict),
    '[A12] le calcul a blanc ecrit les pistes 7 et 8 : la carte montre celles du serveur, la barre dit l ecart', s.lus[0]);
  // Une piste que seul le serveur sait prise : il refuse ; la carte garde la proposition, la barre dit le refus.
  const serveurSeul = B.ligne(9901, { date: JOUR, start_time: '18:00', lanes: [6], name: 'Groupe connu du seul serveur', pax: 4, status: 'pending' });
  const sr = await jouerModifier(browser, { id: MASSON, enPlus: [serveurSeul], gestes: [champJoueurs(8), attendre, lire] });
  ok(/^Ne passera pas/.test(sr.lus[0].verdict) && sr.lus[0].carte === '8 joueurs : pistes 5 et 6 (avant : piste 5)',
    '[A12] la 6 prise pour le seul serveur : le refus se lit dans la barre, avant le clic', sr.lus[0]);

  ok([a, m, p, g, l, h, mn, t, s, sr].every((x) => !x.erreurs.length), '[J1] aucune erreur JS (Modifier)', [a, m, p, g, l, h, mn, t, s, sr].flatMap((x) => x.erreurs).slice(0, 3));
}

async function scenarioLaser(browser) {
  // [A7] 14 puis 24 joueurs : 20 armes, deux vagues de 12 ; 30 armes, une seule vague, rien.
  const v = await jouerModifier(browser, { id: JEUNESSE, armes: 20, nom: 'modifier-laser', gestes: [champJoueurs(24), attendre, lire] });
  ok(v.lus[0].carte === '24 joueurs au laser : 2 vagues de 12 armes (avant : 1 vague, l’arène a 20 armes)' && v.lus[0].motifs.join() === 'vagues' && v.lus[0].gestes.join() === 'modifier:Modifier,ok:OK',
    '[A7] 20 armes, 14 puis 24 joueurs : « 2 vagues de 12 armes »', v.lus[0]);
  const u = await jouerModifier(browser, { id: JEUNESSE, gestes: [champJoueurs(24), attendre, lire] });
  ok(u.lus[0].carte === '' && u.lus[0].vues.filter(Boolean).length === 0, '[A7] 30 armes, 14 puis 24 joueurs : une seule vague, aucune carte', u.lus[0]);
  ok([v, u].every((x) => !x.erreurs.length), '[J1] aucune erreur JS (laser)', [v, u].flatMap((x) => x.erreurs).slice(0, 3));
}

// L heure du bowling sur une piste prise : le refus reste, la carte propose, « Prendre » part avec le bowling.
async function scenarioHeure(browser) {
  const j = await jouerModifier(browser, { id: JACQUES, clic: true, nom: 'modifier-heure', gestes: [heure('bowling', '18:30'), attendre, lire, cliche, geste('prendre'), async (pg) => { await verdictPose(pg); }, lire] });
  const [offre, prise] = j.lus;
  const nouvelle = (/Prendre la piste (\d)/.exec(offre.gestes.join()) || [])[1];
  ok(/^Ne passera pas : Bowling à 18:30\.$/.test(offre.verdict) && offre.motifs.join() === 'heure' && /^Bowling à 18:30 : la piste 3 est prise à cette heure\. La piste \d est libre\.$/.test(offre.carte) && Boolean(nouvelle),
    '[A14] le bowling a 18:30 sur la piste 3 prise : le refus reste, la carte propose une piste libre a cette heure', offre);
  ok(prise.carte === '' && prise.verdict === '' && new RegExp(`Bowling 17:00 → 18:30, piste ${nouvelle}`).test(prise.modifs) && prise.puces.join() === nouvelle,
    '[A14] « Prendre » : la barre dit le bowling a 18:30 sur la nouvelle piste, le serveur le valide', prise);
  const move = (j.patchs[0] || {}).activityMove || {};
  ok(j.apresClic && j.apresClic.fermee && j.patchs.length === 1 && move.startTime === '18:30' && (move.lanes || []).join() === nouvelle && j.base.bowling === `18:30[${nouvelle}]`,
    '[A14] Enregistrer : un seul deplacement, le bowling a 18:30 sur la piste prise dans la carte, en base', { patchs: j.patchs, base: j.base });
  ok(!j.erreurs.length, '[J1] aucune erreur JS (heure)', j.erreurs.slice(0, 3));
}

// [A13] Les ecrans : rien ne deborde, rien ne cache « Enregistrer », 44 px au doigt.
async function scenarioEcrans(browser) {
  const mesure = async (page) => page.evaluate(() => {
    const m = document.querySelector('#posOverlay .edit-modal');
    const corps = m.querySelector('.edit-modal-body') || m;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const carte = m.querySelector('#editAttribution .attr-carte');
    const save = m.querySelector('.es-save');
    const r = (n) => (n ? n.getBoundingClientRect() : null);
    const sv = r(save);
    const cv = r(carte);
    const auCentre = sv ? document.elementFromPoint(sv.left + sv.width / 2, sv.top + sv.height / 2) : null;
    return {
      vw, vh,
      defile: corps.scrollWidth - corps.clientWidth,
      debordent: Array.from(m.querySelectorAll('.fm-pied, .fm-pied *')).filter((n) => { const b = n.getBoundingClientRect(); return b.width && (b.right > vw + 1 || b.left < -1); }).length,
      enregistrer: Boolean(sv && sv.top >= 0 && sv.bottom <= vh && auCentre && auCentre.closest('.es-save') === save),
      carte: Boolean(cv && cv.top >= 0 && cv.bottom <= vh),
      chevauche: Boolean(sv && cv && !(cv.bottom <= sv.top || cv.top >= sv.bottom || cv.right <= sv.left || cv.left >= sv.right)),
      boutons: Array.from(carte ? carte.querySelectorAll('.attr-b') : []).map((b) => { const x = b.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)]; }),
      hauteur: cv ? Math.round(cv.height) : 0,
    };
  });
  const vus = [];
  for (const [appareil, doigt] of [['telephone-375', true], ['tablette-portrait', true], ['portable', false]]) {
    const c = await jouerModifier(browser, { id: KEVIN, appareil, nom: `ecran-${appareil}`, gestes: [champJoueurs(13), attendre, lire], mesure });
    const d = c.mesures;
    ok(c.lus[0].carte !== '' && d && d.defile <= 1 && d.debordent === 0, `[A13] ${appareil} (${d && d.vw} px) : la carte est la, rien ne deborde`, d);
    ok(d && d.enregistrer && d.carte && !d.chevauche, `[A13] ${appareil} : la carte se lit en entier et ne couvre pas « Enregistrer »`, d);
    ok(d && d.boutons.length === 2 && d.boutons.every(([l, hh]) => hh >= (doigt ? 44 : 32) && l >= (doigt ? 64 : 48)), `[A13] ${appareil} : les boutons de la carte se touchent${doigt ? ' au doigt (44 px)' : ''}`, d && d.boutons);
    vus.push(c);
  }
  ok(vus.every((x) => !x.erreurs.length), '[J1] aucune erreur JS (ecrans)', vus.flatMap((x) => x.erreurs).slice(0, 3));
}

// ---------------------------------------------------------------------------
// RESERVER.
// ---------------------------------------------------------------------------
function lireReserver() {
  const zone = document.getElementById('rsAttrZone');
  const carte = zone ? zone.querySelector('.attr-carte') : null;
  const texte = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const s = quickBookState;
  const heure = s ? ((rvHeuresDesLignes().bowling || {}).heure || s.startTime) : '';
  const actif = document.activeElement;
  // [A15] Ce que la carte couvre dans la colonne : son cadre croise-t-il celui de
  // la colonne, et quels boutons visibles de la colonne tombent sous elle au toucher.
  const col = document.getElementById('rsCol');
  let couvre = null;
  if (zone && col && carte) {
    const z = zone.getBoundingClientRect();
    const c = col.getBoundingClientRect();
    const croise = z.left < c.right - 1 && z.right > c.left + 1 && z.top < c.bottom - 1 && z.bottom > c.top + 1;
    const couverts = Array.from(col.querySelectorAll('button, input, select, [onclick]')).filter((b) => {
      const x = b.getBoundingClientRect();
      const cx = x.left + x.width / 2;
      const cy = x.top + x.height / 2;
      if (x.width < 1 || x.height < 1 || cx < c.left || cx > c.right || cy < c.top || cy > c.bottom) return false;
      const el = document.elementFromPoint(cx, cy);
      return Boolean(el && zone.contains(el));
    }).map((b) => b.id || b.getAttribute('data-pax') || b.textContent.replace(/\s+/g, ' ').trim().slice(0, 24));
    couvre = { croise, couverts };
  }
  return {
    couvre,
    pax: s ? Number(s.pax) : null,
    pistes: s && rvActivites().includes('bowling') ? [...rvPistesDuBowling(heure).pistes].map(Number).sort((a, b) => a - b).join(',') : '',
    aLaMain: s ? s.pistesALaMain : null,
    carte: carte ? texte(carte.querySelector('.attr-lignes')) : '',
    gestes: carte ? Array.from(carte.querySelectorAll('[data-attr-geste]')).map((b) => `${b.getAttribute('data-attr-geste')}:${b.textContent.trim()}`) : [],
    zone: zone ? `${zone.getAttribute('role')}|${zone.getAttribute('aria-live')}` : '',
    page: s && s.rs ? `${s.rs.q}:${s.rs.ligne}` : '',
    focus: actif ? (actif.id || actif.getAttribute('data-pax') || actif.tagName) : '',
    vues: (window.__cartesVues || []).slice(),
  };
}

async function jouerReserver(browser, { ouvrir, gestes = [], appareil = 'ordinateur', armes = 0, nom = '', mesure = null }) {
  const c = await monterConsole(browser, { appareil, armes });
  const { page } = c;
  try {
    await page.evaluate(ouvrir);
    await page.waitForTimeout(400);
    await page.evaluate(guetterCartes, '#rsAttrZone');
    const ouverture = await page.evaluate(lireReserver);
    const lus = [];
    let photographiee = false;
    for (const g of gestes) {
      if (g === cliche) { await photo(page, nom, '#quickBookOverlay .qb-modal'); photographiee = true; continue; }
      if (typeof g === 'string') { lus.push(await page.evaluate(lireReserver)); continue; }
      await g(page);
    }
    if (nom && !photographiee) await photo(page, nom, '#quickBookOverlay .qb-modal');
    const mesures = mesure ? await mesure(page) : null;
    return { ouverture, lus, mesures, erreurs: c.erreurs.slice() };
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
const gesteRs = (nom) => async (page) => { await page.click(`#quickBookOverlay #rsAttrZone [data-attr-geste="${nom}"]`, VITE); await page.waitForTimeout(250); };
// (sans nombre : la fenetre part de 4 joueurs et pose la question « Combien de joueurs ? »)
const ouvrirBowling = (pax) => new Function(`openQuickBook({ date: state.currentDate, startTime: '18:00', type: 'bowling'${pax ? `, pax: ${pax}` : ''} });`);

async function scenarioReserver(browser) {
  const mesure = async (page) => page.evaluate(() => {
    const m = document.querySelector('#quickBookOverlay .qb-modal');
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const carte = document.querySelector('#rsAttrZone .attr-carte');
    const creer = document.querySelector('#quickBookOverlay .rs-tk-creer');
    const r = (n) => (n ? n.getBoundingClientRect() : null);
    const cv = r(carte);
    const kv = r(creer);
    const auCentre = kv ? document.elementFromPoint(kv.left + kv.width / 2, kv.top + kv.height / 2) : null;
    return {
      vw,
      defile: m ? m.scrollWidth - m.clientWidth : -1,
      carte: Boolean(cv && cv.left >= 0 && cv.right <= vw && cv.top >= 0 && cv.bottom <= vh),
      creer: Boolean(kv && auCentre && auCentre.closest('.rs-tk-creer') === creer),
      boutons: Array.from(carte ? carte.querySelectorAll('.attr-b') : []).map((b) => { const x = b.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)]; }),
    };
  });
  // [A8] 5 puis 8 joueurs : la carte dit les pistes du ticket ; « Modifier » ouvre la page du bowling.
  const r = await jouerReserver(browser, { ouvrir: ouvrirBowling(5), nom: 'reserver-5-a-8', gestes: [lire, nombre(8), pause, lire, cliche, gesteRs('modifier'), lire] });
  const [cinq, huit, modifie] = r.lus;
  ok(cinq.zone === 'status|polite' && cinq.carte === '' && cinq.pistes.split(',').length === 1, '[A8] Reserver a 5 joueurs : une piste, aucune carte, la zone est annoncee', cinq);
  ok(huit.pistes.split(',').length === 2 && huit.carte === `8 joueurs : pistes ${huit.pistes.split(',').join(' et ')} (avant : piste ${cinq.pistes})` && huit.gestes.join() === 'modifier:Modifier,ok:OK',
    '[A8] 5 puis 8 : la carte dit les deux pistes du ticket (celles que le serveur gardera)', huit);
  ok(huit.focus === '8' || huit.focus === 'rsQ' || huit.focus === 'rsCol', '[A11] Reserver : la carte arrivee ne prend pas le focus', huit.focus);
  ok(modifie.carte === '' && modifie.page === 'ligne:bowling', '[A8] « Modifier » ferme la carte et ouvre la page du bowling (ses pistes)', modifie);
  // Un premier nombre de joueurs (la question) n est pas un changement.
  const q = await jouerReserver(browser, { ouvrir: ouvrirBowling(0), gestes: [nombre(8), pause, lire] });
  ok(q.lus[0].pistes.split(',').length === 2 && q.lus[0].carte === '', '[A8] Reserver : un premier nombre de joueurs ne montre aucune carte', q.lus[0]);
  // [A9] Un nombre de pistes pose a la main survit au groupe qui change, sans carte.
  const mn = await jouerReserver(browser, { ouvrir: ouvrirBowling(8), gestes: [async (pg) => { await pg.evaluate(() => rsFixer(() => rsFixerPistes(1))); await pg.waitForTimeout(200); }, lire, nombre(10), pause, lire] });
  ok(mn.lus[0].aLaMain === 1 && mn.lus[1].aLaMain === 1 && mn.lus[1].pistes.split(',').length === 1 && mn.lus[1].carte === '' && mn.lus[1].vues.filter(Boolean).length === 0,
    '[A9] Reserver : une piste posee a la main pour 8, puis 10 joueurs : toujours une piste, aucune carte', mn.lus);
  // Le laser : 12 puis 24 joueurs sur 20 armes.
  const lz = await jouerReserver(browser, { armes: 20, ouvrir: new Function("openQuickBook({ date: state.currentDate, startTime: '20:00', type: 'laser', pax: 12, duration: 0.5, totalDuration: 0.5 });"), nom: 'reserver-laser', gestes: [autreNombre(24), pause, lire] });
  ok(lz.lus[0].carte === '24 joueurs au laser : 2 vagues de 12 armes (avant : 1 vague, l’arène a 20 armes)', '[A8] Reserver, laser sur 20 armes, 12 puis 24 joueurs : « 2 vagues de 12 armes »', lz.lus[0]);
  // [A13] Au telephone : la carte en entier, « Créer » libre.
  const tel = await jouerReserver(browser, { appareil: 'telephone-375', ouvrir: ouvrirBowling(5), nom: 'reserver-telephone', gestes: [nombre(8), pause, lire], mesure });
  const d = tel.mesures;
  ok(tel.lus[0].carte !== '' && d && d.defile <= 1 && d.carte && d.creer && d.boutons.every(([l, hh]) => hh >= 44 && l >= 64),
    '[A13] Reserver au telephone (375 px) : la carte en entier, « Créer » libre, boutons de 44 px', { lu: tel.lus[0], d });
  const libre = (lu) => Boolean(lu && lu.carte !== '' && lu.couvre && !lu.couvre.croise && lu.couvre.couverts.length === 0);
  ok(libre(huit) && libre(lz.lus[0]) && libre(tel.lus[0]),
    '[A15] Reserver : la carte ne couvre rien de la colonne (bowling et laser a l ordinateur, bowling au telephone)', { ordinateur: huit.couvre, laser: lz.lus[0].couvre, telephone: tel.lus[0].couvre });
  ok([r, q, mn, lz, tel].every((x) => !x.erreurs.length), '[J1] aucune erreur JS (Reserver)', [r, q, mn, lz, tel].flatMap((x) => x.erreurs).slice(0, 3));
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
  { nom: 'champ-haut-muet', lettre: 'A1', scenarios: MOD, editions: [{ fichier: JS, de: "  if (syncLanes && typeof planifierAttributionEdition === 'function') planifierAttributionEdition();\n", vers: '' }] },
  { nom: 'programme-sans-pistes', lettre: 'A2', scenarios: MOD, editions: [{ fichier: JS, de: "  // (les vagues du laser aussi). Avant : « complétée à l’enregistrement ».\n  if (typeof suivreAttributionEdition === 'function') suivreAttributionEdition();", vers: '  // (les vagues du laser aussi). Avant : « complétée à l’enregistrement ».' }] },
  { nom: 'descente-imposee', lettre: 'A3', scenarios: MOD, editions: [{ fichier: JS, de: '  const gardees = pistesGardeesEdition();\n  if (!pistes.some', vers: '  const gardees = new Set((state.editState.pistesTouchees || []).map(Number));\n  if (!pistes.some' }] },
  { nom: 'main-oubliee', lettre: 'A4', scenarios: MOD, editions: [{ fichier: JS, de: '  return new Set([...((origine && origine.lanes) || []), ...((e && e.pistesTouchees) || [])].map(Number));', vers: '  return new Set([...((origine && origine.lanes) || [])].map(Number));' }] },
  { nom: 'main-ignoree', lettre: 'A5', scenarios: MOD, editions: [{ fichier: JS, de: '  if (edition.pistesALaMain) {\n    const posees = Math.max(1, parseLaneInput(edition.lanesStr).length);', vers: '  if (false) {\n    const posees = Math.max(1, parseLaneInput(edition.lanesStr).length);' }] },
  { nom: 'carte-sans-changement', lettre: 'A6', scenarios: MOD, editions: [{ fichier: JS, de: '    if (b.pistes.length !== a.pistes.length) {', vers: '    if (true) {' }] },
  { nom: 'laser-muet', lettre: 'A7', scenarios: ['laser'], editions: [{ fichier: JS, de: '  if (l && m && m.vagues !== l.vagues) lignes.push(', vers: '  if (false) lignes.push(' }] },
  { nom: 'reserver-muet', lettre: 'A8', scenarios: ['reserver'], editions: [{ fichier: JS, de: "  reconcileQuickLaneSelection();\n  if (typeof planifierAttributionReserver === 'function') planifierAttributionReserver();\n  renderQuickBook();", vers: '  reconcileQuickLaneSelection();\n  renderQuickBook();' }] },
  { nom: 'reserver-premier-nombre', lettre: 'A8', scenarios: ['reserver'], editions: [{ fichier: JS, de: '  a.carte = a.base && a.base.connu ? proposerAttribution(a.base, photo) : null;', vers: '  a.carte = a.base ? proposerAttribution(a.base, photo) : null;' }] },
  { nom: 'rsnombre-efface', lettre: 'A9', scenarios: ['reserver'], editions: [{ fichier: JS, de: '    // mot. La main a parle, elle garde la parole (la carte se tait pour lui).\n    setQuickPax(pax);', vers: '    // mot. La main a parle, elle garde la parole (la carte se tait pour lui).\n    quickBookState.pistesALaMain = null;\n    setQuickPax(pax);' }] },
  { nom: 'sans-calme', lettre: 'A10', scenarios: MOD, editions: [{ fichier: JS, de: 'const ATTRIBUTION_CALME_MS = 600;', vers: 'const ATTRIBUTION_CALME_MS = 0;' }] },
  { nom: 'focus-vole', lettre: 'A11', scenarios: MOD, editions: [{ fichier: JS, de: '  const retrouve = geste ? zone.querySelector(`[data-attr-geste="${geste}"]`) : null;\n  if (retrouve) retrouve.focus({ preventScroll: true });\n}', vers: '  const retrouve = zone.querySelector(\'[data-attr-geste]\');\n  if (retrouve) retrouve.focus({ preventScroll: true });\n}' }] },
  { nom: 'modifier-sans-pistes', lettre: 'A11', scenarios: MOD, editions: [{ fichier: JS, de: "    : (cible.querySelector('.lane-chip.is-on:not([disabled])') || cible.querySelector('.lane-chip:not([disabled])'));", vers: '    : null;' }] },
  { nom: 'verdict-ignore', lettre: 'A12', scenarios: MOD, editions: [{ fichier: JS, de: "  const ecrit = dossierEcritDuVerdict();\n  const serveur = ecrit && Array.isArray(ecrit.lanes)", vers: "  const ecrit = null;\n  const serveur = ecrit && Array.isArray(ecrit.lanes)" }] },
  { nom: 'carte-sur-enregistrer', lettre: 'A13', scenarios: ['ecrans'], editions: [{ fichier: CSS, de: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm .fm-attr { flex: 0 0 100%; order: -2; min-width: 0; }', vers: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm .fm-attr { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9; }' }] },
  { nom: 'boutons-petits', lettre: 'A13', scenarios: ['ecrans'], editions: [{ fichier: CSS, de: '  body:is(.staff-mode, .admin-mode) .attr-b { min-width: 72px; min-height: 44px; }\n', vers: '' }] },
  // La carte reposee en bas de la colonne, flottante (comme avant le 18/11 au soir).
  { nom: 'reserver-flottante', lettre: 'A15', scenarios: ['reserver'], editions: [
    { fichier: JS, de: '      <div class="rs-attr-zone" id="rsAttrZone" role="status" aria-live="polite" aria-atomic="true"></div>\n      <div class="rs-verdict" id="rvVerdict"', vers: '      <div class="rs-verdict" id="rvVerdict"' },
    { fichier: JS, de: '      <div class="rs-qj-zone" id="rsQJZone"></div>\n    </div>\n', vers: '      <div class="rs-qj-zone" id="rsQJZone"></div>\n      <div class="rs-attr-zone" id="rsAttrZone" role="status" aria-live="polite" aria-atomic="true"></div>\n    </div>\n' },
    { fichier: CSS, de: '.qb-modal.rv.rs .rs-attr-zone { flex: none; padding: 6px 16px 10px; }', vers: '.qb-modal.rv.rs .rs-attr-zone { position: absolute; z-index: 5; left: var(--rs-gouttiere); right: var(--rs-gouttiere); bottom: 16px; display: flex; justify-content: center; pointer-events: none; } .qb-modal.rv.rs .rs-attr { pointer-events: auto; width: min(600px, 100%); }' },
  ] },
  { nom: 'heure-sans-pistes', lettre: 'A14', scenarios: ['heure'], editions: [{ fichier: JS, de: '  return prises && prises.heure === heure && Array.isArray(lanes) && prises.pistes.length === lanes.length ? prises.pistes.slice() : lanes;', vers: '  return lanes;' }] },
  { nom: 'graine-ignoree', lettre: 'G1', scenarios: ['graine'], editions: [{ fichier: REGLE, de: '    if (graine.length) candidats.splice(0, candidats.length, ...autourDeLaGraine(graine, libres, nombre));\n', vers: '' }] },
  { nom: 'console-premiere-libre', lettre: 'G1', scenarios: ['graine'], editions: [{ fichier: JS, de: '  return allocateLanes(n, date, startTime, duration, ignoreId, [...new Set((seedLanes || []).map(Number))].filter(isFree));', vers: '  const libres = []; for (let i = 1; i <= laneCount; i++) if (isFree(i)) libres.push(i);\n  return [...new Set([...(seedLanes || []).map(Number).filter(isFree), ...libres])].slice(0, n).sort((a, b) => a - b);' }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'modifier') await scenarioModifier(browser);
    if (nom === 'laser') await scenarioLaser(browser);
    if (nom === 'heure') await scenarioHeure(browser);
    if (nom === 'ecrans') await scenarioEcrans(browser);
    if (nom === 'reserver') await scenarioReserver(browser);
    if (nom === 'graine') await scenarioGraine(browser);
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, (liste(process.env.AV_SCENARIOS) || ['modifier', 'laser', 'heure', 'ecrans', 'reserver', 'graine']));
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

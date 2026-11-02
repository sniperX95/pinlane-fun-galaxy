// UNE FORMULE PIEGEE NE S EXECUTE NULLE PART (piste H1 de l audit data, 2026-11-02).
//
// POURQUOI CE GATE EXISTE. Le catalogue d un centre s edite depuis la console
// (permission settings.manage, et pricing.manage pour le nom d une formule par
// la voie des tarifs) et le tunnel le rend a tous les clients du centre. Le
// serveur ne bornait que la longueur, et renderFormules posait group.name,
// f.name, f.price et les lignes de f.desc tels quels dans innerHTML. Un compte
// du staff pouvait donc faire executer du script a chaque visiteur du tunnel,
// et, par la console fondateur, a Pinlane.
//
// HONNETETE. Le catalogue servi est le vrai (metaPayload, dev-tunnel-server), le
// code est le vrai, le navigateur est un vrai navigateur : seule la REPONSE est
// empoisonnee, chaque texte du catalogue portant un piege qui sort d un texte,
// d un attribut ou d une chaine JS. On MESURE LE DOM, pas le source : un noeud
// marque data-poison ou une ligne dans window.__poison, et c est ROUGE.
//
// Chaque scene MONTE d abord ce qu elle juge : le texte piege est bien a l ecran,
// en clair. Sans ce temoin, un rendu qui n arrive jamais passerait pour sur.
//
// Usage : node scripts/catalogue-injection-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const mock = require('./dev-tunnel-server');
const { defaults } = require('../lib/arcade-offers');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_CATALOGUE_INJECTION_PORT || 4671);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let failures = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return Boolean(cond);
}

// LES CLES QUI PILOTENT LE CODE : les piegeant, on casserait le parcours sans
// rien apprendre (un id, un type de prix). Tout le reste est du texte que le
// staff peut ecrire : le piege y va PAR DEFAUT, et un champ texte ajoute demain
// est couvert sans toucher a ce gate.
const CLES_DE_STRUCTURE = new Set(['id', 'type', 'priceType', 'resourceType', 'activityId', 'orderPolicy', 'replaces', 'descReplaces', 'mode']);

const piege = (id) => `'"><img src=x data-poison=${id} onerror=__poison.push(this.dataset.poison)>`;

// LA FAMILLE ET LES NOTES REGROUPENT : deux formules de meme famille se rangent
// ensemble, et une note commune se factorise en tete de groupe. Un meme texte
// garde donc le MEME piege, sinon ces rendus n auraient jamais lieu.
const PARTAGES = new Map();
function idPartage(nature, texte) {
  const cle = `${nature}:${texte}`;
  if (!PARTAGES.has(cle)) PARTAGES.set(cle, `${nature}.${PARTAGES.size}`);
  return PARTAGES.get(cle);
}
const idDuTexte = (chemin, texte) => {
  if (/\.notes\.\d+$/.test(chemin)) return idPartage('note', texte);
  if (/^f\.[^.]+\.family$/.test(chemin)) return idPartage('famille', texte);
  return chemin;
};

function empoisonner(noeud, chemin, cles, poses) {
  if (typeof noeud === 'string') {
    if (!noeud) return noeud;
    const id = idDuTexte(chemin, noeud);
    poses.push(id);
    return `${noeud}${piege(id)}`;
  }
  if (Array.isArray(noeud)) return noeud.map((v, i) => empoisonner(v, `${chemin}.${i}`, cles, poses));
  if (noeud && typeof noeud === 'object') {
    const sortie = {};
    for (const cle of Object.keys(noeud)) {
      const valeur = noeud[cle];
      // Une cle de structure garde sa valeur, mais ce qu elle contient se visite :
      // `program.items[].name` vit sous `program`, qui n est pas du texte.
      const descendre = valeur && typeof valeur === 'object';
      sortie[cle] = cles(cle) || descendre ? empoisonner(valeur, `${chemin}.${cle}`, cles, poses) : valeur;
    }
    return sortie;
  }
  return noeud;
}

function empoisonnerMeta(meta, poses, { prix = false } = {}) {
  const texte = (cle) => !CLES_DE_STRUCTURE.has(cle);
  // Aucune famille du socle n a de note commune : on en pose une, sinon l en-tete
  // de groupe qui les factorise ne se rendrait jamais ici.
  const formules = (meta.formules || []).map((f) => {
    const piegee = empoisonner({ ...f, notes: [...(f.notes || []), 'Note commune a toute la famille'] }, `f.${f.id}`, texte, poses);
    // Un prix est un nombre borne par le serveur : le piege y va a part, sur les
    // cartes seules, car le reste du parcours compte avec.
    if (prix) Object.assign(piegee, { price: `${f.price}${piege(`f.${f.id}.price`)}`, oldPrice: `${f.oldPrice || 40}${piege(`f.${f.id}.oldPrice`)}` });
    return piegee;
  });
  const activities = (meta.activities || []).map((a) => empoisonner(a, `a.${a.id}`, texte, poses));
  return { ...meta, formules, activities };
}

// LES REPONSES QUE LE SERVEUR COMPOSE AVEC LE CATALOGUE (disponibilite, blocage,
// reservation) : son double lit le socle, pas la reponse piegee. Ici, le piege se
// pose sur les cles qui portent du texte destine a l ecran, et seulement elles :
// une heure, une date ou un motif technique pilotent le code.
const CLES_TEXTE_SERVEUR = /^(name|label|title|titre|summary|detail|details|note|notes|message|reason|description|unitLabel|desc|family|formuleName|activityName|activityLabel|addsLabel|totalLabel|noteLabel|amountLabel|freeLabels|appointments)$/;

async function repondrePiege(route, poses, racine) {
  const reponse = await route.fetch();
  const corps = await reponse.text();
  let json;
  try { json = JSON.parse(corps); } catch (erreur) { await route.fulfill({ response: reponse }); return; }
  await route.fulfill({ response: reponse, json: empoisonner(json, racine, (cle) => CLES_TEXTE_SERVEUR.test(cle) || /^\d+$/.test(cle), poses) });
}

// LES MUTANTS NE TOUCHENT JAMAIS LE DISQUE : le navigateur recoit le fichier
// servi, ampute de la seule protection visee.
async function muter(page, mutants) {
  const parFichier = new Map();
  for (const m of mutants) parFichier.set(m.fichier, [...(parFichier.get(m.fichier) || []), m]);
  for (const [fichier, liste] of parFichier) {
    await page.route(`**/${fichier}*`, async (route) => {
      let texte = (await fs.promises.readFile(path.join(ROOT, fichier), 'utf8')).split('\r\n').join('\n');
      for (const { de, vers } of liste) {
        if (texte.split(de).length - 1 < 1) throw new Error(`ANCRE absente : ${de.slice(0, 90)}`);
        texte = texte.split(de).join(vers);
      }
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: texte });
    });
  }
}

async function monterPiege(page, poses, options = {}) {
  await page.addInitScript(() => { window.__poison = []; });
  await page.route('**/api/public-availability?**', (route) => repondrePiege(route, poses, 'dispo'));
  await page.route('**/api/public-holds', (route) => repondrePiege(route, poses, 'hold'));
  await page.route('**/api/public-reservations', (route) => repondrePiege(route, poses, 'resa'));
  await page.route('**/api/public-booking-meta?**', async (route) => {
    const reponse = await route.fetch();
    const meta = await reponse.json();
    await route.fulfill({ response: reponse, json: empoisonnerMeta(meta, poses, options) });
  });
}

const RELEVE = () => ({
  executes: (window.__poison || []).slice(),
  noeuds: Array.from(document.querySelectorAll('[data-poison]')).map((n) => n.getAttribute('data-poison')),
  texte: (document.body.textContent || '').split('data-poison=').length - 1,
});

async function juger(page, scene, { temoin } = {}) {
  const r = await page.evaluate(RELEVE);
  const uniques = [...new Set([...r.noeuds, ...r.executes])];
  ok(r.executes.length === 0, `[${scene}] aucun piege ne s execute`, uniques.slice(0, 12).join(' '));
  ok(r.noeuds.length === 0, `[${scene}] aucun noeud injecte`, uniques.slice(0, 12).join(' '));
  if (temoin) ok(r.texte > 0 || r.noeuds.length > 0, `[${scene}] MONTAGE : le texte piege est a l ecran`, `${r.texte} occurrence(s)`);
  return uniques;
}

async function tunnelClassique(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message || e)));
  const poses = [];
  await monterPiege(page, poses);
  await page.goto(`${BASE}/reserver`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof setType === 'function' && Array.isArray(window.__pinlaneDisplayFormules), null, { timeout: 30000 });
  ok(poses.length > 50, `[tunnel] MONTAGE : le catalogue servi est piege (${poses.length} textes)`);

  await page.evaluate((date) => {
    state.booking.date = date;
    const champ = document.getElementById('fDate');
    if (champ) champ.value = date;
    state.booking.pax = 6;
    setType('formule');
    renderFormules();
  }, mock.DATE);
  ok(await page.locator('.formule-card').count() >= 10, '[tunnel] MONTAGE : les cartes des formules sont rendues');
  await juger(page, 'tunnel cartes', { temoin: true });
  // Le clic d une carte passe par son attribut de donnee : il choisit toujours.
  const carte = page.locator('.formule-card:not(.disabled)').first();
  const choisie = await carte.getAttribute('data-formule-id');
  await carte.evaluate((bouton) => bouton.click());
  ok(Boolean(choisie) && await page.evaluate(() => state.booking.formuleId) === choisie, '[tunnel] un clic sur une carte choisit sa formule', String(choisie));

  await page.evaluate(async () => { selectFormule('f4'); goStep(2); await fetchSlots({ showLoading: true }); });
  ok(poses.some((p) => p.startsWith('dispo.')), '[tunnel] MONTAGE : la reponse de disponibilite est piegee');
  ok(await page.evaluate(() => document.getElementById('slotList').textContent.trim().length > 0), '[tunnel] MONTAGE : les heures de la formule sont rendues');
  await juger(page, 'tunnel creneaux', { temoin: true });
  await page.evaluate(() => { if ((state.availableSlots || []).length) selectSlot(0); renderRecap(); });
  ok(await page.evaluate(() => /Formule/.test(document.getElementById('recapList').textContent)), '[tunnel] MONTAGE : le recapitulatif nomme la formule');
  await juger(page, 'tunnel recap', { temoin: true });

  // A LA CARTE : toutes les activites cochees, un groupe qui force les
  // avertissements (passages, pistes), une activite fermee ce jour.
  await page.evaluate(() => {
    setType('bowling');
    state.booking.pax = 40;
    getCenterActivities().forEach((a) => { if (!state.booking.activities[a.id]) toggleBookingActivity(a.id); });
    renderActivityPicker([]);
    renderProgramSummary();
    updatePaxAlert();
    renderTypeAlert(getCenterActivities().slice(0, 2).map((a) => a.id), { date: state.booking.date });
    syncStatusDock();
  });
  ok(await page.locator('.activity-card').count() >= 6, '[tunnel] MONTAGE : les cartes des activites sont rendues');
  await juger(page, 'tunnel activites', { temoin: true });
  await page.evaluate(async () => { state.booking.pax = 4; goStep(2); await fetchSlots({ showLoading: true }); });
  ok(await page.evaluate(() => document.getElementById('slotList').textContent.trim().length > 0), '[tunnel] MONTAGE : les heures a la carte sont rendues');
  await juger(page, 'tunnel heures a la carte', { temoin: true });
  await page.evaluate(() => { if ((state.availableSlots || []).length) selectSlot(0); renderRecap(); });
  await juger(page, 'tunnel recap a la carte', { temoin: true });
  // L ecran final se lit sur une formule : une heure, un groupe, un dossier.
  const fin = await page.evaluate(async () => {
    setType('formule');
    state.booking.pax = 6;
    selectFormule('f1');
    goStep(2);
    await fetchSlots({ showLoading: true });
    if ((state.availableSlots || []).length) selectSlot(0);
    Object.assign(state.booking, { name: 'QA Injection', phone: '0470000000', email: 'injection@pinlane.test' });
    await confirmBooking();
    return { etape: state.step, alerte: document.getElementById('alertBox').textContent.trim(), heure: state.booking.startTime };
  });
  ok(fin.etape === 5, '[tunnel] MONTAGE : la reservation aboutit', JSON.stringify(fin));
  await juger(page, 'tunnel confirmation');
  await context.close();
  ok(erreurs.length === 0, '[tunnel] aucune erreur JS', erreurs.slice(0, 3).join(' | '));
}

async function formulaireMonte(page) {
  await page.goto(`${BASE}/fungalaxy/libramont?embed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', null, { timeout: 30000 });
  await page.click('#dayBtn');
  for (let k = 0; k < 4 && !(await page.locator(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`).count()); k += 1) {
    await page.click('#calNext');
    await page.waitForTimeout(300);
  }
  await page.waitForFunction((d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await page.waitForFunction(() => document.querySelector('#dayPop').hidden);
}

async function lesFichesSOuvrent(page, grille, attribut, scene) {
  const boutons = page.locator(`${grille} [${attribut}]`);
  const n = await boutons.count();
  ok(n > 0, `[${scene}] MONTAGE : les fiches existent`, String(n));
  for (let i = 0; i < n; i += 1) {
    await boutons.nth(i).click();
    await page.waitForSelector('.fg-info-text');
    await juger(page, `${scene} ${i + 1}/${n}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.fg-info-text') || !document.querySelector('.fg-info-text').offsetParent);
  }
}

async function formulaireFunGalaxy(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message || e)));
  const poses = [];
  await monterPiege(page, poses);
  await formulaireMonte(page);
  ok(poses.length > 50, `[formulaire] MONTAGE : le catalogue servi est piege (${poses.length} textes)`);
  await page.fill('#paxInput', '12');
  await page.press('#paxInput', 'Enter');
  await page.click('#goActivities');
  await page.waitForSelector('.fg-scene[data-scene="activites"].is-active');
  await page.locator('#gridAct .fg-card:not(.is-on)').evaluateAll((noeuds) => noeuds.forEach((n) => n.click()));
  await juger(page, 'formulaire activites', { temoin: true });
  await lesFichesSOuvrent(page, '#gridAct', 'data-activity-info', 'formulaire fiche activite');
  await page.click('#tabFor');
  await page.waitForFunction(() => !document.querySelector('#panelFor').hidden);
  await page.waitForFunction(() => document.querySelectorAll('#panelFor .fg-for').length > 3 || document.querySelectorAll('#gridFor .fg-card').length > 3);
  await juger(page, 'formulaire formules', { temoin: true });
  await lesFichesSOuvrent(page, '#gridFor', 'data-formula-info', 'formulaire fiche formule');
  await page.click('#tabAct');
  await page.waitForFunction(() => !document.querySelector('#panelAct').hidden);
  await page.click('#goHours');
  await page.waitForFunction(() => document.querySelector('.fg-scene[data-scene="heures"].is-active'));
  await page.waitForFunction(() => !document.querySelector('#goContact').disabled, null, { timeout: 30000 });
  await juger(page, 'formulaire heures');
  await page.click('#goContact');
  await page.waitForSelector('.fg-scene[data-scene="contact"].is-active');
  await juger(page, 'formulaire contact');
  await page.fill('#cPrenom', 'QA');
  await page.fill('#cNom', 'Injection');
  await page.fill('#cEmail', 'injection@pinlane.test');
  await page.fill('#cTel', '0470000000');
  await page.click('[data-occasion="amis"]');
  await page.check('#cConsent');
  await page.click('#goRecap');
  await page.waitForSelector('.fg-scene[data-scene="recap"].is-active');
  await juger(page, 'formulaire recap', { temoin: true });
  await page.locator('#confirmBtn').evaluate((b) => b.click());
  await page.waitForSelector('.fg-scene[data-scene="fin"].is-active');
  await juger(page, 'formulaire fin');
  await context.close();
  ok(erreurs.length === 0, '[formulaire] aucune erreur JS', erreurs.slice(0, 3).join(' | '));
}

async function surMesure(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message || e)));
  const poses = [];
  await monterPiege(page, poses);
  await formulaireMonte(page);
  await page.fill('#paxInput', '31');
  await page.press('#paxInput', 'Enter');
  await page.click('#goActivities');
  await page.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active');
  await page.click('.fg-occasion[data-type="amis"]');
  await page.click('#smGoDate');
  await page.check('#smFlexible');
  await page.fill('#smPeriod', 'Vacances');
  await page.click('.fg-sm-moment[data-moment="indifferent"]');
  await page.click('#smGoEnvies');
  await page.waitForSelector('.fg-scene[data-scene="sm-envies"].is-active');
  await page.locator('#smGridAct .fg-card:not(.is-on)').evaluateAll((noeuds) => noeuds.forEach((n) => n.click()));
  await juger(page, 'sur mesure activites', { temoin: true });
  await lesFichesSOuvrent(page, '#smGridAct', 'data-activity-info', 'sur mesure fiche activite');
  await page.click('#smTabFor');
  await juger(page, 'sur mesure formules', { temoin: true });
  await page.locator('#smGridFor .fg-card:not(.is-on):not(.is-refus)').first().click();
  await juger(page, 'sur mesure formule choisie');
  await page.click('#smGoContact');
  for (const [id, valeur] of [['smPrenom', 'QA'], ['smNom', 'Injection'], ['smEmail', 'injection@pinlane.test'], ['smTel', '0470000000']]) await page.fill(`#${id}`, valeur);
  await page.check('#smConsent');
  await page.click('#smGoRecap');
  await page.waitForSelector('.fg-scene[data-scene="sm-recap"].is-active');
  await juger(page, 'sur mesure recap', { temoin: true });
  await context.close();
  ok(erreurs.length === 0, '[sur mesure] aucune erreur JS', erreurs.slice(0, 3).join(' | '));
}

// LES CARTES AU PRIX PIEGE, et le recapitulatif : la scene que rejouent les
// contre-epreuves du tunnel. Elle rend les pieges vus dans le DOM.
async function cartesDuTunnel(browser, { mutants = [], prix = false, recap = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const poses = [];
  await muter(page, mutants);
  await monterPiege(page, poses, { prix });
  await page.goto(`${BASE}/reserver`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof setType === 'function' && Array.isArray(window.__pinlaneDisplayFormules), null, { timeout: 30000 });
  await page.evaluate((date) => {
    state.booking.date = date;
    const champ = document.getElementById('fDate');
    if (champ) champ.value = date;
    state.booking.pax = 6;
    setType('formule');
    renderFormules();
  }, mock.DATE);
  if (recap) await page.evaluate(() => { document.getElementById('recapList').textContent = ''; selectFormule('f1'); renderRecap(); });
  const vus = await page.evaluate(() => Array.from(document.querySelectorAll(window.__portee || '[data-poison]')).map((n) => ({ id: n.getAttribute('data-poison'), recap: Boolean(n.closest('#recapList')) })));
  const texte = await page.evaluate(() => (document.body.textContent || '').split('data-poison=').length - 1);
  await context.close();
  return { vus, texte };
}

const MUTANTS_TUNNEL = [
  { nom: 'le nom de famille', fichier: 'assets/app-main.js', de: '<h3>${escapeHtml(group.name)}</h3>', vers: '<h3>${group.name}</h3>', piege: /^famille\./ },
  { nom: 'les notes communes', fichier: 'assets/app-main.js', de: '<p class="formule-group-notes">${escapeHtml(sharedNotes.join(\' · \'))}</p>', vers: '<p class="formule-group-notes">${sharedNotes.join(\' · \')}</p>', piege: /^note\./ },
  { nom: 'le nom de la formule', fichier: 'assets/app-main.js', de: '<span class="formule-name">${escapeHtml(f.name)}</span>', vers: '<span class="formule-name">${f.name}</span>', piege: /^f\.f1\.name$/ },
  { nom: 'l ancien prix', fichier: 'assets/app-main.js', de: '<s>${escapeHtml(f.oldPrice)}€</s>', vers: '<s>${f.oldPrice}€</s>', piege: /\.oldPrice$/, prix: true },
  { nom: 'le prix', fichier: 'assets/app-main.js', de: '<strong>${escapeHtml(f.price)}€</strong>', vers: '<strong>${f.price}€</strong>', piege: /\.price$/, prix: true },
  { nom: 'les lignes de la formule', fichier: 'assets/app-main.js', de: '<li>${escapeHtml(line)}</li>', vers: '<li>${line}</li>', piege: /\.desc\.\d+$/ },
  { nom: 'les conditions de la carte', fichier: 'assets/app-main.js', de: '<span class="formule-card-meta">${escapeHtml(meta.join(\' · \'))}</span>', vers: '<span class="formule-card-meta">${meta.join(\' · \')}</span>', piege: /^note\./ },
  { nom: 'le nom au recapitulatif', fichier: 'assets/app-main.js', de: '<span class="recap-value">${escapeHtml(formule.name)}</span>', vers: '<span class="recap-value">${formule.name}</span>', piege: /^f\.f1\.name$/, recap: true },
];

async function contreEpreuvesTunnel(browser) {
  for (const m of MUTANTS_TUNNEL) {
    const { vus } = await cartesDuTunnel(browser, { mutants: [m], prix: Boolean(m.prix), recap: Boolean(m.recap) });
    const mord = vus.filter((v) => (m.recap ? v.recap : true) && m.piege.test(v.id));
    ok(mord.length > 0, `[mutation] sans l echappement de ${m.nom}, le piege s injecte`, `${vus.length} noeud(s) vu(s)`);
  }
}

async function main() {
  // Les offres des arcades portent leurs textes, comme la prod les sert.
  const arcades = mock.ACTIVITIES.find((a) => a.id === 'arcade_time');
  arcades.arcadeOffers = defaults();
  const server = mock.createServer({ port: PORT });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
  try {
    await tunnelClassique(browser);
    await formulaireFunGalaxy(browser);
    await surMesure(browser);
    const prix = await cartesDuTunnel(browser, { prix: true });
    ok(prix.texte > 0, '[tunnel prix] MONTAGE : le prix piege est a l ecran', String(prix.texte));
    ok(prix.vus.length === 0, '[tunnel prix] aucun noeud injecte par un prix', prix.vus.slice(0, 5).map((v) => v.id).join(' '));
    await contreEpreuvesTunnel(browser);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${failures ? `ECHEC : ${failures} controle(s) rouge(s)` : 'ALL OK : aucune donnee du catalogue ne s execute'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((erreur) => {
  console.error('ERREUR DU GATE', erreur && (erreur.stack || erreur.message || erreur));
  process.exit(1);
});

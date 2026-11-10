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
// CE QUE LE GATE COUVRE :
//   [tunnel]     le tunnel classique, de la carte a la confirmation ;
//   [formulaire] le formulaire Fun Galaxy, fiches comprises ;
//   [sur mesure] la demande de groupe ;
//   [console]    Tarifs, editeur des etapes, fiche client (nom saisi dans le
//                tunnel public), et la page tarifs du fondateur, qui lit le
//                catalogue de TOUS les clients ;
//   [argument]   escapeJsString dans un attribut, sur des textes hostiles ;
//   [source]     aucun gestionnaire inline ne recoit escapeHtml seul : HTML
//                decode l attribut avant JavaScript, l apostrophe ressortirait ;
//   [ecriture]   le second verrou : balises refusees, identifiants d etape.
// Chaque garde a sa contre-epreuve [mutation], jouee sur le fichier SERVI : le
// disque n est jamais touche.
//
// Usage : node scripts/catalogue-injection-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { chromium } = require('playwright-core');
// Ce gate eprouve encore l ancien ecran (index.html) : il le redemande au serveur local, qui ne le
// sert plus par defaut depuis le 2026-11-10.
process.env.PINLANE_ANCIEN_TUNNEL = '1';
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
  if (/\.(family|bookingFamily)$/.test(chemin)) return idPartage('famille', texte);
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
  // ECHAPPER UNE FOIS, PAS DEUX : le client lit le texte saisi, pas des entites.
  const carteF1 = await page.evaluate(() => {
    const noeud = document.querySelector('.formule-card[data-formule-id="f1"]');
    return { nom: noeud.querySelector('.formule-name').textContent, ligne: noeud.querySelector('.formule-card-list li').textContent };
  });
  ok(carteF1.nom === `FORMULE 1${piege('f.f1.name')}`, '[tunnel cartes] le nom se lit tel qu il a ete saisi', carteF1.nom.slice(0, 90));
  ok(carteF1.ligne.endsWith(piege('f.f1.desc.0')) && !carteF1.ligne.includes('&#39;'), '[tunnel cartes] une ligne de la formule aussi', carteF1.ligne.slice(0, 90));
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

// ---------------------------------------------------------------------------
// LA CONSOLE. La vraie console sur le double de run-visual-qa (session Direction,
// reservations du jour), avec le catalogue piege partout ou elle le lit, et un
// nom de client hostile : il arrive du tunnel public, ou le serveur ne retire
// que les chevrons (stripUnsafeMarkup). Le piege sans chevron passe par le
// guillemet, et ne se voit qu au noeud : un attribut data-poison en trop.
// ---------------------------------------------------------------------------
function chargerInstallQaApi() {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/run-visual-qa.js'), 'utf8').split('\r\n').join('\n');
  const debut = source.indexOf('async function installQaApi(');
  const fin = source.indexOf('\n}\n', debut);
  if (debut < 0 || fin < 0) throw new Error('installQaApi introuvable dans run-visual-qa.js');
  // eslint-disable-next-line no-new-func
  return new Function('BASE_URL', `${source.slice(debut, fin + 3)}\nreturn installQaApi;`)(BASE);
}

const FAMILLE = 'Soirees privees';
const CLES_CATALOGUE_CONSOLE = new Set([...CLES_DE_STRUCTURE, 'centerId', 'humanValidation', 'source', 'ownerClientId', 'scope', 'generatedAt']);

async function catalogueConsole(overrides, poses) {
  const texte = (cle) => !CLES_CATALOGUE_CONSOLE.has(cle);
  const client = await overrides.buildClientCatalog(POOL_VIDE, 'libramont');
  const fondateur = await overrides.buildFounderCatalog(POOL_VIDE);
  // Une famille qui n est pas celle du socle a SON onglet de filtre, et le premier
  // pas de la formule f1 porte un identifiant hors catalogue.
  const formules = client.formulas.map((f) => ({ ...f, family: FAMILLE, bookingFamily: FAMILLE, steps: f.id === 'f1' ? [{ ...(f.steps[0] || {}), activityId: `hors${piege('step.activityId')}` }, ...f.steps.slice(1)] : f.steps }));
  return {
    client: empoisonner({ ...client, formulas: formules }, 'cc', texte, poses),
    fondateur: empoisonner(fondateur, 'fc', texte, poses),
  };
}

const NOM_HOSTILE = 'Dupont" data-poison="r.name';
const EMAIL_HOSTILE = 'dupont@pinlane.test" data-poison="r.email';

async function consoleMontee(browser, mutants, poses) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await muter(page, mutants);
  await chargerInstallQaApi()(page);
  const meta = empoisonnerMeta(mock.metaPayload('', 0, ''), poses);
  const { overrides } = chargerEcriture();
  const catalogues = await catalogueConsole(overrides, poses);
  await page.addInitScript(({ meta, client, fondateur, nom, email }) => {
    window.__poison = [];
    const precedent = window.fetch;
    const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (input, init = {}) => {
      const brut = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(brut, window.location.origin);
      const methode = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/public-booking-meta' && methode === 'GET') return J(meta);
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'clientCatalog') return J({ ok: true, ...client });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'founderCatalog') return J({ ok: true, ...fondateur });
      const reponse = await precedent(input, init);
      if (u.pathname !== '/api/staff-state' && u.pathname !== '/api/admin-range') return reponse;
      const corps = await reponse.clone().json();
      return J({ ...corps, reservations: (corps.reservations || []).map((r) => ({ ...r, name: nom, email })) });
    };
  }, { meta, client: catalogues.client, fondateur: catalogues.fondateur, nom: NOM_HOSTILE, email: EMAIL_HOSTILE });
  await page.goto(`${BASE}/?v=catalogue-injection`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 30000 });
  await page.evaluate(async () => { setView('staff'); await ensureStaffConsolesLoaded(); });
  return { context, page };
}

async function pageTarifs(page) {
  await page.evaluate(() => { state.staffMenuPage = 'prices'; setView('staff'); });
  await page.waitForSelector('#staffPricingPage [data-cev-formula="f1"]', { state: 'attached', timeout: 20000 });
}

async function ouvrirEtapes(page) {
  // La page refaite (2026-11-03) : le bouton vit dans la planche de la ligne.
  await page.evaluate(() => {
    const ligne = document.querySelector('#staffPricingPage [data-tf-ligne="f1"] .tf-ligne-btn');
    if (ligne && !document.querySelector('#staffPricingPage [data-cev-steps="f1"]')) ligne.click();
  });
  await page.waitForSelector('#staffPricingPage [data-cev-steps="f1"]', { state: 'attached', timeout: 10000 });
  await page.evaluate(() => { document.querySelector('#staffPricingPage [data-cev-steps="f1"]').click(); });
  await page.waitForSelector('#cevOverlay .cev-step', { state: 'attached', timeout: 10000 });
}

async function ficheClient(page) {
  await page.evaluate(() => { state.staffMenuPage = 'clients'; setView('staff'); });
  await page.waitForFunction(() => document.querySelector('[onclick*="selectStaffClient"]'), null, { timeout: 20000 });
  await page.evaluate(() => { document.querySelector('[onclick*="selectStaffClient"]').click(); });
  await page.waitForFunction(() => document.querySelector('[onclick*="pv2OpenComposer"]'), null, { timeout: 20000 });
}

async function pageFondateur(page) {
  await page.evaluate(async () => {
    if (typeof window.renderFounderTarifsPage !== 'function') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/assets/founder-tarifs.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
    }
    const hote = document.createElement('div');
    hote.id = 'gateTarifsFondateur';
    document.body.append(hote);
    window.renderFounderTarifsPage(hote);
  });
  await page.waitForFunction(() => /FORMULE 1/.test((document.getElementById('gateTarifsFondateur') || {}).textContent || ''), null, { timeout: 20000 });
}

async function console_(browser) {
  const poses = [];
  const { context, page } = await consoleMontee(browser, [], poses);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message || e)));
  await pageTarifs(page);
  await juger(page, 'console tarifs', { temoin: true });

  // UN NOM DE CATEGORIE AVEC SES GUILLEMETS RESTE UN NOM : le bouton « + Formule »
  // le rend a l identique, et l onglet de la categorie filtre toujours.
  const lu = await page.evaluate(() => {
    const bouton = document.querySelector('#staffPricingPage [data-add-formula]');
    const attendu = bouton.dataset.addFormula;
    bouton.click();
    const champ = document.getElementById('cevFamily');
    const recu = champ ? champ.value : null;
    cevCloseModal();
    return { attendu, recu };
  });
  ok(lu.attendu.includes('Soirees privees') && lu.recu === lu.attendu, '[console tarifs] « + Formule » garde la categorie exacte', JSON.stringify(lu).slice(0, 160));
  // La categorie est une SECTION de la page refaite : elle porte son nom tel
  // qu ecrit (piege compris, en texte) et ses propres lignes.
  const onglet = await page.evaluate(() => {
    const section = Array.from(document.querySelectorAll('#staffPricingPage [data-tf-famille]')).find((x) => /Soirees privees/.test(x.textContent));
    return section ? section.querySelectorAll('[data-cev-formula]').length : null;
  });
  ok(Number(onglet) > 0, '[console tarifs] la categorie a sa section et ses lignes', String(onglet));

  await pageTarifs(page);
  await ouvrirEtapes(page);
  ok(await page.evaluate(() => /hors catalogue/.test(document.getElementById('cevOverlay').textContent)), '[console etapes] MONTAGE : l identifiant hors catalogue est propose');
  await juger(page, 'console etapes', { temoin: true });
  await page.evaluate(() => cevCloseModal());

  await ficheClient(page);
  ok(await page.evaluate((nom) => document.body.textContent.includes(nom.slice(0, 6)), NOM_HOSTILE), '[console fiche] MONTAGE : le client hostile est a l ecran');
  await juger(page, 'console fiche client');
  const composeur = await page.evaluate(() => {
    window.__ouvert = null;
    const vrai = window.pv2OpenComposer;
    window.pv2OpenComposer = (o) => { window.__ouvert = o; };
    document.querySelector('[onclick*="pv2OpenComposer"]').click();
    window.pv2OpenComposer = vrai;
    return window.__ouvert;
  });
  ok(Boolean(composeur) && composeur.to === EMAIL_HOSTILE && composeur.name === NOM_HOSTILE, '[console fiche] le bouton Message recoit le nom et l adresse exacts', JSON.stringify(composeur).slice(0, 160));

  await pageFondateur(page);
  await juger(page, 'console fondateur', { temoin: true });
  await context.close();
  ok(erreurs.length === 0, '[console] aucune erreur JS', erreurs.slice(0, 3).join(' | '));
}

// ---------------------------------------------------------------------------
// UN ARGUMENT JS DANS UN ATTRIBUT : le vrai escapeJsString, dans un vrai onclick
// entre guillemets doubles puis simples. La valeur ressort a l identique, le
// bouton garde ses seuls attributs, et aucun piege ne part.
// ---------------------------------------------------------------------------
const HOSTILES = [
  '"', "'", '\\', '&', '<', '>', '"\'', '\\"', "\\'",
  '" onfocus="__poison.push(1)', "' onfocus='__poison.push(1)",
  '&quot;', '&#39;', '&#x27;', '&apos;', '&amp;#39;',
  "');__poison.push(1);//", '&#39;);__poison.push(1);//', '\\\');__poison.push(1);//',
  '</button><img src=x onerror=__poison.push(1)>', '</script><script>__poison.push(1)</script>',
  'Bowling & Laser', "L'Arcade \"Le Grand\" <12 ans", 'é ü € 🎳',
];

async function argumentsJs(browser, mutants = []) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await muter(page, mutants);
  await page.addInitScript(() => { window.__poison = []; });
  await page.goto(`${BASE}/reserver`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof escapeJsString === 'function');
  const rendus = await page.evaluate((hostiles) => hostiles.flatMap((x) => ['"', "'"].map((q) => {
    const hote = document.createElement('div');
    const chaine = q === '"' ? "'" : '"';
    hote.innerHTML = `<button id="essai" onclick=${q}window.__recu = ${chaine}${escapeJsString(x)}${chaine}${q}>ok</button>`;
    document.body.append(hote);
    window.__recu = undefined;
    const bouton = hote.querySelector('#essai');
    let erreur = '';
    if (bouton) { try { bouton.click(); } catch (e) { erreur = String(e.message); } }
    const rendu = { x, q, recu: window.__recu, attributs: bouton ? bouton.getAttributeNames().sort().join(',') : '', enfants: hote.children.length + hote.querySelectorAll('img,script').length, erreur };
    hote.remove();
    return rendu;
  })), HOSTILES);
  const piegees = await page.evaluate(() => window.__poison.length);
  await context.close();
  const fautifs = rendus.filter((r) => r.recu !== r.x || r.attributs !== 'id,onclick' || r.enfants !== 1 || r.erreur);
  return { rendus, fautifs, piegees };
}

// ---------------------------------------------------------------------------
// LA REGLE DU SOURCE. Dans un gestionnaire inline, escapeHtml seul est faux par
// construction : le navigateur rend l apostrophe a JavaScript. Elle se verifie
// sur tous les fichiers servis, y compris ceux qui ne parlent pas du catalogue.
// ---------------------------------------------------------------------------
const FICHIERS_SERVIS = () => fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => f.endsWith('.js')).map((f) => `assets/${f}`);

function reglesDuSource(lire = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')) {
  const fautes = [];
  let bons = 0;
  for (const rel of FICHIERS_SERVIS()) {
    lire(rel).split(/\r?\n/).forEach((ligne, i) => {
      for (const m of ligne.matchAll(/([(,]\s*)'\$\{(escapeHtml|esc|msEsc|dhEsc|gpEsc)\(/g)) {
        if (!/url\($/.test(ligne.slice(0, m.index + 1))) fautes.push(`${rel}:${i + 1}`);
      }
      bons += (ligne.match(/\bon[a-z]+="[^"]*\$\{(?:escJs|escapeJsString)\(/g) || []).length;
    });
  }
  return { fautes, bons };
}

function source() {
  const { fautes, bons } = reglesDuSource();
  ok(bons > 100, `[source] MONTAGE : les gestionnaires inline sont vus (${bons} arguments proteges)`);
  ok(fautes.length === 0, '[source] aucun argument JS de gestionnaire inline ne passe par escapeHtml seul', fautes.slice(0, 8).join(' '));
  // Contre-epreuve sans disque : la meme lecture, sur le fichier ramene a l ancien motif.
  const mute = reglesDuSource((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('escapeJsString(activity.activityId)').join('escapeHtml(activity.activityId)'));
  ok(mute.fautes.length > 0, '[mutation] la regle du source voit escapeHtml revenir dans un gestionnaire', String(mute.fautes.length));
}

const MUTANTS_CONSOLE = [
  // (2026-11-03) La page Tarifs refaite ne passe plus la categorie a AUCUN gestionnaire inline (ecouteurs delegues sur data-*) : affaiblir escapeJsString n y injecte plus rien, la contre-preuve de cette scene ne pouvait plus mordre. escapeJsString reste prouve par la scene « fiche » ci-dessous, et l attribut de la categorie par « l attribut de la categorie ».
  { nom: 'escapeJsString d avant, nom public', mutants: [{ fichier: 'assets/app-main.js', de: ".replace(/[\\\\'\"&<>]/g, (char) => `\\\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`);", vers: ".replace(/\\\\/g, '\\\\\\\\').replace(/'/g, \"\\\\'\");" }], scene: 'fiche', piege: /^r\.(name|email)/ },
  { nom: 'l attribut de la categorie', mutants: [{ fichier: 'assets/staff-pages-v2.js', de: 'data-add-formula="${esc(famille)}"', vers: 'data-add-formula="${famille}"' }], scene: 'tarifs', piege: /family|famille/ },
  { nom: 'la valeur hors catalogue', mutants: [{ fichier: 'assets/staff-pages-v2.js', de: '<option value="${esc(step.activityId)}" selected>', vers: '<option value="${step.activityId}" selected>' }], scene: 'etapes', piege: /^step\.activityId$/ },
];

async function contreEpreuvesConsole(browser) {
  for (const m of MUTANTS_CONSOLE) {
    const poses = [];
    const { context, page } = await consoleMontee(browser, m.mutants, poses);
    await pageTarifs(page).catch(() => {});
    if (m.scene === 'etapes') await ouvrirEtapes(page).catch(() => {});
    if (m.scene === 'fiche') await ficheClient(page).catch(() => {});
    const vus = await page.evaluate(() => Array.from(document.querySelectorAll('[data-poison]')).map((n) => n.getAttribute('data-poison')));
    await context.close();
    ok(vus.some((id) => m.piege.test(id)), `[mutation] ${m.nom} : le piege de la console s injecte`, `${vus.length} noeud(s) vu(s)`);
  }
  const avant = await argumentsJs(browser, MUTANTS_CONSOLE[0].mutants);
  ok(avant.fautifs.length > 0, `[mutation] escapeJsString d avant : ${avant.fautifs.length} texte(s) hostile(s) cassent l attribut`);
}

// ---------------------------------------------------------------------------
// L ECRITURE : le second verrou. Le vrai lib/catalog-store.js et le vrai
// lib/catalog-overrides.js, sur un pool qui n a rien a rendre : le refus tombe
// avant toute requete, et le contraste prouve qu un texte ordinaire passe.
// ---------------------------------------------------------------------------
const CATALOG_STORE = path.join(ROOT, 'lib/catalog-store.js');
const CATALOG_OVERRIDES = path.join(ROOT, 'lib/catalog-overrides.js');

let editionsEcriture = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function compileMute(contenu, nom) {
  const visees = editionsEcriture.filter((e) => path.join(ROOT, e.fichier) === path.resolve(nom));
  if (!visees.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split('\r\n').join('\n');
  for (const { de, vers } of visees) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ANCRE absente ou multiple : ${de.slice(0, 90)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};

function chargerEcriture(editions = []) {
  editionsEcriture = editions;
  delete require.cache[require.resolve(CATALOG_OVERRIDES)];
  delete require.cache[require.resolve(CATALOG_STORE)];
  const store = require(CATALOG_STORE);
  const overrides = require(CATALOG_OVERRIDES);
  editionsEcriture = [];
  return { store, overrides };
}

const POOL_VIDE = {
  query: async () => ({ rows: [] }),
  connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
};
const BALISE = '<img src=x onerror=alert(1)>';
const FORMULE = { name: 'Formule test', priceType: 'per_pax', priceValue: 20, steps: [{ activityId: 'bowling', count: 1, durationMinutes: 60 }], ownerClientId: 'fungalaxy' };
const ACTIVITE = { name: 'Activite test', priceType: 'per_pax', priceValue: 10, ownerClientId: 'fungalaxy' };
const ID_HOSTILE = "x');alert(1);//";

const ECRITURES = [
  ['le nom d une formule neuve', (m) => m.store.createFormula(POOL_VIDE, { ...FORMULE, name: `Soiree ${BALISE}` })],
  ['la famille d une formule', (m) => m.store.createFormula(POOL_VIDE, { ...FORMULE, family: BALISE })],
  ['une ligne de description', (m) => m.store.createFormula(POOL_VIDE, { ...FORMULE, descriptionLines: ['1h de bowling', BALISE] })],
  ['humanValidation', (m) => m.store.createFormula(POOL_VIDE, { ...FORMULE, humanValidation: BALISE })],
  ['le libelle d une etape', (m) => m.store.createFormula(POOL_VIDE, { ...FORMULE, steps: [{ activityId: 'bowling', count: 1, label: BALISE }] })],
  ['le nom edite d une formule', (m) => m.store.updateFormula(POOL_VIDE, { id: 'f1', name: BALISE, ownerClientId: 'fungalaxy' })],
  ['la description editee', (m) => m.store.updateFormula(POOL_VIDE, { id: 'f1', descriptionLines: [BALISE], ownerClientId: 'fungalaxy' })],
  ['le libelle d une etape editee', (m) => m.store.setFormulaSteps(POOL_VIDE, { id: 'f1', steps: [{ activityId: 'bowling', count: 1, label: BALISE }], ownerClientId: 'fungalaxy' })],
  ['l activite d une etape', (m) => m.store.createFormula(POOL_VIDE, { ...FORMULE, steps: [{ activityId: ID_HOSTILE, resourceType: 'bar_service', count: 1 }] }), 'identifiant invalide'],
  ['la ressource d une etape', (m) => m.store.setFormulaSteps(POOL_VIDE, { id: 'f1', steps: [{ activityId: 'bowling', resourceType: ID_HOSTILE, count: 1 }], ownerClientId: 'fungalaxy' }), 'identifiant invalide'],
  ['le nom d une activite neuve', (m) => m.store.createActivity(POOL_VIDE, { ...ACTIVITE, name: BALISE })],
  ['l unite de prix d une activite', (m) => m.store.createActivity(POOL_VIDE, { ...ACTIVITE, priceUnit: BALISE })],
  ['un risque d une activite', (m) => m.store.createActivity(POOL_VIDE, { ...ACTIVITE, riskDrivers: ['pluie', BALISE] })],
  ['le nom edite d une activite', (m) => m.store.updateActivity(POOL_VIDE, { id: 'bowling', name: BALISE, ownerClientId: 'fungalaxy' })],
  ['un risque edite', (m) => m.store.updateActivity(POOL_VIDE, { id: 'bowling', riskDrivers: [BALISE], ownerClientId: 'fungalaxy' })],
  ['le nom par la voie du fondateur', (m) => m.overrides.upsertFormuleOverride(POOL_VIDE, { formuleId: 'f1', centerId: 'all', patch: { name: BALISE } })],
  ['le nom par la voie des tarifs du client', (m) => m.overrides.upsertClientFormuleOverride(POOL_VIDE, { formuleId: 'f1', centerId: 'libramont', patch: { name: BALISE } })],
];

async function refus(fn, motif = 'le signe <') {
  try { await fn(); return { refuse: false, message: 'accepte' }; } catch (erreur) {
    return { refuse: erreur.expose === true && String(erreur.message).includes(motif), message: String(erreur.message).slice(0, 80) };
  }
}

async function ecriture() {
  const m = chargerEcriture();
  for (const [nom, ecrire, motif] of ECRITURES) {
    const r = await refus(() => ecrire(m), motif);
    ok(r.refuse, `[ecriture] ${nom} : refuse`, r.message);
  }
  // CONTRASTE : un refus qui mange les textes ordinaires ne serait pas une defense.
  const passe = await m.store.createFormula(POOL_VIDE, { ...FORMULE, name: 'Moins de 12 ans (< 12) & plus', family: 'Formules d\'ete', descriptionLines: ['5 > 3', "30 min d'arcades"] }).then(() => true, (e) => e.message);
  ok(passe === true, '[ecriture] contraste : « < 12 », « 5 > 3 », une apostrophe et une esperluette passent', String(passe));
  const pseudo = await m.store.createFormula(POOL_VIDE, { ...FORMULE, name: 'Pseudo', steps: [{ activityId: 'kara-box', resourceType: 'bar_service_then_autonomous', count: 1 }] }).then(() => true, (e) => e.message);
  ok(pseudo === true, '[ecriture] contraste : une pseudo-activite au format de la prod passe', String(pseudo));
  const proprietes = [
    ['le test de la balise', [{ fichier: 'lib/catalog-store.js', de: 'if (OUVRE_UNE_BALISE.test(text)) throw', vers: 'if (false) throw' }], 'le nom d une formule neuve'],
    ['le nom', [{ fichier: 'lib/catalog-store.js', de: "return refuserBalise(name, 'Nom');", vers: 'return name;' }], 'le nom d une formule neuve'],
    ['la famille', [{ fichier: 'lib/catalog-store.js', de: "return refuserBalise(family, 'Famille');", vers: 'return family;' }], 'la famille d une formule'],
    ['les textes courts', [{ fichier: 'lib/catalog-store.js', de: 'return refuserBalise(text, label);', vers: 'return text;' }], 'humanValidation'],
    ['la description', [{ fichier: 'lib/catalog-store.js', de: "refuserBalise(String(line).slice(0, 200), 'Description')", vers: 'String(line).slice(0, 200)' }], 'une ligne de description'],
    ['le libelle d une etape', [{ fichier: 'lib/catalog-store.js', de: 'refuserBalise(String(source.label).slice(0, 200), `Etape ${index + 1}`)', vers: 'String(source.label).slice(0, 200)' }], 'le libelle d une etape'],
    ['les risques', [{ fichier: 'lib/catalog-store.js', de: "value.map((driver) => refuserBalise(String(driver), 'Risque'))", vers: 'value.map(String)' }], 'un risque d une activite'],
    ['le nom par la voie des tarifs', [{ fichier: 'lib/catalog-overrides.js', de: "return catalogStore.refuserBalise(name, 'Nom');", vers: 'return name;' }], 'le nom par la voie des tarifs du client'],
    ['l identifiant d une etape', [{ fichier: 'lib/catalog-store.js', de: 'if ((activityId && !STEP_ID_PATTERN.test(activityId)) || (resourceType && !STEP_ID_PATTERN.test(resourceType))) {', vers: 'if (false) {' }], 'l activite d une etape'],
  ];
  for (const [garde, editions, cible] of proprietes) {
    const mute = chargerEcriture(editions);
    const [, ecrire, motif] = ECRITURES.find(([nom]) => nom === cible);
    const r = await refus(() => ecrire(mute), motif);
    ok(!r.refuse, `[mutation] sans le refus sur ${garde}, « ${cible} » passe`, r.message);
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
    await console_(browser);
    const args = await argumentsJs(browser);
    ok(args.rendus.length === HOSTILES.length * 2, `[argument] MONTAGE : ${args.rendus.length} rendus, guillemets doubles et simples`);
    ok(args.fautifs.length === 0, '[argument] chaque texte hostile ressort a l identique, sans attribut ni noeud en plus', JSON.stringify(args.fautifs.slice(0, 2)).slice(0, 240));
    ok(args.piegees === 0, '[argument] aucun piege ne part');
    source();
    await contreEpreuvesConsole(browser);
    await ecriture();
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

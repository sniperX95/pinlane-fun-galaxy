#!/usr/bin/env node
'use strict';
// =============================================================================
// LE PETIT PLUS DU FORMULAIRE FUN GALAXY
// -----------------------------------------------------------------------------
// Movsar, 2026-09-28 : « rajoute des ptits quick win ... vers la fin pour
// augmenter panier moyen ... et surtout pour les groupes ou il faut split la
// session, ca veut dire que le groupe A joue et le groupe B doit attendre que
// le groupe A termine : a ce moment-la dis-le et propose une activite qui dure
// un peu pres le temps d attente ... super clean pro, place au bon moment ».
//
//   [A] le serveur : une activite libre qui tourne (duckpin au-dela de ses
//       pistes, Fun Run au-dela d une session) fait attendre un sous-groupe,
//       comme les vagues du laser. Les cartes d attente disent qui attend et
//       combien de temps, l offre la plus proche de ce temps passe devant ; une
//       offre acceptee garde son tarif et eteint les autres ; la reservation
//       applique la meme regle.
//   [B] l ecran des horaires : « Pendant l attente » dit qui attend et combien
//       de temps ; « Ajouter » ne change le panier qu apres le serveur (meme
//       heure, memes pistes, exactement le montant annonce) ; la ligne vit dans
//       le detail du prix, le recapitulatif et l envoi ; « Retirer » la retire.
//   [C] le recapitulatif : « Envie d un peu plus ? », deux offres au plus ;
//       chacune ajoute exactement son montant, « Annuler » revient au total
//       d avant ; un tarif change entre-temps est refuse, la carte se retire,
//       le total ne bouge pas.
//   [D] sobriete : aucun degrade, aucune pastille ; a 390 px rien ne deborde.
//   [E] contre-epreuves : chaque regle retiree, ce gate ROUGIT.
//
// AUCUNE BASE, AUCUN ENVOI : les cles sont retirees avant tout chargement, la
// reservation part vers le serveur de dev, qui la garde en memoire.
// =============================================================================
const fs = require('fs');
const http = require('http');
const path = require('path');

delete process.env.RESEND_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PINLANE_PLUS_PORT || 4394);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CENTRE = 'libramont';

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(t) { console.log(`\n--- ${t}`); }
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (error) { return false; }
}
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const euros = (n) => `${(Math.round(Number(n) * 100) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

// ---------------------------------------------------------------------------
// [A] LE SERVEUR
// ---------------------------------------------------------------------------
function samediProchain() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = samediProchain();
function purger() {
  Object.keys(require.cache)
    .filter((cle) => cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`))
    .forEach((cle) => { delete require.cache[cle]; });
}
function charger() {
  purger();
  const database = require(path.join(ROOT, 'lib/database.js'));
  database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: CENTRE });
  return {
    availability: require(path.join(ROOT, 'api/public-availability.js')),
    vp: require(path.join(ROOT, 'lib/visit-program.js')),
    reservationRequest: require(path.join(ROOT, 'lib/reservation-request.js')),
    opsKnowledge: require(path.join(ROOT, 'lib/ops-knowledge.js')),
    catalogue: require(path.join(ROOT, 'lib/activity-catalog.js')),
  };
}
function appel(api, programme, pax) {
  const params = new URLSearchParams({ centerId: CENTRE, date: DATE, type: 'visite', pax: String(pax), program: JSON.stringify(programme), softReserve: '1' });
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: `/api/public-availability?${params.toString()}`, headers: { host: '127.0.0.1' }, on() {}, setEncoding() {} };
    const res = { statusCode: 0, setHeader() {}, writeHead(c) { this.statusCode = c; }, end(b) { try { resolve(JSON.parse(String(b || '{}'))); } catch (e) { reject(e); } } };
    api(req, res).catch(reject);
  });
}
// UNE MUTATION DU DISQUE, restauree quoi qu il arrive (meme motif que
// wait-offer-check) : seule facon de prouver qu une regle serveur mord.
// L ancre s ecrit en LF ; une copie Windows (autocrlf) lit le depot en CRLF :
// l ancre prend les fins de ligne du fichier, sinon la contre-epreuve se
// desarme sur une machine et pas sur l autre. Et le module mute ne survit pas
// a sa mutation : le cache est vide a la restauration, sinon la suite du gate
// (le serveur de dev compris) tournerait sur le code casse.
async function avecMutation(rel, de, vers, run) {
  const fichier = path.join(ROOT, rel);
  const original = fs.readFileSync(fichier, 'utf8');
  const fin = original.includes('\r\n') ? '\r\n' : '\n';
  const ancre = de.replace(/\r?\n/g, fin);
  const remplacement = vers.replace(/\r?\n/g, fin);
  const n = original.split(ancre).length - 1;
  if (n !== 1) throw new Error(`ancre trouvee ${n} fois dans ${rel}`);
  try {
    fs.writeFileSync(fichier, original.split(ancre).join(remplacement));
    return await run();
  } finally {
    fs.writeFileSync(fichier, original);
    purger();
    if (fs.readFileSync(fichier, 'utf8') !== original) throw new Error(`${rel} non restaure`);
  }
}
const DUCK = [{ activityId: 'bowling', duration: 1 }, { activityId: 'duckpin_bowling', duration: 1 }];
const FUN = [{ activityId: 'bowling', duration: 1 }, { activityId: 'fun_run', minutes: 15 }];
const cartesAttente = (r) => ((r && r.complements) || []).filter((c) => c.kind === 'attente');

async function serveurA() {
  section('[A] LE SERVEUR : UNE ACTIVITE QUI TOURNE FAIT ATTENDRE');
  const { availability, vp, reservationRequest, opsKnowledge, catalogue } = charger();
  const centre = opsKnowledge.getCenter(CENTRE);
  const offres = (centre && centre.waitOffers) || [];
  const duck = catalogue.listCenterActivities(CENTRE).find((a) => a.id === 'duckpin_bowling') || {};
  const fun = catalogue.listCenterActivities(CENTRE).find((a) => a.id === 'fun_run') || {};
  const alaFois = Number(duck.capacityPerUnit) * Number(duck.units);
  const placesFun = Number(fun.capacityPerUnit) * Math.max(1, Number(fun.units) || 1);
  ok(offres.length >= 2 && alaFois > 0 && placesFun > 0, 'montage : le centre declare ses offres d attente, le duckpin ses pistes, le Fun Run ses places', JSON.stringify({ offres: offres.map((o) => o.activityId), duckpin: `${duck.units}x${duck.capacityPerUnit}`, funRun: placesFun }));

  // Le duckpin : 20 joueurs, alaFois a la fois, donc un second tour.
  const grand = alaFois + 8;
  const t = vp.attenteDesTours({ centerId: CENTRE, pax: grand, items: DUCK });
  ok(Boolean(t) && t.personnes === grand - alaFois && t.minutes === 60 && t.activityId === 'duckpin_bowling',
    `duckpin a ${grand} : ${grand - alaFois} personnes attendent le tour suivant, 1 h (la duree d un tour)`, JSON.stringify(t));
  ok(vp.groupIsSplit({ centerId: CENTRE, pax: grand, items: DUCK }) === true && vp.groupIsSplit({ centerId: CENTRE, pax: alaFois, items: DUCK }) === false,
    `le groupe est scinde au-dela de ${alaFois}, entier jusque-la`);
  const f = vp.attenteDesTours({ centerId: CENTRE, pax: 12, items: FUN });
  const sessions = Math.ceil(12 / placesFun);
  ok(Boolean(f) && f.personnes === 12 - (sessions - 1) * placesFun && f.minutes === (sessions - 1) * 15,
    `Fun Run a 12 : ${sessions} sessions de ${placesFun}, la derniere attend ${(sessions - 1) * 15} min`, JSON.stringify(f));
  ok(vp.attenteDesTours({ centerId: CENTRE, pax: grand, items: [{ activityId: 'bowling', duration: 1 }] }) === null
    && vp.attenteDesTours({ centerId: '', pax: grand, items: DUCK }) === null,
    'sans activite qui tourne, ou sans centre nomme : personne n attend');

  const r0 = await appel(availability, DUCK, grand);
  const cartes = cartesAttente(r0);
  const ecart = (c) => Math.abs(c.attente.dureeOffre - c.attente.minutes);
  ok(cartes.length === offres.length && cartes.every((c) => c.attente && c.attente.personnes === grand - alaFois && c.attente.minutes === 60 && c.pax === grand - alaFois),
    'une carte par offre du centre, chacune dit qui attend et combien de temps', JSON.stringify(cartes.map((c) => ({ id: c.id, attente: c.attente }))));
  ok(cartes.every((c) => { const o = offres.find((x) => x.activityId === c.patch.activityId); return o && c.prixParPersonne === o.pricePerPax && Math.round(c.deltaTotal * 100) === Math.round(o.pricePerPax * c.pax * 100); }),
    'chacune au tarif d attente declare, pour les seules personnes qui attendent', cartes.map((c) => `${c.id} ${c.prixParPersonne} x ${c.pax} = ${c.deltaTotal}`).join(' | '));
  ok(cartes.length >= 2 && ecart(cartes[0]) <= ecart(cartes[1]),
    'l offre qui dure le plus pres du temps d attente passe devant', cartes.map((c) => `${c.id} ${c.attente.dureeOffre} min`).join(' puis '));
  ok(cartes.every((c) => c.prixCatalogueParPersonne === null || c.prixCatalogueParPersonne > c.prixParPersonne),
    'une remise ne se dit que si le catalogue la prouve', cartes.map((c) => `${c.id}:${c.prixCatalogueParPersonne}`).join(' '));

  const premiere = cartes[0];
  const avec = [...DUCK, { activityId: premiere.patch.activityId, waitOffer: true, participants: premiere.patch.options.participants }];
  const r1 = await appel(availability, avec, grand);
  const ligne = ((r1.program && r1.program.items) || []).find((i) => i.waitOffer === true) || null;
  const s0 = (r0.slots || [])[0] || {}, s1 = (r1.slots || [])[0] || {};
  ok(r1.ok !== false && Math.round((r1.price - r0.price) * 100) === Math.round(premiere.deltaTotal * 100) && s1.time === s0.time,
    'acceptee, l offre coute exactement le montant annonce, meme creneau', `${r0.price} -> ${r1.price} (annonce +${premiere.deltaTotal}), ${s0.time} / ${s1.time}`);
  ok(Boolean(ligne) && ligne.participants === premiere.pax && ligne.price === premiere.deltaTotal,
    'la ligne d attente garde son tarif et ses participants', JSON.stringify(ligne && { id: ligne.activityId, p: ligne.participants, prix: ligne.price }));
  ok(cartesAttente(r1).length === 0, 'une offre acceptee eteint les autres : le groupe qui attend est occupe', JSON.stringify(cartesAttente(r1).map((c) => c.id)));

  const demande = (pax) => reservationRequest.normalizeReservationRequest({
    centerId: CENTRE, date: DATE, startTime: s0.time || '10:00', pax, name: 'Groupe Test', phone: '+32470000000', email: 'groupe@example.org', channel: 'public', type: 'visite',
    program: [...DUCK, { activityId: premiere.patch.activityId, waitOffer: true, participants: Math.min(premiere.pax, pax) }],
  });
  const ligneDe = (fn) => { try { const d = fn(); return ((d && d.program && d.program.items) || []).find((i) => i.activityId === premiere.patch.activityId) || null; } catch (e) { return { erreur: e.message }; } };
  const scinde = ligneDe(() => demande(grand));
  const entier = ligneDe(() => demande(alaFois));
  ok(Boolean(scinde && scinde.waitOffer === true), 'la reservation d un groupe scinde facture le tarif d attente', JSON.stringify(scinde && { prix: scinde.price, attente: scinde.waitOffer }));
  ok(Boolean(entier) && entier.waitOffer !== true, 'celle d un groupe entier le refuse', JSON.stringify(entier && { prix: entier.price, attente: entier.waitOffer || false, erreur: entier.erreur }));
  // LE DOSSIER ENREGISTRE (campagne du 2026-09-29) : la base jetait le drapeau
  // d attente et son tarif a l ecriture, la ligne se relisait au catalogue.
  // On passe par le vrai filtre de la base, puis on relit comme la reservation.
  const rangerEtRelire = () => {
    const database = require(path.join(ROOT, 'lib/database.js'));
    const d = demande(grand);
    const range = database.normalizeReservationPayload({ centerId: CENTRE, type: d.type, date: DATE, startTime: s0.time || '10:00', duration: 1, pax: grand, name: 'QA', phone: '+32491000000', email: 'qa@example.com', program: d.program }, {}).program;
    const ligneRangee = ((range && range.items) || []).find((i) => i.activityId === premiere.patch.activityId) || {};
    const relu = reservationRequest.normalizeReservationRequest({ centerId: CENTRE, date: DATE, startTime: s0.time || '10:00', pax: grand, name: 'Groupe Test', phone: '+32470000000', email: 'groupe@example.org', channel: 'public', type: 'visite', program: range.items });
    return { attente: ligneRangee.waitOffer === true, tarif: ligneRangee.waitPricePerPax, avant: Number(d.programPrice), apres: Number(relu.programPrice) };
  };
  const rr = rangerEtRelire();
  ok(rr.attente && rr.tarif === premiere.prixParPersonne && rr.apres === rr.avant,
    'la ligne d attente se range et se relit a l identique (vrai filtre de la base) : meme drapeau, meme tarif, meme prix', JSON.stringify(rr));

  section('[E] CONTRE-EPREUVES DU SERVEUR');
  try {
    // La regle du groupe scinde decide du TARIF (les cartes, elles, lisent
    // l attente elle-meme) : sans l attente des tours, l offre acceptee
    // repasse au prix du catalogue, la ligne perd son drapeau et le montant
    // annonce ne tient plus.
    const sansTours = await avecMutation('lib/visit-program.js',
      '  return Boolean(attenteDesTours({ centerId: maison, pax: people, items: lignes }));',
      '  return false;',
      async () => {
        const m = charger();
        const a = await appel(m.availability, DUCK, grand);
        const b = await appel(m.availability, avec, grand);
        const drapeau = ((b.program && b.program.items) || []).some((i) => i.waitOffer === true);
        return { drapeau, ecart: Math.round((Number(b.price) - Number(a.price)) * 100) / 100 };
      });
    ok(!sansTours.drapeau && sansTours.ecart !== premiere.deltaTotal,
      'sans l attente des tours dans la regle du groupe scinde, l offre acceptee n est plus facturee au tarif d attente : ce gate ROUGIRAIT', JSON.stringify(sansTours));
  } catch (error) { ok(false, 'contre-epreuve des tours montable', error.message); }
  try {
    const sansGarde = await avecMutation('lib/booking-complements.js',
      '  if (context.programme.items.some((ligne) => ligne.waitOffer === true)) return [];\n',
      '',
      async () => { const m = charger(); return cartesAttente(await appel(m.availability, avec, grand)).length; });
    ok(sansGarde > 0, 'sans le garde « une offre d attente suffit », une seconde offre revient : ce gate ROUGIRAIT', `${sansGarde} carte(s)`);
  } catch (error) { ok(false, 'contre-epreuve du garde montable', error.message); }
  try {
    const sansDrapeau = await avecMutation('lib/booking-complements.js',
      '  if (item.waitOffer === true) ligne.waitOffer = true;\n',
      '',
      async () => { const m = charger(); return cartesAttente(await appel(m.availability, avec, grand)).length; });
    ok(sansDrapeau > 0, 'sans le drapeau d attente dans les programmes candidats, le garde ne voit plus l offre acceptee : ce gate ROUGIRAIT', `${sansDrapeau} carte(s)`);
  } catch (error) { ok(false, 'contre-epreuve du drapeau montable', error.message); }
  try {
    const sansBase = await avecMutation('lib/database.js',
      '    if (item.waitOffer === true) out.waitOffer = true;\n',
      '',
      async () => { charger(); return rangerEtRelire(); });
    ok(!(sansBase.attente && sansBase.apres === sansBase.avant), 'sans le drapeau d attente dans le filtre de la base, la ligne se relit au catalogue : ce gate ROUGIRAIT', JSON.stringify(sansBase));
  } catch (error) { ok(false, 'contre-epreuve du filtre de la base montable', error.message); }
  return { grand, premiere };
}

// ---------------------------------------------------------------------------
// LE FORMULAIRE, sur le serveur de dev (vrai calcul de disponibilite, aucune
// base, la reservation gardee en memoire). Une contre-epreuve du formulaire
// est servie en memoire a la place du fichier : le disque n est pas touche.
// ---------------------------------------------------------------------------
let formulaireCasse = null;
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (formulaireCasse && url.pathname === '/assets/fungalaxy-booking.js') {
      const src = fs.readFileSync(path.join(ROOT, 'assets/fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.split(formulaireCasse.de).join(formulaireCasse.vers));
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}
async function allerAuMois(page, dateStr) {
  const [y, mo] = dateStr.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (x) => document.querySelector('#calTitle').textContent.trim() !== x, 3000, titre);
  }
  return attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, dateStr);
}
// Jusqu a l ecran des horaires, plan calcule. Les reponses de la
// disponibilite sont gardees (window.__plusReponses) : elles font foi pour les
// montants attendus.
async function jusquAuxHoraires(browser, mock, { pax, activites, largeur = 1440, hauteur = 900, etiquette = 'plus' }) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  const reponses = [];
  page.on('response', async (r) => {
    if (r.url().indexOf('/api/public-availability?') < 0) return;
    try { reponses.push({ url: r.url(), json: await r.json() }); } catch (e) { /* reponse coupee */ }
  });
  await page.goto(`${BASE_URL}/fungalaxy/libramont?v=${etiquette}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body.is-ready', { timeout: 20000 });
  await page.click('#dayBtn');
  await allerAuMois(page, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await page.fill('#paxInput', String(pax));
  await page.dispatchEvent('#paxInput', 'input');
  await page.locator('#paxInput').blur();
  await page.click('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
  for (const id of activites) await page.click(`#gridAct .fg-card[data-activity="${id}"]`);
  await page.click('#goHours');
  const pret = await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering')
    && document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy') && !document.querySelector('#goContact').disabled, 20000);
  return { ctx, page, erreurs, reponses, pret };
}
const derniere = (reponses) => (reponses.length ? reponses[reponses.length - 1].json : null);
async function lireAttente(page) {
  return page.evaluate(() => {
    const b = document.querySelector('#plus-heures');
    const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const prix = document.querySelector('#planZone .fg-visit__price');
    return {
      bloc: Boolean(b),
      tete: txt(b && b.querySelector('.fg-plus__head')),
      offres: b ? Array.from(b.querySelectorAll('[data-plus]')).map((x) => x.dataset.plus) : [],
      rangees: b ? Array.from(b.querySelectorAll('.fg-plus__item')).map(txt) : [],
      prise: txt(b && b.querySelector('.fg-plus__item.is-pris')),
      retirer: Boolean(b && b.querySelector('[data-plus-retirer]')),
      statut: txt(b && b.querySelector('.fg-plus__statut')),
      ton: b && b.querySelector('.fg-plus__statut') ? b.querySelector('.fg-plus__statut').dataset.ton : '',
      prix: prix ? parseFloat(prix.firstChild.textContent.replace(/[^\d,]/g, '').replace(',', '.')) : null,
      detailPrix: Array.from(document.querySelectorAll('#planZone .fg-visit__prices > div')).map(txt),
      libres: txt(document.querySelector('#planZone .fg-visit__step--free')),
      focus: document.activeElement ? document.activeElement.id : '',
    };
  });
}
async function remplirContact(page) {
  await page.click('#goContact');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
  await page.fill('#cPrenom', 'Camille');
  await page.fill('#cNom', 'Test');
  await page.fill('#cEmail', 'groupe@example.org');
  await page.fill('#cTel', '0491301667');
  await page.click('.fg-occasion[data-occasion="anniversaire"]');
  await page.check('#cConsent');
  await page.click('#goRecap');
  return attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
}
async function lireRecapPlus(page) {
  return page.evaluate(() => {
    const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const b = document.querySelector('#plus-recap');
    const t = document.querySelector('#totalAmount');
    return {
      bloc: Boolean(b),
      tete: txt(b && b.querySelector('.fg-plus__head')),
      offres: b ? Array.from(b.querySelectorAll('[data-plus]')).map((x) => x.dataset.plus) : [],
      montants: b ? Array.from(b.querySelectorAll('.fg-plus__amt b')).map(txt) : [],
      statut: txt(b && b.querySelector('.fg-plus__statut')),
      ton: b && b.querySelector('.fg-plus__statut') ? b.querySelector('.fg-plus__statut').dataset.ton : '',
      annuler: Boolean(b && b.querySelector('[data-plus-annuler]')),
      total: t ? Number(t.dataset.total) : null,
      items: Array.from(document.querySelectorAll('#recap .fg-recap__item')).map(txt),
      calme: document.querySelector('#recap').classList.contains('is-calme'),
    };
  });
}

// ---------------------------------------------------------------------------
// [B] L ECRAN DES HORAIRES : PENDANT L ATTENTE
// ---------------------------------------------------------------------------
async function attenteB(browser, mock, { grand }) {
  section('[B] L ECRAN DES HORAIRES : PENDANT L ATTENTE');
  const s = await jusquAuxHoraires(browser, mock, { pax: grand, activites: ['bowling', 'duckpin_bowling'], etiquette: 'plus-attente' });
  const { page } = s;
  try {
    ok(s.pret, 'montage : l ecran des horaires a son plan');
    const rep0 = derniere(s.reponses);
    const cartes = cartesAttente(rep0);
    const a0 = await lireAttente(page);
    const p = cartes[0] ? cartes[0].attente.personnes : 0;
    ok(a0.bloc && a0.offres.join(' ') === cartes.map((c) => c.id).join(' ') && cartes.length >= 1,
      'le bloc « Pendant l attente » propose les offres du serveur, dans son ordre', `${a0.offres.join(' ')} / ${cartes.map((c) => c.id).join(' ')}`);
    ok(new RegExp(`^Pendant l’attente Votre groupe joue en plusieurs fois : ${p} personnes attendent 1 h leur tour\\.`).test(a0.tete),
      'il dit qui attend et combien de temps', a0.tete);
    ok(cartes.every((c, i) => a0.rangees[i] && a0.rangees[i].indexOf(euros(c.prixParPersonne)) >= 0 && /par personne/.test(a0.rangees[i]) && a0.rangees[i].indexOf('pendant l’attente') >= 0),
      'chaque offre dit son prix par personne et pour quoi', a0.rangees.join(' | '));
    ok(a0.prix === Number(rep0.price), 'le prix de la visite est celui du serveur', `${a0.prix} / ${rep0.price}`);

    const requetes = [];
    page.on('request', (q) => { if (q.url().indexOf('/api/public-availability?') >= 0) requetes.push(new URL(q.url()).searchParams.get('program')); });
    await page.click(`#plus-heures [data-plus="${cartes[0].id}"]`);
    const fini = await attendre(page, () => { const z = document.querySelector('#plus-heures .fg-plus__statut'); return z && z.dataset.ton === 'ok'; }, 15000);
    const a1 = await lireAttente(page);
    const rep1 = derniere(s.reponses);
    const envoye = requetes.length ? JSON.parse(requetes[requetes.length - 1]) : [];
    const ligne = envoye.find((l) => l.waitOffer === true) || null;
    ok(fini && a1.prix === rep0.price + cartes[0].deltaTotal && Number(rep1.price) === a1.prix,
      'Ajouter : le prix monte EXACTEMENT du montant annonce', `${rep0.price} + ${cartes[0].deltaTotal} = ${a1.prix}`);
    ok(Boolean(ligne) && ligne.activityId === cartes[0].patch.activityId && ligne.participants === p,
      'la demande porte la ligne d attente, pour les seules personnes qui attendent', JSON.stringify(ligne));
    ok(a1.prise.indexOf(`pour ${p} personnes, ajouté à votre visite`) >= 0 && a1.retirer && a1.offres.length === 0,
      'la ligne s affiche acceptee, avec « Retirer », et les autres offres se taisent', a1.prise);
    const nomLigne = ((((rep1 && rep1.program && rep1.program.items) || []).find((i) => i.waitOffer === true)) || {}).name || '?';
    ok(a1.detailPrix.some((l) => l.indexOf(`pendant l’attente, ${p} personnes`) >= 0 && l.indexOf(euros(cartes[0].deltaTotal)) >= 0) && a1.libres.indexOf(nomLigne) < 0,
      'elle a sa ligne dans le detail du prix, pas dans les activites libres', a1.detailPrix.join(' | '));
    ok(a1.focus === 'plus-heures' && /^Ajout confirmé : .+ pour les \d+ personnes qui attendent, \+/.test(a1.statut), 'le focus revient sur le bloc, la phrase dit ce qui a ete ajoute', `${a1.focus} « ${a1.statut} »`);

    await page.click('#plus-heures [data-plus-retirer]');
    await attendre(page, () => { const z = document.querySelector('#plus-heures .fg-plus__statut'); return z && z.dataset.ton === 'ok' && /Offre retirée/.test(z.textContent); }, 15000);
    const a2 = await lireAttente(page);
    ok(a2.prix === rep0.price && a2.offres.length === cartes.length && !a2.prise, 'Retirer : le prix redescend, les offres reviennent', `${a2.prix} / ${rep0.price}`);

    // Reprise, puis le recapitulatif et l envoi.
    await page.click(`#plus-heures [data-plus="${cartes[0].id}"]`);
    await attendre(page, () => { const z = document.querySelector('#plus-heures .fg-plus__statut'); return z && z.dataset.ton === 'ok'; }, 15000);
    ok(await remplirContact(page), 'montage : coordonnees remplies, recapitulatif ouvert');
    const r = await lireRecapPlus(page);
    ok(r.items.some((i) => i.indexOf(`pendant l’attente · ${p} personnes`) >= 0) && r.total === rep0.price + cartes[0].deltaTotal,
      'le recapitulatif porte la ligne d attente et le total avec elle', `${r.items.join(' | ')} · ${r.total}`);
    await page.click('#confirmBtn');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 15000);
    const pose = mock.dernierePose.body || {};
    const envoi = (pose.program || []).find((l) => l.waitOffer === true) || null;
    ok(Boolean(envoi) && envoi.participants === p && Number(pose.price) === rep0.price + cartes[0].deltaTotal,
      'l envoi porte la ligne d attente et le prix affiche (le serveur de dev la garde en memoire, rien ne part)', JSON.stringify({ envoi, prix: pose.price }));
    ok(s.erreurs.length === 0, 'aucune erreur dans la page', s.erreurs.join(' | '));
  } finally { await s.ctx.close(); }
}

// UN SERVEUR QUI NE POSE PAS L OFFRE (le groupe ne tourne plus, l offre a
// quitte le centre) : la ligne revient sans drapeau ni tarif d attente, le
// prix ne bouge pas. La carte se retire et le dit ; jamais « Ajout confirmé »
// sur une ligne que le serveur n a pas faite.
async function attenteNonPosee(browser, mock, { grand, etiquette }) {
  const s = await jusquAuxHoraires(browser, mock, { pax: grand, activites: ['bowling', 'duckpin_bowling'], etiquette });
  const { page } = s;
  try {
    const rep0 = derniere(s.reponses);
    const carte = cartesAttente(rep0)[0] || null;
    if (!s.pret || !carte) return { pret: false };
    await page.route('**/api/public-availability*', async (route) => {
      const reponse = await route.fetch();
      const j = await reponse.json();
      ((j.program && j.program.items) || []).forEach((i) => {
        if (i.waitOffer === true) { delete i.waitOffer; delete i.waitPricePerPax; i.price = null; i.priceKnown = false; }
      });
      j.price = Number(rep0.price);
      if (j.program) j.program.price = Number(rep0.price);
      await route.fulfill({ response: reponse, json: j });
    });
    await page.click(`#plus-heures [data-plus="${carte.id}"]`);
    await attendre(page, () => { const z = document.querySelector('#plus-heures .fg-plus__statut'); return z && (z.dataset.ton === 'ok' || z.dataset.ton === 'ko'); }, 15000);
    return { pret: true, a: await lireAttente(page), prix0: Number(rep0.price), carte: carte.id };
  } finally { await s.ctx.close(); }
}
function verifierAttenteNonPosee(res, attendu) {
  const a = res.a || {};
  const refuse = Boolean(res.pret) && a.ton === 'ko' && a.statut === 'Cette offre n’est plus disponible.' && a.prix === res.prix0 && a.offres.indexOf(res.carte) < 0 && !a.prise;
  if (attendu) {
    ok(refuse, 'un serveur qui ne pose pas l offre d attente : la carte se retire et le dit, le prix ne bouge pas, jamais « Ajout confirmé »',
      JSON.stringify({ pret: res.pret, statut: a.statut, prix: a.prix, avant: res.prix0, offres: a.offres }));
  }
  return refuse;
}

// ---------------------------------------------------------------------------
// [C] LE RECAPITULATIF : ENVIE D UN PEU PLUS ?
// ---------------------------------------------------------------------------
async function recapC(browser, mock, { largeur = 1440, hauteur = 900, etiquette = 'bureau', casse = false } = {}) {
  const s = await jusquAuxHoraires(browser, mock, { pax: 6, activites: ['bowling', 'laser_game'], largeur, hauteur, etiquette: `plus-recap-${etiquette}` });
  const { page } = s;
  const res = { erreurs: s.erreurs };
  try {
    res.pret = s.pret && await remplirContact(page);
    res.rep0 = derniere(s.reponses);
    res.cartes = ((res.rep0 && res.rep0.complements) || []).filter((c) => c.kind !== 'attente');
    res.r0 = await lireRecapPlus(page);
    const cible = res.cartes[0];
    if (!cible) return res;
    // Le refus d abord, sur une page a part : le serveur annonce un tarif qui
    // a monte depuis la carte (5 EUR de plus que promis).
    if (casse) {
      await page.route('**/api/public-availability*', async (route) => {
        const reponse = await route.fetch();
        const j = await reponse.json();
        j.price = Number(j.price) + 5;
        await route.fulfill({ response: reponse, json: j });
      });
      await page.click(`#plus-recap [data-plus="${cible.id}"]`);
      await attendre(page, () => { const z = document.querySelector('#plus-recap .fg-plus__statut'); return z && (z.dataset.ton === 'ko' || z.dataset.ton === 'ok'); }, 15000);
      res.refus = await lireRecapPlus(page);
      return res;
    }
    await page.click(`#plus-recap [data-plus="${cible.id}"]`);
    await attendre(page, () => { const z = document.querySelector('#plus-recap .fg-plus__statut'); return z && z.dataset.ton === 'ok'; }, 15000);
    res.r1 = await lireRecapPlus(page);
    res.focus = await page.evaluate(() => (document.activeElement ? document.activeElement.id : ''));
    res.sobre = await page.evaluate(() => {
      const bloc = document.querySelector('#plus-recap');
      const tous = bloc ? [bloc, ...bloc.querySelectorAll('*')] : [];
      const degrades = tous.filter((el) => ['', '::before', '::after'].some((p) => /gradient\(/.test(getComputedStyle(el, p || null).backgroundImage))).map((el) => el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className);
      const pastilles = tous.filter((el) => { const c = getComputedStyle(el); return parseFloat(c.borderTopLeftRadius) >= 20 && (c.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(c.borderTopWidth) > 0); }).length;
      const r = bloc ? bloc.getBoundingClientRect() : { right: 0 };
      const deborde = tous.filter((el) => el.getBoundingClientRect().right > r.right + 0.5).length;
      return { degrades, pastilles, deborde, pageLarge: document.documentElement.scrollWidth > window.innerWidth };
    });
    await page.click('#plus-recap [data-plus-annuler]');
    await attendre(page, () => { const z = document.querySelector('#plus-recap .fg-plus__statut'); return z && z.dataset.ton === 'ok' && /^Annulé : votre visite revient/.test(z.textContent); }, 15000);
    res.r2 = await lireRecapPlus(page);
    return res;
  } finally { await s.ctx.close(); }
}
function verifierRecap(res, etiquette) {
  section(`[C] LE RECAPITULATIF : ENVIE D UN PEU PLUS ? (${etiquette})`);
  ok(res.pret, 'montage : horaires, coordonnees, recapitulatif');
  const cartes = res.cartes || [];
  ok(cartes.length >= 1 && cartes.length <= 2 && res.r0.bloc && res.r0.tete === 'Envie d’un peu plus ? Vos horaires ne bougent pas.' && res.r0.offres.join(' ') === cartes.map((c) => c.id).join(' '),
    'deux offres au plus, celles du serveur, sous « Envie d un peu plus ? »', `${res.r0.offres.join(' ')} · « ${res.r0.tete} »`);
  ok(cartes.every((c, i) => res.r0.montants[i] === `+${euros(c.deltaTotal)}`), 'chacune dit son montant exact', res.r0.montants.join(' | '));
  if (!res.r1) { ok(false, 'aucune offre a accepter'); return; }
  ok(res.r1.total === res.r0.total + cartes[0].deltaTotal && res.r1.ton === 'ok' && res.r1.annuler,
    'Ajouter : le total monte EXACTEMENT du montant annonce, « Annuler » est offert', `${res.r0.total} + ${cartes[0].deltaTotal} = ${res.r1.total} « ${res.r1.statut} »`);
  ok(res.r1.calme && res.focus === 'plus-recap', 'le recapitulatif se redessine sur place (ses lignes ne rejouent pas leur entree), le focus revient sur le bloc', `${res.r1.calme} ${res.focus}`);
  ok(res.r2.total === res.r0.total && res.r2.offres.join(' ') === res.r0.offres.join(' '), 'Annuler : le total revient, les offres aussi', `${res.r2.total} / ${res.r0.total}`);
  ok(res.sobre && res.sobre.degrades.length === 0 && res.sobre.pastilles === 0, 'sobriete : aucun degrade, aucune pastille dans le bloc', JSON.stringify(res.sobre));
  ok(res.sobre && res.sobre.deborde === 0 && !res.sobre.pageLarge, 'rien ne deborde du bloc ni de la page', JSON.stringify(res.sobre));
  ok(res.erreurs.length === 0, 'aucune erreur dans la page', res.erreurs.join(' | '));
}
function verifierRefus(res, attendu) {
  const r = res.refus || {};
  const refuse = r.ton === 'ko' && r.statut === 'Le tarif de cette option vient de changer.' && r.total === res.r0.total && r.offres.indexOf(res.cartes[0].id) < 0;
  if (attendu) ok(refuse, 'un tarif qui a monte depuis la carte est refuse : la carte se retire, le total ne bouge pas', JSON.stringify({ statut: r.statut, total: r.total, avant: res.r0.total, offres: r.offres }));
  return refuse;
}

async function main() {
  const serveurRes = await serveurA();
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const srv = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    await attenteB(browser, mock, serveurRes);
    section('[B] UN SERVEUR QUI NE POSE PAS L OFFRE D ATTENTE');
    verifierAttenteNonPosee(await attenteNonPosee(browser, mock, { grand: serveurRes.grand, etiquette: 'attente-non-posee' }), true);
    verifierRecap(await recapC(browser, mock, {}), 'bureau');
    verifierRecap(await recapC(browser, mock, { largeur: 390, hauteur: 844, etiquette: 'telephone' }), 'telephone 390 px');
    section('[C] LE TARIF QUI A CHANGE');
    verifierRefus(await recapC(browser, mock, { casse: true, etiquette: 'refus' }), true);
    section('[E] CONTRE-EPREUVES DU FORMULAIRE');
    const src = fs.readFileSync(path.join(ROOT, 'assets/fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
    const casses = [
      {
        de: "      if (ecart > (Number(carte.deltaTotal) || 0) + 0.001) return 'Le tarif de cette option vient de changer.';\n",
        jouer: async () => !verifierRefus(await recapC(browser, mock, { casse: true, etiquette: 'refus-casse' }), false),
        label: 'sans la verification du prix, l option plus chere passe : ce gate ROUGIRAIT',
      },
      {
        de: "      if (carte.kind === 'attente' && !(((j.program && j.program.items) || []).some(function (it) { return it.waitOffer === true && it.activityId === carte.patch.activityId; }))) return 'Cette offre n’est plus disponible.';\n",
        jouer: async () => !verifierAttenteNonPosee(await attenteNonPosee(browser, mock, { grand: serveurRes.grand, etiquette: 'attente-casse' }), false),
        label: 'sans la verification de la ligne posee, « Ajout confirmé » sur une offre que le serveur n a pas faite : ce gate ROUGIRAIT',
      },
    ];
    for (const c of casses) {
      if (src.split(c.de).length !== 2) { ok(false, `contre-epreuve montable : ancre introuvable (${c.de.trim().slice(0, 60)})`); continue; }
      formulaireCasse = { de: c.de, vers: '' };
      try { ok(await c.jouer(), c.label); } finally { formulaireCasse = null; }
    }
  } finally {
    formulaireCasse = null;
    await browser.close();
    srv.close();
  }
  console.log(`\n${echecs === 0 ? 'fungalaxy-plus-check: ALL OK' : `fungalaxy-plus-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });

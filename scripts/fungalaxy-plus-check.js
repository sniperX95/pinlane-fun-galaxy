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
//   [B] l offre d attente, dans la fenetre de fin seulement (Movsar,
//       2026-10-01 : « chepa si c bien de mettre une add on ici [...] c mieux
//       de laisser la belle pop up uniquement, et si ca donne pour x personnes
//       ils peuvent choisir pour combien de personnes ») : rien a l ecran des
//       horaires ; dans la fenetre, chaque offre dit qui attend, un compteur
//       choisit combien de personnes (le montant suit), « Ajouter » monte le
//       total d exactement ce montant, la demande et l envoi portent ces
//       personnes, « Annuler » revient.
//   [C] le recapitulatif : « Envie d un peu plus ? » est une FENETRE (Movsar,
//       2026-09-29 : « une pop up genre a la McDo, super quali et belle,
//       avec des images », « enleve les prix par personne ») qui s ouvre
//       seule a l arrivee, une fois ; deux offres au plus, chacune avec sa
//       photo et son montant, sans prix par personne ; Echap la ferme, le
//       recapitulatif la rouvre ; chaque offre ajoute exactement son montant
//       et ferme la fenetre, « Annuler » revient au total d avant ; un tarif
//       change entre-temps est refuse, la fenetre le dit, la carte se retire,
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
// LA FENETRE « ENVIE D UN PEU PLUS ? » s ouvre seule a l arrivee au
// recapitulatif quand le serveur a joint des offres au creneau : un client la
// ferme (« Non merci ») avant de valider, ce parcours aussi. Tant que le
// formulaire n a pas decide de l ouvrir, elle porte data-attendue.
async function passerLaVitrine(f) {
  await attendre(f, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  const ouverte = await f.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); });
  if (ouverte) {
    await f.click('#vitrine .fg-vitrine__non');
    await attendre(f, () => document.querySelector('#vitrine').hidden, 3000);
  }
  return ouverte;
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
  const normalized = original.replace(/\r\n/g, '\n');
  const ancre = de.replace(/\r\n/g, '\n');
  const remplacement = vers.replace(/\r\n/g, '\n');
  const n = normalized.split(ancre).length - 1;
  if (n !== 1) throw new Error(`ancre trouvee ${n} fois dans ${rel}`);
  try {
    fs.writeFileSync(fichier, normalized.split(ancre).join(remplacement));
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

  // LE TEMPS TOTAL DES AUTRES CARTES (campagne du 2026-09-29) : ce qui se joue
  // pendant l attente ne compte que pour son debordement, comme la fin de
  // visite. Le minigolf des 8 qui attendent 1 h faisait dire « au lieu de
  // 3h45 » a une visite de 3 h 10 sur place.
  const tempsCourant = (reponse) => {
    const DUREE = /au lieu de (?:(\d+)h(\d\d)?|(\d+) min)$/;
    const c = ((reponse && reponse.complements) || []).find((x) => x.kind !== 'attente' && DUREE.test(x.totalLabel || ''));
    const m = c ? DUREE.exec(c.totalLabel) : null;
    return m ? { id: c.id, minutes: m[3] ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2] || 0), libelle: c.totalLabel } : null;
  };
  const deborde = (carte) => Math.max(0, carte.attente.dureeOffre - carte.attente.minutes);
  const tempsA = async (api, programme, pax, carte) => ({
    sans: tempsCourant(await appel(api, programme, pax)),
    avec: tempsCourant(await appel(api, [...programme, { activityId: carte.patch.activityId, waitOffer: true, participants: carte.patch.options.participants }], pax)),
    deborde: deborde(carte),
  });
  const mesure = (t) => Boolean(t && t.sans && t.avec);
  const tempsJuste = (t) => mesure(t) && t.avec.minutes === t.sans.minutes + t.deborde;
  // Le Fun Run a 12 : les derniers attendent 30 min, et le centre offre une
  // activite qui tient dans ce temps et une qui le depasse. Le duckpin a 20 n a
  // aucune autre carte tarifee dans le catalogue du harnais : rien a lire.
  const offresFun = cartesAttente(await appel(availability, FUN, 12));
  const tient = offresFun.find((c) => deborde(c) === 0) || null;
  const longue = offresFun.find((c) => deborde(c) > 0) || null;
  const tTient = tient ? await tempsA(availability, FUN, 12, tient) : null;
  ok(Boolean(tient) && tempsJuste(tTient),
    'une offre qui tient dans l attente n allonge pas le temps total des autres cartes', JSON.stringify(tient && { offre: tient.id, ...tient.attente, ...tTient }));
  const tFun = longue ? await tempsA(availability, FUN, 12, longue) : null;
  ok(Boolean(longue) && tempsJuste(tFun),
    'une offre plus longue que l attente allonge le temps total de son seul debordement', JSON.stringify(longue && { offre: longue.id, ...longue.attente, ...tFun }));

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
  const regleDuTemps = '  return joue + Math.max(0, pendantLAttente - creux);\n';
  try {
    const enEntier = tient ? await avecMutation('lib/booking-complements.js', regleDuTemps, '  return joue + pendantLAttente;\n',
      async () => { const m = charger(); return tempsA(m.availability, FUN, 12, tient); }) : null;
    ok(mesure(enEntier) && !tempsJuste(enEntier), 'compte en entier, l offre d attente gonfle le temps total des autres cartes : ce gate ROUGIRAIT', JSON.stringify(enEntier));
  } catch (error) { ok(false, 'contre-epreuve du temps compte en entier montable', error.message); }
  try {
    const ignoree = longue ? await avecMutation('lib/booking-complements.js', regleDuTemps, '  return joue;\n',
      async () => { const m = charger(); return tempsA(m.availability, FUN, 12, longue); }) : null;
    ok(mesure(ignoree) && !tempsJuste(ignoree), 'ignoree, l offre plus longue que l attente n allonge plus rien : ce gate ROUGIRAIT', JSON.stringify(ignoree));
  } catch (error) { ok(false, 'contre-epreuve du debordement montable', error.message); }
  return { grand, premiere };
}

// ---------------------------------------------------------------------------
// LE FORMULAIRE, sur le serveur de dev (vrai calcul de disponibilite, aucune
// base, la reservation gardee en memoire). Une contre-epreuve du formulaire
// est servie en memoire a la place du fichier : le disque n est pas touche.
// ---------------------------------------------------------------------------
let formulaireCasse = null;
let instrumenterPlus = false;
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if ((formulaireCasse || instrumenterPlus || process.env.PINLANE_PLUS_BUILT === '1') && url.pathname === '/assets/fungalaxy-booking.js') {
      const src = fs.readFileSync(path.join(ROOT, 'assets/fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      let served = formulaireCasse ? src.split(formulaireCasse.de).join(formulaireCasse.vers) : src;
      if (instrumenterPlus) served = served.replace('\n})();', '\nwindow.__plusTest = { setCards: function(cards) { state.creneau.reponse.complements = cards; rendreVitrine(true); }, basket: panierDe, cards: cartesPlus, detail: detailLigne };\n})();');
      if (process.env.PINLANE_PLUS_BUILT === '1') served = require('../tools/build-public').minifierJavascript(served,'assets/fungalaxy-booking.js',require('esbuild'));
      res.end(served);
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
    const v = document.querySelector('#vitrine');
    const zone = document.querySelector('#vitrineStatut');
    const t = document.querySelector('#totalAmount');
    return {
      bloc: Boolean(b),
      tete: txt(b && b.querySelector('.fg-plus__head')),
      rappel: txt(b && b.querySelector('[data-vitrine-ouvrir]')),
      fenetre: Boolean(v && !v.hidden),
      titre: txt(document.querySelector('#vitrineTitre')),
      offres: v ? Array.from(v.querySelectorAll('[data-plus]')).map((x) => x.dataset.plus) : [],
      montants: v ? Array.from(v.querySelectorAll('.fg-vitrine__prix')).map(txt) : [],
      cartes: v ? Array.from(v.querySelectorAll('.fg-vitrine__carte')).map(txt) : [],
      photos: v ? Array.from(v.querySelectorAll('.fg-vitrine__photo')).map((p) => { const i = p.querySelector('img'); return i ? (i.complete && i.naturalWidth > 0 ? 'photo' : 'photo non chargee') : (p.querySelector('svg') ? 'icone' : 'rien'); }) : [],
      statut: txt(b && b.querySelector('.fg-plus__statut')),
      ton: b && b.querySelector('.fg-plus__statut') ? b.querySelector('.fg-plus__statut').dataset.ton : '',
      statutFenetre: txt(zone),
      tonFenetre: zone ? (zone.dataset.ton || '') : '',
      annuler: Boolean(b && b.querySelector('[data-plus-annuler]')),
      total: t ? Number(t.dataset.total) : null,
      items: Array.from(document.querySelectorAll('#recap .fg-recap__item')).map(txt),
      calme: document.querySelector('#recap').classList.contains('is-calme'),
      focus: document.activeElement ? document.activeElement.id : '',
      inerte: Boolean(document.querySelector('.fg-shell') && document.querySelector('.fg-shell').inert),
    };
  });
}

// ---------------------------------------------------------------------------
// [B] L OFFRE D ATTENTE, DANS LA FENETRE DE FIN SEULEMENT
// ---------------------------------------------------------------------------
// Les cartes d attente de la fenetre : leur id, leur compteur, leur montant.
async function lireAttenteFenetre(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#vitrine .fg-vitrine__carte')).map((c) => {
    const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const moins = c.querySelector('[data-vitrine-pas="-1"]');
    const plusB = c.querySelector('[data-vitrine-pas="1"]');
    return {
      id: (c.querySelector('[data-plus]') || {}).dataset ? c.querySelector('[data-plus]').dataset.plus : '',
      n: txt(c.querySelector('.fg-vitrine__n')),
      compteur: Boolean(moins && plusB),
      moinsOff: Boolean(moins && moins.disabled),
      plusOff: Boolean(plusB && plusB.disabled),
      montant: txt(c.querySelector('.fg-vitrine__prix')),
      texte: txt(c),
    };
  }));
}
// Le parcours entier, mesure ; `verifierAttente` juge. `retire` : combien de
// personnes le client enleve au compteur avant d ajouter.
async function attenteParcours(browser, mock, { grand, etiquette, retire = 3 }) {
  const s = await jusquAuxHoraires(browser, mock, { pax: grand, activites: ['bowling', 'duckpin_bowling'], etiquette });
  const { page } = s;
  const res = { erreurs: s.erreurs, pret: s.pret };
  try {
    res.rep0 = derniere(s.reponses);
    res.cartes = cartesAttente(res.rep0);
    res.heures = await page.evaluate(() => ({
      bloc: Boolean(document.querySelector('#plus-heures, .fg-plus--visite, #hourZone [data-plus]')),
      texte: /Pendant l’attente/.test((document.querySelector('#planZone') || {}).textContent || ''),
    }));
    const requetes = [];
    page.on('request', (q) => { if (q.url().indexOf('/api/public-availability?') >= 0) requetes.push(new URL(q.url()).searchParams.get('program')); });
    res.recap = await remplirContact(page);
    res.ouverte = await attendre(page, () => { const v = document.querySelector('#vitrine'); return v && !v.hidden && !v.hasAttribute('data-attendue'); }, 5000);
    await page.waitForTimeout(700);
    res.r0 = await lireRecapPlus(page);
    res.f0 = await lireAttenteFenetre(page);
    const cible = res.cartes[0];
    if (!cible) return res;
    const carte = page.locator(`#vitrine .fg-vitrine__carte:has([data-plus="${cible.id}"])`);
    // Un bouton eteint (code casse) ne bloque pas le gate : il le mesure.
    const pas = async (sens) => { for (let k = 0; k < retire; k += 1) await carte.locator(`[data-vitrine-pas="${sens}"]`).click({ timeout: 2000 }).catch(() => {}); };
    await pas(-1);
    res.f1 = await lireAttenteFenetre(page);
    await carte.locator('[data-plus]').click();
    await attendre(page, () => { const z = document.querySelector('#plus-recap .fg-plus__statut'); return document.querySelector('#vitrine').hidden && z && z.dataset.ton === 'ok'; }, 15000);
    res.r1 = await lireRecapPlus(page);
    res.envoye = requetes.length ? JSON.parse(requetes[requetes.length - 1]) : [];
    await page.click('#plus-recap [data-plus-annuler]');
    await attendre(page, () => { const z = document.querySelector('#plus-recap .fg-plus__statut'); return z && z.dataset.ton === 'ok' && /^Annulé : votre visite revient/.test(z.textContent); }, 15000);
    res.r2 = await lireRecapPlus(page);
    // Reprise, toutes les personnes cette fois, puis l envoi.
    await page.click('#plus-recap [data-vitrine-ouvrir]');
    await attendre(page, () => !document.querySelector('#vitrine').hidden, 3000);
    await page.waitForTimeout(500);
    res.f2 = await lireAttenteFenetre(page);
    await pas(1);
    res.f3 = await lireAttenteFenetre(page);
    await carte.locator('[data-plus]').click();
    await attendre(page, () => { const z = document.querySelector('#plus-recap .fg-plus__statut'); return document.querySelector('#vitrine').hidden && z && z.dataset.ton === 'ok'; }, 15000);
    res.r3 = await lireRecapPlus(page);
    await page.click('#confirmBtn');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 15000);
    res.pose = mock.dernierePose.body || {};
    return res;
  } finally { await s.ctx.close(); }
}
function verifierAttente(res, attendu, retire = 3) {
  const juger = (cond, label, detail) => (attendu ? ok(cond, label, detail) : Boolean(cond));
  const cartes = res.cartes || [];
  const c = cartes[0] || null;
  const p = c ? c.attente.personnes : 0;
  const n = p - retire;
  const pp = c ? Number(c.prixParPersonne) : 0;
  const f0 = res.f0 || [];
  const f1 = res.f1 || [];
  const r0 = res.r0 || {};
  const r1 = res.r1 || {};
  const verdicts = [
    juger(res.pret && res.recap && c && p > retire, 'montage : horaires, coordonnees, recapitulatif, une offre d attente pour plus de personnes que le compteur n en retire', JSON.stringify({ pret: res.pret, recap: res.recap, p })),
    juger(res.heures && !res.heures.bloc && !res.heures.texte, 'l ecran des horaires ne propose plus rien : ni bloc « Pendant l attente », ni bouton', JSON.stringify(res.heures)),
    juger(res.ouverte && cartes.length >= 1 && f0.slice(0, cartes.length).map((x) => x.id).join(' ') === cartes.map((x) => x.id).join(' '),
      'la fenetre s ouvre d elle-meme et porte les offres d attente du serveur, dans son ordre, en tete', f0.map((x) => x.id).join(' ')),
    juger(f0.slice(0, cartes.length).every((x, i) => x.compteur && x.n === String(cartes[i].attente.personnes) && x.plusOff && !x.moinsOff && x.montant === `+${euros(cartes[i].deltaTotal)}`),
      'chacune a son compteur, regle par defaut sur ceux qui attendent (« + » eteint), et le montant du serveur pour eux', JSON.stringify(f0.map((x) => ({ id: x.id, n: x.n, montant: x.montant })))),
    juger(f0.every((x) => !/par personne/.test(x.texte)) && f0.slice(0, cartes.length).every((x, i) => x.texte.indexOf(`${cartes[i].attente.personnes} personnes attendent leur tour`) >= 0),
      'elle dit qui attend, sans prix par personne', f0.map((x) => x.texte).join(' | ')),
    juger(f1[0] && f1[0].n === String(n) && f1[0].montant === `+${euros(pp * n)}` && !f1[0].plusOff,
      `${retire} fois « - » : ${n} personnes, le montant suit (${euros(pp * n)})`, JSON.stringify(f1[0])),
    juger(r1.total === r0.total + pp * n && r1.ton === 'ok' && r1.annuler && !r1.fenetre,
      'Ajouter : le total monte EXACTEMENT de ce montant, la fenetre se ferme, « Annuler » est offert', `${r0.total} + ${pp * n} = ${r1.total} « ${r1.statut} »`),
    juger(new RegExp(`^Ajout confirmé : .+ pour ${n} personnes pendant l’attente, \\+`).test(r1.statut || ''), 'la phrase dit pour combien de personnes', r1.statut),
    juger((res.envoye || []).some((l) => l.waitOffer === true && l.activityId === c.patch.activityId && l.participants === n),
      'la demande porte la ligne d attente pour ces personnes', JSON.stringify(res.envoye)),
    juger((r1.items || []).some((i) => i.indexOf(`pendant l’attente · ${n} personnes`) >= 0), 'le recapitulatif porte la ligne, pour ces personnes', (r1.items || []).join(' | ')),
    juger(res.r2 && res.r2.total === r0.total, 'Annuler : le total revient', `${res.r2 && res.r2.total} / ${r0.total}`),
    juger((res.f2 || [])[0] && res.f2[0].n === String(n), 'rouverte, la carte garde le nombre choisi par le client', JSON.stringify((res.f2 || [])[0])),
    juger((res.f3 || [])[0] && res.f3[0].n === String(p) && res.f3[0].plusOff && res.f3[0].montant === `+${euros(c.deltaTotal)}`, `${retire} fois « + » : tous ceux qui attendent, « + » s eteint, le montant du serveur`, JSON.stringify((res.f3 || [])[0])),
    juger(res.r3 && res.r3.total === r0.total + c.deltaTotal, 'reprise pour tous : le total du serveur', `${res.r3 && res.r3.total}`),
    juger(((res.pose && res.pose.program) || []).some((l) => l.waitOffer === true && l.participants === p) && Number(res.pose && res.pose.price) === r0.total + c.deltaTotal,
      'l envoi porte la ligne d attente et le prix affiche (le serveur de dev la garde en memoire, rien ne part)', JSON.stringify({ program: res.pose && res.pose.program, prix: res.pose && res.pose.price })),
    juger((res.erreurs || []).length === 0, 'aucune erreur dans la page', (res.erreurs || []).join(' | ')),
  ];
  return verdicts.every(Boolean);
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
    if (!s.pret || !carte || !(await remplirContact(page))) return { pret: false };
    await attendre(page, () => { const v = document.querySelector('#vitrine'); return v && !v.hidden && !v.hasAttribute('data-attendue'); }, 5000);
    await page.waitForTimeout(500);
    const total0 = (await lireRecapPlus(page)).total;
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
    await page.click(`#vitrine [data-plus="${carte.id}"]`);
    await attendre(page, () => { const z = document.querySelector('#vitrineStatut'); const b = document.querySelector('#plus-recap .fg-plus__statut'); return (z && z.dataset.ton === 'ko') || (b && b.dataset.ton === 'ok'); }, 15000);
    return { pret: true, a: await lireRecapPlus(page), total0, carte: carte.id };
  } finally { await s.ctx.close(); }
}
function verifierAttenteNonPosee(res, attendu) {
  const a = res.a || {};
  const refuse = Boolean(res.pret) && a.fenetre === true && a.tonFenetre === 'ko' && a.statutFenetre === 'Cette offre n’est plus disponible.' && a.total === res.total0 && a.offres.indexOf(res.carte) < 0;
  if (attendu) {
    ok(refuse, 'un serveur qui ne pose pas l offre d attente : la carte se retire et la fenetre le dit, le total ne bouge pas, jamais « Ajout confirmé »',
      JSON.stringify({ pret: res.pret, statut: a.statutFenetre, total: a.total, avant: res.total0, offres: a.offres }));
  }
  return refuse;
}

// ---------------------------------------------------------------------------
// [C] LE RECAPITULATIF : ENVIE D UN PEU PLUS ?
// ---------------------------------------------------------------------------
// `arret` : la contre-epreuve s arrete a ce qu elle mesure (« ouverture »,
// « une-fois »).
async function recapC(browser, mock, { largeur = 1440, hauteur = 900, etiquette = 'bureau', casse = false, arret = '' } = {}) {
  const s = await jusquAuxHoraires(browser, mock, { pax: 6, activites: ['bowling', 'laser_game'], largeur, hauteur, etiquette: `plus-recap-${etiquette}` });
  const { page } = s;
  const res = { erreurs: s.erreurs };
  const fenetreFermee = () => attendre(page, () => document.querySelector('#vitrine').hidden, 3000);
  try {
    res.pret = s.pret && await remplirContact(page);
    res.rep0 = derniere(s.reponses);
    res.cartes = ((res.rep0 && res.rep0.complements) || []).filter((c) => c.kind !== 'attente');
    // La fenetre s ouvre d elle-meme, une fois l ecran entre.
    res.auto = await attendre(page, () => { const v = document.querySelector('#vitrine'); return v && !v.hidden && !v.hasAttribute('data-attendue'); }, 5000);
    if (arret === 'ouverture') return res;
    await page.waitForTimeout(700);
    res.r0 = await lireRecapPlus(page);
    const cible = res.cartes[0];
    if (!cible) return res;
    // Le refus d abord, sur une page a part : le serveur annonce un tarif qui
    // a monte depuis la carte (5 EUR de plus que promis).
    if (casse) {
      const chosenTime = res.rep0 && res.rep0.slots && res.rep0.slots[0] && res.rep0.slots[0].time;
      res.priceMutation = null;
      await page.route('**/api/public-availability*', async (route) => {
        const reponse = await route.fetch();
        const j = await reponse.json();
        const chosenSlot = j.slots && j.slots[0];
        if (!chosenTime || !chosenSlot || chosenSlot.time !== chosenTime || !Number.isFinite(Number(chosenSlot.price))) {
          throw new Error('Price mutant must target the selected slot with its authoritative price');
        }
        const before = Number(chosenSlot.price);
        chosenSlot.price = Math.round((before + 5) * 100) / 100;
        j.price = Number(j.price) + 5;
        res.priceMutation = { chosenTime, returnedTime: chosenSlot.time, before, after: chosenSlot.price, delta: chosenSlot.price - before };
        console.log(JSON.stringify({ priceMutation: res.priceMutation }));
        await route.fulfill({ response: reponse, json: j });
      });
      await page.click(`#vitrine [data-plus="${cible.id}"]`);
      await attendre(page, () => { const z = document.querySelector('#vitrineStatut'); const b = document.querySelector('#plus-recap .fg-plus__statut'); return (z && z.dataset.ton === 'ko') || (b && b.dataset.ton === 'ok'); }, 15000);
      res.refus = await lireRecapPlus(page);
      return res;
    }
    res.sobre = await page.evaluate(() => {
      const panneau = document.querySelector('#vitrinePanneau');
      const tous = panneau ? [panneau, ...panneau.querySelectorAll('*')] : [];
      const degrades = tous.filter((el) => ['', '::before', '::after'].some((p) => /gradient\(/.test(getComputedStyle(el, p || null).backgroundImage))).map((el) => el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className);
      const pastilles = tous.filter((el) => { const c = getComputedStyle(el); return parseFloat(c.borderTopLeftRadius) >= 20 && (c.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(c.borderTopWidth) > 0); }).length;
      const r = panneau ? panneau.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
      const deborde = tous.filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5); }).length;
      return { degrades, pastilles, deborde, pageLarge: document.documentElement.scrollWidth > window.innerWidth, dansLEcran: r.top >= 0 && r.bottom <= window.innerHeight };
    });
    // Echap la ferme, le focus revient au titre de l ecran.
    await page.keyboard.press('Escape');
    res.echap = await fenetreFermee() && await page.evaluate(() => Boolean(document.activeElement && document.activeElement.id === 't-ok') && !document.querySelector('.fg-shell').inert);
    // Une fois : revenu au recapitulatif par « vos coordonnees », elle ne se
    // rouvre pas d elle-meme pour les memes offres.
    await page.click('.fg-scene[data-scene="recap"] [data-back]');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
    await page.click('#goRecap');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
    await attendre(page, () => !document.querySelector('#vitrine').hasAttribute('data-attendue'), 5000);
    res.uneFois = await page.evaluate(() => document.querySelector('#vitrine').hidden);
    if (arret === 'une-fois') return res;
    // Le recapitulatif la rouvre.
    await page.click('#plus-recap [data-vitrine-ouvrir]');
    res.rouverte = await attendre(page, () => !document.querySelector('#vitrine').hidden, 3000);
    await page.waitForTimeout(500);
    await page.click(`#vitrine [data-plus="${cible.id}"]`);
    await attendre(page, () => { const z = document.querySelector('#plus-recap .fg-plus__statut'); return document.querySelector('#vitrine').hidden && z && z.dataset.ton === 'ok'; }, 15000);
    res.r1 = await lireRecapPlus(page);
    await page.click('#plus-recap [data-plus-annuler]');
    await attendre(page, () => { const z = document.querySelector('#plus-recap .fg-plus__statut'); return z && z.dataset.ton === 'ok' && /^Annulé : votre visite revient/.test(z.textContent); }, 15000);
    res.r2 = await lireRecapPlus(page);
    // Les offres reviennent : la fenetre les remontre.
    await page.click('#plus-recap [data-vitrine-ouvrir]');
    await attendre(page, () => !document.querySelector('#vitrine').hidden, 3000);
    res.r3 = await lireRecapPlus(page);
    return res;
  } finally { await s.ctx.close(); }
}
function verifierRecap(res, etiquette) {
  section(`[C] LE RECAPITULATIF : ENVIE D UN PEU PLUS ? (${etiquette})`);
  ok(res.pret, 'montage : horaires, coordonnees, recapitulatif');
  const cartes = res.cartes || [];
  const r0 = res.r0 || { offres: [], montants: [], cartes: [], photos: [] };
  ok(res.auto && r0.fenetre && r0.focus === 'vitrinePanneau' && r0.inerte,
    'a l arrivee au recapitulatif, la fenetre « Envie d un peu plus ? » s ouvre d elle-meme, le focus dedans, la page derriere inerte', JSON.stringify({ auto: res.auto, focus: r0.focus, inerte: r0.inerte }));
  ok(cartes.length >= 1 && cartes.length <= 6 && r0.titre === 'Envie d’un peu plus ?' && r0.offres.join(' ') === cartes.map((c) => c.id).join(' '),
    'offres variees, au plus six, celles du serveur dans son ordre', `${r0.offres.join(' ')} · « ${r0.titre} »`);
  ok(cartes.length > 0 && cartes.every((c, i) => r0.montants[i] === `+${euros(c.deltaTotal)}`), 'chacune dit son montant exact', r0.montants.join(' | '));
  ok(r0.cartes.length === cartes.length && r0.cartes.every((t) => !/par personne/.test(t)), 'aucun prix par personne sur les offres', r0.cartes.join(' | '));
  ok(r0.photos.length === cartes.length && r0.photos.every((p) => p === 'photo'), 'chaque offre a sa photo, chargee', r0.photos.join(' '));
  ok(res.sobre && res.sobre.degrades.length === 0 && res.sobre.pastilles === 0, 'sobriete : aucun degrade, aucune pastille dans la fenetre', JSON.stringify(res.sobre));
  ok(res.sobre && res.sobre.deborde === 0 && !res.sobre.pageLarge && res.sobre.dansLEcran, 'rien ne deborde de la fenetre ni de la page, et elle tient dans l ecran', JSON.stringify(res.sobre));
  ok(res.echap, 'Echap la ferme : le focus revient au titre de l ecran, la page redevient active');
  ok(r0.tete === 'Envie d’un peu plus ? Vos horaires ne bougent pas.' && /^Voir (les \d options|l’option)$/.test(r0.rappel), 'le recapitulatif garde de quoi la rouvrir', `« ${r0.tete} » « ${r0.rappel} »`);
  ok(res.uneFois === true, 'revenu au recapitulatif, elle ne se rouvre pas d elle-meme pour les memes offres');
  ok(res.rouverte, 'le rappel du recapitulatif la rouvre');
  if (!res.r1) { ok(false, 'aucune offre a accepter'); return; }
  ok(res.r1.total === r0.total + cartes[0].deltaTotal && res.r1.ton === 'ok' && res.r1.annuler && !res.r1.fenetre,
    'Ajouter : le total monte EXACTEMENT du montant annonce, la fenetre se ferme, le recapitulatif dit l ajout et offre « Annuler »', `${r0.total} + ${cartes[0].deltaTotal} = ${res.r1.total} « ${res.r1.statut} »`);
  ok(res.r1.calme && res.r1.focus === 'plus-recap' && !res.r1.inerte, 'le recapitulatif se redessine sur place (ses lignes ne rejouent pas leur entree), le focus revient sur le bloc, la page redevient active', `${res.r1.calme} ${res.r1.focus} ${res.r1.inerte}`);
  ok(res.r2.total === r0.total, 'Annuler : le total revient', `${res.r2.total} / ${r0.total}`);
  ok(res.r3 && res.r3.fenetre && res.r3.offres.join(' ') === r0.offres.join(' '), 'et les offres aussi : la fenetre les remontre', `${res.r3 && res.r3.offres.join(' ')} / ${r0.offres.join(' ')}`);
  ok(res.erreurs.length === 0, 'aucune erreur dans la page', res.erreurs.join(' | '));
}
// LE CRENEAU REFUSE A L ENVOI (409, la derniere piste prise entre-temps) :
// les offres valaient pour lui, elles partent avec lui. « Vos horaires ne
// bougent pas » ne serait plus vrai sous « Ce creneau ne peut plus etre
// reserve en ligne » (campagne du 2026-09-29).
async function recapRefusEnvoi(browser, mock, { etiquette }) {
  const s = await jusquAuxHoraires(browser, mock, { pax: 6, activites: ['bowling', 'laser_game'], etiquette });
  const { page } = s;
  try {
    const pret = s.pret && await remplirContact(page);
    await attendre(page, () => { const v = document.querySelector('#vitrine'); return v && !v.hasAttribute('data-attendue'); }, 5000);
    const avant = await lireRecapPlus(page);
    await passerLaVitrine(page);
    await page.route('**/api/public-reservations', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'Ce créneau ne tient plus.', alternatives: [] }) }));
    await page.click('#confirmBtn');
    await attendre(page, () => !document.querySelector('#confirmErr').hidden, 10000);
    const apres = await page.evaluate(() => ({
      erreur: !document.querySelector('#confirmErr').hidden,
      bloc: Boolean(document.querySelector('#plus-recap')),
      texte: (document.querySelector('#confirmErr').textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    return { pret, avant, apres };
  } finally { await s.ctx.close(); }
}
function verifierRefusEnvoi(res, attendu) {
  const tenu = Boolean(res.pret) && res.avant.bloc && res.avant.offres.length > 0 && res.apres.erreur && !res.apres.bloc;
  if (attendu) {
    ok(tenu, 'le creneau refuse a l envoi : « Envie d un peu plus ? » part avec lui, l erreur reste',
      JSON.stringify({ offresAvant: res.avant.offres, blocApres: res.apres.bloc, erreur: res.apres.texte.slice(0, 60) }));
  }
  return tenu;
}
function verifierRefus(res, attendu) {
  const r = res.refus || {};
  const refuse = r.fenetre === true && r.tonFenetre === 'ko' && r.statutFenetre === 'Le tarif de cette option vient de changer.' && r.total === res.r0.total && r.offres.indexOf(res.cartes[0].id) < 0;
  if (attendu) ok(refuse, 'un tarif qui a monte depuis la carte est refuse : la fenetre reste ouverte et dit pourquoi, la carte se retire, le total ne bouge pas', JSON.stringify({ fenetre: r.fenetre, statut: r.statutFenetre, total: r.total, avant: res.r0.total, offres: r.offres }));
  if (attendu) ok(res.priceMutation && res.priceMutation.delta === 5 && res.priceMutation.chosenTime === res.priceMutation.returnedTime,
    'le mutant augmente exactement de 5 EUR le tarif autoritaire du creneau choisi', JSON.stringify(res.priceMutation));
  return refuse;
}

async function personnalisationPlus(browser, mock) {
  section('[F] QUANTITES, DEVIS AUTORITAIRES ET REPONSES TARDIVES');
  instrumenterPlus = true;
  let s;
  try {
    s = await jusquAuxHoraires(browser, mock, { pax: 6, activites: ['bowling', 'laser_game'], largeur: 390, hauteur: 844, etiquette: 'personnalisation' });
    const { page } = s;
    const rep = derniere(s.reponses);
    ok(s.pret && await remplirContact(page), 'montage personnalisation mobile');
    await attendre(page, () => !document.querySelector('#vitrine').hidden, 5000);
    const card = { id: 'offer:mini', offerId: 'mini', kind: 'configured', name: 'Minigolf', participants: 6, deltaTotal: 54,
      participantBounds: { min: 2, max: 6 }, discount: { discountAmount: 6 }, image: { src: '/assets/fungalaxy/minigolf-800.webp', positionX: 30, positionY: 70, zoom: 1.2 },
      patch: { activityId: 'minigolf_blacklight', options: { participants: 6, upsell: { offerId: 'mini', participants: 6 } } } };
    await page.evaluate(c => window.__plusTest.setCards([c]), card);
    const quantities = [];
    let mode = 'per-person';
    await page.route('**/api/public-availability*', async route => {
      const raw = JSON.parse(new URL(route.request().url()).searchParams.get('program'));
      const added = raw.find(i => i.upsell);
      if (!added) return route.continue();
      const n = added.participants;
      quantities.push({ n, raw });
      const j = JSON.parse(JSON.stringify(rep));
      const price = mode === 'free' ? 0 : mode === 'nonlinear' ? 35.1 : n * 9;
      const snapshot = { offerId: 'mini', participants: n, discountAmount: mode === 'free' ? n * 10 : mode === 'nonlinear' ? 3.9 : n, referencePrice: mode === 'nonlinear' ? 39 : n * 10, price };
      j.price = rep.price + price;
      j.slots[0].price = j.price;
      j.program.items.push({ ...added, upsell: snapshot, price, priceKnown: true });
      if (mode === 'missing') delete j.program.items[j.program.items.length - 1].upsell;
      if (mode === 'fail') return route.fulfill({ status: 503, body: '{}' });
      if (mode === 'stale') await new Promise(resolve => setTimeout(resolve, n === 5 ? 300 : 30));
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); } catch (_) { /* Old request aborted by the real form. */ }
    });
    const tile = page.locator('#vitrine .fg-vitrine__carte').first();
    await tile.locator('[data-vitrine-pas="-1"]').click();
    await attendre(page, () => document.querySelector('#vitrine .fg-vitrine__prix').textContent === '+45 €', 4000);
    ok((await tile.locator('.fg-vitrine__economie').innerText()) === 'Économie de 5 €', 'pour cinq, le serveur annonce 45 EUR et 5 EUR economises, meme pourcentage');
    ok(quantities[0].raw.some(i => i.upsell && i.participants === 5 && i.upsell.participants === 5 && !('discountAmount' in i.upsell)), 'le programme demande cinq participants sans jamais envoyer de remise calculee');
    mode = 'stale';
    await tile.locator('[data-vitrine-pas="1"]').click();
    await tile.locator('[data-vitrine-pas="-1"]').click();
    await tile.locator('[data-vitrine-pas="-1"]').click();
    ok(await tile.locator('[data-plus]').isDisabled(), 'Ajouter est desactive pendant le devis courant');
    await attendre(page, () => document.querySelector('#vitrine .fg-vitrine__prix').textContent === '+36 €', 4000);
    await page.waitForTimeout(450);
    ok((await tile.locator('.fg-vitrine__prix').innerText()) === '+36 €' && (await tile.locator('.fg-vitrine__n').innerText()) === '4', 'la reponse tardive pour cinq ne remplace pas le devis pour quatre');
    mode = 'nonlinear';
    await tile.locator('[data-vitrine-pas="-1"]').click();
    await attendre(page, () => document.querySelector('#vitrine .fg-vitrine__prix').textContent === '+35,1 €', 4000);
    ok((await tile.locator('.fg-vitrine__prix').innerText()) === '+35,1 €', 'une unite indivisible conserve le montant autoritaire, aucun prorata client');
    mode = 'fail';
    await tile.locator('[data-vitrine-pas="-1"]').click();
    await attendre(page, () => Boolean(document.querySelector('[data-plus-requote]')), 4000);
    ok(await tile.locator('[data-plus]').isDisabled() && await tile.locator('[data-vitrine-pas="-1"]').isDisabled(), 'au minimum refuse, impossible d ajouter, le compteur respecte la borne');
    mode = 'per-person';
    await tile.locator('[data-plus-requote]').click();
    await attendre(page, () => !document.querySelector('#vitrine [data-plus]').disabled, 4000);
    ok((await tile.locator('.fg-vitrine__prix').innerText()) === '+18 €', 'Reessayer rechiffre au minimum sans changer le nombre');
    mode = 'missing';
    await tile.locator('[data-vitrine-pas="1"]').click();
    await attendre(page, () => Boolean(document.querySelector('[data-plus-requote]')), 4000);
    ok(await tile.locator('[data-plus]').isDisabled() && (await tile.locator('.fg-vitrine__economie').innerText()).includes('Cette offre n’est plus disponible.'), 'aucun ajout si le serveur ne confirme plus le contrat configure');
    mode = 'per-person';
    await tile.locator('[data-vitrine-pas="-1"]').click();
    await attendre(page, () => !document.querySelector('#vitrine [data-plus]').disabled, 4000);
    const basket = await page.evaluate(c => window.__plusTest.basket(c), { ...card, patch: { activityId: 'laser_game', options: { extraLaser: { offerId: 'extra', participants: 2, games: 2 } } } });
    ok(Number(basket.options.laser_game.games || 1) === 1 && basket.options.laser_game.extraLaser.participants === 2 && basket.options.laser_game.extraLaser.games === 2, 'le supplement laser garde la partie de base et ajoute seulement le sous-groupe choisi');
    const detail = await page.evaluate(() => window.__plusTest.detail({ games: 1, extraLaser: { games: 2, participants: 2 } }));
    ok(detail === '1 partie + 1 partie supplémentaire pour 2 joueurs', 'le recapitulatif explique exactement la partie originale et les participants au supplement');
    mode='free';await tile.locator('[data-vitrine-pas="1"]').click();
    await attendre(page,()=>document.querySelector('#vitrine .fg-vitrine__prix').textContent==='+0 €',4000);
    ok(!await tile.locator('[data-plus]').isDisabled()&&(await tile.locator('.fg-vitrine__economie').innerText())==='Économie de 30 €','une remise autoritaire de cent pour cent reste ajoutable et affiche son economie entiere');
    ok(s.erreurs.length === 0, 'aucune erreur JS dans la personnalisation');
  } finally { instrumenterPlus = false; if (s) await s.ctx.close(); }
}

async function laserSousGroupe(browser, mock) {
  section('[G] LASER : SOUS-GROUPE, ENVOI ET RECU');
  const s = await jusquAuxHoraires(browser, mock, { pax: 6, activites: ['bowling', 'laser_game'], largeur:390, hauteur:844, etiquette:'laser-subgroup-receipt' });
  try {
    const {page}=s;
    const initial=derniere(s.reponses);
    const card=(initial.complements||[]).find(c=>c.kind==='laser');
    ok(s.pret&&Boolean(card)&&await remplirContact(page),'montage supplement laser reel');
    await attendre(page,()=>!document.querySelector('#vitrine').hidden,5000);
    const tile=page.locator(`#vitrine .fg-vitrine__carte:has([data-plus="${card.id}"])`);
    for(let k=0;k<4;k++)await tile.locator('[data-vitrine-pas="-1"]').click();
    await attendre(page,id=>!document.querySelector(`[data-plus="${id}"]`).disabled,6000,card.id);
    const shown=await tile.locator('.fg-vitrine__prix').innerText();
    await tile.locator('[data-plus]').click();
    await attendre(page,()=>document.querySelector('#vitrine').hidden&&document.querySelector('#plus-recap .fg-plus__statut')?.dataset.ton==='ok',15000);
    const recap=await lireRecapPlus(page);
    ok(recap.total===Number(initial.price)+16&&shown==='+16 €','seuls les deux joueurs paient le supplement catalogue, total exact');
    ok(recap.items.join(' ').includes('1 partie supplémentaire pour 2 joueurs'),'le recapitulatif conserve les joueurs originaux et explique le supplement pour deux');
    await page.click('#confirmBtn');
    await attendre(page,()=>document.querySelector('.fg-scene[data-scene="fin"].is-active'),15000);
    const raw=mock.dernierePose.body||{};
    const laser=(raw.program||[]).find(i=>i.activityId==='laser_game')||{};
    ok(Number(laser.games||1)===1&&(laser.participants==null||laser.participants===6)&&laser.extraLaser?.participants===2&&laser.extraLaser.games===2,'l envoi preserve les six participants de base et une partie, plus le sous-groupe distinct');
    const receipt=await page.locator('#finBody').innerText();
    ok(receipt.includes('1 partie supplémentaire pour 2 joueurs')&&Number(raw.price)===recap.total,'le vrai recu de succes conserve le supplement et le prix affiche');
    ok(s.erreurs.length===0,'aucune erreur JS dans le parcours laser et recu');
  }finally{await s.ctx.close();}
}

async function main() {
  const serveurRes = process.env.PINLANE_PLUS_BROWSER_ONLY === '1' ? { grand: 20 } : await serveurA();
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const srv = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    section('[B] L OFFRE D ATTENTE, DANS LA FENETRE DE FIN SEULEMENT');
    verifierAttente(await attenteParcours(browser, mock, { grand: serveurRes.grand, etiquette: 'plus-attente' }), true);
    section('[B] UN SERVEUR QUI NE POSE PAS L OFFRE D ATTENTE');
    verifierAttenteNonPosee(await attenteNonPosee(browser, mock, { grand: serveurRes.grand, etiquette: 'attente-non-posee' }), true);
    verifierRecap(await recapC(browser, mock, {}), 'bureau');
    verifierRecap(await recapC(browser, mock, { largeur: 390, hauteur: 844, etiquette: 'telephone' }), 'telephone 390 px');
    await personnalisationPlus(browser, mock);
    await laserSousGroupe(browser, mock);
    section('[C] LE TARIF QUI A CHANGE');
    verifierRefus(await recapC(browser, mock, { casse: true, etiquette: 'refus' }), true);
    section('[C] LE CRENEAU REFUSE A L ENVOI');
    verifierRefusEnvoi(await recapRefusEnvoi(browser, mock, { etiquette: 'refus-envoi' }), true);
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
      {
        de: '          if (blocPlus) blocPlus.parentNode.removeChild(blocPlus);\n',
        jouer: async () => !verifierRefusEnvoi(await recapRefusEnvoi(browser, mock, { etiquette: 'refus-envoi-casse' }), false),
        label: 'sans le retrait des offres, « Vos horaires ne bougent pas » reste sous le refus : ce gate ROUGIRAIT',
      },
      {
        de: '    return Math.min(bornes.max, Math.max(bornes.min, v > 0 ? v : bornes.max));\n',
        vers: '    return bornes.max;\n',
        jouer: async () => !verifierAttente(await attenteParcours(browser, mock, { grand: serveurRes.grand, etiquette: 'attente-compteur-casse' }), false),
        label: 'sans le nombre choisi, le compteur ne change ni le montant ni la demande : ce gate ROUGIRAIT',
      },
      {
        de: '    programmerVitrine();\n',
        jouer: async () => { const r = await recapC(browser, mock, { etiquette: 'auto-casse', arret: 'ouverture' }); return Boolean(r.pret) && (r.cartes || []).length > 0 && !r.auto; },
        label: 'sans l ouverture a l arrivee, la fenetre ne s ouvre plus d elle-meme : ce gate ROUGIRAIT',
      },
      {
        de: '    vitrineVues[signatureVitrine()] = 1;\n',
        jouer: async () => { const r = await recapC(browser, mock, { etiquette: 'une-fois-casse', arret: 'une-fois' }); return Boolean(r.auto) && r.uneFois === false; },
        label: 'sans la memoire des offres deja montrees, la fenetre revient a chaque passage : ce gate ROUGIRAIT',
      },
    ];
    for (const c of casses) {
      if (src.split(c.de).length !== 2) { ok(false, `contre-epreuve montable : ancre introuvable (${c.de.trim().slice(0, 60)})`); continue; }
      formulaireCasse = { de: c.de, vers: c.vers || '' };
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

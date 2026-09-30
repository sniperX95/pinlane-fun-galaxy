// LA PLAINE DE JEUX EST UNE ENTREE A LA JOURNEE.
//
// Movsar, 2026-09-25 : « le playground ça met 1h dans le recap du formualire
// mais playground c pour toute la journée hein c un acces toute lajournéé et
// c entre 4ans a 12ans ». La page du centre le dit aussi (« Durée : toute la
// journée », 12 EUR par personne). Les 60 minutes du catalogue ne sont qu une
// estimation de temps sur place pour le planning : le recapitulatif les
// affichait comme ce que le client achete (« 1 heure »).
//
// [A] LA DONNEE, lue par le vrai code : le catalogue marque la plaine (et elle
//     seule) comme une entree a la journee ; la meta publique la sert avec
//     l age que declare le CENTRE (activityThemes, « 4 à 12 ans »), la meme
//     donnee que lit l agent ; la ligne de programme garde la marque et ses
//     60 minutes (la fin de visite en tient compte) ; un centre sans plaine ne
//     la sert pas.
// [B] LE FORMULAIRE, LA PLAINE SEULE (dev-tunnel-server, disponibilite
//     reelle) : la carte dit « accès à la journée · 4 à 12 ans » ; « Votre
//     visite » dit « dès HH:MM, accès toute la journée », sans fin ni duree ;
//     la ligne libre dit « Playground (toute la journée) » et « à votre
//     rythme » ; la barre du bas dit « dès HH:MM, toute la journée » ; le
//     recapitulatif dit « 2 enfants · accès toute la journée · 4 à 12 ans »
//     (les enfants comptes, 2026-09-30 ; par defaut tout le groupe) ; nulle
//     part « 1 heure », « 1 h » ni « environ ».
// [C] BOWLING + PLAINE : la ligne libre et le detail du prix disent « toute la
//     journée », « à votre rythme » sans duree ; la fin estimee reste celle
//     de la reponse du serveur (la plaine y compte son heure d estimation).
// [D] LE TUNNEL GENERIQUE (app-main.js) suit la meme regle dans son recap.
//
// CONTRE-PREUVES : PJ_CASSE=<nom> sert le JS du formulaire casse expres, et
// chacune doit rougir sa cible : recap, detail, libre, environ, journee,
// carte, parties, insecable.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const mock = require('./dev-tunnel-server');

const ROOT = path.join(__dirname, '..');
// Un port que nul autre gate ne prend (4251 est celui de funnel-clarity : deux
// gates au meme port dans une vague se tuent).
const PORT = Number(process.env.PINLANE_PJ_PORT || 4293);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.PJ_CASSE || '');
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const MUTATIONS = {
  recap: ["        } else if (it.dayAccess) {\n          var enfantsLigne = seCompteParEnfant(activite(it.activityId)) ? Math.trunc(Number(it.participants) || 0) : 0;\n          morceaux.push(enfantsLigne > 0 ? enfantsLigne + ' enfant' + (enfantsLigne > 1 ? 's' : '') : '', 'accès toute la journée', ageActivite(it.activityId));\n        } else {", '        } else {'],
  detail: ["    if (it.dayAccess) return 'toute la journée';\n", ''],
  libre: ["var entre = it.dayAccess ? 'toute la journée' : detailSessions(it);", 'var entre = detailSessions(it);'],
  environ: ["var duree = !entre && Number(it.minutes) > 0 ? environ(it.minutes) : '';", "var duree = Number(it.minutes) > 0 ? environ(it.minutes) : '';"],
  journee: ['var journee = items.length > 0 && items.every(function (it) { return it.dayAccess; });', 'var journee = false;'],
  carte: ["    return [a.note, a.ageRange ? a.ageRange.replace(/ /g, '\\u00a0') : '', a.minPax > 1 ? a.minPax + '\\u00a0joueurs minimum' : ''].filter(Boolean).join(' · ');", "    return a.note || '';"],
  parties: ['|| !b.startTime || journee[b.activityId]) return;', '|| !b.startTime) return;'],
  insecable: ["a.ageRange ? a.ageRange.replace(/ /g, '\\u00a0') : ''", "a.ageRange || ''"],
};

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}${detail ? `  ${detail}` : ''}`); return; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return false; }
}
const blancs = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function serveur() {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (CASSE && url.pathname === '/assets/fungalaxy-booking.js') {
      const mutation = MUTATIONS[CASSE];
      if (!mutation) { console.error(`plaine-journee-check: contre-preuve inconnue ${CASSE}`); process.exit(2); }
      const src = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
      if (src.split(mutation[0]).length !== 2) { console.error(`plaine-journee-check: la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois (le code a change ?)`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(mutation[0], mutation[1]));
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function appelMeta(centerId) {
  const handler = require('../api/public-booking-meta');
  const req = { method: 'GET', url: `/api/public-booking-meta?centerId=${centerId}`, headers: { host: 'localhost', 'x-forwarded-for': '10.9.0.1' }, socket: { remoteAddress: '10.9.0.1' } };
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (code, headers) => { res.statusCode = code; Object.assign(res.headers, headers || {}); };
  res.end = (chunk) => { res.body = chunk === undefined ? '' : String(chunk); };
  await handler(req, res);
  try { return JSON.parse(res.body || '{}'); } catch (error) { return {}; }
}

// L ecran 1 : le samedi du mock (un jour futur explicite, jamais aujourd hui)
// et le groupe ; l ecran 2 : les activites cochees ; l ecran 3 : les heures,
// jusqu a ce que le bloc de la visite soit rendu.
async function jusquAuxHeures(page, pax, ids) {
  await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  await page.click('#dayBtn');
  const [y, mo] = mock.DATE.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  await attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await attendre(page, () => document.querySelector('#dayPop').hidden, 3000);
  await page.fill('#paxInput', String(pax));
  await page.press('#paxInput', 'Enter');
  await attendre(page, (n) => document.querySelector('#paxInput').value === String(n), 3000, pax);
  await page.click('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000);
  for (const id of ids) {
    await page.click(`#gridAct .fg-card[data-activity="${id}"]`);
    await attendre(page, (x) => document.querySelector(`#gridAct .fg-card[data-activity="${x}"]`).getAttribute('aria-checked') === 'true', 3000, id);
  }
  const carte = await page.evaluate(() => blancsDom(document.querySelector('#gridAct .fg-card[data-activity="playground"] .fg-card__price')));
  const carteBrute = await page.evaluate(() => document.querySelector('#gridAct .fg-card[data-activity="playground"] .fg-card__price').textContent);
  await page.click('#goHours');
  const vu = await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering')
    && document.querySelector('#planZone .fg-visit') && !document.querySelector('#goContact').disabled, 15000);
  return { carte, carteBrute, vu };
}

async function lireVisite(page) {
  return page.evaluate(() => {
    const v = document.querySelector('#planZone .fg-visit');
    if (!v) return null;
    return {
      texte: blancsDom(v),
      entete: blancsDom(v.querySelector('.fg-visit__span')),
      etapes: Array.from(v.querySelectorAll('.fg-visit__step')).map((li) => ({ heure: blancsDom(li.querySelector('b')), titre: blancsDom(li.querySelector('span')), detail: blancsDom(li.querySelector('small')), libre: li.classList.contains('fg-visit__step--free') })),
      prix: Array.from(v.querySelectorAll('.fg-visit__prices > div')).map((d) => ({ dt: blancsDom(d.querySelector('dt')), dd: blancsDom(d.querySelector('dd')) })),
      barre: blancsDom(document.querySelector('#hourSum')),
    };
  });
}

async function lireRecap(page) {
  await page.click('#goContact');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000);
  return page.evaluate(() => {
    const r = document.querySelector('#recallBody');
    return {
      texte: blancsDom(r),
      items: Array.from(r.querySelectorAll('.fg-recap__item')).map((n) => ({ nom: blancsDom(n.querySelector('.fg-recap__name')), detail: blancsDom(n.querySelector('.fg-recap__detail')), aside: blancsDom(n.querySelector('.fg-recap__aside')) })),
    };
  });
}

const UNE_HEURE = /\b1 ?h\b|1 heure|\b60 min|environ/;

async function main() {
  // =====================================================================
  console.log('[A] LA DONNEE, LUE PAR LE VRAI CODE');
  // =====================================================================
  const { listCenterActivities } = require('../lib/activity-catalog');
  const { normalizeProgram } = require('../lib/visit-program');
  const { getCenter } = require('../lib/ops-knowledge');
  const catalogue = listCenterActivities('libramont');
  const plaine = catalogue.find((a) => a.id === 'playground');
  ok(Boolean(plaine) && plaine.dayAccess === true, '[A] le catalogue de Libramont marque la plaine comme une entree a la journee', plaine ? `dayAccess=${plaine.dayAccess}` : 'plaine absente');
  const autres = catalogue.filter((a) => a.id !== 'playground' && a.dayAccess !== false).map((a) => a.id);
  ok(catalogue.length > 3 && autres.length === 0, '[A] et elle seule : aucune autre activite n est une entree a la journee', autres.join(', ') || `${catalogue.length - 1} autres, toutes a false`);
  const theme = ((getCenter('libramont') || {}).activityThemes || {}).playground || {};
  ok(theme.ageRange === '4 à 12 ans', '[A] l age de la plaine est celui que dit Movsar, dans la donnee du centre que lit aussi l agent', JSON.stringify(theme.ageRange));
  const meta = await appelMeta('libramont');
  const metaPlaine = (meta.activities || []).find((a) => a.id === 'playground') || {};
  ok(metaPlaine.dayAccess === true && metaPlaine.ageRange === '4 à 12 ans' && metaPlaine.note === 'accès à la journée',
    '[A] la meta publique sert la plaine avec sa marque, l age du centre et la note du catalogue', JSON.stringify({ dayAccess: metaPlaine.dayAccess, ageRange: metaPlaine.ageRange, note: metaPlaine.note }));
  const sansAge = (meta.activities || []).filter((a) => a.id !== 'playground' && 'ageRange' in a).map((a) => a.id);
  ok(sansAge.length === 0, '[A] aucune autre activite ne recoit un age que le centre ne declare pas', sansAge.join(', ') || 'aucune');
  const metaGembloux = await appelMeta('gembloux');
  ok(Array.isArray(metaGembloux.activities) && metaGembloux.activities.length > 0 && !metaGembloux.activities.some((a) => a.id === 'playground'),
    '[A] Gembloux, qui n a pas de plaine, ne la sert pas (ni son age)', `${(metaGembloux.activities || []).length} activites`);
  const programme = normalizeProgram([{ activityId: 'playground' }], { centerId: 'libramont', pax: 2 });
  const ligne = programme.items[0] || {};
  // Le tarif (12 EUR par enfant) vit dans la base de prod (activities.price_value) :
  // le socle JSON n en porte pas, il ne se verifie donc pas ici.
  ok(ligne.dayAccess === true && ligne.minutes === 60 && programme.freeMinutes === 60,
    '[A] la ligne de programme garde la marque ; ses 60 minutes restent l estimation du planning', JSON.stringify({ dayAccess: ligne.dayAccess, minutes: ligne.minutes, freeMinutes: programme.freeMinutes }));
  const bowling = normalizeProgram([{ activityId: 'bowling', duration: 1 }], { centerId: 'libramont', pax: 2 }).items[0] || {};
  ok(!('dayAccess' in bowling), '[A] une ligne ordinaire ne porte aucune marque', Object.keys(bowling).join(','));

  // =====================================================================
  console.log('');
  console.log('[D] LE TUNNEL GENERIQUE (app-main.js), MEME REGLE');
  // =====================================================================
  // La ligne du recapitulatif du tunnel generique, extraite du fichier servi
  // et rendue ici avec ses vraies aides (booking-core, booking-config).
  const extraire = (src, nom) => {
    const i = src.indexOf(`function ${nom}(`);
    if (i < 0) return '';
    let n = 0;
    for (let k = src.indexOf('{', i); k < src.length; k += 1) {
      if (src[k] === '{') n += 1;
      else if (src[k] === '}') { n -= 1; if (!n) return src.slice(i, k + 1); }
    }
    return '';
  };
  const appMain = fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8');
  const coeur = fs.readFileSync(path.join(ROOT, 'assets', 'booking-core.js'), 'utf8');
  const { DURATION_OPTIONS } = require('../lib/booking-config');
  // eslint-disable-next-line no-new-func
  const ligneRecap = new Function('escapeHtml', 'DURATION_OPTIONS', `${extraire(coeur, 'formatDurationLabel')}\n${extraire(appMain, 'renderVisitRecapItem')}\nreturn renderVisitRecapItem;`)((s) => String(s), DURATION_OPTIONS);
  const detailDe = (html) => ((/recap-program-detail">([^<]*)</.exec(html) || [])[1] || '');
  const sansMarque = detailDe(ligneRecap({ activityId: 'playground', name: 'Playground', minutes: 60, priceKnown: true, price: 24 }));
  const avecMarque = detailDe(ligneRecap({ activityId: 'playground', name: 'Playground', dayAccess: true, minutes: 60, priceKnown: true, price: 24 }));
  ok(sansMarque === '1h', 'MONTAGE [D] la ligne du recap generique est bien rendue ici (sans la marque, 60 minutes s ecrivent « 1h »)', `« ${sansMarque} »`);
  ok(avecMarque === 'Accès toute la journée', '[D] avec la marque, le recap generique dit « Accès toute la journée », jamais « 1h »', `« ${avecMarque} »`);

  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const erreurs = [];
  try {
    // =====================================================================
    console.log('');
    console.log('[B] LE FORMULAIRE, LA PLAINE SEULE');
    // =====================================================================
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => { window.blancsDom = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : ''); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
    const b = await jusquAuxHeures(page, 2, ['playground']);
    ok(/accès à la journée · 4 à 12 ans$/.test(b.carte), '[B] la carte dit l entree a la journee et l age du centre', `« ${b.carte} »`);
    ok(b.carteBrute.indexOf('4\u00a0à\u00a012\u00a0ans') >= 0, '[B] l age ne se coupe pas en fin de ligne (espaces insecables)', JSON.stringify(b.carteBrute.slice(-14)));
    ok(b.vu, '[B] le bloc « Votre visite » est rendu pour la plaine seule');
    const vb = await lireVisite(page) || { texte: '', entete: '', etapes: [], prix: [], barre: '' };
    ok(/^dès \d{2}:\d{2}, accès toute la journée$/.test(vb.entete), '[B] l en-tete dit « dès HH:MM, accès toute la journée », sans heure de fin', `« ${vb.entete} »`);
    const libreB = vb.etapes.find((e) => e.libre) || {};
    ok(libreB.titre === 'Playground (toute la journée)' && libreB.detail === 'à votre rythme', '[B] la ligne libre dit « Playground (toute la journée) », « à votre rythme »', JSON.stringify(libreB));
    ok(!vb.etapes.some((e) => /Fin de la visite/.test(e.titre)), '[B] aucune « Fin de la visite » : une entree a la journee n a pas de fin a annoncer', vb.etapes.map((e) => e.titre).join(' | '));
    ok(/^dès \d{2}:\d{2}, toute la journée( · .+)?$/.test(vb.barre), '[B] la barre du bas dit « dès HH:MM, toute la journée », sans heure de fin', `« ${vb.barre} »`);
    ok(!UNE_HEURE.test(vb.texte), '[B] nulle part dans la visite « 1 heure », « 1 h » ni « environ »', `« ${vb.texte.slice(0, 160)} »`);
    const rb = await lireRecap(page);
    const lignePlaine = rb.items.find((i) => i.nom === 'Playground') || {};
    ok(lignePlaine.detail === '2 enfants · accès toute la journée · 4 à 12 ans' && lignePlaine.aside === 'à votre rythme',
      '[B] le recapitulatif dit « 2 enfants · accès toute la journée · 4 à 12 ans », « à votre rythme » (le groupe de 2, compteur par defaut)', JSON.stringify(lignePlaine));
    ok(!UNE_HEURE.test(rb.texte), '[B] nulle part dans le recapitulatif « 1 heure », « 1 h » ni « environ »', `« ${rb.texte.slice(0, 160)} »`);
    await ctx.close();

    // =====================================================================
    console.log('');
    console.log('[C] BOWLING + PLAINE');
    // =====================================================================
    const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxC.addInitScript(() => { window.blancsDom = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : ''); });
    const pageC = await ctxC.newPage();
    pageC.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
    const reponses = [];
    pageC.on('response', async (r) => { if (r.url().indexOf('/api/public-availability?') >= 0) { try { reponses.push(await r.json()); } catch (error) { /* reponse sans corps */ } } });
    const c = await jusquAuxHeures(pageC, 2, ['bowling', 'playground']);
    ok(c.vu, '[C] le bloc « Votre visite » est rendu pour bowling + plaine');
    const vc = await lireVisite(pageC) || { texte: '', entete: '', etapes: [], prix: [], barre: '' };
    const libreC = vc.etapes.find((e) => e.libre) || {};
    ok(libreC.titre === 'Playground (toute la journée)' && libreC.detail === 'à votre rythme', '[C] la ligne libre dit « Playground (toute la journée) », « à votre rythme », sans duree', JSON.stringify(libreC));
    const prixPlaine = vc.prix.find((p) => /^Playground/.test(p.dt)) || {};
    ok(prixPlaine.dt === 'Playground · toute la journée', '[C] le detail du prix dit « Playground · toute la journée »', JSON.stringify(prixPlaine));
    const derniere = reponses.filter((r) => r && Array.isArray(r.slots) && r.slots.length).pop() || {};
    const retenu = await pageC.evaluate(() => (document.querySelector('#planZone .fg-visit__step--out b') || {}).textContent || '');
    const fins = (derniere.slots || []).map((s) => s.visitEndTime).filter(Boolean);
    ok(Boolean(retenu) && fins.indexOf(retenu) >= 0, '[C] la fin estimee est celle de la reponse du serveur (la plaine y compte son heure d estimation)', `${retenu} parmi ${fins.slice(0, 4).join(', ')}`);
    const rc = await lireRecap(pageC);
    const plaineC = rc.items.find((i) => i.nom === 'Playground') || {};
    ok(plaineC.detail === '2 enfants · accès toute la journée · 4 à 12 ans', '[C] le recapitulatif dit la meme chose pour la plaine', JSON.stringify(plaineC));
    ok(erreurs.length === 0, '[B][C] aucune erreur JavaScript', erreurs.slice(0, 3).join(' | '));
    await ctxC.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('');
  console.log(`plaine-journee-check: ${reussis} ok, ${echecs} echec(s)${CASSE ? ` (contre-preuve ${CASSE})` : ''}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });

// LE SITE HOTE APPREND QU UNE DEMANDE DE GROUPE VIENT D ETRE ENVOYEE, ET LA
// PAGE EVENEMENTS OUVRE LE FORMULAIRE DIRECTEMENT SUR CETTE DEMANDE.
//
// POURQUOI CE GATE EXISTE (2026-11-03). Fun Galaxy compte dans GTM, GA4 et
// Meta les demandes de son formulaire d evenements (Localisy, 2026-09-14). Le
// formulaire Pinlane signalait la reservation au site (pinlane:booking, gate
// embed-booking-signal-check), pas la demande sur mesure : poser Pinlane a la
// place aurait coupe cette mesure en silence, pour la page Evenements comme
// pour les grands groupes des pages de reservation, qui passent par la demande.
//
// LES PROPRIETES :
//
//   [A] L OUVERTURE DIRECTE. Avec data-start="sur-mesure", le cadre s ouvre sur
//       l ecran du groupe, avec le fil d etapes de la demande, et le premier
//       ecran reste cache pendant le depart ; Retour y ramene, visible. Sans
//       l attribut, ou avec une autre valeur, rien ne change. Un centre qui a
//       quelque chose a dire sur le premier ecran (demonstration) le montre au
//       lieu d ouvrir la demande.
//
//   [B] RIEN AVANT L ENVOI. Au recapitulatif, le site n a rien recu.
//
//   [C] A L ENVOI, LE SITE RECOIT L EVENEMENT : un push `pinlane_demande` et un
//       CustomEvent `pinlane:demande`, avec le numero rendu par le vrai
//       gestionnaire, le centre, le type de groupe, l effectif et le jour ; le
//       Pixel Meta (`Lead`) et GA4 (`generate_lead`) appeles une fois chacun.
//
//   [D] AUCUNE DONNEE PERSONNELLE ne sort du cadre : ni nom, ni fonction, ni
//       coordonnees, ni organisation, ni TVA, ni message.
//
//   [E] data-track="datalayer" coupe les appels directs, le push reste.
//
//   [F] CONTRE-EPREUVES servies en memoire (le disque n est jamais touche) :
//       sans l emission, sans le relais, sans la lecture de start, sans le
//       masque du premier ecran, et avec une adresse glissee dans le signal,
//       ce gate ROUGIT.
//
// LE MONTAGE EST ASSERTE : le cadre est pose par embed.js lui-meme, et la
// demande passe par le vrai gestionnaire (api/public-booking-meta, ecriture
// gardee en memoire par scripts/dev-tunnel-server.js, aucun accuse envoye).
//
// Usage : node scripts/embed-demande-signal-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

// Rien de ce gate ne doit pouvoir ecrire en base, envoyer un mail ni lire la
// production : les cles sont retirees avant tout chargement.
delete process.env.RESEND_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_EMBED_DEMANDE_PORT || 4663);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

// Ce que le visiteur tape, et qui ne doit jamais sortir du cadre.
const SAISIE = {
  organisation: 'École communale du gate',
  prenom: 'Camille',
  nom: 'Gateau',
  fonction: 'Institutrice',
  email: 'camille.gateau@example.test',
  telephone: '0471 12 34 56',
  tva: 'BE 0123.456.789',
  message: 'Pique-nique a prevoir, bus a 16h.',
};

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }
async function attendre(cible, fn, ms, arg) {
  try { await cible.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return Boolean(await cible.evaluate(fn, arg).catch(() => false)); }
}

// Le jour du centre (Bruxelles), et l instant ou il est `heure` h a Bruxelles.
function jourBruxelles(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function plusJours(jour, n) {
  const [y, m, d] = jour.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function instantBruxelles(jour, heure) {
  const [y, m, d] = jour.split('-').map(Number);
  for (let decalage = -3; decalage <= 3; decalage += 1) {
    const t = new Date(Date.UTC(y, m - 1, d, heure - decalage, 0, 0));
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(t);
    const lire = (k) => (parts.find((p) => p.type === k) || {}).value;
    if (`${lire('year')}-${lire('month')}-${lire('day')}` === jour && Number(lire('hour')) % 24 === heure) return t;
  }
  throw new Error(`instant introuvable pour ${jour} ${heure}h`);
}

// ---------------------------------------------------------------------------
// La page hote : la page Evenements d un site, sa ligne embed.js, ses outils
// de mesure reduits a leur trace observable (une globale appelable).
// ---------------------------------------------------------------------------
const HOTE = { start: 'sur-mesure', track: '' };
function hostHtml() {
  const start = HOTE.start ? ` data-start="${HOTE.start}"` : '';
  const track = HOTE.track ? ` data-track="${HOTE.track}"` : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<header style="height:56px;background:#1b1b2f"></header><main><h1>Événements</h1><div class="container">
<script>
window.dataLayer = [];
window.__messages = [];
window.__customs = [];
window.__fbq = [];
window.__gtag = [];
window.fbq = function () { window.__fbq.push(Array.prototype.slice.call(arguments)); };
window.gtag = function () { window.__gtag.push(Array.prototype.slice.call(arguments)); };
addEventListener('message', function (e) { if (e.data && typeof e.data.type === 'string') window.__messages.push(e.data.type); });
addEventListener('pinlane:demande', function (e) { window.__customs.push(e.detail); });
</script>
<script src="${BASE_URL}/embed.js" data-center="libramont" data-design="fungalaxy"${start}${track}></script>
</div></main></body></html>`;
}

// Une contre-epreuve : { fichier, de, vers }, servie en memoire a la place du
// fichier, l ancre presente une seule fois.
const overrides = new Map();
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function sourceDisque(fichier) {
  return fs.readFileSync(path.join(ROOT, fichier), 'utf8').split(CRLF).join(LF);
}
async function avecMutation(editions, fn) {
  editions.forEach(({ fichier, de, vers }) => {
    const source = overrides.get(`/${fichier}`) || sourceDisque(fichier);
    const n = source.split(de).length - 1;
    if (n !== 1) throw new Error(`contre-epreuve non montable : ancre presente ${n} fois dans ${fichier} : ${de.slice(0, 70)}`);
    overrides.set(`/${fichier}`, source.split(de).join(vers));
  });
  try { return await fn(); } finally { overrides.clear(); }
}

function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/hote-evenements') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(hostHtml());
      return;
    }
    if (overrides.has(url.pathname)) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(url.pathname)] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(overrides.get(url.pathname));
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Le jour vise : ouvert tot et tard, au plus tot demain. L horloge du
// navigateur est posee la veille a 15 h a Bruxelles : la soiree du jour vise
// est alors a plus de 24 heures, quelle que soit l heure du lancement.
function jourVise(mock) {
  const aujourdHui = jourBruxelles();
  const ouverts = mock.metaPayload('', 90).center.calendar.filter((j) => j.open && j.date > aujourdHui);
  const cible = ouverts.find((j) => j.schedule.open <= 10 && j.schedule.close >= 21) || ouverts[0];
  return { cible, horloge: instantBruxelles(plusJours(cible.date, -1), 15) };
}

// Ouvre la page hote ; rend le cadre pose par embed.js et ce qui s y passe.
async function ouvrirHote(browser, { start = 'sur-mesure', track = '', horloge = null, demonstration = false } = {}) {
  HOTE.start = start;
  HOTE.track = track;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (horloge) await ctx.clock.setFixedTime(horloge);
  // Dans le cadre seulement : tant que le depart sur la demande est en cours,
  // ce que montre le premier ecran, image par image.
  await ctx.addInitScript(() => {
    if (!/^\/fungalaxy\//.test(location.pathname)) return;
    window.__departVu = [];
    const tick = () => {
      const b = document.body;
      if (b && b.classList.contains('fg-depart-sm')) {
        const d = document.querySelector('.fg-scene[data-scene="date"]');
        window.__departVu.push(d ? getComputedStyle(d).visibility : 'absent');
      }
      if (!document.querySelector('.fg-scene[data-scene="sm-groupe"].is-active') && window.__departVu.length < 5000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (demonstration) {
    await ctx.route('**/api/public-booking-meta*', async (route) => {
      const rep = await route.fetch();
      const j = await rep.json();
      if (j && j.center && typeof j.center === 'object') j.center.demonstration = true;
      await route.fulfill({ response: rep, json: j });
    });
  }
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(`${BASE_URL}/hote-evenements`, { waitUntil: 'domcontentloaded' });
  const cadre = await page.waitForSelector('iframe[title="Reservation en ligne"]', { timeout: 10000 });
  const src = await cadre.getAttribute('src');
  const frame = await cadre.contentFrame();
  await frame.waitForSelector('body.is-ready', { timeout: 20000 });
  return { ctx, page, frame, src, erreurs };
}

async function lireHote(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify({
    dataLayer: window.dataLayer || [], messages: window.__messages, customs: window.__customs, fbq: window.__fbq, gtag: window.__gtag,
  })));
}
function demandesPoussees(hote) { return hote.dataLayer.filter((e) => e && e.event === 'pinlane_demande'); }
const SCENE_ACTIVE = (id) => document.querySelector(`.fg-scene[data-scene="${id}"].is-active`) !== null;

// La demande remplie par de vrais gestes, jusqu au recapitulatif, puis envoyee.
async function parcoursDemande(browser, mock) {
  const { cible, horloge } = jourVise(mock);
  const h = await ouvrirHote(browser, { horloge });
  const { page, frame: f } = h;
  const r = { erreurs: h.erreurs, src: h.src, cible: cible.date };
  try {
    r.groupe = await attendre(f, SCENE_ACTIVE, 8000, 'sm-groupe');
    await page.waitForTimeout(700);
    await f.click('.fg-occasion[data-type="ecole"]');
    await f.fill('#smOrg', SAISIE.organisation);
    await f.click('.fg-sm-chip[data-age="7-12"]');
    await f.click('#smCompPlus');
    await f.click('#smCompPlus');
    r.pax = Number(await f.inputValue('#smPax'));
    await f.click('#smGoDate');
    r.date = await attendre(f, SCENE_ACTIVE, 8000, 'sm-date');
    await page.waitForTimeout(700);
    await f.click('#smDateBtn');
    await f.waitForSelector('#dayPop:not([hidden])', { timeout: 5000 });
    for (let k = 0; k < 3 && !(await f.$(`.fg-cal__day[data-date="${cible.date}"]`)); k += 1) { await f.click('#calNext'); await page.waitForTimeout(250); }
    await attendre(f, (d) => { const b = document.querySelector(`.fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, cible.date);
    await f.click(`.fg-cal__day[data-date="${cible.date}"]`);
    await page.waitForTimeout(300);
    await f.click('.fg-sm-moment[data-moment="soiree"]');
    await f.click('#smGoEnvies');
    r.envies = await attendre(f, SCENE_ACTIVE, 8000, 'sm-envies');
    await page.waitForTimeout(700);
    await f.click('#smGridAct .fg-card[data-sm="bowling"]');
    await f.click('#smGoContact');
    r.contact = await attendre(f, SCENE_ACTIVE, 8000, 'sm-contact');
    await page.waitForTimeout(700);
    await f.fill('#smPrenom', SAISIE.prenom);
    await f.fill('#smNom', SAISIE.nom);
    await f.fill('#smRole', SAISIE.fonction);
    await f.fill('#smEmail', SAISIE.email);
    await f.fill('#smTel', SAISIE.telephone);
    await f.check('#smInvoice', { force: true });
    await f.fill('#smVat', SAISIE.tva);
    await f.fill('#smMessage', SAISIE.message);
    await f.check('#smConsent', { force: true });
    await f.click('#smGoRecap');
    r.recap = await attendre(f, SCENE_ACTIVE, 8000, 'sm-recap');
    await page.waitForTimeout(700);
    r.avantEnvoi = await lireHote(page);
    mock.dernierePose.demande = null;
    const attenteReponse = page.waitForResponse((rep) => rep.url().includes('/api/custom-request') && rep.request().method() === 'POST', { timeout: 15000 });
    await f.click('#smSend');
    const rep = await attenteReponse;
    r.statut = rep.status();
    r.reponse = await rep.json().catch(() => ({}));
    r.fin = await attendre(f, SCENE_ACTIVE, 10000, 'fin');
    await page.waitForTimeout(600);
    r.apresEnvoi = await lireHote(page);
    r.ligne = mock.dernierePose.demande;
    return r;
  } finally { await h.ctx.close(); }
}

// Le depart seul : ou s ouvre le cadre, ce qu a montre le premier ecran, et ou
// mene Retour.
async function depart(browser, options = {}) {
  const h = await ouvrirHote(browser, options);
  const { page, frame: f } = h;
  try {
    const r = { erreurs: h.erreurs, src: h.src };
    r.ouverte = await attendre(f, SCENE_ACTIVE, options.attente || 8000, 'sm-groupe');
    await page.waitForTimeout(700);
    r.etat = await f.evaluate(() => ({
      scene: (document.querySelector('.fg-scene.is-active') || {}).dataset ? document.querySelector('.fg-scene.is-active').dataset.scene : '',
      parcours: document.body.dataset.parcours,
      etapes: Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item .lbl')).map((x) => x.textContent.trim()),
      classeDepart: document.body.classList.contains('fg-depart-sm'),
      alerte: document.getElementById('fgAlert').hidden ? '' : document.getElementById('fgAlert').textContent,
      vu: (window.__departVu || []).slice(),
    }));
    if (options.retour && r.ouverte) {
      await f.click('.fg-scene[data-scene="sm-groupe"] [data-back]');
      r.retour = await attendre(f, SCENE_ACTIVE, 8000, 'date');
      await page.waitForTimeout(700);
      r.retourVisible = await f.evaluate(() => getComputedStyle(document.querySelector('.fg-scene[data-scene="date"]')).visibility);
    }
    return r;
  } finally { await h.ctx.close(); }
}

// Le relais seul : un message pinlane:demande emis par le cadre lui-meme.
async function relais(browser, { track = '' } = {}) {
  const h = await ouvrirHote(browser, { track });
  try {
    await attendre(h.frame, SCENE_ACTIVE, 8000, 'sm-groupe');
    await h.frame.evaluate(() => window.parent.postMessage({ type: 'pinlane:demande', detail: { requestId: 7, center: 'libramont', type: 'entreprise', pax: 12, date: '', status: 'received' } }, '*'));
    await h.page.waitForTimeout(400);
    return { hote: await lireHote(h.page), erreurs: h.erreurs };
  } finally { await h.ctx.close(); }
}

function verifierDepart(d, sans, autre, demo) {
  section('A. L OUVERTURE DIRECTE');
  ok(d.erreurs.length === 0, 'aucune erreur dans la page', d.erreurs.join(' | '));
  ok(/^http:\/\/127\.0\.0\.1:\d+\/fungalaxy\/libramont\?embed=1&start=sur-mesure(&|$)/.test(d.src), 'MONTAGE le cadre est pose par embed.js, sur le formulaire du centre, avec start=sur-mesure', d.src);
  ok(d.ouverte && d.etat.parcours === 'sur-mesure' && d.etat.etapes.join('|') === 'Votre groupe|Date|Envies|Coordonnées|Envoi',
    'data-start="sur-mesure" : le cadre s ouvre sur l ecran du groupe, avec le fil d etapes de la demande', JSON.stringify({ scene: d.etat.scene, etapes: d.etat.etapes }));
  ok(d.etat.vu.length > 0 && d.etat.vu.every((v) => v === 'hidden'),
    'pendant le depart, le premier ecran reste cache, a chaque image', `${d.etat.vu.length} image(s), vues : ${[...new Set(d.etat.vu)].join(', ')}`);
  ok(!d.etat.classeDepart, 'la demande ouverte, la page n est plus en mode depart');
  ok(d.retour && d.retourVisible === 'visible', 'Retour ramene au premier ecran, et il se voit', `${d.retour} ${d.retourVisible}`);
  ok(!/start=/.test(sans.src) && !sans.ouverte && sans.etat.scene === 'date' && !sans.etat.classeDepart,
    'sans l attribut, rien ne change : le premier ecran, la reservation', JSON.stringify({ src: sans.src, scene: sans.etat.scene }));
  ok(!/start=/.test(autre.src) && !autre.ouverte && autre.etat.scene === 'date',
    'une autre valeur est ignoree', JSON.stringify({ src: autre.src, scene: autre.etat.scene }));
  ok(!demo.ouverte && demo.etat.scene === 'date' && /démonstration/.test(demo.etat.alerte) && !demo.etat.classeDepart,
    'un centre de demonstration montre son premier ecran et son message au lieu d ouvrir la demande', JSON.stringify({ scene: demo.etat.scene, alerte: demo.etat.alerte }));
}

function verifierEnvoi(r) {
  section('B. RIEN AVANT L ENVOI');
  ok(r.erreurs.length === 0, 'aucune erreur dans la page', r.erreurs.join(' | '));
  ok(r.groupe && r.date && r.envies && r.contact && r.recap, 'MONTAGE la demande se remplit ecran par ecran jusqu au recapitulatif', JSON.stringify({ g: r.groupe, d: r.date, e: r.envies, c: r.contact, r: r.recap }));
  const avant = r.avantEnvoi;
  ok(demandesPoussees(avant).length === 0 && avant.customs.length === 0 && avant.fbq.length === 0 && avant.gtag.length === 0,
    'au recapitulatif, le site n a rien recu', JSON.stringify({ dl: demandesPoussees(avant).length, ev: avant.customs.length, fbq: avant.fbq.length, gtag: avant.gtag.length }));

  section('C. A L ENVOI, LE SITE RECOIT L EVENEMENT');
  ok(r.statut === 201 && r.reponse.ok === true && Number.isInteger(r.reponse.id) && r.ligne && r.fin,
    'MONTAGE le vrai gestionnaire accepte la demande (ecriture gardee en memoire), l ecran final s affiche', JSON.stringify({ statut: r.statut, id: r.reponse.id, ligne: Boolean(r.ligne), fin: r.fin }));
  const apres = r.apresEnvoi;
  const poussees = demandesPoussees(apres);
  ok(poussees.length === 1, 'le dataLayer du site recoit exactement un pinlane_demande', `${poussees.length}`);
  const d = (poussees[0] || {}).pinlane || {};
  ok(d.requestId === r.reponse.id, 'le numero est celui que le serveur a rendu', `${d.requestId} / ${r.reponse.id}`);
  ok(d.center === 'libramont' && d.type === 'ecole' && d.pax === r.pax && d.pax > 0 && d.date === r.cible && d.status === 'received',
    'le centre, le type de groupe, l effectif, le jour voulu et le statut', JSON.stringify(d));
  ok(apres.customs.length === 1 && JSON.stringify(apres.customs[0]) === JSON.stringify(d), 'un CustomEvent pinlane:demande porte le meme objet', JSON.stringify(apres.customs));
  ok(!apres.dataLayer.some((e) => e && e.event === 'pinlane_booking'), 'une demande n est pas comptee comme une reservation');
  const meta = apres.fbq[0] || [];
  const ga = apres.gtag[0] || [];
  ok(apres.fbq.length === 1 && meta[0] === 'track' && meta[1] === 'Lead' && (meta[2] || {}).content_category === 'ecole',
    'le Pixel Meta du site recoit un Lead, une fois', JSON.stringify(apres.fbq));
  ok(apres.gtag.length === 1 && ga[0] === 'event' && ga[1] === 'generate_lead' && (ga[2] || {}).center === 'libramont',
    'GA4 recoit un generate_lead, une fois', JSON.stringify(apres.gtag));

  section('D. AUCUNE DONNEE PERSONNELLE NE SORT DU CADRE');
  const sortie = JSON.stringify(apres);
  const fuites = Object.entries(SAISIE).filter(([, v]) => sortie.includes(v) || sortie.includes(v.replace(/\s+/g, '')));
  ok(fuites.length === 0, 'ni nom, ni fonction, ni coordonnees, ni organisation, ni TVA, ni message dans ce que recoit le site', fuites.map(([k]) => k).join(', '));
}

function verifierRelais(dl) {
  section('E. data-track="datalayer" COUPE LES APPELS DIRECTS');
  ok(dl.erreurs.length === 0, 'aucune erreur dans la page', dl.erreurs.join(' | '));
  ok(demandesPoussees(dl.hote).length === 1 && dl.hote.customs.length === 1, 'le push et le CustomEvent restent', JSON.stringify(dl.hote.dataLayer.filter((e) => e && e.event)));
  ok(dl.hote.fbq.length === 0 && dl.hote.gtag.length === 0, 'ni Pixel Meta ni GA4 appeles : le site cable lui-meme dans GTM, sans double compte', JSON.stringify({ fbq: dl.hote.fbq, gtag: dl.hote.gtag }));
}

async function contreEpreuves(browser, mock) {
  section('F. CONTRE-EPREUVES');
  const emission = await avecMutation([{ fichier: 'assets/fungalaxy-sur-mesure.js', de: "I.poster({ type: 'pinlane:demande', detail: {", vers: "void ({ type: 'pinlane:demande', detail: {" }],
    () => parcoursDemande(browser, mock));
  ok(emission.fin && demandesPoussees(emission.apresEnvoi).length === 0 && emission.apresEnvoi.fbq.length === 0,
    'sans l emission dans la demande, la demande part mais le site ne recoit rien : C rougirait', JSON.stringify({ fin: emission.fin, dl: demandesPoussees(emission.apresEnvoi).length }));

  const relaisCoupe = await avecMutation([{ fichier: 'embed.js', de: "window.dataLayer.push({ event: 'pinlane_demande', pinlane: demande });", vers: 'void demande;' }],
    () => relais(browser));
  ok(relaisCoupe.hote.messages.includes('pinlane:demande') && demandesPoussees(relaisCoupe.hote).length === 0,
    'sans le relais dans embed.js, le message arrive mais le dataLayer reste vide : C et E rougiraient', JSON.stringify({ messages: relaisCoupe.hote.messages.filter((m) => m === 'pinlane:demande').length, dl: demandesPoussees(relaisCoupe.hote).length }));

  const sansStart = await avecMutation([{ fichier: 'assets/fungalaxy-booking.js', de: "var DEPART_SUR_MESURE = params.get('start') === 'sur-mesure';", vers: 'var DEPART_SUR_MESURE = false;' }],
    () => depart(browser, { attente: 3000 }));
  ok(!sansStart.ouverte && sansStart.etat.scene === 'date', 'sans la lecture de start, le cadre reste sur le premier ecran : A rougirait', JSON.stringify(sansStart.etat.scene));

  const sansMasque = await avecMutation([{ fichier: 'assets/fungalaxy-booking.css', de: '.fg.fg-depart-sm .fg-scene[data-scene="date"] { visibility: hidden; }', vers: '.fg.fg-depart-sm .fg-scene[data-scene="date"] { }' }],
    () => depart(browser));
  ok(sansMasque.etat.vu.includes('visible'), 'sans le masque, le premier ecran se voit pendant le depart : A rougirait', [...new Set(sansMasque.etat.vu)].join(', '));

  const fuite = await avecMutation([{ fichier: 'assets/fungalaxy-sur-mesure.js', de: 'pax: Number(sm.participants) || 0, date:', vers: 'email: (sm.contact || {}).email, pax: Number(sm.participants) || 0, date:' }],
    () => parcoursDemande(browser, mock));
  ok(JSON.stringify(fuite.apresEnvoi).includes(SAISIE.email), 'une adresse glissee dans le signal se lit chez le site : D rougirait', `${demandesPoussees(fuite.apresEnvoi).length} push`);
}

async function main() {
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const srv = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const d = await depart(browser, { retour: true });
    const sans = await depart(browser, { start: '', attente: 3000 });
    const autre = await depart(browser, { start: 'autre', attente: 3000 });
    const demo = await depart(browser, { demonstration: true, attente: 3000 });
    verifierDepart(d, sans, autre, demo);
    verifierEnvoi(await parcoursDemande(browser, mock));
    verifierRelais(await relais(browser, { track: 'datalayer' }));
    await contreEpreuves(browser, mock);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${echecs === 0 ? 'embed-demande-signal-check: ALL OK' : `embed-demande-signal-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });

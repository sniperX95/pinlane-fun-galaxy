// LA COUPURE TIENT COTE PINLANE (2026-11-14).
//
// Pourquoi ce gate existe. Le 13/11, Ansar coupe la reservation en ligne de Fun Galaxy depuis la Tour de controle.
// Le 14/11 a 10 h 56, une cliente reserve quand meme a Libramont, depuis la page Contact du site, et recoit sa
// confirmation. L interrupteur ne fermait que la page du site : embed.js retire le cadre Pinlane quand il lit la
// coupure, le garde quand cette lecture echoue (choix : une panne ne bascule rien), et le serveur ne la lisait
// jamais. Ansar : « aucun client reel quand c desactive doit voir le formulaire doit pouvoir faire une resa etc etc
// surtout aucun mail ».
//
// LES PROPRIETES :
//
//   [S] LE SERVEUR, avec les VRAIS gestionnaires sur une base simulee qui rend la ligne que la console ecrit
//       (centers.settings.config.embed). Aucune cle, aucun reseau : un appel sortant (mail, Telegram) est compte.
//       S1 la regle : Libramont coupe donne une phrase pour le client, Gembloux en ligne rien, un centre vide ou
//          inconnu rien ; la phrase respecte lib/client-writing.
//       S2 la porte commune : Libramont refuse (422, code), Gembloux la passe.
//       S3 la reservation (api/public-reservations) : refusee, et RIEN ne s ecrit ni ne part.
//       S4 la retenue des horaires (?action=hold) : refusee, rien ne s ecrit.
//       S5 la demande sur mesure (/api/custom-request) : refusee, rien ne s ecrit, aucun accuse de reception.
//       S6 les heures : aucune, avec la phrase.
//       S7 le catalogue : `coupure` pour Libramont, absent pour Gembloux.
//
//   [F] LE NAVIGATEUR, avec les vrais embed.js, fungalaxy.html et fungalaxy-booking.js, et le vrai catalogue.
//       Depuis le 14/11 au soir, embed.js demande d abord et ne monte rien sans « en ligne » (Ansar : « faut
//       vraiment que le formulaire soit completement retire tu vois pas cache »). Un observateur pose avant tout
//       script note chaque cadre et chaque masque ajoutes a la page, et le serveur note chaque chargement du
//       formulaire Pinlane.
//       F1 coupe, mais « en ligne » encore en cache (60 s apres le clic) : le cadre se monte, lit la coupure avec
//          son catalogue et se retire ; le site rend son ancien formulaire ; rien ne part.
//       F2 a l adresse directe du formulaire : rien ne se montre que la phrase, et rien ne part.
//       F3 temoin, centre en ligne : le cadre se monte et le formulaire se montre (sans lui, le reste ne prouve rien).
//       F4 coupe : rien n est monte ni masque, a aucun moment, et le formulaire Pinlane n est meme pas charge.
//       F5 lecture de l interrupteur en panne (le cas du 14/11) : pareil.
//       F6 pas de reponse en 3,5 s : pareil, meme quand « en ligne » arrive apres.
//       F7 le visiteur a commence l ancien formulaire avant la reponse : il le garde.
//
//   [X] LES CONTRE-PREUVES : chaque piece retiree (porte commune, demande sur mesure, catalogue, formulaire,
//       embed.js qui ecoute le cadre, qui attend la reponse, qui refuse la panne, qui borne l attente, qui garde
//       l ancien formulaire commence) doit faire rougir sa propriete.
//
// Usage : node scripts/coupure-en-ligne-check.js
'use strict';
['DATABASE_URL', 'POSTGRES_URL', 'RESEND_API_KEY', 'RESEND_INBOUND_API_KEY', 'TELEGRAM_JETON', 'TELEGRAM_CHAT', 'TELEGRAM_GROUPE', 'ANTHROPIC_API_KEY'].forEach((cle) => { delete process.env[cle]; });
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_COUPURE_PORT || 4247);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CODE = 'reservation_en_ligne_coupee';

let echecs = 0;
let passes = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail && !cond ? `  ${detail}` : ''}`);
  if (cond) passes += 1; else echecs += 1;
  return cond;
}

// AUCUN APPEL SORTANT : un mail (Resend), une alerte (Telegram) ou quoi que ce soit d autre passe par fetch. Le gate
// le compte et le refuse ; une propriete qui dit « rien ne part » le verifie.
const SORTANTS = [];
global.fetch = async (url) => { SORTANTS.push(String(url).slice(0, 80)); throw new Error('aucun appel sortant dans ce gate'); };

// --- La base simulee ------------------------------------------------------------------------------------------------
let LIGNES = [];
let version = 0;
const ECRITURES = [];
function ligneCentre(id, embed) {
  return { id, name: id, status: 'active', timezone: 'Europe/Brussels', settings: { config: embed ? { embed } : {} } };
}
function poserCentres({ libramontCoupe }) {
  LIGNES = [
    ligneCentre('libramont', libramontCoupe ? { actif: false, bascule: new Date().toISOString(), basculePar: 'Ansar' } : { actif: true, bascule: new Date().toISOString(), basculePar: 'Ansar' }),
    ligneCentre('gembloux', null),
  ];
  version += 1;
}

// Les modules du depot, recharges a chaque montage : une contre-preuve compile sa version modifiee a la place du
// fichier, en memoire ; le disque n est jamais ecrit.
function purger() {
  for (const cle of Object.keys(require.cache)) {
    if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`)) delete require.cache[cle];
  }
}
function compilerAvec(rel, de, vers) {
  const fichier = path.join(ROOT, rel);
  const source = fs.readFileSync(fichier, 'utf8').split('\r\n').join('\n');
  if (source.split(de).length !== 2) throw new Error(`contre-preuve impossible, ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  m._compile(source.split(de).join(vers), fichier);
  m.loaded = true;
  require.cache[fichier] = m;
}
function monter(mutations = []) {
  purger();
  for (const mu of mutations.filter((x) => !x.navigateur)) compilerAvec(mu.fichier, mu.de, mu.vers);
  const database = require(path.join(ROOT, 'lib/database'));
  const rateLimit = require(path.join(ROOT, 'lib/rate-limit'));
  const { SQL_EMPREINTES } = require(path.join(ROOT, 'lib/cache-empreintes'));
  const requete = async (sql) => {
    const s = String((sql && sql.text) || sql);
    if (/^\s*(insert|update|delete|with\b[\s\S]*\b(insert|update|delete)\b)/i.test(s)) ECRITURES.push(s.replace(/\s+/g, ' ').slice(0, 70));
    if (s === SQL_EMPREINTES) return { rows: [{ centres: `v${version}` }], rowCount: 1 };
    if (/from centers/.test(s)) return { rows: LIGNES, rowCount: LIGNES.length };
    return { rows: [], rowCount: 0 };
  };
  database.getPool = () => ({ query: requete, connect: async () => ({ query: requete, release() {} }), on() {}, end: async () => {} });
  for (const nom of ['createReservation', 'createCommunication']) {
    if (typeof database[nom] === 'function') database[nom] = async () => { ECRITURES.push(nom); throw new Error(`${nom} interdit dans ce gate`); };
  }
  rateLimit.enforceRateLimit = () => false;
  const secours = require(path.join(ROOT, 'lib/secours-envoi'));
  secours.transmettreEnPanne = async () => { SORTANTS.push('boite de secours'); return false; };
  return {
    ops: require(path.join(ROOT, 'lib/ops-knowledge')),
    porte: require(path.join(ROOT, 'lib/demande-publique')),
    reservations: require(path.join(ROOT, 'api/public-reservations')),
    meta: require(path.join(ROOT, 'api/public-booking-meta')),
    heures: require(path.join(ROOT, 'api/public-availability')),
  };
}

async function appeler(handler, { method = 'GET', url, body = null }) {
  const corps = body ? JSON.stringify(body) : '';
  const req = Readable.from(corps ? [Buffer.from(corps)] : []);
  Object.assign(req, { method, url, headers: { host: 'app.pinlane.test', 'content-type': 'application/json', origin: 'https://fungalaxy.be' }, socket: { remoteAddress: '203.0.113.7' }, connection: { remoteAddress: '203.0.113.7' } });
  const res = {
    statusCode: 200, headers: {}, headersSent: false,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    removeHeader(k) { delete this.headers[String(k).toLowerCase()]; },
    writeHead(s, h) { this.statusCode = s; if (h) Object.entries(h).forEach(([k, v]) => this.setHeader(k, v)); return this; },
    write(b) { this.corps = (this.corps || '') + String(b || ''); return true; },
    end(b) { if (b) this.corps = (this.corps || '') + String(b); this.headersSent = true; },
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corps || ''); } catch (error) { json = null; }
  return { statut: res.statusCode, json, brut: String(res.corps || '').slice(0, 160), entetes: res.headers };
}

// Demain a Bruxelles : une date valide, a venir, dans l horizon.
function demain() {
  const d = new Date(Date.now() + 36 * 3600 * 1000);
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function demandeDe(centre) {
  return {
    centerId: centre, date: demain(), startTime: '15:00', pax: 4, type: 'bowling', duration: 1,
    name: 'Essai du gate', email: 'essai@exemple.invalid', phone: '0400000000',
    program: [{ activityId: 'bowling', participants: 4, minutes: 60 }],
  };
}

// --- [S] le serveur -------------------------------------------------------------------------------------------------
async function proprietesServeur(mutations = []) {
  const r = {};
  poserCentres({ libramontCoupe: true });
  const m = monter(mutations);
  await m.ops.refreshCenterOverrides(require(path.join(ROOT, 'lib/database')).getPool());
  r.regleLibramont = m.ops.coupureEnLigne('libramont');
  r.regleGembloux = m.ops.coupureEnLigne('gembloux');
  r.regleVide = m.ops.coupureEnLigne('');
  r.regleInconnu = m.ops.coupureEnLigne('centre-qui-n-existe-pas');
  r.porteLibramont = await m.porte.ouvrirDemandePublique(demandeDe('libramont'));
  r.porteGembloux = await m.porte.ouvrirDemandePublique(demandeDe('gembloux'));
  const avant = { ecritures: ECRITURES.length, sortants: SORTANTS.length };
  r.reservation = await appeler(m.reservations, { method: 'POST', url: '/api/public-reservations', body: demandeDe('libramont') });
  r.retenue = await appeler(m.reservations, { method: 'POST', url: '/api/public-reservations?action=hold', body: demandeDe('libramont') });
  r.surMesure = await appeler(m.meta, { method: 'POST', url: '/api/custom-request', body: { kind: 'custom-request', centerId: 'libramont', contactName: 'Essai du gate', email: 'essai@exemple.invalid', phone: '0400000000', pax: 40, message: 'Un groupe de quarante.', requestedDate: demain() } });
  r.ecritures = ECRITURES.slice(avant.ecritures);
  r.sortants = SORTANTS.slice(avant.sortants);
  r.heures = await appeler(m.heures, { url: `/api/public-availability?centerId=libramont&date=${demain()}&pax=4&type=bowling&duration=1` });
  r.catalogueLibramont = await appeler(m.meta, { url: '/api/public-booking-meta?centerId=libramont&calendar=45' });
  r.catalogueGembloux = await appeler(m.meta, { url: '/api/public-booking-meta?centerId=gembloux&calendar=45' });
  return r;
}
function juger(r) {
  const ecriture = require(path.join(ROOT, 'lib/client-writing'));
  const ecarts = ecriture.verifierEcritureClient(r.regleLibramont, { etat: 'sans-promesse' });
  ok(/ne se prennent pas ici/.test(r.regleLibramont) && r.regleGembloux === '' && r.regleVide === '' && r.regleInconnu === '', '[S1] Libramont coupe a sa phrase ; Gembloux en ligne, un centre vide ou inconnu, aucune', JSON.stringify([r.regleLibramont, r.regleGembloux, r.regleVide, r.regleInconnu]));
  ok(ecarts.length === 0 && !/[\u2013\u2014]/.test(r.regleLibramont), '[S1] la phrase respecte lib/client-writing (ni « nous » ni « on », sans promesse) et n a pas de tiret long', JSON.stringify(ecarts));
  ok(r.porteLibramont.ok === false && r.porteLibramont.status === 422 && r.porteLibramont.extra && r.porteLibramont.extra.code === CODE, '[S2] la porte commune refuse Libramont coupe (422, code)', JSON.stringify(r.porteLibramont));
  ok(!(r.porteGembloux.extra && r.porteGembloux.extra.code === CODE), '[S2] Gembloux, en ligne, passe cette porte', JSON.stringify(r.porteGembloux));
  ok(r.reservation.statut === 422 && r.reservation.json && r.reservation.json.code === CODE, '[S3] la reservation de Libramont coupe est refusee (422, code)', JSON.stringify(r.reservation));
  ok(r.retenue.statut === 422 && r.retenue.json && r.retenue.json.code === CODE, '[S4] la retenue des horaires est refusee (422, code)', JSON.stringify(r.retenue));
  ok(r.surMesure.statut === 422 && r.surMesure.json && r.surMesure.json.code === CODE, '[S5] la demande sur mesure est refusee (422, code)', JSON.stringify(r.surMesure));
  ok(r.ecritures.length === 0, '[S3-S5] rien ne s ecrit en base : ni reservation, ni retenue, ni demande, ni mail en file', JSON.stringify(r.ecritures));
  ok(r.sortants.length === 0, '[S3-S5] rien ne part : aucun mail, aucune alerte, aucune boite de secours', JSON.stringify(r.sortants));
  const heures = r.heures.json || {};
  ok(Array.isArray(heures.slots) && heures.slots.length === 0 && heures.code === CODE && /ne se prennent pas ici/.test(String(heures.message || '')), '[S6] aucune heure proposee, avec la phrase', JSON.stringify(r.heures).slice(0, 220));
  ok(Boolean(r.catalogueLibramont.json && /ne se prennent pas ici/.test(String(r.catalogueLibramont.json.coupure || ''))), '[S7] le catalogue de Libramont porte la coupure', JSON.stringify(r.catalogueLibramont).slice(0, 220));
  ok(Boolean(r.catalogueGembloux.json && r.catalogueGembloux.json.ok !== false && !('coupure' in r.catalogueGembloux.json)), '[S7] le catalogue de Gembloux n en dit rien', JSON.stringify(r.catalogueGembloux).slice(0, 220));
}

// --- [F] le navigateur ----------------------------------------------------------------------------------------------
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon' };
const NAV = { etat: 'actif', mutations: [], handlers: null, envois: [], pages: [] };
function pageDuSite() {
  // La structure du theme de Fun Galaxy et la ligne posee dans WordPress (docs/embed-wordpress.md).
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Contact</title></head><body>
    <section id="booking"><div class="container">
      <div class="heading"><h2>Réservez</h2></div>
      <div class="booking__container"><div id="gform_wrapper_4"><form><label>Ancien formulaire du site</label><input name="nom"></form></div></div>
    </div></section>
    <script src="${BASE_URL}/embed.js" data-center="libramont" data-design="fungalaxy" data-target="#booking .container" data-fallback="#booking .heading, #booking .booking__container"></script>
  </body></html>`;
}
function fichierServi(rel) {
  let texte = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
  for (const mu of NAV.mutations.filter((x) => x.navigateur && x.fichier === rel)) {
    if (texte.split(mu.de).length !== 2) throw new Error(`contre-preuve impossible dans ${rel}`);
    texte = texte.split(mu.de).join(mu.vers);
  }
  return texte;
}
async function deleguer(handler, req, res, url) {
  let corps = '';
  for await (const morceau of req) corps += morceau;
  const r = await appeler(handler, { method: req.method, url: url.pathname + url.search, body: corps ? JSON.parse(corps) : null });
  res.writeHead(r.statut, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(r.json || {}));
}
function serveur() {
  const srv = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, BASE_URL);
      const p = url.pathname;
      if (p === '/site') { res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }); res.end(pageDuSite()); return; }
      if (p === '/embed.js') { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' }); res.end(fichierServi('embed.js')); return; }
      if (/^\/fungalaxy\/[a-z0-9-]+$/.test(p)) { NAV.pages.push(p); res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }); res.end(fichierServi('fungalaxy.html')); return; }
      if (p === '/api/public-booking-meta' && req.method === 'GET' && url.searchParams.get('embedState')) {
        // La lecture de l interrupteur depuis le site, dans tous ses etats (le 14/11 : en panne chez la cliente).
        const repondre = (actif) => { res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: true, center: url.searchParams.get('center'), actif })); };
        if (NAV.etat === 'panne') { res.writeHead(503); res.end('{}'); return; }
        if (NAV.etat === 'coupe') { repondre(false); return; }
        if (NAV.etat === 'lent') { setTimeout(() => repondre(true), 6000); return; }
        if (NAV.etat === 'actif-lent') { setTimeout(() => repondre(true), 1500); return; }
        repondre(true);
        return;
      }
      if (p === '/api/public-booking-meta' && req.method === 'GET') { await deleguer(NAV.handlers.meta, req, res, url); return; }
      if (/^\/api\/(public-reservations|public-holds|custom-request)$/.test(p) || (p === '/api/public-booking-meta' && req.method === 'POST')) {
        let corps = '';
        for await (const morceau of req) corps += morceau;
        let kind = '';
        try { kind = String((JSON.parse(corps || '{}') || {}).kind || ''); } catch (error) { kind = ''; }
        const envoi = p === '/api/public-booking-meta' ? `meta:${kind}` : p;
        // Les mesures du parcours (etapes, gestes) ne reservent rien ; tout le reste est un envoi du client.
        if (!/^meta:(etapes|vitrine|heures-pleines|erreur-formulaire)$/.test(envoi)) NAV.envois.push(envoi);
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        res.end('{"ok":true}');
        return;
      }
      if (p === '/api/public-availability') { NAV.envois.push('heures'); res.writeHead(200, { 'Content-Type': MIME['.json'] }); res.end('{"ok":true,"slots":[]}'); return; }
      const fichier = path.join(ROOT, decodeURIComponent(p));
      if (fichier.startsWith(ROOT) && fs.existsSync(fichier) && fs.statSync(fichier).isFile()) {
        const ext = path.extname(fichier).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(ext === '.js' || ext === '.css' ? fichierServi(path.relative(ROOT, fichier).split(path.sep).join('/')) : fs.readFileSync(fichier));
        return;
      }
      res.writeHead(404); res.end('');
    } catch (error) {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error && error.message || error).slice(0, 200));
    }
  });
  return new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(PORT, '127.0.0.1', () => resolve(srv)); });
}

// Pose avant tout script de la page : chaque cadre et chaque masque Pinlane ajoutes, meme retires ensuite.
const OBSERVATEUR = () => {
  window.__montages = [];
  new MutationObserver((liste) => {
    for (const m of liste) {
      for (const n of m.addedNodes) {
        if (n.nodeName === 'IFRAME' || (n.nodeName === 'STYLE' && n.getAttribute && n.getAttribute('data-pinlane'))) window.__montages.push(n.nodeName);
      }
    }
  }).observe(document, { childList: true, subtree: true });
};
async function etatDuSite(page) {
  return page.evaluate(() => {
    const ancien = document.querySelector('#gform_wrapper_4');
    const style = ancien ? getComputedStyle(ancien) : null;
    return { cadre: Boolean(document.querySelector('iframe')), ancienVisible: Boolean(ancien) && style.display !== 'none' && ancien.offsetParent !== null, montages: (window.__montages || []).slice() };
  });
}
async function attendre(page, cond, ms) {
  const fin = Date.now() + ms;
  let e = await etatDuSite(page);
  while (!cond(e) && Date.now() < fin) { await page.waitForTimeout(250); e = await etatDuSite(page); }
  return e;
}
function preparer(coupe, etat) {
  poserCentres({ libramontCoupe: coupe });
  NAV.handlers = monter(NAV.mutations);
  NAV.etat = etat;
  NAV.envois = [];
  NAV.pages = [];
}
async function surLeSite(page, { coupe, etat, attendreMs, geste = null }) {
  preparer(coupe, etat);
  await page.goto(BASE_URL + '/site?v=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (geste) await geste(page);
  await page.waitForTimeout(attendreMs);
  return { ...(await etatDuSite(page)), envois: NAV.envois.slice(), pages: NAV.pages.slice() };
}
async function adresseDirecte(page) {
  await page.goto(BASE_URL + '/fungalaxy/libramont?v=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const bloc = document.querySelector('.fg-coupe');
    const visibles = [...document.body.children].filter((el) => el !== bloc && el.tagName !== 'SCRIPT' && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none');
    return {
      coupe: document.body.classList.contains('is-coupe'),
      phrase: bloc ? bloc.textContent.trim() : '',
      blocVisible: Boolean(bloc) && bloc.getClientRects().length > 0,
      autresVisibles: visibles.map((el) => el.tagName + (el.id ? '#' + el.id : '')).slice(0, 5),
      formulaire: Boolean(document.querySelector('#dayBtn')) && document.querySelector('#dayBtn').getClientRects().length > 0,
    };
  });
}
const TOUS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'];
async function proprietesNavigateur(nav, mutations = [], scenarios = TOUS) {
  const r = {};
  NAV.mutations = mutations;
  const page = await nav.newPage();
  await page.addInitScript(OBSERVATEUR);
  try {
    if (scenarios.includes('F1')) {
      preparer(true, 'actif');
      await page.goto(BASE_URL + '/site?v=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      const e = await attendre(page, (x) => x.montages.includes('IFRAME') && !x.cadre && x.ancienVisible, 12000);
      r.F1 = { ...e, envois: NAV.envois.slice() };
    }
    if (scenarios.includes('F2')) {
      preparer(true, 'actif');
      r.F2 = { ...(await adresseDirecte(page)), envois: NAV.envois.slice() };
    }
    if (scenarios.includes('F3')) {
      const site = await surLeSite(page, { coupe: false, etat: 'actif', attendreMs: 2500 });
      r.F3 = { site, direct: await adresseDirecte(page) };
    }
    if (scenarios.includes('F4')) r.F4 = await surLeSite(page, { coupe: true, etat: 'coupe', attendreMs: 2500 });
    if (scenarios.includes('F5')) r.F5 = await surLeSite(page, { coupe: true, etat: 'panne', attendreMs: 2500 });
    if (scenarios.includes('F6')) r.F6 = await surLeSite(page, { coupe: false, etat: 'lent', attendreMs: 7000 });
    if (scenarios.includes('F7')) {
      r.F7 = await surLeSite(page, { coupe: false, etat: 'actif-lent', attendreMs: 2600, geste: async (pg) => { await pg.waitForTimeout(250); await pg.focus('#gform_wrapper_4 input'); } });
    }
  } finally {
    await page.close();
  }
  return r;
}
// Rien du tout : aucun cadre ni masque ajoute a aucun moment, l ancien formulaire a l ecran, le formulaire Pinlane jamais
// charge, aucun envoi.
const rien = (x) => Boolean(x) && x.montages.length === 0 && !x.cadre && x.ancienVisible && x.pages.length === 0 && x.envois.length === 0;
function jugerNavigateur(r) {
  ok(r.F1.montages.includes('IFRAME') && !r.F1.cadre && r.F1.ancienVisible && r.F1.envois.length === 0, '[F1] coupe mais « en ligne » encore en cache : le cadre lit la coupure et se retire, le site rend son ancien formulaire, rien ne part', JSON.stringify(r.F1));
  ok(r.F2.coupe && r.F2.blocVisible && /ne se prennent pas ici/.test(r.F2.phrase) && r.F2.autresVisibles.length === 0 && r.F2.envois.length === 0, '[F2] a l adresse directe, rien ne se montre que la phrase, et rien ne part', JSON.stringify(r.F2));
  ok(r.F3.site.cadre && !r.F3.site.ancienVisible && r.F3.direct.formulaire && !r.F3.direct.coupe, '[F3] temoin : en ligne, le cadre se monte et le formulaire se montre', JSON.stringify(r.F3));
  ok(rien(r.F4), '[F4] coupe : rien n est monte ni masque, a aucun moment, et le formulaire Pinlane n est meme pas charge', JSON.stringify(r.F4));
  ok(rien(r.F5), '[F5] lecture de l interrupteur en panne (le cas du 14/11) : l ancien formulaire reste seul', JSON.stringify(r.F5));
  ok(rien(r.F6), '[F6] pas de reponse en 3,5 s : rien ne se monte, meme quand « en ligne » arrive apres', JSON.stringify(r.F6));
  ok(rien(r.F7), '[F7] le visiteur a commence l ancien formulaire avant la reponse : il le garde', JSON.stringify(r.F7));
}

// --- [X] les contre-preuves -----------------------------------------------------------------------------------------
const CONTRE_PREUVES = [
  { nom: 'la porte commune ne lit plus la coupure', fichier: 'lib/demande-publique.js', de: '  const coupure = coupureEnLigne(requestedCenterId);\n', vers: "  const coupure = '';\n", rougit: (s) => s.reservation.statut === 422 && s.reservation.json && s.reservation.json.code === CODE && s.retenue.json && s.retenue.json.code === CODE },
  { nom: 'la demande sur mesure ne lit plus la coupure', fichier: 'api/public-booking-meta.js', de: '  const coupure = coupureEnLigne(centerId);\n  if (coupure) {\n    sendError(', vers: "  const coupure = '';\n  if (coupure) {\n    sendError(", rougit: (s) => s.surMesure.json && s.surMesure.json.code === CODE && s.ecritures.length === 0 && s.sortants.length === 0 },
  { nom: 'le catalogue ne dit plus la coupure', fichier: 'api/public-booking-meta.js', de: '    ...(coupure ? { coupure } : {}),\n', vers: '', rougit: (s) => Boolean(s.catalogueLibramont.json && s.catalogueLibramont.json.coupure), scenarios: ['F1', 'F2'], rougitNav: (n) => !n.F1.cadre && n.F1.ancienVisible && n.F2.coupe },
  { nom: 'le formulaire ne se retire plus', navigateur: true, fichier: 'assets/fungalaxy-booking.js', de: '        if (meta.coupure) { fermerPourCoupure(String(meta.coupure)); return; }\n', vers: '', scenarios: ['F2'], rougitNav: (n) => n.F2.coupe && n.F2.autresVisibles.length === 0 },
  { nom: 'embed.js n ecoute plus le cadre', navigateur: true, fichier: 'embed.js', de: "    if (data.type === 'pinlane:coupe') { rendreLAncienFormulaire(); return; }\n", vers: '', scenarios: ['F1'], rougitNav: (n) => !n.F1.cadre && n.F1.ancienVisible },
  { nom: 'embed.js monte le cadre avant la reponse', navigateur: true, fichier: 'embed.js', de: '  setTimeout(function () { decider(false); }, DELAI_INTERRUPTEUR_MS);\n', vers: '  monterPinlane();\n  setTimeout(function () { decider(false); }, DELAI_INTERRUPTEUR_MS);\n', scenarios: ['F4'], rougitNav: (n) => rien(n.F4) },
  { nom: 'une panne de lecture monte quand meme le cadre', navigateur: true, fichier: 'embed.js', de: '      .then(function (etat) { decider(Boolean(etat) && etat.ok !== false && etat.actif !== false); })\n', vers: '      .then(function (etat) { decider(!etat || (etat.ok !== false && etat.actif !== false)); })\n', scenarios: ['F5'], rougitNav: (n) => rien(n.F5) },
  { nom: 'l attente n est plus bornee', navigateur: true, fichier: 'embed.js', de: '  setTimeout(function () { decider(false); }, DELAI_INTERRUPTEUR_MS);\n', vers: '', scenarios: ['F6'], rougitNav: (n) => rien(n.F6) },
  { nom: 'le visiteur perd l ancien formulaire commence', navigateur: true, fichier: 'embed.js', de: '    if (enLigne && !ancienCommence) monterPinlane();\n', vers: '    if (enLigne) monterPinlane();\n', scenarios: ['F7'], rougitNav: (n) => rien(n.F7) },
];

async function main() {
  console.log('\n[S] LE SERVEUR');
  const serveurReel = await proprietesServeur();
  juger(serveurReel);

  console.log('\n[F] LE NAVIGATEUR');
  const { chromium } = require('playwright-core');
  const srv = await serveur();
  const nav = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    jugerNavigateur(await proprietesNavigateur(nav));

    console.log('\n[X] LES CONTRE-PREUVES');
    for (const cp of CONTRE_PREUVES) {
      // Une ancre absente rendrait la contre-preuve vide (le fichier casse, et « rougit » pour une autre raison).
      const source = fs.readFileSync(path.join(ROOT, cp.fichier), 'utf8').split('\r\n').join('\n');
      if (!ok(source.split(cp.de).length === 2, `[X] l ancre de « ${cp.nom} » existe une fois dans ${cp.fichier}`)) continue;
      const mutations = [{ ...cp, navigateur: false }].filter((x) => x.fichier.startsWith('lib/') || x.fichier.startsWith('api/'));
      const mutationsNav = cp.fichier.startsWith('lib/') || cp.fichier.startsWith('api/') ? mutations : [{ ...cp, navigateur: true }];
      let tient = false;
      try {
        if (cp.rougit) tient = cp.rougit(await proprietesServeur(mutations));
        if (cp.rougitNav) tient = (cp.rougit ? tient : true) && cp.rougitNav(await proprietesNavigateur(nav, mutationsNav, cp.scenarios || TOUS));
      } catch (error) {
        tient = false;
      }
      ok(tient === false, `[X] ${cp.nom} : rougit`);
    }
  } finally {
    await nav.close();
    srv.close();
    purger();
  }
  console.log(`\ncoupure-en-ligne-check: ${echecs ? `${echecs} FAIL` : 'ALL OK'} (${passes})`);
  process.exit(echecs ? 1 : 0);
}
main().catch((error) => { console.error('ERREUR', error && (error.stack || error)); process.exit(1); });

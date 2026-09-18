// `/reserver` SANS CENTRE NE SERT PLUS LE LOCATAIRE D A COTE.
//
// Movsar : « le app.pinlane.be/reserver ça doit etre le formulaire basique de
// pinlane sans rapport avec fungalaxy tu vois sque je veux dire ».
//
// MESURE SUR LA PRODUCTION AVANT CORRECTIF (2026-09-18) : `/reserver` sans
// centre servait EXACTEMENT le tunnel de Fun Galaxy Libramont. Meme titre
// (« Fun Galaxy Libramont · Réservation »), meme logo, meme telephone
// (0491/30.16.67), meme adresse mail (libramont@fungalaxy.be), meme catalogue.
// Et ce n etait pas le repli du serveur qui decidait : la PAGE envoyait
// elle-meme `centerId=libramont`.
//
// CE QUE CE GATE TIENT :
//   [1] `/reserver` sans centre demande le centre de DEMONSTRATION, et rien
//       de Fun Galaxy n apparait a l ecran ;
//   [2] `/reserver/libramont` est INCHANGE : le locataire garde sa page ;
//   [3] `?center=<slug>` garde la main, c est le contrat d embed.js ;
//   [4] la demonstration ne ment pas : aucun telephone ni adresse postale
//       inventes, et l adresse mail affichee est celle du produit ;
//   [5] contre-epreuve : remettre l ancien repli fait revenir Fun Galaxy sur
//       `/reserver`, donc ce gate rougirait.
//
// LA BASE EST NEUTRALISEE AVANT que l API ne soit chargee : ce gate prouve le
// socle FICHIER, celui qui repond aussi quand la base est muette, et il ne
// touche jamais la production.
//
// Lancement : node scripts/reserver-sans-centre-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'assets/app-main.js');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const PORT = Number(process.env.PINLANE_DEMO_PORT || 4271);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// LE CROCHET AVANT LE REQUIRE APPLICATIF. `api/public-booking-meta.js`
// destructure `getPool` a son chargement : le poser apres ne mordrait pas.
let appelsBase = 0;
const database = require(path.join(ROOT, 'lib/database'));
database.getPool = () => { appelsBase += 1; throw new Error('base neutralisee par le gate'); };
const metaApi = require(path.join(ROOT, 'api/public-booking-meta.js'));
const reservationsApi = require(path.join(ROOT, 'api/public-reservations.js'));

// Demain, pour que la soumission ne soit pas refusee sur la date avant
// d atteindre la garde qu on veut juger.
const DATE_DEMAIN = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

let failures = 0;
function record(label, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!cond) failures += 1;
}
function section(titre) { console.log(`\n--- ${titre}`); }

function serveStatic() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/api/public-booking-meta') {
      // LA VRAIE API : c est elle qui doit resoudre le centre de
      // demonstration. Prouver la configuration sans prouver l endpoint
      // laisserait le chargeur hors du jugement.
      try { await metaApi(req, res); } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(error && error.message) }));
      }
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, slots: [] }));
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/reserver' || p.startsWith('/reserver/')) p = '/index.html';
    const filePath = path.resolve(path.join(ROOT, p));
    if (!filePath.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// CE QUE LE VISITEUR VOIT, ET CE QUE LA PAGE A DEMANDE.
async function ouvrir(browser, chemin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage();
  const appels = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/public-booking-meta')) appels.push(u.replace(BASE_URL, ''));
  });
  await page.goto(BASE_URL + chemin, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500);
  const vu = await page.evaluate(() => {
    const corps = document.body ? (document.body.innerText || '') : '';
    const logo = document.querySelector('.client-header img, header img, .brand img');
    return {
      titre: document.title || '',
      sousTitre: ((document.getElementById('heroSubtitle') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      logo: logo ? String(logo.getAttribute('src') || '') : '',
      fungalaxy: (corps.match(/fun ?galaxy/gi) || []).length,
      libramont: (corps.match(/libramont/gi) || []).length,
      mails: [...new Set(corps.match(/[\w.+-]+@[\w.-]+\.\w+/g) || [])],
      telephones: [...new Set(corps.match(/0\d{3}[/. ]?\d{2}[. ]?\d{2}[. ]?\d{2}/g) || [])],
    };
  });
  await context.close();
  return { vu, appels, centreDemande: (appels[0] || '').match(/centerId=([a-z0-9-]+)/i)?.[1] || '' };
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const original = fs.readFileSync(APP_JS, 'utf8');
  try {
    // ================================================================== [0]
    section('[0] Montage : la base est bien hors jeu, le socle fichier repond');
    const direct = await new Promise((resolve) => {
      const req = { url: '/api/public-booking-meta?centerId=demo', method: 'GET', headers: { host: '127.0.0.1' } };
      let corps = '';
      const res = {
        statusCode: 0, headers: {},
        writeHead(code) { this.statusCode = code; return this; },
        setHeader() { return this; },
        end(c) { corps = String(c || ''); resolve({ statusCode: this.statusCode, corps }); },
      };
      metaApi(req, res);
    });
    record('la base a bien ete sollicitee ET refusee (le crochet mord)', appelsBase > 0, `${appelsBase} appel(s)`);
    const jsonDemo = (() => { try { return JSON.parse(direct.corps); } catch (e) { return null; } })();
    record('l API resout le centre de demonstration sans base',
      Boolean(jsonDemo && jsonDemo.ok && jsonDemo.center && jsonDemo.center.id === 'demo'),
      JSON.stringify({ statut: direct.statusCode, id: jsonDemo && jsonDemo.center && jsonDemo.center.id, nom: jsonDemo && jsonDemo.center && jsonDemo.center.name }));

    // ================================================================== [1]
    section('[1] `/reserver` sans centre sert la DEMONSTRATION');
    const sansCentre = await ouvrir(browser, '/reserver');
    record('montage : la page a bien demande un catalogue',
      sansCentre.appels.length > 0, JSON.stringify(sansCentre.appels.slice(0, 2)));
    record('le centre demande est « demo », plus « libramont »',
      sansCentre.centreDemande === 'demo', JSON.stringify({ demande: sansCentre.centreDemande }));
    // LA REGLE EST CE QUE LE VISITEUR VOIT, pas le parametre : un centre
    // correct avec la marque d un autre resterait un mensonge a l ecran.
    record('aucune mention de Fun Galaxy a l ecran',
      sansCentre.vu.fungalaxy === 0 && sansCentre.vu.libramont === 0,
      JSON.stringify({ fungalaxy: sansCentre.vu.fungalaxy, libramont: sansCentre.vu.libramont, titre: sansCentre.vu.titre }));
    record('ni son logo', !/fun-galaxy/i.test(sansCentre.vu.logo), JSON.stringify({ logo: sansCentre.vu.logo }));
    record('ni son telephone, ni son adresse mail',
      !sansCentre.vu.telephones.length && !sansCentre.vu.mails.some((m) => /fungalaxy/i.test(m)),
      JSON.stringify({ telephones: sansCentre.vu.telephones, mails: sansCentre.vu.mails }));

    // ================================================================== [4]
    section('[4] La demonstration ne raconte rien de faux');
    record('aucun numero de telephone invente',
      sansCentre.vu.telephones.length === 0, JSON.stringify(sansCentre.vu.telephones));
    record('et la seule adresse mail affichee est celle du produit',
      sansCentre.vu.mails.length === 0 || sansCentre.vu.mails.every((m) => /@pinlane\./i.test(m)),
      JSON.stringify(sansCentre.vu.mails));

    // ================================================================== [2]
    section('[2] Le locataire garde sa page, inchangee');
    const libramont = await ouvrir(browser, '/reserver/libramont');
    record('`/reserver/libramont` demande toujours libramont',
      libramont.centreDemande === 'libramont', JSON.stringify({ demande: libramont.centreDemande }));
    record('et il y est chez lui (marque, contact)',
      libramont.vu.fungalaxy > 0 || /fun-galaxy/i.test(libramont.vu.logo),
      JSON.stringify({ fungalaxy: libramont.vu.fungalaxy, logo: libramont.vu.logo, titre: libramont.vu.titre }));

    // ================================================================== [3]
    section('[3] `?center=` garde la main : le contrat d embed.js');
    const parQuery = await ouvrir(browser, '/reserver?center=gembloux');
    record('`?center=gembloux` demande gembloux, pas la demonstration',
      parQuery.centreDemande === 'gembloux', JSON.stringify({ demande: parQuery.centreDemande }));

    // ================================================================== [6]
    section('[6] La demonstration se NOMME, avant le formulaire');
    record('le sous-titre annonce une demonstration et dit que rien n est enregistre',
      /d[eé]monstration/i.test(sansCentre.vu.sousTitre) && /enregistr/i.test(sansCentre.vu.sousTitre),
      JSON.stringify({ sousTitre: sansCentre.vu.sousTitre }));
    record('et un vrai centre ne porte PAS cette annonce',
      !/d[eé]monstration/i.test(libramont.vu.sousTitre),
      JSON.stringify({ sousTitre: libramont.vu.sousTitre }));

    // ================================================================== [7]
    section('[7] La porte d ecriture refuse la demonstration, et elle seule');
    // MEME PORTE, DEUX CENTRES. Une garde qui refuserait tout le monde serait
    // verte ici sans rien prouver : on exige que le VRAI centre passe cette
    // ligne-la, quitte a echouer plus loin pour une autre raison.
    const poster = (centerId) => new Promise((resolve) => {
      const corpsEnvoye = JSON.stringify({ centerId, date: DATE_DEMAIN, pax: 4, name: 'Gate', email: 'qa@pinlane.test', phone: '0000' });
      const req = new (require('stream').Readable)({ read() { this.push(corpsEnvoye); this.push(null); } });
      req.url = '/api/public-reservations';
      req.method = 'POST';
      req.headers = { host: '127.0.0.1', 'content-type': 'application/json' };
      let sortie = '';
      const res = {
        statusCode: 0,
        writeHead(code) { this.statusCode = code; return this; },
        setHeader() { return this; },
        end(c) { sortie = String(c || ''); resolve({ statut: this.statusCode, corps: sortie }); },
      };
      reservationsApi(req, res).catch(() => resolve({ statut: 0, corps: '' }));
    });
    const refusDemo = await poster('demo');
    const motifDemo = /d[eé]monstration/i.test(refusDemo.corps);
    record('une soumission sur la demonstration est refusee, et elle dit pourquoi',
      refusDemo.statut === 422 && motifDemo,
      JSON.stringify({ statut: refusDemo.statut, corps: refusDemo.corps.slice(0, 120) }));
    const vraiCentre = await poster('libramont');
    record('un VRAI centre ne tombe pas sur cette garde',
      !/d[eé]monstration/i.test(vraiCentre.corps),
      JSON.stringify({ statut: vraiCentre.statut, corps: vraiCentre.corps.slice(0, 120) }));

    // ================================================================== [5]
    section('[5] Contre-epreuve par mutation : ce gate sait-il rougir ?');
    const ancre = `  const connecte = typeof hasSavedAuth === 'function' && hasSavedAuth();
  if (!connecte && ouvertSurLeTunnelSansCentre()) return PUBLIC_DEMO_CENTER_ID;
  return getCurrentStaffCenterId();`;
    const fdl = original.includes('\r\n') ? '\r\n' : '\n';
    const ancreFdl = ancre.split('\n').join(fdl);
    if (original.split(ancreFdl).length - 1 !== 1) throw new Error('ancre du repli introuvable');
    const retour = '  return getCurrentStaffCenterId();'.split('\n').join(fdl);
    fs.writeFileSync(APP_JS, original.split(ancreFdl).join(retour));
    const mute = await ouvrir(browser, '/reserver');
    record('avec l ancien repli, `/reserver` redemande libramont : ce gate ROUGIRAIT',
      mute.centreDemande === 'libramont', JSON.stringify({ demande: mute.centreDemande }));
    record('et Fun Galaxy revient a l ecran : ce gate ROUGIRAIT',
      mute.vu.fungalaxy > 0 || /fun-galaxy/i.test(mute.vu.logo),
      JSON.stringify({ fungalaxy: mute.vu.fungalaxy, logo: mute.vu.logo }));
  } catch (error) {
    record('gate montable', false, error && error.message);
  } finally {
    fs.writeFileSync(APP_JS, original);
    record('app-main.js restaure a l identique', fs.readFileSync(APP_JS, 'utf8') === original);
    await browser.close();
    server.close();
  }

  console.log(failures ? `\nRESERVER SANS CENTRE : ${failures} echec(s)` : '\nRESERVER SANS CENTRE OK');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });

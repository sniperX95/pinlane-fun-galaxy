// RENDRE AU CLIENT SON ANCIEN FORMULAIRE, EN UN CLIC.
//
// Pourquoi ce gate existe. Le parcours Pinlane s installe sur le site du centre
// A LA PLACE de leur formulaire. Le jour ou quelque chose cloche un dimanche a
// 15 h, personne ne veut chercher les identifiants WordPress de l agence, ni
// attendre qu elle reponde. Il faut un interrupteur, et il faut qu il soit sur.
//
// La regle qui rend tout ca possible tient en une phrase : L ANCIEN FORMULAIRE
// N EST JAMAIS SUPPRIME DU SITE, il est seulement MASQUE par notre script. Ce
// qu on peut cacher, on peut le remontrer ; ce qu on a supprime, il faut le
// reconstruire.
//
// Ce gate monte une fausse page de client (leur formulaire + notre script) et
// verifie les deux etats et leurs bords.
//
// LES PROPRIETES :
//
//   [A] EN MARCHE : le parcours Pinlane s affiche, l ancien formulaire est
//       masque. C est l etat normal.
//
//   [B] COUPE : l ancien formulaire revient, le cadre Pinlane disparait. C est
//       la sortie de secours, et elle doit marcher sans toucher au site.
//
//   [C] UNE PANNE NE REND PAS L ANCIEN FORMULAIRE. Revenir en arriere est une
//       DECISION. Si une coupure reseau suffisait a basculer, le site du client
//       changerait de formulaire au gre du reseau, sans que personne ne l ait
//       voulu ni ne le comprenne.
//
//   [D] L ANCIEN FORMULAIRE EST MASQUE, JAMAIS RETIRE. S il quittait le DOM, le
//       retour en arriere deviendrait une intervention dans WordPress, c est a
//       dire exactement ce qu on cherche a eviter.
//
//   [E] SANS ANCIEN FORMULAIRE DECLARE, COUPER RETIRE QUAND MEME LE CADRE. Un
//       centre qui n a rien a quoi revenir doit pouvoir eteindre le parcours.
//
//   [F] LE CENTRE SUIT LA SELECTION DEJA FAITE PAR LE VISITEUR. Un site
//       multi-centres demande une fois ou l on va et retient la reponse. Un
//       centre FIXE dans la page enverrait un visiteur de Gembloux sur le
//       planning de Libramont : mauvais horaires, mauvais tarifs, et personne
//       ne s en apercevrait avant une reservation impossible a honorer.
//
//   [G] ET IL RETOMBE SUR LE DEFAUT QUAND RIEN N A ETE CHOISI. Une selection
//       absente ou illisible ne doit pas priver le visiteur du formulaire.
//
//   [H] LE CADRE SE MONTE OU ON LUI DIT, PAS OU LE SCRIPT EST COLLE. Sur un
//       site verrouille, l endroit ou l on PEUT coller un script n est pas
//       l endroit ou le formulaire DOIT apparaitre : le theme de Fun Galaxy
//       construit lui-meme la section de reservation, aucun champ libre n y
//       existe, et notre compte n a pas le droit d y installer quoi que ce
//       soit. Sans data-target, le parcours s afficherait la ou on a pu coller
//       le script. Le defaut, lui, ne bouge pas : sans data-target, le cadre
//       reste a l endroit du script.
//
//   [I] LE SITE NE PEUT PAS REMONTRER SON FORMULAIRE PAR ACCIDENT. Mesure sur
//       le site du client : Gravity Forms appelle jQuery(...).show() a
//       l initialisation de sa logique conditionnelle, donc APRES notre
//       passage. Un style en ligne pose par nous se ferait ecraser et le
//       visiteur verrait DEUX formulaires. La regle !important tient, et
//       l interrupteur la retire quand on coupe.
//
//   [J] LA COUPURE ENREGISTREE PAR LA CONSOLE SE LIT VRAIMENT. Le faux serveur
//       des proprietes precedentes repond l etat qu on lui dit : il ne prouve
//       rien de la lecture. Ici le VRAI gestionnaire lit la VRAIE fusion des
//       centres (lib/ops-knowledge) sur la ligne que la console ecrit
//       (centers.settings.config.embed). Le 13/11 a 5 h 40, Ansar coupe, la
//       console dit « coupé », et le site garde le formulaire Pinlane : la
//       lecture cherchait centre.config.embed, qui n existe pas.
//
// Usage : node scripts/embed-killswitch-check.js [--contre-preuves]
//   --contre-preuves : rejoue [J] avec l ancienne lecture, qui doit rougir.
'use strict';
// [J] charge le vrai gestionnaire : aucune cle ne doit lui permettre de toucher la base ou d envoyer quoi que ce soit.
['DATABASE_URL', 'POSTGRES_URL', 'RESEND_API_KEY', 'TELEGRAM_JETON', 'TELEGRAM_CHAT', 'TELEGRAM_GROUPE'].forEach((cle) => { delete process.env[cle]; });
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_SWITCH_PORT || 4237);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// L etat que le faux serveur renvoie : 'actif', 'coupe', ou 'panne'.
let etatServeur = 'actif';

// La page du CLIENT : son formulaire d origine, puis notre script. C est
// exactement ce qu on lui demande de coller, pas une reconstitution.
function pageClient(avecRepli) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fun Galaxy</title></head><body>
    <h1>Reserver</h1>
    <div id="gform_wrapper_1"><form><label>Ancien formulaire du site</label><input name="nom"></form></div>
    <script src="${BASE_URL}/embed.js" data-center="libramont" data-center-key="guest_selection"${avecRepli ? ' data-fallback="#gform_wrapper_1"' : ''}></script>
  </body></html>`;
}

// LA PAGE D UN SITE VERROUILLE. Trois differences avec la precedente, et les
// trois viennent du site reel :
//   - le formulaire d origine est enterre dans la structure du theme ;
//   - le script Pinlane est colle AILLEURS (pied de page), parce que c est le
//     seul endroit ou l on peut ecrire ;
//   - le site remontre son propre formulaire APRES nous, comme Gravity Forms le
//     fait avec sa logique conditionnelle.
function pageVerrouillee() {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fun Galaxy</title></head><body>
    <h1>Reserver</h1>
    <div class="booking__container">
      <div class="booking__content">Reservez en moins d une minute</div>
      <div class="booking__form">
        <div id="gform_wrapper_1" style="display:none"><form><label>Ancien formulaire du site</label><input name="nom"></form></div>
      </div>
    </div>
    <footer id="pied">
      <script src="${BASE_URL}/embed.js" data-center="libramont" data-target=".booking__form" data-fallback="#gform_wrapper_1"></script>
    </footer>
    <script>
      setTimeout(function () {
        var w = document.getElementById('gform_wrapper_1');
        if (w) w.style.display = 'block';
      }, 150);
    </script>
  </body></html>`;
}

function serveur() {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/embed.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(path.join(ROOT, 'embed.js')));
      return;
    }
    if (url.pathname === '/api/public-booking-meta') {
      if (etatServeur === 'panne') { res.writeHead(503); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, center: url.searchParams.get('center'), actif: etatServeur === 'actif' }));
      return;
    }
    if (url.pathname === '/reserver') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><title>Parcours</title><p>Parcours Pinlane</p>');
      return;
    }
    if (url.pathname === '/site-verrouille') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(pageVerrouillee());
      return;
    }
    if (url.pathname === '/site' || url.pathname === '/site-sans-repli') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(pageClient(url.pathname === '/site'));
      return;
    }
    res.writeHead(404); res.end('Not found');
  });
  return new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(PORT, '127.0.0.1', () => resolve(srv)); });
}

async function etatPage(page) {
  return page.evaluate(() => {
    const ancien = document.querySelector('#gform_wrapper_1');
    const cadre = document.querySelector('iframe');
    const style = ancien ? window.getComputedStyle(ancien) : null;
    return {
      ancienDansLePage: Boolean(ancien),
      ancienVisible: Boolean(ancien) && style.display !== 'none' && ancien.offsetParent !== null,
      cadre: Boolean(cadre),
      cadreSrc: cadre ? cadre.getAttribute('src') : '',
      // Le style EN LIGNE de l ancien formulaire : la trace de ce que le SITE a
      // fait, distincte de l affichage finalement calcule.
      ancienStyleEnLigne: ancien ? (ancien.style.display || '') : '',
      ancienAffichageCalcule: style ? style.display : '',
      parentDuCadre: cadre && cadre.parentNode ? (cadre.parentNode.className || cadre.parentNode.tagName || '') : '',
    };
  });
}

async function charger(page, chemin) {
  await page.goto(`${BASE_URL}${chemin}?v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(600);
  return etatPage(page);
}

// [J] Le vrai gestionnaire de api/public-booking-meta.js, compile depuis sa source (une contre-preuve la change en
// memoire), sur une base simulee qui rend la ligne que la console ecrit.
const LECTURE = 'const reglage = centre && centre.embed;';
async function lectureServeur({ contrePreuve = false } = {}) {
  const database = require(path.join(ROOT, 'lib/database'));
  const rateLimit = require(path.join(ROOT, 'lib/rate-limit'));
  const { SQL_EMPREINTES } = require(path.join(ROOT, 'lib/cache-empreintes'));
  let lignes = [];
  let version = 0;
  // Une base neuve a chaque appel : l empreinte des centres change quand la ligne change, comme en vrai.
  database.getPool = () => ({ query: async (sql) => {
    if (sql === SQL_EMPREINTES) return { rows: [{ centres: `v${version}` }], rowCount: 1 };
    if (/from centers/.test(String(sql))) return { rows: lignes, rowCount: lignes.length };
    return { rows: [], rowCount: 0 };
  } });
  rateLimit.enforceRateLimit = () => false;
  const fichier = path.join(ROOT, 'api/public-booking-meta.js');
  let source = fs.readFileSync(fichier, 'utf8');
  if (source.split(LECTURE).length !== 2) throw new Error('[J] lecture de l interrupteur introuvable dans api/public-booking-meta.js');
  if (contrePreuve) source = source.split(LECTURE).join('const reglage = centre && centre.config && centre.config.embed;');
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  m._compile(source, fichier);
  const handler = m.exports;
  const lire = async (centre) => {
    const req = Readable.from([]);
    Object.assign(req, { method: 'GET', url: `/api/public-booking-meta?embedState=1&center=${centre}`, headers: { host: 'app.pinlane.test' }, socket: { remoteAddress: '203.0.113.7' }, connection: { remoteAddress: '203.0.113.7' } });
    const res = { statusCode: 200, headers: {}, headersSent: false, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, getHeader(k) { return this.headers[String(k).toLowerCase()]; }, writeHead(s) { this.statusCode = s; return this; }, end(b) { this.corps = String(b || ''); this.headersSent = true; } };
    await handler(req, res);
    try { return JSON.parse(res.corps); } catch (error) { return { brut: res.corps }; }
  };
  const ligne = (id, embed) => ({ id, name: id, status: 'active', timezone: 'Europe/Brussels', settings: { config: embed ? { embed } : {} } });
  lignes = [ligne('libramont', { actif: false, bascule: new Date().toISOString(), basculePar: 'Ansar' }), ligne('gembloux', null)];
  version += 1;
  const coupe = await lire('libramont');
  const autre = await lire('gembloux');
  lignes = [ligne('libramont', { actif: true, bascule: new Date().toISOString(), basculePar: 'Ansar' }), ligne('gembloux', null)];
  version += 1;
  const remis = await lire('libramont');
  return { coupe, autre, remis };
}

async function main() {
  if (process.argv.includes('--contre-preuves')) {
    const r = await lectureServeur({ contrePreuve: true });
    const mord = r.coupe.actif !== false;
    console.log(`${mord ? 'mord' : 'NE MORD PAS'}  [J] l ancienne lecture (centre.config.embed) ne voit pas la coupure  ${JSON.stringify(r.coupe)}`);
    process.exit(mord ? 0 : 1);
  }
  const lecture = await lectureServeur();
  ok(lecture.coupe.ok === true && lecture.coupe.actif === false, '[J] une coupure enregistree par la console se lit : le site rend son ancien formulaire', JSON.stringify(lecture.coupe));
  ok(lecture.autre.actif === true, '[J] l autre centre, non coupe, garde le formulaire Pinlane', JSON.stringify(lecture.autre));
  ok(lecture.remis.actif === true, '[J] remis en ligne depuis la console, il se relit en ligne', JSON.stringify(lecture.remis));
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    // =====================================================================
    console.log('[A] en marche : le parcours Pinlane remplace le formulaire');
    // =====================================================================
    etatServeur = 'actif';
    const marche = await charger(page, '/site');
    ok(marche.cadre && /\/reserver\?embed=1/.test(marche.cadreSrc),
      '[A] le parcours Pinlane est monte dans la page du client', marche.cadreSrc);
    ok(marche.ancienVisible === false,
      '[A] et l ancien formulaire est masque : le visiteur en voit UN seul');

    // =====================================================================
    console.log('\n[D] l ancien formulaire est masque, jamais retire');
    // =====================================================================
    ok(marche.ancienDansLePage === true,
      '[D] il est toujours dans la page : c est ce qui rend le retour possible sans toucher au site');

    // =====================================================================
    console.log('\n[B] coupe : l ancien formulaire revient');
    // =====================================================================
    etatServeur = 'coupe';
    const coupe = await charger(page, '/site');
    ok(coupe.ancienVisible === true,
      '[B] l ancien formulaire du client est de retour a l ecran');
    ok(coupe.cadre === false,
      '[B] et le cadre Pinlane a disparu : pas deux formulaires en meme temps');

    // =====================================================================
    console.log('\n[C] une panne ne rend PAS l ancien formulaire');
    // =====================================================================
    etatServeur = 'panne';
    const panne = await charger(page, '/site');
    ok(panne.cadre === true,
      '[C] lecture de l interrupteur en echec : le parcours reste en place');
    ok(panne.ancienVisible === false,
      '[C] et l ancien formulaire reste masque : basculer est une decision, pas un accident reseau');

    // =====================================================================
    console.log('\n[E] sans ancien formulaire declare, couper retire quand meme le cadre');
    // =====================================================================
    etatServeur = 'coupe';
    const sansRepli = await charger(page, '/site-sans-repli');
    ok(sansRepli.cadre === false,
      '[E] le cadre est retire meme quand rien n a ete declare comme repli');
    etatServeur = 'actif';
    const sansRepliActif = await charger(page, '/site-sans-repli');
    ok(sansRepliActif.cadre === true,
      '[E] et il revient des que l interrupteur est remis (le controle precedent mesure bien la coupure)');

    // =====================================================================
    console.log('\n[F] le centre suit la selection deja faite par le visiteur');
    // =====================================================================
    // On ecrit la selection AVEC LA CLE DU SITE, comme le site le ferait
    // lui-meme, puis on recharge : c est le seul moyen de prouver que les deux
    // lisent bien au meme endroit.
    etatServeur = 'actif';
    await page.evaluate(() => { try { localStorage.setItem('guest_selection', 'Gembloux'); } catch (e) {} });
    const gembloux = await charger(page, '/site');
    ok(/center=gembloux/.test(gembloux.cadreSrc),
      '[F] un visiteur qui a choisi Gembloux ouvre le parcours de Gembloux', gembloux.cadreSrc);
    await page.evaluate(() => { try { localStorage.setItem('guest_selection', 'Libramont'); } catch (e) {} });
    const libramont = await charger(page, '/site');
    ok(/center=libramont/.test(libramont.cadreSrc),
      '[F] et un visiteur qui a choisi Libramont, celui de Libramont', libramont.cadreSrc);

    // =====================================================================
    console.log('\n[G] et il retombe sur le defaut quand rien n a ete choisi');
    // =====================================================================
    await page.evaluate(() => { try { localStorage.removeItem('guest_selection'); } catch (e) {} });
    const sansChoix = await charger(page, '/site');
    ok(/center=libramont/.test(sansChoix.cadreSrc),
      '[G] aucune selection : le centre par defaut du bloc s applique', sansChoix.cadreSrc);
    await page.evaluate(() => { try { localStorage.setItem('guest_selection', '???'); } catch (e) {} });
    const illisible = await charger(page, '/site');
    ok(/center=libramont/.test(illisible.cadreSrc),
      '[G] une selection illisible ne prive personne de formulaire, elle est ignoree', illisible.cadreSrc);
    await page.evaluate(() => { try { localStorage.removeItem('guest_selection'); } catch (e) {} });

    // =====================================================================
    console.log('');
    console.log('[H] le cadre se monte ou on lui dit, pas ou le script est colle');
    // =====================================================================
    etatServeur = 'actif';
    const verrouille = await charger(page, '/site-verrouille');
    // MONTAGE : le script est bien colle AILLEURS que dans la section visee.
    // Sans ce controle, la propriete pourrait etre vraie par hasard.
    const positionDuScript = await page.evaluate(() => {
      const s = document.querySelector('script[data-target]');
      return s && s.parentNode ? (s.parentNode.id || s.parentNode.tagName) : '';
    });
    ok(positionDuScript === 'pied',
      '[H] montage : le script est colle dans le pied de page, loin de la section', positionDuScript);
    ok(verrouille.parentDuCadre === 'booking__form',
      '[H] et le cadre est monte dans la section de reservation quand meme', verrouille.parentDuCadre);
    ok(marche.parentDuCadre === 'BODY',
      '[H] sans data-target, le defaut ne bouge pas : le cadre reste a l endroit du script', marche.parentDuCadre);

    // =====================================================================
    console.log('');
    console.log('[I] le site ne peut pas remontrer son formulaire par accident');
    // =====================================================================
    // MONTAGE : le site a REELLEMENT tente de remontrer son formulaire. Sans
    // cette assertion, un vert ne prouverait que l absence de tentative.
    ok(verrouille.ancienStyleEnLigne === 'block',
      '[I] montage : le site a remis son formulaire en display:block apres nous', verrouille.ancienStyleEnLigne);
    ok(verrouille.ancienAffichageCalcule === 'none',
      '[I] et il reste invisible : la regle !important tient, le visiteur en voit UN seul');
    etatServeur = 'coupe';
    const verrouilleCoupe = await charger(page, '/site-verrouille');
    ok(verrouilleCoupe.cadre === false && verrouilleCoupe.ancienVisible === true,
      '[I] coupe : la regle est retiree, le formulaire du site revient a l ecran');
    etatServeur = 'actif';

    if (errs.length) console.log('\nErreurs console :\n' + errs.slice(0, 5).join('\n'));
    console.log(failures ? `\n${failures} controle(s) en echec.` : '\nembed-killswitch-check: ALL OK');
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

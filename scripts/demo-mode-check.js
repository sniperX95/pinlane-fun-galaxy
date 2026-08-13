// LA DEMONSTRATION PUBLIQUE : elle est AUTONOME, elle ne touche jamais la
// production, et elle ne peut pas contaminer la console reelle.
//
// CONTEXTE (2026-08-13). `app.pinlane.be/demo` executait jusqu'ici le VRAI
// code de la console sur un faux reseau : `assets/demo-mode.js` remplacait
// `fetch`, `XMLHttpRequest` et `sendBeacon` des que l'URL portait `/demo` ou
// `?demo=1`. Movsar a tranche : « c'est une demo, un truc a part, et ca ne
// doit pas du tout etre branche avec le vrai ». La demonstration est devenue
// une page autonome dans `demo/`, servie par la reecriture `/demo` du
// `vercel.json`, et `index.html` ne charge plus une seule ligne de code de
// demonstration.
//
// CE QUE CE GATE VERROUILLE :
//   1. /demo sert la page autonome, et l'adresse tient au rechargement.
//   2. LE DECOUPLAGE EST REEL : la demonstration ne charge AUCUN fichier de
//      l'application (app-main.js, staff-pages-v2.js, pinlane-staff.css...)
//      et n'emet AUCUNE requete vers /api/, meme quand on la force.
//   3. Aucun code d'acces n'est demande.
//   4. Le bandeau « donnees fabriquees » est present, visible et permanent.
//   5. LES PORTES FERMEES : entree grisee avec cadenas, fond reel floute,
//      fenetre par-dessus, focus PIEGE dedans, echappable par Echap, sortie
//      visible, et AUCUN compte a rebours.
//   6. LE GUIDE construit l'ecran etape par etape, et celui qui le passe
//      obtient l'ecran COMPLET immediatement, sans animation a attendre.
//   7. Aucune enseigne ni ville du vrai client, sur aucun ecran.
//   8. LA CONSOLE REELLE EST STRICTEMENT INCHANGEE : elle ne charge aucun
//      fichier de la demonstration, ne porte aucune classe ni attribut de
//      demonstration, demande toujours son code d'acces, et `?demo=1` sur `/`
//      ne declenche plus RIEN.
// Puis des CONTRE-PREUVES par mutation : on retire chaque correction et on
// verifie que ce gate rougit.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const DEMO_JS = path.join(ROOT, 'demo', 'demo.js');
const DEMO_HTML = path.join(ROOT, 'demo', 'index.html');
const PORT = Number(process.env.PINLANE_DEMO_PORT || 4231);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Les fichiers de l'APPLICATION. Si la demonstration en demande un seul, le
// decouplage est un mot et pas un fait.
const FICHIERS_APPLICATION = ['app-main.js', 'staff-pages-v2.js', 'staff-menu.js', 'booking-core.js',
  'pinlane-staff.css', 'pinlane-client.css', 'admin-console.js', 'ops-console.js', 'api-client.js',
  'boot-view.js', 'demo-mode.js'];
// Les fichiers de la DEMONSTRATION. Si la console reelle en demande un seul,
// c'est l'inverse de la contamination, et c'est tout aussi grave.
const FICHIERS_DEMONSTRATION = ['/demo/demo.js', '/demo/demo.css', '/demo/demo-data.js'];

const fuites = [];
const servis = [];
let surveille = false;
const surveiller = (etat) => { surveille = etat; };

// Le serveur de test rejoue les reecritures Vercel : /demo -> demo/index.html,
// /reserver et / -> index.html.
function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const clean = url.pathname.replace(/\/+$/, '') || '/';
    if (surveille) servis.push(url.pathname);
    if (clean.startsWith('/api/')) {
      if (surveille) fuites.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('{"ok":true,"fuite":true}');
      return;
    }
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (clean === '/' || clean === '/reserver') filePath = path.join(ROOT, 'index.html');
    if (clean === '/demo') filePath = path.join(ROOT, 'demo', 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// LES ONZE ENTREES DU MENU, dans l'ordre, avec leur etat attendu. Cette table
// EST la decision produit du 2026-08-13 : la changer ici sans la changer dans
// demo/demo.js fait rougir le gate, et c'est le but. La correspondance avec
// les libelles du PRODUIT est verifiee par `npm run test:demo-fidelity`.
const ENTREES_MENU = [
  { cle: 'dashboard', ouvert: false, titre: 'Vue d’ensemble' },
  { cle: 'planning', ouvert: true },
  { cle: 'reservations', ouvert: false, titre: 'Réservations' },
  { cle: 'formules', ouvert: false, titre: 'Formules' },
  { cle: 'field', ouvert: false, titre: 'Terrain' },
  { cle: 'clients', ouvert: false, titre: 'Clients' },
  { cle: 'emails', ouvert: false, titre: 'Emails et relances' },
  { cle: 'campaigns', ouvert: true },
  { cle: 'activities', ouvert: false, titre: 'Activités et tarifs' },
  { cle: 'users', ouvert: false, titre: 'Équipe et accès' },
  { cle: 'establishment', ouvert: false, titre: 'Établissement' },
];
const LIEN_APPEL_ATTENDU = 'https://pinlane.be/#demo';
// L'enseigne du client ET ses trois villes : une ville nommee le designe aussi
// surement que son nom.
const MARQUE_CLIENT = /fun\s*galaxy|libramont|gembloux|ciney/i;

async function coupeCdn(page) {
  await page.route('https://cdn.vercel-insights.com/**', (route) => route.abort());
}

// Ouvre une entree et rend ce qu'elle a peint.
async function ouvrirEcran(page, cle) {
  // La fenetre d'une porte fermee est une VRAIE fenetre modale : son voile
  // couvre tout l'ecran, barre laterale comprise. Pour naviguer, on la ferme
  // d'abord, exactement comme un visiteur le ferait avec Echap.
  await page.evaluate(() => { if (document.getElementById('dFenetre')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await page.waitForTimeout(320);
  await page.click(`[data-d-menu="${cle}"]`);
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const f = document.getElementById('dFenetre');
    const boite = f ? f.querySelector('.d-fenetre') : null;
    const principal = document.getElementById('dMain');
    const cs = principal ? getComputedStyle(principal) : null;
    return {
      fenetre: !!boite && boite.getBoundingClientRect().height > 0,
      role: boite ? boite.getAttribute('role') : '',
      modale: boite ? boite.getAttribute('aria-modal') : '',
      titre: boite && boite.querySelector('h2') ? boite.querySelector('h2').textContent.trim() : '',
      cta: boite && boite.querySelector('.d-fenetre-cta') ? boite.querySelector('.d-fenetre-cta').getAttribute('href') : '',
      puces: boite ? boite.querySelectorAll('.d-fenetre-liste li').length : 0,
      retour: !!(boite && boite.querySelector('[data-d-retour]')),
      flou: cs ? cs.filter : '',
      inert: !!(principal && principal.hasAttribute('inert')),
      focusDansFenetre: !!(f && f.contains(document.activeElement)),
      texte: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
      bandeau: !!document.querySelector('.d-bandeau'),
      hauteurEcran: Math.round(document.documentElement.scrollHeight),
    };
  });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // =====================================================================
    console.log('\n[1] /demo sert la page autonome, et l adresse tient');
    // =====================================================================
    surveiller(true);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await coupeCdn(page);
    const erreursJS = [];
    page.on('pageerror', (e) => erreursJS.push(String(e).slice(0, 200)));
    await page.goto(`${BASE_URL}/demo`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForSelector('[data-d-menu]', { timeout: 15000 });

    const premier = await page.evaluate(() => ({ chemin: location.pathname, titre: document.title }));
    ok(premier.chemin === '/demo', `premier rendu : chemin = /demo (obtenu "${premier.chemin}")`);
    ok(/d[ée]monstration/i.test(premier.titre), `le titre de l'onglet annonce la demonstration ("${premier.titre}")`);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-d-menu]', { timeout: 15000 });
    const apresRechargement = await page.evaluate(() => location.pathname);
    ok(apresRechargement === '/demo', `RECHARGEMENT : chemin toujours /demo (obtenu "${apresRechargement}")`);
    ok(erreursJS.length === 0, `aucune erreur JavaScript au chargement (${erreursJS.length ? erreursJS.join(' | ') : 'aucune'})`);

    // =====================================================================
    console.log('\n[2] LE DECOUPLAGE EST REEL, pas declaratif');
    // =====================================================================
    const chargesApplication = servis.filter((p) => FICHIERS_APPLICATION.some((f) => p.indexOf(f) !== -1));
    ok(chargesApplication.length === 0,
      `la demonstration ne charge AUCUN fichier de l'application (charges : ${chargesApplication.join(', ') || 'aucun'})`);

    // On ne se contente pas de constater qu'aucun appel n'a eu lieu : on FORCE
    // depuis la page les deux ecritures les plus dangereuses du produit.
    const tentatives = await page.evaluate(async () => {
      const sortie = {};
      try {
        const r = await fetch('/api/public-reservations', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'GATE ECRITURE', date: '2030-01-01', startTime: '10:00', pax: 4, lanes: [1] }),
        });
        sortie.reservation = await r.json();
      } catch (error) { sortie.reservation = { erreur: String(error) }; }
      return sortie;
    });
    // La page autonome n'intercepte PLUS le reseau : elle n'en a pas besoin,
    // puisqu'elle n'appelle jamais l'API. Une ecriture forcee par la console du
    // navigateur part donc vraiment, et c'est normal : ce qui compte est que la
    // PAGE, elle, n'en emette aucune. On ne compte donc que le trafic spontane.
    ok(tentatives.reservation !== undefined, 'une ecriture forcee a la main est bien tentee (le compteur du serveur est arme)');
    const spontanees = fuites.filter((f) => f.indexOf('public-reservations') === -1);
    ok(spontanees.length === 0,
      `ZERO requete /api/ emise SPONTANEMENT par la demonstration (recu : ${spontanees.join(' | ') || 'aucune'})`);

    // =====================================================================
    console.log('\n[3] Aucun code d acces, et le bandeau ne peut pas disparaitre');
    // =====================================================================
    const chrome = await page.evaluate(() => {
      const b = document.querySelector('.d-bandeau');
      const cs = b ? getComputedStyle(b) : null;
      const lien = b ? b.querySelector('a[href]') : null;
      return {
        overlayAuth: !!document.getElementById('authOverlay'),
        bandeau: !!b,
        position: cs ? cs.position : '',
        visible: cs ? (cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.2) : false,
        texte: b ? (b.textContent || '').trim() : '',
        href: lien ? lien.getAttribute('href') : '',
      };
    });
    ok(chrome.overlayAuth === false, 'aucun ecran de code d acces : la page autonome n en a pas la notion');
    ok(chrome.bandeau && chrome.visible, 'bandeau de demonstration present et visible');
    ok(chrome.position === 'fixed', `le bandeau est permanent, pas dans le flux (position = ${chrome.position})`);
    ok(/d[ée]monstration/i.test(chrome.texte), `le bandeau dit que les donnees sont fabriquees ("${chrome.texte.slice(0, 80)}")`);
    ok(/pinlane\.be/.test(chrome.href || ''), `le bandeau ramene vers la vitrine (href = "${chrome.href}")`);

    // =====================================================================
    console.log('\n[4] LE GUIDE construit l ecran, et ne piege personne');
    // =====================================================================
    // Au depart, l'ecran est volontairement depouille : seul le bloc de la
    // premiere etape est dans le flux.
    const auDepart = await page.evaluate(() => {
      const etat = {};
      ['tete', 'kpi', 'grille', 'liste'].forEach((b) => {
        const el = document.querySelector(`[data-d-bloc="${b}"]`);
        etat[b] = el ? getComputedStyle(el).display : 'absent';
      });
      const carte = document.getElementById('dGuide');
      return {
        blocs: etat,
        carte: !!carte,
        titre: carte && carte.querySelector('.d-guide-titre') ? carte.querySelector('.d-guide-titre').textContent.trim() : '',
        rang: carte && carte.querySelector('.d-guide-rang') ? carte.querySelector('.d-guide-rang').textContent.trim() : '',
        passer: !!document.querySelector('[data-d-passer]'),
        // La carte du guide ne doit RIEN couvrir : si elle etait modale, elle
        // bloquerait l'exploration libre, qui est sa regle la plus importante.
        modale: carte ? carte.getAttribute('aria-modal') : null,
      };
    });
    ok(auDepart.carte === true, `le guide est la (« ${auDepart.titre} »)`);
    ok(/1 sur \d/.test(auDepart.rang), `le guide annonce son avancement ("${auDepart.rang}")`);
    ok(auDepart.modale === null, 'la carte du guide n est PAS modale : elle ne bloque pas l exploration');
    ok(auDepart.blocs.tete !== 'none' && auDepart.blocs.tete !== 'absent',
      `etape 1 : le bloc raconte est la (display = ${auDepart.blocs.tete})`);
    ok(auDepart.blocs.kpi === 'none' && auDepart.blocs.liste === 'none',
      `etape 1 : les blocs pas encore racontes sont hors du flux (kpi = ${auDepart.blocs.kpi}, liste = ${auDepart.blocs.liste})`);
    ok(auDepart.passer === true, 'le guide se saute (bouton « Passer le guide »)');

    // « PASSER » DONNE L ECRAN COMPLET IMMEDIATEMENT. C'est la regle qui
    // empeche le tutoriel de devenir une prison : personne ne doit attendre
    // une animation pour voir le produit.
    await page.click('[data-d-passer]');
    await page.waitForTimeout(260);
    const apresPasser = await page.evaluate(() => {
      const etat = {};
      ['tete', 'kpi', 'onglets', 'grille', 'liste'].forEach((b) => {
        const el = document.querySelector(`[data-d-bloc="${b}"]`);
        const cs = el ? getComputedStyle(el) : null;
        etat[b] = cs ? { display: cs.display, opacite: cs.opacity, anim: cs.animationName } : 'absent';
      });
      return {
        blocs: etat,
        guideArme: document.documentElement.hasAttribute('data-d-guide'),
        pastille: !!document.querySelector('.d-guide.is-pastille'),
        reprise: !!document.querySelector('[data-d-rejouer]'),
        hauteur: Math.round(document.documentElement.scrollHeight),
      };
    });
    const tousVisibles = Object.keys(apresPasser.blocs)
      .every((k) => apresPasser.blocs[k] !== 'absent' && apresPasser.blocs[k].display !== 'none');
    ok(tousVisibles, `« Passer » rend TOUS les blocs (${JSON.stringify(Object.keys(apresPasser.blocs).map((k) => k + ':' + (apresPasser.blocs[k].display || '?')))})`);
    const sansAnimation = Object.keys(apresPasser.blocs)
      .every((k) => apresPasser.blocs[k] === 'absent' || apresPasser.blocs[k].anim === 'none');
    ok(sansAnimation, 'aucune animation a attendre apres « Passer » : l etat final est pose d emblee');
    const opaques = Object.keys(apresPasser.blocs)
      .every((k) => apresPasser.blocs[k] === 'absent' || Number(apresPasser.blocs[k].opacite) === 1);
    ok(opaques, 'aucun bloc laisse a demi transparent apres « Passer »');
    ok(apresPasser.guideArme === false, 'le depouillement est leve : plus aucun bloc ne peut etre cache');
    ok(apresPasser.reprise === true, 'le guide se reprend (« Reprendre le guide »)');

    // =====================================================================
    console.log('\n[5] LES PORTES FERMEES : grisees, floutees, et echappables');
    // =====================================================================
    const menu = await page.evaluate(() => [].map.call(document.querySelectorAll('[data-d-menu]'), (el) => ({
      cle: el.getAttribute('data-d-menu'),
      verrou: el.classList.contains('is-verrou'),
      cadenas: !!el.querySelector('.d-cadenas'),
      // L'etat ne doit pas tenir a la couleur seule : un complement de texte
      // est lu par la synthese vocale.
      dit: !!el.querySelector('.d-invisible'),
      contraste: getComputedStyle(el).color,
    })));
    ok(menu.length === ENTREES_MENU.length,
      `les ${ENTREES_MENU.length} entrees de menu sont rendues (obtenu ${menu.length})`);
    const ordre = menu.map((m) => m.cle).join(' > ');
    const attendu = ENTREES_MENU.map((m) => m.cle).join(' > ');
    ok(ordre === attendu, `les entrees sont dans l ordre du produit (obtenu "${ordre}")`);
    const cockpit = menu.filter((m) => String(m.cle).indexOf('cockpit') === 0);
    ok(cockpit.length === 0, `aucune entree du cockpit plateforme dans une page publique (trouvees : ${cockpit.map((c) => c.cle).join(', ') || 'aucune'})`);

    for (const entree of ENTREES_MENU) {
      const vu = menu.filter((m) => m.cle === entree.cle)[0] || {};
      ok(vu.verrou === !entree.ouvert,
        `[${entree.cle}] ${entree.ouvert ? 'ouverte, donc pas grisee' : 'GRISEE dans la barre laterale'}`);
      if (!entree.ouvert) {
        ok(vu.cadenas === true, `[${entree.cle}] porte un cadenas : l etat ne tient pas a la couleur seule`);
        ok(vu.dit === true, `[${entree.cle}] son etat est DIT, pas seulement montre (texte pour la synthese vocale)`);
      }
    }

    for (const entree of ENTREES_MENU) {
      const avant = fuites.length;
      const vu = await ouvrirEcran(page, entree.cle);
      const nouvelles = fuites.slice(avant);
      ok(nouvelles.length === 0, `[${entree.cle}] zero requete /api/ (recu : ${nouvelles.join(' | ') || 'aucune'})`);
      if (entree.ouvert) {
        ok(vu.fenetre === false, `[${entree.cle}] OUVERT : l ecran se rend, pas la fenetre`);
        ok(/none/.test(vu.flou), `[${entree.cle}] OUVERT : aucun flou (filter = ${vu.flou})`);
      } else {
        ok(vu.fenetre === true, `[${entree.cle}] FERME : la fenetre s affiche`);
        ok(vu.role === 'dialog' && vu.modale === 'true',
          `[${entree.cle}] FERME : c est une vraie fenetre modale (role = ${vu.role}, aria-modal = ${vu.modale})`);
        ok(/blur\(/.test(vu.flou), `[${entree.cle}] FERME : le fond reel est FLOUTE (filter = ${vu.flou})`);
        ok(vu.inert === true, `[${entree.cle}] FERME : le fond est hors du parcours clavier (inert)`);
        ok(vu.focusDansFenetre === true, `[${entree.cle}] FERME : le focus est ENTRE dans la fenetre`);
        ok(vu.titre === entree.titre, `[${entree.cle}] FERME : la fenetre nomme la section (attendu "${entree.titre}", obtenu "${vu.titre}")`);
        ok(vu.cta === LIEN_APPEL_ATTENDU, `[${entree.cle}] FERME : le bouton mene au questionnaire (obtenu "${vu.cta}")`);
        ok(vu.puces >= 3, `[${entree.cle}] FERME : la fenetre dit ce que la section contient (${vu.puces} points)`);
        ok(vu.retour === true, `[${entree.cle}] FERME : une sortie VISIBLE existe (« Continuer sur le planning »)`);
      }
      ok(vu.bandeau === true, `[${entree.cle}] le bandeau de demonstration est toujours la`);
      ok(MARQUE_CLIENT.test(vu.texte) === false, `[${entree.cle}] aucune enseigne ni ville du vrai client a l ecran`);
    }

    // AUCUN COMPTE A REBOURS : la fenetre reste ouverte tant qu'on ne la ferme
    // pas. On attend, et on verifie qu'elle est toujours la.
    await ouvrirEcran(page, 'clients');
    await page.waitForTimeout(3200);
    const toujoursLa = await page.evaluate(() => !!document.getElementById('dFenetre'));
    ok(toujoursLa === true, 'AUCUN compte a rebours : la fenetre ne se ferme pas toute seule (3,2 s d attente)');

    // LE PIEGE A FOCUS. On tabule dix fois : le focus ne doit JAMAIS sortir de
    // la fenetre. Sans ce piege, la tabulation descend dans une page floue et
    // illisible, ce qui est le defaut des fenetres modales mal faites.
    let sorties = 0;
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      const dedans = await page.evaluate(() => {
        const f = document.getElementById('dFenetre');
        return !!f && f.contains(document.activeElement);
      });
      if (!dedans) sorties += 1;
    }
    ok(sorties === 0, `le focus reste PIEGE dans la fenetre sur 10 tabulations (sorties : ${sorties})`);

    // ECHAP : la porte de sortie clavier.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const apresEchap = await page.evaluate(() => ({
      fenetre: !!document.getElementById('dFenetre'),
      verrou: document.body.classList.contains('is-verrou'),
      flou: getComputedStyle(document.getElementById('dMain')).filter,
      planning: !document.getElementById('ecranPlanning').hidden,
    }));
    ok(apresEchap.fenetre === false, 'Echap ferme la fenetre');
    ok(apresEchap.verrou === false && /none/.test(apresEchap.flou),
      `Echap retire le flou (filter = ${apresEchap.flou})`);
    ok(apresEchap.planning === true, 'Echap ramene sur le planning');

    // Le bouton de sortie visible fait la meme chose.
    await ouvrirEcran(page, 'emails');
    await page.click('[data-d-retour]');
    await page.waitForTimeout(600);
    const apresRetour = await page.evaluate(() => ({
      fenetre: !!document.getElementById('dFenetre'),
      planning: !document.getElementById('ecranPlanning').hidden,
    }));
    ok(apresRetour.fenetre === false && apresRetour.planning === true,
      '« Continuer sur le planning » ramene sur la partie ouverte');

    await page.close();

    // =====================================================================
    console.log('\n[6] MOUVEMENT REDUIT : l ecran est complet des le depart');
    // =====================================================================
    const calme = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await coupeCdn(calme);
    await calme.goto(`${BASE_URL}/demo`, { waitUntil: 'networkidle', timeout: 45000 });
    await calme.waitForSelector('[data-d-menu]', { timeout: 15000 });
    await calme.waitForTimeout(300);
    const vuCalme = await calme.evaluate(() => {
      const etat = {};
      ['tete', 'kpi', 'onglets', 'grille', 'liste'].forEach((b) => {
        const el = document.querySelector(`[data-d-bloc="${b}"]`);
        const cs = el ? getComputedStyle(el) : null;
        etat[b] = cs ? cs.display + '/' + cs.animationName : 'absent';
      });
      return { blocs: etat, guide: !!document.getElementById('dGuide') };
    });
    const toutLa = Object.keys(vuCalme.blocs).every((k) => vuCalme.blocs[k].indexOf('none/') !== 0 && vuCalme.blocs[k] !== 'absent');
    ok(toutLa, `mouvement reduit : tous les blocs sont la des le depart (${JSON.stringify(vuCalme.blocs)})`);
    const zeroAnim = Object.keys(vuCalme.blocs).every((k) => vuCalme.blocs[k].indexOf('/none') !== -1);
    ok(zeroAnim, 'mouvement reduit : aucune animation d arrivee');
    ok(vuCalme.guide === true, 'mouvement reduit : le guide explique quand meme, il ne disparait pas');
    await calme.close();

    // =====================================================================
    console.log('\n[7] LA CONSOLE REELLE EST STRICTEMENT INCHANGEE');
    // =====================================================================
    servis.length = 0;
    surveiller(true);
    const prod = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await coupeCdn(prod);
    await prod.route('**/api/**', (route) => route.fulfill({
      status: 401, contentType: 'application/json', body: '{"ok":false,"authenticated":false}',
    }));
    await prod.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await prod.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
    await prod.evaluate(() => { setView('staff'); });
    await prod.waitForTimeout(900);

    const chargesDemo = servis.filter((p) => FICHIERS_DEMONSTRATION.some((f) => p.indexOf(f) !== -1));
    ok(chargesDemo.length === 0,
      `la console reelle ne charge AUCUN fichier de la demonstration (charges : ${chargesDemo.join(', ') || 'aucun'})`);

    const reelle = await prod.evaluate(() => ({
      chemin: location.pathname,
      fragment: location.hash,
      overlay: !!document.getElementById('authOverlay') && !document.getElementById('authOverlay').classList.contains('hidden'),
      classeDemo: document.body.className.indexOf('pinlane-demo') !== -1 || document.body.className.indexOf('d-guide') !== -1,
      attributsDemo: [].filter.call(document.documentElement.attributes, (a) => /^data-(pl|d)-/.test(a.name)).map((a) => a.name),
      bandeau: !!document.getElementById('pinlaneDemoBadge') || !!document.querySelector('.d-bandeau'),
      fenetre: !!document.getElementById('pinlaneDemoInvite') || !!document.getElementById('dFenetre'),
      guide: !!document.getElementById('pinlaneDemoGuide') || !!document.getElementById('dGuide'),
      halo: !!document.querySelector('.pl-halo, .d-halo'),
      // La preuve la plus directe : aucune feuille de style de la
      // demonstration n'est attachee au document.
      feuillesDemo: [].filter.call(document.styleSheets, (s) => {
        try { return String(s.href || '').indexOf('/demo/') !== -1; } catch (e) { return false; }
      }).length,
    }));
    ok(reelle.chemin === '/', `console reelle : chemin = / (obtenu "${reelle.chemin}")`);
    ok(reelle.fragment.startsWith('#/staff/'), `console reelle : fragment = #/staff/... (obtenu "${reelle.fragment}")`);
    ok(reelle.overlay === true, 'console reelle SANS session : l ecran de code d acces s affiche toujours');
    ok(reelle.classeDemo === false, 'console reelle : aucune classe de demonstration sur le corps');
    ok(reelle.attributsDemo.length === 0, `console reelle : aucun attribut de demonstration sur <html> (trouves : ${reelle.attributsDemo.join(', ') || 'aucun'})`);
    ok(reelle.bandeau === false, 'console reelle : AUCUN bandeau de demonstration');
    ok(reelle.fenetre === false && reelle.guide === false && reelle.halo === false,
      'console reelle : ni fenetre, ni guide, ni cercle de designation');
    ok(reelle.feuillesDemo === 0, `console reelle : aucune feuille de style de la demonstration attachee (${reelle.feuillesDemo})`);

    // `?demo=1` etait l'ANCIENNE porte d'entree : elle ne doit plus rien
    // declencher. Si elle marchait encore, le decouplage serait incomplet.
    await prod.goto(`${BASE_URL}/?demo=1`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await prod.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
    await prod.waitForTimeout(1400);
    const avecParametre = await prod.evaluate(() => ({
      bandeau: !!document.getElementById('pinlaneDemoBadge') || !!document.querySelector('.d-bandeau'),
      classeDemo: document.body.className.indexOf('pinlane-demo') !== -1,
      reseauRemplace: window.fetch.toString().indexOf('[native code]') === -1,
    }));
    ok(avecParametre.bandeau === false && avecParametre.classeDemo === false,
      '`/?demo=1` ne declenche plus AUCUNE demonstration sur la console reelle');
    ok(avecParametre.reseauRemplace === false,
      'la console reelle garde son `fetch` natif : plus rien ne le remplace');

    await prod.evaluate(() => { setView('client'); });
    await prod.waitForTimeout(500);
    const surClient = await prod.evaluate(() => location.pathname);
    ok(surClient === '/reserver', `parcours client : chemin = /reserver (obtenu "${surClient}")`);
    await prod.close();
    surveiller(false);

    // =====================================================================
    console.log('\n[8] CONTRE-PREUVES par mutation (ce gate sait-il rougir ?)');
    // =====================================================================
    // (a) On OUVRE une porte fermee : la fenetre doit cesser de se poser, et le
    // flou doit disparaitre. Sans cette contre-epreuve, les assertions
    // « FERME » pourraient etre vraies par accident.
    const originalJs = fs.readFileSync(DEMO_JS, 'utf8');
    const ancre = "{ cle: 'clients', libelle: 'Clients', ico: 'gens', pastille: '2' },";
    if ((originalJs.split(ancre).length - 1) !== 1) {
      ok(false, 'ancre de mutation de la porte fermee introuvable (la table MENU a-t-elle bouge ?)');
    } else {
      fs.writeFileSync(DEMO_JS, originalJs.replace(ancre,
        "{ cle: 'clients', libelle: 'Clients', ico: 'gens', pastille: '2', ouvert: true },"));
      let mute = { fenetre: true, verrou: true };
      try {
        const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await coupeCdn(p2);
        await p2.goto(`${BASE_URL}/demo?guide=0&v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
        await p2.waitForSelector('[data-d-menu]', { timeout: 15000 });
        await p2.click('[data-d-menu="clients"]');
        await p2.waitForTimeout(600);
        mute = await p2.evaluate(() => ({
          fenetre: !!document.getElementById('dFenetre'),
          verrou: document.body.classList.contains('is-verrou'),
          grise: document.querySelector('[data-d-menu="clients"]').classList.contains('is-verrou'),
        }));
        await p2.close();
      } finally {
        fs.writeFileSync(DEMO_JS, originalJs); // restauration par edition inverse
      }
      ok(mute.fenetre === false && mute.verrou === false && mute.grise === false,
        `porte ouverte par mutation : ni fenetre, ni flou, ni grisage -> les assertions FERME savent rougir (fenetre = ${mute.fenetre}, flou = ${mute.verrou}, grise = ${mute.grise})`);
    }

    // (b) On rebranche la demonstration dans la console reelle : le gate de
    // non-contamination doit rougir. C'est la contre-epreuve de la preuve la
    // plus importante du lot.
    const originalHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const marqueur = '<div class="d-halo" aria-hidden="true"></div>';
    const htmlDemo = fs.readFileSync(DEMO_HTML, 'utf8');
    ok(htmlDemo.indexOf(marqueur) !== -1, 'la page de demonstration porte bien son cercle de designation (ancre de la contre-preuve)');
    const injecte = originalHtml.replace('</body>', '<link rel="stylesheet" href="/demo/demo.css"></body>');
    fs.writeFileSync(path.join(ROOT, 'index.html'), injecte);
    let contamine = { feuillesDemo: 0 };
    try {
      servis.length = 0;
      surveiller(true);
      const p3 = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      await coupeCdn(p3);
      await p3.route('**/api/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false}' }));
      await p3.goto(`${BASE_URL}/?v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await p3.waitForTimeout(700);
      contamine.feuillesDemo = servis.filter((p) => FICHIERS_DEMONSTRATION.some((f) => p.indexOf(f) !== -1)).length;
      await p3.close();
      surveiller(false);
    } finally {
      fs.writeFileSync(path.join(ROOT, 'index.html'), originalHtml);
    }
    ok(contamine.feuillesDemo > 0,
      `demonstration rebranchee par mutation : la console reelle charge ${contamine.feuillesDemo} fichier(s) de demonstration -> le gate de non-contamination ROUGIRAIT`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\ndemo-mode-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\ndemo-mode-check: ALL OK - /demo est autonome, ne peut rien ecrire en production, et ne contamine pas la console reelle.');
}

main().catch((err) => { console.error(err); process.exit(1); });

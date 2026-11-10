// L ANCIEN FORMULAIRE N A PLUS DE PORTE (2026-11-10, Ansar : « tu peux le retirer de partout et
// remplace par notre vrai formulaire »).
//
// L ancien formulaire est le tunnel d index.html (#clientView, « Votre venue », « Quel jour
// venez-vous ? »). Le vrai est fungalaxy.html. Ce gate interdit a l ancien de revenir par une de ses
// quatre portes :
//   1. une adresse /reserver qui servirait index.html (vercel.json, et le serveur local qui le suit) ;
//   2. le vrai formulaire qui ne saurait pas lire son centre dans /reserver/<centre> : il vendrait
//      Libramont a un client de Gembloux ;
//   3. la deconnexion, qui ramenait l equipe sur l ancien tunnel (elle rend la page d accueil) ;
//   4. le menu « Site de reservation public », qui l ouvrait dans la console.
// Chaque lecture est une fonction du texte du fichier : la meme sert a la preuve et a sa
// contre-preuve, jouee en memoire sur le texte remis dans son ancien etat. Aucun fichier n est ecrit.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const lire = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
let oks = 0;
let fails = 0;
function ok(condition, nom, detail) {
  if (condition) { oks += 1; console.log(`ok   - ${nom}`); return; }
  fails += 1;
  console.log(`FAIL - ${nom}${detail ? ` :: ${String(detail).slice(0, 300)}` : ''}`);
}

// --- Les lectures -----------------------------------------------------------------------------
function adressesSansAncien(vercelTexte) {
  const regles = JSON.parse(vercelTexte).rewrites || [];
  const reserver = regles.filter((r) => /^\/reserver(\/|$)/.test(r.source));
  const de = (source) => (regles.find((r) => r.source === source) || {}).destination;
  const iSite = regles.findIndex((r) => r.source === '/reserver/libramont');
  const iGenerique = regles.findIndex((r) => r.source === '/reserver/:center');
  return reserver.length >= 3 && reserver.every((r) => r.destination !== '/index.html')
    && de('/reserver') === '/fungalaxy.html' && de('/reserver/:center') === '/fungalaxy.html'
    && de('/reserver/libramont') === '/fungalaxy-site.html' && iSite >= 0 && iSite < iGenerique;
}

// Le vrai code du formulaire, joue sur une adresse : ses trois lignes d en-tete et sa fonction.
function centreLu(formulaireTexte, chemin, requete = '') {
  const debut = formulaireTexte.indexOf('  var params = new URLSearchParams(window.location.search);');
  const fonction = formulaireTexte.indexOf('  function centreDepuisAdresse() {', debut);
  const fin = formulaireTexte.indexOf('\n  }\n', fonction);
  if (debut < 0 || fonction < 0 || fin < 0) return 'fonction introuvable';
  const contexte = vm.createContext({ window: { location: { pathname: chemin, search: requete } }, URLSearchParams });
  vm.runInContext(formulaireTexte.slice(debut, fin + 4), contexte);
  return vm.runInContext('centreDepuisAdresse()', contexte);
}

// Le corps d un bloc : de son en-tete a la premiere accolade fermante au meme retrait.
function corpsDe(texte, entete) {
  const i = texte.indexOf(entete);
  if (i < 0) return '';
  const retrait = /^ */.exec(texte.slice(texte.lastIndexOf('\n', i) + 1))[0];
  const j = texte.indexOf(`\n${retrait}}`, i);
  return j < 0 ? '' : texte.slice(i, j);
}
function deconnexionSansAncien(appTexte) {
  const corps = corpsDe(appTexte, 'async function logout() {');
  const sortie = corpsDe(appTexte, 'function quitterLaConsoleVersLAccueil() {');
  const iVue = sortie.indexOf("setView('client')");
  const iAccueil = sortie.indexOf('showPublicEntry()');
  // La console se quitte, puis la page d accueil recouvre : dans cet ordre, et a l adresse /.
  return Boolean(corps) && !corps.includes('setView(') && corps.includes('quitterLaConsoleVersLAccueil()')
    && iVue >= 0 && iAccueil > iVue && sortie.includes("replaceState(window.history.state, '', '/')");
}
function menuSansAncien(menuTexte) {
  const corps = corpsDe(menuTexte, "if (action === 'client') {");
  return Boolean(corps) && !corps.includes('setView(') && corps.includes('window.open(') && corps.includes('/reserver');
}

// Une contre-preuve : le texte remis dans son ancien etat. L ancre doit exister une seule fois,
// sinon la contre-preuve ne prouve rien et elle echoue.
function ancien(texte, de, vers) {
  if (texte.split(de).length - 1 !== 1) return null;
  return texte.split(de).join(vers);
}

function servir(serveur, chemin) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: serveur.address().port, path: chemin }, (res) => {
      let corps = '';
      res.setEncoding('utf8');
      res.on('data', (morceau) => { corps += morceau; });
      res.on('end', () => resolve(corps));
    }).on('error', reject);
  });
}

(async () => {
  const vercel = lire('vercel.json');
  const formulaire = lire('assets/fungalaxy-booking.js');
  const app = lire('assets/app-main.js');
  const menu = lire('assets/staff-menu.js');

  // 1. Les adresses.
  ok(adressesSansAncien(vercel), 'aucune adresse /reserver ne sert index.html : /reserver et /reserver/<centre> servent le vrai formulaire, /reserver/libramont sa page de site, avant la regle generique');
  const vercelNu = ancien(vercel, '"source": "/reserver",\n      "destination": "/fungalaxy.html"', '"source": "/reserver",\n      "destination": "/index.html"');
  ok(vercelNu !== null && !adressesSansAncien(vercelNu), 'contre-preuve : /reserver rendu a index.html rougit');
  const vercelCentre = ancien(vercel, '"source": "/reserver/:center",\n      "destination": "/fungalaxy.html"', '"source": "/reserver/:center",\n      "destination": "/index.html"');
  ok(vercelCentre !== null && !adressesSansAncien(vercelCentre), 'contre-preuve : /reserver/<centre> rendu a index.html rougit');

  // 2. Le centre du vrai formulaire.
  const lus = {
    gembloux: centreLu(formulaire, '/reserver/gembloux'),
    gemblouxBarre: centreLu(formulaire, '/reserver/gembloux/'),
    fungalaxy: centreLu(formulaire, '/fungalaxy/gembloux'),
    requete: centreLu(formulaire, '/reserver', '?embed=1&center=gembloux'),
    nu: centreLu(formulaire, '/reserver'),
    libramont: centreLu(formulaire, '/reserver/libramont'),
    faux: centreLu(formulaire, '/reserver/Pas%20Un%20Centre'),
  };
  ok(lus.gembloux === 'gembloux' && lus.gemblouxBarre === 'gembloux' && lus.fungalaxy === 'gembloux', 'le vrai formulaire lit son centre dans /reserver/gembloux comme dans /fungalaxy/gembloux', JSON.stringify(lus));
  ok(lus.requete === 'gembloux', 'l integration par defaut (/reserver?embed=1&center=gembloux) vend bien Gembloux', lus.requete);
  ok(lus.nu === 'libramont' && lus.libramont === 'libramont', 'l adresse nue reste celle de Libramont', JSON.stringify(lus));
  ok(lus.faux === 'centre-inconnu', 'un centre mal nomme ne vend aucun centre', lus.faux);
  const formulaireAncien = ancien(formulaire, '/^\\/(?:fungalaxy|reserver)\\/([^/]+)\\/?$/i', '/^\\/fungalaxy\\/([^/]+)\\/?$/i');
  ok(formulaireAncien !== null && centreLu(formulaireAncien, '/reserver/gembloux') === 'libramont', 'contre-preuve : sans la lecture de /reserver/<centre>, Gembloux recevrait le formulaire de Libramont', formulaireAncien === null ? 'ancre absente' : centreLu(formulaireAncien, '/reserver/gembloux'));

  // 3. La deconnexion.
  ok(deconnexionSansAncien(app), 'la deconnexion rend la page d accueil a l adresse /, jamais l ancien tunnel');
  const appAncien = ancien(app, "  quitterLaConsoleVersLAccueil();\n  applyAuthState();\n}", "  setView('client');\n  applyAuthState();\n}");
  ok(appAncien !== null && !deconnexionSansAncien(appAncien), 'contre-preuve : une deconnexion vers la vue client rougit');
  const appSansAccueil = ancien(app, "  showPublicEntry();\n}\n\nasync function logout() {", "}\n\nasync function logout() {");
  ok(appSansAccueil !== null && !deconnexionSansAncien(appSansAccueil), 'contre-preuve : quitter la console sans afficher la page d accueil rougit');

  // 4. Le menu.
  ok(menuSansAncien(menu), 'le menu « Site de reservation public » ouvre /reserver/<centre> a cote de la console');
  const menuAncien = ancien(menu, "      window.open(centre && centre !== 'all' ?", "      setView('client'); void (centre && centre !== 'all' ?");
  ok(menuAncien !== null && !menuSansAncien(menuAncien), 'contre-preuve : un menu qui rouvre la vue client rougit');

  // 5. Le serveur local sert ce que la production sert.
  const local = require('./dev-tunnel-server');
  const serveur = local.createServer({ port: 0 });
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  try {
    delete process.env.PINLANE_ANCIEN_TUNNEL;
    const nu = await servir(serveur, '/reserver');
    const gembloux = await servir(serveur, '/reserver/gembloux');
    const site = await servir(serveur, '/reserver/libramont');
    const vrai = (page) => page.includes('fungalaxy-booking.js') && !page.includes('id="clientView"');
    ok(vrai(nu) && vrai(gembloux), 'en local, /reserver et /reserver/gembloux servent le vrai formulaire', `nu ${vrai(nu)}, gembloux ${vrai(gembloux)}`);
    ok(site.includes('data-design="fungalaxy"') && !site.includes('id="clientView"'), 'en local, /reserver/libramont sert toujours la page de site du centre');
    process.env.PINLANE_ANCIEN_TUNNEL = '1';
    const redemande = await servir(serveur, '/reserver');
    ok(redemande.includes('id="clientView"'), 'contre-preuve : l ancien ecran ne revient que si un test le redemande (PINLANE_ANCIEN_TUNNEL=1)');
  } finally {
    delete process.env.PINLANE_ANCIEN_TUNNEL;
    await new Promise((resolve) => serveur.close(resolve));
  }

  console.log(`\nancien-formulaire : ${oks} ok, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });

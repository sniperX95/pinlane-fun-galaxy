'use strict';
// L ARRIVEE ET LES ARCADES D UNE FORMULE, A L ECRAN DU CLIENT (modele A,
// 2026-10-13).
//
// Movsar, le 13/10 au soir : « je trouve que tout le systeme de arrivé est
// mal gerer de fou [...] ça montre pour toute les heures quasi que cv se
// deplacer ou que ya des prblm », puis « oui ok pour la A ». Le client ne
// choisit plus son heure d arrivee : il pose ses activites, et ses arcades
// s il veut (« Facultatif ») ; l arrivee est une borne, dix minutes avant la
// premiere activite, a l heure pile quand celle-ci ouvre la journee
// (« lorsque il commence a louverture du centre ils peuvent venir a lheure
// pile »). Ce gate prouve l ecran, dans le navigateur, sur le mock du depot (le
// vrai gestionnaire des disponibilites sur un instantane en memoire : aucune
// base, rien d ecrit, rien d envoye) :
//   [A] sans heure d arcade choisie, rien ne part de plus : aucune demande ne
//       porte arrival, arrivals, arcade ni arcades, le blocage part sans
//       arrivalTime ni arcadeTime, et le reglage d arrivee de la meta n y
//       change rien ; l arrivee est une borne, aucune ligne d arrivee a
//       toucher ;
//   [B] la borne a l ouverture : la Formule 1 proposee a l ouverture fait
//       arriver a l heure du bowling, la visite dit « à l’ouverture » ; le
//       bowling pose a 10:30, la borne dit 10:20, « 10 min avant votre
//       bowling » ;
//   [C] la ligne des arcades (Formules 1, 2, 3, jamais 4) : « Facultatif »,
//       en petit, ne s ouvre pas seule, ses heures (arcades=1) ne se
//       demandent qu a son ouverture, sans arrivee ni heure d arcade, de
//       l ouverture a la fermeture ; une heure sur le bowling pose dit ce
//       qu elle decale ;
//   [D] des arcades a 13:00 : la demande les porte, la borne dit 12:50, leur
//       ligne passe en tete, le bowling se propose a 13:30, la visite les dit
//       a leur heure, le blocage part avec elles ; les retoucher les rend
//       facultatives ;
//   [E] le dernier choix gagne : des arcades sur le bowling pose le liberent
//       (le serveur le replace autour d elles), un bowling sur les arcades les
//       leve (la visite le dit) ; leurs heures se lisent en tirets de la
//       teinte de leur ligne ([J]) ;
//   [F] le temps libre ou les arcades tiennent devient un cadre en pointille
//       qui les propose et les pose ; rien quand elles ont deja leur heure, ni
//       quand le minigolf de la formule couvre ce temps ;
//   [G] au telephone (360 px) : rien ne deborde, des cibles de 44 px, les memes
//       boutons que les heures du bowling, le focus se voit ;
//   [H] une heure par partie de laser (Formule 2, Movsar le 14/10 : « l heure
//       proposée pour la seconde partie de laser game est la même que la
//       1re ») : la ligne de la partie 2 propose la premiere heure libre apres
//       la partie 1, jamais l heure de celle-ci ; touchee dans la ligne 2,
//       l heure est celle de la partie 2 et la partie 1 garde son heure
//       proposee ; la partie 1 posee, la ligne 2 s ouvre seule, sur la plage
//       de son heure proposee.
//   --mutate : une regle cassee a la fois, en memoire (le formulaire servi au
//       navigateur, ou le moteur compile pour le serveur) : chacune doit faire
//       rougir le gate ; le disque n est jamais ecrit, et on le verifie.
//
// Lancement : node scripts/formules-arrivee-form-check.js [--mutate]

const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

// Aucune base, aucun envoi : seuls les NOMS des variables sont lus.
for (const cle of Object.keys(process.env)) {
  if (/(^PG|DATABASE|POSTGRES|RESEND|SECRET|TOKEN|API_KEY|PASSWORD|PASSPHRASE)/i.test(cle)) delete process.env[cle];
}
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_ARRIVEE_FORM_PORT || 4517);
const BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.PINLANE_DEVTUNNEL_PORT = String(PORT);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const PAX = 10;
const SEULEMENT = String(process.env.PINLANE_ARRIVEE_FORM_SCENARIOS || '').split(',').map((s) => s.trim()).filter(Boolean);
// Le reglage que la meta publique donne au formulaire (api/public-booking-meta,
// lib/formula-visit) : l arrivee proposee. Le formulaire ne le lit plus.
const REGLAGE = { arrivalFirst: true, maxWaitMinutes: 30, maxVisitMinutes: 0, freeDurationPolicy: 'default' };
const JS = 'assets/fungalaxy-booking.js';
const CSS = 'assets/fungalaxy-booking.css';

// ---------------------------------------------------------------------------
// LES CONTRE-EPREUVES : une regle cassee chacune, et les scenarios qui la
// voient. Le formulaire est servi casse au navigateur ; le moteur est compile
// casse, avant tout require du serveur. Le disque n est jamais ecrit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'une demande sans arcade porte un parametre de plus', fichier: JS, scenarios: ['A'],
    de: "    if (state.arcade) q.set('arcade', state.arcade);", vers: "    q.set('arcade', state.arcade);" },
  { nom: 'le blocage part avec une heure d arcade vide', fichier: JS, scenarios: ['A'],
    de: '    if (state.arcade) base.preference.arcadeTime = state.arcade;', vers: '    base.preference.arcadeTime = state.arcade;' },
  { nom: 'l arrivee conseillee redit « 0 min avant » a l ouverture', fichier: JS, scenarios: ['B'],
    de: "detail: avance > 0 ? avance + ' min avant ' + votre(parts[0].id) : 'à l’ouverture' });", vers: "detail: avance + ' min avant ' + votre(parts[0].id) });" },
  { nom: 'l arrivee passe de nouveau avant l ouverture (serveur)', fichier: 'lib/ops-engine.js', scenarios: ['B'],
    de: '  const posee = demandeArrivee ? raw : arriveeALOuverture(raw, window.open);', vers: '  const posee = raw;' },
  { nom: 'la ligne des arcades n existe plus', fichier: JS, scenarios: ['C'],
    de: '    if (aDesArcades(d)) {\n      var rangee = arcadeDuPlan();', vers: '    if (false) {\n      var rangee = arcadeDuPlan();' },
  { nom: 'les arcades ne sont plus facultatives (leur ligne s ouvre seule)', fichier: JS, scenarios: ['C'],
    de: "  function aPlacer(e) { return e.etat !== 'choisi' && e.etat !== 'surplace' && e.etat !== 'libre'; }", vers: "  function aPlacer(e) { return e.etat !== 'choisi' && e.etat !== 'surplace'; }" },
  { nom: 'la ligne des arcades dit « À choisir »', fichier: JS, scenarios: ['C'],
    de: ": e.etat === 'libre' ? 'Facultatif' : 'À choisir';", vers: ": 'À choisir';" },
  { nom: '« Facultatif » se lit comme une heure', fichier: CSS, scenarios: ['C'],
    de: '.fg-etape.is-surplace .fg-etape__heure, .fg-etape.is-libre .fg-etape__heure {', vers: '.fg-etape.is-surplace .fg-etape__heure {' },
  { nom: 'les heures d arcade se demandent des l arrivee sur les heures', fichier: JS, scenarios: ['C'],
    de: '    if (ancres.length) { majPistes(d); majEtapes(d); rendreArcades(); }', vers: '    if (ancres.length) { majPistes(d); majEtapes(d); if (aDesArcades(d)) chargerArcades(); }' },
  { nom: 'la liste des heures d arcade part avec l heure choisie', fichier: JS, scenarios: ['D'],
    de: "    // La liste des heures d arcade ne depend pas de celle choisie.\n    if (liste === 'arcades') {", vers: "    if (state.arcade) q.set('arcade', state.arcade);\n    if (liste === 'arcades') {" },
  { nom: 'l heure d arcade choisie ne part pas au serveur', fichier: JS, scenarios: ['D'],
    de: "    if (state.arcade) q.set('arcade', state.arcade);", vers: '    void 0;' },
  { nom: 'le blocage part sans l heure d arcade', fichier: JS, scenarios: ['D'],
    de: '    if (state.arcade) base.preference.arcadeTime = state.arcade;', vers: '    void 0;' },
  { nom: 'la visite ne montre plus les arcades a leur heure', fichier: JS, scenarios: ['D'],
    de: '    if (arcPlan.startTime) parts = parts.concat(', vers: '    if (false) parts = parts.concat(' },
  { nom: 'la visite ne dit plus « à votre heure »', fichier: JS, scenarios: ['D'],
    de: "        p.arcade ? 'à votre heure' : '',", vers: "        '',"},
  { nom: 'retoucher l heure d arcade la garde', fichier: JS, scenarios: ['D'],
    de: "    if (state.arcade === t) state.arcade = '';\n    else {", vers: '    if (false) void 0;\n    else {' },
  { nom: 'sans arrivee, l heure d arcade ne se pose plus (serveur)', fichier: 'lib/ops-engine.js', scenarios: ['D'],
    de: '  if (sansArrivee && arcadeStart !== null && arcadeStart !== undefined && Number.isFinite(Number(arcadeStart))) {', vers: '  if (false) {' },
  { nom: 'des arcades sur le bowling pose ne le liberent plus', fichier: JS, scenarios: ['E'],
    de: '        } else delete state.pins[c.activityId];', vers: '        } else void 0;' },
  { nom: 'une heure de bowling sur les arcades ne les decale plus', fichier: JS, scenarios: ['E'],
    de: '  var DECALENT = { anchor_overlap: 1, arrival_before: 1, arrival_welcome: 1, arcade_overlap: 1 };', vers: '  var DECALENT = { anchor_overlap: 1, arrival_before: 1, arrival_welcome: 1 };' },
  { nom: 'decaler les arcades garde leur heure', fichier: JS, scenarios: ['E'],
    de: "      if (autre === 'arcade_time') {\n        state.arcade = '';", vers: "      if (autre === 'arcade_time') {\n        void 0;" },
  { nom: 'la phrase d une heure posee sur les arcades ne les nomme plus', fichier: JS, scenarios: ['E'],
    de: "    if (g.etat === 'shift' && g.conflit.id === 'arcade_time') return typo('Vos arcades (' + g.conflit.time + ') se feront à un autre moment.');", vers: '' },
  { nom: 'la visite ne dit plus les arcades deplacees', fichier: JS, scenarios: ['E'],
    de: "    var arcadesLevees = Boolean(adaptation && adaptation.deplace === 'arcade_time');", vers: '    var arcadesLevees = false;' },
  { nom: 'la visite ne dit plus le bowling replace autour des arcades', fichier: JS, scenarios: ['E'],
    de: "        replacee ? 'replacé autour de vos arcades (' + adaptation.t + ')'", vers: "        replacee ? ''" },
  { nom: 'la grille des activites ne voit plus les arcades choisies (serveur)', fichier: 'api/public-availability.js', scenarios: ['E'],
    de: '      const arcadeDeLaGrille = !demandeArrivee && !listeArcadesSansArrivee && heureArcade ? { arcadeTime: heureArcade } : {};', vers: '      const arcadeDeLaGrille = {};' },
  { nom: 'le mot d un probleme revient sous l heure', fichier: JS, scenarios: ['E'],
    de: "    $('small', chip).textContent = on || prop || e.etat === 'wave' || e.nom ? mot : '';", vers: "    $('small', chip).textContent = mot;" },
  { nom: 'deux problemes d une plage ont la meme teinte', fichier: JS, scenarios: ['E'],
    de: '  function teinteDe(k) { return String(k % TEINTES); }', vers: "  function teinteDe(k) { return '0'; }" },
  { nom: 'une heure a probleme ne prend pas la teinte de sa ligne', fichier: JS, scenarios: ['E'],
    de: '    groupes.forEach(function (g, k) { g.puces.forEach(function (c) { c.dataset.teinte = teinteDe(k); }); });\n', vers: '' },
  { nom: 'les heures a probleme ne sont plus entourees en tirets', fichier: CSS, scenarios: ['E'],
    de: '.fg-chip.is-soft, .fg-chip.is-shift, .fg-chip.is-off { border-style: dashed;', vers: '.fg-chip.is-soft, .fg-chip.is-shift, .fg-chip.is-off { border-style: solid;' },
  { nom: 'le temps libre ne propose plus les arcades', fichier: JS, scenarios: ['F'],
    de: '      if (!dureeArc || arc.startTime || m < dureeArc) return liste;', vers: '      return liste;' },
  { nom: 'le temps libre propose des arcades qui ont deja leur heure', fichier: JS, scenarios: ['F'],
    de: '      if (!dureeArc || arc.startTime || m < dureeArc) return liste;', vers: '      if (!dureeArc || m < dureeArc) return liste;' },
  { nom: 'le minigolf ne couvre plus le temps libre', fichier: JS, scenarios: ['F'],
    de: '      if (couvert >= m) return liste;', vers: '' },
  { nom: 'le cadre du temps libre ne se deplie plus', fichier: JS, scenarios: ['F'],
    de: '        if (choix) choix.hidden = !ici;', vers: '        void 0;' },
  { nom: 'l idee des arcades ne les pose plus', fichier: JS, scenarios: ['F'],
    de: "    if (versArcades) { libreOuvert = ''; adaptation = null; state.arcade = versArcades.dataset.libreArcades; chargerPlan(); return; }", vers: '    if (versArcades) return;' },
  { nom: 'la ligne de la partie 2 propose l heure de la partie 1', fichier: JS, scenarios: ['H'],
    de: '        if (kLigne > 1) propose = proposeePartie(a, kLigne, etapes);', vers: '        void proposeePartie;' },
  { nom: 'une heure touchee dans la ligne 2 devient celle de la partie 1', fichier: JS, scenarios: ['H'],
    de: '      if (kOuvert > 1 && !state.laserParts.length) {', vers: '      if (false) {' },
  { nom: 'la piste du laser garde ses heures en changeant de ligne', fichier: JS, scenarios: ['H'],
    de: '    if (state.dispo && (partie(avant) || partie(cle))) majPistes(state.dispo);', vers: '    void partie;' },
  { nom: 'la plage ouverte suit l heure d une autre partie', fichier: JS, scenarios: ['H'],
    de: '    utile = sienne || proposee || utile;', vers: '    void sienne;' },
];
const MUTATION_PREUVE = '[mutation] servie :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_ARRIVEE_FORM_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
function muter(contenu, mutation) {
  const texte = contenu.split('\r\n').join('\n');
  if (texte.split(mutation.de).length - 1 !== 1) {
    console.error(`mutation impossible : ancre absente ou multiple dans ${mutation.fichier} : ${mutation.de.slice(0, 70)}`);
    process.exit(2);
  }
  return texte.split(mutation.de).join(mutation.vers);
}
let preuveDite = false;
function direPreuve() {
  if (preuveDite) return;
  preuveDite = true;
  console.log(`${MUTATION_PREUVE} ${MUTATION.nom}`);
}
// Le moteur casse a la compilation : avant le premier require du serveur.
if (MUTATION && !MUTATION.fichier.startsWith('assets/')) {
  const compile = Module.prototype._compile;
  const cible = path.resolve(ROOT, MUTATION.fichier);
  Module.prototype._compile = function compilerAvecMutation(contenu, nom) {
    if (path.resolve(nom) !== cible) return compile.call(this, contenu, nom);
    const mute = muter(contenu, MUTATION);
    direPreuve();
    return compile.call(this, mute, nom);
  };
}

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return Boolean(condition);
}
function section(titre) { console.log(`\n${titre}`); }
// Le formulaire soude ses nombres a leurs unites (typo, espaces insecables) :
// le gate lit son texte sans eux, avec le meme helper que les autres gates.
const sansInsecable = (texte) => (texte === null || texte === undefined ? texte : String(texte).replace(/[\u00a0\u202f]/g, ' '));
const norm = (s) => String(sansInsecable(s) || '').replace(/\s+/g, ' ').trim();
function lisible(v) {
  if (typeof v === 'string') return norm(v);
  if (Array.isArray(v)) return v.map(lisible);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lisible(x)]));
  return v;
}
const params = (u) => new URL(u, BASE_URL).searchParams;
const estListeArcades = (u) => params(u).get('arcades') === '1';
const estPlan = (u) => !params(u).has('arrivals') && !estListeArcades(u);
const sansDoublons = (liste) => liste.filter((x, i) => liste.indexOf(x) === i);
const minutesDe = (h) => { const [a, b] = String(h || '').split(':').map(Number); return a * 60 + b; };
const heureDe = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const posees = (u) => { try { return JSON.parse(params(u).get('preferredTimes') || '{}'); } catch (error) { return {}; } };
function ecartListes(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (a[i] !== b[i]) return `#${i} « ${a[i] || ''} » / « ${b[i] || ''} »`;
  return '';
}
// Le blocage sans ce qui change d une visite a l autre : son jeton, et la
// provenance (elle porte l heure de la visite).
function corpsComparable(corps) {
  if (!corps) return '';
  const { holdToken: _jeton, acquisition: _provenance, ...reste } = corps;
  return JSON.stringify(reste);
}

// ---------------------------------------------------------------------------
// LE SERVEUR DE DEV, ENVELOPPE : la meta donne le reglage d arrivee du
// scenario ; le formulaire casse (contre-epreuve) est servi a la place de
// celui du depot.
// ---------------------------------------------------------------------------
let reglage = REGLAGE;   // le reglage de la meta (null : la cle absente)
function semer(mock) {
  mock.blocagesDev.clear();
  mock.occupationDev.length = 0;
  mock.blocsDev.length = 0;
  mock.dernierePose.body = null;
  mock.dernierePose.blocages.length = 0;
}
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    // Tous les navigateurs du gate partagent 127.0.0.1 : le plafond par
    // adresse (60 demandes par minute) les compterait ensemble.
    const seaux = globalThis.__pinlaneRateBuckets;
    if (seaux) [...seaux.keys()].filter((k) => /^public-(availability|holds|reservations):/.test(k)).forEach((k) => seaux.delete(k));
    if (url.pathname === `/${CSS}` && MUTATION && MUTATION.fichier === CSS) {
      const feuille = muter(fs.readFileSync(path.join(ROOT, CSS), 'utf8'), MUTATION);
      direPreuve();
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(feuille);
      return;
    }
    if (url.pathname === `/${JS}` && MUTATION && MUTATION.fichier === JS) {
      const corps = muter(fs.readFileSync(path.join(ROOT, JS), 'utf8'), MUTATION);
      direPreuve();
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(corps);
      return;
    }
    if (url.pathname === '/api/public-booking-meta' && req.method === 'GET') {
      const fin = res.end.bind(res);
      res.end = (corps, ...reste) => {
        try {
          const j = JSON.parse(String(corps));
          if (j && j.center) {
            if (reglage) j.center.formulaVisit = { ...reglage };
            else delete j.center.formulaVisit;
          }
          return fin(JSON.stringify(j), ...reste);
        } catch (error) {
          return fin(corps, ...reste);
        }
      };
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// ---------------------------------------------------------------------------
// LE NAVIGATEUR
// ---------------------------------------------------------------------------
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return false; }
}
// Un contexte neuf par scenario : ce qu il demande, ce qu il recoit, ce qu il
// retient (le corps des blocages), ses erreurs.
async function ouvrir(browser, { largeur = 1280, hauteur = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const suivi = { erreurs: [], demandes: [], reponses: [], blocages: [] };
  page.on('pageerror', (e) => suivi.erreurs.push(String((e && e.message) || e)));
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/public-availability')) suivi.demandes.push(u);
    if (u.includes('/api/public-holds') && req.method() === 'POST') {
      try { const corps = JSON.parse(req.postData() || '{}'); if (!corps.release) suivi.blocages.push(corps); } catch (error) { /* corps illisible */ }
    }
  });
  page.on('response', async (rep) => {
    if (!rep.url().includes('/api/public-availability')) return;
    try { suivi.reponses.push({ url: rep.url(), json: await rep.json() }); } catch (error) { /* corps illisible */ }
  });
  return { ctx, page, suivi };
}
async function calme(page) {
  await attendre(page, () => !document.querySelector('#hourZone.is-busy') && !document.querySelector('.fg-chip.is-pending'), 15000);
  await page.waitForTimeout(350);
}
async function versHeures(page, mock, formuleId) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  await page.click('#dayBtn');
  // Le pointeur quitte la grille : a 560 px et moins, le calendrier s ouvre au
  // milieu de l ecran, sous l endroit du bouton (voir l ancien gate).
  await page.mouse.move(0, 0);
  const [y, mo] = mock.DATE.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    await page.click(y * 12 + (mo - 1) > Number(an) * 12 + MOIS.indexOf(nom.toLowerCase()) ? '#calNext' : '#calPrev');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  await attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await attendre(page, () => document.querySelector('#dayPop').hidden, 3000);
  await page.fill('#paxInput', String(PAX));
  await page.press('#paxInput', 'Enter');
  await attendre(page, (n) => document.querySelector('#paxInput').value === String(n), 3000, PAX);
  await page.click('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
  await page.click('#tabFor');
  await attendre(page, () => !document.querySelector('#panelFor').hidden && document.querySelectorAll('#gridFor .fg-card').length > 0, 5000);
  await page.click(`#gridFor .fg-card[data-formule="${formuleId}"]`);
  await page.waitForTimeout(250);
  await page.click('#goHours');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 8000);
  const pret = await attendre(page, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone.is-busy'), 15000);
  await calme(page);
  return pret;
}
// Le programme, ligne par ligne : la cle, sa classe, l heure dite, le detail.
async function lireProgramme(page) {
  return lisible(await page.evaluate(() => {
    const t = (n) => (n ? n.textContent : '');
    const ol = document.querySelector('#hourZone .fg-etapes');
    if (!ol) return { lignes: [] };
    return {
      lignes: [...ol.children].map((li) => {
        const tete = li.querySelector('.fg-etape__tete');
        const heure = li.querySelector('.fg-etape__heure');
        return {
          cle: li.dataset.cle || '',
          classe: li.className,
          cache: li.getAttribute('aria-hidden') === 'true',
          tete: Boolean(tete),
          detail: t(li.querySelector('.fg-etape__quoi small')),
          heure: heure ? (heure.dataset.mot || t(heure)) : '',
          ouverte: li.classList.contains('is-open'),
          taille: heure ? parseFloat(getComputedStyle(heure).fontSize) : 0,
        };
      }),
    };
  }));
}
const ligneDe = (programme, cle) => ((programme && programme.lignes) || []).find((l) => l.cle === cle) || null;
const borneArrivee = (programme) => ((programme && programme.lignes) || []).find((l) => /fg-etape--borne/.test(l.classe) && /fg-etape--arrivee/.test(l.classe)) || null;
const resumeLignes = (programme) => ((programme && programme.lignes) || []).map((l) => `${l.cle || l.classe.replace(/\bfg-etape\b\s*/g, '').trim()}:${l.heure}`).join(' | ');
async function lireVisite(page) {
  return lisible(await page.evaluate(() => {
    const t = (n) => (n ? n.textContent : '');
    const zone = document.querySelector('#planZone');
    return {
      etapes: zone ? [...zone.querySelectorAll('.fg-visit__step')].map((li) => ({ b: t(li.querySelector('b')), titre: t(li.querySelector('span')), detail: t(li.querySelector('small')), genre: li.className })) : [],
      attentes: zone ? [...zone.querySelectorAll('.fg-visit__gap')].map((li) => ({ texte: t(li), libre: li.classList.contains('fg-visit__gap--libre') })) : [],
    };
  }));
}
async function lirePuces(page, piste) {
  return lisible(await page.evaluate((id) => [...document.querySelectorAll(`.fg-track[data-activity="${id}"] .fg-chip`)].map((c) => ({
    time: c.dataset.time, ok: c.dataset.ok, etat: c.dataset.state || '', mot: c.dataset.mot || '',
    on: c.classList.contains('is-on'), prop: c.classList.contains('is-proposed'),
    ecrit: ((c.querySelector('small') || {}).textContent || '').trim(),
  })), piste));
}
async function lirePourquoi(page, piste) {
  return lisible(await page.evaluate((id) => [...document.querySelectorAll(`.fg-track[data-activity="${id}"] .fg-why-list__item`)].map((li) => ({
    etat: li.dataset.etat || '', heures: String(li.dataset.heures || '').split(' ').filter(Boolean),
    texte: (li.querySelector('span') || {}).textContent || '',
  })), piste));
}
const pourquoiDe = (lignes, heure) => (lignes || []).find((l) => l.heures.includes(heure)) || null;
async function lireLibres(page) {
  return lisible(await page.evaluate(() => [...document.querySelectorAll('#planZone .fg-visit__gap--libre')].map((li) => ({
    quoi: ((li.querySelector('.fg-libre__quoi') || {}).textContent || ''),
    ouvert: li.classList.contains('is-open'),
    choixCache: Boolean((li.querySelector('.fg-libre__choix') || {}).hidden),
    actions: [...li.querySelectorAll('.fg-libre__action')].map((b) => ({ arcades: b.dataset.libreArcades || '', titre: (b.querySelector('b') || {}).textContent || '', detail: (b.querySelector('small') || {}).textContent || '' })),
  }))));
}
// [J] LES HEURES QUI POSENT PROBLEME : plus de mot sous l heure (seuls
// « choisi », « proposé » et le nom d une partie s ecrivent), un contour en
// tirets de la teinte de la ligne qu elle pointe, une teinte par ligne dans
// une plage. Lu au repos : les transitions de couleur figees le temps de la
// lecture.
async function problemesEnCouleur(page, label) {
  await attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity), 5000);
  const r = await page.evaluate(() => {
    const fautes = [];
    const gel = document.createElement('style');
    gel.textContent = '#hourZone .fg-chip, #hourZone .fg-why-list__quand { transition: none !important; }';
    document.head.appendChild(gel);
    let lignes = 0;
    let deuxLignes = 0;
    let puces = 0;
    document.querySelectorAll('#hourZone .fg-track .fg-period').forEach((sec) => {
      const ou = `${sec.closest('.fg-track').dataset.activity}/${sec.dataset.period}`;
      const items = [...sec.querySelectorAll('.fg-why-list__item')];
      const teintes = items.map((li) => {
        const q = li.querySelector('.fg-why-list__quand');
        const s = q ? getComputedStyle(q) : null;
        if (!s || s.borderTopStyle !== 'dashed' || s.borderTopColor !== s.color) fautes.push(`${ou} ligne ${li.dataset.heures} : contour ${s && s.borderTopStyle} ${s && s.borderTopColor}, texte ${s && s.color}`);
        return s ? s.borderTopColor : '';
      });
      lignes += items.length;
      if (items.length >= 2) deuxLignes += 1;
      if (new Set(teintes).size !== teintes.length) fautes.push(`${ou} : ${items.length} lignes pour ${new Set(teintes).size} teintes`);
      sec.querySelectorAll('.fg-chip').forEach((c) => {
        if (!['soft', 'shift', 'hard'].includes(c.dataset.state) || c.classList.contains('is-on') || c.classList.contains('is-proposed')) return;
        puces += 1;
        const ecrit = ((c.querySelector('small') || {}).textContent || '').trim();
        if (ecrit && !/^partie \d/.test(ecrit)) fautes.push(`${ou} ${c.dataset.time} ecrit « ${ecrit} »`);
        const q = (document.getElementById(c.getAttribute('aria-describedby') || '') || { querySelector: () => null }).querySelector('.fg-why-list__quand');
        if (!q) { fautes.push(`${ou} ${c.dataset.time} sans sa ligne`); return; }
        if (c.matches(':hover') || c.classList.contains('is-asked')) return;
        const cs = getComputedStyle(c);
        if (cs.borderTopStyle !== 'dashed') fautes.push(`${ou} ${c.dataset.time} contour ${cs.borderTopStyle}`);
        if (cs.borderTopColor !== getComputedStyle(q).borderTopColor) fautes.push(`${ou} ${c.dataset.time} ${cs.borderTopColor}, sa ligne ${getComputedStyle(q).borderTopColor}`);
      });
    });
    gel.remove();
    return { fautes, lignes, deuxLignes, puces };
  });
  ok(r.puces > 0 && r.fautes.length === 0, `[J] ${label} : chaque heure qui pose probleme est sans mot, entouree en tirets de la teinte de sa ligne, une teinte par ligne (${r.puces} heures, ${r.lignes} lignes, ${r.deuxLignes} plages a deux lignes ou plus)`, r.fautes.slice(0, 4).join(' | '));
  return r;
}
// Une heure touchee au doigt, si elle se prend.
function toucher(page, piste, heure) {
  return page.evaluate(({ id, h }) => {
    const c = document.querySelector(`.fg-track[data-activity="${id}"] .fg-chip[data-time="${h}"]`);
    if (!c || c.dataset.ok === 'false') return false;
    c.click();
    return true;
  }, { id: piste, h: heure });
}
// Une heure d une plage repliee : sa plage s ouvre d abord, comme au doigt.
async function ouvrirPlage(page, piste, heure) {
  await page.evaluate(({ id, h }) => {
    const c = document.querySelector(`.fg-track[data-activity="${id}"] .fg-chip[data-time="${h}"]`);
    const sec = c && c.closest('.fg-period');
    if (sec && !sec.classList.contains('is-open')) sec.querySelector('.fg-period__btn').click();
  }, { id: piste, h: heure });
  await page.waitForTimeout(450);
}
async function ouvrirLigne(page, cle) {
  const ouverte = await page.evaluate((c) => { const l = document.querySelector(`#hourZone .fg-etape[data-cle="${c}"]`); return Boolean(l && l.classList.contains('is-open')); }, cle);
  if (!ouverte) await page.click(`#hourZone .fg-etape[data-cle="${cle}"] .fg-etape__tete`);
  await page.waitForTimeout(450);
}
async function ouvrirArcades(page) {
  await ouvrirLigne(page, 'arcade_time');
  const chargee = await attendre(page, () => document.querySelectorAll('.fg-track[data-activity="arcade_time"] .fg-chip').length > 0, 20000);
  await calme(page);
  return chargee;
}
// Une heure posee au doigt, sa plage ouverte, puis le plan qui revient.
async function poser(page, piste, heure) {
  await ouvrirPlage(page, piste, heure);
  const pris = await toucher(page, piste, heure);
  await calme(page);
  return pris;
}
// La derniere demande du plan (ni liste d arcades, ni liste d arrivees).
const dernierPlan = (suivi) => [...suivi.demandes].reverse().find(estPlan) || '';
// Le blocage parti apres les `n` premiers, attendu un instant ; sinon le
// dernier (le meme choix deja bloque ne repart pas).
async function blocageAttendu(suivi, n, ms = 8000) {
  const fin = Date.now() + ms;
  while (suivi.blocages.length <= n && Date.now() < fin) await new Promise((r) => setTimeout(r, 100));
  return suivi.blocages[suivi.blocages.length - 1] || null;
}

// ---------------------------------------------------------------------------
// [A] SANS HEURE D ARCADE CHOISIE, RIEN NE PART DE PLUS
// ---------------------------------------------------------------------------
async function parcoursSimple(browser, mock, reglageMeta) {
  reglage = reglageMeta;
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser);
  const r = { suivi, poses: [] };
  try {
    r.arrive = await versHeures(page, mock, 'f1');
    r.programme = await lireProgramme(page);
    for (const [id, heure] of [['bowling', '14:00'], ['laser_game', '16:00']]) {
      r.poses.push(await toucher(page, id, heure));
      await calme(page);
    }
    await page.click('#goContact');
    r.contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 12000);
  } finally {
    await ctx.close();
    reglage = REGLAGE;
  }
  return r;
}
async function scenarioA(browser, mock) {
  section('A. SANS HEURE D ARCADE CHOISIE, RIEN NE PART DE PLUS');
  const sans = await parcoursSimple(browser, mock, null);
  const avec = await parcoursSimple(browser, mock, REGLAGE);
  const coupe = await parcoursSimple(browser, mock, { ...REGLAGE, arrivalFirst: false });
  const passages = [sans, avec, coupe];
  ok(passages.every((r) => r.arrive && r.poses.length === 2 && r.poses.every(Boolean) && r.contact && r.suivi.erreurs.length === 0),
    'MONTAGE trois passages (meta sans reglage, arrivee proposee, arrivee coupee) : Formule 1, 10 personnes, bowling 14:00 puis laser 16:00, puis les coordonnees, sans erreur',
    passages.map((r) => `${r.arrive}/${r.poses.join(',')}/${r.contact}/${r.suivi.erreurs.slice(0, 1).join('')}`).join(' ; '));
  const demandes = passages.map((r) => sansDoublons(r.suivi.demandes.map((u) => { const p = params(u); p.delete('_'); return p.toString(); })));
  const parasites = passages.flatMap((r) => r.suivi.demandes).filter((u) => ['arrival', 'arrivals', 'arcade', 'arcades'].some((k) => params(u).has(k)));
  ok(parasites.length === 0, 'aucune demande ne porte arrival, arrivals, arcade ni arcades', parasites.slice(0, 2).join(' | '));
  ok(!ecartListes(demandes[0], demandes[1]) && !ecartListes(demandes[0], demandes[2]), 'les demandes sont les memes au caractere pres, que la meta propose l arrivee ou non', ecartListes(demandes[0], demandes[1]) || ecartListes(demandes[0], demandes[2]));
  const blocages = passages.map((r) => r.suivi.blocages[r.suivi.blocages.length - 1] || null);
  ok(blocages.every((b) => b && b.preference && !('arrivalTime' in b.preference) && !('arcadeTime' in b.preference)) && new Set(blocages.map(corpsComparable)).size === 1,
    'le blocage part sans arrivalTime ni arcadeTime, le meme dans les trois passages', JSON.stringify(blocages[0] && blocages[0].preference));
  const p = avec.programme;
  const borne = borneArrivee(p);
  ok(Boolean(borne) && borne.cache && !borne.tete && !ligneDe(p, 'arrivee'), 'l arrivee est une borne (cachee aux lecteurs d ecran, sans en-tete a toucher) : aucune ligne d arrivee a choisir', resumeLignes(p));
}

// ---------------------------------------------------------------------------
// [B] LA BORNE A L OUVERTURE
// ---------------------------------------------------------------------------
async function scenarioB(browser, mock) {
  section('B. LA BORNE A L OUVERTURE');
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    const p = await lireProgramme(page);
    const bowling = ligneDe(p, 'bowling') || {};
    const v = await lireVisite(page);
    const arr = v.etapes.find((e) => e.titre === 'Arrivée conseillée') || {};
    ok(arrive && bowling.heure === '10:00' && (borneArrivee(p) || {}).heure === '10:00' && arr.b === '10:00' && arr.detail === 'à l’ouverture',
      'la Formule 1 proposee a l ouverture (bowling 10:00) : la borne dit 10:00, la visite « Arrivée conseillée 10:00, à l’ouverture »', `${resumeLignes(p)} || ${JSON.stringify(arr)}`);
    const pris = await poser(page, 'bowling', '10:30');
    const p2 = await lireProgramme(page);
    const v2 = await lireVisite(page);
    const arr2 = v2.etapes.find((e) => e.titre === 'Arrivée conseillée') || {};
    ok(pris && (borneArrivee(p2) || {}).heure === '10:20' && arr2.b === '10:20' && arr2.detail === '10 min avant votre bowling',
      'le bowling pose a 10:30 : la borne dit 10:20, « 10 min avant votre bowling »', `${resumeLignes(p2)} || ${JSON.stringify(arr2)}`);
  } finally {
    ok(suivi.erreurs.length === 0, '[B] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [C] LA LIGNE DES ARCADES, FACULTATIVE
// ---------------------------------------------------------------------------
async function scenarioC(browser, mock) {
  section('C. LA LIGNE DES ARCADES, FACULTATIVE');
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    const p = await lireProgramme(page);
    const arc = ligneDe(p, 'arcade_time') || {};
    const bowling = ligneDe(p, 'bowling') || {};
    ok(arrive && arc.heure === 'Facultatif' && /\bis-libre\b/.test(arc.classe) && arc.detail === '30 min · comprises · quand vous voulez' && !arc.ouverte,
      'la Formule 1 a sa ligne des arcades : « Facultatif », « 30 min · comprises · quand vous voulez », fermee', JSON.stringify(arc));
    ok(arc.taille > 0 && bowling.taille > 0 && arc.taille < bowling.taille, `« Facultatif » se lit en petit, plus petit qu une heure (${arc.taille} px contre ${bowling.taille} px)`);
    for (const [id, heure] of [['bowling', '14:00'], ['laser_game', '16:00']]) {
      await poser(page, id, heure);
    }
    const p2 = await lireProgramme(page);
    const ouvertes = p2.lignes.filter((l) => l.ouverte).map((l) => l.cle);
    ok(ouvertes.length === 0, 'le bowling et le laser poses, plus rien ne s ouvre : les arcades attendent qu on les ouvre', `ouvertes : ${ouvertes.join(', ')}`);
    ok(suivi.demandes.filter(estListeArcades).length === 0, 'aucune heure d arcade ne se demande avant l ouverture de leur ligne', suivi.demandes.filter(estListeArcades).slice(0, 1).join(''));
    const chargee = await ouvrirArcades(page);
    const liste = suivi.demandes.filter(estListeArcades);
    const derniere = liste[liste.length - 1] || '';
    ok(chargee && liste.length >= 1 && !params(derniere).has('arrival') && !params(derniere).has('arcade') && posees(derniere).bowling === '14:00',
      'leur ligne ouverte, la liste part (arcades=1), sans arrivee ni heure d arcade, avec les heures posees', derniere);
    const puces = await lirePuces(page, 'arcade_time');
    const heures = puces.map((x) => x.time);
    ok(heures[0] === '10:00' && heures.every((h) => minutesDe(h) % 30 === 0), `leurs heures partent de l ouverture (10:00), demi-heure par demi-heure (${heures.length} heures)`, heures.slice(0, 4).join(', '));
    const p1400 = puces.find((x) => x.time === '14:00') || {};
    const p1300 = puces.find((x) => x.time === '13:00') || {};
    const pourquoi = await lirePourquoi(page, 'arcade_time');
    const ligne1400 = pourquoiDe(pourquoi, '14:00') || {};
    ok(p1400.etat === 'shift' && p1400.ok === 'true' && /^Votre bowling \(14:00\) se replacera autour de vos arcades\.?$/.test(ligne1400.texte || '') && p1300.etat === 'ok' && !p1300.ecrit,
      'arcades a 14:00, sur le bowling pose : elles le decalent, et la ligne le dit ; a 13:00, rien ne coince, aucun mot', JSON.stringify({ p1400, ligne1400, p1300 }));
  } finally {
    ok(suivi.erreurs.length === 0, '[C] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  const quatre = await ouvrir(browser);
  try {
    const arrive4 = await versHeures(quatre.page, mock, 'f4');
    const p4 = await lireProgramme(quatre.page);
    ok(arrive4 && !ligneDe(p4, 'arcade_time') && Boolean(ligneDe(p4, 'bowling')), 'la Formule 4 (sans arcades) n a pas de ligne des arcades', resumeLignes(p4));
  } finally {
    ok(quatre.suivi.erreurs.length === 0, '[C] Formule 4 : aucune erreur JavaScript', quatre.suivi.erreurs.slice(0, 3).join(' | '));
    await quatre.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [D] DES ARCADES A 13:00
// ---------------------------------------------------------------------------
async function scenarioD(browser, mock) {
  section('D. DES ARCADES A 13:00');
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await ouvrirArcades(page);
    const nListes = suivi.demandes.filter(estListeArcades).length;
    const pris = await poser(page, 'arcade_time', '13:00');
    const demande = dernierPlan(suivi);
    ok(arrive && pris && params(demande).get('arcade') === '13:00' && !params(demande).has('arrival'), 'la demande du plan porte arcade=13:00, sans arrivee', demande);
    const p = await lireProgramme(page);
    const premiere = p.lignes.find((l) => l.cle) || {};
    ok((borneArrivee(p) || {}).heure === '12:50' && premiere.cle === 'arcade_time' && premiere.heure === '13:00' && /\bis-choisi\b/.test(premiere.classe) && (ligneDe(p, 'bowling') || {}).heure === '13:30',
      'la borne dit 12:50, la ligne des arcades passe en tete (13:00, choisie), le bowling se propose a 13:30', resumeLignes(p));
    const v = await lireVisite(page);
    const arr = v.etapes.find((e) => e.titre === 'Arrivée conseillée') || {};
    const arcades = v.etapes.find((e) => e.b === '13:00' && /arcade/i.test(e.titre)) || {};
    ok(arr.b === '12:50' && arr.detail === '10 min avant vos arcades' && /jusqu’à 13:30/.test(arcades.detail || '') && /à votre heure/.test(arcades.detail || ''),
      'la visite : « Arrivée conseillée 12:50, 10 min avant vos arcades », puis les arcades de 13:00 a 13:30, a votre heure', JSON.stringify({ arr, arcades }));
    // Le bowling pose a 14:00 change les heures posees : la liste des arcades
    // se relit a leur ouverture, sans l heure choisie (elle n en depend pas).
    const bowling = await poser(page, 'bowling', '14:00');
    await ouvrirArcades(page);
    const listes = suivi.demandes.filter(estListeArcades).slice(nListes);
    ok(bowling && listes.length >= 1 && posees(listes[listes.length - 1]).bowling === '14:00' && listes.every((u) => !params(u).has('arcade')) && params(dernierPlan(suivi)).get('arcade') === '13:00',
      'le bowling pose a 14:00, la liste des heures d arcade se relit sans l heure choisie ; le plan, lui, la garde (13:00)', listes.slice(-1).join(''));
    // Retouchee, l heure se retire : les arcades redeviennent facultatives.
    await poser(page, 'arcade_time', '13:00');
    const retire = dernierPlan(suivi);
    const pR = await lireProgramme(page);
    ok(!params(retire).has('arcade') && (ligneDe(pR, 'arcade_time') || {}).heure === 'Facultatif', 'retouchee, l heure d arcade se retire : la demande repart sans elle, la ligne redit « Facultatif »', `${retire} || ${resumeLignes(pR)}`);
    await ouvrirArcades(page);
    await poser(page, 'arcade_time', '13:00');
    const nB = suivi.blocages.length;
    await page.click('#goContact');
    const contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 12000);
    const bloc = await blocageAttendu(suivi, nB);
    ok(contact && Boolean(bloc && bloc.preference) && bloc.preference.arcadeTime === '13:00' && !('arrivalTime' in bloc.preference),
      'le blocage part avec les arcades (13:00), sans heure d arrivee', JSON.stringify(bloc && bloc.preference));
    const rappel = lisible(await page.evaluate(() => (document.querySelector('#recallBody') || {}).textContent || ''));
    ok(/Arrivée conseillée à 12:50/.test(rappel), 'le recapitulatif dit « Arrivée conseillée à 12:50 »', rappel.slice(0, 200));
  } finally {
    ok(suivi.erreurs.length === 0, '[D] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [E] LE DERNIER CHOIX GAGNE
// ---------------------------------------------------------------------------
async function scenarioE(browser, mock) {
  section('E. LE DERNIER CHOIX GAGNE');
  semer(mock);
  const un = await ouvrir(browser);
  try {
    const arrive = await versHeures(un.page, mock, 'f1');
    const pose = await poser(un.page, 'bowling', '14:00');
    await ouvrirArcades(un.page);
    const pris = await poser(un.page, 'arcade_time', '14:00');
    const demande = dernierPlan(un.suivi);
    const p = await lireProgramme(un.page);
    ok(arrive && pose && pris && params(demande).get('arcade') === '14:00' && !posees(demande).bowling && (ligneDe(p, 'arcade_time') || {}).heure === '14:00' && (ligneDe(p, 'bowling') || {}).heure !== '14:00',
      'des arcades a 14:00 sur le bowling pose : le bowling se libere (la demande ne le pose plus), le serveur le replace ailleurs', `${demande} || ${resumeLignes(p)}`);
    const v = await lireVisite(un.page);
    const bowling = v.etapes.find((e) => /bowling/i.test(e.titre)) || {};
    ok(/replacé autour de vos arcades \(14:00\)/.test(bowling.detail || ''), 'la visite dit le bowling « replacé autour de vos arcades (14:00) »', JSON.stringify(bowling));
  } finally {
    ok(un.suivi.erreurs.length === 0, '[E] aucune erreur JavaScript (arcades sur le bowling)', un.suivi.erreurs.slice(0, 3).join(' | '));
    await un.ctx.close();
  }
  const deux = await ouvrir(browser);
  try {
    const arrive = await versHeures(deux.page, mock, 'f1');
    await ouvrirArcades(deux.page);
    await poser(deux.page, 'arcade_time', '13:00');
    // Le bowling pose a 15:00 : la grille du laser porte deux problemes dans
    // l apres-midi, les arcades (13:00) et le bowling (15:00), deux lignes de
    // deux teintes.
    const bowling15 = await poser(deux.page, 'bowling', '15:00');
    await ouvrirLigne(deux.page, 'laser_game');
    await ouvrirPlage(deux.page, 'laser_game', '13:00');
    const lasers = await lirePuces(deux.page, 'laser_game');
    const l1300 = lasers.find((x) => x.time === '13:00') || {};
    const l1500 = lasers.find((x) => x.time === '15:00') || {};
    ok(arrive && bowling15 && l1300.etat === 'shift' && l1500.etat === 'shift', 'MONTAGE arcades 13:00 et bowling 15:00 : le laser a 13:00 decale les arcades, a 15:00 le bowling', JSON.stringify({ l1300, l1500 }));
    const couleurs = await problemesEnCouleur(deux.page, 'arcades a 13:00 et bowling a 15:00, la grille du laser');
    ok(couleurs.deuxLignes >= 1, `[J] une plage au moins porte deux lignes (${couleurs.deuxLignes}) : leurs teintes se comparent`);
    await ouvrirLigne(deux.page, 'bowling');
    await ouvrirPlage(deux.page, 'bowling', '13:00');
    const puces = await lirePuces(deux.page, 'bowling');
    const b1230 = puces.find((x) => x.time === '12:30') || {};
    const b1300 = puces.find((x) => x.time === '13:00') || {};
    const ligne = pourquoiDe(await lirePourquoi(deux.page, 'bowling'), '13:00') || {};
    ok(b1230.etat === 'shift' && b1300.etat === 'shift' && b1300.ok === 'true' && /^Vos arcades \(13:00\) se feront à un autre moment\.?$/.test(ligne.texte || ''),
      'arcades a 13:00 : le bowling a 12:30 et 13:00 les decale, se prend, et la ligne dit « Vos arcades (13:00) se feront à un autre moment »', JSON.stringify({ b1230, b1300, ligne }));
    const pris = await poser(deux.page, 'bowling', '13:00');
    const demande = dernierPlan(deux.suivi);
    const p = await lireProgramme(deux.page);
    ok(pris && posees(demande).bowling === '13:00' && !params(demande).has('arcade') && (ligneDe(p, 'arcade_time') || {}).heure === 'Facultatif',
      'le bowling pris a 13:00 leve les arcades : la demande part sans elles, leur ligne redit « Facultatif »', `${demande} || ${resumeLignes(p)}`);
    const v = await lireVisite(deux.page);
    const arcades = v.etapes.find((e) => /arcades/i.test(e.titre) && !e.b) || {};
    ok(/déplacées pour votre bowling à 13:00/.test(arcades.detail || ''), 'la visite dit les arcades « déplacées pour votre bowling à 13:00 »', JSON.stringify(arcades));
  } finally {
    ok(deux.suivi.erreurs.length === 0, '[E] aucune erreur JavaScript (bowling sur les arcades)', deux.suivi.erreurs.slice(0, 3).join(' | '));
    await deux.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [F] LE TEMPS LIBRE QUI PROPOSE LES ARCADES
// ---------------------------------------------------------------------------
async function scenarioF(browser, mock) {
  section('F. LE TEMPS LIBRE QUI PROPOSE LES ARCADES');
  semer(mock);
  const un = await ouvrir(browser);
  try {
    const arrive = await versHeures(un.page, mock, 'f1');
    await poser(un.page, 'bowling', '11:00');
    await poser(un.page, 'laser_game', '12:30');
    const libres = await lireLibres(un.page);
    const cadre = libres[0] || {};
    const idee = (cadre.actions || [])[0] || {};
    ok(arrive && libres.length === 1 && /^30 min de libre/.test(cadre.quoi) && cadre.choixCache && idee.arcades === '12:00' && idee.titre === 'Y faire vos arcades' && idee.detail === 'de 12:00 à 12:30',
      'bowling 11:00, laser 12:30 : la demi-heure libre devient un cadre en pointille, replie, qui propose « Y faire vos arcades, de 12:00 à 12:30 »', JSON.stringify(libres));
    await un.page.click('#planZone [data-libre]');
    await un.page.waitForTimeout(300);
    const ouvert = (await lireLibres(un.page))[0] || {};
    ok(ouvert.ouvert && !ouvert.choixCache, 'touche, le cadre se deplie sur place', JSON.stringify(ouvert));
    await un.page.click('#planZone [data-libre-arcades="12:00"]');
    await calme(un.page);
    const demande = dernierPlan(un.suivi);
    const p = await lireProgramme(un.page);
    const v = await lireVisite(un.page);
    ok(params(demande).get('arcade') === '12:00' && (ligneDe(p, 'arcade_time') || {}).heure === '12:00' && v.etapes.some((e) => e.b === '12:00' && /arcade/i.test(e.titre)) && (await lireLibres(un.page)).length === 0,
      'l idee touchee pose les arcades a 12:00 : la demande, leur ligne et la visite le disent, le cadre disparait', `${demande} || ${resumeLignes(p)}`);
  } finally {
    ok(un.suivi.erreurs.length === 0, '[F] aucune erreur JavaScript', un.suivi.erreurs.slice(0, 3).join(' | '));
    await un.ctx.close();
  }
  // Des arcades qui ont deja leur heure ne se proposent pas ailleurs.
  const deux = await ouvrir(browser);
  try {
    await versHeures(deux.page, mock, 'f1');
    await poser(deux.page, 'bowling', '11:00');
    await poser(deux.page, 'laser_game', '12:30');
    await ouvrirArcades(deux.page);
    const pris = await poser(deux.page, 'arcade_time', '10:30');
    const p = await lireProgramme(deux.page);
    ok(pris && (ligneDe(p, 'arcade_time') || {}).heure === '10:30' && (borneArrivee(p) || {}).heure === '10:20', 'MONTAGE arcades a 10:30, avant le bowling de 11:00 : leur ligne le dit, l arrivee 10:20', resumeLignes(p));
    const libres = await lireLibres(deux.page);
    const v = await lireVisite(deux.page);
    ok(libres.length === 0 && v.attentes.some((a) => /30 min d’attente/.test(a.texte)), 'arcades deja a 10:30 : la demi-heure libre de 12:00 reste une attente, rien a proposer', JSON.stringify({ libres, attentes: v.attentes }));
  } finally {
    ok(deux.suivi.erreurs.length === 0, '[F] aucune erreur JavaScript (arcades deja posees)', deux.suivi.erreurs.slice(0, 3).join(' | '));
    await deux.ctx.close();
  }
  // Le minigolf de la Formule 2 couvre le temps libre entre ses deux parties.
  const trois = await ouvrir(browser);
  try {
    const arrive = await versHeures(trois.page, mock, 'f2');
    const p0 = await lireProgramme(trois.page);
    const parties = p0.lignes.filter((l) => /^laser_game#/.test(l.cle)).map((l) => l.cle);
    await ouvrirLigne(trois.page, parties[0] || 'laser_game#1');
    await poser(trois.page, 'laser_game', '10:30');
    await ouvrirLigne(trois.page, parties[1] || 'laser_game#2');
    await poser(trois.page, 'laser_game', '11:30');
    const demande = dernierPlan(trois.suivi);
    const parts = JSON.parse(params(demande).get('laserGameTimes') || '[]');
    const libres = await lireLibres(trois.page);
    const v = await lireVisite(trois.page);
    ok(arrive && JSON.stringify(parts) === JSON.stringify(['10:30', '11:30']), 'MONTAGE Formule 2 : les deux parties de laser posees a 10:30 et 11:30', demande);
    ok(libres.length === 0 && v.attentes.some((a) => /35 min d’attente/.test(a.texte)), 'le minigolf couvre les 35 min entre les deux parties : aucun cadre, rien a proposer', JSON.stringify({ libres, attentes: v.attentes }));
  } finally {
    ok(trois.suivi.erreurs.length === 0, '[F] Formule 2 : aucune erreur JavaScript', trois.suivi.erreurs.slice(0, 3).join(' | '));
    await trois.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [G] AU TELEPHONE (360 PX)
// ---------------------------------------------------------------------------
async function scenarioG(browser, mock) {
  section('G. AU TELEPHONE (360 PX)');
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser, { largeur: 360, hauteur: 780 });
  const posee = () => attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running'), 4000);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    const chargee = await ouvrirArcades(page);
    await posee();
    const m = await page.evaluate(() => {
      const visibles = [...document.querySelectorAll('.fg-track[data-activity="arcade_time"] .fg-chip')].filter((c) => c.getClientRects().length && c.getBoundingClientRect().height > 0);
      const tete = document.querySelector('#hourZone .fg-etape[data-cle="arcade_time"] .fg-etape__tete');
      return {
        n: visibles.length,
        hauteur: Math.min(...visibles.map((c) => c.getBoundingClientRect().height)),
        largeurPuce: Math.min(...visibles.map((c) => c.getBoundingClientRect().width)),
        tete: tete ? tete.getBoundingClientRect().height : 0,
        page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        ecran: window.innerWidth,
      };
    });
    ok(arrive && chargee && m.n > 0, `MONTAGE les heures d arcade s affichent a 360 px (${m.n} visibles)`);
    ok(m.page <= m.ecran, `rien ne deborde a 360 px (${m.page} px de large pour ${m.ecran})`);
    ok(m.hauteur >= 44 && m.largeurPuce >= 44 && m.tete >= 44, `les heures d arcade et leur ligne se touchent du doigt (44 px au moins : puce ${Math.round(m.hauteur)} x ${Math.round(m.largeurPuce)}, ligne ${Math.round(m.tete)})`);
    const forme = await page.evaluate(() => {
      const decrire = (c) => {
        if (!c) return '';
        const lb = c.closest('[role="listbox"]');
        return [c.tagName, c.getAttribute('type'), c.getAttribute('role'), c.hasAttribute('aria-selected'), Boolean(lb && lb.getAttribute('aria-label'))].join('|');
      };
      return { arcades: decrire(document.querySelector('.fg-track[data-activity="arcade_time"] .fg-chip')), bowling: decrire(document.querySelector('.fg-track[data-activity="bowling"] .fg-chip')) };
    });
    ok(Boolean(forme.arcades) && forme.arcades === forme.bowling && forme.arcades.startsWith('BUTTON|button|option|true|true'), 'une heure d arcade est le meme bouton qu une heure de bowling (type, role, aria-selected, liste nommee)', JSON.stringify(forme));
    await page.focus('#hourZone .fg-etape[data-cle="arcade_time"] .fg-etape__tete');
    let focus = null;
    for (let k = 0; k < 20 && !(focus && focus.puce); k += 1) {
      await page.keyboard.press('Tab');
      focus = await page.evaluate(() => {
        const f = document.activeElement;
        const s = f ? getComputedStyle(f) : null;
        return { puce: Boolean(f && f.matches('.fg-track[data-activity="arcade_time"] .fg-chip')), style: s ? s.outlineStyle : '', largeur: s ? parseFloat(s.outlineWidth) || 0 : 0 };
      });
    }
    ok(Boolean(focus && focus.puce) && focus.style !== 'none' && focus.largeur >= 2, 'au clavier, l heure d arcade qui a le focus se voit (contour)', JSON.stringify(focus));
  } finally {
    ok(suivi.erreurs.length === 0, '[G] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [H] UNE HEURE PAR PARTIE DE LASER
// ---------------------------------------------------------------------------
// La fin d une partie dans le dernier plan recu (ses groupes compris), celle
// qui commence a `debut`.
function finDePartie(suivi, debut) {
  const plan = [...suivi.reponses].reverse().find((r) => estPlan(r.url));
  const blocs = ((((plan && plan.json && plan.json.slots) || [])[0] || {}).opsPlan || {}).resourceBlocks || [];
  const laser = blocs.filter((b) => b && b.activityId === 'laser_game');
  const tete = laser.find((b) => b.startTime === debut);
  if (!tete) return '';
  return laser.filter((b) => (Number(b.countIndex) || 1) === (Number(tete.countIndex) || 1)).map((b) => String(b.endTime || '')).sort().pop() || '';
}
// L heure qu une ligne de partie doit proposer : la premiere libre (rien de
// serre) apres la fin de la partie d avant, sans heure deja prise.
const premiereLibreApres = (puces, fin) => (puces.find((c) => c.ok !== 'false' && c.etat === 'ok' && !c.on && minutesDe(c.time) >= minutesDe(fin)) || {}).time || '';
async function plageOuverteDe(page, heure) {
  return page.evaluate((h) => {
    const c = document.querySelector(`.fg-track[data-activity="laser_game"] .fg-chip[data-time="${h}"]`);
    const sec = c && c.closest('.fg-period');
    return Boolean(sec && sec.classList.contains('is-open') && c.getClientRects().length);
  }, heure);
}
async function scenarioH(browser, mock) {
  section('H. UNE HEURE PAR PARTIE DE LASER');
  semer(mock);
  const un = await ouvrir(browser);
  try {
    const arrive = await versHeures(un.page, mock, 'f2');
    const p0 = await lireProgramme(un.page);
    const h1 = (ligneDe(p0, 'laser_game#1') || {}).heure || '';
    const fin1 = finDePartie(un.suivi, h1);
    ok(arrive && /^\d\d:\d\d$/.test(h1) && Boolean(fin1) && (ligneDe(p0, 'laser_game#2') || {}).heure === 'À choisir',
      `MONTAGE Formule 2, rien de pose : la partie 1 proposee a ${h1} (jusqu a ${fin1}), la partie 2 a choisir`, resumeLignes(p0));
    await ouvrirLigne(un.page, 'laser_game#2');
    const puces = await lirePuces(un.page, 'laser_game');
    const proposees = puces.filter((c) => c.prop).map((c) => c.time);
    const attendue = premiereLibreApres(puces, fin1);
    ok(Boolean(attendue) && proposees.length === 1 && proposees[0] === attendue && proposees[0] !== h1,
      `ouverte a la main, la ligne de la partie 2 propose SA premiere heure libre apres la partie 1 (${attendue}), jamais celle de la partie 1 (${h1})`, `proposees ${proposees.join(',') || 'aucune'}`);
    const pris = await poser(un.page, 'laser_game', attendue);
    const parts = JSON.parse(params(dernierPlan(un.suivi)).get('laserGameTimes') || '[]');
    const p1 = await lireProgramme(un.page);
    const l1 = ligneDe(p1, 'laser_game#1') || {};
    const l2 = ligneDe(p1, 'laser_game#2') || {};
    ok(pris && JSON.stringify(parts) === JSON.stringify([h1, attendue]) && l1.heure === h1 && /is-choisi/.test(l1.classe) && l2.heure === attendue && /is-choisi/.test(l2.classe),
      `touchee dans la ligne 2, ${attendue} est l heure de la partie 2 : la partie 1 garde ${h1}, la demande porte les deux`, `${JSON.stringify(parts)} || ${resumeLignes(p1)}`);
  } finally {
    ok(un.suivi.erreurs.length === 0, '[H] aucune erreur JavaScript (ligne 2 ouverte a la main)', un.suivi.erreurs.slice(0, 3).join(' | '));
    await un.ctx.close();
  }
  // L enchainement : la partie 1 posee, la ligne 2 s ouvre seule et propose
  // la suite, sur la plage de cette heure (une partie le matin, la suivante a
  // midi).
  semer(mock);
  const deux = await ouvrir(browser);
  try {
    await versHeures(deux.page, mock, 'f2');
    const pris = await poser(deux.page, 'laser_game', '11:30');
    const fin1 = finDePartie(deux.suivi, '11:30');
    const p = await lireProgramme(deux.page);
    const puces = await lirePuces(deux.page, 'laser_game');
    const attendue = premiereLibreApres(puces, fin1);
    const proposees = puces.filter((c) => c.prop).map((c) => c.time);
    const une = puces.find((c) => c.time === '11:30') || {};
    ok(pris && (ligneDe(p, 'laser_game#2') || {}).ouverte && Boolean(attendue) && proposees.length === 1 && proposees[0] === attendue && une.on && une.ecrit === 'partie 1',
      `la partie 1 posee a 11:30, la ligne 2 s ouvre seule et propose ${attendue} (apres ${fin1}) ; 11:30 s y lit « partie 1 »`, `${resumeLignes(p)} || proposees ${proposees.join(',') || 'aucune'}`);
    ok(await plageOuverteDe(deux.page, attendue), `la plage ouverte dans la ligne 2 est celle de ${attendue}, pas celle de la partie 1`);
  } finally {
    ok(deux.suivi.erreurs.length === 0, '[H] aucune erreur JavaScript (enchainement)', deux.suivi.erreurs.slice(0, 3).join(' | '));
    await deux.ctx.close();
  }
}

const SCENARIOS = [['A', scenarioA], ['B', scenarioB], ['C', scenarioC], ['D', scenarioD], ['E', scenarioE], ['F', scenarioF], ['G', scenarioG], ['H', scenarioH]];

async function main() {
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const server = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    for (const [cle, jouer] of SCENARIOS) {
      if (SEULEMENT.length && !SEULEMENT.includes(cle)) continue;
      try {
        await jouer(browser, mock);
      } catch (error) {
        ok(false, `[${cle}] le parcours va jusqu au bout`, String((error && error.message) || error).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8).join(' | '));
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) {
    console.error(`\nformules-arrivee-form-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nformules-arrivee-form-check: ALL OK (l arrivee est une borne, a l heure pile a l ouverture ; les arcades facultatives se posent, decalent et se proposent dans le temps libre ; chaque partie de laser propose son heure)');
  process.exit(0);
}

function contreEpreuves() {
  const fichiers = [...new Set([JS, CSS, 'fungalaxy.html', ...MUTATIONS.map((m) => m.fichier)])];
  const empreintes = new Map(fichiers.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  let defauts = 0;
  MUTATIONS.forEach((mutation, index) => {
    const r = spawnSync(process.execPath, [__filename], {
      env: { ...process.env, PINLANE_ARRIVEE_FORM_MUTATION: String(index + 1), PINLANE_ARRIVEE_FORM_SCENARIOS: mutation.scenarios.join(',') },
      encoding: 'utf8',
      timeout: 300000,
    });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const servie = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
    const rouges = sortie.split('\n').filter((l) => l.startsWith('FAIL')).length;
    if (r.status === 2 || !servie) {
      defauts += 1;
      console.error(`contre-epreuve DESARMEE : ${mutation.nom} (${r.status === 2 ? 'ancre introuvable' : 'mutation non servie'})`);
    } else if (r.status === null) {
      defauts += 1;
      console.error(`contre-epreuve INTERROMPUE : ${mutation.nom} (delai depasse)`);
    } else if (r.status !== 1 || !rouges) {
      defauts += 1;
      console.error(`contre-epreuve MUETTE : le gate reste vert quand ${mutation.nom}.`);
    } else {
      console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom} (${rouges} FAIL, scenario ${mutation.scenarios.join('+')}).`);
    }
  });
  const touches = [...empreintes].filter(([f, avant]) => fs.readFileSync(path.join(ROOT, f), 'utf8') !== avant);
  if (touches.length) {
    defauts += 1;
    console.error(`un fichier a ete ecrit : ${touches.map(([f]) => f).join(', ')}`);
  }
  if (defauts) {
    console.error(`\nformules-arrivee-form-check --mutate: ${defauts} defaut(s).`);
    process.exit(1);
  }
  console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et aucun fichier n a ete ecrit.`);
}

if (process.argv.includes('--mutate')) {
  contreEpreuves();
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}

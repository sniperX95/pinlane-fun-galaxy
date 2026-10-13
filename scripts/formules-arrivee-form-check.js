'use strict';
// LA FORMULE PAR HEURE D ARRIVEE, A L ECRAN DU CLIENT (2026-10-13).
//
// Le gerant de Libramont, le 12/10 : un groupe de 10 veut venir a 10:00, le
// bowling et le laser sont pleins de 10:00 a 12:00, la formule a 30 min
// d arcades a faire pendant ce temps. Movsar, le 13/10 : « pour les formules
// ils peuvent choisir heure pour arcade aussi comme ca ils peuvent venir a
// 10 h ». Le serveur le sait depuis 1a76bce (scripts/formules-arrivee-check.js) ;
// ce gate prouve l ecran, dans le navigateur, sur le mock du depot (le vrai
// gestionnaire des disponibilites sur un instantane en memoire : aucune base,
// rien d ecrit, rien d envoye) :
//   [A] sans heure d arrivee choisie, rien ne change : les demandes de la
//       formule et le blocage sont les memes au caractere pres, l option
//       proposee ou non ; sans reglage dans la meta, ou arrivalFirst false,
//       la ligne reste la borne d arrivee d avant ;
//   [B] la liste des heures d arrivee ne part qu a l ouverture de sa ligne ;
//       chaque heure dit si elle tient et sinon pourquoi (le mot court, une
//       ligne par cause sous la plage, la phrase longue du serveur en titre) ;
//       une heure choisie pose le bowling et le laser du serveur ; « Choisir
//       l’heure moi-même » rend les heures des activites ;
//   [C] arriver a 10:00 quand tout est pris jusqu a 10:30 : les arcades a
//       10:00, le bowling a 10:30, le laser apres, la fin du serveur ; 10:00
//       partout, jamais l accueil dix minutes avant ; le blocage et la
//       reservation partent avec preference.arrivalTime ; le recapitulatif et
//       l ecran final disent « Arrivée à 10:00 » ;
//   [D] une formule sans arcades (Formule 4) commence par son minigolf et ne
//       promet aucune arcade ; une arrivee dont la visite deborde la fermeture
//       se dit « serré », avec la raison du moteur ;
//   [E] le centre coupe l arrivee (arrivalBounds.arrivalFirst false, dans la
//       liste ou dans le plan) : l option disparait, l arrivee choisie tombe ;
//   [F] une arrivee prise entre la liste et le choix : le refus du serveur,
//       la liste relue, l arrivee suivante proposee d un toucher ;
//   [G] au telephone (360 px) : rien ne deborde, des cibles de 44 px, le
//       focus se voit, les memes boutons que les heures des activites.
//   --mutate : une regle cassee a la fois, en memoire (le formulaire servi au
//       navigateur, ou le moteur compile pour le serveur) : chacune doit faire
//       rougir le gate ; le disque n est jamais ecrit, et on le verifie.
//   --base <commit> : [A] rejoue aussi le formulaire de ce commit, ses
//       demandes et son blocage doivent etre ceux d aujourd hui.
//
// Lancement : node scripts/formules-arrivee-form-check.js [--mutate] [--base <commit>]

const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { spawnSync, execFileSync } = require('child_process');

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
const ARGS = process.argv.slice(2);
const BASE_COMMIT = (() => {
  const rang = ARGS.indexOf('--base');
  return rang >= 0 ? String(ARGS[rang + 1] || '').trim() : '';
})();
const SEULEMENT = String(process.env.PINLANE_ARRIVEE_FORM_SCENARIOS || '').split(',').map((s) => s.trim()).filter(Boolean);
// Le reglage que la meta publique donne au formulaire (api/public-booking-meta,
// lib/formula-visit) : ses valeurs par defaut, l arrivee proposee.
const REGLAGE = { arrivalFirst: true, maxWaitMinutes: 30, maxVisitMinutes: 0, freeDurationPolicy: 'default' };
const COUPEE = 'La réservation par heure d’arrivée n’est pas proposée par ce centre.';
const JS = 'assets/fungalaxy-booking.js';

// ---------------------------------------------------------------------------
// LES CONTRE-EPREUVES : une regle cassee chacune, et les scenarios qui la
// voient. Le formulaire est servi casse au navigateur ; le moteur est compile
// casse, avant tout require du serveur. Le disque n est jamais ecrit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'l option n est jamais proposee', fichier: JS, scenarios: ['A'],
    de: "    return state.onglet === 'formules' && ancres.length > 0 && Boolean(v && v.arrivalFirst === true) && !(b && b.arrivalFirst === false);",
    vers: '    return false;' },
  { nom: 'la meta du centre n est plus lue (l option sans reglage, ou coupee)', fichier: JS, scenarios: ['A'],
    de: 'Boolean(v && v.arrivalFirst === true)', vers: 'true' },
  { nom: 'les bornes du serveur n effacent plus l option', fichier: JS, scenarios: ['E'],
    de: ' && !(b && b.arrivalFirst === false);', vers: ';' },
  { nom: 'la liste des arrivees part des l arrivee sur les heures', fichier: JS, scenarios: ['A'],
    de: '    if (ancres.length) { majPistes(d); majEtapes(d); rendreArrivees(); }',
    vers: '    if (ancres.length) { majPistes(d); majEtapes(d); if (avecArrivee) chargerArrivees(); }' },
  { nom: 'une demande sans arrivee porte un parametre de plus', fichier: JS, scenarios: ['A'],
    de: "    if (state.arrivee) q.set('arrival', state.arrivee);", vers: "    q.set('arrival', state.arrivee);" },
  { nom: 'l heure d arrivee choisie ne part pas au serveur', fichier: JS, scenarios: ['C'],
    de: "    if (state.arrivee) q.set('arrival', state.arrivee);", vers: '    void 0;' },
  { nom: 'l arrivee dite est l accueil dix minutes avant', fichier: JS, scenarios: ['C'],
    de: "  function arriveeDe(plan) { return (plan && plan.arrivalPlan && plan.arrivalPlan.arrivalTime) || (plan && plan.arrivalTime) || ''; }",
    vers: "  function arriveeDe(plan) { return (plan && plan.arrivalTime) || ''; }" },
  { nom: 'le recapitulatif dit « Arrivée conseillée » pour une arrivee choisie', fichier: JS, scenarios: ['C'],
    de: "(plan.arrivalPlan ? 'Arrivée à' : 'Arrivée conseillée à')", vers: "'Arrivée conseillée à'" },
  { nom: 'l ecran final dit « Arrivée conseillée » pour une arrivee choisie', fichier: JS, scenarios: ['C'],
    de: "    if (planFin.arrivalPlan) quand = quand.replace('Arrivée conseillée à', 'Arrivée à');", vers: '    void 0;' },
  { nom: 'la reservation part sans l heure d arrivee', fichier: JS, scenarios: ['C'],
    de: '      base.preference.arrivalTime = state.arrivee;', vers: '      void 0;' },
  { nom: 'la demande de reservation change sans arrivee choisie', fichier: JS, scenarios: ['A'],
    de: '    if (state.arrivee) {\n      base.preference.arrivalTime = state.arrivee;',
    vers: '    if (true) {\n      base.preference.arrivalTime = state.arrivee;' },
  { nom: 'la visite ne se lit plus dans l ordre de la frise (les arcades perdent leur ligne)', fichier: JS, scenarios: ['C'],
    de: '    ((parArrivee && parArrivee.frise) || []).forEach(function (s) {', vers: '    ([]).forEach(function (s) {' },
  { nom: 'la fin de la visite ne vient plus du serveur', fichier: JS, scenarios: ['C'],
    de: "    var fin = journee ? '' : (slot.visitEndTime || plan.endTime || '');", vers: "    var fin = journee ? '' : (plan.endTime || '');" },
  { nom: 'le programme perd ses lignes quand une arrivee est choisie', fichier: JS, scenarios: ['C'],
    de: '    return (d && d.anchors) || (state.arrivee && grilleSansArrivee && grilleSansArrivee.cle === cleDemande() && grilleSansArrivee.anchors) || {};',
    vers: '    return (d && d.anchors) || {};' },
  { nom: 'le bowling et le laser gardent les heures d une demande sans arrivee', fichier: JS, scenarios: ['D'],
    de: 'defauts = (state.arrivee ? plan0.anchorPlan && plan0.anchorPlan.times : a0.defaultTimes) || {};', vers: 'defauts = a0.defaultTimes || {};' },
  { nom: 'la ligne d arrivee promet des arcades a toute formule', fichier: JS, scenarios: ['D'],
    de: "'À votre heure : ' + nomBas(libres[0].label) + ' en attendant '", vers: "'À votre heure : arcades en attendant '" },
  { nom: 'une arrivee refusee pour l attente perd son mot court', fichier: JS, scenarios: ['B'],
    de: "    arrival_wait: 'attente', arrival_visit: 'trop long', arrival_full: 'complet' };", vers: "    arrival_visit: 'trop long', arrival_full: 'complet' };" },
  { nom: 'la ligne sous la plage ne dit plus l attente en fourchette', fichier: JS, scenarios: ['B'],
    de: '    if (x && x.minutes) {', vers: '    if (false) {' },
  { nom: 'la phrase longue du serveur n est plus en titre', fichier: JS, scenarios: ['B'],
    de: "      if (refus && x.reason) chip.setAttribute('title', x.reason);", vers: '      void 0;' },
  { nom: '« Choisir l’heure moi-même » garde l arrivee', fichier: JS, scenarios: ['B'],
    de: "      state.arrivee = '';\n      etapeOuverte = ligneS.dataset.cle; etapeTouchee = true;", vers: '      etapeOuverte = ligneS.dataset.cle; etapeTouchee = true;' },
  { nom: 'une arrivee choisie reste quand le centre la coupe', fichier: JS, scenarios: ['E'],
    de: '    if (state.arrivee && j.arrivalBounds && j.arrivalBounds.arrivalFirst === false) {', vers: '    if (false) {' },
  { nom: 'la puce d arrivee ignore l avertissement du moteur', fichier: JS, scenarios: ['D'],
    de: 'reason: court, warning: x.warning }', vers: 'reason: court }' },
  { nom: 'la liste des arrivees perd l avertissement de la porte (serveur)', fichier: 'lib/ops-engine.js', scenarios: ['D'],
    de: '    ...(choix.result.warning ? { warning: choix.result.warning } : {}),', vers: '    ...({}),' },
  { nom: 'une arrivee refusee laisse la liste perimee', fichier: JS, scenarios: ['F'],
    de: "    if (state.arrivee && !slot && arrivees.liste) { arrivees.lu = 0; if (etapeOuverte === 'arrivee') chargerArrivees(); }", vers: '    void 0;' },
  { nom: 'le refus d une arrivee ne propose plus la suivante', fichier: JS, scenarios: ['F'],
    de: '      if (versA) {', vers: '      if (false) {' },
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
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const minuscule = (s) => { const t = String(s || ''); return t.charAt(0).toLowerCase() + t.slice(1); };
const heureAffichee = (t) => (t === '24:00' ? 'minuit' : String(t || ''));
const params = (u) => new URL(u, BASE_URL).searchParams;
const estListe = (u) => params(u).get('arrivals') === '1';
const sansDoublons = (liste) => liste.filter((x, i) => liste.indexOf(x) === i);
const minutesDe = (h) => { const [a, b] = String(h || '').split(':').map(Number); return a * 60 + b; };
const heureDe = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// Une duree comme le moteur et le formulaire l ecrivent : 50 min, 1 h 20, 2 h.
function libelleDuree(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60), r = total % 60;
  return !h ? `${r} min` : `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}`;
}
// Le premier ecart entre deux listes de demandes.
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
// scenario ; le formulaire casse (contre-epreuve) ou celui d un commit
// (--base) est servi a la place de celui du depot.
// ---------------------------------------------------------------------------
let reglage = REGLAGE;   // le reglage de la meta (null : la cle absente, comme un serveur d avant)
let servirAncien = '';   // le formulaire d un commit (--base)
let prochainId = 9100;
// Les huit pistes et l arene (30 armes) prises sur [debut, fin).
function pleines(date, debut, fin) {
  const dossiers = [];
  const duree = (minutesDe(fin) - minutesDe(debut)) / 60;
  for (let piste = 1; piste <= 8; piste += 1) {
    prochainId += 1;
    dossiers.push({ id: prochainId, centerId: 'libramont', date, startTime: debut, duration: duree, totalDuration: duree, pax: 6, lanes: [piste], laneCount: 1, type: 'bowling', status: 'confirmed', validationStatus: 'confirmed', program: null, opsPlan: null, name: 'Groupe' });
  }
  for (let t = minutesDe(debut); t < minutesDe(fin); t += 30) {
    prochainId += 1;
    dossiers.push({ id: prochainId, centerId: 'libramont', date, startTime: heureDe(t), duration: 0.5, pax: 30, type: 'laser', status: 'confirmed', validationStatus: 'confirmed', program: null, name: 'Groupe',
      opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena', activityId: 'laser_game', start: t, end: t + 25, startTime: heureDe(t), endTime: heureDe(t + 25), players: 30 }] } });
  }
  return dossiers;
}
function semer(mock, plages) {
  mock.blocagesDev.clear();
  mock.occupationDev.length = 0;
  mock.dernierePose.body = null;
  mock.dernierePose.blocages.length = 0;
  plages.forEach(([debut, fin]) => mock.occupationDev.push(...pleines(mock.DATE, debut, fin)));
}
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    // Tous les navigateurs du gate partagent 127.0.0.1 : le plafond par
    // adresse (60 demandes par minute) les compterait ensemble.
    const seaux = globalThis.__pinlaneRateBuckets;
    if (seaux) [...seaux.keys()].filter((k) => /^public-(availability|holds|reservations):/.test(k)).forEach((k) => seaux.delete(k));
    if (url.pathname === `/${JS}` && (servirAncien || (MUTATION && MUTATION.fichier === JS))) {
      let corps = servirAncien;
      if (!corps) {
        corps = muter(fs.readFileSync(path.join(ROOT, JS), 'utf8'), MUTATION);
        direPreuve();
      }
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
// La derniere reponse d une demande, attendue un instant : l ecran peut se
// mettre a jour avant que le gate ait lu le corps.
async function reponseAttendue(suivi, filtre, ms = 4000) {
  const fin = Date.now() + ms;
  for (;;) {
    for (let i = suivi.reponses.length - 1; i >= 0; i -= 1) if (filtre(suivi.reponses[i].url)) return suivi.reponses[i].json;
    if (Date.now() > fin) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
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
  return attendre(page, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone.is-busy'), 15000);
}
// Le programme, ligne par ligne : la cle, l etat, l heure dite, ce qui est
// deplie (les heures de la piste, ou « Choisir l’heure moi-même »).
function lireProgramme(page) {
  return page.evaluate(() => {
    const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const ol = document.querySelector('#hourZone .fg-etapes');
    if (!ol) return { lignes: [] };
    return {
      lignes: [...ol.children].map((li) => {
        const tete = li.querySelector('.fg-etape__tete');
        const heure = li.querySelector('.fg-etape__heure');
        const piste = li.querySelector('.fg-etape__piste');
        const arr = li.querySelector('.fg-etape__arr');
        return {
          cle: li.dataset.cle || '',
          classe: li.className,
          cache: li.getAttribute('aria-hidden') === 'true',
          tete: tete ? { tag: tete.tagName, type: tete.getAttribute('type') || '', expanded: tete.getAttribute('aria-expanded'), controls: tete.getAttribute('aria-controls') || '', cible: Boolean(document.getElementById(tete.getAttribute('aria-controls') || '')) } : null,
          detail: t(li.querySelector('.fg-etape__quoi small')),
          heure: heure ? (heure.dataset.mot || t(heure)) : '',
          ouverte: li.classList.contains('is-open'),
          piste: piste ? !piste.hidden : null,
          sansArrivee: arr ? !arr.hidden : null,
        };
      }),
    };
  });
}
const ligneDe = (programme, cle) => ((programme && programme.lignes) || []).find((l) => l.cle === cle) || null;
const estBorneArrivee = (l) => /fg-etape--borne/.test(l.classe) && /fg-etape--arrivee/.test(l.classe) && l.cache;
const resumeLignes = (programme) => ((programme && programme.lignes) || []).map((l) => `${l.cle || l.classe.replace(/\bfg-etape\b\s*/g, '').trim()}:${l.heure}`).join(' | ');
function lireVisite(page) {
  return page.evaluate(() => {
    const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const zone = document.querySelector('#planZone');
    return {
      etapes: zone ? [...zone.querySelectorAll('.fg-visit__step')].map((li) => ({ b: t(li.querySelector('b')), titre: t(li.querySelector('span')), detail: t(li.querySelector('small')), genre: li.className })) : [],
      tete: t(zone && zone.querySelector('.fg-visit__span')),
      avis: t(zone && zone.querySelector('.fg-notice b')),
      vers: zone ? [...zone.querySelectorAll('[data-arrivee-vers]')].map((b) => ({ heure: b.dataset.arriveeVers, texte: t(b) })) : [],
      somme: t(document.querySelector('#hourSum')),
      zone: t(document.querySelector('#hourZone')),
    };
  });
}
function lirePuces(page, piste) {
  return page.evaluate((id) => [...document.querySelectorAll(`.fg-track[data-activity="${id}"] .fg-chip`)].map((c) => ({
    time: c.dataset.time, ok: c.dataset.ok, etat: c.dataset.state || '', mot: ((c.querySelector('small') || {}).textContent || '').trim(),
    titre: c.getAttribute('title') || '', decrite: c.getAttribute('aria-describedby') || '',
  })), piste);
}
function lirePourquoi(page, piste) {
  return page.evaluate((id) => [...document.querySelectorAll(`.fg-track[data-activity="${id}"] .fg-why-list__item`)].map((li) => ({
    id: li.id, etat: li.dataset.etat || '', heures: String(li.dataset.heures || '').split(' ').filter(Boolean),
    cle: ((li.querySelector('.fg-key') || {}).textContent || '').trim(), texte: ((li.querySelector('span') || {}).textContent || '').replace(/\s+/g, ' ').trim(), lit: li.classList.contains('is-lit'),
  })), piste);
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
async function ouvrirArrivees(page) {
  await page.click('#hourZone .fg-etape[data-cle="arrivee"] .fg-etape__tete');
  const chargee = await attendre(page, () => document.querySelectorAll('.fg-track[data-activity="arrivee"] .fg-chip').length > 0, 20000);
  await page.waitForTimeout(350);
  return chargee;
}
// La fenetre « Envie d un peu plus ? » s ouvre seule au recapitulatif quand
// le serveur a joint des offres : un client la ferme.
async function passerLaVitrine(page) {
  await attendre(page, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  const ouverte = await page.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); });
  if (ouverte) {
    await page.click('#vitrine .fg-vitrine__non');
    await attendre(page, () => document.querySelector('#vitrine').hidden, 3000);
  }
}
const arcadesDabord = (x, y) => Number(y.activityId === 'arcade_time') - Number(x.activityId === 'arcade_time');

// ---------------------------------------------------------------------------
// [A] SANS HEURE D ARRIVEE CHOISIE, RIEN NE CHANGE
// ---------------------------------------------------------------------------
async function parcoursSansArrivee(browser, mock, reglageMeta, ancien) {
  reglage = reglageMeta;
  servirAncien = ancien || '';
  semer(mock, []);
  const { ctx, page, suivi } = await ouvrir(browser);
  const r = { suivi, poses: [] };
  try {
    r.arrive = await versHeures(page, mock, 'f1');
    await calme(page);
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
    servirAncien = '';
  }
  return r;
}
async function scenarioA(browser, mock) {
  section('A. SANS HEURE D ARRIVEE CHOISIE, RIEN NE CHANGE');
  const sans = await parcoursSansArrivee(browser, mock, null);
  const avec = await parcoursSansArrivee(browser, mock, REGLAGE);
  const coupe = await parcoursSansArrivee(browser, mock, { ...REGLAGE, arrivalFirst: false });
  const passages = [sans, avec, coupe];
  ok(passages.every((r) => r.arrive && r.poses.length === 2 && r.poses.every(Boolean) && r.contact && r.suivi.erreurs.length === 0),
    'MONTAGE trois passages (meta sans reglage, arrivee proposee, arrivee coupee) : Formule 1, 10 personnes, bowling 14:00 puis laser 16:00, puis les coordonnees, sans erreur',
    passages.map((r) => `${r.arrive}/${r.poses.join(',')}/${r.contact}/${r.suivi.erreurs.slice(0, 2).join(' | ')}`).join(' ; '));
  const borne = (r) => r.programme.lignes.some(estBorneArrivee) && !ligneDe(r.programme, 'arrivee');
  ok(borne(sans), 'sans reglage dans la meta (un serveur d avant), la ligne d arrivee reste la borne d avant', resumeLignes(sans.programme));
  ok(borne(coupe), 'arrivalFirst false dans la meta : la borne, aucune heure d arrivee a choisir', resumeLignes(coupe.programme));
  const ligne = ligneDe(avec.programme, 'arrivee');
  ok(Boolean(ligne && ligne.tete) && ligne.tete.tag === 'BUTTON' && ligne.tete.type === 'button' && ligne.tete.expanded === 'false' && ligne.tete.cible && !avec.programme.lignes.some(estBorneArrivee),
    'arrivee proposee : l arrivee devient une ligne du programme, un bouton qui deplie ses heures, a la place de la borne', resumeLignes(avec.programme));
  const portent = passages.flatMap((r) => r.suivi.demandes).filter((u) => params(u).has('arrival') || params(u).has('arrivals'));
  ok(portent.length === 0, 'aucune demande ne porte arrival ni arrivals tant que le client n ouvre pas l arrivee', portent.slice(0, 2).join(' | '));
  const a = sansDoublons(sans.suivi.demandes);
  const b = sansDoublons(avec.suivi.demandes);
  ok(a.length >= 3 && JSON.stringify(a) === JSON.stringify(b), `les demandes de la formule sont les memes au caractere pres, l option proposee ou non (${a.length} demandes)`, ecartListes(a, b));
  const blocA = sans.suivi.blocages[sans.suivi.blocages.length - 1] || null;
  const blocB = avec.suivi.blocages[avec.suivi.blocages.length - 1] || null;
  ok(Boolean(blocA && blocB) && corpsComparable(blocA) === corpsComparable(blocB), 'le blocage part identique, l option proposee ou non',
    blocA && blocB ? `${corpsComparable(blocA).length} / ${corpsComparable(blocB).length} caracteres` : 'blocage absent');
  ok(Boolean(blocB && blocB.preference) && !('arrivalTime' in blocB.preference), 'le blocage sans arrivee choisie ne porte aucune heure d arrivee', JSON.stringify(blocB && blocB.preference));
  if (!BASE_COMMIT) return;
  let ancien = '';
  try { ancien = execFileSync('git', ['-C', ROOT, 'show', `${BASE_COMMIT}:${JS}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (error) { ancien = ''; }
  if (!ok(Boolean(ancien), `MONTAGE le formulaire de ${BASE_COMMIT} se lit`)) return;
  const avant = await parcoursSansArrivee(browser, mock, REGLAGE, ancien);
  const c = sansDoublons(avant.suivi.demandes);
  ok(avant.arrive && avant.poses.every(Boolean) && JSON.stringify(c) === JSON.stringify(b), `le formulaire de ${BASE_COMMIT} fait les memes demandes, au caractere pres`, ecartListes(c, b));
  const blocC = avant.suivi.blocages[avant.suivi.blocages.length - 1] || null;
  ok(Boolean(blocC && blocB) && corpsComparable(blocC) === corpsComparable(blocB), `et le meme blocage que le formulaire de ${BASE_COMMIT}`);
}

// ---------------------------------------------------------------------------
// [B] LA LISTE DES HEURES D ARRIVEE
// ---------------------------------------------------------------------------
async function scenarioB(browser, mock) {
  section('B. LA LISTE DES HEURES D ARRIVEE (pistes et arene pleines de 10:00 a 12:00)');
  reglage = REGLAGE;
  semer(mock, [['10:00', '12:00']]);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    const avant = await lireProgramme(page);
    const regulier = await reponseAttendue(suivi, (u) => !estListe(u));
    const anchors = (regulier && regulier.anchors) || {};
    const ligne = ligneDe(avant, 'arrivee');
    const demandesAvant = suivi.demandes.slice();
    ok(arrive && Boolean(ligne) && (anchors.activities || []).length === 2, 'MONTAGE Formule 1, 10 personnes : le programme, sa ligne d arrivee, le bowling et le laser', resumeLignes(avant));
    const libres = (anchors.freePass || []).slice().sort(arcadesDabord);
    const libre = libres.length ? String(libres[0].label || '').toLowerCase() : '';
    const detail = ligne ? ligne.detail.toLowerCase() : '';
    ok(Boolean(libre) && /arcade/.test(libre) && detail.includes(libre) && (anchors.activities || []).every((x) => detail.includes(String(x.label || '').toLowerCase())),
      'sous « Arrivée », ce que l arrivee fait faire : les arcades de la formule en attendant le bowling et le laser', ligne && ligne.detail);
    ok(!demandesAvant.some(estListe), 'la liste des arrivees ne part pas tant que la ligne n est pas ouverte');
    const chargee = await ouvrirArrivees(page);
    const liste = await reponseAttendue(suivi, estListe);
    const entrees = (liste && liste.arrivals) || [];
    const ouverture = suivi.demandes.slice(demandesAvant.length);
    const listes = ouverture.filter(estListe);
    ok(chargee && entrees.length >= 10, `MONTAGE la ligne ouverte, ses heures d arrivee s affichent (${entrees.length})`);
    ok(listes.length === 1 && ouverture.every((u) => estListe(u) || demandesAvant.includes(u)), 'ouvrir la ligne demande la liste, une fois, et rien d autre', ouverture.join(' | '));
    const q = listes[0] ? params(listes[0]) : new URLSearchParams();
    ok(listes.length === 1 && !q.has('preferredTimes') && !q.has('laserGameTimes') && !q.has('arrival') && q.get('type') === 'formule' && q.get('formuleId') === 'f1' && q.get('pax') === String(PAX) && q.get('date') === mock.DATE,
      'la liste se demande pour la formule, le jour et le groupe, sans heure posee', listes[0] || '');
    const puces = await lirePuces(page, 'arrivee');
    const puceDe = (t) => puces.find((c) => c.time === t) || {};
    const ecarts = [];
    entrees.forEach((x) => {
      const p = puces.find((c) => c.time === x.time);
      if (!p) { ecarts.push(`${x.time} sans puce`); return; }
      if (x.ok === false) {
        if (p.ok !== 'false' || p.etat !== 'hard' || !p.mot) ecarts.push(`${x.time} refusee (${x.code}) : ${p.ok}/${p.etat}/« ${p.mot} »`);
        if (p.titre !== x.reason) ecarts.push(`${x.time} titre « ${p.titre} » au lieu de « ${x.reason} »`);
      } else if (x.warning) {
        if (p.etat !== 'soft' || p.mot !== 'serré') ecarts.push(`${x.time} serree : ${p.etat}/« ${p.mot} »`);
      } else if (p.ok !== 'true' || p.mot !== '') ecarts.push(`${x.time} libre : ${p.ok}/« ${p.mot} »`);
    });
    ok(puces.length === entrees.length && ecarts.length === 0, 'chaque heure d arrivee a sa puce et son verdict : libre sans mot, refusee avec son mot court et la phrase du serveur en titre', ecarts.slice(0, 4).join(' | '));
    const attentes = entrees.filter((x) => x.ok === false && x.code === 'arrival_wait');
    ok(attentes.length >= 2, `MONTAGE des arrivees refusees pour l attente sans activite (${attentes.map((x) => x.time).join(', ')})`);
    ok(attentes.length > 0 && attentes.every((x) => puceDe(x.time).mot === 'attente'), 'une arrivee refusee pour l attente se dit « attente » sur sa puce', attentes.map((x) => `${x.time}:${puceDe(x.time).mot}`).join(' '));
    const pourquoi = await lirePourquoi(page, 'arrivee');
    const lAttente = pourquoi.find((l) => attentes.length > 0 && attentes.every((x) => l.heures.includes(x.time))) || null;
    const minutes = attentes.map((x) => Number(x.waitMinutes) || 0);
    const bas = libelleDuree(Math.min(...minutes));
    const haut = libelleDuree(Math.max(...minutes));
    ok(Boolean(lAttente) && lAttente.cle === 'attente' && /attente/i.test(lAttente.texte) && lAttente.texte.includes(bas) && lAttente.texte.includes(haut) && /sans activit/.test(lAttente.texte),
      `sous la plage, une ligne pour ces heures : l attente sans activite, en fourchette (${bas} a ${haut})`, JSON.stringify(lAttente || pourquoi));
    ok(Boolean(lAttente) && attentes.every((x) => puceDe(x.time).decrite === lAttente.id), 'chaque heure refusee pointe sa ligne (aria-describedby)');
    const cles = await page.evaluate((t) => {
      const puce = document.querySelector(`.fg-track[data-activity="arrivee"] .fg-chip[data-time="${t}"]`);
      const sec = puce && puce.closest('.fg-period');
      return sec ? [...sec.querySelectorAll('.fg-period__keys .fg-key')].map((k) => k.textContent.trim()) : [];
    }, attentes.length ? attentes[0].time : '');
    ok(cles.includes('attente'), 'l en-tete de la plage le dit aussi, comme pour les heures des activites', cles.join(','));
    // Une arrivee refusee touchee : elle s explique, elle ne se prend pas.
    if (attentes.length) {
      const n = suivi.demandes.length;
      await page.click(`.fg-track[data-activity="arrivee"] .fg-chip[data-time="${attentes[0].time}"]`);
      await page.waitForTimeout(450);
      const lue = (await lirePourquoi(page, 'arrivee')).find((l) => l.heures.includes(attentes[0].time));
      ok(suivi.demandes.length === n && Boolean(lue && lue.lit), 'toucher une arrivee refusee ne la choisit pas : sa ligne s eclaire, aucune demande ne part', `${suivi.demandes.length - n} demande(s)`);
    }
    // La premiere arrivee qui tient, choisie.
    const premiere = entrees.find((x) => x.ok) || null;
    if (!ok(Boolean(premiere), 'MONTAGE une arrivee tient ce jour-la')) return;
    await page.click(`.fg-track[data-activity="arrivee"] .fg-chip[data-time="${premiere.time}"]`);
    await calme(page);
    const rep = await reponseAttendue(suivi, (u) => params(u).get('arrival') === premiere.time);
    const url = suivi.demandes.filter((u) => params(u).get('arrival') === premiere.time).pop() || '';
    const slot = (rep && rep.slots && rep.slots[0]) || null;
    const plan = (slot && slot.opsPlan) || {};
    const heures = (plan.anchorPlan && plan.anchorPlan.times) || {};
    ok(Boolean(slot) && plan.arrivalPlan && plan.arrivalPlan.arrivalTime === premiere.time, `MONTAGE l arrivee de ${premiere.time} se compose (bowling ${heures.bowling}, laser ${heures.laser_game})`, rep && rep.message);
    ok(Boolean(url) && JSON.stringify([...params(url).keys()]) === JSON.stringify(['centerId', 'date', 'pax', 'type', 'formuleId', 'arrival']),
      'l heure choisie part seule, en dernier, sans heure d activite posee', url);
    const apres = await lireProgramme(page);
    const lA = ligneDe(apres, 'arrivee');
    const lB = ligneDe(apres, 'bowling');
    const lL = ligneDe(apres, 'laser_game');
    ok(Boolean(lA) && lA.heure === premiere.time && /is-choisi/.test(lA.classe), `la ligne d arrivee dit ${premiere.time}, choisie`, resumeLignes(apres));
    ok(Boolean(lB && lL) && lB.heure === heures.bowling && lL.heure === heures.laser_game && /is-propose/.test(lB.classe) && /is-propose/.test(lL.classe),
      `le bowling et le laser prennent les heures que le serveur a posees a partir d elle (${heures.bowling}, ${heures.laser_game})`, resumeLignes(apres));
    const frise = (plan.arrivalPlan && plan.arrivalPlan.frise) || [];
    const attente = Number(plan.arrivalPlan && plan.arrivalPlan.waitMinutes) || 0;
    const attendus = frise.filter((s) => s.kind === 'free' && s.placement === 'before' && !/boisson/i.test(s.label))
      .map((s) => `${s.label}${s.timed ? ` jusqu’à ${heureAffichee(s.endTime)}` : ' en attendant'}`)
      .concat(attente > 0 ? [`${libelleDuree(attente)} d’attente`] : []);
    ok(Boolean(lA) && attendus.length > 0 && attendus.every((m) => lA.detail.includes(m)), 'sous « Arrivée », ce qui se fait avant la premiere activite, lu dans la frise du serveur', `« ${lA && lA.detail} » / ${attendus.join(' · ')}`);
    // « Choisir l’heure moi-même » : depuis la ligne du bowling.
    await page.click('#hourZone .fg-etape[data-cle="bowling"] .fg-etape__tete');
    await page.waitForTimeout(400);
    const ouverte = ligneDe(await lireProgramme(page), 'bowling');
    ok(Boolean(ouverte) && ouverte.ouverte && ouverte.sansArrivee === true && ouverte.piste === false,
      'l arrivee choisie, la ligne du bowling ouverte propose « Choisir l’heure moi-même » a la place de ses heures', JSON.stringify(ouverte));
    const n = suivi.demandes.length;
    await page.click('#hourZone .fg-etape[data-cle="bowling"] [data-sans-arrivee]');
    await calme(page);
    const main = await lireProgramme(page);
    const nouvelles = suivi.demandes.slice(n);
    const lB2 = ligneDe(main, 'bowling');
    const lA2 = ligneDe(main, 'arrivee');
    ok(nouvelles.length > 0 && nouvelles.every((u) => !params(u).has('arrival')), '« Choisir l’heure moi-même » rend la main : la demande suivante ne porte plus d arrivee', nouvelles.join(' | '));
    ok(Boolean(lB2 && lA2) && lB2.ouverte && lB2.piste === true && lB2.sansArrivee === false && !/is-choisi/.test(lA2.classe),
      'la ligne du bowling rouvre ses heures, l arrivee n est plus choisie', resumeLignes(main));
    const focus = await page.evaluate(() => { const f = document.activeElement; return Boolean(f && f !== document.body && document.querySelector('#hourZone').contains(f)); });
    ok(focus, 'le focus reste dans le programme quand le bouton touche disparait');
  } finally {
    ok(suivi.erreurs.length === 0, '[B] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [C] ARRIVER A 10:00 QUAND TOUT EST PRIS JUSQU A 10:30, JUSQU A LA RESERVATION
// ---------------------------------------------------------------------------
async function scenarioC(browser, mock) {
  section('C. ARRIVER A 10:00 QUAND TOUT EST PRIS JUSQU A 10:30');
  reglage = REGLAGE;
  semer(mock, [['10:00', '10:30']]);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    await ouvrirArrivees(page);
    const liste = await reponseAttendue(suivi, estListe);
    const dix = ((liste && liste.arrivals) || []).find((x) => x.time === '10:00') || {};
    if (!ok(arrive && dix.ok === true, 'MONTAGE Formule 1, 10 personnes, pistes et arene pleines de 10:00 a 10:30 : arriver a 10:00 tient', JSON.stringify(dix).slice(0, 160))) return;
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]');
    await calme(page);
    const rep = await reponseAttendue(suivi, (u) => params(u).get('arrival') === '10:00');
    const slot = (rep && rep.slots && rep.slots[0]) || null;
    const plan = (slot && slot.opsPlan) || {};
    const accueil = String(plan.arrivalTime || '');
    const frise = (plan.arrivalPlan && plan.arrivalPlan.frise) || [];
    const heures = (plan.anchorPlan && plan.anchorPlan.times) || {};
    const arcades = frise.find((s) => s.kind === 'free' && s.timed && s.placement === 'before') || null;
    const fin = heureAffichee((slot && slot.visitEndTime) || '');
    if (!ok(Boolean(slot) && plan.arrivalPlan && plan.arrivalPlan.arrivalTime === '10:00' && Boolean(accueil) && accueil !== '10:00' && Boolean(arcades) && arcades.startTime === '10:00' && heures.bowling === arcades.endTime && Boolean(fin),
      `MONTAGE le serveur compose la visite : arcades 10:00, bowling ${heures.bowling}, laser ${heures.laser_game}, accueil ${accueil}, fin ${fin}`, rep && rep.message)) return;
    const prog = await lireProgramme(page);
    const lA = ligneDe(prog, 'arrivee');
    const lB = ligneDe(prog, 'bowling');
    const lL = ligneDe(prog, 'laser_game');
    const lFin = prog.lignes.find((l) => /fg-etape--fin/.test(l.classe)) || null;
    ok(Boolean(lA && lB && lL) && lA.heure === '10:00' && lB.heure === heures.bowling && lL.heure === heures.laser_game,
      'le programme : l arrivee a 10:00, puis le bowling et le laser aux heures du serveur', resumeLignes(prog));
    ok(Boolean(lFin) && lFin.heure === fin, `la fin du programme est celle du serveur (${fin})`, lFin && lFin.heure);
    const v = await lireVisite(page);
    const rang = (f) => v.etapes.findIndex(f);
    const iArr = rang((e) => e.b === '10:00' && e.titre === 'Arrivée');
    const iArc = rang((e) => e.b === '10:00' && e.titre.includes(arcades.label) && e.detail.includes(`jusqu’à ${heureAffichee(arcades.endTime)}`));
    const iBow = rang((e) => e.b === heures.bowling && /bowling/i.test(e.titre));
    const iLas = rang((e) => e.b === heures.laser_game && /laser/i.test(e.titre));
    const derniere = v.etapes[v.etapes.length - 1] || {};
    ok(iArr === 0 && iArr < iArc && iArc < iBow && iBow < iLas, 'la visite se lit dans l ordre : arrivee 10:00, arcades 10:00, bowling, laser', v.etapes.map((e) => `${e.b} ${e.titre}`).join(' | '));
    ok(derniere.titre === 'Fin de la visite' && derniere.b === fin, `la visite finit a l heure du serveur (${fin}), jamais recalculee`, `${derniere.b} ${derniere.titre}`);
    ok(v.tete.startsWith('de 10:00 ') && v.somme.includes(`10:00 → ${fin}`), 'l en-tete de la visite et la barre du bas partent de 10:00', `« ${v.tete} » / « ${v.somme} »`);
    ok(!v.zone.includes(accueil) && !v.somme.includes(accueil), `l accueil dix minutes avant (${accueil}) ne se dit nulle part a l ecran des heures`);
    const nBlocages = suivi.blocages.length;
    await page.click('#goContact');
    const contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 12000);
    const bloc = suivi.blocages.length > nBlocages ? suivi.blocages[suivi.blocages.length - 1] : null;
    ok(contact && Boolean(bloc && bloc.preference) && bloc.preference.arrivalTime === '10:00' && JSON.stringify(bloc.preference.preferredTimes) === JSON.stringify(heures),
      'le blocage part avec l heure d arrivee (10:00) et les heures que le serveur a posees', JSON.stringify(bloc && bloc.preference));
    const rappel = norm(await page.evaluate(() => (document.querySelector('#recallLine') || {}).textContent || ''));
    ok(rappel.includes('arrivée 10:00') && !rappel.includes(accueil), 'le rappel des horaires dit « arrivée 10:00 »', `« ${rappel} »`);
    await page.fill('#cPrenom', 'Qa');
    await page.fill('#cNom', 'Arrivee');
    await page.fill('#cEmail', 'qa@invalid.test');
    await page.fill('#cTel', '0471234567');
    await page.click('#occasions [data-occasion="famille"]');
    await page.check('#cConsent');
    await page.click('#goRecap');
    const recap = await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 8000);
    await passerLaVitrine(page);
    const lignes = await page.evaluate(() => [...document.querySelectorAll('.fg-scene[data-scene="recap"] .fg-recap__row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
    ok(recap && lignes.some((l) => l.includes('Arrivée à 10:00')) && !lignes.some((l) => /conseill/.test(l) || l.includes(accueil)), 'le recapitulatif dit « Arrivée à 10:00 », pas l accueil conseille', lignes.join(' | '));
    mock.dernierePose.body = null;
    await page.click('#confirmBtn');
    const finie = await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 15000);
    const corps = mock.dernierePose.body || {};
    const pref = corps.preference || {};
    ok(finie && pref.arrivalTime === '10:00' && corps.startTime === '10:00' && JSON.stringify(pref.preferredTimes) === JSON.stringify(heures)
      && JSON.stringify(pref.laserGameTimes) === JSON.stringify((plan.anchorPlan && plan.anchorPlan.laserGameTimes) || []),
    'la reservation part avec preference.arrivalTime 10:00, ses heures et ses parties de laser', JSON.stringify({ startTime: corps.startTime, preference: pref }));
    const ecran = norm(await page.evaluate(() => (document.querySelector('#finBody') || {}).textContent || ''));
    ok(ecran.includes('Arrivée à 10:00') && !/conseill/.test(ecran) && !ecran.includes(accueil), 'l ecran final dit « Arrivée à 10:00 »', ecran.slice(0, 220));
  } finally {
    ok(suivi.erreurs.length === 0, '[C] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [D] UNE FORMULE SANS ARCADES, UNE ARRIVEE SERREE
// ---------------------------------------------------------------------------
async function scenarioD(browser, mock) {
  section('D. LA FORMULE 4 : SON MINIGOLF, JAMAIS D ARCADES ; UNE ARRIVEE SERREE');
  reglage = REGLAGE;
  semer(mock, [['10:00', '10:30']]);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f4');
    await calme(page);
    const regulier = await reponseAttendue(suivi, (u) => !estListe(u));
    const libres = ((regulier && regulier.anchors && regulier.anchors.freePass) || []).slice().sort(arcadesDabord);
    const lA = ligneDe(await lireProgramme(page), 'arrivee');
    ok(arrive && Boolean(lA) && libres.length > 0 && !libres.some((x) => /arcade/i.test(`${x.activityId} ${x.label}`)), 'MONTAGE la Formule 4 : du minigolf, aucune arcade (son libre, lu au serveur)', JSON.stringify(libres));
    ok(Boolean(lA) && libres.length > 0 && lA.detail.toLowerCase().includes(String(libres[0].label).toLowerCase()) && !/arcade/i.test(lA.detail),
      'sous « Arrivée », la Formule 4 annonce son minigolf, jamais des arcades qu elle n a pas', lA && lA.detail);
    await ouvrirArrivees(page);
    const liste = await reponseAttendue(suivi, estListe);
    const entrees = (liste && liste.arrivals) || [];
    const puces = await lirePuces(page, 'arrivee');
    const pourquoi = await lirePourquoi(page, 'arrivee');
    const serree = entrees.find((x) => x.ok && x.warning && x.warning.reason) || null;
    if (ok(Boolean(serree), 'MONTAGE une arrivee du soir tient, mais sa visite deborde la fermeture : le serveur la donne avec son avertissement', entrees.filter((x) => x.ok).slice(-2).map((x) => x.time).join(', '))) {
      const p = puces.find((c) => c.time === serree.time) || {};
      ok(p.etat === 'soft' && p.mot === 'serré' && p.ok === 'true' && p.titre === serree.warning.reason, `${serree.time} se dit « serré », reste possible, la raison du moteur en titre`, JSON.stringify(p));
      const l = pourquoi.find((x) => x.heures.includes(serree.time)) || null;
      ok(Boolean(l) && l.etat === 'soft' && l.cle === 'serré' && norm(l.texte).includes(minuscule(norm(serree.warning.reason))), 'sous sa plage, la ligne dit ce qui ne tiendra pas', JSON.stringify(l));
    }
    const dix = entrees.find((x) => x.time === '10:00') || {};
    if (!ok(dix.ok === true, 'MONTAGE arriver a 10:00 tient', JSON.stringify(dix).slice(0, 160))) return;
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]');
    await calme(page);
    const rep = await reponseAttendue(suivi, (u) => params(u).get('arrival') === '10:00');
    const slot = (rep && rep.slots && rep.slots[0]) || null;
    const plan = (slot && slot.opsPlan) || {};
    const heures = (plan.anchorPlan && plan.anchorPlan.times) || {};
    const avant = ((plan.arrivalPlan && plan.arrivalPlan.frise) || []).find((s) => s.kind === 'free' && s.placement === 'before' && !/boisson/i.test(s.label)) || null;
    const defauts = (regulier && regulier.anchors && regulier.anchors.defaultTimes) || {};
    if (!ok(Boolean(slot && avant) && !avant.timed && /golf/i.test(avant.activityId) && heures.bowling && heures.bowling !== defauts.bowling,
      `MONTAGE arriver a 10:00 : le minigolf d abord, sans heure ; le bowling a ${heures.bowling} (${defauts.bowling} sans arrivee)`, JSON.stringify(avant))) return;
    const prog = await lireProgramme(page);
    const lA2 = ligneDe(prog, 'arrivee');
    const lB = ligneDe(prog, 'bowling');
    const lL = ligneDe(prog, 'laser_game#1');
    ok(Boolean(lA2) && lA2.detail.includes(`${avant.label} en attendant`) && !/arcade/i.test(lA2.detail), 'sous « Arrivée » : le minigolf en attendant', lA2 && lA2.detail);
    ok(Boolean(lB && lL) && lB.heure === heures.bowling && lL.heure === heures.laser_game, `le bowling et la 1re partie de laser prennent les heures du serveur (${heures.bowling}, ${heures.laser_game})`, resumeLignes(prog));
    const v = await lireVisite(page);
    const i = v.etapes.findIndex((e) => e.b === '10:00' && e.titre === 'Arrivée');
    const suivante = i >= 0 ? v.etapes[i + 1] : null;
    ok(Boolean(suivante) && suivante.titre.includes(avant.label) && suivante.b === '' && suivante.detail.startsWith('en attendant votre '), 'la visite commence par le minigolf, sans heure, en attendant le bowling', JSON.stringify(suivante));
    ok(!v.etapes.some((e) => /arcade/i.test(`${e.titre} ${e.detail}`)), 'aucune ligne de la visite ne parle d arcades', v.etapes.map((e) => e.titre).join(' | '));
  } finally {
    ok(suivi.erreurs.length === 0, '[D] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [E] LE CENTRE COUPE L ARRIVEE
// ---------------------------------------------------------------------------
async function scenarioE(browser, mock) {
  section('E. LE CENTRE COUPE L ARRIVEE (arrivalBounds.arrivalFirst false)');
  reglage = REGLAGE;
  semer(mock, []);
  {
    const { ctx, page, suivi } = await ouvrir(browser);
    try {
      await page.route((url) => url.pathname === '/api/public-availability' && url.searchParams.get('arrivals') === '1', async (route) => {
        const reponse = await route.fetch();
        const j = await reponse.json();
        j.arrivals = [];
        j.firstAcceptableArrival = null;
        j.arrivalBounds = { ...(j.arrivalBounds || {}), arrivalFirst: false };
        j.message = COUPEE;
        await route.fulfill({ response: reponse, json: j });
      });
      const arrive = await versHeures(page, mock, 'f1');
      await calme(page);
      const avant = await lireProgramme(page);
      ok(arrive && Boolean(ligneDe(avant, 'arrivee')), 'MONTAGE la meta propose l arrivee : la ligne est la', resumeLignes(avant));
      await page.click('#hourZone .fg-etape[data-cle="arrivee"] .fg-etape__tete');
      const partie = await attendre(page, () => !document.querySelector('#hourZone .fg-etape[data-cle="arrivee"]'), 12000);
      await calme(page);
      const apres = await lireProgramme(page);
      ok(partie && apres.lignes.some(estBorneArrivee), 'la liste dit que le centre ne la propose plus : la ligne redevient la borne d avant', resumeLignes(apres));
      ok(!suivi.demandes.some((u) => params(u).has('arrival')), 'aucune heure d arrivee ne part');
    } finally {
      ok(suivi.erreurs.length === 0, '[E] aucune erreur JavaScript (liste)', suivi.erreurs.slice(0, 3).join(' | '));
      await ctx.close();
    }
  }
  {
    const { ctx, page, suivi } = await ouvrir(browser);
    let coupe = false;
    try {
      await page.route((url) => url.pathname === '/api/public-availability' && url.searchParams.has('arrival'), async (route) => {
        const reponse = await route.fetch();
        const j = await reponse.json();
        if (!coupe) {
          coupe = true;
          const t = new URL(route.request().url()).searchParams.get('arrival');
          j.slots = [];
          j.arrivalBounds = { ...(j.arrivalBounds || {}), arrivalFirst: false };
          j.arrival = { time: t, ok: false, code: 'arrival_disabled', reason: COUPEE, shortReason: 'Non proposé par le centre' };
          j.message = COUPEE;
        }
        await route.fulfill({ response: reponse, json: j });
      });
      const arrive = await versHeures(page, mock, 'f1');
      await calme(page);
      await ouvrirArrivees(page);
      await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]');
      await attendre(page, () => !document.querySelector('#hourZone .fg-etape[data-cle="arrivee"]'), 12000);
      await calme(page);
      const apres = await lireProgramme(page);
      const v = await lireVisite(page);
      const derniere = suivi.demandes.filter((u) => !estListe(u)).pop() || '';
      ok(arrive && coupe, 'MONTAGE une arrivee choisie, son plan dit que le centre ne la propose plus');
      ok(Boolean(derniere) && !params(derniere).has('arrival') && apres.lignes.some(estBorneArrivee) && !v.avis && v.etapes.length > 0,
        'l arrivee choisie tombe : la demande suivante n en porte plus, la borne revient, le plan sans arrivee s affiche', `${derniere} | ${resumeLignes(apres)} | ${v.avis}`);
    } finally {
      ok(suivi.erreurs.length === 0, '[E] aucune erreur JavaScript (plan)', suivi.erreurs.slice(0, 3).join(' | '));
      await ctx.close();
    }
  }
}

// ---------------------------------------------------------------------------
// [F] UNE ARRIVEE PRISE ENTRE LA LISTE ET LE CHOIX
// ---------------------------------------------------------------------------
async function scenarioF(browser, mock) {
  section('F. UNE ARRIVEE PRISE ENTRE LA LISTE ET LE CHOIX');
  reglage = REGLAGE;
  semer(mock, [['10:00', '10:30']]);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    await ouvrirArrivees(page);
    const avant = await lirePuces(page, 'arrivee');
    const listes = suivi.demandes.filter(estListe).length;
    if (!ok(arrive && (avant.find((c) => c.time === '10:00') || {}).ok === 'true', 'MONTAGE la liste dit qu arriver a 10:00 tient')) return;
    // Un autre groupe prend tout jusqu a 12:00 pendant que le client hesite.
    mock.occupationDev.push(...pleines(mock.DATE, '10:30', '12:00'));
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]');
    await calme(page);
    await attendre(page, () => document.querySelector('#planZone .fg-notice'), 8000);
    const rep = await reponseAttendue(suivi, (u) => params(u).get('arrival') === '10:00');
    const suivante = rep && rep.arrival ? rep.arrival.nextAcceptableTime || rep.arrival.firstAcceptableTime || '' : '';
    if (!ok(Boolean(rep) && Array.isArray(rep.slots) && rep.slots.length === 0 && Boolean(suivante), `MONTAGE le serveur refuse 10:00 et donne l arrivee suivante (${suivante})`, rep && rep.message)) return;
    const v = await lireVisite(page);
    ok(v.avis === norm(rep.message), 'le refus du serveur se lit tel quel : pourquoi, et la premiere arrivee possible', `« ${v.avis} »`);
    ok(v.vers.length === 1 && v.vers[0].heure === suivante && v.vers[0].texte === `Arriver à ${suivante}`, `un toucher propose l arrivee suivante qui tient (${suivante})`, JSON.stringify(v.vers));
    const relue = await attendre(page, () => { const c = document.querySelector('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]'); return Boolean(c && c.dataset.ok === 'false'); }, 12000);
    ok(relue && suivi.demandes.filter(estListe).length === listes + 1, 'la liste ouverte se relit : 10:00 s y dit refusee, comme le plan', `${suivi.demandes.filter(estListe).length - listes} relecture(s)`);
    await page.click('#planZone [data-arrivee-vers]');
    await calme(page);
    const lA = ligneDe(await lireProgramme(page), 'arrivee');
    const v2 = await lireVisite(page);
    ok(Boolean(lA) && lA.heure === suivante && /is-choisi/.test(lA.classe) && !v2.avis && (v2.etapes[0] || {}).b === suivante,
      `l arrivee suivante se choisit d un toucher : ${suivante}, et la visite repart de la`, `${lA && lA.heure} | ${v2.avis} | ${(v2.etapes[0] || {}).b}`);
  } finally {
    ok(suivi.erreurs.length === 0, '[F] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [G] AU TELEPHONE
// ---------------------------------------------------------------------------
async function scenarioG(browser, mock) {
  section('G. AU TELEPHONE (360 PX)');
  reglage = REGLAGE;
  semer(mock, [['10:00', '12:00']]);
  const { ctx, page, suivi } = await ouvrir(browser, { largeur: 360, hauteur: 780 });
  const posee = () => attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running'), 4000);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    const chargee = await ouvrirArrivees(page);
    await posee();
    const m = await page.evaluate(() => {
      const visibles = [...document.querySelectorAll('.fg-track[data-activity="arrivee"] .fg-chip')].filter((c) => c.getClientRects().length && c.getBoundingClientRect().height > 0);
      const tete = document.querySelector('#hourZone .fg-etape[data-cle="arrivee"] .fg-etape__tete');
      return {
        n: visibles.length,
        hauteur: Math.min(...visibles.map((c) => c.getBoundingClientRect().height)),
        largeurPuce: Math.min(...visibles.map((c) => c.getBoundingClientRect().width)),
        tete: tete ? tete.getBoundingClientRect().height : 0,
        page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        ecran: window.innerWidth,
      };
    });
    ok(arrive && chargee && m.n > 0, `MONTAGE les heures d arrivee s affichent a 360 px (${m.n} visibles)`);
    ok(m.page <= m.ecran, `rien ne deborde a 360 px (${m.page} px de large pour ${m.ecran})`);
    ok(m.hauteur >= 44 && m.largeurPuce >= 44 && m.tete >= 44, `les heures d arrivee et leur ligne se touchent du doigt (44 px au moins : puce ${Math.round(m.hauteur)} x ${Math.round(m.largeurPuce)}, ligne ${Math.round(m.tete)})`);
    const forme = await page.evaluate(() => {
      const decrire = (c) => {
        if (!c) return '';
        const lb = c.closest('[role="listbox"]');
        return [c.tagName, c.getAttribute('type'), c.getAttribute('role'), c.hasAttribute('aria-selected'), Boolean(lb && lb.getAttribute('aria-label'))].join('|');
      };
      return { arrivee: decrire(document.querySelector('.fg-track[data-activity="arrivee"] .fg-chip')), bowling: decrire(document.querySelector('.fg-track[data-activity="bowling"] .fg-chip')) };
    });
    ok(Boolean(forme.arrivee) && forme.arrivee === forme.bowling && forme.arrivee.startsWith('BUTTON|button|option|true|true'), 'une heure d arrivee est le meme bouton qu une heure de bowling (type, role, aria-selected, liste nommee)', JSON.stringify(forme));
    await page.focus('#hourZone .fg-etape[data-cle="arrivee"] .fg-etape__tete');
    let focus = null;
    for (let k = 0; k < 20 && !(focus && focus.puce); k += 1) {
      await page.keyboard.press('Tab');
      focus = await page.evaluate(() => {
        const f = document.activeElement;
        const s = f ? getComputedStyle(f) : null;
        return { puce: Boolean(f && f.matches('.fg-track[data-activity="arrivee"] .fg-chip')), style: s ? s.outlineStyle : '', largeur: s ? parseFloat(s.outlineWidth) || 0 : 0 };
      });
    }
    ok(Boolean(focus && focus.puce) && focus.style !== 'none' && focus.largeur >= 2, 'au clavier, l heure d arrivee qui a le focus se voit (contour)', JSON.stringify(focus));
    const liste = await reponseAttendue(suivi, estListe);
    const libre = (((liste && liste.arrivals) || []).find((x) => x.ok) || {}).time;
    if (!ok(Boolean(libre), 'MONTAGE une arrivee tient ce jour-la')) return;
    await page.click(`.fg-track[data-activity="arrivee"] .fg-chip[data-time="${libre}"]`);
    await calme(page);
    await page.click('#hourZone .fg-etape[data-cle="bowling"] .fg-etape__tete');
    await page.waitForTimeout(450);
    await posee();
    const bouton = await page.evaluate(() => {
      const b = document.querySelector('#hourZone .fg-etape[data-cle="bowling"] [data-sans-arrivee]');
      const r = b ? b.getBoundingClientRect() : null;
      return { hauteur: r ? r.height : 0, page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), ecran: window.innerWidth, tag: b ? b.tagName : '' };
    });
    ok(bouton.tag === 'BUTTON' && bouton.hauteur >= 44 && bouton.page <= bouton.ecran, `« Choisir l’heure moi-même » est un bouton qui se touche du doigt (${Math.round(bouton.hauteur)} px), et rien ne deborde`, JSON.stringify(bouton));
  } finally {
    ok(suivi.erreurs.length === 0, '[G] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

const SCENARIOS = [['A', scenarioA], ['B', scenarioB], ['C', scenarioC], ['D', scenarioD], ['E', scenarioE], ['F', scenarioF], ['G', scenarioG]];

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
        ok(false, `[${cle}] le parcours va jusqu au bout`, String((error && error.message) || error).split('\n').slice(0, 2).join(' | '));
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
  console.log('\nformules-arrivee-form-check: ALL OK (l heure d arrivee se choisit, dit pourquoi, part avec la reservation ; sans elle rien ne change)');
  process.exit(0);
}

function contreEpreuves() {
  const fichiers = [...new Set([JS, 'assets/fungalaxy-booking.css', 'fungalaxy.html', ...MUTATIONS.map((m) => m.fichier)])];
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

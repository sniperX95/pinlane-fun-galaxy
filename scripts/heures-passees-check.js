// UNE HEURE POSEE DEVENUE PASSEE (2026-09-30).
//
// Le defaut : un client qui reserve pour aujourd hui et hesite au passage de
// l heure garde une heure que le moteur refuse (elle commence avant le
// plancher du jour : maintenant + 15 min, recale sur la grille). CHAQUE autre
// heure disait alors « Fin après 22:00 » (releve du 30/09 a 19:58 : bowling
// pose a 14:00, les heures du laser 20:30, 21:00 et 21:30 toutes refusees
// ainsi), aucun creneau n etait retenu et le message parlait de « formule ».
//
//   [A] SERVEUR, horloge figee (mercredi 07/10, 16:00, plancher 16:15) : une
//       heure posee passee sort de la demande et la reponse la nomme
//       (`heuresPassees`) ; les heures rendues sont exactement celles d une
//       demande sans cette heure ; un creneau est retenu.
//   [B] une partie de laser passee sort, l autre reste posee ;
//   [C] une heure a venir, ou un autre jour, ne bouge pas ; le plancher lui-
//       meme reste (16:15 reste, 16:00 sort) ; la premiere heure proposee est
//       le plancher (une seule definition, plancherDuJour).
//   [D] LE FORMULAIRE (dans le navigateur, mock du depot, reponse du serveur
//       rejouee avec `heuresPassees`) : l heure sort du choix du client (la
//       demande suivante ne la porte plus), la piste dit « L’heure de HH:MM
//       est passée : choisissez-en une autre. », et une nouvelle heure choisie
//       efface la phrase. Une heure seulement proposee et gardee (retenirProposees,
//       2026-11-04), devenue passee, sort aussi : sa ligne ne la propose plus et la
//       demande d apres ne la renvoie pas. La reponse rejouee est celle du serveur
//       pour une demande SANS cette heure (section A) : le mock, a l heure reelle,
//       ne la juge pas passee lui-meme.
//
// CONTRE-EPREUVE (--mutate) : chaque regle retiree en memoire (serveur) ou
// servie cassee au navigateur (formulaire), le gate doit rougir ; le disque
// n est jamais ecrit, et on le verifie.
//
// Lancement : node scripts/heures-passees-check.js [--mutate]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
const JOUR = '2026-10-07'; // un mercredi : 12:00 - 22:00
const LENDEMAIN = '2026-10-08';
const MAINTENANT = 16; // 16:00 -> plancher 16:15 (delai 15, pas 15)
const NAVIGATEUR = process.argv.includes('--navigateur');

const MUTATIONS = [
  {
    nom: 'le serveur garde l heure passee dans la demande',
    fichier: 'api/public-availability.js',
    de: "    if (plancher !== null && preferredTimes && typeof preferredTimes === 'object') {",
    vers: '    if (false) {',
  },
  {
    nom: 'la partie de laser passee reste posee',
    fichier: 'api/public-availability.js',
    de: '        laserGameTimes = laserGameTimes.filter((t) => t && !passee(t));',
    vers: '        laserGameTimes = laserGameTimes.filter((t) => t);',
  },
  {
    nom: 'le plancher des heures posees n est plus celui de la fenetre',
    fichier: 'lib/ops-engine.js',
    de: '  return ceilMinutes(currentTimeDecimal() * 60 + leadMinutes, step);',
    vers: '  return ceilMinutes(currentTimeDecimal() * 60, step);',
  },
  {
    nom: 'le formulaire ignore heuresPassees',
    fichier: 'assets/fungalaxy-booking.js',
    de: '    var passees = Array.isArray(j.heuresPassees) ? j.heuresPassees : [];',
    vers: '    var passees = [];',
  },
  {
    nom: 'une nouvelle heure choisie laisse la phrase de l heure passee',
    fichier: 'assets/fungalaxy-booking.js',
    de: '    delete state.heuresPassees[idA];',
    vers: '    void 0;',
  },
  {
    nom: 'une heure proposee et gardee reste apres avoir ete dite passee',
    fichier: 'assets/fungalaxy-booking.js',
    de: '      if (state.retenues.pins[p.activityId] === p.time) delete state.retenues.pins[p.activityId];',
    vers: '      void 0;',
  },
];
const MUTATION_PREUVE = '[mutation] servie :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_PASSEES_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
function muter(contenu, mutation) {
  const texte = contenu.split(CRLF).join(LF);
  if (texte.split(mutation.de).length - 1 !== 1) {
    console.error(`mutation impossible : ancre absente ou multiple dans ${mutation.fichier} : ${mutation.de.slice(0, 70)}`);
    process.exit(2);
  }
  console.log(`${MUTATION_PREUVE} ${mutation.nom}`);
  return texte.split(mutation.de).join(mutation.vers);
}
// Mutation du serveur : EN MEMOIRE, avant tout require applicatif.
if (MUTATION && !MUTATION.fichier.startsWith('assets/')) {
  const Module = require('module');
  const compile = Module.prototype._compile;
  const cible = path.resolve(ROOT, MUTATION.fichier);
  Module.prototype._compile = function (contenu, nom) {
    if (path.resolve(nom) === cible) return compile.call(this, muter(contenu, MUTATION), nom);
    return compile.call(this, contenu, nom);
  };
}

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
function section(titre) { console.log(`\n${titre}`); }
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// [A]-[C] LE SERVEUR, horloge figee. L horloge se pose AVANT le chargement du
// moteur et du gestionnaire : ils lisent todayStr et currentTimeDecimal a leur
// chargement.
async function serveur() {
  const bookingConfig = require('../lib/booking-config');
  bookingConfig.todayStr = () => JOUR;
  bookingConfig.currentTimeDecimal = () => MAINTENANT;
  const database = require('../lib/database');
  database.readAvailabilitySnapshot = async (date, centerId) => ({ reservations: [], laneStatuses: {}, blocks: [], date, centerId });
  database.readStaffState = database.readAvailabilitySnapshot;
  const dispo = require('../api/public-availability');
  const { plancherDuJour, PROGRAM_GRID_MINUTES } = require('../lib/ops-engine');
  const { loadOpsKnowledge } = require('../lib/ops-knowledge');

  let ip = 0;
  const heures = async (q) => {
    ip += 1;
    const adresse = `10.6.${ip % 250}.${1 + (ip % 200)}`;
    const req = { method: 'GET', url: `/api/public-availability?${new URLSearchParams({ centerId: 'libramont', pax: '6', softReserve: '1', ...q }).toString()}`, headers: { host: 'localhost', 'x-forwarded-for': adresse }, socket: { remoteAddress: adresse } };
    const res = { statusCode: 200, headers: {}, body: '' };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.getHeader = (k) => res.headers[k];
    res.writeHead = (code) => { res.statusCode = code; };
    res.end = (b) => { res.body = b === undefined ? '' : String(b); };
    await dispo(req, res);
    try { return JSON.parse(res.body || '{}'); } catch (error) { return {}; }
  };
  const visite = JSON.stringify([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }]);
  const deuxParties = JSON.stringify([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }]);
  const verdicts = (r) => ((r.anchors && r.anchors.activities) || []).map((a) => `${a.activityId}:` + (a.times || []).map((t) => `${t.time}${t.ok === false ? `x(${t.reason || ''})` : t.warning ? `!(${t.warning.reason || ''})` : ''}`).join(','));
  const blocs = (r) => ((((r.slots || [])[0] || {}).opsPlan || {}).resourceBlocks || []).map((b) => `${b.activityId} ${b.startTime}`);

  // Le plancher, calcule ici sans le moteur : maintenant + delai, sur la grille.
  const regles = loadOpsKnowledge().rules.scenarioGeneration;
  const pas = Number(regles.slotStepMinutes);
  const attendu = Math.ceil((MAINTENANT * 60 + Number(regles.sameDayLeadMinutes || 15)) / pas) * pas;

  section('A. UNE HEURE POSEE PASSEE SORT DE LA DEMANDE');
  const sans = await heures({ date: JOUR, type: 'visite', program: visite });
  const avec = await heures({ date: JOUR, type: 'visite', program: visite, preferredTimes: JSON.stringify({ bowling: '14:00' }) });
  ok(Array.isArray(sans.slots) && sans.slots.length > 0 && !sans.heuresPassees, 'MONTAGE sans heure posee, un creneau est retenu et rien n est « passe »', `${(sans.slots || []).length} creneau(x)`);
  ok(JSON.stringify(avec.heuresPassees) === JSON.stringify([{ activityId: 'bowling', time: '14:00' }]),
    'le bowling pose a 14:00 (il est 16:00) est nomme dans la reponse', JSON.stringify(avec.heuresPassees || null));
  ok(JSON.stringify(verdicts(avec)) === JSON.stringify(verdicts(sans)),
    'les heures rendues sont exactement celles d une demande sans cette heure (aucune fausse raison)', verdicts(avec).join(' | ').slice(0, 220));
  const faussesFins = verdicts(avec).join('|').match(/(1[6-9]|20):\d{2}x\(Fin après 22:00\)/g) || [];
  ok(faussesFins.length === 0, 'aucune heure avant 21:00 ne dit « Fin après 22:00 »', faussesFins.join(' '));
  ok(Array.isArray(avec.slots) && avec.slots.length > 0 && !/formule/i.test(String(avec.message || '')),
    'un creneau est retenu, et aucun message ne parle de « formule »', `${(avec.slots || []).length} creneau(x), message « ${avec.message || ''} »`);

  section('B. UNE PARTIE DE LASER PASSEE SORT, L AUTRE RESTE');
  const parties = await heures({ date: JOUR, type: 'visite', program: deuxParties, laserGameTimes: JSON.stringify(['14:00', '19:00']), preferredTimes: JSON.stringify({ laser_game: '14:00' }) });
  ok(JSON.stringify(parties.heuresPassees) === JSON.stringify([{ activityId: 'laser_game', time: '14:00' }]),
    'la partie de 14:00 est nommee, pas celle de 19:00', JSON.stringify(parties.heuresPassees || null));
  ok(blocs(parties).includes('laser_game 19:00') && !blocs(parties).includes('laser_game 14:00'),
    'le plan retenu garde la partie posee a 19:00', blocs(parties).join(', '));

  section('C. CE QUI NE BOUGE PAS');
  ok(plancherDuJour(JOUR) === attendu && attendu === 16 * 60 + 15, 'le plancher du jour est maintenant + 15 min sur la grille : 16:15', `${hhmm(plancherDuJour(JOUR) || 0)} (attendu ${hhmm(attendu)})`);
  ok(plancherDuJour(LENDEMAIN) === null, 'un autre jour n a pas de plancher', String(plancherDuJour(LENDEMAIN)));
  const aVenir = await heures({ date: JOUR, type: 'visite', program: visite, preferredTimes: JSON.stringify({ bowling: '18:00' }) });
  ok(!aVenir.heuresPassees && blocs(aVenir).includes('bowling 18:00'), 'une heure a venir (18:00) reste posee', `${JSON.stringify(aVenir.heuresPassees || null)} ; ${blocs(aVenir).join(', ')}`);
  const demain = await heures({ date: LENDEMAIN, type: 'visite', program: visite, preferredTimes: JSON.stringify({ bowling: '14:00' }) });
  ok(!demain.heuresPassees && blocs(demain).includes('bowling 14:00'), 'le lendemain, 14:00 n est pas passe : l heure reste posee', `${JSON.stringify(demain.heuresPassees || null)} ; ${blocs(demain).join(', ')}`);
  // Les heures se proposent sur la grille des departs (30 min) : la premiere
  // est le plancher recale sur cette grille, 16:30 ; 16:00 est sous le plancher.
  const grille = Math.ceil(attendu / PROGRAM_GRID_MINUTES) * PROGRAM_GRID_MINUTES;
  const premiere = ((((sans.anchors || {}).activities || []).find((a) => a.activityId === 'bowling') || {}).times || [])[0] || {};
  ok(premiere.time === hhmm(grille) && grille === 16 * 60 + 30, 'la premiere heure proposee est le plancher sur la grille : 16:30 (la fenetre lit la meme definition)', premiere.time || 'aucune');
  const auPlancher = await heures({ date: JOUR, type: 'visite', program: visite, preferredTimes: JSON.stringify({ bowling: hhmm(grille) }) });
  ok(!auPlancher.heuresPassees && blocs(auPlancher).includes(`bowling ${hhmm(grille)}`), 'la premiere heure proposee (16:30), posee, reste', `${JSON.stringify(auPlancher.heuresPassees || null)} ; ${blocs(auPlancher).join(', ')}`);
  const sousPlancher = await heures({ date: JOUR, type: 'visite', program: visite, preferredTimes: JSON.stringify({ bowling: hhmm(grille - PROGRAM_GRID_MINUTES) }) });
  ok(JSON.stringify(sousPlancher.heuresPassees) === JSON.stringify([{ activityId: 'bowling', time: hhmm(grille - PROGRAM_GRID_MINUTES) }]), 'l heure d avant sur la grille (16:00, sous le plancher de 16:15) sort', JSON.stringify(sousPlancher.heuresPassees || null));
}

// ---------------------------------------------------------------------------
// [D] LE FORMULAIRE, dans un processus a part (horloge reelle) : le mock du
// depot sert le vrai gestionnaire ; la reponse qui suit le clic est rejouee
// avec `heuresPassees` pour l heure de bowling posee.
async function navigateur() {
  const PORT = Number(process.env.PINLANE_PASSEES_PORT || 4483);
  const BASE = 'http://127.0.0.1:' + PORT;
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const attendre = async (page, fn, ms, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return Boolean(await page.evaluate(fn, arg).catch(() => false)); } };
  const server = mock.createServer({ port: PORT });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const erreurs = [];
  // Une page neuve : ses demandes de visite, ses erreurs, le formulaire mute s il l est.
  const nouvellePage = async () => {
    const p = await ctx.newPage();
    const urls = [];
    p.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
    p.on('request', (req) => { if (req.url().includes('/api/public-availability') && req.url().includes('type=visite')) urls.push(req.url()); });
    if (MUTATION && MUTATION.fichier.startsWith('assets/')) {
      const brut = fs.readFileSync(path.join(ROOT, MUTATION.fichier), 'utf8');
      const mute = muter(brut, MUTATION);
      await p.route('**/assets/fungalaxy-booking.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: mute }));
    }
    return { p, urls };
  };
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  // Jusqu a l ecran des heures : bowling + laser, 6 personnes.
  const auxHeures = async (p) => {
    await p.goto(BASE + '/fungalaxy/libramont', { waitUntil: 'networkidle', timeout: 45000 });
    await attendre(p, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
    await p.click('#dayBtn');
    const [y, mo] = mock.DATE.split('-').map(Number);
    const cible = cap(MOIS[mo - 1]) + ' ' + y;
    for (let k = 0; k < 16; k += 1) {
      const titre = await p.evaluate(() => document.querySelector('#calTitle').textContent.trim());
      if (titre === cible) break;
      const [nom, an] = titre.split(' ');
      await p.click(y * 12 + (mo - 1) > Number(an) * 12 + MOIS.indexOf(nom.toLowerCase()) ? '#calNext' : '#calPrev');
      await attendre(p, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
    }
    await attendre(p, (d) => { const x = document.querySelector('#calGrid .fg-cal__day[data-date="' + d + '"]'); return x && !x.classList.contains('is-loading'); }, 8000, mock.DATE);
    await p.click('#calGrid .fg-cal__day[data-date="' + mock.DATE + '"]');
    await attendre(p, () => document.querySelector('#dayPop').hidden, 3000);
    await p.fill('#paxInput', '6');
    await p.press('#paxInput', 'Enter');
    await p.click('#goActivities');
    await attendre(p, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
    for (const id of ['bowling', 'laser_game']) { await p.click('#gridAct .fg-card[data-activity="' + id + '"]'); await p.waitForTimeout(250); }
    await p.click('#goHours');
    return attendre(p, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('#goContact').disabled, 15000);
  };
  // Une case libre de cette activite, a partir de cette heure : elle est touchee.
  const toucherLibre = (p, id, depuis, sauf) => p.evaluate(({ id: a, depuis: d, sauf: s }) => {
    const c = [...document.querySelectorAll('.fg-track[data-activity="' + a + '"] .fg-chip[data-time]')].find((x) => !x.disabled && !/is-(on|proposed|soft|shift|off|wave)\b/.test(x.className) && x.dataset.time >= d && x.dataset.time !== s);
    if (!c) return '';
    c.click();
    return c.dataset.time;
  }, { id, depuis, sauf: sauf || '' });
  const calme = async (p) => {
    await attendre(p, () => document.querySelectorAll('.fg-chip.is-pending').length === 0 && !document.querySelector('#hourZone.is-busy'), 10000);
    await p.waitForTimeout(600);
  };
  const posees = (url) => { try { return JSON.parse(new URL(url).searchParams.get('preferredTimes') || '{}'); } catch (e) { return {}; } };
  const plusTard = (h, minutes) => { const [a, b] = h.split(':').map(Number); return hhmm(a * 60 + b + minutes); };
  const { p: page, urls: demandes } = await nouvellePage();
  try {
    const pret = await auxHeures(page);
    if (!ok(pret, 'MONTAGE l ecran des heures se charge (bowling + laser, 6 personnes)')) return;
    // Pose une heure de bowling (une case libre, pas celle proposee).
    const pose = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.fg-track[data-activity="bowling"] .fg-chip[data-time]')].find((x) => !x.disabled && !/is-(on|proposed|soft|shift|off|wave)\b/.test(x.className));
      if (!c) return '';
      c.click();
      return c.dataset.time;
    });
    await attendre(page, () => !document.querySelector('#hourZone.is-busy') && !document.querySelector('.fg-chip.is-pending'), 10000);
    await page.waitForTimeout(400);
    const derniere = () => demandes[demandes.length - 1] || '';
    ok(Boolean(pose) && posees(derniere()).bowling === pose, 'MONTAGE le bowling est pose et part avec la demande', `${pose} ; ${JSON.stringify(posees(derniere()))}`);
    // La prochaine reponse : le serveur dit que cette heure est passee, et son plan est
    // celui d une demande sans elle (section A).
    let rejouee = false;
    await page.route('**/api/public-availability?*type=visite*', async (route) => {
      if (rejouee) return route.continue();
      rejouee = true;
      const u = new URL(route.request().url());
      const sansElle = posees(u.href);
      delete sansElle.bowling;
      u.searchParams.set('preferredTimes', JSON.stringify(sansElle));
      const reponse = await route.fetch({ url: u.href });
      const corps = await reponse.json();
      corps.heuresPassees = [{ activityId: 'bowling', time: pose }];
      return route.fulfill({ response: reponse, json: corps });
    });
    // Le laser bien plus tard : le plan du serveur place le bowling autour de lui, jamais
    // a l heure dite passee (le mock, a l heure reelle, pourrait la reproposer).
    const laser = await toucherLibre(page, 'laser_game', plusTard(pose, 180));
    await calme(page);
    const note = await page.evaluate(() => { const n = document.querySelector('.fg-track[data-activity="bowling"] .fg-track__note'); return n ? { texte: n.textContent.replace(/\s+/g, ' ').trim(), cache: n.hidden } : null; });
    ok(Boolean(laser) && rejouee, 'MONTAGE une heure de laser touchee, la reponse rejouee porte l heure passee', `${laser} ; rejouee=${rejouee}`);
    ok(note && note.cache === false && note.texte.indexOf(`L’heure de ${pose} est passée : choisissez-en une autre.`) === 0,
      'la piste du bowling dit que son heure est passee', JSON.stringify(note));
    const cochee = await page.evaluate((h) => Boolean(document.querySelector('.fg-track[data-activity="bowling"] .fg-chip.is-on[data-time="' + h + '"]')), pose);
    ok(!cochee, 'l heure passee n est plus cochee', pose);
    // La demande suivante ne porte plus l heure passee. Elle peut porter une autre heure
    // de bowling : celle que le plan propose et que la page garde (retenirProposees).
    const avantRelecture = demandes.length;
    await toucherLibre(page, 'laser_game', plusTard(laser, 30));
    await calme(page);
    const suivante = demandes.slice(avantRelecture).pop() || '';
    ok(Boolean(suivante) && posees(suivante).bowling !== pose, 'la demande suivante ne porte plus le bowling passe', JSON.stringify(posees(suivante)));
    // Une nouvelle heure de bowling efface la phrase.
    const nouvelle = await page.evaluate((ancienne) => {
      const c = [...document.querySelectorAll('.fg-track[data-activity="bowling"] .fg-chip[data-time]')].find((x) => !x.disabled && !/is-(on|proposed|soft|shift|off|wave)\b/.test(x.className) && x.dataset.time !== ancienne);
      if (!c) return '';
      c.click();
      return c.dataset.time;
    }, pose);
    await attendre(page, () => document.querySelectorAll('.fg-chip.is-pending').length === 0, 10000);
    await page.waitForTimeout(600);
    const apres = await page.evaluate(() => { const n = document.querySelector('.fg-track[data-activity="bowling"] .fg-track__note'); return n ? { texte: n.textContent.replace(/\s+/g, ' ').trim(), cache: n.hidden } : null; });
    ok(Boolean(nouvelle) && apres && apres.texte.indexOf('est passée') < 0, 'une nouvelle heure de bowling choisie efface la phrase', `${nouvelle} ; ${JSON.stringify(apres)}`);

    // UNE HEURE SEULEMENT PROPOSEE ET GARDEE, DEVENUE PASSEE. Le client touche le laser :
    // le bowling qu on lui propose part avec la demande, garde. Au toucher suivant, le
    // serveur le dit passe et place le bowling ailleurs (AILLEURS, une heure valable).
    const AILLEURS = '18:00';
    const { p: page2, urls: demandes2 } = await nouvellePage();
    if (!ok(await auxHeures(page2), 'MONTAGE second parcours : l ecran des heures se charge')) return;
    const laser1 = await toucherLibre(page2, 'laser_game', '11:30');
    await calme(page2);
    const gardee = posees(demandes2[demandes2.length - 1] || '').bowling;
    ok(Boolean(laser1) && Boolean(gardee), 'MONTAGE le laser touche, le bowling seulement propose part avec la demande', `${laser1} ; ${JSON.stringify(posees(demandes2[demandes2.length - 1] || ''))}`);
    let dite = '';
    await page2.route('**/api/public-availability?*type=visite*', async (route) => {
      if (dite) return route.continue();
      const u = new URL(route.request().url());
      const parties = posees(u.href);
      dite = parties.bowling || 'absente';
      parties.bowling = AILLEURS;
      u.searchParams.set('preferredTimes', JSON.stringify(parties));
      const reponse = await route.fetch({ url: u.href });
      const corps = await reponse.json();
      corps.heuresPassees = [{ activityId: 'bowling', time: dite }];
      // La grille du serveur propose ce que son plan pose (anchors.defaultTimes).
      corps.anchors.defaultTimes = { ...corps.anchors.defaultTimes, bowling: AILLEURS };
      return route.fulfill({ response: reponse, json: corps });
    });
    // Une demi-heure plus TOT : le bowling propose reste a moins d une demi-heure du laser, donc garde (plus loin, il se
    // recollerait au laser : scripts/heure-relachee-check.js).
    const laser2 = await toucherLibre(page2, 'laser_game', plusTard(laser1, -30), laser1);
    await calme(page2);
    ok(Boolean(laser2) && dite === gardee, 'MONTAGE au toucher suivant, le bowling garde part encore et le serveur le dit passe', `${laser2} ; dite ${dite}, gardee ${gardee}`);
    const ligne = await page2.evaluate(() => (document.querySelector('.fg-etape[data-cle="bowling"] .fg-etape__heure') || {}).textContent || '');
    ok(ligne.includes(AILLEURS) && !ligne.includes(dite), 'la ligne du bowling dit l heure du plan, plus celle qui est passee', `ligne « ${ligne} », plan ${AILLEURS}, passee ${dite}`);
    // « Revenir a l heure proposee » redemande le plan sans recalculer ce qui est garde.
    const avantRetour = demandes2.length;
    await page2.evaluate(() => { const r = document.querySelector('.fg-track[data-activity="laser_game"] [data-reset]'); if (r) r.click(); });
    await calme(page2);
    const apresRetour = demandes2.slice(avantRetour).pop() || '';
    ok(Boolean(apresRetour) && posees(apresRetour).bowling !== dite, 'la demande d apres ne renvoie pas au serveur l heure proposee devenue passee', JSON.stringify(posees(apresRetour)));
  } finally {
    ok(erreurs.length === 0, 'aucune erreur JavaScript', erreurs.slice(0, 3).join(' | '));
    await browser.close();
    server.close();
  }
}

async function main() {
  if (NAVIGATEUR) {
    section('D. LE FORMULAIRE, DANS LE NAVIGATEUR');
    await navigateur();
  } else {
    await serveur();
    // Le navigateur dans un processus a part : l horloge figee ici ne doit pas
    // atteindre le mock (il sert un autre jour, a l heure reelle).
    const enfant = spawnSync(process.execPath, [__filename, '--navigateur'], { env: process.env, encoding: 'utf8', timeout: 180000 });
    const sortie = `${enfant.stdout || ''}${enfant.stderr || ''}`;
    process.stdout.write(sortie);
    const fails = sortie.split('\n').filter((l) => l.startsWith('FAIL')).length;
    if (enfant.status !== 0 && !fails) ok(false, 'la partie navigateur a tourne jusqu au bout', `code ${enfant.status}`);
    failures += fails;
  }
  if (failures) {
    console.error(`\nheures-passees-check${NAVIGATEUR ? ' (navigateur)' : ''}: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log(`\nheures-passees-check${NAVIGATEUR ? ' (navigateur)' : ''}: ALL OK (l heure passee sort de la demande, la raison reste vraie, le formulaire le dit)`);
}

if (process.argv.includes('--mutate')) {
  const empreintes = new Map(MUTATIONS.map((x) => [x.fichier, fs.readFileSync(path.join(ROOT, x.fichier), 'utf8')]));
  let defauts = 0;
  MUTATIONS.forEach((mutation, index) => {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, PINLANE_PASSEES_MUTATION: String(index + 1) }, encoding: 'utf8', timeout: 300000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const servie = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
    const rougit = r.status === 1 && sortie.split('\n').some((l) => l.startsWith('FAIL'));
    if (r.status === 2 || !servie) { defauts += 1; console.error(`contre-epreuve DESARMEE : ${mutation.nom} (${r.status === 2 ? 'ancre introuvable' : 'mutation non servie'})`); }
    else if (!rougit) { defauts += 1; console.error(`contre-epreuve MUETTE : le gate reste vert quand ${mutation.nom}.`); }
    else console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom}.`);
  });
  const touche = [...empreintes].filter(([f, avant]) => fs.readFileSync(path.join(ROOT, f), 'utf8') !== avant);
  if (touche.length) { defauts += 1; console.error(`un fichier a ete ecrit : ${touche.map(([f]) => f).join(', ')}`); }
  if (defauts) { console.error(`\nheures-passees-check --mutate: ${defauts} defaut(s).`); process.exit(1); }
  console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et aucun fichier n a ete ecrit.`);
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}

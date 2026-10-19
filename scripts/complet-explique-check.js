// UNE HEURE COMPLETE DIT SON CALCUL, ET LES ACTIVITES LIBRES NE FERMENT PLUS
// LES HEURES DU BOWLING ET DU LASER (Movsar, 2026-09-30).
//
//   « ET PQ je n ai que ces horaires la de proposer pour ajd duckpin ? »
//   « pq quand je choisis une heure bowling tout dun coup plein dheure laser
//     sont impossible » ; « bowling et lasergame ils peuvent choisir l heure,
//     toutes les autres elles peuvent etre faites comme ils veulent sur place,
//     pq mettre au complet des heures pour billards duckpin »
//   « faut montrer ici que 6 JOUEURS max par piste donc vous avez besoin de x
//     pistes »
//   « preciser pour lasergame que c est susceptible d avoir d autres gens avec
//     eux »
//
// La journee est celle de la prod du 30/09, recopiee sans coordonnees : le
// 1402 (64 joueurs a 13:30, bowling en 2 groupes sur les pistes 1-6, laser en
// 3 groupes de 22, 21 et 21 a 15:30, 16:00 et 16:30, Fun Run 3 h 15) et le
// 1404 (10 joueurs a 13:30, bowling pistes 7-8, laser jusqu a 15:25, puis
// billard, plaine et duckpin 1 h 30, visite comptee jusqu a 19:00).
//
// [A] L API DES HEURES, le vrai handler sur ces deux dossiers :
//   - aucune heure de bowling ni de laser n est fermee par le billard ou le
//     duckpin (5 tables demandees, le plafond en ligne, quand le 1404 en
//     tient deux : 4 libres sur 6) ;
//   - le duckpin d un groupe de 20 est propose l apres-midi (14:00, 15:00,
//     17:00), pas a 16:00 ni 16:30 : le 1404 n aurait plus 1 h 30 de duckpin
//     pendant sa visite ;
//   - un groupe au bowling n est pas en meme temps sur une piste de duckpin :
//     bowling 16:00 + duckpin, quand les 2 pistes sont prises de 17:00 a
//     18:00, ne tient pas ; 15:00 tient ;
//   - le « Complet » du bowling porte son calcul (6 joueurs par piste, 2
//     pistes, aucune libre), celui du laser ses places (8 libres sur 30 a
//     15:30, 9 a 16:00, il en faut 10).
// [B] LE FORMULAIRE (fungalaxy.html, dans le navigateur) les ecrit, et la
//     piste du laser dit que la partie se partage. Depuis le 2026-10-12
//     (Movsar : « explique brievement et joliment »), la ligne sous les heures
//     est COURTE : ce qu il faut et ce qui est libre, sans redire « complet »
//     (la case le dit) ; le « 6 joueurs par piste » se lit dans la note des
//     pistes, juste dessous, et la taille de l arene dans la note du partage.
//
// CONTRE-EPREUVE (--mutate) : chaque correctif est retire EN MEMOIRE, le
// moteur au chargement de son module, le formulaire au moment ou il est
// servi, et le gate doit rougir. Le disque n est jamais ecrit, et on le
// verifie.
//
// Lancement : node scripts/complet-explique-check.js [--mutate]
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_COMPLET_PORT || 4471);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

// UNE MUTATION PAR CORRECTIF. `fichier` : le module servi mute au chargement,
// ou l asset servi mute par le serveur du gate.
const MUTATIONS = [
  {
    nom: 'l ancienne regle revient : un groupe deja pose tient ses pistes et ses tables toute sa visite',
    fichier: 'lib/reservation-ops.js',
    de: "    if (verdict === 'oui') continue;",
    vers: "    if (verdict === 'oui' && false) continue;",
  },
  {
    nom: 'la disponibilite ne donne plus le plan du creneau a la garde (le groupe peut jouer au duckpin pendant son bowling)',
    fichier: 'api/public-availability.js',
    de: 'totalDuration: minutes / 60, opsPlan: slot.opsPlan || null },',
    vers: 'totalDuration: minutes / 60 },',
  },
  {
    nom: 'le « Complet » du bowling perd son calcul',
    fichier: 'lib/ops-engine.js',
    de: "          if (manque) entry = ko('capacity', 'Complet', manque);",
    vers: "          if (manque) entry = ko('capacity', 'Complet');",
  },
  {
    nom: 'le « Complet » du laser perd ses places',
    fichier: 'lib/ops-engine.js',
    de: '          const { ok: _refus, ...manque } = capacity;',
    vers: '          const manque = {};',
  },
  {
    nom: 'le formulaire n ecrit plus le calcul',
    fichier: 'assets/fungalaxy-booking.js',
    de: "raison: t.code === 'capacity' ? raisonComplet(t) : (t.reason || 'Indisponible'),",
    vers: "raison: t.reason || 'Indisponible',",
  },
  {
    nom: 'la ligne sous les heures perd ses chiffres courts (elle retombe sur la phrase longue)',
    fichier: 'assets/fungalaxy-booking.js',
    // Re-ancree le 2026-10-19 : depuis 07b0aae la meme ligne porte aussi les
    // chiffres de l attente (avis) ; la mutation ne retire que ceux du Complet.
    de: "    var chiffres = e.etat === 'hard' && v.ok === false && v.code === 'capacity' ? chiffresComplet(v)\n",
    vers: "    var chiffres = e.etat === 'hard' && v.ok === false && v.code === 'capacity' ? null\n",
  },
  {
    nom: 'la piste du laser ne dit plus que la partie se partage',
    fichier: 'assets/fungalaxy-booking.js',
    de: "          + (laser ? notePartage() : '')",
    vers: "          + ''",
  },
];
const MUTATION_PREUVE = '[mutation] servie en memoire :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_COMPLET_MUTATION || 0);
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
// Le crochet est pose AVANT tout require applicatif : sinon le module serait
// deja compile quand il mordrait.
if (MUTATION && MUTATION.fichier.startsWith('lib/') || (MUTATION && MUTATION.fichier.startsWith('api/'))) {
  const Module = require('module');
  const compile = Module.prototype._compile;
  const cible = path.resolve(ROOT, MUTATION.fichier);
  Module.prototype._compile = function (contenu, nom) {
    if (path.resolve(nom) === cible) return compile.call(this, muter(contenu, MUTATION), nom);
    return compile.call(this, contenu, nom);
  };
}

const mock = require('./dev-tunnel-server');
const { chromium } = require('playwright-core');

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return false; }
}

// --- La journee du 30/09, telle que la base la relit --------------------------
const bloc = (resourceType, activityId, startTime, endTime, extra = {}) => ({ type: 'activity', resourceType, activityId, startTime, endTime, ...extra });
const DOSSIER_1402 = {
  id: 1402, centerId: 'libramont', date: mock.DATE, status: 'pending', validationStatus: 'confirmed', type: 'bowling', pax: 64,
  startTime: '13:30', duration: 1, totalDuration: 4.75, lanes: [1, 2, 3, 4, 5, 6],
  program: { items: [
    { activityId: 'bowling', planned: true, minutes: 60, duration: 1 },
    { activityId: 'laser_game', planned: true, minutes: 30, duration: 0.5, games: 1 },
    { activityId: 'fun_run', planned: false, minutes: 195 },
  ] },
  opsPlan: { startTime: '13:30', endTime: '17:20', resourceBlocks: [
    bloc('bowling_lane', 'bowling', '13:30', '14:30', { lanes: [1, 2, 3, 4, 5, 6], players: 32, groupPlayers: 64, groupWaveCount: 2, start: 810, end: 870 }),
    bloc('bowling_lane', 'bowling', '14:30', '15:30', { lanes: [1, 2, 3, 4, 5, 6], players: 32, groupPlayers: 64, groupWaveCount: 2, start: 870, end: 930 }),
    bloc('laser_arena', 'laser_game', '15:30', '15:55', { players: 22, weaponNeed: 22, groupPlayers: 64, groupWaveCount: 3, start: 930, end: 955 }),
    bloc('laser_arena', 'laser_game', '16:00', '16:25', { players: 21, weaponNeed: 21, groupPlayers: 64, groupWaveCount: 3, start: 960, end: 985 }),
    bloc('laser_arena', 'laser_game', '16:30', '16:55', { players: 21, weaponNeed: 21, groupPlayers: 64, groupWaveCount: 3, start: 990, end: 1015 }),
  ] },
};
const DOSSIER_1404 = {
  id: 1404, centerId: 'libramont', date: mock.DATE, status: 'pending', validationStatus: 'confirmed', type: 'bowling', pax: 10,
  startTime: '13:30', duration: 1, totalDuration: 5.5, lanes: [7, 8],
  program: { items: [
    { activityId: 'bowling', planned: true, minutes: 60, duration: 1 },
    { activityId: 'laser_game', planned: true, minutes: 60, duration: 1, games: 2 },
    // Deux tables (la capture en tenait une) : avec le plafond de 5 par
    // reservation en ligne, le billard doit rester plein pour la visite de [A].
    { activityId: 'billards', planned: false, minutes: 60, units: 2, hours: 1, sessions: 1 },
    { activityId: 'playground', planned: false, minutes: 60, sessions: 1 },
    { activityId: 'duckpin_bowling', planned: false, minutes: 90, duration: 1.5, units: 2, sessions: 1 },
  ] },
  opsPlan: { startTime: '13:30', endTime: '15:40', resourceBlocks: [
    bloc('bowling_lane', 'bowling', '13:30', '14:30', { lanes: [7, 8], players: 10, start: 810, end: 870 }),
    bloc('laser_arena', 'laser_game', '14:30', '14:55', { players: 10, weaponNeed: 10, groupPlayers: 10, groupWaveCount: 1, start: 870, end: 895 }),
    bloc('laser_arena', 'laser_game', '15:00', '15:25', { players: 10, weaponNeed: 10, groupPlayers: 10, groupWaveCount: 1, start: 900, end: 925 }),
  ] },
};
// Deux pistes de duckpin JOUEES de 17:00 a 18:00 par un groupe de 12.
const DOSSIER_DUCKPIN_17H = {
  id: 1501, centerId: 'libramont', date: mock.DATE, status: 'confirmed', validationStatus: 'confirmed', type: 'activite', pax: 12,
  startTime: '17:00', duration: 1, totalDuration: 1, lanes: [],
  program: { items: [{ activityId: 'duckpin_bowling', planned: false, minutes: 60, duration: 1, units: 2, sessions: 1 }] },
  opsPlan: null,
};
function poserJournee(dossiers) {
  mock.occupationDev.length = 0;
  dossiers.forEach((dossier) => mock.occupationDev.push(JSON.parse(JSON.stringify(dossier))));
}

// --- Le serveur : le mock partage, et le formulaire mute quand il le faut ---
function serveur() {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (MUTATION && MUTATION.fichier.startsWith('assets/') && url.pathname === `/${MUTATION.fichier}`) {
      const source = fs.readFileSync(path.join(ROOT, MUTATION.fichier), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(muter(source, MUTATION));
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}
function lireJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let corps = '';
      res.setEncoding('utf8');
      res.on('data', (morceau) => { corps += morceau; });
      res.on('end', () => { try { resolve(JSON.parse(corps)); } catch (error) { resolve({ brut: corps.slice(0, 200) }); } });
    }).on('error', reject);
  });
}
function dispo(programme, pax, extra = {}) {
  const q = new URLSearchParams({ centerId: 'libramont', date: mock.DATE, type: 'visite', pax: String(pax), program: JSON.stringify(programme), softReserve: '1', ...extra });
  return lireJson(`${BASE_URL}/api/public-availability?${q.toString()}`);
}
const heuresDe = (rep, id) => (((rep.anchors && rep.anchors.activities) || []).find((a) => a.activityId === id) || { times: [] }).times;
const aLHeure = (liste, heure) => liste.find((t) => t.time === heure) || {};

async function verifierApi() {
  console.log('[A] L API DES HEURES, SUR LA JOURNEE DU 30/09');
  poserJournee([DOSSIER_1402, DOSSIER_1404]);
  const programme = [
    { activityId: 'bowling', duration: 1 },
    { activityId: 'laser_game', games: 2 },
    { activityId: 'billards', units: 5, hours: 1 },
    { activityId: 'duckpin_bowling' },
  ];
  const rep = await dispo(programme, 10, { preferredTimes: JSON.stringify({ bowling: '15:30' }) });
  const bowling = heuresDe(rep, 'bowling');
  const laser = heuresDe(rep, 'laser_game');
  ok(bowling.length > 10 && laser.length > 10, 'MONTAGE les heures du bowling et du laser sont rendues', `${bowling.length} / ${laser.length}`);
  const parLibre = bowling.concat(laser).filter((t) => t.ok === false && /billard|duckpin|fun run/i.test(String(t.reason || '')));
  ok(parLibre.length === 0, '[A] aucune heure de bowling ni de laser n est fermee par le billard, le duckpin ou le Fun Run',
    parLibre.map((t) => `${t.time} ${t.reason}`).join(' | '));
  const lasersLibres = ['13:00', '13:30', '14:00', '14:30', '15:00', '17:00', '17:30'].filter((h) => aLHeure(laser, h).ok !== false);
  ok(lasersLibres.length === 7, '[A] le laser reste libre a 13:00-15:00 et 17:00-17:30 (avant : « billards complet »)', lasersLibres.join(' '));

  const b13 = aLHeure(bowling, '13:00');
  ok(b13.ok === false && b13.code === 'capacity' && b13.lanesNeeded === 2 && b13.lanesFree === 0 && b13.playersPerLane === 6,
    '[A] bowling 13:00 complet, avec son calcul : 6 joueurs par piste, 2 pistes, aucune libre', JSON.stringify(b13));
  const l1530 = aLHeure(laser, '15:30');
  const l1600 = aLHeure(laser, '16:00');
  ok(l1530.ok === false && l1530.code === 'capacity' && l1530.placesFree === 8 && l1530.arenaPlaces === 30 && l1530.placesNeeded === 10,
    '[A] laser 15:30 complet, avec ses places : 8 libres sur 30, il en faut 10', JSON.stringify(l1530));
  ok(l1600.placesFree === 9 && l1600.placesNeeded === 10, '[A] laser 16:00 : 9 libres sur 30, il en faut 10', JSON.stringify(l1600));

  const duck = await dispo([{ activityId: 'duckpin_bowling' }], 20);
  const heuresDuck = (duck.slots || []).map((s) => s.time);
  ok(['14:00', '15:00', '15:30', '17:00'].every((h) => heuresDuck.includes(h)),
    '[A] le duckpin d un groupe de 20 est propose l apres-midi (avant : 19:00, 19:30 et 20:00 seulement)', heuresDuck.join(' '));
  ok(!heuresDuck.includes('16:00') && !heuresDuck.includes('16:30'),
    '[A] mais pas a 16:00 ni 16:30 : le 1404 n aurait plus 1 h 30 de duckpin pendant sa visite', heuresDuck.join(' '));

  poserJournee([DOSSIER_DUCKPIN_17H]);
  const mixte = await dispo([{ activityId: 'bowling', duration: 1 }, { activityId: 'duckpin_bowling' }], 12);
  const bMixte = heuresDe(mixte, 'bowling');
  ok(aLHeure(bMixte, '16:00').ok === false && /duckpin/i.test(String(aLHeure(bMixte, '16:00').reason || '')) && aLHeure(bMixte, '15:00').ok !== false,
    '[A] bowling 16:00 + duckpin ne tient pas quand les 2 pistes sont prises de 17:00 a 18:00 (le groupe ne joue pas au duckpin pendant son bowling) ; 15:00 tient',
    `16:00 ${aLHeure(bMixte, '16:00').ok === false ? aLHeure(bMixte, '16:00').reason : 'ok'} | 15:00 ${aLHeure(bMixte, '15:00').ok === false ? aLHeure(bMixte, '15:00').reason : 'ok'}`);
}

async function verifierFormulaire(browser) {
  console.log('');
  console.log('[B] LE FORMULAIRE ECRIT LE CALCUL ET LE PARTAGE');
  poserJournee([DOSSIER_1402, DOSSIER_1404]);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), 'MONTAGE le catalogue est lu');
    await page.click('#dayBtn');
    const [y, mo] = mock.DATE.split('-').map(Number);
    for (let k = 0; k < 4; k += 1) {
      const trouve = await page.evaluate((d) => Boolean(document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`)), mock.DATE);
      if (trouve) break;
      await page.click('#calNext');
      await dormir(300);
    }
    ok(await attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, mock.DATE),
      `MONTAGE le jour du mock est dans le calendrier (${y}-${String(mo).padStart(2, '0')})`);
    await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    await page.fill('#paxInput', '10');
    await page.press('#paxInput', 'Enter');
    await page.click('#goActivities');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000), 'MONTAGE ecran des activites, 10 joueurs');
    for (const id of ['bowling', 'laser_game', 'billards', 'duckpin_bowling']) await page.click(`#gridAct .fg-card[data-activity="${id}"]`);
    await page.click('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]');
    await page.click('#goHours');
    ok(await attendre(page, () => document.querySelectorAll('#hourZone .fg-track .fg-chip').length > 0 && document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000),
      'MONTAGE les heures du bowling et du laser sont rendues');
    await dormir(400);
    const lu = await page.evaluate(() => {
      const piste = (id) => document.querySelector(`#hourZone .fg-track[data-activity="${id}"]`);
      const raisons = (id) => Array.from((piste(id) || document.createElement('div')).querySelectorAll('.fg-why-list__item'))
        .map((li) => ({
          heures: li.dataset.heures || '',
          texte: li.textContent.replace(/\s+/g, ' ').trim(),
          phrase: ((li.querySelector('.fg-why-list__quand + span') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        }));
      const titre = (id, h) => { const c = piste(id) && piste(id).querySelector(`.fg-chip[data-time="${h}"]`); return c ? c.getAttribute('title') || '' : ''; };
      const partage = piste('laser_game') && piste('laser_game').querySelector('.fg-track__share');
      return {
        bowling: raisons('bowling'),
        laser: raisons('laser_game'),
        titreBowling13: titre('bowling', '13:00'),
        partage: partage ? partage.textContent.replace(/\s+/g, ' ').trim() : '',
        partageBowling: Boolean(piste('bowling') && piste('bowling').querySelector('.fg-track__share')),
      };
    });
    const ligne = (liste, heure) => liste.find((l) => l.heures.split(' ').includes(heure)) || { texte: '', phrase: '', heures: '' };
    // Les places libres annoncees : un nombre, ou une fourchette qui contient celui de l heure.
    const libresDites = (phrase) => {
      let m = /(\d+) (?:ou|à) (\d+) sont libres/.exec(phrase); if (m) return [Number(m[1]), Number(m[2])];
      m = /(\d+) sont libres/.exec(phrase); if (m) return [Number(m[1]), Number(m[1])];
      return null;
    };
    const court = (p) => p.length > 0 && p.length <= 60 && !/complet/i.test(p);
    const b13 = ligne(lu.bowling, '13:00');
    ok(court(b13.phrase) && /\b2 pistes\b/.test(b13.phrase) && /aucune n’est libre/.test(b13.phrase),
      '[B] bowling 13:00, en une ligne courte sans redire « complet » : il faut 2 pistes, aucune n’est libre', b13.texte);
    ok(/6 joueurs max par piste, il vous faut 2 pistes et aucune n’est libre/.test(lu.titreBowling13),
      '[B] et la case de 13:00 garde le calcul entier en titre (6 joueurs max par piste, 2 pistes, aucune libre)', lu.titreBowling13);
    const l1530 = ligne(lu.laser, '15:30'), l1600 = ligne(lu.laser, '16:00');
    const f1530 = libresDites(l1530.phrase), f1600 = libresDites(l1600.phrase);
    ok(court(l1530.phrase) && /\b10 places\b/.test(l1530.phrase) && Boolean(f1530) && f1530[0] <= 8 && f1530[1] >= 8,
      '[B] laser 15:30, en une ligne courte : il faut 10 places, et ses 8 places libres sont dites', l1530.texte);
    ok(court(l1600.phrase) && /\b10 places\b/.test(l1600.phrase) && Boolean(f1600) && f1600[0] <= 9 && f1600[1] >= 9 && l1600.heures.split(' ').includes('16:30'),
      '[B] laser 16:00 et 16:30, sur une meme ligne : il faut 10 places, et leurs 9 places libres sont dites', l1600.texte);
    const parLibre = lu.bowling.concat(lu.laser).filter((l) => /billard|duckpin|fun run/i.test(l.texte));
    ok(parLibre.length === 0, '[B] aucune ligne ne ferme une heure a cause du billard, du duckpin ou du Fun Run', parLibre.map((l) => l.texte).join(' | '));
    ok(lu.partage === 'Partie de 20 min, + 5 à 10 min de règles. Partie partagée (jusqu’à 30 joueurs) : d’autres groupes peuvent jouer avec vous.',
      '[B] la piste du laser dit que la partie se partage, avec les places du centre', lu.partage);
    ok(!lu.partageBowling, '[B] la phrase du partage ne parle que du laser');
  } finally {
    await page.close();
  }
}

async function main() {
  const server = await serveur();
  let browser = null;
  try {
    await verifierApi();
    browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
    await verifierFormulaire(browser);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  if (failures) {
    console.error(`\ncomplet-explique-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\ncomplet-explique-check: ALL OK (les activites libres ne ferment plus les heures, un « Complet » dit son calcul, le laser dit qu il se partage)');
}

if (process.argv.includes('--mutate')) {
  const empreintes = new Map(MUTATIONS.map((m) => [m.fichier, fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')]));
  const { spawnSync } = require('child_process');
  let ratees = 0;
  MUTATIONS.forEach((mutation, index) => {
    const run = spawnSync(process.execPath, [__filename], {
      encoding: 'utf8',
      env: { ...process.env, PINLANE_COMPLET_MUTATION: String(index + 1) },
    });
    const sortie = `${run.stdout || ''}${run.stderr || ''}`;
    // Le crochet a-t-il MORDU ? Sans cette preuve, un fils qui echoue pour une
    // autre raison (port pris, module absent) se lirait comme une contre-epreuve.
    const mordu = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
    if (run.status === 1 && mordu) {
      console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom}.`);
    } else {
      ratees += 1;
      console.log(sortie);
      console.log(`CONTRE-EPREUVE RATEE (code ${run.status}, mutation ${mordu ? 'servie' : 'JAMAIS servie'}) : ${mutation.nom}.`);
    }
  });
  const touches = [...empreintes].filter(([fichier, avant]) => fs.readFileSync(path.join(ROOT, fichier), 'utf8') !== avant).map(([fichier]) => fichier);
  if (touches.length) { console.log(`LE DISQUE A ETE ECRIT : ${touches.join(', ')}`); ratees += 1; }
  if (ratees) process.exit(1);
  console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et aucun fichier n a ete ecrit.`);
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}

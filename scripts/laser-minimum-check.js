#!/usr/bin/env node
'use strict';
// =============================================================================
// LE LASER SE JOUE A DEUX AU MOINS
// -----------------------------------------------------------------------------
// Movsar, 2026-09-28 : « laser game, 1 pas possible faut etre deux minimum ».
// Le site du centre dit la meme chose (« de 2 a 30 personnes »). L audit QA du
// meme jour l avait releve : le tunnel laissait reserver une partie pour une
// personne seule, et HAPPY LASER AND GAME ou FUN FRIDAY MADNESS se vendaient
// des 1 personne alors qu elles lancent une partie de laser.
//
// LA REGLE A UNE SOURCE : le catalogue de l activite (booking.minPax du
// laser_game). Tout le reste la lit :
//   [A] le catalogue la porte, la meta publique la sert (activite ET formules :
//       une formule qui lance sa partie en herite, MATIN MALIN qui n en lance
//       aucune garde son minimum) ;
//   [B] le moteur : la ligne de visite la marque, la formule la refuse avec
//       sa raison ;
//   [C] la porte publique refuse un envoi force (visite ou laser seul) ;
//   [D] la disponibilite publique ne rend aucun depart et dit pourquoi ;
//   [E] le formulaire Fun Galaxy : la carte dit « 2 joueurs minimum », reste
//       touchable a 1 personne et dit pourquoi au lieu de cocher ; la formule
//       dit que c est le laser qui l exige ;
//   [F] contre-epreuves : chaque regle retiree, ce gate ROUGIT.
// =============================================================================
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PINLANE_LASERMIN_PORT || 4383);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const CENTRE = 'libramont';
// Un jeudi et un vendredi hors vacances et feries : les jours de HAPPY LASER
// AND GAME et de FUN FRIDAY MADNESS, pour que le minimum soit la SEULE raison.
const JEUDI = '2026-12-03';
const VENDREDI = '2026-12-04';

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }
function frais(modulePath) {
  const resolu = require.resolve(modulePath);
  Object.keys(require.cache).forEach((cle) => { delete require.cache[cle]; });
  return require(resolu);
}
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return false; }
}

async function appelMeta(centerId) {
  const handler = require('../api/public-booking-meta');
  const req = { method: 'GET', url: `/api/public-booking-meta?centerId=${centerId}`, headers: { host: 'localhost', 'x-forwarded-for': '10.9.0.3' }, socket: { remoteAddress: '10.9.0.3' } };
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (code, headers) => { res.statusCode = code; Object.assign(res.headers, headers || {}); };
  res.end = (chunk) => { res.body = chunk === undefined ? '' : String(chunk); };
  await handler(req, res);
  try { return JSON.parse(res.body || '{}'); } catch (error) { return {}; }
}

// La porte publique : le normaliseur que la creation publique appelle.
function porte(corps, channel = 'public') {
  const { normalizeReservationRequest } = require('../lib/reservation-request');
  try {
    normalizeReservationRequest({ centerId: CENTRE, date: '2026-12-05', startTime: '14:00', name: 'QA', email: 'qa@example.com', phone: '+32491000000', ...corps }, { channel });
    return { refuse: false, code: 0, message: '' };
  } catch (error) {
    return { refuse: true, code: Number(error.statusCode) || 0, message: String(error.message || '') };
  }
}

// ---------------------------------------------------------------------------
// LES REGLES, EXECUTEES PAR LE VRAI CODE (rejouees par les contre-epreuves)
// ---------------------------------------------------------------------------
function reglesServeur() {
  const { listCenterActivities, activityMinPax } = require('../lib/activity-catalog');
  const { normalizeProgram } = require('../lib/visit-program');
  const bc = require('../lib/booking-config');
  const laser = listCenterActivities(CENTRE).find((a) => a.id === 'laser_game') || {};
  const formules = bc.getEffectiveFormules(CENTRE);
  const f = (id) => formules.find((x) => x.id === id) || {};
  const seul = normalizeProgram([{ activityId: 'laser_game', games: 1 }], { centerId: CENTRE, pax: 1 }).items[0] || {};
  const deux = normalizeProgram([{ activityId: 'laser_game', games: 1 }], { centerId: CENTRE, pax: 2 }).items[0] || {};
  const dispo = (id, date, pax) => bc.getFormuleAvailability(f(id), date, pax, '', { id: CENTRE });
  return {
    laserMinPax: laser.minPax,
    minBowling: activityMinPax(CENTRE, 'bowling'),
    minLaser: activityMinPax(CENTRE, 'laser_game'),
    seul, deux,
    hlg: f('hlg'), ffm: f('ffm'), mm: f('mm'), f1: f('f1'), kfd: f('kfd'),
    hlg1: dispo('hlg', JEUDI, 1), hlg2: dispo('hlg', JEUDI, 2),
    ffm1: dispo('ffm', VENDREDI, 1), mm1: dispo('mm', JEUDI, 1), f1x5: dispo('f1', '2026-12-05', 5),
    porteVisite1: porte({ type: 'visite', pax: 1, program: [{ activityId: 'laser_game', games: 1 }] }),
    porteVisite2: porte({ type: 'visite', pax: 2, program: [{ activityId: 'laser_game', games: 1 }] }),
    // Bowling + laser : la visite devient un dossier bowling, seule la marque
    // de la ligne de laser dit le manque.
    porteMixte1: porte({ type: 'visite', pax: 1, program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }] }),
    porteLaser1: porte({ type: 'laser', pax: 1, duration: 0.5, laserGames: 1 }),
    porteLaser2: porte({ type: 'laser', pax: 2, duration: 0.5, laserGames: 1 }),
  };
}

function verifierServeur(r) {
  section('A. LE CATALOGUE PORTE LA REGLE, LA META LA SERT');
  ok(r.laserMinPax === 2, 'le catalogue de Libramont sert le laser avec 2 joueurs minimum', `minPax=${r.laserMinPax}`);
  ok(r.minLaser === 2 && r.minBowling === 0, 'activityMinPax : 2 pour le laser, rien pour le bowling', `laser=${r.minLaser} bowling=${r.minBowling}`);
  ok(r.hlg.minPax === 2 && r.hlg.minPaxLaser === true && r.ffm.minPax === 2 && r.ffm.minPaxLaser === true,
    'HAPPY LASER AND GAME et FUN FRIDAY MADNESS lancent leur partie : minimum 2, et la raison voyage (minPaxLaser)',
    `hlg=${r.hlg.minPax}/${r.hlg.minPaxLaser} ffm=${r.ffm.minPax}/${r.ffm.minPaxLaser}`);
  ok(r.mm.minPax === 1 && !r.mm.minPaxLaser, 'MATIN MALIN (fenetre ouverte, parties placees sur place) garde son minimum de 1', `mm=${r.mm.minPax}`);
  ok(r.f1.minPax === 6 && !r.f1.minPaxLaser && r.kfd.minPax === 1 && !r.kfd.minPaxLaser,
    'une formule deja au-dessus (FORMULE 1 : 6) ou sans laser (KIDS FUN DAY) ne bouge pas', `f1=${r.f1.minPax} kfd=${r.kfd.minPax}`);

  section('B. LE MOTEUR');
  ok(r.seul.belowMinPax === 2 && r.deux.belowMinPax === undefined, 'la ligne de laser d une visite marque le manque a 1 joueur, rien a 2',
    `1 : ${JSON.stringify(r.seul.belowMinPax)} ; 2 : ${JSON.stringify(r.deux.belowMinPax)}`);
  ok(!r.hlg1.ok && /laser game se joue à 2 minimum/.test(r.hlg1.message) && r.hlg2.ok,
    'HAPPY LASER AND GAME un jeudi : refusee a 1 avec la raison du laser, acceptee a 2', `${r.hlg1.message} / ${r.hlg2.message}`);
  ok(!r.ffm1.ok && /laser game/.test(r.ffm1.message), 'FUN FRIDAY MADNESS un vendredi : refusee a 1 par le laser', r.ffm1.message);
  ok(r.mm1.ok, 'MATIN MALIN un jeudi a 1 personne reste possible', r.mm1.message);
  ok(!r.f1x5.ok && r.f1x5.message === 'Min. 6 personnes', 'FORMULE 1 garde son message a elle (« Min. 6 personnes »)', r.f1x5.message);

  section('C. LA PORTE PUBLIQUE');
  ok(r.porteVisite1.refuse && r.porteVisite1.code === 422 && r.porteVisite1.message === 'Laser Game se joue à 2 joueurs minimum.',
    'une visite laser envoyee pour 1 personne est refusee en 422, avec la raison', `${r.porteVisite1.code} « ${r.porteVisite1.message} »`);
  ok(!r.porteVisite2.refuse, 'la meme visite pour 2 personnes passe', r.porteVisite2.message);
  ok(r.porteMixte1.refuse && r.porteMixte1.code === 422 && r.porteMixte1.message === 'Laser Game se joue à 2 joueurs minimum.',
    'bowling + laser pour 1 personne : refuse aussi, c est la ligne de laser qui le dit', `${r.porteMixte1.code} « ${r.porteMixte1.message} »`);
  ok(r.porteLaser1.refuse && r.porteLaser1.code === 422 && r.porteLaser1.message === 'Le laser game se joue à 2 joueurs minimum.',
    'un laser seul pour 1 personne est refuse en 422', `${r.porteLaser1.code} « ${r.porteLaser1.message} »`);
  ok(!r.porteLaser2.refuse, 'un laser seul pour 2 personnes passe', r.porteLaser2.message);
}

// ---------------------------------------------------------------------------
// LE SERVEUR DU FORMULAIRE (mock de dev, disponibilite reelle)
// ---------------------------------------------------------------------------
const MUTATION_TUNNEL = ['      var peu = !trop && tropPeu(a);', '      var peu = false;'];
let tunnelCasse = false;
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (tunnelCasse && url.pathname === '/assets/fungalaxy-booking.js') {
      const src = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(MUTATION_TUNNEL[0], MUTATION_TUNNEL[1]));
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function dispoHttp(params) {
  const q = new URLSearchParams({ centerId: CENTRE, ...params });
  const r = await fetch(`${BASE_URL}/api/public-availability?${q.toString()}`);
  try { return await r.json(); } catch (error) { return {}; }
}

async function versActivites(page, mock, pax) {
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
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  await attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await attendre(page, () => document.querySelector('#dayPop').hidden, 3000);
  await page.fill('#paxInput', String(pax));
  await page.press('#paxInput', 'Enter');
  await attendre(page, (n) => document.querySelector('#paxInput').value === String(n), 3000, pax);
  await page.click('#goActivities');
  return attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000);
}

function lireCarteLaser(page) {
  return page.evaluate(() => {
    const c = document.querySelector('#gridAct .fg-card[data-activity="laser_game"]');
    if (!c) return null;
    const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    return {
      refus: c.classList.contains('is-refus'),
      coche: c.getAttribute('aria-checked') === 'true',
      desactivee: c.getAttribute('aria-disabled') === 'true',
      tab: c.tabIndex,
      prix: txt(c.querySelector('.fg-card__price')),
      raison: txt(c.querySelector('.fg-for__off')),
      pulse: Boolean(c.querySelector('.fg-for__off.is-pulse')),
      suite: document.querySelector('#goHours').disabled,
    };
  });
}

async function parcoursTunnel(browser, mock, { pax, cliquer }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  const arrive = await versActivites(page, mock, pax);
  const avant = await lireCarteLaser(page);
  if (cliquer) await page.click('#gridAct .fg-card[data-activity="laser_game"]');
  await page.waitForTimeout(250);
  const apres = await lireCarteLaser(page);
  await page.click('#tabFor');
  await attendre(page, () => !document.querySelector('#panelFor').hidden, 3000);
  const hlg = await page.evaluate(() => {
    const c = document.querySelector('#gridFor .fg-card[data-formule="hlg"]');
    const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    return c ? { refus: c.classList.contains('is-refus'), raison: txt(c.querySelector('.fg-for__off')), regles: txt(c.querySelector('.fg-for__rules')) } : null;
  });
  await ctx.close();
  return { arrive, avant, apres, hlg, erreurs };
}

async function main() {
  // Le dev-tunnel-server remplace la lecture de base (instantane vide) : le
  // charger AVANT tout le reste, comme les autres gates du formulaire.
  const mock = require('./dev-tunnel-server');
  verifierServeur(reglesServeur());

  const { chromium } = require('playwright-core');
  const srv = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    section('D. LA DISPONIBILITE PUBLIQUE');
    const programme = JSON.stringify([{ activityId: 'laser_game', games: 1 }]);
    const v1 = await dispoHttp({ date: mock.DATE, type: 'visite', pax: '1', program: programme, softReserve: '1' });
    const v2 = await dispoHttp({ date: mock.DATE, type: 'visite', pax: '2', program: programme, softReserve: '1' });
    ok(Array.isArray(v1.slots) && v1.slots.length === 0 && v1.message === 'Laser Game se joue à 2 joueurs minimum.',
      'visite laser a 1 personne : aucun depart, et la raison', `${(v1.slots || []).length} depart(s) « ${v1.message} »`);
    ok(Array.isArray(v2.slots) && v2.slots.length > 0, 'la meme visite a 2 personnes rend des departs', `${(v2.slots || []).length} depart(s)`);
    const l1 = await dispoHttp({ date: mock.DATE, type: 'laser', pax: '1', duration: '0.5', laserGames: '1' });
    const l2 = await dispoHttp({ date: mock.DATE, type: 'laser', pax: '2', duration: '0.5', laserGames: '1' });
    ok(Array.isArray(l1.slots) && l1.slots.length === 0 && l1.message === 'Le laser game se joue à 2 joueurs minimum.',
      'laser seul a 1 personne (ancien tunnel) : aucun depart, et la raison', `${(l1.slots || []).length} depart(s) « ${l1.message} »`);
    ok(Array.isArray(l2.slots) && l2.slots.length > 0, 'laser seul a 2 personnes : des departs', `${(l2.slots || []).length} depart(s)`);

    section('E. LE FORMULAIRE FUN GALAXY');
    const seul = await parcoursTunnel(browser, mock, { pax: 1, cliquer: true });
    ok(seul.arrive && seul.avant, 'MONTAGE le formulaire arrive aux activites avec une carte Laser');
    const a1 = seul.avant || {};
    const b1 = seul.apres || {};
    ok(/2 joueurs minimum/.test(a1.prix), 'la carte Laser dit « 2 joueurs minimum » a cote de son prix', `« ${a1.prix} »`);
    ok(a1.refus && a1.raison === 'Il faut être au moins 2 joueurs. Vous êtes 1.',
      'a 1 personne, la carte est refusee et dit pourquoi, en francais courant', `« ${a1.raison} »`);
    ok(!a1.desactivee && a1.tab === 0, 'elle reste touchable (ni aria-disabled ni hors tabulation) : la raison doit pouvoir se lire', `aria-disabled=${a1.desactivee} tabindex=${a1.tab}`);
    ok(!b1.coche && b1.suite && b1.pulse, 'la toucher ne la coche pas, ne debloque pas la suite, et fait ressortir la raison',
      `cochee=${b1.coche} suite bloquee=${b1.suite} raison soulignee=${b1.pulse}`);
    ok(seul.hlg && seul.hlg.refus && seul.hlg.raison === 'Le laser game de cette formule se joue à 2 minimum. Vous êtes 1.',
      'HAPPY LASER AND GAME a 1 personne dit que c est son laser qui exige 2 joueurs', JSON.stringify(seul.hlg));
    ok(seul.hlg && /dès 2 personnes/.test(seul.hlg.regles), 'et ses conditions affichent « dès 2 personnes »', seul.hlg ? `« ${seul.hlg.regles} »` : '');
    const duo = await parcoursTunnel(browser, mock, { pax: 2, cliquer: true });
    const b2 = duo.apres || {};
    ok(duo.avant && !duo.avant.refus && b2.coche && !b2.suite, 'a 2 personnes, la carte se coche et la suite s ouvre', JSON.stringify({ refus: (duo.avant || {}).refus, cochee: b2.coche, suite: !b2.suite }));
    ok(seul.erreurs.length === 0 && duo.erreurs.length === 0, 'aucune erreur JavaScript', seul.erreurs.concat(duo.erreurs).slice(0, 3).join(' | '));

    section('F. CONTRE-EPREUVES');
    // Le formulaire : sans le refus, la carte se coche a 1 personne.
    const srcTunnel = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
    if (ok(srcTunnel.split(MUTATION_TUNNEL[0]).length === 2, 'contre-epreuve montable : le refus de la carte se trouve une seule fois dans le formulaire')) {
      tunnelCasse = true;
      const casse = await parcoursTunnel(browser, mock, { pax: 1, cliquer: true });
      tunnelCasse = false;
      ok(casse.apres && casse.apres.coche === true, 'sans le refus, la carte se coche a 1 personne : ce gate ROUGIRAIT', JSON.stringify(casse.apres));
    }
  } finally {
    await browser.close();
    srv.close();
  }

  // Le serveur : chaque regle retiree, sa verification rougit.
  const MUTATIONS = [
    {
      fichier: 'ops-knowledge/activities.json',
      ancre: '"unitLabel": "par personne",\r\n        "minPax": 2',
      mute: '"unitLabel": "par personne"',
      label: 'sans le minimum au catalogue, la visite laser pour 1 passe la porte',
      rouge: (r) => r.porteVisite1.refuse === false && r.seul.belowMinPax === undefined,
    },
    {
      fichier: 'lib/booking-config.js',
      ancre: "if (lanceSaPartie) laser = require('./activity-catalog').activityMinPax(centerId, 'laser_game');",
      mute: 'if (lanceSaPartie) laser = 0;',
      label: 'sans l heritage du laser, HAPPY LASER AND GAME se vend a 1 personne',
      rouge: (r) => r.hlg1.ok === true && r.hlg.minPax === 1,
    },
    {
      fichier: 'lib/reservation-request.js',
      ancre: 'if (sousMinimum || (minimumLaser && Number(request.pax) < minimumLaser)) {',
      mute: 'if (false) {',
      label: 'sans la garde de la porte publique, un envoi force pour 1 personne est accepte',
      rouge: (r) => r.porteVisite1.refuse === false && r.porteLaser1.refuse === false,
    },
    {
      fichier: 'lib/visit-program.js',
      ancre: 'if (players < minimumParticipants) item.belowMinPax = minimumParticipants;',
      mute: '',
      label: 'sans la marque sur la ligne, bowling + laser pour 1 personne passe la porte',
      rouge: (r) => r.seul.belowMinPax === undefined && r.porteMixte1.refuse === false,
    },
  ];
  for (const m of MUTATIONS) {
    const chemin = path.join(ROOT, m.fichier);
    const original = fs.readFileSync(chemin, 'utf8');
    const ancre = original.indexOf('\r\n') >= 0 ? m.ancre : m.ancre.replace(/\r\n/g, '\n');
    const compte = original.split(ancre).length - 1;
    if (!ok(compte === 1, `contre-epreuve montable : « ${ancre.replace(/\s+/g, ' ').slice(0, 50)}… » une seule fois dans ${m.fichier}`, `${compte} occurrence(s)`)) continue;
    let rouge = false;
    try {
      fs.writeFileSync(chemin, original.split(ancre).join(m.mute));
      frais('../lib/booking-config');
      rouge = m.rouge(reglesServeur());
    } catch (error) {
      rouge = true; // le code mute jette : c est aussi un rouge
    } finally {
      fs.writeFileSync(chemin, original);
      frais('../lib/booking-config');
    }
    ok(rouge, `${m.label} : ce gate ROUGIRAIT`);
    ok(fs.readFileSync(chemin, 'utf8') === original, `${m.fichier} restaure a l identique`);
  }
  const apres = reglesServeur();
  ok(apres.porteVisite1.refuse && apres.seul.belowMinPax === 2 && !apres.hlg1.ok, 'code restaure : les regles redisent la verite');

  console.log(`\n${echecs === 0 ? 'laser-minimum-check: ALL OK' : `laser-minimum-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });

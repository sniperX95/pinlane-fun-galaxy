#!/usr/bin/env node
// POUR TOUT FAIRE AVANT LA FERMETURE (Movsar, 2026-10-20).
//
// Sa capture, en prod : visite a la carte, jeudi 22/10, 11 personnes, Bowling
// + Laser Game + Playground + Arcades + Billards. Le client pose le laser a
// 20:30 et le bowling a 21:00, fermeture 22:00 : « Ne tiendront pas avant la
// fermeture (22:00) : Billards (1 h), Arcades (30 min) et Playground ». Sa
// demande : « à moins qu'ils puissent choisir une heure d'arrivée pour pouvoir
// faire toutes les activités qu'ils ont ».
//
// Le serveur cherche l arrivee la plus tardive du jour ou TOUT tient
// (lib/ops-engine.js arriveeLaPlusTardive), chaque combinaison jugee par la
// porte de la reservation (planningAgent, garde finale, fin de la visite,
// installations comptees), et la rend (`fitAll`). L ecran la dit, le bouton
// « Arriver à HH:MM » pose ce plan ; les heures du client restent tant qu il
// ne touche rien.
//
//   [A] API, le cas de la capture : une arrivee ou tout tient, 17:50, et les
//       heures du client restent.
//   [B] API, le plan propose tient vraiment (la meme requete que le toucher),
//       et une demi-heure plus tard ne tient plus : c est la plus tardive.
//   [C] API, tout tient deja : aucune proposition.
//   [D] API, rien ne tient ce jour-la (19:50 le jour meme) : `none`, sans heure.
//   [E] API, une formule dans le meme cas : la meme proposition, qui tient.
//   [F] Ecran (telephone 390x844) : la phrase et le bouton dans l encadre,
//       le toucher pose le plan, le message honnete quand rien ne tient.
//
// Contre-epreuve : node scripts/arrivee-pour-tout-faire-check.js --mutate (7
// mutations servies en memoire, aucun fichier touche).
// Captures : PINLANE_ARRIVEE_CAPTURES=<dossier> enregistre les ecrans du cas.
'use strict';
process.env.TZ = 'Europe/Brussels';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAINTENANT = '2026-10-20T15:00:00+02:00';
const TARD = '2026-10-22T19:50:00+02:00';
const JOUR = '2026-10-22';
const JOUR_FORMULE = '2026-11-05';
const PROGRAMME = [
  { activityId: 'bowling', duration: 1 },
  { activityId: 'laser_game', games: 1 },
  { activityId: 'playground' },
  { activityId: 'arcade_time' },
  { activityId: 'billards', units: 1, hours: 1 },
];
const POSEES = { laser_game: '20:30', bowling: '21:00' };
const ARRIVEE = '17:50';

// L horloge du processus : figee, puis elle avance ; `horloge(iso)` la deplace.
let horloge;
{
  const Vraie = Date;
  let depart = Vraie.now();
  let cible = new Vraie(MAINTENANT).getTime();
  const decale = () => cible + (Vraie.now() - depart);
  class Figee extends Vraie {
    constructor(...a) { if (a.length === 0) super(decale()); else super(...a); }
    static now() { return decale(); }
  }
  global.Date = Figee;
  horloge = (iso) => { depart = Vraie.now(); cible = new Vraie(iso).getTime(); };
}

const CRLF = '\r\n';
const LF = '\n';
const MUTATIONS = [
  {
    nom: 'le serveur ne propose plus rien',
    fichier: 'api/public-availability.js',
    remplacer: [["const fitAll = typeof proposer === 'function' ? proposer(creneaux[0] || null) : null;", 'const fitAll = null;']],
  },
  {
    nom: 'la recherche part de la premiere heure du jour, pas de la plus tardive',
    fichier: 'lib/ops-engine.js',
    remplacer: [['essais.sort((gauche, droite) => droite.debut - gauche.debut || gauche.fin - droite.fin);', 'essais.sort((gauche, droite) => gauche.debut - droite.debut || gauche.fin - droite.fin);']],
  },
  {
    nom: 'la proposition ne se juge plus sur la fin de la visite',
    fichier: 'api/public-availability.js',
    remplacer: [
      ['            minimum: Math.max(0, (Number(program.freeMinutes) || 0) - (Number(program.waitMinutes) || 0)),\n', ''],
      ['if (!slot || !(Number.isFinite(fin) && fin <= fermetureDuJour) || dotationDuCreneau(slot, fin)) return null;', 'if (!slot) return null;'],
    ],
  },
  {
    nom: 'une proposition aussi quand tout tient',
    fichier: 'api/public-availability.js',
    remplacer: [['const neTientPas = (creneau) => Boolean(creneau && creneau.visitEndsAtClose && Number(creneau.visitShortfallMinutes) > 0);', 'const neTientPas = (creneau) => Boolean(creneau);']],
  },
  {
    nom: 'rien ne dit qu aucune heure ne tient',
    fichier: 'api/public-availability.js',
    remplacer: [["          return { closeTime: heureDe(fermetureDuJour), ...(trouvee || { none: true }) };\n        };\n        const neTientPas", "          return trouvee ? { closeTime: heureDe(fermetureDuJour), ...trouvee } : null;\n        };\n        const neTientPas"]],
  },
  {
    nom: 'la formule ne propose rien',
    fichier: 'api/public-availability.js',
    remplacer: [["const fitAll = plan?.plan?.refusalCode === 'schedule' ? pourToutFaire() : null;", 'const fitAll = null;']],
  },
  {
    nom: 'le bouton ne pose pas le plan',
    fichier: 'assets/fungalaxy-booking.js',
    remplacer: [['if (heuresFit[k]) state.pins[k] = String(heuresFit[k]).slice(0, 5);', 'void k;']],
  },
];
const MUTATION_PREUVE = '[mutation] servie en memoire :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_ARRIVEE_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
function muter(contenu, mutation) {
  let texte = contenu.split(CRLF).join(LF);
  mutation.remplacer.forEach(([de, vers]) => {
    if (texte.split(de).length - 1 !== 1) {
      console.error(`mutation impossible : ancre absente ou multiple dans ${mutation.fichier} : ${de.slice(0, 70)}`);
      process.exit(2);
    }
    texte = texte.split(de).join(vers);
  });
  console.log(`${MUTATION_PREUVE} ${mutation.nom}`);
  return texte;
}
// Le crochet est pose AVANT tout require applicatif.
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

const database = require('../lib/database');
database.readAvailabilitySnapshot = async (date, centerId) => ({ reservations: [], laneStatuses: {}, blocks: [], date, centerId });
database.readStaffState = database.readAvailabilitySnapshot;
const dispo = require('../api/public-availability');
const { verifierEcritureClient } = require('../lib/client-writing');

let ip = 0;
async function heures(q) {
  ip += 1;
  const adresse = `10.9.${ip % 250}.${1 + (ip % 200)}`;
  const req = { method: 'GET', url: `/api/public-availability?${new URLSearchParams({ centerId: 'libramont', ...q }).toString()}`, headers: { host: 'localhost', 'x-forwarded-for': adresse }, socket: { remoteAddress: adresse } };
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.getHeader = (k) => res.headers[k];
  res.writeHead = (code) => { res.statusCode = code; };
  res.end = (b) => { res.body = b === undefined ? '' : String(b); };
  await dispo(req, res);
  try { return JSON.parse(res.body || '{}'); } catch (error) { return {}; }
}
const visite = (q = {}) => heures({ type: 'visite', date: JOUR, pax: '11', softReserve: '1', program: JSON.stringify(PROGRAMME), ...q });
const formule = (q = {}) => heures({ type: 'formule', formuleId: 'f1', date: JOUR_FORMULE, pax: '11', ...q });
const posees = (heuresPosees) => ({ preferredTimes: JSON.stringify(heuresPosees), ...(heuresPosees.laser_game ? { laserGameTimes: JSON.stringify([heuresPosees.laser_game]) } : {}) });
const minutesDe = (t) => { const [h, m] = String(t || '').split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const decaler = (times, minutes) => Object.fromEntries(Object.entries(times).map(([id, t]) => [id, hhmm(minutesDe(t) + minutes)]));
const debuts = (slot) => Object.fromEntries(((slot && slot.opsPlan && slot.opsPlan.resourceBlocks) || []).filter((b) => b.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime)).reverse().map((b) => [b.activityId, b.startTime]));
const tient = (rep) => {
  const slot = (rep.slots || [])[0];
  return Boolean(slot && !slot.visitEndsAtClose && minutesDe(slot.visitEndTime) <= 22 * 60);
};
const memesHeures = (slot, times) => Object.keys(times).every((id) => debuts(slot)[id] === times[id]);

async function main() {
  section('A. LE CAS DE LA CAPTURE : UNE ARRIVEE OU TOUT TIENT');
  const a = await visite(posees(POSEES));
  const sa = (a.slots || [])[0] || null;
  ok(sa && sa.visitEndsAtClose && ((sa.visitShortfallItems || []).map((h) => h.name).join(',') === 'Billards,Arcades,Playground'), '[A] (le cas est reproduit) Billards, Arcades et Playground ne tiennent pas', JSON.stringify(sa && sa.visitShortfallItems));
  ok(sa && memesHeures(sa, POSEES), '[A] les heures du client restent tant qu il ne touche rien (laser 20:30, bowling 21:00)', JSON.stringify(debuts(sa)));
  const fit = a.fitAll || {};
  ok(fit.closeTime === '22:00' && fit.arrival === ARRIVEE && fit.times && fit.times.bowling && fit.times.laser_game, `[A] la proposition : arriver a ${ARRIVEE}, avec une heure par activite`, JSON.stringify(a.fitAll));

  section('B. LE PLAN PROPOSE TIENT VRAIMENT, ET C EST LE PLUS TARDIF');
  if (fit.times) {
    const b = await visite(posees(fit.times));
    const sb = (b.slots || [])[0] || null;
    ok(tient(b) && memesHeures(sb, fit.times), '[B] la requete du toucher : un creneau a ces heures, tout tient avant 22:00', sb ? `${JSON.stringify(debuts(sb))} fin ${sb.visitEndTime}` : b.message);
    ok(sb && sb.opsPlan.arrivalTime === fit.arrival && sb.visitEndTime === fit.endTime, '[B] l arrivee et la fin annoncees sont celles du plan', sb ? `${sb.opsPlan.arrivalTime} / ${sb.visitEndTime}` : '');
    const plusTard = await visite(posees(decaler(fit.times, 30)));
    ok(!tient(plusTard), '[B] une demi-heure plus tard, la visite ne tient plus : la proposition est la plus tardive', JSON.stringify(decaler(fit.times, 30)));
  } else ok(false, '[B] aucune heure proposee a juger');

  section('C. TOUT TIENT DEJA : AUCUNE PROPOSITION');
  const c = await visite();
  ok(tient(c) && !c.fitAll, '[C] sans heure posee, tout tient : aucune proposition', JSON.stringify(c.fitAll || null));
  if (fit.times) {
    const c2 = await visite(posees(fit.times));
    ok(!c2.fitAll, '[C] le plan propose pose : plus de proposition', JSON.stringify(c2.fitAll || null));
  }

  section('D. RIEN NE TIENT CE JOUR-LA : LE DIRE, SANS RIEN INVENTER');
  horloge(TARD);
  const d = await visite(posees(POSEES));
  ok(d.fitAll && d.fitAll.none === true && !d.fitAll.arrival && !d.fitAll.times, '[D] le 22/10 a 19:50 : aucune heure, `none`', JSON.stringify(d.fitAll || null));
  horloge(MAINTENANT);

  section('E. UNE FORMULE DANS LE MEME CAS');
  const e = await formule(posees(POSEES));
  const fe = e.fitAll || {};
  ok(!(e.slots || []).length && fe.arrival && minutesDe(fe.arrival) < minutesDe('20:20') && fe.times, '[E] FORMULE 1, laser 20:30 et bowling 21:00 : refusee, une arrivee plus tot proposee', `${e.message} ${JSON.stringify(e.fitAll || null)}`);
  if (fe.times) {
    const e2 = await formule(posees(fe.times));
    const se = (e2.slots || [])[0] || null;
    ok(se && !se.visitEndsAtClose && memesHeures(se, fe.times) && se.opsPlan.arrivalTime === fe.arrival && !e2.fitAll, '[E] le plan propose tient (formule), sans nouvelle proposition', se ? `${JSON.stringify(debuts(se))} fin ${se.visitEndTime}` : e2.message);
    const e3 = await formule(posees(decaler(fe.times, 30)));
    const s3 = (e3.slots || [])[0] || null;
    ok(!s3 || s3.visitEndsAtClose, '[E] une demi-heure plus tard ne tient plus (formule)', s3 ? s3.visitEndTime : e3.message);
  }

  section('F. L ECRAN, TELEPHONE 390x844');
  await ecran();

  console.log(failures ? `\narrivee-pour-tout-faire-check: ${failures} defaut(s).` : '\narrivee-pour-tout-faire-check: ALL OK (l arrivee la plus tardive ou tout tient est proposee, tient, se pose d un toucher ; rien quand tout tient ; dit honnetement quand rien ne tient ; formule pareil)');
  process.exit(failures ? 1 : 0);
}

async function ecran() {
  const PORT = Number(process.env.PINLANE_ARRIVEE_PORT || 4521);
  const BASE = `http://127.0.0.1:${PORT}`;
  const CAPTURES = process.env.PINLANE_ARRIVEE_CAPTURES || '';
  if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const server = mock.createServer({ port: PORT });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const txt = (s) => s.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  const ouvrir = async (maintenant) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const erreurs = [];
    page.on('pageerror', (err) => erreurs.push(String((err && err.message) || err)));
    if (MUTATION && MUTATION.fichier.startsWith('assets/')) {
      const mute = muter(fs.readFileSync(path.join(ROOT, MUTATION.fichier), 'utf8'), MUTATION);
      await page.route(`**/${MUTATION.fichier}*`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: mute }));
    }
    await page.clock.setFixedTime(new Date(maintenant));
    await page.goto(`${BASE}/fungalaxy/libramont`);
    await page.click('#dayBtn');
    for (let i = 0; i < 4; i += 1) {
      if (await page.$(`#calGrid .fg-cal__day[data-date="${JOUR}"]`)) break;
      await page.click('#calNext');
    }
    await page.click(`#calGrid .fg-cal__day[data-date="${JOUR}"]`);
    await page.fill('#paxInput', '11');
    await page.click('#goActivities');
    for (const it of PROGRAMME) await page.click(`#gridAct .fg-card[data-activity="${it.activityId}"]`);
    await page.click('#goHours');
    await page.waitForSelector('#planZone .fg-visit, .fg-notice', { timeout: 20000 });
    return { page, erreurs };
  };
  // Une heure se pose comme le client la touche ; le plan qui suit est attendu.
  const poser = async (page, id, time) => {
    await page.$eval(`.fg-track[data-activity="${id}"] .fg-chip[data-time="${time}"]`, (b) => b.click());
    await page.waitForFunction(() => !document.querySelector('#hourZone.is-busy'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  };
  const lire = (page) => page.evaluate(() => {
    const t = (n) => (n ? n.textContent.replace(/[\s\u00a0\u202f]+/g, ' ').trim() : '');
    const bouton = document.querySelector('#planZone [data-fit]');
    return {
      encadre: t(document.querySelector('#planZone .fg-visit__hors')),
      phrase: t(document.querySelector('#planZone .fg-fit')),
      bouton: t(bouton),
      notice: t(document.querySelector('#planZone .fg-notice')),
      allers: Array.from(document.querySelectorAll('#planZone .fg-visit__hors [data-goto]')).map((b) => b.dataset.goto),
      posees: Object.fromEntries(Array.from(document.querySelectorAll('.fg-track')).map((tr) => [tr.dataset.activity, Array.from(tr.querySelectorAll('.fg-chip.is-on')).map((c) => c.dataset.time)])),
      arrivee: t(document.querySelector('#planZone .fg-visit__step--in b')),
      voix: t(document.querySelector('#fgLive')),
    };
  });
  try {
    const { page, erreurs } = await ouvrir(MAINTENANT);
    await poser(page, 'laser_game', POSEES.laser_game);
    await poser(page, 'bowling', POSEES.bowling);
    const v = await lire(page);
    const attendue = `Pour tout faire avant 22:00, arrivez à ${ARRIVEE} : Bowling à 18:00, puis Laser Game à 19:00.`;
    ok(v.encadre.indexOf('Ne tiendront pas avant la fermeture (22:00)') === 0 && v.encadre.indexOf('Vos heures ne bougent pas') > 0, '[F] l encadre de la capture reste (ce qui ne tiendra pas, les heures gardees)', v.encadre.slice(0, 120));
    ok(v.phrase === attendue && v.encadre.indexOf(attendue) > 0, '[F] la proposition dans l encadre, avec les nouvelles heures', v.phrase);
    ok(v.bouton === `Arriver à ${ARRIVEE}`, `[F] le bouton « Arriver à ${ARRIVEE} »`, v.bouton);
    ok(v.voix.indexOf(attendue) >= 0, '[F] la voix dit la meme proposition', v.voix.slice(-160));
    const ecarts = verifierEcritureClient(v.phrase, { etat: 'sans-promesse' });
    ok(!ecarts.length && !/[\u2013\u2014]/.test(v.phrase) && (v.phrase.match(/\s:\s/g) || []).length <= 1, '[F] la phrase respecte l ecriture client (vouvoiement, ni « on » ni « nous », un seul « : », aucune promesse, aucun tiret long)', JSON.stringify(ecarts));
    ok(JSON.stringify(v.posees.laser_game) === '["20:30"]' && JSON.stringify(v.posees.bowling) === '["21:00"]', '[F] avant le toucher, les heures du client restent posees', JSON.stringify(v.posees));
    if (CAPTURES) {
      await page.$eval('#planZone', (z) => z.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: path.join(CAPTURES, `${process.env.PINLANE_ARRIVEE_PREFIXE || 'apres-correctif'}-1-proposition.png`) });
    }
    const b = await page.$('#planZone [data-fit]');
    if (b) {
      await b.click();
      await page.waitForFunction(() => !document.querySelector('#hourZone.is-busy') && !document.querySelector('#planZone [data-fit]'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
    const w = await lire(page);
    ok(JSON.stringify(w.posees.bowling) === '["18:00"]' && JSON.stringify(w.posees.laser_game) === '["19:00"]', '[F] le toucher pose le plan : bowling 18:00, laser 19:00', JSON.stringify(w.posees));
    ok(!w.encadre && !w.bouton && w.arrivee === ARRIVEE, `[F] plus rien ne deborde, l agenda commence a ${ARRIVEE}`, `${w.encadre} | arrivee ${w.arrivee}`);
    if (CAPTURES) {
      await page.$eval('#planZone', (z) => z.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: path.join(CAPTURES, `${process.env.PINLANE_ARRIVEE_PREFIXE || 'apres-correctif'}-2-apres-le-toucher.png`) });
    }
    // Le client peut encore changer : une autre heure de laser se pose.
    await poser(page, 'laser_game', '19:30');
    const x = await lire(page);
    ok(JSON.stringify(x.posees.laser_game) === '["19:30"]', '[F] apres le toucher, chaque heure reste modifiable (laser a 19:30)', JSON.stringify(x.posees));
    ok(erreurs.length === 0, '[F] aucune erreur de page', erreurs.join(' | '));
    await page.close();

    // RIEN NE TIENT : le 22/10 a 19:50.
    horloge(TARD);
    const tard = await ouvrir(TARD);
    await tard.page.waitForTimeout(600);
    const y = await lire(tard.page);
    const honnete = 'Aucune heure de ce jour ne fait tout tenir avant 22:00. Retirez une activité ou choisissez un autre jour.';
    ok(y.phrase === honnete && !y.bouton, '[F] rien ne tient : la phrase le dit, sans heure ni bouton d arrivee', y.phrase || y.notice);
    ok(JSON.stringify(y.allers) === '["activites","date"]', '[F] rien ne tient : retirer une activite ou changer de jour, d un toucher', JSON.stringify(y.allers));
    ok(!verifierEcritureClient(honnete, { etat: 'sans-promesse' }).length, '[F] le message honnete respecte l ecriture client');
    if (CAPTURES) {
      await tard.page.$eval('#planZone', (z) => z.scrollIntoView({ block: 'start' }));
      await tard.page.screenshot({ path: path.join(CAPTURES, `${process.env.PINLANE_ARRIVEE_PREFIXE || 'apres-correctif'}-3-rien-ne-tient.png`) });
    }
    ok(tard.erreurs.length === 0, '[F] aucune erreur de page (rien ne tient)', tard.erreurs.join(' | '));
    horloge(MAINTENANT);
    await tard.page.close();
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv.includes('--mutate')) {
  const eclats = require('./gates-eclats');
  const PORT = Number(process.env.PINLANE_ARRIVEE_PORT || 4521);
  eclats.enPool(MUTATIONS, eclats.nombreDeFils(MUTATIONS.length), (m, fil, i) => eclats.lancer(__filename, [], { env: { ...process.env, PINLANE_ARRIVEE_PORT: String(PORT + 1 + fil), PINLANE_ARRIVEE_MUTATION: String(i + 1), PINLANE_ARRIVEE_CAPTURES: '' } })).then((runs) => {
    let tuees = 0;
    MUTATIONS.forEach((m, i) => {
      const run = runs[i];
      const sortie = `${run.stdout || ''}${run.stderr || ''}`;
      const servie = sortie.indexOf(MUTATION_PREUVE) >= 0;
      const tuee = servie && run.status === 1;
      if (tuee) tuees += 1;
      console.log(`${tuee ? 'TUEE   ' : 'SURVIT '} ${m.nom}${servie ? '' : ' (mutation non servie)'}${tuee ? '' : `  [code ${run.status}]`}`);
    });
    console.log(tuees === MUTATIONS.length ? `\narrivee-pour-tout-faire-check --mutate: ${tuees}/${MUTATIONS.length} mutations tuees` : `\narrivee-pour-tout-faire-check --mutate: ${MUTATIONS.length - tuees} mutation(s) survivante(s)`);
    process.exit(tuees === MUTATIONS.length ? 0 : 1);
  });
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}

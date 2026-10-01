#!/usr/bin/env node
// CE QUI NE TIENDRA PAS AVANT LA FERMETURE, NOMME (Movsar, 2026-10-01).
//
// Sa capture : un mercredi en fin de journee, bowling + laser + minigolf +
// playground + duckpin + fun run. Sans heure posee, l ecran des heures disait
// « Aucune combinaison disponible ce jour-la » ; une fois le bowling coche a
// 20:00, la meme visite passait avec « Serre a toute heure : tout ne tiendra
// pas avant la fermeture ». Sa demande : « faut dire ce qui sera pas possible
// de jouer [...] quand y plusieurs comme ça faut dire tout ce qui se jouera
// pas et les heures choisi doivent etre laisser ».
//
// Cause : la combinaison proposee d office (aucune heure posee) etait jugee
// SANS le mode souple du formulaire (softReserve), alors que la grille l avait
// deja applique a chaque heure. Le serveur nomme maintenant ce qui saute
// (visitShortfallItems, la meme mesure que la fin de la visite) et l ecran le
// dit : sous la derniere piste serree, dans « Votre visite » (lignes rayees et
// encadre), et au recapitulatif.
//
//   [A] API, aucune heure posee : un creneau, et ce qui saute est nomme.
//   [B] API, bowling coche a 20:00 : l heure reste, les memes noms.
//   [C] API, 3 parties de laser : la partie sans heure qui finirait apres la
//       fermeture est nommee, pas celle qui tient.
//   [D] API, les autres tunnels (sans softReserve) gardent leur verdict ; un
//       jour normal ne nomme rien.
//   [E] Ecran (telephone et bureau) : plus d « Aucune combinaison », la note
//       nommee UNE fois, les lignes rayees, l encadre, les heures gardees, le
//       recapitulatif.
//
// L horloge est figee au mercredi 7 octobre 2026, 19:25 a Bruxelles (serveur
// et page) : le gate se rejoue a l identique, quel que soit le jour.
//
// Contre-epreuve : node scripts/ne-tiendra-pas-check.js --mutate (7 mutations,
// servies en memoire, aucun fichier touche).
'use strict';
process.env.TZ = 'Europe/Brussels';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAINTENANT = '2026-10-07T19:25:00+02:00';
const JOUR = '2026-10-07';
const LENDEMAIN = '2026-10-08';
const PROGRAMME = [
  { activityId: 'bowling', duration: 1 },
  { activityId: 'laser_game', games: 1 },
  { activityId: 'minigolf_blacklight' },
  { activityId: 'playground' },
  { activityId: 'duckpin_bowling', duration: 1 },
  { activityId: 'fun_run', games: 2 },
];
const ATTENDUS = ['Minigolf Blacklight', 'Playground', 'Duckpin Bowling'];

// L horloge du processus : figee a MAINTENANT, puis elle avance.
{
  const Vraie = Date;
  const depart = Vraie.now();
  const cible = new Vraie(MAINTENANT).getTime();
  const decale = () => cible + (Vraie.now() - depart);
  class Figee extends Vraie {
    constructor(...a) { if (a.length === 0) super(decale()); else super(...a); }
    static now() { return decale(); }
  }
  global.Date = Figee;
}

const CRLF = '\r\n';
const LF = '\n';
const MUTATIONS = [
  {
    nom: 'la combinaison proposee d office perd le mode souple',
    fichier: 'api/public-availability.js',
    de: '              reserveSoft,\n              reservations: snapshot.reservations,',
    vers: '              reservations: snapshot.reservations,',
  },
  {
    nom: 'le serveur ne nomme plus ce qui saute',
    fichier: 'api/public-availability.js',
    de: '              visitShortfallItems: ceQuiNeTiendraPas(slot, fermeture),',
    vers: '',
  },
  {
    nom: 'la premiere activite qui deborde emporte toutes les suivantes',
    fichier: 'api/public-availability.js',
    de: '          if (minutes <= place) {\n            place -= minutes;',
    vers: '          if (minutes <= place && !hors.some((h) => !h.partie)) {\n            place -= minutes;',
  },
  {
    nom: 'les parties de laser sans heure ne sont jamais nommees',
    fichier: 'api/public-availability.js',
    de: '        if (enAttente.length && aLaSuite > 0) {',
    vers: '        if (false) {',
  },
  {
    nom: 'l encadre redevient « il manque X »',
    fichier: 'assets/fungalaxy-booking.js',
    de: '    if (horsDelai.length) {\n      // Les heures posees ne bougent pas',
    vers: '    if (false) {\n      // Les heures posees ne bougent pas',
  },
  {
    nom: 'chaque piste serree redit la liste',
    fichier: 'assets/fungalaxy-booking.js',
    de: 'var quoi = a.activityId === dernierSerre && sautent.length',
    vers: 'var quoi = sautent.length',
  },
  {
    nom: 'les lignes de la visite ne sont plus rayees',
    fichier: 'assets/fungalaxy-booking.js',
    de: '      var tiendra = !horsLibres[it.activityId];',
    vers: '      var tiendra = true;',
  },
];
const MUTATION_PREUVE = '[mutation] servie en memoire :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_HORS_MUTATION || 0);
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
// Le crochet est pose AVANT tout require applicatif.
if (MUTATION && MUTATION.fichier.endsWith('.js') && !MUTATION.fichier.startsWith('assets/')) {
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

let ip = 0;
async function heures(q) {
  ip += 1;
  const adresse = `10.7.${ip % 250}.${1 + (ip % 200)}`;
  const req = { method: 'GET', url: `/api/public-availability?${new URLSearchParams({ centerId: 'libramont', type: 'visite', ...q }).toString()}`, headers: { host: 'localhost', 'x-forwarded-for': adresse }, socket: { remoteAddress: adresse } };
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.getHeader = (k) => res.headers[k];
  res.writeHead = (code) => { res.statusCode = code; };
  res.end = (b) => { res.body = b === undefined ? '' : String(b); };
  await dispo(req, res);
  try { return JSON.parse(res.body || '{}'); } catch (error) { return {}; }
}
const minutesDe = (t) => { const [h, m] = String(t || '').split(':').map(Number); return h * 60 + m; };
const noms = (slot) => ((slot && slot.visitShortfallItems) || []).map((h) => (h.partie ? `${h.name} #${h.partie}` : h.name));
const joindre = (l, et) => (l.length < 2 ? (l[0] || '') : `${l.slice(0, -1).join(', ')}${et}${l[l.length - 1]}`);

// La mesure, refaite ici sans le code du serveur : le temps des activites
// libres (le programme), moins ce qui manque, c est ce qui tient. Les nommees
// couvrent au moins le manque ; celles qui tiennent rentrent dans ce qui reste.
function couvreLeManque(rep, slot) {
  const libres = ((rep.program && rep.program.items) || []).filter((it) => !it.planned);
  const total = libres.reduce((x, it) => x + (Number(it.minutes) || 0), 0);
  const nommees = new Set(((slot && slot.visitShortfallItems) || []).filter((h) => !h.partie).map((h) => h.activityId));
  const sautent = libres.filter((it) => nommees.has(it.activityId)).reduce((x, it) => x + (Number(it.minutes) || 0), 0);
  const manque = Number(slot && slot.visitShortfallMinutes) || 0;
  return { total, sautent, tiennent: total - sautent, manque, ok: sautent >= manque && total - sautent <= total - manque };
}

async function main() {
  const programme = JSON.stringify(PROGRAMME);

  section('A. AUCUNE HEURE POSEE : UN CRENEAU, ET CE QUI SAUTE EST NOMME');
  const a = await heures({ date: JOUR, pax: '8', softReserve: '1', program: programme });
  const sa = (a.slots || [])[0] || null;
  ok(Boolean(sa) && !a.message, '[A] plus d « Aucune combinaison disponible » : la visite a un creneau', a.message || (sa ? `${sa.time}` : 'aucun'));
  ok(sa && sa.time === '20:00' && sa.visitEndsAtClose === true && sa.visitEndTime === '22:00', '[A] le creneau de 20:00, jusqu a la fermeture (22:00)', sa ? `${sa.time} -> ${sa.visitEndTime}` : '');
  ok(JSON.stringify(noms(sa)) === JSON.stringify(ATTENDUS), `[A] nommes, dans l ordre du programme : ${ATTENDUS.join(', ')}`, JSON.stringify(noms(sa)));
  ok(sa && !noms(sa).includes('Fun Run by PIXEL'), '[A] le Fun Run (30 min) tient dans la demi-heure qui reste : il n est pas nomme', JSON.stringify(noms(sa)));
  const ca = couvreLeManque(a, sa);
  ok(ca.ok, '[A] la mesure : les nommees couvrent le manque, celles qui restent tiennent', JSON.stringify(ca));

  section('B. BOWLING COCHE A 20:00 : L HEURE RESTE, LES MEMES NOMS');
  const b = await heures({ date: JOUR, pax: '8', softReserve: '1', program: programme, preferredTimes: JSON.stringify({ bowling: '20:00' }) });
  const sb = (b.slots || [])[0] || null;
  const blocsB = (sb && sb.opsPlan && sb.opsPlan.resourceBlocks) || [];
  ok(blocsB.some((x) => x.activityId === 'bowling' && x.startTime === '20:00'), '[B] le bowling reste a 20:00', blocsB.map((x) => `${x.activityId} ${x.startTime}`).join(', '));
  ok(JSON.stringify(noms(sb)) === JSON.stringify(noms(sa)), '[B] les memes activites nommees qu avant le choix', JSON.stringify(noms(sb)));

  section('C. TROIS PARTIES DE LASER : LA PARTIE QUI FINIRAIT APRES 22:00');
  const c = await heures({
    date: JOUR, pax: '6', softReserve: '1',
    program: JSON.stringify([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 3 }, { activityId: 'minigolf_blacklight' }]),
    preferredTimes: JSON.stringify({ bowling: '20:00', laser_game: '21:00' }), laserGameTimes: JSON.stringify(['21:00']),
  });
  const sc = (c.slots || [])[0] || null;
  const passes = (sc && sc.opsPlan && sc.opsPlan.laserPassPlan) || {};
  const suite = Number(passes.followOnMinutes) || 0;
  const enAttente = (passes.pendingPasses || []).length;
  const finPlan = sc ? minutesDe(sc.opsPlan.endTime) - (Number(sc.opsPlan.bufferMinutes) || 0) : 0;
  const attendues = (passes.pendingPasses || []).filter((p, k) => finPlan - suite + (k + 1) * (suite / enAttente) > 22 * 60).map((p) => `Laser Game #${p.countIndex}`);
  ok(attendues.length === 1 && attendues[0] === 'Laser Game #3', '[C] (la propriete est exercee) la partie 3 finirait apres 22:00, la partie 2 tient', JSON.stringify({ suite, enAttente, finPlan, attendues }));
  ok(JSON.stringify(noms(sc)) === JSON.stringify([...attendues, 'Minigolf Blacklight']), '[C] nommees : la partie 3 de laser, puis le minigolf ; la partie 2 ne l est pas', JSON.stringify(noms(sc)));
  ok(((sc && sc.visitShortfallItems) || []).filter((h) => h.partie).every((h) => h.sansHeure === true), '[C] la partie nommee est marquee « sans heure »', JSON.stringify(sc && sc.visitShortfallItems));

  section('D. LES AUTRES TUNNELS ET UN JOUR NORMAL');
  const d = await heures({ date: JOUR, pax: '8', program: programme });
  ok(!(d.slots || []).length && /Aucune combinaison/.test(d.message || ''), '[D] sans softReserve (autres tunnels), le verdict ne change pas : la visite ne tient pas', d.message || `${(d.slots || []).length} creneau(x)`);
  const e = await heures({ date: LENDEMAIN, pax: '8', softReserve: '1', program: programme });
  const se = (e.slots || [])[0] || null;
  ok(se && !se.visitEndsAtClose && !se.visitShortfallItems, '[D] le lendemain, tout tient : rien n est nomme', se ? `${se.time} -> ${se.visitEndTime}` : 'aucun creneau');

  section('E. L ECRAN, TELEPHONE ET BUREAU');
  await ecran();

  console.log(failures ? `\nne-tiendra-pas-check: ${failures} defaut(s).` : '\nne-tiendra-pas-check: ALL OK (plus d « Aucune combinaison » quand une heure tient, ce qui saute est nomme une fois sous les pistes, raye dans la visite, redit au recapitulatif, et les heures posees restent)');
  process.exit(failures ? 1 : 0);
}

async function ecran() {
  const PORT = Number(process.env.PINLANE_HORS_PORT || 4491);
  const BASE = `http://127.0.0.1:${PORT}`;
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const server = mock.createServer({ port: PORT });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const phrase = `Ne tiendront pas avant la fermeture (22:00) : ${joindre(['Minigolf Blacklight (45 min)', 'Playground', 'Duckpin Bowling (1 h)'], ' et ')}.`;
  const courte = `Ne tiendront pas avant la fermeture (22:00) : ${joindre(ATTENDUS, ' et ')}.`;
  try {
    for (const largeur of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width: largeur, height: 900 } });
      const erreurs = [];
      page.on('pageerror', (err) => erreurs.push(String((err && err.message) || err)));
      if (MUTATION && MUTATION.fichier.startsWith('assets/')) {
        const source = fs.readFileSync(path.join(ROOT, MUTATION.fichier), 'utf8');
        const mute = muter(source, MUTATION);
        await page.route(`**/${MUTATION.fichier}*`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: mute }));
      }
      await page.clock.setFixedTime(new Date(MAINTENANT));
      await page.goto(`${BASE}/fungalaxy/libramont`);
      await page.click('#dayBtn');
      for (let i = 0; i < 4; i += 1) {
        if (await page.$(`#calGrid .fg-cal__day[data-date="${JOUR}"]`)) break;
        await page.click('#calNext');
      }
      await page.click(`#calGrid .fg-cal__day[data-date="${JOUR}"]`);
      await page.fill('#paxInput', '8');
      await page.click('#goActivities');
      for (const it of PROGRAMME) await page.click(`#gridAct .fg-card[data-activity="${it.activityId}"]`);
      await page.click('#goHours');
      await page.waitForSelector('#planZone .fg-visit, .fg-notice', { timeout: 20000 });
      await page.waitForTimeout(800);
      const lire = () => page.evaluate(() => {
        const txt = (n) => (n ? n.textContent.replace(/[\s\u00a0]+/g, ' ').trim() : '');
        return {
          notice: txt(document.querySelector('.fg-notice')),
          notes: Array.from(document.querySelectorAll('.fg-track')).map((t) => ({ id: t.dataset.activity, note: (t.querySelector('.fg-track__note') && !t.querySelector('.fg-track__note').hidden) ? txt(t.querySelector('.fg-track__note')) : '' })),
          encadre: txt(document.querySelector('#planZone .fg-visit__hors')),
          sousLaListe: (() => { const h = document.querySelector('#planZone .fg-visit__hors'); return Boolean(h) && Boolean(h.previousElementSibling && h.previousElementSibling.classList.contains('fg-visit__list')) && !document.querySelector('#planZone [data-plus], #planZone .fg-plus'); })(),
          rayees: Array.from(document.querySelectorAll('#planZone .fg-visit__step--hors')).map((li) => ({ nom: txt(li.querySelector('i')) || txt(li.querySelector(':scope > span')), detail: txt(li.querySelector('small')) })),
          tient: Array.from(document.querySelectorAll('#planZone .fg-visit__step--free:not(.fg-visit__step--hors) i')).map(txt),
          voix: txt(document.querySelector('#fgLive')),
          bowling: Array.from(document.querySelectorAll('.fg-track[data-activity="bowling"] .fg-chip.is-on, .fg-track[data-activity="bowling"] .fg-chip.is-proposed')).map((c) => c.dataset.time),
          garder: !document.querySelector('#goContact').disabled,
        };
      });
      const verifier = async (etiquette, avecChoix) => {
        const v = await lire();
        ok(!/Aucune combinaison/.test(v.notice) && v.garder, `[E] ${largeur} ${etiquette} : plus d « Aucune combinaison », « Ces horaires me vont » actif`, v.notice || '');
        const nommees = v.notes.filter((n) => n.note.indexOf('Ne tiendront pas') >= 0);
        ok(nommees.length === 1 && nommees[0].id === 'laser_game' && nommees[0].note.endsWith(courte), `[E] ${largeur} ${etiquette} : la liste nommee UNE fois, sous la derniere piste serree (laser)`, JSON.stringify(v.notes));
        if (avecChoix) ok(nommees[0] && nommees[0].note.indexOf('avec votre Bowling à 20:00') >= 0, `[E] ${largeur} ${etiquette} : la note garde l heure choisie (« avec votre Bowling à 20:00 »)`, nommees[0] && nommees[0].note);
        ok(v.encadre.indexOf(phrase) === 0, `[E] ${largeur} ${etiquette} : l encadre nomme tout, avec les durees`, v.encadre);
        ok(v.encadre.indexOf('Vos heures ne bougent pas : Bowling à 20:00 et Laser Game à 21:00.') >= 0, `[E] ${largeur} ${etiquette} : l encadre dit que les heures restent`, v.encadre);
        ok(v.encadre.indexOf('Le total indicatif compte encore Duckpin Bowling (78 €).') >= 0, `[E] ${largeur} ${etiquette} : le montant encore compte est dit (seul le duckpin a un tarif connu)`, v.encadre);
        ok(v.sousLaListe, `[E] ${largeur} ${etiquette} : l encadre suit la liste qu il raye ; aucune offre a l ecran des horaires (elles vivent dans la fenetre de fin)`);
        ok(JSON.stringify(v.rayees.map((r) => r.nom.replace(/ \(.*$/, ''))) === JSON.stringify(ATTENDUS) && v.rayees.every((r) => r.detail.indexOf('ne tiendra pas avant 22:00') === 0),
          `[E] ${largeur} ${etiquette} : les trois lignes rayees, « ne tiendra pas avant 22:00 »`, JSON.stringify(v.rayees));
        ok(v.tient.length === 1 && v.tient[0].indexOf('Fun Run') === 0, `[E] ${largeur} ${etiquette} : le Fun Run reste « a votre rythme »`, JSON.stringify(v.tient));
        ok(v.voix.indexOf(phrase) >= 0, `[E] ${largeur} ${etiquette} : la voix dit la meme liste`, v.voix.slice(0, 160));
        ok(v.bowling.includes('20:00'), `[E] ${largeur} ${etiquette} : le bowling est a 20:00`, JSON.stringify(v.bowling));
      };
      await verifier('sans heure posee', false);
      await page.click('.fg-track[data-activity="bowling"] .fg-chip[data-time="20:00"]');
      await page.waitForTimeout(1500);
      await verifier('bowling coche a 20:00', true);
      await page.click('#goContact');
      await page.waitForSelector('#recallBody .fg-recap__item', { timeout: 15000 }).catch(() => {});
      const recap = await page.evaluate(() => ((document.querySelector('#recallBody .fg-recap__hors') || {}).textContent || '').replace(/[\s\u00a0]+/g, ' ').trim());
      ok(recap === courte.replace(/\.$/, ''), `[E] ${largeur} recapitulatif : la meme liste`, recap);
      ok(erreurs.length === 0, `[E] ${largeur} : aucune erreur de page`, erreurs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv.includes('--mutate')) {
  const { spawnSync } = require('child_process');
  let tuees = 0;
  MUTATIONS.forEach((m, i) => {
    const run = spawnSync(process.execPath, [__filename], { env: { ...process.env, PINLANE_HORS_MUTATION: String(i + 1) }, encoding: 'utf8' });
    const sortie = `${run.stdout || ''}${run.stderr || ''}`;
    const servie = sortie.indexOf(MUTATION_PREUVE) >= 0;
    const tuee = servie && run.status === 1;
    if (tuee) tuees += 1;
    console.log(`${tuee ? 'TUEE   ' : 'SURVIT '} ${m.nom}${servie ? '' : ' (mutation non servie)'}${tuee ? '' : `  [code ${run.status}]`}`);
  });
  console.log(tuees === MUTATIONS.length ? `\nne-tiendra-pas-check --mutate: ${tuees}/${MUTATIONS.length} mutations tuees` : `\nne-tiendra-pas-check --mutate: ${MUTATIONS.length - tuees} mutation(s) survivante(s)`);
  process.exit(tuees === MUTATIONS.length ? 0 : 1);
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}

// LE CALENDRIER GRISE CE QUE LE CENTRE REFUSE EN LIGNE (2026-11-10, page Etablissement, suite du lot 3).
//
// Un centre dit jusqu a quand et combien de temps a l avance on reserve chez lui en ligne. Le serveur pose la
// regle a ses deux portes et la dit au visiteur dans la page de reservation (regles-reservation-check). Ici, les
// deux formulaires lus dans un vrai navigateur, la regle servie par la page de reservation : au moins 7 jours
// avant, au plus 30 jours a l avance.
//
//   [F1] Fun Galaxy, le jour de la reservation : le jour choisi d office et les raccourcis sont acceptes ; au
//        calendrier, un jour trop proche ou trop loin est grise avec sa raison, et la regle se lit sous la grille
//   [F2] Fun Galaxy, la demande sur mesure, que l equipe relit : son calendrier ne prend pas la regle
//   [T]  la page client : le champ date et sa fenetre refusent les memes jours, le jour pose d office avance
//   --mutate : la regle oubliee au calendrier (avant, apres, jour d office, raccourcis), etendue a la demande sur
//              mesure, ou oubliee par la page client et sa fenetre, fait rougir
//
// Les jours se comptent depuis aujourd hui, et le jour ouvert vise se prend dans le calendrier du banc : aucun
// jour d ouverture n est suppose.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LF = '\n';
const CRLF = '\r\n';

const REGLES = { minDaysAhead: 7, horizonDays: 30 };
const AVANT = 'En ligne, ce centre se réserve au moins 7 jours à l’avance';
const APRES = 'En ligne, ce centre se réserve jusqu’à 30 jours à l’avance';

const MUTATIONS = [
  {
    nom: 'le calendrier du jour oublie le « au moins 7 jours avant »',
    fichier: 'assets/fungalaxy-booking.js',
    de: "    min: function () { var r = reglesEnLigne(); return r.jours ? plusJours(r.jours) : aujourdhui(); },\n",
    vers: "    min: function () { return aujourdhui(); },\n",
    attendu: ['[F1]'],
  },
  {
    nom: 'le calendrier du jour oublie le « 30 jours a l avance »',
    fichier: 'assets/fungalaxy-booking.js',
    de: "    fin: function () { return finEnLigne(); },\n",
    vers: '',
    attendu: ['[F1]'],
  },
  {
    nom: 'le jour choisi d office ignore la regle',
    fichier: 'assets/fungalaxy-booking.js',
    de: "return ouvertCeJour(s) && reservableEnLigne(s); })[0];",
    vers: 'return ouvertCeJour(s); })[0];',
    attendu: ['[F1]'],
  },
  {
    nom: 'les raccourcis ignorent la regle',
    fichier: 'assets/fungalaxy-booking.js',
    de: 'return s >= aujourdhui() && ouvertCeJour(s) && reservableEnLigne(s); }).slice(0, 3);',
    vers: 'return s >= aujourdhui() && ouvertCeJour(s); }).slice(0, 3);',
    attendu: ['[F1]'],
  },
  {
    nom: 'la demande sur mesure prend la borne du centre',
    fichier: 'assets/fungalaxy-booking.js',
    de: '  function finCible() { var c = cible(); return c.fin ? c.fin() : horizon(); }\n',
    vers: '  function finCible() { return finEnLigne(); }\n',
    attendu: ['[F2]'],
  },
  {
    nom: 'la page client oublie la regle du centre',
    fichier: 'assets/app-main.js',
    de: '    const reglesDuCentre = payload && payload.bookingRules;\n',
    vers: '    const reglesDuCentre = null;\n',
    attendu: ['[T]'],
  },
  {
    nom: 'la fenetre de la page client oublie sa borne haute',
    fichier: 'assets/app-main.js',
    de: "    max: input.max || '',\n",
    vers: '',
    attendu: ['[T]'],
  },
];

const MUTATION_PREUVE = '[mutation] servie :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_CALREGLES_MUTATION || 0);
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

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
function section(titre) { console.log(`\n${titre}`); }
// Sous une contre-epreuve, seules tournent les sections que la mutation doit faire rougir.
const tourne = (lettre) => !MUTATION || MUTATION.attendu.includes(lettre);

function plusJours(jour, n) {
  const [y, m, d] = jour.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

async function main() {
  const PORT = Number(process.env.PINLANE_CALREGLES_PORT || 4489);
  const BASE = `http://127.0.0.1:${PORT}`;
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const TODAY = mock.TODAY;
  const MINI = plusJours(TODAY, REGLES.minDaysAhead);
  const FIN = plusJours(TODAY, REGLES.horizonDays);
  const ouverts = mock.metaPayload('', 90).center.calendar.filter((j) => j.open).map((j) => j.date);
  const attendre = async (page, fn, ms, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return Boolean(await page.evaluate(fn, arg).catch(() => false)); } };

  const server = mock.createServer({ port: PORT });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-BE', timezoneId: 'Europe/Brussels' });
  const erreurs = [];
  // Une page neuve : la page de reservation dit la regle du centre, comme au visiteur ; le fichier mute s il l est.
  const nouvellePage = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
    await p.route('**/api/public-booking-meta**', async (route) => {
      const rep = await route.fetch();
      let corps = null;
      try { corps = await rep.json(); } catch (error) { corps = null; }
      if (!corps || typeof corps !== 'object') return route.fulfill({ response: rep });
      return route.fulfill({ response: rep, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ ...corps, bookingRules: REGLES }) });
    });
    if (MUTATION && MUTATION.fichier.startsWith('assets/')) {
      const mute = muter(fs.readFileSync(path.join(ROOT, MUTATION.fichier), 'utf8'), MUTATION);
      const nom = path.basename(MUTATION.fichier);
      await p.route(`**/assets/${nom}*`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: mute }));
    }
    return p;
  };
  // Le calendrier du formulaire va au mois d un jour, s il y va : false quand ses fleches l en empechent.
  const allerAuMois = async (p, jour) => {
    const [y, mo] = jour.split('-').map(Number);
    const vise = y * 12 + (mo - 1);
    for (let k = 0; k < 16; k += 1) {
      const etat = await p.evaluate(() => ({ titre: document.querySelector('#calTitle').textContent.trim(), prev: document.querySelector('#calPrev').disabled, next: document.querySelector('#calNext').disabled }));
      const [nom, an] = etat.titre.split(' ');
      const vu = Number(an) * 12 + MOIS.indexOf(String(nom).toLowerCase());
      if (vu === vise) {
        await attendre(p, (d) => { const x = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return x && !x.classList.contains('is-loading'); }, 8000, jour);
        return true;
      }
      const sens = vise > vu ? 'next' : 'prev';
      if (etat[sens]) return false;
      await p.click(sens === 'next' ? '#calNext' : '#calPrev');
      await attendre(p, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, etat.titre);
    }
    return false;
  };
  const caseDu = (p, jour) => p.evaluate((d) => {
    const x = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`);
    return x ? { off: x.disabled, titre: x.title } : null;
  }, jour);
  const info = (p) => p.evaluate(() => document.querySelector('#calInfo').textContent.trim());

  try {
    if (tourne('[F1]')) {
      section('[F1] Fun Galaxy, le jour de la reservation');
      const p = await nouvellePage();
      await p.goto(`${BASE}/fungalaxy/libramont?v=calregles`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForSelector('body.is-ready', { timeout: 20000 });
      await attendre(p, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
      const raccourcis = await p.evaluate(() => [...document.querySelectorAll('#joursVite [data-jour]')].map((b) => ({ jour: b.dataset.jour, on: b.classList.contains('is-on') })));
      ok(raccourcis.length > 0 && raccourcis.every((r) => r.jour >= MINI && r.jour <= FIN), `[F1] les raccourcis ne proposent que des jours acceptes en ligne (du ${MINI} au ${FIN})`, JSON.stringify(raccourcis.map((r) => r.jour)));
      const choisi = (raccourcis.find((r) => r.on) || {}).jour || '';
      ok(choisi >= MINI && choisi <= FIN, '[F1] le jour choisi d office est le premier jour accepte, pas aujourd hui', choisi || '(aucun)');

      await p.click('#dayBtn');
      await p.waitForSelector('#dayPop:not([hidden])', { timeout: 5000 });
      const proche = plusJours(TODAY, 3);
      if (await allerAuMois(p, proche)) {
        const c = await caseDu(p, proche);
        ok(Boolean(c && c.off && c.titre === AVANT), `[F1] dans 3 jours : grise, avec la raison du centre`, JSON.stringify(c));
      } else {
        ok(true, '[F1] dans 3 jours : le mois est hors d atteinte, avant le premier jour accepte');
      }
      await p.mouse.move(1, 1);
      await p.waitForTimeout(100);
      const texte = await info(p);
      ok(texte.includes('au moins 7 jours à l’avance') && texte.includes('jusqu’à 30 jours à l’avance'), '[F1] la regle se lit sous la grille, sans survoler une case', `« ${texte} »`);
      const legende = await p.evaluate(() => document.querySelector('.fg-cal__legend span').textContent.trim());
      ok(legende.includes('pas réservable en ligne'), '[F1] la legende dit qu un jour grise peut l etre par la regle, pas seulement ferme', `« ${legende} »`);
      const loin = plusJours(TODAY, REGLES.horizonDays + 1);
      const auMoisLoin = await allerAuMois(p, loin);
      if (auMoisLoin) {
        const c = await caseDu(p, loin);
        ok(Boolean(c && c.off && c.titre === APRES), `[F1] dans ${REGLES.horizonDays + 1} jours : grise, avec la raison du centre`, JSON.stringify(c));
      } else {
        const auMoisFin = await allerAuMois(p, FIN);
        const fermee = await p.evaluate(() => document.querySelector('#calNext').disabled);
        ok(auMoisFin && fermee, `[F1] dans ${REGLES.horizonDays + 1} jours : hors d atteinte, la fleche du mois suivant s eteint au mois de la borne`);
      }
      const bord = ouverts.filter((d) => d >= MINI && d <= FIN).pop();
      if (bord && await allerAuMois(p, bord)) {
        const c = await caseDu(p, bord);
        ok(Boolean(c && !c.off), `[F1] le dernier jour ouvert accepte (${bord}) reste choisissable`, JSON.stringify(c));
      } else {
        ok(false, '[F1] MONTAGE aucun jour ouvert entre la borne basse et la borne haute du banc', String(bord));
      }
      await p.close();
    }

    if (tourne('[F2]')) {
      section('[F2] Fun Galaxy, la demande sur mesure');
      const p = await nouvellePage();
      await p.goto(`${BASE}/fungalaxy/libramont?v=calregles-sm`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForSelector('body.is-ready', { timeout: 20000 });
      await p.fill('#paxInput', '31');
      await p.dispatchEvent('#paxInput', 'input');
      await p.locator('#paxInput').blur();
      await p.click('#goActivities');
      await attendre(p, () => document.querySelector('.fg-scene[data-scene="sm-groupe"].is-active') !== null, 8000);
      await p.click('.fg-occasion[data-type="ecole"]');
      await p.fill('#smOrg', 'École communale du gate');
      await p.click('.fg-sm-chip[data-age="moins7"]');
      await p.click('.fg-sm-chip[data-age="7-12"]');
      await p.click('#smCompPlus');
      await p.click('#smCompPlus');
      await p.click('#smGoDate');
      const aLaDate = await attendre(p, () => document.querySelector('.fg-scene[data-scene="sm-date"].is-active') !== null, 8000);
      ok(aLaDate, '[F2] MONTAGE la demande sur mesure arrive a sa date');
      await p.waitForTimeout(500);
      await p.click('#smDateBtn');
      await p.waitForSelector('#dayPop:not([hidden])', { timeout: 5000 });
      const tot = ouverts.find((d) => d > TODAY && d < MINI);
      const tard = ouverts.find((d) => d > FIN);
      if (tot && await allerAuMois(p, tot)) {
        const c = await caseDu(p, tot);
        ok(Boolean(c && !c.off && c.titre !== AVANT), `[F2] un jour ouvert avant le ${MINI} (${tot}) reste choisissable pour la demande`, JSON.stringify(c));
      } else {
        ok(false, '[F2] MONTAGE aucun jour ouvert atteignable avant la borne basse', String(tot));
      }
      if (tard && await allerAuMois(p, tard)) {
        const c = await caseDu(p, tard);
        ok(Boolean(c && !c.off), `[F2] un jour ouvert apres le ${FIN} (${tard}) reste choisissable pour la demande`, JSON.stringify(c));
      } else {
        ok(false, `[F2] un jour ouvert apres le ${FIN} n est plus atteignable dans le calendrier de la demande`, String(tard));
      }
      await p.mouse.move(1, 1);
      await p.waitForTimeout(100);
      const texte = await info(p);
      ok(!texte.includes('En ligne, ce centre'), '[F2] sous la grille de la demande, aucune regle du centre', `« ${texte} »`);
      await p.close();
    }

    if (tourne('[T]')) {
      section('[T] La page client');
      const p = await nouvellePage();
      await p.goto(`${BASE}/?v=calregles-t`, { waitUntil: 'networkidle', timeout: 45000 });
      await attendre(p, (m) => { const f = document.getElementById('fDate'); return Boolean(f) && f.min === m; }, 15000, MINI);
      const champ = await p.evaluate(() => {
        const f = document.getElementById('fDate');
        return { min: f.min, max: f.max, valeur: f.value, etat: typeof state !== 'undefined' && state.booking ? state.booking.date : '' };
      });
      ok(champ.min === MINI && champ.max === FIN, `[T] le champ date va du ${MINI} au ${FIN}`, JSON.stringify(champ));
      ok(champ.valeur === MINI && champ.etat === MINI, '[T] le jour pose d office passe au premier jour accepte', JSON.stringify(champ));
      // La fenetre s ouvre par sa fonction : le bouton qui l appelle peut etre range selon l ecran du banc.
      await p.evaluate(() => {
        const b = document.querySelector('.date-picker-trigger');
        openClientDateCalendar({ currentTarget: b, target: b, preventDefault() {}, stopPropagation() {} });
      });
      await attendre(p, () => document.querySelectorAll('.staff-cal-day').length > 20, 5000);
      const bouton = (jour) => p.evaluate((d) => {
        const b = [...document.querySelectorAll('.staff-cal-day')].find((x) => (x.getAttribute('onclick') || '').includes(`'${d}'`));
        return b ? { bloque: b.disabled && b.classList.contains('is-blocked') } : null;
      }, jour);
      const fenetreVa = async (jour) => {
        for (let k = 0; k < 3; k += 1) {
          if (await bouton(jour)) return true;
          await p.evaluate(() => staffCalendarShiftMonth(1));
          await p.waitForTimeout(150);
        }
        return Boolean(await bouton(jour));
      };
      const proche = plusJours(TODAY, 3);
      if (await bouton(proche)) {
        const b = await bouton(proche);
        ok(b.bloque, '[T] la fenetre : dans 3 jours, bloque', JSON.stringify(b));
      } else {
        ok(true, '[T] la fenetre : dans 3 jours, hors du mois ouvert');
      }
      const premier = await bouton(MINI);
      ok(Boolean(premier && !premier.bloque), `[T] la fenetre : le ${MINI} reste choisissable`, JSON.stringify(premier));
      const loin = plusJours(TODAY, REGLES.horizonDays + 1);
      const vu = await fenetreVa(loin);
      const b = vu ? await bouton(loin) : null;
      ok(Boolean(b && b.bloque), `[T] la fenetre : dans ${REGLES.horizonDays + 1} jours, bloque`, JSON.stringify(b));
      await p.close();
    }

    section('[Z] La page');
    ok(erreurs.length === 0, '[Z] aucune erreur de page', erreurs.slice(0, 3).join(' | '));
  } finally {
    await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }

  if (failures) {
    console.error(`\ncalendrier-regles-check: ${failures} defaut(s).`);
    process.exitCode = 1;
    return;
  }
  console.log('\ncalendrier-regles-check: ALL OK (les deux formulaires grisent ce que le centre refuse en ligne, la demande sur mesure n en depend pas)');
}

if (process.argv.includes('--mutate')) {
  const empreintes = new Map(MUTATIONS.map((x) => [x.fichier, fs.readFileSync(path.join(ROOT, x.fichier), 'utf8')]));
  let defauts = 0;
  MUTATIONS.forEach((mutation, index) => {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, PINLANE_CALREGLES_MUTATION: String(index + 1) }, encoding: 'utf8', timeout: 300000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const servie = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
    const rougit = r.status === 1 && mutation.attendu.every((lettre) => sortie.split('\n').some((l) => l.startsWith('FAIL') && l.includes(lettre)));
    if (r.status === 2 || !servie) { defauts += 1; console.error(`contre-epreuve DESARMEE : ${mutation.nom} (${r.status === 2 ? 'ancre introuvable' : 'mutation non servie'})`); }
    else if (!rougit) { defauts += 1; console.error(`contre-epreuve MUETTE : le gate reste vert quand ${mutation.nom}.\n${sortie.split('\n').filter((l) => l.startsWith('FAIL') || l.startsWith('OK')).slice(-6).join('\n')}`); }
    else console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom}.`);
  });
  const touche = [...empreintes].filter(([f, avant]) => fs.readFileSync(path.join(ROOT, f), 'utf8') !== avant);
  if (touche.length) { defauts += 1; console.error(`un fichier a ete ecrit : ${touche.map(([f]) => f).join(', ')}`); }
  if (defauts) { console.error(`\ncalendrier-regles-check --mutate: ${defauts} defaut(s).`); process.exitCode = 1; }
  else console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et aucun fichier n a ete ecrit.`);
} else {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

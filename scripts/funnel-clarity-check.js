// LE TUNNEL SE COMPREND SANS REFLECHIR (entretien Seb, 2026-09-17).
//
// Deux defauts vus en direct devant le client, tous les deux sur l etape 1 :
//
//   [A] LE BANDEAU SUR MESURE MENTAIT SUR SA CIBLE. Il disait « Groupe,
//       entreprise ou besoin special ? / Privatisation, team-building,
//       traiteur... ». Movsar : « faut vrm des grands groupe pour des
//       evenement genre pas pour des dmd special ». Des clients ordinaires
//       l ouvraient, puis remplissaient AUSSI le formulaire de reservation,
//       alors qu une demande sur mesure ne passe pas par lui. Le bandeau doit
//       donc nommer sa cible (evenement d entreprise ou d ecole) ET dire que
//       le formulaire de reservation devient inutile.
//
//   [D] L ECRAN DES REGLAGES ETAIT UN CUL-DE-SAC SUR ORDINATEUR. La grille des
//       activites y est masquee (`#step1.is-options .activity-grid`), et le
//       seul retour vivait dans la barre haute du telephone, absente au-dessus
//       de 640 px. Movsar : « quand on arrive sur ca on peut pas aller a
//       l endroit precedent qui montre choix d activite cest con ». Meme
//       defaut, meme remede que la question du groupe (`.s1-venue-back`,
//       2026-08-31) : un retour ECRIT dans l ecran, et un seul chemin de
//       retour par largeur.
//
// Ce gate monte la situation avant de l asserter : il choisit une activite qui
// a des reglages, passe sur l ecran des reglages, et EXIGE d en revenir par un
// controle visible. Contre-epreuves par mutation du code de production : sans
// le controle, sans le texte, le gate rougit.
//
// Lancement : node scripts/funnel-clarity-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'assets/app-main.js');
const INDEX = path.join(ROOT, 'index.html');
const PORT = Number(process.env.PINLANE_FUNNEL_CLARITY_PORT || 4251);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Date du CENTRE (Europe/Brussels), jamais celle de la machine.
function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();

const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par personne', note: '12 niveaux', order: 3, defaultMinutes: 45 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: null, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60, minMinutes: 60, maxMinutes: 180, stepMinutes: 60 },
  { id: 'arcade_time', name: 'Arcades', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: '', order: 6, defaultMinutes: 30 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', order: 7, defaultMinutes: 60 },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', note: '5 joueurs max.', order: 9, defaultMinutes: 15 },
];

function metaPayload() {
  return {
    ok: true, today: DATE, durationOptions: [], formules: [], activities: ACTIVITIES,
    center: {
      id: 'libramont', status: 'active',
      defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const json = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); };
    if (url.pathname === '/api/public-booking-meta') return json(200, metaPayload());
    if (url.pathname.startsWith('/api/')) return json(200, { ok: true, slots: [], suggestions: [] });
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/reserver' || p.startsWith('/reserver/')) p = '/index.html';
    const filePath = path.resolve(path.join(ROOT, p));
    if (!filePath.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

let failures = 0;
function record(label, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
function section(title) { console.log(`\n--- ${title}`); }

// Mutation du code de PRODUCTION, rendue au fichier quoi qu il arrive. L ancre
// doit exister EXACTEMENT une fois : sinon la contre-epreuve ne prouve rien.
async function withSourceMutation(file, from, to, run) {
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(from).length - 1;
  if (count !== 1) throw new Error(`ancre trouvee ${count} fois dans ${path.basename(file)} : ${from.slice(0, 80)}`);
  try {
    fs.writeFileSync(file, original.split(from).join(to));
    return await run();
  } finally {
    fs.writeFileSync(file, original);
    if (fs.readFileSync(file, 'utf8') !== original) throw new Error(`${path.basename(file)} non restaure`);
  }
}

async function ouvrirReglages(browser, { width, height, etiquette }) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/reserver/libramont?v=fc-${etiquette}-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.goStep2 === 'function' && document.querySelectorAll('#clientView .activity-card').length >= 8, null, { timeout: 20000 });
  await page.evaluate((date) => {
    const champ = document.getElementById('fDate');
    champ.value = date;
    champ.dispatchEvent(new Event('change', { bubbles: true }));
  }, DATE);
  await page.waitForTimeout(400);
  // LA VENUE EST UNE SUITE DE QUESTIONS (le jour, puis le groupe), pas un
  // ecran unique : on avance TANT QUE la grille des activites n est pas peinte,
  // au lieu de supposer un seul « Continuer ».
  const grilleVisible = () => page.evaluate(() => {
    const grille = document.querySelector('#clientView .activity-grid');
    return Boolean(grille) && grille.getBoundingClientRect().height > 0;
  });
  for (let pas = 0; pas < 4 && !(await grilleVisible()); pas += 1) {
    const continuer = page.locator('#btnVenueContinue');
    if (!(await continuer.isVisible().catch(() => false))) break;
    await continuer.click({ timeout: 4000 });
    await page.waitForTimeout(450);
  }
  if (!(await grilleVisible())) throw new Error(`montage impossible : la grille des activites reste masquee (${etiquette})`);
  // Le bowling est une activite PROGRAMMEE : elle peut deja etre cochee a
  // l arrivee. Cliquer sans regarder la decochait, et l ecran des reglages
  // n existait plus. On s assure de l etat voulu, on ne le suppose pas.
  const bowling = page.locator('#clientView .activity-card[data-activity="bowling"] .activity-toggle').first();
  if ((await bowling.getAttribute('aria-pressed')) !== 'true') await bowling.click({ timeout: 6000 });
  await page.waitForTimeout(400);
  const choisies = await page.evaluate(() => (typeof getChosenActivities === 'function' ? getChosenActivities().map((a) => a.id) : []));
  if (!choisies.includes('bowling')) throw new Error(`montage impossible : bowling non choisi (${choisies.join(',') || 'rien'})`);
  await page.locator('#btnStep1').click({ timeout: 6000 });
  await page.waitForTimeout(600);
  return { context, page };
}

// Etat de l ecran des reglages : y est-on, la grille est-elle bien masquee, et
// existe-t-il un retour VISIBLE (peint, dans la fenetre, nom accessible).
const ETAT_REGLAGES = () => {
  const step = document.getElementById('step1');
  const grille = document.querySelector('#clientView .activity-grid');
  const grilleVisible = Boolean(grille) && grille.getBoundingClientRect().height > 0;
  const retours = [...document.querySelectorAll('#clientView .s1-options-back, .m-topbar .m-top-back:not([hidden])')]
    .filter((el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
  const dansLEcran = document.querySelector('#clientView .s1-options-back');
  const r = dansLEcran ? dansLEcran.getBoundingClientRect() : null;
  return {
    surReglages: Boolean(step) && step.classList.contains('is-options'),
    grilleVisible,
    cheminsDeRetour: retours.length,
    retourDansLEcran: Boolean(dansLEcran) && r.height > 0,
    hauteurRetour: r ? Math.round(r.height) : 0,
    retourDansLaFenetre: Boolean(r) && r.top >= 0 && r.bottom <= (document.scrollingElement || document.documentElement).clientHeight + 1,
    nomRetour: dansLEcran ? (dansLEcran.getAttribute('aria-label') || dansLEcran.textContent || '').trim() : '',
    activitesChoisies: typeof getChosenActivities === 'function' ? getChosenActivities().map((a) => a.id) : [],
  };
};

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // =================================================================== [A]
    section('[A] Le bandeau sur mesure nomme sa cible et libere du formulaire');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/reserver/libramont?v=fc-a-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => document.querySelector('#clientView .bespoke-entry-text strong'), null, { timeout: 20000 });
      const bandeau = await page.evaluate(() => {
        const bouton = document.querySelector('#clientView .bespoke-entry');
        return {
          titre: (document.querySelector('#clientView .bespoke-entry-text strong')?.textContent || '').trim(),
          detail: (document.querySelector('#clientView .bespoke-entry-text small')?.textContent || '').trim(),
          nom: (bouton?.getAttribute('aria-label') || '').trim(),
          hauteur: bouton ? Math.round(bouton.getBoundingClientRect().height) : 0,
        };
      });
      const cible = (texte) => /entreprise/i.test(texte) && /(école|ecole)/i.test(texte);
      const libere = (texte) => /formulaire/i.test(texte) && /(pas besoin|inutile|sans remplir|ne remplissez)/i.test(texte);
      record('le bandeau nomme sa cible : entreprise ou ecole', cible(bandeau.titre), bandeau.titre);
      record('le bandeau dit que le formulaire de reservation est inutile', libere(bandeau.detail), bandeau.detail);
      record('le nom accessible du bandeau dit la meme chose', cible(bandeau.nom), bandeau.nom);
      record('le bandeau reste une cible tactile (>= 44 px)', bandeau.hauteur >= 44, `${bandeau.hauteur} px`);

      await page.locator('#clientView .bespoke-entry').click({ timeout: 6000 });
      await page.waitForTimeout(400);
      const modale = await page.evaluate(() => ({
        ouverte: !document.getElementById('customRequestModal')?.classList.contains('hidden'),
        titre: (document.getElementById('bespokeTitle')?.textContent || '').trim(),
        detail: (document.querySelector('#customRequestModal .bespoke-modal-head p')?.textContent || '').trim(),
      }));
      record('la modale sur mesure s ouvre', modale.ouverte);
      record('la modale nomme la meme cible que le bandeau', cible(modale.titre), modale.titre);
      record('la modale repete que le formulaire de reservation est inutile', libere(modale.detail), modale.detail);
      await context.close();
    }

    // =================================================================== [D]
    section('[D] Depuis l ecran des reglages, on revient aux activites');
    {
      const { context, page } = await ouvrirReglages(browser, { width: 1280, height: 800, etiquette: 'bureau' });
      const avant = await page.evaluate(ETAT_REGLAGES);
      record('montage : on est bien sur l ecran des reglages', avant.surReglages, JSON.stringify({ surReglages: avant.surReglages, choisies: avant.activitesChoisies }));
      record('montage : la grille des activites y est masquee', avant.surReglages && !avant.grilleVisible);
      record('un retour est ECRIT dans l ecran, pas seulement dans la barre haute', avant.retourDansLEcran, JSON.stringify({ hauteur: avant.hauteurRetour, nom: avant.nomRetour }));
      record('ce retour est une cible tactile (>= 44 px) et dans la fenetre', avant.hauteurRetour >= 44 && avant.retourDansLaFenetre, `${avant.hauteurRetour} px`);
      record('ce retour porte un nom lisible', /activit/i.test(avant.nomRetour), avant.nomRetour);
      record('sur ordinateur, UN SEUL chemin de retour', avant.cheminsDeRetour === 1, `${avant.cheminsDeRetour} chemin(s)`);

      const clique = await page.locator('#clientView .s1-options-back').click({ timeout: 6000 }).then(() => true).catch(() => false);
      record('le retour est cliquable', clique);
      await page.waitForTimeout(500);
      const apres = await page.evaluate(ETAT_REGLAGES);
      record('apres le retour : la grille des activites est de nouveau la', !apres.surReglages && apres.grilleVisible, JSON.stringify({ surReglages: apres.surReglages, grille: apres.grilleVisible }));
      record('apres le retour : le choix deja fait est conserve', apres.activitesChoisies.includes('bowling'), apres.activitesChoisies.join(','));
      await context.close();
    }

    // ================================================================== [D2]
    section('[D2] Sur telephone, un seul chemin de retour (la barre haute)');
    {
      const { context, page } = await ouvrirReglages(browser, { width: 390, height: 844, etiquette: 'tel' });
      const etat = await page.evaluate(ETAT_REGLAGES);
      record('montage : on est bien sur l ecran des reglages', etat.surReglages);
      record('sous 640 px le retour de l ecran s efface', etat.retourDansLEcran === false, `hauteur=${etat.hauteurRetour}`);
      record('sous 640 px il reste exactement un chemin de retour', etat.cheminsDeRetour === 1, `${etat.cheminsDeRetour} chemin(s)`);
      await context.close();
    }

    // =========================================================== CONTRE-EPREUVES
    section('Contre-epreuves par mutation du code de production');
    try {
      const sansRetour = await withSourceMutation(
        APP_JS,
        '<button type="button" class="s1-options-back"',
        '<button type="button" hidden class="s1-options-back-mutee"',
        async () => {
          const { context, page } = await ouvrirReglages(browser, { width: 1280, height: 800, etiquette: 'mute' });
          const etat = await page.evaluate(ETAT_REGLAGES);
          await context.close();
          return etat;
        },
      );
      record('sans le retour ecrit dans l ecran, ce gate ROUGIRAIT', sansRetour.surReglages && sansRetour.retourDansLEcran === false && sansRetour.cheminsDeRetour === 0, JSON.stringify(sansRetour));
    } catch (error) {
      record('contre-epreuve du retour montable', false, error.message);
    }

    try {
      const ancienTexte = await withSourceMutation(
        INDEX,
        "<strong>Événement d'entreprise ou d'école ?</strong>",
        '<strong>Groupe, entreprise ou besoin spécial ?</strong>',
        async () => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
          const page = await context.newPage();
          await page.goto(`${BASE_URL}/reserver/libramont?v=fc-texte-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
          await page.waitForFunction(() => document.querySelector('#clientView .bespoke-entry-text strong'), null, { timeout: 20000 });
          const titre = await page.evaluate(() => (document.querySelector('#clientView .bespoke-entry-text strong')?.textContent || '').trim());
          await context.close();
          return titre;
        },
      );
      record('avec l ancien texte du bandeau, ce gate ROUGIRAIT', !/(école|ecole)/i.test(ancienTexte), ancienTexte);
    } catch (error) {
      record('contre-epreuve du texte montable', false, error.message);
    }

    record('index.html restaure a l identique', fs.readFileSync(INDEX, 'utf8').includes("d'école ?</strong>"));
    record('app-main.js restaure a l identique', fs.readFileSync(APP_JS, 'utf8').includes('<button type="button" class="s1-options-back"'));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'FUNNEL CLARITY OK' : `FUNNEL CLARITY : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error('ECHEC', error); process.exit(1); });

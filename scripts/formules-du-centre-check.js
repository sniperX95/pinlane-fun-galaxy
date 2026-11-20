// LES FORMULES QUE LE CENTRE JOUE (2026-11-20).
//
// Ansar, a Gembloux : « ça me montre quand même les activités qu’on a pas à Gembloux quand on
// réserve ici ». Reserver proposait « Formule 7 : playground, minigolf, arcades » ; une fois prise,
// le ticket disait « Activité non disponible dans ce centre : playground » et chaque heure
// « impossible ». Le catalogue des formules est commun aux centres ; le serveur marque deja celles
// qu un centre ne joue pas (missingActivityIds), le formulaire public les retirait, la console non.
//
//   [A] LE SERVEUR LE SAIT. Le vrai formulesPubliques (api/public-booking-meta.js) marque les
//       formules 6, 7 et 8 a Gembloux (playground), aucune a Libramont.
//   [B] RESERVER NE PROPOSE QUE CE QUI SE JOUE ICI. La console servie avec le vrai catalogue de
//       Gembloux : la page Formules (vrais clics, « autres offres » ouvertes) ne montre ni la 6, ni
//       la 7, ni la 8 et montre toutes les autres ; la porte « Formules » compte ce qu elle montre.
//   [C] MODIFIER DE MEME. Le menu « Formule » d un dossier ne propose pas les formules marquees ;
//       un dossier qui en a deja une la garde en tete (on ne lui retire pas la sienne).
//
// node scripts/formules-du-centre-check.js [--contre-preuves] [--captures=DOSSIER]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FX = require('./planning-v3-fixtures.js');
const { chromium } = require(require.resolve('playwright-core', { paths: [ROOT] }));

const PORT = Number(process.env.PINLANE_FORMULES_CENTRE_PORT || 5694);
const CASSE = String(process.env.FORMULES_CENTRE_CASSE || '');
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=').slice(1).join('=') : true) : null; };
const CAPTURES = typeof argument('captures') === 'string' ? path.resolve(argument('captures')) : '';

const APP = 'assets/app-main.js';
const META = 'api/public-booking-meta.js';
const MARQUEES = ['f6', 'f7', 'f8'];
const MUTATIONS = [
  { nom: 'reserver-tout', cible: '[B]', fichier: APP, de: '  return getEffectiveCatalogFormules().filter(formuleJoueeAuCentre).map(formule => {', vers: '  return getEffectiveCatalogFormules().map(formule => {' },
  { nom: 'modifier-tout', cible: '[C] le menu « Formule » ne propose pas', fichier: APP, de: '.filter(f => !estFormuleIllimitee(f) && formuleJoueeAuCentre(f));', vers: '.filter(f => !estFormuleIllimitee(f));' },
  { nom: 'aide-aveugle', cible: '[B]', fichier: APP, de: '  return !(f && Array.isArray(f.missingActivityIds) && f.missingActivityIds.length);', vers: '  return true;' },
  { nom: 'serveur-muet', cible: '[A]', serveur: true, fichier: META, de: '    const manque = activitesManquantes(formule.id, center);', vers: '    const manque = [];' },
];
const mutation = CASSE ? MUTATIONS.find((m) => m.nom === CASSE) : null;
if (CASSE && !mutation) { console.error(`formules-du-centre-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
const compteAncre = (m) => lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
if (mutation && compteAncre(mutation) !== 1) { console.error(`formules-du-centre-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}

function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

// Le vrai code serveur, ou sa copie cassee pour une contre-preuve serveur.
function exiger(rel) {
  const f = path.join(ROOT, rel);
  if (!(mutation && mutation.serveur && mutation.fichier === rel)) return require(f);
  const Module = require('module');
  const m = new Module(f, module);
  m.filename = f;
  m.paths = Module._nodeModulePaths(path.dirname(f));
  m._compile(lf(fs.readFileSync(f, 'utf8')).split(mutation.de).join(mutation.vers), f);
  return m.exports;
}

const { formulesPubliques, activitesPubliques } = exiger(META).__test;
const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
const marquees = (liste) => liste.filter((f) => Array.isArray(f.missingActivityIds) && f.missingActivityIds.length).map((f) => f.id).sort();

// ---------------------------------------------------------------------------
// [A] Le serveur.
// ---------------------------------------------------------------------------
const GEMBLOUX = formulesPubliques('gembloux', getCenter('gembloux'));
const LIBRAMONT = formulesPubliques('libramont', getCenter('libramont'));
function scenarioA() {
  const g = GEMBLOUX.filter((f) => MARQUEES.includes(f.id));
  ok(marquees(GEMBLOUX).join() === MARQUEES.join() && g.every((f) => f.missingActivityIds.includes('playground')), '[A] a Gembloux, le serveur marque les formules 6, 7 et 8 (playground), et elles seules', marquees(GEMBLOUX));
  ok(marquees(LIBRAMONT).length === 0, '[A] a Libramont, aucune formule marquee', marquees(LIBRAMONT));
}

// La console du banc recoit le catalogue de Gembloux, tel que le serveur le sert.
const META_GEMBLOUX = { ...FX.lireCentre().publicBookingMeta, formules: GEMBLOUX, activities: activitesPubliques('gembloux', getCenter('gembloux')) };
const ATTENDUES = GEMBLOUX.filter((f) => !(Array.isArray(f.missingActivityIds) && f.missingActivityIds.length) && !f.illimite).map((f) => f.id).sort();

async function monter(browser) {
  return FX.monter(browser, {
    fixture: 'pic', appareil: 'ordinateur', theme: 'light', port: PORT,
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureLecture', async (chemin) => (String(chemin).startsWith('/api/public-booking-meta') ? { ...META_GEMBLOUX, today: FX.lireFixture('pic').staffState.date } : null));
    },
  });
}

async function photo(page, nom, selecteur) {
  if (!CAPTURES || mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.waitForTimeout(900);
  const zone = selecteur ? page.locator(selecteur).first() : null;
  await (zone && (await zone.count()) ? zone.screenshot({ path: path.join(CAPTURES, `${nom}.png`) }) : page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) }));
}

// ---------------------------------------------------------------------------
// [B] Reserver.
// ---------------------------------------------------------------------------
async function scenarioB(browser) {
  const { ctx, page, erreurs } = await monter(browser);
  try {
    await page.locator('.btn-new').first().click();
    await page.waitForSelector('#quickBookOverlay .qb-modal.rv.rs', { timeout: 8000 });
    await page.locator('#quickBookOverlay #rsHaut [data-pax="6"]').click();
    await page.waitForSelector('#quickBookOverlay #rsFormules', { timeout: 8000 });
    const porte = (await page.locator('#quickBookOverlay #rsFormules').innerText()).replace(/\s+/g, ' ');
    await page.locator('#quickBookOverlay #rsFormules').click();
    await page.waitForSelector('#quickBookOverlay .rs-f[data-formule]', { timeout: 8000 });
    const lire = () => page.evaluate(() => [...document.querySelectorAll('#quickBookOverlay .rs-f[data-formule]')].filter((b) => b.getClientRects().length).map((b) => b.dataset.formule));
    const valables = await lire();
    const n = Number((porte.match(/(\d+) formules?/) || [])[1]);
    ok(n === valables.length, '[B] la porte « Formules » compte les formules qu elle montre', { porte, montrees: valables.length });
    await photo(page, 'formules-gembloux', '#quickBookOverlay .qb-modal');
    if (await page.locator('#quickBookOverlay #rsOffres').count()) {
      await page.locator('#quickBookOverlay #rsOffres').click();
      await page.waitForTimeout(250);
    }
    const toutes = (await lire()).sort();
    ok(!toutes.some((id) => MARQUEES.includes(id)), '[B] Reserver ne propose ni la formule 6, ni la 7, ni la 8 (autres offres comprises)', toutes);
    ok(ATTENDUES.every((id) => toutes.includes(id)), '[B] Reserver propose toutes les autres formules de Gembloux', { manquent: ATTENDUES.filter((id) => !toutes.includes(id)) });
    ok(erreurs.length === 0, '[*] zero erreur JavaScript (Reserver)', erreurs.slice(0, 3).join(' | '));
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// [C] Modifier.
// ---------------------------------------------------------------------------
async function optionsDuDossier(page, formuleId) {
  return page.evaluate((fid) => {
    const r = state.reservations.find((x) => x && x.status !== 'cancelled' && x.type !== 'privatisation');
    r.formuleId = fid;
    closePos(); openPos(r.id); setTab('modifier');
    const menu = document.getElementById('editFormuleSelect');
    return menu ? [...menu.options].map((o) => o.value).filter(Boolean) : null;
  }, formuleId);
}

async function scenarioC(browser) {
  const { ctx, page, erreurs } = await monter(browser);
  try {
    const f5 = await optionsDuDossier(page, 'f5');
    ok(Array.isArray(f5) && f5.includes('f5') && !f5.some((id) => MARQUEES.includes(id)), '[C] le menu « Formule » ne propose pas les formules 6, 7 et 8 (dossier en formule 5)', f5);
    const f7 = await optionsDuDossier(page, 'f7');
    ok(Array.isArray(f7) && f7[0] === 'f7' && !f7.includes('f6') && !f7.includes('f8'), '[C] un dossier deja en formule 7 la garde en tete, sans la 6 ni la 8', f7);
    ok(erreurs.length === 0, '[*] zero erreur JavaScript (Modifier)', erreurs.slice(0, 3).join(' | '));
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// Les contre-preuves : chaque mutation doit rougir sa cible.
// ---------------------------------------------------------------------------
function contrePreuves() {
  const mortes = MUTATIONS.filter((m) => compteAncre(m) !== 1);
  mortes.forEach((m) => console.log(`FAIL  ancre ${m.nom} introuvable ou double`));
  let mordent = 0;
  MUTATIONS.forEach((m, i) => {
    if (mortes.includes(m)) return;
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, FORMULES_CENTRE_CASSE: m.nom, PINLANE_FORMULES_CENTRE_PORT: String(PORT + 1 + i) }, encoding: 'utf8', timeout: 240000 });
    const rouges = `${r.stdout || ''}`.split('\n').filter((l) => l.startsWith('FAIL'));
    if (r.status !== 2 && rouges.some((l) => l.includes(m.cible))) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : « ${m.cible} » rougit`); return; }
    console.log(`FAIL  contre-preuve ${m.nom} : « ${m.cible} » reste vert (${rouges.length} rouge(s) ; ${String(r.stderr || '').trim().split('\n').pop()})`);
  });
  console.log(`formules-du-centre-check --contre-preuves : ${mordent}/${MUTATIONS.length} mordent`);
  process.exit(mordent === MUTATIONS.length && !mortes.length ? 0 : 1);
}

async function main() {
  if (argument('contre-preuves')) return contrePreuves();
  scenarioA();
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    for (const scenario of [scenarioB, scenarioC]) {
      try { await scenario(browser); } catch (erreur) { ok(false, `[${scenario.name.slice(-1)}] le scenario va jusqu au bout`, String(erreur && erreur.message || erreur).slice(0, 200)); }
    }
  } finally {
    await browser.close();
    http.close();
  }
  console.log(`\nformules-du-centre-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => { console.error('formules-du-centre-check : interrompu', erreur && (erreur.stack || erreur)); process.exit(1); });

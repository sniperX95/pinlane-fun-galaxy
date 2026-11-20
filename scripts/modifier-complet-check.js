// MODIFIER COMPLET (2026-11-20, Ansar : « quand on veut modifier dans les resa ya pas encore la
// possibilité de modifier tout complet [...] tout vraiment complet »).
//
// L onglet Modifier de la vraie console (scripts/planning-v3-fixtures.js, le samedi « pic » a
// 15:10) ; ses PATCH partent au VRAI handler api/staff-reservations.js, au vrai moteur et a la
// vraie lib/database.js, sur la base en memoire de reserver-banc ou la journee de la fixture est
// semee (aucun reseau, aucune base reelle, rien ne part). Famille Noel (bowling, piste 6,
// 16:30) porte sept lignes d extras, ecrites comme Reserver les ecrit : article, categorie,
// quantite, prix a l unite, heure de service, note, auteur.
//   [X1] les extras se relisent sans se fondre : deux pizzas servies a deux heures restent deux
//        lignes ; une ligne sans « × 2 » dans son nom garde la quantite qu elle porte ; deux
//        lignes que rien ne separe se lisent « × 2 » ;
//   [X2] toucher deux extras (Duvel 2 -> 3, le gateau 1 -> 2) : les lignes intactes repartent
//        telles que le dossier les porte, chaque ligne changee part avec son id, son article,
//        sa categorie, sa quantite, son prix a l unite, son heure et sa note ;
//   [X3] au niveau libre (Manager), la base garde chaque champ de chaque ligne ; les lignes
//        intactes gardent leur auteur, les lignes changees prennent celui de la session ; le
//        prix ecrit est celui que la fiche annoncait ;
//   [X4] au niveau catalogue (Assistant manager), une ancienne ligne hors de la carte ne fait
//        plus refuser l enregistrement : elle reste, les heures des pizzas aussi, et la ligne
//        changee garde sa note ;
//   [J1] aucune erreur JS.
// --contre-preuves : chaque regle retiree (au code servi, en memoire ; le disque n est jamais
// touche) fait rougir sa lettre.
//   MC_MUTATIONS : un sous-ensemble (noms separes par des virgules) ; MC_BAVARD : le detail.
'use strict';
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout module de lib/.
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_MODIFIER_COMPLET_PORT || 5662);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

const NOEL = 1637; // bowling, piste 6, 4 joueurs, 16:30, 39 EUR
const AUTEUR = { par: 'Lucas', le: '2026-11-19T10:00:00.000Z' };
const EXTRAS = [
  { id: 'pizza-margherita-1', articleId: 'pizza-margherita', categorie: 'nourriture', name: 'Pizza Margherita × 1', qte: 1, prixUnitaire: 14, price: 14, heure: '16:30', note: 'sans basilic', ...AUTEUR },
  { id: 'pizza-margherita-2', articleId: 'pizza-margherita', categorie: 'nourriture', name: 'Pizza Margherita × 1', qte: 1, prixUnitaire: 14, price: 14, heure: '17:00', ...AUTEUR },
  { id: 'nachos-together-3', articleId: 'nachos-together', categorie: 'nourriture', name: 'Nachos Together', qte: 2, prixUnitaire: 14, price: 28, ...AUTEUR },
  { id: 'gateau-4', articleId: 'gateau-maison', categorie: 'gateaux', name: 'Gâteau chocolat × 1', qte: 1, prixUnitaire: 25, price: 25, heure: '17:00', note: 'bougies 7 ans', ...AUTEUR },
  { id: 'duvel-5', articleId: 'duvel', categorie: 'boissons', name: 'Duvel × 2', qte: 2, prixUnitaire: 5, price: 10, note: 'bien fraîches', ...AUTEUR },
  { id: 'u1', name: 'Cruche Bière', price: 18 },
  { id: 'u1', name: 'Cruche Bière', price: 18 },
];
const BASE = 39;
const PRIX = BASE + EXTRAS.reduce((t, x) => t + x.price, 0);

let echecs = 0;
let silence = false;
const rouges = [];
// La contre-preuve en cours a mordu des que sa lettre rougit : la suite de ses scenarios
// n apporterait plus rien (chaque scenario ferme sa page dans un finally).
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}

let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// Deux objets pareils, cles dans n importe quel ordre.
function pareil(a, b) {
  const tri = (v) => (Array.isArray(v) ? v.map(tri) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = tri(v[k]); return o; }, {}) : v);
  return JSON.stringify(tri(a)) === JSON.stringify(tri(b));
}
// Ce que la ligne porte, sans l auteur ni l instant (le serveur les pose).
const sansAuteur = (l) => { const { par, le, ...reste } = l || {}; return reste; };

// ---------------------------------------------------------------------------
// LA BASE : la journee de la fixture, en colonnes (l inverse de mapReservation).
// ---------------------------------------------------------------------------
const FIXTURE = FX.lireFixture('pic');
function ligneDepuis(r) {
  return {
    id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: r.name, phone: r.phone || '', email: r.email || '',
    date: r.date, start_time: r.startTime, duration: r.duration, total_duration: r.totalDuration ?? r.duration, lanes: (r.lanes || []).map(Number),
    pax: r.pax, status: r.status, base_price: r.basePrice, price: r.price, type: r.type, formule_id: r.formuleId || null, label: r.label,
    occasion: r.occasion || '', extras: r.extras || [], payment_method: r.paymentMethod || null, notes: r.notes || '',
    ops_plan: r.opsPlan || null, risk_level: r.riskLevel || '', risk_score: r.riskScore ?? null, validation_status: r.validationStatus || 'confirmed',
    activity_progress: r.activityProgress || {}, program: r.program || null, companions: r.companions || 0,
    created_at: new Date(r.createdAt), updated_at: new Date(r.updatedAt),
    acquisition: r.acquisition ?? null, client_key: r.clientKey || '', paid_at: r.paidAt ? new Date(r.paidAt) : null,
    amount_paid: r.amountPaid ?? null, discount_reason: r.discountReason || '', absent_at: r.absentAt ? new Date(r.absentAt) : null,
  };
}
function semer() {
  B.semer(FIXTURE.staffState.reservations.map((r) => (r.id === NOEL ? { ...ligneDepuis(r), extras: JSON.parse(JSON.stringify(EXTRAS)), price: PRIX } : ligneDepuis(r))));
}
function enBase(id) {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  const extras = typeof row.extras === 'string' ? JSON.parse(row.extras) : row.extras;
  return { price: Number(row.price), basePrice: Number(row.base_price), extras: Array.isArray(extras) ? extras : [], notes: row.notes || '', phone: row.phone || '' };
}

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
async function monter(browser, serveur, { appareil = 'ordinateur', theme = 'dark' } = {}) {
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil, theme, port: PORT, heure: '15:10',
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => {
        const rep = await serveur.appeler('PATCH', '/api/staff-reservations', corps);
        journal.push({ corps, statut: rep.statut, json: rep.json });
        return rep;
      });
    },
  });
  return { ...m, journal };
}

// Le dossier de Noel porte ses extras dans la page aussi (la journee servie comprise : le
// rafraichissement periodique la relit), puis Modifier s ouvre.
async function ouvrirModifier(page) {
  await page.evaluate(({ id, extras, prix }) => {
    const r = state.reservations.find((x) => x.id === id);
    const servi = window.__FIXTURE__.jours[window.__FIXTURE__.jour].find((x) => x.id === id);
    [r, servi].filter(Boolean).forEach((d) => { d.extras = JSON.parse(JSON.stringify(extras)); d.price = prix; });
    closePos(); openPos(id); setTab('modifier');
  }, { id: NOEL, extras: EXTRAS, prix: PRIX });
  await page.waitForSelector('#posOverlay .fm-extras', { timeout: 8000 });
}

function lireExtras() {
  const sec = document.querySelector('#posOverlay .fm-extras');
  const groupes = {};
  if (!sec) return groupes;
  sec.querySelectorAll('.fm-x-groupe').forEach((g) => {
    groupes[g.getAttribute('aria-label')] = Array.from(g.querySelectorAll('.fm-x-ligne')).map((l) => {
      const qte = l.querySelector('.fm-x-qte');
      return `${l.querySelector('.fm-x-choix').value}|${qte ? (qte.value ?? qte.textContent).trim() : ''}|${l.querySelector('.fm-x-prix').value}`;
    });
  });
  return groupes;
}

const LIGNE = (groupe, i) => `#posOverlay .fm-extras .fm-x-groupe[aria-label="${groupe}"] .fm-x-ligne >> nth=${i}`;
async function quantite(page, groupe, i, valeur) {
  await page.locator(`${LIGNE(groupe, i)} >> .fm-x-qte`).fill(String(valeur));
  await page.waitForTimeout(120);
}

async function enregistrer(page, journal) {
  const avant = journal.length;
  await page.click('#posOverlay .es-save');
  const t = Date.now();
  while (journal.length === avant && Date.now() - t < 10000) await page.waitForTimeout(80);
  await page.waitForTimeout(400);
  return journal.slice(avant);
}

// ---------------------------------------------------------------------------
// [X1] [X2] [X3] AU NIVEAU LIBRE.
// ---------------------------------------------------------------------------
async function scenarioLibre(browser) {
  semer();
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  try {
    await ouvrirModifier(page);
    const lu = await page.evaluate(lireExtras);
    ok(pareil(lu.Nourriture, ['Pizza Margherita|1|14', 'Pizza Margherita|1|14', 'Nachos Together|2|14', 'Gâteau chocolat|1|25']),
      '[X1] les deux pizzas servies a 16:30 et 17:00 restent deux lignes ; les nachos gardent leur quantite (2 × 14 €)', lu.Nourriture);
    ok(pareil(lu.Boissons, ['Duvel|2|5', 'Cruche Bière|2|18']), '[X1] deux cruches que rien ne separe se lisent « × 2 »', lu.Boissons);

    await quantite(page, 'Boissons', 0, 3);
    await quantite(page, 'Nourriture', 3, 2);
    const annonce = Number(await page.locator('#editPriceInput').inputValue());
    const envois = await enregistrer(page, journal);
    const corps = envois.length ? envois[envois.length - 1].corps : null;
    const x = (corps && corps.extras) || [];
    ok(x.length === 7 && [0, 1, 2].every((i) => pareil(x[i], EXTRAS[i])) && pareil(x[5], EXTRAS[5]) && pareil(x[6], EXTRAS[6]),
      '[X2] les lignes intactes repartent telles que le dossier les porte (heure, note, article, auteur)', x);
    ok(pareil(sansAuteur(x[3]), { id: 'gateau-4', articleId: 'gateau-maison', categorie: 'gateaux', name: 'Gâteau chocolat × 2', qte: 2, prixUnitaire: 25, price: 50, heure: '17:00', note: 'bougies 7 ans' }),
      '[X2] le gateau passe a 2 avec son id, son article, sa categorie, son heure et sa note', x[3]);
    ok(pareil(sansAuteur(x[4]), { id: 'duvel-5', articleId: 'duvel', categorie: 'boissons', name: 'Duvel × 3', qte: 3, prixUnitaire: 5, price: 15, note: 'bien fraîches' }),
      '[X2] les Duvel passent a 3 avec leur article, leur prix a l unite et leur note', x[4]);

    const b = enBase(NOEL);
    const statut = envois.length ? envois[envois.length - 1].statut : 0;
    const lignes = b ? b.extras : [];
    const parId = (id) => lignes.filter((l) => l.id === id);
    ok(statut === 200 && lignes.length === 7, '[X3] le serveur ecrit les sept lignes', { statut, n: lignes.length, json: envois.length ? envois[envois.length - 1].json : null });
    ok(['pizza-margherita-1', 'pizza-margherita-2', 'nachos-together-3'].every((id, i) => parId(id).length === 1 && pareil(parId(id)[0], EXTRAS[i])),
      '[X3] en base, les pizzas et les nachos gardent tout, leur auteur compris (Lucas)', lignes.slice(0, 3));
    const gateau = parId('gateau-4')[0] || {};
    const duvel = parId('duvel-5')[0] || {};
    ok(gateau.articleId === 'gateau-maison' && gateau.categorie === 'gateaux' && gateau.heure === '17:00' && gateau.note === 'bougies 7 ans' && Number(gateau.qte) === 2 && Number(gateau.price) === 50 && gateau.par === 'Rachel',
      '[X3] en base, le gateau change garde article, categorie, heure et note, et prend l auteur de la session', gateau);
    ok(duvel.articleId === 'duvel' && duvel.categorie === 'boissons' && duvel.note === 'bien fraîches' && Number(duvel.qte) === 3 && Number(duvel.prixUnitaire) === 5 && Number(duvel.price) === 15 && duvel.par === 'Rachel',
      '[X3] en base, les Duvel changes gardent article, categorie et note', duvel);
    ok(b && Math.abs(b.price - annonce) < 0.01 && Math.abs(b.price - (PRIX + 5 + 25)) < 0.01, `[X3] le prix ecrit est celui que la fiche annoncait (${annonce} €)`, { base: b && b.price, annonce });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (libre)', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [X4] AU NIVEAU CATALOGUE.
// ---------------------------------------------------------------------------
async function scenarioCatalogue(browser) {
  semer();
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('assistant-manager', { nom: 'Sami' }) });
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  try {
    await ouvrirModifier(page);
    await quantite(page, 'Boissons', 0, 3);
    const envois = await enregistrer(page, journal);
    const dernier = envois.length ? envois[envois.length - 1] : null;
    const b = enBase(NOEL);
    const lignes = b ? b.extras : [];
    ok(dernier && dernier.statut === 200, '[X4] catalogue : changer les Duvel passe, l ancienne cruche hors de la carte ne fait rien refuser', dernier ? { statut: dernier.statut, json: dernier.json } : 'aucun envoi');
    ok(lignes.filter((l) => l.name === 'Cruche Bière' && Number(l.price) === 18).length === 2 && lignes.filter((l) => /^Pizza Margherita/.test(l.name)).map((l) => l.heure).join() === '16:30,17:00',
      '[X4] catalogue : les deux cruches restent, les pizzas gardent leurs heures', lignes);
    const duvel = lignes.find((l) => l.id === 'duvel-5') || {};
    ok(duvel.note === 'bien fraîches' && Number(duvel.qte) === 3 && Number(duvel.price) === 15 && duvel.articleId === 'duvel',
      '[X4] catalogue : les Duvel changes gardent leur note, au prix de la carte', duvel);
    ok(erreurs.length === 0, '[J1] aucune erreur JS (catalogue)', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const LIBRE = ['libre'];
const CATALOGUE = ['catalogue'];
const MUTATIONS = [
  // Les lignes refaites a chaque envoi, comme avant : le serveur ne reconnait plus rien.
  { nom: 'lignes-refaites', lettre: 'X2', scenarios: LIBRE, editions: [{ fichier: JS, de: '      if (intacte) {\n', vers: '      if (false) {\n' }] },
  { nom: 'lignes-refaites-catalogue', lettre: 'X4', scenarios: CATALOGUE, editions: [{ fichier: JS, de: '      if (intacte) {\n', vers: '      if (false) {\n' }] },
  // Deux pizzas a deux heures fondues en « × 2 ».
  { nom: 'heures-fondues', lettre: 'X1', scenarios: LIBRE, editions: [{ fichier: JS, de: "      && (l.heure || '') === heure && (l.note || '') === note && EXTRA_GARDE", vers: '      && EXTRA_GARDE' }] },
  // La quantite lue seulement dans le nom.
  { nom: 'quantite-du-nom', lettre: 'X1', scenarios: LIBRE, editions: [{ fichier: JS, de: ' : (qteLue >= 1 ? qteLue : 1);', vers: ' : 1;' }] },
  { nom: 'article-perdu', lettre: 'X2', scenarios: LIBRE, editions: [{ fichier: JS, de: '        ...(memeArticle && garde.articleId ? { articleId: garde.articleId } : {}),\n', vers: '' }] },
  { nom: 'categorie-perdue', lettre: 'X2', scenarios: LIBRE, editions: [{ fichier: JS, de: '        categorie: (memeArticle && garde.categorie) || nomGroupe,\n', vers: '        categorie: nomGroupe,\n' }] },
  { nom: 'heure-perdue', lettre: 'X2', scenarios: LIBRE, editions: [{ fichier: JS, de: '        ...(heure ? { heure } : {}),\n        ...(note ? { note } : {}),\n', vers: '' }] },
  { nom: 'id-refait', lettre: 'X2', scenarios: LIBRE, editions: [{ fichier: JS, de: '        id: (garde && garde.id) || `${nomGroupe}-${i + 1}`,\n', vers: '        id: `${nomGroupe}-${i + 1}`,\n' }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'libre') await scenarioLibre(browser);
    if (nom === 'catalogue') await scenarioCatalogue(browser);
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, ['libre', 'catalogue']);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.MC_MUTATIONS || liste(process.env.MC_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.MC_BAVARD;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `[K] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveurHttp.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nmodifier-complet-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nmodifier-complet-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

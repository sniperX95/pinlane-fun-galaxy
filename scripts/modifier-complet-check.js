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
//   [H1] une activite ajoutee dans Modifier (le minigolf) a son champ « Heure », vide (le planning
//        la placerait) ; tapee (18:00), elle part avec le programme (heuresPosees), la barre du bas
//        le dit, et le serveur l ecrit a cette heure, le bowling a la sienne ;
//   [H2] une heure qui chevauche le bowling (16:45) : le serveur refuse avec sa phrase, la fiche
//        la montre, rien n est ecrit ;
//   [H3] le serveur ne pose une heure que sur une activite ajoutee : une heure envoyee pour le
//        bowling deja au dossier ne le deplace pas ;
//   [F1] un dossier a la carte (Famille Noel, bowling) a son menu « Formule », « Aucune formule » en tete ;
//   [F2] choisir une formule du centre en fait une formule (indice, barre), « Enregistrer » l ecrit ;
//   [F3] « Aucune formule » rend le dossier tel qu il etait : aucune modification ;
//   [D1] chaque extra dit son heure de service et sa note (les deux pizzas ne se ressemblent plus) ;
//        une boisson du catalogue (heure: false) n a pas d heure ;
//   [D2] l heure et la note se changent sur la ligne, la barre du bas le dit, la base les ecrit
//        et la ligne garde son auteur ;
//   [D3] un nom du catalogue (« crêpe au sucre ») relie la ligne a l article : son prix de la carte,
//        son id, sa categorie et son nom partent avec elle ;
//   [D4] au telephone, rien ne deborde et l heure et la note se touchent au doigt (44 px) ;
//   [E1] les notes de l equipe se relisent et se changent dans Modifier (qui et quand en etiquette),
//        et une nouvelle se tape ;
//   [E2] une note changee, une videe, une nouvelle : la barre du bas le dit, la base ecrit les deux
//        signees de la session et retire la videe ;
//   [E3] la trace d un prix revu ne se montre pas a changer, et elle reste telle quelle, le mot du
//        dossier aussi ;
//   [T1] le numero d un dossier ne se vide pas : rien ne part, la fiche le dit sous le champ ;
//   [T2] un numero trop court se dit en quittant le champ et ne part pas ; un numero qui tient
//        efface la ligne ;
//   [T3] le serveur refuse un numero change trop court (422) a un poste reste sur une ancienne page ;
//   [T4] un numero qui tient part et s ecrit ;
//   [G1] un laser a plusieurs parties a son espacement (30 min, 1 h, 1 h 30, + Pause), le sien choisi ;
//   [G2] « 1h » pose la 2e partie a 16:30 (son champ, la barre du bas) et « Enregistrer » la deplace ;
//   [G3] « + Pause » repousse la derniere partie de 30 min, les autres restent ;
//   [R1] un prix tape a la main demande sa raison : les raisons de Reserver et une autre a taper ;
//   [R2] la raison choisie part avec le prix et s ecrit dans la note du serveur ;
//   [R3] le plafond du role (10 %) se lit sous les raisons, et le dit avant le refus ;
//   [I1] sans le droit « Ajouter du sur mesure », « Ajouter » se voit eteint, une ligne nomme le droit ;
//   [I2] sans le droit « Ajuster un prix », « Offert » se voit eteint sur chaque ligne, une ligne le dit ;
//   [I3] sans le droit « Adapter une formule », le programme d une formule se lit, une ligne le dit ;
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
function semer(plus = {}) {
  B.semer(FIXTURE.staffState.reservations.map((r) => (r.id === NOEL ? { ...ligneDepuis(r), extras: JSON.parse(JSON.stringify(EXTRAS)), price: PRIX, ...plus } : ligneDepuis(r))));
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
      await page.exposeFunction('__fixtureLecture', async (chemin) => lectureCatalogue(chemin));
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
// [H1] [H2] [H3] L HEURE D UNE ACTIVITE AJOUTEE.
// ---------------------------------------------------------------------------
// L heure (en minutes) qu une activite a dans le plan ecrit : le premier service du bowling, la
// premiere etape a heure d une autre activite.
function heureEnBase(id, activite) {
  const row = B.base.reservations.get(Number(id));
  const plan = row && (typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : row.ops_plan);
  const debut = (x) => { const lu = /^(\d{1,2}):(\d{2})/.exec(String((x && x.startTime) || '')); return lu ? Number(lu[1]) * 60 + Number(lu[2]) : NaN; };
  const premiers = (liste) => { const d = liste.map(debut).filter(Number.isFinite); return d.length ? Math.min(...d) : NaN; };
  if (!plan) return NaN;
  if (activite === 'bowling') return premiers((plan.resourceBlocks || []).filter((b) => b && b.resourceType === 'bowling_lane'));
  return premiers((plan.timeline || []).filter((e) => e && e.type === 'activity' && e.activityId === activite && e.flexible !== true));
}
const GOLF = 'minigolf_blacklight';
async function scenarioHeure(browser) {
  semer();
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  try {
    const bowlingAvant = heureEnBase(NOEL, 'bowling');
    await ouvrirModifier(page);
    await page.click(`#posOverlay .fm-ajouts .fm-ajout[onclick*="'${GOLF}'"]`);
    await page.waitForSelector(`#posOverlay [data-heure-nouvelle="${GOLF}"]`, { timeout: 5000 }).catch(() => null);
    const champ = await page.evaluate((golf) => {
      const c = document.querySelector(`#posOverlay [data-heure-nouvelle="${golf}"]`);
      const l = c && document.querySelector(`#posOverlay label[for="${c.id}"]`);
      return c ? { type: c.type, valeur: c.value, label: l ? l.textContent.trim() : '' } : null;
    }, GOLF);
    ok(champ && champ.type === 'time' && champ.valeur === '' && champ.label === 'Heure', '[H1] le minigolf ajoute a son champ « Heure », vide', champ);

    // [H2] 16:45 chevauche le bowling (16:30) : refuse, rien n est ecrit.
    await page.fill(`#posOverlay [data-heure-nouvelle="${GOLF}"]`, '16:45');
    await page.waitForTimeout(150);
    const refuse = await enregistrer(page, journal);
    const r2 = refuse.length ? refuse[refuse.length - 1] : null;
    const dit = await page.evaluate(() => { const n = document.getElementById('editError'); return n && !n.hidden ? n.textContent.trim() : ''; });
    ok(r2 && r2.statut === 422 && /chevauche/i.test(String(r2.json && r2.json.message)) && r2.corps.heuresPosees && r2.corps.heuresPosees[GOLF] === '16:45',
      '[H2] 16:45 chevauche le bowling : le serveur refuse avec sa phrase', r2 ? { statut: r2.statut, json: r2.json, heures: r2.corps.heuresPosees } : 'aucun envoi');
    ok(/chevauche/i.test(dit) && !Number.isFinite(heureEnBase(NOEL, GOLF)), '[H2] la fiche montre la phrase, rien n est ecrit', { dit, golf: heureEnBase(NOEL, GOLF) });

    // [H1] 18:00 passe : la barre le dit, le serveur l ecrit.
    await page.fill(`#posOverlay [data-heure-nouvelle="${GOLF}"]`, '18:00');
    await page.waitForTimeout(150);
    const barre = await page.evaluate(() => (document.getElementById('editModifs') || {}).textContent || '');
    ok(/Minigolf[^,]* à 18:00/.test(barre), '[H1] la barre du bas dit « Minigolf … à 18:00 »', barre);
    const envois = await enregistrer(page, journal);
    const r1 = envois.length ? envois[envois.length - 1] : null;
    ok(r1 && r1.statut === 200 && pareil(r1.corps.heuresPosees, { [GOLF]: '18:00' }) && (r1.corps.program && r1.corps.program.items || []).some((i) => i.activityId === GOLF),
      '[H1] l heure part avec le programme (heuresPosees)', r1 ? { statut: r1.statut, heures: r1.corps.heuresPosees, json: r1.statut === 200 ? '' : r1.json } : 'aucun envoi');
    ok(heureEnBase(NOEL, GOLF) === 18 * 60 && heureEnBase(NOEL, 'bowling') === bowlingAvant,
      '[H1] le serveur ecrit le minigolf a 18:00, le bowling garde son heure', { golf: heureEnBase(NOEL, GOLF), bowling: heureEnBase(NOEL, 'bowling'), avant: bowlingAvant });

    // [H3] le meme corps, plus une heure pour le bowling deja au dossier : rien ne le deplace.
    if (r1 && r1.corps) {
      semer();
      const rep = await serveur.appeler('PATCH', '/api/staff-reservations', { ...r1.corps, heuresPosees: { ...r1.corps.heuresPosees, bowling: '18:30' } });
      ok(rep.statut === 200 && heureEnBase(NOEL, 'bowling') === bowlingAvant && heureEnBase(NOEL, GOLF) === 18 * 60,
        '[H3] une heure envoyee pour le bowling deja au dossier ne le deplace pas', { statut: rep.statut, json: rep.statut === 200 ? '' : rep.json, bowling: heureEnBase(NOEL, 'bowling'), golf: heureEnBase(NOEL, GOLF) });
    }
    ok(erreurs.length === 0, '[J1] aucune erreur JS (heure)', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [F1] [F2] [F3] UN DOSSIER A LA CARTE PREND UNE FORMULE.
// ---------------------------------------------------------------------------
async function scenarioFormule(browser) {
  semer();
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  try {
    await ouvrirModifier(page);
    const lireMenu = () => page.evaluate(() => {
      const m = document.querySelector('#posOverlay #editFormuleSelect');
      const h = document.getElementById('editFormuleHint');
      return m ? { valeur: m.value, premiere: m.options[0] ? [m.options[0].value, m.options[0].textContent.trim()] : null, formules: Array.from(m.options).filter((o) => o.value).map((o) => [o.value, o.textContent.trim()]), indice: h && !h.hidden ? h.textContent.trim() : '', barre: (document.getElementById('editModifs') || {}).textContent || '', type: state.editState.type, formuleId: state.editState.formuleId || '' } : null;
    });
    const a = await lireMenu();
    ok(a && a.valeur === '' && a.premiere && a.premiere.join() === ',Aucune formule' && a.formules.length > 0 && a.indice === '',
      '[F1] le bowling a la carte a son menu « Formule », « Aucune formule » choisi, rien de plus', a);
    // CRAZY STUDENT STRIKE, du bowling a la piste : a 16:30 le laser est plein, une formule qui
    // en a ne passerait pas (le serveur le refuse, et il a raison).
    const choisie = a && (a.formules.find(([id]) => id === 'css') || a.formules[0]);
    await page.selectOption('#posOverlay #editFormuleSelect', choisie ? choisie[0] : '');
    await page.waitForTimeout(250);
    const b = await lireMenu();
    ok(b && b.valeur === (choisie && choisie[0]) && b.type === 'formule' && b.formuleId === (choisie && choisie[0]) && b.indice !== '' && !/Aucune modification/.test(b.barre),
      `[F2] choisir ${choisie && choisie[1]} en fait une formule, l indice et la barre le disent`, b);
    await page.selectOption('#posOverlay #editFormuleSelect', '');
    await page.waitForTimeout(250);
    const c = await lireMenu();
    ok(c && c.valeur === '' && c.type === 'bowling' && c.formuleId === '' && /Aucune modification/.test(c.barre) && c.indice === '',
      '[F3] « Aucune formule » rend le dossier tel qu il etait : aucune modification', c);
    await page.selectOption('#posOverlay #editFormuleSelect', choisie ? choisie[0] : '');
    await page.waitForTimeout(250);
    const envois = await enregistrer(page, journal);
    const r = envois.length ? envois[envois.length - 1] : null;
    const row = B.base.reservations.get(NOEL);
    ok(r && r.statut === 200 && r.corps.type === 'formule' && r.corps.formuleId === (choisie && choisie[0]) && row && row.type === 'formule' && String(row.formule_id) === String(choisie && choisie[0]),
      '[F2] « Enregistrer » ecrit la formule au dossier', r ? { statut: r.statut, json: r.statut === 200 ? '' : r.json, type: row && row.type, formule: row && row.formule_id } : 'aucun envoi');
    ok(erreurs.length === 0, '[J1] aucune erreur JS (formule)', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [D1] [D2] [D3] [D4] L HEURE, LA NOTE ET L ARTICLE D UN EXTRA.
// ---------------------------------------------------------------------------
// Le catalogue du centre tel que api/ops.js le sert (surMesureCatalogue), lu dans le vrai code.
function lectureCatalogue(chemin) {
  if (!/^\/api\/ops\?action=surMesureCatalogue/.test(String(chemin))) return null;
  const cc = require(path.join(ROOT, 'lib/center-config.js'));
  return { ok: true, surMesure: cc.surMesureChoisissable(cc.catalogueSurMesure('libramont')), formulesGardees: [] };
}
function lireService() {
  const groupes = {};
  document.querySelectorAll('#posOverlay .fm-extras .fm-x-groupe').forEach((g) => {
    groupes[g.getAttribute('aria-label')] = Array.from(g.querySelectorAll('.fm-x-ligne')).map((l) => {
      const h = l.querySelector('.fm-x-heure');
      const n = l.querySelector('.fm-x-note');
      return [l.querySelector('.fm-x-choix').value, h ? h.value : null, n ? n.value : null];
    });
  });
  return groupes;
}
async function catalogueCharge(page) {
  await page.waitForFunction(() => catalogueSurMesureConsole && Array.isArray(catalogueSurMesureConsole.articles) && catalogueSurMesureConsole.articles.length > 0, null, { timeout: 8000 }).catch(() => null);
  await page.evaluate(() => renderPos());
  await page.waitForTimeout(150);
}
async function scenarioService(browser) {
  semer();
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  try {
    await ouvrirModifier(page);
    await catalogueCharge(page);
    const a = await page.evaluate(lireService);
    ok(pareil(a.Nourriture, [['Pizza Margherita', '16:30', 'sans basilic'], ['Pizza Margherita', '17:00', ''], ['Nachos Together', '', ''], ['Gâteau chocolat', '17:00', 'bougies 7 ans']]),
      '[D1] chaque extra dit son heure de service et sa note : les deux pizzas ne se ressemblent plus', a.Nourriture);
    ok(pareil(a.Boissons, [['Duvel', null, 'bien fraîches'], ['Cruche Bière', '', '']]),
      '[D1] une boisson du catalogue n a pas d heure, sa note se lit', a.Boissons);

    await page.locator(`${LIGNE('Nourriture', 0)} >> .fm-x-heure`).fill('17:30');
    await page.locator(`${LIGNE('Boissons', 0)} >> .fm-x-note`).fill('une au citron');
    await page.waitForTimeout(150);
    const barre = await page.evaluate(() => (document.getElementById('editModifs') || {}).textContent || '');
    ok(/Pizza Margherita à 17:30/.test(barre) && /Note Duvel/.test(barre), '[D2] la barre du bas dit l heure et la note changees', barre);

    // [D3] un nom du catalogue, tape sans majuscule : la ligne prend l article et son prix de la carte.
    await page.click('#posOverlay .fm-extras .fm-ajout[onclick*="nourriture"]');
    await page.keyboard.type('crêpe au sucre');
    await page.waitForTimeout(150);
    const prix = await page.locator(`${LIGNE('Nourriture', 4)} >> .fm-x-prix`).inputValue();
    ok(prix === '6', '[D3] « crêpe au sucre » prend le prix de la carte (6 €)', prix);

    const envois = await enregistrer(page, journal);
    const r = envois.length ? envois[envois.length - 1] : null;
    const lignes = (enBase(NOEL) || {}).extras || [];
    const parId = (id) => lignes.find((l) => l.id === id) || {};
    ok(r && r.statut === 200 && parId('pizza-margherita-1').heure === '17:30' && parId('pizza-margherita-1').par === 'Lucas' && parId('pizza-margherita-2').heure === '17:00'
      && parId('duvel-5').note === 'une au citron' && parId('duvel-5').par === 'Lucas',
      '[D2] en base, la pizza passe a 17:30 et la note des Duvel change, leur auteur reste', r ? { statut: r.statut, json: r.statut === 200 ? '' : r.json, lignes: lignes.slice(0, 5) } : 'aucun envoi');
    const crepe = lignes.find((l) => /cr[eê]pe/i.test(l.name)) || {};
    ok(crepe.articleId === 'crepe-au-sucre' && crepe.categorie === 'nourriture' && crepe.name === 'Crêpe au sucre × 1' && Number(crepe.price) === 6,
      '[D3] en base, la crepe est l article du catalogue, a son nom et son prix', crepe);
    ok(erreurs.length === 0, '[J1] aucune erreur JS (service)', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
  // [D4] au telephone : rien ne deborde, les champs se touchent au doigt.
  semer();
  const serveur2 = B.monter({ mutations: [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const m = await monter(browser, serveur2, { appareil: 'telephone', theme: 'light' });
  try {
    await ouvrirModifier(m.page);
    await catalogueCharge(m.page);
    const d = await m.page.evaluate(() => {
      const sec = document.querySelector('#posOverlay .fm-extras');
      const vw = document.documentElement.clientWidth;
      const champs = Array.from(sec.querySelectorAll('.fm-x-opts .input')).map((n) => { const b = n.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
      const debordent = Array.from(sec.querySelectorAll('.fm-x-ligne, .fm-x-ligne *')).filter((n) => { const b = n.getBoundingClientRect(); return b.width && (b.right > vw + 1 || b.left < -1); }).length;
      return { vw, champs, debordent };
    });
    ok(d.debordent === 0 && d.champs.length >= 7 && d.champs.every(([l, h]) => h >= 44 && l >= 44), `[D4] telephone (${d.vw} px) : rien ne deborde, l heure et la note se touchent au doigt`, d);
    ok(m.erreurs.length === 0, '[J1] aucune erreur JS (service, telephone)', m.erreurs.slice(0, 3));
  } finally {
    await m.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [E1] [E2] [E3] LES NOTES DE L EQUIPE.
// ---------------------------------------------------------------------------
const NOTE = (o) => `[equipe] ${JSON.stringify(o)}`;
const DEMO = (FIXTURE.staffState.reservations.find((r) => r.id === NOEL) || {}).notes || '';
const TRACE = NOTE({ t: 'Prix 39 € → 35 €, geste', par: 'Lucas', le: '2026-11-19T09:00:00.000Z', type: 'prix', prix: { de: 39, a: 35, raison: 'geste' } });
const NOTES = [DEMO, TRACE, NOTE({ t: 'Allergie arachides', par: 'Lucas', le: '2026-11-19T10:00:00.000Z' }), NOTE({ t: 'Gâteau apporté par les parents', par: 'Lucas', le: '2026-11-19T10:05:00.000Z' })].filter(Boolean).join('\n');
function notesEnBase() {
  const row = B.base.reservations.get(NOEL);
  const lignes = String((row && row.notes) || '').split('\n');
  const equipe = lignes.filter((l) => l.startsWith('[equipe] ')).map((l) => { try { return JSON.parse(l.slice(9)); } catch (e) { return null; } }).filter(Boolean);
  return { lignes, equipe };
}
async function scenarioNotes(browser) {
  semer({ notes: NOTES });
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  try {
    await page.evaluate(({ id, notes }) => {
      const r = state.reservations.find((x) => x.id === id);
      const servi = window.__FIXTURE__.jours[window.__FIXTURE__.jour].find((x) => x.id === id);
      [r, servi].filter(Boolean).forEach((d) => { d.notes = notes; });
    }, { id: NOEL, notes: NOTES });
    await ouvrirModifier(page);
    const lire = () => page.evaluate(() => {
      const sec = document.querySelector('#posOverlay .fm-notes');
      if (!sec) return null;
      return {
        champs: Array.from(sec.querySelectorAll('textarea')).map((n) => [(document.querySelector(`label[for="${n.id}"]`) || {}).textContent || '', n.value]),
        barre: (document.getElementById('editModifs') || {}).textContent || '',
      };
    });
    const a = await lire();
    ok(a && a.champs.length === 3 && a.champs[0][1] === 'Allergie arachides' && /Lucas/.test(a.champs[0][0]) && a.champs[1][1] === 'Gâteau apporté par les parents' && a.champs[2][0] === 'Nouvelle note' && a.champs[2][1] === '',
      '[E1] les notes de l equipe se relisent dans Modifier, qui et quand en etiquette, et une nouvelle se tape', a);
    ok(a && !a.champs.some(([, v]) => /Prix 39/.test(v)), '[E3] la trace d un prix revu ne se montre pas en note a changer', a && a.champs);

    await page.fill('#posOverlay .fm-notes textarea >> nth=0', 'Allergie arachides et noix');
    await page.fill('#posOverlay .fm-notes textarea >> nth=1', '');
    await page.fill('#posOverlay #editNoteNouvelle', 'Table près de la piste 6');
    await page.waitForTimeout(150);
    const b = await lire();
    ok(b && /Note modifiée/.test(b.barre) && /Note retirée/.test(b.barre) && /Note ajoutée/.test(b.barre), '[E2] la barre du bas dit la note modifiee, retiree et ajoutee', b && b.barre);
    const envois = await enregistrer(page, journal);
    const r = envois.length ? envois[envois.length - 1] : null;
    const n = notesEnBase();
    const textes = n.equipe.filter((x) => x.type !== 'prix').map((x) => `${x.t}|${x.par}`);
    ok(r && r.statut === 200 && pareil(textes, ['Allergie arachides et noix|Rachel', 'Table près de la piste 6|Rachel']),
      '[E2] en base, la note changee et la nouvelle sont signees de la session, la note videe est partie', r ? { statut: r.statut, json: r.statut === 200 ? '' : r.json, textes } : 'aucun envoi');
    ok(n.lignes.includes(TRACE) && (!DEMO || n.lignes.includes(DEMO)), '[E3] la trace du prix et le mot du dossier restent tels quels', n.lignes);
    ok(erreurs.length === 0, '[J1] aucune erreur JS (notes)', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [T1] [T2] [T3] [T4] LE TELEPHONE.
// ---------------------------------------------------------------------------
const TEL = '0470 11 22 33';
async function scenarioTelephoneFiche(browser) {
  semer({ phone: TEL });
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  const telEnBase = () => String((B.base.reservations.get(NOEL) || {}).phone || '');
  const lire = () => page.evaluate(() => {
    const c = document.getElementById('editPhoneInput');
    const h = document.getElementById('editPhoneHint');
    const err = document.getElementById('editError');
    // (la couleur de la ligne, comparee au rouge des erreurs de la console)
    const temoin = document.createElement('span');
    temoin.style.color = 'var(--danger)';
    document.body.appendChild(temoin);
    const danger = getComputedStyle(temoin).color;
    temoin.remove();
    return { valeur: c ? c.value : null, invalide: c ? c.getAttribute('aria-invalid') : null, ligne: h && !h.hidden ? h.textContent.trim() : '', couleur: h && !h.hidden ? getComputedStyle(h).color : '', danger, erreur: err && !err.hidden ? err.textContent.trim() : '', placeholder: c ? c.getAttribute('placeholder') : null };
  });
  const essayer = async () => { const avant = journal.length; await page.click('#posOverlay .es-save'); await page.waitForTimeout(700); return journal.length - avant; };
  try {
    await page.evaluate(({ id, tel }) => {
      const r = state.reservations.find((x) => x.id === id);
      const servi = window.__FIXTURE__.jours[window.__FIXTURE__.jour].find((x) => x.id === id);
      [r, servi].filter(Boolean).forEach((d) => { d.phone = tel; });
    }, { id: NOEL, tel: TEL });
    await ouvrirModifier(page);
    await page.evaluate(() => { const p = document.getElementById('editContactPli'); if (p) p.open = true; });
    const a = await lire();
    ok(a.valeur === TEL && a.placeholder === null && a.ligne === '', '[T1] le numero du dossier se lit, sans « Facultatif »', a);
    await page.fill('#editPhoneInput', '');
    const envoyes1 = await essayer();
    const b = await lire();
    ok(envoyes1 === 0 && /ne peut pas être vidé/.test(b.erreur) && /ne peut pas être vidé/.test(b.ligne) && b.invalide === 'true' && telEnBase() === TEL,
      '[T1] vider le numero d un dossier ne part pas : la fiche le dit sous le champ', { envoyes: envoyes1, ...b, base: telEnBase() });
    await page.fill('#editPhoneInput', '0470 12');
    await page.keyboard.press('Tab');
    const c = await lire();
    const envoyes2 = await essayer();
    ok(/pas valide/.test(c.ligne) && c.invalide === 'true' && envoyes2 === 0 && telEnBase() === TEL,
      '[T2] un numero trop court se dit en quittant le champ, et ne part pas', { ...c, envoyes: envoyes2 });
    ok(Boolean(c.couleur) && c.couleur === c.danger, '[T2] la ligne du numero refuse se lit en rouge, comme une erreur', { couleur: c.couleur, danger: c.danger });
    await page.fill('#editPhoneInput', '0471 99 88 77');
    const d = await lire();
    ok(d.ligne === '' && d.invalide === null, '[T2] un numero qui tient efface la ligne', d);
    const envois = await enregistrer(page, journal);
    const r = envois.length ? envois[envois.length - 1] : null;
    ok(r && r.statut === 200 && telEnBase() === '0471 99 88 77', '[T4] un numero qui tient part et s ecrit', r ? { statut: r.statut, json: r.statut === 200 ? '' : r.json, base: telEnBase() } : 'aucun envoi');
    // [T3] le serveur redit la regle a un poste reste sur une ancienne page.
    if (r && r.corps) {
      semer({ phone: TEL });
      const court = await serveur.appeler('PATCH', '/api/staff-reservations', { ...r.corps, phone: '12' });
      ok(court.statut === 422 && /pas valide/.test(String(court.json && court.json.message)) && telEnBase() === TEL, '[T3] le serveur refuse un numero trop court (422, avec sa phrase), rien ne s ecrit',
        { court: [court.statut, court.json && court.json.message], base: telEnBase() });
    }
    ok(erreurs.length === 0, '[J1] aucune erreur JS (telephone)', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [G1] [G2] [G3] L ESPACEMENT DES PARTIES DU LASER.
// ---------------------------------------------------------------------------
const MANON = 1618; // laser, 8 joueurs, deux parties 15:30 et 16:00
const ROMAIN = 1630; // laser, 20 joueurs, trois parties 21:30, 22:00, 22:30
function partiesEnBase(id) {
  const row = B.base.reservations.get(Number(id));
  const plan = row && (typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : row.ops_plan);
  return ((plan && plan.resourceBlocks) || []).filter((b) => b && b.resourceType === 'laser_arena').sort((a, b) => (a.countIndex || 1) - (b.countIndex || 1)).map((b) => `${b.countIndex || 1}@${String(b.startTime).slice(0, 5)}`).join(',');
}
async function ouvrirLaser(page, id) {
  await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
  await page.waitForSelector('#posOverlay .fm-programme', { timeout: 8000 });
}
const lireEspacement = (page) => page.evaluate(() => {
  const rang = document.querySelector('#posOverlay .fm-espacement');
  return {
    choix: rang ? Array.from(rang.querySelectorAll('button')).map((b) => `${b.textContent.trim()}${b.classList.contains('active') ? '*' : ''}`) : null,
    heures: Array.from(document.querySelectorAll('#posOverlay [data-heure-champ^="laser_game:"]')).map((n) => `${n.getAttribute('data-heure-champ')}=${n.value}`),
    barre: (document.getElementById('editModifs') || {}).textContent || '',
  };
});
async function scenarioEspacement(browser) {
  semer();
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  try {
    await ouvrirLaser(page, MANON);
    const a = await lireEspacement(page);
    ok(a.choix && a.choix.join() === '30 min*,1 h,1 h 30,+ Pause', '[G1] le laser a deux parties a son espacement : 30 min (le sien), 1 h, 1 h 30, + Pause', a);
    await page.click('#posOverlay .fm-espacement [data-espacement="60"]');
    await page.waitForTimeout(250);
    const b = await lireEspacement(page);
    ok(b.choix && b.choix.join() === '30 min,1 h*,1 h 30,+ Pause' && b.heures.join() === 'laser_game:2.1=16:30' && /16:00 → 16:30/.test(b.barre),
      '[G2] « 1h » pose la 2e partie a 16:30 : son champ, la barre du bas', b);
    const envois = await enregistrer(page, journal);
    const r = envois.length ? envois[envois.length - 1] : null;
    ok(r && r.statut === 200 && r.corps.activityMove && partiesEnBase(MANON) === '1@15:30,2@16:30', '[G2] « Enregistrer » deplace la 2e partie a 16:30', { statut: r && r.statut, json: r && r.statut !== 200 ? r.json : '', base: partiesEnBase(MANON) });
    await ouvrirLaser(page, ROMAIN);
    await page.click('#posOverlay .fm-espacement [data-pause]');
    await page.waitForTimeout(250);
    const c = await lireEspacement(page);
    ok(c.heures.join() === 'laser_game:3.1=23:00' && /22:30 → 23:00/.test(c.barre), '[G3] « + Pause » repousse la derniere partie de 30 min, les autres restent', c);
    ok(erreurs.length === 0, '[J1] aucune erreur JS (espacement)', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [R1] [R2] [R3] LA RAISON D UN PRIX CHANGE A LA MAIN.
// ---------------------------------------------------------------------------
async function scenarioRaison(browser) {
  semer();
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  const lire = () => page.evaluate(() => {
    const bloc = document.getElementById('editRaisonPrix');
    const ligne = document.getElementById('editPlafond');
    return {
      // (ce qui se voit vraiment : un style d affichage passe devant l attribut « caché »)
      visible: Boolean(bloc && bloc.getClientRects().length),
      cachesVus: Array.from(document.querySelectorAll('#posOverlay [hidden]')).filter((el) => el.getClientRects().length).map((el) => el.id || el.className),
      raisons: bloc ? Array.from(bloc.querySelectorAll('[data-raison]')).map((b) => `${b.textContent.trim()}${b.classList.contains('active') ? '*' : ''}`) : [],
      autre: Boolean(document.getElementById('editRaisonLibre')),
      plafond: ligne ? `${ligne.textContent.trim()}${ligne.classList.contains('is-ko') ? ' [ko]' : ''}` : '',
    };
  });
  try {
    await ouvrirModifier(page);
    // (le poste joue un role a 10 % de remise : le plafond se lit ; le serveur, lui, garde le Manager a 20 %)
    await page.evaluate(() => {
      const avant = window.niveauStaff;
      window.niveauStaff = (cle) => (cle === 'prix' ? '10' : avant(cle));
      renderPos();
    });
    const a = await lire();
    ok(a && !a.visible, '[R1] sans prix tape, pas de raison a donner', a);
    ok(a && !a.cachesVus.length, '[R1] dans la fenetre, rien de ce qui est marque cache ne se voit', a && a.cachesVus);
    await page.fill('#editPriceInput', '150');
    await page.waitForTimeout(150);
    const b = await lire();
    ok(b.visible && b.raisons.join() === 'Geste commercial,Client fidèle,Groupe,Erreur de tarif' && b.autre,
      '[R1] un prix tape demande sa raison : les raisons de Reserver et une autre a taper', b);
    ok(/Remise jusqu’à 10 %, soit 149,40 € au moins\./.test(b.plafond) && !/\[ko\]/.test(b.plafond), '[R3] le plafond du role se lit sous les raisons', b.plafond);
    await page.fill('#editPriceInput', '140');
    await page.waitForTimeout(150);
    const c = await lire();
    ok(/En dessous de 149,40 €, il faut un responsable\./.test(c.plafond) && /\[ko\]/.test(c.plafond), '[R3] sous le plafond, la ligne le dit avant le refus', c.plafond);
    await page.fill('#editPriceInput', '150');
    await page.click('#posOverlay #editRaisonPrix [data-raison="Client fidèle"]');
    await page.fill('#posOverlay #editRaisonLibre', 'habitué');
    await page.waitForTimeout(150);
    const envois = await enregistrer(page, journal);
    const r = envois.length ? envois[envois.length - 1] : null;
    const row = B.base.reservations.get(NOEL) || {};
    const notes = String(row.notes || '').split('\n').filter((l) => l.startsWith('[equipe] ')).map((l) => { try { return JSON.parse(l.slice(9)); } catch (e) { return null; } }).filter(Boolean);
    const prix = notes.find((n) => n.type === 'prix') || {};
    ok(r && r.statut === 200 && r.corps.prixRaison === 'Client fidèle · habitué' && Number(row.price) === 150 && prix.prix && prix.prix.raison === 'Client fidèle · habitué',
      '[R2] la raison choisie part avec le prix et s ecrit dans la note du serveur', { statut: r && r.statut, raison: r && r.corps.prixRaison, prix: row.price, note: prix, json: r && r.statut !== 200 ? r.json : '' });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (raison)', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [I1] [I2] [I3] UN GESTE QUE LE ROLE N A PAS SE VOIT ETEINT, AVEC LE DROIT QUI MANQUE.
// ---------------------------------------------------------------------------
const HUGO = 1602; // Formule 8, 10 joueurs
async function scenarioDroits(browser) {
  semer();
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs } = await monter(browser, serveur);
  try {
    // (le poste joue un role sans sur mesure, sans prix et sans formule a adapter)
    await page.evaluate(() => {
      const avant = window.niveauStaff;
      window.niveauStaff = (cle) => (['surmesure', 'prix', 'formule'].includes(cle) ? 'non' : avant(cle));
    });
    await ouvrirModifier(page);
    const a = await page.evaluate(() => {
      const sec = document.querySelector('#posOverlay .fm-extras');
      const ligne = (id) => { const n = document.getElementById(id); return n ? n.textContent.trim() : ''; };
      return {
        ajouter: sec ? Array.from(sec.querySelectorAll('.fm-x-ajouts .fm-ajout')).map((b) => `${b.textContent.trim()}${b.disabled ? '-' : '+'}`) : [],
        offert: sec ? Array.from(sec.querySelectorAll('.fm-x-opt')).filter((b) => b.textContent.trim() === 'Offert').map((b) => b.disabled) : [],
        droitSurMesure: ligne('fmxDroit'),
        droitPrix: ligne('fmxDroitPrix'),
      };
    });
    ok(a.ajouter.join() === 'Nourriture-,Boissons-,Autre-' && a.droitSurMesure === 'Il faut le droit « Ajouter du sur mesure ».',
      '[I1] sans le sur mesure, « Ajouter » se voit eteint et la ligne nomme le droit', a);
    ok(a.offert.length === 6 && a.offert.every(Boolean) && a.droitPrix === 'Il faut le droit « Ajuster un prix » pour offrir.',
      '[I2] sans le droit du prix, « Offert » se voit eteint sur chaque ligne et la ligne nomme le droit', a);
    await page.evaluate((id) => { closePos(); openPos(id); setTab('modifier'); }, HUGO);
    await page.waitForSelector('#posOverlay .fm-programme', { timeout: 8000 });
    const b = await page.evaluate(() => ({ lecture: Boolean(document.querySelector('#posOverlay .fm-lecture')), droit: (document.getElementById('fmDroitFormule') || {}).textContent || '' }));
    ok(b.lecture && b.droit.trim() === 'Il faut le droit « Adapter une formule » pour changer le programme.',
      '[I3] sans le droit d adapter une formule, le programme se lit et la ligne nomme le droit', b);
    ok(erreurs.length === 0, '[J1] aucune erreur JS (droits)', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const FORMULE = ['formule'];
const SERVICE = ['service'];
const NOTES_E = ['notes'];
const TELEPHONE = ['telephone'];
const ESPACEMENT = ['espacement'];
const RAISON = ['raison'];
const DROITS = ['droits'];
const CSS = 'assets/pinlane-staff.css';
const LIBRE = ['libre'];
const CATALOGUE = ['catalogue'];
const HEURE = ['heure'];
const API = 'api/staff-reservations.js';
const MUTATIONS = [
  // Les lignes refaites a chaque envoi, comme avant : le serveur ne reconnait plus rien.
  { nom: 'lignes-refaites', lettre: 'X2', scenarios: LIBRE, editions: [{ fichier: JS, de: '      if (intacte) {\n', vers: '      if (false) {\n' }] },
  { nom: 'lignes-refaites-catalogue', lettre: 'X4', scenarios: CATALOGUE, editions: [{ fichier: JS, de: '      if (intacte) {\n', vers: '      if (false) {\n' }] },
  // Deux pizzas a deux heures fondues en « × 2 ».
  { nom: 'heures-fondues', lettre: 'X1', scenarios: LIBRE, editions: [{ fichier: JS, de: "      && (l.heure || '') === heure && (l.note || '') === note && EXTRA_GARDE", vers: '      && EXTRA_GARDE' }] },
  // La quantite lue seulement dans le nom.
  { nom: 'quantite-du-nom', lettre: 'X1', scenarios: LIBRE, editions: [{ fichier: JS, de: ' : (qteLue >= 1 ? qteLue : 1);', vers: ' : 1;' }] },
  { nom: 'article-perdu', lettre: 'X2', scenarios: LIBRE, editions: [{ fichier: JS, de: '        ...(relie ? { articleId: relie.id } : memeArticle && garde.articleId ? { articleId: garde.articleId } : {}),\n', vers: '        ...(relie ? { articleId: relie.id } : {}),\n' }] },
  { nom: 'categorie-perdue', lettre: 'X2', scenarios: LIBRE, editions: [{ fichier: JS, de: '        categorie: (relie && relie.categorie) || (memeArticle && garde.categorie) || nomGroupe,\n', vers: '        categorie: (relie && relie.categorie) || nomGroupe,\n' }] },
  { nom: 'heure-perdue', lettre: 'X2', scenarios: LIBRE, editions: [{ fichier: JS, de: '        ...(heure ? { heure } : {}),\n        ...(note ? { note } : {}),\n', vers: '' }] },
  { nom: 'id-refait', lettre: 'X2', scenarios: LIBRE, editions: [{ fichier: JS, de: '        id: (garde && garde.id) || `${nomGroupe}-${i + 1}`,\n', vers: '        id: `${nomGroupe}-${i + 1}`,\n' }] },
  // L heure d une activite ajoutee : pas de champ, pas d envoi, pas de pose, pas de refus, et le serveur qui pose aussi l existant.
  { nom: 'heure-sans-champ', lettre: 'H1', scenarios: HEURE, editions: [{ fichier: JS, de: '${champHeureEditionHtml(choice.id)}${champHeureNouvelleHtml(choice.id)}', vers: '${champHeureEditionHtml(choice.id)}' }] },
  { nom: 'heure-pas-envoyee', lettre: 'H1', scenarios: HEURE, editions: [{ fichier: JS, de: '    if (heuresPoseesNouvelles) updated.heuresPosees = heuresPoseesNouvelles;\n', vers: '' }] },
  { nom: 'heure-muette', lettre: 'H1', scenarios: HEURE, editions: [{ fichier: JS, de: "  Object.entries(heuresNouvellesEnvoyees() || {}).forEach(([id, heure]) => modifs.push(", vers: '  [].forEach(([id, heure]) => modifs.push(' }] },
  { nom: 'serveur-ignore-l-heure', lettre: 'H1', scenarios: HEURE, editions: [{ fichier: API, serveur: true, de: '    ops.opsPlan = pose.dossier.opsPlan;\n', vers: '' }] },
  { nom: 'refus-avale', lettre: 'H2', scenarios: HEURE, editions: [{ fichier: API, serveur: true, de: '    if (pose.refus) throw createHttpError(pose.refus.message, 422);\n', vers: '' }] },
  // Le menu des formules reserve aux formules, sans « Aucune formule », sans retour.
  { nom: 'carte-sans-menu', lettre: 'F1', scenarios: FORMULE, editions: [{ fichier: JS, de: "  if (!origine || e.versProgrammeNormal) return '';", vers: "  if (!origine || !formuleDOrigineEdition(origine) || e.versProgrammeNormal) return '';" }] },
  { nom: 'sans-a-la-carte', lettre: 'F1', scenarios: FORMULE, editions: [{ fichier: JS, de: '  const aLaCarte = !formuleDOrigineEdition(origine) ?', vers: '  const aLaCarte = false ?' }] },
  { nom: 'retour-impossible', lettre: 'F3', scenarios: FORMULE, editions: [{ fichier: JS, de: "  if (!e || !r || !origine || (!formule && String(id || '') !== '')) return;", vers: '  if (!e || !r || !origine || !formule) return;' }] },
  // L heure et la note d un extra : cachees, oubliees, muettes, sans catalogue, trop petites au doigt.
  { nom: 'service-cache', lettre: 'D1', scenarios: SERVICE, editions: [{ fichier: JS, de: '          ${serviceLigneExtraHtml(groupe, i, l)}\n', vers: '' }] },
  { nom: 'boisson-a-l-heure', lettre: 'D1', scenarios: SERVICE, editions: [{ fichier: JS, de: '  const heure = !article || article.heure !== false || l.heure', vers: '  const heure = true' }] },
  { nom: 'service-intact-oublie', lettre: 'D2', scenarios: SERVICE, editions: [{ fichier: JS, de: "        const memeService = heure === (depart.heure || '') && note === (depart.note || '');", vers: '        const memeService = true;' }] },
  { nom: 'barre-muette-service', lettre: 'D2', scenarios: SERVICE, editions: [{ fichier: JS, de: "    if (heure !== (depart.heure || '')) changes.push(", vers: '    if (false) changes.push(' }] },
  { nom: 'sans-catalogue', lettre: 'D3', scenarios: SERVICE, editions: [{ fichier: JS, de: "  if (cle === 'choix') relierArticleExtra(groupe, i, ligne);\n", vers: '' }] },
  { nom: 'telephone-petit', lettre: 'D4', scenarios: SERVICE, editions: [{ fichier: CSS, de: '  body:is(.staff-mode, .admin-mode) .fx-modal .fm .fm-x-opts .input { min-height: 44px; height: 44px; font-size: 16px; }\n', vers: '' }] },
  // Les notes de l equipe : absentes, pas envoyees, muettes, la trace montree, la note videe gardee.
  { nom: 'notes-absentes', lettre: 'E1', scenarios: NOTES_E, editions: [{ fichier: JS, de: '          ${notesEquipeEditionHtml(r)}\n', vers: '' }] },
  { nom: 'notes-pas-envoyees', lettre: 'E2', scenarios: NOTES_E, editions: [{ fichier: JS, de: '    if (notesChangees !== null) updated.notes = notesChangees;', vers: '    if (false) updated.notes = notesChangees;' }] },
  { nom: 'barre-muette-notes', lettre: 'E2', scenarios: NOTES_E, editions: [{ fichier: JS, de: '  modifs.push(...modifsNotesEdition());\n', vers: '' }] },
  { nom: 'note-videe-gardee', lettre: 'E2', scenarios: NOTES_E, editions: [{ fichier: JS, de: '    if (sans.has(n.le)) return null;\n', vers: '' }] },
  { nom: 'trace-montree', lettre: 'E3', scenarios: NOTES_E, editions: [{ fichier: JS, de: '  return notesEquipeEcrites(departsEdition().get(e)?.origine || r).filter((n) => n && n.le);', vers: '  return getReservationNotesEquipe(departsEdition().get(e)?.origine || r).filter((n) => n && n.le);' }] },
  // Le telephone : le controle de la fiche, sa ligne, et celui du serveur.
  { nom: 'telephone-libre', lettre: 'T1', scenarios: TELEPHONE, editions: [{ fichier: JS, de: "  if (touches.includes('phone')) {", vers: '  if (false) {' }] },
  { nom: 'telephone-muet', lettre: 'T2', scenarios: TELEPHONE, editions: [{ fichier: JS, de: '  ligne.hidden = false;\n', vers: '' }] },
  { nom: 'telephone-ligne-grise', lettre: 'T2', scenarios: TELEPHONE, editions: [{ fichier: CSS, de: 'body:is(.staff-mode, .admin-mode) .fx-modal #editPhoneHint { font-size: 13px; font-weight: 600; color: var(--danger); }', vers: '' }] },
  { nom: 'serveur-telephone-court', lettre: 'T3', scenarios: TELEPHONE, editions: [{ fichier: API, serveur: true, de: "    if (tape && !require('../lib/telephone-du-client').telephoneValide(tape)) throw", vers: '    if (false) throw' }] },
  // L espacement du laser : absent, sans effet, la pause au mauvais endroit.
  { nom: 'espacement-absent', lettre: 'G1', scenarios: ESPACEMENT, editions: [{ fichier: JS, de: '${areneEditionHtml()}${espacementLaserEditionHtml(r)}', vers: '${areneEditionHtml()}' }] },
  { nom: 'espacement-sans-effet', lettre: 'G2', scenarios: ESPACEMENT, editions: [{ fichier: JS, de: 'debuts[0].debut + k * minutes]', vers: 'debuts[0].debut + k * 30]' }] },
  { nom: 'pause-ailleurs', lettre: 'G3', scenarios: ESPACEMENT, editions: [{ fichier: JS, de: '  const derniere = debuts[debuts.length - 1];', vers: '  const derniere = debuts[1];' }] },
  // La raison d un prix : absente, pas envoyee, le plafond muet.
  { nom: 'raison-toujours-la', lettre: 'R1', scenarios: RAISON, editions: [{ fichier: CSS, de: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm-raison[hidden] { display: none; }', vers: '' }] },
  { nom: 'raison-absente', lettre: 'R1', scenarios: RAISON, editions: [{ fichier: JS, de: '    ${raisonPrixEditionHtml()}\n', vers: '' }] },
  { nom: 'raison-pas-envoyee', lettre: 'R2', scenarios: RAISON, editions: [{ fichier: JS, de: '{ requiresLanes, prixSuivi, prixRaison: raisonPrixEdition(), allowPastStart: true }', vers: '{ requiresLanes, prixSuivi, allowPastStart: true }' }] },
  { nom: 'plafond-muet', lettre: 'R3', scenarios: RAISON, editions: [{ fichier: JS, de: '  if (prix < reference - marge) return {', vers: '  if (false) return {' }] },
  // Les droits qui manquent : la ligne du sur mesure, « Offert » cache, la ligne de la formule.
  { nom: 'droit-muet', lettre: 'I1', scenarios: DROITS, editions: [{ fichier: JS, de: "${droitManquantHtml('surmesure', '', 'fmxDroit')}", vers: '' }] },
  { nom: 'offert-cache', lettre: 'I2', scenarios: DROITS, editions: [{ fichier: JS, de: '\'<button type="button" class="fm-x-opt" disabled aria-describedby="fmxDroitPrix">Offert</button>\'', vers: "''" }] },
  { nom: 'formule-muette', lettre: 'I3', scenarios: DROITS, editions: [{ fichier: JS, de: "droitManquantHtml('formule', ' pour changer le programme', 'fmDroitFormule')", vers: "''" }] },
  { nom: 'serveur-pose-l-existant', lettre: 'H3', scenarios: HEURE, editions: [{ fichier: API, serveur: true, de: '.filter((posee) => !dejaAuDossier(posee.activityId) && proposedItems', vers: '.filter((posee) => proposedItems' }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'libre') await scenarioLibre(browser);
    if (nom === 'catalogue') await scenarioCatalogue(browser);
    if (nom === 'heure') await scenarioHeure(browser);
    if (nom === 'formule') await scenarioFormule(browser);
    if (nom === 'service') await scenarioService(browser);
    if (nom === 'notes') await scenarioNotes(browser);
    if (nom === 'telephone') await scenarioTelephoneFiche(browser);
    if (nom === 'espacement') await scenarioEspacement(browser);
    if (nom === 'raison') await scenarioRaison(browser);
    if (nom === 'droits') await scenarioDroits(browser);
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, ['libre', 'catalogue', 'heure', 'formule', 'service', 'notes', 'telephone', 'espacement', 'raison', 'droits']);
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

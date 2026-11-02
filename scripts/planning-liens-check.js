// LE TABLEAU RELIE CE QU IL MONTRE (2026-11-02).
//
// Movsar : « tout doit etre interconnecte pour simplifier a mort tout [...] pour que
// ca soit UTILE ». Un audit joue au comptoir a trouve ou le temps se perd : pointer et
// encaisser prennent un geste, mais des qu un client sort de sa ligne, la reponse est
// sur un autre ecran. Ce gate touche chaque lien, sur la vraie console (le samedi « pic »
// a 15:10, scripts/planning-v3-fixtures.js), et lit ce qui s ouvre.
//
//   [A] LA CASE D HEURE DIT CE QUI RESTE : les pistes libres de la demi-heure et les
//       places de son depart laser, sur leurs vraies sources ; une demi-heure passee
//       n offre plus rien.
//   [B] ELLE RESERVE A SON HEURE. Un toucher ouvre Réserver a cette heure, plus la fiche
//       du premier groupe ; une demi-heure passee n ouvre rien.
//   [C] LE BANDEAU MENE A SON GESTE : « Pistes » et « Laser » ouvrent Réserver, le groupe
//       du prochain depart ouvre sa fiche, et qui n est pas encore la se lit.
//   [D] LE RETARD SE TOUCHE : « ils arrivent dans 20 min » s ajoute au retard deja pris.
//   [E] LE MONTANT ENCAISSE : le groupe sur place paie depuis sa ligne, sans la fiche.
//   [F] « PAS VENU » ATTEND 15 MIN, et se tait sur un groupe qui a annonce son retard.
//   [G] UNE PISTE FERMEE SE VOIT SUR LA LIGNE et mene a son bloc.
//   [H] AU TELEPHONE, LA LISTE S OUVRE SUR L HEURE.
//   [I] LE MENU NE REDIT PAS CE QUI EST A COTE DE LUI.
//   [J] UN NOM NE SORT PAS DE SON TEXTE dans les nouveaux boutons.
//   [K] LE MEME CHIFFRE PARTOUT : « Sur place » dit la meme chose au tableau et a
//       l accueil, l apres-midi et le soir (un groupe paye qui joue encore compte, un
//       groupe paye parti ne compte plus).
//   [L] LES CHIFFRES DES PLANNINGS NE SE MARCHENT PAS DESSUS, a toutes les largeurs, menu
//       ouvert ou replie, meme avec le detail le plus long (toutes les pistes libres).
//   [M] LA LISTE SOUS LE TABLEAU TROUVE CE QUE LE TABLEAU TROUVE : une heure, une piste,
//       un nombre, pas seulement un nom.
//   [N] UN JOUR VIDE CHERCHE AUSSI : le client est peut-etre sur une autre date.
//   [O] ENTREE NE POINTE QU UN NOM JUSTE : une faute, une heure, une piste, un nombre
//       trouvent une ligne, ils ne font arriver personne.
//
// --contre-preuves : chaque regle retiree (au code servi, jamais au disque) fait rougir
// sa lettre.
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PINLANE_PLANNING_LIENS_PORT || 5203);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const GJS = 'assets/pinlane-planning-global.js';
FX.APPAREILS.liens = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
let mutation = null;
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

async function ouvrir(browser, appareil = 'liens', fixture = 'pic', heure = '15:10') {
  const m = await FX.monter(browser, {
    fixture, appareil, theme: 'light', heure, port: PORT,
    avantChargement: async (p) => {
      await p.addInitScript(() => {
        window.__fixtureServeur = async (corps) => {
          const ancien = state.reservations.find((x) => String(x.id) === String(corps.id));
          return { statut: 200, json: { ok: true, reservation: Object.assign({}, ancien, corps, { updatedAt: new Date().toISOString() }) } };
        };
      });
    },
  });
  await m.page.evaluate(() => { renderStaff(); });
  await m.page.waitForSelector(fixture === 'vide' ? '.gf-bandeau' : '.gf-r', { timeout: 10000 });
  return m;
}
const idDe = (page, mot) => page.evaluate((m) => {
  const ligne = Array.from(document.querySelectorAll('.gf-r')).find((l) => l.querySelector('.gf-nom__t').textContent.includes(m));
  return ligne ? ligne.getAttribute('data-gf-id') : '';
}, mot);
const ouvert = (page) => page.evaluate(() => ({
  reserver: !document.getElementById('quickBookOverlay').classList.contains('hidden'),
  fiche: !document.getElementById('posOverlay').classList.contains('hidden'),
  type: typeof quickBookState !== 'undefined' && quickBookState ? quickBookState.type : '',
  heure: typeof quickBookState !== 'undefined' && quickBookState ? quickBookState.startTime : '',
  ficheDe: state.selectedRes ? String(state.selectedRes.id) : '',
}));
const fermer = (page) => page.evaluate(() => { closeQuickBook(); fermerFiche(); });
// (Réserver s ouvre au rendu de sa fenetre : on attend qu elle soit la, sans dormir)
const attendreReserver = (page) => page.waitForFunction(() => !document.getElementById('quickBookOverlay').classList.contains('hidden'), null, { timeout: 3000 }).catch(() => null);

async function scenarioHeure(browser) {
  const { ctx, page } = await ouvrir(browser);
  try {
    const cases = await page.evaluate(() => {
      const lire = (h) => { const c = document.querySelector(`td.gf-bloc[data-gf-bloc="${h}"]`); return c ? c.textContent : null; };
      const lanes = getStaffBowlingLanesFreeBetween(17, 18);
      const depart = lpModele().departs.find((d) => d.t === 17);
      return { dixSept: lire('17:00'), treize: lire('13:00'), libres: lanes.libres, places: depart ? depart.places : null, passee: Boolean(document.querySelector('td.gf-bloc[data-gf-bloc="13:00"][data-gf-reserver]')) };
    });
    ok(cases.dixSept && cases.dixSept.includes(`Pistes ${cases.libres}`), '[A] la case de 17:00 dit ses pistes libres', cases);
    ok(cases.dixSept && cases.dixSept.includes(`Laser ${cases.places}`), '[A] et les places de son depart laser', cases);
    ok(cases.treize && !/Pistes|Laser \d/.test(cases.treize) && !cases.passee, '[A] une demi-heure passee n offre plus rien', cases);
    ok(cases.dixSept && !/groupes?/.test(cases.dixSept), '[A] les groupes ne s y comptent plus : les lignes les montrent', cases.dixSept);

    await page.locator('td[data-gf-reserver="17:00"]').click();
    await attendreReserver(page);
    const dix = await ouvert(page);
    ok(dix.reserver && !dix.fiche, '[B] la case d heure ouvre Réserver, pas la fiche du premier groupe', dix);
    ok(dix.heure === '17:00', '[B] a son heure', dix.heure);
    await fermer(page);
    await page.locator('td.gf-bloc[data-gf-bloc="13:00"]').click();
    await page.waitForTimeout(200);
    const passe = await ouvert(page);
    ok(!passe.reserver && !passe.fiche, '[B] une demi-heure passee n ouvre rien', passe);
  } finally { await ctx.close(); }
}

async function scenarioBandeau(browser) {
  const { ctx, page } = await ouvrir(browser);
  try {
    await page.locator('[data-gf-etat="bowling"] .gf-e__h').click();
    await attendreReserver(page);
    const pistes = await ouvert(page);
    ok(pistes.reserver && pistes.type === 'bowling', '[C] « Pistes » ouvre Réserver, en bowling', pistes);
    await fermer(page);
    await page.locator('[data-gf-etat="laser"] .gf-e__l').click();
    await attendreReserver(page);
    const laser = await ouvert(page);
    ok(laser.reserver && laser.type === 'laser' && laser.heure, '[C] « Laser » ouvre Réserver sur son depart', laser);
    await fermer(page);
    const noms = await page.evaluate(() => Array.from(document.querySelectorAll('.gf-e__g')).map((b) => ({ t: b.textContent, id: b.getAttribute('data-gf-fiche'), attendu: b.classList.contains('is-attendu') })));
    ok(noms.some((n) => n.t.includes('Lina') && !n.attendu && !n.t.includes('pas là')), '[C] un groupe sur place se lit sans mot de plus', noms);
    const manon = noms.find((n) => n.t.includes('Manon'));
    ok(manon && manon.attendu && manon.t.includes('pas là'), '[C] qui n est pas encore la se lit', noms);
    await page.locator('.gf-e__g.is-attendu').first().click();
    await page.waitForTimeout(250);
    const fiche = await ouvert(page);
    ok(fiche.fiche && fiche.ficheDe === String(manon && manon.id), '[C] le nom ouvre sa fiche', fiche);
  } finally { await ctx.close(); }
}

async function scenarioRetard(browser) {
  const { ctx, page } = await ouvrir(browser);
  try {
    const zoe = await idDe(page, 'Zoé');
    await page.locator(`[data-gf-retarder="${zoe}"]`).click();
    const choix = await page.evaluate(() => Array.from(document.querySelectorAll('.staff-action-popover button')).map((b) => b.textContent.trim()));
    ok(choix.join('|') === '10 min|20 min|30 min', '[D] le retard ouvre 10, 20, 30 min', choix);
    await page.locator('.staff-action-popover button', { hasText: '20 min' }).click();
    await page.waitForTimeout(250);
    const plan = await page.evaluate(() => ({ minutes: delayFlowState && delayFlowState.delayMinutes, id: delayFlowState && delayFlowState.reservationId, bulle: Boolean(document.querySelector('.staff-action-popover')) }));
    ok(String(plan.id) === zoe && plan.minutes === 60, '[D] 20 min s ajoutent aux 40 deja pris', plan);
    ok(!plan.bulle, '[D] la bulle se ferme', plan);
  } finally { await ctx.close(); }
}

async function scenarioMontant(browser) {
  const { ctx, page } = await ouvrir(browser);
  try {
    const arthur = await idDe(page, 'Arthur');
    const bouton = page.locator(`[data-gf-encaisser="${arthur}"]`);
    ok(await bouton.count() === 1, '[E] un groupe sur place a son montant sur la ligne');
    await bouton.click();
    const choix = await page.evaluate(() => Array.from(document.querySelectorAll('.staff-action-popover button')).map((b) => b.textContent.trim()));
    ok(choix.includes('Carte') && choix.includes('Espèces'), '[E] le montant ouvre Carte et Espèces', choix);
    const avant = await ouvert(page);
    await page.locator('.staff-action-popover button', { hasText: 'Carte' }).click();
    await page.waitForFunction((id) => { const r = state.reservations.find((x) => String(x.id) === id); return r && r.status === 'paid'; }, arthur, { timeout: 5000 }).catch(() => null);
    const apres = await page.evaluate((id) => {
      const r = state.reservations.find((x) => String(x.id) === id);
      const l = document.querySelector(`.gf-r[data-gf-id="${id}"]`);
      return { statut: r && r.status, moyen: r && (r.paymentMethod || r.payment_method), classes: l ? l.className : '', texte: l ? l.querySelector('.gf-etat').textContent : '', fiche: !document.getElementById('posOverlay').classList.contains('hidden') };
    }, arthur);
    ok(apres.statut === 'paid' && !avant.fiche && !apres.fiche, '[E] le groupe paie depuis sa ligne, sans la fiche', apres);
    ok(/t-paid/.test(apres.classes) && apres.texte.includes('Payé'), '[E] sa ligne dit Payé', apres);
  } finally { await ctx.close(); }
}

async function scenarioPasVenu(browser) {
  const { ctx, page } = await ouvrir(browser);
  try {
    const [zoe, clara] = [await idDe(page, 'Zoé'), await idDe(page, 'Clara')];
    const lire = () => page.evaluate(([a, b]) => ({ zoe: Boolean(document.querySelector(`.gf-r[data-gf-id="${a}"] .gf-pv`)), clara: Boolean(document.querySelector(`.gf-r[data-gf-id="${b}"] .gf-pv`)) }), [zoe, clara]);
    const avant = await lire();
    ok(avant.zoe, '[F] a +40 min, « Pas venu » est sur la ligne', avant);
    ok(!avant.clara, '[F] a +10 min, il attend', avant);
    await page.evaluate((id) => {
      const r = state.reservations.find((x) => String(x.id) === id);
      r.opsPlan = Object.assign({}, r.opsPlan, { delayFlag: { minutes: 20, from: '14:30', to: '14:50' } });
      renderStaff();
    }, zoe);
    await page.waitForTimeout(150);
    ok(!(await lire()).zoe, '[F] un groupe qui a annonce son retard n est pas un groupe qui ne vient pas');
  } finally { await ctx.close(); }
}

async function scenarioPiste(browser) {
  const { ctx, page } = await ouvrir(browser);
  try {
    const clara = await idDe(page, 'Clara');
    await page.evaluate(() => { state.laneStatuses[6] = 'maintenance'; renderStaff(); });
    await page.waitForTimeout(150);
    const cellule = page.locator(`.gf-r[data-gf-id="${clara}"] .gf-x.is-panne`);
    ok(await cellule.count() === 1 && (await cellule.textContent()).includes('P6 fermée'), '[G] la piste fermee se lit sur la ligne du groupe', await page.evaluate((id) => document.querySelector(`.gf-r[data-gf-id="${id}"] .gf-a`) && document.querySelector(`.gf-r[data-gf-id="${id}"]`).textContent, clara));
    await cellule.click();
    await page.waitForTimeout(300);
    const vu = await page.evaluate((id) => ({ vue: state.staffResourceView, fiche: !document.getElementById('posOverlay').classList.contains('hidden'), bloc: Boolean(document.querySelector(`.booking[data-booking-res-id="${id}"]`)) }), clara);
    ok(vu.vue === 'bowling' && vu.bloc && !vu.fiche, '[G] un toucher mene a son bloc au planning bowling', vu);
  } finally { await ctx.close(); }
}

async function scenarioTelephone(browser) {
  const { ctx, page } = await ouvrir(browser, 'telephone');
  try {
    await page.waitForTimeout(400);
    const vu = await page.evaluate(() => {
      const now = document.querySelector('.gf-now');
      const b = now ? now.getBoundingClientRect() : null;
      return { y: b ? Math.round(b.top) : null, h: innerHeight };
    });
    ok(vu.y !== null && vu.y >= 0 && vu.y < vu.h, '[H] au telephone, la barre de l heure est a l ecran', vu);
  } finally { await ctx.close(); }
}

async function scenarioMenu(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser);
  try {
    await page.locator('.gf-outil--plus').click();
    const texte = await page.evaluate(() => (document.querySelector('.staff-action-popover') || {}).textContent || '');
    ok(texte && !texte.includes('Agrandir') && !texte.includes('Nouvelle réservation'), '[I] le menu ne redit pas ce qui est a cote de lui', texte);
    await page.evaluate(() => closeStaffFloatingMenus());
    const id = await idDe(page, 'Manon');
    const piege = '<img src=x onerror="window.__piege=1">Manon';
    await page.evaluate(([i, nom]) => { state.reservations.find((x) => String(x.id) === i).name = nom; renderStaff(); }, [id, piege]);
    await page.waitForTimeout(250);
    const fuite = await page.evaluate(() => ({ img: Boolean(document.querySelector('.gf-e__s img')), piege: window.__piege === 1 }));
    ok(!fuite.img && !fuite.piege, '[J] un nom ne sort pas de son texte', fuite);
    ok(erreurs.length === 0, '[J] aucune erreur JavaScript', erreurs.slice(0, 3));
  } finally { await ctx.close(); }
}

async function scenarioChiffres(browser) {
  for (const heure of ['15:10', '18:20']) await chiffresA(browser, heure);
}
async function chiffresA(browser, heure) {
  const { ctx, page } = await ouvrir(browser, 'liens', 'pic', heure);
  try {
    const auTableau = await page.evaluate(() => Number((document.querySelector('[data-gf-filtre="onsite"] .gf-c__v') || {}).textContent));
    await page.evaluate(() => openStaffMenuPage('dashboard'));
    await page.waitForSelector('.dash-now-cell[data-now="onsite"] .dash-now-value', { timeout: 8000 }).catch(() => null);
    const aLAccueil = await page.evaluate(() => {
      const valeur = document.querySelector('.dash-now-cell[data-now="onsite"] .dash-now-value');
      const m = valeur ? /^(\d+)\s*groupe/.exec(valeur.textContent.trim()) : null;
      return m ? Number(m[1]) : null;
    });
    ok(auTableau > 0 && aLAccueil === auTableau, `[K] a ${heure}, « Sur place » dit la meme chose au tableau et a l accueil`, { auTableau, aLAccueil });
    await page.evaluate(() => { openStaffMenuPage('planning'); openStaffPlanningResource('all'); setStaffStatusFilter('onsite'); });
    await page.waitForSelector('.gf-r', { timeout: 8000 });
    const lignes = await page.evaluate(() => document.querySelectorAll('.gf-r').length);
    ok(lignes === auTableau, `[K] a ${heure}, le compteur montre autant de lignes qu il en compte`, { lignes, auTableau });
  } finally { await ctx.close(); }
}

// (les pieces de chaque case, telles qu elles occupent l ecran)
const chiffresDuJour = (page, detail) => page.evaluate((long) => {
  const g = document.querySelector('#staffView .kpi-grid');
  if (long) g.querySelectorAll('.hint').forEach((h) => { h.textContent = long; });
  const bord = g.getBoundingClientRect();
  const pieces = Array.from(g.querySelectorAll('.label, .value, .hint')).filter((el) => el.getClientRects().length > 0).map((el) => { const r = el.getBoundingClientRect(); return { t: el.classList[0], g: r.left, d: r.right }; });
  const chevauche = pieces.reduce((pire, p, i) => (i ? Math.max(pire, pieces[i - 1].d - p.g) : pire), 0);
  return { chevauche: Math.round(chevauche), deborde: Math.round(Math.max(...pieces.map((p) => p.d)) - bord.right), details: pieces.filter((p) => p.t === 'hint').length, libelle: g.querySelector('.label').innerText };
}, detail);
async function scenarioChiffresDuJour(browser) {
  const { ctx, page } = await ouvrir(browser);
  try {
    const long = '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 et 12 · la 2 jusqu’à 23:30';
    const fautes = [];
    for (const vue of ['bowling', 'laser']) {
      await page.evaluate((v) => { openStaffPlanningResource(v); }, vue);
      await page.waitForSelector('#staffView .kpi-grid .kpi', { timeout: 5000 });
      for (const [l, h] of [[1000, 700], [1024, 768], [1100, 800], [1101, 800], [1180, 820], [1256, 800], [1257, 800], [1280, 720], [1366, 768], [1400, 900], [1401, 900], [1540, 900], [1541, 900], [1600, 900], [1920, 1080]]) {
        await page.setViewportSize({ width: l, height: h });
        for (const menu of [1, 2]) {
          for (const detail of [null, long]) {
            const r = await chiffresDuJour(page, detail);
            if (r.chevauche > 0 || r.deborde > 0) fautes.push({ vue, l, menu, detail: Boolean(detail), ...r });
          }
          await page.evaluate(async () => {
            const b = document.querySelector('[data-fgx-menu-collapse]');
            if (b) b.click();
            await new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin)));
            await Promise.all(document.getAnimations().filter((a) => a.effect.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null)));
          });
        }
      }
    }
    ok(fautes.length === 0, '[L] les chiffres des plannings ne se marchent pas dessus, de 1 000 a 1 920 px, menu ouvert ou replie', fautes.slice(0, 4));
    await page.setViewportSize({ width: 1366, height: 768 });
    const petit = await chiffresDuJour(page, null);
    ok(petit.libelle === 'Occupation' && petit.details === 0, '[L] a 1 366 px, le premier mot et le chiffre', petit);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const grand = await chiffresDuJour(page, null);
    ok(/^Occupation d/.test(grand.libelle) && grand.details > 0, '[L] a 1 920 px, le libelle entier et son detail', grand);
  } finally { await ctx.close(); }
}

// (ce que le tableau et la liste montrent pour ce qui est tape dans le champ)
const taper = async (page, texte) => {
  await page.fill('#globalPlanningSearchInput', texte);
  await page.waitForFunction((t) => state.searchTerm === t, texte, { timeout: 3000 }).catch(() => null);
  await page.waitForTimeout(300);
};
async function scenarioListe(browser) {
  const { ctx, page } = await ouvrir(browser);
  try {
    for (const texte of ['15:00', 'P3', '10 pers', 'Clara']) {
      await taper(page, texte);
      const r = await page.evaluate(() => {
        rendreLaListe();
        const tableau = Array.from(document.querySelectorAll('.gf-r')).map((l) => l.getAttribute('data-gf-id')).sort();
        const liste = Array.from(new Set(Array.from(document.querySelectorAll('#resList [data-res-row-id]')).map((l) => l.getAttribute('data-res-row-id')))).sort();
        return { tableau, liste, rien: Boolean(document.querySelector('#resList .empty-state')) };
      });
      ok(r.tableau.length > 0 && !r.rien && r.liste.join() === r.tableau.join(), `[M] « ${texte} » : la liste montre les memes groupes que le tableau`, r);
    }
  } finally { await ctx.close(); }
}
async function scenarioJourVide(browser) {
  const { ctx, page } = await ouvrir(browser, 'liens', 'vide');
  try {
    const avant = await page.evaluate(() => ({ vide: document.querySelector('.gf').classList.contains('is-vide'), bandeau: document.querySelector('.gf-bandeau').textContent }));
    ok(avant.vide && /Aucune réservation/.test(avant.bandeau), '[N] le montage : un jour sans groupe', avant);
    await taper(page, 'Dupont');
    const r = await page.evaluate(() => {
      const bouton = document.querySelector('.gf-rien__reserver');
      return { vu: Boolean(bouton && bouton.getClientRects().length), texte: bouton ? bouton.textContent : '', vide: document.querySelector('.gf').classList.contains('is-vide') };
    });
    ok(r.vu && r.texte === 'Réserver pour Dupont' && !r.vide, '[N] un nom tape sur un jour vide propose de reserver pour lui', r);
    await page.locator('.gf-rien__reserver').click();
    await attendreReserver(page);
    const o = await page.evaluate(() => ({ ouvert: !document.getElementById('quickBookOverlay').classList.contains('hidden'), nom: quickBookState && quickBookState.name }));
    ok(o.ouvert && o.nom === 'Dupont', '[N] et Réserver s ouvre avec son nom', o);
    await page.evaluate(() => closeQuickBook());
    await taper(page, '');
    const apres = await page.evaluate(() => document.querySelector('.gf').classList.contains('is-vide'));
    ok(apres, '[N] le champ vide, le jour redevient vide', apres);
  } finally { await ctx.close(); }
}

async function scenarioEntree(browser) {
  const { ctx, page } = await ouvrir(browser);
  try {
    const arrives = () => page.evaluate(() => state.reservations.filter((r) => r.status === 'arrived').length);
    const avant = await arrives();
    for (const texte of ['massen', '21:30', 'p8', '7 pers']) {
      await taper(page, texte);
      const lignes = await page.evaluate(() => document.querySelectorAll('.gf-r').length);
      await page.press('#globalPlanningSearchInput', 'Enter');
      await page.waitForTimeout(150);
      const dit = await page.evaluate(() => (document.querySelector('.gf-resultats') || {}).textContent || '');
      ok(lignes > 0 && (await arrives()) === avant && !/Entrée/.test(dit), `[O] « ${texte} » trouve une ligne, Entree ne pointe personne`, { lignes, dit });
    }
    await taper(page, 'Masson');
    await page.press('#globalPlanningSearchInput', 'Enter');
    await page.waitForFunction((n) => state.reservations.filter((r) => r.status === 'arrived').length === n, avant + 1, { timeout: 3000 }).catch(() => null);
    ok((await arrives()) === avant + 1, '[O] un nom juste, Entree pointe son groupe', await arrives());
  } finally { await ctx.close(); }
}

const SCENARIOS = { entree: scenarioEntree, liste: scenarioListe, jourVide: scenarioJourVide, chiffresDuJour: scenarioChiffresDuJour, heure: scenarioHeure, bandeau: scenarioBandeau, retard: scenarioRetard, montant: scenarioMontant, pasvenu: scenarioPasVenu, piste: scenarioPiste, telephone: scenarioTelephone, menu: scenarioMenu, chiffres: scenarioChiffres };
const MUTATIONS = [
  { nom: 'heure-sans-pistes', lettre: 'A', scenarios: ['heure'], editions: [{ fichier: GJS, de: "    if (place && place.pistes) lignes.push({ html: '<span>Pistes ' + place.pistes + '</span>', hauteur: 1 });\n", vers: '' }] },
  { nom: 'heure-sans-laser', lettre: 'A', scenarios: ['heure'], editions: [{ fichier: GJS, de: "    if (place && place.laser) lignes.push({ html: '<span>Laser ' + place.laser + '</span>', hauteur: 1 });\n", vers: '' }] },
  { nom: 'heure-passee-offre', lettre: 'A', scenarios: ['heure'], editions: [{ fichier: GJS, de: "    var ouvert = part.quand !== 'passe' && !(m.fenetre", vers: '    var ouvert = !(m.fenetre' }] },
  { nom: 'case-sourde', lettre: 'B', scenarios: ['heure'], editions: [{ fichier: GJS, de: "      if (reserver) { reserverAuComptoir({ startTime: reserver.getAttribute('data-gf-reserver') }); return; }\n", vers: '' }] },
  { nom: 'case-ouvre-la-fiche', lettre: 'B', scenarios: ['heure'], editions: [{ fichier: GJS, de: "      if (e.target.closest('td.gf-bloc')) return;\n", vers: '' }] },
  { nom: 'bandeau-sourd', lettre: 'C', scenarios: ['bandeau'], editions: [{ fichier: GJS, de: "      if (bandeau) { gfDepuisBandeau(wrap, bandeau.getAttribute('data-gf-etat')); return; }\n", vers: '' }] },
  { nom: 'laser-comme-bowling', lettre: 'C', scenarios: ['bandeau'], editions: [{ fichier: GJS, de: "    else if (cle === 'laser') openQuickBookForLaserSession(et.t, et.places);\n", vers: '' }] },
  { nom: 'absent-muet', lettre: 'C', scenarios: ['bandeau'], editions: [{ fichier: GJS, de: "(la ? '' : ' pas là')", vers: "''" }] },
  { nom: 'retard-remis-a-zero', lettre: 'D', scenarios: ['retard'], editions: [{ fichier: GJS, de: 'Math.min(240, deja + Number(n))', vers: 'Number(n)' }] },
  { nom: 'montant-sans-effet', lettre: 'E', scenarios: ['montant'], editions: [{ fichier: GJS, de: 'function (valeur, ev) { encaisserReservation(id, valeur, ev); gfApresEncaisser(); }', vers: 'function () {}' }] },
  { nom: 'pas-de-montant', lettre: 'E', scenarios: ['montant'], editions: [{ fichier: GJS, de: "      if (duIci) h += '<button type=\"button\" class=\"gf-du gf-du--b'", vers: "      if (false) h += '<button type=\"button\" class=\"gf-du gf-du--b'" }] },
  { nom: 'pas-venu-partout', lettre: 'F', scenarios: ['pasvenu'], editions: [{ fichier: GJS, de: 'gfMinutesDeRetard(g, m) >= GF_PAS_VENU_MIN', vers: 'gfMinutesDeRetard(g, m) >= 0' }] },
  { nom: 'retard-annonce-oublie', lettre: 'F', scenarios: ['pasvenu'], editions: [{ fichier: GJS, de: " && !(typeof getReservationDelayFlag === 'function' && getReservationDelayFlag(g.r))", vers: '' }] },
  { nom: 'piste-muette', lettre: 'G', scenarios: ['piste'], editions: [{ fichier: GJS, de: "if (fermees.length && etat !== 'fini') {", vers: 'if (false) {' }] },
  { nom: 'piste-sourde', lettre: 'G', scenarios: ['piste'], editions: [{ fichier: GJS, de: "      if (voir) { voirAuPlanning(Number(voir.closest('[data-gf-id]').getAttribute('data-gf-id')), voir.getAttribute('data-gf-voir'), e); return; }\n", vers: '' }] },
  { nom: 'telephone-en-haut', lettre: 'H', scenarios: ['telephone'], editions: [{ fichier: GJS, de: "      else if (wrap._gfRegle == null) { wrap._gfRegle = 0; cible.scrollIntoView({ block: 'start' }); }\n", vers: '' }] },
  { nom: 'entree-sur-la-faute', lettre: 'O', scenarios: ['entree'], editions: [{ fichier: GJS, de: 'var trouves = m && q ? m.groupes.filter(function (g) { return gfTrouveParNom(g, q); }) : [];', vers: 'var trouves = m ? gfRecherche(m, q) : [];' }] },
  { nom: 'entree-promise-a-tort', lettre: 'O', scenarios: ['entree'], editions: [{ fichier: GJS, de: ' && gfPeutArriver(lignes[0], m) && gfTrouveParNom(lignes[0], q);', vers: ' && gfPeutArriver(lignes[0], m);' }] },
  { nom: 'liste-par-son-nom-seul', lettre: 'M', scenarios: ['liste'], editions: [{ fichier: 'assets/app-main.js', de: "const trouves = view === 'all' && typeof gfIdsTrouves === 'function' ? gfIdsTrouves() : null;", vers: 'const trouves = null;' }] },
  { nom: 'jour-vide-sourd', lettre: 'N', scenarios: ['jourVide'], editions: [{ fichier: GJS, de: 'var aEcrire = Boolean(m.groupes.length || q);', vers: 'var aEcrire = Boolean(m.groupes.length);' }] },
  { nom: 'jour-vide-sans-reponse', lettre: 'N', scenarios: ['jourVide'], editions: [{ fichier: GJS, de: "if (!lignes.length && (m.groupes.length || q)) {", vers: 'if (!lignes.length && m.groupes.length) {' }] },
  { nom: 'trois-cases-partout', lettre: 'L', scenarios: ['chiffresDuJour'], editions: [{ fichier: 'assets/pinlane-staff.css', de: '.kpi-grid .kpi[data-kpi="reservations"]:not(:last-child) { display: none; }', vers: '.kpi-grid .kpi[data-kpi="reservations"]:not(:last-child) { display: flex; }' }] },
  { nom: 'libelles-entiers-partout', lettre: 'L', scenarios: ['chiffresDuJour'], editions: [{ fichier: 'assets/pinlane-staff.css', de: '.kpi-grid .kpi .kpi-suite { display: none; }', vers: '.kpi-grid .kpi .kpi-suite { display: inline; }' }] },
  { nom: 'detail-partout', lettre: 'L', scenarios: ['chiffresDuJour'], editions: [{ fichier: 'assets/pinlane-staff.css', de: '@media (min-width: 1000px) and (max-width: 1540px) {\n  #staffView.avec-onglets.avec-onglets .kpi-grid .kpi .hint { display: none; }', vers: '@media (min-width: 1000px) and (max-width: 1540px) {\n  #staffView.avec-onglets.avec-onglets .kpi-grid .kpi .hint { display: block; }' }] },
  { nom: 'paye-reste-sur-place', lettre: 'K', scenarios: ['chiffres'], editions: [{ fichier: GJS, de: "var parti = r.status === 'paid' && mo.etat === 'onsite' && maintenant != null && span.end <= maintenant;", vers: 'var parti = false;' }] },
  { nom: 'filtre-garde-les-partis', lettre: 'K', scenarios: ['chiffres'], editions: [{ fichier: GJS, de: "return filtre !== 'onsite' || !sortis.has(id);", vers: 'return true;' }] },
  { nom: 'nom-brut', lettre: 'J', scenarios: ['menu'], editions: [{ fichier: GJS, de: "gpEsc(gfCourt(g.r) + ' ' + (Number(e.joueurs) || Number(g.r.pax) || 0) + (la ? '' : ' pas là'))", vers: "(gfCourt(g.r) + ' ' + (Number(e.joueurs) || Number(g.r.pax) || 0) + (la ? '' : ' pas là'))" }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) await SCENARIOS[nom](browser);
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, Object.keys(SCENARIOS));
    } else {
      console.log('contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.PL_MUTATIONS || liste(process.env.PL_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.PL_BAVARD;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveurHttp.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nplanning-liens-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nplanning-liens-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

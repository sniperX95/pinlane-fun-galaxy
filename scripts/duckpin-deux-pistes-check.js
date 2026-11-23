// LE DUCKPIN A DEUX PISTES (2026-11-22, Ansar : « Duckpin possibilité de mettre 2 pistes »).
//
// Le duckpin deduisait ses pistes de ses seuls joueurs (6 par piste) : un groupe de 4 ne pouvait
// pas en avoir deux, alors que la config du centre en declare deux (Libramont : le socle
// ops-knowledge/activities.json, units 2 et capacityPerUnit 6, reglable dans Etablissement). Il a
// maintenant son « Pistes − N + », dans Reserver et dans Modifier, avec les regles du bowling :
// assez de pistes pour les joueurs (jamais sous le conseil), jamais plus que le centre n en a,
// chacune se paie, et la place se juge au vrai moteur, aux vraies durees.
//
// Ce gate joue la VRAIE console (scripts/planning-v3-fixtures.js, la journee « pic » du samedi
// 16 janvier 2027 a 15:10), le VRAI handler api/staff-reservations.js et le vrai moteur sur la
// base en memoire du banc (scripts/reserver-banc.js). Il lit toujours le DOSSIER EN BASE, jamais
// seulement l ecran.
//
//   [D1] RESERVER : 4 joueurs au duckpin, son compteur « Pistes » dit 1 (le conseil) ; « + » passe
//        a 2, le ticket dit « 2 pistes » et le prix de deux pistes (celui du serveur), « + »
//        s arrete aux pistes du centre ; la page du duckpin a la meme rangee ; « − » revient a 1 ;
//        a 8 joueurs, 2 pistes, ni moins ni plus. Créer : le dossier porte 2 pistes, le choix et
//        le prix de deux pistes.
//   [D2] LE PLANNING ET LA FICHE : un dossier a 2 pistes se lit « 2 pistes » dans la colonne
//        Duckpin de sa ligne, et « 2 pistes · 1h » dans sa fiche.
//   [D3] MODIFIER : le dossier a 2 pistes s ouvre a 2 ; « − » le ramene a 1, le prix suit ;
//        Enregistrer : la base porte 1 piste, sans choix ; « + » puis Enregistrer : 2 pistes, le
//        choix et le prix de deux pistes.
//   [D4] UNE SEULE PISTE LIBRE : un autre groupe tient une piste a 15:00. Reserver : 1 piste
//        passe, 2 pistes sont refusees sur le ticket et rien ne se cree ; le serveur refuse le
//        dossier (« Duckpin Bowling est complet sur ce créneau. ») ; Modifier le dit avant
//        d enregistrer.
//   [D5] LE SERVEUR : le canal staff lit le choix, le canal public non ; jamais sous le besoin,
//        jamais au-dela de la dotation (les tours decident) ; la base garde le choix ; le comptoir
//        (booking-core) compte comme le serveur, choix compris.
//   [D6] SUR UN TELEPHONE : la rangee du duckpin (joueurs, pistes, heure) tient dans l ecran ;
//        sans retour a la ligne, ses pistes poussaient l heure hors de l ecran.
//   [*]  Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en
// memoire, le disque n est jamais touche), et exige que chacune rougisse sa cible ;
// `--contre-preuves=nom,nom` en joue quelques-unes ; `--ancres` verifie que chaque ancre existe
// une seule fois. `--seul=D3` ne joue qu une lettre.
//
// Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const eclats = require('./gates-eclats.js');

delete process.env.RESEND_API_KEY;
delete process.env.POSTGRES_URL;
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fetchOrigine = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) throw new Error(`gate : appel sortant refuse vers ${u.slice(0, 80)}`);
  return fetchOrigine(url, init);
};

// La base en memoire et le faux 'pg' s installent au require.
const B = require('./reserver-banc.js');
const FX = require('./planning-v3-fixtures.js');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_DUCKPIN_PISTES_PORT || 7840);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.DUCKPIN_PISTES_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };

const APP = 'assets/app-main.js';
const PLANNING = 'assets/pinlane-planning-global.js';
const PROGRAMME = 'lib/visit-program.js';
const BASE = 'lib/database.js';
const GARDE = 'lib/reservation-ops.js';
const STYLE = 'assets/pinlane-staff.css';

// LA MUTATION : le code casse expres, une regle a la fois. `lettre` dit quel scenario la juge,
// `cible` le debut du libelle qui doit rougir, `serveur` une mutation du code du serveur.
const MUTATIONS = [
  { nom: 'compteur-absent', lettre: 'D1', cible: '[D1] Reserver : le duckpin a son compteur « Pistes »', fichier: APP, de: "    const pistes = compteurs && !enPlus(c.id) ? rsCompteurPistesDuckpinHtml(c.id) : '';", vers: "    const pistes = '';" },
  { nom: 'plafond-oublie', lettre: 'D1', cible: '[D1] « + » s arrete aux pistes du centre', fichier: APP, de: '  return { n: plan.units, conseillees: plan.needed, plafond: Math.max(plan.needed, dotation > 0 ? dotation : 50), tours: plan.tours, dotation };', vers: '  return { n: plan.units, conseillees: plan.needed, plafond: 50, tours: plan.tours, dotation };' },
  { nom: 'plancher-oublie', lettre: 'D1', cible: '[D1] 8 joueurs : 2 pistes, ni moins ni plus', fichier: APP, de: '  return { moins: p.n > p.conseillees ? pas(p.n - 1) :', vers: '  return { moins: p.n > 1 ? pas(p.n - 1) :' },
  { nom: 'choix-garde-a-l-ecran', lettre: 'D1', cible: '[D1] Créer : le dossier en base porte 2 pistes', fichier: APP, de: "  if (activite.resourceType === 'duckpin_lane' && pistesChoisiesQuick(activityId)) ligne.pistesChoisies = pistesChoisiesQuick(activityId);", vers: '' },
  { nom: 'compteur-deborde', lettre: 'D1', cible: '[D1] a 1366 x 768, Reserver tient sur un ecran', fichier: APP, de: "  return rsCompteurHtml('Pistes', p.n, moins, plus, `data-activite=", vers: "  return rsCompteurHtml('Pistes'.repeat(40), p.n, moins, plus, `data-activite=" },
  { nom: 'ticket-sans-pistes', lettre: 'D1', cible: '[D1] « + » passe a 2 pistes : le ticket le dit', fichier: APP, de: '  return [plage, pistes, suite].filter(Boolean).join(\', \');', vers: '  return [plage, suite].filter(Boolean).join(\', \');' },
  { nom: 'serveur-sourd', lettre: 'D5', cible: '[D5] le comptoir obtient 2 pistes pour 4 joueurs', serveur: true, fichier: PROGRAMME, de: '      const plan = activityUnitPlan(activity, players, { fallbackCapacity: DUCKPIN_FALLBACK_CAPACITY, requested: choisies });', vers: '      const plan = activityUnitPlan(activity, players, { fallbackCapacity: DUCKPIN_FALLBACK_CAPACITY });' },
  { nom: 'public-lu', lettre: 'D5', cible: '[D5] le canal public ne lit pas le choix', serveur: true, fichier: PROGRAMME, de: '      const choisies = staff === true ? Math.min(50,', vers: '      const choisies = true ? Math.min(50,' },
  { nom: 'base-oublieuse', lettre: 'D3', cible: '[D3] Modifier rouvre le dossier a 2 pistes', serveur: true, fichier: BASE, de: '    if (pistesChoisies > 0) out.pistesChoisies = Math.min(50, pistesChoisies);', vers: '' },
  { nom: 'modifier-sans-compteur', lettre: 'D3', cible: '[D3] Modifier rouvre le dossier a 2 pistes', fichier: APP, de: '      + pistesDuckpinEditionHtml(id, activite, reglages);', vers: "      + '';" },
  { nom: 'modifier-oublie-le-choix', lettre: 'D3', cible: '[D3] Modifier rouvre le dossier a 2 pistes', fichier: APP, de: '      if (Number(item.pistesChoisies) > 0) reglages.pistesChoisies = Math.trunc(Number(item.pistesChoisies));', vers: '' },
  { nom: 'prix-d-une-piste', lettre: 'D3', cible: '[D3] « + » : 2 pistes, le prix de deux pistes', fichier: APP, de: "      const plan = getActivityUnitPlan(activite, effectif, activite.resourceType === 'duckpin_lane' ? Math.trunc(Number(item.pistesChoisies) || 0) : 0);", vers: '      const plan = getActivityUnitPlan(activite, effectif);' },
  { nom: 'garde-aveugle', lettre: 'D4', cible: '[D4] le serveur refuse 2 pistes', serveur: true, fichier: GARDE, de: '  if (Number.isFinite(compte) && compte > 0) return Math.trunc(compte);', vers: '  if (Number.isFinite(compte) && compte > 0) return 1;' },
  { nom: 'planning-muet', lettre: 'D2', cible: '[D2] le planning dit « 2 pistes »', fichier: PLANNING, de: "        if (e.unites > 1) d = mots ? gfPluriel(e.unites, mots) : '×' + e.unites;", vers: "        if (false) d = mots ? gfPluriel(e.unites, mots) : '×' + e.unites;" },
  { nom: 'fiche-muette', lettre: 'D2', cible: '[D2] la fiche dit « 2 pistes · 1h »', fichier: APP, de: "  if (priceType === 'grid_bowling') return detailUnitesLigne(item, catalogue, reservation, Number(item.duration) || 1);", vers: "  if (priceType === 'grid_bowling') return formatDurationLabel(Number(item.duration) || 1);" },
  { nom: 'ouvre-recalcule', lettre: 'D7', cible: '[D7] le duckpin enregistre a 2 pistes, 2 tours de 1h s ouvre tel quel', fichier: APP, de: '    if (inchange) { item.units = Number(enregistre.units);', vers: '    if (false) { item.units = Number(enregistre.units);' },
  { nom: 'ne-recalcule-jamais', lettre: 'D7', cible: '[D7] l equipe change les joueurs du duckpin', fichier: APP, de: '    const inchange = Boolean(pistes && enregistre && Number(enregistre.units) > 0 && joueursEnregistres === Number(item.participants)', vers: '    const inchange = Boolean(pistes && enregistre && Number(enregistre.units) > 0' },
  { nom: 'rangee-qui-deborde', lettre: 'D6', cible: '[D6] sur un telephone, la rangee du duckpin tient dans l ecran', fichier: STYLE, de: '.qb-modal.rv.rs .rs-act-l { flex: none; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; max-width: 100%; }', vers: '.qb-modal.rv.rs .rs-act-l { flex: none; display: inline-flex; align-items: center; gap: 8px; }' },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

// LE JOUR DU SERVEUR : celui de la fixture, a son heure (getBusinessNowParts, la seule lecture de
// l heure du metier), quel que soit le jour ou le gate tourne.
const HORLOGE_SERVEUR = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}

const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
if (CASSE && !mutation) { console.error(`duckpin-deux-pistes-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
function verifierAncre(m) {
  return lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
}
if (mutation && verifierAncre(mutation) !== 1) {
  console.error(`duckpin-deux-pistes-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// LE MONTAGE
// ---------------------------------------------------------------------------
FX.APPAREILS.comptoir = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
const JOUR = '2027-01-16';
const HEURE = '15:10';
const DUCKPIN = 'duckpin_bowling';
const TEL = '0470 12 34 56';

function ligneDepuis(r) {
  return {
    id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: String(r.name).replace('DÉMO · ', ''), phone: r.phone || '', email: r.email || '',
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

function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

const serveur = B.monter({
  mutations: [HORLOGE_SERVEUR, ...(mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [])],
  session: B.sessionDuRole('direction', { nom: 'Accueil' }),
});

// LE PRIX DES PISTES, lu dans le code du centre (lib/booking-config.js, la grille par piste que le
// serveur applique au duckpin), jamais ecrit ici.
const { getBasePrice } = require(path.join(ROOT, 'lib/booking-config.js'));
const prixPistes = (pistes, joueurs = 4, heures = 1) => Number(getBasePrice('bowling', heures, pistes, joueurs, '', 'libramont', { bowlingConfig: null, dateStr: JOUR }));

// Un dossier du duckpin cree par le vrai handler, comme la fenetre l enverrait.
const corpsDuckpin = (nom, pax, heure, ligne = {}) => ({ centerId: 'libramont', date: JOUR, name: nom, phone: '0470111222', email: '', status: 'pending', type: 'visite', pax, startTime: heure, allowPastStart: true, program: [{ activityId: DUCKPIN, duration: 1, ...ligne }] });
async function creer(nom, pax, heure, ligne = {}) {
  const rep = await serveur.appeler('POST', '/api/staff-reservations', corpsDuckpin(nom, pax, heure, ligne));
  return { statut: rep.statut, message: rep.json.message || rep.json.error || '', reservation: rep.json.reservation || null };
}
const ligneDuckpin = (row) => {
  const prog = row && (typeof row.program === 'string' ? JSON.parse(row.program) : row.program);
  return ((prog && prog.items) || []).find((i) => i && i.activityId === DUCKPIN) || null;
};

// La console sur la journee « pic », les dossiers `semis` crees par le vrai handler avant
// l ouverture et poses dans la journee de la page ; `appareil` : le comptoir, sauf en D6.
async function ouvrirConsole(browser, semis = [], appareil = 'comptoir') {
  const fx = FX.lireFixture('pic');
  globalThis.__comptoirMaintenant = FX.instant(fx.staffState.date, HEURE).getTime();
  B.semer(fx.staffState.reservations.map(ligneDepuis));
  const poses = [];
  for (const s of semis) poses.push(await creer(s.nom, s.pax, s.heure, s.ligne));
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil, theme: 'light', port: PORT, heure: HEURE,
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => { const rep = await serveur.appeler('PATCH', '/api/staff-reservations', corps); journal.push({ m: 'PATCH', corps, statut: rep.statut, json: rep.json }); return rep; });
      await page.exposeFunction('__fixtureBlanc', async (corps) => serveur.appeler('POST', '/api/staff-reservations', corps));
      await page.exposeFunction('__vraiAppel', async (methode, url, corps) => { const rep = await serveur.appeler(methode, url, corps); journal.push({ m: methode, corps, statut: rep.statut, json: rep.json }); return rep; });
    },
  });
  const { ctx, page, erreurs } = m;
  page.setDefaultTimeout(8000);
  await page.evaluate((dossiers) => {
    const avant = window.fetch;
    window.fetch = async (input, init) => {
      init = init || {};
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
        const corps = init.body ? JSON.parse(init.body) : undefined;
        const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
        const j = rep.json || {};
        if (me === 'POST' && !(corps && corps.dryRun) && j.reservation) window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(j.reservation);
        return new Response(JSON.stringify(j), { status: rep.statut, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return avant(input, init);
    };
    const jour = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
    dossiers.forEach((d) => { jour.push({ ...d }); state.reservations.push({ ...d }); });
    if (dossiers.length) renderStaff();
  }, poses.map((p) => p.reservation).filter(Boolean));
  await page.waitForSelector('.gf-r', { timeout: 10000 });
  const avant = new Set([...B.base.reservations.keys()]);
  const finir = async (quoi) => {
    ok(erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  };
  return { ctx, page, erreurs, journal, avant, poses, finir };
}

// ---- Lire l ecran, lire la base -------------------------------------------
const nombreDe = (texte) => {
  const brut = String(texte || '').replace(/\s/g, '').replace(/[^\d,.-]/g, '').replace(',', '.');
  return brut ? Number(brut) : NaN;
};
// Le compteur « Pistes » d une portee : sa valeur, ses deux touches, et le texte autour.
const lireCompteur = (page, portee) => page.evaluate((sel) => {
  const boutons = [...document.querySelectorAll(`${sel} [data-pistes-duckpin]`)].filter((b) => b.getClientRects().length);
  if (boutons.length < 2) return null;
  const pas = boutons[0].closest('.rs-pas, .staff-stepper');
  const valeur = pas && (pas.querySelector('b') || pas.querySelector('.staff-stepper-value'));
  const autour = boutons[0].closest('.rs-cpt, .rs-rang, [data-pistes-edition]');
  return { n: Number(valeur ? valeur.textContent : NaN), moins: !boutons[0].disabled, plus: !boutons[1].disabled, texte: (autour ? autour.textContent : '').replace(/\s+/g, ' ').trim() };
}, portee);
const RANGEE = '.rs-act-l[data-act="duckpin_bowling"]';
const toucher = async (page, portee, rang) => {
  await page.locator(`${portee} [data-pistes-duckpin] >> nth=${rang}`).click();
  await page.waitForTimeout(150);
};
// La ligne du duckpin au ticket : son detail, son prix, son refus.
const lireTicket = (page) => page.evaluate(() => {
  const l = document.getElementById('rsL-a-duckpin_bowling');
  const total = document.getElementById('rvTotalPied');
  return {
    detail: l ? [...l.querySelectorAll('small')].map((s) => s.textContent).join(' | ').replace(/\s+/g, ' ') : '',
    prix: l && l.querySelector('em') ? l.querySelector('em').textContent.trim() : '',
    refus: ((document.getElementById('rvRefus') || {}).textContent || '').replace(/\s+/g, ' '),
    total: total ? total.textContent.trim() : '',
    pret: ((document.getElementById('rvCreer') || {}).dataset || {}).pret || '',
  };
});
// Le ticket tel que le serveur l a chiffre : la ligne dit `mot` et son prix vaut `prix`.
async function ticketQuiDit(page, mot, prix) {
  await page.waitForFunction(({ mot: m, prix: p }) => {
    const l = document.getElementById('rsL-a-duckpin_bowling');
    const b = document.getElementById('rvCreer');
    if (!l || !b || b.dataset.pret !== '1') return false;
    const em = l.querySelector('em');
    const n = Number(String(em ? em.textContent : '').replace(/\s/g, '').replace(/[^\d,.-]/g, '').replace(',', '.'));
    return l.textContent.includes(m) && n === p;
  }, { mot, prix }, { timeout: 8000 }).catch(() => null);
  return lireTicket(page);
}
async function nouveaux(page, avant, attendre = (lignes) => lignes.length > 0) {
  let lignes = [];
  for (let i = 0; i < 50; i += 1) {
    lignes = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
    if (attendre(lignes)) break;
    await page.waitForTimeout(100);
  }
  return lignes;
}
async function nombre(page, n) {
  await page.click(`#rsHaut [data-pax="${n}"]`);
  await page.waitForSelector(`#rsHaut [data-pax="${n}"].is-on`);
}
async function prendreDuckpin(page) {
  await page.click('#rsT-duckpin_bowling');
  await page.waitForSelector(`${RANGEE} [data-pistes-duckpin]`, { timeout: 8000 }).catch(() => null);
  await page.waitForSelector('#rsL-a-duckpin_bowling', { timeout: 8000 });
}

// ---------------------------------------------------------------------------
// [D1] RESERVER
// ---------------------------------------------------------------------------
async function scenarioD1(browser) {
  console.log('\n[D1] Reserver : « Pistes − N + » du duckpin');
  const m = await ouvrirConsole(browser);
  const { page } = m;
  const un = prixPistes(1);
  const deux = prixPistes(2);
  ok(Number.isFinite(un) && Number.isFinite(deux) && deux === 2 * un, 'MONTAGE le prix par piste se lit dans le code du centre', { un, deux });
  await page.evaluate(() => openQuickBook());
  await page.waitForSelector('#rsHaut [data-pax="8"]');
  // 8 joueurs : le conseil (2) est aussi le maximum du centre.
  await nombre(page, 8);
  await prendreDuckpin(page);
  const huit = await lireCompteur(page, RANGEE);
  ok(Boolean(huit) && huit.n === 2 && !huit.moins && !huit.plus, '[D1] 8 joueurs : 2 pistes, ni moins ni plus', huit);
  // 4 joueurs : 1 piste conseillee.
  await nombre(page, 4);
  await page.waitForTimeout(300);
  const c1 = await lireCompteur(page, RANGEE);
  const t1 = await ticketQuiDit(page, '1 piste', un);
  ok(Boolean(c1) && c1.n === 1 && !c1.moins && c1.plus && /Pistes/.test(c1.texte), '[D1] Reserver : le duckpin a son compteur « Pistes », 1 pour 4 joueurs, « + » ouvert', { c1, t1 });
  await toucher(page, RANGEE, 1);
  const c2 = await lireCompteur(page, RANGEE);
  const t2 = await ticketQuiDit(page, '2 pistes', deux);
  ok(Boolean(c2) && c2.n === 2 && t2.detail.includes('2 pistes') && nombreDe(t2.prix) === deux && nombreDe(t2.total) === deux && !t2.refus, '[D1] « + » passe a 2 pistes : le ticket le dit, au prix de deux pistes (le serveur)', { c2, t2, attendu: deux });
  ok(Boolean(c2) && c2.moins && !c2.plus, '[D1] « + » s arrete aux pistes du centre (2), « − » s ouvre', c2);
  // Le compteur de plus ne pousse rien hors de l ecran du comptoir (la mesure de comptoir-check [E]).
  const ecran = await page.evaluate(() => {
    const col = document.getElementById('rsCol');
    const r = col.getBoundingClientRect();
    const coupes = [...col.querySelectorAll('.rs-cpt')].filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).length;
    const dehors = [...col.querySelectorAll('.rs-cpt')].filter((e) => { const x = e.getBoundingClientRect(); return x.width && (x.left < r.left - 1 || x.right > r.right + 1); }).length;
    return { hauteur: col.scrollHeight - col.clientHeight, largeur: col.scrollWidth - col.clientWidth, coupes, dehors };
  });
  ok(ecran.hauteur <= 1 && ecran.largeur <= 1 && ecran.coupes === 0 && ecran.dehors === 0, '[D1] a 1366 x 768, Reserver tient sur un ecran avec le compteur des pistes', ecran);
  // La page du duckpin : la meme rangee, et le conseil a cote.
  await page.click('#rsL-a-duckpin_bowling');
  await page.waitForSelector('.rs-rang [data-pistes-duckpin]', { timeout: 5000 }).catch(() => null);
  const pageRang = await lireCompteur(page, '.rs-rang');
  ok(Boolean(pageRang) && pageRang.n === 2 && /^Pistes/.test(pageRang.texte) && pageRang.texte.includes('1 conseillée pour 4 joueurs'), '[D1] la page du duckpin a sa rangee « Pistes » et dit le conseil', pageRang);
  await toucher(page, '.rs-rang', 0);
  const t3 = await ticketQuiDit(page, '1 piste', un);
  const c3 = await lireCompteur(page, '.rs-rang');
  ok(Boolean(c3) && c3.n === 1 && !c3.moins && t3.detail.includes('1 piste') && nombreDe(t3.prix) === un, '[D1] « − » revient au conseil : 1 piste, le prix d une piste', { c3, t3, attendu: un });
  await toucher(page, '.rs-rang', 1);
  await ticketQuiDit(page, '2 pistes', deux);
  // Créer : le dossier.
  await page.fill('#qbPhone', TEL);
  await page.waitForFunction(() => { const b = document.getElementById('rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 8000 }).catch(() => null);
  await page.click('#rvCreer');
  const crees = await nouveaux(page, m.avant);
  const r = crees[0];
  const ligne = ligneDuckpin(r);
  ok(crees.length === 1 && Boolean(ligne) && ligne.units === 2 && ligne.pistesChoisies === 2 && Number(r.price) === deux && Number(ligne.price) === deux, '[D1] Créer : le dossier en base porte 2 pistes, le choix et le prix de deux pistes', { n: crees.length, ligne, prix: r && r.price, attendu: deux });
  await m.finir('D1');
}

// ---------------------------------------------------------------------------
// [D2] LE PLANNING ET LA FICHE
// ---------------------------------------------------------------------------
async function scenarioD2(browser) {
  console.log('\n[D2] le planning et la fiche disent les pistes prises');
  const m = await ouvrirConsole(browser, [{ nom: 'Famille Pistes', pax: 4, heure: '17:00', ligne: { pistesChoisies: 2 } }]);
  const { page, poses } = m;
  const pose = poses[0];
  const ligne = ligneDuckpin(pose.reservation);
  ok(pose.statut === 201 && Boolean(ligne) && ligne.units === 2, 'MONTAGE un dossier a 2 pistes a 17:00, cree par le vrai handler', { statut: pose.statut, message: pose.message, ligne });
  const caseDuckpin = await page.evaluate((nom) => {
    const r = [...document.querySelectorAll('.gf-r')].find((x) => x.textContent.includes(nom));
    const c = r ? r.querySelector('td.gf-a[data-gf-titre="Duckpin"]') : null;
    return c ? c.textContent.replace(/\s+/g, ' ').trim() : null;
  }, 'Famille Pistes');
  ok(Boolean(caseDuckpin) && caseDuckpin.includes('17:00') && caseDuckpin.includes('2 pistes'), '[D2] le planning dit « 2 pistes » dans la colonne Duckpin du groupe', caseDuckpin);
  await page.evaluate((id) => { closePos(); openPos(id); setTab('infos'); }, pose.reservation.id);
  await page.waitForTimeout(400);
  const fiche = await page.evaluate(() => ((document.getElementById('posOverlay') || {}).textContent || '').replace(/\s+/g, ' '));
  ok(/Duckpin Bowling\s*2 pistes · 1h/.test(fiche), '[D2] la fiche dit « 2 pistes · 1h »', fiche.slice(0, 400));
  await m.finir('D2');
}

// ---------------------------------------------------------------------------
// [D3] MODIFIER
// ---------------------------------------------------------------------------
const MODIF = '#posOverlay [data-pistes-edition="duckpin_bowling"]';
async function ouvrirModifier(page, id) {
  await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
  await page.waitForSelector('#posOverlay .es-save', { timeout: 8000 });
  await page.waitForTimeout(300);
}
const prixModifier = (page) => page.evaluate(() => Number((document.getElementById('editPriceInput') || {}).value));
const detailModifier = (page) => page.evaluate(() => ((document.querySelector('#posOverlay [data-edit-activity="duckpin_bowling"] .fm-act-detail') || {}).textContent || '').trim());
async function enregistrer(page, journal) {
  const avant = journal.length;
  await page.click('#posOverlay .es-save');
  const t = Date.now();
  while (journal.filter((j) => j.m === 'PATCH').length === journal.slice(0, avant).filter((j) => j.m === 'PATCH').length && Date.now() - t < 10000) await page.waitForTimeout(80);
  await page.waitForTimeout(400);
  return journal.slice(avant).filter((j) => j.m === 'PATCH');
}
async function scenarioD3(browser) {
  console.log('\n[D3] Modifier : « Pistes − N + » du duckpin');
  const m = await ouvrirConsole(browser, [{ nom: 'Famille Modif', pax: 4, heure: '17:00', ligne: { pistesChoisies: 2 } }]);
  const { page, poses, journal } = m;
  const id = poses[0].reservation && poses[0].reservation.id;
  const un = prixPistes(1);
  const deux = prixPistes(2);
  await ouvrirModifier(page, id);
  const c0 = await lireCompteur(page, MODIF);
  const p0 = await prixModifier(page);
  ok(Boolean(c0) && c0.n === 2 && c0.moins && !c0.plus && p0 === deux && c0.texte.includes('1 conseillée pour 4 joueurs'), '[D3] Modifier rouvre le dossier a 2 pistes, son compteur « Pistes » et son prix', { c0, p0, attendu: deux });
  await toucher(page, MODIF, 0);
  const c1 = await lireCompteur(page, MODIF);
  const p1 = await prixModifier(page);
  const d1 = await detailModifier(page);
  ok(Boolean(c1) && c1.n === 1 && !c1.moins && p1 === un && d1.includes('1 piste'), '[D3] « − » : 1 piste, le prix suit', { c1, p1, d1, attendu: un });
  const envoi1 = await enregistrer(page, journal);
  const ligne1 = ligneDuckpin(B.base.reservations.get(Number(id)));
  const row1 = B.base.reservations.get(Number(id));
  ok(envoi1.length >= 1 && envoi1[envoi1.length - 1].statut === 200 && Boolean(ligne1) && ligne1.units === 1 && !ligne1.pistesChoisies && Number(row1.price) === un, '[D3] Enregistrer : la base porte 1 piste, sans choix, au prix d une piste', { statut: envoi1.map((e) => e.statut), ligne1, prix: row1 && row1.price });
  await ouvrirModifier(page, id);
  await toucher(page, MODIF, 1);
  const c2 = await lireCompteur(page, MODIF);
  const p2 = await prixModifier(page);
  const d2 = await detailModifier(page);
  ok(Boolean(c2) && c2.n === 2 && p2 === deux && d2.includes('2 pistes'), '[D3] « + » : 2 pistes, le prix de deux pistes', { c2, p2, d2, attendu: deux });
  const envoi2 = await enregistrer(page, journal);
  const row2 = B.base.reservations.get(Number(id));
  const ligne2 = ligneDuckpin(row2);
  ok(envoi2.length >= 1 && envoi2[envoi2.length - 1].statut === 200 && Boolean(ligne2) && ligne2.units === 2 && ligne2.pistesChoisies === 2 && Number(row2.price) === deux, '[D3] « + » puis Enregistrer : la base porte 2 pistes, le choix et le prix', { statut: envoi2.map((e) => e.statut), ligne2, prix: row2 && row2.price });
  await m.finir('D3');
}

// ---------------------------------------------------------------------------
// [D4] UNE SEULE PISTE LIBRE
// ---------------------------------------------------------------------------
async function scenarioD4(browser) {
  console.log('\n[D4] une seule piste libre : deux pistes sont refusees');
  const m = await ouvrirConsole(browser, [
    { nom: 'Bloqueur 15h', pax: 4, heure: '15:00' },
    { nom: 'Bloqueur 18h', pax: 4, heure: '18:00' },
    { nom: 'Famille Refus', pax: 4, heure: '18:00' },
  ]);
  const { page, poses } = m;
  ok(poses.every((p) => p.statut === 201), 'MONTAGE trois dossiers d une piste (15:00, 18:00, 18:00)', poses.map((p) => `${p.statut} ${p.message}`));
  const un = prixPistes(1);
  const deux = prixPistes(2);
  await page.evaluate(() => openQuickBook());
  await page.waitForSelector('#rsHaut [data-pax="4"]');
  await nombre(page, 4);
  await prendreDuckpin(page);
  const t1 = await ticketQuiDit(page, '1 piste', un);
  ok(!t1.refus && t1.detail.startsWith('15:00') && t1.detail.includes('1 piste'), '[D4] une piste libre a 15:00 : 1 piste passe', t1);
  // L heure que la fenetre propose suit la place : a 15:00 les deux pistes ne tiennent pas, elle
  // va a 16:00, ou elles tiennent (le moteur, aux vraies durees).
  await toucher(page, RANGEE, 1);
  const t2 = await ticketQuiDit(page, '16:00 à 17:00, 2 pistes', deux);
  ok(!t2.refus && t2.detail.startsWith('16:00 à 17:00, 2 pistes') && nombreDe(t2.prix) === deux, '[D4] sans heure choisie, la fenetre va a 16:00, ou les 2 pistes tiennent', t2);
  // 15:00 choisie a la main, avec une piste, puis la deuxieme : le refus du serveur, sur le ticket.
  await toucher(page, RANGEE, 0);
  await page.click('#rsL-a-duckpin_bowling');
  await page.waitForSelector('[data-heure-l="15:00"]', { timeout: 5000 }).catch(() => null);
  await page.click('[data-heure-l="15:00"]');
  await ticketQuiDit(page, '15:00 à 16:00, 1 piste', un);
  await toucher(page, '.rs-rang', 1);
  await page.waitForFunction(() => /complet/.test((document.getElementById('rvRefus') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => null);
  const t3 = await lireTicket(page);
  ok(/Duckpin Bowling est complet sur ce créneau/.test(t3.refus), '[D4] Reserver : 15:00 choisie, 2 pistes quand une seule est libre, le ticket le refuse (le serveur)', t3);
  await page.click('#rvCreer');
  await page.waitForTimeout(1200);
  const crees = await nouveaux(page, m.avant, () => false);
  const aDeuxAQuinze = crees.filter((r) => String(r.start_time).slice(0, 5) === '15:00' && (ligneDuckpin(r) || {}).units === 2);
  ok(aDeuxAQuinze.length === 0, '[D4] Reserver : rien ne se cree a 15:00 avec 2 pistes', crees.map((r) => `${r.start_time} ${JSON.stringify(ligneDuckpin(r))}`));
  await page.evaluate(() => closeQuickBook());
  await page.waitForTimeout(300);
  // Le serveur, sous son verrou.
  const refuse = await creer('Deux pistes 15h', 4, '15:00', { pistesChoisies: 2 });
  const passe = await creer('Une piste 15h', 4, '15:00');
  ok(refuse.statut >= 400 && /Duckpin Bowling est complet sur ce créneau/.test(refuse.message) && passe.statut === 201, '[D4] le serveur refuse 2 pistes quand une seule est libre, et accepte 1 piste', { refuse: `${refuse.statut} ${refuse.message}`, passe: `${passe.statut} ${passe.message}` });
  // Modifier : la famille de 18:00 demande sa deuxieme piste, deja tenue.
  const famille = poses[2].reservation;
  await ouvrirModifier(page, famille.id);
  await toucher(page, MODIF, 1);
  await page.waitForFunction(() => /complet/.test((document.getElementById('editVerdict') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => null);
  const verdict = await page.evaluate(() => ((document.getElementById('editVerdict') || {}).textContent || '').replace(/\s+/g, ' ').trim());
  ok(/Duckpin Bowling est complet sur ce créneau/.test(verdict), '[D4] Modifier : 2 pistes quand une seule est libre, le verdict le dit avant d enregistrer', verdict);
  await m.finir('D4');
}

// ---------------------------------------------------------------------------
// [D5] LE SERVEUR
// ---------------------------------------------------------------------------
function chargerCoeur() {
  const source = fs.readFileSync(path.join(ROOT, 'assets/booking-core.js'), 'utf8');
  const bac = { window: {}, document: { addEventListener() {} }, console, fetch: () => Promise.resolve(), localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, setInterval, clearInterval };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(source, bac, { filename: 'booking-core.js' });
  return bac;
}
async function scenarioD5() {
  console.log('\n[D5] le serveur lit le choix du comptoir, et lui seul');
  globalThis.__comptoirMaintenant = FX.instant(JOUR, HEURE).getTime();
  const { normalizeProgram } = require(path.join(ROOT, PROGRAMME));
  const { activityUnitPlan, listCenterActivities } = require(path.join(ROOT, 'lib/activity-catalog.js'));
  const { normalizeReservationPayload } = require(path.join(ROOT, BASE));
  const duck = listCenterActivities('libramont').find((a) => a.id === DUCKPIN);
  ok(Boolean(duck) && Number(duck.units) === 2 && Number(duck.capacityPerUnit) === 6, 'MONTAGE le centre declare 2 pistes de 6 joueurs (le catalogue, pas le gate)', duck && { units: duck.units, capacityPerUnit: duck.capacityPerUnit });
  const ligne = (pax, extra, options) => normalizeProgram([{ activityId: DUCKPIN, duration: 1, ...extra }], { centerId: 'libramont', pax, dateStr: JOUR, ...options }).items[0];
  const staff4 = ligne(4, { pistesChoisies: 2 }, { staff: true });
  ok(staff4.units === 2 && staff4.laneCount === 2 && staff4.pistesChoisies === 2 && staff4.price === prixPistes(2), '[D5] le comptoir obtient 2 pistes pour 4 joueurs, chacune payee, comptees par la garde', staff4);
  const public4 = ligne(4, { pistesChoisies: 2 }, { publicBooking: true });
  ok(public4.units === 1 && public4.laneCount === 1 && !public4.pistesChoisies && public4.price === prixPistes(1), '[D5] le canal public ne lit pas le choix : 1 piste pour 4 joueurs', public4);
  const trois = ligne(4, { pistesChoisies: 3 }, { staff: true });
  ok(trois.units === 2 && trois.laneCount === 2, '[D5] jamais plus que les pistes du centre : 3 demandees, 2 donnees', trois);
  const treize = ligne(13, { pistesChoisies: 2 }, { staff: true });
  ok(treize.units === 3 && treize.laneCount === 2 && treize.sessions === 2, '[D5] jamais sous le besoin : 13 joueurs gardent 3 pistes en 2 tours', treize);
  const sansChoix = ligne(4, { units: 2 }, { staff: true });
  ok(sansChoix.units === 1, '[D5] des pistes relues (units) ne sont pas un choix : 1 piste pour 4 joueurs', sansChoix);
  // (la liste blanche de l ecriture, lib/database.js normalizeReservationProgram, par sa porte d entree)
  const ecrit = normalizeReservationPayload({ centerId: 'libramont', name: 'Essai', phone: '', date: JOUR, startTime: '17:00', duration: 1, pax: 4, program: { items: [staff4], price: staff4.price } });
  const garde = ecrit && ecrit.program && ecrit.program.items[0];
  ok(Boolean(garde) && garde.pistesChoisies === 2 && garde.units === 2, '[D5] la base garde le choix (la liste blanche de l ecriture)', garde);
  const coeur = chargerCoeur();
  const cle = (p) => JSON.stringify([p.units, p.atOnce, p.tours]);
  const ecarts = [];
  for (let pax = 1; pax <= 30; pax += 1) {
    for (let voulu = 0; voulu <= 4; voulu += 1) {
      const s = activityUnitPlan(duck, pax, { requested: voulu });
      const c = coeur.getActivityUnitPlan(duck, pax, voulu);
      if (cle(s) !== cle(c)) ecarts.push(`${pax}p/${voulu} : ${cle(s)} contre ${cle(c)}`);
    }
  }
  ok(ecarts.length === 0, '[D5] le comptoir (booking-core) compte les pistes comme le serveur, choix compris (30 groupes x 5 choix)', ecarts.slice(0, 3).join(' ; '));
}

// ---------------------------------------------------------------------------
// [D6] SUR UN TELEPHONE
// ---------------------------------------------------------------------------
async function scenarioD6(browser) {
  console.log('\n[D6] sur un telephone, la rangee du duckpin tient dans l ecran');
  const m = await ouvrirConsole(browser, [], 'telephone');
  const { page } = m;
  await page.evaluate(() => openQuickBook());
  await page.waitForSelector('#rsHaut [data-pax="4"]');
  await nombre(page, 4);
  // (sur un telephone, le ticket est replie sous le total : sa ligne existe sans se voir)
  await page.click('#rsT-duckpin_bowling');
  await page.waitForSelector(`${RANGEE} [data-pistes-duckpin]`, { timeout: 8000 });
  await toucher(page, RANGEE, 1);
  const ticket = await ticketQuiDit(page, '2 pistes', prixPistes(2));
  // Rien de la rangee ne sort de l ecran, l heure comprise, et rien ne defile de cote pour la voir.
  const mesure = await page.evaluate((sel) => {
    const rangee = document.querySelector(sel);
    if (!rangee) return null;
    const vue = document.documentElement.clientWidth;
    const dehors = [rangee, ...rangee.querySelectorAll('*')].filter((e) => { const x = e.getBoundingClientRect(); return x.width > 0 && (x.left < -1 || x.right > vue + 1); }).map((e) => String(e.className || e.tagName)).slice(0, 4);
    const heure = rangee.querySelector('.rs-ha-b');
    const h = heure ? heure.getBoundingClientRect() : null;
    const decales = [];
    for (let e = rangee.parentElement; e; e = e.parentElement) if (e.scrollLeft > 0) decales.push(String(e.id || e.className));
    return { vue, dehors, heure: h ? { gauche: Math.round(h.left), droite: Math.round(h.right) } : null, decales: decales.slice(0, 3), pistes: rangee.querySelectorAll('[data-pistes-duckpin]').length };
  }, RANGEE);
  ok(Boolean(mesure) && mesure.pistes === 2 && ticket.detail.includes('2 pistes') && mesure.dehors.length === 0 && Boolean(mesure.heure) && mesure.heure.gauche >= 0 && mesure.heure.droite <= mesure.vue + 1 && mesure.decales.length === 0,
    '[D6] sur un telephone, la rangee du duckpin tient dans l ecran : ses pistes et son heure se voient', { mesure, ticket: ticket.detail });
  await m.finir('D6');
}

// ---------------------------------------------------------------------------
// [D7] UN DOSSIER ENREGISTRE S OUVRE TEL QUEL (2026-11-23)
// Un duckpin enregistre a « 2 pistes, 2 tours de 1h » (sans choix du comptoir : units 2, sessions 2)
// s ouvrait dans Modifier au conseil du centre pour ses joueurs : getEditProgramItems reecrivait
// units et sessions des l ouverture. Ses pistes ne se recalculent que si l equipe change les
// joueurs du duckpin ou son choix de pistes.
// ---------------------------------------------------------------------------
async function scenarioD7(browser) {
  console.log('\n[D7] Modifier : un duckpin enregistre a 2 pistes, 2 tours s ouvre tel quel');
  const m = await ouvrirConsole(browser, [{ nom: 'Famille Enregistree', pax: 4, heure: '17:00' }]);
  const { page } = m;
  const id = m.poses[0].reservation && m.poses[0].reservation.id;
  await page.evaluate((i) => {
    const r = state.reservations.find((x) => String(x.id) === String(i));
    const l = r.program.items.find((x) => x.activityId === 'duckpin_bowling');
    Object.assign(l, { units: 2, sessions: 2, duration: 1 }); delete l.pistesChoisies;
  }, id);
  await ouvrirModifier(page, id);
  const detail = await detailModifier(page);
  const ligne = () => page.evaluate(() => { const l = getEditProgramItems().find((x) => x.activityId === 'duckpin_bowling'); return l && { units: l.units, sessions: l.sessions }; });
  const l0 = await ligne();
  ok(/2 pistes.*2 tours de 1h/.test(detail) && l0 && l0.units === 2 && l0.sessions === 2, '[D7] le duckpin enregistre a 2 pistes, 2 tours de 1h s ouvre tel quel', { detail, l0 });
  if (process.env.DUCKPIN_CAPTURE) await page.screenshot({ path: process.env.DUCKPIN_CAPTURE, clip: { x: 130, y: 10, width: 1098, height: 748 } });
  await page.evaluate(() => { state.editState.programmeEdite.othersOptions.duckpin_bowling.participants = 2; });
  const l1 = await ligne();
  ok(Boolean(l1) && l1.units === 1 && l1.sessions === 1, '[D7] l equipe change les joueurs du duckpin : ses pistes se recalculent', { l1 });
  await m.finir('D7');
}

// ---------------------------------------------------------------------------
const SCENARIOS = { D1: scenarioD1, D2: scenarioD2, D3: scenarioD3, D4: scenarioD4, D5: scenarioD5, D6: scenarioD6, D7: scenarioD7 };

function verifierLesAncres() {
  let mortes = 0;
  for (const m of [...MUTATIONS, HORLOGE_SERVEUR]) {
    const n = verifierAncre(m);
    if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom || m.fichier} trouvee ${n} fois : ${m.de.slice(0, 80)}`); }
  }
  MUTATIONS.filter((m, i) => MUTATIONS.findIndex((x) => x.nom === m.nom) !== i).forEach((m) => { mortes += 1; console.log(`FAIL  contre-preuve ${m.nom} nommee deux fois`); });
  console.log(`duckpin-deux-pistes-check --ancres : ${MUTATIONS.length + 1 - mortes}/${MUTATIONS.length + 1} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS;
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, DUCKPIN_PISTES_CASSE: m.nom, PINLANE_DUCKPIN_PISTES_PORT: String(PORT + 1 + fil) },
    timeout: 300000,
  }));
  let mordent = 0;
  liste.forEach((m, i) => {
    const sortie = `${runs[i].stdout || ''}${runs[i].stderr || ''}`;
    if (runs[i].status === 2) { console.log(`FAIL  contre-preuve ${m.nom} DESARMEE : ${sortie.trim().split('\n').pop()}`); return; }
    const rouges = sortie.split('\n').filter((l) => l.startsWith('FAIL'));
    if (rouges.some((l) => l.includes(m.cible))) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : « ${m.cible} » rougit`); return; }
    console.log(`FAIL  contre-preuve ${m.nom} : « ${m.cible} » reste vert (${rouges.length} autre(s) rouge(s) : ${rouges[0] ? rouges[0].slice(0, 140) : sortie.trim().split('\n').pop().slice(0, 160)})`);
  });
  console.log(`duckpin-deux-pistes-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const navigateur = seul.some((nom) => nom !== 'D5');
  const http = navigateur ? await FX.servir({ port: PORT, transformer }) : null;
  const browser = navigateur ? await chromium.launch({ executablePath: BROWSER_PATH, headless: true }) : null;
  try {
    for (const nom of seul) await SCENARIOS[nom](browser);
  } finally {
    if (browser) await browser.close();
    if (http) http.close();
  }
  console.log(`\nduckpin-deux-pistes-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('duckpin-deux-pistes-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

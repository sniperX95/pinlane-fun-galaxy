// LE LOT DROITS 2B A L ECRAN, SUR LA VRAIE CONSOLE (2026-11-03).
//
// La console demarre sur la journee « pic » de Fun Galaxy
// (scripts/planning-v3-fixtures.js) ; ce que ce lot ajoute parle au VRAI serveur
// du banc (scripts/reserver-banc.js : api/staff-reservations.js, api/ops.js,
// lib/database.js, le moteur, une table audit_log en memoire que le journal du
// banc remplit) : la page appelle, Node repond par les vrais handlers.
//   [S] Tarifs & formules, onglet « Sur mesure » : la carte du centre, la
//       fenetre qui la gere (un seul bouton plein, le focus dedans), une seance
//       de gerant enregistree pour de vrai, Echap qui previent avant de perdre.
//   [M] l en-tete de la fiche : « Modifié 15:10, Rachel : 4 → 6 joueurs »,
//       ecrit par le serveur, lu sans rien demander.
//   [H] l historique : ferme par defaut, lu a l ouverture, qui et quoi.
//   [C] Enregistrer avec le curseur encore dans un prix : le clic part, le
//       serveur ecrit, le focus revient ; [T] taper ne redessine pas le pied ;
//       [X] Echap previent avant de perdre une saisie.
//   [E] un role au niveau prix non : la phrase sous l encaisse, pas de pli
//       Historique (niveau historique non).
//   Chaque fois : rien sous 12 px, cibles de 32 px a la souris, Geist en chiffres
//   tabulaires, ni degrade ni verre fume, ni tiret cadratin ni demi-cadratin.
//
// PINLANE_PHOTOS_DIR=<dossier> : les photos a 1366 x 768 (sur-mesure-section,
// sur-mesure-fenetre, fiche-derniere-modif, fiche-historique).
// --contre-preuves : une regle retiree au texte servi (le disque n est jamais
// touche), sa lettre doit rougir.
//
// Lancement : node scripts/droits-2b-ui-check.js [--contre-preuves]
// (port : PINLANE_DROITS_2B_PORT, 5213 par defaut)
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const B = require('./reserver-banc.js');
const FX = require('./planning-v3-fixtures');

const ROOT = B.ROOT;
const PORT = Number(process.env.PINLANE_DROITS_2B_PORT || 5213);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PHOTOS = process.env.PINLANE_PHOTOS_DIR || '';
const JS = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const MODULE = 'assets/pinlane-sur-mesure-settings.js';
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
const NOEL = 1637; // bowling 16:30, piste 6, 4 joueurs

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
let mutation = null;
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// L heure de la journee de la fixture, cote serveur : 15:10 au premier appel,
// comme la page, puis elle avance (deux gestes gardent leur ordre).
const VraieDate = Date;
let ecart = null;
async function auJour(travail) {
  if (ecart === null) ecart = new VraieDate(FX.instant(JOUR, '15:10')).getTime() - VraieDate.now();
  class Fausse extends VraieDate {
    constructor(...a) { if (a.length === 0) super(VraieDate.now() + ecart); else super(...a); }
    static now() { return VraieDate.now() + ecart; }
  }
  global.Date = Fausse;
  try { return await travail(); } finally { global.Date = VraieDate; }
}

// ---------------------------------------------------------------------------
// LE SERVEUR : la table des centres et audit_log, sur la base du banc.
// ---------------------------------------------------------------------------
const TABLE = [];
let serie = 0;
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/\bfrom audit_log\b/.test(s) && s.startsWith('select ')) {
    const where = (/ where (.+?) order by /.exec(s) || [])[1] || '';
    const conditions = where ? where.split(' and ').map((c) => /^(\w+) = \$(\d+)$/.exec(c)).filter(Boolean) : [];
    const lignes = TABLE.filter((ligne) => conditions.every(([, col, n]) => String(ligne[col]) === String(params[Number(n) - 1]))).sort((a, b) => b.occurred_at - a.occurred_at || b.id - a.id);
    return { rows: JSON.parse(JSON.stringify(lignes), (k, v) => (k === 'occurred_at' ? new VraieDate(v) : v)), rowCount: lignes.length };
  }
  if (s === 'select settings from centers where id = $1 limit 1;') {
    const centre = B.base.centers.find((c) => c.id === params[0]);
    return centre ? { rows: [JSON.parse(JSON.stringify({ settings: centre.settings }))], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (s.startsWith('update centers set settings = jsonb_set(')) {
    const centre = B.base.centers.find((c) => c.id === params[0]);
    if (centre) centre.settings = { ...(centre.settings || {}), config: JSON.parse(params[1]) };
    return { rows: [], rowCount: centre ? 1 : 0 };
  }
  return queryDuBanc.call(this, sql, params);
};

function ligneDepuis(r) {
  return {
    id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: r.name, phone: r.phone || '', email: r.email || '',
    date: r.date, start_time: r.startTime, duration: r.duration, total_duration: r.totalDuration ?? r.duration, lanes: (r.lanes || []).map(Number),
    pax: r.pax, status: r.status, base_price: r.basePrice, price: r.price, type: r.type, formule_id: r.formuleId || null, label: r.label,
    occasion: r.occasion || '', extras: r.extras || [], payment_method: r.paymentMethod || null, notes: r.notes || '',
    ops_plan: r.opsPlan || null, risk_level: r.riskLevel || '', risk_score: r.riskScore ?? null, validation_status: r.validationStatus || 'confirmed',
    activity_progress: r.activityProgress || {}, program: r.program || null, companions: r.companions || 0,
    created_at: new VraieDate(r.createdAt), updated_at: new VraieDate(r.updatedAt),
  };
}

function monterServeur() {
  ecart = null;
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  B.base.centers = [{ id: 'libramont', name: 'Libramont', status: 'active', timezone: 'Europe/Brussels', settings: {} }];
  TABLE.length = 0;
  const m = B.monter({ session: B.sessionDuRole('direction', { nom: 'Rachel' }) });
  const pousser = m.journal.audits.push.bind(m.journal.audits);
  m.journal.audits.push = (e) => {
    serie += 1;
    TABLE.push({ id: serie, center_id: e.centerId || 'libramont', occurred_at: new Date(), actor_kind: e.actorKind || 'system', actor_member_id: e.actorMemberId || null, actor_label: e.actorLabel || '', actor_role_id: e.actorRoleId || null, surface: e.surface || '', action: e.action || '', method: e.method || '', entity_type: e.entityType || '', entity_id: e.entityId == null ? '' : String(e.entityId), outcome: e.outcome || 'success', denied_reason: null, changes: JSON.parse(JSON.stringify(e.changes || {})), context: JSON.parse(JSON.stringify(e.context || {})), request_id: '' });
    return pousser(e);
  };
  const audit = require(path.join(ROOT, 'lib/audit-log.js'));
  audit.writeAuditLogOrThrow = async () => ({ ok: true });
  const ops = require(path.join(ROOT, 'api/ops.js'));
  m.appels = [];
  m.vrai = async (methode, url, corps) => {
    m.appels.push(`${methode} ${url}`);
    const handler = url.startsWith('/api/ops') ? ops : m.handler;
    return auJour(() => B.appeler(handler, methode, url, corps));
  };
  return m;
}

// Les appels de ce lot partent au vrai serveur ; le reste reste a la fixture.
function brancherLaPage() {
  const avant = window.fetch;
  window.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
    const m = String(init.method || 'GET').toUpperCase();
    const corps = init.body ? JSON.parse(init.body) : undefined;
    const vrai = (u.pathname === '/api/ops' && (u.searchParams.get('action') === 'surMesureGestion' || (m === 'POST' && corps && corps.action === 'saveSurMesure')))
      || (u.pathname === '/api/staff-reservations' && m === 'GET' && u.searchParams.has('historique'));
    if (!vrai) return avant(input, init);
    const rep = await window.__vraiServeur(m, u.pathname + u.search, corps);
    return new Response(JSON.stringify(rep.json), { status: rep.statut, headers: { 'content-type': 'application/json; charset=utf-8' } });
  };
}

// ---------------------------------------------------------------------------
// DANS LA PAGE : la mesure d une zone (textes, cibles, police, fonds).
// ---------------------------------------------------------------------------
function mesurer(selecteur) {
  const racine = document.querySelector(selecteur);
  if (!racine) return null;
  const vu = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const textes = [];
  const marche = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
  for (let n = marche.nextNode(); n; n = marche.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || el.closest('.visually-hidden, details:not([open]) > :not(summary), option')) continue;
    if (!vu(el)) continue;
    textes.push({ t: n.textContent.trim().slice(0, 40), px: parseFloat(getComputedStyle(el).fontSize), police: getComputedStyle(el).fontFamily });
  }
  const cibles = Array.from(racine.querySelectorAll('button, summary, input, select, a[href]')).map((el) => (el.type === 'checkbox' ? el.closest('label') || el : el))
    .filter((el) => vu(el) && !el.disabled)
    .map((el) => { const b = el.getBoundingClientRect(); return { t: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('data-sm-cle') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 30), h: Math.round(b.height), l: Math.round(b.width) }; });
  const fonds = Array.from(racine.querySelectorAll('*')).concat([racine]).filter(vu).map((el) => { const s = getComputedStyle(el); return { c: el.className && String(el.className).slice(0, 40), image: s.backgroundImage, flou: s.backdropFilter }; })
    .filter((f) => /gradient/.test(f.image) || (f.flou && f.flou !== 'none'));
  const pleins = Array.from(racine.querySelectorAll('.primary, .is-primary')).filter(vu).length;
  const texte = racine.textContent.replace(/\s+/g, ' ').trim();
  return { textes, cibles, fonds, pleins, texte };
}
function regles(lettre, zone, mesure, { pleinsMax = 1 } = {}) {
  if (!ok(Boolean(mesure), `[${lettre}] ${zone} : la zone existe`)) return;
  const petits = mesure.textes.filter((t) => t.px < 12);
  ok(!petits.length, `[${lettre}] ${zone} : rien sous 12 px`, petits.slice(0, 4));
  const etroites = mesure.cibles.filter((c) => c.h < 32);
  ok(!etroites.length, `[${lettre}] ${zone} : chaque cible fait 32 px de haut a la souris`, etroites.slice(0, 4));
  ok(!mesure.fonds.length, `[${lettre}] ${zone} : ni degrade ni verre fumé`, mesure.fonds.slice(0, 3));
  ok(mesure.pleins <= pleinsMax, `[${lettre}] ${zone} : ${pleinsMax ? 'un seul bouton plein' : 'aucun bouton plein'}`, mesure.pleins);
  ok(!/[\u2013\u2014]/.test(mesure.texte), `[${lettre}] ${zone} : ni tiret cadratin ni demi-cadratin`, (mesure.texte.match(/.{0,20}[\u2013\u2014].{0,20}/) || [])[0]);
  const sansGeist = mesure.textes.filter((t) => !/Geist/i.test(t.police));
  ok(!sansGeist.length, `[${lettre}] ${zone} : la police de la console (Geist)`, sansGeist.slice(0, 3));
}

async function photo(page, nom) {
  if (!PHOTOS || mutation) return;
  fs.mkdirSync(PHOTOS, { recursive: true });
  await FX_repos(page);
  await page.screenshot({ path: path.join(PHOTOS, `${nom}.png`) });
}
async function FX_repos(page) {
  await page.waitForTimeout(250);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
}

// ---------------------------------------------------------------------------
// LE SCENARIO.
// ---------------------------------------------------------------------------
async function scenario(browser) {
  const serveur = monterServeur();
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil: 'portable', theme: 'dark', port: PORT, heure: '15:10',
    avantChargement: async (p) => { await p.exposeFunction('__vraiServeur', (methode, url, corps) => serveur.vrai(methode, url, corps)); },
  });
  try {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.evaluate(brancherLaPage);

    // Deux modifications, par deux postes, ecrites par le vrai serveur.
    const noel = JSON.parse(JSON.stringify(FIXTURE.staffState.reservations.find((r) => r.id === NOEL)));
    const corps = (r, champs) => ({ ...r, centerId: 'libramont', requiresLanes: true, laneCount: (r.lanes || []).length, allowPastStart: true, baseUpdatedAt: r.updatedAt, ...champs });
    serveur.changerSession(B.sessionDuRole('manager', { nom: 'Julie' }));
    const heure = await auJour(() => serveur.appeler('PATCH', '/api/staff-reservations', corps(noel, { startTime: '17:00' })));
    serveur.changerSession(B.sessionDuRole('direction', { nom: 'Rachel' }));
    const joueurs = heure.json.reservation ? await auJour(() => serveur.appeler('PATCH', '/api/staff-reservations', corps(heure.json.reservation, { pax: 6 }))) : heure;
    ok(heure.statut === 200 && joueurs.statut === 200 && joueurs.json.reservation.opsPlan.derniereModif, '[M] MONTAGE deux modifications ecrites par le serveur (Julie : l heure, Rachel : les joueurs)', { heure: `${heure.statut} ${heure.json.message || ''}`, joueurs: `${joueurs.statut} ${joueurs.json.message || ''}` });
    // Ce que le releve suivant apporterait : le dossier tel que le serveur l a ecrit.
    await page.evaluate((r) => {
      const fx = window.__FIXTURE__;
      const liste = fx.jours[fx.jour];
      liste[liste.findIndex((x) => x.id === r.id)] = r;
      state.reservations = liste.map((x) => ({ ...x }));
      renderStaff();
    }, joueurs.json.reservation);

    // [M] L EN-TETE DE LA FICHE.
    await page.evaluate((id) => openPos(id), NOEL);
    await page.waitForSelector('#posOverlay .fx-modal', { timeout: 10000 });
    await FX_repos(page);
    const modif = await page.evaluate(() => { const el = document.querySelector('#posOverlay [data-fx-modif]'); if (!el) return null; const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return { t: el.textContent.trim(), haut: Math.round(b.top), nums: s.fontVariantNumeric, faits: Boolean(el.previousElementSibling && el.previousElementSibling.classList.contains('dossier-facts')) }; });
    ok(modif && modif.t === 'Modifié 15:10, Rachel : 4 → 6 joueurs', '[M] l en-tete dit « Modifié 15:10, Rachel : 4 → 6 joueurs »', modif);
    ok(modif && modif.faits && modif.haut < 300 && /tabular-nums/.test(modif.nums), '[M] sous les faits du dossier, en haut de la fiche, chiffres tabulaires', modif);
    regles('M', 'la ligne de modification', await page.evaluate(mesurer, '#posOverlay [data-fx-modif]'), { pleinsMax: 0 });
    await photo(page, 'fiche-derniere-modif');

    // [H] L HISTORIQUE.
    const pli = await page.evaluate((id) => { const d = document.querySelector(`#posOverlay [data-fx-histo="${id}"]`); return d ? { ouvert: d.open, corps: d.querySelector('.fx-histo-corps').innerHTML.trim() } : null; }, NOEL);
    const lusAvant = serveur.appels.filter((a) => a.includes('historique=')).length;
    ok(pli && !pli.ouvert && !pli.corps && lusAvant === 0, '[H] le pli Historique est ferme, rien n est lu avant de l ouvrir', { pli, lusAvant });
    await page.locator(`#posOverlay [data-fx-histo="${NOEL}"] > summary`).scrollIntoViewIfNeeded();
    await page.locator(`#posOverlay [data-fx-histo="${NOEL}"] > summary`).click();
    await page.waitForSelector(`#posOverlay [data-fx-histo="${NOEL}"] .fx-histo-entree`, { timeout: 10000 }).catch(() => null);
    await FX_repos(page);
    const histo = await page.evaluate((id) => Array.from(document.querySelectorAll(`#posOverlay [data-fx-histo="${id}"] .fx-histo-entree`)).map((li) => ({ par: li.querySelector('.fx-histo-meta span').textContent.trim(), quand: li.querySelector('time').textContent.trim(), quoi: Array.from(li.querySelectorAll('.fx-histo-quoi li')).map((x) => x.textContent.trim()) })), NOEL);
    const lus = serveur.appels.filter((a) => a.includes('historique='));
    ok(histo.length === 2 && histo[0].par === 'Rachel' && histo[0].quoi[0] === '4 → 6 joueurs' && histo[1].par === 'Julie' && histo[1].quoi[0] === 'Heure 16:30 → 17:00',
      '[H] ouvert : Rachel « 4 → 6 joueurs », puis Julie « Heure 16:30 → 17:00 », du plus recent au plus ancien', histo);
    ok(lus.length === 1 && lus[0] === `GET /api/staff-reservations?historique=${NOEL}&centerId=libramont`, '[H] une lecture, au vrai serveur, pour ce dossier dans son centre', lus);
    ok(histo.every((e) => /^\d{2}:\d{2}$|aujourd|à l’instant|\d/.test(e.quand)), '[H] chaque entree dit quand', histo.map((e) => e.quand));
    await page.evaluate(() => renderStaff());
    await FX_repos(page);
    const apresReleve = await page.evaluate((id) => { const d = document.querySelector(`#posOverlay [data-fx-histo="${id}"]`); return d ? { ouvert: d.open, n: d.querySelectorAll('.fx-histo-entree').length } : null; }, NOEL);
    ok(apresReleve && apresReleve.ouvert && apresReleve.n === 2 && serveur.appels.filter((a) => a.includes('historique=')).length === 1, '[H] un releve redessine la fiche : le pli reste ouvert, rien n est relu', apresReleve);
    regles('H', 'le pli Historique', await page.evaluate(mesurer, `#posOverlay [data-fx-histo="${NOEL}"]`), { pleinsMax: 0 });
    await page.evaluate((id) => document.querySelector(`#posOverlay [data-fx-histo="${id}"]`).scrollIntoView({ block: 'center' }), NOEL);
    await photo(page, 'fiche-historique');

    // [E] UN ROLE AU NIVEAU PRIX NON : la phrase sous l encaisse, pas d historique.
    const encaisse = await page.evaluate((id) => {
      const garde = state.staffAuthSession;
      const base = normalizeStaffSession(state.staffAuthSession) || readStoredStaffSession();
      state.staffAuthSession = { ...base, role: { id: 'staff-bar', name: 'Staff bar', locked: false }, permissions: ['dashboard.view', 'planning.view', 'reservations.view', 'reservations.status', 'payments.view', 'payments.markPaid', 'niveau:prix:non', 'niveau:historique:non'] };
      const r = state.reservations.find((x) => x.id === id);
      Object.assign(r, { status: 'paid', paymentMethod: 'Carte', amountPaid: null, discountReason: '' });
      closePos();
      openPos(id);
      const plis = document.querySelectorAll('#posOverlay .pos-encaisse-corriger');
      plis.forEach((d) => { d.open = true; });
      const note = document.querySelector('#posOverlay .pos-encaisse-note');
      const sortie = { note: note ? note.textContent.trim() : null, vu: Boolean(note && note.getBoundingClientRect().height > 0), px: note ? parseFloat(getComputedStyle(note).fontSize) : 0, histo: Boolean(document.querySelector('#posOverlay [data-fx-histo]')) };
      state.staffAuthSession = garde;
      closePos();
      return sortie;
    }, NOEL);
    ok(encaisse.vu && /droit d’ajuster un prix/.test(encaisse.note || '') && encaisse.px >= 12, '[E] Staff bar : la fiche dit, sous l encaisse, qu encaisser moins demande le droit d ajuster un prix', encaisse);
    ok(!encaisse.histo, '[E] Staff bar (historique non) : pas de pli Historique', encaisse);

    // [S] TARIFS & FORMULES, ONGLET SUR MESURE.
    await page.evaluate(() => { openStaffMenuPage('prices'); });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.pv2-seg button')).some((b) => /Sur mesure/.test(b.textContent)), null, { timeout: 10000 });
    await page.evaluate(() => { pv2PricingFilter('surmesure'); });
    await page.waitForSelector('#smSection', { timeout: 10000 }).catch(() => null);
    await FX_repos(page);
    const vue = await page.evaluate(() => {
      const onglet = Array.from(document.querySelectorAll('.pv2-seg button')).find((b) => /Sur mesure/.test(b.textContent));
      const section = document.getElementById('smSection');
      return {
        onglet: onglet ? onglet.textContent.replace(/\s+/g, ' ').trim() : '', actif: Boolean(onglet && onglet.classList.contains('active')),
        cats: section ? section.querySelectorAll('.sm-cat').length : 0, tete: section ? section.querySelector('.pv2-section-head span').textContent : '',
        tri: Boolean(document.querySelector('.pv2-quicksorts')), prix: section ? getComputedStyle(section.querySelector('.sm-prix')).fontVariantNumeric : '',
        noms: section ? Array.from(section.querySelectorAll('.sm-cat-tete strong')).filter((el) => el.getBoundingClientRect().height > 0).map((el) => el.textContent.trim()) : [],
      };
    });
    ok(vue.noms.length === vue.cats && vue.noms[0] === 'Nourriture', '[S] chaque carte dit le nom de sa categorie, a l ecran', vue.noms);
    const lectures = serveur.appels.filter((a) => a.includes('surMesureGestion'));
    ok(vue.onglet === 'Sur mesure91' && vue.actif && vue.cats >= 4 && /^91 articles · \d+ catégories/.test(vue.tete) && !vue.tri, '[S] l onglet « Sur mesure » : la carte de Libramont, 91 articles, sans le classement des offres', vue);
    ok(lectures.length === 1 && lectures[0] === 'GET /api/ops?action=surMesureGestion&centerId=libramont' && /tabular-nums/.test(vue.prix), '[S] une lecture au vrai serveur, les prix en chiffres tabulaires', { lectures, prix: vue.prix });
    regles('S', 'la section Sur mesure', await page.evaluate(mesurer, '#smSection'), { pleinsMax: 0 });
    // (les onglets au-dessus de la section, dans la photo)
    await page.evaluate(() => { document.querySelector('.pv2-seg').scrollIntoView({ block: 'start' }); window.scrollBy(0, -12); });
    await photo(page, 'sur-mesure-section');

    // La fenetre.
    await page.locator('[data-sm-action="ouvrir"]').click();
    await page.waitForSelector('#smOverlay .sm-modal', { timeout: 5000 });
    await FX_repos(page);
    const fenetre = await page.evaluate(() => ({ focusDedans: Boolean(document.activeElement && document.activeElement.closest('#smOverlay')), role: document.querySelector('#smOverlay [role="dialog"]').getAttribute('aria-modal'), titre: document.getElementById('smTitre').textContent, pied: document.querySelector('#smOverlay .sm-pied').textContent.replace(/\s+/g, ' ').trim() }));
    ok(fenetre.focusDedans && fenetre.role === 'true' && fenetre.titre === 'Catalogue sur mesure' && /Aucune modification\. Annuler Enregistrer/.test(fenetre.pied), '[S] la fenetre : un dialogue modal, le focus dedans, « Aucune modification »', fenetre);
    regles('S', 'la fenetre du catalogue', await page.evaluate(mesurer, '#smOverlay .sm-modal'), { pleinsMax: 1 });
    await photo(page, 'sur-mesure-fenetre');

    // Une seance de gerant : un prix, un article neuf, Enregistrer.
    const premierNom = await page.locator('#smOverlay [data-sm-art] [data-sm-cle="nom"]').first().inputValue();
    const premierPrix = page.locator('#smOverlay [data-sm-art] [data-sm-cle="prix"]').first();
    await premierPrix.fill('9,50');
    await page.locator('#smOverlay [data-sm-action="art-ajouter"]').first().click();
    await page.evaluate(() => {
      window.__piedRedessine = 0;
      new MutationObserver((liste) => { window.__piedRedessine += liste.filter((x) => x.type === 'childList').length; }).observe(document.querySelector('#smOverlay .sm-pied'), { childList: true });
    });
    await page.keyboard.type('Brownie maison');
    const redessins = await page.evaluate(() => window.__piedRedessine);
    ok(redessins === 0, '[T] taper un nom ne redessine pas le pied a chaque lettre', redessins);
    const prixNeuf = await page.evaluate(() => { const el = document.activeElement; const ligne = el && el.closest('[data-sm-art]'); return ligne ? ligne.getAttribute('data-sm-art') : ''; });
    await page.locator(`#smOverlay [data-sm-art="${prixNeuf}"] [data-sm-cle="unite"]`).selectOption('joueur');
    await page.locator(`#smOverlay [data-sm-art="${prixNeuf}"] [data-sm-cle="prix"]`).fill('3,5');
    const pied = await page.evaluate(() => document.querySelector('#smOverlay .sm-pied-note').textContent);
    ok(/Modifications non enregistrées/.test(pied), '[S] le pied dit qu il y a des modifications', pied);
    // Le curseur reste dans le prix tape : le clic sur « Enregistrer » fait
    // partir son « change » a l appui (le clic perdu, 2026-11-03).
    const focusAvant = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-sm-cle'));
    ok(focusAvant === 'prix', '[C] MONTAGE le curseur est encore dans le prix tape quand on clique « Enregistrer »', focusAvant);
    await page.locator('#smOverlay [data-sm-action="enregistrer"]').click();
    await page.waitForFunction(() => !document.getElementById('smOverlay'), null, { timeout: 10000 }).catch(() => null);
    await FX_repos(page);
    const apres = await page.evaluate(() => ({ ferme: !document.getElementById('smOverlay'), erreur: (document.querySelector('#smOverlay .sm-erreur') || {}).textContent || '', toast: (document.getElementById('toast') || {}).textContent || '', tete: (document.querySelector('#smSection .pv2-section-head span') || {}).textContent || '', focus: document.activeElement && document.activeElement.getAttribute('data-sm-action') }));
    apres.appels = serveur.appels.slice(-2);
    const ecrit = ((B.base.centers[0].settings.config || {}).surMesure || { articles: [] }).articles;
    const brownie = ecrit.find((a) => a.nom === 'Brownie maison');
    ok(apres.ferme && /Catalogue sur mesure enregistré/.test(apres.toast) && apres.focus === 'ouvrir', '[C] Enregistrer : la fenetre se ferme, le toast le dit, le focus revient au bouton', apres);
    const premier = ecrit.find((a) => a.nom === premierNom) || {};
    ok(brownie && brownie.prix === 3.5 && brownie.unite === 'joueur' && premier.prix === 9.5 && ecrit.length === 92 && /^92 articles/.test(apres.tete),
      `[C] le serveur a ecrit la seance : « ${premierNom} » a 9,50 €, « Brownie maison » 3,50 € par joueur, 92 articles relus`, { brownie, premier, n: ecrit.length, tete: apres.tete });

    // Echap previent avant de perdre une saisie.
    await page.locator('[data-sm-action="ouvrir"]').click();
    await page.waitForSelector('#smOverlay .sm-modal', { timeout: 5000 });
    await page.locator('#smOverlay [data-sm-art] [data-sm-cle="nom"]').first().fill('Nom provisoire');
    await page.keyboard.press('Escape');
    const arme = await page.evaluate(() => ({ ouvert: Boolean(document.getElementById('smOverlay')), bouton: (document.querySelector('#smOverlay .sm-pied [data-sm-action="fermer"]') || {}).textContent }));
    await page.keyboard.press('Escape');
    const quitte = await page.evaluate(() => !document.getElementById('smOverlay'));
    const toujours = ((B.base.centers[0].settings.config || {}).surMesure || { articles: [] }).articles;
    ok(arme.ouvert && /Quitter sans enregistrer/.test(arme.bouton || '') && quitte && !toujours.some((a) => a.nom === 'Nom provisoire'),
      '[X] Echap avec une saisie : « Quitter sans enregistrer » d abord, puis la fenetre se ferme sans rien ecrire', { arme, quitte });
    ok(!erreurs.length, '[S] aucune erreur dans la page', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree au texte servi, sa lettre rougit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'en-tete-muet', lettre: 'M', editions: [{ fichier: JS, de: "          ${derniereModif ? `<p class=\"fx-modif\" data-fx-modif>${escapeHtml(derniereModif)}</p>` : ''}\n", vers: '' }] },
  { nom: 'en-tete-11px', lettre: 'M', editions: [{ fichier: CSS, de: 'body:is(.staff-mode, .admin-mode) .fx-modal .fx-modif { margin: 4px 0 0; font-size: 13px;', vers: 'body:is(.staff-mode, .admin-mode) .fx-modal .fx-modif { margin: 4px 0 0; font-size: 11px;' }] },
  { nom: 'historique-absent', lettre: 'H', editions: [{ fichier: JS, de: '        ${renderGroupeHistorique(r)}\n', vers: '' }] },
  { nom: 'historique-lu-d-avance', lettre: 'H', editions: [{ fichier: JS, de: '  const ouvert = historiquesOuverts.has(id);', vers: '  const ouvert = historiquesOuverts.has(id);\n  if (!historiquesLus.has(id)) chargerHistoriqueDossier(r);' }] },
  { nom: 'historique-meta-11px', lettre: 'H', editions: [{ fichier: CSS, de: '.fx-histo-meta { display: flex; flex-wrap: wrap; gap: 0 8px; margin: 0; font-size: 12px;', vers: '.fx-histo-meta { display: flex; flex-wrap: wrap; gap: 0 8px; margin: 0; font-size: 11px;' }] },
  { nom: 'note-encaisse-absente', lettre: 'E', editions: [{ fichier: JS, de: "${typeof niveauStaff === 'function' && niveauStaff('prix') === 'non' ? '<p class=\"pos-encaisse-note\">", vers: "${false ? '<p class=\"pos-encaisse-note\">" }] },
  { nom: 'onglet-absent', lettre: 'S', editions: [{ fichier: 'assets/staff-pages-v2.js', de: "        ...(surMesure ? [{ key: 'surmesure', label: 'Sur mesure', count: surMesure.compte(), active: ongletSurMesure }] : []),\n", vers: '' }] },
  { nom: 'boutons-24px', lettre: 'S', editions: [{ fichier: CSS, de: '.sm-mini { min-width: 32px; min-height: 32px;', vers: '.sm-mini { min-width: 24px; min-height: 24px;' }] },
  { nom: 'deux-boutons-pleins', lettre: 'S', editions: [{ fichier: MODULE, de: '<button type="button" class="pv2-btn" data-sm-action="fermer" data-sm-focus="fermer"', vers: '<button type="button" class="pv2-btn primary" data-sm-action="fermer" data-sm-focus="fermer"' }] },
  { nom: 'echap-perd-la-saisie', lettre: 'X', editions: [{ fichier: MODULE, de: '    if (!forcer && modifie() && !fenetre.quitter) {', vers: '    if (false) {' }] },
  { nom: 'pied-redessine-a-chaque-lettre', lettre: 'T', editions: [{ fichier: MODULE, de: '    if (html === fenetre.pied) return;\n', vers: '' }] },
  { nom: 'change-qui-desarme-echap', lettre: 'X', editions: [{ fichier: MODULE, de: '    if (cible[cle] === valeur) return;\n', vers: '' }] },
  { nom: 'clic-perdu-sur-enregistrer', lettre: 'C', editions: [{ fichier: MODULE, de: '    if (cible[cle] === valeur) return;\n', vers: '' }, { fichier: MODULE, de: '    if (html === fenetre.pied) return;\n', vers: '' }] },
  { nom: 'focus-perdu-apres-enregistrer', lettre: 'C', editions: [{ fichier: MODULE, de: '      repeindrePage();\n      if (fenetre === ici) fermer({ forcer: true });', vers: '      if (fenetre === ici) fermer({ forcer: true });\n      repeindrePage();' }] },
  { nom: 'en-tete-de-categorie-en-header', lettre: 'S', editions: [{ fichier: MODULE, de: '      <div class="sm-cat-tete">', vers: '      <header class="sm-cat-tete">' }, { fichier: MODULE, de: "        ${masquee ? '<span class=\"pv2-chip\">Masquée</span>' : ''}\n      </div>", vers: "        ${masquee ? '<span class=\"pv2-chip\">Masquée</span>' : ''}\n      </header>" }] },
];

async function main() {
  const serveur = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await scenario(browser);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = true;
        try { await scenario(browser); } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
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
    serveur.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\ndroits-2b-ui-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\ndroits-2b-ui-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

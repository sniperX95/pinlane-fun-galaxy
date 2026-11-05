// LE BANC DU COMPTOIR (2026-11-05, lots 1 a 3 de la fenetre Reserver).
//
// La VRAIE console (scripts/planning-v3-fixtures.js), le VRAI handler
// api/staff-reservations.js et le vrai moteur (scripts/reserver-banc.js, base en
// memoire), le samedi 16 janvier 2027 a 15:10, plus des horaires retenus par des
// clients en ligne, poses a la fois dans la base du banc (le serveur les compte)
// et dans la journee servie a la console (`holds` de staff-state).
//
// Le gate scripts/comptoir-check.js et les images d Ansar passent par ici.
// Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const path = require('path');

delete process.env.RESEND_API_KEY;
delete process.env.POSTGRES_URL;
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fetchOrigine = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) throw new Error(`banc : appel sortant refuse vers ${u.slice(0, 80)}`);
  return fetchOrigine(url, init);
};

const B = require('./reserver-banc.js');
const FX = require('./planning-v3-fixtures.js');

const ROOT = path.resolve(__dirname, '..');
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JOUR = '2027-01-16';
const HEURE = '15:10';

const HORLOGE_SERVEUR = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };

FX.APPAREILS.comptoir = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
FX.APPAREILS.image = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2, locale: 'fr-BE' };

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

function roleDe(nom) {
  if (nom === 'catalogue') return B.sessionDuRole('staff-bar', { nom: 'Accueil' });
  // Un role sur mesure : il reserve et adapte une formule, sans le droit Tarifs.
  if (nom === 'sans-tarifs') {
    const session = B.sessionDuRole('manager', { nom: 'Accueil' });
    return { ...session, permissions: session.permissions.filter((p) => p !== 'pricing.manage') };
  }
  // Un role sur mesure : il modifie les dossiers, sans le niveau forcer.
  if (nom === 'sans-forcer') {
    const session = B.sessionDuRole('manager', { nom: 'Accueil' });
    return { ...session, permissions: session.permissions.map((p) => p.replace(/forcer:.*$/, 'forcer:non')) };
  }
  return B.sessionDuRole(nom === 'direction' ? 'direction' : 'manager', { nom: 'Accueil' });
}

const { catalogueSurMesure, surMesureChoisissable } = require(path.join(ROOT, 'lib/center-config.js'));
const CATALOGUE = surMesureChoisissable(catalogueSurMesure('libramont'));

// UN BLOC DE PLAN TEL QUE LE MOTEUR L ECRIT.
const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const enHeure = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function blocBowling(debut, minutes, pistes, joueurs) {
  const s = enMin(debut);
  return { end: s + minutes, type: 'activity', label: 'Bowling', lanes: pistes.slice(), start: s, endTime: enHeure(s + minutes), players: joueurs, critical: true, startTime: debut, activityId: 'bowling', countIndex: 1, resourceType: 'bowling_lane', requiredLanes: pistes.length, durationMinutes: minutes };
}
function blocLaser(debut, joueurs) {
  const s = enMin(debut);
  return { end: s + 25, type: 'activity', label: 'Laser Game', lanes: [], start: s, endTime: enHeure(s + 25), players: joueurs, critical: true, startTime: debut, activityId: 'laser_game', countIndex: 1, weaponNeed: joueurs, groupPlayers: joueurs, playersTotal: joueurs, resourceType: 'laser_arena', playersBefore: 0, sharedSession: false, groupWaveCount: 1, groupWaveIndex: 1, durationMinutes: 25 };
}

// UN HORAIRE RETENU PAR UN CLIENT : le dossier sans donnee personnelle, comme
// blocageCommeReservation (lib/database.js) le rend.
function dossierRetenu({ heure, pistes = [], joueurs = 4, laser = 0, minutes = 60 }) {
  const blocs = [];
  if (pistes.length) blocs.push(blocBowling(heure, minutes, pistes, joueurs));
  if (laser) blocs.push(blocLaser(heure, laser));
  const fin = Math.max(...blocs.map((b) => b.end));
  return {
    centerId: 'libramont', date: JOUR, startTime: heure, duration: minutes / 60, totalDuration: (fin - enMin(heure)) / 60,
    lanes: pistes.slice(), laneCount: pistes.length, pax: laser || joueurs, type: pistes.length ? 'bowling' : 'laser', label: pistes.length ? 'Bowling' : 'Laser Game',
    channel: 'public', price: 39, basePrice: 39, status: 'pending', validationStatus: 'confirmed', extras: [], notes: '',
    opsPlan: { startTime: heure, endTime: enHeure(fin), resourceBlocks: blocs, timeline: blocs.map((b) => ({ ...b })), conflicts: [], assignedLanes: pistes.slice() },
  };
}

// La retenue vit dans la base du banc (le serveur la compte), et la console la
// recoit par staff-state, a part, comme en production.
function poserRetenues(retenues, maintenant) {
  B.base.holds.clear();
  B.base.seqHold = 0;
  const servies = [];
  retenues.forEach((r, i) => {
    const dossier = dossierRetenu(r);
    const echeance = new Date(maintenant + (Number(r.resteMinutes) || 8) * 60000 + (Number(r.resteSecondes) || 0) * 1000);
    B.base.seqHold += 1;
    const id = B.base.seqHold;
    B.base.holds.set(id, { id, center_id: 'libramont', date: JOUR, start_time: r.heure, token_hash: `jeton-${i}`, ip_hash: `appareil-${i}`, payload: dossier, created_at: new Date(maintenant), expires_at: echeance, released_at: null, release_reason: null, reservation_id: null });
    servies.push({ ...dossier, id: -id, name: 'Réservation en ligne en cours', phone: '', email: '', blocage: { expiresAt: echeance.toISOString() } });
  });
  return servies;
}

// LE CATALOGUE EN MEMOIRE : les ecritures et les relectures de lib/catalog-store.js, telles quelles.
// Le centre appartient a l entreprise fungalaxy ; une formule ecrite se relit au rafraichissement.
const CATALOGUE_BANC = { formules: new Map(), etapes: [] };
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryAvant = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const lignes = (rows) => ({ rows: JSON.parse(JSON.stringify(rows)), rowCount: rows.length });
  if (s.startsWith("select nullif(client_id, '') as client_id from centers where id = $1")) return lignes([{ client_id: 'fungalaxy' }]);
  if (/^select id,? ?(client_id)? from centers/.test(s) || /^select id, nullif\(client_id/.test(s)) return lignes([{ id: 'libramont', client_id: 'fungalaxy' }, { id: 'gembloux', client_id: 'fungalaxy' }]);
  if (s === 'select id from formulas;') return lignes([...CATALOGUE_BANC.formules.values()].map((f) => ({ id: f.id })));
  const ecriture = /^insert into (formulas|formula_steps) \((.+?)\) values/.exec(s);
  if (ecriture) {
    const ligne = {};
    ecriture[2].split(', ').filter((c) => c !== 'updated_at').forEach((c, i) => { ligne[c] = params[i]; });
    if (ecriture[1] === 'formulas') CATALOGUE_BANC.formules.set(ligne.id, ligne);
    else CATALOGUE_BANC.etapes = [...CATALOGUE_BANC.etapes.filter((e) => !(e.formula_id === ligne.formula_id && e.position === ligne.position)), ligne];
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('delete from formula_steps where formula_id = $1')) {
    CATALOGUE_BANC.etapes = CATALOGUE_BANC.etapes.filter((e) => e.formula_id !== params[0]);
    return { rows: [], rowCount: 0 };
  }
  if (/^select .* from formulas where id = \$1/.test(s)) {
    const f = CATALOGUE_BANC.formules.get(params[0]);
    return lignes(f ? [f] : []);
  }
  if (/^select .* from formulas;?$/.test(s)) return lignes([...CATALOGUE_BANC.formules.values()]);
  if (/^select .* from formula_steps/.test(s)) return lignes(CATALOGUE_BANC.etapes.slice().sort((a, b) => a.formula_id.localeCompare(b.formula_id) || a.position - b.position));
  if (/^select .* from activities/.test(s)) return lignes([]);
  if (/^select .* from formule_overrides/.test(s)) return lignes([]);
  return queryAvant.call(this, sql, params);
};

function monterServeur({ mutations = [] } = {}) {
  const serveur = B.monter({ mutations: [HORLOGE_SERVEUR, ...mutations], session: roleDe('direction') });
  CATALOGUE_BANC.formules.clear();
  CATALOGUE_BANC.etapes = [];
  const ops = require(path.join(ROOT, 'api/ops.js'));
  const appelerMoteur = serveur.appeler;
  // (la meme page, le meme journal : /api/ops au vrai handler, le reste a api/staff-reservations)
  serveur.appeler = (methode, url, corps) => (String(url).startsWith('/api/ops') ? B.appeler(ops, methode, url, corps) : appelerMoteur(methode, url, corps));
  return serveur;
}

// LA CONSOLE OUVERTE SUR LE SAMEDI, avec ses retenues.
async function ouvrirConsole(browser, serveur, { role = 'direction', appareil = 'comptoir', theme = 'light', retenues = [], port, catalogue = CATALOGUE, reservations = null } = {}) {
  const fx = FX.lireFixture('pic');
  const maintenant = FX.instant(fx.staffState.date, HEURE).getTime();
  globalThis.__comptoirMaintenant = maintenant;
  B.base.horloge = maintenant;
  const semees = reservations ? reservations(fx.staffState.reservations) : fx.staffState.reservations;
  B.semer(semees.map(ligneDepuis));
  const holds = poserRetenues(retenues, maintenant);
  const session = roleDe(role);
  serveur.changerSession(session);
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil, theme, port, heure: HEURE,
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => { journal.push({ m: 'PATCH', corps }); return serveur.appeler('PATCH', '/api/staff-reservations', corps); });
      await page.exposeFunction('__vraiAppel', async (methode, url, corps) => { journal.push({ m: methode, url, corps }); return serveur.appeler(methode, url, corps); });
      await page.route('**/*fixture=*', async (route) => {
        const r = await route.fetch();
        let b = await r.text();
        b = b.split('DÉMO · ').join('').split('D\\u00c9MO \\u00b7 ').join('').replace(/\[DEMO-JOURS[^"\\]*\]\s*/g, '').replace(/Dossier fictif de d(?:é|\\u00e9)monstration[^"]*/g, '');
        await route.fulfill({ response: r, body: b });
      });
    },
  });
  const { ctx, page, erreurs } = m;
  page.setDefaultTimeout(20000);
  await page.evaluate(({ catalogue, droits, holds, jour, garde }) => {
    // La journee choisie vaut pour la base ET pour la page : les deux voient les memes dossiers.
    if (garde) {
      const gardes = new Set(garde);
      window.__FIXTURE__.jours[jour] = window.__FIXTURE__.jours[jour].filter((r) => gardes.has(r.id));
      state.reservations = state.reservations.filter((r) => gardes.has(r.id));
      renderStaff();
    }
    window.__catalogue = catalogue;
    window.__holds = holds;
    if (droits) state.staffAuthSession = { ...state.staffAuthSession, role: { id: droits.id, name: droits.id, locked: false }, permissions: droits.permissions };
    memoriserBlocagesEnLigne('libramont', jour, holds);
    const avant = window.fetch;
    window.fetch = async (input, init) => {
      init = init || {};
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'surMesureCatalogue') {
        const rep = await window.__vraiAppel('GET', '/api/ops?action=surMesureCatalogue&centerId=libramont');
        return json({ ok: true, centerId: 'libramont', surMesure: window.__catalogue, formulesGardees: (rep.json || {}).formulesGardees || [] });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'clientCatalog') {
        const rep = await window.__vraiAppel('GET', u.pathname + u.search);
        return json(rep.json || {}, rep.statut);
      }
      if (u.pathname === '/api/ops' && me === 'POST') {
        const corps = init.body ? JSON.parse(init.body) : {};
        if (/FormuleSurMesure$/.test(String(corps.action))) {
          const rep = await window.__vraiAppel('POST', '/api/ops', corps);
          return json(rep.json || {}, rep.statut);
        }
      }
      if (u.pathname === '/api/staff-state' && me === 'GET' && u.searchParams.get('date') === jour) {
        const r = await avant(input, init);
        const j = await r.clone().json();
        j.holds = window.__holds;
        return json(j, r.status);
      }
      if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
        const corps = init.body ? JSON.parse(init.body) : undefined;
        const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
        const j = rep.json || {};
        if (me === 'POST' && !(corps && corps.dryRun) && j.reservation) window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(j.reservation);
        return json(j, rep.statut);
      }
      return avant(input, init);
    };
  }, { catalogue, holds, jour: JOUR, garde: reservations ? semees.map((r) => r.id) : null, droits: role === 'direction' ? null : { id: session.role.id, permissions: session.permissions } });
  await page.waitForSelector('.btn-new', { timeout: 10000 });
  const nouveaux = new Set([...B.base.reservations.keys()]);
  return { ctx, page, erreurs, journal, avant: nouveaux, B };
}

const pret = (page) => page.waitForFunction(() => { const b = document.querySelector('#rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 20000 });

async function ouvrirFenetre(page, pax = 7) {
  await page.locator('.btn-new').click();
  await page.locator(`#rsHaut [data-pax="${pax}"]`).click();
  await pret(page);
}

module.exports = { B, FX, ROOT, BROWSER_PATH, JOUR, HEURE, CATALOGUE, CATALOGUE_BANC, roleDe, monterServeur, ouvrirConsole, ouvrirFenetre, pret, dossierRetenu, poserRetenues, blocBowling, blocLaser };

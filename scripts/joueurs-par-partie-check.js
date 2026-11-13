#!/usr/bin/env node
'use strict';
/* ============================================================================
   GATE : les joueurs de chaque partie du laser (2026-11-13)

   Ansar, devant la fenetre du comptoir : « jai pas limpression quon puisse
   choisir le nombre de joueur pour les autres parties de laser par exemple la
   premiere on a dcp le nombre de joueur mais la 2 et 3eme partie on sait pas
   choisir le nombre de joueur ». Les memes joueurs, certains en font moins :
   chacun paie les parties qu il joue (12, 10 puis 8 joueurs : 2 joueurs a une
   partie, 2 a deux parties, 8 a trois parties).

   [S] LE SERVEUR (lib/visit-program.js), sans navigateur :
       S1 le prix suit les parties jouees : 12 x 3 parties = 300 EUR, 12, 10
          puis 8 = 256 EUR ; 5 parties au comptoir (au palier) = 446 EUR ;
       S2 une demande en ligne ne peut pas en poser, et une liste fausse se
          refuse avec sa raison (nombre de parties, bornes, la plus remplie,
          avec des groupes) ;
       S3 une liste toute egale s efface : la ligne et son prix d avant ;
       S4 le moteur recoit les joueurs de chaque partie, toutes placees ;
       S5 la fiche, la feuille de l equipe (programme-a-cocher) et le mail le
          disent : « 12, 10 puis 8 joueurs » ;
       S6 la base les garde (normalizeReservationPayload).
   [F] LA FENETRE RESERVER, dans la vraie console du banc (vrais clics) :
       F1 le laser en 3 parties montre « Par partie » : un compteur par partie,
          tous a 12 ;
       F2 la partie 2 a 10 et la 3 a 8 : les compteurs le disent, le ticket
          dit « 12, 10 puis 8 joueurs » ;
       F3 le serveur chiffre la ligne 256 EUR, et le poste estime pareil ;
       F4 le plan pose 12, 10 puis 8 joueurs dans l arene, partie par partie ;
       F5 « Créer » : le dossier enregistre garde la liste et le prix ;
       F6 les joueurs de la ligne passent a 11 : la partie qui avait tout le
          monde suit (11, 10, 8) ; une partie de plus reprend la derniere.
   [D] LE DOSSIER relu : la liste revient au formulaire, « Joueurs par partie »
       la montre, et enregistrer une autre modification la renvoie.
   [*] Zero erreur JavaScript.

   Banc : celui de reserver-seances-check (planning-v3-fixtures, samedi
   16 janvier 2027 a 15:10, 46 groupes ; reserver-banc, base en memoire).
   CONTRE-PREUVES : `--contre-preuves` sert le code d avant, une regle a la fois
   (le disque n est jamais touche) ; `--ancres` verifie chaque ancre.
   ========================================================================== */
const fs = require('fs');
const path = require('path');

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

const B = require('./reserver-banc.js');
const FX = require('./planning-v3-fixtures.js');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_PARTIES_PORT || 4943);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HEURE = '15:10';
const TEL = '0470 12 34 56';
const APP = 'assets/app-main.js';
const VP = 'lib/visit-program.js';
const lf = (t) => String(t).split('\r\n').join('\n');

// LE CODE D AVANT, une regle a la fois. `cible` : la lettre qui doit rougir.
// `serveur` : la mutation vit dans un module Node, rejouee sans navigateur.
const MUTATIONS = [
  { nom: 'prix-plein', cible: 'S1', serveur: true, fichier: VP, de: '          item.price = prixDesParties(parPartie, centerId, staff === true);\n', vers: '' },
  { nom: 'public-accepte', cible: 'S2', serveur: true, fichier: VP, de: "        if (publicBooking) throw rejectOption('Les joueurs de chaque partie se règlent avec le centre.');\n", vers: '' },
  { nom: 'moteur-plein', cible: 'S4', serveur: true, fichier: VP, de: '      ...(Array.isArray(item.joueursParPartie) ? { participantsPerGame: item.joueursParPartie.slice() } : {}),\n', vers: '' },
  { nom: 'base-oublie', cible: 'S6', serveur: true, fichier: 'lib/database.js', de: '    if (Array.isArray(item.joueursParPartie) && item.joueursParPartie.length >= 2) out.joueursParPartie = item.joueursParPartie.slice(0, 12).map((n) => Math.min(240, Math.max(1, Math.trunc(Number(n) || 1))));\n', vers: '' },
  { nom: 'rangee-absente', cible: 'F1', fichier: APP, de: '  if (parties > 1) rangs.push(rsRangJoueursDesParties());\n', vers: '' },
  { nom: 'liste-pas-envoyee', cible: 'F5', fichier: APP, de: '    if (parPartie.length > 1 && parPartie.some((n) => n !== ligne.participants)) ligne.joueursParPartie = parPartie;\n', vers: '' },
  { nom: 'estimation-pleine', cible: 'F3', fichier: APP, de: '      const parPartie = Array.isArray(item.joueursParPartie) && item.joueursParPartie.length === parties ? item.joueursParPartie.map((n) => Math.min(effectif, Math.max(1, Math.trunc(Number(n) || 1)))) : null;', vers: '      const parPartie = null;' },
  { nom: 'ligne-sans-suite', cible: 'F6', fichier: APP, de: "    if (id === 'laser_game') rsPartiesSuiventLaLigne(getQuickVisitOptions('laser_game'), voulu);\n", vers: '' },
  { nom: 'dossier-perd', cible: 'D', fichier: APP, de: '...(parPartieEditee ? { joueursParPartie: parPartieEditee } : {}), ', vers: '' },
  { nom: 'bloc-sans-joueurs', cible: 'F7', fichier: APP, de: '<span class="rs-partie-l">Partie ${k + 1}${joueurs}</span>', vers: '<span class="rs-partie-l">Partie ${k + 1}</span>' },
  { nom: 'touche-pleine', cible: 'F3', fichier: APP, de: '      if (liste.length > 1 && liste.some((n) => n !== item.participants)) item.joueursParPartie = liste;\n', vers: '' },
  // Le serveur qui ne voit pas changer les joueurs d une partie : il gardait le prix d avant.
  { nom: 'serveur-aveugle', cible: 'D', fichier: 'api/staff-reservations.js', de: '    if (Array.isArray(item.joueursParPartie)) choice.joueursParPartie = item.joueursParPartie.map(Number);\n', vers: '' },
];

const argument = (nom) => process.argv.includes(`--${nom}`);
let mutation = null;
let echecs = [];
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; if (!mutation) console.log(`ok    ${label}`); return true; }
  echecs.push(label);
  if (!mutation) console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}

function compterAncre(m) {
  return lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
}

function transformer(rel, texte) {
  if (!mutation || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

// Un module Node rejoue avec une mutation : charge depuis son texte transforme, sans toucher au disque.
function chargerModule(rel) {
  const Module = require('module');
  const fichier = path.join(ROOT, rel);
  if (!mutation || mutation.fichier !== rel) return require(fichier);
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  m._compile(transformer(rel, fs.readFileSync(fichier, 'utf8')), fichier);
  return m.exports;
}

// ---------------------------------------------------------------------------
// [S] LE SERVEUR
// ---------------------------------------------------------------------------
function preuvesServeur(lettres) {
  const vp = chargerModule(VP);
  const laser = (extra, opts = {}) => vp.normalizeProgram([{ activityId: 'laser_game', games: 3, participants: 12, ...extra }], { centerId: 'libramont', pax: 12, staff: true, ...opts });
  const refus = (fn) => { try { fn(); return ''; } catch (e) { return e.message || 'refus'; } };
  const tous = laser({});
  const parties = laser({ joueursParPartie: [12, 10, 8] });
  if (lettres.includes('S1')) {
    const cinq = vp.normalizeProgram([{ activityId: 'laser_game', games: 5, participants: 12, joueursParPartie: [12, 12, 10, 10, 6] }], { centerId: 'libramont', pax: 12, staff: true });
    ok(tous.items[0].price === 300, '[S1] montage : 12 joueurs a 3 parties = 300 EUR', tous.items[0].price);
    ok(parties.items[0].price === 256 && parties.price === 256, '[S1] 12, 10 puis 8 joueurs = 256 EUR (2 a 1 partie, 2 a 2 parties, 8 a 3 parties)', parties.items[0].price);
    ok(cinq.items[0].price === 446, '[S1] 5 parties au comptoir, au palier : 12, 12, 10, 10 puis 6 = 446 EUR', cinq.items[0].price);
  }
  if (lettres.includes('S2')) {
    const enLigne = refus(() => vp.normalizeProgram([{ activityId: 'laser_game', games: 3, participants: 12, joueursParPartie: [12, 10, 8] }], { centerId: 'libramont', pax: 12, publicBooking: true }));
    ok(/se règlent avec le centre/.test(enLigne), '[S2] une demande en ligne ne pose pas les joueurs de chaque partie', enLigne);
    const raisons = {
      nombre: refus(() => laser({ joueursParPartie: [12, 10] })),
      bornes: refus(() => laser({ joueursParPartie: [12, 1, 8] })),
      remplie: refus(() => laser({ joueursParPartie: [10, 10, 8] })),
      groupes: refus(() => vp.normalizeProgram([{ activityId: 'laser_game', games: 2, participants: 12, groupes: [6, 6], joueursParPartie: [12, 8] }], { centerId: 'libramont', pax: 12, staff: true })),
    };
    ok(/chacune des 3 parties/.test(raisons.nombre) && /de 2 à 12 joueurs/.test(raisons.bornes) && /la plus remplie/.test(raisons.remplie) && /groupes/.test(raisons.groupes), '[S2] une liste fausse se refuse avec sa raison', raisons);
  }
  if (lettres.includes('S3')) {
    const egaux = laser({ joueursParPartie: [12, 12, 12] });
    ok(egaux.items[0].joueursParPartie === undefined && egaux.items[0].price === 300, '[S3] une liste toute egale s efface : la ligne et le prix d avant', egaux.items[0]);
  }
  if (lettres.includes('S4')) {
    const etape = vp.buildProgramFormula(parties).steps[0];
    ok(JSON.stringify(etape.participantsPerGame) === '[12,10,8]' && etape.count === 3 && !etape.baseGames, '[S4] le moteur recoit 12, 10 puis 8 joueurs, les trois parties placees', etape);
  }
  if (lettres.includes('S5')) {
    const comms = require(path.join(ROOT, 'lib/ops-communications.js'));
    let mail = '';
    try {
      const m = comms.buildMessage({ reservation: { id: 7, centerId: 'libramont', name: 'Client', date: '2027-01-16', startTime: '17:00', pax: 12, type: 'visite', label: 'Laser Game', price: 256, program: { items: parties.items } }, templateId: 'confirmation', channel: 'email' });
      mail = JSON.stringify(m.details || m);
    } catch (e) { mail = `erreur ${e.message}`; }
    ok(/12, 10 puis 8 joueurs/.test(vp.describeProgram(parties)), '[S5] la fiche dit « 12, 10 puis 8 joueurs »', vp.describeProgram(parties));
    ok(/3 parties : 12, 10 puis 8 joueurs/.test(mail), '[S5] le mail le dit', mail.slice(0, 300));
  }
  if (lettres.includes('S6')) {
    const db = chargerModule('lib/database.js');
    let garde = null;
    try {
      const sortie = db.normalizeReservationPayload({ centerId: 'libramont', name: 'Client', phone: TEL, date: '2027-01-16', startTime: '17:00', duration: 1.5, pax: 12, type: 'visite', price: 256, program: { items: parties.items } });
      const items = Array.isArray(sortie.program) ? sortie.program : (sortie.program || {}).items || [];
      garde = (items.find((i) => i.activityId === 'laser_game') || {}).joueursParPartie || null;
    } catch (e) { garde = `erreur ${e.message}`; }
    ok(JSON.stringify(garde) === '[12,10,8]', '[S6] la base garde 12, 10 puis 8 joueurs', garde);
  }
}

// ---------------------------------------------------------------------------
// LE MONTAGE (celui de reserver-seances-check)
// ---------------------------------------------------------------------------
const HORLOGE_SERVEUR = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };

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

let serveur = null;
// Sous la contre-preuve du serveur, les appels de la page vont a un gestionnaire compile depuis le
// texte d avant (ses dependances restent celles du banc).
let gestionnaireMute = null;
function appelServeur(methode, url, corps) {
  if (mutation && mutation.fichier === 'api/staff-reservations.js') {
    if (!gestionnaireMute || gestionnaireMute.nom !== mutation.nom) gestionnaireMute = { nom: mutation.nom, h: chargerModule('api/staff-reservations.js') };
    return B.appeler(gestionnaireMute.h, methode, url, corps);
  }
  return serveur.appeler(methode, url, corps);
}

async function ouvrirConsole(browser) {
  FX.APPAREILS.comptoir = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
  const fx = FX.lireFixture('pic');
  globalThis.__comptoirMaintenant = FX.instant(fx.staffState.date, HEURE).getTime();
  B.semer(fx.staffState.reservations.map(ligneDepuis));
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil: 'comptoir', theme: 'light', port: PORT, heure: HEURE,
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => appelServeur('PATCH', '/api/staff-reservations', corps));
      await page.exposeFunction('__vraiAppel', async (methode, url, corps) => appelServeur(methode, url, corps));
      await page.route('**/*fixture=*', async (route) => {
        const r = await route.fetch();
        let b = await r.text();
        b = b.split('DÉMO · ').join('').split('D\\u00c9MO \\u00b7 ').join('').replace(/\[DEMO-JOURS[^"\\]*\]\s*/g, '').replace(/Dossier fictif de d(?:é|\\u00e9)monstration[^"]*/g, '');
        await route.fulfill({ response: r, body: b });
      });
    },
  });
  const { page } = m;
  page.setDefaultTimeout(8000);
  await page.evaluate(() => {
    const avant = window.fetch;
    window.fetch = async (input, init) => {
      init = init || {};
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'surMesureCatalogue') return json({ ok: true, centerId: 'libramont', surMesure: { categories: [], articles: [] } });
      // (le PATCH aussi : la journee du banc ne connait pas le dossier que la fenetre vient de creer,
      // elle repondait « introuvable » avant le vrai serveur)
      if (u.pathname === '/api/staff-reservations') {
        const corps = init.body ? JSON.parse(init.body) : undefined;
        const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
        return json(rep.json || {}, rep.statut);
      }
      return avant(input, init);
    };
  });
  await page.waitForSelector('.gf-r', { timeout: 10000 });
  return m;
}

const pret = (page) => page.waitForFunction(() => { const b = document.querySelector('#rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 8000 }).catch(() => {});
const lues = (page, id) => page.waitForSelector(`.rs-s-l[data-verifie="1"] [data-activite="${id}"]`, { timeout: 8000 }).catch(() => {});
async function geste(page, selecteur) {
  await page.locator(selecteur).click();
  await page.waitForTimeout(150);
  await pret(page);
  await page.waitForTimeout(250);
}
const compteurs = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.rs-cpt [data-partie-joueurs]')).filter((b, i, t) => t.findIndex((x) => x.dataset.partieJoueurs === b.dataset.partieJoueurs) === i).map((b) => Number(b.closest('.rs-pas').querySelector('b').textContent)));
const moins = (k) => `.rs-cpt [data-partie-joueurs="${k}"][aria-label$="un de moins"]`;

// ---------------------------------------------------------------------------
// [F] [D] LA FENETRE, PUIS LE DOSSIER
// ---------------------------------------------------------------------------
async function scenarioFenetre(browser, lettres) {
  const m = await ouvrirConsole(browser);
  const { page } = m;
  try {
    await page.locator('.btn-new').click();
    await page.locator('#rsHaut [data-pax="12"]').click();
    await pret(page);
    await page.locator('#rsAjout-laser_game').click();
    await lues(page, 'laser_game');
    await page.locator('#rsL-a-laser_game').click();
    await page.waitForSelector('[data-parties="3"]');
    await geste(page, '[data-parties="3"]');
    // Une heure ou les trois parties de 12 tiennent (le samedi du banc est charge) : la premiere
    // touche de la page du laser que le plan accepte.
    let heure = '';
    const essayees = [];
    for (let essai = 0; essai < 10 && !heure; essai += 1) {
      const candidate = await page.evaluate((deja) => {
        const b = Array.from(document.querySelectorAll('.rs-rang.is-heures [data-heure-l]')).find((x) => !/is-(coince|efface|pendant|ko|on)\b/.test(x.className) && !x.disabled && !deja.includes(x.dataset.heureL) && /reste (\d+)/.test(x.textContent) && Number(x.textContent.match(/reste (\d+)/)[1]) >= 12);
        return b ? b.dataset.heureL : '';
      }, essayees);
      if (!candidate) break;
      essayees.push(candidate);
      await geste(page, `.rs-rang.is-heures [data-heure-l="${candidate}"]`);
      const plan = await page.evaluate(() => { const p = rvPlanCourant(); return p ? p.disponible : null; });
      if (plan) heure = candidate;
    }
    ok(Boolean(heure), '[F1] montage : une heure ou trois parties de 12 tiennent', heure);
    const c0 = await compteurs(page);
    ok(JSON.stringify(c0) === '[12,12,12]' || lettres.every((l) => l !== 'F1'), '[F1] le laser en 3 parties montre « Par partie » : trois compteurs a 12', c0);
    if (JSON.stringify(c0) !== '[12,12,12]') return;
    for (let i = 0; i < 2; i += 1) await geste(page, moins(2));
    for (let i = 0; i < 4; i += 1) await geste(page, moins(3));
    const c1 = await compteurs(page);
    const ticket = await page.evaluate(() => (document.querySelector('#rsL-a-laser_game') || {}).textContent || '');
    ok(JSON.stringify(c1) === '[12,10,8]' && /12, 10 puis 8 joueurs/.test(ticket), '[F2] la partie 2 a 10, la 3 a 8 : les compteurs et le ticket le disent', { c1, ticket: ticket.replace(/\s+/g, ' ').trim() });
    if (process.env.PARTIES_PHOTOS && !mutation) {
      const modale = page.locator('.qb-modal.rv.rs').first();
      await modale.screenshot({ path: path.join(process.env.PARTIES_PHOTOS, 'fenetre-par-partie.png') }).catch(() => {});
    }
    if (lettres.includes('F7')) {
      // La page des activites : chaque rangee « Partie 2 », « Partie 3 » porte ses joueurs.
      await geste(page, '#rsRetour');
      const bloc = () => page.evaluate(() => Array.from(document.querySelectorAll('.rs-partie-j .rs-pas')).map((p) => Number(p.querySelector('b').textContent)));
      const b0 = await bloc();
      if (process.env.PARTIES_PHOTOS && !mutation) await page.locator('.qb-modal.rv.rs').first().screenshot({ path: path.join(process.env.PARTIES_PHOTOS, 'fenetre-bloc-laser.png') }).catch(() => {});
      let b1 = null;
      if (JSON.stringify(b0) === '[10,8]') {
        await geste(page, '[data-partie-bloc="3"][aria-label$="un de moins"]');
        b1 = { bloc: await bloc(), envoi: await page.evaluate(() => ligneProgrammeQuick('laser_game').joueursParPartie || null) };
        await geste(page, '[data-partie-bloc="3"][aria-label$="un de plus"]');
      }
      ok(JSON.stringify(b0) === '[10,8]' && b1 && JSON.stringify(b1.bloc) === '[10,7]' && JSON.stringify(b1.envoi) === '[12,10,7]', '[F7] sur la page des activites, « Partie 2 » et « Partie 3 » portent leurs joueurs (10, 8) et un toucher les change', { b0, b1 });
      await page.locator('#rsL-a-laser_game').click();
      await page.waitForSelector('[data-parties="3"]');
      await pret(page);
    }
    const prix = await page.evaluate(() => {
      const plan = rvPlanCourant();
      const ligne = { ...ligneProgrammeQuick('laser_game'), games: rvPartiesLaser() };
      return { serveur: plan ? Number(plan.prix) : null, poste: estimerPrixProgramme([ligne], quickBookState.pax, quickBookState.date, quickBookState.startTime).total, envoi: ligne.joueursParPartie || null };
    });
    if (lettres.includes('F3')) {
      ok(prix.serveur === 256 && prix.poste === 256, '[F3] le serveur chiffre 256 EUR, le poste estime pareil', prix);
      const touches = await page.evaluate(() => [1, 2, 3].map((n) => ((document.querySelector(`[data-parties="${n}"]`) || {}).textContent || '').replace(/\s+/g, ' ').trim()));
      ok(/120\s*€/.test(touches[0]) && /200\s*€/.test(touches[1]) && /256\s*€/.test(touches[2]), '[F3] les touches des parties disent le prix de leur toucher : 120, 200 et 256 EUR', touches);
    }
    if (lettres.includes('F4')) {
      const poses = await page.evaluate(() => {
        const blocs = ((rvPlanCourant() || {}).blocs || []).filter((b) => b.activite === 'laser_game');
        const parPartie = {};
        blocs.forEach((b) => { const k = Number(b.partie || 1); parPartie[k] = (parPartie[k] || 0) + Number(b.joueurs ?? b.pax ?? 0); });
        return { parPartie, exemple: blocs[0] || null };
      });
      ok(poses.parPartie[1] === 12 && poses.parPartie[2] === 10 && poses.parPartie[3] === 8, '[F4] le plan pose 12, 10 puis 8 joueurs dans l arene, partie par partie', poses);
    }
    if (lettres.includes('F6')) {
      const joueursLigne = '.rs-rang [data-activite="laser_game"][aria-label$="un de moins"]';
      await geste(page, joueursLigne);
      const c2 = await compteurs(page);
      await geste(page, '#rvPlusPartie');
      const c3 = await compteurs(page);
      ok(JSON.stringify(c2) === '[11,10,8]' && JSON.stringify(c3) === '[11,10,8,8]', '[F6] la ligne a 11 : la partie qui avait tout le monde suit ; une partie de plus reprend la derniere', { c2, c3 });
      // retour a l etat du ticket : 12 joueurs, 3 parties (le « + » reste grise quand la ligne
      // est deja a 12, comme sous la contre-preuve qui la laisse remonter seule)
      await geste(page, '[data-parties="3"]');
      const plusUn = '.rs-rang [data-activite="laser_game"][aria-label$="un de plus"]';
      if (await page.locator(plusUn).isEnabled().catch(() => false)) await geste(page, plusUn);
    }
    const avant = new Set(B.base.reservations.keys());
    const tel = await page.evaluate(() => { const c = document.getElementById('qbPhone'); return Boolean(c && !c.value.trim()); });
    if (tel) await page.fill('#qbPhone', TEL);
    await pret(page);
    await page.locator('#rvCreer').click();
    await page.waitForFunction(() => !document.querySelector('.qb-modal.rv.rs'), null, { timeout: 8000 }).catch(() => {});
    const nouveau = [...B.base.reservations.values()].find((r) => !avant.has(r.id));
    const items = nouveau ? (Array.isArray(nouveau.program) ? nouveau.program : (nouveau.program || {}).items || []) : [];
    const laser = items.find((i) => i.activityId === 'laser_game') || null;
    if (lettres.includes('F5')) ok(Boolean(laser) && JSON.stringify(laser.joueursParPartie) === '[12,10,8]' && Number(nouveau.price) === 256, '[F5] « Créer » : le dossier garde 12, 10 puis 8 joueurs, et 256 EUR', nouveau ? { prix: nouveau.price, laser } : 'aucun dossier cree');
    if (lettres.includes('D') && nouveau) {
      const planning = await page.evaluate((r) => [1, 2, 3].map((k) => getReservationLaserPlayersForGame(r, k)), { id: nouveau.id, pax: nouveau.pax, program: nouveau.program });
      ok(JSON.stringify(planning) === '[12,10,8]', '[D] le planning compte 12, 10 puis 8 joueurs a chaque partie du dossier', planning);
      // La fiche du dossier, onglet Modifier, comme au comptoir (edit-price-options-check).
      await page.evaluate((rid) => window.openStaffReservationDetail(rid), nouveau.id);
      await page.waitForSelector('.pos-tabs, .edit-form, [role="tab"]', { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => {
        const fiche = document.querySelector('#posOverlay, .pos-sheet') || document;
        const onglet = [...fiche.querySelectorAll('button, a, [role="tab"]')].find((t) => /^Modifier$/i.test(t.textContent.trim()));
        if (onglet) onglet.click();
      });
      await page.waitForSelector('.dossier-joueurs-parties', { timeout: 15000 }).catch(() => {});
      const lire = () => page.evaluate(() => Array.from(document.querySelectorAll('.dossier-joueurs-parties .dossier-partie-valeur')).map((x) => Number(x.textContent)));
      const vu = await lire();
      ok(JSON.stringify(vu) === '[12,10,8]', '[D] le dossier relu montre « Joueurs par partie » : 12, 10, 8', vu);
      if (JSON.stringify(vu) === '[12,10,8]') {
        await page.locator('.dossier-joueurs-parties [aria-label="Joueurs de la partie 3, un de moins"]').click();
        await page.waitForTimeout(300);
        const vu2 = await lire();
        if (process.env.PARTIES_PHOTOS && !mutation) {
          const bloc = page.locator('.dossier-joueurs-parties').first();
          await bloc.scrollIntoViewIfNeeded().catch(() => {});
          await page.screenshot({ path: path.join(process.env.PARTIES_PHOTOS, 'dossier-par-partie.png') }).catch(() => {});
        }
        if (process.env.PARTIES_DEBUG) await page.evaluate(() => { const f = window.fetch; window.__appels = []; window.fetch = async (i, init) => { window.__appels.push({ url: String((i && i.url) || i), m: (init && init.method) || 'GET', corps: init && init.body ? String(init.body) : '' }); return f(i, init); }; });
        await page.locator('#posOverlay button').filter({ hasText: /^\s*Enregistrer\s*$/ }).first().click();
        if (process.env.PARTIES_DEBUG) {
          await page.waitForTimeout(2500);
          console.log('DEBUG', JSON.stringify(await page.evaluate(() => ({ appels: window.__appels, erreur: (document.querySelector('#posOverlay .edit-error, #posOverlay [role="alert"], .toast') || {}).textContent || '', editError: state.editError || '' }))).slice(0, 4000));
        }
        let r2 = null;
        for (let i = 0; i < 30; i += 1) {
          await page.waitForTimeout(200);
          r2 = B.base.reservations.get(nouveau.id);
          const l2 = r2 ? (Array.isArray(r2.program) ? r2.program : (r2.program || {}).items || []).find((x) => x.activityId === 'laser_game') : null;
          if (l2 && JSON.stringify(l2.joueursParPartie) !== '[12,10,8]') break;
        }
        const laser2 = r2 ? (Array.isArray(r2.program) ? r2.program : (r2.program || {}).items || []).find((x) => x.activityId === 'laser_game') : null;
        ok(JSON.stringify(vu2) === '[12,10,7]' && Boolean(laser2) && JSON.stringify(laser2.joueursParPartie) === '[12,10,7]' && Number(r2.price) === 249, '[D] la partie 3 passee a 7 dans le dossier s enregistre : 12, 10 puis 7, a 249 EUR', { vu2, enregistre: laser2 && laser2.joueursParPartie, prix: r2 && r2.price, base: r2 && r2.base_price });
      }
    }
  } finally {
    ok(m.erreurs.length === 0, '[*] zero erreur JavaScript', m.erreurs.slice(0, 3).join(' | '));
    if (process.env.PARTIES_PHOTOS) {
      await m.page.screenshot({ path: path.join(process.env.PARTIES_PHOTOS, `fenetre-${mutation ? mutation.nom : 'apres'}.png`) }).catch(() => {});
    }
    await m.ctx.close();
  }
}

async function jouer(browser, lettres) {
  echecs = [];
  reussis = 0;
  preuvesServeur(lettres.filter((l) => l.startsWith('S')));
  if (lettres.some((l) => !l.startsWith('S'))) await scenarioFenetre(browser, lettres);
}

(async () => {
  if (argument('ancres')) {
    let mauvaises = 0;
    for (const m of MUTATIONS) {
      const n = compterAncre(m);
      console.log(`${n === 1 ? 'ok  ' : 'FAIL'}  ancre ${m.nom} (${m.fichier}) : ${n}`);
      if (n !== 1) mauvaises += 1;
    }
    process.exit(mauvaises ? 1 : 0);
  }
  for (const m of MUTATIONS) if (compterAncre(m) !== 1) { console.error(`ancre introuvable ou ambigue : ${m.nom}`); process.exit(1); }
  serveur = B.monter({ mutations: [HORLOGE_SERVEUR], session: B.sessionDuRole('direction', { nom: 'Accueil' }) });
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // (deux unites dans la suite : le passage simple, puis --contre-preuves seules, comme les autres gates)
    if (!argument('contre-preuves')) {
      const toutes = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'F1', 'F2', 'F7', 'F3', 'F4', 'F5', 'F6', 'D'];
      await jouer(browser, toutes);
      const total = reussis + echecs.length;
      if (echecs.length) {
        console.log(`\njoueurs-par-partie-check: ${echecs.length} ECHEC(S) sur ${total}`);
        process.exitCode = 1;
        return;
      }
      console.log(`\njoueurs-par-partie-check: ALL OK (${total})`);
    } else {
      let mordent = 0;
      for (const m of MUTATIONS) {
        mutation = m;
        await jouer(browser, [m.cible]);
        const mord = echecs.some((e) => e.startsWith(`[${m.cible}]`));
        console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${m.nom} : [${m.cible}] ${mord ? 'rougit' : 'RESTE VERT'}`);
        if (mord) mordent += 1;
      }
      mutation = null;
      console.log(`\ncontre-preuves : ${mordent}/${MUTATIONS.length} mordent`);
      if (mordent !== MUTATIONS.length) process.exitCode = 1;
    }
  } finally {
    await browser.close();
    http.close();
  }
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });

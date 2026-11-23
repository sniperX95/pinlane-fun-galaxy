// L HEURE DE CHAQUE ACTIVITE, SANS RIEN FAIRE SUIVRE (2026-11-20).
//
// Le gerant, sur la fenetre Reserver : « quand on choisit plein d'activités, tout s'adapte en fonction
// de l'heure du bowling, mais c'est pas ça : ils ont tous une heure, et si je veux mettre le bowling à
// la fin, à 23 h, et le reste plus tôt, je dois pouvoir, et ça ne doit pas faire suivre ». Sa capture :
// le laser a 23:00, sa touche 23:30 « décale le bowling », au ticket « Bowling 1 h · Déplacé de 23:00 à
// 23:30 · 23:30 à 24:30, piste 8, à la suite du laser ». La regle (rvHeureSansSuivre) :
//   [H1] AUCUNE NE BOUGE : Bowling, Laser et Minigolf pris par de vrais clics ; le bowling touche a 23:00
//        (sa touche le proposait, jamais « trop tard » : le laser ne le suit plus), le laser a 20:00, le
//        minigolf a 21:00 par le bouton d heure de sa ligne (ses demi-heures s ouvrent dessous, visibles)
//        : a chaque geste, les heures des autres restent ; l ordre suit les heures ; jamais « décale le »,
//        « Déplacé de », « à la suite » a l ecran ;
//   [H2] le corps de « Créer » porte ces heures (arrivee 20:00, bowling 23:00, minigolf pose a 21:00) et
//        le dossier cree les a en base ;
//   [H3] UN CHEVAUCHEMENT SE DIT, RIEN NE BOUGE : le laser touche a 23:00 sur le bowling de 23:00 (sa
//        touche disait « pendant le bowling ») se prend, le bowling reste a 23:00 ; les deux lignes du
//        ticket le disent, « Créer » attend (« Deux heures se chevauchent », sans « à placer ») et son
//        toucher ne cree rien ; le moteur du serveur refuse ce plan (« se chevauchent ») sans deplacer
//        aucune des deux heures ;
//   [H4] « LIBRE » REND L HEURE AU MOTEUR : le minigolf pose puis rendu repart libre, son heure ne part
//        plus, le ticket dit « accès libre pendant la visite » ;
//   [H5] LA PLUS TOT PORTE L ARRIVEE : le minigolf a 19:00 passe en tete, son heure part posee, les autres
//        restent, et le dossier cree l a a 19:00 ;
//   [J1] aucune erreur JS.
// La console reelle (journee « pic » de scripts/planning-v3-fixtures.js, samedi 16 janvier 2027 a
// 15:10), ses POST au VRAI handler api/staff-reservations.js sur la base en memoire de
// scripts/reserver-banc.js : aucune base reelle, aucun reseau.
// --contre-preuves : chaque garde retiree (en memoire ; le disque n est jamais touche) est d abord
// montable (son ancre existe une fois et une seule), puis ce gate ROUGIRAIT sur sa lettre.
//   HA_MUTATIONS : un sous-ensemble ; HA_BAVARD : les lignes des contre-preuves ;
//   HA_CAPTURES=<dossier> : les images (theme clair).
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_HEURE_ACTIVITE_PORT || 6210);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const FENETRE = 'lib/reserver-fenetre.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);
const CAPTURES = process.env.HA_CAPTURES || '';
const MINIGOLF = 'minigolf_blacklight';

let echecs = 0;
let silence = false;
const rouges = [];
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
  for (const ed of mutation.editions) if (ed.fichier === rel && !ed.serveur) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// LA BASE : la journee de la fixture.
// ---------------------------------------------------------------------------
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
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
function semer() { B.semer(FIXTURE.staffState.reservations.map(ligneDepuis)); }
function monterServeur() {
  return B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
}
function planEnBase(id) {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  return { row, plan: typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {}) };
}
// « laser_game 20:00 », « minigolf_blacklight 21:00 posee » : la premiere etape a heure de chaque activite.
function heuresEnBase(plan) {
  const res = {};
  ((plan && plan.timeline) || []).filter((s) => s && s.type === 'activity' && s.startTime).forEach((s) => {
    if (!res[s.activityId]) res[s.activityId] = `${s.startTime}${s.flexible ? ' libre' : ''}${s.heurePosee ? ' posee' : ''}`;
  });
  return res;
}

// Le corps que la fenetre enverrait : laser, minigolf, bowling, 6 joueurs, chaque heure choisie.
function corps(heures, extra = {}) {
  return {
    centerId: 'libramont', date: JOUR, name: 'Famille Chevauche', phone: '0470111444', email: '', status: 'pending', channel: 'staff', allowPastStart: false,
    startTime: heures.laser_game, duration: 1, totalDuration: 2.25, pax: 6, type: 'visite', lanes: [], laneCount: 1, requiresLanes: true,
    program: [{ activityId: 'laser_game', pax: 6, participants: 6, games: 1 }, { activityId: MINIGOLF, pax: 6, participants: 6 }, { activityId: 'bowling', pax: 6, participants: 6, duration: 1 }],
    preference: { activityOrder: ['laser_game', MINIGOLF, 'bowling'], preferredTimes: { laser_game: heures.laser_game, bowling: heures.bowling }, laserGameTimes: [heures.laser_game], laserPlacement: 'scheduled' },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// [H3] LE SERVEUR, SANS NAVIGATEUR : deux heures en meme temps ne se placent pas, et ne bougent pas.
// ---------------------------------------------------------------------------
async function scenarioServeur() {
  semer();
  const serveur = monterServeur();
  const r = await serveur.appeler('POST', '/api/staff-reservations', { ...corps({ laser_game: '23:00', bowling: '23:00' }), dryRun: true });
  const plan = (r.json && r.json.plan) || {};
  const etapes = (plan.etapes || []).map((e) => `${e.activite}@${e.debut}`);
  ok(r.statut === 200 && plan.disponible === false && /se chevauchent/.test(String(plan.refus || '')) && !etapes.some((e) => /@23:30$|@00:00$/.test(e)),
    '[H3] serveur : le laser et le bowling a 23:00, le moteur refuse (« se chevauchent ») et ne decale aucune des deux heures', { statut: r.statut, disponible: plan.disponible, refus: plan.refus, etapes });
  const s = await serveur.appeler('POST', '/api/staff-reservations', { ...corps({ laser_game: '20:00', bowling: '23:00' }, { heuresPosees: { [MINIGOLF]: '21:00' } }), dryRun: true });
  const planS = (s.json && s.json.plan) || {};
  ok(planS.disponible === true && (planS.etapes || []).map((e) => `${e.activite}@${e.debut}`).sort().join(' ') === `bowling@23:00 laser_game@20:00 ${MINIGOLF}@21:00`,
    '[H2] serveur : laser 20:00, minigolf pose 21:00, bowling 23:00, le plan les garde telles quelles', planS.etapes);
}

// ---------------------------------------------------------------------------
// LA CONSOLE : la fenetre Reserver.
// ---------------------------------------------------------------------------
async function monterConsole(browser) {
  semer();
  const serveur = monterServeur();
  const posts = [];
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil: 'ordinateur', theme: 'light', port: PORT, heure: '15:10',
    avantChargement: async (p) => {
      await p.exposeFunction('__fixtureServeur', async (c) => serveur.appeler('PATCH', '/api/staff-reservations', c));
      await p.exposeFunction('__fixtureBlanc', async (c) => { posts.push(c); return serveur.appeler('POST', '/api/staff-reservations', c); });
    },
  });
  return { ctx, page, erreurs, posts };
}

function lire() {
  const o = document.getElementById('quickBookOverlay');
  if (!o || !quickBookState) return { fermee: true };
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const lignes = rvHeuresDesLignes();
  const touches = (id) => Object.fromEntries(Array.from(o.querySelectorAll(`#rsZ-${id} [data-heure]`)).map((b) => [b.dataset.heure, t(b.querySelector('small'))]));
  const creer = document.getElementById('rvCreer');
  const panneau = document.getElementById(`rsHA-${'minigolf_blacklight'}`);
  return {
    ordre: rvActivites().join(','),
    heures: Object.fromEntries(Object.entries(lignes).map(([id, l]) => [id, l.heure || ''])),
    posees: JSON.stringify(quickBookState.heuresPosees || {}),
    lignes: Object.fromEntries(rvActivites().map((id) => [id, t(document.getElementById(`rsL-a-${id}`))])),
    bowling: touches('bowling'),
    laser: touches('laser_game'),
    bouton: t(document.querySelector('#rsHB-minigolf_blacklight b')),
    panneau: panneau ? panneau.getClientRects().length : 0,
    panneauHeures: panneau ? Array.from(panneau.querySelectorAll('[data-heure-l]')).map((b) => `${b.dataset.heureL || 'Libre'}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`) : [],
    creer: creer ? { texte: t(creer).replace(/Entrée$/, '').trim(), bloque: creer.classList.contains('is-bloque') } : null,
    forcer: Boolean(document.getElementById('rvForcer')),
    aPlacer: Boolean(quickBookState.forcer),
    ecran: t(o),
  };
}

async function planPose(page) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => quickBookState && quickBookState.plan && quickBookState.plan.etat !== 'calcul' && quickBookState.plan.cle === quickBookState.cleCourante, null, { timeout: 15000 }).catch(() => null);
  // (les heures que le serveur juge, apres la peinture : les mots des touches)
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#quickBookOverlay [data-verifie]')).every((n) => n.dataset.verifie === '1'), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(300);
}

async function photo(page, nom) {
  if (!CAPTURES || mutation || !nom) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.locator('#quickBookOverlay .qb-modal').first().screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

// Bowling 17:00, le laser ajoute (il se pose juste apres), le minigolf : trois activites, 6 joueurs.
async function troisActivites(page) {
  await page.locator('.btn-new').first().click();
  await page.waitForSelector('#quickBookOverlay .qb-modal.rv.rs', { timeout: 8000 });
  await page.click('#quickBookOverlay [data-pax="6"]');
  await page.click('#quickBookOverlay #rsZ-bowling [data-heure="17:00"]');
  await planPose(page);
  await page.click('#quickBookOverlay #rsAjout-laser_game');
  await planPose(page);
  await page.click(`#quickBookOverlay #rsT-${MINIGOLF}`);
  await planPose(page);
  return page.evaluate(lire);
}

async function heureMinigolf(page, heure) {
  if (!(await page.evaluate(() => document.getElementById('rsHA-minigolf_blacklight')))) await page.click(`#quickBookOverlay #rsHB-${MINIGOLF}`);
  await planPose(page);
  const ouvert = await page.evaluate(lire);
  await page.click(`#rsHA-${MINIGOLF} [data-heure-l="${heure}"]`);
  await planPose(page);
  return ouvert;
}

const SUIT = /décale le|Déplacé de|à la suite/;

async function scenarioSansSuivre(browser) {
  const { ctx, page, erreurs, posts } = await monterConsole(browser);
  try {
    const a = await troisActivites(page);
    ok(a.ordre === `bowling,laser_game,${MINIGOLF}` && a.heures.bowling === '17:00' && a.heures.laser_game === '18:00' && a.heures[MINIGOLF] === '',
      '[H1] le depart : bowling 17:00, le laser juste apres (18:00), le minigolf libre', a);
    ok(/^reste \d/.test(a.bowling['23:00'] || ''), '[H1] la touche 23:00 du bowling le propose (le laser ne le suit plus : jamais « trop tard »)', a.bowling);
    await page.click('#quickBookOverlay #rsZ-bowling [data-heure="23:00"]');
    await planPose(page);
    const b = await page.evaluate(lire);
    ok(b.heures.bowling === '23:00' && b.heures.laser_game === '18:00' && b.heures[MINIGOLF] === '' && b.ordre === `laser_game,bowling,${MINIGOLF}`,
      '[H1] le bowling a 23:00 : le laser reste a 18:00, le minigolf libre, l ordre suit les heures', { heures: b.heures, ordre: b.ordre });
    await page.click('#quickBookOverlay #rsZ-laser_game [data-heure="20:00"]');
    await planPose(page);
    const c = await page.evaluate(lire);
    ok(c.heures.laser_game === '20:00' && c.heures.bowling === '23:00' && c.heures[MINIGOLF] === '', '[H1] le laser a 20:00 : le bowling reste a 23:00', c.heures);
    const ouvert = await heureMinigolf(page, '21:00');
    ok(ouvert.panneau > 0 && ouvert.panneauHeures[0] === 'Libre*' && ouvert.panneauHeures.includes('21:00'),
      '[H1] le bouton d heure du minigolf ouvre ses demi-heures juste dessous (visibles), « Libre » d abord', { panneau: ouvert.panneau, heures: ouvert.panneauHeures.slice(0, 6) });
    const d = await page.evaluate(lire);
    ok(d.heures[MINIGOLF] === '21:00' && d.heures.laser_game === '20:00' && d.heures.bowling === '23:00' && d.ordre === `laser_game,${MINIGOLF},bowling` && d.bouton === '21:00',
      '[H1] le minigolf a 21:00 : le laser et le bowling restent, son bouton dit 21:00', { heures: d.heures, ordre: d.ordre, bouton: d.bouton });
    ok(!SUIT.test(d.ecran) && /23:00 à 24:00/.test(d.lignes.bowling) && /21:00/.test(d.lignes[MINIGOLF]) && /20:00/.test(d.lignes.laser_game),
      '[H1] le ticket dit chaque heure, sans « décale le », « Déplacé de » ni « à la suite »', d.lignes);
    await photo(page, 'heure-activite-sans-suivre');
    // [H2] « Créer » : le corps et le dossier.
    const avant = [...B.base.reservations.keys()];
    await page.fill('#quickBookOverlay #qbPhone', '0470 11 22 33');
    await page.fill('#quickBookOverlay #qbName', 'Famille Tard').catch(() => null);
    await planPose(page);
    const nPosts = posts.length;
    await page.click('#quickBookOverlay #rvCreer');
    for (let i = 0; i < 60; i += 1) { await page.waitForTimeout(150); if (posts.slice(nPosts).some((p) => !p.dryRun)) break; }
    await page.waitForTimeout(600);
    const envoye = posts.slice(nPosts).find((p) => !p.dryRun) || {};
    const pref = envoye.preference || {};
    ok(envoye.startTime === '20:00' && JSON.stringify(pref.preferredTimes) === '{"laser_game":"20:00","bowling":"23:00"}' && JSON.stringify(envoye.heuresPosees) === '{"minigolf_blacklight":"21:00"}',
      '[H2] le corps de « Créer » : arrivee 20:00, laser 20:00, bowling 23:00, minigolf pose a 21:00', { startTime: envoye.startTime, preferredTimes: pref.preferredTimes, heuresPosees: envoye.heuresPosees });
    const cree = [...B.base.reservations.keys()].filter((id) => !avant.includes(id));
    const base = cree.length === 1 ? planEnBase(cree[0]) : null;
    const h = base ? heuresEnBase(base.plan) : {};
    ok(base && h.laser_game === '20:00' && h[MINIGOLF] === '21:00 posee' && h.bowling === '23:00',
      '[H2] le dossier cree a ces heures : laser 20:00, minigolf 21:00 (pose), bowling 23:00', { cree, heures: h });
    ok(!erreurs.length, '[J1] aucune erreur JS (sans suivre)', erreurs.slice(0, 3));
  } finally { await ctx.close(); }
}

async function scenarioChevauchement(browser) {
  const { ctx, page, erreurs, posts } = await monterConsole(browser);
  try {
    await troisActivites(page);
    await page.click('#quickBookOverlay #rsZ-bowling [data-heure="23:00"]');
    await planPose(page);
    const a = await page.evaluate(lire);
    // (la visite finit avec le bowling de 23:00, pas a l arrivee plus la somme des durees : 22:00 tient)
    ok(/^reste \d/.test(a.laser['22:00'] || '') && /^reste \d/.test(a.laser['22:30'] || ''),
      '[H1] les touches 22:00 et 22:30 du laser disent ce qui reste, jamais « trop tard » (le bowling de 23:00 finit la visite)', { '22:00': a.laser['22:00'], '22:30': a.laser['22:30'] });
    ok(a.laser['23:00'] === 'pendant le bowling' && a.laser['23:30'] === 'pendant le bowling' && !SUIT.test(a.ecran),
      '[H3] les touches 23:00 et 23:30 du laser disent « pendant le bowling », jamais « décale le bowling »', { '23:00': a.laser['23:00'], '23:30': a.laser['23:30'] });
    await page.click('#quickBookOverlay #rsZ-laser_game [data-heure="23:00"]');
    await planPose(page);
    const b = await page.evaluate(lire);
    ok(b.heures.laser_game === '23:00' && b.heures.bowling === '23:00' && !SUIT.test(b.ecran), '[H3] le laser se prend a 23:00, le bowling reste a 23:00 : rien n est deplace', { heures: b.heures });
    ok(/en même temps que le laser de 23:00 à 23:30/.test(b.lignes.bowling) && /en même temps que le bowling de 23:00 à 24:00/.test(b.lignes.laser_game),
      '[H3] les deux lignes du ticket disent le chevauchement', b.lignes);
    ok(b.creer && b.creer.bloque && b.creer.texte === 'Deux heures se chevauchent' && !b.forcer && !b.aPlacer,
      '[H3] « Créer » attend (« Deux heures se chevauchent »), sans « Créer quand même, à placer » : le dossier ne part pas « à placer »', { creer: b.creer, forcer: b.forcer, aPlacer: b.aPlacer });
    await photo(page, 'heure-activite-chevauchement');
    await page.fill('#quickBookOverlay #qbPhone', '0470 11 22 33');
    const nPosts = posts.length;
    await page.click('#quickBookOverlay #rvCreer');
    await planPose(page);
    const c = await page.evaluate(lire);
    ok(!posts.slice(nPosts).some((p) => !p.dryRun) && c.heures.laser_game === '23:00' && c.heures.bowling === '23:00',
      '[H3] toucher « Créer » ne cree rien et ne deplace rien', { creations: posts.slice(nPosts).filter((p) => !p.dryRun).length, heures: c.heures });
    // Le staff change une des deux : tout redevient possible.
    await page.click('#quickBookOverlay #rsZ-laser_game [data-heure="20:00"]');
    await planPose(page);
    const d = await page.evaluate(lire);
    ok(d.heures.laser_game === '20:00' && d.heures.bowling === '23:00' && d.creer && !d.creer.bloque && /^Créer à 20:00/.test(d.creer.texte),
      '[H3] le laser remis a 20:00 : « Créer à 20:00 » revient, le bowling n a pas bouge', { heures: d.heures, creer: d.creer });
    // [H4] « Libre » rend l heure au moteur.
    await heureMinigolf(page, '21:00');
    const e = await page.evaluate(lire);
    await heureMinigolf(page, '');
    const f = await page.evaluate(lire);
    const dernier = posts.filter((p) => p.dryRun && !p.candidats).pop() || {};
    ok(e.heures[MINIGOLF] === '21:00' && f.heures[MINIGOLF] === '' && f.posees === '{}' && !dernier.heuresPosees && f.bouton === 'Libre' && /accès libre pendant la visite/.test(f.lignes[MINIGOLF])
      && f.heures.laser_game === '20:00' && f.heures.bowling === '23:00',
    '[H4] « Libre » : le minigolf repart libre, son heure ne part plus, le ticket dit « accès libre pendant la visite », les autres restent', { avant: e.heures[MINIGOLF], heures: f.heures, posees: f.posees, envoye: dernier.heuresPosees, bouton: f.bouton, ligne: f.lignes[MINIGOLF] });
    // [H5] La plus tot porte l arrivee, et part posee.
    await heureMinigolf(page, '19:00');
    const g = await page.evaluate(lire);
    const corpsG = posts.filter((p) => p.dryRun && !p.candidats).pop() || {};
    ok(g.ordre === `${MINIGOLF},laser_game,bowling` && g.heures[MINIGOLF] === '19:00' && g.heures.laser_game === '20:00' && g.heures.bowling === '23:00' && corpsG.startTime === '19:00' && JSON.stringify(corpsG.heuresPosees) === '{"minigolf_blacklight":"19:00"}',
      '[H5] le minigolf a 19:00 passe en tete (l arrivee) et son heure part posee ; le laser et le bowling restent', { ordre: g.ordre, heures: g.heures, startTime: corpsG.startTime, heuresPosees: corpsG.heuresPosees });
    await photo(page, 'heure-activite-minigolf-en-tete');
    const avant = [...B.base.reservations.keys()];
    await page.fill('#quickBookOverlay #qbName', 'Famille Tot').catch(() => null);
    await planPose(page);
    const n2 = posts.length;
    await page.click('#quickBookOverlay #rvCreer');
    for (let i = 0; i < 60; i += 1) { await page.waitForTimeout(150); if (posts.slice(n2).some((p) => !p.dryRun)) break; }
    await page.waitForTimeout(600);
    const cree = [...B.base.reservations.keys()].filter((id) => !avant.includes(id));
    const h = cree.length === 1 ? heuresEnBase(planEnBase(cree[0]).plan) : {};
    ok(h[MINIGOLF] === '19:00 posee' && h.laser_game === '20:00' && h.bowling === '23:00', '[H5] le dossier cree a le minigolf a 19:00, le laser a 20:00, le bowling a 23:00', { cree, heures: h });
    ok(!erreurs.length, '[J1] aucune erreur JS (chevauchement)', erreurs.slice(0, 3));
  } finally { await ctx.close(); }
}

const SERVEUR = ['serveur'];
const SANS_SUIVRE = ['sans-suivre'];
const CHEVAUCHEMENT = ['chevauchement'];
const MUTATIONS = [
  { nom: 'heure-fait-suivre', lettre: 'H1', scenarios: SANS_SUIVRE, editions: [{ fichier: JS, de: 'function rvHeureSansSuivre(id, heure) {\n  const s = quickBookState;\n', vers: 'function rvHeureSansSuivre(id, heure) {\n  const s = null;\n' }] },
  { nom: 'touche-essayee-en-suivant', lettre: 'H1', scenarios: SANS_SUIVRE, editions: [{ fichier: JS, de: '    } else if (rvHeureSansSuivre(id, heure)) {\n      // (l heure essayee comme le toucher la prendra : rien ne suit)\n', vers: '    } else if (false) {\n' }] },
  { nom: 'moteur-accepte-le-chevauchement', lettre: 'H3', scenarios: SERVEUR, editions: [{ fichier: 'lib/ops-engine.js', serveur: true, de: '    if (current.start < previous.end) {\n      return {\n        ok: false,\n        code: \'anchor_overlap\',', vers: '    if (false) {\n      return {\n        ok: false,\n        code: \'anchor_overlap\',' }] },
  { nom: 'posees-ignorees-au-serveur', lettre: 'H2', scenarios: SANS_SUIVRE, editions: [{ fichier: FENETRE, serveur: true, de: '  if (aPoser.length && dossier.opsPlan && ops.planAvailable !== false) {', vers: '  if (false) {' }] },
  { nom: 'chevauchement-muet', lettre: 'H3', scenarios: CHEVAUCHEMENT, editions: [{ fichier: JS, de: '  if (!quickBookState || ids.length < 2 || !rvModifiable()) return res;\n  const lignes = rvHeuresDesLignes(ids);\n  const plages = [];', vers: '  return res;\n  const lignes = rvHeuresDesLignes(ids);\n  const plages = [];' }] },
  { nom: 'creer-sans-attendre', lettre: 'H3', scenarios: CHEVAUCHEMENT, editions: [{ fichier: JS, de: '  const bloque = Boolean(chevauche) || (refuse', vers: '  const bloque = (refuse' }] },
  { nom: 'chevauchement-refuse-au-toucher', lettre: 'H3', scenarios: CHEVAUCHEMENT, editions: [{ fichier: JS, de: '  const pendant = x ? rsPendant(id, heure) : null;\n', vers: '  const pendant = null;\n' }] },
  { nom: 'libre-garde-l-heure', lettre: 'H4', scenarios: CHEVAUCHEMENT, editions: [{ fichier: JS, de: '    } else if (heures[x]) posees[x] = heures[x];\n    else delete posees[x];\n', vers: '    } else if (heures[x]) posees[x] = heures[x];\n' }] },
  { nom: 'fin-par-la-somme', lettre: 'H1', scenarios: CHEVAUCHEMENT, editions: [{ fichier: JS, de: '  if (aHeure.length < 2) return annoncee;\n', vers: '  return annoncee;\n' }] },
  { nom: 'tete-pas-envoyee', lettre: 'H5', scenarios: CHEVAUCHEMENT, editions: [{ fichier: JS, de: ' && (rvPosable(id) || id === tete)) posees[id] = heure;', vers: ' && rvPosable(id)) posees[id] = heure;' }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'serveur') await scenarioServeur();
    if (nom === 'sans-suivre') await scenarioSansSuivre(browser);
    if (nom === 'chevauchement') await scenarioChevauchement(browser);
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, (liste(process.env.HA_SCENARIOS) || ['serveur', 'sans-suivre', 'chevauchement']));
    } else {
      console.log('[K] contre-preuves : chaque garde retiree est montable, puis ce gate ROUGIRAIT sur sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.HA_MUTATIONS || liste(process.env.HA_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : montable (chaque ancre existe une fois et une seule)`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.HA_BAVARD;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `[K] mutation ${m.nom} : ce gate ROUGIRAIT ([${m.lettre}] rougit)`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveurHttp.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nreserver-heure-activite-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nreserver-heure-activite-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

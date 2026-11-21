// RESERVER : L HEURE DE CHAQUE ACTIVITE D UNE FORMULE, SUR SA CASE, JUGEE COMME UN SEUL JEU FINAL (2026-11-21).
//
// Le gerant, sur la fenetre Reserver, 10 joueurs, Formule 1 : « pour les formules, c'est trop une galère de
// trouver l'endroit pour modifier les horaires des activités, mets-le direct sur l'endroit principal », puis
// « ça calcule mal : il me dit que les résas se chevauchent alors que non ». Sa capture : le Contenu (« 1h de
// Bowling », « 1 partie Laser Game », « 30 min arcades », « 2 cruches boissons »), une rangee « Heures » a part
// (« Laser 17:00 », « Bowling 16:00 », « Arcades 17:30 », « à la main ») et le ticket en rouge : « Ce
// déplacement chevauche le Laser Game du groupe, de 16:00 à 16:25 ». Le bowling de 16:00 a 17:00 finit quand le
// laser de 17:00 commence : rien ne se chevauche. Le serveur posait les heures une a une, et jugeait le bowling
// contre le laser encore a sa place du moteur (16:00, la Formule 1 partant a 14:30).
//
// La vraie console (scripts/planning-v3-fixtures.js, journee « pic », samedi 16 janvier 2027 a 15:10), de vrais
// clics ; ses POST (le plan a blanc, les heures verifiees, la creation) partent au VRAI handler
// api/staff-reservations.js, au vrai moteur et a la vraie lib/database.js, sur la base en memoire de
// scripts/reserver-banc.js : aucune base reelle, aucun reseau, aucun mail ne part.
//   [C1] Reserver, 10 joueurs, le samedi suivant, Formule 1 a 14:30 : sur sa page, chaque case du Contenu qui
//        nomme une activite a heure (le bowling, le laser, les arcades) porte l heure de son activite, celle
//        du planning ; les boissons n en ont pas ; la rangee « Heures » a part n existe plus ;
//   [H1] toucher la case du bowling ouvre ses demi-heures juste sous le Contenu ; 16:00 se pose d un toucher,
//        puis le laser a 17:00 et les arcades a 17:30 : chaque case dit son heure « à la main », aucun message
//        de chevauchement (ticket, resume, panneau), « Créer » est actif, et le plan du serveur tient avec le
//        bowling a 16:00 et le laser a 17:00 ;
//   [H2] un vrai chevauchement : le laser pose a 16:30 sur le bowling de 16:00 a 17:00. Le ticket nomme les
//        bonnes heures (« Laser à 16:30 », « de 16:00 à 17:00 »), la case du laser passe en rouge, « Créer »
//        est bloque ;
//   [H3] LA VRAIE DUREE (le gerant : « les arcades d'une formule durent ce que dit son contenu ») : les
//        arcades « 30 min » posees a 17:30, le laser a 17:45 les chevauche (dit avec ses heures, « Créer »
//        bloque), le laser a 18:00 ne chevauche rien ; les arcades rendues au planning (15:30 a 16:00)
//        comptent aussi : le laser a 15:30 les chevauche ;
//   [C2] le laser remis a 17:00, « Créer » : le corps porte les trois heures posees et le dossier cree les a
//        dans son plan (bowling 16:00, laser 17:00, arcades 17:30) ;
//   [A1] des arcades vendues en argent (Formule 6, « 8 crédits d'arcade (8€) par enfant ») sont libres : pas
//        d heure sur leur case, rien ne s y pose ; la duree des arcades est celle du contenu (30 min, 1 h) ;
//   [T3] « Adapter à ce groupe » dit vrai : un ajout se paie a son prix, plus « même prix » ;
//   [J1] aucune erreur JS.
// --contre-preuves : chaque regle retiree (au code servi ou au serveur, en memoire ; le disque n est jamais
// touche) fait rougir sa lettre : le chevauchement calcule contre l ancienne place (au serveur, puis au
// toucher), l heure absente de la case, la rangee « Heures » revenue, le refus sans l heure posee, « même
// prix » promis.
//   NHF_PORT : le port du site servi (6900 a 6999) ; NHF_CAPTURES : le dossier des captures (captures-nuit) ;
//   NHF_APPAREIL=telephone : au telephone ; NHF_MUTATIONS : un sous-ensemble (noms separes par des virgules) ; NHF_BAVARD : le detail.
'use strict';
const PORT = Number(process.env.NHF_PORT || 6910);
// NHF_APPAREIL=telephone : le meme scenario au telephone (375 px), ses captures suffixees.
const APPAREIL = process.env.NHF_APPAREIL === 'telephone' ? 'telephone' : 'ordinateur';
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

// La base en memoire et le faux 'pg' s installent au require, avant tout module de lib/.
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = process.env.NHF_CAPTURES || path.join(ROOT, 'captures-nuit');
const JS = 'assets/app-main.js';
const POSEES = 'lib/heures-posees.js';
const MOVE = 'lib/reservation-activity-move.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);
const memes = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
let mutation = null;
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel && !ed.serveur) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// LE BANC : la journee de la fixture en base ; le dossier se cree le samedi suivant, un jour sans vacances ou
// la Formule 1 se vend. A 14:30, le moteur place le bowling a 14:30, les arcades a 15:30, le laser a 16:00.
// ---------------------------------------------------------------------------
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
const JOUR_RESA = (() => { const d = new Date(`${JOUR}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
const PAX = 10;
const DEPART = '14:30';
const VOULUES = { bowling: '16:00', laser_game: '17:00', arcade_time: '17:30' };
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
// Le plan du dossier en base : la premiere heure de chaque activite.
function enBase(id) {
  const r = require(path.join(ROOT, 'lib/database.js')).mapReservation(B.base.reservations.get(Number(id)));
  const plan = r.opsPlan || {};
  const hm = (x) => String((x && x.startTime) || '').slice(0, 5);
  const premiere = (liste) => liste.map(hm).filter(Boolean).sort()[0] || '';
  return {
    formuleId: r.formuleId || '',
    bowling: premiere((plan.resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane')),
    laser: premiere((plan.resourceBlocks || []).filter((b) => b.resourceType === 'laser_arena')),
    arcades: premiere((plan.timeline || []).filter((e) => e.activityId === 'arcade_time' && e.flexible !== true)),
  };
}

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
async function monter(browser, serveur) {
  const posts = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil: APPAREIL, theme: 'light', port: PORT, heure: '15:10',
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => serveur.appeler('PATCH', '/api/staff-reservations', corps));
      await page.exposeFunction('__fixtureBlanc', async (corps) => { posts.push(corps); return serveur.appeler('POST', '/api/staff-reservations', corps); });
    },
  });
  return { ...m, posts };
}
async function planPose(page) {
  await page.waitForTimeout(350);
  await page.waitForFunction(() => quickBookState && quickBookState.plan && quickBookState.plan.etat !== 'calcul' && quickBookState.plan.cle === quickBookState.cleCourante, null, { timeout: 15000 }).catch(() => null);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#quickBookOverlay [data-verifie]')).every((n) => n.dataset.verifie === '1'), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(250);
}
// La page de la formule et le ticket, tels qu ils se lisent.
function lire() {
  const o = document.getElementById('quickBookOverlay');
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const rangs = Array.from(o.querySelectorAll('.rs-rangs > .rs-rang'));
  const contenu = o.querySelector('.rs-rang.is-contenu');
  const panneau = o.querySelector('[data-heures-act]');
  const creer = document.getElementById('rvCreer');
  const plan = rvPlanCourant();
  return {
    cases: Array.from((contenu || o).querySelectorAll('.rs-contenu li')).map((li) => {
      const b = li.querySelector('[data-heure-formule]');
      return { texte: t(li.querySelector('.rs-cc-t') || li), id: b ? b.dataset.heureFormule : '', heure: t(li.querySelector('.rs-cc-h b')), sous: t(li.querySelector('.rs-cc small')), ko: Boolean(b && b.classList.contains('is-ko')) };
    }),
    etiquettes: rangs.map((r) => t(r.querySelector('.rs-lbl'))),
    // (le panneau ouvert : juste sous le Contenu, le rang qui suit)
    panneau: panneau ? { id: panneau.dataset.heuresAct, sousLeContenu: Boolean(contenu && contenu.nextElementSibling && contenu.nextElementSibling.contains(panneau)), vu: panneau.getClientRects().length > 0 } : null,
    adapter: t(document.getElementById('rvAdapter')),
    ticket: Array.from(o.querySelectorAll('.rs-tk-a')).map(t).join(' | '),
    formule: t(document.getElementById('rsL-a-formule')),
    resume: t(document.getElementById('rsResume')),
    phrases: Array.from(o.querySelectorAll('.rs-heure-refus')).map(t),
    posees: { ...(quickBookState.heuresPosees || {}) },
    creer: creer ? { texte: t(creer).replace(/Entrée$/, '').trim(), bloque: creer.classList.contains('is-bloque'), pret: creer.dataset.pret === '1' } : null,
    plan: plan ? { disponible: plan.disponible, refus: plan.refus || '', heureRefusee: plan.heureRefusee || null, blocs: (plan.blocs || []).map((b) => `${b.activite} ${b.debut}`) } : null,
  };
}
async function photo(page, nom, selecteur = '#quickBookOverlay .qb-modal') {
  if (mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  const cadre = page.locator(selecteur).first();
  const fichier = path.join(CAPTURES, `${nom}${APPAREIL === 'telephone' ? '-telephone' : ''}.png`);
  if (await cadre.count()) await cadre.screenshot({ path: fichier });
  else await page.screenshot({ path: fichier });
}
// Toucher la case d une activite, puis l heure voulue dans ses demi-heures (ouvertes sous le Contenu). Une
// heure qui n est pas une touche (17:45, entre deux demi-heures) se pose par le geste de la touche
// (rsHeureAct), le panneau ouvert par le vrai clic.
async function poser(page, id, heure) {
  await page.click(`#quickBookOverlay [data-heure-formule="${id}"]`);
  await page.waitForSelector(`#quickBookOverlay [data-heures-act="${id}"]`, { timeout: 8000 });
  await planPose(page);
  const panneau = await page.evaluate(lire);
  const touche = `#quickBookOverlay [data-heures-act="${id}"] [data-heure-l="${heure}"]`;
  if (await page.locator(touche).count()) await page.click(touche);
  else await page.evaluate(([a, h]) => rsHeureAct(a, h), [id, heure]);
  await planPose(page);
  return panneau.panneau;
}

// ---------------------------------------------------------------------------
// LE SCENARIO.
// ---------------------------------------------------------------------------
const CHEVAUCHE = /chevauch|en même temps|se chevauchent/i;
async function scenario(browser) {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs, posts } = await monter(browser, serveur);
  try {
    // Reserver, 10 joueurs, le samedi suivant, la Formule 1 a 14:30, puis sa page (la ligne du ticket).
    await page.locator('.btn-new').first().click();
    await page.waitForSelector('#quickBookOverlay .qb-modal.rv.rs', { timeout: 8000 });
    await page.click(`#quickBookOverlay [data-pax="${PAX}"]`);
    await planPose(page);
    await page.click('#quickBookOverlay #rsFormules');
    await page.click(`#quickBookOverlay [data-jour="${JOUR_RESA}"]`);
    await page.waitForFunction((j) => quickBookState && quickBookState.date === j, JOUR_RESA, { timeout: 8000 });
    await page.click('#quickBookOverlay [data-formule="f1"]');
    await page.waitForSelector('#quickBookOverlay #rsL-a-formule', { state: 'attached', timeout: 8000 });
    await planPose(page);
    await page.click(`#quickBookOverlay .rs-s-l.is-formule [data-heure="${DEPART}"]`);
    await planPose(page);
    // (au telephone, le ticket se deplie d abord : sa ligne est sous la barre du bas)
    if (!(await page.locator('#quickBookOverlay #rsL-a-formule').isVisible())) await page.click('#quickBookOverlay #rsResume');
    await page.click('#quickBookOverlay #rsL-a-formule');
    await page.waitForSelector('#quickBookOverlay .rs-rang.is-contenu', { timeout: 8000 });
    await planPose(page);

    // [C1] Les cases du Contenu portent l heure de leur activite.
    const a = await page.evaluate(lire);
    const casse = (id) => a.cases.find((c) => c.id === id) || {};
    const boissons = a.cases.find((c) => /cruche|boisson/i.test(c.texte)) || null;
    ok(/Bowling/.test(casse('bowling').texte || '') && /Laser/.test(casse('laser_game').texte || '') && /arcade/i.test(casse('arcade_time').texte || '')
      && ['bowling', 'laser_game', 'arcade_time'].every((id) => /^\d{2}:\d{2}$/.test(casse(id).heure || '') && casse(id).sous === 'proposée'),
    '[C1] chaque case du Contenu qui nomme une activite a heure porte son heure, celle du planning (« proposée »)', a.cases);
    ok(Boolean(boissons) && !boissons.id && !boissons.heure, '[C1] la case des boissons n a pas d heure a choisir', boissons);
    ok(!a.etiquettes.includes('Heures'), '[C1] la rangee « Heures » a part n existe plus', a.etiquettes);

    // [T3] « Adapter à ce groupe » dit vrai.
    ok(/^Adapter à ce groupe/.test(a.adapter) && /un ajout se paie à son prix/.test(a.adapter) && !/même prix/i.test(a.adapter), '[T3] « Adapter à ce groupe » dit qu un ajout se paie a son prix, plus « même prix »', a.adapter);

    // [H1] Les trois heures du gerant, une case touchee a la fois.
    const p1 = await poser(page, 'bowling', VOULUES.bowling);
    ok(Boolean(p1) && p1.id === 'bowling' && p1.sousLeContenu && p1.vu, '[H1] toucher la case du bowling ouvre ses demi-heures juste sous le Contenu', p1);
    await poser(page, 'laser_game', VOULUES.laser_game);
    await poser(page, 'arcade_time', VOULUES.arcade_time);
    const h = await page.evaluate(lire);
    const hc = (id) => h.cases.find((c) => c.id === id) || {};
    ok(Object.entries(VOULUES).every(([id, heure]) => hc(id).heure === heure && hc(id).sous === 'à la main' && !hc(id).ko) && memes(h.posees, VOULUES),
      '[H1] chaque case dit l heure posee « à la main » : bowling 16:00, laser 17:00, arcades 17:30 ; rien d autre n a bouge', { cases: h.cases, posees: h.posees });
    ok(!CHEVAUCHE.test(h.ticket) && !CHEVAUCHE.test(h.resume) && !h.phrases.some((x) => CHEVAUCHE.test(x)) && !h.cases.some((c) => c.ko),
      '[H1] aucun message de chevauchement : ni au ticket, ni au resume, ni sous les heures', { ticket: h.ticket, resume: h.resume, phrases: h.phrases });
    ok(Boolean(h.creer) && !h.creer.bloque && h.creer.pret && /^Créer/.test(h.creer.texte), '[H1] « Créer » est actif', h.creer);
    ok(Boolean(h.plan) && h.plan.disponible === true && h.plan.blocs.includes('bowling 16:00') && h.plan.blocs.includes('laser_game 17:00'),
      '[H1] le plan du serveur tient : le bowling a 16:00, le laser a 17:00', h.plan);
    await photo(page, 'formule-heures-sur-les-cases');

    // [H2] Le vrai chevauchement : le laser a 16:30, sur le bowling de 16:00 a 17:00.
    await poser(page, 'laser_game', '16:30');
    const c = await page.evaluate(lire);
    ok(/Laser à 16:30/.test(c.formule) && /chevauche le Bowling du groupe, de 16:00 à 17:00/.test(c.formule),
      '[H2] le ticket nomme les bonnes heures : le laser a 16:30 contre le bowling de 16:00 a 17:00', c.formule);
    ok(Boolean(c.plan) && c.plan.disponible === false && Boolean(c.plan.heureRefusee) && c.plan.heureRefusee.activite === 'laser_game' && c.plan.heureRefusee.heure === '16:30',
      '[H2] le serveur refuse le laser de 16:30, pas le bowling', c.plan);
    ok((c.cases.find((x) => x.id === 'laser_game') || {}).ko && !(c.cases.find((x) => x.id === 'bowling') || {}).ko, '[H2] la case du laser passe en rouge, celle du bowling non', c.cases);
    ok(Boolean(c.creer) && c.creer.bloque && !c.creer.pret, '[H2] « Créer » est bloque', c.creer);
    await photo(page, 'formule-vrai-chevauchement');

    // [H3] LA VRAIE DUREE DES ARCADES : celle du contenu, « 30 min arcades ». Les arcades a 17:30 durent
    // jusqu a 18:00 : le laser a 17:45 les chevauche, celui de 18:00 non.
    await poser(page, 'laser_game', '17:45');
    const d = await page.evaluate(lire);
    ok(Boolean(d.plan) && d.plan.disponible === false && /chevauche/.test(d.formule) && /17:30/.test(d.formule) && /17:45/.test(d.formule) && Boolean(d.creer) && d.creer.bloque,
      '[H3] arcades 30 min a 17:30, laser a 17:45 : un vrai chevauchement, dit avec ses heures, « Créer » bloque', { formule: d.formule, plan: d.plan, creer: d.creer });
    await poser(page, 'laser_game', '18:00');
    const e = await page.evaluate(lire);
    ok(Boolean(e.plan) && e.plan.disponible === true && !CHEVAUCHE.test(e.ticket) && !e.cases.some((x) => x.ko) && Boolean(e.creer) && !e.creer.bloque && e.creer.pret,
      '[H3] le laser a 18:00, quand les arcades finissent : rien ne chevauche, « Créer » revient', { ticket: e.ticket, plan: e.plan, creer: e.creer });
    // Les arcades rendues au planning (« Auto », 15:30 a 16:00) comptent aussi, de leur vraie duree.
    await poser(page, 'arcade_time', '');
    await poser(page, 'laser_game', '15:30');
    const g = await page.evaluate(lire);
    ok(Boolean(g.plan) && g.plan.disponible === false && /Laser à 15:30/.test(g.formule) && /chevauche Arcades du groupe, de 15:30 à 16:00/.test(g.formule),
      '[H3] le laser pose a 15:30 sur les arcades laissees au planning (15:30 a 16:00) : le chevauchement se dit', { formule: g.formule, plan: g.plan });
    await poser(page, 'arcade_time', VOULUES.arcade_time);

    // [C2] Le laser remis a 17:00, « Créer ».
    await poser(page, 'laser_game', VOULUES.laser_game);
    const r = await page.evaluate(lire);
    ok(Boolean(r.creer) && !r.creer.bloque && r.creer.pret, '[C2] le laser remis a 17:00 : « Créer » revient', r.creer);
    const avant = new Set(B.base.reservations.keys());
    if (!(await page.locator('#quickBookOverlay #qbPhone').isVisible())) await page.click('#quickBookOverlay #rsResume');
    await page.fill('#quickBookOverlay #qbPhone', '0470 21 11 26');
    await planPose(page);
    const n = posts.length;
    await page.click('#quickBookOverlay #rvCreer');
    for (let i = 0; i < 80; i += 1) { await page.waitForTimeout(150); if (posts.slice(n).some((p) => !p.dryRun)) break; }
    let ids = [];
    for (let i = 0; i < 40; i += 1) { ids = [...B.base.reservations.keys()].filter((id) => !avant.has(id)); if (ids.length) break; await page.waitForTimeout(150); }
    const corps = posts.slice(n).find((p) => !p.dryRun) || {};
    ok(memes(corps.heuresPosees, VOULUES) && corps.formuleId === 'f1', '[C2] le corps de « Créer » porte les trois heures posees', { formuleId: corps.formuleId, heuresPosees: corps.heuresPosees });
    const b = ids.length === 1 ? enBase(ids[0]) : {};
    ok(ids.length === 1 && b.formuleId === 'f1' && b.bowling === '16:00' && b.laser === '17:00' && b.arcades === '17:30',
      '[C2] le dossier cree garde la Formule 1, et son plan a le bowling a 16:00, le laser a 17:00, les arcades a 17:30', { ids, b });

    // [A1] Des arcades vendues en argent (Formule 6 : « 8 crédits d'arcade (8€) par enfant ») sont libres : pas
    // d heure sur leur case, aucune heure posee. Et la duree des arcades d une formule est celle de son contenu.
    await page.evaluate(() => { closeQuickBook(); });
    await page.evaluate(() => openQuickBook({ date: state.currentDate, type: 'formule' }));
    await page.waitForSelector('#quickBookOverlay .qb-modal.rv.rs', { timeout: 8000 });
    await page.click(`#quickBookOverlay [data-pax="${PAX}"]`);
    await page.evaluate(() => { rvChoisirFormule('f6'); rsOuvrirLigne('formule'); });
    await page.waitForSelector('#quickBookOverlay .rs-rang.is-contenu', { timeout: 8000 });
    const f6 = { cases: (await page.evaluate(lire)).cases, ...(await page.evaluate(() => ({ posable: rvPosable('arcade_time'), envoyees: rvHeuresPoseesEnvoyees() }))) };
    const credits = f6.cases.find((x) => /crédits? d.arcade/i.test(x.texte)) || null;
    ok(Boolean(credits) && !credits.id && !credits.heure && f6.posable === false && f6.envoyees === null,
      '[A1] les arcades en credits de la Formule 6 : leur case n a pas d heure, rien ne s y pose', f6);
    const durees = await page.evaluate(() => {
      const garde = window.rvFormule;
      const duree = (desc) => { window.rvFormule = () => ({ id: 'essai', desc }); try { return rvMinutesActivite('arcade_time'); } finally { window.rvFormule = garde; } };
      return { trente: duree(['1h de Bowling', '30 min arcades']), heure: duree(['1h de Bowling', '1h d’Arcades']) };
    });
    ok(durees.trente === 30 && durees.heure === 60, '[A1] les arcades durent ce que dit le contenu : « 30 min arcades » 30 min, « 1h d’Arcades » 60 min', durees);
    ok(erreurs.length === 0, '[J1] aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  // Le chevauchement calcule contre l ancienne place, au serveur : chaque heure se juge contre les autres
  // encore a leur place du moteur (la regle d avant, le message de la capture).
  { nom: 'ancienne-place-au-serveur', lettre: 'H1', editions: [{ fichier: POSEES, serveur: true, de: '    const ensuite = bougent.slice(bougent.indexOf(posee.activityId) + 1);', vers: '    const ensuite = [];' }] },
  // ... et au toucher : l heure sur une autre activite encore a sa place ne se prend pas.
  { nom: 'ancienne-place-au-toucher', lettre: 'H1', editions: [{ fichier: JS, de: "  return Boolean(refus) && !rvModifiable() && refus.court === 'groupe occupé';", vers: '  return false;' }] },
  // L heure absente de la case du Contenu.
  { nom: 'heure-absente-de-la-case', lettre: 'C1', editions: [{ fichier: JS, de: '<span class="rs-cc-h">${RV_I.horloge}<b>${escapeHtml(heure || \'Auto\')}</b></span>', vers: '' }] },
  // La rangee « Heures » a part revient sous « Ce groupe ».
  { nom: 'rangee-heures-revenue', lettre: 'C1', editions: [{ fichier: JS, de: "  if (gestes.length) rangs.push(rsRang('Ce groupe', gestes.join(''), gestes.length));\n", vers: "  if (gestes.length) rangs.push(rsRang('Ce groupe', gestes.join(''), gestes.length));\n  rangs.push(rsRang('Heures', '', 1));\n" }] },
  // Le refus ne nomme pas l heure posee : « Ce déplacement chevauche le Bowling… » sans le laser de 16:30.
  { nom: 'refus-sans-heure-posee', lettre: 'H2', editions: [{ fichier: JS, de: "    const detail = ko ? rsPhrase(`${qui}${ko.d}`) : illimite", vers: '    const detail = ko ? rsPhrase(ko.d) : illimite' }] },
  // « Adapter à ce groupe » promet encore « même prix ».
  { nom: 'meme-prix-promis', lettre: 'T3', editions: [{ fichier: JS, de: "'retirer ou ajouter une activité, un ajout se paie à son prix'", vers: "'retirer ou ajouter une activité, même prix'" }] },
  // Le laser pose ne se juge plus contre les arcades laissees a leur heure (la regle d avant).
  { nom: 'arcades-ignorees-par-le-laser', lettre: 'H3', editions: [{ fichier: MOVE, serveur: true, de: ' || (toutLeJeu && !autre && jeuAHeure(block))', vers: '' }] },
  // Des arcades en credits recoivent une heure, comme des arcades au temps.
  { nom: 'arcades-en-argent-a-heure', lettre: 'A1', editions: [{ fichier: JS, de: '  if (rvArcadesEnArgent(id)) return false;\n', vers: '' }] },
  // La duree des arcades lue au catalogue, pas au contenu de la formule.
  { nom: 'duree-du-catalogue', lettre: 'A1', editions: [{ fichier: JS, de: '  if (contenu && contenu.minutes > 0) return contenu.minutes;\n', vers: '' }] },
];

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await scenario(browser);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.NHF_MUTATIONS || liste(process.env.NHF_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.NHF_BAVARD;
        try {
          await scenario(browser);
        // (un plantage n est pas une regle qui rougit : il se dit, et la contre-preuve reste a prouver)
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`plantage : ${e.message}`); }
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
  if (echecs) { console.error(`\nreserver-formule-heures-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nreserver-formule-heures-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

// LE COMPTOIR (2026-11-05, lots 1 a 3 de la fenetre Reserver).
//
// Ansar, sur la capture de la fenetre : « ça montre quand on prend un horaire combien de
// piste il va rester apres cette reservation pareil pour laser game », « ça montre si ya des
// pistes ou des armes laser qui sont en cours de reservation par les clients [...] ça montre
// et bloque vrm pdt les X temps », « choisir pour chaque activité le nombre de joueur
// separement et dcp ça decompte direct », « pouvoir mettre sur une seul piste mm si ils sont
// plus que 6 et ttout manuellement si on le desire ».
//
// Il joue la VRAIE console, le VRAI handler api/staff-reservations.js et le vrai moteur
// (scripts/comptoir-banc.js, base en memoire), le samedi 16 janvier 2027 a 15:10, et verifie
// le dossier CREE en base, jamais seulement l ecran.
//
//   [A] CE QUI RESTERA. Chaque heure dit ce qui reste apres ce groupe, recompte ici a part
//       sur la journee ; le groupe, la duree et les parties le font bouger tout de suite.
//   [B] LES RETENUES. La phrase, le temps qui descend, la jauge, et elles comptent vraiment :
//       ce poste ne les propose pas, le serveur les refuse, echues elles se rendent.
//   [C] LES JOUEURS PAR ACTIVITE. Pistes et armes suivent tout de suite, le dossier cree
//       porte les joueurs de chaque activite, le groupe grandit par une activite sans toucher
//       aux autres, une petite activite a les siens.
//   [D] LES PISTES A LA MAIN. Sept, puis vingt joueurs sur une piste, la fiche et le
//       glisser les gardent, le droit se juge au serveur, le formulaire public n y a pas droit.
//   [E] L ECRAN. Rien ne deborde, rien ne se coupe, tout tient sans defiler a 1366 x 768.
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en
// memoire, le disque n est jamais touche) et exige que chacune rougisse sa cible.
// `--seul=A,B` ne joue que ces lettres. Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const path = require('path');
const eclats = require('./gates-eclats.js');
const C = require('./comptoir-banc.js');
const { chromium } = require('playwright-core');

const { B, FX, ROOT, JOUR } = C;
const PORT = Number(process.env.PINLANE_COMPTOIR_PORT || 4961);
const CASSE = String(process.env.COMPTOIR_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };

const APP = 'assets/app-main.js';
const MUTATIONS = [
  { nom: 'reste-sans-le-groupe', lettre: 'A', cible: '[A] chaque heure du bowling dit ce qui reste apres le groupe', fichier: APP, de: 'const prend = Math.min(libres, voulu);\n  return { unite: \'piste\'', vers: 'const prend = 0;\n  return { unite: \'piste\'' },
  { nom: 'armes-sans-le-groupe', lettre: 'A', cible: '[A] chaque heure du laser dit ce qui reste apres le groupe', fichier: APP, de: 'const prend = Math.min(libres, voulu);\n        const place =', vers: 'const prend = 0;\n        const place =' },
  { nom: 'formule-sans-reste', lettre: 'A', cible: '[A] chaque heure d une formule dit ce qui reste', serveur: true, fichier: 'lib/reserver-simulation.js', de: "prend: verdict.statut === 'ko' ? [] : ceQuePrendLePlan(dossier.opsPlan) });", vers: 'prend: [] });' },
  { nom: 'jauge-absente', lettre: 'A', cible: '[A] la jauge compte une case par piste', fichier: APP, de: '${mot ? `<small>${escapeHtml(mot)}</small>` : \'\'}${rsJaugeHtml(x.place)}`;', vers: '${mot ? `<small>${escapeHtml(mot)}</small>` : \'\'}`;' },
  { nom: 'retenue-non-comptee-pistes', lettre: 'B', cible: '[B] une piste retenue ne compte pas comme libre', fichier: APP, de: '[...state.reservations, ...getBlocagesEnLigne(date)].forEach(r => {\n    if (r.id === ignoreId) return;', vers: 'state.reservations.forEach(r => {\n    if (r.id === ignoreId) return;' },
  { nom: 'retenue-non-comptee-laser', lettre: 'B', cible: '[B] les armes retenues ne comptent pas comme libres', fichier: APP, de: 'const laserWindowsForDate = () => [...state.reservations, ...getBlocagesEnLigne(date)]', vers: 'const laserWindowsForDate = () => state.reservations' },
  { nom: 'phrase-absente', lettre: 'B', cible: '[B] le bloc du bowling dit ce que le client retient', fichier: APP, de: '    ${rsRetenuesHtml(id)}\n  </section>`;', vers: '  </section>`;' },
  { nom: 'temps-fige', lettre: 'B', cible: '[B] le temps de la retenue descend a la seconde', fichier: APP, de: "    if (el.textContent !== texte) el.textContent = texte;\n", vers: '' },
  { nom: 'conseil-sur-le-groupe', lettre: 'C', cible: '[C] les pistes se recomptent tout de suite', fichier: APP, de: "function rvPistesConseillees() {\n  const joueurs = getQuickVisitParticipants('bowling');", vers: "function rvPistesConseillees() {\n  const joueurs = Number(quickBookState.pax) || 1;" },
  { nom: 'besoin-sur-le-groupe', lettre: 'C', cible: '[C] les joueurs du bowling font bouger ce qui reste', fichier: APP, de: "  const joueurs = getQuickVisitParticipants('bowling');\n  const plan = getBowlingCapacityPlan(Math.max(...splitGroupIntoBowlingServices(joueurs)), libres, duree * 60);", vers: "  const joueurs = Number(s.pax) || 1;\n  const plan = getBowlingCapacityPlan(Math.max(...splitGroupIntoBowlingServices(joueurs)), libres, duree * 60);" },
  { nom: 'autres-suivent-le-groupe', lettre: 'C', cible: '[C] le groupe grandit par une activite, les autres gardent le leur', fichier: APP, de: '      rsGarderLesJoueursDesAutres(id, groupe);\n', vers: '' },
  { nom: 'capacite-toujours-jugee', lettre: 'D', cible: '[D] 7 joueurs sur une piste, a la main', serveur: true, fichier: 'lib/bowling-allocation.js', de: 'let lanes = aLaMain\n    ? fixedLanes || allocate(Math.max(1, Number(requiredLanes) || 1))\n    : allocate(Math.max(normalLanesNeeded, Number(requiredLanes) || 0));', vers: 'aLaMain = false;\n  let lanes = allocate(Math.max(normalLanesNeeded, Number(requiredLanes) || 0));' },
  { nom: 'base-refuse-la-main', lettre: 'D', cible: '[D] 20 joueurs sur une piste, a la main', serveur: true, fichier: 'lib/database.js', de: '    if (block.pistesALaMain) continue;\n', vers: '' },
  { nom: 'formule-sans-pistes', lettre: 'D', cible: '[D] une formule avec bowling offre le reglage des pistes', fichier: APP, de: "${rvActivites().includes('bowling') && rsEtat().faits.combien ? rsCompteurPistesHtml() : ''}</div>", vers: '</div>' },
  { nom: 'droit-non-juge', lettre: 'D', cible: '[D] sans le niveau forcer, le serveur refuse', serveur: true, fichier: 'lib/reserver-fenetre.js', de: '    if (sousLeConseil(request, dossier)) exigerPistesALaMain(session);\n', vers: '' },
  { nom: 'public-garde-la-main', lettre: 'D', cible: '[D] le formulaire public n a pas droit aux pistes a la main', serveur: true, fichier: 'lib/reservation-request.js', de: '    delete request.pistesALaMain;\n', vers: '' },
  { nom: 'marque-perdue-au-patch', lettre: 'D', cible: '[D] une heure changee garde le dossier a la main', serveur: true, fichier: 'api/staff-reservations.js', de: "const poseApres = poseEnvoyee !== null ? poseEnvoyee : poseAvant && (Array.isArray(patch.lanes) ? patch.lanes.length : (current.lanes || []).length) || poseAvant;", vers: 'const poseApres = poseEnvoyee !== null ? poseEnvoyee : 0;' },
  { nom: 'glisser-rajoute-une-piste', lettre: 'D', cible: '[D] glisser la carte ne rajoute pas de piste', fichier: APP, de: "  const requiredCount = pistesALaMainDuDossier(reservation) ? currentLanes.length : Math.max(currentLanes.length, getBowlingCapacityPlan(Number(sourceWindow && sourceWindow.players) || getReservationActivityPlayers(reservation, 'bowling'), getFreeCount(reservation.date, startTime, duration, reservation.id), duration * 60).requiredCount);\n  const slotCheck = validateSlotWindow(reservation.date, startTime, duration, { allowPastStart: true });\n  if (!slotCheck.ok) {\n    showPlanningMoveNotice(", vers: "  const requiredCount = Math.max(currentLanes.length, getBowlingCapacityPlan(Number(sourceWindow && sourceWindow.players) || getReservationActivityPlayers(reservation, 'bowling'), getFreeCount(reservation.date, startTime, duration, reservation.id), duration * 60).requiredCount);\n  const slotCheck = validateSlotWindow(reservation.date, startTime, duration, { allowPastStart: true });\n  if (!slotCheck.ok) {\n    showPlanningMoveNotice(" },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}

const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
if (CASSE && !mutation) { console.error(`comptoir-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
const compteAncre = (m) => lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
if (mutation && compteAncre(mutation) !== 1) { console.error(`comptoir-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }
function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

const serveur = C.monterServeur({ mutations: mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [] });

// ---------------------------------------------------------------------------
// Lire l ecran, lire la base, recompter a part.
// ---------------------------------------------------------------------------
const RETENUES = [{ heure: '16:00', pistes: [6, 7], joueurs: 8, resteMinutes: 8, resteSecondes: 12 }, { heure: '16:30', laser: 12, resteMinutes: 4, resteSecondes: 40 }];
const ouvrir = (browser, options = {}) => C.ouvrirConsole(browser, serveur, { port: PORT, ...options });
const finir = async (m, quoi) => { ok(m.erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, m.erreurs.slice(0, 3).join(' | ')); await m.ctx.close(); };
const verifie = async (page, id) => { await page.waitForSelector(`#rsZ-${id} .rs-s-l[data-verifie="1"]`, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(150); };
const heures = (page, id) => page.evaluate((i) => [...document.querySelectorAll(`#rsZ-${i} .rs-h[data-heure]`)].map((b) => ({
  heure: b.dataset.heure,
  coince: b.classList.contains('is-coince') || b.classList.contains('is-ko'),
  mot: ((b.querySelector('small') || {}).textContent || '').trim(),
  tag: ((b.querySelector('.rs-h-tag') || {}).textContent || '').trim(),
  nom: b.getAttribute('aria-label') || '',
  cases: [...b.querySelectorAll('.rs-j i')].map((c) => [c.className, Number(c.style.flexGrow) || 1]),
})), id);
const creer = async (page, nom) => {
  await page.locator('#qbQui').fill(nom);
  await page.waitForTimeout(200);
  await page.locator('#rvCreer').click();
};
async function neufs(page, avant, voulu = 1) {
  for (let i = 0; i < 60; i += 1) {
    const l = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
    if (l.length >= voulu) return l;
    await page.waitForTimeout(100);
  }
  return [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
}
const planDe = (r) => (r && (typeof r.ops_plan === 'string' ? JSON.parse(r.ops_plan) : r.ops_plan)) || {};
const blocsPistes = (r) => (planDe(r).resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane');
const programmeDe = (r) => { const p = r && (typeof r.program === 'string' ? JSON.parse(r.program) : r.program); return (p && p.items) || []; };

const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const fx = FX.lireFixture('pic');
const LE_JOUR = fx.staffState.reservations.filter((r) => r.date === JOUR && r.status !== 'cancelled');
const blocsDu = (r, type) => ((r.opsPlan || {}).resourceBlocks || []).filter((b) => b.resourceType === type);
// Le compte a part, sur les dossiers et les retenues, sans le code de la console.
function pistesPrises(debut, minutes, retenues = []) {
  const prises = new Set();
  [...LE_JOUR, ...retenues.map((r) => C.dossierRetenu(r))].forEach((r) => blocsDu(r, 'bowling_lane').forEach((b) => {
    const s = enMin(b.startTime);
    const e = enMin(b.endTime);
    if (s < debut + minutes && debut < e) (b.lanes || []).forEach((l) => prises.add(Number(l)));
  }));
  return prises;
}
function armesPrises(debut, retenues = []) {
  let total = 0;
  [...LE_JOUR, ...retenues.map((r) => C.dossierRetenu(r))].forEach((r) => blocsDu(r, 'laser_arena').forEach((b) => {
    const s = enMin(b.startTime);
    const e = enMin(b.endTime);
    if (s < debut + 25 && debut < e) total += Number(b.players) || 0;
  }));
  return total;
}

// Un dossier cree par le serveur, vu par la page comme s il venait d arriver.
const poserDansLaPage = (page, res) => page.evaluate((r) => { window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(r); state.reservations.push({ ...r }); renderStaff(); }, res);
async function ouvrirModifier(page, id) {
  await page.evaluate((rid) => openPos(rid), id);
  await page.waitForTimeout(500);
  await page.evaluate(() => { const tab = [...document.querySelectorAll('button, a, [role="tab"]')].find((t) => /^Modifier$/i.test((t.textContent || '').trim())); if (tab) tab.click(); });
  await page.waitForSelector('.edit-form .lane-picker', { timeout: 8000 });
}
async function attendreBase(page, cond) {
  for (let i = 0; i < 40; i += 1) { if (cond()) return true; await page.waitForTimeout(100); }
  return cond();
}

// ---------------------------------------------------------------------------
// [A] CE QUI RESTERA
// ---------------------------------------------------------------------------
async function scenarioA(browser) {
  console.log('\n[A] ce qui restera apres cette reservation');
  const m = await ouvrir(browser);
  const { page } = m;
  try {
    await C.ouvrirFenetre(page, 7);
    await verifie(page, 'bowling');
    await verifie(page, 'laser_game');
    const lireB = async (joueursParPiste, minutes, pistes) => (await heures(page, 'bowling')).filter((x) => !x.coince).map((x) => {
      const libres = 8 - pistesPrises(enMin(x.heure), minutes).size;
      return { heure: x.heure, lu: x.mot, attendu: `reste ${Math.max(0, libres - pistes)} piste${Math.max(0, libres - pistes) > 1 ? 's' : ''}`, cases: x.cases.length, nom: x.nom };
    });
    const b7 = await lireB(6, 60, 2);
    ok(b7.length > 0 && b7.every((x) => x.lu === x.attendu && x.nom.includes(x.attendu)), '[A] chaque heure du bowling dit ce qui reste apres le groupe', b7);
    ok(b7.every((x) => x.cases === 8), '[A] la jauge compte une case par piste', b7.map((x) => x.cases));
    const lireL = async (joueurs) => (await heures(page, 'laser_game')).filter((x) => !x.coince).map((x) => {
      const reste = Math.max(0, 30 - armesPrises(enMin(x.heure)) - joueurs);
      return { heure: x.heure, lu: x.mot, attendu: `reste ${reste} arme${reste > 1 ? 's' : ''}` };
    });
    const l7 = await lireL(7);
    ok(l7.length > 0 && l7.every((x) => x.lu === x.attendu), '[A] chaque heure du laser dit ce qui reste apres le groupe', l7);
    // Le groupe change : une piste suffit, il en reste une de plus, tout de suite.
    await page.locator('#rsHaut [data-pax="3"]').click();
    await verifie(page, 'bowling');
    const b3 = await lireB(6, 60, 1);
    ok(b3.length > 0 && b3.every((x) => x.lu === x.attendu), '[A] le groupe change, ce qui reste suit', b3);
    const l3 = await lireL(3);
    ok(l3.length > 0 && l3.every((x) => x.lu === x.attendu), '[A] les armes suivent le groupe', l3);
    // La duree change : 2 h prennent plus de la journee.
    await page.locator('#rsV-bowling-2').click();
    await verifie(page, 'bowling');
    const b2h = await lireB(6, 120, 1);
    ok(b2h.length > 0 && b2h.every((x) => x.lu === x.attendu), '[A] la duree change, ce qui reste suit', b2h);
    // Les parties changent : la partie la plus serree decide.
    await page.locator('#rsV-laser_game-2').click();
    await verifie(page, 'laser_game');
    const deux = await page.evaluate(() => rsDansLaCopie('laser_game', () => ['17:00', '18:00'].map((h) => ({ h, place: rsPlaceLaser(h) }))));
    const attendu2 = (h) => Math.max(0, 30 - Math.max(armesPrises(enMin(h)), armesPrises(enMin(h) + 30)) - 3);
    ok(deux.every((x) => x.place.libre === attendu2(x.h)), '[A] deux parties : la plus serree decide de ce qui reste', deux.map((x) => ({ ...x, attendu: attendu2(x.h) })));
    // L heure prise, le ticket le redit.
    await page.locator('#rsV-bowling-1').click();
    await page.locator('#rsV-laser_game-1').click();
    await verifie(page, 'bowling');
    const prise = (await heures(page, 'bowling')).find((x) => !x.coince);
    await page.locator(`#rsZ-bowling .rs-h[data-heure="${prise.heure}"]`).click();
    await C.pret(page);
    await page.waitForTimeout(200);
    const ticket = await page.evaluate(() => (document.querySelector('#rsL-a-bowling .is-apres') || {}).textContent || '');
    ok(ticket === prise.mot.replace('reste', 'il restera'), '[A] le ticket redit ce qui restera a l heure prise', { ticket, prise: prise.mot });
    // « maintenant » reste, sur le bord de la touche.
    const maintenant = (await heures(page, 'bowling')).find((x) => x.heure === '15:00');
    ok(maintenant && maintenant.tag === 'maintenant', '[A] la seance en cours se dit encore « maintenant »', maintenant);
    // Une formule : chaque heure le dit aussi, pistes et armes, le bloc le plus serre decide.
    await page.locator('#rsHaut [data-pax="7"]').click();
    await C.pret(page);
    await page.locator('#rsCol button', { hasText: 'Formules' }).first().click();
    await page.waitForSelector('#rsF-formule_1, .rs-f');
    await page.locator('.rs-f[data-formule]').first().click();
    await page.waitForSelector('.rs-s-l.is-formule[data-verifie="1"]', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(250);
    const tuiles = await page.evaluate(() => {
      const c = quickBookState.candidats;
      return [...document.querySelectorAll('.rs-s-l.is-formule .rs-h[data-heure]')].map((b) => ({ heure: b.dataset.heure, mots: [...b.querySelectorAll('small')].map((s) => s.textContent.trim()), coince: b.classList.contains('is-coince') || b.classList.contains('is-ko'), prend: ((c && c.resultats.get(b.dataset.heure)) || {}).prend || [], nom: b.getAttribute('aria-label') || '' }));
    });
    const pluriel = (n, mot) => `reste ${n} ${mot}${n > 1 ? 's' : ''}`;
    const attenduFormule = (x) => {
      const p = x.prend.filter((b) => b.t === 'piste').map((b) => 8 - pistesPrises(enMin(b.d), enMin(b.f) - enMin(b.d)).size - b.n);
      const a = x.prend.filter((b) => b.t === 'arme').map((b) => 30 - armesPrises(enMin(b.d)) - b.n);
      return [...(p.length ? [pluriel(Math.max(0, Math.min(...p)), 'piste')] : []), ...(a.length ? [pluriel(Math.max(0, Math.min(...a)), 'arme')] : [])];
    };
    const tiennent = tuiles.filter((x) => !x.coince);
    ok(tiennent.length > 0 && tiennent.every((x) => x.mots.length === 2 && JSON.stringify(x.mots) === JSON.stringify(attenduFormule(x)) && x.mots.every((m) => x.nom.includes(m))), '[A] chaque heure d une formule dit ce qui reste', tuiles.map((x) => ({ h: x.heure, lu: x.mots, attendu: attenduFormule(x), coince: x.coince })));
    const choisie = tiennent[tiennent.length - 1];
    await page.locator(`.rs-s-l.is-formule .rs-h[data-heure="${choisie.heure}"]`).click();
    await C.pret(page);
    await page.waitForTimeout(300);
    const ticketF = await page.evaluate(() => (document.querySelector('#rsL-a-formule .is-apres') || {}).textContent || '');
    ok(ticketF === `il restera ${choisie.mots.map((m) => m.replace('reste ', '')).join(', ')}`, '[A] le ticket d une formule redit ce qui restera', { ticketF, choisie: choisie.mots });
  } finally { await finir(m, 'A'); }
}

// ---------------------------------------------------------------------------
// [B] LES RETENUES
// ---------------------------------------------------------------------------
async function scenarioB(browser) {
  console.log('\n[B] ce que les clients retiennent en ce moment');
  const m = await ouvrir(browser, { retenues: RETENUES, reservations: () => [] });
  const { page } = m;
  try {
    await C.ouvrirFenetre(page, 4);
    await verifie(page, 'bowling');
    await verifie(page, 'laser_game');
    const phrase = (id) => page.evaluate((i) => ((document.querySelector(`#rsZ-${i} .rs-retenues`) || {}).textContent || '').replace(/\s+/g, ' ').trim(), id);
    ok(/les pistes 6 et 7 de 16:00 à 17:00/.test(await phrase('bowling')) && /8 min 12 s/.test(await phrase('bowling')), '[B] le bloc du bowling dit ce que le client retient', await phrase('bowling'));
    ok(/12 armes à 16:30/.test(await phrase('laser_game')) && /4 min 40 s/.test(await phrase('laser_game')), '[B] le bloc du laser dit ce que le client retient', await phrase('laser_game'));
    const h = await page.evaluate(() => rsDansLaCopie('bowling', () => ({ a16: rsPlaceBowling('16:00'), a18: rsPlaceBowling('18:00'), libres: rvPistesDuBowling('16:00').libres, prises: [...getOccupiedLanes(quickBookState.date, '16:00', 1)] })));
    ok(h.libres === 6 && h.prises.includes(6) && h.prises.includes(7), '[B] une piste retenue ne compte pas comme libre', h);
    ok(h.a16.retenu === 2 && h.a16.libre === 5 && h.a18.retenu === 0 && h.a18.libre === 7, '[B] ce qui reste a 16:00 tient compte de la retenue, pas a 18:00', h);
    const a16 = (await heures(page, 'bowling')).find((x) => x.heure === '16:00');
    ok(a16 && a16.cases.filter(([c]) => c === 'is-retenu').length === 2 && /2 pistes en cours de réservation en ligne/.test(a16.nom), '[B] la touche montre les pistes retenues, et le dit a qui ne la voit pas', a16);
    const laser = await page.evaluate(() => rsDansLaCopie('laser_game', () => ({ dispo: rvDispoLaserA('16:30')[0], place: rsPlaceLaser('16:30') })));
    ok(laser.dispo.libres === 18 && laser.place.retenu === 12 && laser.place.libre === 14, '[B] les armes retenues ne comptent pas comme libres', laser);
    // Le serveur compte la retenue : 50 joueurs tiennent sur 7 pistes (8 par piste au plus),
    // pas sur les 6 qui restent, et une piste retenue demandee n est jamais donnee.
    const avantServeur = new Set(B.base.reservations.keys());
    const corpsBase = { centerId: 'libramont', date: JOUR, startTime: '16:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc', phone: '', email: '', channel: 'staff', requiresLanes: true };
    const trop = await serveur.appeler('POST', '/api/staff-reservations', { ...corpsBase, pax: 50, laneCount: 7, lanes: [] });
    ok(trop.statut >= 400 && [...B.base.reservations.keys()].every((k) => avantServeur.has(k)), '[B] le serveur refuse une place que la retenue tient', { statut: trop.statut, message: trop.json.message, pistes: trop.json.reservation && trop.json.reservation.lanes });
    const sur6 = await serveur.appeler('POST', '/api/staff-reservations', { ...corpsBase, pax: 2, laneCount: 1, lanes: [6] });
    const lignes = [...B.base.reservations.entries()].filter(([id]) => !avantServeur.has(id)).map(([, r]) => r);
    ok(lignes.length === 1 && !lignes[0].lanes.includes(6) && !lignes[0].lanes.includes(7), '[B] une piste retenue demandee n est jamais donnee', { statut: sur6.statut, pistes: lignes.map((r) => r.lanes) });
    lignes.forEach((r) => B.base.reservations.delete(r.id));
    // Le temps descend a la seconde, sans repeindre la fenetre.
    const base = FX.instant(JOUR, C.HEURE).getTime();
    const noeud = await page.evaluateHandle(() => document.querySelector('#rsZ-bowling .rs-s-l'));
    await page.clock.setFixedTime(new Date(base + 30000));
    await page.waitForFunction(() => /7 min 42 s/.test((document.querySelector('#rsZ-bowling [data-echeance]') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
    ok(/7 min 42 s/.test(await phrase('bowling')), '[B] le temps de la retenue descend a la seconde', await phrase('bowling'));
    ok(await noeud.evaluate((n) => n.isConnected), '[B] le temps qui descend ne repeint pas les heures');
    // Echue, elle rend sa place tout de suite.
    const apres = base + 5 * 60000;
    globalThis.__comptoirMaintenant = apres;
    B.base.horloge = apres;
    await page.clock.setFixedTime(new Date(apres));
    await page.waitForFunction(() => !document.querySelector('#rsZ-laser_game .rs-retenues'), null, { timeout: 4000 }).catch(() => {});
    const laserApres = await page.evaluate(() => rsDansLaCopie('laser_game', () => rsPlaceLaser('16:30')));
    ok(!(await phrase('laser_game')) && laserApres.retenu === 0 && laserApres.libre === 26, '[B] echue, la retenue rend ses armes tout de suite', { phrase: await phrase('laser_game'), laserApres });
    ok(/2 min|3 min/.test(await phrase('bowling')), '[B] l autre retenue court toujours', await phrase('bowling'));
  } finally { await finir(m, 'B'); }
}

// ---------------------------------------------------------------------------
// [C] LES JOUEURS PAR ACTIVITE
// ---------------------------------------------------------------------------
async function scenarioC(browser) {
  console.log('\n[C] les joueurs de chaque activite');
  const m = await ouvrir(browser, { reservations: () => [] });
  const { page } = m;
  const moins = (id) => page.locator(`#rsZ-${id} .rs-cpt [aria-label^="Joueurs"][aria-label$="un de moins"]`);
  const plus = (id) => page.locator(`#rsZ-${id} .rs-cpt [aria-label^="Joueurs"][aria-label$="un de plus"]`);
  const compteur = (id) => page.evaluate((i) => Number((document.querySelector(`#rsZ-${i} .rs-cpt .rs-pas b`) || {}).textContent), id);
  try {
    await C.ouvrirFenetre(page, 12);
    await verifie(page, 'bowling');
    const avant = await heures(page, 'bowling');
    ok(avant.find((x) => x.heure === '17:00').mot === 'reste 6 pistes', '[C] MONTAGE : 12 joueurs prennent 2 pistes', avant.find((x) => x.heure === '17:00'));
    for (let i = 0; i < 8; i += 1) { await moins('bowling').click(); await page.waitForTimeout(40); }
    await verifie(page, 'bowling');
    const a4 = await heures(page, 'bowling');
    ok(a4.find((x) => x.heure === '17:00').mot === 'reste 7 pistes' && await compteur('bowling') === 4, '[C] les joueurs du bowling font bouger ce qui reste', a4.find((x) => x.heure === '17:00'));
    ok(await compteur('laser_game') === 12, '[C] le laser garde tout le groupe', await compteur('laser_game'));
    const nPistes = await page.evaluate(() => Number((document.querySelector('#rsZ-bowling [data-pistes-pas]').parentElement.querySelector('b') || {}).textContent));
    ok(nPistes === 1, '[C] les pistes se recomptent tout de suite', nPistes);
    await page.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page);
    await verifie(page, 'laser_game');
    await page.locator('#rsZ-laser_game .rs-h[data-heure="18:00"]').click();
    await C.pret(page);
    await page.waitForTimeout(300);
    await page.locator('#rsT-minigolf_blacklight').click();
    await C.pret(page);
    await page.waitForSelector('.rs-joueurs-petits .rs-cpt');
    const nomPetite = await page.evaluate(() => document.querySelector('.rs-joueurs-petits [aria-label$="un de moins"]').dataset.activite);
    for (let i = 0; i < 2; i += 1) { await page.locator('.rs-joueurs-petits [aria-label$="un de moins"]').click(); await page.waitForTimeout(40); }
    await C.pret(page);
    const au = await page.evaluate((id) => ({ b: getQuickVisitParticipants('bowling'), l: getQuickVisitParticipants('laser_game'), p: getQuickVisitParticipants(id), t: quickBookState.type }), nomPetite);
    ok(au.b === 4 && au.l === 12 && au.p === 10 && au.t === 'visite', '[C] une petite activite a ses joueurs, sous les tuiles', au);
    await creer(page, 'Banc Joueurs');
    const [r] = await neufs(page, m.avant);
    const lignes = programmeDe(r);
    const de = (id) => (lignes.find((l) => l.activityId === id) || {}).participants;
    ok(r && de('bowling') === 4 && de('laser_game') === 12 && de(nomPetite) === 10 && Number(r.pax) === 12 && r.lanes.length === 1, '[C] le dossier cree porte les joueurs de chaque activite', r && { pax: r.pax, pistes: r.lanes, lignes: lignes.map((l) => [l.activityId, l.participants]) });
    await page.waitForTimeout(400);
  } finally { await finir(m, 'C1'); }

  const m2 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page2 = m2.page;
    await C.ouvrirFenetre(page2, 7);
    await verifie(page2, 'bowling');
    await page2.locator('#rsZ-bowling .rs-cpt [aria-label^="Joueurs"][aria-label$="un de plus"]').click();
    await page2.waitForTimeout(250);
    const lu = await page2.evaluate(() => ({ pax: quickBookState.pax, b: getQuickVisitParticipants('bowling'), l: getQuickVisitParticipants('laser_game') }));
    ok(lu.pax === 8 && lu.b === 8 && lu.l === 7, '[C] le groupe grandit par une activite, les autres gardent le leur', lu);
    const proposeLaser = await page2.evaluate(() => { rsJoueursBloc('laser_game', 5); return quickBookState.type; });
    await page2.waitForTimeout(200);
    await page2.locator('#rsZ-laser_game .rs-h[data-heure="18:00"]').click();
    await C.pret(page2);
    const seul = await page2.evaluate(() => ({ t: quickBookState.type, ids: rvActivites(), l: getQuickVisitParticipants('laser_game') }));
    ok(seul.l === 5 && seul.ids.includes('laser_game') && (seul.t === 'visite'), '[C] une activite prise garde les joueurs poses avant', { proposeLaser, seul });
  } finally { await finir(m2, 'C2'); }

  // Un groupe de 12, quatre au bowling, rien d autre : une piste, le prix d une piste.
  const m3 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page3 = m3.page;
    await C.ouvrirFenetre(page3, 12);
    await verifie(page3, 'bowling');
    for (let i = 0; i < 8; i += 1) { await page3.locator('#rsZ-bowling .rs-cpt [aria-label="Joueurs, Bowling, un de moins"]').click(); await page3.waitForTimeout(40); }
    await verifie(page3, 'bowling');
    await page3.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page3);
    await page3.waitForTimeout(250);
    await creer(page3, 'Banc Bowling Seul');
    const [r] = await neufs(page3, m3.avant);
    const ligne = programmeDe(r).find((l) => l.activityId === 'bowling');
    ok(r && r.lanes.length === 1 && Number(r.price) === 39 && ligne && ligne.participants === 4, '[C] un bowling seul garde ses joueurs', r && { pistes: r.lanes, prix: r.price, pax: r.pax, type: r.type, programme: programmeDe(r).map((l) => [l.activityId, l.participants]), blocs: blocsPistes(r) });
    await page3.waitForTimeout(300);
  } finally { await finir(m3, 'C3'); }
}

// ---------------------------------------------------------------------------
// [D] LES PISTES A LA MAIN
// ---------------------------------------------------------------------------
async function scenarioD(browser) {
  console.log('\n[D] les pistes a la main');
  const m = await ouvrir(browser, { reservations: () => [] });
  const { page } = m;
  const nPistes = () => page.evaluate(() => Number(document.querySelector('#rsZ-bowling [data-pistes-pas]').parentElement.querySelector('b').textContent));
  try {
    await C.ouvrirFenetre(page, 7);
    await verifie(page, 'bowling');
    ok(await nPistes() === 2, '[D] MONTAGE : le centre conseille 2 pistes pour 7', await nPistes());
    await page.locator('#rsZ-bowling [data-pistes-pas] >> nth=0').click();
    await verifie(page, 'bowling');
    const a17 = (await heures(page, 'bowling')).find((x) => x.heure === '17:00');
    ok(await nPistes() === 1 && a17.mot === 'reste 7 pistes', '[D] une piste : ce qui reste suit', { n: await nPistes(), a17 });
    ok(/à la main/.test(await page.evaluate(() => document.querySelector('#rsZ-bowling .rs-s-n small').textContent)), '[D] le bloc dit « à la main »');
    await page.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page);
    await page.waitForTimeout(250);
    const avert = await page.evaluate(() => document.getElementById('rvVerdict').textContent.replace(/\s+/g, ' ').trim());
    ok(/choisi à la main/.test(avert) && !/au lieu de 6/.test(avert), '[D] le ticket le dit une seule fois', avert);
    await creer(page, 'Banc Une Piste');
    const [r] = await neufs(page, m.avant);
    ok(r && r.lanes.length === 1 && Number(r.pax) === 7 && blocsPistes(r)[0].pistesALaMain === 1 && r.validation_status === 'confirmed', '[D] 7 joueurs sur une piste, a la main', r && { pistes: r.lanes, pax: r.pax, bloc: blocsPistes(r)[0], validation: r.validation_status });
    ok(r && Number(r.price) === 39, '[D] le prix suit les pistes prises', r && r.price);
    await page.waitForTimeout(300);
  } finally { await finir(m, 'D1'); }

  // Vingt joueurs, les pistes voulues.
  const m2 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page2 = m2.page;
    await C.ouvrirFenetre(page2, 20);
    await verifie(page2, 'bowling');
    for (let i = 0; i < 3; i += 1) { await page2.locator('#rsZ-bowling [data-pistes-pas] >> nth=0').click(); await page2.waitForTimeout(40); }
    await page2.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page2);
    await page2.locator('#rsL-a-bowling').click();
    await page2.waitForSelector('[data-piste="3"]');
    await page2.locator('[data-piste="3"]').click();
    await C.pret(page2);
    await page2.waitForTimeout(200);
    await creer(page2, 'Banc Vingt');
    const [r] = await neufs(page2, m2.avant);
    ok(r && r.lanes.join() === '3' && Number(r.pax) === 20, '[D] 20 joueurs sur une piste, a la main', r && { pistes: r.lanes, pax: r.pax, plan: blocsPistes(r) });

    // La fiche et les heures : le dossier reste a la main.
    const id = r && r.id;
    if (id) {
      const patch = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', startTime: '20:00', allowPastStart: true, baseUpdatedAt: new Date(r.updated_at).toISOString() });
      const apres = B.base.reservations.get(id);
      ok(patch.statut === 200 && apres.lanes.length === 1 && blocsPistes(apres)[0].pistesALaMain === 1 && blocsPistes(apres)[0].startTime === '20:00', '[D] une heure changee garde le dossier a la main', { statut: patch.statut, message: patch.json.message, pistes: apres.lanes, bloc: blocsPistes(apres)[0] });
      const nom = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', name: 'Banc Vingt bis', baseUpdatedAt: new Date(apres.updated_at).toISOString() });
      const apres2 = B.base.reservations.get(id);
      ok(nom.statut === 200 && apres2.lanes.length === 1 && blocsPistes(apres2)[0].pistesALaMain === 1, '[D] un nom change garde le dossier a la main', { statut: nom.statut, message: nom.json.message });
      const retire = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', pistesALaMain: 0, lanes: [3], laneCount: 1, baseUpdatedAt: new Date(apres2.updated_at).toISOString() });
      const apres3 = B.base.reservations.get(id);
      ok(retire.statut === 200 && blocsPistes(apres3).every((b) => !b.pistesALaMain) && apres3.lanes.length >= 4, '[D] retirer la main rend les pistes conseillees', { statut: retire.statut, message: retire.json.message, pistes: apres3.lanes });
    }
  } finally { await finir(m2, 'D2'); }

  // Une formule aussi : sept joueurs sur une piste, le prix reste celui de la formule.
  const m7 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page7 = m7.page;
    await C.ouvrirFenetre(page7, 7);
    await page7.locator('#rsCol button', { hasText: 'Formules' }).first().click();
    await page7.waitForSelector('.rs-f[data-formule]');
    await page7.locator('.rs-f[data-formule]').first().click();
    await page7.waitForSelector('.rs-s-l.is-formule[data-verifie="1"]', { timeout: 12000 }).catch(() => {});
    const prixFormule = await page7.evaluate(() => rvTotalReference());
    const moinsF = page7.locator('.rs-seance [data-pistes-pas]').first();
    ok(await moinsF.count() === 1, '[D] une formule avec bowling offre le reglage des pistes');
    await moinsF.click();
    await page7.waitForSelector('.rs-s-l.is-formule[data-verifie="1"]', { timeout: 12000 }).catch(() => {});
    await page7.waitForTimeout(250);
    await page7.locator('.rs-s-l.is-formule .rs-h[data-heure="17:00"]').click();
    await C.pret(page7);
    await page7.waitForTimeout(300);
    const motsF = await page7.evaluate(() => [...document.querySelectorAll('.rs-s-l.is-formule .rs-h[data-heure="17:00"] small')].map((s) => s.textContent.trim()));
    await creer(page7, 'Banc Formule Piste');
    const [rF] = await neufs(page7, m7.avant);
    ok(rF && rF.lanes.length === 1 && Number(rF.pax) === 7 && blocsPistes(rF)[0].pistesALaMain === 1 && Number(rF.price) === Number(prixFormule) && motsF[0] === 'reste 7 pistes', '[D] une formule sur une piste, a la main', rF && { pistes: rF.lanes, prix: rF.price, prixFormule, motsF, blocs: blocsPistes(rF), validation: rF.validation_status, message: await page7.evaluate(() => quickBookState && quickBookState.error) });
    await page7.waitForTimeout(300);
  } finally { await finir(m7, 'D7'); }

  // Sans le niveau forcer : pas de moins sous le conseil, et le serveur refuse.
  const m3 = await ouvrir(browser, { role: 'catalogue', reservations: () => [] });
  try {
    const page3 = m3.page;
    await C.ouvrirFenetre(page3, 7);
    await verifie(page3, 'bowling');
    const bouton = await page3.evaluate(() => { const b = document.querySelector('#rsZ-bowling [data-pistes-pas]'); return { desactive: b.disabled, plus: !b.parentElement.querySelectorAll('button')[1].disabled }; });
    ok(bouton.desactive && bouton.plus, '[D] sans le niveau forcer, pas de moins sous le conseil, le plus reste', bouton);
    const avantRefus = new Set(B.base.reservations.keys());
    const refus = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, startTime: '19:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Forge', pax: 7, laneCount: 1, lanes: [], requiresLanes: true, channel: 'staff', pistesALaMain: 1 });
    ok(refus.statut === 403 && refus.json.code === 'pistes_a_la_main_refuse' && [...B.base.reservations.keys()].every((k) => avantRefus.has(k)), '[D] sans le niveau forcer, le serveur refuse', { statut: refus.statut, code: refus.json.code, message: refus.json.message });
    const plusDePistes = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, startTime: '19:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Trois', pax: 7, laneCount: 3, lanes: [], requiresLanes: true, channel: 'staff', pistesALaMain: 3 });
    ok(plusDePistes.statut === 201 && plusDePistes.json.reservation.lanes.length === 3, '[D] plus de pistes que le conseil reste ouvert a qui reserve', { statut: plusDePistes.statut, message: plusDePistes.json.message });
    const { normalizeReservationRequest } = require(path.join(ROOT, 'lib/reservation-request.js'));
    const publique = normalizeReservationRequest({ centerId: 'libramont', date: JOUR, startTime: '19:00', duration: 1, pax: 7, type: 'bowling', name: 'X', phone: '+32470000000', email: 'x@example.test', pistesALaMain: 1 }, { channel: 'public', centerId: 'libramont' });
    ok(publique.pistesALaMain === undefined, '[D] le formulaire public n a pas droit aux pistes a la main', publique.pistesALaMain);
  } finally { await finir(m3, 'D3'); }

  // Un role qui modifie les dossiers, sans le niveau forcer : ni bouton ni raccourci.
  const m6 = await ouvrir(browser, { role: 'sans-forcer', reservations: () => [] });
  try {
    const page6 = m6.page;
    const cree = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, startTime: '17:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Sans Droit', pax: 7, laneCount: 2, lanes: [2, 3], requiresLanes: true, channel: 'staff' });
    const id = cree.json.reservation && cree.json.reservation.id;
    ok(cree.statut === 201, '[D] MONTAGE : 7 joueurs sur 2 pistes, sans le niveau forcer', { statut: cree.statut, message: cree.json.message });
    await poserDansLaPage(page6, cree.json.reservation);
    await ouvrirModifier(page6, id);
    ok(await page6.locator('.edit-form .lane-picker').count() === 1 && await page6.locator('#editPistesMain').count() === 0, '[D] sans le niveau forcer, la fiche n offre pas la main');
    const force = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', pistesALaMain: 1, lanes: [2], laneCount: 1, baseUpdatedAt: new Date(B.base.reservations.get(id).updated_at).toISOString() });
    const enBase = B.base.reservations.get(id);
    ok(force.statut === 403 && force.json.code === 'pistes_a_la_main_refuse' && enBase.lanes.join() === '2,3', '[D] sans le niveau forcer, un changement force est refuse', { statut: force.statut, code: force.json.code, message: force.json.message, pistes: enBase.lanes });
  } finally { await finir(m6, 'D6'); }

  // Le glisser et la fiche : une vraie carte sur le planning.
  const m4 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page4 = m4.page;
    const cree = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, startTime: '18:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Glisser', pax: 7, laneCount: 1, lanes: [2], requiresLanes: true, channel: 'staff', pistesALaMain: 1 });
    const id = cree.json.reservation && cree.json.reservation.id;
    ok(cree.statut === 201 && id, '[D] MONTAGE : un dossier sur une piste', { statut: cree.statut, message: cree.json.message });
    await page4.evaluate((res) => { window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(res); state.reservations.push(res); }, cree.json.reservation);
    const vu = await page4.evaluate((rid) => {
      const reservation = state.reservations.find((r) => Number(r.id) === Number(rid));
      return { main: pistesALaMainDuDossier(reservation) };
    }, id);
    ok(vu.main === 1, '[D] la console lit le dossier a la main', vu);
    await page4.evaluate((rid) => scheduleBowlingDrag(rid, 5, 18, 2, 18), id);
    await page4.waitForTimeout(600);
    const glisse = await page4.evaluate((rid) => { const r = state.reservations.find((x) => Number(x.id) === Number(rid)); return { pistes: r.lanes, main: pistesALaMainDuDossier(r) }; }, id);
    ok(glisse.pistes.length === 1 && glisse.pistes[0] === 5 && glisse.main === 1, '[D] glisser la carte ne rajoute pas de piste', glisse);
    const enBase = B.base.reservations.get(id);
    ok(enBase.lanes.join() === '5' && blocsPistes(enBase)[0].pistesALaMain === 1, '[D] le glisser est ecrit en base, a la main', { pistes: enBase.lanes, bloc: blocsPistes(enBase)[0] });
  } finally { await finir(m4, 'D4'); }

  // La fiche : 7 joueurs sur 2 pistes, on en decoche une, on dit « a la main », on enregistre.
  const m5 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page5 = m5.page;
    const cree = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, startTime: '17:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Fiche', pax: 7, laneCount: 2, lanes: [2, 3], requiresLanes: true, channel: 'staff' });
    const id = cree.json.reservation && cree.json.reservation.id;
    ok(cree.statut === 201 && B.base.reservations.get(id).lanes.join() === '2,3', '[D] MONTAGE : 7 joueurs sur 2 pistes', { statut: cree.statut, message: cree.json.message });
    await poserDansLaPage(page5, cree.json.reservation);
    await ouvrirModifier(page5, id);
    await page5.locator('.lane-picker .lane-chip', { hasText: /^3$/ }).click();
    await page5.locator('#editPistesMain').click();
    const conseil = await page5.locator('#editLanesHint').textContent();
    ok(/7 joueurs sur 1 piste, à la main/.test(conseil), '[D] la fiche dit ce qu elle va garder', conseil);
    await page5.locator('.edit-form button[type="submit"]').first().click();
    await attendreBase(page5, () => B.base.reservations.get(id).lanes.join() === '2');
    const apres = B.base.reservations.get(id);
    ok(apres.lanes.join() === '2' && blocsPistes(apres)[0].pistesALaMain === 1, '[D] la fiche garde une piste, a la main', { pistes: apres.lanes, bloc: blocsPistes(apres)[0] });
    // Rouverte, elle s en souvient. On retire la main : le centre remet ses deux pistes.
    await page5.waitForTimeout(500);
    await ouvrirModifier(page5, id);
    ok(await page5.locator('#editPistesMain').getAttribute('aria-pressed') === 'true', '[D] la fiche rouverte s en souvient');
    await page5.locator('#editPistesMain').click();
    await page5.locator('.edit-form button[type="submit"]').first().click();
    await attendreBase(page5, () => B.base.reservations.get(id).lanes.length === 2);
    const rendu = B.base.reservations.get(id);
    ok(rendu.lanes.length === 2 && blocsPistes(rendu).every((b) => !b.pistesALaMain), '[D] retirer la main depuis la fiche rend les pistes conseillees', { pistes: rendu.lanes, blocs: blocsPistes(rendu) });
  } finally { await finir(m5, 'D5'); }
}

// ---------------------------------------------------------------------------
// [E] L ECRAN
// ---------------------------------------------------------------------------
async function scenarioE(browser) {
  console.log('\n[E] l ecran');
  for (const appareil of ['comptoir', 'portable', 'tablette', 'tablette-portrait', 'telephone']) {
    const m = await ouvrir(browser, { appareil, retenues: RETENUES });
    const { page } = m;
    try {
      await C.ouvrirFenetre(page, 7);
      await verifie(page, 'bowling');
      await verifie(page, 'laser_game');
      const mesure = await page.evaluate(() => {
        const col = document.getElementById('rsCol');
        const coupes = [...document.querySelectorAll('.rs-h small, .rs-h-tag, .rs-ret, .rs-cpt')].filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 30));
        const r = col.getBoundingClientRect();
        const dehors = [...col.querySelectorAll('.rs-h, .rs-cpt, .rs-ret')].filter((e) => { const x = e.getBoundingClientRect(); return x.width && (x.left < r.left - 1 || x.right > r.right + 1); }).length;
        return { largeur: col.scrollWidth - col.clientWidth, hauteur: col.scrollHeight - col.clientHeight, coupes, dehors };
      });
      ok(mesure.largeur <= 1 && mesure.dehors === 0, `[E] rien ne deborde (${appareil})`, mesure);
      ok(mesure.coupes.length === 0, `[E] rien ne se coupe (${appareil})`, mesure.coupes);
      if (appareil === 'comptoir') ok(mesure.hauteur <= 1, '[E] tout tient sans defiler a 1366 x 768', mesure);
    } finally { await finir(m, `E ${appareil}`); }
  }
}

// ---------------------------------------------------------------------------
const SCENARIOS = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD, E: scenarioE };

function verifierLesAncres() {
  let mortes = 0;
  MUTATIONS.forEach((m) => { const n = compteAncre(m); if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom} trouvee ${n} fois : ${m.de.slice(0, 80)}`); } });
  console.log(`comptoir-check --ancres : ${MUTATIONS.length - mortes}/${MUTATIONS.length} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS;
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, COMPTOIR_CASSE: m.nom, PINLANE_COMPTOIR_PORT: String(PORT + 1 + fil) },
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
  console.log(`comptoir-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: C.BROWSER_PATH, headless: true });
  try {
    for (const nom of seul) await SCENARIOS[nom](browser);
  } finally {
    await browser.close();
    http.close();
  }
  console.log(`\ncomptoir-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('comptoir-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

// RESERVER : UNE ACTIVITE EN PLUS D UNE FORMULE (2026-11-22).
//
// Ansar, au comptoir : « quand on prend une formule [...] on veut ajouter genre activité après la formule ou
// en plus, bah ça déplie la formule [...] surtout pour quand c illimité ça fait nimp et on arrive pas à
// choisir les heures qu on veut, ça marque impossible partout ». Chaque geste qui ajoutait une activite a une
// formule l adaptait : la formule devenait une visite (« Formule 5, adaptée », une ligne par activite), le
// moteur replanifiait ses activites derriere l ajout (le laser de la Formule 5 passait de 16:00 a 17:00), les
// heures de l ajout se jugeaient comme une ligne de cette visite (« impossible » le soir), et un acces
// illimite perdait son choix, son prix ne comptait pas le bowling ajoute. Une formule prise telle quelle, ou
// un acces illimite, reste entiere : une activite en plus est sa ligne, a son prix et a son heure, et le
// serveur la juge avec la formule comme un seul ensemble (lib/formule-en-plus.js, lib/reserver-fenetre.js
// poserLesEnPlus, assets/app-main.js rvEnPlus).
//
// La vraie console (scripts/comptoir-banc.js : planning-v3-fixtures, le samedi 16 janvier 2027 a 15:10, a
// 1366 x 768), de vrais clics ; ses appels partent au VRAI handler api/staff-reservations.js (et api/ops.js
// pour l acces illimite), au vrai moteur et a la vraie lib/database.js, sur la base en memoire de
// scripts/reserver-banc.js : aucune base reelle, aucun reseau, aucun mail ne part. Les montants attendus se
// lisent au catalogue du banc, jamais ecrits ici.
//   [A] Formule 1 (6 joueurs, le samedi 23 a 16:00), puis « Ajouter » le bowling :
//     [A1] la formule reste entiere : « Formule 1 », pas adaptee, aucune ligne par activite, son plan ne bouge
//          pas ; le bowling en plus est sa ligne, a l heure qui suit la formule ;
//     [A2] les heures du bowling en plus : seules celles qui chevauchent ce que la formule fait a heure fixe
//          ne tiennent pas, et disent pendant quoi ; les autres se prennent ; une heure pendant le bowling de
//          la formule touchee ne se prend pas et la fenetre dit pourquoi ; une heure libre se prend ;
//     [A3] le prix : la formule a son prix, le bowling le sien, le total leur somme ; « Créer » ecrit la
//          formule f1 telle quelle (nom, prix, reference), le bowling en plus a son heure et a son prix, sans
//          chevauchement ; un corps forge qui pose le bowling en plus sur celui de la formule est refuse ;
//     [A4] la caisse (Infos) dit la formule a son prix puis le bowling « en plus, à 19:00 » au sien ;
//     [A5] le mail de confirmation dit le bowling en plus, son heure et son prix ;
//     [A6] Modifier : l heure du dossier change, le bowling en plus suit, a son prix ;
//   [B] Formule 5, puis « Ajouter » le laser : [B1] le laser de la formule reste a 16:00 et 16:30, la
//       formule entiere ; [B2] le laser en plus a son heure apres la formule et son prix, le dossier aussi ;
//   [C] un acces illimite sans le bowling, le laser a volonte : [C1] le bowling en plus s ajoute a cote de
//       l acces, ses tuiles restent les siennes, l acces n est pas adapte ; [C2] le bowling en plus se prend a
//       17:00, pendant le laser a volonte, et le dossier le dit a son prix ; [C3] une activite que l acces
//       comprend (retiree, puis touchee sur sa tuile) revient dans l acces, sans ligne ni prix ;
//   [D] « + Ajouter une activité ou une boisson » sur une Formule 5 : l onglet « Activités » vient en premier ; le
//       billard touche s ajoute en plus de la formule, qui reste telle quelle, et son heure se pose sous sa tuile ;
//   [V1] a 1366 x 768, la fenetre tient sans defiler, aucun mot des heures n est coupe ;
//   [J1] aucune erreur JS.
// --contre-preuves : chaque regle retiree (au code servi ou au serveur, en memoire ; le disque n est jamais
// touche) fait rougir sa lettre : la formule depliee au geste, les heures jugees comme une ligne, le
// chevauchement ignore, l ajout offert, la caisse et le mail sans l ajout, Modifier qui le perd, l a volonte
// compte comme une heure fixe, l activite de l acces vendue en plus, la tuile qui deplie.
//   RFP_PORT : le port du site servi (7330) ; RFP_CAPTURES : le dossier des captures (captures-formule) ;
//   RFP_MUTATIONS : un sous-ensemble (noms separes par des virgules) ; RFP_BAVARD : le detail.
'use strict';
const PORT = Number(process.env.RFP_PORT || 7330);
const fs = require('fs');
const path = require('path');

const C = require('./comptoir-banc.js');
const { chromium } = require('playwright-core');

const { B, FX, ROOT, BROWSER_PATH } = C;
const CAPTURES = process.env.RFP_CAPTURES || path.join(ROOT, 'captures-formule');
const JS = 'assets/app-main.js';
const FENETRE = 'lib/reserver-fenetre.js';
const EN_PLUS = 'lib/formule-en-plus.js';
const MAIL = 'lib/ops-communications.js';
const API = 'api/staff-reservations.js';
const JOUR_RESA = '2027-01-23';
const PAX = 6;
const ACCES = 'Accès illimité';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

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

// Ce que le catalogue du banc dit, lu a chaque fois (une contre-preuve recharge les modules).
const catalogue = {
  formule: (id) => require(path.join(ROOT, 'lib/booking-config.js')).getBasePrice('formule', 0, 0, PAX, id, 'libramont'),
  parJoueur: (id) => require(path.join(ROOT, 'lib/booking-config.js')).getBasePrice('formule', 0, 0, 1, id, 'libramont'),
  activite: (ligne) => {
    const item = require(path.join(ROOT, 'lib/visit-program.js')).normalizeProgram([ligne], { centerId: 'libramont', pax: PAX, dateStr: JOUR_RESA, staff: true }).items[0];
    return item && item.priceKnown ? Number(item.price) : NaN;
  },
};
const euros = (n) => `${String(Math.round(Number(n) * 100) / 100).replace('.', ',')} €`;
const centimes = (n) => Math.round(Number(n) * 100);
const enMail = (n) => `${String(Math.round(Number(n) * 100) / 100).replace('.', ',')}\\s€`;
const enMin = (h) => { const [a, b] = String(h || '').split(':').map(Number); return a * 60 + b; };
const enApi = (id) => require(path.join(ROOT, 'lib/database.js')).mapReservation(B.base.reservations.get(Number(id)));

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
async function pret(page) {
  await page.waitForTimeout(350);
  await page.waitForFunction(() => quickBookState && quickBookState.plan && quickBookState.plan.etat !== 'calcul' && quickBookState.plan.cle === quickBookState.cleCourante, null, { timeout: 15000 }).catch(() => null);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#quickBookOverlay [data-verifie]')).every((n) => n.dataset.verifie === '1'), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(300);
}

// Le ticket, le plan, les heures du bloc d une activite et les tuiles, tels que la fenetre les montre.
const lire = (page, bloc = '') => page.evaluate((id) => {
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const s = quickBookState;
  const ligne = (cle) => {
    const b = document.getElementById(`rsL-${cle}`);
    if (!b) return null;
    const n = b.querySelector('.rs-tk-n');
    return { nom: t(n && n.querySelector('b')), details: Array.from((n && n.querySelectorAll('small')) || []).map(t), prix: t(b.querySelector('em')) };
  };
  const plan = rvPlanCourant();
  const zone = id ? document.getElementById(`rsZ-${id}`) : null;
  return {
    type: s.type,
    formuleId: s.formuleId,
    adaptee: Boolean(s.adaptee),
    enPlus: (s.enPlus || []).map((x) => ({ ...x })),
    erreur: s.error || '',
    lignes: Array.from(document.querySelectorAll('#quickBookOverlay [id^="rsL-a-"], #quickBookOverlay [id^="rsL-p-"]')).map((b) => b.id),
    formule: ligne('a-formule'),
    bowling: ligne('p-bowling'),
    laser: ligne('p-laser_game'),
    total: t(document.getElementById('rvTotalPied')),
    plan: plan ? {
      disponible: plan.disponible, refus: plan.refus, libelle: plan.libelle, prix: plan.prix, lignesPrix: plan.lignesPrix,
      blocs: (plan.blocs || []).map((b) => ({ activite: b.activite, debut: b.debut, fin: b.fin, enPlus: Boolean(b.enPlus), aVolonte: Boolean(b.aVolonte) })),
      etapes: (plan.etapes || []).map((e) => ({ activite: e.activite, debut: e.debut, fin: e.fin, libre: Boolean(e.libre), enPlus: Boolean(e.enPlus) })),
    } : null,
    bloc: zone ? {
      replie: Boolean(zone.querySelector('.rs-seance.is-replie')),
      info: t(zone.querySelector('.rs-s-n small')),
      ajouter: Boolean(zone.querySelector('.rs-ajout')),
      heures: Array.from(zone.querySelectorAll('.rs-h[data-heure]')).map((h) => ({ heure: h.dataset.heure, tient: h.dataset.tient, on: h.classList.contains('is-on'), mot: t(h.querySelector('small')), titre: h.getAttribute('title') || '' })),
    } : null,
    tuiles: Array.from(document.querySelectorAll('#quickBookOverlay .rs-pt')).map((b) => ({ id: b.id.replace(/^rsT-/, ''), on: b.classList.contains('is-on'), mot: t(b.querySelector('small')) })),
    acces: rvFormuleIllimitee() ? { choix: rsChoixIllimite().activites.slice() } : null,
  };
}, bloc);

// A 1366 x 768 : la colonne ne defile pas, aucun mot d heure n est coupe.
const mesurer = (page) => page.evaluate(() => {
  const col = document.getElementById('rsCol');
  const coupes = [...document.querySelectorAll('#quickBookOverlay .rs-h small, #quickBookOverlay .rs-pt small, #quickBookOverlay .rs-s-n small')].filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 30));
  return { hauteur: col ? col.scrollHeight - col.clientHeight : null, coupes, vue: [innerWidth, innerHeight] };
});

async function photo(page, nom, selecteur = '#quickBookOverlay .qb-modal') {
  if (mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  const cadre = page.locator(selecteur).first();
  if (await cadre.count()) await cadre.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  else await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

// Reserver, 6 joueurs, le samedi 23 : une formule a 16:00, puis retour a la page des activites.
async function formule(page, id) {
  await C.ouvrirFenetre(page, PAX);
  await page.click(`#quickBookOverlay [data-jour="${JOUR_RESA}"]`);
  await page.waitForFunction((j) => quickBookState && quickBookState.date === j, JOUR_RESA, { timeout: 8000 });
  await page.click('#quickBookOverlay #rsFormules');
  await page.waitForSelector(`#quickBookOverlay [data-formule="${id}"]`, { timeout: 8000 });
  await page.click(`#quickBookOverlay [data-formule="${id}"]`);
  await page.waitForSelector('#quickBookOverlay #rsL-a-formule', { timeout: 8000 });
  await pret(page);
  await page.locator('#quickBookOverlay .rs-s-l.is-formule [data-heure="16:00"]').click();
  await pret(page);
  await versLesActivites(page);
}
async function versLesActivites(page) {
  for (let i = 0; i < 4; i += 1) {
    if (await page.evaluate(() => rsEtat().q === 'activites')) break;
    await page.click('#quickBookOverlay #rsRetour').catch(() => {});
    await page.waitForTimeout(250);
  }
  await pret(page);
}

// « Créer » : le dossier ne en base.
async function creer(page, m) {
  const avant = new Set(B.base.reservations.keys());
  await page.fill('#quickBookOverlay #qbPhone', '0470 21 11 26');
  await pret(page);
  await page.click('#quickBookOverlay #rvCreer');
  let ids = [];
  for (let i = 0; i < 60; i += 1) { ids = [...B.base.reservations.keys()].filter((id) => !avant.has(id)); if (ids.length) break; await page.waitForTimeout(150); }
  await page.waitForTimeout(400);
  return ids;
}

// Ce que le dossier ecrit dit : sa formule, son prix, ses activites en plus et les blocs de son plan.
function enBase(id) {
  const r = enApi(id);
  const plan = r.opsPlan || {};
  const hm = (x) => String((x && x.startTime) || '').slice(0, 5);
  return {
    type: r.type, formuleId: r.formuleId || '', label: r.label, pax: r.pax, price: Number(r.price), basePrice: Number(r.basePrice), startTime: r.startTime,
    enPlus: plan.enPlus ? { prix: plan.enPlus.prix, items: (plan.enPlus.items || []).map((x) => ({ activityId: x.activityId, heure: x.heure, price: x.price })) } : null,
    bowling: (plan.resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane').map((b) => ({ debut: hm(b), fin: String(b.endTime || '').slice(0, 5), pistes: b.lanes || [], enPlus: Boolean(b.enPlus) })),
    laser: (plan.resourceBlocks || []).filter((b) => b.resourceType === 'laser_arena').map((b) => ({ debut: hm(b), enPlus: Boolean(b.enPlus), aVolonte: Boolean(b.aVolonte) })),
    illimite: plan.illimite || null,
    updatedAt: r.updatedAt,
  };
}

// Ce que la formule fait a heure fixe sur le plan du serveur, relu ici sans la console : ses blocs de bowling
// et de laser (25 min par partie), ses etapes a heure (ni libres, ni le bar ni l accueil).
function plagesDeLaFormule(plan) {
  const plages = [];
  (plan.blocs || []).filter((b) => !b.enPlus && !b.aVolonte && (b.activite === 'bowling' || b.activite === 'laser_game')).forEach((b) => {
    const debut = enMin(b.debut);
    plages.push({ debut, fin: b.activite === 'laser_game' ? debut + 25 : enMin(b.fin) });
  });
  (plan.etapes || []).filter((e) => !e.enPlus && !e.libre && e.debut && e.fin && !['bowling', 'laser_game', 'party_table', 'arcade_credit', 'playground'].includes(e.activite) && !/^service/.test(e.activite)).forEach((e) => plages.push({ debut: enMin(e.debut), fin: enMin(e.fin) }));
  return plages.filter((p) => p.fin > p.debut);
}
const chevauche = (heure, minutes, plages) => plages.some((p) => enMin(heure) < p.fin && p.debut < enMin(heure) + minutes);

// ---------------------------------------------------------------------------
// [A] FORMULE 1 + UN BOWLING EN PLUS.
// ---------------------------------------------------------------------------
async function scenarioA(browser) {
  const serveur = C.monterServeur({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [] });
  const m = await C.ouvrirConsole(browser, serveur, { port: PORT, role: 'manager', appareil: 'comptoir' });
  const { page, erreurs } = m;
  const attendu = { formule: catalogue.formule('f1'), parJoueur: catalogue.parJoueur('f1'), bowling: catalogue.activite({ activityId: 'bowling', duration: 1 }) };
  attendu.total = Math.round((attendu.formule + attendu.bowling) * 100) / 100;
  try {
    if (!(attendu.formule > 0 && attendu.bowling > 0)) throw new Error(`catalogue du banc illisible : ${JSON.stringify(attendu)}`);
    await formule(page, 'f1');
    const avant = await lire(page, 'bowling');
    const fixesAvant = avant.plan ? avant.plan.blocs.filter((b) => !b.enPlus) : [];
    ok(Boolean(avant.bloc) && avant.bloc.replie && avant.bloc.ajouter && /dans la formule/.test(avant.bloc.info) && /en plus/.test(avant.bloc.info),
      '[A1] avant : le bloc du bowling est replie, « Ajouter », et dit que la formule a deja le sien', avant.bloc);
    await photo(page, 'apres-formule1-avant-ajout');

    await page.click('#quickBookOverlay #rsAjout-bowling');
    await pret(page);
    await page.waitForTimeout(600);
    await pret(page);
    const a = await lire(page, 'bowling');
    const plages = a.plan ? plagesDeLaFormule(a.plan) : [];
    const finFormule = Math.max(...plages.map((p) => p.fin));
    const juste = `${String(Math.floor(Math.ceil(finFormule / 30) * 30 / 60)).padStart(2, '0')}:${String(Math.ceil(finFormule / 30) * 30 % 60).padStart(2, '0')}`;
    ok(a.type === 'formule' && a.formuleId === 'f1' && !a.adaptee && Boolean(a.formule) && a.formule.nom === 'Formule 1' && !a.lignes.some((l) => /^rsL-a-(bowling|laser_game|arcade_time)$/.test(l)),
      '[A1] la formule reste entiere : « Formule 1 », pas adaptee, aucune ligne par activite', { adaptee: a.adaptee, formule: a.formule, lignes: a.lignes });
    ok(JSON.stringify(a.plan && a.plan.blocs.filter((b) => !b.enPlus)) === JSON.stringify(fixesAvant) && fixesAvant.length > 0,
      '[A1] le plan de la formule ne bouge pas : son bowling et son laser gardent leurs heures', { avant: fixesAvant, apres: a.plan && a.plan.blocs });
    ok(Boolean(a.bowling) && a.enPlus.length === 1 && a.enPlus[0].id === 'bowling' && a.enPlus[0].heure === juste && a.plan && a.plan.disponible,
      `[A1] le bowling en plus est sa ligne, a ${juste}, juste apres la formule, et le plan tient`, { ligne: a.bowling, enPlus: a.enPlus, plan: a.plan && { disponible: a.plan.disponible, refus: a.plan.refus } });

    // [A2] Les heures du bowling en plus.
    const heures = a.bloc ? a.bloc.heures : [];
    const fausses = heures.filter((h) => (h.tient === '0') !== chevauche(h.heure, 60, plages));
    const tiennent = heures.filter((h) => h.tient === '1').length;
    ok(!a.bloc.replie && heures.length >= 20 && fausses.length === 0 && tiennent >= 15,
      `[A2] seules les heures qui chevauchent la formule a heure fixe ne tiennent pas (${heures.length - tiennent}) ; ${tiennent} se prennent`, { fausses, heures: heures.map((h) => `${h.heure}:${h.tient}`).join(' ') });
    ok(heures.filter((h) => h.tient === '0').every((h) => /^pendant (le|la|les|l’) /.test(h.mot) && /de la formule/.test(h.titre)),
      '[A2] chaque heure qui ne tient pas dit pendant quoi, et la phrase entiere au survol', heures.filter((h) => h.tient === '0'));
    const pendant = heures.find((h) => h.tient === '0' && plages.some((p) => enMin(h.heure) >= p.debut && enMin(h.heure) < p.fin));
    await page.click(`#quickBookOverlay #rsZ-bowling .rs-h[data-heure="${pendant.heure}"]`);
    await pret(page);
    const refuse = await lire(page, 'bowling');
    const dit = await page.evaluate(() => ((document.querySelector('#rvVerdict [role="alert"]') || {}).textContent || '').replace(/\s+/g, ' ').trim());
    ok(refuse.enPlus.length === 1 && refuse.enPlus[0].heure === juste && /ne tient pas\. Pendant (le|la|les|l’) .* de la formule, de \d\d:\d\d à \d\d:\d\d\./.test(dit),
      `[A2] ${pendant.heure}, pendant la formule, ne se prend pas : la fenetre dit pourquoi, le bowling reste a ${juste}`, { dit, enPlus: refuse.enPlus });
    const libre = heures.find((h) => h.tient === '1' && enMin(h.heure) > enMin(juste));
    await page.click(`#quickBookOverlay #rsZ-bowling .rs-h[data-heure="${libre.heure}"]`);
    await pret(page);
    const pris = await lire(page, 'bowling');
    ok(pris.enPlus.length === 1 && pris.enPlus[0].heure === libre.heure && pris.plan && pris.plan.disponible && !pris.adaptee,
      `[A2] une heure libre (${libre.heure}) se prend, la formule reste telle quelle`, { enPlus: pris.enPlus, plan: pris.plan && pris.plan.refus });

    // [A3] Le prix.
    ok(Boolean(pris.formule) && pris.formule.prix === euros(attendu.formule) && Boolean(pris.bowling) && pris.bowling.prix === euros(attendu.bowling) && pris.total === euros(attendu.total),
      `[A3] la formule a son prix (${euros(attendu.formule)}), le bowling en plus le sien (${euros(attendu.bowling)}), le total leur somme (${euros(attendu.total)})`, { formule: pris.formule, bowling: pris.bowling, total: pris.total });
    const lp = (pris.plan && pris.plan.lignesPrix) || [];
    ok(lp.length === 2 && lp[0].activite === 'formule' && centimes(lp[0].prix) === centimes(attendu.formule) && lp[1].activite === 'bowling' && lp[1].enPlus === true && centimes(lp[1].prix) === centimes(attendu.bowling) && centimes(pris.plan.prix) === centimes(attendu.total),
      '[A3] le plan du serveur dit les memes lignes : la formule, puis le bowling en plus', lp);
    const mesure = await mesurer(page);
    ok(mesure.hauteur !== null && mesure.hauteur <= 1 && mesure.coupes.length === 0, '[V1] a 1366 x 768, la fenetre tient sans defiler, aucun mot coupe (formule et bowling en plus)', mesure);
    await photo(page, 'apres-formule1-bowling-en-plus');

    // Un corps forge : le bowling en plus pose sur celui de la formule.
    const forge = await page.evaluate(async (heure) => {
      const corps = rvCorpsDeSimulation();
      corps.enPlus = [{ activityId: 'bowling', heure, duration: 1 }];
      const rep = await window.__vraiAppel('POST', '/api/staff-reservations', { ...corps, dryRun: true });
      const plan = (rep.json || {}).plan || {};
      return { statut: rep.statut, disponible: plan.disponible, refus: plan.refus || (rep.json || {}).message || '' };
    }, fixesAvant.find((b) => b.activite === 'bowling').debut);
    ok(forge.disponible === false && /chevauche le bowling de la formule/.test(forge.refus), '[A3] un corps forge qui pose le bowling en plus sur celui de la formule est refuse par le serveur', forge);

    const ids = await creer(page, m);
    ok(ids.length === 1, '[A3] un dossier, un seul, est cree', ids);
    const b = ids[0] ? enBase(ids[0]) : {};
    const enPlusEcrit = b.enPlus && b.enPlus.items[0];
    const fixes = (b.bowling || []).filter((x) => !x.enPlus);
    const ajoute = (b.bowling || []).filter((x) => x.enPlus);
    const separes = fixes.every((f) => ajoute.every((x) => enMin(x.debut) >= enMin(f.fin) || enMin(x.fin) <= enMin(f.debut)));
    ok(b.type === 'formule' && b.formuleId === 'f1' && b.label === 'FORMULE 1' && centimes(b.price) === centimes(attendu.total) && centimes(b.basePrice) === centimes(attendu.total),
      '[A3] en base, la formule f1 telle quelle (nom sans « adaptée »), son prix et sa reference comptent le bowling en plus', b);
    ok(Boolean(enPlusEcrit) && enPlusEcrit.activityId === 'bowling' && enPlusEcrit.heure === libre.heure && centimes(enPlusEcrit.price) === centimes(attendu.bowling) && ajoute.length === 1 && ajoute[0].debut === libre.heure && fixes.length === 1 && separes,
      `[A3] en base, le bowling en plus a ${libre.heure} a son prix, sa piste, sans chevaucher celui de la formule`, { enPlus: b.enPlus, bowling: b.bowling });

    // [A4] Infos : la caisse.
    const dossier = enApi(ids[0]);
    await page.evaluate((d) => { state.currentDate = d.date; state.reservations = [{ ...d }]; closeQuickBook(); openPos(d.id); setTab('details'); }, dossier);
    await page.waitForTimeout(600);
    const caisse = await page.evaluate(() => {
      const texte = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      return {
        lignes: Array.from(document.querySelectorAll('#posOverlay .fz-caisse .gc-bill-lines > div')).map((d) => {
          const dt = d.querySelector('dt');
          const petit = dt && dt.querySelector('small');
          return { nom: dt ? texte(dt).slice(0, texte(dt).length - texte(petit).length).trim() : '', detail: texte(petit), montant: texte(d.querySelector('dd')) };
        }),
        aEncaisser: texte(document.querySelector('#posOverlay .fz-caisse .pos-act-money .fz-montant')),
      };
    });
    const cF = caisse.lignes.find((l) => /FORMULE 1|Formule 1/.test(l.nom));
    const cB = caisse.lignes.find((l) => /^Bowling/.test(l.nom));
    ok(Boolean(cF) && cF.montant === euros(attendu.formule) && cF.detail === `${euros(attendu.parJoueur)} × ${PAX} joueurs` && Boolean(cB) && cB.montant === euros(attendu.bowling) && cB.detail.startsWith(`en plus, à ${libre.heure}`) && caisse.aEncaisser === euros(attendu.total),
      `[A4] la caisse dit la formule (${euros(attendu.formule)}), puis le bowling « en plus, à ${libre.heure} » (${euros(attendu.bowling)}), ${euros(attendu.total)} a encaisser`, caisse);
    await photo(page, 'apres-formule1-caisse', '#posOverlay');
    await page.evaluate(() => closePos());

    // [A5] Le mail de confirmation (rien ne part : le message est construit, pas envoye).
    const mail = require(path.join(ROOT, MAIL)).buildMessage({ reservation: enApi(ids[0]), templateId: 'confirmation', channel: 'email' });
    const details = (mail.details || []).map((d) => `${d.label} = ${d.value}`);
    ok(details.some((d) => new RegExp(`^Montant estimé = ${enMail(attendu.total)}$`).test(d)) && details.some((d) => new RegExp(`^Bowling = ${PAX} participants · en plus de la formule, à ${libre.heure} · ${enMail(attendu.bowling)}$`).test(d)),
      '[A5] le mail dit le total, et le bowling en plus de la formule, son heure et son prix', details);

    // [A6] Modifier : l heure du dossier passe de 16:00 a 16:30, le bowling en plus suit.
    const relu = enBase(ids[0]);
    const decale = `${String(Math.floor((enMin(libre.heure) + 30) / 60)).padStart(2, '0')}:${String((enMin(libre.heure) + 30) % 60).padStart(2, '0')}`;
    const patch = await serveur.appeler('PATCH', '/api/staff-reservations', { id: ids[0], centerId: 'libramont', startTime: '16:30', baseUpdatedAt: new Date(relu.updatedAt).toISOString() });
    const apres = enBase(ids[0]);
    const ajouteApres = (apres.bowling || []).filter((x) => x.enPlus);
    ok(patch.statut === 200 && apres.startTime === '16:30' && apres.enPlus && apres.enPlus.items.length === 1 && apres.enPlus.items[0].heure === decale && ajouteApres.length === 1 && ajouteApres[0].debut === decale
      && centimes(apres.price) === centimes(attendu.total) && centimes(apres.basePrice) === centimes(attendu.total),
      `[A6] Modifier decale le dossier de 30 min : le bowling en plus suit a ${decale}, le prix reste ${euros(attendu.total)}`, { statut: patch.statut, message: (patch.json || {}).message, apres });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (formule 1)', erreurs.slice(0, 3));
  } finally {
    await m.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [B] FORMULE 5 + DU LASER EN PLUS.
// ---------------------------------------------------------------------------
async function scenarioB(browser) {
  const serveur = C.monterServeur({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [] });
  const m = await C.ouvrirConsole(browser, serveur, { port: PORT, role: 'manager', appareil: 'comptoir' });
  const { page, erreurs } = m;
  const attendu = { formule: catalogue.formule('f5'), laser: catalogue.activite({ activityId: 'laser_game', games: 1 }) };
  attendu.total = Math.round((attendu.formule + attendu.laser) * 100) / 100;
  try {
    if (!(attendu.formule > 0 && attendu.laser > 0)) throw new Error(`catalogue du banc illisible : ${JSON.stringify(attendu)}`);
    await formule(page, 'f5');
    const avant = await lire(page, 'laser_game');
    const lasersAvant = avant.plan ? avant.plan.blocs.filter((b) => b.activite === 'laser_game').map((b) => b.debut) : [];
    await page.click('#quickBookOverlay #rsAjout-laser_game');
    await pret(page);
    await page.waitForTimeout(600);
    await pret(page);
    const b = await lire(page, 'laser_game');
    const lasersFormule = b.plan ? b.plan.blocs.filter((x) => x.activite === 'laser_game' && !x.enPlus).map((x) => x.debut) : [];
    ok(!b.adaptee && Boolean(b.formule) && b.formule.nom === 'Formule 5' && lasersAvant.length >= 1 && lasersAvant[0] === '16:00' && JSON.stringify(lasersFormule) === JSON.stringify(lasersAvant),
      `[B1] la formule reste entiere : son laser reste a ${lasersAvant.join(' et ')}, rien ne passe derriere l ajout`, { adaptee: b.adaptee, formule: b.formule, avant: lasersAvant, apres: lasersFormule });
    const plages = b.plan ? plagesDeLaFormule(b.plan) : [];
    const heures = b.bloc ? b.bloc.heures : [];
    const fausses = heures.filter((h) => (h.tient === '0') !== chevauche(h.heure, 25, plages));
    const x = b.enPlus[0] || {};
    ok(b.enPlus.length === 1 && x.id === 'laser_game' && enMin(x.heure) >= Math.max(...plages.map((p) => p.fin)) && b.plan && b.plan.disponible && fausses.length === 0 && heures.filter((h) => h.tient === '1').length >= 15,
      '[B2] le laser en plus part apres la formule ; seules ses heures sur la formule a heure fixe ne tiennent pas', { enPlus: b.enPlus, fausses, plan: b.plan && b.plan.refus });
    ok(Boolean(b.laser) && b.laser.prix === euros(attendu.laser) && b.total === euros(attendu.total),
      `[B2] le laser en plus a son prix (${euros(attendu.laser)}), le total compte la formule et lui (${euros(attendu.total)})`, { laser: b.laser, total: b.total });
    await photo(page, 'apres-formule5-laser-en-plus');
    const ids = await creer(page, m);
    const r = ids[0] ? enBase(ids[0]) : {};
    ok(ids.length === 1 && r.formuleId === 'f5' && r.label === 'FORMULE 5' && centimes(r.price) === centimes(attendu.total) && (r.laser || []).filter((l) => !l.enPlus).map((l) => l.debut).join() === lasersAvant.join() && (r.laser || []).some((l) => l.enPlus && l.debut === x.heure),
      '[B2] en base : la Formule 5 telle quelle, son laser a ses heures, le laser en plus au sien, le prix des deux', r);
    ok(erreurs.length === 0, '[J1] aucune erreur JS (formule 5)', erreurs.slice(0, 3));
  } finally {
    await m.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [C] UN ACCES ILLIMITE + UNE ACTIVITE EN PLUS (hors de l acces, puis comprise).
// ---------------------------------------------------------------------------
async function scenarioC(browser) {
  const serveur = C.monterServeur({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [] });
  serveur.changerSession(C.roleDe('manager'));
  const toutes = require(path.join(ROOT, 'lib/activity-catalog.js')).listCenterActivities('libramont').map((a) => a.id);
  const corps = { nom: ACCES, prixParPersonne: 32, minPax: 1, illimite: true, dureeMinutes: 180, clients: false, activites: toutes.filter((id) => id !== 'bowling').map((id) => ({ id })), aVolonte: { laser_game: true } };
  const garde = await serveur.appeler('POST', '/api/ops', { action: 'garderFormuleSurMesure', centerId: 'libramont', formule: corps });
  if (garde.statut !== 200) throw new Error(`acces illimite non garde : ${garde.statut} ${(garde.json || {}).message || ''}`);
  const m = await C.ouvrirConsole(browser, serveur, { port: PORT, role: 'manager', appareil: 'comptoir' });
  const { page, erreurs } = m;
  const attendu = { acces: 32 * PAX, bowling: catalogue.activite({ activityId: 'bowling', duration: 1 }) };
  attendu.total = Math.round((attendu.acces + attendu.bowling) * 100) / 100;
  try {
    await C.ouvrirFenetre(page, PAX);
    await page.click(`#quickBookOverlay [data-jour="${JOUR_RESA}"]`);
    await page.waitForFunction((j) => quickBookState && quickBookState.date === j, JOUR_RESA, { timeout: 8000 });
    await page.waitForFunction(() => getEffectiveCatalogFormules().some((f) => f.illimite), null, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => rsPeindreActivites && rsPeindreActivites()).catch(() => {});
    await page.locator('#rsIllimite').click();
    await page.waitForSelector('#rsAcces .rs-ill-act', { timeout: 8000 });
    // Le minigolf sort de l acces (il y reviendra par sa tuile, [C3]).
    await page.locator('[id="rsIlT-minigolf_blacklight"]').click();
    await pret(page);
    await page.locator('.rs-s-l.is-formule .rs-h[data-heure="16:00"]').click();
    await pret(page);
    await versLesActivites(page);
    const avant = await lire(page, 'bowling');
    ok(Boolean(avant.acces) && !avant.adaptee && avant.bloc && avant.bloc.replie && avant.bloc.ajouter && !/dans l’accès/.test(avant.bloc.info),
      '[C1] avant : le bowling, hors de l acces, a son « Ajouter » ; l acces est pris tel quel', { acces: avant.acces, bloc: avant.bloc });

    await page.click('#quickBookOverlay #rsAjout-bowling');
    await pret(page);
    await page.waitForTimeout(600);
    await pret(page);
    const c = await lire(page, 'bowling');
    const tuilesAcces = c.tuiles.filter((t) => t.id !== 'minigolf_blacklight');
    ok(!c.adaptee && c.formule && c.formule.nom === ACCES && Boolean(c.bowling) && c.lignes.join() === 'rsL-a-formule,rsL-p-bowling' && tuilesAcces.every((t) => t.on && t.mot === 'dans l’accès'),
      '[C1] le ticket dit l acces, puis le bowling en plus, rien d autre ; les tuiles restent celles de l acces', { lignes: c.lignes, formule: c.formule, tuiles: c.tuiles });
    const laserAVolonte = c.plan ? c.plan.blocs.filter((x) => x.activite === 'laser_game' && x.aVolonte) : [];
    const heures = c.bloc ? c.bloc.heures : [];
    ok(laserAVolonte.length > 0 && heures.length >= 20 && heures.every((h) => h.tient === '1'),
      '[C2] le laser se joue a volonte : aucune heure du bowling en plus ne dit « impossible » ni « pendant »', { aVolonte: laserAVolonte.length, heures: heures.filter((h) => h.tient !== '1') });
    await page.click('#quickBookOverlay #rsZ-bowling .rs-h[data-heure="17:00"]');
    await pret(page);
    const dix7 = await lire(page, 'bowling');
    ok(dix7.enPlus.length === 1 && dix7.enPlus[0].heure === '17:00' && dix7.plan && dix7.plan.disponible && dix7.bowling && dix7.bowling.prix === euros(attendu.bowling) && dix7.total === euros(attendu.total),
      `[C2] le bowling en plus se prend a 17:00, pendant le laser a volonte, a son prix ; le total (${euros(attendu.total)}) compte l acces et lui`, { enPlus: dix7.enPlus, plan: dix7.plan && dix7.plan.refus, bowling: dix7.bowling, total: dix7.total });

    // [C3] Le minigolf, compris dans l acces et retire, revient par sa tuile : dans l acces, sans ligne ni prix.
    await page.click('#quickBookOverlay #rsT-minigolf_blacklight');
    await pret(page);
    const golf = await lire(page, 'bowling');
    const tuile = golf.tuiles.find((t) => t.id === 'minigolf_blacklight') || {};
    ok(!golf.adaptee && golf.acces && golf.acces.choix.includes('minigolf_blacklight') && tuile.on && tuile.mot === 'dans l’accès' && golf.lignes.join() === 'rsL-a-formule,rsL-p-bowling' && golf.total === euros(attendu.total),
      '[C3] une activite que l acces comprend revient dans l acces par sa tuile : ni ligne, ni prix, l acces tel quel', { acces: golf.acces, tuile, lignes: golf.lignes, total: golf.total, adaptee: golf.adaptee });
    const mesure = await mesurer(page);
    ok(mesure.hauteur !== null && mesure.hauteur <= 1 && mesure.coupes.length === 0, '[V1] a 1366 x 768, la fenetre tient sans defiler, aucun mot coupe (acces illimite et bowling en plus)', mesure);
    await photo(page, 'apres-illimite-bowling-en-plus');

    const ids = await creer(page, m);
    const r = ids[0] ? enBase(ids[0]) : {};
    ok(ids.length === 1 && r.type === 'formule' && Boolean(r.illimite) && r.illimite.activites.includes('minigolf_blacklight') && r.enPlus && r.enPlus.items.length === 1 && r.enPlus.items[0].heure === '17:00'
      && (r.bowling || []).some((x) => x.enPlus && x.debut === '17:00') && (r.laser || []).length >= 2 && centimes(r.price) === centimes(attendu.total),
      '[C2] en base : l acces et son choix, le laser a volonte, le bowling en plus a 17:00 a son prix', r);
    ok(erreurs.length === 0, '[J1] aucune erreur JS (acces illimite)', erreurs.slice(0, 3));
  } finally {
    await m.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [D] « + AJOUTER UNE ACTIVITÉ OU UNE BOISSON » SUR UNE FORMULE.
// ---------------------------------------------------------------------------
async function scenarioD(browser) {
  const serveur = C.monterServeur({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [] });
  const m = await C.ouvrirConsole(browser, serveur, { port: PORT, role: 'manager', appareil: 'comptoir' });
  const { page, erreurs } = m;
  try {
    await formule(page, 'f5');
    await page.click('#quickBookOverlay #rsTkMesure');
    await page.waitForSelector('#quickBookOverlay .is-q-mesure', { timeout: 8000 });
    await pret(page);
    const onglets = await page.evaluate(() => Array.from(document.querySelectorAll('#quickBookOverlay .rs-tabs button')).map((b) => ({ id: b.dataset.onglet, on: b.classList.contains('is-on') })));
    ok(onglets.length > 1 && onglets[0].id === 'activites' && onglets[0].on, '[D] « Ajouter une activité ou une boisson » ouvre d abord l onglet « Activités »', onglets);
    await page.click('#quickBookOverlay #rsT-billards');
    await pret(page);
    const d = await lire(page);
    const tuile = d.tuiles.find((x) => x.id === 'billards') || {};
    ok(!d.adaptee && d.formule && d.formule.nom === 'Formule 5' && d.enPlus.length === 1 && d.enPlus[0].id === 'billards' && !d.enPlus[0].heure && d.lignes.join() === 'rsL-a-formule,rsL-p-billards' && tuile.on && tuile.mot === 'en plus',
      '[D] le billard touche s ajoute en plus de la formule, qui reste telle quelle', { adaptee: d.adaptee, formule: d.formule, enPlus: d.enPlus, lignes: d.lignes, tuile });
    // Son heure : sa ligne mene a la page des activites, son bouton d heure ouvre les demi-heures.
    await page.click('#quickBookOverlay #rsL-p-billards');
    await page.waitForSelector('#quickBookOverlay #rsHB-billards', { timeout: 8000 });
    // (la ligne ouvre deja le panneau de ses heures ; sinon, son bouton)
    if (!(await page.locator('#quickBookOverlay #rsHA-billards').count())) await page.click('#quickBookOverlay #rsHB-billards');
    await page.waitForSelector('#quickBookOverlay #rsHA-billards .rs-h[data-heure-l="18:00"]', { timeout: 8000 });
    await pret(page);
    await page.click('#quickBookOverlay #rsHA-billards .rs-h[data-heure-l="18:00"]');
    await pret(page);
    const h = await lire(page);
    const etape = h.plan ? h.plan.etapes.find((e) => e.activite === 'billards' && e.enPlus) : null;
    ok(h.enPlus.length === 1 && h.enPlus[0].heure === '18:00' && h.plan && h.plan.disponible && Boolean(etape) && etape.debut === '18:00' && !h.adaptee,
      '[D] l heure du billard en plus se pose sous sa tuile (18:00) ; le plan le place a cette heure, la formule reste telle quelle', { enPlus: h.enPlus, etape, plan: h.plan && h.plan.refus });
    ok(erreurs.length === 0, '[J1] aucune erreur JS (sur mesure)', erreurs.slice(0, 3));
  } finally {
    await m.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  // Le geste d avant : « Ajouter » adapte la formule (elle se deplie, une ligne par activite).
  { nom: 'ajouter-deplie-la-formule', lettre: 'A1', scenario: 'A', editions: [{ fichier: JS, de: '  if (rvEnPlusPossible()) {\n    const heure = rsHeureEnPlusQuiTient(id);', vers: '  if (false) {\n    const heure = rsHeureEnPlusQuiTient(id);' }] },
  // Les heures de l ajout jugees comme une ligne de la formule (la rangee d avant).
  { nom: 'heures-de-ligne', lettre: 'A2', scenario: 'A', editions: [{ fichier: JS, de: '  if (rvEnPlusPossible()) return rsHeuresEnPlusHtml(id);', vers: '' }] },
  // Le chevauchement avec la formule ignore au serveur.
  { nom: 'chevauchement-ignore', lettre: 'A3', scenario: 'A', editions: [{ fichier: FENETRE, serveur: true, de: '  const chevauche = chevauchementAvecLaFormule(dossier.opsPlan, sous.dossier.opsPlan, { illimite });', vers: '  const chevauche = null;' }] },
  // L ajout offert : la reference reste celle de la formule.
  { nom: 'ajout-offert', lettre: 'A3', scenario: 'A', editions: [{ fichier: FENETRE, serveur: true, de: '    const reference = Math.round(((Number(dossier.basePrice) || 0) + (Number(pose.lignes.prix) || 0)) * 100) / 100;', vers: '    const reference = Math.round((Number(dossier.basePrice) || 0) * 100) / 100;' }] },
  // La caisse sans la ligne de l ajout.
  { nom: 'caisse-sans-ajout', lettre: 'A4', scenario: 'A', editions: [{ fichier: JS, de: '    const enPlus = !ajouts && r.opsPlan && r.opsPlan.enPlus && Array.isArray(r.opsPlan.enPlus.items) && r.opsPlan.enPlus.items.length ? r.opsPlan.enPlus : null;', vers: '    const enPlus = null;' }] },
  // Le mail sans la ligne de l ajout.
  { nom: 'mail-sans-ajout', lettre: 'A5', scenario: 'A', editions: [{ fichier: MAIL, serveur: true, de: "  if (channel === 'email' && enPlus && Array.isArray(base.details)) {", vers: '  if (false) {' }] },
  // Modifier perd l ajout en replanifiant la formule.
  { nom: 'modifier-perd-l-ajout', lettre: 'A6', scenario: 'A', editions: [{ fichier: API, serveur: true, de: '  const reposer = Boolean(enPlusAvant) && shouldReplan && !patch.program;', vers: '  const reposer = false;' }] },
  // Le geste d avant : la Formule 5 a deja du laser, « Ajouter » ne faisait rien, aucun laser en plus.
  { nom: 'laser-en-plus-sans-geste', lettre: 'B2', scenario: 'B', editions: [{ fichier: JS, de: '  if (rvEnPlusPossible()) {\n    const heure = rsHeureEnPlusQuiTient(id);', vers: '  if (false) {\n    const heure = rsHeureEnPlusQuiTient(id);' }] },
  // L a volonte compte comme une heure fixe (au serveur et a l ecran) : « impossible » pendant tout l acces.
  { nom: 'a-volonte-fixe', lettre: 'C2', scenario: 'C', editions: [
    { fichier: EN_PLUS, serveur: true, de: '  const garde = (bloc) => Boolean(bloc) && bloc.aVolonte !== true && Boolean(bloc.enPlus) === enPlus;', vers: '  const garde = (bloc) => Boolean(bloc) && Boolean(bloc.enPlus) === enPlus;' },
    { fichier: JS, de: "    if (b.enPlus || b.aVolonte || !b.debut || (b.activite !== 'bowling' && b.activite !== 'laser_game')) return;", vers: "    if (b.enPlus || !b.debut || (b.activite !== 'bowling' && b.activite !== 'laser_game')) return;" },
  ] },
  // « Ajouter une activité ou une boisson » sans les activites : seulement les boissons et le reste.
  { nom: 'sur-mesure-sans-activites', lettre: 'D', scenario: 'D', editions: [{ fichier: JS, de: "  if (activites.length) onglets.unshift(['activites', 'Activités']);", vers: '' }] },
  // L heure d une petite activite en plus jamais posee (le panneau ne la prend pas).
  { nom: 'heure-en-plus-ignoree', lettre: 'D', scenario: 'D', editions: [{ fichier: JS, de: '      rvAjouterEnPlus(id, { heure: voulue });\n', vers: '' }] },
  // Une activite que l acces comprend se vend en plus.
  { nom: 'acces-ignore', lettre: 'C3', scenario: 'C', editions: [{ fichier: JS, de: '  if (rvDansLAcces(id)) {\n    const f = rvFormuleIllimitee();', vers: '  if (false) {\n    const f = rvFormuleIllimitee();' }] },
  // La tuile d avant : elle adapte l acces.
  { nom: 'tuile-deplie', lettre: 'C3', scenario: 'C', editions: [{ fichier: JS, de: '  if (rvEnPlusPossible()) {\n    rsGeste(() => {\n      const avant = Boolean(rvEnPlusDe(id));', vers: '  if (false) {\n    rsGeste(() => {\n      const avant = Boolean(rvEnPlusDe(id));' }] },
];

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  const scenarios = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD };
  try {
    if (!process.argv.includes('--contre-preuves')) {
      for (const lettre of ['A', 'B', 'C', 'D']) { console.log(`\n[${lettre}]`); await scenarios[lettre](browser); }
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.RFP_MUTATIONS || liste(process.env.RFP_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.RFP_BAVARD;
        try {
          await scenarios[m.scenario](browser);
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
  if (echecs) { console.error(`\nreserver-formule-en-plus-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nreserver-formule-en-plus-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

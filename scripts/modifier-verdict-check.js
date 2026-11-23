// L ONGLET MODIFIER DIT, AVANT LE CLIC, CE QUE L ENREGISTREMENT FERA (2026-11-15).
//
// Ansar, 15/11 : « la page modifier ameliore vrm bien pour quelle fonctionne
// super bien et quelle soit super intelligente pour pas faire de la merde et
// tout autorisé snas cassé ». Un robot a tape dans Modifier avec le vrai
// handler derriere : une piste prise, un laser plein, un prix au-dela du role
// ou le minimum d une formule ne se lisaient qu apres le clic ; le prix
// annonce n etait pas toujours celui ecrit (49 EUR a l ecran, 39 en base) ;
// un refus du serveur vidait la saisie ; deux phrases de fin mentaient.
// La regle : des qu une modification est en cours, la console demande au
// serveur ce que « Enregistrer » ecrirait (POST dryRun + modification,
// api/staff-reservations.js modifierABlanc : memes droits, meme calcul, meme
// ecriture sous verrou, annulee par la base) et le dit dans la barre du bas.
// Rien n est bloque : le comptoir decide, le serveur garde le dernier mot.
//   [V1] le verdict annonce ce qui arrivera : un refus annonce est un refus au
//        clic (rien d ecrit), « Vérifié au planning. » est un enregistrement
//        sans reserve ;
//   [V2] le prix du champ est le prix ecrit, y compris quand il suit le groupe
//        et que l estimation de l ecran ne tombait pas sur le calcul du serveur ;
//   [V3] le programme montre les heures que le planning donnera, et un
//        changement d heure ne pose plus de question native par-dessus ;
//   [V4] ce qui passera autrement se dit avant : d autres pistes que celles
//        cochees, un groupe serre sur une seule piste, un planning qui ne
//        suivra pas (minimum de la formule), un dossier deja encaisse dont le
//        prix change ;
//   [V5] apres un refus du serveur, la saisie reste a l ecran, a cote du motif ;
//   [V6] le calcul a blanc n ecrit rien : la ligne en base est la meme, a
//        l octet pres, et aucun PATCH n est parti ;
//   [V7] sans reponse du serveur (hors ligne, serveur d avant ce jour), la
//        console se tait et « Enregistrer » marche comme avant ;
//   [V8] le conseil des pistes ne promet plus de les « compléter » quand
//        aucune n est libre ;
//   [V9] les phrases de fin disent vrai : un bowling retire ne se lit pas
//        « pas sur les pistes demandées », un dossier deja « à vérifier » ne se
//        lit pas « le moteur n’a pas pu replacer » ;
//   [A1] deplacer un dossier a une autre annee dit l annee ;
//   [P1] sans session, le calcul a blanc repond 401 sans rien lire : la meme
//        reponse que le numero de dossier existe ou non (2026-11-16) ;
//   [J1] aucune erreur JS.
// La console reelle (scripts/planning-v3-fixtures.js, journee « pic » de Fun
// Galaxy Libramont a 15:10) ; ses PATCH et ses calculs a blanc partent au VRAI
// handler api/staff-reservations.js, sur la base en memoire de
// scripts/reserver-banc.js (aucune base reelle, aucun reseau).
// --contre-preuves : chaque regle retiree (en memoire ; le disque n est jamais
// touche) fait rougir sa lettre ; chaque ancre existe une fois et une seule.
//   MV_MUTATIONS : un sous-ensemble ; MV_BAVARD : les lignes des contre-preuves.
'use strict';
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout
// module de lib/ (aucune base reelle n est jamais ouverte).
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_MODIFIER_VERDICT_PORT || 5399);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const BASE = 'lib/database.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

const HUGO = 1602; // Formule 8, 28 EUR par personne, 10 joueurs, 6 au minimum
const CLARA = 1634; // bowling 15:00, 1h30, pistes 6 et 7, 7 joueurs, 118 EUR
const MANON = 1618; // laser 15:30, 8 joueurs
const NOAH = 1596; // Formule 4, payee 390 EUR
const LINA = 1601; // Formule 5, arrivee
const FOOT = 1616; // visite bowling + laser + arcades, deja « à vérifier »
const JULIEN = 1614; // billard, arcades, duckpin : 49 EUR pour 4

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`);
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
// La ligne telle qu elle est en base, a l octet pres (updated_at compris).
const brut = (id) => JSON.stringify(B.base.reservations.get(Number(id)) || null);
function enBase(id) {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : row.ops_plan;
  return {
    pax: Number(row.pax), prix: Number(row.price), heure: row.start_time, pistes: (row.lanes || []).map(Number).join(','),
    heures: (plan && Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : []).map((b) => `${b.activityId || b.resourceType}@${b.startTime || ''}`).join(','),
  };
}

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
function lire() {
  const m = document.querySelector('#posOverlay .edit-modal');
  const toast = ((document.getElementById('toast') || {}).textContent || '').replace(/\s+/g, ' ').trim();
  if (!m || !state.selectedRes) return { fermee: true, toast };
  const t = (s) => { const n = m.querySelector(s); return n && !n.hidden ? n.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const zone = m.querySelector('#editVerdict');
  const heures = {};
  m.querySelectorAll('.fm-act[data-edit-activity]').forEach((a) => { heures[a.dataset.editActivity] = Array.from(a.querySelectorAll('.fm-heure')).map((h) => h.textContent.trim()).join('/'); });
  return {
    fermee: false, toast,
    ton: zone ? (/is-(\w+)/.exec(zone.className) || [])[1] || '' : 'absent',
    verdict: t('#editVerdict'), erreur: t('#editError'), pied: t('#editModifs'),
    prix: (document.getElementById('editPriceInput') || {}).value, heures,
    conseil: t('#editLanesHint'), jour: t('#editJourHint'),
    barrees: Array.from(m.querySelectorAll('.fm-act .fm-heure:not(.is-vide)')).filter((h) => getComputedStyle(h).textDecorationLine.includes('line-through')).length,
  };
}

async function verdictPose(page) {
  await page.waitForTimeout(120);
  await page.waitForFunction(() => { const z = document.getElementById('editVerdict'); return Boolean(z) && !z.classList.contains('is-calcul') && !verdictEdition().enCours; }, null, { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(150);
}

// Un cas : la fiche ouverte sur Modifier, le geste, le verdict, puis le clic.
async function jouerCas(browser, { id, geste, sansBlanc = false, enregistrer = true }) {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const patchs = [];
  const reponses = [];
  const blancs = [];
  const natifs = [];
  const fenetres = [];
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil: 'ordinateur', theme: 'light', port: PORT, heure: '15:10',
    avantChargement: async (p) => {
      await p.exposeFunction('__fixtureServeur', async (corps) => { patchs.push(corps); const rep = await serveur.appeler('PATCH', '/api/staff-reservations', corps); reponses.push(rep.statut); return rep; });
      if (!sansBlanc) await p.exposeFunction('__fixtureBlanc', async (corps) => { blancs.push(corps); return serveur.appeler('POST', '/api/staff-reservations', corps); });
    },
  });
  page.on('dialog', (d) => { natifs.push(d.message()); d.accept().catch(() => {}); });
  try {
    const depart = brut(id);
    await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
    await page.waitForTimeout(150);
    await geste(page);
    await verdictPose(page);
    const avant = await page.evaluate(lire);
    const intacte = brut(id) === depart && patchs.length === 0;
    let apres = null;
    if (enregistrer) {
      await page.locator('#posOverlay .es-save').click();
      for (let i = 0; i < 50; i += 1) {
        await page.waitForTimeout(120);
        const bouton = page.locator('.staff-confirm [data-role="confirm-ok"]');
        if (await bouton.count()) { fenetres.push((await page.locator('.staff-confirm strong').textContent()) || ''); await bouton.click(); }
        const etat = await page.evaluate(() => ({ fermee: !document.querySelector('#posOverlay .edit-modal') || !state.selectedRes, erreur: Boolean((document.getElementById('editError') || {}).textContent) }));
        if (etat.fermee || etat.erreur) break;
      }
      await page.waitForTimeout(250);
      apres = await page.evaluate(lire);
    }
    return { avant, apres, intacte, ecrit: brut(id) !== depart, base: enBase(id), patchs, reponses, blancs, natifs, fenetres, erreurs: erreurs.slice() };
  } finally {
    await ctx.close();
  }
}

const champ = (sel, valeur) => async (page) => { await page.fill(`#posOverlay ${sel}`, valeur); };
const pistes = (...numeros) => async (page) => { for (const n of numeros) await page.click(`#posOverlay .lane-chip[onclick="toggleEditLane(${n})"]`); };

async function scenarioRefus(browser) {
  // Clara a 24 : il faudrait 4 pistes, deux sont libres.
  const c = await jouerCas(browser, { id: CLARA, geste: champ('#editPaxInput', '24') });
  ok(c.avant.ton === 'refus' && /Impossible de libérer 4 piste/.test(c.avant.verdict) && c.apres && !c.apres.fermee && c.patchs.length === 0 && !c.ecrit,
    '[V1] 24 joueurs sur deux pistes : « Ne passera pas » avant le clic, et le clic n ecrit rien', { verdict: c.avant.verdict, patchs: c.patchs.length, ecrit: c.ecrit });
  ok(/il n’y en a pas autant de libres/.test(c.avant.conseil) && !/complétée/.test(c.avant.conseil), '[V8] le conseil des pistes dit qu il n y en a pas assez de libres, sans promettre de les completer', c.avant.conseil);
  ok(c.intacte, '[V6] le calcul a blanc de Clara n a rien ecrit', { patchs: c.patchs.length });
  // Manon a 17:30 : le lancement de 17:30 n a plus que 6 places pour 8. (Il est 15:10 au banc : une arrivee
  // deja passee, 15:00, se dit d abord « déjà passé » depuis le 2026-11-22, avant tout autre calcul.)
  const m = await jouerCas(browser, { id: MANON, geste: champ('#editStartInput', '17:30') });
  ok(m.avant.ton === 'refus' && /Lancement de 17:30/.test(m.avant.verdict) && m.patchs.length === 0 && !m.ecrit, '[V1] un lancement laser plein se lit avant le clic', m.avant.verdict);
  // Un prix a zero, au-dela de ce que le role peut ajuster : le serveur refuse.
  const p = await jouerCas(browser, { id: CLARA, geste: champ('#editPriceInput', '0') });
  ok(p.avant.ton === 'refus' && /20 % au plus : 23,60 €/.test(p.avant.verdict) && p.reponses.join() === '403' && !p.ecrit,
    '[V1] un prix au-dela du role : le refus du serveur se lit avant le clic, ecrit comme un prix (23,60 €)', { verdict: p.avant.verdict, reponses: p.reponses });
  ok(p.apres && !p.apres.fermee && p.apres.prix === '0' && /Prix 118 € → 0 €/.test(p.apres.pied) && /Rien n’a été enregistré/.test(p.apres.erreur),
    '[V5] apres le refus du serveur, le prix tape et ce qui partait restent a l ecran, a cote du motif', p.apres);
  // Lina passe en Formule 4 : ses pistes ne sont pas libres a l heure de son bowling.
  const l = await jouerCas(browser, { id: LINA, geste: async (page) => { await page.selectOption('#posOverlay #editFormuleSelect', 'f4'); } });
  // (la cause dite au comptoir, 2026-11-22 : « Ce créneau vient de changer » est la phrase du formulaire
  // en ligne, api/staff-reservations.js PHRASE_PISTES_PRISES)
  ok(l.avant.ton === 'refus' && /Pas de piste libre pour ce groupe à cette heure\./.test(l.avant.verdict) && !/vient de changer/.test(l.avant.verdict) && l.reponses.join() === '400'
    && l.apres && /Pas de piste libre pour ce groupe à cette heure\./.test(l.apres.erreur),
    '[V1] des pistes prises a l heure du bowling : le refus du serveur se lit avant le clic, « Pas de piste libre pour ce groupe à cette heure. », et le clic le redit', { verdict: l.avant.verdict, erreur: l.apres && l.apres.erreur, reponses: l.reponses });
  ok(l.apres && !l.apres.fermee && /Formule 5 → Formule 4/.test(l.apres.pied) && !l.ecrit, '[V5] apres ce refus, la formule choisie reste a l ecran', l.apres && l.apres.pied);
  ok([c, m, p, l].every((x) => !x.erreurs.length), '[J1] aucune erreur JS (refus)', [c, m, p, l].flatMap((x) => x.erreurs).slice(0, 3));
}

async function scenarioPasse(browser) {
  // Julien de 4 a 6 : l ecran estimait 49 EUR, le serveur ecrit 39.
  const j = await jouerCas(browser, { id: JULIEN, geste: champ('#editPaxInput', '6') });
  ok(j.avant.ton === 'ok' && j.avant.verdict === 'Vérifié au planning.' && j.apres && j.apres.fermee && j.apres.toast === 'Réservation mise à jour',
    '[V1] un groupe qui grandit sans rien coincer : « Vérifié au planning. », puis un enregistrement sans reserve', { verdict: j.avant.verdict, toast: j.apres && j.apres.toast });
  ok(j.intacte && j.blancs.length >= 1, '[V6] le calcul a blanc de Julien n a rien ecrit (la ligne est la meme a l octet pres, aucun PATCH)', { blancs: j.blancs.length });
  ok(Number(j.avant.prix) === j.base.prix && /→ 39 €/.test(j.avant.pied), '[V2] le prix du champ est celui que le serveur ecrit (39 €, pas l estimation de l ecran)', { champ: j.avant.prix, base: j.base.prix, pied: j.avant.pied });
  // Clara a 16:30 : la piste 6 est prise, il reste la 7.
  const c = await jouerCas(browser, { id: CLARA, geste: champ('#editStartInput', '16:30') });
  ok(c.avant.heures.bowling === '16:30' && c.avant.barrees === 0 && c.base.heures === 'bowling@16:30' && c.natifs.length === 0,
    '[V3] le programme montre l heure que le planning donnera (16:30, non barree), sans question native au clic', { heures: c.avant.heures, barrees: c.avant.barrees, base: c.base.heures, natifs: c.natifs });
  ok(c.avant.ton === 'attention' && /7 joueurs sur la seule piste 7/.test(c.avant.verdict) && c.base.pistes === '7', '[V4] un groupe serre sur la seule piste libre : dit avant le clic', { verdict: c.avant.verdict, pistes: c.base.pistes });
  // Clara sur les pistes 3 et 4, prises a 15:00.
  const p = await jouerCas(browser, { id: CLARA, geste: pistes(6, 7, 3, 4) });
  ok(p.avant.ton === 'attention' && /Ce sera pistes 6, 7, pas 3, 4/.test(p.avant.verdict) && p.base.pistes === '6,7', '[V4] des pistes cochees mais prises : celles qui seront attribuees se lisent avant le clic', { verdict: p.avant.verdict, pistes: p.base.pistes });
  // Hugo a 3 : la Formule 8 demande 6 personnes.
  const h = await jouerCas(browser, { id: HUGO, geste: champ('#editPaxInput', '3') });
  ok(h.avant.ton === 'attention' && /Le planning ne suivra pas : Minimum 6 personnes pour FORMULE 8\./.test(h.avant.verdict) && Number(h.avant.prix) === h.base.prix,
    '[V4] sous le minimum de la formule : « Le planning ne suivra pas », avant le clic, et le prix du champ est celui ecrit', { verdict: h.avant.verdict, champ: h.avant.prix, base: h.base.prix });
  // Noah, deja encaisse 390 EUR, passe a 12.
  const n = await jouerCas(browser, { id: NOAH, geste: champ('#editPaxInput', '12') });
  ok(n.avant.ton === 'attention' && /Déjà encaissé 390 € : il restera 78 € à encaisser\./.test(n.avant.verdict) && n.base.prix === 468, '[V4] un dossier deja encaisse dont le prix monte : ce qui reste a encaisser se lit avant le clic', { verdict: n.avant.verdict, base: n.base.prix });
  // Le Club de foot (deja « à vérifier ») sans son bowling.
  const f = await jouerCas(browser, { id: FOOT, geste: async (page) => { await page.click('#posOverlay [data-edit-activity="bowling"] .fm-retirer'); } });
  ok(f.apres && f.apres.fermee && f.base.pistes === '' && !/pas sur les pistes demandées/.test(f.apres.toast) && !/n’a pas pu replacer/.test(f.apres.toast),
    '[V9] un bowling retire d un dossier deja « à vérifier » : la phrase de fin ne parle ni de pistes refusees ni de moteur', f.apres && f.apres.toast);
  ok([j, c, p, h, n, f].every((x) => !x.erreurs.length), '[J1] aucune erreur JS (enregistrements)', [j, c, p, h, n, f].flatMap((x) => x.erreurs).slice(0, 3));
}

async function scenarioMuet(browser) {
  // Aucun calcul a blanc ne repond : la console se tait, le clic marche.
  const c = await jouerCas(browser, { id: CLARA, geste: champ('#editPaxInput', '2'), sansBlanc: true });
  ok(c.avant.ton === '' && c.avant.verdict === '' && c.apres && c.apres.fermee && c.base.pax === 2 && c.reponses.join() === '200',
    '[V7] sans reponse du serveur, pas un mot dans la barre, et « Enregistrer » ecrit comme avant', { ton: c.avant.ton, verdict: c.avant.verdict, pax: c.base.pax, reponses: c.reponses });
  // Un autre jour, une autre annee.
  const a = await jouerCas(browser, { id: CLARA, geste: champ('#editDateInput', '2028-03-01') });
  ok(/2028/.test(a.avant.jour) && a.fenetres.length === 1 && /1 mars 2028/.test(a.fenetres[0]), '[A1] deplacer a une autre annee : l annee se lit dans la fiche et dans la question', { jour: a.avant.jour, fenetres: a.fenetres });
  ok(!c.erreurs.length && !a.erreurs.length, '[J1] aucune erreur JS (muet, autre annee)', c.erreurs.concat(a.erreurs).slice(0, 3));
}

// [P1] LA PORTE (2026-11-16). Le calcul a blanc lisait le dossier AVANT de demander une
// session : un inconnu recevait 404 pour un numero libre et un refus pour un numero pris,
// de quoi compter les dossiers d un centre. Le vrai handler, sans navigateur.
async function scenarioPorte() {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [] });
  serveur.changerSession(null);
  const demander = (id) => serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', modification: { id, pax: 2 } }).catch((e) => ({ statut: 500, json: { message: String(e && e.message) } }));
  const connu = await demander(CLARA);
  const inconnu = await demander(999999);
  ok(connu.statut === 401 && inconnu.statut === 401 && JSON.stringify(connu.json) === JSON.stringify(inconnu.json) && !connu.json.modification,
    '[P1] sans session, le calcul a blanc repond 401, la meme reponse que le dossier existe ou non', { connu, inconnu });
}

const REFUS = ['refus'];
const PASSE = ['passe'];
const MUTATIONS = [
  { nom: 'a-blanc-ecrit', lettre: 'V6', scenarios: PASSE, editions: [{ fichier: BASE, serveur: true, de: 'temoin.ligne = await ecrireLaModification(client, input, versionAttendue); throw temoin; });', vers: 'temoin.ligne = await ecrireLaModification(client, input, versionAttendue); });\n      throw temoin;' }] },
  // (la phrase du formulaire en ligne revient dans « Modifier », avant le clic)
  { nom: 'pistes-prises-du-formulaire', lettre: 'V1', scenarios: REFUS, editions: [{ fichier: 'api/staff-reservations.js', serveur: true, de: '    dansLesMotsDuComptoir(error);\n', vers: '' }] },
  { nom: 'verdict-muet', lettre: 'V1', scenarios: REFUS, editions: [{ fichier: JS, de: '    v.resultat = reponse && reponse.modification === true ? lireVerdictEdition(reponse, envoi) : null;', vers: '    v.resultat = null;' }] },
  { nom: 'refus-de-l-ecran-tu', lettre: 'V1', scenarios: REFUS, editions: [{ fichier: JS, de: '  if (envoi.erreur) { v.resultat = { refus: envoi.erreur, lignes: [], ecrit: null, prixSuivi: false }; peindreVerdictEdition(); return; }', vers: '  if (envoi.erreur) { peindreVerdictEdition(); return; }' }] },
  { nom: 'prix-de-l-ecran', lettre: 'V2', scenarios: PASSE, editions: [{ fichier: JS, de: '  const ecrit = prixDuVerdictEdition();\n  if (ecrit != null) return ecrit;\n', vers: '' }] },
  { nom: 'heures-d-avant', lettre: 'V3', scenarios: PASSE, editions: [{ fichier: JS, de: '  const heures = ecrit ? heuresDuProgrammeEnregistre(ecrit) : formuleChangeeEdition() ? new Map() : heuresDuProgrammeEnregistre(dossierPourFormule(r));', vers: '  const heures = heuresDuProgrammeEnregistre(dossierPourFormule(r));' }] },
  { nom: 'question-native', lettre: 'V3', scenarios: PASSE, editions: [{ fichier: JS, de: 'origine?.opsPlan?.resourceBlocks?.length && !dossierEcritDuVerdict()) {', vers: 'origine?.opsPlan?.resourceBlocks?.length) {' }] },
  { nom: 'pistes-tues', lettre: 'V4', scenarios: PASSE, editions: [{ fichier: JS, de: "  if (!envoi.jourChange && envoi.requiresLanes && voulues && voulues !== obtenues) {", vers: '  if (false) {' }] },
  { nom: 'paye-tu', lettre: 'V4', scenarios: PASSE, editions: [{ fichier: JS, de: "  if (r.status === 'paid' && !montantsMasques() && Number.isFinite(prix)", vers: "  if (false && Number.isFinite(prix)" }] },
  { nom: 'planning-tu', lettre: 'V4', scenarios: PASSE, editions: [{ fichier: JS, de: '  if (reponse.planNonRefait) lignes.push(', vers: '  if (false) lignes.push(' }] },
  { nom: 'saisie-perdue', lettre: 'V5', scenarios: REFUS, editions: [{ fichier: JS, de: "    applyOptimisticReservation(previousReservation);\n    // La saisie est GARDEE", vers: "    applyOptimisticReservation(previousReservation, { preserveEditState: true });\n    // La saisie est GARDEE" }] },
  { nom: 'conseil-qui-promet', lettre: 'V8', scenarios: REFUS, editions: [{ fichier: JS, de: '    if (jour && (!libres || libres.length < requis)) return', vers: '    if (false) return' }] },
  { nom: 'pistes-refusees-a-tort', lettre: 'V9', scenarios: PASSE, editions: [{ fichier: JS, de: "    if (!items.some((item) => item.activityId === 'bowling')) lanesVoulues.length = 0;\n", vers: '' }] },
  { nom: 'moteur-accuse-a-tort', lettre: 'V9', scenarios: PASSE, editions: [{ fichier: JS, de: " && !(previousReservation && previousReservation.validationStatus === 'staff_review');", vers: ';' }] },
  { nom: 'blanc-sans-porte', lettre: 'P1', scenarios: ['porte'], editions: [{ fichier: 'api/staff-reservations.js', serveur: true, de: '        if (!(await requireAnyStaffSession(req, res))) return;\n        await warmCenterKnowledge();\n        const blanc = await modifierABlanc(', vers: '        await warmCenterKnowledge();\n        const blanc = await modifierABlanc(' }] },
  { nom: 'annee-tue', lettre: 'A1', scenarios: ['muet'], editions: [{ fichier: JS, de: "...(autreAnnee ? { year: 'numeric' } : {}) });", vers: '});' }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'refus') await scenarioRefus(browser);
    if (nom === 'passe') await scenarioPasse(browser);
    if (nom === 'muet') await scenarioMuet(browser);
    if (nom === 'porte') await scenarioPorte();
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, ['refus', 'passe', 'muet', 'porte']);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.MV_MUTATIONS || liste(process.env.MV_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.MV_BAVARD;
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
  if (echecs) { console.error(`\nmodifier-verdict-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nmodifier-verdict-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

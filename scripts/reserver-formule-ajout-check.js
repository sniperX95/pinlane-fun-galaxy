// RESERVER : UNE ACTIVITE AJOUTEE A LA FORMULE SE PAIE (2026-11-21).
//
// Dans Reserver, la Formule 5 (6 joueurs, laser 2 parties, minigolf, 2 cruches) a laquelle le comptoir
// ajoutait un Bowling restait a 156 EUR : le ticket disait « Formule 5, adaptée 156 € », la ligne du
// Bowling n avait pas de prix, « Adapter à ce groupe » promettait « même prix » et le dossier cree valait
// 156 EUR. Le Bowling partait offert. La regle est celle de Modifier (lib/formule-adaptee.js,
// scripts/formule-adaptee-check.js) : la formule garde son prix par joueur, une activite que sa carte n a
// pas s y ajoute a son prix du catalogue, sur sa ligne (lib/reserver-fenetre.js chiffrerLaFormuleAdaptee,
// assets/app-main.js rvAjoutsALaFormule). Reserver n a pas d echange : « même prix » valait pour tout
// geste (retirer ou ajouter) ; retirer ne baisse rien, le comptoir baisse le total a la main.
//
// La vraie console (scripts/planning-v3-fixtures.js, journee « pic », samedi 16 janvier 2027 a 15:10),
// de vrais clics ; ses POST (le plan a blanc et la creation) partent au VRAI handler
// api/staff-reservations.js, au vrai moteur et a la vraie lib/database.js, sur la base en memoire de
// scripts/reserver-banc.js : aucune base reelle, aucun reseau, aucun mail ne part. Les montants attendus
// se lisent au catalogue du banc, jamais ecrits ici.
//   [T1] Reserver, 6 joueurs, le samedi suivant, Formule 5 a 13:00, puis « Ajouter » le Bowling, a 15:30 :
//        le ticket dit « Formule 5, adaptée » a son prix (6 joueurs × 26 €) puis le Bowling au sien ; le
//        laser et le minigolf, dans la formule, n ont pas de prix ; le total est leur somme ;
//   [T2] la page Total : le recu dit les memes deux lignes et le meme total ; le champ Total reste
//        modifiable, la reference en indice ;
//   [T3] « Adapter à ce groupe » ne promet plus « même prix » ;
//   [C1] « Créer » : le corps envoye garde la formule (formule, f5, nom adapte, le Bowling au programme)
//        et n impose aucun prix ; le plan du serveur dit le meme total et les memes lignes que Modifier ;
//   [C2] le dossier cree garde la formule f5 ; son prix et sa reference valent la formule plus le
//        Bowling ; son programme ne compte que le Bowling ; le Bowling est a 15:30 ;
//   [I1] Infos : l en-tete dit FORMULE 5 ; la caisse dit « FORMULE 5, 26 € × 6 joueurs » puis « Bowling »
//        a leurs montants, et le total a encaisser ;
//   [M1] le mail de confirmation dit le meme total, le Bowling a son prix, le laser et le minigolf
//        « dans la formule » ;
//   [P1] un total tape a la main (avec sa raison) est celui facture ; la reference reste la formule plus
//        le Bowling, la formule reste ;
//   [J1] aucune erreur JS.
// --contre-preuves : chaque regle retiree (au code servi ou au serveur, en memoire ; le disque n est
// jamais touche) fait rougir sa lettre : le Bowling non paye (au serveur, au ticket, au recu), la formule
// perdue, ce que la formule comprend paye a tort (au serveur, au ticket), les lignes du plan, le total
// tape ignore, « même prix » promis.
//   RFA_PORT : le port du site servi ; RFA_CAPTURES : le dossier des captures (captures-nuit) ;
//   RFA_MUTATIONS : un sous-ensemble (noms separes par des virgules) ; RFA_BAVARD : le detail.
'use strict';
const PORT = Number(process.env.RFA_PORT || process.env.PINLANE_RESERVER_FORMULE_AJOUT_PORT || 6620);
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
const CAPTURES = process.env.RFA_CAPTURES || path.join(ROOT, 'captures-nuit');
const JS = 'assets/app-main.js';
const FENETRE = 'lib/reserver-fenetre.js';
const LIB = 'lib/formule-adaptee.js';
const GOLF = 'minigolf_blacklight';
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

// ---------------------------------------------------------------------------
// LE BANC : la journee de la fixture en base ; le dossier se cree le samedi suivant, un jour sans
// vacances ou la Formule 5 se vend.
// ---------------------------------------------------------------------------
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
const JOUR_RESA = (() => { const d = new Date(`${JOUR}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
const PAX = 6;
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
// Ce que le catalogue du banc dit, lu a chaque fois (une contre-preuve recharge les modules).
const catalogue = {
  formule: (pax) => require(path.join(ROOT, 'lib/booking-config.js')).getBasePrice('formule', 0, 0, pax, 'f5', 'libramont'),
  parJoueur: () => require(path.join(ROOT, 'lib/booking-config.js')).getBasePrice('formule', 0, 0, 1, 'f5', 'libramont'),
  bowling: (pax) => {
    const ligne = require(path.join(ROOT, 'lib/visit-program.js')).normalizeProgram([{ activityId: 'bowling', duration: 1 }], { centerId: 'libramont', pax, dateStr: JOUR_RESA, staff: true }).items[0];
    return ligne && ligne.priceKnown ? Number(ligne.price) : NaN;
  },
};
const euros = (n) => `${String(Math.round(Number(n) * 100) / 100).replace('.', ',')} €`;
const centimes = (n) => Math.round(Number(n) * 100);
const montantDe = (t) => Number(String(t || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
// (le mail ecrit ses montants a la belge, une espace insecable avant le signe)
const enMail = (n) => `${String(Math.round(Number(n) * 100) / 100).replace('.', ',')}\\s€`;
const enApi = (id) => require(path.join(ROOT, 'lib/database.js')).mapReservation(B.base.reservations.get(Number(id)));
function enBase(id) {
  const r = enApi(id);
  const plan = r.opsPlan || {};
  const hm = (x) => String((x && x.startTime) || '').slice(0, 5);
  return {
    type: r.type, formuleId: r.formuleId || '', label: r.label, pax: r.pax, price: Number(r.price), basePrice: Number(r.basePrice), notes: r.notes || '',
    prixProgramme: r.program ? Number(r.program.price) : null,
    items: ((r.program && r.program.items) || []).map((i) => i.activityId).sort(),
    bowling: (plan.resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane').map(hm),
  };
}

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
async function monter(browser, serveur) {
  const posts = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil: 'ordinateur', theme: 'light', port: PORT, heure: '15:10',
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
// La ligne du ticket : son nom, ses petites lignes, son prix ; puis le total du ticket.
function lireTicket() {
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const ligne = (cle) => {
    const b = document.getElementById(`rsL-a-${cle}`);
    if (!b) return null;
    const n = b.querySelector('.rs-tk-n');
    return { nom: t(n && n.querySelector('b')), details: Array.from((n && n.querySelectorAll('small')) || []).map(t), prix: t(b.querySelector('em')) };
  };
  return {
    ids: rvActivites(),
    adaptee: Boolean(quickBookState.adaptee),
    heures: Object.fromEntries(Object.entries(rvHeuresDesLignes()).map(([id, l]) => [id, l.heure || ''])),
    formule: ligne('formule'), bowling: ligne('bowling'), laser: ligne('laser_game'), minigolf: ligne('minigolf_blacklight'),
    total: t(document.getElementById('rvTotalPied')),
    plan: (() => { const p = rvPlanCourant(); return p ? { prix: p.prix, prixReference: p.prixReference, libelle: p.libelle, lignesPrix: p.lignesPrix } : null; })(),
  };
}
const lireRecu = (page) => page.evaluate(() => ({
  total: ((document.querySelector('#quickBookOverlay .rs-total-g') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  lignes: [...document.querySelectorAll('#quickBookOverlay .rs-recu li')].map((li) => {
    const span = li.querySelector('span');
    return {
      nom: span ? Array.from(span.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim() : '',
      detail: ((li.querySelector('small') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      montant: ((li.querySelector('b') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    };
  }),
  champ: (() => { const c = document.getElementById('qbCustomPrice'); return c ? { indice: c.placeholder, actif: !c.disabled && !c.readOnly, vu: c.getClientRects().length > 0 } : null; })(),
}));
// Infos : l en-tete et la caisse (ses lignes et ce qui est a encaisser).
const infosLues = (page) => page.evaluate(() => {
  const texte = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const formule = document.querySelector('#posOverlay .fx-formule');
  const caisse = Array.from(document.querySelectorAll('#posOverlay .fz-caisse .gc-bill-lines > div')).map((d) => {
    const dt = d.querySelector('dt');
    const petit = dt && dt.querySelector('small');
    return { nom: dt ? texte(dt).slice(0, texte(dt).length - texte(petit).length).trim() : '', detail: texte(petit), montant: texte(d.querySelector('dd')) };
  });
  return { formule: texte(formule), aLaCarte: Boolean(formule && formule.classList.contains('is-carte')), caisse, aEncaisser: texte(document.querySelector('#posOverlay .fz-caisse .pos-act-money .fz-montant')) };
});
async function photo(page, nom, selecteur = '#quickBookOverlay .qb-modal') {
  if (mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  const cadre = page.locator(selecteur).first();
  if (await cadre.count()) await cadre.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  else await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

// Reserver, 6 joueurs, le samedi suivant, la Formule 5 a 13:00 ; puis le Bowling ajoute, a 15:30.
// Rend ce que « Adapter à ce groupe » promet, lu sur la page de la formule avant l ajout.
async function composer(page) {
  await page.locator('.btn-new').first().click();
  await page.waitForSelector('#quickBookOverlay .qb-modal.rv.rs', { timeout: 8000 });
  await page.click(`#quickBookOverlay [data-pax="${PAX}"]`);
  await planPose(page);
  await page.click('#quickBookOverlay #rsFormules');
  await page.click(`#quickBookOverlay [data-jour="${JOUR_RESA}"]`);
  await page.waitForFunction((j) => quickBookState && quickBookState.date === j, JOUR_RESA, { timeout: 8000 });
  await page.click('#quickBookOverlay [data-formule="f5"]');
  await page.waitForSelector('#quickBookOverlay #rsL-a-formule', { timeout: 8000 });
  await planPose(page);
  await page.click('#quickBookOverlay .rs-s-l.is-formule [data-heure="13:00"]');
  await planPose(page);
  await page.click('#quickBookOverlay #rsL-a-formule');
  await page.waitForSelector('#quickBookOverlay #rvAdapter', { timeout: 8000 });
  const promesse = await page.evaluate(() => (document.getElementById('rvAdapter') || {}).textContent.replace(/\s+/g, ' ').trim());
  for (let i = 0; i < 3 && !(await page.locator('#quickBookOverlay #rsAjout-bowling').count()); i += 1) {
    await page.click('#quickBookOverlay #rsRetour');
    await page.waitForTimeout(300);
  }
  await page.click('#quickBookOverlay #rsAjout-bowling');
  await planPose(page);
  await page.click('#quickBookOverlay #rsZ-bowling [data-heure="15:30"]');
  await planPose(page);
  return promesse;
}
// « Créer » : le corps qui part et le dossier ne en base.
async function creer(page, posts) {
  const avant = new Set(B.base.reservations.keys());
  await page.fill('#quickBookOverlay #qbPhone', '0470 21 11 26');
  await planPose(page);
  const n = posts.length;
  await page.click('#quickBookOverlay #rvCreer');
  for (let i = 0; i < 80; i += 1) { await page.waitForTimeout(150); if (posts.slice(n).some((p) => !p.dryRun)) break; }
  let ids = [];
  for (let i = 0; i < 40; i += 1) { ids = [...B.base.reservations.keys()].filter((id) => !avant.has(id)); if (ids.length) break; await page.waitForTimeout(150); }
  await page.waitForTimeout(400);
  return { corps: posts.slice(n).find((p) => !p.dryRun) || null, ids };
}

// ---------------------------------------------------------------------------
// LE SCENARIO.
// ---------------------------------------------------------------------------
async function scenario(browser) {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs, posts } = await monter(browser, serveur);
  const attendu = { formule: catalogue.formule(PAX), parJoueur: catalogue.parJoueur(), bowling: catalogue.bowling(PAX) };
  attendu.total = Math.round((attendu.formule + attendu.bowling) * 100) / 100;
  try {
    if (!(attendu.formule > 0 && attendu.bowling > 0)) throw new Error(`catalogue du banc illisible : ${JSON.stringify(attendu)}`);

    // [T3] et [T1] : la Formule 5, puis le Bowling a 15:30.
    const promesse = await composer(page);
    ok(/^Adapter à ce groupe/.test(promesse) && !/même prix/i.test(promesse), '[T3] « Adapter à ce groupe » ne promet plus « même prix »', promesse);
    const t = await page.evaluate(lireTicket);
    ok(t.adaptee && t.ids.includes('bowling') && t.heures.bowling === '15:30', '[T1] le Bowling est au ticket, a 15:30, la formule adaptee', { ids: t.ids, heures: t.heures, adaptee: t.adaptee });
    ok(Boolean(t.formule) && /^Formule 5, adaptée$/.test(t.formule.nom) && t.formule.prix === euros(attendu.formule) && t.formule.details.includes(`${PAX} joueurs × ${euros(attendu.parJoueur)}`),
      `[T1] la ligne de la formule dit « Formule 5, adaptée », ${PAX} joueurs × ${euros(attendu.parJoueur)}, ${euros(attendu.formule)}`, t.formule);
    ok(Boolean(t.bowling) && t.bowling.prix === euros(attendu.bowling), `[T1] la ligne du Bowling dit son prix du catalogue (${euros(attendu.bowling)})`, t.bowling);
    ok(Boolean(t.laser) && Boolean(t.minigolf) && t.laser.prix === '' && t.minigolf.prix === '', '[T1] le laser et le minigolf, dans la formule, n ont pas de prix a eux', { laser: t.laser, minigolf: t.minigolf });
    ok(t.total === euros(attendu.total), `[T1] le total du ticket est la formule plus le Bowling (${euros(attendu.total)})`, t.total);
    await photo(page, 'reserver-formule-ajout-ticket');

    // [T2] La page Total.
    await page.click('#quickBookOverlay #rsL-total');
    await page.waitForSelector('#quickBookOverlay .rs-recu li', { timeout: 6000 }).catch(() => null);
    const r = await lireRecu(page);
    const rF = r.lignes.find((l) => /^Formule 5/.test(l.nom));
    const rB = r.lignes.find((l) => /^Bowling/.test(l.nom));
    ok(r.lignes.length === 2 && Boolean(rF) && rF.montant === euros(attendu.formule) && Boolean(rB) && rB.montant === euros(attendu.bowling) && r.total === euros(attendu.total),
      `[T2] le recu dit la Formule 5 (${euros(attendu.formule)}) puis le Bowling (${euros(attendu.bowling)}), total ${euros(attendu.total)}`, r);
    ok(Boolean(r.champ) && r.champ.vu && r.champ.actif && centimes(r.champ.indice) === centimes(attendu.total), '[T2] le champ Total reste modifiable, la reference en indice', r.champ);
    await photo(page, 'reserver-formule-ajout-total');

    // [C1] « Créer » : le corps et le plan.
    const plan = (await page.evaluate(lireTicket)).plan;
    const cree = await creer(page, posts);
    const corps = cree.corps || {};
    const programme = Array.isArray(corps.program) ? corps.program : ((corps.program || {}).items || []);
    ok(corps.type === 'formule' && corps.formuleId === 'f5' && /^FORMULE 5 \(adaptée\)$/.test(corps.label || '') && programme.some((i) => i.activityId === 'bowling') && corps.price === undefined,
      '[C1] le corps de « Créer » garde la formule (formule, f5, nom adapte, le Bowling au programme) et n impose aucun prix', { type: corps.type, formuleId: corps.formuleId, label: corps.label, price: corps.price, programme: programme.map((i) => i.activityId) });
    const lignesPlan = (plan && plan.lignesPrix) || [];
    ok(Boolean(plan) && centimes(plan.prix) === centimes(attendu.total) && centimes(plan.prixReference) === centimes(attendu.total)
      && lignesPlan.length === 2 && lignesPlan[0].activite === 'formule' && centimes(lignesPlan[0].prix) === centimes(attendu.formule)
      && lignesPlan[1].activite === 'bowling' && centimes(lignesPlan[1].prix) === centimes(attendu.bowling),
      '[C1] le plan du serveur dit le meme total et les lignes de Modifier : la formule, puis le Bowling', plan);

    // [C2] Le dossier cree.
    ok(cree.ids.length === 1, '[C2] un dossier, un seul, est cree', cree.ids);
    const id = cree.ids[0];
    const b = id ? enBase(id) : {};
    ok(b.type === 'formule' && b.formuleId === 'f5' && /FORMULE 5/.test(b.label || ''), '[C2] en base, le dossier garde la formule f5 (type, formule, nom)', b);
    ok(centimes(b.price) === centimes(attendu.total) && centimes(b.basePrice) === centimes(attendu.total),
      `[C2] en base, le prix et la reference valent la formule plus le Bowling, lus au catalogue du banc (${attendu.formule} + ${attendu.bowling} = ${attendu.total})`, b);
    ok(centimes(b.prixProgramme) === centimes(attendu.bowling) && b.items.includes('bowling') && JSON.stringify(b.bowling) === '["15:30"]',
      '[C2] en base, le programme ne compte que le Bowling ajoute, et le Bowling est a 15:30', b);

    // [I1] Infos.
    const dossier = enApi(id);
    await page.evaluate((d) => { state.currentDate = d.date; state.reservations = [{ ...d }]; closePos(); openPos(d.id); setTab('details'); }, dossier);
    await page.waitForTimeout(500);
    const i1 = await infosLues(page);
    const cF = i1.caisse.find((l) => /FORMULE 5/.test(l.nom));
    const cB = i1.caisse.find((l) => /^Bowling/.test(l.nom));
    ok(/FORMULE 5/.test(i1.formule) && !i1.aLaCarte, '[I1] l en-tete dit FORMULE 5, pas « À la carte »', i1.formule);
    ok(Boolean(cF) && cF.detail === `${euros(attendu.parJoueur)} × ${PAX} joueurs` && cF.montant === euros(attendu.formule) && Boolean(cB) && cB.montant === euros(attendu.bowling)
      && !i1.caisse.some((l) => /Laser|Minigolf/.test(l.nom)),
      `[I1] la caisse dit « FORMULE 5, ${euros(attendu.parJoueur)} × ${PAX} joueurs » puis « Bowling » a leurs montants`, i1.caisse);
    ok(i1.aEncaisser === euros(attendu.total), `[I1] la caisse dit ${euros(attendu.total)} a encaisser`, i1.aEncaisser);
    await photo(page, 'reserver-formule-ajout-infos', '#posOverlay');

    // [M1] Le mail de confirmation (rien ne part : le message est construit, pas envoye).
    const mail = require(path.join(ROOT, 'lib/ops-communications.js')).buildMessage({ reservation: enApi(id), templateId: 'confirmation', channel: 'email' });
    const details = (mail.details || []).map((d) => `${d.label} = ${d.value}`);
    const dit = (re) => details.some((d) => re.test(d));
    ok(dit(new RegExp(`^Montant estimé = ${enMail(attendu.total)}$`)) && dit(new RegExp(`^Bowling = .* · ${enMail(attendu.bowling)}`))
      && dit(/^Laser Game = .* · dans la formule/) && dit(/^Minigolf Blacklight = .* · dans la formule/),
      '[M1] le mail dit le meme total, le Bowling a son prix, le laser et le minigolf « dans la formule »', details);

    // [P1] Un total tape a la main : il est facture, la reference reste.
    await page.evaluate(() => closePos());
    await composer(page);
    await page.click('#quickBookOverlay #rsL-total');
    await page.waitForSelector('#quickBookOverlay #qbCustomPrice', { timeout: 6000 });
    const tape = Math.round((attendu.total - 20) * 100) / 100;
    await page.fill('#quickBookOverlay #qbCustomPrice', String(tape));
    await page.click('#quickBookOverlay #rsRaison-0');
    await planPose(page);
    const tapeLu = await page.evaluate(lireTicket);
    const deux = await creer(page, posts);
    const p = deux.ids.length === 1 ? enBase(deux.ids[0]) : {};
    ok(tapeLu.total === euros(tape) && (deux.corps || {}).price === tape && p.type === 'formule' && p.formuleId === 'f5' && centimes(p.price) === centimes(tape) && centimes(p.basePrice) === centimes(attendu.total) && /"type":"prix"/.test(p.notes || ''),
      `[P1] un total tape (${tape}) est celui facture ; la reference reste ${attendu.total}, la formule aussi, la note dit le prix revu`, { ticket: tapeLu.total, envoye: (deux.corps || {}).price, base: { ...p, notes: String(p.notes || '').slice(-160) } });
    ok(erreurs.length === 0, '[J1] aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  // Le Bowling offert au serveur : la reference reste celle de la formule (la regle d avant).
  { nom: 'bowling-offert-au-serveur', lettre: 'C2', editions: [{ fichier: FENETRE, serveur: true, de: '  const programmeAdapte = formuleAdaptee ? chiffrerLaFormuleAdaptee(request, ops, formuleAdaptee, envoye) : null;', vers: '  const programmeAdapte = null;' }] },
  // Le ticket ne chiffre pas l ajout : la formule porte tout le total, le Bowling sans prix.
  { nom: 'bowling-sans-prix-au-ticket', lettre: 'T1', editions: [{ fichier: JS, de: '  const ids = rvActivites().filter((id) => !comprises.has(id));\n  if (!ids.length) return null;', vers: '  return null;' }] },
  // Le recu de la page Total sans la ligne de l ajout.
  { nom: 'recu-sans-ajout', lettre: 'T2', editions: [{ fichier: JS, de: '    (ajouts ? ajouts.ajoutees : []).forEach(({ id, montant }) => {', vers: '    ([]).forEach(({ id, montant }) => {' }] },
  // La formule perdue : le serveur relit le programme en visite a la carte.
  { nom: 'formule-perdue', lettre: 'C2', editions: [{ fichier: FENETRE, serveur: true, de: "  return formuleId && items.length ? formuleId : '';", vers: "  return '';" }] },
  // Ce que la formule comprend paye a tort : au serveur, le laser et le minigolf se chiffrent en plus.
  { nom: 'formule-payee-a-tort-au-serveur', lettre: 'C2', editions: [{ fichier: LIB, serveur: true, de: '  return new Set((formule && Array.isArray(formule.steps) ? formule.steps : [])', vers: '  return new Set(([])' }] },
  // ... et au ticket, ou le laser de la formule dirait un prix.
  { nom: 'formule-payee-a-tort-au-ticket', lettre: 'T1', editions: [{ fichier: JS, de: '  const comprises = activitesDeLaFormuleEdition(formule);\n  const ids = rvActivites()', vers: '  const comprises = new Set();\n  const ids = rvActivites()' }] },
  // Le plan redit chaque activite a la carte, pas les lignes de Modifier.
  { nom: 'plan-a-la-carte', lettre: 'C1', editions: [{ fichier: FENETRE, serveur: true, de: '  const deModifier = Boolean(adaptee) && (adaptee.enPlus || !adaptee.ajouts.ajoutees.length);', vers: '  const deModifier = false;' }] },
  // Le total tape ignore : la reference est facturee.
  { nom: 'total-tape-ignore', lettre: 'P1', editions: [{ fichier: FENETRE, serveur: true, de: '  request.price = envoye !== null ? envoye : prixAvecExtras(reference.total, request.extras);', vers: '  request.price = prixAvecExtras(reference.total, request.extras);' }] },
  // « Adapter à ce groupe » promet encore « même prix ».
  { nom: 'meme-prix-promis', lettre: 'T3', editions: [{ fichier: JS, de: "'retirer ou ajouter une activité, un ajout se paie'", vers: "'retirer ou ajouter une activité, même prix'" }] },
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
      for (const m of MUTATIONS.filter((x) => !process.env.RFA_MUTATIONS || liste(process.env.RFA_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.RFA_BAVARD;
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
  if (echecs) { console.error(`\nreserver-formule-ajout-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nreserver-formule-ajout-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

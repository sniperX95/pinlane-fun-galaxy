// UNE FORMULE ADAPTEE RESTE SA FORMULE (2026-11-20, dossier 1953 de Gembloux).
//
// La Formule 5 du dossier 1953 (6 joueurs, laser 2 parties, minigolf, 2 cruches, 156 EUR) prenait un
// Bowling a 15:30 dans Modifier ; le verdict disait « La formule devient une visite à la carte. », et
// apres « Enregistrer » l en-tete disait « À la carte », le laser se chiffrait 18 EUR par joueur, le
// minigolf « au comptoir », les cruches sortaient de l addition et le total ne valait plus rien. Le
// serveur relisait tout programme envoye en visite (lib/reservation-request.js) et Modifier ecrivait ce
// type par-dessus celui de la formule (api/staff-reservations.js, lib/formule-adaptee.js).
//
// La vraie console (scripts/planning-v3-fixtures.js, le samedi « pic »), de vrais clics ; ses PATCH et
// son calcul a blanc partent au VRAI handler, au vrai moteur et a la vraie lib/database.js, sur la base
// en memoire de reserver-banc (aucun reseau, aucune base reelle, aucun mail ne part). Gembloux a une
// seule piste. Les montants attendus se lisent au catalogue du banc, jamais ecrits ici.
//   [A1] Modifier, un Bowling ajoute a 15:30 : le verdict ne dit pas « visite à la carte » ; le detail
//        du prix dit la Formule 5 (« 26 € × 6 ») puis le Bowling a son prix du catalogue ; le champ
//        Total est leur somme ;
//   [A2] « Enregistrer » : en base, la Formule 5 (type, formule, nom adapte), le Bowling a 15:30 sur la
//        piste 1, les cruches au plan, le prix et la reference egaux a la formule plus le Bowling ; le
//        toast ne dit pas « visite à la carte » ;
//   [A3] Infos : l en-tete dit FORMULE 5 ; le programme garde les cruches et le Bowling a 15:30, une
//        ligne par activite ; la caisse dit « FORMULE 5, 26 € × 6 joueurs » et « Bowling » a leurs
//        montants, et le total a encaisser ;
//   [A4] le mail de confirmation dit le meme total, le Bowling a son prix, le laser et le minigolf
//        « dans la formule » ;
//   [R1] retirer le laser de la Formule 5 : la formule reste, son prix aussi, et elle ne retient plus
//        d armes, ni au serveur ni au planning ;
//   [R2] l heure du Bowling ajoute changee : la formule et son prix restent ;
//   [R3] le comptoir baisse le total a la main : il s ecrit, la formule reste, la note dit le prix revu ;
//   [V1] Reserver, le meme geste a la creation (Formule 5 et Bowling) : la formule reste ;
//   [O1] un dossier d avant se lit comme avant : celui que l ancien serveur a fait visite a la carte, et
//        une formule adaptee « au même prix » (Reserver) dont l addition garde sa seule ligne ;
//   [J1] aucune erreur JS.
// --contre-preuves : chaque regle retiree (au code servi ou au serveur, en memoire ; le disque n est
// jamais touche) fait rougir sa lettre.
//   FA_PORT : le port du site servi ; FA_CAPTURES : le dossier des captures (avant, apres) ;
//   FA_MUTATIONS : un sous-ensemble (noms separes par des virgules) ; FA_BAVARD : le detail.
'use strict';
const PORT = Number(process.env.FA_PORT || process.env.PINLANE_FORMULE_ADAPTEE_PORT || 6420);
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout module de lib/.
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = process.env.FA_CAPTURES || path.join(ROOT, 'captures-soir');
const JS = 'assets/app-main.js';
const API = 'api/staff-reservations.js';
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
// LE BANC : Gembloux a une seule piste, la journee de la fixture, le catalogue du centre.
// ---------------------------------------------------------------------------
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
const SESSION = () => B.sessionDuRole('manager', { nom: 'Rachel', centre: 'gembloux' });
function unePiste(oui) {
  B.base.centers = oui ? [{ id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', timezone: 'Europe/Brussels', settings: { config: { resources: { bowling: { laneCount: 1 } } } } }] : [];
  require(path.join(ROOT, 'lib/ops-knowledge.js')).getCenter('gembloux').resources.bowling.laneCount = oui ? 1 : 8;
}
function serveurDuBanc(editions = []) {
  const serveur = B.monter({ mutations: editions, session: SESSION() });
  unePiste(true);
  return serveur;
}
// Ce que le catalogue du banc dit, lu a chaque fois (une contre-preuve recharge les modules).
const catalogue = {
  formule: (pax) => require(path.join(ROOT, 'lib/booking-config.js')).getBasePrice('formule', 0, 0, pax, 'f5', 'gembloux'),
  parJoueur: () => require(path.join(ROOT, 'lib/booking-config.js')).getBasePrice('formule', 0, 0, 1, 'f5', 'gembloux'),
  bowling: (pax) => {
    const ligne = require(path.join(ROOT, 'lib/visit-program.js')).normalizeProgram([{ activityId: 'bowling', duration: 1 }], { centerId: 'gembloux', pax, dateStr: JOUR, staff: true }).items[0];
    return ligne && ligne.priceKnown ? Number(ligne.price) : NaN;
  },
};
const euros = (n) => `${String(Math.round(Number(n) * 100) / 100).replace('.', ',')} €`;
const centimes = (n) => Math.round(Number(n) * 100);
// (le mail ecrit ses montants a la belge, une espace insecable avant le signe)
const enMail = (n) => `${String(Math.round(Number(n) * 100) / 100).replace('.', ',')}\\s€`;

async function creer(serveur, champs) {
  const rep = await serveur.appeler('POST', '/api/staff-reservations', B.corpsStaff({ centerId: 'gembloux', date: JOUR, status: 'confirmed', ...champs }));
  if (rep.statut !== 201 || !rep.json.reservation) throw new Error(`dossier pas cree : ${rep.statut} ${JSON.stringify(rep.json).slice(0, 200)}`);
  return rep.json.reservation;
}
const formule5 = (serveur, nom = 'Dossier 1953') => creer(serveur, { type: 'formule', formuleId: 'f5', label: 'FORMULE 5', pax: 6, duration: 1.5, startTime: '13:00', name: nom, phone: '0470195300' });
const enApi = (id) => require(path.join(ROOT, 'lib/database.js')).mapReservation(B.base.reservations.get(Number(id)));
function enBase(id) {
  const r = enApi(id);
  const plan = r.opsPlan || {};
  const hm = (x) => String((x && x.startTime) || '').slice(0, 5);
  return {
    type: r.type, formuleId: r.formuleId || '', label: r.label, pax: r.pax, price: Number(r.price), basePrice: Number(r.basePrice), lanes: r.lanes || [], notes: r.notes || '',
    items: ((r.program && r.program.items) || []).map((i) => i.activityId).sort(),
    bowling: (plan.resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane').map((b) => `${hm(b)}|${(b.lanes || []).join('+')}`),
    cruches: (plan.timeline || []).filter((e) => e && e.activityId === 'service_drinks').length,
  };
}

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
async function monter(browser, serveur) {
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil: 'ordinateur', theme: 'light', port: PORT, heure: '10:00',
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => { const rep = await serveur.appeler('PATCH', '/api/staff-reservations', corps); journal.push({ corps, statut: rep.statut, json: rep.json }); return rep; });
      await page.exposeFunction('__fixtureBlanc', async (corps) => serveur.appeler('POST', '/api/staff-reservations', corps));
    },
  });
  // (la page lit la configuration de Libramont : Gembloux n a qu une piste, la console aussi)
  await m.page.evaluate(() => { const b = centerScheduleConfig && centerScheduleConfig.resources && centerScheduleConfig.resources.bowling; if (b) b.laneCount = 1; });
  return { ...m, journal };
}
// Le dossier, et lui seul, dans la journee de la page ; puis sa fiche, sur l onglet voulu.
async function ouvrir(page, r, onglet) {
  await page.evaluate(({ d, o }) => {
    const jour = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
    jour.splice(0, jour.length, { ...d });
    state.reservations = [{ ...d }];
    closePos(); openPos(d.id); setTab(o);
  }, { d: r, o: onglet });
  await page.waitForTimeout(350);
}
async function verdictPose(page) {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => { const z = document.getElementById('editVerdict'); return Boolean(z) && !z.classList.contains('is-calcul') && !verdictEdition().enCours; }, null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(250);
}
const verdictLu = (page) => page.evaluate(() => { const z = document.getElementById('editVerdict'); return z && z.getClientRects().length ? { ton: z.className, texte: z.textContent.replace(/\s+/g, ' ').trim() } : { ton: '', texte: '' }; });
async function ajouterBowling(page, heure) {
  await page.click('#posOverlay .fm-ajouts .fm-ajout[onclick*="\'bowling\'"]');
  await page.waitForSelector('#posOverlay [data-heure-nouvelle="bowling"]', { timeout: 5000 });
  await page.fill('#posOverlay [data-heure-nouvelle="bowling"]', heure);
  await verdictPose(page);
}
// Le detail du prix de Modifier et son champ Total.
const prixModifierLu = (page) => page.evaluate(() => ({
  lignes: Array.from(document.querySelectorAll('#posOverlay .dossier-price-detail .edit-prix-detail li')).map((li) => {
    const span = li.querySelector('span');
    return {
      nom: span ? Array.from(span.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() : '',
      detail: ((li.querySelector('em') || {}).textContent || '').trim(),
      montant: ((li.querySelector('b') || {}).textContent || '').trim(),
    };
  }),
  total: (document.getElementById('editPriceInput') || {}).value || '',
}));
// « Enregistrer » : chaque PATCH part au vrai handler ; une fenetre de confirmation se valide.
async function enregistrer(page, journal) {
  const avant = journal.length;
  await page.click('#posOverlay .es-save');
  const t = Date.now();
  let vu = -1;
  while (Date.now() - t < 20000) {
    await page.waitForTimeout(200);
    const confirmer = page.locator('.staff-confirm [data-role="confirm-ok"]');
    if (await confirmer.count()) await confirmer.first().click();
    const fini = await page.evaluate(() => !heuresEnregistrementEnCours);
    if (fini && journal.length === vu && journal.length > avant) break;
    vu = journal.length;
  }
  await page.waitForTimeout(300);
  const toast = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  return { envois: journal.slice(avant), toast: toast.replace(/\s+/g, ' ').trim() };
}
// Infos : l en-tete, le programme (une ligne par etape) et la caisse (ses lignes et ce qui est a encaisser).
const infosLues = (page) => page.evaluate(() => {
  const texte = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const formule = document.querySelector('#posOverlay .fx-formule');
  const etapes = Array.from(document.querySelectorAll('#posOverlay .fx-programme .gc-step')).filter((li) => li.getClientRects().length).map((li) => {
    const t = li.querySelector('.gc-step-time');
    const fin = t && t.querySelector('small');
    return { heure: t ? (fin ? t.textContent.slice(0, t.textContent.length - fin.textContent.length) : t.textContent).trim() : '', nom: texte(li.querySelector('.gc-step-what b')) };
  });
  const caisse = Array.from(document.querySelectorAll('#posOverlay .fz-caisse .gc-bill-lines > div')).map((d) => {
    const dt = d.querySelector('dt');
    const petit = dt && dt.querySelector('small');
    return { nom: dt ? texte(dt).slice(0, texte(dt).length - texte(petit).length).trim() : '', detail: texte(petit), montant: texte(d.querySelector('dd')) };
  });
  return { formule: texte(formule), aLaCarte: Boolean(formule && formule.classList.contains('is-carte')), etapes, caisse, aEncaisser: texte(document.querySelector('#posOverlay .fz-caisse .pos-act-money .fz-montant')) };
});
async function photo(page, nom) {
  if (mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

// Le corps que Modifier envoyait pour le 1953 (le Bowling ajoute, son heure tapee, le prix qui suit).
const CORPS_1953 = (r) => {
  const corps = { ...r, program: { items: [{ activityId: 'laser_game', games: 2, pax: 6, participants: 6 }, { activityId: GOLF, pax: 6, participants: 6 }, { activityId: 'bowling', duration: 1, pax: 6, participants: 6 }] },
    label: 'FORMULE 5 (adaptée)', heuresPosees: { bowling: '15:30' }, lanes: [], laneCount: 0, requiresLanes: true, channel: 'staff', allowPastStart: true, baseUpdatedAt: r.updatedAt };
  delete corps.price;
  return corps;
};

// ---------------------------------------------------------------------------
// [A1] .. [A4], [R1] .. [R3], [V1], [O1] : LE DOSSIER 1953.
// ---------------------------------------------------------------------------
const PERTE = [{ fichier: API, serveur: true, de: "  const formuleGardee = shouldReplan && ops.program && String(patch.type ?? current.type) === 'formule'\n", vers: "  const formuleGardee = false && ops.program && String(patch.type ?? current.type) === 'formule'\n" }];
async function scenario1953(browser) {
  unePiste(true);
  B.semer([]);
  // (l ancien serveur, pour la capture d avant et [O1] : ce que le 1953 est devenu en production)
  const ancien = serveurDuBanc(PERTE);
  const casse = await formule5(ancien, 'Dossier 1953 (avant)');
  const ecrit = await ancien.appeler('PATCH', '/api/staff-reservations', CORPS_1953(casse));
  const serveur = serveurDuBanc(mutation ? mutation.editions.filter((ed) => ed.serveur) : []);
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  const pax = 6;
  const attendu = { formule: catalogue.formule(pax), parJoueur: catalogue.parJoueur(), bowling: catalogue.bowling(pax) };
  attendu.total = Math.round((attendu.formule + attendu.bowling) * 100) / 100;
  try {
    if (!(attendu.formule > 0 && attendu.bowling > 0)) throw new Error(`catalogue du banc illisible : ${JSON.stringify(attendu)}`);
    // [O1] Le dossier que l ancien serveur a ecrit se lit comme il a ete ecrit : une visite a la carte.
    const vieux = enApi(casse.id);
    await ouvrir(page, vieux, 'details');
    const iv = await infosLues(page);
    ok(ecrit.statut === 200 && vieux.type !== 'formule' && !vieux.formuleId && iv.aLaCarte && iv.caisse.some((l) => /Laser/.test(l.nom)),
      '[O1] le 1953 ecrit par l ancien serveur reste une visite a la carte, lue comme avant (son addition ligne par ligne)', { statut: ecrit.statut, type: vieux.type, infos: iv });
    await photo(page, 'formule-adaptee-avant');
    // (il tient la piste unique a 15:30 : la suite se joue sans lui)
    B.base.reservations.delete(Number(casse.id));

    // [A1] Modifier : la Formule 5 prend un Bowling a 15:30.
    const f5 = await formule5(serveur);
    await ouvrir(page, f5, 'modifier');
    await ajouterBowling(page, '15:30');
    const v1 = await verdictLu(page);
    ok(v1.texte && !/visite à la carte/i.test(v1.texte) && !/is-refus/.test(v1.ton), '[A1] le verdict ne dit pas « visite à la carte » et ne refuse rien', v1);
    const p1 = await prixModifierLu(page);
    const ligneF = p1.lignes.find((l) => /FORMULE 5/.test(l.nom));
    const ligneB = p1.lignes.find((l) => /^Bowling/.test(l.nom));
    ok(Boolean(ligneF) && ligneF.detail === `${euros(attendu.parJoueur)} × ${pax}` && ligneF.montant === euros(attendu.formule)
      && Boolean(ligneB) && ligneB.montant === euros(attendu.bowling) && p1.lignes.length === 2,
      `[A1] le detail du prix dit la Formule 5 (${euros(attendu.parJoueur)} × ${pax}, ${euros(attendu.formule)}) puis le Bowling a son prix du catalogue (${euros(attendu.bowling)})`, p1);
    ok(centimes(p1.total) === centimes(attendu.total), `[A1] le champ Total dit la formule plus le Bowling (${attendu.total})`, p1.total);

    // [A2] « Enregistrer ».
    const e2 = await enregistrer(page, journal);
    const b2 = enBase(f5.id);
    ok(e2.envois.length >= 1 && e2.envois.every((x) => x.statut === 200) && !/visite à la carte/i.test(e2.toast), '[A2] « Enregistrer » passe, et le toast ne dit pas « visite à la carte »', { toast: e2.toast, statuts: e2.envois.map((x) => [x.statut, x.json && x.json.message]) });
    ok(b2.type === 'formule' && b2.formuleId === 'f5' && /FORMULE 5/.test(b2.label), '[A2] en base, le dossier reste la Formule 5 (type, formule, nom)', b2);
    ok(b2.items.includes('bowling') && JSON.stringify(b2.bowling) === JSON.stringify(['15:30|1']) && JSON.stringify(b2.lanes) === '[1]', '[A2] en base, le Bowling a 15:30 sur la piste 1', b2);
    ok(b2.cruches > 0, '[A2] en base, les cruches restent au plan', b2);
    ok(centimes(b2.price) === centimes(attendu.total) && centimes(b2.basePrice) === centimes(attendu.total), `[A2] en base, le prix et la reference sont la formule plus le Bowling (${attendu.total})`, b2);

    // [A3] Infos.
    await page.evaluate((id) => { closePos(); openPos(id); setTab('details'); }, f5.id);
    await page.waitForTimeout(350);
    const i3 = await infosLues(page);
    ok(/FORMULE 5/.test(i3.formule) && !i3.aLaCarte, '[A3] l en-tete dit FORMULE 5, pas « À la carte »', i3.formule);
    const noms = i3.etapes.map((e) => e.nom);
    ok(i3.etapes.some((e) => /cruche|boisson/i.test(e.nom)) && i3.etapes.some((e) => e.nom === 'Bowling' && e.heure === '15:30')
      && noms.filter((n) => n === 'Minigolf Blacklight').length === 1,
      '[A3] le programme garde les cruches et le Bowling a 15:30, une ligne par activite', i3.etapes);
    const cF = i3.caisse.find((l) => /FORMULE 5/.test(l.nom));
    const cB = i3.caisse.find((l) => /^Bowling/.test(l.nom));
    ok(Boolean(cF) && cF.detail === `${euros(attendu.parJoueur)} × ${pax} joueurs` && cF.montant === euros(attendu.formule) && Boolean(cB) && cB.montant === euros(attendu.bowling)
      && !i3.caisse.some((l) => /Laser|Minigolf/.test(l.nom)),
      `[A3] la caisse dit « FORMULE 5, ${euros(attendu.parJoueur)} × ${pax} joueurs » puis « Bowling » a leurs montants`, i3.caisse);
    ok(i3.aEncaisser === euros(attendu.total), `[A3] la caisse dit ${euros(attendu.total)} a encaisser`, i3.aEncaisser);
    await photo(page, 'formule-adaptee-apres');

    // [A4] Le mail de confirmation (rien ne part : le message est construit, pas envoye).
    const mail = require(path.join(ROOT, 'lib/ops-communications.js')).buildMessage({ reservation: enApi(f5.id), templateId: 'confirmation', channel: 'email' });
    const details = (mail.details || []).map((d) => `${d.label} = ${d.value}`);
    const dit = (re) => details.some((d) => re.test(d));
    ok(dit(new RegExp(`^Montant estimé = ${enMail(attendu.total)}$`)) && dit(new RegExp(`^Bowling = .* · ${enMail(attendu.bowling)}`))
      && dit(/^Laser Game = .* · dans la formule/) && dit(/^Minigolf Blacklight = .* · dans la formule/),
      '[A4] le mail dit le meme total, le Bowling a son prix, le laser et le minigolf « dans la formule »', details);

    // [R2] L heure du Bowling ajoute changee : la formule et son prix restent.
    await page.evaluate((id) => { closePos(); openPos(id); setTab('modifier'); }, f5.id);
    await page.waitForTimeout(350);
    const cles = await page.evaluate(() => Array.from(document.querySelectorAll('#posOverlay [data-heure-cle]')).map((b) => b.dataset.heureCle));
    const cle = cles.find((c) => /^bowling/.test(c));
    if (!cle) throw new Error(`aucune heure de Bowling a toucher : ${cles.join(', ')}`);
    await page.locator(`#posOverlay [data-heure-cle="${cle}"]`).first().click();
    await page.fill(`#posOverlay [data-heure-champ="${cle}"]`, '16:30');
    await verdictPose(page);
    const v2 = await verdictLu(page);
    const e5 = await enregistrer(page, journal);
    const b5 = enBase(f5.id);
    ok(b5.type === 'formule' && b5.formuleId === 'f5' && JSON.stringify(b5.bowling) === JSON.stringify(['16:30|1']) && centimes(b5.price) === centimes(attendu.total) && !/visite à la carte/i.test(`${v2.texte} ${e5.toast}`),
      '[R2] l heure du Bowling passe a 16:30 : la formule et son prix restent', { verdict: v2, toast: e5.toast, base: b5, statuts: e5.envois.map((x) => x.statut) });

    // [R3] Le comptoir baisse le total a la main.
    await page.evaluate((id) => { closePos(); openPos(id); setTab('modifier'); }, f5.id);
    await page.waitForTimeout(350);
    const baisse = Math.round((attendu.total - 20) * 100) / 100;
    await page.fill('#editPriceInput', String(baisse));
    await verdictPose(page);
    const e6 = await enregistrer(page, journal);
    const b6 = enBase(f5.id);
    ok(b6.type === 'formule' && b6.formuleId === 'f5' && centimes(b6.price) === centimes(baisse) && centimes(b6.basePrice) === centimes(attendu.total) && /"type":"prix"/.test(b6.notes),
      `[R3] un total baisse a la main (${baisse}) s ecrit, la formule et sa reference restent, la note dit le prix revu`, { base: { ...b6, notes: b6.notes.slice(-160) }, statuts: e6.envois.map((x) => [x.statut, x.json && x.json.message]) });

    // [R1] Retirer le laser d une Formule 5 : la formule reste, son prix aussi.
    // (le 1953 tient l arene a 13:00 : la suite se joue sans lui)
    B.base.reservations.delete(Number(f5.id));
    const g = await formule5(serveur, 'Sans laser');
    await ouvrir(page, g, 'modifier');
    await page.click('#posOverlay .fm-act[data-edit-activity="laser_game"] .fm-retirer');
    await verdictPose(page);
    const v7 = await verdictLu(page);
    const p7 = await prixModifierLu(page);
    const e7 = await enregistrer(page, journal);
    const b7 = enBase(g.id);
    // (l envoi passe et le programme s ecrit : refuse, le dossier restait la Formule 5 d avant, et ce constat restait vert)
    ok(e7.envois.length > 0 && e7.envois.every((x) => x.statut === 200) && b7.items.includes(GOLF) && /\(adaptée\)/.test(b7.label)
      && b7.type === 'formule' && b7.formuleId === 'f5' && !b7.items.includes('laser_game') && centimes(b7.price) === centimes(attendu.formule) && centimes(p7.total) === centimes(attendu.formule) && !/visite à la carte/i.test(v7.texte),
      `[R1] le laser retire : la Formule 5 reste a ${attendu.formule}, a l ecran comme en base`, { verdict: v7, prix: p7, base: b7, statuts: e7.envois.map((x) => [x.statut, x.json && x.json.message]) });
    // Sans son laser, elle ne retient plus d armes : une partie de 30 joueurs se pose a 13:00, son heure
    // d arrivee, et le planning ne lui dessine aucune session.
    const plein = await serveur.appeler('POST', '/api/staff-reservations', B.corpsStaff({ centerId: 'gembloux', date: JOUR, status: 'confirmed', type: 'laser', pax: 30, duration: 0.5, startTime: '13:00', name: 'Arene pleine', phone: '0470195303' }));
    const sessions = await page.evaluate((id) => getLaserWindowsFromReservation(state.reservations.find((x) => x.id === id) || {}).length, g.id);
    ok(plein.statut === 201 && sessions === 0, '[R1] sans son laser, la Formule 5 ne retient plus d armes : ni au serveur (30 joueurs a 13:00 passent), ni au planning', { statut: plein.statut, message: plein.json && plein.json.message, sessions });
    if (plein.json && plein.json.reservation) B.base.reservations.delete(Number(plein.json.reservation.id));

    // [V1] Reserver, le meme geste a la creation : la Formule 5 avec un Bowling reste la Formule 5.
    const cree = await creer(serveur, { type: 'formule', formuleId: 'f5', label: 'FORMULE 5 (adaptée)', pax, duration: 1.5, startTime: '13:00', name: 'Par Reserver', phone: '0470195302',
      program: { items: [{ activityId: 'laser_game', games: 2 }, { activityId: GOLF }, { activityId: 'bowling', duration: 1 }] },
      // (la preference que la fenetre envoie, rvPreference : l ordre et les heures du bowling et du laser)
      preference: { activityOrder: ['laser_game', GOLF, 'bowling'], preferredTimes: { laser_game: '13:00', bowling: '15:30' }, laserGameTimes: ['13:00', '13:30'], laserPlacement: 'scheduled' } });
    const parReserver = enBase(cree.id);
    ok(parReserver.type === 'formule' && parReserver.formuleId === 'f5' && parReserver.items.includes('bowling') && parReserver.cruches > 0,
      '[V1] Reserver garde la Formule 5 avec son Bowling et ses cruches', parReserver);
    // [O1] Une formule adaptee « au même prix » (ce que Reserver ecrit aujourd hui) garde sa seule ligne d addition.
    const ligne = B.base.reservations.get(Number(cree.id));
    ligne.base_price = attendu.formule;
    ligne.price = attendu.formule;
    const memePrix = enApi(cree.id);
    await ouvrir(page, memePrix, 'details');
    const io = await infosLues(page);
    ok(!io.caisse.some((l) => /^Bowling/.test(l.nom)) && io.aEncaisser === euros(attendu.formule) && /FORMULE 5/.test(io.formule),
      '[O1] une formule adaptee « au même prix » se lit comme avant : son addition sans ligne Bowling, son prix de formule', io);
    ok(erreurs.length === 0, '[J1] aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
    unePiste(false);
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  // La perte de la formule d avant : le serveur relit le programme en visite a la carte.
  { nom: 'formule-perdue', lettre: 'A1', editions: PERTE },
  // Le Bowling ajoute offert : la reference reste celle de la formule.
  { nom: 'bowling-pas-chiffre', lettre: 'A2', editions: [{ fichier: LIB, serveur: true, de: '  return { prixFormule, ajouts, total: (centimes(prixFormule) + centimes(ajouts.montant)) / 100 };', vers: '  return { prixFormule, ajouts, total: prixFormule };' }] },
  // Les cruches retirees de la formule adaptee.
  { nom: 'cruches-retirees', lettre: 'A2', editions: [{ fichier: 'lib/reservation-ops.js', serveur: true, de: '    if (ETAPES_NON_EDITABLES.has(id)) { steps.push({ ...step }); return; }', vers: '    if (ETAPES_NON_EDITABLES.has(id)) return;' }] },
  // Les pistes lues sur la carte de la Formule 5 : le Bowling ajoute n en a plus.
  { nom: 'pistes-de-la-carte', lettre: 'A2', editions: [{ fichier: 'lib/database.js', serveur: true, de: '  if (pistesAdaptees !== null) return pistesAdaptees;\n', vers: '' }] },
  // Modifier chiffre la formule adaptee sans ce qu elle ajoute.
  { nom: 'detail-sans-ajout', lettre: 'A1', editions: [{ fichier: JS, de: "  const ajoutees = editProgramAChange() ? getEditProgramItems().filter((item) => !comprises.has(String(item.activityId || ''))) : [];", vers: '  const ajoutees = [];' }] },
  // L addition de Infos d une seule ligne, la formule au total.
  { nom: 'addition-sans-ajout', lettre: 'A3', editions: [{ fichier: JS, de: '    const ajouts = ajoutsDeLaFormuleAdaptee(r, base);', vers: '    const ajouts = null;' }] },
  // Le programme de Infos redit le minigolf de la formule.
  { nom: 'programme-en-double', lettre: 'A3', editions: [{ fichier: JS, de: '  items.filter(item => !item.planned && !item.waitOffer && !parLaFormule.has(item.activityId)).forEach((item, index) => {', vers: '  items.filter(item => !item.planned && !item.waitOffer).forEach((item, index) => {' }] },
  // Le laser retire garde l heure de son ancien plan : le moteur refuse le geste.
  { nom: 'laser-retire-refuse', lettre: 'R1', editions: [{ fichier: 'lib/reservation-ops.js', serveur: true, de: '  const presentes = activitesDuProgramme(request);\n', vers: '  const presentes = null;\n' }] },
  // La Formule 5 sans son laser en retient encore les armes : au serveur, puis au planning.
  { nom: 'laser-retire-retenu', lettre: 'R1', editions: [{ fichier: 'lib/database.js', serveur: true, de: "  if (require('./formule-adaptee').laserRetireDeLaFormule(reservation)) return [];\n", vers: '' }] },
  { nom: 'laser-retire-dessine', lettre: 'R1', editions: [{ fichier: 'assets/booking-core.js', de: "  if (/\\(adapt[ée]e\\)/i.test(String(reservation.label || '')) && (reservation.program?.items || []).length && !getProgramLaserGameCount(reservation)) return [];\n", vers: '' }] },
  // Le mail chiffre chaque activite a la carte.
  { nom: 'mail-a-la-carte', lettre: 'A4', editions: [{ fichier: 'lib/ops-communications.js', serveur: true, de: "    const dansLaFormule = (item) => Boolean(adaptee) && (adaptee.comprises.has(String(item.activityId || '')) || !adaptee.enPlus);", vers: '    const dansLaFormule = () => false;' }] },
];

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await scenario1953(browser);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.FA_MUTATIONS || liste(process.env.FA_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.FA_BAVARD;
        try {
          await scenario1953(browser);
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
  if (echecs) { console.error(`\nformule-adaptee-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nformule-adaptee-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

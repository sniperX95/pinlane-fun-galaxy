// LA LIGNE LIBRE « À PAYER », SA CASE AU PROGRAMME, ET LE « + » QUI AJOUTE UNE LIGNE (2026-11-21).
//
// Un gerant, sur une capture de la fiche (« 3cruches + tables a payer × 1 », 0 €) : « ici j'ai su mettre
// avec mon compte admin, mais avec le compte staff j'ai pas su écrire ce que je voulais, ça mettait que
// c'était pas dans le catalogue, c'est pas ça. Et aussi là je sais pas c'est quoi le prix, donc on peut
// choisir « à payer », et donc affiché bien visible pour le prix et tout. Le « + », là, parce que c'est
// pas assez visible. » Puis, sur la fiche : « ça doit le mettre dans la liste à cocher aussi, bien complet ».
//
// Il joue la VRAIE console, le VRAI handler api/staff-reservations.js et le vrai moteur
// (scripts/comptoir-banc.js, base en memoire), le samedi 16 janvier 2027 a 15:10 a Libramont, et relit
// toujours le DOSSIER EN BASE, jamais seulement l ecran.
//   [S] LE STAFF (sur mesure « Depuis le catalogue », sans droit sur les prix, il modifie les dossiers).
//       Le serveur d abord : une ligne hors carte avec un prix est refusee, « à payer » passe a 0 (le prix
//       du corps ne survit pas), un role sans sur mesure n ajoute rien. Puis de vrais clics dans Modifier :
//       « + Boissons » est un vrai bouton ; « 3 cruches + tables », quantite 1 : son prix ne se tape pas,
//       elle dit « À payer » ; Enregistrer l ecrit en base, a payer, a 0, signee, le prix du dossier ne
//       bouge pas. Dans la fiche, au Programme : la ligne, son nom et sa quantite, sa pastille « À payer » ;
//       sa case se coche et la coche s enregistre. Dans la caisse : « + 3 cruches + tables × 1 À payer »
//       sous « À encaisser 69 € », et sa ligne dit « À payer », jamais « 0 € ».
//   [A] L ADMIN (Direction) : la meme ligne a aussi le choix « À payer » ; un prix tape (15 €) l ecrit en
//       base a 15 €, le dossier passe de 39 a 54 €, la caisse dit 15 € et rien n y est « à payer ».
//   [R] RESERVER, LE STAFF BAR (il cree sans modifier) : « Ajouter une activité ou une boisson » est un vrai
//       bouton encadre ; au niveau catalogue la ligne libre se tape sans champ de prix, « À payer » ; le
//       ticket et le total le disent ; Creer ecrit la ligne a payer dans le dossier.
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en memoire, le
// disque n est jamais touche), et exige que chacune rougisse sa cible : le staff refuse, « 0 € » dans la
// caisse, le total muet sur ce qui reste a payer, la ligne absente du Programme, les deux « + » redevenus
// un lien ou une pastille pale. `--seul=S,A` ne joue que ces lettres ; `--ancres` verifie que chaque ancre
// existe une fois. `--captures` pose les images dans captures-nuit/ (la fiche et la caisse, le « + »).
// Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const path = require('path');
const eclats = require('./gates-eclats.js');
const { trancher } = require('./gates-tranche');
const C = require('./comptoir-banc.js');
const { chromium } = require('playwright-core');

const { B, ROOT } = C;
const PORT = Number(process.env.PINLANE_EXTRAS_LIBRES_PORT || 7010);
const CASSE = String(process.env.EXTRAS_LIBRES_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const CAPTURES = argument('captures') ? path.join(ROOT, 'captures-nuit') : '';

const APP = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const DROITS = 'lib/droits-reservation.js';

// LA MUTATION : une garde retiree expres, une a la fois. `lettre` dit quel scenario la juge, `cible` le
// debut du libelle qui doit rougir, `serveur` qu elle se compile au serveur.
const MUTATIONS = [
  { nom: 'staff-refuse', lettre: 'S', cible: '[S] Enregistrer : la ligne est en base', serveur: true, fichier: DROITS, de: '        if (aPayer) {\n          const libre = ligneAPayer(ligne, { pax, par, le });\n          if (libre) return libre;', vers: '        if (false) {\n          const libre = ligneAPayer(ligne, { pax, par, le });\n          if (libre) return libre;' },
  { nom: 'zero-euro-dans-la-caisse', lettre: 'S', cible: '[S] la caisse', fichier: APP, de: "montant: e.aPayer === true ? 'À payer' : e.offert ? 'offert'", vers: "montant: e.offert ? 'offert'" },
  { nom: 'total-muet', lettre: 'S', cible: '[S] la caisse', fichier: APP, de: '  const aPayer = annule || paid ? [] : (Array.isArray(r.extras) ? r.extras : []).filter(e => e && e.aPayer === true);', vers: '  const aPayer = [];' },
  { nom: 'absente-du-programme', lettre: 'S', cible: '[S] le Programme', fichier: APP, de: "  (Array.isArray(r && r.extras) ? r.extras : []).filter(x => x && typeof x === 'object' && String(x.name || '').trim()).forEach((x, i) => {", vers: '  [].forEach((x, i) => {' },
  { nom: 'prix-tape-par-le-staff', lettre: 'S', cible: '[S] Modifier : la ligne hors catalogue', fichier: APP, de: "  if (typeof niveauStaff !== 'function' || niveauStaff('surmesure') !== 'catalogue') return true;", vers: '  return true;' },
  { nom: 'plus-de-modifier-pale', lettre: 'S', cible: '[S] le « + » de Modifier est un vrai bouton', fichier: CSS, de: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm-ajout { min-height: 40px;', vers: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm-ajout-pale { min-height: 40px;' },
  { nom: 'plus-reste-un-lien', lettre: 'R', cible: '[R] « Ajouter une activité ou une boisson » est un vrai bouton', fichier: APP, de: 'class="rs-ajout-ligne" id="rsTkMesure"', vers: 'class="rs-lien is-fort" id="rsTkMesure"' },
  { nom: 'reserver-sans-ligne-libre', lettre: 'R', cible: '[R] au niveau catalogue, la ligne libre', fichier: APP, de: "  const libre = niveau === 'libre' || niveau === 'catalogue' ? `<div class=\"rs-libre\">", vers: "  const libre = niveau === 'libre' ? `<div class=\"rs-libre\">" },
  { nom: 'admin-sans-a-payer', lettre: 'A', cible: '[A] l admin a aussi le choix', fichier: APP, de: "          ${niveauStaff('surmesure') === 'libre' ? `<button type=\"button\" class=\"fm-x-opt${l.aPayer ? ' is-on' : ''}\"", vers: "          ${false ? `<button type=\"button\" class=\"fm-x-opt${l.aPayer ? ' is-on' : ''}\"" },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

let echecs = 0;
let reussis = 0;
const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (mutation && label.startsWith(mutation.cible)) throw Object.assign(new Error(`cible rouge : ${label}`), { cibleRouge: true });
  return false;
}
if (CASSE && !mutation) { console.error(`extras-libres-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
const compteAncre = (m) => lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
if (mutation && compteAncre(mutation) !== 1) { console.error(`extras-libres-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }
function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

const serveur = C.monterServeur({ mutations: mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [] });

// LA COCHE D UNE CASE (setReservationActivityDone, lib/database.js) : le banc ne la joue pas, elle se joue
// ici sur la meme base, comme la requete la decrit : la cle posee dans le suivi, ou retiree.
const DATES = ['created_at', 'updated_at', 'expires_at', 'released_at', 'paid_at', 'absent_at'];
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (!s.startsWith('update reservations set activity_progress = case when $4::jsonb is null')) return queryDuBanc.call(this, sql, params);
  const row = B.base.reservations.get(Number(params[0]));
  if (!row || row.center_id !== params[1]) return { rows: [], rowCount: 0 };
  const suivi = { ...(typeof row.activity_progress === 'string' ? JSON.parse(row.activity_progress || '{}') : (row.activity_progress || {})) };
  if (params[3] === null) delete suivi[params[2]];
  else suivi[params[2]] = JSON.parse(params[3]);
  const apres = { ...row, activity_progress: suivi, updated_at: new Date(Math.max(Date.now(), new Date(row.updated_at || 0).getTime() + 1)) };
  B.base.reservations.set(Number(apres.id), apres);
  return { rows: [JSON.parse(JSON.stringify(apres), (k, v) => (DATES.includes(k) && v ? new Date(v) : v))], rowCount: 1 };
};

// ---------------------------------------------------------------------------
// Les roles, les dossiers, la base.
// ---------------------------------------------------------------------------
// LE STAFF DU GERANT : il modifie les dossiers, ajoute du sur mesure « Depuis le catalogue », sans droit
// sur les prix (le preset Staff bar, plus la modification des reservations).
function sessionStaff() {
  const s = B.sessionDuRole('staff-bar', { nom: 'Accueil' });
  return { ...s, role: { id: 'staff', locked: false }, permissions: [...s.permissions, 'reservations.edit'] };
}
// Le meme, sans sur mesure : il ne peut rien ajouter, meme « à payer ».
function sessionSansSurMesure() {
  const s = sessionStaff();
  return { ...s, permissions: s.permissions.map((p) => (p === 'niveau:surmesure:catalogue' ? 'niveau:surmesure:non' : p)) };
}
const NOM = '3 cruches + tables';
const ID_STAFF = 1619; // Famille Gérard, bowling 16:00, 6 joueurs, 69 €
const ID_ADMIN = 1635; // Famille Henrard, bowling 16:00, 6 joueurs, 39 €
const ID_SERVEUR = 1637; // Famille Noël, bowling 16:30, 4 joueurs, 39 €
const enBase = (id) => B.base.reservations.get(Number(id));
const extrasDe = (r) => (r && (typeof r.extras === 'string' ? JSON.parse(r.extras) : r.extras)) || [];
const suiviDe = (r) => (r && (typeof r.activity_progress === 'string' ? JSON.parse(r.activity_progress) : r.activity_progress)) || {};
const notreLigne = (r) => extrasDe(r).find((x) => String(x.name || '').startsWith(NOM));
const attendre = async (page, fn, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (fn()) return true; await page.waitForTimeout(100); } return fn(); };

async function ouvrirConsoleEn(browser, qui) {
  const m = await C.ouvrirConsole(browser, serveur, { port: PORT, role: qui === 'admin' ? 'direction' : 'catalogue', appareil: 'comptoir', theme: 'light' });
  if (qui === 'staff') {
    const s = sessionStaff();
    serveur.changerSession(s);
    await m.page.evaluate((droits) => {
      state.staffAuthSession = { ...state.staffAuthSession, role: { id: droits.id, name: 'Staff', locked: false }, permissions: droits.permissions };
      renderStaff();
    }, { id: s.role.id, permissions: s.permissions });
  }
  // Le calcul a blanc de Modifier part au vrai handler, comme en ligne.
  await m.page.evaluate(() => { serveurSaitModifierABlanc = true; }); // eslint-disable-line no-undef
  return m;
}
const finir = async (m, quoi) => { ok(m.erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, m.erreurs.slice(0, 3).join(' | ')); await m.ctx.close(); };

async function photo(page, nom, selecteur) {
  if (!CAPTURES) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.waitForTimeout(250);
  await page.locator(selecteur).first().screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  console.log(`      image : ${path.join(CAPTURES, `${nom}.png`)}`);
}

async function ouvrirModifier(page, id) {
  await page.evaluate((i) => { if (typeof closePos === 'function') closePos(); openPos(i); }, id);
  await page.locator('#posOverlay .dossier-tabs .tab', { hasText: 'Modifier' }).click();
  await page.waitForSelector('#posOverlay .fm-extras', { timeout: 10000 });
}

async function enregistrer(page) {
  await page.locator('#posOverlay .es-save').click();
  for (let i = 0; i < 80; i += 1) {
    await page.waitForTimeout(150);
    const bouton = page.locator('.staff-confirm [data-role="confirm-ok"]');
    if (await bouton.count()) await bouton.click();
    const fermee = await page.evaluate(() => !document.querySelector('#posOverlay .edit-modal') || !state.selectedRes);
    if (fermee) break;
  }
  await page.waitForTimeout(300);
  return page.evaluate(() => ((document.querySelector('#posOverlay .es-error, #posOverlay [role="alert"]') || {}).textContent || '').trim());
}

// UN VRAI BOUTON, la regle de la console : un <button>, encadre (bord visible), sur un fond plein,
// jamais souligne, son « + » en bleu (--console-selected), 36 px de haut au moins.
const lireBouton = (page, selecteur) => page.evaluate((sel) => {
  const b = document.querySelector(sel);
  if (!b) return { absent: sel };
  const s = getComputedStyle(b);
  const svg = b.querySelector('svg');
  const sonde = document.createElement('span');
  sonde.style.color = 'var(--console-selected)';
  b.parentElement.appendChild(sonde);
  const bleu = getComputedStyle(sonde).color;
  sonde.remove();
  const transparent = (c) => /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(c);
  return {
    balise: b.tagName,
    classes: b.className,
    texte: b.textContent.replace(/\s+/g, ' ').trim(),
    bord: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
    bordVisible: parseFloat(s.borderTopWidth) >= 1 && s.borderTopStyle !== 'none' && !transparent(s.borderTopColor),
    fondPlein: !transparent(s.backgroundColor),
    souligne: /underline/.test(s.textDecorationLine),
    hauteur: Math.round(b.getBoundingClientRect().height),
    plusBleu: Boolean(svg) && getComputedStyle(svg).color === bleu,
    bleu,
  };
}, selecteur);
const estUnVraiBouton = (b) => b && b.balise === 'BUTTON' && b.bordVisible && b.fondPlein && !b.souligne && b.hauteur >= 36 && b.plusBleu;

// LA FICHE (onglet Infos) : le Programme a cocher et la caisse.
const lireFiche = (page, id) => page.evaluate((i) => {
  const t = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const prog = document.querySelector('#posOverlay section.fx-programme');
  const etapes = prog ? Array.from(prog.querySelectorAll('li.gc-step')).map((li) => {
    const c = li.querySelector('.gc-check');
    return { nom: t(li.querySelector('.gc-step-what b')), prix: t(li.querySelector('.gc-step-price')), pastille: Boolean(li.querySelector('.gc-step-price.pl-a-payer')), cochable: Boolean(c && c.tagName === 'BUTTON'), fait: c ? c.getAttribute('aria-pressed') : '', cle: c ? (c.dataset.plFocus || '') : '' };
  }) : [];
  const caisse = document.querySelector('#posOverlay section.fz-caisse');
  const enPlus = document.getElementById(`ficheAPayer${i}`);
  const facture = caisse ? Array.from(caisse.querySelectorAll('.gc-bill-lines > div')).map((d) => ({ nom: t(d.querySelector('dt')), montant: t(d.querySelector('dd')), pastille: Boolean(d.querySelector('dd.pl-a-payer')) })) : [];
  const zero = (texte) => /(^|[^\d,])0[\s  ]*€/.test(texte);
  const enPlusVisible = Boolean(enPlus) && enPlus.getBoundingClientRect().height > 0;
  const pastille = enPlus && enPlus.querySelector('.pl-a-payer');
  const sp = pastille ? getComputedStyle(pastille) : null;
  return {
    etapes,
    argent: t(caisse && caisse.querySelector('.pos-act-money')),
    enPlus: t(enPlus),
    enPlusVisible,
    pastilleVisible: Boolean(sp) && sp.display !== 'none' && sp.visibility !== 'hidden' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(sp.backgroundColor),
    facture,
    zeroDansLaCaisse: zero(t(caisse)),
  };
}, id);

// ---------------------------------------------------------------------------
// [S] LE STAFF.
// ---------------------------------------------------------------------------
async function scenarioS(browser) {
  console.log('\n[S] le staff : une ligne hors catalogue, « à payer », de vrais clics dans Modifier');
  const m = await ouvrirConsoleEn(browser, 'staff');
  try {
    const { page } = m;
    // LE SERVEUR D ABORD, sans navigateur : la regle tient quel que soit l ecran.
    const avantServeur = enBase(ID_SERVEUR);
    const patch = (extras) => serveur.appeler('PATCH', '/api/staff-reservations', { id: ID_SERVEUR, centerId: 'libramont', extras });
    let x = await patch([{ id: 'autres-1', name: `${NOM} × 1`, qte: 1, price: 25, prixUnitaire: 25, categorie: 'autres' }]);
    ok(x.statut === 403 && x.json.code === 'sur_mesure_hors_catalogue' && !extrasDe(enBase(ID_SERVEUR)).length && /« à payer »/.test(x.json.message || x.json.error || ''),
      '[S] le serveur : au catalogue, une ligne hors carte avec un prix est refusee, la phrase propose « à payer »', { statut: x.statut, json: x.json });
    x = await patch([{ id: 'autres-1', name: `${NOM} × 1`, qte: 1, price: 25, prixUnitaire: 25, aPayer: true, categorie: 'autres' }]);
    const ecrite = notreLigne(enBase(ID_SERVEUR));
    ok(x.statut === 200 && ecrite && ecrite.aPayer === true && Number(ecrite.price) === 0 && ecrite.prixUnitaire === undefined && ecrite.par === 'Accueil' && Number(enBase(ID_SERVEUR).price) === Number(avantServeur.price),
      '[S] le serveur : « à payer » passe a 0, le prix du corps ne survit pas, le prix du dossier ne bouge pas', { statut: x.statut, ecrite, prix: enBase(ID_SERVEUR).price });
    serveur.changerSession(sessionSansSurMesure());
    x = await patch([{ id: 'autres-2', name: 'Gâteau × 1', qte: 1, price: 0, aPayer: true }]);
    ok(x.statut === 403 && x.json.code === 'sur_mesure_refuse' && extrasDe(enBase(ID_SERVEUR)).length === 1, '[S] le serveur : un role sans sur mesure n ajoute rien, meme « à payer »', { statut: x.statut, code: x.json.code });
    serveur.changerSession(sessionStaff());

    // DE VRAIS CLICS DANS MODIFIER.
    const avant = enBase(ID_STAFF);
    await ouvrirModifier(page, ID_STAFF);
    const plus = await lireBouton(page, '#posOverlay .fm-x-ajouts .fm-ajout');
    ok(estUnVraiBouton(plus), '[S] le « + » de Modifier est un vrai bouton : encadre, fond plein, pas souligne, « + » bleu, 36 px au moins', plus);
    await page.locator('#posOverlay .fm-x-ajouts .fm-ajout', { hasText: 'Boissons' }).click();
    const ligne = page.locator('#posOverlay .fm-extras .fm-x-ligne').last();
    await ligne.locator('.fm-x-choix').fill(NOM);
    await ligne.locator('.fm-x-qte').fill('1');
    await page.waitForTimeout(150);
    const vu = await page.evaluate(() => {
      const l = Array.from(document.querySelectorAll('#posOverlay .fm-extras .fm-x-ligne')).pop();
      const prix = l && l.querySelector('.fm-euro');
      const somme = l && l.querySelector('.fm-x-somme');
      return { prixVisible: Boolean(prix) && prix.getBoundingClientRect().height > 0, somme: somme ? somme.textContent.trim() : '', pastille: Boolean(somme && somme.classList.contains('pl-a-payer')), options: Array.from(l ? l.querySelectorAll('.fm-x-opt') : []).map((b) => b.textContent.trim()), total: ((document.getElementById('fmExtrasTotal') || {}).textContent || '').trim() };
    });
    ok(!vu.prixVisible && vu.somme === 'À payer' && vu.pastille && vu.total === 'À payer' && !vu.options.includes('À payer'),
      '[S] Modifier : la ligne hors catalogue se tape, son prix ne se tape pas, elle dit « À payer » (sans choix a faire)', vu);
    if (CAPTURES) await page.evaluate(() => document.querySelector('#posOverlay .fm-x-ajouts').scrollIntoView({ block: 'center' }));
    await photo(page, 'extras-libres-bouton-plus', '#posOverlay .edit-modal');
    const erreur = await enregistrer(page);
    const apres = enBase(ID_STAFF);
    const l = notreLigne(apres);
    ok(l && l.name === `${NOM} × 1` && l.aPayer === true && Number(l.price) === 0 && l.prixUnitaire === undefined && l.qte === 1 && l.par === 'Accueil' && Number(apres.price) === Number(avant.price) && Number(apres.price) === 69,
      '[S] Enregistrer : la ligne est en base, a payer, a 0, signee ; le prix du dossier ne bouge pas (69 €)', { erreur, ligne: l, prix: apres && apres.price, extras: extrasDe(apres) });
    if (!l) return;

    // LA FICHE : le Programme a cocher et la caisse.
    await page.evaluate((i) => { closePos(); openPos(i); }, ID_STAFF);
    await page.waitForSelector('#posOverlay section.fx-programme', { timeout: 8000 });
    const fiche = await lireFiche(page, ID_STAFF);
    const etape = fiche.etapes.find((e) => e.nom === `${NOM} × 1`);
    const cle = `extra-${l.id}`;
    ok(etape && etape.pastille && etape.prix === 'À payer' && etape.cochable && etape.fait === 'false' && etape.cle === `fiche.activite.${ID_STAFF}.${cle}`,
      '[S] le Programme : la ligne, son nom et sa quantite, sa pastille « À payer », une case a cocher', { etape, etapes: fiche.etapes });
    const facture = fiche.facture.find((f) => f.nom === `${NOM} × 1`);
    ok(/^À encaisser 69\s€$/.test(fiche.argent.replace(/[  ]/g, ' ')) && fiche.enPlus === `+ ${NOM} × 1 À payer` && fiche.enPlusVisible && fiche.pastilleVisible
      && facture && facture.montant === 'À payer' && facture.pastille && !fiche.zeroDansLaCaisse,
      '[S] la caisse : « + 3 cruches + tables × 1 À payer » sous « À encaisser 69 € », sa ligne dit « À payer », jamais « 0 € »', fiche);
    await photo(page, 'extras-libres-fiche-a-payer', '#posOverlay .edit-modal');
    // La case : elle se coche, et la coche s enregistre en base.
    await page.locator(`#posOverlay [data-pl-focus="fiche.activite.${ID_STAFF}.${cle}"]`).click();
    const enregistree = await attendre(page, () => Boolean(suiviDe(enBase(ID_STAFF))[cle] && suiviDe(enBase(ID_STAFF))[cle].done));
    await page.waitForTimeout(300);
    await page.evaluate((i) => { closePos(); openPos(i); }, ID_STAFF);
    const relue = (await lireFiche(page, ID_STAFF)).etapes.find((e) => e.nom === `${NOM} × 1`);
    ok(enregistree && relue && relue.fait === 'true', '[S] le Programme : sa case se coche, la coche s enregistre en base et se relit', { suivi: suiviDe(enBase(ID_STAFF)), relue });
  } finally { await finir(m, 'S'); }
}

// ---------------------------------------------------------------------------
// [A] L ADMIN.
// ---------------------------------------------------------------------------
async function scenarioA(browser) {
  console.log('\n[A] l admin : la meme ligne, un prix tape');
  const m = await ouvrirConsoleEn(browser, 'admin');
  try {
    const { page } = m;
    const avant = enBase(ID_ADMIN);
    await ouvrirModifier(page, ID_ADMIN);
    await page.locator('#posOverlay .fm-x-ajouts .fm-ajout', { hasText: 'Boissons' }).click();
    const ligne = page.locator('#posOverlay .fm-extras .fm-x-ligne').last();
    await ligne.locator('.fm-x-choix').fill(NOM);
    await ligne.locator('.fm-x-qte').fill('1');
    await page.waitForTimeout(150);
    const lire = () => page.evaluate(() => {
      const l = Array.from(document.querySelectorAll('#posOverlay .fm-extras .fm-x-ligne')).pop();
      const somme = l && l.querySelector('.fm-x-somme');
      const prix = l && l.querySelector('.fm-euro');
      return { prixVisible: Boolean(prix) && prix.getBoundingClientRect().height > 0, somme: somme ? somme.textContent.replace(/[  ]/g, ' ').trim() : '', options: Array.from(l ? l.querySelectorAll('.fm-x-opt') : []).map((b) => b.textContent.trim()) };
    });
    const sansPrix = await lire();
    ok(sansPrix.prixVisible && sansPrix.somme === 'À payer' && sansPrix.options.includes('À payer'),
      '[A] l admin a aussi le choix « À payer » : le prix se tape, vide la ligne est a payer', sansPrix);
    await ligne.locator('.fm-x-prix').fill('15');
    await page.waitForTimeout(150);
    const avecPrix = await lire();
    const erreur = await enregistrer(page);
    const apres = enBase(ID_ADMIN);
    const l = notreLigne(apres);
    ok(avecPrix.somme === '15 €' && l && l.name === `${NOM} × 1` && Number(l.price) === 15 && Number(l.prixUnitaire) === 15 && l.aPayer === undefined && Number(avant.price) === 39 && Number(apres.price) === 54,
      '[A] un prix tape : la ligne en base a 15 €, le dossier passe de 39 a 54 €', { erreur, avecPrix, ligne: l, prix: apres && apres.price });
    await page.evaluate((i) => { closePos(); openPos(i); }, ID_ADMIN);
    await page.waitForSelector('#posOverlay section.fz-caisse', { timeout: 8000 });
    const fiche = await lireFiche(page, ID_ADMIN);
    const facture = fiche.facture.find((f) => f.nom === `${NOM} × 1`);
    const etape = fiche.etapes.find((e) => e.nom === `${NOM} × 1`);
    ok(facture && facture.montant.replace(/[  ]/g, ' ') === '15 €' && !facture.pastille && !fiche.enPlus && /^À encaisser 54\s€$/.test(fiche.argent.replace(/[  ]/g, ' ')) && etape && !etape.pastille && etape.cochable,
      '[A] la caisse dit 15 €, rien n y est « à payer », la ligne se coche au Programme', fiche);
  } finally { await finir(m, 'A'); }
}

// ---------------------------------------------------------------------------
// [R] RESERVER, LE STAFF BAR.
// ---------------------------------------------------------------------------
async function scenarioR(browser) {
  console.log('\n[R] Reserver : le staff bar ajoute une ligne libre « à payer »');
  const m = await ouvrirConsoleEn(browser, 'catalogue');
  try {
    const { page } = m;
    await C.ouvrirFenetre(page, 7);
    await page.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page);
    const plus = await lireBouton(page, '#rsTkMesure');
    ok(estUnVraiBouton(plus) && !/rs-lien/.test(plus.classes) && plus.texte === 'Ajouter une activité ou une boisson',
      '[R] « Ajouter une activité ou une boisson » est un vrai bouton : encadre, fond plein, pas souligne, « + » bleu, 36 px au moins', plus);
    await photo(page, 'extras-libres-reserver-plus', '#rsTkMesure');
    await page.locator('#rsTkMesure').click();
    await page.waitForSelector('#rsLibreNom', { timeout: 8000 }).catch(() => {});
    const champs = await page.evaluate(() => ({ nom: Boolean(document.getElementById('rsLibreNom')), prix: Boolean(document.getElementById('rsLibrePrix')), aPayer: ((document.getElementById('rsLibreAPayer') || {}).textContent || '').trim(), arcades: Boolean(document.getElementById('rsOnglet-arcades')) }));
    ok(champs.nom && !champs.prix && champs.aPayer === 'À payer' && !champs.arcades, '[R] au niveau catalogue, la ligne libre se tape sans champ de prix : « À payer », et pas d arcades a la main', champs);
    if (!champs.nom) return;
    await page.locator('#rsLibreNom').fill(NOM);
    await page.locator('#rsLibreAjouter').click();
    await page.waitForTimeout(300);
    const ticket = await page.evaluate((nom) => {
      const ligne = Array.from(document.querySelectorAll('.rs-tk-a')).find((b) => ((b.querySelector('.rs-tk-n b') || {}).textContent || '').trim() === nom);
      const em = ligne && ligne.querySelector('em');
      return { prix: em ? em.textContent.trim() : '', pastille: Boolean(em && em.classList.contains('pl-a-payer')), total: ((document.getElementById('rsTotalAPayer') || {}).textContent || '').trim(), envoi: quickExtrasLignes().filter((l) => l.name === nom) };
    }, NOM);
    ok(ticket.prix === 'À payer' && ticket.pastille && ticket.total === '+ à payer' && ticket.envoi.length === 1 && ticket.envoi[0].aPayer === true && ticket.envoi[0].prixUnitaire === undefined,
      '[R] au ticket : la ligne dit « À payer », le total aussi, elle part sans prix', ticket);
    await C.pret(page);
    await page.locator('#qbPhone').fill('0470 12 34 56');
    await page.locator('#qbName').fill('Groupe Cruches');
    await page.waitForTimeout(200);
    await page.locator('#rvCreer').click();
    let cree = null;
    for (let i = 0; i < 80 && !cree; i += 1) {
      cree = [...B.base.reservations.entries()].filter(([id]) => !m.avant.has(id)).map(([, r]) => r)[0] || null;
      if (!cree) await page.waitForTimeout(100);
    }
    const l = notreLigne(cree);
    ok(cree && l && l.name === `${NOM} × 1` && l.aPayer === true && Number(l.price) === 0 && l.par === 'Accueil',
      '[R] Creer : le dossier porte la ligne a payer en base, a 0, signee', { cree: cree && { id: cree.id, prix: cree.price, extras: extrasDe(cree) } });
  } finally { await finir(m, 'R'); }
}

// ---------------------------------------------------------------------------
const SCENARIOS = { S: scenarioS, A: scenarioA, R: scenarioR };

function verifierLesAncres() {
  let mortes = 0;
  MUTATIONS.forEach((m) => { const n = compteAncre(m); if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom} trouvee ${n} fois : ${m.de.slice(0, 80)}`); } });
  if (new Set(MUTATIONS.map((m) => m.nom)).size !== MUTATIONS.length) { mortes += 1; console.log('FAIL  deux contre-preuves portent le meme nom'); }
  console.log(`extras-libres-check --ancres : ${MUTATIONS.length - mortes}/${MUTATIONS.length} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = trancher(voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS);
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, EXTRAS_LIBRES_CASSE: m.nom, PINLANE_EXTRAS_LIBRES_PORT: String(PORT + 1 + fil) },
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
  console.log(`extras-libres-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const http = await C.FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: C.BROWSER_PATH, headless: true });
  try {
    for (const nom of seul) {
      try { await SCENARIOS[nom](browser); } catch (erreur) {
        if (erreur && erreur.cibleRouge) break;
        ok(false, `[${nom}] le scenario va jusqu au bout`, erreur && (erreur.message || String(erreur)).slice(0, 300));
      }
    }
  } finally {
    await browser.close();
    http.close();
  }
  console.log(`\nextras-libres-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('extras-libres-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

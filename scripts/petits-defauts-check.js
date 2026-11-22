// QUATRE PETITS DEFAUTS DU COMPTOIR (2026-11-22, les notes d Ansar au comptoir).
//
//   [T] LE TELEPHONE PEUT ETRE UN MOT. « Pour numero de tel, que cote staff on puisse ecrire autre que des
//       chiffres, des fois c par mail, on ecrit par mail dessus, ou / quand y a pas. » Reserver, Modifier et le
//       serveur acceptent un texte court (« par mail », « / ») ; un texte qui n est pas un numero ne declenche
//       JAMAIS d envoi (SMS, appel) : il compte comme « pas de numero » ; la fiche (bloc Client) l affiche tel
//       quel, « / » dit « Pas de telephone » ; un vrai numero reste verifie (8 chiffres au moins) ; le
//       formulaire public garde sa regle (telephone obligatoire).
//   [E] UNE LIGNE LIBRE S AJOUTE D ELLE-MEME. « Quand on ajoute une boisson ou quoi on doit appuyer sur
//       ajouter, c pas clair et ils oublient tous d appuyer dessus. » Dans Reserver, « Ajouter une activite ou
//       une boisson » : des que le nom est ecrit, la ligne est au ticket, sa quantite se regle ; « Ajouter » ne
//       fait plus que preparer la suivante (jamais de double ajout) ; une ligne restee en cours est prise a la
//       creation.
//   [C] LES CRUCHES N ONT PAS D HEURE. « Les cruches pour formules ca met un temps, ils prennent quand ils
//       veulent. » Une fiche F8 et une fiche F5 disent « Libre » devant leurs cruches ; le planning complet ne
//       dit plus « 2 cruches a 17:28 » ; la jumelle du serveur (lib/programme-a-cocher.js) dit la meme chose ;
//       seul « Servir a » d un extra donne une heure.
//   [A] LES ARCADES EN ARGENT SE DISENT EN MONTANT. « Arcades sur mesure ou met prix, ca le montre pas sur le
//       planning, 8 € en gros quand c argent ; pour les cartes avec argent tu dois juste mettre le montant. »
//       La colonne Arcades du planning complet montre « 8 € » pour le sur mesure en argent et « 8 crédits »
//       pour les 8 credits d une formule (des credits restent des credits, la decision du 2026-11-22), tous
//       sans heure, libres comme la plaine ; les arcades au temps gardent leur heure ; Reserver ne demande
//       aucune heure aux arcades en credits.
//
// La VRAIE console, le VRAI handler api/staff-reservations.js et le vrai moteur (scripts/comptoir-banc.js,
// base en memoire), le samedi 16 janvier 2027 a 15:10 a Libramont. Zero reseau sortant, zero vraie base.
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en memoire, le disque
// n est jamais touche), et exige que chacune rougisse sa cible. `--seul=T,E` ne joue que ces lettres ;
// `--ancres` verifie que chaque ancre existe une fois ; `--captures=<dossier>` pose les images.
'use strict';
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const eclats = require('./gates-eclats.js');
const { trancher } = require('./gates-tranche');
const C = require('./comptoir-banc.js');
const { chromium } = require('playwright-core');

const { B, ROOT } = C;
const PORT = Number(process.env.PINLANE_PETITS_DEFAUTS_PORT || 7540);
const CASSE = String(process.env.PETITS_DEFAUTS_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const CAPTURES = typeof argument('captures') === 'string' ? path.resolve(argument('captures')) : '';

const APP = 'assets/app-main.js';
const PLAN = 'assets/pinlane-planning-global.js';
const JUMELLE = 'lib/programme-a-cocher.js';
const API = 'api/staff-reservations.js';
const COMMS = 'lib/ops-communications.js';

// LA MUTATION : une garde retiree expres, une a la fois. `lettre` dit quel scenario la juge, `cible` le
// debut du libelle qui doit rougir, `serveur` qu elle se compile au serveur.
const MUTATIONS = [
  { nom: 'telephone-texte-refuse-au-serveur', lettre: 'T', cible: '[T] le serveur', serveur: true, fichier: API, de: '  if (T.telephoneAccepte(corps && corps.phone)) return;', vers: '  if (T.telephoneValide(corps && corps.phone)) return;' },
  { nom: 'telephone-trop-court-accepte', lettre: 'T', cible: '[T] le serveur', serveur: true, fichier: 'lib/telephone-du-client.js', de: '  if (!ressembleAUnNumero(brut)) return true;\n  return telephoneValide(brut);', vers: '  return true;' },
  { nom: 'telephone-texte-refuse-au-comptoir', lettre: 'T', cible: '[T] Reserver', fichier: APP, de: "  if (!rvRessembleAUnNumero(brut)) return true;\n  const chiffres = String(normalizePhoneInput(brut))", vers: "  const chiffres = String(normalizePhoneInput(brut))" },
  { nom: 'telephone-texte-prefixe-belge', lettre: 'T', cible: '[T] Reserver', fichier: APP, de: "  if (!rvRessembleAUnNumero(raw)) return raw;\n", vers: '' },
  { nom: 'telephone-texte-envoye-en-sms', lettre: 'T', cible: '[T] un mot', serveur: true, fichier: COMMS, de: "  if (!require('./telephone-du-client').telephoneEnvoyable(phone)) return '';\n", vers: '' },
  { nom: 'telephone-lien-d-appel-sur-un-mot', lettre: 'T', cible: '[T] la fiche', fichier: APP, de: "  const tel = rvTelephoneEnvoyable(r.phone);\n  const contacts = [", vers: "  const tel = String(r.phone || '').replace(/[^0-9+]/g, '') || 'x';\n  const contacts = [" },
  { nom: 'telephone-barre-dit-pas-de-numero', lettre: 'T', cible: '[T] la fiche', fichier: APP, de: "  return brut === '/' ? '' : brut;", vers: '  return brut;' },
  { nom: 'telephone-modifier-refuse-un-mot', lettre: 'T', cible: '[T] Modifier', fichier: APP, de: "  return rvTelephoneValide(tape) ? '' : (rvRessembleAUnNumero(tape)", vers: "  return rvRessembleAUnNumero(tape) ? '' : (rvRessembleAUnNumero(tape)" },
  { nom: 'ligne-libre-sans-ajout-auto', lettre: 'E', cible: '[E] des que le nom est ecrit', fichier: APP, de: "  rsEtat().mesure[cle] = valeur;\n  rsLibreSynchro(cle);", vers: '  rsEtat().mesure[cle] = valeur;' },
  { nom: 'ligne-libre-une-par-frappe', lettre: 'E', cible: '[E] des que le nom est ecrit', fichier: APP, de: "  } else if (!ligne) {\n    rsCompteur += 1;\n    ligne = { id: `libre-${rsCompteur}`", vers: "  } else if (!ligne || cle === 'nom') {\n    rsCompteur += 1;\n    ligne = { id: `libre-${rsCompteur}`" },
  { nom: 'ligne-libre-doublon-au-bouton', lettre: 'E', cible: '[E] Ajouter ne double pas', fichier: APP, de: "    const ligne = rsLibreSynchro('', { peindre: false });\n    if (ligne) b.mesure.ligne = ligne.id;", vers: "    b.mesure.libreId = '';\n    const ligne = rsLibreSynchro('', { peindre: false });\n    if (ligne) b.mesure.ligne = ligne.id;" },
  { nom: 'ligne-libre-en-cours-perdue', lettre: 'E', cible: '[E] une ligne restee en cours', fichier: APP, de: "  if (!simulation && rsEtat() && String(rsEtat().mesure.nom || '').trim() && !rsLibreEnCours()) rsLibreSynchro('', { peindre: false });\n", vers: '' },
  { nom: 'ligne-libre-nom-efface-reste', lettre: 'E', cible: '[E] le nom efface', fichier: APP, de: "    if (ligne) { panier.splice(panier.indexOf(ligne), 1); if (m.ligne === ligne.id) m.ligne = ''; }", vers: '' },
  { nom: 'cruches-avec-heure-a-la-fiche', lettre: 'C', cible: '[C] la fiche', fichier: APP, de: "  const sansHeure = (item) => item.activityId === 'playground' || /^service_/.test(String(item.activityId || ''))", vers: "  const sansHeure = (item) => item.activityId === 'playground'" },
  { nom: 'cruches-avec-heure-a-la-jumelle', lettre: 'C', cible: '[C] la jumelle', serveur: true, fichier: JUMELLE, de: "  return activityId === 'playground' || /^service_/.test(String(activityId || '')) || arcadesEnArgent(r, activityId, reglages);", vers: "  return activityId === 'playground' || arcadesEnArgent(r, activityId, reglages);" },
  { nom: 'cruches-avec-heure-au-planning', lettre: 'C', cible: '[C] le planning', fichier: PLAN, de: "    return g.boissons ? texte + ', ' + g.boissons.nom : texte;", vers: "    return g.boissons ? texte + ', ' + g.boissons.nom + ' à ' + gpHeure(g.boissons.start) : texte;" },
  { nom: 'arcades-au-temps-sans-heure', lettre: 'A', cible: '[A] les arcades au temps', fichier: APP, de: "  if (id !== 'arcade_time' || !r) return false;\n  const lignes = Array.isArray(r.program)", vers: "  if (id === 'arcade_time') return true;\n  if (id !== 'arcade_time' || !r) return false;\n  const lignes = Array.isArray(r.program)" },
  { nom: 'arcades-argent-avec-heure-a-la-fiche', lettre: 'A', cible: '[A] la fiche', fichier: APP, de: "function arcadesEnArgentDuDossier(r, item) {\n  const id = item && item.activityId;\n  if (id === 'arcade_credit') return true;", vers: "function arcadesEnArgentDuDossier(r, item) {\n  const id = item && item.activityId;\n  if (id === 'arcade_credit') return false;" },
  { nom: 'arcades-argent-avec-heure-a-la-jumelle', lettre: 'A', cible: '[A] la jumelle', serveur: true, fichier: JUMELLE, de: "function arcadesEnArgent(r, activityId, reglages) {\n  if (activityId === 'arcade_credit') return true;", vers: "function arcadesEnArgent(r, activityId, reglages) {\n  if (activityId === 'arcade_credit') return false;" },
  { nom: 'arcades-sur-mesure-absentes-du-planning', lettre: 'A', cible: '[A] le planning montre « 8 €', fichier: PLAN, de: "      gpArcadesSurMesure(r).forEach(function (cs) {", vers: "      [].forEach(function (cs) {" },
  // (des credits pris pour de l argent : la F6 dit « 8 € » au lieu de « 8 crédits », le defaut du 2026-11-22)
  { nom: 'credits-en-montant', lettre: 'A', cible: '[A] le planning montre « 8 crédits »', fichier: PLAN, de: "    var e = m ? null : new RegExp('(", vers: "    var e = new RegExp('(" },
  { nom: 'arcades-en-argent-heure-demandee', lettre: 'A', cible: '[A] Reserver', fichier: APP, de: "  if (id === 'arcade_time' && quickBookState && quickActiviteRetenue(id)) return getQuickVisitOptions(id).arcadeMode === 'credit';\n  return false;", vers: '  return false;' },
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
if (CASSE && !mutation) { console.error(`petits-defauts-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
const compteAncre = (m) => lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
if (mutation && compteAncre(mutation) !== 1) { console.error(`petits-defauts-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }
function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}
// Le serveur mute en memoire : le gate lit le meme code que le handler (lib/, api/).
const serveur = C.monterServeur({ mutations: mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [] });
const db = require(path.join(ROOT, 'lib/database.js'));

// ---------------------------------------------------------------------------
// Les outils.
// ---------------------------------------------------------------------------
const enBase = (id) => B.base.reservations.get(Number(id));
// Un dimanche sans reservation dans la fixture : les dossiers du gate n y trouvent pas le laser plein du samedi.
const JOUR_LIBRE = '2027-01-17';
const extrasDe = (r) => (r && (typeof r.extras === 'string' ? JSON.parse(r.extras) : r.extras)) || [];
const attendre = async (page, fn, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await fn()) return true; await page.waitForTimeout(100); } return fn(); };
const finir = async (m, quoi) => { ok(m.erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, m.erreurs.slice(0, 3).join(' | ')); await m.ctx.close(); };
async function photo(page, nom, selecteur) {
  if (!CAPTURES || mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.waitForTimeout(300);
  const fichier = path.join(CAPTURES, `${nom}.png`);
  if (selecteur) await page.locator(selecteur).first().screenshot({ path: fichier });
  else await page.screenshot({ path: fichier });
  console.log(`      image : ${fichier}`);
}
async function ouvrirConsoleEn(browser, role = 'direction') {
  const m = await C.ouvrirConsole(browser, serveur, { port: PORT, role, appareil: 'comptoir', theme: 'light' });
  await m.page.evaluate(() => { serveurSaitModifierABlanc = true; }); // eslint-disable-line no-undef
  return m;
}
// Une reservation creee par le vrai handler, au format que la page lit, posee dans sa journee.
async function creerDossier(page, champs) {
  const rep = await serveur.appeler('POST', '/api/staff-reservations', B.corpsStaff({ date: C.JOUR, duration: 1, totalDuration: 3, lanes: [], laneCount: 0, requiresLanes: false, ...champs }));
  return rep;
}
async function poserDansLaPage(page, ids) {
  const lignes = ids.map((id) => JSON.parse(JSON.stringify(db.mapReservation(enBase(id)))));
  await page.evaluate((liste) => {
    const jour = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
    liste.forEach((r) => { [jour, state.reservations].forEach((l) => { const i = l.findIndex((x) => x.id === r.id); if (i >= 0) l[i] = { ...r }; else l.push({ ...r }); }); });
  }, lignes);
}
async function ouvrirFiche(page, id) {
  await poserDansLaPage(page, [id]);
  await page.evaluate((i) => { if (typeof closePos === 'function') closePos(); openPos(i); }, id);
  await page.waitForSelector('#posOverlay section.fx-programme', { timeout: 10000 });
  await page.waitForTimeout(200);
}
const lireProgramme = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#posOverlay .fx-programme .gc-step')).filter((li) => li.getClientRects().length).map((li) => {
  const t = li.querySelector('.gc-step-time');
  const nom = li.querySelector('.gc-step-what b');
  return { heure: t ? t.textContent.replace(/\s+/g, ' ').trim() : '', nom: nom ? nom.textContent.replace(/\s+/g, ' ').trim() : '' };
}));
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
}
async function attendreLaCreation(page, avant) {
  let cree = null;
  for (let i = 0; i < 100 && !cree; i += 1) {
    cree = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r)[0] || null;
    if (!cree) await page.waitForTimeout(100);
  }
  return cree;
}
async function reserverUnBowling(m, { telephone, nom, heure = '17:00', surMesure = null }) {
  const { page } = m;
  await C.ouvrirFenetre(page, 7);
  await page.locator(`#rsZ-bowling .rs-h[data-heure="${heure}"]`).click();
  await C.pret(page);
  if (surMesure) await surMesure(page);
  await page.locator('#qbPhone').fill(telephone);
  await page.locator('#qbName').fill(nom);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);
  await C.pret(page);
}
const appelerPublic = async (corps) => {
  const ip = `10.40.0.${Math.floor(Math.random() * 200) + 10}`;
  const req = Readable.from([Buffer.from(JSON.stringify(corps))]);
  req.method = 'POST';
  req.url = '/api/public-reservations';
  req.headers = { host: 'localhost', 'content-type': 'application/json', 'x-forwarded-for': ip };
  req.socket = { remoteAddress: ip };
  const res = { statusCode: 200, entetes: {}, corps: '', req, setHeader(k, v) { this.entetes[k.toLowerCase()] = v; }, getHeader(k) { return this.entetes[k.toLowerCase()]; }, end(b) { this.corps = String(b || ''); } };
  await require(path.join(ROOT, 'api/public-reservations.js'))(req, res);
  let json = {};
  try { json = JSON.parse(res.corps); } catch (e) { json = {}; }
  return { statut: res.statusCode, json };
};

// ---------------------------------------------------------------------------
// [T] LE TELEPHONE.
// ---------------------------------------------------------------------------
async function scenarioT(browser) {
  console.log('\n[T] le telephone : un mot passe, un faux numero non');
  const m = await ouvrirConsoleEn(browser);
  // LE SERVEUR D ABORD, sans navigateur (la base du banc est semee a l ouverture de la console).
  const creer = (phone, heure, id) => creerDossier(null, { date: JOUR_LIBRE, type: 'formule', formuleId: 'f8', formulaId: 'f8', pax: 2, startTime: heure, phone, name: `Essai telephone ${id}` });
  const mail = await creer('par mail', '19:00', 1);
  const barre = await creer('/', '19:30', 2);
  const vrai = await creer('0470 12 34 56', '20:00', 3);
  const court = await creer('0470', '20:30', 4);
  const vide = await creer('', '21:00', 5);
  const long = await creer('x'.repeat(41), '21:30', 6);
  const phoneEnBase = (rep) => (rep.json.reservation ? (enBase(rep.json.reservation.id) || {}).phone : null);
  ok(mail.statut === 201 && phoneEnBase(mail) === 'par mail', '[T] le serveur accepte « par mail » pour une reservation du staff, et l ecrit tel quel', { statut: mail.statut, message: mail.json.message, base: phoneEnBase(mail) });
  ok(barre.statut === 201 && phoneEnBase(barre) === '/', '[T] le serveur accepte « / » (pas de numero)', { statut: barre.statut, message: barre.json.message });
  ok(vrai.statut === 201, '[T] le serveur accepte toujours un vrai numero', { statut: vrai.statut, message: vrai.json.message });
  ok(court.statut === 422 && /t[ée]l[ée]phone/i.test(String(court.json.message || '')), '[T] le serveur refuse toujours un numero trop court (« 0470 »), et le dit', { statut: court.statut, message: court.json.message });
  ok(vide.statut === 422 && /t[ée]l[ée]phone/i.test(String(vide.json.message || '')), '[T] le serveur exige encore quelque chose : un champ vide se refuse', { statut: vide.statut, message: vide.json.message });
  ok(long.statut === 422, '[T] le serveur refuse un texte de plus de 40 caracteres', { statut: long.statut });
  // UN MOT NE DECLENCHE JAMAIS D ENVOI.
  // (la fonction est relue dans la source, mutee en memoire pour une contre-preuve : le module charge ne bouge pas)
  const source = lf(fs.readFileSync(path.join(ROOT, COMMS), 'utf8'));
  const debut = source.indexOf('function normalizePhoneForSms(');
  const corps = source.slice(debut, source.indexOf('\n}\n', debut) + 3);
  const miseEnForme = mutation && mutation.fichier === COMMS ? corps.split(mutation.de).join(mutation.vers) : corps;
  const sms = new Function('require', `${miseEnForme}\nreturn normalizePhoneForSms;`)((m2) => require(path.join(ROOT, 'lib', m2.replace('./', ''))));
  ok(sms('par mail') === '' && sms('/') === '' && sms('mail de la maman') === '' && sms('maman 12') === '' && sms('0470 12 34 56') === '+32470123456' && sms('+32 470 12 34 56') === '+32470123456',
    '[T] un mot ou « / » ne donne jamais de destinataire SMS, un vrai numero oui', { mail: sms('par mail'), barre: sms('/'), vrai: sms('0470 12 34 56') });
  // LE TUNNEL PUBLIC GARDE SA REGLE.
  const pub = await appelerPublic({ centerId: 'libramont', date: '2027-01-19', startTime: '15:00', pax: 4, companions: 0, channel: 'public', occasion: '', type: 'visite',
    program: [{ activityId: 'bowling', duration: 1 }], preference: { preferredTimes: { bowling: '15:00' }, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' },
    price: 0, basePrice: 0, duration: 1, totalDuration: 1, name: 'Client Essai', email: 'client@example.test', phone: '' });
  ok(pub.statut >= 400 && /t[ée]l[ée]phone/i.test(String(pub.json.message || '')), '[T] en ligne, le telephone reste obligatoire (le formulaire public garde sa regle)', { statut: pub.statut, message: pub.json.message });

  try {
    const { page } = m;
    // RESERVER : le champ accepte « par mail », ne lui met pas +32, et la reservation part avec.
    let avant = new Set([...B.base.reservations.keys()]);
    await reserverUnBowling(m, { telephone: 'par mail', nom: 'Famille Mail', heure: '17:00' });
    const champ = await page.evaluate(() => ({ valeur: document.getElementById('qbPhone').value, type: document.getElementById('qbPhone').type, rouge: Boolean(document.getElementById('rsTelDit')), pret: document.getElementById('rvCreer').dataset.pret }));
    ok(champ.valeur === 'par mail' && champ.type === 'text' && !champ.rouge && champ.pret === '1', '[T] Reserver : le champ garde « par mail » tel quel (pas de +32), n est pas rouge, Creer est pret', champ);
    await photo(page, 'telephone-par-mail-reserver');
    await page.locator('#rvCreer').click();
    const creeMail = await attendreLaCreation(page, avant);
    ok(creeMail && creeMail.phone === 'par mail', '[T] Reserver : Creer ecrit « par mail » dans le dossier', { phone: creeMail && creeMail.phone });
    await page.waitForTimeout(400);
    // « / » : pas de numero.
    avant = new Set([...B.base.reservations.keys()]);
    await reserverUnBowling(m, { telephone: '/', nom: 'Famille Barre', heure: '18:00' });
    const barreChamp = await page.evaluate(() => ({ valeur: document.getElementById('qbPhone').value, rouge: Boolean(document.getElementById('rsTelDit')) }));
    ok(barreChamp.valeur === '/' && !barreChamp.rouge, '[T] Reserver : « / » passe aussi (pas de numero)', barreChamp);
    await page.locator('#rvCreer').click();
    const creeBarre = await attendreLaCreation(page, avant);
    ok(creeBarre && creeBarre.phone === '/', '[T] Reserver : Creer ecrit « / »', { phone: creeBarre && creeBarre.phone });
    await page.waitForTimeout(400);
    // UN FAUX NUMERO RESTE REFUSE : « 0470 » ne passe pas, et la fenetre le dit.
    await reserverUnBowling(m, { telephone: '0470', nom: 'Famille Court', heure: '17:00' });
    const court2 = await page.evaluate(() => ({ dit: (document.getElementById('rsTelDit') || {}).textContent || '', pret: document.getElementById('rvCreer').dataset.pret }));
    await page.locator('#rvCreer').click().catch(() => {});
    await page.waitForTimeout(500);
    const dit = await page.evaluate(() => (document.getElementById('rsTelDit') || {}).textContent || '');
    ok(/8 chiffres|incomplet/i.test(dit || court2.dit), '[T] Reserver : un numero trop court (« 0470 ») reste refuse, la fenetre le dit', { court2, dit });
    await page.evaluate(() => { closeQuickBook(); });
    await page.waitForTimeout(300);

    // MODIFIER : le telephone d un dossier devient « par mail », puis un faux numero se refuse.
    const modifiable = [...B.base.reservations.keys()].find((id) => Number(id) === 1619) || [...B.base.reservations.keys()][0];
    await ouvrirModifier(page, modifiable);
    await page.evaluate(() => { const p = document.getElementById('editContactPli'); if (p) p.open = true; });
    await page.locator('#editPhoneInput').fill('par mail');
    await page.locator('#editPhoneInput').press('Tab');
    const indice = await page.evaluate(() => { const h = document.getElementById('editPhoneHint'); return { cache: !h || h.hidden, type: document.getElementById('editPhoneInput').type }; });
    ok(indice.cache && indice.type === 'text', '[T] Modifier : « par mail » ne dit aucun refus', indice);
    await enregistrer(page);
    ok((enBase(modifiable) || {}).phone === 'par mail', '[T] Modifier : Enregistrer ecrit « par mail » dans le dossier', { phone: (enBase(modifiable) || {}).phone });
    await ouvrirModifier(page, modifiable);
    await page.evaluate(() => { const p = document.getElementById('editContactPli'); if (p) p.open = true; });
    await page.locator('#editPhoneInput').fill('0470');
    await page.locator('#editPhoneInput').press('Tab');
    const refus = await page.evaluate(() => { const h = document.getElementById('editPhoneHint'); return { visible: Boolean(h) && !h.hidden, texte: h ? h.textContent : '' }; });
    ok(refus.visible && /8 chiffres/.test(refus.texte), '[T] Modifier : un faux numero (« 0470 ») reste refuse, avec sa phrase', refus);
    await page.evaluate(() => { closePos(); });

    // LA FICHE : « par mail » s affiche tel quel, sans lien d appel ; « / » dit « Pas de telephone » ; un numero s appelle.
    const idMail = creeMail ? creeMail.id : null;
    const idBarre = creeBarre ? creeBarre.id : null;
    const idVrai = vrai.json.reservation ? vrai.json.reservation.id : null;
    const client = async (id) => {
      await ouvrirFiche(page, id);
      return page.evaluate(() => {
        const bloc = document.querySelector('#posOverlay section.fx-client');
        return { texte: bloc ? bloc.textContent.replace(/\s+/g, ' ').trim() : '', liens: bloc ? Array.from(bloc.querySelectorAll('a[href^="tel:"]')).map((a) => a.getAttribute('href')) : [], appeler: Array.from(document.querySelectorAll('#posOverlay .fx-appel')).length };
      });
    };
    const fMail = await client(idMail);
    ok(/par mail/.test(fMail.texte) && fMail.liens.length === 0 && fMail.appeler === 0, '[T] la fiche affiche « par mail » tel quel dans le bloc Client, sans lien pour appeler', fMail);
    await photo(page, 'telephone-par-mail-fiche', '#posOverlay .fx-client');
    const fBarre = await client(idBarre);
    ok(/Ni téléphone ni e-mail|Pas de téléphone/.test(fBarre.texte) && !/ \/ /.test(` ${fBarre.texte} `) && fBarre.liens.length === 0, '[T] la fiche lit « / » comme « pas de telephone » (rien d affiche, la ligne qui manque)', fBarre);
    const fVrai = await client(idVrai);
    ok(fVrai.liens.length === 1 && /^tel:\+?32?470123456|^tel:0470123456|^tel:\+32470123456/.test(fVrai.liens[0] || '') || fVrai.liens.length === 1, '[T] la fiche garde le lien d appel d un vrai numero', fVrai);
  } finally { await finir(m, 'T'); }
}

// ---------------------------------------------------------------------------
// [E] LA LIGNE LIBRE DE RESERVER.
// ---------------------------------------------------------------------------
async function scenarioE(browser) {
  console.log('\n[E] Reserver : une boisson ou un extra s ajoute tout de suite');
  const m = await ouvrirConsoleEn(browser);
  try {
    const { page } = m;
    const lignes = () => page.evaluate(() => quickExtrasLignes().map((l) => ({ nom: l.name, qte: l.qte })));
    const ticket = () => page.evaluate(() => Array.from(document.querySelectorAll('.rs-tk-a .rs-tk-n b')).map((b) => b.textContent.trim()));
    await C.ouvrirFenetre(page, 7);
    await page.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page);
    await page.locator('#rsTkMesure').click();
    await page.waitForSelector('#rsLibreNom', { timeout: 8000 });
    // Le nom ecrit, aucun bouton touche.
    await page.locator('#rsLibreNom').click();
    await page.keyboard.type('Gateau', { delay: 15 });
    await page.waitForTimeout(300);
    const a = await lignes();
    const t1 = await ticket();
    const focus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    ok(a.length === 1 && a[0].nom === 'Gateau' && t1.includes('Gateau') && focus === 'rsLibreNom', '[E] des que le nom est ecrit, la ligne est au ticket, sans toucher « Ajouter » (et le curseur reste dans le champ)', { a, t1, focus });
    await photo(page, 'boisson-sans-bouton');
    // La suite de la frappe met a jour la MEME ligne.
    await page.keyboard.type('x', { delay: 15 });
    await page.waitForTimeout(200);
    const b = await lignes();
    ok(b.length === 1 && b[0].nom === 'Gateaux', '[E] la frappe qui continue met la meme ligne a jour (« Gateaux »), jamais une seconde', b);
    // Sa quantite se regle ensuite.
    await page.locator('.rs-bande .rs-pas button[aria-label$="un de plus"]').first().click();
    await page.waitForTimeout(250);
    const q = await lignes();
    ok(q.length === 1 && q[0].qte === 2, '[E] sa quantite se regle apres coup (1 puis 2)', q);
    // « Ajouter » : jamais de double ajout, il prepare la suivante.
    await page.locator('#rsLibreAjouter').click();
    await page.waitForTimeout(300);
    const c = await lignes();
    const champ = await page.evaluate(() => ({ nom: document.getElementById('rsLibreNom').value, bouton: document.querySelector('#rsLibreAjouter').textContent.trim() }));
    ok(c.length === 1 && c[0].qte === 2 && champ.nom === '' && champ.bouton === 'Ajouter', '[E] Ajouter ne double pas la ligne : une seule, sa quantite gardee, le champ vide pour la suivante', { c, champ });
    // La suivante, validee par Entree.
    await page.locator('#rsLibreNom').fill('');
    await page.locator('#rsLibreNom').click();
    await page.keyboard.type('Karaoke', { delay: 15 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const d = await lignes();
    ok(d.length === 2 && d.map((x) => x.nom).includes('Karaoke'), '[E] une seconde ligne ecrite puis validee par Entree : deux lignes, pas trois', d);
    // Le nom efface retire la ligne en cours (rien d oublie au ticket).
    await page.locator('#rsLibreNom').click();
    await page.keyboard.type('Bougies', { delay: 15 });
    await page.waitForTimeout(250);
    ok((await lignes()).length === 3, '[E] une troisieme ligne s ecrit', await lignes());
    await page.locator('#rsLibreNom').fill('');
    await page.waitForTimeout(250);
    const e = await lignes();
    ok(e.length === 2 && !e.some((x) => /Bougies/.test(x.nom)), '[E] le nom efface retire la ligne qu il venait d ajouter', e);
    // UNE LIGNE RESTEE EN COURS EST PRISE A LA CREATION : le nom est dans le champ, aucune ligne au ticket.
    await page.evaluate(() => { const b = rsEtat(); b.mesure.nom = 'Cadeau'; b.mesure.libreId = ''; });
    const avantEnCours = await lignes();
    await page.locator('#qbPhone').fill('0470 12 34 56');
    await page.locator('#qbName').fill('Groupe En Cours');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(250);
    await C.pret(page);
    const avant = new Set([...B.base.reservations.keys()]);
    await page.locator('#rvCreer').click();
    const cree = await attendreLaCreation(page, avant);
    const noms = extrasDe(cree).map((x) => x.name);
    ok(!avantEnCours.some((x) => /Cadeau/.test(x.nom)) && noms.some((n) => /^Cadeau/.test(n)) && noms.some((n) => /^Gateaux/.test(n)) && noms.some((n) => /^Karaoke/.test(n)),
      '[E] une ligne restee en cours (nom ecrit, « Ajouter » oublie) est prise a la creation, avec les autres', { avantEnCours, noms });
    ok(noms.filter((n) => /^Gateaux/.test(n)).length === 1, '[E] la creation n ecrit aucune ligne en double', noms);
    // MODIFIER : « + Boissons » puis le nom ecrit suffit, sans bouton « Ajouter ».
    await page.waitForTimeout(400);
    await poserDansLaPage(page, [cree.id]);
    await ouvrirModifier(page, cree.id);
    await page.locator('#posOverlay .fm-extras .fm-ajout', { hasText: 'Boissons' }).click();
    const nomLigne = page.locator('#posOverlay .fm-extras input[list="fmx-boissons"]').last();
    await nomLigne.fill('Cruche Biere');
    await enregistrer(page);
    ok(extrasDe(enBase(cree.id)).some((x) => /^Cruche Biere/.test(x.name)), '[E] Modifier : « + Boissons » puis le nom ecrit suffit, la ligne est enregistree sans autre bouton', extrasDe(enBase(cree.id)).map((x) => x.name));
  } finally { await finir(m, 'E'); }
}

// ---------------------------------------------------------------------------
// [C] LES CRUCHES.
// ---------------------------------------------------------------------------
async function scenarioC(browser) {
  console.log('\n[C] les cruches d une formule n ont pas d heure');
  const m = await ouvrirConsoleEn(browser);
  const f8 = await creerDossier(null, { type: 'formule', formuleId: 'f8', formulaId: 'f8', pax: 8, startTime: '17:00', name: 'Famille Huit', phone: '0470111222' });
  const f5 = await creerDossier(null, { date: JOUR_LIBRE, type: 'formule', formuleId: 'f5', formulaId: 'f5', pax: 8, startTime: '11:00', name: 'Famille Cinq', phone: '0470111223' });
  const avecHeure = await creerDossier(null, { date: JOUR_LIBRE, type: 'formule', formuleId: 'f5', formulaId: 'f5', pax: 4, startTime: '15:00', name: 'Famille Servie', phone: '0470111224',
    extras: [{ id: 'boissons-servies', name: 'Cruche Bière × 2', qte: 2, price: 0, aPayer: true, heure: '19:30' }] });
  ok(Boolean(f8.json.reservation && f5.json.reservation && avecHeure.json.reservation), 'MONTAGE : les dossiers F8, F5 et celui d un extra servi sont crees', [f8.statut, f5.statut, avecHeure.statut]);
  const ids = [f8, f5, avecHeure].map((x) => x.json.reservation && x.json.reservation.id).filter(Boolean);
  try {
    const { page } = m;
    for (const [nom, rep] of [['F8', f8], ['F5', f5]]) {
      await ouvrirFiche(page, rep.json.reservation.id);
      const prog = await lireProgramme(page);
      const cruches = prog.filter((e) => /cruche/i.test(e.nom));
      ok(cruches.length === 1 && cruches[0].heure === 'Libre', `[C] la fiche ${nom} dit « Libre » devant ses cruches (jamais une heure)`, prog);
      if (nom === 'F8') await photo(page, 'fiche-cruches-libre', '#posOverlay .fx-programme');
    }
    // Les autres heures de la fiche ne bougent pas : l arcade au temps de la F8 garde la sienne.
    await ouvrirFiche(page, f8.json.reservation.id);
    const prog8 = await lireProgramme(page);
    ok(prog8.some((e) => /^Arcades$/.test(e.nom) && /^\d\d:\d\d/.test(e.heure)) && prog8.some((e) => /Minigolf/.test(e.nom) && /^\d\d:\d\d/.test(e.heure)),
      '[C] les activites a heure (minigolf, arcades au temps) gardent la leur', prog8);
    // Seul « Servir a » donne une heure.
    await ouvrirFiche(page, avecHeure.json.reservation.id);
    const progServie = await lireProgramme(page);
    ok(progServie.some((e) => /Cruche Bière/.test(e.nom) && e.heure === '19:30') && progServie.filter((e) => /^2 cruches boissons/.test(e.nom)).every((e) => e.heure === 'Libre'),
      '[C] un extra servi a 19:30 (« Servir a ») garde son heure, les cruches de la formule restent libres', progServie);
    await page.evaluate(() => { closePos(); });
    // LA JUMELLE DU SERVEUR dit la meme chose que la fiche.
    const J = require(path.join(ROOT, JUMELLE));
    const dits = (rep) => J.etapesACocher(JSON.parse(JSON.stringify(db.mapReservation(enBase(rep.json.reservation.id)))), {}).filter((e) => e.activityId === 'service_drinks');
    ok([f8, f5].every((rep) => dits(rep).length === 1 && dits(rep)[0].start == null && dits(rep)[0].libre === true), '[C] la jumelle du serveur (lib/programme-a-cocher.js) donne aussi les cruches « libres », sans heure', [f8, f5].map(dits));
    // LE PLANNING COMPLET ne dit plus « 2 cruches a 17:28 ».
    await poserDansLaPage(page, ids);
    await page.evaluate(() => { setStaffResourceView('all'); });
    await page.waitForTimeout(600);
    const lignesPlanning = await page.evaluate((liste) => liste.map((id) => {
      const tr = document.querySelector(`#globalPlanningGridWrap tr.gf-r[data-gf-id="${id}"]`);
      return { id, texte: tr ? tr.textContent.replace(/\s+/g, ' ').trim() : null };
    }), [f8.json.reservation.id]);
    ok(lignesPlanning.every((l) => l.texte), 'MONTAGE : la ligne F8 est au planning complet', lignesPlanning);
    ok(lignesPlanning.every((l) => /cruches/.test(l.texte || '') && !/cruches?\s+(à|a)\s+\d/.test(l.texte || '')), '[C] le planning complet dit « 2 cruches » sans heure', lignesPlanning.map((l) => (l.texte || '').slice(0, 160)));
  } finally { await finir(m, 'C'); }
}

// ---------------------------------------------------------------------------
// [A] LES ARCADES EN ARGENT.
// ---------------------------------------------------------------------------
async function scenarioA(browser) {
  console.log('\n[A] les arcades en argent : le montant, jamais une heure');
  const m = await ouvrirConsoleEn(browser);
  const f6 = await creerDossier(null, { type: 'formule', formuleId: 'f6', formulaId: 'f6', pax: 8, startTime: '19:00', name: 'Famille Six', phone: '0470111225' });
  const f8 = await creerDossier(null, { type: 'formule', formuleId: 'f8', formulaId: 'f8', pax: 8, startTime: '17:00', name: 'Famille Huit', phone: '0470111226' });
  ok(Boolean(f6.json.reservation && f8.json.reservation), 'MONTAGE : les dossiers F6 (8 credits) et F8 (arcades au temps) sont crees', [f6.statut, f8.statut]);
  try {
    const { page } = m;
    // LE SUR MESURE : dans Reserver, Arcades « En argent », 8 par joueur.
    const avant = new Set([...B.base.reservations.keys()]);
    await C.ouvrirFenetre(page, 7);
    await page.locator('#rsZ-bowling .rs-h[data-heure="21:00"]').click();
    await C.pret(page);
    await page.locator('#rsTkMesure').click();
    await page.waitForSelector('#rsOnglet-arcades', { timeout: 8000 });
    await page.locator('#rsOnglet-arcades').click();
    await page.locator('.rs-rangs button', { hasText: 'En argent' }).first().click();
    await page.waitForSelector('#rsXPrix', { timeout: 8000 });
    await page.locator('#rsXPrix').fill('8');
    await page.waitForTimeout(300);
    const demande = await page.evaluate(() => ({
      heureBouton: Boolean(document.querySelector('#rsHB-arcade_time')),
      servir: Array.from(document.querySelectorAll('.rs-rang .rs-lbl')).map((n) => n.textContent.trim()).filter((t) => /Servir|Heure/i.test(t)),
      ligne: quickExtrasLignes().map((l) => ({ id: l.id, name: l.name, price: l.price, heure: l.heure || '' })),
    }));
    ok(!demande.heureBouton && demande.servir.length === 0 && demande.ligne.length === 1 && demande.ligne[0].id === 'arcades-argent' && !demande.ligne[0].heure,
      '[A] Reserver ne demande aucune heure aux arcades en argent (sur mesure, 8 par joueur) : la ligne n en porte pas', demande);
    await page.locator('#qbPhone').fill('0470 12 34 56');
    await page.locator('#qbName').fill('Famille Sur Mesure');
    await page.keyboard.press('Tab');
    await C.pret(page);
    await page.locator('#rvCreer').click();
    const cree = await attendreLaCreation(page, avant);
    const arcades = extrasDe(cree).find((x) => x.id === 'arcades-argent');
    ok(arcades && Number(arcades.price) === 56 && !arcades.heure, '[A] Creer ecrit les arcades en argent : 8 par joueur pour 7 joueurs, soit 56, sans heure', arcades);
    await page.waitForTimeout(400);
    // LE PLANNING COMPLET.
    await poserDansLaPage(page, [cree.id, f6.json.reservation.id, f8.json.reservation.id]);
    await page.evaluate(() => { setStaffResourceView('all'); });
    await page.waitForTimeout(700);
    const cases = await page.evaluate((liste) => Object.fromEntries(liste.map(([cle, id]) => {
      const tr = document.querySelector(`#globalPlanningGridWrap tr.gf-r[data-gf-id="${id}"]`);
      const titres = Array.from(document.querySelectorAll('#globalPlanningGridWrap thead th')).map((t) => t.textContent.trim());
      const col = titres.indexOf('Arcades');
      const cellule = tr ? tr.querySelectorAll('td')[col] : null;
      const credit = cellule ? cellule.querySelector('.gf-x.is-credit') : null;
      const montant = credit ? credit.querySelector('.gf-x__montant') : null;
      return [cle, {
        colonne: col, cellule: cellule ? cellule.textContent.replace(/\s+/g, ' ').trim() : null,
        credit: credit ? credit.textContent.replace(/\s+/g, ' ').trim() : null,
        montant: montant ? montant.textContent.trim() : null,
        taille: montant ? parseFloat(getComputedStyle(montant).fontSize) : 0,
        aria: tr ? tr.getAttribute('aria-label') || '' : '',
      }];
    })), [['sm', cree.id], ['f6', f6.json.reservation.id], ['f8', f8.json.reservation.id]]);
    ok(cases.sm.montant === '8 €' && /par joueur/.test(cases.sm.credit || '') && !/\d\d:\d\d/.test(cases.sm.credit || '') && cases.sm.taille >= 14,
      '[A] le planning montre « 8 € » (par joueur) dans la colonne Arcades du sur mesure, en gros, sans heure', cases.sm);
    ok(!cases.f6.montant && /^8 crédits/.test(cases.f6.credit || '') && /par enfant/.test(cases.f6.credit || '') && !/\d\d:\d\d/.test(cases.f6.credit || ''),
      '[A] le planning montre « 8 crédits » (par enfant) pour les 8 credits d une formule, sans heure : des credits restent des credits', cases.f6);
    ok(/\d\d:\d\d/.test(cases.f8.cellule || '') && !cases.f8.credit, '[A] les arcades au temps (la F8) gardent leur heure au planning', cases.f8);
    // (l image du planning a 1366 x 768, sans filtre : la molette descend le tableau, comme la main du gerant,
    // jusqu a poser le sur mesure en argent en bas de l ecran, la F6 en credits au-dessus. Un defilement pose
    // par le code ne tenait pas : la feuille suit l heure tant qu aucune main ne la bouge. Le toast de la
    // creation se ferme d abord.)
    if (CAPTURES && !mutation) {
      await page.evaluate(() => document.getElementById('toast').classList.add('hidden'));
      const ids = { f8: f8.json.reservation.id, f6: f6.json.reservation.id, sm: cree.id };
      const lire = () => page.evaluate((liste) => {
        const defile = document.querySelector('#globalPlanningGridWrap .gf-defile');
        const boite = defile.getBoundingClientRect();
        const tete = defile.querySelector('thead');
        const haut = boite.top + (tete ? tete.getBoundingClientRect().height : 0);
        const lignes = Object.fromEntries(Object.entries(liste).map(([cle, id]) => [cle, defile.querySelector(`tr.gf-r[data-gf-id="${id}"]`).getBoundingClientRect()]));
        return { x: boite.left + boite.width / 2, y: boite.top + boite.height / 2, ecart: Math.max(0, Math.round(lignes.sm.bottom - boite.bottom + 8)),
          aLEcran: Object.keys(lignes).filter((cle) => lignes[cle].top >= haut - 1 && lignes[cle].bottom <= boite.bottom + 1) };
      }, ids);
      const avant = await lire();
      await page.mouse.move(avant.x, avant.y);
      await page.mouse.wheel(0, avant.ecart);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(600);
      console.log(`      lignes entieres a l ecran : ${(await lire()).aLEcran.join(', ') || 'aucune'} (il faut f6 et sm)`);
      await photo(page, 'planning-arcades-credits-et-argent');
    }
    // LA FICHE : les arcades en argent sont « Libre », celles au temps ont leur heure.
    await ouvrirFiche(page, f6.json.reservation.id);
    const prog6 = await lireProgramme(page);
    ok(prog6.filter((e) => /arcade/i.test(e.nom)).length === 1 && prog6.filter((e) => /arcade/i.test(e.nom)).every((e) => e.heure === 'Libre'), '[A] la fiche dit « Libre » devant les 8 credits d arcade', prog6);
    await ouvrirFiche(page, f8.json.reservation.id);
    const prog8 = await lireProgramme(page);
    ok(prog8.some((e) => /^Arcades$/.test(e.nom) && /^\d\d:\d\d/.test(e.heure)), '[A] les arcades au temps gardent leur heure sur la fiche', prog8);
    await ouvrirFiche(page, cree.id);
    const progSm = await lireProgramme(page);
    ok(progSm.filter((e) => /Arcades/.test(e.nom)).length === 1 && progSm.filter((e) => /Arcades/.test(e.nom)).every((e) => e.heure === 'Libre'), '[A] la fiche dit « Libre » devant les arcades en argent du sur mesure', progSm);
    await page.evaluate(() => { closePos(); });
    // LA JUMELLE DU SERVEUR.
    const J = require(path.join(ROOT, JUMELLE));
    const credits = J.etapesACocher(JSON.parse(JSON.stringify(db.mapReservation(enBase(f6.json.reservation.id)))), {}).filter((e) => e.activityId === 'arcade_credit');
    const temps = J.etapesACocher(JSON.parse(JSON.stringify(db.mapReservation(enBase(f8.json.reservation.id)))), {}).filter((e) => e.activityId === 'arcade_time');
    ok(credits.length === 1 && credits[0].libre === true && credits[0].start == null && temps.length === 1 && temps[0].start != null && !temps[0].libre,
      '[A] la jumelle du serveur : les credits sont libres, les arcades au temps gardent leur heure', { credits, temps });
    // RESERVER : des cartes d arcades en credits, choisies a la carte, n ont pas d heure a poser.
    await page.evaluate(() => { closeQuickBook(); });
    await page.waitForTimeout(300);
    await C.ouvrirFenetre(page, 7);
    const reserver = await page.evaluate(() => {
      const s = quickBookState;
      s.visit = s.visit || {}; s.visit.options = s.visit.options || {};
      const ret = { avant: rvArcadesEnArgent('arcade_time') };
      s.visit.options.arcade_time = { ...(s.visit.options.arcade_time || {}), arcadeMode: 'credit', arcadeOfferId: 'x' };
      const prisAvant = quickActiviteRetenue('arcade_time');
      if (!prisAvant) { try { rsBasculer('arcade_time'); } catch (e) { ret.erreur = String(e.message || e); } }
      s.visit.options.arcade_time = { ...(s.visit.options.arcade_time || {}), arcadeMode: 'credit', arcadeOfferId: 'x' };
      ret.credit = rvArcadesEnArgent('arcade_time');
      ret.posable = rvPosable('arcade_time', ['bowling', 'arcade_time']);
      s.visit.options.arcade_time = { ...(s.visit.options.arcade_time || {}), arcadeMode: 'time', arcadeOfferId: 'x' };
      ret.temps = rvArcadesEnArgent('arcade_time');
      return ret;
    });
    ok(reserver.credit === true && reserver.posable === false && reserver.temps === false, '[A] Reserver : des cartes d arcades en credits n ont pas d heure a poser, les cartes au temps si', reserver);
  } finally { await finir(m, 'A'); }
}

const SCENARIOS = { T: scenarioT, E: scenarioE, C: scenarioC, A: scenarioA };

function verifierLesAncres() {
  let mortes = 0;
  MUTATIONS.forEach((m) => { const n = compteAncre(m); if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom} trouvee ${n} fois : ${m.de.slice(0, 80)}`); } });
  if (new Set(MUTATIONS.map((m) => m.nom)).size !== MUTATIONS.length) { mortes += 1; console.log('FAIL  deux contre-preuves portent le meme nom'); }
  console.log(`petits-defauts-check --ancres : ${MUTATIONS.length - mortes}/${MUTATIONS.length} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = trancher(voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS);
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, PETITS_DEFAUTS_CASSE: m.nom, PINLANE_PETITS_DEFAUTS_PORT: String(PORT + 1 + fil) },
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
  console.log(`petits-defauts-check --contre-preuves : ${mordent}/${liste.length} mordent`);
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
  console.log(`\npetits-defauts-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('petits-defauts-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

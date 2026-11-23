// LE CONTACT « PAR MAIL » (2026-11-23, Ansar : « pour un truc plus quali, le par mail, mais genre un bouton
// simple, rapide, efficace, qui prend pas trop de place : on appuie dessus et c'est par mail, le champ se
// transforme en champ pour écrire le mail, mais c'est optionnel, ils peuvent dire qu'ils ont pas le mail ; et
// si il y a déjà le mail sur la résa, ça l'affiche direct »).
//
// Le comptoir tapait « par mail » ou « / » dans le champ du telephone (2026-11-22, petits-defauts-check [T]).
// A cote du telephone, un bouton encadre « Par mail » change le champ en celui de l e-mail, facultatif ;
// « Par téléphone » le rend. La regle de l adresse vit au serveur (lib/email-du-client.js) et la page la redit
// mot pour mot (rvEmailNettoye, rvEmailValide). Ce gate lit toujours le DOSSIER EN BASE, jamais seulement
// l ecran : la VRAIE console (scripts/planning-v3-fixtures.js, la journee « pic » du samedi 16 janvier 2027 a
// 15:10), le VRAI handler api/staff-reservations.js et le vrai moteur sur la base en memoire du banc
// (scripts/reserver-banc.js).
//
//   [S]  LE SERVEUR (sans navigateur) : « contact: mail » cree sans numero ni adresse ; sans lui, le
//        telephone reste exige ; une adresse tapee se range nettoyee ; une adresse fausse se refuse a la
//        creation, au lot (avec son rang) et dans Modifier, sans rien ecrire ; par mail, un numero envoye
//        quand meme doit tenir ; Modifier vide l adresse ou le numero ; une ancienne adresse qui ne tient pas
//        ne bloque pas les autres changements ; le formulaire en ligne garde son telephone obligatoire.
//   [J]  LA MEME REGLE DES DEUX COTES (sans navigateur) : la page et le serveur nettoient et jugent pareil
//        une cinquantaine d adresses, et disent la meme phrase ; « par mail » tape a la main n est pas un
//        numero ; un dossier s ouvre « Par mail » quand il le dit ; Modifier envoie ce que l ecran dit.
//   [R]  RESERVER : a cote du telephone, le bouton encadre « Par mail », a droite du champ, de sa hauteur,
//        peu de place ; touche, le champ devient l e-mail facultatif, au clavier e-mail, et rien ne part ;
//        Créer sans adresse cree le dossier sans telephone ni e-mail, en un envoi ; Tab va du telephone au
//        nom, Maj+Tab atteint le bouton, Entree le touche ; « Par téléphone » rend le numero tape ; au
//        telephone, un champ vide mene au bouton ; un client qui a deja une adresse ouvre Reserver « Par mail ».
//   [E]  UNE ADRESSE FAUSSE : refusee a l ecran, en rouge sous le champ, rien ne part ; corrigee, le rouge s en
//        va pendant la frappe ; nettoyee quand le champ rend la main ; Créer porte l adresse nettoyee ; si la
//        page la laissait passer, le serveur la refuse et la fenetre le dit.
//   [M]  MODIFIER : replie, le pli montre le numero et l adresse du dossier ; un dossier qui a une adresse et
//        aucun numero, ou « par mail », s ouvre « Par mail », l adresse dans le champ ; une adresse fausse se
//        dit sous son champ et rien ne part ; corrigee, Enregistrer la range nettoyee ; « Par mail » sur un
//        dossier qui a un numero le retire (la barre le dit avant) ; « Par téléphone » en ajoute un.
//   [F]  LA FICHE ET LE PLANNING : « par mail » ne s ecrit jamais comme un numero, un autre mot se lit sans
//        lien d appel, un vrai numero s appelle ; « Par mail, pas d’adresse », et « Ajouter » ouvre Modifier
//        sur l e-mail ; un dossier « Par mail » montre son adresse et un lien pour ecrire.
//   [*]  Zero erreur JavaScript.
//
// Rien ne part : les communications du banc sont muettes (scripts/slot-holds-check.js), le reseau sortant est
// refuse. Ce gate n envoie aucun mail et n en declenche aucun.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en memoire, le disque
// n est jamais touche), et exige que chacune rougisse sa cible ; `--contre-preuves=nom,nom` en joue
// quelques-unes ; `--ancres` verifie que chaque ancre existe une seule fois. `--seul=S,J` joue sans
// navigateur ; `--captures=<dossier>` pose les images.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Readable } = require('stream');
const eclats = require('./gates-eclats.js');

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

// La base en memoire et le faux 'pg' s installent au require.
const B = require('./reserver-banc.js');
const FX = require('./planning-v3-fixtures.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_PAR_MAIL_PORT || 7920);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.PAR_MAIL_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const CAPTURES = typeof argument('captures') === 'string' ? path.resolve(argument('captures')) : '';

const APP = 'assets/app-main.js';
const PLANNING = 'assets/pinlane-planning-global.js';
const STYLE = 'assets/pinlane-staff.css';
const API = 'api/staff-reservations.js';
const LIB = 'lib/email-du-client.js';
const URL_RESA = '/api/staff-reservations';

// Les phrases que le comptoir lit : le gate les fige, la page et le serveur doivent les dire.
const PHRASE_ADRESSE = 'Cette adresse e-mail n’est pas valide. Une adresse s’écrit comme prenom@email.be.';
const PHRASE_TELEPHONE = 'Écrivez le numéro du client, ou touchez « Par mail » s’il n’en a pas.';

// LA MUTATION : le code casse expres, une regle a la fois. `lettre` dit quel scenario la juge, `cible` le
// debut du libelle qui doit rougir, `serveur` une mutation du code du serveur (compilee en memoire).
const MUTATIONS = [
  { nom: 'serveur-exige-le-telephone', lettre: 'S', cible: '[S] Par mail, sans numero ni adresse', serveur: true, fichier: API, de: "  if (corps && corps.contact === 'mail') {", vers: '  if (false) {' },
  { nom: 'serveur-adresse-fausse-a-la-creation', lettre: 'S', cible: '[S] une adresse fausse se refuse a la creation', serveur: true, fichier: API, de: '    if (propre && !M.emailValide(propre)) throw createHttpError(M.MESSAGE_EMAIL_INVALIDE, 422);\n    corps.email = propre;', vers: '    corps.email = propre;' },
  { nom: 'serveur-adresse-fausse-au-patch', lettre: 'S', cible: '[S] Modifier : une adresse fausse se refuse', serveur: true, fichier: API, de: '    if (propre && !M.emailValide(propre)) throw createHttpError(M.MESSAGE_EMAIL_INVALIDE, 422);\n    patch.email = propre;', vers: '    patch.email = propre;' },
  { nom: 'historique-sans-adresse', lettre: 'S', cible: '[S] un client deja venu : la reponse porte son adresse', serveur: true, fichier: 'lib/database.js', de: "    email: String(row.email || '').trim(),", vers: "    email: ''," },
  { nom: 'serveur-adresse-brute', lettre: 'S', cible: '[S] Par mail, l adresse tapee se range nettoyee', serveur: true, fichier: API, de: '    corps.email = propre;\n', vers: '' },
  { nom: 'regle-sans-domaine', lettre: 'J', cible: '[J] la page et le serveur jugent pareil', serveur: true, fichier: LIB, de: '  if (morceaux.length < 2 || !morceaux.every(', vers: '  if (!morceaux.every(' },
  { nom: 'page-nettoie-autrement', lettre: 'J', cible: '[J] la page et le serveur nettoient pareil', fichier: APP, de: "  t = t.replace(/^mailto:/i, '').replace(/[.,;:]+$/, '');", vers: "  t = t.replace(/[.,;:]+$/, '');" },
  { nom: 'page-dit-une-autre-phrase', lettre: 'J', cible: '[J] la page et le serveur disent la meme phrase', fichier: APP, de: "const RV_EMAIL_INVALIDE = 'Cette adresse e-mail n’est pas valide. Une adresse s’écrit comme prenom@email.be.';", vers: "const RV_EMAIL_INVALIDE = 'Adresse invalide.';" },
  { nom: 'bouton-absent', lettre: 'R', cible: '[R] a cote du telephone, le bouton encadre « Par mail »', fichier: APP, de: '<span class="rs-tk-saisie">${bascule}<input id="qbPhone"', vers: '<span class="rs-tk-saisie"><input id="qbPhone"' },
  { nom: 'bouton-plein-noir', lettre: 'R', cible: '[R] a cote du telephone, le bouton encadre « Par mail »', fichier: STYLE, de: '.qb-modal.rv.rs .rs-tk-bascule { flex: none; order: 1; height: 44px; padding: 0 12px; border: 1px solid var(--rs-ligne-forte); border-radius: 10px; background: var(--surface); color: var(--text);', vers: '.qb-modal.rv.rs .rs-tk-bascule { flex: none; order: 1; height: 44px; padding: 0 12px; border: 1px solid var(--rs-ligne-forte); border-radius: 10px; background: #111; color: #fff;' },
  { nom: 'bouton-a-gauche', lettre: 'R', cible: '[R] a cote du telephone, le bouton encadre « Par mail »', fichier: STYLE, de: '.qb-modal.rv.rs .rs-tk-bascule { flex: none; order: 1;', vers: '.qb-modal.rv.rs .rs-tk-bascule { flex: none;' },
  { nom: 'par-mail-exige-le-telephone', lettre: 'R', cible: '[R] Par mail, adresse vide : Créer cree le dossier', fichier: APP, de: '  if (!rvParMail(s)) return rvTelephoneValide(s.phone);', vers: '  return rvTelephoneValide(s.phone);' },
  { nom: 'contact-oublie-a-l-envoi', lettre: 'R', cible: '[R] Par mail, adresse vide : Créer cree le dossier', fichier: APP, de: "    ...(!simulation && rvParMail(s) ? { contact: 'mail' } : {}),\n", vers: '' },
  { nom: 'tab-vole-par-un-bouton', lettre: 'R', cible: '[R] Tab va du telephone au nom', fichier: APP, de: "onblur=\"rsTelFini(this)\">${reconnu ? '<span class=\"rv-tag\">reconnu</span>' : ''}</span></label>`;", vers: "onblur=\"rsTelFini(this)\">${reconnu ? '<span class=\"rv-tag\">reconnu</span>' : ''}<button type=\"button\" class=\"rs-tk-bascule\">Par mail</button></span></label>`;" },
  { nom: 'retour-perd-le-numero', lettre: 'R', cible: '[R] « Par téléphone » rend le champ du numero', fichier: APP, de: "  s.contact = rvParMail(s) ? 'tel' : 'mail';\n  s.telDemande = false;", vers: "  s.contact = rvParMail(s) ? 'tel' : 'mail';\n  s.phone = '+32 ';\n  s.telDemande = false;" },
  { nom: 'reserver-ignore-l-adresse-connue', lettre: 'R', cible: '[R] un client deja venu dans ce centre', fichier: APP, de: "    if (connue && rvEmailValide(connue) && !String(quickBookState.email || '').trim()) quickBookState.email = connue;", vers: '' },
  { nom: 'reserver-ignore-l-adresse-du-client', lettre: 'R', cible: '[R] un client qui a deja une adresse', fichier: APP, de: '    contact: rvContactInitial(prefill.phone, prefill.email),', vers: "    contact: 'tel'," },
  { nom: 'page-laisse-partir-sans-domaine', lettre: 'E', cible: '[E] une adresse fausse ne part pas', fichier: APP, de: '  if (morceaux.length < 2 || !morceaux.every(', vers: '  if (!morceaux.every(' },
  { nom: 'champ-pas-nettoye', lettre: 'E', cible: '[E] l adresse se nettoie quand le champ rend la main', fichier: APP, de: '  s.email = rvEmailNettoye(champ.value);', vers: '  s.email = champ.value;' },
  { nom: 'adresse-du-dossier-ignoree', lettre: 'M', cible: '[M] un dossier qui a une adresse et aucun numero s ouvre « Par mail »', fichier: APP, de: '  etat.contact = rvContactInitial(reservation.phone, reservation.email);', vers: "  etat.contact = 'tel';" },
  { nom: 'pli-muet', lettre: 'M', cible: '[M] replie, le pli montre', fichier: APP, de: 'Téléphone, e-mail, occasion${apercuContactEdition(r) ?', vers: 'Téléphone, e-mail, occasion${false ?' },
  { nom: 'modifier-laisse-partir-une-adresse-fausse', lettre: 'M', cible: '[M] une adresse fausse se dit sous son champ', fichier: APP, de: "  return envoye && envoye !== String((origine && origine.email) || '').trim() && !rvEmailValide(envoye) ? RV_EMAIL_INVALIDE : '';", vers: "  return '';" },
  { nom: 'par-mail-garde-le-numero', lettre: 'M', cible: '[M] Enregistrer : la base n a plus de numero', fichier: APP, de: "  if (es && es.contact === 'mail') return rvSansNumero(avant) ? avant : '';", vers: "  if (es && es.contact === 'mail') return avant;" },
  { nom: 'fiche-par-mail-comme-un-mot', lettre: 'F', cible: '[F] la fiche d un dossier « par mail »', fichier: APP, de: "  if (rvMotParMail(brut)) return '';\n", vers: '' },
  { nom: 'planning-appelle-un-mot', lettre: 'F', cible: '[F] le planning lit un autre mot sans lien d appel', fichier: PLANNING, de: "    var tel = telMot ? '' : telDit;", vers: '    var tel = telDit;' },
  { nom: 'ajouter-mene-au-telephone', lettre: 'F', cible: '[F] « Ajouter » ouvre Modifier sur le champ de l e-mail', fichier: APP, de: "onclick=\"modifierDepuisFiche('email', event)\">Ajouter</button>", vers: "onclick=\"modifierDepuisFiche('telephone', event)\">Ajouter</button>" },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

// LE JOUR DU SERVEUR : celui de la fixture, a son heure (getBusinessNowParts, la seule lecture de l heure du
// metier), quel que soit le jour ou le gate tourne.
const HORLOGE_SERVEUR = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}

const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
if (CASSE && !mutation) { console.error(`par-mail-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
function verifierAncre(m) {
  return lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
}
if (mutation && verifierAncre(mutation) !== 1) {
  console.error(`par-mail-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// LE MONTAGE
// ---------------------------------------------------------------------------
FX.APPAREILS.comptoir = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
const JOUR = '2027-01-16';
const HEURE = '15:10';
const DUCKPIN = 'duckpin_bowling';

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

function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

const serveur = B.monter({
  mutations: [HORLOGE_SERVEUR, ...(mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [])],
  session: B.sessionDuRole('direction', { nom: 'Accueil' }),
});

// Un dossier du duckpin (une piste, 4 joueurs) cree par le vrai handler, comme la fenetre l enverrait.
const corpsDuckpin = (nom, heure, champs = {}) => ({ centerId: 'libramont', date: JOUR, name: nom, phone: '0470 11 12 22', email: '', status: 'pending', type: 'visite', pax: 4, startTime: heure, allowPastStart: true, program: [{ activityId: DUCKPIN, duration: 1 }], ...champs });
async function creer(nom, heure, champs) {
  const rep = await serveur.appeler('POST', URL_RESA, corpsDuckpin(nom, heure, champs));
  return { statut: rep.statut, message: rep.json.message || rep.json.error || '', reservation: rep.json.reservation || null, json: rep.json };
}
const enBase = (id) => B.base.reservations.get(Number(id)) || null;

// LES DOSSIERS DU GATE : un numero et une adresse ; une adresse sans numero (« Par mail ») ; « par mail »
// tape a la main sans adresse ; un autre mot a la place du numero.
const DOSSIERS = {
  adresse: { nom: 'Famille Vandamme', heure: '16:00', champs: { phone: '0470 12 34 56', email: 'famille.vandamme@exemple.be' } },
  sansNumero: { nom: 'Léa Wauters', heure: '17:00', champs: { phone: '', email: 'lea.wauters@exemple.be', contact: 'mail' } },
  parMail: { nom: 'Famille Leroy-Brel', heure: '18:00', champs: { phone: 'par mail', email: '' } },
  mot: { nom: 'Famille Petitjean', heure: '16:00', champs: { phone: 'mail de la maman', email: '' } },
};

// La console sur la journee « pic », les dossiers `semis` crees par le vrai handler avant l ouverture et
// poses dans la journee de la page.
async function ouvrirConsole(browser, semis = []) {
  const fx = FX.lireFixture('pic');
  globalThis.__comptoirMaintenant = FX.instant(fx.staffState.date, HEURE).getTime();
  B.semer(fx.staffState.reservations.map(ligneDepuis));
  const poses = {};
  for (const cle of semis) poses[cle] = await creer(DOSSIERS[cle].nom, DOSSIERS[cle].heure, DOSSIERS[cle].champs);
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil: 'comptoir', theme: 'light', port: PORT, heure: HEURE,
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => { const rep = await serveur.appeler('PATCH', URL_RESA, corps); journal.push({ m: 'PATCH', corps, statut: rep.statut, json: rep.json }); return rep; });
      await page.exposeFunction('__fixtureBlanc', async (corps) => serveur.appeler('POST', URL_RESA, corps));
      await page.exposeFunction('__vraiAppel', async (methode, url, corps) => { const rep = await serveur.appeler(methode, url, corps); journal.push({ m: methode, corps, statut: rep.statut, json: rep.json }); return rep; });
    },
  });
  const { ctx, page, erreurs } = m;
  page.setDefaultTimeout(8000);
  await page.evaluate((dossiers) => {
    const avant = window.fetch;
    window.fetch = async (input, init) => {
      init = init || {};
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
        const corps = init.body ? JSON.parse(init.body) : undefined;
        const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
        const j = rep.json || {};
        if (me === 'POST' && !(corps && corps.dryRun) && j.reservation) window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(j.reservation);
        return new Response(JSON.stringify(j), { status: rep.statut, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return avant(input, init);
    };
    const jour = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
    dossiers.forEach((d) => { jour.push({ ...d }); state.reservations.push({ ...d }); });
    if (dossiers.length) renderStaff();
  }, Object.values(poses).map((p) => p.reservation).filter(Boolean));
  await page.waitForSelector('.gf-r', { timeout: 10000 });
  const finir = async (quoi) => {
    ok(erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  };
  return { ctx, page, erreurs, journal, poses, finir };
}

async function photo(page, nom, selecteur) {
  if (!CAPTURES || mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.waitForTimeout(300);
  const fichier = path.join(CAPTURES, `${nom}.png`);
  if (selecteur) await page.locator(selecteur).first().screenshot({ path: fichier }).catch(() => {});
  else await page.screenshot({ path: fichier });
  console.log(`      image : ${fichier}`);
}

// ---- Lire le journal, lire la base -----------------------------------------
// Ce qui ECRIT : une creation (POST sans dryRun) ou une modification (PATCH). Les calculs a blanc ne comptent pas.
const ecritures = (journal) => journal.filter((j) => j.m === 'PATCH' || (j.m === 'POST' && !(j.corps && j.corps.dryRun)));
const creations = (journal) => journal.filter((j) => j.m === 'POST' && !(j.corps && j.corps.dryRun));
const corpsCree = (entree) => (entree && entree.corps ? (Array.isArray(entree.corps.dossiers) ? entree.corps.dossiers[0] : entree.corps) : null);
async function nouveaux(page, avant, attendre = (lignes) => lignes.length > 0) {
  let lignes = [];
  for (let i = 0; i < 60; i += 1) {
    lignes = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
    if (attendre(lignes)) break;
    await page.waitForTimeout(100);
  }
  return lignes;
}
const vide = (v) => !String(v == null ? '' : v).trim();

// ---- Reserver ---------------------------------------------------------------
async function ouvrirReserver(page) {
  await page.evaluate(() => openQuickBook());
  await page.waitForSelector('#rsHaut [data-pax="4"]');
  await page.click('#rsHaut [data-pax="4"]');
  await page.waitForSelector('#rsHaut [data-pax="4"].is-on');
  await page.click(`#rsT-${DUCKPIN}`);
  await page.waitForSelector(`#rsL-a-${DUCKPIN}`, { timeout: 8000 });
  await page.waitForFunction(() => { const b = document.getElementById('rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 10000 }).catch(() => null);
}
// Le contact du ticket tel que l ecran le montre : le champ, son libelle, le bouton et leurs places.
const lireContact = (page) => page.evaluate(() => {
  const m = document.querySelector('#quickBookOverlay .qb-modal.rv');
  const q = (sel) => (m ? m.querySelector(sel) : null);
  const tel = q('#qbPhone');
  const mail = q('#qbEmail');
  const b = q('#rsContactBascule');
  const champ = tel || mail;
  const cadre = champ ? champ.closest('.rs-tk-champ') : null;
  const lbl = cadre ? cadre.querySelector('.rs-tk-lbl') : null;
  const rect = (e) => { if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), l: Math.round(r.width), h: Math.round(r.height), droite: Math.round(r.right) }; };
  const cs = b ? getComputedStyle(b) : null;
  const dit = q('#rsTelDit');
  return {
    tel: tel ? { valeur: tel.value, placeholder: tel.placeholder, type: tel.type, requis: tel.required } : null,
    mail: mail && mail.closest('.rs-tk') ? { valeur: mail.value, placeholder: mail.placeholder, type: mail.type, inputmode: mail.inputMode, autocomplete: mail.getAttribute('autocomplete'), requis: mail.required } : null,
    libelle: lbl ? lbl.textContent.replace(/\s+/g, ' ').trim() : '',
    bouton: b ? { texte: b.textContent.trim(), type: b.type, fond: cs.backgroundColor, bordure: cs.borderTopWidth, styleBordure: cs.borderTopStyle, couleur: cs.color, police: cs.fontFamily, rect: rect(b) } : null,
    fondChamp: champ ? getComputedStyle(champ).backgroundColor : '',
    champRect: rect(champ),
    dit: dit && !dit.hidden ? dit.textContent.replace(/\s+/g, ' ').trim() : '',
    manque: Boolean(cadre && cadre.classList.contains('is-manque')),
    focus: document.activeElement ? document.activeElement.id : '',
    lien: ((q('#rsL-client') || {}).textContent || '').trim(),
    fenetre: m ? m.textContent.replace(/\s+/g, ' ') : '',
    etat: typeof quickBookState !== 'undefined' && quickBookState ? { contact: quickBookState.contact || '', phone: quickBookState.phone, email: quickBookState.email } : null,
  };
});
// « Encadre » : un bord visible, le fond du champ (jamais plein, jamais noir), la police de la console.
const encadre = (c) => Boolean(c && c.bouton) && c.bouton.type === 'button' && parseFloat(c.bouton.bordure) >= 1 && c.bouton.styleBordure !== 'none'
  && c.bouton.fond === c.fondChamp && !/^rgba?\(0, 0, 0(, 1)?\)$/.test(c.bouton.fond) && /Geist/i.test(c.bouton.police);
// A droite du champ, sur sa ligne, de sa hauteur (44 px au moins, le doigt).
const aDroite = (c) => Boolean(c && c.bouton && c.bouton.rect && c.champRect) && c.bouton.rect.h >= 44 && Math.abs(c.bouton.rect.y - c.champRect.y) <= 2
  && Math.abs(c.bouton.rect.h - c.champRect.h) <= 2 && c.bouton.rect.x >= c.champRect.droite;
// Peu de place : le bouton tient en 120 px, le champ garde au moins deux fois sa largeur.
const peuDePlace = (c) => Boolean(c && c.bouton && c.bouton.rect && c.champRect) && c.bouton.rect.l <= 120 && c.champRect.l >= 2 * c.bouton.rect.l;

// ---- Modifier ---------------------------------------------------------------
async function ouvrirModifier(page, id) {
  await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
  await page.waitForSelector('#posOverlay .es-save', { timeout: 8000 });
  await page.waitForTimeout(300);
}
const lireModifier = (page) => page.evaluate(() => {
  const pli = document.getElementById('editContactPli');
  const apercu = document.getElementById('editContactApercu');
  const tel = document.getElementById('editPhoneInput');
  const mail = document.getElementById('editEmailInput');
  const b = document.getElementById('editContactBascule');
  const hint = document.getElementById('editEmailHint');
  const lblMail = document.querySelector('#posOverlay label[for="editEmailInput"]');
  const rect = (e) => { if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), l: Math.round(r.width), h: Math.round(r.height), droite: Math.round(r.right) }; };
  const cs = b ? getComputedStyle(b) : null;
  const champ = tel || mail;
  return {
    ouvert: Boolean(pli && pli.open),
    apercu: apercu ? apercu.textContent.replace(/\s+/g, ' ').trim() : '',
    apercuVisible: Boolean(apercu && apercu.getClientRects().length),
    tel: tel ? tel.value : null,
    telPlaceholder: tel ? tel.placeholder : '',
    mail: mail ? mail.value : null,
    mailType: mail ? mail.type : '',
    mailPlaceholder: mail ? mail.placeholder : '',
    lblMail: lblMail ? lblMail.textContent.replace(/\s+/g, ' ').trim() : '',
    bouton: b ? { texte: b.textContent.trim(), type: b.type, fond: cs.backgroundColor, bordure: cs.borderTopWidth, styleBordure: cs.borderTopStyle, police: cs.fontFamily, rect: rect(b) } : null,
    fondChamp: champ ? getComputedStyle(champ).backgroundColor : '',
    champRect: rect(champ),
    refus: hint && !hint.hidden ? hint.textContent.replace(/\s+/g, ' ').trim() : '',
    modifs: ((document.getElementById('editModifs') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    focus: document.activeElement ? document.activeElement.id : '',
  };
});
async function ouvrirLePli(page) {
  await page.evaluate(() => { const p = document.getElementById('editContactPli'); if (p && !p.open) p.open = true; });
  await page.waitForTimeout(150);
}
// Enregistrer : le clic, la confirmation s il y en a une, et les PATCH partis (attendus ou non).
async function enregistrer(page, journal, { attendu = true } = {}) {
  const avant = journal.filter((j) => j.m === 'PATCH').length;
  await page.click('#posOverlay .es-save').catch(() => {});
  for (let i = 0; i < (attendu ? 80 : 12); i += 1) {
    const confirmer = page.locator('.staff-confirm [data-role="confirm-ok"]');
    if (await confirmer.count()) await confirmer.first().click().catch(() => {});
    if (journal.filter((j) => j.m === 'PATCH').length > avant) break;
    await page.waitForTimeout(125);
  }
  await page.waitForTimeout(400);
  return journal.filter((j) => j.m === 'PATCH').slice(avant);
}

// ---- La fiche et le planning ------------------------------------------------
const ligneDuPlanning = (page, nom) => page.evaluate((n) => {
  const r = [...document.querySelectorAll('.gf-r')].find((x) => x.textContent.includes(n));
  if (!r) return null;
  return { texte: r.textContent.replace(/\s+/g, ' ').trim(), liens: [...r.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href')), mots: [...r.querySelectorAll('.gf-nom__tel.is-mot')].map((s) => s.textContent.trim()) };
}, nom);
async function lireFiche(page, id) {
  await page.evaluate((i) => { closePos(); openPos(i); setTab('infos'); }, id);
  await page.waitForSelector('#posOverlay section.fx-client', { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const bloc = document.querySelector('#posOverlay section.fx-client');
    const ajouter = bloc ? bloc.querySelector('.fz-ajouter-contact') : null;
    return {
      texte: bloc ? bloc.textContent.replace(/\s+/g, ' ').trim() : '',
      appels: bloc ? [...bloc.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href')) : [],
      ecrire: bloc ? [...bloc.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute('href')) : [],
      ajouter: ajouter ? ajouter.getAttribute('onclick') : '',
    };
  });
}

// ---------------------------------------------------------------------------
// [S] LE SERVEUR
// ---------------------------------------------------------------------------
async function appelerPublic(corps, ip = '10.77.1.9') {
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
}

async function scenarioS() {
  console.log('\n[S] le serveur : « Par mail » sans numero, une adresse qui tient ou rien');
  globalThis.__comptoirMaintenant = FX.instant(JOUR, HEURE).getTime();
  B.semer([]);
  const dire = (x) => `${x.statut} ${x.message}`;
  const nombre = () => B.base.reservations.size;

  // La creation, un dossier a la fois.
  const vide1 = await creer('Mail Vide', '16:00', { contact: 'mail', phone: '', email: '' });
  const r1 = vide1.reservation ? enBase(vide1.reservation.id) : null;
  ok(vide1.statut === 201 && Boolean(r1) && vide(r1.phone) && vide(r1.email), '[S] Par mail, sans numero ni adresse : le serveur cree le dossier, sans telephone ni e-mail', { statut: dire(vide1), phone: r1 && r1.phone, email: r1 && r1.email });
  const sansContact = await creer('Sans Contact', '16:00', { phone: '', email: '' });
  ok(sansContact.statut === 422 && /t[ée]l[ée]phone/i.test(sansContact.message), '[S] sans « Par mail », un telephone vide reste refuse, et le refus le nomme', dire(sansContact));
  const brute = await creer('Mail Brut', '17:00', { contact: 'mail', phone: '', email: '  Mailto:Jean.Dupont@Gmail.COM. ' });
  const r2 = brute.reservation ? enBase(brute.reservation.id) : null;
  ok(brute.statut === 201 && Boolean(r2) && r2.email === 'jean.dupont@gmail.com', '[S] Par mail, l adresse tapee se range nettoyee (sans espaces, sans « mailto: », sans le point final, en minuscules)', { statut: dire(brute), email: r2 && r2.email });
  const avantFausse = nombre();
  const fausse = await creer('Mail Faux', '18:00', { contact: 'mail', phone: '', email: 'jean@gmail' });
  ok(fausse.statut === 422 && fausse.message === PHRASE_ADRESSE && nombre() === avantFausse, '[S] une adresse fausse se refuse a la creation, avec la phrase du comptoir, et rien ne s ecrit', { statut: dire(fausse), avant: avantFausse, apres: nombre() });
  const fausseTel = await creer('Tel Faux Mail', '18:00', { phone: '0470 11 12 22', email: 'jean@@gmail.com' });
  ok(fausseTel.statut === 422 && fausseTel.message === PHRASE_ADRESSE, '[S] au telephone aussi, une adresse tapee doit tenir', dire(fausseTel));
  const numeroCourt = await creer('Mail Court', '18:00', { contact: 'mail', phone: '0470', email: '' });
  ok(numeroCourt.statut === 422 && /8 chiffres/.test(numeroCourt.message), '[S] Par mail, un numero envoye quand meme doit tenir', dire(numeroCourt));

  // L adresse deja connue : la fenetre Reserver demande le client a son numero (GET ?client=), la reponse porte
  // l adresse la plus recente de CE centre, jamais celle d un autre centre qui a le meme numero.
  const habitue = await creer('Habitue Mail', '17:30', { phone: '0470 55 66 77', email: 'Habitue@Exemple.BE' });
  B.base.reservations.set(9001, B.ligne(9001, { center_id: 'autre-centre', phone: '0470 55 66 77', email: 'intrus@autre-centre.be', name: 'Habitue Mail', date: JOUR, status: 'pending', start_time: '18:30' }));
  const connu = await serveur.appeler('GET', `${URL_RESA}?client=0470556677&centerId=libramont`);
  ok(habitue.statut === 201 && connu.statut === 200 && Boolean(connu.json.client) && connu.json.client.email === 'habitue@exemple.be',
    '[S] un client deja venu : la reponse porte son adresse, celle de ce centre, nettoyee', { statut: connu.statut, client: connu.json.client && connu.json.client.email });
  const inconnu = await serveur.appeler('GET', `${URL_RESA}?client=0470889900&centerId=libramont`);
  ok(inconnu.statut === 200 && !inconnu.json.client, '[S] un numero inconnu de ce centre ne rend aucune adresse', { statut: inconnu.statut, client: inconnu.json.client });
  B.base.reservations.delete(9001);

  // Le lot : chaque dossier juge seul, l echec dit son rang.
  const lot = await serveur.appeler('POST', URL_RESA, { centerId: 'libramont', dossiers: [
    corpsDuckpin('Lot Bon', '19:00', { contact: 'mail', phone: '', email: 'Marie.Lot@Exemple.BE' }),
    corpsDuckpin('Lot Faux', '19:00', { contact: 'mail', phone: '', email: 'pas-une-adresse' }),
  ] });
  const lotCrees = (lot.json.reservations || []).map((r) => ({ index: r.index, email: r.reservation ? (enBase(r.reservation.id) || {}).email : null }));
  const lotEchecs = (lot.json.echecs || []).map((e) => ({ index: e.index, message: e.message }));
  ok(lot.statut === 207 && lotCrees.length === 1 && lotCrees[0].index === 0 && lotCrees[0].email === 'marie.lot@exemple.be' && lotEchecs.length === 1 && lotEchecs[0].index === 1 && lotEchecs[0].message === PHRASE_ADRESSE,
    '[S] le lot : le dossier « Par mail » passe, son adresse nettoyee ; l adresse fausse rend son echec avec son rang', { statut: lot.statut, lotCrees, lotEchecs });

  // Modifier.
  const base = await creer('Famille Modif', '20:00', { phone: '0470 12 34 56', email: '' });
  const id = base.reservation ? base.reservation.id : null;
  const patch = async (champs) => { const rep = await serveur.appeler('PATCH', URL_RESA, { id, centerId: 'libramont', ...champs }); return { statut: rep.statut, message: rep.json.message || rep.json.error || '' }; };
  ok(base.statut === 201 && Boolean(id), 'MONTAGE un dossier au telephone, sans adresse', dire(base));
  const pFausse = await patch({ email: 'marie@exemple' });
  ok(pFausse.statut === 422 && pFausse.message === PHRASE_ADRESSE && vide((enBase(id) || {}).email), '[S] Modifier : une adresse fausse se refuse, la base garde la sienne', { statut: dire(pFausse), email: (enBase(id) || {}).email });
  const pBonne = await patch({ email: ' Marie@Exemple.BE ' });
  ok(pBonne.statut === 200 && (enBase(id) || {}).email === 'marie@exemple.be', '[S] Modifier : une adresse ajoutee se range nettoyee', { statut: dire(pBonne), email: (enBase(id) || {}).email });
  const pVide = await patch({ email: '' });
  ok(pVide.statut === 200 && vide((enBase(id) || {}).email), '[S] Modifier : une adresse videe s efface (le client n en a plus)', { statut: dire(pVide), email: (enBase(id) || {}).email });
  const ligne = enBase(id);
  if (ligne) ligne.email = 'ancienne@adresse';
  const pAncienne = await patch({ name: 'Famille Renommee', email: 'ancienne@adresse' });
  ok(pAncienne.statut === 200 && (enBase(id) || {}).name === 'Famille Renommee' && (enBase(id) || {}).email === 'ancienne@adresse', '[S] Modifier : une ancienne adresse qui ne tient pas ne bloque pas les autres changements', { statut: dire(pAncienne), ligne: enBase(id) && { name: enBase(id).name, email: enBase(id).email } });
  const pSansNumero = await patch({ phone: '', email: 'famille@exemple.be' });
  ok(pSansNumero.statut === 200 && vide((enBase(id) || {}).phone) && (enBase(id) || {}).email === 'famille@exemple.be', '[S] Modifier : « Par mail » retire le numero et pose l adresse', { statut: dire(pSansNumero), phone: (enBase(id) || {}).phone, email: (enBase(id) || {}).email });

  // En ligne, rien ne change : le telephone reste obligatoire, « contact: mail » n y ouvre rien.
  const pub = await appelerPublic({ centerId: 'libramont', date: '2027-01-19', startTime: '15:00', pax: 4, companions: 0, channel: 'public', occasion: '', type: 'visite',
    program: [{ activityId: 'bowling', duration: 1 }], preference: { preferredTimes: { bowling: '15:00' }, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' },
    price: 0, basePrice: 0, duration: 1, totalDuration: 1, name: 'Client Essai', email: 'client@example.test', phone: '', contact: 'mail' });
  ok(pub.statut >= 400 && /t[ée]l[ée]phone/i.test(String(pub.json.message || '')), '[S] en ligne, « contact: mail » n ouvre rien : le telephone reste obligatoire', { statut: pub.statut, message: pub.json.message });
}

// ---------------------------------------------------------------------------
// [J] LA MEME REGLE DES DEUX COTES
// ---------------------------------------------------------------------------
// La page, lue sur le disque (mutee en memoire pour une contre-preuve), dans un bac a sable : les fonctions
// du contact et de l adresse, et celles qu elles appellent.
function chargerLaPage() {
  const source = transformer(APP, lf(fs.readFileSync(path.join(ROOT, APP), 'utf8')));
  const bac = { console, quickBookState: null };
  vm.createContext(bac);
  const tranche = (de, a) => {
    const debut = source.indexOf(de);
    if (debut < 0) throw new Error(`la page n a plus ${de}`);
    const fin = source.indexOf(a, debut + de.length);
    return source.slice(debut, fin < 0 ? undefined : fin);
  };
  // Le bloc du contact « Par mail » : rvMotParMail, rvSansNumero, rvContactInitial, rvParMail,
  // RV_EMAIL_INVALIDE, rvEmailNettoye, rvEmailValide, rvContactPret.
  vm.runInContext(tranche('function rvMotParMail(', '\nfunction rvTelephoneEnvoyable('), bac);
  for (const nom of ['rvRessembleAUnNumero', 'normalizePhoneInput', 'rvTelephoneValide', 'rvTelephoneSaisiTexte', 'rvTelephoneEnvoyable', 'telephoneEnvoyeEdition', 'emailEnvoyeEdition', 'refusEmailEdition']) {
    vm.runInContext(tranche(`function ${nom}(`, '\nfunction '), bac);
  }
  bac.lire = (expr) => vm.runInContext(expr, bac);
  return bac;
}

// Les adresses : ce que le comptoir tape, juste ou faux, et ce qu un copier-coller laisse.
const ADRESSES = [
  ['jean.dupont@gmail.com', 'jean.dupont@gmail.com', true],
  ['Jean.Dupont@Gmail.COM', 'jean.dupont@gmail.com', true],
  [' jean @ gmail.com ', 'jean@gmail.com', true],
  ['mailto:jean@gmail.com', 'jean@gmail.com', true],
  ['MAILTO:Jean@Gmail.com', 'jean@gmail.com', true],
  ['Jean Dupont <jean@gmail.com>', 'jean@gmail.com', true],
  ['<jean@exemple.be>', 'jean@exemple.be', true],
  ['jean@gmail.com.', 'jean@gmail.com', true],
  ['jean@exemple.be;', 'jean@exemple.be', true],
  ['jean@exemple.be,', 'jean@exemple.be', true],
  ['jean@exemple.be\u200b', 'jean@exemple.be', true],
  ['\ufeffjean@exemple.be', 'jean@exemple.be', true],
  ['jean+resa@exemple.be', 'jean+resa@exemple.be', true],
  ["o'neil@exemple.ie", "o'neil@exemple.ie", true],
  ['marie-claire.van.den.broeck@telenet.be', 'marie-claire.van.den.broeck@telenet.be', true],
  ['élise@exemple.fr', 'élise@exemple.fr', true],
  ['e\u0301lise@exemple.fr', 'élise@exemple.fr', true],
  ['jean@café.be', 'jean@café.be', true],
  ['jean@exemple.xn--p1ai', 'jean@exemple.xn--p1ai', true],
  ['jean@mail.skynet.be', 'jean@mail.skynet.be', true],
  ['j@x.be', 'j@x.be', true],
  [`${'a'.repeat(64)}@exemple.be`, `${'a'.repeat(64)}@exemple.be`, true],
  ['', '', false],
  ['   ', '', false],
  ['par mail', 'parmail', false],
  ['0470 12 34 56', '0470123456', false],
  ['jean', 'jean', false],
  ['jean@', 'jean@', false],
  ['@gmail.com', '@gmail.com', false],
  ['jean@gmail', 'jean@gmail', false],
  ['jean@gmail.c', 'jean@gmail.c', false],
  ['jean@@gmail.com', 'jean@@gmail.com', false],
  ['jean@gm@ail.com', 'jean@gm@ail.com', false],
  ['jean.@gmail.com', 'jean.@gmail.com', false],
  ['.jean@gmail.com', '.jean@gmail.com', false],
  ['je..an@gmail.com', 'je..an@gmail.com', false],
  ['jean@-gmail.com', 'jean@-gmail.com', false],
  ['jean@gmail-.com', 'jean@gmail-.com', false],
  ['jean@gmail..com', 'jean@gmail..com', false],
  ['jean@exemple,be', 'jean@exemple,be', false],
  ['jean,marie@exemple.be', 'jean,marie@exemple.be', false],
  ['"jean"@exemple.be', '"jean"@exemple.be', false],
  ['jean@123.45', 'jean@123.45', false],
  ['jean@localhost', 'jean@localhost', false],
  ['jean@[127.0.0.1]', 'jean@[127.0.0.1]', false],
  ['jean@exemple.be (maison)', 'jean@exemple.be(maison)', false],
  [`${'a'.repeat(65)}@exemple.be`, `${'a'.repeat(65)}@exemple.be`, false],
  [`jean@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(60)}.be`, `jean@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(60)}.be`, false],
  ['jean@exemple.b', 'jean@exemple.b', false],
  ['jean@exemple.be@', 'jean@exemple.be@', false],
];

async function scenarioJ() {
  console.log('\n[J] la meme regle des deux cotes : la page et le serveur');
  const page = chargerLaPage();
  const serveurMail = require(path.join(ROOT, LIB));
  const ecartsNettoye = [];
  const ecartsJuge = [];
  const ecartsAttendus = [];
  for (const [tape, propre, juste] of ADRESSES) {
    const p = page.rvEmailNettoye(tape);
    const s = serveurMail.emailNettoye(tape);
    if (p !== s) ecartsNettoye.push(`${JSON.stringify(tape)} : page ${JSON.stringify(p)}, serveur ${JSON.stringify(s)}`);
    const pj = page.rvEmailValide(p);
    const sj = serveurMail.emailValide(s);
    if (pj !== sj) ecartsJuge.push(`${JSON.stringify(tape)} : page ${pj}, serveur ${sj}`);
    if (s !== propre || sj !== juste) ecartsAttendus.push(`${JSON.stringify(tape)} : ${JSON.stringify(s)} ${sj}, attendu ${JSON.stringify(propre)} ${juste}`);
  }
  ok(ecartsNettoye.length === 0, `[J] la page et le serveur nettoient pareil (${ADRESSES.length} adresses)`, ecartsNettoye.slice(0, 3).join(' ; '));
  ok(ecartsJuge.length === 0, `[J] la page et le serveur jugent pareil (${ADRESSES.length} adresses)`, ecartsJuge.slice(0, 3).join(' ; '));
  ok(ecartsAttendus.length === 0, '[J] la regle : une adresse se nettoie et se juge comme le comptoir l attend', ecartsAttendus.slice(0, 3).join(' ; '));
  const phrasePage = page.lire('RV_EMAIL_INVALIDE');
  ok(phrasePage === PHRASE_ADRESSE && serveurMail.MESSAGE_EMAIL_INVALIDE === PHRASE_ADRESSE, '[J] la page et le serveur disent la meme phrase au comptoir', { page: phrasePage, serveur: serveurMail.MESSAGE_EMAIL_INVALIDE });
  ok(serveurMail.EMAIL_MAX === 254 && !/\b(nous|on)\b/i.test(PHRASE_ADRESSE) && !/[\u2013\u2014]/.test(PHRASE_ADRESSE + PHRASE_TELEPHONE), '[J] la phrase vouvoie sans « nous » ni « on », sans tiret cadratin', PHRASE_ADRESSE);

  // « par mail » tape a la main, avant le bouton (2026-11-22).
  const motsParMail = ['par mail', 'Par Mail', 'PAR MAIL.', 'par e-mail', 'par email', 'Par E-Mail', 'mail', 'email', 'e-mail', 'E-mail', 'via mail', 'en mail', 'courriel', 'par courriel', 'mails'];
  const pasParMail = ['mail de la maman', 'maman', '/', '-', '0470 12 34 56', '', 'parmailx', 'pas de mail'];
  const mal = [...motsParMail.filter((t) => !page.rvMotParMail(t)), ...pasParMail.filter((t) => page.rvMotParMail(t))];
  ok(mal.length === 0, '[J] « par mail » (et ses facons de l ecrire) dit « par mail », un autre mot non', mal);
  const sans = { vrai: ['', '+32 ', '+32', '/', ' / ', '-', 'par mail', 'Courriel'], faux: ['0470 12 34 56', '+32 470 12 34 56', 'maman', 'mail de la maman'] };
  const malSans = [...sans.vrai.filter((t) => !page.rvSansNumero(t)), ...sans.faux.filter((t) => page.rvSansNumero(t))];
  ok(malSans.length === 0, '[J] un telephone sans numero : vide, « +32 », « / », « - », « par mail »', malSans);
  const textes = [['par mail', ''], ['Par Mail', ''], ['/', ''], ['maman', 'maman'], ['mail de la maman', 'mail de la maman'], ['0470 12 34 56', '0470 12 34 56']];
  const malTexte = textes.filter(([t, attendu]) => page.rvTelephoneSaisiTexte(t) !== attendu).map(([t]) => `${t} -> ${JSON.stringify(page.rvTelephoneSaisiTexte(t))}`);
  ok(malTexte.length === 0, '[J] « par mail » et « / » ne s affichent jamais comme un numero, un autre mot oui', malTexte);
  const envoyables = [['par mail', ''], ['mail de la maman', ''], ['/', ''], ['0470 12 34 56', '0470123456']];
  const malEnvoi = envoyables.filter(([t, attendu]) => page.rvTelephoneEnvoyable(t) !== attendu).map(([t]) => t);
  ok(malEnvoi.length === 0, '[J] seul un vrai numero peut servir a appeler', malEnvoi);

  // Le dossier s ouvre « Par mail » quand il le dit.
  const ouvertures = [
    [['par mail', ''], 'mail'], [['Par Mail', 'x@y.be'], 'mail'], [['', 'lea@exemple.be'], 'mail'], [['+32 ', 'lea@exemple.be'], 'mail'], [['/', 'lea@exemple.be'], 'mail'],
    [['', ''], 'tel'], [['/', ''], 'tel'], [['0470 12 34 56', 'lea@exemple.be'], 'tel'], [['maman', 'lea@exemple.be'], 'tel'],
  ];
  const malOuvre = ouvertures.filter(([[p, e], attendu]) => page.rvContactInitial(p, e) !== attendu).map(([[p, e]]) => `${JSON.stringify(p)} + ${JSON.stringify(e)}`);
  ok(malOuvre.length === 0, '[J] un dossier s ouvre « Par mail » s il le dit, ou s il a une adresse et aucun numero', malOuvre);

  // Ce que Modifier enverra, selon ce que l ecran montre.
  const tel = (es, origine) => page.telephoneEnvoyeEdition(es, origine);
  const envoisTel = [
    [{ contact: 'mail', phone: '0470 12 34 56' }, { phone: '0470 12 34 56' }, ''],
    [{ contact: 'mail', phone: '' }, { phone: 'par mail' }, 'par mail'],
    [{ contact: 'mail', phone: '' }, { phone: '/' }, '/'],
    [{ contact: 'tel', phone: '' }, { phone: '/' }, '/'],
    [{ contact: 'tel', phone: '' }, { phone: 'par mail' }, 'par mail'],
    [{ contact: 'tel', phone: '0471 22 33 44' }, { phone: 'par mail' }, '0471 22 33 44'],
    [{ contact: 'tel', phone: '' }, { phone: '0470 12 34 56' }, ''],
  ];
  const malTel = envoisTel.filter(([es, o, attendu]) => tel(es, o) !== attendu).map(([es, o]) => `${JSON.stringify(es)} sur ${JSON.stringify(o)} -> ${JSON.stringify(tel(es, o))}`);
  const envoisMail = [
    [{ email: ' Marie@Exemple.BE ' }, { email: '' }, 'marie@exemple.be'],
    [{ email: 'ancienne@adresse' }, { email: 'ancienne@adresse' }, 'ancienne@adresse'],
    [{ email: 'ANCIENNE@adresse' }, { email: 'ancienne@adresse' }, 'ancienne@adresse'],
    [{ email: '' }, { email: 'x@y.be' }, ''],
  ];
  const malMail = envoisMail.filter(([es, o, attendu]) => page.emailEnvoyeEdition(es, o) !== attendu).map(([es, o]) => `${JSON.stringify(es)} sur ${JSON.stringify(o)}`);
  const refus = [
    [{ email: 'marie@exemple' }, { email: '' }, PHRASE_ADRESSE],
    [{ email: 'ancienne@adresse' }, { email: 'ancienne@adresse' }, ''],
    [{ email: '' }, { email: 'x@y.be' }, ''],
    [{ email: 'Marie@Exemple.BE' }, { email: '' }, ''],
  ];
  const malRefus = refus.filter(([es, o, attendu]) => page.refusEmailEdition(es, o) !== attendu).map(([es, o]) => `${JSON.stringify(es)} sur ${JSON.stringify(o)} -> ${JSON.stringify(page.refusEmailEdition(es, o))}`);
  ok(malTel.length === 0 && malMail.length === 0 && malRefus.length === 0, '[J] Modifier envoie ce que l ecran dit : « Par mail » retire un numero, rien ne change sans geste, une adresse changee se juge', { malTel, malMail, malRefus });
}

// ---------------------------------------------------------------------------
// [R] RESERVER
// ---------------------------------------------------------------------------
async function scenarioR(browser) {
  console.log('\n[R] Reserver : le bouton « Par mail » a cote du telephone');
  const m = await ouvrirConsole(browser, ['sansNumero', 'adresse']);
  const { page, journal } = m;
  try {
    await ouvrirReserver(page);
    const c1 = await lireContact(page);
    ok(Boolean(c1.tel) && Boolean(c1.bouton) && c1.bouton.texte === 'Par mail' && encadre(c1) && aDroite(c1) && peuDePlace(c1),
      '[R] a cote du telephone, le bouton encadre « Par mail » : a droite du champ, de sa hauteur, peu de place', { tel: c1.tel, bouton: c1.bouton, fondChamp: c1.fondChamp, champ: c1.champRect });
    ok(Boolean(c1.tel) && c1.tel.placeholder === '0470 12 34 56' && /obligatoire/.test(c1.libelle), '[R] le champ du numero reste obligatoire et ne propose plus « par mail, / »', { tel: c1.tel, libelle: c1.libelle });
    await photo(page, 'reserver-telephone-et-par-mail', '#quickBookOverlay .rs-tk');

    // Le bouton : le champ devient celui de l e-mail, rien ne part.
    const avant = ecritures(journal).length;
    await page.click('#rsContactBascule');
    await page.mouse.move(2, 2); // la souris quitte le bouton : son fond de survol n est pas son fond de repos
    await page.waitForTimeout(300);
    const c2 = await lireContact(page);
    ok(!c2.tel && Boolean(c2.mail) && c2.mail.type === 'email' && c2.mail.inputmode === 'email' && c2.mail.autocomplete === 'off' && !c2.mail.requis && c2.mail.valeur === '' && c2.mail.placeholder === 'prenom@email.be'
      && /^E-mail/.test(c2.libelle) && /facultatif/.test(c2.libelle) && !/obligatoire/.test(c2.libelle) && Boolean(c2.bouton) && c2.bouton.texte === 'Par téléphone' && c2.lien === 'Occasion',
    '[R] « Par mail » : le champ devient celui de l e-mail, facultatif, au clavier e-mail ; « Par téléphone » a sa place', { mail: c2.mail, libelle: c2.libelle, bouton: c2.bouton && c2.bouton.texte, lien: c2.lien });
    ok(c2.focus === 'qbEmail' && ecritures(journal).length === avant && encadre(c2) && aDroite(c2), '[R] le focus passe dans le champ de l e-mail, le bouton reste a sa place, rien ne part au serveur', { focus: c2.focus, bouton: c2.bouton, fondChamp: c2.fondChamp, champRect: c2.champRect, ecritures: ecritures(journal).length - avant });
    await photo(page, 'reserver-par-mail', '#quickBookOverlay .rs-tk');

    // Créer sans adresse : le dossier part, sans numero ni adresse, en un envoi.
    const avantBase = new Set(B.base.reservations.keys());
    const postes0 = creations(journal).length;
    await page.click('#rvCreer');
    const crees = await nouveaux(page, avantBase);
    const postes = creations(journal).slice(postes0);
    const corps = corpsCree(postes[0]);
    ok(crees.length === 1 && vide(crees[0].phone) && vide(crees[0].email), '[R] Par mail, adresse vide : Créer cree le dossier, sans telephone ni e-mail', { n: crees.length, phone: crees[0] && crees[0].phone, email: crees[0] && crees[0].email, postes: postes.map((p) => `${p.statut} ${(p.json || {}).message || ''}`) });
    ok(postes.length === 1 && postes[0].statut === 201 && Boolean(corps) && corps.contact === 'mail' && vide(corps.phone) && vide(corps.email), '[R] un seul envoi, « Par mail » dit au serveur, aucun numero', { n: postes.length, contact: corps && corps.contact, phone: corps && corps.phone });
    await page.waitForTimeout(400);

    // Le clavier : Tab va du telephone au nom, Maj+Tab atteint le bouton, Entree le touche.
    await ouvrirReserver(page);
    await page.click('#qbPhone');
    await page.keyboard.type('0470 99 88 77', { delay: 10 });
    await page.keyboard.press('Tab');
    const apresTab = await lireContact(page);
    ok(apresTab.focus === 'qbName', '[R] Tab va du telephone au nom, comme avant', { focus: apresTab.focus });
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    const surBouton = await lireContact(page);
    ok(surBouton.focus === 'rsContactBascule', '[R] Maj+Tab depuis le telephone atteint le bouton « Par mail »', { focus: surBouton.focus });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const auClavier = await lireContact(page);
    ok(Boolean(auClavier.mail) && !auClavier.tel && auClavier.focus === 'qbEmail', '[R] Entree sur le bouton passe « Par mail » : le clavier suffit', { mail: auClavier.mail, focus: auClavier.focus });
    await page.click('#rsContactBascule');
    await page.waitForTimeout(300);
    const retour = await lireContact(page);
    ok(Boolean(retour.tel) && String(retour.tel.valeur).replace(/\D/g, '').endsWith('470998877') && Boolean(retour.bouton) && retour.bouton.texte === 'Par mail' && retour.focus === 'qbPhone',
      '[R] « Par téléphone » rend le champ du numero, le numero tape garde, le focus dedans', { tel: retour.tel, bouton: retour.bouton && retour.bouton.texte, focus: retour.focus });
    // Un numero deja venu dans CE centre : « Par mail » montre son adresse, sans qu on la retape.
    await page.fill('#qbPhone', DOSSIERS.adresse.champs.phone);
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => quickBookState && quickBookState.clientConnu && quickBookState.clientConnu.etat === 'ok' && /470123456$/.test(quickBookState.clientConnu.cle), null, { timeout: 8000 }).catch(() => null);
    await page.click('#rsContactBascule');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const connu = await lireContact(page); connu.cc = await page.evaluate(() => JSON.stringify(quickBookState.clientConnu));
    ok(Boolean(connu.mail) && connu.mail.valeur === DOSSIERS.adresse.champs.email, '[R] un client deja venu dans ce centre : « Par mail » montre son adresse, deja dans le champ', { mail: connu.mail, etat: connu.etat, cc: connu.cc });
    await photo(page, 'reserver-adresse-connue', '#quickBookOverlay .rs-tk');
    await page.click('#rsContactBascule');
    await page.waitForTimeout(300);
    // Au telephone, un champ vide ne part pas : il mene au bouton.
    const avantVide = new Set(B.base.reservations.keys());
    await page.fill('#qbPhone', '');
    await page.click('#rvCreer');
    await page.waitForTimeout(500);
    const champVide = await lireContact(page);
    ok(champVide.dit === PHRASE_TELEPHONE && champVide.manque && champVide.focus === 'qbPhone' && (await nouveaux(page, avantVide, () => false)).length === 0,
      '[R] au telephone, un champ vide ne part pas : il dit le bouton « Par mail » et garde la main', { dit: champVide.dit, manque: champVide.manque, focus: champVide.focus });
    await photo(page, 'reserver-telephone-vide', '#quickBookOverlay .rs-tk');
    await page.evaluate(() => closeQuickBook());
    await page.waitForTimeout(300);

    // Un client qui a deja une adresse (la page Clients, « Réserver ») : la fenetre s ouvre « Par mail ».
    const ouvert = await page.evaluate((email) => {
      staffClientRowsMemo = { key: '', rows: null, src0: null, src1: null, src2: null }; // eslint-disable-line no-undef
      const ligne = getStaffClientRows().find((c) => c.email === email); // eslint-disable-line no-undef
      if (ligne) openStaffClientBooking(ligne.id); // eslint-disable-line no-undef
      return ligne ? { id: ligne.id, phone: ligne.phone } : null;
    }, DOSSIERS.sansNumero.champs.email);
    await page.waitForSelector('#quickBookOverlay #qbEmail, #quickBookOverlay #qbPhone', { timeout: 8000 }).catch(() => null);
    const client = await lireContact(page);
    ok(Boolean(ouvert) && Boolean(client.mail) && client.mail.valeur === DOSSIERS.sansNumero.champs.email && !client.tel && Boolean(client.bouton) && client.bouton.texte === 'Par téléphone',
      '[R] un client qui a deja une adresse : Reserver s ouvre « Par mail », l adresse deja dans le champ', { ligne: ouvert, mail: client.mail, tel: client.tel, bouton: client.bouton && client.bouton.texte });
    await photo(page, 'reserver-client-connu-par-mail', '#quickBookOverlay .rs-tk');
    await page.evaluate(() => closeQuickBook());
  } catch (erreur) {
    ok(false, '[R] interrompu', String(erreur && erreur.message).slice(0, 200));
  }
  await m.finir('R');
}

// ---------------------------------------------------------------------------
// [E] UNE ADRESSE FAUSSE
// ---------------------------------------------------------------------------
async function scenarioE(browser) {
  console.log('\n[E] une adresse fausse : refusee a l ecran, et au serveur');
  const m = await ouvrirConsole(browser);
  const { page, journal } = m;
  try {
    await ouvrirReserver(page);
    await page.click('#rsContactBascule');
    await page.fill('#qbEmail', 'jean@gmail');
    const avantBase = new Set(B.base.reservations.keys());
    const avant = ecritures(journal).length;
    await page.click('#rvCreer');
    await page.waitForTimeout(600);
    const refus = await lireContact(page);
    ok(refus.dit === PHRASE_ADRESSE && refus.manque && refus.focus === 'qbEmail' && ecritures(journal).length === avant && (await nouveaux(page, avantBase, () => false)).length === 0,
      '[E] une adresse fausse ne part pas : le champ le dit en rouge et garde la main', { dit: refus.dit, manque: refus.manque, focus: refus.focus, ecritures: ecritures(journal).length - avant });
    await photo(page, 'reserver-adresse-fausse', '#quickBookOverlay .rs-tk');
    await page.focus('#qbEmail');
    await page.keyboard.press('End');
    await page.keyboard.type('.com', { delay: 10 });
    const corrigee = await lireContact(page);
    ok(!corrigee.manque && !corrigee.dit && Boolean(corrigee.mail) && corrigee.mail.valeur === 'jean@gmail.com', '[E] l adresse corrigee, le rouge s en va pendant la frappe', { manque: corrigee.manque, dit: corrigee.dit, mail: corrigee.mail });
    await page.fill('#qbEmail', 'Jean@Gmail.COM');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const nettoyee = await lireContact(page);
    ok(Boolean(nettoyee.mail) && nettoyee.mail.valeur === 'jean@gmail.com' && Boolean(nettoyee.etat) && nettoyee.etat.email === 'jean@gmail.com', '[E] l adresse se nettoie quand le champ rend la main (« Jean@Gmail.COM » devient « jean@gmail.com »)', { mail: nettoyee.mail, etat: nettoyee.etat });
    const avantCreer = new Set(B.base.reservations.keys());
    const postes0 = creations(journal).length;
    await page.click('#rvCreer');
    const crees = await nouveaux(page, avantCreer);
    const corps = corpsCree(creations(journal).slice(postes0)[0]);
    ok(crees.length === 1 && crees[0].email === 'jean@gmail.com' && vide(crees[0].phone) && Boolean(corps) && corps.contact === 'mail' && corps.email === 'jean@gmail.com',
      '[E] Créer : le dossier porte l adresse nettoyee, sans numero', { n: crees.length, email: crees[0] && crees[0].email, phone: crees[0] && crees[0].phone, corps: corps && { contact: corps.contact, email: corps.email } });
    await page.waitForTimeout(400);

    // Si la page la laissait passer, le serveur la refuse, et la fenetre le dit.
    await ouvrirReserver(page);
    await page.click('#rsContactBascule');
    await page.evaluate(() => { window.rvEmailValide = () => true; });
    await page.fill('#qbEmail', 'jean@gmail');
    const avantServeur = new Set(B.base.reservations.keys());
    const postesAvant = creations(journal).length;
    await page.click('#rvCreer');
    for (let i = 0; i < 40 && creations(journal).length === postesAvant; i += 1) await page.waitForTimeout(100);
    await page.waitForTimeout(500);
    const parti = creations(journal).slice(postesAvant);
    const dit = await lireContact(page);
    ok(parti.length === 1 && parti[0].statut === 422 && (parti[0].json || {}).message === PHRASE_ADRESSE && dit.fenetre.includes(PHRASE_ADRESSE) && (await nouveaux(page, avantServeur, () => false)).length === 0,
      '[E] si la page la laissait passer, le serveur la refuse (422) et la fenetre le dit, rien ne se cree', { partis: parti.map((p) => `${p.statut} ${(p.json || {}).message || ''}`), ditLaFenetre: dit.fenetre.includes(PHRASE_ADRESSE) });
    await photo(page, 'reserver-refus-du-serveur', '#quickBookOverlay .rs-tk');
    await page.evaluate(() => closeQuickBook());
  } catch (erreur) {
    ok(false, '[E] interrompu', String(erreur && erreur.message).slice(0, 200));
  }
  await m.finir('E');
}

// ---------------------------------------------------------------------------
// [M] MODIFIER
// ---------------------------------------------------------------------------
async function scenarioM(browser) {
  console.log('\n[M] Modifier : l adresse du dossier, « Par mail » et « Par téléphone »');
  const m = await ouvrirConsole(browser, ['adresse', 'sansNumero', 'parMail']);
  const { page, journal, poses } = m;
  try {
    const id = (cle) => (poses[cle] && poses[cle].reservation ? poses[cle].reservation.id : null);
    ok(['adresse', 'sansNumero', 'parMail'].every((cle) => poses[cle] && poses[cle].statut === 201), 'MONTAGE trois dossiers : un numero et une adresse, une adresse sans numero, « par mail » sans adresse', Object.fromEntries(Object.entries(poses).map(([k, p]) => [k, `${p.statut} ${p.message}`])));
    const { adresse, sansNumero } = DOSSIERS;

    // Un numero et une adresse : le pli replie les montre, ouvert le telephone, le bouton, l adresse.
    await ouvrirModifier(page, id('adresse'));
    await page.evaluate(() => { const p = document.getElementById('editContactPli'); if (p && p.open) p.open = false; });
    await page.waitForTimeout(150);
    const plie = await lireModifier(page);
    ok(!plie.ouvert && plie.apercuVisible && plie.apercu === `${adresse.champs.phone} · ${adresse.champs.email}`, '[M] replie, le pli montre le numero et l adresse du dossier', { ouvert: plie.ouvert, apercu: plie.apercu, visible: plie.apercuVisible });
    await photo(page, 'modifier-pli-replie', '#editContactPli');
    await page.click('#editContactPli > summary');
    await page.waitForTimeout(200);
    const ouvert = await lireModifier(page);
    ok(ouvert.ouvert && ouvert.tel === adresse.champs.phone && ouvert.mail === adresse.champs.email && Boolean(ouvert.bouton) && ouvert.bouton.texte === 'Par mail',
      '[M] ouvert : le numero, le bouton « Par mail » et l adresse deja dans son champ', { tel: ouvert.tel, mail: ouvert.mail, bouton: ouvert.bouton && ouvert.bouton.texte });
    ok(encadre(ouvert) && aDroite(ouvert), '[M] le bouton « Par mail » de Modifier est encadre, a droite du champ, de sa hauteur', { bouton: ouvert.bouton, fondChamp: ouvert.fondChamp, champ: ouvert.champRect });
    await photo(page, 'modifier-telephone-et-adresse', '#editContactPli');

    // Une adresse sans numero : le dossier s ouvre « Par mail », l adresse dans le champ.
    await ouvrirModifier(page, id('sansNumero'));
    await ouvrirLePli(page);
    const parMail = await lireModifier(page);
    ok(parMail.tel === null && parMail.mail === sansNumero.champs.email && parMail.mailType === 'email' && Boolean(parMail.bouton) && parMail.bouton.texte === 'Par téléphone' && /^E-mail facultatif$/.test(parMail.lblMail) && parMail.apercu === sansNumero.champs.email,
      '[M] un dossier qui a une adresse et aucun numero s ouvre « Par mail », l adresse dans le champ', parMail);
    await photo(page, 'modifier-par-mail', '#editContactPli');

    // « par mail » sans adresse : une adresse fausse se dit sous son champ, rien ne part ; corrigee, elle se range.
    await ouvrirModifier(page, id('parMail'));
    const pliParMail = await lireModifier(page);
    await ouvrirLePli(page);
    const sansAdresse = await lireModifier(page);
    ok(sansAdresse.tel === null && sansAdresse.mail === '' && sansAdresse.mailPlaceholder === 'prenom@email.be' && pliParMail.apercu === 'Par mail', '[M] un dossier « par mail » s ouvre sur l e-mail, le pli replie dit « Par mail »', { apercu: pliParMail.apercu, tel: sansAdresse.tel, mail: sansAdresse.mail, placeholder: sansAdresse.mailPlaceholder });
    await page.fill('#editEmailInput', 'marie@exemple');
    await page.locator('#editEmailInput').press('Tab');
    await page.waitForTimeout(200);
    const dite = await lireModifier(page);
    const partisFaux = await enregistrer(page, journal, { attendu: false });
    ok(dite.refus === PHRASE_ADRESSE && partisFaux.length === 0 && vide((enBase(id('parMail')) || {}).email), '[M] une adresse fausse se dit sous son champ, rien ne part', { refus: dite.refus, partis: partisFaux.map((p) => p.statut), base: (enBase(id('parMail')) || {}).email });
    await photo(page, 'modifier-adresse-fausse', '#editContactPli');
    await page.fill('#editEmailInput', 'Marie@Exemple.BE');
    await page.waitForTimeout(200);
    const corrigee = await lireModifier(page);
    ok(!corrigee.refus && /E-mail ajouté/.test(corrigee.modifs), '[M] corrigee, le refus s en va et la barre dit « E-mail ajouté »', { refus: corrigee.refus, modifs: corrigee.modifs });
    const partisBons = await enregistrer(page, journal);
    const ligneParMail = enBase(id('parMail')) || {};
    ok(partisBons.length >= 1 && partisBons[partisBons.length - 1].statut === 200 && ligneParMail.email === 'marie@exemple.be' && ligneParMail.phone === 'par mail',
      '[M] Enregistrer : l adresse se range nettoyee, « par mail » reste tel quel', { statuts: partisBons.map((p) => p.statut), email: ligneParMail.email, phone: ligneParMail.phone });

    // « Par mail » sur un dossier qui a un numero : la barre dit « Téléphone retiré », la base n a plus de numero.
    await ouvrirModifier(page, id('adresse'));
    await ouvrirLePli(page);
    await page.click('#editContactBascule');
    await page.waitForTimeout(250);
    const bascule = await lireModifier(page);
    ok(bascule.tel === null && bascule.mail === adresse.champs.email && Boolean(bascule.bouton) && bascule.bouton.texte === 'Par téléphone' && bascule.focus === 'editEmailInput' && /Téléphone retiré/.test(bascule.modifs),
      '[M] « Par mail » sur un dossier qui a un numero : le champ devient l e-mail, la barre dit « Téléphone retiré » avant d enregistrer', { tel: bascule.tel, mail: bascule.mail, focus: bascule.focus, modifs: bascule.modifs });
    const partisRetrait = await enregistrer(page, journal);
    const ligneAdresse = enBase(id('adresse')) || {};
    ok(partisRetrait.length >= 1 && partisRetrait[partisRetrait.length - 1].statut === 200 && vide(ligneAdresse.phone) && ligneAdresse.email === adresse.champs.email,
      '[M] Enregistrer : la base n a plus de numero, l adresse reste', { statuts: partisRetrait.map((p) => p.statut), phone: ligneAdresse.phone, email: ligneAdresse.email });
    await ouvrirModifier(page, id('adresse'));
    await ouvrirLePli(page);
    const rouvert = await lireModifier(page);
    ok(rouvert.tel === null && rouvert.mail === adresse.champs.email, '[M] rouvert, le dossier s ouvre « Par mail »', { tel: rouvert.tel, mail: rouvert.mail });

    // « Par téléphone » sur un dossier « Par mail » : un numero s ajoute, l adresse reste.
    await ouvrirModifier(page, id('sansNumero'));
    await ouvrirLePli(page);
    await page.click('#editContactBascule');
    await page.waitForTimeout(250);
    const versTel = await lireModifier(page);
    await page.fill('#editPhoneInput', '0471 22 33 44');
    await page.waitForTimeout(200);
    const ajoute = await lireModifier(page);
    ok(versTel.tel === '' && versTel.telPlaceholder === 'Facultatif' && versTel.focus === 'editPhoneInput' && ajoute.mail === sansNumero.champs.email && /Téléphone ajouté/.test(ajoute.modifs),
      '[M] « Par téléphone » : le champ du numero, facultatif, et l adresse dessous ; la barre dit « Téléphone ajouté »', { tel: versTel.tel, placeholder: versTel.telPlaceholder, focus: versTel.focus, mail: ajoute.mail, modifs: ajoute.modifs });
    const partisAjout = await enregistrer(page, journal);
    const ligneSans = enBase(id('sansNumero')) || {};
    ok(partisAjout.length >= 1 && partisAjout[partisAjout.length - 1].statut === 200 && ligneSans.phone === '0471 22 33 44' && ligneSans.email === sansNumero.champs.email,
      '[M] Enregistrer : le numero s ajoute, l adresse reste', { statuts: partisAjout.map((p) => p.statut), phone: ligneSans.phone, email: ligneSans.email });
  } catch (erreur) {
    ok(false, '[M] interrompu', String(erreur && erreur.message).slice(0, 200));
  }
  await m.finir('M');
}

// ---------------------------------------------------------------------------
// [F] LA FICHE ET LE PLANNING
// ---------------------------------------------------------------------------
async function scenarioF(browser) {
  console.log('\n[F] la fiche et le planning : « par mail » n est pas un numero');
  const m = await ouvrirConsole(browser, ['adresse', 'sansNumero', 'parMail', 'mot']);
  const { page, poses } = m;
  try {
    const id = (cle) => (poses[cle] && poses[cle].reservation ? poses[cle].reservation.id : null);
    ok(Object.values(poses).every((p) => p.statut === 201), 'MONTAGE quatre dossiers : un numero, une adresse sans numero, « par mail », un autre mot', Object.fromEntries(Object.entries(poses).map(([k, p]) => [k, `${p.statut} ${p.message}`])));

    const lParMail = await ligneDuPlanning(page, DOSSIERS.parMail.nom);
    ok(Boolean(lParMail) && lParMail.liens.length === 0 && lParMail.mots.length === 0 && !/par mail/i.test(lParMail.texte.replace(DOSSIERS.parMail.nom, '')), '[F] le planning n ecrit pas « par mail » comme un numero', lParMail);
    const lMot = await ligneDuPlanning(page, DOSSIERS.mot.nom);
    ok(Boolean(lMot) && lMot.liens.length === 0 && lMot.mots.includes('mail de la maman'), '[F] le planning lit un autre mot sans lien d appel', lMot);
    const lVrai = await ligneDuPlanning(page, DOSSIERS.adresse.nom);
    ok(Boolean(lVrai) && lVrai.liens.includes('tel:0470123456'), '[F] le planning garde le lien d appel d un vrai numero', lVrai);
    await photo(page, 'planning-lignes-contact');

    const fParMail = await lireFiche(page, id('parMail'));
    ok(/Par mail, pas d’adresse/.test(fParMail.texte) && !/par mail/.test(fParMail.texte) && fParMail.appels.length === 0 && /modifierDepuisFiche\('email'/.test(fParMail.ajouter),
      '[F] la fiche d un dossier « par mail » dit « Par mail, pas d’adresse », sans lien d appel', fParMail);
    await photo(page, 'fiche-par-mail-sans-adresse', '#posOverlay section.fx-client');
    await page.click('#posOverlay section.fx-client .fz-ajouter-contact');
    await page.waitForSelector('#editEmailInput', { timeout: 8000 }).catch(() => null);
    await page.waitForTimeout(250);
    const versModifier = await lireModifier(page);
    ok(versModifier.ouvert && versModifier.tel === null && versModifier.mail === '' && versModifier.focus === 'editEmailInput', '[F] « Ajouter » ouvre Modifier sur le champ de l e-mail, le pli ouvert', { ouvert: versModifier.ouvert, tel: versModifier.tel, mail: versModifier.mail, focus: versModifier.focus });

    const fSans = await lireFiche(page, id('sansNumero'));
    ok(fSans.ecrire.includes(`mailto:${DOSSIERS.sansNumero.champs.email}`) && fSans.texte.includes(DOSSIERS.sansNumero.champs.email) && fSans.appels.length === 0, '[F] la fiche d un dossier « Par mail » montre son adresse et un lien pour ecrire', fSans);
    await photo(page, 'fiche-par-mail-avec-adresse', '#posOverlay section.fx-client');
  } catch (erreur) {
    ok(false, '[F] interrompu', String(erreur && erreur.message).slice(0, 200));
  }
  await m.finir('F');
}

// ---------------------------------------------------------------------------
const SCENARIOS = { S: scenarioS, J: scenarioJ, R: scenarioR, E: scenarioE, M: scenarioM, F: scenarioF };
const SANS_NAVIGATEUR = new Set(['S', 'J']);

function verifierLesAncres() {
  let mortes = 0;
  for (const m of [...MUTATIONS, HORLOGE_SERVEUR]) {
    const n = verifierAncre(m);
    if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom || m.fichier} trouvee ${n} fois : ${m.de.slice(0, 80)}`); }
  }
  MUTATIONS.filter((m, i) => MUTATIONS.findIndex((x) => x.nom === m.nom) !== i).forEach((m) => { mortes += 1; console.log(`FAIL  contre-preuve ${m.nom} nommee deux fois`); });
  console.log(`par-mail-check --ancres : ${MUTATIONS.length + 1 - mortes}/${MUTATIONS.length + 1} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS;
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, PAR_MAIL_CASSE: m.nom, PINLANE_PAR_MAIL_PORT: String(PORT + 1 + fil) },
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
  console.log(`par-mail-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const inconnues = seul.filter((nom) => !SCENARIOS[nom]);
  if (inconnues.length) { console.error(`par-mail-check : scenario inconnu ${inconnues.join(', ')}`); process.exit(2); }
  const navigateur = seul.some((nom) => !SANS_NAVIGATEUR.has(nom));
  const http = navigateur ? await FX.servir({ port: PORT, transformer }) : null;
  const browser = navigateur ? await require('playwright-core').chromium.launch({ executablePath: BROWSER_PATH, headless: true }) : null;
  try {
    for (const nom of seul) await SCENARIOS[nom](browser);
  } finally {
    if (browser) await browser.close();
    if (http) http.close();
  }
  console.log(`\npar-mail-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('par-mail-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

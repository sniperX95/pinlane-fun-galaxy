// RESERVER, LES SEANCES (2026-11-03).
//
// Movsar trouvait la fenetre de reservation du comptoir « trop dure ». Il a choisi sur
// images « Les seances » : tout sur un ecran, chaque activite montre ses heures libres
// comme un film ses seances, un toucher sur une heure choisit l activite et l heure, le
// ticket a droite est la reservation. Elle a ete mise au point sur un banc (le vrai
// moteur, un samedi a 46 groupes) : 12 commandes du comptoir sur 12, en 58 gestes au
// lieu de 94. Ce gate porte ce banc dans le depot, et les regles qu elle tient.
//
// Il joue la VRAIE console (scripts/planning-v3-fixtures.js), le VRAI handler
// api/staff-reservations.js et le vrai moteur (scripts/reserver-banc.js, base en
// memoire), le samedi 16 janvier 2027 a 15:10, et verifie toujours le DOSSIER CREE en
// base, jamais seulement l ecran.
//
//   [S1] LES DOUZE COMMANDES DU COMPTOIR ET LA TACHE CLAVIER, jouees comme au comptoir,
//        chacune dans le budget de gestes du banc (58 pour les douze) ; le dossier cree
//        dit la commande (jour, joueurs, activite, heure, pistes, nom, paiement, prix).
//   [S2] LA REGLE DES TOUCHERS. Un toucher sur une heure choisit l activite et l heure
//        d un coup. Un doigt pose, rien ne bouge : un repeint qui arrive pendant l appui
//        attend le relachement, le toucher n est jamais perdu.
//   [S3] LE REFUS PROPOSE L HEURE QUI TIENT. Le planning refuse : une fois, en rouge,
//        sur la ligne du ticket ; rien ne part ; « Prendre 17:00 » corrige d un toucher,
//        puis le dossier nait a cette heure.
//   [S4] LE SUR MESURE LIT LE CATALOGUE DU CENTRE, celui que le serveur accepte
//        (chargerCatalogueSurMesure) : un toucher ajoute, un autre en ajoute un de plus,
//        l heure de service se pose, la croix d une ligne la retire, le dossier porte ses
//        lignes (articleId, quantite, prix unitaire, heure). Catalogue vide : le niveau
//        catalogue le dit sans rien proposer, le niveau libre garde les suggestions, qui
//        partent sans articleId.
//   [S5] UN PRIX ARRANGE DEMANDE SA RAISON avant d envoyer, et le serveur l ecrit dans
//        la note du dossier.
//   [S6] LES NIVEAUX. Un role catalogue : le catalogue, pas de prix, pas de « Créer
//        quand même », pas d « Adapter », rien a ajouter a une formule ; la croix de la
//        formule rend la carte, ou un toucher ajoute de nouveau. Un role sans prix
//        ni sur mesure : ni champ de prix ni porte. Un role a 20 % : le plafond
//        s annonce avant le refus, a la baisse comme a la hausse, et ce qui passe a
//        l ecran passe au serveur.
//   [S7] AU DOIGT, TELEPHONE ET TABLETTE : rien ne deborde, rien sous 12 px, contraste
//        4,5:1, cibles de 44 px, et une commande s y cree.
//   [S8] CREER REND LA MAIN TOUT DE SUITE : la fenetre se ferme, la console se repeint
//        apres la frame qui ferme (rsApresLaFrame), jamais dans le meme geste.
//   [S9] PLUSIEURS ACTIVITES D UN TOUCHER (2026-11-03, Movsar : « la jpeux appuyer direct
//        sur plusieurs activités »). Chaque tuile dit le prix du serveur, « sur place »
//        quand il n a pas de tarif ; trois touchers sur trois tuiles donnent trois
//        activites au ticket, chacune son heure et son prix, et le total du serveur ; un
//        deuxieme toucher retire, la croix d une ligne aussi, la derniere reste (sans
//        croix, sa tuile ouvre sa page) ; une seance d une activite pas encore prise
//        l ajoute a son heure, une autre seance la deplace, la meme la retire ; ce qui est
//        pris est coche ; une formule s adapte d un toucher quand le role le peut (le role
//        qui ne le peut pas : [S6]). Le dossier cree le dit.
//   [*]  Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois
// (en memoire, le disque n est jamais touche), et exige que chacune rougisse sa cible ;
// `--contre-preuves=nom,nom` en joue quelques-unes ; `--ancres` verifie que chaque
// ancre existe une seule fois. `--seul=S3` ne joue qu une lettre, `--bloc=T6` qu un de
// ses blocs. Les mutations se jouent dans un pool de fils (PINLANE_ECLATS).
//
// Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const path = require('path');
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
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_SEANCES_PORT || 4931);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.SEANCES_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const joue = (bloc) => { const voulu = argument('bloc'); return typeof voulu !== 'string' || voulu === bloc; };

const APP = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const FEN = 'lib/reserver-fenetre.js';

// LA MUTATION : le code casse expres, une regle a la fois. `lettre` dit quel scenario
// la juge, `bloc` le seul bloc a rejouer, `cible` le debut du libelle qui doit rougir.
const MUTATIONS = [
  { nom: 'seances-cachees', lettre: 'S1', bloc: 'T6', cible: '[S1] T6 tient en 5 gestes', fichier: APP, de: 'const RS_SEANCES = 6;', vers: 'const RS_SEANCES = 2;' },
  { nom: 'premiere-touche-perdue', lettre: 'S1', bloc: 'TC', cible: '[S1] TC', fichier: APP, de: "  champ.value = caractere;\n  zone.hidden = false;", vers: "  champ.value = '';\n  zone.hidden = false;" },
  { nom: 'heure-sans-activite', lettre: 'S2', bloc: 'heure', cible: '[S2] un toucher sur une heure choisit l activite et l heure', fichier: APP, de: '    if (!pris) rsPrendre(id, variante);\n', vers: '' },
  { nom: 'doigt-oublie', lettre: 'S2', bloc: 'doigt', cible: '[S2] un doigt pose, rien ne bouge', fichier: APP, de: "  if (rsAppui) { rsRepeintRetenu = true; return; }\n  const overlay = document.getElementById('quickBookOverlay');", vers: "  const overlay = document.getElementById('quickBookOverlay');" },
  { nom: 'refus-sans-proche', lettre: 'S3', cible: '[S3] Créer propose « Prendre » l heure qui tient', fichier: APP, de: "  const proche = refuse && !s.forcer && !lot ? rsHeureProche() : '';", vers: "  const proche = '';" },
  { nom: 'proche-ignoree', lettre: 'S3', cible: '[S3] « Prendre » prend l heure qui tient d un toucher', fichier: APP, de: '    if (rsHeureProche()) rsPrendreProche();', vers: '    if (false) rsPrendreProche();' },
  { nom: 'catalogue-ignore', lettre: 'S4', bloc: 'catalogue', cible: '[S4] la page Sur mesure montre le catalogue du centre', fichier: APP, de: '  const brut = lu.centre === centre && Array.isArray(lu.articles) ? lu.articles : [];', vers: '  const brut = [];' },
  { nom: 'suggestions-au-catalogue', lettre: 'S4', bloc: 'vide', cible: '[S4] catalogue vide au niveau catalogue', fichier: APP, de: "  if (rsNiveau('surmesure') !== 'libre') return { categories: [], articles: [] };\n", vers: '' },
  { nom: 'suggestion-avec-id', lettre: 'S4', bloc: 'libre', cible: '[S4] une suggestion part sans articleId', fichier: APP, de: "articleId: a.suggestion ? '' : id,", vers: 'articleId: id,' },
  { nom: 'raison-facultative', lettre: 'S5', cible: '[S5] sans raison, Créer ne part pas', fichier: APP, de: "  return rsRaisonPrix() ? '' : 'raison';", vers: "  return '';" },
  { nom: 'raison-oubliee-au-serveur', lettre: 'S5', cible: '[S5] la raison part avec le prix', serveur: true, fichier: FEN, de: "      ? { ...final, notes: require('./database').notesAvecPrix(final.notes, droits.notePrix) }", vers: '      ? final' },
  { nom: 'niveau-ignore', lettre: 'S6', bloc: 'sans-prix', cible: '[S6] sans prix, pas de champ de prix', fichier: APP, de: '  return String(niveauStaff(cle));', vers: "  return cle === 'prix' ? 'libre' : String(niveauStaff(cle));" },
  { nom: 'plafond-sans-hausse', lettre: 'S6', bloc: 'vingt', cible: '[S6] 20 % : au-dessus du plafond aussi', fichier: APP, de: '  if (bornes && (bornes.reference <= 0 || prix < bornes.bas || prix > bornes.haut)) return \'plafond\';', vers: '  if (bornes && (bornes.reference <= 0 || prix < bornes.bas)) return \'plafond\';' },
  { nom: 'forcer-pour-tous', lettre: 'S6', bloc: 'catalogue', cible: '[S6] role catalogue : pas de « Créer quand même »', fichier: APP, de: "  const forcer = refuse && !lot && rsNiveau('forcer') === 'oui' ?", vers: '  const forcer = refuse && !lot ?' },
  { nom: 'adapter-pour-tous', lettre: 'S6', bloc: 'catalogue', cible: '[S6] role catalogue : pas d « Adapter »', fichier: APP, de: "  if (rsNiveau('formule') === 'oui') {\n    gestes.push(", vers: '  if (true) {\n    gestes.push(' },
  { nom: 'porte-pour-tous', lettre: 'S6', bloc: 'sans-prix', cible: '[S6] sans sur mesure, pas de porte', fichier: APP, de: "  const mesure = rsNiveau('surmesure') === 'non' ? '' :", vers: "  const mesure = false ? '' :" },
  { nom: 'deborde-telephone', lettre: 'S7', bloc: 'telephone', cible: '[S7] rien ne deborde (telephone', fichier: CSS, de: '.qb-modal.rv.rs .rs-tk-creer { width: auto; min-width: 148px;', vers: '.qb-modal.rv.rs .rs-tk-creer { width: auto; min-width: 400px;' },
  { nom: 'deborde-tablette', lettre: 'S7', bloc: 'tablette', cible: '[S7] rien ne deborde (tablette', fichier: CSS, de: '.qb-modal.rv.rs .rs-ns { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }', vers: '.qb-modal.rv.rs .rs-ns { display: grid; grid-template-columns: repeat(14, 64px); gap: 4px; }' },
  { nom: 'police-11', lettre: 'S7', bloc: 'tablette', cible: '[S7] rien sous 12 px (tablette', fichier: CSS, de: '.qb-modal.rv.rs .rs-h small { font-size: 12px;', vers: '.qb-modal.rv.rs .rs-h small { font-size: 11px;' },
  { nom: 'cible-36', lettre: 'S7', bloc: 'telephone', cible: '[S7] cibles de 44 px au doigt (telephone', fichier: CSS, de: '.qb-modal.rv.rs .rs-n { flex: 1 1 0; min-width: 0; height: 44px;', vers: '.qb-modal.rv.rs .rs-n { flex: 1 1 0; min-width: 0; height: 36px;' },
  { nom: 'rendu-immediat', lettre: 'S8', cible: '[S8] la console ne se repeint pas dans le geste de Créer', fichier: APP, de: '    if (rvResas === lotSauve) { closeQuickBook(); rsApresLaFrame(renderStaff); } else renderStaff();', vers: '    if (rvResas === lotSauve) closeQuickBook();\n    renderStaff();' },
  // [S9] et la formule du role catalogue ([S6]) : chaque toucher ajoute, retire, deplace.
  { nom: 'formule-pour-tous', lettre: 'S6', bloc: 'catalogue', cible: '[S6] role catalogue : un toucher n adapte pas la formule', fichier: APP, de: "  if (s.type !== 'formule' || s.adaptee || rsNiveau('formule') === 'oui') return true;", vers: '  return true;' },
  { nom: 'formule-jamais', lettre: 'S9', bloc: 'formule', cible: '[S9] direction : une activite touchee adapte la formule', fichier: APP, de: "  if (s.type !== 'formule' || s.adaptee || rsNiveau('formule') === 'oui') return true;", vers: "  if (s.type !== 'formule' || s.adaptee) return true;" },
  { nom: 'tuile-remplace', lettre: 'S9', bloc: 'tuiles', cible: '[S9] trois touchers sur trois tuiles', fichier: APP, de: '    if (ids.includes(id)) rsEnlever(id);\n    else rsPrendre(id);', vers: '    if (ids.includes(id)) rsEnlever(id);\n    else rsRemplacer(id);' },
  { nom: 'tuile-reste', lettre: 'S9', bloc: 'tuiles', cible: '[S9] un deuxieme toucher retire la tuile', fichier: APP, de: '    if (ids.includes(id)) rsEnlever(id);\n', vers: '    if (ids.includes(id)) return;\n' },
  { nom: 'prix-invente', lettre: 'S9', bloc: 'tuiles', cible: '[S9] chaque tuile dit le prix du serveur', fichier: APP, de: "rsPrixTuilesMemo.prix.set(id, serveur === undefined ? rsPrixTouche(id) : serveur == null ? 'sur place' : rsEuros(serveur));", vers: 'rsPrixTuilesMemo.prix.set(id, rsPrixTouche(id));' },
  { nom: 'ligne-prix-invente', lettre: 'S9', bloc: 'tuiles', cible: '[S9] chaque ligne du ticket dit le prix du serveur', fichier: APP, de: "  if (ligne || rsTarifInconnu(id)) return 'sur place';\n", vers: '' },
  { nom: 'total-invente', lettre: 'S9', bloc: 'tuiles', cible: '[S9] le total suit chaque toucher', fichier: APP, de: '  const complet = plan.lignesPrix.every((l) => !l || l.prix != null);\n  return { total: Math.round((Number(plan.prix) || 0) * 100) / 100, complet };', vers: '  let total = Number(plan.prix) || 0;\n  plan.lignesPrix.forEach((l) => { if (l && l.prix == null && rvActivites().includes(l.activite)) total += Number(rsMontantLigne(l.activite)) || 0; });\n  return { total: Math.round(total * 100) / 100, complet: true };' },
  { nom: 'heure-hors-tuile', lettre: 'S9', bloc: 'tuiles', cible: '[S9] une tuile prise dit son heure du ticket', fichier: APP, de: "    mot = telle ? 'dans la formule' : e && e.h ? e.h : e || ligne.index > 0 ? 'accès libre' : ligne.heure || '';", vers: '    mot = rsPrixTuile(id);' },
  { nom: 'coche-absente', lettre: 'S9', bloc: 'tuiles', cible: '[S9] ce qui est pris est coche', fichier: CSS, de: '.qb-modal.rv.rs .is-on > .rs-coche { opacity: 1; transform: none; }', vers: '' },
  { nom: 'croix-absente', lettre: 'S9', bloc: 'tuiles', cible: '[S9] chaque ligne se retire d une croix', fichier: APP, de: "retirer: retirable ? 'rsRetirer(this.dataset.activite)' : ''", vers: "retirer: ''" },
  { nom: 'derniere-croix', lettre: 'S9', bloc: 'tuiles', cible: '[S9] la derniere activite reste', fichier: APP, de: '  const retirable = ids.length > 1;', vers: '  const retirable = true;' },
  { nom: 'derniere-tuile-muette', lettre: 'S9', bloc: 'tuiles', cible: '[S9] la derniere activite reste', fichier: APP, de: '  if (ids.length === 1 && ids[0] === id && rvModifiable()) { rsOuvrirLigne(id); return; }\n', vers: '' },
  { nom: 'seance-remplace', lettre: 'S9', bloc: 'seances', cible: '[S9] une seance d une activite pas encore prise l ajoute a cette heure', fichier: APP, de: '    if (!pris) rsPrendre(id, variante);\n', vers: '    if (!pris) rsRemplacer(id, variante);\n' },
  { nom: 'seance-retire-au-lieu-de-deplacer', lettre: 'S9', bloc: 'seances', cible: '[S9] une autre seance d une activite prise deplace son heure', fichier: APP, de: "    if (pris && heure === courante && b.q === 'activites') {", vers: "    if (pris && b.q === 'activites') {" },
  { nom: 'seance-reste', lettre: 'S9', bloc: 'seances', cible: '[S9] la meme seance touchee deux fois retire l activite', fichier: APP, de: '      if (ids.length > 1 && rsPeutChanger()) rsEnlever(id);', vers: '      if (false) rsEnlever(id);' },
  { nom: 'proposition-cochee', lettre: 'S9', bloc: 'seances', cible: '[S9] le bowling propose n est pas coche, choisi il l est', fichier: APP, de: '  const propose = pris && !rsCochee(id);', vers: '  const propose = false;' },
  // Les croix du ticket hors activites : la formule ([S6], la sortie du role qui ne peut
  // pas l adapter) et les articles du sur mesure ([S4]).
  { nom: 'formule-sans-croix', lettre: 'S6', bloc: 'catalogue', cible: '[S6] role catalogue : la croix de la formule rend la carte', fichier: APP, de: "retirer: 'rsSansFormule()'", vers: "retirer: ''" },
  { nom: 'croix-garde-la-formule', lettre: 'S6', bloc: 'catalogue', cible: '[S6] role catalogue : la croix de la formule rend la carte', fichier: APP, de: '      Object.assign(s, JSON.parse(JSON.stringify(avant)));\n', vers: '' },
  { nom: 'article-sans-croix', lettre: 'S4', bloc: 'catalogue', cible: '[S4] la croix d un article le retire du ticket', fichier: APP, de: "retirer: 'rsRetirerExtra(this.dataset.ligne)'", vers: "retirer: ''" },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

// LE JOUR DU SERVEUR : celui de la fixture, a son heure, quel que soit le jour ou le
// gate tourne (getBusinessNowParts, la seule lecture de l heure du metier).
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
if (CASSE && !mutation) { console.error(`reserver-seances-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
function verifierAncre(m) {
  return lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
}
if (mutation && verifierAncre(mutation) !== 1) {
  console.error(`reserver-seances-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// LE MONTAGE
// ---------------------------------------------------------------------------
FX.APPAREILS.comptoir = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
const JOUR = '2027-01-16';
const HEURE = '15:10';

// « Payé » et « Arrivé » ecrits par setReservationStatus (lib/database.js), comme au banc.
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryAvant = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s === 'update reservations set status = $2, payment_method = $3, updated_at = now() where id = $1 returning *;') {
    const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
    const avant = (tx && tx.reservations.get(Number(params[0]))) || B.base.reservations.get(Number(params[0]));
    if (!avant) return { rows: [], rowCount: 0 };
    const precedent = avant.updated_at ? new Date(avant.updated_at).getTime() : 0;
    const row = { ...avant, status: params[1], payment_method: params[2] || null, updated_at: new Date(Math.max(Date.now(), precedent + 1)) };
    if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
    return { rows: [JSON.parse(JSON.stringify(row), (k, v) => (['created_at', 'updated_at', 'paid_at', 'absent_at'].includes(k) && v ? new Date(v) : v))], rowCount: 1 };
  }
  return queryAvant.call(this, sql, params);
};

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

// LES ROLES, les memes droits a l ecran (state.staffAuthSession) et au serveur.
// Le catalogue : le preset Staff bar (sur mesure au catalogue, prix, formule et forcer
// non). Sans prix : un manager sans prix ni sur mesure. A 20 % : le manager livre.
function roleDe(nom) {
  if (nom === 'catalogue') return B.sessionDuRole('staff-bar', { nom: 'Accueil' });
  const s = B.sessionDuRole(nom === 'direction' ? 'direction' : 'manager', { nom: 'Accueil' });
  if (nom === 'sans-prix') s.permissions = [...s.permissions.filter((p) => !/^niveau:(prix|surmesure):/.test(p)), 'niveau:prix:non', 'niveau:surmesure:non'];
  return s;
}

// LE CATALOGUE DU CENTRE : celui que le serveur rend a la console (api/ops
// ?action=surMesureCatalogue) et juge au niveau catalogue, lu par la vraie fonction.
const { catalogueSurMesure, surMesureChoisissable } = require(path.join(ROOT, 'lib/center-config.js'));
const CATALOGUE_LIBRAMONT = surMesureChoisissable(catalogueSurMesure('libramont'));
const CATALOGUE_VIDE = { categories: [], articles: [] };

function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

const serveur = B.monter({
  mutations: [HORLOGE_SERVEUR, ...(mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [])],
  session: roleDe('direction'),
});

async function ouvrirConsole(browser, { role = 'direction', appareil = 'comptoir', theme = 'light', catalogue = CATALOGUE_LIBRAMONT } = {}) {
  const fx = FX.lireFixture('pic');
  globalThis.__comptoirMaintenant = FX.instant(fx.staffState.date, HEURE).getTime();
  B.semer(fx.staffState.reservations.map(ligneDepuis));
  const session = roleDe(role);
  serveur.changerSession(session);
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil, theme, port: PORT, heure: HEURE,
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => { journal.push({ m: 'PATCH', corps }); return serveur.appeler('PATCH', '/api/staff-reservations', corps); });
      await page.exposeFunction('__vraiAppel', async (methode, url, corps) => { journal.push({ m: methode, url, corps }); return serveur.appeler(methode, url, corps); });
      await page.route('**/*fixture=*', async (route) => {
        const r = await route.fetch();
        let b = await r.text();
        // (les noms de la journee, sans leur marque de demonstration)
        b = b.split('DÉMO · ').join('').split('D\\u00c9MO \\u00b7 ').join('').replace(/\[DEMO-JOURS[^"\\]*\]\s*/g, '').replace(/Dossier fictif de d(?:é|\\u00e9)monstration[^"]*/g, '');
        await route.fulfill({ response: r, body: b });
      });
    },
  });
  const { ctx, page, erreurs } = m;
  page.setDefaultTimeout(8000);
  await page.evaluate(({ catalogue, droits }) => {
    window.__catalogue = catalogue;
    // L ecran du role : ses droits, comme sa session les donne a niveauStaff.
    if (droits) state.staffAuthSession = { ...state.staffAuthSession, role: { id: droits.id, name: droits.id, locked: false }, permissions: droits.permissions };
    const avant = window.fetch;
    window.fetch = async (input, init) => {
      init = init || {};
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'surMesureCatalogue') return json({ ok: true, centerId: 'libramont', surMesure: window.__catalogue });
      if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
        const corps = init.body ? JSON.parse(init.body) : undefined;
        const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
        const j = rep.json || {};
        if (me === 'POST' && !(corps && corps.dryRun) && j.reservation) window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(j.reservation);
        return json(j, rep.statut);
      }
      return avant(input, init);
    };
  }, { catalogue, droits: role === 'direction' ? null : { id: session.role.id, permissions: session.permissions } });
  await page.waitForSelector('.gf-r', { timeout: 10000 });
  const avant = new Set([...B.base.reservations.keys()]);
  const finir = async (quoi) => {
    ok(erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  };
  return { ctx, page, erreurs, journal, avant, finir };
}

// ---- Lire l ecran, lire la base -------------------------------------------
const pret = (page) => page.waitForFunction(() => { const b = document.querySelector('#rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 8000 });
const jourPris = (page, iso) => page.waitForFunction((j) => { const k = document.querySelector(`[data-jour="${j}"]`); return k && k.classList.contains('is-on'); }, iso, { timeout: 8000 });
const seanceDe = (id) => `.rs-seance [data-activite="${id}"][data-heure]`;
const texte = (page, sel) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).filter((e) => e.getClientRects().length).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);
const visible = (page, sel) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).some((e) => e.getClientRects().length > 0), sel);
const creations = (journal) => journal.filter((j) => j.m === 'POST' && j.corps && !j.corps.dryRun);
const heureDe = (r) => String(r.start_time || '').slice(0, 5);
const auPlan = (r) => JSON.stringify(r.ops_plan || {}) + JSON.stringify(r.program || {});
const a = (r, mot) => auPlan(r).includes(mot);

// Les dossiers nes depuis l ouverture de la console, attendus un peu : le paiement et
// le second dossier d un lot arrivent apres le premier.
async function nouveaux(page, avant, attendre = (lignes) => lignes.length > 0) {
  let lignes = [];
  for (let i = 0; i < 50; i += 1) {
    lignes = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
    if (attendre(lignes)) break;
    await page.waitForTimeout(100);
  }
  return lignes;
}
const resume = (r) => (r ? { date: r.date, heure: heureDe(r), pax: r.pax, type: r.type, formule: r.formule_id, statut: r.status, moyen: r.payment_method, pistes: r.lanes, duree: r.duration, prix: r.price, nom: r.name, tel: r.phone, email: r.email, extras: r.extras, plan: auPlan(r).slice(0, 160) } : null);

// ---------------------------------------------------------------------------
// [S1] LES DOUZE COMMANDES DU COMPTOIR ET LA TACHE CLAVIER
// ---------------------------------------------------------------------------
// Les commandes du banc (arene-rv), jouees a l ecran comme au comptoir : un toucher, une
// frappe et une touche comptent chacun un geste ; taper tout d un coup dans la barre
// compte pour un geste, comme un nom tape dans un champ.
async function nombre(t, n) {
  await t.clic(`#rsHaut [data-pax="${n}"]`);
  await t.page.waitForSelector(`#rsHaut [data-pax="${n}"].is-on`);
}
async function jour(t, iso) {
  await t.clic(`[data-jour="${iso}"]`);
  await jourPris(t.page, iso);
}
// La consigne dit 19:00 : si le planning l a effacee, on prend l heure libre la plus
// proche, comme au comptoir, et on le dit au client.
async function heureProche(t, id, voulue) {
  await t.page.waitForSelector(`.rs-s-l[data-verifie="1"] [data-activite="${id}"]`);
  const directe = `.rs-s-l [data-activite="${id}"][data-heure="${voulue}"]`;
  if (await t.page.locator(directe).count()) { await t.clic(directe); return; }
  await t.clic(`.rs-h-autres[data-activite="${id}"]`);
  await t.page.waitForSelector('.rs-heures .rs-h');
  const libre = await t.page.evaluate((v) => {
    const minutes = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
    const cles = [...document.querySelectorAll('.rs-heures .rs-h:not(.is-efface)')].map((c) => c.dataset.heure);
    return cles.sort((x, y) => Math.abs(minutes(x) - minutes(v)) - Math.abs(minutes(y) - minutes(v)))[0];
  }, voulue);
  await t.clic(`.rs-heures [data-heure="${libre}"]`);
}
// La premiere touche ouvre la barre, le reste s y tape.
async function barre(t, texteTape) {
  await t.page.keyboard.press(texteTape[0]);
  await t.page.waitForSelector('#rsBarre:visible');
  await t.taper('#rsBarre', texteTape);
}

const TACHES = [
  { id: 'T1', budget: 3, consigne: '6 personnes, une piste de bowling, tout de suite, sans nom',
    jouer: async (t) => { await t.ouvrir(); await nombre(t, 6); await pret(t.page); await t.clic('#rvCreer'); },
    attendu: ([r]) => r.date === JOUR && r.pax === 6 && r.type === 'bowling' && r.status === 'arrived' },
  { id: 'T2', budget: 3, consigne: 'le meme client paie par carte en commandant',
    jouer: async (t) => { await t.ouvrir(); await nombre(t, 6); await pret(t.page); await t.clic('#rvCreerPaye0'); },
    attendu: ([r]) => r.date === JOUR && r.pax === 6 && r.status === 'paid' && /card|carte/i.test(String(r.payment_method)),
    fini: (lignes) => lignes.length > 0 && lignes[0].status === 'paid' },
  { id: 'T3', budget: 3, consigne: 'au telephone : Renard, 8, bowling demain 14:00, 0471 23 45 67',
    jouer: async (t) => { await t.ouvrir(); await barre(t, '8 bowling demain 14h famille renard 0471 23 45 67'); await t.touche('Enter'); },
    attendu: ([r]) => r.date === '2027-01-17' && r.pax === 8 && heureDe(r) === '14:00' && /Renard/i.test(r.name) && String(r.phone).replace(/\D/g, '').includes('471234567') && r.status === 'pending' },
  { id: 'T4', budget: 5, consigne: 'laser pour 12, deux parties, au prochain depart',
    jouer: async (t) => { await t.ouvrir(); await nombre(t, 12); await t.clic('[data-quoi="laser_game"][data-var="2"]'); await t.page.waitForSelector(seanceDe('laser_game')); await t.clic(`${seanceDe('laser_game')} >> nth=0`); await pret(t.page); await t.clic('#rvCreer'); },
    attendu: ([r]) => r.date === JOUR && r.pax === 12 && a(r, 'laser') && heureDe(r) >= '15:30' },
  { id: 'T5', budget: 3, consigne: 'anniversaire, formule F3, 10 enfants, samedi 23 a 14:00, Lea',
    jouer: async (t) => { await t.ouvrir(); await barre(t, '10 f3 sam 14h Léa'); await t.touche('Enter'); },
    attendu: ([r]) => r.date === '2027-01-23' && r.pax === 10 && r.formule_id && heureDe(r) === '14:00' && /L[eé]a/i.test(r.name) },
  // (chaque toucher ajoute : le laser touche apres le bowling s y ajoute, a la suite)
  { id: 'T6', budget: 5, consigne: 'bowling puis laser pour 8, aujourd hui a 18:00',
    jouer: async (t) => {
      await t.ouvrir(); await nombre(t, 8); await heureProche(t, 'bowling', '18:00');
      await t.page.waitForSelector('.rs-s-l[data-verifie="1"] [data-activite="laser_game"]');
      await t.clic(`${seanceDe('laser_game')} >> nth=0`); await t.page.waitForSelector('#rsL-a-laser_game');
      await pret(t.page); await t.clic('#rvCreer');
    },
    attendu: ([r]) => r.date === JOUR && r.pax === 8 && a(r, 'bowling') && a(r, 'laser') },
  { id: 'T7', budget: 6, consigne: 'groupe de 20 au bowling, 1 h 30, a 19:00',
    jouer: async (t) => { await t.ouvrir(); await nombre(t, 20); await t.clic('[data-quoi="bowling"][data-var="1.5"]'); await heureProche(t, 'bowling', '19:00'); await pret(t.page); await t.clic('#rvCreer'); },
    attendu: ([r]) => r.date === JOUR && r.pax === 20 && (r.lanes || []).length >= 3 && Number(r.duration) === 1.5 },
  { id: 'T8', budget: 8, consigne: 'quatre personnes, la piste 8, demain a 17:00',
    jouer: async (t) => {
      await t.ouvrir(); await nombre(t, 4); await jour(t, '2027-01-17'); await heureProche(t, 'bowling', '17:00');
      await t.clic('#rsL-a-bowling'); await t.page.waitForSelector('[data-piste="8"]'); await t.clic('[data-piste="8"]');
      await t.page.waitForSelector('[data-piste="8"].is-on'); await pret(t.page); await t.clic('#rvCreer');
    },
    attendu: ([r]) => r.date === '2027-01-17' && r.pax === 4 && JSON.stringify((r.lanes || []).map(Number)) === '[8]' && heureDe(r) === '17:00' },
  { id: 'T9', budget: 5, consigne: 'Noel, 5, bowling demain 11:00, e-mail et note pour l equipe',
    jouer: async (t) => {
      await t.ouvrir(); await barre(t, '5 bowling demain 11h famille noel noel@exemple.be');
      await t.clic('#rsL-client'); await t.page.waitForSelector('#qbNotes'); await t.taper('#qbNotes', 'gâteau à 12 h');
      await pret(t.page); await t.clic('#rvCreer');
    },
    attendu: ([r]) => r.date === '2027-01-17' && r.pax === 5 && /noel@exemple\.be/i.test(r.email) && /g[aâ]teau/i.test(r.notes) },
  { id: 'T10', budget: 5, consigne: 'deux reservations d un coup pour le meme client, demain',
    jouer: async (t) => {
      await t.ouvrir(); await barre(t, '4 bowling demain 16h'); await t.clic('#rvEncore');
      await t.page.waitForSelector('.rv-resa:nth-child(2)'); await barre(t, '6 laser demain 16h30'); await t.touche('Enter');
    },
    attendu: (rs) => rs.length >= 2 && rs.some((r) => r.pax === 4 && a(r, 'bowling')) && rs.some((r) => r.pax === 6 && a(r, 'laser')) && rs.every((r) => r.date === '2027-01-17'),
    fini: (lignes) => lignes.length >= 2 },
  { id: 'T11', budget: 6, consigne: '6, bowling demain 15:00, le gerant fait 30 euros',
    jouer: async (t) => {
      await t.ouvrir(); await barre(t, '6 bowling demain 15h'); await t.clic('#rsL-total');
      await t.page.waitForSelector('#qbCustomPrice'); await t.taper('#qbCustomPrice', '30'); await t.clic('#rsRaison-0'); await t.clic('#rvCreer');
    },
    attendu: ([r]) => r.date === '2027-01-17' && r.pax === 6 && Number(r.price) === 30 },
  // (la tuile ajoute sans quitter les activites : son heure se regle sur sa ligne du ticket)
  { id: 'T12', budget: 6, consigne: 'minigolf seul pour 5, aujourd hui a 16:00',
    jouer: async (t) => { await t.ouvrir(); await nombre(t, 5); await t.clic('#rsT-minigolf_blacklight'); await t.page.waitForSelector('#rsL-a-minigolf_blacklight'); await t.clic('#rsL-a-minigolf_blacklight'); await t.page.waitForSelector('[data-heure-l="16:00"]'); await t.clic('[data-heure-l="16:00"]'); await pret(t.page); await t.clic('#rvCreer'); },
    attendu: ([r]) => r.date === JOUR && r.pax === 5 && a(r, 'minigolf') },
  // LA TACHE CLAVIER : rien que le clavier une fois la fenetre ouverte. La premiere touche
  // ouvre la barre sans se perdre, Entree cree.
  { id: 'TC', budget: 3, consigne: 'au clavier : 8 laser 17h dupont, Entree',
    jouer: async (t) => {
      await t.ouvrir(); await t.page.waitForSelector('#rsHaut [data-pax]');
      t.compte.gestes += 1; t.compte.frappes += 18; await t.page.keyboard.type('8 laser 17h dupont', { delay: 25 });
      await t.page.waitForFunction(() => /Laser/.test(document.querySelector('#rsLignes').textContent));
      await t.touche('Enter');
    },
    attendu: ([r]) => r.date === JOUR && r.pax === 8 && a(r, 'laser') && a(r, '17:00') && /^dupont$/i.test(r.name) },
];
const BUDGET_DOUZE = 58;

async function scenarioS1(browser) {
  console.log('\n[S1] les douze commandes du comptoir et la tache clavier');
  let total = 0;
  let toutes = true;
  for (const tache of TACHES) {
    if (!joue(tache.id)) continue;
    const m = await ouvrirConsole(browser);
    const { page } = m;
    const compte = { gestes: 0, frappes: 0 };
    const loc = (cible) => (typeof cible === 'string' ? page.locator(cible).first() : cible);
    const t = {
      page, compte,
      ouvrir: async () => { compte.gestes += 1; await page.locator('.btn-new').click(); },
      clic: async (cible) => { compte.gestes += 1; await loc(cible).click(); },
      taper: async (cible, x) => { compte.gestes += 1; compte.frappes += String(x).length; await loc(cible).fill(String(x)); },
      touche: async (nom) => { compte.gestes += 1; await page.keyboard.press(nom); },
    };
    let erreur = '';
    try { await tache.jouer(t); } catch (e) { erreur = String(e.message || e).split('\n')[0].slice(0, 200); }
    const lignes = erreur ? [] : await nouveaux(page, m.avant, tache.fini);
    let bon = false;
    if (!erreur && lignes.length) { try { bon = Boolean(tache.attendu(lignes)); } catch (e) { erreur = e.message; } }
    ok(bon, `[S1] ${tache.id} ${tache.consigne} : le dossier cree le dit`, erreur || (lignes.length ? lignes.map(resume) : 'aucun dossier cree'));
    ok(bon && compte.gestes <= tache.budget, `[S1] ${tache.id} tient en ${tache.budget} gestes`, { gestes: compte.gestes, frappes: compte.frappes });
    if (tache.id !== 'TC') { total += compte.gestes; toutes = toutes && bon; }
    await m.finir(tache.id);
  }
  if (TACHES.filter((x) => x.id !== 'TC').every((x) => joue(x.id))) {
    ok(toutes && total <= BUDGET_DOUZE, `[S1] les douze commandes en ${BUDGET_DOUZE} gestes au plus (94 avec l ancienne fenetre)`, { total });
  }
}

// ---------------------------------------------------------------------------
// [S2] LA REGLE DES TOUCHERS
// ---------------------------------------------------------------------------
async function scenarioS2(browser) {
  console.log('\n[S2] la regle des touchers');
  if (joue('heure')) {
    const m = await ouvrirConsole(browser);
    const { page } = m;
    await page.locator('.btn-new').click();
    await page.locator('#rsHaut [data-pax="6"]').click();
    await pret(page);
    const avant = await visible(page, '#rsL-a-bowling');
    await page.waitForSelector(`.rs-s-l[data-verifie="1"] ${seanceDe('laser_game').replace('.rs-seance ', '')}`);
    const cle = page.locator(seanceDe('laser_game')).nth(1);
    const heure = await cle.getAttribute('data-heure');
    await cle.click();
    await page.waitForSelector('#rsL-a-laser_game', { timeout: 4000 }).catch(() => {});
    const apres = await page.evaluate(() => ({
      laser: Boolean(document.querySelector('#rsL-a-laser_game')),
      bowling: Boolean(document.querySelector('#rsL-a-bowling')),
      choisie: (document.querySelector('#rvHeure-laser_game') || {}).dataset ? document.querySelector('#rvHeure-laser_game').dataset.heure : '',
      ligne: (document.querySelector('#rsL-a-laser_game') || {}).textContent || '',
    }));
    ok(avant && apres.laser && !apres.bowling && apres.choisie === heure && apres.ligne.includes(heure), '[S2] un toucher sur une heure choisit l activite et l heure, au ticket', { heure, ...apres });
    await pret(page).catch(() => {});
    await page.locator('#rvCreer').click();
    const [r] = await nouveaux(page, m.avant);
    ok(Boolean(r) && a(r, 'laser') && !a(r, 'bowling') && a(r, heure), '[S2] un toucher sur une heure choisit l activite et l heure, au dossier', resume(r));
    await m.finir('S2 heure');
  }
  if (joue('doigt')) {
    const m = await ouvrirConsole(browser);
    const { page } = m;
    await page.locator('.btn-new').click();
    await page.locator('#rsHaut [data-pax="6"]').click();
    await pret(page);
    await page.waitForSelector('.rs-s-l[data-verifie="1"] [data-activite="bowling"]');
    // Une heure qui n est pas celle du ticket : l appui, un repeint qui refait la page
    // (le plan du serveur qui arrive), puis le relachement.
    const cible = page.locator('#rsZ-bowling .rs-h[data-heure]:not(.is-on)').nth(1);
    const heure = await cible.getAttribute('data-heure');
    const boite = await cible.boundingBox();
    await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
    await page.mouse.down();
    const pendant = await page.evaluate(() => { rsPagePeinte = ''; rvRepeindre(); return { retenu: rsRepeintRetenu, appui: rsAppui }; });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const choisie = await page.evaluate(() => (document.querySelector('#rvHeure-bowling') ? document.querySelector('#rvHeure-bowling').dataset.heure : ''));
    ok(pendant.appui === true, '[S2] le repeint arrive bien pendant l appui (prerequis)', pendant);
    ok(choisie === heure, '[S2] un doigt pose, rien ne bouge : le toucher n est pas perdu', { voulue: heure, choisie, pendant });
    await m.finir('S2 doigt');
  }
}

// ---------------------------------------------------------------------------
// [S3] LE REFUS PROPOSE L HEURE QUI TIENT
// ---------------------------------------------------------------------------
// 20 joueurs au bowling a 16:00, un samedi plein : le planning refuse. La commande se
// pose en sortant de la barre (Entree, lui, creerait tout de suite).
async function refuser(page) {
  await page.keyboard.press('2');
  await page.locator('#rsBarre').fill('20 bowling 16h');
  await page.locator('#rsCol').click({ position: { x: 4, y: 4 } });
}

async function scenarioS3(browser) {
  console.log('\n[S3] le refus propose l heure qui tient');
  const m = await ouvrirConsole(browser);
  const { page, journal } = m;
  await page.locator('.btn-new').click();
  await page.waitForSelector('#rsHaut [data-pax]');
  await refuser(page);
  let proche = '';
  try {
    await page.waitForFunction(() => /^Prendre \d\d:\d\d/.test(document.querySelector('#rvCreer').textContent.trim()), null, { timeout: 8000 });
    proche = await page.locator('#rvCreer').getAttribute('data-proche');
  } catch (e) { /* le libelle ne vient pas : dit plus bas */ }
  const ecran = await page.evaluate(() => ({
    creer: document.querySelector('#rvCreer').textContent.replace(/\s+/g, ' ').trim(),
    rouges: [...document.querySelectorAll('#quickBookOverlay .rs-v-ligne.is-ko, #quickBookOverlay small.is-ko')].filter((e) => e.getClientRects().length && e.textContent.trim()).map((e) => `${e.closest('#rsLignes') ? 'ligne' : 'ailleurs'}: ${e.textContent.trim()}`),
  }));
  ok(/^\d\d:\d\d$/.test(proche || '') && ecran.creer.startsWith(`Prendre ${proche}`), '[S3] Créer propose « Prendre » l heure qui tient', ecran);
  ok(ecran.rouges.length === 1 && ecran.rouges[0].startsWith('ligne:'), '[S3] le refus se dit une fois, en rouge sur sa ligne du ticket', ecran.rouges);
  ok(creations(journal).length === 0 && (await nouveaux(page, m.avant, () => false)).length === 0, '[S3] rien ne part pendant le refus', creations(journal).length);
  if (proche) {
    await page.locator('#rvCreer').click();
    let pris = false;
    try {
      await page.waitForFunction((h) => { const b = document.querySelector('#rvCreer'); return b.dataset.pret === '1' && b.textContent.trim().startsWith(`Créer à ${h}`); }, proche, { timeout: 8000 });
      pris = true;
    } catch (e) { /* dit ci-dessous */ }
    ok(pris && creations(journal).length === 0, '[S3] « Prendre » prend l heure qui tient d un toucher, sans rien creer', await texte(page, '#rvCreer'));
    if (pris) {
      await page.locator('#rvCreer').click();
      const [r] = await nouveaux(page, m.avant);
      ok(Boolean(r) && r.pax === 20 && a(r, 'bowling') && heureDe(r) === proche, '[S3] le dossier nait a l heure proposee', { proche, dossier: resume(r) });
    }
  }
  await m.finir('S3');
}

// ---------------------------------------------------------------------------
// [S4] LE SUR MESURE LIT LE CATALOGUE DU CENTRE
// ---------------------------------------------------------------------------
async function ouvrirSurMesure(page, pax = 6) {
  await page.locator('.btn-new').click();
  await page.locator(`#rsHaut [data-pax="${pax}"]`).click();
  await pret(page);
  await page.locator('#rsMesure').click();
  await page.waitForSelector('.is-q-mesure');
}

async function scenarioS4(browser) {
  console.log('\n[S4] le sur mesure lit le catalogue du centre');
  if (joue('catalogue')) {
    // Le role catalogue : le serveur n accepte que les articles du centre.
    const m = await ouvrirConsole(browser, { role: 'catalogue' });
    const { page } = m;
    await ouvrirSurMesure(page);
    await page.waitForSelector('.rs-arts', { timeout: 8000 }).catch(() => {});
    const attendus = CATALOGUE_LIBRAMONT.categories.filter((c) => CATALOGUE_LIBRAMONT.articles.some((x) => x.categorie === c.id)).map((c) => c.nom);
    const onglets = await page.evaluate(() => [...document.querySelectorAll('[data-onglet]')].map((b) => b.textContent.trim()));
    const boisson = CATALOGUE_LIBRAMONT.articles.find((x) => x.categorie === 'boissons');
    const plat = CATALOGUE_LIBRAMONT.articles.find((x) => x.categorie === 'nourriture' && x.heure);
    ok(JSON.stringify(onglets) === JSON.stringify(attendus) && await visible(page, `#rsArt-${plat.id}`), '[S4] la page Sur mesure montre le catalogue du centre', { onglets, attendus });
    ok(!(await visible(page, '#rsLibreNom')) && !onglets.includes('Arcades'), '[S4] au niveau catalogue, ni article libre ni arcades a la main', onglets);
    let service = '';
    try {
      await page.locator('[data-onglet="boissons"]').click();
      await page.locator(`#rsArt-${boisson.id}`).click();
      await page.waitForSelector(`[id^="rsL-x-${boisson.id}-"]`, { state: 'attached' });
      await page.locator(`#rsArt-${boisson.id}`).click();
      await page.locator('[data-onglet="nourriture"]').click();
      await page.locator(`#rsArt-${plat.id}`).click();
      await page.waitForSelector('.rs-bande [data-service]');
      service = await page.locator('.rs-bande [data-service]').nth(1).getAttribute('data-service');
      await page.locator('.rs-bande [data-service]').nth(1).click();
      await page.waitForSelector('.rs-bande [data-service].is-on');
    } catch (e) { console.log(`      (geste rate : ${String(e.message).split('\n')[0].slice(0, 120)})`); }
    // Un troisieme article, retire d une croix : il quitte le ticket et le dossier.
    const autre = CATALOGUE_LIBRAMONT.articles.find((x) => x.id !== boisson.id && x.id !== plat.id);
    let pose = false;
    try {
      await page.locator(`[data-onglet="${autre.categorie}"]`).click();
      await page.locator(`#rsArt-${autre.id}`).click();
      await page.waitForSelector(`[id^="rsL-x-${autre.id}-"]`, { state: 'attached', timeout: 3000 });
      pose = true;
      await page.locator(`[id^="rsSuppr-x-${autre.id}-"]`).click({ timeout: 3000 });
      await page.waitForTimeout(300);
    } catch (e) { console.log(`      (geste rate : ${String(e.message).split('\n')[0].slice(0, 120)})`); }
    const reste = await texte(page, '#rsLignes');
    ok(pose && !reste.includes(autre.nom) && reste.includes(boisson.nom) && reste.includes(plat.nom), '[S4] la croix d un article le retire du ticket', { pose, reste });
    const ticket = await texte(page, '#rsLignes');
    ok(ticket.includes(boisson.nom) && ticket.includes(plat.nom) && ticket.includes(`à ${service}`), '[S4] chaque article devient une ligne du ticket, l heure de service dite', ticket);
    await pret(page).catch(() => {});
    await page.locator('#rvCreer').click();
    const [r] = await nouveaux(page, m.avant);
    const extras = (r && r.extras) || [];
    const lb = extras.find((x) => x.articleId === boisson.id);
    const lp = extras.find((x) => x.articleId === plat.id);
    ok(Boolean(lb && lb.qte === 2 && Number(lb.prixUnitaire) === boisson.prix && Number(lb.price) === Math.round(boisson.prix * 200) / 100
      && lp && lp.qte === 1 && Number(lp.prixUnitaire) === plat.prix && lp.heure === service && !extras.some((x) => x.articleId === autre.id)), '[S4] le dossier porte ses lignes : article, quantite, prix unitaire, heure de service', { extras, service });
    await m.finir('S4 catalogue');
  }
  if (joue('vide')) {
    const m = await ouvrirConsole(browser, { role: 'catalogue', catalogue: CATALOGUE_VIDE });
    const { page } = m;
    await ouvrirSurMesure(page);
    await page.waitForSelector('#rsCatalogueVide, .rs-arts', { timeout: 8000 }).catch(() => {});
    const ecran = await page.evaluate(() => ({ dit: (document.querySelector('#rsCatalogueVide') || {}).textContent || '', articles: document.querySelectorAll('[id^="rsArt-"]').length }));
    ok(/aucun article/.test(ecran.dit) && ecran.articles === 0, '[S4] catalogue vide au niveau catalogue : la page le dit, rien que le serveur refuserait', ecran);
    await m.finir('S4 vide');
  }
  if (joue('libre')) {
    const m = await ouvrirConsole(browser, { role: 'direction', catalogue: CATALOGUE_VIDE });
    const { page } = m;
    await ouvrirSurMesure(page);
    await page.waitForSelector('.rs-arts', { timeout: 8000 }).catch(() => {});
    const premier = page.locator('.rs-arts [id^="rsArt-"]').first();
    const nom = (await premier.locator('b').textContent().catch(() => '')).trim();
    await premier.click().catch(() => {});
    await page.waitForSelector('[id^="rsL-x-"]', { state: 'attached' }).catch(() => {});
    await pret(page).catch(() => {});
    await page.locator('#rvCreer').click();
    const [r] = await nouveaux(page, m.avant);
    const ligne = ((r && r.extras) || []).find((x) => String(x.name || '').startsWith(nom));
    ok(Boolean(nom) && Boolean(ligne), '[S4] au niveau libre, les suggestions restent sans catalogue', { nom, extras: r && r.extras });
    ok(Boolean(ligne) && !ligne.articleId, '[S4] une suggestion part sans articleId', ligne);
    await m.finir('S4 libre');
  }
}

// ---------------------------------------------------------------------------
// [S5] UN PRIX ARRANGE DEMANDE SA RAISON
// ---------------------------------------------------------------------------
async function ouvrirTotal(page, commande = '6 bowling demain 15h') {
  await page.locator('.btn-new').click();
  await page.waitForSelector('#rsHaut [data-pax]');
  await page.keyboard.press(commande[0]);
  await page.locator('#rsBarre').fill(commande);
  await page.locator('#rsCol').click({ position: { x: 4, y: 4 } });
  await pret(page);
  await page.locator('#rsL-total').click();
  await page.waitForSelector('.is-q-total');
}
const prixTape = async (page, valeur) => { await page.locator('#qbCustomPrice').fill(String(valeur)); await page.waitForTimeout(60); };
const notePrix = (r) => String((r && r.notes) || '').split('\n').map((l) => { try { return JSON.parse(l.replace(/^\[equipe\] /, '')); } catch (e) { return null; } }).find((n) => n && n.type === 'prix') || null;

async function scenarioS5(browser) {
  console.log('\n[S5] un prix arrange demande sa raison');
  const m = await ouvrirConsole(browser);
  const { page, journal } = m;
  await ouvrirTotal(page);
  await prixTape(page, 30);
  const libelle = (await texte(page, '#rvCreer')).trim();
  await page.locator('#rvCreer').click();
  await page.waitForTimeout(300);
  const page2 = await page.evaluate(() => { const modal = document.querySelector('.qb-modal.rv'); return Boolean(modal && modal.classList.contains('is-q-total')); });
  const sansRaison = /^Raison du prix/.test(libelle) && creations(journal).length === 0 && page2;
  ok(sansRaison, '[S5] sans raison, Créer ne part pas et montre le prix', { libelle, creations: creations(journal).length, pageTotal: page2 });
  if (!sansRaison) { await m.finir('S5'); return; }
  const raison = await page.locator('#rsRaison-0').getAttribute('data-raison');
  await page.locator('#rsRaison-0').click();
  await page.waitForFunction(() => /^Créer à 15:00/.test(document.querySelector('#rvCreer').textContent.trim()), null, { timeout: 8000 }).catch(() => {});
  await page.locator('#rvCreer').click();
  const [r] = await nouveaux(page, m.avant);
  const note = notePrix(r);
  ok(Boolean(r) && Number(r.price) === 30 && Boolean(note) && note.prix.a === 30 && note.prix.raison === raison && note.prix.de > 30, '[S5] la raison part avec le prix, le serveur l ecrit dans la note du dossier', { prix: r && r.price, note, raison });
  await m.finir('S5');
}

// ---------------------------------------------------------------------------
// [S6] LES NIVEAUX
// ---------------------------------------------------------------------------
async function formuleF3(page) {
  await page.locator('#rsHaut [data-pax="10"]').click();
  await page.locator('#rsFormules').click();
  await page.locator('[data-jour="2027-01-23"]').click();
  await jourPris(page, '2027-01-23');
  await page.locator('[data-formule="f3"]').click();
  await page.waitForSelector('#rsL-a-formule');
}

async function scenarioS6(browser) {
  console.log('\n[S6] les niveaux');
  if (joue('catalogue')) {
    const m = await ouvrirConsole(browser, { role: 'catalogue' });
    const { page } = m;
    await ouvrirTotal(page);
    ok(await visible(page, '#rsPrixFixe') && !(await visible(page, '#qbCustomPrice')), '[S6] role catalogue : pas de prix arrange, la page le dit');
    await page.keyboard.press('Escape');
    await page.locator('#rsHaut [data-pax]').first().waitFor();
    await formuleF3(page);
    // Un toucher sur une activite hors de la formule l adapterait : ce role ne le peut pas
    // (le serveur refuserait). Rien ne change, le ticket dit pourquoi, la tuile le montre.
    await page.locator('#rsRetour').click();
    await page.waitForSelector('.is-q-activites #rsT-billards');
    await page.locator('#rsT-billards').click();
    await page.waitForTimeout(300);
    const telle = await page.evaluate(() => ({
      ids: rvActivites(),
      formule: ((document.querySelector('#rsL-a-formule .rs-tk-n b') || {}).textContent || '').trim(),
      billard: Boolean(document.querySelector('#rsL-a-billards')),
      dit: ((document.querySelector('#rvVerdict [role="alert"]') || {}).textContent || '').trim(),
      hors: (document.querySelector('#rsT-billards') || { classList: { contains: () => false } }).classList.contains('is-hors'),
    }));
    ok(!telle.billard && !telle.ids.includes('billards') && telle.formule && !/adaptée/.test(telle.formule) && Boolean(telle.dit) && telle.hors, '[S6] role catalogue : un toucher n adapte pas la formule, le ticket dit pourquoi', telle);
    await page.locator('#rsL-a-formule').click();
    await page.waitForSelector('.is-q-ligne');
    ok(!(await visible(page, '#rvAdapter')) && await visible(page, '#rsFormuleMesure'), '[S6] role catalogue : pas d « Adapter », le sur mesure au catalogue');
    // Sa sortie : la croix de la formule rend le ticket a la carte, ou le meme toucher
    // sur le billard ajoute cette fois.
    await page.locator('#rsSuppr-a-formule').click({ timeout: 3000 }).catch(() => {});
    await page.waitForSelector('.is-q-activites #rsT-billards', { timeout: 3000 }).catch(() => {});
    await page.locator('#rsT-billards').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    const carte = await page.evaluate(() => ({
      type: quickBookState.type,
      ids: rvActivites(),
      formule: Boolean(document.querySelector('#rsL-a-formule')),
      billard: Boolean(document.querySelector('#rsL-a-billards')),
      dit: ((document.querySelector('#rvVerdict [role="alert"]') || {}).textContent || '').trim(),
    }));
    ok(carte.type !== 'formule' && !carte.formule && carte.billard && carte.ids.includes('billards') && !/adapter une formule/.test(carte.dit), '[S6] role catalogue : la croix de la formule rend la carte, le toucher ajoute', carte);
    await m.finir('S6 catalogue formule');
    const n = await ouvrirConsole(browser, { role: 'catalogue' });
    await n.page.locator('.btn-new').click();
    await n.page.waitForSelector('#rsHaut [data-pax]');
    await refuser(n.page);
    await n.page.waitForFunction(() => /^Prendre/.test(document.querySelector('#rvCreer').textContent.trim()), null, { timeout: 8000 }).catch(() => {});
    ok(/^Prendre/.test((await texte(n.page, '#rvCreer')).trim()) && !(await visible(n.page, '#rvForcer')), '[S6] role catalogue : pas de « Créer quand même »', await texte(n.page, '#rvPied'));
    await n.finir('S6 catalogue refus');
  }
  if (joue('sans-prix')) {
    const m = await ouvrirConsole(browser, { role: 'sans-prix' });
    const { page, journal } = m;
    await ouvrirTotal(page);
    ok(await visible(page, '#rsPrixFixe') && !(await visible(page, '#qbCustomPrice')), '[S6] sans prix, pas de champ de prix');
    await page.keyboard.press('Escape');
    await page.locator('#rsHaut [data-pax]').first().waitFor();
    ok(!(await visible(page, '#rsMesure')), '[S6] sans sur mesure, pas de porte');
    await formuleF3(page);
    await page.locator('#rsL-a-formule').click();
    await page.waitForSelector('.is-q-ligne');
    ok(await visible(page, '#rvAdapter') && !(await visible(page, '#rsFormuleMesure')), '[S6] sans sur mesure, une formule s adapte sans sur mesure');
    await pret(page);
    await page.locator('#rvCreer').click();
    const [r] = await nouveaux(page, m.avant);
    const corps = (creations(journal)[0] || {}).corps || {};
    ok(Boolean(r) && corps.price === undefined && corps.prixRaison === undefined, '[S6] sans prix, le serveur tarife seul', { prix: r && r.price, envoye: corps.price });
    await m.finir('S6 sans prix');
  }
  if (joue('vingt')) {
    const m = await ouvrirConsole(browser, { role: 'manager' });
    const { page, journal } = m;
    await ouvrirTotal(page);
    const total = await page.evaluate(() => Number(document.querySelector('.rs-total-g').textContent.replace(/[^\d,]/g, '').replace(',', '.')));
    const bas = Math.ceil(total * 80) / 100;
    const haut = Math.floor(total * 120) / 100;
    const euros = (x) => `${x.toFixed(2).replace('.', ',')} €`;
    const annonce = await texte(page, '#rsPlafond');
    ok(annonce.includes('20 %') && annonce.includes(euros(bas)), '[S6] 20 % : le plafond s annonce avant le refus', { annonce, bas: euros(bas) });
    await prixTape(page, Math.floor(bas) - 1);
    const sous = { dit: await texte(page, '#rsPlafond'), creer: (await texte(page, '#rvCreer')).trim() };
    await page.locator('#rvCreer').click();
    await page.waitForTimeout(250);
    ok(sous.dit.startsWith(`En dessous de ${euros(bas)}`) && /^Prix à revoir/.test(sous.creer) && creations(journal).length === 0, '[S6] 20 % : sous le plafond, rien ne part', sous);
    await prixTape(page, Math.ceil(haut) + 1);
    const dessus = { dit: await texte(page, '#rsPlafond'), creer: (await texte(page, '#rvCreer')).trim() };
    ok(dessus.dit.startsWith(`Au-dessus de ${euros(haut)}`) && /^Prix à revoir/.test(dessus.creer), '[S6] 20 % : au-dessus du plafond aussi', dessus);
    const juste = Math.ceil(bas) + 1;
    await prixTape(page, juste);
    await page.locator('#rsRaison-0').click();
    await page.waitForFunction(() => /^Créer à/.test(document.querySelector('#rvCreer').textContent.trim()), null, { timeout: 8000 }).catch(() => {});
    await page.locator('#rvCreer').click();
    const [r] = await nouveaux(page, m.avant);
    ok(Boolean(r) && Number(r.price) === juste, '[S6] 20 % : ce qui passe a l ecran passe au serveur', { juste, dossier: resume(r) });
    await m.finir('S6 vingt');
  }
}

// ---------------------------------------------------------------------------
// [S7] AU DOIGT, TELEPHONE ET TABLETTE
// ---------------------------------------------------------------------------
// Ce que la fenetre montre, mesure dans la page : ce qui deborde (de l ecran, ou une zone
// qui defile en largeur sans l avoir voulu : seuls les onglets du sur mesure, .rs-tabs,
// defilent de cote ; un texte coupe en « … » est voulu), le texte sous 12 px, le
// contraste sous 4,5:1 (la couleur calculee lue au pixel), les cibles sous 44 px.
function controler() {
  const modal = document.querySelector('#quickBookOverlay .qb-modal.rv');
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  const px = (couleur) => { c.clearRect(0, 0, 1, 1); c.fillStyle = couleur; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const fond = (el) => {
    const pile = [];
    for (let n = el; n; n = n.parentElement) { const p = px(getComputedStyle(n).backgroundColor); if (p[3] > 0) { pile.unshift(p); if (p[3] === 1) break; } }
    return pile.reduce((acc, p) => [0, 1, 2].map((i) => acc[i] * (1 - p[3]) + p[i] * p[3]), [255, 255, 255]);
  };
  const lum = (rgb) => { const f = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (x, y) => { const [h, b] = [lum(x), lum(y)].sort((m, n) => n - m); return (h + 0.05) / (b + 0.05); };
  const visibleEl = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && Number(getComputedStyle(e).opacity) > 0;
  const nom = (e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${e.classList.length ? `.${[...e.classList].join('.')}` : ''}`;
  const VOULU = '.rs-tabs';
  const defile = (e) => Boolean(e.closest(VOULU));
  const deborde = [];
  const petits = [];
  const pales = [];
  const cibles = [];
  const doigt = matchMedia('(pointer: coarse)').matches;
  [...modal.querySelectorAll('*')].filter(visibleEl).forEach((e) => {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5) && !defile(e)) deborde.push(`${nom(e)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    const so = getComputedStyle(e);
    const coupeVoulue = so.textOverflow === 'ellipsis' || e.matches('.rs-sr');
    if (['auto', 'scroll', 'hidden'].includes(so.overflowX) && !coupeVoulue && !e.matches(VOULU) && e.scrollWidth > e.clientWidth + 1) deborde.push(`${nom(e)} defile de ${e.scrollWidth - e.clientWidth} px en largeur`);
    const texteDirect = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const inactif = e.closest('button:disabled, [aria-hidden="true"], .rs-sr');
    if (texteDirect && !inactif) {
      const st = getComputedStyle(e);
      if (parseFloat(st.fontSize) < 12) petits.push(`${nom(e)} ${st.fontSize}`);
      const q = ratio(px(st.color).slice(0, 3), fond(e));
      if (q < 4.5) pales.push(`${nom(e)} ${Math.round(q * 100) / 100}`);
    }
    if (doigt && (e.matches('button:not(:disabled)') || e.matches('input:not([type="hidden"])')) && Number(getComputedStyle(e).opacity) > 0 && r.height < 44 - 0.5) cibles.push(`${nom(e)} ${Math.round(r.height)}`);
  });
  const page = document.scrollingElement;
  return { doigt, largeur: innerWidth, defilePage: page.scrollWidth > innerWidth + 0.5, defileFenetre: modal.scrollWidth > modal.clientWidth + 0.5, deborde: deborde.slice(0, 6), petits: petits.slice(0, 6), pales: pales.slice(0, 6), cibles: cibles.slice(0, 6) };
}

async function scenarioS7(browser) {
  console.log('\n[S7] au doigt, telephone et tablette');
  for (const [appareil, theme] of [['telephone', 'dark'], ['tablette', 'light']]) {
    if (!joue(appareil)) continue;
    const lieu = `${appareil}, ${theme === 'dark' ? 'sombre' : 'clair'}`;
    const m = await ouvrirConsole(browser, { appareil, theme });
    const { page } = m;
    const telephone = appareil === 'telephone';
    // Chaque page part d une fenetre neuve, 6 joueurs choisis. Le bouton de la console
    // change de place selon la largeur : on ouvre comme lui. Au telephone, le ticket
    // s ouvre d abord (#rsResume) pour toucher ses lignes.
    const depart = async () => {
      await page.evaluate(() => { closeQuickBook(); openQuickBook(); });
      await page.locator('#rsHaut [data-pax="6"]').click();
      await pret(page);
    };
    const ticket = async () => {
      if (!telephone) return;
      await page.locator('#rsResume').click();
      await page.waitForSelector('.is-ticket #rsLignes .rs-tk-a');
    };
    const etats = [
      ['seances', async () => {}],
      ['ticket', ticket],
      ['ligne bowling', async () => { await ticket(); await page.locator('#rsL-a-bowling').click(); await page.waitForSelector('.is-q-ligne #rvHeure-bowling'); }],
      ['sur mesure', async () => { await page.locator('#rsMesure').click(); await page.waitForSelector('.rs-arts'); await page.locator('.rs-arts [id^="rsArt-"]').first().click(); await page.waitForSelector('.rs-bande [data-service], .rs-bande .rs-pas'); }],
      ['total', async () => { await ticket(); await page.locator('#rsL-total').click(); await page.waitForSelector('#qbCustomPrice'); }],
      ['client', async () => { await ticket(); await page.locator('#rsL-client').click(); await page.waitForSelector('#qbNotes'); }],
      ['formules', async () => { await page.locator('#rsFormules').click(); await page.waitForSelector('.rs-fs-g'); }],
      // Trois activites prises : les tuiles cochees, les lignes du ticket et leurs croix.
      ['plusieurs', async () => {
        for (const id of ['minigolf_blacklight', 'billards', 'arcade_time']) { await page.locator(`#rsT-${id}`).click(); await page.waitForSelector(`#rsL-a-${id}`, { state: 'attached' }); }
        await ticket();
      }],
    ];
    const bilan = { deborde: [], petits: [], pales: [], cibles: [], prerequis: [] };
    for (const [etat, aller] of etats) {
      try {
        await depart();
        await aller();
        await page.waitForTimeout(150);
        // (une entree animee compte dans les largeurs : on mesure la fenetre posee)
        await page.waitForFunction(() => {
          const o = document.getElementById('quickBookOverlay');
          return document.getAnimations().filter((a) => a.effect && a.effect.target && o.contains(a.effect.target) && a.effect.getTiming().iterations !== Infinity).every((a) => a.playState !== 'running');
        }, null, { timeout: 3000 }).catch(() => {});
      } catch (e) { bilan.prerequis.push(`${etat} : ${String(e.message).split('\n')[0].slice(0, 100)}`); continue; }
      const r = await page.evaluate(controler);
      if (!r.doigt) bilan.prerequis.push(`${etat} : pas au doigt`);
      if (r.defilePage || r.defileFenetre || r.deborde.length) bilan.deborde.push(`${etat} : ${JSON.stringify({ page: r.defilePage, fenetre: r.defileFenetre, elements: r.deborde })}`);
      if (r.petits.length) bilan.petits.push(`${etat} : ${r.petits.join(', ')}`);
      if (r.pales.length) bilan.pales.push(`${etat} : ${r.pales.join(', ')}`);
      if (r.cibles.length) bilan.cibles.push(`${etat} : ${r.cibles.join(', ')}`);
    }
    ok(bilan.prerequis.length === 0, `[S7] les huit pages se jouent au doigt (${lieu})`, bilan.prerequis);
    ok(bilan.deborde.length === 0, `[S7] rien ne deborde (${lieu})`, bilan.deborde);
    ok(bilan.petits.length === 0, `[S7] rien sous 12 px (${lieu})`, bilan.petits);
    ok(bilan.pales.length === 0, `[S7] contraste 4,5:1 (${lieu})`, bilan.pales);
    ok(bilan.cibles.length === 0, `[S7] cibles de 44 px au doigt (${lieu})`, bilan.cibles);
    // Et une commande s y cree, au doigt : la fenetre repart de zero.
    await depart();
    await page.locator('#rvCreer').click();
    const [r] = await nouveaux(page, m.avant);
    ok(Boolean(r) && r.pax === 6 && r.date === JOUR && a(r, 'bowling'), `[S7] une commande se cree au doigt (${lieu})`, resume(r));
    await m.finir(`S7 ${lieu}`);
  }
}

// ---------------------------------------------------------------------------
// [S8] CREER REND LA MAIN TOUT DE SUITE
// ---------------------------------------------------------------------------
async function scenarioS8(browser) {
  console.log('\n[S8] creer rend la main tout de suite');
  const m = await ouvrirConsole(browser);
  const { page } = m;
  await page.locator('.btn-new').click();
  await page.locator('#rsHaut [data-pax="6"]').click();
  await pret(page);
  // Les deux appels du moteur, notes avec la frame ou ils tombent et ce qui les appelle.
  await page.evaluate(() => {
    window.__trace = [];
    window.__frames = 0;
    (function compter() { window.__frames += 1; requestAnimationFrame(compter); })();
    const fermer = window.closeQuickBook;
    const rendre = window.renderStaff;
    window.closeQuickBook = function (...args) { window.__trace.push({ quoi: 'ferme', frame: window.__frames }); return fermer.apply(this, args); };
    window.renderStaff = function (...args) {
      const pile = String(new Error().stack || '');
      window.__trace.push({ quoi: 'rend', frame: window.__frames, cachee: document.getElementById('quickBookOverlay').classList.contains('hidden'), dansCreer: /saveQuickBook/.test(pile) });
      return rendre.apply(this, args);
    };
  });
  await page.locator('#rvCreer').click();
  const [r] = await nouveaux(page, m.avant);
  await page.waitForFunction(() => { const t = window.__trace; const i = t.findIndex((x) => x.quoi === 'ferme'); return i >= 0 && t.slice(i + 1).some((x) => x.quoi === 'rend'); }, null, { timeout: 4000 }).catch(() => {});
  const trace = await page.evaluate(() => window.__trace);
  const ferme = trace.find((x) => x.quoi === 'ferme');
  const apres = ferme ? trace.slice(trace.indexOf(ferme) + 1).filter((x) => x.quoi === 'rend') : [];
  ok(Boolean(r) && Boolean(ferme) && apres.length > 0, '[S8] Créer ferme la fenetre, puis la console se repeint', trace);
  ok(apres.length > 0 && apres.every((x) => !x.dansCreer) && apres[0].frame > ferme.frame && apres[0].cachee, '[S8] la console ne se repeint pas dans le geste de Créer, mais apres la frame qui ferme', trace);
  if (r) {
    await page.waitForSelector(`.gf-r[data-gf-id="${r.id}"]`, { timeout: 4000 }).catch(() => {});
    ok(await visible(page, `.gf-r[data-gf-id="${r.id}"]`), '[S8] le groupe cree se lit au tableau');
  }
  await m.finir('S8');
}

// ---------------------------------------------------------------------------
// [S9] PLUSIEURS ACTIVITES D UN TOUCHER
// ---------------------------------------------------------------------------
// Movsar (03/11) : « la jpeux appuyer direct sur plusieurs activités pour prendre plusieurs
// activité ». Un toucher ajoute, un deuxieme retire, une autre seance deplace. Ce qui se lit
// se compare au serveur : le prix d une tuile a celui que le vrai handler donne a cette
// activite seule, le prix d une ligne et le total a son plan, puis au dossier cree.
const PETITES = ['minigolf_blacklight', 'billards', 'arcade_time'];

// Le prix que le serveur donne a chaque activite seule, pour ce groupe, ce jour, cette heure :
// le corps que la fenetre enverrait (ses gestes, sur une copie qui ne peint rien), juge par
// le vrai handler sans passer par la fenetre.
function prixDuServeur(page, ids) {
  return page.evaluate(async (liste) => {
    const out = {};
    for (const id of liste) {
      const garde = quickBookState;
      let corps = null;
      rsRetenu += 1;
      try {
        quickBookState = JSON.parse(JSON.stringify({ ...garde, plan: null, candidats: null, clientConnu: null, rs: null, horloge: null }));
        rsRemplacer(id);
        corps = rvCorpsDeSimulation();
      } finally { quickBookState = garde; rsRetenu -= 1; rsAPeindre = false; }
      const rep = corps ? await window.__vraiAppel('POST', '/api/staff-reservations', { ...corps, dryRun: true }) : null;
      const ligne = rep && rep.json && rep.json.plan ? (rep.json.plan.lignesPrix || []).find((l) => l.activite === id) : null;
      out[id] = ligne ? (ligne.prix == null ? 'sur place' : rsEuros(ligne.prix)) : '?';
    }
    return out;
  }, ids);
}

// Le ticket tel qu il se lit, et ce que le serveur en a dit (son plan, sa reponse).
const lireTicket = (page) => page.evaluate(() => {
  const p = quickBookState.plan;
  const plan = p && p.etat === 'ok' && p.cle === quickBookState.cleCourante ? p.resultat : null;
  // (les montants s ecrivent avec une espace insecable : on compare des textes normalises)
  const norme = (x) => String(x).replace(/\s+/g, ' ').trim();
  const euros = (x) => norme(rsEuros(x));
  const texteDe = (el) => norme((el || {}).textContent || '');
  const lignes = [...document.querySelectorAll('#rsLignes .rs-tk-a[id^="rsL-a-"]')].map((b) => ({
    id: b.id.slice('rsL-a-'.length),
    detail: texteDe(b.querySelector('.rs-tk-n small')),
    prix: texteDe(b.querySelector('em')),
    croix: Boolean(document.getElementById(`rsSuppr-${b.id.slice('rsL-'.length)}`)),
  }));
  const inconnu = plan ? (plan.lignesPrix || []).some((l) => l.prix == null) : false;
  return {
    lignes,
    serveur: plan ? Object.fromEntries((plan.lignesPrix || []).map((l) => [l.activite, l.prix == null ? 'sur place' : euros(l.prix)])) : {},
    prixServeur: plan ? Number(plan.prix) : null,
    total: texteDe(document.getElementById('rvTotalPied')),
    attendu: plan ? (Number(plan.prix) === 0 && inconnu ? 'sur place' : euros(plan.prix)) : '?',
    reste: /sur place/.test(texteDe(document.querySelector('#rsL-total small'))),
    resteAttendu: inconnu && Number(plan && plan.prix) > 0,
  };
});

const lireSeances = (page) => page.evaluate(() => {
  const texteDe = (el) => ((el || {}).textContent || '').replace(/\s+/g, ' ').trim();
  const heure = (id) => ((document.getElementById(`rvHeure-${id}`) || { dataset: {} }).dataset.heure || '');
  const coche = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).opacity : ''; };
  return {
    ids: [...document.querySelectorAll('#rsLignes .rs-tk-a[id^="rsL-a-"]')].map((b) => b.id.slice('rsL-a-'.length)),
    bowling: heure('bowling'),
    laser: heure('laser_game'),
    ligneLaser: texteDe(document.getElementById('rsL-a-laser_game')),
    cocheBowling: coche('#rvHeure-bowling .rs-coche'),
  };
});

async function scenarioS9(browser) {
  console.log('\n[S9] plusieurs activites d un toucher');
  if (joue('tuiles')) {
    const m = await ouvrirConsole(browser);
    const { page } = m;
    await page.locator('.btn-new').click();
    await page.locator('#rsHaut [data-pax="8"]').click();
    await pret(page);
    // 1. Chaque tuile dit le prix du serveur (il chiffre les tuiles juste apres la peinture).
    const attendus = await prixDuServeur(page, PETITES);
    const prixLus = () => page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, ((document.querySelector(`#rsT-${id} small`) || {}).textContent || '').trim()])), PETITES);
    await page.waitForFunction((a) => Object.keys(a).every((id) => ((document.querySelector(`#rsT-${id} small`) || {}).textContent || '').trim() === a[id]), attendus, { timeout: 6000 }).catch(() => {});
    const affiches = await prixLus();
    ok(Object.values(attendus).includes('sur place') && Object.values(attendus).some((x) => /\d/.test(x)), '[S9] MONTAGE : une activite sans tarif au serveur, une avec', attendus);
    ok(PETITES.every((id) => affiches[id] === attendus[id]), '[S9] chaque tuile dit le prix du serveur, « sur place » quand il n en a pas', { affiches, attendus });
    // 2. Trois touchers sur trois tuiles : trois activites au ticket, le total a chaque toucher.
    const apres = [];
    for (const id of PETITES) {
      await page.locator(`#rsT-${id}`).click();
      await page.waitForSelector(`#rsL-a-${id}`, { state: 'attached', timeout: 4000 }).catch(() => {});
      await pret(page).catch(() => {});
      apres.push(await lireTicket(page));
    }
    const trois = apres[apres.length - 1];
    ok(JSON.stringify(trois.lignes.map((l) => l.id)) === JSON.stringify(PETITES), '[S9] trois touchers sur trois tuiles : trois activites au ticket', apres.map((t) => t.lignes.map((l) => l.id)));
    ok(trois.lignes.length === 3 && trois.lignes.every((l) => l.prix === trois.serveur[l.id] && /\d\d:\d\d|accès libre/.test(l.detail)), '[S9] chaque ligne du ticket dit le prix du serveur, et son heure', trois.lignes.map((l) => ({ ...l, serveur: trois.serveur[l.id] })));
    ok(apres.length === 3 && apres.every((t) => t.total === t.attendu && t.reste === t.resteAttendu), '[S9] le total suit chaque toucher : celui du serveur, le reste sur place', apres.map((t) => ({ total: t.total, attendu: t.attendu, reste: t.reste })));
    // 3. Ce qui est pris est coche, et la tuile prise dit l heure de sa ligne du ticket.
    await page.waitForTimeout(260);
    const tuiles = await page.evaluate((ids) => ids.map((id) => {
      const t = document.getElementById(`rsT-${id}`);
      const detail = ((document.querySelector(`#rsL-a-${id} .rs-tk-n small`) || {}).textContent || '');
      return {
        id,
        on: Boolean(t) && t.classList.contains('is-on') && t.getAttribute('aria-pressed') === 'true',
        coche: t ? getComputedStyle(t.querySelector('.rs-coche')).opacity : '',
        mot: t ? (t.querySelector('small').textContent || '').trim() : '',
        heure: (/\d\d:\d\d/.exec(detail) || [/accès libre/.test(detail) ? 'accès libre' : '-'])[0],
      };
    }), PETITES);
    ok(tuiles.every((t) => t.on && t.coche === '1'), '[S9] ce qui est pris est coche', tuiles);
    ok(tuiles.every((t) => t.mot === t.heure), '[S9] une tuile prise dit son heure du ticket', tuiles);
    // 4. Un deuxieme toucher retire la tuile ; la croix d une ligne aussi.
    await page.locator('#rsT-billards').click();
    await pret(page).catch(() => {});
    const deux = await lireTicket(page);
    const billardPris = await page.evaluate(() => document.getElementById('rsT-billards').classList.contains('is-on'));
    ok(JSON.stringify(deux.lignes.map((l) => l.id)) === '["minigolf_blacklight","arcade_time"]' && !billardPris, '[S9] un deuxieme toucher retire la tuile', { lignes: deux.lignes.map((l) => l.id), billardPris });
    await page.locator('#rsSuppr-a-arcade_time').click({ timeout: 3000 }).catch(() => {});
    await pret(page).catch(() => {});
    const une = await lireTicket(page);
    ok(deux.lignes.every((l) => l.croix) && JSON.stringify(une.lignes.map((l) => l.id)) === '["minigolf_blacklight"]', '[S9] chaque ligne se retire d une croix', { avant: deux.lignes, apres: une.lignes.map((l) => l.id) });
    // La derniere reste, il faut bien reserver quelque chose : sa ligne n a pas de croix,
    // et sa tuile touchee encore ouvre sa page (son heure, ses joueurs) au lieu de la retirer.
    await page.locator('#rsT-minigolf_blacklight').click();
    await page.waitForTimeout(260);
    const derniere = await page.evaluate(() => ({ ids: rvActivites(), page: (/\bis-q-([\w-]+)/.exec(document.querySelector('.qb-modal.rv').className) || [])[1] || '' }));
    ok(une.lignes.length === 1 && !une.lignes[0].croix && JSON.stringify(derniere.ids) === '["minigolf_blacklight"]' && derniere.page === 'ligne', '[S9] la derniere activite reste : sans croix, sa tuile ouvre sa page', { croix: une.lignes.map((l) => l.croix), derniere });
    await page.locator('#rsRetour').click({ timeout: 3000 }).catch(() => {});
    await page.waitForSelector('.is-q-activites #rsT-arcade_time', { timeout: 3000 }).catch(() => {});
    // 5. Le dossier cree porte ce que le ticket montre, a son prix.
    await page.locator('#rsT-arcade_time').click();
    await page.waitForSelector('#rsL-a-arcade_time', { state: 'attached', timeout: 4000 }).catch(() => {});
    await pret(page).catch(() => {});
    const final = await lireTicket(page);
    await page.locator('#rvCreer').click();
    const [r] = await nouveaux(page, m.avant);
    ok(Boolean(r) && r.pax === 8 && a(r, 'minigolf_blacklight') && a(r, 'arcade_time') && !a(r, 'billards') && Number(r.price) === final.prixServeur, '[S9] le dossier cree porte les activites du ticket, au prix du ticket', { ticket: final.lignes.map((l) => `${l.id} ${l.prix}`), total: final.total, dossier: resume(r) });
    await m.finir('S9 tuiles');
  }
  if (joue('seances')) {
    const m = await ouvrirConsole(browser);
    const { page } = m;
    await page.locator('.btn-new').click();
    await page.locator('#rsHaut [data-pax="8"]').click();
    await pret(page);
    await page.waitForSelector('.rs-s-l[data-verifie="1"] [data-activite="bowling"]');
    // Le bowling propose au depart n est pas coche ; choisi a une autre heure, il l est.
    await page.waitForTimeout(260);
    const propose = await lireSeances(page);
    const bowling = page.locator('#rsZ-bowling .rs-h[data-heure]:not(.is-on)').nth(1);
    const hb = await bowling.getAttribute('data-heure');
    await bowling.click();
    await pret(page).catch(() => {});
    await page.waitForTimeout(260);
    const choisi = await lireSeances(page);
    ok(propose.cocheBowling === '0' && choisi.bowling === hb && choisi.cocheBowling === '1', '[S9] le bowling propose n est pas coche, choisi il l est', { propose, choisi, hb });
    // Une seance du laser, pas encore pris : il s ajoute a cette heure, apres le bowling.
    await page.waitForSelector('.rs-s-l[data-verifie="1"] [data-activite="laser_game"]', { timeout: 8000 }).catch(() => {});
    const premiere = page.locator('#rsZ-laser_game .rs-h[data-heure]').first();
    const h1 = await premiere.getAttribute('data-heure');
    await premiere.click();
    await page.waitForSelector('#rsL-a-laser_game', { state: 'attached', timeout: 4000 }).catch(() => {});
    await pret(page).catch(() => {});
    const ajoute = await lireSeances(page);
    ok(JSON.stringify(ajoute.ids) === '["bowling","laser_game"]' && ajoute.laser === h1 && ajoute.ligneLaser.includes(h1) && ajoute.bowling === hb, '[S9] une seance d une activite pas encore prise l ajoute a cette heure', { hb, h1, ...ajoute });
    // Une autre seance du laser le deplace ; la meme, touchee encore, le retire.
    const autre = page.locator('#rsZ-laser_game .rs-h[data-heure]:not(.is-on)').nth(1);
    const h2 = await autre.getAttribute('data-heure').catch(() => '');
    await autre.click().catch(() => {});
    await pret(page).catch(() => {});
    const deplace = await lireSeances(page);
    ok(Boolean(h2) && JSON.stringify(deplace.ids) === '["bowling","laser_game"]' && deplace.laser === h2 && deplace.ligneLaser.includes(h2) && deplace.bowling === hb, '[S9] une autre seance d une activite prise deplace son heure', { h2, ...deplace });
    await page.locator(`#rsZ-laser_game .rs-h[data-heure="${h2}"]`).click({ timeout: 3000 }).catch(() => {});
    await pret(page).catch(() => {});
    const retire = await lireSeances(page);
    ok(JSON.stringify(retire.ids) === '["bowling"]' && retire.bowling === hb, '[S9] la meme seance touchee deux fois retire l activite', retire);
    await page.locator('#rvCreer').click();
    const [r] = await nouveaux(page, m.avant);
    ok(Boolean(r) && r.type === 'bowling' && heureDe(r) === hb && r.pax === 8, '[S9] le dossier cree est le bowling a son heure, sans le laser retire', resume(r));
    await m.finir('S9 seances');
  }
  if (joue('formule')) {
    // Un role qui adapte les formules : un toucher ajoute l activite a la formule, au meme
    // prix (le role qui ne le peut pas : [S6]).
    const m = await ouvrirConsole(browser);
    const { page } = m;
    await page.locator('.btn-new').click();
    await formuleF3(page);
    await pret(page).catch(() => {});
    const prixAvant = await page.evaluate(() => ((document.querySelector('#rsL-a-formule em') || {}).textContent || '').trim());
    await page.locator('#rsRetour').click();
    await page.waitForSelector('.is-q-activites #rsT-billards');
    await page.locator('#rsT-billards').click();
    await page.waitForSelector('#rsL-a-billards', { state: 'attached', timeout: 4000 }).catch(() => {});
    await pret(page).catch(() => {});
    const adaptee = await page.evaluate(() => ({
      formule: ((document.querySelector('#rsL-a-formule .rs-tk-n b') || {}).textContent || '').trim(),
      prix: ((document.querySelector('#rsL-a-formule em') || {}).textContent || '').trim(),
      ids: rvActivites(),
      billard: Boolean(document.querySelector('#rsL-a-billards')),
    }));
    ok(/adaptée/.test(adaptee.formule) && adaptee.billard && adaptee.ids.includes('billards') && Boolean(prixAvant) && adaptee.prix === prixAvant, '[S9] direction : une activite touchee adapte la formule, au meme prix', { prixAvant, ...adaptee });
    await page.locator('#rvCreer').click();
    const [r] = await nouveaux(page, m.avant);
    ok(Boolean(r) && r.formule_id === 'f3' && a(r, 'billards') && r.pax === 10, '[S9] le dossier cree est la formule adaptee, billard compris', resume(r));
    await m.finir('S9 formule');
  }
}

// ---------------------------------------------------------------------------
const SCENARIOS = { S1: scenarioS1, S2: scenarioS2, S3: scenarioS3, S4: scenarioS4, S5: scenarioS5, S6: scenarioS6, S7: scenarioS7, S8: scenarioS8, S9: scenarioS9 };

function verifierLesAncres() {
  let mortes = 0;
  for (const m of [...MUTATIONS, HORLOGE_SERVEUR]) {
    const n = verifierAncre(m);
    if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom || m.fichier} trouvee ${n} fois : ${m.de.slice(0, 80)}`); }
  }
  console.log(`reserver-seances-check --ancres : ${MUTATIONS.length + 1 - mortes}/${MUTATIONS.length + 1} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS;
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`, ...(m.bloc ? [`--bloc=${m.bloc}`] : [])], {
    env: { ...process.env, SEANCES_CASSE: m.nom, PINLANE_SEANCES_PORT: String(PORT + 1 + fil) },
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
  console.log(`reserver-seances-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    for (const nom of seul) await SCENARIOS[nom](browser);
  } finally {
    await browser.close();
    http.close();
  }
  console.log(`\nreserver-seances-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('reserver-seances-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

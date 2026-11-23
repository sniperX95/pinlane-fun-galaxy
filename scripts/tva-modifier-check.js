// LA TVA DANS MODIFIER (2026-11-23, Ansar : « Et pouvoir mettre tva ou htva quand on va dans modifier
// prix », puis, sur les taux proposes, « oui et paramettrable »).
//
// Le prix d un dossier s enregistre TVA comprise (TVAC), comme avant : le hors TVA (HTVA) se lit
// seulement, il ne s ecrit jamais. Modifier a un choix « TVAC | HTVA » sur Total et Par joueur, et
// « Détail du calcul » donne la TVA par taux. Les taux sont ceux du centre (Etablissement > Le centre >
// TVA, lib/center-config.js normalizeVatRates), un par sorte de ligne ; ceux qu Ansar a valides, par
// defaut : 6 % les activites, 12 % la nourriture, 21 % les boissons, 21 % les arcades. Une formule est
// une vente composee : son prix se repartit entre ses composants au prorata de leurs prix a la carte, et
// chaque part prend son taux. Une ligne « À payer » ou sans sorte connue prend le taux des activites, et
// le dit.
//
//   [V1] LE SERVEUR : les taux par defaut ; un taux enregistre se garde ; la vraie sauvegarde
//        (api/ops.js saveCenterConfig, sur la base du banc) refuse 150 %, -1 % et « abc » et n ecrit
//        rien ; la page Etablissement recoit le taux enregistre (lib/center-scope.js) ; le poll de la
//        journee le sert a toute l equipe (api/staff-state.js).
//   [V2] LE CALCUL DE LA CONSOLE (ses vraies fonctions, en VM, sur des montants d essai) : la TVA par
//        taux ; un taux change dans la config change le HTVA, le TVAC reste ; sans la page
//        Etablissement, les taux du poll ; une formule se repartit au prorata de ses prix a la carte ;
//        « À payer » et une ligne sans sorte prennent le taux des activites et le disent ; un HTVA tape
//        se ramene au TVAC.
//   [B1] ETABLISSEMENT (la vraie console, la journee « pic » du samedi 16 janvier 2027) : la rubrique
//        TVA montre les taux du centre ; 150 % : la page refuse et rien ne part ; Boissons 6 puis
//        Enregistrer : la vraie sauvegarde l ecrit, la page le remontre, Modifier lit le nouveau taux.
//   [B2] MODIFIER (la formule 1 de Sacha, 10 joueurs, et deux Pepsi du catalogue) : sans taux lus, HTVA
//        ne s ouvre pas ; le poll les apporte ; TVAC par defaut ; HTVA : Total et Par joueur hors TVA,
//        la TVA par taux, la formule repartie ; un Total ou un Par joueur tape en HTVA : la base garde le
//        TVAC, jamais le HTVA.
//   [B3] QUAND MODIFIER S OUVRE HORS TVA (Ansar, 23/11 : « on choisit, c est pas mis d office, mais des que
//        c est un groupe team building ou juste un grand groupe, la oui ») : « Prix hors TVA à l’ouverture »
//        dit « Jamais » pour un centre qui ne regle rien ; « Les groupes seulement » puis Enregistrer : la
//        vraie sauvegarde l ecrit, la page le relit ; Modifier s ouvre alors en HTVA pour les Collegues de
//        bureau (un team building) et en TVAC pour l anniversaire de Sacha ; le choix du comptoir tient tant
//        que la fiche est ouverte ; fermee puis rouverte, elle repart du reglage ; sans la page Etablissement,
//        le poll l apporte. La regle entiere, sans navigateur : scripts/tva-ouverture-check.js.
//   [*]  Zero erreur JavaScript.
//
// Le gate joue le VRAI handler api/staff-reservations.js (PATCH de Modifier), la vraie sauvegarde de
// la config (api/ops.js) et le vrai poll (api/staff-state.js) sur la base en memoire du banc
// (scripts/reserver-banc.js). Il lit toujours ce qui est EN BASE, jamais seulement l ecran.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en memoire,
// le disque n est jamais touche), et exige que chacune rougisse sa cible ; `--contre-preuves=nom,nom`
// en joue quelques-unes ; `--ancres` verifie que chaque ancre existe une seule fois ; `--seul=V1,V2`
// ne joue que ces lettres (V1 et V2 n ouvrent aucun navigateur). TVA_MODIFIER_CAPTURES=<dossier> :
// les captures 1366 x 768 de B1, B2 et B3, sans rien changer aux verdicts.
//
// Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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
const PORT = Number(process.env.PINLANE_TVA_MODIFIER_PORT || 7860);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.TVA_MODIFIER_CASSE || '');
const CAPTURES = String(process.env.TVA_MODIFIER_CAPTURES || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };

const APP = 'assets/app-main.js';
const CENTRE = 'lib/center-config.js';
const PROJECTION = 'lib/center-scope.js';
const POLL = 'api/staff-state.js';

// LES TAUX QU ANSAR A VALIDES (2026-11-23, « oui et paramettrable ») : la regle que ce gate tient.
const TAUX_VALIDES = Object.freeze({ activities: 6, food: 12, drinks: 21, arcades: 21 });

// LA MUTATION : le code casse expres, une regle a la fois. `lettre` dit quel scenario la juge,
// `cible` le debut du libelle qui doit rougir, `serveur` une mutation du code du serveur.
const LECTURE_DES_TAUX = '  const lus = (centre && centre.vatRates) || (state && state.staffTva) || null;';
const MUTATIONS = [
  { nom: 'defaut-change', lettre: 'V1', cible: '[V1] les taux par defaut', serveur: true, fichier: CENTRE, de: 'const DEFAULT_VAT_RATES = Object.freeze({ activities: 6, food: 12, drinks: 21, arcades: 21 });', vers: 'const DEFAULT_VAT_RATES = Object.freeze({ activities: 21, food: 12, drinks: 21, arcades: 21 });' },
  { nom: 'borne-oubliee', lettre: 'V1', cible: '[V1] la vraie sauvegarde refuse 150 %, -1 % et « abc »', serveur: true, fichier: CENTRE, de: '    if (!Number.isFinite(taux) || taux < 0 || taux > 100) {', vers: '    if (!Number.isFinite(taux)) {' },
  { nom: 'projection-sans-tva', lettre: 'V1', cible: '[V1] la page Etablissement recoit le taux enregistre', serveur: true, fichier: PROJECTION, de: '    // apres enregistrement ; sans eux ici, un taux enregistre revenait a son defaut a l ecran.\n    vatRates: config.vatRates,\n', vers: '    // apres enregistrement ; sans eux ici, un taux enregistre revenait a son defaut a l ecran.\n' },
  { nom: 'poll-sans-tva', lettre: 'V1', cible: '[V1] le poll de la journee sert le taux enregistre', serveur: true, fichier: POLL, de: '    sendJson(res, 200, { ok: true, ...snapshot, classification, accueil, vatRates, htvaParDefaut, ouvertures, modificationABlanc: true });', vers: '    sendJson(res, 200, { ok: true, ...snapshot, classification, accueil, htvaParDefaut, ouvertures, modificationABlanc: true });' },
  { nom: 'taux-en-dur', lettre: 'V2', cible: '[V2] un taux change dans la config change le HTVA', fichier: APP, de: LECTURE_DES_TAUX, vers: '  const lus = { activities: 6, food: 12, drinks: 21, arcades: 21 };' },
  { nom: 'poll-oublie', lettre: 'V2', cible: '[V2] sans la page Etablissement, la console lit les taux du poll', fichier: APP, de: LECTURE_DES_TAUX, vers: '  const lus = (centre && centre.vatRates) || null;' },
  { nom: 'formule-un-seul-taux', lettre: 'V2', cible: '[V2] une formule se repartit au prorata de ses prix a la carte', fichier: APP, de: "    if (l.sorte === 'formule') { parts.push(...repartirFormule(l.nom, l.montant, composantsDeLaFormuleEdition())); return; }", vers: "    if (l.sorte === 'formule') { parts.push({ nom: l.nom, sorte: 'activities', montant: Number(l.montant) || 0 }); return; }" },
  { nom: 'a-payer-muet', lettre: 'V2', cible: '[V2] une ligne « À payer » prend le taux des activites, et le dit', fichier: APP, de: 'l.aPayer ? `à payer : taux des activités, ${taux(tva.taux.activities)}` :', vers: "l.aPayer ? '' :" },
  { nom: 'inconnue-muette', lettre: 'V2', cible: '[V2] une ligne sans sorte connue prend le taux des activites, et le dit', fichier: APP, de: "${l.inconnue ? ' <em>sorte inconnue : taux des activités</em>' : ''}", vers: '' },
  { nom: 'page-sans-taux', lettre: 'B1', cible: '[B1] la rubrique TVA montre les taux du centre', fichier: APP, de: "  const taux = center.vatRates && typeof center.vatRates === 'object' ? center.vatRates : {};", vers: '  const taux = {};' },
  { nom: 'garde-page-oubliee', lettre: 'B1', cible: '[B1] 150 % : la page refuse, le dit sous la case, et rien ne part', fichier: APP, de: '    if (!Number.isFinite(value) || value < 0 || value > 100 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) {', vers: '    if (false) {' },
  { nom: 'etablissement-ignore', lettre: 'B1', cible: '[B1] Modifier lit le nouveau taux', fichier: APP, de: LECTURE_DES_TAUX, vers: '  const lus = (state && state.staffTva) || null;' },
  { nom: 'poll-ignore', lettre: 'B2', cible: '[B2] le poll apporte les taux du centre : HTVA s ouvre', fichier: APP, de: '    if (payload.vatRates) state.staffTva = payload.vatRates;\n', vers: '' },
  { nom: 'htva-en-base', lettre: 'B2', cible: '[B2] un Total tape en HTVA : la base garde le TVAC', fichier: APP, de: '  state.editState.price = prixHorsTvaEdition() ? tvacDuHorsTva(valeur) : valeur;', vers: '  state.editState.price = valeur;' },
  { nom: 'htva-par-joueur-en-base', lettre: 'B2', cible: '[B2] un Par joueur tape en HTVA : la base garde le TVAC', fichier: APP, de: '  state.editState.price = prixHorsTvaEdition() ? tvacDuHorsTva(totalTape) : totalTape;', vers: '  state.editState.price = totalTape;' },
  // [B3] quand Modifier s ouvre hors TVA (le reste de la regle se juge sans navigateur : scripts/tva-ouverture-check.js)
  { nom: 'b3-envoi-oublie', lettre: 'B3', cible: '[B3] « Les groupes seulement » puis Enregistrer : la vraie sauvegarde l ecrit, la page le relit', fichier: APP, de: "  return champ ? String(champ.value || '') : undefined;", vers: '  return undefined;' },
  { nom: 'b3-projection-sans-reglage', lettre: 'B3', cible: '[B3] « Les groupes seulement » puis Enregistrer : la vraie sauvegarde l ecrit, la page le relit', serveur: true, fichier: PROJECTION, de: '    // Quand Modifier s ouvre hors TVA (2026-11-23), meme raison : l ecran le montre et le remet en place.\n    htvaParDefaut: config.htvaParDefaut,\n', vers: '' },
  { nom: 'b3-ouverture-sans-reglage', lettre: 'B3', cible: '[B3] « Les groupes seulement » : Modifier s ouvre en HTVA pour un team building', fichier: APP, de: '  etat.prixVu = prixVuALOuverture(reservation);\n', vers: '' },
  { nom: 'b3-choix-defait', lettre: 'B3', cible: '[B3] le choix du comptoir tient tant que la fiche est ouverte', fichier: APP, de: '  if (prixVuDeLaFiche && r && Number(prixVuDeLaFiche.id) === Number(r.id)) return prixVuDeLaFiche.vu;\n', vers: '' },
  { nom: 'b3-survol-sur-le-choix', lettre: 'B3', cible: '[B3] le bouton HTVA choisi garde son fond de choix sous la souris', fichier: 'assets/pinlane-staff.css', de: ':is(.qb-opt, .dossier-option):hover:not(:disabled):not(.is-on, .selected, .active) { background: var(--subtle); }', vers: ':is(.qb-opt, .dossier-option):hover:not(:disabled) { background: var(--subtle); }' },
  { nom: 'b2-detail-brut', lettre: 'B2', cible: '[B2] le detail du calcul ecrit « 6,60 € »', fichier: APP, de: "<b>${l.montant == null ? 'sur place' : formatMoneyCentimes(l.montant)}</b>", vers: "<b>${l.montant == null ? 'sur place' : `${Math.round((l.montant) * 100) / 100} ${signeMonnaie()}`}</b>" },
  { nom: 'b3-poll-oublie', lettre: 'B3', cible: '[B3] sans la page Etablissement, le poll apporte le reglage', fichier: APP, de: '    if (payload.htvaParDefaut) state.staffHtvaParDefaut = payload.htvaParDefaut;\n', vers: '' },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

// LE JOUR DU SERVEUR : celui de la fixture, a son heure (getBusinessNowParts, la seule lecture de
// l heure du metier), quel que soit le jour ou le gate tourne.
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
if (CASSE && !mutation) { console.error(`tva-modifier-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
function verifierAncre(m) {
  return lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
}
if (mutation && verifierAncre(mutation) !== 1) {
  console.error(`tva-modifier-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// L ARITHMETIQUE DE LA REGLE, ecrite ici sans le code de la console : un montant TVA comprise au taux t
// porte t / (100 + t) de TVA ; un total se repartit au prorata des poids de ses parts.
// ---------------------------------------------------------------------------
const centimes = (n) => Math.round(Number(n) * 100) / 100;
const proche = (a, b, ecart = 0.005) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= ecart;
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function attenduTva(parts, total) {
  const somme = parts.reduce((s, p) => s + p.poids, 0);
  const parTaux = new Map();
  let inverse = 0;
  parts.forEach((p) => {
    const montant = (total * p.poids) / somme;
    parTaux.set(p.taux, (parTaux.get(p.taux) || 0) + (montant * p.taux) / (100 + p.taux));
    inverse += (p.poids / somme) * (100 / (100 + p.taux));
  });
  const tva = [...parTaux.entries()].sort((a, b) => a[0] - b[0]).map(([taux, m]) => ({ taux, montant: centimes(m) }));
  return { tva, htva: centimes(total - tva.reduce((s, x) => s + x.montant, 0)), facteur: 1 / inverse };
}
const memesTva = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x.taux === b[i].taux && proche(x.montant, b[i].montant));
// Les montants d un texte de la console (« 245,31 € HTVA = 266,60 € TVAC », « 240 € » sans centimes),
// dans l ordre, et la TVA par taux de « dont TVA 6 % : 13,47 € · 21 % : 8 € ».
const montantsDe = (texte) => [...String(texte || '').matchAll(/(\d[\d\s.]*(?:,\d{1,2})?)\s*€/g)].map((m) => Number(m[1].replace(/[\s.]/g, '').replace(',', '.')));
const tvaDuTexte = (texte) => [...String(texte || '').matchAll(/(\d+(?:,\d+)?) % : (\d[\d\s.]*(?:,\d{1,2})?)\s*€/g)].map((m) => ({ taux: Number(m[1].replace(',', '.')), montant: Number(m[2].replace(/[\s.]/g, '').replace(',', '.')) }));

// ---------------------------------------------------------------------------
// LE SERVEUR : le handler de Modifier, la sauvegarde de la config, le poll, sur la base du banc.
// ---------------------------------------------------------------------------
const serveur = B.monter({
  mutations: [HORLOGE_SERVEUR, ...(mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [])],
  session: B.sessionDuRole('direction', { nom: 'Accueil' }),
});
// (requis apres le montage : le banc recompile les modules, contre-preuve comprise)
const ops = () => require(path.join(ROOT, 'api/ops.js'));
const poll = () => require(path.join(ROOT, POLL));
const CC = () => require(path.join(ROOT, CENTRE));
const projection = () => require(path.join(ROOT, PROJECTION));
const rafraichir = () => require(path.join(ROOT, 'lib/ops-knowledge.js')).refreshCenterOverrides(require(path.join(ROOT, 'lib/database.js')).getPool(), { force: true });

// LA TABLE DES CENTRES, sur la base du banc : la lecture et l ecriture que fait la vraie sauvegarde
// (lib/center-config.js saveCenterConfigOverride). La liste (`select id, name, status, timezone,
// settings from centers;`) est celle du banc ; ce qui s ecrit se note dans `ecrituresCentre`.
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryAvant = pg.Client.prototype.query;
const ecrituresCentre = [];
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const centre = B.base.centers.find((c) => c.id === params[0]);
  if (s === 'select settings from centers where id = $1 limit 1;') return centre ? { rows: [{ settings: JSON.parse(JSON.stringify(centre.settings || {})) }], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (s === 'select status from centers where id = $1 limit 1;') return centre ? { rows: [{ status: centre.status }], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (s.startsWith("update centers set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{config}', $2::jsonb, true)")) {
    if (!centre) return { rows: [], rowCount: 0 };
    centre.settings = { ...(centre.settings || {}), config: JSON.parse(params[1]) };
    centre.status = params[2];
    ecrituresCentre.push({ id: centre.id, vatRates: centre.settings.config.vatRates });
    return { rows: [], rowCount: 1 };
  }
  return queryAvant.call(this, sql, params);
};
// Le centre en base, sa config enregistree telle quelle (vide : les defauts du fichier).
function poserCentre(config = {}) {
  B.base.centers.splice(0, B.base.centers.length, { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: { config: JSON.parse(JSON.stringify(config)) } });
  ecrituresCentre.length = 0;
}
const tauxEnBase = () => ((B.base.centers[0] || {}).settings || {}).config ? B.base.centers[0].settings.config.vatRates : undefined;

// ---------------------------------------------------------------------------
// [V1] LE SERVEUR
// ---------------------------------------------------------------------------
async function scenarioV1() {
  console.log('\n[V1] le serveur : les taux du centre');
  const lib = CC().normalizeCenterConfig({}, 'libramont').vatRates;
  const gem = CC().normalizeCenterConfig({}, 'gembloux').vatRates;
  ok(egal(lib, TAUX_VALIDES) && egal(gem, TAUX_VALIDES), '[V1] les taux par defaut : activites 6 %, nourriture 12 %, boissons 21 %, arcades 21 %, a Libramont comme a Gembloux', { lib, gem });
  const garde = CC().normalizeCenterConfig({ vatRates: { drinks: '6', food: '20,5' } }, 'libramont', { strict: true }).vatRates;
  ok(egal(garde, { ...TAUX_VALIDES, food: 20.5, drinks: 6 }), '[V1] un taux enregistre se garde (« 20,5 » se lit 20,5 %), les autres gardent leur defaut', garde);
  const relu = CC().normalizeCenterConfig({ vatRates: { drinks: 150 } }, 'libramont').vatRates;
  ok(relu.drinks === TAUX_VALIDES.drinks, '[V1] a la lecture, un taux hors bornes deja en base reprend son defaut : la console ne lit jamais 150 %', relu);

  poserCentre({});
  await rafraichir();
  const sauver = (vatRates) => B.appeler(ops(), 'POST', '/api/ops', { action: 'saveCenterConfig', centerId: 'libramont', config: { vatRates } });
  const refus = [];
  for (const v of [{ drinks: '150' }, { food: '-1' }, { arcades: 'abc' }]) {
    const rep = await sauver(v); // eslint-disable-line no-await-in-loop
    refus.push({ v, statut: rep.statut, message: rep.json.message || rep.json.error || '' });
  }
  ok(refus.every((r) => r.statut === 400 && r.message === 'TVA : un taux se donne de 0 à 100 %.') && ecrituresCentre.length === 0,
    '[V1] la vraie sauvegarde refuse 150 %, -1 % et « abc », le dit, et n ecrit rien', { refus, ecritures: ecrituresCentre });
  const rep = await sauver({ drinks: '6' });
  ok(rep.statut === 200 && egal(tauxEnBase(), { ...TAUX_VALIDES, drinks: 6 }) && ecrituresCentre.length === 1,
    '[V1] la vraie sauvegarde ecrit Boissons 6 %, les autres taux gardent leur valeur', { statut: rep.statut, message: rep.json.message || rep.json.error, enBase: tauxEnBase() });
  const page = projection().projectCenterRow(B.base.centers[0]).vatRates;
  ok(egal(page, { ...TAUX_VALIDES, drinks: 6 }), '[V1] la page Etablissement recoit le taux enregistre (lib/center-scope.js)', page);
  const lu = await B.appeler(poll(), 'GET', `/api/staff-state?date=${B.JOUR}&centerId=libramont`);
  ok(lu.statut === 200 && egal(lu.json.vatRates, { ...TAUX_VALIDES, drinks: 6 }), '[V1] le poll de la journee sert le taux enregistre a toute l equipe (api/staff-state.js)', { statut: lu.statut, vatRates: lu.json.vatRates });
  poserCentre({});
  await rafraichir();
  const lu0 = await B.appeler(poll(), 'GET', `/api/staff-state?date=${B.JOUR}&centerId=libramont`);
  ok(lu0.statut === 200 && egal(lu0.json.vatRates, TAUX_VALIDES), '[V1] sans taux enregistre, le poll sert les taux par defaut', { statut: lu0.statut, vatRates: lu0.json.vatRates });
}

// ---------------------------------------------------------------------------
// [V2] LE CALCUL DE LA CONSOLE, ses vraies fonctions en VM
// ---------------------------------------------------------------------------
const FONCTIONS_TVA = ['tauxTvaDuCentre', 'sorteTvaActivite', 'sorteTvaExtra', 'groupeExtraDossier', 'repartirFormule', 'partsTvaEdition',
  'tvaDuPrix', 'tvaEdition', 'tvacDuHorsTva', 'prixHorsTvaEdition', 'ligneTvaEditionTexte', 'tvaDetailHtml'];
function consoleEnVm() {
  let app = lf(fs.readFileSync(path.join(ROOT, APP), 'utf8'));
  if (mutation && !mutation.serveur && mutation.fichier === APP) app = app.split(mutation.de).join(mutation.vers);
  // Ce que ces fonctions lisent d autre : le centre de la session, le cache de la page Etablissement,
  // l etat de Modifier, et trois lectures que le gate pose lui-meme (l estimation du prix, le montant du
  // champ, les composants de la formule).
  const bac = {
    console: { log() {}, warn() {}, error() {} },
    state: { editState: null, selectedRes: null, staffTva: null },
    staffCenterConfigCache: { centers: [] },
    getCurrentStaffCenterId: () => 'libramont',
    escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    formatMoneyCentimes: (n) => `${centimes(n).toFixed(2).replace('.', ',')} €`,
    __estime: null,
    __prix: null,
    __composants: [],
  };
  vm.createContext(bac);
  vm.runInContext('var getEditPrixEstime = function () { return __estime; }, getEditPriceValue = function () { return __prix; }, composantsDeLaFormuleEdition = function () { return __composants; };', bac);
  const manquantes = [];
  FONCTIONS_TVA.forEach((nom) => {
    const debut = app.indexOf(`\nfunction ${nom}(`);
    const fin = debut < 0 ? -1 : app.indexOf('\n}\n', debut + 1);
    if (fin < 0) { manquantes.push(nom); return; }
    vm.runInContext(app.slice(debut + 1, fin + 2), bac);
  });
  const debut = app.indexOf('\nconst TVA_SORTES = ');
  const fin = debut < 0 ? -1 : app.indexOf(';\n', debut + 1);
  if (fin < 0) manquantes.push('TVA_SORTES');
  else vm.runInContext(`var ${app.slice(debut + '\nconst '.length, fin + 1)}`, bac);
  const run = (code) => { const r = vm.runInContext(code, bac); return r === undefined ? undefined : JSON.parse(JSON.stringify(r)); };
  return { bac, manquantes, run };
}
const sansBalises = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const texteParTaux = (tva) => `dont TVA ${tva.map((x) => `${String(x.taux).replace('.', ',')} % : ${centimes(x.montant).toFixed(2).replace('.', ',')} €`).join(' · ')}`;

async function scenarioV2() {
  console.log('\n[V2] le calcul de la console : ses vraies fonctions, en VM');
  const { bac, manquantes, run } = consoleEnVm();
  ok(manquantes.length === 0, 'MONTAGE les fonctions de la TVA se lisent dans assets/app-main.js', manquantes);
  if (manquantes.length) return;
  const avecCache = (vatRates) => { bac.staffCenterConfigCache = { centers: [{ id: 'libramont', ...(vatRates ? { vatRates } : {}) }] }; };

  // Les taux : la page Etablissement d abord, sinon le poll, sinon rien.
  avecCache({ ...TAUX_VALIDES, drinks: 6 });
  bac.state.staffTva = { ...TAUX_VALIDES };
  ok(egal(run('tauxTvaDuCentre()'), { ...TAUX_VALIDES, drinks: 6 }), '[V2] la console lit d abord les taux de la page Etablissement', run('tauxTvaDuCentre()'));
  avecCache(null);
  ok(egal(run('tauxTvaDuCentre()'), TAUX_VALIDES), '[V2] sans la page Etablissement, la console lit les taux du poll', run('tauxTvaDuCentre()'));
  bac.state.staffTva = null;
  bac.state.editState = { prixVu: 'htva' };
  ok(run('tauxTvaDuCentre()') === null && run('prixHorsTvaEdition()') === false, '[V2] sans taux lus, pas de hors TVA : le choix HTVA reste ferme', { taux: run('tauxTvaDuCentre()'), htva: run('prixHorsTvaEdition()') });
  bac.state.staffTva = { ...TAUX_VALIDES, drinks: 150 };
  ok(run('tauxTvaDuCentre()') === null, '[V2] un taux illisible n est jamais lu : 150 % ne donne pas de hors TVA', run('tauxTvaDuCentre()'));

  // Les sortes de chaque ligne.
  const sortes = {
    boisson: run("sorteTvaExtra({ id: 'boissons-1', categorie: 'boissons', name: 'Pepsi / Pepsi Max' })"),
    nourriture: run("sorteTvaExtra({ id: 'nourriture-1', categorie: 'nourriture', name: 'Pizza' })"),
    gateau: run("sorteTvaExtra({ id: 'x-1', categorie: 'gateaux', name: 'Gâteau' })"),
    arcades: run("sorteTvaExtra({ id: 'arcades-2', name: 'Carte arcades' })"),
    parNom: run("sorteTvaExtra({ id: 'vieux-1', name: 'Cruche Bière' })"),
    activites: ['bowling', 'duckpin_bowling', 'laser_game', 'minigolf_blacklight'].map((id) => run(`sorteTvaActivite('${id}')`)),
    machines: ['arcade_time', 'arcade_credit'].map((id) => run(`sorteTvaActivite('${id}')`)),
  };
  ok(sortes.boisson.sorte === 'drinks' && sortes.nourriture.sorte === 'food' && sortes.gateau.sorte === 'food' && sortes.arcades.sorte === 'arcades' && sortes.parNom.sorte === 'drinks'
    && sortes.activites.every((s) => s === 'activities') && sortes.machines.every((s) => s === 'arcades'),
  '[V2] chaque ligne a sa sorte : boissons, nourriture et gateaux, arcades, et les activites', sortes);

  // Un dossier sans formule : chaque ligne a son taux (montants d essai).
  avecCache({ ...TAUX_VALIDES });
  bac.state.staffTva = null;
  bac.state.editState = { prixVu: 'tvac' };
  const lignes = [
    { nom: 'Bowling', sorte: 'activities', montant: 78 },
    { nom: 'Pepsi / Pepsi Max × 2', sorte: 'drinks', montant: 6.6 },
    { nom: 'Pizza', sorte: 'food', montant: 12 },
    { nom: 'Carte arcades', sorte: 'arcades', montant: 20 },
  ];
  const total = 116.6;
  bac.__estime = { total, lignes };
  bac.__prix = total;
  const poids = (taux) => lignes.map((l) => ({ taux: taux[l.sorte], poids: l.montant }));
  const t1 = run('tvaEdition()');
  const a1 = attenduTva(poids(TAUX_VALIDES), total);
  ok(Boolean(t1) && memesTva(t1.tva, a1.tva) && proche(t1.htva, a1.htva) && t1.tvac === total, '[V2] la TVA d un dossier se donne par taux : chaque ligne a celui de sa sorte (6, 12, 21, 21 %)', { obtenu: t1 && { tva: t1.tva, htva: t1.htva }, attendu: a1 });
  avecCache({ ...TAUX_VALIDES, drinks: 6 });
  const t2 = run('tvaEdition()');
  const a2 = attenduTva(poids({ ...TAUX_VALIDES, drinks: 6 }), total);
  ok(Boolean(t2) && Boolean(t1) && memesTva(t2.tva, a2.tva) && proche(t2.htva, a2.htva) && !proche(t2.htva, t1.htva) && t2.tvac === total,
    '[V2] un taux change dans la config change le HTVA, le TVAC reste', { avant: t1 && t1.htva, apres: t2 && t2.htva, attendu: a2.htva });
  avecCache({ ...TAUX_VALIDES });
  bac.__prix = 100;
  const t3 = run('tvaEdition()');
  const a3 = attenduTva(poids(TAUX_VALIDES), 100);
  ok(Boolean(t3) && t3.tvac === 100 && memesTva(t3.tva, a3.tva) && proche(t3.htva, a3.htva), '[V2] un prix fixe a la main garde les proportions du detail', { obtenu: t3 && { tva: t3.tva, htva: t3.htva }, attendu: a3 });
  bac.__prix = total;
  const detail = sansBalises(run('tvaDetailHtml(tvaEdition())'));
  ok(detail.includes(texteParTaux(a1.tva)) && detail.includes(`Hors TVA ${a1.htva.toFixed(2).replace('.', ',')} €`), '[V2] le detail dit la TVA par taux et le hors TVA', { detail, attendu: texteParTaux(a1.tva) });
  const ligne = run('ligneTvaEditionTexte(tvaEdition())');
  ok(egal(montantsDe(ligne), [a1.htva, total]) && /HTVA = .*TVAC$/.test(ligne), '[V2] sous les champs, « HTVA = TVAC » donne les deux montants', ligne);

  // Un HTVA tape se ramene au TVAC, au meme melange de taux.
  bac.state.editState = { prixVu: 'htva' };
  const tvac = Number(run("tvacDuHorsTva('100')"));
  bac.__prix = tvac;
  const retour = run('tvaEdition()');
  ok(proche(tvac, centimes(100 * a1.facteur)) && Boolean(retour) && proche(retour.htva, 100, 0.011) && run("tvacDuHorsTva('')") === '' && run("tvacDuHorsTva('abc')") === 'abc',
    '[V2] un HTVA tape se ramene au TVAC du meme melange de taux ; un champ vide ou illisible reste tel quel', { tvac, attendu: centimes(100 * a1.facteur), htvaRelu: retour && retour.htva });
  bac.state.editState = { prixVu: 'tvac' };

  // Une formule : son prix se repartit au prorata des prix a la carte de ses composants.
  const composants = [
    { nom: 'Bowling', sorte: 'activities', prix: 78 },
    { nom: 'Laser Game', sorte: 'activities', prix: 90 },
    { nom: 'Arcades', sorte: 'arcades', prix: 50 },
    { nom: '2 cruches boissons', sorte: 'drinks', prix: 7 },
    { nom: '1 boisson', sorte: 'drinks', prix: null },
  ];
  const formule = { nom: 'FORMULE 1', sorte: 'formule', montant: 260 };
  bac.__composants = composants;
  bac.__estime = { total: 266.6, lignes: [formule, { nom: 'Pepsi / Pepsi Max × 2', sorte: 'drinks', montant: 6.6 }] };
  bac.__prix = 266.6;
  const parts = run('partsTvaEdition(getEditPrixEstime())');
  const carte = composants.filter((c) => c.prix > 0);
  const somme = carte.reduce((s, c) => s + c.prix, 0);
  const dedans = parts.filter((p) => p.dansFormule && p.montant > 0);
  const auProrata = carte.every((c) => { const p = dedans.find((x) => x.nom === c.nom); return p && p.sorte === c.sorte && proche(p.montant, (formule.montant * c.prix) / somme, 1e-9); });
  const sansPrix = parts.find((p) => p.nom === '1 boisson');
  const t4 = run('tvaEdition()');
  const a4 = attenduTva([...carte.map((c) => ({ taux: TAUX_VALIDES[c.sorte], poids: (formule.montant * c.prix) / somme })), { taux: TAUX_VALIDES.drinks, poids: 6.6 }], 266.6);
  ok(auProrata && dedans.length === carte.length && Boolean(sansPrix) && sansPrix.sansPrix && sansPrix.montant === 0 && Boolean(t4) && memesTva(t4.tva, a4.tva) && proche(t4.htva, a4.htva),
    '[V2] une formule se repartit au prorata de ses prix a la carte, chaque part a son taux', { parts, obtenu: t4 && { tva: t4.tva, htva: t4.htva }, attendu: a4 });
  const detailFormule = sansBalises(run('tvaDetailHtml(tvaEdition())'));
  ok(detailFormule.includes('Bowling dans la formule') && detailFormule.includes('2 cruches boissons dans la formule') && detailFormule.includes('1 boisson dans la formule, sans prix à la carte : hors répartition'),
    '[V2] le detail dit ce qui est dans la formule, et ce qui n a pas de prix a la carte', detailFormule);
  bac.__composants = composants.map((c) => ({ ...c, prix: null }));
  const seule = run('partsTvaEdition(getEditPrixEstime())').filter((p) => p.montant > 0);
  ok(seule.length === 2 && seule[0].sorte === 'activities' && seule[0].inconnue === true && seule[0].montant === 260 && sansBalises(run('tvaDetailHtml(tvaEdition())')).includes('FORMULE 1 sorte inconnue : taux des activités'),
    '[V2] une formule sans aucun prix a la carte prend le taux des activites, et le dit', seule);

  // « À payer » et une ligne sans sorte connue : le taux des activites, et le detail le dit.
  bac.__composants = [];
  const libre = run("sorteTvaExtra({ id: 'libre-3', categorie: 'autre', name: 'Animation clown' })");
  bac.__estime = { total: 108, lignes: [
    { nom: 'Bowling', sorte: 'activities', montant: 78 },
    { nom: 'Gâteau', sorte: 'food', aPayer: true, montant: 0 },
    { nom: 'Animation clown', ...libre, montant: 30 },
  ] };
  bac.__prix = 108;
  const t5 = run('tvaEdition()');
  const detail5 = sansBalises(run('tvaDetailHtml(tvaEdition())'));
  const gateau = t5 && t5.aCote.find((p) => p.nom === 'Gâteau');
  ok(Boolean(gateau) && gateau.aPayer && gateau.sorte === 'activities' && detail5.includes('Gâteau à payer : taux des activités, 6 %'),
    '[V2] une ligne « À payer » prend le taux des activites, et le dit', { gateau, detail5 });
  const clown = t5 && t5.lignes.find((p) => p.nom === 'Animation clown');
  ok(libre.sorte === 'activities' && libre.inconnue === true && Boolean(clown) && clown.taux === TAUX_VALIDES.activities && detail5.includes('Animation clown sorte inconnue : taux des activités'),
    '[V2] une ligne sans sorte connue prend le taux des activites, et le dit', { libre, clown, detail5 });
}

// ---------------------------------------------------------------------------
// LE MONTAGE DU NAVIGATEUR
// ---------------------------------------------------------------------------
FX.APPAREILS.comptoir = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
const HEURE = '15:10';
const SACHA = 1604;
const CENTRE_FIXTURE = FX.lireCentre().center;
// Le catalogue du centre (lib/center-config.js) : le prix des Pepsi et de la cruche de la formule.
const CATALOGUE = require(path.join(ROOT, CENTRE)).surMesureChoisissable(require(path.join(ROOT, CENTRE)).catalogueSurMesure('libramont'));
const PEPSI = CATALOGUE.articles.find((a) => a.id === 'pepsi-pepsi-max');
const CRUCHE = CATALOGUE.articles.find((a) => a.id === 'cruche-d-eau-grenadine-menthe');
const LIGNE_PEPSI = PEPSI ? { id: 'boissons-1', articleId: PEPSI.id, categorie: 'boissons', name: PEPSI.nom, qte: 2, prixUnitaire: Number(PEPSI.prix), price: centimes(2 * Number(PEPSI.prix)) } : null;

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
// Le dossier de Sacha avec ses deux Pepsi : la formule 1 de la fixture, la boisson du catalogue.
const avecPepsi = (r) => (r.id === SACHA && LIGNE_PEPSI ? { ...r, extras: [LIGNE_PEPSI], price: centimes(Number(r.price) + LIGNE_PEPSI.price) } : r);

function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

// Les lectures que la page fait au vrai code : le catalogue (api/ops.js surMesureCatalogue), et, quand
// `tauxALaPage`, la config du centre avec les taux que la vraie projection lit en base.
async function lectureDuBanc(url, tauxALaPage) {
  const u = new URL(url, 'http://127.0.0.1');
  if (u.pathname !== '/api/ops') return null;
  if (u.searchParams.get('action') === 'surMesureCatalogue') return (await B.appeler(ops(), 'GET', url)).json;
  if (u.searchParams.get('action') === 'centerConfig' && tauxALaPage) {
    const projete = projection().projectCenterRow(B.base.centers[0]);
    return { ok: true, centers: [{ ...CENTRE_FIXTURE, vatRates: projete.vatRates, htvaParDefaut: projete.htvaParDefaut }], activities: [] };
  }
  return null;
}

// La console sur la journee « pic », le dossier de Sacha avec ses Pepsi, en base et a l ecran.
async function ouvrirConsole(browser, { tauxALaPage = false } = {}) {
  const fx = FX.lireFixture('pic');
  globalThis.__comptoirMaintenant = FX.instant(fx.staffState.date, HEURE).getTime();
  B.semer(fx.staffState.reservations.map(avecPepsi).map(ligneDepuis));
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil: 'comptoir', theme: 'light', port: PORT, heure: HEURE, variante: ['sansdemo'],
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => { const rep = await serveur.appeler('PATCH', '/api/staff-reservations', corps); journal.push({ m: 'PATCH', corps, statut: rep.statut, json: rep.json }); return rep; });
      await page.exposeFunction('__fixtureBlanc', async (corps) => serveur.appeler('POST', '/api/staff-reservations', corps));
      await page.exposeFunction('__fixtureLecture', async (url) => lectureDuBanc(url, tauxALaPage));
      await page.exposeFunction('__vraiOps', async (corps) => { const rep = await B.appeler(ops(), 'POST', '/api/ops', corps); journal.push({ m: 'OPS', action: corps && corps.action, corps, statut: rep.statut, json: rep.json }); return rep; });
      await page.exposeFunction('__vraiPoll', async (url) => (await B.appeler(poll(), 'GET', url)).json);
    },
  });
  const { ctx, page, erreurs } = m;
  page.setDefaultTimeout(8000);
  await page.evaluate((sacha) => {
    // La sauvegarde de la config part au vrai handler ; le poll recoit les taux et le reglage du vrai poll
    // quand le gate le demande (window.__tvaDuPoll). Le reste reste celui de la fixture.
    const avant = window.fetch;
    const J = (corps, status) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    window.fetch = async (input, init) => {
      init = init || {};
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      if (u.pathname === '/api/ops' && me === 'POST') {
        const corps = init.body ? JSON.parse(init.body) : {};
        if (corps.action === 'saveCenterConfig') { const rep = await window.__vraiOps(corps); return J(rep.json || {}, rep.statut); }
      }
      const rep = await avant(input, init);
      if (u.pathname === '/api/staff-state' && window.__tvaDuPoll && rep.status === 200) {
        const j = await rep.clone().json();
        const vrai = await window.__vraiPoll(u.pathname + u.search);
        return J({ ...j, vatRates: vrai && vrai.vatRates, htvaParDefaut: vrai && vrai.htvaParDefaut }, 200);
      }
      return rep;
    };
    const poser = (liste) => { const i = liste.findIndex((r) => r.id === sacha.id); if (i >= 0) liste[i] = { ...liste[i], extras: sacha.extras, price: sacha.price }; };
    poser(window.__FIXTURE__.jours[window.__FIXTURE__.jour]);
    poser(state.reservations);
    renderStaff();
  }, { id: SACHA, extras: [LIGNE_PEPSI], price: Number(B.base.reservations.get(SACHA).price) });
  await page.waitForSelector('.gf-r', { timeout: 10000 });
  const finir = async (quoi) => {
    ok(erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  };
  return { ctx, page, erreurs, journal, finir };
}

async function capture(page, nom, avant = null) {
  if (!CAPTURES) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  if (avant) await page.evaluate(avant);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}
// Le bloc Prix de Modifier dans l ecran, son detail ouvert.
const montrerLePrix = () => {
  const d = document.querySelector('#posOverlay .dossier-price-detail');
  if (d) d.open = true;
  const s = document.querySelector('#posOverlay .dossier-price-section');
  if (s) s.scrollIntoView({ block: 'start' });
};

// ---- Modifier ---------------------------------------------------------------
async function ouvrirModifier(page, id) {
  await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
  await page.waitForSelector('#posOverlay .es-save', { timeout: 8000 });
  await page.waitForSelector('#posOverlay [data-tva="tvac"]', { timeout: 8000 });
  // (le catalogue du centre arrive avec les extras : la cruche de la formule a son prix)
  await page.waitForFunction(() => typeof catalogueSurMesureConsole !== 'undefined' && Array.isArray(catalogueSurMesureConsole.articles), null, { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(250);
}
async function basculer(page, mode) {
  await page.click(`#posOverlay [data-tva="${mode}"]`, { timeout: 3000 }).catch(() => null); // (HTVA ferme : l assertion qui suit le dit, le test ne s interrompt pas)
  await page.waitForSelector(`#posOverlay [data-tva="${mode}"].active`, { timeout: 5000 }).catch(() => null);
}
const lireTva = (page) => page.evaluate(() => {
  const o = document.getElementById('posOverlay');
  const b = (m) => o && o.querySelector(`[data-tva="${m}"]`);
  const champ = (id) => document.getElementById(id);
  const lbl = (id) => (((o && o.querySelector(`label[for="${id}"]`)) || {}).textContent || '').trim();
  const ligne = champ('editPrixTva');
  return {
    vu: b('htva') && b('htva').classList.contains('active') ? 'htva' : (b('tvac') && b('tvac').classList.contains('active') ? 'tvac' : ''),
    htvaFerme: Boolean(b('htva') && b('htva').disabled),
    htvaTitre: b('htva') ? b('htva').title : '',
    total: champ('editPriceInput') ? Number(champ('editPriceInput').value) : NaN,
    parJoueur: champ('editPricePerPerson') ? Number(champ('editPricePerPerson').value) : NaN,
    libelleTotal: lbl('editPriceInput'),
    libelleParJoueur: lbl('editPricePerPerson'),
    ligne: ligne && !ligne.hidden ? ligne.textContent.replace(/\s+/g, ' ').trim() : '',
    parTaux: ((champ('editTvaParTaux') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    horsTva: ((champ('editTvaHorsTva') || {}).textContent || '').trim(),
    prix: state.editState ? String(state.editState.price) : '',
  };
});
// Le calcul de la console sur le dossier ouvert : les parts, leurs taux, la formule et ses composants.
const calculDe = (page) => page.evaluate(() => {
  const t = tvaEdition();
  const estime = getEditPrixEstime();
  return t && {
    htva: t.htva,
    tvac: t.tvac,
    tva: t.tva,
    lignes: t.lignes.map((l) => ({ nom: l.nom, sorte: l.sorte, taux: l.taux, poids: Number(l.montant), part: l.part, dansFormule: Boolean(l.dansFormule), prixCarte: l.prixCarte ?? null })),
    aCote: t.aCote.map((l) => ({ nom: l.nom, sorte: l.sorte, aPayer: Boolean(l.aPayer), sansPrix: Boolean(l.sansPrix) })),
    formule: ((estime && estime.lignes) || []).filter((l) => l.sorte === 'formule').map((l) => ({ nom: l.nom, montant: Number(l.montant) })),
    composants: composantsDeLaFormuleEdition(),
  };
});
async function enregistrer(page, journal) {
  const avant = journal.filter((j) => j.m === 'PATCH').length;
  await page.click('#posOverlay .es-save');
  const t = Date.now();
  while (journal.filter((j) => j.m === 'PATCH').length === avant && Date.now() - t < 10000) await page.waitForTimeout(80); // eslint-disable-line no-await-in-loop
  await page.waitForTimeout(400);
  return journal.filter((j) => j.m === 'PATCH').slice(avant);
}
const prixEnBase = () => Number((B.base.reservations.get(SACHA) || {}).price);

// ---------------------------------------------------------------------------
// [B1] ETABLISSEMENT
// ---------------------------------------------------------------------------
async function ouvrirEtablissement(page) {
  await page.evaluate(() => { closePos(); state.staffMenuPage = 'establishment'; state.establishmentTab = 'centre'; state.establishmentEditing = false; setView('staff'); });
  await page.waitForSelector('[data-estab-page] #estab-tva-drinks', { state: 'attached', timeout: 15000 });
  await page.evaluate(() => { ebOuvrir('centre'); const g = document.getElementById('eb-tva'); if (g) g.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(250);
}
const lireTauxPage = (page) => page.evaluate(() => {
  const v = (cle) => { const c = document.getElementById(`estab-tva-${cle}`); return c ? c.value : null; };
  return { activities: v('activities'), food: v('food'), drinks: v('drinks'), arcades: v('arcades') };
});
async function retourAuPlanning(page) {
  await page.evaluate(() => { state.staffMenuPage = 'planning'; setView('staff'); });
  await page.waitForSelector('.gf-r', { timeout: 10000 });
}

async function scenarioB1(browser) {
  console.log('\n[B1] Etablissement : la rubrique TVA, puis Modifier');
  poserCentre({});
  await rafraichir();
  const m = await ouvrirConsole(browser, { tauxALaPage: true });
  const { page, journal } = m;
  // Modifier avant : les boissons a leur taux par defaut.
  await ouvrirModifier(page, SACHA);
  await basculer(page, 'htva');
  const avant = await calculDe(page);
  await page.evaluate(() => closePos());

  await ouvrirEtablissement(page);
  const lus = await lireTauxPage(page);
  ok(egal(lus, { activities: '6', food: '12', drinks: '21', arcades: '21' }), '[B1] la rubrique TVA montre les taux du centre : activites 6, nourriture 12, boissons 21, arcades 21', lus);
  await capture(page, 'tva-1-etablissement-taux');

  // 150 % : la page refuse, rien ne part.
  await page.fill('#estab-tva-drinks', '150');
  await page.click('#estabSaveBtn');
  await page.waitForTimeout(500);
  const refus = await page.evaluate(() => {
    const c = document.getElementById('estab-tva-drinks');
    const rangee = c && c.closest('.eb-r');
    const note = rangee && rangee.querySelector('.field-error-message');
    return { invalide: c ? c.getAttribute('aria-invalid') : null, message: note ? note.textContent.trim() : '' };
  });
  const parties150 = journal.filter((j) => j.m === 'OPS');
  ok(refus.invalide === 'true' && refus.message === 'TVA des boissons : un taux de 0 à 100 %.' && parties150.length === 0 && ecrituresCentre.length === 0,
    '[B1] 150 % : la page refuse, le dit sous la case, et rien ne part', { refus, envois: parties150.map((j) => ({ statut: j.statut, message: j.json.message })), ecritures: ecrituresCentre.length });
  await capture(page, 'tva-2-etablissement-150-refuse');

  // Boissons 6 : la vraie sauvegarde l ecrit, la page le remontre.
  await page.fill('#estab-tva-drinks', '6');
  await page.click('#estabSaveBtn');
  const t = Date.now();
  while (!journal.some((j) => j.m === 'OPS' && j.action === 'saveCenterConfig') && Date.now() - t < 10000) await page.waitForTimeout(80); // eslint-disable-line no-await-in-loop
  await page.waitForFunction(() => !submitCenterConfigInFlight, null, { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(500);
  const envoi = journal.filter((j) => j.m === 'OPS' && j.action === 'saveCenterConfig').pop();
  const relu = await lireTauxPage(page);
  ok(Boolean(envoi) && envoi.statut === 200 && egal(tauxEnBase(), { ...TAUX_VALIDES, drinks: 6 }) && egal(relu, { activities: '6', food: '12', drinks: '6', arcades: '21' }),
    '[B1] Boissons 6 puis Enregistrer : la vraie sauvegarde l ecrit, la page le remontre', { statut: envoi && envoi.statut, message: envoi && (envoi.json.message || envoi.json.error), enBase: tauxEnBase(), relu });

  // Modifier lit le nouveau taux : les boissons a 6 %, le HTVA change, le TVAC reste.
  await retourAuPlanning(page);
  await ouvrirModifier(page, SACHA);
  await basculer(page, 'htva');
  const apres = await calculDe(page);
  const boissons = (c) => (c ? c.lignes.filter((l) => l.sorte === 'drinks').map((l) => l.taux) : []);
  const a = apres ? attenduTva(apres.lignes.map((l) => ({ taux: l.taux, poids: l.poids })), apres.tvac) : null;
  ok(Boolean(avant) && Boolean(apres) && boissons(avant).length > 0 && boissons(avant).every((x) => x === TAUX_VALIDES.drinks) && boissons(apres).length === boissons(avant).length && boissons(apres).every((x) => x === 6)
    && apres.htva > avant.htva && proche(apres.htva, a.htva) && apres.tvac === avant.tvac && apres.tvac === prixEnBase(),
  '[B1] Modifier lit le nouveau taux : les boissons a 6 %, le HTVA change, le TVAC reste le prix enregistre', { avant: avant && { htva: avant.htva, boissons: boissons(avant) }, apres: apres && { htva: apres.htva, boissons: boissons(apres), tvac: apres.tvac }, enBase: prixEnBase() });
  await m.finir('B1');
}

// ---------------------------------------------------------------------------
// [B2] MODIFIER
// ---------------------------------------------------------------------------
async function scenarioB2(browser) {
  console.log('\n[B2] Modifier : la formule 1 de Sacha et deux Pepsi, en TVAC puis en HTVA');
  ok(Boolean(PEPSI) && Boolean(CRUCHE) && Number(PEPSI.prix) > 0 && Number(CRUCHE.prix) > 0, 'MONTAGE le Pepsi et la cruche se lisent dans le catalogue du centre', { pepsi: PEPSI, cruche: CRUCHE });
  poserCentre({});
  await rafraichir();
  const m = await ouvrirConsole(browser, { tauxALaPage: false });
  const { page, journal } = m;
  const prix0 = prixEnBase();

  // Sans taux lus (la fixture ne les sert pas), HTVA ne s ouvre pas, et le dit.
  await ouvrirModifier(page, SACHA);
  const ferme = await lireTva(page);
  ok(ferme.vu === 'tvac' && ferme.htvaFerme && ferme.htvaTitre === 'Les taux de TVA du centre ne sont pas encore lus.', '[B2] sans taux lus, HTVA ne s ouvre pas et le dit', ferme);
  await page.evaluate(() => closePos());

  // Le poll apporte les taux du centre (ceux du vrai poll, sur la base du banc).
  await page.evaluate(async () => { window.__tvaDuPoll = true; await syncDateReservations(state.currentDate, { silent: true }); });
  const duPoll = await page.evaluate(() => state.staffTva || null);
  await ouvrirModifier(page, SACHA);
  const tvac = await lireTva(page);
  ok(egal(duPoll, TAUX_VALIDES) && !tvac.htvaFerme, '[B2] le poll apporte les taux du centre : HTVA s ouvre', { duPoll, tvac });
  ok(tvac.vu === 'tvac' && tvac.libelleTotal === 'Total' && tvac.total === prix0 && proche(tvac.parJoueur, centimes(prix0 / 10)), '[B2] TVAC par defaut : le Total est le prix enregistre, Par joueur aussi', { tvac, prix0 });
  await capture(page, 'tva-3-modifier-tvac', montrerLePrix);

  // HTVA : les champs disent le hors TVA du prix enregistre, et rien ne s ecrit.
  await basculer(page, 'htva');
  const hors = await lireTva(page);
  const calcul = await calculDe(page);
  const ref = calcul ? attenduTva(calcul.lignes.map((l) => ({ taux: l.taux, poids: l.poids })), prix0) : null;
  ok(Boolean(ref) && hors.vu === 'htva' && hors.libelleTotal === 'Total HTVA' && hors.libelleParJoueur === 'Par joueur HTVA' && proche(hors.total, ref.htva) && proche(hors.parJoueur, centimes(ref.htva / 10), 0.011)
    && egal(montantsDe(hors.ligne), [ref.htva, prix0]),
  '[B2] HTVA : Total et Par joueur disent le hors TVA du prix enregistre, et la ligne « HTVA = TVAC »', { hors, attendu: ref && ref.htva });
  ok(Number(hors.prix) === prix0 && journal.filter((j) => j.m === 'PATCH').length === 0 && prixEnBase() === prix0, '[B2] basculer en HTVA n ecrit rien : le prix reste TVA comprise', { prix: hors.prix, patchs: journal.length, enBase: prixEnBase() });
  ok(Boolean(ref) && memesTva(calcul.tva, ref.tva) && /^dont TVA /.test(hors.parTaux) && memesTva(tvaDuTexte(hors.parTaux), ref.tva) && proche(montantsDe(hors.horsTva)[0], ref.htva),
    '[B2] le detail du calcul donne la TVA par taux : « dont TVA 6 % : x · 21 % : y », et le hors TVA', { parTaux: hors.parTaux, attendu: ref && ref.tva, horsTva: hors.horsTva });

  // Le detail du calcul passe par le formateur de la console : deux Pepsi = « 6,60 € », jamais « 6.6 € » (7d7732f).
  const detail = await page.evaluate(() => Array.from(document.querySelectorAll('#posOverlay .dossier-price-detail li')).map((li) => ({ nom: ((li.querySelector('span') || {}).textContent || '').replace(/\s+/g, ' ').trim(), montant: ((li.querySelector('b') || {}).textContent || '').replace(/\s+/g, ' ').trim() })));
  const lignePepsi = detail.find((l) => /Pepsi/i.test(l.nom));
  ok(Boolean(lignePepsi) && lignePepsi.montant === '6,60 €' && !detail.some((l) => /\d\.\d/.test(l.montant)), '[B2] le detail du calcul ecrit « 6,60 € » (deux Pepsi), jamais « 6.6 € »', detail);

  // La formule : ses composants a leur prix a la carte, sa part a chacun, chaque part a son taux.
  const formule = calcul && calcul.formule[0];
  const carte = calcul ? calcul.composants.filter((c) => Number(c.prix) > 0) : [];
  const somme = carte.reduce((s, c) => s + Number(c.prix), 0);
  const dedans = calcul ? calcul.lignes.filter((l) => l.dansFormule) : [];
  const cruches = carte.find((c) => /cruche/i.test(c.nom));
  const pepsi = calcul ? calcul.lignes.find((l) => !l.dansFormule && l.sorte === 'drinks') : null;
  const tauxJustes = dedans.every((l) => l.taux === TAUX_VALIDES[l.sorte]);
  ok(Boolean(formule) && dedans.length === carte.length && carte.length >= 3
    && dedans.every((l) => { const c = carte.find((x) => x.nom === l.nom); return c && proche(l.poids, (formule.montant * Number(c.prix)) / somme, 0.0001) && l.prixCarte === Number(c.prix); })
    && proche(dedans.reduce((s, l) => s + l.poids, 0), formule.montant, 0.0001)
    && Boolean(cruches) && proche(cruches.prix, 2 * Number(CRUCHE.prix)) && dedans.some((l) => l.sorte === 'drinks' && l.taux === TAUX_VALIDES.drinks)
    && dedans.some((l) => l.sorte === 'activities' && l.taux === TAUX_VALIDES.activities) && tauxJustes
    && Boolean(pepsi) && proche(pepsi.poids, LIGNE_PEPSI.price) && pepsi.taux === TAUX_VALIDES.drinks,
  '[B2] la formule se repartit entre ses composants au prorata de leurs prix a la carte, chaque part a son taux, et les Pepsi a celui des boissons', { formule, carte, dedans, pepsi });
  await capture(page, 'tva-4-modifier-htva', montrerLePrix);

  // Un Total tape en HTVA : il s enregistre TVA comprise.
  const facteur = ref ? ref.facteur : NaN;
  const tape = 240;
  await page.fill('#editPriceInput', String(tape));
  await page.waitForTimeout(250);
  const vu = await lireTva(page);
  const tvacTape = centimes(tape * facteur);
  ok(proche(Number(vu.prix), tvacTape, 0.011) && egal(montantsDe(vu.ligne).slice(0, 1), [tape]) && proche(montantsDe(vu.ligne)[1], Number(vu.prix)),
    '[B2] un Total tape en HTVA se lit TVA comprise sous les champs', { vu, attendu: tvacTape });
  const envoi1 = await enregistrer(page, journal);
  const prix1 = prixEnBase();
  ok(envoi1.length >= 1 && envoi1[envoi1.length - 1].statut === 200 && proche(prix1, tvacTape, 0.011) && !proche(prix1, tape, 0.5),
    '[B2] un Total tape en HTVA : la base garde le TVAC, jamais le HTVA', { statut: envoi1.map((e) => e.statut), message: envoi1.map((e) => e.json && (e.json.message || e.json.error)), enBase: prix1, attendu: tvacTape });

  // Rouvert : TVAC, sur le prix enregistre ; puis un Par joueur tape en HTVA.
  await ouvrirModifier(page, SACHA);
  const rouvert = await lireTva(page);
  ok(rouvert.vu === 'tvac' && proche(rouvert.total, prix1), '[B2] rouvert, Modifier repart en TVAC sur le prix enregistre', { rouvert, enBase: prix1 });
  await basculer(page, 'htva');
  const parJoueur = 25;
  await page.fill('#editPricePerPerson', String(parJoueur));
  await page.waitForTimeout(250);
  const vu2 = await lireTva(page);
  const tvacParJoueur = centimes(parJoueur * 10 * facteur);
  ok(vu2.total === parJoueur * 10 && proche(Number(vu2.prix), tvacParJoueur, 0.011), '[B2] un Par joueur tape en HTVA donne le Total HTVA, et le TVAC en dessous', { vu2, attendu: tvacParJoueur });
  const envoi2 = await enregistrer(page, journal);
  const prix2 = prixEnBase();
  ok(envoi2.length >= 1 && envoi2[envoi2.length - 1].statut === 200 && proche(prix2, tvacParJoueur, 0.011) && !proche(prix2, parJoueur * 10, 0.5),
    '[B2] un Par joueur tape en HTVA : la base garde le TVAC, jamais le HTVA', { statut: envoi2.map((e) => e.statut), message: envoi2.map((e) => e.json && (e.json.message || e.json.error)), enBase: prix2, attendu: tvacParJoueur });
  await m.finir('B2');
}

// ---------------------------------------------------------------------------
// [B3] QUAND MODIFIER S OUVRE HORS TVA (2026-11-23, Ansar : « on choisit, c est pas mis d office, mais des que
// c est un groupe team building ou juste un grand groupe, la oui »). La regle elle-meme (trois reglages ×
// normale, team building, grand groupe) se juge sans navigateur, avec ses contre-preuves :
// scripts/tva-ouverture-check.js. Ici, la vraie console : le reglage d Etablissement s enregistre et se relit,
// Modifier s ouvre en HTVA pour un team building et en TVAC pour l anniversaire de Sacha, le choix du comptoir
// tient tant que la fiche est ouverte, et le poll apporte le reglage sans la page Etablissement.
// ---------------------------------------------------------------------------
// « Collègues de bureau » dans la journee « pic » : l occasion « entreprise », un team building.
const COLLEGUES = 1622;
const htvaEnBase = () => (((B.base.centers[0] || {}).settings || {}).config || {}).htvaParDefaut;
// La ligne « Prix hors TVA à l ouverture » de la rubrique TVA : ses trois mots, celui qui est choisi, le select.
const lireOuverture = (page) => page.evaluate(() => {
  const seg = document.querySelector('[data-estab-page] [data-eb-seg="estab-tva-ouverture"]');
  const boutons = seg ? [...seg.querySelectorAll('.eb-seg-btn')] : [];
  const choisi = boutons.find((b) => b.getAttribute('aria-checked') === 'true');
  const select = document.getElementById('estab-tva-ouverture');
  return { mots: boutons.map((b) => b.textContent.trim()), choisi: choisi ? choisi.dataset.ebV : '', valeur: select ? select.value : '' };
});

async function scenarioB3(browser) {
  console.log('\n[B3] Etablissement : « Prix hors TVA à l’ouverture », puis Modifier');
  poserCentre({});
  await rafraichir();
  const m = await ouvrirConsole(browser, { tauxALaPage: true });
  const { page, journal } = m;
  const groupe = await page.evaluate((id) => { const r = state.reservations.find((x) => x.id === id); return r ? { occasion: r.occasion, pax: r.pax } : null; }, COLLEGUES);
  ok(Boolean(groupe) && groupe.occasion === 'entreprise', 'MONTAGE les Collègues de bureau sont un team building (occasion « entreprise »)', groupe);

  // Un centre qui ne regle rien : « Jamais ».
  await ouvrirEtablissement(page);
  const avant = await lireOuverture(page);
  ok(egal(avant.mots, ['Jamais', 'Toutes les réservations', 'Les groupes seulement']) && avant.choisi === 'jamais' && avant.valeur === 'jamais',
    '[B3] un centre qui ne regle rien : la rubrique TVA dit « Jamais »', avant);
  await capture(page, 'tva-5-etablissement-ouverture');

  // « Les groupes seulement », puis Enregistrer : la vraie sauvegarde l ecrit, la page le relit.
  await page.click('[data-estab-page] [data-eb-seg="estab-tva-ouverture"] [data-eb-v="groupes"]');
  await page.waitForTimeout(150);
  const barre = await page.evaluate(() => ((document.getElementById('ebBarN') || {}).textContent || '').trim());
  ok(barre.includes('Prix hors TVA à l’ouverture : les groupes seulement'), '[B3] la barre dit le changement avant l enregistrement', barre);
  await page.click('#estabSaveBtn');
  const t = Date.now();
  while (!journal.some((j) => j.m === 'OPS' && j.action === 'saveCenterConfig') && Date.now() - t < 10000) await page.waitForTimeout(80); // eslint-disable-line no-await-in-loop
  await page.waitForFunction(() => !submitCenterConfigInFlight, null, { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(500);
  const envoi = journal.filter((j) => j.m === 'OPS' && j.action === 'saveCenterConfig').pop();
  // (la page quittee puis rouverte : elle se redessine sur ce que le serveur relit, pas sur le clic)
  await retourAuPlanning(page);
  await ouvrirEtablissement(page);
  const relu = await lireOuverture(page);
  ok(Boolean(envoi) && envoi.statut === 200 && envoi.corps.config.htvaParDefaut === 'groupes' && htvaEnBase() === 'groupes' && relu.choisi === 'groupes' && relu.valeur === 'groupes',
    '[B3] « Les groupes seulement » puis Enregistrer : la vraie sauvegarde l ecrit, la page le relit', { statut: envoi && envoi.statut, envoye: envoi && envoi.corps.config.htvaParDefaut, message: envoi && (envoi.json.message || envoi.json.error), enBase: htvaEnBase(), relu });
  await capture(page, 'tva-6-etablissement-groupes', () => { const g = document.getElementById('eb-tva'); if (g) g.scrollIntoView({ block: 'center' }); });

  // Modifier : le team building s ouvre en HTVA, l anniversaire de Sacha en TVAC.
  await retourAuPlanning(page);
  await ouvrirModifier(page, COLLEGUES);
  const tb = await lireTva(page);
  ok(tb.vu === 'htva' && !tb.htvaFerme && tb.libelleTotal === 'Total HTVA' && tb.libelleParJoueur === 'Par joueur HTVA',
    '[B3] « Les groupes seulement » : Modifier s ouvre en HTVA pour un team building', tb);
  await capture(page, 'tva-7-modifier-team-building-htva', montrerLePrix);
  // Un bouton choisi garde son fond de choix sous la souris (7d7732f : la regle :hover le passait en fond clair
  // sous un texte blanc). Le bouton non choisi (TVAC) prend bien le fond de survol : le survol marche toujours.
  const style = (sel) => page.evaluate((s) => { const b = document.querySelector(s); const c = getComputedStyle(b); return { fond: c.backgroundColor, texte: c.color }; }, sel);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(350);
  const choisiAuRepos = await style('#posOverlay [data-tva="htva"]');
  const autreAuRepos = await style('#posOverlay [data-tva="tvac"]');
  await page.hover('#posOverlay [data-tva="htva"]');
  await page.waitForTimeout(350);
  const choisiSousLaSouris = await style('#posOverlay [data-tva="htva"]');
  await capture(page, 'tva-8-modifier-htva-sous-la-souris');
  await page.hover('#posOverlay [data-tva="tvac"]');
  await page.waitForTimeout(350);
  const autreSousLaSouris = await style('#posOverlay [data-tva="tvac"]');
  ok(choisiSousLaSouris.fond === choisiAuRepos.fond && choisiSousLaSouris.texte === choisiAuRepos.texte && choisiAuRepos.fond !== autreAuRepos.fond,
    '[B3] le bouton HTVA choisi garde son fond de choix sous la souris', { choisiAuRepos, choisiSousLaSouris, autreAuRepos });
  ok(autreSousLaSouris.fond !== autreAuRepos.fond && autreSousLaSouris.fond !== choisiAuRepos.fond, '[B3] un bouton non choisi prend toujours le fond de survol', { autreAuRepos, autreSousLaSouris });
  await page.mouse.move(2, 2);
  await ouvrirModifier(page, SACHA);
  const sacha = await lireTva(page);
  ok(sacha.vu === 'tvac' && sacha.libelleTotal === 'Total', '[B3] « Les groupes seulement » : l anniversaire de Sacha s ouvre en TVAC', sacha);

  // Le comptoir repasse le team building en TVAC : son choix tient tant que la fiche est ouverte, quoi qu il arrive
  // apres l ouverture (le catalogue qui repeint, le poll de la journee, l echo du serveur, Infos puis Modifier).
  await ouvrirModifier(page, COLLEGUES);
  await basculer(page, 'tvac');
  const bascule = await lireTva(page);
  await page.evaluate(async () => {
    repeindreFormuleDuDossierEdition();
    await syncDateReservations(state.currentDate, { silent: true });
    applyOptimisticReservation({ ...state.selectedRes }, { preserveEditState: true });
    renderPos();
  });
  await page.waitForTimeout(400);
  const apres = await lireTva(page);
  // (l onglet Infos puis Modifier, par la fonction des deux onglets ; setTab y ajoute seulement la garde d une saisie)
  await page.evaluate(() => { ouvrirOngletFiche('details'); ouvrirOngletFiche('modifier'); });
  await page.waitForSelector('#posOverlay [data-tva="tvac"]', { timeout: 8000 });
  const infos = await lireTva(page);
  ok(bascule.vu === 'tvac' && apres.vu === 'tvac' && apres.libelleTotal === 'Total' && infos.vu === 'tvac',
    '[B3] le choix du comptoir tient tant que la fiche est ouverte (catalogue, poll, echo du serveur, Infos puis Modifier)', { bascule, apres, infos });

  // Fermee puis rouverte : la fiche repart du reglage.
  await ouvrirModifier(page, COLLEGUES);
  const rouvert = await lireTva(page);
  ok(rouvert.vu === 'htva', '[B3] fermee puis rouverte, la fiche repart du reglage : HTVA', rouvert);

  // Sans la page Etablissement (sa liste videe), le poll apporte le reglage enregistre.
  await page.evaluate(async () => { closePos(); staffCenterConfigCache.centers = []; window.__tvaDuPoll = true; await syncDateReservations(state.currentDate, { silent: true }); });
  const duPoll = await page.evaluate(() => ({ reglage: state.staffHtvaParDefaut || null, taux: Boolean(state.staffTva) }));
  await ouvrirModifier(page, COLLEGUES);
  const parLePoll = await lireTva(page);
  ok(duPoll.reglage === 'groupes' && duPoll.taux && parLePoll.vu === 'htva', '[B3] sans la page Etablissement, le poll apporte le reglage : le team building s ouvre en HTVA', { duPoll, parLePoll });
  ok(journal.filter((j) => j.m === 'PATCH').length === 0, '[B3] ouvrir, basculer et rouvrir n ecrivent rien : aucun PATCH', journal.filter((j) => j.m === 'PATCH').length);
  await m.finir('B3');
}

// ---------------------------------------------------------------------------
const SCENARIOS = { V1: scenarioV1, V2: scenarioV2, B1: scenarioB1, B2: scenarioB2, B3: scenarioB3 };
const SANS_NAVIGATEUR = new Set(['V1', 'V2']);

function verifierLesAncres() {
  let mortes = 0;
  for (const m of [...MUTATIONS, HORLOGE_SERVEUR]) {
    const n = verifierAncre(m);
    if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom || m.fichier} trouvee ${n} fois : ${m.de.slice(0, 80)}`); }
  }
  MUTATIONS.filter((m, i) => MUTATIONS.findIndex((x) => x.nom === m.nom) !== i).forEach((m) => { mortes += 1; console.log(`FAIL  contre-preuve ${m.nom} nommee deux fois`); });
  console.log(`tva-modifier-check --ancres : ${MUTATIONS.length + 1 - mortes}/${MUTATIONS.length + 1} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS;
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, TVA_MODIFIER_CASSE: m.nom, TVA_MODIFIER_CAPTURES: '', PINLANE_TVA_MODIFIER_PORT: String(PORT + 1 + fil) },
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
  console.log(`tva-modifier-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const inconnues = seul.filter((nom) => !SCENARIOS[nom]);
  if (inconnues.length) { console.error(`tva-modifier-check : lettre inconnue ${inconnues.join(', ')}`); process.exit(2); }
  const navigateur = seul.some((nom) => !SANS_NAVIGATEUR.has(nom));
  const http = navigateur ? await FX.servir({ port: PORT, transformer }) : null;
  const browser = navigateur ? await chromium.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--lang=fr-BE'] }) : null;
  try {
    for (const nom of seul) await SCENARIOS[nom](browser); // eslint-disable-line no-await-in-loop
  } finally {
    if (browser) await browser.close();
    if (http) http.close();
  }
  console.log(`\ntva-modifier-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('tva-modifier-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

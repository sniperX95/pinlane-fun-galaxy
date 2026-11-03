// LE CATALOGUE SUR MESURE GERE PAR LE GERANT (2026-11-03, Activites & tarifs).
//
// Le gerant gere lui-meme ce que l equipe ajoute a un dossier (nourriture,
// boissons, gateaux...) : categories et articles, nom, prix, unite, heure a
// demander, propose ou masque, ordre. La section « Sur mesure » de Tarifs &
// formules (assets/pinlane-sur-mesure-settings.js) lit le catalogue ENTIER par
// GET /api/ops?action=surMesureGestion (droit Tarifs seul) et l ecrit par
// saveSurMesure, que le serveur relit et borne (lib/center-config.js).
//
// Ce gate monte le vrai api/ops.js sur la base en memoire du banc
// (scripts/reserver-banc.js), joue le vrai module de la console dans un bac, et
// fait l aller-retour entre les deux :
//   [R] la lecture du gerant : tout le catalogue, masques compris, et s il est
//       celui du centre ou le catalogue de depart ; refusee a qui reserve sans
//       le droit Tarifs, et a la portee « all ». Qui reserve lit toujours ce qui
//       se choisit, rien de plus.
//   [A] l aller-retour : le brouillon du module, enregistre tel quel puis
//       modifie (categorie et article neufs, renommage, prix, unite, heure,
//       masque, ordre), est accepte par le serveur et se relit a l identique ;
//       chaque saisie que le serveur refuse, le module la refuse avant l envoi,
//       sur le champ fautif.
//   [V] la vue de lecture : rien sans le droit, un centre a choisir, une seule
//       lecture, la panne et « Réessayer », les noms echappes.
//
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais
// touche), la ligne qui la prouve doit rougir.
//
// Zero reseau, zero base, rien ne part.
// Lancement : node scripts/sur-mesure-gestion-check.js [--contre-preuves]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const B = require('./reserver-banc.js');

const ROOT = B.ROOT;
const URL_OPS = '/api/ops';
const MODULE = 'assets/pinlane-sur-mesure-settings.js';

// ---------------------------------------------------------------------------
// La table des centres (sa config porte le catalogue), comme
// scripts/droits-niveaux-check.js.
// ---------------------------------------------------------------------------
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s === 'select settings from centers where id = $1 limit 1;') {
    const centre = B.base.centers.find((c) => c.id === params[0]);
    return centre ? { rows: [JSON.parse(JSON.stringify({ settings: centre.settings }))], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (s.startsWith('update centers set settings = jsonb_set(')) {
    const centre = B.base.centers.find((c) => c.id === params[0]);
    if (centre) centre.settings = { ...(centre.settings || {}), config: JSON.parse(params[1]) };
    return { rows: [], rowCount: centre ? 1 : 0 };
  }
  return queryDuBanc.call(this, sql, params);
};

const session = (permissions, { centre = 'libramont' } = {}) => ({ centerId: centre, member: { id: 'm-essai', name: 'Rachel' }, role: { id: 'essai', locked: false }, permissions });
const GERANT = () => session(['dashboard.view', 'pricing.manage']);
const RESERVE = () => session(['reservations.view', 'reservations.create', 'reservations.edit']);
const PLATEFORME = () => session(['platform.admin', 'pricing.manage']);

function verdicts() {
  const liste = [];
  const v = (cond, label, detail = '') => { liste.push({ ok: Boolean(cond), label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return Boolean(cond); };
  return { liste, v };
}

function monterServeur(mutations) {
  B.semer([]);
  B.base.centers = ['libramont', 'ciney'].map((id) => ({ id, name: id, status: 'active', timezone: 'Europe/Brussels', settings: {} }));
  const m = B.monter({ mutations, session: GERANT() });
  // Le journal bloquant (saveSurMesure) double avant le chargement d api/ops.js.
  const audit = require(path.join(ROOT, 'lib/audit-log.js'));
  audit.writeAuditLogOrThrow = async () => ({ ok: true });
  const ops = require(path.join(ROOT, 'api/ops.js'));
  m.get = async (s, action, centre = 'libramont') => { m.changerSession(s); return B.appeler(ops, 'GET', `${URL_OPS}?action=${action}${centre === null ? '' : `&centerId=${centre}`}`); };
  m.ecrire = async (s, surMesure, centre = 'libramont') => { m.changerSession(s); return B.appeler(ops, 'POST', URL_OPS, { action: 'saveSurMesure', centerId: centre, surMesure }); };
  return m;
}

// Le vrai module de la console, dans un bac. `apiRequest` se branche sur le vrai
// api/ops.js (aller-retour) ou sur des reponses posees a la main (vue).
function chargerModule(mutations, bac) {
  let src = fs.readFileSync(path.join(ROOT, MODULE), 'utf8').replace(/\r\n/g, '\n');
  for (const mutation of mutations.filter((mu) => mu.fichier === MODULE)) {
    if (src.split(mutation.de).length !== 2) throw new Error(`ancre absente ou multiple dans ${MODULE} : ${mutation.de.slice(0, 70)}`);
    src = src.replace(mutation.de, mutation.vers);
  }
  const contexte = {
    escapeHtml: (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, activeElement: null, contains: () => false },
    API_ENDPOINTS: { ops: '/api/ops' },
    isStaffPricingActive: () => true,
    ...bac,
  };
  contexte.window = contexte;
  vm.createContext(contexte);
  vm.runInContext(src, contexte, { filename: MODULE });
  return contexte;
}

const CATALOGUE = {
  categories: [{ id: 'nourriture', nom: 'Nourriture' }, { id: 'boissons', nom: 'Boissons' }, { id: 'cachee', nom: 'Hors saison', actif: false }],
  articles: [
    { id: 'pizza-margherita', nom: 'Pizza Margherita', categorie: 'nourriture', prix: 14, unite: 'piece', heure: true, actif: true },
    { id: 'frites', nom: 'Frites', categorie: 'nourriture', prix: 3.5, unite: 'joueur', heure: false, actif: true },
    { id: 'gaufre', nom: 'Gaufre', categorie: 'nourriture', prix: 4, unite: 'piece', heure: false, actif: false },
    { id: 'coca', nom: 'Coca 33 cl', categorie: 'boissons', prix: 2.8, unite: 'piece', heure: false, actif: true },
    { id: 'vin-chaud', nom: 'Vin chaud', categorie: 'cachee', prix: 4.5, unite: 'joueur', heure: false, actif: true },
  ],
};

// ---------------------------------------------------------------------------
// [R] LA LECTURE DU GERANT.
// ---------------------------------------------------------------------------
async function groupeLecture(mutations = []) {
  const { liste, v } = verdicts();
  const m = monterServeur(mutations);
  const config = require(path.join(ROOT, 'lib/center-config.js'));
  const carte = config.normalizeSurMesure(require(path.join(ROOT, 'ops-knowledge/centers.json')).centers.find((c) => c.id === 'libramont').surMesure);

  let r = await m.get(GERANT(), 'surMesureGestion', 'ciney');
  v(r.statut === 200 && r.json.parDefaut === true && JSON.stringify(r.json.surMesure) === JSON.stringify(config.catalogueSurMesureParDefaut()),
    '[R] un centre sans catalogue : le catalogue de depart, et la page le dit (parDefaut)', { statut: r.statut, parDefaut: r.json.parDefaut, message: r.json.message });
  r = await m.get(GERANT(), 'surMesureGestion');
  v(r.statut === 200 && r.json.parDefaut === false && JSON.stringify(r.json.surMesure) === JSON.stringify(carte) && r.json.surMesure.articles.length > 80,
    '[R] Libramont : sa carte entiere, telle qu elle est decidee', { statut: r.statut, n: r.json.surMesure && r.json.surMesure.articles.length });
  v(JSON.stringify(Object.keys(r.json).sort()) === '["centerId","ok","parDefaut","surMesure"]', '[R] la reponse ne porte que le catalogue, rien d autre de la configuration du centre', Object.keys(r.json));

  const ecrit = await m.ecrire(GERANT(), CATALOGUE);
  r = await m.get(GERANT(), 'surMesureGestion');
  const masques = r.json.surMesure ? r.json.surMesure.articles.filter((a) => a.actif === false).map((a) => a.id) : [];
  v(ecrit.statut === 200 && r.statut === 200 && r.json.parDefaut === false && JSON.stringify(r.json.surMesure) === JSON.stringify(config.normalizeSurMesure(CATALOGUE))
    && JSON.stringify(masques) === '["gaufre"]' && r.json.surMesure.categories.some((c) => c.id === 'cachee' && c.actif === false) && r.json.surMesure.articles.some((a) => a.id === 'vin-chaud'),
    '[R] apres enregistrement : tout le catalogue, la categorie masquee et l article masque compris', { ecrit: ecrit.statut, statut: r.statut, masques, json: r.json });
  const reserve = await m.get(RESERVE(), 'surMesureCatalogue');
  const ids = reserve.json.surMesure ? reserve.json.surMesure.articles.map((a) => a.id) : [];
  v(reserve.statut === 200 && JSON.stringify(ids) === '["pizza-margherita","frites","coca"]', '[R] qui reserve lit ce qui se choisit : ni l article masque, ni la categorie masquee', ids);

  r = await m.get(RESERVE(), 'surMesureGestion');
  v(r.statut === 403 && !r.json.surMesure, '[R] qui reserve sans le droit Tarifs ne lit pas le catalogue entier, 403', `${r.statut} ${r.json.message || ''}`);
  r = await m.get(session(['settings.manage', 'dashboard.view']), 'surMesureGestion');
  v(r.statut === 403 && !r.json.surMesure, '[R] le droit Parametres ne suffit pas, 403', `${r.statut} ${r.json.message || ''}`);
  r = await m.get(GERANT(), 'surMesureGestion', 'all');
  const plateforme = await m.get(PLATEFORME(), 'surMesureGestion', 'all');
  v(r.statut === 403 && plateforme.statut === 400 && /Choisissez un centre/.test(plateforme.json.message || '') && !r.json.surMesure && !plateforme.json.surMesure,
    '[R] la portee « all » ne lit aucun catalogue : refusee au centre, et la plateforme doit choisir un centre', { centre: `${r.statut} ${r.json.message || ''}`, plateforme: `${plateforme.statut} ${plateforme.json.message || ''}` });
  return liste;
}

// ---------------------------------------------------------------------------
// [A] L ALLER-RETOUR ENTRE LE MODULE ET LE SERVEUR.
// ---------------------------------------------------------------------------
async function groupeAllerRetour(mutations = []) {
  const { liste, v } = verdicts();
  const m = monterServeur(mutations);
  const config = require(path.join(ROOT, 'lib/center-config.js'));
  const bac = chargerModule(mutations, { getCurrentStaffCenterId: () => 'libramont', canUseStaffPermission: () => true });
  const { collecter, brouillonDe, idDepuisNom } = bac.PinlaneSurMesureSettings.__test;
  const serveurRefuse = (catalogue) => { try { config.normalizeSurMesure(catalogue, { strict: true }); return false; } catch (error) { return error.statusCode === 422; } };

  // Le catalogue de depart, enregistre sans rien toucher.
  const depart = config.catalogueSurMesureParDefaut();
  let envoi = collecter(brouillonDe(depart));
  let r = await m.ecrire(GERANT(), envoi, 'ciney');
  let relu = await m.get(GERANT(), 'surMesureGestion', 'ciney');
  v(r.statut === 200 && JSON.stringify(relu.json.surMesure) === JSON.stringify(config.normalizeSurMesure(depart)) && relu.json.parDefaut === false,
    '[A] le catalogue de depart enregistre sans rien toucher : accepte, relu a l identique, il devient celui du centre', { statut: `${r.statut} ${r.json.message || ''}`, parDefaut: relu.json.parDefaut });

  // Une vraie seance de gerant : une categorie et un article neufs, un renommage,
  // un prix, une unite, une heure, un masque, un ordre.
  await m.ecrire(GERANT(), CATALOGUE);
  const lu = await m.get(GERANT(), 'surMesureGestion');
  const brouillon = brouillonDe(lu.json.surMesure);
  const cat = (id) => brouillon.categories.find((c) => c.id === id);
  const art = (id) => brouillon.articles.find((a) => a.id === id);
  cat('boissons').nom = 'Boissons fraîches';
  cat('boissons').actif = false;
  art('pizza-margherita').nom = 'Pizza Margherita (30 cm)';
  art('pizza-margherita').prix = '15,50';
  art('frites').unite = 'piece';
  art('frites').heure = true;
  art('gaufre').actif = true;
  // Frites passe avant la pizza (le bouton « monter »).
  const iPizza = brouillon.articles.indexOf(art('pizza-margherita'));
  const iFrites = brouillon.articles.indexOf(art('frites'));
  [brouillon.articles[iPizza], brouillon.articles[iFrites]] = [brouillon.articles[iFrites], brouillon.articles[iPizza]];
  const neuve = { cle: 'c-neuve', id: '', nom: 'Gâteaux d’anniversaire', actif: true, neuf: true };
  brouillon.categories.push(neuve);
  brouillon.articles.push({ cle: 'a-neuf', id: '', nom: 'Gâteau chocolat (8 parts)', categorie: 'c-neuve', prix: '24', unite: 'piece', heure: true, actif: true, neuf: true });
  brouillon.articles.push({ cle: 'a-neuf-2', id: '', nom: 'Gâteau chocolat (8 parts)', categorie: 'c-neuve', prix: '0', unite: 'piece', heure: false, actif: true, neuf: true });
  // (une saisie que le module refuserait a tort laisse le catalogue d avant :
  // les lignes qui suivent le disent chacune)
  let refusDuModule = '';
  try { envoi = collecter(brouillon); } catch (error) { envoi = null; refusDuModule = error.message; }
  r = envoi ? await m.ecrire(GERANT(), envoi) : { statut: 0, json: { message: `refuse par le module : ${refusDuModule}` } };
  relu = await m.get(GERANT(), 'surMesureGestion');
  const rs = relu.json.surMesure || { categories: [], articles: [] };
  const rArt = (id) => rs.articles.find((a) => a.id === id) || {};
  v(r.statut === 200 && JSON.stringify(rs) === JSON.stringify(config.normalizeSurMesure(envoi)), '[A] la seance du gerant est acceptee et se relit telle qu envoyee', { statut: `${r.statut} ${r.json.message || ''}` });
  v(rs.categories.some((c) => c.id === 'boissons' && c.nom === 'Boissons fraîches' && c.actif === false), '[A] une categorie renommee et masquee garde son identifiant (les dossiers qui en ont gardent leurs lignes)', rs.categories);
  v(rArt('pizza-margherita').nom === 'Pizza Margherita (30 cm)' && rArt('pizza-margherita').prix === 15.5, '[A] un article renomme garde son identifiant, son prix tape avec une virgule est lu', rArt('pizza-margherita'));
  v(rArt('frites').unite === 'piece' && rArt('frites').heure === true && rArt('gaufre').actif === true, '[A] l unite, l heure et le retour d un article masque s ecrivent', [rArt('frites'), rArt('gaufre')]);
  v(rs.articles.filter((a) => a.categorie === 'nourriture').map((a) => a.id).join(',') === 'frites,pizza-margherita,gaufre', '[A] l ordre choisi est celui que Reserver proposera', rs.articles.map((a) => a.id));
  const neufs = rs.articles.filter((a) => a.categorie === 'gateaux-d-anniversaire').map((a) => a.id);
  v(rs.categories.some((c) => c.id === 'gateaux-d-anniversaire' && c.nom === 'Gâteaux d’anniversaire') && JSON.stringify(neufs) === '["gateau-chocolat-8-parts","gateau-chocolat-8-parts-2"]',
    '[A] une categorie et deux articles neufs : des identifiants lisibles et uniques, tires du nom', { categories: rs.categories.map((c) => c.id), neufs });

  // Chaque saisie que le serveur refuse, le module la refuse avant l envoi.
  const fautes = [
    ['un article sans nom', (b) => { b.articles[0].nom = '   '; }, /nom à chaque article/, ':nom'],
    ['un nom de 81 caracteres', (b) => { b.articles[0].nom = 'x'.repeat(81); }, /80 caractères au plus/, ':nom'],
    ['un prix negatif', (b) => { b.articles[0].prix = '-1'; }, /de 0 à 100 000 €/, ':prix'],
    ['un prix illisible', (b) => { b.articles[0].prix = 'douze'; }, /de 0 à 100 000 €/, ':prix'],
    ['un prix vide', (b) => { b.articles[0].prix = ''; }, /Mettez 0 pour un prix saisi au comptoir/, ':prix'],
    ['un prix au-dela de 100 000 €', (b) => { b.articles[0].prix = '100001'; }, /de 0 à 100 000 €/, ':prix'],
    ['une categorie sans nom', (b) => { b.categories[0].nom = ''; }, /nom à chaque catégorie/, ':nom'],
    ['31 categories', (b) => { for (let i = b.categories.length; i < 31; i += 1) b.categories.push({ cle: `c${i}`, id: '', nom: `C ${i}`, actif: true, neuf: true }); }, /30 catégories au plus/, null],
    ['401 articles', (b) => { for (let i = b.articles.length; i < 401; i += 1) b.articles.push({ cle: `a${i}`, id: '', nom: `A ${i}`, categorie: b.categories[0].cle, prix: '1', unite: 'piece', heure: false, actif: true, neuf: true }); }, /400 articles au plus/, null],
  ];
  for (const [nom, gater, phrase, champ] of fautes) {
    const b = brouillonDe(CATALOGUE);
    gater(b);
    let erreur = null;
    try { collecter(b); } catch (error) { erreur = error; }
    // Ce que le serveur recevrait si le module laissait passer.
    const brut = {
      categories: b.categories.map((c) => ({ id: c.id || `c-${c.cle}`.toLowerCase(), nom: String(c.nom).trim(), ...(c.actif ? {} : { actif: false }) })),
      articles: b.articles.map((a) => ({ id: a.id || `a-${a.cle}`.toLowerCase(), nom: String(a.nom).trim(), categorie: (b.categories.find((c) => c.cle === a.categorie) || {}).id || `c-${a.categorie}`.toLowerCase(), prix: a.prix === '' ? '' : Number(String(a.prix).replace(',', '.')), unite: a.unite, heure: a.heure, actif: a.actif })),
    };
    v(erreur && phrase.test(erreur.message) && (!champ || String(erreur.focus || '').endsWith(champ)) && serveurRefuse(brut),
      `[A] ${nom} : le module refuse avant l envoi, sur le champ fautif, comme le serveur`, { message: erreur && erreur.message, focus: erreur && erreur.focus, serveur: serveurRefuse(brut) });
  }
  const pris = new Set(['pizza']);
  const ids = [idDepuisNom('Pizza', pris, 'article'), idDepuisNom('  !!  ', pris, 'article'), idDepuisNom('Crêpe Suzette à l’orange', pris, 'article'), idDepuisNom('Pizza', pris, 'article')];
  v(JSON.stringify(ids) === '["pizza-2","article","crepe-suzette-a-l-orange","pizza-3"]' && ids.every((id) => /^[a-z0-9][a-z0-9_-]{0,59}$/.test(id)),
    '[A] un identifiant tire du nom : sans accent, unique, toujours lisible par le serveur', ids);
  return liste;
}

// ---------------------------------------------------------------------------
// [V] LA VUE DE LECTURE (l onglet « Sur mesure »).
// ---------------------------------------------------------------------------
async function groupeVue(mutations = []) {
  const { liste, v } = verdicts();
  const appels = [];
  const attentes = [];
  const etat = { droit: true, centre: 'libramont', rendus: 0 };
  const bac = chargerModule(mutations, {
    getCurrentStaffCenterId: () => etat.centre,
    canUseStaffPermission: (p) => etat.droit && p === 'pricing.manage',
    apiRequest: (url) => { appels.push(url); return new Promise((ok, ko) => attentes.push({ ok, ko })); },
    renderStaffPricingPage: () => { etat.rendus += 1; },
  });
  const sm = bac.PinlaneSurMesureSettings;
  const souffle = () => new Promise((fin) => setImmediate(fin));
  const repondre = (valeur, echec = null) => { while (attentes.length) { const a = attentes.shift(); if (echec) a.ko(echec); else a.ok(valeur); } };

  etat.droit = false;
  let html = sm.renderSection();
  v(/se gère avec le droit Tarifs/.test(html) && !appels.length && !/data-sm-action="ouvrir"/.test(html), '[V] sans le droit Tarifs : une phrase, aucune lecture, aucun bouton', { html: html.slice(0, 120), appels });
  sm.charger(true);
  v(!appels.length, '[V] sans le droit Tarifs, meme un appel direct de la lecture ne lit rien', appels);
  etat.droit = true;
  etat.centre = 'all';
  html = sm.renderSection();
  v(/Choisissez un centre/.test(html) && !appels.length, '[V] la portee « all » : choisir un centre, aucune lecture', appels);
  etat.centre = 'libramont';
  html = sm.renderSection();
  sm.renderSection();
  v(/Chargement du catalogue/.test(html) && appels.length === 1 && appels[0] === '/api/ops?action=surMesureGestion&centerId=libramont' && sm.compte() === undefined,
    '[V] une seule lecture pour deux rendus, et l onglet ne compte rien tant qu il n a rien lu', { appels, compte: sm.compte() });
  repondre({ ok: true, centerId: 'libramont', parDefaut: false, surMesure: { ...CATALOGUE, articles: [...CATALOGUE.articles, { id: 'piege', nom: 'Tarte <img src=x onerror=alert(1)>', categorie: 'boissons', prix: 0, unite: 'piece', heure: false, actif: true }] } });
  await souffle();
  html = sm.renderSection();
  v(etat.rendus >= 1 && sm.compte() === 6 && /6 articles · 3 catégories · 1 masqué/.test(html), '[V] la lecture redessine la page, l onglet compte 6 articles', { rendus: etat.rendus, compte: sm.compte(), html: html.slice(0, 300) });
  v(/Hors saison<\/strong>[\s\S]*?Masquée/.test(html) && /Gaufre <span class="pv2-chip">Masqué<\/span>/.test(html), '[V] une categorie et un article masques se voient comme tels', html.slice(0, 600));
  v(/Pizza Margherita/.test(html) && /14 €/.test(html) && /3,50 €/.test(html) && /au comptoir/.test(html) && /par joueur/.test(html) && /heure demandée/.test(html),
    '[V] chaque article dit son prix (ou « au comptoir »), son unite, son heure', html.slice(0, 800));
  v(html.includes('Tarte &lt;img src=x onerror=alert(1)&gt;') && !html.includes('<img'), '[V] un nom d article est echappe, jamais du HTML');
  v((html.match(/class="pv2-btn[^"]*primary/g) || []).length === 0 && /data-sm-action="ouvrir"/.test(html), '[V] la vue n a pas de bouton plein : « Modifier le catalogue » est secondaire', html.match(/<button[^>]*>/g));
  // La panne, puis « Réessayer ».
  etat.centre = 'ciney';
  html = sm.renderSection();
  repondre(null, new Error('Le serveur ne répond pas.'));
  await souffle();
  html = sm.renderSection();
  const avant = appels.length;
  sm.renderSection();
  v(/Catalogue indisponible : Le serveur ne répond pas\./.test(html) && /data-sm-action="relire"/.test(html) && appels.length === avant, '[V] une panne se dit avec « Réessayer », et ne se relit pas a chaque rendu', { html: html.slice(0, 200), relus: appels.length - avant });
  sm.charger(true);
  v(appels.length === avant + 1 && appels[appels.length - 1] === '/api/ops?action=surMesureGestion&centerId=ciney', '[V] « Réessayer » relit', appels.slice(-1));
  repondre({ ok: true, centerId: 'ciney', parDefaut: true, surMesure: { categories: [{ id: 'nourriture', nom: 'Nourriture' }], articles: [] } });
  await souffle();
  html = sm.renderSection();
  v(/Catalogue de départ proposé par Pinlane/.test(html) && /Aucun article\./.test(html), '[V] un centre au catalogue de depart le lit, et une categorie vide le dit', html.slice(0, 400));
  const textes = fs.readFileSync(path.join(ROOT, MODULE), 'utf8');
  v(!/[\u2013\u2014]/.test(textes), '[V] le module ne porte ni tiret cadratin ni demi-cadratin');
  return liste;
}

// ---------------------------------------------------------------------------
// LES GROUPES ET LEURS CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const GROUPES = { groupeLecture, groupeAllerRetour, groupeVue };
const OPS = 'api/ops.js';

const CONTRE_PREUVES = [
  { nom: 'le catalogue entier ouvert a qui reserve', groupe: 'groupeLecture', attendu: /qui reserve sans le droit Tarifs/, fichier: OPS, de: "    if (action === 'surMesureGestion') return 'pricing.manage';", vers: "    if (action === 'surMesureGestion') return ['reservations.create', 'reservations.edit', 'pricing.manage'];" },
  { nom: 'la portee all acceptee', groupe: 'groupeLecture', attendu: /la portee « all » ne lit aucun catalogue/, fichier: OPS, de: "    if (!centerId || centerId === 'all') throw createHttpError('Choisissez un centre pour gérer son catalogue sur mesure.', 400, true);\n", vers: '' },
  { nom: 'le gerant lit ce qui se choisit', groupe: 'groupeLecture', attendu: /la categorie masquee et l article masque compris/, fichier: OPS, de: '    sendJson(res, 200, { ok: true, centerId, ...catalogueSurMesureAGerer(centerId) });', vers: '    sendJson(res, 200, { ok: true, centerId, ...catalogueSurMesureAGerer(centerId), surMesure: surMesureChoisissable(catalogueSurMesure(centerId)) });' },
  { nom: 'le catalogue de depart pris pour celui du centre', groupe: 'groupeLecture', attendu: /un centre sans catalogue : le catalogue de depart/, fichier: 'lib/center-config.js', de: '  return { parDefaut: !decide, surMesure: decide || catalogueSurMesureParDefaut() };', vers: '  return { parDefaut: false, surMesure: decide || catalogueSurMesureParDefaut() };' },
  { nom: 'la configuration du centre renvoyee', groupe: 'groupeLecture', attendu: /ne porte que le catalogue/, fichier: OPS, de: '    sendJson(res, 200, { ok: true, centerId, ...catalogueSurMesureAGerer(centerId) });', vers: "    sendJson(res, 200, { ok: true, centerId, ...catalogueSurMesureAGerer(centerId), config: require('../lib/ops-knowledge').getCenter(centerId) });" },
  { nom: 'le masque d une categorie perdu a l envoi', groupe: 'groupeAllerRetour', attendu: /renommee et masquee garde son identifiant/, fichier: MODULE, de: '      return categorie.actif ? { id, nom } : { id, nom, actif: false };', vers: '      return { id, nom };' },
  { nom: 'un renommage change l identifiant', groupe: 'groupeAllerRetour', attendu: /renommee et masquee garde son identifiant/, fichier: MODULE, de: "      const id = categorie.neuf ? idDepuisNom(nom, pris, 'categorie') : categorie.id;", vers: "      const id = idDepuisNom(nom, pris, 'categorie');" },
  { nom: 'le prix tape avec une virgule perdu', groupe: 'groupeAllerRetour', attendu: /prix tape avec une virgule est lu/, fichier: MODULE, de: "      const brut = String(article.prix ?? '').replace(',', '.').trim();", vers: "      const brut = String(article.prix ?? '').trim();" },
  { nom: 'le prix non verifie', groupe: 'groupeAllerRetour', attendu: /un prix negatif : le module refuse/, fichier: MODULE, de: '      if (!Number.isFinite(prix) || prix < 0 || prix > PRIX_MAX) throw', vers: '      if (!Number.isFinite(prix)) throw' },
  { nom: 'un prix vide pris pour zero', groupe: 'groupeAllerRetour', attendu: /un prix vide : le module refuse/, fichier: MODULE, de: "      const prix = brut === '' ? NaN : Number(brut);", vers: '      const prix = Number(brut);' },
  { nom: 'le nom non borne', groupe: 'groupeAllerRetour', attendu: /un nom de 81 caracteres/, fichier: MODULE, de: '      if (nom.length > MAX_NOM) throw faute(`Article', vers: '      if (false) throw faute(`Article' },
  { nom: 'deux articles neufs au meme identifiant', groupe: 'groupeAllerRetour', attendu: /des identifiants lisibles et uniques/, fichier: MODULE, de: '    while (pris.has(id)) { id = `${racine.slice(0, 50)}-${n}`; n += 1; }', vers: '' },
  { nom: 'plus de 30 categories envoyees', groupe: 'groupeAllerRetour', attendu: /31 categories/, fichier: MODULE, de: '    if (brouillon.categories.length > MAX_CATEGORIES) throw faute(`${MAX_CATEGORIES} catégories au plus.`);\n', vers: '' },
  { nom: 'la vue sans le droit', groupe: 'groupeVue', attendu: /sans le droit Tarifs : une phrase, aucune lecture/, fichier: MODULE, de: '    if (!peutGerer()) {\n      return `<section', vers: '    if (false) {\n      return `<section' },
  { nom: 'la lecture sans le droit', groupe: 'groupeVue', attendu: /meme un appel direct de la lecture ne lit rien/, fichier: MODULE, de: "    if (!id || id === 'all' || !peutGerer() || typeof apiRequest !== 'function') return;", vers: "    if (!id || id === 'all' || typeof apiRequest !== 'function') return;" },
  { nom: 'une lecture par rendu', groupe: 'groupeVue', attendu: /une seule lecture pour deux rendus/, fichier: MODULE, de: "    if (!force && lecture.centre === id && (lecture.etat === 'ok' || lecture.etat === 'charge')) return;\n", vers: '' },
  { nom: 'une panne relue a chaque rendu', groupe: 'groupeVue', attendu: /ne se relit pas a chaque rendu/, fichier: MODULE, de: "    if (!force && lecture.centre === id && lecture.etat === 'erreur') return;\n", vers: '' },
  { nom: 'un nom d article non echappe', groupe: 'groupeVue', attendu: /un nom d article est echappe/, fichier: MODULE, de: '        <span class="sm-nom">${esc(article.nom)}', vers: '        <span class="sm-nom">${article.nom}' },
  { nom: 'un article masque montre comme propose', groupe: 'groupeVue', attendu: /se voient comme tels/, fichier: MODULE, de: "${article.actif === false ? ' <span class=\"pv2-chip\">Masqué</span>' : ''}", vers: '' },
];

process.on('beforeExit', () => {
  console.error('FAIL  sur-mesure-gestion-check s est arrete avant son bilan : une promesse jamais tenue');
  process.exit(1);
});

async function main() {
  const contrePreuves = process.argv.includes('--contre-preuves');
  let echecs = 0;
  if (!contrePreuves) {
    for (const [nom, groupe] of Object.entries(GROUPES)) {
      const liste = await groupe();
      liste.forEach(({ ok, label, detail }) => {
        console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`);
        if (!ok) echecs += 1;
      });
      if (!liste.length) { console.log(`FAIL  ${nom} n a rien verifie`); echecs += 1; }
    }
    B.sortir('sur-mesure-gestion-check', echecs, 'le gerant lit et ecrit tout son catalogue, le serveur le borne, le module refuse ce que le serveur refuserait.');
    return;
  }
  for (const c of CONTRE_PREUVES) {
    const liste = await GROUPES[c.groupe]([{ fichier: c.fichier, de: c.de, vers: c.vers }]).catch((error) => [{ ok: false, label: `exception : ${error.message}`, detail: '' }]);
    const rouges = liste.filter((x) => !x.ok);
    const mord = rouges.some((x) => c.attendu.test(x.label));
    console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve « ${c.nom} » : ${mord ? 'le gate rougit' : `AUCUN ROUGE ATTENDU (${rouges.length} rouge(s) : ${rouges.slice(0, 2).map((x) => x.label).join(' | ') || 'aucun'})`}`);
    if (!mord) echecs += 1;
  }
  B.sortir('sur-mesure-gestion-check --contre-preuves', echecs, `${CONTRE_PREUVES.length} gardes retirees une a une, chacune fait rougir sa ligne.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

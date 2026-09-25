// UN CHANGEMENT FAIT SUR UN POSTE EST SERVI PARTOUT, SANS ATTENDRE 30 SECONDES.
//
// Ce que ce gate mesure, et pourquoi.
//
// Quatre caches gardent leur lecture 30 s dans la memoire de chaque fonction
// Vercel : le catalogue (catalog-store), la configuration des centres
// (ops-knowledge), les prix par centre (booking-config) et les blocages
// (availability-blocks). Une ecriture passe par api/ops et ne rafraichit que la
// memoire de api/ops : le tunnel client, le planning et le deuxieme poste
// continuaient de servir l ancien etat jusqu a 30 s. Chaque cache se verifie
// desormais contre une empreinte de ses tables (lib/cache-empreintes).
//
// LES PROPRIETES, sur les vraies fonctions, avec un faux pool qui journalise
// chaque requete dans l ordre et une horloge controlee :
//
//   [A] LA PREMIERE LECTURE CHARGE, ET LIT L EMPREINTE AVANT LES DONNEES. Dans
//       l autre ordre, une ecriture glissee entre les deux rangerait une
//       donnee perimee sous une empreinte a jour : le cache ne se relirait plus.
//   [B] DANS LE DELAI, EMPREINTE STABLE : LE CACHE SERT, SANS RELIRE. Sinon on
//       aurait remplace un cache de 30 s par une lecture complete a chaque appel.
//   [C] DANS LE DELAI, EMPREINTE CHANGEE : LE CACHE SE RELIT TOUT DE SUITE.
//       C est le defaut corrige : sans cette regle, 30 s de retard.
//   [D] EMPREINTE ILLISIBLE : LE CACHE RETOMBE SUR SON DELAI D AVANT. Pas de
//       relecture a chaque appel pendant une panne, pas d exception.
//   [E] UNE REQUETE HTTP NE PAIE QU UNE EMPREINTE. Les quatre rafraichissements
//       qui se suivent partagent la meme lecture.
//   [F] JAMAIS SUR UN CLIENT DE TRANSACTION. Une requete qui echouerait dans une
//       transaction la rendrait inutilisable (« current transaction is aborted »).
//   [G] LES BLOCAGES SE COMPARENT PAR CENTRE. Un blocage pose a Gembloux ne fait
//       pas relire ceux de Libramont.
//   [H] UNE ECRITURE LOCALE (force) RELIT, ET SON EMPREINTE EST FRAICHE. Une
//       empreinte partagee lue juste avant l ecriture serait rangee a tort.
//
// CONTRE-EPREUVES PAR MUTATION, compilees en memoire (crochet sur
// Module.prototype._compile) : le disque n est jamais touche.
//
// Usage : node scripts/cache-empreintes-check.js
'use strict';
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LES MODULES MESURES, mutables en memoire, recharges a neuf par scenario
// (leurs caches sont des variables de module).
// ---------------------------------------------------------------------------
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};

function modulesNeufs() {
  for (const cle of Object.keys(require.cache)) {
    if (cle.startsWith(path.join(ROOT, 'lib') + path.sep)) delete require.cache[cle];
  }
  return {
    catalogue: require(path.join(ROOT, 'lib/catalog-store.js')),
    centres: require(path.join(ROOT, 'lib/ops-knowledge.js')),
    prix: require(path.join(ROOT, 'lib/booking-config.js')),
    blocages: require(path.join(ROOT, 'lib/availability-blocks.js')),
  };
}

// L horloge : les modules lisent Date.now() a chaque appel.
const dateNowOrigine = Date.now;
let horloge = 1_000_000_000;
Date.now = () => horloge;
function avancer(ms) { horloge += ms; }

// ---------------------------------------------------------------------------
// LE FAUX POOL : chaque requete est rangee par nature, dans l ordre.
// ---------------------------------------------------------------------------
function fauxPool({ transaction = false } = {}) {
  const etat = {
    empreintes: { centres: 'c1', surcharges: 's1', catalogue: 'k1', blocages: { libramont: 'b1' } },
    empreinteIllisible: false,
    journal: [],
  };
  function nature(sql) {
    if (/empreintes-caches/.test(sql)) return 'empreinte';
    if (/from formulas;/.test(sql)) return 'catalogue';
    if (/from formula_steps|from activities;|select id, client_id from centers;/.test(sql)) return 'catalogue-suite';
    if (/select id, name, status, timezone, settings from centers;/.test(sql)) return 'centres';
    if (/from formule_overrides/.test(sql)) return 'surcharges';
    if (/from availability_blocks/.test(sql)) return 'blocages';
    return 'autre';
  }
  const pool = {
    etat,
    async query(sql, params) {
      const quoi = nature(String(sql));
      etat.journal.push(quoi === 'blocages' ? `blocages:${params && params[0]}` : quoi);
      if (quoi === 'empreinte') {
        if (etat.empreinteIllisible) throw new Error('relation absente');
        return { rows: [{ ...etat.empreintes, blocages: { ...etat.empreintes.blocages } }] };
      }
      return { rows: [] };
    },
  };
  if (transaction) pool.release = () => {};
  return pool;
}
const compter = (pool, quoi) => pool.etat.journal.filter((q) => q === quoi).length;

// Les quatre rafraichissements comme les enchaine une requete du tunnel.
async function rafraichirTout(m, pool) {
  await m.centres.refreshCenterOverrides(pool);
  await m.prix.refreshFormuleOverrides(pool);
  await m.catalogue.refreshCatalog(pool);
  await m.blocages.loadAvailabilityBlocks(pool, 'libramont');
}

async function scenarioPrincipal(m) {
  const pool = fauxPool();
  const mesures = {};
  // [A] premiere lecture
  await m.catalogue.refreshCatalog(pool);
  mesures.premiere = pool.etat.journal.slice();
  // [B] dans le delai, rien n a bouge
  avancer(1000);
  pool.etat.journal.length = 0;
  await m.catalogue.refreshCatalog(pool);
  mesures.stable = pool.etat.journal.slice();
  // [C] dans le delai, le catalogue a bouge ailleurs
  avancer(1000);
  pool.etat.empreintes.catalogue = 'k2';
  pool.etat.journal.length = 0;
  await m.catalogue.refreshCatalog(pool);
  mesures.change = pool.etat.journal.slice();
  // puis de nouveau stable : pas de relecture en boucle
  avancer(1000);
  pool.etat.journal.length = 0;
  await m.catalogue.refreshCatalog(pool);
  mesures.apres = pool.etat.journal.slice();
  return mesures;
}

(async () => {
  // =====================================================================
  console.log('[A][B][C] le catalogue se verifie contre la base');
  // =====================================================================
  const principal = await scenarioPrincipal(modulesNeufs());
  const iEmpreinte = principal.premiere.indexOf('empreinte');
  const iDonnees = principal.premiere.indexOf('catalogue');
  ok(iDonnees >= 0, '[A] la premiere lecture charge le catalogue', principal.premiere.join(','));
  ok(iEmpreinte >= 0 && iEmpreinte < iDonnees, '[A] et lit l empreinte AVANT les donnees', principal.premiere.join(','));
  ok(principal.stable.join(',') === 'empreinte', '[B] dans le delai, empreinte stable : une empreinte, aucune relecture', principal.stable.join(','));
  ok(principal.change.includes('catalogue'), '[C] dans le delai, empreinte changee : le catalogue se relit TOUT DE SUITE', principal.change.join(','));
  ok(principal.apres.join(',') === 'empreinte', '[C] puis se tait tant que rien ne bouge', principal.apres.join(','));

  // Les trois autres caches suivent la meme regle.
  {
    const m = modulesNeufs();
    const pool = fauxPool();
    await m.centres.refreshCenterOverrides(pool);
    await m.prix.refreshFormuleOverrides(pool);
    avancer(1000);
    pool.etat.journal.length = 0;
    await m.centres.refreshCenterOverrides(pool);
    await m.prix.refreshFormuleOverrides(pool);
    const stables = compter(pool, 'centres') + compter(pool, 'surcharges');
    avancer(1000);
    pool.etat.empreintes.centres = 'c2';
    pool.etat.empreintes.surcharges = 's2';
    pool.etat.journal.length = 0;
    await m.centres.refreshCenterOverrides(pool);
    avancer(1000);
    await m.prix.refreshFormuleOverrides(pool);
    ok(stables === 0, '[B] configuration et prix : empreinte stable, aucune relecture', `${stables} relecture(s)`);
    ok(compter(pool, 'centres') === 1, '[C] configuration des centres changee : relue tout de suite', pool.etat.journal.join(','));
    ok(compter(pool, 'surcharges') === 1, '[C] prix d un centre changes : relus tout de suite', pool.etat.journal.join(','));
  }

  // =====================================================================
  console.log('\n[D] une empreinte illisible retombe sur le delai');
  // =====================================================================
  {
    const m = modulesNeufs();
    const pool = fauxPool();
    await m.catalogue.refreshCatalog(pool);
    pool.etat.empreinteIllisible = true;
    avancer(1000);
    pool.etat.journal.length = 0;
    let exception = null;
    try { await m.catalogue.refreshCatalog(pool); } catch (error) { exception = error; }
    ok(!exception, '[D] aucune exception ne remonte', exception ? exception.message : '');
    ok(compter(pool, 'catalogue') === 0, '[D] dans le delai, pas de relecture a chaque appel pendant la panne', pool.etat.journal.join(','));
    avancer(31_000);
    pool.etat.journal.length = 0;
    await m.catalogue.refreshCatalog(pool);
    ok(compter(pool, 'catalogue') === 1, '[D] et une fois le delai passe, la relecture reprend comme avant', pool.etat.journal.join(','));
  }

  // =====================================================================
  console.log('\n[E] une requete HTTP ne paie qu une empreinte');
  // =====================================================================
  {
    const m = modulesNeufs();
    const pool = fauxPool();
    await rafraichirTout(m, pool);
    avancer(1000);
    pool.etat.journal.length = 0;
    await rafraichirTout(m, pool); // l horloge ne bouge pas : une meme requete
    ok(compter(pool, 'empreinte') === 1, '[E] quatre caches verifies, une seule lecture d empreinte', pool.etat.journal.join(','));
    ok(pool.etat.journal.length === 1, '[E] et rien d autre n est relu', pool.etat.journal.join(','));
  }

  // =====================================================================
  console.log('\n[F] jamais sur un client de transaction');
  // =====================================================================
  {
    const m = modulesNeufs();
    const client = fauxPool({ transaction: true });
    await m.centres.refreshCenterOverrides(client, { force: true });
    await m.catalogue.refreshCatalog(client, { force: true });
    ok(compter(client, 'empreinte') === 0, '[F] aucune empreinte lue sur un client de transaction', client.etat.journal.join(','));
    ok(compter(client, 'centres') === 1 && compter(client, 'catalogue') === 1, '[F] et le rechargement force a bien lieu', client.etat.journal.join(','));
  }

  // =====================================================================
  console.log('\n[G] les blocages se comparent par centre');
  // =====================================================================
  {
    const m = modulesNeufs();
    const pool = fauxPool();
    await m.blocages.loadAvailabilityBlocks(pool, 'libramont');
    await m.blocages.loadAvailabilityBlocks(pool, 'gembloux');
    avancer(1000);
    pool.etat.empreintes.blocages = { libramont: 'b1', gembloux: 'g1' };
    pool.etat.journal.length = 0;
    await m.blocages.loadAvailabilityBlocks(pool, 'libramont');
    await m.blocages.loadAvailabilityBlocks(pool, 'gembloux');
    ok(!pool.etat.journal.includes('blocages:libramont'), '[G] un blocage pose a Gembloux ne fait pas relire Libramont', pool.etat.journal.join(','));
    ok(pool.etat.journal.includes('blocages:gembloux'), '[G] et Gembloux, lui, se relit tout de suite', pool.etat.journal.join(','));
  }

  // =====================================================================
  console.log('\n[H] une ecriture locale relit avec une empreinte fraiche');
  // =====================================================================
  {
    const m = modulesNeufs();
    const pool = fauxPool();
    await m.catalogue.refreshCatalog(pool);
    avancer(1000);
    await m.catalogue.refreshCatalog(pool); // empreinte partagee k1 en memoire
    pool.etat.empreintes.catalogue = 'k2'; // l ecriture de ce poste
    pool.etat.journal.length = 0;
    await m.catalogue.refreshCatalog(pool, { force: true }); // meme instant
    ok(compter(pool, 'catalogue') === 1, '[H] la relecture forcee a lieu', pool.etat.journal.join(','));
    ok(compter(pool, 'empreinte') === 1, '[H] avec une empreinte relue, pas celle d avant l ecriture', pool.etat.journal.join(','));
    avancer(1000);
    pool.etat.journal.length = 0;
    await m.catalogue.refreshCatalog(pool);
    ok(compter(pool, 'catalogue') === 0, '[H] et l appel suivant ne relit pas une seconde fois', pool.etat.journal.join(','));
  }

  // =====================================================================
  console.log('\n[MUTATION] le gate sait-il rougir ?');
  // =====================================================================
  const contreEpreuves = [
    {
      nom: 'le catalogue ne se verifie plus dans le delai',
      fichier: 'lib/catalog-store.js',
      de: "    if (!empreinte || empreinte === catalogueEmpreinte) return false;",
      vers: '    return false;',
      rejouer: async () => (await scenarioPrincipal(modulesNeufs())).change.includes('catalogue'),
      attendu: (relu) => relu === true,
      libelle: 'un prix change ailleurs resterait faux 30 s',
    },
    {
      nom: 'l empreinte est lue apres les donnees',
      fichier: 'lib/catalog-store.js',
      de: "  const empreinte = await empreinteDe(pool, 'catalogue', { frais: true });\n  catalogueEmpreinte = empreinte;\n  try {\n    const state = await loadCatalogState(pool);",
      vers: "  try {\n    const state = await loadCatalogState(pool);\n    catalogueEmpreinte = await empreinteDe(pool, 'catalogue', { frais: true });",
      rejouer: async () => {
        const premiere = (await scenarioPrincipal(modulesNeufs())).premiere;
        return premiere.indexOf('empreinte') < premiere.indexOf('catalogue');
      },
      attendu: (avant) => avant === true,
      libelle: 'une ecriture glissee entre les deux figerait une donnee perimee',
    },
    {
      nom: 'la lecture partagee disparait',
      fichier: 'lib/cache-empreintes.js',
      de: '  if (!frais && memo && maintenant - memo.at < MEMO_MS) return memo.promesse;',
      vers: '',
      rejouer: async () => {
        const m = modulesNeufs();
        const pool = fauxPool();
        await rafraichirTout(m, pool);
        avancer(1000);
        pool.etat.journal.length = 0;
        await rafraichirTout(m, pool);
        return compter(pool, 'empreinte');
      },
      attendu: (n) => n === 1,
      libelle: 'chaque requete du tunnel paierait quatre lectures au lieu d une',
    },
    {
      nom: 'un client de transaction est interroge',
      fichier: 'lib/cache-empreintes.js',
      de: "  return Boolean(pool && typeof pool.query === 'function' && typeof pool.release !== 'function');",
      vers: "  return Boolean(pool && typeof pool.query === 'function');",
      rejouer: async () => {
        const m = modulesNeufs();
        const client = fauxPool({ transaction: true });
        await m.catalogue.refreshCatalog(client, { force: true });
        return compter(client, 'empreinte');
      },
      attendu: (n) => n === 0,
      libelle: 'une empreinte qui echoue avorterait la transaction de l ecriture',
    },
    {
      nom: 'les blocages se comparent tous centres confondus',
      fichier: 'lib/cache-empreintes.js',
      de: '  const valeur = ligne.blocages[String(centerId || \'\')];',
      vers: '  const valeur = JSON.stringify(ligne.blocages);',
      rejouer: async () => {
        const m = modulesNeufs();
        const pool = fauxPool();
        await m.blocages.loadAvailabilityBlocks(pool, 'libramont');
        avancer(1000);
        pool.etat.empreintes.blocages = { libramont: 'b1', gembloux: 'g1' };
        pool.etat.journal.length = 0;
        await m.blocages.loadAvailabilityBlocks(pool, 'libramont');
        return pool.etat.journal.includes('blocages:libramont');
      },
      attendu: (relu) => relu === false,
      libelle: 'chaque blocage d un centre ferait relire tous les autres',
    },
    {
      nom: 'la relecture forcee reprend l empreinte partagee',
      fichier: 'lib/catalog-store.js',
      de: "  const empreinte = await empreinteDe(pool, 'catalogue', { frais: true });",
      vers: "  const empreinte = await empreinteDe(pool, 'catalogue');",
      rejouer: async () => {
        const m = modulesNeufs();
        const pool = fauxPool();
        await m.catalogue.refreshCatalog(pool);
        avancer(1000);
        await m.catalogue.refreshCatalog(pool);
        pool.etat.empreintes.catalogue = 'k2';
        await m.catalogue.refreshCatalog(pool, { force: true });
        avancer(1000);
        pool.etat.journal.length = 0;
        await m.catalogue.refreshCatalog(pool);
        return compter(pool, 'catalogue');
      },
      attendu: (n) => n === 0,
      libelle: 'l empreinte d avant l ecriture serait rangee avec les donnees d apres',
    },
    {
      nom: 'une empreinte illisible fait relire a chaque appel',
      fichier: 'lib/catalog-store.js',
      de: "    if (!empreinte || empreinte === catalogueEmpreinte) return false;",
      vers: "    if (empreinte === catalogueEmpreinte) return false;",
      rejouer: async () => {
        const m = modulesNeufs();
        const pool = fauxPool();
        await m.catalogue.refreshCatalog(pool);
        pool.etat.empreinteIllisible = true;
        avancer(1000);
        pool.etat.journal.length = 0;
        await m.catalogue.refreshCatalog(pool);
        return compter(pool, 'catalogue');
      },
      attendu: (n) => n === 0,
      libelle: 'une panne de l empreinte relirait tout le catalogue a chaque requete',
    },
  ];

  for (const contre of contreEpreuves) {
    mutations = [{ fichier: contre.fichier, de: contre.de, vers: contre.vers }];
    let verdict = false;
    let mesure = '';
    try {
      const r = await contre.rejouer();
      mesure = String(r);
      verdict = !contre.attendu(r);
    } catch (error) {
      verdict = false;
      mesure = `exception : ${error.message}`;
    }
    mutations = [];
    ok(verdict, `[mutation] « ${contre.nom} » : ${contre.libelle} (le gate ROUGIRAIT)`, mesure);
  }
  ok(mutations.length === 0, '[mutation] aucune mutation ne survit');

  Date.now = dateNowOrigine;
  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nTous les controles passent.');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  Date.now = dateNowOrigine;
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

// LE SOCLE LIVRE DANS LE CODE APPARTIENT A UN CLIENT (2026-08-21).
//
// MOVSAR : « il faut que tu commences vraiment a voir le projet
// commercialisable, tous les centres doivent avoir leur propre systeme, leur
// propre activite, rien ne doit interferer. Ici pour N4 il doit rien avoir
// comme activite ou quoi de Fun Galaxy, et ca pour tous les centres que je vais
// creer aussi. »
//
// CE QUE LE CODE FAISAIT, mesure avant d y toucher : `ops-knowledge/
// formulas.json`, `ops-knowledge/activities.json` et `lib/booking-config
// FORMULES` sont livres DANS LE DEPOT et servent de socle a TOUTE entreprise.
// Or ce socle n est pas generique : ce sont les 14 formules de Fun Galaxy
// (FORMULE 1 a 8, MATIN MALIN, CRAZY STUDENT STRIKE, HAPPY LASER AND GAME...)
// et ses 12 activites (laser game, minigolf blacklight, karting VR, golf
// o Clock, fun run...). Tout nouveau client heritait donc du catalogue du
// premier. Etat mesure en base le 2026-08-21 : N4 portait 14 lignes
// `source=seed, active=false` dont le seul role etait de DESACTIVER une par une
// les formules de Fun Galaxy, et MI12, qui n en a aucune, les voyait toutes.
//
// LA REGLE POSEE ICI : le socle fichier est la PROPRIETE du client qui l a
// apporte. Une autre entreprise ne le voit pas, meme pas pour le refuser. Elle
// part d un catalogue VIDE et n a que ce qu elle cree.
//
// CE QUE CE GATE MESURE : le VRAI lib/catalog-store, avec une base en memoire
// qui porte exactement les portees de la production. Aucune reformulation de la
// regle : on appelle listBookingFormules / listActivities comme le font
// api/public-booking-meta et la console.
//
// Lancement : node scripts/catalog-seed-ownership-check.js

const path = require('path');

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';

const ROOT = path.resolve(__dirname, '..');

let failures = 0;
let assertions = 0;
function section(title) { console.log(`\n${title}`); }
function ok(condition, label, detail = '') {
  assertions += 1;
  if (condition) { console.log(`  [OK] ${label}`); return true; }
  failures += 1;
  console.log(`  [FAIL] ${label}${detail ? ` (${detail})` : ''}`);
  return false;
}

// Le gate n a besoin d aucune base : applyCatalogState prend l etat deja lu.
class FakePool {
  async query() { return { rows: [], rowCount: 0 }; }
  async connect() { return { query: async () => ({ rows: [], rowCount: 0 }), release() {} }; }
  async end() {}
  on() {}
}
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };

const catalogStore = require(path.join(ROOT, 'lib', 'catalog-store.js'));
const { FORMULES } = require(path.join(ROOT, 'lib', 'booking-config.js'));
const ACTIVITIES_FILE = require(path.join(ROOT, 'ops-knowledge', 'activities.json'));

const SEED_FORMULA_IDS = FORMULES.map((f) => f.id);
const SEED_ACTIVITY_IDS = (ACTIVITIES_FILE.activities || []).map((a) => a.id);

// Les portees REELLES de la production au 2026-08-21.
const SEED_OWNER = 'fungalaxy';
const CENTER_SEED = 'libramont';
const CENTER_OTHER = 'n4-bowling';
const CENTER_EMPTY = 'mi12';

// Etat de catalogue injecte, AU FORMAT DES LIGNES SQL (applyCatalogState les
// normalise comme celles que la base rend : owner_client_id, center_id...).
// Injecter du camelCase ferait retomber chaque ligne sur la portee plateforme :
// le gate mesurerait alors sa propre erreur, pas le produit.
//
// Contenu : les deux activites propres a l autre client, aucune ligne pour le
// troisieme, et les 14 desactivations que N4 porte reellement en production.
function catalogState({ withN4Deactivations }) {
  const formulas = [];
  if (withN4Deactivations) {
    for (const id of SEED_FORMULA_IDS) {
      formulas.push({ id, owner_client_id: CENTER_OTHER, active: false, source: 'seed', name: `copie ${id}` });
    }
  }
  formulas.push({
    id: 'n4-jeudi-fou', owner_client_id: CENTER_OTHER, active: true, source: 'custom',
    name: 'Jeudi fou', family: 'Offres N4', price_type: 'per_pax', price_value: 7, min_pax: 1,
    description_lines: ['1 partie achetee, 1 offerte'], sort_index: 1,
  });
  const activities = [
    { id: 'bowling', center_id: 'all', owner_client_id: CENTER_OTHER, active: true, name: 'Bowling', bookable: true },
    { id: 'kara-box', center_id: 'all', owner_client_id: CENTER_OTHER, active: true, name: 'Kara Box', bookable: true },
  ];
  return {
    formulas,
    steps: [],
    activities,
    centerClients: new Map([
      [CENTER_SEED, SEED_OWNER],
      ['gembloux', SEED_OWNER],
      ['ciney', SEED_OWNER],
      [CENTER_OTHER, CENTER_OTHER],
      [CENTER_EMPTY, CENTER_EMPTY],
    ]),
  };
}

function idsOf(list) { return (list || []).map((x) => x && x.id).filter(Boolean); }

(async () => {
  section('[1] Le socle fichier reste ENTIER chez le client qui l a apporte');
  catalogStore.applyCatalogState(catalogState({ withN4Deactivations: true }));
  const seedFormulas = idsOf(catalogStore.listBookingFormules(CENTER_SEED));
  const seedActivities = idsOf(catalogStore.listActivities(CENTER_SEED));
  ok(
    SEED_FORMULA_IDS.every((id) => seedFormulas.includes(id)),
    'ses 14 formules du socle sont servies',
    `${seedFormulas.length} formules`,
  );
  ok(
    SEED_ACTIVITY_IDS.every((id) => seedActivities.includes(id)),
    'ses activites du socle aussi',
    `${seedActivities.length} activites`,
  );

  section('[2] Une AUTRE entreprise ne voit rien du socle, meme pas pour le refuser');
  const otherFormulas = idsOf(catalogStore.listBookingFormules(CENTER_OTHER));
  const otherActivities = idsOf(catalogStore.listActivities(CENTER_OTHER));
  const leakedFormulas = otherFormulas.filter((id) => SEED_FORMULA_IDS.includes(id));
  const leakedActivities = otherActivities.filter((id) => SEED_ACTIVITY_IDS.includes(id) && !['bowling'].includes(id));
  ok(leakedFormulas.length === 0, 'AUCUNE formule du socle dans son catalogue', leakedFormulas.join(',') || 'aucune');
  ok(leakedActivities.length === 0, 'AUCUNE activite du socle non plus', leakedActivities.join(',') || 'aucune');
  ok(otherFormulas.includes('n4-jeudi-fou'), 'ses PROPRES formules sont bien la', otherFormulas.join(',') || 'aucune');
  ok(
    otherActivities.includes('bowling') && otherActivities.includes('kara-box'),
    'ses PROPRES activites aussi, y compris celle qui porte un id du socle',
    otherActivities.join(','),
  );
  ok(
    !otherActivities.includes('laser_game') && !otherActivities.includes('minigolf_blacklight'),
    'ni laser game ni minigolf blacklight chez un bowling qui n en a pas',
    otherActivities.join(','),
  );

  section('[3] Une entreprise SANS aucune ligne part d un catalogue VIDE');
  const emptyFormulas = idsOf(catalogStore.listBookingFormules(CENTER_EMPTY));
  const emptyActivities = idsOf(catalogStore.listActivities(CENTER_EMPTY));
  ok(emptyFormulas.length === 0, 'zero formule heritee', emptyFormulas.join(',') || 'aucune');
  ok(emptyActivities.length === 0, 'zero activite heritee', emptyActivities.join(',') || 'aucune');

  section('[4] Les 14 desactivations de N4 deviennent INUTILES');
  catalogStore.applyCatalogState(catalogState({ withN4Deactivations: false }));
  const withoutDeactivations = idsOf(catalogStore.listBookingFormules(CENTER_OTHER));
  ok(
    withoutDeactivations.filter((id) => SEED_FORMULA_IDS.includes(id)).length === 0,
    'sans elles, le socle ne revient pas : ces 14 lignes ne servent plus a rien',
    withoutDeactivations.join(',') || 'aucune',
  );
  ok(
    withoutDeactivations.includes('n4-jeudi-fou'),
    'et son catalogue a lui n a pas bouge',
    withoutDeactivations.join(',') || 'aucune',
  );

  section('[5] Une formule qui CITE une activite du socle reste debout');
  // Mesure du 2026-08-21 : « Anniversaire enfants » de N4 a une etape
  // party_table, et party_table appartient au socle. La migration 0044 copie
  // donc chez chaque client les activites du socle que SES etapes citent :
  // sans cette copie, une formule VENDUE citerait une activite absente.
  {
    const state = catalogState({ withN4Deactivations: false });
    state.formulas.push({
      id: 'n4-anniversaire-enfants', owner_client_id: CENTER_OTHER, active: true, source: 'custom',
      name: 'Anniversaire enfants', family: 'Offres N4', price_type: 'per_pax', price_value: 20, min_pax: 1, sort_index: 2,
    });
    state.steps.push({ formula_id: 'n4-anniversaire-enfants', position: 0, activity_id: 'bowling', owner_client_id: CENTER_OTHER, label: '1 partie de bowling' });
    state.steps.push({ formula_id: 'n4-anniversaire-enfants', position: 1, activity_id: 'party_table', owner_client_id: CENTER_OTHER, label: 'Table d anniversaire' });
    // SANS la copie : l activite citee n existe pas chez lui.
    catalogStore.applyCatalogState(state);
    const sansCopie = idsOf(catalogStore.listActivities(CENTER_OTHER));
    ok(!sansCopie.includes('party_table'), 'sans la copie, party_table n est pas dans son catalogue', sansCopie.join(','));
    const formuleSansCopie = catalogStore.listBookingFormules(CENTER_OTHER).find((f) => f.id === 'n4-anniversaire-enfants');
    ok(Boolean(formuleSansCopie), 'sa formule reste servie malgre tout (elle ne disparait pas)', formuleSansCopie ? 'servie' : 'absente');
    // AVEC la copie que fait la migration : l activite est chez lui.
    state.activities.push({ id: 'party_table', center_id: 'all', owner_client_id: CENTER_OTHER, active: true, name: 'Table d anniversaire', bookable: false, source: 'seed' });
    catalogStore.applyCatalogState(state);
    const avecCopie = idsOf(catalogStore.listActivities(CENTER_OTHER));
    ok(avecCopie.includes('party_table'), 'avec la copie, il la possede', avecCopie.join(','));
    ok(
      !avecCopie.includes('laser_game') && !avecCopie.includes('karting_vr'),
      'et il n herite toujours de RIEN d autre',
      avecCopie.join(','),
    );
  }

  section('[6] Une reservation deja prise garde son libelle');
  catalogStore.applyCatalogState(catalogState({ withN4Deactivations: true }));
  const resolved = catalogStore.resolveBookingFormuleAnyScope('f1');
  ok(
    Boolean(resolved && resolved.id === 'f1'),
    'f1 se resout encore par id, pour les 26 reservations de Libramont qui la citent',
    resolved ? resolved.name : 'introuvable',
  );

  console.log(`\n${failures ? 'ECHEC' : 'ALL OK'} : ${assertions - failures}/${assertions} assertions`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('\nERREUR DU GATE:', error && (error.stack || error.message || error));
  process.exit(1);
});

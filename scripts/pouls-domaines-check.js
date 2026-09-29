// LE POULS DIT CE QUI A BOUGE, DOMAINE PAR DOMAINE, SANS RIEN DIRE D AUTRE.
//
// Ce que ce gate mesure, et pourquoi.
//
// Chaque page de la console relit ses donnees quand un autre poste les change.
// Elle l apprend par le pouls (`/api/ops?action=pulse`) : une empreinte par
// domaine (reservations, pistes, demandes, catalogue, configuration, equipe,
// mails...), lue toutes les deux secondes par chaque ecran ouvert. La mesure de
// la requete elle-meme se fait sur la vraie base (1,9 ms en production le
// 2026-09-25) ; ce gate garde les contrats que les ecrans lisent :
//
//   [A] UNE EMPREINTE PAR DOMAINE, LES TREIZE, JAMAIS VIDE. Un domaine absent
//       serait pris pour « nouveau » par l ecran, jamais pour « change ».
//   [B] L EMPREINTE D AVANT EXISTE TOUJOURS. Les ecrans ouverts pendant un
//       deploiement lisent encore `empreinte` : elle enchaine tous les domaines.
//   [C] LA JOURNEE AFFICHEE A SON DOMAINE, NOMME AVEC SA DATE. `jour:<date>` :
//       changer de jour cree un domaine neuf (une nouvelle base), pas un
//       changement ; sans date, pas de domaine du tout.
//   [D] UNE DATE IMPOSSIBLE N ATTEINT JAMAIS LA BASE. « 2026-02-30 » passe un
//       motif et ferait tomber le pouls entier en SQL ; un texte arbitraire n a
//       rien a faire dans une requete.
//   [E] LA LISTE ET LA REQUETE DISENT LES MEMES DOMAINES. Un domaine ajoute a
//       l une sans l autre rendrait « vide » pour toujours, en silence.
//   [F] L EQUIPE SE LIT SUR CE QUE LES ECRANS MONTRENT. `last_seen` bouge a
//       chaque minute d activite (et `updated_at` avec lui, par trigger) : une
//       empreinte sur `xmin` ferait relire la page Equipe toute seule, sans fin.
//   [G] LES HORAIRES RETENUS EN LIGNE (slot_holds, 0049) COMPTENT DANS LA
//       JOURNEE ; SANS LEUR TABLE, LE POULS SE RELIT SANS EUX au lieu de
//       tomber en entier. Une autre panne remonte comme avant.
//
// CONTRE-EPREUVES PAR MUTATION, compilees en memoire (crochet sur
// Module.prototype._compile) : le disque n est jamais touche.
//
// Usage : node scripts/pouls-domaines-check.js
'use strict';
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
const CIBLE = 'lib/database.js';

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

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

// Le faux pool : il note chaque requete et rend une ligne dont chaque colonne
// porte son propre nom, pour qu on voie qui va ou.
const requetes = [];
// [G] La table des blocages en ligne peut manquer (migration 0049 pas encore
// jouee) ; une autre panne peut toucher la meme requete.
let panneBlocages = null;
class FakePool {
  async query(texte, params) {
    requetes.push({ texte: String(texte), params: params || [] });
    if (panneBlocages && String(texte).includes('slot_holds')) throw Object.assign(new Error(panneBlocages.message), { code: panneBlocages.code });
    const ligne = {};
    for (const m of String(texte).matchAll(/\)\)?\s+as\s+([a-z]+)\s*[,;]/g)) ligne[m[1]] = `empreinte-${m[1]}`;
    return { rows: [ligne] };
  }
  async connect() { const self = this; return { query: (t, p) => self.query(t, p), release() {} }; }
  on() {}
  async end() {}
}
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';

function chargerBase() {
  for (const cle of Object.keys(require.cache)) {
    if (cle.startsWith(path.join(ROOT, 'lib') + path.sep)) delete require.cache[cle];
  }
  return require(path.join(ROOT, CIBLE));
}

async function pouls(db, options) {
  requetes.length = 0;
  const reponse = await db.getOpsPulse(options);
  return { reponse, requete: requetes[requetes.length - 1] };
}

(async () => {
  const db = chargerBase();
  const ATTENDUS = ['communications', 'suggestions', 'evenements', 'prises', 'reservations',
    'pistes', 'blocages', 'demandes', 'catalogue', 'config', 'equipe', 'notes', 'courrier'];

  // =====================================================================
  console.log('[A][B] une empreinte par domaine, et celle d avant');
  // =====================================================================
  const sansDate = await pouls(db, { centerId: 'libramont' });
  const noms = Object.keys(sansDate.reponse.domaines || {});
  ok(ATTENDUS.every((nom) => noms.includes(nom)) && noms.length === ATTENDUS.length,
    '[A] les treize domaines, ni plus ni moins, sans date', noms.join(','));
  ok(noms.every((nom) => typeof sansDate.reponse.domaines[nom] === 'string' && sansDate.reponse.domaines[nom]),
    '[A] aucune empreinte vide');
  ok(sansDate.reponse.domaines.equipe === 'empreinte-equipe' && sansDate.reponse.domaines.courrier === 'empreinte-courrier',
    '[A] chaque domaine porte SA colonne', `${sansDate.reponse.domaines.equipe} / ${sansDate.reponse.domaines.courrier}`);
  ok(sansDate.reponse.empreinte === noms.map((nom) => sansDate.reponse.domaines[nom]).join('.'),
    '[B] `empreinte` enchaine tous les domaines, pour les ecrans d avant les domaines', sansDate.reponse.empreinte.slice(0, 60));
  ok(sansDate.requete && sansDate.requete.params[0] === 'libramont', '[A] le centre voyage en parametre', JSON.stringify(sansDate.requete && sansDate.requete.params));

  // =====================================================================
  console.log('\n[C] la journee affichee a son domaine, nomme avec sa date');
  // =====================================================================
  const avecDate = await pouls(db, { centerId: 'libramont', date: '2026-09-25' });
  ok(avecDate.reponse.domaines['jour:2026-09-25'] === 'empreinte-jour',
    '[C] la date donnee cree le domaine « jour:2026-09-25 »', Object.keys(avecDate.reponse.domaines).filter((n) => n.startsWith('jour')).join(','));
  ok(avecDate.requete.params[1] === '2026-09-25', '[C] et la date part en parametre, jamais dans le texte', JSON.stringify(avecDate.requete.params));
  ok(!Object.keys(sansDate.reponse.domaines).some((n) => n.startsWith('jour')) && sansDate.requete.params[1] === null,
    '[C] sans date : ni domaine « jour », ni date envoyee', JSON.stringify(sansDate.requete.params));

  // =====================================================================
  console.log('\n[D] une date impossible n atteint jamais la base');
  // =====================================================================
  for (const faux of ['2026-02-30', '2026-13-01', "2026-09-25'; drop table reservations; --", '25/09/2026', '']) {
    const r = await pouls(db, { centerId: 'libramont', date: faux });
    ok(r.requete.params[1] === null && !Object.keys(r.reponse.domaines).some((n) => n.startsWith('jour')),
      `[D] « ${faux || '(vide)'} » : aucune date envoyee, aucun domaine du jour`, JSON.stringify(r.requete.params[1]));
  }

  // =====================================================================
  console.log('\n[E] la liste et la requete disent les memes domaines');
  // =====================================================================
  const colonnes = [...db.SQL_POULS.matchAll(/\)\)?\s+as\s+([a-z]+)\s*[,;]/g)].map((m) => m[1]);
  const liste = db.POULS_DOMAINES;
  ok(liste.every((nom) => colonnes.includes(nom)), '[E] chaque domaine de la liste a sa colonne', liste.filter((nom) => !colonnes.includes(nom)).join(',') || 'tous');
  ok(colonnes.filter((nom) => nom !== 'jour').every((nom) => liste.includes(nom)), '[E] et chaque colonne est dans la liste (jour a part)', colonnes.filter((nom) => nom !== 'jour' && !liste.includes(nom)).join(',') || 'toutes');

  // =====================================================================
  console.log('\n[F] l equipe se lit sur ce que les ecrans montrent');
  // =====================================================================
  const debutEquipe = db.SQL_POULS.indexOf('from staff_members m');
  const segmentMembres = db.SQL_POULS.slice(Math.max(0, debutEquipe - 260), debutEquipe + 60);
  ok(debutEquipe > 0 && !/m\.xmin|last_seen|updated_at/.test(segmentMembres),
    '[F] les membres : ni xmin, ni last_seen, ni updated_at', segmentMembres.replace(/\s+/g, ' ').slice(0, 140));

  // =====================================================================
  console.log('\n[G] les horaires retenus en ligne, et leur table absente');
  // =====================================================================
  ok(/from slot_holds h[\s\S]*released_at is null and h\.expires_at > now\(\)/.test(db.SQL_POULS),
    '[G] la journee compte les blocages en cours (un blocage qui arrive ou echoit fait relire le planning)');
  const sansTable = await (async () => {
    panneBlocages = { code: '42P01', message: 'relation "slot_holds" does not exist' };
    try { return await pouls(db, { centerId: 'libramont', date: '2026-09-25' }); } catch (error) { return { erreur: error.message }; } finally { panneBlocages = null; }
  })();
  ok(!sansTable.erreur && sansTable.reponse.domaines['jour:2026-09-25'] === 'empreinte-jour'
    && Object.keys(sansTable.reponse.domaines).length === 14 && !sansTable.requete.texte.includes('slot_holds'),
  '[G] table absente : le pouls se relit sans elle, les quatorze domaines sont la', sansTable.erreur || `${Object.keys(sansTable.reponse.domaines).length} domaines`);
  const autrePanne = await (async () => {
    panneBlocages = { code: '57014', message: 'canceling statement due to statement timeout' };
    try { await pouls(db, { centerId: 'libramont', date: '2026-09-25' }); return 'avalee'; } catch (error) { return 'remontee'; } finally { panneBlocages = null; }
  })();
  ok(autrePanne === 'remontee', '[G] une autre panne n est pas avalee (elle remonte comme avant)', autrePanne);

  // =====================================================================
  console.log('\n[MUTATION] le gate sait-il rougir ?');
  // =====================================================================
  const contreEpreuves = [
    {
      nom: 'la date n est plus reconstruite',
      de: "  return !Number.isNaN(jour.getTime()) && jour.toISOString().slice(0, 10) === texte ? texte : null;",
      vers: '  return texte;',
      rejouer: async () => (await pouls(chargerBase(), { centerId: 'libramont', date: '2026-02-30' })).requete.params[1],
      attendu: (param) => param === null,
      libelle: 'un 30 fevrier ferait tomber le pouls entier en SQL',
    },
    {
      nom: 'la journee perd sa date',
      de: "  if (safeDate) domaines[`jour:${safeDate}`] = row.jour || 'vide';",
      vers: "  if (safeDate) domaines.jour = row.jour || 'vide';",
      rejouer: async () => Object.keys((await pouls(chargerBase(), { centerId: 'libramont', date: '2026-09-25' })).reponse.domaines).includes('jour:2026-09-25'),
      attendu: (present) => present === true,
      libelle: 'chaque changement de jour sur le planning passerait pour une modification',
    },
    {
      nom: 'un domaine sort de la liste',
      de: "  'pistes', 'blocages', 'demandes', 'catalogue', 'config', 'equipe', 'notes', 'courrier',",
      vers: "  'pistes', 'blocages', 'demandes', 'catalogue', 'config', 'notes', 'courrier',",
      rejouer: async () => Object.keys((await pouls(chargerBase(), { centerId: 'libramont' })).reponse.domaines).length,
      attendu: (n) => n === 13,
      libelle: 'la page Equipe ne verrait plus un membre ajoute sur un autre poste',
    },
    {
      nom: 'l equipe se lit sur xmin',
      de: "      (select string_agg(concat_ws(':', m.id, m.name, m.contact, m.role_id, m.status, m.access_code_hint), ',' order by m.id)",
      vers: "      (select string_agg(m.id || ':' || m.xmin::text, ',' order by m.id)",
      rejouer: async () => {
        const base = chargerBase();
        const debut = base.SQL_POULS.indexOf('from staff_members m');
        return /m\.xmin|last_seen|updated_at/.test(base.SQL_POULS.slice(Math.max(0, debut - 260), debut + 60));
      },
      attendu: (sale) => sale === false,
      libelle: 'la page Equipe se relirait toute seule chaque minute, sans que rien n ait change',
    },
    {
      nom: 'le pouls ne se relit plus sans la table des blocages',
      de: '    if (!tableBlocagesAbsente(error)) throw error;\n    result = await getPool().query(SQL_POULS_SANS_BLOCAGES, [safeCenterId, safeDate]);',
      vers: '    throw error;',
      rejouer: async () => {
        panneBlocages = { code: '42P01', message: 'relation "slot_holds" does not exist' };
        try { await pouls(chargerBase(), { centerId: 'libramont', date: '2026-09-25' }); return 'lu'; } catch (error) { return 'tombe'; } finally { panneBlocages = null; }
      },
      attendu: (r) => r === 'lu',
      libelle: 'avant la migration 0049, tout le direct de la console tomberait',
    },
  ];
  for (const contre of contreEpreuves) {
    mutations = [{ fichier: CIBLE, de: contre.de, vers: contre.vers }];
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

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nTous les controles passent.');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

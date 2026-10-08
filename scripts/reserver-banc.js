// LE BANC DE LA FENETRE RESERVER (2026-10-08, lot I2 de la console).
//
// Les gates reserver-*-check.js montent ici le VRAI handler
// api/staff-reservations.js, le vrai moteur et la vraie lib/database.js, sur la
// base en memoire de scripts/slot-holds-check.js (vraies transactions, vrais
// verrous de journee). Ce banc y ajoute :
//   - une session staff fabriquee, dont les droits sont juges par la VRAIE
//     regle (sessionHasPermission, lib/staff-auth.js) sur les roles livres
//     (STAFF_ROLE_PRESETS) ;
//   - le journal d audit et la boite de secours remplaces par des doubles qui
//     notent ce qu on leur donne ;
//   - les lectures que ce lot ajoute (departs rapides, epingles du gerant,
//     derniere visite d un client), rejouees en JS sur la meme base ;
//   - un compteur des lectures de journee (« une seule lecture » se prouve) ;
//   - des mutations compilees en memoire (crochet sur Module.prototype._compile,
//     le disque n est jamais touche) pour les contre-preuves.
// Zero reseau, zero base, rien ne part.
'use strict';
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

// La base en memoire et le faux 'pg' s installent au require.
const banc = require('./slot-holds-check.js');

// ---------------------------------------------------------------------------
// Mutations en memoire.
// ---------------------------------------------------------------------------
let mutations = [];
const compilePrecedent = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compilePrecedent.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compilePrecedent.call(this, mute, nom);
};

// ---------------------------------------------------------------------------
// Les lectures de ce lot, sur la meme base.
// ---------------------------------------------------------------------------
const extra = {
  epingles: new Map(),
  epinglesAbsente: false,
  lecturesJournee: 0,
  requetes: [],
};
const SIMULATION = new Set(['sim-client', 'sim-staff']);
const chiffres9 = (telephone) => String(telephone || '').replace(/\D/g, '').slice(-9);
const dateTexte = (valeur) => String(valeur || '').slice(0, 10);
const isoJour = (dateISO) => { const j = new Date(`${dateISO}T12:00:00Z`).getUTCDay(); return j === 0 ? 7 : j; };
const parRecence = (a, b) => dateTexte(b.date).localeCompare(dateTexte(a.date)) || String(b.start_time || '').localeCompare(String(a.start_time || ''));
const actives = () => [...banc.base.reservations.values()].filter((r) => r.status !== 'cancelled');
const copie = (v) => JSON.parse(JSON.stringify(v));
// `ops_plan->'laserPassPlan'->>'totalGames'` comme Postgres le rend : du
// texte, ou null quand le chemin n existe pas.
const partiesDuPlan = (r) => {
  const plan = typeof r.ops_plan === 'string' ? JSON.parse(r.ops_plan) : r.ops_plan;
  const valeur = plan && plan.laserPassPlan ? plan.laserPassPlan.totalGames : undefined;
  return valeur === undefined || valeur === null ? null : String(valeur);
};
// Les colonnes que les lectures « departs » et « derniere visite » demandent,
// servies telles que la requete les nomme : une mutation qui remet le plan
// entier dans la lecture recoit le plan entier, et le gate le voit.
const COLONNES = {
  type: (r) => r.type,
  formule_id: (r) => r.formule_id,
  duration: (r) => r.duration,
  pax: (r) => r.pax,
  program: (r) => r.program,
  label: (r) => r.label,
  ops_plan: (r) => r.ops_plan,
  "ops_plan->'laserPassPlan'->>'totalGames' as parties_plan": (r) => partiesDuPlan(r),
};
function servirColonnes(liste, r) {
  const ligne = {};
  liste.split(', ').forEach((colonne) => {
    if (!COLONNES[colonne]) throw new Error(`colonne non servie par le banc : ${colonne}`);
    ligne[colonne.includes(' as ') ? colonne.split(' as ').pop() : colonne] = COLONNES[colonne](r);
  });
  return copie(ligne);
}

function absente() {
  return Object.assign(new Error('relation "reservation_departs_epingles" does not exist'), { code: '42P01' });
}

async function requeteDuLot(s, p) {
  if (/^select \* from reservations where date = \$1 and center_id = \$2 and status <> 'cancelled' order by start_time asc, id asc;?$/.test(s)) {
    extra.lecturesJournee += 1;
    return null;
  }
  if (s.startsWith('select count(*) filter (where date::text < $3)::int as visites')) {
    extra.requetes.push({ quoi: 'historique', p });
    const lignes = actives().filter((r) => r.center_id === p[0] && chiffres9(r.phone) === p[1]).sort(parRecence);
    const passees = lignes.filter((r) => dateTexte(r.date) < p[2]);
    const futures = lignes.filter((r) => dateTexte(r.date) >= p[2]).map((r) => dateTexte(r.date)).sort();
    return { rows: [{
      visites: passees.length,
      derniere: passees[0] ? dateTexte(passees[0].date) : null,
      prochaine: futures[0] || null,
      nom: lignes[0] ? lignes[0].name : null,
      derniere_activite: passees[0] ? passees[0].label : null,
      dernieres_personnes: passees[0] ? passees[0].pax : null,
    }], rowCount: 1 };
  }
  const derniere = /^select (.+?) from reservations where center_id = \$1 and status <> 'cancelled' and right\(regexp_replace\(coalesce\(phone, ''\), '\[\^0-9\]', '', 'g'\), 9\) = \$2 and date::text < \$3 order by date desc, start_time desc limit 1;?$/.exec(s);
  if (derniere) {
    extra.requetes.push({ quoi: 'derniere', p, sql: s });
    const ligne = actives().filter((r) => r.center_id === p[0] && chiffres9(r.phone) === p[1] && dateTexte(r.date) < p[2]).sort(parRecence)[0];
    return ligne ? { rows: [servirColonnes(derniere[1], ligne)], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  const departs = /^select (.+?) from reservations where center_id = \$1 and status <> 'cancelled' and date >= \$2::date and date <= \$3::date /.exec(s);
  if (departs) {
    extra.requetes.push({ quoi: 'departs', p, sql: s });
    const motif = String(p[4] || '').replace(/^%/, '').toLowerCase();
    const lignes = actives()
      .filter((r) => r.center_id === p[0] && dateTexte(r.date) >= p[1] && dateTexte(r.date) <= p[2] && isoJour(dateTexte(r.date)) === Number(p[3]))
      .filter((r) => !SIMULATION.has(String(r.channel || '')) && !String(r.email || '').toLowerCase().endsWith(motif))
      .sort(parRecence)
      .map((r) => servirColonnes(departs[1], r));
    return { rows: lignes, rowCount: lignes.length };
  }
  if (s === 'select epingles, updated_by, updated_at from reservation_departs_epingles where center_id = $1 limit 1;') {
    if (extra.epinglesAbsente) throw absente();
    const ligne = extra.epingles.get(p[0]);
    return ligne ? { rows: [copie(ligne)], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (s.startsWith('insert into reservation_departs_epingles (center_id, epingles, updated_by, updated_at)')) {
    if (extra.epinglesAbsente) throw absente();
    const ligne = { epingles: JSON.parse(p[1]), updated_by: p[2], updated_at: new Date().toISOString() };
    extra.epingles.set(p[0], ligne);
    return { rows: [copie(ligne)], rowCount: 1 };
  }
  return null;
}

const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const reponse = await requeteDuLot(s, params);
  if (reponse) return reponse;
  return queryDuBanc.call(this, sql, params);
};

// ---------------------------------------------------------------------------
// Le handler monte, avec ses doubles.
// ---------------------------------------------------------------------------
function remplacer(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
  return reel;
}

function sessionDuRole(roleId, { nom = 'Rachel', centre = 'libramont' } = {}) {
  const { STAFF_ROLE_PRESETS } = require(path.join(ROOT, 'lib/staff-auth.js'));
  const preset = STAFF_ROLE_PRESETS.find((role) => role.id === roleId);
  if (!preset) throw new Error(`role inconnu : ${roleId}`);
  return { centerId: centre, member: { id: `m-${roleId}`, name: nom }, role: { id: preset.id, locked: false }, permissions: [...preset.permissions] };
}

// `options.mutations` : les editions du code pour une contre-preuve.
// `options.session` : la session (un role livre, Manager par defaut).
function monter({ mutations: liste = [], session = null } = {}) {
  mutations = liste;
  const S = banc.charger();
  const journal = { audits: [], permissions: [], secours: [] };
  let courante = session || sessionDuRole('manager');
  const auth = remplacer('lib/staff-auth.js', {
    getStaffSessionFromRequest: async () => courante,
    requireStaffPermission: async (req, res, permission, options = {}) => {
      journal.permissions.push(permission);
      if (!auth.sessionHasPermission(courante, permission)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, message: 'Permission insuffisante.' }));
        return null;
      }
      return { ...courante, authorizedCenterId: options.centerId || courante.centerId };
    },
  });
  remplacer('lib/audit-log.js', { writeAuditLog: async (entree) => { journal.audits.push(entree); return {}; } });
  remplacer('lib/secours-envoi.js', { copieSecours: async (...args) => { journal.secours.push(args); return {}; } });
  const handler = require(path.join(ROOT, 'api/staff-reservations.js'));
  return {
    S,
    handler,
    journal,
    changerSession(nouvelle) { courante = nouvelle; },
    appeler: (methode, url, corps) => appeler(handler, methode, url, corps),
  };
}

async function appeler(handler, methode, url, corps) {
  const req = Readable.from(corps === undefined ? [] : [Buffer.from(JSON.stringify(corps))]);
  req.method = methode;
  req.url = url;
  req.headers = { host: 'localhost', 'content-type': 'application/json' };
  const res = {
    statusCode: 200,
    entetes: {},
    corps: '',
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    getHeader(k) { return this.entetes[k.toLowerCase()]; },
    end(b) { this.corps = String(b || ''); },
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corps); } catch (e) { json = null; }
  return { statut: res.statusCode, json: json || {} };
}

// La journee de test : celle du banc des blocages (un samedi ouvert, une
// semaine au moins devant), jamais aujourd hui.
function semer(lignes = []) {
  banc.semer(lignes);
  extra.epingles.clear();
  extra.epinglesAbsente = false;
  extra.lecturesJournee = 0;
  extra.requetes.length = 0;
}

// Une reservation en base, dans la forme des colonnes.
function ligne(id, champs = {}) {
  return banc.reservationLigne(id, champs.start_time || '15:00', champs.lanes || [], champs);
}

// Le corps staff de base : la fenetre, un groupe, une heure.
function corpsStaff(champs = {}) {
  return { centerId: 'libramont', date: banc.JOUR, name: 'Groupe Essai', phone: '0470111222', email: '', status: 'pending', ...champs };
}

// Une contre-preuve : rejouer un scenario sur un code mute, et dire si la
// verification attendue rougit.
async function contrePreuve(ok, { nom, fichier, de, vers, rejouer, attendu, libelle }) {
  let rouge = false;
  let mesure = '';
  try {
    const valeur = await rejouer([{ fichier, de, vers }]);
    mesure = typeof valeur === 'string' ? valeur : JSON.stringify(valeur);
    rouge = !attendu(valeur);
  } catch (error) {
    mesure = `exception : ${error.message}`;
    rouge = /ancre absente/.test(error.message) ? false : true;
  } finally {
    mutations = [];
  }
  ok(rouge, `contre-preuve « ${nom} » : le gate ROUGIT (${libelle})`, mesure.slice(0, 220));
}

function sortir(nom, echecs, message) {
  if (echecs) {
    console.error(`\n${nom}: ${echecs} FAIL`);
    process.exit(1);
  }
  console.log(`\n${nom}: ALL OK - ${message}`);
  process.exit(0);
}

module.exports = {
  JOUR: banc.JOUR,
  ROOT,
  appeler,
  base: banc.base,
  contrePreuve,
  corpsStaff,
  extra,
  ligne,
  monter,
  semer,
  sessionDuRole,
  sortir,
};

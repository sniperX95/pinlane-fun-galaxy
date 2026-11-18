// UNE SUPPRESSION DIT SUR QUELLE VERSION ELLE A ETE DECIDEE (2026-11-18, point C5 de la verification
// avant le lancement).
//
// Ce qui passait sans controle de version, relu le 18/11 :
//   - LA SUPPRESSION : DELETE /api/staff-reservations ne portait aucune version, ni depuis la console
//     (deleteRes, assets/app-main.js) ni depuis l assistant (supprimer_reservation). Un poste qui avait
//     la liste ouverte depuis un moment supprimait le dossier tel qu il etait devenu, avec ce qu un
//     collegue venait d y ecrire, et annulait ses mails en attente ;
//   - LE SUIVI ENVOYE EN ENTIER (activityProgress seul) et « Modifier » SANS VERSION : seuls les onglets
//     ouverts avant le 25/09 les envoient ; la console d aujourd hui coche une seule activite
//     (activityToggle, appliquee sur ce qui est en base) et envoie toujours sa version a « Modifier ».
//     Ils restent acceptes : les refuser casserait ces vieux onglets, et sans version rien ne permet de
//     savoir ce que l onglet avait vu.
//
// La suppression porte maintenant sa version (`baseUpdatedAt`), controlee avant d annuler les mails
// puis sous le verrou (lib/database.js deleteReservation), comme une modification. Sans version, elle
// passe comme avant. Ce gate monte le VRAI handler api/staff-reservations.js et la vraie lib/database.js
// sur la base en memoire du banc (scripts/reserver-banc.js), et la vraie fonction de la console :
//   [A] UNE VERSION DEPASSEE : refus 409 avec la version actuelle, le dossier reste, ses mails ne sont
//       pas annules, rien n est archive ;
//   [B] LA BONNE VERSION : le dossier est archive puis supprime ;
//   [C] SANS VERSION (un onglet d avant) : la suppression passe comme avant, par le meme chemin ;
//   [D] ECRIT ENTRE LA LECTURE ET LE VERROU : le controle sous le verrou refuse, le dossier reste, et ses
//       mails et travaux reviennent ;
//   [E] LA CONSOLE envoie la version qu elle a lue (celle de sa derniere ecriture sur ce dossier si elle
//       vient d en faire une) et, refusee, montre la version actuelle avec une phrase claire.
// (L assistant : supprimer_reservation porte la version relue, scripts/assistant-gestes-reservations-check.js.)
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais touche) fait rougir sa lettre.
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

// L espion des automatismes du handler, pose avant tout chargement (le banc les rend muets).
const espion = { automatisations: [] };
const loadOrigine = Module._load;
Module._load = function (request, parent, isMain) {
  const exporte = loadOrigine.apply(this, arguments);
  if (/(^|[\\/])lib[\\/]ops-jobs(\.js)?$/.test(String(request)) && parent && /api[\\/]staff-reservations\.js$/.test(String(parent.filename || ''))) {
    return { ...exporte, enqueueReservationAutomation: async (reservation) => { espion.automatisations.push(Number(reservation && reservation.id)); return []; } };
  }
  return exporte;
};

const B = require('./reserver-banc.js');
const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';
const DB = 'lib/database.js';
const API = 'api/staff-reservations.js';
const CONSOLE = 'assets/app-main.js';
const CONTRE = process.argv.includes('--contre-preuves');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let echecs = 0;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  return cond;
}

// ---------------------------------------------------------------------------
// Ce que la suppression lit et ecrit, servi sur la base du banc (une ligne supprimee dans une
// transaction ne disparait qu a son COMMIT).
// ---------------------------------------------------------------------------
const journal = [];
const archives = [];
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
const vue = (tx) => { const m = new Map(B.base.reservations); if (tx) tx.reservations.forEach((row, id) => m.set(id, row)); if (tx && tx.supprimes) tx.supprimes.forEach((id) => m.delete(id)); return m; };
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const tx = this && this.tx ? this.tx : null;
  journal.push(s);
  if (s === 'select id, date, center_id from reservations where id = $1 limit 1;') {
    const row = vue(tx).get(Number(params[0]));
    return row ? { rows: [{ id: row.id, date: new Date(`${row.date}T00:00:00`), center_id: row.center_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/^insert into reservation_archive \(center_id, reservation_id, payload, archived_by, reason\) select r\.center_id, r\.id, to_jsonb\(r\), \$2, \$3 from reservations r where r\.id = \$1 returning id;$/.test(s)) {
    const row = vue(tx).get(Number(params[0]));
    if (!row) return { rows: [], rowCount: 0 };
    archives.push({ id: archives.length + 1, reservationId: row.id, par: params[1], tx });
    return { rows: [{ id: archives.length }], rowCount: 1 };
  }
  if (s === 'delete from reservations where id = $1;') {
    if (tx) { tx.supprimes = tx.supprimes || []; tx.supprimes.push(Number(params[0])); } else B.base.reservations.delete(Number(params[0]));
    return { rows: [], rowCount: 1 };
  }
  if (s === 'COMMIT' && tx && !tx.abandonnee && tx.supprimes) {
    const supprimes = tx.supprimes;
    const r = await queryDuBanc.call(this, sql, params);
    supprimes.forEach((id) => B.base.reservations.delete(id));
    return r;
  }
  return queryDuBanc.call(this, sql, params);
};

const iso = (valeur) => new Date(valeur).toISOString();
const annulations = () => journal.filter((s) => /^update communications set status = 'cancelled'/.test(s) || /^update ops_jobs set status = 'cancelled'/.test(s)).length;
const archivees = () => archives.filter((a) => a.tx && a.tx.fini && !a.tx.abandonnee).length;
const lecturesSousVerrou = () => journal.filter((s) => s === 'select * from reservations where id = $1 for update;').length;

function monter(mutations) {
  const m = B.monter({ mutations, session: B.sessionDuRole('direction', { nom: 'Ansar' }) });
  journal.length = 0;
  archives.length = 0;
  espion.automatisations.length = 0;
  return m;
}
const dossier = () => B.ligne(801, { start_time: '18:00', lanes: [3], name: 'Dossier 801', email: 'client801@example.test', updated_at: new Date(Date.now() - 60_000) });

async function scenarioServeur(mutations) {
  const f = {};
  // [A] Une version depassee.
  B.semer([dossier()]);
  let m = monter(mutations);
  const lue = iso(B.base.reservations.get(801).updated_at);
  B.base.reservations.get(801).updated_at = new Date(Date.parse(lue) + 5000);
  let r = await m.appeler('DELETE', URL_RESA, { id: 801, baseUpdatedAt: lue });
  f.a = { statut: r.statut, code: String(r.json.code || ''), rendue: r.json.reservation ? Number(r.json.reservation.id) : null, enBase: B.base.reservations.has(801), annulations: annulations(), archives: archivees() };
  // [B] La bonne version.
  B.semer([dossier()]);
  m = monter(mutations);
  r = await m.appeler('DELETE', URL_RESA, { id: 801, baseUpdatedAt: iso(B.base.reservations.get(801).updated_at) });
  f.b = { statut: r.statut, enBase: B.base.reservations.has(801), archives: archivees() };
  // [C] Sans version.
  B.semer([dossier()]);
  m = monter(mutations);
  r = await m.appeler('DELETE', URL_RESA, { id: 801 });
  f.c = { statut: r.statut, enBase: B.base.reservations.has(801), archives: archivees(), lecturesSousVerrou: lecturesSousVerrou() };
  // [D] Ecrit entre la lecture du handler et le verrou de la journee.
  B.semer([dossier()]);
  m = monter(mutations);
  const versionD = iso(B.base.reservations.get(801).updated_at);
  B.base.avantVerrou = () => { B.base.reservations.get(801).updated_at = new Date(Date.parse(versionD) + 7000); };
  r = await m.appeler('DELETE', URL_RESA, { id: 801, baseUpdatedAt: versionD });
  f.d = { statut: r.statut, code: String(r.json.code || ''), enBase: B.base.reservations.has(801), archives: archivees(), revenus: espion.automatisations.filter((id) => id === 801).length };
  return f;
}

// ---------------------------------------------------------------------------
// La vraie fonction de la console (deleteRes et sa file d ecritures), relue dans son fichier.
// ---------------------------------------------------------------------------
function lireConsole(mutations) {
  let source = fs.readFileSync(path.join(ROOT, CONSOLE), 'utf8').split(CRLF).join(LF);
  for (const { fichier, de, vers } of mutations) {
    if (fichier !== CONSOLE) continue;
    if (source.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${fichier} : ${de.slice(0, 70)}`);
    source = source.split(de).join(vers);
  }
  const fonction = (nom) => {
    const debut = source.search(new RegExp(`\\n(async )?function ${nom}\\(`));
    if (debut < 0) throw new Error(`fonction absente de la console : ${nom}`);
    const fin = source.indexOf('\n}\n', debut + 1);
    return source.slice(debut + 1, fin + 2);
  };
  return ['fileEcrituresReservation', 'enchainerEcritureReservation', 'deleteRes'].map(fonction).join('\n');
}
async function scenarioConsole(mutations) {
  const code = lireConsole(mutations);
  const vu = { corps: [], appliquees: [], toasts: [] };
  let reponse = async () => ({ ok: true });
  const ctx = {
    state: { reservations: [{ id: 5, name: 'Groupe', startTime: '15:00', pax: 4, updatedAt: '2026-11-18T10:00:00.000Z' }], selectedRes: null },
    staffConfirm: async () => true,
    removeOptimisticReservation: () => {},
    closePos: () => {},
    API_ENDPOINTS: { staffReservations: '/api/staff-reservations' },
    apiRequest: async (url, options) => { vu.corps.push(JSON.parse(options.body)); return reponse(); },
    applyOptimisticReservation: (r) => { vu.appliquees.push(r); },
    toast: (t) => { vu.toasts.push(t); },
  };
  // eslint-disable-next-line no-new-func
  const fabriquer = new Function('ctx', `with (ctx) { ${code}\n return { deleteRes, enchainerEcritureReservation }; }`);
  const C = fabriquer(ctx);
  await C.deleteRes(5);
  const simple = vu.corps[0] || {};
  // Juste apres une ecriture de ce poste sur le meme dossier : la version qu elle a rendue.
  vu.corps.length = 0;
  C.enchainerEcritureReservation(5, async () => ({ reservation: { id: 5, updatedAt: '2026-11-18T10:05:00.000Z' } }));
  await C.deleteRes(5);
  const enchainee = vu.corps[0] || {};
  // Refusee : la version actuelle s affiche, avec une phrase claire.
  vu.corps.length = 0; vu.appliquees.length = 0; vu.toasts.length = 0;
  reponse = async () => { throw Object.assign(new Error('Cette réservation a changé entre-temps.'), { status: 409, payload: { code: 'reservation_modifiee', reservation: { id: 5, name: 'Groupe renommé', updatedAt: '2026-11-18T10:09:00.000Z' } } }); };
  await C.deleteRes(5);
  return { simple, enchainee, refus: { appliquee: vu.appliquees[0] && vu.appliquees[0].name, toast: vu.toasts[0] || '' } };
}

function juger(f, dire) {
  dire(f.a.statut === 409 && f.a.code === 'reservation_modifiee' && f.a.rendue === 801, '[A] une version depassee : refus 409 avec la version actuelle', f.a);
  dire(f.a.enBase && f.a.annulations === 0 && f.a.archives === 0, '[A] le dossier reste, ses mails ne sont pas annules, rien n est archive', f.a);
  dire(f.b.statut === 200 && !f.b.enBase && f.b.archives === 1, '[B] la bonne version : le dossier est archive puis supprime', f.b);
  dire(f.c.statut === 200 && !f.c.enBase && f.c.archives === 1 && f.c.lecturesSousVerrou === 0, '[C] sans version (un onglet d avant) : la suppression passe comme avant, par le meme chemin', f.c);
  dire(f.d.statut === 409 && f.d.code === 'reservation_modifiee' && f.d.enBase && f.d.archives === 0, '[D] ecrit entre la lecture et le verrou : le controle sous le verrou refuse, le dossier reste', f.d);
  dire(f.d.revenus === 1, '[D] ses mails et travaux reviennent', f.d);
  dire(f.console.simple.id === 5 && f.console.simple.baseUpdatedAt === '2026-11-18T10:00:00.000Z', '[E] la console envoie la version qu elle a lue', f.console.simple);
  dire(f.console.enchainee.baseUpdatedAt === '2026-11-18T10:05:00.000Z', '[E] juste apres une ecriture de ce poste, la version qu elle a rendue', f.console.enchainee);
  dire(f.console.refus.appliquee === 'Groupe renommé' && /a changé sur un autre poste/.test(f.console.refus.toast), '[E] refusee, la console montre la version actuelle et le dit', f.console.refus);
}

async function tout(mutations, dire) {
  const f = await scenarioServeur(mutations);
  f.console = await scenarioConsole(mutations);
  juger(f, dire);
}

const CONTRE_PREUVES = [
  { nom: 'mails-annules-pour-rien', lettres: ['[A]'], fichier: API, de: '      if (versionSupprimee !== null && !memeVersion(current.updatedAt, versionSupprimee)) throw reservationModifieeEntreTemps(current);\n', vers: '', libelle: 'une suppression refusee aurait deja annule les mails du dossier' },
  { nom: 'sans-controle-sous-verrou', lettres: ['[D]'], fichier: DB, de: '      if (courante && !memeVersion(courante.updatedAt, versionAttendue)) throw reservationModifieeEntreTemps(courante);\n', vers: '', libelle: 'un dossier ecrit juste avant le verrou serait supprime' },
  { nom: 'version-non-transmise', lettres: ['[D]'], fichier: API, de: '          baseUpdatedAt: body.baseUpdatedAt,\n', vers: '', libelle: 'le controle sous le verrou ne verrait jamais la version' },
  { nom: 'mails-perdus-au-refus', lettres: ['[D]'], fichier: API, de: "          await refreshReservationAutomation(current, error.reservation, { reason: 'suppression_refusee' }).catch(() => null);\n", vers: '', libelle: 'un dossier garde perdrait ses mails en attente' },
  { nom: 'console-sans-version', lettres: ['[E]'], fichier: CONSOLE, de: '        body: JSON.stringify({ id, ...(version ? { baseUpdatedAt: version } : {}) })\n', vers: '        body: JSON.stringify({ id })\n', libelle: 'la console supprimerait sans dire ce qu elle a vu' },
  { nom: 'console-hors-file', lettres: ['[E]'], fichier: CONSOLE, de: '      const version = (derniere && String(derniere.id) === String(id) ? derniere : current).updatedAt;\n', vers: '      const version = current.updatedAt;\n', libelle: 'derriere sa propre ecriture, la console se refuserait elle-meme' },
];

(async () => {
  if (!CONTRE) {
    await tout([], ok);
    B.sortir('suppression-version-check', echecs, 'une suppression porte sa version, controlee comme une modification ; sans version, rien ne change');
    return;
  }
  for (const c of CONTRE_PREUVES) {
    const rouges = new Set();
    let mesure = '';
    try {
      await tout([{ fichier: c.fichier, de: c.de, vers: c.vers }], (cond, label) => { if (!cond) rouges.add(label.slice(0, 3)); });
      mesure = [...rouges].join(' ');
    } catch (error) {
      mesure = `exception : ${error.message}`;
    }
    ok(c.lettres.every((lettre) => rouges.has(lettre)), `contre-preuve « ${c.nom} » : ${c.lettres.join(', ')} ROUGISSENT (${c.libelle})`, mesure);
  }
  let propres = 0;
  await tout([], (cond) => { if (!cond) propres += 1; });
  ok(propres === 0, 'aucune mutation ne survit : tout repasse au vert sur le code du disque');
  B.sortir('suppression-version-check --contre-preuves', echecs, 'chaque garde retiree fait rougir sa lettre');
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

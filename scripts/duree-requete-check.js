// UNE REQUETE D ECRITURE EST BORNEE DANS LE TEMPS (2026-11-18, point C11 de la verification avant le
// lancement).
//
// Le trou : aucune limite sur la duree d une requete. A5 (17/11) a borne l attente d un verrou ; une
// requete lente, elle (base ralentie, plan de requete degenere), tenait sa connexion et la journee
// jusqu a la coupure de la fonction par l hebergeur, sans reponse pour la personne.
//
// Chaque transaction de withTransaction pose maintenant `set local statement_timeout` (15 s), comme la
// limite d attente : dans la transaction seulement, jamais sur la connexion (un gestionnaire de
// connexions la passerait a d autres) ni au demarrage. Au-dela, Postgres annule la requete (57014) et
// la personne lit la phrase d A5, sans alerte de panne.
//
// Ce gate monte les VRAIS handlers (comptoir et formulaire en ligne), la vraie lib/database.js et le vrai
// moteur sur la base en memoire du banc (scripts/reserver-banc.js), et lui apprend la limite de Postgres :
// une instruction plus longue que la limite posee est annulee (57014). Le banc joue le temps cent fois
// plus vite (15 s en 150 ms).
//   [A] AU COMPTOIR : une creation dont l ecriture traine lit la phrase (503), rien n est ecrit, aucun
//       plantage n est note ;
//   [B] EN LIGNE : la confirmation lit la meme phrase, ni « horaires pris » ni panne transmise ; la
//       retenue des horaires repond 503 sans « horaires pris » ni panne ;
//   [C] LA LIMITE : chaque transaction la pose, en `set local`, a 15 secondes ;
//   [D] CE QUI N EST PAS LIMITE : la sauvegarde de la nuit, les exports, le lanceur de migrations et la
//       garde ne passent pas par withTransaction, et rien ne pose la limite ailleurs (ni au demarrage
//       d une connexion, ni pour toute une session) ;
//   [E] L ALERTE : la requete trop longue ne se signale pas comme un plantage.
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais touche) fait rougir sa lettre.
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./reserver-banc.js');
const banc = require('./slot-holds-check.js');

const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';
const DB = 'lib/database.js';
const CONTRE = process.argv.includes('--contre-preuves');
const PHRASE = 'Beaucoup de demandes arrivent en même temps. Réessayez dans un instant.';
const ECHELLE = 100; // le banc joue 15 s en 150 ms
const LENTE = 3000; // une instruction qui traine, en millisecondes du banc
const PATIENCE = 1500; // au-dela, la demande « attend toujours »
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let echecs = 0;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  return cond;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// La limite de duree de Postgres, apprise au banc.
// ---------------------------------------------------------------------------
const course = { lente: null, journal: [] };
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
  course.journal.push({ s, params });
  const limite = /^set local statement_timeout = '(\d+)(ms|s)';?$/.exec(s);
  if (limite && tx) {
    tx.dureeMax = Number(limite[1]) * (limite[2] === 's' ? 1000 : 1);
    return { rows: [], rowCount: 0 };
  }
  if (course.lente && course.lente(s)) {
    const borne = tx && tx.dureeMax ? tx.dureeMax / ECHELLE : Infinity;
    if (borne < LENTE) {
      await pause(borne);
      // Postgres : l instruction est annulee, la transaction est en echec jusqu a son ROLLBACK.
      if (this.tx) this.tx.abandonnee = true;
      throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    }
    await pause(LENTE);
  }
  return queryDuBanc.call(this, sql, params);
};

const BOWLING = (nom, heure) => B.corpsStaff({ type: 'bowling', pax: 4, startTime: heure, duration: 1, totalDuration: 1, lanes: [], laneCount: 1, requiresLanes: true, channel: 'staff', name: nom });
const dire = (r) => `${r.statut} ${r.json.message || r.json.error || ''}`.trim();
const noms = () => [...B.base.reservations.values()].map((r) => r.name).sort().join(', ');
const plantagesNotes = () => course.journal.filter((x) => /^insert into client_errors/.test(x.s)).length;
const ouPatience = (promesse) => Promise.race([promesse, pause(PATIENCE).then(() => 'attend toujours')]);

function monter(mutations) {
  const m = B.monter({ mutations, session: B.sessionDuRole('direction', { nom: 'Ansar' }) });
  course.lente = null;
  course.journal.length = 0;
  return m;
}

async function scenarioComptoir(mutations) {
  B.semer([]);
  const m = monter(mutations);
  course.lente = (s) => s.startsWith('insert into reservations (');
  const vu = await ouPatience(m.appeler('POST', URL_RESA, BOWLING('Lent', '15:00')));
  course.lente = null;
  await pause(LENTE + 50);
  return {
    vu: vu === 'attend toujours' ? vu : dire(vu),
    plantages: plantagesNotes(),
    apres: noms(),
    limites: course.journal.filter((x) => /^set local statement_timeout/.test(x.s)).map((x) => x.s),
    sessions: course.journal.filter((x) => /^set (session )?statement_timeout/i.test(x.s)).length,
    debuts: course.journal.filter((x) => x.s === 'BEGIN').length,
  };
}

async function scenarioEnLigne(mutations) {
  const f = {};
  B.semer([]);
  let m = monter(mutations);
  course.lente = (s) => s.startsWith('insert into reservations (');
  const vu = await ouPatience(banc.confirmer(m.S, banc.avecContact(banc.BOWLING('17:00'), 3)));
  course.lente = null;
  await pause(LENTE + 50);
  f.confirmation = vu === 'attend toujours' ? vu : dire(vu);
  f.code = vu === 'attend toujours' ? '' : String(vu.json.code || '');
  f.alternatives = vu === 'attend toujours' ? 0 : (vu.json.alternatives || []).length;
  f.pannes = course.journal.filter((x) => /^insert into audit_log/i.test(x.s) && (x.params || []).includes('reservation.panne')).length;
  f.apres = noms();
  B.semer([]);
  m = monter(mutations);
  course.lente = (s) => s.startsWith('insert into slot_holds (center_id, date, start_time, token_hash, ip_hash');
  const vuRetenue = await ouPatience(banc.retenir(m.S, banc.BOWLING('17:00')));
  course.lente = null;
  await pause(LENTE + 50);
  f.retenue = vuRetenue === 'attend toujours' ? vuRetenue : dire(vuRetenue);
  f.codeRetenue = vuRetenue === 'attend toujours' ? '' : String(vuRetenue.json.code || '');
  return f;
}

// Les fichiers relus tels que le code les donnerait, mutations comprises.
function lire(rel, mutations) {
  let texte = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CRLF).join(LF);
  for (const { fichier, de, vers } of mutations) {
    if (fichier !== rel) continue;
    if (texte.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    texte = texte.split(de).join(vers);
  }
  return texte;
}
function fichiersDuServeur() {
  const liste = [];
  const parcourir = (dossier) => {
    for (const nom of fs.readdirSync(path.join(ROOT, dossier), { withFileTypes: true })) {
      const rel = `${dossier}/${nom.name}`;
      if (nom.isDirectory()) parcourir(rel);
      else if (/\.(c|m)?js$|\.ts$/.test(nom.name)) liste.push(rel);
    }
  };
  ['lib', 'api', 'workers'].forEach(parcourir);
  return [...liste, 'scripts/run-db-migrations.js', 'middleware.ts'];
}
function scenarioHorsLimite(mutations) {
  const sansCommentaires = (texte) => texte.split(LF).filter((l) => !/^\s*\/\//.test(l)).join(LF);
  const poses = [];
  for (const rel of fichiersDuServeur()) {
    const code = sansCommentaires(lire(rel, mutations));
    code.split(LF).forEach((ligne) => { if (/statement_timeout/.test(ligne)) poses.push(`${rel}: ${ligne.trim()}`); });
  }
  const longs = ['lib/sauvegarde.js', 'lib/export-complet.js', 'lib/export-excel.js', 'scripts/run-db-migrations.js', 'lib/tour-controle.js']
    .filter((rel) => /withTransaction/.test(sansCommentaires(lire(rel, mutations))));
  return { poses, longs };
}

async function scenarioAlerte(mutations) {
  B.semer([]);
  monter(mutations);
  const { signalerPanneServeur } = require(path.join(ROOT, 'lib/garde-serveur.js'));
  // L erreur que withTransaction rend pour une requete annulee, prise a la source.
  const db = require(path.join(ROOT, DB));
  let rendue = null;
  course.lente = (s) => s === 'select 1 as lente';
  await db.withTransaction(async (client) => { await client.query('select 1 as lente'); }).catch((e) => { rendue = e; });
  course.lente = null;
  course.journal.length = 0;
  const r = rendue ? await signalerPanneServeur('api/banc', rendue) : null;
  await pause(30);
  return { rendue: rendue ? `${rendue.statusCode} ${rendue.message}` : 'aucune', signal: JSON.stringify(r), plantages: plantagesNotes() };
}

function juger(f, dire2) {
  dire2(f.comptoir.vu === `503 ${PHRASE}`, '[A] au comptoir, une ecriture qui traine lit la phrase qui dit de reessayer (503)', f.comptoir.vu);
  dire2(f.comptoir.apres === '' && f.comptoir.plantages === 0, '[A] rien n est ecrit, aucun plantage n est note', `${f.comptoir.apres} / ${f.comptoir.plantages}`);
  dire2(f.enLigne.confirmation === `503 ${PHRASE}`, '[B] la confirmation en ligne lit la meme phrase (503)', f.enLigne.confirmation);
  dire2(f.enLigne.code !== 'transmise_au_centre' && f.enLigne.alternatives === 0 && f.enLigne.pannes === 0 && f.enLigne.apres === '', '[B] ni « horaires pris », ni panne transmise, rien d ecrit', `${f.enLigne.code} / ${f.enLigne.alternatives} alternative(s) / ${f.enLigne.pannes} / ${f.enLigne.apres}`);
  dire2(/^503 /.test(f.enLigne.retenue) && !['slot_taken', 'slot_unavailable', 'hold_unavailable'].includes(f.enLigne.codeRetenue), '[B] la retenue des horaires repond 503 sans « horaires pris » ni panne', `${f.enLigne.retenue} / ${f.enLigne.codeRetenue}`);
  dire2(f.comptoir.debuts > 0 && f.comptoir.limites.length === f.comptoir.debuts && f.comptoir.limites.every((s) => s === "set local statement_timeout = '15s';") && f.comptoir.sessions === 0,
    '[C] chaque transaction pose la limite en `set local`, a 15 secondes', `${f.comptoir.debuts} transaction(s), ${JSON.stringify(f.comptoir.limites)}, ${f.comptoir.sessions} pose(s) de session`);
  dire2(f.horsLimite.poses.length === 1 && /^lib\/database\.js: await client\.query\(`set local statement_timeout = '\$\{DUREE_REQUETE\}';`\);$/.test(f.horsLimite.poses[0]) && f.horsLimite.longs.length === 0,
    '[D] la sauvegarde, les exports, le lanceur de migrations et la garde restent hors de la limite, posee nulle part ailleurs', JSON.stringify(f.horsLimite));
  dire2(f.alerte.rendue === `503 ${PHRASE}` && f.alerte.signal === '{"ok":true,"attente":true}' && f.alerte.plantages === 0, '[E] la requete trop longue ne se signale pas comme un plantage', JSON.stringify(f.alerte));
}

async function tout(mutations, dire2) {
  const f = {};
  f.comptoir = await scenarioComptoir(mutations);
  f.enLigne = await scenarioEnLigne(mutations);
  f.horsLimite = scenarioHorsLimite(mutations);
  f.alerte = await scenarioAlerte(mutations);
  juger(f, dire2);
}

const CONTRE_PREUVES = [
  { nom: 'sans-limite-de-duree', lettres: ['[A]', '[B]', '[C]', '[D]'], fichier: DB, de: "    await client.query(`set local statement_timeout = '${DUREE_REQUETE}';`);\n", vers: '', libelle: 'une requete lente tiendrait la journee jusqu a la coupure de l hebergeur' },
  { nom: 'requete-annulee-rendue-brute', lettres: ['[A]', '[B]', '[E]'], fichier: DB, de: "    if (error && error.code === '57014') throw attenteTropLongue();\n", vers: '', libelle: 'la personne lirait le message technique, en ligne « ce creneau vient de changer »' },
  { nom: 'limite-pour-toute-la-session', lettres: ['[C]', '[D]'], fichier: DB, de: "    await client.query(`set local statement_timeout = '${DUREE_REQUETE}';`);\n", vers: "    await client.query(`set statement_timeout = '${DUREE_REQUETE}';`);\n", libelle: 'la limite resterait sur la connexion et suivrait la sauvegarde ou un autre client du gestionnaire' },
  { nom: 'limite-au-demarrage', lettres: ['[D]'], fichier: DB, de: '      connectionTimeoutMillis: 8000,\n', vers: '      connectionTimeoutMillis: 8000,\n      statement_timeout: 15000,\n', libelle: 'la sauvegarde de la nuit et les migrations seraient coupees a 15 secondes' },
];

(async () => {
  if (!CONTRE) {
    await tout([], ok);
    B.sortir('duree-requete-check', echecs, 'une ecriture dure au plus 15 secondes par requete, puis dit de reessayer, sans alerte ; le reste n est pas limite');
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
  B.sortir('duree-requete-check --contre-preuves', echecs, 'chaque garde retiree fait rougir sa lettre');
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

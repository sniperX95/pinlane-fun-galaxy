// UNE ATTENTE SUR UN VERROU EST BORNEE (2026-11-17, point A5 de la verification avant le lancement).
//
// Le trou : les ecritures d une meme journee passent une par une (le verrou de la journee), et chacune
// attend son tour en gardant sa connexion a la base. Sans limite, un samedi de rush empilait les demandes :
// les dix connexions prises par des demandes qui attendent, plus rien pour les autres, et chaque demande
// finissait coupee par l hebergeur, sans reponse. Il n y avait aucun delai, nulle part.
//
// Chaque transaction attend maintenant au plus 5 secondes un verrou (lib/database.js, withTransaction).
// Au-dela, ce n est pas une panne : la personne lit une phrase qui dit de reessayer, et rien ne sonne.
//
// Ce gate monte les VRAIS handlers (comptoir et formulaire en ligne), la vraie lib/database.js et le vrai
// moteur sur la base en memoire du banc (scripts/reserver-banc.js : vraies transactions, vrais verrous de
// journee), et lui apprend la limite d attente de Postgres : `set local lock_timeout`, puis 55P03 quand un
// verrou n arrive pas a temps. Le banc joue le temps cent fois plus vite (5 s en 50 ms).
//   [A] AU COMPTOIR : un poste tient la journee ; un second attend, puis lit la phrase (503). Rien n est
//       ecrit, aucun plantage n est note ; le premier poste finit normalement ;
//   [B] EN LIGNE : la confirmation d un client lit la meme phrase ; ce n est ni « horaires pris », ni une
//       panne transmise au centre ; la retenue des horaires repond 503 et laisse le client avancer ;
//   [C] UNE FILE NORMALE PASSE : le premier finit avant la limite, le second est servi ;
//   [D] LE CALCUL A BLANC de « Modifier » renonce toujours en silence derriere un vrai geste ;
//   [E] L ALERTE : une attente trop longue ne se signale pas comme un plantage ; une vraie erreur, si.
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais touche) fait rougir sa lettre.
'use strict';
const path = require('path');
const B = require('./reserver-banc.js');
const banc = require('./slot-holds-check.js');

const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';
const DB = 'lib/database.js';
const SIGNAL = 'lib/garde-serveur.js';
const CONTRE = process.argv.includes('--contre-preuves');
const PHRASE = 'Beaucoup de demandes arrivent en même temps. Réessayez dans un instant.';
const ECHELLE = 100; // le banc joue 5 s en 50 ms
const PATIENCE = 1500; // au-dela, le second poste « attend toujours »

let echecs = 0;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  return cond;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// La limite d attente de Postgres, apprise au banc.
// ---------------------------------------------------------------------------
const tenus = new Map(); // cle du verrou de journee -> transaction qui le tient
const course = { arret: null, journal: [] };
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
  course.journal.push({ s, params });
  const limite = /^set local lock_timeout = '(\d+)(ms|s)';?$/.exec(s);
  if (limite && tx) {
    tx.attenteMax = Number(limite[1]) * (limite[2] === 's' ? 1000 : 1);
    return { rows: [], rowCount: 0 };
  }
  if (course.arret && course.arret.quand(s)) {
    const arret = course.arret;
    course.arret = null;
    arret.atteint();
    await arret.reprise;
  }
  if (tx && /^select pg_advisory_xact_lock\(hashtext\(\$1\)\);?$/.test(s)) {
    const cle = String(params[0]);
    const fin = tx.attenteMax ? Date.now() + tx.attenteMax / ECHELLE : Infinity;
    for (;;) {
      const autre = tenus.get(cle);
      if (!autre || autre === tx || autre.fini) break;
      const reste = fin - Date.now();
      if (reste <= 0) {
        // Postgres : la requete est annulee, la transaction est en echec jusqu a son ROLLBACK.
        this.tx.abandonnee = true;
        throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
      }
      await Promise.race([autre.promesse, pause(Math.min(reste, 10))]);
    }
    tenus.set(cle, tx);
  }
  return queryDuBanc.call(this, sql, params);
};
function poserArret(quand) {
  let atteint; let reprendre;
  const promesseAtteint = new Promise((resolve) => { atteint = resolve; });
  const reprise = new Promise((resolve) => { reprendre = resolve; });
  course.arret = { quand, atteint, reprise };
  return { atteint: promesseAtteint, reprendre };
}

const BOWLING = (nom, heure) => B.corpsStaff({ type: 'bowling', pax: 4, startTime: heure, duration: 1, totalDuration: 1, lanes: [], laneCount: 1, requiresLanes: true, channel: 'staff', name: nom });
const dire = (r) => `${r.statut} ${r.json.message || r.json.error || ''}`.trim();
const noms = () => [...B.base.reservations.values()].map((r) => r.name).sort().join(', ');
const plantagesNotes = () => course.journal.filter((x) => /^insert into client_errors/.test(x.s)).length;
const tracesDe = (action) => course.journal.filter((x) => /^insert into audit_log/i.test(x.s) && (x.params || []).includes(action)).length;

function monter(mutations) {
  const m = B.monter({ mutations, session: B.sessionDuRole('direction', { nom: 'Ansar' }) });
  course.arret = null;
  course.journal.length = 0;
  tenus.clear();
  return m;
}
// Un poste tient la journee : sa creation s arrete juste avant d ecrire, le verrou pris.
async function tenirLaJournee(m) {
  const arret = poserArret((s) => s.startsWith('insert into reservations ('));
  const premier = m.appeler('POST', URL_RESA, BOWLING('Premier', '15:00'));
  const tenu = await Promise.race([arret.atteint.then(() => 'tient la journée'), premier.then((r) => `fini avant : ${dire(r)}`)]);
  return { arret, premier, tenu };
}
const ouPatience = (promesse) => Promise.race([promesse, pause(PATIENCE).then(() => 'attend toujours')]);

async function scenarioComptoir(mutations = []) {
  B.semer([]);
  const m = monter(mutations);
  const f = {};
  const { arret, premier, tenu } = await tenirLaJournee(m);
  f.tenu = tenu;
  const second = m.appeler('POST', URL_RESA, BOWLING('Second', '17:00'));
  const vu = await ouPatience(second);
  f.second = vu === 'attend toujours' ? vu : dire(vu);
  f.code = vu === 'attend toujours' ? '' : String(vu.json.code || '');
  f.plantages = plantagesNotes();
  f.pendant = noms();
  arret.reprendre();
  f.premier = (await premier).statut;
  await second;
  f.apres = noms();
  return f;
}

async function scenarioEnLigne(mutations = []) {
  const f = {};
  B.semer([]);
  let m = monter(mutations);
  let tenue = await tenirLaJournee(m);
  const confirmation = banc.confirmer(m.S, banc.avecContact(banc.BOWLING('17:00'), 3));
  const vu = await ouPatience(confirmation);
  f.confirmation = vu === 'attend toujours' ? vu : dire(vu);
  f.codeConfirmation = vu === 'attend toujours' ? '' : String(vu.json.code || '');
  f.alternatives = vu === 'attend toujours' ? 0 : (vu.json.alternatives || []).length;
  tenue.arret.reprendre();
  await tenue.premier;
  await confirmation;
  f.pannesTracees = tracesDe('reservation.panne');
  f.plantages = plantagesNotes();
  f.apres = noms();
  // La retenue des horaires, dans la meme file.
  B.semer([]);
  m = monter(mutations);
  tenue = await tenirLaJournee(m);
  const retenue = banc.retenir(m.S, banc.BOWLING('17:00'));
  const vuRetenue = await ouPatience(retenue);
  f.retenue = vuRetenue === 'attend toujours' ? vuRetenue : dire(vuRetenue);
  f.codeRetenue = vuRetenue === 'attend toujours' ? '' : String(vuRetenue.json.code || '');
  tenue.arret.reprendre();
  await tenue.premier;
  await retenue;
  f.retenuePannes = tracesDe('blocage.panne');
  return f;
}

async function scenarioFileNormale(mutations = []) {
  B.semer([]);
  const m = monter(mutations);
  const f = {};
  const { arret, premier } = await tenirLaJournee(m);
  const second = m.appeler('POST', URL_RESA, BOWLING('Second', '17:00'));
  // Le premier finit bien avant la limite (10 ms sur 50).
  await pause(10);
  arret.reprendre();
  f.premier = (await premier).statut;
  f.second = dire(await second);
  f.apres = noms();
  return f;
}

async function scenarioCalculABlanc(mutations = []) {
  B.semer([B.ligne(801, { start_time: '18:00', lanes: [3], name: 'Dossier 801' })]);
  const m = monter(mutations);
  const f = {};
  const version = new Date(B.base.reservations.get(801).updated_at).toISOString();
  const { arret, premier } = await tenirLaJournee(m);
  const blanc = m.appeler('POST', URL_RESA, { dryRun: true, modification: { id: 801, centerId: 'libramont', baseUpdatedAt: version, startTime: '19:00', lanes: [3] } });
  const vu = await ouPatience(blanc);
  f.blanc = vu === 'attend toujours' ? vu : `${vu.statut} ${JSON.stringify(vu.json)}`;
  arret.reprendre();
  await premier;
  await blanc;
  f.enBase = B.base.reservations.get(801).start_time;
  return f;
}

async function scenarioAlerte(mutations = []) {
  B.semer([]);
  monter(mutations);
  const f = {};
  const { signalerPanneServeur } = require(path.join(ROOT, SIGNAL));
  const attente = Object.assign(new Error(PHRASE), { statusCode: 503, code: 'occupe', expose: true, attenteDeVerrou: true });
  course.journal.length = 0;
  const r = await signalerPanneServeur('api/banc', attente);
  await pause(30);
  f.attente = `${JSON.stringify(r)} ${plantagesNotes()}`;
  await signalerPanneServeur('api/banc', new Error('relation "x" does not exist'));
  await pause(30);
  f.vraieErreur = plantagesNotes();
  return f;
}

function jugerComptoir(f, dire2) {
  dire2(f.tenu === 'tient la journée', 'MONTAGE le premier poste tient le verrou de la journée, sa création pas encore écrite', f.tenu);
  dire2(f.second === `503 ${PHRASE}`, '[A] le second poste attend, puis lit la phrase qui dit de réessayer (503)', f.second);
  dire2(f.pendant === '' && f.plantages === 0, '[A] rien n est écrit, aucun plantage n est noté', `${f.pendant} / ${f.plantages}`);
  dire2(f.premier === 201 && f.apres === 'Premier', '[A] le premier poste finit normalement, un seul dossier en base', `${f.premier} / ${f.apres}`);
}
function jugerEnLigne(f, dire2) {
  dire2(f.confirmation === `503 ${PHRASE}`, '[B] la confirmation en ligne lit la même phrase (503)', f.confirmation);
  dire2(f.codeConfirmation !== 'transmise_au_centre' && f.alternatives === 0 && f.pannesTracees === 0 && f.plantages === 0, '[B] ni « horaires pris », ni panne transmise au centre, ni plantage noté', `${f.codeConfirmation} / ${f.alternatives} alternative(s) / ${f.pannesTracees} panne(s) tracée(s) / ${f.plantages}`);
  dire2(f.apres === 'Premier', '[B] aucune réservation en ligne n est écrite', f.apres);
  dire2(/^503 /.test(f.retenue) && !['slot_taken', 'slot_unavailable', 'hold_unavailable'].includes(f.codeRetenue) && f.retenuePannes === 0, '[B] la retenue des horaires répond 503 sans « horaires pris » ni panne : le client avance sans retenue', `${f.retenue} / ${f.codeRetenue} / ${f.retenuePannes}`);
}
function jugerFileNormale(f, dire2) {
  dire2(f.premier === 201 && /^201/.test(f.second) && f.apres === 'Premier, Second', '[C] une file normale passe : les deux postes sont servis', `${f.premier} / ${f.second} / ${f.apres}`);
}
function jugerCalculABlanc(f, dire2) {
  dire2(f.blanc === '200 {"ok":true,"dryRun":true}' && f.enBase === '18:00', '[D] le calcul à blanc renonce en silence derrière un vrai geste, rien n est écrit', `${f.blanc} / ${f.enBase}`);
}
function jugerAlerte(f, dire2) {
  dire2(f.attente === '{"ok":true,"attente":true} 0', '[E] une attente trop longue ne se signale pas comme un plantage', f.attente);
  dire2(f.vraieErreur >= 1, '[E] une vraie erreur du serveur se note toujours', String(f.vraieErreur));
}

async function tout(mutations, dire2) {
  jugerComptoir(await scenarioComptoir(mutations), dire2);
  jugerEnLigne(await scenarioEnLigne(mutations), dire2);
  jugerFileNormale(await scenarioFileNormale(mutations), dire2);
  jugerCalculABlanc(await scenarioCalculABlanc(mutations), dire2);
  jugerAlerte(await scenarioAlerte(mutations), dire2);
}

const CONTRE_PREUVES = [
  { nom: 'sans-limite-d-attente', lettres: ['[A]', '[B]'], fichier: DB, de: "    await client.query(`set local lock_timeout = '${ATTENTE_VERROU}';`);\n", vers: '', libelle: 'les demandes s empileraient sans fin' },
  { nom: 'attente-rendue-brute', lettres: ['[A]', '[B]'], fichier: DB, de: "    if (error && error.code === '55P03') throw attenteTropLongue();\n", vers: '', libelle: 'la personne lirait le message technique de la base' },
  { nom: 'calcul-a-blanc-bruyant', lettres: ['[D]'], fichier: DB, de: '      if (error && error.attenteDeVerrou) return null;\n', vers: '', libelle: 'la console afficherait une erreur a chaque frappe pendant un vrai geste' },
  { nom: 'attente-qui-sonne', lettres: ['[E]'], fichier: SIGNAL, de: '  if (error && error.attenteDeVerrou) return Promise.resolve({ ok: true, attente: true });\n', vers: '', libelle: 'une file trop longue ferait sonner une panne' },
];

(async () => {
  if (!CONTRE) {
    await tout([], ok);
    B.sortir('attente-verrou-check', echecs, 'une écriture attend son tour au plus 5 secondes, puis dit de réessayer, sans alerte');
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
    ok(c.lettres.every((lettre) => rouges.has(lettre)), `contre-preuve « ${c.nom} » : ${c.lettres.join(' et ')} ROUGISSENT (${c.libelle})`, mesure);
  }
  let propres = 0;
  await tout([], (cond) => { if (!cond) propres += 1; });
  ok(propres === 0, 'aucune mutation ne survit : tout repasse au vert sur le code du disque');
  B.sortir('attente-verrou-check --contre-preuves', echecs, 'chaque garde retirée fait rougir sa lettre');
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

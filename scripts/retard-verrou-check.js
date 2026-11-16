// LE PLAN DE RETARD VERROUILLE SES DOSSIERS (2026-11-16, partie A de la verification avant le lancement).
//
// Le trou, lu sur le code : applyReservationScheduleUpdates prenait le verrou de la journee, relisait la
// journee, puis ecrivait chaque dossier par `where id = $1`, sans verrou de ligne et sans version. Or
// « Modifier » qui envoie un dossier vers un AUTRE jour ne prend que le verrou de ce jour-la, puis la
// ligne : les deux gestes ne s attendaient pas. Le retard posait alors son heure, ses pistes et son plan
// sur un dossier parti ailleurs, sans aucun controle de place la-bas. Et le plan, calcule AVANT la
// transaction sur une lecture, repassait par-dessus une modification du meme jour validee entre-temps.
//
// Ce gate monte la vraie lib/database.js et le vrai api/ops.js sur la base en memoire du banc
// (scripts/reserver-banc.js : vraies transactions, vrais verrous de journee) et y ajoute de VRAIS verrous
// de ligne : `select ... for update` et `update ... where id = $1` attendent la transaction qui tient la
// ligne, puis relisent, comme Postgres en READ COMMITTED. Deux postes y jouent pour de bon.
//   [A] LA COURSE : le poste B envoie un dossier vers un autre jour et tient sa ligne ; le poste A
//       applique un retard. Le retard attend, relit, refuse (409) ; le dossier garde le jour et l heure
//       du poste B. L ordre des verrous : la journee, puis les lignes, puis la relecture de la journee ;
//   [B] LA VERSION : un dossier modifie le meme jour depuis la lecture du plan arrete le plan, rien n est
//       ecrit ; version illisible, refus ; version a jour, le retard passe ; un seul dossier perime
//       arrete tout le plan (l autre n est pas ecrit) ;
//   [C] LES TROIS GESTES DE LA CONSOLE (api/ops.js) partent avec la version lue : appliquer un retard
//       (le dossier en retard, et chaque dossier pousse), retirer l indicateur, retirer le retard (avec ou
//       sans creneau d origine, et chaque dossier remis a sa place). Un collegue ecrit entre la lecture
//       du geste et son verrou : 409, rien n est ecrit ; sans collegue, le geste passe.
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais touche) fait rougir sa lettre.
'use strict';
const path = require('path');
const B = require('./reserver-banc.js');

const ROOT = B.ROOT;
const DB = 'lib/database.js';
const OPS = 'api/ops.js';
const CONTRE = process.argv.includes('--contre-preuves');
const JOUR = B.JOUR;
// Un autre jour ouvert : le meme jour de semaine, la semaine d apres (au plus tot).
const AUTRE = (() => {
  const { jourDeTest, plusJours } = require('./jour-de-test');
  for (let depuis = 8; depuis < 400; depuis += 7) {
    const jour = jourDeTest({ jour: 6, depuis });
    if (jour > JOUR) return jour;
    void plusJours;
  }
  throw new Error('aucun autre jour de test');
})();

let echecs = 0;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  return cond;
}

// ---------------------------------------------------------------------------
// LES VERROUS DE LIGNE, et l ecriture du retard que le banc ne connait pas.
// ---------------------------------------------------------------------------
const DATES = ['created_at', 'updated_at', 'expires_at', 'released_at', 'paid_at', 'absent_at'];
const copieLigne = (row) => JSON.parse(JSON.stringify(row), (k, v) => (DATES.includes(k) && v ? new Date(v) : v));
const ECRITURE_DU_RETARD = 'update reservations set start_time = $2, lanes = $3::int[], ops_plan = $4::jsonb, notes = $5, updated_at = now() where id = $1 returning *;';
const VERROU_DE_LIGNE = /^select \* from reservations where id = \$1 for update;?$/;
const ECRITURE_D_UNE_LIGNE = /^update reservations set .* where id = \$1 returning \*;?$/;
const tenues = new Map(); // numero du dossier -> transaction qui tient sa ligne
const course = { arret: null, attentes: [], journal: [] };

async function prendreLaLigne(tx, id) {
  if (!tx) return;
  for (;;) {
    const autre = tenues.get(id);
    if (!autre || autre === tx || autre.fini) { tenues.set(id, tx); return; }
    course.attentes.splice(0).forEach((prevenir) => prevenir(id));
    await autre.promesse;
  }
}

const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
  course.journal.push({ tx, s });
  if (course.arret && course.arret.quand(s)) {
    const arret = course.arret;
    course.arret = null;
    arret.atteint();
    await arret.reprise;
  }
  if (VERROU_DE_LIGNE.test(s) || ECRITURE_D_UNE_LIGNE.test(s)) await prendreLaLigne(tx, Number(params[0]));
  if (s === ECRITURE_DU_RETARD) {
    // Apres l attente : la ligne telle qu elle est validee maintenant (READ COMMITTED).
    const avant = (tx && tx.reservations.get(Number(params[0]))) || B.base.reservations.get(Number(params[0]));
    if (!avant) return { rows: [], rowCount: 0 };
    const precedent = avant.updated_at ? new Date(avant.updated_at).getTime() : 0;
    const row = { ...avant, start_time: params[1], lanes: (params[2] || []).map(Number), ops_plan: params[3] ? JSON.parse(params[3]) : null, notes: params[4], updated_at: new Date(Math.max(Date.now(), precedent + 1)) };
    if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
    return { rows: [copieLigne(row)], rowCount: 1 };
  }
  return queryDuBanc.call(this, sql, params);
};

// Une transaction s arrete juste avant la requete choisie ; `reprendre` la relance.
function poserArret(quand) {
  let atteint; let reprendre;
  const promesseAtteint = new Promise((resolve) => { atteint = resolve; });
  const reprise = new Promise((resolve) => { reprendre = resolve; });
  course.arret = { quand, atteint, reprise };
  return { atteint: promesseAtteint, reprendre };
}

const enBase = (id) => B.base.reservations.get(Number(id));
const version = (id) => new Date(enBase(id).updated_at).toISOString();
const bloc = (heure, piste) => {
  const [h, m] = heure.split(':').map(Number);
  const fin = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return { resourceBlocks: [{ type: 'activity', activityId: 'bowling', resourceType: 'bowling_lane', startTime: heure, endTime: fin, lanes: [piste], durationMinutes: 60, players: 4 }] };
};
const dossier = (id, heure, piste, champs = {}) => B.ligne(id, { start_time: heure, lanes: [piste], name: `Groupe ${id}`, ops_plan: bloc(heure, piste), absent_at: null, amount_paid: null, discount_reason: null, ...champs });
// Le collegue qui valide une ecriture sur un dossier, hors de toute transaction du poste A.
function collegueEcrit(id, champs) {
  const avant = enBase(id);
  B.base.reservations.set(Number(id), { ...avant, ...champs, updated_at: new Date(new Date(avant.updated_at).getTime() + 5000) });
}
const etat = (id) => { const r = enBase(id); return r ? `${r.date} ${r.start_time} piste ${(r.lanes || []).join('+')}` : 'absent'; };

function monter(mutations) {
  const m = B.monter({ mutations, session: B.sessionDuRole('direction', { nom: 'Ansar' }) });
  m.db = require(path.join(ROOT, DB));
  m.ops = require(path.join(ROOT, OPS));
  m.clic = async (corps) => {
    const r = await B.appeler(m.ops, 'POST', '/api/ops', { centerId: 'libramont', ...corps });
    return { statut: r.statut, code: r.json.code || '', message: r.json.message || r.json.error || '', json: r.json };
  };
  return m;
}
const issue = (promesse) => promesse.then((valeur) => ({ ecrit: valeur }), (erreur) => ({ refus: erreur, statut: erreur.statusCode || 0, code: erreur.code || '', message: erreur.message }));

// ---------------------------------------------------------------------------
// [A] LA COURSE entre « Modifier vers un autre jour » et le plan de retard.
// ---------------------------------------------------------------------------
async function scenarioCourse(mutations = []) {
  B.semer([dossier(701, '15:00', 1), dossier(702, '17:00', 2)]);
  const m = monter(mutations);
  const f = {};
  const lue = version(701);
  // Poste B : envoie le 701 au samedi suivant, 18:00. Il tient la ligne, il n a pas encore valide.
  const arret = poserArret((s) => s.startsWith('update reservations set center_id = $2'));
  const posteB = issue(m.db.updateReservation({ id: 701, centerId: 'libramont', baseUpdatedAt: lue, date: AUTRE, startTime: '18:00', lanes: [1], opsPlan: bloc('18:00', 1), skipReplan: true }));
  const tenu = await Promise.race([arret.atteint.then(() => 'tient la ligne'), posteB.then((x) => `fini avant : ${x.message || 'ecrit'}`)]);
  f.posteBTientLaLigne = tenu;
  // Poste A : le retard du jour, calcule quand le 701 etait encore a 15:00 ce jour-la.
  course.journal.length = 0;
  const attend = new Promise((resolve) => course.attentes.push(resolve));
  const posteA = issue(m.db.applyReservationScheduleUpdates({ centerId: 'libramont', date: JOUR, updates: [{ id: 701, baseUpdatedAt: lue, startTime: '15:15', lanes: [1], opsPlan: bloc('15:15', 1), noteAppend: 'Retard +15 min.' }] }));
  f.posteAAttend = await Promise.race([attend.then(() => 'attend la ligne'), posteA.then(() => 'n attend pas')]);
  arret.reprendre();
  const b = await posteB;
  const a = await posteA;
  f.posteB = b.ecrit ? 'ecrit' : `refus ${b.message}`;
  f.posteA = a.ecrit ? 'ecrit' : `${a.statut} ${a.code}`;
  f.message = a.message || '';
  f.enBase = etat(701);
  f.note = enBase(701).notes || '';
  // L ordre des verrous du poste A : la journee, la ligne, puis la relecture de la journee.
  const duPosteA = course.journal.filter((x) => x.tx && x.s !== 'BEGIN').map((x) => x.s);
  const txA = course.journal.filter((x) => x.tx && /pg_advisory_xact_lock/.test(x.s)).map((x) => x.tx)[0];
  const suite = course.journal.filter((x) => x.tx === txA).map((x) => x.s);
  f.ordre = [suite.findIndex((s) => /pg_advisory_xact_lock/.test(s)), suite.findIndex((s) => VERROU_DE_LIGNE.test(s)), suite.findIndex((s) => /^select \* from reservations where date = \$1/.test(s))];
  void duPosteA;
  return f;
}

// ---------------------------------------------------------------------------
// [B] LA VERSION, sur la fonction.
// ---------------------------------------------------------------------------
async function scenarioVersion(mutations = []) {
  B.semer([dossier(711, '15:00', 3), dossier(712, '16:00', 3)]);
  const m = monter(mutations);
  const f = {};
  const lue711 = version(711);
  const lue712 = version(712);
  // Le collegue passe le 711 a 19:00 le meme jour, apres la lecture du plan.
  collegueEcrit(711, { start_time: '19:00', ops_plan: bloc('19:00', 3) });
  const perime = await issue(m.db.applyReservationScheduleUpdates({ centerId: 'libramont', date: JOUR, updates: [
    { id: 712, baseUpdatedAt: lue712, startTime: '16:15', lanes: [3], opsPlan: bloc('16:15', 3) },
    { id: 711, baseUpdatedAt: lue711, startTime: '15:15', lanes: [3], opsPlan: bloc('15:15', 3) },
  ] }));
  f.perime = perime.ecrit ? 'ecrit' : `${perime.statut} ${perime.code}`;
  f.apresPerime = `${etat(711)} | ${etat(712)}`;
  const illisible = await issue(m.db.applyReservationScheduleUpdates({ centerId: 'libramont', date: JOUR, updates: [{ id: 712, baseUpdatedAt: 'hier soir', startTime: '16:15', lanes: [3], opsPlan: bloc('16:15', 3) }] }));
  f.illisible = illisible.ecrit ? 'ecrit' : `${illisible.statut} ${illisible.code}`;
  const aJour = await issue(m.db.applyReservationScheduleUpdates({ centerId: 'libramont', date: JOUR, updates: [{ id: 712, baseUpdatedAt: version(712), startTime: '16:15', lanes: [3], opsPlan: bloc('16:15', 3) }] }));
  f.aJour = aJour.ecrit ? `ecrit ${etat(712)}` : `${aJour.statut} ${aJour.message}`;
  // Un dossier parti sur un autre jour (deja valide) : le plan s arrete, sans version non plus.
  collegueEcrit(712, { date: AUTRE });
  const parti = await issue(m.db.applyReservationScheduleUpdates({ centerId: 'libramont', date: JOUR, updates: [{ id: 712, startTime: '16:30', lanes: [3] }] }));
  f.parti = parti.ecrit ? 'ecrit' : `${parti.statut} ${parti.code}`;
  f.apresParti = etat(712);
  return f;
}

// ---------------------------------------------------------------------------
// [C] LES GESTES DE LA CONSOLE : un collegue ecrit entre la lecture du geste et son verrou.
// ---------------------------------------------------------------------------
const drapeau = (champs = {}) => ({ minutes: 15, from: '15:00', to: '15:15', flaggedAt: '2026-11-16T10:00:00.000Z', cleared: false, ...champs });
// Le 721 a pris 15 min de retard (15:00 vers 15:15) ; il a pousse le 722 (16:00 vers 16:15).
const RETARD_POSE = (origine = true) => [
  dossier(721, '15:15', 4, { ops_plan: { ...bloc('15:15', 4), delayFlag: drapeau(origine ? { origin: { startTime: '15:00', opsPlan: bloc('15:00', 4), lanes: [4] } } : {}) } }),
  dossier(722, '16:15', 4, { ops_plan: { ...bloc('16:15', 4), delayFlag: drapeau({ from: '16:00', to: '16:15', sourceId: 721, origin: { startTime: '16:00', opsPlan: bloc('16:00', 4), lanes: [4] } }) } }),
];

async function unGeste(mutations, { lignes, corps, collegue }) {
  B.semer(lignes);
  const m = monter(mutations);
  // Le collegue valide son ecriture au moment ou le geste demande son verrou de journee : apres la
  // lecture du geste, avant sa transaction.
  if (collegue) B.base.avantVerrou = collegue;
  const r = await m.clic(corps);
  return { statut: r.statut, message: r.message, json: r.json };
}

async function scenarioGestes(mutations = []) {
  const f = {};
  // Retirer l indicateur : le collegue vient de passer le dossier a 19:00.
  let r = await unGeste(mutations, { lignes: RETARD_POSE(), corps: { action: 'delayClear', reservationId: 721 }, collegue: () => collegueEcrit(721, { start_time: '19:00', ops_plan: { ...bloc('19:00', 4), delayFlag: drapeau() } }) });
  f.indicateur = `${r.statut} ${etat(721)}`;
  r = await unGeste(mutations, { lignes: RETARD_POSE(), corps: { action: 'delayClear', reservationId: 721 } });
  f.indicateurSeul = `${r.statut} ${r.json.cleared === true} ${etat(721)} ${enBase(721).ops_plan.delayFlag.cleared === true}`;
  // Retirer le retard, creneau d origine connu : le collegue vient de passer le dossier a 19:00.
  r = await unGeste(mutations, { lignes: RETARD_POSE(), corps: { action: 'delayRevert', reservationId: 721 }, collegue: () => collegueEcrit(721, { start_time: '19:00', ops_plan: { ...bloc('19:00', 4), delayFlag: drapeau({ origin: { startTime: '15:00', opsPlan: bloc('15:00', 4), lanes: [4] } }) } }) });
  f.retrait = `${r.statut} ${etat(721)}`;
  // Retirer le retard : le collegue vient de deplacer le dossier POUSSE (722) a 20:00.
  r = await unGeste(mutations, { lignes: RETARD_POSE(), corps: { action: 'delayRevert', reservationId: 721 }, collegue: () => collegueEcrit(722, { start_time: '20:00', ops_plan: { ...bloc('20:00', 4), delayFlag: drapeau({ from: '16:00', to: '16:15', sourceId: 721, origin: { startTime: '16:00', opsPlan: bloc('16:00', 4), lanes: [4] } }) } }) });
  f.retraitPousse = `${r.statut} ${etat(721)} | ${etat(722)}`;
  r = await unGeste(mutations, { lignes: RETARD_POSE(), corps: { action: 'delayRevert', reservationId: 721 } });
  f.retraitSeul = `${r.statut} ${etat(721)} | ${etat(722)}`;
  // Retirer le retard, sans creneau d origine (retard ancien) : meme collegue.
  r = await unGeste(mutations, { lignes: RETARD_POSE(false), corps: { action: 'delayRevert', reservationId: 721 }, collegue: () => collegueEcrit(721, { start_time: '19:00', ops_plan: { ...bloc('19:00', 4), delayFlag: drapeau() } }) });
  f.retraitSansOrigine = `${r.statut} ${etat(721)}`;
  // Appliquer un retard de 15 min au 731 (15:00, piste 5) ; le 732 le suit sur la meme piste a 16:00.
  const DEUX = () => [dossier(731, '15:00', 5), dossier(732, '16:00', 5)];
  const retard = { action: 'delayApply', reservationId: 731, delayMinutes: 15, reasonId: 'late_customer', strategyId: 'cascade' };
  r = await unGeste(mutations, { lignes: DEUX(), corps: retard });
  f.retardSeul = `${r.statut} ${etat(731)} | ${etat(732)}`;
  f.retardMessage = r.message;
  r = await unGeste(mutations, { lignes: DEUX(), corps: retard, collegue: () => collegueEcrit(731, { pax: 6, notes: 'Deux joueurs de plus' }) });
  f.retardCible = `${r.statut} ${etat(731)} ${enBase(731).notes}`;
  r = await unGeste(mutations, { lignes: DEUX(), corps: retard, collegue: () => collegueEcrit(732, { notes: 'Gateau au frigo' }) });
  f.retardPousse = `${r.statut} ${etat(731)} | ${etat(732)} ${enBase(732).notes}`;
  return f;
}

// ---------------------------------------------------------------------------
// LES VERDICTS.
// ---------------------------------------------------------------------------
function jugerCourse(f, dire) {
  dire(f.posteBTientLaLigne === 'tient la ligne', 'MONTAGE le poste B tient la ligne du dossier, sa modification pas encore validee', f.posteBTientLaLigne);
  dire(f.posteB === 'ecrit', 'MONTAGE la modification du poste B (autre jour, 18:00) est validee', f.posteB);
  dire(f.posteAAttend === 'attend la ligne', '[A] le retard attend la ligne que le poste B tient', f.posteAAttend);
  dire(f.posteA === '409 planning_change' && /Relancez l.analyse/.test(f.message), '[A] puis il relit et refuse : 409, « Relancez l analyse »', `${f.posteA} ${f.message}`);
  dire(f.enBase === `${AUTRE} 18:00 piste 1` && f.note === '', '[A] le dossier garde le jour et l heure du poste B, sans note de retard', `${f.enBase} / ${f.note}`);
  dire(f.ordre[0] >= 0 && f.ordre[1] > f.ordre[0] && (f.ordre[2] === -1 || f.ordre[2] > f.ordre[1]), '[A] l ordre des verrous : la journee, puis la ligne, puis la relecture de la journee', f.ordre);
}
function jugerVersion(f, dire) {
  dire(f.perime === '409 planning_change', '[B] un dossier modifie depuis la lecture du plan : 409', f.perime);
  dire(f.apresPerime === `${JOUR} 19:00 piste 3 | ${JOUR} 16:00 piste 3`, '[B] rien n est ecrit : ni le dossier modifie, ni l autre dossier du plan', f.apresPerime);
  dire(f.illisible === '409 planning_change', '[B] une version illisible refuse, elle ne saute pas le controle', f.illisible);
  dire(f.aJour === `ecrit ${JOUR} 16:15 piste 3`, '[B] version a jour : le retard passe', f.aJour);
  dire(f.parti === '409 planning_change' && f.apresParti === `${AUTRE} 16:15 piste 3`, '[B] un dossier parti sur un autre jour arrete le plan, meme sans version', `${f.parti} ${f.apresParti}`);
}
function jugerGestes(f, dire) {
  dire(f.indicateurSeul === `200 true ${JOUR} 15:15 piste 4 true`, 'MONTAGE retirer l indicateur, sans collegue : 200, l heure reste, l indicateur est retire', f.indicateurSeul);
  dire(f.indicateur === `409 ${JOUR} 19:00 piste 4`, '[C] retirer l indicateur d un dossier que le collegue vient de deplacer : 409, son heure reste', f.indicateur);
  dire(f.retraitSeul === `200 ${JOUR} 15:00 piste 4 | ${JOUR} 16:00 piste 4`, 'MONTAGE retirer le retard, sans collegue : 200, les deux dossiers reviennent a leur heure', f.retraitSeul);
  dire(f.retrait === `409 ${JOUR} 19:00 piste 4`, '[C] retirer le retard d un dossier que le collegue vient de deplacer : 409, son heure reste', f.retrait);
  dire(f.retraitPousse === `409 ${JOUR} 15:15 piste 4 | ${JOUR} 20:00 piste 4`, '[C] retirer le retard quand le dossier pousse vient d etre deplace : 409, rien ne bouge', f.retraitPousse);
  dire(f.retraitSansOrigine === `409 ${JOUR} 19:00 piste 4`, '[C] retirer un retard ancien (sans creneau d origine) sur un dossier deplace : 409', f.retraitSansOrigine);
  dire(f.retardSeul === `200 ${JOUR} 15:15 piste 5 | ${JOUR} 16:15 piste 5`, 'MONTAGE appliquer 15 min de retard, sans collegue : 200, le dossier et son suivant decalent', `${f.retardSeul} ${f.retardMessage}`);
  dire(f.retardCible === `409 ${JOUR} 15:00 piste 5 Deux joueurs de plus`, '[C] appliquer un retard a un dossier que le collegue vient de modifier : 409, sa note reste', f.retardCible);
  dire(f.retardPousse === `409 ${JOUR} 15:00 piste 5 | ${JOUR} 16:00 piste 5 Gateau au frigo`, '[C] appliquer un retard quand le dossier pousse vient d etre modifie : 409, rien ne bouge', f.retardPousse);
}

const VERROU = "      const verrou = await client.query('select * from reservations where id = $1 for update;', [numero]);";
const CONTRE_PREUVES = [
  { nom: 'ligne-lue-sans-verrou', lettre: '[A]', fichier: DB, de: VERROU, vers: "      const verrou = await client.query('select * from reservations where id = $1 limit 1;', [numero]);", scenario: scenarioCourse, juger: jugerCourse, libelle: 'le retard s ecrirait sur un dossier parti sur un autre jour' },
  // La relecture de la journee, faite apres les verrous, arrete encore ce dossier : c est le refus clair
  // (409, « Relancez l analyse ») que cette garde porte, et elle seule ne depend pas de l ordre des lectures.
  { nom: 'jour-pas-relu-sous-verrou', lettre: '[B]', fichier: DB, de: '      if (!surCeJour) throw planDeRetardPerime();', vers: '      if (!ligne) throw planDeRetardPerime();', scenario: scenarioVersion, juger: jugerVersion, libelle: 'un dossier parti ailleurs ne rendrait plus le refus clair du plan perime' },
  { nom: 'version-pas-comparee', lettre: '[B]', fichier: DB, de: '      if (!memeVersion(versionsSousVerrou.get(Number(update.id)), attendue)) throw planDeRetardPerime();', vers: '', scenario: scenarioVersion, juger: jugerVersion, libelle: 'le plan repasserait sur la modification du collegue' },
  { nom: 'indicateur-sans-version', lettre: '[C]', fichier: OPS, de: "        id: reservationId,\n        baseUpdatedAt: reservation.updatedAt,\n        startTime: reservation.startTime,", vers: "        id: reservationId,\n        startTime: reservation.startTime,", scenario: scenarioGestes, juger: jugerGestes, libelle: 'retirer l indicateur remettrait l ancienne heure' },
  { nom: 'retrait-sans-version', lettre: '[C]', fichier: OPS, de: "        id: reservationId,\n        baseUpdatedAt: reservation.updatedAt,\n        startTime: origin.startTime,", vers: "        id: reservationId,\n        startTime: origin.startTime,", scenario: scenarioGestes, juger: jugerGestes, libelle: 'retirer le retard remettrait l heure d origine sur un dossier deplace' },
  { nom: 'retrait-ancien-sans-version', lettre: '[C]', fichier: OPS, de: "updates: [{ id: reservationId, baseUpdatedAt: reservation.updatedAt, startTime: reservation.startTime,", vers: "updates: [{ id: reservationId, startTime: reservation.startTime,", scenario: scenarioGestes, juger: jugerGestes, libelle: 'retirer un retard ancien remettrait l ancienne heure' },
  { nom: 'pousses-sans-version', lettre: '[C]', fichier: OPS, de: 'return { id: Number(item.id), baseUpdatedAt: item.updatedAt, startTime: o.startTime,', vers: 'return { id: Number(item.id), startTime: o.startTime,', scenario: scenarioGestes, juger: jugerGestes, libelle: 'un dossier pousse, deplace depuis, reviendrait a son ancienne heure' },
  { nom: 'retard-cible-sans-version', lettre: '[C]', fichier: OPS, de: 'baseUpdatedAt: isTargetReservation ? reservation.updatedAt : (avantCascade ? avantCascade.updatedAt : undefined),', vers: 'baseUpdatedAt: isTargetReservation ? undefined : (avantCascade ? avantCascade.updatedAt : undefined),', scenario: scenarioGestes, juger: jugerGestes, libelle: 'le retard repasserait sur la modification du collegue' },
  { nom: 'retard-pousse-sans-version', lettre: '[C]', fichier: OPS, de: 'baseUpdatedAt: isTargetReservation ? reservation.updatedAt : (avantCascade ? avantCascade.updatedAt : undefined),', vers: 'baseUpdatedAt: isTargetReservation ? reservation.updatedAt : undefined,', scenario: scenarioGestes, juger: jugerGestes, libelle: 'le dossier pousse perdrait la modification du collegue' },
];

(async () => {
  if (!CONTRE) {
    console.log(`[A] la course : « Modifier vers un autre jour » contre le plan de retard (${JOUR} vers ${AUTRE})`);
    jugerCourse(await scenarioCourse(), ok);
    console.log('\n[B] la version de chaque dossier du plan');
    jugerVersion(await scenarioVersion(), ok);
    console.log('\n[C] les gestes de la console partent avec la version lue');
    jugerGestes(await scenarioGestes(), ok);
    B.sortir('retard-verrou-check', echecs, 'le plan de retard verrouille ses dossiers, les relit sous verrou et refuse un dossier ecrit entre-temps');
    return;
  }
  for (const c of CONTRE_PREUVES) {
    let rouges = [];
    let mesure = '';
    try {
      const faits = await c.scenario([{ fichier: c.fichier, de: c.de, vers: c.vers }]);
      c.juger(faits, (cond, label) => { if (!cond && label.startsWith(c.lettre)) rouges.push(label); });
      mesure = JSON.stringify(faits).slice(0, 300);
    } catch (error) {
      mesure = `exception : ${error.message}`;
      rouges = /ancre absente/.test(error.message) ? [] : ['exception'];
    }
    ok(rouges.length > 0, `contre-preuve « ${c.nom} » : ${c.lettre} ROUGIT (${c.libelle})`, mesure);
  }
  // Rien de mute ne survit : un passage propre rend les verdicts verts.
  let propres = 0;
  jugerCourse(await scenarioCourse(), (cond) => { if (!cond) propres += 1; });
  ok(propres === 0, 'aucune mutation ne survit : le scenario [A] repasse au vert sur le code du disque');
  B.sortir('retard-verrou-check --contre-preuves', echecs, 'chaque garde retiree fait rougir sa lettre');
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

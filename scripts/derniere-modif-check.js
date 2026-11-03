// LA DERNIERE MODIFICATION, VISIBLE SANS OUVRIR LE DOSSIER (2026-11-03).
//
// « Modifié 14:20, Julie : 12 → 14 joueurs » : chaque dossier du staff-state la
// porte, la fiche la montre sous ses faits, et les cartes des plannings
// pourront la lire telle quelle (texteDerniereModif, assets/app-main.js).
//
// LE CHOIX : ECRITE AVEC LE DOSSIER, PAS LUE DANS LE JOURNAL. Le staff-state est
// relu par chaque poste a chaque releve ; la lire dans audit_log ferait une
// requete de plus par releve sur une table qui ne se purge pas, dont chaque
// ligne pese l avant/apres complet d un dossier. Ecrite dans ops_plan
// (opsPlan.derniereModif) au moment ou le dossier change, elle arrive avec la
// ligne deja lue (`select *`) : zero requete, zero migration, et elle ne depend
// pas d un journal qui peut perdre une trace sans faire echouer l action.
//
// Ce gate monte le vrai api/staff-reservations.js, le vrai api/staff-state.js,
// la vraie lib/database.js et le vrai moteur sur la journee « pic » de Fun
// Galaxy (scripts/planning-v3-fixtures.js), sur la base en memoire du banc :
//   [S] l ecriture : joueurs, heure, deplacement du planning, au nom de la
//       session ; jamais du corps (ni le resume, ni l auteur) ; rien de vendu
//       qui change, rien qui s ecrit ; un dossier sans plan n en recoit pas ; un
//       appel sans auteur (simulation) et un retard gardent la precedente ; le
//       plan du moteur n en est pas change.
//   [L] la lecture : le staff-state la porte, sans une requete de plus et sans
//       jamais lire le journal, qu un dossier ou quatre aient change.
//   [C] la console : la phrase (heure, hier, date, qui, combien), la fiche se
//       redessine quand elle change.
//
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais
// touche), la ligne qui la prouve doit rougir.
//
// Zero reseau, zero base, rien ne part.
// Lancement : node scripts/derniere-modif-check.js [--contre-preuves]
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./reserver-banc.js');
const FX = require('./planning-v3-fixtures');

const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
const SOLO = 1633; // bowling 14:00, piste 7, 5 joueurs, 39 €
const NOEL = 1637; // bowling 16:30, piste 6, 4 joueurs
const VOISINS = [1610, 1613, 1615]; // trois bowlings du matin

// L heure de la journee de la fixture (scripts/heures-du-dossier-check.js) : le
// serveur juge « passe » et « aujourd hui » sur Date.
const VraieDate = Date;
async function auJour(travail, heure = '15:10') {
  const ecart = new VraieDate(FX.instant(JOUR, heure)).getTime() - VraieDate.now();
  class Fausse extends VraieDate {
    constructor(...a) { if (a.length === 0) super(VraieDate.now() + ecart); else super(...a); }
    static now() { return VraieDate.now() + ecart; }
  }
  global.Date = Fausse;
  try { return await travail(); } finally { global.Date = VraieDate; }
}

// ---------------------------------------------------------------------------
// Ce que le banc ne connait pas : l ecriture d un retard, et le compte des
// requetes (le staff-state doit en faire autant avec ou sans modification).
// ---------------------------------------------------------------------------
const DATES = ['created_at', 'updated_at', 'expires_at', 'released_at', 'paid_at', 'absent_at'];
const copieLigne = (row) => JSON.parse(JSON.stringify(row), (k, v) => (DATES.includes(k) && v ? new Date(v) : v));
const requetes = [];
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  requetes.push(s);
  if (s === 'update reservations set start_time = $2, lanes = $3::int[], ops_plan = $4::jsonb, notes = $5, updated_at = now() where id = $1 returning *;') {
    const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
    const avant = (tx && tx.reservations.get(Number(params[0]))) || B.base.reservations.get(Number(params[0]));
    if (!avant) return { rows: [], rowCount: 0 };
    const precedent = avant.updated_at ? new Date(avant.updated_at).getTime() : 0;
    const row = { ...avant, start_time: params[1], lanes: (params[2] || []).map(Number), ops_plan: params[3] ? JSON.parse(params[3]) : null, notes: params[4], updated_at: new Date(Math.max(Date.now(), precedent + 1)) };
    if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
    return { rows: [copieLigne(row)], rowCount: 1 };
  }
  return queryDuBanc.call(this, sql, params);
};

// ---------------------------------------------------------------------------
// LA BASE : la journee de la fixture, en colonnes (l inverse de mapReservation).
// ---------------------------------------------------------------------------
function ligneDepuis(r) {
  return {
    id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: r.name, phone: r.phone || '', email: r.email || '',
    date: r.date, start_time: r.startTime, duration: r.duration, total_duration: r.totalDuration ?? r.duration, lanes: (r.lanes || []).map(Number),
    pax: r.pax, status: r.status, base_price: r.basePrice, price: r.price, type: r.type, formule_id: r.formuleId || null, label: r.label,
    occasion: r.occasion || '', extras: r.extras || [], payment_method: r.paymentMethod || null, notes: r.notes || '',
    ops_plan: r.opsPlan || null, risk_level: r.riskLevel || '', risk_score: r.riskScore ?? null, validation_status: r.validationStatus || 'confirmed',
    activity_progress: r.activityProgress || {}, program: r.program || null, companions: r.companions || 0,
    created_at: new Date(r.createdAt), updated_at: new Date(r.updatedAt),
  };
}
const dossier = (id) => JSON.parse(JSON.stringify(FIXTURE.staffState.reservations.find((r) => r.id === id)));
const planEnBase = (id) => { const row = B.base.reservations.get(Number(id)); const plan = row && row.ops_plan; return typeof plan === 'string' ? JSON.parse(plan) : plan; };
const derniere = (id) => { const plan = planEnBase(id); return plan && plan.derniereModif ? plan.derniereModif : null; };
// Le corps que la console envoie pour ce dossier (le dossier entier).
function corpsDe(r, champs = {}) {
  const lanes = (r.lanes || []).length;
  return { ...r, centerId: 'libramont', requiresLanes: lanes > 0, laneCount: lanes, allowPastStart: true, baseUpdatedAt: r.updatedAt, ...champs };
}

const MANAGER = () => B.sessionDuRole('manager', { nom: 'Julie' });
const DIRECTION = () => B.sessionDuRole('direction', { nom: 'Rachel' });

function verdicts() {
  const liste = [];
  const v = (cond, label, detail = '') => { liste.push({ ok: Boolean(cond), label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return Boolean(cond); };
  return { liste, v };
}

function monter(mutations, lignes = FIXTURE.staffState.reservations.map(ligneDepuis)) {
  B.semer(lignes);
  const m = B.monter({ mutations, session: MANAGER() });
  m.patch = async (s, corps) => {
    m.changerSession(s);
    const r = await auJour(() => m.appeler('PATCH', URL_RESA, corps));
    return { statut: r.statut, code: r.json.code || '', message: r.json.message || '', r: r.json.reservation || null };
  };
  return m;
}
const dire = (x) => `${x.statut} ${x.code} ${x.message}`.trim();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------
// [S] L ECRITURE.
// ---------------------------------------------------------------------------
async function groupeEcriture(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations);
  const solo = dossier(SOLO);
  v(!derniere(SOLO) && !solo.opsPlan.derniereModif, '[S] MONTAGE le dossier de la fixture n a pas encore de derniere modification');

  // Joueurs : le corps entier, comme la console l envoie.
  let x = await m.patch(MANAGER(), corpsDe(solo, { pax: 6 }));
  let d = derniere(SOLO);
  v(x.statut === 200 && d && JSON.stringify(d.quoi) === '["5 → 6 joueurs"]' && d.par === 'Julie' && ISO.test(d.le),
    '[S] 5 → 6 joueurs : ecrite avec le dossier, au nom de la session, a l heure du serveur', { statut: dire(x), d });
  v(x.r && x.r.opsPlan && JSON.stringify(x.r.opsPlan.derniereModif) === JSON.stringify(d), '[S] la reponse du PATCH porte la meme, la console la montre aussitot', x.r && x.r.opsPlan && x.r.opsPlan.derniereModif);
  const apresJoueurs = x.r;

  // L heure, par une autre session : la derniere remplace la precedente.
  x = await m.patch(DIRECTION(), corpsDe(apresJoueurs, { startTime: '14:30' }));
  d = derniere(SOLO);
  // (la piste 7 est prise a 14:30 : le moteur passe en 8, et le resume le dit)
  v(x.statut === 200 && d && d.quoi[0] === 'Heure 14:00 → 14:30' && d.quoi.includes('Piste 7 → 8') && !d.quoi.includes('5 → 6 joueurs') && d.par === 'Rachel',
    '[S] Heure 14:00 → 14:30, par Rachel : la derniere remplace la precedente, la piste changee par le moteur se dit', { statut: dire(x), d });
  const apresHeure = x.r;

  // Un corps qui apporte son propre resume et son propre auteur.
  const faux = { le: '2030-01-01T00:00:00.000Z', par: 'Pirate', quoi: ['Prix 39 € → 0 €'] };
  x = await m.patch(MANAGER(), corpsDe(apresHeure, { opsPlan: { ...apresHeure.opsPlan, derniereModif: faux }, modifiePar: 'Pirate', name: `${apresHeure.name} (Lina)` }));
  d = derniere(SOLO);
  v(x.statut === 200 && d && d.par === 'Julie' && !JSON.stringify(planEnBase(SOLO)).includes('Pirate'),
    '[S] un nom et un resume venus du corps ne s ecrivent jamais : la session signe', { statut: dire(x), d });
  v(d && JSON.stringify(d.quoi) === JSON.stringify([`Nom ${apresHeure.name} → ${apresHeure.name} (Lina)`]), '[S] le nom change se dit', d && d.quoi);
  const avantRien = JSON.stringify(d);

  // Rien de vendu ne change : la derniere modification reste celle d avant.
  const courant = x.r;
  x = await m.patch(MANAGER(), corpsDe(courant, { opsPlan: { ...courant.opsPlan, derniereModif: faux } }));
  v(x.statut === 200 && JSON.stringify(derniere(SOLO)) === avantRien, '[S] un enregistrement sans changement ne remplace pas la derniere modification', { statut: dire(x), d: derniere(SOLO) });
  const planAvant = planEnBase(SOLO);
  const pistesAvant = JSON.stringify(B.base.reservations.get(SOLO).lanes);
  x = await m.patch(MANAGER(), corpsDe(x.r, { opsPlan: (({ derniereModif, ...reste }) => reste)(x.r.opsPlan) }));
  v(x.statut === 200 && JSON.stringify(derniere(SOLO)) === avantRien, '[S] un corps dont le plan n a pas de derniere modification ne l efface pas', derniere(SOLO));
  const sansResume = (plan) => JSON.stringify((({ derniereModif, ...reste }) => reste)(plan || {}));
  v(sansResume(planEnBase(SOLO)) === sansResume(planAvant) && JSON.stringify(B.base.reservations.get(SOLO).lanes) === pistesAvant,
    '[S] le plan du moteur et la piste ne bougent pas pour un resume', { pistesAvant, pistes: B.base.reservations.get(SOLO).lanes, egal: sansResume(planEnBase(SOLO)) === sansResume(planAvant) });

  // Un appel sans auteur (la simulation, lib/ops-simulation.js, renvoie un
  // dossier entier, plan compris, parfois perime) garde la precedente.
  const { updateReservation } = require(path.join(ROOT, 'lib/database.js'));
  const versionDe = () => new Date(B.base.reservations.get(SOLO).updated_at).toISOString();
  await auJour(() => updateReservation({ id: SOLO, name: 'Simulation', baseUpdatedAt: versionDe() }));
  v(B.base.reservations.get(SOLO).name === 'Simulation' && JSON.stringify(derniere(SOLO)) === avantRien, '[S] un appel sans auteur garde la derniere modification d avant', derniere(SOLO));
  await auJour(() => updateReservation({ id: SOLO, name: 'Simulation 2', opsPlan: { ...planEnBase(SOLO), derniereModif: faux }, baseUpdatedAt: versionDe() }));
  const apresFaux = JSON.stringify(derniere(SOLO));
  await auJour(() => updateReservation({ id: SOLO, name: 'Simulation 3', opsPlan: (({ derniereModif, ...reste }) => reste)(planEnBase(SOLO)), baseUpdatedAt: versionDe() }));
  v(B.base.reservations.get(SOLO).name === 'Simulation 3' && apresFaux === avantRien && JSON.stringify(derniere(SOLO)) === avantRien,
    '[S] la base ne prend jamais le resume d un plan recu : ni celui qu il apporte, ni son absence', { apresFaux, apres: derniere(SOLO) });

  // Le deplacement d une activite, depuis le planning.
  const noel = dossier(NOEL);
  x = await m.patch(MANAGER(), { id: NOEL, centerId: 'libramont', baseUpdatedAt: noel.updatedAt, activityMove: { activityId: 'bowling', startTime: '17:00', lanes: [6] } });
  d = derniere(NOEL);
  v(x.statut === 200 && d && d.quoi[0] === 'Bowling déplacé à 17:00, piste 6' && d.par === 'Julie', '[S] un glisser du planning : « Bowling déplacé à 17:00, piste 6 »', { statut: dire(x), d });

  // Un retard applique (api/ops.js) : le plan recu ne porte pas de resume a ecrire.
  const { applyReservationScheduleUpdates } = require(path.join(ROOT, 'lib/database.js'));
  const avantRetard = JSON.stringify(derniere(NOEL));
  await auJour(() => applyReservationScheduleUpdates({ centerId: 'libramont', date: JOUR, updates: [{ id: NOEL, startTime: '17:10', opsPlan: { ...planEnBase(NOEL), derniereModif: faux } }] }));
  v(B.base.reservations.get(NOEL).start_time === '17:10' && JSON.stringify(derniere(NOEL)) === avantRetard, '[S] un retard applique garde la derniere modification en base, jamais celle du plan recu', derniere(NOEL));
  await auJour(() => applyReservationScheduleUpdates({ centerId: 'libramont', date: JOUR, updates: [{ id: NOEL, startTime: '17:00', opsPlan: (({ derniereModif, ...reste }) => reste)(planEnBase(NOEL)) }] }));
  v(JSON.stringify(derniere(NOEL)) === avantRetard, '[S] un retard retire, le plan recu sans resume : celle en base reste', derniere(NOEL));
  return liste;
}

// Un dossier sans plan n en recoit pas un pour porter un resume.
async function groupeSansPlan(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations, [B.ligne(801, { start_time: '15:00', lanes: [1], base_price: 39, price: 39, name: 'Sans plan', ops_plan: null })]);
  const x = await m.patch(MANAGER(), { id: 801, centerId: 'libramont', name: 'Sans plan (Lina)' });
  const row = B.base.reservations.get(801);
  v(x.statut === 200 && row.name === 'Sans plan (Lina)' && (row.ops_plan === null || row.ops_plan === undefined), '[S] un dossier sans plan : le nom change, aucun plan n est cree pour un resume', { statut: dire(x), plan: row.ops_plan });
  return liste;
}

// ---------------------------------------------------------------------------
// [L] LA LECTURE : le staff-state, tel que chaque poste le relit.
// ---------------------------------------------------------------------------
async function groupeLecture(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations);
  const etat = require(path.join(ROOT, 'api/staff-state.js'));
  const lire = async () => {
    m.changerSession(MANAGER());
    requetes.length = 0;
    const r = await auJour(() => B.appeler(etat, 'GET', `/api/staff-state?date=${JOUR}&centerId=libramont`));
    return { statut: r.statut, json: r.json, requetes: [...requetes] };
  };
  const x0 = await m.patch(MANAGER(), corpsDe(dossier(SOLO), { pax: 6 }));
  await lire();
  const un = await lire();
  const lu = (un.json.reservations || []).find((r) => r.id === SOLO);
  v(x0.statut === 200 && un.statut === 200 && lu && lu.opsPlan && lu.opsPlan.derniereModif && JSON.stringify(lu.opsPlan.derniereModif.quoi) === '["5 → 6 joueurs"]' && lu.opsPlan.derniereModif.par === 'Julie',
    '[L] le staff-state porte la derniere modification avec le dossier', { statut: un.statut, d: lu && lu.opsPlan && lu.opsPlan.derniereModif });
  for (const id of VOISINS) {
    const r = dossier(id);
    const x = await m.patch(DIRECTION(), corpsDe(r, { name: `${r.name} bis` }));
    if (x.statut !== 200) v(false, `[L] MONTAGE ${id} modifie`, dire(x));
  }
  const quatre = await lire();
  const portent = (quatre.json.reservations || []).filter((r) => r.opsPlan && r.opsPlan.derniereModif).length;
  v(portent === 4, '[L] quatre dossiers modifies, quatre resumes dans la meme lecture', portent);
  v(quatre.requetes.length === un.requetes.length, '[L] autant de requetes pour quatre dossiers modifies que pour un : aucune par dossier', { un: un.requetes.length, quatre: quatre.requetes.length });
  v(![...un.requetes, ...quatre.requetes].some((s) => /audit_log/.test(s)), '[L] le releve ne lit jamais le journal', quatre.requetes.filter((s) => /audit_log/.test(s)));
  return liste;
}

// ---------------------------------------------------------------------------
// [C] LA CONSOLE : le vrai source d assets/app-main.js, joue dans un bac.
// ---------------------------------------------------------------------------
function fonctionDuSource(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  if (debut < 0) throw new Error(`fonction absente : ${nom}`);
  let i = src.indexOf('{', src.indexOf(')', debut));
  let profondeur = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') profondeur += 1;
    else if (src[i] === '}') { profondeur -= 1; if (profondeur === 0) break; }
  }
  return src.slice(src.lastIndexOf('\n', debut) + 1, i + 1);
}

async function groupeConsole(mutations = []) {
  const { liste, v } = verdicts();
  const vm = require('vm');
  let src = fs.readFileSync(path.join(ROOT, 'assets/app-main.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const mutation of mutations.filter((mu) => mu.fichier === 'assets/app-main.js')) {
    if (src.split(mutation.de).length !== 2) throw new Error(`ancre absente ou multiple dans assets/app-main.js : ${mutation.de.slice(0, 70)}`);
    src = src.replace(mutation.de, mutation.vers);
  }
  // 15:10 a Bruxelles, le 16 janvier 2027.
  const maintenant = new VraieDate(FX.instant(JOUR, '15:10')).getTime();
  class Figee extends VraieDate {
    constructor(...a) { if (a.length === 0) super(maintenant); else super(...a); }
    static now() { return maintenant; }
  }
  const r = { id: SOLO, opsPlan: { derniereModif: { le: FX.instant(JOUR, '14:20').toISOString(), par: 'Julie', quoi: ['12 → 14 joueurs'] } } };
  const bac = { Date: Figee, state: { selectedRes: r }, reservationRenderSignature: () => 'meme', getStaffDashboardStatusMeta: () => ({ label: 'En attente' }) };
  vm.createContext(bac);
  vm.runInContext(`${['quandDerniereModif', 'texteDerniereModif', 'getFicheFaitsSignature'].map((n) => fonctionDuSource(src, n)).join('\n')}
    this.api = { texteDerniereModif, getFicheFaitsSignature };`, bac);
  const { texteDerniereModif, getFicheFaitsSignature } = bac.api;
  const avec = (champs) => ({ opsPlan: { derniereModif: { ...r.opsPlan.derniereModif, ...champs } } });
  v(texteDerniereModif(r) === 'Modifié 14:20, Julie : 12 → 14 joueurs', '[C] « Modifié 14:20, Julie : 12 → 14 joueurs »', texteDerniereModif(r));
  v(texteDerniereModif(avec({ le: FX.instant('2027-01-15', '18:05').toISOString() })) === 'Modifié hier 18:05, Julie : 12 → 14 joueurs', '[C] la veille : « hier 18:05 »', texteDerniereModif(avec({ le: FX.instant('2027-01-15', '18:05').toISOString() })));
  v(texteDerniereModif(avec({ le: FX.instant('2026-12-24', '09:30').toISOString() })) === 'Modifié 24 déc. 09:30, Julie : 12 → 14 joueurs', '[C] plus tot : la date et l heure', texteDerniereModif(avec({ le: FX.instant('2026-12-24', '09:30').toISOString() })));
  const cinq = avec({ quoi: ['5 → 6 joueurs', 'Heure 14:00 → 14:30', 'Ajout : Pizza × 6, 84 €', 'Prix 39 € → 30 €, geste', 'Nom A → B'] });
  v(texteDerniereModif(cinq) === 'Modifié 14:20, Julie : 5 → 6 joueurs · Heure 14:00 → 14:30 · +3', '[C] deux changements dits, le reste compte', texteDerniereModif(cinq));
  v(texteDerniereModif(cinq, { max: 3 }) === 'Modifié 14:20, Julie : 5 → 6 joueurs · Heure 14:00 → 14:30 · Ajout : Pizza × 6, 84 € · +2', '[C] la fiche en dit trois', texteDerniereModif(cinq, { max: 3 }));
  v(texteDerniereModif({}) === '' && texteDerniereModif({ opsPlan: null }) === '' && texteDerniereModif(avec({ quoi: [] })) === '' && texteDerniereModif(avec({ quoi: 'texte' })) === '' && texteDerniereModif(avec({ quoi: ['  ', 3] })) === '',
    '[C] jamais modifie, ou un resume illisible : rien a dire');
  v(texteDerniereModif(avec({ par: '' })) === 'Modifié 14:20 : 12 → 14 joueurs' && texteDerniereModif(avec({ le: 'pas une date' })) === 'Modifié, Julie : 12 → 14 joueurs', '[C] sans auteur ou sans heure lisible : la phrase tient');
  const avant = getFicheFaitsSignature();
  r.opsPlan.derniereModif = { ...r.opsPlan.derniereModif, par: 'Rachel', quoi: ['Heure 14:00 → 14:30'] };
  v(getFicheFaitsSignature() !== avant, '[C] une modification faite sur un autre poste redessine l en-tete de la fiche, meme si rien d autre ne bouge');
  const ligne = (/\$\{derniereModif \? `<p class="fx-modif" data-fx-modif>\$\{escapeHtml\(derniereModif\)\}<\/p>` : ''\}/.exec(src) || [])[0];
  v(Boolean(ligne), '[C] la fiche peint la phrase echappee, sous ses faits', ligne);
  return liste;
}

// ---------------------------------------------------------------------------
// LES GROUPES ET LEURS CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const GROUPES = { groupeEcriture, groupeSansPlan, groupeLecture, groupeConsole };
const API = 'api/staff-reservations.js';
const BASE = 'lib/database.js';
const HISTO = 'lib/historique-dossier.js';
const JS = 'assets/app-main.js';

const CONTRE_PREUVES = [
  { nom: 'le handler ne signe plus', groupe: 'groupeEcriture', attendu: /5 → 6 joueurs : ecrite avec le dossier/, fichier: API, de: '        modifiePar: nomDeSession(session),\n', vers: '' },
  { nom: 'l auteur pris dans le corps', groupe: 'groupeEcriture', attendu: /la session signe/, fichier: API, de: '        modifiePar: nomDeSession(session),\n', vers: '        modifiePar: body.modifiePar || nomDeSession(session),\n' },
  { nom: 'l ecriture retiree de la modification', groupe: 'groupeEcriture', attendu: /5 → 6 joueurs : ecrite avec le dossier/, fichier: BASE, de: '    poserDerniereModif(payload, current, input, lanes);\n', vers: '' },
  { nom: 'le resume du plan recu garde', groupe: 'groupeEcriture', attendu: /la base ne prend jamais le resume d un plan recu/, fichier: BASE, de: 'opsPlan: avecDerniereModif(input.opsPlan ?? input.ops_plan ?? defaults.opsPlan ?? null, derniereModifDe(defaults.opsPlan)),', vers: 'opsPlan: input.opsPlan ?? input.ops_plan ?? defaults.opsPlan ?? null,' },
  { nom: 'un enregistrement vide efface le resume', groupe: 'groupeEcriture', attendu: /ne remplace pas la derniere modification/, fichier: HISTO, de: '  if (!quoi.length) return null;\n  return {', vers: '  return {' },
  { nom: 'un appel sans auteur signe « Equipe »', groupe: 'groupeEcriture', attendu: /un appel sans auteur garde/, fichier: BASE, de: "  if (!input || typeof input.modifiePar !== 'string' || !input.modifiePar.trim()) return;\n", vers: '' },
  { nom: 'le glisser ne signe plus', groupe: 'groupeEcriture', attendu: /un glisser du planning/, fichier: API, de: 'activityMove: body.activityMove, modifiePar: nomDeSession(session) });', vers: 'activityMove: body.activityMove });' },
  { nom: 'le glisser n ecrit plus', groupe: 'groupeEcriture', attendu: /un glisser du planning/, fichier: BASE, de: '      poserDerniereModif(payload, current, input, payload.lanes);\n', vers: '' },
  { nom: 'le deplacement non dit', groupe: 'groupeEcriture', attendu: /un glisser du planning/, fichier: HISTO, de: "  if (bouge && !quoi.some((phrase) => phrase.startsWith('Heure '))) quoi.unshift(bouge);\n", vers: '' },
  { nom: 'le retard ecrit le plan recu', groupe: 'groupeEcriture', attendu: /un retard applique garde/, fichier: BASE, de: 'opsPlan: avecDerniereModif(update.opsPlan !== undefined ? update.opsPlan : current.opsPlan, derniereModifDe(current.opsPlan)),', vers: 'opsPlan: update.opsPlan !== undefined ? update.opsPlan : current.opsPlan,' },
  { nom: 'un plan cree pour porter un resume', groupe: 'groupeSansPlan', attendu: /aucun plan n est cree/, fichier: HISTO, de: "  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return plan;\n  const actuelle", vers: "  if (Array.isArray(plan)) return plan;\n  plan = plan && typeof plan === 'object' ? plan : {};\n  const actuelle" },
  // Le choix inverse : la derniere modification lue dans le journal a chaque releve.
  { nom: 'le resume relu dans le journal a chaque releve', groupe: 'groupeLecture', attendu: /aucune par dossier/, fichier: 'api/staff-state.js', de: '    const snapshot = await readStaffState(date, centerId, { blocagesAPart: true });\n', vers: "    const snapshot = await readStaffState(date, centerId, { blocagesAPart: true });\n    for (const r of snapshot.reservations || []) if (r.opsPlan && r.opsPlan.derniereModif) await getPool().query('select changes from audit_log where entity_id = $1 order by occurred_at desc limit 1;', [String(r.id)]);\n" },
  { nom: 'la phrase sans compte du reste', groupe: 'groupeConsole', attendu: /deux changements dits, le reste compte/, fichier: JS, de: "${reste > 0 ? ` · +${reste}` : ''}", vers: '' },
  { nom: 'la fiche en dit deux', groupe: 'groupeConsole', attendu: /la fiche en dit trois/, fichier: JS, de: 'const dits = quoi.slice(0, Math.max(1, Number(max) || 1));', vers: 'const dits = quoi.slice(0, 2);' },
  { nom: 'hier dit comme une date', groupe: 'groupeConsole', attendu: /la veille/, fichier: JS, de: '  if (jourDe(d) === jourDe(new Date(maintenant.getTime() - 86400000))) return `hier ${heure}`;\n', vers: '' },
  { nom: 'un resume illisible affiche', groupe: 'groupeConsole', attendu: /un resume illisible : rien a dire/, fichier: JS, de: "d.quoi.filter(t => typeof t === 'string' && t.trim())", vers: 'd.quoi' },
  { nom: 'la fiche ne se redessine pas', groupe: 'groupeConsole', attendu: /redessine l en-tete de la fiche/, fichier: JS, de: 'getStaffDashboardStatusMeta(r).label, texteDerniereModif(r, { max: 3 })])', vers: 'getStaffDashboardStatusMeta(r).label])' },
  { nom: 'la phrase peinte sans echappement', groupe: 'groupeConsole', attendu: /la fiche peint la phrase echappee/, fichier: JS, de: '<p class="fx-modif" data-fx-modif>${escapeHtml(derniereModif)}</p>', vers: '<p class="fx-modif" data-fx-modif>${derniereModif}</p>' },
];

process.on('beforeExit', () => {
  console.error('FAIL  derniere-modif-check s est arrete avant son bilan : une promesse jamais tenue');
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
    B.sortir('derniere-modif-check', echecs, 'la derniere modification s ecrit avec le dossier, au nom de la session, et arrive sans une requete de plus.');
    return;
  }
  for (const c of CONTRE_PREUVES) {
    const liste = await GROUPES[c.groupe]([{ fichier: c.fichier, de: c.de, vers: c.vers }]).catch((error) => [{ ok: false, label: `exception : ${error.message}`, detail: '' }]);
    const rouges = liste.filter((x) => !x.ok);
    const mord = rouges.some((x) => c.attendu.test(x.label));
    console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve « ${c.nom} » : ${mord ? 'le gate rougit' : `AUCUN ROUGE ATTENDU (${rouges.length} rouge(s) : ${rouges.slice(0, 2).map((x) => x.label).join(' | ') || 'aucun'})`}`);
    if (!mord) echecs += 1;
  }
  B.sortir('derniere-modif-check --contre-preuves', echecs, `${CONTRE_PREUVES.length} gardes retirees une a une, chacune fait rougir sa ligne.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

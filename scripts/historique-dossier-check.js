// L HISTORIQUE D UN DOSSIER, JOUE SUR LE VRAI HANDLER (2026-11-03).
//
// Qui a fait quoi, quand, sur un dossier : la fiche ouvre son pli
// « Historique », la console lit GET /api/staff-reservations?historique=<id>,
// le serveur lit audit_log pour CE dossier de CE centre et le dit en phrases
// simples (lib/historique-dossier.js). Le niveau « historique » du role ouvre la
// porte, juge avant toute lecture de la base.
//
// Ce gate monte le vrai api/staff-reservations.js, la vraie lib/database.js, le
// vrai readAuditLog (lib/audit-log.js) sur la base en memoire du banc
// (scripts/reserver-banc.js), avec les roles livres, et une table audit_log en
// memoire que le journal du banc remplit a chaque geste :
//   [P] les phrases : joueurs, heure, date, duree, formule, sur mesure, prix et
//       sa raison, statut, notes, encaisse, absence, deplacement, retard.
//   [H] la porte : niveau oui et non (403 au contrat, rien n est lu), droit de
//       voir, dossier d un autre centre (404, le journal n est pas lu), portee
//       'all', identifiant faux, predicat du journal, predicat faux simule.
//   [E] de bout en bout : de vrais PATCH (joueurs, prix et raison, heure,
//       paiement, encaisse) puis la lecture, du plus recent au plus ancien.
//   [W] la console : le pli ferme par defaut, lu a l ouverture et une seule
//       fois, relu quand le dossier change, refus sans « Réessayer », panne
//       avec, phrases echappees, rien sans le niveau.
//
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais
// touche), la ligne qui la prouve doit rougir.
//
// Zero reseau, zero base, rien ne part.
// Lancement : node scripts/historique-dossier-check.js [--contre-preuves]
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./reserver-banc.js');

const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';

// ---------------------------------------------------------------------------
// LA TABLE audit_log EN MEMOIRE. Le journal du banc (writeAuditLog double) y
// verse chaque trace ; readAuditLog la lit par sa vraie requete, evaluee ici
// colonne par colonne. `predicatFaux` simule un SQL qui ne filtre plus rien :
// seule la relecture en JS doit alors tenir.
// ---------------------------------------------------------------------------
const TABLE = [];
const lecturesJournal = [];
const lecturesDossier = [];
let predicatFaux = false;
let serie = 0;
const DEBUT = Date.parse('2026-11-03T08:00:00Z');
function versLigne(e) {
  serie += 1;
  return {
    id: serie, center_id: e.centerId || 'libramont', occurred_at: new Date(DEBUT + serie * 60000), actor_kind: e.actorKind || 'system',
    actor_member_id: e.actorMemberId || null, actor_label: e.actorLabel || '', actor_role_id: e.actorRoleId || null, surface: e.surface || '',
    action: e.action || '', method: e.method || '', entity_type: e.entityType || '', entity_id: e.entityId == null ? '' : String(e.entityId),
    outcome: e.outcome || 'success', denied_reason: e.deniedReason || null, changes: JSON.parse(JSON.stringify(e.changes || {})),
    context: JSON.parse(JSON.stringify(e.context || {})), request_id: e.requestId || '',
  };
}
function semerJournal(lignes = []) {
  TABLE.length = 0;
  lecturesJournal.length = 0;
  lecturesDossier.length = 0;
  predicatFaux = false;
  lignes.forEach((e) => TABLE.push(versLigne(e)));
}

const DATES = ['created_at', 'updated_at', 'expires_at', 'released_at', 'paid_at', 'absent_at'];
const copieLigne = (row) => JSON.parse(JSON.stringify(row), (k, v) => (DATES.includes(k) && v ? new Date(v) : v));
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/\bfrom audit_log\b/.test(s) && s.startsWith('select ')) {
    lecturesJournal.push({ sql: s, params: [...params] });
    const where = (/ where (.+?) order by /.exec(s) || [])[1] || '';
    // Les lignes du fondateur restent en base, la lecture du centre ne les prend pas (2026-11-13,
    // lib/fondateur-invisible.js) : le motif s applique tel que le SQL le dit.
    const PAS_LE_FONDATEUR = /^coalesce\(actor_member_id, ''\) not like '([^']*)'$/;
    const aimeComme = (valeur, motif) => new RegExp(`^${motif.split('%').map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(String(valeur || ''));
    const conditions = where ? where.split(' and ').map((c) => /^(\w+) = \$(\d+)$/.exec(c) || PAS_LE_FONDATEUR.exec(c)) : [];
    if (conditions.some((c) => !c)) throw new Error(`predicat du journal non simule : ${where}`);
    const limite = Number(params[Number((/ limit \$(\d+)/.exec(s) || [])[1]) - 1]);
    const lignes = TABLE
      .filter((ligne) => predicatFaux || conditions.every((c) => (c.length === 2 ? !aimeComme(ligne.actor_member_id, c[1]) : String(ligne[c[1]]) === String(params[Number(c[2]) - 1]))))
      .sort((a, b) => b.occurred_at - a.occurred_at || b.id - a.id)
      .slice(0, limite);
    return { rows: lignes.map((ligne) => JSON.parse(JSON.stringify(ligne), (k, v) => (k === 'occurred_at' ? new Date(v) : v))), rowCount: lignes.length };
  }
  if (/^select \* from reservations where id = \$1 limit 1;?$/.test(s)) lecturesDossier.push(params[0]);
  const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
  const lire = (id) => (tx && tx.reservations.get(Number(id))) || B.base.reservations.get(Number(id));
  const ecrire = (avant, champs) => {
    const precedent = avant.updated_at ? new Date(avant.updated_at).getTime() : 0;
    const row = { ...avant, ...champs, updated_at: new Date(Math.max(Date.now(), precedent + 1)) };
    if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
    return { rows: [copieLigne(row)], rowCount: 1 };
  };
  if (s === 'update reservations set status = $2, payment_method = $3, updated_at = now() where id = $1 returning *;') {
    const avant = lire(params[0]);
    return avant ? ecrire(avant, { status: params[1], payment_method: params[2] || null }) : { rows: [], rowCount: 0 };
  }
  if (s === 'update reservations set amount_paid = $2, discount_reason = $3, updated_at = now() where id = $1 returning *;') {
    const avant = lire(params[0]);
    return avant ? ecrire(avant, { amount_paid: params[1], discount_reason: params[2] }) : { rows: [], rowCount: 0 };
  }
  if (s === 'update reservations set absent_at = case when $2 then now() else null end, updated_at = now() where id = $1 returning *;') {
    const avant = lire(params[0]);
    return avant ? ecrire(avant, { absent_at: params[1] ? new Date() : null }) : { rows: [], rowCount: 0 };
  }
  return queryDuBanc.call(this, sql, params);
};

// ---------------------------------------------------------------------------
// Les roles livres, les dossiers, les gestes.
// ---------------------------------------------------------------------------
const MANAGER = (centre = 'libramont') => B.sessionDuRole('manager', { nom: 'Rachel', centre });
const DIRECTION = () => B.sessionDuRole('direction', { nom: 'Movsar' });
const STAFF_BAR = () => B.sessionDuRole('staff-bar', { nom: 'Julie' });
const TECHNIQUE = () => B.sessionDuRole('technique', { nom: 'Tom' });
const MARKETING = () => B.sessionDuRole('marketing', { nom: 'Lea' });

const DOSSIER = (id, champs = {}) => B.ligne(id, { start_time: '15:00', lanes: [1], base_price: 60, price: 60, name: 'Famille Lambert', amount_paid: null, discount_reason: null, absent_at: null, status: 'pending', ...champs });
const enBase = (id) => B.base.reservations.get(Number(id));
const version = (id) => new Date(enBase(id).updated_at).toISOString();

function verdicts() {
  const liste = [];
  const v = (cond, label, detail = '') => { liste.push({ ok: Boolean(cond), label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return Boolean(cond); };
  return { liste, v };
}

function monter(mutations, session = MANAGER()) {
  const m = B.monter({ mutations, session });
  const pousser = m.journal.audits.push.bind(m.journal.audits);
  m.journal.audits.push = (entree) => { TABLE.push(versLigne(entree)); return pousser(entree); };
  m.lire = async (s, id, centre = 'libramont') => {
    m.changerSession(s);
    const r = await m.appeler('GET', `${URL_RESA}?historique=${encodeURIComponent(id)}${centre === null ? '' : `&centerId=${encodeURIComponent(centre)}`}`);
    return { statut: r.statut, code: r.json.code || '', message: r.json.message || '', historique: r.json.historique, json: r.json };
  };
  m.modifier = async (s, corps) => {
    m.changerSession(s);
    const r = await m.appeler('PATCH', URL_RESA, { centerId: 'libramont', ...corps });
    return { statut: r.statut, code: r.json.code || '', message: r.json.message || '', r: r.json.reservation || null };
  };
  return m;
}
const dire = (x) => `${x.statut} ${x.code} ${x.message}`.trim();
const quoi = (historique) => (Array.isArray(historique) ? historique.map((e) => e.quoi.join(' | ')) : historique);

// Une trace telle que les handlers l ecrivent, avant/apres d un dossier entier.
function trace(action, avant, apres, { centre = 'libramont', id = 601, par = 'Rachel', context = {}, outcome = 'success', kind = 'staff' } = {}) {
  const { reservationChanges } = require(path.join(ROOT, 'lib/registre.js'));
  return { centerId: centre, actorKind: kind, actorLabel: par, action, method: 'PATCH', entityType: 'reservation', entityId: id, outcome, changes: reservationChanges(avant, apres), context };
}

// ---------------------------------------------------------------------------
// [P] LES PHRASES.
// ---------------------------------------------------------------------------
async function groupePhrases(mutations = []) {
  const { liste, v } = verdicts();
  B.semer([]);
  monter(mutations);
  const h = require(path.join(ROOT, 'lib/historique-dossier.js'));
  const { notesAvecPrix, mapReservation } = require(path.join(ROOT, 'lib/database.js'));
  const avant = mapReservation(DOSSIER(601, { pax: 12, date: '2026-11-15', label: 'Formule 3', duration: 1, notes: 'Anniversaire de Lina' }));
  const noteEquipe = '[equipe] {"t":"Gateau a 16:00","par":"Rachel","le":"2026-11-03T09:00:00.000Z"}';
  const apres = {
    ...avant, pax: 14, startTime: '16:00', date: '2026-11-16', duration: 1.5, label: 'Formule 3 (adaptée)', status: 'paid', paymentMethod: 'Carte',
    extras: [{ name: 'Pizza × 6', price: 84 }], price: 40,
    notes: [notesAvecPrix(avant.notes, { de: 60, a: 40, raison: 'geste commercial', par: 'Rachel' }), noteEquipe].join('\n'),
  };
  const dit = h.phrasesDuChangement(avant, apres);
  const attendu = ['12 → 14 joueurs', 'Heure 15:00 → 16:00', 'Date 15 nov. → 16 nov.', 'Durée 1 h → 1 h 30', 'Formule adaptée', 'Ajout : Pizza × 6, 84 €', 'Prix 60 € → 40 €, geste commercial'];
  v(JSON.stringify(dit.contenu) === JSON.stringify(attendu), '[P] ce qui se vend, dans l ordre du gerant : joueurs, heure, date, duree, formule, sur mesure, prix et sa raison', dit.contenu);
  v(JSON.stringify(dit.suivi) === JSON.stringify(['Statut En attente → Payé · Carte', 'Note : « Gateau a 16:00 »']), '[P] le suivi : statut et moyen, note de l equipe', dit.suivi);
  v(JSON.stringify(h.phrasesDuChangement(avant, { ...avant, price: 75 }).contenu) === '["Prix 60 € → 75 €"]', '[P] un prix sans trace : les deux montants');
  const pizzas = h.phrasesDuChangement({ extras: [{ name: 'Pizza × 6', price: 84 }, { name: 'Gateau', price: 25 }] }, { extras: [{ name: 'Pizza × 8', price: 112 }] });
  v(JSON.stringify(pizzas.contenu) === '["Pizza × 6 → Pizza × 8","Retrait : Gateau"]', '[P] une ligne qui change de quantite, une ligne retiree', pizzas.contenu);
  v(!h.phrasesDuChangement(avant, { ...avant }).contenu.length && !h.phrasesDuChangement(avant, { ...avant }).suivi.length, '[P] rien ne change : rien a dire');
  v(h.phrasesDuChangement({ name: 'A' }, { name: 'Groupe <script>' }).contenu[0] === 'Nom A → Groupe script', '[P] un nom ne porte pas de balise', h.phrasesDuChangement({ name: 'A' }, { name: 'Groupe <script>' }).contenu);
  v(h.phrasesDuChangement({ phone: '0470' }, { phone: '0471' }).contenu[0] === 'Téléphone modifié', '[P] un numero change ne se recopie pas dans l historique');
  const entree = (action, context, changes = {}) => h.entreeDuJournal({ action, context, changes, actorLabel: 'Julie', occurredAt: new Date(DEBUT) }, '601');
  v(entree('noterEncaisse', { encaisse: { montant: 40, prix: 60, raison: 'joueur en moins' } }).quoi[0] === 'Encaissé 40 € au lieu de 60 €, joueur en moins', '[P] l encaisse sous le prix : montant, prix, raison');
  v(entree('noterEncaisse', { encaisse: { montant: 60, prix: 60, raison: '' } }).quoi[0] === 'Encaissé 60 €, le prix du dossier', '[P] l encaisse au prix');
  v(entree('noterAbsence', { absent: true }).quoi[0] === 'Noté absent' && entree('noterAbsence', { absent: false }).quoi[0] === 'Absence retirée', '[P] l absence et son retrait');
  v(entree('moveReservationActivity', { activityMove: { activityId: 'laser_game', startTime: '17:30' } }).quoi[0] === 'Laser Game déplacé à 17:30', '[P] un deplacement du planning');
  v(entree('createReservation', { canal: 'public' }).quoi[0] === 'Réservé en ligne' && entree('createReservation', { aPlacer: true }).quoi[0] === 'Dossier créé au comptoir, à placer', '[P] la creation, en ligne ou au comptoir');
  const cascade = entree('delayApply', { delayMinutes: 15 }, { '601.startTime': { before: '15:00', after: '15:15' }, '602.startTime': { before: '16:00', after: '16:15' } });
  v(JSON.stringify(cascade.quoi) === '["Retard de 15 min appliqué","Heure 15:00 → 15:15"]', '[P] un retard en cascade : la ligne de CE dossier seulement', cascade.quoi);
  v(entree('updateReservation', {}, { opsPlan: { before: {}, after: { x: 1 } } }) === null, '[P] une trace sans rien de lisible ne fait pas d entree vide');
  v(entree('noterAbsence', { absent: true }).par === 'Julie' && h.entreeDuJournal({ action: 'createReservation', actorKind: 'public', context: { canal: 'public' } }, '601').par === 'Client en ligne', '[P] qui : le nom de la trace, sinon le client en ligne');
  const phrases = [...dit.contenu, ...dit.suivi].join(' ');
  v(!/[\u2013\u2014]/.test(phrases), '[P] aucune phrase ne porte de tiret cadratin ni demi-cadratin');
  return liste;
}

// ---------------------------------------------------------------------------
// [H] LA PORTE.
// ---------------------------------------------------------------------------
async function groupePorte(mutations = []) {
  const { liste, v } = verdicts();
  const { mapReservation } = require(path.join(ROOT, 'lib/database.js'));
  B.semer([DOSSIER(601), DOSSIER(701, { center_id: 'arlon' })]);
  const lambert = mapReservation(DOSSIER(601));
  semerJournal([
    trace('updateReservation', lambert, { ...lambert, pax: 6 }, { par: 'Rachel' }),
    trace('updateReservation', lambert, { ...lambert, startTime: '16:00' }, { par: 'Julie' }),
    // Un refus du serveur n est pas une modification.
    trace('updateReservation', lambert, { ...lambert, price: 1 }, { par: 'Intrus', outcome: 'denied' }),
    // Le meme dossier vu d un autre centre, et un autre dossier du centre.
    trace('updateReservation', lambert, { ...lambert, name: 'Secret Arlon' }, { centre: 'arlon', par: 'Arlon' }),
    trace('updateReservation', lambert, { ...lambert, name: 'Autre dossier' }, { id: 602, par: 'Rachel' }),
    trace('updateReservation', mapReservation(DOSSIER(701)), { ...mapReservation(DOSSIER(701)), pax: 9 }, { centre: 'arlon', id: 701, par: 'Arlon' }),
  ]);
  const m = monter(mutations);

  let x = await m.lire(MANAGER(), 601);
  const lu = quoi(x.historique);
  v(x.statut === 200 && JSON.stringify(lu) === JSON.stringify(['Heure 15:00 → 16:00', '4 → 6 joueurs']) && x.historique[0].par === 'Julie' && x.historique[1].par === 'Rachel',
    '[H] Manager (historique oui) : ce dossier, du plus recent au plus ancien, qui et quoi', { statut: x.statut, lu, message: x.message });
  const requete = lecturesJournal[0] || { sql: '', params: [] };
  v(lecturesJournal.length === 1 && /where center_id = \$1 and outcome = \$2 and entity_type = \$3 and entity_id = \$4 and coalesce\(actor_member_id, ''\) not like '%:platform-owner%' order by/.test(requete.sql)
    && JSON.stringify(requete.params.slice(0, 4)) === '["libramont","success","reservation","601"]' && requete.params[4] <= 80,
    '[H] le journal est lu pour CE centre, CE dossier, les seules reussites, sans les lignes du fondateur, 80 lignes au plus', requete);
  v(!JSON.stringify(x.json).includes('Secret Arlon') && !JSON.stringify(x.json).includes('Autre dossier') && !JSON.stringify(x.json).includes('Intrus'),
    '[H] ni l autre centre, ni l autre dossier, ni un refus', x.json);
  v(JSON.stringify(Object.keys(x.json).sort()) === '["historique","id","ok"]' && JSON.stringify(Object.keys(x.historique[0]).sort()) === '["le","par","quoi"]',
    '[H] la reponse dit quand, qui et quoi, rien du journal brut', x.json);

  for (const [s, nom] of [[STAFF_BAR(), 'Staff bar'], [TECHNIQUE(), 'Technique']]) {
    lecturesJournal.length = 0;
    lecturesDossier.length = 0;
    x = await m.lire(s, 601);
    v(x.statut === 403 && x.code === 'historique_refuse' && /historique/.test(x.message) && x.historique === undefined && !lecturesJournal.length && !lecturesDossier.length,
      `[H] ${nom} (historique non) : 403 historique_refuse, ni le dossier ni le journal ne sont lus`, { ...x, journal: lecturesJournal.length, dossier: lecturesDossier.length });
  }
  lecturesJournal.length = 0;
  x = await m.lire(MARKETING(), 601);
  v(x.statut === 403 && x.historique === undefined && !lecturesJournal.length, '[H] Marketing (sans voir les reservations) : 403, rien n est lu', dire(x));

  lecturesJournal.length = 0;
  x = await m.lire(MANAGER('arlon'), 601, 'arlon');
  const ailleurs = await m.lire(MANAGER('arlon'), 601, null);
  v(x.statut === 404 && ailleurs.statut === 404 && x.historique === undefined && !lecturesJournal.length,
    '[H] un dossier d un autre centre : 404 comme un dossier inconnu, le journal n est pas lu', { x: dire(x), ailleurs: dire(ailleurs), journal: lecturesJournal.length });
  lecturesJournal.length = 0;
  x = await m.lire(MANAGER(), 701);
  v(x.statut === 404 && !lecturesJournal.length, '[H] Libramont ne lit pas un dossier d Arlon', dire(x));
  lecturesJournal.length = 0;
  x = await m.lire(DIRECTION(), 601, 'all');
  v(x.statut === 404 && !lecturesJournal.length, '[H] la portee « all » ne lit aucun journal : un dossier se lit dans son centre', dire(x));
  for (const faux of ['abc', '601 or 1=1', '', '-1', '9'.repeat(13)]) {
    lecturesJournal.length = 0;
    lecturesDossier.length = 0;
    x = await m.lire(MANAGER(), faux);
    v(x.statut === 422 && /Dossier invalide/.test(x.message) && !lecturesJournal.length && !lecturesDossier.length, `[H] identifiant faux « ${faux.slice(0, 14)} » : 422, rien n est lu`, dire(x));
  }
  x = await m.lire(MANAGER(), 999);
  v(x.statut === 404 && /introuvable/.test(x.message), '[H] un dossier inconnu : 404', dire(x));

  // Un predicat SQL qui ne filtrerait plus rien : la relecture en JS tient seule.
  predicatFaux = true;
  x = await m.lire(MANAGER(), 601);
  predicatFaux = false;
  v(x.statut === 200 && JSON.stringify(quoi(x.historique)) === JSON.stringify(['Heure 15:00 → 16:00', '4 → 6 joueurs']),
    '[H] meme un predicat SQL faux ne laisse rien passer d un autre centre ni d un autre dossier', quoi(x.historique));

  const { lireHistoriqueDossier } = require(path.join(ROOT, 'lib/historique-dossier.js'));
  const refusDe = async (entree) => { try { await lireHistoriqueDossier(entree); return ''; } catch (error) { return `${error.statusCode} ${error.message}`; } };
  lecturesJournal.length = 0;
  const refus = [await refusDe({ centerId: 'all', reservationId: 601 }), await refusDe({ centerId: '', reservationId: 601 }), await refusDe({ centerId: 'libramont', reservationId: 'x' })];
  v(refus.every((r) => /^422 /.test(r)) && !lecturesJournal.length, '[H] la lecture refuse « all », un centre vide, un dossier illisible, sans lire', refus);
  return liste;
}

// ---------------------------------------------------------------------------
// [E] DE BOUT EN BOUT : de vrais gestes, puis la lecture.
// ---------------------------------------------------------------------------
async function groupeBoutEnBout(mutations = []) {
  const { liste, v } = verdicts();
  // Le prix du moteur pour une piste, une heure, un samedi apres-midi : 39 €.
  B.semer([DOSSIER(601, { base_price: 39, price: 39 })]);
  semerJournal([]);
  const m = monter(mutations);
  const etapes = [];
  let x = await m.modifier(MANAGER(), { id: 601, pax: 6 });
  etapes.push(dire(x));
  const prixApres = Number(enBase(601).price);
  x = await m.modifier(DIRECTION(), { id: 601, price: 30, prixRaison: 'geste commercial' });
  etapes.push(dire(x));
  x = await m.modifier(MANAGER(), { id: 601, startTime: '16:00' });
  etapes.push(dire(x));
  x = await m.modifier(STAFF_BAR(), { id: 601, status: 'paid', paymentMethod: 'Carte', baseUpdatedAt: version(601) });
  etapes.push(dire(x));
  x = await m.modifier(DIRECTION(), { id: 601, baseUpdatedAt: version(601), encaissement: { montant: 25, raison: 'joueur en moins' } });
  etapes.push(dire(x));
  v(etapes.every((e) => e.startsWith('200')) && prixApres === 39, '[E] MONTAGE cinq gestes passent : joueurs, prix, heure, paiement, encaisse', { etapes, prixApres });

  const lu = await m.lire(MANAGER(), 601);
  const dit = quoi(lu.historique) || [];
  const attendu = [
    'Encaissé 25 € au lieu de 30 €, joueur en moins',
    'Statut En attente → Payé · Carte',
    'Heure 15:00 → 16:00',
    'Prix 39 € → 30 €, geste commercial',
  ];
  v(lu.statut === 200 && attendu.every((phrase, i) => (dit[i] || '').startsWith(phrase)), '[E] la lecture dit chaque geste, du plus recent au plus ancien', { dit, attendu });
  v(/^4 → 6 joueurs/.test(dit[4] || ''), '[E] le premier geste : « 4 → 6 joueurs »', dit[4]);
  const par = (lu.historique || []).map((e) => e.par);
  v(JSON.stringify(par) === JSON.stringify(['Movsar', 'Julie', 'Rachel', 'Movsar', 'Rachel']), '[E] chaque geste porte le nom de la session qui l a fait', par);
  v((lu.historique || []).every((e) => !Number.isNaN(Date.parse(e.le))), '[E] chaque geste porte son heure', (lu.historique || []).map((e) => e.le));
  return liste;
}

// ---------------------------------------------------------------------------
// [W] LA CONSOLE : le vrai source d assets/app-main.js, joue dans un bac.
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
  const appels = [];
  const attentes = [];
  const peints = new Map();
  const r = { id: 601, centerId: 'libramont', updatedAt: '2026-11-03T09:00:00.000Z' };
  const bac = {
    niveau: 'oui',
    state: { selectedRes: r },
    API_ENDPOINTS: { staffReservations: '/api/staff-reservations' },
    getCurrentStaffCenterId: () => 'libramont',
    findStaffReservationById: (id) => (Number(id) === r.id ? r : null),
    formatNoteEquipeQuand: () => '09:00',
    escapeHtml: (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    apiRequest: (url) => { appels.push(url); return new Promise((ok, ko) => attentes.push({ ok, ko })); },
    document: {
      querySelector: (sel) => {
        const lu = /^\[data-fx-histo="(\d+)"\] \.fx-histo-corps$/.exec(sel);
        if (!lu) return null;
        return { set innerHTML(html) { peints.set(Number(lu[1]), html); }, get innerHTML() { return peints.get(Number(lu[1])) || ''; } };
      },
    },
    Promise,
  };
  bac.niveauStaff = (cle) => (cle === 'historique' ? bac.niveau : 'non');
  vm.createContext(bac);
  const etat = (/const historiquesOuverts = new Set\(\);\nconst historiquesLus = new Map\(\);/.exec(src) || [''])[0];
  const noms = ['versionHistorique', 'corpsHistoriqueHtml', 'peindreHistorique', 'chargerHistoriqueDossier', 'relireHistoriqueDossier', 'basculerHistorique', 'renderGroupeHistorique'];
  vm.runInContext(`${etat}\n${noms.map((n) => fonctionDuSource(src, n)).join('\n')}
    this.api = { renderGroupeHistorique, basculerHistorique, relireHistoriqueDossier, ouverts: () => historiquesOuverts };`, bac);
  const { renderGroupeHistorique, basculerHistorique, relireHistoriqueDossier } = bac.api;
  const repondre = (valeur, echec = null) => { while (attentes.length) { const a = attentes.shift(); if (echec) a.ko(echec); else a.ok(valeur); } };
  const souffle = () => new Promise((fin) => setImmediate(fin));
  const HISTO = { ok: true, id: 601, historique: [{ le: '2026-11-03T09:00:00.000Z', par: 'Julie', quoi: ['4 → 6 joueurs', 'Prix <b>60</b> € → 40 €'] }] };

  let html = renderGroupeHistorique(r);
  v(/<details class="[^"]*fx-historique[^"]*" data-fx-histo="601" ontoggle="basculerHistorique\(601, this\.open\)">/.test(html) && /Historique/.test(html) && !/ open[ >]/.test(html.split('>')[0]) && !appels.length,
    '[W] le pli Historique est ferme par defaut, et rien n est lu tant qu il est ferme', { html: html.slice(0, 200), appels });
  basculerHistorique(601, true);
  await souffle();
  v(appels.length === 1 && appels[0] === '/api/staff-reservations?historique=601&centerId=libramont' && /Chargement de l’historique/.test(peints.get(601) || ''),
    '[W] l ouverture lit l historique de CE dossier dans son centre, « Chargement » en attendant', { appels, peint: peints.get(601) });
  basculerHistorique(601, true);
  renderGroupeHistorique(r);
  await souffle();
  v(appels.length === 1, '[W] un pli recree ouvert par le rendu ne relance pas la lecture', appels);
  repondre(HISTO);
  await souffle();
  const peint = peints.get(601) || '';
  v(/<li>4 → 6 joueurs<\/li>/.test(peint) && /Julie/.test(peint) && /<time datetime="2026-11-03T09:00:00.000Z">09:00<\/time>/.test(peint),
    '[W] la reponse se peint : quand, qui, chaque changement', peint);
  v(peint.includes('Prix &lt;b&gt;60&lt;/b&gt; €') && !peint.includes('<b>60</b>'), '[W] une phrase est echappee, jamais du HTML', peint);
  html = renderGroupeHistorique(r);
  await souffle();
  v(/ open ontoggle|" open /.test(html) && appels.length === 1 && /4 → 6 joueurs/.test(html), '[W] le releve redessine le pli ouvert avec ce qui est lu, sans relire', { appels, html: html.slice(0, 160) });
  r.updatedAt = '2026-11-03T09:05:00.000Z';
  renderGroupeHistorique(r);
  renderGroupeHistorique(r);
  await souffle();
  await souffle();
  v(appels.length === 2, '[W] le dossier a change pendant que le pli est ouvert : il se relit, une fois pour deux rendus', appels);
  repondre({ ok: true, id: 601, historique: [] });
  await souffle();
  v(/Aucune modification enregistrée pour ce dossier/.test(peints.get(601) || ''), '[W] un dossier sans trace le dit', peints.get(601));
  basculerHistorique(601, false);
  v(!bac.api.ouverts().has(601), '[W] fermer le pli le garde ferme au prochain rendu');

  // Le refus du serveur, puis une panne.
  r.updatedAt = '2026-11-03T09:10:00.000Z';
  basculerHistorique(601, true);
  await souffle();
  repondre(null, Object.assign(new Error('Votre rôle ne permet pas de voir l’historique d’un dossier.'), { payload: { code: 'historique_refuse' } }));
  await souffle();
  const refus = peints.get(601) || '';
  v(/Votre rôle ne permet pas de voir l’historique/.test(refus) && !/Réessayer/.test(refus) && /role="alert"/.test(refus), '[W] un refus de droit se dit tel quel, sans « Réessayer »', refus);
  relireHistoriqueDossier(601);
  await souffle();
  repondre(null, new Error('Failed to fetch'));
  await souffle();
  const panne = peints.get(601) || '';
  v(/Historique indisponible : Failed to fetch/.test(panne) && /Réessayer/.test(panne), '[W] une panne se dit, avec « Réessayer »', panne);
  const avant = appels.length;
  renderGroupeHistorique(r);
  await souffle();
  v(appels.length === avant, '[W] une lecture en panne ne se relance pas a chaque rendu', appels.length - avant);
  relireHistoriqueDossier(601);
  await souffle();
  v(appels.length === avant + 1, '[W] « Réessayer » relit', appels.length - avant);
  repondre(HISTO);
  await souffle();
  bac.niveau = 'non';
  v(renderGroupeHistorique(r) === '', '[W] sans le niveau historique, la fiche n a pas de pli Historique');
  return liste;
}

// ---------------------------------------------------------------------------
// LES GROUPES ET LEURS CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const GROUPES = { groupePhrases, groupePorte, groupeBoutEnBout, groupeConsole };
const API = 'api/staff-reservations.js';
const HISTO = 'lib/historique-dossier.js';
const JS = 'assets/app-main.js';

const CONTRE_PREUVES = [
  { nom: 'le niveau historique ignore', groupe: 'groupePorte', attendu: /Staff bar \(historique non\)/, fichier: API, de: '        exigerHistorique(sessionHistorique);\n', vers: '' },
  { nom: 'le niveau juge apres la lecture du dossier', groupe: 'groupePorte', attendu: /ni le dossier ni le journal ne sont lus/, fichier: API, de: "        exigerHistorique(sessionHistorique);\n        const dossierId = String(requestUrl.searchParams.get('historique') || '').trim();", vers: "        const dossierId = String(requestUrl.searchParams.get('historique') || '').trim();\n        await getReservationById(Number(dossierId) || 0);\n        exigerHistorique(sessionHistorique);" },
  { nom: 'le centre du dossier non verifie', groupe: 'groupePorte', attendu: /un dossier d un autre centre : 404/, fichier: API, de: "if (!dossier || !centre || (dossier.centerId || 'libramont') !== centre) {", vers: 'if (!dossier || !centre) {' },
  { nom: 'l identifiant non verifie', groupe: 'groupePorte', attendu: /identifiant faux « 601 or 1=1 »/, fichier: API, de: "        if (!/^\\d{1,12}$/.test(dossierId)) {", vers: '        if (!dossierId) {' },
  { nom: 'le journal lu sans centre', groupe: 'groupePorte', attendu: /le journal est lu pour CE centre/, fichier: HISTO, de: "readAuditLog({ centerId: centre, entityType: 'reservation'", vers: "readAuditLog({ centerId: 'all', entityType: 'reservation'" },
  { nom: 'les refus demandes au journal', groupe: 'groupePorte', attendu: /le journal est lu pour CE centre, CE dossier, les seules reussites/, fichier: HISTO, de: "entityId: id, outcome: 'success', limit:", vers: 'entityId: id, limit:' },
  { nom: 'la relecture en JS retiree', groupe: 'groupePorte', attendu: /meme un predicat SQL faux/, fichier: HISTO, de: ".filter((ligne) => ligne && ligne.centerId === centre && String(ligne.entityId) === id && ligne.entityType === 'reservation' && ligne.outcome === 'success')", vers: '.filter(Boolean)' },
  { nom: 'un refus relu comme une modification', groupe: 'groupePorte', attendu: /meme un predicat SQL faux/, fichier: HISTO, de: " && ligne.entityType === 'reservation' && ligne.outcome === 'success')", vers: " && ligne.entityType === 'reservation')" },
  { nom: 'la portee all acceptee', groupe: 'groupePorte', attendu: /la lecture refuse « all »/, fichier: HISTO, de: "if (!centre || centre === 'all' || !/^\\d+$/.test(id)) {", vers: "if (!centre || !/^\\d+$/.test(id)) {" },
  { nom: 'le journal brut renvoye', groupe: 'groupePorte', attendu: /rien du journal brut/, fichier: HISTO, de: '  return { le: quand, par: auteurDuJournal(ligne), quoi: quoi.slice(0, ENTREE_QUOI_MAX) };', vers: '  return { le: quand, par: auteurDuJournal(ligne), quoi: quoi.slice(0, ENTREE_QUOI_MAX), changes: ligne.changes };' },
  { nom: 'la raison du prix perdue', groupe: 'groupeBoutEnBout', attendu: /la lecture dit chaque geste/, fichier: HISTO, de: "  const tracePrix = touche('notes') ? notesNouvelles(a.notes, b.notes).filter((note) => note.type === 'prix' && note.prix).pop() : null;", vers: '  const tracePrix = null;' },
  { nom: 'l encaisse sans son montant', groupe: 'groupeBoutEnBout', attendu: /la lecture dit chaque geste/, fichier: HISTO, de: "    const e = contexte.encaisse && typeof contexte.encaisse === 'object' ? contexte.encaisse : null;", vers: '    const e = null;' },
  { nom: 'le geste signe d un autre nom', groupe: 'groupeBoutEnBout', attendu: /le nom de la session/, fichier: HISTO, de: '  const nom = texte(ligne.actorLabel, 80);\n  if (nom) return nom;', vers: "  const nom = '';\n  if (nom) return nom;" },
  { nom: 'le retard des voisins lu sur ce dossier', groupe: 'groupePhrases', attendu: /la ligne de CE dossier seulement/, fichier: HISTO, de: "    else if (/^\\d+\\./.test(cle)) return;\n", vers: "    else if (/^\\d+\\./.test(cle)) champ = cle.slice(cle.indexOf('.') + 1);\n" },
  { nom: 'les balises gardees dans une phrase', groupe: 'groupePhrases', attendu: /un nom ne porte pas de balise/, fichier: HISTO, de: "String(valeur ?? '').replace(/[\\u0000-\\u001f\\u007f<>]/g, ' ')", vers: "String(valeur ?? '')" },
  { nom: 'le pli ouvert par defaut', groupe: 'groupeConsole', attendu: /ferme par defaut/, fichier: JS, de: '  const ouvert = historiquesOuverts.has(id);', vers: '  const ouvert = true;\n  chargerHistoriqueDossier(r);' },
  { nom: 'une lecture a chaque rendu', groupe: 'groupeConsole', attendu: /une fois pour deux rendus/, fichier: JS, de: "  if (deja && (deja.etat === 'charge' || deja.etat === 'erreur' || (deja.etat === 'ok' && deja.version === version))) return;", vers: '' },
  { nom: 'un dossier modifie jamais relu', groupe: 'groupeConsole', attendu: /il se relit/, fichier: JS, de: "    if (lu && lu.etat === 'ok' && lu.version !== versionHistorique(r)) Promise.resolve().then(() => chargerHistoriqueDossier(r));", vers: '' },
  { nom: 'une phrase peinte sans echappement', groupe: 'groupeConsole', attendu: /une phrase est echappee/, fichier: JS, de: "(e.quoi || []).map(t => `<li>${escapeHtml(t)}</li>`)", vers: "(e.quoi || []).map(t => `<li>${t}</li>`)" },
  { nom: 'un refus avec « Réessayer »', groupe: 'groupeConsole', attendu: /sans « Réessayer »/, fichier: JS, de: "${lu.refus ? '' : `<button type=\"button\" class=\"gc-btn\"", vers: "${false ? '' : `<button type=\"button\" class=\"gc-btn\"" },
  { nom: 'le pli montre sans le niveau', groupe: 'groupeConsole', attendu: /sans le niveau historique/, fichier: JS, de: "  if (!r || typeof niveauStaff !== 'function' || niveauStaff('historique') !== 'oui') return '';", vers: "  if (!r || typeof niveauStaff !== 'function') return '';" },
];

process.on('beforeExit', () => {
  console.error('FAIL  historique-dossier-check s est arrete avant son bilan : une promesse jamais tenue');
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
    B.sortir('historique-dossier-check', echecs, 'l historique se lit au niveau du role, pour ce dossier de ce centre, en phrases simples.');
    return;
  }
  for (const c of CONTRE_PREUVES) {
    const liste = await GROUPES[c.groupe]([{ fichier: c.fichier, de: c.de, vers: c.vers }]).catch((error) => [{ ok: false, label: `exception : ${error.message}`, detail: '' }]);
    const rouges = liste.filter((x) => !x.ok);
    const mord = rouges.some((x) => c.attendu.test(x.label));
    console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve « ${c.nom} » : ${mord ? 'le gate rougit' : `AUCUN ROUGE ATTENDU (${rouges.length} rouge(s) : ${rouges.slice(0, 2).map((x) => x.label).join(' | ') || 'aucun'})`}`);
    if (!mord) echecs += 1;
  }
  B.sortir('historique-dossier-check --contre-preuves', echecs, `${CONTRE_PREUVES.length} gardes retirees une a une, chacune fait rougir sa ligne.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// TOUT LE GROUPE, DU MEME ECART : LE SERVEUR (2026-11-23).
//
// Ansar, devant la pop-up de l heure d un bowling du planning complet : « il y a pas 15h, 15h30 parce
// que les autres activites sont a ces heures-la ; mais c est con, parce que si on veut tout avancer de
// 30 minutes, on peut pas ». Le PATCH `toutLeGroupe` decale toute la visite d un bloc (lib/decaler-le-groupe.js,
// lib/database.js ecrireLeGroupeDecale), le calcul a blanc `deplacement.toutLeGroupe.ecarts` dit ce que
// chaque ecart donnerait (api/staff-reservations.js decalerABlanc).
//   [A] la visite entiere bouge du meme ecart : l arrivee, l accueil, chaque activite, la table, les
//       boissons, les bornes du plan ; ses pistes restent les siennes ; ni le prix, ni les joueurs, ni le
//       programme ne changent ; « Heure 15:30 → 16:00 » au nom de la session, le journal et la copie de
//       secours ; le decalage inverse remet chaque heure ;
//   [B] une heure que tenaient les propres activites du groupe n est pas un conflit quand elles bougent
//       ensemble (seule, la meme heure est refusee) ;
//   [C] tout ou rien : une activite qui ne tient pas arrete tout, rien ne s ecrit, et le refus dit
//       laquelle et a quelle heure (`cle`, `heure`), meme quand celle d avant passait ; une partie de
//       laser ne se cale pas en silence sur celle d un autre groupe ;
//   [D] le bowling prend d autres pistes quand les siennes sont prises ; « Annuler » renvoie celles d avant
//       (`pistes`) et les retrouve ;
//   [E] le calcul a blanc juge comme l ecriture (passe ou refus, meme raison, meme activite, memes pistes),
//       n ecrit rien, et ne fait pas remonter le temps (`auPlusTot`) ;
//   [F] un groupe qui joue ne bouge pas : le PATCH, le calcul a blanc et l ecriture sous le verrou le
//       refusent avec la phrase de la pop-up (`groupe_en_jeu`) ;
//   [G] les droits : le glisser, chaque planning que le groupe tient, un jour passe ;
//   [H] la phrase du gel dit ce que le serveur verifie (sur place et l heure passee, ou une coche a la
//       main), jamais « joue » ; la regle ne change pas : un groupe qui n est pas la ne gele pas ;
//   [I] le corps : l ecart, les pistes, aucun autre champ, la version, le centre, le jour, l acces a
//       volonte, l annulee.
// Le vrai api/staff-reservations.js, la vraie lib/database.js et le vrai moteur, sur la journee « pic » de
// Fun Galaxy (scripts/planning-v3-fixtures.js, samedi 16 janvier 2027 a 15:10), base en memoire du banc
// (scripts/reserver-banc.js). Zero reseau, zero base, rien ne part.
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais touche), la ligne qui la
// prouve doit rougir.
// Lancement : node scripts/decaler-groupe-check.js [--contre-preuves]
'use strict';
const path = require('path');
const B = require('./reserver-banc.js');
const FX = require('./planning-v3-fixtures');

const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
const SACHA = 1604; // bowling 15:30 pistes 1 et 2, arcades 16:35, laser 17:30
const MANON = 1618; // laser 15:30 (1re partie) et 16:00 (2e)
const NATHAN = 1607; // bowling 17:00 pistes 1 et 2 : a 17:30, elles sont prises
const HENRARD = 1635; // bowling 16:00, piste 8
const NOEL = 1637; // bowling 16:30, piste 6
const LEA = 1595; // bowling 13:00 pistes 1 et 2, pas encore la
const LINA = 1601; // arrivee, son laser de 15:00 est passe
const TARD = 1632; // 23:00, la fin de la journee

// L heure de la journee de la fixture : le serveur juge « passe » et « aujourd hui » sur Date.
const VraieDate = Date;
async function auJour(travail, heure = '15:10', jour = JOUR) {
  const ecart = new VraieDate(FX.instant(jour, heure)).getTime() - VraieDate.now();
  class Fausse extends VraieDate {
    constructor(...a) { if (a.length === 0) super(VraieDate.now() + ecart); else super(...a); }
    static now() { return VraieDate.now() + ecart; }
  }
  global.Date = Fausse;
  try { return await travail(); } finally { global.Date = VraieDate; }
}

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
    acquisition: r.acquisition ?? null, client_key: r.clientKey || '', paid_at: r.paidAt ? new Date(r.paidAt) : null,
    amount_paid: r.amountPaid ?? null, discount_reason: r.discountReason || '', absent_at: r.absentAt ? new Date(r.absentAt) : null,
  };
}
const LIGNES = () => FIXTURE.staffState.reservations.map(ligneDepuis);
const dossier = (id) => JSON.parse(JSON.stringify(FIXTURE.staffState.reservations.find((r) => r.id === id)));
const brut = (id) => JSON.stringify(B.base.reservations.get(Number(id)) || null);
const version = (id) => new Date(B.base.reservations.get(Number(id)).updated_at).toISOString();
const planDe = (id) => { const p = B.base.reservations.get(Number(id)).ops_plan; return typeof p === 'string' ? JSON.parse(p) : (p || {}); };
const pistes = (id) => (B.base.reservations.get(Number(id)).lanes || []).map(Number).join(',');
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutes = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const MANAGER = () => B.sessionDuRole('manager', { nom: 'Rachel' });

// Les heures d un dossier, telles qu un decalage doit les bouger : l arrivee, chaque bloc (sa ressource,
// ses pistes) et chaque etape de la frise, les bornes du plan, l arrivee du plan.
function heuresDe(id, { sansPistes = false } = {}) {
  const row = B.base.reservations.get(Number(id));
  const plan = planDe(id);
  const h = (t) => (typeof t === 'string' && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : null);
  return {
    arrivee: String(row.start_time).slice(0, 5),
    bornes: [h(plan.startTime), h(plan.endTime)],
    duree: plan.totalMinutes ?? null,
    plan: [h(plan.arrivalPlan && plan.arrivalPlan.arrivalTime), h(plan.anchorPlan && plan.anchorPlan.arrivalTime)],
    blocs: (plan.resourceBlocks || []).map((b) => `${b.resourceType}:${b.countIndex || ''}.${b.groupWaveIndex || ''}@${h(b.startTime)}-${h(b.endTime)}${sansPistes ? '' : `[${(b.lanes || []).join(',')}]`}`),
    frise: (plan.timeline || []).map((s) => `${s.type}:${s.activityId || ''}@${h(s.startTime)}-${h(s.endTime)}`),
  };
}
function decalees(heures, ecart) {
  const plus = (t) => (t ? hhmm(minutes(t) + ecart) : t);
  const re = /\d{2}:\d{2}/g;
  return {
    arrivee: plus(heures.arrivee), bornes: heures.bornes.map(plus), duree: heures.duree, plan: heures.plan.map(plus),
    blocs: heures.blocs.map((x) => x.replace(re, plus)), frise: heures.frise.map((x) => x.replace(re, plus)),
  };
}
const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Ce que le contrat vendu porte : un decalage n y touche pas.
const contrat = (id) => { const r = B.base.reservations.get(Number(id)); return JSON.stringify([r.date, r.pax, Number(r.price), Number(r.base_price), r.program, r.extras, r.status, r.activity_progress, r.name, r.center_id]); };

function verdicts() {
  const liste = [];
  const v = (cond, label, detail = '') => { liste.push({ ok: Boolean(cond), label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return Boolean(cond); };
  return { liste, v };
}

function monter(mutations, { lignes = LIGNES(), session = MANAGER() } = {}) {
  B.semer(lignes);
  const m = B.monter({ mutations, session });
  m.patch = async (corps, s = null, quand = {}) => {
    if (s) m.changerSession(s);
    const r = await auJour(() => m.appeler('PATCH', URL_RESA, corps), quand.heure, quand.jour);
    return { statut: r.statut, json: r.json };
  };
  m.decaler = (id, toutLeGroupe, s = null, quand = {}) => m.patch({ id, centerId: 'libramont', baseUpdatedAt: version(id), toutLeGroupe }, s, quand);
  m.blanc = async (id, ecarts, plus = {}, s = null, quand = {}) => {
    if (s) m.changerSession(s);
    const r = await auJour(() => m.appeler('POST', URL_RESA, { dryRun: true, centerId: 'libramont', deplacement: { id, centerId: 'libramont', baseUpdatedAt: version(id), toutLeGroupe: { ecarts }, ...plus } }), quand.heure, quand.jour);
    return r.json;
  };
  return m;
}
const dire = (x) => `${x.statut} ${x.json.code || ''} ${x.json.message || ''}`.trim();
const refusDe = (x) => ({ statut: x.statut, message: x.json.message, cle: x.json.cle, heure: x.json.heure });

// ---------------------------------------------------------------------------
// [A] [B] [C] [D] : l ecriture.
// ---------------------------------------------------------------------------
async function groupeEcriture(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations);

  // [A] Sacha, +30 min.
  const avant = heuresDe(SACHA);
  const contratAvant = contrat(SACHA);
  let x = await m.decaler(SACHA, { ecart: 30 });
  v(x.statut === 200 && memes(x.json.toutLeGroupe, { ecart: 30, unchangedActivities: true }) && x.json.reservation && x.json.reservation.startTime === '16:00',
    '[A] Sacha +30 min : 200, la reponse le dit et porte le dossier a 16:00', dire(x));
  const apres = heuresDe(SACHA);
  v(memes(apres, decalees(avant, 30)) && avant.frise.length >= 5 && avant.blocs.length >= 2,
    '[A] toute la visite bouge de 30 min : l arrivee, l accueil, le bowling, les arcades, le laser, la table, les bornes du plan', { avant, apres });
  v(pistes(SACHA) === '1,2' && apres.blocs.some((b) => /^bowling_lane:.*@16:00-17:00\[1,2\]$/.test(b)),
    '[A] ses pistes restent les siennes : 1 et 2, a 16:00', { pistes: pistes(SACHA), blocs: apres.blocs });
  v(contrat(SACHA) === contratAvant, '[A] ni le prix, ni les joueurs, ni le programme, ni le statut, ni les coches ne changent', { avant: contratAvant, apres: contrat(SACHA) });
  const d = planDe(SACHA).derniereModif;
  v(d && d.quoi && d.quoi[0] === 'Heure 15:30 → 16:00' && d.par === 'Rachel', '[A] la derniere modification : « Heure 15:30 → 16:00 », au nom de la session', d);
  const audit = m.journal.audits[m.journal.audits.length - 1] || {};
  v(audit.action === 'decalerToutLeGroupe' && audit.outcome === 'success' && Number(audit.entityId) === SACHA && audit.context && JSON.stringify(audit.context).includes('"ecart":30'),
    '[A] le journal le note (decalerToutLeGroupe, l ecart)', { action: audit.action, outcome: audit.outcome, entite: audit.entityId });
  v(m.journal.secours.length === 1, '[A] la copie de secours part, comme pour « Modifier »', m.journal.secours.length);
  x = await m.decaler(SACHA, { ecart: -30 });
  v(x.statut === 200 && memes(heuresDe(SACHA), avant) && pistes(SACHA) === '1,2' && ((planDe(SACHA).derniereModif || {}).quoi || [])[0] === 'Heure 16:00 → 15:30',
    '[A] le decalage inverse remet chaque heure a sa place', { statut: dire(x), heures: heuresDe(SACHA), avant });

  // [B] Manon : sa 1re partie a 16:00, l heure de sa 2e.
  const seul = await auJour(() => m.appeler('POST', URL_RESA, { dryRun: true, centerId: 'libramont', deplacement: { id: MANON, centerId: 'libramont', baseUpdatedAt: version(MANON), essais: [[{ activityId: 'laser_game', unitKey: '1.1', startTime: '16:00' }]] } }));
  const essaiSeul = (seul.json.essais || [])[0] || {};
  x = await m.decaler(MANON, { ecart: 30 });
  const laser = {};
  (planDe(MANON).resourceBlocks || []).filter((b) => b.resourceType === 'laser_arena').forEach((b) => { laser[`${b.countIndex || 1}.${b.groupWaveIndex || 1}`] = b.startTime; });
  v(essaiSeul.passe === false && /chevauche le Laser Game du groupe/.test(essaiSeul.raison || '') && x.statut === 200 && laser['1.1'] === '16:00' && laser['2.1'] === '16:30',
    '[B] seule, sa 1re partie ne va pas a 16:00 (sa 2e y joue) ; tout le groupe +30 min passe : 16:00 et 16:30', { seul: essaiSeul.raison, statut: dire(x), laser });

  // [C] Sacha +90 min : son bowling (17:00) passerait, son laser (19:00) non. Rien ne s ecrit.
  const departSacha = brut(SACHA);
  x = await m.decaler(SACHA, { ecart: 90 });
  v(x.statut === 409 && /^Plus assez d’armes pour le laser à 19:00/.test(x.json.message || '') && x.json.cle === 'laser_game:1.1' && x.json.heure === '19:00',
    '[C] +90 min : refuse, le refus dit l activite (laser, 1re partie) et l heure qui coincent (19:00)', refusDe(x));
  v(brut(SACHA) === departSacha, '[C] tout ou rien : son bowling, qui passait a 17:00, n a pas bouge non plus', { pistes: pistes(SACHA), heures: heuresDe(SACHA).arrivee });
  x = await m.decaler(SACHA, { ecart: 60 });
  v(x.statut === 409 && x.json.message === 'Pistes 1 et 2 déjà prises de 16:30 à 17:30.' && x.json.cle === 'bowling' && x.json.heure === '16:30' && brut(SACHA) === departSacha,
    '[C] +60 min : « Pistes 1 et 2 déjà prises de 16:30 à 17:30. », le bowling a 16:30, rien d ecrit', refusDe(x));
  x = await m.decaler(SACHA, { ecart: 5 });
  v(x.statut === 409 && /l’arène joue déjà la partie de 17:30 .*Pour la partager, prenez leur départ, 17:30\./.test(x.json.message || '') && x.json.cle === 'laser_game:1.1' && x.json.heure === '17:35' && brut(SACHA) === departSacha,
    '[C] +5 min : son laser ne se cale pas en silence sur la partie de 17:30 d un autre groupe, le refus le dit', refusDe(x));
  const departLea = brut(LEA);
  x = await m.decaler(LEA, { ecart: 30 });
  v(x.statut === 409 && x.json.message === 'Bowling 13:30 : la piste 1 est prise par un groupe qui joue.' && x.json.cle === 'bowling' && x.json.heure === '13:30' && brut(LEA) === departLea,
    '[C] Lea +30 min : la place d un groupe qui joue ne se prend pas, et le refus le dit', refusDe(x));

  // [D] Nathan +30 min : a 17:30, ses pistes sont prises ; il prend 7 et 8. « Annuler » renvoie 1 et 2.
  const avantNathan = heuresDe(NATHAN, { sansPistes: true });
  const avantNathanPistes = heuresDe(NATHAN);
  x = await m.decaler(NATHAN, { ecart: 30 });
  v(x.statut === 200 && pistes(NATHAN) === '7,8' && memes(heuresDe(NATHAN, { sansPistes: true }), decalees(avantNathan, 30)),
    '[D] Nathan +30 min : ses pistes 1 et 2 sont prises a 17:30, le bowling prend 7 et 8, tout le groupe passe', { statut: dire(x), pistes: pistes(NATHAN) });
  x = await m.decaler(NATHAN, { ecart: -30, pistes: [1, 2] });
  v(x.statut === 200 && pistes(NATHAN) === '1,2' && memes(heuresDe(NATHAN), avantNathanPistes)
    && (planDe(NATHAN).resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane').every((b) => (b.lanes || []).join(',') === '1,2'),
    '[D] « Annuler » (-30 min, pistes 1 et 2) : le groupe revient a 17:00, sur ses pistes 1 et 2', { statut: dire(x), pistes: pistes(NATHAN) });
  return liste;
}

// ---------------------------------------------------------------------------
// [E] : le calcul a blanc juge comme l ecriture, et n ecrit rien.
// ---------------------------------------------------------------------------
const PAIRES = [[SACHA, 30], [SACHA, 60], [SACHA, 90], [SACHA, 5], [MANON, 30], [MANON, -30], [NATHAN, 30], [LEA, 30], [TARD, 60], [HENRARD, -50]];
async function groupeABlanc(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations);
  const depart = new Map(FIXTURE.staffState.reservations.map((r) => [r.id, brut(r.id)]));
  const parId = new Map();
  for (const [id, ecart] of PAIRES) { if (!parId.has(id)) parId.set(id, []); parId.get(id).push(ecart); }
  const essais = new Map();
  for (const [id, ecarts] of parId) {
    const rep = await m.blanc(id, ecarts);
    ecarts.forEach((e, i) => essais.set(`${id}:${e}`, (rep.essais || [])[i] || null));
  }
  const intacts = [...depart.entries()].every(([id, avant]) => brut(id) === avant);
  v(intacts && essais.size === PAIRES.length && [...essais.values()].every(Boolean), '[E] le calcul a blanc rend un verdict par ecart et n ecrit rien', { essais: essais.size });
  const ecarts = [];
  for (const [id, ecart] of PAIRES) {
    B.semer(LIGNES());
    const x = await m.decaler(id, { ecart });
    const e = essais.get(`${id}:${ecart}`) || {};
    const pareil = e.passe === true
      ? x.statut === 200 && (e.pistes ? e.pistes.join(',') === pistes(id) : (dossier(id).lanes || []).join(',') === pistes(id))
      : x.statut >= 400 && e.passe === false && e.raison === String(x.json.message || '').replace(/\s*(Cet horaire reste inchangé|Les autres horaires restent inchangés)\.\s*$/, '').trim() && (e.cle || '') === (x.json.cle || '') && (e.heure || '') === (x.json.heure || '');
    if (!pareil) ecarts.push({ id, ecart, blanc: e, ecrit: refusDe(x) });
  }
  v(ecarts.length === 0, `[E] pour ${PAIRES.length} ecarts, le calcul a blanc et l ecriture disent la meme chose : passe ou refus, la meme raison, la meme activite, la meme heure, les memes pistes`, ecarts);
  const nathan = essais.get(`${NATHAN}:30`) || {};
  v(nathan.passe === true && memes(nathan.pistes, [7, 8]), '[E] il dit les pistes que le bowling prendra (Nathan +30 min : 7 et 8)', nathan);
  const tard = essais.get(`${TARD}:60`) || {};
  v(tard.passe === false && tard.raison === 'Tout le groupe ne change pas de jour d’ici : passez par Modifier.' && !tard.cle, '[E] 23:00 +60 min : le groupe ne change pas de jour d ici', tard);
  // L heure deja passee ne se juge pas : 15:10, Henrard -60 min mettrait son bowling a 15:00.
  B.semer(LIGNES());
  const rep = await m.blanc(HENRARD, [-60, -50, 5], { auPlusTot: minutes('15:10') });
  const [moins60, moins50, plus5] = rep.essais || [];
  v(memes(moins60, { passe: false, plancher: true, cle: 'bowling', heure: '15:00', raison: 'Cette heure est déjà passée.' }) && moins50 && moins50.passe === true && plus5 && plus5.passe === true,
    '[E] le groupe ne remonte pas le temps : a 15:10, -60 min (bowling a 15:00) est refuse comme deja passe ; -50 min passe', rep.essais);
  const trop = await m.blanc(HENRARD, Array.from({ length: 65 }, (_, i) => i + 1));
  v(trop.refus && trop.refus.statut === 400 && trop.refus.message === 'Décalage du groupe invalide.' && !trop.essais, '[E] au plus 64 ecarts par calcul', trop.refus);
  return liste;
}

// ---------------------------------------------------------------------------
// [F] [H] : un groupe qui joue, et la phrase qui le dit.
// ---------------------------------------------------------------------------
const PHRASE_LINA = 'DÉMO · Anniversaire Lina (12 ans) : sur place, et l’heure de Laser Game (15:00) est passée. Ses heures ne bougent plus.';
async function groupeGel(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations);
  const depart = brut(LINA);
  let x = await m.decaler(LINA, { ecart: 30 });
  v(x.statut === 409 && x.json.code === 'groupe_en_jeu' && x.json.message === PHRASE_LINA && brut(LINA) === depart,
    '[F] Lina (sur place, son laser de 15:00 passe) : le PATCH refuse avec la phrase de la pop-up, rien ne s ecrit', dire(x));
  const blanc = await m.blanc(LINA, [30, 60]);
  v(blanc.gele === PHRASE_LINA && memes(blanc.essais, []) && brut(LINA) === depart, '[F] le calcul a blanc rend `gele`, aucune heure', blanc);

  // Une coche a la main entre la lecture et le verrou : l ecriture sous le verrou refuse elle-meme.
  const rowNoel = B.base.reservations.get(NOEL);
  B.base.reservations.set(NOEL, { ...rowNoel, activity_progress: { 'bowling-1': { done: true } } });
  const departNoel = brut(NOEL);
  const db = require(path.join(ROOT, 'lib/database.js'));
  let erreur = null;
  try { await auJour(() => db.ecrireLeGroupeDecale({ id: NOEL, centerId: 'libramont', baseUpdatedAt: version(NOEL), ecart: 30, modifiePar: 'Rachel' })); } catch (e) { erreur = e; }
  const phraseNoel = 'DÉMO · Famille Noël : une activité est cochée faite (Bowling, 16:30). Ses heures ne bougent plus.';
  v(erreur && erreur.statusCode === 409 && erreur.code === 'groupe_en_jeu' && erreur.message === phraseNoel && brut(NOEL) === departNoel,
    '[F] sous le verrou : Noel, son bowling coche a la main, ne bouge pas (« une activité est cochée faite (Bowling, 16:30) »)', erreur ? `${erreur.statusCode} ${erreur.code} ${erreur.message}` : 'aucune erreur');

  // Manon, sa 1re partie cochee a la main (15:30, pas encore passee) : la coche suffit, et se dit.
  const rowManon = B.base.reservations.get(MANON);
  B.base.reservations.set(MANON, { ...rowManon, activity_progress: { 'laser_game-1': { done: true } } });
  x = await m.decaler(MANON, { ecart: 30 });
  const phraseManon = `${rowManon.name} : une activité est cochée faite (Laser Game, 15:30). Ses heures ne bougent plus.`;
  v(x.statut === 409 && x.json.code === 'groupe_en_jeu' && x.json.message === phraseManon, '[F] Manon, sa 1re partie cochee a la main : refusee, et la phrase dit la coche', dire(x));

  // [H] La phrase, groupe par groupe, a 15:10 : les groupes sur place dont une heure est passee, rien d autre.
  const RA = require(path.join(ROOT, 'lib/retard-arrivee.js'));
  const nom = (id) => dossier(id).name;
  const attendus = new Map([
    [1608, `${nom(1608)} : sur place, et l’heure de Minigolf Blacklight (14:05) est passée. Ses heures ne bougent plus.`],
    [1600, `${nom(1600)} : sur place, et l’heure de Bowling (13:30) est passée. Ses heures ne bougent plus.`],
    [1596, `${nom(1596)} : sur place, et l’heure de Bowling (14:00) est passée. Ses heures ne bougent plus.`],
    [1597, `${nom(1597)} : sur place, et l’heure de Minigolf Blacklight (15:05) est passée. Ses heures ne bougent plus.`],
    [LINA, PHRASE_LINA],
  ]);
  const lus = await auJour(async () => FIXTURE.staffState.reservations.map((r) => [r.id, RA.groupeEnJeu(r)]).filter(([, g]) => g));
  const ecarts = lus.filter(([id, g]) => attendus.get(id) !== g.phrase).map(([id, g]) => ({ id, phrase: g.phrase }));
  v(lus.length === attendus.size && ecarts.length === 0, '[H] a 15:10, cinq groupes gelent, chacun dit pourquoi : sur place, et l heure de telle activite est passee', { lus: lus.map(([id]) => id), ecarts });
  v(lus.every(([, g]) => !/\bjoue/.test(g.phrase) && !/\bjoue/.test(g.motif)), '[H] aucune phrase ne dit « joue » : personne ne l a coche', lus.map(([, g]) => g.phrase));
  const passesPasLa = [LEA, 1610, 1613, 1615, 1616, 1633, 1617, 1634];
  const geles = await auJour(async () => passesPasLa.filter((id) => RA.groupeEnJeu(dossier(id))));
  v(geles.length === 0 && passesPasLa.every((id) => dossier(id).status === 'pending'), '[H] la regle ne change pas : un groupe qui n est pas la, son heure passee et rien de coche, ne gele pas', geles);
  const coche = await auJour(async () => RA.groupeEnJeu({ ...dossier(MANON), activityProgress: { 'laser_game-1': { done: true } } }));
  v(coche && coche.motif === 'une activité est cochée faite (Laser Game, 15:30)' && coche.depuis === '15:30', '[H] une coche a la main gele, avant son heure, et se dit', coche);
  return liste;
}

// ---------------------------------------------------------------------------
// [G] : les droits.
// ---------------------------------------------------------------------------
async function groupeDroits(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations);
  const sansLaser = MANAGER();
  sansLaser.permissions = sansLaser.permissions.filter((p) => p !== 'planning.laser');
  const depart = brut(SACHA);
  let x = await m.decaler(SACHA, { ecart: 30 }, sansLaser);
  const blanc = await m.blanc(SACHA, [30], {}, sansLaser);
  v(x.statut === 403 && x.json.message === 'Ce planning ne fait pas partie de votre rôle.' && blanc.refus && blanc.refus.statut === 403 && !blanc.essais && brut(SACHA) === depart,
    '[G] sans le planning laser, le groupe de Sacha (bowling et laser) ne se decale pas, ni a blanc', { patch: dire(x), blanc: blanc.refus });
  x = await m.decaler(HENRARD, { ecart: 30 }, sansLaser);
  v(x.statut === 200, '[G] le meme role decale un groupe qui n a que du bowling', dire(x));
  x = await m.decaler(SACHA, { ecart: 30 }, B.sessionDuRole('staff-bar', { nom: 'Leo' }));
  v(x.statut === 403 && brut(SACHA) === depart, '[G] sans le droit de deplacer au planning : refuse', dire(x));
  // Le lendemain, la journee du 16 est passee.
  const lendemain = { jour: '2027-01-17', heure: '10:00' };
  x = await m.decaler(SACHA, { ecart: 30 }, B.sessionDuRole('assistant-manager', { nom: 'Sam' }), lendemain);
  v(x.statut === 403 && x.json.message === 'Changer un jour passé ne fait pas partie de votre rôle.' && brut(SACHA) === depart, '[G] un jour passe, sans son droit : refuse', dire(x));
  x = await m.decaler(SACHA, { ecart: 30 }, MANAGER(), lendemain);
  v(x.statut === 200, '[G] un jour passe, avec son droit : decale', dire(x));
  return liste;
}

// ---------------------------------------------------------------------------
// [I] : le corps.
// ---------------------------------------------------------------------------
async function groupeCorps(mutations = []) {
  const { liste, v } = verdicts();
  const henrard = dossier(HENRARD);
  // (un autre samedi : ces deux-la ne prennent pas la piste d Henrard)
  const volonte = { ...ligneDepuis(henrard), id: 9904, date: '2027-01-23', name: 'DÉMO · Accès à volonté', ops_plan: { ...henrard.opsPlan, resourceBlocks: henrard.opsPlan.resourceBlocks.map((b) => (b.resourceType === 'bowling_lane' ? { ...b, aVolonte: true } : b)) } };
  const annulee = { ...ligneDepuis(henrard), id: 9905, date: '2027-01-23', name: 'DÉMO · Annulée', status: 'cancelled' };
  const m = monter(mutations, { lignes: LIGNES().concat([volonte, annulee]) });
  const depart = brut(HENRARD);
  const ecart = 'Choisissez un décalage valide : quelques minutes, au plus douze heures.';
  const refus = [];
  for (const [corps, statut, message] of [
    [{ ecart: 0 }, 400, ecart], [{ ecart: 721 }, 400, ecart], [{ ecart: 12.5 }, 400, ecart], [{ ecart: 'tard' }, 400, ecart],
    [[30], 400, 'Décalage du groupe invalide.'], [{ ecart: 30, pistes: [0] }, 400, 'Pistes du décalage invalides.'], [{ ecart: 30, pistes: [8, 8] }, 400, 'Pistes du décalage invalides.'],
  ]) {
    const x = await m.decaler(HENRARD, corps);
    if (x.statut !== statut || x.json.message !== message) refus.push({ corps, recu: dire(x) });
  }
  v(refus.length === 0 && brut(HENRARD) === depart, '[I] un ecart nul, de plus de douze heures, pas entier ou illisible, des pistes invalides : refuses, rien ne s ecrit', refus);
  let x = await m.patch({ id: HENRARD, centerId: 'libramont', baseUpdatedAt: version(HENRARD), toutLeGroupe: { ecart: 30 }, name: 'Autre nom' });
  v(x.statut === 422 && x.json.message === 'Décaler tout le groupe ne modifie aucun autre choix du dossier.' && brut(HENRARD) === depart, '[I] aucun autre champ ne passe avec le decalage', dire(x));
  x = await m.patch({ id: HENRARD, centerId: 'libramont', toutLeGroupe: { ecart: 30 } });
  v(x.statut === 409 && x.json.code === 'reservation_modifiee' && brut(HENRARD) === depart, '[I] sans la version du dossier : refuse', dire(x));
  const ancienne = version(HENRARD);
  x = await m.decaler(HENRARD, { ecart: 30 });
  const apres = brut(HENRARD);
  const perime = await m.patch({ id: HENRARD, centerId: 'libramont', baseUpdatedAt: ancienne, toutLeGroupe: { ecart: 30 } });
  v(x.statut === 200 && perime.statut === 409 && perime.json.code === 'reservation_modifiee' && perime.json.reservation && perime.json.reservation.startTime === '16:30' && brut(HENRARD) === apres,
    '[I] une console restee sur la version d avant : refusee, la version actuelle voyage avec le refus', dire(perime));
  x = await m.patch({ id: HENRARD, centerId: 'gembloux', baseUpdatedAt: version(HENRARD), toutLeGroupe: { ecart: 30 } });
  v(x.statut === 422 && x.json.message === 'Une réservation reste dans son centre : annulez-la et recréez-la dans l autre.' && brut(HENRARD) === apres, '[I] un autre centre : refuse', dire(x));
  x = await m.decaler(TARD, { ecart: 60 });
  v(x.statut === 422 && x.json.message === 'Tout le groupe ne change pas de jour d’ici : passez par Modifier.', '[I] 23:00 +60 min : le groupe ne passe pas au lendemain d ici', dire(x));
  x = await m.decaler(9904, { ecart: 30 });
  v(x.statut === 422 && x.json.message === 'Un accès à volonté garde ses pistes et ses armes toute la visite : changez son heure par Modifier.', '[I] un acces a volonte ne se decale pas d ici', dire(x));
  x = await m.decaler(9905, { ecart: 30 });
  v(x.statut === 422 && x.json.message === 'Cette réservation est annulée.', '[I] une reservation annulee ne se decale pas', dire(x));
  return liste;
}

// ---------------------------------------------------------------------------
// LES GROUPES ET LEURS CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const GROUPES = { groupeEcriture, groupeABlanc, groupeGel, groupeDroits, groupeCorps };
const API = 'api/staff-reservations.js';
const BASE = 'lib/database.js';
const DG = 'lib/decaler-le-groupe.js';
const RETARD = 'lib/retard-arrivee.js';

const CONTRE_PREUVES = [
  { nom: 'la frise ne suit pas', groupe: 'groupeEcriture', attendu: /\[A\] toute la visite bouge/, mutations: [{ fichier: DG, de: '  if (Array.isArray(plan.timeline)) sortie.timeline = plan.timeline.map((b) => decalerUnBloc(b, ecart));\n', vers: '' }] },
  { nom: 'l arrivee ne suit pas', groupe: 'groupeEcriture', attendu: /\[A\] Sacha \+30 min : 200/, mutations: [{ fichier: DG, de: '  let dossier = { ...current, startTime: heureDe(minuteDe(current.startTime) + decalage), opsPlan: planDecale(current.opsPlan, decalage) };', vers: '  let dossier = { ...current, opsPlan: planDecale(current.opsPlan, decalage) };' }] },
  { nom: 'les bornes recomptees', groupe: 'groupeEcriture', attendu: /\[A\] toute la visite bouge/, mutations: [{ fichier: DG, de: '  if (avant && dossier.opsPlan && typeof dossier.opsPlan === \'object\') {', vers: '  if (false) {' }] },
  { nom: 'aucune activite jugee', groupe: 'groupeEcriture', attendu: /\[C\] \+90 min : refuse/, mutations: [{ fichier: DG, de: '      const verdict = sansLesGroupesQuiJouent(current, envoi, autres, maintenant, () => valider(essai, envoi));', vers: '      const verdict = null;' }] },
  { nom: 'une partie calee en silence', groupe: 'groupeEcriture', attendu: /\[C\] \+5 min : son laser ne se cale pas/, mutations: [{ fichier: DG, de: '      if (calee) throw calee;\n', vers: '' }] },
  { nom: 'ce qui coince passe quand meme', groupe: 'groupeEcriture', attendu: /\[C\] tout ou rien|\[C\] \+90 min/, mutations: [{ fichier: DG, de: '        error.heureDuDeplacement = heureDe(etape.apres);\n      }\n      throw error;\n', vers: '        error.heureDuDeplacement = heureDe(etape.apres);\n      }\n' }] },
  { nom: 'le refus sans l activite', groupe: 'groupeEcriture', attendu: /\[C\] \+90 min : refuse/, mutations: [{ fichier: DG, de: '        error.cleDuDeplacement = etape.cle;\n', vers: '' }] },
  { nom: 'le refus sans l heure', groupe: 'groupeEcriture', attendu: /\[C\] \+90 min : refuse/, mutations: [{ fichier: DG, de: '        error.heureDuDeplacement = heureDe(etape.apres);\n', vers: '' }] },
  { nom: 'le handler tait ce qui coince', groupe: 'groupeEcriture', attendu: /\[C\] \+90 min : refuse/, mutations: [{ fichier: API, de: "    if (error && error.cleDuDeplacement) Object.assign(extra, { cle: String(error.cleDuDeplacement), heure: String(error.heureDuDeplacement || '') });\n", vers: '' }] },
  { nom: 'les pistes du groupe forcees', groupe: 'groupeEcriture', attendu: /\[D\] Nathan \+30 min/, mutations: [{ fichier: DG, de: "      dossier = etape.activityId === 'bowling' && jour\n        ? tenirLeBowling({ ...etape.move, dureeHeures: etape.duree / 60 }, essayer, jour, centreId || current.centerId || 'libramont')\n        : essayer(etape.move);", vers: '      dossier = essayer(etape.move);' }] },
  { nom: 'Annuler oublie les pistes d avant', groupe: 'groupeEcriture', attendu: /\[D\] « Annuler »/, mutations: [{ fichier: DG, de: '      const voulues = pistes && pistes.length === leurs.length ? pistes : leurs;', vers: '      const voulues = leurs;' }] },
  { nom: 'le resume ne se pose pas', groupe: 'groupeEcriture', attendu: /\[A\] la derniere modification/, mutations: [{ fichier: BASE, de: '    payload.extras = current.extras;\n    poserDerniereModif(payload, current, { modifiePar: input.modifiePar }, payload.lanes);\n    return mapReservation((await ecrireReservation(client, payload, payload.lanes)).rows[0]);\n  });\n}\n\n// Application ATOMIQUE', vers: '    payload.extras = current.extras;\n    return mapReservation((await ecrireReservation(client, payload, payload.lanes)).rows[0]);\n  });\n}\n\n// Application ATOMIQUE' }] },
  { nom: 'le journal ne dit pas le geste', groupe: 'groupeEcriture', attendu: /\[A\] le journal le note/, mutations: [{ fichier: API, de: "action: 'decalerToutLeGroupe'", vers: "action: 'modifierReservation'" }] },
  { nom: 'pas de copie de secours', groupe: 'groupeEcriture', attendu: /\[A\] la copie de secours part/, mutations: [{ fichier: API, de: "  const secours = await copierAuSecours(reservation, 'modifiee', current, session);\n  const avertissements = [audit.warning, secours].filter(Boolean);\n  sendJson(res, 200, { ok: true, reservation, toutLeGroupe:", vers: "  const secours = '';\n  const avertissements = [audit.warning, secours].filter(Boolean);\n  sendJson(res, 200, { ok: true, reservation, toutLeGroupe:" }] },
  { nom: 'le calcul a blanc complaisant', groupe: 'groupeABlanc', attendu: /\[E\] pour \d+ ecarts/, mutations: [{ fichier: API, de: "        return { passe: false, raison: phraseDuRefus(error.message), ...(error.cleDuDeplacement ? { cle: String(error.cleDuDeplacement), heure: String(error.heureDuDeplacement || '') } : {}) };", vers: '        return { passe: true };' }] },
  { nom: 'le calcul a blanc tait les pistes', groupe: 'groupeABlanc', attendu: /\[E\] il dit les pistes/, mutations: [{ fichier: API, de: "        return { passe: true, ...(pistes.length && pistes.join(',') !== avant ? { pistes } : {}) };", vers: '        return { passe: true };' }] },
  { nom: 'le groupe remonte le temps', groupe: 'groupeABlanc', attendu: /\[E\] le groupe ne remonte pas le temps/, mutations: [{ fichier: API, de: "        if (tot) return { passe: false, plancher: true, cle: tot.cle, heure: tot.move.startTime, raison: 'Cette heure est déjà passée.' };\n", vers: '' }] },
  { nom: 'le calcul a blanc ne gele pas', groupe: 'groupeGel', attendu: /\[F\] le calcul a blanc rend `gele`/, mutations: [{ fichier: API, de: '    if (enJeu) return { ok: true, dryRun: true, deplacement: true, groupe: true, gele: enJeu.phrase, essais: [] };\n', vers: '' }] },
  { nom: 'le verrou ne gele plus', groupe: 'groupeGel', attendu: /\[F\] sous le verrou/, mutations: [{ fichier: BASE, de: "    if (enJeu) { const error = new Error(enJeu.phrase); error.statusCode = 409; error.code = 'groupe_en_jeu'; error.expose = true; throw error; }\n    const reservations = await listReservationsForDate(client, current.date, current.id, current.centerId);\n    const laneStatuses = await getLaneStatusMap(client, current.centerId, current.date);\n    const blocks = await resolveBlocksOnClient(client, current.centerId, current.date);\n    const { dossier } = decalerLeGroupe(", vers: '    const reservations = await listReservationsForDate(client, current.date, current.id, current.centerId);\n    const laneStatuses = await getLaneStatusMap(client, current.centerId, current.date);\n    const blocks = await resolveBlocksOnClient(client, current.centerId, current.date);\n    const { dossier } = decalerLeGroupe(' }] },
  { nom: 'plus aucun gel', groupe: 'groupeGel', attendu: /\[F\] Lina \(sur place/, mutations: [
    { fichier: API, de: '  exigerLesDroitsDuGroupe(current, session);\n  refuserSiLeGroupeJoue(current);\n', vers: '  exigerLesDroitsDuGroupe(current, session);\n' },
    { fichier: BASE, de: "    if (enJeu) { const error = new Error(enJeu.phrase); error.statusCode = 409; error.code = 'groupe_en_jeu'; error.expose = true; throw error; }\n    const reservations = await listReservationsForDate(client, current.date, current.id, current.centerId);\n    const laneStatuses = await getLaneStatusMap(client, current.centerId, current.date);\n    const blocks = await resolveBlocksOnClient(client, current.centerId, current.date);\n    const { dossier } = decalerLeGroupe(", vers: '    const reservations = await listReservationsForDate(client, current.date, current.id, current.centerId);\n    const laneStatuses = await getLaneStatusMap(client, current.centerId, current.date);\n    const blocks = await resolveBlocksOnClient(client, current.centerId, current.date);\n    const { dossier } = decalerLeGroupe(' },
  ] },
  { nom: 'la phrase redit « joue »', groupe: 'groupeGel', attendu: /\[H\] aucune phrase ne dit « joue »/, mutations: [{ fichier: RETARD, de: "  return { depuis, motif, phrase: `${current.name || 'Ce groupe'} : ${motif}. Ses heures ne bougent plus.` };", vers: "  return { depuis, motif: `joue depuis ${depuis}`, phrase: `${current.name || 'Ce groupe'} joue depuis ${depuis} : ses heures ne bougent plus.` };" }] },
  { nom: 'la coche ne se dit pas', groupe: 'groupeGel', attendu: /\[H\] une coche a la main gele|\[F\] Manon, sa 1re partie cochee/, mutations: [{ fichier: RETARD, de: '  const motif = cochees.length ? ', vers: '  const motif = false ? ' }] },
  { nom: 'le gel change de regle', groupe: 'groupeGel', attendu: /\[H\] la regle ne change pas/, mutations: [{ fichier: RETARD, de: '  const commencees = activitesAHeure(current).filter((etape) => gelees.has(etape.cle) || (surPlace(current) && etape.debut <= maintenant && etape.debut >= arrivee));', vers: '  const commencees = activitesAHeure(current).filter((etape) => gelees.has(etape.cle) || (etape.debut <= maintenant && etape.debut >= arrivee));' }] },
  { nom: 'le droit du laser oublie', groupe: 'groupeDroits', attendu: /\[G\] sans le planning laser/, mutations: [{ fichier: API, de: "  if ((activites.has('bowling') && !sessionHasPermission(session, 'planning.bowling')) || (activites.has('laser_game') && !sessionHasPermission(session, 'planning.laser'))) {", vers: "  if (activites.has('bowling') && !sessionHasPermission(session, 'planning.bowling')) {" }] },
  { nom: 'un jour passe ouvert', groupe: 'groupeDroits', attendu: /\[G\] un jour passe, sans son droit/, mutations: [{ fichier: API, de: "  if (dateValide(current.date) && current.date < aujourdhuiABruxelles() && !sessionHasPermission(session, 'planning.past')) throw createHttpError('Changer un jour passé ne fait pas partie de votre rôle.', 403);\n}\nasync function patcherToutLeGroupe", vers: '}\nasync function patcherToutLeGroupe' }] },
  { nom: 'un autre champ passe', groupe: 'groupeCorps', attendu: /\[I\] aucun autre champ/, mutations: [{ fichier: API, de: "  if (enTrop.length) throw createHttpError('Décaler tout le groupe ne modifie aucun autre choix du dossier.', 422);\n", vers: '' }] },
  { nom: 'la version ignoree', groupe: 'groupeCorps', attendu: /\[I\] une console restee sur la version d avant/, mutations: [
    { fichier: API, de: '  if (!body.baseUpdatedAt || !memeVersion(current.updatedAt, lireVersionAttendue(body.baseUpdatedAt))) throw reservationModifieeEntreTemps(current);\n  exigerLesDroitsDuGroupe(current, session);\n  refuserSiLeGroupeJoue(current);\n', vers: '  exigerLesDroitsDuGroupe(current, session);\n  refuserSiLeGroupeJoue(current);\n' },
    { fichier: BASE, de: "    if (!memeVersion(current.updatedAt, versionAttendue)) throw reservationModifieeEntreTemps(current);\n    if (input.centerId && input.centerId !== current.centerId) {\n      const error = new Error('Actualisez ce dossier dans son établissement avant de le déplacer.'); error.statusCode = 409; error.expose = true; throw error;\n    }\n    // (une activite cochee entre la lecture et le verrou", vers: "    if (input.centerId && input.centerId !== current.centerId) {\n      const error = new Error('Actualisez ce dossier dans son établissement avant de le déplacer.'); error.statusCode = 409; error.expose = true; throw error;\n    }\n    // (une activite cochee entre la lecture et le verrou" },
  ] },
  { nom: 'le groupe change de jour', groupe: 'groupeCorps', attendu: /\[I\] 23:00 \+60 min/, mutations: [{ fichier: DG, de: "  if (arrivee + ecart < 0 || arrivee + ecart >= JOUR) throw refus('Tout le groupe ne change pas de jour d’ici : passez par Modifier.');\n", vers: '' }] },
  { nom: 'un acces a volonte decale', groupe: 'groupeCorps', attendu: /\[I\] un acces a volonte/, mutations: [{ fichier: DG, de: "  if (blocs.some((b) => b && b.aVolonte)) throw refus('Un accès à volonté garde ses pistes et ses armes toute la visite : changez son heure par Modifier.');\n", vers: '' }] },
  { nom: 'un ecart sans borne', groupe: 'groupeCorps', attendu: /\[I\] un ecart nul/, mutations: [{ fichier: DG, de: '  if (!Number.isInteger(ecart) || ecart === 0 || Math.abs(ecart) > ECART_MAX)', vers: '  if (!Number.isFinite(ecart))' }] },
];

process.on('beforeExit', () => {
  console.error('FAIL  decaler-groupe-check s est arrete avant son bilan : une promesse jamais tenue');
  process.exit(1);
});

async function main() {
  const contrePreuves = process.argv.includes('--contre-preuves');
  let echecs = 0;
  if (!contrePreuves) {
    for (const [nom, groupe] of Object.entries(GROUPES)) {
      const liste = await groupe();
      liste.forEach(({ ok, label, detail }) => {
        console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  ${detail.slice(0, 1200)}`}`);
        if (!ok) echecs += 1;
      });
      if (!liste.length) { console.log(`FAIL  ${nom} n a rien verifie`); echecs += 1; }
    }
    B.sortir('decaler-groupe-check', echecs, 'tout le groupe se decale d un bloc, tout ou rien ; ce qui coince se dit ; un groupe qui joue ne bouge pas.');
    return;
  }
  for (const c of CONTRE_PREUVES) {
    const liste = await GROUPES[c.groupe](c.mutations).catch((error) => [{ ok: false, label: `exception : ${error.message}`, detail: '' }]);
    const rouges = liste.filter((x) => !x.ok);
    const mord = rouges.some((x) => c.attendu.test(x.label));
    console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve « ${c.nom} » : ${mord ? 'le gate rougit' : `AUCUN ROUGE ATTENDU (${rouges.length} rouge(s) : ${rouges.slice(0, 2).map((x) => x.label).join(' | ') || 'aucun'})`}`);
    if (!mord) echecs += 1;
  }
  B.sortir('decaler-groupe-check --contre-preuves', echecs, `${CONTRE_PREUVES.length} gardes retirees une a une, chacune fait rougir sa ligne.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

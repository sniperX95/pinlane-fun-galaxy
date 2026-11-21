// LE PROGRAMME COMPLET : CHAQUE ACTIVITE SE REGLE ET A SON HEURE, DANS MODIFIER COMME DANS RESERVER
// (2026-11-19).
//
// Ansar, 19/11, en vrai a Gembloux, sa capture de Modifier sur un dossier de 40 joueurs (Billard
// « Libre » « 1 table · 1h » avec ses seuls joueurs, Arcades « Libre ») : « Quand on réserve, on ne
// peut pas choisir l'heure pour chaque activité », puis « Même quand c'est Libre, on doit pouvoir
// modifier. Toutes les activités, on ne sait pas les modifier de manière complète comparé à quand on
// prend une résa : par exemple au billard on ne peut pas choisir le nombre de tables. » La regle :
//   [P1] PARITE : dans Modifier, chaque activite propose ce que Reserver lui propose : les tables et
//        la duree au billard (comme rsReglagesActivite), la duree du duckpin, la session du Fun Run,
//        les parties du laser au-dela de 3 et son arene ; un toucher se lit dans la barre du bas et
//        le prix suit ; « Enregistrer » envoie le programme, et en base le billard a ses 2 tables ;
//   [P2] le serveur juge un reglage comme une creation : 7 tables pour 6 au centre sont refusees,
//        avec le compte du centre (« Billards : 6 tables au plus. ») ; l arene « pour vous seuls »
//        replanifie le laser (opsPlan.arene) ;
//   [L1] UNE ACTIVITE LIBRE RECOIT UNE HEURE : son « Libre » se touche, l heure tapee se lit a
//        gauche et dans la barre (« Billard Libre → 19:00 »), « Enregistrer » envoie UN deplacement
//        (PATCH activityMove), en base une etape a heure de sa duree (heurePosee), le prix ne bouge
//        pas, la fiche Infos la lit a son heure ;
//   [L2] elle passe par le meme controle : une heure sur le bowling du groupe est refusee avant le
//        clic, a l activite, avec la phrase de Modifier (« Ce déplacement chevauche le Bowling du
//        groupe, de 16:00 à 17:30. ») ; des tables deja prises : « Billards complet de 18:00 à 19:00. » ;
//   [L3] LE CHEMIN INVERSE : une heure redevient « Libre » (bouton encadre a cote du champ), un
//        deplacement { libre: true }, en base une etape libre ; l historique le dit ;
//   [N1] RIEN NE CHANGE POUR QUI NE TOUCHE A RIEN : ouvrir Modifier puis Enregistrer n ecrit rien ;
//   [R1] RESERVER : la ligne d une activite libre propose ses heures (« Libre » d abord) ; une heure
//        touchee se lit au ticket, part avec le dossier (heuresPosees) et le dossier cree l a, a son
//        heure ; elle reste posee quand l ordre des activites change ;
//   [R2] une heure qui ne tient pas : la phrase de Modifier sous la rangee et sur la ligne du
//        ticket, et le serveur ne cree rien (409, meme phrase) ;
//   [R3] UNE FORMULE TELLE QUELLE : sa page dit l heure de chaque activite sur la case de son contenu,
//        chacune se pose ; une piste prise se dit comme dans Modifier (« Piste 7 déjà prise de 16:00 à
//        17:00. ») et ne se prend pas ; une
//        heure qui tient part et le dossier cree l a ;
//   [S1] le serveur : chaque heure posee s applique apres le moteur, par buildActivityMove puis
//        validateActivityMoveResources ; une variante de l horloge porte ses heures posees ; un corps
//        forge est refuse (422) ;
//   [V1] UN ACCES ILLIMITE A VOLONTE (lib/a-volonte.js, fusionne le 19/11) : tout s y joue a volonte
//        pendant la visite, aucune heure ne s y pose a la main dans Reserver ; le serveur refuse celle
//        d un bowling garde toute la visite, avec sa phrase ;
//   [D1] au telephone (375 px) : rien ne deborde, chaque nouveau bouton se touche au doigt ;
//   [J1] aucune erreur JS.
// La console reelle (scripts/planning-v3-fixtures.js, journee « pic » de Fun Galaxy Libramont,
// samedi 16 janvier 2027 a 15:10) ; ses PATCH et ses POST partent au VRAI handler
// api/staff-reservations.js, sur la base en memoire de scripts/reserver-banc.js (aucune base reelle,
// aucun reseau). Un autre groupe y tient les 6 tables de billard de 18:00 a 19:00.
// --contre-preuves : chaque garde retiree (en memoire ; le disque n est jamais touche) est d abord
// montable (son ancre existe une fois et une seule), puis ce gate ROUGIRAIT sur sa lettre.
//   PC_MUTATIONS : un sous-ensemble ; PC_BAVARD : les lignes des contre-preuves ;
//   PC_CAPTURES=<dossier> : les images, grand ecran et telephone.
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_PROGRAMME_COMPLET_PORT || 5471);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const API = 'api/staff-reservations.js';
const MOVE = 'lib/reservation-activity-move.js';
const BASE = 'lib/database.js';
const FENETRE = 'lib/reserver-fenetre.js';
const SIMULATION = 'lib/reserver-simulation.js';
const POSEES = 'lib/heures-posees.js';
const HISTO = 'lib/historique-dossier.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);
const CAPTURES = process.env.PC_CAPTURES || '';

const BILLARD = 1619; // bowling 16:00-17:30 piste 5, 6 joueurs, Billard « Libre » (1 table, 1h)
const LINA = 1601; // Formule 5, 11 joueurs : laser 15:00 et 15:30, Minigolf Blacklight 16:00
const MANON = 1618; // laser 15:30 et 16:00, 8 joueurs
const ARENE = 1630; // laser 21:30, 20 joueurs : l arene peut leur etre reservee
const TABLES = 1700; // pose ici : un club tient les 6 tables de billard de 18:00 a 19:00

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}

let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel && !ed.serveur) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// LA BASE : la journee de la fixture, plus le club qui tient les tables.
// ---------------------------------------------------------------------------
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
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
function clubDesTables() {
  const modele = FIXTURE.staffState.reservations.find((r) => r.id === BILLARD);
  return ligneDepuis({
    ...modele, id: TABLES, name: 'Club de la Queue', phone: '0470999888', pax: 12, startTime: '18:00', duration: 1, totalDuration: 1, lanes: [], type: 'activite', label: 'Billard', price: 60, basePrice: 60,
    program: { items: [{ activityId: 'billards', name: 'Billard', units: 6, hours: 1, minutes: 60, participants: 12, priceType: 'per_unit_hour', unitLabel: 'par table et par heure', price: 60, priceKnown: true, planned: false }], price: 60, priceComplete: true },
    opsPlan: { startTime: '18:00', endTime: '19:00', resourceBlocks: [], timeline: [{ type: 'activity', activityId: 'billards', label: 'Billard', players: 12, flexible: false, heurePosee: true, start: 1080, end: 1140, startTime: '18:00', endTime: '19:00', durationMinutes: 60 }] },
  });
}
function semer({ club = true } = {}) { B.semer([...FIXTURE.staffState.reservations.map(ligneDepuis), ...(club ? [clubDesTables()] : [])]); }
function monterServeur() {
  return B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
}
const brut = (id) => JSON.stringify(B.base.reservations.get(Number(id)) || null);
const version = (id) => new Date(B.base.reservations.get(Number(id)).updated_at).toISOString();
function planEnBase(id) {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {});
  const program = typeof row.program === 'string' ? JSON.parse(row.program) : (row.program || {});
  return { row, plan, program, prix: Number(row.price) };
}
const etapeDe = (plan, id) => ((plan && plan.timeline) || []).filter((s) => s && s.activityId === id && s.type === 'activity');
const ditEtape = (plan, id) => etapeDe(plan, id).map((s) => `${s.startTime}-${s.endTime}${s.flexible ? ' libre' : ''}${s.heurePosee ? ' posee' : ''}`).join(' ');
const nouvelles = (avant) => [...B.base.reservations.keys()].filter((id) => !avant.includes(id));

// Le corps que la fenetre Reserver enverrait : une visite bowling puis billard, 6 joueurs.
function visite(debut, extra = {}) {
  return {
    centerId: 'libramont', date: JOUR, name: 'Famille Posée', phone: '0470111222', email: '', status: 'pending', startTime: debut, duration: 1, totalDuration: 2, pax: 6, type: 'visite',
    lanes: [], laneCount: 1, requiresLanes: true, channel: 'staff', allowPastStart: false,
    program: [{ activityId: 'bowling', duration: 1, pax: 6, participants: 6 }, { activityId: 'billards', pax: 6, participants: 6, units: 1, hours: 1 }],
    preference: { activityOrder: ['bowling', 'billards'], preferredTimes: { bowling: debut } }, ...extra,
  };
}
// La Formule 3 telle quelle (minigolf, bowling, arcades), 8 joueurs.
function formule3(debut, extra = {}) {
  return { centerId: 'libramont', date: JOUR, name: 'Anniversaire Posé', phone: '0470111333', email: '', status: 'pending', startTime: debut, duration: 1, totalDuration: 3, pax: 8, type: 'formule', formuleId: 'f3', label: 'FORMULE 3', lanes: [], laneCount: 2, requiresLanes: true, channel: 'staff', ...extra };
}

// ---------------------------------------------------------------------------
// [S1] [P2] [L2] [L3] LE SERVEUR, SANS NAVIGATEUR.
// ---------------------------------------------------------------------------
async function scenarioServeur() {
  semer();
  const serveur = monterServeur();
  const blanc = (id, moves) => serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', deplacement: { id, centerId: 'libramont', baseUpdatedAt: version(id), activityMoves: moves } });
  const patch = (id, corps) => serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', baseUpdatedAt: version(id), ...corps });

  // Une activite libre recoit une heure (le calcul a blanc de Modifier), puis les deux refus.
  const a = await blanc(BILLARD, [{ activityId: 'billards', startTime: '19:00' }]);
  const planA = a.json.reservation && a.json.reservation.opsPlan;
  ok(a.statut === 200 && ditEtape(planA, 'billards') === '19:00-20:00 posee' && brut(BILLARD) === JSON.stringify(B.base.reservations.get(BILLARD)),
    '[L1] le billard « Libre » recoit 19:00 : une etape a heure de sa duree (1 h), posee a la main', { statut: a.statut, etape: ditEtape(planA, 'billards'), refus: a.json.refus });
  const b = await blanc(BILLARD, [{ activityId: 'billards', startTime: '16:30' }]);
  ok(b.json.refus && b.json.refus.message === 'Ce déplacement chevauche le Bowling du groupe, de 16:00 à 17:30. Cet horaire reste inchangé.',
    '[L2] sur le bowling du groupe : « Ce déplacement chevauche le Bowling du groupe, de 16:00 à 17:30. »', b.json);
  const c = await blanc(BILLARD, [{ activityId: 'billards', startTime: '18:00' }]);
  ok(c.json.refus && c.json.refus.message === 'Billards complet de 18:00 à 19:00.', '[L2] les 6 tables deja prises : « Billards complet de 18:00 à 19:00. »', c.json);

  // L ecriture : l heure, puis le chemin inverse, chacun par un seul deplacement.
  const avantPrix = planEnBase(BILLARD).prix;
  const d = await patch(BILLARD, { activityMove: { activityId: 'billards', startTime: '19:00' } });
  const apresD = planEnBase(BILLARD);
  ok(d.statut === 200 && ditEtape(apresD.plan, 'billards') === '19:00-20:00 posee' && apresD.prix === avantPrix && ditEtape(apresD.plan, 'bowling') === '16:00-17:30',
    '[L1] en base : le billard a 19:00, le bowling a son heure, le prix inchange', { statut: d.statut, json: d.json.message, billard: ditEtape(apresD.plan, 'billards'), prix: apresD.prix });
  const e = await patch(BILLARD, { activityMove: { activityId: 'billards', libre: true } });
  const apresE = planEnBase(BILLARD);
  ok(e.statut === 200 && /^\d{2}:\d{2}-\d{2}:\d{2} libre$/.test(ditEtape(apresE.plan, 'billards')) && apresE.prix === avantPrix,
    '[L3] le chemin inverse : { libre: true } rend une etape libre, le prix inchange', { statut: e.statut, json: e.json.message, billard: ditEtape(apresE.plan, 'billards') });
  ok(((apresE.plan.derniereModif || {}).quoi || []).includes('Au planning : Billards sans heure, en accès libre'),
    '[L3] la derniere modification le dit : « Au planning : Billards sans heure, en accès libre »', apresE.plan.derniereModif);
  const deja = await blanc(BILLARD, [{ activityId: 'billards', libre: true }]);
  ok(deja.json.refus && deja.json.refus.message === 'Cette activité est déjà libre pendant la visite.', '[L3] une activite deja libre le dit', deja.json);

  // [P2] un reglage se juge comme une creation.
  const items = (planEnBase(BILLARD).program.items || []).map((item) => ({ ...item }));
  const sept = await patch(BILLARD, { program: { items: items.map((item) => (item.activityId === 'billards' ? { ...item, units: 7 } : item)) } });
  ok(sept.statut === 422 && /Billards : 6 tables au plus\./.test(sept.json.message || sept.json.error || ''), '[P2] 7 tables pour 6 au centre : « Billards : 6 tables au plus. », rien d ecrit', { statut: sept.statut, json: sept.json });

  // [S1] Reserver : les heures posees, apres le moteur.
  const v = await serveur.appeler('POST', '/api/staff-reservations', { ...visite('17:00', { heuresPosees: { billards: '19:00' } }), dryRun: true });
  const etapesV = ((v.json.plan || {}).etapes || []).map((x) => `${x.activite}@${x.debut}-${x.fin}${x.libre ? ' libre' : ''}`);
  ok(v.json.plan && v.json.plan.disponible === true && etapesV.includes('billards@19:00-20:00') && etapesV.includes('bowling@17:00-18:00'),
    '[S1] la simulation de Reserver pose le billard a 19:00 apres le moteur, le bowling garde son heure', { plan: v.json.plan && { dispo: v.json.plan.disponible, refus: v.json.plan.refus, etapes: etapesV } });
  const w = await serveur.appeler('POST', '/api/staff-reservations', { ...visite('17:00', { heuresPosees: { billards: '17:00' } }), dryRun: true });
  // (sans « Cet horaire reste inchangé. », qui ne vaut que pour un dossier deja ecrit)
  ok(w.json.plan && w.json.plan.disponible === false && w.json.plan.refus === 'Ce déplacement chevauche le Bowling du groupe, de 17:00 à 18:00.'
    && JSON.stringify(w.json.plan.heureRefusee) === JSON.stringify({ activite: 'billards', heure: '17:00' }),
  '[R2] une heure posee sur le bowling du groupe : le plan ne tient pas, avec la phrase de Modifier, rendue a son activite', w.json.plan);
  const avantCreation = [...B.base.reservations.keys()];
  const x = await serveur.appeler('POST', '/api/staff-reservations', visite('17:00', { heuresPosees: { billards: '17:00' } }));
  ok(x.statut === 409 && /^Ce déplacement chevauche le Bowling du groupe/.test(x.json.message || x.json.error || '') && !nouvelles(avantCreation).length,
    '[R2] « Créer » avec cette heure : 409 et la meme phrase, aucun dossier cree', { statut: x.statut, json: x.json, nouvelles: nouvelles(avantCreation) });
  const y = await serveur.appeler('POST', '/api/staff-reservations', visite('17:00', { heuresPosees: { billards: '19:00' } }));
  const creee = nouvelles(avantCreation).map(planEnBase)[0];
  ok(y.statut === 201 && creee && ditEtape(creee.plan, 'billards') === '19:00-20:00 posee' && (creee.plan.resourceBlocks || []).some((bloc) => bloc.resourceType === 'bowling_lane' && bloc.startTime === '17:00'),
    '[R1] « Créer » avec le billard pose a 19:00 : le dossier cree l a, a son heure, le bowling a 17:00', { statut: y.statut, message: y.json.message, billard: creee && ditEtape(creee.plan, 'billards') });

  // [R3] la formule telle quelle : une piste prise, puis une heure qui tient.
  const f = await serveur.appeler('POST', '/api/staff-reservations', { ...formule3('17:00', { heuresPosees: { bowling: '16:00' } }), dryRun: true });
  ok(f.json.plan && f.json.plan.disponible === false && f.json.plan.refus === 'Piste 7 déjà prise de 16:00 à 17:00.' && (f.json.plan.heureRefusee || {}).activite === 'bowling',
    '[R3] le bowling d une formule pose a 16:00 : « Piste 7 déjà prise de 16:00 à 17:00. », comme dans Modifier', f.json.plan && { refus: f.json.plan.refus, heure: f.json.plan.heureRefusee });
  const g = await serveur.appeler('POST', '/api/staff-reservations', { ...formule3('17:00', { heuresPosees: { minigolf_blacklight: '19:15' } }), dryRun: true });
  const etapesG = ((g.json.plan || {}).etapes || []).map((z) => `${z.activite}@${z.debut}`);
  ok(g.json.plan && g.json.plan.disponible === true && etapesG.includes('minigolf_blacklight@19:15') && etapesG.includes('bowling@17:00'),
    '[R3] le minigolf d une formule pose a 19:15 : le plan tient, le bowling garde 17:00', g.json.plan && { refus: g.json.plan.refus, etapes: etapesG });

  // [S1] une variante de l horloge porte ses heures posees ; un corps forge est refuse.
  const k = await serveur.appeler('POST', '/api/staff-reservations', { ...visite('17:00'), dryRun: true, candidats: [{ heure: '17:00', startTime: '17:00', heuresPosees: { billards: '17:00' } }, { heure: '17:30', startTime: '17:00', heuresPosees: { billards: '19:00' } }] });
  const [k1, k2] = k.json.candidats || [];
  ok(k1 && k1.statut === 'ko' && k1.court === 'groupe occupé' && k2 && k2.statut === 'ok', '[S1] une variante de l horloge porte ses heures posees : « groupe occupé » a 17:00, « ok » a 19:00', k.json.candidats);
  const forge = await serveur.appeler('POST', '/api/staff-reservations', { ...visite('17:00', { heuresPosees: { billards: '25:00' } }), dryRun: true });
  const forge2 = await serveur.appeler('POST', '/api/staff-reservations', { ...visite('17:00', { heuresPosees: ['19:00'] }), dryRun: true });
  ok(forge.statut === 422 && forge2.statut === 422 && /Heures d’activité invalides/.test(`${forge.json.message || forge.json.error}`), '[S1] un corps forge (25:00, une liste) : 422 « Heures d’activité invalides. »', { a: forge, b: forge2 });
  // (les jetons d arcades se remettent au comptoir : rien ne s y joue a une heure, la fenetre ne la propose pas)
  const jetons = await serveur.appeler('POST', '/api/staff-reservations', { ...visite('17:00', { heuresPosees: { arcade_credit: '19:00' } }), dryRun: true });
  ok(jetons.statut === 422 && /Heures d’activité invalides/.test(`${jetons.json.message || jetons.json.error}`), '[S1] une heure posee sur les jetons d arcades : 422 « Heures d’activité invalides. »', { statut: jetons.statut, json: jetons.json.message || jetons.json.plan });
  // [V1] UN ACCES ILLIMITE A VOLONTE garde ses pistes toute la visite (lib/a-volonte.js) : une heure posee sur
  // son bowling est refusee avec sa phrase, le dossier reste celui du moteur.
  const { poserLesHeures } = require(path.join(ROOT, POSEES));
  const garde = { id: 0, centerId: 'libramont', date: JOUR, pax: 10, type: 'formule', status: 'pending', opsPlan: { resourceBlocks: [{ type: 'activity', activityId: 'bowling', label: 'Bowling', resourceType: 'bowling_lane', aVolonte: true, critical: true, start: 900, end: 1080, startTime: '15:00', endTime: '18:00', durationMinutes: 180, lanes: [1], requiredLanes: 1, players: 10 }], timeline: [] } };
  const pose = poserLesHeures(garde, [{ activityId: 'bowling', heure: '16:00' }], { reservations: [], laneStatuses: {}, blocks: [], date: JOUR });
  ok(pose.dossier === garde && pose.refus && pose.refus.message === 'Le bowling à volonté garde ses pistes toute la visite : il n’a pas d’heure à poser.',
    '[V1] le bowling a volonte d un acces illimite : une heure posee est refusee (« Le bowling à volonté garde ses pistes toute la visite »), le dossier reste celui du moteur', pose.refus);
  // (la formule creee en dernier : elle prend les pistes 7 et 8 a 17:00)
  const avantFormule = [...B.base.reservations.keys()];
  const h = await serveur.appeler('POST', '/api/staff-reservations', formule3('17:00', { heuresPosees: { minigolf_blacklight: '19:15' } }));
  const formuleCreee = nouvelles(avantFormule).map(planEnBase)[0];
  ok(h.statut === 201 && formuleCreee && /^19:15-/.test(ditEtape(formuleCreee.plan, 'minigolf_blacklight')) && formuleCreee.row.formule_id === 'f3',
    '[R3] « Créer » la formule avec son minigolf pose a 19:15 : le dossier cree l a, a son heure', { statut: h.statut, message: h.json.message, minigolf: formuleCreee && ditEtape(formuleCreee.plan, 'minigolf_blacklight') });
}

// ---------------------------------------------------------------------------
// LA CONSOLE : la fenetre Modifier.
// ---------------------------------------------------------------------------
function lire() {
  const m = document.querySelector('#posOverlay .edit-modal');
  if (!m || !state.selectedRes) return { fermee: true };
  const rangee = (id) => m.querySelector(`.fm-act[data-edit-activity="${id}"]`);
  const groupes = (id) => { const r = rangee(id); return r ? Array.from(r.querySelectorAll('.dossier-activity-setting')).map((g) => `${(g.querySelector('.lbl') || {}).textContent}:${Array.from(g.querySelectorAll('button')).map((b) => `${b.textContent.replace(/\s+/g, ' ').trim()}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`).join('|')}`) : []; };
  const t = (s) => { const n = m.querySelector(s); return n && !n.hidden ? n.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const heure = (id) => { const r = rangee(id); const h = r && r.querySelector('.fm-act-heure .fm-heure'); return h ? { texte: h.textContent.trim(), touche: h.classList.contains('fm-heure-touche'), changee: h.classList.contains('is-changee') } : null; };
  return {
    fermee: false,
    billard: groupes('billards'), laser: groupes('laser_game'),
    heures: { billards: heure('billards'), minigolf_blacklight: heure('minigolf_blacklight'), bowling: heure('bowling') },
    pied: t('#editModifs'), verdict: t('#editVerdict'),
    total: (document.getElementById('editPriceInput') || {}).value || '',
    champ: Array.from(m.querySelectorAll('[data-heure-champ]')).map((c) => `${c.getAttribute('data-heure-champ')}=${c.value}`),
    libres: Array.from(m.querySelectorAll('[data-heure-libre]')).map((b) => `${b.getAttribute('data-heure-libre')}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
    rouges: Array.from(m.querySelectorAll('.fm-heure-champ.is-refus')).map((c) => c.getAttribute('data-heure-zone')),
    refus: Array.from(m.querySelectorAll('[data-heure-refus]:not([hidden]) .fm-heure-phrase')).map((p) => p.textContent.trim()),
  };
}

async function verdictPose(page) {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => { const z = document.getElementById('editVerdict'); return !z || (!z.classList.contains('is-calcul') && !verdictEdition().enCours); }, null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(150);
}

async function enregistrer(page) {
  await page.locator('#posOverlay .es-save').click();
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(120);
    const bouton = page.locator('.staff-confirm [data-role="confirm-ok"]');
    if (await bouton.count()) await bouton.click();
    const fini = await page.evaluate(() => !document.querySelector('#posOverlay .edit-modal') || !state.selectedRes || /Pas enregistré/.test((document.getElementById('editVerdict') || {}).textContent || ''));
    if (fini) break;
  }
  await page.waitForTimeout(250);
  return page.evaluate(lire);
}

async function photo(page, nom, selecteur = '#posOverlay .edit-modal') {
  if (!CAPTURES || mutation || !nom) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  const cible = page.locator(selecteur).first();
  if (await cible.count()) await cible.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  else await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

async function monterConsole(browser, { appareil = 'ordinateur', club = true } = {}) {
  semer({ club });
  const serveur = monterServeur();
  const patchs = [];
  const posts = [];
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil, theme: 'light', port: PORT, heure: '15:10',
    avantChargement: async (p) => {
      await p.exposeFunction('__fixtureServeur', async (corps) => { patchs.push(corps); return serveur.appeler('PATCH', '/api/staff-reservations', corps); });
      await p.exposeFunction('__fixtureBlanc', async (corps) => { posts.push(corps); return serveur.appeler('POST', '/api/staff-reservations', corps); });
    },
  });
  // Le telephone de la consigne : 375 px de large.
  if (appareil === 'telephone') await page.setViewportSize({ width: 375, height: 812 });
  return { ctx, page, erreurs, patchs, posts, serveur };
}

async function ouvrirModifier(page, id) {
  await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
  await page.waitForTimeout(200);
  await verdictPose(page);
}

async function scenarioModifier(browser) {
  const erreurs = [];
  // [P1] le billard : ses tables et sa duree, comme dans Reserver (sans le club : ses tables sont libres).
  {
    const { ctx, page, erreurs: e, patchs } = await monterConsole(browser, { club: false });
    try {
      await ouvrirModifier(page, BILLARD);
      const a = await page.evaluate(lire);
      ok(a.billard.includes('Tables:1*|2|3|4|5|6') && a.billard.includes('Durée:1 h*|2 h|3 h'), '[P1] le billard propose ses tables (1 a 6, la dotation) et sa duree (1h, 2h, 3h), comme dans Reserver', a.billard);
      ok(a.laser.length === 0, '[P1] (le dossier n a pas de laser)', a.laser);
      await photo(page, 'modifier-billard-tables-avant');
      await page.click('#posOverlay .fm-act[data-edit-activity="billards"] [data-reglage="units"][data-valeur="2"]');
      await page.click('#posOverlay .fm-act[data-edit-activity="billards"] [data-reglage="hours"][data-valeur="2"]');
      await verdictPose(page);
      const b = await page.evaluate(lire);
      ok(b.billard.includes('Tables:1|2*|3|4|5|6') && b.billard.includes('Durée:1 h|2 h*|3 h') && /Réglages : Billard/.test(b.pied) && /Prix 69 € →/.test(b.pied),
        '[P1] 2 tables pendant 2 h : les touches le disent, la barre aussi (« Réglages : Billard »), et le prix suit le nouveau contenu', { billard: b.billard, pied: b.pied, total: b.total });
      const totalEcran = b.total;
      await photo(page, 'modifier-billard-tables');
      const c = await enregistrer(page);
      const base = planEnBase(BILLARD);
      const ligne = (base.program.items || []).find((item) => item.activityId === 'billards') || {};
      ok(c.fermee && patchs.some((p) => p.program) && ligne.units === 2 && ligne.hours === 2 && String(base.prix) === totalEcran,
        '[P1] « Enregistrer » : en base, le billard a 2 tables pendant 2 h, au prix que l ecran annoncait', { fermee: c.fermee, ligne: { units: ligne.units, hours: ligne.hours }, prix: base.prix, ecran: totalEcran, verdict: c.verdict });
      erreurs.push(...e);
    } finally { await ctx.close(); }
  }
  // [N1] ouvrir puis Enregistrer sans rien toucher n ecrit rien.
  {
    const { ctx, page, erreurs: e, patchs } = await monterConsole(browser);
    try {
      // (le contenu, cle par cle, dans un ordre fixe : la fixture n ecrit pas ses cles dans l ordre du serveur)
      const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
      const sansVersion = () => { const row = { ...B.base.reservations.get(BILLARD) }; delete row.updated_at; ['program', 'ops_plan'].forEach((k) => { if (typeof row[k] === 'string') row[k] = JSON.parse(row[k]); }); return JSON.stringify(canon(row)); };
      const avant = sansVersion();
      await ouvrirModifier(page, BILLARD);
      const a = await page.evaluate(lire);
      await enregistrer(page);
      ok(a.pied === 'Aucune modification' && sansVersion() === avant && !(patchs[0] || {}).activityMove && !(patchs[0] || {}).preference, '[N1] ouvert puis enregistre sans rien toucher : « Aucune modification », le dossier reste identique (ni heure, ni arene, ni programme)', { pied: a.pied, ecarts: (() => { const x = JSON.parse(avant); const y = JSON.parse(sansVersion()); return Object.keys({ ...x, ...y }).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).map((k) => k + '=' + JSON.stringify(x[k]).slice(0, 300) + ' -> ' + JSON.stringify(y[k]).slice(0, 300)); })() });
      erreurs.push(...e);
    } finally { await ctx.close(); }
  }
  // [L1] [L2] le billard « Libre » recoit une heure ; une heure sur le bowling est refusee.
  {
    const { ctx, page, erreurs: e, patchs } = await monterConsole(browser);
    try {
      await ouvrirModifier(page, BILLARD);
      const a = await page.evaluate(lire);
      ok(a.heures.billards && a.heures.billards.texte === 'Libre' && a.heures.billards.touche, '[L1] le « Libre » du billard se touche', a.heures.billards);
      await page.click('#posOverlay .fm-act[data-edit-activity="billards"] .fm-act-heure .fm-heure-touche');
      const b = await page.evaluate(lire);
      ok(b.champ.includes('billards=') && b.libres.includes('billards*'), '[L1] son champ s ouvre vide, « Libre » marque a cote', { champ: b.champ, libres: b.libres });
      await page.fill('#posOverlay [data-heure-champ="billards"]', '16:30');
      await verdictPose(page);
      const r = await page.evaluate(lire);
      ok(r.rouges.includes('billards') && r.refus.includes('Ce déplacement chevauche le Bowling du groupe, de 16:00 à 17:30.') && !patchs.length,
        '[L2] 16:30 : le champ en rouge et « Ce déplacement chevauche le Bowling du groupe, de 16:00 à 17:30. », rien ne part', { rouges: r.rouges, refus: r.refus, patchs: patchs.length });
      await photo(page, 'modifier-libre-refus');
      await page.fill('#posOverlay [data-heure-champ="billards"]', '18:00');
      await verdictPose(page);
      const t = await page.evaluate(lire);
      ok(t.refus.includes('Billards complet de 18:00 à 19:00.'), '[L2] 18:00 : « Billards complet de 18:00 à 19:00. » (les 6 tables du club)', t.refus);
      await page.fill('#posOverlay [data-heure-champ="billards"]', '19:00');
      await verdictPose(page);
      const c = await page.evaluate(lire);
      ok(c.heures.billards && c.heures.billards.texte === '19:00' && c.heures.billards.changee && /Billard Libre → 19:00/.test(c.pied) && !c.rouges.length && !c.refus.length && c.libres.includes('billards'),
        '[L1] 19:00 : la nouvelle heure se lit a gauche, en couleur, et dans la barre (« Billard Libre → 19:00 »), sans bruit, « Libre » n est plus marque', { heure: c.heures.billards, pied: c.pied, rouges: c.rouges, libres: c.libres });
      await photo(page, 'modifier-libre-heure');
      const d = await enregistrer(page);
      const base = planEnBase(BILLARD);
      ok(d.fermee && patchs.length === 1 && JSON.stringify(patchs[0].activityMove) === JSON.stringify({ activityId: 'billards', startTime: '19:00' }) && ditEtape(base.plan, 'billards') === '19:00-20:00 posee' && base.prix === 69,
        '[L1] « Enregistrer » : UN deplacement, en base le billard a 19:00, le prix inchange (69 €)', { fermee: d.fermee, patchs: patchs.map((p) => p.activityMove), billard: ditEtape(base.plan, 'billards'), prix: base.prix });
      const fiche = await page.evaluate((i) => { closePos(); openPos(i); setTab('infos'); const m = document.querySelector('#posOverlay .edit-modal'); const texte = m ? m.innerText.replace(/\s+/g, ' ') : ''; closePos(); return texte; }, BILLARD);
      ok(/19:00/.test(fiche) && /Billard/.test(fiche), '[L1] la fiche Infos lit le billard a 19:00', fiche.slice(0, 300));
      erreurs.push(...e);
    } finally { await ctx.close(); }
  }
  // [L3] une heure redevient Libre : le minigolf de Lina.
  {
    const { ctx, page, erreurs: e, patchs } = await monterConsole(browser);
    try {
      await ouvrirModifier(page, LINA);
      await page.click('#posOverlay [data-heure-cle="minigolf_blacklight"]');
      await page.click('#posOverlay [data-heure-libre="minigolf_blacklight"]');
      await verdictPose(page);
      const a = await page.evaluate(lire);
      ok(a.heures.minigolf_blacklight && a.heures.minigolf_blacklight.texte === 'Libre' && a.heures.minigolf_blacklight.changee && /Minigolf Blacklight 16:00 → Libre/.test(a.pied) && a.libres.includes('minigolf_blacklight*') && !a.refus.length,
        '[L3] « Libre » : la colonne dit « Libre » en couleur, la barre « Minigolf Blacklight 16:00 → Libre »', { heure: a.heures.minigolf_blacklight, pied: a.pied, libres: a.libres, refus: a.refus });
      await photo(page, 'modifier-heure-vers-libre');
      const b = await enregistrer(page);
      const base = planEnBase(LINA);
      ok(b.fermee && patchs.length === 1 && JSON.stringify(patchs[0].activityMove) === JSON.stringify({ activityId: 'minigolf_blacklight', libre: true }) && / libre$/.test(ditEtape(base.plan, 'minigolf_blacklight')),
        '[L3] « Enregistrer » : un deplacement { libre: true }, en base le minigolf est libre', { patchs: patchs.map((p) => p.activityMove), minigolf: ditEtape(base.plan, 'minigolf_blacklight'), verdict: b.verdict });
      erreurs.push(...e);
    } finally { await ctx.close(); }
  }
  // [P1] [P2] le laser : ses parties comme Reserver, et son arene, jugee comme une creation.
  {
    const { ctx, page, erreurs: e } = await monterConsole(browser);
    try {
      await ouvrirModifier(page, MANON);
      await page.click('#posOverlay .fm-act[data-edit-activity="laser_game"] [data-arene="seuls"]');
      await verdictPose(page);
      const refus = await page.evaluate(lire);
      ok(/Laser Game complet sur ce créneau/.test(refus.verdict), '[P2] « Pour vous seuls » quand d autres groupes jouent : le serveur le refuse avant le clic, comme une creation', refus.verdict);
      await ouvrirModifier(page, ARENE);
      const a = await page.evaluate(lire);
      ok(a.laser.some((g) => /^Parties par joueur:.*\+ Partie/.test(g)) && a.laser.includes('Arène:Autopartagée si besoin*|Pour vous seulspersonne d’autre'),
        '[P1] le laser propose « + Partie » (au-dela de 3, comme Reserver) et son arene (Auto, Pour vous seuls)', a.laser);
      await page.click('#posOverlay .fm-act[data-edit-activity="laser_game"] [data-arene="seuls"]');
      await verdictPose(page);
      const b = await page.evaluate(lire);
      ok(/Arène : pour vous seuls/.test(b.pied), '[P1] « Pour vous seuls » se lit dans la barre du bas', b.pied);
      const c = await enregistrer(page);
      const base = planEnBase(ARENE);
      ok(c.fermee && base.plan.arene === 'seuls', '[P2] « Enregistrer » : le serveur replanifie le laser pour ce groupe seul (opsPlan.arene)', { fermee: c.fermee, arene: base.plan.arene, verdict: c.verdict });
      erreurs.push(...e);
    } finally { await ctx.close(); }
  }
  ok(!erreurs.length, '[J1] aucune erreur JS (Modifier)', erreurs.slice(0, 3));
}

// ---------------------------------------------------------------------------
// LA CONSOLE : la fenetre Reserver.
// ---------------------------------------------------------------------------
function lireReserver() {
  const o = document.getElementById('quickBookOverlay');
  if (!o || !quickBookState) return { fermee: true };
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const rangee = document.querySelector('[data-heures-posees]');
  return {
    fermee: false,
    lignes: Array.from(o.querySelectorAll('.rs-tk-a')).map((b) => `${b.id}=${t(b)}`),
    heures: rangee ? Array.from(rangee.querySelectorAll('button')).map((b) => `${t(b.querySelector('b'))}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`) : [],
    refus: t(o.querySelector('.rs-heure-refus')),
    heuresFormule: Array.from(o.querySelectorAll('[data-heure-formule]')).map((b) => `${b.dataset.heureFormule} ${t(b.querySelector('.rs-cc-h b'))}`),
    posees: JSON.stringify(quickBookState.heuresPosees || {}),
    plan: quickBookState.plan ? quickBookState.plan.etat : '',
    creer: (document.getElementById('rvCreer') || {}).disabled === false,
  };
}

async function planPose(page) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => quickBookState && quickBookState.plan && quickBookState.plan.etat !== 'calcul' && quickBookState.plan.cle === quickBookState.cleCourante, null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(300);
}

async function ouvrirReserver(page) {
  await page.evaluate(() => { closePos(); });
  await page.locator('.btn-new').first().click();
  await page.waitForSelector('#quickBookOverlay .qb-modal.rv.rs', { timeout: 8000 });
}

async function creer(page, posts) {
  const avant = posts.length;
  await page.fill('#quickBookOverlay #qbPhone', '0470 11 22 33');
  await page.fill('#quickBookOverlay #qbName', 'Famille Posée').catch(() => null);
  await planPose(page);
  await page.click('#quickBookOverlay #rvCreer');
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(150);
    if (posts.slice(avant).some((p) => !p.dryRun)) break;
  }
  await page.waitForTimeout(500);
  return posts.slice(avant).filter((p) => !p.dryRun);
}

async function scenarioReserver(browser) {
  const erreurs = [];
  for (const appareil of ['ordinateur', 'telephone']) {
    const { ctx, page, erreurs: e, posts } = await monterConsole(browser, { appareil });
    const suffixe = appareil === 'telephone' ? '-telephone' : '';
    try {
      // Une visite : 6 joueurs, le bowling a 17:00, puis le billard.
      await ouvrirReserver(page);
      await page.click('#quickBookOverlay [data-pax="6"]');
      await page.click('#quickBookOverlay #rsZ-bowling [data-heure="17:00"]');
      await planPose(page);
      await page.click('#quickBookOverlay #rsT-billards');
      await planPose(page);
      // (la ligne du ticket, ou la tuile touchee une seconde fois : sa page)
      await page.evaluate(() => { if (typeof rsFermerQuestionJoueurs === 'function') rsFermerQuestionJoueurs(); rsOuvrirLigne('billards'); });
      await planPose(page);
      const a = await page.evaluate(lireReserver);
      ok(a.heures[0] === 'Libre*' && a.heures.includes('19:00') && a.heures.includes('17:00'), `[R1] ${appareil} : la ligne du billard propose ses heures, « Libre » d abord`, a.heures);
      ok(posts.length > 0 && posts.every((p) => !Object.prototype.hasOwnProperty.call(p, 'heuresPosees')), `[N1] ${appareil} : tant qu aucune heure n est posee, aucun corps ne porte heuresPosees (le dossier part comme avant)`, posts.map((p) => Object.keys(p).length));
      await page.click('#quickBookOverlay [data-heures-posees="billards"] [data-heure-l="17:00"]');
      await planPose(page);
      const r = await page.evaluate(lireReserver);
      const ligneR = r.lignes.find((l) => l.startsWith('rsL-a-billards=')) || '';
      // (la ligne du ticket finit par son prix : « sur place » pour le billard de ce centre)
      ok(r.refus === 'Ce déplacement chevauche le Bowling du groupe, de 17:00 à 18:00.' && ligneR.includes('Ce déplacement chevauche le Bowling du groupe, de 17:00 à 18:00.') && !/inchangé/.test(ligneR),
        `[R2] ${appareil} : 17:00 sur le bowling : la phrase de Modifier sous la rangee et sur la ligne du ticket`, { refus: r.refus, ligne: ligneR });
      await photo(page, `reserver-refus${suffixe}`, '#quickBookOverlay .qb-modal');
      await page.click('#quickBookOverlay [data-heures-posees="billards"] [data-heure-l="19:00"]');
      await planPose(page);
      const b = await page.evaluate(lireReserver);
      const ligneB = b.lignes.find((l) => l.startsWith('rsL-a-billards=')) || '';
      ok(b.heures.includes('19:00*') && /19:00/.test(ligneB) && !b.refus && b.posees === '{"billards":"19:00"}',
        `[R1] ${appareil} : 19:00 touche : la touche marquee, le ticket dit 19:00, sans refus`, { heures: b.heures, ligne: ligneB, refus: b.refus, posees: b.posees });
      await photo(page, `reserver-heure-billard${suffixe}`, '#quickBookOverlay .qb-modal');
      // L ordre change (le billard passe avant) : sa ligne redevient la premiere, l heure du bowling suit ;
      // remis apres, l heure posee est toujours la.
      await page.evaluate(() => { rsPasserAvant('billards'); rsPasserAvant('bowling'); });
      await planPose(page);
      const o = await page.evaluate(lireReserver);
      ok(o.posees === '{"billards":"19:00"}', `[R1] ${appareil} : l ordre change puis revient : l heure posee reste posee`, o.posees);
      if (appareil === 'ordinateur') {
        const envoyes = await creer(page, posts);
        const creee = Math.max(...B.base.reservations.keys());
        const base = planEnBase(creee);
        ok(envoyes.length === 1 && JSON.stringify(envoyes[0].heuresPosees) === '{"billards":"19:00"}' && base && ditEtape(base.plan, 'billards') === '19:00-20:00 posee',
          '[R1] « Créer » : le dossier part avec son heure posee, et le dossier cree a le billard a 19:00', { envoyes: envoyes.map((p) => p.heuresPosees), billard: base && ditEtape(base.plan, 'billards'), nom: base && base.row.name });
      }
      // La formule 3 telle quelle : sa page dit l heure de chaque activite, le bowling se pose.
      await page.evaluate(() => { closeQuickBook(); });
      await page.evaluate(() => openQuickBook({ date: state.currentDate, type: 'formule' }));
      await page.waitForSelector('#quickBookOverlay .qb-modal.rv.rs', { timeout: 8000 });
      await page.click('#quickBookOverlay [data-pax="8"]');
      await page.evaluate(() => { rvChoisirFormule('f3'); });
      await planPose(page);
      await page.evaluate(() => { rsHeureFormule('17:00'); rsOuvrirLigne('formule'); });
      await planPose(page);
      const f = await page.evaluate(lireReserver);
      ok(f.heuresFormule.includes('bowling 17:00') && f.heuresFormule.some((x) => /^minigolf.* 18:00$/.test(x)), `[R3] ${appareil} : la page de la formule dit l heure de chaque activite, sur la case de son contenu`, f.heuresFormule);
      await photo(page, `reserver-formule-heures${suffixe}`, '#quickBookOverlay .qb-modal');
      // (la case du bowling ouvre ses demi-heures sous le contenu ; 16:00, piste prise, ne se prend pas)
      await page.click('#quickBookOverlay [data-heure-formule="bowling"]');
      await planPose(page);
      await page.click('#quickBookOverlay [data-heures-act="bowling"] [data-heure-l="16:00"]');
      await planPose(page);
      const g = await page.evaluate(lireReserver);
      ok(/^16:00 ne tient pas\. Piste \d+ déjà prise de 16:00 à 17:00\.$/.test(g.refus) && !/bowling/.test(g.posees), `[R3] ${appareil} : le bowling de la formule a 16:00 : « Piste N déjà prise de 16:00 à 17:00. », comme dans Modifier, et l heure ne se prend pas`, { refus: g.refus, posees: g.posees });
      await photo(page, `reserver-formule-piste-prise${suffixe}`, '#quickBookOverlay .qb-modal');
      // [V1] Un acces illimite (la meme formule lue comme illimitee) : aucune heure ne se pose a la main, ni la
      // rangee « Heures » de sa page, ni la rangee d une activite ; les heures deja posees ne partent plus.
      const illimite = await page.evaluate(() => {
        const avant = window.rvFormuleIllimitee;
        try {
          window.rvFormuleIllimitee = () => ({ id: 'f3', illimite: { activites: rvActivites(), aVolonte: ['bowling'], minutes: 180 } });
          return { posables: rvActivites().filter((id) => rvPosable(id)), page: /data-heure-formule/.test(rsLigneFormuleHtml()), envoyees: rvHeuresPoseesEnvoyees(), lignes: Object.values(rvHeuresDesLignes()).filter((l) => l.posee).length };
        } finally { window.rvFormuleIllimitee = avant; }
      });
      ok(illimite.posables.length === 0 && !illimite.page && illimite.envoyees === null && illimite.lignes === 0,
        `[V1] ${appareil} : un acces illimite ne pose aucune heure a la main (ni rangee « Heures », ni heure envoyee)`, illimite);
      if (appareil === 'telephone') {
        const d = await page.evaluate(() => {
          const o = document.querySelector('#quickBookOverlay .qb-modal');
          // (les heures du bowling de la formule s ouvrent sous sa case du contenu : data-heures-act)
          const boites = Array.from(document.querySelectorAll('[data-heures-posees] button, [data-heures-act] button, [data-heure-formule]')).map((b) => { const r = b.getBoundingClientRect(); return { h: Math.round(r.height), l: Math.round(r.width), droite: Math.round(r.right) }; });
          return { largeur: window.innerWidth, defile: document.documentElement.scrollWidth - document.documentElement.clientWidth, modale: o ? Math.round(o.getBoundingClientRect().right) : 0, boites };
        });
        ok(d.largeur === 375 && d.defile <= 1 && d.boites.length > 0 && d.boites.every((x) => x.h >= 44 && x.l >= 44 && x.droite <= 375),
          '[D1] telephone (375 px) : la rangee des heures tient dans l ecran, chaque touche fait 44 px au moins', d);
      }
      erreurs.push(...e);
    } finally { await ctx.close(); }
  }
  ok(!erreurs.length, '[J1] aucune erreur JS (Reserver)', erreurs.slice(0, 3));
}

// [D1] Modifier au telephone : les nouveaux reglages et le bouton « Libre » tiennent et se touchent.
async function scenarioTelephone(browser) {
  const { ctx, page, erreurs } = await monterConsole(browser, { appareil: 'telephone' });
  try {
    await ouvrirModifier(page, BILLARD);
    await page.click('#posOverlay .fm-act[data-edit-activity="billards"] [data-reglage="units"][data-valeur="2"]');
    await verdictPose(page);
    await photo(page, 'modifier-billard-tables-telephone');
    const tables = await page.evaluate(() => Array.from(document.querySelectorAll('#posOverlay .fm-act[data-edit-activity="billards"] [data-reglage]')).map((n) => { const r = n.getBoundingClientRect(); return { h: Math.round(r.height), l: Math.round(r.width), droite: Math.round(r.right) }; }));
    // (une heure s enregistre seule : la fiche se rouvre sans les tables changees)
    await ouvrirModifier(page, BILLARD);
    await page.click('#posOverlay .fm-act[data-edit-activity="billards"] .fm-act-heure .fm-heure-touche');
    await page.fill('#posOverlay [data-heure-champ="billards"]', '16:30');
    await verdictPose(page);
    await page.locator('#posOverlay [data-heure-champ="billards"]').scrollIntoViewIfNeeded();
    await photo(page, 'modifier-libre-refus-telephone');
    const d = await page.evaluate(() => {
      const m = document.querySelector('#posOverlay .edit-modal');
      const boite = (n) => { const r = n.getBoundingClientRect(); return { h: Math.round(r.height), l: Math.round(r.width), droite: Math.round(r.right) }; };
      return {
        largeur: window.innerWidth,
        defile: m ? m.scrollWidth - m.clientWidth : -1,
        libre: Array.from(m.querySelectorAll('[data-heure-libre]')).map(boite),
        refus: ((m.querySelector('[data-heure-refus]:not([hidden]) .fm-heure-phrase') || {}).textContent || '').trim(),
      };
    });
    ok(d.largeur === 375 && d.defile <= 1 && tables.length === 9 && tables.every((b) => b.h >= 44 && b.l >= 44 && b.droite <= 375) && d.libre.length === 1 && d.libre.every((b) => b.h >= 44 && b.l >= 44 && b.droite <= 375)
      && d.refus === 'Ce déplacement chevauche le Bowling du groupe, de 16:00 à 17:30.',
    '[D1] telephone (375 px) : les tables, la duree et « Libre » tiennent et se touchent, le refus se lit', { ...d, tables });
    ok(!erreurs.length, '[J1] aucune erreur JS (telephone)', erreurs.slice(0, 3));
  } finally { await ctx.close(); }
}

const SERVEUR = ['serveur'];
const MODIFIER = ['modifier'];
const RESERVER = ['reserver'];
const MUTATIONS = [
  { nom: 'billard-sans-reglages', lettre: 'P1', scenarios: MODIFIER, editions: [{ fichier: JS, de: "    else if (!estBowling && !estLaser) options = reglagesAutreEditionHtml(choice.id, programme.othersOptions[choice.id] || {});\n", vers: '' }] },
  { nom: 'tables-plafonnees-a-une', lettre: 'P1', scenarios: MODIFIER, editions: [{ fichier: JS, de: '    reglages.units = Math.min(choix[choix.length - 1] || 1, Math.max(1, Math.trunc(nombre) || 1));', vers: '    reglages.units = 1;' }] },
  { nom: 'parties-a-trois', lettre: 'P1', scenarios: MODIFIER, editions: [{ fichier: JS, de: "${Number(programme.laser_game.games) < RV_PARTIES_MAX ? `<button type=\"button\" class=\"qb-dur-btn dossier-option fm-plus-partie\"", vers: "${false ? `<button type=\"button\" class=\"qb-dur-btn dossier-option fm-plus-partie\"" }] },
  { nom: 'arene-pas-envoyee', lettre: 'P2', scenarios: MODIFIER, editions: [{ fichier: JS, de: "    if (areneVoulue) updated.preference = { ...(updated.preference && typeof updated.preference === 'object' ? updated.preference : {}), arene: areneVoulue };\n", vers: '' }] },
  { nom: 'libre-pas-touchable', lettre: 'L1', scenarios: MODIFIER, editions: [{ fichier: JS, de: '    if (libre && activityId && peutChangerHeureEdition(state.selectedRes, activityId) && pointsHeureEdition(state.selectedRes).has(activityId)) {', vers: '    if (false) {' }] },
  { nom: 'libre-sans-point', lettre: 'L1', scenarios: MODIFIER, editions: [{ fichier: JS, de: "    points.set(etape.activityId, { cle: etape.activityId, activityId: etape.activityId, unite: '', start: null, fin: null, libre: true, nom: etape.nom || nomActiviteHeureEdition(etape.activityId) });", vers: '    return;' }] },
  { nom: 'serveur-libre-sans-heure', lettre: 'L1', scenarios: SERVEUR, editions: [{ fichier: MOVE, serveur: true, de: '  if (autre && !aHeure) old = etapeLibreAHeure(current, old, activity, target);', vers: '' }] },
  { nom: 'heure-posee-sans-chevauchement', lettre: 'L2', scenarios: SERVEUR, editions: [{ fichier: MOVE, serveur: true, de: ' || (autre && jeuAHeure(block))));', vers: '));' }] },
  { nom: 'tables-pas-comptees', lettre: 'L2', scenarios: SERVEUR, editions: [{ fichier: BASE, serveur: true, de: '        if (prises + unitesDe(payload) > dotation) throw refus(`${nom} complet de ${quand}.`);', vers: '' }] },
  { nom: 'libre-refuse-au-serveur', lettre: 'L3', scenarios: SERVEUR, editions: [{ fichier: MOVE, serveur: true, de: '  if (move.libre === true) {\n', vers: "  if (move.libre === 'jamais') {\n" }] },
  { nom: 'libre-juge-comme-une-heure', lettre: 'L3', scenarios: SERVEUR, editions: [{ fichier: BASE, serveur: true, de: '  if (!move || move.unplace === true || move.libre === true) return { ok: true, lanes: payload.lanes };', vers: '  if (!move || move.unplace === true) return { ok: true, lanes: payload.lanes };' }] },
  { nom: 'historique-muet', lettre: 'L3', scenarios: SERVEUR, editions: [{ fichier: HISTO, serveur: true, de: '    if (deplacement.libre === true) return `Au planning : ${autre} sans heure, en accès libre`;\n', vers: '' }] },
  { nom: 'libre-reste-marque', lettre: 'L1', scenarios: MODIFIER, editions: [{ fichier: JS, de: "    boutonLibre.classList.toggle('is-on', libreOn);", vers: "    boutonLibre.classList.toggle('is-on', true);" }, { fichier: JS, de: "    boutonLibre.setAttribute('aria-pressed', libreOn ? 'true' : 'false');", vers: "    boutonLibre.setAttribute('aria-pressed', 'true');" }] },
  { nom: 'libre-pas-envoye', lettre: 'L3', scenarios: MODIFIER, editions: [{ fichier: JS, de: "    if (heure === 'libre' && point.activityId !== 'bowling' && point.activityId !== 'laser_game') {", vers: '    if (false) {' }] },
  { nom: 'posees-ignorees', lettre: 'S1', scenarios: SERVEUR, editions: [{ fichier: FENETRE, serveur: true, de: '  if (heuresPosees.length && dossier.opsPlan && ops.planAvailable !== false) {', vers: '  if (false) {' }] },
  { nom: 'variante-sans-heures', lettre: 'S1', scenarios: SERVEUR, editions: [{ fichier: SIMULATION, serveur: true, de: "const CHAMPS_VARIANTE = ['startTime', 'preference', 'lanes', 'laneCount', 'heuresPosees'];", vers: "const CHAMPS_VARIANTE = ['startTime', 'preference', 'lanes', 'laneCount'];" }] },
  { nom: 'corps-forge-accepte', lettre: 'S1', scenarios: SERVEUR, editions: [{ fichier: POSEES, serveur: true, de: "  if (typeof brut !== 'object' || Array.isArray(brut)) throw erreur('Heures d’activité invalides.');", vers: "  if (typeof brut !== 'object' || Array.isArray(brut)) return [];" }] },
  { nom: 'creation-malgre-refus', lettre: 'R2', scenarios: SERVEUR, editions: [{ fichier: FENETRE, serveur: true, de: '  if (prepare.heureRefusee) throw prepare.heureRefusee;\n', vers: '' }] },
  { nom: 'phrase-du-dossier-ecrit', lettre: 'R2', scenarios: SERVEUR, editions: [{ fichier: POSEES, serveur: true, de: ".replace(/\\s*(Cet horaire reste inchangé|Les autres horaires restent inchangés)\\.\\s*$/, '').trim();", vers: '.trim();' }] },
  { nom: 'piste-prise-ignoree', lettre: 'R3', scenarios: SERVEUR, editions: [{ fichier: POSEES, serveur: true, de: "    return [{ activityId, startTime: heure, lanes: pistes }];", vers: "    return [];" }] },
  { nom: 'ligne-libre-sans-heures', lettre: 'R1', scenarios: RESERVER, editions: [{ fichier: JS, de: '  else if (ligne && rvPosable(id)) rangs.push(...rsRangHeuresPosees(id, ligne));\n', vers: '' }] },
  { nom: 'heure-posee-pas-envoyee', lettre: 'R1', scenarios: RESERVER, editions: [{ fichier: JS, de: '    ...(rvHeuresPoseesEnvoyees() ? { heuresPosees: rvHeuresPoseesEnvoyees() } : {}),\n', vers: '' }] },
  { nom: 'heure-posee-effacee-par-l-ordre', lettre: 'R1', scenarios: RESERVER, editions: [{ fichier: JS, de: '    s.ordreALaMain = true;\n    s.ordreVariante = null;\n  });\n}', vers: '    s.ordreALaMain = true;\n    s.ordreVariante = null;\n    s.heuresPosees = {};\n  });\n}' }] },
  { nom: 'refus-pas-a-l-activite', lettre: 'R2', scenarios: RESERVER, editions: [{ fichier: JS, de: '  const candidate = posee ? posee.activite : nomme ?', vers: '  const candidate = nomme ?' }] },
  { nom: 'formule-sans-heures', lettre: 'R3', scenarios: RESERVER, editions: [{ fichier: JS, de: "  const ids = quickBookState.adaptee ? [] : rvActivites().filter((id) => rsModeHeureAct(id) === 'posee');", vers: '  const ids = [];' }] },
  { nom: 'jetons-poses', lettre: 'S1', scenarios: SERVEUR, editions: [{ fichier: POSEES, serveur: true, de: " || activityId === 'arcade_credit' || /^service_/.test(activityId) || !Number.isFinite(minutes(heure))) throw", vers: " || /^service_/.test(activityId) || !Number.isFinite(minutes(heure))) throw" }] },
  { nom: 'a-volonte-pose', lettre: 'V1', scenarios: SERVEUR, editions: [{ fichier: POSEES, serveur: true, de: '    if (gardeeAVolonte(courant, posee.activityId)) {\n', vers: '    if (false) {\n' }] },
  { nom: 'illimite-posable', lettre: 'V1', scenarios: RESERVER, editions: [{ fichier: JS, de: '  if (rvFormuleIllimitee()) return false;\n', vers: '' }] },
  { nom: 'libre-trop-petit', lettre: 'D1', scenarios: ['telephone'], editions: [{ fichier: CSS, de: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm-heure-libre { min-height: 44px; min-width: 72px;', vers: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm-heure-libre { min-height: 24px; min-width: 24px;' }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'serveur') await scenarioServeur();
    if (nom === 'modifier') await scenarioModifier(browser);
    if (nom === 'reserver') await scenarioReserver(browser);
    if (nom === 'telephone') await scenarioTelephone(browser);
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, (liste(process.env.PC_SCENARIOS) || ['serveur', 'modifier', 'reserver', 'telephone']));
    } else {
      console.log('[K] contre-preuves : chaque garde retiree est montable, puis ce gate ROUGIRAIT sur sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.PC_MUTATIONS || liste(process.env.PC_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : montable (chaque ancre existe une fois et une seule)`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.PC_BAVARD;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `[K] mutation ${m.nom} : ce gate ROUGIRAIT ([${m.lettre}] rougit)`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveurHttp.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nprogramme-complet-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nprogramme-complet-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

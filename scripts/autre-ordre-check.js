// UN AUTRE ORDRE, LA MEME ARRIVEE (2026-11-18).
//
// Marius, manager de Gembloux, message vocal du 18/11 : « Va a la date du samedi 12
// decembre [...] Il y en a un qui est toujours a valider, a 15h30. Eux de base, ils
// veulent venir a 15h15. Mon probleme, c est que j ai une reservation de 26 qui prennent
// 5 pistes, et Nicolas, juste au-dessus, a pris l algo a cette heure-la aussi. Mais comme
// je rajoute une reservation, l algo ne change pas en se disant : finalement, le bowling,
// je vais le remettre en dernier. Ils vont d abord commencer par Minigolf, Arcade. Je veux
// qu il y ait un changement. »
//
// La regle (lib/autre-ordre.js) : la meme arrivee, les memes activites, les memes joueurs,
// l ordre libre ; chaque ordre se joue a blanc par la porte de la fenetre Reserver.
//   [A1] LE CAS DE MARIUS AUJOURD HUI, sur le banc (un samedi) : un groupe de 26 sur cinq
//        pistes a 15:00, Nicolas juste a cote (deux pistes a 15:30), puis un groupe de 10
//        qui veut arriver a 15:15 (bowling, minigolf, arcades, le bowling d abord) : refuse
//        a 15:15 et a 15:30, il part « a valider » (a placer) ; ce qui tient, c est la
//        visite decalee a 16:30 ;
//   [A2] « Proposer un autre ordre » sur ce dossier : il garde 15:15, minigolf puis
//        arcades, le bowling en dernier a 16:30 sur deux pistes, sans attente ;
//   [A3] « Appliquer » : le dossier garde 15:15 ; son plan pose le minigolf a 15:15, les
//        arcades a 16:00, le bowling a 16:30 ; il n est plus a placer ; ses montants ne
//        bougent pas ; la fin dite est 17:30 (rien ne se compte deux fois) ; il reste a
//        valider (valider est un autre geste) ;
//   [A4] redemande apres : « l ordre actuel tient » ;
//   [A5] la note « À placer : créé malgré le conflit… » part dans la meme ecriture (le dossier
//        est place sans conflit) ; la note du dossier reste ;
//   [B1] les droits : sans le droit de modifier, ni proposition ni application (403) ;
//   [B2] une proposition qui a change entre-temps ne s applique pas (409), rien ne s ecrit ;
//   [B3] tout ou rien : une piste prise entre la lecture et le clic, rien ne s ecrit ;
//   [B4] rien ne tient : une phrase honnete qui dit ce qui bloque ;
//   [B5] un PATCH « autre ordre » ne porte rien d autre (422) ;
//   [B6] l arrivee a cinq minutes pres est celle du comptoir : en ligne, 15:15 reste refusee ;
//   [B7] une formule garde l ordre de sa carte ; une seule activite n a pas d autre ordre ;
//   [B8] la privatisation (lib/privatisation.js) : tout le centre privatise de 16:00 a 18:00,
//        aucun ordre ne la traverse et la phrase la nomme ; le dossier du groupe prive n est
//        pas refuse par SA privatisation (« l ordre actuel tient ») ; un corps du comptoir qui
//        se dit « replanifie » ne la leve pas (le numero vient du serveur) ;
//   [C1] le comptoir : refuse a 15:30, la variante d ordre garde 15:30 ; le corps que la
//        fenetre envoie apres « Prendre cet ordre » est accepte tel quel, et la creation
//        garde 15:30 avec le bowling apres ;
//   [C2] la fin que le plan du comptoir dit : 18:00 (minigolf 15:30, bowling 16:30, arcades
//        apres) ; le temps du minigolf pose avant n est pas un trou ou les arcades tiendraient
//        (lib/ops-engine.js mesurerLaVisite) ;
//   [D1] la fenetre du dossier (vraie console) : « Proposer un autre ordre » dans la demande
//        a valider ; la proposition en clair (« 15:15 Minigolf Blacklight, 16:00 Arcades,
//        16:30 Bowling pistes … ») ; « Fermer » ne change rien (aucun PATCH, la base est la
//        meme) ; « Appliquer » ecrit par un seul PATCH autreOrdre, la fiche montre le
//        programme dans le nouvel ordre ;
//   [D2] pas de bouton sur un dossier confirme ; la page refuse aussi une formule (le meme
//        dossier avec un formuleId) ;
//   [D3] rien ne tient (les huit pistes prises l apres-midi) : la carte de la fiche dit
//        « Aucun ordre ne tient en gardant l’arrivée à 15:15. » et ce qui bloque, seul
//        « Fermer » reste ;
//   [D4] apres « Appliquer », aucun texte faux : la note « À placer » et « Hors piste » (vus
//        avant) disparaissent, l en-tete dit les pistes ; « À vérifier » reste, comme en base
//        (le dossier n est pas valide) ;
//   [E1] Reserver (vraie console) : bowling, minigolf, arcades a 15:30, le bowling plein :
//        a cote de « Prendre 16:30 », la carte « Ou gardez 15:30 en changeant l’ordre » ;
//        « Prendre cet ordre » remet les lignes dans cet ordre, le plan tient, « Créer »
//        cree le dossier a 15:30, le minigolf d abord ;
//   [E2] l ordre pose a la main (« Passer avant ») est respecte : aucune carte ;
//   [F1] au telephone (375 px) et a 1280 px : rien ne deborde, la carte se lit en entier (sa
//        phrase va a la ligne au lieu de sortir du cadre), ses boutons se touchent au doigt,
//        elle ne cache ni « Appliquer » ni « Créer » ;
//   [F2] le bandeau de la demande a valider : a 1280 px, « Proposer un autre ordre »,
//        « Appeler », « Valider » sur une ligne ; a 375 px, « Proposer un autre ordre » sur
//        toute la largeur puis « Appeler » et « Valider » cote a cote (« Valider » jamais seul),
//        44 px au doigt ; « Valider » en bleu plein, les deux autres encadres ;
//   [J1] aucune erreur JS.
// Les calculs, les creations et les PATCH partent au VRAI handler api/staff-reservations.js,
// sur la base en memoire de scripts/reserver-banc.js (aucune base reelle, aucun reseau).
// --contre-preuves : chaque garde retiree (en memoire ; le disque n est jamais touche) fait
// rougir sa lettre ; chaque ancre existe une fois et une seule.
//   AO_MUTATIONS : un sous-ensemble ; AO_BAVARD : les lignes des contre-preuves ;
//   AO_CAPTURES=<dossier> : les images ; AO_SCENARIOS : un sous-ensemble.
'use strict';
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout module de lib/.
const B = require('./reserver-banc.js');
// La table des fermetures et privatisations en memoire, apres le banc (scripts/privatisation-banc.js).
const PB = require('./privatisation-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_AUTRE_ORDRE_PORT || 5486);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const MOTEUR = 'lib/autre-ordre.js';
const API = 'api/staff-reservations.js';
const ENGINE = 'lib/ops-engine.js';
const FENETRE = 'lib/reserver-fenetre.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);
const CAPTURES = process.env.AO_CAPTURES || '';
FX.APPAREILS['telephone-375'] = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-BE' };
const JOUR_CONSOLE = FX.lireFixture('pic').staffState.date; // samedi 16 janvier 2027

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
let mutation = null;
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}`)) throw new Mordu(label);
  return cond;
}
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel && !ed.serveur) t = t.replace(ed.de, () => ed.vers);
  return t;
}
const editionsServeur = () => (mutation ? mutation.editions.filter((ed) => ed.serveur) : []);

// ---------------------------------------------------------------------------
// LA JOURNEE DE MARIUS, posee par le vrai POST (le comptoir) : le groupe de 26 sur cinq
// pistes de 15:00 a 16:30, Nicolas (bowling 15:30, laser 16:30), puis le groupe de 10
// qui veut venir a 15:15, le bowling d abord.
// ---------------------------------------------------------------------------
const IDS = ['bowling', 'minigolf_blacklight', 'arcade_time'];
function ligneDe(id, pax, duree = 1) {
  return { activityId: id, pax, participants: pax, ...(id === 'bowling' ? { duration: duree } : {}), ...(id === 'laser_game' ? { games: 1 } : {}) };
}
function corpsVisite({ jour, nom = '', heure, ids, pax, duree = 1, telephone = '0470111222', preference = null }) {
  const ancres = {};
  if (ids[0] === 'bowling' || ids[0] === 'laser_game') ancres[ids[0]] = heure;
  if (ids.includes('laser_game') && ids[0] === 'bowling') ancres.laser_game = `${String(Number(heure.slice(0, 2)) + 1).padStart(2, '0')}${heure.slice(2)}`;
  return {
    centerId: 'libramont', date: jour, name: nom, phone: telephone, email: '', notes: '', occasion: '', startTime: heure,
    duration: duree, totalDuration: 2, lanes: [], pax, status: 'pending', type: 'visite', formuleId: '',
    program: ids.map((id) => ligneDe(id, pax, duree)), laserGames: 0, allowPastStart: false,
    preference: preference || { activityOrder: ids.slice(), preferredTimes: ancres, ...(ancres.laser_game ? { laserGameTimes: [ancres.laser_game], laserPlacement: 'scheduled' } : {}) },
    extras: [], channel: 'staff',
  };
}
async function creer(serveur, corps, attendu = 201) {
  const r = await serveur.appeler('POST', '/api/staff-reservations', corps);
  if (r.statut !== attendu) throw new Error(`montage : ${corps.name} ${r.statut} ${r.json.message || r.json.error || ''}`);
  return r.json.reservation;
}
async function journeeDeMarius(serveur, jour) {
  const groupe = await creer(serveur, corpsVisite({ jour, nom: 'Groupe de 26', heure: '15:00', ids: ['bowling'], pax: 26, duree: 1.5 }));
  const nicolas = await creer(serveur, corpsVisite({ jour, nom: 'Anniversaire Nicolas', heure: '15:30', ids: ['bowling', 'laser_game'], pax: 12 }));
  return { groupe, nicolas };
}
function monterServeur(role = 'manager') {
  B.semer([]);
  PB.vider();
  return B.monter({ mutations: editionsServeur(), session: B.sessionDuRole(role, { nom: 'Marius' }) });
}
// UNE LECTURE DE LA JOURNEE PIEGEE : la n-ieme a partir de maintenant pose d abord une ligne
// (un autre poste prend une piste entre la proposition, relue au clic, et l ecriture).
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const lectureSansPiege = pg.Client.prototype.query;
let piege = null;
pg.Client.prototype.query = async function (sql, params) {
  if (piege && /^select \* from reservations where date = \$1 and center_id = \$2 and status <> 'cancelled'/.test(String(sql).replace(/\s+/g, ' ').trim())) {
    piege.reste -= 1;
    if (piege.reste <= 0) { const poser = piege.poser; piege = null; poser(); }
  }
  return lectureSansPiege.call(this, sql, params);
};

const enBase = (id) => {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : (row.ops_plan || {});
  const items = Array.isArray(row.program) ? row.program : ((row.program && row.program.items) || []);
  return {
    heure: String(row.start_time || '').slice(0, 5),
    pistes: (row.lanes || []).map(Number).join(','),
    prix: Number(row.price),
    base: Number(row.base_price),
    validation: row.validation_status,
    aPlacer: Boolean(plan.aPlacer),
    lignes: items.map((i) => `${i.activityId}${i.avant ? '*' : ''}:${i.price == null ? '-' : i.price}`).sort().join(' '),
    etapes: (plan.timeline || []).filter((t) => t && t.activityId && t.flexible !== true).map((t) => `${t.activityId}@${t.startTime}-${t.endTime}`).join(' '),
    bowling: (plan.resourceBlocks || []).filter((b) => b && b.resourceType === 'bowling_lane').map((b) => `${b.startTime}[${(b.lanes || []).join(',')}]`).join(' '),
    misAJour: row.updated_at ? new Date(row.updated_at).toISOString() : '',
  };
};

// ---------------------------------------------------------------------------
// [A] LE CAS DE MARIUS, puis [B] les regles du serveur.
// ---------------------------------------------------------------------------
async function scenarioMarius() {
  const serveur = monterServeur();
  const jour = B.JOUR;
  await journeeDeMarius(serveur, jour);
  const blanc = (corps) => serveur.appeler('POST', '/api/staff-reservations', { ...corps, dryRun: true });
  // [A1] Aujourd hui : le bowling d abord, 15:15 puis 15:30 : refuse ; 16:30 (decale) : tient.
  const a1515 = (await blanc(corpsVisite({ jour, heure: '15:15', ids: IDS, pax: 10 }))).json.plan || {};
  const a1530 = (await blanc(corpsVisite({ jour, heure: '15:30', ids: IDS, pax: 10 }))).json.plan || {};
  const a1630 = (await blanc(corpsVisite({ jour, heure: '16:30', ids: IDS, pax: 10 }))).json.plan || {};
  ok(a1515.disponible === false && a1530.disponible === false && /Pas assez de pistes libres à 15:30 : il en faut 2/.test(a1530.refus || '') && a1630.disponible === true,
    '[A1] aujourd hui, le bowling d abord : refuse a 15:15 et a 15:30 (« il en faut 2 »), seule la visite decalee a 16:30 tient', { a1515: a1515.refus, a1530: a1530.refus, a1630: a1630.disponible });
  const marius = await creer(serveur, { ...corpsVisite({ jour, nom: 'Famille Lambert', heure: '15:15', ids: IDS, pax: 10 }), notes: 'Gâteau à 16:30', forcer: true });
  const avant = enBase(marius.id);
  const notesDe = (id) => String((B.base.reservations.get(Number(id)) || {}).notes || '');
  const notesAvant = notesDe(marius.id);
  ok(avant && avant.validation === 'staff_review' && avant.aPlacer && avant.heure === '15:15',
    '[A1] cree quand meme, il part « a valider », a placer, a 15:15', avant);

  // [A2] La proposition : 15:15 garde, minigolf, arcades, bowling a 16:30, sans attente.
  const propose = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, autreOrdre: { id: marius.id, centerId: 'libramont' } });
  const a = propose.json.autreOrdre || {};
  const t = a.trouve || {};
  const phrase = (t.etapes || []).map((e) => `${e.debut} ${e.id}${e.pistes ? `[${e.pistes.join(',')}]` : ''}`).join(', ');
  ok(propose.statut === 200 && a.arrivee === '15:15' && t.inchange === false && /^15:15 minigolf_blacklight, 16:00 arcade_time, 16:30 bowling\[\d,\d\]$/.test(phrase) && t.attente === 0 && t.fin === '17:30',
    '[A2] autre ordre : 15:15 minigolf, 16:00 arcades, 16:30 bowling sur deux pistes, sans attente, fin 17:30', { statut: propose.statut, arrivee: a.arrivee, phrase, attente: t.attente, fin: t.fin, raison: a.raison });
  ok(t.plan && t.plan.disponible === true && t.plan.validation === 'confirmed' && t.plan.debut === '15:15' && t.plan.fin === '17:30',
    '[A2] son plan a blanc tient, commence a 15:15 et finit a 17:30', t.plan && { disponible: t.plan.disponible, validation: t.plan.validation, debut: t.plan.debut, fin: t.plan.fin });
  ok(JSON.stringify(enBase(marius.id)) === JSON.stringify(avant), '[A2] proposer n ecrit rien', enBase(marius.id));

  // [B1] Les droits : le bar (sans « modifier ») ne propose ni n applique.
  serveur.changerSession(B.sessionDuRole('staff-bar', { nom: 'Bar' }));
  const refusBlanc = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, autreOrdre: { id: marius.id } });
  const refusPatch = await serveur.appeler('PATCH', '/api/staff-reservations', { id: marius.id, centerId: 'libramont', baseUpdatedAt: a.baseUpdatedAt, autreOrdre: { cle: t.cle } });
  serveur.changerSession(B.sessionDuRole('manager', { nom: 'Marius' }));
  ok(refusBlanc.statut === 403 && refusPatch.statut === 403 && JSON.stringify(enBase(marius.id)) === JSON.stringify(avant),
    '[B1] sans le droit de modifier : ni proposition ni application (403), rien n est ecrit', { blanc: refusBlanc.statut, patch: refusPatch.statut });

  // [B5] Un PATCH « autre ordre » ne porte rien d autre.
  const enTrop = await serveur.appeler('PATCH', '/api/staff-reservations', { id: marius.id, centerId: 'libramont', baseUpdatedAt: a.baseUpdatedAt, autreOrdre: { cle: t.cle }, pax: 12 });
  ok(enTrop.statut === 422 && JSON.stringify(enBase(marius.id)) === JSON.stringify(avant), '[B5] un PATCH autre ordre avec un autre champ : 422, rien n est ecrit', { statut: enTrop.statut, message: enTrop.json.message });

  // [B2] Une cle qui n est pas celle de la proposition : 409, rien n est ecrit.
  const perimee = await serveur.appeler('PATCH', '/api/staff-reservations', { id: marius.id, centerId: 'libramont', baseUpdatedAt: a.baseUpdatedAt, autreOrdre: { cle: `${t.cle}x` } });
  ok(perimee.statut === 409 && /proposition a changé/.test(perimee.json.message || perimee.json.error || '') && JSON.stringify(enBase(marius.id)) === JSON.stringify(avant),
    '[B2] une proposition qui a change entre-temps ne s applique pas (409), rien n est ecrit', { statut: perimee.statut, message: perimee.json.message || perimee.json.error });

  // [A3] Appliquer.
  const applique = await serveur.appeler('PATCH', '/api/staff-reservations', { id: marius.id, centerId: 'libramont', baseUpdatedAt: a.baseUpdatedAt, autreOrdre: { cle: t.cle } });
  const apres = enBase(marius.id);
  ok(applique.statut === 200 && apres.heure === '15:15' && /^minigolf_blacklight@15:15-16:00 arcade_time@16:00-16:30 bowling@16:30-17:30$/.test(apres.etapes) && /^16:30\[\d,\d\]$/.test(apres.bowling) && !apres.aPlacer,
    '[A3] applique : 15:15 garde, minigolf 15:15, arcades 16:00, bowling 16:30 sur deux pistes, plus a placer', { statut: applique.statut, message: applique.json.message, apres });
  ok(apres.prix === avant.prix && apres.base === avant.base && apres.lignes.replace(/\*/g, '') === avant.lignes,
    '[A3] les montants ne bougent pas (prix, reference, chaque ligne)', { avant: [avant.prix, avant.base, avant.lignes], apres: [apres.prix, apres.base, apres.lignes] });
  ok(apres.lignes.includes('minigolf_blacklight*') && apres.lignes.includes('arcade_time*') && apres.validation === 'staff_review',
    '[A3] le minigolf et les arcades sont « avant » ; le dossier reste a valider (valider est un autre geste)', apres);
  const { finDeLaVisite } = require(path.join(ROOT, FENETRE));
  const ecrit = applique.json.reservation || {};
  ok(finDeLaVisite(ecrit.opsPlan, ecrit) === '17:30', '[A3] la fin dite est 17:30 : le minigolf et les arcades ne se comptent pas deux fois', finDeLaVisite(ecrit.opsPlan, ecrit));
  const notesApres = notesDe(marius.id);
  ok(/À placer : créé malgré le conflit\./.test(notesAvant) && !/À placer : créé malgré/.test(notesApres) && /Gâteau à 16:30/.test(notesApres),
    '[A5] la note « À placer : créé malgré le conflit… » part avec le conflit, la note du dossier reste', { avant: notesAvant, apres: notesApres });

  // [A4] Redemande : l ordre actuel tient.
  const encore = ((await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, autreOrdre: { id: marius.id } })).json.autreOrdre || {}).trouve || {};
  ok(encore.inchange === true && encore.cle === t.cle, '[A4] redemande apres : l ordre actuel tient', { inchange: encore.inchange, cle: encore.cle });

  // [B3] Tout ou rien : un deuxieme groupe a placer ; sa proposition relue au clic est la meme,
  // puis un autre poste prend ses pistes juste avant l ecriture (la lecture suivante).
  const second = await creer(serveur, { ...corpsVisite({ jour, nom: 'Second groupe', heure: '15:15', ids: IDS, pax: 10 }), forcer: true });
  const p2 = ((await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, autreOrdre: { id: second.id } })).json.autreOrdre || {});
  const avant2 = enBase(second.id);
  const bowling2 = ((p2.trouve || {}).etapes || []).find((e) => e.id === 'bowling') || { debut: '16:30', pistes: [3, 4] };
  piege = {
    reste: 2,
    poser: () => {
      const voleur = B.ligne(9701, { date: jour, start_time: bowling2.debut, lanes: bowling2.pistes, name: 'Un autre poste', pax: 8, status: 'pending' });
      B.base.reservations.set(9701, { ...voleur, duration: 1, ops_plan: { resourceBlocks: [{ resourceType: 'bowling_lane', activityId: 'bowling', startTime: bowling2.debut, endTime: '23:30', lanes: bowling2.pistes, players: 8 }], timeline: [] } });
    },
  };
  const vole = await serveur.appeler('PATCH', '/api/staff-reservations', { id: second.id, centerId: 'libramont', baseUpdatedAt: p2.baseUpdatedAt, autreOrdre: { cle: (p2.trouve || {}).cle } });
  piege = null;
  ok(Boolean(p2.trouve) && vole.statut === 409 && /ne tient plus tel quel/.test(vole.json.message || vole.json.error || '') && JSON.stringify(enBase(second.id)) === JSON.stringify(avant2) && B.base.reservations.has(9701),
    '[B3] tout ou rien : une piste prise entre la proposition relue et l ecriture : 409, rien n est ecrit', { trouve: Boolean(p2.trouve), statut: vole.statut, message: vole.json.message || vole.json.error, voleur: B.base.reservations.has(9701) });
  // Tout le reste de l apres-midi pris aussi : aucun ordre ne tient plus.
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((piste) => {
    B.base.reservations.set(9710 + piste, { ...B.ligne(9710 + piste, { date: jour, start_time: '14:00', lanes: [piste], name: `Plein ${piste}`, pax: 4, status: 'pending' }), duration: 9, ops_plan: { resourceBlocks: [{ resourceType: 'bowling_lane', activityId: 'bowling', startTime: '14:00', endTime: '23:30', lanes: [piste], players: 4 }], timeline: [] } });
  });
  // [B4] Rien ne tient : une phrase honnete.
  const rien = ((await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, autreOrdre: { id: second.id } })).json.autreOrdre || {});
  ok(!rien.trouve && /^Aucun ordre ne tient en gardant l’arrivée à 15:15\. .*pistes? libres?/.test(rien.raison || ''),
    '[B4] rien ne tient : « Aucun ordre ne tient en gardant l’arrivée à 15:15. » et ce qui bloque', rien.raison);
  return serveur;
}

async function scenarioRegles() {
  const serveur = monterServeur();
  const jour = B.JOUR;
  await journeeDeMarius(serveur, jour);
  // [B6] L arrivee a cinq minutes pres : au comptoir oui, en ligne non (la grille du client).
  const { planReservation } = require(path.join(ROOT, ENGINE));
  const { buildProgramFormula, normalizeProgram } = require(path.join(ROOT, 'lib/visit-program.js'));
  const programme = normalizeProgram([ligneDe('minigolf_blacklight', 10), ligneDe('bowling', 10)], { centerId: 'libramont', pax: 10, dateStr: jour });
  const formule = buildProgramFormula(programme);
  const essai = (channel) => planReservation({ centerId: 'libramont', date: jour, type: 'formule', formula: formule, pax: 10, startTime: '15:15', channel, preference: { arrivalTime: '15:15', preferredTimes: { bowling: '17:00' }, laserGameTimes: [], laserPlacement: 'scheduled' } }, { reservations: [], laneStatuses: {} });
  const comptoir = essai('staff');
  const enLigne = essai('public');
  ok(comptoir.ok === true && enLigne.ok === false && enLigne.refusalCode === 'off_grid',
    '[B6] une arrivee a 15:15 : le comptoir la pose, le client en ligne garde la grille (refus off_grid)', { comptoir: comptoir.ok || comptoir.reason, enLigne: enLigne.refusalCode });
  // [B7] Une formule garde l ordre de sa carte ; une seule activite n a pas d autre ordre.
  const { eligible } = require(path.join(ROOT, MOTEUR));
  const formuleCarte = eligible({ formuleId: 'f2', startTime: '15:00', program: [ligneDe('bowling', 6), ligneDe('laser_game', 6)] });
  const seule = eligible({ startTime: '15:00', program: [ligneDe('bowling', 6)] });
  ok(!formuleCarte.ok && /formule/.test(formuleCarte.raison) && !seule.ok && /Une seule activité/.test(seule.raison),
    '[B7] une formule garde son ordre, une seule activite n a pas d autre ordre', { formuleCarte, seule });

  // [C1] Le comptoir : refuse a 15:30, la variante garde 15:30.
  const corps = corpsVisite({ jour, heure: '15:30', ids: IDS, pax: 10, telephone: '' });
  const r = await serveur.appeler('POST', '/api/staff-reservations', { ...corps, dryRun: true, autreOrdre: true });
  const t = ((r.json.autreOrdre || {}).trouve) || {};
  ok(r.json.plan && r.json.plan.disponible === false && t.etapes && t.etapes[0].debut === '15:30' && t.etapes[0].id !== 'bowling' && t.etapes.find((e) => e.id === 'bowling').debut >= '16:30',
    '[C1] le comptoir, bowling plein a 15:30 : la variante garde 15:30, une activite libre d abord, le bowling apres', { plan: r.json.plan && r.json.plan.refus, etapes: t.etapes });
  const sansDemande = await serveur.appeler('POST', '/api/staff-reservations', { ...corps, dryRun: true });
  ok(!sansDemande.json.autreOrdre, '[C1] sans la demande du comptoir, aucune variante calculee', Object.keys(sansDemande.json));
  // Le corps que la fenetre enverra apres « Prendre cet ordre » : les lignes dans cet ordre,
  // les libres d avant marquees, le bowling a son heure, l arrivee.
  const lignes = t.ordre.map((id) => ({ ...ligneDe(id, 10), ...(t.etapes.find((e) => e.id === id).avant ? { avant: true } : {}) }));
  const ancres = {};
  t.etapes.filter((e) => e.ancre).forEach((e) => { ancres[e.id] = e.debut; });
  const fenetre = { ...corps, phone: '0470111333', name: 'Comptoir Lambert', program: lignes, preference: { activityOrder: t.ordre, preferredTimes: ancres, ...(t.parArrivee ? { arrivalTime: '15:30' } : {}) } };
  const simule = (await serveur.appeler('POST', '/api/staff-reservations', { ...fenetre, dryRun: true })).json.plan || {};
  const cree = await serveur.appeler('POST', '/api/staff-reservations', fenetre);
  const base = cree.json.reservation ? enBase(cree.json.reservation.id) : null;
  ok(simule.disponible === true && cree.statut === 201 && base && base.heure === '15:30' && base.validation === 'confirmed' && base.etapes.startsWith(`${t.ordre[0]}@15:30`),
    '[C1] le corps de « Prendre cet ordre » tient et se cree a 15:30, l activite libre d abord, confirme', { simule: simule.disponible, statut: cree.statut, base });
  // [C2] La fin : le minigolf (15:30-16:15) occupe le temps d avant le bowling ; les arcades
  // se jouent apres lui (17:30-18:00), pas pendant le minigolf.
  const { finDeLaVisite } = require(path.join(ROOT, FENETRE));
  const ecrit = cree.json.reservation || {};
  ok(t.ordre.join('>') === 'minigolf_blacklight>bowling>arcade_time' && simule.fin === '18:00' && finDeLaVisite(ecrit.opsPlan, ecrit) === '18:00',
    '[C2] la fin dite par le comptoir et par le dossier cree : 18:00 (les arcades apres le bowling, pas pendant le minigolf)', { ordre: t.ordre, simule: simule.fin, dossier: finDeLaVisite(ecrit.opsPlan, ecrit) });
  return serveur;
}

// [B8] La privatisation, posee par le vrai geste (api/ops.js, action privatiser).
async function scenarioPrive() {
  const serveur = monterServeur();
  const jour = B.JOUR;
  await journeeDeMarius(serveur, jour);
  const marius = await creer(serveur, { ...corpsVisite({ jour, nom: 'Famille Lambert', heure: '15:15', ids: IDS, pax: 10 }), forcer: true });
  const ops = require(path.join(ROOT, 'api/ops.js'));
  const privatiser = async (champs) => {
    const demande = { centerId: 'libramont', action: 'privatiser', date: jour, ...champs };
    const apercu = await B.appeler(ops, 'POST', '/api/ops', { ...demande, aBlanc: true });
    const pose = await B.appeler(ops, 'POST', '/api/ops', { ...demande, reservationsVues: (apercu.json.reservations || []).map((r) => r.id) });
    await PB.pause(40);
    if (pose.statut !== 200) throw new Error(`montage : privatisation ${pose.statut} ${pose.json.message || ''}`);
  };
  const proposer = async (id) => ((await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, autreOrdre: { id, centerId: 'libramont' } })).json.autreOrdre || {});
  // Tout le centre privatise de 16:00 a 18:00 : aucun ordre ne la traverse.
  await privatiser({ startTime: '16:00', endTime: '18:00', toutLeCentre: true, nom: 'Anniversaire Dupont' });
  const traverse = await proposer(marius.id);
  ok(!traverse.trouve && /^Aucun ordre ne tient en gardant l’arrivée à 15:15\. Privatisé : Anniversaire Dupont, de 16:00 à 18:00\./.test(traverse.raison || ''),
    '[B8] tout le centre privatise de 16:00 a 18:00 : aucun ordre ne la traverse, la phrase la nomme', traverse.raison || traverse.trouve);
  // Le dossier du groupe prive, dans sa privatisation de 19:00 a 22:00.
  PB.vider();
  await PB.pause(40);
  await privatiser({ startTime: '19:00', endTime: '22:00', toutLeCentre: true, nom: 'Mariage Durand' });
  const bloc = Number((PB.privees()[0] || {}).id);
  const durand = await creer(serveur, { ...corpsVisite({ jour, nom: 'Durand', heure: '19:00', ids: ['bowling', 'minigolf_blacklight'], pax: 8 }), privatisation: bloc });
  await PB.pause(40);
  const sienne = await proposer(durand.id);
  ok(Number((PB.privees()[0] || {}).reservation_id) === Number(durand.id) && Boolean(sienne.trouve) && sienne.trouve.inchange === true,
    '[B8] le dossier du groupe prive : sa propre privatisation ne le refuse pas (« l ordre actuel tient »)', sienne.raison || sienne.trouve);
  // Un corps du comptoir qui se dit « replanifie » ne leve pas la privatisation.
  const forge = (await serveur.appeler('POST', '/api/staff-reservations', { ...corpsVisite({ jour, nom: 'Intrus', heure: '19:30', ids: ['bowling', 'minigolf_blacklight'], pax: 4 }), dryRun: true, dossierReplanifie: durand.id, ignoreReservationId: durand.id })).json.plan || {};
  ok(forge.disponible === false && /^Privatisé : Mariage Durand/.test(forge.refus || ''),
    '[B8] un corps qui se dit « replanifie » ne leve pas la privatisation (le numero vient du serveur)', { disponible: forge.disponible, refus: forge.refus });
  return serveur;
}

// ---------------------------------------------------------------------------
// LA VRAIE CONSOLE : la journee de Marius posee dans la base du banc, puis dans la page.
// ---------------------------------------------------------------------------
async function monterConsole(browser, { appareil = 'portable', aValider = true } = {}) {
  const serveur = monterServeur();
  const { groupe, nicolas } = await journeeDeMarius(serveur, JOUR_CONSOLE);
  const marius = aValider ? await creer(serveur, { ...corpsVisite({ jour: JOUR_CONSOLE, nom: 'Famille Lambert', heure: '15:15', ids: IDS, pax: 10 }), forcer: true }) : null;
  const confirme = await creer(serveur, corpsVisite({ jour: JOUR_CONSOLE, nom: 'Les Collègues', heure: '18:00', ids: ['bowling', 'arcade_time'], pax: 6 }));
  const lignes = [groupe, nicolas, confirme, ...(marius ? [marius] : [])];
  const patchs = [];
  const blancs = [];
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'pic', appareil, theme: 'light', port: PORT, heure: '15:10',
    avantChargement: async (p) => {
      await p.exposeFunction('__fixtureServeur', async (corps) => { patchs.push(corps); return serveur.appeler('PATCH', '/api/staff-reservations', corps); });
      await p.exposeFunction('__fixtureBlanc', async (corps) => { blancs.push(corps); return serveur.appeler('POST', '/api/staff-reservations', corps); });
    },
  });
  await page.evaluate((rangs) => {
    const jour = window.__FIXTURE__.jour;
    window.__FIXTURE__.jours[jour] = rangs.map((x) => ({ ...x }));
    state.reservations = rangs.map((x) => ({ ...x }));
    renderStaff();
  }, lignes);
  await page.waitForTimeout(300);
  return { ctx, page, erreurs, patchs, blancs, serveur, marius, confirme, fin: async () => { await ctx.close(); } };
}

async function photo(page, nom, selecteur) {
  if (!CAPTURES || mutation || !nom) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  const m = selecteur ? page.locator(selecteur) : null;
  if (m && await m.count()) await m.first().screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  else await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

// Ce que l ecran montre de la carte de la fiche, et ce qu elle couvre.
function lireFiche() {
  const id = state.selectedRes ? Number(state.selectedRes.id) : 0;
  const bouton = document.getElementById(`ficheAutreOrdre${id}`);
  const carte = document.getElementById(`ficheOrdre${id}`);
  const texte = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const vw = document.documentElement.clientWidth;
  const modal = document.querySelector('#posOverlay .edit-modal');
  const corps = modal ? (modal.querySelector('.edit-modal-body') || modal) : null;
  const boutons = carte ? Array.from(carte.querySelectorAll('[data-ordre-geste]')) : [];
  const r = (n) => (n ? n.getBoundingClientRect() : null);
  return {
    bouton: bouton ? texte(bouton) : '',
    carte: texte(carte),
    phrase: texte(carte && carte.querySelector('[data-ordre-phrase]')),
    gestes: boutons.map((b) => `${b.getAttribute('data-ordre-geste')}:${texte(b)}`),
    tailles: boutons.map((b) => { const x = r(b); return [Math.round(x.width), Math.round(x.height)]; }),
    // Chaque geste de la carte se touche en son centre (rien ne le cache).
    libres: boutons.map((b) => { const x = r(b); const el = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return Boolean(el && (el === b || b.contains(el))); }),
    debordeCarte: carte ? Math.round(r(carte).right - vw) : null,
    // La phrase va a la ligne : rien ne sort de son cadre, meme cache par un parent.
    phraseDeborde: (() => { const p = carte && carte.querySelector('[data-ordre-phrase]'); return p ? p.scrollWidth - p.clientWidth : 0; })(),
    defile: corps ? corps.scrollWidth - corps.clientWidth : -1,
    programme: Array.from(document.querySelectorAll('#posOverlay .fx-programme .gc-step, #posOverlay .fx-programme [data-etape], #posOverlay .fx-programme li')).map((n) => texte(n)).filter(Boolean).slice(0, 8),
    statut: texte(document.querySelector('#posOverlay .dossier-status')),
    toast: texte(document.getElementById('toast')),
    // [D4] ce que l en-tete et la fiche disent du placement.
    tete: texte(document.querySelector('#posOverlay .edit-modal-head')),
    noteAPlacer: /À placer : créé malgré/.test(texte(modal)),
    // [F2] les gestes du bandeau, ligne par ligne (centres a moins de 8 px : la meme ligne).
    bandeau: (() => {
      const g = document.querySelector('#posOverlay .fz-bandeau-gestes');
      if (!g) return null;
      const nom = (b) => (b.classList.contains('fz-autre-ordre') ? 'ordre' : b.classList.contains('fx-appel') ? 'appeler' : b.classList.contains('res-status-btn') ? 'valider' : b.tagName);
      const boutons = Array.from(g.children).filter((b) => b.getBoundingClientRect().width > 0);
      const lignes = [];
      boutons.forEach((b) => {
        const x = b.getBoundingClientRect();
        const centre = x.top + x.height / 2;
        const ligne = lignes.find((l) => Math.abs(l.centre - centre) < 8);
        if (ligne) ligne.noms.push(nom(b)); else lignes.push({ centre, noms: [nom(b)] });
      });
      const parNom = Object.fromEntries(boutons.map((b) => [nom(b), b]));
      const fond = (b) => (b ? getComputedStyle(b).backgroundColor : '');
      const bord = (b) => (b ? parseFloat(getComputedStyle(b).borderTopWidth) || 0 : 0);
      return {
        lignes: lignes.sort((a, b) => a.centre - b.centre).map((l) => l.noms.join('+')).join('|'),
        ordrePlein: Boolean(parNom.ordre) && Math.round(parNom.ordre.getBoundingClientRect().width) >= Math.round(g.getBoundingClientRect().width) - 1,
        hauteurs: boutons.map((b) => Math.round(b.getBoundingClientRect().height)),
        fonds: { ordre: fond(parNom.ordre), appeler: fond(parNom.appeler), valider: fond(parNom.valider) },
        bords: { ordre: bord(parNom.ordre), appeler: bord(parNom.appeler) },
      };
    })(),
  };
}

// « Valider » en bleu plein (opaque, le bleu domine), les deux autres encadres et d un autre fond.
function boutonsALaRegle(b) {
  const rgba = (texte) => (/rgba?\(([^)]+)\)/.exec(texte || '') || [null, ''])[1].split(',').map((x) => Number(x.trim()));
  const [r, v, bl, a = 1] = rgba(b.fonds.valider);
  return a === 1 && bl > r && bl > v && b.fonds.valider !== b.fonds.ordre && b.fonds.valider !== b.fonds.appeler && b.bords.ordre >= 1 && b.bords.appeler >= 1;
}

async function scenarioFiche(browser) {
  for (const appareil of ['portable', 'telephone-375']) {
    const c = await monterConsole(browser, { appareil });
    const { page } = c;
    try {
      await page.evaluate((id) => { closePos(); openPos(id); }, c.marius.id);
      await page.waitForTimeout(250);
      const ouverture = await page.evaluate(lireFiche);
      ok(ouverture.bouton === 'Proposer un autre ordre' && ouverture.carte === '', `[D1] ${appareil} : « Proposer un autre ordre » dans la demande a valider, aucune carte avant le geste`, ouverture);
      // (le temoin de [D4] : avant « Appliquer », la note et « Hors piste » se lisent bien)
      ok(ouverture.noteAPlacer && /Hors piste/.test(ouverture.tete) && /À vérifier/.test(ouverture.tete), `[D4] ${appareil} : avant « Appliquer », la note « À placer » et « Hors piste » sont a l ecran`, { tete: ouverture.tete, note: ouverture.noteAPlacer });
      const telephone = appareil === 'telephone-375';
      const b = ouverture.bandeau || { lignes: '', hauteurs: [] };
      ok((telephone ? b.lignes === 'ordre|appeler+valider' && b.ordrePlein && b.hauteurs.every((h) => h >= 44) : b.lignes === 'ordre+appeler+valider') && boutonsALaRegle(b),
        `[F2] ${appareil} : le bandeau tient ses trois gestes (${telephone ? '« Proposer un autre ordre » sur toute la largeur, puis « Appeler » et « Valider » cote a cote' : 'sur une ligne'}), « Valider » en bleu plein`, b);
      await page.locator(`#ficheAutreOrdre${c.marius.id}`).scrollIntoViewIfNeeded();
      await page.click(`#ficheAutreOrdre${c.marius.id}`);
      await page.waitForFunction((id) => { const k = document.getElementById(`ficheOrdre${id}`); return k && !k.classList.contains('is-calcul'); }, c.marius.id, { timeout: 15000 });
      await page.waitForTimeout(200);
      await page.locator(`#ficheOrdre${c.marius.id}`).scrollIntoViewIfNeeded();
      const propose = await page.evaluate(lireFiche);
      await photo(page, `fiche-proposition-${appareil}`, '#posOverlay .edit-modal');
      ok(/^Autre ordre, même arrivée à 15:15/.test(propose.carte) && /^15:15 Minigolf Blacklight, 16:00 Arcades, 16:30 Bowling pistes \d et \d$/.test(propose.phrase) && propose.gestes.join() === 'fermer:Fermer,appliquer:Appliquer',
      `[D1] ${appareil} : la proposition en clair (« 15:15 Minigolf Blacklight, 16:00 Arcades, 16:30 Bowling pistes … »), « Fermer » et « Appliquer »`, propose);
      const doigt = appareil === 'telephone-375';
      ok(propose.defile <= 1 && propose.debordeCarte <= 0 && propose.phraseDeborde <= 1 && propose.libres.every(Boolean) && propose.tailles.every(([l, h]) => h >= (doigt ? 44 : 32) && l >= (doigt ? 64 : 48)),
        `[F1] ${appareil} : la carte se lit en entier, rien ne deborde, ses boutons se touchent${doigt ? ' au doigt (44 px)' : ''} et rien ne les cache`, propose);
      // « Fermer » ne change rien.
      await page.click(`#ficheOrdre${c.marius.id} [data-ordre-geste="fermer"]`);
      await page.waitForTimeout(250);
      const ferme = await page.evaluate(lireFiche);
      const baseAvant = enBase(c.marius.id);
      ok(ferme.carte === '' && c.patchs.length === 0 && baseAvant.aPlacer && baseAvant.heure === '15:15', `[D1] ${appareil} : « Fermer » ne change rien (aucun PATCH, le dossier reste a placer)`, { ferme: ferme.carte, patchs: c.patchs.length, base: baseAvant });
      // « Appliquer » : un seul PATCH autreOrdre, la base et la fiche suivent.
      await page.click(`#ficheAutreOrdre${c.marius.id}`);
      await page.waitForFunction((id) => { const k = document.getElementById(`ficheOrdre${id}`); return k && k.querySelector('[data-ordre-geste="appliquer"]'); }, c.marius.id, { timeout: 15000 });
      await page.click(`#ficheOrdre${c.marius.id} [data-ordre-geste="appliquer"]`);
      await page.waitForFunction(() => !document.querySelector('[data-ordre-geste="appliquer"]'), null, { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(400);
      const applique = await page.evaluate(lireFiche);
      const base = enBase(c.marius.id);
      const patch = c.patchs[0] || {};
      ok(c.patchs.length === 1 && Object.keys(patch).sort().join() === 'autreOrdre,baseUpdatedAt,centerId,id' && base.heure === '15:15' && /^minigolf_blacklight@15:15-16:00 arcade_time@16:00-16:30 bowling@16:30-17:30$/.test(base.etapes) && !base.aPlacer,
        `[D1] ${appareil} : « Appliquer » : un seul PATCH autreOrdre (rien d autre), le dossier garde 15:15, minigolf, arcades, bowling a 16:30, en base`, { patchs: c.patchs, base });
      ok(applique.carte === '' && /Nouvel ordre enregistré\. La réservation reste à valider\./.test(applique.toast) && applique.bouton === 'Proposer un autre ordre',
        `[D1] ${appareil} : apres, la carte se ferme, le toast dit « Nouvel ordre enregistré. La réservation reste à valider. »`, applique);
      ok(!applique.noteAPlacer && !/Hors piste/.test(applique.tete) && /Pistes \d, \d/.test(applique.tete) && /À vérifier/.test(applique.tete) && base.validation === 'staff_review',
        `[D4] ${appareil} : apres « Appliquer », plus de note « À placer » ni de « Hors piste », l en-tete dit les pistes, « À vérifier » comme en base`, { tete: applique.tete, note: applique.noteAPlacer, validation: base.validation });
      await page.evaluate(() => setTab('details'));
      await page.waitForTimeout(200);
      await photo(page, `fiche-apres-application-${appareil}`, '#posOverlay .edit-modal');
      const programme = await page.evaluate(() => Array.from(document.querySelectorAll('#posOverlay .fx-programme')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).join(' '));
      const iMini = programme.indexOf('Minigolf');
      const iBowl = programme.indexOf('Bowling');
      ok(iMini >= 0 && iBowl > iMini && /15:15/.test(programme) && /16:30/.test(programme), `[D1] ${appareil} : la fiche montre le programme dans le nouvel ordre (minigolf a 15:15 avant le bowling de 16:30)`, programme.slice(0, 400));
      if (appareil === 'portable') {
        // [D2] Pas de bouton sur un dossier confirme.
        await page.evaluate((id) => { closePos(); openPos(id); }, c.confirme.id);
        await page.waitForTimeout(200);
        const confirme = await page.evaluate(lireFiche);
        ok(confirme.bouton === '', '[D2] un dossier confirme n a pas « Proposer un autre ordre »', confirme);
        const formule = await page.evaluate((id) => {
          const r = findStaffReservationById(id);
          return { visite: autreOrdrePossible(r), formule: autreOrdrePossible({ ...r, formuleId: 'f2' }) };
        }, c.marius.id);
        ok(formule.visite === true && formule.formule === false, '[D2] la page refuse aussi une formule : le meme dossier avec un formuleId n a pas le bouton', formule);
        // [D3] Rien ne tient : un autre poste prend les huit pistes tout l apres-midi ; la carte
        // le dit avec ce qui bloque, et ne garde que « Fermer ».
        [1, 2, 3, 4, 5, 6, 7, 8].forEach((piste) => {
          B.base.reservations.set(9810 + piste, { ...B.ligne(9810 + piste, { date: JOUR_CONSOLE, start_time: '14:00', lanes: [piste], name: `Plein ${piste}`, pax: 4, status: 'pending' }), duration: 9, ops_plan: { resourceBlocks: [{ resourceType: 'bowling_lane', activityId: 'bowling', startTime: '14:00', endTime: '23:30', lanes: [piste], players: 4 }], timeline: [] } });
        });
        await page.evaluate((id) => { closePos(); openPos(id); }, c.marius.id);
        await page.waitForTimeout(200);
        await page.click(`#ficheAutreOrdre${c.marius.id}`);
        await page.waitForFunction((id) => { const k = document.getElementById(`ficheOrdre${id}`); return k && !k.classList.contains('is-calcul'); }, c.marius.id, { timeout: 15000 });
        await page.waitForTimeout(200);
        const aucun = await page.evaluate(lireFiche);
        await photo(page, 'fiche-aucun-ordre-portable', '#posOverlay .edit-modal');
        ok(/^Aucun ordre ne tient en gardant l’arrivée à 15:15\. .*pistes? libres?/.test(aucun.carte) && aucun.gestes.join() === 'fermer:Fermer' && c.patchs.length === 1,
          '[D3] rien ne tient : la carte dit « Aucun ordre ne tient en gardant l’arrivée à 15:15. » et ce qui bloque, seul « Fermer » reste, rien ne s ecrit', aucun);
      }
      ok(!c.erreurs.length, `[J1] aucune erreur JS (fiche, ${appareil})`, c.erreurs.slice(0, 3));
    } finally {
      await c.fin();
    }
  }
}

// RESERVER : bowling, minigolf, arcades a 15:30 pour 10 joueurs.
function lireReserver() {
  const s = quickBookState;
  const carte = document.getElementById('rvAutreOrdre');
  const texte = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const plan = typeof rvPlanCourant === 'function' ? rvPlanCourant() : null;
  const creer = document.getElementById('rvCreer');
  const ok = document.getElementById('rvAutreOrdreOk');
  const vw = document.documentElement.clientWidth;
  const r = (n) => (n ? n.getBoundingClientRect() : null);
  const libre = (b) => { if (!b) return false; const x = r(b); if (!x.width) return false; const el = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return Boolean(el && (el === b || b.contains(el))); };
  const modal = document.querySelector('#quickBookOverlay .qb-modal');
  return {
    ordre: s ? rvActivites().join('>') : '',
    aLaMain: Boolean(s && s.ordreALaMain),
    plan: plan ? (plan.disponible ? 'tient' : `refus:${plan.refus || ''}`) : 'calcul',
    carte: texte(carte),
    phrase: texte(carte && carte.querySelector('[data-ordre-phrase]')),
    creer: texte(creer).replace(/Entrée$/, '').trim(),
    creerLibre: libre(creer),
    okLibre: libre(ok),
    taille: ok ? [Math.round(r(ok).width), Math.round(r(ok).height)] : null,
    debordeCarte: carte ? Math.round(r(carte).right - vw) : null,
    phraseDeborde: (() => { const p = carte && carte.querySelector('[data-ordre-phrase]'); return p ? p.scrollWidth - p.clientWidth : 0; })(),
    defile: modal ? modal.scrollWidth - modal.clientWidth : -1,
    heures: s ? Object.entries(rvHeuresDesLignes()).map(([id, l]) => `${id}@${l.heure || '-'}`).join(' ') : '',
  };
}

async function attendrePlan(page) {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => { const s = quickBookState; return s && s.plan && s.plan.etat !== 'calcul' && !rvPlanEnCalcul(); }, null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(250);
}

async function scenarioReserver(browser) {
  for (const appareil of ['portable', 'telephone-375']) {
    const c = await monterConsole(browser, { appareil, aValider: false });
    const { page } = c;
    try {
      await page.evaluate((jour) => {
        openQuickBook({ date: jour, startTime: '15:30', type: 'bowling', pax: 10 });
        rvAppliquerComposition({ type: 'visite', program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'minigolf_blacklight' }, { activityId: 'arcade_time' }] });
      }, JOUR_CONSOLE);
      await attendrePlan(page);
      await page.waitForFunction(() => Boolean(document.getElementById('rvAutreOrdre')), null, { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(250);
      if (appareil === 'telephone-375') {
        // Au telephone, le ticket se deplie pour lire la carte (le geste de l employe).
        await page.evaluate(() => { const b = rsEtat(); if (b && !b.ticket) rsBasculerTicket(); });
        await page.waitForTimeout(300);
      }
      await page.locator('#rvAutreOrdre').scrollIntoViewIfNeeded().catch(() => null);
      const refus = await page.evaluate(lireReserver);
      await photo(page, `reserver-variante-${appareil}`, appareil === 'portable' ? '#quickBookOverlay .qb-modal' : null);
      ok(refus.ordre === IDS.join('>') && /^refus:Pas assez de pistes libres à 15:30/.test(refus.plan) && /^Ou gardez 15:30 en changeant l’ordre/.test(refus.carte)
        && /^15:30 Minigolf Blacklight, (16:15 Arcades, 17:00 Bowling pistes \d et \d|16:30 Bowling pistes \d et \d, 17:30 Arcades)$/.test(refus.phrase) && /^Prendre \d\d:\d\d$/.test(refus.creer),
      `[E1] ${appareil} : bowling plein a 15:30, a cote de « ${refus.creer} », la carte « Ou gardez 15:30 en changeant l’ordre »`, refus);
      const doigt = appareil === 'telephone-375';
      ok(refus.defile <= 1 && refus.debordeCarte <= 0 && refus.phraseDeborde <= 1 && refus.okLibre && refus.creerLibre && refus.taille && refus.taille[1] >= (doigt ? 44 : 32),
        `[F1] ${appareil} : la carte du comptoir se lit en entier, ne deborde pas, « Prendre cet ordre » et « ${refus.creer} » se touchent`, refus);
      await page.click('#rvAutreOrdreOk');
      await attendrePlan(page);
      const pris = await page.evaluate(lireReserver);
      ok(pris.ordre.startsWith('minigolf_blacklight') && pris.plan === 'tient' && pris.carte === '' && /^Créer à 15:30/.test(pris.creer),
        `[E1] ${appareil} : « Prendre cet ordre » : le minigolf d abord, le plan tient, « Créer à 15:30 »`, pris);
      if (appareil === 'portable') {
        await photo(page, 'reserver-ordre-pris-portable', '#quickBookOverlay .qb-modal');
        const avant = new Set(B.base.reservations.keys());
        await page.evaluate(() => { quickBookState.name = 'Comptoir Lambert'; quickBookState.phone = '0470 11 22 33'; });
        await page.evaluate(() => saveQuickBook());
        await page.waitForTimeout(1200);
        const neufs = [...B.base.reservations.keys()].filter((k) => !avant.has(k));
        const base = neufs.length ? enBase(neufs[0]) : null;
        ok(neufs.length === 1 && base.heure === '15:30' && base.validation === 'confirmed' && base.etapes.startsWith('minigolf_blacklight@15:30') && /bowling@1[67]:[03]0/.test(base.etapes),
          '[E1] « Créer » : le dossier a 15:30, le minigolf d abord, le bowling apres, confirme', base);
      }
      ok(!c.erreurs.length, `[J1] aucune erreur JS (Reserver, ${appareil})`, c.erreurs.slice(0, 3));
    } finally {
      await c.fin();
    }
  }
  // [E2] L ordre pose a la main est respecte : minigolf d abord, puis « Passer avant » sur le bowling.
  const c = await monterConsole(browser, { aValider: false });
  const { page } = c;
  try {
    await page.evaluate((jour) => {
      openQuickBook({ date: jour, startTime: '15:30', type: 'bowling', pax: 10 });
      rvAppliquerComposition({ type: 'visite', program: [{ activityId: 'minigolf_blacklight' }, { activityId: 'bowling', duration: 1 }, { activityId: 'arcade_time' }] });
      rsPasserAvant('bowling');
    }, JOUR_CONSOLE);
    await attendrePlan(page);
    await page.waitForTimeout(1500);
    const main = await page.evaluate(lireReserver);
    const demandes = c.blancs.filter((b) => b.autreOrdre === true).length;
    ok(main.aLaMain && main.ordre === IDS.join('>') && /^refus:/.test(main.plan) && main.carte === '' && demandes === 0,
      '[E2] l ordre pose a la main (« Passer avant ») : refuse a 15:30, aucune carte, aucune demande d autre ordre', { main, demandes });
    ok(!c.erreurs.length, '[J1] aucune erreur JS (ordre a la main)', c.erreurs.slice(0, 3));
  } finally {
    await c.fin();
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  // Le moteur (lib/autre-ordre.js).
  { nom: 'seul-l-ordre-demande', lettre: 'A2', scenarios: ['marius'], editions: [
    { fichier: MOTEUR, serveur: true, de: '  if (ids.length <= ACTIVITES_MAX) permutations(ids).forEach(ajouter);\n', vers: '' }] },
  { nom: 'ordre-du-dossier-au-catalogue', lettre: 'A4', scenarios: ['marius'], editions: [
    { fichier: MOTEUR, serveur: true, de: 'const lignes = ordreDuDossier(items.filter((item) => item && item.activityId), plan).map((item) => {', vers: 'const lignes = items.filter((item) => item && item.activityId).map((item) => {' }] },
  { nom: 'formule-reordonnee', lettre: 'B7', scenarios: ['regles'], editions: [
    { fichier: MOTEUR, serveur: true, de: "  if (corps && (corps.formuleId || corps.formulaId)) return { ok: false, ids, raison: 'Une formule garde l’ordre de sa carte.' };\n", vers: '' }] },
  // La fin dite (lib/reserver-fenetre.js, lib/ops-engine.js).
  { nom: 'avant-compte-deux-fois', lettre: 'A3', scenarios: ['marius'], editions: [
    { fichier: FENETRE, serveur: true, de: '.filter((ligne) => ligne && !ligne.planned && !(ligne.avant === true && posees.some((pas) => pas.activityId === ligne.activityId)));', vers: '.filter((ligne) => ligne && !ligne.planned);' }] },
  { nom: 'trou-des-l-accueil', lettre: 'C2', scenarios: ['regles'], editions: [
    { fichier: ENGINE, serveur: true, de: '? Math.max(timeToMinutes(plan.arrivalPlan.arrivalTime.slice(0, 5)) + FORMULA_ARRIVAL_MINUTES, finDesAvant)', vers: '? timeToMinutes(plan.arrivalPlan.arrivalTime.slice(0, 5)) + FORMULA_ARRIVAL_MINUTES' }] },
  { nom: 'arrivee-a-la-grille-au-comptoir', lettre: 'B6', scenarios: ['regles'], editions: [
    { fichier: ENGINE, serveur: true, de: "    ...(input.channel === 'staff' ? { pasArrivee: ARRIVEE_COMPTOIR_MINUTES } : {}),\n", vers: '' }] },
  // Le serveur (api/staff-reservations.js).
  { nom: 'droit-de-voir-suffit', lettre: 'B1', scenarios: ['marius'], editions: [
    { fichier: API, serveur: true, de: "const current = await getReservationById(demande.id);\n  if (!current) throw createHttpError('Reservation introuvable.', 404);\n  const centre = current.centerId || 'libramont';\n  const session = await requireStaffPermission(req, res, 'reservations.edit',", vers: "const current = await getReservationById(demande.id);\n  if (!current) throw createHttpError('Reservation introuvable.', 404);\n  const centre = current.centerId || 'libramont';\n  const session = await requireStaffPermission(req, res, 'reservations.view'," }] },
  { nom: 'champ-en-trop-accepte', lettre: 'B5', scenarios: ['marius'], editions: [
    { fichier: API, serveur: true, de: "        if (enTrop.length) throw createHttpError('Un autre ordre ne modifie aucun autre choix du dossier.', 422);\n", vers: '' }] },
  { nom: 'cle-pas-relue', lettre: 'B2', scenarios: ['marius'], editions: [
    { fichier: API, serveur: true, de: 'if (proposition.trouve.cle !== voulue) throw', vers: 'if (false) throw' }] },
  { nom: 'ecrit-meme-si-l-ordre-ne-tient-plus', lettre: 'B3', scenarios: ['marius'], editions: [
    { fichier: API, serveur: true, de: 'if (autreOrdreApplique && (!shouldReplan || ops.planAvailable === false || !planConformeALaProposition(ops.opsPlan, autreOrdreApplique))) {', vers: 'if (false) {' }] },
  // La privatisation (lib/autre-ordre.js, lib/reserver-fenetre.js).
  { nom: 'ordre-a-travers-une-privatisation', lettre: 'B8', scenarios: ['prive'], editions: [
    { fichier: MOTEUR, serveur: true, de: 'resultat.ops.planAvailable === false || aUnConflitBloquant(resultat.conflits)) {', vers: 'resultat.ops.planAvailable === false) {' }] },
  { nom: 'privatisation-du-groupe-opposee', lettre: 'B8', scenarios: ['prive'], editions: [
    { fichier: FENETRE, serveur: true, de: '  if (replanifie > 0) dossier.dossierReplanifie = () => replanifie;\n', vers: '' }] },
  { nom: 'replanifie-lu-dans-le-corps', lettre: 'B8', scenarios: ['prive'], editions: [
    { fichier: FENETRE, serveur: true, de: 'const replanifie = Number(options.dossierReplanifie) || 0;', vers: 'const replanifie = Number(options.dossierReplanifie || corps.dossierReplanifie) || 0;' }] },
  { nom: 'variante-sans-demande', lettre: 'C1', scenarios: ['regles'], editions: [
    { fichier: API, serveur: true, de: 'if (body.autreOrdre === true && principal.plan && principal.plan.disponible === false) {', vers: 'if (principal.plan && principal.plan.disponible === false) {' }] },
  // La fiche (assets/app-main.js, assets/pinlane-staff.css).
  { nom: 'pas-de-bouton', lettre: 'D1', scenarios: ['fiche'], editions: [
    { fichier: JS, de: "  if (!r || !droits.modifier || r.formuleId || r.status === 'cancelled') return false;", vers: '  return false;' }] },
  { nom: 'bouton-sur-une-formule', lettre: 'D2', scenarios: ['fiche'], editions: [
    { fichier: JS, de: "  if (!r || !droits.modifier || r.formuleId || r.status === 'cancelled') return false;", vers: "  if (!r || !droits.modifier || r.status === 'cancelled') return false;" }] },
  { nom: 'refus-sans-sa-raison', lettre: 'D3', scenarios: ['fiche'], editions: [
    { fichier: JS, de: "escapeHtml(reponse.raison || 'Aucun ordre ne tient.')", vers: "escapeHtml('Aucun ordre ne tient.')" }] },
  { nom: 'note-a-placer-gardee', lettre: 'A5', scenarios: ['marius'], editions: [
    { fichier: API, serveur: true, de: '        if (notesPlacees !== null) body.notes = notesPlacees;\n', vers: '' }] },
  { nom: 'note-a-placer-gardee-a-l-ecran', lettre: 'D4', scenarios: ['fiche'], editions: [
    { fichier: API, serveur: true, de: '        if (notesPlacees !== null) body.notes = notesPlacees;\n', vers: '' }] },
  { nom: 'fiche-pas-repeinte', lettre: 'D4', scenarios: ['fiche'], editions: [
    { fichier: JS, de: 'const peint = applyOptimisticReservation(payload.reservation, { preserveEditState: true }) || {};', vers: 'const peint = {};' }] },
  { nom: 'valider-seul-au-telephone', lettre: 'F2', scenarios: ['fiche'], editions: [
    { fichier: JS, de: "<div class=\"fz-bandeau-gestes${ordre ? ' avec-ordre' : ''}\">", vers: '<div class="fz-bandeau-gestes">' }] },
  { nom: 'ordre-pas-sur-sa-ligne', lettre: 'F2', scenarios: ['fiche'], editions: [
    { fichier: CSS, de: '  body:is(.staff-mode, .admin-mode) .fx-modal .fz-bandeau-gestes.avec-ordre > .fz-autre-ordre { flex-basis: 100%; }\n', vers: '' }] },
  { nom: 'phrase-sur-une-seule-ligne', lettre: 'F1', scenarios: ['fiche'], editions: [
    { fichier: CSS, de: 'body:is(.staff-mode, .admin-mode) .ordre-carte .ordre-phrase { font-weight: 600; }', vers: 'body:is(.staff-mode, .admin-mode) .ordre-carte .ordre-phrase { font-weight: 600; white-space: nowrap; }' }] },
  // Reserver (assets/app-main.js).
  { nom: 'pas-de-carte-au-comptoir', lettre: 'E1', scenarios: ['reserver'], editions: [
    { fichier: JS, de: '  morceaux.push(rvAutreOrdreHtml());\n', vers: '' }] },
  { nom: 'ordre-pris-sans-ses-avant', lettre: 'E1', scenarios: ['reserver'], editions: [
    { fichier: JS, de: '    if (variante) visitProgram.forEach((ligne) => { if (variante.avant.includes(ligne.activityId)) ligne.avant = true; });\n', vers: '' }] },
  { nom: 'ordre-pris-sans-son-arrivee', lettre: 'E1', scenarios: ['reserver'], editions: [
    { fichier: JS, de: '  if (varianteArrivee && varianteArrivee.parArrivee) reservation.preference = { ...(reservation.preference || {}), arrivalTime: s.startTime };\n', vers: '' }] },
  { nom: 'ordre-a-la-main-ignore', lettre: 'E2', scenarios: ['reserver'], editions: [
    { fichier: JS, de: "  if (!s || s.ordreALaMain || s.type !== 'visite' || rvResas.length > 1) return false;", vers: "  if (!s || s.type !== 'visite' || rvResas.length > 1) return false;" }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'marius') await scenarioMarius();
    if (nom === 'regles') await scenarioRegles();
    if (nom === 'prive') await scenarioPrive();
    if (nom === 'fiche') await scenarioFiche(browser);
    if (nom === 'reserver') await scenarioReserver(browser);
  }
}

async function main() {
  const contre = process.argv.includes('--contre-preuves');
  const noms = liste(process.env.AO_SCENARIOS) || ['marius', 'regles', 'prive', 'fiche', 'reserver'];
  const avecNavigateur = contre || noms.some((n) => ['fiche', 'reserver'].includes(n));
  const serveurHttp = avecNavigateur ? await FX.servir({ port: PORT, transformer }) : null;
  const browser = avecNavigateur ? await chromium.launch({ executablePath: BROWSER_PATH, headless: true }) : null;
  const t0 = Date.now();
  try {
    if (!contre) {
      await jouer(browser, noms);
    } else {
      console.log('[K] contre-preuves : chaque garde retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.AO_MUTATIONS || liste(process.env.AO_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.AO_BAVARD;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) {
          // Un plantage rougirait le gate, mais il ne compte pas pour la lettre : seule son
          // assertion le prouve.
          if (!(e instanceof Mordu)) rouges.push(`plantage : ${String(e.message).split('\n')[0]}`);
        }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        ok(vus.some((l) => l.startsWith(`[${m.lettre}`)), `[K] mutation ${m.nom} : [${m.lettre}] ROUGIRAIT (montable)`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    if (browser) await browser.close();
    if (serveurHttp) serveurHttp.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nautre-ordre-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nautre-ordre-check: ALL OK${contre ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

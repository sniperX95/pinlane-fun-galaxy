'use strict';
// LE FONDATEUR NE SIGNE RIEN SUR UNE DEMANDE SUR MESURE, ET LE PARCOURS NE LE TRACE PAS (2026-11-13,
// lib/fondateur-invisible.js). Le volet « demandes » du gate test:fondateur-invisible :
// scripts/fondateur-invisible-check.js le lance.
//
// Ansar : « j ouvre quelque chose ou quoi, ca doit pas afficher que c est ouvert ou lu ou fait par
// fondateur Pinlane, moi personne doit me voir, mais les autres roles du centre oui ».
//
// Le vrai api/ops.js et le vrai api/assistant.js (mode demande), sur la base en memoire et le faux Claude
// de scripts/demande-pinlane-banc.js. La demande 51 porte deja des traces du fondateur (prise en charge,
// note, reponse, preparation de Pinlane), sous son nom actuel « Ansar Pinlane » et sous son nom de
// naissance, a cote de celles de Luc (Manager).
//   [L] la lecture : GET customRequests rend ses traces sans nom a Marie (Direction) et a Luc, entieres a lui
//   [E] l ecriture : prise en charge, note, reponse au client et reservation de la demande (proposition de
//       la v4 et reservation de la v5) signees par personne pour lui et sa session de secours, par Marie
//       pour Marie
//   [P] Pinlane en demande : le modele ne lit ni son nom ni « fondateur » (sa reponse s enregistre au suivi
//       que toute l equipe lit), la preparation n est pas signee, le flux d une session du centre ne porte
//       aucune de ses traces ; hors demande, le fondateur reste reconnu
//   [T] le parcours : ni le fondateur ni sa session de secours ne se tracent, Marie oui
//   Le journal d audit garde chaque acte, a son identifiant de membre.
//
// Contre-preuves (sauf --sans-contre-preuves) : chaque garde retiree en memoire (le disque n est jamais
// ecrit) doit faire rougir sa lettre.
// Zero base, zero reseau sortant, rien ne part.
// Lancement : node scripts/fondateur-invisible-demandes-check.js [--sans-contre-preuves]
const path = require('path');

process.env.PINLANE_DEMANDE_PINLANE_PORT = process.env.PINLANE_FONDATEUR_DEMANDES_PORT || '5471';
const B = require('./demande-pinlane-banc');

const { JOUR, etat, fin } = B;
const NOM_ACTUEL = 'Ansar Pinlane';
const NOM_DE_NAISSANCE = 'Proprietaire plateforme';
const MEMBRE = 'libramont:platform-owner';
const sansLui = (texte) => !String(texte).includes(NOM_ACTUEL) && !String(texte).includes(NOM_DE_NAISSANCE) && !String(texte).includes(':platform-owner');
const LIGNE_DU_FONDATEUR = 'Ce compte est celui du fondateur de Pinlane';

let echecs = 0;
function ok(condition, message, detail = '') {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${message}${!condition && detail ? `  ${String(detail).slice(0, 400)}` : ''}`);
  if (!condition) echecs += 1;
  return Boolean(condition);
}

// Le nom ACTUEL du membre fondateur, comme la base le rend (lib/fondateur-invisible.js, nomsDuFondateur).
const pg = require(require.resolve('pg', { paths: [B.ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s === 'select distinct name from staff_members where id like $1;') return params[0] === '%:platform-owner%' ? { rows: [{ name: NOM_ACTUEL }], rowCount: 1 } : { rows: [], rowCount: 0 };
  return queryDuBanc.call(this, sql, params);
};

// ---------------------------------------------------------------------------
// Les personnes et les demandes.
// ---------------------------------------------------------------------------
function permissionsDu(role) {
  const { STAFF_ROLE_PRESETS } = require(path.join(B.ROOT, 'lib/staff-auth.js'));
  return [...STAFF_ROLE_PRESETS.find((r) => r.id === role).permissions];
}
const personne = (id, nom, role, permissions, locked = false) => ({ centerId: 'libramont', centres: ['libramont', 'gembloux'], member: { id, name: nom }, role: { id: role, name: role === 'direction' ? 'Direction' : role, locked }, permissions });
const MARIE = () => personne('libramont:direction-marie', 'Marie Dupont', 'direction', [], true);
const LUC = () => personne('libramont:manager-luc', 'Luc Martin', 'manager', permissionsDu('manager'));
const FONDATEUR = () => personne(MEMBRE, NOM_ACTUEL, 'direction', ['platform.admin'], true);
const SECOURS = () => personne(`${MEMBRE}-emergency`, NOM_DE_NAISSANCE, 'direction', ['platform.admin'], true);

const formulaire = (sur = {}) => ({ demande: {
  version: 1, groupType: 'entreprise', groupTypeLabel: 'Entreprise', organisation: 'Asbl Les Castors', participants: 24, companions: 0,
  ages: ['adultes'], flexible: false, date: JOUR, alternativeDate: '', period: '', moment: 'apres-midi', momentLabel: 'Après-midi', formulas: [],
  activities: [{ id: 'bowling', name: 'Bowling', participants: 24, duration: 1 }], advice: false, budgetPerPerson: 0, contactRole: '', invoice: false, vatNumber: '', ...sur,
} });
const SUIVI = () => ({
  historique: [
    { type: 'prise-en-charge', le: '2026-11-12T08:30:00.000Z', par: NOM_ACTUEL },
    { type: 'reponse', le: '2026-11-12T09:00:00.000Z', par: NOM_DE_NAISSANCE, objet: 'Votre sortie' },
    { type: 'pinlane', le: '2026-11-12T09:30:00.000Z', par: NOM_ACTUEL, consigne: 'Propose le samedi à 14 h', resultat: 'J’ai préparé le samedi.' },
    { type: 'statut', le: '2026-11-12T10:00:00.000Z', par: 'Luc Martin', statut: 'in_progress' },
  ],
  notes: [
    { type: 'note', le: '2026-11-12T08:40:00.000Z', par: NOM_ACTUEL, texte: 'Client exigeant sur les horaires' },
    { type: 'note', le: '2026-11-12T08:50:00.000Z', par: 'Luc Martin', texte: 'Rappeler mardi' },
  ],
});
const PROPOSITION_V4 = { type: 'libre', date: JOUR, heure: '15:00', fin: '17:00', nom: 'FORMULE 3', joueurs: 10, prix: 280, formule: 'f3', activites: [], extras: [], plus: false, prixLibre: false };
const PROPOSITION_V5 = { type: 'reservation', date: JOUR, startTime: '16:00', pax: 12, formule: { id: 'f1' }, programme: [], supplements: [], prix: null, raisonPrix: '', note: '' };
function semerLeBanc() {
  B.reinitialiser();
  B.semer([]);
  B.semerDemande({ id: 51, contactName: 'Clément Lambert', company: 'Asbl Les Castors', email: 'clement@castors.be', phone: '0470 12 34 56', requestedDate: JOUR, pax: 24, occasion: 'entreprise', status: 'in_progress', message: 'Une sortie d’équipe pour 24 personnes.', payload: { ...formulaire(), suivi: SUIVI() }, createdAt: '2026-11-12T08:00:00.000Z' });
  B.semerDemande({ id: 52, contactName: 'Marc Petit', email: 'marc@petit.be', phone: '0473 44 55 66', requestedDate: JOUR, pax: 10, status: 'in_progress', message: 'Un anniversaire.', payload: { ...formulaire({ organisation: '', participants: 10, formulas: [{ id: 'f3', name: 'FORMULE 3' }], activities: [] }), suivi: { historique: [{ type: 'reponse', le: '2026-11-12T10:00:00.000Z', par: 'Luc Martin', objet: 'Votre anniversaire', proposition: PROPOSITION_V4 }] } }, createdAt: '2026-11-10T09:00:00.000Z' });
  B.semerDemande({ id: 53, contactName: 'Léa Dumont', email: 'lea@dumont.be', phone: '0472 33 44 55', requestedDate: JOUR, pax: 12, status: 'in_progress', message: 'Un anniversaire.', payload: { ...formulaire({ organisation: '', participants: 12, formulas: [{ id: 'f1', name: 'FORMULE 1' }], activities: [] }), suivi: { historique: [{ type: 'reponse', le: '2026-11-12T10:00:00.000Z', par: 'Luc Martin', objet: 'Votre anniversaire', source: 'ia', proposition: PROPOSITION_V5 }] } }, createdAt: '2026-11-11T09:00:00.000Z' });
  etat.conversation = [];
}

function verdicts() {
  const liste = [];
  const v = (cond, label, detail = '') => { let bon = false; let dit = detail; try { bon = Boolean(typeof cond === 'function' ? cond() : cond); } catch (e) { dit = `exception ${e.message}`; } liste.push({ ok: bon, label, detail: typeof dit === 'string' ? dit : JSON.stringify(dit) }); return bon; };
  return { liste, v };
}
const comme = async (session, travail) => { etat.session = session; return travail(); };
const lireDemande = async (session, id) => comme(session, async () => {
  const r = await B.ops('GET', '/api/ops?action=customRequests&centerId=libramont');
  return { statut: r.statut, demande: (r.json.customRequests || []).find((d) => d.id === id) || null };
});
const ops = (session, corps) => comme(session, () => B.ops('POST', '/api/ops', { centerId: 'libramont', ...corps }));
const enBase = (id) => etat.demandes.get(id).payload.suivi || {};
const dernier = (id, type) => (enBase(id).historique || []).filter((e) => e.type === type).slice(-1)[0] || null;
const auditsDu = (membre) => etat.audits.filter((a) => a.actorMemberId === membre);

// ---------------------------------------------------------------------------
// [L] LA LECTURE, [E] L ECRITURE.
// ---------------------------------------------------------------------------
async function groupeSuivi(editions = []) {
  const { liste, v } = verdicts();
  B.monter(editions);
  try {
    semerLeBanc();
    const marie = await lireDemande(MARIE(), 51);
    const brut = JSON.stringify(marie.demande || {});
    v(marie.statut === 200 && marie.demande && sansLui(brut), '[L1] la demande lue par Marie (Direction) ne nomme le fondateur nulle part', brut.slice(0, 300));
    const notes = (marie.demande && marie.demande.suivi && marie.demande.suivi.notes) || [];
    v(notes.length === 2 && notes[0].texte === 'Client exigeant sur les horaires' && notes[0].par === '' && notes[1].par === 'Luc Martin',
      '[L2] sa note reste lisible, sans nom ; celle de Luc garde Luc', notes);
    const histo = (marie.demande && marie.demande.suivi && marie.demande.suivi.historique) || [];
    v(histo.some((e) => e.type === 'prise-en-charge' && e.par === '') && histo.some((e) => e.type === 'reponse' && e.par === '' && e.objet === 'Votre sortie') && histo.some((e) => e.type === 'statut' && e.par === 'Luc Martin'),
      '[L3] sa prise en charge et sa reponse restent dans l historique, sans nom (actuel ou de naissance)', histo);
    const luc = await lireDemande(LUC(), 51);
    v(luc.statut === 200 && luc.demande && sansLui(JSON.stringify(luc.demande)) && JSON.stringify(luc.demande).includes('Luc Martin'), '[L4] Luc (Manager) ne le voit pas non plus', `${luc.statut} ${JSON.stringify(luc.demande || {}).slice(0, 200)}`);
    const lui = await lireDemande(FONDATEUR(), 51);
    v(lui.statut === 200 && lui.demande && JSON.stringify(lui.demande).includes(NOM_ACTUEL) && JSON.stringify(lui.demande).includes(NOM_DE_NAISSANCE), '[L5] le fondateur, lui, voit tout', JSON.stringify(lui.demande || {}).slice(0, 200));

    let r = await ops(FONDATEUR(), { action: 'customRequestStatus', id: 51, status: 'in_progress' });
    const prise = dernier(51, 'prise-en-charge');
    v(r.statut === 200 && prise && prise.par === '' && prise.le !== '2026-11-12T08:30:00.000Z', '[E1] la prise en charge par le fondateur ne le nomme pas', `${r.statut} ${JSON.stringify(prise)}`);
    r = await ops(FONDATEUR(), { action: 'customRequestNote', id: 51, texte: 'Le client veut une facture' });
    let n = (enBase(51).notes || []).find((x) => x.texte === 'Le client veut une facture');
    v(r.statut === 200 && n && n.par === '', '[E2] la note du fondateur sur la demande est signee par personne', `${r.statut} ${JSON.stringify(n)}`);
    r = await ops(SECOURS(), { action: 'customRequestNote', id: 51, texte: 'Note de la session de secours' });
    n = (enBase(51).notes || []).find((x) => x.texte === 'Note de la session de secours');
    v(r.statut === 200 && n && n.par === '', '[E3] sa session de secours ne signe pas non plus', `${r.statut} ${JSON.stringify(n)}`);
    r = await ops(MARIE(), { action: 'customRequestNote', id: 51, texte: 'Je rappelle demain' });
    n = (enBase(51).notes || []).find((x) => x.texte === 'Je rappelle demain');
    v(r.statut === 200 && n && n.par === 'Marie Dupont', '[E4] la note de Marie reste signee Marie', `${r.statut} ${JSON.stringify(n)}`);
    v(r.statut === 200 && sansLui(JSON.stringify(r.json)) && JSON.stringify(r.json).includes('Marie Dupont'), '[E5] la reponse a Marie ne nomme pas le fondateur', JSON.stringify(r.json).slice(0, 300));
    r = await ops(FONDATEUR(), { action: 'sendDirectEmail', to: 'clement@castors.be', subject: 'Votre sortie du samedi', body: 'Bonjour Clément,\n\nMerci pour votre demande, le samedi à 14 h vous attend.\n\nFunement vôtre,\nL’équipe Fun Galaxy Libramont', customRequestId: 51, attemptId: 'essai-51-1' });
    const reponse = dernier(51, 'reponse');
    v(r.statut === 200 && etat.mails.length === 1 && reponse && reponse.objet === 'Votre sortie du samedi' && reponse.par === '', '[E6] la reponse envoyee par le fondateur entre au suivi sans son nom', `${r.statut} ${JSON.stringify(r.json).slice(0, 160)} ${JSON.stringify(reponse)}`);
    r = await ops(FONDATEUR(), { action: 'customRequestBook', id: 52, proposition: PROPOSITION_V4, confirme: true });
    const h52 = enBase(52).historique || [];
    v(r.statut === 200 && etat.demandes.get(52).status === 'handled' && h52.some((e) => e.type === 'statut' && e.statut === 'handled' && e.par === '') && h52.some((e) => e.type === 'reservation' && e.par === ''),
      '[E7] la demande reservee par le fondateur (proposition de la v4) : « traitée » et « réservation créée » sans son nom', `${r.statut} ${JSON.stringify(r.json).slice(0, 160)} ${JSON.stringify(h52.slice(-2))}`);
    r = await ops(FONDATEUR(), { action: 'customRequestBook', id: 53, reservation: PROPOSITION_V5, confirme: true });
    const h53 = enBase(53).historique || [];
    v(r.statut === 200 && etat.demandes.get(53).status === 'handled' && h53.some((e) => e.type === 'statut' && e.statut === 'handled' && e.par === '') && h53.some((e) => e.type === 'reservation' && e.par === ''),
      '[E8] la reservation preparee (v5) reservee par le fondateur : sans son nom', `${r.statut} ${JSON.stringify(r.json).slice(0, 160)} ${JSON.stringify(h53.slice(-2))}`);
    const actes = auditsDu(MEMBRE).map((a) => a.action || a.surface || '?');
    v(auditsDu(MEMBRE).length >= 5 && auditsDu(`${MEMBRE}-emergency`).length >= 1, '[E9] le journal d audit garde ses gestes sur les demandes, a son identifiant', actes);
  } finally {
    B.demonter();
  }
  return liste;
}

// ---------------------------------------------------------------------------
// [P] PINLANE EN DEMANDE, [T] LE PARCOURS.
// ---------------------------------------------------------------------------
const corpsDemande = (consigne) => ({ centerId: 'libramont', demandeId: 51, modele: 'haiku', messages: [{ role: 'user', content: consigne }] });
const ceQueLeModeleLit = (appel) => {
  const corps = (appel && appel.corps) || {};
  const message = (corps.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const systeme = (corps.system || []).map((s) => s.text || '').join('\n');
  return { message, systeme };
};

async function groupePinlane(editions = []) {
  const { liste, v } = verdicts();
  B.monter(editions);
  try {
    semerLeBanc();
    // Le fondateur prepare la demande avec Pinlane.
    etat.session = FONDATEUR();
    etat.script = [fin('J’ai relu la demande : le samedi à 14 h tient pour 24 joueurs.')];
    let avant = etat.appels.length;
    let flux = await B.poser(corpsDemande('Relis la demande et dis-moi si le samedi tient'));
    let lu = ceQueLeModeleLit(etat.appels[avant]);
    v(flux.statut === 200 && flux.un('fin') && etat.appels.length === avant + 1, '[P0] MONTAGE le fondateur fait travailler Pinlane sur la demande', JSON.stringify(flux.evenements.map((e) => e.type)));
    v(lu.message.includes('Client exigeant sur les horaires') && lu.message.includes('Luc Martin') && sansLui(lu.message), '[P1] ce que le modele lit de la demande : les notes et les consignes, sans son nom ; celui de Luc reste', lu.message.slice(0, 400));
    v(!lu.systeme.includes(LIGNE_DU_FONDATEUR) && sansLui(lu.systeme), '[P2] en demande, le modele ne sait ni son nom ni qu il est le fondateur (sa reponse est lue par l equipe)', lu.systeme.slice(0, 300));
    const prep = dernier(51, 'pinlane');
    v(prep && prep.consigne === 'Relis la demande et dis-moi si le samedi tient' && prep.par === '', '[P3] sa consigne et la preparation entrent au suivi sans son nom', JSON.stringify(prep));
    v(JSON.stringify((flux.un('fin') || {}).donnees || {}).includes(NOM_ACTUEL), '[P4] le flux du fondateur, lui, porte la demande entiere', JSON.stringify((flux.un('fin') || {}).donnees || {}).slice(0, 200));
    // Marie fait de meme.
    etat.session = MARIE();
    etat.script = [fin('J’ai relu la demande : le samedi tient.')];
    avant = etat.appels.length;
    flux = await B.poser(corpsDemande('Le samedi tient toujours ?'));
    lu = ceQueLeModeleLit(etat.appels[avant]);
    v(flux.statut === 200 && flux.un('fin') && sansLui(lu.message) && lu.message.includes('Luc Martin') && lu.message.includes('(Marie Dupont)'), '[P5] pour Marie, le modele lit la demande sans le fondateur, et sa consigne a son nom', lu.message.slice(-300));
    const finMarie = JSON.stringify((flux.un('fin') || {}).donnees || {});
    v(flux.un('fin') && sansLui(finMarie) && finMarie.includes('Luc Martin') && finMarie.includes('Marie Dupont'), '[P6] le flux de Marie (la demande enregistree) ne porte aucune trace du fondateur ; Luc et Marie restent', finMarie.slice(0, 300));
    v(dernier(51, 'pinlane') && dernier(51, 'pinlane').par === 'Marie Dupont', '[P7] la preparation de Marie reste signee Marie', JSON.stringify(dernier(51, 'pinlane')));
    // Hors demande, rien ne change : la connexion fait toujours du compte le fondateur.
    etat.session = FONDATEUR();
    etat.script = [fin('Bonjour.')];
    avant = etat.appels.length;
    flux = await B.poser({ centerId: 'libramont', modele: 'haiku', messages: [{ role: 'user', content: 'Bonjour' }] });
    lu = ceQueLeModeleLit(etat.appels[avant]);
    v(flux.statut === 200 && lu.systeme.includes(LIGNE_DU_FONDATEUR) && lu.systeme.includes(NOM_ACTUEL), '[P8] hors demande, le fondateur reste reconnu a sa connexion', `${flux.statut} ${lu.systeme.slice(0, 200)}`);

    // [T] Le parcours de l equipe (POST /api/ops activityLog).
    const evenements = [{ t: Date.now(), k: 'page', v: 'Planning' }];
    const parcours = () => etat.audits.filter((a) => a.action === 'parcours');
    let r = await ops(FONDATEUR(), { action: 'activityLog', events: evenements });
    v(r.statut === 200 && r.json.skipped === true && !parcours().length, '[T1] le parcours du fondateur ne se trace pas', `${r.statut} ${JSON.stringify(r.json)}`);
    r = await ops(SECOURS(), { action: 'activityLog', events: evenements });
    v(r.statut === 200 && r.json.skipped === true && !parcours().length, '[T2] celui de sa session de secours non plus', `${r.statut} ${JSON.stringify(r.json)} ${JSON.stringify(parcours().map((a) => a.actorMemberId))}`);
    r = await ops(MARIE(), { action: 'activityLog', events: evenements });
    v(r.statut === 200 && parcours().length === 1 && parcours()[0].actorMemberId === 'libramont:direction-marie', '[T3] celui de Marie se trace, a son nom', `${r.statut} ${JSON.stringify(parcours().map((a) => a.actorMemberId))}`);
  } finally {
    B.demonter();
  }
  return liste;
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const OPS = 'api/ops.js';
const API = 'api/assistant.js';
const DBC = 'lib/demande-bureau-centre.js';
const GARDES = [
  { nom: 'la prise en charge le nomme', fichier: OPS, de: "    const par = signatureVisible(options.session);\n    try {\n      request = await appendCustomRequestSuivi(", vers: "    const par = String(options.session?.member?.name || '');\n    try {\n      request = await appendCustomRequestSuivi(", groupe: groupeSuivi, lettre: '[E1]' },
  { nom: 'sa note de demande le nomme', fichier: OPS, de: "    const par = signatureVisible(options.session);\n    const avant = await lireDemande(body.id, { centerId: scopedCenterId });", vers: "    const par = String(options.session?.member?.name || '');\n    const avant = await lireDemande(body.id, { centerId: scopedCenterId });", groupe: groupeSuivi, lettre: '[E2]' },
  { nom: 'sa reponse au client le nomme', fichier: OPS, de: '          par: signatureVisible(options.session),\n          objet: body.subject,', vers: "          par: String(options.session?.member?.name || ''),\n          objet: body.subject,", groupe: groupeSuivi, lettre: '[E6]' },
  { nom: 'la reservation de la proposition le nomme', fichier: DBC, de: "  const par = require('./fondateur-invisible').signatureVisible(session);\n  const cree = await deps.creer(prepare, session, { demandeSurMesure: item.id });\n  const reservation = cree.reservation;", vers: "  const par = String((session && session.member && session.member.name) || '');\n  const cree = await deps.creer(prepare, session, { demandeSurMesure: item.id });\n  const reservation = cree.reservation;", groupe: groupeSuivi, lettre: '[E7]' },
  { nom: 'la reservation preparee le nomme', fichier: DBC, de: "  const par = require('./fondateur-invisible').signatureVisible(session);\n  const cree = await deps.creer(prepare, session, { demandeSurMesure: item.id });\n  const creee = cree.reservation;", vers: "  const par = String((session && session.member && session.member.name) || '');\n  const cree = await deps.creer(prepare, session, { demandeSurMesure: item.id });\n  const creee = cree.reservation;", groupe: groupeSuivi, lettre: '[E8]' },
  { nom: 'la reponse a un centre n est plus masquee', fichier: 'lib/http.js', de: "const sansFondateur = res.__nomsDuFondateur ? require('./fondateur-invisible').masquerFondateur(payload, res.__nomsDuFondateur) : payload;", vers: 'const sansFondateur = payload;', groupe: groupeSuivi, lettre: '[L1]' },
  { nom: 'le modele lit la demande avec son nom', fichier: API, de: '      const item = F.masquerFondateur(ouverte.item, noms);', vers: '      const item = ouverte.item;', groupe: groupePinlane, lettre: '[P1]' },
  { nom: 'le modele lit qui donne la consigne', fichier: API, de: "{ qui: F.signatureVisible(session, { avecId: false }) }", vers: "{ qui: (session.member && session.member.name) || '' }", groupe: groupePinlane, lettre: '[P1]' },
  { nom: 'Pinlane sait le fondateur en demande', fichier: API, de: '      const personne = enDemande && F.estFondateur(session)', vers: '      const personne = false', groupe: groupePinlane, lettre: '[P2]' },
  { nom: 'la preparation le signe', fichier: API, de: "  const par = require('../lib/fondateur-invisible').signatureVisible(session);", vers: "  const par = String((session.member && session.member.name) || '');", groupe: groupePinlane, lettre: '[P3]' },
  { nom: 'le flux d un centre porte ses traces', fichier: API, de: '    const nomsAMasquer = F.estFondateur(session) ? null : await F.nomsDuFondateur();', vers: '    const nomsAMasquer = null;', groupe: groupePinlane, lettre: '[P6]' },
  { nom: 'le parcours de secours se trace', fichier: OPS, de: "    if (estFondateur(activitySession) || activityMemberId.includes(':platform-owner')) {", vers: "    if (activityMemberId.endsWith(':platform-owner')) {", groupe: groupePinlane, lettre: '[T2]' },
];

async function contrePreuves() {
  console.log('\n[X] contre-preuves');
  for (const g of GARDES) {
    let rendus = [];
    try { rendus = await g.groupe([{ fichier: g.fichier, de: g.de, vers: g.vers }]); } catch (error) { rendus = [{ ok: false, label: 'exception', detail: error.message }]; }
    // Seule la lettre ROUGE compte : un banc qui s arrete (ancre absente, exception) ne la rend pas.
    const lu = rendus.find((x) => x.label.startsWith(g.lettre));
    ok(Boolean(lu && !lu.ok), `contre-preuve « ${g.nom} » : le gate ROUGIT (${g.lettre} rougit)`, lu ? '' : `lettre absente : ${JSON.stringify(rendus.filter((x) => !x.ok)).slice(0, 300)}`);
  }
}

(async () => {
  await B.demarrer();
  try {
    for (const groupe of [groupeSuivi, groupePinlane]) {
      let liste;
      try { liste = await groupe([]); } catch (error) { liste = [{ ok: false, label: `${groupe.name} s est arrete`, detail: error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error) }]; }
      liste.forEach((x) => ok(x.ok, x.label, x.detail));
    }
    if (etat.pannes.length) ok(false, 'aucune panne serveur', etat.pannes.slice(0, 2).join(' || '));
    if (!process.argv.includes('--sans-contre-preuves')) await contrePreuves();
  } finally {
    B.arreter();
  }
  // Ce que l assistant lance encore en fond se termine avant la sortie : sinon libuv s arrete sur une
  // poignee qui se ferme (Windows, src/win/async.c) et le code de sortie ment.
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (echecs) { console.error(`\nfondateur-invisible-demandes: ${echecs} FAIL`); process.exit(1); }
  console.log('\nfondateur-invisible-demandes: ALL OK - le fondateur ne signe rien sur une demande, Pinlane ne le lit pas, le parcours ne le trace pas.');
  process.exit(0);
})();

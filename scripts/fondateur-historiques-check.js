'use strict';
// UN HISTORIQUE DU CENTRE NE NOMME PAS LE FONDATEUR, LUI COMPRIS (2026-11-18, lib/fondateur-invisible.js).
//
// Ansar, 18/11 : « y a plein d endroits ou on voit que genre "proprietaire plateforme" a fait x ou y modif
// dans les historiques de tout plein de trucs ». Les reponses du centre (sa session comprise) passent par la
// marque de sendJson : scripts/fondateur-invisible-check.js et ses volets le prouvent. Ce gate tient les deux
// endroits ou son nom ne passe PAS par une cle d auteur, donc ou la marque ne le voit pas :
//   [P] une phrase de l assistant (lib/assistant-gestes-reservations.js) : « Supprimée par ... » sur la carte
//       qui restaure une reservation, « modifié par ... » d un bilan qu on regenere ou qu on reecrit. Son nom
//       actuel (lu en base) et son nom de naissance y deviennent « l’équipe » ou « la direction », pour la
//       Direction comme pour lui ; le nom de Seb reste.
//   [O] la console a l instant du geste (assets/app-main.js, le vrai source dans un bac) : la note d equipe
//       et la coche d une activite qu il pose se peignent sans son nom avant meme la reponse du serveur ;
//       celles de Marie portent le sien.
//
// Sans base ni reseau : le nom du fondateur est lu par un double de la base, la console tourne dans un bac.
// Les contre-preuves chargent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/fondateur-historiques-check.js [--contre-preuves]

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|OPENROUTER|ANTHROPIC|OPENAI|BREVO|TELEGRAM)/i.test(nom)) delete process.env[nom];

const LOT = 'lib/assistant-gestes-reservations.js';
const REGLE = 'lib/fondateur-invisible.js';
const APP = 'assets/app-main.js';
const MUTATIONS = {
  'suppression-a-son-nom': { f: LOT, de: '        const supprimeePar = await auteurDansUnePhrase(a.archivedBy);', vers: '        const supprimeePar = a.archivedBy;', lettre: 'P' },
  'bilan-refuse-a-son-nom': { f: LOT, de: "a été modifié par ${(await auteurDansUnePhrase(existant.editedBy)) || 'la direction'} le ", vers: "a été modifié par ${existant.editedBy || 'la direction'} le ", lettre: 'P' },
  'bilan-remplace-a-son-nom': { f: LOT, de: "Il remplace la version modifiée par ${(await auteurDansUnePhrase(b.editedBy)) || 'la direction'} le ", vers: "Il remplace la version modifiée par ${b.editedBy || 'la direction'} le ", lettre: 'P' },
  'phrase-sans-sa-regle': { f: REGLE, de: '  return lu && estTraceDuFondateur(lu, await nomsDuFondateur()) ? \'\' : lu;', vers: '  return lu;', lettre: 'P' },
  'note-peinte-a-son-nom': { f: APP, de: "  const note = { t: texte, par: fondateur ? '' : (state.staffAuthSession?.member?.name || ''), le: new Date().toISOString() };", vers: "  const note = { t: texte, par: state.staffAuthSession?.member?.name || '', le: new Date().toISOString() };", lettre: 'O' },
  'coche-peinte-a-son-nom': { f: APP, de: "by: fondateur ? '' : (state.staffAuthSession?.member?.name || 'Staff') };", vers: "by: state.staffAuthSession?.member?.name || 'Staff' };", lettre: 'O' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
function muter(fichier, texte) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  const t = String(texte).split('\r\n').join('\n');
  if (!m || path.resolve(fichier) !== path.join(ROOT, m.f)) return t;
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  return compiler.call(this, muter(fichier, contenu), fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\nfondateur-historiques-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\nfondateur-historiques-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\nfondateur-historiques-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

const NOM_ACTUEL = 'Ansar Pinlane';
const NOM_DE_NAISSANCE = 'Proprietaire plateforme';
const MEMBRE = 'libramont:platform-owner';
const sansLui = (texte) => !String(texte).includes(NOM_ACTUEL) && !String(texte).includes(NOM_DE_NAISSANCE) && !String(texte).includes(':platform-owner');

// La base : seul le nom actuel du membre fondateur s y lit (lib/fondateur-invisible.js, nomsDuFondateur).
const cheminBase = require.resolve(path.join(ROOT, 'lib/database.js'));
const vraieBase = require(cheminBase);
require.cache[cheminBase] = { id: cheminBase, filename: cheminBase, loaded: true, exports: { ...vraieBase, getPool: () => ({
  query: async (sql, params = []) => (/select distinct name from staff_members where id like \$1/.test(String(sql)) && params[0] === '%:platform-owner%'
    ? { rows: [{ name: NOM_ACTUEL }], rowCount: 1 }
    : { rows: [], rowCount: 0 }),
}) } };

const DIRECTION = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'm-dir', name: 'Seb' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: [] };
const FONDATEUR = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: MEMBRE, name: NOM_ACTUEL }, role: { id: 'platform-owner', name: 'Propriétaire plateforme', locked: true }, permissions: ['platform.admin'] };

async function phrases() {
  section('[P] LES PHRASES DE L ASSISTANT (lib/assistant-gestes-reservations.js)');
  const G = require(path.join(ROOT, 'lib/assistant-gestes.js'));
  const DA = require(path.join(ROOT, 'lib/direction-analytics.js'));
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const supprimee = (id, reservationId, archivedBy) => ({ id, centerId: 'libramont', reservationId, archivedBy, reason: 'doublon', restoredAt: null, reservation: { id: reservationId, name: `Groupe ${reservationId}`, date: demain, startTime: '15:00', pax: 6, status: 'pending' } });
  const mois = DA.periodeDuBilan({ periodType: 'month' });
  const semaine = DA.periodeDuBilan({ periodType: 'week' });
  const bilan = (id, per, editedBy) => ({ id, centerId: 'libramont', ...per, title: `Bilan ${id}`, bodyMd: `# Bilan ${id}\n\nLe texte du bilan ${id}.`, generatedBy: 'deterministic', generatedAt: '2026-11-03T06:00:00.000Z', editedAt: '2026-11-05T10:00:00.000Z', editedBy });
  const banc = {
    registre: [supprimee(61, 150, NOM_ACTUEL), supprimee(62, 152, NOM_DE_NAISSANCE), supprimee(63, 153, `${MEMBRE} ${NOM_ACTUEL}`), supprimee(64, 154, 'Seb')],
    bilans: [bilan(71, mois, NOM_ACTUEL), bilan(72, semaine, 'Seb')],
  };
  const lecteurs = { registreSuppressions: async () => banc.registre, bilansDirection: async () => banc.bilans };
  const carte = (geste, params, mots, session) => G.proposer(geste, params, G.contexte({ centre: 'libramont', session, messagesPersonne: mots, lecteurs })).then((p) => ({ p }), (e) => ({ e }));
  const supprimeePar = (x) => ((x.p && x.p.resume && x.p.resume.lignes) || []).find((l) => l.libelle === 'Supprimée') || {};
  for (const [qui, session] of [['la Direction', DIRECTION], ['le fondateur', FONDATEUR]]) {
    const cartes = await Promise.all([150, 152, 153, 154].map((n) => carte('restaurer_reservation_supprimee', { reservation: n }, ['Restaure la réservation supprimée'], session)));
    const lues = cartes.map((c) => supprimeePar(c).valeur || (c.e && c.e.message) || '');
    ok(cartes.every((c) => c.p) && lues.slice(0, 3).every((v) => /^par l’équipe/.test(v) && sansLui(v)) && /^par Seb/.test(lues[3]),
      `[P] restaurer une reservation, pour ${qui} : « Supprimée par l’équipe » quand c est lui (nom actuel, de naissance, identifiant), « par Seb » pour Seb`, lues);
    const refait = await carte('generer_bilan_direction', { periode: 'mois' }, ['Refais le bilan du mois'], session);
    const refaitSeb = await carte('generer_bilan_direction', { periode: 'semaine' }, ['Refais le bilan de la semaine'], session);
    ok(refait.e && refait.e.statusCode === 409 && /modifié par la direction/.test(refait.e.message) && sansLui(refait.e.message) && refaitSeb.e && /modifié par Seb/.test(refaitSeb.e.message),
      `[P] regenerer un bilan qu il a modifie, pour ${qui} : « modifié par la direction » ; celui de Seb garde Seb`, [refait.e && refait.e.message, refaitSeb.e && refaitSeb.e.message]);
    const reecrit = await carte('modifier_bilan_direction', { periode: 'mois', texte: '# Bilan du mois\n\nUn autre texte.' }, ['Réécris le bilan du mois'], session);
    const reecritSeb = await carte('modifier_bilan_direction', { periode: 'semaine', texte: '# Bilan de la semaine\n\nUn autre texte.' }, ['Réécris le bilan de la semaine'], session);
    ok(reecrit.p && /modifiée par la direction/.test(reecrit.p.resume.alerte || '') && sansLui(reecrit.p.resume.alerte) && reecritSeb.p && /modifiée par Seb/.test(reecritSeb.p.resume.alerte || ''),
      `[P] reecrire un bilan qu il a modifie, pour ${qui} : l alerte dit « la direction » ; celui de Seb garde Seb`, [reecrit.p ? reecrit.p.resume.alerte : reecrit.e && reecrit.e.message, reecritSeb.p ? reecritSeb.p.resume.alerte : reecritSeb.e && reecritSeb.e.message]);
  }
}

// Une fonction du source, accolades comptees (les gabarits ${...} sont equilibres).
function extraire(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  if (debut < 0) throw new Error(`fonction absente : ${nom}`);
  let i = src.indexOf('{', src.indexOf(')', debut));
  let profondeur = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') profondeur += 1;
    else if (src[i] === '}') { profondeur -= 1; if (profondeur === 0) break; }
  }
  return src.slice(debut, i + 1);
}

function console1(fondateur, nom) {
  const src = muter(path.join(ROOT, APP), fs.readFileSync(path.join(ROOT, APP), 'utf8'));
  const tag = (src.match(/const NOTE_EQUIPE_TAG = [^;]+;/) || [])[0];
  if (!tag) throw new Error('constante absente : NOTE_EQUIPE_TAG');
  const peints = [];
  const envois = [];
  const dossier = { id: 5, centerId: 'libramont', activityProgress: {}, notes: 'Mot du client' };
  const bac = {
    state: { reservations: [dossier], staffAuthSession: { member: { id: fondateur ? MEMBRE : 'libramont:direction-marie', name: nom } }, view: 'staff', selectedRes: null },
    canUseStaffPermission: (p) => fondateur && p === 'platform.admin',
    peutGeste: () => true,
    findStaffReservationById: (id) => (Number(id) === 5 ? dossier : null),
    upsertReservationInState() {},
    toast() {},
    markReservationMutation() {},
    clearReservationMutation() {},
    applyOptimisticReservation: (r) => { peints.push(JSON.parse(JSON.stringify(r))); return {}; },
    renderStaffData() {},
    renderPos() {},
    // La fenetre de l instant du geste : la reponse du serveur n arrive jamais.
    enchainerEcritureReservation: () => new Promise(() => {}),
    apiRequest: () => new Promise(() => {}),
    API_ENDPOINTS: { staffReservations: '/api/staff-reservations' },
    getCurrentStaffCenterId: () => 'libramont',
    document: { getElementById: () => ({ value: 'Le groupe arrive a 14:10', focus() {} }) },
    window: { PinlaneStaffNotes: { scope: () => 'reservation', reservationEdit: () => null } },
    notesEquipeBrouillons: new Map(),
    notesEquipeOuvertes: new Set(),
    lireNoteEquipeLigne: () => null,
    envoyerNoteEquipe: (id, corps, avant, apres) => { envois.push(apres); return new Promise(() => {}); },
  };
  vm.createContext(bac);
  vm.runInContext([tag, 'var activitySaveSeq = 0;', 'var activitySaveLatestSeqByReservation = {};', extraire(src, 'toggleFormulaActivity'), extraire(src, 'ajouterNoteEquipe')].join('\n'), bac);
  vm.runInContext('toggleFormulaActivity(5, "bowling"); ajouterNoteEquipe(5);', bac);
  const coche = peints[0] && peints[0].activityProgress && peints[0].activityProgress.bowling;
  const ligne = envois[0] ? String(envois[0].notes).split('\n').find((l) => l.startsWith('[equipe] ')) : '';
  let note = null;
  try { note = JSON.parse(String(ligne).slice('[equipe] '.length)); } catch (e) { note = null; }
  return { coche, note };
}

function consoleAuGeste() {
  section('[O] LA CONSOLE A L INSTANT DU GESTE (assets/app-main.js, le vrai source dans un bac)');
  const lui = console1(true, NOM_ACTUEL);
  ok(lui.coche && lui.coche.done === true && lui.coche.by === '', '[O] sa coche se peint faite, sans son nom, avant la reponse du serveur', lui.coche);
  ok(lui.note && lui.note.t === 'Le groupe arrive a 14:10' && lui.note.par === '', '[O] sa note d equipe se peint sans son nom (« L’équipe »), avant la reponse du serveur', lui.note);
  const marie = console1(false, 'Marie Dumont');
  ok(marie.coche && marie.coche.by === 'Marie Dumont' && marie.note && marie.note.par === 'Marie Dumont', '[O] celles de Marie portent son nom', marie);
}

(async () => {
  try {
    await phrases();
    consoleAuGeste();
  } catch (erreur) {
    rouges += 1;
    console.log(`ROUGE [${lettre}] le banc s est arrete : ${erreur && erreur.stack ? erreur.stack.split('\n').slice(0, 4).join(' | ') : erreur}`);
  }
  console.log(rouges ? `\nfondateur-historiques-check: ${rouges} ROUGE(S)` : '\nfondateur-historiques-check: ALL OK');
  process.exit(rouges ? 1 : 0);
})();

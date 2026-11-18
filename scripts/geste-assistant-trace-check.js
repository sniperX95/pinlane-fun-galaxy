// LA TRACE D UN GESTE DE L ASSISTANT QUI REJOUE UNE ACTION BLOQUANTE (2026-11-18, avant-lancement C2).
//
// Reglages, tarifs, statut du centre ou campagne (lib/audit-log.js, BLOCKING_ACTIONS) refusent de
// s executer sans trace : le dispatcher de api/ops.js ecrit leur ligne AVANT l action, et si le journal
// tombe, rien ne change. Rejouee par l assistant (action assistantGeste), la meme action passait par le
// regime non bloquant, et sa ligne s ecrivait APRES. Journal en panne, la modification passait sans trace.
//
// [A] LE CHEMIN NORMAL, pour reference : une action bloquante ecrit sa ligne, puis change.
// [T] LE GESTE QUI REJOUE UNE ACTION BLOQUANTE : sa ligne s ecrit avant l action, par le regime qui
//     refuse ; journal en panne, l action ne s execute pas (503).
// [U] UNE SEULE LIGNE : le dispatcher n en ajoute pas une seconde apres l action. C est la ligne
//     « assistantGeste », avec le geste et l action du logiciel qu il rejoue.
// [N] UN GESTE NON BLOQUANT ne change pas de regime : l action, puis sa ligne avec le detail du handler.
// [M] LE RELEVE MODIFICATIONS (lib/garde-journal.js, C14, Ansar oui le 18/11) : cette ligne s y dit comme
//     le meme changement fait a la main, meme texte, au nom de qui a valide la carte (sans nom si c est le
//     fondateur), « avec l’assistant » en plus. Une seule ligne par geste : un geste qui passe par une autre
//     adresse (une reservation) laisse parler la ligne de cette adresse, jamais deux alertes.
//
// Sans base ni reseau : le journal, la base et les sauvegardes sont doubles en memoire.
// Les contre-preuves chargent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/geste-assistant-trace-check.js [--contre-preuves]

'use strict';

const path = require('path');
const Module = require('module');
const { Readable } = require('stream');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
['DATABASE_URL', 'POSTGRES_URL', 'TELEGRAM_BOT_TOKEN'].forEach((cle) => { delete process.env[cle]; });

const OPS = 'api/ops.js';
const JOURNAL = 'lib/garde-journal.js';
const MUTATIONS = {
  'trace-apres-l-action': { f: OPS, de: "    if (isBlockingAction(refait.action) && typeof options.tracerAvant === 'function') await options.tracerAvant(traceDuGeste);\n    else noterAudit(options, { changes: traceDuGeste });", vers: '    noterAudit(options, { changes: traceDuGeste });', lettre: 'T' },
  'trace-avant-sans-refus': { f: OPS, de: "        await writeAuditLogOrThrow({ ...auditBase, changes, outcome: 'success' });", vers: "        await writeAuditLog({ ...auditBase, changes, outcome: 'success' });", lettre: 'T' },
  'trace-doublee': { f: OPS, de: '      if (audited && !isBlockingAction(action) && !traceDejaEcrite) {', vers: '      if (audited && !isBlockingAction(action)) {', lettre: 'U' },
  'tout-geste-avant': { f: OPS, de: "    if (isBlockingAction(refait.action) && typeof options.tracerAvant === 'function')", vers: "    if (typeof options.tracerAvant === 'function')", lettre: 'N' },
  // C14 (2026-11-18) : le releve Modifications dit le geste.
  'colonne-du-geste-oubliee': { f: JOURNAL, de: "       coalesce(a.changes->'assistant'->>'action', '') as action_assistant,\n", vers: '', lettre: 'M' },
  'geste-ignore-comme-avant': { f: JOURNAL, de: "    const refaite = r.action === 'assistantGeste' ? String(r.action_assistant || '') : '';", vers: "    const refaite = '';", lettre: 'M' },
  'geste-sans-mention': { f: JOURNAL, de: "    const texte = x.l.avecAssistant ? `${x.texte}, avec l’assistant` : x.texte;", vers: '    const texte = x.texte;', lettre: 'M' },
  'geste-par-adresse-dit-deux-fois': { f: JOURNAL, de: "'sendDesignTest', 'assistantGeste', 'snapshot'", vers: "'sendDesignTest', 'snapshot'", lettre: 'M' },
  'geste-du-fondateur-signe': { f: JOURNAL, de: "const signature = (l) => (require('./fondateur-invisible').estMembreFondateur(l.actor_member_id) ? '' : auteur(l));", vers: 'const signature = (l) => auteur(l);', lettre: 'M' },
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
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 300)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\ngeste-assistant-trace-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\ngeste-assistant-trace-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\ngeste-assistant-trace-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

// ── Les doubles : chaque evenement entre dans UNE liste, dans l ordre ou il arrive ──
const evenements = [];
const lignes = [];
const etat = { panne: false };
function remplacer(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
  return reel;
}
const DIRECTION = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'm-dir', name: 'Seb' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: [] };
remplacer('lib/database.js', { getPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }) });
remplacer('lib/staff-auth.js', {
  getStaffSessionFromRequest: async () => DIRECTION,
  requireStaffPermission: async () => ({ ...DIRECTION }),
});
// Le journal : le regime qui refuse jette quand il est en panne ; l autre perd la ligne sans rien dire,
// comme le vrai (lib/audit-log.js).
remplacer('lib/audit-log.js', {
  writeAuditLog: async (e) => { if (etat.panne) return { ok: false }; evenements.push('ligne apres'); lignes.push(e); return { ok: true }; },
  writeAuditLogOrThrow: async (e) => {
    if (etat.panne) throw Object.assign(new Error("Action refusee : sa trace d'audit n'a pas pu etre enregistree."), { statusCode: 503, expose: true, auditBlocked: true });
    evenements.push('ligne avant');
    lignes.push(e);
    return { ok: true };
  },
});
remplacer('lib/ops-knowledge.js', { refreshCenterOverrides: async () => true });
remplacer('lib/center-config.js', {
  saveGrillesTarif: async (pool, centre, grilles) => { evenements.push('ecriture'); return { grillesTarif: grilles || {}, resources: {} }; },
});
remplacer('lib/availability-blocks.js', {
  upsertAvailabilityBlock: async (pool, x) => { evenements.push('ecriture'); return { id: 99, ...x }; },
  refreshAvailabilityBlocks: async () => {},
});
remplacer('lib/assistant-outils.js', { agitAvecLAssistant: () => true });
const GESTES = {
  grille: { action: 'saveGrillesTarif', corps: { grilles: { laser: { '2 parties': 20 } } } },
  fermeture: { action: 'saveAvailabilityBlock', corps: { scopeType: 'center', recurrence: 'once', date: '2030-05-15', startTime: '18:00', endTime: '24:00', reason: 'Soiree privee' } },
};
remplacer('lib/assistant-gestes.js', {
  contexte: () => ({}),
  refaire: async (geste) => {
    if (!GESTES[geste]) throw Object.assign(new Error('Geste invalide.'), { statusCode: 400, expose: true });
    return JSON.parse(JSON.stringify(GESTES[geste]));
  },
});
const ops = require(path.join(ROOT, OPS));

async function appeler(corps) {
  const req = Readable.from([Buffer.from(JSON.stringify(corps))]);
  req.method = 'POST';
  req.url = '/api/ops';
  req.headers = { host: 'localhost', 'content-type': 'application/json' };
  const res = {
    statusCode: 200, entetes: {}, corps: '', headersSent: false, writableEnded: false,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    getHeader(k) { return this.entetes[k.toLowerCase()]; },
    writeHead(s) { this.statusCode = s; return this; },
    end(b) { this.corps = String(b || ''); this.headersSent = true; this.writableEnded = true; },
  };
  await ops(req, res);
  let json = null;
  try { json = JSON.parse(res.corps); } catch (e) { json = null; }
  return { statut: res.statusCode, json: json || {} };
}
function aZero(panne = false) {
  evenements.length = 0;
  lignes.length = 0;
  etat.panne = panne;
}
const succes = () => lignes.filter((l) => l && l.outcome === 'success');

async function principal() {
  section('[A] LE CHEMIN NORMAL, pour reference (api/ops.js, saveGrillesTarif sans assistant)');
  aZero();
  const normal = await appeler({ action: 'saveGrillesTarif', centerId: 'libramont', grilles: { laser: { '2 parties': 20 } } });
  ok(normal.statut === 200 && JSON.stringify(evenements) === JSON.stringify(['ligne avant', 'ecriture']), 'une action bloquante ecrit sa ligne, puis change', `${normal.statut} ${JSON.stringify(evenements)}`);
  const grilleALaMain = succes()[0];

  section('[T] LE GESTE QUI REJOUE UNE ACTION BLOQUANTE (assistantGeste vers saveGrillesTarif)');
  aZero();
  const geste = await appeler({ action: 'assistantGeste', centerId: 'libramont', geste: 'grille', params: {} });
  ok(geste.statut === 200 && evenements[0] === 'ligne avant' && evenements.indexOf('ecriture') > 0, 'la ligne du geste s ecrit avant l action, par le regime qui refuse', `${geste.statut} ${JSON.stringify(evenements)} ${JSON.stringify(geste.json).slice(0, 120)}`);
  aZero(true);
  const enPanne = await appeler({ action: 'assistantGeste', centerId: 'libramont', geste: 'grille', params: {} });
  ok(enPanne.statut === 503 && !evenements.includes('ecriture'), 'journal en panne, le geste ne change rien (503)', `${enPanne.statut} ${JSON.stringify(evenements)}`);

  section('[U] UNE SEULE LIGNE, CELLE D AVANT (aucune alerte de plus ni en double)');
  aZero();
  await appeler({ action: 'assistantGeste', centerId: 'libramont', geste: 'grille', params: {} });
  const vues = succes();
  ok(vues.length === 1 && vues[0].action === 'assistantGeste' && vues[0].changes && vues[0].changes.assistant && vues[0].changes.assistant.action === 'saveGrillesTarif' && vues[0].changes.assistant.geste === 'grille',
    'une seule ligne de succes, « assistantGeste » avec le geste et l action du logiciel', JSON.stringify(vues.map((l) => [l.action, l.changes])));
  const grilleParLeGeste = vues[0];

  section('[N] UN GESTE NON BLOQUANT (assistantGeste vers saveAvailabilityBlock)');
  aZero();
  const fermeture = await appeler({ action: 'assistantGeste', centerId: 'libramont', geste: 'fermeture', params: {} });
  const apres = succes();
  ok(fermeture.statut === 200 && JSON.stringify(evenements) === JSON.stringify(['ecriture', 'ligne apres']) && apres.length === 1 && apres[0].changes.assistant.action === 'saveAvailabilityBlock',
    'l action d abord, puis une seule ligne avec le geste, comme avant', `${fermeture.statut} ${JSON.stringify(evenements)} ${JSON.stringify(apres.map((l) => l.changes))}`);
  const fermetureParLeGeste = apres[0];
  aZero();
  await appeler({ action: 'saveAvailabilityBlock', centerId: 'libramont', ...GESTES.fermeture.corps });
  const fermetureALaMain = succes()[0];

  section('[M] LE RELEVE MODIFICATIONS DIT LE GESTE COMME LE MEME CHANGEMENT FAIT A LA MAIN (lib/garde-journal.js, C14)');
  // Les lignes ecrites plus haut par le vrai dispatcher, rendues par une base qui lit les colonnes DANS le
  // SQL de la garde (lireLignes) : une colonne absente du SELECT n arrive pas.
  const J = require('../lib/garde-journal');
  const CHAMPS = ['date', 'startTime', 'pax', 'price', 'status', 'amountPaid', 'discountReason', 'absentAt'];
  const releve = async (entrees) => {
    const pool = { query: async (sql) => {
      const s = String(sql);
      const rows = entrees.map((e, i) => {
        const changes = e.changes && typeof e.changes === 'object' ? e.changes : {};
        return {
          id: i + 1, center_id: e.centerId || 'libramont', occurred_at: new Date(Date.UTC(2026, 10, 18, 13, 12, i)).toISOString(),
          actor_kind: e.actorKind || 'staff', actor_label: e.actorLabel || '', actor_member_id: e.actorMemberId || '',
          action: e.action, entity_type: e.entityType || '', entity_id: e.entityId || '', annonce: '', retard: null, dossiers: null,
          champs: Object.fromEntries(CHAMPS.filter((k) => changes[k] !== undefined).map((k) => [k, changes[k]])),
          cles: Object.keys(changes), dossier: {},
          ...(/coalesce\(a\.changes->'assistant'->>'action', ''\) as action_assistant/.test(s) ? { action_assistant: String((changes.assistant && changes.assistant.action) || '') } : {}),
        };
      });
      return { rows, rowCount: rows.length };
    } };
    return J.messageModifications(await J.lireLignes(pool, { apresId: 0 })) || '';
  };
  const lignesDe = (texte) => String(texte).split('\n').filter((l) => /^\d{2}:\d{2}/.test(l));
  const aLaMain = await releve([grilleALaMain]);
  const parLeGeste = await releve([grilleParLeGeste]);
  ok(/^\d{2}:\d{2} Seb : grilles de prix enregistrées$/.test(lignesDe(aLaMain)[0] || ''), 'a la main : « Seb : grilles de prix enregistrées », pour reference', aLaMain);
  ok(lignesDe(parLeGeste).length === 1 && lignesDe(parLeGeste)[0].replace(/^\d{2}:\d{2} /, '') === `${lignesDe(aLaMain)[0].replace(/^\d{2}:\d{2} /, '')}, avec l’assistant`,
    'le tarif change par l assistant : la meme ligne, au nom de qui a valide la carte, « avec l’assistant » en plus', parLeGeste);
  const fermetures = await releve([fermetureParLeGeste]);
  const fermetureMain = await releve([fermetureALaMain]);
  ok(lignesDe(fermetures).length === 1 && lignesDe(fermetureMain).length === 1 && lignesDe(fermetures)[0].replace(/^\d{2}:\d{2} /, '') === `${lignesDe(fermetureMain)[0].replace(/^\d{2}:\d{2} /, '')}, avec l’assistant`,
    'un geste non bloquant (une fermeture) aussi : le texte de la main, une fois', [fermetures, fermetureMain]);
  const parLui = await releve([{ ...grilleParLeGeste, actorMemberId: 'libramont:platform-owner', actorLabel: 'Ansar Pinlane' }]);
  ok(/^\d{2}:\d{2} : grilles de prix enregistrées, avec l’assistant$/.test(lignesDe(parLui)[0] || '') && !/Ansar|Proprietaire|platform-owner/.test(parLui),
    'valide par le fondateur : la ligne part sans son nom', parLui);
  // Un geste vers une autre adresse : la ligne de l adresse (sa reservation) parle, celle du geste se tait.
  const parAdresse = await releve([
    { centerId: 'libramont', actorKind: 'staff', actorMemberId: 'm-dir', actorLabel: 'Seb', action: 'assistantGeste', entityType: 'ops_action', changes: { assistant: { geste: 'joueurs', adresse: 'staff-reservations', methode: 'PATCH' } } },
    { centerId: 'libramont', actorKind: 'staff', actorMemberId: 'm-dir', actorLabel: 'Seb', action: 'updateReservation', entityType: 'reservation', entityId: '150', changes: { pax: { before: 4, after: 6 } } },
  ]);
  ok(lignesDe(parAdresse).length === 1 && /Seb : réservation n° 150 passe de 4 à 6 personnes$/.test(lignesDe(parAdresse)[0]) && !/autre action/.test(parAdresse),
    'un geste vers une reservation : une seule ligne, celle de la reservation, jamais deux alertes', parAdresse);
  ok(J.classer({ action: 'assistantGeste', champs: {}, cles: [] }).rien === true, 'la ligne brute « assistantGeste » ne se dit jamais seule : seule son action se lit', J.classer({ action: 'assistantGeste', champs: {}, cles: [] }));

  console.log(rouges ? `\ngeste-assistant-trace-check: ${rouges} ROUGE(S)` : '\ngeste-assistant-trace-check: ALL OK');
  process.exit(rouges ? 1 : 0);
}

principal().catch((erreur) => {
  console.error(`geste-assistant-trace-check: Error ${erreur && erreur.stack}`);
  process.exit(1);
});

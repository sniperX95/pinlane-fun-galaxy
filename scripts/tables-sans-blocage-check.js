#!/usr/bin/env node
// LES TABLES ANNIVERSAIRE NE BLOQUENT JAMAIS (Movsar, 2026-10-14 : « les tables
// pour les anniversaire et tout on s en fou bloque pas des resa pour ca »).
//
// Le moteur ne refuse plus rien pour les tables : ni une heure, ni un blocage
// d horaires, ni le comptoir, ni une strategie de retard. Le bloc party_table
// reste pose. La limite de tables (Etablissement, eteinte par defaut) ne fait
// que compter : au-dela de hardCapacity, le plan porte `tableLimit`, hors de
// conflicts[], et UN mail previent la boite de secours du centre.
//
//   [A] le moteur : la neuvieme fete (F6, F7, F8) se planifie a l heure
//       demandee, son bloc table pose, sans conflit, au meme risque et a la
//       meme qualite qu un jour vide ; eteinte, aucun signal ; allumee, le
//       signal a la neuvieme, pas a la huitieme ; la limite est hardCapacity ;
//       partyTables null ; une formule a ancres qui porte une table ;
//   [B] un retard qui empile les tables reste faisable et ne pousse personne ;
//   [C] l API publique sert les memes heures de F6, F7 et F8 avec 8 tables
//       prises, le blocage d horaires repond 201 (handler en process), et le
//       public ne recoit jamais le compte des tables ;
//   [D] la fenetre Reserver du comptoir : aucun conflit, rien « à placer » ;
//   [E] le mail : allumee et depassee, exactement un mail par adresse de la
//       boite de secours du centre, par le formulaire public, le comptoir, un
//       deplacement et un retard ; idempotent ; eteinte, rien ; sans
//       depassement, rien ; sans adresse, rien ; jamais une adresse globale ni
//       celle d un autre centre ; une alerte remise en file se recontrole ;
//   [F] Etablissement (Edge) : eteinte par defaut, un enregistrement sans
//       retouche garde l option et les nombres, l allumer persiste a travers la
//       normalisation, la phrase dit que rien ne se bloque et, sans adresse,
//       qu aucun mail ne partira ;
//   [G] la console fondateur, qui change un nombre, ne l eteint pas ;
//   [H] les donnees : la cle a la normalisation, la fusion, le provisioning ;
//   [I] LA FIN EST LA DERNIERE ACTIVITE POSEE (Movsar, 2026-10-15), livre
//       avec ce lot : chaque heure servie de F1 a F5, la visite bowling 14:00
//       puis laser 15:00 et deux Formule 4 finissent a la fin de leur derniere
//       activite, recalculee sur le plan servi sans le moteur, par heure
//       d arrivee aussi (la frise bout a bout) ; la carte
//       « Environ ... sur place » dit cette duree ; le dernier depart du soir
//       est la derniere demi-heure dont les activites tiennent avant la
//       fermeture.
//
// Zero reseau, zero base : 'pg' est remplace par une base en memoire qui
// interprete le SQL reel des communications et des centres, fetch (Resend) par
// un double qui compte les envois. Les vrais handlers (api/public-*,
// api/staff-reservations, api/ops) et le vrai moteur tournent ; la session
// staff, le journal d audit et l ecriture des reservations sont remplaces.
//
// Contre-epreuve : node scripts/tables-sans-blocage-check.js --mutate (une
// mutation par regle, servie en memoire, aucun fichier touche).
// Differentiel : node scripts/tables-sans-blocage-check.js --base <commit>, le
// commit qui precede les tables (sans depassement, plans, heures servies,
// comptoir et retards identiques a l octet a ceux de ce commit ; les cas avec
// depassement sont comptes a part, refuses avant, acceptes maintenant).
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CRLF = '\r\n';
const LF = '\n';
const argApres = (nom) => { const i = process.argv.indexOf(nom); return i >= 0 ? String(process.argv[i + 1] || '') : ''; };

process.env.TZ = 'Europe/Brussels';
process.env.PINLANE_CALENDAR_SYNC = 'off';
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/tables-sans-blocage';
process.env.DATABASE_SSL = 'disable';
delete process.env.POSTGRES_URL;
process.env.RESEND_API_KEY = 'cle-synthetique-du-gate';
for (const nom of ['RESEND_FROM', 'RESEND_REPLY_TO', 'CENTER_REPLY_TO', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'CONFIRMATION_DELAY_MINUTES', 'REQUEST_RECEIVED_DELAY_MINUTES']) delete process.env[nom];
// Les adresses GLOBALES de la plateforme : elles valent pour tous les centres,
// le mail des tables ne doit jamais y partir.
const ADRESSE_GLOBALE = 'secours-global@plateforme-gate.be';
const ADRESSE_STAFF_GLOBALE = 'staff-global@plateforme-gate.be';
process.env.PINLANE_SECOURS_EMAILS = ADRESSE_GLOBALE;
process.env.STAFF_REVIEW_EMAIL = ADRESSE_STAFF_GLOBALE;
process.env.RESERVATION_STAFF_EMAIL = ADRESSE_STAFF_GLOBALE;
process.env.STAFF_AUTH_SECRET = 'secret-synthetique-du-gate-des-tables';

// ---------------------------------------------------------------------------
// LES CONTRE-EPREUVES : chacune remet une regle d avant, ou en casse une ; le
// gate doit rougir (code 1).
// ---------------------------------------------------------------------------
const MUTATIONS = [
  {
    nom: 'le refus des tables revient dans le moteur',
    fichier: 'lib/ops-engine.js',
    editions: [{
      de: [
        "    if (block.resourceType === 'party_table' && !tableLimit) {",
        '      tableLimit = depassementDeTables(center, existingBlocks, block);',
        '    }',
      ].join(LF),
      vers: [
        "    if (block.resourceType === 'party_table') {",
        "      const dejaLa = existingBlocks.filter((existing) => existing.resourceType === 'party_table' && overlap(block.start, block.end, existing.start, existing.end));",
        '      if (dejaLa.length + 1 > ((center.resources.partyTables && center.resources.partyTables.hardCapacity) || 8)) {',
        "        conflicts.push({ type: 'table_conflict', severity: 'blocking', message: 'Trop de tables anniversaire occupees.' });",
        '      }',
        '    }',
      ].join(LF),
    }],
  },
  {
    nom: 'la limite eteinte compte quand meme',
    fichier: 'lib/ops-engine.js',
    editions: [{ de: '  return Boolean(tables && tables.limitEnabled === true);', vers: '  return Boolean(tables);' }],
  },
  {
    nom: 'le mail part limite eteinte',
    fichier: 'lib/limite-tables.js',
    editions: [{
      de: "    return require('./ops-knowledge').getCenter(centerId || 'libramont');",
      vers: "    const c = require('./ops-knowledge').getCenter(centerId || 'libramont'); return c && c.resources && c.resources.partyTables ? { ...c, resources: { ...c.resources, partyTables: { ...c.resources.partyTables, limitEnabled: true } } } : c;",
    }],
  },
  {
    nom: 'la cle d idempotence change a chaque appel',
    fichier: 'lib/ops-communications.js',
    editions: [{
      de: '    idempotencyKey: `tables:${centerId}:${Number(reservation.id)}:${plage}:${recipient}`,',
      vers: '    idempotencyKey: `tables:${centerId}:${Number(reservation.id)}:${plage}:${recipient}:${Math.random()}`,',
    }],
  },
  {
    nom: 'une plage deja tenue previent encore (un changement de statut)',
    fichier: 'lib/limite-tables.js',
    editions: [{ de: '    const nouvelles = plagesDeTables(reservation, center).filter((plage) => !deja.has(plage));', vers: '    const nouvelles = plagesDeTables(reservation, center);' }],
  },
  {
    nom: 'le mail part aussi a l adresse globale de la plateforme',
    fichier: 'lib/limite-tables.js',
    editions: [{
      de: '  const brutes = center && center.secours && Array.isArray(center.secours.emails) ? center.secours.emails : [];',
      vers: "  const brutes = [...(center && center.secours && Array.isArray(center.secours.emails) ? center.secours.emails : []), ...String(process.env.PINLANE_SECOURS_EMAILS || '').split(',')];",
    }],
  },
  {
    nom: 'la cle limitEnabled se perd a la normalisation',
    fichier: 'lib/center-config.js',
    editions: [{ de: '    limitEnabled: asBoolean(input.limitEnabled, false),\n', vers: '' }],
  },
  {
    nom: 'le depassement retourne dans conflicts[]',
    fichier: 'lib/ops-engine.js',
    editions: [{
      de: '      tableLimit = depassementDeTables(center, existingBlocks, block);',
      vers: "      tableLimit = depassementDeTables(center, existingBlocks, block);\n      if (tableLimit) conflicts.push({ type: 'table_limit', severity: 'warning', message: 'Limite de tables depassee.' });",
    }],
  },
  {
    nom: 'le mail part a la boite d un autre centre',
    fichier: 'lib/limite-tables.js',
    editions: [{ de: '    const destinataires = adressesDuCentre(center);', vers: "    const destinataires = adressesDuCentre(centreOuNull('libramont'));" }],
  },
  {
    nom: 'un retard qui empile les tables se heurte de nouveau',
    fichier: 'lib/ops-engine.js',
    editions: [{
      de: [
        '        // Les tables anniversaire ne se heurtent jamais (evaluateConflicts) :',
        '        // un retard qui les empile reste faisable.',
      ].join(LF),
      vers: [
        "        if (moved.resourceType === 'party_table' && existing.resourceType === 'party_table') {",
        "          const toutes = [...movedEntries, ...otherEntries].flatMap((entry) => entry.blocks).filter((block) => block.resourceType === 'party_table' && overlap(moved.start, moved.end, block.start, block.end));",
        "          if (toutes.length > ((center.resources.partyTables && center.resources.partyTables.hardCapacity) || 8)) record(targetEntry, moved.end - existing.start, existing.start, 'table', 'Capacite tables anniversaire depassee.');",
        '        }',
      ].join(LF),
    }],
  },
  {
    nom: 'la creation ne previent plus le centre',
    fichier: 'lib/reservation-ops.js',
    editions: [{ de: '    alerterLimiteDeTables(reservation).then((r) => { if (r && r.erreur) warnings.push(`tables:${r.erreur}`); }),\n', vers: '' }],
  },
  {
    nom: 'un deplacement au comptoir ne previent plus le centre',
    fichier: 'api/staff-reservations.js',
    editions: [{ de: '    alerterLimiteDeTables(reservation, { avant: current }),\n', vers: '' }],
  },
  {
    nom: 'un retard applique ne previent plus le centre',
    fichier: 'api/ops.js',
    editions: [{ de: '      await alerterTablesApresDeplacement(avantParId, updatedReservations);\n', vers: '' }],
  },
  {
    nom: 'une alerte remise en file part sans se recontroler',
    fichier: 'lib/ops-communications.js',
    editions: [{ de: "  if (communication.templateId === 'staff_tables_limit') {", vers: '  if (false) {' }],
  },
  {
    nom: 'le public recoit le compte des tables',
    fichier: 'lib/reservation-ops.js',
    editions: [{ de: '    delete copie.opsPlan.tableLimit;\n', vers: '' }],
  },
  {
    nom: 'Etablissement n envoie pas la bascule',
    fichier: 'assets/app-main.js',
    editions: [{
      de: "        hardCapacity: Number(establishmentInputValue('estab-tableHard', 8)),\n        limitEnabled: chk('estab-tableLimit')\n",
      vers: "        hardCapacity: Number(establishmentInputValue('estab-tableHard', 8))\n",
    }],
  },
  {
    nom: 'la limite s allume par defaut a la normalisation',
    fichier: 'lib/center-config.js',
    editions: [{ de: '    limitEnabled: asBoolean(input.limitEnabled, false),', vers: '    limitEnabled: asBoolean(input.limitEnabled, true),' }],
  },
  {
    nom: 'la bascule s affiche cochee quelle que soit la donnee',
    fichier: 'assets/app-main.js',
    editions: [{ de: "id=\"estab-tableLimit\" ${party.limitEnabled === true ? 'checked' : ''}", vers: 'id="estab-tableLimit" checked' }],
  },
  {
    nom: 'la transition revient dans la fin d une formule',
    fichier: 'lib/ops-engine.js',
    editions: [{
      de: '  const sequentialMinutes = scheduledAnchorMinutes\n    + model.freeMinutes;',
      vers: '  const sequentialMinutes = scheduledAnchorMinutes\n    + model.freeMinutes\n    + Math.max(0, anchorWindows.length + model.freeSteps.length - 1) * TRANSITION_MINUTES;',
    }],
  },
  {
    nom: 'la transition revient dans la frise posee a l arrivee',
    fichier: 'lib/ops-engine.js',
    editions: [{ de: '  const transitions = 0;', vers: '  const transitions = Math.max(0, anchorWindows.length + model.freeSteps.length - 1) * TRANSITION_MINUTES;' }],
  },
];
const MUTATION_PREUVE = '[mutation] servie en memoire :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_TABLES_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
function muter(contenu, mutation) {
  let texte = String(contenu).split(CRLF).join(LF);
  for (const { de, vers } of mutation.editions) {
    if (texte.split(de).length - 1 !== 1) {
      console.error(`mutation impossible : ancre absente ou multiple dans ${mutation.fichier} : ${de.slice(0, 90)}`);
      process.exit(2);
    }
    texte = texte.split(de).join(vers);
  }
  console.log(`${MUTATION_PREUVE} ${mutation.nom}`);
  return texte;
}

// Le differentiel : les sources d un autre commit, servies a la compilation
// (lib/, api/ et les deux textes d ops-knowledge), le reste tel quel.
const SOURCES_DE = argApres('--sources');
const SOURCES = new Map();
if (SOURCES_DE) {
  const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  for (const rel of git('diff', '--name-only', SOURCES_DE, '--', 'lib', 'api', 'ops-knowledge').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (!/\.(js|json)$/.test(rel)) continue;
    try { SOURCES.set(path.resolve(ROOT, rel), git('show', `${SOURCES_DE}:${rel}`)); } catch (error) { /* fichier ne apres ce commit */ }
  }
}
// Le crochet est pose AVANT tout require applicatif.
const compile = Module.prototype._compile;
Module.prototype._compile = function compilerPourLeGate(contenu, nom) {
  const cible = path.resolve(nom);
  if (SOURCES.has(cible)) return compile.call(this, SOURCES.get(cible), nom);
  if (MUTATION && !MUTATION.fichier.startsWith('assets/') && cible === path.resolve(ROOT, MUTATION.fichier)) return compile.call(this, muter(contenu, MUTATION), nom);
  return compile.call(this, contenu, nom);
};
if (SOURCES.size) {
  const json = Module._extensions['.json'];
  Module._extensions['.json'] = function jsonDuCommit(module, filename) {
    const cible = path.resolve(filename);
    if (SOURCES.has(cible)) { module.exports = JSON.parse(SOURCES.get(cible)); return; }
    json(module, filename);
  };
}

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== undefined && detail !== '' ? `\n      ${String(detail).slice(0, 900)}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE : les centres et les communications, en SQL reel.
// ---------------------------------------------------------------------------
const BASE = { centres: new Map(), versionCentres: 1, comms: [], inconnues: [] };
const resultat = (rows) => ({ rows: clone(rows), rowCount: rows.length });
const maintenant = () => new Date().toISOString();
const due = (r) => (!r.scheduled_at || new Date(r.scheduled_at) <= Date.now()) && (!r.next_retry_at || new Date(r.next_retry_at) <= Date.now());
const engagee = (r) => Boolean(r.payload && r.payload.dispatchCommittedAt);
class FakePool {
  constructor() { this.totalCount = 0; this.idleCount = 1; this.waitingCount = 0; this.options = { max: 5 }; }
  on() { return this; }
  async connect() { return { query: (s, p) => this.query(s, p), release() {} }; }
  async end() {}
  async query(sql, p = []) {
    const q = String(sql || '').replace(/\s+/g, ' ').trim();
    if (/^(begin|commit|rollback)\b/i.test(q) || /^(savepoint|release savepoint|rollback to savepoint)\b/i.test(q) || q.includes('pg_advisory_xact_lock')) return resultat([]);
    if (q.includes('/* empreintes-caches */')) return resultat([{ centres: `gate-${BASE.versionCentres}`, surcharges: null, catalogue: null, blocages: {} }]);
    if (q === 'select id, name, status, timezone, settings from centers;') return resultat([...BASE.centres.values()].map(({ id, name, status, timezone, settings }) => ({ id, name, status, timezone, settings })));
    if (q.startsWith('select settings from centers where id = $1')) {
      const c = BASE.centres.get(p[0]);
      return resultat(c ? [{ settings: c.settings }] : []);
    }
    if (q.startsWith('update centers set settings = jsonb_set(')) {
      const c = BASE.centres.get(p[0]);
      if (!c) return { rows: [], rowCount: 0 };
      c.settings = { ...(c.settings || {}), config: JSON.parse(p[1]) };
      c.status = p[2];
      BASE.versionCentres += 1;
      return { rows: [], rowCount: 1 };
    }
    // Les volumes de la console fondateur (membres, reservations des 30 jours) : aucun.
    if (q.startsWith('select center_id, count(*)::int as active from staff_members') || q.startsWith('select center_id, count(*)::int as reservations,')) return resultat([]);
    if (q.includes('from centers c left join clients cl')) {
      return resultat([...BASE.centres.values()].map((c) => ({ id: c.id, name: c.name, status: c.status, timezone: c.timezone, settings: c.settings, client_id: c.client_id, client_name: 'Fun Galaxy' })));
    }
    if (q.startsWith('select settings from center_automation_settings')) return resultat([]);
    // Les fils de conversation (lib/email-threads) : aucun, un mail d equipe
    // n en ouvre pas ici.
    if (q.includes('email_threads')) return resultat([]);
    if (q.startsWith('select status, validation_status from reservations where id = $1 and center_id = $2 for share')) {
      const r = etat.reservations.get(Number(p[0]));
      return resultat(r && (r.centerId || 'libramont') === p[1] ? [{ status: r.status, validation_status: r.validationStatus || 'confirmed' }] : []);
    }
    if (q.includes('insert into communications')) {
      const existante = p[11] ? BASE.comms.find((r) => r.idempotency_key === p[11]) : null;
      if (existante) {
        if (q.includes('do nothing')) return resultat([]);
        if (existante.status === 'processing' || engagee(existante)) return resultat([]);
        if (!['sent', 'delivered'].includes(existante.status)) {
          Object.assign(existante, { recipient: p[5], subject: p[6], body: p[7], scheduled_at: p[9], payload: JSON.parse(p[10]), locked_at: null, last_error: null, next_retry_at: null });
          if (['cancelled', 'failed', 'queued', 'processing', 'draft'].includes(existante.status)) existante.status = p[8];
        }
        return resultat([existante]);
      }
      const ligne = {
        id: BASE.comms.length + 1, center_id: p[0], reservation_id: p[1], channel: p[2], direction: p[3], template_id: p[4],
        recipient: p[5], subject: p[6], body: p[7], status: p[8], scheduled_at: p[9], payload: JSON.parse(p[10]), idempotency_key: p[11],
        attempts: 0, max_attempts: 3, priority: 50, locked_at: null, last_error: null, next_retry_at: null, created_at: maintenant(), sent_at: null,
      };
      BASE.comms.push(ligne);
      return resultat([ligne]);
    }
    if (q.startsWith('select * from communications where idempotency_key = $1')) return resultat(BASE.comms.filter((r) => r.idempotency_key === p[0]));
    if (q.startsWith('select * from communications where id = $1')) return resultat(BASE.comms.filter((r) => r.id === Number(p[0])));
    if (q.includes('with due as')) {
      const stale = Date.now() - Number(p[1] || 10) * 60000;
      const lignes = BASE.comms.filter((r) => (r.status === 'queued' || (r.status === 'processing' && r.locked_at && new Date(r.locked_at).getTime() < stale))
        && due(r) && !(r.payload && r.payload.simulation === true) && !String(r.idempotency_key || '').startsWith('simulation:')
        && (!p[2] || r.center_id === p[2]) && (p[3] == null || Number(r.reservation_id) === Number(p[3])) && (p[5] == null || r.id === Number(p[5])))
        .sort((a, b) => a.id - b.id).slice(0, Number(p[0]) || 25);
      lignes.forEach((r) => { r.last_error = r.status === 'processing' ? r.last_error : null; r.status = 'processing'; r.locked_at = maintenant(); r.payload = { ...(r.payload || {}), dispatchOwner: p[4] }; });
      return resultat(lignes);
    }
    if (q.includes('communication-dispatch-commit')) {
      const r = BASE.comms.find((x) => x.id === Number(p[0]));
      if (!r || r.status !== 'processing' || !p[1] || r.payload.dispatchOwner !== p[1] || !due(r)) return resultat([]);
      r.payload.dispatchCommittedAt = r.payload.dispatchCommittedAt || maintenant();
      r.idempotency_key = r.idempotency_key || `communication:${r.center_id}:${r.id}`;
      return resultat([r]);
    }
    if (q.startsWith('update communications set status = coalesce($2, status)')) {
      const r = BASE.comms.find((x) => x.id === Number(p[0]));
      if (!r || r.status !== 'processing' || r.payload.dispatchOwner !== p[7]) return resultat([]);
      if (['sent', 'delivered'].includes(p[1]) && !engagee(r)) return resultat([]);
      r.status = p[1] || r.status;
      r.provider_message_id = p[2] || r.provider_message_id || null;
      r.attempts += Number(p[3] || 0);
      r.last_error = p[4];
      r.locked_at = p[1] === 'processing' ? maintenant() : (['draft', 'queued', 'sent', 'delivered', 'failed', 'cancelled'].includes(p[1]) ? null : r.locked_at);
      if (['sent', 'delivered'].includes(p[1])) r.sent_at = r.sent_at || maintenant();
      r.next_retry_at = p[5];
      if (p[8]) {
        const { dispatchCommittedAt, ...reste } = r.payload || {};
        void dispatchCommittedAt;
        r.payload = { ...reste, dispatchNotSentThroughAttempt: r.attempts };
      } else if (p[6]) r.payload = JSON.parse(p[6]);
      return resultat([r]);
    }
    if (q.startsWith("update communications set status = 'cancelled'") && q.includes('where reservation_id = $1')) {
      const lignes = BASE.comms.filter((r) => Number(r.reservation_id) === Number(p[0]) && r.center_id === p[1] && ['draft', 'queued', 'processing'].includes(r.status) && !engagee(r));
      lignes.forEach((r) => { r.status = 'cancelled'; r.locked_at = null; r.next_retry_at = null; r.last_error = p[2]; });
      return resultat(lignes);
    }
    BASE.inconnues.push(q.slice(0, 140));
    throw new Error(`SQL inattendue du gate : ${q.slice(0, 120)}`);
  }
}
const chargerOrigine = Module._load;
Module._load = function chargerPourLeGate(request, parent, isMain) {
  if (request === 'pg') return { Pool: FakePool };
  return chargerOrigine.call(this, request, parent, isMain);
};

// Resend : un double qui compte. Toute autre sortie reseau est refusee.
const ENVOIS = [];
let echecsResend = 0;
global.fetch = async (url, options = {}) => {
  if (String(url) !== 'https://api.resend.com/emails') throw new Error(`reseau interdit par le gate : ${String(url).slice(0, 80)}`);
  const corps = JSON.parse(String(options.body || '{}'));
  const entetes = options.headers || {};
  const cle = String(entetes['Idempotency-Key'] || entetes['idempotency-key'] || '');
  if (echecsResend > 0 && cle.startsWith('tables:')) {
    echecsResend -= 1;
    throw new Error('Resend indisponible (gate)');
  }
  ENVOIS.push({ a: [].concat(corps.to || []).map((x) => String(x).toLowerCase()), sujet: String(corps.subject || ''), texte: String(corps.text || ''), html: String(corps.html || ''), cle });
  return { ok: true, status: 200, json: async () => ({ id: `gate-${ENVOIS.length}` }) };
};

// ---------------------------------------------------------------------------
// LES DOSSIERS DE LA JOURNEE, en memoire (l ecriture des reservations est
// remplacee ; la verification de creation, elle, est la vraie).
// ---------------------------------------------------------------------------
const etat = { reservations: new Map(), suivant: 7000 };
const database = require(path.join(ROOT, 'lib/database.js'));
const valider = database.validateReservationResources;
const duJour = (date, centerId) => [...etat.reservations.values()]
  .filter((r) => r.date === date && (r.centerId || 'libramont') === (centerId || 'libramont') && r.status !== 'cancelled')
  .map(clone);
database.readStaffState = async (date, centerId = 'libramont') => ({ date, centerId, reservations: duJour(date, centerId), laneStatuses: {}, blocks: [], syncedAt: maintenant(), revision: 'gate' });
database.readAvailabilitySnapshot = async (date, centerId = 'libramont') => ({ date, centerId, reservations: duJour(date, centerId), laneStatuses: {}, blocks: [] });
database.getReservationById = async (id) => clone(etat.reservations.get(Number(id)) || null);
function ecrireDossier(input) {
  const jour = duJour(input.date, input.centerId || 'libramont');
  const verdict = valider({ ...input }, jour, {}, [], input.date);
  const complet = typeof input.verifierProgramme === 'function' ? input.verifierProgramme(jour, verdict.payload.opsPlan) : '';
  if (complet) throw Object.assign(new Error(`${complet} est complet sur ce créneau.`), { expose: true });
  const id = etat.suivant;
  etat.suivant += 1;
  const r = { ...clone(verdict.payload), id, centerId: verdict.payload.centerId || input.centerId || 'libramont', status: verdict.payload.status || 'confirmed', createdAt: maintenant(), updatedAt: maintenant() };
  etat.reservations.set(id, r);
  return clone(r);
}
database.createReservation = async (input = {}) => ecrireDossier(input);
database.updateReservation = async (patch = {}) => {
  const avant = etat.reservations.get(Number(patch.id));
  if (!avant) throw Object.assign(new Error('Reservation introuvable.'), { statusCode: 404, expose: true });
  const champs = clone({ ...patch, verifierProgramme: undefined, baseUpdatedAt: undefined, activityMove: undefined });
  const apres = { ...avant, ...champs, id: avant.id, centerId: avant.centerId, updatedAt: new Date(Date.now() + 1000).toISOString() };
  etat.reservations.set(avant.id, apres);
  return clone(apres);
};
database.setReservationStatus = async ({ id, status }) => {
  const avant = etat.reservations.get(Number(id));
  const apres = { ...avant, status, updatedAt: new Date(Date.now() + 1000).toISOString() };
  etat.reservations.set(avant.id, apres);
  return clone(apres);
};
database.applyReservationScheduleUpdates = async ({ updates = [] } = {}) => updates.map((u) => {
  const avant = etat.reservations.get(Number(u.id));
  const apres = { ...avant, startTime: u.startTime || avant.startTime, lanes: Array.isArray(u.lanes) ? u.lanes : avant.lanes, opsPlan: u.opsPlan !== undefined ? clone(u.opsPlan) : avant.opsPlan, updatedAt: new Date(Date.now() + 1000).toISOString() };
  etat.reservations.set(avant.id, apres);
  return clone(apres);
});
database.createDelayIncident = async () => ({ id: 1 });
database.cancelReservationOpsJobs = async () => [];
database.createOpsEvent = async () => null;
database.createSlotHold = async (input, { verifierProgramme = null } = {}) => {
  const jour = duJour(input.date, input.centerId || 'libramont');
  // Comme lib/database createSlotHold : aucune donnee personnelle, le nom du blocage.
  const verdict = valider({ ...input, name: database.NOM_BLOCAGE, phone: '-', email: '' }, jour, {}, [], input.date);
  const complet = typeof verifierProgramme === 'function' ? verifierProgramme(jour, verdict.payload.opsPlan) : '';
  if (complet) throw new Error(`${complet} est complet sur ce créneau.`);
  return { expiresAt: new Date(Date.now() + 600000).toISOString(), lanes: verdict.lanes, startTime: verdict.payload.startTime, opsPlan: verdict.payload.opsPlan || null, minutes: 10 };
};
database.readMatchingSlotHold = async () => null;
database.readUpsellSlotHold = async () => null;
database.reservationDejaConfirmee = async () => null;
database.precisionBlocagesEnCours = async () => '';
database.releaseSlotHold = async () => ({ released: 0 });

// La session staff, le journal d audit et le limiteur de debit, remplaces.
const SESSION = {
  centerId: 'libramont',
  authorizedCenterId: 'libramont',
  member: { id: 'gate-tables', name: 'Gate Tables', roleId: 'direction' },
  role: { id: 'direction', name: 'Direction', locked: true },
  permissions: ['dashboard.view', 'planning.view', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel', 'reservations.status', 'payments.markPaid', 'settings.manage', 'direction.view', 'centers.switch', 'platform.admin'],
};
function remplacer(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
}
const limiteur = require.resolve(path.join(ROOT, 'lib/rate-limit'));
require.cache[limiteur] = { id: limiteur, filename: limiteur, loaded: true, exports: {
  enforceRateLimit: () => false,
  checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  getClientIp: () => 'gate',
} };
remplacer('lib/staff-auth.js', { requireStaffPermission: async () => SESSION, getStaffSessionFromRequest: async () => SESSION });
remplacer('lib/audit-log.js', { writeAuditLog: async () => ({ ok: true }), writeAuditLogOrThrow: async () => ({ ok: true }) });

const knowledge = require(path.join(ROOT, 'lib/ops-knowledge.js'));
const centerConfig = require(path.join(ROOT, 'lib/center-config.js'));
const { jourDeTest } = require(path.join(ROOT, 'scripts/jour-de-test.js'));
const JOUR = jourDeTest({ jour: 6, depuis: 3 });

BASE.centres.set('libramont', { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: { config: {} }, client_id: 'fungalaxy' });
BASE.centres.set('gembloux', { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', timezone: 'Europe/Brussels', settings: { config: {} }, client_id: 'fungalaxy' });
const SECOURS_LIBRAMONT = ['equipe.libramont@gate-fungalaxy.be', 'direction.libramont@gate-fungalaxy.be'];
const SECOURS_GEMBLOUX = ['equipe.gembloux@gate-fungalaxy.be'];

// La configuration d un centre telle qu elle est en base AVANT ce lot : la cle
// limitEnabled n y est pas.
function configAvantLeLot(id, emails) {
  return { resources: { partyTables: { softCapacity: 6, hardCapacity: 8 } }, secours: { emails } };
}
async function rafraichirCentres() {
  BASE.versionCentres += 1;
  await knowledge.refreshCenterOverrides(database.getPool(), { force: true });
}
// Ecrite telle quelle (des donnees d avant ce lot), ou enregistree par le vrai
// saveCenterConfigOverride (fusion, normalisation stricte).
async function poserCentreBrut(id, config) {
  BASE.centres.get(id).settings = { config: clone(config) };
  await rafraichirCentres();
}
async function enregistrerCentre(id, patch) {
  await centerConfig.saveCenterConfigOverride(database.getPool(), id, patch);
  await rafraichirCentres();
}
async function centreAvecLimite(id, emails, { allumee = true, hardCapacity = 8 } = {}) {
  await poserCentreBrut(id, configAvantLeLot(id, emails));
  await enregistrerCentre(id, { resources: { partyTables: { softCapacity: 6, hardCapacity, limitEnabled: allumee } } });
}

// Le corps que le formulaire public envoie (assets/fungalaxy-booking.js) : la
// demande, et ce que la grille des heures a servi (duree, prix, libelle).
function corpsDuFormulaire(json, f, heure, contact = null) {
  return {
    centerId: 'libramont', date: JOUR, startTime: heure, type: 'formule', formuleId: f, pax: 10,
    price: Number(json.price) || 0, basePrice: Number(json.price) || 0,
    duration: Number(json.duration) || 1, totalDuration: Number(json.totalDuration) || Number(json.duration) || 1,
    laneCount: Number(json.laneCount) || 0, requiresLanes: Boolean(json.requiresLanes), label: json.label || '',
    preference: { preferredTimes: {}, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' },
    ...(contact || {}),
  };
}
const minutes = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + m; };
const tablesDe = (plan) => ((plan && plan.resourceBlocks) || []).filter((b) => b && b.resourceType === 'party_table');
const fenetres = (plan) => tablesDe(plan).map((b) => `${b.startTime}-${b.endTime}`).join(' ');

// ---------------------------------------------------------------------------
// LES APPELS HTTP EN PROCESS.
// ---------------------------------------------------------------------------
function fakeReq(method, url, body) {
  const charge = Buffer.from(body === undefined ? '' : JSON.stringify(body));
  const req = Readable.from([charge]);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost', 'content-type': 'application/json', 'content-length': String(charge.length), 'user-agent': 'tables-sans-blocage-check' };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}
function fakeRes() {
  const res = {
    statusCode: 0, body: '', headers: {}, headersSent: false,
    setHeader(nom, valeur) { this.headers[String(nom).toLowerCase()] = valeur; },
    getHeader(nom) { return this.headers[String(nom).toLowerCase()]; },
    writeHead(code) { this.statusCode = code; this.headersSent = true; return this; },
    end(chunk) { this.body += chunk == null ? '' : String(chunk); this.headersSent = true; },
  };
  return res;
}
async function appeler(handler, method, url, body) {
  const res = fakeRes();
  await handler(fakeReq(method, url, body), res);
  let json = null;
  try { json = JSON.parse(res.body || '{}'); } catch (error) { json = { brut: res.body }; }
  return { status: res.statusCode, json };
}

// ---------------------------------------------------------------------------
// LES FETES DE LA JOURNEE.
// ---------------------------------------------------------------------------
const planCache = new Map();
function planVide(engine, f, heure, centre = 'libramont') {
  const cle = `${centre}|${f}|${heure}`;
  if (!planCache.has(cle)) {
    const p = engine.planReservation({ centerId: centre === 'gembloux' ? 'libramont' : centre, date: JOUR, type: 'formule', formuleId: f, pax: 10, startTime: heure }, { reservations: [], laneStatuses: {} });
    planCache.set(cle, p && p.recommended ? p.recommended : null);
  }
  return clone(planCache.get(cle));
}
let numero = 100;
function fete(engine, f, heure, { centre = 'libramont', nom = '', statut = 'confirmed' } = {}) {
  numero += 1;
  return {
    id: numero, name: nom || `Fete ${numero}`, phone: '+32470000000', email: '', date: JOUR, centerId: centre, startTime: heure,
    status: statut, validationStatus: 'confirmed', type: 'formule', formuleId: f, label: `FORMULE ${f.slice(1)}`, pax: 10, lanes: [],
    opsPlan: planVide(engine, f, heure, centre), duration: 2, totalDuration: 2, channel: 'staff', price: 290, basePrice: 290,
    createdAt: maintenant(), updatedAt: maintenant(),
  };
}
const fetes = (engine, n, f, heure, options) => Array.from({ length: n }, () => fete(engine, f, heure, options));
function viderLaJournee() { etat.reservations.clear(); }
function poserDossiers(liste) { liste.forEach((r) => etat.reservations.set(Number(r.id), clone(r))); }
function viderLesMails() { BASE.comms.length = 0; ENVOIS.length = 0; echecsResend = 0; }
const mailsDesTables = () => ENVOIS.filter((e) => e.cle.startsWith('tables:'));
const lignesDesTables = () => BASE.comms.filter((r) => r.template_id === 'staff_tables_limit');
const destinatairesDe = (mails) => mails.flatMap((m) => m.a).sort();
const memesAdresses = (mails, attendues) => JSON.stringify(destinatairesDe(mails)) === JSON.stringify([...attendues].map((a) => a.toLowerCase()).sort());

// ---------------------------------------------------------------------------
// [A] LE MOTEUR.
// ---------------------------------------------------------------------------
async function sectionMoteur() {
  section('A. LE MOTEUR : LA NEUVIEME FETE, A L HEURE DEMANDEE, SANS CONFLIT');
  const engine = require(path.join(ROOT, 'lib/ops-engine.js'));
  const plan = (f, heure, reservations) => engine.planReservation({ centerId: 'libramont', date: JOUR, type: 'formule', formuleId: f, pax: 10, startTime: heure }, { reservations, laneStatuses: {} });
  const huit = fetes(engine, 8, 'f6', '14:00');
  const sept = huit.slice(0, 7);
  ok(fenetres(huit[0].opsPlan) === '13:50-16:00', 'MONTAGE huit fetes F6 a 14:00, chacune sa table de 13:50 a 16:00', fenetres(huit[0].opsPlan));
  const memeTenue = (a, b) => a.risk && b.risk && a.risk.score === b.risk.score && a.risk.level === b.risk.level && a.bufferMinutes === b.bufferMinutes
    && a.endTime === b.endTime && (a.marketIntelligence || {}).qualityScore === (b.marketIntelligence || {}).qualityScore;
  const tenue = (r) => JSON.stringify({ risque: r.risk && r.risk.score, niveau: r.risk && r.risk.level, marge: r.bufferMinutes, fin: r.endTime, qualite: (r.marketIntelligence || {}).qualityScore });

  await poserCentreBrut('libramont', configAvantLeLot('libramont', SECOURS_LIBRAMONT));
  ok(!engine.limiteDeTablesActive(knowledge.getCenter('libramont')), 'MONTAGE une configuration d avant ce lot (sans la cle) : la limite est eteinte');
  const neuvieme = plan('f6', '14:00', huit).recommended || {};
  ok(neuvieme.startTime === '14:00' && neuvieme.conflicts && neuvieme.conflicts.length === 0 && !('tableLimit' in neuvieme),
    '[A] donnees d avant ce lot : la neuvieme fete passe, sans signal', JSON.stringify({ heure: neuvieme.startTime, conflits: neuvieme.conflicts, limite: neuvieme.tableLimit }));

  const eteints = {};
  for (const allumee of [false, true]) {
    await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee });
    const etiquette = allumee ? 'allumee' : 'eteinte';
    ok(engine.limiteDeTablesActive(knowledge.getCenter('libramont')) === allumee, `MONTAGE la limite est ${etiquette} (enregistree par le vrai saveCenterConfigOverride)`);
    for (const f of ['f6', 'f7', 'f8']) {
      const vide = plan(f, '14:00', []);
      const rv = vide.recommended || {};
      const p = plan(f, '14:00', huit);
      const r = p.recommended || {};
      ok(vide.ok && rv.startTime === '14:00' && tablesDe(rv).length === 1 && minutes(tablesDe(rv)[0].startTime) < minutes('16:00'),
        `MONTAGE ${f} a 14:00 un jour vide : sa table (${fenetres(rv)}) chevauche celles des huit fetes`, JSON.stringify({ ok: vide.ok, raison: vide.reason }));
      ok(p.ok === true && r.ok !== false && r.startTime === '14:00', `[A] ${etiquette}, ${f} : la neuvieme fete se planifie a l heure demandee, 14:00`, JSON.stringify({ ok: p.ok, raison: p.reason, heure: r.startTime, conflits: r.conflicts }));
      ok(tablesDe(r).length === 1 && fenetres(r) === fenetres(rv), `[A] ${etiquette}, ${f} : son bloc table reste pose (${fenetres(r)})`, fenetres(r));
      ok(Array.isArray(r.conflicts) && r.conflicts.length === 0, `[A] ${etiquette}, ${f} : aucun conflit`, JSON.stringify(r.conflicts));
      ok(memeTenue(r, rv), `[A] ${etiquette}, ${f} : le meme risque, la meme marge, la meme fin et la meme qualite qu un jour vide`, `${tenue(r)} contre ${tenue(rv)}`);
      if (!allumee) {
        eteints[f] = r;
        ok(!('tableLimit' in r), `[A] eteinte, ${f} : aucun signal de limite`, JSON.stringify(r.tableLimit));
      } else {
        const l = r.tableLimit || {};
        ok(l.limit === 8 && l.count === 9 && `${l.startTime}-${l.endTime}` === fenetres(r), `[A] allumee, ${f} : le plan porte le signal, 9 tables pour une limite de 8, sur la plage de sa table`, JSON.stringify(r.tableLimit));
        const sansSignal = { ...r };
        delete sansSignal.tableLimit;
        ok(JSON.stringify(sansSignal) === JSON.stringify(eteints[f]), `[A] allumee, ${f} : hors du signal, le plan est celui de la limite eteinte, a l octet`);
        const h = plan(f, '14:00', sept).recommended || {};
        ok(h.startTime === '14:00' && !('tableLimit' in h), `[A] allumee, ${f} : la huitieme fete ne porte aucun signal`, JSON.stringify(h.tableLimit));
      }
    }
  }

  // La limite est hardCapacity : a 10, la neuvieme et la dixieme passent sans signal.
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: true, hardCapacity: 10 });
  const neufSur10 = plan('f6', '14:00', huit).recommended || {};
  const dix = [...huit, ...fetes(engine, 2, 'f6', '14:00')];
  const onzeSur10 = plan('f6', '14:00', dix).recommended || {};
  ok(!('tableLimit' in neufSur10) && (onzeSur10.tableLimit || {}).limit === 10 && (onzeSur10.tableLimit || {}).count === 11 && onzeSur10.conflicts.length === 0,
    '[A] la limite est hardCapacity : a 10, la neuvieme ne signale rien, la onzieme signale 11 pour 10, sans conflit', JSON.stringify({ neuf: neufSur10.tableLimit, onze: onzeSur10.tableLimit }));

  // partyTables null : rien ne se compte, rien ne casse.
  await poserCentreBrut('libramont', { resources: { partyTables: null }, secours: { emails: SECOURS_LIBRAMONT } });
  ok(knowledge.getCenter('libramont').resources.partyTables === null, 'MONTAGE partyTables null');
  const nul = plan('f6', '14:00', huit);
  const rn = nul.recommended || {};
  ok(nul.ok === true && rn.startTime === '14:00' && rn.conflicts.length === 0 && !('tableLimit' in rn), '[A] partyTables null : la neuvieme fete passe, sans conflit ni signal',
    JSON.stringify({ ok: nul.ok, raison: nul.reason, conflits: rn.conflicts, limite: rn.tableLimit }));

  // Une formule a ancres (bowling 14:00, laser 15:30) qui porte une table.
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: true });
  const centre = knowledge.getCenter('libramont');
  const formule = clone(knowledge.loadOpsKnowledge().formulaById.get('f1'));
  formule.id = 'f1-avec-table';
  formule.steps = [{ activityId: 'party_table', count: 1, durationMinutes: 120 }, ...formule.steps];
  const ancre = (reservations) => engine.evaluateAnchoredCombination({ center: centre, formula: formule, date: JOUR, pax: 10, anchorTimes: { bowling: minutes('14:00'), laser_game: minutes('15:30') }, reservations, laneStatuses: {} });
  const av = ancre([]);
  const a9 = ancre(huit);
  const sv = av.scenario || {};
  const s9 = a9.scenario || {};
  ok(av.ok === true && tablesDe(sv).length === 1, `MONTAGE la formule a ancres pose sa table (${fenetres(sv)}) un jour vide`, JSON.stringify({ ok: av.ok, code: av.code, raison: av.reason }));
  ok(a9.ok === true && s9.conflicts.length === 0 && memeTenue(s9, sv) && fenetres(s9) === fenetres(sv), '[A] la formule a ancres, avec 8 tables prises : la combinaison passe, sans conflit, au meme risque et a la meme qualite',
    JSON.stringify({ ok: a9.ok, code: a9.code, raison: a9.reason, conflits: s9.conflicts, tenue: s9.risk ? tenue(s9) : null, vide: tenue(sv) }));
  ok((s9.tableLimit || {}).count === 9, '[A] la formule a ancres, allumee : son plan porte le signal de 9 tables', JSON.stringify(s9.tableLimit));
}

// ---------------------------------------------------------------------------
// [B] LE RETARD.
// ---------------------------------------------------------------------------
async function sectionRetard() {
  section('B. UN RETARD QUI EMPILE LES TABLES RESTE FAISABLE');
  const engine = require(path.join(ROOT, 'lib/ops-engine.js'));
  const huit = fetes(engine, 8, 'f6', '14:00');
  const tard = fete(engine, 'f6', '11:00');
  const ctx = { reservations: [...huit, tard], laneStatuses: {} };
  for (const allumee of [false, true]) {
    await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee });
    const etiquette = allumee ? 'allumee' : 'eteinte';
    const impact = engine.computeDelayImpact({ centerId: 'libramont', date: JOUR, reservationId: tard.id, delayMinutes: 60, reasonId: 'late_customer' }, ctx);
    const reco = (impact.strategies || []).find((s) => s.id === impact.recommendedStrategyId) || {};
    const changes = reco.changes || [];
    const sienne = changes.find((c) => Number(c.reservationId) === tard.id);
    ok(Boolean(sienne) && fenetres(sienne.update.opsPlan) === '11:50-14:00', 'MONTAGE 60 min de retard poussent la table de la fete de 11:00 sur 11:50-14:00, contre les huit tables de 13:50',
      sienne ? fenetres(sienne.update.opsPlan) : JSON.stringify(impact.strategies));
    ok(reco.feasible === true && changes.length === 1, `[B] ${etiquette} : la strategie recommandee est faisable et ne pousse aucune autre fete`,
      JSON.stringify((impact.strategies || []).map((s) => ({ id: s.id, faisable: s.feasible, motif: s.reasonIfNot, dossiers: (s.changes || []).map((c) => c.reservationId) }))));
    const analyse = engine.analyzeDelay({ centerId: 'libramont', date: JOUR, reservationId: tard.id, reservation: tard, delayMinutes: 60, reasonId: 'late_customer', plan: tard.opsPlan }, ctx);
    ok(analyse.ok === true && analyse.canApply === true, `[B] ${etiquette} : l analyse du retard le dit absorbable`, JSON.stringify({ ok: analyse.ok, statut: analyse.status }));
  }
}

// ---------------------------------------------------------------------------
// [C] L API PUBLIQUE ET [D] LE COMPTOIR.
// ---------------------------------------------------------------------------
async function sectionPublicEtComptoir() {
  section('C. L API PUBLIQUE : LES MEMES HEURES, LE BLOCAGE D HORAIRES EN 201');
  const engine = require(path.join(ROOT, 'lib/ops-engine.js'));
  const api = require(path.join(ROOT, 'api/public-availability.js'));
  const { disponibiliteInterne } = require(path.join(ROOT, 'lib/disponibilite-interne.js'));
  const publicReservations = require(path.join(ROOT, 'api/public-reservations.js'));
  const { prepareReservationOps } = require(path.join(ROOT, 'lib/reservation-ops.js'));
  const heures = async (f) => {
    const rep = await disponibiliteInterne({ centerId: 'libramont', date: JOUR, pax: '10', type: 'formule', formuleId: f }, { handler: api });
    return { statut: rep.status, heures: (((rep.json || {}).slots) || []).map((s) => s.time), json: rep.json || {} };
  };
  const huit = fetes(engine, 8, 'f6', '14:00');
  for (const allumee of [false, true]) {
    await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee });
    const etiquette = allumee ? 'allumee' : 'eteinte';
    for (const f of ['f6', 'f7', 'f8']) {
      viderLaJournee();
      const vide = await heures(f);
      poserDossiers(huit);
      const pleine = await heures(f);
      ok(vide.statut === 200 && vide.heures.includes('14:00') && JSON.stringify(pleine.heures) === JSON.stringify(vide.heures),
        `[C] ${etiquette}, ${f} : avec 8 tables prises, l API publique sert les memes heures qu un jour vide, 14:00 comprise`, `vide ${vide.heures.join(' ')} | 8 tables ${pleine.heures.join(' ')}`);
      const corps = corpsDuFormulaire(pleine.json, f, '14:00');
      const interne = await prepareReservationOps({ ...corps, name: '', phone: '', email: '' }, 'public', {});
      ok(interne.blockOnlineConfirmation === false && (allumee ? (interne.opsPlan.tableLimit || {}).count === 9 : !('tableLimit' in interne.opsPlan)),
        `MONTAGE ${etiquette}, ${f} : le plan interne ${allumee ? 'porte' : 'ne porte pas'} le signal de 9 tables`, JSON.stringify(interne.opsPlan && interne.opsPlan.tableLimit));
      const blocage = await appeler(publicReservations, 'POST', '/api/public-reservations?action=hold', corps);
      ok(blocage.status === 201 && Boolean(blocage.json.holdToken), `[C] ${etiquette}, ${f} : le blocage des horaires de 14:00 repond 201, pas 409`, JSON.stringify(blocage.json).slice(0, 300));
      ok(tablesDe(blocage.json.opsPlan).length === 1, `[C] ${etiquette}, ${f} : le plan retenu porte son bloc table`, fenetres(blocage.json.opsPlan));
      ok(!(blocage.json.opsPlan && 'tableLimit' in blocage.json.opsPlan), `[C] ${etiquette}, ${f} : le public ne recoit jamais le compte des tables`, JSON.stringify(blocage.json.opsPlan && blocage.json.opsPlan.tableLimit));
    }
  }

  section('D. LA FENETRE RESERVER DU COMPTOIR');
  const { planifierPourLaFenetre } = require(path.join(ROOT, 'lib/reserver-fenetre.js'));
  for (const allumee of [false, true]) {
    await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee });
    const etiquette = allumee ? 'allumee' : 'eteinte';
    for (const f of ['f6', 'f7', 'f8']) {
      const p = await planifierPourLaFenetre({ centerId: 'libramont', date: JOUR, pax: 10, startTime: '14:00', type: 'formule', formuleId: f, name: 'Comptoir Gate', phone: '', email: '' },
        { authorizedCenterId: 'libramont' }, { readState: async () => ({ reservations: clone(huit), laneStatuses: {} }), forcer: true });
      ok(p.conflits.length === 0 && p.aPlacer === false && p.dossier.startTime === '14:00' && tablesDe(p.dossier.opsPlan).length === 1,
        `[D] ${etiquette}, ${f} : au comptoir, la neuvieme fete se cree a 14:00, sa table posee, sans conflit, rien « à placer »`, JSON.stringify({ conflits: p.conflits, aPlacer: p.aPlacer, heure: p.dossier && p.dossier.startTime }));
    }
  }
}

// ---------------------------------------------------------------------------
// [E] LE MAIL AU CENTRE.
// ---------------------------------------------------------------------------
async function sectionMails() {
  section('E. LE MAIL AU CENTRE : UN SEUL, AUX ADRESSES DU CENTRE');
  const engine = require(path.join(ROOT, 'lib/ops-engine.js'));
  const comms = require(path.join(ROOT, 'lib/ops-communications.js'));
  const { afterReservationCreated } = require(path.join(ROOT, 'lib/reservation-ops.js'));
  const { alerterLimiteDeTables } = require(path.join(ROOT, 'lib/limite-tables.js'));
  const publicReservations = require(path.join(ROOT, 'api/public-reservations.js'));
  const staffReservations = require(path.join(ROOT, 'api/staff-reservations.js'));
  const ops = require(path.join(ROOT, 'api/ops.js'));
  const api = require(path.join(ROOT, 'api/public-availability.js'));
  const { disponibiliteInterne } = require(path.join(ROOT, 'lib/disponibilite-interne.js'));
  const interdites = [ADRESSE_GLOBALE, ADRESSE_STAFF_GLOBALE, ...SECOURS_GEMBLOUX, 'libramont@fungalaxy.be', 'gembloux@fungalaxy.be'];
  const aucuneInterdite = (mails, autorisees = []) => destinatairesDe(mails).every((a) => !interdites.includes(a) || autorisees.includes(a));
  const corpsPublic = async (f, heure, nom) => {
    const grille = await disponibiliteInterne({ centerId: 'libramont', date: JOUR, pax: '10', type: 'formule', formuleId: f }, { handler: api });
    return corpsDuFormulaire(grille.json || {}, f, heure, { name: nom, phone: '+32470112233', email: 'client.tables@exemple.test' });
  };
  const jourEnLettres = new Intl.DateTimeFormat('fr-BE', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${JOUR}T12:00:00Z`));

  // E1 : allumee, depassee, par le formulaire public.
  viderLesMails();
  viderLaJournee();
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: true });
  await centreAvecLimite('gembloux', SECOURS_GEMBLOUX, { allumee: true });
  poserDossiers(fetes(engine, 8, 'f6', '14:00'));
  const rep = await appeler(publicReservations, 'POST', '/api/public-reservations', await corpsPublic('f6', '14:00', 'Client Neuvieme'));
  ok(rep.status === 201 && rep.json.reservation && rep.json.reservation.startTime === '14:00', 'MONTAGE formulaire public : la neuvieme fete est creee a 14:00 (201)', JSON.stringify(rep.json).slice(0, 400));
  const creee = rep.json.reservation || {};
  ok(!('tableLimit' in (creee.opsPlan || {})) && Boolean((etat.reservations.get(Number(creee.id)) || {}).opsPlan && etat.reservations.get(Number(creee.id)).opsPlan.tableLimit),
    '[C] le dossier garde le signal, la reponse publique ne le porte pas', JSON.stringify((creee.opsPlan || {}).tableLimit));
  const e1 = mailsDesTables();
  ok(e1.length === SECOURS_LIBRAMONT.length && memesAdresses(e1, SECOURS_LIBRAMONT), '[E] formulaire public, allumee et depassee : exactement un mail par adresse de la boite de secours du centre',
    JSON.stringify(e1.map((m) => m.a)));
  ok(aucuneInterdite(e1), '[E] aucune adresse globale, d un autre centre ou publique du socle', JSON.stringify(destinatairesDe(e1)));
  const texte = (e1[0] || {}).texte || '';
  ok(/13:50/.test(texte) && /16:00/.test(texte) && /\b9\b/.test(texte) && /\b8\b/.test(texte) && /Client Neuvieme/.test(texte) && /formule 6/i.test(texte) && /\b10\b/.test(texte) && /bloqu/i.test(texte) && texte.includes(jourEnLettres),
    '[E] le mail dit la date, la plage, les tables occupees et la limite, le client, la formule, le nombre de personnes, et que rien n a ete bloque', texte);
  ok(lignesDesTables().every((l) => l.reservation_id === null && l.status === 'sent'), '[E] les lignes de la file sont envoyees, sans reservation_id', JSON.stringify(lignesDesTables().map((l) => [l.status, l.reservation_id])));

  // Idempotence : le meme declencheur rejoue, une remise a jour sans
  // deplacement, un nouveau telephone.
  await afterReservationCreated(clone(etat.reservations.get(Number(creee.id))), {});
  await alerterLimiteDeTables(clone(etat.reservations.get(Number(creee.id))));
  const patchTel = await appeler(staffReservations, 'PATCH', '/api/staff-reservations', { id: Number(creee.id), centerId: 'libramont', phone: '+32470998877' });
  ok(patchTel.status === 200, 'MONTAGE comptoir : un nouveau telephone s enregistre (200)', JSON.stringify(patchTel.json).slice(0, 300));
  ok(mailsDesTables().length === e1.length && lignesDesTables().length === e1.length, '[E] idempotent : le declencheur rejoue deux fois et un nouveau telephone n envoient rien de plus',
    `${mailsDesTables().length} mails, ${lignesDesTables().length} lignes`);

  // E2 : eteinte, depassee.
  viderLesMails();
  viderLaJournee();
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: false });
  poserDossiers(fetes(engine, 8, 'f6', '14:00'));
  const rep2 = await appeler(publicReservations, 'POST', '/api/public-reservations', await corpsPublic('f6', '14:00', 'Client Eteinte'));
  ok(rep2.status === 201, 'MONTAGE eteinte : la neuvieme fete est creee (201)', JSON.stringify(rep2.json).slice(0, 300));
  ok(mailsDesTables().length === 0 && lignesDesTables().length === 0, '[E] eteinte : aucun mail, aucune ligne en file', `${mailsDesTables().length} mails`);

  // E2 bis : donnees d avant ce lot (sans la cle), depassee.
  viderLesMails();
  viderLaJournee();
  await poserCentreBrut('libramont', configAvantLeLot('libramont', SECOURS_LIBRAMONT));
  poserDossiers(fetes(engine, 8, 'f6', '14:00'));
  await appeler(publicReservations, 'POST', '/api/public-reservations', await corpsPublic('f6', '14:00', 'Client Avant'));
  ok(mailsDesTables().length === 0, '[E] donnees d avant ce lot : aucun mail', `${mailsDesTables().length} mails`);

  // E3 : allumee, sans depassement (la huitieme).
  viderLesMails();
  viderLaJournee();
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: true });
  poserDossiers(fetes(engine, 7, 'f6', '14:00'));
  const rep3 = await appeler(publicReservations, 'POST', '/api/public-reservations', await corpsPublic('f6', '14:00', 'Client Huitieme'));
  ok(rep3.status === 201, 'MONTAGE allumee : la huitieme fete est creee (201)', JSON.stringify(rep3.json).slice(0, 300));
  ok(mailsDesTables().length === 0, '[E] allumee sans depassement : aucun mail', `${mailsDesTables().length} mails`);

  // E4 : au comptoir.
  viderLesMails();
  viderLaJournee();
  poserDossiers(fetes(engine, 8, 'f6', '14:00'));
  const comptoir = await appeler(staffReservations, 'POST', '/api/staff-reservations', { ...(await corpsPublic('f6', '14:00', 'Client Comptoir')), phone: '', email: '', status: 'pending' });
  ok(comptoir.status === 201 && comptoir.json.aPlacer !== true, 'MONTAGE comptoir : la neuvieme fete est creee (201), rien « à placer »', JSON.stringify(comptoir.json).slice(0, 300));
  const e4 = mailsDesTables();
  ok(e4.length === SECOURS_LIBRAMONT.length && memesAdresses(e4, SECOURS_LIBRAMONT) && aucuneInterdite(e4), '[E] comptoir, allumee et depassee : un mail par adresse du centre', JSON.stringify(e4.map((m) => m.a)));

  // E5 : un deplacement au comptoir vers un creneau depasse renvoie ; le retour
  // sur une plage deja signalee, non ; une plage qui tient, non.
  viderLesMails();
  viderLaJournee();
  poserDossiers([...fetes(engine, 8, 'f6', '14:00'), ...fetes(engine, 8, 'f6', '18:00')]);
  const deplace = fete(engine, 'f6', '11:00', { nom: 'Client Deplace' });
  poserDossiers([deplace]);
  await afterReservationCreated(clone(deplace), {});
  ok(mailsDesTables().length === 0, 'MONTAGE la fete de 11:00 (table 10:50-13:00) ne depasse rien', `${mailsDesTables().length} mails`);
  const vers = async (heure) => appeler(staffReservations, 'PATCH', '/api/staff-reservations', { id: deplace.id, centerId: 'libramont', startTime: heure });
  const d14 = await vers('14:00');
  ok(d14.status === 200 && (etat.reservations.get(deplace.id) || {}).startTime === '14:00', 'MONTAGE le comptoir deplace la fete a 14:00 (200)', JSON.stringify(d14.json).slice(0, 300));
  ok(mailsDesTables().length === SECOURS_LIBRAMONT.length && memesAdresses(mailsDesTables(), SECOURS_LIBRAMONT), '[E] deplacee a 14:00 (9 tables) : un mail par adresse du centre', JSON.stringify(mailsDesTables().map((m) => m.a)));
  await vers('18:00');
  ok(mailsDesTables().length === 2 * SECOURS_LIBRAMONT.length, '[E] deplacee sur un autre creneau depasse (18:00) : le centre est prevenu de nouveau', `${mailsDesTables().length} mails`);
  await vers('14:00');
  ok(mailsDesTables().length === 2 * SECOURS_LIBRAMONT.length, '[E] revenue sur la plage deja signalee (14:00) : rien de plus', `${mailsDesTables().length} mails`);
  await vers('11:00');
  ok(mailsDesTables().length === 2 * SECOURS_LIBRAMONT.length, '[E] deplacee sur une plage qui tient (11:00) : rien', `${mailsDesTables().length} mails`);

  // E6 : un changement de statut n est ni une creation ni un deplacement.
  viderLesMails();
  viderLaJournee();
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: false });
  poserDossiers(fetes(engine, 8, 'f6', '14:00'));
  const avantLimite = fete(engine, 'f6', '14:00', { nom: 'Client Statut', statut: 'pending' });
  poserDossiers([avantLimite]);
  await afterReservationCreated(clone(avantLimite), {});
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: true });
  const statut = await appeler(staffReservations, 'PATCH', '/api/staff-reservations', { id: avantLimite.id, centerId: 'libramont', status: 'confirmed' });
  ok(statut.status === 200 && (etat.reservations.get(avantLimite.id) || {}).status === 'confirmed', 'MONTAGE le statut passe a confirmee (200)', JSON.stringify(statut.json).slice(0, 300));
  ok(mailsDesTables().length === 0, '[E] la limite allumee apres coup, un changement de statut ne previent pas', `${mailsDesTables().length} mails`);

  // E7 : sans adresse de secours, rien ne part (la variable globale ne sert pas).
  viderLesMails();
  viderLaJournee();
  await centreAvecLimite('libramont', [], { allumee: true });
  poserDossiers(fetes(engine, 8, 'f6', '14:00'));
  const sansAdresse = fete(engine, 'f6', '14:00', { nom: 'Client Sans Adresse' });
  poserDossiers([sansAdresse]);
  const r7 = await alerterLimiteDeTables(clone(sansAdresse));
  ok(Boolean(r7 && r7.depassement && r7.depassement.count === 9), 'MONTAGE sans adresse : le depassement est bien compte (9)', JSON.stringify(r7));
  ok(mailsDesTables().length === 0 && lignesDesTables().length === 0, '[E] sans adresse de secours : rien ne part, la variable globale ne sert pas', JSON.stringify(mailsDesTables().map((m) => m.a)));

  // E8 : un autre centre recoit ses mails, et les siens seulement.
  viderLesMails();
  viderLaJournee();
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: true });
  await centreAvecLimite('gembloux', SECOURS_GEMBLOUX, { allumee: true });
  poserDossiers(fetes(engine, 8, 'f6', '14:00', { centre: 'gembloux' }));
  const chezGembloux = fete(engine, 'f6', '14:00', { centre: 'gembloux', nom: 'Client Gembloux' });
  poserDossiers([chezGembloux]);
  await afterReservationCreated(clone(chezGembloux), {});
  const e8 = mailsDesTables();
  ok(e8.length === 1 && memesAdresses(e8, SECOURS_GEMBLOUX), '[E] Gembloux depasse : son mail part a sa boite, jamais a celle de Libramont', JSON.stringify(e8.map((m) => m.a)));

  // E9 : une alerte remise en file (envoi en echec) se recontrole a l envoi.
  const enFile = async (nom) => {
    viderLesMails();
    viderLaJournee();
    await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: true });
    poserDossiers(fetes(engine, 8, 'f6', '14:00'));
    const d = fete(engine, 'f6', '14:00', { nom });
    poserDossiers([d]);
    echecsResend = SECOURS_LIBRAMONT.length;
    await alerterLimiteDeTables(clone(d));
    lignesDesTables().forEach((l) => { l.next_retry_at = null; });
    return d;
  };
  const tous = async () => comms.dispatchDueCommunications({ limit: 25 });
  const temoin = await enFile('Client Temoin');
  ok(mailsDesTables().length === 0 && lignesDesTables().length === SECOURS_LIBRAMONT.length && lignesDesTables().every((l) => l.status === 'queued'),
    'MONTAGE Resend en echec : les deux alertes restent en file', JSON.stringify(lignesDesTables().map((l) => [l.status, l.last_error])));
  await tous();
  ok(mailsDesTables().length === SECOURS_LIBRAMONT.length, '[E] remise en file, toujours vraie : elle part au passage suivant', `${mailsDesTables().length} mails`);
  void temoin;
  const annulee = await enFile('Client Annule');
  etat.reservations.set(annulee.id, { ...etat.reservations.get(annulee.id), status: 'cancelled' });
  await tous();
  ok(mailsDesTables().length === 0 && lignesDesTables().every((l) => l.status === 'cancelled'), '[E] remise en file, dossier annule depuis : elle ne part plus, la ligne est annulee', JSON.stringify(lignesDesTables().map((l) => [l.status, l.last_error])));
  await enFile('Client Eteint');
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: false });
  await tous();
  ok(mailsDesTables().length === 0 && lignesDesTables().every((l) => l.status === 'cancelled'), '[E] remise en file, limite eteinte depuis : elle ne part plus', JSON.stringify(lignesDesTables().map((l) => [l.status, l.last_error])));

  // E10 : un retard applique dans le planning.
  viderLesMails();
  viderLaJournee();
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: true });
  poserDossiers(fetes(engine, 8, 'f6', '14:00'));
  const enRetard = fete(engine, 'f6', '11:00', { nom: 'Client En Retard' });
  poserDossiers([enRetard]);
  const retard = await appeler(ops, 'POST', '/api/ops', { action: 'delayApply', centerId: 'libramont', reservationId: enRetard.id, delayMinutes: 60, reasonId: 'late_customer' });
  ok(retard.status === 200 && retard.json.applied === true && (etat.reservations.get(enRetard.id) || {}).startTime === '12:00', 'MONTAGE retard de 60 min applique (200), la fete passe a 12:00, sa table sur 11:50-14:00',
    JSON.stringify(retard.json).slice(0, 400));
  const e10 = mailsDesTables();
  ok(e10.length === SECOURS_LIBRAMONT.length && memesAdresses(e10, SECOURS_LIBRAMONT) && aucuneInterdite(e10), '[E] un retard qui depasse la limite : un mail par adresse du centre', JSON.stringify(e10.map((m) => m.a)));

  ok(BASE.inconnues.every((q) => !/communications/.test(q)), 'MONTAGE la base en memoire a compris toutes les requetes des communications', BASE.inconnues.filter((q) => /communications/.test(q)).slice(0, 3).join(' | '));
}

// ---------------------------------------------------------------------------
// [H] LES DONNEES.
// ---------------------------------------------------------------------------
async function sectionDonnees() {
  section('H. LES DONNEES : LA CLE, LA FUSION, LE PROVISIONING');
  const n = (config, id = 'libramont') => centerConfig.normalizeCenterConfig(config, id).resources.partyTables;
  ok(JSON.stringify(n({})) === JSON.stringify({ softCapacity: 6, hardCapacity: 8, limitEnabled: false }), '[H] par defaut : 6 conseillees, limite 8, eteinte', JSON.stringify(n({})));
  ok(n({ resources: { partyTables: { softCapacity: 6, hardCapacity: 8, limitEnabled: true } } }).limitEnabled === true, '[H] allumee : la normalisation garde la cle');
  ok(n({ resources: { partyTables: { limitEnabled: 'true' } } }).limitEnabled === true && n({ resources: { partyTables: { limitEnabled: 'oui' } } }).limitEnabled === false, '[H] la cle se lit en booleen, illisible = eteinte');
  ok(n({ resources: { partyTables: null } }) === null, '[H] partyTables null reste null');
  const unCentreNeuf = n({ resources: { partyTables: { softCapacity: 6 } } }, 'centre-neuf-gate');
  ok(JSON.stringify(unCentreNeuf) === JSON.stringify({ softCapacity: 6, hardCapacity: 8, limitEnabled: false }), '[H] un centre provisionne (softCapacity seule) : limite 8, eteinte', JSON.stringify(unCentreNeuf));
  const deux = centerConfig.normalizeCenterConfig(centerConfig.normalizeCenterConfig({ resources: { partyTables: { softCapacity: 5, hardCapacity: 9, limitEnabled: true } } }, 'libramont'), 'libramont').resources.partyTables;
  ok(JSON.stringify(deux) === JSON.stringify({ softCapacity: 5, hardCapacity: 9, limitEnabled: true }), '[H] normaliser deux fois ne change rien', JSON.stringify(deux));
  await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: true });
  await enregistrerCentre('libramont', { accueil: { lateThresholdMinutes: 7 } });
  ok(knowledge.getCenter('libramont').resources.partyTables.limitEnabled === true, '[H] un enregistrement qui ne touche pas les tables garde l option');
  await enregistrerCentre('libramont', { resources: { partyTables: { softCapacity: 5 } } });
  const apres = knowledge.getCenter('libramont').resources.partyTables;
  ok(apres.limitEnabled === true && apres.hardCapacity === 8 && apres.softCapacity === 5, '[H] changer la capacite conseillee seule garde l option et la limite', JSON.stringify(apres));
}

// ---------------------------------------------------------------------------
// [I] LA FIN EST LA DERNIERE ACTIVITE POSEE (Movsar, 2026-10-15).
// ---------------------------------------------------------------------------
// La fin que dit la regle, recalculee sur le plan servi, sans le moteur : les
// activites a heure a leur heure, les parties de laser a la suite derriere la
// derniere partie posee, les activites libres que le moteur range dans un
// trou (freeGaps) y restent, les autres se jouent apres, bout a bout. Aucune
// minute entre deux etapes. `sansLaSuite` : la fin que la fermeture juge, les
// parties a la suite mises a part (lib/ops-engine, endWithoutPendingParties).
function finDeLaRegle(plan) {
  const etapes = (plan && plan.timeline) || [];
  const aHeure = etapes.filter((e) => e && e.type === 'activity' && !e.flexible && Number.isFinite(Number(e.end)));
  const lasers = aHeure.filter((e) => e.activityId === 'laser_game');
  const passes = (plan && plan.laserPassPlan) || {};
  const suite = lasers.length && (passes.pendingPasses || []).length ? Number(passes.followOnMinutes) || 0 : 0;
  const finAHeure = Math.max(...aHeure.map((e) => Number(e.end)));
  const finDeLaSuite = suite ? Math.max(...lasers.map((e) => Number(e.end))) + suite : 0;
  const libres = etapes.filter((e) => e && e.flexible).reduce((somme, e) => somme + (Number(e.durationMinutes) || 0), 0);
  const dansUnTrou = ((plan && plan.freeGaps) || []).flatMap((trou) => trou.items || []).reduce((somme, item) => somme + (Number(item.minutes) || 0), 0);
  return { fin: Math.max(finAHeure, finDeLaSuite) + libres - dansUnTrou, sansLaSuite: finAHeure + libres - dansUnTrou };
}
// La fin qu une heure servie annonce : arretee a la fermeture, le manque dit a part.
const finServie = (slot) => minutes(slot.visitEndTime) + (slot.visitEndsAtClose ? Number(slot.visitShortfallMinutes) || 0 : 0);
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

async function sectionFins() {
  section('I. LA FIN EST LA DERNIERE ACTIVITE POSEE');
  const api = require(path.join(ROOT, 'api/public-availability.js'));
  const { disponibiliteInterne } = require(path.join(ROOT, 'lib/disponibilite-interne.js'));
  const bookingConfig = require(path.join(ROOT, 'lib/booking-config.js'));
  // Un mercredi hors vacances : la fermeture se lit dans les horaires du centre.
  const MERCREDI = jourDeTest({ jour: 3, depuis: 3 });
  const horaire = bookingConfig.getSchedule(MERCREDI, knowledge.getCenter('libramont'));
  const fermeture = Math.round(Number(horaire && horaire.close) * 60);
  await poserCentreBrut('libramont', configAvantLeLot('libramont', SECOURS_LIBRAMONT));
  viderLaJournee();
  const demander = async (champs) => {
    const q = { centerId: 'libramont', date: MERCREDI };
    Object.entries(champs).forEach(([cle, valeur]) => { q[cle] = typeof valeur === 'string' ? valeur : JSON.stringify(valeur); });
    return (await disponibiliteInterne(q, { handler: api })).json || {};
  };
  const aHeure = (plan) => ((plan && plan.timeline) || []).filter((e) => e && e.type === 'activity' && !e.flexible).map((e) => `${e.activityId}@${e.startTime}`).sort().join(' ');
  ok(fermeture > 0, `MONTAGE le ${MERCREDI}, le centre ferme a ${hhmm(fermeture)}`);

  const cas = [
    { nom: 'la visite bowling 14:00 puis laser 15:00', posees: 'bowling@14:00 laser_game@15:00',
      champs: { type: 'visite', pax: '6', softReserve: '1', program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }], preferredTimes: { bowling: '14:00', laser_game: '15:00' }, laserGameTimes: ['15:00'] } },
    { nom: 'la Formule 4 « 60 min d arcades », bowling 16:00', posees: 'bowling@16:00',
      champs: { type: 'formule', formuleId: 'f4', pax: '6', formulaChoice: 'arcade60', preferredTimes: { bowling: '16:00' } } },
    { nom: 'la Formule 4, laser 14:00 et 15:00 puis bowling 16:00', posees: 'bowling@16:00 laser_game@14:00 laser_game@15:00',
      champs: { type: 'formule', formuleId: 'f4', pax: '14', preferredTimes: { laser_game: '14:00', bowling: '16:00' }, laserGameTimes: ['14:00', '15:00'] } },
  ];
  for (const c of cas) {
    const s = ((await demander(c.champs)).slots || [])[0] || null;
    const plan = s && s.opsPlan;
    ok(Boolean(plan) && aHeure(plan) === c.posees, `MONTAGE ${c.nom} : ses activites a heure sont posees (${c.posees})`, plan ? aHeure(plan) : 'aucune heure servie');
    if (!plan) continue;
    const regle = finDeLaRegle(plan);
    ok(finServie(s) === regle.fin, `[I] ${c.nom} : la visite finit a ${hhmm(finServie(s))}, la fin de sa derniere activite posee (${hhmm(regle.fin)}), ${finServie(s) - minutes(plan.arrivalTime)} min depuis l arrivee`,
      `servie ${hhmm(finServie(s))}, regle ${hhmm(regle.fin)}`);
  }

  const durees = (await demander({ type: 'durees', pax: '6' })).durees || {};
  for (const f of ['f1', 'f2', 'f3', 'f4', 'f5']) {
    const heures = (await demander({ type: 'formule', formuleId: f, pax: '6' })).slots || [];
    const ecarts = heures.filter((s) => finServie(s) !== finDeLaRegle(s.opsPlan).fin);
    ok(heures.length > 0 && ecarts.length === 0, `[I] ${f} : chacune de ses ${heures.length} heures servies finit a la fin de sa derniere activite posee`,
      ecarts.slice(0, 3).map((s) => `${s.time} : servie ${hhmm(finServie(s))}, regle ${hhmm(finDeLaRegle(s.opsPlan).fin)}`).join(' ; '));
    const quatorze = heures.find((s) => s.time === '14:00');
    const d = durees[f] || {};
    const surPlace = quatorze ? finDeLaRegle(quatorze.opsPlan).fin - minutes(quatorze.opsPlan.arrivalTime) : NaN;
    ok(d.min === d.max && d.min === surPlace, `[I] ${f} : la carte dit ${d.min} min sur place, de l arrivee a la fin de la derniere activite posee`, JSON.stringify({ carte: d, regle: surPlace }));
    const derniere = heures[heures.length - 1];
    const tient = derniere ? finDeLaRegle(derniere.opsPlan).sansLaSuite : NaN;
    ok(tient <= fermeture && tient + 30 > fermeture, `[I] ${f} : le dernier depart (${derniere && derniere.time}) est la derniere demi-heure dont les activites finissent avant la fermeture (${hhmm(tient)})`,
      `dernier depart ${derniere && derniere.time}, activites finies a ${hhmm(tient)}, fermeture ${hhmm(fermeture)}`);
  }

  // PAR HEURE D ARRIVEE (lib/ops-engine poserArrivee) : la visite est l accueil
  // puis chaque etape de sa frise, bout a bout (une etape a heure finit a son
  // heure, une autre dure ses minutes) ; elle finit avec la derniere. Sa duree
  // naturelle est l accueil et les minutes de chaque etape, l attente a part.
  for (const f of ['f1', 'f2', 'f3', 'f4', 'f5']) {
    const json = await demander({ type: 'formule', formuleId: f, pax: '6', arrival: '14:00' });
    const s = (json.slots || [])[0] || null;
    const plan = s && s.opsPlan;
    const frise = plan && plan.arrivalPlan && Array.isArray(plan.arrivalPlan.frise) ? plan.arrivalPlan.frise : [];
    const accueil = ((plan && plan.timeline) || []).find((e) => e && e.label === 'Arrivée & accueil');
    ok(frise.length > 0 && Boolean(accueil), `MONTAGE ${f}, arrivee 14:00 : le plan porte son accueil et sa frise`, JSON.stringify(json.arrival || json.message || null).slice(0, 300));
    if (!frise.length || !accueil) continue;
    let fin = minutes(accueil.endTime);
    for (const etape of frise) fin = etape.endTime ? minutes(etape.endTime) : fin + (Number(etape.minutes) || 0);
    ok(finServie(s) === fin, `[I] ${f}, arrivee 14:00 : la visite finit a ${hhmm(finServie(s))}, avec la derniere etape de sa frise (${hhmm(fin)})`, `servie ${hhmm(finServie(s))}, frise ${hhmm(fin)}`);
    const naturelle = (minutes(accueil.endTime) - minutes(accueil.startTime)) + frise.filter((etape) => etape.kind !== 'wait').reduce((somme, etape) => somme + (Number(etape.minutes) || 0), 0);
    ok(plan.arrivalPlan.naturalVisitMinutes === naturelle, `[I] ${f}, arrivee 14:00 : sa duree naturelle (${plan.arrivalPlan.naturalVisitMinutes} min) est l accueil et ses etapes, sans une minute de plus`,
      JSON.stringify({ moteur: plan.arrivalPlan.naturalVisitMinutes, etapes: naturelle }));
  }
}

// ---------------------------------------------------------------------------
// [F] ETABLISSEMENT ET [G] LA CONSOLE FONDATEUR, dans Edge.
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const PAGE_FONDATEUR = `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Gate tables</title>
<link rel="stylesheet" href="/assets/pinlane.css"><link rel="stylesheet" href="/assets/pinlane-staff.css"></head>
<body class="staff-mode"><main style="padding:32px 24px"><div id="staffCockpitPage"></div></main>
<script src="/assets/founder-centres.js"></script></body></html>`;
function servir(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/__fondateur') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(PAGE_FONDATEUR);
      return;
    }
    let fichier = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') fichier = path.join(ROOT, 'index.html');
    if (!fichier.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fichier, (err, contenu) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      let corps = contenu;
      if (MUTATION && MUTATION.fichier.startsWith('assets/') && path.resolve(fichier) === path.resolve(ROOT, MUTATION.fichier)) corps = muter(contenu.toString('utf8'), MUTATION);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(corps);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server)); });
}

async function sectionsEcrans() {
  const ops = require(path.join(ROOT, 'api/ops.js'));
  const { chromium } = require('playwright-core');
  const PORT = Number(process.env.PINLANE_TABLES_PORT || 4519);
  const BASE_URL = `http://127.0.0.1:${PORT}`;
  const server = await servir(PORT);
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const erreurs = [];
  const configServie = async () => {
    const rep = await appeler(ops, 'GET', '/api/ops?action=centerConfig&centerId=libramont');
    return rep.json;
  };
  const enregistrerParLeServeur = async (config) => {
    const rep = await appeler(ops, 'POST', '/api/ops', { action: 'saveCenterConfig', centerId: 'libramont', config });
    return rep;
  };
  async function ouvrirEtablissement(cle) {
    const config = await configServie();
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    page.on('pageerror', (e) => erreurs.push(`${cle} PAGEERROR ${e.message}`));
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await page.addInitScript(({ expiresAt, CENTER_CONFIG }) => {
      const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'direction.view', 'centers.switch'];
      const session = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Gate', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
      const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: 'qa-fixe' } });
      const natif = window.fetch.bind(window);
      window.__QA_SAVED__ = [];
      window.fetch = async (input, init = {}) => {
        const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', window.location.origin);
        const methode = String(init.method || 'GET').toUpperCase();
        if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Gate', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
        if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' });
        if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: '2026-10-15', durationOptions: [], formules: [], center: { id: 'libramont', status: 'active' } });
        if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
        if (u.pathname === '/api/ops' && methode === 'POST') { window.__QA_SAVED__.push(JSON.parse(init.body || '{}')); return J({ ok: true }); }
        if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'centerConfig') return J(CENTER_CONFIG);
        if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {}, blocks: [] });
        return natif(input, init);
      };
      window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
    }, { expiresAt, CENTER_CONFIG: config });
    await page.goto(`${BASE_URL}/?v=tables-${cle}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.renderStaffUtilityPage === 'function', null, { timeout: 20000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'establishment';
      state.establishmentTab = 'centre';
      state.establishmentEditing = false;
      save();
      setView('staff');
    });
    await page.waitForSelector('.estab-tabs button', { state: 'visible', timeout: 20000 });
    return page;
  }
  const tuileTables = (page) => page.evaluate(() => {
    const tuile = Array.from(document.querySelectorAll('.estab-stat')).find((el) => /Tables/.test((el.querySelector('.estab-stat-top') || {}).textContent || ''));
    return tuile ? tuile.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  const lireBascule = (page) => page.evaluate(() => {
    const bascule = document.getElementById('estab-tableLimit');
    const carte = bascule ? bascule.closest('fieldset') : null;
    return {
      existe: Boolean(bascule),
      cochee: Boolean(bascule && bascule.checked),
      phrases: carte ? Array.from(carte.querySelectorAll('.estab-card-hint')).map((p) => p.textContent.replace(/\s+/g, ' ').trim()) : [],
      limite: (document.getElementById('estab-tableHard') || {}).value || '',
      conseillee: (document.getElementById('estab-tableSoft') || {}).value || '',
    };
  });
  const enregistrerLaPage = (page) => page.evaluate(async () => {
    window.__QA_SAVED__ = [];
    await submitCenterConfig('libramont');
    return (window.__QA_SAVED__.find((b) => b.action === 'saveCenterConfig') || {}).config || null;
  });

  try {
    section('F. ETABLISSEMENT : LA BASCULE « LIMITE DE TABLES »');
    await poserCentreBrut('libramont', configAvantLeLot('libramont', SECOURS_LIBRAMONT));
    let page = await ouvrirEtablissement('defaut');
    const tuileEteinte = await tuileTables(page);
    ok(/Tables/.test(tuileEteinte) && !/\b8\b/.test(tuileEteinte), '[F] lecture, eteinte : la tuile des tables n annonce aucune limite', tuileEteinte);
    await page.evaluate(() => startEstablishmentEdit());
    await page.waitForSelector('#estab-tableLimit', { state: 'attached', timeout: 10000 });
    let b = await lireBascule(page);
    ok(b.existe && b.cochee === false, '[F] eteinte par defaut (donnees d avant ce lot)', JSON.stringify(b));
    ok(b.phrases.some((p) => /jamais/i.test(p) && /bloqu/i.test(p)), '[F] la phrase de la bascule dit que rien n est jamais bloque', JSON.stringify(b.phrases));
    ok(!b.phrases.some((p) => /aucun mail/i.test(p)), '[F] avec une adresse de secours, aucune mise en garde d envoi', JSON.stringify(b.phrases));
    ok(b.limite === '8' && b.conseillee === '6', 'MONTAGE les nombres affiches : 6 conseillees, limite 8', JSON.stringify(b));
    let envoye = await enregistrerLaPage(page);
    ok(Boolean(envoye) && JSON.stringify(envoye.resources && envoye.resources.partyTables) === JSON.stringify({ softCapacity: 6, hardCapacity: 8, limitEnabled: false }), '[F] enregistrer sans retouche envoie les memes nombres et la bascule eteinte', JSON.stringify(envoye && envoye.resources && envoye.resources.partyTables));
    let rep = await enregistrerParLeServeur(envoye);
    let tables = knowledge.getCenter('libramont').resources.partyTables;
    ok(rep.status === 200 && tables.softCapacity === 6 && tables.hardCapacity === 8 && tables.limitEnabled === false, '[F] cote serveur : rien n a change, eteinte', JSON.stringify({ statut: rep.status, tables, message: rep.json && rep.json.message }));
    // L enregistrement referme l edition : on la rouvre, comme le gerant.
    await page.evaluate(() => { if (!document.getElementById('estab-tableLimit')) startEstablishmentEdit(); });
    await page.waitForSelector('label.establishment-toggle:has(#estab-tableLimit)', { state: 'visible', timeout: 10000 });
    await page.click('label.establishment-toggle:has(#estab-tableLimit)');
    b = await lireBascule(page);
    ok(b.cochee === true, 'MONTAGE un clic sur « Limite de tables » l allume', JSON.stringify(b));
    envoye = await enregistrerLaPage(page);
    rep = await enregistrerParLeServeur(envoye);
    tables = knowledge.getCenter('libramont').resources.partyTables;
    ok(rep.status === 200 && tables.limitEnabled === true && tables.hardCapacity === 8 && tables.softCapacity === 6, '[F] allumee et enregistree : la normalisation la garde, les nombres ne bougent pas', JSON.stringify({ statut: rep.status, tables }));
    await page.close();

    page = await ouvrirEtablissement('allumee');
    const tuileAllumee = await tuileTables(page);
    ok(/\b8\b/.test(tuileAllumee), '[F] lecture, allumee : la tuile dit la limite (8)', tuileAllumee);
    await page.evaluate(() => startEstablishmentEdit());
    await page.waitForSelector('#estab-tableLimit', { state: 'attached', timeout: 10000 });
    b = await lireBascule(page);
    ok(b.cochee === true, '[F] relue du serveur, la bascule est allumee', JSON.stringify(b));
    envoye = await enregistrerLaPage(page);
    rep = await enregistrerParLeServeur(envoye);
    tables = knowledge.getCenter('libramont').resources.partyTables;
    ok(tables.limitEnabled === true && tables.hardCapacity === 8 && tables.softCapacity === 6, '[F] enregistrer sans retouche garde l option allumee et les nombres', JSON.stringify(tables));
    await page.close();

    await centreAvecLimite('libramont', [], { allumee: true });
    page = await ouvrirEtablissement('sans-adresse');
    await page.evaluate(() => startEstablishmentEdit());
    await page.waitForSelector('#estab-tableLimit', { state: 'attached', timeout: 10000 });
    b = await lireBascule(page);
    ok(b.phrases.some((p) => /aucun mail/i.test(p)), '[F] sans adresse de secours, la bascule dit qu aucun mail ne partira', JSON.stringify(b.phrases));
    await page.close();

    section('G. LA CONSOLE FONDATEUR NE L ETEINT PAS');
    await centreAvecLimite('libramont', SECOURS_LIBRAMONT, { allumee: true });
    const paquet = (await appeler(ops, 'GET', '/api/ops?action=founderCenters')).json;
    const fiche = ((paquet && paquet.centers) || []).find((c) => c.id === 'libramont') || {};
    ok(fiche.config && fiche.config.resources && fiche.config.resources.partyTables && fiche.config.resources.partyTables.limitEnabled === true, 'MONTAGE la console fondateur recoit la limite allumee', JSON.stringify(fiche.config && fiche.config.resources && fiche.config.resources.partyTables));
    const fp = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    fp.on('pageerror', (e) => erreurs.push(`fondateur PAGEERROR ${e.message}`));
    await fp.addInitScript((PAQUET) => {
      window.__ecritures = [];
      window.showAlert = function () {};
      window.escapeHtml = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); };
      window.apiRequest = function (url, opts) {
        if (opts && opts.method === 'POST') { window.__ecritures.push(JSON.parse(opts.body || '{}')); return Promise.resolve({ ok: true }); }
        return Promise.resolve(JSON.parse(JSON.stringify(PAQUET)));
      };
    }, paquet);
    await fp.goto(`${BASE_URL}/__fondateur?ts=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await fp.waitForFunction(() => typeof window.renderFounderCentresPage === 'function', null, { timeout: 10000 });
    await fp.evaluate(() => window.renderFounderCentresPage(document.getElementById('staffCockpitPage')));
    await fp.click('button[onclick="fcaOpenConfig(\'libramont\')"]', { timeout: 10000 });
    const champ = 'input[oninput*="resources.partyTables.softCapacity"]';
    await fp.waitForSelector(champ, { timeout: 10000 });
    await fp.fill(champ, '5');
    await fp.click('button[onclick="fcaSave()"]');
    await fp.waitForFunction(() => window.__ecritures.length > 0, null, { timeout: 10000 });
    const ecriture = await fp.evaluate(() => window.__ecritures.find((e) => e.action === 'saveCenterConfig') || null);
    ok(Boolean(ecriture) && ecriture.config && ecriture.config.resources && ecriture.config.resources.partyTables && ecriture.config.resources.partyTables.softCapacity === 5,
      'MONTAGE la console fondateur envoie la nouvelle capacite conseillee (5)', JSON.stringify(ecriture));
    const repFondateur = await appeler(ops, 'POST', '/api/ops', { action: 'saveCenterConfig', centerId: 'libramont', config: (ecriture && ecriture.config) || {} });
    const apresFondateur = knowledge.getCenter('libramont').resources.partyTables;
    ok(repFondateur.status === 200 && apresFondateur.limitEnabled === true && apresFondateur.hardCapacity === 8 && apresFondateur.softCapacity === 5,
      '[G] la console fondateur change la capacite conseillee : la limite reste allumee, a 8', JSON.stringify({ statut: repFondateur.status, apresFondateur }));
    await fp.close();
    ok(erreurs.length === 0, '[F][G] aucune erreur de page', erreurs.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  await sectionDonnees();
  await sectionMoteur();
  await sectionRetard();
  await sectionPublicEtComptoir();
  await sectionMails();
  await sectionFins();
  await sectionsEcrans();
  console.log(echecs
    ? `\ntables-sans-blocage-check: ${echecs} defaut(s).`
    : '\ntables-sans-blocage-check: ALL OK (les tables ne bloquent jamais : moteur, API publique, blocage, comptoir, retard ; la limite eteinte ne compte rien, allumee elle previent le centre une fois, a ses adresses ; la fin est la derniere activite posee)');
  process.exit(echecs ? 1 : 0);
}

// ---------------------------------------------------------------------------
// LE DIFFERENTIEL.
// ---------------------------------------------------------------------------
async function differentiel() {
  const engine = require(path.join(ROOT, 'lib/ops-engine.js'));
  const api = require(path.join(ROOT, 'api/public-availability.js'));
  const { disponibiliteInterne } = require(path.join(ROOT, 'lib/disponibilite-interne.js'));
  const { planifierPourLaFenetre } = require(path.join(ROOT, 'lib/reserver-fenetre.js'));
  const crypto = require('crypto');
  const empreinte = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);
  const formules = (knowledge.loadOpsKnowledge().formulas || []).map((f) => f.id);
  const plansVides = new Map();
  const vide = (f, heure, pax) => {
    const cle = `${f}|${heure}|${pax}`;
    if (!plansVides.has(cle)) plansVides.set(cle, (engine.planReservation({ centerId: 'libramont', date: JOUR, type: 'formule', formuleId: f, pax, startTime: heure }, { reservations: [], laneStatuses: {} }) || {}).recommended || null);
    return plansVides.get(cle);
  };
  let id = 900;
  const dossier = (f, heure, pax = 10) => {
    id += 1;
    const plan = vide(f, heure, pax);
    return { id, name: `Diff ${id}`, date: JOUR, centerId: 'libramont', startTime: heure, status: 'confirmed', validationStatus: 'confirmed', type: 'formule', formuleId: f, pax, lanes: plan ? plan.assignedLanes || [] : [], opsPlan: plan, duration: 2, totalDuration: 2, channel: 'staff' };
  };
  const repeter = (n, f, heure) => Array.from({ length: n }, () => dossier(f, heure));
  const contextes = {
    vide: [],
    septTablesEtPistes: [...repeter(7, 'f6', '14:00'), dossier('f1', '14:00', 12), dossier('f1', '16:00', 12)],
    huitTables: repeter(8, 'f6', '14:00'),
    douzeTablesLeMatin: [...repeter(12, 'f6', '10:30'), dossier('f1', '15:00', 12)],
  };
  const tablesDuContexte = (ctx) => ctx.flatMap((r) => tablesDe(r.opsPlan).map((b) => [minutes(b.startTime), minutes(b.endTime), r.id]));
  const variantes = {
    eteinte: { resources: { partyTables: { softCapacity: 6, hardCapacity: 8, limitEnabled: false } } },
    allumee: { resources: { partyTables: { softCapacity: 6, hardCapacity: 8, limitEnabled: true } } },
    sansTables: { resources: { partyTables: null } },
  };
  const heures = ['10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30', '17:30', '18:30', '19:30', '20:30'];
  const cas = [];
  const noter = (cle, valeur, fen, ctx, sans = null) => cas.push({ cle, h: empreinte(valeur), ok: valeur && valeur.ok !== false, conflitTable: JSON.stringify(valeur || {}).includes('table_conflict'), fenetres: fen, contexte: ctx, sans });
  for (const [nomVariante, variante] of Object.entries(variantes)) {
    await poserCentreBrut('libramont', variante);
    for (const [nomCtx, ctx] of Object.entries(contextes)) {
      for (const f of formules) {
        for (const heure of heures) {
          for (const pax of [8, 16]) {
            const p = engine.planReservation({ centerId: 'libramont', date: JOUR, type: 'formule', formuleId: f, pax, startTime: heure }, { reservations: clone(ctx), laneStatuses: {} });
            const fen = [p.recommended, ...((p && p.scenarios) || [])].filter(Boolean).flatMap((s) => tablesDe(s)).map((b) => [minutes(b.startTime), minutes(b.endTime)]);
            noter(`plan|${nomVariante}|${nomCtx}|${f}|${heure}|${pax}`, p, fen, nomCtx);
          }
        }
      }
      viderLaJournee();
      poserDossiers(ctx);
      for (const f of formules) {
        const rep = await disponibiliteInterne({ centerId: 'libramont', date: JOUR, pax: '10', type: 'formule', formuleId: f }, { handler: api });
        const fen = (((rep.json || {}).slots) || []).flatMap((s) => tablesDe(s.opsPlan)).map((b) => [minutes(b.startTime), minutes(b.endTime)]);
        noter(`heures|${nomVariante}|${nomCtx}|${f}`, rep, fen, nomCtx);
      }
      for (const f of ['f1', 'f4', 'f6', 'f7', 'f8']) {
        for (const heure of ['11:00', '14:00', '17:00']) {
          const p = await planifierPourLaFenetre({ centerId: 'libramont', date: JOUR, pax: 10, startTime: heure, type: 'formule', formuleId: f, name: 'Diff', phone: '', email: '' },
            { authorizedCenterId: 'libramont' }, { readState: async () => ({ reservations: clone(ctx), laneStatuses: {} }) });
          const resume = { conflits: p.conflits, aPlacer: p.aPlacer, plan: p.plan, opsPlan: p.dossier && p.dossier.opsPlan };
          noter(`comptoir|${nomVariante}|${nomCtx}|${f}|${heure}`, resume, tablesDe(p.dossier && p.dossier.opsPlan).map((b) => [minutes(b.startTime), minutes(b.endTime)]), nomCtx);
        }
      }
      for (const r of ctx.slice(0, 4)) {
        for (const delayMinutes of [10, 30, 60]) {
          let impact = null;
          try { impact = engine.computeDelayImpact({ centerId: 'libramont', date: JOUR, reservationId: r.id, delayMinutes, reasonId: 'late_customer' }, { reservations: clone(ctx), laneStatuses: {} }); } catch (error) { impact = { erreur: error.message }; }
          const fen = ((impact && impact.strategies) || []).flatMap((s) => (s.changes || []).flatMap((c) => tablesDe(c.update && c.update.opsPlan))).map((b) => [minutes(b.startTime), minutes(b.endTime)]);
          noter(`retard|${nomVariante}|${nomCtx}|${r.id}|${delayMinutes}`, impact, fen, nomCtx, r.id);
        }
      }
    }
  }
  const tablesParContexte = Object.fromEntries(Object.entries(contextes).map(([nom, ctx]) => [nom, tablesDuContexte(ctx)]));
  console.log(`DIFFERENTIEL:${JSON.stringify({ jour: JOUR, cas, tablesParContexte })}`);
}

function lancerDifferentiel(commit) {
  const lire = (args) => {
    const run = spawnSync(process.execPath, [__filename, '--differentiel', ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: { ...process.env, PINLANE_TABLES_MUTATION: '' } });
    const ligne = String(run.stdout || '').split(/\r?\n/).find((l) => l.startsWith('DIFFERENTIEL:'));
    if (run.status !== 0 || !ligne) {
      console.error(`differentiel impossible (${args.join(' ') || 'code courant'}) : code ${run.status}\n${String(run.stderr || '').slice(0, 2000)}`);
      process.exit(2);
    }
    return JSON.parse(ligne.slice('DIFFERENTIEL:'.length));
  };
  const actuel = lire([]);
  const avant = lire(['--sources', commit]);
  const parCle = new Map(avant.cas.map((c) => [c.cle, c]));
  // Un cas est TOUCHE quand une de ses tables chevauche au moins 8 tables du
  // contexte (la limite de 8 du socle) : la neuvieme etait refusee avant.
  const touche = (c) => {
    const autres = (actuel.tablesParContexte[c.contexte] || []).filter(([, , proprietaire]) => proprietaire !== c.sans);
    return (c.fenetres || []).some(([d, f]) => autres.filter(([d2, f2]) => d < f2 && d2 < f).length + 1 > 8);
  };
  let identiques = 0;
  const touches = [];
  const ecarts = [];
  for (const c of actuel.cas) {
    const b = parCle.get(c.cle);
    if (b && b.h === c.h) { identiques += 1; continue; }
    if (touche(c)) touches.push({ c, b });
    else ecarts.push(c.cle);
  }
  const touchesMalExpliques = touches.filter(({ c, b }) => c.conflitTable || !b || !(b.conflitTable || b.ok === false || b.h !== c.h));
  console.log(`differentiel contre ${commit} (jour ${actuel.jour}) : ${actuel.cas.length} cas, ${identiques} identiques a l octet, ${touches.length} touches par un depassement, ${ecarts.length} ecart(s) sans depassement`);
  const parFamille = (liste) => liste.reduce((acc, cle) => { const famille = cle.split('|')[0]; acc[famille] = (acc[famille] || 0) + 1; return acc; }, {});
  console.log(`  touches par famille : ${JSON.stringify(parFamille(touches.map(({ c }) => c.cle)))}`);
  console.log(`  touches ou le code d avant portait un conflit de tables : ${touches.filter(({ b }) => b && b.conflitTable).length}`);
  if (ecarts.length) console.log(`  ecarts sans depassement (5 premiers) : ${ecarts.slice(0, 5).join(' ; ')}`);
  if (touchesMalExpliques.length) console.log(`  touches qui portent encore un conflit de tables : ${touchesMalExpliques.slice(0, 5).map(({ c }) => c.cle).join(' ; ')}`);
  const vert = actuel.cas.length === avant.cas.length && ecarts.length === 0 && touches.every(({ c }) => !c.conflitTable);
  console.log(vert ? '\ntables-sans-blocage-check --base: ALL OK (sans depassement, tout est identique a l octet)' : '\ntables-sans-blocage-check --base: ECART');
  process.exit(vert ? 0 : 1);
}

if (process.argv.includes('--mutate')) {
  // Les mutations se jouaient une par une (spawnSync) ; un pool de fils
  // (PINLANE_ECLATS, defaut 6), chacun sur son port, rend les MEMES verdicts,
  // imprimes dans l ordre des mutations (2026-10-19).
  const eclats = require('./gates-eclats');
  const PORT = Number(process.env.PINLANE_TABLES_PORT || 4519);
  eclats.enPool(MUTATIONS, eclats.nombreDeFils(MUTATIONS.length), async (m, fil, i) => { const debut = Date.now(); const run = await eclats.lancer(__filename, [], { env: { ...process.env, PINLANE_TABLES_PORT: String(PORT + 1 + fil), PINLANE_TABLES_MUTATION: String(i + 1) } }); return { ...run, debut, fin: Date.now() }; }).then((runs) => {
  let tuees = 0;
  MUTATIONS.forEach((m, i) => {
    const run = runs[i];
    const debut = Date.now() - (run.fin - run.debut);
    const sortie = `${run.stdout || ''}${run.stderr || ''}`;
    const servie = sortie.indexOf(MUTATION_PREUVE) >= 0;
    const tuee = servie && run.status === 1;
    if (tuee) tuees += 1;
    const rouges = sortie.split(/\r?\n/).filter((l) => l.startsWith('FAIL')).length;
    console.log(`${tuee ? 'TUEE   ' : 'SURVIT '} ${m.nom}${servie ? '' : ' (mutation non servie)'}${tuee ? `  [${rouges} rouge(s), ${Math.round((Date.now() - debut) / 1000)} s]` : `  [code ${run.status}]`}`);
  });
  console.log(tuees === MUTATIONS.length ? `\ntables-sans-blocage-check --mutate: ${tuees}/${MUTATIONS.length} mutations tuees` : `\ntables-sans-blocage-check --mutate: ${MUTATIONS.length - tuees} mutation(s) survivante(s)`);
  process.exit(tuees === MUTATIONS.length ? 0 : 1);
  });
} else if (process.argv.includes('--base')) {
  if (!argApres('--base')) {
    console.error('usage : node scripts/tables-sans-blocage-check.js --base <commit qui precede les tables>');
    process.exit(2);
  }
  lancerDifferentiel(argApres('--base'));
} else if (process.argv.includes('--differentiel')) {
  differentiel().catch((error) => { console.error(error); process.exit(1); });
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}

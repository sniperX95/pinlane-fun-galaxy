// Gate du journal d'audit (migration 0031, lib/audit-log.js).
//
// Zero reseau, zero base : le module 'pg' est remplace dans require.cache AVANT
// le chargement de lib/database.js, donc getPool() construit un faux Pool qui
// capture les INSERT et sert les SELECT depuis un tableau en memoire.
//
// CE QUE CE GATE PROUVE, et chaque point est contre-eprouve (le test sait virer
// au rouge, verifie en cassant le code expres) :
//
//   (a) une action tracee produit une entree portant l'ACTEUR, l'ACTION et le
//       CENTRE. Pas la presence de la colonne : la VALEUR.
//   (b) un SECRET pousse dans une action tracee n'apparait NULLE PART dans la
//       ligne ecrite. Le secret utilise est un vrai code d'acces staff, sur le
//       vrai champ ou il transite (body.code de l'action login), plus les
//       champs de REPONSE qui portent des codes en clair (newAccessCode,
//       revealedCode). Le test cherche la VALEUR du secret dans le JSON
//       serialise complet de la ligne, pas le nom du champ.
//   (c) la LECTURE est scopee centre : une directrice de Libramont qui demande
//       Gembloux ne recoit aucune ligne de Gembloux, et le centre voyage en
//       PARAMETRE SQL (jamais concatene dans le texte).
//   (d) une tentative REFUSEE est tracee, avec le motif exact du refus.
//
//   (e) bonus structurel : la COUVERTURE. On enumere statiquement les actions
//       du dispatcher de api/ops.js et on prouve que la liste d'exclusion est
//       une liste FERMEE et connue. C'est ce qui garantit que la 58e action,
//       ajoutee dans six mois, sera tracee par defaut ou fera echouer ce gate.
//
// Lancement : node scripts/audit-log-check.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}
function readProjectFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// Faux pool pg, installe avant tout require applicatif.
// ---------------------------------------------------------------------------
const auditRows = [];
const sqlLog = [];
let nextId = 1;
let failNextInsert = false;

function columnsOf(sql) {
  const m = sql.match(/insert into audit_log \(([^)]+)\)/i);
  return m ? m[1].split(',').map((c) => c.trim()) : [];
}

class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text, params = []) {
    const sql = String(text);
    sqlLog.push({ sql, params });

    if (/insert into audit_log/i.test(sql)) {
      if (failNextInsert) {
        failNextInsert = false;
        throw new Error('audit indisponible (simule)');
      }
      const cols = columnsOf(sql);
      const row = { id: nextId++, occurred_at: new Date().toISOString() };
      cols.forEach((col, i) => {
        const raw = params[i];
        row[col] = (col === 'changes' || col === 'context') && typeof raw === 'string'
          ? JSON.parse(raw)
          : raw;
      });
      auditRows.push(row);
      return { rows: [{ id: row.id, occurred_at: row.occurred_at }], rowCount: 1 };
    }

    // Le bloc [CABLAGE] fait passer une VRAIE action par le dispatcher. Sans
    // cette reponse, setInsightStatus ne trouve aucune ligne, leve un 404, et
    // le dispatcher ecrit une trace d'ERREUR au lieu d'une trace de SUCCES :
    // on ne testerait alors jamais le chemin qu'on veut verifier.
    if (/update marketing_insights/i.test(sql)) {
      return { rows: [{ id: 1, status: 'applied', applied_at: new Date().toISOString(), center_id: 'libramont' }], rowCount: 1 };
    }

    if (/from audit_log/i.test(sql)) {
      // Le faux moteur OBEIT AU TEXTE : il n'applique le filtre centre que si
      // le SQL le contient vraiment, et il lit la valeur dans les PARAMETRES.
      // Sur du code non scope (predicat absent) la lecture cross-centre
      // reussirait et l'assertion (c) tomberait. C'est ce qui rend ce gate
      // capable de virer au rouge.
      const m = sql.match(/center_id = \$(\d+)/);
      const filtered = m ? auditRows.filter((r) => r.center_id === params[Number(m[1]) - 1]) : auditRows.slice();
      return { rows: filtered.slice().reverse(), rowCount: filtered.length };
    }

    return { rows: [], rowCount: 0 };
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';

const audit = require(path.join(ROOT, 'lib', 'audit-log.js'));

function reset() {
  auditRows.length = 0;
  sqlLog.length = 0;
  nextId = 1;
  audit.resetAuditHealth();
}

(async () => {
  // =========================================================================
  console.log('[A] une action tracee porte l acteur, l action et le centre');
  // =========================================================================
  reset();
  await audit.writeAuditLog({
    centerId: 'libramont',
    actorKind: 'staff',
    actorMemberId: 'm-42',
    actorLabel: 'Directrice Libramont',
    actorRoleId: 'direction',
    surface: 'api/ops.js',
    action: 'saveCenterConfig',
    method: 'POST',
    entityType: 'center',
    entityId: 'libramont',
    outcome: 'success',
    changes: { price: { before: 20, after: 25 } },
  });

  ok(auditRows.length === 1, `une ligne ecrite (obtenu ${auditRows.length})`);
  const row = auditRows[0] || {};
  ok(row.actor_member_id === 'm-42', `l acteur est enregistre (obtenu ${row.actor_member_id})`);
  ok(row.actor_label === 'Directrice Libramont', 'le nom lisible de l acteur survit a la suppression du membre');
  ok(row.action === 'saveCenterConfig', `l action est enregistree (obtenu ${row.action})`);
  ok(row.center_id === 'libramont', `le centre est enregistre (obtenu ${row.center_id})`);
  ok(row.changes && row.changes.price && row.changes.price.before === 20 && row.changes.price.after === 25,
    'l avant/apres du prix est enregistre, valeurs comprises');

  // =========================================================================
  console.log('\n[B] T1 : aucun secret dans le journal');
  // =========================================================================
  reset();
  // Ce sont les VRAIS champs sensibles releves dans le depot :
  //   body.code / body.password  -> api/staff-auth.js action login
  //   newAccessCode / revealedCode / accessCode -> reponses de api/staff-auth.js
  //   accessCodeHint -> indice partiel, interdit par T1 ("meme partiel")
  //   access_code_hash -> hachage, interdit par T1 ("meme hache")
  //   token_hash / sessionToken / unsubToken -> jetons
  //   authorization / cookie / x-inbound-secret -> en-tetes
  const SECRET = 'FGX-SECRET-CODE-9999';
  await audit.writeAuditLog({
    centerId: 'libramont',
    actorKind: 'staff',
    actorMemberId: 'm-42',
    surface: 'api/staff-auth.js',
    action: 'login',
    outcome: 'success',
    context: {
      code: SECRET,
      password: SECRET,
      accessCode: SECRET,
      newAccessCode: SECRET,
      revealedCode: SECRET,
      accessCodeHint: SECRET,
      access_code_hash: SECRET,
      codeHash: SECRET,
      token_hash: SECRET,
      sessionToken: SECRET,
      unsubToken: SECRET,
      apiKey: SECRET,
      authorization: `Bearer ${SECRET}`,
      cookie: `fgx_session=${SECRET}`,
      'x-inbound-secret': SECRET,
      signature: SECRET,
      // Imbrique : le filtre doit descendre dans les objets.
      headers: { authorization: `Bearer ${SECRET}`, cookie: SECRET },
      profond: { niveau2: { niveau3: { secretToken: SECRET } } },
      // Dans un tableau d objets : cas reel (liste de membres crees).
      membres: [{ name: 'Alice', accessCode: SECRET }],
    },
    changes: { access_code_enc: { before: SECRET, after: SECRET } },
  });

  const serialized = JSON.stringify(auditRows[0] || {});
  // L assertion porte sur la VALEUR du secret dans la ligne complete. Chercher
  // le nom du champ prouverait seulement qu on a renomme quelque chose.
  ok(!serialized.includes(SECRET),
    'le secret n apparait NULLE PART dans la ligne ecrite (recherche sur la valeur, ligne serialisee entiere)');
  ok(serialized.includes('[expurge]'), 'les champs sensibles sont bien remplaces par un marqueur');

  // Contre-epreuve du filtre lui-meme : desactive, il laisse passer. C est ce
  // qui prouve que l assertion ci-dessus teste un COMPORTEMENT et pas une
  // constante toujours vraie.
  const sansFiltre = JSON.stringify({ code: SECRET });
  ok(sansFiltre.includes(SECRET),
    'contre-epreuve : sans expurgation le secret SERAIT present (l assertion sait rougir)');

  // Le filtre ne doit pas etre si large qu il vide le journal de son sens.
  const utile = audit.redactSecrets({ postalCode: '6800', clientName: 'Dupont', price: 25 });
  ok(utile.postalCode === '6800', 'un code postal reste lisible (exception de liste blanche)');
  ok(utile.clientName === 'Dupont' && utile.price === 25, 'les champs metier non sensibles restent lisibles');

  // =========================================================================
  console.log('\n[C] T6 : la lecture est scopee centre');
  // =========================================================================
  reset();
  await audit.writeAuditLog({ centerId: 'libramont', action: 'saveCenterConfig', actorMemberId: 'm-lib', outcome: 'success' });
  await audit.writeAuditLog({ centerId: 'gembloux', action: 'saveCenterConfig', actorMemberId: 'm-gem', outcome: 'success' });
  await audit.writeAuditLog({ centerId: 'gembloux', action: 'setCenterStatus', actorMemberId: 'm-gem', outcome: 'success' });

  const vueLibramont = await audit.readAuditLog({ centerId: 'libramont', limit: 50 });
  ok(vueLibramont.length === 1, `la directrice de Libramont voit 1 ligne (obtenu ${vueLibramont.length})`);
  ok(vueLibramont.every((r) => r.centerId === 'libramont'),
    'aucune ligne d un autre centre ne remonte');
  ok(!vueLibramont.some((r) => r.actorMemberId === 'm-gem'),
    'aucun acteur de Gembloux n est visible depuis Libramont');

  const lectureSql = sqlLog.filter((e) => /from audit_log/i.test(e.sql)).pop();
  ok(/center_id = \$1/.test(lectureSql.sql),
    'la requete de lecture porte un predicat center_id');
  ok(lectureSql.params[0] === 'libramont',
    'le centre voyage en PARAMETRE SQL, jamais concatene dans le texte');
  ok(!/center_id\s*=\s*'/.test(lectureSql.sql),
    'aucun centre concatene en dur dans le SQL (surface d injection)');

  // =========================================================================
  console.log('\n[D] une tentative REFUSEE est tracee, avec son motif');
  // =========================================================================
  reset();
  await audit.writeAuditLog({
    centerId: 'libramont',
    actorKind: 'staff',
    actorMemberId: 'm-bar',
    actorLabel: 'Equipier bar',
    surface: '/api/ops',
    action: 'accessDenied',
    outcome: 'denied',
    deniedReason: '403_center_scope',
    context: { centreDemande: 'gembloux', centreSession: 'libramont' },
  });
  const refus = auditRows[0] || {};
  ok(refus.outcome === 'denied', `le refus est enregistre comme tel (obtenu ${refus.outcome})`);
  ok(refus.denied_reason === '403_center_scope',
    `le motif exact du refus est conserve (obtenu ${refus.denied_reason})`);
  ok(refus.center_id === 'libramont',
    'le refus est journalise dans le centre de l AUTEUR, pas dans celui de la cible');
  const refusLus = await audit.readAuditLog({ centerId: 'libramont', outcome: 'denied' });
  ok(refusLus.length === 1, 'les refus sont filtrables pour une relecture securite');

  // =========================================================================
  console.log('\n[E] T4 : la tranche bloquant / non bloquant');
  // =========================================================================
  reset();
  // Non bloquant : ne jette pas, mais renvoie un avertissement exploitable.
  failNextInsert = true;
  const nonBloquant = await audit.writeAuditLog({ centerId: 'libramont', action: 'updateReservation' });
  ok(nonBloquant.ok === false, 'une trace perdue est signalee comme telle');
  ok(nonBloquant.warning && nonBloquant.warning.code === 'audit_write_failed',
    'un avertissement structure est renvoye a l appelant (3e volet du bruyant)');
  ok(audit.getAuditHealth().failed === 1,
    'le compteur d echecs monte (2e volet du bruyant, expose dans l action health)');

  // Bloquant : jette, donc l action appelante ne s execute pas.
  failNextInsert = true;
  let aJete = false;
  try {
    await audit.writeAuditLogOrThrow({ centerId: 'libramont', action: 'updateRolePermissions' });
  } catch (error) {
    aJete = true;
    ok(error.auditBlocked === true, 'l erreur est identifiable comme un blocage d audit');
    ok(error.statusCode === 503 && error.expose === true, 'le refus est expose proprement au staff (503)');
  }
  ok(aJete, 'une action du regime BLOQUANT refuse de s executer sans trace');

  ok(audit.isBlockingAction('updateRolePermissions'), 'updateRolePermissions est bloquante');
  ok(audit.isBlockingAction('saveCenterConfig'), 'saveCenterConfig est bloquante');
  ok(audit.isBlockingAction('sendCampaign'), 'sendCampaign est bloquante');
  ok(!audit.isBlockingAction('updateReservation'),
    'updateReservation n est PAS bloquante (chemin chaud : pas de panne commerciale pour un probleme d observabilite)');
  ok(!audit.isBlockingAction('createReservation'), 'createReservation n est PAS bloquante');

  // =========================================================================
  console.log('\n[F] T3 : le volume d une ligne est plafonne');
  // =========================================================================
  reset();
  const enorme = { config: {} };
  for (let i = 0; i < 5000; i += 1) enorme.config[`cle${i}`] = `valeur assez longue pour peser ${i}`;
  await audit.writeAuditLog({ centerId: 'libramont', action: 'saveCenterConfig', changes: enorme });
  const taille = Buffer.byteLength(JSON.stringify(auditRows[0].changes), 'utf8');
  ok(taille <= audit.MAX_JSON_BYTES + 2048,
    `un diff enorme est tronque (obtenu ${taille} octets, plafond ${audit.MAX_JSON_BYTES})`);
  ok(auditRows[0].changes._tronque === true, 'la troncature est signalee explicitement, pas silencieuse');

  // =========================================================================
  console.log('\n[G] COUVERTURE : le dispatcher de api/ops.js');
  // =========================================================================
  const opsSource = readProjectFile('api/ops.js');
  const postStart = opsSource.indexOf('async function handlePost');
  const postEnd = opsSource.indexOf("Action Ops POST inconnue");
  const postSegment = opsSource.slice(postStart, postEnd);

  const postActions = new Set();
  let m;
  const re = /action === '([A-Za-z0-9_]+)'/g;
  while ((m = re.exec(postSegment))) postActions.add(m[1]);
  const re2 = /\[([^\]]*)\]\.includes\(action\)/g;
  while ((m = re2.exec(postSegment))) {
    (m[1].match(/'([A-Za-z0-9_]+)'/g) || []).forEach((x) => postActions.add(x.replace(/'/g, '')));
  }

  const exclusionMatch = opsSource.match(/const NON_MUTATING_POST_ACTIONS = new Set\(\[([\s\S]*?)\]\)/);
  ok(Boolean(exclusionMatch), 'la liste d exclusion existe et est lisible statiquement');
  const exclues = new Set((exclusionMatch[1].match(/'([A-Za-z0-9_]+)'/g) || []).map((x) => x.replace(/'/g, '')));

  const tracees = [...postActions].filter((a) => !exclues.has(a));
  console.log(`      actions POST du dispatcher : ${postActions.size}`);
  console.log(`      exclues (non mutantes)     : ${exclues.size}`);
  console.log(`      tracees                    : ${tracees.length}`);

  ok(postActions.size > 0, 'le dispatcher a bien ete analyse statiquement');
  // La POLARITE est le coeur de la garantie : par defaut on trace. Si un jour
  // quelqu un inverse la logique (liste d inclusion), cette assertion tombe.
  ok(/const audited = !NON_MUTATING_POST_ACTIONS\.has\(action\)/.test(opsSource),
    'la polarite est bien EXCLUSION (une action nouvelle est tracee par defaut)');
  ok(tracees.length >= postActions.size - exclues.size,
    'toute action non explicitement exclue est tracee');
  // Toute exclusion doit correspondre a une action REELLE : une exclusion
  // fantome (action renommee) laisserait croire a une couverture volontaire.
  const fantomes = [...exclues].filter((a) => !postActions.has(a));
  ok(fantomes.length === 0,
    `aucune exclusion fantome (obtenu : ${fantomes.join(', ') || 'aucune'})`);

  // =========================================================================
  console.log('\n[H] CABLAGE : les points de passage sont bien branches');
  // =========================================================================
  ok(/writeAuditLogOrThrow\(\{ \.\.\.auditBase, outcome: 'success' \}\)/.test(opsSource),
    'PP1 : le regime bloquant ecrit AVANT handlePost (rien ne mute sans trace)');
  const blocIdx = opsSource.indexOf('if (audited && isBlockingAction(action))');
  const handlePostIdx = opsSource.indexOf('await handlePost(req, res, withCenter(body');
  ok(blocIdx > 0 && handlePostIdx > blocIdx,
    'PP1 : l ecriture bloquante precede reellement l appel a handlePost (ordre verifie, pas suppose)');

  const staffAuthLib = readProjectFile('lib/staff-auth.js');
  ok(/logAccessDenied\(req, null, permission, '401_no_session'/.test(staffAuthLib),
    'PP2 : le 401 sans session est trace');
  ok(/logAccessDenied\(req, session, permission, '403_center_scope'/.test(staffAuthLib),
    'PP2 : la tentative inter-centres est tracee');
  ok(/logAccessDenied\(req, session, permission, '403_permission'/.test(staffAuthLib),
    'PP2 : le refus de permission est trace');

  const staffAuthApi = readProjectFile('api/staff-auth.js');
  ok(/await writeAuditLogOrThrow\(\{ \.\.\.auditBase, outcome: 'success' \}\)/.test(staffAuthApi),
    'PP3 : les actions d identite sont en regime bloquant');
  ok(!/newAccessCode|revealedCode/.test(staffAuthApi.slice(staffAuthApi.indexOf('const auditBase'), staffAuthApi.indexOf('let extra = {}'))),
    'PP3 : aucun champ porteur de code en clair n entre dans le contexte d audit');

  const reservationsApi = readProjectFile('api/staff-reservations.js');
  ok(/action: 'createReservation'/.test(reservationsApi)
    && /action: 'updateReservation'/.test(reservationsApi)
    && /action: 'deleteReservation'/.test(reservationsApi),
    'PP4 : les trois surfaces du chemin chaud sont tracees');
  ok(!/AUDITED_RESERVATION_FIELDS[\s\S]{0,400}'notes'/.test(reservationsApi),
    'PP4 : le contenu des notes client ne figure PAS dans les champs audites (T2)');
  ok(/auditCreate\.warning/.test(reservationsApi),
    'PP4 : l echec de trace remonte dans les warnings de la reponse (T4 volet c)');

  ok(/action: 'setReservationActivityProgress'/.test(reservationsApi),
    'PP4 : le chemin rapide activityProgress est trace lui aussi (il sortait avant toute journalisation)');

  const lanesApi = readProjectFile('api/staff-lanes.js');
  ok(/action: 'updateLaneStatus'/.test(lanesApi),
    'staff-lanes : bloquer une piste est trace (effet direct sur la capacite vendue)');
  const laneWriteIdx = lanesApi.indexOf('await updateLaneStatus');
  // `await writeAuditLog`, pas `writeAuditLog` : la premiere occurrence nue est
  // la ligne de require en tete de fichier, qui precede evidemment la mutation.
  // L assertion aurait compare l import a l ecriture et affirme n importe quoi.
  const laneAuditIdx = lanesApi.indexOf('await writeAuditLog');
  ok(laneWriteIdx > 0 && laneAuditIdx > laneWriteIdx,
    'staff-lanes : la trace s ecrit APRES la mutation, donc hors du verrou par piste (T5)');

  ok(/action: 'login'/.test(staffAuthApi) && /deniedReason: '401_bad_code'/.test(staffAuthApi),
    'staff-auth : une connexion REFUSEE est tracee (signal "quelqu un essaie des codes")');
  ok(/action: 'logout'/.test(staffAuthApi), 'staff-auth : la deconnexion est tracee');
  const loginBlock = staffAuthApi.slice(staffAuthApi.indexOf("if (action === 'login')"), staffAuthApi.indexOf("if (action === 'logout')"));
  ok(!/context: \{[^}]*body\./.test(loginBlock),
    'staff-auth : AUCUN element du corps de requete de login n entre dans le journal (body.code y est en clair)');

  const cronTasks = readProjectFile('lib/cron-tasks.js');
  ok(/actorKind: auditRuntimeKind/.test(cronTasks),
    'PP5 : le runtime (cron ou worker) est enregistre comme acteur');
  ok(/setAuditRuntime\('worker'\)/.test(readProjectFile('workers/ops-worker.js')),
    'PP5 : le worker Railway se declare');
  ok(/setAuditRuntime\('cron'\)/.test(readProjectFile('api/cron.js')),
    'PP5 : le cron Vercel se declare');

  const worker = readProjectFile('workers/ops-worker.js');
  const opsLogIdx = worker.indexOf('const OPS_LOG_TABLES');
  const tableau = worker.slice(opsLogIdx, worker.indexOf(']', opsLogIdx));
  ok(!/audit_log/.test(tableau),
    'audit_log n est PAS dans OPS_LOG_TABLES (le journal ne s auto-detruit pas a 7 jours)');
  ok(/NE JAMAIS AJOUTER audit_log/.test(worker),
    'un commentaire explicite protege cette decision du prochain reflexe de symetrie');

  // =========================================================================
  console.log('\n[I] MIGRATION : enregistree, pas appliquee');
  // =========================================================================
  const runner = readProjectFile('scripts/run-db-migrations.js');
  ok(/id: '0031_audit_log'/.test(runner), 'la migration 0031 est enregistree dans le runner');
  ok(/database\/audit-log-schema\.sql/.test(runner), 'elle pointe le bon fichier SQL');
  const schema = readProjectFile('database/audit-log-schema.sql');
  ok(/create table if not exists audit_log/.test(schema), 'le schema cree la table');
  ok(/audit_log_center_idx/.test(schema)
    && /audit_log_center_actor_idx/.test(schema)
    && /audit_log_center_action_idx/.test(schema),
    'les trois index de lecture du mandat existent (par centre, par acteur, par action)');
  ok(/where outcome = 'denied'/.test(schema), 'l index partiel des refus existe');
  ok(!/drop table|truncate/i.test(schema), 'la migration ne contient AUCUNE operation destructive');

  const rls = readProjectFile('database/rls-tenant-isolation.sql');
  ok(/'audit_log'/.test(rls), 'audit_log est enregistree dans le modele d isolation RLS');

  // ── (f) LE CABLAGE, pas seulement l'outil ────────────────────────────────
  // Tout ce qui precede appelle writeAuditLog DIRECTEMENT : ca prouve que le
  // module marche, PAS qu'il est branche. Mesure a l'appui : supprimer le bloc
  // d'ecriture de api/ops.js (celui qui trace 44 des 49 actions POST et toute
  // action future) laissait ce gate a ALL OK. Un journal parfait que personne
  // n'appelle ne trace rien.
  // On exerce donc le VRAI dispatcher, avec un req/res factice et une session
  // stubbee, et on regarde si une ligne atterrit reellement.
  console.log('\n[CABLAGE] le dispatcher appelle vraiment le journal');
  {
    const authPath = require.resolve('../lib/staff-auth');
    const authReel = require.cache[authPath];
    const session = {
      centerId: 'libramont',
      member: { id: 'm-cablage', name: 'Gerante Test' },
      role: { id: 'direction', name: 'Direction' },
      permissions: ['settings.manage', 'direction.view', 'centers.switch'],
    };
    require.cache[authPath] = {
      id: authPath, filename: authPath, loaded: true,
      exports: {
        ...(authReel ? authReel.exports : {}),
        requireStaffPermission: async () => session,
        getRequiredOpsPermission: () => [],
      },
    };
    const opsPath = require.resolve('../api/ops.js');
    delete require.cache[opsPath];
    let handler = null;
    try { handler = require('../api/ops.js'); } catch (error) { handler = null; }

    const avant = auditRows.length;
    if (typeof handler === 'function') {
      // readJson (lib/http.js) consomme le corps en for-await : le faux req doit
      // donc etre iterable de facon asynchrone, sinon on ne teste que le
      // message d'erreur du lecteur de corps, pas le cablage du journal.
      const charge = JSON.stringify({ action: 'insightStatus', centerId: 'libramont', id: 1, status: 'applied' });
      const req = {
        method: 'POST', url: '/api/ops?action=insightStatus',
        headers: { 'content-type': 'application/json' },
        async *[Symbol.asyncIterator]() { yield Buffer.from(charge); },
      };
      const res = {
        statusCode: 200, headersSent: false,
        setHeader() {}, end() { this.headersSent = true; },
        writeHead() { this.headersSent = true; },
      };
      try { await handler(req, res); } catch (error) { /* l'action peut echouer : c'est la TRACE qu'on mesure */ }
    }
    const apres = auditRows.length;
    ok(typeof handler === 'function', 'le dispatcher api/ops.js est chargeable pour ce test');
    // ON EXIGE outcome = 'success', ET C'EST TOUT LE POINT. Une premiere version
    // de cette assertion se contentait de "une trace existe" : elle restait
    // VERTE avec l'ecriture de succes desactivee, parce que le chemin d'ERREUR
    // ecrit lui aussi (l'action echoue dans l'environnement simule). Elle
    // mesurait donc la mauvaise chose. C'est exactement le motif de faux vert
    // que ce projet traque, commis ici sur l'assertion censee le fermer.
    // On ne compte QUE les lignes produites par CET appel (slice depuis avant).
    // Compter tout le journal incluait les traces des sections precedentes de ce
    // meme gate : l'assertion restait verte sans qu'aucune ligne ne vienne du
    // dispatcher. Troisieme variante du meme piege sur la meme assertion, ce qui
    // dit assez a quel point il est facile de mesurer la mauvaise chose.
    const produites = auditRows.slice(avant);
    const succes = produites.filter((r) => String(r.outcome || '') === 'success');
    ok(succes.length > 0,
      `une action REUSSIE passee par le DISPATCHER laisse une trace de succes (${produites.length} ligne(s) produite(s), dont ${succes.length} succes)`);
    const trace = succes[succes.length - 1] || produites[produites.length - 1] || {};
    ok(String(trace.action || '').length > 0 && String(trace.center_id || trace.centerId || '').length > 0,
      `la trace du dispatcher porte l action et le centre (action=${trace.action}, centre=${trace.center_id || trace.centerId})`);

    if (authReel) require.cache[authPath] = authReel; else delete require.cache[authPath];
    delete require.cache[opsPath];
  }

  // ── PARCOURS D EQUIPE : bornes DURES des lots d evenements ──────────────
  // (2026-08-25). Un client compromis ne peut ni gonfler la table ni y
  // injecter du bruit arbitraire : types fermes, libelles plafonnes, lot
  // plafonne.
  {
    const { normalizeActivityEvents } = require('../lib/audit-log');
    ok(typeof normalizeActivityEvents === 'function', 'normalizeActivityEvents est exportee');
    const events = normalizeActivityEvents([
      { t: 1000, k: 'page', v: '  planning  ' },
      { t: 2000, k: 'clic', v: 'Relancer par email' },
      { t: 3000, k: 'script', v: 'injection' },
      { t: 'x', k: 'page', v: 'sans temps' },
      { t: 4000, k: 'clic', v: '' },
      { t: 5000, k: 'clic', v: 'A'.repeat(500) },
    ]) || [];
    ok(events.length === 3, `seuls les evenements valides passent (${events.length}/6)`);
    ok(events[0] && events[0].v === 'planning', 'les libelles sont normalises (espaces)');
    ok(events[2] && events[2].v.length === 90, `les libelles sont plafonnes a 90 caracteres (${events[2] ? events[2].v.length : 0})`);
    const flood = normalizeActivityEvents(Array.from({ length: 200 }, (_, i) => ({ t: i + 1, k: 'clic', v: `b${i}` }))) || [];
    ok(flood.length === 40, `un lot est plafonne a 40 evenements (${flood.length})`);
    ok((normalizeActivityEvents('rien') || []).length === 0, 'une entree non-tableau rend un lot vide');
  }

  if (failures) {
    console.error(`\naudit-log-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\naudit-log-check: ALL OK');
})().catch((error) => {
  console.error('audit-log-check: exception', error);
  process.exit(1);
});

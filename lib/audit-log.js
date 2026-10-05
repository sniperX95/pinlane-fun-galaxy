// Journal d'audit : LE point de verite unique du "qui a change quoi".
// Meme role que lib/simulation-filter.js pour la simulation : un seul module,
// tout le monde passe par lui, personne ne reimplemente sa propre trace.
//
// Table : audit_log (migration 0031, database/audit-log-schema.sql).
//
// ── CE QUE CE MODULE GARANTIT ───────────────────────────────────────────────
//   1. Aucun secret n'entre dans le journal (redactSecrets, par MOTIF de nom
//      de clef, recursivement, AVANT serialisation).
//   2. L'ecriture ne casse pas l'action metier, mais elle n'echoue JAMAIS en
//      silence (voir la tranche T4 ci-dessous).
//   3. La lecture est scopee par centre, avec le centre en PARAMETRE SQL.
//
// ── T4 : LA TRANCHE, EXPLICITE ──────────────────────────────────────────────
// Question posee : une action doit-elle refuser de s'executer si sa trace ne
// peut pas etre ecrite ? Reponse : cela depend de l'action, et le partage se
// fait sur une ligne nette, pas sur un compromis mou.
//
// REGIME BLOQUANT (writeAuditLogOrThrow) : l'action refuse de s'executer.
//   Actions d'identite et de permissions, configuration et tarifs, envois de
//   masse. Frequence faible (quelques dizaines par mois), hors chemin chaud,
//   consequences lourdes et difficilement reversibles. Une modification de
//   permissions non tracee est precisement le trou que ce chantier ferme :
//   la laisser passer viderait la promesse de son sens. Le cout d'un refus
//   (la directrice reessaie) est trivial devant le cout d'un angle mort.
//
// REGIME NON BLOQUANT MAIS BRUYANT (writeAuditLog) : l'action passe, l'echec
// de trace crie.
//   Reservations, statuts de pistes, communications, marketing, IA. Ce sont
//   les chemins chauds et le comptoir. Bloquer une reservation un samedi parce
//   que la table d'audit est indisponible transformerait un probleme
//   d'observabilite en panne commerciale.
//
//   "Bruyant" est defini precisement, parce que ce projet a deja paye le prix
//   du contraire (un filtre de desinscription qui echouait en silence a ete
//   juge inacceptable pour exactement cette raison). Bruyant = TROIS choses
//   simultanees, pas une :
//     (a) console.error avec le prefixe stable '[audit] ECRITURE PERDUE'.
//         JAMAIS `.catch(() => null)`, qui est le motif exact a bannir ;
//     (b) un compteur d'echecs, expose par getAuditHealth() et servi dans
//         l'action `health` de api/ops.js, donc visible dans les cockpits ;
//     (c) un avertissement structure remonte a l'appelant, qui le pose dans le
//         champ `warnings` de la reponse HTTP. La personne qui vient d'agir
//         voit que sa trace a saute.
//   Un echec silencieux rendrait litteralement fausse la phrase "tout est
//   tracable". C'est la ligne a ne pas franchir.
//
// ── T5 : PERFORMANCE ────────────────────────────────────────────────────────
// L'ecriture du journal se fait TOUJOURS hors transaction et hors verrou.
// createReservation (lib/database.js) tient un pg_advisory_xact_lock par
// (centre, date) jusqu'au COMMIT : y ajouter un aller-retour reseau
// serialiserait toutes les creations d'une meme date. Le journal s'ecrit donc
// APRES le retour de la fonction metier, sur le modele deja en place a
// api/staff-reservations.js (createOpsEvent post-commit). Ce qui n'est PAS
// repris de ce precedent, c'est le `.catch(() => null)` qui le suit.

const { getPool } = require('./database');

// ── Expurgation ─────────────────────────────────────────────────────────────
//
// Par MOTIF de nom de clef, jamais par liste fixe. Une liste fixe est perimee
// des la prochaine action ajoutee au dispatcher : le champ sensible d'une
// action ecrite dans six mois n'y figurera pas, et il partira en clair.
//
// Le cout d'un faux positif (un champ expurge a tort) est nul : on perd une
// valeur dans un journal. Le cout d'un faux negatif est une fuite de code
// d'acces staff. Le motif est donc volontairement large.
const SECRET_KEY_PATTERN = /code|token|secret|password|passwd|hash|key|auth|signature|cookie|bearer|credential/i;

// Exceptions au motif : des clefs metier legitimes qui contiennent par hasard
// un mot du motif et dont la valeur n'a aucune sensibilite. Sans cette liste,
// le journal d'une reservation perdrait son identifiant de formule
// (`formuleId` ne matche pas, mais `postalCode` oui via 'code', et
// `keyAccount`, `authorId`... arriveraient un jour).
// Regle d'ajout : on n'ajoute ici QUE si la valeur est structurellement non
// secrete (un identifiant public, un libelle). Dans le doute, on n'ajoute pas.
const SAFE_KEY_EXCEPTIONS = new Set([
  'postalcode',
  'countrycode',
  'currencycode',
  'languagecode',
  'promocode',
  'keyword',
  'keywords',
]);

const REDACTED = '[expurge]';

// Plafond de taille par ligne. Un diff sur la config d'un centre peut peser
// plusieurs dizaines de Ko : sans plafond, le journal devient le premier poste
// de transfert Neon du produit.
//
// LE REGISTRE (2026-10-05, lib/registre.js) : 8 Ko ne tenaient pas un
// avant/apres complet de reservation (nom, telephone, notes entieres, programme,
// resume du plan), et une ligne trop grosse etait remplacee en bloc par un
// apercu de 1 500 caracteres : le nom du client partait avec le reste. Le
// plafond monte a 64 Ko, et surtout une ligne qui le depasse n est plus jetee :
// capJson garde les champs d IDENTITE en entier, puis les autres champs du
// plus petit au plus grand tant qu ils tiennent, et ne tronque que le surplus,
// champ par champ, en le disant (_tronque, _champsTronques).
const MAX_JSON_BYTES = 64 * 1024;
const MAX_STRING_LENGTH = 20000;
// Une valeur d identite n est jamais tronquee en dessous de cette borne, qui
// n existe que pour qu une valeur forgee ne puisse pas peser des megaoctets.
const MAX_IDENTITY_STRING_LENGTH = 512 * 1024;
const MAX_DEPTH = 8;

// Les clefs qui portent l identite du client ou ce qu il a ecrit : jamais
// tronquees, gardees en priorite quand une ligne depasse le plafond. Reconnues
// par leur NOM a tous les niveaux (un diff les porte en `notes: { before,
// after }` : les deux textes sous `notes` sont de l identite).
const IDENTITY_KEYS = new Set([
  'name', 'clientname', 'contactname', 'phone', 'email', 'notes', 'company', 'message', 'organisation',
]);

function isSecretKey(key) {
  const normalized = String(key || '').toLowerCase();
  if (SAFE_KEY_EXCEPTIONS.has(normalized)) return false;
  return SECRET_KEY_PATTERN.test(normalized);
}

function isIdentityKey(key) {
  return IDENTITY_KEYS.has(String(key || '').toLowerCase());
}

function tronquerTexte(value, max) {
  return value.length > max ? `${value.slice(0, max)}[tronque ${value.length} caracteres]` : value;
}

// Expurge recursivement. Renvoie une structure NEUVE : l'objet d'origine
// (souvent le corps de requete encore utilise par l'appelant) n'est jamais mute.
// `identity` : on est sous une clef d identite, le texte se garde en entier.
function redactSecrets(value, depth = 0, identity = false) {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[profondeur max]';

  if (typeof value === 'string') {
    return tronquerTexte(value, identity ? MAX_IDENTITY_STRING_LENGTH : MAX_STRING_LENGTH);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redactSecrets(item, depth + 1, identity));
  }

  if (typeof value === 'object') {
    // Une Date, une Error ou tout objet non litteral part en representation
    // texte : serialiser leurs proprietes internes n'apporte rien et peut
    // charrier des donnees inattendues.
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return String(value.message || 'erreur');

    const out = {};
    for (const [key, item] of Object.entries(value)) {
      // La clef est expurgee AVANT toute inspection de sa valeur : une clef
      // sensible portant un objet imbrique ne doit pas etre parcourue du tout.
      out[key] = isSecretKey(key) ? REDACTED : redactSecrets(item, depth + 1, identity || isIdentityKey(key));
    }
    return out;
  }

  // Fonction, symbole, bigint : rien de tout cela n'a sa place dans un journal.
  return String(value);
}

function tailleOctets(value) {
  return Buffer.byteLength(JSON.stringify(value === undefined ? null : value), 'utf8');
}

// Serialise en respectant le plafond. Renvoie TOUJOURS un objet serialisable.
//
// Au-dela du plafond, la ligne n est pas jetee : les champs d identite sont
// gardes en entier quoi qu il arrive, les autres entrent du plus petit au plus
// grand tant que la ligne tient, et chaque champ laisse dehors est remplace
// par un marqueur qui dit sa taille et en montre le debut. La troncature est
// toujours signalee a la racine (_tronque, _tailleOctets, _champsTronques).
function capJson(value) {
  const safe = redactSecrets(value);
  let serialized;
  try {
    serialized = JSON.stringify(safe);
  } catch (error) {
    // Cycle ou valeur non serialisable : on ne perd pas la ligne pour autant.
    return { _erreur: 'payload non serialisable' };
  }
  if (!serialized) return {};
  const total = Buffer.byteLength(serialized, 'utf8');
  if (total <= MAX_JSON_BYTES) return safe;
  if (!safe || typeof safe !== 'object' || Array.isArray(safe)) {
    return { _tronque: true, _tailleOctets: total, _apercu: serialized.slice(0, 1500) };
  }
  const entries = Object.entries(safe).map(([key, item]) => ({ key, item, bytes: tailleOctets(item) + key.length + 4 }));
  const identite = entries.filter((entry) => isIdentityKey(entry.key));
  const autres = entries.filter((entry) => !isIdentityKey(entry.key)).sort((a, b) => a.bytes - b.bytes);
  const out = {};
  const tronques = [];
  let utilise = 0;
  for (const entry of identite) {
    out[entry.key] = entry.item;
    utilise += entry.bytes;
  }
  for (const entry of autres) {
    if (utilise + entry.bytes <= MAX_JSON_BYTES) {
      out[entry.key] = entry.item;
      utilise += entry.bytes;
    } else {
      out[entry.key] = { _tronque: true, _tailleOctets: entry.bytes, _apercu: JSON.stringify(entry.item).slice(0, 300) };
      tronques.push(entry.key);
    }
  }
  out._tronque = true;
  out._tailleOctets = total;
  out._champsTronques = tronques;
  return out;
}

// ── Diff avant/apres ────────────────────────────────────────────────────────
//
// Ne retient QUE les champs listes. Un diff automatique sur tout l'objet
// deverserait dans le journal des colonnes calculees (riskScore, updatedAt...)
// qui bougent a chaque ecriture et noieraient le signal.
function buildChanges(before, after, fields) {
  const changes = {};
  if (!Array.isArray(fields)) return changes;
  const source = before || {};
  const target = after || {};
  for (const field of fields) {
    const previous = source[field];
    const next = target[field];
    if (previous === undefined && next === undefined) continue;
    // Comparaison structurelle : les objets (extras, permissions) ne se
    // comparent pas avec !==, qui les declarerait tous modifies.
    const same = JSON.stringify(previous ?? null) === JSON.stringify(next ?? null);
    if (same) continue;
    changes[field] = {
      before: previous ?? null,
      after: next ?? null,
    };
  }
  return changes;
}

// ── Sante : le compteur qui rend l'echec visible (T4, point b) ──────────────
const health = {
  written: 0,
  failed: 0,
  lastFailureAt: null,
  lastFailureMessage: '',
};

function getAuditHealth() {
  return { ...health };
}

function resetAuditHealth() {
  health.written = 0;
  health.failed = 0;
  health.lastFailureAt = null;
  health.lastFailureMessage = '';
}

// ── Normalisation d'une entree ──────────────────────────────────────────────

const ACTOR_KINDS = new Set(['staff', 'public', 'cron', 'worker', 'system']);
const OUTCOMES = new Set(['success', 'denied', 'error']);

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

// Derive un acteur depuis une session staff. Centralise ici pour qu'aucun
// appelant n'ait a savoir comment une session est structuree, et pour qu'aucun
// appelant ne puisse y glisser un champ sensible par inadvertance : seuls
// quatre champs sont lus, en LISTE BLANCHE.
function actorFromSession(session, fallbackKind = 'staff') {
  if (!session || !session.member) {
    return { actorKind: fallbackKind, actorMemberId: null, actorLabel: '', actorRoleId: null };
  }
  return {
    actorKind: 'staff',
    actorMemberId: normalizeText(session.member.id, '') || null,
    actorLabel: normalizeText(session.member.name, ''),
    actorRoleId: normalizeText(session.member.roleId || (session.role && session.role.id), '') || null,
  };
}

function buildRow(entry = {}) {
  const actorKind = ACTOR_KINDS.has(entry.actorKind) ? entry.actorKind : 'system';
  const outcome = OUTCOMES.has(entry.outcome) ? entry.outcome : 'success';
  return {
    centerId: normalizeText(entry.centerId, 'libramont'),
    actorKind,
    actorMemberId: entry.actorMemberId ? normalizeText(entry.actorMemberId) : null,
    actorLabel: normalizeText(entry.actorLabel, ''),
    actorRoleId: entry.actorRoleId ? normalizeText(entry.actorRoleId) : null,
    surface: normalizeText(entry.surface, ''),
    action: normalizeText(entry.action, ''),
    method: normalizeText(entry.method, ''),
    entityType: entry.entityType ? normalizeText(entry.entityType) : null,
    entityId: entry.entityId !== undefined && entry.entityId !== null && entry.entityId !== ''
      ? String(entry.entityId)
      : null,
    outcome,
    deniedReason: entry.deniedReason ? normalizeText(entry.deniedReason) : null,
    changes: capJson(entry.changes || {}),
    context: capJson(entry.context || {}),
    requestId: entry.requestId ? normalizeText(entry.requestId) : null,
  };
}

const INSERT_SQL = `
  insert into audit_log (
    center_id, actor_kind, actor_member_id, actor_label, actor_role_id,
    surface, action, method, entity_type, entity_id,
    outcome, denied_reason, changes, context, request_id
  )
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15)
  returning id, occurred_at;
`;

async function insertRow(row) {
  const result = await getPool().query(INSERT_SQL, [
    row.centerId,
    row.actorKind,
    row.actorMemberId,
    row.actorLabel,
    row.actorRoleId,
    row.surface,
    row.action,
    row.method,
    row.entityType,
    row.entityId,
    row.outcome,
    row.deniedReason,
    JSON.stringify(row.changes),
    JSON.stringify(row.context),
    row.requestId,
  ]);
  return result.rows[0] || null;
}

// ── ECRITURE, REGIME NON BLOQUANT MAIS BRUYANT ──────────────────────────────
//
// Ne jette jamais. Renvoie { ok, id, warning }. L'appelant DOIT propager
// `warning` dans sa reponse HTTP quand il en a une : c'est le troisieme volet
// du "bruyant". Ignorer la valeur de retour ramene au silence qu'on refuse.
// ── PARCOURS D EQUIPE (2026-08-25) ──────────────────────────────────────────
// La console envoie par lots les pages ouvertes et les boutons touches par le
// staff (verdict Movsar : « je dois voir exactement ce que font les autres »).
// Bornes DURES : types fermes, libelles 90 caracteres, 40 evenements par lot.
// Un client compromis ne peut ni gonfler la table ni y injecter du bruit
// arbitraire ; redactSecrets repasse de toute facon derriere (capJson).
const ACTIVITY_EVENT_KINDS = new Set(['page', 'clic']);
const ACTIVITY_EVENTS_MAX = 40;
const ACTIVITY_LABEL_MAX = 90;

function normalizeActivityEvents(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const kind = String(item.k || '').trim();
    if (!ACTIVITY_EVENT_KINDS.has(kind)) continue;
    const label = String(item.v || '').replace(/\s+/g, ' ').trim().slice(0, ACTIVITY_LABEL_MAX);
    if (!label) continue;
    const t = Number(item.t);
    if (!Number.isFinite(t) || t <= 0) continue;
    out.push({ t: Math.round(t), k: kind, v: label });
    if (out.length >= ACTIVITY_EVENTS_MAX) break;
  }
  return out;
}

// LE REGISTRE CRIE QUAND UNE TRACE SE PERD (2026-10-05). En plus du prefixe
// [audit], un prefixe [registre] STABLE pour la recherche dans les logs, et une
// ligne ops_events (le journal terrain, une autre table, un autre chemin) qui
// garde la trace du manque la ou le staff relit la journee : on sait QUELLE
// action de QUI sur QUOI n a pas ete journalisee, meme si personne ne lit les
// logs. Ne jette jamais : c est un signal, pas une deuxieme panne.
async function signalerTracePerdue(row, error, regime = '') {
  const message = String((error && error.message) || 'erreur inconnue').slice(0, 300);
  console.error(
    `[registre] TRACE PERDUE${regime} action=${row.action || '?'} surface=${row.surface || '?'} entite=${row.entityType || '?'}:${row.entityId || '?'} centre=${row.centerId} acteur=${row.actorMemberId || row.actorLabel || row.actorKind} : ${message}`,
  );
  // Une action de portee plateforme ('all') n est le centre de personne, et
  // ops_events exige un centre reel (cle etrangere) : le signal reste dans
  // les logs.
  if (!row.centerId || row.centerId === 'all') return;
  try {
    const { createOpsEvent } = require('./database');
    await createOpsEvent({
      centerId: row.centerId,
      eventType: 'audit_write_failed',
      payload: {
        surface: row.surface,
        action: row.action,
        method: row.method,
        entityType: row.entityType,
        entityId: row.entityId,
        actorKind: row.actorKind,
        actorMemberId: row.actorMemberId,
        actorLabel: row.actorLabel,
        outcome: row.outcome,
        requestId: row.requestId,
        erreur: message,
      },
      runLearning: false,
    });
  } catch (fallbackError) {
    console.error(
      `[registre] SIGNAL PERDU (ops_events indisponible) action=${row.action || '?'} entite=${row.entityType || '?'}:${row.entityId || '?'}`,
      fallbackError && (fallbackError.message || fallbackError),
    );
  }
}

async function writeAuditLog(entry = {}) {
  const row = buildRow(entry);
  try {
    const written = await insertRow(row);
    health.written += 1;
    return { ok: true, id: written ? written.id : null, warning: null };
  } catch (error) {
    health.failed += 1;
    health.lastFailureAt = new Date().toISOString();
    health.lastFailureMessage = String((error && error.message) || 'erreur inconnue').slice(0, 300);
    // Prefixe STABLE : c'est ce qui rend la ligne cherchable dans les logs
    // Vercel et Railway sans connaitre le message d'erreur du jour.
    console.error(
      `[audit] ECRITURE PERDUE action=${row.action || '?'} surface=${row.surface || '?'} centre=${row.centerId} acteur=${row.actorMemberId || row.actorKind}`,
      error && (error.stack || error.message || error),
    );
    await signalerTracePerdue(row, error);
    return {
      ok: false,
      id: null,
      warning: {
        code: 'audit_write_failed',
        message: "L'action a bien ete effectuee, mais sa trace d'audit n'a pas pu etre enregistree. Signalez-le.",
      },
    };
  }
}

// ── ECRITURE, REGIME BLOQUANT ───────────────────────────────────────────────
//
// Jette si la trace ne peut pas etre ecrite. A n'utiliser QUE sur les actions
// listees dans BLOCKING_ACTIONS. L'appelant doit l'appeler AVANT de muter, ou
// accepter que la mutation soit deja faite au moment du refus : voir la note
// d'emploi a chaque site d'appel.
async function writeAuditLogOrThrow(entry = {}) {
  const row = buildRow(entry);
  try {
    const written = await insertRow(row);
    health.written += 1;
    return { ok: true, id: written ? written.id : null, warning: null };
  } catch (error) {
    health.failed += 1;
    health.lastFailureAt = new Date().toISOString();
    health.lastFailureMessage = String((error && error.message) || 'erreur inconnue').slice(0, 300);
    console.error(
      `[audit] ECRITURE PERDUE (BLOQUANT) action=${row.action || '?'} surface=${row.surface || '?'} centre=${row.centerId}`,
      error && (error.stack || error.message || error),
    );
    await signalerTracePerdue(row, error, ' (BLOQUANT, action refusee)');
    const blocked = new Error(
      "Action refusee : sa trace d'audit n'a pas pu etre enregistree. Cette action est trop sensible pour s'executer sans trace. Reessayez dans un instant.",
    );
    blocked.statusCode = 503;
    blocked.expose = true;
    blocked.auditBlocked = true;
    throw blocked;
  }
}

// Les actions qui refusent de s'executer sans trace. Liste FERMEE et courte :
// tout ajout ici est un arbitrage entre disponibilite et tracabilite, il se
// fait en connaissance de cause.
const BLOCKING_ACTIONS = new Set([
  // Identite et permissions : le coeur du controle d'acces.
  'createRole',
  'updateRolePermissions',
  'setRolePreset',
  'regenerateRoleCode',
  'revealRoleCode',
  'revealMemberCode',
  'createMember',
  'updateMemberRole',
  'toggleMemberStatus',
  // Configuration et tarifs : ce que payent les clients.
  'saveCenterConfig',
  'saveCenter',
  'setCenterStatus',
  // Envoi de masse : irreversible des que parti.
  'sendCampaign',
]);

function isBlockingAction(action) {
  return BLOCKING_ACTIONS.has(String(action || ''));
}

// Ecrit selon le regime qui correspond a l'action. C'est la fonction que les
// dispatchers appellent : ils n'ont pas a connaitre la liste.
async function writeAuditLogForAction(entry = {}) {
  return isBlockingAction(entry.action)
    ? writeAuditLogOrThrow(entry)
    : writeAuditLog(entry);
}

// ── LECTURE SCOPEE PAR CENTRE (T6) ──────────────────────────────────────────
//
// Le centre voyage en PARAMETRE SQL, jamais concatene. Une directrice ne peut
// pas lire un autre centre : le predicat center_id = $1 est inconditionnel des
// que le scope n'est pas 'all', et 'all' n'est atteignable que par une session
// portant centers.switch (l'appelant le verifie, api/ops.js).
//
// scripts/audit-log-check.js verifie les deux sens : le predicat est present,
// ET une demande cross-centre ne rend aucune ligne.
async function readAuditLog(options = {}) {
  const centerId = normalizeText(options.centerId, '');
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const where = [];
  const params = [];

  // Scope centre. 'all' est le SEUL moyen de ne pas filtrer, et il est reserve
  // au fondateur : l'appelant ne le transmet que pour une session qui porte
  // centers.switch. Toute autre valeur, y compris vide, filtre.
  if (centerId !== 'all') {
    params.push(centerId || 'libramont');
    where.push(`center_id = $${params.length}`);
  }

  if (options.actorMemberId) {
    params.push(normalizeText(options.actorMemberId));
    where.push(`actor_member_id = $${params.length}`);
  }
  if (options.action) {
    params.push(normalizeText(options.action));
    where.push(`action = $${params.length}`);
  }
  if (options.actorKind && ACTOR_KINDS.has(options.actorKind)) {
    params.push(options.actorKind);
    where.push(`actor_kind = $${params.length}`);
  }
  if (options.outcome && OUTCOMES.has(options.outcome)) {
    params.push(options.outcome);
    where.push(`outcome = $${params.length}`);
  }
  if (options.entityType) {
    params.push(normalizeText(options.entityType));
    where.push(`entity_type = $${params.length}`);
  }
  if (options.entityId) {
    params.push(String(options.entityId));
    where.push(`entity_id = $${params.length}`);
  }
  if (options.since) {
    params.push(String(options.since));
    where.push(`occurred_at >= $${params.length}::timestamptz`);
  }

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;
  params.push(offset);
  const offsetPlaceholder = `$${params.length}`;

  const sql = `
    select id, center_id, occurred_at, actor_kind, actor_member_id, actor_label,
           actor_role_id, surface, action, method, entity_type, entity_id,
           outcome, denied_reason, changes, context, request_id
    from audit_log
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by occurred_at desc, id desc
    limit ${limitPlaceholder} offset ${offsetPlaceholder};
  `;

  const result = await getPool().query(sql, params);
  return result.rows.map(mapAuditRow);
}

function mapAuditRow(row) {
  return {
    id: Number(row.id),
    centerId: row.center_id,
    occurredAt: row.occurred_at,
    actorKind: row.actor_kind,
    actorMemberId: row.actor_member_id || '',
    actorLabel: row.actor_label || '',
    actorRoleId: row.actor_role_id || '',
    surface: row.surface || '',
    action: row.action || '',
    method: row.method || '',
    entityType: row.entity_type || '',
    entityId: row.entity_id || '',
    outcome: row.outcome,
    deniedReason: row.denied_reason || '',
    changes: row.changes || {},
    context: row.context || {},
    requestId: row.request_id || '',
  };
}

// Identifiant de requete : correle les lignes ecrites pendant le meme appel
// HTTP (par exemple un refus PP2 puis une action PP1). Pas de dependance
// externe : un compteur process + horodatage suffit et ne coute rien.
let requestCounter = 0;
function newRequestId() {
  requestCounter = (requestCounter + 1) % 1000000;
  return `${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

module.exports = {
  normalizeActivityEvents,
  writeAuditLog,
  writeAuditLogOrThrow,
  writeAuditLogForAction,
  readAuditLog,
  redactSecrets,
  buildChanges,
  actorFromSession,
  getAuditHealth,
  resetAuditHealth,
  isBlockingAction,
  isIdentityKey,
  newRequestId,
  BLOCKING_ACTIONS,
  IDENTITY_KEYS,
  SECRET_KEY_PATTERN,
  MAX_JSON_BYTES,
  MAX_STRING_LENGTH,
  MAX_IDENTITY_STRING_LENGTH,
};

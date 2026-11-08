const {
  createMember,
  createEmergencyAccessControl,
  createEmergencyOwnerSession,
  requeteDUnAutreSite,
  createRole,
  renameRole,
  deleteRole,
  deleteMember,
  getAuditSubjectSnapshot,
  STAFF_SESSION_COOKIE,
  getStaffSessionFromRequest,
  isDatabaseError,
  isStaffAuthStorageError,
  publicIncidentMessage,
  listAccessControl,
  loginStaffByCode,
  logoutStaff,
  normalizeStaffCenterId,
  regenerateRoleCode,
  revealRoleCode,
  revealMemberCode,
  requireStaffPermission,
  sessionAuCentre,
  centresDeLaSession,
  getRole,
  renameMember,
  setMemberBlocked,
  regenerateMemberCode,
  setMemberCenter,
  supprimerPersonne,
  sessionHasPermission,
  setRolePreset,
  toggleMemberStatus,
  updateMemberRole,
  updateRolePermissions,
  publicStorageErrorMessage,
  DROITS_NIVEAUX,
  niveauEffectif,
  STAFF_ROLE_PRESETS,
} = require('../lib/staff-auth');
const { readJson, sendError, sendJson } = require('../lib/http');
const {
  writeAuditLog,
  writeAuditLogOrThrow,
  actorFromSession,
  buildChanges,
  newRequestId,
} = require('../lib/audit-log');

function isSecureRequest(req) {
  return Boolean(process.env.VERCEL)
    || req.headers['x-forwarded-proto'] === 'https'
    || String(req.headers.host || '').includes('mngfunglxy.com');
}

function setStaffSessionCookie(req, res, token, expiresAt) {
  if (!token) return;
  const expires = expiresAt ? new Date(expiresAt) : new Date(Date.now() + (14 * 60 * 60 * 1000));
  const maxAge = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${STAFF_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${expires.toUTCString()}${secure}`,
  );
}

function clearStaffSessionCookie(req, res) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${STAFF_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
  );
}

function getCenterId(req, body = {}) {
  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return normalizeStaffCenterId(body.centerId || requestUrl.searchParams.get('centerId') || 'libramont');
}

// L ADRESSE QUE VERCEL A VUE D ABORD (passe securite du 2026-11-08) : x-vercel-forwarded-for
// et x-real-ip sont poses par la plateforme, alors que x-forwarded-for peut arriver du
// client derriere un autre relais. Le limiteur de connexion compte par cette adresse.
function getRequestFingerprint(req) {
  return String(
    req.headers['x-vercel-forwarded-for']
    || req.headers['x-real-ip']
    || req.headers['x-forwarded-for']
    || req.socket?.remoteAddress
    || req.headers['user-agent']
    || 'unknown',
  ).split(',')[0].trim();
}

// CE QU UN ROLE QUI GERE L EQUIPE PEUT DONNER (passe securite du 2026-11-08). La Direction
// et le proprietaire de la plateforme donnent tout. Les autres porteurs de « Équipe &
// accès » ne donnent que ce qu ils ont eux-memes : sans cette regle, un rôle « Chef
// d equipe » ajoutait a son PROPRE role « Codes d accès » et « Changer de centre », puis
// lisait le code de la Directrice. Rend la liste des droits refuses, vide si tout passe.
function droitsQueLaSessionNaPas(session, permissions = []) {
  if (!session || session.role?.locked || sessionHasPermission(session, 'platform.admin')) return [];
  const manquants = [];
  for (const brut of Array.isArray(permissions) ? permissions : []) {
    const droit = String(brut || '');
    const niveau = /^niveau:([^:]+):(.+)$/.exec(droit);
    if (niveau) {
      const definition = DROITS_NIVEAUX.find((d) => d.cle === niveau[1]);
      if (!definition) continue;
      const rang = (option) => definition.options.findIndex(([valeur]) => valeur === option);
      if (rang(niveau[2]) > rang(niveauEffectif(session, niveau[1]))) manquants.push(droit);
      continue;
    }
    if (!sessionHasPermission(session, droit)) manquants.push(droit);
  }
  return manquants;
}

// La session telle que la console la range. `centerId` est le centre ou la
// personne travaille a l ecran : pour une personne qui a une ligne dans ce
// centre (meme code), ce sont SON role et SES droits la-bas. `centres` dit ou
// elle peut aller (le menu des centres n en propose pas d autre) ; `null` pour
// le proprietaire de la plateforme, qui va partout.
function publicSession(session, centres) {
  if (!session) return null;
  return {
    cookieBacked: true,
    emergency: Boolean(session.emergency),
    centerId: session.centerId,
    centreDeConnexion: session.centreDeConnexion || session.centerId,
    expiresAt: session.expiresAt,
    member: session.member,
    role: session.role,
    permissions: session.permissions,
    ...(centres === undefined ? {} : { centres }),
  };
}

async function sendSessionSnapshot(req, res, centerId, session = null, extra = {}) {
  const activeSession = session || await getStaffSessionFromRequest(req);
  if (!activeSession) {
    sendJson(res, 200, { ok: true, authenticated: false, accessControl: null });
    return;
  }
  // DEUX BARRIERES, COMME LE POST. `requireStaffPermission` en applique deux :
  // entrer dans ce centre (une ligne de la personne la-bas, ou le droit de
  // tous les centres) PUIS rester chez le meme client. Ce chemin de lecture
  // les refaisait a la main et ne gardait que la premiere. Or `centers.switch`
  // est accordee d office a tout role verrouille : la direction d un client
  // lisait donc `listAccessControl` du centre d un AUTRE client, c est-a-dire
  // ses roles, ses membres, leurs contacts, les quatre derniers caracteres de
  // leurs codes et son journal d acces. La surface la plus sensible du produit.
  // sessionAuCentre fait les deux, dans le meme ordre que le POST.
  const effective = centerId && centerId !== activeSession.centerId
    ? await sessionAuCentre(activeSession, centerId)
    : activeSession;
  if (!effective) {
    sendError(res, 403, 'Acces centre insuffisant.');
    return;
  }
  const canManageUsers = sessionHasPermission(effective, 'users.manage');
  let accessControl = null;
  if (canManageUsers) {
    try {
      accessControl = await listAccessControl(centerId || effective.centerId, { session: effective });
    } catch (error) {
      if (!effective.emergency || !isStaffAuthStorageError(error)) throw error;
      accessControl = createEmergencyAccessControl(centerId || effective.centerId);
    }
  }
  const centres = await centresDeLaSession(effective).catch(() => [effective.centerId]);
  sendJson(res, 200, {
    ok: true,
    authenticated: true,
    session: publicSession(effective, centres),
    accessControl,
    ...extra,
  });
}

// DONNER LE ROLE DIRECTION (Ansar, 2026-11-07 : « donner les roles que je veux
// meme les plus grands »). Un role verrouille (Direction) ne se donne que par
// la Direction elle-meme ou le proprietaire de la plateforme : avant, tout
// porteur de « Creer roles et acces » pouvait faire d un collegue une Direction,
// donc lui donner TOUS les droits, l ecran le cachait mais l API l acceptait.
function peutDonnerLeRole(session, role) {
  if (!role || !role.locked) return true;
  return Boolean(session && (session.role?.locked || sessionHasPermission(session, 'platform.admin')));
}

module.exports = async (req, res) => {
  // Pas d en-tetes CORS ici (passe securite du 2026-11-08) : la console appelle cette route depuis
  // sa propre origine, et aucun autre site ne doit pouvoir lire ses reponses avec le cookie.
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Rendu visible au catch : quand la trace a ete ecrite AVANT la mutation et
  // que la mutation echoue ensuite, le journal doit le dire. Sans cette ligne
  // de rattrapage, l'audit affirmerait qu'un changement de permissions a eu
  // lieu alors qu'il a echoue, ce qui est pire qu'une absence de trace.
  let auditPending = null;
  let auditAction = '';
  let auditCenterId = '';

  try {
    if (req.method === 'GET') {
      const centerId = getCenterId(req);
      await sendSessionSnapshot(req, res, centerId);
      return;
    }

    if (req.method !== 'POST') {
      sendError(res, 405, 'Méthode non autorisée.');
      return;
    }

    if (requeteDUnAutreSite(req)) {
      sendError(res, 403, 'Cette action doit venir de la console.');
      return;
    }

    const body = await readJson(req);
    const action = body.action || 'login';
    const centerId = getCenterId(req, body);
    auditAction = action;
    auditCenterId = centerId;

    if (action === 'login') {
      const loginCode = body.code || body.password || '';
      let payload;
      try {
        payload = await loginStaffByCode({
          centerId,
          code: loginCode,
          fingerprint: getRequestFingerprint(req),
        });
      } catch (error) {
        if (!isStaffAuthStorageError(error)) throw error;
        payload = createEmergencyOwnerSession({ centerId, code: loginCode, fingerprint: getRequestFingerprint(req) });
        if (!payload) throw error;
        // La cle maitresse vient de s ouvrir pendant une panne : Ansar le sait tout de suite.
        await require('../lib/garde-securite').signalerSessionDeSecours().catch(() => null);
      }
      setStaffSessionCookie(req, res, payload.session?.token, payload.session?.expiresAt);

      // La connexion est tracee, mais SANS le corps de requete : body.code y
      // porte le code d'acces staff EN CLAIR (regle T1). On ne journalise donc
      // que le fait, l'identite reconnue et l'empreinte de requete. Un echec de
      // connexion passe par le catch et ressort en outcome 'denied' : c'est le
      // signal "quelqu'un essaie des codes", qui n'existait nulle part avant.
      await writeAuditLog({
        // Le centre de la SESSION, pas celui que la console affichait : c'est
        // le code qui decide ou l'on entre, la trace doit dire ou l'on est.
        centerId: payload.session?.centerId || centerId,
        actorKind: 'staff',
        actorMemberId: payload.session?.member?.id || null,
        actorLabel: payload.session?.member?.name || '',
        actorRoleId: payload.session?.member?.roleId || null,
        surface: 'api/staff-auth.js',
        action: 'login',
        method: 'POST',
        entityType: 'staff_session',
        entityId: payload.session?.member?.id || '',
        outcome: 'success',
        context: { empreinte: getRequestFingerprint(req) },
      });

      sendJson(res, 200, {
        ok: true,
        authenticated: true,
        session: publicSession(payload.session, payload.centres),
        accessControl: payload.accessControl,
      });
      return;
    }

    if (action === 'logout') {
      const session = await getStaffSessionFromRequest(req);
      await logoutStaff(session?.token);
      clearStaffSessionCookie(req, res);
      await writeAuditLog({
        centerId: session?.centerId || centerId,
        ...actorFromSession(session),
        surface: 'api/staff-auth.js',
        action: 'logout',
        method: 'POST',
        entityType: 'staff_session',
        entityId: session?.member?.id || '',
        outcome: 'success',
      });
      sendJson(res, 200, { ok: true, authenticated: false });
      return;
    }

    const session = await requireStaffPermission(req, res, 'users.manage', { centerId });
    if (!session) return;

    // LES CODES D'ACCES SONT UNE SOUS-PERMISSION (2026-08-19). 'security.codes'
    // etait declaree, affichee dans l'editeur de roles, et ne gardait RIEN :
    // la decocher ne changeait rien. Elle garde desormais ce qu'elle nomme,
    // reveler et regenerer un code d'acces, c'est-a-dire le geste par lequel
    // on entre dans la console. Elle est enfant de 'users.manage' (hierarchie
    // PERMISSION_PARENTS) : qui la porte porte forcement son parent, et un
    // role qui gere les equipes SANS ce droit ne peut plus lire les codes.
    const CODE_ACTIONS = ['regenerateRoleCode', 'revealRoleCode', 'revealMemberCode', 'regenerateMemberCode'];
    if (CODE_ACTIONS.includes(action) && !sessionHasPermission(session, 'security.codes')) {
      // Le refus se TRACE, comme toute action sensible de ce dispatcher : un
      // refus muet sur les codes d'acces serait la ligne la plus interessante
      // du journal, et elle manquerait.
      await writeAuditLog({
        centerId,
        ...actorFromSession(session),
        surface: 'api/staff-auth.js',
        action,
        method: 'POST',
        entityType: 'staff_role',
        entityId: String(body.roleId || body.memberId || ''),
        outcome: 'denied',
        context: { permissionManquante: 'security.codes' },
      });
      sendError(res, 403, 'Permission insuffisante.');
      return;
    }

    // ---- PP3 : le dispatcher d'identite ------------------------------------
    //
    // Ce fichier a son PROPRE dispatcher et ne traverse jamais api/ops.js : sans
    // instrumentation ici, les 10 actions les plus sensibles du SaaS (roles,
    // permissions, membres, revelation de codes) resteraient hors du journal.
    //
    // REGIME BLOQUANT, et la trace s'ecrit AVANT la mutation. L'ordre porte la
    // garantie : si le journal est indisponible, l'action ne s'execute pas, et
    // il n'existe aucun changement de permissions non trace. C'est exactement
    // le trou que ce chantier ferme.
    //
    // Le diff est calculable AVANT de muter parce que pour ces actions l'etat
    // demande EST l'etat d'arrivee (permissions envoyees, roleId demande,
    // bascule de statut deterministe). On obtient donc un avant/apres reel dans
    // UNE seule ligne, sans avoir a ecrire apres coup et sans risquer une
    // mutation non tracee.
    //
    // T1 : le corps de requete de ce fichier contient body.code en clair sur
    // l'action login (traitee plus haut, hors de ce bloc). Rien du corps n'est
    // journalise ici en vrac : seule la liste blanche ci-dessous entre, et
    // redactSecrets repasse dessus dans lib/audit-log.js. Les codes renvoyes
    // dans la REPONSE (newAccessCode, revealedCode) ne sont jamais lus.
    const auditRequestId = newRequestId();
    const targetRoleId = String(body.roleId || '');
    const targetMemberId = String(body.memberId || '');

    let auditBefore = null;
    if (['updateRolePermissions', 'setRolePreset', 'regenerateRoleCode', 'revealRoleCode', 'renameRole', 'deleteRole'].includes(action) && targetRoleId) {
      auditBefore = await getAuditSubjectSnapshot({ centerId, roleId: targetRoleId });
    } else if (['updateMemberRole', 'toggleMemberStatus', 'revealMemberCode', 'deleteMember', 'renameMember', 'setMemberBlocked', 'regenerateMemberCode', 'setMemberCenter', 'supprimerPersonne'].includes(action) && targetMemberId) {
      auditBefore = await getAuditSubjectSnapshot({ centerId, memberId: targetMemberId });
    }

    // LES GARDES DES ROLES QUI DONNENT TOUT, avant toute trace et toute
    // ecriture. Le role Direction ne se donne que par la Direction ou le
    // proprietaire de la plateforme ; il ne se renomme que par ce dernier.
    const roleDonne = ['createMember', 'updateMemberRole'].includes(action) && body.roleId
      ? await getRole(centerId, String(body.roleId))
      : null;
    if (roleDonne && !peutDonnerLeRole(session, roleDonne)) {
      await writeAuditLog({ centerId, ...actorFromSession(session), surface: 'api/staff-auth.js', action, method: 'POST', entityType: 'staff_role', entityId: String(body.roleId || ''), outcome: 'denied', context: { raison: 'role verrouille' } });
      sendError(res, 403, 'Seule la direction peut donner ce rôle.');
      return;
    }
    if (action === 'renameRole' && targetRoleId) {
      const visee = await getRole(centerId, targetRoleId);
      if (visee && visee.locked && !sessionHasPermission(session, 'platform.admin')) {
        await writeAuditLog({ centerId, ...actorFromSession(session), surface: 'api/staff-auth.js', action, method: 'POST', entityType: 'staff_role', entityId: targetRoleId, outcome: 'denied', context: { raison: 'role verrouille' } });
        sendError(res, 403, 'Seul le propriétaire de la plateforme renomme ce rôle.');
        return;
      }
    }
    // LES ESCALADES D UN ROLE QUI GERE L EQUIPE SANS ETRE LA DIRECTION (passe securite du
    // 2026-11-08) : il ne change pas les droits de son propre role, ne donne pas un droit
    // qu il n a pas, ne transforme aucun role en Direction, et ne lit ni ne change le code
    // d un role verrouille ou d une personne qui en porte un.
    const estDirection = peutDonnerLeRole(session, { locked: true });
    const refuserEscalade = async (raison, message, entityType = 'staff_role', entityId = targetRoleId) => {
      await writeAuditLog({ centerId, ...actorFromSession(session), surface: 'api/staff-auth.js', action, method: 'POST', entityType, entityId: String(entityId || ''), outcome: 'denied', context: { raison } });
      sendError(res, 403, message);
    };
    if (!estDirection && ['updateRolePermissions', 'setRolePreset'].includes(action) && targetRoleId && targetRoleId === String((session.role && session.role.id) || '')) {
      await refuserEscalade('son propre role', 'Votre rôle ne change pas ses propres droits : demandez à la direction.');
      return;
    }
    const presetVise = action === 'setRolePreset' ? STAFF_ROLE_PRESETS.find((p) => p.id === String(body.presetId || '')) : null;
    if (presetVise && presetVise.locked && !sessionHasPermission(session, 'platform.admin')) {
      await refuserEscalade('modele verrouille', 'Ce modèle ne s’applique pas : la direction est un rôle unique.');
      return;
    }
    const droitsDemandes = action === 'updateRolePermissions' ? (body.permissions || []) : (presetVise ? presetVise.permissions : []);
    const manquants = droitsQueLaSessionNaPas(session, droitsDemandes);
    if (manquants.length) {
      await refuserEscalade(`droit que la session n a pas : ${manquants.slice(0, 5).join(', ')}`, 'Vous ne pouvez pas donner un droit que votre rôle n’a pas.');
      return;
    }
    if (!estDirection && ['revealRoleCode', 'regenerateRoleCode'].includes(action) && auditBefore && auditBefore.locked) {
      await refuserEscalade('code d un role verrouille', 'Seule la direction lit ou change ce code.');
      return;
    }
    if (!estDirection && ['revealMemberCode', 'regenerateMemberCode'].includes(action) && auditBefore && auditBefore.roleId) {
      const roleDeLaCible = await getRole(centerId, String(auditBefore.roleId));
      if (roleDeLaCible && roleDeLaCible.locked) {
        await refuserEscalade('code d une personne de la direction', 'Seule la direction lit ou change ce code.', 'staff_member', targetMemberId);
        return;
      }
    }
    // DONNER UN AUTRE CENTRE : il faut gerer l equipe la-bas aussi. Marius,
    // Manager, n ouvre pas Gembloux a Flavy ; la Direction des deux centres,
    // oui.
    let sessionCible = null;
    const centresCibles = action === 'setMemberCenter'
      ? [String(body.cibleCenterId || '')]
      : (action === 'createMember' && Array.isArray(body.autresCentres) ? body.autresCentres.map(String) : []);
    for (const cible of centresCibles.filter((id) => id && id !== centerId)) {
      sessionCible = await sessionAuCentre(session, cible);
      const roleLaBas = body.roleId ? await getRole(cible, String(body.roleId)) : null;
      if (!sessionCible || !sessionHasPermission(sessionCible, 'users.manage') || (roleLaBas && !peutDonnerLeRole(sessionCible, roleLaBas))) {
        await writeAuditLog({ centerId, ...actorFromSession(session), surface: 'api/staff-auth.js', action, method: 'POST', entityType: 'staff_member', entityId: targetMemberId, outcome: 'denied', context: { centreDemande: cible, raison: 'equipe du centre cible' } });
        sendError(res, 403, 'Vous ne gérez pas l’équipe de ce centre.');
        return;
      }
    }

    let auditChanges = {};
    if (action === 'updateRolePermissions') {
      const after = Array.isArray(body.permissions) ? body.permissions : [];
      const before = (auditBefore && auditBefore.permissions) || [];
      auditChanges = buildChanges({ permissions: before }, { permissions: after }, ['permissions']);
      // Le diff brut (deux listes) se lit mal. Ajoutees / retirees se lit d'un
      // coup d'oeil, et c'est LA question qu'on pose a un journal de droits.
      auditChanges.permissionsAjoutees = { before: null, after: after.filter((p) => !before.includes(p)) };
      auditChanges.permissionsRetirees = { before: null, after: before.filter((p) => !after.includes(p)) };
    } else if (action === 'setRolePreset') {
      auditChanges = buildChanges(
        { presetId: (auditBefore && auditBefore.tone) || '', permissions: (auditBefore && auditBefore.permissions) || [] },
        { presetId: String(body.presetId || ''), permissions: null },
        ['presetId'],
      );
    } else if (action === 'updateMemberRole') {
      auditChanges = buildChanges(
        { roleId: (auditBefore && auditBefore.roleId) || '' },
        { roleId: String(body.roleId || '') },
        ['roleId'],
      );
    } else if (action === 'toggleMemberStatus') {
      const before = (auditBefore && auditBefore.status) || '';
      auditChanges = buildChanges({ status: before }, { status: before === 'blocked' ? 'active' : 'blocked' }, ['status']);
    } else if (action === 'renameRole' || action === 'renameMember') {
      auditChanges = buildChanges(
        { name: (auditBefore && auditBefore.name) || '' },
        { name: String(body.name || '') },
        ['name'],
      );
    } else if (action === 'setMemberBlocked') {
      auditChanges = buildChanges(
        { status: (auditBefore && auditBefore.status) || '' },
        { status: body.bloque === true ? 'blocked' : 'active' },
        ['status'],
      );
    }

    const auditEntity = targetMemberId
      ? { entityType: 'staff_member', entityId: targetMemberId }
      : { entityType: 'staff_role', entityId: targetRoleId };

    const auditBase = {
      centerId,
      ...actorFromSession(session),
      surface: 'api/staff-auth.js',
      action,
      method: 'POST',
      ...auditEntity,
      requestId: auditRequestId,
      changes: auditChanges,
      context: {
        cible: (auditBefore && auditBefore.name) || '',
        presetId: String(body.presetId || ''),
        nouveauNom: String(body.name || ''),
        ...(action === 'setMemberCenter' ? { centreCible: String(body.cibleCenterId || ''), roleCible: String(body.roleId || '') } : {}),
        ...(action === 'createMember' && Array.isArray(body.autresCentres) ? { autresCentres: body.autresCentres.map(String) } : {}),
      },
    };

    if (action !== 'snapshot') {
      await writeAuditLogOrThrow({ ...auditBase, outcome: 'success' });
      auditPending = auditBase;
    }

    // Le membre de la SESSION (sa ligne du centre de connexion) en plus de celui
    // du centre a l ecran : une personne ne se bloque, ne se retire ni ne se
    // supprime elle-meme, depuis aucun de ses centres.
    const sessionMemberId = session.membreDeConnexion || session.member.id;

    let extra = {};
    if (action === 'createRole') {
      const result = await createRole({
        centerId,
        actorMemberId: session.member.id,
        name: body.name,
        permissions: body.permissions || [],
        presetId: String(body.presetId || ''),
      });
      extra = { createdRole: result.role, newAccessCode: result.accessCode };
    } else if (action === 'renameMember') {
      await renameMember({ centerId, actorMemberId: session.member.id, memberId: body.memberId, name: body.name });
    } else if (action === 'setMemberBlocked') {
      await setMemberBlocked({ centerId, actorMemberId: session.member.id, sessionMemberId, memberId: body.memberId, bloque: body.bloque === true });
    } else if (action === 'regenerateMemberCode') {
      const result = await regenerateMemberCode({ centerId, actorMemberId: session.member.id, sessionMemberId, memberId: body.memberId });
      extra = { newAccessCode: result.accessCode };
    } else if (action === 'setMemberCenter') {
      await setMemberCenter({ centerId, actorMemberId: session.member.id, sessionMemberId, memberId: body.memberId, cibleCenterId: body.cibleCenterId, roleId: body.roleId || '' });
    } else if (action === 'supprimerPersonne') {
      await supprimerPersonne({ centerId, actorMemberId: session.member.id, sessionMemberId, memberId: body.memberId });
      extra = { deletedMemberId: String(body.memberId || '') };
    } else if (action === 'updateRolePermissions') {
      await updateRolePermissions({
        centerId,
        actorMemberId: session.member.id,
        roleId: body.roleId,
        permissions: body.permissions || [],
      });
    } else if (action === 'setRolePreset') {
      await setRolePreset({
        centerId,
        actorMemberId: session.member.id,
        roleId: body.roleId,
        presetId: body.presetId,
      });
    } else if (action === 'regenerateRoleCode') {
      const result = await regenerateRoleCode({
        centerId,
        actorMemberId: session.member.id,
        roleId: body.roleId,
      });
      extra = { updatedRole: result.role, newAccessCode: result.accessCode };
    } else if (action === 'revealRoleCode') {
      // Révèle+copie le code ACTUEL sans le régénérer. Gated à users.manage via
      // requireStaffPermission ci-dessus (Direction / Propriétaire plateforme).
      // Réponse minimale : le clair n'apparaît que dans revealedCode, jamais loggé.
      const result = await revealRoleCode({
        centerId,
        actorMemberId: session.member.id,
        roleId: body.roleId,
      });
      sendJson(res, 200, { ok: true, revealedCode: result.code, needsRegenerate: result.needsRegenerate });
      return;
    } else if (action === 'revealMemberCode') {
      const result = await revealMemberCode({
        centerId,
        actorMemberId: session.member.id,
        memberId: body.memberId,
      });
      sendJson(res, 200, { ok: true, revealedCode: result.code, needsRegenerate: result.needsRegenerate });
      return;
    } else if (action === 'createMember') {
      const result = await createMember({
        centerId,
        actorMemberId: session.member.id,
        name: body.name,
        contact: body.contact || '',
        roleId: body.roleId || 'staff-bar',
        autresCentres: Array.isArray(body.autresCentres) ? body.autresCentres : [],
      });
      extra = { createdMember: result.member, newAccessCode: result.accessCode };
    } else if (action === 'updateMemberRole') {
      const result = await updateMemberRole({
        centerId,
        actorMemberId: session.member.id,
        memberId: body.memberId,
        roleId: body.roleId,
      });
      extra = { updatedMember: result.member };
    } else if (action === 'toggleMemberStatus') {
      const member = await toggleMemberStatus({
        centerId,
        actorMemberId: session.member.id,
        memberId: body.memberId,
      });
      extra = { updatedMember: member };
    } else if (action === 'renameRole') {
      const result = await renameRole({
        centerId,
        actorMemberId: session.member.id,
        roleId: body.roleId,
        name: body.name,
        verrouillePermis: sessionHasPermission(session, 'platform.admin'),
      });
      extra = { updatedRole: { id: result.id, name: result.name } };
    } else if (action === 'deleteRole') {
      await deleteRole({
        centerId,
        actorMemberId: session.member.id,
        roleId: body.roleId,
      });
      extra = { deletedRoleId: String(body.roleId || '') };
    } else if (action === 'deleteMember') {
      await deleteMember({
        centerId,
        actorMemberId: session.member.id,
        memberId: body.memberId,
      });
      extra = { deletedMemberId: String(body.memberId || '') };
    } else if (action === 'snapshot') {
      extra = {};
    } else {
      sendError(res, 400, 'Action staff auth inconnue.');
      return;
    }

    auditPending = null;
    await sendSessionSnapshot(req, res, centerId, session, extra);
  } catch (error) {
    // La trace d'intention existe deja et affirme un succes : on la corrige par
    // une seconde ligne portant le MEME requestId. Regime non bloquant ici, la
    // requete est deja en train d'echouer.
    // Echec de connexion : c'est LE signal "quelqu'un essaie des codes". Il
    // n'etait trace nulle part avant ce chantier. Aucun element du corps de
    // requete n'est conserve : body.code y est en clair (T1).
    if (auditAction === 'login' && !error.auditBlocked) {
      await writeAuditLog({
        centerId: auditCenterId || 'libramont',
        actorKind: 'public',
        actorMemberId: null,
        actorLabel: 'connexion refusee',
        surface: 'api/staff-auth.js',
        action: 'login',
        method: 'POST',
        entityType: 'staff_session',
        outcome: 'denied',
        deniedReason: '401_bad_code',
        context: { empreinte: getRequestFingerprint(req) },
      });
    }

    if (auditPending && !error.auditBlocked) {
      await writeAuditLog({
        ...auditPending,
        outcome: 'error',
        context: {
          ...auditPending.context,
          erreur: String((error && error.message) || 'erreur').slice(0, 300),
          annuleLaLignePrecedente: true,
        },
      });
    }
    if (error.retryAfterSeconds) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    const isStorageError = isStaffAuthStorageError(error);
    // CE QUI PART AU CLIENT EST CE QUE CE PRODUIT A ECRIT POUR LUI. Une erreur
    // venue de la base est un incident, pas une reponse : elle prend un
    // message neutre et un code 500 (dire 400 ferait porter au client la faute
    // du serveur). Son detail reste dans la trace d audit ecrite juste avant.
    const venuDeLaBase = !isStorageError && isDatabaseError(error);
    if (isStorageError || venuDeLaBase) require('../lib/garde-serveur').signalerPanneServeur('api/staff-auth', error);
    sendError(
      res,
      isStorageError ? 503 : (venuDeLaBase ? 500 : (error.statusCode || 400)),
      isStorageError
        ? publicStorageErrorMessage()
        : (venuDeLaBase ? publicIncidentMessage() : (error.message || 'Authentification staff impossible.')),
    );
  }
};

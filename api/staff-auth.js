const {
  createMember,
  createEmergencyAccessControl,
  createEmergencyOwnerSession,
  createRole,
  renameRole,
  deleteRole,
  deleteMember,
  getAuditSubjectSnapshot,
  STAFF_SESSION_COOKIE,
  getStaffSessionFromRequest,
  isStaffAuthStorageError,
  listAccessControl,
  loginStaffByCode,
  logoutStaff,
  normalizeStaffCenterId,
  regenerateRoleCode,
  revealRoleCode,
  revealMemberCode,
  requireStaffPermission,
  sessionHasPermission,
  setRolePreset,
  toggleMemberStatus,
  updateMemberRole,
  updateRolePermissions,
  publicStorageErrorMessage,
} = require('../lib/staff-auth');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
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

function getRequestFingerprint(req) {
  return String(
    req.headers['x-forwarded-for']
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || req.headers['user-agent']
    || 'unknown',
  ).split(',')[0].trim();
}

function publicSession(session) {
  if (!session) return null;
  return {
    cookieBacked: true,
    emergency: Boolean(session.emergency),
    centerId: session.centerId,
    expiresAt: session.expiresAt,
    member: session.member,
    role: session.role,
    permissions: session.permissions,
  };
}

async function sendSessionSnapshot(req, res, centerId, session = null, extra = {}) {
  const activeSession = session || await getStaffSessionFromRequest(req);
  if (!activeSession) {
    sendJson(res, 200, { ok: true, authenticated: false, accessControl: null });
    return;
  }
  if (
    centerId
    && centerId !== activeSession.centerId
    && !sessionHasPermission(activeSession, 'centers.switch')
  ) {
    sendError(res, 403, 'Acces centre insuffisant.');
    return;
  }
  const canManageUsers = activeSession.permissions.includes('users.manage') || activeSession.role?.locked;
  let accessControl = null;
  if (canManageUsers) {
    try {
      accessControl = await listAccessControl(centerId || activeSession.centerId);
    } catch (error) {
      if (!activeSession.emergency || !isStaffAuthStorageError(error)) throw error;
      accessControl = createEmergencyAccessControl(centerId || activeSession.centerId);
    }
  }
  sendJson(res, 200, {
    ok: true,
    authenticated: true,
    session: publicSession(activeSession),
    accessControl,
    ...extra,
  });
}

module.exports = async (req, res) => {
  setCors(res, 'GET,POST,OPTIONS');

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
        payload = createEmergencyOwnerSession({ centerId, code: loginCode });
        if (!payload) throw error;
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
        session: publicSession(payload.session),
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
    const CODE_ACTIONS = ['regenerateRoleCode', 'revealRoleCode', 'revealMemberCode'];
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
    } else if (['updateMemberRole', 'toggleMemberStatus', 'revealMemberCode', 'deleteMember'].includes(action) && targetMemberId) {
      auditBefore = await getAuditSubjectSnapshot({ centerId, memberId: targetMemberId });
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
    } else if (action === 'renameRole') {
      auditChanges = buildChanges(
        { name: (auditBefore && auditBefore.name) || '' },
        { name: String(body.name || '') },
        ['name'],
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
      },
    };

    if (action !== 'snapshot') {
      await writeAuditLogOrThrow({ ...auditBase, outcome: 'success' });
      auditPending = auditBase;
    }

    let extra = {};
    if (action === 'createRole') {
      const result = await createRole({
        centerId,
        actorMemberId: session.member.id,
        name: body.name,
        permissions: body.permissions || [],
      });
      extra = { createdRole: result.role, newAccessCode: result.accessCode };
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
      });
      extra = { createdMember: result.member, newAccessCode: result.accessCode };
    } else if (action === 'updateMemberRole') {
      const result = await updateMemberRole({
        centerId,
        actorMemberId: session.member.id,
        memberId: body.memberId,
        roleId: body.roleId,
      });
      extra = { updatedMember: result.member, newAccessCode: result.accessCode };
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
    sendError(res, isStorageError ? 503 : (error.statusCode || 400), isStorageError ? publicStorageErrorMessage() : (error.message || 'Authentification staff impossible.'));
  }
};

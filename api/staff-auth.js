const {
  createMember,
  createEmergencyAccessControl,
  createEmergencyOwnerSession,
  createRole,
  STAFF_SESSION_COOKIE,
  getStaffSessionFromRequest,
  isStaffAuthStorageError,
  listAccessControl,
  loginStaffByCode,
  logoutStaff,
  normalizeStaffCenterId,
  regenerateRoleCode,
  requireStaffPermission,
  sessionHasPermission,
  setRolePreset,
  toggleMemberStatus,
  updateMemberRole,
  updateRolePermissions,
  publicStorageErrorMessage,
} = require('../lib/staff-auth');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');

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
      sendJson(res, 200, { ok: true, authenticated: false });
      return;
    }

    const session = await requireStaffPermission(req, res, 'users.manage', { centerId });
    if (!session) return;

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
    } else if (action === 'snapshot') {
      extra = {};
    } else {
      sendError(res, 400, 'Action staff auth inconnue.');
      return;
    }

    await sendSessionSnapshot(req, res, centerId, session, extra);
  } catch (error) {
    if (error.retryAfterSeconds) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    const isStorageError = isStaffAuthStorageError(error);
    sendError(res, isStorageError ? 503 : (error.statusCode || 400), isStorageError ? publicStorageErrorMessage() : (error.message || 'Authentification staff impossible.'));
  }
};

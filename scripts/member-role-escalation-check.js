// Gate anti-escalade : updateMemberRole ne peut JAMAIS attribuer un role
// porteur d'une permission plateforme (platform.admin).
//
// POURQUOI CE GATE EXISTE. Le durcissement anti-escalade a d'abord ete pose sur
// les ECRITURES de roles (stripPlatformPermissions sur createRole /
// updateRolePermissions) : impossible de FABRIQUER un role porteur de
// platform.admin. Mais le role platform-owner est SEEDE sur chaque centre
// (migration 0032) : il n'y a rien a fabriquer, il suffit de l'ASSIGNER. Sans
// garde dans updateMemberRole, un porteur de users.manage (toute directrice)
// attribuait platform-owner a un membre qu'il controle, recevait le code
// d'acces en clair, se connectait, et ouvrait le cockpit fondateur (tous les
// centres, couts IA, prospects). Escalade verticale + rupture d'isolation
// multi-tenant. founder-cockpit-check teste le gate de LECTURE du cockpit,
// jamais ce chemin d'assignation : le trou passait les gates verts.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif. On exerce le VRAI updateMemberRole (pas un stub), et on
// eprouve les DEUX sens : le role plateforme est REFUSE (403), un role normal
// PASSE la garde. Un fix qui retirerait la garde ferait rougir le 1er point ;
// une garde trop large (qui bloquerait aussi les roles normaux) ferait rougir
// le 2e.
//
// Lancement : node scripts/member-role-escalation-check.js

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// Role renvoye par la requete getRole selon le roleId demande (params[1]).
const ROLE_ROWS = {
  'platform-owner': {
    center_id: 'libramont',
    id: 'platform-owner',
    name: 'Proprietaire plateforme',
    code: 'PL',
    permissions: ['dashboard.view', 'users.manage', 'platform.admin'],
    locked: true,
  },
  manager: {
    center_id: 'libramont',
    id: 'manager',
    name: 'Manager',
    code: 'MG',
    permissions: ['dashboard.view', 'reservations.view', 'reservations.edit'],
    locked: false,
  },
};

class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text, params = []) {
    const sql = String(text);
    // getRole : select * from staff_roles where center_id=$1 and id=$2
    if (/from staff_roles\b/i.test(sql) && /\bid = \$2\b/.test(sql)) {
      const row = ROLE_ROWS[params[1]];
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    // update staff_members ... returning * : membre cible mis a jour (le
    // chemin legitime doit aboutir pour le role normal).
    if (/update staff_members/i.test(sql) && /returning/i.test(sql)) {
      return {
        rows: [{
          center_id: params[0], id: params[1], name: 'Membre Demo',
          role_id: params[2], status: 'pending',
        }],
        rowCount: 1,
      };
    }
    // Tout le reste (bootstrap schema, access_events, ...) : vide plausible.
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
// Le bootstrap de schema staff-auth exige des codes d'acces en environnement :
// on active le repli de developpement prevu (refuse en production).
process.env.ALLOW_INSECURE_STAFF_CODES = 'true';

const { updateMemberRole } = require(path.join(ROOT, 'lib', 'staff-auth.js'));

async function main() {
  // (1) Attribuer un role porteur de platform.admin -> REFUS 403.
  let refused = false;
  let refusedStatus = null;
  try {
    await updateMemberRole({ centerId: 'libramont', actorMemberId: 'libramont:demo-direction', memberId: 'libramont:cible', roleId: 'platform-owner' });
  } catch (error) {
    refused = true;
    refusedStatus = error.statusCode;
  }
  ok(refused, "updateMemberRole('platform-owner') est REFUSE (escalade centre -> plateforme bloquee)");
  ok(refusedStatus === 403, `le refus est un 403 expose (recu: ${refusedStatus})`);

  // (2) Attribuer un role normal -> la garde ne bloque pas, le chemin aboutit.
  let normalOk = false;
  let normalError = null;
  try {
    const result = await updateMemberRole({ centerId: 'libramont', actorMemberId: 'libramont:demo-direction', memberId: 'libramont:cible', roleId: 'manager' });
    normalOk = Boolean(result && result.member && result.member.roleId === 'manager');
  } catch (error) {
    normalError = error.message;
  }
  ok(normalOk, `updateMemberRole('manager') PASSE la garde (pas de faux positif)${normalError ? ' - erreur: ' + normalError : ''}`);

  if (failures) {
    console.error(`\nmember-role-escalation-check: ${failures} echec(s).`);
    process.exit(1);
  }
  console.log('\nmember-role-escalation-check: ALL OK (assignation plateforme refusee, roles normaux intacts)');
  process.exit(0);
}

main().catch((error) => {
  console.error('member-role-escalation-check: erreur inattendue:', error && (error.stack || error.message));
  process.exit(1);
});

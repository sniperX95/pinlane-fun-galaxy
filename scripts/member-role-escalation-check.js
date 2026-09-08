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

// Le code chiffre, capture a la creation puis resservi aux revelations.
const CHIFFRE = { valeur: '' };

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
    // select ... from staff_members : cible d une revelation de code. Le
    // role_id decide si la cible est le proprietaire plateforme.
    if (/from staff_members/i.test(sql) && /access_code_enc/i.test(sql)) {
      const vise = String(params[1] || '');
      const role = vise.endsWith(':platform-owner') ? 'platform-owner' : 'manager';
      return { rows: [{ role_id: role, access_code_enc: CHIFFRE.valeur }], rowCount: 1 };
    }
    // select ... from staff_roles avec access_code_enc : revelation du code
    // d un role. On rend les permissions du role vise.
    if (/from staff_roles/i.test(sql) && /access_code_enc/i.test(sql)) {
      const row = ROLE_ROWS[params[1]];
      return { rows: row ? [{ permissions: row.permissions, access_code_enc: CHIFFRE.valeur }] : [], rowCount: row ? 1 : 0 };
    }
    // update staff_roles ... returning * : regeneration du code d un role.
    if (/update staff_roles/i.test(sql) && /returning/i.test(sql)) {
      const row = ROLE_ROWS[params[1]] || ROLE_ROWS.manager;
      return { rows: [Object.assign({}, row, { center_id: params[0] })], rowCount: 1 };
    }
    // insert into staff_members ... returning * : creation d un membre. Le
    // chemin legitime doit aboutir, sinon un refus ne prouverait rien (il
    // pourrait venir du bouchon et non de la garde).
    if (/insert into staff_members/i.test(sql) && /returning/i.test(sql)) {
      // params[7] est le code chiffre par la VRAIE fonction du module.
      if (params[7]) CHIFFRE.valeur = params[7];
      return {
        rows: [{
          center_id: params[1], id: params[0], name: params[2], contact: params[3],
          role_id: params[4], status: 'pending',
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

const { updateMemberRole, createMember, revealMemberCode, regenerateRoleCode, revealRoleCode } = require(path.join(ROOT, 'lib', 'staff-auth.js'));

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

  // (3) CREER un membre porteur d un role plateforme -> REFUS 403.
  //
  //     La garde vivait uniquement dans updateMemberRole. createMember prend
  //     pourtant le meme roleId depuis le meme corps de requete, sous la meme
  //     permission users.manage, et rend le code d acces EN CLAIR dans sa
  //     reponse. Une direction de centre creait donc un membre platform-owner,
  //     lisait son code, se connectait, et ouvrait le cockpit fondateur : tous
  //     les centres. Verrouiller une porte et laisser la voisine ouverte ne
  //     verrouille rien.
  let createRefused = false;
  let createStatus = null;
  try {
    await createMember({ centerId: 'libramont', actorMemberId: 'libramont:demo-direction', name: 'Complice', roleId: 'platform-owner' });
  } catch (error) {
    createRefused = true;
    createStatus = error.statusCode;
  }
  ok(createRefused, "createMember('platform-owner') est REFUSE (meme escalade, par la porte de la creation)");
  ok(createStatus === 403, `le refus de creation est un 403 expose (recu: ${createStatus})`);

  // (4) MONTAGE ET ABSENCE DE FAUX POSITIF : creer un membre avec un role
  //     normal doit aboutir. Sans ce controle, un refus generalise (ou un
  //     bouchon incapable de repondre a l INSERT) rendrait le controle (3)
  //     vert sans rien prouver.
  let createOk = false;
  let createError = null;
  try {
    const result = await createMember({ centerId: 'libramont', actorMemberId: 'libramont:demo-direction', name: 'Equipier', roleId: 'manager' });
    createOk = Boolean(result && result.member && result.member.roleId === 'manager' && result.accessCode);
  } catch (error) {
    createError = error.message;
  }
  ok(createOk, `createMember('manager') PASSE la garde et rend un code (pas de faux positif)${createError ? ' - erreur: ' + createError : ''}`);

  // ---- LES PORTES QUI RENDENT UN CODE EN CLAIR --------------------------
  //
  // Assigner un role plateforme est desormais refuse. Mais trois autres
  // actions prennent leur cible dans le corps de la requete sous la meme
  // permission, et rendent un code d entree EN CLAIR. Si elles ne regardent
  // pas le role de la CIBLE, l attaquant ne fabrique plus rien : il lit la
  // cle. Chaque centre porte un membre `<centre>:platform-owner` chiffre avec
  // le code proprietaire GLOBAL, et le role `platform-owner` seede n est
  // neutralise que par une sentinelle dans sa colonne de hash, qu une
  // regeneration ecrase.

  // (5) MONTAGE : reveler le code d un membre NORMAL doit aboutir et rendre
  //     un code non vide. Sans ce controle, un refus au point (6) pourrait
  //     venir d un dechiffrement rate et ne prouverait rien.
  let normalReveal = null;
  let normalRevealErreur = null;
  try {
    normalReveal = await revealMemberCode({ centerId: 'libramont', actorMemberId: 'libramont:demo-direction', memberId: 'libramont:membre-normal' });
  } catch (error) { normalRevealErreur = error.message; }
  ok(Boolean(normalReveal && normalReveal.code),
    `MONTAGE : revealMemberCode rend bien un code pour un membre normal${normalRevealErreur ? ' - erreur: ' + normalRevealErreur : ''}`);

  // (6) Reveler le code du membre PROPRIETAIRE PLATEFORME -> REFUS 403.
  let revealRefused = false;
  let revealStatus = null;
  try {
    await revealMemberCode({ centerId: 'libramont', actorMemberId: 'libramont:demo-direction', memberId: 'libramont:platform-owner' });
  } catch (error) { revealRefused = true; revealStatus = error.statusCode; }
  ok(revealRefused, "revealMemberCode sur le membre plateforme est REFUSE (le code proprietaire ouvre TOUS les centres)");
  ok(revealStatus === 403, `le refus de revelation est un 403 expose (recu: ${revealStatus})`);

  // (7) MONTAGE : regenerer le code d un role NORMAL doit aboutir.
  let normalRegen = null;
  let normalRegenErreur = null;
  try {
    normalRegen = await regenerateRoleCode({ centerId: 'libramont', actorMemberId: 'libramont:demo-direction', roleId: 'manager' });
  } catch (error) { normalRegenErreur = error.message; }
  ok(Boolean(normalRegen && normalRegen.accessCode),
    `MONTAGE : regenerateRoleCode rend bien un code pour un role normal${normalRegenErreur ? ' - erreur: ' + normalRegenErreur : ''}`);

  // (8) Regenerer le code du role PLATEFORME -> REFUS 403. Sans ce refus, la
  //     sentinelle qui neutralise ce role est ecrasee par un hash valide, et
  //     la connexion PAR CODE DE ROLE ouvre une session platform.admin.
  let regenRefused = false;
  let regenStatus = null;
  try {
    await regenerateRoleCode({ centerId: 'libramont', actorMemberId: 'libramont:demo-direction', roleId: 'platform-owner' });
  } catch (error) { regenRefused = true; regenStatus = error.statusCode; }
  ok(regenRefused, "regenerateRoleCode sur le role plateforme est REFUSE (sinon la sentinelle saute et le role devient connectable)");
  ok(regenStatus === 403, `le refus de regeneration est un 403 expose (recu: ${regenStatus})`);

  // (9) Reveler le code du role PLATEFORME -> REFUS 403, meme raison.
  let revealRoleRefused = false;
  try {
    await revealRoleCode({ centerId: 'libramont', actorMemberId: 'libramont:demo-direction', roleId: 'platform-owner' });
  } catch (error) { revealRoleRefused = true; }
  ok(revealRoleRefused, "revealRoleCode sur le role plateforme est REFUSE");

  if (failures) {
    console.error(`\nmember-role-escalation-check: ${failures} echec(s).`);
    process.exit(1);
  }
  console.log('\nmember-role-escalation-check: ALL OK (assignation ET creation plateforme refusees, roles normaux intacts)');
  process.exit(0);
}

main().catch((error) => {
  console.error('member-role-escalation-check: erreur inattendue:', error && (error.stack || error.message));
  process.exit(1);
});

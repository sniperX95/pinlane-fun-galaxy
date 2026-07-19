// Gate d'isolation multi-tenant sur les ECRITURES par id (P0-2a).
// Zero reseau, zero base : le module 'pg' est remplace dans require.cache AVANT
// le chargement de lib/database.js, donc getPool() construit un faux Pool.
//
// Ce que ce gate prouve reellement :
//   1. la requete SQL emise porte un predicat center_id et le centre voyage bien
//      en PARAMETRE (jamais concatene dans le texte SQL) ;
//   2. muter la ligne d'un AUTRE centre rend une erreur 404 EXPOSEE
//      (statusCode 404 + expose true), pas un 503 generique qui polluerait les
//      logs et cacherait la cause au staff.
//
// Le faux pool applique le filtre centre UNIQUEMENT si la requete le demande :
// sur du code non corrige (sans predicat) la mutation trans-centre reussit et
// l'assertion 404 tombe. C'est ce qui rend ce test capable de virer au rouge.
//
// Limite assumee : ce gate couvre les deux fonctions citees, il ne fait pas
// l'inventaire de toutes les ecritures par id du depot.
// Lancement : node scripts/tenant-write-scope-check.js

const path = require('path');
const fs = require('fs');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// -- Faux pool pg, installe avant tout require applicatif ---------------------
const sqlLog = [];

const customRequests = [
  { id: 1, center_id: 'libramont', contact_name: 'Prospect Libramont', email: 'lead@exemple.be', phone: '+32470000001', message: 'Besoin confidentiel', status: 'new' },
  { id: 2, center_id: 'arlon', contact_name: 'Prospect Arlon', email: 'autre@exemple.be', phone: '+32470000002', message: 'Autre centre', status: 'new' },
];

const directionReports = [
  { id: 10, center_id: 'libramont', period_type: 'week', period_start: '2026-07-06', period_end: '2026-07-12', title: 'Bilan Libramont', body_md: 'texte', generated_by: 'deterministic' },
  { id: 11, center_id: 'arlon', period_type: 'week', period_start: '2026-07-06', period_end: '2026-07-12', title: 'Bilan Arlon', body_md: 'texte', generated_by: 'deterministic' },
];

// Le faux moteur obeit AU TEXTE de la requete : il n'applique le filtre centre
// que si le SQL le contient vraiment. Aucune indulgence, sinon le gate mentirait.
function centerParamFor(sql, params, placeholder) {
  const predicate = new RegExp(`center_id\\s*=\\s*\\$${placeholder}`);
  if (!predicate.test(sql)) return '';
  return String(params[placeholder - 1] || '');
}

function selectRows(rows, id, centerFilter) {
  return rows.filter((row) => Number(row.id) === Number(id)
    && (centerFilter === '' || row.center_id === centerFilter));
}

class FakePool {
  constructor(options = {}) {
    this.options = options;
  }

  async query(text, params = []) {
    const sql = String(text);
    sqlLog.push({ sql, params });

    if (/update\s+custom_requests/i.test(sql)) {
      const matched = selectRows(customRequests, params[0], centerParamFor(sql, params, 3));
      matched.forEach((row) => { row.status = params[1]; });
      return { rows: matched, rowCount: matched.length };
    }

    if (/update\s+direction_reports/i.test(sql)) {
      const matched = selectRows(directionReports, params[0], centerParamFor(sql, params, 5));
      matched.forEach((row) => { row.body_md = params[1]; row.edited_by = params[3]; });
      return { rows: matched, rowCount: matched.length };
    }

    return { rows: [], rowCount: 0 };
  }

  async connect() { return { query: (text, params) => this.query(text, params), release() {} }; }

  async end() {}
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = {
  id: pgPath,
  filename: pgPath,
  loaded: true,
  exports: { Pool: FakePool },
};

const databasePath = require.resolve('../lib/database');
delete require.cache[databasePath];
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/gate';
process.env.DATABASE_SSL = 'disable';
// On teste le DEFAUT du code, pas la config de la machine qui lance le gate.
delete process.env.DATABASE_POOL_MAX;

const { updateCustomRequestStatus, updateDirectionReportBody, getPool } = require('../lib/database');

function readProjectFile(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

async function captureError(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

(async () => {
  // -- [CUSTOM] custom_requests ---------------------------------------------
  console.log('[CUSTOM] updateCustomRequestStatus');
  sqlLog.length = 0;
  const sameCenter = await updateCustomRequestStatus(1, 'handled', { centerId: 'libramont' });
  const customSql = sqlLog[0] || { sql: '', params: [] };
  ok(/center_id\s*=\s*\$3/.test(customSql.sql), 'le SQL porte un predicat center_id parametre');
  ok(!/center_id\s*=\s*'/.test(customSql.sql), 'le centre voyage en parametre, jamais concatene dans le SQL');
  ok(customSql.params[2] === 'libramont', `le centre est bien passe en parametre (obtenu ${JSON.stringify(customSql.params[2])})`);
  ok(sameCenter && sameCenter.status === 'handled', 'une demande de SON centre reste mutable');

  sqlLog.length = 0;
  const crossCenter = await captureError(() => updateCustomRequestStatus(2, 'handled', { centerId: 'libramont' }));
  ok(crossCenter instanceof Error, 'muter la demande d un AUTRE centre leve une erreur');
  ok(crossCenter && crossCenter.statusCode === 404, `erreur 404 et non 503 generique (obtenu statusCode=${crossCenter && crossCenter.statusCode})`);
  ok(crossCenter && crossCenter.expose === true, `erreur exposee au staff (obtenu expose=${crossCenter && crossCenter.expose})`);
  ok(customRequests[1].status === 'new', 'la ligne de l autre centre n a PAS ete mutee');

  const invalidStatus = await captureError(() => updateCustomRequestStatus(1, 'nimporte quoi', { centerId: 'libramont' }));
  ok(invalidStatus && invalidStatus.statusCode === 400 && invalidStatus.expose === true,
    `statut invalide rend 400 expose (obtenu ${invalidStatus && invalidStatus.statusCode})`);

  // -- [DIRECTION] direction_reports ----------------------------------------
  console.log('\n[DIRECTION] updateDirectionReportBody');
  sqlLog.length = 0;
  const ownReport = await updateDirectionReportBody({ id: 10, bodyMd: 'edite', title: '', editedBy: 'gerant', centerId: 'libramont' });
  const reportSql = sqlLog[0] || { sql: '', params: [] };
  ok(/center_id\s*=\s*\$5/.test(reportSql.sql), 'le SQL porte un predicat center_id parametre');
  ok(!/center_id\s*=\s*'/.test(reportSql.sql), 'le centre voyage en parametre, jamais concatene dans le SQL');
  ok(reportSql.params[4] === 'libramont', `le centre est bien passe en parametre (obtenu ${JSON.stringify(reportSql.params[4])})`);
  ok(ownReport && ownReport.bodyMd === 'edite', 'un bilan de SON centre reste editable');

  const crossReport = await captureError(() => updateDirectionReportBody({ id: 11, bodyMd: 'pirate', title: '', editedBy: 'gerant', centerId: 'libramont' }));
  ok(crossReport instanceof Error, 'editer le bilan d un AUTRE centre leve une erreur');
  ok(crossReport && crossReport.statusCode === 404, `erreur 404 et non 503 generique (obtenu statusCode=${crossReport && crossReport.statusCode})`);
  ok(crossReport && crossReport.expose === true, `erreur exposee au staff (obtenu expose=${crossReport && crossReport.expose})`);
  ok(directionReports[1].body_md === 'texte', 'le bilan de l autre centre n a PAS ete ecrase');

  // -- [CABLAGE] les appelants passent bien le centre ------------------------
  // Un predicat SQL correct ne sert a rien si api/ops.js oublie de l alimenter.
  console.log('\n[CABLAGE] api/ops.js alimente le scope');
  const opsSource = readProjectFile('api/ops.js');
  // La VALEUR compte autant que la cle : `{ centerId: body.centerId }` serait
  // controle par le client et rouvrirait la mutation cross-tenant tout en
  // gardant une assertion sur la seule cle au vert.
  ok(/updateCustomRequestStatus\(body\.id,\s*body\.status,\s*\{\s*centerId:\s*scopedCenterId\s*\}\)/.test(opsSource),
    'customRequestStatus transmet le centre de session (scopedCenterId), pas une valeur du client');
  const saveBlock = opsSource.slice(opsSource.indexOf("if (action === 'saveDirectionReport')"),
    opsSource.indexOf("if (action === 'saveDirectionReport')") + 900);
  ok(/centerId:\s*requireConcreteCenter\(/.test(saveBlock),
    'saveDirectionReport exige un centre precis (400 explicite, pas de scope all)');

  // -- [POOL] plafond de connexions explicite (P2-10) ------------------------
  console.log('\n[POOL] plafond de connexions');
  const pool = getPool();
  ok(Number(pool.options.max) === 5, `max par defaut prudent = 5 (obtenu ${pool.options && pool.options.max})`);
  const dbSource = readProjectFile('lib/database.js');
  ok(/max:[^\n]*DATABASE_POOL_MAX/.test(dbSource),
    'le plafond est configurable par DATABASE_POOL_MAX');

  if (failures) { console.error(`\ntenant-write-scope-check: ${failures} FAIL`); process.exit(1); }
  console.log('\ntenant-write-scope-check: ALL OK');
})();

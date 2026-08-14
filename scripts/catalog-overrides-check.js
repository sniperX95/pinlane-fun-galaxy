// Gate du CATALOGUE no-code (lib/catalog-overrides.js, table formule_overrides,
// database/catalog-overrides-schema.sql) et du DISMISS des incidents console.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif (motif de scripts/founder-cockpit-check.js et
// scripts/client-errors-check.js). Le faux pool OBEIT AU TEXTE SQL : il upsert
// par cle primaire, filtre resolved_at is null pour les groupes ouverts, borne
// par la fenetre make_interval. Un filtre retire du code retire son effet dans
// le faux pool, et l'assertion rougit.
//
// CE QUE CE GATE PROUVE EN COMPORTEMENT (pas en presence de chaine), chaque
// point contre-eprouve par MUTATION du code (edition inverse, jamais git
// checkout) :
//   (a) SANS override : applyFormuleOverrides rend une liste IDENTIQUE au socle
//       (deep-equal des noms et des prix, meme ordre, meme longueur).
//   (b) un override de prix change price.value pour le BON centre seulement.
//   (c) removed (et enabled=false) EXCLUENT la formule pour ce centre.
//   (d) precedence : un override de centre precis PRIME sur 'all', champ par
//       champ (le centre herite du nom pose par 'all' tout en imposant son prix).
//   (e) PURETE : les objets de base ne sont jamais mutes.
//   (f) bornes : un prix hors 0..1000 et un nom > 120 sont REFUSES.
//   (g) buildFounderCatalog expose base + override cote a cote (testData: true).
//   (h) dismiss pose resolved_at et le groupe DISPARAIT du loader ouvert.
//
// Lancement : node scripts/catalog-overrides-check.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// Le socle : le VRAI fichier catalogue. Les assertions "identique au socle" se
// mesurent contre lui, pas contre une copie inventee.
const BASE = require(path.join(ROOT, 'ops-knowledge', 'formulas.json')).formulas;

// ---------------------------------------------------------------------------
// Etat en memoire servi par le faux pool.
// ---------------------------------------------------------------------------
let overrideRows = [];
let errorRows = [];
const CENTER_ROWS = [
  { id: 'gembloux', name: 'Fun Galaxy Gembloux' },
  { id: 'libramont', name: 'Fun Galaxy Libramont' },
];

function resetOverrides() { overrideRows = []; }
function resetErrors() { errorRows = []; }

function seedErrorGroup(hash, count, opts = {}) {
  for (let i = 0; i < count; i += 1) {
    errorRows.push({
      id: errorRows.length + 1,
      stack_hash: hash,
      occurred_at: new Date(Date.now() - (i + 1) * 1000),
      center_id: opts.centerId || 'libramont',
      page: opts.page || 'menu',
      message: opts.message || `bug ${hash.slice(0, 4)}`,
      source: '',
      stack_excerpt: '',
      member_id: `membre-${i}`,
      resolved_at: null,
      resolved_by: null,
    });
  }
}

// ---------------------------------------------------------------------------
// Faux pool pg : obeit au texte SQL sur les fixtures ci-dessus.
// ---------------------------------------------------------------------------
function parseInsertRow(sql, params) {
  const cols = (sql.match(/insert into formule_overrides\s*\(([^)]+)\)/i) || [null, ''])[1]
    .split(',').map((c) => c.trim()).filter(Boolean);
  const valsRaw = (sql.match(/values\s*\(([\s\S]*?)\)\s*on conflict/i) || [null, ''])[1];
  const tokens = valsRaw.split(',').map((t) => t.trim());
  const row = {};
  cols.forEach((col, i) => {
    const tok = tokens[i];
    if (tok === undefined) { row[col] = null; return; }
    if (/^\$\d+$/.test(tok)) row[col] = params[Number(tok.slice(1)) - 1];
    else if (/now\(\)/i.test(tok)) row[col] = new Date();
    else row[col] = null;
  });
  return row;
}

class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text, params = []) {
    const sql = String(text);

    // ── formule_overrides ──
    if (/insert into formule_overrides/i.test(sql)) {
      const row = parseInsertRow(sql, params);
      const idx = overrideRows.findIndex(
        (r) => r.formule_id === row.formule_id && r.center_id === row.center_id,
      );
      if (idx === -1) overrideRows.push(row); else overrideRows[idx] = row; // on conflict do update
      return { rows: [row], rowCount: 1 };
    }
    if (/delete from formule_overrides/i.test(sql)) {
      const before = overrideRows.length;
      overrideRows = overrideRows.filter(
        (r) => !(r.formule_id === params[0] && r.center_id === params[1]),
      );
      return { rows: [], rowCount: before - overrideRows.length };
    }
    if (/from formule_overrides/i.test(sql)) {
      if (/where formule_id/i.test(sql)) {
        const found = overrideRows.find(
          (r) => r.formule_id === params[0] && r.center_id === params[1],
        );
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      return { rows: overrideRows.slice(), rowCount: overrideRows.length };
    }

    // ── centres ──
    if (/select id, name from centers/i.test(sql)) {
      return { rows: CENTER_ROWS.slice(), rowCount: CENTER_ROWS.length };
    }

    // ── client_errors : dismiss ──
    if (/update client_errors/i.test(sql)) {
      const hash = params[0];
      const by = params[1];
      const onlyOpen = /resolved_at is null/i.test(sql);
      let n = 0;
      errorRows.forEach((r) => {
        if (r.stack_hash !== hash) return;
        if (onlyOpen && r.resolved_at !== null) return;
        r.resolved_at = new Date();
        r.resolved_by = by;
        n += 1;
      });
      return { rows: [], rowCount: n };
    }

    // ── client_errors : groupes ouverts ──
    if (/from client_errors/i.test(sql) && /group by stack_hash/i.test(sql)) {
      const daysMatch = sql.match(/make_interval\(days => \$(\d+)\)/i);
      const limitMatch = sql.match(/limit \$(\d+)/i);
      const days = daysMatch ? Number(params[Number(daysMatch[1]) - 1]) : 3650;
      const limit = limitMatch ? Number(params[Number(limitMatch[1]) - 1]) : errorRows.length;
      const requireOpen = /resolved_at is null/i.test(sql);
      const cutoff = Date.now() - days * 86400 * 1000;
      const within = errorRows.filter(
        (r) => r.occurred_at.getTime() > cutoff && (!requireOpen || r.resolved_at === null),
      );
      const byHash = new Map();
      for (const row of within) {
        if (!byHash.has(row.stack_hash)) byHash.set(row.stack_hash, []);
        byHash.get(row.stack_hash).push(row);
      }
      const groups = [...byHash.entries()].map(([hash, rows]) => {
        const sorted = rows.slice().sort((a, b) => (b.occurred_at - a.occurred_at) || (b.id - a.id));
        return {
          stack_hash: hash,
          count: rows.length,
          last_at: new Date(Math.max(...rows.map((r) => r.occurred_at.getTime()))).toISOString(),
          first_at: new Date(Math.min(...rows.map((r) => r.occurred_at.getTime()))).toISOString(),
          centers: [...new Set(rows.map((r) => r.center_id))],
          pages: [...new Set(rows.map((r) => r.page))],
          sample_message: sorted[0].message,
          sample_source: sorted[0].source,
          sample_stack_excerpt: sorted[0].stack_excerpt,
          members_touches: new Set(rows.filter((r) => r.member_id).map((r) => r.member_id)).size,
        };
      });
      groups.sort((a, b) => (a.last_at < b.last_at ? 1 : a.last_at > b.last_at ? -1 : 0));
      return { rows: groups.slice(0, Math.max(0, limit)), rowCount: Math.min(groups.length, limit) };
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

// Le faux pool est construit VIA le pg mocke (require.cache), fidele au motif
// maison, meme si le module accepte pool en argument.
const { Pool } = require('pg');
const pool = new Pool();

const libPath = path.join(ROOT, 'lib', 'catalog-overrides.js');
function freshLib() {
  delete require.cache[require.resolve(libPath)];
  return require(libPath);
}
let lib = freshLib();

// ---------------------------------------------------------------------------
// Fabriques d'overrides (forme des lignes SQL : price en chaine comme pg).
// ---------------------------------------------------------------------------
function ovRow(formuleId, centerId, patch = {}) {
  return {
    formule_id: formuleId,
    center_id: centerId,
    name: patch.name === undefined ? null : patch.name,
    price_value: patch.priceValue === undefined ? null : String(patch.priceValue),
    price_old: patch.priceOld === undefined ? null : String(patch.priceOld),
    enabled: patch.enabled === undefined ? null : patch.enabled,
    removed: patch.removed === undefined ? false : patch.removed,
    sort_index: patch.sortIndex === undefined ? null : patch.sortIndex,
  };
}

function catalogSignature(list) {
  return JSON.stringify(list.map((f) => ({
    id: f.id, name: f.name, value: f.price && f.price.value, old: f.price && f.price.oldValue,
  })));
}

// ---------------------------------------------------------------------------
// Sondes reutilisees par les sections vertes ET la contre-preuve par mutation.
// ---------------------------------------------------------------------------
function probeIdentity(mod) {
  const merged = mod.applyFormuleOverrides(BASE, new Map(), 'libramont');
  return JSON.stringify(merged) === JSON.stringify(BASE);
}

function probeCenterPrecedence(mod) {
  const map = new Map([
    [`f1|${'all'}`, ovNorm('f1', 'all', { priceValue: 20 })],
    ['f1|gembloux', ovNorm('f1', 'gembloux', { priceValue: 15 })],
  ]);
  const libr = mod.applyFormuleOverrides(BASE, map, 'libramont').find((f) => f.id === 'f1');
  const gemb = mod.applyFormuleOverrides(BASE, map, 'gembloux').find((f) => f.id === 'f1');
  return Boolean(libr && gemb) && libr.price.value === 20 && gemb.price.value === 15;
}

function probeRemovedExcludes(mod) {
  const map = new Map([['f2|all', ovNorm('f2', 'all', { removed: true })]]);
  const list = mod.applyFormuleOverrides(BASE, map, 'libramont');
  return !list.some((f) => f.id === 'f2') && list.length === BASE.length - 1;
}

async function probePriceBound(mod) {
  resetOverrides();
  let rejected = false;
  try {
    await mod.upsertFormuleOverride(pool, { formuleId: 'f1', centerId: 'all', patch: { priceValue: 5000 } });
  } catch (error) {
    rejected = Boolean(error && error.expose);
  }
  return rejected && overrideRows.length === 0;
}

async function probeDismiss(mod) {
  resetErrors();
  seedErrorGroup('a'.repeat(40), 2);
  seedErrorGroup('b'.repeat(40), 1);
  const before = await mod.loadOpenIncidentGroups(pool, {});
  await mod.dismissClientErrorGroup(pool, { stackHash: 'a'.repeat(40), resolvedBy: 'fondateur' });
  const after = await mod.loadOpenIncidentGroups(pool, {});
  return before.length === 2 && after.length === 1 && after[0].stackHash === 'b'.repeat(40);
}

// Normalise une fabrique d'override vers la forme applicative (comme normalizeRow
// du module), pour construire des Map directement consommables par applyFormuleOverrides.
function ovNorm(formuleId, centerId, patch = {}) {
  return {
    formuleId,
    centerId,
    name: patch.name === undefined ? null : patch.name,
    priceValue: patch.priceValue === undefined ? null : Number(patch.priceValue),
    priceOld: patch.priceOld === undefined ? null : Number(patch.priceOld),
    enabled: patch.enabled === undefined ? null : patch.enabled,
    removed: patch.removed === undefined ? false : patch.removed,
    sortIndex: patch.sortIndex === undefined ? null : patch.sortIndex,
  };
}

(async () => {
  // =========================================================================
  console.log('[A] sans override : la liste fusionnee est IDENTIQUE au socle');
  // =========================================================================
  resetOverrides();
  const untouched = await lib.getMergedFormulas(pool, 'libramont');
  ok(untouched.length === BASE.length, `meme nombre de formules que le fichier (${untouched.length} / ${BASE.length})`);
  ok(catalogSignature(untouched) === catalogSignature(BASE),
    'noms et prix identiques au fichier (signature deep-equal)');
  ok(JSON.stringify(lib.applyFormuleOverrides(BASE, new Map(), 'libramont')) === JSON.stringify(BASE),
    'applyFormuleOverrides sans override = le socle au caractere pres (steps compris)');

  // =========================================================================
  console.log('\n[B] un override de prix change la value pour le BON centre seulement');
  // =========================================================================
  resetOverrides();
  overrideRows.push(ovRow('f1', 'gembloux', { priceValue: 15 }));
  const gembList = await lib.getMergedFormulas(pool, 'gembloux');
  const librList = await lib.getMergedFormulas(pool, 'libramont');
  const f1Base = BASE.find((f) => f.id === 'f1');
  const f1Gemb = gembList.find((f) => f.id === 'f1');
  const f1Libr = librList.find((f) => f.id === 'f1');
  ok(f1Gemb.price.value === 15, `gembloux : f1 a 15 (obtenu ${f1Gemb.price.value})`);
  ok(f1Libr.price.value === f1Base.price.value,
    `libramont : f1 garde le prix du fichier ${f1Base.price.value} (obtenu ${f1Libr.price.value})`);
  ok(f1Gemb.price.oldValue === f1Base.price.oldValue,
    'seul price.value est remplace : oldValue non touche reste celui du fichier');

  // =========================================================================
  console.log('\n[C] removed et enabled=false EXCLUENT la formule pour ce centre');
  // =========================================================================
  resetOverrides();
  overrideRows.push(ovRow('f2', 'all', { removed: true }));
  overrideRows.push(ovRow('f3', 'gembloux', { enabled: false }));
  const cAll = await lib.getMergedFormulas(pool, 'libramont');
  const cGemb = await lib.getMergedFormulas(pool, 'gembloux');
  ok(!cAll.some((f) => f.id === 'f2') && cAll.length === BASE.length - 1,
    "removed 'all' : f2 exclue partout, une formule de moins");
  ok(!cGemb.some((f) => f.id === 'f3'),
    'enabled=false gembloux : f3 exclue pour gembloux');
  ok(cAll.some((f) => f.id === 'f3'),
    'enabled=false gembloux : f3 reste presente pour libramont (portee respectee)');

  // =========================================================================
  console.log('\n[D] precedence : un override centre precis PRIME sur "all", champ par champ');
  // =========================================================================
  resetOverrides();
  overrideRows.push(ovRow('f1', 'all', { name: 'NOM GLOBAL', priceValue: 20 }));
  overrideRows.push(ovRow('f1', 'gembloux', { priceValue: 15 }));
  const dLibr = (await lib.getMergedFormulas(pool, 'libramont')).find((f) => f.id === 'f1');
  const dGemb = (await lib.getMergedFormulas(pool, 'gembloux')).find((f) => f.id === 'f1');
  ok(dLibr.price.value === 20 && dLibr.name === 'NOM GLOBAL',
    `libramont herite de 'all' : prix 20 et nom global (obtenu ${dLibr.price.value} / "${dLibr.name}")`);
  ok(dGemb.price.value === 15,
    `gembloux impose son prix 15 par-dessus 'all' (obtenu ${dGemb.price.value})`);
  ok(dGemb.name === 'NOM GLOBAL',
    "layering champ par champ : gembloux n'a pas d'ecart de nom -> herite du nom 'all', pas du fichier");
  ok(probeCenterPrecedence(lib), 'precedence confirmee sur une Map directe (sonde reutilisee par la mutation)');

  // =========================================================================
  console.log('\n[E] purete : les objets de base ne sont JAMAIS mutes');
  // =========================================================================
  resetOverrides();
  const before = catalogSignature(BASE);
  const map = new Map([['f1|all', ovNorm('f1', 'all', { name: 'MUTATION ?', priceValue: 1 })]]);
  lib.applyFormuleOverrides(BASE, map, 'libramont');
  const f1AfterBase = BASE.find((f) => f.id === 'f1');
  ok(catalogSignature(BASE) === before,
    'la signature du socle est inchangee apres une fusion avec override');
  ok(f1AfterBase.name === 'FORMULE 1' && f1AfterBase.price.value === 26,
    `f1 du socle intact (nom "${f1AfterBase.name}", prix ${f1AfterBase.price.value})`);

  // =========================================================================
  console.log('\n[F] bornes : prix hors 0..1000 et nom > 120 sont REFUSES');
  // =========================================================================
  resetOverrides();
  ok(await probePriceBound(lib), 'prix 5000 refuse (erreur exposee) et AUCUNE ligne ecrite');
  let negRejected = false;
  try { await lib.upsertFormuleOverride(pool, { formuleId: 'f1', patch: { priceValue: -1 } }); }
  catch (error) { negRejected = Boolean(error && error.expose); }
  ok(negRejected, 'prix negatif refuse');
  let nameRejected = false;
  try { await lib.upsertFormuleOverride(pool, { formuleId: 'f1', patch: { name: 'x'.repeat(121) } }); }
  catch (error) { nameRejected = Boolean(error && error.expose); }
  ok(nameRejected, 'nom > 120 refuse');
  let unknownRejected = false;
  try { await lib.upsertFormuleOverride(pool, { formuleId: 'inconnue', patch: { priceValue: 10 } }); }
  catch (error) { unknownRejected = Boolean(error && error.expose); }
  ok(unknownRejected, 'formule inconnue refusee (pas de ligne morte)');

  // Ecriture valide + merge partiel : deux upsert successifs se cumulent.
  resetOverrides();
  const saved = await lib.upsertFormuleOverride(pool, { formuleId: 'f1', centerId: 'all', patch: { priceValue: 22 } });
  ok(saved.priceValue === 22 && saved.name === null, 'upsert prix seul : prix pose, nom encore vide');
  const saved2 = await lib.upsertFormuleOverride(pool, { formuleId: 'f1', centerId: 'all', patch: { name: 'REBAPTISEE' } });
  ok(saved2.priceValue === 22 && saved2.name === 'REBAPTISEE',
    'upsert partiel : le nom s ajoute SANS effacer le prix deja pose (read-modify-write)');
  const afterReset = await lib.resetFormuleOverride(pool, { formuleId: 'f1', centerId: 'all' });
  ok(afterReset.removed === 1 && overrideRows.length === 0,
    'reset efface la ligne : la formule redevient le socle');

  // =========================================================================
  console.log('\n[G] buildFounderCatalog : base + override cote a cote, testData true');
  // =========================================================================
  resetOverrides();
  overrideRows.push(ovRow('f1', 'all', { name: 'FORMULE UN', priceValue: 20 }));
  overrideRows.push(ovRow('f2', 'gembloux', { priceValue: 15, enabled: false }));
  const catalog = await lib.buildFounderCatalog(pool);
  ok(catalog.ok === true && catalog.testData === true && !Number.isNaN(Date.parse(catalog.generatedAt)),
    'envelope { ok, generatedAt, testData:true }');
  ok(Array.isArray(catalog.centers) && catalog.centers.length === 2,
    `centres exposes pour l editeur (obtenu ${catalog.centers.length})`);
  ok(Array.isArray(catalog.formulas) && catalog.formulas.length === BASE.length,
    `toutes les formules du socle listees (${catalog.formulas.length} / ${BASE.length})`);
  const cf1 = catalog.formulas.find((f) => f.id === 'f1');
  ok(cf1.name === 'FORMULE 1' && cf1.price.value === 26,
    `f1 : la BASE reste visible (nom "${cf1.name}", prix ${cf1.price.value})`);
  ok(cf1.override && cf1.override.name === 'FORMULE UN' && cf1.override.priceValue === 20,
    `f1 : l override 'all' est expose a part (obtenu ${JSON.stringify(cf1.override)})`);
  ok(Array.isArray(cf1.steps) && cf1.steps.length === 4 && cf1.steps[0].activityId === 'bowling',
    'f1 : le resume des steps accompagne la formule');
  const cf2 = catalog.formulas.find((f) => f.id === 'f2');
  ok(cf2.override === null,
    'f2 : aucun override global -> override null');
  ok(cf2.perCenter && cf2.perCenter.gembloux
    && cf2.perCenter.gembloux.priceValue === 15 && cf2.perCenter.gembloux.enabled === false,
  `f2 : l ecart PAR CENTRE gembloux est expose (obtenu ${JSON.stringify(cf2.perCenter)})`);
  const cf3 = catalog.formulas.find((f) => f.id === 'f3');
  ok(Object.keys(cf3.perCenter).length === 0 && cf3.override === null,
    'f3 : sans aucun override, ni override global ni ecart par centre');

  // =========================================================================
  console.log('\n[H] dismiss : resolved_at pose, le groupe disparait du loader ouvert');
  // =========================================================================
  resetErrors();
  seedErrorGroup('a'.repeat(40), 2);
  seedErrorGroup('b'.repeat(40), 1);
  const openBefore = await lib.loadOpenIncidentGroups(pool, {});
  ok(openBefore.length === 2, `2 groupes ouverts avant dismiss (obtenu ${openBefore.length})`);
  const dismissRes = await lib.dismissClientErrorGroup(pool, { stackHash: 'a'.repeat(40), resolvedBy: 'fondateur' });
  ok(dismissRes.resolved === 2, `dismiss acquitte les 2 lignes du groupe (obtenu ${dismissRes.resolved})`);
  ok(errorRows.filter((r) => r.stack_hash === 'a'.repeat(40)).every((r) => r.resolved_at !== null && r.resolved_by === 'fondateur'),
    'resolved_at et resolved_by sont poses sur les lignes du groupe');
  const openAfter = await lib.loadOpenIncidentGroups(pool, {});
  ok(openAfter.length === 1 && openAfter[0].stackHash === 'b'.repeat(40),
    'le groupe acquitte a DISPARU du loader ouvert, l autre reste');
  ok(errorRows.length === 3,
    'aucune ligne supprimee : le dismiss est un acquittement, pas une purge (historique intact)');
  const reDismiss = await lib.dismissClientErrorGroup(pool, { stackHash: 'a'.repeat(40), resolvedBy: 'fondateur' });
  ok(reDismiss.resolved === 0, 'reacquitter un groupe deja resolu ne touche plus aucune ligne');
  let badHash = false;
  try { await lib.dismissClientErrorGroup(pool, { stackHash: 'pas-un-hash' }); }
  catch (error) { badHash = Boolean(error && error.expose); }
  ok(badHash, 'un stackHash mal forme est refuse');

  // =========================================================================
  console.log('\n[I] contre-preuve par MUTATION : le gate sait rougir, puis restauration inverse');
  // =========================================================================
  async function withMutation(rawAnchor, rawReplacement, probe, label) {
    const original = fs.readFileSync(libPath, 'utf8');
    // Checkout Windows (autocrlf=true) : la copie de travail est en CRLF alors
    // que les ancres multi-lignes sont ecrites en LF. On aligne l'ancre sur le
    // fichier, jamais l'inverse (meme garde que founder-cockpit-check).
    const useCrlf = !original.includes(rawAnchor) && original.includes(rawAnchor.replace(/\n/g, '\r\n'));
    const anchor = useCrlf ? rawAnchor.replace(/\n/g, '\r\n') : rawAnchor;
    const replacement = useCrlf ? rawReplacement.replace(/\n/g, '\r\n') : rawReplacement;
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`catalog-overrides-check: ancre de mutation introuvable ou ambigue (${occurrences} occurrence(s)) : ${label}`);
      process.exit(1);
    }
    const mutated = original.replace(anchor, replacement);
    if (mutated === original) {
      console.error(`catalog-overrides-check: la mutation n'a rien change au fichier : ${label}`);
      process.exit(1);
    }
    fs.writeFileSync(libPath, mutated);
    let holds = true;
    try {
      holds = await probe(freshLib());
    } finally {
      // Restauration par EDITION INVERSE : reecriture du contenu exact d'origine.
      fs.writeFileSync(libPath, original);
    }
    if (holds) {
      console.error(`catalog-overrides-check: MUTATION SANS EFFET, le gate ne sait pas rougir : ${label}`);
      process.exit(1);
    }
    ok(true, `mutation "${label}" : l'invariant est viole, le gate ROUGIRAIT`);
    lib = freshLib();
    const restored = await probe(lib);
    ok(restored, `restauration inverse "${label}" : l'invariant tient de nouveau`);
  }

  // Neutralise la precedence centre > all (le centre ne gagne plus) : dGemb
  // reprendrait le prix 'all' -> la sonde de precedence rougit.
  await withMutation(
    "    if (own && own[field] !== null && own[field] !== undefined) return own[field];",
    "    if (false && own && own[field] !== null && own[field] !== undefined) return own[field];",
    probeCenterPrecedence,
    'precedence centre > all neutralisee',
  );

  // Neutralise l'exclusion removed : la formule retiree reapparaitrait.
  await withMutation(
    "      if (eff.removed === true) continue;",
    "      if (false) continue;",
    probeRemovedExcludes,
    'exclusion removed neutralisee',
  );

  // Neutralise la borne de prix : un prix hors 0..1000 passerait.
  await withMutation(
    "  if (!Number.isFinite(parsed) || parsed < PRICE_MIN || parsed > PRICE_MAX) {",
    "  if (!Number.isFinite(parsed) || parsed < PRICE_MIN || parsed > 999999) {",
    probePriceBound,
    'borne de prix desactivee',
  );

  // Neutralise le filtre des incidents ouverts : un groupe acquitte resterait.
  await withMutation(
    "make_interval(days => $1)\n        and resolved_at is null",
    "make_interval(days => $1)\n        and 1 = 1",
    probeDismiss,
    'filtre resolved_at is null retire du loader ouvert',
  );

  // Preuve que le socle non mute survit a tout : reload propre puis identite.
  lib = freshLib();
  ok(probeIdentity(lib), 'apres toutes les mutations et restaurations : le socle rend encore une liste identique');

  if (failures) {
    console.error(`\ncatalog-overrides-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\ncatalog-overrides-check: ALL OK');
})().catch((error) => {
  console.error('catalog-overrides-check: exception', error);
  process.exit(1);
});

// LA TABLE availability_blocks EN MEMOIRE (2026-11-18), pour les gates de la privatisation
// (scripts/privatisation-check.js, scripts/privatisation-ui-check.js). Elle obeit au texte des
// requetes de lib/availability-blocks.js (lecture, insertion, retrait et rattachement d une
// privatisation, empreinte des caches) et refuse une requete qu elle ne connait pas : une
// ecriture nouvelle du module se voit ici au lieu de passer en silence.
//
// A charger APRES le banc (scripts/reserver-banc.js) : la requete qu elle ne prend pas va au faux
// pg d avant elle.
'use strict';
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const table = { lignes: [], seq: 700, version: 1 };
const copie = (v) => JSON.parse(JSON.stringify(v));

function sqlBlocs(s, p) {
  if (s.includes('/* empreintes-caches */')) {
    return { rows: [{ centres: null, surcharges: null, catalogue: null, blocages: { libramont: `v${table.version}` } }], rowCount: 1 };
  }
  if (!/\bavailability_blocks\b/.test(s)) return null;
  if (/^select \* from availability_blocks where center_id = \$1\b/.test(s)) {
    const rows = table.lignes.filter((l) => l.center_id === p[0]).map(copie);
    return { rows, rowCount: rows.length };
  }
  const insertion = /^insert into availability_blocks \(([^)]+)\) values/.exec(s);
  if (insertion) {
    const colonnes = insertion[1].split(',').map((c) => c.trim());
    table.seq += 1;
    const ligne = { id: table.seq, kind: 'closure', reservation_id: null };
    colonnes.forEach((c, i) => { ligne[c] = p[i] === undefined ? null : p[i]; });
    table.lignes.push(ligne);
    table.version += 1;
    return { rows: [copie(ligne)], rowCount: 1 };
  }
  if (/^delete from availability_blocks where center_id = \$1 and id = any\(\$2::bigint\[\]\)/.test(s)) {
    const ids = (p[1] || []).map(Number);
    const visees = table.lignes.filter((l) => l.center_id === p[0] && ids.includes(Number(l.id)) && (!/kind = 'private'/.test(s) || l.kind === 'private'));
    table.lignes = table.lignes.filter((l) => !visees.includes(l));
    if (visees.length) table.version += 1;
    return { rows: visees.map((l) => ({ id: l.id })), rowCount: visees.length };
  }
  if (/^update availability_blocks set reservation_id = \$3/.test(s)) {
    const ids = (p[1] || []).map(Number);
    const visees = table.lignes.filter((l) => l.center_id === p[0] && ids.includes(Number(l.id))
      && (!/kind = 'private'/.test(s) || l.kind === 'private')
      && (!/reservation_id is null/.test(s) || l.reservation_id === null || l.reservation_id === undefined));
    visees.forEach((l) => { l.reservation_id = Number(p[2]); });
    if (visees.length) table.version += 1;
    return { rows: visees.map((l) => ({ id: l.id })), rowCount: visees.length };
  }
  throw new Error(`SQL availability_blocks non simulee : ${s.slice(0, 160)}`);
}

const pg = require(require.resolve('pg', { paths: [ROOT] }));
const requetePrecedente = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const reponse = sqlBlocs(s, params);
  if (reponse) return reponse;
  return requetePrecedente.call(this, sql, params);
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Une ecriture hors API : le cache des blocages la voit, son empreinte a change (le cache garde
// sa lecture 25 ms, d ou la pause).
async function poserBlocs(lignes) {
  table.lignes.push(...lignes.map((l) => ({ kind: 'closure', reservation_id: null, recurrence: 'once', day_of_week: null, date_from: null, date_until: null, created_by: 'banc', center_id: 'libramont', ...l })));
  table.version += 1;
  await pause(40);
}

function vider() {
  table.lignes = [];
  table.version += 1;
}

const privees = () => table.lignes.filter((l) => l.kind === 'private');

module.exports = { table, poserBlocs, vider, privees, pause };

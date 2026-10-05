// TOUT EXPORTER, MAINTENANT (2026-10-05).
//
// Movsar : « si le site plante, tout exportable en 2 secondes avec les infos
// les plus recentes, rien ne manque ». Un classeur Excel lu A LA SECONDE dans
// la base : une feuille par table, toutes les lignes, toutes les colonnes
// (celles d une future migration comprises, la liste se lit dans la base).
//
// Portee : un centre ne voit que SES lignes (tables qui portent center_id).
// Les tables sans centre ne sortent que pour la plateforme. Ne sortent jamais :
// sessions et codes d acces de l equipe, blocages de dix minutes, couts de
// l IA (EXCLUES_EXPORT).
'use strict';

const { Classeur } = require('./xlsx-writer');

const EXCLUES_EXPORT = new Set(['staff_sessions', 'slot_holds', 'staff_access_events', 'llm_spend', 'schema_migrations', 'schema_migrations_lock']);
const COLONNES_SECRETES = /(access_code|code_hash|code_enc|password|token|secret|api_key)/i;
// Les tables les plus utiles en premier : on les trouve sans chercher.
const ORDRE = ['reservations', 'custom_requests', 'client_notes', 'client_note_versions', 'reservation_archive', 'communications', 'clients', 'formule_overrides', 'availability_blocks', 'centers'];

function valeurLisible(v) {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

async function exporterTout(pool, { centerId = '', plateforme = false, maintenant = new Date() } = {}) {
  const colonnes = (await pool.query(`
    select table_name, column_name, ordinal_position
      from information_schema.columns
     where table_schema = 'public'
     order by table_name, ordinal_position`)).rows;
  const parTable = new Map();
  for (const c of colonnes) {
    if (!parTable.has(c.table_name)) parTable.set(c.table_name, []);
    parTable.get(c.table_name).push(c.column_name);
  }
  const tables = [...parTable.keys()]
    .filter((t) => !EXCLUES_EXPORT.has(t))
    .filter((t) => plateforme || parTable.get(t).includes('center_id'))
    .sort((a, b) => ((ORDRE.indexOf(a) + 1 || 999) - (ORDRE.indexOf(b) + 1 || 999)) || a.localeCompare(b));

  const classeur = new Classeur({ titre: `Pinlane · export complet · ${centerId || 'plateforme'}`, auteur: 'Pinlane', date: maintenant });
  const resume = classeur.ajouterFeuille('Sommaire', { figer: 0, filtre: false, bandes: false, paysage: false });
  resume.definirColonnes([{ titre: 'Table', largeur: 34 }, { titre: 'Lignes', largeur: 12 }]);
  resume.titre(`Export complet Pinlane${centerId ? ` · centre ${centerId}` : ''}`, 2);
  resume.titre(`Lu dans la base le ${maintenant.toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })}`, 2, { style: 'sous-titre' });
  resume.vide();
  resume.entete(['Table', 'Lignes']);

  let total = 0;
  for (const table of tables) {
    const cols = parTable.get(table).filter((c) => !COLONNES_SECRETES.test(c));
    const filtre = !plateforme && parTable.get(table).includes('center_id');
    const nom = `"${table.replace(/"/g, '')}"`;
    const ordre = parTable.get(table).includes('id') ? ' order by id' : '';
    const lignes = (await pool.query(`select ${cols.map((c) => `"${c}"`).join(', ')} from ${nom}${filtre ? ' where center_id = $1' : ''}${ordre}`, filtre ? [centerId] : [])).rows;
    total += lignes.length;
    resume.ajouterLigne([table, { v: lignes.length, type: 'entier' }]);
    if (!lignes.length) continue;
    const f = classeur.ajouterFeuille(table.slice(0, 31));
    f.definirColonnes(cols.map((c) => ({ titre: c, largeur: Math.min(40, Math.max(10, c.length + 2)) })));
    f.entete();
    for (const l of lignes) f.ajouterLigne(cols.map((c) => valeurLisible(l[c])));
  }
  resume.vide();
  resume.ligneCle('Total des lignes', total, 'entier');
  return { contenu: classeur.versBuffer(), tables: tables.length, lignes: total };
}

module.exports = { EXCLUES_EXPORT, COLONNES_SECRETES, exporterTout };

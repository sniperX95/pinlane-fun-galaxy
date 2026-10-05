#!/usr/bin/env node
// RELIRE OU RESTAURER UNE SAUVEGARDE PINLANE (2026-10-05).
//
// Le jour ou Pinlane ne repond plus, ou apres une perte de donnees :
//
//   node scripts/sauvegarde-restaurer.js pinlane-sauvegarde-2026-10-05.pinlane
//     -> demande la phrase secrete, puis ecrit un dossier a cote du fichier :
//        une feuille CSV par table (s ouvre dans Excel, accents compris) et
//        resume.txt. Rien n est ecrit dans aucune base.
//
//   node scripts/sauvegarde-restaurer.js fichier.pinlane --vers postgres://...
//     -> remet chaque ligne dans une base dont le schema existe deja
//        (npm run db:migrate d abord). Une ligne deja presente n est jamais
//        ecrasee. Une base qui n est pas locale est refusee, sauf --je-sais.
//
// La phrase secrete : --phrase "...", ou la variable PINLANE_BACKUP_PASSPHRASE,
// sinon elle est demandee au clavier.
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { deballer, resume } = require('../lib/sauvegarde');

function argument(nom) {
  const i = process.argv.indexOf(nom);
  return i > 0 ? process.argv[i + 1] : '';
}

async function demanderPhrase() {
  if (argument('--phrase')) return argument('--phrase');
  if (process.env.PINLANE_BACKUP_PASSPHRASE) return process.env.PINLANE_BACKUP_PASSPHRASE;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (/Phrase/.test(s)) process.stdout.write(s); };
  return new Promise((ok) => rl.question('Phrase secrete de la sauvegarde : ', (r) => { rl.close(); process.stdout.write('\n'); ok(r); }));
}

function csv(lignes) {
  const colonnes = [...new Set(lignes.flatMap((l) => Object.keys(l || {})))];
  const cellule = (v) => {
    const t = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  // Point-virgule et BOM : ce qu Excel en francais ouvre sans assistant.
  return '﻿' + [colonnes.join(';'), ...lignes.map((l) => colonnes.map((c) => cellule(l[c])).join(';'))].join('\r\n');
}

async function restaurer(photo, url) {
  const locale = /@(localhost|127\.0\.0\.1)[:/]|host=\/|^postgres:\/\/\/|@\/var\//.test(url) || /localhost|127\.0\.0\.1/.test(new URL(url).hostname || 'localhost');
  if (!locale && !process.argv.includes('--je-sais')) {
    console.error('Refuse : cette base n est pas locale. Ajoutez --je-sais si vous restaurez volontairement une base distante.');
    process.exit(1);
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: locale ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  const bilan = {};
  try {
    const existantes = new Set((await client.query("select table_name from information_schema.tables where table_schema = 'public'")).rows.map((r) => r.table_name));
    let restantes = Object.entries(photo.tables).filter(([t, v]) => v.lignes > 0 && existantes.has(t));
    for (const [t] of Object.entries(photo.tables)) if (!existantes.has(t)) bilan[t] = 'table absente de la base cible (migrer d abord)';
    // Les cles etrangeres imposent un ordre : on repasse tant que ca avance.
    for (let tour = 0; restantes.length && tour < 12; tour += 1) {
      const echecs = [];
      for (const [table, v] of restantes) {
        const nom = `"${table.replace(/"/g, '')}"`;
        try {
          await client.query('begin');
          const r = await client.query(`insert into ${nom} select * from jsonb_populate_recordset(null::${nom}, $1::jsonb) on conflict do nothing`, [JSON.stringify(v.donnees)]);
          await client.query('commit');
          bilan[table] = `${r.rowCount} ligne(s) remise(s) sur ${v.lignes}`;
        } catch (error) {
          await client.query('rollback').catch(() => {});
          echecs.push([table, v, error.message]);
        }
      }
      if (echecs.length === restantes.length) { for (const [t, , m] of echecs) bilan[t] = `ECHEC : ${m}`; break; }
      restantes = echecs.map(([t, v]) => [t, v]);
    }
    // Les compteurs d identifiants repartent apres la plus grande valeur.
    const sequences = (await client.query(`
      select c.table_name, c.column_name from information_schema.columns c
       where c.table_schema = 'public' and c.column_default like 'nextval(%'`)).rows;
    for (const s of sequences) {
      await client.query(`select setval(pg_get_serial_sequence($1, $2), greatest(coalesce((select max("${s.column_name}") from "${s.table_name}"), 0), 1))`, [s.table_name, s.column_name]).catch(() => {});
    }
  } finally {
    client.release();
    await pool.end();
  }
  return bilan;
}

(async () => {
  const fichier = process.argv[2];
  if (!fichier || !fs.existsSync(fichier)) {
    console.error('Usage : node scripts/sauvegarde-restaurer.js <fichier.pinlane> [--vers postgres://...] [--phrase "..."]');
    process.exit(1);
  }
  const photo = deballer(fs.readFileSync(fichier), await demanderPhrase());
  const r = resume(photo);
  console.log(`Sauvegarde du ${r.faiteLe} : ${r.tables} tables, ${r.lignes} lignes.`);
  if (argument('--vers')) {
    const bilan = await restaurer(photo, argument('--vers'));
    for (const [t, b] of Object.entries(bilan)) console.log(`  ${t} : ${b}`);
    process.exit(Object.values(bilan).some((b) => /^ECHEC/.test(b)) ? 1 : 0);
  }
  const dossier = argument('--dossier') || fichier.replace(/\.pinlane$/, '') + '-lecture';
  fs.mkdirSync(dossier, { recursive: true });
  for (const [table, v] of Object.entries(photo.tables)) {
    if (v.lignes) fs.writeFileSync(path.join(dossier, `${table}.csv`), csv(v.donnees));
  }
  fs.writeFileSync(path.join(dossier, 'resume.txt'), `Sauvegarde du ${r.faiteLe}\n${r.tables} tables, ${r.lignes} lignes\n\n${Object.entries(r.parTable).map(([t, n]) => `${t} : ${n}`).join('\n')}\n`);
  console.log(`Lisible dans : ${dossier} (une feuille CSV par table, a ouvrir dans Excel).`);
})().catch((error) => { console.error(error.message || error); process.exit(1); });

// UNE SAUVEGARDE QU ON SAIT ROUVRIR ET REMETTRE EN PLACE, LIGNE POUR LIGNE (2026-10-05).
//
// Sur une vraie base Postgres LOCALE :
//   [A] la photo prend chaque table (sauf sessions et blocages de 10 min) ;
//   [B] chiffree puis relue : memes lignes ; mauvaise phrase, octet altere ou
//       phrase trop courte : refuse ;
//   [C] la sauvegarde de la nuit : sans phrase secrete ou sans destinataire,
//       rien ne part ; sinon un fichier joint, une cle d idempotence par jour,
//       et rien de lisible en clair dans la piece jointe ;
//   [D] restauration complete dans une base vide au meme schema : chaque table
//       a le meme nombre de lignes et les reservations sont identiques a
//       l octet ; une deuxieme restauration n ajoute rien ;
//   [E] la lecture sans base : une feuille CSV par table, lisible.
//
// Usage : PINLANE_TEST_DATABASE_URL=postgres://postgres@localhost:55432/base?host=/socket node scripts/sauvegarde-check.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
if (!process.env.PINLANE_TEST_DATABASE_URL) {
  console.log('sauvegarde-check: SAUTE (PINLANE_TEST_DATABASE_URL absent : ce gate a besoin d une base Postgres locale)');
  process.exit(0);
}
const source = new URL(process.env.PINLANE_TEST_DATABASE_URL);
const hote = source.searchParams.get('host') || source.hostname;
if (!(['localhost', '127.0.0.1', ''].includes(source.hostname) || /^\//.test(hote))) {
  console.error('sauvegarde-check: REFUSE, la base n est pas locale');
  process.exit(1);
}
const { Pool } = require('pg');
const sv = require(path.join(ROOT, 'lib/sauvegarde.js'));

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const PHRASE = 'une phrase secrete de test assez longue';
const nomSource = source.pathname.replace(/^\//, '');
const nomCible = `${nomSource}_restauration_gate`;
const pgArgs = ['-h', hote, '-p', source.port || '5432', '-U', source.username || 'postgres'];
const urlCible = (() => { const u = new URL(process.env.PINLANE_TEST_DATABASE_URL); u.pathname = `/${nomCible}`; return u.toString(); })();

(async () => {
  const pool = new Pool({ connectionString: process.env.PINLANE_TEST_DATABASE_URL, ssl: false });
  try {
    console.log('[A] la photo');
    const photo = await sv.photographier(pool);
    const tables = Object.keys(photo.tables);
    ok(tables.includes('reservations') && tables.includes('centers') && tables.includes('custom_requests'), '[A] les tables metier sont dedans', `${tables.length} tables`);
    ok(!tables.includes('staff_sessions') && !tables.includes('slot_holds'), '[A] ni les sessions de connexion, ni les blocages de 10 minutes');
    const nbResa = Number((await pool.query('select count(*) from reservations')).rows[0].count);
    ok(photo.tables.reservations.lignes === nbResa && nbResa > 0, '[A] toutes les reservations', `${photo.tables.reservations.lignes}/${nbResa}`);

    console.log('[B] chiffrement');
    const fichier = sv.emballer(photo, PHRASE);
    const relue = sv.deballer(fichier, PHRASE);
    ok(JSON.stringify(sv.resume(relue)) === JSON.stringify(sv.resume(photo)), '[B] relue : memes tables, memes lignes');
    let refus = '';
    try { sv.deballer(fichier, PHRASE + 'x'); } catch (e) { refus = e.message; }
    ok(/incorrecte/.test(refus), '[B] mauvaise phrase : refusee', refus);
    const abime = Buffer.from(fichier); abime[abime.length - 10] ^= 0xff;
    refus = ''; try { sv.deballer(abime, PHRASE); } catch (e) { refus = e.message; }
    ok(/abim/.test(refus), '[B] un octet altere : refuse (authentifie)', refus);
    refus = ''; try { sv.emballer(photo, 'court'); } catch (e) { refus = e.message; }
    ok(/trop courte/.test(refus), '[B] phrase trop courte : refusee');

    console.log('[C] la sauvegarde de la nuit');
    const envois = [];
    const envoyer = async (m) => { envois.push(m); return { id: 'x' }; };
    const sansCle = await sv.sauvegarderEtEnvoyer({ pool, env: { PINLANE_BACKUP_EMAILS: 'a@b.be' }, envoyer });
    const sansDest = await sv.sauvegarderEtEnvoyer({ pool, env: { PINLANE_BACKUP_PASSPHRASE: PHRASE }, envoyer });
    ok(!sansCle.ok && /PASSPHRASE/.test(sansCle.ignore) && !sansDest.ok && envois.length === 0, '[C] sans phrase secrete ou sans destinataire : rien ne part');
    const nuit = await sv.sauvegarderEtEnvoyer({ pool, env: { PINLANE_BACKUP_PASSPHRASE: PHRASE, PINLANE_BACKUP_EMAILS: 'sauvegarde@fungalaxy.be, x@y.test' }, envoyer, maintenant: new Date('2026-10-05T01:15:00Z') });
    const mail = envois[0] || {};
    const pj = (mail.attachments || [])[0] || {};
    ok(nuit.ok && JSON.stringify(mail.to) === '["sauvegarde@fungalaxy.be"]' && pj.filename === 'pinlane-sauvegarde-2026-10-05.pinlane' && mail.idempotencyKey === 'sauvegarde:2026-10-05', '[C] un fichier joint, une seule vraie adresse, une cle par jour', JSON.stringify({ to: mail.to, f: pj.filename }));
    const unNom = (photo.tables.reservations.donnees[0] || {}).name || 'zzz-introuvable';
    ok(pj.contenu && !Buffer.from(pj.contenu).includes(Buffer.from(unNom)), '[C] la piece jointe ne contient aucun nom de client en clair');

    console.log('[D] restauration complete');
    execFileSync('dropdb', [...pgArgs, '--if-exists', nomCible]);
    execFileSync('createdb', [...pgArgs, nomCible]);
    const schema = execFileSync('pg_dump', [...pgArgs, '--schema-only', '--no-owner', nomSource]);
    execFileSync('psql', [...pgArgs, '-q', '-v', 'ON_ERROR_STOP=1', nomCible], { input: schema });
    const chemin = path.join(os.tmpdir(), `gate-${process.pid}.pinlane`);
    fs.writeFileSync(chemin, fichier);
    const lancer = () => execFileSync(process.execPath, [path.join(ROOT, 'scripts/sauvegarde-restaurer.js'), chemin, '--vers', urlCible, '--phrase', PHRASE], { encoding: 'utf8' });
    const sortie = lancer();
    const cible = new Pool({ connectionString: urlCible, ssl: false });
    try {
      const ecarts = [];
      for (const t of tables) {
        const n = Number((await cible.query(`select count(*) from "${t}"`)).rows[0].count);
        if (n !== photo.tables[t].lignes) ecarts.push(`${t} ${n}/${photo.tables[t].lignes}`);
      }
      ok(!ecarts.length, '[D] chaque table a toutes ses lignes', ecarts.join(', ') || `${tables.length} tables`);
      const empreinte = async (p) => (await p.query("select md5(string_agg(to_jsonb(r)::text, '|' order by id)) as h from reservations r")).rows[0].h;
      ok(await empreinte(cible) === await empreinte(pool), '[D] les reservations sont identiques a l octet');
      lancer();
      const n2 = Number((await cible.query('select count(*) from reservations')).rows[0].count);
      ok(n2 === nbResa, '[D] une deuxieme restauration n ajoute rien', `${n2}`);
      const suivant = await cible.query("select nextval(pg_get_serial_sequence('reservations', 'id')) as n, (select max(id) from reservations) as m");
      ok(Number(suivant.rows[0].n) > Number(suivant.rows[0].m), '[D] les compteurs d identifiants repartent apres la plus grande valeur');
      if (failures) console.log(sortie);
    } finally {
      await cible.end();
      execFileSync('dropdb', [...pgArgs, '--if-exists', nomCible]);
    }

    console.log('[E] lecture sans base');
    const dossier = path.join(os.tmpdir(), `gate-lecture-${process.pid}`);
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/sauvegarde-restaurer.js'), chemin, '--phrase', PHRASE, '--dossier', dossier], { encoding: 'utf8' });
    const csv = fs.readFileSync(path.join(dossier, 'reservations.csv'), 'utf8');
    ok(csv.charCodeAt(0) === 0xfeff && csv.split('\r\n').length === nbResa + 1 && /;name;|^.?id;/.test(csv.split('\r\n')[0] + ';'), '[E] reservations.csv : en-tete et une ligne par reservation, ouvrable dans Excel');
    ok(fs.existsSync(path.join(dossier, 'resume.txt')), '[E] resume.txt');
    fs.rmSync(dossier, { recursive: true, force: true });
    fs.unlinkSync(chemin);
  } finally {
    await pool.end();
  }
  console.log('');
  console.log(failures ? `sauvegarde-check: ${failures} FAIL` : 'sauvegarde-check: ALL OK (photo complete, chiffree et authentifiee, envoi sous conditions, restauration a l octet, lecture CSV)');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });

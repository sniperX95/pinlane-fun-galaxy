// LA SAUVEGARDE COMPLETE, CHIFFREE, HORS DE PINLANE (2026-10-05).
//
// Movsar : « des backups doivent etre faits, securite au maximum [...] tout
// doit pouvoir etre exportable et backup de toutes donnees pour que si il
// arrive un crash on puisse revenir comme ils sont maintenant sans perte ».
//
// Chaque nuit, TOUTES les tables de la base (sauf les sessions de connexion et
// les blocages d horaires de dix minutes, qui n ont aucun sens apres coup)
// partent en un seul fichier :
//   JSON -> gzip -> AES-256-GCM, cle derivee d une phrase secrete (scrypt).
// Le fichier voyage par mail vers une boite a part (PINLANE_BACKUP_EMAILS).
// Sans phrase secrete configuree, RIEN ne part : une sauvegarde en clair de
// tous les clients dans une boite mail serait pire que pas de sauvegarde.
//
// Les nouvelles tables (celles d une future migration) sont prises d office :
// la liste se lit dans la base, pas dans ce fichier.
//
// Restaurer ou simplement relire : scripts/sauvegarde-restaurer.js.
'use strict';

const crypto = require('crypto');
const zlib = require('zlib');

const MAGIC = Buffer.from('PINLANE-SAUV1');
const EXCLUES = new Set(['staff_sessions', 'slot_holds', 'schema_migrations_lock']);
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function cleDepuisPhrase(phrase, sel) {
  if (!phrase || String(phrase).length < 16) {
    throw Object.assign(new Error('Phrase secrete absente ou trop courte (16 caracteres au moins).'), { code: 'cle_absente' });
  }
  return crypto.scryptSync(String(phrase), sel, 32, SCRYPT);
}

function chiffrer(contenu, phrase) {
  const sel = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cleDepuisPhrase(phrase, sel), iv);
  cipher.setAAD(MAGIC);
  const corps = Buffer.concat([cipher.update(contenu), cipher.final()]);
  return Buffer.concat([MAGIC, sel, iv, cipher.getAuthTag(), corps]);
}

function dechiffrer(fichier, phrase) {
  const buf = Buffer.from(fichier);
  if (buf.length < MAGIC.length + 44 || !buf.slice(0, MAGIC.length).equals(MAGIC)) throw new Error('Ce fichier n est pas une sauvegarde Pinlane.');
  let o = MAGIC.length;
  const sel = buf.slice(o, o += 16);
  const iv = buf.slice(o, o += 12);
  const tag = buf.slice(o, o += 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', cleDepuisPhrase(phrase, sel), iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(buf.slice(o)), decipher.final()]);
  } catch (error) {
    throw new Error('Phrase secrete incorrecte, ou fichier abime.');
  }
}

// LA PHOTO DE LA BASE : chaque table, ses colonnes et ses lignes.
async function photographier(pool, { maintenant = new Date() } = {}) {
  const tables = (await pool.query(`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`)).rows.map((r) => r.table_name).filter((t) => !EXCLUES.has(t));
  const photo = { format: 'pinlane-sauvegarde', version: 1, faiteLe: maintenant.toISOString(), tables: {} };
  for (const table of tables) {
    // to_jsonb rend chaque ligne telle quelle (dates, jsonb, tableaux) sans
    // dependre des convertisseurs du pilote.
    const lignes = (await pool.query(`select to_jsonb(t) as l from "${table.replace(/"/g, '')}" t`)).rows.map((r) => r.l);
    photo.tables[table] = { lignes: lignes.length, donnees: lignes };
  }
  return photo;
}

function emballer(photo, phrase) {
  return chiffrer(zlib.gzipSync(Buffer.from(JSON.stringify(photo)), { level: 9 }), phrase);
}

function deballer(fichier, phrase) {
  const photo = JSON.parse(zlib.gunzipSync(dechiffrer(fichier, phrase)).toString('utf8'));
  if (!photo || photo.format !== 'pinlane-sauvegarde') throw new Error('Contenu inattendu dans la sauvegarde.');
  return photo;
}

function resume(photo) {
  const parTable = Object.fromEntries(Object.entries(photo.tables).map(([t, v]) => [t, v.lignes]));
  return { faiteLe: photo.faiteLe, tables: Object.keys(parTable).length, lignes: Object.values(parTable).reduce((a, b) => a + b, 0), parTable };
}

// LA SAUVEGARDE DE LA NUIT : photo, chiffrement, envoi. deps.envoyer = l envoi
// Resend avec pieces jointes (lib/secours-envoi.envoyerResend).
async function sauvegarderEtEnvoyer({ pool, env = process.env, envoyer, maintenant = new Date() }) {
  const destinataires = String(env.PINLANE_BACKUP_EMAILS || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) && !/\.(test|invalid|example|localhost)$/.test(x));
  if (!env.PINLANE_BACKUP_PASSPHRASE) return { ok: false, ignore: 'PINLANE_BACKUP_PASSPHRASE absente : aucune sauvegarde ne part en clair.' };
  if (!destinataires.length) return { ok: false, ignore: 'PINLANE_BACKUP_EMAILS absent : personne pour recevoir la sauvegarde.' };
  const photo = await photographier(pool, { maintenant });
  const fichier = emballer(photo, env.PINLANE_BACKUP_PASSPHRASE);
  // Relecture immediate : une sauvegarde qu on ne sait pas rouvrir n en est pas une.
  const relue = resume(deballer(fichier, env.PINLANE_BACKUP_PASSPHRASE));
  const r = resume(photo);
  if (relue.lignes !== r.lignes) throw new Error('La sauvegarde relue ne compte pas les memes lignes.');
  const jour = maintenant.toISOString().slice(0, 10);
  const nom = `pinlane-sauvegarde-${jour}.pinlane`;
  const lignesTables = Object.entries(r.parTable).filter(([, n]) => n > 0).map(([t, n]) => `${t} : ${n}`).join('\n');
  await envoyer({
    to: destinataires,
    subject: `[Sauvegarde] Pinlane ${jour} · ${r.lignes} lignes · ${(fichier.length / 1024 / 1024).toFixed(1)} Mo`,
    text: `Sauvegarde complète de Pinlane du ${jour}, chiffrée (AES-256-GCM).\n\nPour la relire ou la restaurer : node scripts/sauvegarde-restaurer.js ${nom} (la phrase secrète est demandée).\nSans la phrase secrète, ce fichier est illisible : gardez-la ailleurs que dans cette boîte.\n\n${r.tables} tables, ${r.lignes} lignes :\n${lignesTables}`,
    html: `<p>Sauvegarde complète de Pinlane du <b>${jour}</b>, chiffrée (AES-256-GCM).</p><p>Pour la relire ou la restaurer : <code>node scripts/sauvegarde-restaurer.js ${nom}</code> (la phrase secrète est demandée). Sans la phrase secrète, ce fichier est illisible : gardez-la ailleurs que dans cette boîte.</p><p>${r.tables} tables, ${r.lignes} lignes.</p><pre style="font:12px/1.4 monospace">${lignesTables.replace(/[<>&]/g, '')}</pre>`,
    attachments: [{ filename: nom, contenu: fichier }],
    idempotencyKey: `sauvegarde:${jour}`,
  });
  return { ok: true, fichier: nom, octets: fichier.length, ...r, parTable: undefined };
}

module.exports = { EXCLUES, chiffrer, dechiffrer, photographier, emballer, deballer, resume, sauvegarderEtEnvoyer };

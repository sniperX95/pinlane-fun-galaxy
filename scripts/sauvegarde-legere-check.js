// LA SAUVEGARDE DE LA NUIT PART SANS LES REFUS D ACCES, ET NE MENT PAS SUR SON ENVOI.
//
// PANNE MUETTE DU 2026-10-07 AU 2026-11-02 : 27 passages, 27 echecs, les
// reglages manquaient et personne n ouvrait la page qui le disait. En les
// preparant, la mesure a montre qu ils n auraient pas suffi : audit_log pese
// 992 Mo sur les 1 062 de la base, 1 198 079 de ses 1 203 234 lignes sont des
// refus d acces, et lire ces lignes depassait 3 minutes sans finir.
//
// sauvegarde-check joue la vraie restauration, mais il lui faut un Postgres
// local : il est saute sur les machines GitHub. Celui-ci tourne partout, sur une
// fausse base qui applique le filtre recu et refuse tout autre WHERE :
//   [A] audit_log part sans ses refus, avec toutes ses modifications ;
//   [B] aucune autre table n est filtree, meme avec une colonne `action` ;
//   [C] le fichier envoye se rouvre, et le mail dit ce qui n y est pas ;
//   [D] la vraie fonction d envoi sans cle Resend ne fait pas un succes ;
//   [E] la fonction qui porte les taches a une limite de temps declaree ;
//   [F] la date que la sonde surveille ne compte que les passages reussis.
// Le SQL lui-meme n est pas joue ici : c est la limite de cette fausse base.
//
// Contre-preuves : chaque mutation en memoire doit rougir au moins une ligne.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { envoyerResend } = require('../lib/secours-envoi');

const ROOT = path.resolve(__dirname, '..');
const CHEMIN = path.join(ROOT, 'lib/sauvegarde.js');
const SOURCE = fs.readFileSync(CHEMIN, 'utf8');
const VERCEL = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
const PHRASE = 'une phrase secrete de test assez longue';
const ENV = { PINLANE_BACKUP_PASSPHRASE: PHRASE, PINLANE_BACKUP_EMAILS: 'sauvegarde@fungalaxy.be' };
const MAINTENANT = new Date('2026-11-02T01:15:00Z');

const LIGNES = {
  audit_log: [
    { id: 1, action: 'accessDenied' },
    { id: 2, action: 'updateReservation' },
    { id: 3, action: 'accessDenied' },
    { id: 4, action: 'login' },
  ],
  centers: [{ id: 'libramont' }],
  communications: [{ id: 1, action: 'accessDenied' }],
  reservations: [{ id: 1, name: 'Client test' }, { id: 2, name: 'Client test bis' }],
  staff_sessions: [{ id: 'session' }],
};

function fausseBase() {
  const requetes = [];
  return {
    requetes,
    async query(sql) {
      if (/information_schema\.tables/.test(sql)) return { rows: Object.keys(LIGNES).map((table_name) => ({ table_name })) };
      requetes.push(sql);
      const lue = /^select to_jsonb\(t\) as l from "(\w+)" t(?: where (.+))?$/.exec(sql.trim());
      if (!lue) throw new Error(`Requete inattendue : ${sql}`);
      const [, table, filtre] = lue;
      if (filtre && filtre !== "action <> 'accessDenied'") throw new Error(`Filtre inconnu : ${filtre}`);
      const lignes = LIGNES[table].filter((ligne) => !filtre || ligne.action !== 'accessDenied');
      return { rows: lignes.map((l) => ({ l })) };
    },
  };
}

function charger(source) {
  const mod = new Module(CHEMIN, module);
  mod.filename = CHEMIN;
  mod.paths = Module._nodeModulePaths(path.dirname(CHEMIN));
  mod._compile(source, CHEMIN);
  return mod.exports;
}

async function verifier(sv, vercelTexte, ok) {
  const pool = fausseBase();
  const photo = await sv.photographier(pool, { maintenant: MAINTENANT });
  const audit = photo.tables.audit_log;
  ok(audit.donnees.every((l) => l.action !== 'accessDenied'), '[A] audit_log part sans ses refus');
  ok(audit.donnees.map((l) => l.id).join(',') === '2,4' && audit.lignes === 2, '[A] toutes ses modifications partent', audit.donnees.map((l) => l.id).join(','));

  ok(photo.tables.communications.lignes === 1, '[B] une autre table avec une colonne action reste entiere');
  ok(photo.tables.reservations.lignes === 2 && photo.tables.centers.lignes === 1, '[B] les tables metier restent entieres');
  ok(!photo.tables.staff_sessions, '[B] les sessions restent exclues');
  ok(pool.requetes.filter((r) => / where /.test(r)).length === 1, '[B] une seule requete porte un filtre');

  const envois = [];
  const nuit = await sv.sauvegarderEtEnvoyer({ pool: fausseBase(), env: ENV, maintenant: MAINTENANT, envoyer: async (m) => { envois.push(m); return { id: 'x' }; } });
  const mail = envois[0] || {};
  const pj = (mail.attachments || [])[0] || {};
  const relue = sv.deballer(pj.contenu, PHRASE);
  ok(nuit.ok && envois.length === 1, '[C] un seul mail part');
  ok(relue.tables.audit_log.lignes === 2, '[C] le fichier envoye se rouvre, sans les refus');
  ok(/refus d.acc.s/i.test(mail.text || ''), '[C] le texte du mail dit que les refus restent en base');
  ok(/refus d.acc.s/i.test(mail.html || ''), '[C] le html du mail le dit aussi');

  let refus = '';
  try {
    await sv.sauvegarderEtEnvoyer({ pool: fausseBase(), env: ENV, maintenant: MAINTENANT, envoyer: (m) => envoyerResend({ ...m, env: {} }) });
  } catch (error) { refus = error.message; }
  ok(/RESEND_API_KEY/.test(refus), '[D] sans cle Resend, la sauvegarde echoue et dit pourquoi', refus);

  const fonction = (JSON.parse(vercelTexte).functions || {})['api/cron.js'];
  ok(Boolean(fonction) && fonction.maxDuration >= 120, '[E] api/cron.js a au moins 120 s pour finir', JSON.stringify(fonction || null));

  const lues = [];
  const date = await sv.derniereSauvegardeReussie({ query: async (sql) => { lues.push(sql); return { rows: [{ le: new Date('2026-11-02T22:12:06Z') }] }; } });
  ok(date === '2026-11-02T22:12:06.000Z', '[F] la sonde recoit une date', String(date));
  ok(/task_name = 'sauvegarde'/.test(lues[0]) && /status = 'ok'/.test(lues[0]), '[F] celle d un passage reussi seulement');
  ok(await sv.derniereSauvegardeReussie({ query: async () => ({ rows: [{ le: null }] }) }) === null, '[F] jamais reussie : aucune date');
}

const MUTATIONS = [
  ['plus aucun filtre', { source: (s) => s.replace(`{ audit_log: "action <> 'accessDenied'" }`, '{}') }],
  ['le filtre sur une autre table', { source: (s) => s.replace('{ audit_log: "', '{ communications: "') }],
  ['la requete oublie le filtre', { source: (s) => s.replace('" t${filtre}`', '" t`') }],
  ['le filtre ecarte aussi les modifications', { source: (s) => s.replace(`action <> 'accessDenied'`, `action = 'login'`) }],
  ['un envoi ignore redevient un succes', { source: (s) => s.replace('if (envoi && envoi.skipped)', 'if (false)') }],
  ['le texte du mail se tait', { source: (s) => s.replace("cette boîte.\\nLes refus d'accès du journal d'audit restent dans la base : ils ne sont pas dans ce fichier.", 'cette boîte.') }],
  ['le html du mail se tait', { source: (s) => s.replace("<p>Les refus d'accès du journal d'audit restent dans la base : ils ne sont pas dans ce fichier.</p>", '') }],
  ['la limite de temps retiree', { vercel: (v) => v.replace('"api/cron.js"', '"api/ailleurs.js"') }],
  ['un passage rate compte pour la sonde', { source: (s) => s.replace(" and status = 'ok'", '') }],
];

async function jouer(sv, vercelTexte) {
  const rouges = [];
  await verifier(sv, vercelTexte, (cond, label) => { if (!cond) rouges.push(label); });
  return rouges;
}

(async () => {
  let failures = 0;
  const ok = (cond, label, detail = '') => {
    console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
    if (!cond) failures += 1;
  };
  await verifier(charger(SOURCE), VERCEL, ok);

  console.log('contre-preuves');
  for (const [nom, mutation] of MUTATIONS) {
    const source = mutation.source ? mutation.source(SOURCE) : SOURCE;
    const vercel = mutation.vercel ? mutation.vercel(VERCEL) : VERCEL;
    if (source === SOURCE && vercel === VERCEL) { ok(false, `${nom} : la mutation ne s applique plus`); continue; }
    let rouges;
    try { rouges = await jouer(charger(source), vercel); } catch (error) { rouges = [`arret : ${error.message.slice(0, 60)}`]; }
    ok(rouges.length > 0, `${nom} : rougit`, rouges[0] || '');
  }

  console.log(failures ? `sauvegarde-legere-check: ${failures} ECHEC(S)` : 'sauvegarde-legere-check: OK');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error('Gate interrompu :', error); process.exit(1); });

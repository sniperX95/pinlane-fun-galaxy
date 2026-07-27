// Aucun envoi vers un domaine RESERVE (RFC 2606 : .test, .invalid, .example).
//
// Pourquoi ce gate existe : ces domaines n'existent pas, donc chaque message
// qui part vers eux revient en bounce DUR. Un taux de bounces eleve degrade la
// reputation d'envoi du domaine reel - autrement dit, ecrire a une adresse de
// test abime la delivrabilite des mails aux VRAIS clients.
//
// Le sujet est devenu concret le 2026-07-28 avec le jeu de demonstration
// (scripts/seed-demo-month.js) : 500+ reservations portant des adresses en
// @demo.fungalaxy.test, alors que les relances automatiques du centre
// (reminder_48h, post_visit) sont ACTIVES en base et que RESEND_API_KEY est
// configuree en production. Sans cette garde, le cron aurait poste des dizaines
// de messages par jour vers des boites inexistantes.
//
// Le test verifie le COMPORTEMENT : sendEmail ne doit meme pas TOUCHER le
// reseau pour une adresse reservee.

const { __test } = require('../lib/ops-communications');

let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// Sonde reseau : toute tentative d'appel HTTP est enregistree. Un envoi bloque
// ne doit produire AUCUN appel (pas seulement une erreur rattrapee).
const realFetch = global.fetch;
let calls = 0;
global.fetch = async (...args) => {
  calls += 1;
  return { ok: false, status: 401, text: async () => 'stub', json: async () => ({}) };
};
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 'gate-fake-key';

(async () => {
  const RESERVES = [
    'lucas.dubois.1@demo.fungalaxy.test',
    'x@quelquechose.invalid',
    'y@sous.example',
    'Z@DEMO.FUNGALAXY.TEST',
  ];
  for (const recipient of RESERVES) {
    calls = 0;
    const result = await __test.sendEmail({ recipient, subject: 'gate', payload: {} });
    ok(result && result.skipped === true && calls === 0,
      `${recipient} : rien envoye (skipped=${result && result.skipped}, appels reseau=${calls})`);
  }

  // Contre-epreuve : un domaine ROUTABLE doit continuer de partir. Une garde qui
  // bloque tout serait pire que le probleme.
  calls = 0;
  await __test.sendEmail({ recipient: 'client@fungalaxy.be', subject: 'gate', payload: {} }).catch(() => null);
  ok(calls === 1, `domaine routable : l'appel part bien (appels reseau=${calls})`);

  // Un domaine qui CONTIENT le mot test sans etre reserve ne doit pas etre bloque.
  calls = 0;
  await __test.sendEmail({ recipient: 'contact@test-center.be', subject: 'gate', payload: {} }).catch(() => null);
  ok(calls === 1, `test-center.be n'est pas un TLD reserve : l'appel part (appels reseau=${calls})`);

  global.fetch = realFetch;

  if (failures) {
    console.error(`\nunroutable-email-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\nunroutable-email-check: ALL OK - aucun message vers un domaine reserve, les vrais partent.');
})().catch((error) => { console.error(error); process.exit(1); });

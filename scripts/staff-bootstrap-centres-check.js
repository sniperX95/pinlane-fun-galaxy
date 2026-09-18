// LE BOOTSTRAP DU STAFF NE PROVISIONNE QUE LES CENTRES QUI ONT UNE EQUIPE.
//
// PANNE DE PRODUCTION DU 2026-09-19, capture de Movsar : la boite de connexion
// de la console affiche « insert or update on table "staff_roles" violates
// foreign key constraint "staff_roles_center_fk" ». Plus personne ne se
// connecte, sur aucun centre.
//
// CAUSE, relevee en lecture seule sur la vraie base (aucune ecriture) :
//   fichier ops-knowledge/centers.json : libramont, gembloux, ciney, demo
//   table centers                      : ciney, gembloux, libramont, mi12, n4-bowling
//   dans le fichier mais PAS dans la table : demo
//
// `getCenterIds()` lit le FICHIER et sert au bootstrap du staff. Il inserait
// donc un role pour un centre que la table `centers` ne connait pas, et la cle
// etrangere posee par database/tenant-integrity-schema.sql refusait la ligne.
//
// DEUX REGLES SONT TENUES ICI :
//   [A] un centre de DEMONSTRATION n a pas d equipe : le bootstrap l ignore, et
//       chaque centre qu il provisionne existe dans la table `centers` telle
//       que le schema la seme. C est exactement ce que la cle etrangere exige ;
//   [B] une erreur venue de la BASE ne part jamais au client. Le schema d une
//       table dans un ecran public n apprend rien a personne et expose le
//       produit.
//
// POURQUOI AUCUN GATE N AVAIT VU CA : le gate de connexion existant
// (login-center-resolution-check) tourne sur un moteur SQL synthetique qui
// accepte tout. Une cle etrangere que la VRAIE base fait respecter y est
// invisible. On ne simule donc pas la base ici : on compare ce que le code va
// ecrire a ce que le schema declare.
//
// Lancement : node scripts/staff-bootstrap-centres-check.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function record(label, condition, detail = '') {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
function section(titre) { console.log(`\n--- ${titre}`); }

// Les centres que le SCHEMA seme dans la table `centers`, lus dans le fichier
// de migration lui-meme : c est la population que la cle etrangere accepte sur
// une installation neuve.
function centresSemesParLeSchema() {
  const sql = fs.readFileSync(path.join(ROOT, 'database/tenant-integrity-schema.sql'), 'utf8');
  const bloc = sql.split('insert into centers')[1] || '';
  const avantLeFin = bloc.split('on conflict')[0] || '';
  return [...avantLeFin.matchAll(/\(\s*'([a-z0-9-]+)'\s*,/g)].map((m) => m[1]);
}

function main() {
  const staffAuth = require(path.join(ROOT, 'lib/staff-auth.js'));
  const knowledge = require(path.join(ROOT, 'lib/ops-knowledge.js')).loadOpsKnowledge();
  const registre = (knowledge.centers || []);

  // ===================================================================== [1]
  section('[1] Le montage : le registre porte bien un centre de demonstration');
  // Sans lui, tout ce qui suit serait vrai sur un ecran vide.
  const demos = registre.filter((c) => c && c.demonstration === true).map((c) => c.id);
  const reels = registre.filter((c) => c && c.demonstration !== true).map((c) => c.id);
  record('le registre distingue des centres de demonstration et des centres reels',
    demos.length >= 1 && reels.length >= 2, JSON.stringify({ demonstration: demos, reels }));

  // ===================================================================== [2]
  section('[2] Le bootstrap du staff ignore la demonstration, et sert les vrais');
  const bootstrap = staffAuth.getCenterIds();
  record('aucun centre de demonstration dans le bootstrap du staff',
    demos.every((id) => !bootstrap.includes(id)), JSON.stringify({ bootstrap, demonstration: demos }));
  record('et les centres reels y sont tous',
    reels.every((id) => bootstrap.includes(id)), JSON.stringify({ bootstrap, reels }));

  // ===================================================================== [3]
  section('[3] La regle que la cle etrangere fait respecter');
  // `staff_roles.center_id` pointe vers `centers(id)`. Tout centre que le
  // bootstrap provisionne doit donc exister dans cette table.
  const semes = centresSemesParLeSchema();
  record('le schema seme bien une liste de centres', semes.length >= 3, JSON.stringify(semes));
  const orphelins = bootstrap.filter((id) => !semes.includes(id));
  record('chaque centre provisionne par le staff existe dans la table centers',
    orphelins.length === 0, JSON.stringify({ orphelins, semes, bootstrap }));

  // ===================================================================== [4]
  section('[4] Une erreur venue de la base ne part jamais au client');
  const erreurBase = Object.assign(new Error('insert or update on table "staff_roles" violates foreign key constraint "staff_roles_center_fk"'), { code: '23503' });
  const refusEcrit = new Error('Code refuse ou acces bloque.');
  record('une erreur PostgreSQL est reconnue comme telle',
    staffAuth.isDatabaseError(erreurBase) === true, String(erreurBase.code));
  record('un refus ecrit par le produit ne l est pas',
    staffAuth.isDatabaseError(refusEcrit) === false, refusEcrit.message);
  const neutre = staffAuth.publicIncidentMessage();
  record('le message d incident ne nomme ni table, ni contrainte, ni SQL',
    Boolean(neutre) && !/staff_roles|constraint|insert|violates|foreign key/i.test(neutre), JSON.stringify(neutre));

  // La porte publique doit s en servir : prouver la decision sans prouver
  // qu elle est BRANCHEE laisserait le trou ouvert (lecon
  // `fonction-pure-testee-chargeur-nu`). On lit donc la ligne qui repond.
  const porte = fs.readFileSync(path.join(ROOT, 'api/staff-auth.js'), 'utf8');
  record('la porte de connexion route les erreurs de base vers ce message',
    porte.includes('isDatabaseError(error)') && porte.includes('publicIncidentMessage()'),
    'api/staff-auth.js');

  // ===================================================================== [5]
  section('[5] Contre-epreuve par mutation : ce gate sait-il rougir ?');
  const rel = 'lib/staff-auth.js';
  const p = path.join(ROOT, rel);
  const avant = fs.readFileSync(p, 'utf8');
  try {
    const DE = `      .filter((center) => center && center.demonstration !== true)`;
    const fdl = avant.includes('\r\n') ? '\r\n' : '\n';
    const ancre = DE.split('\n').join(fdl);
    if (avant.split(ancre).length - 1 !== 1) throw new Error('ancre du filtre introuvable');
    fs.writeFileSync(p, avant.split(ancre).join(`      .filter((center) => Boolean(center))`));
    delete require.cache[require.resolve(p)];
    const mute = require(p);
    const bootstrapMute = mute.getCenterIds();
    const orphelinsMutes = bootstrapMute.filter((id) => !semes.includes(id));
    record('sans le filtre, le bootstrap reprend la demonstration : ce gate ROUGIRAIT',
      demos.some((id) => bootstrapMute.includes(id)) && orphelinsMutes.length > 0,
      JSON.stringify({ bootstrap: bootstrapMute, orphelins: orphelinsMutes }));
  } catch (error) {
    record('contre-epreuve montable', false, error.message);
  } finally {
    fs.writeFileSync(p, avant);
    delete require.cache[require.resolve(p)];
  }
  record('lib/staff-auth.js restaure a l identique', fs.readFileSync(p, 'utf8') === avant);

  console.log(`\n${failures === 0 ? 'STAFF BOOTSTRAP CENTRES OK' : `STAFF BOOTSTRAP CENTRES : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

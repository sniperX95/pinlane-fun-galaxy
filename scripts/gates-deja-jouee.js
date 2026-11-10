// LE DOUBLON D APRES MISE EN LIGNE (2026-11-10, accord d Ansar).
//
// Un commit se pousse sur main apres avoir passe sa suite entiere sous
// l etiquette suite-tout-<sha> (scripts/suite-github.js). Le push rejouait
// aussitot la suite sur ce meme commit : rien a apprendre, et douze machines
// prises aux suites qui attendent (GitHub en prete vingt a la fois pour tout
// le depot). Les 9 et 10/11 : 37 passages en 32 heures, 8 des 10 suites de
// main portaient sur un commit qui venait de passer la sienne, et une suite
// entiere durait 51 minutes en mediane, attente comprise.
//
// Ce script dit si CE commit a deja un passage VERT de la suite ENTIERE. Seul
// compte un passage termine en succes sous une etiquette suite-tout-* (ou
// suite-preuves-*, la meme suite avec ses contre-preuves en plus) : ni la
// suite d impact (suite-<sha>), ni un passage sur main, ni un passage rouge,
// annule ou encore en cours, ni celui d un autre commit. Un commit repose
// apres sa suite change de sha : il est rejoue. Dans le doute (reponse
// illisible, appel en echec), rien n est dit et la suite se joue.
//
// Usage (workflow Quality gates, job plan) :
//   gh api "repos/<depot>/actions/workflows/quality-gates.yml/runs?head_sha=<sha>&per_page=50" | node scripts/gates-deja-jouee.js <sha>
//   ecrit l identifiant du passage vert, ou rien. Sortie 0 dans tous les cas.
'use strict';

function passageVert(passages, sha) {
  const vert = (Array.isArray(passages) ? passages : []).find((p) => p
    && p.head_sha === sha
    && p.event === 'push'
    && p.status === 'completed'
    && p.conclusion === 'success'
    && /^suite-(?:tout|preuves)-/.test(String(p.head_branch || '')));
  return vert ? vert.id : null;
}

function principal() {
  const sha = String(process.argv[2] || '');
  let texte = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (morceau) => { texte += morceau; });
  process.stdin.on('end', () => {
    let passages = [];
    try { passages = JSON.parse(texte).workflow_runs; } catch (error) { passages = []; }
    const id = /^[0-9a-f]{40}$/.test(sha) ? passageVert(passages, sha) : null;
    if (id) process.stdout.write(`${id}\n`);
  });
}

if (require.main === module) principal();
module.exports = { passageVert };

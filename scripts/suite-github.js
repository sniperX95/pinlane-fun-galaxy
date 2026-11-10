// LA SUITE D UN COMMIT, JOUEE SUR GITHUB (2026-10-30).
//
// Avant de deployer, la suite d impact se jouait sur le poste : 1 h 20 la
// nuit, 1 h 50 le jour, plus l attente que la machine se calme (d autres
// sessions y rendent des videos). Ici, le commit part sous une etiquette
// suite-<sha> (une etiquette et pas une branche : Vercel ne deploie pas les
// etiquettes), le workflow Quality gates joue sa suite d impact en parts
// paralleles, ce script attend le verdict, rapatrie le bilan rassemble,
// l affiche et retire l etiquette.
//
// SANS LES CONTRE-PREUVES (2026-11-10). La suite d impact comme la suite
// entiere (--tout) ne jouent que les controles du produit : les contre-preuves
// (un gate casse le produit expres pour prouver qu il rougit) pesaient 64 % du
// calcul et se rejouaient avant chaque mise en ligne (gates-lancer.js,
// sansContrePreuves). Elles se jouent toutes chaque nuit sur main ; ce script
// dit a chaque passage ou en est la derniere nuit, pour qu un rouge de nuit
// soit lu par la premiere session qui met en ligne. --preuves les rejoue
// toutes sur un commit (apres un gros chantier sur les gates eux-memes).
//
// Usage : node scripts/suite-github.js [REF] [--tout | --preuves]
//   (defaut HEAD, la suite d impact ; --tout la suite entiere ; --preuves la
//   suite entiere avec ses contre-preuves, 14 machines, a ne pas lancer avant
//   chaque mise en ligne)
// Sortie 0 : vert (instables compris) ; 1 : un rouge ou une part sans bilan ;
// 2 : la suite n a pas pu se jouer (etiquette refusee, aucun passage, pas de bilan).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const PREUVES = ARGS.includes('--preuves');
const TOUT = PREUVES || ARGS.includes('--tout');
const REF = ARGS.find((a) => !a.startsWith('--')) || 'HEAD';
const WORKFLOW = 'quality-gates.yml';
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const gh = (args, options = {}) => spawnSync('gh', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, ...options });

function depot() {
  const url = git('remote', 'get-url', 'origin');
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`origin n est pas un depot GitHub : ${url}`);
  return `${m[1]}/${m[2]}`;
}

function passagesDuCommit(repo, sha, etiquette) {
  const r = gh(['run', 'list', '--repo', repo, '--workflow', WORKFLOW, '--limit', '30', '--json', 'databaseId,headSha,headBranch,event,createdAt']);
  if (r.status !== 0) return [];
  return JSON.parse(r.stdout || '[]').filter((x) => x.headSha === sha && x.event === 'push' && x.headBranch === etiquette);
}

async function trouverPassage(repo, sha, etiquette, deja) {
  const fin = Date.now() + 5 * 60 * 1000;
  while (Date.now() < fin) {
    const siens = passagesDuCommit(repo, sha, etiquette).filter((x) => !deja.has(x.databaseId));
    if (siens.length) return siens.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    await attendre(10000);
  }
  return null;
}

// La fin du passage, lue par l API toutes les 30 s (90 min au plus) : `gh run
// watch` rendait la main avant la fin, sans erreur (vu le 2026-10-30 : sorti
// a 29 min, une part encore en cours, et la suite lue « sans bilan »). Une
// ligne seulement quand une part finit.
async function attendreLaFin(repo, id) {
  const fin = Date.now() + 90 * 60 * 1000;
  let dernier = '';
  while (Date.now() < fin) {
    const r = gh(['run', 'view', id, '--repo', repo, '--json', 'status,conclusion,jobs']);
    if (r.status === 0) {
      const passage = JSON.parse(r.stdout);
      const parts = passage.jobs.filter((j) => j.name.startsWith('part '));
      const finies = parts.filter((j) => j.status === 'completed');
      const enRouge = finies.filter((j) => j.conclusion !== 'success').map((j) => j.name);
      const etat = `${finies.length}/${parts.length} parts finies${enRouge.length ? `, en rouge : ${enRouge.join(', ')}` : ''}`;
      if (etat !== dernier) { console.log(`[suite-github] ${new Date().toTimeString().slice(0, 8)} ${etat}`); dernier = etat; }
      if (passage.status === 'completed') return passage.conclusion;
    }
    await attendre(30000);
  }
  return null;
}

// Ou en sont les contre-preuves : le dernier passage fini qui les a jouees
// (la nuit sur main, ou une etiquette suite-preuves-*). Une ligne, jamais un
// code de sortie : un rouge de nuit se lit et se repare, il ne bloque pas la
// mise en ligne d un autre lot. Sans reponse de GitHub, rien n est dit.
function laNuit(repo) {
  const lire = (args) => { const r = gh(['run', 'list', '--repo', repo, '--workflow', WORKFLOW, '--json', 'databaseId,headBranch,event,status,conclusion,createdAt', ...args]); try { return r.status === 0 ? JSON.parse(r.stdout || '[]') : []; } catch (error) { return []; } };
  const finis = [...lire(['--event', 'schedule', '--limit', '5']), ...lire(['--limit', '40']).filter((x) => /^suite-preuves-/.test(x.headBranch || ''))]
    .filter((x) => x.status === 'completed' && x.conclusion !== 'cancelled')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (!finis.length) { console.log('[suite-github] contre-preuves : aucun passage de nuit retrouve. Les rejouer : npm run suite:github -- --preuves'); return; }
  const dernier = finis[0];
  const heures = Math.round((Date.now() - Date.parse(dernier.createdAt)) / 3600000);
  const vieux = heures > 36 ? ` La nuit n a pas tourne depuis ${heures} h : npm run suite:github -- --preuves.` : '';
  if (dernier.conclusion === 'success') console.log(`[suite-github] contre-preuves : VERTES au passage ${dernier.databaseId}, il y a ${heures} h.${vieux}`);
  else console.log(`[suite-github] contre-preuves : ROUGES au passage ${dernier.databaseId}, il y a ${heures} h. A lire et a reparer : gh run download ${dernier.databaseId} --repo ${repo} --name bilan.${vieux}`);
}

async function main() {
  const sha = git('rev-parse', '--verify', `${REF}^{commit}`);
  const repo = depot();
  const etiquette = `suite-${PREUVES ? 'preuves-' : TOUT ? 'tout-' : ''}${sha.slice(0, 12)}`;
  // Un commit se rejoue (deux suites de suite avant un deploiement) : le passage
  // attendu est celui de CETTE poussee, pas le precedent du meme commit, deja fini
  // et relu comme s il etait neuf. Une etiquette deja la ne declenche rien : on se
  // rattache alors a son passage.
  const anciens = passagesDuCommit(repo, sha, etiquette).map((x) => x.databaseId);
  const pousse = spawnSync('git', ['-C', ROOT, 'push', 'origin', `${sha}:refs/tags/${etiquette}`], { encoding: 'utf8', windowsHide: true });
  if (pousse.status !== 0 && !/already exists/.test(pousse.stderr)) { console.error(pousse.stderr); return 2; }
  console.log(`[suite-github] ${etiquette} poussee : ${PREUVES ? 'la suite entiere avec ses contre-preuves' : TOUT ? 'la suite entiere, sans les contre-preuves' : 'la suite d impact, sans les contre-preuves'} de ${sha.slice(0, 10)}`);
  if (!PREUVES) laNuit(repo);
  try {
    const dejaLa = /already exists|up-to-date/.test(`${pousse.stdout}${pousse.stderr}`);
    const passage = await trouverPassage(repo, sha, etiquette, new Set(dejaLa ? [] : anciens));
    if (!passage) { console.error('[suite-github] aucun passage du workflow en 5 minutes'); return 2; }
    const id = String(passage.databaseId);
    console.log(`[suite-github] https://github.com/${repo}/actions/runs/${id}`);
    const conclusion = await attendreLaFin(repo, id);
    if (conclusion === null) { console.error('[suite-github] le passage n a pas fini en 90 minutes'); return 2; }
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-github-'));
    const telecharge = gh(['run', 'download', id, '--repo', repo, '--name', 'bilan', '--dir', dossier]);
    const fichier = path.join(dossier, 'bilan-assemble.json');
    if (telecharge.status !== 0 || !fs.existsSync(fichier)) {
      // Aucun gate touche par le diff : le workflow est vert sans bilan.
      if (conclusion === 'success') { console.log('[suite-github] VERT : aucun gate a jouer pour ce diff'); return 0; }
      console.error(`[suite-github] pas de bilan rassemble (conclusion du workflow : ${conclusion})`);
      return 2;
    }
    console.log(fs.readFileSync(path.join(dossier, 'bilan-assemble.txt'), 'utf8'));
    console.log(`[suite-github] bilan et journaux : ${dossier} ; journaux des parts : gh run download ${id} --repo ${repo}`);
    const bilan = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    return bilan.rouges || (bilan.manquantes || []).length ? 1 : 0;
  } finally {
    spawnSync('git', ['-C', ROOT, 'push', 'origin', `:refs/tags/${etiquette}`], { encoding: 'utf8', windowsHide: true });
  }
}

main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(2); });

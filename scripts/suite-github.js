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
// Usage : node scripts/suite-github.js [REF] [--tout]   (defaut HEAD, la suite d impact)
// Sortie 0 : vert (instables compris) ; 1 : un rouge ou une part sans bilan ;
// 2 : la suite n a pas pu se jouer (etiquette refusee, aucun passage, pas de bilan).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const TOUT = ARGS.includes('--tout');
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

async function trouverPassage(repo, sha, etiquette) {
  const fin = Date.now() + 5 * 60 * 1000;
  while (Date.now() < fin) {
    const r = gh(['run', 'list', '--repo', repo, '--workflow', WORKFLOW, '--limit', '30', '--json', 'databaseId,headSha,headBranch,event,createdAt']);
    if (r.status === 0) {
      const siens = JSON.parse(r.stdout || '[]').filter((x) => x.headSha === sha && x.event === 'push' && x.headBranch === etiquette);
      if (siens.length) return siens.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    }
    await attendre(10000);
  }
  return null;
}

async function main() {
  const sha = git('rev-parse', '--verify', `${REF}^{commit}`);
  const repo = depot();
  const etiquette = `suite-${TOUT ? 'tout-' : ''}${sha.slice(0, 12)}`;
  const pousse = spawnSync('git', ['-C', ROOT, 'push', 'origin', `${sha}:refs/tags/${etiquette}`], { encoding: 'utf8', windowsHide: true });
  if (pousse.status !== 0 && !/already exists/.test(pousse.stderr)) { console.error(pousse.stderr); return 2; }
  console.log(`[suite-github] ${etiquette} poussee : ${TOUT ? 'la suite entiere' : 'la suite d impact'} de ${sha.slice(0, 10)}`);
  try {
    const passage = await trouverPassage(repo, sha, etiquette);
    if (!passage) { console.error('[suite-github] aucun passage du workflow en 5 minutes'); return 2; }
    const id = String(passage.databaseId);
    console.log(`[suite-github] https://github.com/${repo}/actions/runs/${id}`);
    gh(['run', 'watch', id, '--repo', repo, '--interval', '30'], { stdio: 'inherit', timeout: 100 * 60 * 1000 });
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-github-'));
    const telecharge = gh(['run', 'download', id, '--repo', repo, '--name', 'bilan', '--dir', dossier]);
    const fichier = path.join(dossier, 'bilan-assemble.json');
    if (telecharge.status !== 0 || !fs.existsSync(fichier)) {
      const vue = gh(['run', 'view', id, '--repo', repo, '--json', 'conclusion']);
      const conclusion = vue.status === 0 ? JSON.parse(vue.stdout).conclusion : 'inconnue';
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

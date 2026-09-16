const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

process.noDeprecation = true;

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_VAULT = path.join(
  os.homedir(),
  'OneDrive',
  'Documents',
  'Obsidian Vault',
  'Pinlane - SaaS Ops',
);
const REPO_VAULT = path.join(PROJECT_ROOT, 'docs', 'obsidian-vault', 'Pinlane - SaaS Ops');
const VAULT_ROOT = process.env.PINLANE_OBSIDIAN_VAULT || DEFAULT_VAULT;
const RUN_TESTS = process.argv.includes('--with-tests');
const BIN = {
  railway: process.platform === 'win32' ? 'railway.cmd' : 'railway',
  npx: process.platform === 'win32' ? 'npx.cmd' : 'npx',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeNote(relativePath, content) {
  const livePath = path.join(VAULT_ROOT, relativePath);
  const repoPath = path.join(REPO_VAULT, relativePath);
  ensureDir(path.dirname(livePath));
  ensureDir(path.dirname(repoPath));
  fs.writeFileSync(livePath, content, 'utf8');
  fs.writeFileSync(repoPath, content, 'utf8');
}

function quotePowerShellArg(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function resolveInvocation(command, args) {
  const needsPowerShell =
    process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(command));

  if (!needsPowerShell) {
    return { command, args };
  }

  return {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      ['&', quotePowerShellArg(command), ...args.map(quotePowerShellArg)].join(' '),
    ],
  };
}

function run(command, args, options = {}) {
  try {
    const invocation = resolveInvocation(command, args);
    const stdout = execFileSync(invocation.command, invocation.args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout || 120000,
      env: {
        ...process.env,
        RAILWAY_CALLER: 'pinlane-obsidian-sync',
        RAILWAY_AGENT_SESSION: 'pinlane-obsidian-sync',
      },
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout).trim() : '',
      stderr: error.stderr ? String(error.stderr).trim() : error.message,
    };
  }
}

function runShell(command, options = {}) {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh';
  const args =
    process.platform === 'win32'
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
      : ['-lc', command];
  return run(shell, args, options);
}

function parseJson(result, fallback = null) {
  if (!result.ok || !result.stdout) return fallback;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return fallback;
  }
}

function firstDeployment(data) {
  if (!data) return null;
  const list = Array.isArray(data) ? data : data.deployments;
  return Array.isArray(list) ? list[0] : null;
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function compact(value, limit = 1200) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return stripAnsi(text).slice(0, limit);
}

function railwaySummary(statusJson) {
  const services =
    statusJson?.services?.edges?.map((edge) => edge.node).filter(Boolean) || [];
  const env = statusJson?.environments?.edges?.[0]?.node;
  const instances = env?.serviceInstances?.edges?.map((edge) => edge.node).filter(Boolean) || [];
  const rows = instances.map((instance) => {
    const deployment = instance.latestDeployment || instance.activeDeployments?.[0] || {};
    const running = deployment.instances?.map((item) => item.status).join(', ') || 'unknown';
    return `| ${instance.serviceName || instance.serviceId} | ${deployment.status || 'unknown'} | ${running} | ${deployment.meta?.commitHash || deployment.id || '-'} |`;
  });
  return {
    project: statusJson?.name || 'unknown',
    environment: env?.name || 'unknown',
    services,
    rows,
  };
}

function extractVercelInspect(text) {
  const clean = stripAnsi(text);
  const getLine = (label) => {
    const line = clean.split(/\r?\n/).find((entry) => entry.trim().startsWith(label));
    return line ? line.replace(/\s+/g, ' ').trim() : '-';
  };
  return {
    status: getLine('status'),
    url: getLine('url'),
    created: getLine('created'),
    raw: clean,
  };
}

function latestLogs(logResult) {
  if (!logResult.ok || !logResult.stdout) return [];
  return logResult.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-20)
    .map((line) => {
      try {
        const json = JSON.parse(line);
        return `${json.timestamp || ''} ${json.message || json.text || ''}`.trim();
      } catch {
        return line;
      }
    });
}

function build() {
  const now = new Date();
  const iso = now.toISOString();
  const local = now.toLocaleString('fr-BE', { timeZone: 'Europe/Paris' });

  const gitStatus = run('git', ['status', '--short']);
  const gitLog = run('git', ['log', '--oneline', '-5']);
  const railwayStatusRaw = run(BIN.railway, ['status', '--json'], { timeout: 120000 });
  const railwayStatus = parseJson(railwayStatusRaw, null);
  const railwayDeployRaw = run(BIN.railway, ['deployment', 'list', '--service', 'ops-worker', '--json'], {
    timeout: 120000,
  });
  const railwayDeploy = firstDeployment(parseJson(railwayDeployRaw, null));
  const railwayLogsRaw = run(BIN.railway, ['logs', '--service', 'ops-worker', '--lines', '80', '--json'], {
    timeout: 120000,
  });
  const vercelInspectRaw = run(BIN.npx, ['vercel', 'inspect', 'www.mngfunglxy.com', '--timeout', '60s'], {
    timeout: 120000,
  });
  const publicHttp = runShell(
    "$r=Invoke-WebRequest -Uri 'https://www.mngfunglxy.com/' -UseBasicParsing -TimeoutSec 30; 'status=' + [int]$r.StatusCode + '; length=' + $r.Content.Length",
    { timeout: 60000 },
  );
  const envPresence = run(BIN.railway, [
    'run',
    '--service',
    'ops-worker',
    'node',
    '-e',
    "const keys=['DATABASE_URL','RESEND_API_KEY','RESEND_FROM','STAFF_REVIEW_EMAIL','STAFF_AUTH_SECRET','PLATFORM_OWNER_CODE','CRON_SECRET']; console.log(JSON.stringify(Object.fromEntries(keys.map(k=>[k,Boolean(process.env[k])]))))",
  ], { timeout: 120000 });
  const envJson = parseJson(envPresence, {});
  const testResult = RUN_TESTS
    ? runShell('npm run test:ops:all', { timeout: 300000 })
    : { ok: null, stdout: 'Tests non lances. Utiliser `npm run obsidian:sync:tests`.' };

  const rail = railwaySummary(railwayStatus);
  const vercel = extractVercelInspect(vercelInspectRaw.stdout || vercelInspectRaw.stderr);
  const logs = latestLogs(railwayLogsRaw);

  writeNote(
    '03 Operations/Live Status.md',
    `# Live Status

Derniere synchronisation: ${local}

## Verdict rapide

| Zone | Etat |
| --- | --- |
| Site public | ${publicHttp.ok ? 'OK' : 'A verifier'} |
| Vercel | ${vercelInspectRaw.ok ? 'Inspect OK' : 'Inspect KO'} |
| Railway | ${railwayStatusRaw.ok ? 'Connecte' : 'Erreur'} |
| Worker ops | ${railwayDeploy?.status || 'unknown'} |
| Git | ${gitStatus.ok && !gitStatus.stdout ? 'Propre' : 'Changements locaux'} |
| Tests | ${RUN_TESTS ? (testResult.ok ? 'OK' : 'KO') : 'Non lances'} |

## Liens

- Production: https://www.mngfunglxy.com
- GitHub: https://github.com/sniperX95/pinelane-fun-galaxy
- [[Railway Health]]
- [[Vercel Health]]
- [[Agent Activity Live]]
- [[../06 Tests/Latest Test Run]]

## Public HTTP

\`\`\`text
${compact(publicHttp.ok ? publicHttp.stdout : publicHttp.stderr)}
\`\`\`

## Git

\`\`\`text
${gitStatus.stdout || 'working tree clean'}

${gitLog.stdout}
\`\`\`
`,
  );

  writeNote(
    '03 Operations/Railway Health.md',
    `# Railway Health

Derniere synchronisation: ${local}

## Projet

- Projet: ${rail.project}
- Environnement: ${rail.environment}
- Worker deployment: ${railwayDeploy?.id || '-'}
- Worker status: ${railwayDeploy?.status || '-'}
- Worker date: ${railwayDeploy?.createdAt || '-'}

## Services

| Service | Deployment | Instance | Commit / ID |
| --- | --- | --- | --- |
${rail.rows.length ? rail.rows.join('\n') : '| - | - | - | - |'}

## Variables critiques presentes

| Variable | Presente |
| --- | --- |
${Object.entries(envJson)
  .map(([key, value]) => `| ${key} | ${value ? 'oui' : 'non'} |`)
  .join('\n')}

## Derniers logs worker

\`\`\`text
${logs.length ? logs.join('\n') : compact(railwayLogsRaw.stderr || 'Aucun log disponible')}
\`\`\`

## Erreur brute si besoin

\`\`\`text
${compact(railwayStatusRaw.ok ? 'Aucune' : railwayStatusRaw.stderr)}
\`\`\`
`,
  );

  writeNote(
    '03 Operations/Vercel Health.md',
    `# Vercel Health

Derniere synchronisation: ${local}

## Production

- Domaine: https://www.mngfunglxy.com
- Inspect: ${vercelInspectRaw.ok ? 'OK' : 'KO'}
- Status: ${vercel.status}
- URL: ${vercel.url}
- Created: ${vercel.created}

## Sortie inspect

\`\`\`text
${compact(vercel.raw, 3000)}
\`\`\`
`,
  );

  writeNote(
    '03 Operations/Obsidian Sync.md',
    `# Obsidian Sync

Derniere synchronisation: ${local}

Cette note documente le pont operationnel entre Codex, Obsidian, Railway, Vercel, GitHub et les tests.

## Ce qui est connecte

| Systeme | Role |
| --- | --- |
| Obsidian | Memoire lisible du projet, runbooks, decisions et etat live |
| Railway | Worker \`ops-worker\`, Postgres, jobs de fond |
| Vercel | Site public et fonctions API |
| GitHub | Source de verite du code versionne |
| Tests locaux | Verification moteur, agents, securite, simulation, qualite |

## Commandes utiles

\`\`\`bash
npm run obsidian:sync
npm run obsidian:sync:tests
\`\`\`

## Garanties

- La sync ecrit dans le vault Obsidian local et dans \`docs/obsidian-vault\`.
- Les secrets Railway/Vercel ne sont jamais copies dans Obsidian.
- Les variables sensibles sont affichees uniquement en presence oui/non.
- Les tests ne remplacent le rapport \`Latest Test Run\` que quand ils sont vraiment lances.

## Limite actuelle

Le worker Railway tourne et les agents metier executent les jobs codes. Un modele IA externe permanent necessite encore une vraie cle API serveur ou un gateway compatible.
`,
  );

  writeNote(
    '04 Agents IA/Agent Activity Live.md',
    `# Agent Activity Live

Derniere synchronisation: ${local}

## Ce qui tourne vraiment

- Railway execute le worker \`ops-worker\`.
- Le worker traite les boucles \`communications\`, \`jobs\` et \`agents\`.
- Les emails passent par Resend si les communications sont dues.
- Les decisions et jobs sont persistables en base.

## Logs detectes

\`\`\`text
${logs.length ? logs.join('\n') : 'Aucun log lisible.'}
\`\`\`

## Lecture operationnelle

Si les lignes \`communications:ok\`, \`jobs:ok\` et \`agents:ok\` apparaissent regulierement, le moteur de fond respire.

Si elles disparaissent:

1. verifier Railway;
2. verifier variables DB/Resend;
3. lancer \`railway logs --service ops-worker --lines 120 --json\`;
4. verifier \`npm run worker:once\` localement si necessaire.

## Limite importante

Cette sync ne prouve pas qu'un modele IA externe est connecte. Pour cela, il faut une vraie cle API serveur ou un AI Gateway.
`,
  );

  if (RUN_TESTS) {
    writeNote(
      '06 Tests/Latest Test Run.md',
      `# Latest Test Run

Derniere synchronisation: ${local}

## Commande

\`\`\`bash
${RUN_TESTS ? 'npm run test:ops:all' : 'npm run obsidian:sync:tests'}
\`\`\`

## Resultat

${RUN_TESTS ? (testResult.ok ? 'OK' : 'KO') : 'Non lance pendant cette sync.'}

## Sortie

\`\`\`text
${compact(testResult.ok ? testResult.stdout : testResult.stderr || testResult.stdout, 6000)}
\`\`\`
`,
    );
  }

  writeNote(
    '00 Start Here/02 - Command Center.md',
    `# Command Center

Derniere synchronisation: ${local}

## Ouvrir vite

- [[00 - Accueil]]
- [[../03 Operations/Live Status]]
- [[../03 Operations/Railway Health]]
- [[../03 Operations/Vercel Health]]
- [[../04 Agents IA/Agent Activity Live]]
- [[../06 Tests/Latest Test Run]]

## Commandes

\`\`\`bash
npm run obsidian:sync
npm run obsidian:sync:tests
npm run test:ops:all
railway logs --service ops-worker --lines 120 --json
npx vercel inspect www.mngfunglxy.com --timeout 120s
git status --short
\`\`\`

## Etat express

- Site public: ${publicHttp.ok ? 'OK' : 'A verifier'}
- Railway worker: ${railwayDeploy?.status || 'unknown'}
- Tests: ${RUN_TESTS ? (testResult.ok ? 'OK' : 'KO') : 'non lances'}
- Git: ${gitStatus.ok && !gitStatus.stdout ? 'propre' : 'changements locaux'}

## Prochaine action utile

Construire le module retard operationnel:

1. staff declare retard;
2. moteur recalcule impacts;
3. alternatives si conflit;
4. client/staff informes;
5. decision loggee dans Obsidian/ops.
`,
  );

  return {
    vault: VAULT_ROOT,
    repoVault: REPO_VAULT,
    syncedAt: iso,
    publicOk: publicHttp.ok,
    railwayOk: railwayStatusRaw.ok,
    workerStatus: railwayDeploy?.status || null,
    vercelOk: vercelInspectRaw.ok,
    tests: RUN_TESTS ? Boolean(testResult.ok) : null,
  };
}

const summary = build();
console.log(JSON.stringify(summary, null, 2));

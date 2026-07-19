// Gate d'honnetete des connecteurs sociaux.
//
// Le probleme qu'il ferme : le produit n'a AUCUNE capacite de publication
// sociale (ni Meta Graph, ni LinkedIn, ni TikTok). Les agents redigent un
// brouillon, la directrice le copie-colle et publie a la main - c'est un choix
// produit assume (publier par API declenche des shadow-bans). Avant ce gate, la
// simple presence de META/TIKTOK/LINKEDIN_ACCESS_TOKEN allumait un point
// "connecte", gonflait le score d'autonomie et pouvait afficher un libelle du
// type "Production surveillee". Un client qui "connecte Instagram" croyait que
// le systeme publiait. C'est un mensonge produit avant d'etre un bug.
//
// Le gate verifie la COHERENCE entre deux faits, pas juste un libelle :
//  1. Est-ce qu'un appel a une API sociale existe reellement dans le depot ?
//  2. Si non, alors aucun libelle rendu au client ne doit promettre une
//     publication automatique ou une surveillance de production, et aucun token
//     social ne doit rapporter un seul point d'autonomie.
// Le jour ou quelqu'un branche vraiment l'API Graph, le point 1 devient vrai,
// le gate rougit et force a revalider le contrat au lieu de le laisser pourrir.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'lib', 'marketing-agents.js');

// Exclus : dependances, builds Vercel et artifacts (ce sont des SNAPSHOTS d'un
// code deja livre, pas la source ; ils contiennent encore les anciens libelles
// et les reecrire ne changerait rien au produit).
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.vercel', '.agents', '.firecrawl',
  'artifacts', '_mkdev', 'dist', 'build', '.next', 'coverage', 'database',
]);
const SKIP_FILES = new Set(['social-honesty-check.js', 'package-lock.json']);
const EXT = new Set(['.js', '.mjs', '.cjs', '.html']);

// Hotes des vraies API de publication sociale. Si l'un apparait dans le code,
// une capacite de publication existe peut-etre et tout ce fichier est a revoir.
const SOCIAL_API_HOSTS = [
  'graph.facebook.com',
  'graph.instagram.com',
  'api.linkedin.com',
  'open-api.tiktok.com',
  'business-api.tiktok.com',
  'open.tiktokapis.com',
];

// Libelles interdits tant qu'aucune API sociale n'est branchee. On vise ce que
// le client LIT, pas la prose interne.
const FORBIDDEN_LABELS = [
  { re: /production\s+surveillee/i, why: 'laisse croire que le systeme publie et surveille une prod sociale' },
  { re: /publication\s+automati/i, why: 'promet une publication automatique inexistante' },
  { re: /publie[rz]?\s+(automatiquement|depuis\s+pinlane|a\s+votre\s+place|pour\s+vous)/i, why: 'promet que le produit publie a la place de l humain' },
  { re: /post(e|er|age)\s+automati/i, why: 'promet un postage automatique inexistant' },
  { re: /connecter\s+les\s+canaux\s+officiels\s+pour\s+publier/i, why: 'promet que brancher un token declenche la publication' },
];

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log(`ok    ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), acc);
      continue;
    }
    if (SKIP_FILES.has(entry.name)) continue;
    if (!EXT.has(path.extname(entry.name))) continue;
    acc.push(path.join(dir, entry.name));
  }
  return acc;
}

// Les commentaires ne sont pas rendus au client, et ils DOIVENT pouvoir parler
// de "publication automatique" pour expliquer qu'elle n'existe pas. On ne scanne
// donc que les lignes de code. Limite assumee : un commentaire de fin de ligne
// reste scanne, ce qui est le sens sur (faux positif possible, faux negatif non).
function codeLines(source) {
  return source.split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((item) => !item.line.trim().startsWith('//') && !item.line.trim().startsWith('*'));
}

function scanForbidden(entries, origin) {
  const hits = [];
  for (const entry of entries) {
    for (const rule of FORBIDDEN_LABELS) {
      if (rule.re.test(entry.line)) {
        hits.push(`${origin}:${entry.number} ${rule.why} -> ${entry.line.trim().slice(0, 120)}`);
      }
    }
  }
  return hits;
}

(async () => {
  // ── 1. Etat de fait : est-ce qu'une API sociale est appelee quelque part ? ──
  console.log('\n[FAIT] aucune capacite de publication sociale dans le depot');
  const files = walk(ROOT);
  const apiHits = [];
  for (const file of files) {
    // Meme filtre que pour les libelles : nommer graph.facebook.com dans un
    // commentaire pour dire qu on ne l appelle PAS n est pas un appel.
    for (const entry of codeLines(fs.readFileSync(file, 'utf8'))) {
      for (const host of SOCIAL_API_HOSTS) {
        if (entry.line.includes(host)) {
          apiHits.push(`${path.relative(ROOT, file)}:${entry.number} contient ${host}`);
        }
      }
    }
  }
  const socialApiExists = apiHits.length > 0;
  ok(!socialApiExists,
    'aucun appel a graph.facebook.com / api.linkedin.com / API TikTok',
    socialApiExists
      ? `Une API sociale semble branchee. Le contrat d honnetete de ce gate suppose l inverse : revalider les libelles ET le score d autonomie, puis mettre ce gate a jour.\n      ${apiHits.join('\n      ')}`
      : '');

  // ── 2. Coherence : pas d API, donc pas de libelle qui promet la publication ─
  console.log('\n[COHERENCE] les libelles ne promettent que ce que le code fait');
  const targetHits = scanForbidden(codeLines(fs.readFileSync(TARGET, 'utf8')), 'lib/marketing-agents.js');
  ok(targetHits.length === 0,
    'aucun libelle de publication automatique dans lib/marketing-agents.js',
    targetHits.join('\n      '));

  // ── 3. Runtime : un token bidon ne doit acheter aucun point d autonomie ─────
  console.log('\n[SCORE] un token social present n automatise rien, donc ne vaut rien');
  for (const key of ['META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN', 'LINKEDIN_ACCESS_TOKEN', 'RESEND_API_KEY',
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    delete process.env[key];
  }
  const {
    buildMarketingAutonomyReport,
    buildMarketingMissions,
    getMarketingPlatforms,
  } = require('../lib/marketing-agents');

  // Contexte constant : seules les variables d env changent d un scenario a l autre.
  const observations = Array.from({ length: 10 }, (_, index) => ({ source: index === 0 ? 'internal_playbook' : 'manual_feedback' }));
  const runs = Array.from({ length: 6 }, () => ({ status: 'ready', createdAt: '2026-07-19T10:00:00.000Z' }));
  const report = () => buildMarketingAutonomyReport({ runs, suggestions: [], observations, agents: getMarketingPlatforms() });

  const baseline = report();
  process.env.META_ACCESS_TOKEN = 'fake-token-jamais-validee';
  process.env.TIKTOK_ACCESS_TOKEN = 'fake-token-jamais-validee';
  process.env.LINKEDIN_ACCESS_TOKEN = 'fake-token-jamais-validee';
  const withFakeSocial = report();

  ok(withFakeSocial.score === baseline.score,
    'trois faux tokens sociaux ne changent pas le score d autonomie',
    `sans token=${baseline.score}, avec faux tokens=${withFakeSocial.score}`);
  ok(!('officialConnectors' in withFakeSocial.scoreParts),
    'le poste de score officialConnectors (theatre) a disparu',
    JSON.stringify(withFakeSocial.scoreParts));
  ok(withFakeSocial.capabilities.socialApiCalls === false && withFakeSocial.capabilities.socialPublishing === 'manuelle',
    'les capacites declarent la publication manuelle et l absence d appel API',
    JSON.stringify(withFakeSocial.capabilities));

  // Le canal email, lui, envoie pour de vrai (api.resend.com, lib/ops-communications.js) :
  // le score doit encore recompenser ce qui est reellement automatise.
  // Variables ISOLEES. Poser RESEND et ANTHROPIC ensemble confond deux postes
  // de score (emailDelivery et generation) : la comparaison resterait vraie
  // grace a la generation meme si emailDelivery tombait a zero, donc
  // l assertion ne prouverait plus rien sur l email.
  process.env.RESEND_API_KEY = 'fake-resend-key';
  const withMail = report();
  ok(withMail.score === withFakeSocial.score + 5,
    'le canal email (envoi reel via api.resend.com) vaut exactement ses 5 points',
    `sans email=${withFakeSocial.score}, avec email=${withMail.score}`);

  process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key';
  const withRealAutomation = report();
  ok(withRealAutomation.score > withMail.score,
    'la generation IA ajoute ses propres points par-dessus le canal email',
    `email seul=${withMail.score}, avec IA=${withRealAutomation.score}`);

  console.log('\n[LIBELLE] meme au score maximum, aucune promesse de publication');
  const maxLabelHits = scanForbidden([{ line: withRealAutomation.label, number: 0 }], 'autonomy.label');
  ok(maxLabelHits.length === 0,
    `le libelle au score max reste honnete (score=${withRealAutomation.score}, label="${withRealAutomation.label}")`,
    maxLabelHits.join('\n      '));
  const blockerText = withRealAutomation.blockers.map((blocker) => `${blocker.title} ${blocker.detail}`).join(' | ');
  ok(scanForbidden([{ line: blockerText, number: 0 }], 'autonomy.blockers').length === 0,
    'aucun blocker ne presente la publication manuelle comme une panne a reparer');

  console.log('\n[MISSIONS] la derniere etape est une remise a l humain');
  const missions = buildMarketingMissions({ summary: { ready: 3, review: 1, blocked: 0 }, strategy: {}, generationMode: 'rules' });
  const publication = missions.find((mission) => mission.id === 'publication');
  ok(Boolean(publication), 'la mission publication existe toujours');
  ok(scanForbidden([{ line: `${publication.label} ${publication.detail}`, number: 0 }], 'missions.publication').length === 0,
    'la mission publication ne promet aucune publication automatique',
    `${publication.label} / ${publication.detail}`);

  console.log('\n[CHAMPS] le contrat API ne peut plus se lire comme "connecte"');
  const platforms = getMarketingPlatforms();
  ok(platforms.every((platform) => !('connected' in platform)),
    'plus aucun champ connected ambigu expose par getMarketingPlatforms');
  ok(platforms.every((platform) => typeof platform.envConfigured === 'boolean'),
    'chaque canal expose envConfigured (presence d une variable d env, rien de plus)');
  const socialPlatforms = platforms.filter((platform) => platform.platform !== 'email');
  ok(socialPlatforms.every((platform) => platform.publishing === 'manuelle'),
    'les 4 canaux sociaux sont declares en publication manuelle',
    JSON.stringify(socialPlatforms.map((platform) => `${platform.platform}=${platform.publishing}`)));

  console.log(`\nsocial-honesty-check: ${failures ? `${failures} FAIL` : 'ALL OK'}`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('social-honesty-check: CRASH', err && err.message);
  process.exit(1);
});

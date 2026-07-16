// Tests du second cerveau (ADN sectoriel). Purs, sans DB : on injecte query.
const {
  loadDnaRules, rankDnaRules, renderDnaBlock, buildDnaBlock, ingestDnaRules, normalizeRule, listDnaStats,
  MAX_RULES_PER_PROMPT,
} = require('../lib/marketing-dna');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log(`ok    ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

(async () => {
  // ── normalizeRule : la source est le garde-fou anti-invention ──────────────
  console.log('\n[GARDE-FOU] une regle sans source n\'entre pas dans le cerveau');
  ok(normalizeRule({ nom: 'x', regle: 'y', source: 'https://a.b' }).ok, 'regle sourcee acceptee');
  ok(!normalizeRule({ nom: 'x', regle: 'y', source: '' }).ok, 'regle SANS source rejetee');
  ok(!normalizeRule({ nom: 'x', regle: 'y' }).ok, 'source absente rejetee');
  ok(!normalizeRule({ nom: '', regle: 'y', source: 'https://a.b' }).ok, 'nom vide rejete');
  ok(normalizeRule({ nom: 'x', regle: 'y', source: 'https://a.b', confiance: 'nimporte' }).row.confiance === 'speculatif',
    'confiance inconnue retombe sur speculatif (jamais promue)');
  ok(normalizeRule({ nom: 'x', regle: 'y', source: 'https://a.b', confiance: 'solide' }).row.confiance === 'solide',
    'confiance solide preservee');

  // ── ingestDnaRules : idempotence + rejet ───────────────────────────────────
  console.log('\n[INGESTION] idempotente, et elle recense ce qu\'elle refuse');
  const seen = [];
  const fakeQuery = async (sql, params) => {
    seen.push(params);
    return { rows: [{ is_insert: true }] };
  };
  const report = await ingestDnaRules([
    { nom: 'hook court', regle: 'Le hook fait 5 a 10 mots.', source: 'https://etude.example', confiance: 'solide' },
    { nom: 'sans source', regle: 'Fais un truc.', source: '' },
    { nom: 'vide', regle: '', source: 'https://a.b' },
  ], { query: fakeQuery, angle: 'facebook-local', channel: 'facebook' });
  ok(report.inserted === 1, 'seule la regle sourcee est ecrite', `inserted=${report.inserted}`);
  ok(report.rejected.length === 2, '2 regles rejetees', JSON.stringify(report.rejected));
  ok(report.rejected.some((r) => /sans source/.test(r)), 'le rapport nomme la regle sans source');
  ok(seen.length === 1 && seen[0][0] === 'facebook-local' && seen[0][1] === 'facebook',
    'angle et canal propages a la ligne');

  // ── loadDnaRules : fail-soft ───────────────────────────────────────────────
  console.log('\n[FAIL-SOFT] l\'ADN enrichit, il ne conditionne jamais la generation');
  const boom = async () => { throw new Error('table absente'); };
  ok((await loadDnaRules('facebook', { query: boom })).length === 0, 'DB cassee -> [] (pas de crash)');
  ok((await buildDnaBlock('facebook', { query: boom })) === '', 'DB cassee -> bloc vide (le prompt garde le playbook)');
  ok((await listDnaStats({ query: boom })).length === 0, 'stats fail-soft');

  // ── renderDnaBlock ─────────────────────────────────────────────────────────
  console.log('\n[RENDU] le bloc injecte dans le prompt');
  ok(renderDnaBlock([]) === '', 'aucune regle -> bloc vide (zero token gaspille)');

  const rules = [
    { angle: 'facebook-local', channel: 'facebook', nom: 'a', regle: 'Le hook fait 5 a 10 mots.', exemple: 'Vous cherchez une idee ?', preuve: 'etude X', source: 'https://x', confiance: 'solide' },
    { angle: 'divers', channel: '', nom: 'b', regle: 'Un seul CTA par post.', exemple: '', preuve: 'obs', source: 'https://y', confiance: 'plausible' },
  ];
  const block = renderDnaBlock(rules);
  ok(/ADN DU SECTEUR/.test(block), 'le bloc est identifie comme de l\'ADN sectoriel');
  ok(/Regles etablies/.test(block) && /Le hook fait 5 a 10 mots/.test(block), 'les regles solides sont listees a part');
  ok(/Regles probables/.test(block) && /Un seul CTA/.test(block), 'les regles plausibles sont listees, mais etiquetees');
  ok(/Vous cherchez une idee/.test(block), 'les exemples reels sont injectes');

  // Le point le PLUS important de tout le module : l'ADN ne doit jamais pouvoir
  // reintroduire une invention. Il dit COMMENT ecrire, pas QUOI affirmer.
  ok(/jamais QUOI affirmer|ne peut jamais dire QUOI|COMMENT ecrire/i.test(block),
    'le bloc rappelle que l\'ADN ne dicte pas les FAITS');
  ok(/centerFacts/.test(block), 'le bloc renvoie explicitement aux faits du centre pour les affirmations');
  ok(/JAMAIS a recopier/.test(block), 'les exemples sont marques non-recopiables (leurs chiffres ne sont pas nos faits)');

  // ── determinisme (le cache de prompt en depend) ────────────────────────────
  console.log('\n[CACHE] le bloc doit etre byte-identique entre deux appels');
  ok(renderDnaBlock(rules) === block, 'rendu deterministe (sinon le cache de prompt saute a chaque generation)');

  // ── classement par pertinence (defaut G de l'audit) ────────────────────────
  console.log('\n[SELECTION] la pertinence choisit les regles, plus JAMAIS la longueur');
  const pool = [
    { id: 1, angle: 'divers', channel: '', nom: 'courte hors sujet', regle: 'Poste tot.', confiance: 'plausible' },
    { id: 2, angle: 'urgence', channel: 'facebook', nom: 'longue pertinente', regle: 'Quand une pluie est prevue, annonce le refuge indoor la veille avec une fenetre horaire precise et un seul appel a l\'action, sans jargon.', confiance: 'plausible' },
    { id: 3, angle: 'preuve-sociale', channel: 'email', nom: 'autre canal', regle: 'Cite un avis reel.', confiance: 'plausible' },
    { id: 4, angle: 'divers', channel: '', nom: 'etablie', regle: 'Une regle etablie tres tres tres tres tres tres tres tres longue qui ne doit jamais etre penalisee pour sa longueur.', confiance: 'solide' },
  ];
  ok(pool.length >= 4, 'echantillon non vide (garde anti-echantillon-vide)');
  const ranked = rankDnaRules(pool, { channel: 'facebook', angle: 'urgence', themeLabel: 'Pluie prevue (12 mm)' });
  ok(ranked[0].id === 4, 'la confiance prime : la regle solide sort premiere, meme tres longue');
  ok(ranked[1].id === 2, 'a confiance egale, canal + angle + theme battent la brievete (la longue pertinente sort 2e)');
  ok(ranked[ranked.length - 1].id === 3 || ranked[ranked.length - 1].id === 1, 'les moins pertinentes sortent en dernier');
  const rankedAgain = rankDnaRules(pool, { channel: 'facebook', angle: 'urgence', themeLabel: 'Pluie prevue (12 mm)' });
  ok(JSON.stringify(rankedAgain) === JSON.stringify(ranked), 'classement deterministe (tie-break par id, pas par hasard)');
  ok(rankDnaRules([], { channel: 'facebook' }).length === 0, 'aucune regle -> [] (pas de crash, pas d\'invention)');

  // loadDnaRules delegue au classement pur et coupe a la limite.
  const bigPool = Array.from({ length: 30 }, (unused, index) => ({
    id: index + 1, angle: 'divers', channel: '', nom: `r${index + 1}`, regle: `Regle numero ${index + 1}.`, confiance: 'plausible',
  }));
  const loaded = await loadDnaRules('facebook', { query: async () => ({ rows: bigPool }) });
  ok(loaded.length === MAX_RULES_PER_PROMPT, `le plafond de ${MAX_RULES_PER_PROMPT} regles tient (obtenu ${loaded.length})`);
  ok(loaded[0].id === 1 && loaded[11].id === 12, 'a pertinence egale, la coupe est stable par id (plus jamais length(regle))');

  // ── typographie ────────────────────────────────────────────────────────────
  ok(!new RegExp('[\\u2014\\u2013]').test(block), 'le bloc ne contient aucun tiret cadratin');

  console.log(`\nmarketing-dna-check: ${failures ? `${failures} FAIL` : 'ALL OK'}`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('marketing-dna-check: CRASH', err && err.message);
  process.exit(1);
});

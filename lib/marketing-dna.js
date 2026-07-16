'use strict';

// Second cerveau des agents marketing : lecture + ingestion de l'ADN sectoriel.
//
// Ce module repond a une seule question : « quelles regles de copywriting
// injecter dans le prompt de CE canal, maintenant ? »
//
// Hierarchie non negociable (voir database/marketing-dna-schema.sql) :
//   1. Ce qu'on a MESURE chez nous (marketing_patterns) bat tout.
//   2. L'ADN du secteur (ici) est le PRIOR : il comble le vide quand on n'a pas
//      encore assez d'observations, ce qui est le cas permanent d'un tenant a
//      deux centres.
// Un blog qui dit « les carrousels performent » ne pese rien face a nos propres
// reservations qui disent le contraire pour Libramont.
//
// Budget de tokens : l'ADN part dans le bloc STABLE du prompt (cache Anthropic).
// Il ne change qu'a l'ingestion, donc le cache tient entre les generations. On
// plafonne quand meme : un prompt gave de 200 regles produit de la bouillie, pas
// de la qualite. Les meilleures regles d'abord, et on s'arrete.

const { getPool } = require('./database');

const CONFIDENCE_RANK = { solide: 0, plausible: 1, speculatif: 2 };
const MAX_RULES_PER_PROMPT = 12;
const MAX_EXAMPLES_PER_PROMPT = 3;

function defaultQuery(text, params) {
  return getPool().query(text, params);
}

// Les regles utiles pour un canal : celles du canal + les transverses.
// Fail-soft : sans DB (ou table absente), on rend [] et le prompt garde le
// playbook statique. L'ADN enrichit, il ne conditionne jamais la generation.
async function loadDnaRules(channel = '', { query = defaultQuery, limit = MAX_RULES_PER_PROMPT } = {}) {
  try {
    const { rows } = await query(
      `select angle, channel, nom, regle, exemple, preuve, source, confiance
         from marketing_dna
        where actif = true
          and (channel = $1 or channel = '')
        order by case confiance when 'solide' then 0 when 'plausible' then 1 else 2 end,
                 case when channel = $1 then 0 else 1 end,
                 length(regle)
        limit $2;`,
      [String(channel || ''), Math.max(1, Number(limit) || MAX_RULES_PER_PROMPT)],
    );
    return rows || [];
  } catch {
    return [];
  }
}

// Le bloc injectable. Rendu deterministe (meme entree, meme octets) pour ne pas
// casser le cache de prompt a chaque appel.
function renderDnaBlock(rules = []) {
  if (!rules.length) return '';
  const solides = rules.filter((r) => r.confiance === 'solide');
  const autres = rules.filter((r) => r.confiance !== 'solide');

  const lines = [];
  lines.push('--- ADN DU SECTEUR (recherche sur sources publiques, verifie) ---');
  lines.push('Ces regles viennent de ce qui marche REELLEMENT chez les centres de loisirs francophones. Elles ne sont pas des faits sur Fun Galaxy : elles disent COMMENT ecrire, jamais QUOI affirmer. Les faits restent exclusivement ceux de centerFacts.');
  if (solides.length) {
    lines.push('');
    lines.push('Regles etablies (appuyees sur un chiffre ou une etude) :');
    for (const r of solides) lines.push(`- ${r.regle}`);
  }
  if (autres.length) {
    lines.push('');
    lines.push('Regles probables (observation convergente, a tester) :');
    for (const r of autres) lines.push(`- ${r.regle}`);
  }

  const exemples = rules.filter((r) => r.exemple && r.exemple.trim()).slice(0, MAX_EXAMPLES_PER_PROMPT);
  if (exemples.length) {
    lines.push('');
    lines.push('Exemples reels du secteur (ADN d\'ecriture, JAMAIS a recopier, leurs chiffres ne sont pas nos faits) :');
    for (const r of exemples) lines.push(`« ${r.exemple.trim()} »`);
  }
  return lines.join('\n');
}

async function buildDnaBlock(channel = '', deps = {}) {
  const rules = await loadDnaRules(channel, deps);
  return renderDnaBlock(rules);
}

// Ingestion idempotente : rejouer la meme recherche met a jour, ne duplique pas.
// Le workflow de recherche est fait pour tourner en boucle (« tout doit
// s'ameliorer constamment ») : sans convergence, la table gonflerait a chaque
// run et le prompt avec elle.
//
// Une regle sans source est REJETEE. C'est la garantie qu'aucune invention de
// modele n'entre dans le cerveau : si personne ne peut montrer d'ou ca vient,
// ca n'existe pas.
function normalizeRule(raw = {}, angle = '', channel = '') {
  const nom = String(raw.nom || '').trim();
  const regle = String(raw.regle || '').trim();
  const source = String(raw.source || '').trim();
  if (!nom || !regle) return { ok: false, reason: 'nom ou regle vide' };
  if (!source) return { ok: false, reason: `sans source: "${nom}"` };
  const confiance = ['solide', 'plausible', 'speculatif'].includes(raw.confiance) ? raw.confiance : 'speculatif';
  return {
    ok: true,
    row: {
      angle: String(raw.angle || angle || '').trim() || 'divers',
      channel: String(raw.channel || channel || '').trim(),
      nom,
      regle,
      exemple: String(raw.exemple || '').trim(),
      preuve: String(raw.preuve || '').trim(),
      source,
      confiance,
      origine: ['recherche', 'colle-un-post', 'mesure'].includes(raw.origine) ? raw.origine : 'recherche',
    },
  };
}

async function ingestDnaRules(rules = [], { query = defaultQuery, angle = '', channel = '' } = {}) {
  const report = { inserted: 0, updated: 0, rejected: [] };
  for (const raw of rules) {
    const norm = normalizeRule(raw, angle, channel);
    if (!norm.ok) { report.rejected.push(norm.reason); continue; }
    const r = norm.row;
    const { rows } = await query(
      `insert into marketing_dna (angle, channel, nom, regle, exemple, preuve, source, confiance, origine)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (angle, nom) do update set
         channel = excluded.channel, regle = excluded.regle, exemple = excluded.exemple,
         preuve = excluded.preuve, source = excluded.source, confiance = excluded.confiance,
         origine = excluded.origine, actif = true, updated_at = now()
       returning (xmax = 0) as is_insert;`,
      [r.angle, r.channel, r.nom, r.regle, r.exemple, r.preuve, r.source, r.confiance, r.origine],
    );
    if (rows && rows[0] && rows[0].is_insert) report.inserted += 1;
    else report.updated += 1;
  }
  return report;
}

async function listDnaStats({ query = defaultQuery } = {}) {
  try {
    const { rows } = await query(
      `select angle, confiance, count(*)::int as n from marketing_dna
        where actif = true group by angle, confiance order by angle, confiance;`,
    );
    return rows || [];
  } catch {
    return [];
  }
}

module.exports = {
  loadDnaRules,
  renderDnaBlock,
  buildDnaBlock,
  ingestDnaRules,
  normalizeRule,
  listDnaStats,
  MAX_RULES_PER_PROMPT,
  CONFIDENCE_RANK,
};

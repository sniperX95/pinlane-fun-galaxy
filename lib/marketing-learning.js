// CE QUE L'IA MARKETING A APPRIS : l'etat d'apprentissage, lu tel quel.
//
// Demande de Movsar (2026-07-28) : « j'aimerais pour moi cote admin uniquement
// un truc ou je peux voir l'evolution de l'IA integree, son apprentissage ».
// Cette lecture est donc reservee a platform.admin (api/ops.js) : elle expose
// la mecanique interne de Pinlane, pas une donnee d'exploitation du centre.
//
// REGLE DURE : ce module ne calcule AUCUN indicateur de complaisance. Il lit
// les quatre endroits ou l'apprentissage se depose reellement, et il dit ce
// qui est encore vide au lieu de le maquiller :
//
//   1. marketing_agent_criteria : la GRILLE de jugement. Chaque agent de
//      plateforme note ses brouillons sur des criteres ponderes. Certains sont
//      poses au depart (source seed / internal_playbook), d'autres NAISSENT de
//      ce que l'agent observe sur le terrain (signalType). Le rapport entre les
//      deux est la vraie mesure de l'apprentissage : une grille qui n'a que des
//      criteres d'origine n'a rien appris, quel que soit son score.
//   2. marketing_agent_runs : l'auto-evaluation, run par run. Un score qui
//      monte sur une grille qui ne bouge pas ne prouve rien (l'agent apprend a
//      passer son propre examen) : les deux se lisent ENSEMBLE.
//   3. marketing_dna : les regles d'ecriture, avec leur niveau de confiance et
//      leur origine (recherche, terrain, humain).
//   4. marketing_patterns / marketing_arms : ce qui est APPRIS DES RESULTATS
//      (un post publie, mesure 14 jours, puis credite ou non). C'est le seul
//      apprentissage qui vaut de l'argent, et c'est celui qui demande des
//      publications reelles : tant qu'il n'y en a pas, ces tables sont vides et
//      la page doit le DIRE.

const { getPool } = require('./database');
// Un seul seuil de confiance dans tout le produit : celui des motifs mesures
// (>= 6 solide, >= 3 signal, sinon exploratoire). En reecrire un ici creerait
// deux verites sur la meme question, « a partir de quand ce chiffre veut dire
// quelque chose ».
const { patternConfidence } = require('./center-metrics');

function query(text, params) {
  return getPool().query(text, params);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(num(value) * factor) / factor;
}

// L'evidence d'un critere est un JSON libre ecrit par l'agent. On n'en extrait
// que ce qui se montre : d'ou il vient, quand il a ete revu, ses mots-cles.
function readEvidence(raw) {
  if (!raw) return { source: '', signalType: '', lastSeen: '', keywords: [] };
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch (error) { return { source: '', signalType: '', lastSeen: '', keywords: [] }; }
  }
  if (!data || typeof data !== 'object') return { source: '', signalType: '', lastSeen: '', keywords: [] };
  const keywords = Array.isArray(data.keywords) ? data.keywords.filter((k) => typeof k === 'string').slice(0, 6) : [];
  return {
    source: String(data.source || ''),
    signalType: String(data.signalType || ''),
    lastSeen: String(data.lastSeen || ''),
    keywords,
  };
}

// Un critere est « appris » s'il n'a pas ete pose au depart : il porte un
// identifiant observe (prefixe `observed_`) ou un type de signal terrain.
function isLearned(criterionId, evidence) {
  if (String(criterionId || '').startsWith('observed_')) return true;
  const signal = String(evidence.signalType || '');
  return Boolean(signal) && signal !== 'seed';
}

async function readGrid(centerId) {
  const { rows } = await query(
    `select platform, criterion_id, label, description, weight, evidence, updated_at
       from marketing_agent_criteria
      where center_id = $1
      order by weight desc, criterion_id asc`,
    [centerId],
  );
  const byPlatform = new Map();
  let learned = 0;
  for (const row of rows) {
    const evidence = readEvidence(row.evidence);
    const entry = {
      criterionId: row.criterion_id,
      label: row.label || row.criterion_id,
      description: row.description || '',
      weight: round(row.weight, 2),
      learned: isLearned(row.criterion_id, evidence),
      source: evidence.source,
      signalType: evidence.signalType,
      lastSeen: evidence.lastSeen,
      keywords: evidence.keywords,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    };
    if (entry.learned) learned += 1;
    if (!byPlatform.has(row.platform)) byPlatform.set(row.platform, []);
    byPlatform.get(row.platform).push(entry);
  }
  const platforms = [...byPlatform.entries()].map(([platform, list]) => ({
    platform,
    count: list.length,
    learned: list.filter((c) => c.learned).length,
    avgWeight: round(list.reduce((sum, c) => sum + c.weight, 0) / (list.length || 1), 2),
    updatedAt: list.map((c) => c.updatedAt).filter(Boolean).sort().pop() || '',
    top: list.slice(0, 6),
  })).sort((a, b) => a.platform.localeCompare(b.platform));
  return { total: rows.length, learned, platforms };
}

async function readQuality(centerId, days) {
  const { rows } = await query(
    `select platform, agent_id, run_type, status, score, summary, created_at
       from marketing_agent_runs
      where center_id = $1
        and created_at >= now() - ($2 || ' days')::interval
      order by created_at asc`,
    [centerId, String(days)],
  );
  const byDay = new Map();
  const byPlatform = new Map();
  for (const row of rows) {
    const score = row.score === null || row.score === undefined ? null : num(row.score);
    const day = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '';
    if (day) {
      if (!byDay.has(day)) byDay.set(day, []);
      if (score !== null) byDay.get(day).push(score);
    }
    if (!byPlatform.has(row.platform)) byPlatform.set(row.platform, []);
    if (score !== null) byPlatform.get(row.platform).push({ score, at: row.created_at });
  }
  const series = [...byDay.entries()].map(([day, scores]) => ({
    day,
    n: scores.length,
    avg: scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    min: scores.length ? Math.min(...scores) : null,
    max: scores.length ? Math.max(...scores) : null,
  })).sort((a, b) => a.day.localeCompare(b.day));
  const platforms = [...byPlatform.entries()].map(([platform, list]) => ({
    platform,
    runs: list.length,
    avg: list.length ? round(list.reduce((sum, item) => sum + item.score, 0) / list.length) : null,
    last: list.length ? round(list[list.length - 1].score) : null,
  })).sort((a, b) => a.platform.localeCompare(b.platform));
  // La tendance ne se declare qu'avec DEUX jours distincts de mesure : sur un
  // seul jour, « stable » serait une invention.
  let trend = null;
  if (series.length >= 2) {
    const first = series[0].avg;
    const last = series[series.length - 1].avg;
    if (first !== null && last !== null) trend = round(last - first);
  }
  const failures = rows.filter((row) => row.status && row.status !== 'finished').length;
  return { runs: rows.length, days, series, platforms, trend, failures };
}

async function readDna() {
  // Le DNA est un actif de PLATEFORME (pas de colonne center_id) : ce sont les
  // regles d'ecriture de Pinlane, partagees par tous les centres.
  const { rows } = await query(
    `select angle, channel, nom, regle, confiance, origine, actif, updated_at
       from marketing_dna
      order by updated_at desc nulls last`,
  );
  const byOrigin = new Map();
  for (const row of rows) {
    const key = row.origine || 'inconnu';
    if (!byOrigin.has(key)) byOrigin.set(key, { origine: key, total: 0, actifs: 0, solide: 0, plausible: 0, speculatif: 0 });
    const bucket = byOrigin.get(key);
    bucket.total += 1;
    if (row.actif) bucket.actifs += 1;
    const confidence = String(row.confiance || '').toLowerCase();
    if (confidence in bucket) bucket[confidence] += 1;
  }
  return {
    total: rows.length,
    actifs: rows.filter((row) => row.actif).length,
    byOrigin: [...byOrigin.values()].sort((a, b) => b.total - a.total),
    recent: rows.slice(0, 8).map((row) => ({
      nom: row.nom || '',
      angle: row.angle || '',
      channel: row.channel || '',
      confiance: row.confiance || '',
      origine: row.origine || '',
      actif: Boolean(row.actif),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    })),
  };
}

async function readProposals(centerId) {
  const { rows } = await query(
    `select kind, status, channel, title, proposed_at, applied_at, measured_at, result
       from marketing_insights
      where center_id = $1
      order by coalesce(proposed_at, created_at) desc`,
    [centerId],
  );
  const byStatus = new Map();
  for (const row of rows) {
    const key = row.status || 'inconnu';
    byStatus.set(key, (byStatus.get(key) || 0) + 1);
  }
  return {
    total: rows.length,
    applied: rows.filter((row) => row.applied_at).length,
    measured: rows.filter((row) => row.measured_at).length,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    recent: rows.slice(0, 6).map((row) => ({
      title: row.title || '',
      kind: row.kind || '',
      channel: row.channel || '',
      status: row.status || '',
      proposedAt: row.proposed_at ? new Date(row.proposed_at).toISOString().slice(0, 10) : '',
      measuredAt: row.measured_at ? new Date(row.measured_at).toISOString().slice(0, 10) : '',
    })),
  };
}

// L'apprentissage PAR LES RESULTATS. Deux tables, un seul message quand elles
// sont vides : ce n'est pas une panne, c'est qu'aucune publication n'a encore
// ete mesuree. On rend la raison au lieu d'un graphe a zero.
async function readMeasurement(centerId) {
  const patterns = await query(
    `select context_key, kind, channel, trigger, avg_net_delta, n, wins, confidence, updated_at
       from marketing_patterns
      where center_id = $1
      order by n desc, updated_at desc
      limit 8`,
    [centerId],
  );
  const arms = await query(
    `select angle_key, successes, failures, updated_at
       from marketing_arms
      where center_id = $1
      order by (successes + failures) desc
      limit 8`,
    [centerId],
  );
  const rows = patterns.rows.map((row) => ({
    contextKey: row.context_key,
    kind: row.kind,
    channel: row.channel,
    trigger: row.trigger,
    avgNetDelta: round(row.avg_net_delta),
    n: num(row.n),
    wins: num(row.wins),
    confidence: row.confidence || '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString().slice(0, 10) : '',
  }));
  const armRows = arms.rows.map((row) => ({
    angleKey: row.angle_key,
    successes: num(row.successes),
    failures: num(row.failures),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString().slice(0, 10) : '',
  }));
  return {
    patterns: rows,
    arms: armRows,
    empty: rows.length === 0 && armRows.length === 0,
  };
}

// ── QUI ECRIT LE MIEUX, MESURE SUR LES VISITES REELLES ──────────────────────
//
// Le reste de cette page lit ce que l'agent pense de lui-meme : sa grille, ses
// notes, son ADN. Utile, mais circulaire : un score qui monte sur une grille
// figee prouve seulement que l'agent apprend a passer son propre examen.
//
// Ici, un seul signal, et il ne vient pas de l'agent : chaque proposition
// publiee porte son AUTEUR (le modele ou le gabarit deterministe), et
// measureAppliedInsights lui attache 14 jours plus tard l'ecart de
// frequentation REEL, controle du jour de semaine, des conges et de la meteo
// (effet net). Croiser les deux repond a la seule question qui vaut de
// l'argent : est-ce que ce que le modele ecrit fait venir plus de monde que ce
// que le gabarit ecrit ?
//
// PUR, donc testable sans base. La regle de prudence est dans le code, pas dans
// une note : tant que les DEUX auteurs n'ont pas assez de mesures pour sortir
// de « exploratoire », aucun verdict n'est rendu, et on dit ce qui manque.
const AUTHOR_LABELS = { ai: 'le modele', rules: 'le gabarit', inconnu: 'auteur non enregistre' };
const MIN_MEASURES_FOR_VERDICT = 3;

function aggregateAuthorship(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const auteur = ['ai', 'rules'].includes(String(row.auteur || '')) ? String(row.auteur) : 'inconnu';
    if (!groups.has(auteur)) groups.set(auteur, { auteur, nets: [], wins: 0 });
    const group = groups.get(auteur);
    const result = row.result || {};
    if (result.netDeltaPct !== null && result.netDeltaPct !== undefined) group.nets.push(Number(result.netDeltaPct));
    if (row.status === 'validated') group.wins += 1;
  }
  const auteurs = [...groups.values()].map((group) => ({
    auteur: group.auteur,
    label: AUTHOR_LABELS[group.auteur],
    n: group.nets.length,
    avgNetDelta: group.nets.length ? round(group.nets.reduce((sum, value) => sum + value, 0) / group.nets.length) : null,
    wins: group.wins,
    confiance: patternConfidence(group.nets.length),
  })).sort((a, b) => (b.avgNetDelta ?? -999) - (a.avgNetDelta ?? -999));

  const ai = auteurs.find((item) => item.auteur === 'ai') || null;
  const rules = auteurs.find((item) => item.auteur === 'rules') || null;
  const mesuresTotales = auteurs.reduce((sum, item) => sum + item.n, 0);

  // Le verdict ne sort QUE si les deux cotes sont comparables. Un « le modele
  // gagne » tire de deux publications serait une conclusion fabriquee, et c'est
  // exactement ce que ce produit s'interdit.
  let verdict = null;
  let pourquoiPasDeVerdict = '';
  if (!ai || !rules) {
    const manquant = !ai ? 'le modele' : 'le gabarit';
    pourquoiPasDeVerdict = `Aucune publication mesuree ecrite par ${manquant} : il n'y a rien a comparer.`;
  } else if (ai.n < MIN_MEASURES_FOR_VERDICT || rules.n < MIN_MEASURES_FOR_VERDICT) {
    pourquoiPasDeVerdict = `Il faut au moins ${MIN_MEASURES_FOR_VERDICT} publications mesurees de chaque cote pour comparer : ${ai.n} pour le modele, ${rules.n} pour le gabarit.`;
  } else if (ai.avgNetDelta === null || rules.avgNetDelta === null) {
    pourquoiPasDeVerdict = 'Les mesures existent mais aucune ne porte d\'effet net exploitable.';
  } else {
    const ecart = round(ai.avgNetDelta - rules.avgNetDelta);
    verdict = {
      gagnant: ecart === 0 ? 'egalite' : (ecart > 0 ? 'ai' : 'rules'),
      ecartPoints: Math.abs(ecart),
      confiance: patternConfidence(Math.min(ai.n, rules.n)),
    };
  }

  return { auteurs, mesuresTotales, verdict, pourquoiPasDeVerdict, minMesures: MIN_MEASURES_FOR_VERDICT };
}

async function readAuthorship(centerId) {
  const { rows } = await query(
    `select payload->>'auteur' as auteur, result, status
       from marketing_insights
      where center_id = $1 and measured_at is not null and result is not null`,
    [centerId],
  );
  return aggregateAuthorship(rows);
}

async function readObservations(centerId, days) {
  const { rows } = await query(
    `select platform, signal_type, count(*)::int as n, max(observed_at) as last_at
       from marketing_social_observations
      where center_id = $1
        and observed_at >= now() - ($2 || ' days')::interval
      group by platform, signal_type
      order by n desc`,
    [centerId, String(days)],
  );
  return {
    total: rows.reduce((sum, row) => sum + num(row.n), 0),
    rows: rows.map((row) => ({
      platform: row.platform,
      signalType: row.signal_type,
      n: num(row.n),
      lastAt: row.last_at ? new Date(row.last_at).toISOString().slice(0, 10) : '',
    })),
  };
}

async function buildMarketingLearning(centerId, options = {}) {
  const days = Math.min(365, Math.max(7, Number(options.days) || 90));
  const [grid, quality, dna, proposals, measurement, observations, authorship] = await Promise.all([
    readGrid(centerId),
    readQuality(centerId, days),
    readDna(),
    readProposals(centerId),
    readMeasurement(centerId),
    readObservations(centerId, days),
    readAuthorship(centerId),
  ]);
  return {
    ok: true,
    centerId,
    days,
    generatedAt: new Date().toISOString(),
    grid,
    quality,
    dna,
    proposals,
    measurement,
    observations,
    authorship,
  };
}

module.exports = { buildMarketingLearning, readEvidence, isLearned, aggregateAuthorship };

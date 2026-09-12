// Retour marketing en euros : LE chiffre qui justifie Pinlane (stratégie
// 2026-07-15 : « la preuve, pas la promesse »).
//
// Méthodologie, assumée et affichée à l'UI :
// - Sources = messages sortants MARKETING uniquement (relances 1-clic,
//   anniversaire J-30, réactivation, séquences personnalisées, campagnes,
//   messages directs du composer). Les transactionnels (confirmation, rappel,
//   merci) sont EXCLUS : attribuer une visite déjà réservée serait mentir.
// - Attribution LAST-TOUCH : une réservation est créditée au DERNIER message
//   marketing reçu avant elle (même email ou même clé client téléphone),
//   dans une fenêtre de 60 jours. Une réservation ne compte qu'UNE fois.
// - Seuls les messages réellement partis comptent (sent/delivered).
// - Seules les réservations RÉELLEMENT HONORÉES comptent en euros. Trois
//   filtres cumulés, parce que « réservé » n'est pas « venu » :
//     1. status in ('arrived', 'paid') : les deux seuls statuts qui prouvent
//        une venue. Le schéma n'a PAS de statut 'no_show' (database/schema.sql
//        ligne 14 : pending/arrived/paid/cancelled), donc un client qui ne
//        vient jamais reste 'pending' à vie : le compter serait facturer du
//        vent. 'cancelled' est exclu par construction.
//     2. validation_status = 'confirmed' : une demande encore en 'staff_review'
//        (ou draft/requested/rejected) n'est pas une vente, c'est un dossier.
//     3. date < current_date : une réservation FUTURE n'a rien rapporté
//        encore. Elle est attendue, pas acquise, et n'entre jamais dans ce
//        chiffre.
//   Conséquence assumée : ce chiffre est plus BAS que le nombre de
//   réservations liées. C'est le prix de l'honnêteté, et il dépend de la
//   discipline du staff à marquer les arrivées (voir risque en revue).
// Généralise la mécanique éprouvée de getRelanceStats (relances → venues → €).

const MARKETING_SOURCES = [
  { key: 'relance', label: 'Relances 1-clic', match: "template_id like 'relance_%'" },
  { key: 'birthday_j30', label: 'Anniversaires J-30', match: "template_id = 'birthday_j30'" },
  { key: 'reactivation', label: 'Réactivation dormants', match: "template_id = 'reactivation'" },
  { key: 'custom', label: 'Séquences personnalisées', match: "template_id like 'custom_%'" },
  { key: 'campaign', label: 'Campagnes', match: "template_id like 'campaign_%'" },
  { key: 'direct', label: 'Messages directs', match: "template_id like 'studio_%'" },
];

function defaultDeps() {
  const { getPool } = require('./database');
  return { query: (text, params) => getPool().query(text, params) };
}

// Attribution = analytique : une persona de simulation ne doit jamais creer
// d'euro attribue. Cf lib/simulation-filter.js.
const { simulationSqlExclusion } = require('./simulation-filter');

const SOURCE_CASE = MARKETING_SOURCES
  .map((source) => `when ${source.match} then '${source.key}'`)
  .join('\n           ');
const SOURCE_FILTER = MARKETING_SOURCES.map((source) => `(${source.match})`).join(' or ');

// → { days, sent, conversions, revenue, reviewClicks, bySource: [{key, label,
//    sent, conversions, revenue}], available, unavailableReason,
//    excludedMissingSentAt }. Une erreur rend les chiffres null, pas zero.
async function computeMarketingRoi(centerId = 'libramont', { days = 30 } = {}, deps = defaultDeps()) {
  const window = Math.max(7, Math.min(365, Number(days) || 30));
  const unavailable = {
    days: window,
    available: false,
    unavailableReason: 'query_failed',
    excludedMissingSentAt: null,
    sent: null,
    conversions: null,
    revenue: null,
    reviewClicks: null,
    bySource: MARKETING_SOURCES.map(({ key, label }) => ({ key, label, sent: null, conversions: null, revenue: null })),
  };
  try {
    const result = await deps.query(
      `with marketing_candidates as (
         select id, sent_at, recipient,
           payload->>'clientKey' as client_key,
           case
           ${SOURCE_CASE}
           end as source
         from communications
         where center_id = $1
           and coalesce(direction, 'outbound') = 'outbound'
           and status in ('sent', 'delivered')
           and (${SOURCE_FILTER})
       ),
       marketing_msgs as (
         select * from marketing_candidates
         where sent_at is not null
           and sent_at > now() - ($2 || ' days')::interval
           and sent_at <= now()
       ),
       attributed as (
         select distinct on (res.id)
           res.id as reservation_id,
           coalesce(res.price, 0) as price,
           m.source
         from marketing_msgs m
         join reservations res
           on res.center_id = $1
          and ${simulationSqlExclusion('res')}
          and res.status in ('arrived', 'paid')
          and res.validation_status = 'confirmed'
          and res.date < current_date
          and res.created_at > m.sent_at
          and res.created_at <= m.sent_at + interval '60 days'
          and (
            lower(coalesce(res.email, '')) = lower(m.recipient)
            or (coalesce(m.client_key, '') != ''
                and regexp_replace(coalesce(res.phone, ''), '[^0-9+]', '', 'g') = m.client_key)
          )
         order by res.id, m.sent_at desc, m.id desc
       ),
       sent_by_source as (
         select source, count(*)::int as sent from marketing_msgs group by source
       ),
       conv_by_source as (
         select source, count(*)::int as conversions, sum(price) as revenue
         from attributed group by source
       ),
       per_source as (
         select s.source, s.sent,
           coalesce(c.conversions, 0)::int as conversions,
           coalesce(c.revenue, 0)::numeric as revenue
         from sent_by_source s
         left join conv_by_source c on c.source = s.source
       )
       select
         (select count(*)::int from marketing_candidates where sent_at is null) as excluded_missing_sent_at,
         (select coalesce(json_agg(per_source), '[]'::json) from per_source) as by_source,
         (select count(*)::int from communications
          where center_id = $1 and template_id = 'post_visit_followup'
            and payload->>'reviewClickAt' is not null
            and created_at > now() - ($2 || ' days')::interval) as review_clicks;`,
      [centerId, String(window)],
    );
    const row = result.rows[0] || {};
    const rawSources = Array.isArray(row.by_source)
      ? row.by_source
      : (typeof row.by_source === 'string' ? JSON.parse(row.by_source || '[]') : []);
    const bySourceMap = new Map(rawSources.map((item) => [item.source, item]));
    const bySource = MARKETING_SOURCES.map(({ key, label }) => {
      const item = bySourceMap.get(key) || {};
      return {
        key,
        label,
        sent: Number(item.sent) || 0,
        conversions: Number(item.conversions) || 0,
        revenue: Math.round(Number(item.revenue) || 0),
      };
    });
    return {
      days: window,
      available: true,
      unavailableReason: null,
      // Historique du centre, toutes dates : sans sent_at, aucune periode
      // d'envoi ni attribution ne peut etre defendue. Aucun repli created_at.
      excludedMissingSentAt: Number(row.excluded_missing_sent_at) || 0,
      sent: bySource.reduce((sum, source) => sum + source.sent, 0),
      conversions: bySource.reduce((sum, source) => sum + source.conversions, 0),
      revenue: bySource.reduce((sum, source) => sum + source.revenue, 0),
      reviewClicks: Number(row.review_clicks) || 0,
      bySource,
    };
  } catch (error) {
    return unavailable;
  }
}

// Marque le clic sur un lien tracké (bouton avis Google du mail post-visite)
// et rend l'URL de destination. Token 128 bits généré à l'envoi : pas
// d'énumération possible, et la destination vient du payload stocké, jamais
// de la requête (zéro open redirect).
async function resolveReviewClick(token = '', deps = defaultDeps()) {
  const clean = String(token || '').trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(clean)) return null;
  const result = await deps.query(
    `select id, payload from communications
     where template_id = 'post_visit_followup'
       and payload->>'reviewToken' = $1
     limit 1;`,
    [clean],
  );
  const row = result.rows[0];
  const reviewUrl = row?.payload?.reviewUrl;
  if (!row || !reviewUrl) return null;
  if (!row.payload.reviewClickAt) {
    await deps.query(
      `update communications
       set payload = payload || jsonb_build_object('reviewClickAt', $2::text)
       where id = $1;`,
      [row.id, new Date().toISOString()],
    ).catch(() => null);
  }
  return { url: reviewUrl };
}

// U8 : revenu marketing attribué (€) indexé PAR CLÉ DE SOURCE, pour être
// raccordé aux marketing_patterns (leur trigger == la clé de source :
// relance / birthday_j30 / reactivation / custom / campaign / direct). Réutilise
// la mécanique last-touch de computeMarketingRoi (pur SQL, aucun appel LLM →
// coût IA nul, compatible cron). Fenêtre large (365 j) par défaut pour recouvrir
// l'historique des patterns. → { [sourceKey]: { revenue, conversions, sent } }.
async function attributedRevenueByTrigger(centerId = 'libramont', { days = 365 } = {}, deps = defaultDeps()) {
  const roi = await computeMarketingRoi(centerId, { days }, deps);
  if (!roi.available) {
    // Le consommateur intercepte deja les erreurs et conserve l'absence de
    // source (revenu null), au lieu d'apprendre d'un faux zero commercial.
    const error = new Error('Mesure du retour marketing indisponible.');
    error.code = 'MARKETING_ROI_UNAVAILABLE';
    throw error;
  }
  const byTrigger = {};
  for (const source of roi.bySource) {
    byTrigger[source.key] = { revenue: source.revenue, conversions: source.conversions, sent: source.sent };
  }
  return byTrigger;
}

module.exports = { computeMarketingRoi, resolveReviewClick, attributedRevenueByTrigger, MARKETING_SOURCES };

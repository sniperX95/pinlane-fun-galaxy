// Capacites de DECISION de la page Direction du CLIENT (distinctes de la config
// Etablissement), 2026-07-21 :
//  - buildDirectionComparison : comparer LES CENTRES DU CLIENT cote a cote sur
//    la periode (CA, resas, joueurs, occupation, ticket moyen). Isolation par
//    client (centers.client_id) : un directeur ne voit JAMAIS les centres d'un
//    autre client.
//  - buildDirectionRetention : nouveaux vs recurrents sur la periode, panier
//    moyen par segment, et clients DORMANTS (habitues qui ne sont pas revenus
//    depuis un seuil) a relancer.
//
// Zero chiffre hors des agregats : on reutilise buildDirectionAnalytics
// (lib/direction-analytics) et l'historique reel (readAdminRangeState).

const { readAdminRangeState } = require('./database');
const { buildDirectionAnalytics } = require('./direction-analytics');
const { getCenter } = require('./ops-knowledge');

const HISTORY_START = '2023-01-01';
const ACTIVE_STATUSES = new Set(['confirmed', 'arrived', 'paid', 'pending']);

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function clientKey(r) {
  const phone = String(r.phone || '').replace(/\s+/g, '').trim();
  const email = String(r.email || '').toLowerCase().trim();
  const name = String(r.name || '').toLowerCase().trim();
  return phone || email || name || '';
}

// --- Comparaison des centres DU CLIENT --------------------------------------
async function buildDirectionComparison(pool, sessionCenterId, startDate, endDate) {
  const centerId = String(sessionCenterId || 'libramont');
  // Isolation locataire : on part du client du centre de session, puis on ne
  // prend QUE les centres de ce client. Sans client rattache, on se limite au
  // centre courant (aucune fuite cross-client possible).
  let centers = [];
  try {
    const link = await pool.query('select client_id from centers where id = $1 limit 1;', [centerId]);
    const clientId = link.rowCount ? link.rows[0].client_id : null;
    if (clientId) {
      const sib = await pool.query('select id, name from centers where client_id = $1 order by id asc;', [clientId]);
      centers = sib.rows;
    }
  } catch (error) {
    centers = [];
  }
  if (!centers.length) {
    const one = await pool.query('select id, name from centers where id = $1;', [centerId]);
    centers = one.rows;
  }

  const rows = [];
  for (const c of centers) {
    try {
      const history = (await readAdminRangeState(HISTORY_START, endDate, c.id)).reservations;
      const a = buildDirectionAnalytics({ history, startDate, endDate, center: getCenter(c.id) });
      rows.push({
        id: c.id,
        name: c.name,
        reservations: a.totals.reservations,
        revenue: a.totals.revenue,
        pax: a.totals.pax,
        avgBasket: a.totals.avgBasket,
        occupancy: a.occupancy && a.occupancy.rate != null ? a.occupancy.rate : null,
        clientsUnique: a.clients.unique,
        isCurrent: c.id === centerId,
      });
    } catch (error) {
      rows.push({ id: c.id, name: c.name, error: 'Indisponible pour ce centre.' });
    }
  }
  return { ok: true, generatedAt: new Date().toISOString(), testData: true, startDate, endDate, selfCenterId: centerId, centers: rows };
}

// --- Retention et clients dormants ------------------------------------------
async function buildDirectionRetention(centerId, startDate, endDate, { lapsedSinceDays = 60 } = {}) {
  const id = String(centerId || 'libramont');
  const history = (await readAdminRangeState(HISTORY_START, endDate, id)).reservations;

  // Segment de la PERIODE : nouveaux vs recurrents + panier moyen par segment.
  const a = buildDirectionAnalytics({ history, startDate, endDate, center: getCenter(id) });

  // Panier moyen par segment sur la periode : on rejoue les resas actives de la
  // fenetre et on classe par premiere visite avant/pendant la fenetre.
  const firstVisit = new Map();
  for (const r of history) {
    if (!ACTIVE_STATUSES.has(r.status)) continue;
    const key = clientKey(r);
    if (!key) continue;
    if (!firstVisit.has(key) || r.date < firstVisit.get(key)) firstVisit.set(key, r.date);
  }
  let newRev = 0; let newN = 0; let retRev = 0; let retN = 0;
  const lastByClient = new Map();
  for (const r of history) {
    if (!ACTIVE_STATUSES.has(r.status)) continue;
    const key = clientKey(r);
    if (!key) continue;
    // dernier passage + libelle, pour les dormants
    const prev = lastByClient.get(key) || { name: r.name, phone: r.phone, email: r.email, visits: 0, lastVisit: '', revenue: 0 };
    prev.visits += 1;
    prev.revenue += Number(r.price) || 0;
    if (r.date > prev.lastVisit) { prev.lastVisit = r.date; prev.name = r.name; prev.phone = r.phone; prev.email = r.email; }
    lastByClient.set(key, prev);
    // panier segment sur la fenetre
    if (r.date >= startDate && r.date <= endDate) {
      const isNew = (firstVisit.get(key) || r.date) >= startDate;
      if (isNew) { newRev += Number(r.price) || 0; newN += 1; } else { retRev += Number(r.price) || 0; retN += 1; }
    }
  }

  // Dormants : au moins 2 visites a vie, dernier passage avant le seuil.
  const cutoff = addDays(endDate, -lapsedSinceDays);
  const lapsed = [...lastByClient.values()]
    .filter((c) => c.visits >= 2 && c.lastVisit && c.lastVisit < cutoff)
    .sort((x, y) => (y.visits - x.visits) || (x.lastVisit < y.lastVisit ? 1 : -1))
    .slice(0, 20)
    .map((c) => ({ name: c.name || 'Client', phone: c.phone || '', email: c.email || '', visits: c.visits, revenue: round2(c.revenue), lastVisit: c.lastVisit }));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    centerId: id,
    startDate,
    endDate,
    lapsedSinceDays,
    segment: {
      unique: a.clients.unique,
      new: a.clients.new,
      returning: a.clients.returning,
      returningRate: a.clients.returningRate,
      multi: a.clients.multi,
      avgBasketNew: newN ? round2(newRev / newN) : 0,
      avgBasketReturning: retN ? round2(retRev / retN) : 0,
    },
    lapsed,
    topClients: a.clients.top,
  };
}

// --- Provenance et public (ce qu'on peut VRAIMENT calculer) -----------------
// Pourquoi les gens viennent (occasion declaree) et par quel canal / source ils
// reservent. La demographie (age, sexe, zone) n'est PAS inventee ici : elle
// viendra de Google Analytics ; le front affiche une carte "a connecter".
const OCCASION_LABELS = {
  anniversaire: 'Anniversaire',
  entreprise: 'Entreprise / team building',
  groupe: 'Sortie groupe',
  amis: 'Sortie entre amis',
  famille: 'Sortie famille',
  ecole: 'Ecole / jeunesse',
  evg: 'EVG / EVJF',
  autre: 'Autre',
};
const CHANNEL_LABELS = { public: 'En ligne (site)', staff: 'Staff (sur place / tel)', online: 'En ligne (site)' };

function sourceLabel(r) {
  // La provenance stockee (migration 0055, lib/acquisition.js) fait foi.
  if (r.acquisition && r.acquisition.source) return r.acquisition.source;
  const utm = String(r.utm_source || r.utmSource || '').trim().toLowerCase();
  if (utm) return utm;
  const ref = String(r.referrer || '').trim();
  if (ref) {
    try { return new URL(ref).hostname.replace(/^www\./, ''); } catch (error) { return ref.slice(0, 40); }
  }
  return '';
}

async function buildDirectionAudience(centerId, startDate, endDate) {
  const id = String(centerId || 'libramont');
  const history = (await readAdminRangeState(HISTORY_START, endDate, id)).reservations;
  const inWindow = history.filter((r) => ACTIVE_STATUSES.has(r.status) && r.date >= startDate && r.date <= endDate);

  const occ = new Map();
  const chan = new Map();
  const src = new Map();
  let totalRes = 0;
  let anyDeclaredOccasion = false;
  let anySource = false;
  for (const r of inWindow) {
    totalRes += 1;
    const price = Number(r.price) || 0;
    const pax = Number(r.pax) || 0;
    // Occasion (pourquoi ils viennent)
    const oKey = String(r.occasion || '').trim().toLowerCase() || 'non-precise';
    if (oKey !== 'non-precise') anyDeclaredOccasion = true;
    const o = occ.get(oKey) || { key: oKey, count: 0, revenue: 0, pax: 0 };
    o.count += 1; o.revenue += price; o.pax += pax; occ.set(oKey, o);
    // Canal (en ligne vs staff)
    const cKey = String(r.channel || 'public').trim().toLowerCase();
    const c = chan.get(cKey) || { key: cKey, count: 0, revenue: 0 };
    c.count += 1; c.revenue += price; chan.set(cKey, c);
    // Source marketing (utm / referrer) : vide tant que la capture n'est pas posee
    const sKey = sourceLabel(r);
    if (sKey) {
      anySource = true;
      const s = src.get(sKey) || { key: sKey, count: 0, revenue: 0 };
      s.count += 1; s.revenue += price; src.set(sKey, s);
    }
  }

  const shape = (m, labels) => [...m.values()]
    .map((x) => ({
      key: x.key,
      label: (labels && labels[x.key]) || (x.key === 'non-precise' ? 'Non precise' : x.key),
      count: x.count,
      revenue: round2(x.revenue),
      pax: x.pax || 0,
      share: totalRes ? Math.round((x.count / totalRes) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    centerId: id,
    startDate,
    endDate,
    totalReservations: totalRes,
    occasions: shape(occ, OCCASION_LABELS),
    channels: shape(chan, CHANNEL_LABELS),
    sources: shape(src, null),
    // Signaux d'honnetete pour le front : ne rien affirmer qu'on ne mesure pas.
    hasDeclaredOccasion: anyDeclaredOccasion,
    hasSource: anySource,
    // La demographie (age, sexe, zone) n'est PAS collectee par Pinlane : elle
    // viendra de Google Analytics. Le front affiche une carte "a connecter".
    demographicsSource: 'google-analytics',
    demographicsConnected: false,
  };
}

module.exports = { buildDirectionComparison, buildDirectionRetention, buildDirectionAudience };

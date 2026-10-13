// Analytics direction : agrégations pures sur les réservations + générateur
// de bilan périodique. Source de vérité UNIQUE (le front ne recalcule rien,
// pattern C7 de l'audit). Déterministe d'abord ; enrichissement IA optionnel
// quand une clé est présente : Claude (ANTHROPIC_API_KEY) prioritaire, OpenAI
// sinon (même philosophie que marketing-agents).

const { callLlm } = require('./llm-client');
const { excludeSimulationRows } = require('./simulation-filter');
const { reservationActivityBucket } = require('./reservation-activities');
const { estNomAnonyme } = require('./donnees-clients');

const ACTIVE_STATUSES = new Set(['pending', 'arrived', 'paid']);

// Nom d'une formule : le CATALOGUE fait autorite, jamais la colonne 'label' de
// la reservation. Ce champ est du texte libre fige a la creation : il vieillit
// (formule renommee) et vaut son defaut quand celui qui a cree la ligne ne l a
// pas renseigne. Constate le 2026-07-28 : "Top formules" listait dix lignes
// "Bowling Classique" pour dix formules differentes, alors que formule_id etait
// juste. Regle du vault : un fait a UNE source d autorite.
function formuleName(formuleId, fallbackLabel) {
  const id = String(formuleId || '').trim();
  if (id) {
    // Catalogue chaud (base + socle fichier) d'abord, puis le socle seul. NB :
    // booking-config.catalogBookingFormule n'est PAS exporte - passer par lui
    // rendait un simple undefined et le nom retombait sur l'identifiant brut.
    // resolveBookingFormuleAnyScope et non getBookingFormule(id) : depuis la
    // migration 0042 le catalogue est scope par entreprise, et cette fonction
    // n a pas de centre sous la main. Elle RESOUT un id que la reservation
    // porte deja (jamais une liste), donc traverser les portees est sans risque
    // et evite d afficher l identifiant brut a la place du nom de la formule
    // custom d un client.
    try {
      const found = require('./catalog-store').resolveBookingFormuleAnyScope(id);
      if (found && found.name) return String(found.name);
    } catch (error) { /* store indisponible */ }
    try {
      const base = require('./booking-config').FORMULES.find((item) => item.id === id);
      if (base && base.name) return String(base.name);
    } catch (error) { /* socle indisponible */ }
  }
  return String(fallbackLabel || id || 'Formule');
}

function toDateStr(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

// Lundi = 0 … Dimanche = 6 (lecture business européenne).
function weekdayIndex(dateStr) {
  const js = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return (js + 6) % 7;
}

function isoWeekLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

function mondayOf(dateStr) {
  return addDays(dateStr, -weekdayIndex(dateStr));
}

// Identité client : téléphone normalisé sinon email sinon nom. Un dossier
// anonyme du comptoir (rien que le nom « Client », lib/donnees-clients) n'a
// pas d'identité : vide, et chaque appelant le saute.
function clientKey(reservation) {
  const phone = String(reservation.phone || '').replace(/\D/g, '');
  if (phone.length >= 6) return `p:${phone.slice(-9)}`;
  const email = String(reservation.email || '').trim().toLowerCase();
  if (email.includes('@')) return `e:${email}`;
  const name = String(reservation.name || '').trim().toLowerCase();
  return name && !estNomAnonyme(name) ? `n:${name}` : '';
}

function hourOf(startTime) {
  const h = Number(String(startTime || '').slice(0, 2));
  return Number.isFinite(h) ? h : null;
}

function openHoursFor(center, dateStr) {
  const slot = center?.defaultSchedule?.regular?.[String(new Date(`${dateStr}T00:00:00Z`).getUTCDay())];
  if (!slot || !slot.open || !slot.close) return 0;
  const [oh, om] = slot.open.split(':').map(Number);
  const [ch, cm] = slot.close.split(':').map(Number);
  return Math.max(0, (ch + cm / 60) - (oh + om / 60));
}

function laneCountFor(center) {
  const r = center?.resources || {};
  return Number(r.bowlingLanes || r.lanes || r.laneCount || 8) || 8;
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

function pctDelta(current, previous) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Agrégats complets d'une fenêtre [startDate, endDate].
 * `history` = TOUTES les réservations du centre (sert à qualifier
 * nouveau/récurrent au-delà de la fenêtre) ; `rows` = celles de la fenêtre.
 */
const PAYMENT_BUCKETS = [
  { key: 'carte', label: 'Carte' },
  { key: 'especes', label: 'Espèces' },
  { key: 'non_precise', label: 'Non précisé' },
];
function paymentBucket(method) {
  const v = String(method || '').trim().toLowerCase();
  if (/^carte|^card/.test(v)) return 'carte';
  if (/^esp[eè]ces$|^cash$/.test(v)) return 'especes';
  return 'non_precise';
}

function encaisseReel(r) {
  return r.amountPaid != null && Number.isFinite(Number(r.amountPaid)) ? Number(r.amountPaid) : (Number(r.price) || 0);
}

function buildDirectionAnalytics({ history, startDate, endDate, center }) {
  const start = toDateStr(startDate);
  const end = toDateStr(endDate);
  // Exclusion simulation en TETE : `rows` derive de `history`, donc filtrer
  // history une fois couvre les deux. Filtrer seulement rows laisserait la
  // carte nouveau/recurrent (firstVisit, calculee sur history) polluee par les
  // personas de simulation. Defense en profondeur : readAdminRangeState filtre
  // deja en SQL, mais buildDirectionAnalytics est appelable avec n'importe
  // quelle source d'historique.
  const cleanHistory = excludeSimulationRows(history);
  const rows = cleanHistory.filter((r) => r.date >= start && r.date <= end);
  // Un groupe pointe absent (0056) n est pas venu : ni visite, ni chiffre.
  const active = rows.filter((r) => ACTIVE_STATUSES.has(r.status) && !r.absentAt);
  const cancelled = rows.filter((r) => r.status === 'cancelled');

  // Première visite historique par client (toutes dates, statuts actifs).
  const firstVisit = new Map();
  for (const r of cleanHistory) {
    if (!ACTIVE_STATUSES.has(r.status)) continue;
    const key = clientKey(r);
    if (!key) continue;
    if (!firstVisit.has(key) || r.date < firstVisit.get(key)) firstVisit.set(key, r.date);
  }

  // Séries quotidiennes (tous les jours de la fenêtre, y compris à zéro).
  const dayMap = new Map();
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dayMap.set(d, { date: d, count: 0, revenue: 0, pax: 0, cancelled: 0 });
  }
  const typeAgg = {};
  // Repartition par ACTIVITE REELLE (2026-08-18) : la meme grammaire que le
  // mix du dashboard staff (lib/reservation-activities). byType reste servi
  // pour compatibilite, mais les surfaces « par activite » lisent byActivity.
  const activityAgg = new Map();
  const formuleAgg = new Map();
  const occasionAgg = new Map();
  const channelAgg = new Map();
  // L ENCAISSE PAR MOYEN (2026-10-01) : la console demande Carte ou Espèces au
  // clic « Payé ». Ce qui a ete paye avant, ou par un autre chemin
  // (« Comptoir », vide), reste « Non précisé » : on ne devine pas un moyen.
  const paymentAgg = new Map(PAYMENT_BUCKETS.map((b) => [b.key, { key: b.key, label: b.label, count: 0, amount: 0 }]));
  const heatmap = Array.from({ length: 7 }, () => ({}));
  const clients = new Map();
  let bookedLaneHours = 0;

  for (const r of active) {
    const day = dayMap.get(r.date);
    if (day) { day.count += 1; day.revenue += r.price; day.pax += r.pax; }

    const t = r.type || 'bowling';
    typeAgg[t] = typeAgg[t] || { count: 0, revenue: 0, pax: 0 };
    typeAgg[t].count += 1; typeAgg[t].revenue += r.price; typeAgg[t].pax += r.pax;

    const bucket = reservationActivityBucket(r);
    const activityRow = activityAgg.get(bucket.key) || { label: bucket.label, count: 0, revenue: 0, pax: 0 };
    // Une activité seule compte ses participants ; les paniers multi et les
    // formules gardent les visiteurs (on ne connaît pas les identités communes).
    const items = r.program && Array.isArray(r.program.items) ? r.program.items : [];
    const participantCount = items.length === 1 && bucket.key !== 'formule'
      ? Number(items[0].participants) : NaN;
    const activityPax = Number.isInteger(participantCount) && participantCount >= 1 && participantCount <= r.pax
      ? participantCount : r.pax;
    activityRow.count += 1; activityRow.revenue += r.price; activityRow.pax += activityPax;
    activityAgg.set(bucket.key, activityRow);

    if (t === 'formule') {
      const fk = r.formuleId || r.label || 'formule';
      const f = formuleAgg.get(fk) || { id: fk, label: formuleName(r.formuleId, r.label), count: 0, revenue: 0, pax: 0 };
      f.count += 1; f.revenue += r.price; f.pax += r.pax;
      formuleAgg.set(fk, f);
    }
    if (r.occasion) occasionAgg.set(r.occasion, (occasionAgg.get(r.occasion) || 0) + 1);
    if (r.status === 'paid') {
      const moyen = paymentAgg.get(paymentBucket(r.paymentMethod));
      moyen.count += 1; moyen.amount += encaisseReel(r);
    }
    const ch = r.channel === 'public' ? 'en ligne' : 'staff';
    channelAgg.set(ch, (channelAgg.get(ch) || 0) + 1);

    const h = hourOf(r.startTime);
    if (h !== null) {
      const wd = weekdayIndex(r.date);
      heatmap[wd][h] = (heatmap[wd][h] || 0) + 1;
    }

    if (t === 'bowling') bookedLaneHours += (r.lanes?.length || 1) * (r.duration || 1);

    const key = clientKey(r);
    if (key) {
      const c = clients.get(key) || {
        key, name: r.name, phone: r.phone, email: r.email,
        visits: 0, revenue: 0, pax: 0, firstVisit: firstVisit.get(key) || r.date, lastVisit: r.date,
        types: {},
        // Formules prises par ce client : "activite favorite = Formules" ne
        // disait pas LAQUELLE, donc ne servait a rien pour le rappeler.
        formules: {},
      };
      c.visits += 1; c.revenue += r.price; c.pax = Math.max(c.pax, r.pax);
      if (r.date > c.lastVisit) { c.lastVisit = r.date; c.name = r.name; }
      // Le favori d'un client se compte par BUCKET d'activite reelle (golf,
      // billards, multi...), plus par colonne type ('visite' opaque).
      c.types[bucket.key] = (c.types[bucket.key] || 0) + 1;
      c.typeLabels = c.typeLabels || {};
      c.typeLabels[bucket.key] = bucket.label;
      if (t === 'formule') {
        const fname = formuleName(r.formuleId, r.label);
        c.formules[fname] = (c.formules[fname] || 0) + 1;
      }
      clients.set(key, c);
    }
  }
  for (const r of cancelled) {
    const day = dayMap.get(r.date);
    if (day) day.cancelled += 1;
  }

  // Hebdo + mensuel dérivés du quotidien.
  const weekly = new Map();
  const monthly = new Map();
  for (const d of dayMap.values()) {
    const wk = mondayOf(d.date);
    const w = weekly.get(wk) || { weekStart: wk, label: isoWeekLabel(d.date), count: 0, revenue: 0, pax: 0, cancelled: 0 };
    w.count += d.count; w.revenue += d.revenue; w.pax += d.pax; w.cancelled += d.cancelled;
    weekly.set(wk, w);
    const mk = d.date.slice(0, 7);
    const m = monthly.get(mk) || { month: mk, count: 0, revenue: 0, pax: 0, cancelled: 0 };
    m.count += d.count; m.revenue += d.revenue; m.pax += d.pax; m.cancelled += d.cancelled;
    monthly.set(mk, m);
  }

  // Occupation bowling : piste-heures réservées / capacité ouverte.
  let capacityLaneHours = 0;
  const lanes = laneCountFor(center);
  for (let d = start; d <= end; d = addDays(d, 1)) capacityLaneHours += openHoursFor(center, d) * lanes;

  const clientList = [...clients.values()];
  const returning = clientList.filter((c) => c.firstVisit < start);
  const topClients = clientList
    .sort((a, b) => b.visits - a.visits || b.revenue - a.revenue)
    .slice(0, 15)
    .map((c) => {
      const favorite = Object.entries(c.types).sort((a, b) => b[1] - a[1])[0]?.[0] || 'bowling';
      return {
        ...c,
        revenue: round2(c.revenue),
        favorite,
        // Libelle HUMAIN du favori (nom du catalogue vivant) : le client ne
        // devine plus depuis une cle technique.
        favoriteLabel: (c.typeLabels && c.typeLabels[favorite]) || '',
        // Nom PRECIS quand le favori est une formule : "FORMULE 4" dit quoi
        // reproposer a ce client, "Formules" ne dit rien.
        favoriteFormule: Object.entries(c.formules || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
      };
    });

  const paid = active.filter((r) => r.status === 'paid').length;
  const totals = {
    reservations: active.length,
    revenue: round2(active.reduce((s, r) => s + r.price, 0)),
    pax: active.reduce((s, r) => s + r.pax, 0),
    cancelled: cancelled.length,
    cancelRate: rows.length ? round1((cancelled.length / rows.length) * 100) : 0,
    avgBasket: active.length ? round2(active.reduce((s, r) => s + r.price, 0) / active.length) : 0,
    // Encaissement v1 honnête : statut binaire payé/non payé des résas actives
    // (pas de montants partiels : champ à modéliser si besoin plus fin).
    paid,
    paymentRate: active.length ? round1((paid / active.length) * 100) : 0,
    // Le MONTANT encaisse (dossiers payes), a cote du nombre.
    // Ce qui a vraiment ete encaisse (0056) : le montant note, sinon le prix.
    collected: round2(active.filter((r) => r.status === 'paid').reduce((s, r) => s + encaisseReel(r), 0)),
    days: diffDays(start, end) + 1,
  };

  return {
    startDate: start,
    endDate: end,
    totals,
    daily: [...dayMap.values()].map((d) => ({ ...d, revenue: round2(d.revenue) })),
    weekly: [...weekly.values()],
    monthly: [...monthly.values()].map((m) => ({ ...m, revenue: round2(m.revenue) })),
    byType: Object.fromEntries(Object.entries(typeAgg).map(([k, v]) => [k, { ...v, revenue: round2(v.revenue) }])),
    byActivity: Object.fromEntries([...activityAgg.entries()]
      .sort((a, b) => b[1].count - a[1].count || b[1].revenue - a[1].revenue)
      .map(([k, v]) => [k, { ...v, revenue: round2(v.revenue) }])),
    byFormule: [...formuleAgg.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue)
      .map((f) => ({ ...f, revenue: round2(f.revenue) })),
    byOccasion: [...occasionAgg.entries()].map(([occasion, count]) => ({ occasion, count })).sort((a, b) => b.count - a.count),
    byChannel: [...channelAgg.entries()].map(([channel, count]) => ({ channel, count })),
    byPaymentMethod: [...paymentAgg.values()].map((m) => ({ ...m, amount: round2(m.amount) })),
    heatmap,
    occupancy: {
      scope: 'bowling',
      bookedLaneHours: round1(bookedLaneHours),
      capacityLaneHours: round1(capacityLaneHours),
      rate: capacityLaneHours ? round1((bookedLaneHours / capacityLaneHours) * 100) : null,
    },
    clients: {
      unique: clientList.length,
      new: clientList.length - returning.length,
      returning: returning.length,
      returningRate: clientList.length ? round1((returning.length / clientList.length) * 100) : 0,
      // multi = au moins 2 visites DANS la fenêtre (fidélité visible période)
      multi: clientList.filter((c) => c.visits > 1).length,
      top: topClients,
    },
  };
}

/** Fenêtre précédente de même longueur, collée avant startDate. */
function previousWindow(startDate, endDate) {
  const len = diffDays(startDate, endDate) + 1;
  return { startDate: addDays(startDate, -len), endDate: addDays(startDate, -1) };
}

const WEEKDAYS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

function fmtEuro(n) {
  return `${Number(n).toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}

function deltaPhrase(delta, unit = '%') {
  if (delta === null) return 'sans point de comparaison';
  if (delta === 0) return 'stable';
  return delta > 0 ? `en hausse de ${delta}${unit}` : `en baisse de ${Math.abs(delta)}${unit}`;
}

/** Bilan déterministe en markdown : chaque chiffre vient des agrégats, rien d'inventé. */
function buildDirectionReportMarkdown({ current, previous, periodLabel, centerName }) {
  const t = current.totals;
  const p = previous?.totals;
  const dCount = p ? pctDelta(t.reservations, p.reservations) : null;
  const dRevenue = p ? pctDelta(t.revenue, p.revenue) : null;
  const dPax = p ? pctDelta(t.pax, p.pax) : null;

  const busiestDay = [...current.daily].sort((a, b) => b.count - a.count)[0];
  const weekdayTotals = Array.from({ length: 7 }, () => 0);
  for (const d of current.daily) weekdayTotals[weekdayIndex(d.date)] += d.count;
  const bestWeekday = weekdayTotals.indexOf(Math.max(...weekdayTotals));
  const openWeekdays = weekdayTotals.map((v, i) => ({ v, i })).filter((x) => x.v > 0);
  const worstWeekday = openWeekdays.length > 1 ? openWeekdays.sort((a, b) => a.v - b.v)[0].i : null;

  const topFormule = current.byFormule[0];
  const online = current.byChannel.find((c) => c.channel === 'en ligne')?.count || 0;
  const onlineShare = t.reservations ? Math.round((online / t.reservations) * 100) : 0;

  const lines = [];
  lines.push(`# Bilan ${periodLabel} : ${centerName}`);
  lines.push('');
  lines.push('## Synthèse');
  lines.push(`- **${t.reservations} réservations** (${deltaPhrase(dCount)}) pour **${fmtEuro(t.revenue)}** de chiffre associé (${deltaPhrase(dRevenue)}).`);
  lines.push(`- **${t.pax} joueurs** accueillis (${deltaPhrase(dPax)}), panier moyen **${fmtEuro(t.avgBasket)}**.`);
  lines.push(`- **${current.clients.unique} clients uniques** : ${current.clients.new} nouveaux, ${current.clients.returning} déjà venus avant, ${current.clients.multi} revenu${current.clients.multi > 1 ? 's' : ''} plusieurs fois sur la période.`);
  if (current.occupancy.rate !== null) lines.push(`- Occupation bowling estimée : **${current.occupancy.rate} %** des piste-heures ouvertes.`);
  lines.push('');
  lines.push('## Activité');
  // Le bilan lit la repartition par activite REELLE : l'ancien libelle rangeait
  // toute visite (golf, arcades, billards...) sous « Bowling ».
  const activitySplit = current.byActivity && Object.keys(current.byActivity).length
    ? Object.values(current.byActivity)
    : Object.entries(current.byType).map(([type, v]) => ({ ...v, label: type === 'formule' ? 'Formules' : type === 'laser' ? 'Laser Game' : 'Bowling' }));
  for (const v of activitySplit) {
    lines.push(`- ${v.label} : ${v.count} réservations, ${v.pax} joueurs, ${fmtEuro(v.revenue)}.`);
  }
  if (topFormule) lines.push(`- Formule la plus demandée : **${topFormule.label}** (${topFormule.count} réservation${topFormule.count > 1 ? 's' : ''}, ${fmtEuro(topFormule.revenue)}).`);
  lines.push(`- Réservations en ligne : ${online} (${onlineShare} % du total).`);
  if (t.cancelled) lines.push(`- Annulations : ${t.cancelled} (${t.cancelRate} % des demandes).`);
  lines.push('');
  lines.push('## Rythme');
  if (busiestDay?.count) lines.push(`- Meilleure journée : ${busiestDay.date} (${busiestDay.count} réservations, ${fmtEuro(busiestDay.revenue)}).`);
  lines.push(`- Jour le plus fort : ${WEEKDAYS_FR[bestWeekday]}.`);
  if (worstWeekday !== null && worstWeekday !== bestWeekday) lines.push(`- Jour le plus calme (hors fermeture) : ${WEEKDAYS_FR[worstWeekday]}.`);
  lines.push('');
  if (current.clients.top.length) {
    lines.push('## Clients fidèles');
    for (const c of current.clients.top.slice(0, 5)) {
      lines.push(`- ${c.name} : ${c.visits} visite${c.visits > 1 ? 's' : ''}, ${fmtEuro(c.revenue)} (dernière : ${c.lastVisit}).`);
    }
    lines.push('');
  }
  lines.push('## Recommandations');
  const recos = [];
  if (current.clients.returningRate < 25 && current.clients.unique >= 10) {
    recos.push(`Le taux de retour est de ${current.clients.returningRate} % : lancer une relance ciblée (mail post-visite, offre 2e venue) sur les ${current.clients.new} nouveaux clients.`);
  }
  if (topFormule && current.byFormule.length > 1) {
    const last = current.byFormule[current.byFormule.length - 1];
    recos.push(`Mettre en avant **${topFormule.label}** (locomotive) et revoir ${last.label} (${last.count} réservation${last.count > 1 ? 's' : ''} seulement).`);
  }
  if (worstWeekday !== null && worstWeekday !== bestWeekday) {
    recos.push(`Tester une offre ${WEEKDAYS_FR[worstWeekday]} (jour le plus calme) : happy hour, tarif groupe ou créneau école.`);
  }
  if (onlineShare < 50 && t.reservations >= 10) {
    recos.push(`${100 - onlineShare} % des réservations passent encore par le staff : pousser le lien de réservation en ligne (QR en salle, signature mail, réseaux).`);
  }
  if (t.cancelRate > 15) {
    recos.push(`Taux d'annulation élevé (${t.cancelRate} %) : ajouter un rappel J-1 automatique et analyser les motifs.`);
  }
  if (!recos.length) recos.push('Tenir le cap : les indicateurs sont sains sur la période. Continuer le suivi hebdomadaire.');
  for (const r of recos) lines.push(`- ${r}`);
  lines.push('');
  lines.push(`_Bilan généré le ${new Date().toISOString().slice(0, 10)} à partir des données réelles de réservation. Modifiable avant diffusion._`);
  return lines.join('\n');
}

// Enrichissement IA optionnel : reformule le bilan déterministe sans le droit
// d'inventer un chiffre. Échec ou absence de clé → on garde le déterministe.
// Claude (ANTHROPIC_API_KEY) prioritaire, OpenAI sinon, via lib/llm-client.
async function polishReportWithAi(markdown, { periodLabel, centerName }) {
  const result = await callLlm({
    stableSystem: [
      `Tu es l'analyste business de ${centerName}. On te donne un bilan ${periodLabel} factuel en markdown.`,
      'Réécris-le en un bilan direction fluide et professionnel, en français, même structure de sections.',
      'INTERDIT : inventer, arrondir ou modifier un chiffre. Chaque nombre du texte final doit exister dans la source.',
      'Réponds uniquement avec le markdown final.',
    ].join(' '),
    user: markdown,
    maxTokens: 2000,
    timeoutMs: 14000,
    openaiModel: process.env.OPENAI_DIRECTION_MODEL || 'gpt-4o-mini',
  });
  if (!result) return null;
  return result.text.startsWith('#') ? result.text : null;
}

function endOfMonth(dateStr) {
  const d = new Date(`${dateStr.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  buildDirectionAnalytics,
  buildDirectionReportMarkdown,
  polishReportWithAi,
  previousWindow,
  clientKey,
  ACTIVE_STATUSES,
  addDays,
  mondayOf,
  endOfMonth,
};

// Ciblage des campagnes : segments calculés sur les VRAIES réservations
// (identité client = téléphone > email > nom, même règle que les analytics).
// Un destinataire de campagne doit avoir un email — canal email d'abord.

const { clientKey, ACTIVE_STATUSES } = require('./direction-analytics');

const CAMPAIGN_SEGMENTS = [
  { id: 'all', label: 'Tous les clients avec email', description: 'Toute la base connue (emails valides, dédupliqués).' },
  { id: 'dormant', label: 'Dormants (+90 jours)', description: 'Dernière visite il y a plus de 90 jours — à réactiver.' },
  { id: 'loyal', label: 'Fidèles', description: 'Au moins 4 visites ou 500 € dépensés.' },
  { id: 'new30', label: 'Nouveaux (30 jours)', description: 'Première visite dans les 30 derniers jours.' },
  { id: 'top-spenders', label: 'Meilleurs dépensiers (top 20)', description: 'Les 20 clients au plus gros chiffre cumulé.' },
  { id: 'birthdays', label: 'Clients anniversaire', description: 'Ont déjà réservé pour un anniversaire (occasion déclarée).' },
  { id: 'companies', label: 'Entreprises', description: 'Ont déjà réservé pour un événement d’entreprise (occasion déclarée).' },
];

function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// Profils clients emailables construits depuis l'historique complet.
function buildEmailableProfiles(history) {
  const profiles = new Map();
  for (const reservation of history) {
    if (!ACTIVE_STATUSES.has(reservation.status)) continue;
    const key = clientKey(reservation);
    if (!key) continue;
    const profile = profiles.get(key) || {
      key,
      name: reservation.name || 'Client',
      email: '',
      phone: reservation.phone || '',
      visits: 0,
      revenue: 0,
      firstDate: reservation.date,
      lastDate: reservation.date,
      occasions: new Set(),
    };
    profile.visits += 1;
    profile.revenue += Number(reservation.price || 0);
    if (reservation.date < profile.firstDate) profile.firstDate = reservation.date;
    if (reservation.date >= profile.lastDate) {
      profile.lastDate = reservation.date;
      profile.name = reservation.name || profile.name;
    }
    const email = String(reservation.email || '').trim().toLowerCase();
    if (email.includes('@')) profile.email = profile.email || email;
    if (reservation.occasion) profile.occasions.add(String(reservation.occasion).toLowerCase());
    profiles.set(key, profile);
  }
  // Email obligatoire + déduplication par email (deux clés ≠ même boîte = 1 envoi).
  const byEmail = new Map();
  for (const profile of profiles.values()) {
    if (!profile.email) continue;
    const existing = byEmail.get(profile.email);
    if (!existing || profile.lastDate > existing.lastDate) byEmail.set(profile.email, profile);
  }
  return [...byEmail.values()];
}

function buildCampaignAudience({ history, segment, today }) {
  const profiles = buildEmailableProfiles(history);
  const day = today || new Date().toISOString().slice(0, 10);
  let selected;
  switch (segment) {
    case 'dormant':
      selected = profiles.filter((p) => p.lastDate < addDaysStr(day, -90));
      break;
    case 'loyal':
      selected = profiles.filter((p) => p.visits >= 4 || p.revenue >= 500);
      break;
    case 'new30':
      selected = profiles.filter((p) => p.firstDate >= addDaysStr(day, -30));
      break;
    case 'top-spenders':
      selected = [...profiles].sort((a, b) => b.revenue - a.revenue).slice(0, 20);
      break;
    case 'birthdays':
      selected = profiles.filter((p) => p.occasions.has('anniversaire'));
      break;
    case 'companies':
      selected = profiles.filter((p) => p.occasions.has('entreprise'));
      break;
    default:
      selected = profiles;
  }
  return selected
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'))
    .map((p) => ({
      key: p.key,
      name: p.name,
      firstName: firstNameOf(p.name),
      email: p.email,
      visits: p.visits,
      revenue: Math.round(p.revenue * 100) / 100,
      lastDate: p.lastDate,
    }));
}

// Variables autorisées dans le contenu ({{prenom}}, {{nom}}) — remplacées par
// les vraies valeurs du destinataire, jamais laissées brutes à l'envoi.
function personalizeCampaignText(text, recipient) {
  return String(text || '')
    .replace(/\{\{\s*prenom\s*\}\}/gi, recipient.firstName || 'à tous')
    .replace(/\{\{\s*nom\s*\}\}/gi, recipient.name || '');
}

module.exports = { CAMPAIGN_SEGMENTS, buildCampaignAudience, personalizeCampaignText, buildEmailableProfiles };

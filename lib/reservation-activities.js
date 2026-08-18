// COMPOSITION D'UNE RESERVATION EN ACTIVITES, cote serveur : LA meme grammaire
// que le mix du dashboard (2026-08-18). La fiche programme (program.items,
// noms du catalogue vivant) fait foi ; sans elle le type dit bowling / laser ;
// un type inconnu garde son nom au lieu de tomber dans un fourre-tout.
// Un bucket par reservation : une seule activite -> cette activite ; une
// formule -> Formules ; un panier libre de plusieurs activites ->
// Multi-activites. Les parts somment donc toujours au nombre de reservations
// et au chiffre d'affaires total : aucun pourcentage n'est un « reste ».
'use strict';

const TYPE_FALLBACK_LABELS = {
  bowling: 'Bowling',
  laser: 'Laser Game',
  laser_game: 'Laser Game',
  visite: 'Visite',
};

function reservationActivityEntries(reservation) {
  const row = reservation || {};
  const items = row.program && Array.isArray(row.program.items) ? row.program.items : [];
  if (items.length) {
    const seen = new Map();
    items.forEach((item) => {
      const id = String((item && item.activityId) || 'autre');
      if (!seen.has(id)) seen.set(id, { id, name: (item && item.name) || TYPE_FALLBACK_LABELS[id] || id });
    });
    return [...seen.values()];
  }
  const type = String(row.type || '');
  if (type === 'laser') return [{ id: 'laser_game', name: 'Laser Game' }];
  if (type === 'bowling' || type === '') return [{ id: 'bowling', name: 'Bowling' }];
  return [{ id: type, name: TYPE_FALLBACK_LABELS[type] || 'Autre activité' }];
}

function reservationActivityBucket(reservation) {
  const row = reservation || {};
  if (row.type === 'formule' || row.formuleId) return { key: 'formule', label: 'Formules' };
  const entries = reservationActivityEntries(row);
  if (entries.length > 1) return { key: 'multi', label: 'Multi-activités' };
  return { key: entries[0].id, label: entries[0].name };
}

module.exports = { reservationActivityEntries, reservationActivityBucket };

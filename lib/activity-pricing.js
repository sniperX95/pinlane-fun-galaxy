// LE TARIF D'UNE ACTIVITE PEUT DEPENDRE DU JOUR ET DE L'HEURE.
//
// POURQUOI CE MODULE
//
// Une activite du catalogue n'avait qu'UN prix (`priceValue`). N4 Bowling vend
// sa Kara Box 10,00 EUR par personne, et 7,50 EUR le mercredi apres-midi : ce
// deuxieme tarif n'etait pas exprimable, donc il vivait dans une formule, au
// mauvais endroit. Verbatim Movsar : « le karaoke doit pas etre dans les
// formules, c'est une activite », puis « etends-le ».
//
// Le bowling a recu ce mecanisme en premier (`resources.bowling.pricing`, des
// paliers par jour). Ici c'est le meme raisonnement, applique a n'importe
// quelle activite : une LISTE D'EXCEPTIONS au prix de base, bornees par des
// jours et une fenetre horaire. Le premier palier qui correspond gagne ; aucun
// palier ne correspond, le prix de base s'applique.
//
// LA REGLE DE SURETE QUI GOUVERNE TOUT
//
// Tant que le CRENEAU n'est pas choisi, le prix de base s'applique, jamais le
// palier. Le tunnel annonce donc au pire le tarif plein, et le montant ne peut
// que BAISSER une fois l'heure connue. Un client n'est jamais surpris vers le
// haut : c'est la seule direction acceptable pour un prix affiche avant d'etre
// facture.
//
// Zero dependance : fonctions pures sur des valeurs nues. C'est ce qui permet a
// lib/catalog-store (normalisation), lib/activity-catalog (resolution),
// lib/visit-program (facture) et aux gates de partager LA meme verite sans
// cycle de require. Le navigateur en porte un miroir dans
// assets/booking-core.js, et un gate prouve que les deux disent le meme prix.

const ACTIVITY_PRICING_MODES = new Set(['per_person']);
const MAX_TIERS = 8;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Minutes depuis minuit, ou null. Accepte 'HH:MM' et un nombre de minutes.
// Au-dela de 30 h la valeur est jetee : c'est une erreur de saisie, pas une
// nuit qui deborde.
function toMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.trunc(value);
    return rounded >= 0 && rounded <= 1800 ? rounded : null;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 1800 ? minutes : null;
}

// Le jour de la semaine d'une date 'YYYY-MM-DD' (0 = dimanche .. 6 = samedi),
// calcule en UTC pour ne pas dependre du fuseau de la machine.
function weekdayOf(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

function normalizeActivityPricing(input) {
  if (!isPlainObject(input)) return null;
  if (!ACTIVITY_PRICING_MODES.has(input.mode)) return null;
  const rawTiers = Array.isArray(input.tiers) ? input.tiers : [];
  const tiers = [];
  for (const tier of rawTiers) {
    if (!isPlainObject(tier)) continue;
    const price = Number(tier.price);
    if (!Number.isFinite(price) || price < 0 || price > 1000) continue;
    const days = Array.from(new Set((Array.isArray(tier.days) ? tier.days : [])
      .map((value) => Math.trunc(Number(value)))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 6)))
      .sort((a, b) => a - b);
    const fromMinutes = toMinutes(tier.fromMinutes);
    const untilMinutes = toMinutes(tier.untilMinutes);
    // Une fenetre fermee a l'envers ne s'applique jamais : plutot la refuser a
    // l'ecriture que la laisser dormir et faire mentir un prix.
    if (fromMinutes !== null && untilMinutes !== null && untilMinutes <= fromMinutes) continue;
    // Ni jour ni fenetre : le palier vaudrait tout le temps et remplacerait le
    // prix de base en silence. C'est un prix de base, pas une exception.
    if (!days.length && fromMinutes === null && untilMinutes === null) continue;
    tiers.push({
      days,
      fromMinutes,
      untilMinutes,
      price: Math.round(price * 100) / 100,
      label: String(tier.label || '').trim().slice(0, 60),
    });
    if (tiers.length >= MAX_TIERS) break;
  }
  if (!tiers.length) return null;
  return { mode: input.mode, tiers };
}

// Le palier qui s'applique, ou null. `startTime` OBLIGATOIRE pour qu'un palier
// borne par l'heure puisse gagner : sans creneau choisi, on reste au prix de
// base (voir la regle de surete en tete de fichier).
function matchingTier(pricing, { dateStr = '', startTime = '' } = {}) {
  if (!pricing || !Array.isArray(pricing.tiers) || !pricing.tiers.length) return null;
  const day = weekdayOf(dateStr);
  if (day === null) return null;
  const minutes = toMinutes(startTime);
  for (const tier of pricing.tiers) {
    if (tier.days.length && !tier.days.includes(day)) continue;
    const bounded = tier.fromMinutes !== null || tier.untilMinutes !== null;
    if (bounded) {
      if (minutes === null) continue;
      if (tier.fromMinutes !== null && minutes < tier.fromMinutes) continue;
      if (tier.untilMinutes !== null && minutes >= tier.untilMinutes) continue;
    }
    return tier;
  }
  return null;
}

// Le prix UNITAIRE a appliquer : celui du palier qui correspond, sinon le prix
// de base. Rend null quand il n'y a pas de prix de base et aucun palier : null
// n'est pas zero, il s'affiche « regle sur place ».
function resolveActivityUnitPrice(pricing, basePrice, context = {}) {
  const tier = matchingTier(pricing, context);
  if (tier) return tier.price;
  return basePrice === null || basePrice === undefined ? null : Number(basePrice);
}

module.exports = {
  ACTIVITY_PRICING_MODES,
  MAX_TIERS,
  normalizeActivityPricing,
  matchingTier,
  resolveActivityUnitPrice,
  weekdayOf,
  toMinutes,
};

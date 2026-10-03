'use strict';

const FG_CENTERS = new Set(['libramont', 'gembloux', 'ciney']);
const TIMED_DESCRIPTION = 'Une carte par personne. Jeux sans cadeaux en illimité pendant la durée choisie ; jeux permettant de gagner des cadeaux exclus.';
const CREDIT_DESCRIPTION = 'Crédits utilisables sur tous les jeux, y compris les jeux permettant de gagner des cadeaux. Le temps de jeu dépend des machines utilisées.';
function failure(message) { const error = new Error(`Arcades : ${message}`); error.statusCode = 422; error.expose = true; return error; }
function plain(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function number(value, label, { min = 0, max = 100000, integer = false } = {}) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') throw failure(`${label} invalide.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw failure(`${label} invalide.`);
  return Math.round(n * 100) / 100;
}
function boolean(value, fallback) { if (value == null) return fallback; if (typeof value !== 'boolean') throw failure('activation invalide.'); return value; }
function description(value, fallback) { if (value == null) return fallback; if (typeof value !== 'string' || value.length > 1000) throw failure('description invalide.'); return value.replace(/[<>]/g, '').trim(); }
function defaults() {
  return { enabled: true,
    timeOffers: [{ id: 'time-30', minutes: 30, price: 15, enabled: true }, { id: 'time-60', minutes: 60, price: 30, enabled: true }],
    creditOffers: [{ id: 'credit-10', price: 10, credits: 10, bonusCredits: 0, enabled: true }, { id: 'credit-25', price: 25, credits: 25, bonusCredits: 10, enabled: true }, { id: 'credit-35', price: 35, credits: 35, bonusCredits: 15, enabled: true }, { id: 'credit-50', price: 50, credits: 50, bonusCredits: 25, enabled: true }],
    creditGameCostMin: 1.2, creditGameCostMax: 2.4, timedDescription: TIMED_DESCRIPTION, creditDescription: CREDIT_DESCRIPTION };
}
function normalizeArcadeOffers(input, { centerId = '', strict = false } = {}) {
  if (input === undefined) return FG_CENTERS.has(centerId) ? defaults() : null;
  if (input === null) return null;
  try {
    if (!plain(input)) throw failure('configuration invalide.');
    const seen = new Set();
    function offers(value, mode) {
      if (!Array.isArray(value) || value.length > 20) throw failure('liste de cartes invalide.');
      return value.map((offer) => {
        if (!plain(offer) || typeof offer.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(offer.id) || seen.has(offer.id)) throw failure('identifiant de carte invalide ou dupliqué.');
        if (offer.mode != null && offer.mode !== mode) throw failure('mode de carte invalide.');
        seen.add(offer.id);
        const out = { id: offer.id, price: number(offer.price, 'prix', { max: 10000 }), enabled: boolean(offer.enabled, true) };
        if (mode === 'time') out.minutes = number(offer.minutes, 'durée', { min: 1, max: 1440, integer: true });
        else {
          out.credits = number(offer.credits, 'crédits'); out.bonusCredits = number(offer.bonusCredits ?? 0, 'crédits bonus');
          if (!(out.credits + out.bonusCredits > 0)) throw failure('la carte doit contenir des crédits.');
        }
        return out;
      });
    }
    const config = { enabled: boolean(input.enabled, true), timeOffers: offers(input.timeOffers, 'time'), creditOffers: offers(input.creditOffers, 'credit'),
      creditGameCostMin: number(input.creditGameCostMin ?? 1.2, 'coût minimal d’un jeu', { min: 0.01 }), creditGameCostMax: number(input.creditGameCostMax ?? 2.4, 'coût maximal d’un jeu', { min: 0.01 }),
      timedDescription: description(input.timedDescription, TIMED_DESCRIPTION), creditDescription: description(input.creditDescription, CREDIT_DESCRIPTION) };
    if (config.creditGameCostMax < config.creditGameCostMin) throw failure('coûts des jeux inversés.');
    return config;
  } catch (error) { if (strict) throw error; return null; }
}
function quoteArcadeOffer(config, choice, participants, estimatedMinutes = 30) {
  // Old bookings contain no purchased card contract: their on-site amount stays unknown.
  if (choice.arcadeMode == null && choice.arcadeOfferId == null && choice.cards == null) return null;
  if (!config?.enabled) throw failure('cartes indisponibles pour ce centre.');
  const mode = choice.arcadeMode;
  if (mode !== 'time' && mode !== 'credit') throw failure('choisissez une carte au temps ou à crédits.');
  const offer = (mode === 'time' ? config.timeOffers : config.creditOffers).find((item) => item.id === choice.arcadeOfferId && item.enabled);
  if (!offer) throw failure('carte indisponible.');
  const cards = mode === 'time' ? participants : number(choice.cards ?? participants, 'nombre de cartes', { min: 1, max: 1000, integer: true });
  if (mode === 'time' && choice.cards != null && number(choice.cards, 'nombre de cartes', { min: 1, max: 1000, integer: true }) !== participants) throw failure('une carte au temps est nécessaire par personne.');
  const arcadeOffer = { id: offer.id, mode, price: offer.price, description: mode === 'time' ? config.timedDescription : config.creditDescription,
    prizeGamesIncluded: mode === 'credit', unlimited: mode === 'time',
    ...(mode === 'time' ? { minutes: offer.minutes } : { credits: offer.credits, bonusCredits: offer.bonusCredits, totalCredits: Math.round((offer.credits + offer.bonusCredits) * 100) / 100, gameCostMin: config.creditGameCostMin, gameCostMax: config.creditGameCostMax }) };
  const minutes = mode === 'time' ? offer.minutes : Math.max(1, Number(estimatedMinutes) || 30);
  return { arcadeMode: mode, arcadeOfferId: offer.id, cards, arcadeOffer, durationEstimated: mode === 'credit', minutes, duration: minutes / 60,
    price: Math.round(Math.round(offer.price * 100) * cards) / 100, priceKnown: true, priceType: 'per_card', unitLabel: 'par carte' };
}
function arcadeSummary(item) {
  const offer = item?.arcadeOffer;
  if (!offer) return '';
  const cards = Number(item.cards) || Number(item.participants) || 1;
  return `${cards} carte${cards > 1 ? 's' : ''} · ${offer.mode === 'time' ? `${offer.minutes} min par personne · jeux sans cadeaux illimités` : `${offer.credits} + ${offer.bonusCredits} crédits bonus par carte (${offer.totalCredits} crédits) · tous les jeux, cadeaux inclus · durée de jeu variable`}`;
}
function normalizeArcadeSnapshot(value) {
  if (!plain(value) || !['time', 'credit'].includes(value.mode) || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(String(value.id || ''))) throw failure('contrat de carte invalide.');
  const snapshot = { id: value.id, mode: value.mode, price: number(value.price, 'prix', { max: 10000 }),
    description: description(value.description, value.mode === 'time' ? TIMED_DESCRIPTION : CREDIT_DESCRIPTION), prizeGamesIncluded: value.mode === 'credit', unlimited: value.mode === 'time' };
  if (value.mode === 'time') snapshot.minutes = number(value.minutes, 'durée', { min: 1, max: 1440, integer: true });
  else {
    snapshot.credits = number(value.credits, 'crédits'); snapshot.bonusCredits = number(value.bonusCredits, 'bonus');
    snapshot.totalCredits = Math.round((snapshot.credits + snapshot.bonusCredits) * 100) / 100;
    if (!(snapshot.totalCredits > 0)) throw failure('la carte doit contenir des crédits.');
    snapshot.gameCostMin = number(value.gameCostMin, 'coût minimal', { min: 0.01 }); snapshot.gameCostMax = number(value.gameCostMax, 'coût maximal', { min: snapshot.gameCostMin });
  }
  return snapshot;
}
function assertNoDuplicateArcadeCharge(input) {
  const items = Array.isArray(input.program) ? input.program : input.program?.items || [];
  const bought = items.some((item) => item && String(item.activityId || item.id || '') === 'arcade_time' && item.arcadeOfferId);
  if (!bought) return;
  const extras = Array.isArray(input.extras) ? input.extras : [];
  if (extras.some((extra) => plain(extra) && ['arcades-temps', 'arcades-argent'].includes(String(extra.id || extra.type || extra.key || ''))
    && (Number(extra.price) > 0 || Number(extra.qty ?? extra.quantity ?? 1) > 0))) throw failure('retirez le supplément Arcades : les cartes sont déjà comptées dans l’activité.');
}
module.exports = { normalizeArcadeOffers, quoteArcadeOffer, arcadeSummary, normalizeArcadeSnapshot, assertNoDuplicateArcadeCharge, defaults };

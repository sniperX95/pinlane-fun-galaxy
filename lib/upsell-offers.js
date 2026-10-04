// Centre-owned optional offers. null preserves the historical complements.
const MODES = new Set(['none', 'percent', 'fixed_per_participant', 'fixed_total']);
const MAX_OFFERS = 6;
const MAX_IMAGE_BYTES = 120 * 1024;
function reject(message) { const e = new Error(message); e.statusCode = 422; e.expose = true; throw e; }
function plain(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function bounded(v, min, max, fallback) { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function normalizeImage(input, strict = false) {
  if (!input) return null;
  const src = String(input.src || '').trim();
  let valid = false;
  if (/^\/assets\/[a-z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(src) && !src.includes('..') && !src.includes('//')) {
    valid = src.length <= 2048;
  } else if (/^https:\/\//i.test(src)) {
    try { const u = new URL(src); valid = !u.username && !u.password && src.length <= 2048 && !/\.svg(?:[?#]|$)/i.test(u.pathname); } catch (_) { /* invalid URL */ }
  } else {
    const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
    if (match) {
      const bytes = Buffer.from(match[1], 'base64');
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      valid = bytes.length <= MAX_IMAGE_BYTES && (src.startsWith('data:image/jpeg;') ? jpeg : src.startsWith('data:image/png;') ? png : webp);
    }
  }
  if (!valid) { if (strict) reject('Image : utilisez une photo de la bibliothèque, une URL HTTPS ou une image JPEG, PNG ou WebP de 120 Ko au plus.'); return null; }
  if (strict && [['positionX', 0, 100], ['positionY', 0, 100], ['zoom', 1, 3]].some(([key, min, max]) => input[key] != null && (!Number.isFinite(Number(input[key])) || Number(input[key]) < min || Number(input[key]) > max))) reject('Cadrage de l’image invalide.');
  return { src, positionX: bounded(input.positionX, 0, 100, 50), positionY: bounded(input.positionY, 0, 100, 50), zoom: bounded(input.zoom, 1, 3, 1) };
}
function normalizeUpsellOffers(input, { strict = false } = {}) {
  if (input == null) return null;
  if (!plain(input) || !Array.isArray(input.offers)) { if (strict) reject('Configuration des offres invalide.'); return { enabled: false, offers: [] }; }
  if (strict && (input.offers.length > MAX_OFFERS || Buffer.byteLength(JSON.stringify(input)) > 1024 * 1024)) reject('Six offres au plus, pour une configuration de moins de 1 Mo.');
  if (strict && typeof input.enabled !== 'boolean') reject('Activation des offres invalide.');
  const seen = new Set(); const offers = [];
  for (const raw of input.offers.slice(0, MAX_OFFERS)) {
    const id = String(raw?.id || '').trim(); const activityId = String(raw?.activityId || '').trim();
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id) || seen.has(id) || !/^[a-z][a-z0-9_-]{0,63}$/.test(activityId)) { if (strict) reject('Chaque offre doit avoir un identifiant unique et une activité.'); continue; }
    seen.add(id);
    if (strict && (typeof raw.enabled !== 'boolean' || !['add', 'laser_upgrade'].includes(raw.kind) || (raw.kind === 'laser_upgrade' && activityId !== 'laser_game'))) reject('Type ou activation de l’offre invalide.');
    const mode = MODES.has(raw.discount?.mode) ? raw.discount.mode : 'none';
    const value = Number(raw.discount?.value ?? 0);
    if (strict && (!MODES.has(raw.discount?.mode || 'none') || !Number.isFinite(value) || value < 0 || (mode === 'percent' && value > 100) || value > 10000)) reject('Remise invalide : 0 à 100 % ou montant positif de 10 000 € au plus.');
    const minParticipants = Math.trunc(bounded(raw.minParticipants, 1, 240, 1));
    const maxParticipants = Math.trunc(bounded(raw.maxParticipants, 1, 240, 240));
    if (strict && ['minParticipants', 'maxParticipants'].some(key => !Number.isInteger(Number(raw[key])) || Number(raw[key]) < 1 || Number(raw[key]) > 240)) reject('Participants : choisissez un entier de 1 à 240.');
    if (strict && maxParticipants < minParticipants) reject('Le maximum de participants doit être supérieur au minimum.');
    const options = {};
    for (const key of ['duration', 'games', 'hours', 'units', 'minutes']) if (raw.options?.[key] != null) {
      const n = Number(raw.options[key]);
      const max = key === 'hours' || key === 'duration' ? 6 : key === 'games' ? 3 : key === 'units' ? 200 : 600;
      if (!Number.isFinite(n) || n <= 0 || n > max || (['games', 'units', 'minutes'].includes(key) && !Number.isInteger(n))) { if (strict) reject('Option d’activité invalide.'); continue; } options[key] = n;
    }
    for (const key of ['arcadeMode', 'arcadeOfferId']) if (raw.options?.[key]) options[key] = String(raw.options[key]).slice(0, 64);
    offers.push({ id, enabled: raw.enabled === true, activityId, kind: raw.kind === 'laser_upgrade' ? 'laser_upgrade' : 'add', title: String(raw.title || '').trim().slice(0, 100), minParticipants, maxParticipants: Math.max(minParticipants, maxParticipants), options, discount: { mode, value: mode === 'none' ? 0 : Math.round(bounded(value, 0, mode === 'percent' ? 100 : 10000, 0) * 100) / 100 }, image: normalizeImage(raw.image, strict) });
  }
  return { enabled: input.enabled === true, offers };
}
function configFor(centerId) { return normalizeUpsellOffers(require('./ops-knowledge').getCenter(centerId)?.upsellOffers); }
function resolveUpsell(centerId, selection, activityId, participants, groupPax, kind = 'add') {
  const config = configFor(centerId);
  const offer = config?.enabled && config.offers.find(o => o.id === selection?.offerId && o.enabled && o.activityId === activityId && o.kind === kind);
  if (!offer) reject('Cette offre n’est plus disponible.');
  const count = Number(selection.participants ?? participants);
  if (!Number.isInteger(count) || count !== participants || count < offer.minParticipants || count > Math.min(offer.maxParticipants, groupPax)) reject('Nombre de participants indisponible pour cette offre.');
  return offer;
}
function quoteDiscount(price, offer, participants) {
  const referenceCents = Math.round(Number(price) * 100);
  if (!Number.isSafeInteger(referenceCents) || referenceCents < 0) reject('Le tarif de cette offre doit être renseigné.');
  const d = offer.discount;
  const discountCents = Math.min(referenceCents, Math.max(0, Math.round(d.mode === 'percent' ? referenceCents * d.value / 100 : d.mode === 'fixed_per_participant' ? d.value * participants * 100 : d.mode === 'fixed_total' ? d.value * 100 : 0)));
  return { offerId: offer.id, title: offer.title, participants, referencePrice: referenceCents / 100, discountMode: d.mode, discountValue: d.value, discountAmount: discountCents / 100, price: (referenceCents - discountCents) / 100 };
}
function normalizeSnapshot(input) {
  if (!plain(input)) return null;
  const out = { offerId: String(input.offerId || '').slice(0, 64), title: String(input.title || '').slice(0, 100), participants: Math.trunc(bounded(input.participants, 1, 240, 1)), discountMode: MODES.has(input.discountMode) ? input.discountMode : 'none' };
  for (const key of ['referencePrice', 'discountValue', 'discountAmount', 'price']) out[key] = Math.round(bounded(input[key], 0, 10000000, 0) * 100) / 100;
  return out;
}
module.exports = { MAX_OFFERS, MAX_IMAGE_BYTES, normalizeUpsellOffers, normalizeImage, normalizeSnapshot, resolveUpsell, configFor, quoteDiscount };

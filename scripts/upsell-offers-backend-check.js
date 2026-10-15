const assert = require('node:assert/strict');
const offers = require('../lib/upsell-offers');
const { applyCenterOverrides, getCenter } = require('../lib/ops-knowledge');
const { normalizeCenterConfig, toEditableConfig } = require('../lib/center-config');
const { normalizeProgram, buildProgramFormula } = require('../lib/visit-program');
const { normalizeReservationPayload } = require('../lib/database');
const { signatureDemande, requestFromHeldUpsell } = require('../lib/demande-publique');
const { normalizeReservationRequest } = require('../lib/reservation-request');
const { evaluateAnchoredCombination } = require('../lib/ops-engine');
const { jourDeTest, plusJours } = require('./jour-de-test');
// Un samedi a venir, hors vacances et feries : le moteur refuse une date passee.
const SAMEDI = jourDeTest({ jour: 6 });
let checks = 0;
function equal(a, b) { assert.deepEqual(a, b); checks++; }
function rejects(fn) { assert.throws(fn, e => e.statusCode === 422); checks++; }
const offer = (mode, value) => ({ id: 'golf', activityId: 'minigolf_blacklight', enabled: true, kind: 'add', minParticipants: 1, maxParticipants: 20, options: {}, discount: { mode, value } });
async function main() { try {
  equal(offers.normalizeUpsellOffers(null), null);
  equal(normalizeCenterConfig({}, 'libramont').upsellOffers, null);
  rejects(() => offers.normalizeUpsellOffers({ enabled: true, offers: [offer('percent', 101)] }, { strict: true }));
  rejects(() => offers.normalizeUpsellOffers({ enabled: true, offers: [offer('percent', 10), offer('percent', 10)] }, { strict: true }));
  rejects(() => offers.normalizeImage({ src: 'data:image/webp;base64,PHN2Zz4=' }, true));
  rejects(() => offers.normalizeImage({ src: 'http://example.com/a.png' }, true));
  rejects(() => offers.normalizeImage({ src: 'https://example.com/a.svg' }, true));
  equal(offers.normalizeImage({ src: '/assets/images/fun-run.jpg' }, true).src, '/assets/images/fun-run.jpg');
  for (const src of ['/assets/../secret.png', '//evil.example/a.png', '/assets/a.svg', 'javascript:alert(1)', 'https://user:pass@example.com/a.jpg']) rejects(() => offers.normalizeImage({ src }, true));
  rejects(() => offers.normalizeImage({ src: '/assets/a.jpg', zoom: 9 }, true));
  for (const extra of [{ minParticipants: 0 }, { maxParticipants: 241 }, { minParticipants: 1.5 }, { enabled: 'true' }, { kind: 'unsupported' }]) rejects(() => offers.normalizeUpsellOffers({ enabled: true, offers: [{ ...offer('none', 0), ...extra }] }, { strict: true }));
  rejects(() => offers.normalizeUpsellOffers({ enabled: true, offers: Array.from({length: 7}, (_, i) => ({...offer('none', 0), id: `offer${i}`})) }, { strict: true }));
  for (const [mode, value, expected] of [['percent', 10, 9], ['fixed_per_participant', 2, 6], ['fixed_total', 3, 7], ['none', 99, 10]]) {
    const o = offers.normalizeUpsellOffers({ enabled: true, offers: [offer(mode, value)] }, { strict: true }).offers[0];
    equal(offers.quoteDiscount(10, o, 2).price, expected);
  }
  equal(offers.quoteDiscount(0.05, { id: 'a', discount: { mode: 'percent', value: 10 } }, 1).price, 0.04);
  const config = { enabled: true, offers: [offer('percent', 10), { ...offer('fixed_per_participant', 1), id: 'laser', activityId: 'laser_game', kind: 'laser_upgrade', minParticipants: 2, options: { games: 3 } }] };
  applyCenterOverrides(new Map([['libramont', { upsellOffers: config }]]));
  equal(toEditableConfig(getCenter('libramont')).upsellOffers.offers.length, 2);
  const base = [{ activityId: 'bowling', participants: 4, duration: 1 }, { activityId: 'laser_game', participants: 4, games: 2 }];
  const full = normalizeProgram(base, { centerId: 'libramont', pax: 4 });
  const upgraded = normalizeProgram([base[0], { ...base[1], extraLaser: { offerId: 'laser', participants: 2, games: 3, price: 0, discountValue: 100 } }], { centerId: 'libramont', pax: 4 });
  const laser = upgraded.items.find(i => i.activityId === 'laser_game');
  equal([laser.participants, laser.games, laser.extraLaser.participants, laser.extraLaser.games], [4, 2, 2, 3]);
  equal(laser.extraLaser.referencePrice, 14); equal(laser.extraLaser.discountAmount, 2); equal(upgraded.price - full.price, 12);
  const formula = buildProgramFormula(upgraded);
  equal(formula.steps[1].participantsPerGame, [4, 4, 2]);
  const scenario = evaluateAnchoredCombination({ center: getCenter('libramont'), formula, date: SAMEDI, pax: 4, anchorTimes: { bowling: 840, laser_game: 900 }, reservations: [], laneStatuses: {}, blocks: [], laserGameTimes: [900, null, 960] });
  equal(scenario.ok, true);
  equal(scenario.scenario.laserPassPlan.pendingPasses.map(p => [p.countIndex, p.pax]), [[2, 4], [3, 2]]);
  const persisted = normalizeReservationPayload({ name: 'QA', phone: '0400000000', date: SAMEDI, startTime: '14:00', duration: 1, centerId: 'libramont', type: 'bowling', pax: 4, program: upgraded, price: upgraded.price });
  equal(persisted.program.items[1].extraLaser, laser.extraLaser);
  assert.match(require('../lib/visit-program').describeProgram(upgraded), /\+ 1 pour 2 pers/); checks++;
  const mail = require('../lib/ops-communications').buildMessage({ reservation: { ...persisted, email: 'qa@example.test' }, templateId: 'confirmation', channel: 'email' });
  const laserMail = mail.details.find(d => /laser/i.test(d.label));
  assert.match(laserMail.value, /2 parties \+ 1 partie pour 2 participants/); checks++;
  assert.match(laserMail.value, /remise/); checks++;
  const req = { centerId: 'libramont', pax: 4, program: upgraded };
  equal(signatureDemande(req) === signatureDemande({ ...req, program: full }), false);
  rejects(() => normalizeProgram([{ ...base[1], extraLaser: { offerId: 'unknown', participants: 2, games: 3 } }], { centerId: 'libramont', pax: 4 }));
  rejects(() => normalizeProgram([{ ...base[1], extraLaser: { offerId: 'laser', participants: 1, games: 3 } }], { centerId: 'libramont', pax: 4 }));
  rejects(() => normalizeProgram([{ ...base[1], extraLaser: { participants: 5, games: 3 } }], { centerId: 'libramont', pax: 4 }));
  const legacy = normalizeProgram([{ ...base[1], extraLaser: { participants: 2, games: 3, price: 0 } }], { centerId: 'libramont', pax: 4 });
  equal(legacy.items[0].extraLaser.price, 14);
  rejects(() => normalizeProgram([{ ...base[1], extraLaser: { participants: 2, games: 99 } }], { centerId: 'libramont', pax: 4 }));
  const nonlinearOffer = { ...offer('percent', 20), id: 'run', activityId: 'fun_run', minParticipants: 1, maxParticipants: 20, options: { minutes: 30 } };
  applyCenterOverrides(new Map([['libramont', { upsellOffers: { enabled: true, offers: [...config.offers, nonlinearOffer] } }]]));
  for (const [participants, reference, price] of [[1, 55, 44], [5, 55, 44], [6, 110, 88], [11, 165, 132]]) {
    const run = normalizeProgram([{ activityId: 'fun_run', participants, minutes: 30, upsell: { offerId: 'run', participants, price: 0 } }], { centerId: 'libramont', pax: 20 }).items[0];
    equal([run.upsell.referencePrice, run.price], [reference, price]);
  }
  rejects(() => normalizeProgram([{ activityId: 'fun_run', participants: 2, minutes: 15, upsell: { offerId: 'run', participants: 2 } }], { centerId: 'libramont', pax: 4 }));
  applyCenterOverrides(new Map([['libramont', { upsellOffers: { enabled: true, offers: [{ ...nonlinearOffer, discount: { mode: 'percent', value: 100 } }] } }]]));
  const freeCards = require('../lib/booking-complements').buildVisitComplements({ centerId: 'libramont', date: SAMEDI, pax: 4, program: full, retainedSlot: { time: '14:00', lanes: [1], opsPlan: { anchorPlan: { times: { bowling: '14:00', laser_game: '15:00' } } } }, reservations: [], laneStatuses: {}, blocks: [] });
  equal(freeCards.length, 1);
  equal([freeCards[0].deltaTotal, freeCards[0].discount.price, freeCards[0].discount.referencePrice], [0, 0, 55]);
  applyCenterOverrides(new Map([['libramont', { upsellOffers: config }]]));
  const body = { centerId: 'libramont', type: 'bowling', date: SAMEDI, startTime: '14:00', pax: 4, name: 'QA', phone: '0400000000', email: 'qa@example.test', program: [base[0], { ...base[1], extraLaser: { offerId: 'laser', participants: 2, games: 3 } }] };
  const booked = normalizeReservationRequest(body, { channel: 'public', requireEmail: true });
  const held = { ...booked, signatureDemande: signatureDemande(booked) };
  applyCenterOverrides(new Map([['libramont', { upsellOffers: { enabled: false, offers: config.offers } }]]));
  rejects(() => normalizeProgram([{ ...base[1], extraLaser: { offerId: 'laser', participants: 2, games: 3 } }], { centerId: 'libramont', pax: 4 }));
  const frozen = requestFromHeldUpsell({ ...body, quotedPrice: 0, price: 0 }, held, { requireEmail: true });
  equal([frozen.price, frozen.program.items[1].extraLaser], [booked.price, booked.program.items[1].extraLaser]);
  for (const patch of [{ centerId: 'other' }, { date: plusJours(SAMEDI, 1) }, { pax: 5 }, { startTime: '15:00' }]) {
    // Unknown tenant throws during the ordinary booking normalizer; both reject the frozen contract.
    try { equal(requestFromHeldUpsell({ ...body, ...patch }, held), null); } catch (e) { checks++; }
  }
  for (const patch of [{ participants: 3 }, { games: 2 }, { offerId: 'forged' }]) equal(requestFromHeldUpsell({ ...body, program: [base[0], { ...base[1], extraLaser: { ...body.program[1].extraLaser, ...patch } }] }, held), null);
  equal(requestFromHeldUpsell(body, { ...held, signatureDemande: 'forged' }), null);
  const db = require('../lib/database');
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fixture:fixture@127.0.0.1/fixture';
  const pool = db.getPool(); const oldQuery = pool.query;
  const token = db.nouveauJetonBlocage(); const hash = db.empreinteJetonBlocage(token);
  let expired = false; let released = false;
  pool.query = async (sql, args) => {
    assert.match(sql, /expires_at > now\(\)/); assert.match(sql, /released_at is null/); checks += 2;
    return { rows: !expired && !released && args[0] === hash && args[1] === body.centerId && args[2] === body.date && args[3] === 'device' ? [{ payload: held }] : [] };
  };
  try {
    equal(await db.readUpsellSlotHold(token, body, 'device'), held);
    equal(await db.readUpsellSlotHold(db.nouveauJetonBlocage(), body, 'device'), null);
    equal(await db.readUpsellSlotHold(token, body, 'stolen-device'), null);
    equal(await db.readUpsellSlotHold(token, { ...body, centerId: 'other' }, 'device'), null);
    expired = true; equal(await db.readUpsellSlotHold(token, body, 'device'), null);
    expired = false; released = true; equal(await db.readUpsellSlotHold(token, body, 'device'), null);
  } finally { pool.query = oldQuery; if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl; }
  console.log(`upsell-offers-backend-check OK: ${checks} assertions`);
} finally { applyCenterOverrides(new Map()); } }
main().catch(error => { console.error(error); process.exitCode = 1; });

// Gate TARIFS CLIENT : prouve, sur du VRAI code, que l'edition tarifaire cote
// centre est correcte ET sure. Logique argent + logique securite : le gate
// mute puis restaure (edition inverse, jamais git checkout).
//
// CE QUE CE GATE PROUVE EN COMPORTEMENT (pas en presence de chaine) :
//   1. CORRELATION PRIX : avec un override de prix scope centreX, le prix
//      "apercu" (chemin reel api/public-availability) egale le prix FACTURE
//      (chemin reel lib/reservation-request) : plus de mismatch (BUG 1).
//   2. DOCTRINE : sans aucun override, getBasePrice(...centerId) est IDENTIQUE
//      au prix socle, au centime.
//   3. ENFORCEMENT REMOVED : un override removed:true retire la formule de
//      getEffectiveFormules ET le chemin disponibilite/creation la refuse
//      (aucun slot bookable, reservation refusee) (BUG 2).
//   4. SECURITE : la logique d'ecriture client REFUSE centerId='all' AVANT
//      toute ecriture (meme classe de faille que l'escalade de role).
//   5. ISOLATION : un override scope centreA n'affecte pas centreB.
//
// Puis DEUX contre-preuves par MUTATION (le gate sait rougir) :
//   (a) retirer le passage de centerId dans un getBasePrice de
//       api/public-availability -> la correlation prix rougit.
//   (b) neutraliser la garde 'all' de lib/catalog-overrides -> la securite rougit.
//
// Zero reseau, zero base : lib/database et lib/rate-limit sont remplaces dans
// require.cache AVANT tout require applicatif (motif de
// scripts/catalog-overrides-check.js). getPool() renvoie un pool dont query
// jette : refreshFormuleOverrides/refreshCenterOverrides retombent fail-soft sur
// l'etat en memoire pose par setFormuleOverrides.
//
// Lancement : node scripts/client-tarifs-check.js
'use strict';
// ZERO RESEAU, VRAIMENT. La disponibilite relit le calendrier scolaire officiel
// (lib/booking-config, synchronisation Wallonie) : sans cet interrupteur, le
// gate ouvrait une connexion TLS vers l exterieur, et Node sous Windows
// plantait en sortant sur ce socket encore ouvert (« UV_HANDLE_CLOSING »,
// code 127) apres un ALL OK. Mesure du 2026-09-28 : un TLSSocket actif au
// process.exit, sur la version en prod comme sur la suivante.
process.env.PINLANE_CALENDAR_SYNC = 'off';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// Mocks d'infrastructure poses AVANT tout require applicatif.
// ---------------------------------------------------------------------------
function mockModule(relPath, exports) {
  const p = require.resolve(relPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

// getPool().query jette : le handler reel appelle refreshFormuleOverrides /
// refreshCenterOverrides en fail-soft -> ils conservent l'etat setFormuleOverrides.
mockModule('../lib/database', {
  getPool: () => ({ query: async () => { throw new Error('gate-no-db'); } }),
  readAvailabilitySnapshot: async () => ({ reservations: [], laneStatuses: {}, centerId: 'gembloux' }),
  allocateLanes: () => [],
  validateReservationResources: () => true,
});
// Le limiteur reel garde un etat par IP entre invocations : on le neutralise
// pour rester deterministe (on ne teste pas le rate-limit ici).
mockModule('../lib/rate-limit', {
  enforceRateLimit: () => false,
  checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  getClientIp: () => 'gate',
});

const bc = require('../lib/booking-config');
const rr = require('../lib/reservation-request');
const catalogPath = path.join(ROOT, 'lib', 'catalog-overrides.js');
const availPath = path.join(ROOT, 'api', 'public-availability.js');
let getCenterFn = null;
try { ({ getCenter: getCenterFn } = require('../lib/ops-knowledge')); } catch (error) { getCenterFn = null; }

function freshCatalog() {
  delete require.cache[require.resolve(catalogPath)];
  return require(catalogPath);
}
function freshAvail() {
  delete require.cache[require.resolve(availPath)];
  return require(availPath);
}
let lib = freshCatalog();
let availHandler = freshAvail();

// ---------------------------------------------------------------------------
// Parametres : une VRAIE formule per_pax du socle (pas de valeur codee en dur).
// ---------------------------------------------------------------------------
const baseFormule = bc.FORMULES.find((f) => f.type !== 'per_lane');
if (!baseFormule) { console.error('client-tarifs-check: aucune formule per_pax dans le socle'); process.exit(1); }
const FID = baseFormule.id;
const BASE = Number(baseFormule.price);
const MINPAX = Number(baseFormule.minPax) || 1;
const CENTER = 'gembloux';   // centre porteur de l'override (scope precis)
const OTHER = 'libramont';   // centre temoin (aucun override)
const OVR = 40;              // prix override, distinct du socle
const PAX = 10;              // pax des tests directs getBasePrice
// Pax de l'apercu : sous le minimum de la formule -> le handler retombe sur la
// branche "indisponible" (Min. X personnes) qui calcule le prix apercu SANS
// toucher a la base ni au moteur de planning.
if (MINPAX <= 1) { console.error('client-tarifs-check: formule socle sans minimum exploitable'); process.exit(1); }
const PREVIEW_PAX = 1;

// ---------------------------------------------------------------------------
// Fabrique de ligne d'override en memoire (forme consommee par booking-config).
// ---------------------------------------------------------------------------
function ovLine(formuleId, centerId, patch = {}) {
  return {
    formuleId,
    centerId,
    name: patch.name === undefined ? null : patch.name,
    priceValue: patch.priceValue === undefined ? null : patch.priceValue,
    priceOld: patch.priceOld === undefined ? null : patch.priceOld,
    enabled: patch.enabled === undefined ? null : patch.enabled,
    removed: patch.removed === undefined ? false : patch.removed,
  };
}
function overridesMap(entries) {
  return new Map(entries.map((e) => [`${e.formuleId}|${e.centerId}`, e]));
}

// ---------------------------------------------------------------------------
// Date ouverte, resolue avec le meme centre que le handler.
// ---------------------------------------------------------------------------
let centerDocForDate = null;
try { centerDocForDate = getCenterFn ? (getCenterFn(CENTER) || null) : null; } catch (error) { centerDocForDate = null; }
function pickOpenDate() {
  const d = new Date(Date.now() + 7 * 86400000);
  for (let i = 0; i < 21; i += 1) {
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (bc.getSchedule(s, centerDocForDate)) return s;
    d.setDate(d.getDate() + 1);
  }
  return null;
}
const OPEN_DATE = pickOpenDate();
if (!OPEN_DATE) { console.error('client-tarifs-check: aucune date ouverte trouvee'); process.exit(1); }

// ---------------------------------------------------------------------------
// Invocation reelle du handler api/public-availability (req/res factices).
// ---------------------------------------------------------------------------
function qs(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
function invokeAvailability(handler, params) {
  return new Promise((resolve, reject) => {
    const req = {
      method: 'GET',
      url: `/api/public-availability?${qs(params)}`,
      headers: { host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(body) { resolve({ statusCode: this.statusCode, body: body ? JSON.parse(body) : null }); },
    };
    res.req = req;
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

// Prix FACTURE : chemin reel de la creation publique (lib/reservation-request).
function billedPrice(formuleId, centerId, pax) {
  const request = rr.normalizeReservationRequest(
    { type: 'formule', formuleId, centerId, pax, email: 'client@example.com', date: OPEN_DATE, startTime: '14:00' },
    { channel: 'public' },
  );
  return Number(request.price);
}

// Prix APERCU : chemin reel de api/public-availability (champ price renvoye).
async function previewPrice(handler, formuleId, centerId, pax) {
  const out = await invokeAvailability(handler, { date: OPEN_DATE, centerId, type: 'formule', formuleId, pax });
  if (!out.body || typeof out.body.price !== 'number') {
    throw new Error(`reponse availability inattendue : ${JSON.stringify(out.body)}`);
  }
  return out.body.price;
}

// ---------------------------------------------------------------------------
// Faux pool qui ENREGISTRE chaque requete : prouve "aucune ecriture" sur refus.
// ---------------------------------------------------------------------------
function makeRecordingPool() {
  const rows = [];
  const calls = [];
  return {
    rows,
    calls,
    async query(text, params = []) {
      calls.push({ text: String(text), params });
      const sql = String(text);
      if (/insert into formule_overrides/i.test(sql)) {
        const row = {
          formule_id: params[0], center_id: params[1], name: params[2],
          price_value: params[3], price_old: params[4], enabled: params[5],
          removed: params[6], sort_index: params[7],
        };
        const idx = rows.findIndex((r) => r.formule_id === row.formule_id && r.center_id === row.center_id);
        if (idx === -1) rows.push(row); else rows[idx] = row;
        return { rows: [row], rowCount: 1 };
      }
      if (/delete from formule_overrides/i.test(sql)) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].formule_id === params[0] && rows[i].center_id === params[1]) rows.splice(i, 1);
        }
        return { rows: [], rowCount: before - rows.length };
      }
      if (/from formule_overrides/i.test(sql) && /where formule_id/i.test(sql)) {
        const found = rows.find((r) => r.formule_id === params[0] && r.center_id === params[1]);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// Sondes reutilisees par les sections vertes ET les contre-preuves.
// ---------------------------------------------------------------------------
// La correlation apercu==facture tient (chemin public-availability reel).
async function probeCorrelation(handler) {
  bc.setFormuleOverrides(overridesMap([ovLine(FID, CENTER, { priceValue: OVR })]));
  const billed = billedPrice(FID, CENTER, PREVIEW_PAX);
  const preview = await previewPrice(handler, FID, CENTER, PREVIEW_PAX);
  return billed === preview;
}
// La logique d'ecriture client refuse 'all' ET n'ecrit rien.
async function probeSecurityRefusesAll(mod) {
  const pool = makeRecordingPool();
  let refused = false;
  try {
    await mod.upsertClientFormuleOverride(pool, { formuleId: FID, centerId: 'all', patch: { priceValue: OVR } });
  } catch (error) {
    refused = Boolean(error && error.expose);
  }
  return refused && pool.calls.length === 0;
}

(async () => {
  // =========================================================================
  console.log('[1] DOCTRINE : sans override, getBasePrice(...centerId) = socle au centime');
  // =========================================================================
  bc.setFormuleOverrides(new Map());
  ok(bc.getBasePrice('formule', 0, 0, PAX, FID, CENTER) === BASE * PAX,
    'getBasePrice avec centerId sans override = prix fichier x pax',
    `${bc.getBasePrice('formule', 0, 0, PAX, FID, CENTER)} vs ${BASE * PAX}`);
  ok(bc.getBasePrice('formule', 0, 0, PAX, FID, CENTER) === bc.getBasePrice('formule', 0, 0, PAX, FID),
    'le 6e argument centerId ne change RIEN quand aucun override');
  ok(billedPrice(FID, CENTER, PAX) === BASE * PAX,
    'prix FACTURE (reservation-request) sans override = socle x pax',
    `${billedPrice(FID, CENTER, PAX)} vs ${BASE * PAX}`);

  // =========================================================================
  console.log('\n[2] CORRELATION (fonction partagee) : override prix scope centreX applique');
  // =========================================================================
  bc.setFormuleOverrides(overridesMap([ovLine(FID, CENTER, { priceValue: OVR })]));
  ok(bc.getBasePrice('formule', 0, 0, PAX, FID, CENTER) === OVR * PAX,
    'getBasePrice(...,centreX) applique le nouveau prix', String(bc.getBasePrice('formule', 0, 0, PAX, FID, CENTER)));
  ok(billedPrice(FID, CENTER, PAX) === OVR * PAX,
    'prix FACTURE reflete l override du centre', String(billedPrice(FID, CENTER, PAX)));
  ok(bc.getBasePrice('formule', 0, 0, PAX, FID, CENTER) === billedPrice(FID, CENTER, PAX),
    'apercu (getBasePrice centerId) == facture (reservation-request), aucun mismatch');

  // =========================================================================
  console.log('\n[3] CORRELATION (chemin REEL public-availability) : apercu == facture');
  // =========================================================================
  const previewApplied = await previewPrice(availHandler, FID, CENTER, PREVIEW_PAX);
  ok(previewApplied === OVR * PREVIEW_PAX,
    'le handler public-availability renvoie le prix override (centerId passe)',
    `${previewApplied} vs ${OVR * PREVIEW_PAX}`);
  ok(await probeCorrelation(availHandler),
    'apercu (handler reel) == facture (reservation-request) : mismatch BUG 1 corrige');

  // =========================================================================
  console.log('\n[4] ISOLATION : un override scope centreA n affecte pas centreB');
  // =========================================================================
  bc.setFormuleOverrides(overridesMap([ovLine(FID, CENTER, { priceValue: OVR })]));
  ok(bc.getBasePrice('formule', 0, 0, PAX, FID, OTHER) === BASE * PAX,
    'centreB (sans override) garde le prix socle', String(bc.getBasePrice('formule', 0, 0, PAX, FID, OTHER)));
  ok(billedPrice(FID, OTHER, PAX) === BASE * PAX,
    'facture centreB inchangee malgre l override centreA', String(billedPrice(FID, OTHER, PAX)));
  ok(bc.getBasePrice('formule', 0, 0, PAX, FID, CENTER) === OVR * PAX,
    'centreA applique bien son override (temoin positif)');

  // =========================================================================
  console.log('\n[5] ENFORCEMENT REMOVED : formule retiree ni servie, ni recherchable, ni reservable');
  // =========================================================================
  bc.setFormuleOverrides(overridesMap([ovLine(FID, CENTER, { removed: true })]));
  ok(!bc.getEffectiveFormules(CENTER).some((f) => f.id === FID),
    'getEffectiveFormules(centreA) EXCLUT la formule retiree');
  ok(bc.getEffectiveFormules(OTHER).some((f) => f.id === FID),
    'la formule reste servie au centreB (retrait scope au centre)');

  const removedAvail = await invokeAvailability(availHandler, { date: OPEN_DATE, centerId: CENTER, type: 'formule', formuleId: FID, pax: MINPAX });
  ok(removedAvail.body && Array.isArray(removedAvail.body.slots) && removedAvail.body.slots.length === 0,
    'disponibilite : AUCUN creneau reservable pour une formule retiree',
    `slots=${removedAvail.body && removedAvail.body.slots && removedAvail.body.slots.length}`);
  ok(removedAvail.body && /indisponible/i.test(String(removedAvail.body.message || '')),
    'disponibilite : message "indisponible" (reutilise le format existant)',
    JSON.stringify(removedAvail.body && removedAvail.body.message));

  let creationRefused = false;
  let creationMsg = '';
  try {
    rr.normalizeReservationRequest(
      { type: 'formule', formuleId: FID, centerId: CENTER, pax: MINPAX, email: 'client@example.com', date: OPEN_DATE, startTime: '14:00' },
      { channel: 'public' },
    );
  } catch (error) { creationRefused = true; creationMsg = String(error && error.message); }
  ok(creationRefused && /indisponible/i.test(creationMsg),
    'creation : reservation d une formule retiree REFUSEE cote serveur', creationMsg);

  let otherCreationOk = true;
  try {
    rr.normalizeReservationRequest(
      { type: 'formule', formuleId: FID, centerId: OTHER, pax: MINPAX, email: 'client@example.com', date: OPEN_DATE, startTime: '14:00' },
      { channel: 'public' },
    );
  } catch (error) { otherCreationOk = false; }
  ok(otherCreationOk, 'creation : le centreB (formule non retiree) reste reservable (pas de faux blocage)');

  // =========================================================================
  console.log('\n[6] SECURITE : l ecriture client REFUSE centerId=all sans ecrire, et ecrit pour un centre precis');
  // =========================================================================
  ok(await probeSecurityRefusesAll(lib),
    "upsertClientFormuleOverride('all') : refuse (erreur exposee) et AUCUNE ecriture");

  const poolReset = makeRecordingPool();
  let resetRefused = false;
  try {
    await lib.resetClientFormuleOverride(poolReset, { formuleId: FID, centerId: 'all' });
  } catch (error) { resetRefused = Boolean(error && error.expose); }
  ok(resetRefused && poolReset.calls.length === 0,
    "resetClientFormuleOverride('all') : refuse et AUCUNE ecriture");

  const poolOk = makeRecordingPool();
  const savedRow = await lib.upsertClientFormuleOverride(poolOk, { formuleId: FID, centerId: CENTER, patch: { priceValue: OVR } });
  ok(savedRow && savedRow.centerId === CENTER && savedRow.priceValue === OVR && poolOk.rows.length === 1,
    'centre precis : ecriture acceptee et scopee au centre client', JSON.stringify({ centerId: savedRow && savedRow.centerId, priceValue: savedRow && savedRow.priceValue }));

  const poolCreate = makeRecordingPool();
  let unknownRefused = false;
  try {
    await lib.upsertClientFormuleOverride(poolCreate, { formuleId: 'formule-inexistante', centerId: CENTER, patch: { priceValue: OVR } });
  } catch (error) { unknownRefused = Boolean(error && error.expose); }
  ok(unknownRefused, 'pas de creation de formule : un id inconnu est refuse (assertFormuleId preservee)');

  // =========================================================================
  console.log('\n[7] CONTRE-PREUVES par MUTATION : le gate sait rougir, puis restauration inverse');
  // =========================================================================
  async function withMutation(filePath, rawAnchor, rawReplacement, reload, probe, label) {
    const original = fs.readFileSync(filePath, 'utf8');
    // Ancres exprimees en \n ; on les aligne sur la fin de ligne reelle du
    // fichier (CRLF sur ce repo Windows) pour que la correspondance soit exacte.
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const anchor = rawAnchor.split('\n').join(eol);
    const replacement = rawReplacement.split('\n').join(eol);
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`client-tarifs-check: ancre de mutation introuvable ou ambigue (${occurrences}) : ${label}`);
      process.exit(1);
    }
    const mutated = original.replace(anchor, replacement);
    if (mutated === original) {
      console.error(`client-tarifs-check: la mutation n'a rien change : ${label}`);
      process.exit(1);
    }
    fs.writeFileSync(filePath, mutated);
    let holds = true;
    try {
      holds = await probe(reload());
    } finally {
      fs.writeFileSync(filePath, original); // restauration par EDITION INVERSE exacte
    }
    if (holds) {
      console.error(`client-tarifs-check: MUTATION SANS EFFET, le gate ne sait pas rougir : ${label}`);
      process.exit(1);
    }
    ok(true, `mutation "${label}" : invariant viole, le gate ROUGIRAIT`);
    const restored = await probe(reload());
    ok(restored, `restauration inverse "${label}" : invariant retabli`);
  }

  // (a) retirer le passage de centerId dans le getBasePrice de la branche
  //     "indisponible" (celle que l'apercu emprunte quand pax < minimum) :
  //     l'apercu retombe sur le prix fichier -> il ne colle plus au facture.
  await withMutation(
    availPath,
    'price: getBasePrice(type, getFormuleLaneDuration(formule), getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig), pax, formuleId, centerId, { bowlingConfig: centerBowlingConfig, dateStr: date }),\n          requiresLanes: reservationNeedsLanes(type, formuleId),\n          label: formule.name,\n          message: availability.message,',
    'price: getBasePrice(type, getFormuleLaneDuration(formule), getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig), pax, formuleId, undefined, { bowlingConfig: centerBowlingConfig, dateStr: date }),\n          requiresLanes: reservationNeedsLanes(type, formuleId),\n          label: formule.name,\n          message: availability.message,',
    freshAvail,
    probeCorrelation,
    'public-availability : centerId retire d un getBasePrice',
  );

  // (b) neutraliser la garde 'all' cote lib : un client pourrait ecrire
  //     l'override global partage -> la securite rougit.
  await withMutation(
    catalogPath,
    '  if (center === DEFAULT_CENTER) {',
    '  if (false && center === DEFAULT_CENTER) {',
    freshCatalog,
    probeSecurityRefusesAll,
    "catalog-overrides : garde centerId='all' neutralisee",
  );

  // Etat propre restaure : les modules non mutes tiennent encore.
  lib = freshCatalog();
  availHandler = freshAvail();
  bc.setFormuleOverrides(new Map());
  ok(await probeCorrelation(availHandler), 'apres mutations/restaurations : correlation prix tient encore');
  ok(await probeSecurityRefusesAll(lib), 'apres mutations/restaurations : la garde all tient encore');

  bc.setFormuleOverrides(new Map());
  if (failures) {
    console.error(`\nclient-tarifs-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\nclient-tarifs-check: ALL OK (apercu==facture, doctrine, removed refuse, all refuse, isolation)');
  process.exit(0);
})().catch((error) => {
  // Un echec de restauration laisserait un fichier mute : on le signale fort.
  console.error('client-tarifs-check: exception', error && (error.stack || error));
  process.exit(1);
});

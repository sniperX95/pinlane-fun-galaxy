const {
  BOWLING_PRICES,
  DURATION_OPTIONS,
  FORMULES,
  LASER_GAME_OPTIONS,
  getEffectiveFormules,
  getSchedule,
  refreshFormuleOverrides,
  resolveBowlingCapacity,
  todayStr,
} = require('../lib/booking-config');
const { getPool, createCustomRequest } = require('../lib/database');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { enforceRateLimit } = require('../lib/rate-limit');
const { getCenter, getFormula, refreshCenterOverrides, refreshCatalog } = require('../lib/ops-knowledge');
const { sendCustomRequestAck } = require('../lib/ops-communications');
const {
  loadAvailabilityBlocks,
  isCenterClosedAt,
  isActivityFullyBlockedOn,
  isFormulaFullyBlockedOn,
  resolveBlocksForDate,
} = require('../lib/availability-blocks');
const { getFormulaAnchorModel, ANCHOR_ACTIVITY_IDS } = require('../lib/ops-engine');

// This function serves several public surfaces to stay under the Vercel Hobby
// 12-function limit:
//   GET  /api/public-booking-meta  -> booking catalog for the public forms
//   POST /api/pilot-lead           -> pilot lead capture (SaaS landing)
//   POST /api/custom-request       -> bespoke enquiry lead (companies / special
//                                      needs). Both POSTs are rewritten here in
//                                      vercel.json; discriminated by body.kind.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUSTOM_REQUEST_OCCASIONS = new Set(['anniversaire', 'amis', 'entreprise', 'ecole', 'autre']);

function clean(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

// LEAD sur mesure : enregistré hors planning (table custom_requests), jamais
// dans reservations. Renvoie 201 même si l'accusé email échoue (best-effort).
async function handleCustomRequest(req, res, body) {
  if (enforceRateLimit(req, res, { scope: 'custom-request', limit: 5, windowMs: 600_000 })) {
    return;
  }

  const contactName = clean(body.contactName ?? body.name, 160);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 60);
  const company = clean(body.company, 160);
  const requestedDate = clean(body.requestedDate ?? body.date, 120);
  const message = clean(body.message ?? body.notes, 2000);
  const occasionRaw = clean(body.occasion, 40).toLowerCase();
  const occasion = CUSTOM_REQUEST_OCCASIONS.has(occasionRaw) ? occasionRaw : '';
  const pax = Math.max(0, Math.trunc(Number(body.pax) || 0));
  const centerId = clean(body.centerId ?? body.center_id, 60) || 'libramont';

  if (!contactName || !email) {
    sendError(res, 400, 'Nom du contact et email sont obligatoires.');
    return;
  }
  if (!EMAIL_PATTERN.test(email)) {
    sendError(res, 400, 'Adresse email invalide.');
    return;
  }
  if (!message) {
    sendError(res, 400, 'Merci de décrire votre besoin.');
    return;
  }

  let lead;
  try {
    lead = await createCustomRequest({
      centerId,
      contactName,
      company,
      email,
      phone,
      requestedDate,
      pax,
      occasion,
      message,
      source: 'client',
      payload: { userAgent: clean(req.headers?.['user-agent'], 400) },
    });
  } catch (error) {
    sendError(res, 503, 'Demande non enregistrée, réessayez dans un instant.');
    return;
  }

  // Accusé de réception client (best-effort, tracé mais non bloquant).
  const ack = await sendCustomRequestAck({
    id: lead.id,
    email: lead.email,
    contactName: lead.contactName,
    company: lead.company,
    occasion: lead.occasion,
    requestedDate: lead.requestedDate,
    pax: lead.pax,
    message: lead.message,
  }).catch((error) => ({ skipped: true, reason: error.message || 'Envoi impossible.' }));

  sendJson(res, 201, {
    ok: true,
    id: lead.id,
    acknowledgementSent: Boolean(ack && ack.ok),
    acknowledgement: ack || null,
  });
}

async function handlePilotLead(req, res, body) {
  if (enforceRateLimit(req, res, { scope: 'pilot-lead', limit: 5, windowMs: 600_000 })) {
    return;
  }

  const centerName = clean(body.centre ?? body.centerName, 160);
  const contactName = clean(body.contact ?? body.contactName, 160);
  const email = clean(body.email, 200);
  const priority = clean(body.priority, 120);

  if (!contactName || !email) {
    sendError(res, 400, 'Contact et email sont obligatoires.');
    return;
  }

  if (!EMAIL_PATTERN.test(email)) {
    sendError(res, 400, 'Adresse email invalide.');
    return;
  }

  const userAgent = clean(req.headers?.['user-agent'], 400);

  try {
    const result = await getPool().query(
      `
        insert into pilot_leads (center_name, contact_name, email, priority, source, user_agent, payload)
        values ($1, $2, $3, $4, 'landing', $5, $6::jsonb)
        returning id, created_at;
      `,
      [
        centerName,
        contactName,
        email,
        priority,
        userAgent,
        JSON.stringify({ centerName, contactName, email, priority }),
      ],
    );
    sendJson(res, 201, { ok: true, id: result.rows[0]?.id ?? null });
  } catch (error) {
    sendError(res, 503, 'Demande non enregistrée, réessayez dans un instant.');
  }
}

// ── VERDICT DU JOUR (cle `day` du payload public) ────────────────────────────
//
// Ce que le client ne savait pas : le cockpit staff pose des blocages
// (availability_blocks) que SEUL le serveur lisait. L'etape 1 du tunnel
// annoncait donc "Ouvert 10h - 22h" un jour ferme. On expose ici un VERDICT
// calcule, JAMAIS une projection de la table.
//
// CE QUI NE SORT JAMAIS : la ligne brute d'un blocage. Ni `reason` (200
// caracteres libres tapes par le staff, peut contenir un nom de client type
// "privatise Dupont SA"), ni `createdBy` (identifie un membre du staff), ni
// l'`id` (poignee sur une ressource staff), ni les blocages de scope 'lane'
// (aucune valeur cliente : le client ne choisit jamais une piste, et cela
// revelerait l'etat de maintenance et la capacite reelle). Ni la recurrence,
// qui livrerait tout le calendrier de fermetures futures en une requete : la
// reponse est deja resolue A la date demandee.
//
// LIMITES ASSUMEES, a ne pas depasser :
//  1. Un blocage de PLAGE horaire (start/end non nuls) sur une formule ou une
//     activite ne grise RIEN. Le moteur se contente d'oter les creneaux
//     impactes (garde finale validateReservationResources). Griser serait
//     inventer une indisponibilite que le moteur ne prononce pas.
//  2. Un blocage jour entier d'une activite NON-ancre (minigolf, arcade,
//     playground) ne grise aucune formule : le moteur ne refuse pas ces
//     combinaisons aujourd'hui. Le client tombe alors sur le message d'etape 2.
//  3. Le calcul de `open` par balayage :00/:30 est legerement OPTIMISTE : une
//     plage 14:00-21:30 sur une journee 14h-22h laisse la marque 21:30 vivante
//     et la journee reste "ouverte" alors qu'aucun creneau d'une heure ne tient.
//     Optimisme volontaire : on prefere laisser le moteur trancher a l'etape 2
//     plutot qu'annoncer une fermeture que le serveur ne prononce pas.
function buildDayStatus(blocks, dayDate, center, centerId) {
  const schedule = getSchedule(dayDate, center);
  const today = todayStr();

  // Ouvert = grille non nulle ET au moins une marque :00/:30 non couverte par
  // un blocage 'center'. Miroir exact de la boucle de grille de
  // api/public-availability.js (bowling classique).
  let openMarks = 0;
  if (schedule) {
    for (let value = schedule.open; value < schedule.close; value += 0.5) {
      if (!isCenterClosedAt(blocks, dayDate, Math.round(value * 60))) openMarks += 1;
    }
  }
  const isPast = dayDate < today;
  const open = !isPast && !!schedule && openMarks > 0;

  // Table FIGEE de libelles. Jamais le champ `reason` du staff.
  let closedLabel = '';
  if (isPast) closedLabel = 'Date passée';
  else if (!schedule) closedLabel = 'Fermé ce jour';
  else if (!open) closedLabel = 'Fermé exceptionnellement ce jour';

  // Coupures 'center' a fenetre, bornees a l'amplitude, fusionnees, triees.
  const toHM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  let closedWindows = [];
  if (open && schedule) {
    const lo = Math.round(schedule.open * 60);
    const hi = Math.round(schedule.close * 60);
    const merged = [];
    resolveBlocksForDate(blocks, dayDate)
      .filter((block) => block.scopeType === 'center' && block.startMin !== null && block.endMin !== null)
      .map((block) => [Math.max(lo, block.startMin), Math.min(hi, block.endMin)])
      .filter(([start, end]) => end > start)
      .sort((a, b) => a[0] - b[0])
      .forEach(([start, end]) => {
        const last = merged[merged.length - 1];
        if (last && start <= last[1]) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
      });
    closedWindows = merged.map(([start, end]) => ({ start: toHM(start), end: toHM(end) }));
  }

  // Activites VENDABLES seulement (ancres du moteur : bowling, laser_game). Un
  // id y entre sur un blocage jour entier OU sur le on/off permanent
  // activityAvailability, que api/public-availability.js applique deja sans que
  // le client le sache (segment Bowling clickable pour rien).
  const availability = (center.activityAvailability && typeof center.activityAvailability === 'object')
    ? center.activityAvailability
    : {};
  const unavailableActivityIds = ANCHOR_ACTIVITY_IDS.filter((id) => availability[id] === false
    || isActivityFullyBlockedOn(blocks, dayDate, id));

  // Formules : blocage jour entier direct, OU ancre du moteur indisponible.
  // Ce n'est pas une invention : scripts/availability-blocks-check.js prouve
  // que laser_game bloque rend getFormulaAnchorAvailability ok:false pour f1.
  const unavailableFormulaIds = [];
  const unavailableFormulaReason = {};
  getEffectiveFormules(centerId).forEach((formule) => {
    try {
      if (isFormulaFullyBlockedOn(blocks, dayDate, formule.id)) {
        unavailableFormulaIds.push(formule.id);
        unavailableFormulaReason[formule.id] = 'formula';
        return;
      }
      if (!unavailableActivityIds.length) return;
      const doc = getFormula(formule.id); // JETTE sur id inconnu : d'ou le try/catch
      if (!doc) return;
      const anchors = getFormulaAnchorModel(doc).anchors || [];
      const hit = anchors.find((anchor) => unavailableActivityIds.includes(anchor.activityId));
      if (hit) {
        unavailableFormulaIds.push(formule.id);
        unavailableFormulaReason[formule.id] = hit.activityId; // 'bowling' | 'laser_game'
      }
    } catch (error) {
      // Formule absente du catalogue : ne jamais faire tomber le payload public.
    }
  });

  return {
    date: dayDate,
    open,
    schedule: schedule ? { open: schedule.open, close: schedule.close, label: schedule.label } : null,
    closedLabel,
    closedWindows,
    unavailableFormulaIds,
    unavailableActivityIds,
    unavailableFormulaReason,
  };
}

module.exports = async (req, res) => {
  setCors(res, 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      sendError(res, error.statusCode || 400, error.message || 'Requête invalide.');
      return;
    }
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const isCustomRequest = body?.kind === 'custom-request' || url.pathname.endsWith('/custom-request');
    if (isCustomRequest) {
      await handleCustomRequest(req, res, body || {});
      return;
    }
    await handlePilotLead(req, res, body || {});
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  // GET /api/healthz (rewrite vercel.json) : sonde publique pour le monitoring.
  // Aucune donnee metier : juste la vitalite fonction + DB (select 1 borne).
  {
    const probeUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    if (probeUrl.pathname.endsWith('/healthz')) {
      if (enforceRateLimit(req, res, { scope: 'healthz', limit: 30, windowMs: 60_000 })) {
        return;
      }
      let db = false;
      try {
        await Promise.race([
          getPool().query('select 1'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
        db = true;
      } catch (error) {
        db = false;
      }
      sendJson(res, db ? 200 : 503, { ok: db, db });
      return;
    }
  }

  // Config publique du centre (horaires staff, regime vacances/feries, offres
  // activees) pour que l'affichage client reflete la meme verite que le moteur.
  // Fail-soft : sans DB ou centre inconnu, le client retombe sur la grille locale.
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const centerId = String(url.searchParams.get('centerId') || 'libramont');
  // Verdict DU JOUR. Parametre OPTIONNEL : sans date (ou date malformee), la
  // reponse est STRICTEMENT celle d'avant, cle 'day' absente. Aucune 400 : cet
  // endpoint est une surface de CONFIG, jamais l'autorite de reservation (c'est
  // api/public-availability). C'est aussi ce qui protege les 16 gates qui le
  // mockent avec center:null.
  const rawDate = String(url.searchParams.get('date') || '');
  const dayDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : '';
  // Rate limit UNIQUEMENT sur le chemin date : l'appel de boot (sans date) reste
  // non limite. Meme budget que api/public-availability.
  if (dayDate && enforceRateLimit(req, res, { scope: 'public-booking-meta-day', limit: 60, windowMs: 60_000 })) {
    return;
  }
  try {
    await refreshCenterOverrides(getPool());
    await refreshFormuleOverrides(getPool());
    await refreshCatalog(getPool());
  } catch (error) {
    // Baseline fichier conservee.
  }
  let center = null;
  try {
    center = getCenter(centerId) || null;
  } catch (error) {
    center = null;
  }

  // Config bookable per-center (pistes, capacités, tarifs, options laser) : le
  // front la consomme quand elle est présente, ses constantes locales restent
  // le fallback (mêmes valeurs sans override).
  const bowlingCapacity = resolveBowlingCapacity(center?.resources?.bowling);

  // Contact public du centre (téléphone + email), lu depuis centers.json
  // (publicInfo). Servi au client pour un point de contact toujours visible sur
  // le parcours de réservation. Absent (ex. centre "planned") => null, le front
  // masque la ligne de contact au lieu d'afficher une valeur inventée.
  const centerPublicInfo = center && typeof center.publicInfo === 'object' && center.publicInfo ? center.publicInfo : null;
  const centerContact = centerPublicInfo
    ? {
      phone: typeof centerPublicInfo.phone === 'string' ? centerPublicInfo.phone : '',
      email: typeof centerPublicInfo.email === 'string' ? centerPublicInfo.email : '',
    }
    : null;

  // FAIL-SOFT integral : loadAvailabilityBlocks ne jette jamais (sur incident
  // base il rend l'etat connu ou []), et tout le reste est enveloppe. `day` a
  // null signifie, cote client, rendu strictement historique.
  let day = null;
  if (dayDate && center) {
    try {
      const blocks = await loadAvailabilityBlocks(getPool(), centerId);
      day = buildDayStatus(blocks, dayDate, center, centerId);
    } catch (error) {
      day = null;
    }
  }

  sendJson(res, 200, {
    ok: true,
    today: todayStr(),
    durationOptions: DURATION_OPTIONS,
    // Formules avec overrides catalogue appliques (prix/nom/retrait) pour ce
    // centre ; sans override, strictement identique a FORMULES.
    formules: getEffectiveFormules(centerId),
    laserOptions: LASER_GAME_OPTIONS,
    bowlingPrices: BOWLING_PRICES,
    center: center
      ? {
        id: center.id,
        status: center.status || 'active',
        contact: centerContact,
        defaultSchedule: center.defaultSchedule && typeof center.defaultSchedule === 'object' ? center.defaultSchedule : null,
        holidaySettings: center.holidaySettings && typeof center.holidaySettings === 'object'
          ? center.holidaySettings
          : { enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] },
        offerAvailability: center.offerAvailability && typeof center.offerAvailability === 'object' ? center.offerAvailability : {},
        booking: {
          laneCount: bowlingCapacity.laneCount,
          normalCapacityPerLane: bowlingCapacity.normalCapacityPerLane,
          emergencyCapacityPerLane: bowlingCapacity.emergencyCapacityPerLane,
          bowlingPrices: BOWLING_PRICES,
          laserOptions: LASER_GAME_OPTIONS,
        },
        // Cle ADDITIVE, presente uniquement quand une date valide est demandee.
        ...(day ? { day } : {}),
      }
      : null,
  });
};

// Expose pour les gates (scripts/availability-day-check.js) : le verdict se
// teste unitairement, sans reseau ni base.
module.exports.__test = { buildDayStatus };

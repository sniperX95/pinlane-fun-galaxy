const {
  BOWLING_PRICES,
  DURATION_OPTIONS,
  FORMULES,
  FUN_RUN_OPTIONS,
  LASER_GAME_OPTIONS,
  getEffectiveFormules,
  getHolidayContext,
  isFormulaBlockedDate,
  isOfferEnabled,
  getSchedule,
  refreshFormuleOverrides,
  refreshWalloniaSchoolHolidays,
  resolveBowlingCapacity,
  todayStr,
  currentTimeDecimal,
  BOOKING_HORIZON_DAYS,
  LASER_GAME_ARENA_MINUTES,
} = require('../lib/booking-config');
const { getPool, checkDatabaseHealth, createCustomRequest } = require('../lib/database');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { enforceRateLimit } = require('../lib/rate-limit');
const { getActivity, getCenter, getFormula, refreshCenterOverrides, refreshCatalog } = require('../lib/ops-knowledge');
const { sendCustomRequestAck } = require('../lib/ops-communications');
const {
  loadAvailabilityBlocks,
  isCenterClosedAt,
  isActivityFullyBlockedOn,
  isFormulaFullyBlockedOn,
  resolveBlocksForDate,
} = require('../lib/availability-blocks');
const { getFormulaAnchorModel, ANCHOR_ACTIVITY_IDS, LASER_LAUNCH_GRID_MINUTES } = require('../lib/ops-engine');
const { listSellableActivities } = require('../lib/activity-catalog');
const { normalizeBranding, normalizeIdentity, customRequestFromPax } = require('../lib/center-config');
const surMesure = require('../lib/custom-request');
const { writeAuditLog, newRequestId } = require('../lib/audit-log');
const { customRequestChanges, ACTEUR_FORMULAIRE_PUBLIC } = require('../lib/registre');

// This function serves several public surfaces to stay under the Vercel Hobby
// 12-function limit:
//   GET  /api/public-booking-meta  -> booking catalog for the public forms
//   POST /api/pilot-lead           -> pilot lead capture (SaaS landing)
//   POST /api/custom-request       -> bespoke enquiry lead (companies / special
//                                      needs). Both POSTs are rewritten here in
//                                      vercel.json; discriminated by body.kind.
//   POST /api/public-booking-meta  -> body.kind 'vitrine' : les gestes du client
//                                      dans la fenetre des offres (stats, 0057).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Miroir de OCCASION_VALUES (lib/reservation-request.js) : les occasions
// proposees par le tunnel, 'evg' compris, et 'famille' (formulaire Fun Galaxy).
const CUSTOM_REQUEST_OCCASIONS = new Set(['anniversaire', 'amis', 'famille', 'entreprise', 'ecole', 'evg', 'autre']);

function clean(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

// LES GESTES DANS LA FENETRE DES OFFRES (2026-10-07, Movsar : « tout
// repertorie dans les stats [...] pour savoir les raisons qui font le plus
// prendre un add-on »). Un envoi porte les gestes d UNE visite de la page :
// au plus vingt, chacun d un type connu ; tout le reste est refuse, jamais
// devine. Aucune donnee personnelle : `visite` est tire au hasard par le
// formulaire. Une reservation annoncee « reservee » n est comptee que si elle
// existe, dans ce centre, et vient d etre creee. Sans base (developpement,
// gates), rien ne s ecrit et la reponse le dit.
const EVENEMENTS_VITRINE = new Set(['vue', 'vedette', 'ajout', 'acceptee', 'annulee', 'fermee', 'reservee']);
const RAISONS_VITRINE = new Set(['attente', 'pause', 'suite', 'centre']);
function gestesVitrine(body) {
  const centerId = clean(body.centerId, 60);
  const visite = clean(body.visite, 40);
  if (!/^[a-z0-9_-]{1,60}$/.test(centerId) || !/^[a-z0-9]{16,40}$/i.test(visite) || !Array.isArray(body.gestes)) return null;
  const entier = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
  const lignes = [];
  for (const g of body.gestes.slice(0, 20)) {
    const evenement = clean(g && g.evenement, 20);
    if (!EVENEMENTS_VITRINE.has(evenement)) continue;
    const raison = clean(g.raison, 20);
    const montant = Number(g.montant);
    lignes.push({
      evenement,
      carte: clean(g.carte, 120),
      genre: clean(g.genre, 20),
      activite: clean(g.activite, 60),
      raison: RAISONS_VITRINE.has(raison) ? raison : '',
      priorite: entier(g.priorite, 0, 1000),
      rang: entier(g.rang, 0, 50),
      promo: entier(g.promo, 0, 100),
      montant: Number.isFinite(montant) && montant >= 0 && montant < 100000 ? Math.round(montant * 100) / 100 : null,
      personnes: entier(g.personnes, 0, 500),
      reservationId: evenement === 'reservee' ? entier(g.reservation, 1, Number.MAX_SAFE_INTEGER) : null,
    });
  }
  return lignes.length ? { centerId, visite, lignes } : null;
}
async function handleVitrine(req, res, body) {
  if (enforceRateLimit(req, res, { scope: 'vitrine', limit: 120, windowMs: 600_000 })) return;
  const envoi = gestesVitrine(body);
  if (!envoi) { sendError(res, 400, 'Requête invalide.'); return; }
  try {
    getCenter(envoi.centerId);
  } catch (error) {
    sendError(res, 404, 'Centre inconnu.');
    return;
  }
  const pool = getPool();
  if (!pool) { sendJson(res, 202, { ok: true, enregistres: 0 }); return; }
  try {
    // Une « reservee » sans reservation de ce centre creee dans l heure ne
    // compte pas : un navigateur ne fabrique pas un client.
    const annoncees = envoi.lignes.filter((l) => l.evenement === 'reservee').map((l) => l.reservationId).filter(Boolean);
    const reelles = new Set();
    if (annoncees.length) {
      const r = await pool.query("select id from reservations where center_id = $1 and id = any($2::bigint[]) and created_at > now() - interval '1 hour'", [envoi.centerId, annoncees]);
      r.rows.forEach((row) => reelles.add(Number(row.id)));
    }
    const gardees = envoi.lignes.filter((l) => l.evenement !== 'reservee' || reelles.has(l.reservationId));
    if (!gardees.length) { sendJson(res, 202, { ok: true, enregistres: 0 }); return; }
    const valeurs = [];
    const lignesSql = gardees.map((l, i) => {
      const b = i * 13;
      valeurs.push(envoi.centerId, envoi.visite, l.evenement, l.carte, l.genre, l.activite, l.raison, l.priorite, l.rang, l.promo, l.montant, l.personnes, l.reservationId);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13})`;
    });
    await pool.query(`insert into upsell_events (center_id, visite, evenement, carte, genre, activite, raison, priorite, rang, promo, montant, personnes, reservation_id) values ${lignesSql.join(', ')}`, valeurs);
    sendJson(res, 201, { ok: true, enregistres: gardees.length });
  } catch (error) {
    // Une statistique perdue ne casse jamais le formulaire : elle laisse une trace.
    console.error('[public-booking-meta] vitrine', error && (error.code || error.message));
    sendJson(res, 202, { ok: true, enregistres: 0 });
  }
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
  // Meme discipline que public-reservations : pas de repli 'libramont', une
  // demande sans centre serait invisible pour la bonne equipe.
  const centerId = clean(body.centerId ?? body.center_id, 60);

  if (!centerId) {
    sendError(res, 422, 'Centre manquant : precisez le centre de la demande.');
    return;
  }
  if (!contactName || !email) {
    sendError(res, 400, 'Nom du contact et email sont obligatoires.');
    return;
  }
  if (!EMAIL_PATTERN.test(email)) {
    sendError(res, 400, 'Adresse email invalide.');
    return;
  }

  // LA DEMANDE STRUCTUREE du formulaire Fun Galaxy (`details`) : le groupe,
  // la date et le moment, les formules et les activites voulues. Elle est
  // validee avec les REGLES que l ecran applique (lib/custom-request) contre
  // le catalogue et le calendrier du centre, au moment de l envoi. Sans
  // `details` (ancienne fenetre de /reserver), rien ne change : le message
  // libre reste obligatoire.
  let demande = null;
  if (body.details && typeof body.details === 'object') {
    try {
      await refreshCenterOverrides(getPool());
      await refreshFormuleOverrides(getPool());
      await refreshCatalog(getPool());
    } catch (error) {
      // Socle fichier.
    }
    let center = null;
    try { center = getCenter(centerId); } catch (error) { center = null; }
    if (!center) {
      sendError(res, 404, 'Centre inconnu.');
      return;
    }
    if (center.demonstration === true) {
      sendError(res, 422, 'Ce formulaire est la démonstration de Pinlane, et rien n’y est enregistré.');
      return;
    }
    let blocks = [];
    try { blocks = await loadAvailabilityBlocks(getPool(), centerId); } catch (error) { blocks = []; }
    const verdict = surMesure.normaliserDemande(body.details, {
      today: todayStr(),
      nowHour: currentTimeDecimal(),
      horizonDays: BOOKING_HORIZON_DAYS,
      formules: formulesPubliques(centerId, center),
      activites: activitesPubliques(centerId, center),
      jourDe: (date) => {
        const statut = buildDayStatus(blocks, date, center, centerId);
        const [y, m, d] = date.split('-').map(Number);
        return { ...statut, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
      },
    });
    if (!verdict.ok) {
      sendError(res, verdict.status, verdict.message, { field: verdict.champ });
      return;
    }
    demande = verdict.demande;
  } else if (!message) {
    sendError(res, 400, 'Merci de décrire votre besoin.');
    return;
  }

  let lead;
  try {
    lead = await createCustomRequest({
      centerId,
      contactName,
      company: demande ? demande.organisation : company,
      email,
      phone,
      // La date lisible (« mercredi 14 octobre 2026, après-midi ») : c est
      // elle que la liste de la console et l accuse de reception montrent.
      requestedDate: demande ? surMesure.libelleQuand(demande) : requestedDate,
      pax: demande ? demande.participants : pax,
      occasion: demande ? surMesure.GROUP_TYPES[demande.groupType].occasion : occasion,
      message,
      source: 'client',
      payload: {
        userAgent: clean(req.headers?.['user-agent'], 400),
        acquisition: require('../lib/acquisition').normaliserAcquisition(body && body.acquisition, { userAgent: req.headers?.['user-agent'] }),
        ...(demande ? { demande } : {}),
      },
    });
  } catch (error) {
    sendError(res, 503, 'Demande non enregistrée, réessayez dans un instant.');
    return;
  }

  // LE REGISTRE (2026-10-05) : la demande sur mesure est journalisee en
  // entier (contact, organisation, date voulue, message, demande structuree),
  // avec son auteur « client (formulaire public) ». Non bloquant : une panne
  // du journal n efface pas la demande, elle crie (lib/audit-log.js).
  await writeAuditLog({
    centerId,
    ...ACTEUR_FORMULAIRE_PUBLIC,
    surface: 'api/public-booking-meta.js',
    action: 'createCustomRequest',
    method: 'POST',
    entityType: 'custom_request',
    entityId: lead.id,
    outcome: 'success',
    changes: customRequestChanges({}, { ...lead, centerId }),
    context: { canal: 'public', structuree: Boolean(demande) },
    requestId: newRequestId(),
  });

  // La copie expliquee part a la boite de secours du centre en meme temps que
  // l accuse au client (2026-10-05) : aucune demande ne vit seulement dans Pinlane.
  const copieSecours = require('../lib/secours-envoi').copieDemandeSecours({ ...lead, centerId });
  // Accusé de réception client (best-effort, tracé mais non bloquant).
  const ack = await sendCustomRequestAck({
    // Le centre DE LA REQUETE, pas lead.centerId : mapCustomRequest retombe sur
    // libramont, et l accuse partait signe Fun Galaxy pour tous les clients.
    centerId,
    id: lead.id,
    email: lead.email,
    contactName: lead.contactName,
    company: lead.company,
    occasion: lead.occasion,
    requestedDate: lead.requestedDate,
    pax: lead.pax,
    message: lead.message,
    demande,
  }).catch((error) => ({ skipped: true, reason: error.message || 'Envoi impossible.' }));
  await copieSecours;

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

// CE QUE LE CENTRE N A PAS. Une formule dont une etape demande une activite
// que le centre a coupee (activityAvailability a false : la plaine de jeux de
// Gembloux pour les formules 6 a 8) ne peut jamais y etre planifiee : le
// moteur rend zero creneau (mesure du 2026-08-22). Le catalogue le dit, le
// formulaire ne la propose plus. Seule une coupure EXPLICITE compte : une
// etape sans reglage ne retire rien.
//
// UN SERVICE DU BAR N EST PAS UNE INSTALLATION. Les boissons et le credit
// d arcade sont des pseudo-types de service du moteur (bar_service*, jamais
// comptes comme une ressource, lib/declared-resources.js) : leur case dans
// Etablissement dit s ils se vendent SEULS a la carte, pas s ils se servent
// dans une formule. Les deux centres de prod les ont a false : toutes les
// formules se disaient absentes et l onglet Formules etait vide (2026-09-29).
const TYPES_DE_SERVICE = new Set(['bar_service', 'bar_service_then_autonomous']);
function estUnService(step) {
  let type = String((step && step.resourceType) || '');
  if (!type) {
    try { type = String((getActivity(step.activityId) || {}).resourceType || ''); } catch (error) { type = ''; }
  }
  return TYPES_DE_SERVICE.has(type);
}
function activitesManquantes(formuleId, center) {
  const availability = center && center.activityAvailability && typeof center.activityAvailability === 'object'
    ? center.activityAvailability
    : null;
  if (!availability) return [];
  let doc = null;
  try { doc = getFormula(formuleId); } catch (error) { return []; }
  const ids = new Set((doc && Array.isArray(doc.steps) ? doc.steps : [])
    .filter((step) => step && step.activityId && !estUnService(step))
    .map((step) => step.activityId));
  return [...ids].filter((id) => availability[id] === false);
}

// Les formules du centre telles que le public les recoit : overrides du
// catalogue appliques, l interrupteur du staff (`offerOff`) et les activites
// manquantes (`missingActivityIds`), deux cles ADDITIVES posees seulement
// quand elles disent quelque chose. La lecture du catalogue et la demande sur
// mesure lisent la meme liste.
function formulesPubliques(centerId, center) {
  return getEffectiveFormules(centerId).map((formule) => {
    const publique = isOfferEnabled(formule.id, center) ? formule : { ...formule, offerOff: true };
    const manque = activitesManquantes(formule.id, center);
    return manque.length ? { ...publique, missingActivityIds: manque } : publique;
  });
}

// Ce que le centre vend, avec les faits d AGE qu il declare (activityThemes :
// « 4 à 12 ans », des 7 ans, 1,30 m minimum). Une seule source, celle que lit
// aussi l agent ; chaque cle n est posee que si le centre la declare.
function activitesPubliques(centerId, center) {
  return listSellableActivities({
    centerId,
    activityOffers: center?.activityOffers,
    availability: center && typeof center.activityAvailability === 'object' ? center.activityAvailability : null,
    // Les tables, les pistes de duckpin, les joueurs par piste reglees dans
    // Etablissement : le formulaire les lit ici, comme le serveur.
    capacity: center && center.activityCapacity && typeof center.activityCapacity === 'object' ? center.activityCapacity : null,
  }).map((activity) => {
    const theme = center && center.activityThemes && center.activityThemes[activity.id];
    if (!theme || typeof theme !== 'object') return activity;
    const extra = {};
    const ageRange = typeof theme.ageRange === 'string' ? theme.ageRange.trim() : '';
    if (ageRange) extra.ageRange = ageRange;
    const minAge = Math.trunc(Number(theme.minAge));
    if (Number.isFinite(minAge) && minAge >= 1 && minAge <= 99) extra.minAge = minAge;
    const taille = Math.trunc(Number(theme.minHeightCm));
    if (Number.isFinite(taille) && taille >= 50 && taille <= 250) extra.minHeightCm = taille;
    // LA PARTIE DE LASER : le JEU que la fiche du centre declare, et le
    // creneau de l arene qui l entoure (explication des regles et encodage des
    // joueurs compris). Movsar, 2026-09-30 : « une partie dure 20 minutes, on
    // dit 25 min pour le temps de les enregistrer et expliquer les regles ».
    // Pose seulement quand le jeu est plus court que le creneau : sinon il n y
    // a rien a expliquer. `cycleMinutes` est le pas des departs de l arene
    // (une partie en occupe au plus un) : le client lit « plus 5 a 10 min
    // d explication des regles et de preparation » (Movsar, meme jour : « 25-30
    // min cote SaaS, eux doivent savoir que leur partie dure 20 minutes »).
    const jeu = Math.trunc(Number(theme.gameMinutes));
    if (activity.id === 'laser_game' && Number.isFinite(jeu) && jeu >= 5 && jeu < LASER_GAME_ARENA_MINUTES) {
      extra.gameMinutes = jeu;
      extra.sessionMinutes = LASER_GAME_ARENA_MINUTES;
      extra.cycleMinutes = Math.max(LASER_GAME_ARENA_MINUTES, LASER_LAUNCH_GRID_MINUTES);
    }
    return Object.keys(extra).length ? { ...activity, ...extra } : activity;
  });
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
  // LA JOURNEE FINIE (Movsar, 2026-10-01 : « quand un jour est fini, genre
  // la il est plus de 22 heures, ca doit dire que c est ferme et ils peuvent
  // plus continuer pour ce jour, mais uniquement quand l heure est passee »).
  // Aujourd hui, a partir de l heure de fermeture (heure du centre), et pas
  // une minute avant ; une fermeture a minuit ne finit jamais la journee.
  const isOver = dayDate === today && !!schedule && currentTimeDecimal() >= Number(schedule.close);
  const open = !isPast && !isOver && !!schedule && openMarks > 0;

  // Table FIGEE de libelles. Jamais le champ `reason` du staff.
  let closedLabel = '';
  if (isPast) closedLabel = 'Date passée';
  else if (isOver) closedLabel = 'Fermé pour aujourd’hui';
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

  // Activites indisponibles ce jour. Un id y entre sur un blocage jour entier OU
  // sur le on/off permanent activityAvailability.
  //
  // Le perimetre couvre desormais TOUTES les activites vendables du centre, plus
  // seulement les deux ancres du moteur. Tant que minigolf, billards ou
  // playground n'etaient pas reservables, les griser n'avait pas de sens (limite
  // assumee dans scripts/availability-day-check.js). Depuis qu'ils se reservent,
  // fermer le minigolf un mardi DOIT l'eteindre dans le tunnel, sinon le client
  // reserve une activite fermee.
  //
  // Le grisage des FORMULES, lui, ne bouge pas : il ne depend que des ancres du
  // moteur (une formule ne casse pas parce qu'un billard est ferme).
  const availability = (center.activityAvailability && typeof center.activityAvailability === 'object')
    ? center.activityAvailability
    : {};
  const sellableIds = listSellableActivities({ centerId, availability }).map((activity) => activity.id);
  const testableIds = [...new Set([...ANCHOR_ACTIVITY_IDS, ...sellableIds])];
  const unavailableActivityIds = testableIds.filter((id) => availability[id] === false
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
    over: isOver,
    schedule: schedule ? { open: schedule.open, close: schedule.close, label: schedule.label } : null,
    closedLabel,
    closedWindows,
    unavailableFormulaIds,
    unavailableActivityIds,
    unavailableFormulaReason,
    // « Ce jour tombe-t-il dans une periode qui bloque les formules
    // noHolidays ? » Le TYPE de periode qui bloque se regle par centre
    // (holidaySettings.formulaBlockedPeriods) : un formulaire qui relirait
    // holiday.type devinerait, celui-ci lit le verdict de la meme fonction
    // que la reservation (isFormulaBlockedDate).
    formulaHolidayOff: isFormulaBlockedDate(dayDate, center),
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
    if (body?.kind === 'vitrine' && url.pathname.endsWith('/public-booking-meta')) {
      await handleVitrine(req, res, body);
      return;
    }
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
        db = await checkDatabaseHealth();
      } catch (error) {
        db = false;
      }
      sendJson(res, db ? 200 : 503, { ok: db, db });
      return;
    }

    // L INTERRUPTEUR DU FORMULAIRE INSTALLE, lu depuis le site du client.
    //
    // C est la lecture la plus exposee du produit : elle part du navigateur d un
    // visiteur, sur le domaine du centre, avant meme que le formulaire
    // s affiche. Elle ne renvoie donc QU UN BOOLEEN, aucune donnee metier, et
    // elle repond meme pour un centre inconnu (actif par defaut) : un
    // identifiant mal recopie dans le site ne doit pas priver le centre de son
    // formulaire.
    if (probeUrl.pathname.endsWith('/embed-state') || probeUrl.searchParams.get('embedState')) {
      if (enforceRateLimit(req, res, { scope: 'embed-state', limit: 120, windowMs: 60_000 })) {
        return;
      }
      const demande = String(probeUrl.searchParams.get('center') || probeUrl.searchParams.get('centerId') || '').trim().toLowerCase();
      let actif = true;
      try {
        await refreshCenterOverrides(getPool());
        const centre = demande ? getCenter(demande) : null;
        const reglage = centre && centre.config && centre.config.embed;
        if (reglage && reglage.actif === false) actif = false;
      } catch (error) {
        // Centre inconnu ou base indisponible : on repond ACTIF. Le pire des
        // deux mondes serait qu une panne chez nous eteigne le formulaire d un
        // client sans que personne ne l ait decide.
        actif = true;
      }
      // Cache court : le visiteur suivant ne repaie pas la lecture, et une
      // coupure decidee prend effet en une minute au pire.
      res.setHeader('Cache-Control', 'public, max-age=60');
      sendJson(res, 200, { ok: true, center: demande, actif });
      return;
    }
  }

  // Config publique du centre (horaires staff, regime vacances/feries, offres
  // activees) pour que l'affichage client reflete la meme verite que le moteur.
  // Fail-soft : sans DB ou centre inconnu, le client retombe sur la grille locale.
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  // LE MEME ENDPOINT LISAIT DEUX NOMS DE PARAMETRE DIFFERENTS SUR SES DEUX
  // CHEMINS. La sonde d etat, juste au-dessus, accepte center OU centerId ;
  // le catalogue n acceptait que centerId et retombait EN SILENCE sur
  // libramont. Mesure en production : ?center=gembloux rendait 200 avec le
  // catalogue et les PRIX de Libramont, sans une erreur. Le tunnel envoie bien
  // centerId, donc aucun visiteur n etait touche, mais embed.js met center=
  // dans l adresse du cadre : la premiere integration qui recopiait ce nom
  // servait les tarifs du mauvais client sans que rien ne rougisse. Un ecart
  // de tarif ne se voit sur aucun ecran, seulement en caisse.
  // Les deux noms sont desormais lus ici aussi, et un centre inconnu tombe sur
  // le meme 404 quel que soit le nom employe.
  const centerId = String(url.searchParams.get('centerId') || url.searchParams.get('center') || 'libramont');
  // Verdict DU JOUR. Parametre OPTIONNEL : sans date (ou date malformee), la
  // reponse est STRICTEMENT celle d'avant, cle 'day' absente. Aucune 400 : cet
  // endpoint est une surface de CONFIG, jamais l'autorite de reservation (c'est
  // api/public-availability). C'est aussi ce qui protege les 16 gates qui le
  // mockent avec center:null.
  const rawDate = String(url.searchParams.get('date') || '');
  const dayDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : '';
  // `calendar=N` (1 a 90) : les N prochains jours, chacun avec ses horaires,
  // sa fermeture et sa periode (ferie legal, conge scolaire). Cle ADDITIVE,
  // absente sans le parametre.
  const rawCalendar = Number(url.searchParams.get('calendar') || 0);
  const calendarDays = Number.isFinite(rawCalendar) ? Math.min(90, Math.max(0, Math.trunc(rawCalendar))) : 0;
  // `calendarFrom=YYYY-MM-DD` : le premier jour servi (au plus tot aujourd hui),
  // pour qu un calendrier par mois se demande mois par mois.
  const calendarFrom = calendarFromParam(url.searchParams.get('calendarFrom'));
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

  // CENTRE INCONNU : on le DIT, on ne prete pas le catalogue d'un autre.
  //
  // Avant le 2026-08-20, cet endpoint repondait 200 avec un catalogue de repli
  // pour n'importe quel identifiant : un slug invente et un centre absent
  // rendaient le meme corps, octet pour octet (6053 octets, laser game +
  // minigolf + plaine de jeux compris). Un site vitrine mal configure affichait
  // donc un tunnel complet aux couleurs de la plateforme, proposant des
  // activites que le centre n'a pas. Un formulaire absent vaut mieux qu'un
  // formulaire qui ment.
  //
  // Le cas « aucun centerId » ne change PAS : il retombe sur 'libramont' comme
  // depuis toujours, parce que la ligne d'installation historique du client en
  // production ne porte pas le parametre. Ce sont les identifiants INCONNUS qui
  // sont refuses.
  //
  // Les trois centres du fichier socle sont toujours resolus, meme base
  // indisponible (getCenter lit le cache fusionne) : un incident base ne peut
  // pas eteindre le tunnel de Fun Galaxy. Un centre qui n'existe QU'EN BASE,
  // lui, repond 404 tant que la base est muette, ce qui est le comportement
  // voulu : sans sa configuration, son tunnel ne peut rien dire de vrai.
  if (!center) {
    // L'identifiant est RENVOYE borne et nettoye : c'est une entree utilisateur,
    // elle ne repart jamais telle quelle, meme dans un corps JSON.
    sendError(res, 404, 'Centre inconnu.', { centerId: centerId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) });
    return;
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
  let calendar = null;
  if (center && (dayDate || calendarDays)) {
    // Le calendrier scolaire officiel se relit fail-soft (24 h par instance,
    // delai borne) : les horaires de vacances suivent l annee en cours sans
    // retaper la table. Un echec laisse la table statique faire foi.
    try { await refreshWalloniaSchoolHolidays(); } catch (error) { /* table statique */ }
    let blocks = [];
    try { blocks = await loadAvailabilityBlocks(getPool(), centerId); } catch (error) { blocks = []; }
    if (dayDate) {
      try { day = buildDayStatus(blocks, dayDate, center, centerId); } catch (error) { day = null; }
    }
    if (calendarDays) {
      try { calendar = buildCalendar(blocks, calendarDays, center, centerId, calendarFrom); } catch (error) { calendar = null; }
    }
  }

  sendJson(res, 200, {
    ok: true,
    today: todayStr(),
    // Le tunnel borne son champ date avec CE nombre : la limite n'est ecrite
    // qu'ici, le navigateur ne la redevine pas.
    bookingHorizonDays: BOOKING_HORIZON_DAYS,
    durationOptions: DURATION_OPTIONS,
    // Formules avec overrides catalogue appliques (prix/nom/retrait) pour ce
    // centre ; sans override, strictement identique a FORMULES.
    // `offerOff` : l interrupteur du staff (centers.settings.config
    // .offerAvailability), que seul le serveur connait. Cle ADDITIVE, posee
    // uniquement quand l offre est coupee : un formulaire qui ne la lit pas se
    // comporte comme avant.
    formules: formulesPubliques(centerId, center),
    laserOptions: LASER_GAME_OPTIONS,
    bowlingPrices: BOWLING_PRICES,
    // La grille du Fun Run (sessions de 15 et 30 min), cle ADDITIVE : le
    // formulaire Fun Galaxy affiche « des X EUR / session » depuis cette
    // grille au lieu de recopier le montant, qui n aurait alors deux verites.
    funRunOptions: FUN_RUN_OPTIONS,
    // Ce que CE centre vend, planifie ou non, avec son tarif quand il est saisi.
    // Cle ADDITIVE : un centre inconnu ou pas encore configure rend bowling +
    // laser, c'est-a-dire exactement le tunnel d'avant.
    // L AGE d une activite (« 4 à 12 ans » pour la plaine de jeux) est une
    // donnee du CENTRE, la meme que lit l agent (activityThemes) : une seule
    // source, jamais recopiee dans le catalogue partage. Cle ajoutee seulement
    // quand le centre la declare.
    activities: activitesPubliques(centerId, center),
    center: center
      ? {
        id: center.id,
        // L'IDENTITE du centre sur le tunnel : nom d'onglet, ville du
        // sous-titre, logo et liens de navigation. index.html est neutre :
        // sans ces donnees, le tunnel reste Pinlane, il n'affiche jamais
        // l'identite d'un autre centre.
        name: typeof center.name === 'string' ? center.name : '',
        city: centerPublicInfo && typeof centerPublicInfo.city === 'string' ? centerPublicInfo.city : '',
        identity: normalizeIdentity(center.identity),
        status: center.status || 'active',
        // CE CENTRE EST-IL UNE DEMONSTRATION ? Le tunnel doit pouvoir le DIRE
        // au visiteur, et le dire AVANT qu il remplisse le formulaire : la
        // porte d ecriture refuse la demonstration, donc sans cette annonce
        // il decouvrirait le refus a la derniere seconde. Booleen strict : un
        // centre ordinaire rend `false`, jamais `undefined`, pour qu un client
        // ne prenne pas l absence d information pour une reponse.
        demonstration: center.demonstration === true,
        contact: centerContact,
        // LA DEMANDE SUR MESURE : a partir de `fromPax` personnes, le groupe
        // ne se reserve plus en ligne, il envoie une demande que l equipe
        // traite (null = jamais). Reglee dans Etablissement, relue ici a
        // chaque lecture du catalogue.
        customRequest: { fromPax: customRequestFromPax(center) },
        // La MARQUE du centre (couleurs du tunnel). Bornee ici, comme partout :
        // quatre jetons hexadecimaux par theme, tout le reste est jete. null =
        // ce centre n'a pas de marque, le tunnel garde l'accent plateforme.
        branding: normalizeBranding(center.branding),
        defaultSchedule: center.defaultSchedule && typeof center.defaultSchedule === 'object' ? center.defaultSchedule : null,
        holidaySettings: center.holidaySettings && typeof center.holidaySettings === 'object'
          ? center.holidaySettings
          : { enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] },
        offerAvailability: center.offerAvailability && typeof center.offerAvailability === 'object' ? center.offerAvailability : {},
        // CE QUE LE CENTRE POSSEDE, ingredients compris (table anniversaire,
        // plaine de jeux...), et pas seulement ce qu'il vend a la carte. Une
        // formule qui exige un ingredient absent ne peut pas etre planifiee :
        // le moteur rend zero creneau et le client se retrouve devant une liste
        // vide APRES avoir choisi la carte. Mesure du 2026-08-22 : f6, f7 et f8
        // a Gembloux (playground et party_table absents), sur toutes les dates
        // testees et toutes les tailles de groupe.
        activityAvailability: center.activityAvailability && typeof center.activityAvailability === 'object' ? center.activityAvailability : null,
        booking: {
          laneCount: bowlingCapacity.laneCount,
          normalCapacityPerLane: bowlingCapacity.normalCapacityPerLane,
          emergencyCapacityPerLane: bowlingCapacity.emergencyCapacityPerLane,
          bowlingPrices: BOWLING_PRICES,
          laserOptions: LASER_GAME_OPTIONS,
          // LES POSTES DE L ARENE, declares par le centre. Sans cette cle, le
          // tunnel retombait sur une constante de 30 : juste a Libramont par
          // coincidence, FAUX a Gembloux qui en a 20 (25 joueurs y jouent en
          // deux sessions, le tunnel en annoncait une). Meme regle que
          // `laneCount` juste au-dessus : la capacite est une donnee du centre.
          laserArenaCapacity: Math.max(0, Math.trunc(Number(center?.resources?.laser?.weaponCount) || 0)) || null,
          // Les lancements qui tournent en meme temps, meme regle : Gembloux en
          // declare six, la console en supposait un et refusait le deuxieme
          // groupe d un creneau que le moteur acceptait. Cle lue par tous les
          // roles, y compris ceux qui n ont pas la configuration staff.
          laserParallelLaunches: Math.max(0, Math.trunc(Number(center?.resources?.laser?.parallelLaunches) || 0)) || null,
          // Cle ADDITIVE : presente uniquement quand le centre vend le bowling
          // AUX PARTIES, par personne (N4 Bowling). Absente, le tunnel garde la
          // grille par piste et par duree, exactement comme avant.
          ...(center?.resources?.bowling?.pricing
            ? {
              // Le tunnel recoit le TARIF, pas une liste toute faite : la duree
              // d'une partie depend du nombre de joueurs, que seul le tunnel
              // connait a l'instant ou il l'affiche. Servir une liste calculee
              // sans le groupe creerait une deuxieme verite, fausse des que le
              // client change son effectif.
              bowlingPricing: center.resources.bowling.pricing,
            }
            : {}),
        },
        // Cle ADDITIVE, presente uniquement quand une date valide est demandee.
        ...(day ? { day } : {}),
        // Cle ADDITIVE, presente uniquement avec `calendar=N`.
        ...(calendar ? { calendar } : {}),
      }
      : null,
  });
};

// Les N prochains jours, chacun avec son verdict (buildDayStatus) et sa
// periode. Le libelle de periode vient du calendrier (ferie legal, conge
// scolaire FWB, jour force par le centre), jamais du texte libre du staff.
// Le premier jour demande, s il est un VRAI jour entre 2000 et 2099 : le 31
// fevrier est refuse (Date.parse le decalait au 3 mars), tout le reste aussi.
// Refuse, il vaut '' et le calendrier part d aujourd hui.
function calendarFromParam(raw) {
  const texte = String(raw || '');
  const m = /^(20[0-9]{2})-([0-9]{2})-([0-9]{2})$/.exec(texte);
  if (!m) return '';
  const jour = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return jour.toISOString().slice(0, 10) === texte ? texte : '';
}

function buildCalendar(blocks, days, center, centerId, from = '') {
  // Jamais avant aujourd hui : un jour passe n a pas de verdict utile.
  const today = todayStr();
  const depart = from && from > today ? from : today;
  const [y, m, d] = depart.split('-').map(Number);
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const jour = new Date(Date.UTC(y, m - 1, d + i));
    const date = jour.toISOString().slice(0, 10);
    const status = buildDayStatus(blocks, date, center, centerId);
    const context = getHolidayContext(date, center);
    out.push({
      date,
      weekday: jour.getUTCDay(),
      open: status.open,
      schedule: status.schedule,
      closedLabel: status.closedLabel,
      // La journee finie se dit a part : le formulaire la nomme (« la
      // journee est finie »), pas comme un jour de fermeture.
      ...(status.over ? { over: true } : {}),
      closedWindows: status.closedWindows,
      holiday: context.active ? { type: context.periodType, label: context.label } : null,
      unavailableActivityIds: status.unavailableActivityIds,
      unavailableFormulaIds: status.unavailableFormulaIds,
      formulaHolidayOff: status.formulaHolidayOff,
    });
  }
  return out;
}

// Expose pour les gates (scripts/availability-day-check.js,
// scripts/wallonia-calendar-check.js, le mock du serveur de dev) : le verdict
// se teste unitairement, sans reseau ni base.
module.exports.__test = { buildDayStatus, buildCalendar, calendarFromParam, formulesPubliques, activitesPubliques, gestesVitrine };

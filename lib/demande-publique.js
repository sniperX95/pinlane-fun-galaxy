// LES PORTES D UNE DEMANDE PUBLIQUE, communes a la reservation
// (api/public-reservations) et au blocage des horaires choisis
// (api/public-holds, migration 0049). Un blocage ne doit jamais passer la ou
// la reservation serait refusee : les deux lisent donc les memes portes, dans
// le meme ordre, avec les memes messages. Deplacees ici telles quelles depuis
// api/public-reservations.js (2026-09-29) ; le pourquoi de chacune reste a
// cote d elle.
const { getPool } = require('./database');
const { refreshFormuleOverrides, bookingDateOutOfRange, BOOKING_HORIZON_DAYS } = require('./booking-config');
const { refreshCatalog } = require('./catalog-store');
const { getCenter, refreshCenterOverrides, publicBookingBlockReason } = require('./ops-knowledge');
const { customRequestFromPax } = require('./center-config');

// Rend { ok: true, center } ou { ok: false, status, message, extra }.
async function ouvrirDemandePublique(body) {
  // Un POST sans centre ne retombe plus sur 'libramont' : chaque ecriture
  // nomme son centre. Le tunnel l'envoie TOUJOURS (prouve par execution,
  // pire cas mesure = 'libramont' explicite) : ce 422 ne peut toucher qu'un
  // appel forge ou un integrateur incomplet, jamais le parcours reel.
  if (!String((body && (body.centerId || body.center_id)) || '').trim()) {
    return { ok: false, status: 422, message: 'Centre manquant : precisez le centre de la reservation.' };
  }
  // La date est bornee AVANT tout le reste : ni le champ du tunnel ni le
  // moteur n'avaient de limite haute, une reservation a deux ans passait.
  const dateVerdict = bookingDateOutOfRange(body && body.date);
  if (dateVerdict === 'invalid') {
    return { ok: false, status: 422, message: 'Date invalide. Choisissez une date du calendrier.' };
  }
  if (dateVerdict === 'past') {
    return { ok: false, status: 422, message: 'Cette date est déjà passée. Choisissez une date à venir.' };
  }
  if (dateVerdict === 'far') {
    return { ok: false, status: 422, message: `Les réservations sont ouvertes jusqu'à ${BOOKING_HORIZON_DAYS} jours à l'avance. Choisissez une date plus proche.` };
  }
  // Overrides de CENTRE chauds AVANT tout le reste (sync). Un centre cree
  // depuis la console n'existe QUE en base : sans cette ligne, une instance
  // serverless fraiche ne connait que les centres du FICHIER
  // ops-knowledge/centers.json. getCenter leve alors « Centre inconnu », le
  // centre n'a ni pistes ni activites cochees, et AUCUNE de ses reservations
  // ne passe : 422 « Choisissez au moins une activite » quand le client a
  // choisi une activite libre (listCenterActivities ne la garde que si le
  // centre l'a cochee), 409 sans alternatives quand il a choisi le bowling.
  // Les creneaux, eux, s'affichaient : public-availability et
  // public-booking-meta font cet appel depuis le debut, pas ce handler.
  // Fail-soft comme les deux suivantes : sans base, socle fichier.
  try { await refreshCenterOverrides(getPool()); } catch (error) { /* socle fichier */ }
  // Le centre se resout comme l'ecriture le fera (centerId ou center_id,
  // espaces retires). La garde lisait body.centerId seul : un POST en
  // center_id retombait sur 'libramont' (le defaut de getCenter), et le refus
  // du centre en preparation ne tombait jamais.
  const requestedCenterId = String((body && (body.centerId || body.center_id)) || '').trim();
  // CENTRE INCONNU, apres le rechauffage : le meme 404 que la lecture. Avant
  // le 2026-09-14, un identifiant invente traversait jusqu'au planificateur
  // et repartait en 409 « choisissez un autre horaire », pour un centre qui
  // n'existe pas.
  let requestedCenter = null;
  try { requestedCenter = getCenter(requestedCenterId); } catch (error) { requestedCenter = null; }
  if (!requestedCenter) {
    return { ok: false, status: 404, message: 'Centre inconnu.' };
  }
  // LA DEMONSTRATION N ECRIT RIEN. Le centre de demonstration sert le
  // formulaire de Pinlane sur `/reserver` quand l adresse ne nomme aucun
  // locataire. Son statut est `active`, donc le controle juste en dessous
  // le laisserait passer : une soumission creerait une reservation sur un
  // centre que personne n exploite, et enverrait a une vraie personne un
  // message disant que sa venue est confirmee dans un lieu qui n existe
  // pas. La garde est ICI parce que c est ici qu on ecrit : quoi que fasse
  // le navigateur, rien ne part.
  //
  // C est la DONNEE qui le declare (`demonstration: true` dans le registre
  // des centres), pas un identifiant recopie ici : un deuxieme centre de
  // demonstration serait couvert sans toucher a cette ligne.
  if (requestedCenter && requestedCenter.demonstration === true) {
    return { ok: false, status: 422, message: 'Ce formulaire est la démonstration de Pinlane, et rien n\'y est enregistré. Pour réserver dans un centre, passez par l\'adresse de ce centre.' };
  }
  // Le statut du centre est lu APRES le rechauffage des overrides ci-dessus :
  // un centre ne dans la console n'existe qu'en base, son statut avec lui.
  // Jusqu'au 2026-09-14 le code le lisait avant, malgre ce commentaire : une
  // instance froide croyait le centre inconnu, et son refus ne tombait pas.
  const centerBlock = publicBookingBlockReason(requestedCenterId);
  if (centerBlock) {
    return { ok: false, status: 422, message: centerBlock };
  }
  // LES GRANDS GROUPES PASSENT PAR UNE DEMANDE SUR MESURE (2026-09-28).
  // Movsar : « tout groupe superieur a 30 donc a partir 31 tout groupe sera
  // redirige vers une demande sur mesure ». Le seuil est une donnee du
  // centre (customRequest.fromPax, reglee dans Etablissement) ; le groupe
  // compte TOUT le monde, les accompagnants d une offre pour enfants
  // compris. Le formulaire oriente deja vers la demande : ce refus ne tombe
  // que sur une page restee ouverte pendant que le centre changeait son
  // seuil, ou sur un appel forge. Le code permet a l ecran d ouvrir la demande.
  const seuilSurMesure = customRequestFromPax(requestedCenter);
  const effectif = Math.max(0, Math.trunc(Number(body && body.pax) || 0))
    + Math.max(0, Math.trunc(Number(body && body.companions) || 0));
  if (seuilSurMesure && effectif >= seuilSurMesure) {
    return {
      ok: false,
      status: 422,
      message: `À partir de ${seuilSurMesure} personnes, votre venue se prépare avec l’équipe : faites une demande sur mesure, réponse sous 24 heures ouvrables.`,
      extra: { code: 'custom_request_required', fromPax: seuilSurMesure },
    };
  }
  // Carte d'overrides catalogue chaude AVANT le calcul du prix (sync) : une
  // instance serverless fraiche doit facturer le meme prix que celui affiche
  // par le tunnel (public-booking-meta). Fail-soft : sans base, prix fichier.
  try { await refreshFormuleOverrides(getPool()); } catch (error) { /* prix fichier */ }
  // Catalogue unifie chaud AVANT le calcul de prix et l'ancrage (sync). Meme
  // instance serverless fraiche facture / ancre comme le tunnel. Fail-soft.
  try { await refreshCatalog(getPool()); } catch (error) { /* catalogue fichier */ }
  return { ok: true, center: requestedCenter };
}

// Les erreurs d infrastructure (Postgres/Neon/reseau) ne fuient jamais vers le
// public : meme liste que la reservation.
function estErreurInfra(error) {
  const raw = String((error && error.message) || '');
  return !raw || /tuple concurrently|data transfer quota|ECONNREFUSED|ETIMEDOUT|terminating connection|too many clients|Connection terminated|relation .* does not exist|column .* does not exist|SQLSTATE|deadlock|current transaction is aborted/i.test(raw);
}

// CE QUE LE CLIENT DEMANDE, sans ce qui ne touche pas au planning (ses
// coordonnees, les prix). Un blocage et la confirmation qui le suit portent
// la meme signature quand le client confirme exactement ce qu il a retenu :
// la confirmation reprend alors le plan et les pistes que le blocage lui
// gardait (lib/database planDuBlocage). Calculee sur la demande NORMALISEE,
// par la meme fonction des deux cotes.
function signatureDemande(request) {
  const r = request || {};
  const pref = r.preference && typeof r.preference === 'object' ? r.preference : {};
  const heures = pref.preferredTimes && typeof pref.preferredTimes === 'object' ? pref.preferredTimes : {};
  const items = (r.program && Array.isArray(r.program.items) ? r.program.items : [])
    .map((it) => [it.activityId, it.duration, it.games, it.minutes, it.units, it.hours, it.participants, it.waitOffer === true, it.arcadeMode, it.arcadeOfferId, it.cards, it.upsell?.offerId, it.extraLaser?.offerId, it.extraLaser?.participants, it.extraLaser?.games]
      .map((v) => (v === undefined ? null : v)));
  return JSON.stringify([
    r.centerId || '', r.date || '', r.startTime || '', r.type || '', r.formuleId || '',
    Number(r.pax) || 0, Number(r.companions) || 0, items,
    Object.keys(heures).sort().map((k) => [k, heures[k] || '']),
    Array.isArray(pref.laserGameTimes) ? pref.laserGameTimes : [],
    pref.laserPlacement || '',
  ]);
}

function requestFromHeldUpsell(body, held, options = {}) {
  if (!held?.signatureDemande || !held?.program?.items?.length) return null;
  const raw = Array.isArray(body.program) ? body.program : body.program?.items;
  if (!Array.isArray(raw) || raw.length !== held.program.items.length) return null;
  const stripped = raw.map(({ upsell, extraLaser, ...item }) => item);
  const request = require('./reservation-request').normalizeReservationRequest({ ...body, program: stripped }, { channel: 'public', ...options });
  if (request.program.items.length !== held.program.items.length) return null;
  for (const saved of held.program.items) {
    const entered = raw.find(i => (i.activityId || i.id) === saved.activityId);
    const normalized = request.program.items.find(i => i.activityId === saved.activityId);
    if (!entered || !normalized) return null;
    for (const key of ['duration', 'games', 'units', 'hours', 'participants', 'sessionMinutes', 'arcadeMode', 'arcadeOfferId', 'cards', 'waitOffer']) {
      if ((normalized[key] ?? null) !== (saved[key] ?? null)) return null;
    }
    for (const key of ['upsell', 'extraLaser']) {
      const expected = saved[key]; const supplied = entered[key];
      if (Boolean(expected) !== Boolean(supplied)) return null;
      if (expected && (String(supplied.offerId || '') !== String(expected.offerId || '') || Number(supplied.participants) !== expected.participants || (key === 'extraLaser' && Number(supplied.games) !== expected.games))) return null;
    }
  }
  request.program = held.program;
  if (signatureDemande(request) !== held.signatureDemande) return null;
  request.programPrice = held.program.price;
  request.price = held.price; request.basePrice = held.basePrice;
  const laser = held.program.items.find(i => i.activityId === 'laser_game');
  if (laser) request.laserGames = request.games = request.gameCount = Number(laser.extraLaser?.games || laser.games);
  request.totalDuration = held.totalDuration ?? request.totalDuration;
  return request;
}

module.exports = { ouvrirDemandePublique, estErreurInfra, signatureDemande, requestFromHeldUpsell };

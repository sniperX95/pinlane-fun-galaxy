// LES EXTRAS DU COMPTOIR RESTENT DANS LE PRIX QUAND AUCUN PRIX N EST ENVOYE
// (gate ne le 2026-10-08, defaut S9 releve par le coordinateur et confirme ici).
//
// Le defaut : une visite du comptoir (bowling 1 h + minigolf, 4 joueurs) avec
// « Pizza × 2 » a 20 EUR et AUCUN prix envoye partait a 39 EUR : la
// normalisation posait price = reference (39), puis renormalizeVisitProgram
// voyait 39 different de base + extras (59) et le prenait pour un prix SAISI.
// Or la fiche et la caisse facturent `price` seul et comptent la reference
// comme base + extras (assets/app-main.js : getReservationPriceState ~22080,
// renderGroupeAddition ~25371, renderPosCaisse ~26164, avecSupplements
// ~27255) : les 20 EUR disparaissaient de l addition, et l ecran affichait
// « Prix ajusté » sur un dossier que personne n avait touche.
//   [1] visite sans prix : price = reference + extras (59), et la regle de la
//       console ne voit aucun ajustement ; aucun double comptage ;
//   [2] un prix envoye reste tel quel, 0 compris (un geste) ; null et ''
//       disent « aucun prix », pas « offert » ;
//   [3] le meme chemin pour une activite libre seule (type 'activite') ;
//   [4] a la creation, bowling seul et laser seul sans prix : reference +
//       extras, au lieu de 0 EUR en base ;
//   [5] une modification qui replanifie une visite sans renvoyer de prix
//       garde ses extras ;
//   [6] contre-preuves par mutation.
// Lancement : node scripts/reserver-prix-extras-check.js
'use strict';
const path = require('path');
const B = require('./reserver-banc.js');

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const URL_RESA = '/api/staff-reservations';
const PIZZA = [{ name: 'Pizza × 2', price: 20 }];
const VISITE = (extra = {}) => B.corpsStaff({ type: 'visite', pax: 4, startTime: '15:00', extras: PIZZA,
  program: [{ activityId: 'bowling', duration: 1, participants: 4 }, { activityId: 'minigolf_blacklight', participants: 4 }],
  preference: { preferredTimes: { bowling: '15:00' } }, ...extra });

// La regle d affichage de la console, recopiee (getReservationPriceState,
// assets/app-main.js) : reference = base + extras, « ajuste » si la base est
// ecrite et que le prix s en ecarte de plus de 0,50 EUR. Le total facture est
// `price` seul (renderGroupeAddition, renderPosCaisse).
function vueConsole(r) {
  const extras = (r.extras || []).reduce((s, e) => s + (Number(e.price) || 0), 0);
  const base = r.basePrice === null || r.basePrice === undefined || r.basePrice === '' ? null : Number(r.basePrice);
  const reference = (base || 0) + extras;
  const ecart = (Number(r.price) || 0) - reference;
  return { total: Number(r.price) || 0, reference, ajuste: base !== null && base > 0 && Math.abs(ecart) > 0.5 };
}

async function scenario(mutations = []) {
  B.semer([]);
  const m = B.monter({ mutations });
  const f = {};
  const creer = async (corps) => {
    const r = await m.appeler('POST', URL_RESA, corps);
    const res = r.json.reservation || {};
    return { statut: r.statut, price: res.price, basePrice: res.basePrice, extras: (res.extras || []).map((e) => e.price), type: res.type, brut: res, message: r.json.message };
  };
  f.sansPrix = await creer(VISITE());
  f.zero = await creer(VISITE({ startTime: '16:00', preference: { preferredTimes: { bowling: '16:00' } }, price: 0 }));
  f.cinquante = await creer(VISITE({ startTime: '17:00', preference: { preferredTimes: { bowling: '17:00' } }, price: 50 }));
  f.nul = await creer(VISITE({ startTime: '18:00', preference: { preferredTimes: { bowling: '18:00' } }, price: null }));
  f.vide = await creer(VISITE({ startTime: '19:00', preference: { preferredTimes: { bowling: '19:00' } }, price: '' }));
  f.activite = await creer(B.corpsStaff({ type: 'visite', pax: 4, startTime: '15:00', extras: PIZZA, program: [{ activityId: 'minigolf_blacklight', participants: 4 }] }));
  f.bowling = await creer(B.corpsStaff({ type: 'bowling', pax: 4, startTime: '20:00', duration: 1, totalDuration: 1, lanes: [], laneCount: 1, extras: PIZZA }));
  f.laser = await creer(B.corpsStaff({ type: 'laser', pax: 4, startTime: '15:00', laserGames: 3, duration: 1.5, extras: PIZZA }));
  // [5] Une modification qui replanifie (heure changee) sans renvoyer de prix :
  // le chemin du PATCH (prix retire de la demande, moteur avec
  // ignoreReservationId), sur le dossier tel qu il est en base.
  const { prepareReservationOps } = require(path.join(B.ROOT, 'lib/reservation-ops.js'));
  const enBase = f.sansPrix.brut;
  const demande = { ...enBase, startTime: '16:30', preference: { preferredTimes: { bowling: '16:30' } } };
  delete demande.price;
  const ops = await prepareReservationOps(demande, 'staff', { ignoreReservationId: enBase.id, readState: async () => ({ reservations: [], laneStatuses: {} }) });
  f.modification = `${ops.basePrice}|${ops.price}`;
  return f;
}

function verifier(f, afficher = true) {
  const notes = [];
  const v = (cond, label) => notes.push([Boolean(cond), label]);
  const vue = vueConsole(f.sansPrix.brut);
  v(f.sansPrix.statut === 201 && f.sansPrix.basePrice === 39 && f.sansPrix.price === 59 && JSON.stringify(f.sansPrix.extras) === '[20]',
    `[1] visite sans prix : base ${f.sansPrix.basePrice}, prix ${f.sansPrix.price}, extras ${JSON.stringify(f.sansPrix.extras)}`);
  v(vue.total === 59 && vue.reference === 59 && vue.ajuste === false,
    `[1] la console facture 59, reference 59, aucun « Prix ajusté » (total ${vue.total}, reference ${vue.reference}, ajuste ${vue.ajuste})`);
  v(f.zero.price === 0 && vueConsole(f.zero.brut).ajuste === true, `[2] un 0 envoye reste un geste (prix ${f.zero.price}, affiche ajuste)`);
  v(f.cinquante.price === 50, `[2] un prix envoye reste tel quel (${f.cinquante.price})`);
  v(f.nul.price === 59 && f.vide.price === 59, `[2] null et '' disent « aucun prix », pas « offert » (${f.nul.price}, ${f.vide.price})`);
  v(f.activite.statut === 201 && f.activite.type === 'activite' && f.activite.price === 20 && f.activite.basePrice === 0,
    `[3] activite libre seule (minigolf, tarif au comptoir) : le meme chemin, les extras restent (${f.activite.type}, base ${f.activite.basePrice}, prix ${f.activite.price})`);
  v(f.bowling.statut === 201 && f.bowling.basePrice === 39 && f.bowling.price === 59, `[4] bowling seul sans prix : ${f.bowling.basePrice} + 20 = ${f.bowling.price} (au lieu de 0 en base)`);
  v(f.laser.statut === 201 && f.laser.basePrice === 100 && f.laser.price === 120, `[4] laser seul sans prix : ${f.laser.basePrice} + 20 = ${f.laser.price}`);
  v(f.modification === '39|59', `[5] une modification sans prix garde les extras (base|prix ${f.modification})`);
  if (afficher) notes.forEach(([cond, label]) => ok(cond, label));
  return notes;
}

async function contrePreuve(nom, mutation, attendu) {
  let rouges = [];
  try {
    rouges = verifier(await scenario([mutation]), false).filter(([cond]) => !cond).map(([, l]) => l);
  } catch (error) {
    ok(!/ancre absente/.test(error.message), `contre-preuve « ${nom} » : le gate ROUGIT`, `exception : ${error.message.slice(0, 160)}`);
    return;
  }
  const trouve = rouges.find((l) => attendu.test(l));
  ok(Boolean(trouve), `contre-preuve « ${nom} » : le gate ROUGIT`, (trouve || `aucune attendue, ${rouges.length} rouge(s) : ${rouges[0] || ''}`).slice(0, 170));
}

(async () => {
  try {
    console.log('\n[1-5] LES EXTRAS DANS LE PRIX');
    verifier(await scenario());
    console.log('\n[6] CONTRE-PREUVES PAR MUTATION');
    await contrePreuve('sans prix envoye, la visite repart a la reference seule',
      { fichier: 'lib/reservation-request.js', de: '      request.price = envoye !== null ? envoye : prixAvecExtras(referencePrice, request.extras);', vers: '      request.price = envoye !== null ? envoye : referencePrice;' },
      /\[1\] visite sans prix/);
    await contrePreuve('la creation sans prix oublie les extras',
      { fichier: 'lib/reservation-ops.js', de: '    request.price = prixAvecExtras(request.basePrice, request.extras);', vers: '    request.price = Number(request.basePrice) || 0;' },
      /\[4\] bowling seul sans prix/);
    await contrePreuve('null redevient un prix envoye',
      { fichier: 'lib/reservation-request.js', de: "  if (valeur === undefined || valeur === null || valeur === '') return null;", vers: '  if (valeur === undefined) return null;' },
      /\[2\] null et ''/);
  } catch (error) {
    console.error('\nreserver-prix-extras-check ERREUR', error.stack || error.message);
    failures += 1;
  }
  B.sortir('reserver-prix-extras-check', failures, 'sans prix envoye, un dossier du comptoir vaut sa reference plus ses extras, et un prix envoye reste.');
})();

// LES RETOURS DE MOVSAR DU 2026-09-30 SUR LE FORMULAIRE, PROUVES UN PAR UN.
//
//   [A] « comment ca 4 personnes attendent, c est mal calcule » : 4 personnes,
//       laser 2 parties a 16:30 et 18:30, bowling entre les deux ; l ecran
//       disait « 4 personnes attendent 2 h leur tour » et proposait des
//       arcades « pendant l attente ». Deux PARTIES rejouent le groupe entier,
//       seules les VAGUES d une meme partie font attendre quelqu un.
//   [B] « pq il dit serre a cause du laser alors que c une formule avec plein
//       d activites » : FORMULE 2 a 19:30 disait « plus le temps pour les
//       parties de laser restantes » ; la formule entiere finit a 22:10. Et
//       FORMULE 4 disait bowling 19:30 serre, 20:00 libre (la reservation de
//       19:30 posait deja le laser a 18:30, sans avertissement).
//   [C] « une partie dure 20 minutes, on dit 25 min pour les enregistrer et
//       expliquer les regles ; cote SaaS 25-30 min » : le catalogue public
//       sert le jeu (20), le creneau (25) et le pas des departs (30).
//   [D] « le billard juste un compteur, jusqu a 5 max de table » : 5 au plus
//       par reservation EN LIGNE, refuse au-dela par le serveur ; le comptoir
//       vend toute la dotation, et un corps forge « staff » ne contourne rien.
//   [E] « playground un compteur de nombre d enfants » : la plaine se paie
//       pour les enfants comptes.
//   [F] « mettre le temps que ca dure chaque formule » : la duree servie pour
//       les cartes est celle du recapitulatif (de l arrivee a la fin).
//   [G] les offres par e-mail (RGPD) : la case cochee retire l adresse du
//       marketing du centre, dans la transaction de la reservation ; une
//       nouvelle reservation sans la case leve un retrait pose par la case,
//       jamais un retrait par lien ; une surface sans la case ne decide rien.
//
// CONTRE-EPREUVE (--mutate) : chaque correctif est retire EN MEMOIRE au
// chargement de son module, et le gate doit rougir. Le disque n est jamais
// ecrit, et on le verifie.
//
// Lancement : node scripts/formulaire-retours-check.js [--mutate]
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
// LE JOUR SUIT LE CALENDRIER (2026-10-07). Il etait ecrit en dur
// (« 2026-10-07 ») : le jour meme, passe 16 h, les heures de 16:30 et 18:30
// des scenarios etaient deja passees, et le lendemain la date entiere. C est
// le prochain mercredi, a partir de demain, ou le centre ouvre de 12:00 a
// 22:00 (les scenarios en dependent : la fermeture, ce qui deborde), lu dans
// son horaire reel. Calcule dans main(), apres le crochet des contre-epreuves.
let JOUR = '';
function prochainMercredi() {
  const { getSchedule } = require('../lib/booking-config');
  const centre = require('../lib/ops-knowledge').getCenter('libramont');
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  for (let k = 0; k < 120; k += 1) {
    c.setUTCDate(c.getUTCDate() + 1);
    const jour = c.toISOString().slice(0, 10);
    const h = c.getUTCDay() === 3 ? getSchedule(jour, centre) : null;
    if (h && Number(h.open) === 12 && Number(h.close) === 22) return jour;
  }
  throw new Error('aucun mercredi ouvert de 12:00 a 22:00 dans les 120 prochains jours');
}

const MUTATIONS = [
  {
    nom: 'l attente se lit par activite : deux parties redeviennent deux vagues',
    fichier: 'lib/ops-engine.js',
    de: "      const partie = `${String(bloc.activityId || bloc.resourceType || '')}#${Number(bloc.countIndex) || 1}`;",
    vers: "      const partie = String(bloc.activityId || bloc.resourceType || '');",
  },
  {
    nom: 'le debordement d une formule redevient celui des parties de laser',
    fichier: 'lib/ops-engine.js',
    de: '    const seules = !autreChoseDeLibre && partiesSansHeure.length > 0;',
    vers: '    const seules = partiesSansHeure.length > 0;',
  },
  {
    nom: 'une place collee avertie arrete la recherche (bowling 19:30 serre, 20:00 libre)',
    fichier: 'lib/ops-engine.js',
    de: "  {\n    for (const arrangement of plusLoinEssais) {",
    vers: "  if (!avertie) {\n    for (const arrangement of plusLoinEssais) {",
  },
  {
    nom: 'le catalogue public ne sert plus la duree de jeu du laser',
    fichier: 'api/public-booking-meta.js',
    de: "    if (activity.id === 'laser_game' && Number.isFinite(jeu) && jeu >= 5 && jeu < LASER_GAME_ARENA_MINUTES) {",
    vers: "    if (false) {",
  },
  {
    nom: 'le serveur ne tient plus le plafond de tables par reservation',
    fichier: 'lib/visit-program.js',
    de: '        if (publicBooking && plafond > 0 && demandees > plafond) {',
    vers: '        if (false) {',
  },
  {
    nom: 'le plafond du formulaire s impose aussi au comptoir',
    fichier: 'lib/visit-program.js',
    de: '        if (publicBooking && plafond > 0 && demandees > plafond) {',
    vers: '        if (plafond > 0 && demandees > plafond) {',
  },
  {
    nom: 'le plafond lit le canal du corps de la demande (forgeable)',
    fichier: 'lib/reservation-request.js',
    // Re-ancree le 2026-10-19 : depuis 4ffd266 l appel porte aussi le canal
    // du comptoir (staff) ; l ancre d avant ne se trouvait plus.
    de: '    applyProgram(request, { publicBooking: isPublicChannel(options), staff: isStaffChannel(options) });',
    vers: "    applyProgram(request, { publicBooking: request.channel === 'public', staff: isStaffChannel(options) });",
  },
  {
    nom: 'la plaine se paie de nouveau pour tout le groupe',
    fichier: 'lib/visit-program.js',
    // Le compte par activite (2026-10-03) a remplace l ancienne ligne : la
    // mutation vise celle qui decide aujourd hui des joueurs de la ligne.
    de: '    const players = declaredParticipants == null ? people : Number(declaredParticipants);',
    vers: '    const players = people;',
  },
  {
    nom: 'la duree des cartes compte la marge de l equipe',
    fichier: 'lib/availability-slots.js',
    // Re-ancree le 2026-10-19 : depuis 5de2e61 la duree part de l accueil
    // standard (accueilStandard), plus de l heure d arrivee brute.
    de: '    .map((a) => enMinutes(a.endTime) - Math.max(0, Number(a.bufferMinutes) || 0) - accueilStandard(a))',
    vers: '    .map((a) => enMinutes(a.endTime) - accueilStandard(a))',
  },
  {
    nom: 'une reservation sans la case leve aussi un retrait par lien',
    fichier: 'lib/marketing-suppression.js',
    de: "     where center_id = $1 and lower(email) = $2 and source = 'form'\n     returning id;`,",
    vers: '     where center_id = $1 and lower(email) = $2\n     returning id;`,',
  },
  {
    nom: 'la reservation n applique plus le choix des offres',
    fichier: 'lib/database.js',
    de: "    if (input.choixOffres && typeof input.choixOffres.refuse === 'boolean' && payload.email) {",
    vers: '    if (false) {',
  },
];
const MUTATION_PREUVE = '[mutation] servie en memoire :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_RETOURS_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
function muter(contenu, mutation) {
  const texte = contenu.split(CRLF).join(LF);
  if (texte.split(mutation.de).length - 1 !== 1) {
    console.error(`mutation impossible : ancre absente ou multiple dans ${mutation.fichier} : ${mutation.de.slice(0, 70)}`);
    process.exit(2);
  }
  console.log(`${MUTATION_PREUVE} ${mutation.nom}`);
  return texte.split(mutation.de).join(mutation.vers);
}
// Le crochet est pose AVANT tout require applicatif : sinon le module serait
// deja compile quand il mordrait.
if (MUTATION) {
  const Module = require('module');
  const compile = Module.prototype._compile;
  const cible = path.resolve(ROOT, MUTATION.fichier);
  Module.prototype._compile = function (contenu, nom) {
    if (path.resolve(nom) === cible) return compile.call(this, muter(contenu, MUTATION), nom);
    return compile.call(this, contenu, nom);
  };
}

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
function section(titre) { console.log(`\n${titre}`); }

// Journee vide, sans base : le vrai handler des heures et le vrai catalogue.
const database = require('../lib/database');
database.readAvailabilitySnapshot = async (date, centerId) => ({ reservations: [], laneStatuses: {}, blocks: [], date, centerId });
database.readStaffState = database.readAvailabilitySnapshot;
const dispo = require('../api/public-availability');
const meta = require('../api/public-booking-meta');

let ip = 0;
async function appel(handler, parametres) {
  ip += 1;
  const adresse = `10.3.${ip % 250}.${1 + (ip % 200)}`;
  const req = { method: 'GET', url: `${parametres.chemin}?${new URLSearchParams(parametres.q).toString()}`, headers: { host: 'localhost', 'x-forwarded-for': adresse }, socket: { remoteAddress: adresse } };
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.getHeader = (k) => res.headers[k];
  res.writeHead = (code) => { res.statusCode = code; };
  res.end = (b) => { res.body = b === undefined ? '' : String(b); };
  await handler(req, res);
  try { return JSON.parse(res.body || '{}'); } catch (error) { return {}; }
}
const heures = (o) => appel(dispo, { chemin: '/api/public-availability', q: { centerId: 'libramont', date: JOUR, ...o } });
const piste = (rep, id) => ((rep.anchors && rep.anchors.activities) || []).find((a) => a.activityId === id) || { times: [] };
const heure = (p, t) => (p.times || []).find((x) => x.time === t) || {};

async function main() {
  JOUR = prochainMercredi();
  console.log(`jour du gate : ${JOUR}`);
  const { attenteDuSousGroupe } = require('../lib/ops-engine');

  section('A. DEUX PARTIES NE SONT PAS DEUX VAGUES');
  const visiteA = await heures({
    type: 'visite', pax: '4', softReserve: '1',
    program: JSON.stringify([{ activityId: 'laser_game', games: 2 }, { activityId: 'bowling', duration: 1.5 }, { activityId: 'minigolf_blacklight' }, { activityId: 'playground' }]),
    laserGameTimes: JSON.stringify(['16:30', '18:30']),
    preferredTimes: JSON.stringify({ bowling: '17:00', laser_game: '16:30' }),
  });
  const creneauA = (visiteA.slots || [])[0] || null;
  const blocsA = creneauA && creneauA.opsPlan ? creneauA.opsPlan.resourceBlocks || [] : [];
  const lasers = blocsA.filter((b) => b.activityId === 'laser_game');
  ok(lasers.length === 2 && lasers.map((b) => b.startTime).join(',') === '16:30,18:30' && lasers.map((b) => Number(b.countIndex)).join(',') === '1,2',
    'MONTAGE la visite de la capture : parties 1 et 2 a 16:30 et 18:30, bowling a 17:00', lasers.map((b) => `${b.startTime}#${b.countIndex}`).join(' '));
  ok(attenteDuSousGroupe(blocsA) === null, 'personne n attend : les deux parties rejouent les 4 personnes', JSON.stringify(attenteDuSousGroupe(blocsA)));
  const attenteA = (visiteA.complements || []).filter((c) => c.kind === 'attente');
  ok(attenteA.length === 0, 'aucune offre « pendant l attente » (ni arcades, ni autre)', attenteA.map((c) => c.name).join(', '));
  // Une vraie vague : un groupe de 40 sur 30 armes, une seule partie.
  const vagues = [
    { activityId: 'laser_game', countIndex: 1, startTime: '16:30', players: 20 },
    { activityId: 'laser_game', countIndex: 1, startTime: '17:00', players: 20 },
  ];
  ok(JSON.stringify(attenteDuSousGroupe(vagues)) === JSON.stringify({ personnes: 20, minutes: 30 }),
    'une vraie vague fait toujours attendre : 20 personnes, 30 min', JSON.stringify(attenteDuSousGroupe(vagues)));
  const deuxPartiesEnVagues = vagues.concat([
    { activityId: 'laser_game', countIndex: 2, startTime: '19:00', players: 20 },
    { activityId: 'laser_game', countIndex: 2, startTime: '19:30', players: 20 },
  ]);
  ok(JSON.stringify(attenteDuSousGroupe(deuxPartiesEnVagues)) === JSON.stringify({ personnes: 20, minutes: 30 }),
    'deux parties jouees en vagues : l attente est celle d une partie (30 min), jamais l ecart entre les parties', JSON.stringify(attenteDuSousGroupe(deuxPartiesEnVagues)));

  section('B. « SERRE » DIT CE QUI DEBORDE VRAIMENT');
  // LA REGLE, PAS UN CHIFFRE RECOPIE (2026-10-15 : la fin est la derniere
  // activite posee, la premiere heure serree de la FORMULE 2 a bouge) : la
  // premiere heure serree dit ce qui manque a la formule ENTIERE, son arrivee
  // plus sa duree moins la fermeture, et le recapitulatif dit le meme manque.
  const f2 = await heures({ type: 'formule', formuleId: 'f2', pax: '6' });
  const f2laser = piste(f2, 'laser_game');
  const dureeF2 = (((await heures({ type: 'durees', pax: '6' })).durees || {}).f2 || {}).min;
  const serree = (f2laser.times || []).find((t) => t.ok !== false && t.warning && t.warning.code === 'schedule_free') || {};
  const manque = /^Tout ne tiendra pas avant 22:00 : il manque (\d+) min$/.exec(String((serree.warning || {}).reason || ''));
  const enMinB = (t) => { const x = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return x ? Number(x[1]) * 60 + Number(x[2]) : NaN; };
  ok(Boolean(manque) && Number(manque[1]) === enMinB(serree.time) - 10 + dureeF2 - 22 * 60,
    `FORMULE 2, premiere heure serree (${serree.time}) : « Tout ne tiendra pas avant 22:00 : il manque N min », N = arrivee + duree de la formule entiere - fermeture (pas le laser)`, JSON.stringify({ heure: serree.time, avis: serree.warning, duree: dureeF2 }));
  const choisi = await heures({ type: 'formule', formuleId: 'f2', pax: '6', preferredTimes: JSON.stringify({ laser_game: serree.time }), laserGameTimes: JSON.stringify([serree.time]) });
  const retenu = (choisi.slots || [])[0] || {};
  ok(Boolean(manque) && retenu.visitEndsAtClose === true && retenu.visitShortfallMinutes === Number(manque[1]),
    `le recapitulatif de ${serree.time} annonce le meme manque`, `${retenu.visitEndTime} manque ${retenu.visitShortfallMinutes}`);
  const f4 = await heures({ type: 'formule', formuleId: 'f4', pax: '6' });
  const f4bowling = piste(f4, 'bowling');
  const serreesF4 = (f4bowling.times || []).filter((t) => t.ok !== false && t.warning).map((t) => t.time);
  ok(serreesF4.length === 0 && heure(f4bowling, '19:30').ok !== false,
    'FORMULE 4 : aucune heure de bowling serree quand une place du laser tient sans avertissement (19:30 comme 20:00)', serreesF4.join(' ') || 'aucune');
  const f4plan = await heures({ type: 'formule', formuleId: 'f4', pax: '6', preferredTimes: JSON.stringify({ bowling: '19:30' }) });
  const plan430 = ((f4plan.slots || [])[0] || {}).opsPlan || {};
  // LA REGLE, PAS L HEURE (2026-10-15 : sans les minutes de transition, le
  // laser tient a 19:00 et non plus a 18:30) : la reservation pose son laser
  // hors du bowling et la visite tient avant 22:00, sans avertissement.
  const bowling430 = (plan430.resourceBlocks || []).find((b) => b.activityId === 'bowling' && b.startTime === '19:30');
  const laser430 = (plan430.resourceBlocks || []).find((b) => b.activityId === 'laser_game');
  const horsDuBowling = Boolean(bowling430 && laser430) && (enMinB(laser430.endTime) <= enMinB(bowling430.startTime) || enMinB(laser430.startTime) >= enMinB(bowling430.endTime));
  ok(!((f4plan.slots || [])[0] || {}).visitEndsAtClose && horsDuBowling,
    `la reservation du bowling de 19:30 pose le laser (${laser430 ? laser430.startTime : 'aucun'}) hors du bowling et tient avant 22:00 : la grille dit la meme chose`, (plan430.resourceBlocks || []).map((b) => `${b.activityId} ${b.startTime}`).join(', '));
  const visiteB = await heures({ type: 'visite', pax: '6', softReserve: '1', program: JSON.stringify([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 3 }]) });
  const w2100 = heure(piste(visiteB, 'laser_game'), '21:00').warning || {};
  ok(w2100.reason === 'Plus le temps pour les parties 2 et 3 de laser avant 22:00',
    'seules a deborder (rien d autre sans heure), les parties restantes sont nommees : « les parties 2 et 3 »', w2100.reason);

  section('C. LE LASER : 20 MIN DE JEU, LE CRENEAU DE L EQUIPE A PART');
  const m = await appel(meta, { chemin: '/api/public-booking-meta', q: { centerId: 'libramont' } });
  const laser = (m.activities || []).find((a) => a.id === 'laser_game') || {};
  ok(laser.gameMinutes === 20 && laser.sessionMinutes === 25 && laser.cycleMinutes === 30,
    'le catalogue public sert le jeu (20, fiche du centre), le creneau (25) et le pas des departs (30)', `${laser.gameMinutes} / ${laser.sessionMinutes} / ${laser.cycleMinutes}`);
  const blocLaser = lasers[0] || {};
  ok(blocLaser.startTime === '16:30' && blocLaser.endTime === '16:55',
    'la console garde le creneau reel de l arene (16:30 a 16:55)', `${blocLaser.startTime} a ${blocLaser.endTime}`);

  section('D. BILLARD : 5 TABLES AU PLUS PAR RESERVATION EN LIGNE');
  const { normalizeProgram } = require('../lib/visit-program');
  const { normalizeReservationRequest } = require('../lib/reservation-request');
  const billards = (m.activities || []).find((a) => a.id === 'billards') || {};
  ok(billards.units === 6 && billards.maxUnitsPerBooking === 5, 'le catalogue sert 6 tables et le plafond de 5 par reservation', `${billards.units} / ${billards.maxUnitsPerBooking}`);
  // La demande, telle que chaque canal la normalise : le canal vient de
  // l appelant (l API), le corps peut mentir.
  const demandeTables = (units, corps = {}) => ({
    type: 'visite', centerId: 'libramont', date: JOUR, startTime: '14:00', pax: 10,
    name: 'Essai', email: 'essai@example.com', phone: '0470000000',
    program: [{ activityId: 'billards', units, hours: 1 }], ...corps,
  });
  const verdict = (units, canal, corps) => {
    try { return `accepte ${normalizeReservationRequest(demandeTables(units, corps), { channel: canal }).program.items[0].units}`; } catch (error) { return error.message; }
  };
  const plafondDit = 'Billards : 5 tables au plus par réservation.';
  ok(verdict(5, 'public') === 'accepte 5', 'en ligne, cinq tables passent', verdict(5, 'public'));
  ok(verdict(6, 'public') === plafondDit, 'en ligne, six tables sont refusees, avec le plafond dit (jamais rabotees en silence)', verdict(6, 'public'));
  ok(verdict(6, 'public', { channel: 'staff' }) === plafondDit, 'un corps qui se dit « staff » sur l API publique est refuse pareil (le canal vient du serveur)', verdict(6, 'public', { channel: 'staff' }));
  ok(verdict(6, 'staff') === 'accepte 6', 'au comptoir, les six tables du centre se vendent (le plafond vise le formulaire)', verdict(6, 'staff'));
  let sept = '';
  try { normalizeProgram([{ activityId: 'billards', units: 7, hours: 1 }], { centerId: 'libramont', pax: 10 }); sept = 'acceptee'; } catch (error) { sept = error.message; }
  ok(sept === 'Billards : 6 tables au plus.', 'au comptoir, au-dela de la dotation, le refus dit le compte du centre', sept);
  const heuresSix = await heures({ type: 'visite', pax: '10', program: JSON.stringify([{ activityId: 'billards', units: 6, hours: 1 }]) });
  ok(heuresSix.ok === false && String(heuresSix.message || '') === plafondDit, 'la page des heures refuse six tables avec la meme phrase', JSON.stringify({ ok: heuresSix.ok, message: heuresSix.message }));

  section('E. PLAINE DE JEUX : LES ENFANTS COMPTES');
  const plaine = normalizeProgram([{ activityId: 'playground', participants: 2 }], { centerId: 'libramont', pax: 4 }).items[0];
  ok(plaine.participants === 2, 'deux enfants sur un groupe de 4 : la ligne porte 2 participants', String(plaine.participants));
  let trop = null;
  try { normalizeProgram([{ activityId: 'playground', participants: 9 }], { centerId: 'libramont', pax: 4 }); } catch (error) { trop = error; }
  ok(trop && trop.statusCode === 422 && /entre 1 et 4 participants/.test(trop.message), 'plus d enfants que le groupe : refus en 422, jamais raboté en silence', trop && trop.message);

  section('F. LA DUREE DES FORMULES EST CELLE DU RECAPITULATIF');
  const durees = await heures({ type: 'durees', pax: '6' });
  const d2 = (durees.durees || {}).f2 || {};
  ok(d2.min > 0 && d2.min === d2.max, `FORMULE 2 : une seule duree, ${d2.min} min sur place`, JSON.stringify(d2));
  const f2choix = await heures({ type: 'formule', formuleId: 'f2', pax: '6', preferredTimes: JSON.stringify({ laser_game: '14:00' }), laserGameTimes: JSON.stringify(['14:00']) });
  const s14 = (f2choix.slots || [])[0] || {};
  const enMin = (t) => { const x = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return x ? Number(x[1]) * 60 + Number(x[2]) : NaN; };
  const surPlace = enMin(s14.visitEndTime) - enMin(s14.opsPlan && s14.opsPlan.arrivalTime);
  ok(surPlace === d2.min, 'la carte et le recapitulatif de 14:00 disent la meme duree', `recap ${s14.opsPlan && s14.opsPlan.arrivalTime} a ${s14.visitEndTime} = ${surPlace} min`);
  const vingt = await heures({ type: 'durees', pax: '20' });
  ok(d2.min > 0 && ((vingt.durees || {}).f2 || {}).min === d2.min, 'un groupe de 20 (marge de l equipe plus grande) : la duree ne bouge pas', JSON.stringify((vingt.durees || {}).f2));
  ok(!('kfd' in (durees.durees || {})) && !('mm' in (durees.durees || {})), 'les formules a fenetre ouverte n ont pas de duree (leur plage est sur la carte)', Object.keys(durees.durees || {}).join(','));

  section('G. LES OFFRES PAR E-MAIL (RGPD)');
  const { appliquerChoixDeReservation } = require('../lib/marketing-suppression');
  // Une base en memoire qui comprend les trois requetes du module.
  function baseEnMemoire(lignes) {
    return {
      lignes,
      query: async (texte, p) => {
        const sql = String(texte);
        if (/pg_advisory_xact_lock/.test(sql)) return { rows: [], rowCount: 0 };
        if (/^\s*insert into marketing_suppressions/.test(sql)) {
          if (lignes.some((l) => l.center_id === p[0] && l.email.toLowerCase() === p[1])) return { rows: [], rowCount: 0 };
          lignes.push({ center_id: p[0], email: p[1], source: p[2], reason: p[3] });
          return { rows: [lignes[lignes.length - 1]], rowCount: 1 };
        }
        if (/^\s*update communications/.test(sql)) return { rows: [], rowCount: 0 };
        if (/^\s*delete from marketing_suppressions/.test(sql)) {
          const avant = lignes.length;
          const garde = lignes.filter((l) => !(l.center_id === p[0] && l.email.toLowerCase() === p[1] && (!/source = 'form'/.test(sql) || l.source === 'form')));
          lignes.splice(0, lignes.length, ...garde);
          return { rows: [], rowCount: avant - lignes.length };
        }
        throw new Error(`requete inattendue : ${sql.slice(0, 60)}`);
      },
    };
  }
  const b1 = baseEnMemoire([]);
  const r1 = await appliquerChoixDeReservation({ centerId: 'libramont', email: 'Client@Exemple.be', refuse: true, reservationId: 1500 }, b1);
  ok(r1.etat === 'refuse' && b1.lignes.length === 1 && b1.lignes[0].source === 'form' && /1500/.test(b1.lignes[0].reason) && b1.lignes[0].email === 'client@exemple.be',
    'case cochee : retrait du centre, origine « form », numero de la reservation, adresse normalisee', JSON.stringify(b1.lignes));
  const r2 = await appliquerChoixDeReservation({ centerId: 'libramont', email: 'client@exemple.be', refuse: false, reservationId: 1501 }, b1);
  ok(r2.etat === 'leve' && b1.lignes.length === 0, 'nouvelle reservation sans la case : le retrait pose par la case est leve', JSON.stringify(r2));
  const b2 = baseEnMemoire([{ center_id: 'libramont', email: 'client@exemple.be', source: 'link', reason: '' }]);
  const r3 = await appliquerChoixDeReservation({ centerId: 'libramont', email: 'client@exemple.be', refuse: false, reservationId: 1502 }, b2);
  ok(r3.etat === 'inchange' && b2.lignes.length === 1 && b2.lignes[0].source === 'link', 'un retrait par le lien d un mail ne se leve JAMAIS par une case laissee vide', JSON.stringify(b2.lignes));
  const r4 = await appliquerChoixDeReservation({ centerId: 'gembloux', email: 'client@exemple.be', refuse: true, reservationId: 1503 }, b2);
  ok(r4.etat === 'refuse' && b2.lignes.some((l) => l.center_id === 'gembloux') && b2.lignes.some((l) => l.center_id === 'libramont' && l.source === 'link'), 'le retrait vaut pour CE centre (la case le nomme)', JSON.stringify(b2.lignes.map((l) => `${l.center_id}:${l.source}`)));
  // La reservation applique le choix DANS sa transaction, et seulement quand
  // la porte publique l a pose (un booleen) : lu dans le code qui s execute.
  const sourceDb = fs.readFileSync(path.join(ROOT, 'lib/database.js'), 'utf8').split(CRLF).join(LF);
  const creer = sourceDb.slice(sourceDb.indexOf('async function createReservation('), sourceDb.indexOf('async function convertirBlocage('));
  ok(/appliquerChoixDeReservation\(/.test(creer) && /client\.query\(text, params\)/.test(creer),
    'createReservation applique le choix avec le client de SA transaction', '');
  const creerExecute = require('../lib/database').createReservation.toString();
  ok(/typeof input\.choixOffres\.refuse === 'boolean'/.test(creerExecute), 'le module charge porte la meme garde (booleen seulement)', '');
  const porte = fs.readFileSync(path.join(ROOT, 'api/public-reservations.js'), 'utf8');
  ok(porte.includes("typeof body.sansOffres === 'boolean' ? { choixOffres: { refuse: body.sansOffres } } : {}"), 'la porte publique ne passe le choix que s il est un booleen (une surface sans la case ne decide rien)', '');
  const migration = fs.readFileSync(path.join(ROOT, 'database/marketing-suppressions-form-schema.sql'), 'utf8');
  ok(/check \(source in \('link', 'staff', 'complaint', 'form'\)\)/.test(migration), 'la migration 0050 admet l origine « form » et garde les trois autres', '');
  const { MIGRATIONS } = require('./run-db-migrations');
  ok(MIGRATIONS.some((x) => x.id === '0050_marketing_suppressions_form' && x.file === 'database/marketing-suppressions-form-schema.sql') && fs.existsSync(path.join(ROOT, 'database/rollbacks/0050_marketing_suppressions_form.down.sql')),
    'la migration 0050 est au runner, avec son retour en arriere', '');
  const html = fs.readFileSync(path.join(ROOT, 'fungalaxy.html'), 'utf8');
  const caseOffres = /<input type="checkbox" id="cSansOffres"[^>]*>/.exec(html);
  ok(Boolean(caseOffres) && !/\schecked\b/.test(caseOffres[0]) && html.includes('Je ne souhaite pas recevoir les offres'),
    'la case du formulaire est une OPPOSITION, jamais pre-cochee (une case pre-cochee n est pas un consentement)', caseOffres ? caseOffres[0] : 'absente');

  section('H. LE FORMULAIRE, DANS LE NAVIGATEUR');
  await navigateur();

  if (failures) {
    console.error(`\nformulaire-retours-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nformulaire-retours-check: ALL OK (attente, serre, laser 20/25, billard 5 tables, enfants de la plaine, duree des formules, offres par e-mail)');
}

// [H] Le formulaire servi par le mock du depot (le vrai handler des heures) :
// ce que le client voit, et ce qui part au serveur.
async function navigateur() {
  const PORT = Number(process.env.PINLANE_RETOURS_PORT || 4481);
  const BASE = 'http://127.0.0.1:' + PORT;
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const attendre = async (page, fn, ms, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return false; } };
  const server = mock.createServer({ port: PORT });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  const demandes = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  page.on('request', (req) => { if (req.url().includes('/api/public-availability') && req.url().includes('type=visite')) demandes.push(req.url()); });
  try {
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    await page.goto(BASE + '/fungalaxy/libramont', { waitUntil: 'networkidle', timeout: 45000 });
    await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
    await page.click('#dayBtn');
    const [y, mo] = mock.DATE.split('-').map(Number);
    const cible = cap(MOIS[mo - 1]) + ' ' + y;
    for (let k = 0; k < 16; k += 1) {
      const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
      if (titre === cible) break;
      const [nom, an] = titre.split(' ');
      await page.click(y * 12 + (mo - 1) > Number(an) * 12 + MOIS.indexOf(nom.toLowerCase()) ? '#calNext' : '#calPrev');
      await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
    }
    await attendre(page, (d) => { const x = document.querySelector('#calGrid .fg-cal__day[data-date="' + d + '"]'); return x && !x.classList.contains('is-loading'); }, 8000, mock.DATE);
    await page.click('#calGrid .fg-cal__day[data-date="' + mock.DATE + '"]');
    await attendre(page, () => document.querySelector('#dayPop').hidden, 3000);
    await page.fill('#paxInput', '4');
    await page.press('#paxInput', 'Enter');
    await page.click('#goActivities');
    const arrive = await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
    if (!ok(arrive, 'MONTAGE le formulaire arrive aux activites (4 personnes)')) return;
    // Les formules d abord : la duree de la FORMULE 2 sur sa carte.
    await page.click('#tabFor');
    const duree = await attendre(page, () => { const x = document.querySelector('[data-duree-for="f2"]'); return x && !x.classList.contains('is-wait'); }, 10000);
    const f2 = await page.evaluate(() => { const x = document.querySelector('[data-duree-for="f2"]'); return x ? x.textContent.replace(/\s+/g, ' ').trim() : ''; });
    // La duree que le serveur sert pour ce jour et ce groupe, pas un chiffre recopie.
    const serveur = (((await appel(dispo, { chemin: '/api/public-availability', q: { centerId: 'libramont', date: mock.DATE, type: 'durees', pax: '4' } })).durees || {}).f2 || {}).min;
    const lue = /^Environ (\d+) h(?: (\d{2}))? sur place$/.exec(f2);
    ok(duree && Boolean(lue) && Number(lue[1]) * 60 + Number(lue[2] || 0) === serveur, 'la carte de la FORMULE 2 dit sa duree, celle du recapitulatif', `${f2} (serveur ${serveur} min)`);
    const ouvertes = await page.evaluate(() => ['mm', 'kfd'].filter((id) => document.querySelector('[data-duree-for="' + id + '"]')));
    ok(ouvertes.length === 0, 'MATIN MALIN et KIDS FUN DAY n ont pas de ligne de duree (leur plage est sur la carte)', ouvertes.join(','));
    await page.click('#tabAct');
    await page.waitForTimeout(300);
    for (const id of ['laser_game', 'playground']) { await page.click('#gridAct .fg-card[data-activity="' + id + '"]'); await page.waitForTimeout(300); }
    await page.click('#gridAct .fg-grid__item[data-activity="playground"] [data-compteur="participants"] [data-pas="-1"]');
    await page.waitForTimeout(300);
    const cartes = await page.evaluate(() => {
      const t = (id, sel) => { const n = document.querySelector('#gridAct .fg-grid__item[data-activity="' + id + '"] ' + sel); return n ? String(n.value ?? n.textContent).replace(/\s+/g, ' ').trim() : ''; };
      return { note: t('laser_game', '.fg-card__rot'), enfants: t('playground', '.fg-kids__n'), texte: t('playground', '.fg-count__label'), prix: t('playground', '.fg-card__price') };
    });
    ok(!cartes.note.includes('min de règles'), 'les règles du laser quittent la carte compacte', cartes.note);
    await page.click('#gridAct li[data-activity="laser_game"] [data-activity-info]');
    cartes.note = await page.locator('.fg-info-text').textContent();
    ok(cartes.note.includes('Partie de 20 min, + 5 à 10 min de règles.'), 'le popup du laser dit le jeu et le temps des regles', cartes.note);
    await page.keyboard.press('Escape');
    ok(cartes.enfants === '3' && /Enfants\s*sur 4/.test(cartes.texte) && /^36\s€ · 3\senfants/.test(cartes.prix), 'la plaine : 3 enfants sur 4, le prix des 3', JSON.stringify(cartes));
    await page.click('#goHours');
    const heures = await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('#goContact').disabled, 15000);
    ok(heures, 'MONTAGE l ecran des heures se charge');
    const derniere = demandes[demandes.length - 1] || '';
    let programme = [];
    try { programme = JSON.parse(new URL(derniere).searchParams.get('program') || '[]'); } catch (error) { programme = []; }
    const plaine = programme.find((l) => l && l.activityId === 'playground') || {};
    ok(plaine.participants === 3, 'la demande des heures porte les 3 enfants de la plaine', JSON.stringify(plaine));
    const tete = await page.evaluate(() => {
      const n = document.querySelector('.fg-track[data-activity="laser_game"]');
      const t = (sel) => { const x = n && n.querySelector(sel); return x ? x.textContent.replace(/\s+/g, ' ').trim() : ''; };
      return { nom: t('.fg-track__head b'), detail: t('.fg-track__detail'), texte: n ? n.textContent.replace(/\s+/g, ' ').trim() : '' };
    });
    ok(tete.nom === 'Laser Game' && tete.detail === '4 joueurs · 1 partie · 20 min' && tete.texte.indexOf('Partie de 20 min, + 5 à 10 min de règles.') >= 0,
      'la piste du laser dit ses 4 joueurs, la partie de 20 min et le temps des regles', JSON.stringify({ nom: tete.nom, detail: tete.detail, texte: tete.texte.slice(0, 140) }));
    await page.click('#goContact');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
    const caseOffres = await page.evaluate(() => ({ texte: ((document.querySelector('#offresWrap') || {}).textContent || '').replace(/\s+/g, ' ').trim(), coche: (document.querySelector('#cSansOffres') || {}).checked }));
    ok(caseOffres.coche === false && caseOffres.texte === 'Je ne souhaite pas recevoir les offres de Fun Galaxy Libramont par e-mail.',
      'la case des offres nomme le centre et n est pas cochee', JSON.stringify(caseOffres));
  } finally {
    ok(erreurs.length === 0, 'aucune erreur JavaScript', erreurs.slice(0, 3).join(' | '));
    await browser.close();
    server.close();
  }
}

if (process.argv.includes('--mutate')) {
  const empreintes = new Map(MUTATIONS.map((x) => [x.fichier, fs.readFileSync(path.join(ROOT, x.fichier), 'utf8')]));
  const { spawnSync } = require('child_process');
  let ratees = 0;
  MUTATIONS.forEach((mutation, index) => {
    const run = spawnSync(process.execPath, [__filename], {
      encoding: 'utf8',
      env: { ...process.env, PINLANE_RETOURS_MUTATION: String(index + 1) },
    });
    const sortie = `${run.stdout || ''}${run.stderr || ''}`;
    const mordu = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
    if (run.status === 1 && mordu) {
      console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom}.`);
    } else {
      ratees += 1;
      console.log(sortie.split(LF).filter((l) => /FAIL|mutation|Error/.test(l)).slice(0, 8).join(LF));
      console.log(`CONTRE-EPREUVE RATEE (code ${run.status}, mutation ${mordu ? 'servie' : 'JAMAIS servie'}) : ${mutation.nom}.`);
    }
  });
  const touches = [...empreintes].filter(([fichier, avant]) => fs.readFileSync(path.join(ROOT, fichier), 'utf8') !== avant).map(([fichier]) => fichier);
  if (touches.length) { console.log(`LE DISQUE A ETE ECRIT : ${touches.join(', ')}`); ratees += 1; }
  if (ratees) process.exit(1);
  console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et aucun fichier n a ete ecrit.`);
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}

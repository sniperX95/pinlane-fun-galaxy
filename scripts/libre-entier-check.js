#!/usr/bin/env node
// LE LIBRE SE JOUE D UN BLOC (Movsar, 2026-10-14, capture du formulaire).
//
// Sa visite : laser 14:00 (partie 1 sur 2) et 15:00 (partie 2 sur 2), 35 min
// d attente apres chacune, bowling 16:00-17:00, puis « Dans la foulée, sans
// heure fixe : Minigolf Blacklight · 11 joueurs · environ 45 min », et « Fin
// de la visite 17:00 ». Sa question : « FIN estimé a 17h et le mini golf se
// joue quand ducoup ? halala ya encore ce bug de temps hein ».
//
// Cause : le temps libre se rangeait EN MINUTES dans les attentes. Les deux
// attentes de 35 min faisaient 70 min, le minigolf « y tenait », et la fin
// restait celle du bowling. Un minigolf ne se coupe pas en deux : une activite
// libre ne prend qu une attente qui la contient TOUT ENTIERE, sinon elle se
// joue apres et la fin recule. Une seule regle (lib/ops-engine.js,
// rangerLeLibre et rangerLesLibres), lue partout ou une fin se dit :
//   [A] la capture : fin 17:45, le minigolf apres le bowling ;
//   [B] une attente qui le contient (laser 14:00, bowling 15:30) : il s y joue,
//       la fin reste 16:30, le serveur dit ou (visitFreeGaps), et l avis
//       « 1 h 05 d'attente » se tait (il n en reste que 20) ; dans 2 h 05,
//       l avis dit les 1 h 20 qui restent vides ;
//   [C] deux libres : les arcades (30 min) dans une attente de 35, le minigolf
//       apres ;
//   [D] les formules : la Formule 4 a la meme journee finit a 17:45 (17:10
//       avant), la Formule 1 garde sa fin, la Formule 5 range son minigolf
//       dans l attente d 1 h 05 entre ses deux parties ;
//   [E] la fermeture : laser 19:00 et 20:00, bowling 21:00 ; le minigolf ne
//       tient plus avant 22:00, la grille le dit, la fin aussi ;
//   [F] la fenetre Reserver de l equipe dit la meme fin ;
//   [G] la fiche de l equipe aussi ;
//   [H] l ecran (390 et 1280 px) : le minigolf « Dans la foulée » et « Fin de
//       la visite 17:45 » ; « Entre les deux » quand il tient dans l attente,
//       l attente qui reste dessous, plus rien de lui « Dans la foulée », ni
//       d avis « 1 h 05 d attente » ; les arcades d une visite « Entre les
//       deux », dans une attente de 35 min, le minigolf seul « Dans la
//       foulée » ;
//   [I] le mail de confirmation dit « Fin estimée vers 17:45 » (il disait la
//       fin du bowling, sans le minigolf), lu sur le dossier enregistre.
// La fin attendue est refaite ici, sans le moteur (finDuRangement) : toutes
// les places s essaient, la plus tot gagne.
//
// L horloge est figee au lundi 5 octobre 2026, 9:00 a Bruxelles (serveur et
// page) ; la journee est le mercredi 7, ouvert de 12:00 a 22:00.
//
// Contre-epreuve : node scripts/libre-entier-check.js --mutate (14 mutations,
// servies en memoire, aucun fichier touche).
'use strict';
process.env.TZ = 'Europe/Brussels';
process.env.PINLANE_CALENDAR_SYNC = 'off';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.RESEND_API_KEY;
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAINTENANT = '2026-10-05T09:00:00+02:00';
const JOUR = '2026-10-07';
const PAX = 14;

// L horloge du processus : figee a MAINTENANT, puis elle avance.
{
  const Vraie = Date;
  const depart = Vraie.now();
  const cible = new Vraie(MAINTENANT).getTime();
  const decale = () => cible + (Vraie.now() - depart);
  class Figee extends Vraie {
    constructor(...a) { if (a.length === 0) super(decale()); else super(...a); }
    static now() { return decale(); }
  }
  global.Date = Figee;
}

const CRLF = '\r\n';
const LF = '\n';
const MUTATIONS = [
  {
    nom: 'une activite libre se coupe entre les attentes',
    fichier: 'lib/ops-engine.js',
    de: '    return { activityId: ligne.activityId || null, minutes, entier: ligne.dayAccess !== true };',
    vers: '    return { activityId: ligne.activityId || null, minutes, entier: false };',
  },
  {
    nom: 'la reserve du moteur (la fermeture) additionne les attentes',
    fichier: 'lib/ops-engine.js',
    de: 'pieces: piecesDuLibre({ libres: reserveItems, libre: reserveMinutes, couvert }) }).apres;',
    vers: 'pieces: piecesDuLibre({ libres: null, libre: reserveMinutes, couvert }) }).apres;',
  },
  {
    nom: 'une formule additionne ses etapes',
    fichier: 'lib/ops-engine.js',
    de: '  if (passSansSuite) visitEnd = Math.max(visitEnd, passSansSuite.fin);',
    vers: '  void 0;',
  },
  {
    nom: 'la fin affichee ne recoit pas les lignes sans heure',
    fichier: 'api/public-availability.js',
    de: '          libres: libresDuProgramme,\n',
    vers: '',
  },
  {
    nom: 'ce qui ne tiendra pas ignore le rangement',
    fichier: 'api/public-availability.js',
    de: '          const apres = Math.max(0, (piece ? piece.minutes : minutes) - dedans);',
    vers: '          const apres = 0;',
  },
  {
    nom: 'la fenetre Reserver additionne les attentes',
    fichier: 'lib/reserver-fenetre.js',
    de: 'libre: somme(libres), libres, attenteLibre:',
    vers: 'libre: somme(libres), attenteLibre:',
  },
  {
    nom: 'la fiche de l equipe additionne les attentes',
    fichier: 'assets/app-main.js',
    de: '  return Math.max(0, minutes - couvertParLesTrous(trous.map(trou => trou.capacite), durees)) / 60;',
    vers: '  return Math.max(0, minutes - trous.reduce((somme, trou) => somme + trou.capacite, 0)) / 60;',
  },
  {
    nom: 'l ecran ignore ou se joue le libre',
    fichier: 'assets/fungalaxy-booking.js',
    de: '    var trousServeur = Array.isArray(slot.visitFreeGaps) ? slot.visitFreeGaps : null;',
    vers: '    var trousServeur = null;',
  },
  {
    nom: 'l ecran redit « Dans la foulée » ce qui se joue entre les deux',
    fichier: 'assets/fungalaxy-booking.js',
    de: '      if (libresRanges.indexOf(it) >= 0) return;\n',
    vers: '',
  },
  {
    nom: 'le mail d une visite dit la fin du bowling',
    fichier: 'lib/ops-communications.js',
    de: "  if (fin && reservation.type !== 'formule' && items.length) fin = require('./reserver-fenetre').finDeLaVisite(plan, reservation) || fin;",
    vers: '  void 0;',
  },
  {
    nom: 'un dossier enregistre perd la fin de sa visite',
    fichier: 'lib/reserver-fenetre.js',
    de: '  const aHeure = programme && Array.isArray(programme.plannedItems) ? programme.plannedItems : lignesDuDossier.filter((ligne) => ligne && ligne.planned === true);',
    vers: '  const aHeure = programme && Array.isArray(programme.plannedItems) ? programme.plannedItems : [];',
  },
  {
    nom: 'l avis d attente compte encore ce qui s y joue',
    fichier: 'api/public-availability.js',
    de: '        return { ...slot.opsPlan, comfortNotices: avisSansLeLibre(avis, { trous: mesure.trous, pieces: mesure.pieces, rangement: mesure.rangement }) };',
    vers: '        return slot.opsPlan;',
  },
  {
    nom: 'les arcades d une visite se redisent « Dans la foulée »',
    fichier: 'assets/fungalaxy-booking.js',
    de: "(formule && id === 'arcade_time')) return;",
    vers: "id === 'arcade_time') return;",
  },
  {
    nom: 'l attente garde les minutes du libre qui s y joue',
    fichier: 'assets/fungalaxy-booking.js',
    de: '        var reste = Math.max(0, ecart - pris);',
    vers: '        var reste = ecart;',
  },
];
const MUTATION_PREUVE = '[mutation] servie en memoire :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_LIBRE_MUTATION || 0);
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
// Le crochet est pose AVANT tout require applicatif.
if (MUTATION && !MUTATION.fichier.startsWith('assets/')) {
  const Module = require('module');
  const compile = Module.prototype._compile;
  const cible = path.resolve(ROOT, MUTATION.fichier);
  Module.prototype._compile = function compilerAvecMutation(contenu, nom) {
    if (path.resolve(nom) === cible) return compile.call(this, muter(contenu, MUTATION), nom);
    return compile.call(this, contenu, nom);
  };
}

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== undefined && detail !== '' ? `\n      ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }

// Le limiteur de debit, neutralise : ce gate fait des dizaines d appels, un
// refus du limiteur ressemblerait a un refus metier.
const limiteur = require.resolve(path.join(ROOT, 'lib/rate-limit'));
require.cache[limiteur] = { id: limiteur, filename: limiteur, loaded: true, exports: {
  enforceRateLimit: () => false,
  checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  getClientIp: () => 'gate',
} };
const database = require(path.join(ROOT, 'lib/database.js'));
database.readAvailabilitySnapshot = async (date, centerId = 'libramont') => ({ date, centerId, reservations: [], laneStatuses: {}, blocks: [] });
const api = require(path.join(ROOT, 'api/public-availability.js'));
const { disponibiliteInterne } = require(path.join(ROOT, 'lib/disponibilite-interne.js'));
const dispo = (extra, pax = PAX) => disponibiliteInterne({
  centerId: 'libramont', date: JOUR, pax: String(pax),
  ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])),
}, { handler: api });

const min = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const creneau = (rep) => (((rep || {}).json || {}).slots || [])[0] || null;
const blocs = (slot) => (((slot || {}).opsPlan || {}).resourceBlocks || []).filter((b) => b.activityId && b.startTime)
  .map((b) => `${b.activityId}#${b.countIndex || 1} ${b.startTime}-${b.endTime}`).sort().join(' | ');

const MINIGOLF = { activityId: 'minigolf_blacklight', participants: 11 };
const CAPTURE = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }, MINIGOLF];
const UNE_PARTIE = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }, MINIGOLF];
const CAS = {
  capture: { program: CAPTURE, preferredTimes: { laser_game: '14:00', bowling: '16:00' }, laserGameTimes: ['14:00', '15:00'] },
  trou: { program: UNE_PARTIE, preferredTimes: { laser_game: '14:00', bowling: '15:30' }, laserGameTimes: ['14:00'] },
  arcades: { program: [...CAPTURE, { activityId: 'arcade_time' }], preferredTimes: { laser_game: '14:00', bowling: '16:00' }, laserGameTimes: ['14:00', '15:00'] },
};
const visite = (cas, extra = {}) => ({ type: 'visite', softReserve: '1', ...cas, ...extra });

// La fin attendue, refaite ici sans le moteur : la fin du plan sans la marge,
// plus le libre qui ne tient dans aucune attente. Une attente s ouvre entre
// deux parties du groupe (les groupes d une meme partie n en font qu une) ; la
// foulee en prend le debut, apres la derniere partie de laser posee. Chaque
// activite libre y tient TOUT ENTIERE ou se joue apres : toutes les places
// s essaient, la plus tot gagne. Une entree a la journee et l offre d attente
// ne sont pas exercees ici.
function finDuRangement(p, lignes) {
  const fenetres = new Map();
  (p.resourceBlocks || []).filter((b) => b.activityId && b.startTime && b.endTime).forEach((b) => {
    const cle = `${b.activityId}#${b.countIndex || 1}`;
    const deja = fenetres.get(cle);
    fenetres.set(cle, { d: deja ? Math.min(deja.d, min(b.startTime)) : min(b.startTime), f: deja ? Math.max(deja.f, min(b.endTime)) : min(b.endTime), laser: b.activityId === 'laser_game' });
  });
  const w = [...fenetres.values()].sort((a, b) => a.d - b.d);
  const caps = [];
  const debuts = [];
  let fin = null;
  w.forEach((x) => {
    if (fin !== null && x.d > fin) { caps.push(x.d - fin); debuts.push(fin); }
    fin = fin === null ? x.f : Math.max(fin, x.f);
  });
  const finPlan = min(p.endTime) - Math.max(0, Number(p.bufferMinutes) || 0);
  const foulee = Math.max(0, Number((p.laserPassPlan || {}).followOnMinutes) || 0);
  let dedans = foulee - Math.min(foulee, Math.max(0, finPlan - fin));
  const lasers = w.filter((x) => x.laser).map((x) => x.f);
  const depuis = lasers.length ? Math.max(...lasers) : -Infinity;
  caps.map((_, i) => i).sort((a, b) => Number(debuts[a] < depuis) - Number(debuts[b] < depuis) || a - b).forEach((i) => {
    const prise = Math.min(dedans, caps[i]);
    caps[i] -= prise;
    dedans -= prise;
  });
  const entiers = (lignes || []).filter((l) => l && !l.planned && l.waitOffer !== true && !l.dayAccess)
    .map((l) => Math.max(0, Math.round(Number(l.minutes) || 0))).filter((m) => m > 0);
  let apres = Infinity;
  const essayer = (k, restes, dehors) => {
    if (k === entiers.length) { apres = Math.min(apres, dehors); return; }
    essayer(k + 1, restes, dehors + entiers[k]);
    restes.forEach((r, i) => {
      if (entiers[k] > r) return;
      const n = restes.slice();
      n[i] -= entiers[k];
      essayer(k + 1, n, dehors);
    });
  };
  essayer(0, caps, 0);
  return finPlan + apres;
}

// La fiche de l equipe, jouee en bac a sable : booking-core entier et les
// fonctions de la fiche extraites d app-main (une mutation de la fiche est
// servie ici, en memoire).
function chargerFiche() {
  const vm = require('vm');
  const ctx = vm.createContext({ console, state: { booking: {}, reservations: [] }, document: { getElementById: () => null } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'booking-core.js'), 'utf8'), ctx);
  let source = fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8').split(CRLF).join(LF);
  if (MUTATION && MUTATION.fichier === 'assets/app-main.js') source = muter(source, MUTATION);
  const fonction = (nom) => {
    const debut = source.indexOf(`\nfunction ${nom}(`);
    if (debut < 0) throw new Error(`${nom} introuvable dans app-main.js`);
    return source.slice(debut, source.indexOf('\nfunction ', debut + 1));
  };
  vm.runInContext(['getStaffResourceWindows', 'getStaffFormulaTimedItems', 'catalogueDeLigne', 'ligneALaJournee', 'getVisiteLibreApres', 'getStaffTerrainSpan'].map(fonction).join('\n'), ctx);
  return (dossier) => {
    ctx.dossier = JSON.parse(JSON.stringify(dossier));
    return hhmm(Math.round(vm.runInContext('getStaffTerrainSpan(dossier)', ctx).end * 60));
  };
}

async function main() {
  section('A. LA CAPTURE : LASER 14:00 ET 15:00, BOWLING 16:00, MINIGOLF 45 MIN');
  const a = await dispo(visite(CAS.capture));
  const sa = creneau(a);
  const libresA = ((a.json || {}).program || {}).freeItems || [];
  ok(Boolean(sa) && blocs(sa) === 'bowling#1 16:00-17:00 | laser_game#1 14:00-14:25 | laser_game#2 15:00-15:25',
    'MONTAGE la visite de la capture : deux parties de laser, 35 min d attente apres chacune, le bowling ensuite', sa ? blocs(sa) : JSON.stringify((a.json || {}).message || ''));
  ok(libresA.length === 1 && libresA[0].activityId === 'minigolf_blacklight' && libresA[0].minutes === 45 && libresA[0].participants === 11,
    'MONTAGE le minigolf de la capture : 45 min, 11 joueurs', JSON.stringify(libresA));
  ok(Boolean(sa) && sa.visitEndTime === '17:45', '[A] la fin est 17:45 : le minigolf ne tient dans aucune attente de 35 min, il se joue apres le bowling', sa && `fin ${sa.visitEndTime}`);
  ok(Boolean(sa) && min(sa.visitEndTime) === finDuRangement(sa.opsPlan, libresA), '[A] la fin est celle du rangement d un bloc, refait sans le moteur', sa && `fin ${sa.visitEndTime}, attendue ${hhmm(finDuRangement(sa.opsPlan, libresA))}`);
  ok(Boolean(sa) && Array.isArray(sa.visitFreeGaps) && sa.visitFreeGaps.length === 0, '[A] le serveur ne range le minigolf dans aucune attente', sa && JSON.stringify(sa.visitFreeGaps));
  ok(Boolean(sa) && !sa.visitEndsAtClose, '[A] tout tient avant la fermeture', sa && JSON.stringify(sa.visitShortfallItems || null));

  section('B. UNE ATTENTE QUI LE CONTIENT : LASER 14:00, BOWLING 15:30');
  const b = await dispo(visite(CAS.trou));
  const sb = creneau(b);
  const libresB = ((b.json || {}).program || {}).freeItems || [];
  ok(Boolean(sb) && blocs(sb) === 'bowling#1 15:30-16:30 | laser_game#1 14:00-14:25', 'MONTAGE 1 h 05 d attente entre le laser et le bowling', sb ? blocs(sb) : '');
  ok(Boolean(sb) && sb.visitEndTime === '16:30' && min(sb.visitEndTime) === finDuRangement(sb.opsPlan, libresB), '[B] la fin reste 16:30 : le minigolf se joue dans l attente', sb && `fin ${sb.visitEndTime}, attendue ${hhmm(finDuRangement(sb.opsPlan, libresB))}`);
  ok(Boolean(sb) && JSON.stringify(sb.visitFreeGaps) === JSON.stringify([{ startTime: '14:25', endTime: '15:30', items: [{ activityId: 'minigolf_blacklight', minutes: 45 }] }]),
    '[B] le serveur dit ou : l attente de 14:25 a 15:30 recoit le minigolf, 45 min', sb && JSON.stringify(sb.visitFreeGaps));
  const avisDe = (slot) => (((slot || {}).opsPlan || {}).comfortNotices || []).filter((n) => n && n.code === 'anchor_gap');
  ok(Boolean(sb) && avisDe(sb).length === 0, '[B] plus d avis « 1 h 05 d attente » : le minigolf s y joue, il en reste 20 min, sous la marge d une heure', sb && JSON.stringify((sb.opsPlan || {}).comfortNotices));
  const b2 = creneau(await dispo(visite({ ...CAS.trou, preferredTimes: { laser_game: '14:00', bowling: '16:30' } })));
  ok(Boolean(b2) && blocs(b2) === 'bowling#1 16:30-17:30 | laser_game#1 14:00-14:25', 'MONTAGE 2 h 05 entre le laser et le bowling', b2 ? blocs(b2) : '');
  ok(avisDe(b2).length === 1 && avisDe(b2)[0].gapMinutes === 80 && avisDe(b2)[0].message === "1 h 20 d'attente entre Laser Game et Bowling.",
    '[B] 2 h 05 entre les deux, le minigolf dedans : l avis dit les 1 h 20 qui restent vides', JSON.stringify(avisDe(b2)));

  section('C. DEUX LIBRES : LES ARCADES DANS UNE ATTENTE, LE MINIGOLF APRES');
  const c = await dispo(visite({ ...CAS.capture, program: [...CAPTURE, { activityId: 'arcade_time' }] }));
  const sc = creneau(c);
  const libresC = ((c.json || {}).program || {}).freeItems || [];
  const arcades = libresC.find((l) => l.activityId === 'arcade_time') || {};
  ok(Number(arcades.minutes) === 30, 'MONTAGE les arcades durent 30 min', JSON.stringify(arcades));
  ok(Boolean(sc) && sc.visitEndTime === '17:45' && min(sc.visitEndTime) === finDuRangement(sc.opsPlan, libresC), '[C] la fin reste 17:45 : les arcades tiennent dans une attente, pas le minigolf', sc && `fin ${sc.visitEndTime}, attendue ${hhmm(finDuRangement(sc.opsPlan, libresC))}`);
  ok(Boolean(sc) && (sc.visitFreeGaps || []).length === 1 && JSON.stringify(sc.visitFreeGaps[0].items) === JSON.stringify([{ activityId: 'arcade_time', minutes: 30 }]),
    '[C] le serveur range les arcades dans une attente, le minigolf nulle part', sc && JSON.stringify(sc.visitFreeGaps));

  section('D. LES FORMULES, LA MEME REGLE');
  const f4 = creneau(await dispo({ type: 'formule', formuleId: 'f4', preferredTimes: { laser_game: '14:00', bowling: '16:00' }, laserGameTimes: ['14:00', '15:00'] }));
  ok(Boolean(f4) && blocs(f4) === 'bowling#1 16:00-17:00 | laser_game#1 14:00-14:25 | laser_game#2 15:00-15:25', 'MONTAGE Formule 4, la meme journee que la capture', f4 ? blocs(f4) : 'aucun creneau');
  ok(Boolean(f4) && f4.visitEndTime === '17:45', '[D] Formule 4 : fin 17:45, son minigolf apres le bowling (17:10 quand la somme des etapes le coupait)', f4 && `fin ${f4.visitEndTime}`);
  ok(Boolean(f4) && !((f4.visitFreeGaps || []).some((g) => g.items.some((x) => x.activityId === 'minigolf_blacklight'))), '[D] Formule 4 : son minigolf n est range dans aucune attente', f4 && JSON.stringify(f4.visitFreeGaps));
  const f1 = creneau(await dispo({ type: 'formule', formuleId: 'f1', preferredTimes: { laser_game: '16:00', bowling: '14:00' }, laserGameTimes: ['16:00'] }));
  ok(Boolean(f1) && f1.visitEndTime === '16:25' && (f1.visitFreeGaps || []).some((g) => g.startTime === '15:00' && g.endTime === '16:00' && g.items.some((x) => x.activityId === 'arcade_time')),
    '[D] Formule 1, bowling 14:00 et laser 16:00 : ses arcades dans l heure d attente, la fin ne bouge pas (16:25)', f1 && `fin ${f1.visitEndTime} ${JSON.stringify(f1.visitFreeGaps)}`);
  const f5 = creneau(await dispo({ type: 'formule', formuleId: 'f5', preferredTimes: { laser_game: '14:00' }, laserGameTimes: ['14:00', '15:30'] }));
  ok(Boolean(f5) && (f5.visitFreeGaps || []).some((g) => g.startTime === '14:25' && g.endTime === '15:30' && g.items.some((x) => x.activityId === 'minigolf_blacklight')),
    '[D] Formule 5, laser 14:00 et 15:30 : son minigolf se range dans l attente d 1 h 05', f5 && `fin ${f5.visitEndTime} ${JSON.stringify(f5.visitFreeGaps)}`);

  section('E. LA FERMETURE : LASER 19:00 ET 20:00, BOWLING 21:00');
  const grille = async (soft) => ((((await dispo(visite({ program: CAPTURE, preferredTimes: { laser_game: '19:00' }, laserGameTimes: ['19:00', '20:00'] }, soft ? {} : { softReserve: '' }))).json || {}).anchors || {}).activities || [])
    .find((x) => x.activityId === 'bowling') || { times: [] };
  const souple = (await grille(true)).times.find((t) => t.time === '21:00') || {};
  ok(souple.ok !== false && souple.warning && souple.warning.code === 'schedule_free' && /Minigolf/.test(souple.warning.reason || ''),
    '[E] le bowling a 21:00 reste possible et dit que le minigolf ne tiendra plus avant 22:00 (deux attentes de 35 min le « contenaient »)', JSON.stringify(souple));
  const dure = (await grille(false)).times.find((t) => t.time === '21:00') || {};
  ok(dure.ok === false && dure.code === 'schedule_free', '[E] sans le mode souple, 21:00 se refuse pour le minigolf', JSON.stringify(dure));
  const se = creneau(await dispo(visite({ program: CAPTURE, preferredTimes: { laser_game: '19:00', bowling: '21:00' }, laserGameTimes: ['19:00', '20:00'] })));
  ok(Boolean(se) && se.visitEndsAtClose === true && se.visitEndTime === '22:00' && se.visitShortfallMinutes === 45
    && JSON.stringify((se.visitShortfallItems || []).map((h) => h.activityId)) === JSON.stringify(['minigolf_blacklight']),
  '[E] la visite s arrete a la fermeture et nomme le minigolf, 45 min de manque', se && JSON.stringify({ fin: se.visitEndTime, manque: se.visitShortfallMinutes, hors: se.visitShortfallItems }));

  section('F. LA FENETRE RESERVER DE L EQUIPE');
  const { planifierPourLaFenetre } = require(path.join(ROOT, 'lib/reserver-fenetre.js'));
  const comptoir = async (cas) => planifierPourLaFenetre({
    centerId: 'libramont', date: JOUR, pax: PAX, startTime: '14:00', type: 'visite', program: cas.program,
    name: 'Gate libre', phone: '+32470000000', email: 'gate@example.test',
    preference: { preferredTimes: cas.preferredTimes, laserGameTimes: cas.laserGameTimes, laserPlacement: 'scheduled' },
  }, { authorizedCenterId: 'libramont' }, { readState: async () => ({ reservations: [], laneStatuses: {} }) });
  const fa = await comptoir(CAS.capture);
  const fb = await comptoir(CAS.trou);
  ok(Boolean(fa && fa.plan) && fa.plan.fin === '17:45', '[F] la capture, composee au comptoir : « fin 17:45 », comme le tunnel', fa && fa.plan && `fin ${fa.plan.fin}`);
  ok(Boolean(fb && fb.plan) && fb.plan.fin === '16:30', '[F] le minigolf dans l attente : « fin 16:30 », comme le tunnel', fb && fb.plan && `fin ${fb.plan.fin}`);

  section('G. LA FICHE DE L EQUIPE');
  const fiche = chargerFiche();
  ok(Boolean(fa && fa.dossier) && fiche(fa.dossier) === '17:45', '[G] la fiche de la capture dit 17:45', fa && fa.dossier && fiche(fa.dossier));
  ok(Boolean(fb && fb.dossier) && fiche(fb.dossier) === '16:30', '[G] la fiche du minigolf dans l attente dit 16:30', fb && fb.dossier && fiche(fb.dossier));

  section('I. LE MAIL DE CONFIRMATION');
  // Le dossier tel qu il s enregistre : son programme ne garde que ses lignes
  // (lib/reservation-request.js, applyProgram).
  const comms = require(path.join(ROOT, 'lib/ops-communications.js'));
  const enregistre = (d) => ({ id: 7101, ...d, program: { items: ((d && d.program && d.program.items) || []) }, price: 300, validationStatus: 'confirmed' });
  const corps = (d) => String((comms.buildMessage({ reservation: enregistre(d), templateId: 'confirmation', channel: 'email' }) || {}).body || '');
  const mailA = fa && fa.dossier ? corps(fa.dossier) : '';
  const mailB = fb && fb.dossier ? corps(fb.dossier) : '';
  ok(/- Minigolf Blacklight, à votre rythme/.test(mailA) && mailA.includes('Fin estimée vers 17:45, à titre indicatif'), '[I] la capture : le mail dit « Fin estimée vers 17:45 », le minigolf à son rythme', mailA.split('\n').filter((l) => /Fin estimée|Minigolf/.test(l)).join(' / '));
  ok(mailB.includes('Fin estimée vers 16:30, à titre indicatif'), '[I] le minigolf dans l attente : « Fin estimée vers 16:30 »', mailB.split('\n').filter((l) => /Fin estimée/.test(l)).join(' / '));

  section('H. L ECRAN, TELEPHONE ET BUREAU');
  await ecran();

  console.log(echecs ? `\nlibre-entier-check: ${echecs} defaut(s).` : '\nlibre-entier-check: ALL OK (une activite libre ne se coupe plus entre deux attentes : elle s y joue tout entiere ou apres, la fin le suit partout, l ecran dit ou)');
  process.exit(echecs ? 1 : 0);
}

async function ecran() {
  const PORT = Number(process.env.PINLANE_LIBRE_PORT || 4493);
  const BASE = `http://127.0.0.1:${PORT}`;
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const server = mock.createServer({ port: PORT });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    for (const largeur of [390, 1280]) {
      for (const [nom, cas] of Object.entries(CAS)) {
        const page = await browser.newPage({ viewport: { width: largeur, height: 900 } });
        const erreurs = [];
        page.on('pageerror', (err) => erreurs.push(String((err && err.message) || err)));
        if (MUTATION && MUTATION.fichier === 'assets/fungalaxy-booking.js') {
          const mute = muter(fs.readFileSync(path.join(ROOT, MUTATION.fichier), 'utf8'), MUTATION);
          await page.route('**/assets/fungalaxy-booking.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: mute }));
        }
        // La visite de chaque cas, telle que le client l aurait posee : le
        // programme et les heures du cas partent avec chaque demande d heures,
        // la reponse est celle du vrai serveur.
        await page.route('**/api/public-availability?**', async (route) => {
          const u = new URL(route.request().url());
          if (u.searchParams.get('type') !== 'visite') return route.continue();
          u.searchParams.set('program', JSON.stringify(cas.program));
          u.searchParams.set('preferredTimes', JSON.stringify(cas.preferredTimes));
          u.searchParams.set('laserGameTimes', JSON.stringify(cas.laserGameTimes));
          u.searchParams.set('softReserve', '1');
          const reponse = await route.fetch({ url: u.toString() });
          return route.fulfill({ response: reponse });
        });
        await page.clock.setFixedTime(new Date(MAINTENANT));
        await page.goto(`${BASE}/fungalaxy/libramont`);
        await page.click('#dayBtn');
        for (let i = 0; i < 4; i += 1) {
          if (await page.$(`#calGrid .fg-cal__day[data-date="${JOUR}"]`)) break;
          await page.click('#calNext');
        }
        await page.click(`#calGrid .fg-cal__day[data-date="${JOUR}"]`);
        await page.fill('#paxInput', String(PAX));
        await page.click('#goActivities');
        for (const it of cas.program) await page.click(`#gridAct .fg-card[data-activity="${it.activityId}"]`);
        await page.click('#goHours');
        await page.waitForSelector('#planZone .fg-visit', { timeout: 20000 });
        await page.waitForTimeout(800);
        const v = await page.evaluate(() => {
          const txt = (n) => (n ? n.textContent.replace(/[\s\u00a0\u202f]+/g, ' ').trim() : '');
          const lignes = Array.from(document.querySelectorAll('#planZone .fg-visit__list > li'));
          return {
            lignes: lignes.map((li) => ({
              classe: li.className,
              heure: txt(li.querySelector(':scope > b')),
              texte: txt(li),
              groupe: txt(li.querySelector('.fg-visit__group b')),
            })),
            span: txt(document.querySelector('#planZone .fg-visit__span')),
            avis: Array.from(document.querySelectorAll('#planZone .fg-visit__warn')).map(txt).join(' | '),
            barre: txt(document.querySelector('#hourSum')),
          };
        });
        const indexDe = (f) => v.lignes.findIndex(f);
        const groupe = (mot) => v.lignes.find((l) => l.groupe === mot) || null;
        const foulee = groupe('Dans la foulée');
        const entre = groupe('Entre les deux');
        const fin = v.lignes.find((l) => /fg-visit__step--out/.test(l.classe)) || {};
        const minigolfs = v.lignes.filter((l) => /Minigolf Blacklight/.test(l.texte)).length;
        if (nom === 'capture') {
          ok(Boolean(foulee) && /Minigolf Blacklight/.test(foulee.texte) && /11 joueurs · à votre rythme · environ 45 min/.test(foulee.texte) && !entre,
            `[H] ${largeur} la capture : le minigolf « Dans la foulée », 11 joueurs, environ 45 min`, JSON.stringify(v.lignes.map((l) => l.texte)));
          // L en-tete compte depuis l arrivee, dix minutes avant le laser.
          ok(fin.heure === '17:45' && v.span === 'de 13:50 à 17:45 environ · 3 h 55 sur place' && /^13:50 → 17:45 environ/.test(v.barre),
            `[H] ${largeur} la capture : « Fin de la visite 17:45 », l en-tete (3 h 55 sur place depuis l arrivee) et la barre du bas aussi`, JSON.stringify({ fin: fin.heure, span: v.span, barre: v.barre }));
          const attentes = v.lignes.filter((l) => /fg-visit__gap/.test(l.classe)).map((l) => l.texte);
          ok(attentes.length === 2 && attentes.every((t) => t === '35 min d’attente'), `[H] ${largeur} la capture : les deux attentes de 35 min restent entieres`, JSON.stringify(attentes));
        } else if (nom === 'trou') {
          const iLaser = indexDe((l) => l.heure === '14:00' && /Laser/.test(l.texte));
          const iEntre = v.lignes.indexOf(entre);
          const iBowling = indexDe((l) => l.heure === '15:30' && /Bowling/.test(l.texte));
          ok(Boolean(entre) && /Minigolf Blacklight/.test(entre.texte) && /11 joueurs · à votre rythme · environ 45 min/.test(entre.texte) && iLaser >= 0 && iLaser < iEntre && iEntre < iBowling,
            `[H] ${largeur} le minigolf « Entre les deux », sans heure fixe, entre le laser et le bowling`, JSON.stringify(v.lignes.map((l) => l.texte)));
          const attente = v.lignes.slice(iEntre + 1, iBowling).filter((l) => /fg-visit__gap/.test(l.classe)).map((l) => l.texte);
          ok(attente.length === 1 && attente[0] === '20 min d’attente', `[H] ${largeur} dessous, l attente qui reste : 20 min (1 h 05 moins les 45 du minigolf)`, JSON.stringify(attente));
          ok(!foulee && minigolfs === 1, `[H] ${largeur} le minigolf ne se redit pas « Dans la foulée »`, JSON.stringify(v.lignes.map((l) => l.texte)));
          ok(fin.heure === '16:30' && /16:30/.test(v.span), `[H] ${largeur} « Fin de la visite 16:30 »`, JSON.stringify({ fin: fin.heure, span: v.span }));
          ok(!/d.attente entre/.test(v.avis), `[H] ${largeur} plus d avis « 1 h 05 d attente » au-dessus de l agenda`, JSON.stringify(v.avis));
        } else {
          const entres = v.lignes.filter((l) => l.groupe === 'Entre les deux');
          const attentes = v.lignes.filter((l) => /fg-visit__gap/.test(l.classe)).map((l) => l.texte);
          ok(entres.length === 1 && /Arcade/i.test(entres[0].texte) && !/Minigolf/.test(entres[0].texte),
            `[H] ${largeur} une visite avec des arcades : elles se disent « Entre les deux », dans une attente de 35 min`, JSON.stringify(v.lignes.map((l) => l.texte)));
          ok(attentes.length === 1 && attentes[0] === '35 min d’attente', `[H] ${largeur} l autre attente reste entiere, celle des arcades n en garde que 5 min (rien a dire)`, JSON.stringify(attentes));
          ok(Boolean(foulee) && /Minigolf Blacklight/.test(foulee.texte) && !/Arcade/i.test(foulee.texte) && fin.heure === '17:45',
            `[H] ${largeur} le minigolf seul « Dans la foulée », et « Fin de la visite 17:45 »`, JSON.stringify({ foulee: foulee && foulee.texte, fin: fin.heure }));
        }
        ok(erreurs.length === 0, `[H] ${largeur} ${nom} : aucune erreur de page`, erreurs.join(' | '));
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv.includes('--mutate')) {
  const { spawnSync } = require('child_process');
  let tuees = 0;
  MUTATIONS.forEach((m, i) => {
    const run = spawnSync(process.execPath, [__filename], { env: { ...process.env, PINLANE_LIBRE_MUTATION: String(i + 1) }, encoding: 'utf8' });
    const sortie = `${run.stdout || ''}${run.stderr || ''}`;
    const servie = sortie.indexOf(MUTATION_PREUVE) >= 0;
    const tuee = servie && run.status === 1;
    if (tuee) tuees += 1;
    console.log(`${tuee ? 'TUEE   ' : 'SURVIT '} ${m.nom}${servie ? '' : ' (mutation non servie)'}${tuee ? '' : `  [code ${run.status}]`}`);
  });
  console.log(tuees === MUTATIONS.length ? `\nlibre-entier-check --mutate: ${tuees}/${MUTATIONS.length} mutations tuees` : `\nlibre-entier-check --mutate: ${MUTATIONS.length - tuees} mutation(s) survivante(s)`);
  process.exit(tuees === MUTATIONS.length ? 0 : 1);
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}

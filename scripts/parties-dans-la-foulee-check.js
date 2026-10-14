// LES PARTIES DE LASER « DANS LA FOULEE » COMPTENT DANS LA VISITE.
//
// Movsar, 2026-09-29, capture de l ecran des heures : une visite annoncee
// « jusqu a 14:00 » avec deux parties de laser encore sans heure, « la 2
// parties de laser ca dure 40 minutes minimum ». Le plan ne pose pas d heure
// aux parties restantes (l equipe les place sur place), mais la visite les
// contient : elles se jouent a la suite, chaque groupe au prochain depart de
// l arene. Et la fin affichee d une formule contenait la marge de risque de
// l equipe (`opsPlan.endTime`), vingt minutes de trop sur l ecran.
//
// Ce gate joue le vrai moteur et la vraie API (en processus, aucune base,
// aucun envoi), 12 joueurs, un mercredi a plus d une semaine :
//   [A] visite bowling 1 h + 3 parties de laser, la partie 1 posee : la fin
//       de visite contient les deux parties restantes, a la suite de ce qui
//       est pose, et se dit SANS la marge de l equipe ;
//   [B] a la fermeture : une partie 1 dont la suite deborde reste une heure
//       possible, la grille le dit (« Plus le temps pour les parties de laser
//       restantes avant 22:00 »), la fin affichee s arrete a la fermeture et
//       le manque est dit a part ;
//   [C] formules 2, 4 et 5 : chaque creneau dit sa fin sans la marge, arretee
//       a la fermeture quand la partie a la suite la depasse ;
//   [D] formule 4 : UNE heure touchee (laser OU bowling) compose la visite,
//       l autre ancre a l heure que la grille propose ; un laser place sur
//       place ne recoit aucune heure ;
//   [E] contre-epreuves : chaque regle retiree, ce gate ROUGIT. Les mutations
//       passent par un crochet de compilation : aucun fichier n est reecrit ;
//   [F] une minute dans la foulee ne se compte qu une fois : laser pose tot,
//       bowling plus tard, et un jour aux pistes prises ;
//   [G] la fenetre Reserver du comptoir dit la meme fin que le tunnel ;
//   [H] l en-tete de la fiche de l equipe aussi, une fois le dossier cree ;
//   [I] une formule creee au comptoir garde la fin et la duree de son plan.
//
// Lancement : node scripts/parties-dans-la-foulee-check.js
'use strict';
const path = require('path');
const Module = require('module');

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.RESEND_API_KEY;
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'lib', 'ops-engine.js');
const API = path.join(ROOT, 'api', 'public-availability.js');
const CENTRE = 'libramont';
const PAX = 12;

let echecs = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `\n      ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }

// LE CROCHET DE COMPILATION, pose AVANT tout require du moteur : une
// contre-epreuve remplace une ligne du source au moment ou Node le compile.
// Le depot n est jamais touche ; `appliquee` prouve que la mutation a mordu.
const mutation = { fichier: '', ancre: '', remplace: '', appliquee: 0, trouvee: -1 };
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerAvecMutation(source, fichier) {
  if (mutation.fichier && path.resolve(fichier) === mutation.fichier) {
    mutation.trouvee = source.split(mutation.ancre).length - 1;
    if (mutation.trouvee === 1) {
      source = source.split(mutation.ancre).join(mutation.remplace);
      mutation.appliquee += 1;
    }
  }
  return compiler.call(this, source, fichier);
};

// L API, rechargee a neuf (une contre-epreuve la recharge mutee). Aucune
// reservation ce jour-la ; le limiteur de debit est neutralise (ce gate fait
// des dizaines d appels, un refus du limiteur ressemblerait a un refus metier).
function charger({ reservations = [], pax = PAX } = {}) {
  Object.keys(require.cache)
    .filter((cle) => cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`))
    .forEach((cle) => { delete require.cache[cle]; });
  const limiteur = require.resolve(path.join(ROOT, 'lib/rate-limit'));
  require.cache[limiteur] = { id: limiteur, filename: limiteur, loaded: true, exports: {
    enforceRateLimit: () => false,
    checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
    getClientIp: () => 'gate',
  } };
  const database = require(path.join(ROOT, 'lib/database.js'));
  database.readAvailabilitySnapshot = async (date, centerId = CENTRE) => ({ date, centerId, reservations: reservations.map((r) => ({ ...r, date })), laneStatuses: {}, blocks: [] });
  const api = require(API);
  const { disponibiliteInterne } = require(path.join(ROOT, 'lib/disponibilite-interne.js'));
  return (date, extra = {}) => disponibiliteInterne({
    centerId: CENTRE, date, pax: String(pax),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])),
  }, { handler: api });
}

const min = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const PROGRAMME = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 3 }];
const visite = (extra = {}) => ({ type: 'visite', program: PROGRAMME, softReserve: '1', ...extra });
const partie1 = (h) => visite({ preferredTimes: { laser_game: h }, laserGameTimes: [h] });
const piste = (json, id) => ((((json || {}).anchors || {}).activities || []).find((a) => a.activityId === id) || { times: [] });
const creneau = (rep) => (((rep || {}).json || {}).slots || [])[0] || null;
const blocs = (slot, id) => (((slot || {}).opsPlan || {}).resourceBlocks || []).filter((b) => b.activityId === id && b.startTime);
// La fin que l ecran doit dire : celle du plan, moins la marge de l equipe.
const finSansMarge = (slot) => min(slot.opsPlan.endTime) - Math.max(0, Number(slot.opsPlan.bufferMinutes) || 0);

// Un mercredi a plus d une semaine, au fuseau du centre, ouvert de 12:00 a
// 22:00 et ou la formule 4 se reserve : jamais aujourd hui, jamais un jour
// ferie aux horaires changes.
async function choisirDate(dispo) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d + 7));
  for (let k = 0; k < 16; k += 1) {
    do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 3);
    const date = c.toISOString().slice(0, 10);
    const rep = await dispo(date, { type: 'formule', formuleId: 'f4' });
    const s = (rep.json || {}).schedule || {};
    if (rep.status === 200 && Number(s.open) === 12 && Number(s.close) === 22 && ((rep.json || {}).slots || []).length) return date;
  }
  return '';
}

async function mesurer(dispo, date) {
  const r = { date };
  r.a1 = creneau(await dispo(date, partie1('13:00')));
  r.a2 = creneau(await dispo(date, partie1('20:30')));
  r.bRep = await dispo(date, partie1('21:00'));
  r.b = creneau(r.bRep);
  r.grille = piste((await dispo(date, visite())).json, 'laser_game').times;
  r.formules = {};
  for (const f of ['f2', 'f4', 'f5']) r.formules[f] = ((await dispo(date, { type: 'formule', formuleId: f })).json || {}).slots || [];
  r.d1 = await dispo(date, { type: 'formule', formuleId: 'f4', preferredTimes: { laser_game: '16:00' }, laserGameTimes: ['16:00'] });
  r.d2 = await dispo(date, { type: 'formule', formuleId: 'f4', preferredTimes: { bowling: '15:00' } });
  r.d3 = await dispo(date, { type: 'formule', formuleId: 'f1', laserPlacement: 'onsite', preferredTimes: { bowling: '15:00' } });
  return r;
}

// [F] UNE MINUTE DANS LA FOULEE NE SE COMPTE QU UNE FOIS (2026-10-13). Movsar :
// « il ne compte pas les activités qui sont dans la foulée ». Une partie de
// laser posee tot et un bowling plus tard laissent un trou : le moteur y loge
// les parties restantes, et le libre (arcades, mini golf) s y creditait aussi.
// Laser 13:00 et bowling 15:00 annoncaient 16:00 pour deux comme pour trois
// parties ; un jour aux pistes prises de 13:30 a 15:30, 15:40 pour une, deux
// ou trois parties. Le plancher : rien ne se joue en meme temps, donc la
// visite dure au moins, depuis sa premiere heure, ses fenetres a heure, ses
// parties dans la foulee et son libre (et jamais moins que son dernier bloc).
// LE LIBRE SE JOUE D UN BLOC (2026-10-14, Movsar : « FIN estimé a 17h et le
// mini golf se joue quand du coup ? ») : un minigolf ne se coupe pas entre
// deux attentes. La fin n est donc plus toujours le plancher : c est la fin
// du rangement d un bloc (finDuRangement, refaite ici sans le moteur), qui ne
// passe jamais sous lui.
const PROGRAMME_F = (games) => [{ activityId: 'arcade_time' }, { activityId: 'laser_game', games }, { activityId: 'minigolf_blacklight' }, { activityId: 'bowling', duration: 1 }];
const PISTES_PRISES = Array.from({ length: 8 }, (_, k) => ({
  id: 9101 + k, centerId: CENTRE, startTime: '13:30', duration: 2, totalDuration: 2, pax: 5,
  lanes: [k + 1], laneCount: 1, status: 'confirmed', validationStatus: 'confirmed', type: 'bowling', program: null, opsPlan: null,
}));
async function mesurerFoulee(date) {
  const libre = charger({ pax: 6 });
  const trou = {};
  for (const games of [2, 3]) {
    trou[games] = await libre(date, { type: 'visite', program: PROGRAMME_F(games), softReserve: '1', preferredTimes: { laser_game: '13:00', bowling: '15:00' }, laserGameTimes: ['13:00'] });
  }
  const pleine = charger({ pax: 6, reservations: PISTES_PRISES });
  const chargee = {};
  for (const games of [1, 2, 3]) {
    chargee[games] = await pleine(date, { type: 'visite', program: PROGRAMME_F(games), softReserve: '1', preferredTimes: { laser_game: '13:00' }, laserGameTimes: ['13:00'] });
  }
  return { trou, chargee };
}
// La fin attendue : la fin du plan sans la marge, plus le libre qui ne tient
// dans aucun trou. Un trou s ouvre entre deux parties du groupe ; la foulee en
// prend le debut, apres la derniere partie de laser posee. Chaque activite
// libre y tient TOUT ENTIERE ou se joue apres : toutes les places s essaient,
// la plus tot gagne.
function finDuRangement(p, lignes) {
  const fenetres = new Map();
  (p.resourceBlocks || []).filter((b) => b.activityId && b.startTime && b.endTime).forEach((b) => {
    const cle = `${b.activityId}#${b.countIndex || 1}`;
    const d = min(b.startTime);
    const f = min(b.endTime);
    const deja = fenetres.get(cle);
    fenetres.set(cle, { d: deja ? Math.min(deja.d, d) : d, f: deja ? Math.max(deja.f, f) : f, laser: b.activityId === 'laser_game' });
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
function plancherDeVisite(rep, lignesDuDossier = null) {
  const j = (rep && rep.json) || {};
  const s = (j.slots || [])[0];
  if (!s || !s.visitEndTime) return null;
  const p = s.opsPlan || {};
  const fenetres = new Map();
  (p.resourceBlocks || []).filter((b) => b.activityId && b.startTime && b.endTime).forEach((b) => {
    const cle = `${b.activityId}#${b.countIndex || 1}`;
    const d = min(b.startTime);
    const f = min(b.endTime);
    const deja = fenetres.get(cle);
    fenetres.set(cle, deja ? { d: Math.min(deja.d, d), f: Math.max(deja.f, f) } : { d, f });
  });
  const w = [...fenetres.values()];
  if (!w.length) return null;
  const aHeure = w.reduce((t, x) => t + x.f - x.d, 0);
  const foulee = Math.max(0, Number((p.laserPassPlan || {}).followOnMinutes) || 0);
  const libre = Math.round(Number((j.program || {}).freeMinutes) || 0);
  const plancher = Math.max(Math.max(...w.map((x) => x.f)), Math.min(...w.map((x) => x.d)) + aHeure + foulee + libre);
  const attendue = finDuRangement(p, Array.isArray(lignesDuDossier) ? lignesDuDossier : ((j.program || {}).freeItems || []));
  return { fin: min(s.visitEndTime), plancher, attendue, detail: `affichee ${s.visitEndTime}, rangement d un bloc ${hhmm(attendue)}, plancher ${hhmm(plancher)} (a heure ${aHeure}, foulee ${foulee}, libre ${libre})` };
}
const sousLePlancher = (m) => [...Object.values(m.trou), ...Object.values(m.chargee)].map(plancherDeVisite).some((x) => !x || x.fin < x.plancher);

// [G] LA FENETRE RESERVER DIT LA MEME FIN (2026-10-13). Au comptoir, elle
// annoncait « fin des activités » au dernier bloc a heure : 14:25 pour une
// visite que le tunnel finissait a 16:15. Les memes visites, composees par
// l equipe sur le vrai chemin du comptoir (planifierPourLaFenetre, moteur
// reel, journee lue en memoire).
async function mesurerFenetre(date) {
  charger();
  const { planifierPourLaFenetre } = require(path.join(ROOT, 'lib/reserver-fenetre.js'));
  const session = { authorizedCenterId: CENTRE };
  const corps = (games, heures) => ({
    centerId: CENTRE, date, pax: 6, startTime: '13:00', type: 'visite', program: PROGRAMME_F(games),
    name: 'Gate foulee', phone: '+32470000000', email: 'gate@example.test',
    preference: { preferredTimes: heures, laserGameTimes: ['13:00'], laserPlacement: 'scheduled' },
  });
  const vide = async () => ({ reservations: [], laneStatuses: {} });
  const prise = async (jour) => ({ reservations: PISTES_PRISES.map((r) => ({ ...r, date: jour })), laneStatuses: {} });
  const trou = {};
  for (const games of [2, 3]) trou[games] = await planifierPourLaFenetre(corps(games, { laser_game: '13:00', bowling: '15:00' }), session, { readState: vide });
  // Au comptoir, l equipe pose les deux heures (la fenetre ne cherche pas
  // l heure du bowling comme le tunnel) : celles que le tunnel retient ce
  // jour-la, laser 13:00 et bowling 15:30 apres les pistes prises.
  const chargee = {};
  for (const games of [1, 2, 3]) chargee[games] = await planifierPourLaFenetre(corps(games, { laser_game: '13:00', bowling: '15:30' }), session, { readState: prise });
  return { trou, chargee };
}
// Le meme plancher que le tunnel, lu sur le dossier que le comptoir creerait.
// Le programme d un dossier ne garde que ses lignes : le libre se recompte sur
// celles qui n ont pas d heure.
const plancherDeFenetre = (resultat) => {
  if (!(resultat && resultat.plan && resultat.dossier)) return null;
  const lignes = ((resultat.dossier.program || {}).items || []).filter((ligne) => ligne && !ligne.planned);
  const freeMinutes = lignes.reduce((total, ligne) => total + Math.max(0, Math.round(Number(ligne.minutes) || 0)), 0);
  return plancherDeVisite({ json: { slots: [{ visitEndTime: resultat.plan.fin, opsPlan: resultat.dossier.opsPlan || {} }], program: { freeMinutes } } }, lignes);
};
const fenetreSousLePlancher = (g) => [...Object.values(g.trou), ...Object.values(g.chargee)].map(plancherDeFenetre).some((x) => !x || x.fin < x.plancher);

// [H] LA FICHE DE L EQUIPE DIT LA MEME FIN (2026-10-13). L en-tete de la fiche
// et l ecran de l equipe (getStaffTerrainSpan, assets/app-main.js) creditaient
// au libre les trous bruts, foulee comprise : la visite, une fois creee, y
// finissait avant l heure que le client et le comptoir avaient lue. Les
// fonctions de la console sont jouees en bac a sable (booking-core entier, les
// fonctions de la fiche extraites d app-main) ; la contre-epreuve mute le texte.
// [I] UNE FORMULE CREEE AU COMPTOIR GARDE LA FIN DE SA VISITE (2026-10-13). Le
// plan de confiance de la console (normalizeTrustedPlan, lib/reservation-ops.js)
// reecrivait sa fin sur la derniere ressource : F5 a 13:00 se creait « 13:25,
// 25 min » pour une visite jusqu a 15:05. Le vrai chemin du comptoir, canal
// staff, avec le plan que la console a recu du moteur.
async function creerAuComptoir(date, slot) {
  charger();
  const { prepareReservationOps } = require(path.join(ROOT, 'lib', 'reservation-ops.js'));
  const ops = await prepareReservationOps({
    centerId: CENTRE, date, startTime: slot.time, type: 'formule', formuleId: 'f5', pax: PAX, opsPlan: slot.opsPlan,
    name: 'Gate foulee', phone: '+32470000000', email: 'gate@example.test',
  }, 'staff', { readState: async () => ({ reservations: [], laneStatuses: {} }) });
  return (ops && ops.opsPlan) || null;
}
const memePlanQueLeMoteur = (plan, slot) => Boolean(plan && slot) && plan.endTime === slot.opsPlan.endTime && Number(plan.totalMinutes) === Number(slot.opsPlan.totalMinutes);
const ANCRE_FICHE = '    let dedans = foulee - dehors;';
function chargerFiche(muter = false) {
  const vm = require('vm');
  const fs = require('fs');
  const ctx = vm.createContext({ console, state: { booking: {}, reservations: [] }, document: { getElementById: () => null } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'booking-core.js'), 'utf8'), ctx);
  let source = fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8').split('\r\n').join('\n');
  const trouvees = source.split(ANCRE_FICHE).length - 1;
  if (muter) source = source.split(ANCRE_FICHE).join('    let dedans = 0;');
  const fonction = (nom) => {
    const debut = source.indexOf(`\nfunction ${nom}(`);
    if (debut < 0) throw new Error(`${nom} introuvable dans app-main.js`);
    return source.slice(debut, source.indexOf('\nfunction ', debut + 1));
  };
  vm.runInContext(['getStaffResourceWindows', 'getStaffFormulaTimedItems', 'catalogueDeLigne', 'ligneALaJournee', 'getVisiteLibreApres', 'getStaffTerrainSpan'].map(fonction).join('\n'), ctx);
  return {
    trouvees,
    finDeLaFiche: (dossier) => {
      ctx.dossier = JSON.parse(JSON.stringify(dossier));
      return hhmm(Math.round(vm.runInContext('getStaffTerrainSpan(dossier)', ctx).end * 60));
    },
  };
}

// [A] La fin contient les parties restantes, a la suite de ce qui est pose.
function verifierSuite(slot) {
  if (!slot) return { ok: false, detail: 'aucun creneau' };
  const lpp = slot.opsPlan.laserPassPlan || {};
  const lasers = blocs(slot, 'laser_game');
  const autres = (slot.opsPlan.resourceBlocks || []).filter((b) => b.activityId && b.activityId !== 'laser_game' && b.startTime);
  if (!lasers.length) return { ok: false, detail: 'aucune partie posee' };
  const arene = min(lasers[0].endTime) - min(lasers[0].startTime);
  const finLaser = Math.max(...lasers.map((b) => min(b.endTime)));
  const suite = Number(lpp.followOnMinutes) || 0;
  // La suite part de la derniere partie posee ; si elle tombe sur une autre
  // activite du groupe, elle part de la fin de tout ce qui est pose.
  const heurte = autres.some((b) => min(b.startTime) < finLaser + suite && finLaser < min(b.endTime));
  const depuis = heurte ? Math.max(finLaser, ...autres.map((b) => min(b.endTime))) : finLaser;
  const fin = finSansMarge(slot);
  const detail = `parties restantes ${lpp.remainingGames}, arene ${arene} min, suite ${suite} min depuis ${hhmm(depuis)}, fin du plan ${slot.opsPlan.endTime} moins ${slot.opsPlan.bufferMinutes} min de marge = ${hhmm(fin)}, affichee ${slot.visitEndTime}`;
  return {
    ok: lpp.remainingGames === 2 && suite >= 2 * arene && fin >= depuis + suite && slot.visitEndTime === hhmm(Math.min(fin, 22 * 60)),
    detail,
  };
}

async function main() {
  const dispo = charger();
  const date = await choisirDate(dispo);
  if (!ok(Boolean(date), 'MONTAGE un mercredi a plus d une semaine, ouvert de 12:00 a 22:00, ou la formule 4 se reserve', 'aucun sur seize semaines')) process.exit(1);
  console.log(`[date] mercredi ${date}, ${PAX} joueurs, aucune reservation ce jour-la`);
  const r = await mesurer(dispo, date);

  section('A. LA FIN DE VISITE CONTIENT LES PARTIES DANS LA FOULEE');
  const a1 = verifierSuite(r.a1);
  ok(a1.ok, 'partie 1 a 13:00 (bowling pose a cote) : les deux parties restantes se jouent a la suite, la fin les contient, sans la marge', a1.detail);
  const a2 = verifierSuite(r.a2);
  ok(a2.ok, 'partie 1 a 20:30 (bowling avant) : meme regle', a2.detail);

  section('B. A LA FERMETURE, L HEURE RESTE POSSIBLE ET LE DIT');
  const b = r.b;
  ok(r.bRep.status === 200 && Boolean(b), 'la partie 1 a 21:00 se reserve (la suite deborde, l equipe place les parties restantes)', `${r.bRep.status} ${JSON.stringify(((r.bRep.json || {}).message) || '')}`);
  if (b) {
    const fin = finSansMarge(b);
    ok(fin > 22 * 60 && b.visitEndsAtClose === true && b.visitEndTime === '22:00' && b.visitShortfallMinutes === fin - 22 * 60,
      'la fin affichee s arrete a 22:00 et le manque est dit a part', `fin ${hhmm(fin)}, affichee ${b.visitEndTime}, fermeture ${b.visitEndsAtClose}, manque ${b.visitShortfallMinutes}`);
  }
  const g = (t) => r.grille.find((x) => x.time === t) || {};
  // Seules a pouvoir deborder (la visite n a rien d autre sans heure), les
  // parties restantes sont NOMMEES, numero par numero (2026-09-30).
  const phrase = 'Plus le temps pour les parties 2 et 3 de laser avant 22:00';
  ok(['21:00', '21:30'].every((t) => g(t).ok !== false && g(t).warning && g(t).warning.code === 'schedule_free' && g(t).warning.reason === phrase),
    `la grille dit 21:00 et 21:30 possibles, avec « ${phrase} »`, JSON.stringify([g('21:00'), g('21:30')]));
  ok(['20:00', '20:30'].every((t) => g(t).time && g(t).ok !== false && !g(t).warning),
    '20:00 et 20:30, ou tout tient avant 22:00 : possibles, sans avertissement', JSON.stringify([g('20:00'), g('20:30')]));

  section('C. UNE FORMULE DIT SA FIN SANS LA MARGE DE L EQUIPE');
  let coupees = 0;
  const fautes = [];
  let parFormule = 0;
  for (const [f, slots] of Object.entries(r.formules)) {
    if (slots.length) parFormule += 1;
    slots.forEach((s) => {
      const fin = finSansMarge(s);
      const attendu = fin > 22 * 60
        ? { visitEndTime: '22:00', visitEndsAtClose: true, visitShortfallMinutes: fin - 22 * 60 }
        : { visitEndTime: hhmm(fin), visitEndsAtClose: undefined, visitShortfallMinutes: undefined };
      if (fin > 22 * 60) coupees += 1;
      if (!(Number(s.opsPlan.bufferMinutes) > 0) || s.visitEndTime !== attendu.visitEndTime || s.visitEndsAtClose !== attendu.visitEndsAtClose || s.visitShortfallMinutes !== attendu.visitShortfallMinutes) {
        fautes.push(`${f} ${s.time} : plan ${s.opsPlan.endTime} marge ${s.opsPlan.bufferMinutes}, affiche ${s.visitEndTime} ${s.visitEndsAtClose ? `(manque ${s.visitShortfallMinutes})` : ''}`);
      }
    });
  }
  ok(parFormule === 3, 'MONTAGE les formules 2, 4 et 5 ont des creneaux ce jour-la');
  ok(fautes.length === 0, 'chaque creneau des formules 2, 4 et 5 : la fin du plan moins la marge, arretee a 22:00', fautes.slice(0, 4).join(' | '));
  ok(coupees >= 3, `le dernier creneau de chaque formule deborde par sa partie a la suite, et s arrete a 22:00 (${coupees} creneaux)`);
  const suitesF = Object.values(r.formules).map((slots) => ((slots[0] || {}).opsPlan || {}).laserPassPlan || {});
  ok(suitesF.every((l) => l.remainingGames === 1 && Number(l.followOnMinutes) >= 25),
    'dans chacune, la 2e partie de laser se joue dans la foulee et son temps est compte', JSON.stringify(suitesF.map((l) => ({ reste: l.remainingGames, suite: l.followOnMinutes }))));

  section('D. UNE HEURE TOUCHEE COMPOSE LA VISITE (FORMULE 4)');
  const d1 = creneau(r.d1);
  const def1 = (((r.d1.json || {}).anchors || {}).defaultTimes) || {};
  ok(Boolean(d1) && blocs(d1, 'laser_game').some((x) => x.startTime === '16:00' && Number(x.countIndex || 1) === 1) && blocs(d1, 'bowling').length && blocs(d1, 'bowling')[0].startTime === def1.bowling,
    'laser seul a 16:00 : la visite se compose, le bowling a l heure que la grille propose', d1 ? `bowling ${blocs(d1, 'bowling').map((x) => x.startTime).join(',')}, propose ${def1.bowling}` : `aucun creneau : ${JSON.stringify((r.d1.json || {}).message)}`);
  const d2 = creneau(r.d2);
  const def2 = (((r.d2.json || {}).anchors || {}).defaultTimes) || {};
  ok(Boolean(d2) && blocs(d2, 'bowling').some((x) => x.startTime === '15:00') && blocs(d2, 'laser_game').some((x) => x.startTime === def2.laser_game),
    'bowling seul a 15:00 : la visite se compose, la partie 1 a l heure que la grille propose', d2 ? `laser ${blocs(d2, 'laser_game').map((x) => x.startTime).join(',')}, propose ${def2.laser_game}` : `aucun creneau : ${JSON.stringify((r.d2.json || {}).message)}`);
  const d3 = creneau(r.d3);
  ok(Boolean(d3) && !((d3.opsPlan || {}).resourceBlocks || []).some((x) => x.resourceType === 'laser_arena') && ((d3.opsPlan || {}).laserPassPlan || {}).remainingGames === 1,
    'formule 1, laser place sur place : aucune heure donnee au laser, l arene reste libre', d3 ? JSON.stringify((d3.opsPlan || {}).laserPassPlan) : `aucun creneau : ${JSON.stringify((r.d3.json || {}).message)}`);

  section('F. UNE MINUTE DANS LA FOULEE NE SE COMPTE QU UNE FOIS');
  const f = await mesurerFoulee(date);
  for (const games of [2, 3]) {
    const x = plancherDeVisite(f.trou[games]);
    ok(Boolean(x) && x.fin === x.attendue && x.fin >= x.plancher, `laser 13:00 et bowling 15:00, ${games} parties, arcades et mini golf : la fin est celle du rangement d un bloc, jamais sous ce qui se joue d affilee`, x ? x.detail : `aucun creneau : ${JSON.stringify(((f.trou[games] || {}).json || {}).message || '')}`);
  }
  const t2 = plancherDeVisite(f.trou[2]);
  const t3 = plancherDeVisite(f.trou[3]);
  ok(Boolean(t2 && t3) && t3.fin > t2.fin, 'une troisieme partie recule la fin', t2 && t3 ? `${hhmm(t2.fin)} puis ${hhmm(t3.fin)}` : '');
  // Jour charge : le bowling ne commence qu a 15:30. Le trou de 13:25 a 15:30
  // loge la 2e partie et le libre ; la 3e le deborde. La fin suit, minute
  // pour minute, et ne se fige plus a la meme heure quoi que le groupe joue.
  for (const games of [1, 2, 3]) {
    const x = plancherDeVisite(f.chargee[games]);
    ok(Boolean(x) && x.fin === x.attendue && x.fin >= x.plancher, `pistes prises de 13:30 a 15:30, laser 13:00, ${games} partie(s) : la fin est celle du rangement d un bloc, jamais sous ce qui se joue d affilee`, x ? x.detail : `aucun creneau : ${JSON.stringify(((f.chargee[games] || {}).json || {}).message || '')}`);
  }

  section('G. LA FENETRE RESERVER DIT LA FIN DU TUNNEL');
  const comptoir = await mesurerFenetre(date);
  for (const games of [2, 3]) {
    const x = plancherDeFenetre(comptoir.trou[games]);
    const tunnel = creneau(f.trou[games]);
    ok(Boolean(x) && x.fin === x.attendue && x.fin >= x.plancher, `fenetre Reserver, laser 13:00 et bowling 15:00, ${games} parties : la fin est celle du rangement d un bloc, jamais sous ce qui se joue d affilee`, x ? x.detail : 'aucun plan');
    ok(Boolean(x && tunnel) && comptoir.trou[games].plan.fin === tunnel.visitEndTime, `fenetre Reserver, ${games} parties : la meme fin que le tunnel`, `fenetre ${comptoir.trou[games] && comptoir.trou[games].plan && comptoir.trou[games].plan.fin}, tunnel ${tunnel && tunnel.visitEndTime}`);
  }
  for (const games of [1, 2, 3]) {
    const x = plancherDeFenetre(comptoir.chargee[games]);
    const tunnel = creneau(f.chargee[games]);
    ok(Boolean(x) && x.fin === x.attendue && x.fin >= x.plancher, `fenetre Reserver, pistes prises de 13:30 a 15:30, ${games} partie(s) : la fin est celle du rangement d un bloc, jamais sous ce qui se joue d affilee`, x ? x.detail : 'aucun plan');
    ok(Boolean(x && tunnel) && comptoir.chargee[games].plan.fin === tunnel.visitEndTime, `fenetre Reserver, jour charge, ${games} partie(s) : la meme fin que le tunnel`, `fenetre ${comptoir.chargee[games] && comptoir.chargee[games].plan && comptoir.chargee[games].plan.fin}, tunnel ${tunnel && tunnel.visitEndTime}`);
  }

  section('H. LA FICHE DE L EQUIPE DIT LA MEME FIN');
  const fiche = chargerFiche();
  const casFiche = [
    ...[2, 3].map((games) => ({ nom: `laser 13:00 et bowling 15:00, ${games} parties`, dossier: comptoir.trou[games].dossier, tunnel: creneau(f.trou[games]) })),
    ...[1, 2, 3].map((games) => ({ nom: `jour charge, ${games} partie(s)`, dossier: comptoir.chargee[games].dossier, tunnel: creneau(f.chargee[games]) })),
  ];
  casFiche.forEach((c) => {
    const fin = fiche.finDeLaFiche(c.dossier);
    ok(Boolean(c.tunnel) && fin === c.tunnel.visitEndTime, `fiche, ${c.nom} : l en-tete dit la fin du tunnel`, `fiche ${fin}, tunnel ${c.tunnel && c.tunnel.visitEndTime}`);
  });

  section('I. UNE FORMULE CREEE AU COMPTOIR GARDE LA FIN DE SA VISITE');
  const f5 = (r.formules.f5 || []).find((s) => s.time === '13:00') || (r.formules.f5 || [])[0] || null;
  const planComptoir = f5 ? await creerAuComptoir(date, f5) : null;
  ok(memePlanQueLeMoteur(planComptoir, f5), `formule 5 a ${f5 ? f5.time : '?'}, creee au comptoir avec le plan de sa console : la fin et la duree du moteur`,
    `comptoir ${planComptoir && planComptoir.endTime} (${planComptoir && planComptoir.totalMinutes} min), moteur ${f5 && f5.opsPlan.endTime} (${f5 && f5.opsPlan.totalMinutes} min)`);

  section('E. CONTRE-EPREUVES (chaque regle retiree, ce gate ROUGIT)');
  const contrePreuves = [
    {
      nom: 'sans les parties a la suite dans la fin de visite',
      fichier: ENGINE,
      ancre: '    visitEnd = Math.max(visitEnd, partiesALaSuite.end, firstStart + sequentialMinutes + partiesALaSuite.minutes, passRetenu ? passRetenu.fin : 0);',
      remplace: '    void 0;',
      rougit: (m) => !verifierSuite(m.a1).ok && !verifierSuite(m.a2).ok,
    },
    {
      nom: 'sans l avertissement des parties restantes a la fermeture',
      fichier: ENGINE,
      ancre: '  if (!warning && finComplete > window.close) {',
      remplace: '  if (false) {',
      rougit: (m) => ['21:00', '21:30'].some((t) => { const x = m.grille.find((y) => y.time === t) || {}; return !(x.warning && x.warning.reason); }),
    },
    {
      nom: 'la fermeture jugee avec les parties a la suite',
      fichier: ENGINE,
      ancre: '  const finReservee = Number.isFinite(raw.endWithoutPendingParties) ? raw.endWithoutPendingParties : raw.end;',
      remplace: '  const finReservee = raw.end;',
      rougit: (m) => !m.b || (m.grille.find((y) => y.time === '21:00') || {}).ok === false,
    },
    {
      nom: 'une formule qui affiche la marge comme du temps de visite',
      fichier: API,
      ancre: '        const fin = Math.max(debut, Math.round(timeToNum(plan.endTime) * 60) - Math.max(0, Number(plan.bufferMinutes) || 0));',
      remplace: '        const fin = Math.max(debut, Math.round(timeToNum(plan.endTime) * 60));',
      rougit: (m) => Object.values(m.formules).some((slots) => slots.some((s) => s.visitEndTime !== hhmm(Math.min(finSansMarge(s), 22 * 60)))),
    },
    {
      nom: 'le libre credite les trous ou la foulee se joue deja',
      fichier: ENGINE,
      ancre: '  let dedans = foulee - dehors;',
      remplace: '  let dedans = 0;',
      foulee: true,
      rougit: (m) => sousLePlancher(m),
    },
    {
      nom: 'la fenetre Reserver s arrete au dernier bloc a heure',
      fichier: path.join(ROOT, 'lib', 'reserver-fenetre.js'),
      ancre: '    fin: plan ? finDeLaVisite(plan, dossier) : \'\',',
      remplace: '    fin: plan ? finDesActivites(plan) : \'\',',
      fenetre: true,
      rougit: (m) => fenetreSousLePlancher(m),
    },
    {
      nom: 'le plan de confiance finit a sa derniere ressource',
      fichier: path.join(ROOT, 'lib', 'reservation-ops.js'),
      ancre: '    ...(Array.isArray(timeline) ? timeline : [])',
      remplace: '    ...[]',
      comptoir: true,
      rougit: (plan) => !memePlanQueLeMoteur(plan, f5),
    },
    {
      nom: 'une formule qui exige les deux heures',
      fichier: API,
      ancre: '                preferredTimes: heuresCompletes,',
      remplace: '                preferredTimes,',
      rougit: (m) => !creneau(m.d1) || !creneau(m.d2),
    },
  ];
  for (const c of contrePreuves) {
    Object.assign(mutation, { fichier: c.fichier, ancre: c.ancre, remplace: c.remplace, appliquee: 0, trouvee: -1 });
    let mesure = null;
    try {
      mesure = c.foulee ? await mesurerFoulee(date) : c.fenetre ? await mesurerFenetre(date) : c.comptoir ? await creerAuComptoir(date, f5) : await mesurer(charger(), date);
    } finally {
      Object.assign(mutation, { fichier: '', ancre: '', remplace: '' });
    }
    if (!ok(mutation.appliquee >= 1 && mutation.trouvee === 1, `contre-epreuve montable : « ${c.nom} » trouve son ancre une fois dans ${path.basename(c.fichier)}`, `trouvee ${mutation.trouvee} fois, appliquee ${mutation.appliquee}`)) continue;
    ok(c.rougit(mesure), `${c.nom} : ce gate ROUGIRAIT`);
  }
  const ficheMutee = chargerFiche(true);
  if (ok(ficheMutee.trouvees === 1, 'contre-epreuve montable : « la fiche credite les trous ou la foulee se joue deja » trouve son ancre une fois dans app-main.js', `trouvee ${ficheMutee.trouvees} fois`)) {
    ok(casFiche.some((c) => ficheMutee.finDeLaFiche(c.dossier) !== (c.tunnel && c.tunnel.visitEndTime)), 'la fiche credite les trous ou la foulee se joue deja : ce gate ROUGIRAIT');
  }
  // Le vrai moteur, remis : la mesure d origine se retrouve a l identique.
  const retour = await mesurer(charger(), date);
  ok(verifierSuite(retour.a1).ok && Boolean(retour.b) && Boolean(creneau(retour.d1)), 'moteur et API d origine rechargees : le verdict d origine revient');
  ok(!sousLePlancher(await mesurerFoulee(date)), 'API d origine rechargee : aucune fin sous son plancher');
  ok(!fenetreSousLePlancher(await mesurerFenetre(date)), 'fenetre Reserver d origine rechargee : aucune fin sous son plancher');
  ok(memePlanQueLeMoteur(await creerAuComptoir(date, f5), f5), 'comptoir d origine recharge : la formule garde la fin du moteur');

  console.log(`\n${echecs === 0 ? 'parties-dans-la-foulee-check: ALL OK' : `parties-dans-la-foulee-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });

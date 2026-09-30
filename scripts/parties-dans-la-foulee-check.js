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
//       passent par un crochet de compilation : aucun fichier n est reecrit.
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
function charger() {
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
  database.readAvailabilitySnapshot = async (date, centerId = CENTRE) => ({ date, centerId, reservations: [], laneStatuses: {}, blocks: [] });
  const api = require(API);
  const { disponibiliteInterne } = require(path.join(ROOT, 'lib/disponibilite-interne.js'));
  return (date, extra = {}) => disponibiliteInterne({
    centerId: CENTRE, date, pax: String(PAX),
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

  section('E. CONTRE-EPREUVES (chaque regle retiree, ce gate ROUGIT)');
  const contrePreuves = [
    {
      nom: 'sans les parties a la suite dans la fin de visite',
      fichier: ENGINE,
      ancre: '    visitEnd = Math.max(visitEnd, partiesALaSuite.end, firstStart + sequentialMinutes + partiesALaSuite.minutes);',
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
      mesure = await mesurer(charger(), date);
    } finally {
      Object.assign(mutation, { fichier: '', ancre: '', remplace: '' });
    }
    if (!ok(mutation.appliquee >= 1 && mutation.trouvee === 1, `contre-epreuve montable : « ${c.nom} » trouve son ancre une fois dans ${path.basename(c.fichier)}`, `trouvee ${mutation.trouvee} fois, appliquee ${mutation.appliquee}`)) continue;
    ok(c.rougit(mesure), `${c.nom} : ce gate ROUGIRAIT`);
  }
  // Le vrai moteur, remis : la mesure d origine se retrouve a l identique.
  const retour = await mesurer(charger(), date);
  ok(verifierSuite(retour.a1).ok && Boolean(retour.b) && Boolean(creneau(retour.d1)), 'moteur et API d origine rechargees : le verdict d origine revient');

  console.log(`\n${echecs === 0 ? 'parties-dans-la-foulee-check: ALL OK' : `parties-dans-la-foulee-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });

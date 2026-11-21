// LA REGLE « EN RETARD » EN DEUX COPIES, UN SEUL VERDICT (2026-11-21).
//
// Le retard d un groupe se decide a deux endroits. La console le dit en rouge : « En retard »
// (splitStaffTerrainOnsite, le seuil du centre) et ses minutes (retardDuGroupe, minutesDuRetard),
// dans assets/app-main.js. Le serveur le note avec « Arrivé » ou « Payé » (lib/retard-arrivee.js,
// retardALArrivee), et c est sa note qui ouvre la fenetre du retard. Deux copies d une regle
// divergent au premier changement : ce controle les fait passer sur la meme matrice de cas et
// exige, pour chacun, le meme verdict (en retard ou non), les memes minutes, et le verdict attendu
// (deux copies fausses de la meme facon ne passeraient pas) :
//   [S] LE SEUIL : pile a l heure, 1 min, juste sous et juste au-dessus du seuil (5 min, le
//       defaut ; 10 min regle au centre), 12 min ; le seuil 0 (« des la minute pile ») ;
//   [E] L ETAT DU GROUPE : deja paye, deja pointe, note absent, une activite deja cochee ;
//   [F] LES FORMULES A PLUSIEURS ACTIVITES : bowling, arcades et laser (F1) ; la table
//       d anniversaire et la plaine avant l arrivee (F8) ; des arcades en credits (F7) ; le laser
//       seul ;
//   [M] LE PASSAGE DE MINUIT : le groupe de la veille au soir, celui du lendemain matin, et
//       celui juste apres minuit ;
//   [Z] LE FUSEAU Europe/Brussels : heure d ete, heure d hiver, et un instant ou la date de
//       Bruxelles n est pas celle d UTC (00:27 a Bruxelles, 22:27 la veille en UTC).
// Trouve a sa premiere passe : la console comptait le retard depuis la table d anniversaire mise en
// place avant le groupe (« En retard · 1 min » a 14:55 pour un groupe attendu a 15:00, que le serveur
// ne notait pas) ; elle compte depuis l heure du groupe (heurePrevueDuRetard).
// UN SEUL NOMBRE SUR TOUT L ECRAN, CELUI DU SERVEUR (2026-11-21, la suite). Pour chaque cas en retard,
// l alerte de la carte (« En retard · 5 min », « Attendu à 15:00, pas encore arrivé »), l etape
// d arrivee de la fiche (« Attendu à 15:00, il y a 5 min ») et le Terrain disent l heure et les
// minutes notees par le serveur, comme la pastille ; hors retard, aucun ne dit « retard » ni « il y
// a ». Un groupe accueilli avant son debut (la table d anniversaire a 14:50, le debut a 15:00) :
// « Arrive dans 10 min, à 14:50 » avant l arrivee conseillee, « Attendu maintenant, début à 15:00 »
// entre elle et le seuil. [A] LE RETARD ANNONCE : le groupe a appele (« 20 min », note, heures
// gardees) ; a 15:08, la pastille, la carte et le Terrain disent 20 min (le serveur n en notera pas
// d autre a l arrivee), l etape « Attendu à 15:00, il y a 8 min ».
// La console vraie (scripts/planning-v3-fixtures.js, fuseau Europe/Brussels), l heure posee cas
// par cas ; le serveur, sa vraie fonction, a la meme heure (son horloge reglee). Les dossiers sont
// ceux de la journee « pic », passes par le vrai moteur, puis deplaces a l heure du cas.
// --contre-preuves : une seule copie mutee a la fois (la console, ou le serveur) : le controle
// rougit. RDC_MUTATIONS : un sous-ensemble.
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
// 6871 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_RETARD_COPIES_PORT || 6871);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const LIB = 'lib/retard-arrivee.js';
const liste = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : null);

let echecs = 0;
let silence = false;
const rouges = [];
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`);
  return cond;
}

// ---------------------------------------------------------------------------
// LES DOSSIERS : ceux de la journee « pic », deplaces a la date et a l heure du cas.
// ---------------------------------------------------------------------------
const JOURNEE = FX.lireFixture('pic').staffState.reservations;
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mn = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
function dossier(id, { date, decalage = 0, status = 'pending', extra = {} } = {}) {
  const r = JSON.parse(JSON.stringify(JOURNEE.find((x) => x.id === id)));
  const bouger = (b) => {
    if (!b || typeof b !== 'object') return;
    if (Number.isFinite(Number(b.start)) && b.start !== null) b.start = Number(b.start) + decalage;
    if (Number.isFinite(Number(b.end)) && b.end !== null) b.end = Number(b.end) + decalage;
    if (b.startTime) b.startTime = hm(mn(b.startTime) + decalage);
    if (b.endTime) b.endTime = hm(mn(b.endTime) + decalage);
  };
  if (decalage) {
    (r.opsPlan.timeline || []).forEach(bouger);
    (r.opsPlan.resourceBlocks || []).forEach(bouger);
    if (r.opsPlan.startTime) r.opsPlan.startTime = hm(mn(r.opsPlan.startTime) + decalage);
    if (r.opsPlan.endTime) r.opsPlan.endTime = hm(mn(r.opsPlan.endTime) + decalage);
    r.startTime = hm(mn(r.startTime) + decalage);
  }
  return Object.assign(r, { date, status, absentAt: null, activityProgress: {} }, extra);
}
// L instant du cas : une heure de Bruxelles (UTC+1 en hiver, UTC+2 l ete), ou un instant UTC.
const bruxelles = (date, heure) => {
  const ete = date >= '2026-03-29' && date < '2026-10-25';
  const [h, m] = heure.split(':').map(Number);
  const utc = new Date(`${date}T00:00:00Z`).getTime() + ((h - (ete ? 2 : 1)) * 60 + m) * 60000;
  return new Date(utc).toISOString();
};

const HIVER = '2027-01-16';
const LENDEMAIN = '2027-01-17';
const ETE = '2026-07-18';
const CLARA = 1634; // bowling 15:00 a 16:30
const HUGO = 1602; // F8 : table 14:50, plaine 15:00, arrivee 15:00, minigolf 16:05
const SACHA = 1604; // F1 : accueil 15:20, bowling 15:30, arcades 16:35, laser 17:30
const MANON = 1618; // laser 15:30
const CAMILLE = 1603; // F7 : table 15:20, plaine 15:30, arcades en credits

// { lettre, nom, r, instant, seuil (5 par defaut), attendu: minutes ou null, etape: la phrase de
// l etape d arrivee attendue mot pour mot, quand le cas la fixe }
const CAS = [];
const cas = (lettre, nom, r, instant, attendu, seuil = 5, etape = null) => CAS.push({ lettre, nom, r, instant, attendu, seuil, etape });
// [S] le seuil, sur un bowling de 15:00 (sans accueil avant : l etape garde son heure).
[[0, null], [1, null], [4, null], [5, 5], [6, 6], [12, 12]].forEach(([d, a]) => cas('S', `bowling 15:00, ${d} min apres, seuil 5`, dossier(CLARA, { date: HIVER }), bruxelles(HIVER, hm(900 + d)), a, 5, a === null ? 'Attendu maintenant, à 15:00' : null));
[[9, null], [10, 10], [11, 11]].forEach(([d, a]) => cas('S', `bowling 15:00, ${d} min apres, seuil 10 regle au centre`, dossier(CLARA, { date: HIVER }), bruxelles(HIVER, hm(900 + d)), a, 10));
[[-1, null], [0, 1], [3, 3]].forEach(([d, a]) => cas('S', `bowling 15:00, ${d} min, seuil 0 (des la minute pile)`, dossier(CLARA, { date: HIVER }), bruxelles(HIVER, hm(900 + d)), a, 0));
// [E] l etat du groupe, 12 min apres.
cas('E', 'deja paye', dossier(CLARA, { date: HIVER, status: 'paid', extra: { paymentMethod: 'Carte Bancaire' } }), bruxelles(HIVER, '15:12'), null);
cas('E', 'deja pointe arrive', dossier(CLARA, { date: HIVER, status: 'arrived' }), bruxelles(HIVER, '15:12'), null);
cas('E', 'note absent', dossier(CLARA, { date: HIVER, extra: { absentAt: `${HIVER}T14:10:00.000Z` } }), bruxelles(HIVER, '15:12'), null);
cas('E', 'son bowling deja coche', dossier(CLARA, { date: HIVER, extra: { activityProgress: { 'bowling-1': { done: true, doneAt: `${HIVER}T14:05:00.000Z`, by: 'Rachel' } } } }), bruxelles(HIVER, '15:12'), null);
// [F] les formules, autour de leur heure prevue. L etape d arrivee d un groupe accueilli avant son
// debut : « Arrive dans » avant l arrivee conseillee, la phrase neutre entre elle et le seuil.
// (Sacha est une demande a verifier : son etape dit l heure seule ; son accueil de 15:20 n ouvre pas
// sa visite, qui commence au bowling)
[[4, null, 'Attendu à 15:30'], [5, 5], [12, 12]].forEach(([d, a, etape]) => cas('F', `F1 (accueil 15:20, bowling 15:30), ${d} min apres 15:30`, dossier(SACHA, { date: HIVER }), bruxelles(HIVER, hm(930 + d)), a, 5, etape));
[[-20, null, 'Arrive dans 10 min, à 14:50'], [-6, null, 'Attendu maintenant, début à 15:00'], [-5, null, 'Attendu maintenant, début à 15:00'], [4, null, 'Attendu maintenant, début à 15:00'], [5, 5], [12, 12]].forEach(([d, a, etape]) => cas('F', `F8 (table 14:50, arrivee 15:00), ${d} min autour de 15:00`, dossier(HUGO, { date: HIVER }), bruxelles(HIVER, hm(900 + d)), a, 5, etape));
[[-5, null, 'Attendu maintenant, début à 15:30'], [12, 12]].forEach(([d, a, etape]) => cas('F', `F7 (table 15:20, arrivee 15:30, arcades en credits), ${d} min autour de 15:30`, dossier(CAMILLE, { date: HIVER }), bruxelles(HIVER, hm(930 + d)), a, 5, etape));
// (une demande a verifier : l etape dit l heure seule, sa raison est dans le bandeau ; en retard,
// l heure du retard, pas l arrivee conseillee)
cas('F', 'F8 en demande a verifier (table 14:50, arrivee 15:00), 12 min apres 15:00', dossier(HUGO, { date: HIVER, extra: { validationStatus: 'staff_review' } }), bruxelles(HIVER, '15:12'), 12);
[[4, null], [5, 5]].forEach(([d, a]) => cas('F', `laser seul 15:30, ${d} min apres`, dossier(MANON, { date: HIVER }), bruxelles(HIVER, hm(930 + d)), a));
// [M] minuit : un bowling de 22:00 (la veille au soir), un de 00:15 (le lendemain matin).
cas('M', 'bowling 22:00, 22:12 le soir meme', dossier(CLARA, { date: HIVER, decalage: 420 }), bruxelles(HIVER, '22:12'), 12);
cas('M', 'bowling 22:00 de la veille, 00:05 le lendemain', dossier(CLARA, { date: HIVER, decalage: 420 }), bruxelles(LENDEMAIN, '00:05'), null);
cas('M', 'bowling 00:15 du lendemain, 23:58 la veille', dossier(CLARA, { date: LENDEMAIN, decalage: -885 }), bruxelles(HIVER, '23:58'), null);
cas('M', 'bowling 00:15, 00:27 juste apres minuit', dossier(CLARA, { date: LENDEMAIN, decalage: -885 }), bruxelles(LENDEMAIN, '00:27'), 12);
// [Z] le fuseau : 15:12 a Bruxelles l ete (13:12 UTC) et l hiver (14:12 UTC) ; 00:27 a Bruxelles le
// 18 juillet, quand UTC dit encore le 17 a 22:27.
cas('Z', 'ete, 15:12 a Bruxelles (13:12 UTC)', dossier(CLARA, { date: ETE }), '2026-07-18T13:12:00.000Z', 12);
cas('Z', 'hiver, 15:12 a Bruxelles (14:12 UTC)', dossier(CLARA, { date: HIVER }), '2027-01-16T14:12:00.000Z', 12);
cas('Z', 'bowling 00:15 du 18 juillet, 00:27 a Bruxelles (22:27 UTC le 17)', dossier(CLARA, { date: ETE, decalage: -885 }), '2026-07-17T22:27:00.000Z', 12);

// ---------------------------------------------------------------------------
// LES DEUX COPIES.
// ---------------------------------------------------------------------------
// Le serveur : lib/retard-arrivee.js compile a neuf (avec la mutation du serveur, s il y en a une).
function chargerServeur(editions) {
  const fichier = path.join(ROOT, LIB);
  let src = fs.readFileSync(fichier, 'utf8').replace(/\r\n/g, '\n');
  for (const ed of editions) {
    if (src.split(ed.de).length !== 2) throw new Error(`ancre absente ou multiple dans ${LIB} : ${ed.de.slice(0, 70)}`);
    src = src.replace(ed.de, () => ed.vers);
  }
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  m._compile(src, fichier);
  return m.exports;
}
// La note du serveur ({ minutes, de }), ou null.
function verdictServeur(R, c) {
  R.__horloge.instant = () => new Date(c.instant);
  // (le seuil par defaut, celui que le serveur lit lui-meme ; un autre, comme le centre le regle)
  return R.retardALArrivee(JSON.parse(JSON.stringify(c.r)), { status: 'arrived', ...(c.seuil !== 5 ? { seuil: c.seuil } : {}) });
}
// La console : la page, a l heure du cas, le seuil du centre pose comme l ecran Etablissement. Son
// verdict et ses minutes, puis ce que chaque ecran en dit : la pastille, l alerte de la carte,
// l etape d arrivee de la fiche, le Terrain.
async function verdictConsole(page, c) {
  await page.clock.setFixedTime(new Date(c.instant));
  return page.evaluate(({ r, seuil }) => {
    /* global staffCenterConfigCache, getCurrentStaffCenterId, getStaffReservationMoments, retardDuGroupe, minutesDuRetard, maintenantDuDossier, texteDuRetard, renderGroupeAlerte, ficheArrivee, ficheDroits, getStaffTerrainStatus, isReservationAwaitingReview */
    const centre = staffCenterConfigCache && Array.isArray(staffCenterConfigCache.centers) ? staffCenterConfigCache.centers.find((x) => x.id === getCurrentStaffCenterId()) : null;
    if (centre) centre.accueil = Object.assign({}, centre.accueil || {}, { lateThresholdMinutes: seuil });
    state.staffAccueil = { lateThresholdMinutes: seuil };
    const m = getStaffReservationMoments([r], r.date).get(String(r.id));
    const html = (s) => { const d = document.createElement('div'); d.innerHTML = s || ''; return d; };
    const lire = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const alerte = html(m ? renderGroupeAlerte(r, m) : '');
    const etape = html(m ? ficheArrivee(r, m, ficheDroits(r)) : '');
    const rt = m ? retardDuGroupe(r, m) : null;
    return {
      minutes: m && m.late ? minutesDuRetard(rt, maintenantDuDossier(r)) : null,
      pastille: rt ? texteDuRetard(rt, maintenantDuDossier(r)) : '',
      alerteTitre: lire(alerte.querySelector('.gc-alert b')),
      alerteTexte: lire(alerte.querySelector('.gc-alert span')),
      alerte: lire(alerte),
      etape: lire(etape.querySelector('.fx-moment')),
      terrain: m && m.late ? getStaffTerrainStatus(r, 'late', m.item, { now: m.now }).label : '',
      revue: isReservationAwaitingReview(r),
    };
  }, { r: c.r, seuil: c.seuil });
}

let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel && !ed.serveur) t = t.replace(ed.de, () => ed.vers);
  return t;
}

async function jouer(browser) {
  const R = chargerServeur(mutation ? mutation.editions.filter((ed) => ed.serveur) : []);
  const { ctx, page, erreurs } = await FX.monter(browser, { fixture: 'pic', appareil: 'ordinateur', theme: 'light', port: PORT, variante: ['sansdemo'] });
  try {
    const dit = (n) => (n === null ? 'pas en retard' : `${n} min`);
    for (const c of CAS) {
      const note = verdictServeur(R, c);
      const serveur = note ? note.minutes : null;
      const vu = await verdictConsole(page, c);
      ok(serveur === vu.minutes && vu.minutes === c.attendu,
        `[${c.lettre}] ${c.nom} : la console et le serveur disent ${dit(c.attendu)}`, { console: dit(vu.minutes), serveur: dit(serveur), attendu: dit(c.attendu), instant: c.instant });
      if (note && c.attendu !== null) {
        // En retard : chaque ecran dit l heure et les minutes de la note du serveur.
        const n = `${note.minutes} min`;
        ok(vu.pastille === `En retard · ${n}` && vu.alerteTitre === `En retard · ${n}` && vu.terrain === `En retard · ${n}` && vu.alerteTexte === `Attendu à ${note.de}, pas encore arrivé`,
          `[${c.lettre}] ${c.nom} : la pastille, la carte et le Terrain disent « En retard · ${n} », attendu à ${note.de}`, vu);
        const etape = vu.revue ? `Attendu à ${note.de}` : `Attendu à ${note.de}, il y a ${n}`;
        ok(vu.etape === etape, `[${c.lettre}] ${c.nom} : l etape d arrivee dit « ${etape} »`, vu.etape);
      } else {
        ok(!/retard/i.test(vu.alerte) && !/retard|il y a/i.test(vu.etape) && !vu.terrain && !vu.pastille,
          `[${c.lettre}] ${c.nom} : ni la pastille, ni la carte, ni l etape, ni le Terrain ne parlent de retard`, vu);
      }
      if (c.etape) ok(vu.etape === c.etape, `[${c.lettre}] ${c.nom} : l etape d arrivee dit « ${c.etape} »`, vu.etape);
    }
    // [A] le retard annonce par le groupe, note a 14:58, les heures gardees ; 15:08.
    const annonce = dossier(CLARA, { date: HIVER });
    annonce.opsPlan = { ...annonce.opsPlan, delayFlag: { minutes: 20, from: '15:00', to: '', origin: null, flaggedAt: `${HIVER}T13:58:00.000Z`, cleared: false } };
    const ca = { r: annonce, instant: bruxelles(HIVER, '15:08'), seuil: 5 };
    const va = await verdictConsole(page, ca);
    ok(verdictServeur(R, ca) === null && va.pastille === 'En retard · 20 min' && va.alerteTitre === 'En retard · 20 min' && va.terrain === 'En retard · 20 min' && va.alerteTexte === 'Attendu à 15:00, pas encore arrivé',
      '[A] retard annonce de 20 min, 15:08 : la pastille, la carte et le Terrain disent 20 min, le nombre note (le serveur n en note pas d autre)', va);
    ok(va.etape === 'Attendu à 15:00, il y a 8 min', '[A] retard annonce, 15:08 : l etape dit « Attendu à 15:00, il y a 8 min »', va.etape);
    const enRetard = CAS.filter((c) => c.attendu !== null).length;
    ok(enRetard >= 10 && CAS.length - enRetard >= 10, '[K] la matrice compte des deux verdicts', { enRetard, total: CAS.length });
    ok(erreurs.length === 0, '[J] aucune erreur JS', erreurs);
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une seule copie mutee a la fois.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  // La console qui attend une minute de plus que le seuil.
  { nom: 'console-seuil-depasse', editions: [{ fichier: JS, de: '    else if (board.now - heurePrevueDuRetard(item) >= seuil - 1e-9) late.push(item);', vers: '    else if (board.now - heurePrevueDuRetard(item) > seuil + 1e-9) late.push(item);' }] },
  // La console qui compte le retard depuis la table d anniversaire mise en place avant le groupe
  // (ce que ce controle a trouve le 2026-11-21 : « En retard · 1 min » a 14:55 pour un groupe de 15:00).
  { nom: 'console-depuis-la-table', editions: [{ fichier: JS, de: '    else if (board.now - heurePrevueDuRetard(item) >= seuil - 1e-9) late.push(item);', vers: '    else if (board.now - item.start >= seuil - 1e-9) late.push(item);' }] },
  // La console qui met en retard un groupe deja paye ou deja pointe (son statut n est plus lu).
  { nom: 'console-paye-en-retard', editions: [{ fichier: JS, de: "    if (!isUpcomingReservationStatus(item.reservation.status || 'pending') || item.start > board.now || groupeAJoue(item.reservation)) present.push(item);", vers: '    if (item.start > board.now || groupeAJoue(item.reservation)) present.push(item);' }] },
  // L alerte de la carte qui compte depuis la table (avant le 2026-11-21 : « En retard · 31 min,
  // Attendu à 14:50 » quand la pastille disait 21 min, prevu 15:00).
  { nom: 'alerte-depuis-la-table', editions: [{ fichier: JS, de: '    return `<div class="gc-alert is-late"><b>En retard · ${escapeHtml(dureeDuRetard(retard.minutes))}</b><span>Attendu à ${formatClockDisplay(retard.prevu)}, pas encore arrivé</span></div>`;', vers: '    return `<div class="gc-alert is-late"><b>En retard · ${escapeHtml(formatStaffTerrainDelay(moment.now - moment.item.start))}</b><span>Attendu à ${formatClockDisplay(moment.item.start)}, pas encore arrivé</span></div>`;' }] },
  // L etape d arrivee de la fiche qui compte depuis la table (« Attendu à 14:50, il y a 31 min »).
  { nom: 'etape-depuis-la-table', editions: [{ fichier: JS, de: '  if (moment && moment.late) return `Attendu à ${formatClockDisplay(prevuDuRetard)}, il y a ${dureeDuRetard(Math.max(1, Math.round((moment.now - prevuDuRetard) * 60)))}`;', vers: '  if (moment && moment.late) return `Attendu à ${formatClockDisplay(moment.item.start)}, il y a ${formatStaffTerrainDelay(moment.now - moment.item.start)}`;' }] },
  // L etape d une demande a verifier qui garde l arrivee conseillee en retard (« Attendu à 14:50 »).
  { nom: 'etape-a-verifier-depuis-la-table', editions: [{ fichier: JS, de: '  const attendu = `Attendu à ${formatClockDisplay(enRetard ? retardDuMoment(r, moment).prevu : span.start)}`;', vers: '  const attendu = `Attendu à ${formatClockDisplay(span.start)}`;' }] },
  // L etape qui garde l arrivee conseillee passee jusqu au retard (« Attendu maintenant, à 14:50 » a 14:55).
  { nom: 'etape-entre-deux-heures', editions: [{ fichier: JS, de: '    if (dans <= 0 && Number.isFinite(debut) && debut > span.start + 1 / 120) return `Attendu maintenant, début à ${formatClockDisplay(debut)}`;\n', vers: '' }] },
  // Le Terrain qui compte depuis la table.
  { nom: 'terrain-depuis-la-table', editions: [{ fichier: JS, de: '`En retard · ${dureeDuRetard(retardDuMoment(reservation, { late: true, item, now: board.now }).minutes)}`', vers: '`En retard · ${formatStaffTerrainDelay(board.now - item.start)}`' }] },
  // La carte, puis le Terrain, qui oublient le retard annonce : les minutes passees seules.
  { nom: 'alerte-sans-l-annonce', editions: [{ fichier: JS, de: '<b>En retard · ${escapeHtml(dureeDuRetard(retard.minutes))}</b>', vers: '<b>En retard · ${escapeHtml(formatStaffTerrainDelay(moment.now - retard.prevu))}</b>' }] },
  { nom: 'terrain-sans-l-annonce', editions: [{ fichier: JS, de: '`En retard · ${dureeDuRetard(retardDuMoment(reservation, { late: true, item, now: board.now }).minutes)}`', vers: '`En retard · ${formatStaffTerrainDelay(board.now - heurePrevueDuRetard(item))}`' }] },
  // Le serveur qui attend une minute de plus que le seuil.
  { nom: 'serveur-seuil-depasse', editions: [{ fichier: LIB, serveur: true, de: '  if (minutes < seuil) return null;', vers: '  if (minutes <= seuil) return null;' }] },
  // Le serveur a l heure d UTC.
  { nom: 'serveur-en-utc', editions: [{ fichier: LIB, serveur: true, de: "const FUSEAU = 'Europe/Brussels';", vers: "const FUSEAU = 'UTC';" }] },
  // Le serveur qui oublie l heure d arrivee : la premiere activite seule fait l heure prevue.
  { nom: 'serveur-sans-l-arrivee', editions: [{ fichier: LIB, serveur: true, de: '  if (Number.isFinite(arrivee)) debuts.push(arrivee);\n', vers: '' }] },
];

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser);
    } else {
      console.log('[K] contre-preuves : une seule copie mutee, le controle rougit');
      for (const m of MUTATIONS.filter((x) => !process.env.RDC_MUTATIONS || liste(process.env.RDC_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = true;
        try { await jouer(browser); } catch (e) { rouges.push(`crash ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde).filter((l) => /^\[[SEFMZA]\]/.test(l));
        rouges.length = garde;
        echecs = avant;
        ok(vus.length > 0, `[K] mutation ${m.nom} : le controle rougit (${vus.length} cas)`, vus.slice(0, 2).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveurHttp.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nretard-deux-copies-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nretard-deux-copies-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

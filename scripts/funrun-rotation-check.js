#!/usr/bin/env node
'use strict';
// =============================================================================
// FUN RUN : UN GROUPE PLUS GRAND QUE L INSTALLATION TOURNE
// -----------------------------------------------------------------------------
// Demande de Movsar (2026-09-23) : « pixel game on peut pas le choisir quand
// ya plus de 5 joueurs c con, on peut faire plusieurs sessions, tournante ».
//
// AVANT : le catalogue declarait `maxPax: 5` pour le Fun Run. Le formulaire
// rendait donc la carte INCHOISISSABLE au-dela de 5 personnes, et le moteur,
// lui, n appliquait pas ce maximum : une ligne a 8 personnes se chiffrait
// comme UNE session (defaut deja ecrit noir sur blanc dans l en-tete de
// lib/booking-complements). Deux facons de se tromper pour la meme donnee.
//
// MAINTENANT : le catalogue declare ce qui est vrai, dans le vocabulaire qu il
// a deja pour le duckpin : `units: 1`, `capacityPerUnit: 5`. Le groupe tourne,
// la ligne dure autant de fois la session et se paie autant de fois.
//
// CE QUE CE GATE PROUVE
//   [A] le catalogue declare une CAPACITE, plus un MAXIMUM ;
//   [B] le moteur compte les passages, la duree et le prix (grille complete) ;
//   [C] le navigateur du vieux tunnel annonce le MEME montant que le serveur ;
//   [D] le formulaire Fun Galaxy compte les MEMES passages que le serveur ;
//   [E] les temoins (duckpin, minigolf, laser) ne bougent pas d un centime ;
//   [G] une ligne normalisee se renormalise a l identique (audit 2026-09-28 :
//       165 EUR annonces, 90 EUR enregistres) ;
//   [F] quatre contre-epreuves : sans chaque regle, ce gate ROUGIT.
// =============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let failures = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }

function frais(modulePath) {
  const resolu = require.resolve(modulePath);
  Object.keys(require.cache).forEach((cle) => { delete require.cache[cle]; });
  return require(resolu);
}

// Le navigateur du vieux tunnel, evalue dans un bac a sable : c est le FICHIER
// SERVI qui repond, jamais une copie de sa logique ecrite ici.
function chargerNavigateur() {
  const source = fs.readFileSync(path.join(ROOT, 'assets/booking-core.js'), 'utf8');
  const bac = { window: {}, document: { addEventListener() {} }, console, fetch: () => Promise.resolve(), localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, setInterval, clearInterval };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(source, bac, { filename: 'booking-core.js' });
  return bac;
}

// La fonction du FORMULAIRE, prise dans son fichier (elle vit dans une
// fermeture : on la sort par son texte, avec son environnement simule). Vide
// = elle a ete renommee, et le gate le dit au lieu de passer en silence.
function fonctionDuFormulaire(nom) {
  const source = fs.readFileSync(path.join(ROOT, 'assets/fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
  const debut = source.indexOf(`\n  function ${nom}(`);
  if (debut === -1) return '';
  const fin = source.indexOf('\n  }\n', debut + 1);
  return fin === -1 ? '' : source.slice(debut + 1, fin + 4);
}

function main() {
  const catalogue = require('../lib/activity-catalog');
  const { normalizeProgram } = require('../lib/visit-program');
  const { FUN_RUN_OPTIONS } = require('../lib/booking-config');
  const CENTRE = 'libramont';
  const PALIERS = FUN_RUN_OPTIONS.map((o) => Number(o.minutes));

  // ---------------------------------------------------------------- [A]
  section('A. LE CATALOGUE DECLARE UNE CAPACITE, PLUS UN MAXIMUM');
  const activites = catalogue.listCenterActivities(CENTRE);
  const funRun = activites.find((a) => a.id === 'fun_run') || null;
  ok(Boolean(funRun), 'le catalogue de Libramont vend le Fun Run');
  if (!funRun) { console.log('\nFUN RUN ROTATION : 1 echec(s)'); process.exit(1); }
  ok(funRun.maxPax == null, 'le Fun Run ne declare plus de maximum de groupe', `maxPax=${JSON.stringify(funRun.maxPax)}`);
  ok(Number(funRun.capacityPerUnit) === 5 && Number(funRun.units) === 1,
    'il declare 1 installation de 5 joueurs (meme vocabulaire que le duckpin)',
    `units=${funRun.units} capacityPerUnit=${funRun.capacityPerUnit}`);
  ok(funRun.priceType === 'grid_fun_run', 'et se vend a la grille de session', funRun.priceType);

  // ---------------------------------------------------------------- [B]
  section('B. LE MOTEUR COMPTE LES PASSAGES, LA DUREE ET LE PRIX');
  const prixSession = (minutes) => Number((FUN_RUN_OPTIONS.find((o) => o.minutes === minutes) || FUN_RUN_OPTIONS[0]).price);
  const ecartsMoteur = [];
  for (let pax = 1; pax <= 26; pax += 1) {
    for (const minutes of PALIERS) {
      const attenduSessions = Math.ceil(pax / 5);
      const ligne = normalizeProgram([{ activityId: 'fun_run', minutes }], { centerId: CENTRE, pax }).items[0] || {};
      const attendu = {
        sessions: attenduSessions,
        minutes: attenduSessions * minutes,
        price: attenduSessions * prixSession(minutes),
        rotation: attenduSessions > 1,
      };
      const lu = { sessions: ligne.sessions, minutes: ligne.minutes, price: ligne.price, rotation: ligne.rotation === true };
      if (JSON.stringify(lu) !== JSON.stringify(attendu)) ecartsMoteur.push(`${pax}p/${minutes}min attendu=${JSON.stringify(attendu)} lu=${JSON.stringify(lu)}`);
    }
  }
  ok(ecartsMoteur.length === 0, `la ligne de programme suit la rotation sur ${26 * PALIERS.length} cas (1 a 26 personnes)`, ecartsMoteur.slice(0, 3).join(' ; '));
  const douze = normalizeProgram([{ activityId: 'fun_run', minutes: 15 }], { centerId: CENTRE, pax: 12 }).items[0];
  ok(douze.sessions === 3 && douze.minutes === 45 && douze.price === 90,
    'le cas de Movsar : 12 personnes = 3 sessions de 15 min, 45 min, 90 EUR',
    JSON.stringify({ sessions: douze.sessions, minutes: douze.minutes, price: douze.price }));
  const cinq = normalizeProgram([{ activityId: 'fun_run', minutes: 15 }], { centerId: CENTRE, pax: 5 }).items[0];
  ok(cinq.sessions === 1 && cinq.minutes === 15 && cinq.price === 30 && cinq.rotation !== true,
    'cinq personnes tiennent en une session : rien ne change pour elles',
    JSON.stringify({ sessions: cinq.sessions, minutes: cinq.minutes, price: cinq.price }));
  const enorme = normalizeProgram([{ activityId: 'fun_run', minutes: 30 }], { centerId: CENTRE, pax: 240 }).items[0];
  ok(enorme.sessions === 48 && enorme.minutes === 48 * 30 && enorme.price === 2640,
    '240 joueurs font exactement 48 passages de 30 min et 2640 EUR, sans tronquer les rotations',
    JSON.stringify({ sessions: enorme.sessions, minutes: enorme.minutes }));

  // ---------------------------------------------------------------- [C]
  section('C. LE NAVIGATEUR DU TUNNEL ANNONCE LE MONTANT DU SERVEUR');
  const nav = chargerNavigateur();
  ok(typeof nav.getFreeActivityPrice === 'function', 'assets/booking-core.js expose getFreeActivityPrice');
  ok(typeof nav.getActivitySessionCount === 'function', 'et le compte de passages qui va avec');
  const ecartsMiroir = [];
  for (let pax = 1; pax <= 26; pax += 1) {
    for (const minutes of PALIERS) {
      const serveur = catalogue.activityLinePrice(funRun, { pax, minutes, sessions: catalogue.activitySessionCount(funRun, pax) });
      const navigateur = nav.getFreeActivityPrice(funRun, { pax, minutes });
      if (serveur !== navigateur) ecartsMiroir.push(`${pax}p/${minutes}min serveur=${serveur} navigateur=${navigateur}`);
    }
  }
  ok(ecartsMiroir.length === 0, `le navigateur et le serveur chiffrent pareil sur ${26 * PALIERS.length} cas`, ecartsMiroir.slice(0, 3).join(' ; '));

  // ---------------------------------------------------------------- [D]
  section('D. LE FORMULAIRE FUN GALAXY COMPTE LES MEMES PASSAGES');
  const source = fonctionDuFormulaire('sessionsPour');
  ok(source.length > 0, 'assets/fungalaxy-booking.js porte bien sessionsPour (sinon ce gate ne prouve rien)');
  const ecartsForm = [];
  if (source) {
    const bac = { state: { pax: 1, options: {} }, Math, Number };
    vm.createContext(bac);
    vm.runInContext(fonctionDuFormulaire('bornesJoueurs') + '\n' + fonctionDuFormulaire('joueursDe') + '\n' + source, bac, { filename: 'fungalaxy-booking.js:sessionsPour' });
    for (let pax = 1; pax <= 26; pax += 1) {
      bac.state.pax = pax;
      const formulaire = bac.sessionsPour(funRun);
      const serveur = catalogue.activitySessionCount(funRun, pax);
      if (formulaire !== serveur) ecartsForm.push(`${pax}p formulaire=${formulaire} serveur=${serveur}`);
    }
    // Une activite sans capacite declaree : un seul passage, des deux cotes.
    bac.state.pax = 40;
    ok(bac.sessionsPour({ id: 'x' }) === 1 && catalogue.activitySessionCount({ id: 'x' }, 40) === 1,
      'sans capacite declaree, le groupe passe en une fois (des deux cotes)');
  }
  ok(ecartsForm.length === 0, 'le formulaire et le serveur comptent les memes passages (1 a 26 personnes)', ecartsForm.slice(0, 3).join(' ; '));

  // ---------------------------------------------------------------- [E]
  section('E. LES TEMOINS NE BOUGENT PAS');
  const duck = (pax) => normalizeProgram([{ activityId: 'duckpin_bowling', duration: 1 }], { centerId: CENTRE, pax }).items[0];
  ok(duck(6).laneCount === 1 && duck(6).rotation !== true, 'duckpin a 6 : une piste, pas de rotation', JSON.stringify({ l: duck(6).laneCount, p: duck(6).price }));
  ok(duck(12).laneCount === 2 && duck(12).rotation !== true, 'duckpin a 12 : deux pistes, pas de rotation', JSON.stringify({ l: duck(12).laneCount, p: duck(12).price }));
  ok(duck(18).laneCount === 2 && duck(18).rotation === true, 'duckpin a 18 : deux pistes ET rotation (la dotation est atteinte)', JSON.stringify({ l: duck(18).laneCount, p: duck(18).price }));
  const golf = (pax) => normalizeProgram([{ activityId: 'minigolf_blacklight' }], { centerId: CENTRE, pax }).items[0];
  ok(golf(6).minutes === golf(40).minutes && golf(6).sessions === 1 && golf(40).sessions === 1,
    'le minigolf ne connait pas la rotation : meme duree a 6 et a 40', `${golf(6).minutes} min`);
  const laser = normalizeProgram([{ activityId: 'laser_game', games: 2 }], { centerId: CENTRE, pax: 12 }).items[0];
  ok(laser.sessions === undefined && Number(laser.games) === 2, 'le laser garde ses parties, aucune session ne s y ajoute', JSON.stringify({ games: laser.games, sessions: laser.sessions }));

  // ---------------------------------------------------------------- [G]
  section('G. UNE LIGNE NORMALISEE SE RENORMALISE A L IDENTIQUE (audit du 2026-09-28)');
  // L audit QA : 12 joueurs, sessions de 30 min. Le tunnel annoncait
  // 3 x 55 = 165 EUR ; la reservation enregistree portait 90 EUR. Le serveur
  // renormalise le programme une fois le snapshot lu (renormalizeVisitProgram)
  // et la fiche du comptoir le renvoie tel qu enregistre : les 90 min du
  // GROUPE etaient relues comme la duree d UNE session, aucun palier ne
  // valait 90, et le premier (15 min, 30 EUR) reprenait la main.
  const garde = (l) => ({ sessions: l.sessions, minutes: l.minutes, price: l.price, sessionMinutes: l.sessionMinutes });
  const une = normalizeProgram([{ activityId: 'fun_run', minutes: 30 }], { centerId: CENTRE, pax: 12 });
  ok(une.items[0].price === 165 && une.items[0].minutes === 90 && une.items[0].sessionMinutes === 30,
    'le cas de l audit : 12 joueurs, sessions de 30 min = 3 x 55 = 165 EUR, 90 min, et le palier (30) voyage a part',
    JSON.stringify(garde(une.items[0])));
  const ecartsIdem = [];
  for (let pax = 1; pax <= 26; pax += 1) {
    for (const minutes of PALIERS) {
      const a = normalizeProgram([{ activityId: 'fun_run', minutes }], { centerId: CENTRE, pax });
      const b = normalizeProgram(a.items, { centerId: CENTRE, pax });
      const c = normalizeProgram(b.items, { centerId: CENTRE, pax });
      const [ga, gb, gc] = [a, b, c].map((p) => JSON.stringify(garde(p.items[0])));
      if (ga !== gb || gb !== gc || a.price !== c.price) ecartsIdem.push(`${pax}p/${minutes}min ${ga} -> ${gb}`);
    }
  }
  ok(ecartsIdem.length === 0, `renormaliser deux fois ne change ni le prix ni la duree (${26 * PALIERS.length} cas)`, ecartsIdem.slice(0, 2).join(' ; '));
  // Une ligne ENREGISTREE avant ce correctif : le temps du groupe et ses
  // passages, sans palier.
  const ancienne = normalizeProgram([{ activityId: 'fun_run', minutes: 90, sessions: 3, price: 90 }], { centerId: CENTRE, pax: 12 }).items[0];
  ok(ancienne.price === 165 && ancienne.sessionMinutes === 30,
    'une ligne deja enregistree (90 min, 3 passages, sans palier) retrouve son palier de 30 min et son prix', JSON.stringify(garde(ancienne)));
  // Le chemin du serveur, de bout en bout : la demande du tunnel, puis la
  // renormalisation de la reservation.
  const { normalizeReservationRequest, renormalizeVisitProgram } = require('../lib/reservation-request');
  const { getCenter } = require('../lib/ops-knowledge');
  const demande = normalizeReservationRequest({
    centerId: CENTRE, type: 'visite', date: '2026-12-05', startTime: '14:00', pax: 12,
    program: [{ activityId: 'fun_run', minutes: 30 }],
  }, { channel: 'public' });
  const prixDemande = Number(demande.program.items[0].price);
  renormalizeVisitProgram(demande, getCenter(CENTRE).resources.bowling, { channel: 'public' });
  const prixRenormalise = Number(demande.program.items[0].price);
  ok(prixDemande === 165 && prixRenormalise === 165 && Number(demande.programPrice) === 165,
    'reservation : 165 EUR a la demande, 165 EUR apres la renormalisation du serveur', `${prixDemande} puis ${prixRenormalise} (programme ${demande.programPrice})`);
  // Le complement de visite reproduit la ligne telle quelle.
  const { ligneDeProgramme } = require('../lib/booking-complements');
  const reproduite = ligneDeProgramme(une.items[0]);
  ok(Number(reproduite.minutes) === 30, 'un complement de visite renvoie le palier d une session, pas le temps du groupe', JSON.stringify(reproduite));
  // La fiche du comptoir relit une ligne enregistree.
  ok(typeof nav.funRunSessionMinutes === 'function'
    && nav.funRunSessionMinutes(une.items[0]) === 30
    && nav.funRunSessionMinutes({ minutes: 90, sessions: 3 }) === 30
    && nav.funRunSessionMinutes({ minutes: 45 }) === 45,
  'la fiche du comptoir relit le palier (30 min), jamais le temps du groupe (90)');
  const app = fs.readFileSync(path.join(ROOT, 'assets/app-main.js'), 'utf8');
  const fiche = app.slice(app.indexOf('function buildEditProgramFromReservation('), app.indexOf('function estimerPrixProgramme('));
  ok(/funRunSessionMinutes\(item, getActivitySessionCount\(/.test(fiche) && !/reglages\.minutes = Number\(item\.minutes\)/.test(fiche),
    'la fiche du comptoir passe par ce palier (avec les passages du groupe) pour reconstruire le programme d un dossier');

  // LE DOSSIER ENREGISTRE. La base filtrait les champs d une ligne a
  // l ecriture (lib/database.js, normalizeReservationProgram) et jetait
  // `sessions` et `sessionMinutes` : un dossier RELU redevenait 3 x 15 min.
  // On passe par le vrai filtre, puis on renormalise ce qu il a garde.
  const { normalizeReservationPayload } = require('../lib/database');
  const ranger = (programme, pax) => normalizeReservationPayload({
    centerId: CENTRE, type: 'activite', date: '2026-12-05', startTime: '14:00', duration: 0.5, pax, name: 'QA', phone: '+32491000000', email: 'qa@example.com', program: programme,
  }, {}).program;
  const ecartsBase = [];
  for (let pax = 1; pax <= 26; pax += 1) {
    for (const minutes of PALIERS) {
      const avant = normalizeProgram([{ activityId: 'fun_run', minutes }], { centerId: CENTRE, pax });
      const range = ranger(avant, pax);
      const relu = normalizeProgram(range.items, { centerId: CENTRE, pax });
      if (JSON.stringify(garde(avant.items[0])) !== JSON.stringify(garde(relu.items[0])) || avant.price !== relu.price) {
        ecartsBase.push(`${pax}p/${minutes}min ${JSON.stringify(garde(avant.items[0]))} -> range ${JSON.stringify(range.items[0])} -> ${JSON.stringify(garde(relu.items[0]))}`);
      }
    }
  }
  ok(ecartsBase.length === 0, `un dossier ENREGISTRE puis relu garde son prix et sa duree (${26 * PALIERS.length} cas, par le vrai filtre de la base)`, ecartsBase.slice(0, 2).join(' ; '));
  const rangeDouze = ranger(une, 12).items[0] || {};
  ok(rangeDouze.sessions === 3 && rangeDouze.sessionMinutes === 30, 'la base garde les passages et le palier', JSON.stringify(rangeDouze));
  // Les deux lignes Fun Run enregistrees en prod AVANT ce correctif (lecture
  // du 2026-09-28) : 64 et 59 joueurs, 195 et 180 minutes, 390 et 360 EUR,
  // sans passages ni palier. Leur palier est 15 min (13 et 12 passages).
  const heritage = [
    { pax: 64, ligne: { activityId: 'fun_run', name: 'Fun Run by PIXEL', planned: false, minutes: 195, price: 390, priceKnown: true } },
    { pax: 59, ligne: { activityId: 'fun_run', name: 'Fun Run by PIXEL', planned: false, minutes: 180, price: 360, priceKnown: true } },
  ];
  const relusHeritage = heritage.map((h) => normalizeProgram([h.ligne], { centerId: CENTRE, pax: h.pax }).items[0]);
  ok(relusHeritage[0].price === 390 && relusHeritage[0].sessionMinutes === 15 && relusHeritage[1].price === 360 && relusHeritage[1].sessionMinutes === 15,
    'les deux lignes anciennes de la prod se relisent a leur prix (390 et 360 EUR, palier 15 min)', JSON.stringify(relusHeritage.map(garde)));
  ok(nav.funRunSessionMinutes(heritage[0].ligne, 13) === 15 && nav.funRunSessionMinutes(heritage[1].ligne, 12) === 15,
    'la fiche du comptoir les relit pareil (palier 15 min)');
  // Le tunnel envoie un PALIER sans passages : il reste ce palier, meme pour
  // un groupe qui tourne (30 min pour 12 personnes n est pas 3 x 10 min).
  ok(normalizeProgram([{ activityId: 'fun_run', minutes: 30 }], { centerId: CENTRE, pax: 12 }).items[0].sessionMinutes === 30
    && nav.funRunSessionMinutes({ minutes: 30 }, 3) === 30,
    'un palier envoye par le tunnel reste ce palier, quel que soit le groupe');

  // ---------------------------------------------------------------- [F]
  section('F. CONTRE-EPREUVES PAR MUTATION DU CODE DE PRODUCTION');
  const MUTATIONS = [
    {
      fichier: 'lib/activity-catalog.js',
      ancre: 'return round2(option.price * sessionCount(sessions));',
      mute: 'return round2(option.price);',
      label: 'sans la multiplication du prix, 12 personnes repayent une seule session',
      verdict: () => {
        const { normalizeProgram: n } = frais('../lib/visit-program');
        return n([{ activityId: 'fun_run', minutes: 15 }], { centerId: CENTRE, pax: 12 }).items[0].price === 90;
      },
    },
    {
      fichier: 'lib/activity-catalog.js',
      ancre: 'return option.minutes * sessionCount(sessions);',
      mute: 'return option.minutes;',
      label: 'sans la multiplication de la duree, 12 personnes tiennent en 15 min',
      verdict: () => {
        const { normalizeProgram: n } = frais('../lib/visit-program');
        return n([{ activityId: 'fun_run', minutes: 15 }], { centerId: CENTRE, pax: 12 }).items[0].minutes === 45;
      },
    },
    {
      fichier: 'ops-knowledge/activities.json',
      ancre: '"capacityPerUnit": 5,',
      mute: '"capacityPerUnit": 0,',
      label: 'sans la capacite au catalogue, plus aucune rotation n est comptee',
      verdict: () => {
        const { normalizeProgram: n } = frais('../lib/visit-program');
        return n([{ activityId: 'fun_run', minutes: 15 }], { centerId: CENTRE, pax: 12 }).items[0].sessions === 3;
      },
    },
    {
      fichier: 'lib/visit-program.js',
      ancre: 'const minutesDemandees = minutesDUneSession(raw, item.sessions);',
      mute: 'const minutesDemandees = Math.trunc(Number(raw && raw.minutes) || 0);',
      label: 'en relisant le temps du groupe comme un palier, 165 EUR repartent a 90 EUR a la renormalisation',
      verdict: () => {
        const { normalizeProgram: n } = frais('../lib/visit-program');
        const a = n([{ activityId: 'fun_run', minutes: 30 }], { centerId: CENTRE, pax: 12 });
        return n(a.items, { centerId: CENTRE, pax: 12 }).items[0].price === 165;
      },
    },
    {
      // Le seul cas que le stockage tranche seul : 8 personnes en sessions de
      // 15 min font 30 min de groupe, et 30 est AUSSI un palier. Sans les
      // passages en base, la relecture le prend pour des sessions de 30 min.
      fichier: 'lib/database.js',
      ancre: '    if (item.sessions != null) out.sessions = Math.min(1000, Math.max(1, Math.trunc(Number(item.sessions) || 1)));\n    if (item.sessionMinutes != null) out.sessionMinutes = Math.min(600, Math.max(0, Math.trunc(Number(item.sessionMinutes) || 0)));\n',
      mute: '',
      label: 'sans les passages en base, 8 personnes en sessions de 15 min (60 EUR) se relisent a 2 x 55 EUR',
      verdict: () => {
        const { normalizeProgram: n } = frais('../lib/visit-program');
        const { normalizeReservationPayload: np } = require('../lib/database');
        const a = n([{ activityId: 'fun_run', minutes: 15 }], { centerId: CENTRE, pax: 8 });
        const range = np({ centerId: CENTRE, type: 'activite', date: '2026-12-05', startTime: '14:00', duration: 0.5, pax: 8, name: 'QA', phone: '+32491000000', email: 'qa@example.com', program: a }, {}).program;
        return a.price === 60 && n(range.items, { centerId: CENTRE, pax: 8 }).items[0].price === 60;
      },
    },
  ];
  for (const m of MUTATIONS) {
    const chemin = path.join(ROOT, m.fichier);
    const original = fs.readFileSync(chemin, 'utf8');
    // Une ancre de plusieurs lignes suit les fins de ligne du fichier.
    const motif = m.ancre.split(/\r?\n/).map((ligne) => ligne.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\r?\\n');
    const trouve = original.match(new RegExp(motif));
    const ancre = trouve ? trouve[0] : m.ancre;
    const compte = original.split(ancre).length - 1;
    if (!ok(compte === 1, `contre-epreuve montable : « ${m.ancre.replace(/\s+/g, ' ').slice(0, 46)}… » une seule fois dans ${m.fichier}`, `${compte} occurrence(s)`)) continue;
    let rouge = false;
    try {
      fs.writeFileSync(chemin, original.split(ancre).join(m.mute));
      rouge = m.verdict() === false;
    } catch (error) {
      rouge = true; // le code mute jette : c est aussi un rouge
    } finally {
      fs.writeFileSync(chemin, original);
      frais('../lib/visit-program');
    }
    ok(rouge, `${m.label} : ce gate ROUGIRAIT`);
    ok(fs.readFileSync(chemin, 'utf8') === original, `${m.fichier} restaure a l identique`);
  }
  // Apres les mutations, le vrai code redit la verite.
  const { normalizeProgram: apres } = frais('../lib/visit-program');
  const controle = apres([{ activityId: 'fun_run', minutes: 15 }], { centerId: CENTRE, pax: 12 }).items[0];
  ok(controle.sessions === 3 && controle.minutes === 45 && controle.price === 90,
    'code restaure : 12 personnes = 3 sessions, 45 min, 90 EUR', JSON.stringify({ s: controle.sessions, m: controle.minutes, p: controle.price }));

  console.log(`\n${failures === 0 ? 'funrun-rotation-check: ALL OK' : `funrun-rotation-check: ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

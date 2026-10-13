'use strict';
// LA FORMULE PAR HEURE D ARRIVEE, A L ECRAN DU CLIENT (2026-10-13).
//
// Le gerant de Libramont, le 12/10 : un groupe de 10 veut venir a 10:00, le
// bowling et le laser sont pleins de 10:00 a 12:00, la formule a 30 min
// d arcades a faire pendant ce temps. Movsar, le 13/10 : « pour les formules
// ils peuvent choisir heure pour arcade aussi comme ca ils peuvent venir a
// 10 h ». Le serveur le sait depuis 1a76bce (scripts/formules-arrivee-check.js) ;
// ce gate prouve l ecran, dans le navigateur, sur le mock du depot (le vrai
// gestionnaire des disponibilites sur un instantane en memoire : aucune base,
// rien d ecrit, rien d envoye) :
//   [A] sans heure d arrivee choisie, rien ne change : les demandes de la
//       formule et le blocage sont les memes au caractere pres, l option
//       proposee ou non ; sans reglage dans la meta, ou arrivalFirst false,
//       la ligne reste la borne d arrivee d avant ;
//   [B] la liste des heures d arrivee ne part qu a l ouverture de sa ligne ;
//       chaque heure dit si elle tient (le mot court, une ligne par cause sous
//       la plage) ; une longue attente se dit « attente », en fourchette et
//       avec sa cause, et se prend (Movsar, 2026-10-13 : « si y a un petit
//       probleme tu le notifies mais on peut quand meme cliquer ») ; une heure
//       choisie pose le bowling et le laser du serveur ; la ligne du bowling
//       garde ses heures, jugees avec l arrivee ;
//   [C] arriver a 10:00 quand tout est pris jusqu a 11:00 : l accueil, les
//       arcades a 10:10 (jamais a l heure d arrivee), le bowling a 11:00, le
//       laser apres, la fin du serveur ; 10:00 partout, l accueil compris
//       (jamais 09:50) ; le blocage et la
//       reservation partent avec preference.arrivalTime ; le recapitulatif et
//       l ecran final disent « Arrivée à 10:00 » ;
//   [D] une formule sans arcades (Formule 4) commence par son minigolf et ne
//       promet aucune arcade ; une arrivee dont la visite deborde la fermeture
//       se dit « serré », avec la raison du moteur ; une reponse d arrivee
//       sans grille garde au bowling l heure du plan de l arrivee ;
//   [E] le centre coupe l arrivee (arrivalBounds.arrivalFirst false, dans la
//       liste ou dans le plan) : l option disparait, l arrivee choisie tombe ;
//   [F] une arrivee devenue impossible entre la liste et le choix (le
//       bowling bloque au planning) : le refus du serveur, la liste relue, la
//       phrase longue du serveur en titre de la puce, l arrivee suivante
//       proposee d un toucher ;
//   [G] au telephone (360 px) : rien ne deborde, des cibles de 44 px, le
//       focus se voit, les memes boutons que les heures des activites ;
//   [H] (2026-10-13, Movsar : « quand ils choisissent l heure d arrivee on
//       peut pas choisir les heures qu on veut pour les autres activites »,
//       puis « on peut prendre l heure qu on veut, juste si c est vraiment
//       impossible on peut pas ») journee libre : arriver a 10:30, puis le
//       bowling a 11:30, l arrivee reste ; l heure proposee est celle du plan
//       de l arrivee ; avant l arrivee et a son accueil, le bowling « décale »
//       (il avance l arrivee), loin d elle « attente », tout se prend ; la
//       liste des arrivees se relit avec le bowling pose ; une autre arrivee
//       garde le bowling ; une arrivee apres lui le libere et le serveur le
//       replace apres elle ; un bowling avant l arrivee la fait tomber, le
//       plan la conseille juste avant lui ; une reponse d arrivee sans grille
//       garde les lignes du programme.
//   [I] (2026-10-13, Movsar : « pourquoi tu mets automatiquement l heure
//       d arrivee a arcade [...] mettre arcade pendant temps d attente [...]
//       des pop up adaptees en fonction du temps libre [...] pointille »)
//       au telephone : la ligne des arcades (apres l accueil, ses heures a
//       l ouverture, relues quand l arrivee change), l heure choisie qui part
//       au serveur et au blocage ; l attente ou quelque chose tient devient un
//       cadre en pointille qui se deplie (« Y faire vos arcades » quand elles
//       sont apres les activites, « Arriver a » verifie par le serveur) ;
//       l heure du plan hors de la grille garde sa puce ; le bowling pose
//       sur les arcades les decale, les arcades posees sur le bowling le
//       liberent ; rien a proposer quand le libre de la formule couvre
//       l attente.
//   [J] (2026-10-13, Movsar : « pas de mot décale mais [...] entouré en
//       pointillé les heures où y a besoin d explication [...] et expliqué
//       super proprement en bas avec couleur différente par problème »),
//       dans [B] et [H] : une heure serree, decalee ou impossible n ecrit
//       plus son mot (il reste porte par la puce), son contour est en
//       tirets de la teinte de SA ligne, et deux lignes d une plage n ont
//       jamais la meme teinte.
//   --mutate : une regle cassee a la fois, en memoire (le formulaire servi au
//       navigateur, ou le moteur compile pour le serveur) : chacune doit faire
//       rougir le gate ; le disque n est jamais ecrit, et on le verifie.
//   --base <commit> : [A] rejoue aussi le formulaire de ce commit, ses
//       demandes et son blocage doivent etre ceux d aujourd hui.
//
// Lancement : node scripts/formules-arrivee-form-check.js [--mutate] [--base <commit>]

const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { spawnSync, execFileSync } = require('child_process');

// Aucune base, aucun envoi : seuls les NOMS des variables sont lus.
for (const cle of Object.keys(process.env)) {
  if (/(^PG|DATABASE|POSTGRES|RESEND|SECRET|TOKEN|API_KEY|PASSWORD|PASSPHRASE)/i.test(cle)) delete process.env[cle];
}
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_ARRIVEE_FORM_PORT || 4517);
const BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.PINLANE_DEVTUNNEL_PORT = String(PORT);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const PAX = 10;
const ARGS = process.argv.slice(2);
const BASE_COMMIT = (() => {
  const rang = ARGS.indexOf('--base');
  return rang >= 0 ? String(ARGS[rang + 1] || '').trim() : '';
})();
const SEULEMENT = String(process.env.PINLANE_ARRIVEE_FORM_SCENARIOS || '').split(',').map((s) => s.trim()).filter(Boolean);
// Le reglage que la meta publique donne au formulaire (api/public-booking-meta,
// lib/formula-visit) : ses valeurs par defaut, l arrivee proposee.
const REGLAGE = { arrivalFirst: true, maxWaitMinutes: 30, maxVisitMinutes: 0, freeDurationPolicy: 'default' };
const COUPEE = 'La réservation par heure d’arrivée n’est pas proposée par ce centre.';
const JS = 'assets/fungalaxy-booking.js';
const CSS = 'assets/fungalaxy-booking.css';

// ---------------------------------------------------------------------------
// LES CONTRE-EPREUVES : une regle cassee chacune, et les scenarios qui la
// voient. Le formulaire est servi casse au navigateur ; le moteur est compile
// casse, avant tout require du serveur. Le disque n est jamais ecrit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'l option n est jamais proposee', fichier: JS, scenarios: ['A'],
    de: "    return state.onglet === 'formules' && ancres.length > 0 && Boolean(v && v.arrivalFirst === true) && !(b && b.arrivalFirst === false);",
    vers: '    return false;' },
  { nom: 'la meta du centre n est plus lue (l option sans reglage, ou coupee)', fichier: JS, scenarios: ['A'],
    de: 'Boolean(v && v.arrivalFirst === true)', vers: 'true' },
  { nom: 'les bornes du serveur n effacent plus l option', fichier: JS, scenarios: ['E'],
    de: ' && !(b && b.arrivalFirst === false);', vers: ';' },
  { nom: 'la liste des arrivees part des l arrivee sur les heures', fichier: JS, scenarios: ['A'],
    de: '    if (ancres.length) { majPistes(d); majEtapes(d); rendreArrivees(); rendreArcades(); }',
    vers: '    if (ancres.length) { majPistes(d); majEtapes(d); if (avecArrivee) chargerArrivees(); rendreArcades(); }' },
  { nom: 'une demande sans arrivee porte un parametre de plus', fichier: JS, scenarios: ['A'],
    de: "    if (state.arrivee) q.set('arrival', state.arrivee);", vers: "    q.set('arrival', state.arrivee);" },
  { nom: 'l heure d arrivee choisie ne part pas au serveur', fichier: JS, scenarios: ['C'],
    de: "    if (state.arrivee) q.set('arrival', state.arrivee);", vers: '    void 0;' },
  // L accueil commence a l heure choisie, au moteur (2026-10-13) : l heure de
  // l accueil et celle de l arrivee sont la meme, l ecran ne peut plus dire
  // l une pour l autre. La regle se casse donc au serveur.
  { nom: 'l accueil repart dix minutes avant l heure choisie (serveur)', fichier: 'lib/ops-engine.js', scenarios: ['C'],
    de: '  const accueil = arrivee;', vers: '  const accueil = arrivee - FORMULA_ARRIVAL_MINUTES;' },
  { nom: 'le recapitulatif dit « Arrivée conseillée » pour une arrivee choisie', fichier: JS, scenarios: ['C'],
    de: "(plan.arrivalPlan ? 'Arrivée à' : 'Arrivée conseillée à')", vers: "'Arrivée conseillée à'" },
  { nom: 'l ecran final dit « Arrivée conseillée » pour une arrivee choisie', fichier: JS, scenarios: ['C'],
    de: "    if (planFin.arrivalPlan) quand = quand.replace('Arrivée conseillée à', 'Arrivée à');", vers: '    void 0;' },
  { nom: 'la reservation part sans l heure d arrivee', fichier: JS, scenarios: ['C'],
    de: '      base.preference.arrivalTime = state.arrivee;', vers: '      void 0;' },
  { nom: 'la demande de reservation change sans arrivee choisie', fichier: JS, scenarios: ['A'],
    de: '    if (state.arrivee) {\n      base.preference.arrivalTime = state.arrivee;',
    vers: '    if (true) {\n      base.preference.arrivalTime = state.arrivee;' },
  { nom: 'la visite ne se lit plus dans l ordre de la frise (les arcades perdent leur ligne)', fichier: JS, scenarios: ['C'],
    de: '    ((parArrivee && parArrivee.frise) || []).forEach(function (s) {', vers: '    ([]).forEach(function (s) {' },
  { nom: 'la fin de la visite ne vient plus du serveur', fichier: JS, scenarios: ['C'],
    de: "    var fin = journee ? '' : (slot.visitEndTime || plan.endTime || '');", vers: "    var fin = journee ? '' : (plan.endTime || '');" },
  { nom: 'le programme perd ses lignes quand une reponse d arrivee vient sans grille', fichier: JS, scenarios: ['H'],
    de: '    return (d && d.anchors) || (state.arrivee && grilleSansArrivee && grilleSansArrivee.cle === cleDemande() && grilleSansArrivee.anchors) || {};',
    vers: '    return (d && d.anchors) || {};' },
  // La grille d une reponse d arrivee propose les heures de son plan (serveur,
  // 2026-10-13) : la regle de l ecran (les heures du plan, pas celles de la
  // grille) ne se voit plus que sur une reponse sans grille (D). L ordre des
  // deux grilles dans ancrage() ne se voit plus du tout (memes heures, etats
  // lus dans la reponse, propositions lues dans le plan) : sa contre-epreuve
  // est partie le 13/10.
  { nom: 'le bowling et le laser gardent les heures d une demande sans arrivee', fichier: JS, scenarios: ['D'],
    de: 'defauts = (state.arrivee ? plan0.anchorPlan && plan0.anchorPlan.times : a0.defaultTimes) || {};', vers: 'defauts = a0.defaultTimes || {};' },
  { nom: 'la ligne d arrivee promet des arcades a toute formule', fichier: JS, scenarios: ['D'],
    de: "'À votre heure : ' + nomBas(libres[0].label) + ' en attendant '", vers: "'À votre heure : arcades en attendant '" },
  { nom: 'une arrivee avec attente perd son mot « attente »', fichier: JS, scenarios: ['B'],
    de: "  var MOTS_AVIS = { arrival_wait: 'attente', arrival_visit: 'longue' };", vers: "  var MOTS_AVIS = { arrival_visit: 'longue' };" },
  { nom: 'une longue attente refuse de nouveau l arrivee (serveur)', fichier: 'lib/ops-engine.js', scenarios: ['B'],
    de: "      return { ok: true, code: '', reason: '', scenario: decorated, arrival: borne, warning: warning || avis };",
    vers: '      return { ok: false, code: borne.code, reason: borne.reason, scenario: decorated, arrival: borne };' },
  { nom: 'la ligne sous la plage ne dit plus l attente en fourchette', fichier: JS, scenarios: ['B'],
    de: "    if (g.etat === 'soft' && avis && avis.minutes) {", vers: '    if (false) {' },
  { nom: 'la ligne d une attente ne dit plus sa cause', fichier: JS, scenarios: ['B'],
    de: "      var pourquoi = avis.cause ? (/^avec /i.test(avis.cause) ? ', ' : ' : ') + minuscule(avis.cause)", vers: "      var pourquoi = false ? ''" },
  { nom: 'la phrase longue du serveur n est plus en titre', fichier: JS, scenarios: ['F'],
    de: "      if (refus && x.reason) chip.setAttribute('title', x.reason);", vers: '      void 0;' },
  { nom: 'choisir une arrivee efface toutes les heures posees', fichier: JS, scenarios: ['H'],
    de: '      avant.pins.forEach(function (id) { delete state.pins[id]; });',
    vers: '      Object.keys(state.pins).forEach(function (id) { delete state.pins[id]; }); state.laserParts = [];' },
  { nom: 'choisir une arrivee garde les heures posees avant elle', fichier: JS, scenarios: ['H'],
    de: '      avant.pins.forEach(function (id) { delete state.pins[id]; });', vers: '      void 0;' },
  { nom: 'la liste des arrivees part sans les heures posees', fichier: JS, scenarios: ['H'],
    de: "    if (liste) { q.set('arrivals', '1'); return '/api/public-availability?' + q.toString(); }",
    vers: "    if (liste) { q.delete('preferredTimes'); q.delete('laserGameTimes'); q.set('arrivals', '1'); return '/api/public-availability?' + q.toString(); }" },
  { nom: 'les heures du bowling se cachent quand une arrivee est choisie', fichier: JS, scenarios: ['H'],
    de: "      if (alt) alt.hidden = e.etat === 'choisi' || e.etat === 'surplace';\n    });",
    vers: "      if (alt) alt.hidden = e.etat === 'choisi' || e.etat === 'surplace';\n      var pisteE = $('.fg-etape__piste', li); if (pisteE && e.cle !== 'arrivee') pisteE.hidden = Boolean(state.arrivee);\n    });" },
  { nom: 'une heure avant l arrivee ne decale plus, elle se refuse', fichier: JS, scenarios: ['H'],
    de: '  var DECALENT = { anchor_overlap: 1, arrival_before: 1, arrival_welcome: 1, arcade_overlap: 1 };', vers: '  var DECALENT = { anchor_overlap: 1, arcade_overlap: 1 };' },
  { nom: 'une heure prise avant l arrivee la garde', fichier: JS, scenarios: ['H'],
    de: "      if (!adaptation) adaptation = { deplace: 'arrivee', pour: idA, t: t, avant: state.arrivee };\n      state.arrivee = '';",
    vers: '      void 0;' },
  { nom: 'la visite ne dit plus l arrivee avancee', fichier: JS, scenarios: ['H'],
    de: "avancee].filter(Boolean).join(' · '), bouge: Boolean(avancee) });", vers: "''].filter(Boolean).join(' · ') });" },
  { nom: 'une arrivee qui libere le bowling ne se dit plus « décale »', fichier: JS, scenarios: ['H'],
    de: "    if (t.libere) return { etat: 'shift', mot: 'décale', raison: t.libere.raison, conflit: t.libere };", vers: '' },
  { nom: 'la visite ne dit plus le bowling replace apres l arrivee', fichier: JS, scenarios: ['H'],
    de: ": 'replacé après votre arrivée (' + adaptation.t + ')')", vers: ": '')" },
  { nom: 'la liste ne libere plus les heures posees avant chaque arrivee (serveur)', fichier: 'api/public-availability.js', scenarios: ['H'],
    de: '          const garde = (texte) => !(minutesDe(texte) < seuil);', vers: '          const garde = () => true;' },
  { nom: 'l attente d une activite ne dit plus depuis quelle arrivee', fichier: JS, scenarios: ['H'],
    de: "        : g.piste !== 'arrivee' && state.arrivee ? ' après votre arrivée (' + state.arrivee + ')' : '';", vers: "        : '';" },
  { nom: 'la reponse d une arrivee ne porte plus la grille jugee avec elle (serveur)', fichier: 'api/public-availability.js', scenarios: ['H'],
    de: '            anchorMeta = formulaArrivalAnchorGrid({ centerId, date, formuleId, pax, duration, arrival: heureArrivee, preference: posees, anchorMeta, snapshot, guardFor: gardeDuPlan, proposees: entree.ok ? entree.anchors : null });',
    vers: '            void formulaArrivalAnchorGrid;' },
  { nom: 'la grille avec arrivee propose les heures de la journee sans arrivee (serveur)', fichier: 'lib/availability-slots.js', scenarios: ['H'],
    de: '  return { ...anchorMeta, defaultTimes, activities };', vers: '  return { ...anchorMeta, activities };' },
  { nom: 'une arrivee choisie reste quand le centre la coupe', fichier: JS, scenarios: ['E'],
    de: '    if (state.arrivee && j.arrivalBounds && j.arrivalBounds.arrivalFirst === false) {', vers: '    if (false) {' },
  { nom: 'la puce d arrivee ignore l avertissement du moteur', fichier: JS, scenarios: ['D'],
    de: 'reason: court, warning: x.warning, libere: libere }', vers: 'reason: court, libere: libere }' },
  { nom: 'la liste des arrivees perd l avertissement de la porte (serveur)', fichier: 'lib/ops-engine.js', scenarios: ['D'],
    de: '    ...(choix.result.warning ? { warning: choix.result.warning } : {}),', vers: '    ...({}),' },
  { nom: 'une arrivee refusee laisse la liste perimee', fichier: JS, scenarios: ['F'],
    de: "    if (state.arrivee && !slot && arrivees.liste) { arrivees.lu = 0; if (etapeOuverte === 'arrivee') chargerArrivees(); }", vers: '    void 0;' },
  { nom: 'le refus d une arrivee ne propose plus la suivante', fichier: JS, scenarios: ['F'],
    de: '      if (versA) {', vers: '      if (false) {' },
  // Les arcades a leur heure et le temps libre (2026-10-13).
  { nom: 'la ligne des arcades n existe plus', fichier: JS, scenarios: ['I'],
    de: '    if (aDesArcades(d)) {\n      var rangee = arcadeDuPlan();', vers: '    if (false) {\n      var rangee = arcadeDuPlan();' },
  { nom: 'les heures d arcade se demandent des que l arrivee est choisie', fichier: JS, scenarios: ['I'],
    de: '    if (ancres.length) { majPistes(d); majEtapes(d); rendreArrivees(); rendreArcades(); }',
    vers: '    if (ancres.length) { majPistes(d); majEtapes(d); rendreArrivees(); if (aDesArcades(d)) chargerArcades(); }' },
  { nom: 'la ligne ouverte garde les heures d arcade d une autre arrivee', fichier: JS, scenarios: ['I'],
    de: "    if (etapeOuverte === 'arcade_time' && arcades.cle !== cleArcades() && arcades.enCours !== cleArcades()) { chargerArcades(); return; }", vers: '' },
  { nom: 'l heure d arcade choisie ne part pas au serveur', fichier: JS, scenarios: ['I'],
    de: "    if (state.arrivee && state.arcade) q.set('arcade', state.arcade);", vers: '    void 0;' },
  { nom: 'le temps libre ne propose plus les arcades', fichier: JS, scenarios: ['I'],
    de: "      if (dureeArc && arc.placement === 'after' && m >= dureeArc) {", vers: '      if (false) {' },
  { nom: 'le temps libre propose de deplacer des arcades deja dans une attente', fichier: JS, scenarios: ['I'],
    de: "      if (dureeArc && arc.placement === 'after' && m >= dureeArc) {", vers: '      if (dureeArc && m >= dureeArc) {' },
  { nom: 'l idee des arcades ne dit plus ou elles etaient', fichier: JS, scenarios: ['I'],
    de: "', au lieu de ' + arc.startTime });", vers: "'' });" },
  { nom: 'l heure du plan hors de la grille n a plus sa puce', fichier: JS, scenarios: ['I'],
    de: '    if (liste && duPlan && !liste.some(function (x) { return x.time === duPlan; })) liste = ', vers: '    if (false) liste = ' },
  { nom: 'l arrivee plus tard ne se propose plus', fichier: JS, scenarios: ['I'],
    de: "      if (s.placement === 'before' && tard && tard.time && Number(tard.savedMinutes) > 0) {", vers: '      if (false) {' },
  { nom: 'le cadre du temps libre ne se deplie plus', fichier: JS, scenarios: ['I'],
    de: '        if (choix) choix.hidden = !ici;', vers: '        void 0;' },
  { nom: 'une heure de bowling sur les arcades ne les decale plus', fichier: JS, scenarios: ['I'],
    de: '  var DECALENT = { anchor_overlap: 1, arrival_before: 1, arrival_welcome: 1, arcade_overlap: 1 };', vers: '  var DECALENT = { anchor_overlap: 1, arrival_before: 1, arrival_welcome: 1 };' },
  { nom: 'decaler les arcades garde leur heure', fichier: JS, scenarios: ['I'],
    de: "      if (autre === 'arcade_time') {\n        state.arcade = '';", vers: "      if (autre === 'arcade_time') {\n        void 0;" },
  { nom: 'des arcades sur le bowling pose ne le liberent plus', fichier: JS, scenarios: ['I'],
    de: '        } else delete state.pins[c.activityId];', vers: '        } else void 0;' },
  { nom: 'la visite ne dit plus le bowling replace autour des arcades', fichier: JS, scenarios: ['I'],
    de: "'replacé autour de vos arcades (' + adaptation.t + ')'", vers: "''" },
  { nom: 'la visite ne dit plus les arcades a l heure du client', fichier: JS, scenarios: ['I'],
    de: "    var ouA = !leveeA ? (s.chosen ? 'à votre heure' : '')", vers: "    var ouA = !leveeA ? ('')" },
  { nom: 'le mot d un probleme revient sous l heure', fichier: JS, scenarios: ['B', 'H'],
    de: "    $('small', chip).textContent = on || prop || e.etat === 'wave' || e.nom ? mot : '';", vers: "    $('small', chip).textContent = mot;" },
  { nom: 'deux problemes d une plage ont la meme teinte', fichier: JS, scenarios: ['B', 'H'],
    de: '  function teinteDe(k) { return String(k % TEINTES); }', vers: "  function teinteDe(k) { return '0'; }" },
  { nom: 'une heure a probleme ne prend pas la teinte de sa ligne', fichier: JS, scenarios: ['B', 'H'],
    de: '    groupes.forEach(function (g, k) { g.puces.forEach(function (c) { c.dataset.teinte = teinteDe(k); }); });\n', vers: '' },
  { nom: 'les heures a probleme ne sont plus entourees en tirets', fichier: CSS, scenarios: ['B', 'H'],
    de: '.fg-chip.is-soft, .fg-chip.is-shift, .fg-chip.is-off { border-style: dashed;', vers: '.fg-chip.is-soft, .fg-chip.is-shift, .fg-chip.is-off { border-style: solid;' },
  { nom: 'la phrase sous la plage double le point final', fichier: JS, scenarios: ['I'],
    de: "    var r = String(g.raison || 'Indisponible').replace(/\\.+$/, '');", vers: "    var r = g.raison || 'Indisponible';" },
  { nom: 'le blocage part sans l heure d arcade', fichier: JS, scenarios: ['I'],
    de: '      if (state.arcade) base.preference.arcadeTime = state.arcade;', vers: '      void 0;' },
  { nom: 'le libre de la formule ne couvre plus l attente (serveur)', fichier: 'lib/ops-engine.js', scenarios: ['I'],
    de: '  const mobiles = libres.map((libre, rang) => rang).filter((rang) => !Number.isFinite(libres[rang].start));',
    vers: '  const mobiles = libres.map((libre, rang) => rang).filter((rang) => !Number.isFinite(libres[rang].start) && libres[rang].aHeure);' },
  { nom: 'le refus des arcades ne nomme plus l activite posee (serveur)', fichier: 'lib/ops-engine.js', scenarios: ['I'],
    de: '  if (!sonde.ok) return refusArrivee(time, sonde.code, sonde.reason, sonde.conflict ? { conflict: sonde.conflict } : {});', vers: '  if (!sonde.ok) return refusArrivee(time, sonde.code, sonde.reason);' },
];
const MUTATION_PREUVE = '[mutation] servie :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_ARRIVEE_FORM_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
function muter(contenu, mutation) {
  const texte = contenu.split('\r\n').join('\n');
  if (texte.split(mutation.de).length - 1 !== 1) {
    console.error(`mutation impossible : ancre absente ou multiple dans ${mutation.fichier} : ${mutation.de.slice(0, 70)}`);
    process.exit(2);
  }
  return texte.split(mutation.de).join(mutation.vers);
}
let preuveDite = false;
function direPreuve() {
  if (preuveDite) return;
  preuveDite = true;
  console.log(`${MUTATION_PREUVE} ${MUTATION.nom}`);
}
// Le moteur casse a la compilation : avant le premier require du serveur.
if (MUTATION && !MUTATION.fichier.startsWith('assets/')) {
  const compile = Module.prototype._compile;
  const cible = path.resolve(ROOT, MUTATION.fichier);
  Module.prototype._compile = function compilerAvecMutation(contenu, nom) {
    if (path.resolve(nom) !== cible) return compile.call(this, contenu, nom);
    const mute = muter(contenu, MUTATION);
    direPreuve();
    return compile.call(this, mute, nom);
  };
}

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return Boolean(condition);
}
function section(titre) { console.log(`\n${titre}`); }
// Le formulaire soude ses nombres a leurs unites (typo, espaces insecables) :
// le gate lit son texte sans eux, avec le meme helper que les autres gates.
const sansInsecable = (texte) => (texte === null || texte === undefined ? texte : String(texte).replace(/[\u00a0\u202f]/g, ' '));
const norm = (s) => String(sansInsecable(s) || '').replace(/\s+/g, ' ').trim();
// Une lecture de la page, chacun de ses textes passe par sansInsecable.
function lisible(v) {
  if (typeof v === 'string') return norm(v);
  if (Array.isArray(v)) return v.map(lisible);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lisible(x)]));
  return v;
}
const minuscule = (s) => { const t = String(s || ''); return t.charAt(0).toLowerCase() + t.slice(1); };
const heureAffichee = (t) => (t === '24:00' ? 'minuit' : String(t || ''));
const params = (u) => new URL(u, BASE_URL).searchParams;
const estListe = (u) => params(u).get('arrivals') === '1';
const sansDoublons = (liste) => liste.filter((x, i) => liste.indexOf(x) === i);
const minutesDe = (h) => { const [a, b] = String(h || '').split(':').map(Number); return a * 60 + b; };
const heureDe = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// Une duree comme le moteur et le formulaire l ecrivent : 50 min, 1 h 20, 2 h.
function libelleDuree(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60), r = total % 60;
  return !h ? `${r} min` : `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}`;
}
// Le premier ecart entre deux listes de demandes.
function ecartListes(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (a[i] !== b[i]) return `#${i} « ${a[i] || ''} » / « ${b[i] || ''} »`;
  return '';
}
// Le blocage sans ce qui change d une visite a l autre : son jeton, et la
// provenance (elle porte l heure de la visite).
function corpsComparable(corps) {
  if (!corps) return '';
  const { holdToken: _jeton, acquisition: _provenance, ...reste } = corps;
  return JSON.stringify(reste);
}

// ---------------------------------------------------------------------------
// LE SERVEUR DE DEV, ENVELOPPE : la meta donne le reglage d arrivee du
// scenario ; le formulaire casse (contre-epreuve) ou celui d un commit
// (--base) est servi a la place de celui du depot.
// ---------------------------------------------------------------------------
let reglage = REGLAGE;   // le reglage de la meta (null : la cle absente, comme un serveur d avant)
let servirAncien = '';   // le formulaire d un commit (--base)
let prochainId = 9100;
// Les huit pistes et l arene (30 armes) prises sur [debut, fin).
function pleines(date, debut, fin) {
  const dossiers = [];
  const duree = (minutesDe(fin) - minutesDe(debut)) / 60;
  for (let piste = 1; piste <= 8; piste += 1) {
    prochainId += 1;
    dossiers.push({ id: prochainId, centerId: 'libramont', date, startTime: debut, duration: duree, totalDuration: duree, pax: 6, lanes: [piste], laneCount: 1, type: 'bowling', status: 'confirmed', validationStatus: 'confirmed', program: null, opsPlan: null, name: 'Groupe' });
  }
  for (let t = minutesDe(debut); t < minutesDe(fin); t += 30) {
    prochainId += 1;
    dossiers.push({ id: prochainId, centerId: 'libramont', date, startTime: heureDe(t), duration: 0.5, pax: 30, type: 'laser', status: 'confirmed', validationStatus: 'confirmed', program: null, name: 'Groupe',
      opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena', activityId: 'laser_game', start: t, end: t + 25, startTime: heureDe(t), endTime: heureDe(t + 25), players: 30 }] } });
  }
  return dossiers;
}
// Le bowling bloque au planning sur [debut, fin) (la console, « Entretien ») :
// une arrivee a 10:00 devient impossible (la garde finale de la creation),
// 10:30 tient.
function blocageBowling(date, debut, fin) {
  return [{ id: 530, centerId: 'libramont', date, scopeType: 'activity', scopeRef: 'bowling', startMin: minutesDe(debut), endMin: minutesDe(fin), recurrence: 'once', reason: 'Entretien' }];
}
function semer(mock, plages) {
  mock.blocagesDev.clear();
  mock.occupationDev.length = 0;
  mock.blocsDev.length = 0;
  mock.dernierePose.body = null;
  mock.dernierePose.blocages.length = 0;
  plages.forEach(([debut, fin]) => mock.occupationDev.push(...pleines(mock.DATE, debut, fin)));
}
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    // Tous les navigateurs du gate partagent 127.0.0.1 : le plafond par
    // adresse (60 demandes par minute) les compterait ensemble.
    const seaux = globalThis.__pinlaneRateBuckets;
    if (seaux) [...seaux.keys()].filter((k) => /^public-(availability|holds|reservations):/.test(k)).forEach((k) => seaux.delete(k));
    if (url.pathname === `/${CSS}` && MUTATION && MUTATION.fichier === CSS) {
      const feuille = muter(fs.readFileSync(path.join(ROOT, CSS), 'utf8'), MUTATION);
      direPreuve();
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(feuille);
      return;
    }
    if (url.pathname === `/${JS}` && (servirAncien || (MUTATION && MUTATION.fichier === JS))) {
      let corps = servirAncien;
      if (!corps) {
        corps = muter(fs.readFileSync(path.join(ROOT, JS), 'utf8'), MUTATION);
        direPreuve();
      }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(corps);
      return;
    }
    if (url.pathname === '/api/public-booking-meta' && req.method === 'GET') {
      const fin = res.end.bind(res);
      res.end = (corps, ...reste) => {
        try {
          const j = JSON.parse(String(corps));
          if (j && j.center) {
            if (reglage) j.center.formulaVisit = { ...reglage };
            else delete j.center.formulaVisit;
          }
          return fin(JSON.stringify(j), ...reste);
        } catch (error) {
          return fin(corps, ...reste);
        }
      };
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// ---------------------------------------------------------------------------
// LE NAVIGATEUR
// ---------------------------------------------------------------------------
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return false; }
}
// Un contexte neuf par scenario : ce qu il demande, ce qu il recoit, ce qu il
// retient (le corps des blocages), ses erreurs.
async function ouvrir(browser, { largeur = 1280, hauteur = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const suivi = { erreurs: [], demandes: [], reponses: [], blocages: [] };
  page.on('pageerror', (e) => suivi.erreurs.push(String((e && e.message) || e)));
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/public-availability')) suivi.demandes.push(u);
    if (u.includes('/api/public-holds') && req.method() === 'POST') {
      try { const corps = JSON.parse(req.postData() || '{}'); if (!corps.release) suivi.blocages.push(corps); } catch (error) { /* corps illisible */ }
    }
  });
  page.on('response', async (rep) => {
    if (!rep.url().includes('/api/public-availability')) return;
    try { suivi.reponses.push({ url: rep.url(), json: await rep.json() }); } catch (error) { /* corps illisible */ }
  });
  return { ctx, page, suivi };
}
// La derniere reponse d une demande, attendue un instant : l ecran peut se
// mettre a jour avant que le gate ait lu le corps.
async function reponseAttendue(suivi, filtre, ms = 4000) {
  const fin = Date.now() + ms;
  for (;;) {
    for (let i = suivi.reponses.length - 1; i >= 0; i -= 1) if (filtre(suivi.reponses[i].url)) return suivi.reponses[i].json;
    if (Date.now() > fin) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function calme(page) {
  await attendre(page, () => !document.querySelector('#hourZone.is-busy') && !document.querySelector('.fg-chip.is-pending'), 15000);
  await page.waitForTimeout(350);
}
async function versHeures(page, mock, formuleId) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  await page.click('#dayBtn');
  // Le pointeur quitte la grille : a 560 px et moins, le calendrier s ouvre au
  // milieu de l ecran, sous l endroit du bouton. Survole, un jour a la note
  // sur deux lignes grandit la fenetre centree, la grille glisse sous le
  // pointeur, un autre jour est survole, et ainsi de suite (le jour a viser
  // n est jamais « stable »). Un telephone n a pas de pointeur pose.
  await page.mouse.move(0, 0);
  const [y, mo] = mock.DATE.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    await page.click(y * 12 + (mo - 1) > Number(an) * 12 + MOIS.indexOf(nom.toLowerCase()) ? '#calNext' : '#calPrev');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  await attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await attendre(page, () => document.querySelector('#dayPop').hidden, 3000);
  await page.fill('#paxInput', String(PAX));
  await page.press('#paxInput', 'Enter');
  await attendre(page, (n) => document.querySelector('#paxInput').value === String(n), 3000, PAX);
  await page.click('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
  await page.click('#tabFor');
  await attendre(page, () => !document.querySelector('#panelFor').hidden && document.querySelectorAll('#gridFor .fg-card').length > 0, 5000);
  await page.click(`#gridFor .fg-card[data-formule="${formuleId}"]`);
  await page.waitForTimeout(250);
  await page.click('#goHours');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 8000);
  return attendre(page, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone.is-busy'), 15000);
}
// Le programme, ligne par ligne : la cle, l etat, l heure dite, ce qui est
// deplie (les heures de la piste, ou « Choisir l’heure moi-même »).
async function lireProgramme(page) {
  return lisible(await page.evaluate(() => {
    const t = (n) => (n ? n.textContent : '');
    const ol = document.querySelector('#hourZone .fg-etapes');
    if (!ol) return { lignes: [] };
    return {
      lignes: [...ol.children].map((li) => {
        const tete = li.querySelector('.fg-etape__tete');
        const heure = li.querySelector('.fg-etape__heure');
        const piste = li.querySelector('.fg-etape__piste');
        const arr = li.querySelector('.fg-etape__arr');
        return {
          cle: li.dataset.cle || '',
          classe: li.className,
          cache: li.getAttribute('aria-hidden') === 'true',
          tete: tete ? { tag: tete.tagName, type: tete.getAttribute('type') || '', expanded: tete.getAttribute('aria-expanded'), controls: tete.getAttribute('aria-controls') || '', cible: Boolean(document.getElementById(tete.getAttribute('aria-controls') || '')) } : null,
          detail: t(li.querySelector('.fg-etape__quoi small')),
          heure: heure ? (heure.dataset.mot || t(heure)) : '',
          ouverte: li.classList.contains('is-open'),
          piste: piste ? !piste.hidden : null,
          sansArrivee: arr ? !arr.hidden : null,
        };
      }),
    };
  }));
}
const ligneDe = (programme, cle) => ((programme && programme.lignes) || []).find((l) => l.cle === cle) || null;
const estBorneArrivee = (l) => /fg-etape--borne/.test(l.classe) && /fg-etape--arrivee/.test(l.classe) && l.cache;
const resumeLignes = (programme) => ((programme && programme.lignes) || []).map((l) => `${l.cle || l.classe.replace(/\bfg-etape\b\s*/g, '').trim()}:${l.heure}`).join(' | ');
async function lireVisite(page) {
  return lisible(await page.evaluate(() => {
    const t = (n) => (n ? n.textContent : '');
    const zone = document.querySelector('#planZone');
    return {
      etapes: zone ? [...zone.querySelectorAll('.fg-visit__step')].map((li) => ({ b: t(li.querySelector('b')), titre: t(li.querySelector('span')), detail: t(li.querySelector('small')), genre: li.className })) : [],
      tete: t(zone && zone.querySelector('.fg-visit__span')),
      avis: t(zone && zone.querySelector('.fg-notice b')),
      vers: zone ? [...zone.querySelectorAll('[data-arrivee-vers]')].map((b) => ({ heure: b.dataset.arriveeVers, texte: t(b) })) : [],
      somme: t(document.querySelector('#hourSum')),
      zone: t(document.querySelector('#hourZone')),
    };
  }));
}
async function lirePuces(page, piste) {
  return lisible(await page.evaluate((id) => [...document.querySelectorAll(`.fg-track[data-activity="${id}"] .fg-chip`)].map((c) => ({
    // Le mot de l heure est porte par la puce (2026-10-13) : il ne s ecrit
    // plus dessous pour un probleme ([J]).
    time: c.dataset.time, ok: c.dataset.ok, etat: c.dataset.state || '', mot: c.dataset.mot || '',
    titre: c.getAttribute('title') || '', decrite: c.getAttribute('aria-describedby') || '',
  })), piste));
}
async function lirePourquoi(page, piste) {
  return lisible(await page.evaluate((id) => [...document.querySelectorAll(`.fg-track[data-activity="${id}"] .fg-why-list__item`)].map((li) => ({
    id: li.id, etat: li.dataset.etat || '', heures: String(li.dataset.heures || '').split(' ').filter(Boolean),
    cle: (li.querySelector('.fg-key') || {}).textContent || '', texte: (li.querySelector('span') || {}).textContent || '', lit: li.classList.contains('is-lit'),
  })), piste));
}
// [J] LES HEURES QUI POSENT PROBLEME, partout dans l ecran des heures (les
// plages repliees comprises) : plus de mot sous l heure (seuls « choisi »,
// « proposé » et le nom d une partie s ecrivent), un contour en tirets de la
// teinte de la ligne qu elle pointe, et une teinte par ligne dans une plage.
// Lu au repos : les transitions de couleur finies. Une heure survolee
// (contour plein) ou demandee (contour d alerte) ne se juge pas sur sa
// couleur.
const vusProblemes = { lignes: 0, deuxLignes: 0, puces: 0 };
async function problemesEnCouleur(page, label) {
  await attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity), 5000);
  const r = await page.evaluate(() => {
    const fautes = [];
    // Les couleurs se lisent au repos : une heure qui vient de changer d etat
    // demarre sa transition de contour au moment meme de la lecture, et se
    // lirait a la couleur d avant. Le temps de la lecture, plus de transition.
    const gel = document.createElement('style');
    gel.textContent = '#hourZone .fg-chip, #hourZone .fg-why-list__quand { transition: none !important; }';
    document.head.appendChild(gel);
    let lignes = 0;
    let deuxLignes = 0;
    let puces = 0;
    document.querySelectorAll('#hourZone .fg-track .fg-period').forEach((sec) => {
      const ou = `${sec.closest('.fg-track').dataset.activity}/${sec.dataset.period}`;
      const items = [...sec.querySelectorAll('.fg-why-list__item')];
      const teintes = items.map((li) => {
        const q = li.querySelector('.fg-why-list__quand');
        const s = q ? getComputedStyle(q) : null;
        if (!s || s.borderTopStyle !== 'dashed' || s.borderTopColor !== s.color) fautes.push(`${ou} ligne ${li.dataset.heures} : contour ${s && s.borderTopStyle} ${s && s.borderTopColor}, texte ${s && s.color}`);
        return s ? s.borderTopColor : '';
      });
      lignes += items.length;
      if (items.length >= 2) deuxLignes += 1;
      if (new Set(teintes).size !== teintes.length) fautes.push(`${ou} : ${items.length} lignes pour ${new Set(teintes).size} teintes`);
      sec.querySelectorAll('.fg-chip').forEach((c) => {
        if (!['soft', 'shift', 'hard'].includes(c.dataset.state) || c.classList.contains('is-on') || c.classList.contains('is-proposed')) return;
        puces += 1;
        const ecrit = ((c.querySelector('small') || {}).textContent || '').trim();
        if (ecrit && !/^partie \d/.test(ecrit)) fautes.push(`${ou} ${c.dataset.time} ecrit « ${ecrit} »`);
        const q = (document.getElementById(c.getAttribute('aria-describedby') || '') || { querySelector: () => null }).querySelector('.fg-why-list__quand');
        if (!q) { fautes.push(`${ou} ${c.dataset.time} sans sa ligne`); return; }
        if (c.matches(':hover') || c.classList.contains('is-asked')) return;
        const cs = getComputedStyle(c);
        if (cs.borderTopStyle !== 'dashed') fautes.push(`${ou} ${c.dataset.time} contour ${cs.borderTopStyle}`);
        if (cs.borderTopColor !== getComputedStyle(q).borderTopColor) fautes.push(`${ou} ${c.dataset.time} ${cs.borderTopColor}, sa ligne ${getComputedStyle(q).borderTopColor}`);
      });
    });
    gel.remove();
    return { fautes, lignes, deuxLignes, puces };
  });
  vusProblemes.lignes += r.lignes;
  vusProblemes.deuxLignes += r.deuxLignes;
  vusProblemes.puces += r.puces;
  ok(r.puces > 0 && r.fautes.length === 0, `[J] ${label} : chaque heure qui pose probleme est sans mot, entouree en tirets de la teinte de sa ligne, une teinte par ligne (${r.puces} heures, ${r.lignes} lignes, ${r.deuxLignes} plages a deux lignes ou plus)`, r.fautes.slice(0, 4).join(' | '));
  return r;
}
// Une heure touchee au doigt, si elle se prend.
function toucher(page, piste, heure) {
  return page.evaluate(({ id, h }) => {
    const c = document.querySelector(`.fg-track[data-activity="${id}"] .fg-chip[data-time="${h}"]`);
    if (!c || c.dataset.ok === 'false') return false;
    c.click();
    return true;
  }, { id: piste, h: heure });
}
// Une heure d une plage repliee : sa plage s ouvre d abord, comme au doigt.
async function ouvrirPlage(page, piste, heure) {
  await page.evaluate(({ id, h }) => {
    const c = document.querySelector(`.fg-track[data-activity="${id}"] .fg-chip[data-time="${h}"]`);
    const sec = c && c.closest('.fg-period');
    if (sec && !sec.classList.contains('is-open')) sec.querySelector('.fg-period__btn').click();
  }, { id: piste, h: heure });
  await page.waitForTimeout(450);
}
async function ouvrirArrivees(page) {
  await page.click('#hourZone .fg-etape[data-cle="arrivee"] .fg-etape__tete');
  const chargee = await attendre(page, () => document.querySelectorAll('.fg-track[data-activity="arrivee"] .fg-chip').length > 0, 20000);
  await page.waitForTimeout(350);
  return chargee;
}
// La fenetre « Envie d un peu plus ? » s ouvre seule au recapitulatif quand
// le serveur a joint des offres : un client la ferme.
async function passerLaVitrine(page) {
  await attendre(page, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  const ouverte = await page.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); });
  if (ouverte) {
    await page.click('#vitrine .fg-vitrine__non');
    await attendre(page, () => document.querySelector('#vitrine').hidden, 3000);
  }
}
const arcadesDabord = (x, y) => Number(y.activityId === 'arcade_time') - Number(x.activityId === 'arcade_time');

// ---------------------------------------------------------------------------
// [A] SANS HEURE D ARRIVEE CHOISIE, RIEN NE CHANGE
// ---------------------------------------------------------------------------
async function parcoursSansArrivee(browser, mock, reglageMeta, ancien) {
  reglage = reglageMeta;
  servirAncien = ancien || '';
  semer(mock, []);
  const { ctx, page, suivi } = await ouvrir(browser);
  const r = { suivi, poses: [] };
  try {
    r.arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    r.programme = await lireProgramme(page);
    for (const [id, heure] of [['bowling', '14:00'], ['laser_game', '16:00']]) {
      r.poses.push(await toucher(page, id, heure));
      await calme(page);
    }
    await page.click('#goContact');
    r.contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 12000);
  } finally {
    await ctx.close();
    reglage = REGLAGE;
    servirAncien = '';
  }
  return r;
}
async function scenarioA(browser, mock) {
  section('A. SANS HEURE D ARRIVEE CHOISIE, RIEN NE CHANGE');
  const sans = await parcoursSansArrivee(browser, mock, null);
  const avec = await parcoursSansArrivee(browser, mock, REGLAGE);
  const coupe = await parcoursSansArrivee(browser, mock, { ...REGLAGE, arrivalFirst: false });
  const passages = [sans, avec, coupe];
  ok(passages.every((r) => r.arrive && r.poses.length === 2 && r.poses.every(Boolean) && r.contact && r.suivi.erreurs.length === 0),
    'MONTAGE trois passages (meta sans reglage, arrivee proposee, arrivee coupee) : Formule 1, 10 personnes, bowling 14:00 puis laser 16:00, puis les coordonnees, sans erreur',
    passages.map((r) => `${r.arrive}/${r.poses.join(',')}/${r.contact}/${r.suivi.erreurs.slice(0, 2).join(' | ')}`).join(' ; '));
  const borne = (r) => r.programme.lignes.some(estBorneArrivee) && !ligneDe(r.programme, 'arrivee');
  ok(borne(sans), 'sans reglage dans la meta (un serveur d avant), la ligne d arrivee reste la borne d avant', resumeLignes(sans.programme));
  ok(borne(coupe), 'arrivalFirst false dans la meta : la borne, aucune heure d arrivee a choisir', resumeLignes(coupe.programme));
  const ligne = ligneDe(avec.programme, 'arrivee');
  ok(Boolean(ligne && ligne.tete) && ligne.tete.tag === 'BUTTON' && ligne.tete.type === 'button' && ligne.tete.expanded === 'false' && ligne.tete.cible && !avec.programme.lignes.some(estBorneArrivee),
    'arrivee proposee : l arrivee devient une ligne du programme, un bouton qui deplie ses heures, a la place de la borne', resumeLignes(avec.programme));
  const portent = passages.flatMap((r) => r.suivi.demandes).filter((u) => params(u).has('arrival') || params(u).has('arrivals'));
  ok(portent.length === 0, 'aucune demande ne porte arrival ni arrivals tant que le client n ouvre pas l arrivee', portent.slice(0, 2).join(' | '));
  const a = sansDoublons(sans.suivi.demandes);
  const b = sansDoublons(avec.suivi.demandes);
  ok(a.length >= 3 && JSON.stringify(a) === JSON.stringify(b), `les demandes de la formule sont les memes au caractere pres, l option proposee ou non (${a.length} demandes)`, ecartListes(a, b));
  const blocA = sans.suivi.blocages[sans.suivi.blocages.length - 1] || null;
  const blocB = avec.suivi.blocages[avec.suivi.blocages.length - 1] || null;
  ok(Boolean(blocA && blocB) && corpsComparable(blocA) === corpsComparable(blocB), 'le blocage part identique, l option proposee ou non',
    blocA && blocB ? `${corpsComparable(blocA).length} / ${corpsComparable(blocB).length} caracteres` : 'blocage absent');
  ok(Boolean(blocB && blocB.preference) && !('arrivalTime' in blocB.preference), 'le blocage sans arrivee choisie ne porte aucune heure d arrivee', JSON.stringify(blocB && blocB.preference));
  if (!BASE_COMMIT) return;
  let ancien = '';
  try { ancien = execFileSync('git', ['-C', ROOT, 'show', `${BASE_COMMIT}:${JS}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (error) { ancien = ''; }
  if (!ok(Boolean(ancien), `MONTAGE le formulaire de ${BASE_COMMIT} se lit`)) return;
  const avant = await parcoursSansArrivee(browser, mock, REGLAGE, ancien);
  const c = sansDoublons(avant.suivi.demandes);
  ok(avant.arrive && avant.poses.every(Boolean) && JSON.stringify(c) === JSON.stringify(b), `le formulaire de ${BASE_COMMIT} fait les memes demandes, au caractere pres`, ecartListes(c, b));
  const blocC = avant.suivi.blocages[avant.suivi.blocages.length - 1] || null;
  ok(Boolean(blocC && blocB) && corpsComparable(blocC) === corpsComparable(blocB), `et le meme blocage que le formulaire de ${BASE_COMMIT}`);
}

// ---------------------------------------------------------------------------
// [B] LA LISTE DES HEURES D ARRIVEE
// ---------------------------------------------------------------------------
async function scenarioB(browser, mock) {
  section('B. LA LISTE DES HEURES D ARRIVEE (pistes et arene pleines de 10:00 a 12:00)');
  reglage = REGLAGE;
  semer(mock, [['10:00', '12:00']]);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    const avant = await lireProgramme(page);
    const regulier = await reponseAttendue(suivi, (u) => !estListe(u));
    const anchors = (regulier && regulier.anchors) || {};
    const ligne = ligneDe(avant, 'arrivee');
    const demandesAvant = suivi.demandes.slice();
    ok(arrive && Boolean(ligne) && (anchors.activities || []).length === 2, 'MONTAGE Formule 1, 10 personnes : le programme, sa ligne d arrivee, le bowling et le laser', resumeLignes(avant));
    const libres = (anchors.freePass || []).slice().sort(arcadesDabord);
    const libre = libres.length ? String(libres[0].label || '').toLowerCase() : '';
    const detail = ligne ? ligne.detail.toLowerCase() : '';
    ok(Boolean(libre) && /arcade/.test(libre) && detail.includes(libre) && (anchors.activities || []).every((x) => detail.includes(String(x.label || '').toLowerCase())),
      'sous « Arrivée », ce que l arrivee fait faire : les arcades de la formule en attendant le bowling et le laser', ligne && ligne.detail);
    ok(!demandesAvant.some(estListe), 'la liste des arrivees ne part pas tant que la ligne n est pas ouverte');
    const chargee = await ouvrirArrivees(page);
    const liste = await reponseAttendue(suivi, estListe);
    const entrees = (liste && liste.arrivals) || [];
    const ouverture = suivi.demandes.slice(demandesAvant.length);
    const listes = ouverture.filter(estListe);
    ok(chargee && entrees.length >= 10, `MONTAGE la ligne ouverte, ses heures d arrivee s affichent (${entrees.length})`);
    ok(listes.length === 1 && ouverture.every((u) => estListe(u) || demandesAvant.includes(u)), 'ouvrir la ligne demande la liste, une fois, et rien d autre', ouverture.join(' | '));
    const q = listes[0] ? params(listes[0]) : new URLSearchParams();
    ok(listes.length === 1 && !q.has('preferredTimes') && !q.has('laserGameTimes') && !q.has('arrival') && q.get('type') === 'formule' && q.get('formuleId') === 'f1' && q.get('pax') === String(PAX) && q.get('date') === mock.DATE,
      'la liste se demande pour la formule, le jour et le groupe, sans heure posee', listes[0] || '');
    const puces = await lirePuces(page, 'arrivee');
    const puceDe = (t) => puces.find((c) => c.time === t) || {};
    const ecarts = [];
    entrees.forEach((x) => {
      const p = puces.find((c) => c.time === x.time);
      if (!p) { ecarts.push(`${x.time} sans puce`); return; }
      if (x.ok === false) {
        if (p.ok !== 'false' || p.etat !== 'hard' || !p.mot) ecarts.push(`${x.time} refusee (${x.code}) : ${p.ok}/${p.etat}/« ${p.mot} »`);
        if (p.titre !== norm(x.reason)) ecarts.push(`${x.time} titre « ${p.titre} » au lieu de « ${x.reason} »`);
      } else if (x.warning) {
        const mot = ({ arrival_wait: 'attente', arrival_visit: 'longue' })[x.warning.code] || 'serré';
        if (p.etat !== 'soft' || p.ok !== 'true' || p.mot !== mot) ecarts.push(`${x.time} avec avis (${x.warning.code}) : ${p.ok}/${p.etat}/« ${p.mot} »`);
      } else if (p.ok !== 'true' || p.mot !== '') ecarts.push(`${x.time} libre : ${p.ok}/« ${p.mot} »`);
    });
    ok(puces.length === entrees.length && ecarts.length === 0, 'chaque heure d arrivee a sa puce et son verdict : libre sans mot, avec un avis son mot (« attente ») et prenable, refusee avec son mot court', ecarts.slice(0, 4).join(' | '));
    await problemesEnCouleur(page, '[B] la liste des arrivees');
    // UNE LONGUE ATTENTE SE DIT ET SE PREND (Movsar, 2026-10-13 : « si y a un
    // petit probleme tu le notifies mais on peut quand meme cliquer »).
    const attentes = entrees.filter((x) => x.ok && x.warning && x.warning.code === 'arrival_wait');
    ok(attentes.length >= 2 && !entrees.some((x) => x.ok === false && x.code === 'arrival_wait'), `MONTAGE des arrivees qui attendent sans activite, aucune refusee pour ca (${attentes.map((x) => x.time).join(', ')})`);
    ok(attentes.length > 0 && attentes.every((x) => puceDe(x.time).mot === 'attente' && puceDe(x.time).ok === 'true'), 'une arrivee qui attend se dit « attente » sur sa puce, et se prend', attentes.map((x) => `${x.time}:${puceDe(x.time).mot}/${puceDe(x.time).ok}`).join(' '));
    const pourquoi = await lirePourquoi(page, 'arrivee');
    const lAttente = pourquoi.find((l) => attentes.length > 0 && attentes.every((x) => l.heures.includes(x.time))) || null;
    const minutes = attentes.map((x) => Number(x.warning.waitMinutes) || 0);
    const bas = libelleDuree(Math.min(...minutes));
    const haut = libelleDuree(Math.max(...minutes));
    const cause = attentes.length ? minuscule(norm(attentes[0].warning.cause)) : '';
    ok(Boolean(lAttente) && lAttente.cle === 'attente' && lAttente.etat === 'soft' && lAttente.texte.includes(bas) && lAttente.texte.includes(haut) && /sans activit/.test(lAttente.texte) && Boolean(cause) && lAttente.texte.includes(cause),
      `sous la plage, une ligne pour ces heures : l attente sans activite, en fourchette (${bas} a ${haut}), et sa cause (${cause})`, JSON.stringify(lAttente || pourquoi));
    ok(Boolean(lAttente) && attentes.every((x) => puceDe(x.time).decrite === lAttente.id), 'chaque heure qui attend pointe sa ligne (aria-describedby)');
    const cles = lisible(await page.evaluate((t) => {
      const puce = document.querySelector(`.fg-track[data-activity="arrivee"] .fg-chip[data-time="${t}"]`);
      const sec = puce && puce.closest('.fg-period');
      return sec ? [...sec.querySelectorAll('.fg-period__keys .fg-key')].map((k) => k.textContent) : [];
    }, attentes.length ? attentes[0].time : ''));
    ok(cles.includes('attente'), 'l en-tete de la plage le dit aussi, comme pour les heures des activites', cles.join(','));
    // La premiere arrivee, choisie : elle attend, elle se prend quand meme.
    const premiere = entrees.find((x) => x.ok) || null;
    if (!ok(Boolean(premiere) && attentes.length > 0 && premiere.time === attentes[0].time, 'MONTAGE la premiere arrivee du jour est l une de celles qui attendent', premiere && premiere.time)) return;
    await page.click(`.fg-track[data-activity="arrivee"] .fg-chip[data-time="${premiere.time}"]`);
    await calme(page);
    const rep = await reponseAttendue(suivi, (u) => params(u).get('arrival') === premiere.time);
    const url = suivi.demandes.filter((u) => params(u).get('arrival') === premiere.time).pop() || '';
    const slot = (rep && rep.slots && rep.slots[0]) || null;
    const plan = (slot && slot.opsPlan) || {};
    const heures = (plan.anchorPlan && plan.anchorPlan.times) || {};
    ok(Boolean(slot) && plan.arrivalPlan && plan.arrivalPlan.arrivalTime === premiere.time, `MONTAGE l arrivee de ${premiere.time} se compose (bowling ${heures.bowling}, laser ${heures.laser_game})`, rep && rep.message);
    ok(Boolean(slot) && rep.arrival && rep.arrival.ok === true && rep.arrival.warning && rep.arrival.warning.code === 'arrival_wait',
      `l arrivee de ${premiere.time}, qui attend, se reserve : le plan se compose, avec son avis`, JSON.stringify(rep && rep.arrival && rep.arrival.warning));
    ok(Boolean(url) && JSON.stringify([...params(url).keys()]) === JSON.stringify(['centerId', 'date', 'pax', 'type', 'formuleId', 'arrival']),
      'l heure choisie part seule, en dernier, sans heure d activite posee', url);
    const apres = await lireProgramme(page);
    const lA = ligneDe(apres, 'arrivee');
    const lB = ligneDe(apres, 'bowling');
    const lL = ligneDe(apres, 'laser_game');
    ok(Boolean(lA) && lA.heure === premiere.time && /is-choisi/.test(lA.classe), `la ligne d arrivee dit ${premiere.time}, choisie`, resumeLignes(apres));
    ok(Boolean(lB && lL) && lB.heure === heures.bowling && lL.heure === heures.laser_game && /is-propose/.test(lB.classe) && /is-propose/.test(lL.classe),
      `le bowling et le laser prennent les heures que le serveur a posees a partir d elle (${heures.bowling}, ${heures.laser_game})`, resumeLignes(apres));
    const frise = (plan.arrivalPlan && plan.arrivalPlan.frise) || [];
    const attente = Number(plan.arrivalPlan && plan.arrivalPlan.waitMinutes) || 0;
    const attendus = frise.filter((s) => s.kind === 'free' && s.placement === 'before' && !/boisson/i.test(s.label))
      .map((s) => `${s.label}${s.timed ? ` jusqu’à ${heureAffichee(s.endTime)}` : ' en attendant'}`)
      .concat(attente > 0 ? [`${libelleDuree(attente)} d’attente`] : []);
    ok(Boolean(lA) && attendus.length > 0 && attendus.every((m) => lA.detail.includes(m)), 'sous « Arrivée », ce qui se fait avant la premiere activite, lu dans la frise du serveur', `« ${lA && lA.detail} » / ${attendus.join(' · ')}`);
    // LES HEURES DU BOWLING RESTENT A CHOISIR (Movsar, 2026-10-13 : « quand ils
    // choisissent l heure d arrivee on peut pas choisir les heures qu on veut
    // pour les autres activites »). La ligne ouverte montre ses heures, celles
    // que le serveur a jugees avec l arrivee.
    await page.click('#hourZone .fg-etape[data-cle="bowling"] .fg-etape__tete');
    await page.waitForTimeout(400);
    const ouverte = ligneDe(await lireProgramme(page), 'bowling');
    ok(Boolean(ouverte) && ouverte.ouverte && ouverte.piste === true && ouverte.sansArrivee === null,
      'l arrivee choisie, la ligne du bowling ouverte montre ses heures (plus de « Choisir l’heure moi-même »)', JSON.stringify(ouverte));
    const grille = (((rep && rep.anchors && rep.anchors.activities) || []).find((a) => a.activityId === 'bowling') || { times: [] }).times;
    const pucesB = await lirePuces(page, 'bowling');
    const ecartsB = grille.filter((x) => {
      const p = pucesB.find((c) => c.time === x.time);
      return !p || (x.ok === false) !== (p.ok === 'false' || p.etat === 'shift');
    }).map((x) => `${x.time} ${x.ok === false ? x.code : 'ok'}`);
    ok(grille.length > 0 && ecartsB.length === 0, `chaque heure du bowling (${grille.length}) suit la grille que le serveur a jugee avec l arrivee`, ecartsB.slice(0, 4).join(' | '));
  } finally {
    ok(suivi.erreurs.length === 0, '[B] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [C] ARRIVER A 10:00 QUAND TOUT EST PRIS JUSQU A 10:30, JUSQU A LA RESERVATION
// ---------------------------------------------------------------------------
async function scenarioC(browser, mock) {
  section('C. ARRIVER A 10:00 QUAND TOUT EST PRIS JUSQU A 11:00');
  reglage = REGLAGE;
  semer(mock, [['10:00', '11:00']]);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    await ouvrirArrivees(page);
    const liste = await reponseAttendue(suivi, estListe);
    const dix = ((liste && liste.arrivals) || []).find((x) => x.time === '10:00') || {};
    if (!ok(arrive && dix.ok === true, 'MONTAGE Formule 1, 10 personnes, pistes et arene pleines de 10:00 a 11:00 : arriver a 10:00 tient', JSON.stringify(dix).slice(0, 160))) return;
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]');
    await calme(page);
    const rep = await reponseAttendue(suivi, (u) => params(u).get('arrival') === '10:00');
    const slot = (rep && rep.slots && rep.slots[0]) || null;
    const plan = (slot && slot.opsPlan) || {};
    const accueil = String(plan.arrivalTime || '');
    const frise = (plan.arrivalPlan && plan.arrivalPlan.frise) || [];
    const heures = (plan.anchorPlan && plan.anchorPlan.times) || {};
    const arcades = frise.find((s) => s.kind === 'free' && s.timed && s.placement === 'before') || null;
    const fin = heureAffichee((slot && slot.visitEndTime) || '');
    // L accueil commence a l heure choisie (2026-10-13) : la veille de dix
    // minutes (09:50) ne se dit nulle part. Les arcades viennent apres lui
    // (10:10), jamais a l heure d arrivee (Movsar, meme jour).
    const veille = heureDe(minutesDe('10:00') - 10);
    if (!ok(Boolean(slot) && plan.arrivalPlan && plan.arrivalPlan.arrivalTime === '10:00' && Boolean(arcades) && arcades.startTime === '10:10' && heures.bowling === '11:00' && minutesDe(arcades.endTime) <= minutesDe(heures.bowling) && Boolean(fin),
      `MONTAGE le serveur compose la visite : arcades 10:10 apres l accueil, bowling ${heures.bowling}, laser ${heures.laser_game}, fin ${fin}`, `${rep && rep.message} ${JSON.stringify(arcades)}`)) return;
    ok(accueil === '10:00', `l accueil commence a l heure choisie (10:00), jamais dix minutes avant (${veille})`, accueil);
    const prog = await lireProgramme(page);
    const lA = ligneDe(prog, 'arrivee');
    const lB = ligneDe(prog, 'bowling');
    const lL = ligneDe(prog, 'laser_game');
    const lFin = prog.lignes.find((l) => /fg-etape--fin/.test(l.classe)) || null;
    ok(Boolean(lA && lB && lL) && lA.heure === '10:00' && lB.heure === heures.bowling && lL.heure === heures.laser_game,
      'le programme : l arrivee a 10:00, puis le bowling et le laser aux heures du serveur', resumeLignes(prog));
    ok(Boolean(lFin) && lFin.heure === fin, `la fin du programme est celle du serveur (${fin})`, lFin && lFin.heure);
    const v = await lireVisite(page);
    const rang = (f) => v.etapes.findIndex(f);
    const iArr = rang((e) => e.b === '10:00' && e.titre === 'Arrivée');
    const iArc = rang((e) => e.b === '10:10' && e.titre.includes(arcades.label) && e.detail.includes(`jusqu’à ${heureAffichee(arcades.endTime)}`));
    const iBow = rang((e) => e.b === heures.bowling && /bowling/i.test(e.titre));
    const iLas = rang((e) => e.b === heures.laser_game && /laser/i.test(e.titre));
    const derniere = v.etapes[v.etapes.length - 1] || {};
    ok(iArr === 0 && iArr < iArc && iArc < iBow && iBow < iLas, 'la visite se lit dans l ordre : arrivee 10:00, arcades 10:10, bowling, laser', v.etapes.map((e) => `${e.b} ${e.titre}`).join(' | '));
    ok(derniere.titre === 'Fin de la visite' && derniere.b === fin, `la visite finit a l heure du serveur (${fin}), jamais recalculee`, `${derniere.b} ${derniere.titre}`);
    ok(v.tete.startsWith('de 10:00 ') && v.somme.includes(`10:00 → ${fin}`), 'l en-tete de la visite et la barre du bas partent de 10:00', `« ${v.tete} » / « ${v.somme} »`);
    ok(!v.zone.includes(veille) && !v.somme.includes(veille), `aucune heure dix minutes avant l arrivee (${veille}) ne se dit a l ecran des heures : l accueil commence a 10:00`);
    const nBlocages = suivi.blocages.length;
    await page.click('#goContact');
    const contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 12000);
    const bloc = suivi.blocages.length > nBlocages ? suivi.blocages[suivi.blocages.length - 1] : null;
    ok(contact && Boolean(bloc && bloc.preference) && bloc.preference.arrivalTime === '10:00' && JSON.stringify(bloc.preference.preferredTimes) === JSON.stringify(heures),
      'le blocage part avec l heure d arrivee (10:00) et les heures que le serveur a posees', JSON.stringify(bloc && bloc.preference));
    const rappel = norm(await page.evaluate(() => (document.querySelector('#recallLine') || {}).textContent || ''));
    ok(rappel.includes('arrivée 10:00') && !rappel.includes(veille), 'le rappel des horaires dit « arrivée 10:00 »', `« ${rappel} »`);
    await page.fill('#cPrenom', 'Qa');
    await page.fill('#cNom', 'Arrivee');
    await page.fill('#cEmail', 'qa@invalid.test');
    await page.fill('#cTel', '0471234567');
    await page.click('#occasions [data-occasion="famille"]');
    await page.check('#cConsent');
    await page.click('#goRecap');
    const recap = await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 8000);
    await passerLaVitrine(page);
    const lignes = lisible(await page.evaluate(() => [...document.querySelectorAll('.fg-scene[data-scene="recap"] .fg-recap__row')].map((r) => r.textContent)));
    ok(recap && lignes.some((l) => l.includes('Arrivée à 10:00')) && !lignes.some((l) => /conseill/.test(l) || l.includes(veille)), 'le recapitulatif dit « Arrivée à 10:00 », pas l accueil conseille', lignes.join(' | '));
    mock.dernierePose.body = null;
    await page.click('#confirmBtn');
    const finie = await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 15000);
    const corps = mock.dernierePose.body || {};
    const pref = corps.preference || {};
    ok(finie && pref.arrivalTime === '10:00' && corps.startTime === '10:00' && JSON.stringify(pref.preferredTimes) === JSON.stringify(heures)
      && JSON.stringify(pref.laserGameTimes) === JSON.stringify((plan.anchorPlan && plan.anchorPlan.laserGameTimes) || []),
    'la reservation part avec preference.arrivalTime 10:00, ses heures et ses parties de laser', JSON.stringify({ startTime: corps.startTime, preference: pref }));
    const ecran = norm(await page.evaluate(() => (document.querySelector('#finBody') || {}).textContent || ''));
    ok(ecran.includes('Arrivée à 10:00') && !/conseill/.test(ecran) && !ecran.includes(veille), 'l ecran final dit « Arrivée à 10:00 »', ecran.slice(0, 220));
  } finally {
    ok(suivi.erreurs.length === 0, '[C] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [D] UNE FORMULE SANS ARCADES, UNE ARRIVEE SERREE
// ---------------------------------------------------------------------------
async function scenarioD(browser, mock) {
  section('D. LA FORMULE 4 : SON MINIGOLF, JAMAIS D ARCADES ; UNE ARRIVEE SERREE');
  reglage = REGLAGE;
  semer(mock, [['10:00', '10:30']]);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f4');
    await calme(page);
    const regulier = await reponseAttendue(suivi, (u) => !estListe(u));
    const libres = ((regulier && regulier.anchors && regulier.anchors.freePass) || []).slice().sort(arcadesDabord);
    const lA = ligneDe(await lireProgramme(page), 'arrivee');
    ok(arrive && Boolean(lA) && libres.length > 0 && !libres.some((x) => /arcade/i.test(`${x.activityId} ${x.label}`)), 'MONTAGE la Formule 4 : du minigolf, aucune arcade (son libre, lu au serveur)', JSON.stringify(libres));
    ok(Boolean(lA) && libres.length > 0 && lA.detail.toLowerCase().includes(String(libres[0].label).toLowerCase()) && !/arcade/i.test(lA.detail),
      'sous « Arrivée », la Formule 4 annonce son minigolf, jamais des arcades qu elle n a pas', lA && lA.detail);
    await ouvrirArrivees(page);
    const liste = await reponseAttendue(suivi, estListe);
    const entrees = (liste && liste.arrivals) || [];
    const puces = await lirePuces(page, 'arrivee');
    const pourquoi = await lirePourquoi(page, 'arrivee');
    // L avis de la fermeture, pas celui d une attente (« attente », en [B]).
    const serree = entrees.find((x) => x.ok && x.warning && x.warning.reason && !['arrival_wait', 'arrival_visit'].includes(x.warning.code)) || null;
    if (ok(Boolean(serree), 'MONTAGE une arrivee du soir tient, mais sa visite deborde la fermeture : le serveur la donne avec son avertissement', entrees.filter((x) => x.ok).slice(-2).map((x) => x.time).join(', '))) {
      const p = puces.find((c) => c.time === serree.time) || {};
      ok(p.etat === 'soft' && p.mot === 'serré' && p.ok === 'true' && p.titre === norm(serree.warning.reason), `${serree.time} se dit « serré », reste possible, la raison du moteur en titre`, JSON.stringify(p));
      const l = pourquoi.find((x) => x.heures.includes(serree.time)) || null;
      ok(Boolean(l) && l.etat === 'soft' && l.cle === 'serré' && norm(l.texte).includes(minuscule(norm(serree.warning.reason))), 'sous sa plage, la ligne dit ce qui ne tiendra pas', JSON.stringify(l));
    }
    const dix = entrees.find((x) => x.time === '10:00') || {};
    if (!ok(dix.ok === true, 'MONTAGE arriver a 10:00 tient', JSON.stringify(dix).slice(0, 160))) return;
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]');
    await calme(page);
    const rep = await reponseAttendue(suivi, (u) => params(u).get('arrival') === '10:00');
    const slot = (rep && rep.slots && rep.slots[0]) || null;
    const plan = (slot && slot.opsPlan) || {};
    const heures = (plan.anchorPlan && plan.anchorPlan.times) || {};
    const avant = ((plan.arrivalPlan && plan.arrivalPlan.frise) || []).find((s) => s.kind === 'free' && s.placement === 'before' && !/boisson/i.test(s.label)) || null;
    const defauts = (regulier && regulier.anchors && regulier.anchors.defaultTimes) || {};
    if (!ok(Boolean(slot && avant) && !avant.timed && /golf/i.test(avant.activityId) && heures.bowling && heures.bowling !== defauts.bowling,
      `MONTAGE arriver a 10:00 : le minigolf d abord, sans heure ; le bowling a ${heures.bowling} (${defauts.bowling} sans arrivee)`, JSON.stringify(avant))) return;
    const prog = await lireProgramme(page);
    const lA2 = ligneDe(prog, 'arrivee');
    const lB = ligneDe(prog, 'bowling');
    const lL = ligneDe(prog, 'laser_game#1');
    ok(Boolean(lA2) && lA2.detail.includes(`${avant.label} en attendant`) && !/arcade/i.test(lA2.detail), 'sous « Arrivée » : le minigolf en attendant', lA2 && lA2.detail);
    ok(Boolean(lB && lL) && lB.heure === heures.bowling && lL.heure === heures.laser_game, `le bowling et la 1re partie de laser prennent les heures du serveur (${heures.bowling}, ${heures.laser_game})`, resumeLignes(prog));
    const v = await lireVisite(page);
    const i = v.etapes.findIndex((e) => e.b === '10:00' && e.titre === 'Arrivée');
    const suivante = i >= 0 ? v.etapes[i + 1] : null;
    ok(Boolean(suivante) && suivante.titre.includes(avant.label) && suivante.b === '' && suivante.detail.startsWith('en attendant votre '), 'la visite commence par le minigolf, sans heure, en attendant le bowling', JSON.stringify(suivante));
    ok(!v.etapes.some((e) => /arcade/i.test(`${e.titre} ${e.detail}`)), 'aucune ligne de la visite ne parle d arcades', v.etapes.map((e) => e.titre).join(' | '));
    // Une reponse d arrivee sans grille (son calcul a echoue au serveur) : les
    // lignes viennent de la grille sans arrivee, leurs heures restent celles du
    // plan de l arrivee, jamais celles de la journee sans elle.
    await page.route((url) => url.pathname === '/api/public-availability' && url.searchParams.has('arrival'), async (route) => {
      const reponse = await route.fetch();
      const j = await reponse.json();
      delete j.anchors;
      await route.fulfill({ response: reponse, json: j });
    });
    const dixTrente = entrees.find((x) => x.time === '10:30') || {};
    if (!(ligneDe(await lireProgramme(page), 'arrivee') || {}).ouverte) await ouvrirArrivees(page);
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:30"]');
    await calme(page);
    const sansGrille = await reponseAttendue(suivi, (u) => params(u).get('arrival') === '10:30');
    const heures2 = (((((sansGrille && sansGrille.slots && sansGrille.slots[0]) || {}).opsPlan || {}).anchorPlan || {}).times) || {};
    if (ok(dixTrente.ok === true && Boolean(sansGrille) && !sansGrille.anchors && Boolean(heures2.bowling) && heures2.bowling !== defauts.bowling,
      `MONTAGE arriver a 10:30, reponse sans grille : le plan pose le bowling a ${heures2.bowling} (${defauts.bowling} sans arrivee)`, JSON.stringify(heures2))) {
      const lB3 = ligneDe(await lireProgramme(page), 'bowling');
      ok(Boolean(lB3) && lB3.heure === heures2.bowling, `reponse sans grille : la ligne du bowling garde l heure du plan de l arrivee (${heures2.bowling})`, JSON.stringify(lB3));
    }
  } finally {
    ok(suivi.erreurs.length === 0, '[D] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [E] LE CENTRE COUPE L ARRIVEE
// ---------------------------------------------------------------------------
async function scenarioE(browser, mock) {
  section('E. LE CENTRE COUPE L ARRIVEE (arrivalBounds.arrivalFirst false)');
  reglage = REGLAGE;
  semer(mock, []);
  {
    const { ctx, page, suivi } = await ouvrir(browser);
    try {
      await page.route((url) => url.pathname === '/api/public-availability' && url.searchParams.get('arrivals') === '1', async (route) => {
        const reponse = await route.fetch();
        const j = await reponse.json();
        j.arrivals = [];
        j.firstAcceptableArrival = null;
        j.arrivalBounds = { ...(j.arrivalBounds || {}), arrivalFirst: false };
        j.message = COUPEE;
        await route.fulfill({ response: reponse, json: j });
      });
      const arrive = await versHeures(page, mock, 'f1');
      await calme(page);
      const avant = await lireProgramme(page);
      ok(arrive && Boolean(ligneDe(avant, 'arrivee')), 'MONTAGE la meta propose l arrivee : la ligne est la', resumeLignes(avant));
      await page.click('#hourZone .fg-etape[data-cle="arrivee"] .fg-etape__tete');
      const partie = await attendre(page, () => !document.querySelector('#hourZone .fg-etape[data-cle="arrivee"]'), 12000);
      await calme(page);
      const apres = await lireProgramme(page);
      ok(partie && apres.lignes.some(estBorneArrivee), 'la liste dit que le centre ne la propose plus : la ligne redevient la borne d avant', resumeLignes(apres));
      ok(!suivi.demandes.some((u) => params(u).has('arrival')), 'aucune heure d arrivee ne part');
    } finally {
      ok(suivi.erreurs.length === 0, '[E] aucune erreur JavaScript (liste)', suivi.erreurs.slice(0, 3).join(' | '));
      await ctx.close();
    }
  }
  {
    const { ctx, page, suivi } = await ouvrir(browser);
    let coupe = false;
    try {
      await page.route((url) => url.pathname === '/api/public-availability' && url.searchParams.has('arrival'), async (route) => {
        const reponse = await route.fetch();
        const j = await reponse.json();
        if (!coupe) {
          coupe = true;
          const t = new URL(route.request().url()).searchParams.get('arrival');
          j.slots = [];
          j.arrivalBounds = { ...(j.arrivalBounds || {}), arrivalFirst: false };
          j.arrival = { time: t, ok: false, code: 'arrival_disabled', reason: COUPEE, shortReason: 'Non proposé par le centre' };
          j.message = COUPEE;
        }
        await route.fulfill({ response: reponse, json: j });
      });
      const arrive = await versHeures(page, mock, 'f1');
      await calme(page);
      await ouvrirArrivees(page);
      await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]');
      await attendre(page, () => !document.querySelector('#hourZone .fg-etape[data-cle="arrivee"]'), 12000);
      await calme(page);
      const apres = await lireProgramme(page);
      const v = await lireVisite(page);
      const derniere = suivi.demandes.filter((u) => !estListe(u)).pop() || '';
      ok(arrive && coupe, 'MONTAGE une arrivee choisie, son plan dit que le centre ne la propose plus');
      ok(Boolean(derniere) && !params(derniere).has('arrival') && apres.lignes.some(estBorneArrivee) && !v.avis && v.etapes.length > 0,
        'l arrivee choisie tombe : la demande suivante n en porte plus, la borne revient, le plan sans arrivee s affiche', `${derniere} | ${resumeLignes(apres)} | ${v.avis}`);
    } finally {
      ok(suivi.erreurs.length === 0, '[E] aucune erreur JavaScript (plan)', suivi.erreurs.slice(0, 3).join(' | '));
      await ctx.close();
    }
  }
}

// ---------------------------------------------------------------------------
// [F] UNE ARRIVEE PRISE ENTRE LA LISTE ET LE CHOIX
// ---------------------------------------------------------------------------
async function scenarioF(browser, mock) {
  section('F. UNE ARRIVEE DEVENUE IMPOSSIBLE ENTRE LA LISTE ET LE CHOIX');
  reglage = REGLAGE;
  semer(mock, []);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    await ouvrirArrivees(page);
    const avant = await lirePuces(page, 'arrivee');
    const listes = suivi.demandes.filter(estListe).length;
    if (!ok(arrive && (avant.find((c) => c.time === '10:00') || {}).ok === 'true', 'MONTAGE la liste dit qu arriver a 10:00 tient')) return;
    // Le centre bloque le bowling au planning de 10:00 a 10:30 pendant que le
    // client hesite : la garde finale de la creation refuse une arrivee a
    // 10:00, 10:30 tient. Une longue attente, elle, ne refuse plus rien
    // (2026-10-13) : c est un vrai impossible qu il faut ici.
    mock.blocsDev.push(...blocageBowling(mock.DATE, '10:00', '10:30'));
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]');
    await calme(page);
    await attendre(page, () => document.querySelector('#planZone .fg-notice'), 8000);
    const rep = await reponseAttendue(suivi, (u) => params(u).get('arrival') === '10:00');
    const suivante = rep && rep.arrival ? rep.arrival.nextAcceptableTime || rep.arrival.firstAcceptableTime || '' : '';
    if (!ok(Boolean(rep) && Array.isArray(rep.slots) && rep.slots.length === 0 && Boolean(suivante), `MONTAGE le serveur refuse 10:00 et donne l arrivee suivante (${suivante})`, rep && rep.message)) return;
    const v = await lireVisite(page);
    ok(v.avis === norm(rep.message), 'le refus du serveur se lit tel quel : pourquoi, et la premiere arrivee possible', `« ${v.avis} »`);
    ok(v.vers.length === 1 && v.vers[0].heure === suivante && v.vers[0].texte === `Arriver à ${suivante}`, `un toucher propose l arrivee suivante qui tient (${suivante})`, JSON.stringify(v.vers));
    const relue = await attendre(page, () => { const c = document.querySelector('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]'); return Boolean(c && c.dataset.ok === 'false'); }, 12000);
    ok(relue && suivi.demandes.filter(estListe).length === listes + 1, 'la liste ouverte se relit : 10:00 s y dit refusee, comme le plan', `${suivi.demandes.filter(estListe).length - listes} relecture(s)`);
    const listeRelue = await reponseAttendue(suivi, estListe);
    const dixRelue = ((listeRelue && listeRelue.arrivals) || []).find((x) => x.time === '10:00') || {};
    const puceRelue = (await lirePuces(page, 'arrivee')).find((c) => c.time === '10:00') || {};
    // Elle reste « choisi » (le refus se lit dans la visite, avec l arrivee
    // suivante) ; son titre dit pourquoi.
    ok(dixRelue.ok === false && puceRelue.etat === 'hard' && puceRelue.ok === 'false' && Boolean(dixRelue.reason) && puceRelue.titre === norm(dixRelue.reason),
      'la puce refusee porte la phrase longue du serveur en titre', `${JSON.stringify(puceRelue)} / ${dixRelue.reason}`);
    await page.click('#planZone [data-arrivee-vers]');
    await calme(page);
    const lA = ligneDe(await lireProgramme(page), 'arrivee');
    const v2 = await lireVisite(page);
    ok(Boolean(lA) && lA.heure === suivante && /is-choisi/.test(lA.classe) && !v2.avis && (v2.etapes[0] || {}).b === suivante,
      `l arrivee suivante se choisit d un toucher : ${suivante}, et la visite repart de la`, `${lA && lA.heure} | ${v2.avis} | ${(v2.etapes[0] || {}).b}`);
  } finally {
    ok(suivi.erreurs.length === 0, '[F] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [G] AU TELEPHONE
// ---------------------------------------------------------------------------
async function scenarioG(browser, mock) {
  section('G. AU TELEPHONE (360 PX)');
  reglage = REGLAGE;
  semer(mock, [['10:00', '12:00']]);
  const { ctx, page, suivi } = await ouvrir(browser, { largeur: 360, hauteur: 780 });
  const posee = () => attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running'), 4000);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    const chargee = await ouvrirArrivees(page);
    await posee();
    const m = await page.evaluate(() => {
      const visibles = [...document.querySelectorAll('.fg-track[data-activity="arrivee"] .fg-chip')].filter((c) => c.getClientRects().length && c.getBoundingClientRect().height > 0);
      const tete = document.querySelector('#hourZone .fg-etape[data-cle="arrivee"] .fg-etape__tete');
      return {
        n: visibles.length,
        hauteur: Math.min(...visibles.map((c) => c.getBoundingClientRect().height)),
        largeurPuce: Math.min(...visibles.map((c) => c.getBoundingClientRect().width)),
        tete: tete ? tete.getBoundingClientRect().height : 0,
        page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        ecran: window.innerWidth,
      };
    });
    ok(arrive && chargee && m.n > 0, `MONTAGE les heures d arrivee s affichent a 360 px (${m.n} visibles)`);
    ok(m.page <= m.ecran, `rien ne deborde a 360 px (${m.page} px de large pour ${m.ecran})`);
    ok(m.hauteur >= 44 && m.largeurPuce >= 44 && m.tete >= 44, `les heures d arrivee et leur ligne se touchent du doigt (44 px au moins : puce ${Math.round(m.hauteur)} x ${Math.round(m.largeurPuce)}, ligne ${Math.round(m.tete)})`);
    const forme = await page.evaluate(() => {
      const decrire = (c) => {
        if (!c) return '';
        const lb = c.closest('[role="listbox"]');
        return [c.tagName, c.getAttribute('type'), c.getAttribute('role'), c.hasAttribute('aria-selected'), Boolean(lb && lb.getAttribute('aria-label'))].join('|');
      };
      return { arrivee: decrire(document.querySelector('.fg-track[data-activity="arrivee"] .fg-chip')), bowling: decrire(document.querySelector('.fg-track[data-activity="bowling"] .fg-chip')) };
    });
    ok(Boolean(forme.arrivee) && forme.arrivee === forme.bowling && forme.arrivee.startsWith('BUTTON|button|option|true|true'), 'une heure d arrivee est le meme bouton qu une heure de bowling (type, role, aria-selected, liste nommee)', JSON.stringify(forme));
    await page.focus('#hourZone .fg-etape[data-cle="arrivee"] .fg-etape__tete');
    let focus = null;
    for (let k = 0; k < 20 && !(focus && focus.puce); k += 1) {
      await page.keyboard.press('Tab');
      focus = await page.evaluate(() => {
        const f = document.activeElement;
        const s = f ? getComputedStyle(f) : null;
        return { puce: Boolean(f && f.matches('.fg-track[data-activity="arrivee"] .fg-chip')), style: s ? s.outlineStyle : '', largeur: s ? parseFloat(s.outlineWidth) || 0 : 0 };
      });
    }
    ok(Boolean(focus && focus.puce) && focus.style !== 'none' && focus.largeur >= 2, 'au clavier, l heure d arrivee qui a le focus se voit (contour)', JSON.stringify(focus));
    const liste = await reponseAttendue(suivi, estListe);
    const libre = (((liste && liste.arrivals) || []).find((x) => x.ok) || {}).time;
    if (!ok(Boolean(libre), 'MONTAGE une arrivee tient ce jour-la')) return;
    await page.click(`.fg-track[data-activity="arrivee"] .fg-chip[data-time="${libre}"]`);
    await calme(page);
    await page.click('#hourZone .fg-etape[data-cle="bowling"] .fg-etape__tete');
    await page.waitForTimeout(450);
    await posee();
    const pucesB = await page.evaluate(() => {
      const visibles = [...document.querySelectorAll('#hourZone .fg-etape[data-cle="bowling"] .fg-chip')].filter((c) => c.getClientRects().length && c.getBoundingClientRect().height > 0);
      return {
        n: visibles.length,
        hauteur: visibles.length ? Math.min(...visibles.map((c) => c.getBoundingClientRect().height)) : 0,
        largeur: visibles.length ? Math.min(...visibles.map((c) => c.getBoundingClientRect().width)) : 0,
        page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        ecran: window.innerWidth,
      };
    });
    ok(pucesB.n > 0 && pucesB.hauteur >= 44 && pucesB.largeur >= 44 && pucesB.page <= pucesB.ecran,
      `arrivee choisie, les heures du bowling restent la et se touchent du doigt (${pucesB.n} visibles, ${Math.round(pucesB.hauteur)} x ${Math.round(pucesB.largeur)} px), rien ne deborde`, JSON.stringify(pucesB));
  } finally {
    ok(suivi.erreurs.length === 0, '[G] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [H] L ARRIVEE ET LES HEURES DES ACTIVITES, ENSEMBLE (2026-10-13)
// ---------------------------------------------------------------------------
async function scenarioH(browser, mock) {
  section('H. L ARRIVEE PUIS LE BOWLING, LE BOWLING PUIS L ARRIVEE (journee libre)');
  reglage = REGLAGE;
  semer(mock, []);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    await ouvrirArrivees(page);
    const liste = await reponseAttendue(suivi, estListe);
    const dixTrente = ((liste && liste.arrivals) || []).find((x) => x.time === '10:30') || {};
    if (!ok(arrive && dixTrente.ok === true, 'MONTAGE journee libre, Formule 1, 10 personnes : arriver a 10:30 tient', JSON.stringify(dixTrente).slice(0, 160))) return;
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:30"]');
    await calme(page);
    const rep = await reponseAttendue(suivi, (u) => params(u).get('arrival') === '10:30' && !params(u).has('preferredTimes'));
    const plan = ((rep && rep.slots && rep.slots[0]) || {}).opsPlan || {};
    const heures = (plan.anchorPlan && plan.anchorPlan.times) || {};
    ok(Boolean(heures.bowling) && minutesDe(heures.bowling) >= minutesDe('10:40'), `l accueil d abord : arriver a 10:30 pose le bowling a ${heures.bowling}, jamais pendant les dix minutes d accueil`, JSON.stringify(heures));
    // La ligne du bowling : ses heures, jugees avec l arrivee.
    await page.click('#hourZone .fg-etape[data-cle="bowling"] .fg-etape__tete');
    await page.waitForTimeout(400);
    const lB = ligneDe(await lireProgramme(page), 'bowling');
    ok(Boolean(lB) && lB.ouverte && lB.piste === true, 'arrivee choisie : la ligne du bowling s ouvre sur ses heures', JSON.stringify(lB));
    const puces = await lirePuces(page, 'bowling');
    const p = (h) => puces.find((c) => c.time === h) || {};
    // L heure proposee est celle du plan de l arrivee : celle de la journee
    // sans arrivee (10:00) se disait « proposé » sur une heure refusee.
    ok(Boolean(heures.bowling) && p(heures.bowling).mot === 'proposé' && puces.filter((c) => c.mot === 'proposé').length === 1,
      `le bowling propose est celui du plan de l arrivee (${heures.bowling}), et lui seul`, puces.filter((c) => c.mot === 'proposé').map((c) => c.time).join(', '));
    // AVANT L ARRIVEE ET A SON ACCUEIL, le bowling se prend : il avance
    // l arrivee (« décale »). Loin d elle, il attend (« attente ») et se prend.
    ok(p('10:00').ok === 'true' && p('10:00').etat === 'shift' && p('10:00').mot === 'décale', 'le bowling de 10:00, avant l arrivee de 10:30, se dit « décale » et se prend', JSON.stringify(p('10:00')));
    ok(p('10:30').ok === 'true' && p('10:30').etat === 'shift' && p('10:30').mot === 'décale', 'le bowling de 10:30, a l accueil de l arrivee, se dit « décale » et se prend', JSON.stringify(p('10:30')));
    ok(p('11:30').ok === 'true', 'le bowling de 11:30 se prend avec cette arrivee', JSON.stringify(p('11:30')));
    ok(p('16:00').ok === 'true' && p('16:00').etat === 'soft' && p('16:00').mot === 'attente', 'le bowling de 16:00, loin de l arrivee, se dit « attente » et se prend', JSON.stringify(p('16:00')));
    await problemesEnCouleur(page, '[H] le bowling juge avec l arrivee de 10:30');
    const pourquoi = await lirePourquoi(page, 'bowling');
    const lTot = pourquoi.find((l) => l.heures.includes('10:00')) || null;
    ok(Boolean(lTot) && lTot.heures.includes('10:30') && lTot.cle === 'décale' && /avance votre arrivée \(10:30\)/i.test(lTot.texte) && /10 min avant votre bowling/.test(lTot.texte),
      'sous la plage, une ligne pour 10:00 et 10:30 : elles avancent l arrivee (10:30), arrivee 10 min avant le bowling', JSON.stringify(lTot));
    const lLoin = pourquoi.find((l) => l.heures.includes('16:00')) || null;
    ok(Boolean(lLoin) && lLoin.cle === 'attente' && /sans activit/.test(lLoin.texte) && /après votre arrivée \(10:30\)/.test(lLoin.texte) && !/au moins/.test(lLoin.texte),
      'l attente des heures lointaines se dit en fourchette, depuis l arrivee (10:30)', JSON.stringify(lLoin));
    // Le bowling touche a 11:30 : l arrivee reste.
    const n = suivi.demandes.length;
    ok(await toucher(page, 'bowling', '11:30'), 'MONTAGE le bowling de 11:30 se touche');
    await calme(page);
    const derniere = suivi.demandes.slice(n).filter((u) => !estListe(u)).pop() || '';
    const pt = derniere ? JSON.parse(params(derniere).get('preferredTimes') || '{}') : {};
    ok(Boolean(derniere) && params(derniere).get('arrival') === '10:30' && pt.bowling === '11:30', 'la demande garde l arrivee (10:30) et porte le bowling choisi (11:30)', derniere);
    const prog2 = await lireProgramme(page);
    const lA2 = ligneDe(prog2, 'arrivee');
    const lB2 = ligneDe(prog2, 'bowling');
    ok(Boolean(lA2 && lB2) && lA2.heure === '10:30' && /is-choisi/.test(lA2.classe) && lB2.heure === '11:30' && /is-choisi/.test(lB2.classe),
      'le programme : arrivee 10:30 choisie, bowling 11:30 choisi', resumeLignes(prog2));
    // La ligne d arrivee rouverte relit sa liste, avec le bowling pose.
    const nL = suivi.demandes.length;
    await ouvrirArrivees(page);
    await calme(page);
    const listes = suivi.demandes.slice(nL).filter(estListe);
    const ptL = listes.length ? JSON.parse(params(listes[listes.length - 1]).get('preferredTimes') || '{}') : {};
    ok(listes.length === 1 && ptL.bowling === '11:30', 'la ligne d arrivee rouverte relit sa liste, avec le bowling pose a 11:30', listes.join(' | '));
    const pucesA = await lirePuces(page, 'arrivee');
    const a = (h) => pucesA.find((c) => c.time === h) || {};
    // LE DERNIER CHOIX GAGNE : une arrivee apres le bowling pose le libere, il
    // se replacera apres elle. Elle se prend (« décale »), jamais « trop tard ».
    ok(a('12:00').ok === 'true' && a('12:00').etat === 'shift' && a('12:00').mot === 'décale', 'arriver a 12:00, apres le bowling pose a 11:30, se dit « décale » et se prend', JSON.stringify(a('12:00')));
    await problemesEnCouleur(page, '[H] les arrivees avec le bowling pose a 11:30');
    const lLibere = (await lirePourquoi(page, 'arrivee')).find((l) => l.heures.includes('12:00')) || null;
    ok(Boolean(lLibere) && /votre bowling \(11:30\) se replacera après votre arrivée/i.test(lLibere.texte), 'sous la plage : « Votre bowling (11:30) se replacera après votre arrivée »', JSON.stringify(lLibere));
    ok(a('11:00').ok === 'true' && a('11:00').etat !== 'shift', 'arriver a 11:00 garde le bowling de 11:30 : rien ne decale', JSON.stringify(a('11:00')));
    // Une autre arrivee, avant le bowling, le garde.
    const nA = suivi.demandes.length;
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="11:00"]');
    await calme(page);
    const dem = suivi.demandes.slice(nA).filter((u) => !estListe(u)).pop() || '';
    const ptA = dem ? JSON.parse(params(dem).get('preferredTimes') || '{}') : {};
    ok(Boolean(dem) && params(dem).get('arrival') === '11:00' && ptA.bowling === '11:30', 'choisir une autre arrivee (11:00) garde le bowling pose (11:30)', dem);
    // Une arrivee APRES le bowling (12:00) : le bowling se libere, la demande
    // part sans lui, le serveur le replace apres l arrivee, la visite le dit.
    if (!(ligneDe(await lireProgramme(page), 'arrivee') || {}).ouverte) await ouvrirArrivees(page);
    await calme(page);
    await ouvrirPlage(page, 'arrivee', '12:00');
    const nM = suivi.demandes.length;
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="12:00"]');
    await calme(page);
    const demM = suivi.demandes.slice(nM).filter((u) => !estListe(u)).pop() || '';
    const repM = await reponseAttendue(suivi, (u) => params(u).get('arrival') === '12:00' && !params(u).has('preferredTimes'));
    const heuresM = (((((repM && repM.slots && repM.slots[0]) || {}).opsPlan || {}).anchorPlan || {}).times) || {};
    ok(Boolean(demM) && params(demM).get('arrival') === '12:00' && !params(demM).has('preferredTimes') && minutesDe(heuresM.bowling) >= minutesDe('12:10'),
      `choisir l arrivee de 12:00 libere le bowling de 11:30 : la demande part sans lui, le serveur le replace a ${heuresM.bowling}`, demM);
    const vM = await lireVisite(page);
    const blocB = vM.etapes.find((e) => /bowling/i.test(e.titre)) || {};
    ok(blocB.b === heuresM.bowling && /replacé après votre arrivée \(12:00\)/.test(blocB.detail), 'la visite dit le bowling replace apres l arrivee (12:00)', JSON.stringify(blocB));
    const progM = await lireProgramme(page);
    ok((ligneDe(progM, 'arrivee') || {}).heure === '12:00' && /is-choisi/.test((ligneDe(progM, 'arrivee') || {}).classe) && /is-propose/.test((ligneDe(progM, 'bowling') || {}).classe),
      'le programme : arrivee 12:00 choisie, le bowling propose par le serveur', resumeLignes(progM));
    // UN BOWLING AVANT L ARRIVEE (10:00) : il se prend, l arrivee tombe, le
    // plan la conseille juste avant lui ; la visite dit qu elle a avance.
    if (!(ligneDe(await lireProgramme(page), 'bowling') || {}).ouverte) {
      await page.click('#hourZone .fg-etape[data-cle="bowling"] .fg-etape__tete');
      await page.waitForTimeout(400);
    }
    const nT = suivi.demandes.length;
    ok(await toucher(page, 'bowling', '10:00'), 'avec l arrivee de 12:00, le bowling de 10:00 se touche (« décale »)');
    await calme(page);
    const demT = suivi.demandes.slice(nT).filter((u) => !estListe(u)).pop() || '';
    const ptT = demT ? JSON.parse(params(demT).get('preferredTimes') || '{}') : {};
    ok(Boolean(demT) && !params(demT).has('arrival') && ptT.bowling === '10:00', 'la demande part avec le bowling de 10:00, sans l arrivee de 12:00', demT);
    const progT = await lireProgramme(page);
    const lAT = ligneDe(progT, 'arrivee') || {};
    ok(lAT.heure === '09:50' && /is-propose/.test(lAT.classe) && /is-choisi/.test((ligneDe(progT, 'bowling') || {}).classe), 'le programme : le bowling 10:00 choisi, l arrivee conseillee a 09:50', resumeLignes(progT));
    const vT = await lireVisite(page);
    const arrT = vT.etapes.find((e) => /Arrivée/.test(e.titre)) || {};
    ok(arrT.b === '09:50' && /au lieu de 12:00/.test(arrT.detail), 'la visite dit l arrivee avancee (au lieu de 12:00)', JSON.stringify(arrT));
    // Une reponse d arrivee sans grille (son calcul a echoue au serveur) : le
    // programme garde ses lignes, celles de la derniere demande sans arrivee.
    await page.route((url) => url.pathname === '/api/public-availability' && url.searchParams.has('arrival'), async (route) => {
      const reponse = await route.fetch();
      const j = await reponse.json();
      delete j.anchors;
      await route.fulfill({ response: reponse, json: j });
    });
    // Une heure choisie replie la ligne d arrivee : la rouvrir pour en toucher une autre.
    if (!(ligneDe(await lireProgramme(page), 'arrivee') || {}).ouverte) await ouvrirArrivees(page);
    await ouvrirPlage(page, 'arrivee', '10:30');
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:30"]');
    await calme(page);
    const prog3 = await lireProgramme(page);
    ok(Boolean(ligneDe(prog3, 'bowling') && ligneDe(prog3, 'laser_game')), 'une reponse d arrivee sans grille garde les lignes du bowling et du laser', resumeLignes(prog3));
  } finally {
    ok(suivi.erreurs.length === 0, '[H] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [I] LES ARCADES A LEUR HEURE, LE TEMPS LIBRE (2026-10-13)
// ---------------------------------------------------------------------------
// Movsar : « pourquoi tu mets automatiquement l heure d arrivee a arcade [...]
// ils peuvent choisir heure d arrivee mais aussi arcade, mettre arcade pendant
// temps d attente [...] des pop up adaptees en fonction du temps libre [...] si
// ils ont des activites a choisir sur place deja et que ca couvre tout le temps
// libre faut pas proposer [...] super puissant et pointille ».
const estArcades = (u) => params(u).get('arcades') === '1';
const estPlan = (u) => !estListe(u) && !estArcades(u);
async function lireLibres(page) {
  return lisible(await page.evaluate(() => [...document.querySelectorAll('#planZone .fg-visit__gap--libre')].map((li) => {
    const b = li.querySelector('[data-libre]');
    const choix = li.querySelector('.fg-libre__choix');
    return {
      cle: b ? b.dataset.libre : '',
      quoi: (li.querySelector('.fg-libre__quoi') || {}).textContent || '',
      expanded: b ? b.getAttribute('aria-expanded') : '',
      cible: Boolean(b && document.getElementById(b.getAttribute('aria-controls') || '')),
      ouvert: Boolean(choix && !choix.hidden),
      hauteur: b ? b.getBoundingClientRect().height : 0,
      bordure: b ? getComputedStyle(b).borderTopStyle : '',
      actions: choix ? [...choix.querySelectorAll('.fg-libre__action')].map((a) => ({
        arcades: a.dataset.libreArcades || '', arrivee: a.dataset.libreArrivee || '',
        titre: (a.querySelector('b') || {}).textContent || '', detail: (a.querySelector('small') || {}).textContent || '',
        hauteur: a.getBoundingClientRect().height,
      })) : [],
    };
  })));
}
async function ouvrirLigne(page, cle) {
  if ((ligneDe(await lireProgramme(page), cle) || {}).ouverte) return;
  await page.click(`#hourZone .fg-etape[data-cle="${cle}"] .fg-etape__tete`);
  await page.waitForTimeout(400);
}
async function scenarioI(browser, mock) {
  section('I. LES ARCADES A LEUR HEURE, LE TEMPS LIBRE (pistes et arene pleines de 10:00 a 12:00, au telephone)');
  reglage = REGLAGE;
  semer(mock, [['10:00', '12:00']]);
  const { ctx, page, suivi } = await ouvrir(browser, { largeur: 360, hauteur: 780 });
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await calme(page);
    const prog0 = await lireProgramme(page);
    ok(arrive && !ligneDe(prog0, 'arcade_time'), 'MONTAGE Formule 1 au telephone : sans heure d arrivee choisie, pas de ligne des arcades (le pass de la visite)', resumeLignes(prog0));
    await ouvrirArrivees(page);
    await ouvrirPlage(page, 'arrivee', '10:00');
    await page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]');
    await calme(page);
    // 1. La ligne des arcades : l heure ou la frise les range, apres l accueil.
    const rep1 = await reponseAttendue(suivi, (u) => estPlan(u) && params(u).get('arrival') === '10:00' && !params(u).has('arcade'));
    const frise1 = ((((rep1 && rep1.slots && rep1.slots[0]) || {}).opsPlan || {}).arrivalPlan || {}).frise || [];
    const arc1 = frise1.find((s) => s.kind === 'free' && s.activityId === 'arcade_time') || {};
    const lArc1 = ligneDe(await lireProgramme(page), 'arcade_time');
    ok(Boolean(lArc1) && arc1.startTime === '10:10' && lArc1.heure === '10:10' && /is-propose/.test(lArc1.classe) && /30 min/.test(lArc1.detail) && /pendant l’attente/.test(lArc1.detail),
      'arrivee 10:00 choisie : une ligne « Arcades », 10:10 proposee (apres l accueil, jamais a l heure d arrivee), « 30 min · comprises · pendant l’attente »', JSON.stringify(lArc1));
    ok(!suivi.demandes.some(estArcades), 'les heures d arcade ne se demandent pas tant que leur ligne n est pas ouverte');
    // 2. La ligne ouverte : une demande, ses heures.
    const n2 = suivi.demandes.length;
    await page.click('#hourZone .fg-etape[data-cle="arcade_time"] .fg-etape__tete');
    const chargees = await attendre(page, () => document.querySelectorAll('.fg-track[data-activity="arcade_time"] .fg-chip').length > 0, 20000);
    await page.waitForTimeout(350);
    const listes2 = suivi.demandes.slice(n2).filter(estArcades);
    const q2 = listes2[0] ? params(listes2[0]) : new URLSearchParams();
    ok(chargees && listes2.length === 1 && q2.get('arrival') === '10:00' && !q2.has('arcade'), 'ouvrir la ligne demande les heures d arcade de cette arrivee, une fois', listes2.join(' | '));
    const grille2 = await reponseAttendue(suivi, estArcades);
    const heures2 = (grille2 && grille2.arcadeTimes) || [];
    const puces2 = await lirePuces(page, 'arcade_time');
    ok(heures2.length > 1 && puces2.length === heures2.length && heures2[0].time === '10:10' && puces2[0].time === '10:10' && puces2[0].mot === 'proposé' && heures2[1].time === '10:30',
      `chaque heure d arcade du serveur a sa puce (${puces2.length}) : 10:10 d abord (la fin de l accueil, la ou le plan les range, « proposé »), puis les demi-heures`, puces2.slice(0, 3).map((c) => `${c.time}:${c.mot}`).join(','));
    // 3. Les arcades a 14:00, apres les activites.
    const n3 = suivi.demandes.length;
    await ouvrirPlage(page, 'arcade_time', '14:00');
    ok(await toucher(page, 'arcade_time', '14:00'), 'MONTAGE les arcades de 14:00 se touchent');
    await calme(page);
    const dem3 = suivi.demandes.slice(n3).filter(estPlan).pop() || '';
    ok(Boolean(dem3) && params(dem3).get('arrival') === '10:00' && params(dem3).get('arcade') === '14:00', 'la demande porte l arrivee (10:00) et les arcades choisies (14:00)', dem3);
    const lArc3 = ligneDe(await lireProgramme(page), 'arcade_time') || {};
    const eArc3 = (await lireVisite(page)).etapes.find((e) => /arcades/i.test(e.titre)) || {};
    ok(lArc3.heure === '14:00' && /is-choisi/.test(lArc3.classe) && /à votre heure/.test(lArc3.detail), 'la ligne des arcades : 14:00, choisie, « à votre heure »', JSON.stringify(lArc3));
    ok(eArc3.b === '14:00' && /à votre heure/.test(eArc3.detail), 'la visite : les arcades a 14:00, « à votre heure »', JSON.stringify(eArc3));
    // 4. Les arcades apres les activites : chaque attente qui les tient devient
    //    un cadre en pointille qui propose d y faire les arcades (avant le
    //    bowling, apres le laser).
    const libres4 = await lireLibres(page);
    const avecArcades = libres4.filter((l) => l.actions.some((a) => a.arcades));
    const cadre = avecArcades[0] || null;
    ok(avecArcades.length === 2 && cadre.bordure === 'dashed' && cadre.expanded === 'false' && cadre.cible && !cadre.ouvert && cadre.hauteur >= 44 && /de libre/.test(cadre.quoi),
      'les deux attentes ou les arcades tiennent (avant le bowling, apres le laser) deviennent des cadres en pointille, replies, de 44 px au moins', JSON.stringify(libres4));
    if (cadre) await page.click(`#planZone [data-libre="${cadre.cle}"]`);
    await page.waitForTimeout(250);
    const deplie = (await lireLibres(page)).find((l) => cadre && l.cle === cadre.cle) || {};
    const idee = (deplie.actions || []).find((a) => a.arcades) || {};
    ok(deplie.ouvert === true && deplie.expanded === 'true' && idee.arcades === '10:10' && /Y faire vos arcades/.test(idee.titre) && /de 10:10 à 10:40, au lieu de 14:00/.test(idee.detail) && idee.hauteur >= 44,
      'touche, il se deplie sur place : « Y faire vos arcades, de 10:10 a 10:40, au lieu de 14:00 », une cible de 44 px', JSON.stringify(deplie));
    const apres = avecArcades[1] || null;
    if (apres) await page.click(`#planZone [data-libre="${apres.cle}"]`);
    await page.waitForTimeout(250);
    const libres4b = await lireLibres(page);
    const deplie2 = libres4b.find((l) => apres && l.cle === apres.cle) || {};
    const idee2 = (deplie2.actions || []).find((a) => a.arcades) || {};
    const premier = libres4b.find((l) => cadre && l.cle === cadre.cle) || {};
    ok(deplie2.ouvert === true && premier.ouvert === false && idee2.arcades === '13:25' && /de 13:25 à 13:55, au lieu de 14:00/.test(idee2.detail),
      'l attente d apres le laser se deplie, la premiere se replie : « Y faire vos arcades, de 13:25 a 13:55, au lieu de 14:00 »', JSON.stringify(deplie2));
    const n4 = suivi.demandes.length;
    if (deplie2.ouvert && idee2.arcades) await page.click(`#planZone [data-libre-arcades="${idee2.arcades}"]`);
    await calme(page);
    const dem4 = suivi.demandes.slice(n4).filter(estPlan).pop() || '';
    ok(Boolean(dem4) && params(dem4).get('arcade') === '13:25', 'l idee se pose comme une heure choisie : la demande porte les arcades a 13:25', dem4);
    // L heure prise hors de la grille des demi-heures (la fin du laser) a sa
    // puce, choisie.
    await ouvrirLigne(page, 'arcade_time');
    await attendre(page, () => document.querySelector('.fg-track[data-activity="arcade_time"] .fg-chip[data-time="13:25"]'), 8000);
    const a4 = (await lirePuces(page, 'arcade_time')).find((c) => c.time === '13:25') || {};
    ok(a4.mot === 'choisi' && a4.ok === 'true', 'les arcades de 13:25, hors de la grille, ont leur puce, choisie', JSON.stringify(a4));
    // 5. Revenir a l heure proposee : l attente d avant le bowling propose
    //    d arriver plus tard, ce que le serveur a verifie, et rien d autre.
    await ouvrirLigne(page, 'arcade_time');
    const n5 = suivi.demandes.length;
    await page.click('#hourZone [data-reset="arcade_time"]');
    await calme(page);
    const dem5 = suivi.demandes.slice(n5).filter(estPlan).pop() || '';
    const rep5 = await reponseAttendue(suivi, (u) => u === dem5);
    const later = (rep5 && rep5.arrival && rep5.arrival.later) || {};
    ok(Boolean(dem5) && !params(dem5).has('arcade') && params(dem5).get('arrival') === '10:00' && Boolean(later.time),
      `« Revenir a l heure proposee » : la demande part sans arcade, le serveur propose d arriver a ${later.time}`, dem5);
    const libres5 = await lireLibres(page);
    const cadre5 = libres5.find((l) => l.actions.some((a) => a.arrivee)) || null;
    const tard = cadre5 ? cadre5.actions.find((a) => a.arrivee) : {};
    ok(Boolean(cadre5) && cadre5.actions.length === 1 && tard.arrivee === later.time && /^Arriver à /.test(tard.titre) && /même programme/.test(tard.detail) && tard.detail.includes(libelleDuree(later.savedMinutes)),
      `l attente d avant le bowling propose « Arriver a ${later.time} » (meme programme, ${libelleDuree(later.savedMinutes)} d attente en moins), et rien d autre : les arcades y sont deja`, JSON.stringify(libres5));
    if (cadre5) await page.click(`#planZone [data-libre="${cadre5.cle}"]`);
    await page.waitForTimeout(250);
    const n5b = suivi.demandes.length;
    if (tard.arrivee && ((await lireLibres(page)).find((l) => l.cle === cadre5.cle) || {}).ouvert) await page.click(`#planZone [data-libre-arrivee="${tard.arrivee}"]`);
    await calme(page);
    const dem5b = suivi.demandes.slice(n5b).filter(estPlan).pop() || '';
    ok(Boolean(dem5b) && params(dem5b).get('arrival') === later.time, `l idee se pose : la demande porte l arrivee de ${later.time}`, dem5b);
    // 6. Les arcades a 14:00, puis le bowling pose sur elles les decale.
    await ouvrirLigne(page, 'arcade_time');
    // L arrivee a change : la ligne ouverte relit ses heures (arcades=1, 11:00).
    await attendre(page, () => document.querySelectorAll('.fg-track[data-activity="arcade_time"] .fg-chip').length > 0 && !document.querySelector('.fg-track[data-activity="arcade_time"] .fg-loading'), 20000);
    await page.waitForTimeout(350);
    const relue = suivi.demandes.filter(estArcades).pop() || '';
    ok(params(relue).get('arrival') === later.time, `l arrivee changee, la ligne des arcades ouverte relit ses heures (arrivee ${later.time})`, relue);
    await ouvrirPlage(page, 'arcade_time', '14:00');
    ok(await toucher(page, 'arcade_time', '14:00'), 'MONTAGE les arcades de 14:00 se touchent');
    await calme(page);
    await ouvrirLigne(page, 'bowling');
    await ouvrirPlage(page, 'bowling', '14:00');
    const b6 = (await lirePuces(page, 'bowling')).find((c) => c.time === '14:00') || {};
    ok(b6.ok === 'true' && b6.etat === 'shift' && b6.mot === 'décale', 'le bowling de 14:00, sur les arcades choisies, se dit « décale » et se prend', JSON.stringify(b6));
    const pourquoi6 = (await lirePourquoi(page, 'bowling')).find((l) => l.heures.includes('14:00')) || null;
    ok(Boolean(pourquoi6) && /vos arcades \(14:00\) se replaceront/i.test(pourquoi6.texte), 'sous la plage : « Vos arcades (14:00) se replaceront avant ou après »', JSON.stringify(pourquoi6));
    const n6 = suivi.demandes.length;
    ok(await toucher(page, 'bowling', '14:00'), 'MONTAGE le bowling de 14:00 se touche');
    await calme(page);
    const dem6 = suivi.demandes.slice(n6).filter(estPlan).pop() || '';
    const pt6 = dem6 ? JSON.parse(params(dem6).get('preferredTimes') || '{}') : {};
    ok(Boolean(dem6) && !params(dem6).has('arcade') && pt6.bowling === '14:00', 'la demande part avec le bowling de 14:00, sans les arcades : la frise les replace', dem6);
    const eArc6 = (await lireVisite(page)).etapes.find((e) => /arcades/i.test(e.titre)) || {};
    ok(/déplacées pour votre bowling à 14:00/.test(eArc6.detail), 'la visite dit les arcades deplacees pour le bowling de 14:00', JSON.stringify(eArc6));
    // 7. Les arcades sur le bowling pose le liberent.
    await ouvrirLigne(page, 'arcade_time');
    await attendre(page, () => document.querySelectorAll('.fg-track[data-activity="arcade_time"] .fg-chip').length > 0 && !document.querySelector('.fg-track[data-activity="arcade_time"] .fg-loading'), 20000);
    await page.waitForTimeout(350);
    await ouvrirPlage(page, 'arcade_time', '14:00');
    const a7 = (await lirePuces(page, 'arcade_time')).find((c) => c.time === '14:00') || {};
    ok(a7.ok === 'true' && a7.etat === 'shift' && a7.mot === 'décale' && /votre bowling \(14:00\) se replacera autour de vos arcades/i.test(a7.titre),
      'les arcades de 14:00, sur le bowling pose : « décale », « Votre bowling (14:00) se replacera autour de vos arcades »', JSON.stringify(a7));
    const n7 = suivi.demandes.length;
    ok(await toucher(page, 'arcade_time', '14:00'), 'MONTAGE les arcades de 14:00 se touchent de nouveau');
    await calme(page);
    const dem7 = suivi.demandes.slice(n7).filter(estPlan).pop() || '';
    const pt7 = dem7 ? JSON.parse(params(dem7).get('preferredTimes') || '{}') : {};
    ok(Boolean(dem7) && params(dem7).get('arcade') === '14:00' && !pt7.bowling, 'la demande part avec les arcades de 14:00, sans le bowling : le serveur le replace', dem7);
    const eB7 = (await lireVisite(page)).etapes.find((e) => /bowling/i.test(e.titre)) || {};
    ok(/replacé autour de vos arcades \(14:00\)/.test(eB7.detail), 'la visite dit le bowling replace autour des arcades', JSON.stringify(eB7));
    // 8. Le blocage part avec l heure d arcade ; rien ne deborde au telephone ;
    //    chaque phrase sous les plages finit par un seul point, celles des
    //    heures trop tardives du soir comprises (« pour cette formule.. » en
    //    prod le 13/10).
    await page.waitForTimeout(500);
    const phrases = await page.evaluate(() => [...document.querySelectorAll('#hourZone .fg-why-list__item span')].map((s) => s.textContent.trim()));
    const doubles = phrases.filter((p) => /\.\.(\s|$)/.test(p));
    ok(phrases.some((p) => /^Trop tard/.test(p)) && doubles.length === 0, `sous les plages, chaque phrase finit par un seul point, celles des heures trop tardives comprises (${phrases.length} phrases)`, doubles.slice(0, 2).join(' | '));
    const largeur = await page.evaluate(() => ({ page: document.scrollingElement.scrollWidth, ecran: window.innerWidth }));
    ok(largeur.page <= largeur.ecran, 'au telephone (360 px), rien ne deborde', JSON.stringify(largeur));
    const nB = suivi.blocages.length;
    await page.click('#goContact');
    const contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 12000);
    const bloc = suivi.blocages.length > nB ? suivi.blocages[suivi.blocages.length - 1] : null;
    ok(contact && Boolean(bloc && bloc.preference) && bloc.preference.arcadeTime === '14:00' && bloc.preference.arrivalTime === later.time,
      'le blocage part avec l heure d arrivee et les arcades choisies (14:00)', JSON.stringify(bloc && bloc.preference));
  } finally {
    ok(suivi.erreurs.length === 0, '[I] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // 9. Rien a proposer quand le libre de la formule couvre l attente : la
  //    Formule 2 fait son minigolf avant le laser, aucun cadre.
  semer(mock, []);
  const deux = await ouvrir(browser, { largeur: 360, hauteur: 780 });
  try {
    const arriveF2 = await versHeures(deux.page, mock, 'f2');
    await calme(deux.page);
    await ouvrirArrivees(deux.page);
    await ouvrirPlage(deux.page, 'arrivee', '10:00');
    await deux.page.click('.fg-track[data-activity="arrivee"] .fg-chip[data-time="10:00"]');
    await calme(deux.page);
    const repF2 = await reponseAttendue(deux.suivi, (u) => estPlan(u) && params(u).get('arrival') === '10:00');
    const planF2 = (((repF2 && repF2.slots && repF2.slots[0]) || {}).opsPlan || {}).arrivalPlan || {};
    const couvert = (planF2.frise || []).some((s) => s.kind === 'free' && s.activityId === 'minigolf_blacklight' && s.placement === 'before');
    ok(arriveF2 && couvert && planF2.waitMinutes === 0, 'MONTAGE Formule 2, journee libre, arrivee 10:00 : le minigolf se fait avant le laser, aucune attente', JSON.stringify({ attente: planF2.waitMinutes, couvert }));
    const libresF2 = await lireLibres(deux.page);
    const trous = await deux.page.evaluate(() => document.querySelectorAll('#planZone .fg-visit__gap').length);
    ok(libresF2.length === 0 && trous === 0, 'le minigolf couvre le temps libre : aucun cadre, rien a proposer', JSON.stringify({ libresF2, trous }));
  } finally {
    ok(deux.suivi.erreurs.length === 0, '[I] Formule 2 : aucune erreur JavaScript', deux.suivi.erreurs.slice(0, 3).join(' | '));
    await deux.ctx.close();
  }
}

const SCENARIOS = [['A', scenarioA], ['B', scenarioB], ['C', scenarioC], ['D', scenarioD], ['E', scenarioE], ['F', scenarioF], ['G', scenarioG], ['H', scenarioH], ['I', scenarioI]];

async function main() {
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const server = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    for (const [cle, jouer] of SCENARIOS) {
      if (SEULEMENT.length && !SEULEMENT.includes(cle)) continue;
      try {
        await jouer(browser, mock);
      } catch (error) {
        ok(false, `[${cle}] le parcours va jusqu au bout`, String((error && error.message) || error).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8).join(' | '));
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) {
    console.error(`\nformules-arrivee-form-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nformules-arrivee-form-check: ALL OK (l heure d arrivee se choisit, dit pourquoi, part avec la reservation ; sans elle rien ne change)');
  process.exit(0);
}

function contreEpreuves() {
  const fichiers = [...new Set([JS, 'assets/fungalaxy-booking.css', 'fungalaxy.html', ...MUTATIONS.map((m) => m.fichier)])];
  const empreintes = new Map(fichiers.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  let defauts = 0;
  MUTATIONS.forEach((mutation, index) => {
    const r = spawnSync(process.execPath, [__filename], {
      env: { ...process.env, PINLANE_ARRIVEE_FORM_MUTATION: String(index + 1), PINLANE_ARRIVEE_FORM_SCENARIOS: mutation.scenarios.join(',') },
      encoding: 'utf8',
      timeout: 300000,
    });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const servie = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
    const rouges = sortie.split('\n').filter((l) => l.startsWith('FAIL')).length;
    if (r.status === 2 || !servie) {
      defauts += 1;
      console.error(`contre-epreuve DESARMEE : ${mutation.nom} (${r.status === 2 ? 'ancre introuvable' : 'mutation non servie'})`);
    } else if (r.status === null) {
      defauts += 1;
      console.error(`contre-epreuve INTERROMPUE : ${mutation.nom} (delai depasse)`);
    } else if (r.status !== 1 || !rouges) {
      defauts += 1;
      console.error(`contre-epreuve MUETTE : le gate reste vert quand ${mutation.nom}.`);
    } else {
      console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom} (${rouges} FAIL, scenario ${mutation.scenarios.join('+')}).`);
    }
  });
  const touches = [...empreintes].filter(([f, avant]) => fs.readFileSync(path.join(ROOT, f), 'utf8') !== avant);
  if (touches.length) {
    defauts += 1;
    console.error(`un fichier a ete ecrit : ${touches.map(([f]) => f).join(', ')}`);
  }
  if (defauts) {
    console.error(`\nformules-arrivee-form-check --mutate: ${defauts} defaut(s).`);
    process.exit(1);
  }
  console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et aucun fichier n a ete ecrit.`);
}

if (process.argv.includes('--mutate')) {
  contreEpreuves();
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}

'use strict';
// L ARRIVEE ET LES ARCADES D UNE FORMULE, A L ECRAN DU CLIENT (modele A,
// 2026-10-13).
//
// Movsar, le 13/10 au soir : « je trouve que tout le systeme de arrivé est
// mal gerer de fou [...] ça montre pour toute les heures quasi que cv se
// deplacer ou que ya des prblm », puis « oui ok pour la A ». Le client ne
// choisit plus son heure d arrivee : il pose ses activites, et ses arcades
// s il veut (« Facultatif ») ; l arrivee est une borne, dix minutes avant la
// premiere activite, a l heure pile quand celle-ci ouvre la journee
// (« lorsque il commence a louverture du centre ils peuvent venir a lheure
// pile »). Ce gate prouve l ecran, dans le navigateur, sur le mock du depot (le
// vrai gestionnaire des disponibilites sur un instantane en memoire : aucune
// base, rien d ecrit, rien d envoye) :
//   [A] sans heure d arcade choisie, rien ne part de plus : aucune demande ne
//       porte arrival, arrivals, arrivees, arcade ni arcades, le blocage part
//       sans arrivalTime ni arcadeTime, et le reglage d arrivee de la meta n y
//       change rien ; depuis le 2026-10-21, l arrivee est la premiere ligne,
//       facultative et fermee, qui dit l heure du plan (son choix :
//       scripts/choisir-arrivee-check.js) ;
//   [B] la borne a l ouverture : la Formule 1 proposee a l ouverture fait
//       arriver a l heure du bowling, la visite dit « à l’ouverture » ; le
//       bowling pose a 10:30, la borne dit 10:20, « 10 min avant votre
//       bowling » ;
//   [C] la ligne des arcades (Formules 1, 2, 3 ; la 4 seulement avec sa
//       variante aux arcades, [J]) : « Facultatif »,
//       en petit, ne s ouvre pas seule, ses heures (arcades=1) ne se
//       demandent qu a son ouverture, sans arrivee ni heure d arcade, de
//       l ouverture a la fermeture ; une heure sur le bowling pose dit ce
//       qu elle decale ;
//   [D] des arcades a 13:00 : la demande les porte, la borne dit 12:50, leur
//       ligne passe en tete, le bowling se propose a 13:30, la visite les dit
//       a leur heure, le blocage part avec elles ; les retoucher les rend
//       facultatives ;
//   [E] le dernier choix gagne : des arcades sur le bowling pose le liberent
//       (le serveur le replace autour d elles), un bowling sur les arcades les
//       leve (la visite le dit) ; leurs heures se lisent en tirets de la
//       teinte de leur ligne ([J]) ;
//   [F] le temps libre ou les arcades tiennent devient un cadre en pointille
//       qui les propose et les pose ; rien quand elles ont deja leur heure, ni
//       quand le minigolf de la formule couvre ce temps. Il ne le couvre que
//       s il y tient tout entier (2026-10-15) : 35 min entre deux parties ne
//       portent pas ses 45, il se joue « Dans la foulée » et les arcades s y
//       proposent ; dans 1 h 05, il se joue « Entre les deux », et les 20 min
//       qui restent ne portent pas les 30 des arcades ;
//   [G] au telephone (360 px) : rien ne deborde, des cibles de 44 px, les memes
//       boutons que les heures du bowling, le focus se voit ;
//   [H] une heure par partie de laser (Formule 2, Movsar le 14/10 : « l heure
//       proposée pour la seconde partie de laser game est la même que la
//       1re ») : la ligne de la partie 2 propose la premiere heure libre apres
//       la partie 1, jamais l heure de celle-ci ; touchee dans la ligne 2,
//       l heure est celle de la partie 2 et la partie 1 garde son heure
//       proposee ; la partie 1 posee, la ligne 2 s ouvre seule, sur la plage
//       de son heure proposee.
//   [I] venir quand meme (Movsar le 14/10 : « si le systeme voit que laser
//       game et bowling sont full a des heures ça met que ils peuvent choisir
//       arcades pendant cette heure ») : le bowling et le laser complets a
//       15:00, une heure complete touchee propose les arcades a 15:00 et
//       l activite a sa premiere heure libre apres, avec ce que le plan du
//       serveur pose ensuite ; une autre heure complete remplace la
//       proposition ; le toucher pose ce plan (arcades 15:00 choisies, le
//       bowling a 16:00), le blocage part avec lui. Rien ne s affiche quand
//       rien ne tient : ni sans heure libre apres, ni quand le serveur ferait
//       commencer la visite avant 15:00.
//   [J] la Formule 4 au choix (Movsar le 13/10 : « oui », « 60 min
//       d'arcades » a la place des deux parties de Laser Game) : sous la
//       carte choisie, deux pastilles d option, « 2 parties de Laser Game »
//       cochee ; la variante touchee (ou a la fleche) change la liste de la
//       carte, une autre formule la remet a la carte ; chaque demande des
//       heures et le blocage la portent ; l ecran des heures, la visite et
//       le recapitulatif disent ses arcades, aucun laser ; revenir a « 2
//       parties de Laser Game » rend les lignes de laser et des demandes
//       sans variante. La variante touchee se dit, la fiche (i) de la carte
//       la dit ; le panier d une carte « en plus » (joue a part, sans
//       navigateur) garde la variante de sa formule, jamais celle d une
//       autre ;
//   [K] les variantes que le centre ou le jour ne jouent pas, telles que le
//       vrai code du serveur les dit (api/public-booking-meta) : le laser
//       coupe au centre ou bloque ce jour-la, la Formule 4 reste, avec ses
//       arcades seulement, sans pastille, et ses demandes les portent ; le
//       laser et les arcades bloques, elle se grise ;
//   [L] une variante que le serveur refuse (409, formula_choice_unavailable)
//       sur les heures, le blocage ou la confirmation : la phrase du
//       serveur s affiche sur l ecran des heures (une confirmation refusee y
//       ramene le client), la variante sort de la carte et les horaires se
//       redemandent pour le contenu de la carte.
//   --mutate : une regle cassee a la fois, en memoire (le formulaire servi au
//       navigateur, ou le moteur compile pour le serveur) : chacune doit faire
//       rougir le gate ; le disque n est jamais ecrit, et on le verifie.
//
// Le jour joue : le samedi des gates (scripts/jour-de-test.js, le premier a
// venir hors vacances scolaires et feries), ou les Formules 1 a 4 doivent se
// vendre, donne au serveur de dev (PINLANE_DEVTUNNEL_DATE).
//
// Lancement : node scripts/formules-arrivee-form-check.js [--mutate]

const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { spawn, spawnSync } = require('child_process');
const { Readable } = require('stream');

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
const SEULEMENT = String(process.env.PINLANE_ARRIVEE_FORM_SCENARIOS || '').split(',').map((s) => s.trim()).filter(Boolean);
// Le reglage que la meta publique donne au formulaire (api/public-booking-meta,
// lib/formula-visit) : l arrivee proposee. Le formulaire ne le lit plus.
const REGLAGE = { arrivalFirst: true, maxWaitMinutes: 30, maxVisitMinutes: 0, freeDurationPolicy: 'default' };
const JS = 'assets/fungalaxy-booking.js';
const CSS = 'assets/fungalaxy-booking.css';

// ---------------------------------------------------------------------------
// LES CONTRE-EPREUVES : une regle cassee chacune, et les scenarios qui la
// voient. Le formulaire est servi casse au navigateur ; le moteur est compile
// casse, avant tout require du serveur. Le disque n est jamais ecrit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'une demande sans arcade porte un parametre de plus', fichier: JS, scenarios: ['A'],
    de: "    if (state.arcade) q.set('arcade', state.arcade);", vers: "    q.set('arcade', state.arcade);" },
  { nom: 'le blocage part avec une heure d arcade vide', fichier: JS, scenarios: ['A'],
    de: '    if (state.arcade) base.preference.arcadeTime = state.arcade;', vers: '    base.preference.arcadeTime = state.arcade;' },
  { nom: 'l arrivee conseillee redit « 0 min avant » a l ouverture', fichier: JS, scenarios: ['B'],
    de: "detail: avance > 0 ? avance + ' min avant ' + votre(parts[0].id) : 'à l’ouverture' });", vers: "detail: avance + ' min avant ' + votre(parts[0].id) });" },
  { nom: 'l arrivee passe de nouveau avant l ouverture (serveur)', fichier: 'lib/ops-engine.js', scenarios: ['B'],
    de: '  const posee = demandeArrivee ? raw : arriveeALOuverture(raw, window.open);', vers: '  const posee = raw;' },
  { nom: 'la ligne des arcades n existe plus', fichier: JS, scenarios: ['C'],
    de: '    if (aDesArcades(d)) {\n      var rangee = arcadeDuPlan();', vers: '    if (false) {\n      var rangee = arcadeDuPlan();' },
  { nom: 'les arcades ne sont plus facultatives (leur ligne s ouvre seule)', fichier: JS, scenarios: ['C'],
    de: "  function aPlacer(e) { return e.etat !== 'choisi' && e.etat !== 'surplace' && e.etat !== 'libre'; }", vers: "  function aPlacer(e) { return e.etat !== 'choisi' && e.etat !== 'surplace'; }" },
  { nom: 'la ligne des arcades dit « À choisir »', fichier: JS, scenarios: ['C'],
    de: ": e.etat === 'libre' ? 'Facultatif' : 'À choisir';", vers: ": 'À choisir';" },
  { nom: '« Facultatif » se lit comme une heure', fichier: CSS, scenarios: ['C'],
    de: '.fg-etape.is-surplace .fg-etape__heure, .fg-etape.is-libre .fg-etape__heure {', vers: '.fg-etape.is-surplace .fg-etape__heure {' },
  { nom: 'les heures d arcade se demandent des l arrivee sur les heures', fichier: JS, scenarios: ['C'],
    de: '    if (ancres.length) { majPistes(d); majEtapes(d); rendreArcades(); }', vers: '    if (ancres.length) { majPistes(d); majEtapes(d); if (aDesArcades(d)) chargerArcades(); }' },
  { nom: 'la liste des heures d arcade part avec l heure choisie', fichier: JS, scenarios: ['D'],
    de: "    // La liste des heures d arcade ne depend pas de celle choisie.\n    if (liste === 'arcades') {", vers: "    if (state.arcade) q.set('arcade', state.arcade);\n    if (liste === 'arcades') {" },
  { nom: 'l heure d arcade choisie ne part pas au serveur', fichier: JS, scenarios: ['D'],
    de: "    if (state.arcade) q.set('arcade', state.arcade);", vers: '    void 0;' },
  { nom: 'le blocage part sans l heure d arcade', fichier: JS, scenarios: ['D'],
    de: '    if (state.arcade) base.preference.arcadeTime = state.arcade;', vers: '    void 0;' },
  { nom: 'la visite ne montre plus les arcades a leur heure', fichier: JS, scenarios: ['D'],
    de: '    if (arcPlan.startTime) parts = parts.concat(', vers: '    if (false) parts = parts.concat(' },
  { nom: 'la visite ne dit plus « à votre heure »', fichier: JS, scenarios: ['D'],
    de: "        p.arcade ? 'à votre heure' : '',", vers: "        '',"},
  { nom: 'retoucher l heure d arcade la garde', fichier: JS, scenarios: ['D'],
    de: "    if (state.arcade === t) state.arcade = '';\n    else {", vers: '    if (false) void 0;\n    else {' },
  { nom: 'sans arrivee, l heure d arcade ne se pose plus (serveur)', fichier: 'lib/ops-engine.js', scenarios: ['D'],
    de: '  if (sansArrivee && arcadeStart !== null && arcadeStart !== undefined && Number.isFinite(Number(arcadeStart))) {', vers: '  if (false) {' },
  { nom: 'des arcades sur le bowling pose ne le liberent plus', fichier: JS, scenarios: ['E'],
    de: '        } else delete state.pins[c.activityId];', vers: '        } else void 0;' },
  { nom: 'une heure de bowling sur les arcades ne les decale plus', fichier: JS, scenarios: ['E'],
    de: '  var DECALENT = { anchor_overlap: 1, arrival_before: 1, arrival_welcome: 1, arcade_overlap: 1 };', vers: '  var DECALENT = { anchor_overlap: 1, arrival_before: 1, arrival_welcome: 1 };' },
  { nom: 'decaler les arcades garde leur heure', fichier: JS, scenarios: ['E'],
    de: "      if (autre === 'arcade_time') {\n        state.arcade = '';", vers: "      if (autre === 'arcade_time') {\n        void 0;" },
  { nom: 'la phrase d une heure posee sur les arcades ne les nomme plus', fichier: JS, scenarios: ['E'],
    de: "    if (g.etat === 'shift' && g.conflit.id === 'arcade_time') return typo('Vos arcades (' + g.conflit.time + ') se feront à un autre moment.');", vers: '' },
  { nom: 'la visite ne dit plus les arcades deplacees', fichier: JS, scenarios: ['E'],
    de: "    var arcadesLevees = Boolean(adaptation && adaptation.deplace === 'arcade_time');", vers: '    var arcadesLevees = false;' },
  { nom: 'la visite ne dit plus le bowling replace autour des arcades', fichier: JS, scenarios: ['E'],
    de: "        replacee ? 'replacé autour de vos arcades (' + adaptation.t + ')'", vers: "        replacee ? ''" },
  { nom: 'la grille des activites ne voit plus les arcades choisies (serveur)', fichier: 'api/public-availability.js', scenarios: ['E'],
    de: '      const arcadeDeLaGrille = !demandeArrivee && !listeArcadesSansArrivee && heureArcade ? { arcadeTime: heureArcade } : {};', vers: '      const arcadeDeLaGrille = {};' },
  { nom: 'le mot d un probleme revient sous l heure', fichier: JS, scenarios: ['E'],
    de: "    $('small', chip).textContent = on || prop || e.etat === 'wave' || e.nom ? mot : '';", vers: "    $('small', chip).textContent = mot;" },
  { nom: 'deux problemes d une plage ont la meme teinte', fichier: JS, scenarios: ['E'],
    de: '  function teinteDe(k) { return String(k % TEINTES); }', vers: "  function teinteDe(k) { return '0'; }" },
  { nom: 'une heure a probleme ne prend pas la teinte de sa ligne', fichier: JS, scenarios: ['E'],
    de: '    groupes.forEach(function (g, k) { g.puces.forEach(function (c) { c.dataset.teinte = teinteDe(k); }); });\n', vers: '' },
  { nom: 'les heures a probleme ne sont plus entourees en tirets', fichier: CSS, scenarios: ['E'],
    de: '.fg-chip.is-soft, .fg-chip.is-shift, .fg-chip.is-off { border-style: dashed;', vers: '.fg-chip.is-soft, .fg-chip.is-shift, .fg-chip.is-off { border-style: solid;' },
  { nom: 'le temps libre ne propose plus les arcades', fichier: JS, scenarios: ['F'],
    de: '      if (!dureeArc || arc.startTime || m < dureeArc) return liste;', vers: '      return liste;' },
  { nom: 'le temps libre propose des arcades qui ont deja leur heure', fichier: JS, scenarios: ['F'],
    de: '      if (!dureeArc || arc.startTime || m < dureeArc) return liste;', vers: '      if (!dureeArc || m < dureeArc) return liste;' },
  { nom: 'le minigolf ne couvre plus le temps libre', fichier: JS, scenarios: ['F'],
    de: '        var reste = Math.max(0, ecart - pris);', vers: '        var reste = ecart;' },
  { nom: 'le minigolf couvre un temps ou il ne tient pas (la somme des minutes)', fichier: JS, scenarios: ['F'],
    de: '      if (!trousServeur) {', vers: '      if (true) {' },
  { nom: 'le cadre du temps libre ne se deplie plus', fichier: JS, scenarios: ['F'],
    de: '        if (choix) choix.hidden = !ici;', vers: '        void 0;' },
  { nom: 'l idee des arcades ne les pose plus', fichier: JS, scenarios: ['F'],
    de: "    if (versArcades) { libreOuvert = ''; adaptation = null; state.arcade = versArcades.dataset.libreArcades; chargerPlan(); return; }", vers: '    if (versArcades) return;' },
  { nom: 'la ligne de la partie 2 propose l heure de la partie 1', fichier: JS, scenarios: ['H'],
    de: '        if (kLigne > 1) propose = proposeePartie(a, kLigne, etapes);', vers: '        void proposeePartie;' },
  { nom: 'une heure touchee dans la ligne 2 devient celle de la partie 1', fichier: JS, scenarios: ['H'],
    de: '      if (kOuvert > 1 && !state.laserParts.length) {', vers: '      if (false) {' },
  { nom: 'la piste du laser garde ses heures en changeant de ligne', fichier: JS, scenarios: ['H'],
    de: '    if (state.dispo && (partie(avant) || partie(cle))) majPistes(state.dispo);', vers: '    void partie;' },
  { nom: 'la plage ouverte suit l heure d une autre partie', fichier: JS, scenarios: ['H'],
    de: '    utile = sienne || proposee || utile;', vers: '    void sienne;' },
  { nom: 'une heure complete touchee ne propose plus de venir quand meme', fichier: JS, scenarios: ['I'],
    de: "      if (chip.dataset.state === 'hard' && /^(capacity|resource_conflict)$/.test(chip.dataset.code || '')) proposerQuandMeme(chip);", vers: '      if (false) proposerQuandMeme(chip);' },
  { nom: 'la proposition s affiche sans que le serveur l ait tenue', fichier: JS, scenarios: ['I'],
    de: '      if (!slot || !arcPose || !poseX || (debuts[0] && debuts[0] < T)) { boite.remove(); posterHauteur(); return; }', vers: '      if (!slot) { boite.remove(); posterHauteur(); return; }' },
  { nom: 'la proposition ne dit plus ce que le plan pose apres', fichier: JS, scenarios: ['I'],
    de: "        if (!b || !b.activityId || b.activityId === c.dabord || !/^(bowling_lane|laser_arena)$/.test(b.resourceType || '') || vus[b.activityId + '#' + (b.countIndex || 1)]) return;", vers: "        if (!b || b.activityId !== c.quoi || vus[b.activityId + '#' + (b.countIndex || 1)]) return;" },
  { nom: 'le toucher de la proposition ne pose plus les arcades', fichier: JS, scenarios: ['I'],
    de: "    state.pins = essai.c.pins; state.laserParts = []; state.arcade = essai.c.arcade || ''; adaptation = null;", vers: '    state.pins = essai.c.pins; state.laserParts = []; adaptation = null;' },
  { nom: 'une autre heure complete garde la proposition d avant', fichier: JS, scenarios: ['I'],
    de: "    if ($$('.fg-quand', hourZone).some(function (b) { return b.dataset.pour === idX + '@' + T; })) return;\n    $$('.fg-quand', hourZone).forEach(function (b) { b.remove(); });", vers: "    if ($$('.fg-quand', hourZone).some(function (b) { return b.dataset.pour === idX + '@' + T; })) return;" },
  // La Formule 4 au choix (2026-10-13).
  { nom: 'la demande des heures part sans la variante', fichier: JS, scenarios: ['J'],
    de: " if (choixEnvoye()) q.set('formulaChoice', choixEnvoye()); }", vers: ' }' },
  { nom: 'le blocage part sans la variante', fichier: JS, scenarios: ['J'],
    de: '    if (choixEnvoye()) base.preference.formulaChoice = choixEnvoye();', vers: '    void 0;' },
  { nom: 'toucher une variante ne la choisit pas', fichier: JS, scenarios: ['J'],
    de: "    state.choix = rang > 0 ? liste[rang].id : '';", vers: '    void rang;' },
  { nom: 'les fleches ne passent plus d une variante a l autre', fichier: JS, scenarios: ['J'],
    de: '      choisirVariante(pills[k]);\n      pills[k].focus({ preventScroll: true });', vers: '      void k;' },
  { nom: 'la carte ne dit pas le contenu de la variante choisie', fichier: JS, scenarios: ['J'],
    de: '      if (ul) ul.innerHTML = lignesCarte(avecVariante(f));', vers: '      void ul;' },
  { nom: 'une autre formule garde la variante', fichier: JS, scenarios: ['J'],
    de: "    if (state.choix) { state.choix = ''; majVariantes(); }", vers: '    void 0;' },
  { nom: 'le recapitulatif dit le contenu de la carte', fichier: JS, scenarios: ['J'],
    de: '    return f ? avecVariante(f) : null;', vers: '    return f;' },
  { nom: 'les variantes ne sont plus des pastilles d option', fichier: JS, scenarios: ['J'],
    de: "        return '<button type=\"button\" class=\"fg-pill' + (on ? ' is-on' : '') + '\" role=\"radio\" aria-checked=\"' + on + '\" tabindex=\"' + (on ? '0' : '-1') + '\" data-choix-for=\"'",
    vers: "        return '<button type=\"button\" class=\"fg-choix' + (on ? ' is-on' : '') + '\" role=\"radio\" aria-checked=\"' + on + '\" tabindex=\"' + (on ? '0' : '-1') + '\" data-choix-for=\"'" },
  { nom: 'le serveur ne lit plus la variante demandee', fichier: 'api/public-availability.js', scenarios: ['J'],
    de: '      const variante = varianteDemandee(formuleId, choixFormule);', vers: '      const variante = null;' },
  { nom: 'le moteur ignore la variante de la demande', fichier: 'lib/ops-engine.js', scenarios: ['J'],
    de: '  const avecChoix = formuleAvecChoix(rawFormula, varianteDemandee(rawFormula && rawFormula.id, preference.formulaChoice));', vers: '  const avecChoix = rawFormula;' },
  { nom: 'la fiche (i) dit la carte, pas la variante choisie', fichier: JS, scenarios: ['J'],
    de: 'actualisationInfo.innerHTML = htmlInfoFormule(avecVariante(formuleInfo));', vers: 'actualisationInfo.innerHTML = htmlInfoFormule(formuleInfo);' },
  { nom: 'le choix d une variante ne se dit pas', fichier: JS, scenarios: ['J'],
    de: "    dire(f.name + ', avec ' + liste[rang].label + '.');", vers: '    void 0;' },
  { nom: 'la copie du panier oublie la variante', fichier: JS, scenarios: ['J'],
    de: 'formuleId: state.formuleId, choix: state.choix };', vers: 'formuleId: state.formuleId };' },
  { nom: 'une carte vers une autre formule garde la variante de la premiere', fichier: JS, scenarios: ['J'],
    de: "if (carte.formuleId !== c.formuleId) c.choix = ''; ", vers: '' },
  { nom: 'le panier propose se juge avec la variante du moment', fichier: JS, scenarios: ['J'],
    de: "state.formuleId = c.formuleId; state.choix = c.choix || '';\n    try { return fn(); }", vers: 'state.formuleId = c.formuleId;\n    try { return fn(); }' },
  { nom: 'le panier accepte garde l ancienne variante', fichier: JS, scenarios: ['J'],
    de: "state.formuleId = c.formuleId; state.choix = c.choix || '';\n    majVariantes();", vers: 'state.formuleId = c.formuleId;\n    majVariantes();' },
  // Les variantes que le centre ou le jour ne jouent pas ([K]).
  { nom: 'une formule dont la carte manque au centre disparait, ses arcades avec', fichier: JS, scenarios: ['K'],
    de: 'return variantesDe(f).length ? variantesDuCentre(f).length > 0 : !manqueAuCentre(f);', vers: 'return !manqueAuCentre(f);' },
  { nom: 'le centre ne retire plus les variantes qu il ne joue pas', fichier: JS, scenarios: ['K'],
    de: 'function variantesDuCentre(f) { return variantesDe(f).filter(function (c) { return !manqueAuCentre(c); }); }', vers: 'function variantesDuCentre(f) { return variantesDe(f); }' },
  { nom: 'le jour ne retire plus les variantes qu il bloque', fichier: JS, scenarios: ['K'],
    de: '    return variantesDuCentre(f).filter(function (c) { return refusees.indexOf(c.id) < 0; });', vers: '    return variantesDuCentre(f);' },
  { nom: 'la Formule 4 se grise des que sa carte ne se joue pas', fichier: JS, scenarios: ['K'],
    de: 'if (variantesDe(f).length ? !variantesOffertes(f).length : (j.unavailableFormulaIds || []).indexOf(f.id) >= 0)', vers: 'if ((j.unavailableFormulaIds || []).indexOf(f.id) >= 0)' },
  { nom: 'une seule variante jouable se propose en pastille', fichier: JS, scenarios: ['K'],
    de: "(v.ok && variantesOffertes(f).length > 1 ? rendreVariantes(f) : '')", vers: "(v.ok && variantesDe(f).length > 1 ? rendreVariantes(f) : '')" },
  // Une variante que le serveur refuse ([L]).
  { nom: 'le serveur sert la carte a une variante qu il ne declare pas', fichier: 'api/public-availability.js', scenarios: ['L'],
    de: '      if (choixInconnu(formuleId, choixFormule)) {', vers: '      if (false) {' },
  { nom: 'les heures refusees gardent la variante inconnue', fichier: JS, scenarios: ['L'],
    de: "if (j && j.code === 'formula_choice_unavailable' && oublierVariante()) {", vers: 'if (false) {' },
  { nom: 'le blocage refuse la variante sans le dire', fichier: JS, scenarios: ['L'],
    de: "        if (res.statut === 409 && x.code === 'formula_choice_unavailable') return { refus: true, message: x.message || '', code: x.code };\n", vers: '' },
  { nom: 'le blocage refuse garde la variante', fichier: JS, scenarios: ['L'],
    de: "        if (r.code === 'formula_choice_unavailable' && oublierVariante()) { variantePerdue(r.message); return; }\n", vers: '' },
  { nom: 'la confirmation refusee garde la variante', fichier: JS, scenarios: ['L'],
    de: "        if (res.status === 409 && res.json.code === 'formula_choice_unavailable') {", vers: '        if (false) {' },
  { nom: 'la confirmation refusee laisse le recapitulatif de la variante', fichier: JS, scenarios: ['L'],
    de: "          erreurEnvoi('');\n          aller('heures', true);\n          variantePerdue(res.json.message);", vers: "          erreurEnvoi('');\n          variantePerdue(res.json.message);" },
  { nom: 'la confirmation refusee revient aux heures sans les redemander', fichier: JS, scenarios: ['L'],
    de: "          aller('heures', true);\n          variantePerdue(res.json.message);\n          return;", vers: "          aller('heures', true);\n          return;" },
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
function lisible(v) {
  if (typeof v === 'string') return norm(v);
  if (Array.isArray(v)) return v.map(lisible);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lisible(x)]));
  return v;
}
const params = (u) => new URL(u, BASE_URL).searchParams;
const estListeArcades = (u) => params(u).get('arcades') === '1';
// La liste de la ligne « Heure d'arrivée » (arrivees=1, 2026-10-21) n est pas un plan.
const estPlan = (u) => !params(u).has('arrivals') && !params(u).has('arrivees') && !estListeArcades(u);
const sansDoublons = (liste) => liste.filter((x, i) => liste.indexOf(x) === i);
const minutesDe = (h) => { const [a, b] = String(h || '').split(':').map(Number); return a * 60 + b; };
const heureDe = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const posees = (u) => { try { return JSON.parse(params(u).get('preferredTimes') || '{}'); } catch (error) { return {}; } };
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
// scenario ; le formulaire casse (contre-epreuve) est servi a la place de
// celui du depot.
// ---------------------------------------------------------------------------
let reglage = REGLAGE;   // le reglage de la meta (null : la cle absente)
// La meta du scenario ([K], [L]), retouchee par le vrai code du serveur : un
// centre sans laser, un jour bloque, une variante que le serveur ne declare
// pas. null : la meta du serveur de dev telle quelle.
let retoucheMeta = null;
// Un refus de la variante, une fois ([L]) : le chemin du blocage ou de la
// reservation qui repond 409 formula_choice_unavailable. '' : aucun.
let refusUnique = '';
function semer(mock) {
  mock.blocagesDev.clear();
  mock.occupationDev.length = 0;
  mock.blocsDev.length = 0;
  mock.dernierePose.body = null;
  mock.dernierePose.blocages.length = 0;
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
    if (url.pathname === `/${JS}` && MUTATION && MUTATION.fichier === JS) {
      const corps = muter(fs.readFileSync(path.join(ROOT, JS), 'utf8'), MUTATION);
      direPreuve();
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
          if (j && retoucheMeta) retoucheMeta(j);
          return fin(JSON.stringify(j), ...reste);
        } catch (error) {
          return fin(corps, ...reste);
        }
      };
    }
    // LE REFUS DE LA VARIANTE, une fois ([L]) : le blocage ou la reservation
    // repond comme le serveur pour une variante qu il ne declare plus. Une
    // liberation d horaires passe au serveur de dev, telle quelle.
    if (refusUnique && req.method === 'POST' && url.pathname === refusUnique) {
      let corps = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { corps += c; });
      req.on('end', () => {
        let lu = null;
        try { lu = JSON.parse(corps); } catch (error) { lu = null; }
        if (lu && lu.release === true) {
          base.emit('request', Object.assign(Readable.from([Buffer.from(corps)]), { url: req.url, method: req.method, headers: req.headers }), res);
          return;
        }
        refusUnique = '';
        const { CODE_CHOIX_INCONNU, MESSAGE_CHOIX_INCONNU } = require('../lib/formula-choice');
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, code: CODE_CHOIX_INCONNU, message: MESSAGE_CHOIX_INCONNU }));
      });
      return;
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
async function calme(page) {
  await attendre(page, () => !document.querySelector('#hourZone.is-busy') && !document.querySelector('.fg-chip.is-pending'), 15000);
  await page.waitForTimeout(350);
}
// `avantHeures` : ce que le scenario fait sur la carte choisie, avant
// « Continuer » (le choix d une variante, [J]).
async function versHeures(page, mock, formuleId, avantHeures = null) {
  await versFormules(page, mock);
  return versLesHeures(page, formuleId, avantHeures);
}
// Jusqu aux cartes des formules : le jour, le groupe, l onglet. Vrai quand
// les cartes sont la.
async function versFormules(page, mock) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  await page.click('#dayBtn');
  // Le pointeur quitte la grille : a 560 px et moins, le calendrier s ouvre au
  // milieu de l ecran, sous l endroit du bouton (voir l ancien gate).
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
  return attendre(page, () => !document.querySelector('#panelFor').hidden && document.querySelectorAll('#gridFor .fg-card').length > 0, 5000);
}
// La carte choisie, ce que le scenario y fait, puis l ecran des heures.
async function versLesHeures(page, formuleId, avantHeures = null) {
  await page.click(`#gridFor .fg-card[data-formule="${formuleId}"]`);
  await page.waitForTimeout(250);
  if (avantHeures) await avantHeures();
  await page.click('#goHours');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 8000);
  const pret = await attendre(page, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone.is-busy'), 15000);
  await calme(page);
  return pret;
}
// Le programme, ligne par ligne : la cle, sa classe, l heure dite, le detail.
async function lireProgramme(page) {
  return lisible(await page.evaluate(() => {
    const t = (n) => (n ? n.textContent : '');
    const ol = document.querySelector('#hourZone .fg-etapes');
    if (!ol) return { lignes: [] };
    return {
      lignes: [...ol.children].map((li) => {
        const tete = li.querySelector('.fg-etape__tete');
        const heure = li.querySelector('.fg-etape__heure');
        return {
          cle: li.dataset.cle || '',
          classe: li.className,
          cache: li.getAttribute('aria-hidden') === 'true',
          tete: Boolean(tete),
          detail: t(li.querySelector('.fg-etape__quoi small')),
          heure: heure ? (heure.dataset.mot || t(heure)) : '',
          ouverte: li.classList.contains('is-open'),
          taille: heure ? parseFloat(getComputedStyle(heure).fontSize) : 0,
        };
      }),
    };
  }));
}
const ligneDe = (programme, cle) => ((programme && programme.lignes) || []).find((l) => l.cle === cle) || null;
// L ARRIVEE EN TETE DU PROGRAMME (2026-10-21) : une ligne qui se choisit,
// facultative, qui dit toujours l arrivee du plan (choisie ou proposee).
const borneArrivee = (programme) => ((programme && programme.lignes) || []).find((l) => l.cle === 'arrivee' && /fg-etape--arrivee/.test(l.classe)) || null;
// La premiere ligne d activite, sous celle de l arrivee.
const premiereActivite = (programme) => ((programme && programme.lignes) || []).find((l) => l.cle && l.cle !== 'arrivee') || {};
const resumeLignes = (programme) => ((programme && programme.lignes) || []).map((l) => `${l.cle || l.classe.replace(/\bfg-etape\b\s*/g, '').trim()}:${l.heure}`).join(' | ');
async function lireVisite(page) {
  return lisible(await page.evaluate(() => {
    const t = (n) => (n ? n.textContent : '');
    const zone = document.querySelector('#planZone');
    return {
      etapes: zone ? [...zone.querySelectorAll('.fg-visit__step')].map((li) => ({ b: t(li.querySelector('b')), titre: t(li.querySelector('span')), detail: t(li.querySelector('small')), genre: li.className })) : [],
      attentes: zone ? [...zone.querySelectorAll('.fg-visit__gap')].map((li) => ({ texte: t(li), libre: li.classList.contains('fg-visit__gap--libre') })) : [],
    };
  }));
}
// Les groupes sans heure de la visite, dans l ordre : « Entre les deux » (un
// trou ou le serveur range une activite libre tout entiere) et « Dans la
// foulée » (apres la derniere activite a heure), chacun avec ses lignes.
async function lireSuites(page) {
  return lisible(await page.evaluate(() => [...document.querySelectorAll('#planZone .fg-visit__suite')].map((li) => ({
    trou: li.classList.contains('fg-visit__suite--trou'),
    groupe: ((li.querySelector('.fg-visit__group') || {}).textContent || ''),
    lignes: [...li.querySelectorAll('.fg-visit__step')].map((s) => s.textContent || ''),
  }))));
}
async function lirePuces(page, piste) {
  return lisible(await page.evaluate((id) => [...document.querySelectorAll(`.fg-track[data-activity="${id}"] .fg-chip`)].map((c) => ({
    time: c.dataset.time, ok: c.dataset.ok, etat: c.dataset.state || '', mot: c.dataset.mot || '',
    on: c.classList.contains('is-on'), prop: c.classList.contains('is-proposed'),
    ecrit: ((c.querySelector('small') || {}).textContent || '').trim(),
  })), piste));
}
async function lirePourquoi(page, piste) {
  return lisible(await page.evaluate((id) => [...document.querySelectorAll(`.fg-track[data-activity="${id}"] .fg-why-list__item`)].map((li) => ({
    etat: li.dataset.etat || '', heures: String(li.dataset.heures || '').split(' ').filter(Boolean),
    texte: (li.querySelector('span') || {}).textContent || '',
  })), piste));
}
const pourquoiDe = (lignes, heure) => (lignes || []).find((l) => l.heures.includes(heure)) || null;
async function lireLibres(page) {
  return lisible(await page.evaluate(() => [...document.querySelectorAll('#planZone .fg-visit__gap--libre')].map((li) => ({
    quoi: ((li.querySelector('.fg-libre__quoi') || {}).textContent || ''),
    ouvert: li.classList.contains('is-open'),
    choixCache: Boolean((li.querySelector('.fg-libre__choix') || {}).hidden),
    actions: [...li.querySelectorAll('.fg-libre__action')].map((b) => ({ arcades: b.dataset.libreArcades || '', titre: (b.querySelector('b') || {}).textContent || '', detail: (b.querySelector('small') || {}).textContent || '' })),
  }))));
}
// [J] LES HEURES QUI POSENT PROBLEME : plus de mot sous l heure (seuls
// « choisi », « proposé » et le nom d une partie s ecrivent), un contour en
// tirets de la teinte de la ligne qu elle pointe, une teinte par ligne dans
// une plage. Lu au repos : les transitions de couleur figees le temps de la
// lecture.
async function problemesEnCouleur(page, label) {
  await attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity), 5000);
  const r = await page.evaluate(() => {
    const fautes = [];
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
async function ouvrirLigne(page, cle) {
  const ouverte = await page.evaluate((c) => { const l = document.querySelector(`#hourZone .fg-etape[data-cle="${c}"]`); return Boolean(l && l.classList.contains('is-open')); }, cle);
  if (!ouverte) await page.click(`#hourZone .fg-etape[data-cle="${cle}"] .fg-etape__tete`);
  await page.waitForTimeout(450);
}
async function ouvrirArcades(page) {
  await ouvrirLigne(page, 'arcade_time');
  const chargee = await attendre(page, () => document.querySelectorAll('.fg-track[data-activity="arcade_time"] .fg-chip').length > 0, 20000);
  await calme(page);
  return chargee;
}
// Une heure posee au doigt, sa plage ouverte, puis le plan qui revient.
async function poser(page, piste, heure) {
  await ouvrirPlage(page, piste, heure);
  const pris = await toucher(page, piste, heure);
  await calme(page);
  return pris;
}
// La derniere demande du plan (ni liste d arcades, ni liste d arrivees).
const dernierPlan = (suivi) => [...suivi.demandes].reverse().find(estPlan) || '';
// Le blocage parti apres les `n` premiers, attendu un instant ; sinon le
// dernier (le meme choix deja bloque ne repart pas).
async function blocageAttendu(suivi, n, ms = 8000) {
  const fin = Date.now() + ms;
  while (suivi.blocages.length <= n && Date.now() < fin) await new Promise((r) => setTimeout(r, 100));
  return suivi.blocages[suivi.blocages.length - 1] || null;
}

// ---------------------------------------------------------------------------
// [A] SANS HEURE D ARCADE CHOISIE, RIEN NE PART DE PLUS
// ---------------------------------------------------------------------------
async function parcoursSimple(browser, mock, reglageMeta) {
  reglage = reglageMeta;
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser);
  const r = { suivi, poses: [] };
  try {
    r.arrive = await versHeures(page, mock, 'f1');
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
  }
  return r;
}
async function scenarioA(browser, mock) {
  section('A. SANS HEURE D ARCADE CHOISIE, RIEN NE PART DE PLUS');
  const sans = await parcoursSimple(browser, mock, null);
  const avec = await parcoursSimple(browser, mock, REGLAGE);
  const coupe = await parcoursSimple(browser, mock, { ...REGLAGE, arrivalFirst: false });
  const passages = [sans, avec, coupe];
  ok(passages.every((r) => r.arrive && r.poses.length === 2 && r.poses.every(Boolean) && r.contact && r.suivi.erreurs.length === 0),
    'MONTAGE trois passages (meta sans reglage, arrivee proposee, arrivee coupee) : Formule 1, 10 personnes, bowling 14:00 puis laser 16:00, puis les coordonnees, sans erreur',
    passages.map((r) => `${r.arrive}/${r.poses.join(',')}/${r.contact}/${r.suivi.erreurs.slice(0, 1).join('')}`).join(' ; '));
  const demandes = passages.map((r) => sansDoublons(r.suivi.demandes.map((u) => { const p = params(u); p.delete('_'); return p.toString(); })));
  const parasites = passages.flatMap((r) => r.suivi.demandes).filter((u) => ['arrival', 'arrivals', 'arrivees', 'arcade', 'arcades'].some((k) => params(u).has(k)));
  ok(parasites.length === 0, 'aucune demande ne porte arrival, arrivals, arrivees, arcade ni arcades (la ligne d arrivee restee fermee ne demande rien)', parasites.slice(0, 2).join(' | '));
  ok(!ecartListes(demandes[0], demandes[1]) && !ecartListes(demandes[0], demandes[2]), 'les demandes sont les memes au caractere pres, que la meta propose l arrivee ou non', ecartListes(demandes[0], demandes[1]) || ecartListes(demandes[0], demandes[2]));
  const blocages = passages.map((r) => r.suivi.blocages[r.suivi.blocages.length - 1] || null);
  ok(blocages.every((b) => b && b.preference && !('arrivalTime' in b.preference) && !('arcadeTime' in b.preference)) && new Set(blocages.map(corpsComparable)).size === 1,
    'le blocage part sans arrivalTime ni arcadeTime, le meme dans les trois passages', JSON.stringify(blocages[0] && blocages[0].preference));
  const p = avec.programme;
  // LA REGLE DU 2026-10-21 (Movsar : « ils ont le choix de choisir l heure
  // qu ils veulent ») : l arrivee se choisit dans sa ligne, en tete, facultative.
  // Fermee, elle dit l arrivee du plan, proposee ; aucune autre ligne ne
  // l attend (la premiere activite s ouvre) ; plus aucune borne d arrivee.
  const borne = borneArrivee(p);
  const ouvertes = (p.lignes || []).filter((l) => l.ouverte).map((l) => l.cle);
  ok(Boolean(borne) && p.lignes[0] === borne && !borne.cache && borne.tete && !borne.ouverte && /\bis-propose\b/.test(borne.classe) && borne.detail === 'Facultatif' && /^\d\d:\d\d$/.test(borne.heure)
    && ouvertes.length === 1 && ouvertes[0] === premiereActivite(p).cle && !(p.lignes || []).some((l) => /fg-etape--borne/.test(l.classe) && /fg-etape--arrivee/.test(l.classe)),
  'l arrivee est la premiere ligne, a toucher, fermee et « Facultatif », avec l heure du plan proposee ; la premiere activite s ouvre, aucune borne d arrivee ne reste', resumeLignes(p));
}

// ---------------------------------------------------------------------------
// [B] LA BORNE A L OUVERTURE
// ---------------------------------------------------------------------------
async function scenarioB(browser, mock) {
  section('B. LA BORNE A L OUVERTURE');
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    const p = await lireProgramme(page);
    const bowling = ligneDe(p, 'bowling') || {};
    const v = await lireVisite(page);
    const arr = v.etapes.find((e) => e.titre === 'Arrivée conseillée') || {};
    ok(arrive && bowling.heure === '10:00' && (borneArrivee(p) || {}).heure === '10:00' && arr.b === '10:00' && arr.detail === 'à l’ouverture',
      'la Formule 1 proposee a l ouverture (bowling 10:00) : la borne dit 10:00, la visite « Arrivée conseillée 10:00, à l’ouverture »', `${resumeLignes(p)} || ${JSON.stringify(arr)}`);
    const pris = await poser(page, 'bowling', '10:30');
    const p2 = await lireProgramme(page);
    const v2 = await lireVisite(page);
    const arr2 = v2.etapes.find((e) => e.titre === 'Arrivée conseillée') || {};
    ok(pris && (borneArrivee(p2) || {}).heure === '10:20' && arr2.b === '10:20' && arr2.detail === '10 min avant votre bowling',
      'le bowling pose a 10:30 : la borne dit 10:20, « 10 min avant votre bowling »', `${resumeLignes(p2)} || ${JSON.stringify(arr2)}`);
  } finally {
    ok(suivi.erreurs.length === 0, '[B] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [C] LA LIGNE DES ARCADES, FACULTATIVE
// ---------------------------------------------------------------------------
async function scenarioC(browser, mock) {
  section('C. LA LIGNE DES ARCADES, FACULTATIVE');
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    const p = await lireProgramme(page);
    const arc = ligneDe(p, 'arcade_time') || {};
    const bowling = ligneDe(p, 'bowling') || {};
    ok(arrive && arc.heure === 'Facultatif' && /\bis-libre\b/.test(arc.classe) && arc.detail === '30 min · comprises · quand vous voulez' && !arc.ouverte,
      'la Formule 1 a sa ligne des arcades : « Facultatif », « 30 min · comprises · quand vous voulez », fermee', JSON.stringify(arc));
    ok(arc.taille > 0 && bowling.taille > 0 && arc.taille < bowling.taille, `« Facultatif » se lit en petit, plus petit qu une heure (${arc.taille} px contre ${bowling.taille} px)`);
    for (const [id, heure] of [['bowling', '14:00'], ['laser_game', '16:00']]) {
      await poser(page, id, heure);
    }
    const p2 = await lireProgramme(page);
    const ouvertes = p2.lignes.filter((l) => l.ouverte).map((l) => l.cle);
    ok(ouvertes.length === 0, 'le bowling et le laser poses, plus rien ne s ouvre : les arcades attendent qu on les ouvre', `ouvertes : ${ouvertes.join(', ')}`);
    ok(suivi.demandes.filter(estListeArcades).length === 0, 'aucune heure d arcade ne se demande avant l ouverture de leur ligne', suivi.demandes.filter(estListeArcades).slice(0, 1).join(''));
    const chargee = await ouvrirArcades(page);
    const liste = suivi.demandes.filter(estListeArcades);
    const derniere = liste[liste.length - 1] || '';
    ok(chargee && liste.length >= 1 && !params(derniere).has('arrival') && !params(derniere).has('arcade') && posees(derniere).bowling === '14:00',
      'leur ligne ouverte, la liste part (arcades=1), sans arrivee ni heure d arcade, avec les heures posees', derniere);
    const puces = await lirePuces(page, 'arcade_time');
    const heures = puces.map((x) => x.time);
    ok(heures[0] === '10:00' && heures.every((h) => minutesDe(h) % 30 === 0), `leurs heures partent de l ouverture (10:00), demi-heure par demi-heure (${heures.length} heures)`, heures.slice(0, 4).join(', '));
    const p1400 = puces.find((x) => x.time === '14:00') || {};
    const p1300 = puces.find((x) => x.time === '13:00') || {};
    const pourquoi = await lirePourquoi(page, 'arcade_time');
    const ligne1400 = pourquoiDe(pourquoi, '14:00') || {};
    ok(p1400.etat === 'shift' && p1400.ok === 'true' && /^Votre bowling \(14:00\) se replacera autour de vos arcades\.?$/.test(ligne1400.texte || '') && p1300.etat === 'ok' && !p1300.ecrit,
      'arcades a 14:00, sur le bowling pose : elles le decalent, et la ligne le dit ; a 13:00, rien ne coince, aucun mot', JSON.stringify({ p1400, ligne1400, p1300 }));
  } finally {
    ok(suivi.erreurs.length === 0, '[C] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  const quatre = await ouvrir(browser);
  try {
    const arrive4 = await versHeures(quatre.page, mock, 'f4');
    const p4 = await lireProgramme(quatre.page);
    ok(arrive4 && !ligneDe(p4, 'arcade_time') && Boolean(ligneDe(p4, 'bowling')), 'la Formule 4 et le contenu de sa carte (deux parties de laser, sans arcades) : pas de ligne des arcades', resumeLignes(p4));
  } finally {
    ok(quatre.suivi.erreurs.length === 0, '[C] Formule 4 : aucune erreur JavaScript', quatre.suivi.erreurs.slice(0, 3).join(' | '));
    await quatre.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [D] DES ARCADES A 13:00
// ---------------------------------------------------------------------------
async function scenarioD(browser, mock) {
  section('D. DES ARCADES A 13:00');
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    await ouvrirArcades(page);
    const nListes = suivi.demandes.filter(estListeArcades).length;
    const pris = await poser(page, 'arcade_time', '13:00');
    const demande = dernierPlan(suivi);
    ok(arrive && pris && params(demande).get('arcade') === '13:00' && !params(demande).has('arrival'), 'la demande du plan porte arcade=13:00, sans arrivee', demande);
    const p = await lireProgramme(page);
    const premiere = premiereActivite(p);
    ok((borneArrivee(p) || {}).heure === '12:50' && premiere.cle === 'arcade_time' && premiere.heure === '13:00' && /\bis-choisi\b/.test(premiere.classe) && (ligneDe(p, 'bowling') || {}).heure === '13:30',
      'la borne dit 12:50, la ligne des arcades passe en tete (13:00, choisie), le bowling se propose a 13:30', resumeLignes(p));
    const v = await lireVisite(page);
    const arr = v.etapes.find((e) => e.titre === 'Arrivée conseillée') || {};
    const arcades = v.etapes.find((e) => e.b === '13:00' && /arcade/i.test(e.titre)) || {};
    ok(arr.b === '12:50' && arr.detail === '10 min avant vos arcades' && /jusqu’à 13:30/.test(arcades.detail || '') && /à votre heure/.test(arcades.detail || ''),
      'la visite : « Arrivée conseillée 12:50, 10 min avant vos arcades », puis les arcades de 13:00 a 13:30, a votre heure', JSON.stringify({ arr, arcades }));
    // Le bowling pose a 14:00 change les heures posees : la liste des arcades
    // se relit a leur ouverture, sans l heure choisie (elle n en depend pas).
    const bowling = await poser(page, 'bowling', '14:00');
    await ouvrirArcades(page);
    const listes = suivi.demandes.filter(estListeArcades).slice(nListes);
    ok(bowling && listes.length >= 1 && posees(listes[listes.length - 1]).bowling === '14:00' && listes.every((u) => !params(u).has('arcade')) && params(dernierPlan(suivi)).get('arcade') === '13:00',
      'le bowling pose a 14:00, la liste des heures d arcade se relit sans l heure choisie ; le plan, lui, la garde (13:00)', listes.slice(-1).join(''));
    // Retouchee, l heure se retire : les arcades redeviennent facultatives.
    await poser(page, 'arcade_time', '13:00');
    const retire = dernierPlan(suivi);
    const pR = await lireProgramme(page);
    ok(!params(retire).has('arcade') && (ligneDe(pR, 'arcade_time') || {}).heure === 'Facultatif', 'retouchee, l heure d arcade se retire : la demande repart sans elle, la ligne redit « Facultatif »', `${retire} || ${resumeLignes(pR)}`);
    await ouvrirArcades(page);
    await poser(page, 'arcade_time', '13:00');
    const nB = suivi.blocages.length;
    await page.click('#goContact');
    const contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 12000);
    const bloc = await blocageAttendu(suivi, nB);
    ok(contact && Boolean(bloc && bloc.preference) && bloc.preference.arcadeTime === '13:00' && !('arrivalTime' in bloc.preference),
      'le blocage part avec les arcades (13:00), sans heure d arrivee', JSON.stringify(bloc && bloc.preference));
    const rappel = lisible(await page.evaluate(() => (document.querySelector('#recallBody') || {}).textContent || ''));
    ok(/Arrivée conseillée à 12:50/.test(rappel), 'le recapitulatif dit « Arrivée conseillée à 12:50 »', rappel.slice(0, 200));
  } finally {
    ok(suivi.erreurs.length === 0, '[D] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [E] LE DERNIER CHOIX GAGNE
// ---------------------------------------------------------------------------
async function scenarioE(browser, mock) {
  section('E. LE DERNIER CHOIX GAGNE');
  semer(mock);
  const un = await ouvrir(browser);
  try {
    const arrive = await versHeures(un.page, mock, 'f1');
    const pose = await poser(un.page, 'bowling', '14:00');
    await ouvrirArcades(un.page);
    const pris = await poser(un.page, 'arcade_time', '14:00');
    const demande = dernierPlan(un.suivi);
    const p = await lireProgramme(un.page);
    ok(arrive && pose && pris && params(demande).get('arcade') === '14:00' && !posees(demande).bowling && (ligneDe(p, 'arcade_time') || {}).heure === '14:00' && (ligneDe(p, 'bowling') || {}).heure !== '14:00',
      'des arcades a 14:00 sur le bowling pose : le bowling se libere (la demande ne le pose plus), le serveur le replace ailleurs', `${demande} || ${resumeLignes(p)}`);
    const v = await lireVisite(un.page);
    const bowling = v.etapes.find((e) => /bowling/i.test(e.titre)) || {};
    ok(/replacé autour de vos arcades \(14:00\)/.test(bowling.detail || ''), 'la visite dit le bowling « replacé autour de vos arcades (14:00) »', JSON.stringify(bowling));
  } finally {
    ok(un.suivi.erreurs.length === 0, '[E] aucune erreur JavaScript (arcades sur le bowling)', un.suivi.erreurs.slice(0, 3).join(' | '));
    await un.ctx.close();
  }
  const deux = await ouvrir(browser);
  try {
    const arrive = await versHeures(deux.page, mock, 'f1');
    await ouvrirArcades(deux.page);
    await poser(deux.page, 'arcade_time', '13:00');
    // Le bowling pose a 15:00 : la grille du laser porte deux problemes dans
    // l apres-midi, les arcades (13:00) et le bowling (15:00), deux lignes de
    // deux teintes.
    const bowling15 = await poser(deux.page, 'bowling', '15:00');
    await ouvrirLigne(deux.page, 'laser_game');
    await ouvrirPlage(deux.page, 'laser_game', '13:00');
    const lasers = await lirePuces(deux.page, 'laser_game');
    const l1300 = lasers.find((x) => x.time === '13:00') || {};
    const l1500 = lasers.find((x) => x.time === '15:00') || {};
    ok(arrive && bowling15 && l1300.etat === 'shift' && l1500.etat === 'shift', 'MONTAGE arcades 13:00 et bowling 15:00 : le laser a 13:00 decale les arcades, a 15:00 le bowling', JSON.stringify({ l1300, l1500 }));
    const couleurs = await problemesEnCouleur(deux.page, 'arcades a 13:00 et bowling a 15:00, la grille du laser');
    ok(couleurs.deuxLignes >= 1, `[J] une plage au moins porte deux lignes (${couleurs.deuxLignes}) : leurs teintes se comparent`);
    await ouvrirLigne(deux.page, 'bowling');
    await ouvrirPlage(deux.page, 'bowling', '13:00');
    const puces = await lirePuces(deux.page, 'bowling');
    const b1230 = puces.find((x) => x.time === '12:30') || {};
    const b1300 = puces.find((x) => x.time === '13:00') || {};
    const ligne = pourquoiDe(await lirePourquoi(deux.page, 'bowling'), '13:00') || {};
    ok(b1230.etat === 'shift' && b1300.etat === 'shift' && b1300.ok === 'true' && /^Vos arcades \(13:00\) se feront à un autre moment\.?$/.test(ligne.texte || ''),
      'arcades a 13:00 : le bowling a 12:30 et 13:00 les decale, se prend, et la ligne dit « Vos arcades (13:00) se feront à un autre moment »', JSON.stringify({ b1230, b1300, ligne }));
    const pris = await poser(deux.page, 'bowling', '13:00');
    const demande = dernierPlan(deux.suivi);
    const p = await lireProgramme(deux.page);
    ok(pris && posees(demande).bowling === '13:00' && !params(demande).has('arcade') && (ligneDe(p, 'arcade_time') || {}).heure === 'Facultatif',
      'le bowling pris a 13:00 leve les arcades : la demande part sans elles, leur ligne redit « Facultatif »', `${demande} || ${resumeLignes(p)}`);
    const v = await lireVisite(deux.page);
    const arcades = v.etapes.find((e) => /arcades/i.test(e.titre) && !e.b) || {};
    ok(/déplacées pour votre bowling à 13:00/.test(arcades.detail || ''), 'la visite dit les arcades « déplacées pour votre bowling à 13:00 »', JSON.stringify(arcades));
  } finally {
    ok(deux.suivi.erreurs.length === 0, '[E] aucune erreur JavaScript (bowling sur les arcades)', deux.suivi.erreurs.slice(0, 3).join(' | '));
    await deux.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [F] LE TEMPS LIBRE QUI PROPOSE LES ARCADES
// ---------------------------------------------------------------------------
async function scenarioF(browser, mock) {
  section('F. LE TEMPS LIBRE QUI PROPOSE LES ARCADES');
  semer(mock);
  const un = await ouvrir(browser);
  try {
    const arrive = await versHeures(un.page, mock, 'f1');
    await poser(un.page, 'bowling', '11:00');
    await poser(un.page, 'laser_game', '12:30');
    const libres = await lireLibres(un.page);
    const cadre = libres[0] || {};
    const idee = (cadre.actions || [])[0] || {};
    ok(arrive && libres.length === 1 && /^30 min de libre/.test(cadre.quoi) && cadre.choixCache && idee.arcades === '12:00' && idee.titre === 'Y faire vos arcades' && idee.detail === 'de 12:00 à 12:30',
      'bowling 11:00, laser 12:30 : la demi-heure libre devient un cadre en pointille, replie, qui propose « Y faire vos arcades, de 12:00 à 12:30 »', JSON.stringify(libres));
    await un.page.click('#planZone [data-libre]');
    await un.page.waitForTimeout(300);
    const ouvert = (await lireLibres(un.page))[0] || {};
    ok(ouvert.ouvert && !ouvert.choixCache, 'touche, le cadre se deplie sur place', JSON.stringify(ouvert));
    await un.page.click('#planZone [data-libre-arcades="12:00"]');
    await calme(un.page);
    const demande = dernierPlan(un.suivi);
    const p = await lireProgramme(un.page);
    const v = await lireVisite(un.page);
    ok(params(demande).get('arcade') === '12:00' && (ligneDe(p, 'arcade_time') || {}).heure === '12:00' && v.etapes.some((e) => e.b === '12:00' && /arcade/i.test(e.titre)) && (await lireLibres(un.page)).length === 0,
      'l idee touchee pose les arcades a 12:00 : la demande, leur ligne et la visite le disent, le cadre disparait', `${demande} || ${resumeLignes(p)}`);
  } finally {
    ok(un.suivi.erreurs.length === 0, '[F] aucune erreur JavaScript', un.suivi.erreurs.slice(0, 3).join(' | '));
    await un.ctx.close();
  }
  // Des arcades qui ont deja leur heure ne se proposent pas ailleurs.
  const deux = await ouvrir(browser);
  try {
    await versHeures(deux.page, mock, 'f1');
    await poser(deux.page, 'bowling', '11:00');
    await poser(deux.page, 'laser_game', '12:30');
    await ouvrirArcades(deux.page);
    const pris = await poser(deux.page, 'arcade_time', '10:30');
    const p = await lireProgramme(deux.page);
    ok(pris && (ligneDe(p, 'arcade_time') || {}).heure === '10:30' && (borneArrivee(p) || {}).heure === '10:20', 'MONTAGE arcades a 10:30, avant le bowling de 11:00 : leur ligne le dit, l arrivee 10:20', resumeLignes(p));
    const libres = await lireLibres(deux.page);
    const v = await lireVisite(deux.page);
    ok(libres.length === 0 && v.attentes.some((a) => /30 min d’attente/.test(a.texte)), 'arcades deja a 10:30 : la demi-heure libre de 12:00 reste une attente, rien a proposer', JSON.stringify({ libres, attentes: v.attentes }));
  } finally {
    ok(deux.suivi.erreurs.length === 0, '[F] aucune erreur JavaScript (arcades deja posees)', deux.suivi.erreurs.slice(0, 3).join(' | '));
    await deux.ctx.close();
  }
  // LE MINIGOLF DE LA FORMULE 2 NE COUVRE QUE LE TEMPS OU IL TIENT TOUT
  // ENTIER (2026-10-15 ; Movsar, la veille : « FIN estimé a 17h et le mini
  // golf se joue quand du coup ? »). Ses 45 min ne tiennent pas dans les 35
  // entre deux parties : il se joue apres, et ces 35 min portent les 30 des
  // arcades. Dans 1 h 05, il se joue « Entre les deux » ; les 20 min qui
  // restent ne portent pas les arcades. Une partie dure 25 min, regles et
  // preparation comprises.
  for (const cas of [{ p1: '10:30', p2: '11:30', tient: false }, { p1: '10:00', p2: '11:30', tient: true }]) {
    const trois = await ouvrir(browser);
    try {
      const arrive = await versHeures(trois.page, mock, 'f2');
      const p0 = await lireProgramme(trois.page);
      const parties = p0.lignes.filter((l) => /^laser_game#/.test(l.cle)).map((l) => l.cle);
      await ouvrirLigne(trois.page, parties[0] || 'laser_game#1');
      await poser(trois.page, 'laser_game', cas.p1);
      await ouvrirLigne(trois.page, parties[1] || 'laser_game#2');
      await poser(trois.page, 'laser_game', cas.p2);
      const demande = dernierPlan(trois.suivi);
      const parts = JSON.parse(params(demande).get('laserGameTimes') || '[]');
      const libres = await lireLibres(trois.page);
      const v = await lireVisite(trois.page);
      const suites = await lireSuites(trois.page);
      const entre = suites.filter((s) => s.trou);
      const foulee = suites.find((s) => !s.trou && /^Dans la foulée/.test(s.groupe)) || { lignes: [] };
      const aLeMinigolf = (s) => s.lignes.some((l) => /Minigolf/.test(l));
      const finP1 = heureDe(minutesDe(cas.p1) + 25);
      const ecart = minutesDe(cas.p2) - minutesDe(finP1);
      ok(arrive && JSON.stringify(parts) === JSON.stringify([cas.p1, cas.p2]), `MONTAGE Formule 2 : les deux parties de laser posees a ${cas.p1} et ${cas.p2}, ${ecart} min entre les deux`, demande);
      if (!cas.tient) {
        ok(!entre.length && aLeMinigolf(foulee), `les 45 min du minigolf ne tiennent pas dans les ${ecart} min entre les deux parties : il se joue « Dans la foulée », jamais « Entre les deux »`, JSON.stringify(suites));
        const action = libres.length === 1 && libres[0].actions.length === 1 ? libres[0].actions[0] : {};
        ok(action.arcades === finP1 && action.detail === `de ${finP1} à ${heureDe(minutesDe(finP1) + 30)}`, `ces ${ecart} min restent libres : le cadre y propose les 30 min d arcades, des ${finP1}`, JSON.stringify({ libres, attentes: v.attentes }));
      } else {
        ok(entre.length === 1 && aLeMinigolf(entre[0]) && !aLeMinigolf(foulee), `le minigolf tient dans les ${ecart} min entre les deux parties : « Entre les deux », plus « Dans la foulée »`, JSON.stringify(suites));
        ok(libres.length === 0 && v.attentes.some((a) => a.texte === `${ecart - 45} min d’attente`), `les ${ecart - 45} min qui restent ne portent pas les 30 min d arcades : une attente, aucun cadre`, JSON.stringify({ libres, attentes: v.attentes }));
      }
    } finally {
      ok(trois.suivi.erreurs.length === 0, `[F] Formule 2, parties a ${cas.p1} et ${cas.p2} : aucune erreur JavaScript`, trois.suivi.erreurs.slice(0, 3).join(' | '));
      await trois.ctx.close();
    }
  }
}

// ---------------------------------------------------------------------------
// [G] AU TELEPHONE (360 PX)
// ---------------------------------------------------------------------------
async function scenarioG(browser, mock) {
  section('G. AU TELEPHONE (360 PX)');
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser, { largeur: 360, hauteur: 780 });
  const posee = () => attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running'), 4000);
  try {
    const arrive = await versHeures(page, mock, 'f1');
    const chargee = await ouvrirArcades(page);
    await posee();
    const m = await page.evaluate(() => {
      const visibles = [...document.querySelectorAll('.fg-track[data-activity="arcade_time"] .fg-chip')].filter((c) => c.getClientRects().length && c.getBoundingClientRect().height > 0);
      const tete = document.querySelector('#hourZone .fg-etape[data-cle="arcade_time"] .fg-etape__tete');
      return {
        n: visibles.length,
        hauteur: Math.min(...visibles.map((c) => c.getBoundingClientRect().height)),
        largeurPuce: Math.min(...visibles.map((c) => c.getBoundingClientRect().width)),
        tete: tete ? tete.getBoundingClientRect().height : 0,
        page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        ecran: window.innerWidth,
      };
    });
    ok(arrive && chargee && m.n > 0, `MONTAGE les heures d arcade s affichent a 360 px (${m.n} visibles)`);
    ok(m.page <= m.ecran, `rien ne deborde a 360 px (${m.page} px de large pour ${m.ecran})`);
    ok(m.hauteur >= 44 && m.largeurPuce >= 44 && m.tete >= 44, `les heures d arcade et leur ligne se touchent du doigt (44 px au moins : puce ${Math.round(m.hauteur)} x ${Math.round(m.largeurPuce)}, ligne ${Math.round(m.tete)})`);
    const forme = await page.evaluate(() => {
      const decrire = (c) => {
        if (!c) return '';
        const lb = c.closest('[role="listbox"]');
        return [c.tagName, c.getAttribute('type'), c.getAttribute('role'), c.hasAttribute('aria-selected'), Boolean(lb && lb.getAttribute('aria-label'))].join('|');
      };
      return { arcades: decrire(document.querySelector('.fg-track[data-activity="arcade_time"] .fg-chip')), bowling: decrire(document.querySelector('.fg-track[data-activity="bowling"] .fg-chip')) };
    });
    ok(Boolean(forme.arcades) && forme.arcades === forme.bowling && forme.arcades.startsWith('BUTTON|button|option|true|true'), 'une heure d arcade est le meme bouton qu une heure de bowling (type, role, aria-selected, liste nommee)', JSON.stringify(forme));
    await page.focus('#hourZone .fg-etape[data-cle="arcade_time"] .fg-etape__tete');
    let focus = null;
    for (let k = 0; k < 20 && !(focus && focus.puce); k += 1) {
      await page.keyboard.press('Tab');
      focus = await page.evaluate(() => {
        const f = document.activeElement;
        const s = f ? getComputedStyle(f) : null;
        return { puce: Boolean(f && f.matches('.fg-track[data-activity="arcade_time"] .fg-chip')), style: s ? s.outlineStyle : '', largeur: s ? parseFloat(s.outlineWidth) || 0 : 0 };
      });
    }
    ok(Boolean(focus && focus.puce) && focus.style !== 'none' && focus.largeur >= 2, 'au clavier, l heure d arcade qui a le focus se voit (contour)', JSON.stringify(focus));
  } finally {
    ok(suivi.erreurs.length === 0, '[G] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [H] UNE HEURE PAR PARTIE DE LASER
// ---------------------------------------------------------------------------
// La fin d une partie dans le dernier plan recu (ses groupes compris), celle
// qui commence a `debut`.
function finDePartie(suivi, debut) {
  const plan = [...suivi.reponses].reverse().find((r) => estPlan(r.url));
  const blocs = ((((plan && plan.json && plan.json.slots) || [])[0] || {}).opsPlan || {}).resourceBlocks || [];
  const laser = blocs.filter((b) => b && b.activityId === 'laser_game');
  const tete = laser.find((b) => b.startTime === debut);
  if (!tete) return '';
  return laser.filter((b) => (Number(b.countIndex) || 1) === (Number(tete.countIndex) || 1)).map((b) => String(b.endTime || '')).sort().pop() || '';
}
// L heure qu une ligne de partie doit proposer : la premiere libre (rien de
// serre) apres la fin de la partie d avant, sans heure deja prise.
const premiereLibreApres = (puces, fin) => (puces.find((c) => c.ok !== 'false' && c.etat === 'ok' && !c.on && minutesDe(c.time) >= minutesDe(fin)) || {}).time || '';
async function plageOuverteDe(page, heure) {
  return page.evaluate((h) => {
    const c = document.querySelector(`.fg-track[data-activity="laser_game"] .fg-chip[data-time="${h}"]`);
    const sec = c && c.closest('.fg-period');
    return Boolean(sec && sec.classList.contains('is-open') && c.getClientRects().length);
  }, heure);
}
async function scenarioH(browser, mock) {
  section('H. UNE HEURE PAR PARTIE DE LASER');
  semer(mock);
  const un = await ouvrir(browser);
  try {
    const arrive = await versHeures(un.page, mock, 'f2');
    const p0 = await lireProgramme(un.page);
    const h1 = (ligneDe(p0, 'laser_game#1') || {}).heure || '';
    const fin1 = finDePartie(un.suivi, h1);
    ok(arrive && /^\d\d:\d\d$/.test(h1) && Boolean(fin1) && (ligneDe(p0, 'laser_game#2') || {}).heure === 'À choisir',
      `MONTAGE Formule 2, rien de pose : la partie 1 proposee a ${h1} (jusqu a ${fin1}), la partie 2 a choisir`, resumeLignes(p0));
    await ouvrirLigne(un.page, 'laser_game#2');
    const puces = await lirePuces(un.page, 'laser_game');
    const proposees = puces.filter((c) => c.prop).map((c) => c.time);
    const attendue = premiereLibreApres(puces, fin1);
    ok(Boolean(attendue) && proposees.length === 1 && proposees[0] === attendue && proposees[0] !== h1,
      `ouverte a la main, la ligne de la partie 2 propose SA premiere heure libre apres la partie 1 (${attendue}), jamais celle de la partie 1 (${h1})`, `proposees ${proposees.join(',') || 'aucune'}`);
    const pris = await poser(un.page, 'laser_game', attendue);
    const parts = JSON.parse(params(dernierPlan(un.suivi)).get('laserGameTimes') || '[]');
    const p1 = await lireProgramme(un.page);
    const l1 = ligneDe(p1, 'laser_game#1') || {};
    const l2 = ligneDe(p1, 'laser_game#2') || {};
    ok(pris && JSON.stringify(parts) === JSON.stringify([h1, attendue]) && l1.heure === h1 && /is-choisi/.test(l1.classe) && l2.heure === attendue && /is-choisi/.test(l2.classe),
      `touchee dans la ligne 2, ${attendue} est l heure de la partie 2 : la partie 1 garde ${h1}, la demande porte les deux`, `${JSON.stringify(parts)} || ${resumeLignes(p1)}`);
  } finally {
    ok(un.suivi.erreurs.length === 0, '[H] aucune erreur JavaScript (ligne 2 ouverte a la main)', un.suivi.erreurs.slice(0, 3).join(' | '));
    await un.ctx.close();
  }
  // L enchainement : la partie 1 posee, la ligne 2 s ouvre seule et propose
  // la suite, sur la plage de cette heure (une partie le matin, la suivante a
  // midi).
  semer(mock);
  const deux = await ouvrir(browser);
  try {
    await versHeures(deux.page, mock, 'f2');
    const pris = await poser(deux.page, 'laser_game', '11:30');
    const fin1 = finDePartie(deux.suivi, '11:30');
    const p = await lireProgramme(deux.page);
    const puces = await lirePuces(deux.page, 'laser_game');
    const attendue = premiereLibreApres(puces, fin1);
    const proposees = puces.filter((c) => c.prop).map((c) => c.time);
    const une = puces.find((c) => c.time === '11:30') || {};
    ok(pris && (ligneDe(p, 'laser_game#2') || {}).ouverte && Boolean(attendue) && proposees.length === 1 && proposees[0] === attendue && une.on && une.ecrit === 'partie 1',
      `la partie 1 posee a 11:30, la ligne 2 s ouvre seule et propose ${attendue} (apres ${fin1}) ; 11:30 s y lit « partie 1 »`, `${resumeLignes(p)} || proposees ${proposees.join(',') || 'aucune'}`);
    ok(await plageOuverteDe(deux.page, attendue), `la plage ouverte dans la ligne 2 est celle de ${attendue}, pas celle de la partie 1`);
  } finally {
    ok(deux.suivi.erreurs.length === 0, '[H] aucune erreur JavaScript (enchainement)', deux.suivi.erreurs.slice(0, 3).join(' | '));
    await deux.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [I] VENIR QUAND MEME
// ---------------------------------------------------------------------------
// Les 8 pistes de bowling prises de 15:00 a `bowlingJusqua`, les 30 places de
// l arene a 15:00 : pour 10 joueurs, le bowling est complet de 14:30 a la fin
// de cette occupation, le laser a 15:00.
const blocDev = (resourceType, activityId, startTime, endTime, extra = {}) => ({ type: 'activity', resourceType, activityId, startTime, endTime, start: minutesDe(startTime), end: minutesDe(endTime), ...extra });
function journeePleineA15h(mock, bowlingJusqua) {
  const minutes = minutesDe(bowlingJusqua) - minutesDe('15:00');
  mock.occupationDev.push({
    id: 1601, centerId: 'libramont', date: mock.DATE, status: 'confirmed', validationStatus: 'confirmed', type: 'bowling', pax: 48,
    startTime: '15:00', duration: minutes / 60, totalDuration: minutes / 60, lanes: [1, 2, 3, 4, 5, 6, 7, 8],
    program: { items: [{ activityId: 'bowling', planned: true, minutes, duration: minutes / 60 }] },
    opsPlan: { startTime: '15:00', endTime: bowlingJusqua, resourceBlocks: [blocDev('bowling_lane', 'bowling', '15:00', bowlingJusqua, { lanes: [1, 2, 3, 4, 5, 6, 7, 8], players: 48, groupPlayers: 48, groupWaveCount: 1 })] },
  }, {
    id: 1602, centerId: 'libramont', date: mock.DATE, status: 'confirmed', validationStatus: 'confirmed', type: 'activite', pax: 30,
    startTime: '15:00', duration: 0.5, totalDuration: 0.5, lanes: [],
    program: { items: [{ activityId: 'laser_game', planned: true, minutes: 30, duration: 0.5, games: 1 }] },
    opsPlan: { startTime: '15:00', endTime: '15:25', resourceBlocks: [blocDev('laser_arena', 'laser_game', '15:00', '15:25', { players: 30, weaponNeed: 30, groupPlayers: 30, groupWaveCount: 1 })] },
  });
}
// Une heure complete touchee au doigt (elle ne se prend pas : elle s explique).
async function toucherComplet(page, piste, heure) {
  await ouvrirLigne(page, piste);
  await ouvrirPlage(page, piste, heure);
  return page.evaluate(({ id, h }) => {
    const c = document.querySelector(`.fg-track[data-activity="${id}"] .fg-chip[data-time="${h}"]`);
    if (!c) return null;
    const etat = { ok: c.dataset.ok, etat: c.dataset.state || '', code: c.dataset.code || '' };
    c.click();
    return etat;
  }, { id: piste, h: heure });
}
async function lireQuand(page) {
  return lisible(await page.evaluate(() => [...document.querySelectorAll('#hourZone .fg-quand')].map((b) => ({
    piste: (b.closest('.fg-track') || { dataset: {} }).dataset.activity || '',
    visible: !b.hidden && b.getClientRects().length > 0,
    dit: (b.querySelector('.fg-quand__dit') || {}).textContent || '',
    titre: (b.querySelector('[data-quand-meme] b') || {}).textContent || '',
    detail: (b.querySelector('[data-quand-meme] small') || {}).textContent || '',
  }))));
}
const quandVisible = (page, piste) => attendre(page, (id) => [...document.querySelectorAll('#hourZone .fg-quand')].some((b) => !b.hidden && (b.closest('.fg-track') || { dataset: {} }).dataset.activity === id), 15000, piste);
// Les demandes de plan parties apres les `n` premieres (l essai de la
// proposition en est une).
const essaisDepuis = (suivi, n) => suivi.demandes.slice(n).filter(estPlan);
async function scenarioI(browser, mock) {
  section('I. VENIR QUAND MEME A UNE HEURE COMPLETE');
  semer(mock);
  journeePleineA15h(mock, '16:00');
  const un = await ouvrir(browser);
  try {
    const arrive = await versHeures(un.page, mock, 'f1');
    const p0 = await lireProgramme(un.page);
    // Le laser complet a 15:00 : les arcades a 15:00, le laser a 15:30, et ce
    // que le serveur pose ensuite (le bowling a 16:00).
    let n = un.suivi.demandes.length;
    const laser15 = await toucherComplet(un.page, 'laser_game', '15:00');
    const vuLaser = await quandVisible(un.page, 'laser_game');
    const qL = await lireQuand(un.page);
    const essaiL = essaisDepuis(un.suivi, n).map((u) => ({ arcade: params(u).get('arcade'), pins: posees(u) }));
    ok(arrive && Boolean(laser15) && laser15.ok === 'false' && laser15.etat === 'hard' && laser15.code === 'capacity',
      'MONTAGE le laser est complet a 15:00 pour 10 joueurs (l arene prise)', JSON.stringify(laser15));
    ok(vuLaser && qL.length === 1 && /^Venir à 15:00 quand même \?/.test(qL[0].dit) && /Vos arcades d’abord, puis le laser game à 15:30 et le bowling à 16:00\./.test(qL[0].dit)
      && qL[0].titre === 'Arcades à 15:00, puis laser game à 15:30' && /^Arrivée à 14:50, fin vers \d\d:\d\d$/.test(qL[0].detail),
      'touche, 15:00 au laser propose de venir quand meme : les arcades a 15:00, le laser a 15:30, puis le bowling a 16:00 (le plan du serveur)', JSON.stringify(qL));
    ok(essaiL.some((e) => e.arcade === '15:00' && e.pins.laser_game === '15:30' && !e.pins.bowling),
      'la proposition vient d un essai au serveur : arcade=15:00 et le laser a 15:30', JSON.stringify(essaiL));
    const pL = await lireProgramme(un.page);
    ok(resumeLignes(pL) === resumeLignes(p0), 'l essai ne change rien a l ecran tant qu il n est pas touche', `${resumeLignes(p0)} || ${resumeLignes(pL)}`);
    // Le bowling complet a 15:00 : sa proposition remplace celle du laser.
    n = un.suivi.demandes.length;
    const bowling15 = await toucherComplet(un.page, 'bowling', '15:00');
    const vuBowling = await quandVisible(un.page, 'bowling');
    const qB = await lireQuand(un.page);
    const essaiB = essaisDepuis(un.suivi, n).map((u) => ({ arcade: params(u).get('arcade'), pins: posees(u) }));
    ok(Boolean(bowling15) && bowling15.ok === 'false' && bowling15.etat === 'hard' && bowling15.code === 'capacity',
      'MONTAGE le bowling est complet a 15:00 (les 8 pistes prises)', JSON.stringify(bowling15));
    ok(vuBowling && qB.length === 1 && qB[0].piste === 'bowling' && /Vos arcades d’abord, puis le bowling à 16:00 et le laser game à \d\d:\d\d\./.test(qB[0].dit)
      && qB[0].titre === 'Arcades à 15:00, puis bowling à 16:00',
      'touche ensuite, 15:00 au bowling remplace la proposition du laser : les arcades a 15:00, puis le bowling a 16:00 et le laser', JSON.stringify(qB));
    ok(essaiB.some((e) => e.arcade === '15:00' && e.pins.bowling === '16:00' && !e.pins.laser_game),
      'son essai part avec arcade=15:00 et le bowling a 16:00', JSON.stringify(essaiB));
    // Le toucher pose ce plan.
    const laserPropose = ((qB[0] || {}).dit.match(/le laser game à (\d\d:\d\d)/) || [])[1] || '';
    await un.page.click('#hourZone .fg-quand [data-quand-meme]');
    await calme(un.page);
    const p1 = await lireProgramme(un.page);
    const premiere = premiereActivite(p1);
    const lb = ligneDe(p1, 'bowling') || {};
    const ll = ligneDe(p1, 'laser_game') || {};
    const reste = await lireQuand(un.page);
    ok(premiere.cle === 'arcade_time' && premiere.heure === '15:00' && /\bis-choisi\b/.test(premiere.classe) && lb.heure === '16:00' && /\bis-choisi\b/.test(lb.classe) && ll.heure === laserPropose && (borneArrivee(p1) || {}).heure === '14:50' && reste.length === 0,
      `touchee, la proposition pose son plan : la borne a 14:50, les arcades a 15:00 et le bowling a 16:00 choisis, le laser a ${laserPropose}`, resumeLignes(p1));
    const nB = un.suivi.blocages.length;
    await un.page.click('#goContact');
    const contact = await attendre(un.page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 12000);
    const bloc = await blocageAttendu(un.suivi, nB);
    const pref = (bloc && bloc.preference) || {};
    ok(contact && pref.arcadeTime === '15:00' && (pref.preferredTimes || {}).bowling === '16:00',
      'le blocage part avec ce plan : les arcades a 15:00, le bowling a 16:00', JSON.stringify(pref));
  } finally {
    ok(un.suivi.erreurs.length === 0, '[I] aucune erreur JavaScript (proposition tenue)', un.suivi.erreurs.slice(0, 3).join(' | '));
    await un.ctx.close();
  }
  // Rien ne tient : le bowling complet jusqu a la fermeture. Au bowling, rien
  // a proposer (aucune heure libre apres) ; au laser, l essai part, mais le
  // serveur ferait jouer le bowling avant 15:00 : la visite ne commencerait
  // pas a 15:00, rien ne s affiche.
  semer(mock);
  journeePleineA15h(mock, '24:00');
  const deux = await ouvrir(browser);
  try {
    await versHeures(deux.page, mock, 'f1');
    let n = deux.suivi.demandes.length;
    const bowling15 = await toucherComplet(deux.page, 'bowling', '15:00');
    await deux.page.waitForTimeout(2500);
    const qB = await lireQuand(deux.page);
    const aQuinze = (u) => params(u).get('arcade') === '15:00';
    ok(Boolean(bowling15) && bowling15.etat === 'hard' && qB.filter((q) => q.visible).length === 0 && essaisDepuis(deux.suivi, n).filter(aQuinze).length === 0,
      'le bowling complet jusqu a la fermeture : 15:00 touche ne propose rien, et aucun essai ne part au serveur', JSON.stringify({ bowling15, qB }));
    n = deux.suivi.demandes.length;
    const laser15 = await toucherComplet(deux.page, 'laser_game', '15:00');
    const fin = Date.now() + 8000;
    while (Date.now() < fin && !essaisDepuis(deux.suivi, n).filter(aQuinze).length) await deux.page.waitForTimeout(100);
    const essaiPart = essaisDepuis(deux.suivi, n).filter(aQuinze).length > 0;
    await calme(deux.page);
    await deux.page.waitForTimeout(1500);
    const qL = await lireQuand(deux.page);
    const essai = [...deux.suivi.reponses].reverse().find((r) => estPlan(r.url) && params(r.url).get('arcade') === '15:00');
    const blocs = ((((essai && essai.json && essai.json.slots) || [])[0] || {}).opsPlan || {}).resourceBlocks || [];
    const avant15 = blocs.filter((b) => b && b.startTime && b.startTime < '15:00').map((b) => `${b.activityId} ${b.startTime}`);
    ok(Boolean(laser15) && laser15.etat === 'hard' && essaiPart && avant15.length > 0,
      'MONTAGE au laser, l essai part et le serveur ferait jouer le bowling avant 15:00', JSON.stringify({ essaiPart, avant15 }));
    ok(qL.filter((q) => q.visible).length === 0, 'la visite ne commencerait pas a 15:00 : rien ne s affiche', JSON.stringify(qL));
  } finally {
    ok(deux.suivi.erreurs.length === 0, '[I] aucune erreur JavaScript (rien ne tient)', deux.suivi.erreurs.slice(0, 3).join(' | '));
    await deux.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [J] LA FORMULE 4 AU CHOIX : 60 MIN D ARCADES A LA PLACE DES DEUX LASERS
// ---------------------------------------------------------------------------
// Les pastilles du choix sous une carte de formule, et la liste de la carte.
async function lireChoix(page, formuleId) {
  return lisible(await page.evaluate((id) => {
    const carte = document.querySelector(`#gridFor .fg-card[data-formule="${id}"]`);
    const item = carte ? carte.closest('.fg-grid__item') : null;
    const voit = (b) => (typeof b.checkVisibility === 'function' ? b.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) : b.getClientRects().length > 0);
    return {
      pastilles: item ? [...item.querySelectorAll('[data-choix]')].map((b) => ({
        id: b.dataset.choix, texte: b.textContent, coche: b.getAttribute('aria-checked') === 'true', on: b.classList.contains('is-on'),
        pastille: b.classList.contains('fg-pill') && b.getAttribute('role') === 'radio', visible: voit(b), focus: document.activeElement === b,
      })) : [],
      carte: item ? [...item.querySelectorAll('.fg-for__list li')].map((li) => li.textContent) : [],
    };
  }, formuleId));
}
const cocheeDe = (choix) => (((choix && choix.pastilles) || []).find((p) => p.coche) || {}).id || '';
const attendreCochee = (page, formuleId, id) => attendre(page, ({ f, c }) => {
  const carte = document.querySelector(`#gridFor .fg-card[data-formule="${f}"]`);
  const b = carte && carte.closest('.fg-grid__item').querySelector(`[data-choix="${c}"]`);
  return Boolean(b && b.getAttribute('aria-checked') === 'true');
}, 4000, { f: formuleId, c: id });
const pastillesVues = (page, formuleId, voulu) => attendre(page, ({ f, v }) => {
  const carte = document.querySelector(`#gridFor .fg-card[data-formule="${f}"]`);
  const b = carte && carte.closest('.fg-grid__item').querySelector('[data-choix]');
  const voit = Boolean(b && (typeof b.checkVisibility === 'function' ? b.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) : b.getClientRects().length > 0));
  return voit === v;
}, 4000, { f: formuleId, v: voulu });
// Les apostrophes droites ou typographiques se valent.
const sansApostrophe = (s) => norm(s).replace(/[’']/g, "'");
const demandesDeLaFormule = (suivi, n, formuleId) => suivi.demandes.slice(n).filter((u) => estPlan(u) && params(u).get('formuleId') === formuleId);
// LA REGLE DU PROGRAMME, pas ses mots : une liste qui dit les arcades et plus
// un mot de laser est celle de la variante ; une ligne de laser, celle de la
// carte.
const ditLeLaser = (lignes) => (lignes || []).some((l) => /laser/i.test(l));
const ditLaVariante = (lignes) => (lignes || []).some((l) => /arcade/i.test(l)) && !ditLeLaser(lignes);
// La carte d une formule : presente, grisee.
const etatCarte = (page, id) => page.evaluate((f) => {
  const c = document.querySelector(`#gridFor .fg-card[data-formule="${f}"]`);
  return { presente: Boolean(c), refus: Boolean(c && c.classList.contains('is-refus')) };
}, id);
// LE PANIER D UNE CARTE « EN PLUS » ET LA VARIANTE, joue a part (sans
// navigateur) : copiePanier, panierDe, avecPanier et appliquerPanier du
// formulaire servi (casse quand la contre-epreuve le casse), sur un etat de
// test. Une carte vers une autre formule repart du contenu de sa carte.
function panierAvecVariante() {
  const vm = require('vm');
  let source = fs.readFileSync(path.join(ROOT, JS), 'utf8');
  if (MUTATION && MUTATION.fichier === JS) { source = muter(source, MUTATION); direPreuve(); }
  source = source.split('\r\n').join('\n');
  const bac = { majs: 0 };
  vm.createContext(bac);
  vm.runInContext("var state = {}, plus = { acceptees: {}, annuler: null, statut: null }; function majVariantes() { majs += 1; } function cleDemande() { return 'cle'; } function creneauAvecDevis(slot, j) { return { slot: slot, reponse: j }; }", bac);
  const manquantes = ['copiePanier', 'panierDe', 'avecPanier', 'appliquerPanier'].filter((nom) => {
    const debut = source.indexOf(`\n  function ${nom}(`);
    const fin = debut < 0 ? -1 : source.indexOf('\n  }\n', debut + 1);
    if (fin < 0) return true;
    vm.runInContext(source.slice(debut + 1, fin + 4), bac);
    return false;
  });
  if (!ok(manquantes.length === 0, 'MONTAGE [J] le panier du formulaire servi, joue a part : copiePanier, panierDe, avecPanier, appliquerPanier', manquantes.join(', '))) return;
  const jouer = (code) => { const r = vm.runInContext(code, bac); return r === undefined ? null : JSON.parse(JSON.stringify(r)); };
  jouer("state = { selection: [], options: {}, attente: null, formuleId: 'f4', choix: 'arcade60' }; null");
  const copie = jouer('copiePanier()');
  const autre = jouer("panierDe({ kind: 'formule', formuleId: 'f5' })");
  const meme = jouer("panierDe({ kind: 'formule', formuleId: 'f4' })");
  const pendant = jouer("avecPanier(Object.assign(copiePanier(), { formuleId: 'f5', choix: 'neuve' }), function () { return [state.formuleId, state.choix]; })");
  const apres = jouer('[state.formuleId, state.choix]');
  jouer("appliquerPanier(Object.assign(copiePanier(), { formuleId: 'f5', choix: 'neuve' }), null, 'recap', 'ok', { slots: [{ time: '14:00' }], price: 0 }, { reponse: { price: 0 } }, ''); null");
  const accepte = jouer('[state.formuleId, state.choix, majs]');
  ok(Boolean(copie) && copie.choix === 'arcade60', '[J] la copie du panier garde la variante choisie', JSON.stringify(copie));
  ok(Boolean(autre && meme) && autre.formuleId === 'f5' && autre.choix === '' && meme.choix === 'arcade60',
    '[J] une carte vers une autre formule repart du contenu de sa carte ; vers la meme, la variante reste', JSON.stringify({ autre, meme }));
  ok(JSON.stringify(pendant) === JSON.stringify(['f5', 'neuve']) && JSON.stringify(apres) === JSON.stringify(['f4', 'arcade60']),
    '[J] le panier propose se juge avec sa propre variante, puis le panier du client revient tel quel', JSON.stringify({ pendant, apres }));
  ok(Array.isArray(accepte) && accepte[0] === 'f5' && accepte[1] === 'neuve' && accepte[2] > 0,
    '[J] le panier accepte devient celui du client, sa variante comprise, et les pastilles se redessinent', JSON.stringify(accepte));
}
async function scenarioJ(browser, mock) {
  section('J. LA FORMULE 4 AU CHOIX : 60 MIN D ARCADES A LA PLACE DES DEUX LASERS');
  panierAvecVariante();
  semer(mock);
  const { ctx, page, suivi } = await ouvrir(browser);
  try {
    const vu = {};
    let nChoix = 0;
    const arrive = await versHeures(page, mock, 'f4', async () => {
      vu.visibles = await pastillesVues(page, 'f4', true);
      vu.depart = await lireChoix(page, 'f4');
      await page.click('#gridFor [data-choix="arcade60"]');
      await attendreCochee(page, 'f4', 'arcade60');
      vu.arcades = await lireChoix(page, 'f4');
      // Le choix se dit (la region vocale, #fgLive), avec le libelle de la
      // variante lu sur sa pastille.
      const libelleArcades = sansApostrophe((((vu.depart || {}).pastilles || []).find((p) => p.id === 'arcade60') || {}).texte || '');
      vu.annonce = Boolean(libelleArcades) && await attendre(page, (l) => ((document.querySelector('#fgLive') || {}).textContent || '').replace(/\s+/g, ' ').replace(/[’']/g, "'").includes(l), 3000, libelleArcades);
      // La fiche (i) de la carte : la formule telle que le client l a choisie.
      await page.click('#gridFor [data-formula-info="f4"]');
      vu.ficheOuverte = await attendre(page, () => { const d = document.querySelector('.fg-info-dialog'); return Boolean(d && d.open); }, 4000);
      vu.fiche = norm(await page.evaluate(() => ((document.querySelector('.fg-info-dialog .fg-info-text') || {}).textContent || '')));
      await page.keyboard.press('Escape');
      await attendre(page, () => !document.querySelector('.fg-info-dialog[open]'), 3000);
      // Une autre formule choisie : la Formule 4 reprise repart de sa carte.
      await page.click('#gridFor .fg-card[data-formule="f1"]');
      vu.cachees = await pastillesVues(page, 'f4', false);
      await page.click('#gridFor .fg-card[data-formule="f4"]');
      await pastillesVues(page, 'f4', true);
      vu.reprise = await lireChoix(page, 'f4');
      // Au clavier, comme un groupe radio : la fleche passe a la suivante.
      await page.focus('#gridFor [data-choix="laser2"]');
      await page.keyboard.press('ArrowRight');
      await attendreCochee(page, 'f4', 'arcade60');
      vu.clavier = await lireChoix(page, 'f4');
      nChoix = suivi.demandes.length;
    });
    const depart = vu.depart || {};
    const libelle = ((depart.pastilles || []).find((p) => p.id === 'arcade60') || {}).texte || '';
    ok(arrive && vu.visibles && (depart.pastilles || []).length === 2 && cocheeDe(depart) === 'laser2' && depart.pastilles.every((p) => p.pastille && p.visible) && Boolean(libelle) && ditLeLaser(depart.carte),
      'MONTAGE la carte de la Formule 4 choisie montre ses deux variantes en pastilles d option, « 2 parties de Laser Game » cochee', JSON.stringify(depart));
    ok(cocheeDe(vu.arcades) === 'arcade60' && ditLaVariante((vu.arcades || {}).carte) && !ditLeLaser((vu.arcades || {}).carte),
      'touchee, « 60 min d arcades » se coche et la carte dit son contenu, sans laser', JSON.stringify(vu.arcades));
    ok(vu.cachees && cocheeDe(vu.reprise) === 'laser2' && ditLeLaser((vu.reprise || {}).carte) && !ditLaVariante((vu.reprise || {}).carte),
      'une autre formule choisie, les pastilles de la Formule 4 se cachent ; reprise, elle repart de sa carte (2 parties de Laser Game)', JSON.stringify({ cachees: vu.cachees, reprise: vu.reprise }));
    ok(cocheeDe(vu.clavier) === 'arcade60' && Boolean(((vu.clavier || {}).pastilles || []).find((p) => p.id === 'arcade60' && p.focus)),
      'au clavier, la fleche passe a « 60 min d arcades » et le focus la suit', JSON.stringify(vu.clavier));
    ok(vu.annonce === true, 'le choix de « 60 min d arcades » se dit : la region vocale nomme la variante', libelle);
    ok(vu.ficheOuverte === true && /arcade/i.test(vu.fiche || '') && !/laser/i.test(vu.fiche || ''),
      'la fiche (i) de la Formule 4 dit la variante choisie : les arcades, aucun laser', (vu.fiche || '').slice(0, 240));

    const heures = demandesDeLaFormule(suivi, nChoix, 'f4');
    ok(heures.length > 0 && heures.every((u) => params(u).get('formulaChoice') === 'arcade60'),
      `chaque demande des heures de la Formule 4 porte la variante (${heures.length})`, heures.filter((u) => params(u).get('formulaChoice') !== 'arcade60').slice(0, 1).join(''));
    const p = await lireProgramme(page);
    const arc = ligneDe(p, 'arcade_time') || {};
    ok(!p.lignes.some((l) => /^laser_game/.test(l.cle)) && Boolean(ligneDe(p, 'bowling')) && arc.heure === 'Facultatif' && /\b(1 heure|60 min)\b/.test(arc.detail || ''),
      'l ecran des heures : le bowling et les arcades de la variante (facultatives, une heure), aucune ligne de laser', resumeLignes(p));
    const v = await lireVisite(page);
    ok(v.etapes.length > 0 && !/laser/i.test(JSON.stringify(v)), 'la visite ne parle d aucune partie de laser', JSON.stringify(v.etapes.map((e) => e.titre)));
    const pris = await poser(page, 'bowling', '14:00');
    const demande = dernierPlan(suivi);
    const v2 = await lireVisite(page);
    ok(pris && posees(demande).bowling === '14:00' && params(demande).get('formulaChoice') === 'arcade60' && v2.etapes.some((e) => e.b === '14:00' && /bowling/i.test(e.titre)) && !/laser/i.test(JSON.stringify(v2)),
      'le bowling pose a 14:00 : la demande garde la variante, la visite dit le bowling a 14:00 et toujours aucun laser', `${demande} || ${JSON.stringify(v2.etapes.map((e) => `${e.b} ${e.titre}`))}`);
    // Le plan que le serveur rend pour CETTE heure : il revalide l heure posee
    // par le moteur, qui lit la variante sur la demande (api/public-availability,
    // une ancre choisie). La visite ne le prouve pas seule : ses lignes sans
    // heure viennent de la carte choisie, et un moteur qui ignore la variante
    // ne pose pas non plus de partie de laser sans heure.
    const repondu = [...suivi.reponses].reverse().find((r) => r.url === demande) || {};
    const planPose = (((repondu.json && repondu.json.slots) || [])[0] || {}).opsPlan || {};
    const variantePosee = planPose.formulaChoice || {};
    const arcadesPosees = (planPose.timeline || []).find((e) => e.activityId === 'arcade_time') || {};
    const arcadesVoulues = ((variantePosee.steps || []).find((s) => s.activityId === 'arcade_time') || {}).durationMinutes;
    const laserPose = (planPose.resourceBlocks || []).filter((b) => b.resourceType === 'laser_arena').length;
    ok(variantePosee.id === 'arcade60' && Number(arcadesVoulues) > 0 && Number(arcadesPosees.durationMinutes) === Number(arcadesVoulues) && laserPose === 0,
      'le plan que le serveur rend pour ce bowling garde la variante : ses arcades, de la duree qu elle declare, aucune partie de laser', JSON.stringify({ variante: variantePosee.id || null, arcades: arcadesPosees.durationMinutes || null, voulues: arcadesVoulues || null, laser: laserPose }));

    const nB = suivi.blocages.length;
    await page.click('#goContact');
    const contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 12000);
    const bloc = await blocageAttendu(suivi, nB);
    ok(contact && Boolean(bloc && bloc.preference) && bloc.preference.formulaChoice === 'arcade60',
      'le blocage part avec la variante (preference.formulaChoice)', JSON.stringify(bloc && bloc.preference));
    const recap = sansApostrophe(await page.evaluate(() => (document.querySelector('#recallBody') || {}).textContent || ''));
    ok(/arcade/i.test(recap) && !/laser/i.test(recap), 'le recapitulatif dit les arcades de la variante, sans laser', recap.slice(0, 240));

    // Revenir a la carte : les lignes de laser reviennent, sans variante.
    await page.click('.fg-scene[data-scene="contact"] [data-back]');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
    await page.click('.fg-scene[data-scene="heures"] [data-back]');
    const retour = await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
    await pastillesVues(page, 'f4', true);
    await page.click('#gridFor [data-choix="laser2"]');
    await attendreCochee(page, 'f4', 'laser2');
    const carteLaser = await lireChoix(page, 'f4');
    ok(retour && cocheeDe(carteLaser) === 'laser2' && ditLeLaser(carteLaser.carte) && !ditLaVariante(carteLaser.carte),
      'revenue a la carte, « 2 parties de Laser Game » se coche de nouveau et la carte redit ses deux parties de laser', JSON.stringify(carteLaser));
    const nRetour = suivi.demandes.length;
    await page.click('#goHours');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 8000);
    const pret = await attendre(page, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone.is-busy'), 15000);
    await calme(page);
    const sansVariante = demandesDeLaFormule(suivi, nRetour, 'f4');
    const pL = await lireProgramme(page);
    ok(pret && sansVariante.length > 0 && sansVariante.every((u) => !params(u).has('formulaChoice')),
      `les demandes des heures repartent sans variante (${sansVariante.length})`, sansVariante.filter((u) => params(u).has('formulaChoice')).slice(0, 1).join(''));
    ok(pL.lignes.some((l) => /^laser_game/.test(l.cle)) && !ligneDe(pL, 'arcade_time'), 'l ecran des heures rend les lignes de laser, et plus de ligne des arcades', resumeLignes(pL));
  } finally {
    ok(suivi.erreurs.length === 0, '[J] aucune erreur JavaScript', suivi.erreurs.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [K] LES VARIANTES QUE LE CENTRE OU LE JOUR NE JOUENT PAS
// ---------------------------------------------------------------------------
async function scenarioK(browser, mock) {
  section('K. LES VARIANTES QUE LE CENTRE OU LE JOUR NE JOUENT PAS');
  const leMeta = require('../api/public-booking-meta').__test;
  // Le centre tel que le serveur de dev le lit (ops-knowledge/centers.json).
  const centre = require('../ops-knowledge/centers.json').centers.find((c) => c.id === 'libramont');
  const blocages = (...ids) => ids.map((id, rang) => ({ id: 760 + rang, centerId: 'libramont', scopeType: 'activity', scopeRef: id, recurrence: 'once', date: mock.DATE, startMin: null, endMin: null }));
  // Une passe : la meta retouchee, les blocages du serveur, la Formule 4
  // choisie si sa carte se prend.
  const passe = async (retouche, blocs) => {
    semer(mock);
    mock.blocsDev.push(...blocs);
    retoucheMeta = retouche;
    const { ctx, page, suivi } = await ouvrir(browser);
    const r = { suivi, carte: { presente: false, refus: false } };
    try {
      r.formules = await versFormules(page, mock);
      r.carte = await etatCarte(page, 'f4');
      if (r.carte.presente && !r.carte.refus) {
        r.pret = await versLesHeures(page, 'f4', async () => { r.choix = await lireChoix(page, 'f4'); });
        r.programme = await lireProgramme(page);
      }
    } finally {
      retoucheMeta = null;
      semer(mock);
      await ctx.close();
    }
    return r;
  };
  const avecSesArcades = (r, quoi, label) => {
    const heures = demandesDeLaFormule(r.suivi, 0, 'f4');
    const lignes = ((r.programme || {}).lignes) || [];
    ok(Boolean(r.formules && r.carte.presente && !r.carte.refus && r.pret) && (((r.choix || {}).pastilles) || []).length === 0 && ditLaVariante((r.choix || {}).carte)
      && heures.length > 0 && heures.every((u) => params(u).get('formulaChoice') === 'arcade60') && !lignes.some((l) => /^laser_game/.test(l.cle)),
      label, JSON.stringify({ carte: r.carte, choix: r.choix, sansVariante: heures.filter((u) => params(u).get('formulaChoice') !== 'arcade60').slice(0, 1), lignes: resumeLignes(r.programme) }));
    ok(r.suivi.erreurs.length === 0, `[K] ${quoi} : aucune erreur JavaScript`, r.suivi.erreurs.slice(0, 3).join(' | '));
  };
  // 1. Le laser coupe au centre : les formules que le serveur sert a ce centre.
  const sansLaser = { ...centre, activityAvailability: { ...(centre.activityAvailability || {}), laser_game: false } };
  avecSesArcades(await passe((j) => {
    j.formules = leMeta.formulesPubliques('libramont', sansLaser);
    if (j.center) j.center.activityAvailability = sansLaser.activityAvailability;
  }, []), 'laser coupe au centre',
  'le laser coupe au centre : la Formule 4 reste, avec ses arcades seulement (aucune pastille, la carte dit leur programme), chaque demande des heures les porte, aucune ligne de laser');
  // 2. Le laser bloque toute la journee : le jour que le serveur dit.
  const leJour = (blocs) => (j) => {
    const entree = leMeta.buildCalendar(blocs, 1, centre, 'libramont', mock.DATE)[0];
    ((j.center && j.center.calendar) || []).forEach((e, k, liste) => { if (e && e.date === mock.DATE) liste[k] = entree; });
  };
  avecSesArcades(await passe(leJour(blocages('laser_game')), blocages('laser_game')), 'laser bloque ce jour-la',
    'le laser bloque ce jour-la : la Formule 4 ne se grise pas, ses arcades seulement se proposent et partent avec chaque demande');
  // 3. Le laser et les arcades bloques : plus rien ne se joue.
  const rien = await passe(leJour(blocages('laser_game', 'arcade_time')), blocages('laser_game', 'arcade_time'));
  ok(Boolean(rien.formules) && rien.carte.presente && rien.carte.refus, 'le laser et les arcades bloques ce jour-la : aucune variante ne se joue, la Formule 4 se grise', JSON.stringify(rien.carte));
  ok(rien.suivi.erreurs.length === 0, '[K] tout bloque : aucune erreur JavaScript', rien.suivi.erreurs.slice(0, 3).join(' | '));
}

// ---------------------------------------------------------------------------
// [L] UNE VARIANTE QUE LE SERVEUR REFUSE (409, formula_choice_unavailable)
// ---------------------------------------------------------------------------
async function remplirContact(page) {
  await page.fill('#cPrenom', 'Camille');
  await page.fill('#cNom', 'Test');
  await page.fill('#cEmail', 'groupe@example.org');
  await page.fill('#cTel', '0491301667');
  await page.click('.fg-occasion[data-occasion="anniversaire"]');
  await page.check('#cConsent');
  await page.click('#goRecap');
  return attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
}
async function passerLaVitrine(page) {
  await attendre(page, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  const ouverte = await page.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); });
  if (ouverte) {
    await page.click('#vitrine .fg-vitrine__non');
    await attendre(page, () => document.querySelector('#vitrine').hidden, 3000);
  }
}
const sceneActive = (page) => page.evaluate(() => ((document.querySelector('.fg-scene.is-active') || {}).dataset || {}).scene || '');
// La Formule 4 aux arcades, choisie sur sa carte.
const auxArcades = (page) => async () => {
  await pastillesVues(page, 'f4', true);
  await page.click('#gridFor [data-choix="arcade60"]');
  await attendreCochee(page, 'f4', 'arcade60');
};
async function scenarioL(browser, mock) {
  section('L. UNE VARIANTE QUE LE SERVEUR REFUSE : LA CARTE REPREND, L ECRAN LE DIT');
  const { CODE_CHOIX_INCONNU, MESSAGE_CHOIX_INCONNU } = require('../lib/formula-choice');
  const phrase = sansApostrophe(MESSAGE_CHOIX_INCONNU);
  const ditLaPhrase = (page, sel) => attendre(page, ({ s, m }) => {
    const e = document.querySelector(s);
    return Boolean(e && !e.hidden && e.textContent.replace(/\s+/g, ' ').replace(/[’']/g, "'").includes(m));
  }, 10000, { s: sel, m: phrase });
  // Les heures redemandees pour le contenu de la carte : sans variante, avec
  // les parties de laser.
  const reprend = (apres, programme) => apres.length > 0 && apres.every((u) => !params(u).has('formulaChoice')) && ((programme && programme.lignes) || []).some((l) => /^laser_game/.test(l.cle));

  // 1. Les heures : une variante que la meta sert et que le serveur ne
  //    declare pas (une copie des arcades, sous un autre identifiant).
  semer(mock);
  retoucheMeta = (j) => {
    const f4 = (j.formules || []).find((f) => f.id === 'f4');
    const liste = (f4 && f4.choices) || [];
    if (liste.length > 1) f4.choices = liste.concat([{ ...JSON.parse(JSON.stringify(liste[liste.length - 1])), id: 'retiree', label: 'Option retirée' }]);
  };
  const un = await ouvrir(browser);
  try {
    const pret = await versHeures(un.page, mock, 'f4', async () => {
      await pastillesVues(un.page, 'f4', true);
      await un.page.click('#gridFor [data-choix="retiree"]');
      await attendreCochee(un.page, 'f4', 'retiree');
    });
    const dit = await ditLaPhrase(un.page, '#hourErr');
    await calme(un.page);
    const rang = un.suivi.demandes.findIndex((u) => params(u).get('formulaChoice') === 'retiree');
    const refuse = un.suivi.reponses.some((r) => params(r.url).get('formulaChoice') === 'retiree' && r.json && r.json.code === CODE_CHOIX_INCONNU);
    const apres = rang >= 0 ? un.suivi.demandes.slice(rang + 1).filter((u) => estPlan(u) && params(u).get('formuleId') === 'f4') : [];
    const p = await lireProgramme(un.page);
    const choix = await lireChoix(un.page, 'f4');
    ok(rang >= 0 && refuse, 'MONTAGE une variante que la meta sert et que le serveur ne declare pas : la demande des heures la porte, le serveur la refuse (409, formula_choice_unavailable)', un.suivi.demandes.slice(-2).join(' | '));
    ok(Boolean(pret && dit) && reprend(apres, p) && !choix.pastilles.some((x) => x.id === 'retiree'),
      'les heures refusees : l ecran dit la phrase du serveur, la variante sort de la carte et les horaires se redemandent pour son contenu (les parties de laser)',
      JSON.stringify({ pret, dit, apres: apres.slice(0, 2), lignes: resumeLignes(p), pastilles: choix.pastilles.map((x) => x.id) }));
  } finally {
    retoucheMeta = null;
    ok(un.suivi.erreurs.length === 0, '[L] heures refusees : aucune erreur JavaScript', un.suivi.erreurs.slice(0, 3).join(' | '));
    await un.ctx.close();
  }

  // 2. Le blocage refuse la variante.
  semer(mock);
  const deux = await ouvrir(browser);
  try {
    const pret = await versHeures(deux.page, mock, 'f4', auxArcades(deux.page));
    const pris = await poser(deux.page, 'bowling', '14:00');
    const n = deux.suivi.demandes.length;
    refusUnique = '/api/public-holds';
    await deux.page.click('#goContact');
    const dit = await ditLaPhrase(deux.page, '#hourErr');
    await calme(deux.page);
    const servi = refusUnique === '';
    const scene = await sceneActive(deux.page);
    const apres = demandesDeLaFormule(deux.suivi, n, 'f4');
    const p = await lireProgramme(deux.page);
    ok(Boolean(pret && pris) && servi, 'MONTAGE la Formule 4 aux arcades, le bowling pose a 14:00 : le blocage part et recoit le refus de la variante', JSON.stringify({ pret, pris, servi }));
    ok(dit && scene === 'heures' && reprend(apres, p),
      'le blocage refuse : le client reste sur ses heures, la phrase du serveur s affiche et les horaires se redemandent pour le contenu de la carte',
      JSON.stringify({ dit, scene, apres: apres.slice(0, 2), lignes: resumeLignes(p) }));
  } finally {
    refusUnique = '';
    ok(deux.suivi.erreurs.length === 0, '[L] blocage refuse : aucune erreur JavaScript', deux.suivi.erreurs.slice(0, 3).join(' | '));
    await deux.ctx.close();
  }

  // 3. La confirmation refuse la variante : le client revient a ses heures,
  //    redemandees pour le contenu de la carte, la phrase du serveur dite ;
  //    le recapitulatif de la variante ne reste pas a l ecran avec son bouton.
  semer(mock);
  const trois = await ouvrir(browser);
  try {
    const pret = await versHeures(trois.page, mock, 'f4', auxArcades(trois.page));
    const pris = await poser(trois.page, 'bowling', '14:00');
    await trois.page.click('#goContact');
    const contact = await attendre(trois.page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 12000);
    const recap = contact ? await remplirContact(trois.page) : false;
    if (recap) await passerLaVitrine(trois.page);
    const n = trois.suivi.demandes.length;
    refusUnique = '/api/public-reservations';
    if (recap) await trois.page.click('#confirmBtn');
    const revenu = Boolean(recap) && await attendre(trois.page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering'), 10000);
    const dit = revenu && await ditLaPhrase(trois.page, '#hourErr');
    const pretApres = revenu && await attendre(trois.page, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone.is-busy'), 15000);
    if (revenu) await calme(trois.page);
    const servi = refusUnique === '';
    const apres = demandesDeLaFormule(trois.suivi, n, 'f4');
    const p = await lireProgramme(trois.page);
    const scene = await sceneActive(trois.page);
    ok(Boolean(pret && pris && contact && recap) && servi, 'MONTAGE la Formule 4 aux arcades jusqu au recapitulatif : la confirmation part et recoit le refus de la variante', JSON.stringify({ pret, pris, contact, recap, servi }));
    ok(revenu && dit && pretApres && scene === 'heures' && reprend(apres, p),
      'la confirmation refusee : le client revient a ses heures, la phrase du serveur s affiche et les horaires se redemandent pour le contenu de la carte ; le recapitulatif de la variante ne reste pas a l ecran',
      JSON.stringify({ revenu, dit, pretApres, scene, apres: apres.slice(0, 2), lignes: resumeLignes(p) }));
  } finally {
    refusUnique = '';
    ok(trois.suivi.erreurs.length === 0, '[L] confirmation refusee : aucune erreur JavaScript', trois.suivi.erreurs.slice(0, 3).join(' | '));
    await trois.ctx.close();
  }
}

const SCENARIOS = [['A', scenarioA], ['B', scenarioB], ['C', scenarioC], ['D', scenarioD], ['E', scenarioE], ['F', scenarioF], ['G', scenarioG], ['H', scenarioH], ['I', scenarioI], ['J', scenarioJ], ['K', scenarioK], ['L', scenarioL]];

// LE JOUR DU GATE : le samedi des gates (scripts/jour-de-test.js : le premier
// a venir hors vacances scolaires et feries ; PINLANE_AUJOURDHUI_DE_TEST le
// rejoue depuis un autre jour), ou les Formules 1 a 4 doivent se vendre
// (lib/booking-config). Le serveur de dev le joue (PINLANE_DEVTUNNEL_DATE) ;
// sans la variable, il prendrait le meme.
function samediVendable() {
  const config = require('../lib/booking-config');
  const centre = require('../lib/ops-knowledge').getCenter('libramont');
  const jour = require('./jour-de-test').jourDeTest({ jour: 6 });
  const vendues = ['f1', 'f2', 'f3', 'f4'].every((id) => {
    const formule = config.FORMULES.find((item) => item.id === id);
    return Boolean(formule) && config.getFormuleAvailability(formule, jour, PAX, '', centre).ok;
  });
  return vendues ? jour : '';
}

async function main() {
  const jour = samediVendable();
  if (!ok(Boolean(jour), 'MONTAGE le samedi des gates (jour-de-test, hors vacances et feries) vend les Formules 1 a 4')) process.exit(1);
  process.env.PINLANE_DEVTUNNEL_DATE = jour;
  const mock = require('./dev-tunnel-server');
  if (!ok(mock.DATE === jour, `MONTAGE le serveur de dev joue le samedi ${jour}`, mock.DATE)) process.exit(1);
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
  console.log('\nformules-arrivee-form-check: ALL OK (l arrivee est une borne, a l heure pile a l ouverture ; les arcades facultatives se posent, decalent et se proposent dans le temps libre ; chaque partie de laser propose son heure ; une heure complete propose de venir quand meme, si le serveur le tient ; la Formule 4 se choisit avec ses arcades, de la carte au blocage ; une variante que le centre ou le jour ne jouent pas ne se propose pas, un refus du serveur repart de la carte)');
  process.exit(0);
}

// Une mutation : le gate relance, sur SON port (chaque fils du pool a le sien).
function jouerMutation(index, port) {
  const mutation = MUTATIONS[index];
  return new Promise((resolve) => {
    const enfant = spawn(process.execPath, [__filename], {
      env: { ...process.env, PINLANE_ARRIVEE_FORM_PORT: String(port), PINLANE_ARRIVEE_FORM_MUTATION: String(index + 1), PINLANE_ARRIVEE_FORM_SCENARIOS: mutation.scenarios.join(',') },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    enfant.stdout.on('data', (d) => { stdout += d; });
    enfant.stderr.on('data', (d) => { stderr += d; });
    let delai = false;
    const minuteur = setTimeout(() => {
      delai = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(enfant.pid)], { stdio: 'ignore', windowsHide: true });
      else enfant.kill('SIGKILL');
    }, 300000);
    enfant.on('close', (status) => { clearTimeout(minuteur); resolve({ status: delai ? null : status, stdout, stderr }); });
  });
}

// Les 70 mutations se jouaient une par une (spawnSync, 30 min) ; un pool de
// fils (PINLANE_ECLATS, defaut 6), chacun sur son port, rend les MEMES
// verdicts, imprimes dans l ordre des mutations (2026-10-19).
async function contreEpreuves() {
  const fichiers = [...new Set([JS, CSS, 'fungalaxy.html', ...MUTATIONS.map((m) => m.fichier)])];
  const empreintes = new Map(fichiers.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  let defauts = 0;
  const parallele = Math.max(1, Math.min(MUTATIONS.length, Number(process.env.PINLANE_ECLATS || 6) || 6));
  const runs = new Array(MUTATIONS.length);
  let suivante = 0;
  await Promise.all(Array.from({ length: parallele }, async (_, fil) => {
    while (suivante < MUTATIONS.length) {
      const index = suivante;
      suivante += 1;
      runs[index] = await jouerMutation(index, PORT + 1 + fil);
    }
  }));
  MUTATIONS.forEach((mutation, index) => {
    const r = runs[index];
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
  contreEpreuves().catch((error) => { console.error(error); process.exit(1); });
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}

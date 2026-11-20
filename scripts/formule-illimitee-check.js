// TOUTES LES ACTIVITES ET LA FORMULE ILLIMITEE (2026-11-18).
//
// Marius, manager de Gembloux, au vocal du 18 novembre : « est-ce que tu pourrais aussi creer un
// onglet dans les formules pour pouvoir choisir l integralite des formules en illimite, comme par
// exemple si moi j ai un petit team building qui vient, ils ont acces a toutes les activites, et
// donc je ne sais pas choisir ca sur le site, je suis oblige de choisir chaque activite ».
//
// Il joue la VRAIE console, le VRAI handler api/staff-reservations.js, le vrai api/ops.js et le vrai
// moteur (scripts/comptoir-banc.js, base et catalogue en memoire), le samedi 16 janvier 2027 a
// 15:10 a Libramont, et verifie toujours le DOSSIER CREE en base, jamais seulement l ecran.
//
//   [A] « TOUTES LES ACTIVITES » AU COMPTOIR. Un toucher met au ticket toutes les activites du
//       centre, et seulement elles (celles que le serveur vend pour ce centre). Le programme est
//       celui qu on aurait compose tuile par tuile ; le prix est celui du programme ; le bouton
//       dit ensuite « Toutes au ticket ». Le dossier cree porte chaque activite ; le bowling et le
//       laser y sont a leur heure, pistes et arene retenues.
//   [B] JAMAIS DEUX GROUPES SUR LA MEME PISTE. Deux groupes « toutes les activites » a la meme
//       heure : chacun ses pistes ; sur toute la journee, aucune piste n est prise deux fois au
//       meme moment, et l arene ne recoit jamais plus de joueurs que d armes.
//   [C] LA FORMULE ILLIMITEE DANS TARIFS & FORMULES. Le manager (droit Tarifs, sans Reglages) la
//       cree : la case « Toutes les activites (illimite) », une duree, un prix par joueur. Au
//       catalogue : toutes les activites du centre et seulement elles (le serveur les relit, une
//       liste forgee ne passe pas), bowling et laser a heure, le reste a volonte, la duree juste,
//       au comptoir seulement ; les clients ne la voient pas. Sans le droit Tarifs, ni bouton ni
//       ecriture.
//   [D] ELLE SE RESERVE AU COMPTOIR. Dans Formules, sa tuile ; au ticket, toutes ses activites ;
//       le dossier cree : la formule, son prix par joueur, pistes et arene retenues, pas moins
//       qu une visite equivalente.
//   [E] UNE FORMULE ORDINAIRE NE CHANGE PAS, OCTET POUR OCTET : lib/formule-comptoir.js et
//       lib/catalog-store.js, relus sans le chemin illimite, rendent les memes formules.
//
// A VOLONTE (2026-11-19). Ansar : « pour illimité on peut choisir absolument toutes les activités
// en illimité », puis : « le truc illimité est super mal expliqué et il est pas dispo quand on veut
// modifier une resa déjà faite, et le illimité est mal mis en évidence, on capte pas du tout ».
//   [C] le formulaire coche chaque activite du centre, et pour le bowling et le laser propose « À
//       volonté (gardé toute la visite) » (d office) ou « Une fois, à l’heure réservée » ; le
//       serveur relit les cases contre le catalogue du centre ; une formule d avant (sans choix)
//       reste celle d avant.
//   [D] dans Reserver, sa porte « Accès illimité » a cote de « Toutes les activités », sa page qui
//       dit ce qui est compris et garde, ses heures, le ticket qui le redit ; le dossier garde ses
//       pistes toute la visite et ses armes a chaque depart ; « à partir de 2 joueurs », jamais
//       « dès 2 ». La fiche et le planning le disent.
//   [F] UNE JOURNEE CHARGEE : des groupes a volonte, a une fois et ordinaires ; aucune piste prise
//       deux fois, l arene jamais au-dela de ses armes, a aucun instant ; celui qui ne passe pas
//       recoit une phrase qui dit ce qui bloque.
//   [G] « UNE FOIS » ET LA FORMULE D AVANT : le bowling 1 h et la partie de laser a leur heure,
//       comme avant ; une formule ordinaire ne garde rien.
//   [I] DANS MODIFIER : un dossier passe en acces illimite (le serveur le planifie et le verifie
//       comme une creation), puis revient a un programme normal ; une bascule forgee sur une
//       heure pleine est refusee avec la phrase.
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en
// memoire, le disque n est jamais touche) et exige que chacune rougisse sa cible.
// `--seul=A,B` ne joue que ces lettres ; `--ancres` verifie que chaque ancre existe une fois.
// Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const eclats = require('./gates-eclats.js');
const { trancher } = require('./gates-tranche');
const C = require('./comptoir-banc.js');
const { chromium } = require('playwright-core');

const { B, FX, ROOT, JOUR } = C;
const PORT = Number(process.env.PINLANE_ILLIMITE_PORT || 4985);
const CASSE = String(process.env.ILLIMITE_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };

const APP = 'assets/app-main.js';
const PAGES = 'assets/staff-pages-v2.js';
const FC_FICHIER = 'lib/formule-comptoir.js';
const STORE = 'lib/catalog-store.js';
const OPS = 'api/ops.js';
const VISITE = 'lib/visit-program.js';

// LA MUTATION : une garde retiree expres, une a la fois. `lettre` dit quel scenario la juge,
// `cible` le debut du libelle qui doit rougir, `serveur` qu elle se compile au serveur.
const MUTATIONS = [
  { nom: 'toutes-remplace-le-bowling', lettre: 'A', cible: '[A] un toucher : toutes les activites du centre au ticket', fichier: APP, de: '    s.bowlingParDefaut = false;\n    manquantes.forEach', vers: '    manquantes.forEach' },
  { nom: 'toutes-une-seule', lettre: 'A', cible: '[A] un toucher : toutes les activites du centre au ticket', fichier: APP, de: '    manquantes.forEach((id) => { if (!rsAuTicket(id)) rsPrendre(id); });', vers: '    rsPrendre(manquantes[0]);' },
  { nom: 'toutes-hors-centre', lettre: 'A', cible: '[A] un toucher : toutes les activites du centre au ticket', fichier: APP, de: '  return getQuickBookActivityChoices().map((c) => c.id);\n}', vers: "  return [...getQuickBookActivityChoices().map((c) => c.id), 'golf_oclock'];\n}" },
  { nom: 'toutes-reste-actif', lettre: 'A', cible: '[A] ensuite le bouton dit « Toutes au ticket »', fichier: APP, de: '  if (rsToutesAuTicket()) {', vers: '  if (false) {' },
  { nom: 'visite-sans-ressource', lettre: 'A', cible: '[A] le dossier : bowling et laser a leur heure, pistes et arene retenues', serveur: true, fichier: VISITE, de: '      planned: activity.planned === true,', vers: '      planned: false,' },
  // (Le refus du deuxieme groupe tient a trois gardes du serveur a la fois : le plan du moteur, l attribution
  // des pistes a l ecriture et la relecture des conflits. Retirer l une des deux premieres le laisse refuse, la
  // mesure du 18/11 : aucune ne se prouve seule, elles se prouvent ensemble par ce [B] vert.)
  { nom: 'visite-sans-pistes', lettre: 'B', cible: '[B] le premier groupe prend les deux pistes qui restaient', serveur: true, fichier: VISITE, de: '      planned: activity.planned === true,', vers: '      planned: false,' },
  { nom: 'illimite-fenetre-ouverte', lettre: 'D', cible: '[D] la porte « Accès illimité »', serveur: true, fichier: FC_FICHIER, de: "  return liste.length ? `${ORDRE_ILLIMITE}:${liste.join(',')}` : ORDRE_ILLIMITE;", vers: "  return 'open_window';" },
  { nom: 'illimite-sans-bowling', lettre: 'C', cible: '[C] au catalogue : toutes les activites du centre, et seulement elles', serveur: true, fichier: FC_FICHIER, de: "  if (bowling) steps.push({ activityId: 'bowling'", vers: "  if (false) steps.push({ activityId: 'bowling'" },
  { nom: 'illimite-liste-forgee', lettre: 'C', cible: '[C] une liste forgee ne passe pas', serveur: true, fichier: OPS, de: "require('../lib/activity-catalog').listCenterActivities(targetCenter) : [];", vers: '(body.formule.activites || []) : [];' },
  { nom: 'illimite-montree', lettre: 'C', cible: '[C] au comptoir seulement : les clients ne la voient pas', serveur: true, fichier: FC_FICHIER, de: '      orderPolicy: ordreIllimite(aVolonte),\n      humanValidation: corps.clients === true ? null : MODE_COMPTOIR,', vers: '      orderPolicy: ordreIllimite(aVolonte),\n      humanValidation: null,' },
  { nom: 'illimite-sans-duree', lettre: 'C', cible: '[C] sa duree de visite borne les arrivees', serveur: true, fichier: STORE, de: '    if (minutes > 0) formule.estimatedTotalDuration = minutes / 60;\n', vers: '' },
  { nom: 'illimite-sans-bouton', lettre: 'C', cible: '[C] le manager a le bouton « + Accès illimité »', fichier: PAGES, de: "          ${tfPeutTarifs() ? '<button type=\"button\" class=\"pv2-btn\" id=\"tfIllimite\"", vers: "          ${false ? '<button type=\"button\" class=\"pv2-btn\" id=\"tfIllimite\"" },
  { nom: 'composition-par-la-carte', lettre: 'D', cible: '[D] au ticket : toutes ses activites', fichier: APP, de: '  if (formule && formule.illimite && Array.isArray(formule.illimite.activites)) {', vers: '  if (false) {' },
  { nom: 'ordinaire-touchee', lettre: 'E', cible: '[E] lib/formule-comptoir.js : une formule ordinaire, octet pour octet', serveur: true, fichier: FC_FICHIER, de: '    descriptionLines,\n    steps,\n    humanValidation', vers: "    descriptionLines,\n    steps,\n    orderPolicy: null,\n    humanValidation" },
  { nom: 'catalogue-ordinaire-touche', lettre: 'E', cible: '[E] lib/catalog-store.js : les formules ordinaires, octet pour octet', serveur: true, fichier: STORE, de: '  if (estOrdreIllimite(canonical.orderPolicy)) {', vers: "  if (canonical.orderPolicy !== 'open_window') {" },
  // A VOLONTE (2026-11-19).
  { nom: 'cases-ignorees', lettre: 'C', cible: '[C] les cases decochees et « une fois » arrivent au catalogue', serveur: true, fichier: FC_FICHIER, de: '    const choisies = activitesCochees(corps.activites, vendables);', vers: '    const choisies = vendables;' },
  { nom: 'cases-crues', lettre: 'C', cible: '[C] une liste forgee ne passe pas', serveur: true, fichier: FC_FICHIER, de: '  return vendables.filter((a) => voulues.has(String(a.id)));', vers: "  return brut.map((x) => (x && typeof x === 'object' ? { nom: String(x.id), ...x } : { id: String(x), nom: String(x) }));" },
  { nom: 'volonte-forgee', lettre: 'C', cible: '[C] une liste forgee ne passe pas', serveur: true, fichier: FC_FICHIER, de: '    const aVolonte = aVolonteChoisi(corps.aVolonte).filter((id) => choisies.some((a) => String(a.id) === id));', vers: '    const aVolonte = aVolonteChoisi(corps.aVolonte);' },
  { nom: 'formule-d-avant-gardee', lettre: 'C', cible: '[C] une formule illimitee d avant (sans choix) reste celle d avant', serveur: true, fichier: FC_FICHIER, de: '  if (brut && typeof brut === \'object\') return A_HEURE.filter((id) => brut[id] === true);\n  return [];', vers: '  if (brut && typeof brut === \'object\') return A_HEURE.filter((id) => brut[id] === true);\n  return A_HEURE.slice();' },
  { nom: 'rien-garde', lettre: 'D', cible: '[D] le dossier garde ses pistes toute la visite', serveur: true, fichier: 'lib/ops-engine.js', de: '  scenario = garderPourLaVisite({ center, formula, scenario });', vers: '' },
  { nom: 'un-seul-depart', lettre: 'F', cible: '[F] le groupe qui ne passe pas lit ce qui bloque', serveur: true, fichier: 'lib/a-volonte.js', de: '    for (let depart = premier; depart + LASER_GAME_ARENA_MINUTES <= fin; depart += GRILLE_DES_DEPARTS) {', vers: '    for (let depart = premier; depart + LASER_GAME_ARENA_MINUTES <= fin; depart += 24 * 60) {' },
  { nom: 'pistes-une-heure', lettre: 'D', cible: '[D] le dossier garde ses pistes toute la visite', serveur: true, fichier: 'lib/a-volonte.js', de: '  const fin = Math.max(Number(scenario.end) || 0, debut + dureeVendue(formula));', vers: '  const fin = Math.max(Number(scenario.end) || 0, debut + 60);' },
  { nom: 'refus-muet', lettre: 'F', cible: '[F] le groupe qui ne passe pas lit ce qui bloque', serveur: true, fichier: 'lib/ops-engine.js', de: '  conflictResult.conflicts = phraserLaGarde(conflictResult.conflicts, scenario);', vers: '' },
  { nom: 'une-fois-gardee', lettre: 'G', cible: '[G] « une fois » : le bowling 1 h a son heure, comme avant', serveur: true, fichier: 'lib/a-volonte.js', de: "  const garderBowling = gardees.includes('bowling');", vers: "  const garderBowling = gardees.length > 0;" },
  { nom: 'porte-cachee', lettre: 'D', cible: '[D] la porte « Accès illimité »', fichier: APP, de: "  rsPoser('rsZ-portes', `${acces ? `<div class=\"rs-portes is-seule is-acces\">${acces}</div>` : ''}", vers: "  rsPoser('rsZ-portes', `${false ? `<div class=\"rs-portes is-seule is-acces\">${acces}</div>` : ''}" },
  { nom: 'ticket-muet', lettre: 'D', cible: '[D] au ticket : ce qui est garde, en clair', serveur: true, fichier: 'lib/reserver-fenetre.js', de: '    acces: plan ? accesIllimiteDuDossier(dossier) : null,', vers: '    acces: null,' },
  { nom: 'fiche-muette', lettre: 'D', cible: '[D] la fiche le dit en une phrase', fichier: APP, de: "  return window.PinlaneAVolonte.resume(r.opsPlan, { minutes: Number(f.illimite.minutes) || 0, toutes: centre.length > 0 && centre.every((id) => comprises.includes(id)), nombre: comprises.length });", vers: '  return null;' },
  { nom: 'modifier-sans-illimite', lettre: 'I', cible: '[I] dans Modifier : « À la carte | Accès illimité »', fichier: APP, de: '  const illimitees = getEffectiveCatalogFormules().filter(estFormuleIllimitee);\n  // (la formule du dossier reste au selecteur', vers: '  const illimitees = [];\n  // (la formule du dossier reste au selecteur' },
  { nom: 'modifier-sans-catalogue', lettre: 'I', cible: '[I] dans Modifier : « À la carte | Accès illimité »', fichier: APP, de: "  if (!choix.length) { lireLesFormulesGardeesPourModifier(); return ''; }", vers: "  if (!choix.length) { return ''; }" },
  { nom: 'modifier-sans-pistes', lettre: 'I', cible: '[I] enregistre : le dossier en acces illimite', fichier: APP, de: "    || (dossierFormule.type === 'formule' && Boolean(resolveDisplayFormule(dossierFormule.formuleId)?.hasBowling));", vers: ';' },
  { nom: 'verdict-pas-repeint', lettre: 'I', cible: '[I] le verdict du serveur dit ce qui sera garde', fichier: APP, de: '  if (acces) acces.outerHTML = renderEditIllimiteChoix();', vers: '' },
  { nom: 'retour-sans-heures', lettre: 'I', cible: '[I] « À la carte » : une visite de ses activites', fichier: APP, de: '      updated.preference = { activityOrder: ids, preferredTimes:', vers: '      updated.preferenceOubliee = { activityOrder: ids, preferredTimes:' },
  { nom: 'rangees-une-heure', lettre: 'I', cible: '[I] sous l acces illimite, les rangees disent ce qui est garde', fichier: APP, de: '  const volonte = gardeAVolonteEdition(r);\n  const rangees = [...choix, ...supplement].map((choice, rang) => {', vers: '  const volonte = null;\n  const rangees = [...choix, ...supplement].map((choice, rang) => {' },
  { nom: 'heure-refusee-proposee', lettre: 'D', cible: '[D] la derniere arrivee proposee, le serveur l accepte', fichier: APP, de: "  return { lue, liste: lue ? rsFormuleMemo.liste.filter((x) => !(x.verdict && x.verdict.statut === 'ko' && x.verdict.court === 'hors horaires')) : rsFormuleMemo.liste };", vers: '  return { lue, liste: rsFormuleMemo.liste };' },
  { nom: 'planning-muet', lettre: 'D', cible: '[D] le planning montre les pistes et les armes gardees', fichier: 'assets/pinlane-planning-global.js', de: "        if (e.aVolonte) {\n          d2 = 'à volonté';", vers: "        if (false) {\n          d2 = 'à volonté';" },
  { nom: 'laser-six-heures', lettre: 'D', cible: '[D] le planning montre les pistes et les armes gardees', fichier: 'assets/pinlane-planning-global.js', de: "    else if (col.nature === 'laser' && liste.length > 1 && liste.every(function (e) { return e.aVolonte; })) {", vers: '    else if (false) {' },
  { nom: 'fiche-heures-suggerees', lettre: 'D', cible: '[D] la fiche : ses autres activites sans heure, « à volonté »', fichier: APP, de: '  const accesIllimite = illimiteDeSaCarte(r);\n  getStaffFormulaTimedItems(r)', vers: '  const accesIllimite = false;\n  getStaffFormulaTimedItems(r)' },
  { nom: 'planning-heures-suggerees', lettre: 'D', cible: '[D] au planning, ses autres activites disent « à volonté », sans heure', fichier: 'assets/pinlane-planning-global.js', de: "      var acces = typeof illimiteDeSaCarte === 'function' && illimiteDeSaCarte(r);", vers: '      var acces = false;' },
  // LE FORMULAIRE COURT, LA PAGE EN PHOTOS, LE SELECTEUR DE MODIFIER (2026-11-20).
  { nom: 'a-la-carte-sans-garde', lettre: 'I', cible: '[I] « À la carte » deja pris ne change rien au dossier', fichier: APP, de: "  if (e.versProgrammeNormal || !estFormuleIllimitee(actuelle)) return;\n", vers: '' },
  { nom: 'illimite-rejoue', lettre: 'I', cible: '[I] « Accès illimité » deja pris ne rejoue pas sa carte', fichier: APP, de: "  if (!e.versProgrammeNormal && String(e.type || '') === 'formule' && String(e.formuleId || '') === String(id)) return;\n", vers: '' },
  { nom: 'reprise-oubliee', lettre: 'I', cible: '[I] « À la carte » puis « Accès illimité » : le dossier redevient ce qu il etait', fichier: APP, de: '  if (e.versProgrammeNormal) e.versProgrammeNormal = false;\n  changerFormuleEdition(id);', vers: '  changerFormuleEdition(id);' },
  { nom: 'photos-absentes', lettre: 'D', cible: '[D] sa page : la phrase commune, le prix et le total, chaque activite en vraie photo', fichier: APP, de: "  return trouve ? `/assets/fungalaxy/${trouve[1]}-carte.webp` : '';\n}", vers: "  return '';\n}" },
  { nom: 'total-oublie', lettre: 'D', cible: '[D] la porte « Accès illimité »', fichier: APP, de: "  const total = f.type !== 'per_lane' && rsEtat() && rsEtat().faits.combien ?", vers: "  const total = false ?" },
  { nom: 'phrase-d-avant', lettre: 'D', cible: '[D] au ticket : ce qui est garde, en clair', serveur: true, fichier: 'assets/pinlane-a-volonte.js', de: "    if (toutes !== false) return 'Tout à volonté';", vers: "    if (toutes !== false) return 'Toutes les activités à volonté';" },
  { nom: 'deux-points-revenus', lettre: 'D', cible: '[D] la fiche le dit en une phrase', fichier: 'assets/pinlane-a-volonte.js', de: '        courte: `Bowling, ${pistesDites(pistes)} ${gardees} toute la visite.`,', vers: '        courte: `Bowling : ${pistesDites(pistes)} ${gardees} toute la visite.`,' },
  { nom: 'tarifs-liste-d-avant', lettre: 'C', cible: '[C] la liste de Tarifs dit l acces avec les mots du comptoir', fichier: PAGES, de: '      desc: tfDescIllimite(entry) || (Array.isArray(entry.desc) ? entry.desc.map(String) : []),', vers: '      desc: (Array.isArray(entry.desc) ? entry.desc.map(String) : []),' },
  { nom: 'duree-ignoree', lettre: 'C', cible: '[C] la duree se choisit d un toucher', fichier: PAGES, de: "    else { f.dureeAutre = false; f.dureeMinutes = String(Number(valeur) || 180); }", vers: "    else { f.dureeAutre = false; }" },
  { nom: 'toutes-en-porte', lettre: 'A', cible: '[A] la fenetre ouvre avec « Ajouter toutes les activités »', fichier: APP, de: '  return `<button type="button" class="rs-toutes" id="rsToutes" aria-pressed="false"', vers: '  return `<button type="button" class="rs-porte rs-toutes" id="rsToutes" aria-pressed="false"' },
  { nom: 'toutes-retire', lettre: 'A', cible: '[A] la fenetre ouvre avec « Ajouter toutes les activités »', fichier: APP, de: '</div>${toutes}</div>${rsJoueursPetitsHtml(petites)}', vers: '</div></div>${rsJoueursPetitsHtml(petites)}' },
  { nom: 'toutes-sa-rangee', lettre: 'A', cible: '[A] la fenetre ouvre avec « Ajouter toutes les activités »', fichier: APP, de: '</div>${toutes}</div>${rsJoueursPetitsHtml(petites)}', vers: '</div></div>${toutes}${rsJoueursPetitsHtml(petites)}' },
  { nom: 'retour-sans-programme', lettre: 'I', cible: '[I] « À la carte »', fichier: APP, de: "    if (versProgrammeNormal && programme) {\n      updated.type = 'visite';", vers: "    if (false) {\n      updated.type = 'visite';" },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

let echecs = 0;
let reussis = 0;
const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (mutation && label.startsWith(mutation.cible)) throw Object.assign(new Error(`cible rouge : ${label}`), { cibleRouge: true });
  return false;
}
if (CASSE && !mutation) { console.error(`formule-illimitee-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
const compteAncre = (m) => lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
if (mutation && compteAncre(mutation) !== 1) { console.error(`formule-illimitee-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }
function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

const serveur = C.monterServeur({ mutations: mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [] });
// Les images au telephone (375 px) : PINLANE_ILLIMITE_APPAREIL=telephone375 avec --captures.
FX.APPAREILS.telephone375 = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-BE' };
const APPAREIL = process.env.PINLANE_ILLIMITE_APPAREIL || 'comptoir';
const ouvrir = (browser, options = {}) => C.ouvrirConsole(browser, serveur, { port: PORT, reservations: () => [], appareil: APPAREIL, ...options });
const finir = async (m, quoi) => { ok(m.erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, m.erreurs.slice(0, 3).join(' | ')); await m.ctx.close(); };

// ---------------------------------------------------------------------------
// Lire l ecran, lire la base.
// ---------------------------------------------------------------------------
const CENTRE = 'libramont';
const JOUEURS = 10;
const TEL = '0470 12 34 56';
const { listCenterActivities } = require(path.join(ROOT, 'lib/activity-catalog.js'));
// Ce que le serveur vend pour ce centre : la seule definition de « toutes les activites ».
const DU_CENTRE = () => listCenterActivities(CENTRE).map((a) => a.id);
const memeEnsemble = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const planDe = (r) => (r && (typeof r.ops_plan === 'string' ? JSON.parse(r.ops_plan) : r.ops_plan)) || {};
const programmeDe = (r) => { const p = r && (typeof r.program === 'string' ? JSON.parse(r.program) : r.program); return (p && p.items) || []; };
const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
// Ce que le dossier retient : les pistes du bowling, ses minutes, les armes et les parties du laser.
function retenues(r) {
  const blocs = planDe(r).resourceBlocks || [];
  const bowling = blocs.filter((b) => b.resourceType === 'bowling_lane');
  const laser = blocs.filter((b) => b.resourceType === 'laser_arena');
  return {
    pistes: [...new Set(bowling.flatMap((b) => (b.lanes || []).map(Number)))].sort((x, y) => x - y),
    minutesBowling: bowling.reduce((t, b) => t + (enMin(b.endTime) - enMin(b.startTime)), 0),
    armes: laser.reduce((t, b) => t + (Number(b.weaponNeed) || 0), 0),
    parties: new Set(laser.map((b) => b.countIndex || 1)).size,
    heures: { bowling: bowling[0] ? bowling[0].startTime : '', laser: laser[0] ? laser[0].startTime : '' },
    // Ce qui est garde a volonte : les pistes et leur plage, chaque depart de laser et ses armes.
    gardees: bowling.filter((b) => b.aVolonte).map((b) => `${b.startTime}-${b.endTime}:${(b.lanes || []).length}`),
    departs: laser.filter((b) => b.aVolonte).map((b) => `${b.startTime}:${b.weaponNeed}:${enMin(b.endTime) - enMin(b.startTime)}`),
    uneFois: blocs.filter((b) => !b.aVolonte && (b.resourceType === 'bowling_lane' || b.resourceType === 'laser_arena')).length,
  };
}
// Les departs de laser attendus : toutes les demi-heures, de l arrivee a la fin de la visite moins une partie.
const departsAttendus = (debut, fin, armes) => { const l = []; for (let m = Math.ceil(enMin(debut) / 30) * 30; m + 25 <= enMin(fin); m += 30) l.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${armes}:25`); return l; };
async function neufs(page, avant, voulu = 1) {
  for (let i = 0; i < 80; i += 1) {
    const l = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
    if (l.length >= voulu) return l;
    await page.waitForTimeout(100);
  }
  return [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
}
async function creer(page, nom) {
  await page.locator('#qbPhone').fill(TEL);
  await page.locator('#qbName').fill(nom);
  await page.waitForTimeout(200);
  await C.pret(page);
  await page.locator('#rvCreer').click();
}
async function attendreBase(page, cond) {
  for (let i = 0; i < 80; i += 1) { if (cond()) return true; await page.waitForTimeout(100); }
  return cond();
}
const lireFenetre = (page) => page.evaluate(() => {
  const c = rvConstruire({ simulation: true });
  const plan = rvPlanCourant();
  const bouton = document.getElementById('rsToutes');
  return {
    ids: rvActivites(),
    programme: c.reservation ? (c.reservation.program || []).map((l) => ({ ...l })) : null,
    type: c.reservation ? c.reservation.type : '',
    prix: plan ? Number(plan.prix) : null,
    // (2026-11-20) Ou il vit : au bout de la rangee des tuiles des activites (rsZ-petits, .rs-petits-l),
    // sans rangee a lui (la fenetre tient sans defiler), jamais dans la rangee des portes.
    bouton: bouton ? { texte: bouton.textContent.replace(/\s+/g, ' ').trim(), desactive: bouton.disabled, presse: bouton.getAttribute('aria-pressed'), sousLesTuiles: Boolean(document.getElementById('rsZ-petits') && document.getElementById('rsZ-petits').contains(bouton) && bouton.closest('.rs-petits-l')), dansLesPortes: Boolean(bouton.closest('.rs-portes')), porte: bouton.classList.contains('rs-porte') } : null,
  };
});
// Le prix d un programme, au serveur (lib/visit-program), sans passer par la console.
function prixDuProgramme(programme, startTime) {
  const { normalizeProgram } = require(path.join(ROOT, 'lib/visit-program.js'));
  const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
  const { getOperationalBowlingConfig } = require(path.join(ROOT, 'lib/ops-engine.js'));
  const centre = getCenter(CENTRE);
  return normalizeProgram(programme, { centerId: CENTRE, pax: JOUEURS, bowlingConfig: getOperationalBowlingConfig ? getOperationalBowlingConfig(centre, {}) : null, dateStr: JOUR, startTime, staff: true }).price;
}

// ---------------------------------------------------------------------------
// [A] TOUTES LES ACTIVITES AU COMPTOIR
// ---------------------------------------------------------------------------
async function scenarioA(browser) {
  console.log('\n[A] toutes les activites au comptoir');
  const m = await ouvrir(browser, { role: 'manager' });
  try {
    const { page } = m;
    // Le programme compose a la main, tuile par tuile : la reference.
    await C.ouvrirFenetre(page, JOUEURS);
    await page.locator('#rsZ-bowling .rs-h.is-on').first().click();
    await C.pret(page);
    await page.locator('#rsAjout-laser_game').click();
    await C.pret(page);
    const tuiles = await page.evaluate(() => getQuickBookActivityChoices().map((c) => c.id).filter((id) => id !== 'bowling' && id !== 'laser_game'));
    for (const id of tuiles) {
      await page.locator(`[id="rsT-${id}"]`).click();
      const question = page.locator('#rsQJTard');
      if (await question.count() && await question.isVisible().catch(() => false)) await question.click();
    }
    await C.pret(page);
    const main = await lireFenetre(page);
    await page.evaluate(() => closeQuickBook());
    await page.waitForTimeout(300);

    // Un toucher.
    await C.ouvrirFenetre(page, JOUEURS);
    const avant = await lireFenetre(page);
    ok(avant.bouton && avant.bouton.texte === 'Ajouter toutes les activités' && !avant.bouton.desactive && avant.bouton.sousLesTuiles && !avant.bouton.dansLesPortes && !avant.bouton.porte && avant.ids.join() === 'bowling', '[A] la fenetre ouvre avec « Ajouter toutes les activités », un bouton secondaire sous les tuiles', avant);
    await page.locator('#rsToutes').click();
    await C.pret(page);
    await page.waitForTimeout(600);
    const apres = await lireFenetre(page);
    const centre = DU_CENTRE();
    ok(memeEnsemble(apres.ids, centre) && apres.type === 'visite', '[A] un toucher : toutes les activites du centre au ticket, et seulement elles', { ecran: apres.ids, centre });
    ok(apres.bouton && apres.bouton.desactive && apres.bouton.presse === 'true' && /Toutes au ticket/.test(apres.bouton.texte), '[A] ensuite le bouton dit « Toutes au ticket »', apres.bouton);
    const cle = (p) => JSON.stringify((p || []).map((l) => JSON.stringify(Object.keys(l).sort().reduce((o, k) => ({ ...o, [k]: l[k] }), {}))).sort());
    ok(cle(apres.programme) === cle(main.programme), '[A] le programme est celui compose tuile par tuile', { toutes: apres.programme && apres.programme.map((l) => l.activityId), main: main.programme && main.programme.map((l) => l.activityId) });
    const attendu = prixDuProgramme(apres.programme, '15:00');
    ok(apres.prix != null && apres.prix > 0 && Math.abs(apres.prix - attendu) < 0.01 && Math.abs(apres.prix - main.prix) < 0.01, '[A] le prix est celui du programme', { ecran: apres.prix, programme: attendu, main: main.prix });

    // Le dossier.
    const debut = new Set([...B.base.reservations.keys()]);
    await creer(page, 'Team building Toutes');
    const [r] = await neufs(page, debut);
    const ids = programmeDe(r).map((l) => l.activityId);
    ok(r && memeEnsemble(ids, centre) && Math.abs(Number(r.price) - attendu) < 0.01, '[A] le dossier cree porte chaque activite du centre, au prix du programme', r && { ids, prix: r.price, attendu });
    const t = retenues(r);
    ok(r && t.pistes.length >= 2 && t.minutesBowling === 60 && t.armes === JOUEURS && t.parties === 1 && t.heures.bowling && t.heures.laser, '[A] le dossier : bowling et laser a leur heure, pistes et arene retenues', t);
  } finally { await finir(m, 'A'); }
}

// ---------------------------------------------------------------------------
// [B] JAMAIS DEUX GROUPES SUR LA MEME PISTE
// ---------------------------------------------------------------------------
function chevauchementsDeLaJournee() {
  const dossiers = [...B.base.reservations.values()].filter((r) => r.status !== 'cancelled' && String(r.date).slice(0, 10) === JOUR);
  const pistes = [];
  const parties = [];
  dossiers.forEach((r) => (planDe(r).resourceBlocks || []).forEach((b) => {
    if (b.resourceType === 'bowling_lane') pistes.push({ id: r.id, s: enMin(b.startTime), e: enMin(b.endTime), l: (b.lanes || []).map(Number) });
    if (b.resourceType === 'laser_arena') parties.push({ s: enMin(b.startTime), e: enMin(b.endTime), n: Number(b.weaponNeed) || 0 });
  }));
  // L arene a chaque instant ou une partie commence : toutes les parties en cours a cet instant.
  const laser = new Map(parties.map((p) => [p.s, parties.filter((q) => q.s <= p.s && p.s < q.e).reduce((t, q) => t + q.n, 0)]));
  const doubles = [];
  for (let i = 0; i < pistes.length; i += 1) {
    for (let j = i + 1; j < pistes.length; j += 1) {
      const a = pistes[i];
      const b = pistes[j];
      if (a.id === b.id || !(a.s < b.e && b.s < a.e)) continue;
      const communes = a.l.filter((x) => b.l.includes(x));
      if (communes.length) doubles.push({ dossiers: [a.id, b.id], pistes: communes });
    }
  }
  const armes = Number(require(path.join(ROOT, 'lib/ops-knowledge.js')).getCenter(CENTRE).resources.laser.weaponCount);
  return { doubles, arene: [...laser.entries()].filter(([, n]) => n > armes), dossiers: dossiers.length };
}

// Six pistes sur huit deja prises de 15:00 a 16:00 : il en reste deux, juste ce qu il faut a
// un groupe de 10. Le dossier est dans la base du serveur, c est lui qui juge.
const OCCUPEES = [1, 2, 3, 4, 5, 6];
const DEJA_LA = () => [{ ...C.dossierRetenu({ heure: '15:00', pistes: OCCUPEES, joueurs: 30 }), id: 9101, name: 'Groupe deja la', channel: 'staff', status: 'confirmed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];

async function scenarioB(browser) {
  console.log('\n[B] jamais deux groupes sur la meme piste');
  const m = await ouvrir(browser, { role: 'manager', reservations: DEJA_LA });
  try {
    const { page } = m;
    const debut = new Set([...B.base.reservations.keys()]);
    await C.ouvrirFenetre(page, JOUEURS);
    await page.locator('#rsToutes').click();
    await C.pret(page);
    await page.waitForTimeout(500);
    // Ce que « Créer » enverrait : le meme corps servira au deuxieme groupe.
    const corps = await page.evaluate(() => rvConstruire().reservation);
    await creer(page, 'Equipe Une');
    const [un] = await neufs(page, debut);
    const t1 = retenues(un);
    ok(un && t1.heures.bowling === '15:00' && t1.pistes.length === 2 && !t1.pistes.some((p) => OCCUPEES.includes(p)), '[B] le premier groupe prend les deux pistes qui restaient', t1);
    // Le deuxieme groupe, la meme visite a la meme heure, droit au serveur.
    const deux = await serveur.appeler('POST', '/api/staff-reservations', { ...corps, name: 'Equipe Deux', phone: TEL, centerId: CENTRE });
    const ne = deux.json.reservation && deux.json.reservation.id ? B.base.reservations.get(Number(deux.json.reservation.id)) : null;
    const t2 = ne ? retenues(ne) : null;
    ok((deux.statut >= 400 && !ne) || (ne && t2.pistes.length >= 2 && !t2.pistes.some((p) => t1.pistes.includes(p) || (t2.heures.bowling === '15:00' && OCCUPEES.includes(p)))), '[B] un deuxieme groupe sur l heure pleine est refuse, jamais surreserve', { statut: deux.statut, message: deux.json.message || deux.json.error, retenues: t2 });
    const bilan = chevauchementsDeLaJournee();
    ok(bilan.dossiers >= 2 && bilan.doubles.length === 0 && bilan.arene.length === 0, '[B] sur la journee, aucune piste prise deux fois, l arene jamais au-dela de ses armes', bilan);
  } finally { await finir(m, 'B'); }
}

// ---------------------------------------------------------------------------
// [C] LA FORMULE ILLIMITEE DANS TARIFS & FORMULES
// ---------------------------------------------------------------------------
const ID_ILLIMITEE = 'sm-libramont--acces-illimite';
const CORPS_ILLIMITE = { nom: 'Accès illimité', prixParPersonne: 32, minPax: 1, illimite: true, dureeMinutes: 180, clients: false };
const lePublicVoit = (id) => require(path.join(ROOT, 'lib/booking-config.js')).getEffectiveFormules(CENTRE).some((f) => f.id === id);
const lePublicRefuse = (id) => {
  const { normalizeReservationRequest } = require(path.join(ROOT, 'lib/reservation-request.js'));
  try { normalizeReservationRequest({ centerId: CENTRE, date: JOUR, startTime: '15:00', pax: JOUEURS, type: 'formule', formuleId: id, name: 'X', phone: '+32470000000', email: 'x@example.test' }, { channel: 'public' }); return false; } catch (error) { return /indisponible/i.test(error.message); }
};
async function garderParLeServeur(corps) {
  return serveur.appeler('POST', '/api/ops', { action: 'garderFormuleSurMesure', centerId: CENTRE, formule: corps });
}

async function scenarioC(browser) {
  console.log('\n[C] la formule illimitee dans Tarifs & formules');
  // Sans le droit Tarifs : ni bouton, ni ecriture.
  const m0 = await ouvrir(browser, { role: 'sans-tarifs' });
  try {
    const { page } = m0;
    await page.evaluate(() => { const b = document.querySelector('[data-fgx-menu-key="prices"]'); if (b) b.click(); });
    await page.waitForSelector('[data-tf-onglet="formules"]', { timeout: 20000 }).catch(() => {});
    ok(await page.locator('#tfIllimite').count() === 0, '[C] sans le droit Tarifs, pas de bouton', await page.locator('#tfIllimite').count());
  } finally { await finir(m0, 'C sans droit'); }
  serveur.changerSession(C.roleDe('sans-tarifs'));
  const refus = await garderParLeServeur(CORPS_ILLIMITE);
  ok(refus.statut === 403 && !C.CATALOGUE_BANC.formules.has(ID_ILLIMITEE), '[C] sans le droit Tarifs, le serveur refuse', { statut: refus.statut });
  serveur.changerSession(C.roleDe('manager'));
  // Une liste forgee : le serveur relit les cases contre le catalogue du centre, et le choix « a
  // volonte » contre les cases.
  const forgee = await garderParLeServeur({ ...CORPS_ILLIMITE, nom: 'Forgee illimitee', activites: [{ id: 'golf_oclock' }, { id: 'bowling', minutes: 600 }], aVolonte: { bowling: true, laser_game: true, arcade_time: true } });
  const lignesForgee = C.CATALOGUE_BANC.etapes.filter((e) => e.formula_id === ID_FORGEE);
  const ligneForgee = C.CATALOGUE_BANC.formules.get(ID_FORGEE) || {};
  ok(forgee.statut === 200 && lignesForgee.map((e) => e.activity_id).join() === 'bowling' && Number(lignesForgee[0].duration_minutes) === 60 && ligneForgee.order_policy === 'illimite:bowling', '[C] une liste forgee ne passe pas : le serveur relit le catalogue du centre', { statut: forgee.statut, message: forgee.json.message, etapes: lignesForgee.map((e) => [e.activity_id, e.duration_minutes]), politique: ligneForgee.order_policy });

  const m = await ouvrir(browser, { role: 'manager' });
  try {
    const { page } = m;
    await page.evaluate(() => { const b = document.querySelector('[data-fgx-menu-key="prices"]'); if (b) b.click(); });
    await page.waitForSelector('#tfIllimite', { timeout: 20000 }).catch(() => {});
    // LE FORMULAIRE COURT (2026-11-20) : le bouton s appelle « + Accès illimité » ; les activites sont des
    // photos a toucher (aria-pressed), la duree et le bowling et le laser des selecteurs (aria-checked),
    // « Aussi en ligne » une case, et dessous ce que lit le comptoir (#cevIlDit), lu partie par partie.
    const texteBouton = (await page.locator('#tfIllimite').count()) ? (await page.locator('#tfIllimite').textContent()).replace(/\s+/g, ' ').trim() : '';
    ok(texteBouton === '+ Accès illimité', '[C] le manager a le bouton « + Accès illimité »', texteBouton);
    await page.locator('#tfIllimite').click();
    await page.waitForSelector('#cevIlNom');
    const lireModale = () => page.evaluate(() => {
      const part = (sel) => ((document.querySelector(`#cevIlDit ${sel}`) || {}).textContent || '').replace(/\s+/g, ' ').trim();
      const etat = (id, attribut) => { const b = document.getElementById(id); return b ? b.getAttribute(attribut) : 'absent'; };
      return {
        nom: (document.getElementById('cevIlNom') || {}).value || '',
        cases: Array.from(document.querySelectorAll('[data-cev-il-activite]')).map((c) => `${c.dataset.cevIlActivite}=${c.getAttribute('aria-pressed')}`),
        photos: Array.from(document.querySelectorAll('[data-cev-il-activite] .cev-il-ph')).filter((p) => /\/assets\/fungalaxy\/[a-z-]+-carte\.webp/.test(p.style.backgroundImage || '')).length,
        volonte: ['bowling', 'laser_game'].map((id) => `${id}=${etat(`cevIlV-${id}-oui`, 'aria-checked')}/${etat(`cevIlV-${id}-non`, 'aria-checked')}`),
        mots: ['bowling', 'laser_game'].map((id) => `${(document.getElementById(`cevIlV-${id}-oui`) || {}).textContent || ''}/${(document.getElementById(`cevIlV-${id}-non`) || {}).textContent || ''}`),
        dit: [part('b'), part('.cev-il-phrase'), part('em'), part('small')],
        duree: Array.from(document.querySelectorAll('[data-cev-il-duree][aria-checked="true"]')).map((b) => b.dataset.cevIlDuree).join(),
        enLigne: (document.getElementById('cevIlEnLigne') || {}).checked,
        // (jamais de deux-points au milieu d une phrase, ni de parenthese dans un choix)
        tordus: Array.from(document.querySelectorAll('#cevOverlay .cev-seg button, #cevIlDit *')).map((b) => b.textContent).filter((t) => / : |\(/.test(t)),
      };
    });
    const modale = await lireModale();
    ok(modale.nom === 'Accès illimité' && modale.cases.length === DU_CENTRE().length && modale.cases.every((c) => c.endsWith('=true')) && modale.photos === DU_CENTRE().length && modale.volonte.join() === 'bowling=true/false,laser_game=true/false' && modale.mots.join() === 'Gardé toute la visite/1 h, à heure fixe,Gardé toute la visite/1 partie, à heure fixe' && modale.duree === '180' && modale.enLigne === false, '[C] chaque activite du centre est prise, en photo ; bowling et laser « Gardé toute la visite », 3 h, au comptoir seulement', modale);
    ok(JSON.stringify(modale.dit) === JSON.stringify(['Accès illimité', 'Tout à volonté pendant 3 h', '', 'Bowling, pistes gardées toute la visite. Laser, armes gardées à chaque départ.']) && !modale.tordus.length, '[C] le formulaire montre ce que lit le comptoir, la phrase commune', modale);
    // La duree se touche : 4 h, puis 3 h.
    await page.locator('#cevIlD-240').click();
    const quatre = (await lireModale()).dit[1];
    await page.locator('#cevIlD-180').click();
    await page.locator('#cevIlPrix').fill('32');
    const fin = await lireModale();
    ok(quatre === 'Tout à volonté pendant 4 h' && fin.duree === '180' && fin.dit[1] === 'Tout à volonté pendant 3 h' && fin.dit[2] === '32 € par joueur', '[C] la duree se choisit d un toucher et la phrase la suit, le prix par joueur aussi', { quatre, fin: fin.dit, duree: fin.duree });
    await photo(page, 'tarifs-formulaire', '#cevOverlay .modal, #cevOverlay');
    await page.locator('#cevOverlay .btn-primary').click();
    await attendreBase(page, () => C.CATALOGUE_BANC.formules.has(ID_ILLIMITEE));
    await page.waitForTimeout(500);
    // Un deuxieme, au meme formulaire : sans les arcades, le bowling 1 h a heure fixe, 4 h.
    await page.locator('#tfIllimite').click();
    await page.waitForSelector('#cevIlNom');
    await page.locator('#cevIlNom').fill('Illimité sans arcades');
    await page.locator('[data-cev-il-activite="arcade_time"]').click();
    await page.locator('#cevIlV-bowling-non').click();
    await page.locator('#cevIlD-240').click();
    await page.locator('#cevIlPrix').fill('28');
    const deux = await lireModale();
    ok(deux.dit.join(' | ') === `Illimité sans arcades | ${DU_CENTRE().length - 1} activités à volonté pendant 4 h, sauf le bowling 1 h | 28 € par joueur | Bowling 1 h, à heure fixe. Laser, armes gardées à chaque départ.` && deux.volonte.join() === 'bowling=false/true,laser_game=true/false' && deux.cases.includes('arcade_time=false') && deux.duree === '240', '[C] retirer une activite, choisir « 1 h, à heure fixe » et 4 h : ce que lit le comptoir suit', deux);
    await page.locator('#cevOverlay .btn-primary').click();
    await attendreBase(page, () => C.CATALOGUE_BANC.formules.has(ID_SANS_ARCADES));
    await page.waitForTimeout(400);
    // LA LISTE dit l acces avec les mots du comptoir, pas « Toutes les activités illimitées · À volonté : … ».
    await page.waitForFunction((id) => { const l = document.querySelector(`[data-tf-ligne="${id}"] .tf-c-contenu`); return l && /à volonté/.test(l.textContent); }, ID_ILLIMITEE, { timeout: 10000 }).catch(() => {});
    const ligne = await page.evaluate((id) => ((document.querySelector(`[data-tf-ligne="${id}"] .tf-c-contenu`) || {}).textContent || '').replace(/\s+/g, ' ').trim(), ID_ILLIMITEE);
    ok(ligne === 'Tout à volonté pendant 3 h · Bowling, pistes gardées toute la visite · Laser, armes gardées à chaque départ', '[C] la liste de Tarifs dit l acces avec les mots du comptoir', ligne);
  } finally { await finir(m, 'C'); }
  verifierLaFormule();
  const sans = C.CATALOGUE_BANC.formules.get(ID_SANS_ARCADES) || {};
  const etapesSans = C.CATALOGUE_BANC.etapes.filter((e) => e.formula_id === ID_SANS_ARCADES).map((e) => e.activity_id);
  const servieSans = require(path.join(ROOT, 'lib/booking-config.js')).getEffectiveFormules(CENTRE, { comptoir: true }).find((f) => f.id === ID_SANS_ARCADES) || {};
  ok(sans.order_policy === 'illimite:laser_game' && memeEnsemble(etapesSans, DU_CENTRE().filter((id) => id !== 'arcade_time')) && servieSans.illimite && servieSans.illimite.minutes === 240, '[C] les cases decochees et « une fois » arrivent au catalogue', { politique: sans.order_policy, etapes: etapesSans, minutes: servieSans.illimite && servieSans.illimite.minutes });
  // La formule d avant : un corps sans cases ni choix, comme avant le 19/11.
  await garderParLeServeur({ ...CORPS_ILLIMITE, nom: 'Illimité d’avant' });
  const avant = C.CATALOGUE_BANC.formules.get(ID_D_AVANT) || {};
  const etapesAvant = C.CATALOGUE_BANC.etapes.filter((e) => e.formula_id === ID_D_AVANT).map((e) => e.activity_id);
  ok(avant.order_policy === 'illimite' && memeEnsemble(etapesAvant, DU_CENTRE()), '[C] une formule illimitee d avant (sans choix) reste celle d avant : tout, bowling et laser une fois', { politique: avant.order_policy, etapes: etapesAvant });
  retirerFormules([ID_SANS_ARCADES, ID_FORGEE, ID_D_AVANT]);
}

// Les formules d essai retirees du catalogue (le banc et le module vivant) : la porte de Reserver
// ne montre ensuite que l acces illimite du formulaire.
const ID_SANS_ARCADES = 'sm-libramont--illimite-sans-arcades';
const ID_FORGEE = 'sm-libramont--forgee-illimitee';
const ID_D_AVANT = 'sm-libramont--illimite-d-avant';
function retirerFormules(ids) {
  ids.forEach((id) => C.CATALOGUE_BANC.formules.delete(id));
  C.CATALOGUE_BANC.etapes = C.CATALOGUE_BANC.etapes.filter((e) => !ids.includes(e.formula_id));
  require(path.join(ROOT, STORE)).applyCatalogState({ formulas: [...C.CATALOGUE_BANC.formules.values()], steps: C.CATALOGUE_BANC.etapes.slice(), activities: [], centerClients: [{ id: 'libramont', client_id: 'fungalaxy' }, { id: 'gembloux', client_id: 'fungalaxy' }] });
}

// LES IMAGES (--captures=<dossier>) : jamais sous une contre-preuve.
const CAPTURES = typeof argument('captures') === 'string' ? argument('captures') : '';
async function photo(page, nom, selecteur = '') {
  if (!CAPTURES || mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  const cible = selecteur ? page.locator(selecteur).first() : null;
  if (cible && await cible.count()) await cible.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  else await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

function verifierLaFormule() {
  const ligne = C.CATALOGUE_BANC.formules.get(ID_ILLIMITEE) || {};
  const etapes = C.CATALOGUE_BANC.etapes.filter((e) => e.formula_id === ID_ILLIMITEE).sort((a, b) => a.position - b.position);
  const ids = etapes.map((e) => e.activity_id);
  ok(Boolean(ligne.id) && memeEnsemble(ids, DU_CENTRE()), '[C] au catalogue : toutes les activites du centre, et seulement elles', { ids, centre: DU_CENTRE() });
  const bowling = etapes.find((e) => e.activity_id === 'bowling') || {};
  const laser = etapes.find((e) => e.activity_id === 'laser_game') || {};
  const libres = etapes.filter((e) => e.activity_id !== 'bowling' && e.activity_id !== 'laser_game');
  ok(bowling.critical === true && Number(bowling.duration_minutes) === 60 && laser.critical === true && Number(laser.count) === 1 && libres.length > 0 && libres.every((e) => !e.critical && / à volonté$/.test(String(e.label))), '[C] bowling et laser a heure, le reste a volonte', etapes.map((e) => [e.activity_id, e.count, e.duration_minutes, e.critical, e.label]));
  ok(ligne.order_policy === 'illimite:bowling,laser_game' && ligne.price_type === 'per_pax' && Number(ligne.price_value) === 32, '[C] un prix par joueur, la formule dite illimitee, bowling et laser a volonte', { politique: ligne.order_policy, prix: ligne.price_value, type: ligne.price_type });
  ok(ligne.human_validation === 'comptoir' && !lePublicVoit(ID_ILLIMITEE) && lePublicRefuse(ID_ILLIMITEE), '[C] au comptoir seulement : les clients ne la voient pas', { validation: ligne.human_validation, voit: lePublicVoit(ID_ILLIMITEE) });
  // La regle des arrivees que la route publique, l agent et la console partagent
  // (getFormuleArrivalWindow) : la derniere arrivee est la fermeture moins la visite.
  const { getEffectiveFormules, getFormuleArrivalWindow, getSchedule } = require(path.join(ROOT, 'lib/booking-config.js'));
  const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
  const servie = getEffectiveFormules(CENTRE, { comptoir: true }).find((f) => f.id === ID_ILLIMITEE) || {};
  const fenetre = getFormuleArrivalWindow(servie, getSchedule(JOUR, getCenter(CENTRE))) || {};
  ok(servie.estimatedTotalDuration === 3 && servie.illimite && servie.illimite.minutes === 180 && memeEnsemble(servie.illimite.activites, DU_CENTRE()) && fenetre.latestStart === fenetre.periodEnd - 3, '[C] sa duree de visite borne les arrivees (la derniere : la fermeture moins 3 h)', { duree: servie.estimatedTotalDuration, illimite: servie.illimite, fenetre });
}

// ---------------------------------------------------------------------------
// [D] ELLE SE RESERVE AU COMPTOIR
// ---------------------------------------------------------------------------
async function scenarioD(browser) {
  console.log('\n[D] elle se reserve au comptoir');
  if (!C.CATALOGUE_BANC.formules.has(ID_ILLIMITEE)) {
    serveur.changerSession(C.roleDe('manager'));
    await garderParLeServeur({ ...CORPS_ILLIMITE, aVolonte: { bowling: true, laser_game: true } });
  }
  // La visite equivalente, au meme handler : toutes les activites, le meme groupe, la meme heure.
  const programme = DU_CENTRE().map((id) => ({ activityId: id, pax: JOUEURS, participants: JOUEURS, ...(id === 'bowling' ? { duration: 1 } : {}), ...(id === 'laser_game' ? { games: 1 } : {}) }));
  const m = await ouvrir(browser, { role: 'manager' });
  try {
    const { page } = m;
    await C.ouvrirFenetre(page, JOUEURS);
    await page.waitForFunction((id) => getEffectiveCatalogFormules().some((f) => f.id === id), ID_ILLIMITEE, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => rsPeindreActivites && rsPeindreActivites()).catch(() => {});
    await page.waitForSelector('#rsIllimite', { timeout: 8000 }).catch(() => {});
    // LA PORTE (2026-11-20) : la phrase commune, le prix par joueur et le total du groupe, lus partie par
    // partie ; « Ajouter toutes les activités » n est plus dans sa rangee (on les confondait) mais sous les
    // tuiles des activites. Elle tient sur l ecran sans l ecraser.
    const porte = await page.evaluate(() => {
      const b = document.getElementById('rsIllimite');
      const t = document.getElementById('rsToutes');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const part = (sel) => ((b.querySelector(sel) || {}).textContent || '').replace(/\s+/g, ' ').trim();
      return { parts: [part('b'), part('.rs-porte-l'), part('em span'), part('em small')], hauteur: Math.round(r.height), horsDeSaRangee: Boolean(t && !b.parentElement.contains(t) && document.getElementById('rsZ-petits').contains(t)), visible: r.top >= 0 && r.bottom <= innerHeight };
    });
    ok(porte && porte.parts.join(' | ') === 'Accès illimité | Tout à volonté pendant 3 h, à partir de 2 joueurs | 32 € par joueur | 320 € pour 10 joueurs' && porte.horsDeSaRangee && porte.visible && porte.hauteur <= 72, '[D] la porte « Accès illimité » : la phrase commune, le prix par joueur et le total du groupe', porte);
    if (CAPTURES && !mutation) await page.locator('#rsIllimite').scrollIntoViewIfNeeded().catch(() => {});
    await photo(page, 'reserver-porte');
    // « à partir de 2 joueurs », jamais « dès 2 » : la page des formules du centre.
    await page.locator('#rsFormules').click();
    await page.waitForTimeout(300);
    const formules = await page.evaluate(() => (document.querySelector('#quickBookOverlay') || document.body).innerText.replace(/\s+/g, ' '));
    ok(!/\bdès \d/.test(formules) && /à partir de \d+ joueurs/.test(formules) && !formules.includes('Accès illimité'), '[D] les formules disent « à partir de N joueurs », jamais « dès N » ; l acces illimite a sa porte a lui', formules.slice(0, 300));
    await page.evaluate(() => rsRetour());
    await page.waitForTimeout(200);
    // LA PAGE, UN SEUL BLOC (2026-11-20) : le nom, la phrase commune, le prix par joueur et le total, puis
    // chaque activite comprise en vraie photo (servie), son etiquette « à volonté ». Plus de « Compris : ».
    await page.locator('#rsIllimite').click();
    await page.waitForSelector('#rsAcces', { timeout: 8000 }).catch(() => {});
    const lireBloc = () => page.evaluate(async () => {
      const z = document.getElementById('rsAcces');
      const t = (sel) => (((z && z.querySelector(sel)) || {}).textContent || '').replace(/\s+/g, ' ').trim();
      const acts = Array.from(z ? z.querySelectorAll('.rs-ill-act') : []).map((li) => ({ id: li.dataset.illActivite, tag: ((li.querySelector('.rs-ill-tag') || {}).textContent || '').trim(), precision: ((li.querySelector('small') || {}).textContent || '').trim(), photo: (/url\("?([^")]+)"?\)/.exec(((li.querySelector('.rs-ill-ph') || {}).style || {}).backgroundImage || '') || [])[1] || '' }));
      const servies = await Promise.all(acts.map((a) => (a.photo ? fetch(a.photo).then((rep) => rep.status).catch(() => 0) : Promise.resolve(0))));
      return { tete: [t('.rs-acces-n b'), t('.rs-acces-n span'), t('.rs-acces-prix b'), t('.rs-acces-prix small')], acts, servies, texte: z ? z.textContent.replace(/\s+/g, ' ') : '' };
    });
    const bloc = await lireBloc();
    ok(bloc.tete.join(' | ') === 'Accès illimité | Tout à volonté pendant 3 h, à partir de 2 joueurs | 32 € par joueur | 320 € pour 10 joueurs'
      && memeEnsemble(bloc.acts.map((a) => a.id), DU_CENTRE()) && bloc.acts.every((a) => a.tag === 'à volonté' && /^\/assets\/fungalaxy\/[a-z-]+-carte\.webp$/.test(a.photo)) && bloc.servies.every((s) => s === 200)
      && !/Compris|Toutes les activités| : /.test(bloc.texte), '[D] sa page : la phrase commune, le prix et le total, chaque activite en vraie photo « à volonté »', bloc);
    await page.waitForSelector('.rs-s-l.is-formule .rs-h[data-heure="15:30"]', { timeout: 10000 });
    // La derniere arrivee proposee : une heure que le serveur accepte ; la demi-heure d apres, il la
    // refuse « hors horaires », et le comptoir ne la propose pas (sa regle est celle du serveur).
    await page.waitForSelector('.rs-s-l.is-formule[data-verifie="1"]', { timeout: 15000 }).catch(() => {});
    const heures = await page.evaluate(() => rsListeFormule().liste.map((x) => x.heure));
    const derniere = heures[heures.length - 1] || '';
    const apres = derniere ? `${String(Math.floor((enMin(derniere) + 30) / 60)).padStart(2, '0')}:${String((enMin(derniere) + 30) % 60).padStart(2, '0')}` : '';
    const blancDerniere = derniere ? await reserverIllimite('Essai', JOUEURS, derniere, ID_ILLIMITEE, { dryRun: true }) : null;
    const blancApres = apres ? await reserverIllimite('Essai', JOUEURS, apres, ID_ILLIMITEE, { dryRun: true }) : null;
    ok(derniere && blancDerniere && (blancDerniere.json.plan || {}).disponible === true && blancApres && /hors horaires/.test(String((blancApres.json.plan || {}).refus || '')) && !heures.includes(apres), '[D] la derniere arrivee proposee, le serveur l accepte ; la suivante, il la refuse et le comptoir ne la propose pas', { fin: heures.slice(-3), derniere: blancDerniere && blancDerniere.json.plan && blancDerniere.json.plan.disponible, apres, refus: blancApres && blancApres.json.plan && blancApres.json.plan.refus });
    await page.locator('.rs-s-l.is-formule .rs-h[data-heure="15:30"]').click();
    await C.pret(page);
    await page.waitForTimeout(400);
    const ids = await page.evaluate(() => rvActivites());
    ok(memeEnsemble(ids, DU_CENTRE()), '[D] au ticket : toutes ses activites', { ecran: ids, centre: DU_CENTRE() });
    const ticket = await page.evaluate(() => ({
      duree: ((document.getElementById('rsDureeFormule') || {}).textContent || '').trim(),
      detail: ((document.querySelector('#rsL-a-formule .rs-tk-n small') || {}).textContent || '').trim(),
      garde: Array.from(document.querySelectorAll('.rs-tk-n small.is-garde')).map((s) => s.textContent.trim()),
    }));
    ok(ticket.duree === 'Tout à volonté de 15:30 à 18:30.' && ticket.detail === ticket.duree && ticket.garde.length === 2 && ticket.garde.some((l) => /^Bowling, pistes \d+ et \d+ gardées toute la visite\.$/.test(l)) && ticket.garde.includes(`Laser, ${JOUEURS} armes gardées à chaque départ.`), '[D] au ticket : ce qui est garde, en clair', ticket);
    // Sur le plan, les photos du bowling et du laser disent ce qui est garde (les pistes, les armes).
    const apresHeure = await lireBloc();
    const tagDe = (id) => apresHeure.acts.find((a) => a.id === id) || {};
    ok(tagDe('bowling').tag === 'à volonté' && /^pistes \d+ et \d+$/.test(tagDe('bowling').precision) && tagDe('laser_game').precision === `${JOUEURS} armes`, '[D] sur le plan, les photos disent les pistes et les armes gardees', apresHeure.acts);
    await photo(page, 'reserver-ticket', '#quickBookOverlay .rs, #quickBookOverlay');
    const debut = new Set([...B.base.reservations.keys()]);
    await creer(page, 'Team building Formule');
    const [r] = await neufs(page, debut);
    const f = retenues(r);
    ok(r && r.formule_id === ID_ILLIMITEE && Number(r.price) === 32 * JOUEURS && f.pistes.length >= 2 && f.uneFois === 0, '[D] le dossier : la formule, son prix, pistes et arene retenues', r && { formule: r.formule_id, prix: r.price, retenues: f });
    ok(r && f.gardees.join() === `15:30-18:30:${f.pistes.length}` && f.departs.join() === departsAttendus('15:30', '18:30', JOUEURS).join(), '[D] le dossier garde ses pistes toute la visite et ses armes a chaque depart', f);
    // La fiche et le planning le disent.
    await page.waitForFunction((id) => state.reservations.some((x) => String(x.id) === String(id)), r && r.id, { timeout: 8000 }).catch(() => {});
    const vu = await page.evaluate((id) => {
      const res = state.reservations.find((x) => String(x.id) === String(id));
      openPos(res.id);
      const fiche = ((document.getElementById('ficheAcces') || {}).innerText || '').replace(/\s+/g, ' ').trim();
      // (le programme de la fiche : ses activites libres sans heure, « à volonté »)
      const programme = Array.from(document.querySelectorAll('#posOverlay .gc-steps .gc-step')).map((li) => ({
        nom: ((li.querySelector('.gc-step-what b') || {}).textContent || '').trim(),
        quand: ((li.querySelector('.gc-step-time') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        detail: ((li.querySelector('.gc-step-what small') || {}).textContent || '').trim(),
      }));
      closePos();
      renderStaff();
      // Le grand tableau du jour : la rangee du groupe, ses cases Bowling et Laser.
      const rangee = document.querySelector(`#globalPlanningGridWrap tr[data-gf-id="${res.id}"]`);
      const cases = (titre) => (rangee ? Array.from(rangee.querySelectorAll(`.gf-a[data-gf-titre="${titre}"] .gf-x`)) : []).map((c) => ({ titre: c.getAttribute('title') || '', texte: c.textContent.replace(/\s+/g, ' ').trim() }));
      const cartes = { bowling: cases('Bowling'), laser: cases('Laser') };
      // (ses autres activites : « à volonté », sans l heure que le moteur leur suggerait)
      const autres = rangee ? Array.from(rangee.querySelectorAll('.gf-a[data-gf-titre] .gf-x')).filter((c) => !/^(Bowling|Laser)$/.test(c.closest('.gf-a').getAttribute('data-gf-titre'))).map((c) => ({ case: c.closest('.gf-a').getAttribute('data-gf-titre'), texte: c.textContent.replace(/\s+/g, ' ').trim() })).filter((c) => !/crédits/.test(c.texte)) : [];
      return { fiche, programme, cartes, autres };
    }, r && r.id);
    const pistesDites = `pistes ${f.pistes.slice(0, -1).join(', ')} et ${f.pistes[f.pistes.length - 1]}`;
    ok(vu.fiche === `Accès illimité Tout à volonté de 15:30 à 18:30. Bowling, ${pistesDites} gardées toute la visite. Laser, ${JOUEURS} armes gardées à chaque départ.`, '[D] la fiche le dit en une phrase', vu.fiche);
    const departs = departsAttendus('15:30', '18:30', JOUEURS).map((d) => d.slice(0, 5));
    ok(vu.cartes.bowling.length === 1 && vu.cartes.bowling[0].titre.startsWith(`Bowling à volonté de 15:30 à 18:30 · pistes ${f.pistes.join('-')} gardées toute la visite`) && /à volonté/.test(vu.cartes.bowling[0].texte)
      && departs.length > 1 && vu.cartes.laser.length === 1 && vu.cartes.laser[0].titre.startsWith(`Laser à volonté · ${departs.length} départs, de ${departs[0]} à ${departs[departs.length - 1]} · ${JOUEURS} armes gardées`)
      && /à volonté/.test(vu.cartes.laser[0].texte) && vu.cartes.laser[0].texte.includes(`${departs.length} départs`), '[D] le planning montre les pistes et les armes gardees', vu.cartes);
    ok(vu.autres.length > 0 && vu.autres.every((c) => /à volonté/.test(c.texte) && !/\d{1,2}:\d{2}/.test(c.texte)), '[D] au planning, ses autres activites disent « à volonté », sans heure', vu.autres);
    const libresFiche = vu.programme.filter((l) => l.nom && !/^(Bowling|Laser)/.test(l.nom));
    ok(libresFiche.length > 0 && libresFiche.every((l) => l.quand === 'Libre' && l.detail === 'à volonté'), '[D] la fiche : ses autres activites sans heure, « à volonté »', vu.programme);
    await photo(page, 'planning-gardees');
    // La visite equivalente, creee au meme handler a une autre heure et lue de la meme facon.
    const visite = await serveur.appeler('POST', '/api/staff-reservations', { centerId: CENTRE, date: JOUR, startTime: '18:00', duration: 1, totalDuration: 1, lanes: [], pax: JOUEURS, status: 'pending', type: 'visite', name: 'Visite equivalente', phone: TEL, program: programme, preference: { activityOrder: programme.map((l) => l.activityId), preferredTimes: { bowling: '18:00', laser_game: '19:00' }, laserGameTimes: ['19:00'], laserPlacement: 'scheduled' } });
    const lue = visite.json.reservation && visite.json.reservation.id ? B.base.reservations.get(Number(visite.json.reservation.id)) : null;
    const v = lue ? retenues(lue) : null;
    ok(r && v && v.pistes.length > 0 && f.pistes.length >= v.pistes.length && f.minutesBowling >= v.minutesBowling && f.armes >= v.armes && f.parties >= v.parties, '[D] pas moins de ressources qu une visite equivalente', { formule: f, visite: v, statut: visite.statut, message: visite.json.message });
  } finally { await finir(m, 'D'); }
}

// ---------------------------------------------------------------------------
// [F] UNE JOURNEE CHARGEE, A VOLONTE
// ---------------------------------------------------------------------------
// Quatre pistes (1 a 4) prises de 15:30 a 16:30 et 10 armes au depart de 16:30 par d autres
// groupes ; puis des groupes a volonte, une visite ordinaire, droit au serveur.
const CHARGEE = () => {
  const maintenant = new Date().toISOString();
  const autre = (id, nom, d) => ({ ...d, id, name: nom, channel: 'staff', status: 'confirmed', createdAt: maintenant, updatedAt: maintenant });
  return [autre(9201, 'Anniversaire pistes', C.dossierRetenu({ heure: '15:30', pistes: [1, 2, 3, 4], joueurs: 20 })), autre(9202, 'Laser de 16:30', C.dossierRetenu({ heure: '16:30', laser: 10 }))];
};
const reserverIllimite = (nom, joueurs, heure, formuleId = ID_ILLIMITEE, extra = {}) => serveur.appeler('POST', '/api/staff-reservations', { centerId: CENTRE, date: JOUR, startTime: heure, duration: 1, totalDuration: 3, pax: joueurs, status: 'pending', type: 'formule', formuleId, name: nom, phone: TEL, lanes: [], ...extra });
const dossierDe = (rep) => (rep.json.reservation && rep.json.reservation.id ? B.base.reservations.get(Number(rep.json.reservation.id)) : null);

async function scenarioF(browser) {
  console.log('\n[F] une journee chargee, a volonte');
  if (!C.CATALOGUE_BANC.formules.has(ID_ILLIMITEE)) { serveur.changerSession(C.roleDe('manager')); await garderParLeServeur({ ...CORPS_ILLIMITE, aVolonte: { bowling: true, laser_game: true } }); }
  const m = await ouvrir(browser, { role: 'manager', reservations: CHARGEE });
  try {
    serveur.changerSession(C.roleDe('manager'));
    const a = await reserverIllimite('Groupe A', 10, '15:30');
    const ra = dossierDe(a);
    const ta = ra ? retenues(ra) : null;
    ok(ra && ta.gardees.join() === `15:30-18:30:${ta.pistes.length}` && ta.pistes.length >= 2 && !ta.pistes.some((p) => p <= 4) && ta.departs.join() === departsAttendus('15:30', '18:30', 10).join(), '[F] le premier groupe a volonte passe : ses pistes de 15:30 a 18:30, 10 armes a chaque depart', { statut: a.statut, message: a.json.message, retenues: ta });
    const avantRefus = B.base.reservations.size;
    // Ce que lit le comptoir avant « Créer » (le plan a blanc de la fenetre Reserver), puis l envoi.
    const blancB = await reserverIllimite('Groupe B', 20, '16:00', ID_ILLIMITEE, { dryRun: true });
    const b = await reserverIllimite('Groupe B', 20, '16:00');
    const c = await reserverIllimite('Groupe C', 18, '17:00');
    const rc = dossierDe(c);
    const blancD = await reserverIllimite('Groupe D', 5, '17:30', ID_ILLIMITEE, { dryRun: true });
    const d = await reserverIllimite('Groupe D', 5, '17:30');
    const messageB = String(((blancB.json.plan || {}).refus) || '');
    const messageD = String(((blancD.json.plan || {}).refus) || '');
    ok(b.statut >= 400 && !dossierDe(b) && /Bowling à volonté : il faut \d+ pistes libres de 16:00 à 19:00, seulement 2 le sont\. Choisissez une autre heure\./.test(messageB)
      && rc && d.statut >= 400 && !dossierDe(d) && /Laser à volonté : il reste 2 armes au départ de 17:30, il en faut 5 à chaque départ de 17:30 à 20:30\. Choisissez une autre heure\./.test(messageD)
      && B.base.reservations.size === avantRefus + 1,
    '[F] le groupe qui ne passe pas lit ce qui bloque', { b: [b.statut, messageB, b.json.message], c: [c.statut, c.json.message], d: [d.statut, messageD, d.json.message] });
    // Une visite ordinaire passe a cote : rien de garde.
    const e = await serveur.appeler('POST', '/api/staff-reservations', { centerId: CENTRE, date: JOUR, startTime: '19:00', duration: 1, totalDuration: 1.5, lanes: [], pax: 6, status: 'pending', type: 'visite', name: 'Visite ordinaire', phone: TEL, program: [{ activityId: 'bowling', pax: 6, participants: 6, duration: 1 }, { activityId: 'laser_game', pax: 6, participants: 6, games: 1 }], preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '19:00', laser_game: '20:00' }, laserGameTimes: ['20:00'], laserPlacement: 'scheduled' } });
    const re = dossierDe(e);
    ok(re && retenues(re).gardees.length === 0 && retenues(re).departs.length === 0, '[F] un groupe ordinaire passe a cote, sans rien garder', { statut: e.statut, message: e.json.message, retenues: re && retenues(re) });
    const bilan = chevauchementsDeLaJournee();
    ok(bilan.dossiers >= 5 && bilan.doubles.length === 0 && bilan.arene.length === 0, '[F] sur la journee, aucune piste prise deux fois, l arene jamais au-dela de ses armes', bilan);
    // Le meme nombre de pistes qu une fois, pour le meme groupe : la regle des pistes ne change pas.
    const essai = await reserverIllimite('Essai', 10, '20:00', ID_ILLIMITEE, { dryRun: true });
    const visite = await serveur.appeler('POST', '/api/staff-reservations', { centerId: CENTRE, date: JOUR, startTime: '20:00', duration: 1, totalDuration: 1, lanes: [], pax: 10, type: 'visite', name: 'Essai', phone: TEL, program: [{ activityId: 'bowling', pax: 10, participants: 10, duration: 1 }], dryRun: true });
    const pistesDe = (rep) => { const p = rep.json.plan || {}; const blocs = (p.resourceBlocks || p.blocs || (p.opsPlan || {}).resourceBlocks || []).filter((x) => (x.resourceType || x.ressource) === 'bowling_lane'); return Math.max(0, ...blocs.map((x) => Number(x.requiredLanes) || (x.lanes || x.pistes || []).length)); };
    ok(ta && ta.pistes.length === pistesDe(visite) && pistesDe(essai) === pistesDe(visite), '[F] a volonte, le meme nombre de pistes qu une fois pour le meme groupe', { aVolonte: ta && ta.pistes.length, essai: pistesDe(essai), uneFois: pistesDe(visite), cles: Object.keys(essai.json.plan || {}), statuts: [essai.statut, visite.statut, essai.json.message || visite.json.message] });
  } finally { await finir(m, 'F'); }
}

// ---------------------------------------------------------------------------
// [G] « UNE FOIS » ET LA FORMULE D AVANT
// ---------------------------------------------------------------------------
async function scenarioG() {
  console.log('\n[G] une fois, et la formule d avant');
  serveur.changerSession(C.roleDe('manager'));
  await garderParLeServeur({ ...CORPS_ILLIMITE, nom: 'Illimité d’avant' });
  await garderParLeServeur({ ...CORPS_ILLIMITE, nom: 'Illimité sans arcades', activites: DU_CENTRE().filter((id) => id !== 'arcade_time'), aVolonte: { bowling: false, laser_game: true } });
  B.semer([]);
  try {
    const avant = dossierDe(await reserverIllimite('Formule d avant', JOUEURS, '16:00', ID_D_AVANT));
    const ta = avant ? retenues(avant) : null;
    ok(ta && ta.gardees.length === 0 && ta.departs.length === 0 && ta.minutesBowling === 60 && ta.armes === JOUEURS && ta.parties === 1, '[G] la formule d avant : bowling 1 h et une partie de laser a leur heure, rien de garde', ta);
    const sans = dossierDe(await reserverIllimite('Sans arcades', 6, '16:00', ID_SANS_ARCADES));
    const ts = sans ? retenues(sans) : null;
    ok(ts && ts.gardees.length === 0 && ts.minutesBowling === 60 && ts.uneFois === 1 && ts.departs.join() === departsAttendus('16:00', '19:00', 6).join() && !programmeDe(sans).some((l) => l.activityId === 'arcade_time'), '[G] « une fois » : le bowling 1 h a son heure, comme avant ; le laser garde ; les arcades decochees absentes', ts);
    // Une formule ordinaire du socle ne garde rien.
    const ordinaire = require(path.join(ROOT, 'lib/booking-config.js')).getEffectiveFormules(CENTRE).find((f) => !f.illimite && /bowling/i.test(JSON.stringify(f)) && /laser/i.test(JSON.stringify(f)));
    const ro = ordinaire ? dossierDe(await reserverIllimite('Formule ordinaire', JOUEURS, '20:00', ordinaire.id)) : null;
    ok(ro && retenues(ro).gardees.length === 0 && retenues(ro).departs.length === 0, '[G] une formule ordinaire ne garde rien', { formule: ordinaire && ordinaire.id, retenues: ro && retenues(ro) });
  } finally { retirerFormules([ID_D_AVANT, ID_SANS_ARCADES]); }
}

// ---------------------------------------------------------------------------
// [I] DANS MODIFIER : PASSER EN ACCES ILLIMITE, ET EN REVENIR
// ---------------------------------------------------------------------------
async function enregistrerEdition(page) {
  await page.locator('#posOverlay .es-save').click();
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(150);
    const bouton = page.locator('.staff-confirm [data-role="confirm-ok"]');
    if (await bouton.count()) await bouton.click();
    const fermee = await page.evaluate(() => !document.querySelector('#posOverlay .edit-modal') || !state.selectedRes);
    if (fermee) break;
  }
  await page.waitForTimeout(300);
}
const verdictPose = async (page) => {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => { const z = document.getElementById('editVerdict'); return !z || (!z.classList.contains('is-calcul') && !(typeof verdictEdition === 'function' && verdictEdition().enCours)); }, null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(200);
};

async function scenarioI(browser) {
  console.log('\n[I] dans Modifier : passer en acces illimite, et en revenir');
  if (!C.CATALOGUE_BANC.formules.has(ID_ILLIMITEE)) { serveur.changerSession(C.roleDe('manager')); await garderParLeServeur({ ...CORPS_ILLIMITE, aVolonte: { bowling: true, laser_game: true } }); }
  const m = await ouvrir(browser, { role: 'manager', reservations: () => [{ ...C.dossierRetenu({ heure: '20:00', laser: 25 }), id: 9302, name: 'Laser plein', channel: 'staff', status: 'confirmed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
  try {
    const { page } = m;
    // Le dossier de depart : une visite bowling creee au comptoir, comme Rachel l aurait prise.
    const cree = await serveur.appeler('POST', '/api/staff-reservations', { centerId: CENTRE, date: JOUR, startTime: '16:00', duration: 1, totalDuration: 1, lanes: [], pax: JOUEURS, status: 'confirmed', type: 'visite', name: 'Groupe Rachel', phone: TEL, program: [{ activityId: 'bowling', pax: JOUEURS, participants: JOUEURS, duration: 1 }], preference: { activityOrder: ['bowling'], preferredTimes: { bowling: '16:00' } } });
    const ID = Number(cree.json.reservation && cree.json.reservation.id);
    ok(Boolean(ID), '[I] le dossier de depart (une visite bowling) est cree', { statut: cree.statut, message: cree.json.message });
    if (!ID) return;
    await page.evaluate((r) => { window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(r); upsertReservationInState(r); renderStaff(); }, cree.json.reservation);
    // Le serveur sait juger une modification a blanc (staff-state : modificationABlanc, comme en ligne).
    await page.evaluate(() => { serveurSaitModifierABlanc = true; }); // eslint-disable-line no-undef
    // LE SELECTEUR « À LA CARTE | ACCÈS ILLIMITÉ » (2026-11-20). Modifier ouvert sans passer par Reserver lit
    // lui-meme les formules gardees ; « À la carte » est pris, la phrase dessous dit ce que l autre donne.
    await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, ID);
    await page.waitForSelector(`#posOverlay .fm-choix-seg [data-formule="${ID_ILLIMITEE}"]`, { timeout: 8000 }).catch(() => {});
    const lireChoix = () => page.evaluate(() => {
      const z = document.getElementById('editAcces');
      return {
        segments: Array.from(z ? z.querySelectorAll('.fm-choix-seg button') : []).map((b) => `${b.textContent.trim()}=${b.getAttribute('aria-checked')}`),
        dit: (((z && z.querySelector('.fm-choix-dit')) || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        anciens: Boolean(document.querySelector('#posOverlay .fm-acces-btn')) || /Passer en|Revenir/.test((z || {}).textContent || ''),
      };
    });
    // Toucher le choix deja pris ne rejoue rien : ni changement du dossier, ni fenetre redessinee.
    const toucherLePris = async (selecteur) => {
      await page.evaluate(() => { const z = document.getElementById('editAcces'); if (z) z.dataset.marque = 'avant'; });
      await page.locator(selecteur).click();
      await page.waitForTimeout(250);
      return page.evaluate(() => ({ marque: ((document.getElementById('editAcces') || {}).dataset || {}).marque || '', normal: Boolean(state.editState && state.editState.versProgrammeNormal), type: state.editState && state.editState.type, formule: (state.editState && state.editState.formuleId) || '' }));
    };
    const avantChoix = await lireChoix();
    ok(avantChoix.segments.join() === 'À la carte=true,Accès illimité=false' && avantChoix.dit === 'Accès illimité, tout à volonté pendant 3 h, 32 € par joueur.' && !avantChoix.anciens, '[I] dans Modifier : « À la carte | Accès illimité », ce que l acces promet et son prix', avantChoix);
    const versIllimite = `#posOverlay .fm-choix-seg [data-formule="${ID_ILLIMITEE}"]`;
    if (!(await page.locator(versIllimite).count())) return;
    const carteDejaPrise = await toucherLePris('#editAccesSortir');
    ok(carteDejaPrise.marque === 'avant' && !carteDejaPrise.normal && carteDejaPrise.type !== 'formule' && !carteDejaPrise.formule, '[I] « À la carte » deja pris ne change rien au dossier', carteDejaPrise);
    await page.locator(versIllimite).click();
    await verdictPose(page);
    const choisi = await lireChoix();
    ok(choisi.segments.join() === 'À la carte=false,Accès illimité=true' && /^Tout à volonté de 16:00 à 19:00\. Bowling, pistes? [\d ,et]+ gardées? toute la visite\. Laser, 10 armes gardées à chaque départ\.$/.test(choisi.dit), '[I] le verdict du serveur dit ce qui sera garde, et le chemin du retour', choisi);
    const illimiteDejaPris = await toucherLePris(versIllimite);
    ok(illimiteDejaPris.marque === 'avant' && illimiteDejaPris.formule === ID_ILLIMITEE && !illimiteDejaPris.normal, '[I] « Accès illimité » deja pris ne rejoue pas sa carte', illimiteDejaPris);
    // Les rangees du bowling et du laser disent ce qui est garde, plus « 1 heure / 1 partie » de la carte.
    const rangees = await page.evaluate(() => {
      const t = (sel) => ((document.querySelector(sel) || {}).textContent || '').trim();
      const reglages = Array.from(document.querySelectorAll('#posOverlay [data-edit-activity="bowling"] .dossier-option, #posOverlay [data-edit-activity="laser_game"] .dossier-option, #posOverlay [data-edit-activity="bowling"] select, #posOverlay [data-edit-activity="laser_game"] select')).map((b) => b.textContent.replace(/\s+/g, ' ').trim());
      return { bowling: t('#posOverlay [data-a-volonte="bowling"]'), laser: t('#posOverlay [data-a-volonte="laser_game"]'), reglages };
    });
    ok(/^Bowling, pistes? [\d ,et]+ gardées? toute la visite\.$/.test(rangees.bowling) && rangees.laser === `Laser, ${JOUEURS} armes gardées à chaque départ.` && rangees.reglages.length === 0, '[I] sous l acces illimite, les rangees disent ce qui est garde, plus « 1 heure / 1 partie »', rangees);
    await photo(page, 'modifier-passer', '#posOverlay .edit-modal');
    await enregistrerEdition(page);
    const passe = B.base.reservations.get(ID);
    const tp = retenues(passe);
    ok(passe && passe.formule_id === ID_ILLIMITEE && passe.type === 'formule' && Number(passe.price) === 32 * JOUEURS && tp.gardees.join() === `16:00-19:00:${tp.pistes.length}` && tp.departs.join() === departsAttendus('16:00', '19:00', JOUEURS).join(), '[I] enregistre : le dossier en acces illimite, au prix de la formule, pistes et armes gardees par le serveur', passe && { formule: passe.formule_id, type: passe.type, prix: passe.price, retenues: tp });
    // Et en revenir : « À la carte », un programme normal de ses activites, chacune a son prix. Repris
    // puis rendu, le dossier redevient ce qu il etait.
    await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, ID);
    await page.waitForTimeout(300);
    const deja = await lireChoix();
    ok(deja.segments.join() === 'À la carte=false,Accès illimité=true' && /^Tout à volonté de 16:00 à 19:00\./.test(deja.dit) && await page.locator('#editAccesSortir').count() === 1, '[I] « À la carte » se touche sur un dossier en acces illimite', deja);
    if (!(await page.locator('#editAccesSortir').count())) return;
    await page.locator('#editAccesSortir').click();
    await verdictPose(page);
    const carte = await lireChoix();
    await page.locator(versIllimite).click();
    await page.waitForTimeout(250);
    const repris = await page.evaluate(() => ({ normal: Boolean(state.editState && state.editState.versProgrammeNormal), formule: (state.editState && state.editState.formuleId) || '' }));
    const reprisVu = await lireChoix();
    await page.locator('#editAccesSortir').click();
    await verdictPose(page);
    ok(carte.segments.join() === 'À la carte=true,Accès illimité=false' && carte.dit === 'Chaque activité à son prix, le bowling et le laser à leur heure. Les pistes et les armes ne sont plus gardées toute la visite.'
      && !repris.normal && repris.formule === ID_ILLIMITEE && reprisVu.segments.join() === 'À la carte=false,Accès illimité=true', '[I] « À la carte » puis « Accès illimité » : le dossier redevient ce qu il etait', { carte, repris, reprisVu });
    await photo(page, 'modifier-revenir', '#posOverlay .edit-modal');
    await enregistrerEdition(page);
    const revenu = B.base.reservations.get(ID);
    const tr = retenues(revenu);
    ok(revenu && !revenu.formule_id && revenu.type !== 'formule' && tr.gardees.length === 0 && tr.departs.length === 0 && memeEnsemble(programmeDe(revenu).map((l) => l.activityId), DU_CENTRE()) && Math.abs(Number(revenu.price) - prixDuProgramme(programmeDe(revenu), String(revenu.start_time).slice(0, 5))) < 0.01, '[I] « À la carte » : une visite de ses activites, rien de garde, chacune a son prix', revenu && { formule: revenu.formule_id, type: revenu.type, prix: revenu.price, programme: programmeDe(revenu).map((l) => l.activityId), retenues: tr });
    // Une bascule forgee sur une heure pleine (25 armes prises au depart de 20:00) : le corps que la
    // console enverrait, droit au serveur, qui la verifie comme une creation.
    const avant = JSON.stringify(B.base.reservations.get(ID));
    const forge = await page.evaluate(async ({ i, formule }) => {
      const r = state.reservations.find((x) => String(x.id) === String(i));
      const corps = { ...buildReservationApiPayload({ ...r, startTime: '19:00', type: 'formule', formuleId: formule, label: 'Accès illimité', program: null, opsPlan: null }, {}), baseUpdatedAt: r.updatedAt };
      return window.__vraiAppel('PATCH', '/api/staff-reservations', corps);
    }, { i: ID, formule: ID_ILLIMITEE });
    const message = String((forge.json || {}).message || (forge.json || {}).error || '');
    ok(forge.statut >= 400 && JSON.stringify(B.base.reservations.get(ID)) === avant && /Laser/.test(message), '[I] une bascule forgee sur une heure pleine est refusee, avec la phrase, rien n est ecrit', { statut: forge.statut, message });
  } finally { await finir(m, 'I'); }
}

// ---------------------------------------------------------------------------
// [E] UNE FORMULE ORDINAIRE NE CHANGE PAS, OCTET POUR OCTET
// ---------------------------------------------------------------------------
// Un module relu tel qu il est sur le disque, le chemin illimite retire : c est le code d avant
// pour tout ce qui n est pas illimite. Il se compile sous un autre nom (la mutation d une
// contre-preuve ne le touche pas) ; le module vivant, lui, porte la mutation.
function compiler(rel, retirer, nom) {
  const source = lf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  if (source.split(retirer.de).length !== 2) throw new Error(`[E] ${rel} : le chemin illimite a retirer n est plus la (${retirer.de.slice(0, 60)})`);
  const fichier = path.join(ROOT, path.dirname(rel), nom);
  const module_ = new Module(fichier, module);
  module_.filename = fichier;
  module_.paths = Module._nodeModulePaths(path.dirname(fichier));
  module_._compile(source.split(retirer.de).join(retirer.vers), fichier);
  return module_.exports;
}
const SANS_ILLIMITE_FC = { de: "  if (corps.illimite === true) {\n    const champs = champsDeFormule(corps);\n    const duree = dureeIllimiteeLue(corps.dureeMinutes);", vers: "  if (false) {\n    const champs = champsDeFormule(corps);\n    const duree = dureeIllimiteeLue(corps.dureeMinutes);" };
const SANS_ILLIMITE_STORE = { de: '  if (estOrdreIllimite(canonical.orderPolicy)) {', vers: '  if (false) {' };

async function scenarioE() {
  console.log('\n[E] une formule ordinaire ne change pas');
  const vivant = require(path.join(ROOT, FC_FICHIER));
  const avant = compiler(FC_FICHIER, SANS_ILLIMITE_FC, 'formule-comptoir.sans-illimite.js');
  const corps = [
    { nom: 'Forgee', prixParPersonne: 10, minPax: 2, activites: [{ id: 'bowling', minutes: 60, nom: 'Bowling 1 h' }], lignes: [] },
    { nom: 'Anniv du club', prixParPersonne: 22, minPax: 6, activites: [{ id: 'bowling', minutes: 90 }, { id: 'laser_game', parties: 2 }, { id: 'arcade_time', minutes: 30 }, { id: 'minigolf_blacklight' }], lignes: [{ nom: 'Crêpe au sucre', qte: 1, parPersonne: true }], clients: true },
    { nom: 'Pas illimitee', prixParPersonne: 15, minPax: 1, illimite: 'true', activites: [{ id: 'playground' }], lignes: [] },
  ];
  const activitesDuCentre = listCenterActivities(CENTRE);
  const differences = corps.map((c) => [JSON.stringify(vivant.formuleDepuisLeComptoir(c, { activitesDuCentre })), JSON.stringify(avant.formuleDepuisLeComptoir(c))]).filter(([a, b]) => a !== b);
  ok(differences.length === 0, '[E] lib/formule-comptoir.js : une formule ordinaire, octet pour octet', differences[0] || '');

  // Le catalogue : une formule ordinaire gardee, l illimitee, et tout le socle, sous les deux codes.
  if (!C.CATALOGUE_BANC.formules.has(ID_ILLIMITEE)) { serveur.changerSession(C.roleDe('manager')); await garderParLeServeur(CORPS_ILLIMITE); }
  if (![...C.CATALOGUE_BANC.formules.values()].some((f) => !String(f.order_policy || '').startsWith('illimite'))) await garderParLeServeur(corps[1]);
  const etat = { formulas: [...C.CATALOGUE_BANC.formules.values()], steps: C.CATALOGUE_BANC.etapes.slice(), activities: [], centerClients: [{ id: 'libramont', client_id: 'fungalaxy' }, { id: 'gembloux', client_id: 'fungalaxy' }] };
  const neuf = compiler(STORE, { de: SANS_ILLIMITE_STORE.de, vers: SANS_ILLIMITE_STORE.de }, 'catalog-store.js');
  const ancien = compiler(STORE, SANS_ILLIMITE_STORE, 'catalog-store.sans-illimite.js');
  neuf.applyCatalogState(JSON.parse(JSON.stringify(etat)));
  ancien.applyCatalogState(JSON.parse(JSON.stringify(etat)));
  const ecarts = [];
  let vues = 0;
  const illimitees = new Set([...C.CATALOGUE_BANC.formules.values()].filter((f) => String(f.order_policy || '').startsWith('illimite')).map((f) => f.id));
  ['libramont', 'gembloux'].forEach((centre) => {
    const a = neuf.listBookingFormules(centre).filter((f) => !illimitees.has(f.id));
    const b = ancien.listBookingFormules(centre).filter((f) => !illimitees.has(f.id));
    if (JSON.stringify(a) !== JSON.stringify(b)) ecarts.push({ centre, liste: true });
    a.forEach((f) => {
      vues += 1;
      if (JSON.stringify(neuf.getFormulaDoc(f.id, centre)) !== JSON.stringify(ancien.getFormulaDoc(f.id, centre))) ecarts.push({ centre, id: f.id });
    });
  });
  const illimitee = neuf.listBookingFormules(CENTRE).find((f) => f.id === ID_ILLIMITEE);
  ok(ecarts.length === 0 && vues > 20 && illimitee && illimitee.illimite, '[E] lib/catalog-store.js : les formules ordinaires, octet pour octet', { ecarts: ecarts.slice(0, 3), vues, illimitee: Boolean(illimitee && illimitee.illimite) });
}

// ---------------------------------------------------------------------------
const SCENARIOS = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD, F: scenarioF, G: scenarioG, I: scenarioI, E: scenarioE };

function verifierLesAncres() {
  let mortes = 0;
  MUTATIONS.forEach((m) => { const n = compteAncre(m); if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom} trouvee ${n} fois : ${m.de.slice(0, 80)}`); } });
  const noms = new Set(MUTATIONS.map((m) => m.nom));
  if (noms.size !== MUTATIONS.length) { mortes += 1; console.log('FAIL  deux contre-preuves portent le meme nom'); }
  console.log(`formule-illimitee-check --ancres : ${MUTATIONS.length - mortes}/${MUTATIONS.length} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = trancher(voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS);
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, ILLIMITE_CASSE: m.nom, PINLANE_ILLIMITE_PORT: String(PORT + 1 + fil) },
    timeout: 300000,
  }));
  let mordent = 0;
  liste.forEach((m, i) => {
    const sortie = `${runs[i].stdout || ''}${runs[i].stderr || ''}`;
    if (runs[i].status === 2) { console.log(`FAIL  contre-preuve ${m.nom} DESARMEE : ${sortie.trim().split('\n').pop()}`); return; }
    const rouges = sortie.split('\n').filter((l) => l.startsWith('FAIL'));
    if (rouges.some((l) => l.includes(m.cible))) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : « ${m.cible} » rougit`); return; }
    console.log(`FAIL  contre-preuve ${m.nom} : « ${m.cible} » reste vert (${rouges.length} autre(s) rouge(s) : ${rouges[0] ? rouges[0].slice(0, 140) : sortie.trim().split('\n').pop().slice(0, 160)})`);
  });
  console.log(`formule-illimitee-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: C.BROWSER_PATH, headless: true });
  try {
    for (const nom of seul) {
      try { await SCENARIOS[nom](browser); } catch (erreur) {
        if (erreur && erreur.cibleRouge) break;
        ok(false, `[${nom}] le scenario va jusqu au bout`, erreur && (erreur.message || String(erreur)).slice(0, 200));
      }
    }
  } finally {
    await browser.close();
    http.close();
  }
  console.log(`\nformule-illimitee-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('formule-illimitee-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

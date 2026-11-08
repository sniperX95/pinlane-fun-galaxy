// LE COMPTOIR (2026-11-05, lots 1 a 3 de la fenetre Reserver).
//
// Ansar, sur la capture de la fenetre : « ça montre quand on prend un horaire combien de
// piste il va rester apres cette reservation pareil pour laser game », « ça montre si ya des
// pistes ou des armes laser qui sont en cours de reservation par les clients [...] ça montre
// et bloque vrm pdt les X temps », « choisir pour chaque activité le nombre de joueur
// separement et dcp ça decompte direct », « pouvoir mettre sur une seul piste mm si ils sont
// plus que 6 et ttout manuellement si on le desire ».
//
// Il joue la VRAIE console, le VRAI handler api/staff-reservations.js et le vrai moteur
// (scripts/comptoir-banc.js, base en memoire), le samedi 16 janvier 2027 a 15:10, et verifie
// le dossier CREE en base, jamais seulement l ecran.
//
//   [A] CE QUI RESTERA. Chaque heure dit ce qui reste apres ce groupe, recompte ici a part
//       sur la journee ; le groupe, la duree et les parties le font bouger tout de suite.
//   [B] LES RETENUES. La phrase, le temps qui descend, la jauge, et elles comptent vraiment :
//       ce poste ne les propose pas, le serveur les refuse, echues elles se rendent.
//   [C] LES JOUEURS PAR ACTIVITE. Pistes et armes suivent tout de suite, le dossier cree
//       porte les joueurs de chaque activite, le groupe grandit par une activite sans toucher
//       aux autres, une petite activite a les siens.
//   [D] LES PISTES A LA MAIN. Sept, puis vingt joueurs sur une piste, la fiche et le
//       glisser les gardent, le droit se juge au serveur, le formulaire public n y a pas droit.
//   [E] L ECRAN. Rien ne deborde, rien ne se coupe, tout tient sans defiler a 1366 x 768.
//   [F] LES PLANNINGS. Le Complet, le bowling et le laser montrent ce que les clients
//       retiennent, sans geste, sans compter comme un groupe, et echu ca part.
//   [G] LE SUR MESURE. Une crepe ou une crepe pour tout le monde, une ligne offerte, jugee au
//       niveau prix du role. Une formule pour ce dossier, par joueur ou pour le groupe, lue sur
//       le ticket, le Complet et la fiche ; gardee, elle se retrouve dans Formules, les clients
//       ne la voient que si on le choisit, et l autre centre jamais.
//   [H] LES RETOURS DU 8 NOVEMBRE (Ansar : « laser game quand on prend plusierus parties c pas
//       intuitif », « de 6 a 7 et quils ont bowling ça leur met pas autmaitquement 2pistes »).
//       Deux parties : chacune a sa rangee sur le bloc, l heure de la deuxieme se touche la et
//       le dossier cree la porte. Une visite bowling et laser, piste 3 choisie a la main : a 7
//       joueurs elle prend une deuxieme piste et garde la 3, a 6 la piste ajoutee s en va, et
//       le dossier cree a 7 a ses deux pistes.
//   [I] UNE FORMULE N EST PAS UN TICKET VIDE (Ansar, le 8 novembre, Kids Fun Day a Gembloux :
//       360 € au ticket, « Créer » grise, aucun message, un clic qui ne fait rien). Sa carte
//       ne nomme aucune activite : la fenetre n a rien a composer, le serveur a ses etapes.
//       La simulation part, le bouton dit « Créer à 14:00 », le dossier nait en base. Un
//       centre qui ferme tot garde ses arrivees (la demi-heure d arrivee, pas les 5 h
//       annoncees), un refus se lit, un ticket vraiment vide reste bloque.
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en
// memoire, le disque n est jamais touche) et exige que chacune rougisse sa cible.
// `--seul=A,B` ne joue que ces lettres. Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const path = require('path');
const eclats = require('./gates-eclats.js');
const C = require('./comptoir-banc.js');
const { chromium } = require('playwright-core');

const { B, FX, ROOT, JOUR } = C;
const PORT = Number(process.env.PINLANE_COMPTOIR_PORT || 4961);
const CASSE = String(process.env.COMPTOIR_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };

const APP = 'assets/app-main.js';
const MUTATIONS = [
  { nom: 'reste-sans-le-groupe', lettre: 'A', cible: '[A] chaque heure du bowling dit ce qui reste apres le groupe', fichier: APP, de: 'const prend = Math.min(libres, voulu);\n  return { unite: \'piste\'', vers: 'const prend = 0;\n  return { unite: \'piste\'' },
  { nom: 'armes-sans-le-groupe', lettre: 'A', cible: '[A] chaque heure du laser dit ce qui reste apres le groupe', fichier: APP, de: 'const prend = Math.min(libres, voulu);\n        const place =', vers: 'const prend = 0;\n        const place =' },
  { nom: 'formule-sans-reste', lettre: 'A', cible: '[A] chaque heure d une formule dit ce qui reste', serveur: true, fichier: 'lib/reserver-simulation.js', de: "prend: verdict.statut === 'ko' ? [] : ceQuePrendLePlan(dossier.opsPlan) });", vers: 'prend: [] });' },
  { nom: 'coche-sur-les-chiffres', lettre: 'E', cible: '[E] la coche ne touche pas les chiffres de l heure (comptoir', fichier: 'assets/pinlane-staff.css', de: '.qb-modal.rv.rs .rs-h > .rs-coche { top: auto; right: -4px; bottom: -4px; width: 15px; height: 15px;', vers: '.qb-modal.rv.rs .rs-h > .rs-coche { top: 5px; right: 5px; width: 16px; height: 16px;' },
  { nom: 'attente-muette', lettre: 'B', cible: '[B] la touche montre les pistes retenues, et le dit a qui ne la voit pas', fichier: APP, de: '${rsGardeesHtml(x.place)}`;', vers: '`;' },
  { nom: 'retenue-non-comptee-pistes', lettre: 'B', cible: '[B] une piste retenue ne compte pas comme libre', fichier: APP, de: '[...state.reservations, ...getBlocagesEnLigne(date)].forEach(r => {\n    if (r.id === ignoreId) return;', vers: 'state.reservations.forEach(r => {\n    if (r.id === ignoreId) return;' },
  { nom: 'retenue-non-comptee-laser', lettre: 'B', cible: '[B] les armes retenues ne comptent pas comme libres', fichier: APP, de: 'const laserWindowsForDate = () => [...state.reservations, ...getBlocagesEnLigne(date)]', vers: 'const laserWindowsForDate = () => state.reservations' },
  { nom: 'phrase-absente', lettre: 'B', cible: '[B] le bloc du bowling dit ce que le client retient', fichier: APP, de: '    ${rsRetenuesHtml(id)}\n  </section>`;', vers: '  </section>`;' },
  { nom: 'temps-fige', lettre: 'B', cible: '[B] le temps de la retenue descend a la seconde', fichier: APP, de: "    if (el.textContent !== texte) el.textContent = texte;\n", vers: '' },
  { nom: 'conseil-sur-le-groupe', lettre: 'C', cible: '[C] les pistes se recomptent tout de suite', fichier: APP, de: "function rvPistesConseillees() {\n  const joueurs = getQuickVisitParticipants('bowling');", vers: "function rvPistesConseillees() {\n  const joueurs = Number(quickBookState.pax) || 1;" },
  { nom: 'besoin-sur-le-groupe', lettre: 'C', cible: '[C] les joueurs du bowling font bouger ce qui reste', fichier: APP, de: "  const joueurs = getQuickVisitParticipants('bowling');\n  const plan = getBowlingCapacityPlan(Math.max(...splitGroupIntoBowlingServices(joueurs)), libres, duree * 60);", vers: "  const joueurs = Number(s.pax) || 1;\n  const plan = getBowlingCapacityPlan(Math.max(...splitGroupIntoBowlingServices(joueurs)), libres, duree * 60);" },
  { nom: 'autres-suivent-le-groupe', lettre: 'C', cible: '[C] le groupe grandit par une activite, les autres gardent le leur', fichier: APP, de: '      rsGarderLesJoueursDesAutres(id, groupe);\n', vers: '' },
  { nom: 'capacite-toujours-jugee', lettre: 'D', cible: '[D] 7 joueurs sur une piste, a la main', serveur: true, fichier: 'lib/bowling-allocation.js', de: 'let lanes = aLaMain\n    ? fixedLanes || allocate(Math.max(1, Number(requiredLanes) || 1))\n    : allocate(Math.max(normalLanesNeeded, Number(requiredLanes) || 0));', vers: 'aLaMain = false;\n  let lanes = allocate(Math.max(normalLanesNeeded, Number(requiredLanes) || 0));' },
  { nom: 'base-refuse-la-main', lettre: 'D', cible: '[D] 20 joueurs sur une piste, a la main', serveur: true, fichier: 'lib/database.js', de: '    if (block.pistesALaMain) continue;\n', vers: '' },
  { nom: 'formule-sans-pistes', lettre: 'D', cible: '[D] une formule avec bowling offre le reglage des pistes', fichier: APP, de: "${rvActivites().includes('bowling') && rsEtat().faits.combien ? rsCompteurPistesHtml() : ''}</div>", vers: '</div>' },
  { nom: 'fiche-prix-fige', lettre: 'D', cible: '[D] sur la fiche, le prix suit les pistes', serveur: true, fichier: 'api/staff-reservations.js', de: '!== contenuDuDossier(current) || poseApres !== poseAvant;', vers: '!== contenuDuDossier(current);' },
  { nom: 'fiche-annonce-l-ancien-prix', lettre: 'D', cible: '[D] la fiche annonce le prix d une piste', fichier: APP, de: "      else if (capacity.aLaMain) { item.laneCount = capacity.requiredCount; item.pistesALaMain = true; }\n", vers: '' },
  { nom: 'droit-non-juge', lettre: 'D', cible: '[D] sans le niveau forcer, le serveur refuse', serveur: true, fichier: 'lib/reserver-fenetre.js', de: '    if (sousLeConseil(request, dossier)) exigerPistesALaMain(session);\n', vers: '' },
  { nom: 'public-garde-la-main', lettre: 'D', cible: '[D] le formulaire public n a pas droit aux pistes a la main', serveur: true, fichier: 'lib/reservation-request.js', de: '    delete request.pistesALaMain;\n', vers: '' },
  { nom: 'marque-perdue-au-patch', lettre: 'D', cible: '[D] une heure changee garde le dossier a la main', serveur: true, fichier: 'api/staff-reservations.js', de: "const poseApres = poseEnvoyee !== null ? poseEnvoyee : poseAvant && (Array.isArray(patch.lanes) ? patch.lanes.length : (current.lanes || []).length) || poseAvant;", vers: 'const poseApres = poseEnvoyee !== null ? poseEnvoyee : 0;' },
  { nom: 'glisser-rajoute-une-piste', lettre: 'D', cible: '[D] glisser la carte ne rajoute pas de piste', fichier: APP, de: "  const requiredCount = pistesALaMainDuDossier(reservation) ? currentLanes.length : Math.max(currentLanes.length, getBowlingCapacityPlan(Number(sourceWindow && sourceWindow.players) || getReservationActivityPlayers(reservation, 'bowling'), getFreeCount(reservation.date, startTime, duration, reservation.id), duration * 60).requiredCount);\n  const slotCheck = validateSlotWindow(reservation.date, startTime, duration, { allowPastStart: true });\n  if (!slotCheck.ok) {\n    showPlanningMoveNotice(", vers: "  const requiredCount = Math.max(currentLanes.length, getBowlingCapacityPlan(Number(sourceWindow && sourceWindow.players) || getReservationActivityPlayers(reservation, 'bowling'), getFreeCount(reservation.date, startTime, duration, reservation.id), duration * 60).requiredCount);\n  const slotCheck = validateSlotWindow(reservation.date, startTime, duration, { allowPastStart: true });\n  if (!slotCheck.ok) {\n    showPlanningMoveNotice(" },
];
const GLOBAL = 'assets/pinlane-planning-global.js';
MUTATIONS.push(
  { nom: 'complet-sans-retenues', lettre: 'F', cible: '[F] le Complet montre les pistes retenues', fichier: GLOBAL, de: 'var retenues = q || m.visibles ? [] : m.retenues;', vers: 'var retenues = [];' },
  { nom: 'retenues-sous-le-filtre', lettre: 'F', cible: '[F] un filtre ne montre pas les retenues', fichier: GLOBAL, de: 'var retenues = q || m.visibles ? [] : m.retenues;', vers: 'var retenues = q ? [] : m.retenues;' },
  { nom: 'retenues-sous-la-recherche', lettre: 'F', cible: '[F] une recherche ne montre pas les retenues', fichier: GLOBAL, de: 'var retenues = q || m.visibles ? [] : m.retenues;', vers: 'var retenues = m.visibles ? [] : m.retenues;' },
  { nom: 'barre-du-complet-muette', lettre: 'F', cible: '[F] la barre du Complet dit ce qui est retenu', fichier: GLOBAL, de: 'if (motsRetenu) h +=', vers: 'if (false) h +=' },
  { nom: 'barre-du-planning-muette', lettre: 'F', cible: '[F] la barre du bowling dit ce qui est retenu', fichier: APP, de: 'if (retenuIci) chiffres.push(', vers: 'if (false) chiffres.push(' },
  { nom: 'carte-laser-d-avant', lettre: 'F', cible: '[F] la carte laser se lit entiere', fichier: APP, de: '<span class="lp-g__nom"><b>Internet</b></span> <span class="lp-g__sous"><span class="lp-card-info">${lpArene(w)} arme${lpArene(w) > 1 ? \'s\' : \'\'} · ${libre ? `jusqu’à ${escapeHtml(libre)}` : \'en cours\'}</span></span></span>', vers: '<b>Internet</b> <span>${lpArene(w)} · ${libre ? `jusqu’à ${escapeHtml(libre)}` : \'en cours\'}</span></span>' },
  { nom: 'ligne-avant-ses-groupes', lettre: 'F', cible: '[F] la ligne se range dans sa demi-heure, apres ses groupes', fichier: GLOBAL, de: 'lignes.concat(retenues).sort(', vers: 'retenues.concat(lignes).sort(' },
  // (2026-11-07 : la hachure tient dans la pastille de l heure, la case reste nue)
  { nom: 'retenue-sans-hachure', lettre: 'F', cible: '[F] une retenue n a aucun geste et se lit hachuree, sur sa pastille', fichier: 'assets/pinlane-planning-global.css', de: '.gf-x.is-retenue .gf-x__t { background: repeating-linear-gradient(', vers: '.gf-x.is-retenue .gf-x__t { background-color: var(--surface); --hachure: repeating-linear-gradient(' },
  { nom: 'retenue-case-hachuree', lettre: 'F', cible: '[F] une retenue n a aucun geste et se lit hachuree, sur sa pastille', fichier: 'assets/pinlane-planning-global.css', de: '.gf-x.is-retenue { color: var(--muted); }', vers: '.gf-x.is-retenue { color: var(--muted); background: repeating-linear-gradient(135deg, var(--subtle), var(--subtle) 6px, var(--surface) 6px, var(--surface) 12px); }' },
);
const CONTROLE_FORMULES = 'api/ops.js';
MUTATIONS.push(
  { nom: 'par-personne-fige', lettre: 'G', cible: '[G] par personne, la ligne suit le groupe', fichier: APP, de: '  if (ligne.suit) return Math.max(1, Number(quickBookState.pax) || 1);\n', vers: '' },
  { nom: 'offert-se-paie', lettre: 'G', cible: '[G] offerte, la ligne ne se paie pas', fichier: APP, de: 'return valeur != null && ligne.offert ? 0 : valeur;', vers: 'return valeur;' },
  { nom: 'offert-perdu-en-base', lettre: 'G', cible: '[G] le dossier garde par personne et offert', serveur: true, fichier: 'lib/database.js', de: '      if (item.offert === true) {\n        ligne.offert = true;', vers: '      if (false) {\n        ligne.offert = true;' },
  { nom: 'offre-sans-plafond', lettre: 'G', cible: '[G] une offre au-dessus du plafond est refusee au serveur', serveur: true, fichier: 'lib/droits-reservation.js', de: 'const reference = Math.max(0, euros(centimes(dossier.basePrice) + centimes(totalExtrasComptoir(dossier.extras)) + valeurOfferte(dossier.extras)));', vers: 'const reference = Math.max(0, euros(centimes(dossier.basePrice) + centimes(totalExtrasComptoir(dossier.extras))));' },
  { nom: 'offre-sans-droit-ecran', lettre: 'G', cible: '[G] sans le niveau prix, pas de bouton Offert', fichier: APP, de: "const offrir = valeur != null && rsNiveau('prix') !== 'non' ?", vers: 'const offrir = valeur != null ?' },
  { nom: 'quantite-perdue', lettre: 'G', cible: '[G] la quantite se lit sur le dossier', serveur: true, fichier: 'lib/droits-reservation.js', de: 'id: ligne.id, name: dit, price: offert ? 0 : prix,', vers: 'id: ligne.id, name: ligne.name, price: offert ? 0 : prix,' },
  { nom: 'fenetre-prix-fige', lettre: 'G', cible: '[G] par joueur, le prix suit le groupe', fichier: APP, de: "return s.fm.mode === 'total' ? montant : Math.round(montant * Math.max(1, Number(s.pax) || 1) * 100) / 100;", vers: 'return montant;' },
  { nom: 'formule-perdue-au-programme', lettre: 'G', cible: '[G] le dossier garde la formule', serveur: true, fichier: 'lib/reservation-request.js', de: 'priceComplete: program.priceComplete, ...(formuleSurMesure ? { formuleSurMesure } : {}) };', vers: 'priceComplete: program.priceComplete };' },
  { nom: 'formule-perdue-en-base', lettre: 'G', cible: '[G] le dossier garde la formule', serveur: true, fichier: 'lib/database.js', de: '    priceComplete: value.priceComplete === true,\n    ...(formuleSurMesure ? { formuleSurMesure } : {}),\n', vers: '    priceComplete: value.priceComplete === true,\n' },
  { nom: 'une-activite-sans-programme', lettre: 'G', cible: '[G] le dossier garde la formule', fichier: APP, de: "const programme = s.type === 'visite' || adaptee || rsFmActive(s);", vers: "const programme = s.type === 'visite' || adaptee;" },
  { nom: 'patch-perd-la-formule', lettre: 'G', cible: '[G] la fiche garde la formule', serveur: true, fichier: 'api/staff-reservations.js', de: 'if (patch.program && !patch.formuleSurMesure && current.program && current.program.formuleSurMesure) patch.formuleSurMesure = current.program.formuleSurMesure;', vers: '' },
  { nom: 'prix-qui-ne-suit-pas', lettre: 'G', cible: '[G] le groupe change sur la fiche, le prix de la formule suit', serveur: true, fichier: 'lib/droits-reservation.js', de: "if (formule && Number.isFinite(Number(formule.prixParPersonne)) && formule.prixParPersonne !== null) {", vers: 'if (false) {' },
  { nom: 'fiche-annonce-le-tarif', lettre: 'G', cible: '[G] la fiche annonce le prix de la formule', fichier: APP, de: '  const formule = prixFormuleEdition();\n  if (formule != null) return formule;\n', vers: '' },
  { nom: 'total-tape-suit-encore', lettre: 'G', cible: '[G] un total tape a la main ne suit plus le groupe', serveur: true, fichier: 'api/staff-reservations.js', de: 'if (ops.program) ops.program = { ...programme, formuleSurMesure: nom };\n        else if (patch.program) patch.program = { ...programme, formuleSurMesure: nom };', vers: '' },
  { nom: 'planning-sans-formule', lettre: 'G', cible: '[G] le Complet dit la formule', fichier: GLOBAL, de: "liste.push(gfRubrique('formule', 'Formule', gpEsc(formuleDite), formuleDite));", vers: '' },
  { nom: 'fiche-perd-les-drapeaux', lettre: 'G', cible: '[G] la fiche relit par personne et offert', fichier: APP, de: "else modele[groupe].push({ choix, qte, prix, ...(parPersonne ? { parPersonne: true } : {}), ...(offert ? { offert: true } : {}) });", vers: 'else modele[groupe].push({ choix, qte, prix });' },
  { nom: 'fiche-montre-l-ancien-groupe', lettre: 'G', cible: '[G] sur la fiche, la ligne par personne suit le groupe', fichier: APP, de: 'return ligne.parPersonne ? Math.max(1, Math.trunc(Number(state.editState && state.editState.pax) || 1)) :', vers: 'return ligne.parPersonne ? Math.max(1, Math.trunc(Number(ligne.qte) || 1)) :' },
  { nom: 'fiche-ne-suit-pas-le-groupe', lettre: 'G', cible: '[G] la fiche retire l offre, la ligne par personne reste', fichier: APP, de: "const qte = ligne.parPersonne ? groupe : Math.max(1, Math.trunc(Number(ligne.qte) || 1));\n      if (!nom) return;", vers: 'const qte = Math.max(1, Math.trunc(Number(ligne.qte) || 1));\n      if (!nom) return;' },
  { nom: 'droit-temporaire', lettre: 'G', cible: '[G] sans le niveau formule, le serveur refuse', serveur: true, fichier: 'lib/reserver-fenetre.js', de: 'if (corpsAdapteUneFormule(corps, formuleAdaptee) || corps.formuleSurMesure) exigerAdaptationDeFormule(session);', vers: 'if (corpsAdapteUneFormule(corps, formuleAdaptee)) exigerAdaptationDeFormule(session);' },
  { nom: 'onglet-sans-droit', lettre: 'G', cible: '[G] sans le niveau formule, pas d onglet Formule', fichier: APP, de: "const rsFmPermise = () => rsNiveau('formule') === 'oui' && quickBookState.type !== 'formule';", vers: "const rsFmPermise = () => quickBookState.type !== 'formule';" },
  { nom: 'gardee-visible-des-clients', lettre: 'G', cible: '[G] gardee au comptoir, les clients ne la voient pas', serveur: true, fichier: 'lib/booking-config.js', de: '    if (formule.comptoirSeul && !comptoir) continue;\n', vers: '' },
  { nom: 'gardee-partout', lettre: 'G', cible: '[G] l autre centre ne la voit pas', serveur: true, fichier: 'lib/catalog-store.js', de: 'return !proprietaire || proprietaire === centre;', vers: 'return true;' },
  { nom: 'gardee-absente-des-formules', lettre: 'G', cible: '[G] elle se retrouve dans Formules', fichier: APP, de: 'if (served && gardees.length) return [...served, ...gardees.filter((g) => !served.some((f) => f.id === g.id))];\n', vers: '' },
  { nom: 'garder-sans-droit', lettre: 'G', cible: '[G] sans le droit Tarifs, le serveur refuse de garder', serveur: true, fichier: CONTROLE_FORMULES, de: "'saveGrillesTarif', 'garderFormuleSurMesure', 'afficherFormuleSurMesure', 'modifierFormuleSurMesure', 'retirerFormuleSurMesure'].includes(action)) return 'pricing.manage';", vers: "'saveGrillesTarif'].includes(action)) return 'pricing.manage';\n  if (['garderFormuleSurMesure', 'afficherFormuleSurMesure', 'modifierFormuleSurMesure', 'retirerFormuleSurMesure'].includes(action)) return 'reservations.create';" },
  { nom: 'tarifs-sans-formule-gardee', lettre: 'G', cible: '[G] Tarifs montre la formule gardee', fichier: 'assets/staff-pages-v2.js', de: "comptoirSeul: /^sm-.+--/.test(id) && entry.effective && entry.effective.humanValidation === 'comptoir',", vers: 'comptoirSeul: false,' },
  { nom: 'tarifs-sans-prix', lettre: 'G', cible: '[G] Tarifs change son prix', serveur: true, fichier: CONTROLE_FORMULES, de: "else if (action === 'modifierFormuleSurMesure') out = await catalogStore.updateFormula(getPool(), { id, ...champsDeFormule(body), ownerClientId });", vers: "else if (action === 'modifierFormuleSurMesure') out = {};" },
  { nom: 'fiche-sans-formule', lettre: 'G', cible: '[G] la fiche dit la formule', fichier: APP, de: "${formuleSM ? `<p class=\"fm-prix-formule\" id=\"editFormuleSM\">", vers: "${false ? `<p class=\"fm-prix-formule\" id=\"editFormuleSM\">" },
  { nom: 'addition-sans-offert', lettre: 'G', cible: '[G] l addition dit offert', fichier: APP, de: "montant: e.offert ? 'offert' : formatMoneyCentimes(Number(e.price) || 0) }));", vers: "montant: formatMoneyCentimes(Number(e.price) || 0) }));" },
  { nom: 'garder-sans-ecran', lettre: 'G', cible: '[G] sans le droit Tarifs, pas de rangee Garder', fichier: APP, de: "  if (!rsFmPeutGarder()) return '';\n", vers: '' },
  { nom: 'formule-d-un-autre-centre', lettre: 'G', cible: '[G] la formule d un autre centre ne se touche pas', serveur: true, fichier: CONTROLE_FORMULES, de: "if ((id || action !== 'garderFormuleSurMesure') && !estFormuleDuCentre(id, targetCenter)) {", vers: 'if (false) {' },
  { nom: 'reservee-par-l-autre-centre', lettre: 'G', cible: '[G] la formule d un autre centre ne se reserve pas', serveur: true, fichier: 'lib/reserver-fenetre.js', de: '    exigerFormuleDuCentre({ formuleId: corps.formuleId || corps.formulaId, centerId: request.centerId });\n', vers: '' },
  { nom: 'fiche-formule-d-un-autre-centre', lettre: 'G', cible: '[G] la fiche ne prend pas la formule d un autre centre', serveur: true, fichier: 'api/staff-reservations.js', de: 'if (patch.formuleId || patch.formulaId) exigerFormuleDuCentre(', vers: 'if (false) exigerFormuleDuCentre(' },
  { nom: 'dernier-clic-jete', lettre: 'G', cible: '[G] deux touches de suite, la derniere compte', fichier: APP, de: 'while (fm.gardee && fm.gardee.clients !== fm.clients) {', vers: 'if (fm.gardee && fm.gardee.clients !== fm.clients) {' },
  { nom: 'note-du-tarif-plein', lettre: 'G', cible: '[G] la note part du detail que l ecran montre', serveur: true, fichier: 'lib/droits-reservation.js', de: 'return { de: deLaNote({ reference, base: dossier.basePrice, extras: dossier.extras, prix }), a: prix,', vers: 'return { de: reference, a: prix,' },
  { nom: 'afficher-sans-effet', lettre: 'G', cible: '[G] affichee, les clients la voient', serveur: true, fichier: CONTROLE_FORMULES, de: 'humanValidation: body.clients === true ? null : MODE_COMPTOIR, ownerClientId });', vers: 'humanValidation: MODE_COMPTOIR, ownerClientId });' },
);
// [H] les retours du 8 novembre.
MUTATIONS.push(
  { nom: 'visite-une-piste', lettre: 'H', cible: '[H] une visite de 7, piste 3 choisie a la main : deux pistes, la 3 gardee', fichier: APP, de: '  if (visite ? !(s.visit && s.visit.bowling && s.visit.bowling.on) : !reservationNeedsLanes(s.type, s.formuleId)) return;', vers: '  if (visite || !reservationNeedsLanes(s.type, s.formuleId)) return;' },
  { nom: 'pistes-ajoutees-gardees', lettre: 'H', cible: '[H] le groupe redescend a 6 : la piste ajoutee s en va, la 3 reste', fichier: APP, de: '  if (current.length > besoin) {', vers: '  if (false) {' },
  { nom: 'parties-cachees', lettre: 'H', cible: '[H] deux parties : la rangee « Partie 2 » sur le bloc, « à la suite » cochee', fichier: APP, de: "  if (departs.length < 2) return '';", vers: "  if (departs.length < 99) return '';" },
  { nom: 'partie-immobile', lettre: 'H', cible: '[H] une heure de la partie 2 touchee sur le bloc : le ticket la dit', fichier: APP, de: "    rvChoisirHeure('laser_game', 100 + partie, heure);\n    rsForcerApres(quoi, x, dejaForce);\n  });", vers: '    rsForcerApres(quoi, x, dejaForce);\n  });' },
);
// [I] une formule n est pas un ticket vide.
MUTATIONS.push(
  { nom: 'formule-vide-au-pied', lettre: 'I', cible: '[I] Kids Fun Day a 14:00 : le bouton dit « Créer à 14:00 », sans is-bloque', fichier: APP, de: 'const vide = rvTicketVide() && !lot;\n  const attente = !b.faits.combien;', vers: 'const vide = !rvActivites().length && !lot;\n  const attente = !b.faits.combien;' },
  { nom: 'formule-vide-au-clic', lettre: 'I', cible: '[I] le clic cree le dossier en base : la formule, 14:00, 12 joueurs, 360 €', fichier: APP, de: "const vide = rvTicketVide() && !lot;\n  if (vide) { rsOuvrir('activites'); return; }", vers: "const vide = !rvActivites().length && !lot;\n  if (vide) { rsOuvrir('activites'); return; }" },
  { nom: 'ticket-vide-part', lettre: 'I', cible: '[I] un ticket vraiment vide reste bloque', fichier: APP, de: '  return !rvActivites().length && !rvFormule();', vers: '  return false;' },
  { nom: 'creneau-sur-la-duree-annoncee', lettre: 'I', cible: '[I] un centre qui ferme a 18:00 : la simulation part quand meme', fichier: APP, de: "return formule && formule.orderPolicy === 'open_window' ? getFormuleBookedDuration(formule) : annoncee;", vers: 'return annoncee;' },
  { nom: 'encaisser-sans-formule', lettre: 'I', cible: '[I] aujourd hui, un mercredi : les deux boutons Payé sont utilisables', fichier: APP, de: 'if (!s || s.date !== todayStr() || rvResas.length > 1 || s.forcer || rvTicketVide()) return false;', vers: 'if (!s || s.date !== todayStr() || rvResas.length > 1 || s.forcer || !rvActivites().length) return false;' },
  { nom: 'refus-en-recherche-sans-fin', lettre: 'I', cible: '[I] hors de sa fenetre : le refus se lit sur le ticket, le bouton ne cherche pas sans fin', fichier: APP, de: '!s.heureArretee && !s.forcer && rvResas.length < 2 && rvActivites().length);', vers: '!s.heureArretee && !s.forcer && rvResas.length < 2);' },
);
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  // Une contre-preuve s arrete des que sa cible rougit : le reste du scenario n a rien a lui
  // apprendre, et les fermetures (contextes, navigateur, serveur) se font quand meme.
  if (mutation && label === mutation.cible) throw Object.assign(new Error(`cible rouge : ${label}`), { cibleRouge: true });
  return false;
}

const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
if (CASSE && !mutation) { console.error(`comptoir-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
const compteAncre = (m) => lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
if (mutation && compteAncre(mutation) !== 1) { console.error(`comptoir-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }
function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

const serveur = C.monterServeur({ mutations: mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [] });

// ---------------------------------------------------------------------------
// Lire l ecran, lire la base, recompter a part.
// ---------------------------------------------------------------------------
const RETENUES = [{ heure: '16:00', pistes: [6, 7], joueurs: 8, resteMinutes: 8, resteSecondes: 12 }, { heure: '16:30', laser: 12, resteMinutes: 4, resteSecondes: 40 }];
const ouvrir = (browser, options = {}) => C.ouvrirConsole(browser, serveur, { port: PORT, ...options });
const finir = async (m, quoi) => { ok(m.erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, m.erreurs.slice(0, 3).join(' | ')); await m.ctx.close(); };
const verifie = async (page, id) => { if (await page.locator(`#rsZ-${id} .rs-seance.is-replie`).count()) return; await page.waitForSelector(`#rsZ-${id} .rs-s-l[data-verifie="1"]`, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(150); };
// LE LASER REPLIE (2026-11-08) : pas au ticket, ses heures ne se touchent pas. « Choisir » ou
// « Ajouter » le prend, puis son heure se touche si ce n est pas deja la sienne (un deuxieme
// toucher sur son heure le retirerait).
async function laserA(page, heure) {
  if (await page.locator('#rsAjout-laser_game').count()) { await page.locator('#rsAjout-laser_game').click(); await C.pret(page); }
  await verifie(page, 'laser_game');
  const deja = await page.evaluate((h) => Boolean(document.querySelector(`#rsZ-laser_game .rs-h.is-on[data-heure="${h}"]`)), heure);
  if (!deja) await page.locator(`#rsZ-laser_game .rs-h[data-heure="${heure}"]`).click();
}
// Les deux blocs ouverts : le bowling propose se choisit d un toucher sur son heure, puis
// « Ajouter » prend le laser a la suite.
async function lesDeuxOuverts(page) {
  await page.locator('#rsZ-bowling .rs-h.is-on').first().click();
  await C.pret(page);
  if (await page.locator('#rsAjout-laser_game').count()) { await page.locator('#rsAjout-laser_game').click(); await C.pret(page); }
  await verifie(page, 'laser_game');
}
// Ce que la touche ecrit : ce qui reste, toujours (2026-11-08, Ansar : « jaimais bien quand
// sur les heures yavais ce qui reste comme dispo »), en court (« reste 5 ») ; son nom dit
// tout (« reste 5 pistes »).
const ecritSurLaTouche = (n) => `reste ${n}`;
const heures = (page, id) => page.evaluate((i) => [...document.querySelectorAll(`#rsZ-${i} .rs-h[data-heure]`)].map((b) => ({
  heure: b.dataset.heure,
  coince: b.classList.contains('is-coince') || b.classList.contains('is-ko'),
  on: b.classList.contains('is-on'),
  efface: b.classList.contains('is-efface'),
  mot: ((b.querySelector('small') || {}).textContent || '').trim(),
  tag: ((b.querySelector('.rs-h-tag') || {}).textContent || '').trim(),
  nom: b.getAttribute('aria-label') || '',
  reste: (/reste \d+ (?:pistes?|armes?)/.exec(b.getAttribute('aria-label') || '') || [''])[0],
  garde: ((b.querySelector('.rs-h-garde') || {}).textContent || '').trim(),
})), id);
const creer = async (page, nom) => {
  await page.locator('#qbQui').fill(nom);
  await page.waitForTimeout(200);
  await page.locator('#rvCreer').click();
};
async function neufs(page, avant, voulu = 1) {
  for (let i = 0; i < 60; i += 1) {
    const l = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
    if (l.length >= voulu) return l;
    await page.waitForTimeout(100);
  }
  return [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
}
const planDe = (r) => (r && (typeof r.ops_plan === 'string' ? JSON.parse(r.ops_plan) : r.ops_plan)) || {};
const blocsPistes = (r) => (planDe(r).resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane');
const programmeDe = (r) => { const p = r && (typeof r.program === 'string' ? JSON.parse(r.program) : r.program); return (p && p.items) || []; };

const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const fx = FX.lireFixture('pic');
const LE_JOUR = fx.staffState.reservations.filter((r) => r.date === JOUR && r.status !== 'cancelled');
const blocsDu = (r, type) => ((r.opsPlan || {}).resourceBlocks || []).filter((b) => b.resourceType === type);
// Le compte a part, sur les dossiers et les retenues, sans le code de la console.
function pistesPrises(debut, minutes, retenues = []) {
  const prises = new Set();
  [...LE_JOUR, ...retenues.map((r) => C.dossierRetenu(r))].forEach((r) => blocsDu(r, 'bowling_lane').forEach((b) => {
    const s = enMin(b.startTime);
    const e = enMin(b.endTime);
    if (s < debut + minutes && debut < e) (b.lanes || []).forEach((l) => prises.add(Number(l)));
  }));
  return prises;
}
function armesPrises(debut, retenues = []) {
  let total = 0;
  [...LE_JOUR, ...retenues.map((r) => C.dossierRetenu(r))].forEach((r) => blocsDu(r, 'laser_arena').forEach((b) => {
    const s = enMin(b.startTime);
    const e = enMin(b.endTime);
    if (s < debut + 25 && debut < e) total += Number(b.players) || 0;
  }));
  return total;
}

// Un dossier cree par le serveur, vu par la page comme s il venait d arriver.
const poserDansLaPage = (page, res) => page.evaluate((r) => { window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(r); state.reservations.push({ ...r }); renderStaff(); }, res);
async function ouvrirModifier(page, id) {
  await page.evaluate((rid) => openPos(rid), id);
  await page.waitForTimeout(500);
  await page.evaluate(() => { const tab = [...document.querySelectorAll('button, a, [role="tab"]')].find((t) => /^Modifier$/i.test((t.textContent || '').trim())); if (tab) tab.click(); });
  await page.waitForSelector('.edit-form .lane-picker', { timeout: 8000 });
}
async function attendreBase(page, cond) {
  for (let i = 0; i < 40; i += 1) { if (cond()) return true; await page.waitForTimeout(100); }
  return cond();
}

// ---------------------------------------------------------------------------
// [A] CE QUI RESTERA
// ---------------------------------------------------------------------------
async function scenarioA(browser) {
  console.log('\n[A] ce qui restera apres cette reservation');
  const m = await ouvrir(browser);
  const { page } = m;
  try {
    await C.ouvrirFenetre(page, 7);
    await verifie(page, 'bowling');
    await lesDeuxOuverts(page);
    // (une heure grise que le serveur ne juge pas, apres la fermeture du programme, ne dit rien)
    const lireB = async (joueursParPiste, minutes, pistes) => (await heures(page, 'bowling')).filter((x) => !x.coince && !x.efface).map((x) => {
      const n = Math.max(0, 8 - pistesPrises(enMin(x.heure), minutes).size - pistes);
      const attendu = `reste ${n} piste${n > 1 ? 's' : ''}`;
      return { heure: x.heure, lu: x.mot, attendu, ecrit: ecritSurLaTouche(n), juste: x.mot === ecritSurLaTouche(n) && x.nom.includes(attendu), garde: x.garde, nom: x.nom };
    });
    const b7 = await lireB(6, 60, 2);
    ok(b7.length > 0 && b7.every((x) => x.juste), '[A] chaque heure du bowling dit ce qui reste apres le groupe : sur la touche, et son nom en entier', b7);
    ok(b7.every((x) => x.garde === ''), '[A] sans client sur internet, aucune touche ne dit « en attente »', b7.map((x) => x.garde));
    const lireL = async (joueurs) => (await heures(page, 'laser_game')).filter((x) => !x.coince && !x.efface).map((x) => {
      const reste = Math.max(0, 30 - armesPrises(enMin(x.heure)) - joueurs);
      const attendu = `reste ${reste} arme${reste > 1 ? 's' : ''}`;
      return { heure: x.heure, lu: x.mot, attendu, juste: x.mot === ecritSurLaTouche(reste) && x.nom.includes(attendu) };
    });
    const l7 = await lireL(7);
    ok(l7.length > 0 && l7.every((x) => x.juste), '[A] chaque heure du laser dit ce qui reste apres le groupe', l7);
    // Le groupe change : une piste suffit, il en reste une de plus, tout de suite.
    await page.locator('#rsHaut [data-pax="3"]').click();
    await verifie(page, 'bowling');
    const b3 = await lireB(6, 60, 1);
    ok(b3.length > 0 && b3.every((x) => x.juste), '[A] le groupe change, ce qui reste suit', b3);
    const l3 = await lireL(3);
    ok(l3.length > 0 && l3.every((x) => x.juste), '[A] les armes suivent le groupe', l3);
    // La duree change : 2 h prennent plus de la journee.
    await page.locator('#rsV-bowling-2').click();
    await verifie(page, 'bowling');
    const b2h = await lireB(6, 120, 1);
    ok(b2h.length > 0 && b2h.every((x) => x.juste), '[A] la duree change, ce qui reste suit', b2h);
    // Les parties changent : la partie la plus serree decide.
    await page.locator('#rsV-laser_game-2').click();
    await verifie(page, 'laser_game');
    const deux = await page.evaluate(() => rsDansLaCopie('laser_game', () => ['17:00', '18:00'].map((h) => ({ h, place: rsPlaceLaser(h) }))));
    const attendu2 = (h) => Math.max(0, 30 - Math.max(armesPrises(enMin(h)), armesPrises(enMin(h) + 30)) - 3);
    ok(deux.every((x) => x.place.libre === attendu2(x.h)), '[A] deux parties : la plus serree decide de ce qui reste', deux.map((x) => ({ ...x, attendu: attendu2(x.h) })));
    // L heure prise, le ticket le redit.
    await page.locator('#rsV-bowling-1').click();
    await page.locator('#rsV-laser_game-1').click();
    // Le laser ajoute pour lire ses heures repart : le ticket redevient le bowling seul.
    await page.locator('#rsSuppr-a-laser_game').click();
    await C.pret(page);
    await verifie(page, 'bowling');
    // (une autre que celle du ticket : la sienne, touchee encore, retirerait le bowling)
    const prise = (await heures(page, 'bowling')).find((x) => !x.coince && !x.on && !x.efface);
    await page.locator(`#rsZ-bowling .rs-h[data-heure="${prise.heure}"]`).click();
    await C.pret(page);
    await page.waitForTimeout(200);
    const ticket = await page.evaluate(() => (document.querySelector('#rsL-a-bowling .is-apres') || {}).textContent || '');
    ok(Boolean(prise.reste) && ticket === prise.reste.replace('reste', 'il restera'), '[A] le ticket redit ce qui restera a l heure prise', { ticket, prise: prise.reste });
    // « maintenant » reste, sur le bord de la touche.
    const maintenant = (await heures(page, 'bowling')).find((x) => x.heure === '15:00');
    ok(maintenant && maintenant.tag === 'maintenant', '[A] la seance en cours se dit encore « maintenant »', maintenant);
    // Une formule : chaque heure le dit aussi, pistes et armes, le bloc le plus serre decide.
    await page.locator('#rsHaut [data-pax="7"]').click();
    await C.pret(page);
    await page.locator('#rsCol button', { hasText: 'Formules' }).first().click();
    await page.waitForSelector('#rsF-formule_1, .rs-f');
    await page.locator('.rs-f[data-formule]').first().click();
    await page.waitForSelector('.rs-s-l.is-formule[data-verifie="1"]', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(250);
    const tuiles = await page.evaluate(() => {
      const c = quickBookState.candidats;
      return [...document.querySelectorAll('.rs-s-l.is-formule .rs-h[data-heure]')].map((b) => ({ heure: b.dataset.heure, mots: [...b.querySelectorAll('small')].map((s) => s.textContent.trim()), coince: b.classList.contains('is-coince') || b.classList.contains('is-ko'), prend: ((c && c.resultats.get(b.dataset.heure)) || {}).prend || [], nom: b.getAttribute('aria-label') || '' }));
    });
    const pluriel = (n, mot) => `reste ${n} ${mot}${n > 1 ? 's' : ''}`;
    const attenduFormule = (x) => {
      const p = x.prend.filter((b) => b.t === 'piste').map((b) => 8 - pistesPrises(enMin(b.d), enMin(b.f) - enMin(b.d)).size - b.n);
      const a = x.prend.filter((b) => b.t === 'arme').map((b) => 30 - armesPrises(enMin(b.d)) - b.n);
      return [...(p.length ? [pluriel(Math.max(0, Math.min(...p)), 'piste')] : []), ...(a.length ? [pluriel(Math.max(0, Math.min(...a)), 'arme')] : [])];
    };
    const tiennent = tuiles.filter((x) => !x.coince);
    ok(tiennent.length > 0 && tiennent.every((x) => x.mots.length === 2 && JSON.stringify(x.mots) === JSON.stringify(attenduFormule(x)) && x.mots.every((m) => x.nom.includes(m))), '[A] chaque heure d une formule dit ce qui reste', tuiles.map((x) => ({ h: x.heure, lu: x.mots, attendu: attenduFormule(x), coince: x.coince })));
    const choisie = tiennent[tiennent.length - 1];
    await page.locator(`.rs-s-l.is-formule .rs-h[data-heure="${choisie.heure}"]`).click();
    await C.pret(page);
    await page.waitForTimeout(300);
    const ticketF = await page.evaluate(() => (document.querySelector('#rsL-a-formule .is-apres') || {}).textContent || '');
    ok(ticketF === `il restera ${choisie.mots.map((m) => m.replace('reste ', '')).join(', ')}`, '[A] le ticket d une formule redit ce qui restera', { ticketF, choisie: choisie.mots });
  } finally { await finir(m, 'A'); }
}

// ---------------------------------------------------------------------------
// [B] LES RETENUES
// ---------------------------------------------------------------------------
async function scenarioB(browser) {
  console.log('\n[B] ce que les clients retiennent en ce moment');
  const m = await ouvrir(browser, { retenues: RETENUES, reservations: () => [] });
  const { page } = m;
  try {
    await C.ouvrirFenetre(page, 4);
    await verifie(page, 'bowling');
    await verifie(page, 'laser_game');
    const phrase = (id) => page.evaluate((i) => ((document.querySelector(`#rsZ-${i} .rs-retenues`) || {}).textContent || '').replace(/\s+/g, ' ').trim(), id);
    ok(/les pistes 6 et 7 de 16:00 à 17:00/.test(await phrase('bowling')) && /8 min 12 s/.test(await phrase('bowling')), '[B] le bloc du bowling dit ce que le client retient', await phrase('bowling'));
    ok(/12 armes à 16:30/.test(await phrase('laser_game')) && /4 min 40 s/.test(await phrase('laser_game')), '[B] le bloc du laser dit ce que le client retient', await phrase('laser_game'));
    const h = await page.evaluate(() => rsDansLaCopie('bowling', () => ({ a16: rsPlaceBowling('16:00'), a18: rsPlaceBowling('18:00'), libres: rvPistesDuBowling('16:00').libres, prises: [...getOccupiedLanes(quickBookState.date, '16:00', 1)] })));
    ok(h.libres === 6 && h.prises.includes(6) && h.prises.includes(7), '[B] une piste retenue ne compte pas comme libre', h);
    ok(h.a16.retenu === 2 && h.a16.libre === 5 && h.a18.retenu === 0 && h.a18.libre === 7, '[B] ce qui reste a 16:00 tient compte de la retenue, pas a 18:00', h);
    const a16 = (await heures(page, 'bowling')).find((x) => x.heure === '16:00');
    ok(a16 && a16.garde === '2 en attente' && /2 pistes en attente sur internet/.test(a16.nom), '[B] la touche montre les pistes retenues, et le dit a qui ne la voit pas', a16);
    const laser = await page.evaluate(() => rsDansLaCopie('laser_game', () => ({ dispo: rvDispoLaserA('16:30')[0], place: rsPlaceLaser('16:30') })));
    ok(laser.dispo.libres === 18 && laser.place.retenu === 12 && laser.place.libre === 14, '[B] les armes retenues ne comptent pas comme libres', laser);
    // Le serveur compte la retenue : 50 joueurs tiennent sur 7 pistes (8 par piste au plus),
    // pas sur les 6 qui restent, et une piste retenue demandee n est jamais donnee.
    const avantServeur = new Set(B.base.reservations.keys());
    const corpsBase = { centerId: 'libramont', date: JOUR, startTime: '16:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc', phone: '', email: '', channel: 'staff', requiresLanes: true };
    const trop = await serveur.appeler('POST', '/api/staff-reservations', { ...corpsBase, pax: 50, laneCount: 7, lanes: [] });
    ok(trop.statut >= 400 && [...B.base.reservations.keys()].every((k) => avantServeur.has(k)), '[B] le serveur refuse une place que la retenue tient', { statut: trop.statut, message: trop.json.message, pistes: trop.json.reservation && trop.json.reservation.lanes });
    const sur6 = await serveur.appeler('POST', '/api/staff-reservations', { ...corpsBase, pax: 2, laneCount: 1, lanes: [6] });
    const lignes = [...B.base.reservations.entries()].filter(([id]) => !avantServeur.has(id)).map(([, r]) => r);
    ok(lignes.length === 1 && !lignes[0].lanes.includes(6) && !lignes[0].lanes.includes(7), '[B] une piste retenue demandee n est jamais donnee', { statut: sur6.statut, pistes: lignes.map((r) => r.lanes) });
    lignes.forEach((r) => B.base.reservations.delete(r.id));
    // Le temps descend a la seconde, sans repeindre la fenetre.
    const base = FX.instant(JOUR, C.HEURE).getTime();
    const noeud = await page.evaluateHandle(() => document.querySelector('#rsZ-bowling .rs-s-l'));
    await page.clock.setFixedTime(new Date(base + 30000));
    await page.waitForFunction(() => /7 min 42 s/.test((document.querySelector('#rsZ-bowling [data-echeance]') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
    ok(/7 min 42 s/.test(await phrase('bowling')), '[B] le temps de la retenue descend a la seconde', await phrase('bowling'));
    ok(await noeud.evaluate((n) => n.isConnected), '[B] le temps qui descend ne repeint pas les heures');
    // Echue, elle rend sa place tout de suite.
    const apres = base + 5 * 60000;
    globalThis.__comptoirMaintenant = apres;
    B.base.horloge = apres;
    await page.clock.setFixedTime(new Date(apres));
    await page.waitForFunction(() => !document.querySelector('#rsZ-laser_game .rs-retenues'), null, { timeout: 4000 }).catch(() => {});
    const laserApres = await page.evaluate(() => rsDansLaCopie('laser_game', () => rsPlaceLaser('16:30')));
    ok(!(await phrase('laser_game')) && laserApres.retenu === 0 && laserApres.libre === 26, '[B] echue, la retenue rend ses armes tout de suite', { phrase: await phrase('laser_game'), laserApres });
    ok(/2 min|3 min/.test(await phrase('bowling')), '[B] l autre retenue court toujours', await phrase('bowling'));
  } finally { await finir(m, 'B'); }
}

// ---------------------------------------------------------------------------
// [C] LES JOUEURS PAR ACTIVITE
// ---------------------------------------------------------------------------
async function scenarioC(browser) {
  console.log('\n[C] les joueurs de chaque activite');
  const m = await ouvrir(browser, { reservations: () => [] });
  const { page } = m;
  const moins = (id) => page.locator(`#rsZ-${id} .rs-cpt [aria-label^="Joueurs"][aria-label$="un de moins"]`);
  const plus = (id) => page.locator(`#rsZ-${id} .rs-cpt [aria-label^="Joueurs"][aria-label$="un de plus"]`);
  // (un bloc replie n a pas de compteur : il dit ses armes dans son titre, l etat les garde)
  const compteur = (id) => page.evaluate((i) => { const b = document.querySelector(`#rsZ-${i} .rs-cpt .rs-pas b`); return b ? Number(b.textContent) : (document.querySelector(`#rsZ-${i} .rs-seance.is-replie`) ? getQuickVisitParticipants(i) : null); }, id);
  try {
    await C.ouvrirFenetre(page, 12);
    await verifie(page, 'bowling');
    const avant = await heures(page, 'bowling');
    ok(avant.find((x) => x.heure === '17:00').reste === 'reste 6 pistes', '[C] MONTAGE : 12 joueurs prennent 2 pistes', avant.find((x) => x.heure === '17:00'));
    for (let i = 0; i < 8; i += 1) { await moins('bowling').click(); await page.waitForTimeout(40); }
    await verifie(page, 'bowling');
    const a4 = await heures(page, 'bowling');
    ok(a4.find((x) => x.heure === '17:00').reste === 'reste 7 pistes' && await compteur('bowling') === 4, '[C] les joueurs du bowling font bouger ce qui reste', a4.find((x) => x.heure === '17:00'));
    ok(await compteur('laser_game') === 12, '[C] le laser garde tout le groupe', await compteur('laser_game'));
    const nPistes = await page.evaluate(() => Number((document.querySelector('#rsZ-bowling [data-pistes-pas]').parentElement.querySelector('b') || {}).textContent));
    ok(nPistes === 1, '[C] les pistes se recomptent tout de suite', nPistes);
    await page.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page);
    await laserA(page, '18:00');
    await C.pret(page);
    await page.waitForTimeout(300);
    await page.locator('#rsT-minigolf_blacklight').click();
    await C.pret(page);
    await page.waitForSelector('.rs-joueurs-petits .rs-cpt');
    const nomPetite = await page.evaluate(() => document.querySelector('.rs-joueurs-petits [aria-label$="un de moins"]').dataset.activite);
    for (let i = 0; i < 2; i += 1) { await page.locator('.rs-joueurs-petits [aria-label$="un de moins"]').click(); await page.waitForTimeout(40); }
    await C.pret(page);
    const au = await page.evaluate((id) => ({ b: getQuickVisitParticipants('bowling'), l: getQuickVisitParticipants('laser_game'), p: getQuickVisitParticipants(id), t: quickBookState.type }), nomPetite);
    ok(au.b === 4 && au.l === 12 && au.p === 10 && au.t === 'visite', '[C] une petite activite a ses joueurs, sous les tuiles', au);
    await creer(page, 'Banc Joueurs');
    const [r] = await neufs(page, m.avant);
    const lignes = programmeDe(r);
    const de = (id) => (lignes.find((l) => l.activityId === id) || {}).participants;
    ok(r && de('bowling') === 4 && de('laser_game') === 12 && de(nomPetite) === 10 && Number(r.pax) === 12 && r.lanes.length === 1, '[C] le dossier cree porte les joueurs de chaque activite', r && { pax: r.pax, pistes: r.lanes, lignes: lignes.map((l) => [l.activityId, l.participants]) });
    await page.waitForTimeout(400);
  } finally { await finir(m, 'C1'); }

  const m2 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page2 = m2.page;
    await C.ouvrirFenetre(page2, 7);
    await verifie(page2, 'bowling');
    await page2.locator('#rsZ-bowling .rs-cpt [aria-label^="Joueurs"][aria-label$="un de plus"]').click();
    await page2.waitForTimeout(250);
    const lu = await page2.evaluate(() => ({ pax: quickBookState.pax, b: getQuickVisitParticipants('bowling'), l: getQuickVisitParticipants('laser_game') }));
    ok(lu.pax === 8 && lu.b === 8 && lu.l === 7, '[C] le groupe grandit par une activite, les autres gardent le leur', lu);
    const proposeLaser = await page2.evaluate(() => { rsJoueursBloc('laser_game', 5); return quickBookState.type; });
    await page2.waitForTimeout(200);
    await laserA(page2, '18:00');
    await C.pret(page2);
    const seul = await page2.evaluate(() => ({ t: quickBookState.type, ids: rvActivites(), l: getQuickVisitParticipants('laser_game') }));
    ok(seul.l === 5 && seul.ids.includes('laser_game') && (seul.t === 'visite'), '[C] une activite prise garde les joueurs poses avant', { proposeLaser, seul });
  } finally { await finir(m2, 'C2'); }

  // Un groupe de 12, quatre au bowling, rien d autre : une piste, le prix d une piste.
  const m3 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page3 = m3.page;
    await C.ouvrirFenetre(page3, 12);
    await verifie(page3, 'bowling');
    for (let i = 0; i < 8; i += 1) { await page3.locator('#rsZ-bowling .rs-cpt [aria-label="Joueurs, Bowling, un de moins"]').click(); await page3.waitForTimeout(40); }
    await verifie(page3, 'bowling');
    await page3.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page3);
    await page3.waitForTimeout(250);
    await creer(page3, 'Banc Bowling Seul');
    const [r] = await neufs(page3, m3.avant);
    const ligne = programmeDe(r).find((l) => l.activityId === 'bowling');
    ok(r && r.lanes.length === 1 && Number(r.price) === 39 && ligne && ligne.participants === 4, '[C] un bowling seul garde ses joueurs', r && { pistes: r.lanes, prix: r.price, pax: r.pax, type: r.type, programme: programmeDe(r).map((l) => [l.activityId, l.participants]), blocs: blocsPistes(r) });
    await page3.waitForTimeout(300);
  } finally { await finir(m3, 'C3'); }
}

// ---------------------------------------------------------------------------
// [D] LES PISTES A LA MAIN
// ---------------------------------------------------------------------------
async function scenarioD(browser) {
  console.log('\n[D] les pistes a la main');
  const m = await ouvrir(browser, { reservations: () => [] });
  const { page } = m;
  const nPistes = () => page.evaluate(() => Number(document.querySelector('#rsZ-bowling [data-pistes-pas]').parentElement.querySelector('b').textContent));
  try {
    await C.ouvrirFenetre(page, 7);
    await verifie(page, 'bowling');
    ok(await nPistes() === 2, '[D] MONTAGE : le centre conseille 2 pistes pour 7', await nPistes());
    await page.locator('#rsZ-bowling [data-pistes-pas] >> nth=0').click();
    await verifie(page, 'bowling');
    const a17 = (await heures(page, 'bowling')).find((x) => x.heure === '17:00');
    ok(await nPistes() === 1 && a17.reste === 'reste 7 pistes', '[D] une piste : ce qui reste suit', { n: await nPistes(), a17 });
    ok(/à la main/.test(await page.evaluate(() => document.querySelector('#rsZ-bowling .rs-s-n small').textContent)), '[D] le bloc dit « à la main »');
    await page.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page);
    await page.waitForTimeout(250);
    const avert = await page.evaluate(() => document.getElementById('rvVerdict').textContent.replace(/\s+/g, ' ').trim());
    ok(/choisi à la main/.test(avert) && !/au lieu de 6/.test(avert), '[D] le ticket le dit une seule fois', avert);
    await creer(page, 'Banc Une Piste');
    const [r] = await neufs(page, m.avant);
    ok(r && r.lanes.length === 1 && Number(r.pax) === 7 && blocsPistes(r)[0].pistesALaMain === 1 && r.validation_status === 'confirmed', '[D] 7 joueurs sur une piste, a la main', r && { pistes: r.lanes, pax: r.pax, bloc: blocsPistes(r)[0], validation: r.validation_status });
    ok(r && Number(r.price) === 39, '[D] le prix suit les pistes prises', r && r.price);
    await page.waitForTimeout(300);
  } finally { await finir(m, 'D1'); }

  // Vingt joueurs, les pistes voulues.
  const m2 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page2 = m2.page;
    await C.ouvrirFenetre(page2, 20);
    await verifie(page2, 'bowling');
    for (let i = 0; i < 3; i += 1) { await page2.locator('#rsZ-bowling [data-pistes-pas] >> nth=0').click(); await page2.waitForTimeout(40); }
    await page2.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page2);
    await page2.locator('#rsL-a-bowling').click();
    await page2.waitForSelector('[data-piste="3"]');
    await page2.locator('[data-piste="3"]').click();
    await C.pret(page2);
    await page2.waitForTimeout(200);
    await creer(page2, 'Banc Vingt');
    const [r] = await neufs(page2, m2.avant);
    ok(r && r.lanes.join() === '3' && Number(r.pax) === 20, '[D] 20 joueurs sur une piste, a la main', r && { pistes: r.lanes, pax: r.pax, plan: blocsPistes(r) });

    // La fiche et les heures : le dossier reste a la main.
    const id = r && r.id;
    if (id) {
      const patch = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', startTime: '20:00', allowPastStart: true, baseUpdatedAt: new Date(r.updated_at).toISOString() });
      const apres = B.base.reservations.get(id);
      ok(patch.statut === 200 && apres.lanes.length === 1 && blocsPistes(apres)[0].pistesALaMain === 1 && blocsPistes(apres)[0].startTime === '20:00', '[D] une heure changee garde le dossier a la main', { statut: patch.statut, message: patch.json.message, pistes: apres.lanes, bloc: blocsPistes(apres)[0] });
      const nom = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', name: 'Banc Vingt bis', baseUpdatedAt: new Date(apres.updated_at).toISOString() });
      const apres2 = B.base.reservations.get(id);
      ok(nom.statut === 200 && apres2.lanes.length === 1 && blocsPistes(apres2)[0].pistesALaMain === 1, '[D] un nom change garde le dossier a la main', { statut: nom.statut, message: nom.json.message });
      const retire = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', pistesALaMain: 0, lanes: [3], laneCount: 1, baseUpdatedAt: new Date(apres2.updated_at).toISOString() });
      const apres3 = B.base.reservations.get(id);
      ok(retire.statut === 200 && blocsPistes(apres3).every((b) => !b.pistesALaMain) && apres3.lanes.length >= 4, '[D] retirer la main rend les pistes conseillees', { statut: retire.statut, message: retire.json.message, pistes: apres3.lanes });
    }
  } finally { await finir(m2, 'D2'); }

  // Une formule aussi : sept joueurs sur une piste, le prix reste celui de la formule.
  const m7 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page7 = m7.page;
    await C.ouvrirFenetre(page7, 7);
    await page7.locator('#rsCol button', { hasText: 'Formules' }).first().click();
    await page7.waitForSelector('.rs-f[data-formule]');
    await page7.locator('.rs-f[data-formule]').first().click();
    await page7.waitForSelector('.rs-s-l.is-formule[data-verifie="1"]', { timeout: 12000 }).catch(() => {});
    const prixFormule = await page7.evaluate(() => rvTotalReference());
    const moinsF = page7.locator('.rs-seance [data-pistes-pas]').first();
    ok(await moinsF.count() === 1, '[D] une formule avec bowling offre le reglage des pistes');
    await moinsF.click();
    await page7.waitForSelector('.rs-s-l.is-formule[data-verifie="1"]', { timeout: 12000 }).catch(() => {});
    await page7.waitForTimeout(250);
    await page7.locator('.rs-s-l.is-formule .rs-h[data-heure="17:00"]').click();
    await C.pret(page7);
    await page7.waitForTimeout(300);
    const motsF = await page7.evaluate(() => [...document.querySelectorAll('.rs-s-l.is-formule .rs-h[data-heure="17:00"] small')].map((s) => s.textContent.trim()));
    await creer(page7, 'Banc Formule Piste');
    const [rF] = await neufs(page7, m7.avant);
    ok(rF && rF.lanes.length === 1 && Number(rF.pax) === 7 && blocsPistes(rF)[0].pistesALaMain === 1 && Number(rF.price) === Number(prixFormule) && motsF[0] === 'reste 7 pistes', '[D] une formule sur une piste, a la main', rF && { pistes: rF.lanes, prix: rF.price, prixFormule, motsF, blocs: blocsPistes(rF), validation: rF.validation_status, message: await page7.evaluate(() => quickBookState && quickBookState.error) });
    await page7.waitForTimeout(300);
  } finally { await finir(m7, 'D7'); }

  // Sans le niveau forcer : pas de moins sous le conseil, et le serveur refuse.
  const m3 = await ouvrir(browser, { role: 'catalogue', reservations: () => [] });
  try {
    const page3 = m3.page;
    await C.ouvrirFenetre(page3, 7);
    await verifie(page3, 'bowling');
    const bouton = await page3.evaluate(() => { const b = document.querySelector('#rsZ-bowling [data-pistes-pas]'); return { desactive: b.disabled, plus: !b.parentElement.querySelectorAll('button')[1].disabled }; });
    ok(bouton.desactive && bouton.plus, '[D] sans le niveau forcer, pas de moins sous le conseil, le plus reste', bouton);
    const avantRefus = new Set(B.base.reservations.keys());
    const refus = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, startTime: '19:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Forge', pax: 7, laneCount: 1, lanes: [], requiresLanes: true, channel: 'staff', pistesALaMain: 1 });
    ok(refus.statut === 403 && refus.json.code === 'pistes_a_la_main_refuse' && [...B.base.reservations.keys()].every((k) => avantRefus.has(k)), '[D] sans le niveau forcer, le serveur refuse', { statut: refus.statut, code: refus.json.code, message: refus.json.message });
    const plusDePistes = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, startTime: '19:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Trois', pax: 7, laneCount: 3, lanes: [], requiresLanes: true, channel: 'staff', pistesALaMain: 3 });
    ok(plusDePistes.statut === 201 && plusDePistes.json.reservation.lanes.length === 3, '[D] plus de pistes que le conseil reste ouvert a qui reserve', { statut: plusDePistes.statut, message: plusDePistes.json.message });
    const { normalizeReservationRequest } = require(path.join(ROOT, 'lib/reservation-request.js'));
    const publique = normalizeReservationRequest({ centerId: 'libramont', date: JOUR, startTime: '19:00', duration: 1, pax: 7, type: 'bowling', name: 'X', phone: '+32470000000', email: 'x@example.test', pistesALaMain: 1 }, { channel: 'public', centerId: 'libramont' });
    ok(publique.pistesALaMain === undefined, '[D] le formulaire public n a pas droit aux pistes a la main', publique.pistesALaMain);
  } finally { await finir(m3, 'D3'); }

  // Un role qui modifie les dossiers, sans le niveau forcer : ni bouton ni raccourci.
  const m6 = await ouvrir(browser, { role: 'sans-forcer', reservations: () => [] });
  try {
    const page6 = m6.page;
    const cree = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, startTime: '17:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Sans Droit', pax: 7, laneCount: 2, lanes: [2, 3], requiresLanes: true, channel: 'staff' });
    const id = cree.json.reservation && cree.json.reservation.id;
    ok(cree.statut === 201, '[D] MONTAGE : 7 joueurs sur 2 pistes, sans le niveau forcer', { statut: cree.statut, message: cree.json.message });
    await poserDansLaPage(page6, cree.json.reservation);
    await ouvrirModifier(page6, id);
    ok(await page6.locator('.edit-form .lane-picker').count() === 1 && await page6.locator('#editPistesMain').count() === 0, '[D] sans le niveau forcer, la fiche n offre pas la main');
    const force = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', pistesALaMain: 1, lanes: [2], laneCount: 1, baseUpdatedAt: new Date(B.base.reservations.get(id).updated_at).toISOString() });
    const enBase = B.base.reservations.get(id);
    ok(force.statut === 403 && force.json.code === 'pistes_a_la_main_refuse' && enBase.lanes.join() === '2,3', '[D] sans le niveau forcer, un changement force est refuse', { statut: force.statut, code: force.json.code, message: force.json.message, pistes: enBase.lanes });
  } finally { await finir(m6, 'D6'); }

  // Le glisser et la fiche : une vraie carte sur le planning.
  const m4 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page4 = m4.page;
    const cree = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, startTime: '18:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Glisser', pax: 7, laneCount: 1, lanes: [2], requiresLanes: true, channel: 'staff', pistesALaMain: 1 });
    const id = cree.json.reservation && cree.json.reservation.id;
    ok(cree.statut === 201 && id, '[D] MONTAGE : un dossier sur une piste', { statut: cree.statut, message: cree.json.message });
    await page4.evaluate((res) => { window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(res); state.reservations.push(res); }, cree.json.reservation);
    const vu = await page4.evaluate((rid) => {
      const reservation = state.reservations.find((r) => Number(r.id) === Number(rid));
      return { main: pistesALaMainDuDossier(reservation) };
    }, id);
    ok(vu.main === 1, '[D] la console lit le dossier a la main', vu);
    await page4.evaluate((rid) => scheduleBowlingDrag(rid, 5, 18, 2, 18), id);
    await page4.waitForTimeout(600);
    const glisse = await page4.evaluate((rid) => { const r = state.reservations.find((x) => Number(x.id) === Number(rid)); return { pistes: r.lanes, main: pistesALaMainDuDossier(r) }; }, id);
    ok(glisse.pistes.length === 1 && glisse.pistes[0] === 5 && glisse.main === 1, '[D] glisser la carte ne rajoute pas de piste', glisse);
    const enBase = B.base.reservations.get(id);
    ok(enBase.lanes.join() === '5' && blocsPistes(enBase)[0].pistesALaMain === 1, '[D] le glisser est ecrit en base, a la main', { pistes: enBase.lanes, bloc: blocsPistes(enBase)[0] });
  } finally { await finir(m4, 'D4'); }

  // La fiche : 7 joueurs sur 2 pistes, on en decoche une, on dit « a la main », on enregistre.
  const m5 = await ouvrir(browser, { reservations: () => [] });
  try {
    const page5 = m5.page;
    const cree = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, startTime: '17:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Fiche', pax: 7, laneCount: 2, lanes: [2, 3], requiresLanes: true, channel: 'staff' });
    const id = cree.json.reservation && cree.json.reservation.id;
    ok(cree.statut === 201 && B.base.reservations.get(id).lanes.join() === '2,3', '[D] MONTAGE : 7 joueurs sur 2 pistes', { statut: cree.statut, message: cree.json.message });
    await poserDansLaPage(page5, cree.json.reservation);
    await ouvrirModifier(page5, id);
    await page5.locator('.lane-picker .lane-chip', { hasText: /^3$/ }).click();
    await page5.locator('#editPistesMain').click();
    const conseil = await page5.locator('#editLanesHint').textContent();
    ok(/7 joueurs sur 1 piste, à la main/.test(conseil), '[D] la fiche dit ce qu elle va garder', conseil);
    await page5.waitForTimeout(250);
    const champPrix = await page5.locator('#editPriceInput').inputValue();
    ok(Number(champPrix) === 39, '[D] la fiche annonce le prix d une piste', champPrix);
    await page5.locator('.edit-form button[type="submit"]').first().click();
    await attendreBase(page5, () => B.base.reservations.get(id).lanes.join() === '2');
    const apres = B.base.reservations.get(id);
    ok(apres.lanes.join() === '2' && blocsPistes(apres)[0].pistesALaMain === 1, '[D] la fiche garde une piste, a la main', { pistes: apres.lanes, bloc: blocsPistes(apres)[0] });
    ok(Number(apres.price) === 39 && Number(apres.base_price) === 39 && !/au lieu de/.test(String(apres.notes || '')), '[D] sur la fiche, le prix suit les pistes', { prix: apres.price, base: apres.base_price, notes: apres.notes });
    // Rouverte, elle s en souvient. On retire la main : le centre remet ses deux pistes.
    await page5.waitForTimeout(500);
    await ouvrirModifier(page5, id);
    ok(await page5.locator('#editPistesMain').getAttribute('aria-pressed') === 'true', '[D] la fiche rouverte s en souvient');
    await page5.locator('#editPistesMain').click();
    await page5.locator('.edit-form button[type="submit"]').first().click();
    await attendreBase(page5, () => B.base.reservations.get(id).lanes.length === 2);
    const rendu = B.base.reservations.get(id);
    ok(rendu.lanes.length === 2 && blocsPistes(rendu).every((b) => !b.pistesALaMain), '[D] retirer la main depuis la fiche rend les pistes conseillees', { pistes: rendu.lanes, blocs: blocsPistes(rendu) });
    ok(Number(rendu.price) === 78 && !/au lieu de/.test(String(rendu.notes || '')), '[D] retirer la main rend le prix des pistes', { prix: rendu.price, notes: rendu.notes });
  } finally { await finir(m5, 'D5'); }
}

// ---------------------------------------------------------------------------
// [E] L ECRAN
// ---------------------------------------------------------------------------
async function scenarioE(browser) {
  console.log('\n[E] l ecran');
  for (const appareil of ['comptoir', 'portable', 'tablette', 'tablette-portrait', 'telephone']) {
    const m = await ouvrir(browser, { appareil, retenues: RETENUES });
    const { page } = m;
    try {
      await C.ouvrirFenetre(page, 7);
      await verifie(page, 'bowling');
      await verifie(page, 'laser_game');
      const mesure = await page.evaluate(() => {
        const col = document.getElementById('rsCol');
        const coupes = [...document.querySelectorAll('.rs-h small, .rs-h-tag, .rs-ret, .rs-cpt')].filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 30));
        const r = col.getBoundingClientRect();
        const dehors = [...col.querySelectorAll('.rs-h, .rs-cpt, .rs-ret')].filter((e) => { const x = e.getBoundingClientRect(); return x.width && (x.left < r.left - 1 || x.right > r.right + 1); }).length;
        return { largeur: col.scrollWidth - col.clientWidth, hauteur: col.scrollHeight - col.clientHeight, coupes, dehors };
      });
      ok(mesure.largeur <= 1 && mesure.dehors === 0, `[E] rien ne deborde (${appareil})`, mesure);
      ok(mesure.coupes.length === 0, `[E] rien ne se coupe (${appareil})`, mesure.coupes);
      if (appareil === 'comptoir') ok(mesure.hauteur <= 1, '[E] tout tient sans defiler a 1366 x 768', mesure);
      // La coche de l heure prise (2026-11-08, Ansar : « le v genre correct est mal cadré ») : sa
      // boite ne touche ni l heure ni ce qui reste, lus sur leur vrai texte. Sur une heure
      // vraiment touchee : celle du bowling propose ne porte pas de coche.
      await page.locator('#rsZ-bowling .rs-h[data-heure]:not(.is-on):not(.is-coince):not(.is-efface)').nth(3).click();
      await C.pret(page);
      await verifie(page, 'bowling');
      await page.waitForTimeout(350);
      const coche = await page.evaluate(() => {
        const texte = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
        const touche = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const prises = [...document.querySelectorAll('#rsZ-bowling .rs-h.is-on:not(.is-propose)')].filter((k) => k.getClientRects().length && k.querySelector('.rs-coche'));
        return { prises: prises.map((k) => k.dataset.heure), visible: prises.every((k) => getComputedStyle(k.querySelector('.rs-coche')).opacity === '1'), sur: prises.filter((k) => { const c = k.querySelector('.rs-coche').getBoundingClientRect(); return [...k.querySelectorAll('b, small')].some((e) => touche(c, texte(e))); }).map((k) => k.dataset.heure) };
      });
      ok(coche.prises.length > 0 && coche.visible && coche.sur.length === 0, `[E] la coche ne touche pas les chiffres de l heure (${appareil})`, coche);
    } finally { await finir(m, `E ${appareil}`); }
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// [F] LES PLANNINGS
// ---------------------------------------------------------------------------
async function scenarioF(browser) {
  console.log('\n[F] les plannings');
  const m = await ouvrir(browser, { retenues: RETENUES, reservations: () => [] });
  const { page } = m;
  const vue = async (v) => { await page.evaluate((x) => setStaffResourceView(x), v); await page.waitForTimeout(350); };
  const lignes = () => page.evaluate(() => [...document.querySelectorAll('tr.gf-retenue')].map((tr) => ({
    texte: tr.textContent.replace(/\s+/g, ' ').trim(),
    nom: tr.getAttribute('aria-label') || '',
    id: tr.getAttribute('data-gf-id'),
    gestes: tr.querySelectorAll('td:not(.gf-bloc) button, td:not(.gf-bloc) a').length,
    // (la hachure tient dans la pastille de l heure, la case reste nue, 2026-11-07)
    hachure: getComputedStyle(tr.querySelector('.gf-x.is-retenue .gf-x__t')).backgroundImage,
    caseNue: getComputedStyle(tr.querySelector('.gf-x.is-retenue')).backgroundImage === 'none',
  })));
  const barre = () => page.evaluate(() => ((document.querySelector('[data-kpi="enligne"]') || {}).textContent || '').replace(/\s+/g, ' ').trim());
  try {
    await vue('all');
    const l = await lignes();
    ok(l.length === 2 && /16:00/.test(l[0].texte) && /Pistes 6-7/.test(l[0].texte) && /gardé jusqu’à 15:18/.test(l[0].texte), '[F] le Complet montre les pistes retenues', l);
    ok(l.length === 2 && /16:30/.test(l[1].texte) && /12 armes/.test(l[1].texte) && /gardé jusqu’à 15:14/.test(l[1].texte), '[F] le Complet montre les armes retenues', l);
    ok(l.every((x) => x.gestes === 0 && !x.id && /repeating-linear-gradient/.test(x.hachure) && x.caseNue), '[F] une retenue n a aucun geste et se lit hachuree, sur sa pastille', l);
    ok(l.every((x) => /Bowling à 16:00|Laser à 16:30/.test(x.nom) && /gardée jusqu’à \d{2}:\d{2}/.test(x.nom)), '[F] la ligne se dit a qui ne la voit pas', l.map((x) => x.nom));
    ok(/^Internet\s*2 pistes, 12 armes$/.test(await barre()), '[F] la barre du Complet dit ce qui est retenu', await barre());
    // (une case d une seule ligne ne dit qu un mot : le reste est dans son nom)
    const blocs = await page.evaluate(() => ['16:00', '16:30'].map((h) => (document.querySelector(`td[data-gf-reserver="${h}"] button`) || { getAttribute: () => '' }).getAttribute('aria-label')));
    ok(/6 pistes libres/.test(blocs[0]) && /18 places au laser/.test(blocs[1]), '[F] la grande case compte la retenue', blocs);
    const compteurs = await page.evaluate(() => (document.querySelector('[data-gf-filtre="upcoming"] .gf-c__v') || {}).textContent);
    ok(compteurs === '0', '[F] une retenue ne compte pas comme un groupe', compteurs);
    await page.locator('tr.gf-retenue .gf-nom').first().click();
    await page.waitForTimeout(250);
    ok(await page.evaluate(() => !state.selectedRes), '[F] toucher une retenue n ouvre rien');
    await page.locator('[data-gf-filtre="upcoming"]').click();
    await page.waitForTimeout(250);
    ok((await lignes()).length === 0, '[F] un filtre ne montre pas les retenues');
    await page.locator('[data-gf-filtre="all"]').click();
    await page.waitForTimeout(250);
    await page.evaluate(() => { state.searchTerm = 'dupont'; renderStaff(); });
    await page.waitForTimeout(250);
    ok((await lignes()).length === 0, '[F] une recherche ne montre pas les retenues');
    await page.evaluate(() => { state.searchTerm = ''; renderStaff(); });
    await page.waitForTimeout(250);

    await vue('bowling');
    const cartes = await page.evaluate(() => [...document.querySelectorAll('.planning-hold')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
    ok(cartes.length === 2 && cartes.every((t) => /Internet/.test(t) && /jusqu’à 15:18/.test(t)), '[F] le planning bowling montre les pistes retenues', cartes);
    ok(/^Internet\s*2 pistes$/.test(await barre()), '[F] la barre du bowling dit ce qui est retenu', await barre());

    await vue('laser');
    const carte = await page.evaluate(() => {
      const c = document.querySelector('.lp-g.is-enligne');
      if (!c) return null;
      const info = c.querySelector('.lp-card-info');
      if (!info) return { nom: '', dit: c.textContent.trim(), chevauche: true, hauts: [], carte: 0 };
      const b = c.querySelector('b').getBoundingClientRect();
      const s = info.getBoundingClientRect();
      const r = c.getBoundingClientRect();
      return { nom: c.querySelector('b').textContent.trim(), dit: info.textContent.trim(), chevauche: !(b.bottom <= s.top + 1 || s.bottom <= b.top + 1 || b.right <= s.left + 1 || s.right <= b.left + 1), hauts: [b.height, s.height], carte: r.height };
    });
    ok(carte && carte.nom === 'Internet' && carte.dit === '12 armes · jusqu’à 15:14' && !carte.chevauche && carte.hauts.every((h) => h >= 12), '[F] la carte laser se lit entiere', carte);
    ok(/^Internet\s*12 armes$/.test(await barre()), '[F] la barre du laser dit ce qui est retenu', await barre());

    // Echue, elle part.
    const base = FX.instant(JOUR, C.HEURE).getTime();
    await page.clock.setFixedTime(new Date(base + 5 * 60000));
    await vue('all');
    await page.evaluate(() => renderStaff());
    await page.waitForTimeout(350);
    const apres = await lignes();
    ok(apres.length === 1 && /Pistes 6-7/.test(apres[0].texte) && /^Internet\s*2 pistes$/.test(await barre()), '[F] echue, la retenue quitte le Complet', { apres, barre: await barre() });
  } finally { await finir(m, 'F'); }

  // Une vraie journee : la ligne se range dans sa demi-heure, parmi les groupes.
  const m2 = await ouvrir(browser, { retenues: RETENUES });
  try {
    await m2.page.evaluate(() => setStaffResourceView('all'));
    await m2.page.waitForTimeout(350);
    const lu = await m2.page.evaluate(() => {
      const case16 = document.querySelector('td[data-gf-bloc="16:00"]');
      const ligne = [...document.querySelectorAll('tr.gf-retenue')].find((tr) => /Pistes 6-7/.test(tr.textContent));
      let tr = case16 && case16.closest('tr');
      const rangees = [];
      for (let i = 0; tr && i < (case16 ? case16.rowSpan : 0); i += 1) { rangees.push(tr); tr = tr.nextElementSibling; }
      return { rowSpan: case16 && case16.rowSpan, dedans: Boolean(ligne) && rangees.includes(ligne), derniere: rangees[rangees.length - 1] === ligne, groupes: document.querySelectorAll('tr.gf-r:not(.gf-retenue)').length };
    });
    ok(lu.dedans && lu.derniere && lu.rowSpan === 4, '[F] la ligne se range dans sa demi-heure, apres ses groupes', lu);
  } finally { await finir(m2, 'F2'); }

  // Au telephone : une carte comme les autres.
  const m3 = await ouvrir(browser, { appareil: 'telephone', retenues: RETENUES, reservations: () => [] });
  try {
    await m3.page.evaluate(() => setStaffResourceView('all'));
    await m3.page.waitForTimeout(350);
    const tel = await m3.page.evaluate(() => {
      const tr = document.querySelector('tr.gf-retenue');
      if (!tr) return null;
      const r = tr.getBoundingClientRect();
      return { display: getComputedStyle(tr).display, largeur: r.width, dehors: r.right > innerWidth + 1, texte: tr.textContent.replace(/\s+/g, ' ').trim() };
    });
    ok(tel && tel.display === 'grid' && !tel.dehors && /Pistes 6-7/.test(tel.texte) && /gardé jusqu’à 15:18/.test(tel.texte), '[F] au telephone, la retenue est une carte', tel);
  } finally { await finir(m3, 'F3'); }
}

// ---------------------------------------------------------------------------
// [G] LE SUR MESURE
// ---------------------------------------------------------------------------
const CREPE = '#rsArt-crepe-au-sucre';
async function versLeSurMesure(page, pax) {
  await C.ouvrirFenetre(page, pax);
  await verifie(page, 'bowling');
  await page.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
  await C.pret(page);
  await page.locator('#rsMesure').click();
  await page.waitForSelector(CREPE);
}
const chiffres = (page) => page.evaluate(() => ({
  extras: quickExtrasTotal(),
  total: rsTotalTicket().total,
  reference: rvTotalReference(),
  calcul: (document.getElementById('rsBandeCalcul') || {}).textContent || '',
  tous: (document.getElementById('rsPourTous') || {}).textContent || '',
  lignes: quickExtrasLignes(),
  bloque: rsPrixBloque(),
  ticket: (document.getElementById('rsLignes') || {}).textContent || '',
}));
const programmeEntier = (r) => (r && (typeof r.program === 'string' ? JSON.parse(r.program) : r.program)) || {};
const extrasDe = (r) => (r && (typeof r.extras === 'string' ? JSON.parse(r.extras) : r.extras)) || [];
const CORPS_BOWLING = { centerId: 'libramont', date: JOUR, startTime: '19:00', duration: 1, totalDuration: 1, status: 'pending', type: 'bowling', name: 'Banc Forge', pax: 12, laneCount: 2, lanes: [], requiresLanes: true, channel: 'staff' };
const FORMULE_FORGEE = { nom: 'Forgee', prixParPersonne: 10, minPax: 2, activites: [{ id: 'bowling', minutes: 60, nom: 'Bowling 1 h' }], lignes: [] };

async function scenarioG(browser) {
  console.log('\n[G] le sur mesure');
  const { getEffectiveFormules } = require(path.join(ROOT, 'lib/booking-config.js'));
  const { normalizeReservationRequest } = require(path.join(ROOT, 'lib/reservation-request.js'));
  const catalogue = require(path.join(ROOT, 'lib/catalog-store.js'));
  const lePublicVoit = (id) => getEffectiveFormules('libramont').some((f) => f.id === id);
  const lePublicRefuse = (id) => {
    try { normalizeReservationRequest({ centerId: 'libramont', date: JOUR, startTime: '17:00', pax: 12, type: 'formule', formuleId: id, name: 'X', phone: '+32470000000', email: 'x@example.test' }, { channel: 'public' }); return false; } catch (error) { return /indisponible/i.test(error.message); }
  };

  // Une crepe, ou une crepe pour tout le monde.
  const m = await ouvrir(browser, { reservations: () => [] });
  let dossierOffert = null;
  try {
    const { page } = m;
    await versLeSurMesure(page, 12);
    await page.locator(CREPE).click();
    let c = await chiffres(page);
    ok(c.extras === 6 && /^6\s€$/.test(c.calcul), '[G] un toucher, une crepe', c.calcul);
    await page.locator('#rsParPersonne').click();
    c = await chiffres(page);
    ok(c.extras === 72 && /pour les 12 joueurs/.test(c.tous) && /1 par joueur/.test(c.ticket), '[G] par personne, une crepe pour les 12', { extras: c.extras, tous: c.tous });
    await page.locator('#rsHaut [data-pax="15"]').click();
    await page.waitForTimeout(250);
    c = await chiffres(page);
    ok(c.extras === 90 && /pour les 15 joueurs/.test(c.tous), '[G] par personne, la ligne suit le groupe', { extras: c.extras, tous: c.tous });
    await page.locator(CREPE).click();
    c = await chiffres(page);
    ok(c.extras === 90, '[G] toucher encore la tuile n ajoute rien a une ligne par personne', c.extras);
    await page.locator('#rsUnite').click();
    c = await chiffres(page);
    ok(c.extras === 6 && !c.tous, '[G] a l unite, on revient a une crepe', { extras: c.extras, tous: c.tous });
    await page.locator('#rsParPersonne').click();
    const avantOffre = await chiffres(page);
    await page.locator('#rsOffert').click();
    c = await chiffres(page);
    ok(c.extras === 0 && Math.abs(c.total - (avantOffre.total - 90)) < 0.01 && /offert/.test(c.calcul) && /offert/.test(c.ticket), '[G] offerte, la ligne ne se paie pas', { extras: c.extras, total: c.total, avant: avantOffre.total, calcul: c.calcul });
    await C.pret(page);
    await creer(page, 'Banc Crepe');
    const [r] = await neufs(page, m.avant);
    const ligne = extrasDe(r)[0] || {};
    dossierOffert = r;
    ok(ligne.parPersonne === true && ligne.offert === true && Number(ligne.valeur) === 90 && Number(ligne.price) === 0, '[G] le dossier garde par personne et offert', ligne);
    ok(/× 15$/.test(String(ligne.name)), '[G] la quantite se lit sur le dossier', ligne.name);
    ok(r && Number(r.price) === Number(r.base_price) && /Offert : Crêpe au sucre × 15/.test(String(r.notes || '')), '[G] l offre se trace d elle-meme', r && { prix: r.price, base: r.base_price, notes: r.notes });
    await page.waitForTimeout(400);

    // La fiche relit, fait suivre, retire.
    await page.evaluate((rid) => openPos(rid), r.id);
    await page.waitForTimeout(500);
    const addition = await page.evaluate(() => (document.querySelector('.gc-bill-lines') || {}).textContent || '');
    ok(/Crêpe au sucre × 15\s*par personne\s*offert/.test(addition.replace(/\s+/g, ' ')), '[G] l addition dit offert', addition.replace(/\s+/g, ' '));
    await page.evaluate(() => { const fermer = document.querySelector('#posOverlay .pos-close, #posOverlay [aria-label="Fermer"]'); if (fermer) fermer.click(); });
    await page.waitForTimeout(200);
    await ouvrirModifier(page, r.id);
    ok(await page.locator('.fm-x-opt.is-on').count() === 2, '[G] la fiche relit par personne et offert', await page.locator('.fm-x-opt.is-on').count());
    await page.locator('#editPaxInput').fill('14');
    await page.waitForTimeout(250);
    ok((await page.locator('.fm-x-tous').first().textContent()).trim() === '14', '[G] sur la fiche, la ligne par personne suit le groupe', await page.locator('.fm-x-tous').first().textContent());
    await page.locator('.fm-x-opt', { hasText: 'Offert' }).click();
    await page.waitForTimeout(250);
    const prixFiche = Number(await page.locator('#editPriceInput').inputValue());
    await page.locator('.edit-form button[type="submit"]').first().click();
    await attendreBase(page, () => Number(B.base.reservations.get(r.id).pax) === 14);
    const relu = B.base.reservations.get(r.id);
    const ligneRelue = extrasDe(relu)[0] || {};
    ok(ligneRelue.parPersonne === true && ligneRelue.offert !== true && Number(ligneRelue.price) === 84 && /× 14$/.test(String(ligneRelue.name)), '[G] la fiche retire l offre, la ligne par personne reste', ligneRelue);
    ok(Number(relu.price) === prixFiche && Number(relu.price) === Number(relu.base_price) + 84, '[G] la fiche annonce ce qu elle ecrit', { annonce: prixFiche, prix: relu.price, base: relu.base_price });
  } finally { await finir(m, 'G1'); }

  // Le plafond du role, et le role sans niveau.
  const m2 = await ouvrir(browser, { role: 'manager', reservations: () => [] });
  try {
    const { page } = m2;
    await versLeSurMesure(page, 12);
    await page.locator(CREPE).click();
    await page.locator('#rsOffert').click();
    let c = await chiffres(page);
    ok(c.bloque === '', '[G] une petite offre passe au plafond du role', c.bloque);
    await page.locator('#rsParPersonne').click();
    c = await chiffres(page);
    ok(c.bloque === 'plafond', '[G] une grande offre est au-dessus du plafond du role', c.bloque);
    const forge = await page.evaluate(() => rvConstruire().reservation);
    const refus = await serveur.appeler('POST', '/api/staff-reservations', { ...forge, centerId: 'libramont', name: 'Banc Offre', channel: 'staff' });
    ok(refus.statut === 403 && refus.json.code === 'prix_niveau_insuffisant', '[G] une offre au-dessus du plafond est refusee au serveur', { statut: refus.statut, code: refus.json.code, message: refus.json.message });
  } finally { await finir(m2, 'G2'); }

  const m3 = await ouvrir(browser, { role: 'catalogue', reservations: () => [] });
  try {
    const { page } = m3;
    await versLeSurMesure(page, 12);
    await page.locator(CREPE).click();
    ok(await page.locator('#rsParPersonne').count() === 1 && await page.locator('#rsOffert').count() === 0, '[G] sans le niveau prix, pas de bouton Offert', await page.locator('#rsOffert').count());
    ok(await page.locator('[data-onglet="formule"]').count() === 0, '[G] sans le niveau formule, pas d onglet Formule');
    const offre = await serveur.appeler('POST', '/api/staff-reservations', { ...CORPS_BOWLING, extras: [{ id: 'x', articleId: 'crepe-au-sucre', name: 'Crêpe au sucre', qte: 2, prixUnitaire: 6, price: 0, offert: true, valeur: 12 }] });
    ok(offre.statut === 403 && offre.json.code === 'prix_niveau_insuffisant', '[G] sans le niveau prix, le serveur refuse l offre', { statut: offre.statut, code: offre.json.code, message: offre.json.message });
    const temporaire = await serveur.appeler('POST', '/api/staff-reservations', { ...CORPS_BOWLING, program: [{ activityId: 'bowling', duration: 1, pax: 12, participants: 12 }], formuleSurMesure: { nom: 'Forgee' } });
    ok(temporaire.statut === 403 && temporaire.json.code === 'formule_niveau_insuffisant', '[G] sans le niveau formule, le serveur refuse', { statut: temporaire.statut, code: temporaire.json.code, message: temporaire.json.message });
    const garder = await serveur.appeler('POST', '/api/ops', { action: 'garderFormuleSurMesure', centerId: 'libramont', formule: FORMULE_FORGEE });
    ok(garder.statut === 403 && C.CATALOGUE_BANC.formules.size === 0, '[G] sans le droit Tarifs, le serveur refuse de garder', { statut: garder.statut, message: garder.json.message });
  } finally { await finir(m3, 'G3'); }

  // Le manager : la formule temporaire, sans le catalogue ; un role sans Tarifs ne garde pas.
  const m3b = await ouvrir(browser, { role: 'sans-tarifs', reservations: () => [] });
  try {
    const { page } = m3b;
    await versLeSurMesure(page, 12);
    await page.locator('[data-onglet="formule"]').click();
    await page.waitForSelector('#rsFmNom');
    ok(await page.locator('#rsFmGarder').count() === 0 && await page.locator('#rsFmClients').count() === 0, '[G] sans le droit Tarifs, pas de rangee Garder', await page.locator('#rsFmGarder').count());
  } finally { await finir(m3b, 'G3b'); }

  // La formule pour ce dossier.
  const m4 = await ouvrir(browser, { reservations: () => [] });
  try {
    const { page } = m4;
    await versLeSurMesure(page, 12);
    await page.locator(CREPE).click();
    await page.locator('#rsParPersonne').click();
    await page.locator('[data-onglet="formule"]').click();
    await page.waitForSelector('#rsFmNom');
    await page.locator('#rsFmNom').fill('Anniversaire de Lina');
    await page.locator('#rsFmMontant').fill('20');
    await page.waitForTimeout(200);
    let c = await chiffres(page);
    ok(c.total === 240 && /Anniversaire de Lina/.test(c.ticket) && /12 joueurs × 20/.test(c.ticket), '[G] la formule se lit sur le ticket', { total: c.total, ticket: c.ticket.slice(0, 120) });
    const dit = await page.locator('#rsFmCalcul').textContent();
    ok(/12 × 20\s€ = 240\s€/.test(dit) && /90\s€ de plus que le prix normal/.test(dit), '[G] la page dit le calcul et l ecart', dit);
    await page.locator('#rsHaut [data-pax="15"]').click();
    await page.waitForTimeout(250);
    c = await chiffres(page);
    ok(c.total === 300, '[G] par joueur, le prix suit le groupe', c.total);
    await page.locator('#rsFmAuTotal').click();
    await page.waitForTimeout(150);
    ok(await page.locator('#rsFmMontant').inputValue() === '300', '[G] passer au prix du groupe garde le total', await page.locator('#rsFmMontant').inputValue());
    await page.locator('#rsHaut [data-pax="12"]').click();
    await page.waitForTimeout(250);
    c = await chiffres(page);
    ok(c.total === 300, '[G] pour le groupe, le prix ne suit pas', c.total);
    await page.locator('#rsFmParJoueur').click();
    await page.locator('#rsFmMontant').fill('20');
    await page.waitForTimeout(250);
    await C.pret(page);
    await creer(page, 'Lina Dupont');
    const [r] = await neufs(page, m4.avant);
    const formule = programmeEntier(r).formuleSurMesure;
    ok(r && r.label === 'Anniversaire de Lina' && formule && formule.nom === 'Anniversaire de Lina' && Number(formule.prixParPersonne) === 20, '[G] le dossier garde la formule', r && { label: r.label, formule });
    ok(r && Number(r.price) === 240 && /Formule sur mesure : Anniversaire de Lina/.test(String(r.notes || '')), '[G] le prix et sa raison s ecrivent', r && { prix: r.price, notes: r.notes });
    // Une formule et une ligne offerte : la note part du detail que l ecran montre (l offre a 0 €).
    const avecOffre = await serveur.appeler('POST', '/api/staff-reservations', { ...CORPS_BOWLING, name: 'Banc Note', program: [{ activityId: 'bowling', duration: 1, pax: 12, participants: 12 }], formuleSurMesure: { nom: 'Note claire', prixParPersonne: 5 }, price: 60, prixRaison: 'Formule sur mesure : Note claire', extras: [{ id: 'x1', articleId: 'duvel', name: 'Duvel', qte: 1, prixUnitaire: 5, price: 0, offert: true, valeur: 5 }] });
    const idNote = avecOffre.json.reservation && avecOffre.json.reservation.id;
    const ligneNote = idNote ? B.base.reservations.get(idNote) : null;
    const deNote = Number((/"de":([\d.]+)/.exec(String((ligneNote && ligneNote.notes) || '')) || [])[1]);
    ok(avecOffre.statut === 201 && ligneNote && deNote === Number(ligneNote.base_price) && Number(ligneNote.price) === 60, '[G] la note part du detail que l ecran montre', { statut: avecOffre.statut, message: avecOffre.json.message, de: deNote, base: ligneNote && ligneNote.base_price, notes: ligneNote && ligneNote.notes });
    await page.waitForTimeout(500);
    const ligneComplet = await page.evaluate(() => { const tr = [...document.querySelectorAll('tr.gf-r')].find((x) => /Lina Dupont/.test(x.textContent)); return tr ? { texte: tr.textContent.replace(/\s+/g, ' '), pastille: (tr.querySelector('.gf-formule.is-mesure') || {}).textContent || '' } : null; });
    ok(ligneComplet && ligneComplet.pastille === 'Sur mesure', '[G] le Complet marque la formule sur mesure', ligneComplet);
    ok(ligneComplet && /Formule\s*Anniversaire de Lina, 20\s€ par joueur/.test(ligneComplet.texte) && /12 × Crêpe au sucre/.test(ligneComplet.texte), '[G] le Complet dit la formule', ligneComplet);

    // Une heure changee : tout reste.
    const heure = await serveur.appeler('PATCH', '/api/staff-reservations', { id: r.id, centerId: 'libramont', startTime: '20:00', allowPastStart: true, baseUpdatedAt: new Date(r.updated_at).toISOString() });
    let relu = B.base.reservations.get(r.id);
    ok(heure.statut === 200 && relu.label === 'Anniversaire de Lina' && Number(relu.price) === 240 && programmeEntier(relu).formuleSurMesure && programmeEntier(relu).formuleSurMesure.nom === 'Anniversaire de Lina', '[G] une heure changee garde la formule et son prix', { statut: heure.statut, message: heure.json.message, label: relu.label, prix: relu.price, formule: programmeEntier(relu).formuleSurMesure });
    await page.evaluate((res) => { const i = state.reservations.findIndex((x) => x.id === res.id); if (i >= 0) state.reservations[i] = { ...res }; renderStaff(); }, heure.json.reservation);

    // La fiche : le groupe change, le prix suit la formule.
    await ouvrirModifier(page, r.id);
    const formuleFiche = await page.evaluate(() => (document.getElementById('editFormuleSM') || {}).textContent || '');
    ok(/Anniversaire de Lina/.test(formuleFiche), '[G] la fiche dit la formule', formuleFiche);
    await page.locator('#editPaxInput').fill('11');
    await page.waitForTimeout(250);
    ok(Number(await page.locator('#editPriceInput').inputValue()) === 220, '[G] la fiche annonce le prix de la formule', await page.locator('#editPriceInput').inputValue());
    await page.locator('.edit-form button[type="submit"]').first().click();
    await attendreBase(page, () => Number(B.base.reservations.get(r.id).pax) === 11);
    relu = B.base.reservations.get(r.id);
    ok(Number(relu.price) === 220, '[G] le groupe change sur la fiche, le prix de la formule suit', { prix: relu.price, notes: relu.notes });
    ok(programmeEntier(relu).formuleSurMesure && Number(programmeEntier(relu).formuleSurMesure.prixParPersonne) === 20 && relu.label === 'Anniversaire de Lina', '[G] la fiche garde la formule', { label: relu.label, programme: programmeEntier(relu).formuleSurMesure });
    ok(/× 11$/.test(String((extrasDe(relu)[0] || {}).name)), '[G] la ligne par personne suit sur le dossier', extrasDe(relu)[0]);

    // Un total tape : la formule garde son nom, le prix ne suit plus le groupe.
    const tape = await serveur.appeler('PATCH', '/api/staff-reservations', { id: r.id, centerId: 'libramont', price: 200, prixRaison: 'Geste', baseUpdatedAt: new Date(relu.updated_at).toISOString() });
    relu = B.base.reservations.get(r.id);
    const apresTape = programmeEntier(relu).formuleSurMesure;
    ok(tape.statut === 200 && Number(relu.price) === 200 && apresTape && apresTape.nom === 'Anniversaire de Lina' && apresTape.prixParPersonne === undefined, '[G] un total tape a la main ne suit plus le groupe', { statut: tape.statut, message: tape.json.message, prix: relu.price, formule: apresTape });
  } finally { await finir(m4, 'G4'); }

  // Une seule activite, un prix pour le groupe.
  const m5 = await ouvrir(browser, { reservations: () => [] });
  try {
    const { page } = m5;
    await C.ouvrirFenetre(page, 8);
    await laserA(page, '18:00');
    await C.pret(page);
    await page.locator('#rsMesure').click();
    await page.waitForSelector(CREPE);
    await page.locator('[data-onglet="formule"]').click();
    await page.locator('#rsFmNom').fill('Club de foot');
    await page.locator('#rsFmAuTotal').click();
    await page.locator('#rsFmMontant').fill('70');
    await page.waitForTimeout(400);
    await C.pret(page);
    await creer(page, 'Banc Foot');
    const [r] = await neufs(page, m5.avant);
    const f = programmeEntier(r).formuleSurMesure;
    ok(r && f && f.nom === 'Club de foot' && f.prixParPersonne === undefined && Number(r.price) === 70 && r.label === 'Club de foot', '[G] une seule activite garde aussi sa formule', r && { label: r.label, f, prix: r.price, type: r.type });
  } finally { await finir(m5, 'G5'); }

  // La garder, l afficher, la retrouver, la retirer.
  const m6 = await ouvrir(browser, { reservations: () => [] });
  let garde = '';
  try {
    const { page } = m6;
    await versLeSurMesure(page, 12);
    await page.locator(CREPE).click();
    await page.locator('#rsParPersonne').click();
    await page.locator('[data-onglet="formule"]').click();
    await page.locator('#rsFmMontant').fill('22');
    await page.locator('#rsFmGarder').click();
    await page.waitForSelector('#rsFmErreur');
    ok(/nom/.test(await page.locator('#rsFmErreur').textContent()) && C.CATALOGUE_BANC.formules.size === 0, '[G] sans nom, elle ne se garde pas', await page.locator('#rsFmErreur').textContent());
    await page.locator('#rsFmNom').fill('Anniv du club');
    await page.waitForTimeout(150);
    await page.locator('#rsFmGarder').click();
    await page.waitForSelector('#rsFmEtat');
    const lignes = [...C.CATALOGUE_BANC.formules.values()];
    garde = (lignes[0] || {}).id || '';
    ok(lignes.length === 1 && /^sm-libramont--anniv-du-club$/.test(garde) && lignes[0].human_validation === 'comptoir' && Number(lignes[0].price_value) === 22 && Number(lignes[0].min_pax) === 6, '[G] gardee, elle est au catalogue de ce centre', lignes[0]);
    const etapes = C.CATALOGUE_BANC.etapes.map((e) => [e.activity_id, e.count, e.duration_minutes, e.label]);
    ok(etapes.length === 2 && etapes[0][0] === 'bowling' && etapes[0][2] === 60 && etapes[1][0] === 'service_drinks' && /Crêpe au sucre par personne/.test(etapes[1][3]), '[G] elle comprend ce que le ticket contient', etapes);
    ok(!lePublicVoit(garde) && lePublicRefuse(garde) && getEffectiveFormules('libramont', { comptoir: true }).some((f) => f.id === garde), '[G] gardee au comptoir, les clients ne la voient pas', { voit: lePublicVoit(garde), refuse: lePublicRefuse(garde) });
    ok(!catalogue.listBookingFormules('gembloux').some((f) => f.id === garde) && catalogue.listBookingFormules('libramont').some((f) => f.id === garde), '[G] l autre centre ne la voit pas');
    await page.locator('#rsFmClients').click();
    await attendreBase(page, () => C.CATALOGUE_BANC.formules.get(garde).human_validation === null);
    await page.waitForFunction(() => /formulaire des clients/.test((document.getElementById('rsFmEtat') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(lePublicVoit(garde) && !lePublicRefuse(garde) && /les clients la voient sur internet/.test((await page.locator('#rsFmEtat').textContent()) || ''), '[G] affichee, les clients la voient', { voit: lePublicVoit(garde), etat: await page.locator('#rsFmEtat').textContent() });
    await page.locator('#rsFmComptoir').click();
    await attendreBase(page, () => C.CATALOGUE_BANC.formules.get(garde).human_validation === 'comptoir');
    ok(!lePublicVoit(garde), '[G] on la retire du formulaire d un geste', lePublicVoit(garde));
    // Deux touches de suite, la seconde avant le retour de la premiere : la derniere compte.
    const libre = await page.waitForFunction(() => !quickBookState.fm.enCours, null, { timeout: 8000 }).then(() => true, () => false);
    ok(libre, '[G] rien en vol avant les deux touches');
    await page.evaluate(() => { document.getElementById('rsFmClients').click(); document.getElementById('rsFmComptoir').click(); });
    await page.waitForFunction(() => !quickBookState.fm.enCours, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const dernier = await page.evaluate(() => ({ ecran: quickBookState.fm.clients, serveur: quickBookState.fm.gardee && quickBookState.fm.gardee.clients, etat: (document.getElementById('rsFmEtat') || {}).textContent || '' }));
    ok(C.CATALOGUE_BANC.formules.get(garde).human_validation === 'comptoir' && !lePublicVoit(garde) && dernier.ecran === false && !/formulaire des clients/.test(dernier.etat), '[G] deux touches de suite, la derniere compte', { base: C.CATALOGUE_BANC.formules.get(garde).human_validation, dernier });
    // Changer le prix apres : mettre a jour, sans en creer une autre.
    await page.locator('#rsFmMontant').fill('24');
    await page.waitForTimeout(200);
    await page.locator('#rsFmGarder').click();
    await page.waitForSelector('#rsFmEtat');
    ok(C.CATALOGUE_BANC.formules.size === 1 && Number(C.CATALOGUE_BANC.formules.get(garde).price_value) === 24, '[G] mettre a jour ne cree pas une deuxieme formule', [...C.CATALOGUE_BANC.formules.values()].map((f) => [f.id, f.price_value]));
  } finally { await finir(m6, 'G6'); }

  // Une autre fenetre : elle est dans Formules, et elle se reserve au prix garde.
  const m7 = await ouvrir(browser, { reservations: () => [] });
  try {
    const { page } = m7;
    await C.ouvrirFenetre(page, 12);
    await page.waitForFunction((id) => getEffectiveCatalogFormules().some((f) => f.id === id), garde, { timeout: 8000 }).catch(() => {});
    await page.locator('#rsFormules').click();
    const tuile = page.locator(`[id="rsF-${garde}"]`);
    ok(await tuile.count() === 1, '[G] elle se retrouve dans Formules', await page.evaluate(() => getEffectiveCatalogFormules().map((f) => f.id).slice(-3)));
    if (await tuile.count()) {
      await tuile.click();
      await page.waitForSelector('.rs-s-l.is-formule .rs-h[data-heure="17:00"]');
      await page.locator('.rs-s-l.is-formule .rs-h[data-heure="17:00"]').click();
      await C.pret(page);
      await creer(page, 'Banc Gardee');
      const [r] = await neufs(page, m7.avant);
      ok(r && r.formule_id === garde && Number(r.price) === 288, '[G] elle se reserve au prix garde', r && { formule: r.formule_id, prix: r.price, label: r.label, statut: r.status });
    }
    // L autre centre, et les autres formules, ne passent pas par ces portes.
    const voisine = await serveur.appeler('POST', '/api/ops', { action: 'afficherFormuleSurMesure', centerId: 'libramont', id: 'sm-gembloux--leur-formule', clients: true });
    const catalogueDeSociete = await serveur.appeler('POST', '/api/ops', { action: 'retirerFormuleSurMesure', centerId: 'libramont', id: 'f1' });
    ok(voisine.statut === 403 && catalogueDeSociete.statut === 403, '[G] la formule d un autre centre ne se touche pas', { voisine: voisine.statut, societe: catalogueDeSociete.statut });
    const prise = await serveur.appeler('POST', '/api/staff-reservations', { ...CORPS_BOWLING, type: 'formule', formuleId: 'sm-gembloux--leur-formule' });
    ok(prise.statut === 403 && prise.json.code === 'formule_autre_centre', '[G] la formule d un autre centre ne se reserve pas', { statut: prise.statut, code: prise.json.code, message: prise.json.message });
    const simple = await serveur.appeler('POST', '/api/staff-reservations', { ...CORPS_BOWLING, name: 'Banc Fiche Voisine' });
    const idSimple = simple.json.reservation && simple.json.reservation.id;
    const versLaVoisine = idSimple
      ? await serveur.appeler('PATCH', '/api/staff-reservations', { id: idSimple, centerId: 'libramont', type: 'formule', formuleId: 'sm-gembloux--leur-formule', baseUpdatedAt: new Date(B.base.reservations.get(idSimple).updated_at).toISOString() })
      : { statut: simple.statut, json: simple.json };
    ok(versLaVoisine.statut === 403 && versLaVoisine.json.code === 'formule_autre_centre' && idSimple && !B.base.reservations.get(idSimple).formule_id, '[G] la fiche ne prend pas la formule d un autre centre', { statut: versLaVoisine.statut, code: versLaVoisine.json.code, message: versLaVoisine.json.message });
  } finally { await finir(m7, 'G7'); }

  // Tarifs & formules : le manager (droit Tarifs, pas droit Reglages) la regle et la retire.
  const m8 = await ouvrir(browser, { role: 'manager', reservations: () => [] });
  try {
    const { page } = m8;
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.evaluate(() => { const b = document.querySelector('[data-fgx-menu-key="prices"]'); if (b) b.click(); });
    const ligne = `#staffPricingPage [data-tf-ligne="${garde}"]`;
    await page.waitForSelector(ligne, { timeout: 20000 }).catch(() => {});
    const texte = await page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', ligne);
    ok(/Anniv du club/.test(texte) && /Au comptoir seulement/.test(texte), '[G] Tarifs montre la formule gardee', texte.replace(/\s+/g, ' ').slice(0, 200));
    await page.locator(`${ligne} .tf-ligne-btn`).click();
    await page.waitForSelector('#tfSmPrix');
    await page.locator('#tfSm-clients').click();
    await attendreBase(page, () => C.CATALOGUE_BANC.formules.get(garde).human_validation === null);
    ok(lePublicVoit(garde), '[G] Tarifs l affiche aux clients', C.CATALOGUE_BANC.formules.get(garde).human_validation);
    await page.waitForSelector(`${ligne} .tf-ligne-btn`);
    await page.waitForTimeout(500);
    if (!(await page.locator('#tfSmPrix').count())) await page.locator(`${ligne} .tf-ligne-btn`).click();
    await page.waitForSelector('#tfSmPrix');
    await page.locator('#tfSm-comptoir').click();
    await attendreBase(page, () => C.CATALOGUE_BANC.formules.get(garde).human_validation === 'comptoir');
    ok(!lePublicVoit(garde), '[G] Tarifs la remet au comptoir', C.CATALOGUE_BANC.formules.get(garde).human_validation);
    await page.waitForTimeout(500);
    if (!(await page.locator('#tfSmPrix').count())) await page.locator(`${ligne} .tf-ligne-btn`).click();
    await page.waitForSelector('#tfSmPrix');
    await page.locator('#tfSmPrix').fill('30,50');
    await page.locator('#tfSmNom').fill('Anniv du club bis');
    await page.locator('#tfSmEnregistrer').click();
    await attendreBase(page, () => Number(C.CATALOGUE_BANC.formules.get(garde).price_value) === 30.5);
    const lue = C.CATALOGUE_BANC.formules.get(garde);
    ok(Number(lue.price_value) === 30.5 && lue.name === 'Anniv du club bis' && lue.human_validation === 'comptoir', '[G] Tarifs change son prix', lue);
    await page.waitForTimeout(500);
    if (!(await page.locator('#tfSmRetirer').count())) await page.locator(`${ligne} .tf-ligne-btn`).click();
    await page.waitForSelector('#tfSmRetirer');
    await page.locator('#tfSmRetirer').click();
    await attendreBase(page, () => C.CATALOGUE_BANC.formules.get(garde).active === false);
    ok(!getEffectiveFormules('libramont', { comptoir: true }).some((f) => f.id === garde), '[G] retiree, elle n existe plus', C.CATALOGUE_BANC.formules.get(garde).active);
  } finally { await finir(m8, 'G8'); }
}

// ---------------------------------------------------------------------------
// [H] LES RETOURS DU 8 NOVEMBRE
// ---------------------------------------------------------------------------
async function scenarioH(browser) {
  console.log('\n[H] les retours du 8 novembre');
  const lireTicket = (page) => page.evaluate(() => ({
    bowling: ((document.getElementById('rsL-a-bowling') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    laser: ((document.getElementById('rsL-a-laser_game') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    pistes: [...(quickBookState.lanes || [])].map(Number),
  }));
  // Deux parties de laser : la deuxieme a sa rangee sur le bloc.
  const m = await ouvrir(browser, { reservations: () => [] });
  try {
    const { page } = m;
    await C.ouvrirFenetre(page, 6);
    await verifie(page, 'bowling');
    await page.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page);
    await page.locator('#rsAjout-laser_game').click();
    await C.pret(page);
    await verifie(page, 'laser_game');
    await page.locator('#rsV-laser_game-2').click();
    await C.pret(page);
    await page.waitForTimeout(250);
    const rangee = await page.evaluate(() => {
      const r = document.querySelector('#rsZ-laser_game .rs-partie');
      const on = r && r.querySelector('.rs-h.is-on');
      return { nom: r ? (r.querySelector('.rs-partie-l') || {}).textContent : '', heures: r ? [...r.querySelectorAll('.rs-h')].map((b) => b.dataset.heureP) : [], choisie: on ? on.dataset.heureP : '', tag: on ? ((on.querySelector('.rs-h-tag') || {}).textContent || '') : '' };
    });
    ok(rangee.nom === 'Partie 2' && rangee.choisie === '18:30' && rangee.tag === 'à la suite' && rangee.heures.includes('19:30'), '[H] deux parties : la rangee « Partie 2 » sur le bloc, « à la suite » cochee', rangee);
    await page.locator('#rsZ-laser_game .rs-partie .rs-h[data-heure-p="19:30"]').click();
    await C.pret(page);
    await page.waitForTimeout(250);
    const t2 = await lireTicket(page);
    ok(/18:00, puis 19:30/.test(t2.laser), '[H] une heure de la partie 2 touchee sur le bloc : le ticket la dit', t2);
    await creer(page, 'Banc Deux Parties');
    const [r] = await neufs(page, m.avant);
    const departs = [...new Set((planDe(r).resourceBlocks || []).filter((b) => b.resourceType === 'laser_arena').map((b) => b.startTime))].sort();
    ok(Boolean(r) && departs.join() === '18:00,19:30', '[H] le dossier cree porte la deuxieme partie a 19:30', r && { departs, pax: r.pax });
  } finally { await finir(m, 'H1'); }
  // Une visite bowling et laser, piste 3 choisie a la main, de 6 a 7 joueurs.
  const m2 = await ouvrir(browser, { reservations: () => [] });
  try {
    const { page } = m2;
    await C.ouvrirFenetre(page, 6);
    await verifie(page, 'bowling');
    await page.locator('#rsZ-bowling .rs-h[data-heure="17:00"]').click();
    await C.pret(page);
    await page.locator('#rsAjout-laser_game').click();
    await C.pret(page);
    await page.locator('#rsL-a-bowling').click();
    await page.waitForSelector('[data-piste="3"]');
    await page.locator('[data-piste="3"]').click();
    await C.pret(page);
    await page.locator('#rsRetour').click();
    await page.waitForSelector('.is-q-activites');
    const a6 = await lireTicket(page);
    ok(JSON.stringify(a6.pistes) === '[3]', '[H] MONTAGE : 6 joueurs sur la piste 3, choisie a la main', a6);
    await page.locator('#rsHaut [data-pax="7"]').click();
    await C.pret(page);
    const a7 = await lireTicket(page);
    ok(a7.pistes.length === 2 && a7.pistes.includes(3) && /pistes \d+ et \d+, dont 3 choisie à la main/.test(a7.bowling) && /78/.test(a7.bowling), '[H] une visite de 7, piste 3 choisie a la main : deux pistes, la 3 gardee', a7);
    await page.locator('#rsHaut [data-pax="6"]').click();
    await C.pret(page);
    const r6 = await lireTicket(page);
    ok(JSON.stringify(r6.pistes) === '[3]' && /piste 3, choisie à la main/.test(r6.bowling), '[H] le groupe redescend a 6 : la piste ajoutee s en va, la 3 reste', r6);
    await page.locator('#rsHaut [data-pax="7"]').click();
    await C.pret(page);
    await creer(page, 'Banc Visite Sept');
    const [r] = await neufs(page, m2.avant);
    const pistes = r ? (r.lanes || []).map(Number).sort((x, y) => x - y) : [];
    ok(Boolean(r) && Number(r.pax) === 7 && pistes.length === 2 && pistes.includes(3), '[H] le dossier cree a 7 a ses deux pistes, la 3 comprise', r && { pistes, pax: r.pax, type: r.type });
  } finally { await finir(m2, 'H2'); }
}

// ---------------------------------------------------------------------------
// [I] UNE FORMULE N EST PAS UN TICKET VIDE
// ---------------------------------------------------------------------------
const MERCREDI = '2027-01-20';
async function scenarioI(browser) {
  console.log('\n[I] une formule n est pas un ticket vide');
  const lire = (page) => page.evaluate(() => {
    const b = document.getElementById('rvCreer');
    const plan = rvPlanCourant();
    const t = (id) => ((document.getElementById(id) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    return {
      texte: b ? b.textContent.replace(/\s+/g, ' ').trim() : '', bloque: Boolean(b && b.classList.contains('is-bloque')), pret: b ? b.dataset.pret : '',
      activites: rvActivites(), formule: quickBookState.formuleId, date: quickBookState.date, heure: quickBookState.startTime, pax: Number(quickBookState.pax), q: rsEtat().q,
      plan: plan ? { disponible: plan.disponible, debut: plan.debut, fin: plan.fin, prix: plan.prix, refus: plan.refus, etapes: (plan.etapes || []).map((e) => e.activite) } : null,
      erreur: (rvConstruire({ simulation: true }) || {}).erreur || '', avertissement: rvAvertissement(),
      total: t('rvTotalPied'), ticket: t('rsLignes'), verdict: t('rvVerdict'),
    };
  });
  const posts = (m) => m.journal.filter((j) => j.m === 'POST' && String(j.url).startsWith('/api/staff-reservations') && j.corps);
  const creations = (m) => posts(m).filter((j) => !j.corps.dryRun);
  const simulations = (m, heure) => posts(m).filter((j) => j.corps.dryRun === true && j.corps.formuleId === 'kfd' && j.corps.startTime === heure);
  // (une attente bornee : c est le gate qui doit rougir sur sa cible, pas une attente qui expire)
  const borne = (p) => p.catch(() => {});
  const planPret = (page) => borne(page.waitForFunction(() => { const b = document.getElementById('rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 6000 }));
  // La souris du comptoir : la date, les joueurs, la formule, puis son heure dans « Autres ».
  async function kidsFunDay(page, { heure = '', offres = false } = {}) {
    await page.locator('.btn-new').click();
    await page.waitForSelector('#qbDate', { state: 'attached' });
    await page.locator('#qbDate').fill(MERCREDI);
    await page.locator('#rsHaut [data-pax="12"]').click();
    await page.locator('#rsFormules').click();
    if (offres) await page.locator('#rsOffres').click();
    await page.locator('#rsF-kfd').click();
    if (!heure) return;
    await planPret(page);
    await page.locator('.rs-h-autres').click();
    await page.locator(`#rsCorps .rs-h[data-heure="${heure}"]`).click();
    await planPret(page);
    await page.waitForTimeout(250);
  }
  // Mercredi devient aujourd hui, pour la page ET pour le serveur.
  async function mercrediAujourdhui(m, heure) {
    const instant = FX.instant(MERCREDI, heure).getTime();
    globalThis.__comptoirMaintenant = instant;
    B.base.horloge = instant;
    await m.page.clock.setFixedTime(new Date(instant));
  }

  // Un mercredi a venir, comme au comptoir, jusqu au dossier en base.
  let corpsDeLaFenetre = null;
  const m = await ouvrir(browser, { reservations: () => [] });
  try {
    const { page } = m;
    await kidsFunDay(page, { heure: '14:00' });
    const e = await lire(page);
    ok(e.formule === 'kfd' && e.date === MERCREDI && e.pax === 12 && e.heure === '14:00' && e.activites.length === 0 && e.total === '360 €', '[I] MONTAGE : Kids Fun Day un mercredi, 12 joueurs, 14:00, rien a composer, 360 € au ticket', e);
    const parties = simulations(m, '14:00');
    corpsDeLaFenetre = parties.length ? parties[parties.length - 1].corps : null;
    ok(Boolean(corpsDeLaFenetre) && corpsDeLaFenetre.type === 'formule', '[I] la simulation part au serveur, pour la formule a 14:00', posts(m).slice(-3).map((j) => ({ dry: j.corps.dryRun, f: j.corps.formuleId, h: j.corps.startTime })));
    ok(Boolean(e.plan) && e.plan.disponible === true && e.plan.debut === '14:00' && e.plan.fin === '17:00' && e.plan.prix === 360 && e.plan.etapes.join() === 'playground,arcade_time', '[I] le serveur tient la formule : de 14:00 a 17:00, 360 €, ses etapes a lui', e.plan);
    ok(/^Créer à 14:00/.test(e.texte) && !e.bloque && e.pret === '1', '[I] Kids Fun Day a 14:00 : le bouton dit « Créer à 14:00 », sans is-bloque', e);
    await creer(page, 'Banc Kids Fun Day');
    const [r] = await neufs(page, m.avant);
    const lu = r ? { formule: r.formule_id, type: r.type, date: String(r.date).slice(0, 10), heure: String(r.start_time).slice(0, 5), pax: Number(r.pax), prix: Number(r.price), pistes: r.lanes } : null;
    ok(Boolean(lu) && creations(m).length === 1 && lu.formule === 'kfd' && lu.type === 'formule' && lu.date === MERCREDI && lu.heure === '14:00' && lu.pax === 12 && lu.prix === 360, '[I] le clic cree le dossier en base : la formule, 14:00, 12 joueurs, 360 €', { lu, creations: creations(m).length, ecran: await lire(page).catch(() => 'fenetre fermee') });
  } finally { await finir(m, 'I1'); }

  // Gembloux n a pas de plaine de jeux : la meme formule, ses arcades seules, le corps que la
  // fenetre vient d envoyer.
  serveur.changerSession(B.sessionDuRole('direction', { nom: 'Accueil', centre: 'gembloux' }));
  const corpsGembloux = { ...(corpsDeLaFenetre || {}), centerId: 'gembloux' };
  delete corpsGembloux.dryRun;
  const sim = await serveur.appeler('POST', '/api/staff-reservations', { ...corpsGembloux, dryRun: true });
  const planG = sim.json.plan || {};
  ok(sim.statut === 200 && planG.disponible === true && planG.debut === '14:00' && planG.fin === '17:00' && planG.prix === 360 && (planG.etapes || []).map((x) => x.activite).join() === 'arcade_time', '[I] Gembloux (sans plaine de jeux) : le serveur tient la formule sur ses arcades, 360 €', { statut: sim.statut, plan: planG, message: sim.json.message || sim.json.error });
  const cree = await serveur.appeler('POST', '/api/staff-reservations', { ...corpsGembloux, name: 'Banc Gembloux' });
  const resa = cree.json.reservation || {};
  ok(cree.statut === 201 && resa.centerId === 'gembloux' && resa.formuleId === 'kfd' && resa.startTime === '14:00' && Number(resa.price) === 360, '[I] Gembloux : le meme corps cree le dossier', { statut: cree.statut, centre: resa.centerId, formule: resa.formuleId, heure: resa.startTime, prix: resa.price, message: cree.json.message || cree.json.error });

  // Un ticket sans formule ni activite reste bloque, comme avant.
  const m2 = await ouvrir(browser, { reservations: () => [] });
  try {
    const { page } = m2;
    await page.evaluate(() => openQuickBook({ date: state.currentDate, type: 'formule' }));
    await page.locator('#rsHaut [data-pax="6"]').click();
    await page.waitForTimeout(500);
    const e = await lire(page);
    ok(e.formule === '' && e.activites.length === 0 && e.q === 'formules', '[I] MONTAGE : un ticket sans formule ni activite', e);
    ok(e.bloque && e.texte === 'Créer' && e.pret === '0', '[I] un ticket vraiment vide reste bloque', e);
    await page.locator('#rvCreer').click();
    await page.waitForTimeout(500);
    const apres = await lire(page);
    ok(creations(m2).length === 0 && apres.q === 'activites' && apres.bloque, '[I] et son clic ne cree rien, il ramene aux activites', { creations: creations(m2).length, q: apres.q, bloque: apres.bloque });
  } finally { await finir(m2, 'I2'); }

  // Un centre qui ferme a 18:00 le mercredi : 14:00 + les 5 h annoncees depassaient, la fenetre
  // ne demandait jamais le plan. Le serveur, lui, tient cette arrivee.
  const centre = require(path.join(ROOT, 'lib/ops-knowledge.js')).getCenter('libramont');
  const horaire = centre.defaultSchedule.regular['3'];
  centre.defaultSchedule.regular['3'] = { open: '12:00', close: '18:00' };
  const m3 = await ouvrir(browser, { reservations: () => [] });
  try {
    const { page } = m3;
    await page.evaluate(() => { centerScheduleConfig.defaultSchedule.regular[3] = { open: '12:00', close: '18:00' }; });
    await kidsFunDay(page, { heure: '14:00' });
    const e = await lire(page);
    ok(simulations(m3, '14:00').length > 0 && !e.erreur && Boolean(e.plan) && e.plan.disponible === true, '[I] un centre qui ferme a 18:00 : la simulation part quand meme', e);
    ok(/^Créer à 14:00/.test(e.texte) && !e.bloque && !e.avertissement && !/hors horaires/i.test(e.verdict), '[I] et le bouton dit « Créer à 14:00 », sans faux « hors horaires »', e);
  } finally { centre.defaultSchedule.regular['3'] = horaire; await finir(m3, 'I3'); }

  // Mercredi, c est aujourd hui : on encaisse en creant, la formule n y fait pas exception.
  const m4 = await ouvrir(browser, { reservations: () => [] });
  try {
    const { page } = m4;
    await mercrediAujourdhui(m4, '13:10');
    await page.evaluate((jour) => { state.currentDate = jour; }, MERCREDI);
    await kidsFunDay(page, { heure: '14:00' });
    const boutons = await page.evaluate(() => [...document.querySelectorAll('#rvPied .rs-payer')].map((b) => ({ mot: b.textContent.trim(), actif: !b.disabled, visible: b.getClientRects().length > 0 })));
    ok(boutons.length === 2 && boutons.every((b) => b.actif && b.visible), '[I] aujourd hui, un mercredi : les deux boutons Payé sont utilisables', { boutons, ...(await lire(page)) });
    await page.locator('#qbQui').fill('Banc Mercredi');
    await page.waitForTimeout(200);
    await page.locator('#rvPied .rs-payer', { hasText: 'Payé carte' }).click();
    const [neuve] = await neufs(page, m4.avant);
    // (ce banc ne simule pas l UPDATE du paiement : le PATCH part au vrai handler et la chaine
    // complete, jusqu au statut en base, est tenue par comptoir-reserver-check [R4])
    const paiement = () => m4.journal.filter((j) => j.m === 'PATCH' && j.corps && j.corps.status === 'paid');
    await attendreBase(page, () => paiement().length > 0);
    const demande = paiement()[0] ? paiement()[0].corps : null;
    ok(Boolean(neuve) && neuve.formule_id === 'kfd' && Number(neuve.price) === 360 && Boolean(demande) && Number(demande.id) === Number(neuve.id) && demande.paymentMethod === 'Carte Bancaire', '[I] Payé carte cree le dossier de la formule et demande son encaissement', { dossier: neuve && { id: neuve.id, formule: neuve.formule_id, prix: neuve.price }, demande });
  } finally { await finir(m4, 'I4'); }

  // Hors de sa fenetre : le serveur refuse, la fenetre n a aucune activite ou chercher une autre
  // heure. Le refus se dit, le bouton ne reste pas sur « Recherche… ».
  const m5 = await ouvrir(browser, { reservations: () => [] });
  try {
    const { page } = m5;
    await mercrediAujourdhui(m5, '17:10');
    await kidsFunDay(page, { offres: true });
    await borne(page.waitForFunction(() => { const p = rvPlanCourant(); return p && !p.disponible; }, null, { timeout: 6000 }));
    await page.waitForTimeout(400);
    const e = await lire(page);
    ok(Boolean(e.plan) && e.plan.disponible === false, '[I] MONTAGE : a 17:10, le serveur refuse la formule', e);
    ok(e.bloque && !/Recherche/.test(e.texte) && !/cherche/.test(e.verdict) && Boolean(e.plan && e.plan.refus) && e.ticket.includes(e.plan.refus.replace(/\s:\s/g, ', ')), '[I] hors de sa fenetre : le refus se lit sur le ticket, le bouton ne cherche pas sans fin', e);
  } finally { await finir(m5, 'I5'); }
}

const SCENARIOS = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD, E: scenarioE, F: scenarioF, G: scenarioG, H: scenarioH, I: scenarioI };

function verifierLesAncres() {
  let mortes = 0;
  MUTATIONS.forEach((m) => { const n = compteAncre(m); if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom} trouvee ${n} fois : ${m.de.slice(0, 80)}`); } });
  console.log(`comptoir-check --ancres : ${MUTATIONS.length - mortes}/${MUTATIONS.length} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS;
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, COMPTOIR_CASSE: m.nom, PINLANE_COMPTOIR_PORT: String(PORT + 1 + fil) },
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
  console.log(`comptoir-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: C.BROWSER_PATH, headless: true });
  try {
    for (const nom of seul) await SCENARIOS[nom](browser);
  } finally {
    await browser.close();
    http.close();
  }
  console.log(`\ncomptoir-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('comptoir-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

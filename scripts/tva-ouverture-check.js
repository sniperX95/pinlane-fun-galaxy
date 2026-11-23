// QUAND MODIFIER S OUVRE HORS TVA (2026-11-23, Ansar : « on choisit, c est pas mis d office, mais des que c est un
// groupe team building ou juste un grand groupe, la oui »).
//
// Le prix d un dossier se lit TVAC ou HTVA dans Modifier (scripts/tva-modifier-check.js). Le centre regle, dans
// Etablissement > Le centre > TVA, a cote de ses taux, quand la fiche s ouvre deja en HTVA : « Jamais » (le defaut :
// rien ne change pour un centre qui ne regle rien), « Toutes les réservations », « Les groupes seulement » (un team
// building, l occasion « Team building » ou « Entreprise » ; ou un grand groupe, celui que le moteur a coupe en
// plusieurs groupes : des sous-groupes qui tournent, des services de bowling, des vagues de laser). Le comptoir
// bascule toujours a la main, et son choix tient tant que la fiche reste ouverte.
//
//   [S1] LE SERVEUR, sur la base en memoire du banc (scripts/reserver-banc.js) : lib/center-config.js
//        normalizeHtvaParDefaut garde les trois valeurs et rend « jamais » pour tout le reste ; un centre qui ne
//        regle rien lit « jamais » ; une config deja en base sans la cle se lit « jamais » a la page Etablissement
//        (lib/center-scope.js) comme au poll (api/staff-state.js) ; la vraie sauvegarde (api/ops.js
//        saveCenterConfig) range le reglage, ne fait pas confiance au corps, et une sauvegarde sans lui garde celui
//        enregistre ; la page et le poll relisent le reglage enregistre.
//   [C1] LA REGLE A L OUVERTURE, les vraies fonctions de la console en VM (openPos, ouvrirOngletFiche) : les trois
//        reglages × une reservation normale, un team building (« Team building », « Entreprise »), un grand groupe
//        (sous-groupes qui tournent, services de bowling, vagues de laser). Aucun seuil invente : 40 joueurs que le
//        centre prend d un coup restent une reservation normale.
//   [C2] Sans taux lus, Modifier s ouvre en TVAC ; les taux qui arrivent ensuite ne basculent pas la fiche.
//   [C3] Le reglage se lit sur la page Etablissement d abord, puis au poll ; illisible, il vaut « jamais ».
//   [C4] Le choix du comptoir tient tant que la fiche est ouverte (un etat d edition refait, le poll, Modifier rouvert
//        depuis Infos, le reglage ou les taux qui changent apres l ouverture) ; un calcul fait sur un autre dossier
//        n y touche pas ; fermee, ou rouverte par une porte de la fiche, elle repart du reglage.
//   [C5] Etablissement : la rubrique TVA montre le reglage enregistre et ses trois choix en mots simples, la barre
//        dit le changement, et le choix part avec la fiche du centre.
//
// CONTRE-PREUVES : `--contre-preuves` rejoue le gate sur le code casse expres, une mutation a la fois (en memoire,
// le disque n est jamais touche), et exige que CHAQUE cible de la mutation rougisse ; chaque case de la grille [C1]
// est la cible d au moins une mutation (verifie avant de jouer). `--contre-preuves=nom,nom` en joue quelques-unes ;
// `--ancres` verifie que chaque ancre existe une seule fois ; `--seul=S1,C1` ne joue que ces lettres.
//
// Aucun navigateur, aucun reseau sortant, aucune vraie base : rien ne part. La partie navigateur (Etablissement
// puis Modifier, sur la vraie console) vit dans scripts/tva-modifier-check.js [B3].
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

delete process.env.RESEND_API_KEY;
delete process.env.POSTGRES_URL;
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fetchOrigine = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) throw new Error(`gate : appel sortant refuse vers ${u.slice(0, 80)}`);
  return fetchOrigine(url, init);
};

const ROOT = path.resolve(__dirname, '..');
const CASSE = String(process.env.TVA_OUVERTURE_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=').slice(1).join('=') : true) : null; };
const copie = (v) => JSON.parse(JSON.stringify(v));
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const APP = 'assets/app-main.js';
const CENTRE = 'lib/center-config.js';
const PROJECTION = 'lib/center-scope.js';
const POLL = 'api/staff-state.js';

const MOTS = Object.freeze({ jamais: 'Jamais', toutes: 'Toutes les réservations', groupes: 'Les groupes seulement' });
const TAUX = Object.freeze({ activities: 6, food: 12, drinks: 21, arcades: 21 });

// ---------------------------------------------------------------------------
// LES DOSSIERS : la forme d un dossier du serveur (opsPlan.resourceBlocks, opsPlan.grandGroupe), le reste a minima.
// ---------------------------------------------------------------------------
const bloc = (resourceType, champs = {}) => ({ type: 'activity', resourceType, activityId: resourceType === 'bowling_lane' ? 'bowling' : 'laser_game', startTime: '15:00', endTime: '16:00', ...champs });
const dossier = (id, champs) => ({ id, centerId: 'libramont', date: '2027-01-16', startTime: '15:00', status: 'pending', price: 300, lanes: [], ...champs });
const DOSSIERS = {
  normale: dossier(801, { name: 'Anniversaire de Lina', occasion: 'anniversaire', pax: 10, type: 'formule', lanes: [3, 4], opsPlan: { resourceBlocks: [bloc('bowling_lane', { players: 10, lanes: [3, 4] }), bloc('laser_arena', { players: 10, groupWaveIndex: 1, groupWaveCount: 1 })] } }),
  tb: dossier(802, { name: 'Atelier Durand', occasion: 'teambuilding', pax: 12, type: 'bowling', lanes: [1, 2], opsPlan: { resourceBlocks: [bloc('bowling_lane', { players: 12, lanes: [1, 2] })] } }),
  entreprise: dossier(803, { name: 'Collègues de bureau', occasion: 'entreprise', pax: 8, type: 'bowling', lanes: [5], opsPlan: { resourceBlocks: [bloc('bowling_lane', { players: 8, lanes: [5] }), bloc('laser_arena', { players: 8 })] } }),
  rotation: dossier(804, { name: 'Club de foot', occasion: 'amis', pax: 60, type: 'bowling', opsPlan: { grandGroupe: { tourne: true, nombre: 2, tailles: [30, 30], premier: 'bowling', ordre: ['bowling', 'laser_game'] }, resourceBlocks: [bloc('bowling_lane', { players: 30, sousGroupe: 1, sousGroupes: 2 }), bloc('laser_arena', { players: 30, sousGroupe: 2, sousGroupes: 2 })] } }),
  services: dossier(805, { name: 'Famille Peeters', occasion: 'famille', pax: 70, type: 'bowling', opsPlan: { resourceBlocks: [bloc('bowling_lane', { players: 35, groupPlayers: 70, groupWaveIndex: 1, groupWaveCount: 2 }), bloc('bowling_lane', { players: 35, groupPlayers: 70, groupWaveIndex: 2, groupWaveCount: 2, startTime: '16:00', endTime: '17:00' })] } }),
  vagues: dossier(806, { name: 'EVG de Romain', occasion: 'evg', pax: 40, type: 'laser', opsPlan: { resourceBlocks: [bloc('laser_arena', { players: 20, groupWaveIndex: 1, groupWaveCount: 2 }), bloc('laser_arena', { players: 20, groupWaveIndex: 2, groupWaveCount: 2, startTime: '15:30', endTime: '16:00' })] } }),
};
// Les cas en bord de regle, sous « Les groupes seulement ».
const BORDS = {
  dUnCoup: dossier(807, { name: 'Amis de Tom', occasion: 'amis', pax: 40, type: 'bowling', opsPlan: { resourceBlocks: [bloc('bowling_lane', { players: 40, groupWaveIndex: 1, groupWaveCount: 1 })] } }),
  unSeulGroupe: dossier(808, { name: 'Famille Lambert', occasion: 'famille', pax: 20, type: 'bowling', opsPlan: { grandGroupe: { tourne: false, nombre: 1, tailles: [20] }, resourceBlocks: [bloc('bowling_lane', { players: 20 })] } }),
  resumeSeul: dossier(809, { name: 'Scouts de Bastogne', occasion: 'amis', pax: 48, type: 'bowling', opsPlan: { grandGroupe: { tourne: true, nombre: 2, tailles: [24, 24] }, resourceBlocks: [] } }),
  blocsSeuls: dossier(810, { name: 'Classe de 6e', occasion: 'amis', pax: 48, type: 'bowling', opsPlan: { resourceBlocks: [bloc('bowling_lane', { players: 24, sousGroupe: 1, sousGroupes: 2 }), bloc('laser_arena', { players: 24, sousGroupe: 2, sousGroupes: 2 })] } }),
};

const COLONNES = [
  { cle: 'normale', nom: 'une réservation normale (anniversaire, 10 joueurs)', groupe: false },
  { cle: 'tb', nom: 'un team building (occasion « Team building »)', groupe: true },
  { cle: 'entreprise', nom: 'un team building (occasion « Entreprise »)', groupe: true },
  { cle: 'rotation', nom: 'un grand groupe en sous-groupes qui tournent', groupe: true },
  { cle: 'services', nom: 'un grand groupe en deux services de bowling', groupe: true },
  { cle: 'vagues', nom: 'un grand groupe en deux vagues de laser', groupe: true },
];
const REGLAGES = ['jamais', 'toutes', 'groupes'];
const attenduDe = (reglage, col) => (reglage === 'toutes' || (reglage === 'groupes' && col.groupe) ? 'HTVA' : 'TVAC');
const caseC1 = (reglage, cle) => { const col = COLONNES.find((c) => c.cle === cle); return `[C1] « ${MOTS[reglage]} » × ${col.nom} : ${attenduDe(reglage, col)}`; };
const CASES_C1 = REGLAGES.flatMap((reglage) => COLONNES.map((col) => caseC1(reglage, col.cle)));
const BORD = {
  dUnCoup: '[C1] « Les groupes seulement » × 40 joueurs que le centre prend d un coup (un seul service) : TVAC',
  unSeulGroupe: '[C1] « Les groupes seulement » × un plan a un seul groupe (nombre 1) : TVAC',
  resumeSeul: '[C1] « Les groupes seulement » × le resume du plan seul (2 sous-groupes, sans bloc) : HTVA',
  blocsSeuls: '[C1] « Les groupes seulement » × des blocs qui disent leur sous-groupe, sans resume : HTVA',
};

// ---------------------------------------------------------------------------
// LES MUTATIONS : le code casse expres, une regle a la fois. `lettre` : S (le serveur, sur le banc) ou C (la
// console, en VM). `cibles` : les libelles qui doivent TOUS rougir.
// ---------------------------------------------------------------------------
const NORMALISER = "  return HTVA_PAR_DEFAUT.includes(valeur) ? valeur : 'jamais';";
const ENVOI_DU_POLL = '    sendJson(res, 200, { ok: true, ...snapshot, classification, accueil, vatRates, htvaParDefaut, ouvertures, modificationABlanc: true });';
const REGLE = "  const htva = reglage === 'toutes' || (reglage === 'groupes' && dossierDeGroupePourLaTva(r));";
const OCCASIONS = "  if (occasion === 'teambuilding' || occasion === 'entreprise') return true;";
const RESUME = "  if (plan.grandGroupe && typeof plan.grandGroupe === 'object' && Number(plan.grandGroupe.nombre) > 1) return true;\n";
const BLOCS = '(Number(b.groupWaveCount) > 1 || Number(b.sousGroupes) > 1)';
const LECTURE = "  const lu = centre && typeof centre.htvaParDefaut === 'string' ? centre.htvaParDefaut : (state && state.staffHtvaParDefaut);";
const MEMOIRE = '  if (prixVuDeLaFiche && r && Number(prixVuDeLaFiche.id) === Number(r.id)) return prixVuDeLaFiche.vu;\n';
const MUTATIONS = [
  // [S1] le serveur
  { nom: 'normalisation-laxiste', lettre: 'S', fichier: CENTRE, de: NORMALISER, vers: "  return typeof input === 'string' ? input : 'jamais';", cibles: ['[S1] tout le reste redevient « jamais »', '[S1] la vraie sauvegarde ne fait pas confiance au corps', '[S1] une valeur illisible deja en base se lit « jamais »'] },
  { nom: 'normalisation-fermee', lettre: 'S', fichier: CENTRE, de: NORMALISER, vers: "  return 'jamais';", cibles: ['[S1] les trois valeurs se gardent', '[S1] la vraie sauvegarde range « Les groupes seulement »', '[S1] la page Etablissement relit le reglage enregistre', '[S1] le poll de la journee sert le reglage enregistre'] },
  { nom: 'defaut-toutes', lettre: 'S', fichier: CENTRE, de: NORMALISER, vers: "  return HTVA_PAR_DEFAUT.includes(valeur) ? valeur : 'toutes';", cibles: ['[S1] un centre qui ne regle rien lit « jamais »', '[S1] une config deja en base sans la cle se lit « jamais »'] },
  { nom: 'config-sans-reglage', lettre: 'S', fichier: CENTRE, de: '    htvaParDefaut: normalizeHtvaParDefaut(merged.htvaParDefaut),\n', vers: '', cibles: ['[S1] un centre qui ne regle rien lit « jamais »', '[S1] la vraie sauvegarde range « Les groupes seulement »'] },
  { nom: 'projection-sans-reglage', lettre: 'S', fichier: PROJECTION, de: '    // Quand Modifier s ouvre hors TVA (2026-11-23), meme raison : l ecran le montre et le remet en place.\n    htvaParDefaut: config.htvaParDefaut,\n', vers: '', cibles: ['[S1] la page Etablissement relit le reglage enregistre', '[S1] une config deja en base sans la cle se lit « jamais »'] },
  { nom: 'poll-sans-reglage', lettre: 'S', fichier: POLL, de: ENVOI_DU_POLL, vers: ENVOI_DU_POLL.replace(' htvaParDefaut,', ''), cibles: ['[S1] le poll de la journee sert le reglage enregistre', '[S1] une config deja en base sans la cle se lit « jamais »'] },
  { nom: 'poll-brut', lettre: 'S', fichier: POLL, de: '    try { htvaParDefaut = normalizeHtvaParDefaut(getCenter(centerId)?.htvaParDefaut); } catch (error) { htvaParDefaut = undefined; }', vers: '    try { htvaParDefaut = getCenter(centerId)?.htvaParDefaut; } catch (error) { htvaParDefaut = undefined; }', cibles: ['[S1] une valeur illisible deja en base se lit « jamais »', '[S1] une config deja en base sans la cle se lit « jamais »'] },
  // [C1] la regle a l ouverture
  { nom: 'ouverture-sans-reglage', lettre: 'C', fichier: APP, de: '  etat.prixVu = prixVuALOuverture(reservation);\n', vers: '', cibles: [caseC1('toutes', 'normale'), caseC1('groupes', 'tb'), caseC1('groupes', 'rotation')] },
  { nom: 'jamais-comme-toutes', lettre: 'C', fichier: APP, de: REGLE, vers: REGLE.replace("reglage === 'toutes' ||", "reglage !== 'groupes' ||"), cibles: COLONNES.map((c) => caseC1('jamais', c.cle)) },
  { nom: 'toutes-ignore', lettre: 'C', fichier: APP, de: REGLE, vers: REGLE.replace("reglage === 'toutes' ||", 'false ||'), cibles: COLONNES.map((c) => caseC1('toutes', c.cle)) },
  { nom: 'groupes-pour-tous', lettre: 'C', fichier: APP, de: REGLE, vers: REGLE.replace(" && dossierDeGroupePourLaTva(r))", ')'), cibles: [caseC1('groupes', 'normale'), BORD.dUnCoup, BORD.unSeulGroupe] },
  { nom: 'team-building-oublie', lettre: 'C', fichier: APP, de: OCCASIONS, vers: '  if (false) return true;', cibles: [caseC1('groupes', 'tb'), caseC1('groupes', 'entreprise')] },
  { nom: 'entreprise-oubliee', lettre: 'C', fichier: APP, de: OCCASIONS, vers: "  if (occasion === 'teambuilding') return true;", cibles: [caseC1('groupes', 'entreprise')] },
  { nom: 'teambuilding-oublie', lettre: 'C', fichier: APP, de: OCCASIONS, vers: "  if (occasion === 'entreprise') return true;", cibles: [caseC1('groupes', 'tb')] },
  { nom: 'grand-groupe-oublie', lettre: 'C', fichier: APP, de: '  return dossierEnGrandGroupe(r);\n}', vers: '  return false;\n}', cibles: [caseC1('groupes', 'rotation'), caseC1('groupes', 'services'), caseC1('groupes', 'vagues'), BORD.resumeSeul, BORD.blocsSeuls] },
  { nom: 'resume-oublie', lettre: 'C', fichier: APP, de: RESUME, vers: '', cibles: [BORD.resumeSeul] },
  { nom: 'nombre-un-compte', lettre: 'C', fichier: APP, de: RESUME, vers: RESUME.replace('Number(plan.grandGroupe.nombre) > 1', 'Number(plan.grandGroupe.nombre) >= 1'), cibles: [BORD.unSeulGroupe] },
  { nom: 'services-et-vagues-oublies', lettre: 'C', fichier: APP, de: BLOCS, vers: '(Number(b.sousGroupes) > 1)', cibles: [caseC1('groupes', 'services'), caseC1('groupes', 'vagues')] },
  { nom: 'sous-groupes-des-blocs-oublies', lettre: 'C', fichier: APP, de: BLOCS, vers: '(Number(b.groupWaveCount) > 1)', cibles: [BORD.blocsSeuls] },
  // [C2] les taux
  { nom: 'htva-sans-taux', lettre: 'C', fichier: APP, de: "  return htva && tauxTvaDuCentre() ? 'htva' : 'tvac';", vers: "  return htva ? 'htva' : 'tvac';", cibles: ['[C2] sans taux lus, Modifier s ouvre en TVAC', '[C2] les taux qui arrivent apres l ouverture ne basculent pas la fiche'] },
  // [C3] la lecture du reglage
  { nom: 'poll-reglage-oublie', lettre: 'C', fichier: APP, de: LECTURE, vers: "  const lu = centre && typeof centre.htvaParDefaut === 'string' ? centre.htvaParDefaut : null;", cibles: ['[C3] sans la page Etablissement, la console lit le reglage du poll'] },
  { nom: 'page-reglage-ignoree', lettre: 'C', fichier: APP, de: LECTURE, vers: '  const lu = state && state.staffHtvaParDefaut;', cibles: ['[C3] la page Etablissement passe d abord'] },
  { nom: 'reglage-brut', lettre: 'C', fichier: APP, de: "  return typeof lu === 'string' && Object.prototype.hasOwnProperty.call(HTVA_PAR_DEFAUT_MOTS, lu) ? lu : 'jamais';", vers: "  return typeof lu === 'string' && lu ? lu : 'jamais';", cibles: ['[C3] un reglage illisible vaut « jamais »'] },
  { nom: 'poll-console-oublie', lettre: 'C', fichier: APP, de: '    if (payload.htvaParDefaut) state.staffHtvaParDefaut = payload.htvaParDefaut;\n', vers: '', cibles: ['[C3] le poll pose le reglage pour toute l equipe'] },
  // [C4] le choix de la fiche
  { nom: 'etat-refait-oublie-le-choix', lettre: 'C', fichier: APP, de: MEMOIRE, vers: '', cibles: ['[C4] le choix du comptoir tient : un etat d edition refait et le poll le gardent', '[C4] le choix du comptoir tient : Modifier rouvert depuis Infos', '[C4] le choix du comptoir tient : le reglage qui passe a « Toutes les réservations » ne le defait pas', '[C4] ce qui arrive apres l ouverture ne change pas la fiche : le reglage passe a « Jamais »'] },
  { nom: 'memoire-sans-dossier', lettre: 'C', fichier: APP, de: MEMOIRE, vers: '  if (prixVuDeLaFiche && r) return prixVuDeLaFiche.vu;\n', cibles: ['[C4] un calcul fait sur un autre dossier ne prend pas le choix de la fiche'] },
  { nom: 'bascule-pas-retenue', lettre: 'C', fichier: APP, de: '  if (state.selectedRes) prixVuDeLaFiche = { id: Number(state.selectedRes.id), vu: state.editState.prixVu };\n', vers: '', cibles: ['[C4] le choix du comptoir tient : un etat d edition refait et le poll le gardent'] },
  { nom: 'ouverture-pas-retenue', lettre: 'C', fichier: APP, de: "  prixVuDeLaFiche = { id: Number(r.id), vu: state.editState.prixVu === 'htva' ? 'htva' : 'tvac' };\n", vers: '', cibles: ['[C4] ce qui arrive apres l ouverture ne change pas la fiche : le reglage passe a « Jamais »', '[C4] ouverte droit dans Modifier (editRes), la decision de l ouverture tient'] },
  { nom: 'onglet-ne-retient-pas', lettre: 'C', fichier: APP, de: '    retenirPrixVuDeLaFiche();\n    syncEditLaneAssignment();\n    noterFormulaireEdition();\n', vers: '    syncEditLaneAssignment();\n    noterFormulaireEdition();\n', cibles: ['[C4] ce qui arrive apres l ouverture ne change pas la fiche : le reglage passe a « Jamais »'] },
  { nom: 'editres-ne-retient-pas', lettre: 'C', fichier: APP, de: '  state.editState = etatEditionDepuis(state.selectedRes);\n  retenirPrixVuDeLaFiche();\n  syncEditLaneAssignment();\n  renderPos();\n', vers: '  state.editState = etatEditionDepuis(state.selectedRes);\n  syncEditLaneAssignment();\n  renderPos();\n', cibles: ['[C4] ouverte droit dans Modifier (editRes), la decision de l ouverture tient'] },
  { nom: 'fermeture-garde-le-choix', lettre: 'C', fichier: APP, de: 'function oublierPrixVuDeLaFiche() {\n  prixVuDeLaFiche = null;\n}', vers: 'function oublierPrixVuDeLaFiche() {\n}', cibles: ['[C4] fermer la fiche oublie son choix', '[C4] fermee puis rouverte, la fiche repart du reglage', '[C4] rouverte par le planning (openPos), la fiche repart du reglage'] },
  { nom: 'ferme-sans-oublier', lettre: 'C', fichier: APP, de: "  state.selectedRes = null;\n  oublierPrixVuDeLaFiche();\n  ficheFaitsPeints = '';", vers: "  state.selectedRes = null;\n  ficheFaitsPeints = '';", cibles: ['[C4] fermer la fiche oublie son choix'] },
  { nom: 'openpos-sans-oublier', lettre: 'C', fichier: APP, de: '  // (TVAC ou HTVA : une fiche ouverte repart du reglage du centre)\n  oublierPrixVuDeLaFiche();\n', vers: '', cibles: ['[C4] rouverte par le planning (openPos), la fiche repart du reglage'] },
  { nom: 'liste-sans-oublier', lettre: 'C', fichier: APP, de: '  state.currentDate = reservation.date || state.currentDate;\n  oublierPrixVuDeLaFiche();\n', vers: '  state.currentDate = reservation.date || state.currentDate;\n', cibles: ['[C4] rouverte par une liste (openStaffReservationDetail), la fiche repart du reglage'] },
  { nom: 'editres-sans-oublier', lettre: 'C', fichier: APP, de: "  if (!state.selectedRes) return;\n  oublierPrixVuDeLaFiche();\n  state.activeTab = 'modifier';", vers: "  if (!state.selectedRes) return;\n  state.activeTab = 'modifier';", cibles: ['[C4] ouverte droit dans Modifier (editRes), la fiche repart du reglage'] },
  // [C5] Etablissement
  { nom: 'page-ignore-le-reglage', lettre: 'C', fichier: APP, de: "  const ouverture = Object.prototype.hasOwnProperty.call(HTVA_PAR_DEFAUT_MOTS, center.htvaParDefaut) ? center.htvaParDefaut : 'jamais';", vers: "  const ouverture = 'jamais';", cibles: ['[C5] la rubrique TVA montre le reglage enregistre et ses trois choix'] },
  { nom: 'page-reglage-brut', lettre: 'C', fichier: APP, de: "  const ouverture = Object.prototype.hasOwnProperty.call(HTVA_PAR_DEFAUT_MOTS, center.htvaParDefaut) ? center.htvaParDefaut : 'jamais';", vers: "  const ouverture = center.htvaParDefaut || 'jamais';", cibles: ['[C5] un centre sans reglage, ou un reglage illisible, se montre « Jamais »'] },
  { nom: 'envoi-oublie', lettre: 'C', fichier: APP, de: "  return champ ? String(champ.value || '') : undefined;", vers: '  return undefined;', cibles: ['[C5] le choix part avec la fiche du centre'] },
  { nom: 'envoi-pas-branche', lettre: 'C', fichier: APP, de: '    htvaParDefaut: collectEstablishmentHtvaParDefaut(),\n', vers: '', cibles: ['[C5] submitCenterConfig envoie le choix'] },
  { nom: 'barre-muette', lettre: 'C', fichier: APP, de: "  if (cle === 'estab-tva-ouverture') return `Prix hors TVA à l’ouverture : ${(HTVA_PAR_DEFAUT_MOTS[v] || HTVA_PAR_DEFAUT_MOTS.jamais).toLowerCase()}`;\n", vers: '', cibles: ['[C5] la barre dit le changement en mots'] },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}

const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
if (CASSE && !mutation) { console.error(`tva-ouverture-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
function verifierAncre(m) {
  return lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
}
if (mutation && verifierAncre(mutation) !== 1) {
  console.error(`tva-ouverture-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// [S1] LE SERVEUR, sur le banc : la vraie sauvegarde (api/ops.js), la projection de la page (lib/center-scope.js)
// et le vrai poll (api/staff-state.js), sur la base en memoire.
// ---------------------------------------------------------------------------
let leBanc = null;
function banc() {
  if (leBanc) return leBanc;
  const B = require('./reserver-banc.js');
  B.monter({
    mutations: mutation && mutation.lettre === 'S' ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [],
    session: B.sessionDuRole('direction', { nom: 'Accueil' }),
  });
  // La table des centres : la lecture et l ecriture de la vraie sauvegarde (saveCenterConfigOverride).
  const pg = require(require.resolve('pg', { paths: [ROOT] }));
  const queryAvant = pg.Client.prototype.query;
  pg.Client.prototype.query = async function (sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    const centre = B.base.centers.find((c) => c.id === params[0]);
    if (s === 'select settings from centers where id = $1 limit 1;') return centre ? { rows: [{ settings: copie(centre.settings || {}) }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (s === 'select status from centers where id = $1 limit 1;') return centre ? { rows: [{ status: centre.status }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (s.startsWith("update centers set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{config}', $2::jsonb, true)")) {
      if (!centre) return { rows: [], rowCount: 0 };
      centre.settings = { ...(centre.settings || {}), config: JSON.parse(params[1]) };
      centre.status = params[2];
      return { rows: [], rowCount: 1 };
    }
    return queryAvant.call(this, sql, params);
  };
  leBanc = B;
  return B;
}

async function scenarioS1() {
  console.log('\n[S1] le serveur : le reglage du centre');
  const B = banc();
  const CC = require(path.join(ROOT, CENTRE));
  const ops = require(path.join(ROOT, 'api/ops.js'));
  const poll = require(path.join(ROOT, POLL));
  const projection = require(path.join(ROOT, PROJECTION));
  const rafraichir = () => require(path.join(ROOT, 'lib/ops-knowledge.js')).refreshCenterOverrides(require(path.join(ROOT, 'lib/database.js')).getPool(), { force: true });
  const poserCentre = (config) => B.base.centers.splice(0, B.base.centers.length, { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: { config: copie(config) } });
  const enBase = () => ((B.base.centers[0] || {}).settings || {}).config || {};
  const sauver = (config) => B.appeler(ops, 'POST', '/api/ops', { action: 'saveCenterConfig', centerId: 'libramont', config });
  const lirePoll = () => B.appeler(poll, 'GET', `/api/staff-state?date=${B.JOUR}&centerId=libramont`);
  const page = () => projection.projectCenterRow(B.base.centers[0]).htvaParDefaut;

  const N = CC.normalizeHtvaParDefaut;
  if (!ok(typeof N === 'function', 'MONTAGE lib/center-config.js exporte normalizeHtvaParDefaut')) return;
  const gardees = ['jamais', 'toutes', 'groupes', ' Groupes ', 'TOUTES'].map((v) => N(v));
  ok(egal(gardees, ['jamais', 'toutes', 'groupes', 'groupes', 'toutes']), '[S1] les trois valeurs se gardent (« Groupes » se lit « groupes »)', gardees);
  const reste = [undefined, null, '', 'partout', 'groupe', 'oui', 42, true, {}, ['groupes'], { groupes: true }, 'toString', '__proto__', 'constructor'].map((v) => N(v));
  ok(reste.every((v) => v === 'jamais'), '[S1] tout le reste redevient « jamais »', reste);
  const rien = [CC.normalizeCenterConfig({}, 'libramont').htvaParDefaut, CC.normalizeCenterConfig({}, 'gembloux').htvaParDefaut, CC.normalizeCenterConfig(null, 'libramont').htvaParDefaut, CC.normalizeCenterConfig({}, 'centre-tout-neuf').htvaParDefaut];
  ok(rien.every((v) => v === 'jamais'), '[S1] un centre qui ne regle rien lit « jamais » (Libramont, Gembloux, un centre neuf)', rien);

  // Un centre enregistre AVANT ce reglage : sa config en base ne porte pas la cle, et elle passe devant le fichier.
  poserCentre({ vatRates: { ...TAUX, drinks: 6 } });
  await rafraichir();
  const page0 = page();
  const poll0 = await lirePoll();
  ok(page0 === 'jamais' && poll0.statut === 200 && poll0.json.htvaParDefaut === 'jamais', '[S1] une config deja en base sans la cle se lit « jamais » (page Etablissement et poll)', { page: page0, statut: poll0.statut, poll: poll0.json.htvaParDefaut });

  const r1 = await sauver({ htvaParDefaut: 'groupes' });
  ok(r1.statut === 200 && enBase().htvaParDefaut === 'groupes' && (enBase().vatRates || {}).drinks === 6, '[S1] la vraie sauvegarde range « Les groupes seulement », les taux du centre restent', { statut: r1.statut, message: r1.json.message || r1.json.error, enBase: { htva: enBase().htvaParDefaut, boissons: (enBase().vatRates || {}).drinks } });
  await rafraichir();
  const page1 = page();
  ok(page1 === 'groupes', '[S1] la page Etablissement relit le reglage enregistre (lib/center-scope.js)', page1);
  const poll1 = await lirePoll();
  ok(poll1.statut === 200 && poll1.json.htvaParDefaut === 'groupes', '[S1] le poll de la journee sert le reglage enregistre a toute l equipe (api/staff-state.js)', { statut: poll1.statut, poll: poll1.json.htvaParDefaut });

  const r2 = await sauver({ vatRates: { food: '12' } });
  ok(r2.statut === 200 && enBase().htvaParDefaut === 'groupes', '[S1] une sauvegarde sans le reglage garde celui enregistre', { statut: r2.statut, enBase: enBase().htvaParDefaut });

  const vus = [];
  for (const v of ['partout', { $ne: 'jamais' }, ['toutes'], 7]) {
    await sauver({ htvaParDefaut: 'toutes' }); // eslint-disable-line no-await-in-loop
    const avant = enBase().htvaParDefaut;
    const rep = await sauver({ htvaParDefaut: v }); // eslint-disable-line no-await-in-loop
    vus.push({ envoye: v, avant, statut: rep.statut, enBase: enBase().htvaParDefaut });
  }
  ok(vus.every((x) => x.avant === 'toutes' && x.statut === 200 && x.enBase === 'jamais'), '[S1] la vraie sauvegarde ne fait pas confiance au corps : une valeur inconnue s enregistre « jamais »', vus);

  poserCentre({ htvaParDefaut: 'partout' });
  await rafraichir();
  const page2 = page();
  const poll2 = await lirePoll();
  ok(page2 === 'jamais' && poll2.statut === 200 && poll2.json.htvaParDefaut === 'jamais', '[S1] une valeur illisible deja en base se lit « jamais » (page Etablissement et poll)', { page: page2, poll: poll2.json.htvaParDefaut });
}

// ---------------------------------------------------------------------------
// LA CONSOLE EN VM : ses vraies fonctions, la regle, la memoire de la fiche et ses portes (openPos, closePos,
// editRes, ouvrirOngletFiche, openStaffReservationDetail, hydrateSelectedReservation), la rubrique d Etablissement.
// Ce qu elles touchent d autre (le rendu, le DOM, le reseau) est double ici.
// ---------------------------------------------------------------------------
const FONCTIONS = [
  'tauxTvaDuCentre', 'reglageHtvaDuCentre', 'dossierEnGrandGroupe', 'dossierDeGroupePourLaTva', 'prixVuDuReglage',
  'prixVuALOuverture', 'retenirPrixVuDeLaFiche', 'oublierPrixVuDeLaFiche', 'basculerTvaEdition', 'prixHorsTvaEdition', 'choixTvaEditionHtml',
  'etatEditionDepuis', 'pistesDeLaFormuleSeule', 'pistesALaMainDuDossier', 'departsEdition',
  'openPos', 'closePos', 'editRes', 'ouvrirOngletFiche', 'openStaffReservationDetail', 'hydrateSelectedReservation',
  'ebE', 'ebJs', 'ebNum', 'ebSeg', 'ebR', 'ebG', 'ebTvaHtml', 'collectEstablishmentHtvaParDefaut', 'ebDireUnChangement',
];
const CONSTANTES = ['TVA_SORTES', 'HTVA_PAR_DEFAUT_MOTS'];
const MEMOIRE_DE_LA_FICHE = '\nvar prixVuDeLaFiche = null;\n';

function sourceDeLaConsole() {
  let app = lf(fs.readFileSync(path.join(ROOT, APP), 'utf8'));
  if (mutation && mutation.lettre === 'C') app = app.split(mutation.de).join(mutation.vers);
  return app;
}
// Une fonction de premier niveau, telle qu ecrite : une ligne quand elle tient sur une ligne, sinon jusqu a sa
// premiere accolade fermante en debut de ligne.
function fonctionSource(app, nom) {
  const m = new RegExp(`\\n(?:async )?function ${nom}\\(`).exec(app);
  if (!m) return null;
  const debut = m.index + 1;
  const finLigne = app.indexOf('\n', debut);
  const ligne = app.slice(debut, finLigne);
  if (/\}\s*$/.test(ligne) && (ligne.match(/\{/g) || []).length === (ligne.match(/\}/g) || []).length) return ligne;
  const fin = app.indexOf('\n}\n', debut);
  return fin < 0 ? null : app.slice(debut, fin + 2);
}

function consoleEnVm() {
  const app = sourceDeLaConsole();
  const elements = {};
  const overlay = { classList: { contains: () => true, add() {}, remove() {} }, querySelector: () => null, innerHTML: '' };
  const bac = {
    console: { log() {}, warn() {}, error() {} },
    state: { reservations: [], selectedRes: null, editState: null, activeTab: 'details', staffTva: null, staffHtvaParDefaut: null, currentDate: '2027-01-16' },
    staffCenterConfigCache: { centers: [] },
    getCurrentStaffCenterId: () => 'libramont',
    escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    escapeJsString: (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
    document: { getElementById: (id) => (id === 'posOverlay' ? overlay : (elements[id] || null)), activeElement: null },
    window: {},
    __elements: elements,
    __rendus: 0,
  };
  vm.createContext(bac);
  vm.runInContext([
    'var renderPos = function () { __rendus += 1; };',
    'var syncEditLaneAssignment = function () {}, noterFormulaireEdition = function () {}, save = function () {}, toast = function () {}, upsertReservationInState = function () {};',
    'var findStaffReservationById = function (id) { return state.reservations.find(function (r) { return Number(r.id) === Number(id); }) || null; };',
    'var compteArrivee = function () { return {}; }, fermerCompteArrivee = function () {}, equivalentDeLOuvreur = function () { return null; };',
    "var posReturnFocus = null, ficheFaitsPeints = '', posPriceEditOpen = false, editContactOuvert = false, heureOuverteEdition = '';",
    'var plisRetardOuverts = new Set(), historiquesOuverts = new Set(), historiquesLus = new Set(), autresOrdresFiche = new Map();',
    "var EB_ICO_MOINS = '', EB_ICO_PLUS = '', EB_NOMBRES_DITS = {}, EB_CASES_DITES = {}, EB_TEXTES_DITS = {}, EB_ZONES_DITES = {};",
    "var signeMonnaie = function () { return '€'; };",
  ].join('\n'), bac);
  const manquantes = [];
  CONSTANTES.forEach((nom) => {
    const debut = app.indexOf(`\nconst ${nom} = `);
    const fin = debut < 0 ? -1 : app.indexOf(';\n', debut + 1);
    if (fin < 0) { manquantes.push(nom); return; }
    vm.runInContext(`var ${app.slice(debut + '\nconst '.length, fin + 1)}`, bac);
  });
  if (app.split(MEMOIRE_DE_LA_FICHE).length !== 2) manquantes.push('prixVuDeLaFiche');
  else vm.runInContext(MEMOIRE_DE_LA_FICHE, bac);
  FONCTIONS.forEach((nom) => {
    const source = fonctionSource(app, nom);
    if (!source) { manquantes.push(nom); return; }
    vm.runInContext(source, bac);
  });
  const run = (code) => { const r = vm.runInContext(code, bac); return r === undefined ? undefined : JSON.parse(JSON.stringify(r)); };
  return { app, bac, manquantes, run };
}

let laConsole = null;
function laConsoleEnVm() {
  if (!laConsole) {
    laConsole = consoleEnVm();
    ok(laConsole.manquantes.length === 0, 'MONTAGE les fonctions de la regle, de la fiche et d Etablissement se lisent dans assets/app-main.js', laConsole.manquantes);
  }
  return laConsole.manquantes.length ? null : laConsole;
}
// Le bouton choisi dans Modifier (choixTvaEditionHtml) : ce que le comptoir voit.
function ecranDe(run) {
  const html = run('choixTvaEditionHtml()') || '';
  const actif = /fm-tva-b active" aria-pressed="true" data-tva="(tvac|htva)"/.exec(html);
  return actif ? actif[1] : '';
}
const etatDe = (run) => ({ prixVu: run('state.editState && state.editState.prixVu'), ecran: ecranDe(run) });
// Ouvrir la fiche depuis le planning (openPos), puis son onglet Modifier (ouvrirOngletFiche), comme setTab.
function ouvrir(run, id) {
  run(`closePos(); openPos(${Number(id)}); ouvrirOngletFiche('modifier');`);
  return etatDe(run);
}
function poserLeJour(bac, { reglage = null, taux = TAUX, page = null } = {}) {
  bac.state.reservations = [...Object.values(DOSSIERS), ...Object.values(BORDS)].map(copie);
  bac.state.staffTva = taux ? { ...taux } : null;
  bac.state.staffHtvaParDefaut = reglage;
  bac.staffCenterConfigCache = { centers: page ? [{ id: 'libramont', ...page }] : [] };
}

// ---------------------------------------------------------------------------
// [C1] LA REGLE A L OUVERTURE
// ---------------------------------------------------------------------------
async function scenarioC1() {
  console.log('\n[C1] la regle a l ouverture : trois reglages × normale, team building, grand groupe');
  const C = laConsoleEnVm();
  if (!C) return;
  const { bac, run } = C;
  for (const reglage of REGLAGES) {
    poserLeJour(bac, { reglage });
    for (const col of COLONNES) {
      const vu = ouvrir(run, DOSSIERS[col.cle].id);
      const attendu = attenduDe(reglage, col).toLowerCase();
      ok(vu.prixVu === attendu && vu.ecran === attendu, caseC1(reglage, col.cle), vu);
    }
  }
  poserLeJour(bac, { reglage: 'groupes' });
  const bords = Object.fromEntries(Object.keys(BORDS).map((cle) => [cle, ouvrir(run, BORDS[cle].id)]));
  ok(bords.dUnCoup.prixVu === 'tvac' && bords.dUnCoup.ecran === 'tvac', BORD.dUnCoup, bords.dUnCoup);
  ok(bords.unSeulGroupe.prixVu === 'tvac' && bords.unSeulGroupe.ecran === 'tvac', BORD.unSeulGroupe, bords.unSeulGroupe);
  ok(bords.resumeSeul.prixVu === 'htva' && bords.resumeSeul.ecran === 'htva', BORD.resumeSeul, bords.resumeSeul);
  ok(bords.blocsSeuls.prixVu === 'htva' && bords.blocsSeuls.ecran === 'htva', BORD.blocsSeuls, bords.blocsSeuls);
}

// ---------------------------------------------------------------------------
// [C2] LES TAUX
// ---------------------------------------------------------------------------
async function scenarioC2() {
  console.log('\n[C2] sans taux lus, puis les taux qui arrivent');
  const C = laConsoleEnVm();
  if (!C) return;
  const { bac, run } = C;
  const TB = DOSSIERS.tb.id;
  poserLeJour(bac, { reglage: 'toutes', taux: null });
  const sans = ouvrir(run, TB);
  ok(sans.prixVu === 'tvac' && sans.ecran === 'tvac', '[C2] sans taux lus, Modifier s ouvre en TVAC, meme avec « Toutes les réservations »', sans);
  // Le poll apporte les taux apres l ouverture ; un etat refait (l echo du serveur), un repeint.
  bac.state.staffTva = { ...TAUX };
  run(`hydrateSelectedReservation(); state.editState = etatEditionDepuis(findStaffReservationById(${TB})); renderPos();`);
  const apres = etatDe(run);
  ok(apres.prixVu === 'tvac' && apres.ecran === 'tvac', '[C2] les taux qui arrivent apres l ouverture ne basculent pas la fiche', apres);
  const rouvert = ouvrir(run, TB);
  ok(rouvert.prixVu === 'htva' && rouvert.ecran === 'htva', '[C2] rouverte avec les taux, la fiche suit le reglage', rouvert);
}

// ---------------------------------------------------------------------------
// [C3] LA LECTURE DU REGLAGE
// ---------------------------------------------------------------------------
async function scenarioC3() {
  console.log('\n[C3] la lecture du reglage : la page Etablissement, puis le poll');
  const C = laConsoleEnVm();
  if (!C) return;
  const { app, bac, run } = C;
  const lire = () => run('reglageHtvaDuCentre()');
  poserLeJour(bac, { reglage: 'toutes', page: { vatRates: { ...TAUX }, htvaParDefaut: 'groupes' } });
  ok(lire() === 'groupes', '[C3] la page Etablissement passe d abord : elle vient de relire le reglage', lire());
  poserLeJour(bac, { reglage: 'toutes', page: { vatRates: { ...TAUX } } });
  const pageSansReglage = lire();
  poserLeJour(bac, { reglage: 'toutes' });
  const sansPage = lire();
  ok(pageSansReglage === 'toutes' && sansPage === 'toutes', '[C3] sans la page Etablissement, la console lit le reglage du poll', { pageSansReglage, sansPage });
  poserLeJour(bac, { reglage: null });
  bac.staffCenterConfigCache = { centers: [{ id: 'gembloux', htvaParDefaut: 'toutes' }] };
  ok(lire() === 'jamais', '[C3] le reglage d un autre centre ne compte pas ; rien de lu : « jamais »', lire());
  const illisibles = ['partout', '', 'Groupes', '__proto__', 'constructor', 'toString', 42, { groupes: true }].map((v) => { bac.state.staffHtvaParDefaut = v; return lire(); });
  ok(illisibles.every((v) => v === 'jamais'), '[C3] un reglage illisible vaut « jamais »', illisibles);
  const sync = fonctionSource(app, 'syncDateReservations') || '';
  ok(/\n {4}if \(payload\.htvaParDefaut\) state\.staffHtvaParDefaut = payload\.htvaParDefaut;\n/.test(sync), '[C3] le poll pose le reglage pour toute l equipe (syncDateReservations, lu dans le source)', sync ? 'ligne absente' : 'syncDateReservations introuvable');
}

// ---------------------------------------------------------------------------
// [C4] LE CHOIX DE LA FICHE
// ---------------------------------------------------------------------------
async function scenarioC4() {
  console.log('\n[C4] le choix du comptoir tient tant que la fiche est ouverte');
  const C = laConsoleEnVm();
  if (!C) return;
  const { bac, run } = C;
  const TB = DOSSIERS.tb.id;
  const N = DOSSIERS.normale.id;
  poserLeJour(bac, { reglage: 'groupes' });
  const ouvert = ouvrir(run, TB);
  run("basculerTvaEdition('tvac')");
  const bascule = etatDe(run);
  // Un etat refait comme apres l echo du serveur ou un conflit (applyOptimisticReservation, preserveEditState), puis
  // le poll de la journee (hydrateSelectedReservation) et un repeint (le catalogue, les offres).
  run(`state.editState = etatEditionDepuis(Object.assign({}, findStaffReservationById(${TB}), { updatedAt: '2027-01-16T15:00:00Z' }));`);
  const refait = etatDe(run);
  run('hydrateSelectedReservation(); renderPos();');
  const apresPoll = etatDe(run);
  ok(ouvert.prixVu === 'htva' && bascule.prixVu === 'tvac' && refait.prixVu === 'tvac' && refait.ecran === 'tvac' && apresPoll.prixVu === 'tvac',
    '[C4] le choix du comptoir tient : un etat d edition refait et le poll le gardent', { ouvert, bascule, refait, apresPoll });
  run("ouvrirOngletFiche('details'); hydrateSelectedReservation(); ouvrirOngletFiche('modifier');");
  const infos = etatDe(run);
  ok(infos.prixVu === 'tvac' && infos.ecran === 'tvac', '[C4] le choix du comptoir tient : Modifier rouvert depuis Infos', infos);
  bac.staffCenterConfigCache = { centers: [{ id: 'libramont', vatRates: { ...TAUX, drinks: 6 }, htvaParDefaut: 'toutes' }] };
  run(`state.editState = etatEditionDepuis(findStaffReservationById(${TB}));`);
  const reglageChange = etatDe(run);
  ok(reglageChange.prixVu === 'tvac' && reglageChange.ecran === 'tvac', '[C4] le choix du comptoir tient : le reglage qui passe a « Toutes les réservations » ne le defait pas', reglageChange);

  // Un calcul fait sur un autre dossier (preparerCompte bati un etat d edition le temps d un calcul).
  bac.staffCenterConfigCache = { centers: [] };
  run("basculerTvaEdition('htva')");
  const autre = run(`etatEditionDepuis(findStaffReservationById(${N})).prixVu`);
  run(`state.editState = etatEditionDepuis(findStaffReservationById(${TB}));`);
  const fiche = etatDe(run);
  ok(autre === 'tvac' && fiche.prixVu === 'htva', '[C4] un calcul fait sur un autre dossier ne prend pas le choix de la fiche, et ne le change pas', { autre, fiche });

  // Fermee : la fiche oublie son choix ; rouverte, elle repart du reglage.
  run("basculerTvaEdition('tvac'); closePos();");
  const memoire = run('prixVuDeLaFiche');
  ok(memoire === null, '[C4] fermer la fiche oublie son choix', memoire);
  run(`openPos(${TB}); ouvrirOngletFiche('modifier');`);
  ok(etatDe(run).prixVu === 'htva', '[C4] fermee puis rouverte, la fiche repart du reglage', etatDe(run));
  // Rouverte sans etre fermee, par chacune de ses portes : elle repart du reglage.
  run(`basculerTvaEdition('tvac'); openPos(${TB}); ouvrirOngletFiche('modifier');`);
  ok(etatDe(run).prixVu === 'htva', '[C4] rouverte par le planning (openPos), la fiche repart du reglage', etatDe(run));
  run(`basculerTvaEdition('tvac'); openStaffReservationDetail(${TB}); ouvrirOngletFiche('modifier');`);
  ok(etatDe(run).prixVu === 'htva', '[C4] rouverte par une liste (openStaffReservationDetail), la fiche repart du reglage', etatDe(run));
  run(`basculerTvaEdition('tvac'); editRes(${TB});`);
  ok(etatDe(run).prixVu === 'htva', '[C4] ouverte droit dans Modifier (editRes), la fiche repart du reglage', etatDe(run));

  // Sans geste du comptoir, la decision de l ouverture tient : le reglage passe a « Jamais » apres l ouverture.
  poserLeJour(bac, { reglage: 'groupes' });
  const aLOuverture = ouvrir(run, TB);
  bac.staffCenterConfigCache = { centers: [{ id: 'libramont', vatRates: { ...TAUX, food: 6 }, htvaParDefaut: 'jamais' }] };
  run(`state.editState = etatEditionDepuis(findStaffReservationById(${TB})); renderPos();`);
  const ensuite = etatDe(run);
  ok(aLOuverture.prixVu === 'htva' && ensuite.prixVu === 'htva' && ensuite.ecran === 'htva', '[C4] ce qui arrive apres l ouverture ne change pas la fiche : le reglage passe a « Jamais »', { aLOuverture, ensuite });
  poserLeJour(bac, { reglage: 'groupes' });
  run(`closePos(); editRes(${TB});`);
  const direct = etatDe(run);
  bac.state.staffHtvaParDefaut = 'jamais';
  run(`state.editState = etatEditionDepuis(findStaffReservationById(${TB}));`);
  ok(direct.prixVu === 'htva' && etatDe(run).prixVu === 'htva', '[C4] ouverte droit dans Modifier (editRes), la decision de l ouverture tient', { direct, ensuite: etatDe(run) });
}

// ---------------------------------------------------------------------------
// [C5] ETABLISSEMENT
// ---------------------------------------------------------------------------
const sansBalises = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function boutonsDe(html) {
  return [...String(html || '').matchAll(/<button type="button" role="radio" class="eb-seg-btn( is-on)?" aria-checked="(true|false)" data-eb-v="([a-z]+)" onclick="ebPick\('estab-tva-ouverture','[a-z]+'\)">([^<]*)<\/button>/g)]
    .map((m) => ({ valeur: m[3], mot: m[4], choisi: Boolean(m[1]) && m[2] === 'true' }));
}
const choisiDans = (html) => boutonsDe(html).filter((b) => b.choisi).map((b) => b.valeur).join(',');

async function scenarioC5() {
  console.log('\n[C5] Etablissement : « Prix hors TVA à l’ouverture »');
  const C = laConsoleEnVm();
  if (!C) return;
  const { app, bac, run } = C;
  const rubrique = (center) => run(`ebTvaHtml(${JSON.stringify(center)})`) || '';
  const page = rubrique({ vatRates: TAUX, htvaParDefaut: 'groupes' });
  const boutons = boutonsDe(page);
  ok(egal(boutons.map((b) => [b.valeur, b.mot]), [['jamais', 'Jamais'], ['toutes', 'Toutes les réservations'], ['groupes', 'Les groupes seulement']]) && choisiDans(page) === 'groupes'
    && /<select id="estab-tva-ouverture" hidden><option value="jamais" >Jamais<\/option><option value="toutes" >Toutes les réservations<\/option><option value="groupes" selected>Les groupes seulement<\/option><\/select>/.test(page),
  '[C5] la rubrique TVA montre le reglage enregistre et ses trois choix', boutons);
  const sansCle = choisiDans(rubrique({ vatRates: TAUX }));
  const illisible = choisiDans(rubrique({ vatRates: TAUX, htvaParDefaut: 'partout' }));
  ok(sansCle === 'jamais' && illisible === 'jamais', '[C5] un centre sans reglage, ou un reglage illisible, se montre « Jamais »', { sansCle, illisible });
  const texte = sansBalises(page);
  ok(texte.includes('Prix hors TVA à l’ouverture') && texte.includes('Dans Modifier, TVAC et HTVA se changent toujours à la main.') && !/\b(nous|notre|nos)\b/i.test(texte),
    '[C5] des mots simples, sans « nous » : la ligne dit ce qui change et que le comptoir garde la main', texte.slice(texte.indexOf('Prix hors TVA')));
  bac.__elements['estab-tva-ouverture'] = { value: 'toutes' };
  const part = run('collectEstablishmentHtvaParDefaut()');
  delete bac.__elements['estab-tva-ouverture'];
  const absent = run('collectEstablishmentHtvaParDefaut() === undefined');
  ok(part === 'toutes' && absent === true, '[C5] le choix part avec la fiche du centre ; une page qui ne l a pas montre ne l envoie pas', { part, absent });
  const submit = fonctionSource(app, 'submitCenterConfig') || '';
  ok(/\n {4}htvaParDefaut: collectEstablishmentHtvaParDefaut\(\),\n/.test(submit), '[C5] submitCenterConfig envoie le choix avec la fiche (lu dans le source)', submit ? 'ligne absente' : 'submitCenterConfig introuvable');
  const dit = run("ebDireUnChangement('estab-tva-ouverture', 'groupes', 'jamais')");
  ok(dit === 'Prix hors TVA à l’ouverture : les groupes seulement', '[C5] la barre dit le changement en mots', dit);
}

// ---------------------------------------------------------------------------
const SCENARIOS = { S1: scenarioS1, C1: scenarioC1, C2: scenarioC2, C3: scenarioC3, C4: scenarioC4, C5: scenarioC5 };
const LETTRES = { S: ['S1'], C: ['C1', 'C2', 'C3', 'C4', 'C5'] };

function verifierLesAncres() {
  let mortes = 0;
  for (const m of MUTATIONS) {
    const n = verifierAncre(m);
    if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom} trouvee ${n} fois : ${m.de.slice(0, 80)}`); }
  }
  MUTATIONS.filter((m, i) => MUTATIONS.findIndex((x) => x.nom === m.nom) !== i).forEach((m) => { mortes += 1; console.log(`FAIL  contre-preuve ${m.nom} nommee deux fois`); });
  console.log(`tva-ouverture-check --ancres : ${MUTATIONS.length - mortes}/${MUTATIONS.length} uniques`);
  return mortes;
}

function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  // Chaque case de la grille [C1] est la cible d au moins une contre-preuve.
  const visees = new Set(MUTATIONS.flatMap((m) => m.cibles));
  const orphelines = [...CASES_C1, ...Object.values(BORD)].filter((c) => !visees.has(c));
  const couverture = ok(orphelines.length === 0, 'chaque case de la grille [C1] est la cible d au moins une contre-preuve', orphelines);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS;
  if (voulues && liste.length !== voulues.length) { console.error(`tva-ouverture-check : contre-preuve inconnue dans ${voulues.join(',')}`); process.exit(2); }
  let mordent = 0;
  for (const m of liste) {
    const run = spawnSync(process.execPath, [__filename, `--seul=${LETTRES[m.lettre].join(',')}`], {
      cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, TVA_OUVERTURE_CASSE: m.nom },
    });
    const sortie = `${run.stdout || ''}${run.stderr || ''}`;
    if (run.status === 2) { console.log(`FAIL  contre-preuve ${m.nom} DESARMEE : ${sortie.trim().split('\n').pop()}`); continue; }
    const rouges = sortie.split('\n').filter((l) => l.startsWith('FAIL'));
    const restees = m.cibles.filter((c) => !rouges.some((l) => l.startsWith(`FAIL  ${c}`)));
    if (!restees.length) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : ${m.cibles.length} cible(s) rougissent`); continue; }
    console.log(`FAIL  contre-preuve ${m.nom} : reste vert : ${restees.join(' | ')}${run.status === null ? ` (fils interrompu : ${run.signal || run.error})` : ''}`);
  }
  console.log(`tva-ouverture-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length && couverture ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const inconnues = seul.filter((nom) => !SCENARIOS[nom]);
  if (inconnues.length) { console.error(`tva-ouverture-check : lettre inconnue ${inconnues.join(', ')}`); process.exit(2); }
  for (const nom of seul) await SCENARIOS[nom](); // eslint-disable-line no-await-in-loop
  console.log(`\ntva-ouverture-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('tva-ouverture-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

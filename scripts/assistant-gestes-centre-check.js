'use strict';
// LES GESTES DE L ETABLISSEMENT ET DU CATALOGUE (lot 2 de « tout faire », 2026-11-11, Ansar : « il doit
// vraiment être capable de TOUT FAIRE »). lib/assistant-gestes-centre.js prepare en carte les horaires, les
// jours a part, les fermetures, les regles de la reservation en ligne, le statut, le nom et les coordonnees
// du centre, le formulaire de son site, ses prix (grilles, activites, cartes, supplements, suggestions) et
// ses formules ; api/ops.js (assistantGeste) les refait au clic. Ce gate tient, sans base ni reseau
// (lectures et ecritures doublees, rien ne part) :
//   G. la carte : le contrat de chaque geste (le droit que le serveur exige, les mots qui font naitre un
//      geste risque, jamais l equipe ni la plateforme), avant et apres, ce qui atteint les clients, les
//      refus avec leur raison (nom inconnu, hors bornes, deja dans cet etat, sans le droit Tarifs) ; chaque
//      geste risque se refuse sans les mots de la personne, meme devant « merci beaucoup » ou « bonsoir » ;
//   S. le clic : l action normale du logiciel ecrit le corps refait par le serveur. Les vraies sauvegardes
//      de lib/center-config.js tournent sur une fausse piscine (fusion, remplacement en bloc, statut de
//      colonne, normalisation stricte) : la configuration ne part que par la cle changee, un tableau part
//      entier, l etat se relit au clic, et un Manager (role non verrouille) n ecrit rien.
// Lancement : node scripts/assistant-gestes-centre-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const GESTES = 'lib/assistant-gestes.js';
const CENTRE = 'lib/assistant-gestes-centre.js';
const OPS = 'api/ops.js';

// Chaque garde retiree en memoire (le disque n est jamais touche) doit rougir sa ligne.
const MUTATIONS = [
  { nom: 'horaires-sans-risque', rouge: '[G] un horaire de la semaine ne nait que des mots de la personne', editions: [{ fichier: CENTRE, de: "action: 'saveCenterConfig', permission: 'settings.manage', risque: true, demande: DEMANDE_HORAIRES,", vers: "action: 'saveCenterConfig', permission: 'settings.manage', risque: false, demande: DEMANDE_HORAIRES," }] },
  { nom: 'seuil-sans-les-mots', rouge: '[G] chaque geste risque se refuse sans les mots de la personne, et nait avec eux', editions: [{ fichier: CENTRE, de: 'const DEMANDE_SEUIL = /', vers: 'const DEMANDE_SEUIL = /.|' }] },
  { nom: 'beaucoup-ferme', rouge: '[G] chaque geste risque se refuse sans les mots de la personne, et nait avec eux', editions: [{ fichier: CENTRE, de: 'const DEMANDE_FERMETURE = /', vers: 'const DEMANDE_FERMETURE = /coup|' }] },
  { nom: 'config-entiere', rouge: '[S] un horaire part seul dans la configuration, le reste du centre intact', editions: [{ fichier: CENTRE, de: '          corps: { config: { defaultSchedule: { [bloc]: semaine } } },', vers: '          corps: { config: { ...r.config, defaultSchedule: { [bloc]: semaine } } },' }] },
  { nom: 'apres-minuit-oublie', rouge: '[G] une fermeture apres minuit s ecrit au lendemain', editions: [{ fichier: CENTRE, de: '    if (enMinutes(close) <= enMinutes(open) && enMinutes(close) <= 360) close = enHeure(enMinutes(close) + 1440);', vers: '' }] },
  { nom: 'jour-a-part-compte-dehors', rouge: '[G] des horaires qui laissent des reservations dehors le disent', editions: [{ fichier: CENTRE, de: ' === vacances && !ouvertureExceptionnelle(x.date, r.config));', vers: ' === vacances);' }] },
  { nom: 'fermeture-sans-reservations', rouge: '[G] une fermeture dit les reservations deja prises', editions: [{ fichier: CENTRE, de: '.filter((x) => (corps.recurrence === \'once\' ? x.date === corps.date : jourDe(x.date) === corps.dayOfWeek) && dossierTouche(x, bloc)) : [];', vers: '.filter(() => false) : [];' }] },
  { nom: 'grille-a-zero', rouge: '[G] une case de grille hors bornes, inconnue ou a 0 euro se refuse', editions: [{ fichier: CENTRE, de: "        if (!(prix > 0)) throw erreur('Un prix de grille est de plus de 0 € : une case à 0 € serait refusée au client.');", vers: '' }] },
  { nom: 'activite-sans-tarifs', rouge: '[G] le prix d une activite demande aussi le droit Tarifs', editions: [{ fichier: CENTRE, de: "        exigerTarifs(ctx, 'le prix d’une activité');", vers: '' }] },
  { nom: 'suggestions-sans-tarifs', rouge: '[G] les suggestions demandent aussi le droit Tarifs', editions: [{ fichier: CENTRE, de: "        exigerTarifs(ctx, 'les remises des suggestions');", vers: '' }] },
  { nom: 'statut-deux-fois', rouge: '[G] le statut du centre avertit des reservations a venir et se refuse s il ne change pas', editions: [{ fichier: CENTRE, de: '        if (statut === r.statut) throw erreur(`Le centre est déjà ${STATUTS[statut]}.`);', vers: '' }] },
  { nom: 'renommer-ouvre-le-centre', rouge: '[S] renommer garde le statut et le fuseau du centre', editions: [{ fichier: CENTRE, de: '          corps: { center: { id: r.id, name: nom, status: r.statut, timezone: r.fuseau } },', vers: '          corps: { center: { id: r.id, name: nom } },' }] },
  { nom: 'secours-sans-les-mots', rouge: '[G] une adresse de secours ne nait que des mots de la personne', editions: [{ fichier: CENTRE, de: "          if (dits.length && !dits.some((t) => t.includes(a))) throw erreur('Cette adresse doit être écrite par la personne elle-même dans son message.', 403);", vers: '' }] },
  { nom: 'supplements-un-seul', rouge: '[S] la boite de secours, les supplements et les suggestions repartent entiers, seul le change bouge', editions: [{ fichier: CENTRE, de: '          corps: { surMesure: suite },', vers: '          corps: { surMesure: { ...suite, articles: [a] } },' }] },
  { nom: 'manager-agit', rouge: '[S] un Manager (role non verrouille) ne fait aucun geste du centre (403)', editions: [{ fichier: OPS, de: "    if (!agitAvecLAssistant(options.session)) throw createHttpError('Seules la Direction et le propriétaire font agir l’assistant.', 403, true);\n    const G = require('../lib/assistant-gestes');", vers: "    const G = require('../lib/assistant-gestes');" }] },
];

// ── Les mutations, appliquees au chargement des fichiers vises ──
function armer(editions) {
  const parFichier = new Map();
  editions.forEach((e) => {
    const cible = path.normalize(path.join(ROOT, e.fichier));
    if (!parFichier.has(cible)) parFichier.set(cible, []);
    parFichier.get(cible).push(e);
  });
  const origine = Module._extensions['.js'];
  Module._extensions['.js'] = function charger(m, f) {
    const liste = parFichier.get(path.normalize(f));
    if (!liste) { origine(m, f); return; }
    let texte = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    liste.forEach((e) => {
      if (texte.split(e.de).length !== 2) throw new Error(`ancre introuvable ou multiple : ${e.de.slice(0, 80)}`);
      texte = texte.split(e.de).join(e.vers);
    });
    m._compile(texte, f);
  };
  return () => { Module._extensions['.js'] = origine; };
}

function purger() {
  Object.keys(require.cache).forEach((k) => {
    const rel = path.relative(ROOT, k);
    if (!rel.startsWith('..') && /^(lib|api)[\\/]/.test(rel)) delete require.cache[k];
  });
}

function remplacer(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
  return reel;
}

async function appeler(handler, corps, entetes = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(corps))]);
  req.method = 'POST';
  req.url = '/api/ops';
  req.headers = { host: 'localhost', 'content-type': 'application/json', ...entetes };
  const res = {
    statusCode: 200, entetes: {}, corps: '', headersSent: false, writableEnded: false,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    getHeader(k) { return this.entetes[k.toLowerCase()]; },
    writeHead(s) { this.statusCode = s; return this; },
    end(b) { this.corps = String(b || ''); this.headersSent = true; this.writableEnded = true; },
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corps); } catch (e) { json = null; }
  return { statut: res.statusCode, json: json || {} };
}

function plusJours(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Le centre du banc ──
const DIRECTION = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'm-dir', name: 'Seb' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: [] };
const MANAGER = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'm-man', name: 'Marius' }, role: { id: 'manager', name: 'Manager', locked: false }, permissions: ['pricing.manage', 'settings.manage', 'reservations.create', 'emails.send', 'emails.view', 'campaigns.manage'] };
const REGLAGES_SEULS = { ...MANAGER, permissions: ['settings.manage'] };
const AUJOURDHUI = '2026-11-11';
// Ce que la personne a ecrit, pour les cartes qui ne testent pas ses mots : un mot de chaque domaine.
const MOTS = 'Change les horaires, ferme, coupe, mets le prix, retire, remise, adresse, nom, statut, vacances, délai, seuil, formule, site, carte, supplément, secours, comptoir';

// La configuration du centre telle que la base la garde (le fichier socle de Libramont dessous).
function brutDuBanc() {
  return {
    offerAvailability: { 'f-team': false },
    ouverturesExceptionnelles: [{ date: '2026-11-21', open: '10:00', close: '24:00', motif: 'groupe de 40' }, { date: '2026-11-28', open: '08:00', close: '22:00', motif: 'tournoi' }],
    upsellOffers: { enabled: true, offers: [{ id: 'laser-plus', enabled: true, activityId: 'laser_game', kind: 'laser_upgrade', title: 'Une partie de laser en plus', minParticipants: 1, maxParticipants: 240, options: { games: 1 }, discount: { mode: 'percent', value: 10 }, image: null }] },
    secours: { emails: ['direction@fungalaxy.be'] },
  };
}

function banc(CC) {
  const brut = brutDuBanc();
  return {
    reglages: { id: 'libramont', nom: 'Fun Galaxy Libramont', statut: 'active', fuseau: 'Europe/Brussels', config: CC.normalizeCenterConfig(brut, 'libramont') },
    catalogue: [
      { id: 'f-anniv', name: 'Anniversaire', priceType: 'per_pax', base: { priceValue: 18.5 }, effective: { name: 'Anniversaire', priceValue: 18.5, enabled: true, removed: false }, centerOverride: null },
      { id: 'f-team', name: 'Team building', priceType: 'per_pax', base: { priceValue: 30 }, effective: { name: 'Team building', priceValue: 32, enabled: false, removed: false }, centerOverride: { enabled: false } },
      { id: 'sm-libramont--soiree-pirate', name: 'Soirée pirate', priceType: 'per_pax', base: { priceValue: 25, humanValidation: 'comptoir' }, effective: { name: 'Soirée pirate', priceValue: 25, enabled: true, removed: false, humanValidation: 'comptoir' }, centerOverride: null },
    ],
    activites: [
      { id: 'bowling', name: 'Bowling', priceType: 'grid_bowling', priceValue: null, priceUnit: null },
      { id: 'minigolf_blacklight', name: 'Minigolf', priceType: 'per_pax', priceValue: 9, priceUnit: 'par personne' },
      { id: 'kara_box', name: 'Kara Box', priceType: 'on_site', priceValue: null, priceUnit: null },
    ],
    vendues: [{ id: 'laser_game', name: 'Laser Game' }, { id: 'minigolf_blacklight', name: 'Minigolf' }],
    fermetures: [
      { id: 7, scopeType: 'center', scopeRef: null, recurrence: 'once', date: '2026-12-25', dayOfWeek: null, dateFrom: null, dateUntil: null, startMin: null, endMin: null, reason: 'Noël' },
      { id: 8, scopeType: 'lane', scopeRef: '3', recurrence: 'weekly', date: null, dayOfWeek: 1, dateFrom: null, dateUntil: null, startMin: 1080, endMin: 1440, reason: 'entretien' },
    ],
    reservations: [
      { id: 101, date: '2026-11-14', startTime: '22:30', duration: 1.5, totalDuration: 1.5, status: 'confirmed', validationStatus: 'confirmed', pax: 6, lanes: [3], program: { items: [{ activityId: 'bowling' }] }, name: 'Groupe Dupont' },
      { id: 102, date: '2026-11-18', startTime: '20:30', duration: 1, totalDuration: 1, status: 'confirmed', validationStatus: 'confirmed', pax: 8, lanes: [], program: { items: [{ activityId: 'laser_game' }] }, name: 'Groupe Martin' },
      { id: 103, date: '2026-11-28', startTime: '08:30', duration: 1, totalDuration: 1, status: 'confirmed', validationStatus: 'confirmed', pax: 10, lanes: [1, 2], program: { items: [{ activityId: 'bowling' }] }, name: 'Tournoi Leroy' },
    ],
  };
}

function lecteursDu(b) {
  return {
    centreReglages: async () => b.reglages,
    centreAujourdhui: async () => AUJOURDHUI,
    centreReservations: async (centre, debut, fin) => b.reservations.filter((r) => r.date >= debut && r.date <= fin),
    centreFermetures: async () => b.fermetures,
    centreActivites: async () => b.activites,
    centreActivitesVendues: async () => b.vendues,
    catalogue: async () => b.catalogue,
  };
}

async function verifier(editions = []) {
  const echecs = [];
  const ok = (cond, nom, detail = '') => {
    if (!cond) echecs.push(nom);
    if (!editions.length) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || !detail ? '' : `  ${String(detail).slice(0, 300)}`}`);
  };
  purger();
  const restaurer = armer(editions);
  try {
    // ── G. LA CARTE ──
    if (!editions.length) console.log('\n[G] la carte : lue, validee, avec ce que voient les clients');
    const G = require(path.join(ROOT, GESTES));
    const CC = require(path.join(ROOT, 'lib/center-config.js'));
    const ops = require(path.join(ROOT, OPS));
    const lot = require(path.join(ROOT, CENTRE)).gestes(G.AIDES);
    const noms = Object.keys(lot);
    const droitsFaux = noms.filter((n) => !memes(ops.getRequiredOpsPermission('POST', lot[n].action), lot[n].permission));
    ok(noms.length >= 20 && noms.every((n) => G.GESTES[n]) && !droitsFaux.length, '[G] chaque geste a le droit que le serveur exige pour son action', `${noms.length} gestes, droits faux : ${droitsFaux.join(', ')}`);
    const sansMots = noms.filter((n) => lot[n].risque === true && !(lot[n].demande instanceof RegExp));
    const horsCentre = noms.filter((n) => { const d = [].concat(ops.getRequiredOpsPermission('POST', lot[n].action)); return d.includes('platform.admin') || d.includes('users.manage') || d.includes('security.codes'); });
    ok(!sansMots.length && !horsCentre.length && noms.every((n) => lot[n].titre && lot[n].verbe && lot[n].cours && lot[n].quoi && lot[n].parametres && typeof lot[n].preparer === 'function'), '[G] un geste risque a les mots qui le font naitre, et aucun ne touche a l equipe ni a la plateforme', JSON.stringify({ sansMots, horsCentre }));
    const tiret = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    const tirets = [CENTRE, 'scripts/assistant-gestes-centre-check.js'].filter((f) => tiret.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    ok(!tirets.length, '[G] aucun tiret long ni moyen dans le lot', tirets.join(', '));

    const b = banc(CC);
    const carte = (geste, params, { session = DIRECTION, mots = [MOTS], bench = b } = {}) => G.proposer(geste, params, G.contexte({ centre: 'libramont', session, messagesPersonne: mots, lecteurs: lecteursDu(bench) })).then((p) => ({ p }), (e) => ({ e }));
    const ligne = (c, libelle) => (c.p ? c.p.resume.lignes.find((l) => l.libelle === libelle) : null) || {};
    const voir = (c) => JSON.stringify(c.p ? { texte: c.p.texte, resume: c.p.resume, params: c.p.action.params } : (c.e && c.e.message)).slice(0, 400);
    const refaire = (geste, params, bench = b) => G.refaire(geste, params, G.contexte({ centre: 'libramont', session: DIRECTION, lecteurs: lecteursDu(bench) })).then((r) => ({ r }), (e) => ({ e }));

    // Chaque geste risque, avec des parametres justes : sans les mots de la personne il se refuse (403),
    // avec eux sa carte nait. Un geste risque sans ligne ici rougit aussi.
    const VALIDES = {
      horaires_de_la_semaine: { jour: 'samedi', ouverture: '10:00', fermeture: '20:00' },
      forcer_jour_vacances_ou_normal: { date: '2026-11-18', mode: 'vacances' },
      vacances_automatiques: { actif: 'non' },
      regler_reservation_en_ligne: { delai_jours: 2 },
      fermeture_programmee: { date: '2026-11-14' },
      supprimer_fermeture: { fermeture: '2026-12-25' },
      retirer_horaires_du_jour: { date: '2026-11-21' },
      regler_seuil_demande_sur_mesure: { a_partir_de: 25 },
      changer_statut_centre: { statut: 'prévu' },
      renommer_centre: { nom: 'Fun Galaxy Ardenne' },
      coordonnees_du_centre: { telephone: '061 22 33 44' },
      couper_ou_remettre_formulaire_site: { actif: 'non' },
      boite_de_secours: { ajouter: 'equipe@fungalaxy.be' },
      modifier_grilles_prix_centre: { grille: 'bowling', case: '1 heure', prix: 42 },
      modifier_prix_activite: { activite: 'Minigolf', prix: 10 },
      afficher_masquer_formule_formulaire: { formule: 'Anniversaire', proposee: 'non' },
      retirer_formule: { formule: 'Anniversaire' },
      formule_du_comptoir_en_ligne: { formule: 'Soirée pirate', en_ligne: 'oui' },
      retirer_formule_du_comptoir: { formule: 'pirate' },
      modifier_offres_suggestions: { offre: 'laser', remise: '5 € par personne' },
      modifier_cartes_arcade: { carte: '30 minutes', prix: 16 },
      modifier_catalogue_supplements: { article: 'Orval', prix: 6 },
    };
    const risques = noms.filter((n) => lot[n].risque);
    const sansLigne = risques.filter((n) => !VALIDES[n]);
    const passeSansMots = [];
    const refuseAvecMots = [];
    for (const n of risques.filter((x) => VALIDES[x])) {
      // eslint-disable-next-line no-await-in-loop
      // Des mots de tous les jours qui contiennent ceux d un geste (beau-coup, bon-soir, vend-redi, vi-site...).
      const muet = await carte(n, VALIDES[n], { mots: ['Bonsoir, merci beaucoup', 'Le client a appelé pour une visite vendredi : quelle activité marche le mieux ?'] });
      if (!(muet.e && muet.e.statusCode === 403)) passeSansMots.push(`${n} ${muet.e ? muet.e.message : 'carte'}`);
      // eslint-disable-next-line no-await-in-loop
      const dit = await carte(n, VALIDES[n], { mots: [`${MOTS}, equipe@fungalaxy.be`] });
      if (!dit.p) refuseAvecMots.push(`${n} ${dit.e && dit.e.message}`);
    }
    ok(risques.length >= 20 && !sansLigne.length && !passeSansMots.length && !refuseAvecMots.length, '[G] chaque geste risque se refuse sans les mots de la personne, et nait avec eux', JSON.stringify({ sansLigne, passeSansMots, refuseAvecMots }));

    // Les horaires de la semaine
    const samedi = await carte('horaires_de_la_semaine', { jour: 'samedi', ouverture: '10:00', fermeture: '01:00' }, { mots: ['Le samedi on ferme à 1 h du matin maintenant'] });
    const regular = b.reglages.config.defaultSchedule.regular;
    const corpsSamedi = samedi.p ? (await refaire('horaires_de_la_semaine', samedi.p.action.params)).r : null;
    ok(samedi.p && samedi.p.risque === true && ligne(samedi, 'Horaires').avant === '10:00 à minuit' && ligne(samedi, 'Horaires').apres === '10:00 à 01:00 le lendemain' && /le samedi/.test(samedi.p.resume.clients)
      && corpsSamedi && corpsSamedi.action === 'saveCenterConfig' && memes(Object.keys(corpsSamedi.corps.config), ['defaultSchedule']) && memes(Object.keys(corpsSamedi.corps.config.defaultSchedule), ['regular'])
      && ['0', '1', '2', '3', '4', '5'].every((j) => memes(corpsSamedi.corps.config.defaultSchedule.regular[j], regular[j])),
    '[G] un horaire de la semaine se lit avant et apres, et seul ce jour change', `${voir(samedi)} ${JSON.stringify(corpsSamedi && corpsSamedi.corps)}`);
    ok(corpsSamedi && memes(corpsSamedi.corps.config.defaultSchedule.regular['6'], { open: '10:00', close: '25:00' }), '[G] une fermeture apres minuit s ecrit au lendemain', JSON.stringify(corpsSamedi && corpsSamedi.corps));
    const plusTot = await carte('horaires_de_la_semaine', { jour: 'samedi', ouverture: '10:00', fermeture: '22:00' }, { mots: ['Le samedi on ferme à 22 h'] });
    // Le 28/11 a ses horaires a part (08:00, tournoi) : son dossier de 08:30 n est pas dehors.
    ok(plusTot.p && /1 réservation à venir tombe/.test(plusTot.p.resume.alerte || '') && /14\/11 à 22:30/.test(plusTot.p.resume.alerte || '') && !/28\/11/.test(plusTot.p.resume.alerte || ''), '[G] des horaires qui laissent des reservations dehors le disent', JSON.stringify(plusTot.p ? plusTot.p.resume.alerte : plusTot.e && plusTot.e.message));
    const pareil = await carte('horaires_de_la_semaine', { jour: 'samedi', ouverture: '10h', fermeture: 'minuit' });
    const jourFaux = await carte('horaires_de_la_semaine', { jour: 'jeudredi', ouverture: '10:00', fermeture: '20:00' });
    const envers = await carte('horaires_de_la_semaine', { jour: 'mardi', ouverture: '22:00', fermeture: '10:00' });
    ok(pareil.e && /déjà ouvert/.test(pareil.e.message) && jourFaux.e && /Dites le jour/.test(jourFaux.e.message) && envers.e && /après l’ouverture/.test(envers.e.message), '[G] un horaire inchange, un jour inconnu ou des heures a l envers se refusent', JSON.stringify([pareil.e && pareil.e.message, jourFaux.e && jourFaux.e.message, envers.e && envers.e.message]));
    const sansLesMots = await carte('horaires_de_la_semaine', { jour: 'samedi', ouverture: '10:00', fermeture: '20:00' }, { mots: ['Bonjour', 'Merci beaucoup'] });
    ok(sansLesMots.e && sansLesMots.e.statusCode === 403, '[G] un horaire de la semaine ne nait que des mots de la personne', voir(sansLesMots));
    const gembloux = { ...b, reglages: { ...b.reglages, config: CC.normalizeCenterConfig({}, 'gembloux') } };
    const devine = await carte('horaires_de_la_semaine', { jour: 'lundi', ouverture: '10:00', fermeture: '20:00' }, { bench: gembloux });
    ok(devine.e && /pas posés pour toute la semaine/.test(devine.e.message), '[G] une semaine qui n est pas posee ne se devine pas', voir(devine));

    // Les jours a part et les vacances automatiques
    const mercredi = await carte('forcer_jour_vacances_ou_normal', { date: '2026-11-18', mode: 'vacances' });
    const corpsMercredi = mercredi.p ? (await refaire('forcer_jour_vacances_ou_normal', mercredi.p.action.params)).r : null;
    ok(mercredi.p && ligne(mercredi, 'Ce jour-là').avant === 'selon le calendrier : horaires normaux' && ligne(mercredi, 'Ce jour-là').apres === 'forcé aux horaires de vacances' && ligne(mercredi, 'Horaires').avant === '12h - 22h' && ligne(mercredi, 'Horaires').apres === '10h - 22h'
      && corpsMercredi && memes(corpsMercredi.corps, { config: { holidaySettings: { overrides: [{ date: '2026-11-18', mode: 'holiday' }] } } }),
    '[G] un jour force aux vacances se lit avec ses horaires', `${voir(mercredi)} ${JSON.stringify(corpsMercredi && corpsMercredi.corps)}`);
    const dejaCalendrier = await carte('forcer_jour_vacances_ou_normal', { date: '2026-11-18', mode: 'calendrier' });
    const passe = await carte('forcer_jour_vacances_ou_normal', { date: '2026-11-01', mode: 'vacances' });
    const impossible = await carte('forcer_jour_vacances_ou_normal', { date: '2026-02-31', mode: 'vacances' });
    ok(dejaCalendrier.e && /suit déjà le calendrier/.test(dejaCalendrier.e.message) && passe.e && /passée/.test(passe.e.message) && impossible.e && /qui existe/.test(impossible.e.message), '[G] un jour deja dans ce mode, passe ou impossible se refuse', JSON.stringify([dejaCalendrier.e && dejaCalendrier.e.message, passe.e && passe.e.message, impossible.e && impossible.e.message]));
    const auto = await carte('vacances_automatiques', { actif: 'non' });
    const coupees = { ...b, reglages: { ...b.reglages, config: CC.normalizeCenterConfig({ ...brutDuBanc(), holidaySettings: { enabled: false } }, 'libramont') } };
    const autoDeja = await carte('vacances_automatiques', { actif: 'non' }, { bench: coupees });
    ok(auto.p && auto.p.risque && memes((await refaire('vacances_automatiques', auto.p.action.params)).r.corps, { config: { holidaySettings: { enabled: false } } }) && autoDeja.e && /déjà coupé/.test(autoDeja.e.message), '[G] les vacances automatiques se coupent, et deja coupees se refusent', `${voir(auto)} ${voir(autoDeja)}`);

    // Les regles de la reservation en ligne
    const delai = await carte('regler_reservation_en_ligne', { delai_jours: 2 });
    const horizonTrop = await carte('regler_reservation_en_ligne', { horizon_jours: 500 });
    const motAuLieu = await carte('regler_reservation_en_ligne', { delai_jours: 'beaucoup' });
    const croise = await carte('regler_reservation_en_ligne', { delai_jours: 30, horizon_jours: 20 });
    ok(delai.p && ligne(delai, 'Réserver au plus tard').avant === 'jusqu’au dernier moment' && ligne(delai, 'Réserver au plus tard').apres === '2 jours avant, au plus tard' && memes((await refaire('regler_reservation_en_ligne', delai.p.action.params)).r.corps, { config: { bookingRules: { minDaysAhead: 2, horizonDays: null } } })
      && horizonTrop.e && /entre 1 et 365/.test(horizonTrop.e.message) && motAuLieu.e && /nombre/.test(motAuLieu.e.message) && croise.e && /plus court/.test(croise.e.message),
    '[G] les regles de la reservation en ligne se lisent et restent dans leurs bornes', JSON.stringify([voir(delai), horizonTrop.e && horizonTrop.e.message, motAuLieu.e && motAuLieu.e.message, croise.e && croise.e.message]));

    // Les fermetures
    const fermer = await carte('fermeture_programmee', { date: '2026-11-14', motif: 'Inventaire' });
    ok(fermer.p && fermer.p.risque && ligne(fermer, 'Déjà réservé').valeur === '1 réservation (14/11 à 22:30)' && /ne les annule pas/.test(fermer.p.resume.alerte || '') && ligne(fermer, 'Réservation en ligne').apres === 'fermée'
      && memes((await refaire('fermeture_programmee', fermer.p.action.params)).r.corps, { scopeType: 'center', recurrence: 'once', date: '2026-11-14', reason: 'Inventaire' }),
    '[G] une fermeture dit les reservations deja prises', voir(fermer));
    const pisteFausse = await carte('fermeture_programmee', { date: '2026-11-20', piste: 99 });
    const fermerPasse = await carte('fermeture_programmee', { date: '2026-11-01' });
    const dejaFerme = await carte('fermeture_programmee', { date: '2026-12-25' });
    const plage = await carte('fermeture_programmee', { du: '2026-12-01', au: '2026-12-10' });
    ok(pisteFausse.e && /entre 1 et 8/.test(pisteFausse.e.message) && fermerPasse.e && /passée/.test(fermerPasse.e.message) && dejaFerme.e && /déjà fermé/.test(dejaFerme.e.message) && plage.e && /une carte par jour/.test(plage.e.message), '[G] une fermeture refuse une piste qui n existe pas, une date passee, ce qui est deja ferme et une plage de jours', JSON.stringify([pisteFausse.e && pisteFausse.e.message, fermerPasse.e && fermerPasse.e.message, dejaFerme.e && dejaFerme.e.message, plage.e && plage.e.message]));
    const piscine = await carte('fermeture_programmee', { date: '2026-11-18', activite: 'Piscine' });
    const laser = await carte('fermeture_programmee', { date: '2026-11-18', activite: 'laser', debut: '18:00', fin: '22:00' });
    ok(piscine.e && /Laser Game/.test(piscine.e.message) && laser.p && ligne(laser, 'Déjà réservé').valeur === '1 réservation (18/11 à 20:30)'
      && memes((await refaire('fermeture_programmee', laser.p.action.params)).r.corps, { scopeType: 'activity', scopeRef: 'laser_game', recurrence: 'once', date: '2026-11-18', startTime: '18:00', endTime: '22:00' }),
    '[G] une fermeture d une activite se nomme par ce que le centre vend', `${piscine.e && piscine.e.message} ${voir(laser)}`);
    const chaqueMardi = await carte('fermeture_programmee', { chaque: 'mardi', debut: '18:00', fin: '24:00', motif: 'cours' });
    ok(chaqueMardi.p && ligne(chaqueMardi, 'Heures').valeur === 'de 18:00 à minuit' && memes((await refaire('fermeture_programmee', chaqueMardi.p.action.params)).r.corps, { scopeType: 'center', recurrence: 'weekly', dayOfWeek: 2, startTime: '18:00', endTime: '24:00', reason: 'cours' }), '[G] une fermeture de chaque semaine porte son jour et ses heures', voir(chaqueMardi));
    const rouvrir = await carte('supprimer_fermeture', { fermeture: '2026-12-25' });
    const rouvrirSansMots = await carte('supprimer_fermeture', { fermeture: '2026-12-25' }, { mots: ['Bonjour', 'Merci'] });
    const rouvrirInconnue = await carte('supprimer_fermeture', { fermeture: 'piscine' });
    ok(rouvrir.p && memes((await refaire('supprimer_fermeture', rouvrir.p.action.params)).r.corps, { id: 7 }) && /Noël/.test(ligne(rouvrir, 'Fermeture').valeur || '') && rouvrirSansMots.e && rouvrirSansMots.e.statusCode === 403 && rouvrirInconnue.e && /piste 3/.test(rouvrirInconnue.e.message), '[G] une fermeture se retire par sa date, et seulement sur les mots de la personne', JSON.stringify([voir(rouvrir), rouvrirSansMots.e && rouvrirSansMots.e.message, rouvrirInconnue.e && rouvrirInconnue.e.message]));

    // Les horaires a part d un jour
    const retirer = await carte('retirer_horaires_du_jour', { date: '2026-11-21' });
    const retirerGroupe = await carte('retirer_horaires_du_jour', { date: '2026-11-28' });
    const retirerRien = await carte('retirer_horaires_du_jour', { date: '2026-11-25' });
    const retirerSansForcer = await carte('retirer_horaires_du_jour', { date: '2026-11-21' }, { session: MANAGER });
    ok(retirer.p && ligne(retirer, 'Horaires de l’équipe').avant === '10:00 à minuit (groupe de 40)' && ligne(retirer, 'Horaires de l’équipe').apres === '10h - Minuit, les horaires habituels' && memes((await refaire('retirer_horaires_du_jour', retirer.p.action.params)).r.corps, { date: '2026-11-21', retirer: true })
      && retirerGroupe.e && retirerGroupe.e.statusCode === 409 && /08:30/.test(retirerGroupe.e.message) && retirerRien.e && /pas d’horaires à part/.test(retirerRien.e.message) && retirerSansForcer.e && retirerSansForcer.e.statusCode === 403,
    '[G] retirer les horaires d un jour rend les horaires habituels, et refuse comme le logiciel', JSON.stringify([voir(retirer), retirerGroupe.e && retirerGroupe.e.message, retirerRien.e && retirerRien.e.message, retirerSansForcer.e && retirerSansForcer.e.message]));

    // Le centre lui-meme
    const seuil = await carte('regler_seuil_demande_sur_mesure', { a_partir_de: 25 });
    const seuilBas = await carte('regler_seuil_demande_sur_mesure', { a_partir_de: 1 });
    ok(seuil.p && ligne(seuil, 'Demande sur mesure obligatoire').avant === 'dès 31 personnes' && ligne(seuil, 'Demande sur mesure obligatoire').apres === 'dès 25 personnes' && /25 personnes ou plus/.test(seuil.p.resume.clients) && seuilBas.e && /entre 2 et 240/.test(seuilBas.e.message), '[G] le seuil de la demande sur mesure se lit et reste dans ses bornes', `${voir(seuil)} ${seuilBas.e && seuilBas.e.message}`);
    const retard = await carte('regler_retard_accueil', { minutes: 10 }, { mots: ['Bonjour'] });
    const retardTrop = await carte('regler_retard_accueil', { minutes: 61 });
    ok(retard.p && retard.p.risque === false && memes((await refaire('regler_retard_accueil', retard.p.action.params)).r.corps, { config: { accueil: { lateThresholdMinutes: 10 } } }) && retardTrop.e && /entre 0 et 60/.test(retardTrop.e.message), '[G] le retard a l accueil se regle sans risque, dans ses bornes', `${voir(retard)} ${retardTrop.e && retardTrop.e.message}`);
    const prevu = await carte('changer_statut_centre', { statut: 'prévu' });
    const dejaOuvert = await carte('changer_statut_centre', { statut: 'ouvert' });
    ok(prevu.p && prevu.p.vue.danger === true && /3 réservations à venir restent prises/.test(prevu.p.resume.alerte || '') && ligne(prevu, 'Réservation en ligne').apres === 'coupée' && memes((await refaire('changer_statut_centre', prevu.p.action.params)).r.corps, { status: 'planned' }) && dejaOuvert.e && /déjà ouvert/.test(dejaOuvert.e.message), '[G] le statut du centre avertit des reservations a venir et se refuse s il ne change pas', `${voir(prevu)} ${dejaOuvert.e && dejaOuvert.e.message}`);
    const centrePrevu = { ...b, reglages: { ...b.reglages, statut: 'planned' } };
    const renommer = await carte('renommer_centre', { nom: 'Fun Galaxy Ardenne' }, { bench: centrePrevu });
    const memeNom = await carte('renommer_centre', { nom: 'Fun Galaxy Libramont' });
    const balise = await carte('renommer_centre', { nom: '<b>Fun</b>' });
    ok(renommer.p && memes((await refaire('renommer_centre', renommer.p.action.params, centrePrevu)).r.corps, { center: { id: 'libramont', name: 'Fun Galaxy Ardenne', status: 'planned', timezone: 'Europe/Brussels' } }) && memeNom.e && /déjà/.test(memeNom.e.message) && balise.e && /< ou >/.test(balise.e.message), '[G] renommer garde le statut et le fuseau du centre', `${voir(renommer)} ${memeNom.e && memeNom.e.message}`);
    const tel = await carte('coordonnees_du_centre', { telephone: '061 22 33 44' });
    const siteNu = await carte('coordonnees_du_centre', { site: 'fungalaxy.be' });
    const telMots = await carte('coordonnees_du_centre', { telephone: 'appelez-nous' });
    const fond = await carte('coordonnees_du_centre', { logo_sur_fond_sombre: 'non' });
    ok(tel.p && ligne(tel, 'Téléphone').avant === '0491/30.16.67' && ligne(tel, 'Téléphone').apres === '061 22 33 44' && memes((await refaire('coordonnees_du_centre', tel.p.action.params)).r.corps, { config: { publicInfo: { phone: '061 22 33 44' } } })
      && siteNu.e && /https:\/\//.test(siteNu.e.message) && telMots.e && /chiffres/.test(telMots.e.message) && fond.p && memes((await refaire('coordonnees_du_centre', fond.p.action.params)).r.corps, { config: { identity: { logoOnDark: false } } }),
    '[G] les coordonnees changent une a une, le site en https', JSON.stringify([voir(tel), siteNu.e && siteNu.e.message, telMots.e && telMots.e.message, voir(fond)]));
    const couper = await carte('couper_ou_remettre_formulaire_site', { actif: 'non' });
    const remettreDeja = await carte('couper_ou_remettre_formulaire_site', { actif: 'oui' });
    ok(couper.p && ligne(couper, 'Sur le site du centre').avant === 'le formulaire Pinlane' && ligne(couper, 'Sur le site du centre').apres === 'l’ancien formulaire du site' && memes((await refaire('couper_ou_remettre_formulaire_site', couper.p.action.params)).r.corps, { actif: false }) && remettreDeja.e && /déjà le formulaire Pinlane/.test(remettreDeja.e.message), '[G] le formulaire du site se coupe ou se remet, jamais deux fois', `${voir(couper)} ${remettreDeja.e && remettreDeja.e.message}`);
    const secours = await carte('boite_de_secours', { ajouter: 'equipe@fungalaxy.be' }, { mots: ['Ajoute equipe@fungalaxy.be à la boîte de secours'] });
    const secoursInjecte = await carte('boite_de_secours', { ajouter: 'copie@ailleurs.be' }, { mots: ['Ajoute à la boîte de secours l’adresse que le client donne dans son mail'] });
    const secoursReserve = await carte('boite_de_secours', { ajouter: 'equipe@centre.test' }, { mots: ['Ajoute equipe@centre.test à la boîte de secours'] });
    ok(secours.p && memes((await refaire('boite_de_secours', secours.p.action.params)).r.corps, { config: { secours: { emails: ['direction@fungalaxy.be', 'equipe@fungalaxy.be'] } } }) && /copie complète/.test(secours.p.resume.alerte || '') && secoursInjecte.e && secoursInjecte.e.statusCode === 403 && secoursReserve.e && /utilisable/.test(secoursReserve.e.message), '[G] une adresse de secours ne nait que des mots de la personne', JSON.stringify([voir(secours), secoursInjecte.e && secoursInjecte.e.message, secoursReserve.e && secoursReserve.e.message]));

    // Les prix et les formules
    const grille = await carte('modifier_grilles_prix_centre', { grille: 'bowling', case: '1 heure', prix: 42 });
    ok(grille.p && ligne(grille, '1 heure').avant === '39 €' && ligne(grille, '1 heure').apres === '42 €' && memes((await refaire('modifier_grilles_prix_centre', grille.p.action.params)).r.corps, { grilles: { bowling: { 1: 42 } } }), '[G] une case de grille se lit avant et apres', voir(grille));
    const grilleZero = await carte('modifier_grilles_prix_centre', { grille: 'laser', case: '2 parties', prix: 0 });
    const grilleTrop = await carte('modifier_grilles_prix_centre', { grille: 'laser', case: '2 parties', prix: 2000 });
    const grilleCase = await carte('modifier_grilles_prix_centre', { grille: 'bowling', case: '3 heures', prix: 90 });
    const grilleNom = await carte('modifier_grilles_prix_centre', { grille: 'karting', case: '1 heure', prix: 20 });
    ok(grilleZero.e && /plus de 0 €/.test(grilleZero.e.message) && grilleTrop.e && /entre 0 et 1000/.test(grilleTrop.e.message) && grilleCase.e && /1 heure/.test(grilleCase.e.message) && grilleNom.e && /bowling, laser ou fun run/.test(grilleNom.e.message), '[G] une case de grille hors bornes, inconnue ou a 0 euro se refuse', JSON.stringify([grilleZero.e && grilleZero.e.message, grilleTrop.e && grilleTrop.e.message, grilleCase.e && grilleCase.e.message, grilleNom.e && grilleNom.e.message]));
    const minigolf = await carte('modifier_prix_activite', { activite: 'Minigolf', prix: 10 });
    ok(minigolf.p && ligne(minigolf, 'Prix par personne').avant === '9 €' && ligne(minigolf, 'Prix par personne').apres === '10 €' && /dans tous vos centres/.test(ligne(minigolf, 'Où').valeur || '') && /dans tous vos centres/.test(minigolf.p.resume.clients) && memes((await refaire('modifier_prix_activite', minigolf.p.action.params)).r.corps, { id: 'minigolf_blacklight', patch: { priceValue: 10 } }), '[G] le prix d une activite dit qu il vaut dans tous les centres', voir(minigolf));
    const bowlingActivite = await carte('modifier_prix_activite', { activite: 'Bowling', prix: 10 });
    const karaBox = await carte('modifier_prix_activite', { activite: 'Kara Box', prix: 10 });
    ok(bowlingActivite.e && /modifier_grilles_prix_centre/.test(bowlingActivite.e.message) && karaBox.e && /sur place/.test(karaBox.e.message), '[G] une activite a la grille ou reglee sur place renvoie ailleurs', JSON.stringify([bowlingActivite.e && bowlingActivite.e.message, karaBox.e && karaBox.e.message]));
    const sansTarifs = await carte('modifier_prix_activite', { activite: 'Minigolf', prix: 10 }, { session: REGLAGES_SEULS });
    ok(sansTarifs.e && sansTarifs.e.statusCode === 403 && /Tarifs/.test(sansTarifs.e.message), '[G] le prix d une activite demande aussi le droit Tarifs', voir(sansTarifs));
    const decocher = await carte('afficher_masquer_formule_formulaire', { formule: 'Anniversaire', proposee: 'non' });
    const cocherTeam = await carte('afficher_masquer_formule_formulaire', { formule: 'Team building', proposee: 'oui' });
    ok(decocher.p && memes((await refaire('afficher_masquer_formule_formulaire', decocher.p.action.params)).r.corps, { config: { offerAvailability: { 'f-anniv': false } } }) && ligne(decocher, 'Réservable en ligne').apres === 'non' && cocherTeam.p && /formule_en_vente/.test(cocherTeam.p.resume.alerte || '') && ligne(cocherTeam, 'Réservable en ligne').apres === 'non', '[G] une formule se decoche dans Offres & formules, et dit si l autre interrupteur la cache encore', `${voir(decocher)} ${voir(cocherTeam)}`);
    const retirerAnniv = await carte('retirer_formule', { formule: 'Anniversaire' });
    const retirerPirate = await carte('retirer_formule', { formule: 'Soirée pirate' });
    ok(retirerAnniv.p && retirerAnniv.p.vue.danger === true && /tous vos centres/.test(retirerAnniv.p.resume.clients) && memes((await refaire('retirer_formule', retirerAnniv.p.action.params)).r.corps, { id: 'f-anniv' }) && retirerPirate.e && /retirer_formule_du_comptoir/.test(retirerPirate.e.message), '[G] retirer une formule du catalogue dit qu elle quitte tous les centres', `${voir(retirerAnniv)} ${retirerPirate.e && retirerPirate.e.message}`);
    const montrer = await carte('formule_du_comptoir_en_ligne', { formule: 'Soirée pirate', en_ligne: 'oui' });
    const dejaComptoir = await carte('formule_du_comptoir_en_ligne', { formule: 'Soirée pirate', en_ligne: 'non' });
    const pasDuComptoir = await carte('formule_du_comptoir_en_ligne', { formule: 'Anniversaire', en_ligne: 'oui' });
    const retirerComptoir = await carte('retirer_formule_du_comptoir', { formule: 'pirate' });
    ok(montrer.p && memes((await refaire('formule_du_comptoir_en_ligne', montrer.p.action.params)).r.corps, { id: 'sm-libramont--soiree-pirate', clients: true }) && dejaComptoir.e && /au comptoir seulement/.test(dejaComptoir.e.message) && pasDuComptoir.e && /Soirée pirate/.test(pasDuComptoir.e.message)
      && retirerComptoir.p && memes((await refaire('retirer_formule_du_comptoir', retirerComptoir.p.action.params)).r.corps, { id: 'sm-libramont--soiree-pirate' }),
    '[G] une formule du comptoir se montre en ligne ou se retire, les autres ne s y trompent pas', JSON.stringify([voir(montrer), dejaComptoir.e && dejaComptoir.e.message, pasDuComptoir.e && pasDuComptoir.e.message, voir(retirerComptoir)]));
    const suggestionsSansTarifs = await carte('modifier_offres_suggestions', { offre: 'laser', remise: '5 € par personne' }, { session: REGLAGES_SEULS });
    ok(suggestionsSansTarifs.e && suggestionsSansTarifs.e.statusCode === 403 && /Tarifs/.test(suggestionsSansTarifs.e.message), '[G] les suggestions demandent aussi le droit Tarifs', voir(suggestionsSansTarifs));
    const remise = await carte('modifier_offres_suggestions', { offre: 'laser', remise: '5 € par personne' });
    const corpsRemise = remise.p ? (await refaire('modifier_offres_suggestions', remise.p.action.params)).r.corps : null;
    ok(remise.p && ligne(remise, 'Remise').avant === '10 %' && ligne(remise, 'Remise').apres === '5 € par personne' && corpsRemise && corpsRemise.config.upsellOffers.enabled === true && corpsRemise.config.upsellOffers.offers.length === 1 && memes(corpsRemise.config.upsellOffers.offers[0].discount, { mode: 'fixed_per_participant', value: 5 }), '[G] une suggestion change sa remise, et toutes les offres repartent', `${voir(remise)} ${JSON.stringify(corpsRemise)}`);
    const carteSansTarifs = await carte('modifier_cartes_arcade', { carte: '30 minutes', prix: 16 }, { session: REGLAGES_SEULS });
    const carteArcade = await carte('modifier_cartes_arcade', { carte: '30 minutes', prix: 16 });
    const corpsCarte = carteArcade.p ? (await refaire('modifier_cartes_arcade', carteArcade.p.action.params)).r.corps : null;
    const arcade = corpsCarte && corpsCarte.config.activityOffers.arcade_time;
    ok(carteSansTarifs.e && carteSansTarifs.e.statusCode === 403 && carteArcade.p && ligne(carteArcade, 'Prix de la carte').avant === '15 €' && ligne(carteArcade, 'Prix de la carte').apres === '16 €' && arcade && arcade.timeOffers.length === 2 && arcade.creditOffers.length === 4 && arcade.timeOffers.find((o) => o.id === 'time-30').price === 16 && arcade.timeOffers.find((o) => o.id === 'time-60').price === 25, '[G] une carte arcades change de prix avec le droit Tarifs, ses deux listes repartent entieres', `${voir(carteSansTarifs)} ${voir(carteArcade)}`);
    const orval = await carte('modifier_catalogue_supplements', { article: 'Orval', prix: 6 });
    const corpsOrval = orval.p ? (await refaire('modifier_catalogue_supplements', orval.p.action.params)).r.corps : null;
    const orvalNegatif = await carte('modifier_catalogue_supplements', { article: 'Orval', prix: -1 });
    ok(orval.p && ligne(orval, 'Prix').avant === '5,50 €' && ligne(orval, 'Prix').apres === '6 €' && corpsOrval && corpsOrval.surMesure.articles.length === b.reglages.config.surMesure.articles.length && corpsOrval.surMesure.articles.find((a) => a.id === 'orval').prix === 6 && orvalNegatif.e && /entre 0 et 100000/.test(orvalNegatif.e.message), '[G] un supplement change de prix, le catalogue entier repart', `${voir(orval)} ${orvalNegatif.e && orvalNegatif.e.message}`);

    // ── S. LE CLIC : api/ops.js ──
    if (!editions.length) console.log('\n[S] le clic : la Direction seule, tout refait, l action du logiciel ecrit');
    purger();
    const journal = { audits: [], ecrit: [] };
    let courante = DIRECTION;
    const auth = remplacer('lib/staff-auth.js', {
      getStaffSessionFromRequest: async () => courante,
      requireStaffPermission: async (req, res, permission) => {
        if (!auth.sessionHasPermission(courante, permission)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, message: 'Permission insuffisante.' }));
          return null;
        }
        return { ...courante, authorizedCenterId: 'libramont' };
      },
    });
    remplacer('lib/audit-log.js', { writeAuditLog: async (e) => { journal.audits.push(e); return {}; }, writeAuditLogOrThrow: async (e) => { journal.audits.push(e); return {}; } });
    // La base, sans la base : les vraies sauvegardes de lib/center-config.js (fusion, remplacement en bloc,
    // statut de colonne, normalisation stricte) tournent sur une fausse piscine qui sert la ligne du centre
    // et garde ce qu elles y ecrivent.
    const b2 = { brut: brutDuBanc(), statut: 'active', nom: 'Fun Galaxy Libramont' };
    const faussePool = {
      async query(sql, params = []) {
        const q = String(sql);
        if (/select nullif\(client_id/.test(q)) return { rows: [{ client_id: 'fungalaxy' }], rowCount: 1 };
        if (/select settings from centers/.test(q)) return { rows: [{ settings: { config: JSON.parse(JSON.stringify(b2.brut)) } }], rowCount: 1 };
        if (/select status from centers/.test(q)) return { rows: [{ status: b2.statut }], rowCount: 1 };
        if (/update centers\s+set settings = jsonb_set/.test(q)) {
          journal.ecrit.push(['configuration', { centre: params[0], config: JSON.parse(params[1]), statut: params[2] }]);
          b2.brut = JSON.parse(params[1]);
          b2.statut = params[2];
          return { rows: [], rowCount: 1 };
        }
        if (/insert into centers/.test(q)) {
          journal.ecrit.push(['centre', { id: params[0], name: params[1], status: params[2], timezone: params[3] }]);
          b2.nom = params[1];
          b2.statut = params[2];
          return { rows: [{ id: params[0], name: params[1], status: params[2], timezone: params[3], settings: { config: b2.brut } }], rowCount: 1 };
        }
        if (/update centers\s+set status = \$2/.test(q)) {
          journal.ecrit.push(['statut', { centre: params[0], statut: params[1] }]);
          b2.statut = params[1];
          return { rows: [{ id: params[0], name: b2.nom, status: params[1], timezone: 'Europe/Brussels', settings: { config: b2.brut } }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    remplacer('lib/database.js', { getPool: () => faussePool, readAdminRangeState: async () => ({ reservations: [] }) });
    remplacer('lib/ops-knowledge.js', { refreshCenterOverrides: async () => true });
    const CC2 = require(path.join(ROOT, 'lib/center-config.js'));
    Object.assign(b2, banc(CC2));
    remplacer('lib/center-config.js', {
      loadCenterRecords: async () => [{ id: 'libramont', name: b2.nom, status: b2.statut, timezone: 'Europe/Brussels', config: b2.brut }],
      saveCenterConfigOverride: async (pool, centre, patch) => { journal.ecrit.push(['saveCenterConfigOverride', { centre, patch }]); return CC2.saveCenterConfigOverride(pool, centre, patch); },
      saveGrillesTarif: async (pool, centre, demande) => { journal.ecrit.push(['saveGrillesTarif', { centre, demande }]); return CC2.saveGrillesTarif(pool, centre, demande); },
    });
    remplacer('lib/availability-blocks.js', {
      listAvailabilityBlocks: async () => b2.fermetures,
      upsertAvailabilityBlock: async (pool, x) => { journal.ecrit.push(['upsertAvailabilityBlock', x]); return { id: 99, ...x }; },
      deleteAvailabilityBlock: async (pool, x) => { journal.ecrit.push(['deleteAvailabilityBlock', x]); return { ok: true, removed: 1 }; },
      refreshAvailabilityBlocks: async () => {},
    });
    remplacer('lib/catalog-overrides.js', { buildClientCatalog: async () => ({ formulas: b2.catalogue, activities: b2.activites }) });
    remplacer('lib/catalog-store.js', { refreshCatalog: async () => true, updateActivity: async (pool, x) => { journal.ecrit.push(['updateActivity', x]); return { id: x.id }; } });
    const ops2 = require(path.join(ROOT, OPS));
    const aujourdhui = (require(path.join(ROOT, 'lib/center-facts.js')).jourDuCentre() || {}).date || new Date().toISOString().slice(0, 10);
    const cliquer = (geste, params) => appeler(ops2, { action: 'assistantGeste', centerId: 'libramont', geste, params });
    const ecrit = (nom) => journal.ecrit.filter((e) => e[0] === nom).map((e) => e[1]);

    const avant = JSON.parse(JSON.stringify(CC2.normalizeCenterConfig(b2.brut, 'libramont')));
    const h = await cliquer('horaires_de_la_semaine', { jour: 'samedi', ouverture: '10:00', fermeture: '01:00' });
    const [sauve] = ecrit('saveCenterConfigOverride');
    const [stocke] = ecrit('configuration');
    const apres = CC2.normalizeCenterConfig(b2.brut, 'libramont');
    const autresCles = Object.keys(avant).filter((k) => k !== 'defaultSchedule' && !memes(avant[k], apres[k]));
    ok(h.statut === 200 && sauve && sauve.centre === 'libramont' && memes(Object.keys(sauve.patch), ['defaultSchedule']) && memes(Object.keys(sauve.patch.defaultSchedule), ['regular']) && stocke && stocke.statut === 'active'
      && memes(apres.defaultSchedule.regular['6'], { open: '10:00', close: '25:00' }) && ['0', '1', '2', '3', '4', '5'].every((j) => memes(apres.defaultSchedule.regular[j], avant.defaultSchedule.regular[j])) && memes(apres.defaultSchedule.holiday, avant.defaultSchedule.holiday) && !autresCles.length,
    '[S] un horaire part seul dans la configuration, le reste du centre intact', `${h.statut} ${JSON.stringify(h.json).slice(0, 160)} ${JSON.stringify(sauve && Object.keys(sauve.patch))} autres : ${autresCles.join(', ')}`);
    ok(journal.audits.some((a) => a && a.action === 'assistantGeste' && JSON.stringify(a).includes('saveCenterConfig')), '[S] le journal d audit dit le geste et l action du logiciel', JSON.stringify(journal.audits.map((a) => [a.action, a.changes])).slice(0, 300));
    journal.ecrit.length = 0;
    const deux = await cliquer('horaires_de_la_semaine', { jour: 'samedi', ouverture: '10:00', fermeture: '01:00' });
    ok(deux.statut === 422 && /déjà ouvert/.test(deux.json.message || deux.json.error || JSON.stringify(deux.json)) && !journal.ecrit.length, '[S] au clic l etat se relit : un horaire deja pose ne s ecrit pas deux fois', `${deux.statut} ${JSON.stringify(deux.json)}`);

    const date = plusJours(aujourdhui, 12);
    const f = await cliquer('fermeture_programmee', { date, debut: '18:00', fin: '24:00', motif: 'Soirée privée' });
    const [bloc] = ecrit('upsertAvailabilityBlock');
    ok(f.statut === 200 && bloc && bloc.centerId === 'libramont' && bloc.scopeType === 'center' && bloc.recurrence === 'once' && bloc.date === date && bloc.startTime === '18:00' && bloc.endTime === '24:00' && bloc.reason === 'Soirée privée' && bloc.id === undefined && bloc.createdBy === 'Seb', '[S] une fermeture part a la sauvegarde des blocages avec le corps refait', `${f.statut} ${JSON.stringify(f.json).slice(0, 160)} ${JSON.stringify(bloc)}`);
    const g = await cliquer('modifier_grilles_prix_centre', { grille: 'laser', case: '2 parties', prix: 20 });
    const [grilleEcrite] = ecrit('saveGrillesTarif');
    const grillesApres = require(path.join(ROOT, 'lib/booking-config.js')).grillesEffectives(CC2.normalizeCenterConfig(b2.brut, 'libramont').grillesTarif);
    ok(g.statut === 200 && grilleEcrite && grilleEcrite.centre === 'libramont' && memes(grilleEcrite.demande, { laser: { 2: 20 } }) && memes(grillesApres.laserOptions.map((o) => o.price), [10, 20, 25]) && grillesApres.durationOptions.find((o) => o.value === 1).price === 39,
      '[S] une case de grille part a la porte des tarifs du centre, les autres cases gardent leur prix', `${g.statut} ${JSON.stringify(g.json).slice(0, 160)} ${JSON.stringify(grilleEcrite)} ${JSON.stringify(grillesApres.laserOptions)}`);
    const a = await cliquer('modifier_prix_activite', { activite: 'Minigolf', prix: 10 });
    const [activite] = ecrit('updateActivity');
    ok(a.statut === 200 && activite && activite.id === 'minigolf_blacklight' && activite.priceValue === 10 && activite.centerId === 'all' && activite.ownerClientId === 'fungalaxy' && Object.keys(activite).sort().join(',') === 'centerId,id,ownerClientId,priceValue', '[S] le prix d une activite part au catalogue de la societe, et rien d autre', `${a.statut} ${JSON.stringify(a.json).slice(0, 160)} ${JSON.stringify(activite)}`);
    b2.statut = 'planned';
    const n = await cliquer('renommer_centre', { nom: 'Fun Galaxy Ardenne' });
    const [centreEcrit] = ecrit('centre');
    ok(n.statut === 200 && centreEcrit && memes(centreEcrit, { id: 'libramont', name: 'Fun Galaxy Ardenne', status: 'planned', timezone: 'Europe/Brussels' }), '[S] renommer garde le statut et le fuseau du centre', `${n.statut} ${JSON.stringify(n.json).slice(0, 160)} ${JSON.stringify(centreEcrit)}`);
    const s = await cliquer('changer_statut_centre', { statut: 'archivé' });
    const [statutEcrit] = ecrit('statut');
    ok(s.statut === 200 && statutEcrit && statutEcrit.centre === 'libramont' && statutEcrit.statut === 'closed', '[S] le statut du centre part a sa porte', `${s.statut} ${JSON.stringify(s.json).slice(0, 160)} ${JSON.stringify(statutEcrit)}`);
    journal.ecrit.length = 0;
    const site = await cliquer('couper_ou_remettre_formulaire_site', { actif: 'non' });
    const [embed] = ecrit('saveCenterConfigOverride');
    const [embedStocke] = ecrit('configuration');
    // Le centre vient d etre archive : la configuration enregistree ne le rouvre pas (statut de colonne).
    ok(site.statut === 200 && embed && memes(Object.keys(embed.patch), ['embed']) && embed.patch.embed.actif === false && embed.patch.embed.basculePar === 'Seb' && embedStocke && embedStocke.config.embed && embedStocke.config.embed.actif === false && embedStocke.statut === 'closed',
      '[S] le formulaire du site se coupe par sa porte, qui note qui l a coupe', `${site.statut} ${JSON.stringify(site.json).slice(0, 160)} ${JSON.stringify(embed)} ${JSON.stringify(embedStocke && { embed: embedStocke.config.embed, statut: embedStocke.statut })}`);
    // Ce que la sauvegarde remplace en bloc (secours, surMesure) ou ce qui porte un tableau (les offres) :
    // la vraie fusion garde tout ce que la carte n a pas touche.
    journal.ecrit.length = 0;
    const sec = await cliquer('boite_de_secours', { ajouter: 'equipe@fungalaxy.be' });
    const [secStocke] = ecrit('configuration');
    const orvalAvant = (CC2.normalizeCenterConfig(b2.brut, 'libramont').surMesure || {}).articles || [];
    const sup = await cliquer('modifier_catalogue_supplements', { article: 'Orval', prix: 6 });
    const [supStocke] = ecrit('configuration').slice(1);
    const supApres = supStocke ? supStocke.config.surMesure.articles : [];
    const autresArticles = orvalAvant.filter((x) => x.id !== 'orval' && !memes(x, supApres.find((y) => y.id === x.id)));
    const sug = await cliquer('modifier_offres_suggestions', { offre: 'laser', remise: '5 € par personne' });
    const [sugStocke] = ecrit('configuration').slice(2);
    const offres = sugStocke ? sugStocke.config.upsellOffers : null;
    ok(sec.statut === 200 && secStocke && memes(secStocke.config.secours, { emails: ['direction@fungalaxy.be', 'equipe@fungalaxy.be'] })
      && sup.statut === 200 && supApres.length === orvalAvant.length && supApres.find((x) => x.id === 'orval').prix === 6 && !autresArticles.length
      && sug.statut === 200 && offres && offres.enabled === true && offres.offers.length === 1 && memes(offres.offers[0].discount, { mode: 'fixed_per_participant', value: 5 }) && offres.offers[0].title === 'Une partie de laser en plus',
    '[S] la boite de secours, les supplements et les suggestions repartent entiers, seul le change bouge', JSON.stringify({ sec: [sec.statut, secStocke && secStocke.config.secours], sup: [sup.statut, supApres.length, orvalAvant.length, autresArticles.map((x) => x.id)], sug: [sug.statut, offres] }).slice(0, 500));
    journal.ecrit.length = 0;
    courante = MANAGER;
    const manager = await cliquer('fermeture_programmee', { date: plusJours(aujourdhui, 13) });
    const managerPrix = await cliquer('modifier_grilles_prix_centre', { grille: 'bowling', case: '1 heure', prix: 45 });
    courante = DIRECTION;
    ok(manager.statut === 403 && managerPrix.statut === 403 && !journal.ecrit.length, '[S] un Manager (role non verrouille) ne fait aucun geste du centre (403)', `${manager.statut} ${managerPrix.statut} ${JSON.stringify(journal.ecrit).slice(0, 200)}`);
  } finally {
    restaurer();
    purger();
  }
  return echecs;
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    let manquees = 0;
    for (const m of MUTATIONS) {
      // eslint-disable-next-line no-await-in-loop
      const echecs = await verifier(m.editions).catch((e) => [`erreur ${e.message}`]);
      const mord = echecs.includes(m.rouge);
      if (!mord) manquees += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${m.nom} : ${mord ? `rougit « ${m.rouge} »` : `ne mord pas (${echecs.join(' ; ') || 'tout vert'})`}`);
    }
    console.log(`assistant-gestes-centre-check --contre-preuves: ${MUTATIONS.length - manquees}/${MUTATIONS.length} mordent`);
    process.exit(manquees ? 1 : 0);
  }
  const echecs = await verifier();
  console.log(`\n${echecs.length ? `assistant-gestes-centre-check: ${echecs.length} echec(s)` : 'assistant-gestes-centre-check: ALL OK'}`);
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

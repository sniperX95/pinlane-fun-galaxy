'use strict';
// TOUT FAIRE, LOT 3 : LES RESERVATIONS, LES DEMANDES, LES MAILS D UN CLIENT ET LE PLANNING (2026-11-11).
// L assistant prepare ces gestes en carte (lib/assistant-gestes-reservations.js) et api/ops.js
// (assistantGeste) les refait au clic : vers l action du logiciel, ou vers la fiche (api/staff-
// reservations.js) et les pistes (api/staff-lanes.js) avec les en-tetes de la session. Ce gate tient,
// sans base ni reseau (lectures et ecritures doublees, rien ne part) :
//   G. la carte : avant et apres, ce qui atteint les clients, les refus (numero inconnu, reservation
//      d un autre centre, hors bornes, deja dans cet etat), un geste risque seulement sur les mots de
//      la personne, la version relue au clic, un mail qui montre son destinataire et son texte entier
//      et garde la cle de sa tentative, une proposition ou un plan de retard qui a change s arrete ;
//   S. le clic : la requete exacte a la fiche, aux pistes ou a l action du logiciel, la meme session,
//      deux clics sur un mail portent une seule cle, un Manager et une reservation d un autre centre
//      ne touchent a rien.
// Lancement : node scripts/assistant-gestes-reservations-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const GESTES = 'lib/assistant-gestes.js';
const LOT = 'lib/assistant-gestes-reservations.js';
const OPS = 'api/ops.js';
const PROGRAMME = 'lib/programme-a-cocher.js';

// Chaque garde retiree en memoire (le disque n est jamais touche) doit rougir sa ligne.
const MUTATIONS = [
  { nom: 'statut-sans-version', rouge: '[G] le statut part avec la version relue au clic', editions: [{ fichier: LOT, de: '        const corps = { id: r.id, baseUpdatedAt: r.version, status: voulu.id };', vers: '        const corps = { id: r.id, status: voulu.id };' }] },
  { nom: 'autre-centre-accepte', rouge: '[G] une reservation d un autre centre se refuse comme un numero inconnu', editions: [{ fichier: LOT, de: " || String(r.centerId || 'libramont') !== String(ctx.centre)) {", vers: ') {' }] },
  { nom: 'mail-sans-risque', rouge: '[G] un mail ne nait que des mots de la personne', editions: [{ fichier: LOT, de: "      action: 'sendDirectEmail', permission: 'emails.send', risque: true,", vers: "      action: 'sendDirectEmail', permission: 'emails.send', risque: false," }] },
  { nom: 'cle-refaite-au-clic', rouge: '[G] la cle de tentative posee sur la carte repart au clic', editions: [{ fichier: LOT, de: "const tentative = /^assistant-[0-9a-f-]{36}$/.test(String(p.tentative || '')) ? String(p.tentative) : `assistant-${require('crypto').randomUUID()}`;", vers: "const tentative = `assistant-${require('crypto').randomUUID()}`;" }] },
  { nom: 'adresse-changee-acceptee', rouge: '[G] une adresse changee entre la carte et le clic arrete l envoi', editions: [{ fichier: LOT, de: '        if (rempli(p.destinataire) && String(p.destinataire).trim().toLowerCase() !== to) throw erreur(', vers: '        if (false) throw erreur(' }] },
  { nom: 'texte-du-mail-coupe', rouge: '[G] un mail montre son destinataire et son texte entier', editions: [{ fichier: LOT, de: "{ libelle: 'Texte', valeur: coupe(texte, 220), long: texte },", vers: "{ libelle: 'Texte', valeur: coupe(texte, 220) }," }] },
  { nom: 'proposition-changee-acceptee', rouge: '[G] une autre proposition partie entre-temps arrete la reservation de la demande', editions: [{ fichier: LOT, de: '        if (rempli(p.proposition_vue) && String(p.proposition_vue) !== empreinte) throw erreur(', vers: '        if (false) throw erreur(' }] },
  { nom: 'plan-de-retard-change-accepte', rouge: '[G] un plan de retard qui a change depuis la carte s arrete au clic', editions: [{ fichier: LOT, de: '        if (rempli(p.plan_vu) && String(p.plan_vu) !== empreinte) throw erreur(', vers: '        if (false) throw erreur(' }] },
  { nom: 'pas-venu-avant-l-heure', rouge: '[G] pas venu : seulement une fois l heure passee, et c est risque', editions: [{ fichier: LOT, de: '          if (!passee) throw erreur(', vers: '          if (false) throw erreur(' }] },
  { nom: 'encaisse-sans-raison', rouge: '[G] un encaisse different du prix demande sa raison', editions: [{ fichier: LOT, de: '        if (!egal && !raison) throw erreur(', vers: '        if (false) throw erreur(' }] },
  { nom: 'manager-agit', rouge: '[S] un Manager ne fait aucun geste de ce lot (403), rien ne s ecrit', editions: [{ fichier: OPS, de: "    if (!agitAvecLAssistant(options.session)) throw createHttpError('Seules la Direction et le propriétaire font agir l’assistant.', 403, true);\n    const G = require('../lib/assistant-gestes');", vers: "    const G = require('../lib/assistant-gestes');" }] },
  // Vu par la revue du lot 2 le 2026-11-12 : « permet » ouvrait « met », « beaucoup » ouvrait « coup ».
  { nom: 'demande-en-milieu-de-mot', rouge: '[G] une phrase de lecture n ouvre aucun geste risque du lot, la demande de chacun l ouvre', editions: [{ fichier: LOT, de: 'const mots = (...racines) => new RegExp(`(?<!\\\\p{L})(?:', vers: 'const mots = (...racines) => new RegExp(`(?:' }] },
  // La relance et le SMS (2026-11-12) : la cle nait sur la carte, le serveur n envoie qu une fois.
  { nom: 'cle-de-relance-refaite', rouge: '[G] la cle d une relance posee sur la carte repart a chaque clic', editions: [{ fichier: LOT, de: "const tentativeDe = (p) => (/^assistant-[0-9a-f-]{36}$/.test(String(p.tentative || ''))", vers: 'const tentativeDe = (p) => (false' }] },
  { nom: 'relance-adresse-changee', rouge: '[G] une adresse changee entre la carte et le clic arrete la relance', editions: [{ fichier: LOT, de: "        if (vue !== to) throw erreur('L’adresse du client a changé depuis la carte : redemandez la relance", vers: "        if (false) throw erreur('L’adresse du client a changé depuis la carte : redemandez la relance" }] },
  { nom: 'relance-sans-variable', rouge: '[G] une relance montre son destinataire et son texte entier, et dit un client retire des mails marketing', editions: [{ fichier: LOT, de: "        if (/\\{\\{|\\}\\}/.test(`${objet}\\n${texte}`)) throw erreur('Écrivez la relance", vers: "        if (false) throw erreur('Écrivez la relance" }] },
  { nom: 'sms-sans-compte', rouge: '[G] un SMS se refuse tant que le centre n a pas de compte SMS', editions: [{ fichier: LOT, de: '        if (!canal || !canal.available) throw erreur(', vers: '        if (false) throw erreur(' }] },
  { nom: 'sms-trop-long', rouge: '[G] un SMS montre le numero et le texte entier, dans la longueur du canal', editions: [{ fichier: LOT, de: '        if (texte.length > max) throw erreur(`Un SMS fait', vers: '        if (false) throw erreur(`Un SMS fait' }] },
  { nom: 'tentative-reecrite', rouge: '[I] une relance a la meme cle ne repart pas, meme apres un echec, et la meme cle sur un autre texte se refuse', editions: [{ fichier: 'lib/database.js', de: "const empreinteDeTentative = payload.directEmail ? 'directFingerprint' : (payload.attemptFingerprint ? 'attemptFingerprint' : '');", vers: "const empreinteDeTentative = payload.directEmail ? 'directFingerprint' : '';" }] },
  { nom: 'relance-sans-cle', rouge: '[I] une relance a la meme cle ne repart pas, meme apres un echec, et la meme cle sur un autre texte se refuse', editions: [{ fichier: 'lib/ops-communications.js', de: '    ...(tentative ? { idempotencyKey: `relance:${centerId}:${tentative}` } : {}),', vers: '' }] },
  { nom: 'message-sans-cle', rouge: '[I] un message de la fiche a la meme cle ne repart pas, sans cle il part comme avant', editions: [{ fichier: 'lib/ops-communications.js', de: '    ...(tentative ? { idempotencyKey: `client:${resolvedCenterId}:${tentative}` } : {}),', vers: '' }] },
  { nom: 'cle-ignoree-par-le-serveur', rouge: '[S] deux clics sur une relance partent par l action du logiciel avec la meme cle, au client du dossier', editions: [{ fichier: OPS, de: "        // Facultative : la carte de l assistant la fige, un clic rejoue ne relance pas deux fois.\n        attemptId: body.attemptId || '',", vers: '' }] },
  // Prevenir les clients d un retard (2026-11-12) : le mail dit vrai au moment ou il part.
  { nom: 'retard-heure-changee-prevenue', rouge: '[G] prevenir les clients d un retard montre qui recoit quel texte, en entier, et qui ne recoit rien', editions: [{ fichier: LOT, de: '          if (c.newStartTime && heureDe(d) !== String(c.newStartTime).slice(0, 5)) {', vers: '          if (false) {' }] },
  { nom: 'retard-deja-prevenu-renvoye', rouge: '[G] un client deja prevenu de ce retard ou hors du retard ne recoit rien de plus', editions: [{ fichier: LOT, de: "          if (['queued', 'processing', 'sent', 'delivered'].includes(deja.get(id))) {", vers: '          if (false) {' }] },
  { nom: 'retard-hors-du-retard', rouge: '[G] un client deja prevenu de ce retard ou hors du retard ne recoit rien de plus', editions: [{ fichier: LOT, de: '          if (horsDuRetard.length) throw erreur(', vers: '          if (false) throw erreur(' }] },
  { nom: 'retard-texte-change-accepte', rouge: '[G] un texte ou un retard qui a change depuis la carte arrete l envoi', editions: [{ fichier: LOT, de: '        if (rempli(p.envoi_vu) && String(p.envoi_vu) !== empreinte) throw erreur(', vers: '        if (false) throw erreur(' }] },
  { nom: 'retard-autre-incident-accepte', rouge: '[G] un texte ou un retard qui a change depuis la carte arrete l envoi', editions: [{ fichier: LOT, de: '        if (rempli(p.incident) && Number(p.incident) !== Number(incident.id)) throw erreur(', vers: '        if (false) throw erreur(' }] },
  { nom: 'retard-texte-pas-transmis', rouge: '[S] les clients du retard sont prevenus par l action du logiciel, avec les textes de la carte', editions: [{ fichier: LOT, de: 'messages: envois.map((e) => ({ reservationId: e.reservationId, subject: e.subject, body: e.body }))', vers: 'messages: []' }] },
  // Cocher une activite (2026-11-12) : la cle vient du programme lu comme la fiche, jamais du modele.
  { nom: 'coche-avec-version', rouge: '[I] la coche de la carte prend le chemin de la case : une cle sur ce qui est en base, sans reecrire le dossier', editions: [{ fichier: LOT, de: 'corps: { id: r.id, activityToggle: { key: e.cle,', vers: 'corps: { id: r.id, baseUpdatedAt: r.version, activityToggle: { key: e.cle,' }] },
  { nom: 'cle-du-modele-acceptee', rouge: '[G] une cle dite par le modele ou changee depuis la carte ne coche rien', editions: [{ fichier: LOT, de: '        if (rempli(p.cle)) {', vers: '        if (false) {' }] },
  { nom: 'premiere-activite-prise', rouge: '[G] une activite qui revient plusieurs fois demande sa partie', editions: [{ fichier: LOT, de: '        if (cles.length > 1) throw erreur(', vers: '        if (false) throw erreur(' }] },
  { nom: 'deja-cochee-recochee', rouge: '[G] cocher ce qui est deja coche se refuse, decocher retire la coche, une activite hors programme se refuse', editions: [{ fichier: LOT, de: '        if (e.fait === voulu) throw erreur(', vers: '        if (false) throw erreur(' }] },
  { nom: 'annulee-cochee', rouge: '[G] un dossier annule ne se coche plus, un role sans le droit de changer un statut non plus', editions: [{ fichier: LOT, de: "        if (r.status === 'cancelled') throw erreur(`La réservation n° ${r.id} est annulée : son programme ne se coche plus.`);", vers: '' }] },
  { nom: 'coche-au-nom-du-modele', rouge: '[G] une activite se coche par la cle que la fiche lui donne, sans version, au nom de la session', editions: [{ fichier: LOT, de: "const par = nomDeSession(ctx.session) || 'Staff';", vers: "const par = String(p.par || 'Staff');" }] },
  { nom: 'bowling-un-seul-groupe', rouge: '[P] le bowling : un bloc, deux services, ou les pistes sans plan, comme la fiche', editions: [{ fichier: PROGRAMME, de: "    const cle = bowling.length === 1 ? 'bowling-1' : `bowling-g${i + 1}`;", vers: '    const cle = `bowling-g${i + 1}`;' }] },
  { nom: 'bowling-sans-pistes-oublie', rouge: '[P] le bowling : un bloc, deux services, ou les pistes sans plan, comme la fiche', editions: [{ fichier: PROGRAMME, de: "  if (type === 'bowling_lane' && (r.lanes || []).length) {", vers: '  if (false) {' }] },
  { nom: 'laser-vague-oubliee', rouge: '[P] le laser pose, en parties et en vagues, et les parties a placer, comme la fiche', editions: [{ fichier: PROGRAMME, de: '    const cle = vagues === 1 ? `laser_game-${partie}` : `laser_game-${partie}-g${vague}`;', vers: '    const cle = `laser_game-${partie}`;' }] },
  { nom: 'premiere-partie-pas-ancree', rouge: '[P] le laser pose, en parties et en vagues, et les parties a placer, comme la fiche', editions: [{ fichier: PROGRAMME, de: "  const ancre = r.opsPlan && r.opsPlan.laserPassPlan ? false : (!manuel && r.type !== 'laser');", vers: '  const ancre = false;' }] },
  { nom: 'estimation-de-formule-oubliee', rouge: '[P] le laser que la console estime faute de plan porte les memes cles', editions: [{ fichier: PROGRAMME, de: "  if (type === 'laser_arena' && (r.type === 'formule' || r.formuleId || partiesDuProgramme(r) > 0)) return sessionsDeFormuleEstimees(r, reglages);", vers: '' }] },
  { nom: 'variante-de-formule-ignoree', rouge: '[P] une formule coche ses etapes, dans la variante achetee ou d apres son plan', editions: [{ fichier: PROGRAMME, de: '  if (!Array.isArray(etapes) || !etapes.some((s) => remplacees.has(s.a))) return etapes;', vers: '  if (true) return etapes;' }] },
  { nom: 'attente-comptee-libre', rouge: '[P] les activites libres d une visite, celles d avant le reste comprises', editions: [{ fichier: PROGRAMME, de: '  items.filter((item) => item && !item.planned && !item.waitOffer).forEach((item) => {', vers: '  items.filter((item) => item && !item.planned).forEach((item) => {' }] },
  { nom: 'postes-du-centre-ignores', rouge: '[P] les postes de l arene du centre decoupent les vagues comme la console', editions: [{ fichier: PROGRAMME, de: 'postes: Number.isFinite(postesLus) && postesLus > 0 ? Math.trunc(postesLus) : POSTES_PAR_DEFAUT', vers: 'postes: POSTES_PAR_DEFAUT' }] },
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

async function lireCorps(req) {
  const morceaux = [];
  for await (const c of req) morceaux.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(morceaux).toString('utf8');
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

// Un gestionnaire d une autre adresse (fiche, pistes), double : il note la requete exacte recue.
function doublerAdresse(relatif, vus) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const avant = require.cache[chemin];
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: async (req, res) => {
    const corps = JSON.parse(await lireCorps(req));
    vus.push({ methode: req.method, url: req.url, corps, auth: req.headers.authorization });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } };
  return () => { if (avant) require.cache[chemin] = avant; else delete require.cache[chemin]; };
}

// ── Le centre du banc ──
const DIRECTION = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'm-dir', name: 'Seb' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: [] };
// Un role ouvert qui a tous les droits des gestes : seul le controle total de l assistant l arrete.
const MANAGER = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'm-man', name: 'Marius' }, role: { id: 'manager', name: 'Manager', locked: false }, permissions: ['reservations.status', 'reservations.edit', 'reservations.cancel', 'reservations.create', 'payments.markPaid', 'emails.send', 'emails.view', 'campaigns.manage', 'settings.manage', 'clients.view', 'clients.edit', 'planning.drag'] };
const ACCUEIL = { ...MANAGER, member: { id: 'm-acc', name: 'Inès' }, permissions: ['reservations.view', 'planning.view'] };

const plusJours = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function banc() {
  const J = require(path.join(ROOT, 'lib/center-facts.js')).jourDuCentre().date;
  const demain = plusJours(J, 1);
  const hier = plusJours(J, -1);
  const resa = (x) => ({ centerId: 'libramont', startTime: '18:00', pax: 8, status: 'pending', validationStatus: 'confirmed', price: 120, basePrice: 120, email: '', phone: '+32 470 11 22 33', name: '', lanes: [3], notes: '', opsPlan: {}, amountPaid: null, discountReason: '', absentAt: null, updatedAt: '2026-11-10T10:00:00.000Z', ...x });
  return {
    J, demain, hier,
    reservations: [
      resa({ id: 101, date: demain, name: 'Léa Martin', email: 'lea@exemple.be' }),
      resa({ id: 102, date: hier, name: 'Groupe Hier', startTime: '15:00' }),
      resa({ id: 103, date: hier, name: 'Groupe Payé', status: 'paid', price: 100, paymentMethod: 'Carte' }),
      resa({ id: 104, date: demain, name: 'Groupe Annulé', status: 'cancelled', email: 'annule@exemple.be' }),
      resa({ id: 105, date: demain, name: 'Demande en ligne', validationStatus: 'staff_review', email: 'web@exemple.be' }),
      resa({ id: 106, date: J, name: 'Groupe Retardé', startTime: '18:10', opsPlan: { delayFlag: { minutes: 10, from: '18:00', to: '18:10', origin: { startTime: '18:00', opsPlan: {}, lanes: [2] }, cleared: false } } }),
      resa({ id: 107, date: J, name: 'Groupe A', lanes: [1] }),
      resa({ id: 109, date: hier, name: 'Paul Parti', email: 'parti@exemple.be', status: 'paid' }),
      // Une journee apres un retard applique (incident 77) : le groupe retarde, celui qu il a pousse,
      // un sans adresse, et un dont l heure a bouge depuis.
      resa({ id: 110, date: J, name: 'Groupe Retard', startTime: '18:15', email: 'retard@exemple.be', lanes: [2] }),
      resa({ id: 111, date: J, name: 'Groupe Poussé', startTime: '19:15', email: 'pousse@exemple.be', lanes: [2] }),
      resa({ id: 112, date: J, name: 'Groupe Sans Mail', startTime: '20:15', email: '', lanes: [2] }),
      resa({ id: 113, date: J, name: 'Groupe Bougé', startTime: '21:00', email: 'bouge@exemple.be', lanes: [2] }),
      // Un programme a cocher : une FORMULE 1 (bowling fait, laser, arcades a heure, boissons) et un
      // laser de trois parties dont deux attendent leur heure.
      resa({ id: 114, date: J, name: 'Anniversaire Zoé', type: 'formule', formuleId: 'f1', startTime: '14:00', lanes: [1], activityProgress: { 'bowling-1': { done: true, doneAt: '2026-11-12T13:10:00.000Z', by: 'Inès' } },
        opsPlan: { resourceBlocks: [{ activityId: 'bowling', resourceType: 'bowling_lane', startTime: '14:00', endTime: '15:00', lanes: [1] }, { activityId: 'laser_game', resourceType: 'laser_arena', startTime: '15:30', endTime: '15:55', countIndex: 1 }],
          timeline: [{ type: 'activity', activityId: 'bowling', startTime: '14:00', endTime: '15:00' }, { type: 'activity', activityId: 'laser_game', startTime: '15:30', endTime: '15:55' }, { type: 'activity', activityId: 'arcade_time', startTime: '16:00', endTime: '16:30' }, { type: 'activity', activityId: 'service_drinks', startTime: '14:00', endTime: '23:00', flexible: true }] } }),
      resa({ id: 115, date: J, name: 'Laser Tom', type: 'laser', startTime: '17:00', lanes: [], program: { items: [{ activityId: 'laser_game', games: 3, participants: 8, planned: true }] },
        opsPlan: { laserPassPlan: { scheduledPasses: [{ countIndex: 1 }], pendingPasses: [{ countIndex: 2 }, { countIndex: 3 }] }, resourceBlocks: [{ activityId: 'laser_game', resourceType: 'laser_arena', startTime: '17:00', endTime: '17:25', countIndex: 1 }] } }),
      resa({ id: 201, centerId: 'gembloux', date: demain, name: 'Ailleurs', email: 'ailleurs@exemple.be' }),
    ],
    demandes: [
      { id: 31, centerId: 'libramont', contactName: 'Camille Dubois', company: '', email: 'camille@exemple.be', status: 'in_progress', payload: { suivi: { historique: [{ type: 'reponse', le: '2026-11-09T09:00:00.000Z', par: 'Seb', proposition: { type: 'libre', date: demain, heure: '14:00', fin: '16:00', nom: 'Bowling et laser', joueurs: 12, prix: 240, formule: '', activites: [{ id: 'bowling', nom: 'Bowling' }, { id: 'laser_game', nom: 'Laser' }], extras: [], plus: false, prixLibre: false } }] } } },
      { id: 32, centerId: 'gembloux', contactName: 'Autre centre', email: 'x@exemple.be', status: 'new', payload: {} },
      { id: 33, centerId: 'libramont', contactName: 'Sans réponse', email: 'y@exemple.be', status: 'new', payload: {} },
    ],
    simulations: [],
    fils: [
      { thread: { id: 41, centerId: 'libramont', contactEmail: 'paul@exemple.be', contactName: 'Paul', subject: 'Anniversaire samedi', status: 'open' }, contact: { email: 'paul@exemple.be', name: 'Paul' }, messages: [{ id: 900, direction: 'inbound' }, { id: 901, direction: 'outbound' }, { id: 902, direction: 'inbound' }] },
      { thread: { id: 42, centerId: 'gembloux', contactEmail: 'loin@exemple.be', contactName: 'Loin', subject: 'Ailleurs', status: 'open' }, contact: { email: 'loin@exemple.be', name: 'Loin' }, messages: [] },
    ],
    expediteurs: [{ id: 7, centerId: 'libramont', label: 'Fun Galaxy Libramont', email: 'contact@fungalaxy.be', isDefault: true }, { id: 8, centerId: 'libramont', label: 'Anniversaires', email: 'anniv@fungalaxy.be', isDefault: false }],
    suppressions: [{ email: 'parti@exemple.be', source: 'link', reason: '' }, { email: 'erreur@exemple.be', source: 'staff', reason: 'saisie' }],
    cerveau: { faq: { prix: { subject: 'Nos prix', body: 'Bonjour, voici nos prix.' } }, signature: '', extra: '' },
    registre: [
      { id: 61, centerId: 'libramont', reservationId: 150, archivedBy: 'Seb', reason: 'doublon', restoredAt: null, reservation: { id: 150, name: 'Groupe Dupont', date: demain, startTime: '15:00', pax: 6, status: 'pending' } },
      { id: 62, centerId: 'gembloux', reservationId: 151, archivedBy: 'X', reason: '', restoredAt: null, reservation: { id: 151, name: 'Ailleurs', date: demain, startTime: '15:00', pax: 4, status: 'pending' } },
    ],
    pistes: { nombre: 8, statuts: { 5: 'maintenance' }, maintenance: { 5: { from: '', until: '', note: 'huilage' } }, reservations: [{ id: 107, lanes: [3], startTime: '18:00', status: 'pending' }] },
    retardB: '19:15',
    incidents: [{ id: 77, centerId: 'libramont', reservationId: 110, delayMinutes: 15, reason: 'Client en retard', status: 'applied', previousStartTime: '18:00', proposedStartTime: '18:15', impact: { strategyId: 'cascade', changes: [
      changement(110, 'Groupe Retard', 'delayed', '18:00', '18:15'),
      changement(111, 'Groupe Poussé', 'shifted', '19:00', '19:15'),
      changement(112, 'Groupe Sans Mail', 'shifted', '20:00', '20:15'),
      changement(113, 'Groupe Bougé', 'shifted', '20:30', '20:45'),
    ] } }],
    prevenus: [],
  };
}

function changement(reservationId, name, kind, de, a) {
  return { reservationId, name, kind, previousStartTime: de, newStartTime: a, shiftMinutes: 15, previousLanes: [2], newLanes: [2], laneChanged: false, moves: [], hasEmail: true, summary: `${de} vers ${a}` };
}

function impactDu(b, minutes) {
  return {
    delayMinutes: minutes, reason: 'Client en retard', previousStartTime: '18:00', proposedStartTime: '18:15', recommendedStrategyId: 'cascade',
    strategies: [{ id: 'cascade', label: 'Décaler en cascade', feasible: true, warnings: [], changes: [
      { reservationId: 107, name: 'Groupe A', previousStartTime: '18:00', newStartTime: '18:15', previousLanes: [1], newLanes: [1] },
      { reservationId: 108, name: 'Groupe B', previousStartTime: '19:00', newStartTime: b.retardB, previousLanes: [1], newLanes: [1] },
    ] }],
  };
}

function lecteursDu(b) {
  const ED = require(path.join(ROOT, 'lib/email-design.js'));
  const EA = require(path.join(ROOT, 'lib/email-agent.js'));
  const centre = require(path.join(ROOT, 'lib/ops-knowledge.js')).getCenter('libramont');
  return {
    dossierResa: async (c, n) => b.reservations.find((r) => r.id === Number(n)) || null,
    demandeSurMesure: async (c, n) => b.demandes.find((d) => d.id === Number(n)) || null,
    simulationDemande: async (c, n, proposition) => { b.simulations.push({ n, proposition }); return { simulation: true, resume: { date: proposition.date, heure: proposition.heure, fin: '16:00', nom: proposition.nom, joueurs: proposition.joueurs, prix: 240, pistes: [1, 2], conflits: [], refus: '', email: 'camille@exemple.be', extras: [] } }; },
    filDeMails: async (c, n) => b.fils.find((f) => f.thread.id === Number(n)) || null,
    expediteursMails: async () => b.expediteurs,
    listeSuppression: async () => b.suppressions,
    designDesMails: async () => ED.fusionnerEmailDesign(null, centre),
    cerveauAgentMails: async () => ({ reglages: b.cerveau, defauts: EA.getEmailBrainDefaults('libramont') }),
    registreSuppressions: async () => b.registre,
    etatDesPistes: async () => b.pistes,
    impactDuRetard: async (c, n, minutes) => impactDu(b, minutes),
    retardApplique: async (c, n) => b.incidents.filter((i) => i.reservationId === Number(n)).slice(-1)[0] || null,
    prevenusDuRetard: async (c, id) => b.prevenus.filter((x) => x.incident === Number(id)),
    reglagesDuProgramme: async () => ({ postes: 30, formules: require(path.join(ROOT, 'lib/booking-config.js')).FORMULES }),
  };
}

async function verifier(editions = []) {
  const echecs = [];
  const ok = (cond, nom, detail = '') => {
    if (!cond) echecs.push(nom);
    if (!editions.length) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || !detail ? '' : `  ${String(detail).slice(0, 300)}`}`);
  };
  const vu = (x) => JSON.stringify(x.p || (x.e && x.e.message) || x.r || x).slice(0, 300);
  purger();
  const restaurer = armer(editions);
  try {
    // ── G. LA CARTE ──
    if (!editions.length) console.log('\n[G] la carte : lue, validee, chiffree, figee');
    const G = require(path.join(ROOT, GESTES));
    const b = banc();
    const lus = lecteursDu(b);
    const carte = (geste, params, mots, session = DIRECTION) => G.proposer(geste, params, G.contexte({ centre: 'libramont', session, messagesPersonne: mots, lecteurs: lus })).then((p) => ({ p }), (e) => ({ e }));
    const clic = (geste, params, session = DIRECTION) => G.refaire(geste, params, G.contexte({ centre: 'libramont', session, lecteurs: lus })).then((r) => ({ r }), (e) => ({ e }));
    const ligne = (x, libelle) => ((x.p && x.p.resume.lignes) || []).find((l) => l.libelle === libelle) || {};

    // Le contrat : chaque geste du lot a son droit, son adresse permise, ses mots s il est risque.
    // (une action de la plateforme, de l equipe, des roles ou des codes d acces n a rien a faire ici)
    const LOT_NOMS = Object.keys(require(path.join(ROOT, LOT)).gestes(G.AIDES));
    const { getRequiredOpsPermission } = require(path.join(ROOT, OPS));
    const fautifs = LOT_NOMS.filter((n) => {
      const g = G.GESTES[n];
      const adresse = !g.endpoint || (['staff-reservations', 'staff-customer-notes', 'staff-lanes'].includes(g.endpoint) && ['PATCH', 'POST', 'DELETE'].includes(g.methode));
      const plateforme = !g.endpoint && [].concat(getRequiredOpsPermission('POST', g.action)).includes('platform.admin');
      return !g || !g.permission || !adresse || plateforme || typeof g.preparer !== 'function' || !g.titre || !g.quoi || (g.risque && !(g.demande instanceof RegExp)) || /role|code|platform|founder|membre|member|acces|team/i.test(`${g.action} ${n}`);
    });
    ok(LOT_NOMS.length >= 20 && fautifs.length === 0, '[G] chaque geste du lot porte le contrat entier, aucun ne touche l equipe ni les codes', JSON.stringify({ n: LOT_NOMS.length, fautifs }));

    // UNE DEMANDE SE LIT EN TETE DE MOT (revue du lot 2, 2026-11-12) : une phrase qui lit ou qui
    // remercie n ouvre aucun geste risque du lot, et la demande ordinaire de chacun l ouvre toujours.
    const LECTURES = ['Merci beaucoup !', 'Bonsoir', 'Ça permet de voir quoi ?', 'Je cherche les réservations de vendredi', 'Combien de parties ce week-end ?', 'Donne-moi le nombre de joueurs', 'Résume la campagne de Noël', 'Comment marche le logiciel ?', 'Quelle activité marche le mieux ?', 'Plus de détails sur l’anniversaire de samedi', 'À propos du formulaire en ligne'];
    const DEMANDES = {
      statut_reservation: 'Elle a payé en espèces', noter_pas_venu: 'Le groupe d’hier n’est pas venu', encaisser: 'Encaisse 90 euros, un joueur en moins', valider_reservation_en_attente: 'Valide la demande en ligne',
      retablir_reservation_annulee: 'Rétablis la réservation annulée', modifier_reservation: 'Mets-la à 19 h et passe-les à 10', supprimer_reservation: 'Supprime ce doublon', restaurer_reservation_supprimee: 'Restaure la réservation supprimée de Dupont',
      reserver_la_demande: 'Camille a dit oui, réserve', ecrire_ou_repondre_mail: 'Écris à Léa pour lui confirmer sa piste', reinscrire_adresse_mails: 'Il m’a redemandé au téléphone, réinscris-le', apparence_des_mails: 'Change la signature et le gabarit des mails',
      reponse_type_agent: 'Change la réponse type sur les prix', expediteur_mails: 'Mets l’adresse anniversaires par défaut', supprimer_expediteur_mails: 'Supprime l’adresse anniversaires', piste_en_maintenance: 'La piste 3 est en panne, mets-la en maintenance',
      decaler_pour_retard: 'Le groupe A a 15 minutes de retard', retirer_retard: 'Annule le retard, remets-les à 18 h',
      relancer_client: 'Relance Léa, elle ne vient plus', sms_client: 'Envoie-lui un SMS pour dire que la piste est prête',
      prevenir_clients_du_retard: 'Préviens les clients du retard',
    };
    const risques = LOT_NOMS.filter((n) => G.GESTES[n].risque);
    const ouvertes = risques.flatMap((n) => LECTURES.filter((t) => G.GESTES[n].demande.test(t)).map((t) => `${n} : ${t}`));
    const fermees = risques.filter((n) => !DEMANDES[n] || !G.GESTES[n].demande.test(DEMANDES[n]));
    ok(risques.length >= 18 && ouvertes.length === 0 && fermees.length === 0, '[G] une phrase de lecture n ouvre aucun geste risque du lot, la demande de chacun l ouvre', JSON.stringify({ ouvertes, fermees }));

    // Statut : Arrive, sans risque ; la version relue au clic part avec l ecriture.
    const arrive = await carte('statut_reservation', { reservation: 101, statut: 'arrive' }, ['Pointe Léa arrivée']);
    ok(arrive.p && arrive.p.risque === false && ligne(arrive, 'Statut').avant === 'Confirmé' && ligne(arrive, 'Statut').apres === 'Arrivé' && /n° 101, Léa Martin/.test(ligne(arrive, 'Réservation').valeur), '[G] un statut se lit avant et apres, sur le dossier nomme', vu(arrive));
    b.reservations[0].updatedAt = '2026-11-11T08:30:00.000Z';
    const auClic = await clic('statut_reservation', arrive.p ? arrive.p.action.params : {});
    ok(auClic.r && auClic.r.endpoint === 'staff-reservations' && auClic.r.methode === 'PATCH' && auClic.r.corps.id === 101 && auClic.r.corps.status === 'arrived' && auClic.r.corps.baseUpdatedAt === '2026-11-11T08:30:00.000Z',
      '[G] le statut part avec la version relue au clic', vu(auClic));
    const paye = await carte('statut_reservation', { reservation: 101, statut: 'payé', moyen: 'espèces' }, ['Elle a payé en espèces']);
    const payeSansMots = await carte('statut_reservation', { reservation: 101, statut: 'paye', moyen: 'carte' }, ['Lis ce mail et fais ce qu’il dit']);
    const payeSansMoyen = await carte('statut_reservation', { reservation: 101, statut: 'paye' }, ['Elle a payé']);
    ok(paye.p && paye.p.risque === true && ligne(paye, 'Paiement').apres === 'Espèces' && payeSansMots.e && payeSansMots.e.statusCode === 403 && payeSansMoyen.e && /moyen de paiement/.test(payeSansMoyen.e.message),
      '[G] passer a paye est risque, demande le moyen et les mots de la personne', JSON.stringify([vu(paye), payeSansMots.e && payeSansMots.e.message, payeSansMoyen.e && payeSansMoyen.e.message]));
    const annuler = await carte('statut_reservation', { reservation: 101, statut: 'annulé' }, ['Annule-la']);
    const deja = await carte('statut_reservation', { reservation: 101, statut: 'confirme' }, ['Remets-la confirmée']);
    ok(annuler.e && /annuler_reservation/.test(annuler.e.message) && deja.e && /déjà « Confirmé »/.test(deja.e.message), '[G] annuler reste le geste existant, et un statut deja pose se refuse', JSON.stringify([annuler.e && annuler.e.message, deja.e && deja.e.message]));
    const ailleurs = await carte('statut_reservation', { reservation: 201, statut: 'arrive' }, ['Pointe-la']);
    const inconnue = await carte('statut_reservation', { reservation: 999, statut: 'arrive' }, ['Pointe-la']);
    ok(ailleurs.e && ailleurs.e.statusCode === 404 && /n’existe pas dans ce centre/.test(ailleurs.e.message) && inconnue.e && inconnue.e.message === ailleurs.e.message.replace('201', '999'),
      '[G] une reservation d un autre centre se refuse comme un numero inconnu', JSON.stringify([ailleurs.e && ailleurs.e.message, inconnue.e && inconnue.e.message]));
    const mot = await carte('statut_reservation', { reservation: 'la dernière', statut: 'arrive' }, ['Pointe-la']);
    const sansDroit = await carte('statut_reservation', { reservation: 101, statut: 'arrive' }, ['Pointe-la'], ACCUEIL);
    ok(mot.e && /doit être un nombre/.test(mot.e.message) && sansDroit.e && sansDroit.e.statusCode === 403, '[G] un numero en mots ou un role sans le droit ne donne aucune carte', JSON.stringify([mot.e && mot.e.message, sansDroit.e && sansDroit.e.message]));

    // Pas venu, encaisse, validation, retablissement, note d equipe.
    const absent = await carte('noter_pas_venu', { reservation: 102 }, ['Le groupe d’hier n’est pas venu']);
    const tropTot = await carte('noter_pas_venu', { reservation: 101 }, ['Elle n’est pas venue']);
    const absentPaye = await carte('noter_pas_venu', { reservation: 103 }, ['Pas venu']);
    ok(absent.p && absent.p.risque === true && ligne(absent, 'Groupe').apres === 'pas venu' && /places sont rendues/.test(absent.p.resume.alerte) && tropTot.e && /pas encore passée/.test(tropTot.e.message) && absentPaye.e && /arrivé, payé ou annulé/.test(absentPaye.e.message),
      '[G] pas venu : seulement une fois l heure passee, et c est risque', JSON.stringify([vu(absent), tropTot.e && tropTot.e.message, absentPaye.e && absentPaye.e.message]));
    const encaisse = await carte('encaisser', { reservation: 103, montant: '90', raison: 'joueur en moins' }, ['Encaisse 90 euros, un joueur en moins']);
    const sansRaison = await carte('encaisser', { reservation: 103, montant: 90 }, ['Encaisse 90 euros']);
    const pasPaye = await carte('encaisser', { reservation: 101, montant: 90, raison: 'remise' }, ['Encaisse 90 euros']);
    const horsBornes = await carte('encaisser', { reservation: 103, montant: 200000, raison: 'x' }, ['Encaisse']);
    ok(encaisse.p && encaisse.p.risque === true && ligne(encaisse, 'Encaissé').avant === '100 €' && ligne(encaisse, 'Encaissé').apres === '90 €' && ligne(encaisse, 'Raison').valeur === 'joueur en moins' && pasPaye.e && /n’est pas payée/.test(pasPaye.e.message) && horsBornes.e && /entre 0 et 100000/.test(horsBornes.e.message),
      '[G] un encaisse se lit sur un dossier paye, dans ses bornes', JSON.stringify([vu(encaisse), pasPaye.e && pasPaye.e.message, horsBornes.e && horsBornes.e.message]));
    ok(sansRaison.e && /Dites pourquoi le montant diffère/.test(sansRaison.e.message), '[G] un encaisse different du prix demande sa raison', sansRaison.e ? sansRaison.e.message : vu(sansRaison));
    const valide = await carte('valider_reservation_en_attente', { reservation: 105 }, ['Valide la demande en ligne']);
    const dejaValide = await carte('valider_reservation_en_attente', { reservation: 101 }, ['Valide-la']);
    const clicValide = await clic('valider_reservation_en_attente', { reservation: 105 });
    ok(valide.p && valide.p.risque === true && /web@exemple\.be reçoit le mail de confirmation/.test(valide.p.resume.clients) && dejaValide.e && /déjà validée/.test(dejaValide.e.message) && clicValide.r && clicValide.r.corps.validationStatus === 'confirmed' && clicValide.r.corps.skipReplan === true,
      '[G] valider dit le mail de confirmation qui part, et une reservation deja validee se refuse', JSON.stringify([vu(valide), vu(clicValide)]));
    const retablir = await carte('retablir_reservation_annulee', { reservation: 104 }, ['Rétablis la réservation annulée']);
    const pasAnnulee = await carte('retablir_reservation_annulee', { reservation: 101 }, ['Rétablis-la']);
    ok(retablir.p && ligne(retablir, 'Statut').apres === 'Confirmé' && /rappel avant sa venue/.test(retablir.p.resume.clients) && pasAnnulee.e && /n’est pas annulée/.test(pasAnnulee.e.message),
      '[G] retablir une annulee dit que ses mails repartent', JSON.stringify([vu(retablir), pasAnnulee.e && pasAnnulee.e.message]));
    const note = await carte('note_equipe_reservation', { reservation: 101, texte: 'Gâteau apporté par les parents, à garder au frigo.' }, []);
    const noteLongue = await carte('note_equipe_reservation', { reservation: 101, texte: 'x'.repeat(501) }, []);
    const clicNote = await clic('note_equipe_reservation', { reservation: 101, texte: 'Gâteau apporté par les parents, à garder au frigo.' });
    ok(note.p && note.p.risque === false && /frigo/.test(ligne(note, 'Note').long) && ligne(note, 'Signée').valeur === 'Seb' && noteLongue.e && /500 caractères/.test(noteLongue.e.message) && clicNote.r && clicNote.r.corps.noteEquipe.ajout === 'Gâteau apporté par les parents, à garder au frigo.' && Object.keys(clicNote.r.corps).join() === 'id,noteEquipe',
      '[G] une note d equipe se propose sans risque, signee, et part seule dans son corps', JSON.stringify([vu(note), vu(clicNote)]));

    // Modifier, supprimer, restaurer.
    const prixSansRaison = await carte('modifier_reservation', { reservation: 101, heure: '19:00', prix: 100 }, ['Mets-la à 19h et à 100 euros']);
    const modif = await carte('modifier_reservation', { reservation: 101, heure: '19:00', prix: 100, raison_prix: 'geste commercial' }, ['Mets-la à 19h et à 100 euros']);
    const rien = await carte('modifier_reservation', { reservation: 101, heure: '18:00' }, ['Change l’heure']);
    const passe = await carte('modifier_reservation', { reservation: 101, date: b.hier }, ['Change la date']);
    const jourEtPrix = await carte('modifier_reservation', { reservation: 101, date: plusJours(b.demain, 1), prix: 90, raison_prix: 'geste' }, ['Mets-la après-demain à 90 euros']);
    const clicModif = await clic('modifier_reservation', { reservation: 101, heure: '19:00', prix: 100, raison_prix: 'geste commercial' });
    ok(prixSansRaison.e && /pourquoi le prix change/.test(prixSansRaison.e.message) && modif.p && modif.p.risque === true && ligne(modif, 'Heure').apres === '19:00' && ligne(modif, 'Prix').avant === '120 €' && ligne(modif, 'Prix').apres === '100 €' && /se refait au clic/.test(modif.p.resume.alerte) && rien.e && passe.e && /dans le passé/.test(passe.e.message) && jourEtPrix.e && /d’abord le jour/.test(jourEtPrix.e.message)
      && clicModif.r && clicModif.r.corps.startTime === '19:00' && clicModif.r.corps.price === 100 && clicModif.r.corps.prixRaison === 'geste commercial' && clicModif.r.corps.baseUpdatedAt === '2026-11-11T08:30:00.000Z' && !('name' in clicModif.r.corps),
      '[G] modifier ne porte que ce qui change, un prix avec sa raison, jamais dans le passe', JSON.stringify([prixSansRaison.e && prixSansRaison.e.message, vu(modif), vu(clicModif)]));
    const suppr = await carte('supprimer_reservation', { reservation: 101, raison: 'doublon' }, ['Supprime ce doublon']);
    const supprSansMots = await carte('supprimer_reservation', { reservation: 101 }, ['Qu’est-ce que tu en penses ?']);
    const clicSuppr = await clic('supprimer_reservation', { reservation: 101, raison: 'doublon' });
    ok(suppr.p && suppr.p.risque === true && suppr.p.vue.danger === true && /registre des suppressions/.test(suppr.p.resume.alerte) && supprSansMots.e && supprSansMots.e.statusCode === 403 && clicSuppr.r && clicSuppr.r.methode === 'DELETE' && JSON.stringify(clicSuppr.r.corps) === JSON.stringify({ id: 101, reason: 'doublon' }),
      '[G] supprimer est dangereux, demande les mots de la personne et part en DELETE', JSON.stringify([vu(suppr), vu(clicSuppr)]));
    const restaure = await carte('restaurer_reservation_supprimee', { reservation: 150 }, ['Restaure la réservation supprimée de Dupont']);
    const restaureAilleurs = await carte('restaurer_reservation_supprimee', { reservation: 151 }, ['Restaure-la']);
    ok(restaure.p && JSON.stringify((await clic('restaurer_reservation_supprimee', { reservation: 150 })).r.corps) === JSON.stringify({ archiveId: 61, force: false }) && /Groupe Dupont/.test(ligne(restaure, 'Réservation').valeur) && restaureAilleurs.e && restaureAilleurs.e.statusCode === 404,
      '[G] restaurer vise la copie de ce centre, sans jamais forcer', JSON.stringify([vu(restaure), restaureAilleurs.e && restaureAilleurs.e.message]));

    // Demandes sur mesure.
    const noteDemande = await carte('noter_demande', { demande: 31, texte: 'Rappeler mardi, veut une facture au nom de l’école.' }, []);
    const demandeAilleurs = await carte('noter_demande', { demande: 32, texte: 'x' }, []);
    ok(noteDemande.p && noteDemande.p.risque === false && JSON.stringify((await clic('noter_demande', { demande: 31, texte: 'Rappeler mardi' })).r.corps) === JSON.stringify({ id: 31, texte: 'Rappeler mardi' }) && demandeAilleurs.e && demandeAilleurs.e.statusCode === 404,
      '[G] une note de demande se propose sans risque, dans ce centre seulement', JSON.stringify([vu(noteDemande), demandeAilleurs.e && demandeAilleurs.e.message]));
    const reserver = await carte('reserver_la_demande', { demande: 31 }, ['Camille a dit oui, réserve']);
    const sansProposition = await carte('reserver_la_demande', { demande: 33 }, ['Réserve-la']);
    ok(reserver.p && reserver.p.risque === true && /14:00 à 16:00/.test(ligne(reserver, 'Quand').valeur) && ligne(reserver, 'Prix').valeur === '240 €' && /camille@exemple\.be reçoit le mail de confirmation/.test(reserver.p.resume.clients) && /^[0-9a-f]{16}$/.test(reserver.p.action.params.proposition_vue || '') && b.simulations.length === 1 && sansProposition.e && /Aucune proposition/.test(sansProposition.e.message),
      '[G] reserver une demande montre le plan simule de la proposition envoyee', JSON.stringify([vu(reserver), sansProposition.e && sansProposition.e.message]));
    const clicReserver = await clic('reserver_la_demande', reserver.p ? reserver.p.action.params : {});
    ok(clicReserver.r && clicReserver.r.action === 'customRequestBook' && clicReserver.r.corps.confirme === true && clicReserver.r.corps.proposition.heure === '14:00' && clicReserver.r.corps.proposition.joueurs === 12, '[G] au clic, la reservation de la demande part confirmee avec la proposition envoyee', vu(clicReserver));
    b.demandes[0].payload.suivi.historique.push({ type: 'reponse', le: '2026-11-11T09:00:00.000Z', par: 'Seb', proposition: { ...b.demandes[0].payload.suivi.historique[0].proposition, heure: '16:00' } });
    const autreProposition = await clic('reserver_la_demande', reserver.p ? reserver.p.action.params : {});
    ok(autreProposition.e && autreProposition.e.statusCode === 409 && /a changé depuis la carte/.test(autreProposition.e.message), '[G] une autre proposition partie entre-temps arrete la reservation de la demande', vu(autreProposition));

    // Les mails d un client.
    const TEXTE = 'Bonjour Léa,\n\nVotre piste est prête pour demain à 18 h.\n\nÀ demain !';
    const mail = await carte('ecrire_ou_repondre_mail', { reservation: 101, objet: 'Votre venue demain', texte: TEXTE }, ['Écris à Léa pour lui confirmer sa piste']);
    ok(mail.p && ligne(mail, 'À').valeur === 'Léa Martin <lea@exemple.be>' && ligne(mail, 'Texte').long === TEXTE && ligne(mail, 'De').valeur === 'Fun Galaxy Libramont <contact@fungalaxy.be>' && /lea@exemple\.be reçoit ce mail/.test(mail.p.resume.clients),
      '[G] un mail montre son destinataire et son texte entier', vu(mail));
    const mailSansMots = await carte('ecrire_ou_repondre_mail', { reservation: 101, objet: 'Promo', texte: 'Bonjour' }, ['Résume-moi la journée']);
    ok(mail.p && mail.p.risque === true && mailSansMots.e && mailSansMots.e.statusCode === 403, '[G] un mail ne nait que des mots de la personne', JSON.stringify([mail.p && mail.p.risque, mailSansMots.e && mailSansMots.e.message]));
    const cle = mail.p ? mail.p.action.params.tentative : '';
    const clicMail = await clic('ecrire_ou_repondre_mail', mail.p ? mail.p.action.params : {});
    const clicMail2 = await clic('ecrire_ou_repondre_mail', mail.p ? mail.p.action.params : {});
    ok(/^assistant-[0-9a-f-]{36}$/.test(cle) && clicMail.r && clicMail.r.corps.attemptId === cle && clicMail2.r && clicMail2.r.corps.attemptId === cle && clicMail.r.corps.to === 'lea@exemple.be' && clicMail.r.corps.body === TEXTE && clicMail.r.corps.identityId === 7,
      '[G] la cle de tentative posee sur la carte repart au clic', JSON.stringify([cle, vu(clicMail)]));
    const reponse = await carte('ecrire_ou_repondre_mail', { conversation: 41, texte: 'Bonjour Paul,\n\nC’est noté pour samedi.' }, ['Réponds à Paul que c’est noté']);
    const variable = await carte('ecrire_ou_repondre_mail', { a: 'nouveau@exemple.be', objet: 'Bonjour', texte: 'Bonjour {{prenom}}' }, ['Envoie-lui un mail']);
    const deux = await carte('ecrire_ou_repondre_mail', { reservation: 101, a: 'x@exemple.be', objet: 'x', texte: 'x' }, ['Envoie un mail']);
    const filAilleurs = await carte('ecrire_ou_repondre_mail', { conversation: 42, texte: 'x' }, ['Réponds-lui']);
    const clicReponse = await clic('ecrire_ou_repondre_mail', reponse.p ? reponse.p.action.params : {});
    ok(reponse.p && ligne(reponse, 'Objet').valeur === 'Re: Anniversaire samedi' && clicReponse.r && clicReponse.r.corps.replyToCommunicationId === 902 && clicReponse.r.corps.threadId === 41 && clicReponse.r.corps.to === 'paul@exemple.be'
      && variable.e && /sans variable/.test(variable.e.message) && deux.e && /une seule des trois/.test(deux.e.message) && filAilleurs.e && filAilleurs.e.statusCode === 404,
      '[G] une reponse part dans sa conversation, au dernier message recu ; une variable ou deux destinataires se refusent', JSON.stringify([vu(reponse), vu(clicReponse), variable.e && variable.e.message]));
    b.reservations[0].email = 'autre@exemple.be';
    const adresseChangee = await clic('ecrire_ou_repondre_mail', mail.p ? mail.p.action.params : {});
    b.reservations[0].email = 'lea@exemple.be';
    ok(adresseChangee.e && adresseChangee.e.statusCode === 409 && /adresse du client a changé/.test(adresseChangee.e.message), '[G] une adresse changee entre la carte et le clic arrete l envoi', vu(adresseChangee));

    // La relance de la page Clients et le SMS de la fiche : la cle de la tentative nait sur la carte.
    const RELANCE = 'Bonjour Léa,\n\nCela fait un moment ! Une piste vous attend cette semaine.\n\nÀ bientôt';
    const relance = await carte('relancer_client', { reservation: 101, motif: 'dormant', objet: 'Une piste vous attend', texte: RELANCE }, ['Relance Léa, elle ne vient plus']);
    const relanceSansMots = await carte('relancer_client', { reservation: 101, objet: 'x', texte: 'x' }, ['Combien de clients dormants ?']);
    const relanceVariable = await carte('relancer_client', { reservation: 101, objet: 'Bonjour', texte: 'Bonjour {{prenom}}' }, ['Relance-la']);
    const relanceRetire = await carte('relancer_client', { reservation: 109, objet: 'Revenez', texte: 'Bonjour Paul' }, ['Relance Paul']);
    ok(relance.p && relance.p.risque === true && relance.p.vue.danger === true && ligne(relance, 'À').valeur === 'Léa Martin <lea@exemple.be>' && ligne(relance, 'Texte').long === RELANCE && ligne(relance, 'Motif').valeur === 'Client dormant' && /lea@exemple\.be reçoit cette relance/.test(relance.p.resume.clients)
      && relanceSansMots.e && relanceSansMots.e.statusCode === 403 && relanceVariable.e && /sans variable/.test(relanceVariable.e.message) && relanceRetire.p && /retiré des mails marketing/.test(relanceRetire.p.resume.alerte || ''),
      '[G] une relance montre son destinataire et son texte entier, et dit un client retire des mails marketing', JSON.stringify([vu(relance), relanceSansMots.e && relanceSansMots.e.message, vu(relanceRetire)]));
    const cleRelance = relance.p ? relance.p.action.params.tentative : '';
    const clicRelance = await clic('relancer_client', relance.p ? relance.p.action.params : {});
    const clicRelance2 = await clic('relancer_client', relance.p ? relance.p.action.params : {});
    ok(/^assistant-[0-9a-f-]{36}$/.test(cleRelance) && clicRelance.r && clicRelance.r.action === 'sendClientRelance' && clicRelance.r.corps.attemptId === cleRelance && clicRelance2.r && clicRelance2.r.corps.attemptId === cleRelance && clicRelance.r.corps.email === 'lea@exemple.be' && clicRelance.r.corps.reason === 'dormant' && clicRelance.r.corps.body === RELANCE,
      '[G] la cle d une relance posee sur la carte repart a chaque clic', JSON.stringify([cleRelance, vu(clicRelance)]));
    b.reservations[0].email = 'autre@exemple.be';
    const relanceAdresse = await clic('relancer_client', relance.p ? relance.p.action.params : {});
    b.reservations[0].email = 'lea@exemple.be';
    ok(relanceAdresse.e && relanceAdresse.e.statusCode === 409 && /redemandez la relance/.test(relanceAdresse.e.message), '[G] une adresse changee entre la carte et le clic arrete la relance', vu(relanceAdresse));
    const SMS = 'Bonjour Léa, votre piste est prête pour demain à 18 h. À demain !';
    const TWILIO = { TWILIO_ACCOUNT_SID: 'banc', TWILIO_AUTH_TOKEN: 'banc', TWILIO_FROM: '+3200000000' };
    const twilioAvant = Object.fromEntries(Object.keys(TWILIO).map((k) => [k, process.env[k]]));
    Object.keys(TWILIO).forEach((k) => { delete process.env[k]; });
    const smsSansCompte = await carte('sms_client', { reservation: 101, texte: SMS }, ['Envoie-lui un SMS']);
    ok(smsSansCompte.e && smsSansCompte.e.statusCode === 409 && /pas encore activé/.test(smsSansCompte.e.message), '[G] un SMS se refuse tant que le centre n a pas de compte SMS', vu(smsSansCompte));
    Object.assign(process.env, TWILIO);
    try {
      const sms = await carte('sms_client', { reservation: 101, texte: SMS }, ['Envoie-lui un SMS pour dire que la piste est prête']);
      const smsLong = await carte('sms_client', { reservation: 101, texte: 'x'.repeat(481) }, ['Envoie-lui un SMS']);
      const smsSansMots = await carte('sms_client', { reservation: 101, texte: SMS }, ['Combien de SMS ce mois-ci ?']);
      b.reservations[0].phone = '';
      const smsSansNumero = await carte('sms_client', { reservation: 101, texte: SMS }, ['Envoie-lui un SMS']);
      b.reservations[0].phone = '+32 470 11 22 33';
      ok(sms.p && sms.p.risque === true && sms.p.vue.danger === true && ligne(sms, 'À').valeur === 'Léa Martin, +32470112233' && ligne(sms, 'SMS').long === SMS && /\+32470112233 reçoit ce SMS/.test(sms.p.resume.clients)
        && smsLong.e && /480 caractères au plus/.test(smsLong.e.message) && smsSansMots.e && smsSansMots.e.statusCode === 403 && smsSansNumero.e && /pas de numéro/.test(smsSansNumero.e.message),
        '[G] un SMS montre le numero et le texte entier, dans la longueur du canal', JSON.stringify([vu(sms), smsLong.e && smsLong.e.message, smsSansNumero.e && smsSansNumero.e.message]));
      const clicSms = await clic('sms_client', sms.p ? sms.p.action.params : {});
      const clicSms2 = await clic('sms_client', sms.p ? sms.p.action.params : {});
      const cleSms = sms.p ? sms.p.action.params.tentative : '';
      ok(/^assistant-[0-9a-f-]{36}$/.test(cleSms) && clicSms.r && clicSms.r.action === 'clientMessageSend' && JSON.stringify(clicSms.r.corps) === JSON.stringify({ reservationId: 101, channel: 'sms', templateId: 'custom', subject: '', body: SMS, attemptId: cleSms }) && clicSms2.r && clicSms2.r.corps.attemptId === cleSms,
        '[G] la cle d un SMS posee sur la carte repart a chaque clic', JSON.stringify([cleSms, vu(clicSms)]));
    } finally {
      Object.entries(twilioAvant).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
    }
    const terminer = await carte('terminer_rouvrir_conversation', { conversation: 41, statut: 'terminée' }, []);
    const dejaOuverte = await carte('terminer_rouvrir_conversation', { conversation: 41, statut: 'ouverte' }, []);
    ok(terminer.p && terminer.p.risque === false && ligne(terminer, 'État').apres === 'terminée' && JSON.stringify((await clic('terminer_rouvrir_conversation', { conversation: 41, statut: 'terminee' })).r.corps) === JSON.stringify({ threadId: 41, status: 'closed' }) && dejaOuverte.e && /déjà ouverte/.test(dejaOuverte.e.message),
      '[G] terminer une conversation se propose sans risque ; deja ouverte se refuse', JSON.stringify([vu(terminer), dejaOuverte.e && dejaOuverte.e.message]));
    const exclure = await carte('exclure_adresse_mails', { email: 'Nouveau@Exemple.be', raison: 'demandé au téléphone' }, []);
    const dejaExclue = await carte('exclure_adresse_mails', { email: 'parti@exemple.be' }, []);
    ok(exclure.p && exclure.p.risque === false && JSON.stringify((await clic('exclure_adresse_mails', { email: 'Nouveau@Exemple.be', raison: 'demandé au téléphone' })).r.corps) === JSON.stringify({ email: 'nouveau@exemple.be', reason: 'demandé au téléphone' }) && dejaExclue.e && /déjà retirée/.test(dejaExclue.e.message),
      '[G] retirer une adresse des mails marketing se propose sans risque ; deja retiree se refuse', JSON.stringify([vu(exclure), dejaExclue.e && dejaExclue.e.message]));
    const reinscrire = await carte('reinscrire_adresse_mails', { email: 'parti@exemple.be' }, ['Il m’a redemandé au téléphone, réinscris-le']);
    const reinscrireSansMots = await carte('reinscrire_adresse_mails', { email: 'parti@exemple.be' }, ['Combien de clients se sont désinscrits ce mois-ci ?']);
    const pasRetiree = await carte('reinscrire_adresse_mails', { email: 'inconnu@exemple.be' }, ['Réinscris-le']);
    ok(reinscrire.p && reinscrire.p.risque === true && reinscrire.p.vue.danger === true && /retiré lui-même/.test(reinscrire.p.resume.alerte) && reinscrireSansMots.e && reinscrireSansMots.e.statusCode === 403 && pasRetiree.e && /n’est pas dans la liste/.test(pasRetiree.e.message),
      '[G] reinscrire un client qui s est retire lui-meme est dangereux et le dit', JSON.stringify([vu(reinscrire), reinscrireSansMots.e && reinscrireSansMots.e.message]));

    // Les reglages des mails.
    const apparence = await carte('apparence_des_mails', { gabarit: 'classique', formule: 'Rendez-vous sur les pistes !' }, ['Change la signature et le gabarit des mails']);
    const couleur = await carte('apparence_des_mails', { couleur: 'rose' }, ['Change la couleur des mails']);
    const clicApparence = await clic('apparence_des_mails', { gabarit: 'classique', formule: 'Rendez-vous sur les pistes !' });
    ok(apparence.p && apparence.p.risque === true && ligne(apparence, 'Gabarit').apres === 'Classique' && ligne(apparence, 'Formule de fin').avant === 'Funement vôtre,' && clicApparence.r && clicApparence.r.corps.design.preset === 'classique' && clicApparence.r.corps.design.signature.closing === 'Rendez-vous sur les pistes !' && clicApparence.r.corps.design.footer && couleur.e && /#rrggbb/.test(couleur.e.message),
      '[G] l apparence des mails part entiere, avec ce qui change seulement', JSON.stringify([vu(apparence), couleur.e && couleur.e.message]));
    const repType = await carte('reponse_type_agent', { sujet: 'prix', texte: 'Bonjour, nos formules commencent à 18 € par personne.' }, ['Change la réponse type sur les prix']);
    const reinit = await clic('reponse_type_agent', { sujet: 'prix', reinitialiser: 'oui' });
    const dejaLogiciel = await carte('reponse_type_agent', { sujet: 'horaires', reinitialiser: 'oui' }, ['Remets la réponse des horaires par défaut']);
    ok(repType.p && repType.p.risque === true && reinit.r && reinit.r.corps.faq.prix === null && dejaLogiciel.e && /déjà celle du logiciel/.test(dejaLogiciel.e.message) && JSON.stringify((await clic('reponse_type_agent', { sujet: 'prix', texte: 'Bonjour, nos formules commencent à 18 € par personne.' })).r.corps) === JSON.stringify({ faq: { prix: { subject: 'Nos prix', body: 'Bonjour, nos formules commencent à 18 € par personne.' } } }),
      '[G] une reponse type de l agent se change ou se remet, sur son seul sujet', JSON.stringify([vu(repType), dejaLogiciel.e && dejaLogiciel.e.message]));
    const expediteur = await carte('expediteur_mails', { nom: 'Réservations', email: 'resa@fungalaxy.be' }, []);
    const defaut = await carte('expediteur_mails', { expediteur: 'anniv', par_defaut: 'oui' }, ['Mets l’adresse anniversaires par défaut']);
    const doublon = await carte('expediteur_mails', { nom: 'Copie', email: 'contact@fungalaxy.be' }, []);
    ok(expediteur.p && expediteur.p.risque === false && JSON.stringify((await clic('expediteur_mails', { nom: 'Réservations', email: 'resa@fungalaxy.be' })).r.corps) === JSON.stringify({ label: 'Réservations', email: 'resa@fungalaxy.be', isDefault: false }) && defaut.p && defaut.p.risque === true && doublon.e && /déjà une adresse/.test(doublon.e.message),
      '[G] une adresse d expedition s ajoute sans risque ; la mettre par defaut est risque', JSON.stringify([vu(expediteur), vu(defaut), doublon.e && doublon.e.message]));
    const supprExp = await carte('supprimer_expediteur_mails', { expediteur: 'anniv@fungalaxy.be' }, ['Supprime l’adresse anniversaires']);
    ok(supprExp.p && supprExp.p.risque === true && supprExp.p.vue.danger === true && JSON.stringify((await clic('supprimer_expediteur_mails', { expediteur: 'anniv@fungalaxy.be' })).r.corps) === JSON.stringify({ id: 8 }), '[G] supprimer une adresse d expedition est dangereux et vise la bonne', vu(supprExp));

    // Le planning.
    const maintenance = await carte('piste_en_maintenance', { piste: 3, etat: 'maintenance', du: b.J, au: b.demain, motif: 'pin-setter' }, ['La piste 3 est en panne, mets-la en maintenance']);
    const horsPistes = await carte('piste_en_maintenance', { piste: 9, etat: 'maintenance' }, ['Ferme la piste 9']);
    const rouvrir = await carte('piste_en_maintenance', { piste: 5, etat: 'ouverte' }, []);
    const dejaOuvertePiste = await carte('piste_en_maintenance', { piste: 4, etat: 'ouverte' }, []);
    const clicPiste = await clic('piste_en_maintenance', { piste: 3, etat: 'maintenance', du: b.J, au: b.demain, motif: 'pin-setter' });
    ok(maintenance.p && maintenance.p.risque === true && /1 réservation d’aujourd’hui est sur cette piste \(18:00\)/.test(maintenance.p.resume.alerte) && horsPistes.e && /entre 1 et 8/.test(horsPistes.e.message) && rouvrir.p && rouvrir.p.risque === false && dejaOuvertePiste.e && /déjà ouverte/.test(dejaOuvertePiste.e.message)
      && clicPiste.r && clicPiste.r.endpoint === 'staff-lanes' && JSON.stringify(clicPiste.r.corps) === JSON.stringify({ lane: 3, status: 'maintenance', maintenanceFrom: b.J, maintenanceUntil: b.demain, note: 'pin-setter' }),
      '[G] une piste en maintenance dit les groupes du jour qui y sont ; la rouvrir est sans risque', JSON.stringify([vu(maintenance), horsPistes.e && horsPistes.e.message, vu(clicPiste)]));
    const retard = await carte('decaler_pour_retard', { reservation: 107, minutes: 15 }, ['Le groupe A a 15 minutes de retard']);
    const pasAujourdhui = await carte('decaler_pour_retard', { reservation: 101, minutes: 15 }, ['Elle aura du retard']);
    ok(retard.p && retard.p.risque === true && ligne(retard, 'Heure').apres === '18:15' && ligne(retard, 'Groupe B').apres === '19:15, pistes 1' && retard.p.action.params.strategie === 'cascade' && /^[0-9a-f]{16}$/.test(retard.p.action.params.plan_vu || '') && pasAujourdhui.e && /le jour même/.test(pasAujourdhui.e.message),
      '[G] un retard montre le plan du logiciel, groupe par groupe, et le fige sur la carte', JSON.stringify([vu(retard), pasAujourdhui.e && pasAujourdhui.e.message]));
    const clicRetard = await clic('decaler_pour_retard', retard.p ? retard.p.action.params : {});
    ok(clicRetard.r && clicRetard.r.action === 'delayApply' && JSON.stringify(clicRetard.r.corps) === JSON.stringify({ reservationId: 107, delayMinutes: 15, reasonId: 'late_customer', strategyId: 'cascade' }), '[G] au clic, le retard part avec la strategie de la carte', vu(clicRetard));
    b.retardB = '19:20';
    const planChange = await clic('decaler_pour_retard', retard.p ? retard.p.action.params : {});
    b.retardB = '19:15';
    ok(planChange.e && planChange.e.statusCode === 409 && /a changé depuis la carte/.test(planChange.e.message), '[G] un plan de retard qui a change depuis la carte s arrete au clic', vu(planChange));
    const remettre = await carte('retirer_retard', { reservation: 106, remettre: 'oui' }, ['Annule le retard, remets-les à 18h']);
    const badge = await carte('retirer_retard', { reservation: 106 }, []);
    const sansRetard = await carte('retirer_retard', { reservation: 101 }, []);
    const clicRemettre = await clic('retirer_retard', { reservation: 106, remettre: 'oui' });
    const clicBadge = await clic('retirer_retard', { reservation: 106 });
    ok(remettre.p && remettre.p.risque === true && ligne(remettre, 'Heure').apres === '18:00' && badge.p && badge.p.risque === false && sansRetard.e && /pas de retard en cours/.test(sansRetard.e.message) && clicRemettre.r && clicRemettre.r.action === 'delayRevert' && clicBadge.r && clicBadge.r.action === 'delayClear',
      '[G] retirer un retard : le badge seul, ou l heure d origine (risque)', JSON.stringify([vu(remettre), vu(badge), clicRemettre.r && clicRemettre.r.action]));

    // Prevenir les clients d un retard : l incident du decalage, qui recoit quel texte.
    const OCm = require(path.join(ROOT, 'lib/ops-communications.js'));
    const texteDe = (id) => { const c = b.incidents[0].impact.changes.find((x) => x.reservationId === id); return OCm.buildDelayChangeMessage({ reservation: b.reservations.find((r) => r.id === id), change: c, channel: 'email' }); };
    const prevenir = await carte('prevenir_clients_du_retard', { reservation: 110 }, ['Préviens les clients du retard']);
    const prevenirSansMots = await carte('prevenir_clients_du_retard', { reservation: 110 }, ['Combien de groupes ce soir ?']);
    const sansRetardApplique = await carte('prevenir_clients_du_retard', { reservation: 101 }, ['Préviens-les']);
    const lp = ligne(prevenir, 'Groupe Retard');
    ok(prevenir.p && prevenir.p.risque === true && prevenir.p.vue.danger === true && lp.valeur === `retard@exemple.be : « ${texteDe(110).subject} »` && lp.long === `${texteDe(110).subject}\n\n${texteDe(110).body}` && /Bonjour Groupe Retard/.test(lp.long) && /pousse@exemple\.be/.test(ligne(prevenir, 'Groupe Poussé').valeur)
      && /Groupe Sans Mail, sans adresse mail/.test(prevenir.p.resume.alerte || '') && /Groupe Bougé, son heure a changé depuis le retard \(21:00\)/.test(prevenir.p.resume.alerte || '') && /Ces 2 clients reçoivent/.test(prevenir.p.resume.clients)
      && prevenirSansMots.e && prevenirSansMots.e.statusCode === 403 && sansRetardApplique.e && sansRetardApplique.e.statusCode === 404,
      '[G] prevenir les clients d un retard montre qui recoit quel texte, en entier, et qui ne recoit rien', JSON.stringify([vu(prevenir), sansRetardApplique.e && sansRetardApplique.e.message]));
    const clicPrevenir = await clic('prevenir_clients_du_retard', prevenir.p ? prevenir.p.action.params : {});
    ok(clicPrevenir.r && clicPrevenir.r.action === 'delayNotify' && clicPrevenir.r.corps.incidentId === 77 && JSON.stringify(clicPrevenir.r.corps.reservationIds) === '[110,111]' && JSON.stringify(clicPrevenir.r.corps.channels) === '["email"]'
      && clicPrevenir.r.corps.messages.length === 2 && clicPrevenir.r.corps.messages[1].body === texteDe(111).body && clicPrevenir.r.corps.messages[1].subject === texteDe(111).subject,
      '[G] au clic, les clients du retard partent avec l incident et les textes de la carte', vu(clicPrevenir));
    b.prevenus.push({ incident: 77, reservationId: 111, statut: 'sent' });
    const dejaPrevenu = await carte('prevenir_clients_du_retard', { reservation: 110 }, ['Préviens les clients du retard']);
    const horsDuRetard = await carte('prevenir_clients_du_retard', { reservation: 110, clients: '999' }, ['Préviens les clients du retard']);
    b.prevenus.length = 0;
    ok(dejaPrevenu.p && !ligne(dejaPrevenu, 'Groupe Poussé').valeur && /Groupe Poussé, déjà prévenu de ce retard/.test(dejaPrevenu.p.resume.alerte || '') && /Ce client reçoit/.test(dejaPrevenu.p.resume.clients) && horsDuRetard.e && /n’a pas été déplacée par ce retard/.test(horsDuRetard.e.message),
      '[G] un client deja prevenu de ce retard ou hors du retard ne recoit rien de plus', JSON.stringify([vu(dejaPrevenu), horsDuRetard.e && horsDuRetard.e.message]));
    b.reservations.find((r) => r.id === 110).name = 'Groupe Retard Renommé';
    const texteChange = await clic('prevenir_clients_du_retard', prevenir.p ? prevenir.p.action.params : {});
    b.reservations.find((r) => r.id === 110).name = 'Groupe Retard';
    b.incidents.push({ ...b.incidents[0], id: 78 });
    const autreRetard = await clic('prevenir_clients_du_retard', prevenir.p ? prevenir.p.action.params : {});
    b.incidents.pop();
    ok(texteChange.e && texteChange.e.statusCode === 409 && /a changé depuis la carte/.test(texteChange.e.message) && autreRetard.e && autreRetard.e.statusCode === 409 && /Un autre retard/.test(autreRetard.e.message),
      '[G] un texte ou un retard qui a change depuis la carte arrete l envoi', JSON.stringify([texteChange.e && texteChange.e.message, autreRetard.e && autreRetard.e.message]));

    // La case d une activite : la cle que la fiche lui donne, sans version, au nom de la session.
    const cocheLaser = await carte('cocher_activite_faite', { reservation: 114, activite: 'laser' }, ['Le laser de Zoé est fini']);
    const clicCoche = await clic('cocher_activite_faite', cocheLaser.p ? cocheLaser.p.action.params : {});
    const toggle = (clicCoche.r && clicCoche.r.corps && clicCoche.r.corps.activityToggle) || {};
    ok(cocheLaser.p && cocheLaser.p.risque === false && ligne(cocheLaser, 'Activité').valeur === 'Laser Game (partie 1), à 15:30' && ligne(cocheLaser, 'État').avant === 'à faire' && ligne(cocheLaser, 'État').apres === 'faite, par Seb'
      && clicCoche.r && clicCoche.r.endpoint === 'staff-reservations' && clicCoche.r.methode === 'PATCH' && JSON.stringify(Object.keys(clicCoche.r.corps)) === '["id","activityToggle"]' && clicCoche.r.corps.id === 114
      && JSON.stringify(Object.keys(toggle)) === '["key","done","doneAt","by"]' && toggle.key === 'laser_game-1' && toggle.done === true && toggle.by === 'Seb' && Math.abs(Date.parse(toggle.doneAt) - Date.now()) < 60000,
      '[G] une activite se coche par la cle que la fiche lui donne, sans version, au nom de la session', JSON.stringify([vu(cocheLaser), vu(clicCoche)]));
    const dejaCoche = await carte('cocher_activite_faite', { reservation: 114, activite: 'bowling' }, ['Coche le bowling']);
    const decocher = await carte('cocher_activite_faite', { reservation: 114, activite: 'Bowling', fait: 'non' }, ['Décoche le bowling']);
    const clicDecoche = await clic('cocher_activite_faite', decocher.p ? decocher.p.action.params : {});
    const cruches = await carte('cocher_activite_faite', { reservation: 114, activite: 'les cruches' }, ['Les cruches sont servies']);
    const horsProgramme = await carte('cocher_activite_faite', { reservation: 114, activite: 'karting' }, ['Coche le karting']);
    ok(dejaCoche.e && /déjà cochée/.test(dejaCoche.e.message) && clicDecoche.r && JSON.stringify(clicDecoche.r.corps.activityToggle) === '{"key":"bowling-1","done":false,"doneAt":"","by":""}' && ligne(decocher, 'État').apres === 'à faire'
      && cruches.p && /^Boissons, à leur rythme$/.test(ligne(cruches, 'Activité').valeur) && cruches.p.action.params.cle === 'service_drinks-1'
      && horsProgramme.e && /n’est pas au programme/.test(horsProgramme.e.message) && /Arcades, à 16:00/.test(horsProgramme.e.message),
      '[G] cocher ce qui est deja coche se refuse, decocher retire la coche, une activite hors programme se refuse', JSON.stringify([dejaCoche.e && dejaCoche.e.message, vu(clicDecoche), vu(cruches), horsProgramme.e && horsProgramme.e.message]));
    const laserSansPartie = await carte('cocher_activite_faite', { reservation: 115, activite: 'laser' }, ['Le laser de Tom est fini']);
    const partieDeux = await carte('cocher_activite_faite', { reservation: 115, activite: 'laser', partie: 2 }, ['La partie 2 de Tom est finie']);
    ok(laserSansPartie.e && /revient 3 fois/.test(laserSansPartie.e.message) && /partie 2\), heure à placer/.test(laserSansPartie.e.message) && partieDeux.p && partieDeux.p.action.params.cle === 'laser_game-2' && ligne(partieDeux, 'Activité').valeur === 'Laser Game (partie 2), heure à placer',
      '[G] une activite qui revient plusieurs fois demande sa partie', JSON.stringify([laserSansPartie.e && laserSansPartie.e.message, vu(partieDeux)]));
    const cleDuModele = await carte('cocher_activite_faite', { reservation: 114, activite: 'laser', cle: 'bowling-1' }, ['Coche le laser']);
    const cleInventee = await carte('cocher_activite_faite', { reservation: 114, activite: 'arcades', cle: 'arcade_time-9' }, ['Coche les arcades']);
    const tom = b.reservations.find((r) => r.id === 115);
    const planAvant = JSON.stringify(tom.opsPlan);
    tom.pax = 40;
    tom.program.items[0].participants = 40;
    tom.opsPlan.resourceBlocks.push(...[1, 2].map((v) => ({ activityId: 'laser_game', resourceType: 'laser_arena', startTime: v === 1 ? '18:00' : '18:30', endTime: v === 1 ? '18:25' : '18:55', countIndex: 2, groupWaveIndex: v, groupWaveCount: 2 })));
    tom.opsPlan.laserPassPlan.scheduledPasses.push({ countIndex: 2 });
    const programmeChange = await clic('cocher_activite_faite', partieDeux.p ? partieDeux.p.action.params : {});
    tom.opsPlan = JSON.parse(planAvant);
    tom.pax = 8;
    tom.program.items[0].participants = 8;
    ok(cleDuModele.e && cleDuModele.e.statusCode === 409 && cleInventee.e && cleInventee.e.statusCode === 409 && programmeChange.e && programmeChange.e.statusCode === 409 && /a changé depuis la carte/.test(programmeChange.e.message),
      '[G] une cle dite par le modele ou changee depuis la carte ne coche rien', JSON.stringify([cleDuModele.e && cleDuModele.e.message, cleInventee.e && cleInventee.e.message, vu(programmeChange)]));
    const cocheAnnulee = await carte('cocher_activite_faite', { reservation: 104, activite: 'bowling' }, ['Coche le bowling']);
    const cocheAccueil = await carte('cocher_activite_faite', { reservation: 114, activite: 'laser' }, ['Coche le laser'], ACCUEIL);
    ok(cocheAnnulee.e && /annulée/.test(cocheAnnulee.e.message) && cocheAccueil.e && cocheAccueil.e.statusCode === 403,
      '[G] un dossier annule ne se coche plus, un role sans le droit de changer un statut non plus', JSON.stringify([cocheAnnulee.e && cocheAnnulee.e.message, cocheAccueil.e && cocheAccueil.e.message]));

    // ── P. LE PROGRAMME A COCHER : la jumelle du serveur contre la fiche ──
    if (!editions.length) console.log('\n[P] le programme a cocher : la fiche et le serveur, cle par cle');
    verifierProgramme(ok);

    // ── S. LE CLIC : api/ops.js ──
    if (!editions.length) console.log('\n[S] le clic : la requete exacte, la meme session, rien hors du centre');
    purger();
    const journal = { audits: [], ecrit: [], fiche: [], pistes: [] };
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
    const b2 = banc();
    // La seule requete brute qui repond : le dernier retard applique a un dossier (lecteur retardApplique).
    const faussePool = { query: async (q, p = []) => {
      const i = /from ops_delay_incidents/.test(String(q)) ? b2.incidents.filter((x) => x.centerId === p[0] && x.reservationId === Number(p[1])).slice(-1)[0] : null;
      return i ? { rows: [{ id: i.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    } };
    remplacer('lib/database.js', {
      getPool: () => faussePool,
      getDelayIncidentById: async (id) => b2.incidents.find((x) => x.id === Number(id)) || null,
      createOpsEvent: async (x) => { journal.ecrit.push(['createOpsEvent', x]); return {}; },
      getReservationById: async (id) => b2.reservations.find((r) => r.id === Number(id)) || null,
      getCustomRequest: async (id, { centerId = '' } = {}) => {
        const d = b2.demandes.find((x) => x.id === Number(id) && (!centerId || x.centerId === centerId));
        if (!d) throw Object.assign(new Error('Demande introuvable.'), { statusCode: 404, expose: true });
        return d;
      },
      appendCustomRequestSuivi: async (id, evenement, { centerId = '' } = {}) => { journal.ecrit.push(['appendCustomRequestSuivi', { id, evenement, centerId }]); return b2.demandes.find((x) => x.id === Number(id)); },
      listEmailIdentities: async () => b2.expediteurs,
      readStaffState: async () => ({ reservations: b2.pistes.reservations, laneStatuses: b2.pistes.statuts, laneMaintenance: b2.pistes.maintenance }),
    });
    remplacer('lib/ops-communications.js', {
      sendDirectEmail: async (x) => { journal.ecrit.push(['sendDirectEmail', x]); return { communication: { id: 5000, status: 'queued' }, attemptId: x.attemptId }; },
      sendClientRelance: async (x) => { journal.ecrit.push(['sendClientRelance', x]); return { communication: { id: 5001, status: 'queued' } }; },
      sendClientMessage: async (x) => { journal.ecrit.push(['sendClientMessage', x]); return { communication: { id: 5002, status: 'queued', channel: x.channel }, dispatched: null }; },
      enqueueDelayChangeCommunications: async (x) => { journal.ecrit.push(['enqueueDelayChangeCommunications', x]); return [{ id: 6000 + x.reservation.id, channel: 'email', status: 'queued' }]; },
      dispatchDueCommunications: async () => ({ sent: 0 }),
    });
    remplacer('lib/marketing-suppression.js', { listSuppressions: async () => ({ entries: b2.suppressions }), suppressEmail: async (x) => { journal.ecrit.push(['suppressEmail', x]); return { suppressed: true }; }, removeSuppression: async (x) => { journal.ecrit.push(['removeSuppression', x]); return { removed: true }; } });
    remplacer('lib/demande-bureau-centre.js', {
      reserverLaDemande: async (item, deps, o) => {
        journal.ecrit.push(['reserverLaDemande', { id: item.id, simuler: o.simuler, proposition: o.proposition }]);
        const resume = { date: o.proposition.date, heure: o.proposition.heure, fin: '16:00', nom: o.proposition.nom, joueurs: o.proposition.joueurs, prix: 240, pistes: [1, 2], conflits: [], refus: '', email: item.email, extras: [] };
        return o.simuler ? { simulation: true, resume } : { simulation: false, resume, reservation: { id: 777, date: o.proposition.date, startTime: o.proposition.heure, pax: o.proposition.joueurs, price: 240 }, confirmation: true, demande: null };
      },
      enrichirDemandes: async (liste) => liste,
    });
    const ops = require(path.join(ROOT, OPS));
    const Gs = require(path.join(ROOT, GESTES));
    const entetes = { authorization: 'Bearer jeton-du-poste' };
    const cliquer = (geste, params) => appeler(ops, { action: 'assistantGeste', centerId: 'libramont', geste, params }, entetes);
    const retourFiche = doublerAdresse('api/staff-reservations.js', journal.fiche);
    const retourPistes = doublerAdresse('api/staff-lanes.js', journal.pistes);
    try {
      const statut = await cliquer('statut_reservation', { reservation: 101, statut: 'arrive' });
      const vuFiche = journal.fiche[0] || {};
      ok(statut.statut === 200 && journal.fiche.length === 1 && vuFiche.methode === 'PATCH' && vuFiche.url === '/api/staff-reservations' && vuFiche.auth === 'Bearer jeton-du-poste'
        && JSON.stringify(vuFiche.corps) === JSON.stringify({ id: 101, baseUpdatedAt: '2026-11-10T10:00:00.000Z', status: 'arrived', centerId: 'libramont' }),
        '[S] le statut part a la fiche, avec la version et la session', JSON.stringify([statut.statut, journal.fiche]).slice(0, 300));
      ok(journal.audits.some((a) => a && a.action === 'assistantGeste' && JSON.stringify(a).includes('statut_reservation') && JSON.stringify(a).includes('staff-reservations')), '[S] le journal d audit dit le geste et l adresse', JSON.stringify(journal.audits.map((a) => [a.action, a.changes])).slice(0, 300));
      journal.fiche.length = 0;
      const suppr = await cliquer('supprimer_reservation', { reservation: 101, raison: 'doublon' });
      ok(suppr.statut === 200 && journal.fiche.length === 1 && journal.fiche[0].methode === 'DELETE' && JSON.stringify(journal.fiche[0].corps) === JSON.stringify({ id: 101, reason: 'doublon', centerId: 'libramont' }) && journal.fiche[0].auth === 'Bearer jeton-du-poste',
        '[S] la suppression part en DELETE a la fiche, avec sa raison', JSON.stringify(journal.fiche).slice(0, 300));
      const piste = await cliquer('piste_en_maintenance', { piste: 3, etat: 'maintenance', motif: 'pin-setter' });
      ok(piste.statut === 200 && journal.pistes.length === 1 && journal.pistes[0].methode === 'PATCH' && journal.pistes[0].url === '/api/staff-lanes'
        && JSON.stringify(journal.pistes[0].corps) === JSON.stringify({ lane: 3, status: 'maintenance', maintenanceFrom: '', maintenanceUntil: '', note: 'pin-setter', centerId: 'libramont' }),
        '[S] une piste part en maintenance par sa propre adresse', JSON.stringify([piste.statut, journal.pistes]).slice(0, 300));
      const carteMail = await Gs.proposer('ecrire_ou_repondre_mail', { reservation: 101, objet: 'Votre venue', texte: 'Bonjour Léa, à demain.' }, Gs.contexte({ centre: 'libramont', session: DIRECTION, messagesPersonne: ['Écris à Léa'] }));
      const m1 = await cliquer('ecrire_ou_repondre_mail', carteMail.action.params);
      const m2 = await cliquer('ecrire_ou_repondre_mail', carteMail.action.params);
      const envois = journal.ecrit.filter((e) => e[0] === 'sendDirectEmail').map((e) => e[1]);
      ok(m1.statut === 200 && m2.statut === 200 && envois.length === 2 && envois.every((x) => x.attemptId === carteMail.action.params.tentative && x.to === 'lea@exemple.be' && x.centerId === 'libramont' && x.body === 'Bonjour Léa, à demain.' && x.identityId === 7),
        '[S] deux clics sur la carte d un mail portent la meme cle de tentative, au destinataire du dossier', JSON.stringify([m1.statut, m2.statut, envois]).slice(0, 300));
      const carteRelance = await Gs.proposer('relancer_client', { reservation: 101, objet: 'Une piste vous attend', texte: 'Bonjour Léa, revenez nous voir.' }, Gs.contexte({ centre: 'libramont', session: DIRECTION, messagesPersonne: ['Relance Léa'] }));
      const rl1 = await cliquer('relancer_client', carteRelance.action.params);
      const rl2 = await cliquer('relancer_client', carteRelance.action.params);
      const relances = journal.ecrit.filter((e) => e[0] === 'sendClientRelance').map((e) => e[1]);
      ok(rl1.statut === 200 && rl2.statut === 200 && relances.length === 2 && relances.every((x) => x.attemptId === carteRelance.action.params.tentative && x.email === 'lea@exemple.be' && x.centerId === 'libramont' && x.body === 'Bonjour Léa, revenez nous voir.' && x.reason === 'custom' && x.staffMember === 'Seb'),
        '[S] deux clics sur une relance partent par l action du logiciel avec la meme cle, au client du dossier', JSON.stringify([rl1.statut, rl2.statut, relances]).slice(0, 300));
      const twilioAvantS = { TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN, TWILIO_FROM: process.env.TWILIO_FROM };
      Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'banc', TWILIO_AUTH_TOKEN: 'banc', TWILIO_FROM: '+3200000000' });
      try {
        const carteSms = await Gs.proposer('sms_client', { reservation: 101, texte: 'Votre piste est prête.' }, Gs.contexte({ centre: 'libramont', session: DIRECTION, messagesPersonne: ['Envoie-lui un SMS'] }));
        const s1 = await cliquer('sms_client', carteSms.action.params);
        const smsEnvoyes = journal.ecrit.filter((e) => e[0] === 'sendClientMessage').map((e) => e[1]);
        ok(s1.statut === 200 && smsEnvoyes.length === 1 && smsEnvoyes[0].channel === 'sms' && smsEnvoyes[0].attemptId === carteSms.action.params.tentative && smsEnvoyes[0].reservation.id === 101 && smsEnvoyes[0].body === 'Votre piste est prête.' && smsEnvoyes[0].centerId === 'libramont',
          '[S] un SMS part par l action du logiciel, sur le canal sms, avec la cle de la carte', JSON.stringify([s1.statut, s1.json, smsEnvoyes]).slice(0, 300));
      } finally {
        Object.entries(twilioAvantS).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
      }
      const carteCoche = await Gs.proposer('cocher_activite_faite', { reservation: 114, activite: 'laser' }, Gs.contexte({ centre: 'libramont', session: DIRECTION, messagesPersonne: ['Le laser de Zoé est fini'] }));
      journal.fiche.length = 0;
      const co = await cliquer('cocher_activite_faite', carteCoche.action.params);
      const vuCoche = journal.fiche[0] || {};
      ok(co.statut === 200 && journal.fiche.length === 1 && vuCoche.methode === 'PATCH' && vuCoche.url === '/api/staff-reservations' && vuCoche.auth === 'Bearer jeton-du-poste'
        && JSON.stringify(Object.keys(vuCoche.corps)) === '["id","activityToggle","centerId"]' && vuCoche.corps.id === 114 && vuCoche.corps.centerId === 'libramont' && vuCoche.corps.activityToggle.key === 'laser_game-1' && vuCoche.corps.activityToggle.done === true && vuCoche.corps.activityToggle.by === 'Seb',
        '[S] la coche part a la fiche, une cle sans version, avec la session', JSON.stringify([co.statut, journal.fiche]).slice(0, 300));
      journal.fiche.length = 0;
      const carteRetard = await Gs.proposer('prevenir_clients_du_retard', { reservation: 110 }, Gs.contexte({ centre: 'libramont', session: DIRECTION, messagesPersonne: ['Préviens les clients du retard'] }));
      const pr = await cliquer('prevenir_clients_du_retard', carteRetard.action.params);
      const prevenus = journal.ecrit.filter((e) => e[0] === 'enqueueDelayChangeCommunications').map((e) => e[1]);
      const texteVu = (id) => { const l = carteRetard.resume.lignes.find((x) => x.libelle === b2.reservations.find((r) => r.id === id).name) || {}; return String(l.long || ''); };
      ok(pr.statut === 200 && pr.json.incidentId === 77 && prevenus.length === 2 && prevenus.map((x) => x.reservation.id).join(',') === '110,111' && prevenus.every((x) => x.incidentId === 77 && JSON.stringify(x.channels) === '["email"]' && x.override && `${x.override.subject}\n\n${x.override.body}` === texteVu(x.reservation.id) && x.change && x.change.reservationId === x.reservation.id),
        '[S] les clients du retard sont prevenus par l action du logiciel, avec les textes de la carte', JSON.stringify([pr.statut, pr.json, prevenus.map((x) => [x.reservation.id, x.incidentId, x.override])]).slice(0, 300));
      const carteDemande = await Gs.proposer('reserver_la_demande', { demande: 31 }, Gs.contexte({ centre: 'libramont', session: DIRECTION, messagesPersonne: ['Elle a dit oui, réserve'] }));
      const resa = await cliquer('reserver_la_demande', carteDemande.action.params);
      const creations = journal.ecrit.filter((e) => e[0] === 'reserverLaDemande' && e[1].simuler === false);
      ok(resa.statut === 200 && creations.length === 1 && creations[0][1].id === 31 && creations[0][1].proposition.heure === '14:00' && creations[0][1].proposition.joueurs === 12 && resa.json.reservation && resa.json.reservation.id === 777,
        '[S] la demande se reserve par l action du logiciel, avec la proposition envoyee au client', JSON.stringify([resa.statut, creations]).slice(0, 300));
      const noteD = await cliquer('noter_demande', { demande: 31, texte: 'Rappeler mardi' });
      const suivi = journal.ecrit.find((e) => e[0] === 'appendCustomRequestSuivi');
      ok(noteD.statut === 200 && suivi && suivi[1].id === 31 && suivi[1].centerId === 'libramont' && suivi[1].evenement.type === 'note' && suivi[1].evenement.texte === 'Rappeler mardi' && suivi[1].evenement.par === 'Seb',
        '[S] la note d une demande s ecrit au nom de la session, dans ce centre', JSON.stringify([noteD.statut, suivi]).slice(0, 300));
      const excl = await cliquer('exclure_adresse_mails', { email: 'nouveau@exemple.be', raison: 'au téléphone' });
      const retrait = journal.ecrit.find((e) => e[0] === 'suppressEmail');
      ok(excl.statut === 200 && retrait && retrait[1].centerId === 'libramont' && retrait[1].email === 'nouveau@exemple.be' && retrait[1].source === 'staff' && retrait[1].reason === 'au téléphone',
        '[S] une adresse se retire des mails marketing par l action du logiciel', JSON.stringify([excl.statut, retrait]).slice(0, 300));
      journal.fiche.length = 0;
      journal.ecrit.length = 0;
      courante = MANAGER;
      const manager = await cliquer('statut_reservation', { reservation: 101, statut: 'arrive' });
      const managerMail = await cliquer('ecrire_ou_repondre_mail', carteMail.action.params);
      courante = DIRECTION;
      ok(manager.statut === 403 && managerMail.statut === 403 && journal.fiche.length === 0 && journal.ecrit.length === 0, '[S] un Manager ne fait aucun geste de ce lot (403), rien ne s ecrit', `${manager.statut} ${managerMail.statut} ${JSON.stringify([journal.fiche, journal.ecrit]).slice(0, 200)}`);
      const autreCentre = await cliquer('statut_reservation', { reservation: 201, statut: 'arrive' });
      const autreMail = await cliquer('ecrire_ou_repondre_mail', { reservation: 201, objet: 'x', texte: 'x' });
      ok(autreCentre.statut === 404 && autreMail.statut === 404 && journal.fiche.length === 0 && journal.ecrit.length === 0, '[S] une reservation d un autre centre ne recoit rien au clic', `${autreCentre.statut} ${autreMail.statut} ${JSON.stringify(autreCentre.json)}`);
    } finally {
      retourFiche();
      retourPistes();
    }

    // ── I. UNE TENTATIVE NE PART QU UNE FOIS : la vraie lib, une base synthetique (pg double) ──
    if (!editions.length) console.log('\n[I] la relance et le message de la fiche : une cle, un seul envoi');
    await verifierTentatives(ok);
    if (!editions.length) console.log('\n[I] la coche, recue par la vraie fiche (api/staff-reservations.js)');
    await verifierLaCoche(ok, clicCoche.r ? clicCoche.r.corps : null);
  } finally {
    restaurer();
    purger();
  }
  return echecs;
}

// LA COCHE DE LA CARTE, RECUE PAR LA VRAIE FICHE : le corps que l assistant envoie (avec le centre
// qu api/ops.js ajoute) prend le chemin de la case (setReservationActivityDone, une cle sur ce qui est
// en base) et ne reecrit pas le dossier. Une version dans ce corps l enverrait au chemin « Modifier ».
async function verifierLaCoche(ok, corps) {
  purger();
  const ecrit = [];
  const dossier = { id: 114, centerId: 'libramont', date: '2026-11-20', startTime: '14:00', status: 'pending', pax: 8, lanes: [1], type: 'formule', formuleId: 'f1', updatedAt: '2026-11-10T10:00:00.000Z', activityProgress: {}, opsPlan: {} };
  remplacer('lib/database.js', {
    getPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }),
    getReservationById: async () => JSON.parse(JSON.stringify(dossier)),
    setReservationActivityDone: async (...args) => { ecrit.push(['setReservationActivityDone', args]); return { ...dossier, activityProgress: { [args[2]]: { done: true, ...args[4] } } }; },
    updateReservation: async (x) => { ecrit.push(['updateReservation', x]); return dossier; },
    setReservationActivityProgress: async (...args) => { ecrit.push(['setReservationActivityProgress', args]); return dossier; },
  });
  const session = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'm-dir', name: 'Seb' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: [] };
  remplacer('lib/staff-auth.js', { getStaffSessionFromRequest: async () => session, requireStaffPermission: async () => session });
  remplacer('lib/audit-log.js', { writeAuditLog: async () => ({}), actorFromSession: () => ({}), buildChanges: () => ({}), newRequestId: () => 'banc' });
  [['lib/ops-knowledge.js', 'refreshCenterOverrides'], ['lib/booking-config.js', 'refreshFormuleOverrides'], ['lib/catalog-store.js', 'refreshCatalog']].forEach(([f, k]) => remplacer(f, { [k]: async () => {} }));
  const fiche = require(path.join(ROOT, 'api/staff-reservations.js'));
  const req = Readable.from([Buffer.from(JSON.stringify({ ...(corps || {}), centerId: 'libramont' }))]);
  Object.assign(req, { method: 'PATCH', url: '/api/staff-reservations', headers: { host: 'localhost', 'content-type': 'application/json' } });
  const res = { statusCode: 200, corps: '', headersSent: false, setHeader() {}, getHeader() {}, writeHead(s) { this.statusCode = s; return this; }, end(b) { this.corps = String(b || ''); this.headersSent = true; } };
  try { await fiche(req, res); } catch (e) { res.statusCode = 599; res.corps = e.message; }
  const [nom, args] = ecrit[0] || [];
  ok(res.statusCode === 200 && ecrit.length === 1 && nom === 'setReservationActivityDone' && args[0] === 114 && args[1] === 'libramont' && args[2] === (corps && corps.activityToggle && corps.activityToggle.key) && args[3] === true && args[4].by === 'Seb',
    '[I] la coche de la carte prend le chemin de la case : une cle sur ce qui est en base, sans reecrire le dossier', JSON.stringify([res.statusCode, res.corps.slice(0, 120), ecrit.map((e) => e[0])]));
  purger();
}

// ── P. LE PROGRAMME A COCHER : la vraie console (assets/booking-core.js et getGroupeProgramme
// d assets/app-main.js, dans une vm) et la jumelle du serveur (lib/programme-a-cocher.js), sur la meme
// matrice de dossiers. Seuls les mots de la fiche sont doubles (noms, details, capacite affichee) :
// ils ne changent aucune cle.
let consoleDuProgramme = null;
function laConsole() {
  if (consoleDuProgramme) return consoleDuProgramme;
  const vm = require('vm');
  const c = vm.createContext({ console, state: { booking: {}, reservations: [] }, document: { getElementById: () => null } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/booking-core.js'), 'utf8'), c);
  const source = fs.readFileSync(path.join(ROOT, 'assets/app-main.js'), 'utf8').replace(/\r\n/g, '\n');
  ['getGroupeProgramme', 'getStaffResourceWindows', 'getLaserGameCountForReservation', 'getFormulaLaserGameCount', 'getStaffFormulaTimedItems', 'getEtapeAvant', 'participantsLigneProgramme', 'joindrePistes'].forEach((nom) => {
    const debut = source.indexOf(`\nfunction ${nom}(`);
    if (debut < 0) throw new Error(`console : ${nom} introuvable dans assets/app-main.js`);
    vm.runInContext(source.slice(debut, source.indexOf('\n}', debut + 1) + 2), c);
  });
  vm.runInContext("function nomActivite(item) { return item && item.activityId; } function detailLigneProgramme() { return ''; } function bowlingCapacityMessage() { return ''; }", c);
  consoleDuProgramme = { c, vm };
  return consoleDuProgramme;
}

function dossiersDuProgramme() {
  const bloc = (activityId, startTime, endTime, x = {}) => ({ activityId, resourceType: activityId === 'bowling' ? 'bowling_lane' : 'laser_arena', startTime, endTime, ...x });
  const pas = (activityId, startTime, endTime, x = {}) => ({ type: 'activity', activityId, startTime, endTime, ...x });
  const d = (famille, x) => ({ famille, r: { id: 900, centerId: 'libramont', date: '2026-11-20', startTime: '14:00', duration: 1, status: 'pending', pax: 8, lanes: [], type: 'bowling', formuleId: '', program: { items: [] }, opsPlan: {}, activityProgress: {}, ...x } });
  const laser3 = { items: [{ activityId: 'laser_game', games: 3, participants: 8 }] };
  return [
    d('bowling', { lanes: [2], program: { items: [{ activityId: 'bowling', participants: 8 }] }, opsPlan: { resourceBlocks: [bloc('bowling', '14:00', '15:00', { lanes: [2] })] }, activityProgress: { 'bowling-1': { done: true } } }),
    d('bowling', { pax: 60, lanes: [1, 2, 3, 4, 5, 6, 7, 8], opsPlan: { resourceBlocks: [bloc('bowling', '16:00', '17:00', { lanes: [1, 2, 3, 4] }), bloc('bowling', '14:00', '15:00', { lanes: [5, 6, 7, 8] })] }, activityProgress: { 'bowling-g2': { done: true } } }),
    d('bowling', { lanes: [3], duration: 2 }),
    d('laser', { type: 'laser', program: laser3, opsPlan: { laserPassPlan: { scheduledPasses: [{ countIndex: 1 }, { countIndex: 2 }, { countIndex: 3 }] }, resourceBlocks: [1, 2, 3].map((n) => bloc('laser_game', `1${4 + n}:00`, `1${4 + n}:25`, { countIndex: n, groupWaveIndex: 1, groupWaveCount: 1 })) }, activityProgress: { 'laser_game-2': { done: true } } }),
    d('laser', { type: 'laser', program: laser3, opsPlan: { laserPassPlan: { scheduledPasses: [{ countIndex: 1 }], pendingPasses: [{ countIndex: 2 }, { countIndex: 3 }] }, resourceBlocks: [1, 2, 3].map((n) => bloc('laser_game', `1${4 + n}:00`, `1${4 + n}:25`, { countIndex: n })) } }),
    d('laser', { type: 'laser', pax: 40, program: { items: [{ activityId: 'laser_game', games: 1, participants: 40 }] }, opsPlan: { laserPassPlan: { scheduledPasses: [{ countIndex: 1 }] }, resourceBlocks: [1, 2].map((v) => bloc('laser_game', `1${4 + v}:00`, `1${4 + v}:25`, { countIndex: 1, groupWaveIndex: v, groupWaveCount: 2, players: 20 })) }, activityProgress: { 'laser_game-1-g2': { done: true } } }),
    d('laser', { type: 'laser', pax: 40, program: { items: [{ activityId: 'laser_game', games: 1, participants: 40 }] }, opsPlan: { laserPassPlan: { scheduledPasses: [{ countIndex: 1 }] }, resourceBlocks: [bloc('laser_game', '15:00', '15:25', { countIndex: 1, groupWaveIndex: 1, groupWaveCount: 2, players: 20 })] } }),
    d('laser', { type: 'formule', formuleId: 'f2', pax: 10, opsPlan: { laserManual: true, timeline: [pas('minigolf_blacklight', '14:00', '14:45')] } }),
    d('laser', { type: 'bowling', lanes: [1], program: { items: [{ activityId: 'bowling', participants: 8, planned: true }, { activityId: 'laser_game', games: 2, participants: 8, planned: true }] }, opsPlan: { laserPassPlan: { pendingPasses: [{ countIndex: 1 }, { countIndex: 2 }] }, resourceBlocks: [bloc('bowling', '14:00', '15:00', { lanes: [1] })] } }),
    d('laser', { type: 'bowling', lanes: [1], program: { items: [{ activityId: 'bowling', participants: 8, planned: true }, { activityId: 'laser_game', games: 2, participants: 8, planned: true, extraLaser: { games: 3, participants: 2 } }] }, opsPlan: { resourceBlocks: [bloc('bowling', '14:00', '15:00', { lanes: [1] }), bloc('laser_game', '15:30', '15:55', { countIndex: 1 }), bloc('laser_game', '16:00', '16:25', { countIndex: 2 })] } }),
    d('laser', { type: 'formule', formuleId: 'f2', pax: 10, program: { items: [{ activityId: 'laser_game', games: 2, participants: 10, planned: true }] }, opsPlan: { resourceBlocks: [bloc('laser_game', '16:00', '16:25', { countIndex: 2 })] } }),
    d('laser', { status: 'cancelled', type: 'laser', program: laser3, opsPlan: { laserPassPlan: { scheduledPasses: [{ countIndex: 1 }] }, resourceBlocks: [bloc('laser_game', '15:00', '15:25', { countIndex: 1 })] } }),
    d('estime', { type: 'laser', duration: 1, startTime: '14:10' }),
    d('estime', { type: 'laser', duration: 0.5, pax: 45, startTime: '18:00' }),
    d('estime', { type: 'formule', formuleId: 'f1', lanes: [1], startTime: '14:00', duration: 1 }),
    d('estime', { type: 'bowling', lanes: [2], program: { items: [{ activityId: 'bowling', participants: 8, planned: true }, { activityId: 'laser_game', games: 2, participants: 8, planned: true }] }, preference: { preferredLaserTime: '17:30' }, opsPlan: { resourceBlocks: [bloc('bowling', '14:00', '15:00', { lanes: [2] })] } }),
    d('formule', { type: 'formule', formuleId: 'f1', lanes: [1], opsPlan: { resourceBlocks: [bloc('bowling', '14:00', '15:00', { lanes: [1] }), bloc('laser_game', '15:30', '15:55', { countIndex: 1 })], timeline: [pas('bowling', '14:00', '15:00'), pas('laser_game', '15:30', '15:55'), pas('arcade_time', '16:00', '16:30'), pas('service_drinks', '14:00', '23:00', { flexible: true })] }, activityProgress: { 'arcade_time-1': { done: true } } }),
    d('formule', { type: 'formule', formuleId: 'f4', lanes: [1], pax: 10, program: { items: [{ activityId: 'laser_game', games: 2, participants: 10 }] }, opsPlan: { resourceBlocks: [bloc('bowling', '15:00', '16:00', { lanes: [1] }), bloc('laser_game', '16:30', '16:55', { countIndex: 1 })], timeline: [pas('minigolf_blacklight', '14:00', '14:45'), pas('bowling', '15:00', '16:00')] } }),
    d('formule', { type: 'formule', formuleId: 'f4', lanes: [1], pax: 10, opsPlan: { formulaChoice: { id: 'f4-arcades', replaces: ['laser_game'], steps: [{ activityId: 'arcade_time', count: 1, label: '60 min d’arcades' }], desc: ['Minigolf', '1h de Bowling', '60 min arcades'] }, resourceBlocks: [bloc('bowling', '15:00', '16:00', { lanes: [1] })], timeline: [pas('arcade_time', '16:00', '17:00')] } }),
    d('formule', { type: 'formule', formuleId: 'zz', opsPlan: { timeline: [pas('minigolf_blacklight', '14:00', '14:45'), pas('arcade_time', '15:00', '15:30'), pas('arcade_time', '16:00', '16:30', { countIndex: 2 })] }, activityProgress: { 'arcade_time-2': { done: true } } }),
    d('libre', { type: 'bowling', lanes: [4], program: { items: [{ activityId: 'bowling', participants: 8, planned: true }, { activityId: 'minigolf_blacklight', participants: 8, planned: false }, { activityId: 'arcade_time', participants: 8, planned: false, waitOffer: true }, { activityId: 'billards', participants: 4, planned: false, avant: true, name: 'Billard' }] }, opsPlan: { resourceBlocks: [bloc('bowling', '15:00', '16:00', { lanes: [4] })], timeline: [pas('billards', '14:00', '14:45', { flexible: false })] }, activityProgress: { 'libre-minigolf_blacklight': { done: true } } }),
    d('postes', { type: 'laser', pax: 25, program: { items: [{ activityId: 'laser_game', games: 2, participants: 25 }] }, opsPlan: { laserPassPlan: { scheduledPasses: [{ countIndex: 1 }] }, resourceBlocks: [bloc('laser_game', '15:00', '15:25', { countIndex: 1, groupWaveIndex: 1, groupWaveCount: 2 }), bloc('laser_game', '15:30', '15:55', { countIndex: 1, groupWaveIndex: 2, groupWaveCount: 2 })] }, postes: 20 }),
    d('postes', { type: 'laser', duration: 0.5, pax: 25, startTime: '18:00', postes: 20 }),
  ];
}

function verifierProgramme(ok) {
  const T = require(path.join(ROOT, 'lib/programme-a-cocher.js'));
  const { c, vm } = laConsole();
  const lu = (e) => [e.coche === undefined ? e.cle : e.coche, e.activityId, Boolean(e.fait), e.start == null ? null : Math.round(e.start * 60), e.end == null ? null : Math.round(e.end * 60), Boolean(e.aPlacer), Boolean(e.libre)].join('|');
  const ecarts = {};
  const vus = {};
  dossiersDuProgramme().forEach(({ famille, r }, i) => {
    const { postes, ...dossier } = r;
    c.dossier = JSON.parse(JSON.stringify(dossier));
    vm.runInContext(`setCenterScheduleConfig(${postes ? JSON.stringify({ resources: { laser: { weaponCount: postes } } }) : 'null'})`, c);
    const laFiche = JSON.parse(JSON.stringify(vm.runInContext('getGroupeProgramme(dossier)', c))).map(lu);
    const leServeur = T.etapesACocher(JSON.parse(JSON.stringify(dossier)), { postes, formules: vm.runInContext('FORMULES', c) }).map(lu);
    vus[famille] = (vus[famille] || 0) + laFiche.length;
    if (JSON.stringify(laFiche) !== JSON.stringify(leServeur)) (ecarts[famille] = ecarts[famille] || []).push({ dossier: i, fiche: laFiche, serveur: leServeur });
  });
  vm.runInContext('setCenterScheduleConfig(null)', c);
  const ligneP = (famille, nom) => ok(vus[famille] > 0 && !ecarts[famille], nom, JSON.stringify(ecarts[famille] || 'aucune etape lue').slice(0, 600));
  ligneP('bowling', '[P] le bowling : un bloc, deux services, ou les pistes sans plan, comme la fiche');
  ligneP('laser', '[P] le laser pose, en parties et en vagues, et les parties a placer, comme la fiche');
  ligneP('estime', '[P] le laser que la console estime faute de plan porte les memes cles');
  ligneP('formule', '[P] une formule coche ses etapes, dans la variante achetee ou d apres son plan');
  ligneP('libre', '[P] les activites libres d une visite, celles d avant le reste comprises');
  ligneP('postes', '[P] les postes de l arene du centre decoupent les vagues comme la console');
  const memes = JSON.stringify(T.__test.NOMS) === JSON.stringify(vm.runInContext('FORMULA_ACTIVITY_LABELS', c))
    && JSON.stringify(Object.entries(T.__test.ETAPES).map(([id, l]) => [id, l.map((x) => [x.a, x.c])])) === JSON.stringify(Object.entries(vm.runInContext('FORMULA_ACTIVITY_STEPS', c)).map(([id, l]) => [id, l.map((x) => [x.a, x.c])]))
    && vm.runInContext('LASER_GAME_ARENA_MINUTES', c) === require(path.join(ROOT, 'lib/booking-config.js')).LASER_GAME_ARENA_MINUTES
    && JSON.stringify(vm.runInContext('FORMULES.map((f) => [f.id, f.desc])', c)) === JSON.stringify(require(path.join(ROOT, 'lib/booking-config.js')).FORMULES.map((f) => [f.id, f.desc]));
  ok(memes, '[P] la jumelle lit les memes noms, etapes, formules et durees que la console');
}

// La table communications, telle que l insertion la traite : la cle unique, « do nothing » ou
// « do update », et la relecture de la ligne existante. Rien d autre ne repond.
async function verifierTentatives(ok) {
  purger();
  const lignes = [];
  class FauxPool {
    on() { return this; }
    async connect() { return { query: this.query.bind(this), release() {} }; }
    async query(texte, p = []) {
      const q = String(texte).trim();
      const rend = (rows) => ({ rows: JSON.parse(JSON.stringify(rows)), rowCount: rows.length });
      if (q.includes('insert into communications')) {
        const deja = p[11] ? lignes.find((l) => l.idempotency_key === p[11]) : null;
        if (deja) {
          if (q.includes('do nothing')) return rend([]);
          if (!['sent', 'delivered'].includes(deja.status)) Object.assign(deja, { recipient: p[5], subject: p[6], body: p[7], status: p[8], payload: JSON.parse(p[10]) });
          return rend([deja]);
        }
        const ligne = { id: lignes.length + 1, center_id: p[0], reservation_id: p[1], channel: p[2], direction: p[3], template_id: p[4], recipient: p[5], subject: p[6], body: p[7], status: p[8], scheduled_at: p[9], payload: JSON.parse(p[10]), idempotency_key: p[11], attempts: 0, max_attempts: 3, created_at: new Date().toISOString() };
        lignes.push(ligne);
        return rend([ligne]);
      }
      if (q.startsWith('select * from communications where idempotency_key')) return rend(lignes.filter((l) => l.idempotency_key === p[0]));
      return rend([]);
    }
  }
  const chargeur = Module._load;
  Module._load = function charger(demande, parent, principal) { return demande === 'pg' ? { Pool: FauxPool } : chargeur.call(this, demande, parent, principal); };
  const ENV = { DATABASE_URL: 'postgres://banc:banc@localhost:1/aucune', TWILIO_ACCOUNT_SID: 'banc', TWILIO_AUTH_TOKEN: 'banc', TWILIO_FROM: '+3200000000', RESEND_API_KEY: undefined };
  const avant = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.entries(ENV).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  const fetchAvant = global.fetch;
  global.fetch = async () => { throw new Error('reseau interdit au banc'); };
  try {
    const OC = require(path.join(ROOT, 'lib/ops-communications.js'));
    const relance = (x = {}) => OC.sendClientRelance({ centerId: 'libramont', email: 'lea@exemple.be', name: 'Léa Martin', phone: '+32 470 11 22 33', reason: 'dormant', subject: 'Une piste vous attend', body: 'Bonjour Léa, revenez nous voir.', staffMember: 'Seb', member: { id: 'm-dir', name: 'Seb' }, ...x }).then((r) => ({ r }), (e) => ({ e }));
    const cle = 'assistant-0b8a1d6e-2f43-4c1a-9d1e-5a7b3c9e1f20';
    const r1 = await relance({ attemptId: cle });
    const premiere = lignes[0] || {};
    premiere.status = 'failed';
    const r2 = await relance({ attemptId: cle });
    const autreTexte = await relance({ attemptId: cle, body: 'Un autre texte.' });
    ok(r1.r && r2.r && lignes.length === 1 && premiere.idempotency_key === `relance:libramont:${cle}` && premiere.payload.attemptId === cle && /^[0-9a-f]{64}$/.test(premiere.payload.attemptFingerprint || '') && premiere.status === 'failed' && r2.r.communication.id === r1.r.communication.id
      && autreTexte.e && autreTexte.e.statusCode === 409 && lignes.length === 1,
      '[I] une relance a la meme cle ne repart pas, meme apres un echec, et la meme cle sur un autre texte se refuse', JSON.stringify([lignes.map((l) => [l.idempotency_key, l.status]), r2.e && r2.e.message, autreTexte.e && autreTexte.e.message]).slice(0, 300));
    const console1 = await relance();
    const console2 = await relance();
    const sansCle = lignes.filter((l) => !l.idempotency_key);
    const cleIllisible = await relance({ attemptId: 'a b' });
    ok(console1.r && console2.r && sansCle.length === 2 && cleIllisible.e && cleIllisible.e.statusCode === 400, '[I] sans cle, la relance de la console part comme avant, et une cle illisible se refuse', JSON.stringify([sansCle.length, cleIllisible.e && cleIllisible.e.message]));
    const dossier = { id: 101, centerId: 'libramont', name: 'Léa Martin', phone: '+32 470 11 22 33', email: 'lea@exemple.be', date: '2026-12-01', startTime: '18:00', pax: 8 };
    const sms = (x = {}) => OC.sendClientMessage({ centerId: 'libramont', reservation: dossier, templateId: 'custom', channel: 'sms', subject: '', body: 'Votre piste est prête.', staffMember: 'Seb', member: { id: 'm-dir', name: 'Seb' }, ...x }).then((r) => ({ r }), (e) => ({ e }));
    const cleSms = 'assistant-7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
    const n0 = lignes.length;
    const s1 = await sms({ attemptId: cleSms });
    const ligneSms = lignes[n0] || {};
    ligneSms.status = 'failed';
    const s2 = await sms({ attemptId: cleSms });
    const s3 = await sms();
    ok(s1.r && s2.r && lignes.length === n0 + 2 && ligneSms.idempotency_key === `client:libramont:${cleSms}` && ligneSms.channel === 'sms' && ligneSms.recipient === '+32470112233' && ligneSms.status === 'failed' && s2.r.communication.id === s1.r.communication.id && s3.r && !lignes[n0 + 1].idempotency_key,
      '[I] un message de la fiche a la meme cle ne repart pas, sans cle il part comme avant', JSON.stringify([lignes.slice(n0).map((l) => [l.idempotency_key, l.channel, l.status]), s1.e && s1.e.message, s2.e && s2.e.message]).slice(0, 300));
  } finally {
    Module._load = chargeur;
    global.fetch = fetchAvant;
    Object.entries(avant).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
    purger();
  }
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
    console.log(`assistant-gestes-reservations-check --contre-preuves: ${MUTATIONS.length - manquees}/${MUTATIONS.length} mordent`);
    process.exit(manquees ? 1 : 0);
  }
  const echecs = await verifier();
  console.log(`\n${echecs.length ? `assistant-gestes-reservations-check: ${echecs.length} echec(s)` : 'assistant-gestes-reservations-check: ALL OK'}`);
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

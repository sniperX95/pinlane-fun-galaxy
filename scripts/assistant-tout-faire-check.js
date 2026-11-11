'use strict';
// TOUT FAIRE DANS LE LOGICIEL (2026-11-11, Ansar : « il doit vraiment être capable de TOUT FAIRE :
// modifier les mails, en créer, des séquences, modifier les prix des formules, absolument tout »).
// L assistant prepare chaque geste de la console en carte (lib/assistant-gestes.js) et api/ops.js
// (assistantGeste) le refait au clic avant que l action normale du logiciel n ecrive. Ce gate tient,
// sans base ni reseau (lectures et ecritures doublees, rien ne part) :
//   G. la carte : avant et apres, ce qui atteint les clients, les refus avec leur raison (nom inconnu,
//      prix hors bornes, variable de mail inconnue, droit manquant), un geste risque seulement sur les
//      mots de la personne, une sequence qui nait coupee, le volume d une campagne fige sur la carte ;
//   S. le clic : la Direction seule, l etat relu au clic, l action normale du logiciel qui ecrit avec le
//      corps que le serveur a refait (jamais celui de la carte), et la ligne du journal d audit.
// Lancement : node scripts/assistant-tout-faire-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const GESTES = 'lib/assistant-gestes.js';
const OPS = 'api/ops.js';

// Chaque garde retiree en memoire (le disque n est jamais touche) doit rougir sa ligne.
const MUTATIONS = [
  { nom: 'sans-mots-de-la-personne', rouge: '[G] un geste risque ne nait que des mots de la personne', editions: [{ fichier: GESTES, de: '  if (risque && g.demande && !(ctx.messagesPersonne', vers: '  if (false && risque && g.demande && !(ctx.messagesPersonne' }] },
  { nom: 'droit-du-geste-ignore', rouge: '[G] sans le droit du geste, aucune carte', editions: [{ fichier: GESTES, de: '  if (!sessionHasPermission(session, g.permission)) throw erreur(', vers: '  if (false) throw erreur(' }] },
  { nom: 'sequence-nee-allumee', rouge: '[G] une sequence creee nait coupee', editions: [{ fichier: GESTES, de: '        corps: { sequence: { ...sequence, enabled: false } },', vers: '        corps: { sequence: { ...sequence, enabled: true } },' }] },
  { nom: 'volume-recalcule-au-clic', rouge: '[G] le volume d une campagne vu sur la carte repart au clic', editions: [{ fichier: GESTES, de: '    prep.corps.expectedRecipients = Math.trunc(Number(p.destinataires));', vers: '' }] },
  // Vu par le lot 2 le 2026-11-11 : « merci beaucoup » contenait « coup » et debloquait un geste risque.
  { nom: 'racine-au-milieu-du-mot', rouge: '[G] une phrase de tous les jours ne debloque aucun geste risque, la demande dite oui', editions: [{ fichier: GESTES, de: 'const mots = (...racines) => new RegExp(', vers: "const mots = (...racines) => new RegExp(`(?:${racines.join('|')})`, 'iu') || new RegExp(" }] },
  // Vu par le lot 3 le 2026-11-11 : l heure dite partait sans fuseau, et le serveur la lisait en UTC.
  { nom: 'heure-lue-en-utc', rouge: '[G] une campagne programmee part a l heure de Bruxelles, hiver comme ete', editions: [{ fichier: GESTES, de: '        envoiLe = new Date(t).toISOString();', vers: '        envoiLe = quand;' }] },
  { nom: 'sans-controle-total-au-clic', rouge: '[S] un role sans le controle total ne fait aucun geste (403)', editions: [{ fichier: OPS, de: "    if (!agitAvecLAssistant(options.session)) throw createHttpError('Seules la Direction et le propriétaire font agir l’assistant.', 403, true);\n    const G = require('../lib/assistant-gestes');", vers: "    const G = require('../lib/assistant-gestes');" }] },
  // Vu au gate le 2026-11-11 : « beaucoup », vide de ses lettres, devenait un prix de 0 €.
  { nom: 'mot-devient-zero', rouge: '[S] un parametre faux ou un geste inconnu ne touche a rien', editions: [
    { fichier: GESTES, de: "typeof brut === 'boolean' || (typeof brut === 'string' && !/^-?\\d+(\\.\\d+)?$/.test(brut))) throw erreur(", vers: 'false) throw erreur(' },
    { fichier: GESTES, de: '  const v = Number(brut);', vers: "  const v = Number(String(brut).replace(/[^\\d.-]/g, ''));" },
  ] },
  { nom: 'autre-adresse-sans-session', rouge: '[S] un geste vers une autre adresse part avec la meme session, a son gestionnaire', editions: [{ fichier: OPS, de: "      sousRequete.headers = { ...req.headers, 'content-type': 'application/json' };", vers: "      sousRequete.headers = { 'content-type': 'application/json' };" }] },
  { nom: 'corps-de-la-carte', rouge: '[S] le prix part avec le corps refait par le serveur', editions: [{ fichier: OPS, de: '    await handlePost(req, res, withCenter({ ...refait.corps, action: refait.action }, centre), options);', vers: '    await handlePost(req, res, withCenter({ ...(body.params || {}), action: refait.action }, centre), options);' }] },
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

// ── Le centre du banc ──
const DIRECTION = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'm-dir', name: 'Seb' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: [] };
const MANAGER = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'm-man', name: 'Marius' }, role: { id: 'manager', name: 'Manager', locked: false }, permissions: ['pricing.manage', 'settings.manage', 'emails.send', 'emails.view', 'campaigns.manage'] };
const SANS_TARIFS = { ...MANAGER, permissions: ['emails.send', 'emails.view'] };

function banc() {
  return {
    catalogue: [
      { id: 'f-anniv', name: 'Anniversaire', priceType: 'per_pax', base: { priceValue: 18.5, priceOld: null }, effective: { name: 'Anniversaire', priceValue: 18.5, priceOld: null, enabled: true, removed: false }, centerOverride: null },
      { id: 'f-team', name: 'Team building', priceType: 'per_pax', base: { priceValue: 30, priceOld: null }, effective: { name: 'Team building', priceValue: 32, priceOld: null, enabled: true, removed: false }, centerOverride: { priceValue: 32 } },
    ],
    reglages: { reminder_48h: { enabled: true, subject: 'Votre venue chez nous', body: 'Bonjour {{prenom}}, à bientôt.' }, reactivation: { enabled: false } },
    perso: [{ id: 's-1', name: 'Relance après visite', trigger: { type: 'after_visit', days: 7 }, segment: null, subject: 'On vous attend', body: 'Bonjour {{prenom}}, revenez nous voir à {{centre}}.', cap: 20, enabled: true }],
    modeles: [{ id: 3, name: 'Promo été', category: 'promotion', subject: 'L’été est là', body: 'Bonjour {{prenom}}, profitez de l’été.' }],
    campagnes: [
      { id: 11, name: 'Rentrée', segment: 'dormant', subject: 'Revenez nous voir', body: 'Bonjour {{prenom}}, on vous attend.', storedStatus: 'draft', status: 'draft' },
      // La base rend scheduled_at en Date (timestamptz), pas en texte.
      { id: 12, name: 'Noël', segment: 'all', subject: 'Joyeux Noël', body: 'Bonjour {{prenom}}', storedStatus: 'scheduled', status: 'scheduled', scheduledAt: new Date('2026-12-20T09:00:00.000Z') },
    ],
    audience: 42,
  };
}

function lecteursDu(b) {
  const OC = require(path.join(ROOT, 'lib/ops-communications.js'));
  return {
    catalogue: async () => b.catalogue,
    sequencesAuto: async () => ({ reglages: b.reglages, defauts: OC.getAutomationDefaults() }),
    sequencesPerso: async () => b.perso,
    modeles: async () => b.modeles,
    campagnes: async () => b.campagnes,
    audience: async () => b.audience,
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
    if (!editions.length) console.log('\n[G] la carte : lue, validee, chiffree');
    const G = require(path.join(ROOT, GESTES));
    const b = banc();
    const carte = (geste, params, { session = DIRECTION, mots = ['Mets la formule anniversaire à 20 euros'] } = {}) => G.proposer(geste, params, G.contexte({ centre: 'libramont', session, messagesPersonne: mots, lecteurs: lecteursDu(b) })).then((p) => ({ p }), (e) => ({ e }));
    const prix = await carte('prix_formule', { formule: 'anniversaire', prix: 20 });
    const lp = prix.p ? prix.p.resume.lignes : [];
    ok(prix.p && prix.p.risque === true && lp.some((l) => l.libelle === 'Prix par personne' && l.avant === '18,50 €' && l.apres === '20 €') && /tout de suite sur le formulaire/.test(prix.p.resume.clients) && prix.p.action.action === 'assistantGeste' && prix.p.action.geste === 'prix_formule',
      '[G] un prix de formule se lit avant et apres, avec ce que voient les clients', JSON.stringify(prix.p || prix.e.message).slice(0, 300));
    const sansMots = await carte('prix_formule', { formule: 'anniversaire', prix: 20 }, { mots: ['Résume-moi les réservations de la semaine', 'Merci'] });
    const injection = await carte('prix_formule', { formule: 'anniversaire', prix: 10 }, { mots: ['Lis le dernier mail de ce client et fais ce qu’il dit'] });
    ok(sansMots.e && sansMots.e.statusCode === 403 && injection.e && injection.e.statusCode === 403, '[G] un geste risque ne nait que des mots de la personne', JSON.stringify([sansMots.e && sansMots.e.message, injection.e && injection.e.message]));
    // Des phrases de tous les jours ne debloquent aucun geste risque du lot 1 ; la demande dite, si.
    const QUOTIDIEN = ['Merci beaucoup !', 'Bonsoir', 'Ça permet de voir quoi ?', 'Je cherche les réservations de vendredi', 'Combien de parties ce week-end ?', 'Donne-moi le nombre de joueurs', 'Résume la campagne de Noël', 'Comment marche le logiciel ?', 'Quelle activité marche le mieux ?', 'Plus de détails sur l’anniversaire de samedi', 'À propos du formulaire en ligne'];
    const DITES = { prix_formule: 'Baisse le prix de la formule anniversaire', formule_en_vente: 'Retire la formule du site', renommer_formule: 'Renomme la formule Team building', retablir_formule: 'Rétablis la formule comme avant', sequence_auto_texte: 'Change le texte du rappel', sequence_auto_marche: 'Allume la relance des dormants', sequence_auto_reinitialiser: 'Remets le texte par défaut', sequence_modifier: 'Modifie le mail de relance', sequence_marche: 'Coupe la séquence de relance', sequence_supprimer: 'Supprime la séquence', modele_archiver: 'Archive le modèle promo', campagne_envoyer: 'Envoie la campagne de rentrée', campagne_annuler: 'Annule la campagne de Noël' };
    const fuites = [];
    Object.entries(DITES).forEach(([nom, dite]) => {
      const d = G.GESTES[nom] && G.GESTES[nom].demande;
      if (!d) { fuites.push(`${nom} sans demande`); return; }
      QUOTIDIEN.forEach((phrase) => { if (d.test(phrase)) fuites.push(`${nom} <- ${phrase}`); });
      if (!d.test(dite)) fuites.push(`${nom} ne reconnait pas « ${dite} »`);
    });
    ok(!fuites.length, '[G] une phrase de tous les jours ne debloque aucun geste risque, la demande dite oui', fuites.join(' | '));
    const inconnue = await carte('prix_formule', { formule: 'Piscine à vagues', prix: 20 });
    ok(inconnue.e && /Anniversaire/.test(inconnue.e.message) && /Team building/.test(inconnue.e.message), '[G] une formule inconnue se refuse en nommant celles du centre', inconnue.e && inconnue.e.message);
    const hors = await carte('prix_formule', { formule: 'Anniversaire', prix: 5000 });
    const pareil = await carte('prix_formule', { formule: 'Anniversaire', prix: 18.5 });
    ok(hors.e && /entre 0 et 1000/.test(hors.e.message) && pareil.e && /déjà à/.test(pareil.e.message), '[G] un prix hors bornes ou inchange se refuse', JSON.stringify([hors.e && hors.e.message, pareil.e && pareil.e.message]));
    const sansDroit = await carte('prix_formule', { formule: 'Anniversaire', prix: 20 }, { session: SANS_TARIFS });
    ok(sansDroit.e && sansDroit.e.statusCode === 403, '[G] sans le droit du geste, aucune carte', sansDroit.e ? sansDroit.e.message : 'carte rendue');
    const rappel = await carte('sequence_auto_texte', { sequence: 'Rappel avant la venue', objet: 'On vous attend {{prenom}}', texte: 'Bonjour {{prenom}}, rendez-vous le {{date}} à {{heure}} au {{centre}}.' }, { mots: ['Change le texte du rappel'] });
    const lr = rappel.p ? rappel.p.resume.lignes : [];
    ok(rappel.p && lr.some((l) => l.libelle === 'Objet' && l.avant === 'Votre venue chez nous' && l.apres === 'On vous attend {{prenom}}') && lr.some((l) => l.libelle === 'Texte' && /rendez-vous le \{\{date\}\}/.test(l.long)), '[G] le texte d un mail automatique se lit avant et apres, en entier', JSON.stringify(rappel.p || rappel.e.message).slice(0, 300));
    const variable = await carte('sequence_auto_texte', { sequence: 'Rappel avant la venue', texte: 'Bonjour {{surnom}}' }, { mots: ['Change le texte du rappel'] });
    ok(variable.e && /surnom/.test(variable.e.message), '[G] une variable de mail inconnue se refuse comme dans la page Emails', variable.e && variable.e.message);
    const allumer = await carte('sequence_auto_marche', { sequence: 'dormants', active: 'oui' }, { mots: ['Active la relance des dormants'] });
    const deja = await carte('sequence_auto_marche', { sequence: 'Rappel avant la venue', active: true }, { mots: ['Allume le rappel'] });
    ok(allumer.p && allumer.p.risque && allumer.p.resume.lignes.some((l) => l.avant === 'coupée' && l.apres === 'allumée') && deja.e && /déjà allumée/.test(deja.e.message), '[G] allumer une sequence se lit, deja allumee se refuse', JSON.stringify([allumer.p && allumer.p.texte, deja.e && deja.e.message]));
    const creer = await carte('sequence_creer', { nom: 'Relance 30 jours', declencheur: 'after_visit', jours: 30, objet: 'Ça fait un mois', texte: 'Bonjour {{prenom}}, ça fait un mois.' }, { mots: ['Crée-moi une séquence de relance un mois après la visite'] });
    ok(creer.p && creer.p.risque === false && creer.p.resume.lignes.some((l) => l.libelle === 'État' && /coupée/.test(l.valeur)), '[G] une sequence creee se propose sans risque, coupee', JSON.stringify(creer.p || creer.e.message).slice(0, 300));
    const refaitCreer = await G.refaire('sequence_creer', creer.p ? creer.p.action.params : {}, G.contexte({ centre: 'libramont', session: DIRECTION, lecteurs: lecteursDu(b) }));
    ok(refaitCreer.action === 'customSequences' && refaitCreer.corps.sequence && refaitCreer.corps.sequence.enabled === false && refaitCreer.corps.sequence.trigger.days === 30, '[G] une sequence creee nait coupee', JSON.stringify(refaitCreer.corps));
    const modifAllumee = await carte('sequence_modifier', { sequence: 'Relance après visite', objet: 'Revenez vite' }, { mots: ['Bonjour'] });
    ok(modifAllumee.e && modifAllumee.e.statusCode === 403, '[G] modifier une sequence allumee demande les mots de la personne', modifAllumee.e ? modifAllumee.e.message : 'carte rendue');
    const envoi = await carte('campagne_envoyer', { campagne: 'Rentrée' }, { mots: ['Envoie la campagne de rentrée'] });
    ok(envoi.p && envoi.p.risque && envoi.p.resume.lignes.some((l) => l.libelle === 'Destinataires' && l.valeur === '42') && envoi.p.action.params.destinataires === 42 && /42 clients reçoivent/.test(envoi.p.resume.clients), '[G] l envoi d une campagne dit ses destinataires et les fige sur la carte', JSON.stringify(envoi.p || envoi.e.message).slice(0, 300));
    const dejaPartie = await carte('campagne_envoyer', { campagne: 'Noël' }, { mots: ['Envoie Noël'] });
    const heure = await carte('campagne_envoyer', { campagne: 'Rentrée', quand: 'demain matin' }, { mots: ['Programme la campagne de rentrée'] });
    ok(dejaPartie.e && /pas un brouillon/.test(dejaPartie.e.message) && heure.e && /AAAA-MM-JJTHH:MM/.test(heure.e.message), '[G] une campagne deja programmee ou une heure floue se refuse', JSON.stringify([dejaPartie.e && dejaPartie.e.message, heure.e && heure.e.message]));
    // L heure dite est celle de Bruxelles : l an prochain en hiver (UTC+1) et en ete (UTC+2). Le matin
    // du passage a l heure d ete, 2 h 30 n existe pas ; le 31 fevrier non plus.
    const an = new Date().getUTCFullYear() + 1;
    const finMars = new Date(Date.UTC(an, 2, 31));
    finMars.setUTCDate(31 - finMars.getUTCDay());
    const programmer = (quand) => carte('campagne_envoyer', { campagne: 'Rentrée', quand }, { mots: ['Programme la campagne de rentrée'] });
    const refaireLaCarte = (vue) => (vue.p ? G.refaire('campagne_envoyer', vue.p.action.params, G.contexte({ centre: 'libramont', session: DIRECTION, lecteurs: lecteursDu(b) })) : null);
    const hiver = await programmer(`${an}-01-15T10:00`);
    const ete = await programmer(`${an}-07-01T10:00`);
    const trou = await programmer(`${finMars.toISOString().slice(0, 10)}T02:30`);
    const fevrier = await programmer(`${an}-02-31T10:00`);
    const envoiHiver = await refaireLaCarte(hiver);
    const envoiEte = await refaireLaCarte(ete);
    ok(envoiHiver && envoiHiver.corps.mode === 'schedule' && envoiHiver.corps.scheduledAt === `${an}-01-15T09:00:00.000Z` && envoiEte && envoiEte.corps.scheduledAt === `${an}-07-01T08:00:00.000Z` && /15 janvier/.test(hiver.p.texte) && /à 10 h/.test(hiver.p.texte) && trou.e && /heure de Bruxelles/.test(trou.e.message) && fevrier.e,
      '[G] une campagne programmee part a l heure de Bruxelles, hiver comme ete', JSON.stringify([envoiHiver && envoiHiver.corps, envoiEte && envoiEte.corps, hiver.p ? hiver.p.texte : hiver.e.message, trou.e && trou.e.message, fevrier.e ? fevrier.e.message : 'carte rendue']).slice(0, 400));
    const annuler = await carte('campagne_annuler', { campagne: 'Noël' }, { mots: ['Annule la campagne de Noël'] });
    ok(annuler.p && annuler.p.resume.lignes.some((l) => l.libelle === 'Prévue' && l.valeur === 'dimanche 20 décembre à 10 h'), '[G] une campagne programmee se relit a l heure de Bruxelles', JSON.stringify(annuler.p ? annuler.p.resume.lignes : annuler.e.message));
    b.audience = 40;
    const auClic = await G.refaire('campagne_envoyer', envoi.p ? envoi.p.action.params : {}, G.contexte({ centre: 'libramont', session: DIRECTION, lecteurs: lecteursDu(b) }));
    ok(auClic.action === 'sendCampaign' && auClic.corps.expectedRecipients === 42 && auClic.corps.id === 11, '[G] le volume d une campagne vu sur la carte repart au clic', JSON.stringify(auClic.corps));
    const modele = await carte('modele_ecrire', { modele: 'Promo été', objet: 'L’été arrive' }, { mots: ['Change l’objet du modèle promo été'] });
    ok(modele.p && modele.p.risque === false && modele.p.resume.lignes.length === 2 && modele.p.resume.lignes[1].libelle === 'Objet', '[G] un modele se modifie sur ce qui change seulement', JSON.stringify(modele.p || modele.e.message).slice(0, 300));
    const inconnu = await carte('equipe_codes', {}, {});
    ok(inconnu.e && /Geste inconnu/.test(inconnu.e.message), '[G] un geste hors du registre (equipe, codes) n existe pas', inconnu.e && inconnu.e.message);

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
    const b2 = banc();
    const faussePool = { query: async () => ({ rows: [], rowCount: 0 }) };
    remplacer('lib/database.js', {
      getPool: () => faussePool,
      listEmailTemplates: async () => b2.modeles,
      saveEmailTemplate: async (x) => { journal.ecrit.push(['saveEmailTemplate', x]); return { id: x.id || 99, ...x }; },
      archiveEmailTemplate: async (x) => { journal.ecrit.push(['archiveEmailTemplate', x]); return { id: x.id }; },
      listCampaigns: async () => b2.campagnes,
      createCampaignRow: async (x) => { journal.ecrit.push(['createCampaignRow', x]); return { id: 77, ...x }; },
      updateCampaignRow: async (x) => { journal.ecrit.push(['updateCampaignRow', x]); return { id: x.id, ...x }; },
    });
    remplacer('lib/catalog-overrides.js', {
      buildClientCatalog: async () => ({ formulas: b2.catalogue }),
      upsertClientFormuleOverride: async (pool, x) => { journal.ecrit.push(['upsertClientFormuleOverride', x]); return { ...x }; },
      resetClientFormuleOverride: async (pool, x) => { journal.ecrit.push(['resetClientFormuleOverride', x]); return { reset: true }; },
    });
    const OC = require(path.join(ROOT, 'lib/ops-communications.js'));
    remplacer('lib/ops-communications.js', {
      getAutomationSettings: async () => b2.reglages,
      listCustomSequences: async () => b2.perso,
      setAutomationSetting: async (centre, key, patch) => { journal.ecrit.push(['setAutomationSetting', { centre, key, patch }]); return b2.reglages; },
      saveCustomSequence: async (centre, s) => { journal.ecrit.push(['saveCustomSequence', { centre, s }]); return b2.perso; },
      toggleCustomSequence: async (centre, id, enabled) => { journal.ecrit.push(['toggleCustomSequence', { centre, id, enabled }]); return b2.perso; },
      deleteCustomSequence: async (centre, id) => { journal.ecrit.push(['deleteCustomSequence', { centre, id }]); return []; },
      getAutomationDefaults: OC.getAutomationDefaults,
    });
    const ops = require(path.join(ROOT, OPS));
    const cliquer = (geste, params) => appeler(ops, { action: 'assistantGeste', centerId: 'libramont', geste, params });
    const r = await cliquer('prix_formule', { formule: 'Anniversaire', prix: 20 });
    const ecrit = journal.ecrit.find((e) => e[0] === 'upsertClientFormuleOverride');
    ok(r.statut === 200 && r.json.ok === true && ecrit && ecrit[1].formuleId === 'f-anniv' && ecrit[1].centerId === 'libramont' && ecrit[1].patch && ecrit[1].patch.priceValue === 20 && Object.keys(ecrit[1].patch).length === 1,
      '[S] le prix part avec le corps refait par le serveur', `${r.statut} ${JSON.stringify(r.json).slice(0, 160)} ${JSON.stringify(ecrit)}`);
    ok(journal.audits.some((a) => a && a.action === 'assistantGeste' && JSON.stringify(a).includes('saveClientFormuleOverride')), '[S] le journal d audit dit le geste et l action du logiciel', JSON.stringify(journal.audits.map((a) => [a.action, a.changes || a.details])).slice(0, 300));
    journal.ecrit.length = 0;
    courante = MANAGER;
    const lecteur = await cliquer('prix_formule', { formule: 'Anniversaire', prix: 25 });
    ok(lecteur.statut === 403 && journal.ecrit.length === 0, '[S] un role sans le controle total ne fait aucun geste (403)', `${lecteur.statut} ${JSON.stringify(lecteur.json)}`);
    courante = DIRECTION;
    const seq = await cliquer('sequence_creer', { nom: 'Relance 30 jours', declencheur: 'after_visit', jours: 30, objet: 'Ça fait un mois', texte: 'Bonjour {{prenom}}, ça fait un mois.' });
    const ecritSeq = journal.ecrit.find((e) => e[0] === 'saveCustomSequence');
    ok(seq.statut === 200 && ecritSeq && ecritSeq[1].s.enabled === false && ecritSeq[1].s.name === 'Relance 30 jours', '[S] une sequence se cree coupee par l action du logiciel', `${seq.statut} ${JSON.stringify(ecritSeq)}`);
    const marche = await cliquer('sequence_auto_marche', { sequence: 'Réactiver les clients dormants', active: true });
    const ecritMarche = journal.ecrit.find((e) => e[0] === 'setAutomationSetting');
    ok(marche.statut === 200 && ecritMarche && ecritMarche[1].key === 'reactivation' && ecritMarche[1].patch.enabled === true, '[S] allumer une sequence automatique passe par son action', `${marche.statut} ${JSON.stringify(ecritMarche)}`);
    const brouillon = await cliquer('campagne_brouillon', { nom: 'Halloween', segment: 'all', objet: 'Frissons', texte: 'Bonjour {{prenom}}, venez frissonner.' });
    const ecritCamp = journal.ecrit.find((e) => e[0] === 'createCampaignRow');
    ok(brouillon.statut === 200 && ecritCamp && ecritCamp[1].status === 'draft' && ecritCamp[1].segment === 'all', '[S] un brouillon de campagne s ecrit sans rien envoyer', `${brouillon.statut} ${JSON.stringify(ecritCamp)}`);
    // Une autre adresse du logiciel (ici une reservation) : la meme requete que la page, avec les memes
    // en-tetes de session, a son propre gestionnaire, qui revoit lui-meme les droits.
    const Gs = require(path.join(ROOT, GESTES));
    const cheminSR = require.resolve(path.join(ROOT, 'api/staff-reservations.js'));
    const avantSR = require.cache[cheminSR];
    const vus = [];
    require.cache[cheminSR] = { id: cheminSR, filename: cheminSR, loaded: true, exports: async (req, res) => { const corps = JSON.parse(await lireCorps(req)); vus.push({ methode: req.method, url: req.url, corps, auth: req.headers.authorization }); res.statusCode = 200; res.end(JSON.stringify({ ok: true, reservation: { id: corps.id } })); } };
    Gs.GESTES.__essai_note = { titre: 'Essai', verbe: 'Faire', cours: '…', quoi: 'essai', parametres: {}, action: 'aucune', endpoint: 'staff-reservations', methode: 'PATCH', permission: null, risque: false, async preparer() { return { corps: { id: 5, noteEquipe: { ajout: 'essai' } }, texte: 'essai', lignes: [] }; } };
    const autre = await appeler(ops, { action: 'assistantGeste', centerId: 'libramont', geste: '__essai_note', params: {} }, { authorization: 'Bearer jeton-du-poste' });
    delete Gs.GESTES.__essai_note;
    if (avantSR) require.cache[cheminSR] = avantSR; else delete require.cache[cheminSR];
    ok(autre.statut === 200 && vus.length === 1 && vus[0].methode === 'PATCH' && vus[0].url === '/api/staff-reservations' && vus[0].corps.id === 5 && vus[0].corps.centerId === 'libramont' && vus[0].auth === 'Bearer jeton-du-poste',
      '[S] un geste vers une autre adresse part avec la meme session, a son gestionnaire', JSON.stringify([autre.statut, vus]).slice(0, 300));
    journal.ecrit.length = 0;
    const faux = await cliquer('prix_formule', { formule: 'Anniversaire', prix: 'beaucoup' });
    const horsRegistre = await cliquer('regenerer_code', {});
    ok(faux.statut === 422 && horsRegistre.statut === 422 && journal.ecrit.length === 0, '[S] un parametre faux ou un geste inconnu ne touche a rien', `${faux.statut} ${horsRegistre.statut} ${JSON.stringify([faux.json, horsRegistre.json]).slice(0, 200)}`);
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
    console.log(`assistant-tout-faire-check --contre-preuves: ${MUTATIONS.length - manquees}/${MUTATIONS.length} mordent`);
    process.exit(manquees ? 1 : 0);
  }
  const echecs = await verifier();
  console.log(`\n${echecs.length ? `assistant-tout-faire-check: ${echecs.length} echec(s)` : 'assistant-tout-faire-check: ALL OK'}`);
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

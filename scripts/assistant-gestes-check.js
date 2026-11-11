'use strict';
// LES GESTES DE L ASSISTANT (2026-11-11, Ansar : « montrer ou il faut aller exactement pour faire x ou y,
// et le faire lui-meme avec autorisation, bride par centre »). Ce gate tient trois regles :
//   A. la carte du logiciel (lib/carte-logiciel.js) suit la console : ses ecrans, leurs droits, ses
//      rubriques, et la page ne mene qu a ces ecrans-la ;
//   B. « M'y emmener » ne propose que ce que le role ouvre, dans le centre que ce compte ouvre ;
//   C. un geste ne se propose que valide, dans ce centre, au role qui a le droit de le faire, et rien ne
//      s ecrit avant le clic de la personne (la page envoie l action existante, que api/ops.js revoit).
// Lancement : node scripts/assistant-gestes-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// CONTRE-PREUVES : chaque garde retiree en memoire (le disque n est jamais touche) doit rougir sa ligne.
const MUTATIONS = {
  'ecran-hors-role': { fichier: 'lib/assistant-outils.js', de: '      if (!carte.ouvrable(ouverte.session, d)) throw refus(', vers: '      if (false) throw refus(', rouge: 'un ecran que le role n ouvre pas ne se propose pas' },
  'date-impossible': { fichier: 'lib/assistant-outils.js', de: "        if (!jour || jour.toISOString().slice(0, 10) !== date) throw refus('La date est invalide.');", vers: "        if (!jour) throw refus('La date est invalide.');", rouge: 'une date impossible ou passee ne se propose pas' },
  'demande-d-un-autre-centre': { fichier: 'lib/assistant-outils.js', de: 'getCustomRequest(Number(entree.demande), { centerId: ouverte.id })', vers: 'getCustomRequest(Number(entree.demande), {})', rouge: 'une demande d un autre centre ne se classe pas' },
  'heures-sans-droit': { fichier: 'lib/assistant-outils.js', de: "        if (!sessionHasPermission(session, 'reservations.create')) throw refus(", vers: '        if (false) throw refus(', rouge: 'sans le droit de creer une reservation, pas de geste sur les heures' },
  'heures-a-l-envers': { fichier: 'lib/assistant-outils.js', de: ' || ouverture >= fermeture) throw refus(', vers: ') throw refus(', rouge: 'des heures a l envers ou hors du cadran ne se proposent pas' },
  'reservation-sans-droit': { fichier: 'lib/assistant-outils.js', de: "        if (!sessionHasPermission(session, ['reservations.create', 'reservations.quick'])) throw refus(", vers: '        if (false) throw refus(', rouge: 'preparer une reservation : refusee sans droit, a une date impossible ou passee, ou sans joueur' },
  'reservation-date-impossible': { fichier: 'lib/assistant-outils.js', de: "        if (!jour || jour.toISOString().slice(0, 10) !== date) throw refus('La date de la réservation est invalide.');", vers: "        if (!jour) throw refus('La date de la réservation est invalide.');", rouge: 'preparer une reservation : refusee sans droit, a une date impossible ou passee, ou sans joueur' },
  'note-sans-droit': { fichier: 'lib/assistant-outils.js', de: "        if (!sessionHasPermission(session, 'clients.edit') || !sessionHasPermission(session, 'reservations.view')) throw refus(", vers: '        if (false) throw refus(', rouge: 'noter sur une fiche : refuse sans le droit, hors du centre, sans texte ou sans telephone ni e-mail' },
  'note-hors-centre': { fichier: 'lib/assistant-outils.js', de: '(await lignes(ctx, ouverte.id, session)).find((x) => Number(x.id) === numero)', vers: '(await lignes(ctx, ouverte.id, session)).find(() => true)', rouge: 'noter sur une fiche : refuse sans le droit, hors du centre, sans texte ou sans telephone ni e-mail' },
  'roles-d-un-autre-centre': { fichier: 'lib/assistant-outils-centre.js', de: "from staff_roles where center_id = $1 order by locked desc, name asc;', [id]);", vers: "from staff_roles where center_id = $1 order by locked desc, name asc;', ['gembloux']);", rouge: 'les roles se lisent dans le centre ouvert, avec les mots de la page Equipe' },
};
const CASSE = process.env.GESTES_CASSE || '';
const mutation = CASSE ? MUTATIONS[CASSE] : null;
if (mutation) {
  const cible = path.normalize(path.join(ROOT, mutation.fichier));
  const origine = Module._extensions['.js'];
  Module._extensions['.js'] = function charger(m, f) {
    if (path.normalize(f) !== cible) { origine(m, f); return; }
    const texte = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    if (texte.split(mutation.de).length !== 2) { console.error(`ancre introuvable ou multiple : ${CASSE}`); process.exit(3); }
    m._compile(texte.split(mutation.de).join(mutation.vers), f);
  };
}

let echecs = 0;
function ok(condition, nom, detail = '') {
  if (condition) console.log(`ok    ${nom}`);
  else { echecs += 1; console.log(`FAIL  ${nom}${detail ? `  [${String(detail).slice(0, 300)}]` : ''}`); }
}
const lire = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const lu = (sortie) => { try { return JSON.parse((sortie && sortie.contenu) || '{}'); } catch (error) { return {}; } };

// La base remplacee : deux demandes, une dans chaque centre.
const DEMANDES = { 12: { id: 12, centerId: 'libramont', contactName: 'Zoéline Verhaegen' }, 13: { id: 13, centerId: 'gembloux', contactName: 'Liamtor Peetersen' } };
const database = require('../lib/database');
database.getCustomRequest = async (id, { centerId = '' } = {}) => {
  const item = DEMANDES[Number(id)];
  if (!item || (centerId && item.centerId !== centerId)) throw Object.assign(new Error('Demande introuvable.'), { statusCode: 404 });
  return item;
};

const outils = require('../lib/assistant-outils');
const carte = require('../lib/carte-logiciel');

const GERANT = { permissions: ['campaigns.manage', 'settings.manage', 'reservations.create', 'reservations.edit', 'reservations.view', 'clients.view', 'clients.edit','dashboard.view', 'planning.view', 'emails.view', 'users.manage', 'pricing.manage'], role: {}, authorizedCenterId: 'libramont' };
const MARKETEUR = { permissions: ['campaigns.manage'], role: {}, authorizedCenterId: 'libramont' };
// Le compte ouvre Libramont ; Gembloux lui reste ferme (la porte du centre rend null).
function contexte(session) {
  const ctx = outils.creerContexte({ req: {}, session, centres: [{ id: 'libramont', name: 'Fun Galaxy Libramont' }, { id: 'gembloux', name: 'Fun Galaxy Gembloux' }], aujourdhui: '2026-11-11', messagesPersonne: [] });
  ctx.portes.set('libramont', session);
  ctx.portes.set('gembloux', null);
  return ctx;
}

async function verifier() {
  console.log('\n[A. LA CARTE SUIT LA CONSOLE]');
  const app = lire('assets/app-main.js');
  const menu = [...(((app.match(/const STAFF_MENU_PAGES = \[([\s\S]*?)\];/) || [])[1]) || '').matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((p) => !p.startsWith('cockpit'));
  // Groupes et contacts vivent dans Clients, sans entree de menu a eux (ni dans la carte des droits).
  const SANS_ENTREE = ['groups', 'contacts'];
  const bloc = ((app.match(/const STAFF_PAGE_PERMISSION_MAP = \{([\s\S]*?)\n\};/) || [])[1]) || '';
  const droitsDe = (page) => {
    const m = bloc.match(new RegExp(`\\n\\s*'?${page}'?: \\[([^\\]]*)\\]`));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : null;
  };
  const rubriques = [...((((app.match(/const EB_RUBRIQUES = \[([\s\S]*?)\n\];/) || [])[1]) || '').matchAll(/\['([a-z]+)',/g))].map((m) => m[1]);
  const pagesCarte = [...new Set(carte.DESTINATIONS.map((d) => d.page))];
  const manquants = menu.filter((p) => !SANS_ENTREE.includes(p) && !pagesCarte.includes(p));
  ok(menu.length > 10 && manquants.length === 0, 'chaque ecran du menu a sa place sur la carte', JSON.stringify(manquants));
  ok(pagesCarte.every((p) => menu.includes(p)), 'chaque page de la carte existe dans la console', JSON.stringify(pagesCarte.filter((p) => !menu.includes(p))));
  const faux = carte.DESTINATIONS.filter((d) => JSON.stringify([...d.droits].sort()) !== JSON.stringify(droitsDe(d.page))).map((d) => d.id);
  ok(faux.length === 0, 'chaque ecran s ouvre avec les droits que la console exige', JSON.stringify(faux));
  ok(rubriques.length >= 7 && carte.DESTINATIONS.filter((d) => d.rubrique).every((d) => d.page === 'establishment' && rubriques.includes(d.rubrique)) && rubriques.every((r) => carte.DESTINATIONS.some((d) => d.rubrique === r)),
    'chaque rubrique d Etablissement a sa place, et seulement elles', JSON.stringify(rubriques));
  const page = lire('assets/pinlane-assistant.js');
  const liste = (nom) => [...((((page.match(new RegExp(`const ${nom} = \\[([^\\]]*)\\]`)) || [])[1]) || '').matchAll(/'([^']+)'/g))].map((m) => m[1]).sort();
  ok(JSON.stringify(liste('PAGES_OUVRABLES')) === JSON.stringify([...pagesCarte].sort()) && JSON.stringify(liste('RUBRIQUES')) === JSON.stringify([...rubriques].sort()),
    'la page ne mene qu aux ecrans de la carte', JSON.stringify(liste('PAGES_OUVRABLES')));
  ok(/const GESTES = \{ ouvertureExceptionnelle: \['date', 'open', 'close', 'motif'\], customRequestStatus: \['id', 'status'\], ouvrirReserver: \['date', 'startTime', 'pax', 'name'\], noteClient: \['reservationId', 'texte'\] \};/.test(page) && /cles\.forEach\(\(k\) => \{ if \(a\[k\] != null\) corps\[k\] = a\[k\]; \}\);/.test(page),
    'la page ne connait que quatre gestes, avec leurs seules cles');
  // Une note de client s ajoute a la sienne par la porte des notes, avec sa version : rien ne s efface.
  const iNote = page.indexOf('  async function ajouterNoteClient(centre, reservationId, texte) {');
  const corpsNote = iNote > 0 ? page.slice(iNote, page.indexOf('\n  }\n', iNote)) : '';
  ok(/const porte = '\/api\/staff-customer-notes';/.test(corpsNote) && /\$\{porte\}\?centerId=\$\{encodeURIComponent\(centre\)\}&reservationId=\$\{encodeURIComponent\(reservationId\)\}/.test(corpsNote)
    && /const body = \[avant, String\(texte \|\| ''\)\.trim\(\)\]\.filter\(Boolean\)\.join\('\\n\\n'\);/.test(corpsNote)
    && /method: 'PATCH', body: JSON\.stringify\(\{ centerId: centre, reservationId: Number\(reservationId\), body, clientKey: lue\.clientKey, baseUpdatedAt: \(lue\.note && lue\.note\.updatedAt\) \|\| null \}\)/.test(corpsNote)
    && /await ajouterNoteClient\(corps\.centerId, corps\.reservationId, corps\.texte\);/.test(page),
    'une note de client s ajoute a la sienne, avec sa version, par la porte des notes', corpsNote.slice(0, 160));
  // Preparer une reservation n ecrit rien : la fenetre Reserver s ouvre preremplie, dans le centre affiche.
  const iResa = page.indexOf("if (a.action === 'ouvrirReserver') {");
  const brancheResa = iResa > 0 ? page.slice(iResa, page.indexOf('\n    }\n', iResa)) : '';
  ok(/if \(p\.centre && p\.centre !== centreId\(\)\) \{ p\.erreur = /.test(brancheResa) && /openQuickBook\(\{ date: corps\.date, startTime: corps\.startTime, heureSouhaitee: true, pax: corps\.pax/.test(brancheResa) && /\n      return;$/.test(brancheResa) && !/apiRequest|fetch\(/.test(brancheResa) && !/ouvrirReserver/.test(lire('api/ops.js')),
    'une reservation preparee ouvre Reserver sans rien envoyer, et seulement dans le centre affiche', brancheResa.slice(0, 200));

  console.log('\n[B. M Y EMMENER]');
  const horaires = await outils.executer(contexte(GERANT), 'ou_aller', { destination: 'horaires' });
  ok(Boolean(horaires.aller) && horaires.aller.page === 'establishment' && horaires.aller.rubrique === 'horaires' && /Établissement › Horaires/.test(horaires.aller.chemin) && /Horaires/.test(lu(horaires).chemin || ''),
    'les horaires : le chemin des menus et la page a ouvrir', JSON.stringify(horaires.aller || horaires.contenu));
  const refuse = await outils.executer(contexte(MARKETEUR), 'ou_aller', { destination: 'horaires' });
  ok(!refuse.aller && refuse.erreur === true && /n’ouvre pas/.test(lu(refuse).erreur || ''), 'un ecran que le role n ouvre pas ne se propose pas', refuse.contenu);
  const inconnu = await outils.executer(contexte(GERANT), 'ou_aller', { destination: 'cockpit' });
  ok(!inconnu.aller && inconnu.erreur === true, 'un ecran hors de la carte ne s ouvre pas', inconnu.contenu);
  const ailleurs = await outils.executer(contexte(GERANT), 'ou_aller', { destination: 'horaires', centre: 'gembloux' });
  ok(!ailleurs.aller && /n'est pas accessible/.test(lu(ailleurs).erreur || ''), 'un centre que ce compte n ouvre pas reste ferme', ailleurs.contenu);
  ok(/if \(sortie\.aller\) emettre\('aller', sortie\.aller\);/.test(lire('lib/assistant-agent.js')), 'le chemin part a la page, sous la reponse');
  // test:route-url rejoue ces deux gestes pour chaque chemin de la carte, dans une vraie console.
  ok(/if \(a\.page === 'establishment' && RUBRIQUES\.includes\(a\.rubrique\) && typeof setEstablishmentTab === 'function'\) setEstablishmentTab\(a\.rubrique\);\n\s*if \(typeof location !== 'undefined'\) location\.hash = `#\/staff\/\$\{a\.page\}`;/.test(page),
    'le bouton fait les deux gestes que test:route-url rejoue pour chaque chemin');

  console.log('\n[C. UN GESTE, AU SEUL CLIC DE LA PERSONNE]');
  const ouvrir = await outils.executer(contexte(GERANT), 'proposer_un_geste', { geste: 'horaires_du_jour', date: '2026-12-05', ouverture: '10:00', fermeture: '23:00', motif: 'groupe de 40' });
  const p = ouvrir.proposition || {};
  const a = p.action || {};
  ok(p.type === 'geste' && p.centre === 'libramont' && a.action === 'ouvertureExceptionnelle' && a.date === '2026-12-05' && a.open === '10:00' && a.close === '23:00' && /samedi 5 décembre de 10:00 à 23:00 \(groupe de 40\)/.test(p.texte || ''),
    'les heures d un jour : une proposition a valider, dans le centre ouvert', JSON.stringify(p));
  ok(/jamais que c’est fait/.test(lu(ouvrir).consigne || ''), 'le modele sait que rien n est fait avant le clic', ouvrir.contenu);
  const essai = async (sur) => Boolean((await outils.executer(contexte(GERANT), 'proposer_un_geste', { geste: 'horaires_du_jour', date: '2026-12-05', ouverture: '10:00', fermeture: '23:00', ...sur })).proposition);
  // Le 31 fevrier dans l avenir : passe, il serait refuse pour une autre raison.
  const dates = [await essai({ date: '2027-02-31' }), await essai({ date: '2026-11-10' })];
  ok(dates.every((x) => !x), 'une date impossible ou passee ne se propose pas', JSON.stringify(dates));
  const heures = [await essai({ ouverture: '23:00', fermeture: '10:00' }), await essai({ ouverture: '25:00' })];
  ok(heures.every((x) => !x), 'des heures a l envers ou hors du cadran ne se proposent pas', JSON.stringify(heures));
  const sansDroit = await outils.executer(contexte(MARKETEUR), 'proposer_un_geste', { geste: 'horaires_du_jour', date: '2026-12-05', ouverture: '10:00', fermeture: '23:00' });
  ok(!sansDroit.proposition && sansDroit.erreur === true, 'sans le droit de creer une reservation, pas de geste sur les heures', sansDroit.contenu);
  const classer = await outils.executer(contexte(GERANT), 'proposer_un_geste', { geste: 'statut_demande', demande: 12, statut: 'terminee' });
  ok(Boolean(classer.proposition) && JSON.stringify(classer.proposition.action) === '{"action":"customRequestStatus","id":12,"status":"handled"}' && /Zoéline Verhaegen : terminée/.test(classer.proposition.texte),
    'classer une demande du centre : l action et le nom du client', JSON.stringify(classer.proposition || classer.contenu));
  const autre = await outils.executer(contexte(GERANT), 'proposer_un_geste', { geste: 'statut_demande', demande: 13, statut: 'terminee' });
  ok(!autre.proposition && /n’existe pas dans ce centre/.test(lu(autre).erreur || ''), 'une demande d un autre centre ne se classe pas', autre.contenu);
  const ctx = contexte(GERANT);
  let faites = 0;
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if ((await outils.executer(ctx, 'proposer_un_geste', { geste: 'statut_demande', demande: 12, statut: 'en_cours' })).proposition) faites += 1;
  }
  ok(faites === 3, 'trois propositions par question au plus', String(faites));
  const resa = await outils.executer(contexte(GERANT), 'proposer_un_geste', { geste: 'reservation', date: '2026-12-05', heure: '14:30', joueurs: 12, nom: 'Zoéline Verhaegen' });
  const pr = resa.proposition || {};
  ok(pr.type === 'geste' && pr.centre === 'libramont' && JSON.stringify(pr.action) === '{"action":"ouvrirReserver","date":"2026-12-05","startTime":"14:30","pax":12,"name":"Zoéline Verhaegen"}' && /samedi 5 décembre à 14:30 pour 12 joueurs, au nom de Zoéline Verhaegen/.test(pr.texte || ''),
    'preparer une reservation : Reserver prerempli, dans le centre ouvert', JSON.stringify(pr.action ? pr : resa.contenu));
  const sansNom = await outils.executer(contexte({ ...MARKETEUR, permissions: ['campaigns.manage', 'reservations.quick'] }), 'proposer_un_geste', { geste: 'reservation', date: '2026-12-05', heure: '14:30', joueurs: 4, nom: 'Zoéline Verhaegen' });
  ok(Boolean(sansNom.proposition) && !('name' in sansNom.proposition.action) && !/Zoéline/.test(sansNom.proposition.texte), 'un role qui ne voit pas les clients prepare la reservation sans nom', JSON.stringify(sansNom.proposition || sansNom.contenu));
  const essaiResa = async (session, sur) => Boolean((await outils.executer(contexte(session), 'proposer_un_geste', { geste: 'reservation', date: '2026-12-05', heure: '14:30', joueurs: 12, ...sur })).proposition);
  const refusResa = [await essaiResa(MARKETEUR, {}), await essaiResa(GERANT, { date: '2027-02-31' }), await essaiResa(GERANT, { date: '2026-11-10' }), await essaiResa(GERANT, { joueurs: 0 }), await essaiResa(GERANT, { heure: '24:10' })];
  ok(refusResa.every((x) => !x), 'preparer une reservation : refusee sans droit, a une date impossible ou passee, ou sans joueur', JSON.stringify(refusResa));
  // Noter sur la fiche d un client : l historique du centre ouvert est remplace par deux reservations.
  const avecHistorique = (session) => {
    const c = contexte(session);
    c.projections.set('libramont', Promise.resolve([{ id: 501, code: 'L0001', client: 'Zoéline Verhaegen' }, { id: 502, code: '', client: '' }]));
    return c;
  };
  const noter = await outils.executer(avecHistorique(GERANT), 'proposer_un_geste', { geste: 'note_client', reservation: 501, texte: 'Préfère être appelée le matin.' });
  const pn = noter.proposition || {};
  ok(pn.type === 'geste' && pn.centre === 'libramont' && JSON.stringify(pn.action) === '{"action":"noteClient","reservationId":501,"texte":"Préfère être appelée le matin."}' && pn.texte === 'Ajouter à la note de Zoéline Verhaegen : « Préfère être appelée le matin. ».',
    'noter sur la fiche d un client : la note a ajouter, dans le centre ouvert', JSON.stringify(pn.action ? pn : noter.contenu));
  const essaiNote = async (session, sur) => Boolean((await outils.executer(avecHistorique(session), 'proposer_un_geste', { geste: 'note_client', reservation: 501, texte: 'Préfère être appelée le matin.', ...sur })).proposition);
  const refusNote = [await essaiNote({ ...GERANT, permissions: GERANT.permissions.filter((x) => x !== 'clients.edit') }, {}), await essaiNote(GERANT, { reservation: 999 }), await essaiNote(GERANT, { texte: ' ' }), await essaiNote(GERANT, { reservation: 502 })];
  ok(refusNote.every((x) => !x), 'noter sur une fiche : refuse sans le droit, hors du centre, sans texte ou sans telephone ni e-mail', JSON.stringify(refusNote));
  const sources = lire('lib/assistant-outils.js');
  const debut = sources.indexOf('  proposer_un_geste: {');
  const corpsGeste = debut > 0 ? sources.slice(debut, sources.indexOf('\n  },\n', debut)) : '';
  ok(corpsGeste.length > 0 && !/apiRequest|handlePost|saveClientNote|updateCustomRequestStatus|ouvertureExceptionnelle\(/.test(corpsGeste), 'le serveur n ecrit rien : le geste n est qu une proposition', '');

  console.log('\n[D. CE QUE LE CENTRE A APPRIS AILLEURS]');
  const api = lire('api/assistant.js');
  // Une simple lecture, dans le centre ouvert : getFaitsAppris cree la table et importe un fichier, et
  // l assistant n ecrit jamais (test:assistant, section O, l a vu sur GitHub le 2026-11-11).
  ok(/requeteBase\('select id, question, reponse from agent_facts where center_id = \$1 and oublie_le is null/.test(api) && /\[centreOuvert\]\)/.test(api) && !/getFaitsAppris/.test(api) && /id: 900000 \+ Number\(f\.id \|\| 0\)/.test(api),
    'les faits appris aux mails et aux demandes arrivent a l assistant, lus sans ecrire, pour le centre ouvert seulement');

  console.log('\n[E. CE QUE CHAQUE ROLE PEUT FAIRE]');
  // Les mots des droits sont ceux de la page Equipe & acces (CARTE_DES_DROITS), un par un.
  const debutCarte = app.indexOf('const CARTE_DES_DROITS = [');
  const blocCarte = debutCarte > 0 ? app.slice(debutCarte, app.indexOf('\n];', debutCarte)) : '';
  const paires = [...blocCarte.matchAll(/\['([a-z]+\.[a-zA-Z]+)', '([^']+)'/g)].filter((m) => !/^[a-z]+\.[a-zA-Z]+$/.test(m[2])).map((m) => [m[1], m[2]]);
  const ecarts = paires.filter(([k, v]) => carte.DROITS_EN_MOTS[k] !== v).map(([k]) => k).concat(Object.keys(carte.DROITS_EN_MOTS).filter((k) => !paires.some(([c]) => c === k)));
  ok(paires.length >= 25 && ecarts.length === 0, 'chaque droit porte le nom que la page Equipe lui donne', JSON.stringify(ecarts));
  const lues = [];
  database.getPool = () => ({ query: async (texte, params) => {
    lues.push({ texte, params });
    const ROLES = {
      libramont: [{ id: 'direction', name: 'Direction', locked: true, permissions: [] }, { id: 'accueil', name: 'Accueil', locked: false, permissions: ['reservations.view', 'payments.markPaid', 'reservations.status', 'niveau:surmesure:prix'] }],
      gembloux: [{ id: 'gembloux-seul', name: 'Rôle de Gembloux', locked: false, permissions: ['users.manage'] }],
    };
    return { rows: (params && ROLES[params[0]]) || [] };
  } });
  const roles = await outils.executer(contexte(GERANT), 'roles_et_droits', {});
  const lignesRoles = (roles.source && roles.source.lignes) || [];
  ok(lignesRoles.length === 2 && lignesRoles[0].role === 'Direction' && lignesRoles[0].peut === 'Tous les droits du centre' && lignesRoles[1].peut === 'Voir les réservations, Encaisser, Changer l’état' && lignesRoles[1].nombre === 3
    && lues.length === 1 && JSON.stringify(lues[0].params) === '["libramont"]',
    'les roles se lisent dans le centre ouvert, avec les mots de la page Equipe', JSON.stringify({ lignesRoles, lues: lues.map((l) => l.params), contenu: roles.contenu }));
  const rolesAilleurs = await outils.executer(contexte(GERANT), 'roles_et_droits', { centre: 'gembloux' });
  const rolesMarketeur = await outils.executer(contexte(MARKETEUR), 'roles_et_droits', {});
  ok(rolesAilleurs.erreur === true && rolesMarketeur.erreur === true && lues.length === 1, 'les roles restent fermes a un autre centre et a un role sans le droit equipe', JSON.stringify([rolesAilleurs.contenu, rolesMarketeur.contenu]));
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    let manquees = 0;
    for (const [nom, m] of Object.entries(MUTATIONS)) {
      const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, GESTES_CASSE: nom }, encoding: 'utf8', timeout: 120000 });
      const sortie = `${r.stdout || ''}${r.stderr || ''}`;
      const mord = r.status === 1 && sortie.split('\n').some((l) => l.startsWith('FAIL') && l.includes(m.rouge));
      if (!mord) manquees += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${nom} : ${mord ? `rougit « ${m.rouge} »` : `ne mord pas (code ${r.status})`}`);
    }
    console.log(`assistant-gestes-check --contre-preuves: ${Object.keys(MUTATIONS).length - manquees}/${Object.keys(MUTATIONS).length} mordent`);
    process.exit(manquees ? 1 : 0);
  }
  await verifier();
  console.log(`\n${echecs === 0 ? 'assistant-gestes-check: ALL OK' : `assistant-gestes-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });

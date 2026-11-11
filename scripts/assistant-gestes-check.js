'use strict';
// LES GESTES DE L ASSISTANT (2026-11-11, Ansar : « montrer ou il faut aller exactement pour faire x ou y,
// et le faire lui-meme avec autorisation, bride par centre »). Ce gate tient trois regles :
//   A. la carte du logiciel (lib/carte-logiciel.js) suit la console : ses ecrans, leurs droits, ses
//      rubriques, et la page ne mene qu a ces ecrans-la ;
//   B. « M'y emmener » ne propose que ce que le role ouvre, dans le centre que ce compte ouvre ;
//   C. un geste ne se propose qu a la Direction et au proprietaire (Ansar, 2026-11-11 : « ya que la
//      direction et moi qui a le droit a l agent avec controle total, les autres l ont en lecteur »),
//      valide, dans ce centre, et rien ne s ecrit avant le clic de la personne (api/ops.js revoit tout).
// Lancement : node scripts/assistant-gestes-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// CONTRE-PREUVES : chaque garde retiree en memoire (le disque n est jamais touche) doit rougir sa ligne.
const MUTATIONS = {
  // Les roles et leurs droits ne se lisent qu avec le droit Equipe (users.manage) ou Direction.
  'roles-ouverts-a-tous': { fichier: 'lib/assistant-outils-centre.js', de: "droits: ['users.manage', 'direction.view'],\n      ce: \"les rôles de l'équipe\",", vers: "droits: null,\n      ce: \"les rôles de l'équipe\",", rouge: 'les roles restent fermes a un autre centre et a un role sans le droit equipe' },
  'ecran-hors-role': { fichier: 'lib/assistant-outils.js', de: '      if (!carte.ouvrable(ouverte.session, d)) throw refus(', vers: '      if (false) throw refus(', rouge: 'un ecran que le role n ouvre pas ne se propose pas' },
  'date-impossible': { fichier: 'lib/assistant-outils.js', de: "        if (!jour || jour.toISOString().slice(0, 10) !== date) throw refus('La date est invalide.');", vers: "        if (!jour) throw refus('La date est invalide.');", rouge: 'une date impossible ou passee ne se propose pas' },
  'demande-d-un-autre-centre': { fichier: 'lib/assistant-outils.js', de: 'getCustomRequest(Number(entree.demande), { centerId: ouverte.id })', vers: 'getCustomRequest(Number(entree.demande), {})', rouge: 'une demande d un autre centre ne se classe pas' },
  'geste-en-lecture': { fichier: 'lib/assistant-outils.js', de: '      if (outil.agir && !agitAvecLAssistant(ouverte.session)) throw refus(', vers: '      if (false) throw refus(', rouge: 'un role en lecture ne fait aucun geste, meme avec tous les droits' },
  'outil-des-gestes-en-lecture': { fichier: 'lib/assistant-outils.js', de: ' && (!o.agir || agitAvecLAssistant(session)))', vers: ')', rouge: 'l outil des gestes n est donne qu a la Direction et au proprietaire' },
  'programme-qui-ne-tient-pas': { fichier: 'lib/assistant-outils.js', de: '        if (!resume.disponible) throw refus(', vers: '        if (false) throw refus(', rouge: 'un programme qui ne tient pas ne se propose pas, et l assistant cherche une autre heure' },
  'heures-sans-foulee': { fichier: 'lib/assistant-reservation.js', de: '    else if (ancrable && fin != null) debut = Math.ceil(fin / 30) * 30;', vers: '', rouge: 'preparer une reservation : tout le programme, chaque activite a son heure et ses joueurs' },
  'la-plus-chargee': { fichier: 'lib/assistant-outils.js', de: '.sort((a, b) => a.joueurs_presents - b.joueurs_presents || a.groupes_presents - b.groupes_presents);', vers: '.sort((a, b) => b.joueurs_presents - a.joueurs_presents);', rouge: 'tranquille : l heure qui tient avec le moins de monde, jamais la plus chargee' },
  'heures-a-l-envers': { fichier: 'lib/assistant-outils.js', de: ' || ouverture >= fermeture) throw refus(', vers: ') throw refus(', rouge: 'des heures a l envers ou hors du cadran ne se proposent pas' },
  'reservation-date-impossible': { fichier: 'lib/assistant-outils.js', de: "        if (!jour || jour.toISOString().slice(0, 10) !== date) throw refus('La date de la réservation est invalide.');", vers: "        if (!jour) throw refus('La date de la réservation est invalide.');", rouge: 'preparer une reservation : refusee a une date impossible ou passee, ou sans joueur' },
  'risque-sans-demande': { fichier: 'lib/assistant-outils.js', de: '        if (!demandeParLaPersonne(/annul|supprim|efface/i)) throw refus(', vers: '        if (false) throw refus(', rouge: 'annuler : seulement si la personne le demande elle-meme' },
  'annuler-deja-annulee': { fichier: 'lib/assistant-outils.js', de: "        if (brute.status === 'cancelled') throw refus('Cette réservation est déjà annulée.');", vers: '', rouge: 'annuler : une reservation deja annulee, passee ou d un autre centre ne s annule pas' },
  'effacer-sans-demande': { fichier: 'lib/assistant-outils.js', de: "        if (!demandeParLaPersonne(/effac|supprim|vide|nettoi|m[ée]nage|enl[eè]v|retir/i)) throw refus(", vers: '        if (false) throw refus(', rouge: 'effacer : seulement si la personne le demande elle-meme' },
  'horaires-sans-alerte': { fichier: 'lib/assistant-outils.js', de: '...(alerte ? { risque: true, alerte } : {}),', vers: '', rouge: 'des horaires qui laissent des reservations dehors deviennent un geste risque, qui le dit' },
  'confirmation-sautee': { fichier: 'assets/pinlane-assistant.js', de: '    if (p.risque && !confirme) {', vers: '    if (false) {', rouge: 'un geste risque se confirme deux fois, et l effacement garde la conversation ouverte', page: true },
  'carte-sans-telephone': { fichier: 'assets/pinlane-assistant.js', de: '      if (!telephoneValide(tel)) {', vers: '      if (false) {', rouge: 'la carte ne cree rien sans le telephone du client, et seulement dans le centre affiche', page: true },
  'note-hors-centre': { fichier: 'lib/assistant-outils.js', de: '(await lignes(ctx, ouverte.id, session)).find((x) => Number(x.id) === numero)', vers: '(await lignes(ctx, ouverte.id, session)).find(() => true)', rouge: 'noter sur une fiche : refuse en lecture, hors du centre, sans texte ou sans telephone ni e-mail' },
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
const lire = (rel) => {
  const texte = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  if (!mutation || !mutation.page || path.normalize(rel) !== path.normalize(mutation.fichier)) return texte;
  if (texte.split(mutation.de).length !== 2) { console.error(`ancre introuvable ou multiple : ${CASSE}`); process.exit(3); }
  return texte.split(mutation.de).join(mutation.vers);
};
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
// LE CONTROLE TOTAL : la Direction (role verrouille, tous les droits du centre) fait agir l assistant ;
// le gerant, meme avec tous ses droits, le lit.
const DIRECTION = { ...GERANT, role: { locked: true, name: 'Direction' } };
// La journee du samedi 5 decembre, remplacee : un groupe de 40 prend les huit pistes de 18 h a 20 h.
database.readStaffState = async (date, centre) => ({ date, centerId: centre, reservations: centre === 'libramont' && date === '2026-12-05' ? [{ id: 77, centerId: 'libramont', date, startTime: '18:00', duration: 2, totalDuration: 2, pax: 40, status: 'confirmed', type: 'bowling', lanes: [1, 2, 3, 4, 5, 6, 7, 8] }] : [], laneStatuses: {} });
// L historique des centres, remplace : a Libramont une reservation a venir (501), une annulee (502), une
// passee (503) ; a Gembloux une reservation qui n est pas de ce centre (601).
const HISTOIRE = {
  libramont: [
    { id: 501, centerId: 'libramont', date: '2026-12-05', startTime: '14:00', totalDuration: 2, pax: 6, price: 120, status: 'confirmed', type: 'bowling', name: 'Zoéline Verhaegen', phone: '0470123456' },
    { id: 502, centerId: 'libramont', date: '2026-12-06', startTime: '15:00', totalDuration: 1, pax: 4, price: 60, status: 'cancelled', type: 'bowling', name: 'Marjolaine Dubuisson', phone: '0471223344' },
    { id: 503, centerId: 'libramont', date: '2026-10-01', startTime: '16:00', totalDuration: 1, pax: 4, price: 60, status: 'paid', type: 'bowling', name: 'Liamtor Peetersen', phone: '0472334455' },
  ],
  gembloux: [{ id: 601, centerId: 'gembloux', date: '2026-12-05', startTime: '14:00', totalDuration: 1, pax: 4, price: 60, status: 'confirmed', type: 'bowling', name: 'Autre centre', phone: '0473445566' }],
};
database.readAdminRangeState = async (debut, fin, centre) => ({ reservations: (HISTOIRE[centre] || []).map((r) => ({ ...r })), pagination: {} });
// « 5 personnes, du bowling, et 2 parties de laser mais à 3 » (Ansar, 2026-11-11).
const PROGRAMME_DEMANDE = [{ activite: 'bowling', duree_heures: 1 }, { activite: 'laser_game', parties: 2, participants: 3 }];
// Le compte ouvre Libramont ; Gembloux lui reste ferme (la porte du centre rend null).
function contexte(session, messagesPersonne = []) {
  const ctx = outils.creerContexte({ req: {}, session, centres: [{ id: 'libramont', name: 'Fun Galaxy Libramont' }, { id: 'gembloux', name: 'Fun Galaxy Gembloux' }], aujourdhui: '2026-11-11', messagesPersonne });
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
  ok(/const GESTES = \{ ouvertureExceptionnelle: \['date', 'open', 'close', 'motif'\], customRequestStatus: \['id', 'status'\], ouvrirReserver: \['date', 'startTime', 'pax', 'name'\], noteClient: \['reservationId', 'texte'\], assistantReservation: \['date', 'startTime', 'pax', 'programme', 'name', 'phone'\], annulerReservation: \['reservationId', 'date'\], effacerConversations: \['portee', 'jours'\], assistantGeste: \['geste', 'params'\] \};/.test(page) && /cles\.forEach\(\(k\) => \{ if \(a\[k\] != null\) corps\[k\] = a\[k\]; \}\);/.test(page),
    // Le huitieme porte tous les gestes du registre (lib/assistant-gestes.js) : son geste et ses
    // parametres seulement, le serveur refait le corps au clic (api/ops.js, assistantGeste).
    'la page ne connait que huit gestes, avec leurs seules cles');
  // UN GESTE RISQUE SE CONFIRME DEUX FOIS : le premier clic montre la suite, seul le bouton de la
  // confirmation fait ; l effacement ne prend jamais la conversation ouverte ; l annulation relit le
  // dossier au clic, dans le centre affiche, et passe par la fiche (PATCH, les droits de la personne).
  const iFaire = page.indexOf('  async function faireGeste(m, p, { confirme = false } = {}) {');
  const corpsFaire = iFaire > 0 ? page.slice(iFaire, page.indexOf('\n  }\n', iFaire)) : '';
  const iDouble = corpsFaire.indexOf('    if (p.risque && !confirme) {');
  ok(iDouble > 0 && ['effacerConversations', 'annulerReservation', 'assistantReservation', 'noteClient'].every((g) => corpsFaire.indexOf(`if (a.action === '${g}')`) > iDouble)
    && /faireGeste\(m, p, \{ confirme: n\.dataset\.astConfirme === '1' \}\);/.test(page) && /data-ast-geste-oui="\$\{i\}" data-ast-confirme="1"/.test(page)
    && /return \(A\.conversations \|\| \[\]\)\.filter\(\(c\) => c && c\.id !== A\.actuelle && /.test(page)
    && /\?numero=\$\{encodeURIComponent\(a\.reservationId\)\}&centerId=\$\{encodeURIComponent\(centreId\(\)\)\}/.test(corpsFaire) && /envoyerModificationReservation\(dossier, \(d\) => \(\{ \.\.\.d, status: 'cancelled' \}\)\)/.test(corpsFaire),
    'un geste risque se confirme deux fois, et l effacement garde la conversation ouverte', corpsFaire.slice(0, 200));
  // LA RESERVATION DEPUIS SA CARTE : le telephone tape sur la carte, obligatoire comme dans Reserver,
  // et rien ne part hors du centre affiche ; le serveur revoit tout (api/ops.js assistantReservation).
  const iCarte = page.indexOf("    if (a.action === 'assistantReservation') {");
  const brancheCarte = iCarte > 0 ? page.slice(iCarte, page.indexOf('\n      return;\n    }\n', iCarte)) : '';
  ok(/if \(p\.centre && p\.centre !== centreId\(\)\) \{ p\.erreur = /.test(brancheCarte) && /querySelector\(`\[data-ast-tel="\$\{i\}"\]`\)/.test(brancheCarte)
    && /if \(!telephoneValide\(tel\)\) \{/.test(brancheCarte) && brancheCarte.indexOf('if (!telephoneValide(tel)) {') < brancheCarte.indexOf('apiRequest(API_ENDPOINTS.ops')
    && /corps\.phone = tel;/.test(brancheCarte) && /corps\.programme = Array\.isArray\(a\.programme\) \? a\.programme : \[\];/.test(brancheCarte),
    'la carte ne cree rien sans le telephone du client, et seulement dans le centre affiche', brancheCarte.slice(0, 200));
  const ops = lire('api/ops.js');
  const iOps = ops.indexOf("  if (action === 'assistantReservation') {");
  const brancheOps = iOps > 0 ? ops.slice(iOps, ops.indexOf('\n    return;\n  }\n', iOps)) : '';
  ok(/requireConcreteCenter\(\);/.test(brancheOps) && /if \(!agitAvecLAssistant\(options\.session\)\) throw createHttpError\(/.test(brancheOps) && /R\.programmeDe\(lu, joueurs, scopedCenterId\)/.test(brancheOps) && /R\.creer\(corps, options\.session\)/.test(brancheOps)
    && /if \(action === 'assistantReservation'\) return 'reservations\.create';/.test(ops),
    'au clic, le serveur revoit le role, le centre, le programme et le planning', brancheOps.slice(0, 200));
  const creation = lire('lib/assistant-reservation.js');
  const iCreer = creation.indexOf('async function creer(corps, session) {');
  const corpsCreer = iCreer > 0 ? creation.slice(iCreer, creation.indexOf('\n}\n', iCreer)) : '';
  ok(/if \(!telephoneValide\(corps\.phone\)\) throw erreur\(/.test(corpsCreer) && corpsCreer.indexOf('await simuler(corps, session)') > 0 && corpsCreer.indexOf('await simuler(corps, session)') < corpsCreer.indexOf('creerDepuisLaFenetre(prepare')
    && /if \(!plan\.disponible\) throw erreur\(/.test(corpsCreer) && /if \(bloquant\) throw erreur\(/.test(corpsCreer),
    'la creation refait le plan sur la journee lue au clic, et un creneau pris entre-temps l arrete', corpsCreer.slice(0, 200));
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
  const ouvrir = await outils.executer(contexte(DIRECTION), 'proposer_un_geste', { geste: 'horaires_du_jour', date: '2026-12-05', ouverture: '10:00', fermeture: '23:00', motif: 'groupe de 40' });
  const p = ouvrir.proposition || {};
  const a = p.action || {};
  ok(p.type === 'geste' && p.centre === 'libramont' && a.action === 'ouvertureExceptionnelle' && a.date === '2026-12-05' && a.open === '10:00' && a.close === '23:00' && /samedi 5 décembre de 10:00 à 23:00 \(groupe de 40\)/.test(p.texte || ''),
    'les heures d un jour : une proposition a valider, dans le centre ouvert', JSON.stringify(p));
  ok(/jamais que c’est fait/.test(lu(ouvrir).consigne || ''), 'le modele sait que rien n est fait avant le clic', ouvrir.contenu);
  const essai = async (sur) => Boolean((await outils.executer(contexte(DIRECTION), 'proposer_un_geste', { geste: 'horaires_du_jour', date: '2026-12-05', ouverture: '10:00', fermeture: '23:00', ...sur })).proposition);
  // Le 31 fevrier dans l avenir : passe, il serait refuse pour une autre raison.
  const dates = [await essai({ date: '2027-02-31' }), await essai({ date: '2026-11-10' })];
  ok(dates.every((x) => !x), 'une date impossible ou passee ne se propose pas', JSON.stringify(dates));
  const heures = [await essai({ ouverture: '23:00', fermeture: '10:00' }), await essai({ ouverture: '25:00' })];
  ok(heures.every((x) => !x), 'des heures a l envers ou hors du cadran ne se proposent pas', JSON.stringify(heures));
  const enLecture = await Promise.all([GERANT, MARKETEUR].map((s) => outils.executer(contexte(s), 'proposer_un_geste', { geste: 'horaires_du_jour', date: '2026-12-05', ouverture: '10:00', fermeture: '23:00' })));
  ok(enLecture.every((x) => !x.proposition && x.erreur === true && /lecture/.test(lu(x).erreur || '')), 'un role en lecture ne fait aucun geste, meme avec tous les droits', JSON.stringify(enLecture.map((x) => x.contenu)));
  const noms = (s) => outils.definitions(s).map((d) => d.name);
  ok(noms(DIRECTION).includes('proposer_un_geste') && !noms(GERANT).includes('proposer_un_geste') && !noms(MARKETEUR).includes('proposer_un_geste') && noms(GERANT).includes('heures_qui_tiennent'),
    'l outil des gestes n est donne qu a la Direction et au proprietaire', JSON.stringify([noms(DIRECTION).includes('proposer_un_geste'), noms(GERANT).includes('proposer_un_geste')]));
  const classer = await outils.executer(contexte(DIRECTION), 'proposer_un_geste', { geste: 'statut_demande', demande: 12, statut: 'terminee' });
  ok(Boolean(classer.proposition) && JSON.stringify(classer.proposition.action) === '{"action":"customRequestStatus","id":12,"status":"handled"}' && /Zoéline Verhaegen : terminée/.test(classer.proposition.texte),
    'classer une demande du centre : l action et le nom du client', JSON.stringify(classer.proposition || classer.contenu));
  const autre = await outils.executer(contexte(DIRECTION), 'proposer_un_geste', { geste: 'statut_demande', demande: 13, statut: 'terminee' });
  ok(!autre.proposition && /n’existe pas dans ce centre/.test(lu(autre).erreur || ''), 'une demande d un autre centre ne se classe pas', autre.contenu);
  const ctx = contexte(DIRECTION);
  let faites = 0;
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if ((await outils.executer(ctx, 'proposer_un_geste', { geste: 'statut_demande', demande: 12, statut: 'en_cours' })).proposition) faites += 1;
  }
  ok(faites === 3, 'trois propositions par question au plus', String(faites));
  // LA RESERVATION ENTIERE : « 5 personnes, du bowling, et 2 parties de laser mais à 3 ».
  const resa = await outils.executer(contexte(DIRECTION), 'proposer_un_geste', { geste: 'reservation', date: '2026-12-05', heure: '14:00', joueurs: 5, activites: PROGRAMME_DEMANDE, nom: 'Zoéline Verhaegen' });
  const pr = resa.proposition || {};
  const lignesResa = (pr.resume && pr.resume.lignes) || [];
  ok(pr.type === 'geste' && pr.centre === 'libramont' && pr.action && pr.action.action === 'assistantReservation' && pr.action.startTime === '14:00' && pr.action.pax === 5 && pr.action.name === 'Zoéline Verhaegen'
    && JSON.stringify(pr.action.programme) === '[{"activityId":"bowling","participants":5,"duration":1},{"activityId":"laser_game","participants":3,"games":2}]'
    && lignesResa.length === 2 && lignesResa[0].debut === '14:00' && /5 joueurs/.test(lignesResa[0].detail) && lignesResa[1].debut === '15:00' && /2 parties, 3 joueurs/.test(lignesResa[1].detail) && pr.resume.prix > 0,
    'preparer une reservation : tout le programme, chaque activite a son heure et ses joueurs', JSON.stringify(pr.action ? { action: pr.action, lignes: lignesResa, prix: pr.resume.prix } : resa.contenu));
  const pleine = await outils.executer(contexte(DIRECTION), 'proposer_un_geste', { geste: 'reservation', date: '2026-12-05', heure: '18:00', joueurs: 5, activites: PROGRAMME_DEMANDE });
  ok(!pleine.proposition && /ne tient pas à 18:00/.test(lu(pleine).erreur || '') && /heures_qui_tiennent/.test(lu(pleine).erreur || ''), 'un programme qui ne tient pas ne se propose pas, et l assistant cherche une autre heure', pleine.contenu);
  const essaiResa = async (sur) => Boolean((await outils.executer(contexte(DIRECTION), 'proposer_un_geste', { geste: 'reservation', date: '2026-12-05', heure: '14:00', joueurs: 5, activites: PROGRAMME_DEMANDE, ...sur })).proposition);
  const refusResa = [await essaiResa({ date: '2027-02-31' }), await essaiResa({ date: '2026-11-10' }), await essaiResa({ joueurs: 0 }), await essaiResa({ heure: '24:10' }), await essaiResa({ activites: [] }), await essaiResa({ activites: [{ activite: 'laser_game', participants: 9 }] }), await essaiResa({ activites: [{ activite: 'piscine' }] })];
  ok(refusResa.every((x) => !x), 'preparer une reservation : refusee a une date impossible ou passee, ou sans joueur', JSON.stringify(refusResa));
  // TRANQUILLE : chaque heure essayee avec le programme entier, et le monde deja la se compte.
  const heuresLues = await outils.executer(contexte(GERANT), 'heures_qui_tiennent', { date: '2026-12-05', joueurs: 5, activites: PROGRAMME_DEMANDE });
  const mh = lu(heuresLues);
  const ligneDe = (h) => ((heuresLues.source && heuresLues.source.lignes) || []).find((l) => l.heure === h) || {};
  ok(Boolean(mh.la_plus_calme) && ligneDe(mh.la_plus_calme).tient === 'oui' && ligneDe(mh.la_plus_calme).joueurs_presents === 0 && ligneDe('17:00').joueurs_presents === 40 && ligneDe('18:00').tient === 'non',
    'tranquille : l heure qui tient avec le moins de monde, jamais la plus chargee', JSON.stringify({ calme: mh.la_plus_calme, l17: ligneDe('17:00'), l18: ligneDe('18:00') }));
  // Noter sur la fiche d un client : l historique du centre ouvert est remplace par deux reservations.
  const avecHistorique = (session) => {
    const c = contexte(session);
    c.projections.set('libramont', Promise.resolve([{ id: 501, code: 'L0001', client: 'Zoéline Verhaegen' }, { id: 502, code: '', client: '' }]));
    return c;
  };
  const noter = await outils.executer(avecHistorique(DIRECTION), 'proposer_un_geste', { geste: 'note_client', reservation: 501, texte: 'Préfère être appelée le matin.' });
  const pn = noter.proposition || {};
  ok(pn.type === 'geste' && pn.centre === 'libramont' && JSON.stringify(pn.action) === '{"action":"noteClient","reservationId":501,"texte":"Préfère être appelée le matin."}' && pn.texte === 'Ajouter à la note de Zoéline Verhaegen : « Préfère être appelée le matin. »',
    'noter sur la fiche d un client : la note a ajouter, dans le centre ouvert', JSON.stringify(pn.action ? pn : noter.contenu));
  const essaiNote = async (session, sur) => Boolean((await outils.executer(avecHistorique(session), 'proposer_un_geste', { geste: 'note_client', reservation: 501, texte: 'Préfère être appelée le matin.', ...sur })).proposition);
  const refusNote = [await essaiNote(GERANT, {}), await essaiNote(DIRECTION, { reservation: 999 }), await essaiNote(DIRECTION, { texte: ' ' }), await essaiNote(DIRECTION, { reservation: 502 })];
  ok(refusNote.every((x) => !x), 'noter sur une fiche : refuse en lecture, hors du centre, sans texte ou sans telephone ni e-mail', JSON.stringify(refusNote));
  // ANNULER : seulement a la demande de la personne, une reservation de ce centre, a venir et active.
  const annuler = (messages, sur = {}) => outils.executer(contexte(DIRECTION, messages), 'proposer_un_geste', { geste: 'annuler_reservation', reservation: 501, ...sur });
  const sansDemande = await annuler(['Quelles réservations samedi ?']);
  const demandee = await annuler(['Le client a appelé, annule la réservation 501 stp']);
  const pa = demandee.proposition || {};
  ok(!sansDemande.proposition && /demande elle-même/.test(lu(sansDemande).erreur || '') && pa.risque === true && JSON.stringify(pa.action) === '{"action":"annulerReservation","reservationId":501,"date":"2026-12-05"}' && pa.resume && pa.resume.client === 'Zoéline Verhaegen' && pa.resume.heure === '14:00',
    'annuler : seulement si la personne le demande elle-meme', JSON.stringify([sansDemande.contenu, pa.action ? pa : demandee.contenu]));
  const refusAnnuler = await Promise.all([annuler(['annule la 502'], { reservation: 502 }), annuler(['annule la 503'], { reservation: 503 }), annuler(['annule la 601'], { reservation: 601 })]);
  ok(refusAnnuler.every((x) => !x.proposition) && /déjà annulée/.test(lu(refusAnnuler[0]).erreur || '') && /passée/.test(lu(refusAnnuler[1]).erreur || '') && /n’existe pas dans ce centre/.test(lu(refusAnnuler[2]).erreur || ''),
    'annuler : une reservation deja annulee, passee ou d un autre centre ne s annule pas', JSON.stringify(refusAnnuler.map((x) => x.contenu)));
  // EFFACER : seulement a la demande de la personne.
  const effacer = (messages, sur = {}) => outils.executer(contexte(DIRECTION, messages), 'proposer_un_geste', { geste: 'effacer_conversations', portee: 'anciennes', jours: 30, ...sur });
  const effSans = await effacer(['Combien de groupes samedi ?']);
  const effOui = await effacer(['Efface mes vieilles conversations']);
  const effJours = await effacer(['Efface mes vieilles conversations'], { jours: 0 });
  ok(!effSans.proposition && Boolean(effOui.proposition) && effOui.proposition.risque === true && JSON.stringify(effOui.proposition.action) === '{"action":"effacerConversations","portee":"anciennes","jours":30}' && !effJours.proposition,
    'effacer : seulement si la personne le demande elle-meme', JSON.stringify([effSans.contenu, effOui.proposition, effJours.contenu]));
  // DES HORAIRES QUI LAISSENT UNE RESERVATION DEHORS : le geste devient risque, et la carte le dit.
  const dehors = await outils.executer(contexte(DIRECTION), 'proposer_un_geste', { geste: 'horaires_du_jour', date: '2026-12-05', ouverture: '15:00', fermeture: '23:00' });
  const dedans = await outils.executer(contexte(DIRECTION), 'proposer_un_geste', { geste: 'horaires_du_jour', date: '2026-12-05', ouverture: '10:00', fermeture: '23:00' });
  ok(dehors.proposition && dehors.proposition.risque === true && /1 réservation tombe hors de ces heures \(14:00\)/.test(dehors.proposition.alerte || '') && dedans.proposition && !dedans.proposition.risque && !dedans.proposition.alerte,
    'des horaires qui laissent des reservations dehors deviennent un geste risque, qui le dit', JSON.stringify([dehors.proposition || dehors.contenu, dedans.proposition && dedans.proposition.alerte]));
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
  ok(lignesRoles.length === 2 && lignesRoles[0].role === 'Direction' && lignesRoles[0].peut === 'Tous les droits du centre' && lignesRoles[1].peut === 'Voir les réservations, Encaisser, Changer l’état'
    && lues.length === 1 && JSON.stringify(lues[0].params) === '["libramont"]',
    'les roles se lisent dans le centre ouvert, avec les mots de la page Equipe', JSON.stringify({ lignesRoles, lues: lues.map((l) => l.params), contenu: roles.contenu }));
  // Un nombre de droits sans son nom s est lu « Personnes » (banc, 2026-11-11) : le modele ne recoit que le role et ses droits.
  ok(JSON.stringify(((roles.source && roles.source.colonnes) || []).map((c) => c.cle)) === '["role","peut"]' && !/nombre|combien/.test(roles.contenu || ''),
    'les roles partent sans nombre a interpreter', JSON.stringify(roles.source && roles.source.colonnes));
  // Un mot reste entier dans une case de tableau (le texte de la reponse coupe n importe ou).
  const cssAssistant = lire('assets/pinlane-assistant.css');
  ok(/\.ast-table th \{[^}]*overflow-wrap: break-word;/.test(cssAssistant) && /\.ast-table td \{[^}]*overflow-wrap: break-word;/.test(cssAssistant),
    'un mot reste entier dans une case de tableau');
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

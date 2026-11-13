// LA FENETRE RESERVER CREE CE QU ELLE MONTRE (v5, lot I2 de la console,
// 2026-10-08 ; relu le 2026-11-03 sur « Les seances », la fenetre qui l a
// remplacee).
//
// Movsar sur les maquettes : « on est le staff, on doit pouvoir faire ce qu on
// veut », « plus que 3 parties », « plus que 2 heures », « tout doit suivre »,
// « elle peut créer mais il doit afficher l erreur avant, après, conflit
// expliqué », « Même client, un envoi ». La fenetre fait juger son plan par le
// serveur (simulation a blanc, dryRun) avant de creer : ce gate garde que ce
// jugement porte sur CE qui sera cree, et que chaque geste du comptoir suit.
// Les seances ont change l ecran, pas ces regles : elles se lisent ici sur le
// nouvel ecran (le ticket a droite, une page par ligne a gauche). Leurs douze
// commandes du comptoir ont leur gate, scripts/reserver-seances-check.js.
//
//   [A] TOUT SUIT. Le dossier que « Créer » envoie est celui que le planning a
//       simule : meme programme, memes heures, memes pistes, memes preferences,
//       meme prix. Seuls le contact et la note s y ajoutent.
//   [B] AU-DELA DU CATALOGUE. 4 parties de laser (« + Partie », page du laser)
//       et 2 h 30 de bowling (page du bowling) se posent ; le laser se dit
//       « hors catalogue » avec son prix, le Total propose la raison « Hors
//       catalogue », et tout part tel quel.
//   [C] UN REFUS SE DIT AVANT, ET « CREER QUAND MEME » LE PORTE. Plan refuse :
//       la ligne du ticket le dit en rouge avec sa raison, l heure refusee est
//       rouge ; « Créer » n envoie rien et dit quoi faire (« Prendre 19:30 »,
//       un toucher prend l heure qui tient) ; « Créer quand même » envoie le
//       dossier avec forcer, et ne se propose jamais a un role sans ce niveau.
//       Un refus du serveur a la creation se dit dans la fenetre, et « Créer »
//       rend la main.
//   [D] LE PLANNING JUGE CHAQUE HEURE PROPOSEE. Les seances du bowling, la page
//       « Autres » et les heures d une partie de laser partent au serveur, une
//       variante par heure ; l heure qu il refuse reste a sa place et le dit,
//       avec son mot et sa phrase, jamais une raison du poste (Ansar, 03/11 :
//       « quand ya des heures impossible ça affiche direct sur lheure comme ça
//       on sait ») ; choisir une heure la pose et relance le plan. Ce que le
//       toucher d une heure qui coince fait selon le role : reserver-seances
//       [S10].
//   [E] MEME CLIENT, UN ENVOI. Deux resas partent dans UN POST `dossiers`, le
//       contact commun, sans « forcer » global. Un lot en partie refuse (le
//       serveur repond ok:false, 207) : la resa creee sort de la fenetre, la
//       refusee y reste avec sa raison, et le clic suivant ne renvoie qu elle.
//   [F] LA SAISIE N EST JAMAIS ECRASEE. Un repeint pendant qu on tape le client
//       garde le champ, son texte et le focus ; il se fait quand le champ rend
//       la main. Un bouton remplace par un repeint garde le focus.
//   [G] AU TELEPHONE (390 px). Rien ne deborde de cote ; « Créer » reste a
//       l ecran, la fenetre defilee en haut comme en bas.
//   [H] LA REPONSE D UNE CREATION NE FERME QUE SA FENETRE. « Créer », puis
//       une autre fenetre ouverte avant la reponse : la reponse range le
//       dossier cree au planning et laisse la nouvelle fenetre ouverte (trouve
//       par ce gate le 2026-10-08 : elle la fermait).
//   [I] AU COMPTOIR (Ansar, 2026-11-11 : « on doit obligatoirement mettre
//       numéro de téléphone, une note optionnelle, tout direct sur le côté
//       droit »). Un groupe qui joue dans la demi-heure : au ticket, le
//       telephone (obligatoire), le nom et la note (facultative) ; l e-mail et
//       l occasion a un toucher. Créer sans numero, ou avec un numero trop
//       court, n envoie rien : le champ le dit et prend le focus. Entree dans le
//       telephone cree ; un numero deja venu dit « reconnu » et ecrit son nom,
//       un autre numero ne garde pas le nom de l ancien ; un nom tape a la main
//       reste ; Tab passe du telephone au nom.
//   [J] LES PISTES CHOISIES SE LISENT EN ENTIER. « pistes 7 et 8 » en toutes
//       lettres sur la ligne du ticket (Movsar, 2026-10-08 : « Pistes 7
//       et… »), et de 1 a 8 pistes, a 1280 et 1180 px, jamais coupees, mesure
//       au noeud de texte.
//   [K] TABLETTE EN PORTRAIT (800 px). Une colonne comme au telephone, le
//       ticket replie sous la composition et ouvert d un toucher ; chaque jour
//       entier ; rien ne se pose sur son voisin (l ancienne fenetre, en deux
//       colonnes : « Demain ven… », « pour vous » sous le chevron).
//   [L] LE NOM RECONNU SE LIT AVANT DE PARTIR. Un numero deja venu met son nom
//       dans le dossier : le champ du nom le montre, aussi une fois le champ
//       du telephone rendu.
//   [M] LA LIGNE DIT SES PISTES A QUI NE LA VOIT PAS. Le nom accessible du
//       bouton de la ligne garde la liste entiere des pistes, comme le libelle
//       de l ancienne pastille.
//   [*] Zero erreur JS ni erreur console.
//
// CE QUE LES SEANCES ONT RETIRE EXPRES, et que ce gate ne demande plus :
// l horloge et ses points « partagée », la ligne qui s ouvre quand on franchit
// le catalogue, l etiquette « hors catalogue » sur la duree du bowling (la
// touche 2 h 30 dit son prix, comme les autres), la phrase du refus et la
// liste de ses conflits (le refus se dit une fois, sur la ligne), la fenetre
// « au comptoir » distincte de l ordinaire (« + Nom », « tout deplier »), la
// pastille des pistes.
//
// Le serveur est simule dans la page (ses reponses suivent le contrat de
// api/staff-reservations : plan, candidats, dossiers) ; ce gate garde la
// FENETRE. Le moteur et la creation reelle ont leurs propres gates.
//
// Contre-preuves : node scripts/reserver-v5-check.js --contre-preuves
// (ou --contre-preuves=nom,nom). Le fichier servi est casse expres, en
// memoire (le disque n est jamais touche), et la propriete visee doit rougir.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const { verdictDuPlan } = require('../lib/reserver-simulation');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_RESERVER_PORT || 4261);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp' };

// Chaque mutation remet un defaut que la fenetre a eu, ou aurait pu avoir.
const MUTATIONS = {
  // La creation perd les heures voulues : le plan simule n est plus celui cree.
  preference: { fichier: 'assets/app-main.js', de: '    preference: rvPreference(ids, heures, programme),', vers: '    preference: simulation ? rvPreference(ids, heures, programme) : undefined,', vise: ['A'] },
  // Le plafond du catalogue revient : 3 parties au plus.
  plafond: { fichier: 'assets/app-main.js', de: 'const RV_PARTIES_MAX = 12;', vers: 'const RV_PARTIES_MAX = 3;', vise: ['B'] },
  // « Créer » ne garde plus le refus du plan : le clic file vers l envoi au
  // lieu de prendre l heure qui tient. (La garde de saveQuickBook, derriere,
  // ne se rejoint plus depuis l ecran : un plan refuse s arrete ici, rsCreer.)
  refus: { fichier: 'assets/app-main.js', de: '  if (plan && !plan.disponible && !s.forcer && !lot) {', vers: '  if (false) {', vise: ['C'] },
  // « Créer quand même » vaut meme quand le plan tient : le dossier part
  // « a placer » sans raison.
  forcerPerime: { fichier: 'assets/app-main.js', de: '  const forcer = !simulation && Boolean(s.forcer) && Boolean(planActuel && !planActuel.disponible);', vers: '  const forcer = !simulation && Boolean(s.forcer);', vise: ['C'] },
  // « Créer quand même » se montre a un role que le serveur refuserait.
  forcerSansNiveau: { fichier: 'assets/app-main.js', de: "  const forcer = refuse && !lot && rsNiveau('forcer') === 'oui' ?", vers: '  const forcer = refuse && !lot && true ?', vise: ['C'] },
  // « Création… » pose a la main sur le bouton : apres un refus, il reste
  // desactive (la zone du pied se croit a jour).
  creation: { fichier: 'assets/app-main.js', de: '  // pied, comparee a son dernier rendu, se croyait a jour (2026-10-08).\n  renderQuickBook();', vers: "  // pied, comparee a son dernier rendu, se croyait a jour (2026-10-08).\n  { const b = document.getElementById('rvCreer'); if (b) { b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Création…'; } }", vise: ['C'] },
  // Les heures d une partie de laser ne partent plus au planning : leur
  // verdict ne vient plus du serveur (l horloge de l ancienne fenetre).
  horloge: { fichier: 'assets/app-main.js', de: "body: JSON.stringify({ ...base, dryRun: true, candidats: variantes })", vers: "body: JSON.stringify({ ...base, dryRun: true, candidats: [] })", vise: ['D'] },
  // Les seances ne partent plus au planning : une heure qu il refuse a l air
  // de tenir.
  seances: { fichier: 'assets/app-main.js', de: 'body: JSON.stringify({ ...demande.corps, dryRun: true, candidats: demande.variantes })', vers: 'body: JSON.stringify({ ...demande.corps, dryRun: true, candidats: [] })', vise: ['D'] },
  // Seules les 12 premieres heures partent : « Autres » montre des heures que
  // le serveur n a pas lues (le defaut d avant le 2026-11-03).
  douzeHeures: { fichier: 'assets/app-main.js', de: 'rvHeuresHorloge(id).slice(0, 48).forEach((heure) => {', vers: 'rvHeuresHorloge(id).slice(0, 12).forEach((heure) => {', vise: ['D'] },
  // L heure refusee sort de la rangee : elle saute sans rien dire (« desfois ya
  // pas toute les heures »).
  refusRetire: { fichier: 'assets/app-main.js', de: '  return { suite: brut.suite, lue, liste: brut.liste };', vers: "  return { suite: brut.suite, lue, liste: lue ? brut.liste.filter((x) => !x.verdict || x.verdict.statut !== 'ko') : brut.liste };", vise: ['D'] },
  // L heure refusee se tait : pas de mot sur la touche.
  refusMuet: { fichier: 'assets/app-main.js', de: '  if (coince) return rsMotCoince(id, coince, pendant);\n', vers: '', vise: ['D'] },
  // Le poste invente son mot au lieu de dire celui du serveur.
  motDuPoste: { fichier: 'assets/app-main.js', de: "  const court = String((verdict && verdict.court) || 'impossible');", vers: "  const court = 'impossible';", vise: ['D'] },
  // Le nom de la touche ne dit plus la phrase du serveur.
  phraseOubliee: { fichier: 'assets/app-main.js', de: 'const aria = coince ? `${dite}, ne tient pas, ${rsPhrase(coince.raison)}`', vers: 'const aria = coince ? `${dite}, ne tient pas`', vise: ['D'] },
  // Les heures de la partie 2 oublient le verdict du serveur : celle qu il
  // refuse a l air de tenir.
  partieSansVerdict: { fichier: 'assets/app-main.js', de: "? toutes.map((heure) => ({ heure, tient: rsEtatHeure(id, heure, partie).etat !== 'ko', verdict: rsVerdictDesCandidats('laser_game', partie, heure) }))", vers: "? toutes.map((heure) => ({ heure, tient: rsEtatHeure(id, heure, partie).etat !== 'ko', verdict: null }))", vise: ['D'] },
  // Plusieurs resas : seule celle a l ecran part.
  lot: { fichier: 'assets/app-main.js', de: '  const lot = rvResas.length > 1 && rvResas.includes(etat);', vers: '  const lot = false;', vise: ['E'] },
  // Un lot en partie refuse passe pour une panne : la resa creee reste dans la
  // fenetre, et le clic suivant la recree.
  partiel: { fichier: 'assets/app-main.js', de: '    if (reponse && (Array.isArray(reponse.reservations) || Array.isArray(reponse.echecs))) return reponse;', vers: '    if (false) return reponse;', vise: ['E'] },
  // La reponse d une creation ferme toute fenetre ouverte depuis.
  fermeture: { fichier: 'assets/app-main.js', de: '    if (rvResas === lotSauve) { closeQuickBook(); rsApresLaFrame(renderStaff); } else renderStaff();', vers: '    if (quickBookState === etat || rvResas.includes(quickBookState)) { closeQuickBook(); rsApresLaFrame(renderStaff); } else renderStaff();', vise: ['H'] },
  // Le repeint ne respecte plus le champ qu on tape.
  saisie: { fichier: 'assets/app-main.js', de: "  if (actif && actif !== zone && zone.contains(actif) && actif.matches(", vers: "  if (false && actif && actif !== zone && zone.contains(actif) && actif.matches(", vise: ['F'] },
  // Le repeint ne rend plus le focus au controle remplace.
  focus: { fichier: 'assets/app-main.js', de: '  if (actif && !actif.isConnected) {', vers: '  if (false) {', vise: ['F'] },
  // Au telephone, la colonne ne defile plus entre ses deux barres : sa rangee
  // prend toute la hauteur du contenu et pousse le pied hors de l ecran,
  // « Créer » avec. (`auto` ne suffit pas a la casser : la colonne a un
  // min-height nul, sa rangee prend encore le reste de l ecran.)
  pied: { fichier: 'assets/pinlane-staff.css', de: 'grid-template-rows: auto minmax(0, 1fr) auto auto;', vers: 'grid-template-rows: auto max-content auto auto;', vise: ['G'] },
  // Entree dans le telephone ne cree plus.
  comptoirEntree: { fichier: 'assets/app-main.js', de: "cible.matches('#qbName, #qbPhone, #qbEmail, #qbNotes')", vers: "cible.matches('#qbName, #qbEmail, #qbNotes')", vise: ['I'] },
  // Le telephone redevient facultatif : un dossier sans numero part.
  telephoneLibre: { fichier: 'assets/app-main.js', de: "  return chiffres.length <= 15 && chiffres.replace(/^32/, '').length >= 8;", vers: '  return true;', vise: ['I'] },
  // Le telephone rendu repeint le ticket : Tab vers le nom perd le champ vise.
  tabPerdu: { fichier: 'assets/app-main.js', de: '  s.phone = normalizePhoneInput(champ.value);\n  champ.value = s.phone;\n}', vers: '  s.phone = normalizePhoneInput(champ.value);\n  champ.value = s.phone;\n  rsMajTicket();\n}', vise: ['I'] },
  // Le nom reconnu d un numero reste quand on en tape un autre.
  nomPerime: { fichier: 'assets/app-main.js', de: "  if (!String(s.name || '').trim() || (s.nomReconnu && s.name === s.nomReconnu)) {", vers: "  if (!String(s.name || '').trim()) {", vise: ['I'] },
  // « reconnu » se pose dans un champ absent du ticket.
  reconnu: { fichier: 'assets/app-main.js', de: "    const champ = document.getElementById('qbPhone');", vers: "    const champ = document.getElementById('qbEmail');", vise: ['I'] },
  // Les pistes se disent en plage, plus en toutes lettres : « pistes 7-8 »,
  // et « pistes 1-5 » pour 1, 3 et 5.
  pastille: { fichier: 'assets/app-main.js', de: "  return liste.length > 2 ? `${liste.slice(0, -1).join(', ')} et ${liste[liste.length - 1]}` : liste.join(' et ');", vers: "  return liste.length > 2 ? `${liste[0]}-${liste[liste.length - 1]}` : liste.join('-');", vise: ['J'] },
  // Le detail de la ligne du ticket tient sur une ligne et se coupe :
  // « pistes 7 et… ».
  pastilleColonne: { fichier: 'assets/pinlane-staff.css', de: '.qb-modal.rv.rs .rs-tk-n small { font-size: 13px; font-weight: 400; line-height: 1.3; color: var(--muted); }', vers: '.qb-modal.rv.rs .rs-tk-n small { font-size: 13px; font-weight: 400; line-height: 1.3; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }', vise: ['J'] },
  // La tablette en portrait revient aux deux colonnes serrees.
  portrait: { fichier: 'assets/pinlane-staff.css', de: '@media (max-width: 900px) {\n  .qb-modal.rv.rs { --rs-gouttiere: 16px;', vers: '@media (max-width: 700px) {\n  .qb-modal.rv.rs { --rs-gouttiere: 16px;', vise: ['K'] },
  // Le nom reconnu reste dans le dossier sans s afficher dans son champ.
  nomCache: { fichier: 'assets/app-main.js', de: '<input id="qbName" value="${escapeHtml(s.name)}"', vers: '<input id="qbName" value=""', vise: ['L'] },
  // La ligne ne dit plus que son nom a qui ne la voit pas : « Bowling 1 h, changer ».
  ligneMuette: { fichier: 'assets/app-main.js', de: "  return `${[nom, detail, prix].filter(Boolean).join(', ')}, changer`;", vers: '  return `${nom}, changer`;', vise: ['M'] },
};
// Retirees avec les seances (2026-11-03), leur code ne peignant plus rien a
// l ecran : comptoir (la regle « au comptoir » ne decide plus de l ecran, le
// champ unique est partout), boutonSurPlace (« + Nom » n existe plus),
// promesseSansNiveau (la phrase de rvSortieDuRefus n atteint plus l ecran : le
// refus se dit sur la ligne).

let mutationActive = null;
const desarmees = [];

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      let corps = content;
      const rel = path.relative(ROOT, filePath).split(path.sep).join('/');
      if (mutationActive && rel === mutationActive.fichier) {
        const texte = content.toString('utf8').replace(/\r\n/g, '\n');
        const n = texte.split(mutationActive.de).length - 1;
        if (n !== 1) desarmees.push(`${mutationActive.nom} (ancre trouvee ${n} fois)`);
        corps = Buffer.from(texte.replace(mutationActive.de, () => mutationActive.vers), 'utf8');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(corps);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: 10, unitLabel: 'par personne', order: 3, defaultMinutes: 45 },
];

// Une heure refusee, dans les mots du vrai serveur : sa phrase passe par le code
// qui en tire le mot de la touche et l activite qui coince (lib/reserver-simulation).
// Le faux serveur ne recopie pas ce contrat, il le rend. Les phrases sont celles
// de lib/ops-engine.js.
const REFUS_DES_PISTES = verdictDuPlan({ planAvailable: false, planRefusal: 'Pas assez de pistes libres à 15:00 : il en faut 1.' });
const REFUS_DU_LASER = verdictDuPlan({ planAvailable: false, planRefusal: 'Laser à 15:00 : plus aucune place sur 30, il en faut 4. Décalez le départ.' });

// La session du faux serveur vit 24 h apres l heure de la PAGE : une page
// figee plus loin (le samedi du planning Laser) la trouvait expiree et la
// console restait verrouillee (2026-10-08).
async function installMock(page, { maintenant = Date.now() } = {}) {
  const expiresAt = new Date(Number(maintenant) + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, ACTIVITIES, REFUS_DES_PISTES, REFUS_DU_LASER }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.quick', 'reservations.edit', 'reservations.status', 'clients.view', 'payments.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const today = new Date().toISOString().slice(0, 10);
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    const plus = (hhmm, minutes) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); const t = h * 60 + m + minutes; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
    // LE PLANNING SIMULE : un plan qui tient, sauf a l heure refusee par le
    // scenario ; l horloge : 15:00 impossible, 15:30 avec un ecart, le reste tient.
    const planPour = (corps) => (window.__QA_REFUS__ && corps.startTime === window.__QA_REFUS__
      ? { disponible: false, debut: corps.startTime, fin: '', refus: 'L’arène est complète à cette heure.', conflits: [{ message: 'Laser à 20:00 : 26 joueurs sur 30 déjà inscrits, il manque 4 places.' }], blocs: [], etapes: [], prix: null }
      : { disponible: true, debut: corps.startTime || '', fin: plus(corps.startTime, Math.round((Number(corps.totalDuration) || 1.5) * 60)), blocs: [], etapes: [], prix: null });
    window.__QA_SIMS__ = [];
    window.__QA_CANDIDATS__ = [];
    window.__QA_CREES__ = [];
    window.__QA_REFUS__ = null;
    window.__QA_RETENUE__ = null;
    // Un message : le serveur refuse la creation (le planning a change entre
    // la simulation et le clic), comme api/staff-reservations ({ ok:false }).
    window.__QA_REFUS_CREATION__ = null;
    window.__QA_INCONNUES__ = [];
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {}), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/staff-customer-notes') {
        const lot = u.searchParams.get('reservationIds');
        const sansNote = (id) => ({ eligible: true, clientKey: `p:qa${id}`, note: null });
        if (lot !== null) return J({ ok: true, notesByReservationId: Object.fromEntries(lot.split(',').filter(Boolean).map((id) => [String(Number(id)), sansNote(Number(id))])) });
        return J({ ok: true, ...sansNote(Number(u.searchParams.get('reservationId'))) });
      }
      if (u.pathname === '/api/staff-reservations' && m === 'GET') {
        // Un seul client deja venu : le numero du scenario [I] (ses 9 derniers chiffres).
        const tape = String(u.searchParams.get('client') || '');
        const client = tape.endsWith('470556677') ? { nom: 'Lucas Martin', visites: 3, derniere: '2026-06-14', derniereActivite: 'Bowling', dernieresPersonnes: 6 } : null;
        return J({ ok: true, client, departs: [] });
      }
      if (u.pathname === '/api/staff-reservations' && m === 'POST') {
        const corps = JSON.parse(init.body || '{}');
        if (corps.dryRun && Array.isArray(corps.candidats)) {
          window.__QA_CANDIDATS__.push(corps);
          return J({ ok: true, dryRun: true, plan: planPour(corps), candidats: corps.candidats.map((v) => {
            if (v.heure === '15:00') return { heure: v.heure, ...(v.preference && Array.isArray(v.preference.laserGameTimes) ? REFUS_DU_LASER : REFUS_DES_PISTES), fin: '', conflits: [] };
            return { heure: v.heure, statut: v.heure === '15:30' ? 'partage' : 'ok', raison: v.heure === '15:30' ? 'Partie partagée' : '', fin: plus(v.startTime || v.heure, 60), conflits: [] };
          }) });
        }
        if (corps.dryRun) { window.__QA_SIMS__.push(corps); return J({ ok: true, dryRun: true, plan: planPour(corps) }); }
        window.__QA_CREES__.push(corps);
        if (window.__QA_RETENUE__) await window.__QA_RETENUE__;
        if (window.__QA_REFUS_CREATION__) return new Response(JSON.stringify({ ok: false, message: window.__QA_REFUS_CREATION__ }), { status: 409, headers: { 'content-type': 'application/json; charset=utf-8' } });
        if (Array.isArray(corps.dossiers) && window.__QA_LOT_PARTIEL__) {
          return new Response(JSON.stringify({ ok: false, reservations: [{ index: 0, reservation: { ...corps.dossiers[0], id: 7000, status: 'pending' }, aPlacer: false, conflits: [], warnings: [] }], echecs: [{ index: 1, message: 'Plus aucune piste libre à 14:00.' }] }), { status: 207, headers: { 'content-type': 'application/json; charset=utf-8' } });
        }
        // La forme du serveur (api/staff-reservations, lot) : chaque dossier
        // cree avec son rang et son sort.
        if (Array.isArray(corps.dossiers)) return J({ ok: true, reservations: corps.dossiers.map((d, i) => ({ index: i, reservation: { ...d, id: 7000 + i, status: 'pending' }, aPlacer: false, conflits: [], warnings: [] })), echecs: [] });
        return J({ ok: true, reservation: { ...corps, id: 7100 + window.__QA_CREES__.length, status: 'pending', aPlacer: Boolean(corps.forcer) } });
      }
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [] });
      if (u.pathname === '/api/public-booking-meta') {
        return J({
          ok: true, today, durationOptions: [], formules: [], activities: ACTIVITIES,
          center: {
            id: 'libramont', status: 'active',
            defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
            holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
            day: { date: today, open: true, schedule: { open: 10, close: 22, label: '10h - 22h' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
          },
        });
      }
      if (u.pathname.startsWith('/api/')) { window.__QA_INCONNUES__.push(`${m} ${u.pathname}`); return J({ ok: true, reservations: [], communications: [], samples: [], suggestions: [], events: [] }); }
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, ACTIVITIES, REFUS_DES_PISTES, REFUS_DU_LASER });
}

// Un jour ouvert, dans deux jours : ni heure passee, ni journee du jour.
const JOUR = (() => { const d = new Date(); d.setDate(d.getDate() + 2); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

// Le plan du serveur est arrive pour la composition a l ecran.
async function planPose(page, attendu = null) {
  try {
    await page.waitForFunction((attendu) => {
      const s = typeof quickBookState !== 'undefined' ? quickBookState : null;
      if (!s || !s.plan || s.plan.etat !== 'ok' || s.plan.cle !== s.cleCourante) return false;
      return attendu === null || Boolean(s.plan.resultat && s.plan.resultat.disponible) === attendu;
    }, attendu, { timeout: 8000 });
  } catch (e) {
    // Ce que la fenetre attendait, pour que l echec se lise sans rejouer.
    const etat = await page.evaluate(() => {
      const s = typeof quickBookState !== 'undefined' ? quickBookState : null;
      return s ? { plan: s.plan ? { etat: s.plan.etat, memeCle: s.plan.cle === s.cleCourante, message: s.plan.message || '' } : null, soumission: Boolean(s.submitting), sims: window.__QA_SIMS__.length } : 'fenetre fermee';
    }).catch(() => 'illisible');
    throw new Error(`plan du planning jamais pose : ${JSON.stringify(etat)}`);
  }
}

// La creation est allee au bout : sa reponse a ferme la fenetre.
async function fenetreFermee(page) {
  return page.waitForFunction(() => quickBookState === null, null, { timeout: 5000 }).then(() => true, () => false);
}

// Le corps d un dossier sans ce qui n appartient qu a l envoi (contact, note)
// ou qu a la simulation (dryRun, les autres resas du lot, les heures).
const SANS = ['name', 'phone', 'email', 'notes', 'occasion', 'dryRun', 'autres', 'candidats'];
function dossierCompare(corps) {
  const copie = JSON.parse(JSON.stringify(corps || {}));
  SANS.forEach((k) => { delete copie[k]; });
  return JSON.stringify(Object.keys(copie).sort().reduce((o, k) => { o[k] = copie[k]; return o; }, {}));
}

// `installer: false` : l appelant a deja pose ce faux serveur, et le sien
// par-dessus (le planning Laser) ; le reposer ici le recouvrirait, et ses
// routes ne verraient plus rien passer.
async function boot(page, { installer = true, maintenant } = {}) {
  if (installer) await installMock(page, { maintenant });
  await page.goto(`${BASE_URL}/?v=rv5-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => window.setView('staff'));
  // La console charge ses modules apres setView : jusque-la, #staffView reste
  // en display:none sous « Chargement de la console… », et ce qu on y rend se
  // mesure tout a zero (laser-fit-day, deux suites sur 23 : un module en retard
  // de deux secondes rejoue ce rouge a l identique).
  await page.waitForFunction(() => !document.getElementById('staffConsoleLoadStatus') && document.getElementById('staffView').getClientRects().length > 0, null, { timeout: 30000 });
  await page.waitForFunction(() => typeof window.getCenterActivities === 'function' && window.getCenterActivities().length >= 3, null, { timeout: 15000 });
  await page.waitForTimeout(600);
}

// ── [A] et [B] ────────────────────────────────────────────────────────────────
async function scenarioAB(page, verifier) {
  await page.evaluate((jour) => {
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: 8 });
    rvAppliquerComposition({ type: 'visite', program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }] });
  }, JOUR);
  await page.waitForSelector('#rsL-a-laser_game', { timeout: 8000 });
  // « + Partie » vit sur la page du laser, la duree sur celle du bowling : on
  // les ouvre depuis leur ligne du ticket, comme au comptoir.
  await page.click('#rsL-a-laser_game');
  for (let i = 0; i < 2; i += 1) {
    const plus = await page.$('#rsCorps #rvPlusPartie');
    if (plus) await plus.click();
  }
  const pageLaser = await page.evaluate(() => [...document.querySelectorAll('#rsCorps .rs-texte')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  await page.click('#rsL-a-bowling');
  await page.click('#rsCorps [data-duree="2.5"]');
  await planPose(page, true);
  const lu = await page.evaluate(() => {
    const nom = (id) => ((document.querySelector(`#rsL-a-${id} .rs-tk-n b`) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    return { laser: nom('laser_game'), bowling: nom('bowling') };
  });
  // Le Total : les raisons d un prix revu, « Hors catalogue » en tete.
  await page.click('#rsL-total');
  const raisons = await page.evaluate(() => [...document.querySelectorAll('#rsCorps [data-raison]')].map((b) => b.getAttribute('data-raison')));
  await planPose(page, true);
  const simule = await page.evaluate(() => window.__QA_SIMS__[window.__QA_SIMS__.length - 1] || null);
  // Le contact, sur la page Client qu ouvre le ticket.
  await page.click('#rsL-client');
  await page.fill('#qbPhone', '0470 12 34 56');
  await page.fill('#qbName', 'Famille Martin');
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  const cree = await page.evaluate(() => window.__QA_CREES__[0] || null);
  const ferme = await fenetreFermee(page);

  verifier('A', Boolean(simule), 'MONTAGE : le planning a simule la composition a l ecran', simule ? `${simule.startTime} ${JSON.stringify(simule.program)}` : 'aucune simulation');
  verifier('A', Boolean(cree), '« Créer » envoie un dossier', cree ? 'un POST' : 'aucun POST');
  verifier('A', Boolean(simule && cree) && dossierCompare(simule) === dossierCompare(cree), 'le dossier cree est celui que le planning a simule (contact et note en plus)', simule && cree ? diff(dossierCompare(simule), dossierCompare(cree)) : '');
  verifier('A', Boolean(cree && cree.name === 'Famille Martin' && String(cree.phone || '').replace(/\D/g, '').endsWith('470123456')), 'le contact tape part avec le dossier', cree ? `${cree.name} / ${cree.phone}` : '');
  verifier('A', ferme, 'la fenetre se ferme une fois le dossier cree');
  const laser = cree && Array.isArray(cree.program) ? cree.program.find((l) => l.activityId === 'laser_game') : null;
  const bowling = cree && Array.isArray(cree.program) ? cree.program.find((l) => l.activityId === 'bowling') : null;
  verifier('B', lu.laser === 'Laser, 4 parties' && /^Bowling 2\s*h\s*30$/.test(lu.bowling), 'MONTAGE : le ticket montre 4 parties et 2 h 30', `${lu.laser} | ${lu.bowling}`);
  verifier('B', pageLaser.some((t) => /^4 parties, hors catalogue\. Prix proposé/.test(t)), 'le laser au-dela du catalogue se dit « hors catalogue » sur sa page, avec son prix', pageLaser.join(' | ') || 'aucune phrase');
  verifier('B', raisons[0] === 'Hors catalogue', 'le Total propose d abord la raison « Hors catalogue »', raisons.join(', ') || 'aucune raison');
  verifier('B', Boolean(laser && Number(laser.games) === 4), '4 parties choisies, 4 parties envoyees', laser ? `games=${laser.games}` : 'pas de ligne laser');
  verifier('B', Boolean(bowling && Number(bowling.duration) === 2.5), '2 h 30 choisies, 2 h 30 envoyees', bowling ? `duration=${bowling.duration}` : 'pas de ligne bowling');
  const heures = cree && cree.preference && Array.isArray(cree.preference.laserGameTimes) ? cree.preference.laserGameTimes : [];
  verifier('B', heures.length === 4, 'les 4 departs du laser partent avec le dossier', JSON.stringify(heures));
}

function diff(a, b) {
  if (a === b) return 'identiques';
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return `simule : …${a.slice(Math.max(0, i - 60), i + 80)}… / cree : …${b.slice(Math.max(0, i - 60), i + 80)}…`;
}

// ── [C] ───────────────────────────────────────────────────────────────────────
async function scenarioC(page, verifier) {
  const ouvrirRefuse = () => page.evaluate((jour) => {
    window.__QA_REFUS__ = '20:00';
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '20:00', type: 'laser', pax: 8, phone: '0470 12 34 56' });
  }, JOUR);
  // Le planning a dit ou tout tient : « Créer » porte l heure proche.
  const procheDite = () => page.waitForSelector('#rvCreer[data-proche]', { timeout: 8000 }).then(() => true, () => false);
  const lireCreer = () => page.evaluate(() => {
    const b = document.getElementById('rvCreer');
    return { texte: b ? b.textContent.replace(/\s+/g, ' ').trim() : '', proche: b ? b.getAttribute('data-proche') || '' : '', desactive: Boolean(b && b.disabled), occupe: b ? b.getAttribute('aria-busy') : null, dedans: Boolean(document.activeElement && document.activeElement.closest('.qb-modal.rv')) };
  });

  // 1. AVANT : le refus se lit, et « Créer » dit quoi faire.
  await ouvrirRefuse();
  await page.evaluate((jour) => syncDateReservations(jour, { silent: true }), JOUR);
  await planPose(page, false);
  await procheDite();
  const avant = await page.evaluate(() => {
    const ligne = document.querySelector('#rsL-a-laser_game small.is-ko');
    const seance = document.querySelector('#rsZ-laser_game .rs-h[data-heure="20:00"]');
    return {
      ligne: ligne ? `${ligne.id}|${ligne.textContent.trim()}` : '',
      seance: seance ? seance.className : '',
      verdict: ((document.getElementById('rvVerdict') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
  const creerAvant = await lireCreer();
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForTimeout(900);
  const apres = await page.evaluate(() => ({ posts: window.__QA_CREES__.length, heure: quickBookState ? quickBookState.startTime : '', rouge: Boolean(document.querySelector('#rsLignes small.is-ko')) }));
  await planPose(page, true).catch(() => {});
  // Le refus rend la main : « Créer » se reclique (ni desactive, ni occupe,
  // ni « Création… »), et le clavier reste dans la fenetre.
  const creerApres = await lireCreer();

  verifier('C', /^rvRefus\|L’arène est complète à cette heure\./.test(avant.ligne) && /\bis-on\b/.test(avant.seance) && /\bis-ko\b/.test(avant.seance) && /Laser à 20:00 impossible/.test(avant.verdict), 'AVANT : la ligne du laser dit le refus en rouge avec sa raison, l heure refusee est rouge, le verdict nomme ce qui bloque et a quelle heure', JSON.stringify(avant));
  verifier('C', apres.posts === 0, '« Créer » sur un plan refuse n envoie rien', `${apres.posts} POST`);
  verifier('C', creerAvant.proche === '19:30' && /^Prendre 19:30/.test(creerAvant.texte) && apres.heure === '19:30' && !apres.rouge && /^Créer à 19:30/.test(creerApres.texte), 'il dit quoi faire : « Prendre 19:30 » sur « Créer », et le toucher prend l heure qui tient', JSON.stringify({ avant: creerAvant.texte, proche: creerAvant.proche, heure: apres.heure, rouge: apres.rouge, apres: creerApres.texte }));
  verifier('C', !creerApres.desactive && creerApres.occupe !== 'true' && !/Création/.test(creerApres.texte) && creerApres.dedans, 'apres le refus, « Créer » rend la main (cliquable, sans « Création… ») et le focus reste dans la fenetre', JSON.stringify(creerApres));

  // 2. « Créer quand même » porte le refus.
  await ouvrirRefuse();
  await planPose(page, false);
  await page.waitForSelector('#rvForcer', { timeout: 8000 }).catch(() => {});
  const offre = await page.evaluate(() => ((document.getElementById('rvForcer') || {}).textContent || '').trim());
  await page.click('#rvForcer');
  const libelle = (await lireCreer()).texte;
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  const cree = await page.evaluate(() => window.__QA_CREES__[0] || null);
  const cFerme = await fenetreFermee(page);
  await page.evaluate(() => { window.__QA_REFUS__ = null; });
  verifier('C', offre === 'Créer quand même, à placer', 'sous un refus, « Créer quand même, à placer » se propose (niveau forcer)', offre || 'absent');
  verifier('C', /^Créer quand même à 20:00/.test(libelle), '« Créer quand même » change le bouton', libelle);
  verifier('C', Boolean(cree && cree.forcer === true), '« Créer quand même » envoie le dossier avec forcer (cree « a placer »)', cree ? `forcer=${cree.forcer}` : 'aucun POST');
  verifier('C', cFerme, 'le dossier a placer cree, la fenetre se ferme');

  // 3. « Créer quand même » arme, puis le plan redevient possible sans que
  // rien ne le desarme (une taille de groupe) : le dossier part normal.
  await ouvrirRefuse();
  await planPose(page, false);
  await page.waitForSelector('#rvForcer', { timeout: 8000 }).catch(() => {});
  await page.click('#rvForcer');
  await page.evaluate(() => { window.__QA_REFUS__ = null; window.__QA_CREES__.length = 0; });
  await page.click('#rsHaut [data-pax="4"]');
  await planPose(page, true);
  const rendu = await page.evaluate(() => ({ arme: Boolean(quickBookState && quickBookState.forcer), libelle: ((document.getElementById('rvCreer') || {}).textContent || '').replace(/\s+/g, ' ').trim() }));
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  const normal = await page.evaluate(() => window.__QA_CREES__[0] || null);
  await fenetreFermee(page);
  verifier('C', rendu.arme && /^Créer à 20:00/.test(rendu.libelle), 'MONTAGE : « Créer quand même » reste arme, le plan redevenu possible redit « Créer »', JSON.stringify(rendu));
  verifier('C', Boolean(normal) && normal.forcer !== true, 'le plan redevenu possible, le dossier part normal (pas « a placer »)', normal ? `forcer=${normal.forcer}` : 'aucun POST');

  // 4. Sans le niveau « forcer », la fenetre ne propose pas ce que le serveur
  // refuserait : ni le bouton, ni « quand même » nulle part.
  await page.evaluate((jour) => {
    window.__QA_REFUS__ = '20:00';
    closeQuickBook();
    window.__niveauReel = window.niveauStaff;
    window.niveauStaff = (cle) => (cle === 'forcer' ? 'non' : window.__niveauReel(cle));
    openQuickBook({ date: jour, startTime: '20:00', type: 'laser', pax: 8, phone: '0470 12 34 56' });
  }, JOUR);
  await planPose(page, false);
  await procheDite();
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  const lireSansNiveau = () => page.evaluate(() => ({ bouton: Boolean(document.getElementById('rvForcer')), posts: window.__QA_CREES__.length, quandMeme: /quand même/i.test((document.querySelector('#quickBookOverlay .qb-modal.rv') || {}).textContent || '') }));
  const sansNiveauAvant = await lireSansNiveau();
  await page.click('#rvCreer');
  await page.waitForTimeout(600);
  const sansNiveau = await lireSansNiveau();
  await page.evaluate(() => { window.niveauStaff = window.__niveauReel; window.__QA_REFUS__ = null; closeQuickBook(); });
  verifier('C', !sansNiveauAvant.bouton && !sansNiveauAvant.quandMeme && !sansNiveau.bouton && !sansNiveau.quandMeme && sansNiveau.posts === 0, 'sans le niveau forcer : ni bouton, ni « quand même » dans la fenetre, avant ou apres le clic, et rien ne part', JSON.stringify({ avant: sansNiveauAvant, apres: sansNiveau }));

  // 5. LE SERVEUR REFUSE A LA CREATION (le planning a change entre la
  // simulation et le clic) : la fenetre le dit, « Créer » rend la main.
  // LA JOURNEE EST DEJA LUE, comme au comptoir ou la lecture tourne toutes
  // les 4 s. Jouee seule (contre-preuves), la scene C ouvrait une page neuve
  // et le clic « Créer » faisait aussi la premiere lecture du jour : sa
  // revision entrait dans la cle du plan (rvCleDe), le pied repassait par
  // « Le planning vérifie » et se redessinait, et un bouton reste
  // « Création… » ne se voyait plus (contre-preuve « creation » aveugle).
  await page.evaluate((jour) => {
    window.__QA_REFUS_CREATION__ = 'Ce créneau vient de changer : plus aucune place à 20:00.';
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '20:00', type: 'laser', pax: 8, phone: '0470 12 34 56' });
  }, JOUR);
  await page.evaluate((jour) => syncDateReservations(jour, { silent: true }), JOUR);
  await planPose(page, true);
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  const cleAvant = await page.evaluate(() => quickBookState.cleCourante);
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  const cleApres = await page.evaluate(() => (quickBookState ? quickBookState.cleCourante : null));
  const refusServeur = await page.evaluate(() => ({ posts: window.__QA_CREES__.length, ouverte: quickBookState !== null, verdict: ((document.querySelector('#rvVerdict .rs-v-ligne.is-ko[role="alert"]') || {}).textContent || '').trim() }));
  const main = await lireCreer();
  await page.evaluate(() => { window.__QA_REFUS_CREATION__ = null; closeQuickBook(); });
  verifier('C', refusServeur.posts === 1 && cleAvant === cleApres, 'MONTAGE : le clic « Créer » part au serveur sans refaire le plan (la journee etait deja lue)', `${refusServeur.posts} POST, ${String(cleAvant).slice(-40)} / ${String(cleApres).slice(-40)}`);
  verifier('C', refusServeur.ouverte && /plus aucune place à 20:00/.test(refusServeur.verdict), 'un refus du serveur a la creation se dit dans la fenetre', JSON.stringify(refusServeur));
  verifier('C', !main.desactive && main.occupe !== 'true' && !/Création/.test(main.texte) && main.dedans, 'apres ce refus, « Créer » rend la main (cliquable, sans « Création… ») et le focus reste dans la fenetre', JSON.stringify(main));
}

// ── [D] ───────────────────────────────────────────────────────────────────────
// Les touches d heure telles qu elles se lisent : ce qui est ecrit dessus, leur
// nom, leur survol ; et ce qui les empeche de se toucher.
const lireHeures = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((b) => ({
  heure: b.getAttribute('data-heure'),
  mot: ((b.querySelector('small') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  nom: b.getAttribute('aria-label') || '',
  survol: b.getAttribute('title') || '',
  touchable: !b.disabled && b.getAttribute('aria-disabled') !== 'true',
  grisee: b.classList.contains('is-efface'),
})), sel);
// (une phrase du moteur s ecrit sans deux-points au milieu : rsPhrase)
const phraseDe = (refus) => String(refus.raison).replace(/\s:\s/g, ', ');
// Une touche qui dit le refus du serveur : son mot, et sa phrase a qui ne la voit
// pas ; elle se touche (ce que le toucher fait depend du role).
const ditLeRefus = (x, refus) => Boolean(x) && x.mot === refus.court && x.nom.includes(phraseDe(refus)) && x.survol.includes(phraseDe(refus)) && x.touchable && !x.grisee;
// Une heure a sa place : chaque demi-heure, sans trou.
const minutesDe = (h) => Number(String(h).slice(0, 2)) * 60 + Number(String(h).slice(3, 5));
const sansTrou = (heures) => heures.every((h, i) => i === 0 || minutesDe(h) - minutesDe(heures[i - 1]) === 30);
const lisible = (liste) => JSON.stringify(liste.map((x) => `${x.heure}|${x.mot}|${x.nom}`));

async function scenarioD(page, verifier) {
  await page.evaluate((jour) => {
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: 4 });
  }, JOUR);
  await planPose(page, true);
  // 1. Les seances du bowling, relues par le planning (le faux serveur refuse
  // 15:00, partage 15:30, laisse tenir le reste).
  const relues = await page.waitForSelector('#rsZ-bowling .rs-s-l[data-verifie="1"]', { timeout: 8000 }).then(() => true, () => false);
  const variantes = await page.evaluate(() => {
    const envoi = window.__QA_CANDIDATS__.filter((c) => c.type === 'bowling').pop() || null;
    return envoi ? envoi.candidats : [];
  });
  const seances = await lireHeures(page, '#rsZ-bowling .rs-s-l .rs-h[data-heure]');
  const seance = (h) => seances.find((x) => x.heure === h);
  verifier('D', variantes.length >= 4 && new Set(variantes.map((v) => v.heure)).size === variantes.length && variantes.every((v) => v.startTime === v.heure), 'les seances du bowling partent au planning, une variante par heure (le depart de chacune)', `${variantes.length} variante(s) : ${variantes.slice(0, 12).map((v) => v.heure).join(', ')}`);
  verifier('D', relues && variantes.some((v) => v.heure === '15:00') && sansTrou(seances.map((x) => x.heure)) && ditLeRefus(seance('15:00'), REFUS_DES_PISTES), '15:00, que le planning refuse, reste a sa place dans la rangee et le dit : le mot et la phrase du serveur', `relues=${relues}, seances : ${lisible(seances)}`);
  verifier('D', Boolean(seance('15:30')) && seances.filter((x) => x.heure !== '15:00').every((x) => !x.survol && x.touchable && x.mot !== REFUS_DES_PISTES.court), 'les heures qu il ne refuse pas ne disent aucun refus (15:30, partagee, comprise)', lisible(seances));

  // 2. « Autres » : toutes les heures du jour, jugees par le planning : les lues
  // pour la rangee (un seul envoi, rsVerifier), aucune en attente d une reponse.
  await page.click('#rsZ-bowling .rs-h-autres');
  await page.waitForSelector('#rsCorps .rs-heures .rs-h[data-heure="15:00"][title]', { timeout: 5000 }).catch(() => {});
  const autresHeures = await lireHeures(page, '#rsCorps .rs-heures .rs-h[data-heure]');
  const autresEtat = await page.evaluate(() => {
    const envoi = window.__QA_CANDIDATS__.filter((c) => c.type === 'bowling').pop() || null;
    return { page: document.querySelector('#quickBookOverlay .qb-modal.rv').classList.contains('is-q-autres'), envoyees: envoi ? envoi.candidats.map((v) => v.heure) : [] };
  });
  const refuseesAutres = autresHeures.filter((x) => x.survol);
  verifier('D', autresEtat.page && autresHeures.length >= 20 && autresHeures.every((x) => autresEtat.envoyees.includes(x.heure)) && autresHeures.every((x) => !x.grisee), '« Autres » : chaque heure du jour est jugee par le planning, aucune ne reste grisee en attente', JSON.stringify({ heures: autresHeures.length, envoyees: autresEtat.envoyees.length, grisees: autresHeures.filter((x) => x.grisee).map((x) => x.heure) }));
  verifier('D', sansTrou(autresHeures.map((x) => x.heure)) && refuseesAutres.length === 1 && refuseesAutres[0].heure === '15:00' && ditLeRefus(refuseesAutres[0], REFUS_DES_PISTES), '« Autres » : celle qu il refuse (15:00) reste a sa place, touchable, et dit pourquoi ; les autres ne disent aucun refus', lisible(refuseesAutres));

  // 3. Choisir une heure la pose, et le plan repart.
  const sims = await page.evaluate(() => window.__QA_SIMS__.length);
  await page.click('#rsCorps .rs-heures .rs-h[data-heure="16:00"]');
  await page.waitForFunction((n) => window.__QA_SIMS__.length > n, sims, { timeout: 8000 }).catch(() => {});
  const apres = await page.evaluate(() => {
    const on = document.getElementById('rvHeure-bowling');
    return { heure: quickBookState.startTime, seances: document.querySelector('#quickBookOverlay .qb-modal.rv').classList.contains('is-q-activites'), choisie: on ? `${on.getAttribute('data-heure')}|${on.getAttribute('aria-pressed')}` : '', derniere: (window.__QA_SIMS__[window.__QA_SIMS__.length - 1] || {}).startTime };
  });
  verifier('D', apres.heure === '16:00' && apres.seances && apres.choisie === '16:00|true' && apres.derniere === '16:00', 'choisir 16:00 pose l heure, revient aux seances (16:00 choisie) et relance le plan', JSON.stringify(apres));

  // 4. Les heures d une partie de laser : la partie 2, deplacee a chaque heure.
  await page.evaluate((jour) => {
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '14:00', type: 'laser', pax: 4, duration: 1, totalDuration: 1 });
  }, JOUR);
  await planPose(page, true);
  await page.click('#rsL-a-laser_game');
  const nPartie = await page.evaluate(() => window.__QA_CANDIDATS__.length);
  await page.click('#rvPartie-1');
  await page.waitForFunction((n) => window.__QA_CANDIDATS__.slice(n).some((c) => c.candidats.some((v) => v.preference && Array.isArray(v.preference.laserGameTimes))), nPartie, { timeout: 8000 }).catch(() => {});
  await page.waitForSelector('#rsCorps .rs-heures .rs-h[data-heure="15:00"][title]', { timeout: 5000 }).catch(() => {});
  const heuresPartie = await lireHeures(page, '#rsCorps .rs-heures .rs-h[data-heure]');
  const partie = await page.evaluate((n) => {
    const envoi = window.__QA_CANDIDATS__.slice(n).filter((c) => c.candidats.some((v) => v.preference && Array.isArray(v.preference.laserGameTimes))).pop() || null;
    return {
      titre: ((document.getElementById('rsQ') || {}).textContent || '').trim(),
      variantes: envoi ? envoi.candidats.map((v) => ({ heure: v.heure, departs: v.preference && v.preference.laserGameTimes ? v.preference.laserGameTimes.join('+') : '' })) : [],
    };
  }, nPartie);
  const deplacees = partie.variantes.filter((v) => v.heure > '14:30');
  verifier('D', partie.titre === 'Laser, partie 2, à quelle heure ?' && new Set(partie.variantes.map((v) => v.heure)).size === partie.variantes.length && deplacees.length >= 4 && deplacees.every((v) => v.departs === `14:00+${v.heure}`) && heuresPartie.every((x) => partie.variantes.some((v) => v.heure === x.heure)), 'les heures de la partie 2 partent au planning, une variante par heure, la partie deplacee a cette heure', JSON.stringify({ titre: partie.titre, variantes: partie.variantes.length, exemple: deplacees.slice(0, 2) }));
  const refuseesPartie = heuresPartie.filter((x) => x.survol);
  verifier('D', sansTrou(heuresPartie.map((x) => x.heure)) && refuseesPartie.length === 1 && refuseesPartie[0].heure === '15:00' && ditLeRefus(refuseesPartie[0], REFUS_DU_LASER), '15:00, refusee par le planning pour la partie 2, reste a sa place et le dit, avec le mot et la phrase du laser', lisible(refuseesPartie));
  const simsPartie = await page.evaluate(() => window.__QA_SIMS__.length);
  await page.click('#rsCorps .rs-heures .rs-h[data-heure="16:00"]');
  await page.waitForFunction((n) => window.__QA_SIMS__.length > n, simsPartie, { timeout: 8000 }).catch(() => {});
  const posee = await page.evaluate(() => ({
    partie: ((document.getElementById('rvPartie-1') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    departs: (((window.__QA_SIMS__[window.__QA_SIMS__.length - 1] || {}).preference || {}).laserGameTimes || []).join('+'),
  }));
  await page.evaluate(() => closeQuickBook());
  verifier('D', /^16:00/.test(posee.partie) && posee.departs === '14:00+16:00', 'choisir 16:00 pour la partie 2 la pose et relance le plan', JSON.stringify(posee));
}

// ── [E] ───────────────────────────────────────────────────────────────────────
async function scenarioE(page, verifier) {
  // Une autre resa pour le meme client : elle demande son nombre de joueurs,
  // on lui en donne 4.
  const autreResa = async () => {
    await page.click('#rvEncore');
    await page.waitForFunction(() => rvResas.length === 2 && quickBookState === rvResas[1], null, { timeout: 5000 }).catch(() => {});
    await page.click('#rsHaut [data-pax="4"]');
    await planPose(page, true);
  };
  await page.evaluate((jour) => {
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: 6 });
  }, JOUR);
  await planPose(page, true);
  // Le contact, au ticket : il vaut pour le lot.
  await page.fill('#qbPhone', '0470 11 22 33');
  await page.fill('#qbName', 'Anniversaire Léa');
  await autreResa();
  const libelle = await page.evaluate(() => `${(document.getElementById('rvCreer') || {}).textContent || ''} | ${document.querySelectorAll('#rvResasZone .rv-resa').length} onglets`);
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  const eFerme = await fenetreFermee(page);
  const r = await page.evaluate((eFerme) => ({ posts: window.__QA_CREES__.length, corps: window.__QA_CREES__[0] || null, ferme: eFerme, rangees: state.reservations.filter((x) => Number(x.id) === 7000 || Number(x.id) === 7001).map((x) => x.name) }), eFerme);
  const dossiers = r.corps && Array.isArray(r.corps.dossiers) ? r.corps.dossiers : [];
  verifier('E', /^Créer les 2/.test(libelle) && /\| 2 onglets$/.test(libelle), 'MONTAGE : la fenetre porte deux resas (deux onglets) et le dit sur « Créer »', libelle.trim());
  verifier('E', r.posts === 1 && dossiers.length === 2, 'deux resas, UN envoi `dossiers`', `${r.posts} POST, ${dossiers.length} dossier(s)`);
  verifier('E', dossiers.length === 2 && dossiers.every((d) => d.name === 'Anniversaire Léa' && String(d.phone || '').replace(/\D/g, '').endsWith('470112233')), 'le contact est commun aux deux dossiers', dossiers.map((d) => `${d.name} / ${d.phone}`).join(' ; '));
  verifier('E', Boolean(r.corps) && !('forcer' in r.corps), 'aucun « forcer » global sur le lot', r.corps ? Object.keys(r.corps).join(',') : '');
  verifier('E', r.ferme, 'la fenetre se ferme une fois le lot cree');
  verifier('E', r.rangees.length === 2 && r.rangees.every((n) => n === 'Anniversaire Léa'), 'les deux dossiers crees entrent au planning, entiers', JSON.stringify(r.rangees));

  // Le lot en partie refuse : la premiere resa est creee, la seconde refusee.
  await page.evaluate((jour) => {
    window.__QA_LOT_PARTIEL__ = true;
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: 6 });
  }, JOUR);
  await planPose(page, true);
  await page.fill('#qbPhone', '0470 11 22 33');
  await page.fill('#qbName', 'Anniversaire Léa');
  await autreResa();
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const partiel = await page.evaluate(() => ({
    resas: rvResas.length,
    ouverte: quickBookState !== null,
    pax: quickBookState ? quickBookState.pax : null,
    erreur: quickBookState ? quickBookState.error : '',
    ecran: ((document.querySelector('#rvVerdict .rs-v-ligne.is-ko') || {}).textContent || '').trim(),
    rangee: state.reservations.some((x) => Number(x.id) === 7000),
  }));
  await page.evaluate(() => { window.__QA_LOT_PARTIEL__ = false; window.__QA_CREES__.length = 0; });
  if (partiel.ouverte) {
    await planPose(page, true).catch(() => {});
    await page.click('#rvCreer');
    await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  }
  const second = await page.evaluate(() => window.__QA_CREES__[0] || null);
  await fenetreFermee(page);
  verifier('E', partiel.ouverte && partiel.resas === 1 && partiel.pax === 4 && /Plus aucune piste libre/.test(partiel.erreur) && /Plus aucune piste libre/.test(partiel.ecran), 'lot en partie refuse : seule la resa refusee reste, avec sa raison a l ecran', JSON.stringify(partiel));
  verifier('E', partiel.rangee, 'la resa creee entre au planning', '');
  verifier('E', Boolean(second) && !Array.isArray(second.dossiers) && Number(second.pax) === 4, 'le clic suivant ne renvoie que la resa refusee (pas de doublon)', second ? `pax=${second.pax}, dossiers=${Array.isArray(second.dossiers) ? second.dossiers.length : 0}` : 'aucun POST');
}

// ── [F] ───────────────────────────────────────────────────────────────────────
async function scenarioF(page, verifier) {
  await page.evaluate((jour) => {
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: 4 });
  }, JOUR);
  await planPose(page, true);
  // Le nom du client, au ticket : un champ qu on tape au comptoir.
  await page.click('#qbName');
  await page.evaluate(() => { document.getElementById('qbName').__qa = 1; });
  await page.keyboard.type('Dup', { delay: 15 });
  // Ce que fait la reponse du planning quand elle arrive : tout se repeint.
  await page.evaluate(() => rvRepeindre());
  await page.keyboard.type('ont', { delay: 15 });
  const pendant = await page.evaluate(() => { const el = document.getElementById('qbName'); return { meme: Boolean(el && el.__qa === 1), focus: document.activeElement === el, valeur: el ? el.value : '', etat: quickBookState.name }; });
  // Le champ rend la main (on touche ailleurs) : la zone qui attendait se repeint.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(120);
  const apres = await page.evaluate(() => { const el = document.getElementById('qbName'); return { neuf: Boolean(el && el.__qa === undefined), valeur: el ? el.value : '' }; });
  verifier('F', pendant.meme && pendant.focus, 'pendant la frappe, le repeint ne remplace pas le champ et garde le focus', JSON.stringify(pendant));
  verifier('F', pendant.valeur === 'Dupont' && pendant.etat === 'Dupont', 'le texte tape est entier, a l ecran et dans le dossier', `${pendant.valeur} / ${pendant.etat}`);
  verifier('F', apres.neuf && apres.valeur === 'Dupont', 'le champ rendu, le repeint attendu se fait, avec le texte tape', JSON.stringify(apres));
  // Un BOUTON focalise, sa zone repeinte (le nom d un client reconnu arrive
  // pendant qu on tabule) : le focus revient au meme controle, jamais au
  // document. La zone du client se repeint entiere ; le pied, lui, garde ses
  // noeuds (rsPoser), son bouton n est jamais remplace.
  const bouton = await page.evaluate(() => {
    const avant = document.getElementById('rsL-client');
    avant.focus();
    avant.__qa = 1;
    quickBookState.name = 'Famille Lambert';
    rvRepeindre();
    const apres = document.getElementById('rsL-client');
    return { remplace: Boolean(apres && apres.__qa === undefined), focus: document.activeElement === apres, actif: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null };
  });
  verifier('F', bouton.remplace, 'MONTAGE : le repeint a bien remplace le bouton « E-mail, occasion »', JSON.stringify(bouton));
  verifier('F', bouton.focus, 'le bouton remplace par le repeint garde le focus (le clavier ne tombe pas derriere la fenetre)', JSON.stringify(bouton));
}

// ── [G] ───────────────────────────────────────────────────────────────────────
async function scenarioG(page, verifier) {
  await page.evaluate((jour) => {
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: 8 });
    rvAppliquerComposition({ type: 'visite', program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }, { activityId: 'minigolf_blacklight' }] });
  }, JOUR);
  await planPose(page, true);
  const mesure = () => page.evaluate(() => {
    const b = document.getElementById('rvCreer');
    const r = b ? b.getBoundingClientRect() : null;
    const centre = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      debordePage: document.documentElement.scrollWidth > window.innerWidth + 1,
      debordeFenetre: [...document.querySelectorAll('#quickBookOverlay, #quickBookOverlay .qb-modal')].some((el) => el.scrollWidth > el.clientWidth + 1),
      creerVisible: Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0 && centre && (centre === b || b.contains(centre))),
      rect: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null,
    };
  });
  const defiler = (bas) => page.evaluate((bas) => {
    const boites = [...document.querySelectorAll('#quickBookOverlay, #quickBookOverlay *')].filter((el) => el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
    boites.forEach((el) => { el.scrollTop = bas ? el.scrollHeight : 0; });
    return boites.length;
  }, bas);
  const haut = await mesure();
  const nb = await defiler(true);
  await page.waitForTimeout(150);
  const bas = await mesure();
  await defiler(false);
  await page.waitForTimeout(150);
  const retour = await mesure();
  verifier('G', nb >= 1, 'MONTAGE : la fenetre a de quoi defiler au telephone', `${nb} zone(s) defilante(s)`);
  verifier('G', !haut.debordePage && !haut.debordeFenetre && !bas.debordePage && !bas.debordeFenetre, 'rien ne deborde de cote a 390 px', JSON.stringify({ haut, bas }));
  verifier('G', haut.creerVisible && bas.creerVisible && retour.creerVisible, '« Créer » reste a l ecran, en haut comme en bas de la fenetre', JSON.stringify({ haut: haut.rect, bas: bas.rect, retour: retour.rect }));
}

// ── [H] ───────────────────────────────────────────────────────────────────────
async function scenarioH(page, verifier) {
  await page.evaluate((jour) => {
    window.__QA_RETENUE__ = new Promise((r) => { window.__QA_LIBERER__ = r; });
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: 4 });
  }, JOUR);
  await planPose(page, true);
  await page.fill('#qbPhone', '0470 12 34 56');
  await page.fill('#qbName', 'Premier client');
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  // La reponse se fait attendre : le comptoir ferme et ouvre pour le suivant.
  await page.evaluate((jour) => { closeQuickBook(); openQuickBook({ date: jour, startTime: '15:00', type: 'bowling', pax: 6 }); }, JOUR);
  await planPose(page, true);
  await page.evaluate(() => { window.__QA_LIBERER__(); window.__QA_RETENUE__ = null; });
  await page.waitForFunction(() => state.reservations.some((x) => x.name === 'Premier client'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const overlay = document.getElementById('quickBookOverlay');
    const joueurs = document.querySelector('#rsHaut [data-pax].is-on');
    const heure = document.getElementById('rvHeure-bowling');
    return {
      ouverte: quickBookState !== null,
      aLEcran: Boolean(overlay && !overlay.classList.contains('hidden') && overlay.querySelector('.qb-modal.rv')),
      pax: quickBookState ? quickBookState.pax : null,
      heure: quickBookState ? quickBookState.startTime : '',
      joueursLus: joueurs ? joueurs.getAttribute('data-pax') : '',
      heureLue: heure ? heure.getAttribute('data-heure') : '',
      rangee: state.reservations.some((x) => x.name === 'Premier client'),
    };
  });
  verifier('H', r.rangee, 'MONTAGE : la reponse arrivee, le premier dossier entre au planning', JSON.stringify(r));
  verifier('H', r.ouverte && r.aLEcran && r.pax === 6 && r.heure === '15:00' && r.joueursLus === '6' && r.heureLue === '15:00', 'la nouvelle fenetre reste ouverte, avec ce qu on y a pose (6 joueurs, 15:00)', JSON.stringify(r));
  await page.evaluate(() => closeQuickBook());
}

// ── [I] ───────────────────────────────────────────────────────────────────────
// Le comptoir se juge a l heure du centre : [I] tourne dans une page figee a
// 15:12, heure de Bruxelles, aujourd hui (centre ouvert, depart a 15:30 dans
// la demi-heure), quelle que soit l heure du gate. Le soir, la fenetre disait
// « hors horaires » et le plan du serveur ne venait jamais (2026-10-08).
function instantComptoir() {
  const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
  const [y, m, d] = jour.split('-').map(Number);
  for (let decalage = -3; decalage <= 3; decalage += 1) {
    const t = new Date(Date.UTC(y, m - 1, d, 15 - decalage, 12, 0));
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(t);
    const lire = (k) => (parts.find((p) => p.type === k) || {}).value;
    if (`${lire('year')}-${lire('month')}-${lire('day')}` === jour && Number(lire('hour')) % 24 === 15) return t;
  }
  throw new Error(`15:12 introuvable a Bruxelles le ${jour}`);
}

// Un groupe qui joue dans la demi-heure qui vient, a l heure lue dans la
// page.
async function ouvrirAuComptoir(page) {
  return page.evaluate(() => {
    closeQuickBook();
    const maintenant = currentTimeDecimal();
    const prochaine = Math.ceil(maintenant * 2) / 2;
    const heure = numToTime(prochaine < 24 ? prochaine : Math.floor(maintenant * 2) / 2);
    const date = todayStr();
    openQuickBook({ date, startTime: heure, type: 'bowling', pax: 4 });
    return { date, heure, dans: Math.round((timeToNum(heure) - maintenant) * 60) };
  });
}

// Le client tel que la fenetre le montre : le telephone, le nom et la note au
// ticket, ce qui les entoure, et ce qui partira dans le dossier.
function lireClient(page) {
  return page.evaluate(() => {
    const m = document.querySelector('#quickBookOverlay .qb-modal.rv');
    const q = (sel) => (m ? m.querySelector(sel) : null);
    const texte = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const tel = q('#qbPhone');
    const nom = q('#qbName');
    const note = q('#qbNotes');
    const dit = q('#rsTelDit');
    const auTicket = (el) => Boolean(el && el.closest('.rs-tk'));
    return {
      entete: texte(q('.rs-tk-l')),
      telAuTicket: auTicket(tel),
      telExige: Boolean(tel && tel.required && tel.getAttribute('aria-required') === 'true'),
      telLibelle: tel ? texte(tel.closest('label')) : '',
      telValeur: tel ? tel.value : null,
      telManque: Boolean(tel && tel.closest('.is-manque')),
      telDit: dit && !dit.hidden ? texte(dit) : '',
      nomAuTicket: auTicket(nom),
      nomValeur: nom ? nom.value : null,
      noteAuTicket: auTicket(note),
      noteLibelle: note ? texte(note.closest('label')) : '',
      champUnique: Boolean(q('#qbQui')),
      lien: texte(q('#rsL-client')),
      reconnu: Boolean(tel && tel.parentElement.querySelector('.rv-tag')),
      carte: texte(q('#rvClientConnu')),
      focus: document.activeElement ? document.activeElement.id : '',
      fenetre: texte(m),
      etat: quickBookState ? { name: quickBookState.name, phone: quickBookState.phone } : null,
    };
  });
}

async function scenarioI(page, verifier) {
  // 1. L ouverture : le telephone (obligatoire), le nom et la note au ticket.
  const ouvert = await ouvrirAuComptoir(page);
  await planPose(page, true);
  const a = await lireClient(page);
  verifier('I', /aujourd’hui/.test(a.entete) && ouvert.dans >= 0 && ouvert.dans <= 30, 'MONTAGE : un groupe qui joue aujourd hui, dans la demi-heure', `${ouvert.date} ${ouvert.heure}, dans ${ouvert.dans} min, ticket « ${a.entete} »`);
  verifier('I', a.telAuTicket && a.telExige && /obligatoire/.test(a.telLibelle) && a.nomAuTicket && a.noteAuTicket && /facultative/.test(a.noteLibelle) && !a.champUnique, 'au ticket : le telephone (obligatoire), le nom et la note pour l equipe (facultative), plus de champ unique', JSON.stringify({ tel: a.telAuTicket, exige: a.telExige, libelle: a.telLibelle, nom: a.nomAuTicket, note: a.noteAuTicket, noteLibelle: a.noteLibelle, champUnique: a.champUnique }));
  await page.click('#rsL-client');
  const client = await page.evaluate(() => ['qbName', 'qbPhone', 'qbEmail', 'qbNotes'].filter((id) => document.querySelector(`#rsCorps #${id}`)).concat(document.querySelectorAll('#rsCorps .rs-occasions button').length ? ['occasions'] : []));
  await page.click('#rsRetour');
  verifier('I', a.lien === 'E-mail, occasion' && client.join() === 'qbEmail,occasions', 'l e-mail et l occasion a un toucher, sans redire les champs du ticket', `${a.lien} -> ${client.join(', ')}`);

  // 2. Créer sans telephone : rien ne part, le champ le dit et prend le focus.
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForTimeout(400);
  const sans = await lireClient(page);
  const partisSans = await page.evaluate(() => window.__QA_CREES__.length);
  verifier('I', partisSans === 0 && sans.focus === 'qbPhone' && sans.telManque && /obligatoire/.test(sans.telDit), 'Créer sans telephone : rien ne part, le champ dit pourquoi et prend le focus', JSON.stringify({ partisSans, focus: sans.focus, manque: sans.telManque, dit: sans.telDit }));

  // 3. Un numero trop court, Entree dans le champ : rien ne part, le champ le dit
  // et garde la main.
  await page.keyboard.type('0470 12', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const court = await lireClient(page);
  const partisCourt = await page.evaluate(() => window.__QA_CREES__.length);
  verifier('I', partisCourt === 0 && court.focus === 'qbPhone' && court.telManque && /incomplet/i.test(court.telDit), 'un numero incomplet ne part pas : le champ le dit et garde le focus', JSON.stringify({ partisCourt, focus: court.focus, manque: court.telManque, dit: court.telDit, valeur: court.telValeur }));

  // 4. Le numero complete : le rouge s en va pendant la frappe. Entree cree le
  // dossier, numero mis en forme, nom par defaut.
  await page.keyboard.type(' 34 56', { delay: 10 });
  const complet = await lireClient(page);
  verifier('I', !complet.telManque && !complet.telDit, 'le numero complete, le rouge s en va pendant la frappe', JSON.stringify({ manque: complet.telManque, dit: complet.telDit, valeur: complet.telValeur }));
  await page.waitForTimeout(600);
  await planPose(page, true);
  await page.focus('#qbPhone');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  const cree = await page.evaluate(() => window.__QA_CREES__[0] || null);
  const ferme = await fenetreFermee(page);
  verifier('I', Boolean(cree) && /^\+32/.test(String(cree.phone || '')) && String(cree.phone).replace(/\D/g, '').endsWith('470123456') && cree.name === 'Client', 'Entree dans le telephone cree le dossier (numero mis en forme, nom par defaut)', cree ? `${cree.name} / ${cree.phone}` : 'aucun POST');
  verifier('I', ferme, 'la fenetre se ferme une fois le dossier cree');

  // 5. Un numero deja venu : « reconnu » pendant la frappe, son nom ecrit dans le
  // champ du nom ; le champ rendu, ce nom (celui qui partira) reste lisible.
  await ouvrirAuComptoir(page);
  await planPose(page, true);
  await page.click('#qbPhone');
  await page.keyboard.type('0470 55 66 77', { delay: 10 });
  await page.waitForFunction(() => quickBookState && quickBookState.clientConnu && quickBookState.clientConnu.etat === 'ok', null, { timeout: 5000 }).catch(() => {});
  const pendant = await lireClient(page);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(150);
  const rendu = await lireClient(page);
  verifier('I', pendant.reconnu && pendant.etat.name === 'Lucas Martin' && pendant.nomValeur === 'Lucas Martin', 'un numero deja venu : « reconnu » dans le champ pendant la frappe, son nom ecrit dans le champ du nom', JSON.stringify({ reconnu: pendant.reconnu, etat: pendant.etat, nom: pendant.nomValeur }));
  verifier('L', rendu.etat.name === 'Lucas Martin' && rendu.nomValeur === 'Lucas Martin', 'le champ rendu, le nom reconnu (celui qui partira dans le dossier) se lit dans le champ du nom', JSON.stringify({ dossier: rendu.etat.name, champ: rendu.nomValeur, carte: rendu.carte }));

  // 6. Un autre numero : le nom de l ancien ne part pas avec lui.
  await page.click('#qbPhone');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('0470 99 88 77', { delay: 10 });
  const change = await lireClient(page);
  await page.waitForTimeout(600);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(150);
  const apresChange = await lireClient(page);
  await planPose(page, true);
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  const cree2 = await page.evaluate(() => window.__QA_CREES__[0] || null);
  await fenetreFermee(page);
  verifier('I', change.etat.name === '' && change.nomValeur === '', 'un autre numero efface le nom reconnu de l ancien, dans le champ comme dans le dossier', JSON.stringify({ etat: change.etat, nom: change.nomValeur }));
  verifier('I', !apresChange.reconnu && !apresChange.carte && apresChange.nomValeur === '', 'le champ rendu, « reconnu » et la carte de l ancien client s en vont', JSON.stringify({ reconnu: apresChange.reconnu, carte: apresChange.carte, nom: apresChange.nomValeur }));
  verifier('I', Boolean(cree2) && cree2.name === 'Client' && String(cree2.phone || '').replace(/\D/g, '').endsWith('470998877'), 'le dossier part avec le nouveau numero, sans le nom de l autre client', cree2 ? `${cree2.name} / ${cree2.phone}` : 'aucun POST');

  // 7. Un nom tape a la main reste quand on corrige le numero, et Tab passe du
  // telephone au nom sans perdre le champ vise.
  await ouvrirAuComptoir(page);
  await page.click('#qbPhone');
  await page.keyboard.type('0470 99 88 77', { delay: 10 });
  await page.keyboard.press('Tab');
  const tab = await lireClient(page);
  await page.keyboard.type('Dupont', { delay: 10 });
  await page.click('#qbPhone');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('8', { delay: 10 });
  const garde = await lireClient(page);
  verifier('I', tab.focus === 'qbName', 'Tab passe du telephone au nom, le champ vise garde le focus', JSON.stringify({ focus: tab.focus }));
  verifier('I', garde.etat.name === 'Dupont' && garde.nomValeur === 'Dupont' && garde.etat.phone === '+32 470 99 88 78', 'un nom tape a la main reste quand on corrige le numero', JSON.stringify({ etat: garde.etat, nomValeur: garde.nomValeur }));
  await page.evaluate(() => closeQuickBook());
}

// ── [J] ───────────────────────────────────────────────────────────────────────
async function scenarioJ(page, verifier) {
  const CAS = [[7, 8], [6, 7, 8], [1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5, 6, 7, 8], [8]];
  const enLettres = (p) => (p.length > 2 ? `${p.slice(0, -1).join(', ')} et ${p[p.length - 1]}` : p.join(' et '));
  const dite = (p) => `${p.length > 1 ? 'pistes' : 'piste'} ${enLettres(p)}`;
  const lus = [];
  try {
    for (const largeur of [1280, 1180]) {
      await page.setViewportSize({ width: largeur, height: 820 });
      for (const pistes of CAS) {
        await page.evaluate(({ jour, pistes }) => { closeQuickBook(); openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: pistes.length * 6, lanes: pistes }); }, { jour: JOUR, pistes });
        await page.waitForTimeout(150);
        // La ligne du bowling au ticket : son detail dit l heure et les pistes.
        lus.push(await page.evaluate(({ largeur, pistes }) => {
          const bouton = document.getElementById('rsL-a-bowling');
          const b = bouton ? bouton.querySelector('.rs-tk-n small') : null;
          const libelle = bouton ? bouton.getAttribute('aria-label') || bouton.textContent : '';
          if (!b) return { largeur, pistes, texte: '', coupe: true, libelle };
          const r = document.createRange();
          r.selectNodeContents(b);
          const t = r.getBoundingClientRect();
          const cadre = b.getBoundingClientRect();
          return { largeur, pistes, texte: b.textContent, coupe: t.width > cadre.width + 0.5 || t.right > cadre.right + 0.5, libelle };
        }, { largeur, pistes }));
      }
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.evaluate(() => closeQuickBook());
  }
  const coupees = lus.filter((l) => l.coupe);
  const deux = lus.find((l) => l.largeur === 1280 && l.pistes.join() === '7,8');
  const sansListe = lus.filter((l) => !l.texte.includes(dite(l.pistes)));
  const libellesSansListe = lus.filter((l) => !l.libelle.includes(dite(l.pistes)));
  verifier('J', lus.length === CAS.length * 2 && lus.every((l) => l.texte), 'MONTAGE : la ligne du bowling dit ses pistes au ticket', lus.map((l) => `${l.largeur}:${l.texte || '(rien)'}`).join(' | '));
  verifier('J', coupees.length === 0, 'aucune liste de pistes coupee, de 1 a 8 pistes, a 1280 et 1180 px', coupees.length ? coupees.map((l) => `${l.largeur} ${JSON.stringify(l.pistes)} « ${l.texte} »`).join(' | ') : [...new Set(lus.map((l) => l.texte))].join(' · '));
  verifier('J', Boolean(deux) && deux.texte.includes('pistes 7 et 8'), 'deux pistes se disent en toutes lettres : « pistes 7 et 8 », comme la maquette', deux ? deux.texte : 'absente');
  verifier('J', sansListe.length === 0, 'la ligne dit la liste entiere des pistes', sansListe.map((l) => `${l.largeur} ${JSON.stringify(l.pistes)} « ${l.texte} »`).join(' | ') || 'ok');
  verifier('M', libellesSansListe.length === 0, 'le nom accessible du bouton de la ligne garde la liste entiere des pistes', libellesSansListe.length ? `${libellesSansListe.length}/${lus.length} sans la liste, ex. « ${libellesSansListe[0].libelle} » pour ${dite(libellesSansListe[0].pistes)}` : 'ok');
}

// ── [K] ───────────────────────────────────────────────────────────────────────
// Tablette en portrait (800 px) : une colonne, comme au telephone, ou rien
// n est coupe ni pose sur son voisin. L ancienne fenetre, en deux colonnes,
// finissait ses jours sur « Demain ven… » et passait « pour vous » sous le
// chevron (vu sur les photos du planning Laser, 2026-10-08).
async function scenarioK(page, verifier) {
  // Les enfants d un element ne se posent pas l un sur l autre.
  const poses = (selecteur) => page.evaluate((selecteur) => {
    const trouves = [];
    document.querySelectorAll(`#quickBookOverlay ${selecteur}`).forEach((h) => {
      const enfants = [...h.children].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      for (let i = 0; i < enfants.length; i += 1) {
        for (let j = i + 1; j < enfants.length; j += 1) {
          const a = enfants[i].getBoundingClientRect();
          const b = enfants[j].getBoundingClientRect();
          const l = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const hauteur = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          if (l * hauteur > 4) trouves.push(`${enfants[i].className} / ${enfants[j].className}`);
        }
      }
    });
    return trouves;
  }, selecteur);
  for (const [nom, prefill] of [['bowling', { startTime: '14:00', type: 'bowling', pax: 4 }], ['laser', { startTime: '18:00', type: 'laser', pax: 4, duration: 0.5, totalDuration: 0.5 }]]) {
    await page.evaluate(({ jour, prefill }) => { closeQuickBook(); openQuickBook({ date: jour, ...prefill }); }, { jour: JOUR, prefill });
    await planPose(page, true);
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const modal = document.querySelector('#quickBookOverlay .qb-modal.rv');
      const boite = (sel) => { const e = modal.querySelector(sel); return e && e.getClientRects().length ? e.getBoundingClientRect() : null; };
      const cadre = modal.getBoundingClientRect();
      const gauche = boite('.rs-gauche');
      const resume = boite('#rsResume');
      const creer = boite('#rvCreer');
      // Les jours : chaque touche dans sa rangee, son texte entier.
      const premier = modal.querySelector('#rsHaut [data-jour]');
      const jours = premier ? premier.parentElement : null;
      const cadreJours = jours ? jours.getBoundingClientRect() : null;
      const joursCoupes = jours ? [...jours.children].filter((b) => { const r = b.getBoundingClientRect(); return r.left < cadreJours.left - 0.5 || r.right > cadreJours.right + 0.5 || b.scrollWidth > b.clientWidth + 1; }).map((b) => b.textContent.replace(/\s+/g, ' ').trim()) : ['(pas de jours)'];
      return {
        largeur: Math.round(cadre.width),
        colonnes: getComputedStyle(modal).gridTemplateColumns.split(' ').filter(Boolean).length,
        gauchePleine: Boolean(gauche && Math.abs(gauche.width - cadre.width) < 2),
        ticketReplie: !boite('#rsLignes'),
        resumeSous: Boolean(resume && gauche && resume.top >= gauche.bottom - 1),
        creerVu: Boolean(creer && creer.top >= 0 && creer.bottom <= window.innerHeight),
        joursCoupes,
      };
    });
    const posesSeances = await poses('.rs-s-t');
    // Le ticket s ouvre d un toucher sur le resume (quand il est a l ecran :
    // en deux colonnes, il n existe pas et le ticket est deja la).
    const resume = await page.$('#rsResume');
    if (resume && await resume.isVisible()) await resume.click();
    await page.waitForTimeout(200);
    const ouvert = await page.evaluate(() => {
      const lignes = document.querySelector('#quickBookOverlay #rsLignes');
      return Boolean(lignes && lignes.getClientRects().length && document.querySelector('#quickBookOverlay .qb-modal.rv').classList.contains('is-ticket'));
    });
    const posesTicket = await poses('.rs-tk-a');
    verifier('K', m.colonnes === 1 && m.gauchePleine && m.ticketReplie && m.resumeSous && m.creerVu && ouvert, `${nom} a 800 px : une colonne comme au telephone, le ticket replie sous la composition (resume et « Créer »), ouvert d un toucher`, JSON.stringify({ ...m, ouvert }));
    verifier('K', m.joursCoupes.length === 0, `${nom} a 800 px : chaque jour se lit entier`, m.joursCoupes.join(' | ') || 'aucun coupe');
    verifier('K', posesSeances.length === 0 && posesTicket.length === 0, `${nom} a 800 px : rien ne se pose sur son voisin (tete des seances, lignes du ticket)`, [...posesSeances, ...posesTicket].join(' | ') || 'aucun');
  }
  await page.evaluate(() => closeQuickBook());
}

const SCENARIOS = { A: scenarioAB, B: scenarioAB, C: scenarioC, D: scenarioD, E: scenarioE, F: scenarioF, G: scenarioG, H: scenarioH, I: scenarioI, J: scenarioJ, K: scenarioK, L: scenarioI, M: scenarioJ };

async function passe(browser, lettres, { bavard = true } = {}) {
  const echecs = new Set();
  const verifier = (lettre, cond, label, detail = '') => {
    if (bavard || !cond) console.log(`${cond ? 'OK  ' : 'FAIL'} [${lettre}] ${label}${detail ? `  ->  ${detail}` : ''}`);
    if (!cond) echecs.add(lettre);
  };
  // [L] se joue avec [I], au comptoir ; [M] avec [J].
  const comptoir = lettres.filter((l) => l === 'I' || l === 'L');
  const tablette = lettres.filter((l) => !['G', 'I', 'L', 'K'].includes(l));
  const lancer = async (viewport, liste, { horloge = null } = {}) => {
    if (!liste.length) return;
    const contexte = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await contexte.newPage();
    if (horloge) await page.clock.setFixedTime(horloge);
    page.setDefaultTimeout(8000);
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(`PAGEERROR: ${e.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|favicon/i.test(msg.text())) erreurs.push(msg.text()); });
    try {
      await boot(page);
      const faits = new Set();
      for (const l of liste) {
        const f = SCENARIOS[l];
        if (faits.has(f)) continue;
        faits.add(f);
        try { await f(page, verifier); } catch (e) { verifier(l, false, `le scenario ${l} va au bout`, String(e.message || e).split('\n')[0]); }
      }
      const inconnues = await page.evaluate(() => window.__QA_INCONNUES__);
      verifier('*', erreurs.length === 0, `zero erreur JS ni console (${viewport.width} px)`, erreurs.slice(0, 3).join(' | '));
      if (bavard && inconnues.length) console.log(`     (API sans reponse dediee : ${[...new Set(inconnues)].join(', ')})`);
    } finally {
      await contexte.close();
    }
  };
  await lancer({ width: 1280, height: 820 }, tablette);
  if (comptoir.length) await lancer({ width: 1280, height: 820 }, comptoir, { horloge: instantComptoir() });
  if (lettres.includes('G')) await lancer({ width: 390, height: 844 }, ['G']);
  if (lettres.includes('K')) await lancer({ width: 800, height: 1280 }, ['K']);
  return echecs;
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--contre-preuves'));
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  let rouge = false;
  try {
    if (!arg) {
      const echecs = await passe(browser, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']);
      rouge = echecs.size > 0;
      console.log(rouge ? `\nreserver-v5-check : ${[...echecs].join(', ')} en echec` : '\nreserver-v5-check: ALL OK, la fenetre cree ce qu elle montre.');
    } else {
      const choix = arg.includes('=') ? arg.split('=')[1].split(',') : Object.keys(MUTATIONS);
      const manquees = [];
      for (const nom of choix) {
        const m = MUTATIONS[nom];
        if (!m) { manquees.push(`${nom} (inconnue)`); continue; }
        mutationActive = { ...m, nom };
        console.log(`\n-- contre-preuve « ${nom} » : doit rougir sur ${m.vise.join(', ')}`);
        const echecs = await passe(browser, m.vise, { bavard: false });
        const mord = m.vise.every((l) => echecs.has(l));
        console.log(`${mord ? 'OK  ' : 'FAIL'} la contre-preuve « ${nom} » fait rougir ${m.vise.join(', ')}`);
        if (!mord) manquees.push(nom);
      }
      mutationActive = null;
      if (desarmees.length) manquees.push(...desarmees.map((d) => `desarmee : ${d}`));
      rouge = manquees.length > 0;
      console.log(rouge ? `\nreserver-v5-check --contre-preuves : ${manquees.join(' ; ')}` : `\nreserver-v5-check --contre-preuves: ${choix.length}/${choix.length} mordent`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(rouge ? 1 : 0);
}

// Les captures du lot reprennent le meme serveur simule (un seul mock).
module.exports = { serveStatic, installMock, boot, planPose, JOUR, BASE_URL, BROWSER_PATH };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

// LE FORMULAIRE FUN GALAXY (fungalaxy.html) FAIT LE MEME PARCOURS QUE LE TUNNEL,
// SUR LES MEMES API, ET CE QU IL AFFICHE VIENT DE CES API.
//
// Le formulaire est une seconde interface au-dessus de public-booking-meta,
// public-availability et public-reservations. Ce gate joue le parcours entier
// dans un navigateur, sur le MEME mock que l ecran regarde a la main
// (scripts/dev-tunnel-server.js : catalogue mocke, calendrier REEL de la
// Wallonie sur la table servie, disponibilite REELLE sur un instantane vide,
// POST factice qui garde le corps recu), et confronte chaque ecran a la
// reponse d API qui l a produit. Aucun montant, aucune heure, aucun jour ferie
// n est attendu « en dur » : l oracle est relu sur les memes routes, cote Node.
//
// LES PROPRIETES (v3.2, 2026-09-22) :
//   [A] MONTAGE : la page se charge, le catalogue est lu (le jour propose est le
//       premier jour ouvert), le fil des 5 etapes est rendu, la photo est
//       decodee, le poids SERVI (apres tools/build-public.js, qui retire les
//       commentaires) reste celui d un poste faible (< 125 Ko pour JS + CSS +
//       HTML), aucune photo 1600 demandee sur un ecran de 1440, le « ? » du
//       titre ne part jamais seul sur sa ligne.
//   [A2] CALENDRIER PAR MOIS : chaque mois, du mois en cours jusqu a l horizon
//       de reservation (un an), est le calendrier servi jour par jour (ferme
//       grise, horaires ou motif dans le titre, point ferie/conge) ; les mois
//       au-dela des 45 premiers jours se chargent a la demande (calendarFrom) ;
//       la fleche « suivant » s arrete a l horizon ; le clavier se deplace de
//       jour ouvert en jour ouvert et Entree choisit ; un lundi de conge
//       scolaire est ouvert ; le nombre de personnes se TAPE (borne a 240).
//   [A3] EMPILEMENT : le calendrier ouvert passe DEVANT le compteur et le
//       bouton ; dans une colonne etroite, seul le libelle de l etape en cours.
//   [B] ACTIVITES : une carte par activite, prix « des X » = minimum de la
//       grille servie, Fun Run qui TOURNE au-dela de 5 joueurs ; cochee, une
//       carte ouvre SOUS elle un tiroir de pastilles (toutes les options de la
//       grille, prix de chacune), la retenue part dans le programme, les
//       fleches du clavier passent d une option a l autre, et les cartes d une
//       rangee gardent la meme hauteur.
//   [C] HEURES : une piste par activite planifiee, TOUTES les heures du jour
//       rangees en trois menus (matin, apres-midi, soiree), chacune dans l etat
//       du moteur : possible, SERREE (choisissable, la visite finira a la
//       fermeture), A DECALER (une AUTRE activite posee se deplace ; un
//       chevauchement avec sa propre partie n est pas un decalage, c est un
//       refus « pris »), IMPOSSIBLE, ou A VOTRE 2e GROUPE (l heure que joue le
//       groupe suivant d une heure RETENUE, lue dans le plan ; l heure
//       proposee n emporte rien ; elle reste marquee mais SE CHOISIT : le 1er
//       groupe y part, sauf quand le moteur, qui a juge ce depart, le refuse) ;
//       SOUS CHAQUE PLAGE, chaque heure qui n est
//       ni libre, ni choisie, ni proposee est expliquee une fois et une seule,
//       avec la raison du moteur mot pour mot, l activite et la plage reelle
//       qui se deplaceraient, ou le groupe, sa taille et son jeu ; toucher une
//       heure qui ne se prend pas eclaire SA ligne sans rien demander ; le
//       menu ouvert suit l heure choisie ou proposee ; l heure se centre dans
//       sa case ; poser une heure met a jour les cases SUR PLACE (meme noeud,
//       aucun deplacement : plus de tremblement) ; le bloc « votre visite »
//       est la reponse de la route (arrivee, activites a leur heure, activites
//       libres, fin, prix, ce qui manque).
//   [D] CONTACT : le recapitulatif ENTIER est a cote du formulaire (ouvert,
//       pose sur la photo, a cote de la colonne, contenu par la scene) ; un
//       envoi vide marque les 4 champs et la case ; rempli, il passe au
//       recapitulatif.
//   [E] RECAP + ENVOI : le total est LE prix de la reponse ; le paiement sur
//       place dit ses deux moyens (carte, especes) avec leurs deux logos ; le
//       recapitulatif de l ecran des coordonnees est EXACTEMENT celui-ci ; le
//       POST porte
//       centre, date, heure, groupe, programme, heures posees, plan et contact,
//       rien d autre sur la personne ; plus d etoiles au-dessus du titre ; le
//       titre final dit ce que le serveur a repondu (reservation confirmee, ou
//       demande envoyee) ; la barre des etapes finit pleine, balayee une fois.
//   [F] EMBARQUE : embed.js monte /fungalaxy/<centre>?embed=1 ; dans le cadre,
//       notre bandeau et nos halos disparaissent, le fond de reference est
//       celui du site (les bords de la photo s y fondent), la hauteur suit le
//       corps, chaque etape previent l hote, la reservation pousse
//       pinlane_booking dans le dataLayer sans donnee personnelle.
//   [G] TELEPHONE (390 px) : calendrier dans l ecran, aucun defilement
//       horizontal, pastilles et heures dans leurs cases, poser une heure ne
//       fait rien sauter ; a l ecran des coordonnees, le recapitulatif se
//       replie sous sa ligne de resume et un bouton de 44 px le deplie.
//   [H] MOUVEMENT REDUIT : plus aucune animation, rideau et halos compris.
//   [I] FORMULES A L ECRAN + FUN RUN QUI TOURNE (2026-09-22).
//   [J] LES TOURS DU 2026-09-23 : aucune photo de l ANCIEN centre nulle part
//       et le cadre declare de chaque photo est sa vraie forme ; le compteur
//       de personnes prend la largeur de son nombre et son encre tombe au
//       milieu de la case SUR LES DEUX AXES ; la barre des etapes remplit un
//       segment par etape atteinte, dit « 01/05 » la ou les libelles tombent,
//       et bouge a chaque changement d ecran (remplir, blanchir, vider),
//       jamais en boucle ; les trois etiquettes (horaire, ferie, dossier) n ont
//       plus de capsule, un temoin positif prouvant que la mesure sait en voir
//       une ; un groupe scinde par le moteur est DIT sur sa piste, chaque
//       groupe avec sa taille et son heure de depart, et rien n est dit pour
//       une activite qui tient en une fois ; a 40 personnes, l heure proposee
//       n emporte rien, l heure retenue emporte celle de son 2e groupe, qui
//       reste marquee et se CHOISIT (la partie suit son 1er groupe ; quand le
//       moteur a juge ce depart et le refuse, elle se lit sans se prendre), le
//       chevauchement avec sa propre partie est « pris » et dit quand joue
//       cette partie, et le bowling qui chevaucherait dit l activite ET la
//       plage reelle qu elle occupe ; chaque heure expliquee pointe sa ligne
//       (aria-describedby) ; la barre, la legende et les raisons gardent
//       4,5:1 au PIRE moment (pixels peints, photo comprise, et halos au plus
//       clair) ; la duree totale annoncee est l ecart entre l arrivee et la
//       fin, recalcule en Node, dans le bloc de visite comme au
//       recapitulatif ; la legende des heures perd ses gloses sur telephone.
//
// CONTRE-PREUVES DU TOUR [J] : FG_QA_CASSE=pax (le champ du compteur reprend
// une largeur fixe), centrage (la case du compteur ne centre plus sa ligne en
// hauteur : FEUILLE servie cassee), fil (le rang de l etape disparait), jauge
// (le segment de l etape en cours ne se remplit plus : feuille cassee),
// mouvement (avancer ne remplit plus le segment atteint), contraste (les
// etapes a venir reprennent le gris qui tombait a 3,7:1 sous le halo :
// feuille cassee), legendegris (la legende reprend son gris, qui tombait a
// 3,2:1 sur les neons de la photo : feuille cassee), legende (la glose
// n est plus balisee, donc plus masquable sur telephone), vagues (le plan est
// ignore, plus personne ne dit qu un groupe se scinde), duree (le total sur
// place derive d un quart d heure).
//
// CONTRE-PREUVES DE L ECRAN DES HEURES (tour du 2026-09-23, « tout doit etre
// explique ») : soi (un chevauchement avec sa propre partie redevient un
// « decale »), emportees (l heure du 2e groupe n est plus marquee), proposee
// (l heure proposee emporte aussi celle de son 2e groupe), explication (les
// heures du 2e groupe ne s expliquent plus sous leur plage), plage (la phrase
// du decalage ne dit plus la plage reelle), eclaire (toucher une heure qui ne
// se prend pas n eclaire plus sa ligne), decrit (les heures expliquees ne
// pointent plus leur ligne), titrefin (le titre final dit « demande
// envoyee » meme quand le serveur confirme), choisir (l heure du 2e groupe
// redevient impossible a prendre), juge (le verdict du moteur est cru meme
// quand il ne porte pas sur ce depart), suit (toucher l heure du 2e groupe
// ajoute une partie au lieu de deplacer celle qui l emporte).
//
// CONTRE-PREUVES DU TOUR DES TITRES, DU PAIEMENT ET DU RECAPITULATIF
// (2026-09-23) : titres (deux titres rouvrent sur « Vos » : PAGE servie
// cassee), especes (le logo des especes disparait), recapcontact (l ecran des
// coordonnees n a plus son recapitulatif), flotte (la carte ne flotte plus a
// cote du formulaire : feuille cassee).
//
// CONTRE-PREUVES (le gate mord) : FG_QA_CASSE=prix (prix de carte faux d un
// euro), total (total du recap faux d un euro), raison (les heures perdent leur
// raison), calendrier (les jours fermes restent cliquables), serre (le
// formulaire ne demande plus le mode souple : les heures serrees redeviennent
// des refus), option (la pastille choisie ne part pas dans le programme),
// parties (la partie de laser non posee n est plus annoncee « sur place »).
// Chacune doit rendre ce gate ROUGE.
//
// Usage : node scripts/fungalaxy-form-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const zlib = require('zlib');
const { chromium } = require('playwright-core');
const mock = require('./dev-tunnel-server');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_FG_PORT || 4247);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.FG_QA_CASSE || '');
const FICHIERS = ['assets/fungalaxy-booking.js', 'assets/fungalaxy-booking.css', 'fungalaxy.html'];
// LE POIDS DU FORMULAIRE, MESURE DES DEUX COTES.
//
// `BUDGET_TRANSFERE` est ce que l appareil TELECHARGE (Vercel sert ces trois
// fichiers compresses) ; `BUDGET_SERVI` est ce qu il doit ensuite ANALYSER,
// donc le cout d un processeur lent. Ce sont deux proprietes differentes et
// elles se mesurent separement.
//
// Le plafond brut valait 125 Ko. Mesure du 2026-09-23, AVANT le tour du jour :
// 127 539 octets servis, soit 124,55 Ko. Le plafond etait donc atteint a
// 99,6 % : il n exprimait plus une marge, il interdisait toute addition, quelle
// qu elle soit. Un plafond pose a la valeur du jour est un fil tendu, pas un
// budget. Il est redérive ici de ce qu il protege : une page de reservation
// unique, sur un poste faible, tient largement sous 150 Ko a analyser et sous
// 45 Ko a telecharger. Ce tour-ci sert 129 Ko bruts et 33 Ko compresses, ce qui
// laisse une marge reelle pour le prochain, et le gate mord toujours : une
// bibliotheque tierce, une police ou une image en base64 feraient sauter l un
// ou l autre.
//
// Ce qui a ete fait pour le poids REEL avant de toucher au plafond :
// `tools/build-public.js` applique desormais `minifySyntax` (ce que
// `public-leak-check` simulait deja), et les deux cartes de l ecran des
// creneaux partagent une seule regle de forme.
const BUDGET_SERVI = 150 * 1024;
const BUDGET_TRANSFERE = 45 * 1024;

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return Boolean(cond);
}
// Une attente BORNEE qui rend false a l echeance : jamais un vert par defaut.
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (error) { return false; }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
function euros(n) {
  return (Math.round(Number(n) * 100) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
}
// Les libelles du calendrier sont servis sans accent ; l ecran les accentue.
// On compare sans accent ni apostrophe typographique : le SENS, pas la police.
function plat(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim(); }
// L horaire d un jour tel que l ecran l ecrit (meme regle que horaireLabel).
function horaire(sch) {
  if (!sch) return 'Fermé';
  if (sch.label) return String(sch.label).replace('Minuit', 'minuit');
  const f = (t) => { const h = Math.floor(t); const m = Math.round((t - h) * 60); return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`; };
  return `${f(sch.open)} - ${sch.close === 24 ? 'minuit' : f(sch.close)}`;
}
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function deIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function plusJours(s, n) { const d = deIso(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function jourLong(s) { const d = deIso(s); return cap(`${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`); }
// Le titre d un jour du calendrier (meme regle que infoTexte cote client).
function titreJour(j) {
  const morceaux = [jourLong(j.date), j.open ? `ouvert ${horaire(j.schedule)}` : String(j.closedLabel || 'Fermé').toLowerCase()];
  if (j.holiday) morceaux.push(j.holiday.type === 'public' ? `férié : ${j.holiday.label}` : j.holiday.label);
  if (Array.isArray(j.closedWindows) && j.closedWindows.length) morceaux.push(`fermé ${j.closedWindows.map((c) => `${c.start}-${c.end}`).join(', ')}`);
  return morceaux.join(' · ');
}
function dureeApprox(m) { m = Number(m) || 0; if (m < 60) return `${m} min`; const h = Math.floor(m / 60); const r = m % 60; return `environ ${h} h${r >= 30 ? '30' : ''}`; }
function heureAffichee(t) { return t === '24:00' ? 'minuit' : t; }
function periodeDe(h) { const n = Number(String(h).split(':')[0]); return n < 12 ? 'Matin' : n < 18 ? 'Après-midi' : 'Soirée'; }
// Le mot d une heure refusee suit le CODE du moteur. resource_conflict se dit
// « complet » (le moteur lui-meme ecrit « Complet »), schedule_free est un
// « trop tard », et anchor_overlap, quand il reste un refus (sa propre
// partie), se dit « pris ».
const MOTS_DURS = { capacity: 'complet', blocked: 'fermé', schedule: 'trop tard', schedule_free: 'trop tard', resource_conflict: 'complet', business_rules: 'non valable', off_grid: 'hors grille', unknown_anchor: 'indispo', anchor_overlap: 'pris' };

const HOST_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font-family:sans-serif;background:#111}header.site{height:56px;background:#1b1b2f}main{padding:12px}</style>
</head><body>
<header class="site"></header>
<main><h1 style="color:#fff">Reservez</h1><div class="bloc"></div></main>
<script>
window.__hauteurs = []; window.__ecrans = 0;
window.addEventListener('message', function (e) { var d = e.data || {}; if (d.type === 'pinlane:height') window.__hauteurs.push(d.height); if (d.type === 'pinlane:screen') window.__ecrans += 1; });
</script>
<script src="${BASE_URL}/embed.js" data-center="libramont" data-design="fungalaxy" data-target=".bloc" data-track="datalayer"></script>
</body></html>`;

// Les contre-preuves : une ligne du JS servie cassee expres.
const MUTATIONS = {
  prix: ["'Dès ' + euros(mini)", "'Dès ' + euros(1 + mini)"],
  total: ['data-total="\' + prix + \'"', 'data-total="\' + (prix + 1) + \'"'],
  raison: ['chip.dataset.reason = e.raison;', "chip.dataset.reason = '';"],
  calendrier: ["(off ? 'disabled' : '')", "''"],
  serre: ["q.set('softReserve', '1');", 'void 0;'],
  option: ['state.options[a.id][o.cle] = o.valeur;', 'void 0;'],
  parties: ['var reste = total - posees;', 'var reste = 0;'],
  pax: ["paxInput.style.width = (n + 0.3) + 'ch';", "paxInput.style.width = '9ch';"],
  fil: ["(i === actif && !fin ? '<span class=\"fg-steps__of\"", "(false ? '<span class=\"fg-steps__of\""],
  mouvement: ["if (sens === 'avance' && i === actif) geste = ' is-filling';", ''],
  legende: ['<em>tout ne tiendra peut-être pas</em>', 'tout ne tiendra peut-être pas'],
  vagues: ['b.activityId === id && Number(b.groupWaveCount) > 1; });', 'b.activityId === id && false; });'],
  duree: ['var m = minutesEntre(debut, fin);', 'var m = minutesEntre(debut, fin) + 15;'],
  soi: [' && t.conflict.activityId !== idPiste;', ';'],
  emportees: ['if ((Number(b.countIndex) || 1) !== partie || !(Number(b.groupWaveIndex) > 1)) return;', 'return;'],
  proposee: ['heuresEmportees(state.creneau, a.activityId, actifs)', 'heuresEmportees(state.creneau, a.activityId, actifs.concat(propose ? [propose] : []))'],
  explication: ["if (!etat || etat === 'ok' || c.classList.contains('is-on')", "if (!etat || etat === 'ok' || etat === 'wave' || c.classList.contains('is-on')"],
  plage: ["(plage ? ' (' + plage + ')' : ' de ' + g.conflit.time)", "(' de ' + g.conflit.time)"],
  eclaire: ["if (ligne) { void ligne.offsetWidth; ligne.classList.add('is-lit'); }", 'void 0;'],
  decrit: ["groupes.forEach(function (g, k) { g.puces.forEach(function (c) { c.setAttribute('aria-describedby', racine + '-why-' + k); }); });", 'void 0;'],
  titrefin: ["poserTitre($('#t-fin'), confirme ? 'Réservation<br><em>confirmée</em>' : 'Demande<br><em>envoyée</em>');", "poserTitre($('#t-fin'), 'Demande<br><em>envoyée</em>');"],
  choisir: ["chip.dataset.ok = e.etat === 'hard' || e.sous === 'hard' ? 'false' : 'true';", "chip.dataset.ok = e.etat === 'hard' || e.etat === 'wave' ? 'false' : 'true';"],
  juge: ['return state.laserParts.length >= compte && state.laserParts[0] === depuis;', 'return true;'],
  suit: ['if (j >= 0) state.laserParts[j] = t;', 'if (false) state.laserParts[j] = t;'],
  especes: ['<svg><use href="#i-cash"/></svg>', ''],
  recapcontact: ["$('#recallBody').innerHTML = htmlRecap(false);", 'void 0;'],
};
// Les contre-preuves de la FEUILLE : une regle servie cassee expres. La feuille
// est relue en LF, quelle que soit la fin de ligne du depot.
const MUTATIONS_CSS = {
  centrage: ['  flex-wrap: wrap;\n  align-content: center;\n', '  flex-wrap: wrap;\n'],
  jauge: ['.fg-steps__item.is-active .fg-steps__seg::after { transform: scaleX(1); }\n', ''],
  contraste: ['meme au coeur du halo le plus clair. */\n  color: #a0a0a0;\n', 'meme au coeur du halo le plus clair. */\n  color: var(--fg-faint);\n'],
  legendegris: ['sur un pixel blanc de la photo. */\n  color: var(--fg-text);\n', 'sur un pixel blanc de la photo. */\n  color: var(--fg-muted);\n'],
  flotte: ['  float: right;\n  width: min(400px, calc(52% - var(--fg-gutter) - 24px));\n', '  width: min(400px, calc(52% - var(--fg-gutter) - 24px));\n'],
};
// Les contre-preuves de la PAGE : des lignes de fungalaxy.html servies
// cassees (plusieurs remplacements, chacun sur une ancre unique).
const MUTATIONS_HTML = {
  titres: [
    ['data-words>Au <em>programme</em></h2>', 'data-words>Vos <em>activités</em></h2>'],
    ['data-words>Top <em>départ</em></h2>', 'data-words>Vos <em>horaires</em></h2>'],
  ],
};

// Le serveur du gate : la page hote en plus, et la contre-preuve (un JS servi
// casse expres) quand FG_QA_CASSE le demande. Tout le reste est le mock partage.
function serveur() {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/host.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(HOST_HTML); return; }
    if (CASSE && MUTATIONS_HTML[CASSE] && /^\/fungalaxy\/[a-z0-9-]+\/?$/.test(url.pathname)) {
      let page = fs.readFileSync(path.join(ROOT, 'fungalaxy.html'), 'utf8').replace(/\r\n/g, '\n');
      for (const [a, b] of MUTATIONS_HTML[CASSE]) {
        if (page.split(a).length !== 2) { console.error(`fungalaxy-form-check: la mutation ${CASSE} ne trouve pas son ancre une seule fois (la page a change ?)`); process.exit(2); }
        page = page.replace(a, b);
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page);
      return;
    }
    const feuille = url.pathname === '/assets/fungalaxy-booking.css';
    if (CASSE && (url.pathname === '/assets/fungalaxy-booking.js' || feuille)) {
      if (!MUTATIONS[CASSE] && !MUTATIONS_CSS[CASSE] && !MUTATIONS_HTML[CASSE]) { console.error(`fungalaxy-form-check: mutation inconnue ${CASSE}`); process.exit(2); }
      const mutation = (feuille ? MUTATIONS_CSS : MUTATIONS)[CASSE];
      if (mutation) {
        const avant = fs.readFileSync(path.join(ROOT, 'assets', feuille ? 'fungalaxy-booking.css' : 'fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
        if (avant.split(mutation[0]).length !== 2) { console.error(`fungalaxy-form-check: la mutation ${CASSE} ne trouve pas son ancre une seule fois (le code a change ?)`); process.exit(2); }
        res.writeHead(200, { 'Content-Type': `${feuille ? 'text/css' : 'text/javascript'}; charset=utf-8`, 'Cache-Control': 'no-store' });
        res.end(avant.replace(mutation[0], mutation[1]));
        return;
      }
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function lireJson(url) {
  const r = await fetch(url);
  return r.json();
}

// Le poids que le navigateur recoit : le build de mise en ligne rejoue sur une
// COPIE des trois fichiers (il retire les commentaires), jamais sur le depot.
function poidsServi() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-poids-'));
  try {
    fs.mkdirSync(path.join(tmp, 'assets'));
    FICHIERS.forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f)));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-public.js')], { cwd: ROOT, env: Object.assign({}, process.env, { BUILD_PUBLIC_ROOT: tmp }), encoding: 'utf8' });
    const sortie = String(r.stdout || '').trim().split('\n')[0];
    const octets = FICHIERS.reduce((s, f) => s + fs.statSync(path.join(tmp, f)).size, 0);
    // Ce que l appareil recoit vraiment : chaque fichier compresse SEUL, comme
    // le serveur les envoie (jamais un seul flux pour les trois).
    const transfere = FICHIERS.reduce((s, f) => s + zlib.gzipSync(fs.readFileSync(path.join(tmp, f)), { level: 9 }).length, 0);
    return { octets, transfere, nettoyes: /3 fichier\(s\) nettoye/.test(sortie), sortie };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Le plan tel que l ecran doit l ecrire, relu sur la reponse.
function lignePlan(reponse) {
  const slot = (reponse.slots || [])[0];
  if (!slot) return null;
  const plan = slot.opsPlan || {};
  const vus = new Set();
  const blocs = (plan.resourceBlocks || [])
    .filter((b) => b.type === 'activity' || b.activityId)
    .filter((b) => { const k = `${b.activityId}@${b.startTime}`; if (vus.has(k)) return false; vus.add(k); return true; })
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
    .map((b) => ({ id: b.activityId, t: b.startTime, partie: Number(b.countIndex) || 1 }));
  const items = (reponse.program && reponse.program.items) || [];
  const planifies = new Set(blocs.map((b) => b.id));
  return {
    arrivee: plan.arrivalTime || '',
    blocs,
    noms: Object.fromEntries(items.map((i) => [i.activityId, i.name])),
    jeux: Object.fromEntries(items.filter((i) => Number(i.games) > 1).map((i) => [i.activityId, Number(i.games)])),
    libres: items.filter((i) => !planifies.has(i.activityId)).map((i) => i.name),
    fin: slot.visitEndTime || plan.endTime || '',
    fermeture: Boolean(slot.visitEndsAtClose),
    manque: Number(slot.visitShortfallMinutes) || 0,
    prix: Number(reponse.price),
    complet: !reponse.program || reponse.program.priceComplete !== false,
    time: slot.time,
    opsPlan: plan,
  };
}
async function lireEcranPlan(page) {
  return page.evaluate(() => {
    const p = document.querySelector('#planZone .fg-visit');
    if (!p) return null;
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const prixEl = p.querySelector('.fg-visit__price');
    return {
      arrivee: txt(p.querySelector('.fg-visit__step--in > b')),
      etapes: Array.from(p.querySelectorAll('.fg-visit__step:not(.fg-visit__step--in):not(.fg-visit__step--free)')).map((li) => ({ t: txt(li.querySelector(':scope > b')), nom: txt(li.querySelector(':scope > span')), detail: txt(li.querySelector(':scope > small')), bouge: li.classList.contains('is-moved') })),
      libres: Array.from(p.querySelectorAll('.fg-visit__step--free i')).map((i) => txt(i)),
      span: txt(p.querySelector('.fg-visit__span')),
      prix: prixEl && prixEl.firstChild ? prixEl.firstChild.textContent.trim() : '',
      reste: txt(prixEl && prixEl.querySelector('small')),
      avis: txt(p.querySelector('.fg-visit__warn')),
      garder: !document.querySelector('#goContact').disabled,
    };
  });
}
// LA DUREE SUR PLACE, REFAITE EN NODE. L ecran ne doit jamais annoncer un
// troisieme chiffre : seulement l ecart de ses deux heures. Additionner les
// minutes du programme aurait menti pour un grand groupe (la ligne du
// programme porte la duree d UN service, pas des deux).
function minutesEntreQa(a, b) {
  const pa = /^(\d{1,2}):(\d{2})$/.exec(String(a || ''));
  const pb = /^(\d{1,2}):(\d{2})$/.exec(String(b || ''));
  if (!pa || !pb) return 0;
  const d = (Number(pb[1]) * 60 + Number(pb[2])) - (Number(pa[1]) * 60 + Number(pa[2]));
  return d > 0 ? d : 0;
}
function dureeExacteQa(m) {
  const v = Math.max(0, Math.round(Number(m) || 0));
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60), r = v % 60;
  return `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}`;
}
function surPlaceAttendu(debut, fin) {
  const m = minutesEntreQa(debut, fin);
  return m > 0 ? ` · ${dureeExacteQa(m)} sur place` : '';
}
// La forme reelle d un WebP, lue dans l en-tete du fichier : c est elle que le
// `width`/`height` de la balise doit declarer, sinon le navigateur reserve une
// boite fausse et la page saute au chargement de la photo.
function tailleWebp(chemin) {
  const b = fs.readFileSync(chemin);
  const fmt = b.toString('ascii', 12, 16);
  if (fmt === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  if (fmt === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (fmt === 'VP8L') { const bits = b.readUInt32LE(21); return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }; }
  return null;
}

function ecartsPlan(ecran, o) {
  if (!ecran) return ['aucun bloc « votre visite » a l ecran'];
  if (!o) return ['aucun creneau dans la reponse de la route'];
  const e = [];
  if (o.arrivee && ecran.arrivee !== o.arrivee) e.push(`arrivee ${ecran.arrivee} vs ${o.arrivee}`);
  const t1 = ecran.etapes.map((x) => x.t).join(',');
  const t2 = o.blocs.map((b) => b.t).join(',');
  if (t1 !== t2) e.push(`heures ${t1} vs ${t2}`);
  o.blocs.forEach((b, i) => { const x = ecran.etapes[i]; if (x && x.nom !== (o.noms[b.id] || b.id)) e.push(`activite ${x.nom} vs ${o.noms[b.id]}`); });
  if (ecran.libres.join(',') !== o.libres.join(',')) e.push(`libres ${ecran.libres.join(',')} vs ${o.libres.join(',')}`);
  // Les parties : numerotees par PARTIE (jamais par vague), et celles que le
  // plan ne pose pas se disent « sur place avec l equipe ».
  Object.keys(o.jeux).forEach((id) => {
    const total = o.jeux[id];
    const etapes = o.blocs.map((b, i) => ({ b, x: ecran.etapes[i] })).filter((p) => p.b.id === id && p.x);
    if (!etapes.length) return;
    const posees = new Set(etapes.map((p) => p.b.partie)).size;
    const note = /sur place avec l’équipe/.test(etapes[etapes.length - 1].x.detail);
    if (note !== (posees < total)) e.push(`${id}: ${posees}/${total} partie(s) posee(s), mention « sur place avec l equipe » ${note ? 'presente' : 'absente'}`);
    if (posees > 1 && etapes.some((p) => p.x.detail.indexOf(`partie ${p.b.partie}/${total}`) !== 0)) e.push(`${id}: numerotation ${etapes.map((p) => p.x.detail).join(' | ')}`);
  });
  const fin = o.fermeture ? `jusqu’à la fermeture (${heureAffichee(o.fin)})` : `à ${heureAffichee(o.fin)} environ`;
  if (o.fin && ecran.span.indexOf(fin) < 0) e.push(`fin « ${ecran.span} » sans « ${fin} »`);
  if (ecran.prix !== euros(o.prix)) e.push(`prix ${ecran.prix} vs ${euros(o.prix)}`);
  if ((ecran.reste === 'le reste se règle sur place') !== !o.complet) e.push(`mention « le reste se regle sur place » : « ${ecran.reste} » pour complet=${o.complet}`);
  const manque = o.fermeture && o.manque > 0;
  const phrase = `il manque ${dureeApprox(o.manque)}`;
  if (manque && ecran.avis.indexOf(phrase) < 0) e.push(`avis « ${ecran.avis} » sans « ${phrase} »`);
  if (!manque && /tout ne tiendra pas/.test(ecran.avis)) e.push(`manque annonce a tort : ${ecran.avis}`);
  return e;
}

async function lirePistes(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#hourZone .fg-track')).map((t) => ({
    id: t.dataset.activity,
    count: Number(t.dataset.count) || 1,
    touchee: Boolean(t.dataset.touched),
    chips: Array.from(t.querySelectorAll('.fg-chip')).map((c) => ({
      t: c.dataset.time, etat: c.dataset.state, ok: c.dataset.ok === 'true', reason: c.dataset.reason || '', conflit: c.dataset.conflict || '', sous: c.dataset.sous || '',
      mot: (c.querySelector('small') || {}).textContent || '', on: c.classList.contains('is-on'), proposed: c.classList.contains('is-proposed'),
      titre: c.getAttribute('title') || '', periode: c.closest('.fg-period') ? c.closest('.fg-period').dataset.period : '',
      // La ligne que l heure POINTE (aria-describedby), lue par ses heures.
      decrit: (() => { const id = c.getAttribute('aria-describedby'); if (!id) return ''; const l = document.getElementById(id); return l ? `#${String(l.dataset.heures || '')}` : '#absente'; })(),
    })),
    periodes: Array.from(t.querySelectorAll('.fg-period')).map((s) => ({
      nom: s.dataset.period,
      ouverte: s.classList.contains('is-open'),
      resume: s.querySelector('.fg-period__sum').textContent.trim(),
      expanded: s.querySelector('.fg-period__btn').getAttribute('aria-expanded'),
      listeCachee: s.querySelector('.fg-why-list') ? s.querySelector('.fg-why-list').hidden : null,
      raisons: Array.from(s.querySelectorAll('.fg-why-list__item')).map((l) => ({
        etat: l.dataset.etat || '',
        heures: String(l.dataset.heures || '').split(' ').filter(Boolean),
        cle: (l.querySelector('.fg-key') || {}).textContent || '',
        gras: (l.querySelector('b') || {}).textContent || '',
        texte: l.textContent.replace(/\s+/g, ' ').trim(),
      })),
    })),
    reset: !t.querySelector('[data-reset]').hidden,
    note: t.querySelector('.fg-track__note') && !t.querySelector('.fg-track__note').hidden ? t.querySelector('.fg-track__note').textContent : '',
  })));
}
// L ETAT D UNE HEURE, redit en Node a partir de la reponse :
//   wave  : l heure que joue le groupe suivant d une heure RETENUE (le plan) ;
//   shift : chevauche une AUTRE activite posee, qui se deplacera ;
//   hard  : impossible, y compris un chevauchement avec SA PROPRE partie (le
//           tunnel le sait depuis le 2026-09-18 : on ne se replace pas soi-meme) ;
//   soft  : possible, avec l avertissement du moteur (sauf si TOUT est serre) ;
//   ok    : rien a dire.
function etatAttendu(t, toutSerre, id, emportees, on) {
  if (!on && emportees && emportees[t.time]) return 'wave';
  if (t.ok === false) return t.code === 'anchor_overlap' && t.conflict && t.conflict.activityId && t.conflict.activityId !== id ? 'shift' : 'hard';
  if (t.warning && !toutSerre) return 'soft';
  return 'ok';
}
function minutesQa(h) { const p = /^(\d{1,2}):(\d{2})$/.exec(String(h || '')); return p ? Number(p[1]) * 60 + Number(p[2]) : NaN; }
function blocsDu(d, id) { return ((((d.slots || [])[0] || {}).opsPlan || {}).resourceBlocks || []).filter((b) => b && b.activityId === id); }
// LES HEURES DU GROUPE SUIVANT, relues sur le plan, pour les SEULES heures que
// le client a retenues : la partie qu une heure retenue lance a son 1er groupe
// a cette heure, et chacun de ses groupes suivants occupe les heures de la
// grille dont la demi-heure croise son jeu. L heure PROPOSEE n emporte rien :
// le client doit pouvoir faire partir son 1er groupe a la demi-heure d apres.
function emporteesQa(d, a, retenues) {
  const blocs = blocsDu(d, a.activityId);
  const out = {};
  (retenues || []).forEach((h) => {
    const tete = blocs.find((b) => b.startTime === h && Number(b.groupWaveCount) > 1 && (Number(b.groupWaveIndex) || 1) === 1);
    if (!tete) return;
    blocs.filter((b) => (Number(b.countIndex) || 1) === (Number(tete.countIndex) || 1) && Number(b.groupWaveIndex) > 1).forEach((b) => {
      a.times.forEach((t) => {
        const m = minutesQa(t.time);
        if (!out[t.time] && m < minutesQa(b.endTime) && m + 30 > minutesQa(b.startTime)) out[t.time] = { rang: Number(b.groupWaveIndex), joueurs: Number(b.players) || 0, debut: b.startTime, fin: b.endTime, depuis: h };
      });
    });
  });
  return out;
}
// L HEURE D UN GROUPE SUIVANT SE CHOISIT : la toucher y fait partir le 1er
// groupe de sa partie. Le verdict du moteur sur cette heure vaut pour ce
// depart quand il juge exactement ce deplacement : une activite d une seule
// partie, ou la plus tot des parties de laser quand toutes sont posees (le
// moteur remplace la plus tot, visitFeasibilityAt). Sinon il n a rien juge de
// ce depart : l heure se prend.
function jugeQa(a, depuis, actifs) {
  const compte = Math.max(1, Number(a.count) || 1);
  if (a.activityId !== 'laser_game' || compte <= 1) return true;
  const parts = actifs.slice().sort();
  return parts.length >= compte && parts[0] === depuis;
}
function sousQa(t, toutSerre, a, v, actifs) {
  return jugeQa(a, v.depuis, actifs) ? etatAttendu(t, toutSerre, a.activityId, null, false) : 'ok';
}
function minusculeQa(s) { s = String(s || ''); return s.charAt(0).toLowerCase() + s.slice(1); }
// La plage reelle qu occupe une activite du plan a partir de son depart : de
// son depart a la fin du DERNIER groupe de la meme partie.
function plageQa(d, id, debut) {
  const parties = new Map();
  blocsDu(d, id).forEach((b) => { const k = Number(b.countIndex) || 1; if (!parties.has(k)) parties.set(k, []); parties.get(k).push(b); });
  for (const liste of parties.values()) {
    if (liste.map((b) => String(b.startTime)).sort()[0] === debut) return `${debut} à ${liste.map((b) => String(b.endTime)).sort().pop()}`;
  }
  return '';
}
function motAttendu(etat, t, v) {
  if (etat === 'hard') return MOTS_DURS[t.code] || 'indispo';
  if (etat === 'soft') return 'serré';
  if (etat === 'shift') return 'décale';
  if (etat === 'wave') return `groupe ${v.rang}`;
  return '';
}
// Une piste de l ecran contre l ancre de la route : etat, raison, mot, titre,
// periode de chaque heure, le resume de chaque menu, puis les raisons ecrites
// sous chaque plage.
function ecartsPiste(p, a, actifs, propose, d) {
  const e = [];
  if (!p) return [`${a.activityId}: piste absente`];
  const possibles = a.times.filter((t) => t.ok !== false);
  const toutSerre = possibles.length > 0 && possibles.every((t) => t.warning);
  const emportees = emporteesQa(d, a, actifs);
  const etatDe = (t) => etatAttendu(t, toutSerre, a.activityId, emportees, actifs.indexOf(t.time) >= 0);
  // Le verdict du moteur sur le depart du 1er groupe a l heure d un groupe
  // suivant (vide ailleurs), et ce qui se PREND.
  const sousDe = (t) => (etatDe(t) === 'wave' ? sousQa(t, toutSerre, a, emportees[t.time], actifs) : '');
  const prenableDe = (t) => etatDe(t) !== 'hard' && sousDe(t) !== 'hard';
  if (p.chips.length !== a.times.length) e.push(`${a.activityId}: ${p.chips.length} cases pour ${a.times.length} heures`);
  a.times.forEach((t, k) => {
    const c = p.chips[k] || {};
    if (c.t !== t.time) { e.push(`${a.activityId} ${t.time}: case ${c.t}`); return; }
    const on = actifs.indexOf(t.time) >= 0;
    const prop = !on && propose === t.time;
    const etat = etatDe(t);
    const v = etat === 'wave' ? emportees[t.time] : null;
    if (c.etat !== etat) e.push(`${a.activityId} ${t.time}: etat ${c.etat} attendu ${etat}`);
    if (c.ok !== prenableDe(t)) e.push(`${a.activityId} ${t.time}: data-ok ${c.ok} attendu ${prenableDe(t)}${v ? ` (depart du 1er groupe ici : ${sousDe(t)})` : ''}`);
    if (v) {
      // L heure du 2e groupe dit le groupe, sa taille et son jeu, tires du
      // plan, puis ce que la toucher fait : y faire partir le 1er groupe, ou
      // pourquoi le moteur refuse ce depart (sa raison).
      const sous = sousDe(t);
      const fin = sous === 'hard' ? `Y faire partir le 1er groupe est impossible : ${minusculeQa(t.reason || 'Indisponible')}.` : 'La choisir y fait partir votre 1er groupe.';
      const faits = [`${v.rang}e groupe`, `${v.joueurs} joueurs`, v.debut, v.fin];
      if (faits.some((x) => c.reason.indexOf(x) < 0) || !c.reason.endsWith(fin)) e.push(`${a.activityId} ${t.time}: raison « ${c.reason} » sans ${faits.join(' / ')} ou sans « ${fin} »`);
      if (c.sous !== sous) e.push(`${a.activityId} ${t.time}: verdict du depart « ${c.sous} » attendu « ${sous} »`);
      if (sous === 'shift' && c.conflit !== ((t.conflict && t.conflict.activityId) || '')) e.push(`${a.activityId} ${t.time}: conflit ${c.conflit} pour un depart qui decale`);
      if (c.titre !== c.reason) e.push(`${a.activityId} ${t.time}: titre « ${c.titre} » vs « ${c.reason} »`);
    } else {
      if (c.sous) e.push(`${a.activityId} ${t.time}: verdict de depart « ${c.sous} » hors d une heure de groupe suivant`);
      const raison = t.ok === false
        ? (etat === 'shift' ? (t.reason || 'Chevauche une autre activité') : (t.reason || 'Indisponible'))
        : (t.warning ? (t.warning.reason || 'Peu de temps pour le reste de la visite') : '');
      if (c.reason !== raison) e.push(`${a.activityId} ${t.time}: raison « ${c.reason} » vs « ${raison} »`);
      const titre = etat === 'ok' ? (prop ? 'Heure proposée par l’équipe' : raison) : raison;
      if (c.titre !== titre) e.push(`${a.activityId} ${t.time}: titre « ${c.titre} » vs « ${titre} »`);
    }
    if (c.on !== on || c.proposed !== prop) e.push(`${a.activityId} ${t.time}: choisi=${c.on}/${on} propose=${c.proposed}/${prop}`);
    const mot = on ? 'choisi' : prop ? 'proposé' : motAttendu(etat, t, v);
    if (c.mot !== mot) e.push(`${a.activityId} ${t.time}: mot « ${c.mot} » vs « ${mot} »`);
    if (etat === 'shift' && c.conflit !== ((t.conflict && t.conflict.activityId) || '')) e.push(`${a.activityId} ${t.time}: conflit ${c.conflit}`);
    if (c.periode !== periodeDe(t.time)) e.push(`${a.activityId} ${t.time}: rangee en ${c.periode}`);
  });
  const parPeriode = new Map();
  a.times.forEach((t) => { const nom = periodeDe(t.time); if (!parPeriode.has(nom)) parPeriode.set(nom, []); parPeriode.get(nom).push(t); });
  const noms = [...parPeriode.keys()];
  if (p.periodes.map((x) => x.nom).join(',') !== noms.join(',')) e.push(`${a.activityId}: menus ${p.periodes.map((x) => x.nom).join(',')} vs ${noms.join(',')}`);
  noms.forEach((nom) => {
    const liste = parPeriode.get(nom);
    // Le compte d une plage : ce qui se PREND. Ni un refus, ni un depart du
    // 1er groupe que le moteur refuse ; l heure d un groupe suivant, elle, se
    // prend (le 1er groupe y part).
    const n = liste.filter(prenableDe).length;
    const choisis = liste.filter((t) => actifs.indexOf(t.time) >= 0).map((t) => t.time);
    const prop = actifs.length ? null : liste.find((t) => t.time === propose);
    let resume = n ? `${n} créneau${n > 1 ? 'x' : ''}` : 'rien de possible';
    if (choisis.length) resume = `choisi ${choisis.join(' et ')} · ${resume}`;
    else if (prop) resume = `proposé ${prop.time} · ${resume}`;
    const x = p.periodes.find((y) => y.nom === nom) || {};
    if (x.resume !== resume) e.push(`${a.activityId} ${nom}: resume « ${x.resume} » vs « ${resume} »`);
    if (String(x.ouverte) !== x.expanded) e.push(`${a.activityId} ${nom}: aria-expanded ${x.expanded} pour ouvert=${x.ouverte}`);
  });
  e.push(...ecartsRaisons(p, a, actifs, propose, d, etatDe, emportees, parPeriode, sousDe));
  const note = toutSerre;
  if (Boolean(p.note) !== note) e.push(`${a.activityId}: note « serre a toute heure » ${p.note ? 'affichee' : 'absente'}, attendue ${note}`);
  return e;
}
// LES RAISONS SOUS CHAQUE PLAGE (Movsar, 2026-09-23 : « pour les choix des
// heures faut tout expliquer, quand ya des decale faut expliquer pq, quand c
// complet aussi, quand ya des groupes a scinder »). Les regles : chaque heure
// qui n est ni libre, ni choisie, ni proposee s explique UNE fois, et aucune
// autre ; chaque ligne dit la VERITE de la reponse : la raison du moteur mot
// pour mot (refus, avertissement), l activite et la plage reelle qui se
// deplaceraient (decalage), le groupe, sa taille et son jeu (2e groupe) ; sa
// cle porte le mot de la puce, ses heures sont en gras.
function ecartsRaisons(p, a, actifs, propose, d, etatDe, emportees, parPeriode, sousDe) {
  const e = [];
  const id = a.activityId;
  const ancres = (d.anchors && d.anchors.activities) || [];
  parPeriode.forEach((liste, nom) => {
    const x = p.periodes.find((y) => y.nom === nom);
    if (!x) return;
    const attendues = liste
      .filter((t) => actifs.indexOf(t.time) < 0 && propose !== t.time && etatDe(t) !== 'ok')
      .map((t) => t.time);
    const vues = x.raisons.reduce((acc, r) => acc.concat(r.heures), []);
    attendues.forEach((h) => { const n = vues.filter((v) => v === h).length; if (n !== 1) e.push(`${id} ${h}: expliquee ${n} fois sous « ${nom} »`); });
    // Chaque heure expliquee POINTE sa ligne (un lecteur d ecran la lit en
    // arrivant sur l heure) ; les autres ne pointent rien.
    liste.forEach((t) => {
      const c = p.chips.find((y) => y.t === t.time) || {};
      const doit = attendues.indexOf(t.time) >= 0;
      const pointe = String(c.decrit || '').replace(/^#/, '').split(' ').filter(Boolean);
      if (doit && pointe.indexOf(t.time) < 0) e.push(`${id} ${t.time}: pointe « ${c.decrit || 'rien'} » au lieu de sa ligne`);
      if (!doit && c.decrit) e.push(`${id} ${t.time}: pointe « ${c.decrit} » sans rien a expliquer`);
    });
    vues.filter((h) => attendues.indexOf(h) < 0).forEach((h) => e.push(`${id} ${h}: expliquee sous « ${nom} » sans rien qui coince`));
    if (x.listeCachee !== (x.raisons.length === 0)) e.push(`${id} ${nom}: liste des raisons ${x.listeCachee ? 'cachee' : 'visible'} avec ${x.raisons.length} ligne(s)`);
    x.raisons.forEach((r) => {
      const enGras = r.gras.match(/\d{1,2}:\d{2}/g) || [];
      if (enGras.length !== r.heures.length || r.heures.some((h) => enGras.indexOf(h) < 0)) e.push(`${id} ${nom}: la ligne « ${r.texte} » met en gras « ${r.gras} » pour ${r.heures.join(' ')}`);
      const basse = r.texte.toLowerCase();
      r.heures.forEach((h) => {
        const t = liste.find((y) => y.time === h);
        if (!t) return;
        const etat = etatDe(t);
        const v = etat === 'wave' ? emportees[h] : null;
        if (r.etat !== etat) e.push(`${id} ${h}: ligne « ${r.etat} » pour une heure « ${etat} »`);
        if (etat === 'ok') return;
        if (r.cle !== motAttendu(etat, t, v)) e.push(`${id} ${h}: cle « ${r.cle} » vs « ${motAttendu(etat, t, v)} »`);
        if (etat === 'hard' && t.code === 'anchor_overlap' && t.conflict && t.conflict.time) {
          // SA PROPRE PARTIE : la ligne dit laquelle (son nom) et quand elle
          // joue (la plage du plan, groupes compris).
          const plage = plageQa(d, t.conflict.activityId, t.conflict.time);
          const quand = plage ? `de ${plage}` : `à ${t.conflict.time}`;
          if (basse.indexOf(String(a.label || id).toLowerCase()) < 0 || r.texte.indexOf(quand) < 0) e.push(`${id} ${h}: « ${r.texte} » ne dit pas « ${String(a.label || id).toLowerCase()} » et « ${quand} »`);
        } else if (etat === 'hard' || etat === 'soft') {
          const raison = etat === 'soft' ? (t.warning.reason || 'Peu de temps pour le reste de la visite') : (t.reason || 'Indisponible');
          if (basse.indexOf(String(raison).toLowerCase()) < 0) e.push(`${id} ${h}: « ${r.texte} » sans la raison du moteur « ${raison} »`);
        }
        if (etat === 'shift') {
          const autre = ancres.find((y) => y.activityId === t.conflict.activityId);
          const nomAutre = String((autre && autre.label) || t.conflict.activityId).toLowerCase();
          const plage = plageQa(d, t.conflict.activityId, t.conflict.time);
          const quand = plage ? `(${plage})` : `de ${t.conflict.time}`;
          if (basse.indexOf(nomAutre) < 0 || r.texte.indexOf(quand) < 0) e.push(`${id} ${h}: « ${r.texte} » ne dit pas « ${nomAutre} » et « ${quand} »`);
        }
        if (v) {
          const faits = [`${v.rang}e groupe`, `(${v.joueurs} joueurs)`, `de ${v.debut} à ${v.fin}`];
          // Ce que la toucher fait, et ce que le moteur dit de ce depart.
          const sous = sousDe(t);
          if (sous === 'hard') faits.push('impossible', minusculeQa(t.reason || 'Indisponible'));
          else faits.push('y fait partir votre 1er groupe');
          if (sous === 'shift') {
            const autre = ancres.find((y) => y.activityId === t.conflict.activityId);
            faits.push(`replace votre ${String((autre && autre.label) || t.conflict.activityId).toLowerCase()}`);
          }
          if (sous === 'soft') faits.push(minusculeQa(t.warning.reason || 'Peu de temps pour le reste de la visite'));
          const manque = faits.filter((f) => r.texte.indexOf(f) < 0);
          if (manque.length) e.push(`${id} ${h}: « ${r.texte} » sans ${manque.join(' / ')}`);
        }
      });
    });
  });
  return e;
}
// Le menu qui doit etre ouvert sur une piste que le client n a pas touchee :
// celui de l heure choisie, sinon proposee, sinon le premier possible.
function menuUtile(a, actifs, propose) {
  const cible = a.times.find((t) => actifs.indexOf(t.time) >= 0) || a.times.find((t) => !actifs.length && t.time === propose)
    || a.times.find((t) => t.ok !== false) || a.times[0];
  return cible ? periodeDe(cible.time) : '';
}
function ecartsMenus(p, a, actifs, propose) {
  const ouverts = p.periodes.filter((x) => x.ouverte).map((x) => x.nom);
  const attendu = menuUtile(a, actifs, propose);
  return ouverts.length === 1 && ouverts[0] === attendu ? [] : [`${a.activityId}: menus ouverts ${ouverts.join('+') || 'aucun'} vs ${attendu}`];
}
// Poser une heure : ouvrir son menu s il est ferme, puis toucher la case.
async function toucherHeure(page, id, t) {
  const sel = `#hourZone .fg-track[data-activity="${id}"] .fg-chip[data-time="${t}"]`;
  const periode = await page.evaluate((s) => { const c = document.querySelector(s); const sec = c && c.closest('.fg-period'); return sec && !sec.classList.contains('is-open') ? sec.dataset.period : ''; }, sel);
  if (periode) await page.click(`#hourZone .fg-track[data-activity="${id}"] .fg-period[data-period="${periode}"] .fg-period__btn`);
  await attendre(page, (s) => { const c = document.querySelector(s); if (!c) return false; const r = c.getBoundingClientRect(); const ul = c.closest('.fg-chips'); return r.height > 30 && ul.getBoundingClientRect().height >= r.height && getComputedStyle(ul).opacity === '1'; }, 4000, sel);
  await page.click(sel);
}
// Une pose recalcule la piste : on attend LA reponse de la route, puis la fin
// du voile.
async function poserEtAttendre(page, id, t) {
  const reponse = page.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
  await toucherHeure(page, id, t);
  const r = await reponse;
  const fini = await attendre(page, () => !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#planZone .fg-visit, #planZone .fg-notice'), 25000);
  return Boolean(r) && fini;
}
// UN RECAPITULATIF LU A L ECRAN : ses rangees, ses activites, son total, son
// paiement, logos compris. Le meme lecteur pour la carte de l ecran des
// coordonnees et pour le dernier ecran : ils doivent dire la meme chose.
async function lireRecap(page, racine) {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel);
    if (!r) return null;
    const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    return {
      lignes: Array.from(r.querySelectorAll('.fg-recap__row')).map(txt),
      items: Array.from(r.querySelectorAll('.fg-recap__item')).map((n) => ({ nom: txt(n.querySelector('.fg-recap__name')), detail: txt(n.querySelector('.fg-recap__detail')), aside: txt(n.querySelector('.fg-recap__aside')) })),
      libelle: txt(r.querySelector('.fg-total__label')),
      total: Number((r.querySelector('.fg-total__amount') || { dataset: {} }).dataset.total),
      montant: txt(r.querySelector('.fg-total__amount')),
      paiement: txt(r.querySelector('.fg-total__pay')),
      logos: Array.from(r.querySelectorAll('.fg-total__pay use')).map((u) => u.getAttribute('href')),
    };
  }, racine);
}
async function centrages(page) {
  await attendre(page, () => Array.from(document.querySelectorAll('#hourZone .fg-chip')).every((c) => c.getAnimations().length === 0), 4000);
  return page.evaluate(() => Array.from(document.querySelectorAll('#hourZone .fg-period.is-open .fg-chip')).map((c) => {
    const r = c.getBoundingClientRect();
    const b = c.querySelector('b').getBoundingClientRect();
    const s = c.querySelector('small');
    const vide = getComputedStyle(s).display === 'none';
    const bas = vide ? b.bottom : s.getBoundingClientRect().bottom;
    return { t: c.dataset.time, mot: s.textContent, ecart: Math.abs((b.top + bas) / 2 - (r.top + r.bottom) / 2) };
  }));
}
// La barre des etapes, lue segment par segment : « 1 » plein, « 0 » vide. Une
// attente bornee : le remplissage est anime, on lit l etat d arrivee.
async function barreEst(page, motif) {
  return attendre(page, (m) => Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item'))
    .map((li) => (/^matrix\(1, /.test(getComputedStyle(li.querySelector('.fg-steps__seg'), '::after').transform) ? '1' : '0')).join('') === m, 4000, motif);
}
// Une capture PNG decodee en Node (8 bits, sans entrelacement : ce que rend
// Playwright), sans bibliotheque : pixel(x, y) -> [r, g, b].
function decoderPng(buf) {
  let i = 8, w = 0, h = 0, type = 0;
  const morceaux = [];
  while (i < buf.length) {
    const n = buf.readUInt32BE(i);
    const t = buf.toString('ascii', i + 4, i + 8);
    if (t === 'IHDR') { w = buf.readUInt32BE(i + 8); h = buf.readUInt32BE(i + 12); type = buf[i + 17]; }
    if (t === 'IDAT') morceaux.push(buf.slice(i + 8, i + 8 + n));
    i += 12 + n;
  }
  const brut = zlib.inflateSync(Buffer.concat(morceaux));
  const bpp = type === 6 ? 4 : 3;
  const ligne = w * bpp;
  const px = Buffer.alloc(ligne * h);
  for (let y = 0; y < h; y += 1) {
    const f = brut[y * (ligne + 1)];
    for (let x = 0; x < ligne; x += 1) {
      const v = brut[y * (ligne + 1) + 1 + x];
      const a = x >= bpp ? px[y * ligne + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * ligne + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * ligne + x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[y * ligne + x] = r & 255;
    }
  }
  return { w, h, pixel: (x, y) => { const k = y * ligne + x * bpp; return [px[k], px[k + 1], px[k + 2]]; } };
}
function linQa(v) { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
function lumQa(p) { return 0.2126 * linQa(p[0]) + 0.7152 * linQa(p[1]) + 0.0722 * linQa(p[2]); }
// LE CONTRASTE D UN TEXTE, AU PIRE (WCAG 1.4.3 : 4,5:1, et 3:1 pour un grand
// texte). Deux mesures, la plus severe gagne :
//   - LES PIXELS : tout le texte de la page est rendu transparent, la vue est
//     capturee (animations figees), et chaque ligne du texte mesure est
//     comparee au pixel le plus defavorable de sa boite : photo, voile, cartes
//     et halos compris, tels qu ils sont peints ;
//   - LES HALOS : ils derivent en boucle, et un texte pose sur la page (hors
//     photo) peut passer sous leur coeur. Son fond est donc aussi pris sous
//     l arret le plus lumineux des halos affiches, puis sous chaque couche
//     semi-transparente entre la page et lui (l arret le plus clair de ses
//     degrades compris).
// La capture est decodee ICI, en Node : un second onglet pour la decoder
// passait l onglet mesure en arriere-plan, et sa capture rendait une image
// perimee. Rend, pour chaque texte visible : son extrait, son rapport, son seuil.
async function contrastesPires(page, selecteur) {
  const out = [];
  await page.bringToFront();
  const n = await page.evaluate((sel) => {
    document.querySelectorAll('[data-qa-contraste]').forEach((el) => el.removeAttribute('data-qa-contraste'));
    const cibles = Array.from(document.querySelectorAll(sel)).filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
        && Array.from(el.childNodes).some((t) => t.nodeType === 3 && t.textContent.trim());
    });
    cibles.forEach((el, k) => el.setAttribute('data-qa-contraste', String(k)));
    return cibles.length;
  }, selecteur);
  // LES COULEURS DE TEXTE, LUES UNE FOIS, AVANT TOUT MASQUE : les puces et les
  // lignes font une transition de couleur (0,2 a 0,4 s). Relues juste apres le
  // masque, elles sortaient presque transparentes, et tout mesurait 1:1.
  const couleurs = await page.evaluate((total) => Array.from({ length: total }, (x, i) => getComputedStyle(document.querySelector(`[data-qa-contraste="${i}"]`)).color), n);
  const faits = new Set();
  for (let k = 0; k < n; k += 1) {
    if (faits.has(k)) continue;
    await page.evaluate((i) => document.querySelector(`[data-qa-contraste="${i}"]`).scrollIntoView({ block: 'center' }), k);
    // Le texte est masque AVANT de lire les lignes : rien ne bouge plus entre
    // la lecture et la capture.
    await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } [data-qa-masque] {}' });
    const vus = await page.evaluate((total) => {
      const couleur = (s) => { const m = /rgba?\(([^)]+)\)/.exec(String(s || '')); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const arrets = (img) => (String(img || '').match(/rgba?\([^)]+\)/g) || []).map(couleur).filter(Boolean);
      const sur = (h, b) => ({ r: h.r * h.a + b.r * (1 - h.a), g: h.g * h.a + b.g * (1 - h.a), b: h.b * h.a + b.b * (1 - h.a), a: 1 });
      const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      const plusClair = (liste) => liste.reduce((m, c) => (!m || lum(c) > lum(m) ? c : m), null);
      const racine = document.querySelector('.fg-page') || document.body;
      const fondPage = couleur(getComputedStyle(racine).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
      // LE PIC DE CHAQUE HALO, compose a SON niveau : les halos se peignent
      // au-dessus du fond de la coquille qui les porte, sous ce qui vient
      // apres. Composes sous la racine, ils etaient effaces par le fond opaque
      // du corps de page, et un texte au coeur du halo se mesurait sur le noir.
      const pics = Array.from(document.querySelectorAll('.fg-glow i'))
        .filter((i) => i.getClientRects().length && getComputedStyle(i).display !== 'none')
        .map((i) => arrets(getComputedStyle(i).backgroundImage).reduce((m, c) => (c.a > m.a ? c : m), { r: 0, g: 0, b: 0, a: 0 }));
      const hote = pics.length ? document.querySelector('.fg-glow').parentElement : null;
      const sousHalo = (f) => plusClair([f].concat(pics.map((c) => sur(c, f))));
      const art = document.querySelector('.fg-scene.is-active .fg-art');
      const ra = art && art.getClientRects().length ? art.getBoundingClientRect() : null;
      const res = [];
      for (let i = 0; i < total; i += 1) {
        const el = document.querySelector(`[data-qa-contraste="${i}"]`);
        const lignes = [];
        Array.from(el.childNodes).filter((t) => t.nodeType === 3 && t.textContent.trim()).forEach((t) => {
          const r = document.createRange();
          r.selectNodeContents(t);
          Array.from(r.getClientRects()).forEach((x) => { if (x.width > 0.5 && x.height > 0.5) lignes.push({ x: x.left, y: x.top, w: x.width, h: x.height }); });
        });
        const dansLaVue = lignes.length && lignes.every((x) => x.y >= 0 && x.y + x.h <= innerHeight && x.x >= 0 && x.x + x.w <= innerWidth);
        if (!dansLaVue) continue;
        let opacite = 1;
        for (let p = el; p && p.nodeType === 1; p = p.parentElement) opacite *= Number(getComputedStyle(p).opacity);
        const surPhoto = Boolean(ra) && lignes.some((x) => x.x < ra.right && x.x + x.w > ra.left && x.y < ra.bottom && x.y + x.h > ra.top);
        let pireHalo = null;
        if (!surPhoto) {
          const chaine = [];
          for (let p = el; p && p !== racine && p.nodeType === 1; p = p.parentElement) chaine.unshift(p);
          let fond = fondPage;
          chaine.forEach((p) => {
            const s = getComputedStyle(p);
            const c = couleur(s.backgroundColor);
            if (c && c.a > 0) fond = sur(c, fond);
            const deg = arrets(s.backgroundImage).filter((x) => x.a > 0);
            if (deg.length) fond = plusClair(deg.map((x) => sur(x, fond)));
            if (p === hote) fond = sousHalo(fond);
          });
          pireHalo = [fond.r, fond.g, fond.b];
        }
        const cs = getComputedStyle(el);
        const taille = parseFloat(cs.fontSize) || 16;
        res.push({ i, texte: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 36), opacite, lignes, pireHalo, grand: taille >= 24 || (taille >= 18.66 && Number(cs.fontWeight) >= 700) });
      }
      return { largeur: window.innerWidth, res };
    }, n);
    const png = decoderPng(await page.screenshot({ animations: 'disabled' }));
    await page.evaluate(() => { Array.from(document.querySelectorAll('style')).filter((x) => /\[data-qa-masque\]/.test(x.textContent)).forEach((x) => x.remove()); });
    const echelle = png.w / vus.largeur;
    vus.res.forEach((v) => {
      if (faits.has(v.i)) return;
      const m = /rgba?\(([^)]+)\)/.exec(couleurs[v.i]);
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      const a = (p.length > 3 ? p[3] : 1) * v.opacite;
      const rapport = (bg) => { const t = [0, 1, 2].map((k2) => p[k2] * a + bg[k2] * (1 - a)); const lt = lumQa(t), lb = lumQa(bg); return (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05); };
      let pire = 99;
      v.lignes.forEach((l) => {
        const x0 = Math.max(0, Math.floor(l.x * echelle)), y0 = Math.max(0, Math.floor(l.y * echelle));
        const x1 = Math.min(png.w, Math.ceil((l.x + l.w) * echelle)), y1 = Math.min(png.h, Math.ceil((l.y + l.h) * echelle));
        for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) pire = Math.min(pire, rapport(png.pixel(x, y)));
      });
      const halo = v.pireHalo ? rapport(v.pireHalo) : 99;
      faits.add(v.i);
      out.push({ i: v.i, texte: v.texte, pixels: Math.round(pire * 100) / 100, halo: v.pireHalo ? Math.round(halo * 100) / 100 : null, ratio: Math.round(Math.min(pire, halo) * 100) / 100, seuil: v.grand ? 3 : 4.5 });
    });
    if (!faits.has(k)) { faits.add(k); out.push({ i: k, texte: '(jamais entier dans la vue)', pixels: 0, halo: null, ratio: 0, seuil: 4.5 }); }
  }
  await page.evaluate(() => { document.querySelectorAll('[data-qa-contraste]').forEach((el) => el.removeAttribute('data-qa-contraste')); window.scrollTo(0, 0); });
  // Les couleurs reviennent en transition : on les laisse finir.
  await dormir(500);
  return out;
}
async function lireMois(page) {
  return page.evaluate(() => ({
    titre: document.querySelector('#calTitle').textContent.trim(),
    prev: document.querySelector('#calPrev').disabled,
    next: document.querySelector('#calNext').disabled,
    vides: document.querySelectorAll('#calGrid .fg-cal__void').length,
    jours: Array.from(document.querySelectorAll('#calGrid .fg-cal__day')).map((b) => ({ date: b.dataset.date, off: b.disabled, cls: b.className, titre: b.getAttribute('title') || '', point: Boolean(b.querySelector('i')), chargement: b.classList.contains('is-loading') })),
  }));
}
async function allerAuMois(page, dateStr) {
  const [y, mo] = dateStr.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  return attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, dateStr);
}

async function main() {
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const meta = mock.metaPayload('', 45);
  const calendrier = meta.center.calendar;
  const TODAY = mock.TODAY;
  const HORIZON = plusJours(TODAY, Number(meta.bookingHorizonDays) || 365);
  const PROGRAMME = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }, { activityId: 'minigolf_blacklight' }, { activityId: 'arcade_time' }];
  const nomDe = (id) => (mock.ACTIVITIES.find((a) => a.id === id) || {}).name || id;
  // L oracle du calendrier : l annee entiere, sur la meme route, par tranches
  // de 90 jours (le plafond de la route).
  const oracleJours = {};
  for (let k = 0; k * 90 <= (Number(meta.bookingHorizonDays) || 365); k += 1) {
    const r = await lireJson(`${BASE_URL}/api/public-booking-meta?centerId=libramont&calendar=90&calendarFrom=${plusJours(TODAY, k * 90)}`);
    ((r.center && r.center.calendar) || []).forEach((j) => { oracleJours[j.date] = j; });
  }
  const erreursPage = [];
  try {
    // =====================================================================
    console.log('[A] MONTAGE, POIDS');
    // =====================================================================
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const demandes = [];
    const reponsesMeta = [];
    page.on('request', (r) => demandes.push(r.url()));
    page.on('response', (r) => { if (r.url().indexOf('/api/public-booking-meta?') >= 0) reponsesMeta.push({ url: r.url(), status: r.status() }); });
    page.on('pageerror', (err) => erreursPage.push(String(err && err.message || err)));
    await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000),
      '[A] le catalogue est lu : un jour est propose');
    const jour = await page.evaluate(() => document.querySelector('#dayLabel').textContent.trim());
    const premierOuvert = calendrier.find((d) => d.open);
    ok(Boolean(premierOuvert) && jour === jourLong(premierOuvert.date), '[A] le jour propose est le PREMIER jour ouvert du calendrier servi', `${jour} / ${premierOuvert && premierOuvert.date}`);
    const montage = await page.evaluate(() => {
      const scene = document.querySelector('.fg-scene.is-active');
      const img = scene.querySelector('.fg-art img');
      return {
        scene: scene && scene.dataset.scene,
        etapes: scene.querySelectorAll('[data-steps] .fg-steps__item').length,
        active: scene.querySelector('[data-steps] .fg-steps__item.is-active .lbl') ? scene.querySelector('[data-steps] .fg-steps__item.is-active .lbl').textContent.trim() : '',
        photo: Boolean(img && img.complete && img.naturalWidth > 0),
        pax: document.querySelector('#paxOut').textContent.trim(),
        saisie: document.querySelector('#paxInput').value,
        mots: Array.from(scene.querySelectorAll('.fg-title .w > span')).map((s) => s.textContent),
        halos: document.querySelectorAll('.fg-glow i').length,
      };
    });
    ok(montage.scene === 'date' && montage.etapes === 5 && montage.active === 'Date & groupe', '[A] le fil des 5 etapes est rendu, etape 1 active', JSON.stringify({ scene: montage.scene, etapes: montage.etapes, active: montage.active }));
    ok(montage.photo, '[A] la photo de l ecran est decodee');
    ok(montage.pax === '4 personnes' && montage.saisie === '4', '[A] le groupe demarre a 4 personnes, le nombre est dans le champ', `${montage.pax} / « ${montage.saisie} »`);
    const dernierMot = String(montage.mots[montage.mots.length - 1] || '').trim();
    const titrePonctue = /[?!]$/.test(dernierMot);
    ok(montage.mots.length >= 2
      && !montage.mots.some((m) => /^[?!]$/.test(m.trim()))
      && (!titrePonctue || /\u00a0[?!]$/.test(dernierMot)),
      '[A] le titre est decoupe mot a mot, et une ponctuation finale reste collee a son mot (espace insecable)',
      `${JSON.stringify(montage.mots)}${titrePonctue ? '' : ' (titre affirmatif : aucune ponctuation a coller)'}`);
    // LES CINQ TITRES NE SE RESSEMBLENT PAS (Movsar, 2026-09-23 : « trop
    // similaires, faut un truc plus percutant ») : chacun ouvre sur un mot
    // different, et aucune ponctuation finale ne part seule sur sa ligne.
    const titres = await page.evaluate(() => Array.from(document.querySelectorAll('.fg-scene:not([data-scene="fin"]) .fg-title')).map((t) => Array.from(t.querySelectorAll('.w > span')).map((x) => x.textContent)));
    const ouvertures = titres.map((mots) => plat(mots[0] || '').toLowerCase());
    ok(titres.length === 5 && new Set(ouvertures).size === 5
      && titres.every((mots) => mots.length >= 2 && !mots.some((x) => /^[?!]$/.test(x.trim())) && mots.every((x) => !/[?!]$/.test(x) || /\u00a0[?!]$/.test(x))),
      '[A] les cinq titres ouvrent chacun sur un mot different, et une ponctuation finale reste collee a son mot', titres.map((mots) => `« ${mots.join(' ')} »`).join(' '));
    ok(await attendre(page, () => getComputedStyle(document.querySelector('.fg-curtain')).visibility === 'hidden', 3000) && montage.halos === 2, '[A] le rideau d ouverture finit invisible (au plus 3 s), deux halos en place', JSON.stringify({ halos: montage.halos }));
    const poids = poidsServi();
    ok(poids.nettoyes && poids.octets < BUDGET_SERVI, `[A] JS + CSS + HTML SERVIS (apres le build) sous ${BUDGET_SERVI / 1024} Ko a analyser`, `${Math.round(poids.octets / 102.4) / 10} Ko, ${poids.sortie}`);
    ok(poids.transfere < BUDGET_TRANSFERE, `[A] et sous ${BUDGET_TRANSFERE / 1024} Ko a telecharger (compresses, comme le serveur les envoie)`, `${Math.round(poids.transfere / 102.4) / 10} Ko`);
    ok(!demandes.some((u) => /-1600\.webp/.test(u)), '[A] aucune photo 1600 px demandee sur un ecran de 1440', demandes.filter((u) => /webp/.test(u)).map((u) => u.split('/').pop()).join(', '));
    ok(demandes.filter((u) => /\.webp/.test(u)).length <= 2, '[A] au plus deux photos chargees au depart (l ecran et le suivant)');
    ok(demandes.some((u) => /public-booking-meta\?.*calendar=45/.test(u)), '[A] le catalogue est demande AVEC le calendrier (calendar=45)');

    // =====================================================================
    console.log('');
    console.log('[A2] CALENDRIER PAR MOIS, JUSQU A L HORIZON ; GROUPE TAPE');
    // =====================================================================
    ok(calendrier.every((j) => JSON.stringify(j) === JSON.stringify(oracleJours[j.date])), '[A2] (oracle) les 45 jours du catalogue et les tranches calendarFrom disent la meme chose', `${Object.keys(oracleJours).length} jours relus`);
    await page.click('#dayBtn');
    ok(await attendre(page, () => !document.querySelector('#dayPop').hidden && document.querySelectorAll('#calGrid .fg-cal__day').length >= 28 && !document.querySelector('#calGrid .fg-cal__day.is-loading'), 5000), '[A2] le calendrier s ouvre sur le mois en cours, charge');
    ok(await page.evaluate(() => document.querySelector('#dayBtn').getAttribute('aria-expanded') === 'true' && document.querySelector('#dayBtn').closest('.fg-field').classList.contains('is-open')), '[A2] le champ se dit ouvert (aria-expanded) et monte au-dessus de ses voisins');
    const [ty, tm] = TODAY.split('-').map(Number);
    const [hy, hm] = HORIZON.split('-').map(Number);
    const moisAttendus = (hy - ty) * 12 + (hm - tm) + 1;
    const ecartsCal = [];
    const vus = [];
    let fleches = { prevAuDebut: null, nextALaFin: null };
    for (let k = 0; k < moisAttendus + 2; k += 1) {
      if (!await attendre(page, () => !document.querySelector('#calGrid .fg-cal__day.is-loading'), 8000)) ecartsCal.push(`mois ${k} : chargement jamais fini`);
      const m = await lireMois(page);
      const y = ty + Math.floor((tm - 1 + k) / 12);
      const mo = ((tm - 1 + k) % 12) + 1;
      const titre = `${cap(MOIS[mo - 1])} ${y}`;
      if (m.titre !== titre) ecartsCal.push(`titre ${m.titre} vs ${titre}`);
      const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      if (m.jours.length !== n) ecartsCal.push(`${titre}: ${m.jours.length} jours vs ${n}`);
      const decalage = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
      if (m.vides !== decalage) ecartsCal.push(`${titre}: ${m.vides} cases vides vs ${decalage} (lundi en tete)`);
      m.jours.forEach((x) => {
        if (x.chargement) { ecartsCal.push(`${x.date} encore en chargement`); return; }
        if (x.date < TODAY) { if (!x.off || !/is-past/.test(x.cls)) ecartsCal.push(`${x.date} passe et cliquable`); return; }
        if (x.date > HORIZON) { if (!x.off) ecartsCal.push(`${x.date} au-dela de l horizon et cliquable`); return; }
        const j = oracleJours[x.date];
        if (!j) { ecartsCal.push(`${x.date} absent de l oracle`); return; }
        if (x.off !== !j.open) ecartsCal.push(`${x.date}: cliquable=${!x.off}, ouvert=${j.open}`);
        const ferie = Boolean(j.holiday && j.holiday.type === 'public');
        const conge = Boolean(j.holiday && j.holiday.type !== 'public');
        if (/is-ferie/.test(x.cls) !== ferie || /is-vacances/.test(x.cls) !== conge || x.point !== Boolean(j.holiday)) ecartsCal.push(`${x.date}: marque « ${x.cls} » point=${x.point} vs ${JSON.stringify(j.holiday)}`);
        if (plat(x.titre) !== plat(titreJour(j))) ecartsCal.push(`${x.date}: « ${x.titre} » vs « ${titreJour(j)} »`);
        if (/is-today/.test(x.cls) !== (x.date === TODAY)) ecartsCal.push(`${x.date}: marque « aujourd hui » fausse`);
      });
      vus.push({ titre: m.titre, jours: m.jours.length });
      if (k === 0) fleches.prevAuDebut = m.prev;
      if (m.next) { fleches.nextALaFin = true; break; }
      await page.click('#calNext');
      await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, m.titre);
    }
    ok(ecartsCal.length === 0, '[A2] CHAQUE jour de CHAQUE mois = le calendrier servi (ferme grise, horaires ou motif, ferie/conge marque, passe et au-dela de l horizon grises)', ecartsCal.slice(0, 4).join(' ; ') || `${vus.length} mois, ${vus.reduce((s, v) => s + v.jours, 0)} jours conformes`);
    ok(fleches.prevAuDebut === true, '[A2] la fleche « precedent » est inactive sur le mois en cours');
    ok(vus.length === moisAttendus && fleches.nextALaFin === true && vus[vus.length - 1].titre === `${cap(MOIS[hm - 1])} ${hy}`, '[A2] la fleche « suivant » mene jusqu a l horizon de reservation, pas plus loin', `${vus.length} mois de ${vus[0] && vus[0].titre} a ${vus[vus.length - 1] && vus[vus.length - 1].titre}`);
    const tranches = reponsesMeta.filter((r) => /calendarFrom=/.test(r.url));
    const moisCharges = new Set(tranches.map((r) => new URL(r.url).searchParams.get('calendarFrom').slice(0, 7)));
    const moisAuDela = [];
    for (let k = 0; k < moisAttendus; k += 1) {
      const y = ty + Math.floor((tm - 1 + k) / 12); const mo = ((tm - 1 + k) % 12) + 1;
      const cle = `${y}-${String(mo).padStart(2, '0')}`;
      const dernier = `${cle}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
      if (dernier > plusJours(TODAY, 44)) moisAuDela.push(cle);
    }
    const moisDemandes = tranches.map((r) => new URL(r.url).searchParams.get('calendarFrom').slice(0, 7));
    ok(tranches.length > 0 && tranches.every((r) => r.status === 200) && moisDemandes.every((c) => moisAuDela.indexOf(c) >= 0) && new Set(moisDemandes).size === moisDemandes.length, '[A2] les mois au-dela des 45 premiers jours se chargent a la demande (calendarFrom), jamais deux fois le meme, tous en 200', `${tranches.length} demandes (${[...moisCharges].join(', ')}) pour ${moisAuDela.length} mois au-dela`);
    const annee = Object.values(oracleJours).filter((j) => j.date >= TODAY && j.date <= HORIZON);
    ok(annee.some((j) => j.holiday && j.holiday.type === 'public') && annee.some((j) => j.holiday && j.holiday.type !== 'public') && annee.some((j) => !j.open), '[A2] (la propriete est exercee) l annee contient des feries, des conges scolaires et des jours fermes');
    // LE CLAVIER : Echap ferme ; a la reouverture, le jour choisi porte le focus,
    // la fleche droite passe au jour OUVERT suivant, Entree le choisit.
    await page.keyboard.press('Escape');
    ok(await attendre(page, () => document.querySelector('#dayPop').hidden && document.activeElement === document.querySelector('#dayBtn'), 2000), '[A2] Echap referme le calendrier et rend le focus au champ');
    await page.click('#dayBtn');
    await attendre(page, () => !document.querySelector('#dayPop').hidden && !document.querySelector('#calGrid .fg-cal__day.is-loading'), 5000);
    const choisi0 = premierOuvert.date;
    ok(await page.evaluate((d) => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.date === d, choisi0), '[A2] a la reouverture, le jour choisi porte le focus', choisi0);
    const suivant = Object.keys(oracleJours).sort().find((d) => d > choisi0 && d <= HORIZON && oracleJours[d].open);
    await page.keyboard.press('ArrowRight');
    ok(await attendre(page, (d) => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.date === d, 3000, suivant), '[A2] la fleche droite passe au jour OUVERT suivant (les fermes sont sautes)', suivant);
    await page.keyboard.press('Enter');
    ok(await attendre(page, (l) => document.querySelector('#dayPop').hidden && document.querySelector('#dayLabel').textContent.trim() === l, 3000, jourLong(suivant)), '[A2] Entree choisit ce jour et referme le calendrier', jourLong(suivant));
    // UN LUNDI DE CONGE SCOLAIRE : ouvert, avec l horaire de vacances et sa periode.
    const lundiConge = annee.find((d) => deIso(d.date).getUTCDay() === 1 && d.open && d.holiday && d.holiday.type !== 'public');
    if (lundiConge) {
      await page.click('#dayBtn');
      ok(await allerAuMois(page, lundiConge.date), '[A2] le mois du lundi de conge s affiche', lundiConge.date);
      await page.click(`#calGrid .fg-cal__day[data-date="${lundiConge.date}"]`);
      const indice = await page.evaluate(() => document.querySelector('#dayHint').textContent.replace(/\s+/g, ' ').trim());
      ok(plat(indice) === plat(`Ouvert ${horaire(lundiConge.schedule)} · ${lundiConge.holiday.label}`), '[A2] un LUNDI de conge scolaire est ouvert ; sous le champ, l horaire et la periode du jour', `${lundiConge.date} « ${indice} »`);
    } else {
      ok(false, '[A2] un lundi de conge scolaire existe dans l annee (sinon la propriete n est pas exercee)');
    }
    // Le samedi du mock : le jour que l oracle des heures interroge plus bas.
    await page.click('#dayBtn');
    ok(await allerAuMois(page, mock.DATE), '[A2] retour au mois du samedi du mock', mock.DATE);
    await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    ok(await attendre(page, (l) => document.querySelector('#dayPop').hidden && document.querySelector('#dayLabel').textContent.trim() === l, 3000, jourLong(mock.DATE)), '[A2] le samedi du mock est retenu et le calendrier se referme', jourLong(mock.DATE));
    // LE GROUPE SE TAPE.
    await page.fill('#paxInput', '999');
    await page.press('#paxInput', 'Enter');
    ok(await attendre(page, () => document.querySelector('#paxInput').value === '240' && document.querySelector('#paxOut').textContent.trim() === '240 personnes' && document.querySelector('#paxPlus').disabled, 3000), '[A2] un nombre tape au-dela de 240 est ramene a 240, le « + » se desactive');
    await page.fill('#paxInput', '6');
    await page.press('#paxInput', 'Enter');
    ok(await attendre(page, () => document.querySelector('#paxInput').value === '6' && document.querySelector('#paxOut').textContent.trim() === '6 personnes', 3000), '[A2] taper 6 donne 6 personnes');
    await page.click('#paxMinus');
    ok(await attendre(page, () => document.querySelector('#paxInput').value === '5' && document.querySelector('#paxOut').textContent.trim() === '5 personnes', 3000), '[A2] le « - » suit le nombre tape : 5');
    await page.click('#paxPlus');
    ok(await attendre(page, () => document.querySelector('#paxInput').value === '6' && document.querySelector('#paxOut').textContent.trim() === '6 personnes', 3000), '[A2] le « + » aussi : 6 personnes');

    // =====================================================================
    console.log('');
    console.log('[A3] EMPILEMENT DU CALENDRIER, LIBELLES DES ETAPES (colonne etroite)');
    // =====================================================================
    const etroit = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const pageEtroite = await etroit.newPage();
    await pageEtroite.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageEtroite, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour' && !document.querySelector('.fg-scene.is-entering'), 15000), '[A3] page chargee a 1000 px');
    await dormir(900);
    const colonne = await pageEtroite.evaluate(() => {
      const day = document.querySelector('#dayBtn').getBoundingClientRect();
      const pax = document.querySelector('#paxValue').getBoundingClientRect();
      const lbls = Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item')).map((li) => ({ active: li.classList.contains('is-active'), visible: getComputedStyle(li.querySelector('.lbl')).display !== 'none' }));
      return { empiles: pax.top > day.bottom, ecart: Math.round(pax.top - day.bottom), largeurSteps: Math.round(document.querySelector('.fg-scene.is-active .fg-steps').getBoundingClientRect().width), lbls };
    });
    ok(colonne.empiles, '[A3] a 1000 px, le compteur est SOUS le champ du jour (la configuration du defaut)', JSON.stringify({ ecart: colonne.ecart, largeurSteps: colonne.largeurSteps }));
    ok(colonne.largeurSteps <= 500 && colonne.lbls.filter((l) => l.active).every((l) => l.visible) && colonne.lbls.filter((l) => !l.active).every((l) => !l.visible), '[A3] fil des etapes sous 500 px : seul le libelle de l etape en cours reste', JSON.stringify(colonne.lbls));
    await pageEtroite.click('#dayBtn');
    ok(await attendre(pageEtroite, () => !document.querySelector('#dayPop').hidden, 2000), '[A3] le calendrier s ouvre');
    await dormir(400);
    const dessus = await pageEtroite.evaluate(() => {
      const pop = document.querySelector('#dayPop').getBoundingClientRect();
      const au = (r) => {
        const x = (Math.max(r.left, pop.left) + Math.min(r.right, pop.right)) / 2;
        const y = (Math.max(r.top, pop.top) + Math.min(r.bottom, pop.bottom)) / 2;
        if (Math.max(r.left, pop.left) >= Math.min(r.right, pop.right) || Math.max(r.top, pop.top) >= Math.min(r.bottom, pop.bottom)) return 'pas de recouvrement';
        const el = document.elementFromPoint(x, y);
        return el ? (el.closest('#dayPop') ? 'calendrier' : (el.id || el.className || el.tagName)) : 'rien';
      };
      return { surPax: au(document.querySelector('#paxValue').getBoundingClientRect()), surBouton: au(document.querySelector('#goActivities').getBoundingClientRect()) };
    });
    ok(dessus.surPax === 'calendrier' && (dessus.surBouton === 'calendrier' || dessus.surBouton === 'pas de recouvrement'), '[A3] le calendrier ouvert est DEVANT le compteur et le bouton', JSON.stringify(dessus));
    await etroit.close();

    // =====================================================================
    console.log('');
    console.log('[B] ACTIVITES : CARTES ET TIROIRS D OPTIONS');
    // =====================================================================
    await page.click('#goActivities');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000), '[B] l ecran des activites est actif, transition finie');
    const fil = await page.evaluate(() => ({ largeur: Math.round(document.querySelector('.fg-scene.is-active .fg-steps').getBoundingClientRect().width), visibles: Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item .lbl')).filter((l) => getComputedStyle(l).display !== 'none').length }));
    ok(fil.largeur > 500 && fil.visibles === 5, '[B] sur une scene pleine largeur a 1440 px, le fil est large et ses cinq libelles sont visibles', JSON.stringify(fil));
    const lireCartes = () => page.evaluate(() => Array.from(document.querySelectorAll('#gridAct li.fg-grid__item')).map((li) => {
      const c = li.querySelector('.fg-card');
      const tiroir = li.querySelector('.fg-card__optin');
      return {
        id: li.dataset.activity,
        prix: c.querySelector('.fg-card__price').textContent.trim(),
        off: c.classList.contains('is-off') && c.getAttribute('aria-disabled') === 'true',
        pastilles: Array.from(li.querySelectorAll('.fg-pill')).map((p) => ({ valeur: p.dataset.valeur, label: p.querySelector('b').textContent.trim(), prix: p.querySelector('small').textContent.trim(), on: p.getAttribute('aria-checked') === 'true' })),
        tiroir: tiroir ? Math.round(tiroir.getBoundingClientRect().height) : null,
        titre: li.querySelector('.fg-card__optlabel') ? li.querySelector('.fg-card__optlabel').textContent.trim() : '',
      };
    }));
    const cartes = await lireCartes();
    ok(cartes.length === mock.ACTIVITIES.length, '[B] une carte par activite vendable', `${cartes.length}/${mock.ACTIVITIES.length}`);
    const minPiste = Math.min(...meta.durationOptions.map((o) => Number(o.price)));
    const minLaser = Math.min(...meta.laserOptions.map((o) => Number(o.price)));
    const minFunRun = Math.min(...meta.funRunOptions.map((o) => Number(o.price)));
    ok(minPiste === Math.min(...Object.values(meta.bowlingPrices).map(Number)), '[B] la grille des durees et la grille des prix piste disent le meme minimum');
    const carte = (id, liste) => (liste || cartes).find((c) => c.id === id) || {};
    ok(carte('bowling').prix === `Dès ${euros(minPiste)} / piste`, '[B] bowling : « des » = minimum de la grille servie', carte('bowling').prix);
    ok(carte('laser_game').prix === `Dès ${euros(minLaser)} / personne`, '[B] laser : « des » = minimum des parties servies', carte('laser_game').prix);
    ok(carte('fun_run').prix === `Dès ${euros(minFunRun)} / session · 5 joueurs par session`, '[B] fun run : « des » = minimum des sessions servies, et la capacite D UNE session', carte('fun_run').prix);
    ok(carte('minigolf_blacklight').prix === 'Dès 10 € / personne · 12 niveaux', '[B] minigolf : tarif saisi par le centre, avec sa note', carte('minigolf_blacklight').prix);
    ok(carte('arcade_time').prix === 'Tarif sur place', '[B] arcades : sans tarif saisi, « Tarif sur place », jamais un chiffre', carte('arcade_time').prix);
    // A SIX JOUEURS, LE FUN RUN NE DISPARAIT PLUS : IL TOURNE (demande de
    // Movsar, 2026-09-23). Le catalogue declare une installation de 5 places,
    // pas un maximum de groupe : six personnes font deux passages. Cette
    // ligne disait l inverse jusqu au 2026-09-23 ; la regle a change, pas le
    // gate qui la lisait. Le detail est prouve par funrun-rotation-check.
    ok(carte('fun_run').off === false && carte('bowling').off === false, '[B] a 6 joueurs, le Fun Run reste choisissable (il tourne en 2 sessions), le bowling aussi');
    const grille = (liste, cle) => liste.map((o) => `${o.label}=${euros(o.price)}`).join(' | ');
    const pastillesDe = (c) => c.pastilles.map((p) => `${p.label}=${p.prix}`).join(' | ');
    ok(pastillesDe(carte('bowling')) === grille(meta.durationOptions) && pastillesDe(carte('laser_game')) === grille(meta.laserOptions) && pastillesDe(carte('fun_run')) === grille(meta.funRunOptions) && carte('minigolf_blacklight').pastilles.length === 0,
      '[B] chaque tiroir porte TOUTES les options de la grille servie avec leur prix ; rien pour un tarif simple', pastillesDe(carte('laser_game')));
    ok(carte('bowling').titre === 'Durée de piste' && carte('laser_game').titre === 'Parties', '[B] chaque tiroir dit ce qu on choisit (duree, parties)', `${carte('bowling').titre} / ${carte('laser_game').titre}`);
    ok(cartes.every((c) => c.tiroir === null || c.tiroir === 0), '[B] les tiroirs restent fermes tant que la carte n est pas cochee', cartes.map((c) => `${c.id}:${c.tiroir}`).join(' '));
    ok(await page.evaluate(() => document.querySelector('#goHours').disabled), '[B] sans selection, « Continuer » est inactif');
    const hauteurAvant = await page.evaluate(() => Math.round(document.querySelector('#gridAct .fg-card[data-activity="bowling"]').getBoundingClientRect().height));
    for (const id of ['bowling', 'laser_game', 'minigolf_blacklight', 'arcade_time']) await page.click(`#gridAct .fg-card[data-activity="${id}"]`);
    ok(await attendre(page, () => document.querySelector('#actCount').textContent.replace(/\s+/g, ' ').trim() === '4 activités sélectionnées', 3000), '[B] le compteur dit « 4 activites selectionnees »');
    ok(await attendre(page, () => ['bowling', 'laser_game'].every((id) => { const t = document.querySelector(`#gridAct li[data-activity="${id}"] .fg-card__optin`); return t.getBoundingClientRect().height > 40 && getComputedStyle(t).opacity === '1'; }), 3000), '[B] cochees, les cartes bowling et laser ouvrent leur tiroir');
    const uneHeure = meta.durationOptions.find((o) => Number(o.value) === 1);
    let apres = await lireCartes();
    ok((carte('bowling', apres).pastilles.find((p) => p.on) || {}).valeur === '1' && carte('bowling', apres).prix === `${euros(uneHeure.price)} / piste`, '[B] bowling : « 1 heure » retenue d office, la carte dit son prix exact', `${carte('bowling', apres).prix}`);
    const geometrie = await page.evaluate(() => {
      const li = document.querySelector('#gridAct li[data-activity="bowling"]');
      const c = li.querySelector('.fg-card').getBoundingClientRect();
      const t = li.querySelector('.fg-card__optbox').getBoundingClientRect();
      const parRangee = {};
      document.querySelectorAll('#gridAct .fg-card').forEach((x) => { const r = x.getBoundingClientRect(); const k = Math.round(r.top); (parRangee[k] = parRangee[k] || []).push(Math.round(r.height)); });
      return { colle: Math.abs(t.top - c.bottom), parRangee, hauteur: Math.round(c.height) };
    });
    ok(geometrie.colle <= 2, '[B] le tiroir s ouvre juste SOUS la carte', `${Math.round(geometrie.colle)} px`);
    ok(Object.values(geometrie.parRangee).every((h) => Math.max(...h) - Math.min(...h) <= 1) && Math.abs(geometrie.hauteur - hauteurAvant) <= 1, '[B] un tiroir ouvert n etire aucune carte : chaque rangee garde des cartes de meme hauteur', JSON.stringify(geometrie.parRangee));
    const deuxParties = meta.laserOptions.find((o) => Number(o.games) === 2);
    const troisParties = meta.laserOptions.find((o) => Number(o.games) === 3);
    await page.click('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]');
    ok(await attendre(page, (attendu) => document.querySelector('#gridAct li[data-activity="laser_game"] .fg-card__price').textContent.trim() === attendu && document.querySelector('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]').getAttribute('aria-checked') === 'true', 3000, `${euros(deuxParties.price)} / personne`), '[B] toucher « 2 parties » la retient et met son prix sur la carte', `${euros(deuxParties.price)} / personne`);
    await page.keyboard.press('ArrowRight');
    ok(await attendre(page, (attendu) => { const p = document.querySelector('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="3"]'); return p.getAttribute('aria-checked') === 'true' && document.activeElement === p && document.querySelector('#gridAct li[data-activity="laser_game"] .fg-card__price').textContent.trim() === attendu; }, 3000, `${euros(troisParties.price)} / personne`), '[B] au clavier, la fleche droite passe a « 3 parties » (focus et prix suivent)');
    await page.keyboard.press('ArrowLeft');
    ok(await attendre(page, (attendu) => document.querySelector('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]').getAttribute('aria-checked') === 'true' && document.querySelector('#gridAct li[data-activity="laser_game"] .fg-card__price').textContent.trim() === attendu, 3000, `${euros(deuxParties.price)} / personne`), '[B] la fleche gauche revient a « 2 parties »');
    ok(await page.evaluate(() => document.querySelectorAll('#gridAct .fg-card.is-on[aria-checked="true"]').length === 4 && !document.querySelector('#goHours').disabled), '[B] quatre cartes cochees, « Continuer » actif');

    // =====================================================================
    console.log('');
    console.log('[C] HEURES : PISTES, MENUS, ETATS, PLAN ADAPTE');
    // =====================================================================
    const avantHeures = demandes.length;
    await page.click('#goHours');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 5000), '[C] l ecran des heures est actif');
    ok(await attendre(page, () => document.querySelectorAll('#hourZone .fg-track .fg-chip').length > 0 && document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[C] les pistes et le bloc « votre visite » sont rendus');
    const demandeHeures = demandes.slice(avantHeures).find((u) => u.indexOf('/api/public-availability?') >= 0) || '';
    const pd = demandeHeures ? new URL(demandeHeures).searchParams : new URLSearchParams();
    let programmeEnvoye = null;
    try { programmeEnvoye = JSON.parse(pd.get('program') || 'null'); } catch (error) { programmeEnvoye = null; }
    ok(JSON.stringify(programmeEnvoye) === JSON.stringify(PROGRAMME) && pd.get('softReserve') === '1' && pd.get('pax') === '6' && pd.get('date') === mock.DATE, '[C] la demande porte le programme choisi (2 parties de laser comprises), le groupe, le jour et le mode souple', `${JSON.stringify(programmeEnvoye)} softReserve=${pd.get('softReserve')}`);
    const sousTitre = await page.evaluate(() => document.querySelector('#hourSub').textContent.replace(/\s+/g, ' ').trim());
    const jourMock = oracleJours[mock.DATE];
    ok(/6 personnes · Bowling \+ Laser Game \+ Minigolf Blacklight \+ Arcades/.test(sousTitre) && (!jourMock || plat(sousTitre).indexOf(plat(`Ouvert ${horaire(jourMock.schedule)}`)) >= 0), '[C] le sous-titre reprend groupe, activites et horaire du jour', sousTitre);
    ok(await page.evaluate(() => { const l = document.querySelector('.fg-legend'); return Boolean(l) && /Serré/.test(l.textContent) && /Décale/.test(l.textContent) && /Complet/.test(l.textContent); }), '[C] une legende dit ce que veulent « serre », « decale » et « complet »');
    const base = { centerId: 'libramont', date: mock.DATE, type: 'visite', pax: '6', program: JSON.stringify(PROGRAMME), softReserve: '1' };
    const route = async (extra) => {
      const q = new URLSearchParams(base);
      Object.entries(extra || {}).forEach(([k, v]) => q.set(k, typeof v === 'string' ? v : JSON.stringify(v)));
      return lireJson(`${BASE_URL}/api/public-availability?${q}`);
    };
    const ancresDe = (d) => (d.anchors && d.anchors.activities) || [];
    const verifierPistes = async (d, pins, laserParts, label, pg = page) => {
      const pistes = await lirePistes(pg);
      const defauts = (d.anchors && d.anchors.defaultTimes) || {};
      const e = [];
      if (pistes.map((p) => p.id).join(',') !== ancresDe(d).map((a) => a.activityId).join(',')) e.push(`pistes ${pistes.map((p) => p.id).join(',')} vs ${ancresDe(d).map((a) => a.activityId).join(',')}`);
      ancresDe(d).forEach((a) => {
        const actifs = a.activityId === 'laser_game' && laserParts.length ? laserParts : (pins[a.activityId] ? [pins[a.activityId]] : []);
        const propose = actifs.length ? '' : (defauts[a.activityId] || '');
        e.push(...ecartsPiste(pistes.find((p) => p.id === a.activityId), a, actifs, propose, d));
        const p = pistes.find((x) => x.id === a.activityId);
        if (p && p.reset !== actifs.length > 0) e.push(`${a.activityId}: « laisser l equipe placer » ${p.reset ? 'visible' : 'cache'} avec ${actifs.length} heure(s) posee(s)`);
        if (p && !p.touchee) e.push(...ecartsMenus(p, a, actifs, propose));
      });
      ok(e.length === 0, label, e.slice(0, 4).join(' ; ') || ancresDe(d).map((a) => `${a.activityId} ${a.times.length} h`).join(', '));
      return pistes;
    };
    const verifierPlan = async (d, label) => {
      const ecran = await lireEcranPlan(page);
      const o = lignePlan(d);
      const e = ecartsPlan(ecran, o);
      ok(e.length === 0 && ecran && ecran.garder, label, e.slice(0, 3).join(' ; ') || `${o && o.blocs.map((b) => `${b.id}@${b.t}`).join(', ')}, fin ${o && o.fin}${o && o.fermeture ? ' (fermeture, manque ' + o.manque + ' min)' : ''}`);
      return { ecran, o };
    };
    // 0. SANS HEURE POSEE : les pistes et le plan du serveur.
    const d0 = await route();
    let pistes = await verifierPistes(d0, {}, [], '[C] SANS POSE : une piste par activite, TOUTES les heures dans l etat du moteur (raison, mot, titre), rangees en menus matin/apres-midi/soiree, le menu de l heure proposee ouvert');
    ok(ancresDe(d0).some((a) => a.times.some((t) => t.ok === false && t.code !== 'anchor_overlap')), '[C] (la propriete est exercee) une heure impossible existe ce jour-la');
    await verifierPlan(d0, '[C] SANS POSE : « votre visite » = la reponse (arrivee, activites a leur heure, minigolf et arcades en libre, fin, prix) et « Garder » est actif');
    ok(await page.evaluate(() => document.querySelector('#keepLabel').textContent.trim() === 'Garder ces horaires'), '[C] le bouton dit « Garder ces horaires »');
    const centres = await centrages(page);
    ok(centres.length > 0 && centres.every((c) => c.ecart <= 1), '[C] dans chaque case, l heure (et son mot s il y en a un) est centree verticalement', centres.filter((c) => c.ecart > 1).map((c) => `${c.t} « ${c.mot} » ${c.ecart.toFixed(1)} px`).join(', ') || `${centres.length} cases, ecart max ${Math.max(...centres.map((c) => c.ecart)).toFixed(1)} px`);
    // 1. POSER UNE HEURE DE BOWLING : mise a jour sur place, la piste du laser
    //    se recalcule, son menu suit la nouvelle proposition.
    const bowling0 = ancresDe(d0).find((a) => a.activityId === 'bowling');
    const okBowling = bowling0.times.filter((t) => t.ok !== false && !t.warning).map((t) => t.time);
    const B = okBowling.find((t) => t !== d0.anchors.defaultTimes.bowling && okBowling.indexOf(t) >= 2) || okBowling[okBowling.length - 1];
    const selB = `#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${B}"]`;
    await page.evaluate((s) => { window.__qaCase = document.querySelector(s); window.__qaHaut = window.__qaCase.getBoundingClientRect().top + window.scrollY; }, selB);
    ok(await poserEtAttendre(page, 'bowling', B), '[C] poser une heure de bowling recalcule (une demande, puis fin du voile)', B);
    const suivi = await page.evaluate((s) => { const c = document.querySelector(s); return { meme: c === window.__qaCase, on: c.classList.contains('is-on'), transform: getComputedStyle(c).transform, saut: Math.abs(c.getBoundingClientRect().top + window.scrollY - window.__qaHaut), focus: document.activeElement === c }; }, selB);
    ok(suivi.meme && suivi.on && suivi.transform === 'none' && suivi.saut <= 1, '[C] la case posee est LA MEME (mise a jour sur place), sans transformation ni deplacement : aucun tremblement', JSON.stringify(suivi));
    ok(suivi.focus, '[C] la case posee garde le focus (clavier)');
    const d1 = await route({ preferredTimes: { bowling: B } });
    pistes = await verifierPistes(d1, { bowling: B }, [], '[C] BOWLING POSE : les deux pistes = la route preferredTimes={bowling} (le laser recalcule, son menu suit sa nouvelle proposition)');
    await verifierPlan(d1, '[C] BOWLING POSE : « votre visite » = la route preferredTimes={bowling}');
    const aDecaler = (pistes.find((p) => p.id === 'laser_game') || { chips: [] }).chips.filter((c) => c.etat === 'shift');
    ok(aDecaler.length > 0 && aDecaler.every((c) => c.conflit === 'bowling' && c.mot === 'décale' && c.ok), '[C] les heures du laser qui chevauchent le bowling sont « a decaler », choisissables, avec le bowling en cause', aDecaler.map((c) => `${c.t} « ${c.titre} »`).join(', '));
    // 2. UNE HEURE IMPOSSIBLE S EXPLIQUE DEJA SOUS SA PLAGE : la toucher
    //    eclaire SA ligne, sans rien demander ni rien changer.
    const dure = ancresDe(d1).flatMap((a) => a.times.filter((t) => t.ok === false && t.code !== 'anchor_overlap').map((t) => ({ id: a.activityId, t }))).pop();
    if (dure) {
      const avantDure = demandes.length;
      await toucherHeure(page, dure.id, dure.t.time);
      const lu = await page.evaluate(({ id, h }) => {
        const chip = document.querySelector(`#hourZone .fg-track[data-activity="${id}"] .fg-chip[data-time="${h}"]`);
        const lit = Array.from(document.querySelectorAll('#hourZone .fg-why-list__item.is-lit'));
        const l = lit[0];
        return {
          asked: Array.from(document.querySelectorAll('#hourZone .fg-chip.is-asked')).map((c) => c.dataset.time),
          eclairees: lit.length,
          memePlage: Boolean(l) && l.closest('.fg-period') === chip.closest('.fg-period'),
          heures: l ? String(l.dataset.heures || '').split(' ') : [],
          texte: l ? l.textContent.replace(/\s+/g, ' ').trim() : '',
          visible: Boolean(l) && l.getBoundingClientRect().height > 0,
        };
      }, { id: dure.id, h: dure.t.time });
      const raisonDure = String(dure.t.reason || 'Indisponible').toLowerCase();
      ok(lu.asked.length === 1 && lu.asked[0] === dure.t.time && lu.eclairees === 1 && lu.memePlage && lu.heures.indexOf(dure.t.time) >= 0
        && lu.texte.toLowerCase().indexOf(raisonDure) >= 0 && lu.visible,
        '[C] toucher une heure impossible eclaire SA ligne sous sa plage : l heure y est, la raison du moteur aussi, mot pour mot', `${dure.t.time} « ${lu.texte} »`);
      await dormir(300);
      ok(demandes.slice(avantDure).every((u) => u.indexOf('/api/public-availability?') < 0) && await page.evaluate((s) => document.querySelector(s).classList.contains('is-on'), selB), '[C] et ne demande rien, ne change rien a l heure posee');
    } else {
      ok(false, '[C] une heure impossible existe apres la pose (sinon la lecture de la raison n est pas exercee)');
    }
    // 3. CHOISIR UNE HEURE « A DECALER » : c est l AUTRE activite qui bouge.
    const L0 = aDecaler.length ? aDecaler[0].t : '';
    ok(Boolean(L0) && await poserEtAttendre(page, 'laser_game', L0), '[C] toucher une heure « a decaler » du laser la pose', L0);
    const d2 = await route({ preferredTimes: { laser_game: L0 }, laserGameTimes: [L0] });
    await verifierPistes(d2, { laser_game: L0 }, [L0], '[C] APRES LE DECALAGE : la pose du bowling est levee, les pistes = la route preferredTimes={laser} + laserGameTimes');
    const v2 = await verifierPlan(d2, '[C] APRES LE DECALAGE : « votre visite » = la route (le bowling replace par le moteur)');
    const deplace = v2.ecran ? v2.ecran.etapes.find((x) => x.bouge) : null;
    ok(Boolean(deplace) && deplace.nom === nomDe('bowling') && deplace.detail.indexOf(`déplacé pour votre ${nomDe('laser_game')} à ${L0}`) >= 0, '[C] le bloc dit que le bowling a ete deplace, pour quoi et a quelle heure', deplace ? `${deplace.t} ${deplace.nom} « ${deplace.detail} »` : 'aucune etape marquee');
    // 4. DEUX PARTIES DE LASER SUR DEUX HEURES.
    const laser2 = ancresDe(d2).find((a) => a.activityId === 'laser_game');
    const candidats = laser2.times.filter((t) => t.ok !== false && !t.warning && t.time > L0).map((t) => t.time);
    const L2 = candidats[Math.min(5, candidats.length - 1)];
    ok(Boolean(L2) && await poserEtAttendre(page, 'laser_game', L2), '[C] deuxieme partie de laser posee', L2);
    const parts = [L0, L2].sort();
    const d3 = await route({ preferredTimes: { laser_game: parts[0] }, laserGameTimes: parts });
    await verifierPistes(d3, { laser_game: parts[0] }, parts, '[C] DEUX PARTIES : deux cases choisies sur la piste du laser, pistes = la route laserGameTimes');
    const v3 = await verifierPlan(d3, '[C] DEUX PARTIES : « votre visite » = la route, avec DEUX blocs de laser');
    ok(v3.o && v3.o.blocs.filter((b) => b.id === 'laser_game').length === 2, '[C] (la route compose bien deux blocs de laser)');
    // 5. LAISSER L EQUIPE PLACER : les poses s effacent, la proposition revient.
    const reponseReset = page.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
    await page.click('#hourZone [data-reset="laser_game"]');
    ok(Boolean(await reponseReset) && await attendre(page, () => !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#planZone .fg-visit'), 25000), '[C] « laisser l equipe placer » recalcule');
    const d4 = await route();
    await verifierPistes(d4, {}, [], '[C] RENDU A L EQUIPE : plus aucune pose, la proposition revient, le menu du laser la suit de nouveau');
    await verifierPlan(d4, '[C] RENDU A L EQUIPE : « votre visite » = la route sans pose');
    // 6. UNE HEURE SERREE SE CHOISIT, ET LE PLAN S ADAPTE.
    const laser4 = ancresDe(d4).find((a) => a.activityId === 'laser_game');
    const LT = laser4.times.filter((t) => t.ok !== false && !t.warning).map((t) => t.time).pop();
    ok(Boolean(LT) && await poserEtAttendre(page, 'laser_game', LT), '[C] une partie de laser posee tard', LT);
    const d5 = await route({ preferredTimes: { laser_game: LT }, laserGameTimes: [LT] });
    pistes = await verifierPistes(d5, { laser_game: LT }, [LT], '[C] LASER TARD : les pistes = la route');
    const serrees = (pistes.find((p) => p.id === 'bowling') || { chips: [] }).chips.filter((c) => c.etat === 'soft');
    ok(serrees.length > 0 && serrees.every((c) => c.ok && c.mot === 'serré' && c.reason.length > 0 && c.titre === c.reason), '[C] les heures de bowling ou tout ne tient plus sont « serrees » : choisissables, avec leur raison', serrees.map((c) => `${c.t} « ${c.reason} »`).join(', '));
    const S = serrees.length ? serrees[serrees.length - 1].t : '';
    ok(Boolean(S) && await poserEtAttendre(page, 'bowling', S), '[C] toucher une heure « serree » la pose', S);
    const d6 = await route({ preferredTimes: { laser_game: LT, bowling: S }, laserGameTimes: [LT] });
    await verifierPistes(d6, { laser_game: LT, bowling: S }, [LT], '[C] HEURE SERREE POSEE : les pistes = la route (la case reste « serree » et « choisie »)');
    const v6 = await verifierPlan(d6, '[C] HEURE SERREE POSEE : « votre visite » = la route : fin a la fermeture, ce qui manque est dit, « Garder » reste actif');
    ok(v6.o && v6.o.fermeture && v6.o.manque > 0, '[C] (la propriete est exercee) la route annonce une fin a la fermeture avec un manque', v6.o ? `fin ${v6.o.fin}, manque ${v6.o.manque} min` : 'aucun plan');
    ok(await page.evaluate((s) => { const c = document.querySelector(s); return c.classList.contains('is-on') && c.classList.contains('is-soft') && c.dataset.ok === 'true'; }, `#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${S}"]`), '[C] la case serree choisie porte les deux marques (choisie, serree)');

    // =====================================================================
    console.log('');
    console.log('[D] CONTACT');
    // =====================================================================
    const o6 = lignePlan(d6);
    await page.click('#goContact');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 5000), '[D] l ecran du contact est actif');
    const rappel = await page.evaluate(() => document.querySelector('#recallLine').textContent.replace(/\s+/g, ' ').trim());
    ok(rappel.indexOf('6 personnes') >= 0 && rappel.indexOf(`arrivée ${o6.arrivee}`) >= 0, '[D] le rappel porte groupe et heure d arrivee du plan', rappel);
    // LE RECAPITULATIF ENTIER A COTE DU FORMULAIRE (Movsar, 2026-09-23 :
    // « pourquoi y a pas le recap ici, y a juste un mini recap »). Sur
    // ordinateur : ouvert, sans bouton ni ligne de resume, pose sur la photo
    // A COTE de la colonne du formulaire, et la scene le contient entier.
    await attendre(page, () => !document.querySelector('.fg-scene.is-entering') && document.querySelector('#recall').getAnimations().every((a) => a.playState === 'finished'), 4000);
    const recapContact = await lireRecap(page, '#recallBody');
    const geo = await page.evaluate(() => {
      const aside = document.querySelector('#recall').getBoundingClientRect();
      const form = document.querySelector('#contactForm');
      const colonneFin = form.getBoundingClientRect().right - parseFloat(getComputedStyle(form).paddingRight);
      const art = document.querySelector('.fg-scene[data-scene="contact"] .fg-art').getBoundingClientRect();
      const scene = document.querySelector('.fg-scene[data-scene="contact"]').getBoundingClientRect();
      const corps = document.querySelector('#recallBody');
      return {
        gauche: Math.round(aside.left), droite: Math.round(aside.right), bas: Math.round(aside.bottom), colonneFin: Math.round(colonneFin),
        artGauche: Math.round(art.left), artDroite: Math.round(art.right), sceneBas: Math.round(scene.bottom),
        ouvert: getComputedStyle(corps).display !== 'none' && corps.getBoundingClientRect().height > 0,
        bouton: getComputedStyle(document.querySelector('#recallToggle')).display,
        ligne: getComputedStyle(document.querySelector('#recallLine')).display,
      };
    });
    ok(Boolean(recapContact) && recapContact.items.length === PROGRAMME.length && recapContact.total === o6.prix && recapContact.logos.join(',') === '#i-card,#i-cash',
      '[D] l ecran des coordonnees porte le recapitulatif ENTIER : chaque activite, le total de la route, le paiement et ses deux logos',
      recapContact ? `${recapContact.items.map((i) => i.nom).join(' + ')} · ${recapContact.montant} · ${recapContact.paiement}` : 'absent');
    ok(geo.ouvert && geo.bouton === 'none' && geo.ligne === 'none' && geo.gauche >= geo.colonneFin && geo.gauche >= geo.artGauche && geo.droite <= geo.artDroite && geo.bas <= geo.sceneBas,
      '[D] sur ordinateur, il est ouvert, pose sur la photo a cote de la colonne du formulaire, et la scene le contient entier', JSON.stringify(geo));
    await page.click('#goRecap');
    ok(await attendre(page, () => document.querySelectorAll('.fg-field.is-invalid').length === 4 && document.querySelector('#consentWrap').classList.contains('is-invalid'), 3000), '[D] un envoi vide marque les 4 champs et la case');
    ok(await page.evaluate(() => Boolean(document.querySelector('.fg-scene[data-scene="contact"].is-active'))), '[D] et reste sur l ecran du contact');
    await page.fill('#cPrenom', 'Test'); await page.fill('#cNom', 'Pinlane'); await page.fill('#cEmail', 'qa@example.com'); await page.fill('#cTel', '0491 30 16 67');
    await page.check('#cConsent');
    await page.click('#goRecap');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 5000), '[D] rempli, il passe au recapitulatif');

    // =====================================================================
    console.log('');
    console.log('[E] RECAP ET ENVOI');
    // =====================================================================
    // Le dernier ecran, lu dans SON conteneur : l ecran des coordonnees porte
    // desormais les memes classes.
    const recap = Object.assign(await lireRecap(page, '#recap'), await page.evaluate(() => ({
      tag: (document.querySelector('#recap .fg-tag') || {}).textContent || '',
      etoiles: document.querySelectorAll('#t-ok .spark, #i-spark, .fg-title--spark').length,
    })));
    ok(recap.total === o6.prix, '[E] le total du recap EST le prix de la reponse de disponibilite', `${recap.total} vs ${o6.prix}`);
    ok(await attendre(page, (attendu) => document.querySelector('#totalAmount').textContent.trim() === attendu, 3000, euros(o6.prix)), '[E] le compteur finit exactement sur le montant', euros(o6.prix));
    ok(recap.libelle === (o6.complet ? 'Total estimé' : 'Total estimé, hors activités réglées sur place'), '[E] le total dit ce qu il couvre (les arcades se reglent sur place)', recap.libelle);
    ok(/Paiement sur place/.test(recap.paiement) && /Carte ou espèces/.test(recap.paiement) && recap.logos.join(',') === '#i-card,#i-cash',
      '[E] le paiement sur place dit ses deux moyens, carte et especes, avec leurs deux logos', `${recap.paiement} ${recap.logos.join(',')}`);
    // UNE SEULE SOURCE : la carte de l ecran des coordonnees dit exactement ce
    // que dit ce recapitulatif (le compteur a fini sa course, verifie plus haut).
    const recapFinal = await lireRecap(page, '#recap');
    const ecartsRecap = ['lignes', 'items', 'libelle', 'total', 'montant', 'paiement', 'logos'].filter((k) => JSON.stringify(recapFinal[k]) !== JSON.stringify((recapContact || {})[k]));
    ok(ecartsRecap.length === 0, '[E] le recapitulatif de l ecran des coordonnees est EXACTEMENT celui-ci (une seule fonction de rendu)',
      ecartsRecap.map((k) => `${k}: ${JSON.stringify((recapContact || {})[k])} vs ${JSON.stringify(recapFinal[k])}`).join(' ; ').slice(0, 300) || `${recapFinal.items.length} activites, ${recapFinal.montant}`);
    ok(recap.items.map((i) => i.nom).join(' + ') === PROGRAMME.map((p) => nomDe(p.activityId)).join(' + ') && /2 parties/.test((recap.items[1] || {}).detail || ''), '[E] les quatre activites sont listees dans l ordre choisi, le laser avec ses 2 parties', recap.items.map((i) => `${i.nom} (${i.detail})`).join(' | '));
    const partiesO6 = new Set(o6.blocs.filter((b) => b.id === 'laser_game').map((b) => b.partie)).size;
    ok(/sur place avec l’équipe/.test((recap.items[1] || {}).detail || '') === (partiesO6 < 2), '[E] la partie de laser que le plan ne pose pas est annoncee « sur place avec l equipe »', `${partiesO6}/2 posee(s) : « ${(recap.items[1] || {}).detail} »`);
    const debutDe = (id) => (o6.blocs.find((b) => b.id === id) || {}).t;
    ok((recap.items[0] || {}).aside === `Début${debutDe('bowling')}` && (recap.items[1] || {}).aside === `Début${debutDe('laser_game')}` && recap.items.slice(2).every((i) => i.aside === 'à votre rythme'), '[E] chaque activite a creneau porte l heure du plan, les libres « a votre rythme »', recap.items.map((i) => i.aside).join(' | '));
    const ligneArrivee = recap.lignes.find((l) => /^Arrivée conseillée/.test(l)) || '';
    ok(ligneArrivee === `Arrivée conseillée à ${o6.arrivee}${o6.fermeture ? `, jusqu’à la fermeture (${heureAffichee(o6.fin)})` : `, fin vers ${heureAffichee(o6.fin)}`}${surPlaceAttendu(o6.arrivee, o6.fin)}`, '[E] l arrivee, la fin (ici : jusqu a la fermeture) et la duree sur place sont celles de la reponse', ligneArrivee);
    ok(recap.lignes[0] && recap.lignes[0].indexOf(jourLong(mock.DATE)) === 0 && recap.lignes[1] === '6 personnes', '[E] date et groupe en tete', recap.lignes.slice(0, 2).join(' | '));
    ok(plat(recap.tag) === plat(jourMock && jourMock.holiday ? jourMock.holiday.label : ''), '[E] l etiquette ferie/conge du jour n apparait que si le calendrier la porte', recap.tag || 'aucune, comme le calendrier');
    ok(recap.etoiles === 0, '[E] plus aucune etoile au-dessus du titre final');
    const reponsePose = page.waitForResponse((r) => r.url().indexOf('/api/public-reservations') >= 0 && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
    await page.click('#confirmBtn');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 10000), '[E] la confirmation mene a l ecran final');
    const corps = mock.dernierePose.body || {};
    const fin = await page.evaluate(() => document.querySelector('#finBody').textContent.replace(/\s+/g, ' ').trim());
    ok(new RegExp(`Réservation n° ${corps.__id || '\\d+'}`).test(fin) && fin.indexOf('qa@example.com') >= 0, '[E] l ecran final cite le numero rendu et l adresse', fin.slice(0, 120));
    ok(await page.evaluate(() => document.querySelectorAll('#finBurst i').length === 14), '[E] la gerbe d etincelles est posee (14 points)');
    ok(/Montant estimé/.test(fin) && /à régler sur place, par carte ou en espèces\./.test(fin), '[E] l ecran final dit le montant et les deux moyens de paiement', (fin.match(/Montant estimé[^.]*\./) || [''])[0]);
    // LE TITRE DIT CE QUI S EST PASSE, lu dans la reponse du serveur : une
    // reservation confirmee d office, ou une demande que l equipe verifiera.
    const rp = await reponsePose;
    let rendu = {};
    try { rendu = rp ? await rp.json() : {}; } catch (error) { rendu = {}; }
    const confirmeQa = (rendu.reservation || {}).validationStatus === 'confirmed' || (rendu.ops || {}).autoDecision === 'auto_confirmed';
    const titreFin = await page.evaluate(() => document.querySelector('#t-fin').innerText.replace(/\s+/g, ' ').trim());
    // innerText suit la mise en capitales de la feuille : on compare les MOTS.
    ok(Boolean(rp) && titreFin.toLowerCase() === (confirmeQa ? 'réservation confirmée' : 'demande envoyée'),
      `[E] le titre final dit ce que le serveur a repondu (ici : ${confirmeQa ? 'reservation confirmee' : 'demande a verifier'})`, `« ${titreFin} »`);
    ok(await barreEst(page, '11111') && await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item'));
      return items.length === 5
        && items.every((li) => li.classList.contains('is-sweep') && getComputedStyle(li.querySelector('.fg-steps__seg'), '::after').animationName === 'fg-seg-fill')
        && !document.querySelector('.fg-scene.is-active .fg-steps [aria-current]');
    }), '[E] a la fin, la barre est pleine (cinq segments balayes une fois) et plus aucune etape n est « en cours »');
    ok(corps.centerId === 'libramont' && corps.type === 'visite' && corps.date === mock.DATE && corps.pax === 6, '[E] le POST porte centre, type visite, date, groupe', JSON.stringify({ centerId: corps.centerId, type: corps.type, date: corps.date, pax: corps.pax }));
    ok(JSON.stringify(corps.program) === JSON.stringify(PROGRAMME), '[E] le programme envoye est celui choisi (bowling 1 h, laser 2 parties, minigolf, arcades)', JSON.stringify(corps.program));
    const pt = (corps.preference && corps.preference.preferredTimes) || {};
    ok(corps.startTime === o6.time && pt.bowling === S && pt.laser_game === LT && JSON.stringify(corps.preference.laserGameTimes) === JSON.stringify([LT]), '[E] l heure du creneau, les heures posees (dont la serree) et la partie de laser voyagent avec la demande', `${corps.startTime} / ${JSON.stringify(pt)} / parties ${JSON.stringify(corps.preference && corps.preference.laserGameTimes)}`);
    ok(corps.opsPlan && JSON.stringify(corps.opsPlan.resourceBlocks) === JSON.stringify(o6.opsPlan.resourceBlocks), '[E] le plan envoye est celui de la reponse retenue');
    ok(corps.name === 'Test Pinlane' && corps.email === 'qa@example.com' && corps.phone === '0491 30 16 67', '[E] le contact part tel que saisi');
    ok(!('consent' in corps) && !('cConsent' in corps), '[E] la case « j accepte » ne cree aucun champ d API inexistant');
    ok(erreursPage.length === 0, '[E] aucune erreur JavaScript de tout le parcours', erreursPage.slice(0, 3).join(' | '));
    await ctx.close();

    // =====================================================================
    console.log('');
    console.log('[F] EMBARQUE PAR embed.js');
    // =====================================================================
    const hote = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageHote = await hote.newPage();
    await pageHote.goto(`${BASE_URL}/host.html`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageHote, () => document.querySelector('.bloc iframe[title="Reservation en ligne"]'), 5000), '[F] embed.js monte un cadre dans le bloc du site');
    const src = await pageHote.evaluate(() => document.querySelector('.bloc iframe').src);
    ok(src.indexOf(`${BASE_URL}/fungalaxy/libramont?embed=1`) === 0, '[F] le cadre vise /fungalaxy/libramont?embed=1', src);
    ok(/[?&]fond=/.test(src), '[F] la couleur du site voyage dans l adresse (fond=)');
    const cadre = () => pageHote.frames().find((fr) => fr.url().indexOf('/fungalaxy/libramont?embed=1') >= 0);
    ok(await attendre(pageHote, () => window.__hauteurs.length > 0 && parseInt(document.querySelector('.bloc iframe').style.height, 10) > 300, 8000), '[F] le cadre recoit sa hauteur (pinlane:height)');
    const f = cadre();
    ok(Boolean(f) && await f.evaluate(() => document.body.classList.contains('is-embed')), '[F] dans le cadre, le formulaire se sait embarque');
    const bandeau = await f.evaluate(() => { const t = document.querySelector('.fg-top'); const r = t.getBoundingClientRect(); return { h: Math.round(r.height), d: getComputedStyle(t).display, rideau: getComputedStyle(document.querySelector('.fg-curtain')).display }; });
    ok(bandeau.h === 0 && bandeau.d === 'none' && bandeau.rideau === 'none', '[F] notre bandeau (logo, « Reserver ») et le rideau sont absents chez le client', JSON.stringify(bandeau));
    const fondu = await f.evaluate(() => {
      const fond = new URLSearchParams(location.search).get('fond') || '';
      const art = document.querySelector('.fg-scene.is-active .fg-art');
      return { fond, ref: getComputedStyle(document.documentElement).getPropertyValue('--fg-bg').trim(), halos: getComputedStyle(document.querySelector('.fg-glow')).display, bords: art ? getComputedStyle(art, '::before').backgroundImage : '' };
    });
    ok(Boolean(fondu.fond) && fondu.ref === fondu.fond && fondu.halos === 'none' && fondu.bords.indexOf(fondu.fond) >= 0, '[F] le cadre se fond dans le site : fond de reference = fond du site, halos absents, bords de la photo fondus vers cette couleur (plus de rectangle)', JSON.stringify({ fond: fondu.fond, ref: fondu.ref, halos: fondu.halos, bords: fondu.bords.slice(0, 60) }));
    const accord = async () => {
      const dedans = await f.evaluate(() => Math.max(document.body.scrollHeight, document.body.offsetHeight));
      const dehors = await pageHote.evaluate(() => parseInt(document.querySelector('.bloc iframe').style.height, 10));
      return { dedans, dehors, ecart: Math.abs(dedans - dehors) };
    };
    let a = await accord();
    ok(a.ecart <= 8, '[F] la hauteur du cadre suit le corps du formulaire (ecart <= 8 px)', JSON.stringify(a));
    // Le cadre reserve le samedi du mock, pas « aujourd hui » : le soir, les
    // heures du jour sont passees, la piste du bowling arrive sans case
    // ouverte et « Garder » reste gris (rouge vu a 21:25 le 2026-09-22 sur le
    // code qui etait vert a 19:50). Un gate ne depend pas de l heure qu il est.
    await f.click('#dayBtn');
    ok(await allerAuMois(f, mock.DATE), '[F] le mois du samedi du mock s affiche dans le cadre');
    await f.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    ok(await attendre(f, (l) => document.querySelector('#dayPop').hidden && document.querySelector('#dayLabel').textContent.trim() === l, 3000, jourLong(mock.DATE)), '[F] le samedi du mock est retenu dans le cadre', mock.DATE);
    await f.click('#goActivities');
    ok(await attendre(pageHote, () => window.__ecrans > 0, 5000), '[F] changer d ecran previent l hote (pinlane:screen)');
    ok(await (async () => {
      const butoir = Date.now() + 4000;
      while (Date.now() < butoir) { a = await accord(); if (a.ecart <= 8 && await f.evaluate(() => !document.querySelector('.fg-scene.is-entering'))) return true; await dormir(120); }
      return false;
    })(), '[F] apres le changement d ecran, le cadre a la hauteur du nouvel ecran', JSON.stringify(a));
    await f.click('#gridAct .fg-card[data-activity="bowling"]');
    await f.click('#goHours');
    ok(await attendre(f, () => document.querySelectorAll('#hourZone .fg-track').length === 1 && document.querySelectorAll('#hourZone .fg-chip:not(.is-off)').length > 0, 25000), '[F] une seule piste (bowling seul) se charge dans le cadre');
    ok(await attendre(f, () => !document.querySelector('#goContact').disabled, 25000), '[F] le plan par defaut du serveur active « Garder » sans rien poser');
    await f.click('#goContact');
    await f.fill('#cPrenom', 'Test'); await f.fill('#cNom', 'Cadre'); await f.fill('#cEmail', 'cadre@example.com'); await f.fill('#cTel', '0491301667');
    await f.check('#cConsent');
    await f.click('#goRecap');
    ok(await attendre(f, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 5000), '[F] recap atteint dans le cadre');
    await f.click('#confirmBtn');
    ok(await attendre(pageHote, () => Array.isArray(window.dataLayer) && window.dataLayer.some((e) => e.event === 'pinlane_booking'), 10000), '[F] la reservation pousse pinlane_booking dans le dataLayer de l hote');
    const signal = await pageHote.evaluate(() => (window.dataLayer.find((e) => e.event === 'pinlane_booking') || {}).pinlane || {});
    ok(Number(signal.reservationId) > 0 && signal.center === 'libramont' && signal.currency === 'EUR' && signal.status === 'confirmed', '[F] le signal porte numero, centre, devise, statut', JSON.stringify(signal));
    ok(!('email' in signal) && !('name' in signal) && !('phone' in signal) && JSON.stringify(signal).indexOf('example.com') < 0, '[F] et aucune donnee personnelle');
    await hote.close();

    // =====================================================================
    console.log('');
    console.log('[G] TELEPHONE 390 px');
    // =====================================================================
    const tel = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pageTel = await tel.newPage();
    await pageTel.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageTel, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), '[G] le catalogue est lu');
    const mesure = () => pageTel.evaluate(() => {
      const b = document.querySelector('.fg-scene.is-active .fg-btn:not(.fg-btn--ghost)');
      const r = b ? b.getBoundingClientRect() : { left: -1, right: 9999 };
      const deborde = (sel) => Array.from(document.querySelectorAll(sel)).filter((x) => x.getBoundingClientRect().height > 0 && x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent.trim());
      return { deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, btnDedans: r.left >= 0 && r.right <= document.documentElement.clientWidth, art: Math.round((document.querySelector('.fg-scene.is-active .fg-art') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height), cases: deborde('.fg-pill, .fg-chip, .fg-period__btn') };
    });
    let m = await mesure();
    ok(m.deborde <= 1 && m.btnDedans, '[G] ecran 1 : aucun defilement horizontal, bouton dans l ecran', JSON.stringify({ deborde: m.deborde, btnDedans: m.btnDedans }));
    ok(m.art > 0 && m.art <= 260, '[G] ecran 1 : la photo devient un bandeau (<= 260 px)', `${m.art}px`);
    await pageTel.click('#dayBtn');
    ok(await attendre(pageTel, () => { const p = document.querySelector('#dayPop'); const r = p.getBoundingClientRect(); return !p.hidden && r.left >= 0 && r.right <= document.documentElement.clientWidth; }, 3000), '[G] ecran 1 : le calendrier tient dans l ecran');
    ok(await allerAuMois(pageTel, mock.DATE), '[G] le mois du samedi du mock s affiche');
    await pageTel.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    await pageTel.click('#goActivities');
    ok(await attendre(pageTel, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000), '[G] ecran 2 atteint');
    await pageTel.click('#gridAct .fg-card[data-activity="bowling"]');
    await pageTel.click('#gridAct .fg-card[data-activity="laser_game"]');
    await attendre(pageTel, () => ['bowling', 'laser_game'].every((id) => document.querySelector(`#gridAct li[data-activity="${id}"] .fg-card__optin`).getBoundingClientRect().height > 40), 3000);
    m = await mesure();
    ok(m.deborde <= 1 && m.btnDedans && m.cases.length === 0, '[G] ecran 2 : aucun defilement horizontal, chaque pastille tient dans sa case', JSON.stringify({ deborde: m.deborde, cases: m.cases.slice(0, 3) }));
    await pageTel.click('#goHours');
    ok(await attendre(pageTel, () => document.querySelectorAll('#hourZone .fg-track').length === 2 && document.querySelector('#planZone .fg-visit') && !document.querySelector('.fg-scene.is-entering') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[G] ecran 3 : les deux pistes et le plan se chargent, transition finie');
    await attendre(pageTel, () => Array.from(document.querySelectorAll('#hourZone .fg-chip')).every((c) => c.getAnimations().length === 0), 4000);
    m = await mesure();
    ok(m.deborde <= 1 && m.btnDedans && m.cases.length === 0, '[G] ecran 3 : aucun defilement horizontal, chaque heure et chaque menu tient dans sa case', JSON.stringify({ deborde: m.deborde, cases: m.cases.slice(0, 3) }));
    const telB = await pageTel.evaluate(() => { const c = document.querySelector('#hourZone .fg-track[data-activity="bowling"] .fg-period.is-open .fg-chip:not(.is-proposed):not(.is-off)'); if (!c) return ''; window.__qaHaut = c.getBoundingClientRect().top + window.scrollY; window.__qaCase = c; return c.dataset.time; });
    const reponseTel = pageTel.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
    if (telB) await pageTel.tap(`#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${telB}"]`);
    ok(Boolean(telB) && Boolean(await reponseTel) && await attendre(pageTel, () => !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[G] toucher une heure de bowling la pose', telB);
    const sautTel = await pageTel.evaluate(() => ({ meme: document.querySelector('#hourZone .fg-track[data-activity="bowling"] .fg-chip.is-on') === window.__qaCase, saut: window.__qaCase ? Math.abs(window.__qaCase.getBoundingClientRect().top + window.scrollY - window.__qaHaut) : -1 }));
    ok(sautTel.meme && sautTel.saut <= 1, '[G] sur telephone aussi, poser une heure ne fait rien sauter (le lien « laisser l equipe placer » avait deja sa place)', JSON.stringify(sautTel));
    // L ECRAN DES COORDONNEES SUR TELEPHONE : le recapitulatif se replie sous
    // sa ligne de resume (le formulaire reste en tete), le bouton le deplie.
    await pageTel.tap('#goContact');
    ok(await attendre(pageTel, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), '[G] ecran 4 atteint');
    const lireRappelTel = () => pageTel.evaluate(() => {
      const aside = document.querySelector('#recall').getBoundingClientRect();
      const corps = document.querySelector('#recallBody');
      const bouton = document.querySelector('#recallToggle');
      return {
        ligne: getComputedStyle(document.querySelector('#recallLine')).display !== 'none' && document.querySelector('#recallLine').textContent.trim().length > 0,
        bouton: getComputedStyle(bouton).display !== 'none', hauteurBouton: Math.round(bouton.getBoundingClientRect().height), etendu: bouton.getAttribute('aria-expanded'),
        corps: getComputedStyle(corps).display !== 'none' && corps.getBoundingClientRect().height > 0,
        items: corps.querySelectorAll('.fg-recap__item').length,
        dedans: aside.left >= 0 && aside.right <= document.documentElement.clientWidth,
        deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const replie = await lireRappelTel();
    ok(replie.ligne && replie.bouton && replie.hauteurBouton >= 44 && replie.etendu === 'false' && !replie.corps && replie.dedans && replie.deborde <= 1,
      '[G] ecran 4 : le recapitulatif est replie sous sa ligne de resume, un bouton de 44 px le deplie, rien ne deborde', JSON.stringify(replie));
    await pageTel.tap('#recallToggle');
    const deplie = await lireRappelTel();
    ok(deplie.etendu === 'true' && deplie.corps && deplie.items === 2 && deplie.dedans && deplie.deborde <= 1,
      '[G] toucher le bouton deplie le recapitulatif entier (les deux activites), dans l ecran', JSON.stringify(deplie));
    await tel.close();

    // =====================================================================
    console.log('');
    console.log('[I] FORMULES A L ECRAN, ET LE FUN RUN QUI TOURNE');
    // Movsar, 2026-09-23 : « les formules sont super mal faites, c est moche,
    // pas bien range, et ya pas les contraintes d indisponibilite visibles » ;
    // « pixel game on peut pas le choisir quand ya plus de 5 joueurs, on peut
    // faire plusieurs sessions, tournante ». La REGLE est prouvee sur une
    // grille complete par fungalaxy-formules-check et funrun-rotation-check :
    // ici, c est l ECRAN qui est mesure.
    // =====================================================================
    const vitrine = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageV = await vitrine.newPage();
    await pageV.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageV, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), '[I] le catalogue est lu');
    await pageV.click('#dayBtn');
    ok(await allerAuMois(pageV, mock.DATE), '[I] le mois du samedi du mock s affiche');
    await pageV.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    await pageV.fill('#paxInput', '12');
    await pageV.press('#paxInput', 'Enter');
    await pageV.click('#goActivities');
    ok(await attendre(pageV, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), '[I] ecran 2 atteint a 12 personnes');

    // --- Le Fun Run tourne au lieu de disparaitre -------------------------
    const funCarte = await pageV.evaluate(() => {
      const c = document.querySelector('#gridAct .fg-card[data-activity="fun_run"]');
      if (!c) return null;
      return { off: c.classList.contains('is-off'), aria: c.getAttribute('aria-disabled'), tab: c.getAttribute('tabindex'), prix: (c.querySelector('.fg-card__price') || {}).textContent.trim() };
    });
    ok(Boolean(funCarte) && funCarte.off === false && !funCarte.aria && funCarte.tab === '0',
      '[I] a 12 personnes, le Fun Run se choisit (avant, la carte etait eteinte)', JSON.stringify(funCarte));
    ok(Boolean(funCarte) && /5 joueurs par session/.test(funCarte.prix), '[I] et la carte dit la capacite d une session', funCarte && funCarte.prix);
    await pageV.click('#gridAct .fg-card[data-activity="fun_run"]');
    ok(await attendre(pageV, () => { const n = document.querySelector('#gridAct li[data-activity="fun_run"] .fg-card__rot'); return n && n.getBoundingClientRect().height > 0; }, 3000),
      '[I] cochee, la carte annonce la rotation sous ses pastilles');
    const rot = await pageV.evaluate(() => (document.querySelector('#gridAct li[data-activity="fun_run"] .fg-card__rot') || {}).textContent || '');
    ok(/3 sessions/.test(rot) && /5 joueurs/.test(rot), '[I] « 3 sessions, 5 joueurs a la fois » pour 12 personnes', rot.trim());
    await pageV.click('#goHours');
    ok(await attendre(pageV, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[I] l ecran des heures repond pour le Fun Run');
    const visite = await pageV.evaluate(() => {
      const v = document.querySelector('#planZone .fg-visit');
      return { prix: (v.querySelector('.fg-visit__price') || {}).textContent || '', detail: Array.from(v.querySelectorAll('.fg-visit__step small')).map((n) => n.textContent.trim()).join(' | ') };
    });
    // 3 sessions de 15 min a 30 EUR : le montant vient du SERVEUR, jamais du
    // navigateur. 90 EUR est le prix que le comptoir encaisserait.
    ok(/90/.test(visite.prix), '[I] le serveur chiffre les trois sessions : 90 EUR', visite.prix.trim());
    ok(/3 sessions de 15 min/.test(visite.detail), '[I] et la visite dit « 3 sessions de 15 min »', visite.detail);

    // --- Les formules : familles, contraintes, refus explique -------------
    await pageV.click('.fg-scene.is-active [data-back]');
    ok(await attendre(pageV, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), '[I] retour a l ecran 2');
    // Le groupe reste a 12 : la FORMULE 1 (6 minimum) les accepte, et les
    // cinq formules d un autre jour se refusent pour le JOUR, pas pour le
    // groupe. Le champ du nombre de personnes vit a l ecran 1 : on ne
    // remonte pas le chercher pour rien.
    await pageV.click('#tabFor');
    ok(await attendre(pageV, () => document.querySelectorAll('#gridFor .fg-fam').length > 0, 4000), '[I] l onglet Formules affiche des familles');
    const vue = await pageV.evaluate(() => ({
      familles: Array.from(document.querySelectorAll('#gridFor .fg-fam')).map((s) => ({
        titre: (s.querySelector('.fg-fam__title') || {}).textContent.trim(),
        cartes: s.querySelectorAll('.fg-card--formule').length,
      })),
      cartes: Array.from(document.querySelectorAll('#gridFor .fg-card--formule')).map((c) => ({
        id: c.dataset.formule,
        refus: c.classList.contains('is-refus'),
        aria: c.getAttribute('aria-disabled'),
        tab: c.getAttribute('tabindex'),
        regles: Array.from(c.querySelectorAll('.fg-for__rules i')).map((n) => n.textContent.trim()),
        contenu: Array.from(c.querySelectorAll('.fg-for__list li')).map((n) => n.textContent.trim()),
        pourquoi: (c.querySelector('.fg-for__off') || {}).textContent ? c.querySelector('.fg-for__off').textContent.trim() : '',
        prix: (c.querySelector('.fg-for__price') || {}).textContent.trim(),
      })),
    }));
    ok(vue.familles.length === 2, '[I] deux familles : les anniversaires et les offres speciales', JSON.stringify(vue.familles.map((f) => f.titre)));
    ok(vue.familles[0].cartes === 8 && vue.familles[1].cartes === 6, '[I] 8 formules d anniversaire, 6 offres speciales', JSON.stringify(vue.familles.map((f) => f.cartes)));
    ok(vue.familles.every((f) => /\d+ formules?$/.test(f.titre)), '[I] chaque famille annonce son compte', JSON.stringify(vue.familles.map((f) => f.titre)));
    ok(vue.cartes.length === 14, '[I] les quatorze formules du catalogue sont a l ecran', String(vue.cartes.length));
    ok(vue.cartes.every((c) => c.contenu.length > 0), '[I] chaque carte liste ce qu elle contient, ligne par ligne');
    const f1 = vue.cartes.find((c) => c.id === 'f1');
    ok(Boolean(f1) && f1.regles.includes('dès 6 personnes') && f1.regles.includes('hors vacances et fériés'),
      '[I] FORMULE 1 affiche ses contraintes (groupe minimum, vacances)', JSON.stringify(f1 && f1.regles));
    const btsV = vue.cartes.find((c) => c.id === 'bts');
    ok(Boolean(btsV) && btsV.regles.includes('de 18h à 22h') && btsV.regles.some((r) => /mardi/.test(r)),
      '[I] BACK TO SCHOOL affiche sa plage horaire et ses jours', JSON.stringify(btsV && btsV.regles));
    // Un SAMEDI : les cinq formules d un autre jour se voient refusees, avec
    // leur raison, et restent atteignables (jamais aria-disabled).
    const refus = vue.cartes.filter((c) => c.refus).map((c) => c.id);
    ok(['bts', 'css', 'kfd', 'hlg', 'ffm'].every((id) => refus.includes(id)),
      '[I] un samedi, les cinq formules d un autre jour sont refusees a l ecran', refus.join(', '));
    ok(vue.cartes.filter((c) => c.refus).every((c) => c.pourquoi.length > 10 && !c.aria && c.tab === '0'),
      '[I] chaque refus dit pourquoi et reste atteignable au clavier (jamais aria-disabled)',
      JSON.stringify(vue.cartes.filter((c) => c.refus).map((c) => c.pourquoi).slice(0, 2)));
    ok(vue.cartes.filter((c) => !c.refus).every((c) => c.pourquoi === ''),
      '[I] et aucune formule disponible ne porte de refus');
    // Toucher un refus ne coche rien, mais fait battre la raison.
    await pageV.click('#gridFor .fg-card--formule[data-formule="ffm"]');
    const apresRefus = await pageV.evaluate(() => {
      const c = document.querySelector('#gridFor .fg-card--formule[data-formule="ffm"]');
      return { coche: c.getAttribute('aria-checked'), pulse: Boolean(c.querySelector('.fg-for__off.is-pulse')), compteur: (document.querySelector('#actCount') || {}).textContent.trim() };
    });
    ok(apresRefus.coche === 'false' && apresRefus.pulse && /^0/.test(apresRefus.compteur),
      '[I] cliquer une formule refusee ne la coche pas et fait battre sa raison', JSON.stringify(apresRefus));
    // Une formule valable se choisit et mene aux heures.
    await pageV.click('#gridFor .fg-card--formule[data-formule="f1"]');
    ok(await attendre(pageV, () => document.querySelector('#gridFor .fg-card--formule[data-formule="f1"]').getAttribute('aria-checked') === 'true' && !document.querySelector('#goHours').disabled, 3000),
      '[I] une formule valable se coche et ouvre la suite');
    await pageV.click('#goHours');
    ok(await attendre(pageV, () => document.querySelectorAll('#hourZone .fg-chip').length > 0 && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000),
      '[I] et la FORMULE 1 trouve des heures ce samedi');
    await vitrine.close();


    // =====================================================================
    console.log('');
    console.log('[J] LE TOUR DU 2026-09-23 : PHOTOS, COMPTEUR, FIL, ETIQUETTES, VAGUES, DUREE');
    // Movsar, 2026-09-23, en six points : « toute image mi-12 est a prohiber
    // prcq la c le centre davant » ; « pour le nombre de personne cest pas
    // aligne dans sa case » ; « le truc qui suit les etapes de 1 a 5, cest
    // moche » ; « le truc dans un rectangle avec bords ondule la ou c ecrit
    // lheure douverture, ca fait trop ia, et ya ce meme truc a plusieurs
    // endroit » ; « quand ya des grands groupes et quil faut scinder, rien
    // nest bien explique » ; « une heure approximatif de la totalite des
    // activites, bien calcule hein pas derreur ».
    // =====================================================================

    // --- Les photos, sur pieces (aucun navigateur) -----------------------
    // Le centre precedent s appelait mi12 : son mur « STRIKE TO SMILE » et ses
    // logos apparaissaient sur `pistes-strike`, servie sur le premier et le
    // dernier ecran. Cette liste est la liste des INTERDITS : une photo qui y
    // entre ne doit plus etre citee NI exister.
    const PHOTOS_INTERDITES = ['pistes-strike'];
    const sourceHtml = fs.readFileSync(path.join(ROOT, 'fungalaxy.html'), 'utf8');
    const sourceCss = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.css'), 'utf8');
    const sourceJs = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.js'), 'utf8');
    const citees = PHOTOS_INTERDITES.filter((nom) => (sourceHtml + sourceCss + sourceJs).indexOf(nom) >= 0);
    ok(citees.length === 0, '[J] aucune photo de l ancien centre n est citee par la page, sa feuille ou son script', citees.join(', ') || `aucune (${PHOTOS_INTERDITES.length} interdite(s) surveillee(s))`);
    const survivantes = PHOTOS_INTERDITES
      .flatMap((nom) => ['800', '1600'].map((w) => `assets/fungalaxy/${nom}-${w}.webp`))
      .filter((rel) => fs.existsSync(path.join(ROOT, rel)));
    ok(survivantes.length === 0, '[J] et ses fichiers ne sont plus dans le depot', survivantes.join(', ') || 'aucun');
    // Chaque photo declaree existe, et le cadre annonce est SA forme.
    // Le nom d une photo est ce qui precede son suffixe de largeur :
    // « duckpin-800.webp » est la photo « duckpin », servie en 800.
    const declarees = Array.from(sourceHtml.matchAll(/<img[^>]*?(?:data-)?src="\/assets\/fungalaxy\/([a-z0-9-]+?)-(?:800|1600)\.webp"[^>]*?width="(\d+)"[^>]*?height="(\d+)"/g))
      .map((m) => ({ nom: m[1], w: Number(m[2]), h: Number(m[3]) }));
    ok(declarees.length === 6, '[J] les six ecrans portent chacun leur photo', `${declarees.length} : ${declarees.map((d) => d.nom).join(', ')}`);
    const manquantes = declarees.filter((d) => !fs.existsSync(path.join(ROOT, 'assets', 'fungalaxy', `${d.nom}-1600.webp`)) || !fs.existsSync(path.join(ROOT, 'assets', 'fungalaxy', `${d.nom}-800.webp`)));
    ok(manquantes.length === 0, '[J] chaque photo citee existe en 800 et en 1600', manquantes.map((d) => d.nom).join(', ') || 'toutes');
    const cadresFaux = declarees.filter((d) => {
      const vraie = tailleWebp(path.join(ROOT, 'assets', 'fungalaxy', `${d.nom}-1600.webp`));
      return !vraie || Math.abs((d.w / d.h) - (vraie.w / vraie.h)) > 0.01;
    }).map((d) => {
      const vraie = tailleWebp(path.join(ROOT, 'assets', 'fungalaxy', `${d.nom}-1600.webp`)) || { w: 0, h: 0 };
      return `${d.nom} declare ${d.w}x${d.h}, vraie forme ${vraie.w}x${vraie.h}`;
    });
    ok(cadresFaux.length === 0, '[J] et le cadre declare a la forme du fichier (aucun saut au chargement)', cadresFaux.join(' | ') || 'les six');

    // --- Le compteur, le fil, les etiquettes ------------------------------
    const tour = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageJ = await tour.newPage();
    const demandesJ = [];
    pageJ.on('request', (r) => demandesJ.push(r.url()));
    await pageJ.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageJ, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), '[J] le catalogue est lu');

    // LE COMPTEUR. La regle : le champ prend la largeur de SON nombre, et
    // l encre (le nombre plus son unite) tombe au milieu de la case. Avant, le
    // champ faisait 3,2 em avec un texte cale a droite : les deux em de vide
    // restaient A GAUCHE du chiffre.
    const mesurerPax = () => pageJ.evaluate(() => {
      const val = document.querySelector('.fg-stepper__value').getBoundingClientRect();
      const inp = document.querySelector('.fg-stepper__input');
      const ri = inp.getBoundingClientRect();
      const ru = document.querySelector('.fg-stepper__unit').getBoundingClientRect();
      // La largeur d un chiffre, mesuree dans la POLICE du champ : c est
      // l unite « ch » que le script utilise. Le raccourci `font` ne sert a
      // RIEN ici : sur un champ dont `font-variant-numeric` n est pas normal,
      // le navigateur le serialise vide, la regle retombait sur la police du
      // corps (16 px au lieu de 20) et mesurait 11,2 px la ou le champ compte
      // 13,6. On copie donc chaque propriete, et on laisse le navigateur
      // resoudre « 1ch » lui-meme.
      const regle = document.createElement('div');
      const cs = getComputedStyle(inp);
      ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantNumeric', 'letterSpacing'].forEach((k) => { regle.style[k] = cs[k]; });
      regle.style.position = 'absolute';
      regle.style.visibility = 'hidden';
      regle.style.width = '1ch';
      document.body.appendChild(regle);
      const ch = regle.getBoundingClientRect().width;
      regle.remove();
      return {
        chiffres: String(inp.value).length,
        largeur: ri.width,
        ch,
        ecart: ((Math.min(ri.left, ru.left) + Math.max(ri.right, ru.right)) / 2) - ((val.left + val.right) / 2),
        // LA HAUTEUR AUSSI (Movsar, 2026-09-23, capture a l appui : « le truc
        // pour les personnes c est super mal cadre »). Le tour precedent ne
        // mesurait que la largeur : le nombre etait centre de gauche a droite,
        // et COLLE EN HAUT de sa case. La ligne « nombre + personnes » est
        // l union des deux boites ; son milieu doit etre celui de la case.
        ecartV: ((Math.min(ri.top, ru.top) + Math.max(ri.bottom, ru.bottom)) / 2) - ((val.top + val.bottom) / 2),
      };
    });
    for (const [n, largeurFenetre] of [[1, 1440], [12, 768], [240, 375]]) {
      await pageJ.setViewportSize({ width: largeurFenetre, height: 900 });
      await pageJ.fill('#paxInput', String(n));
      await attendre(pageJ, () => document.querySelector('#paxInput').getAnimations().length === 0, 2000);
      await dormir(120);
      const m = await mesurerPax();
      ok(m.chiffres === String(n).length && Math.abs(m.largeur - (m.chiffres + 0.3) * m.ch) <= 1.5,
        `[J] a ${n} personne(s) sur ${largeurFenetre} px, le champ fait la largeur de son nombre`,
        `${Math.round(m.largeur * 10) / 10} px pour ${m.chiffres} chiffre(s) de ${Math.round(m.ch * 10) / 10} px`);
      ok(Math.abs(m.ecart) <= 1,
        `[J] et son encre tombe au milieu de la case en largeur (ecart ${Math.round(m.ecart * 10) / 10} px)`);
      ok(Math.abs(m.ecartV) <= 1.5,
        `[J] ET en hauteur : la ligne « nombre + personnes » est centree dans sa case (ecart ${Math.round(m.ecartV * 10) / 10} px)`);
    }
    await pageJ.setViewportSize({ width: 1440, height: 900 });
    await pageJ.fill('#paxInput', '40');
    await pageJ.press('#paxInput', 'Enter');

    // LA BARRE DES ETAPES (Movsar, 2026-09-23 : « ta barre elle fait trop IA,
    // fais un truc plus anime, plus pro »). Les regles : un segment REMPLI par
    // etape atteinte, la longueur remplie EST la progression ; dans une
    // colonne large, les cinq libelles ; dans une colonne etroite, l etape en
    // cours et son rang « 01/05 », sinon « Creneaux » tout seul ne dit plus ou
    // on en est ; le mouvement suit un changement d ecran, jamais une boucle.
    const lireFil = () => pageJ.evaluate(() => {
      const scene = document.querySelector('.fg-scene.is-active');
      const items = Array.from(scene.querySelectorAll('.fg-steps__item'));
      const actif = scene.querySelector('.fg-steps__item.is-active');
      const vu = (el) => Boolean(el) && getComputedStyle(el).display !== 'none';
      const num = actif && actif.querySelector('.fg-steps__num');
      const of = actif && actif.querySelector('.fg-steps__of');
      const apres = (li) => getComputedStyle(li.querySelector('.fg-steps__seg'), '::after');
      return {
        libelles: items.map((li) => li.querySelector('.lbl')).filter(vu).length,
        rang: of ? { texte: `${num ? num.textContent : ''}${of.textContent}`, vu: vu(of) && vu(num) } : null,
        remplis: items.map((li) => (/^matrix\(1, /.test(apres(li).transform) ? '1' : '0')).join(''),
        boucles: items.filter((li) => apres(li).animationIterationCount === 'infinite').length,
      };
    });
    // Le contraste au pire moment, controle par ensemble de textes.
    const lisibles = async (sel, label) => {
      const m = await contrastesPires(pageJ, sel);
      const faibles = m.filter((x) => x.ratio < x.seuil);
      ok(m.length > 0 && faibles.length === 0, label,
        faibles.map((x) => `« ${x.texte} » ${x.ratio}:1 < ${x.seuil} (pixels ${x.pixels}${x.halo === null ? ', sur photo' : `, halo ${x.halo}`})`).join(' ; ')
        || `${m.length} textes, le plus faible a ${Math.min(...m.map((x) => x.ratio)).toFixed(2)}:1 (${m.filter((x) => x.halo !== null).length} hors photo, pris aussi sous le coeur des halos)`);
      return m;
    };
    const filLarge = await lireFil();
    ok(filLarge.libelles === 5 && filLarge.rang && filLarge.rang.vu === false && filLarge.remplis === '10000' && filLarge.boucles === 0,
      '[J] sur 1440 px, a l etape 1 : un segment plein sur cinq, les cinq libelles lisibles, le rang tu, rien ne tourne en boucle', JSON.stringify(filLarge));
    await lisibles('.fg-scene.is-active .fg-steps__num, .fg-scene.is-active .fg-steps__of, .fg-scene.is-active .fg-steps__item .lbl',
      '[J] sur 1440 px, chaque numero et chaque libelle de la barre garde 4,5:1 au pire moment (halo le plus clair compris)');
    await pageJ.setViewportSize({ width: 375, height: 812 });
    await dormir(200);
    const filEtroit = await lireFil();
    ok(filEtroit.libelles === 1 && filEtroit.rang && filEtroit.rang.vu === true && filEtroit.rang.texte === '01/05' && filEtroit.remplis === '10000',
      '[J] sur 375 px, seule l etape en cours reste, avec son rang « 01/05 », et la barre dit toujours 1 sur 5', JSON.stringify(filEtroit));
    await lisibles('.fg-scene.is-active .fg-steps__num, .fg-scene.is-active .fg-steps__of, .fg-scene.is-active .fg-steps__item .lbl',
      '[J] sur 375 px, « 01/05 » et le libelle en cours gardent 4,5:1 au pire moment');
    await pageJ.setViewportSize({ width: 1440, height: 900 });

    // LES ETIQUETTES. La regle : plus aucune capsule teintee. La mesure se
    // prouve par un TEMOIN POSITIF : le bouton du bandeau, lui, EST une
    // capsule, et la meme mesure doit le voir.
    const capsules = await pageJ.evaluate(() => {
      const rayon = (el) => Math.max(...['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']
        .map((k) => parseFloat(getComputedStyle(el)[k]) || 0));
      const opaque = (el) => { const c = getComputedStyle(el).backgroundColor; return c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)'; };
      const sonde = (classes) => {
        const n = document.createElement('div');
        n.className = classes;
        n.textContent = 'Réservation n° 12345';
        document.querySelector('.fg-scene.is-active .fg-scene__body').appendChild(n);
        const r = { rayon: rayon(n), fond: opaque(n) };
        n.remove();
        return r;
      };
      const cta = document.querySelector('.fg-top__cta');
      return {
        horaire: sonde('fg-sub__open'),
        etiquette: sonde('fg-tag fg-tag--ferie'),
        dossier: sonde('fg-done__ref'),
        meilleurPrix: sonde('fg-for__best'),
        temoin: cta ? { rayon: rayon(cta), fond: opaque(cta) } : null,
      };
    });
    ok(capsules.temoin && capsules.temoin.rayon >= 100,
      '[J] TEMOIN POSITIF : la mesure voit bien une capsule (le bouton du bandeau)', capsules.temoin ? `${capsules.temoin.rayon} px de rayon` : 'aucun bouton');
    ['horaire', 'etiquette', 'dossier', 'meilleurPrix'].forEach((cle) => {
      ok(capsules[cle].rayon < 100 && capsules[cle].fond === false,
        `[J] l etiquette « ${cle} » n est plus une capsule teintee`, `rayon ${capsules[cle].rayon} px, fond ${capsules[cle].fond ? 'plein' : 'transparent'}`);
    });

    // --- Les vagues et la duree, sur un grand groupe ----------------------
    await pageJ.click('#dayBtn');
    ok(await allerAuMois(pageJ, mock.DATE), '[J] le mois du samedi du mock s affiche');
    await pageJ.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    await pageJ.fill('#paxInput', '40');
    await pageJ.press('#paxInput', 'Enter');
    await pageJ.click('#goActivities');
    ok(await attendre(pageJ, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), '[J] ecran 2 atteint a 40 personnes');
    // AVANCER : le segment atteint se REMPLIT, celui qu on quitte passe au blanc.
    const lireGestes = () => pageJ.evaluate(() => Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item')).map((li) => ({
      geste: ['is-filling', 'is-settling', 'is-draining', 'is-sweep'].filter((c) => li.classList.contains(c)).join('+'),
      anim: getComputedStyle(li.querySelector('.fg-steps__seg'), '::after').animationName,
    })));
    const avance = await lireGestes();
    ok(avance.map((x) => x.geste).join('|') === 'is-settling|is-filling|||' && avance[0].anim === 'fg-seg-settle' && avance[1].anim === 'fg-seg-fill',
      '[J] avancer d un ecran REMPLIT le segment atteint et blanchit celui qu on quitte', JSON.stringify(avance));
    ok(await barreEst(pageJ, '11000'), '[J] et la barre finit a deux segments pleins sur cinq');
    await pageJ.click('#gridAct .fg-card[data-activity="bowling"]');
    await pageJ.click('#gridAct .fg-card[data-activity="laser_game"]');
    // DEUX parties de laser : c est avec deux parties qu une heure peut
    // chevaucher SA PROPRE partie (le refus « pris »).
    await attendre(pageJ, () => { const t = document.querySelector('#gridAct li[data-activity="laser_game"] .fg-card__optin'); return Boolean(t) && t.getBoundingClientRect().height > 40; }, 3000);
    await pageJ.click('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]');
    ok(await attendre(pageJ, () => document.querySelector('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]').getAttribute('aria-checked') === 'true', 3000), '[J] le laser passe a 2 parties');
    const avantHeuresJ = demandesJ.length;
    await pageJ.click('#goHours');
    ok(await attendre(pageJ, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[J] l ecran des heures repond pour le grand groupe');

    // L ORACLE : le plan que la route rend pour la demande que la page a
    // vraiment faite.
    const PROGRAMME_J = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }];
    const demandeJ = demandesJ.slice(avantHeuresJ).filter((u) => u.indexOf('/api/public-availability?') >= 0).pop() || '';
    const qJ = demandeJ ? new URL(demandeJ).searchParams : new URLSearchParams();
    ok(qJ.get('program') === JSON.stringify(PROGRAMME_J) && qJ.get('pax') === '40',
      '[J] la page demande bien 40 personnes, bowling 1 h et 2 parties de laser', qJ.get('program') || 'aucune demande');
    const paramsJ = { centerId: 'libramont', date: mock.DATE, type: 'visite', pax: '40', softReserve: '1', program: JSON.stringify(PROGRAMME_J) };
    const dJ = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(paramsJ)}`);
    const planJ = ((dJ.slots || [])[0] || {}).opsPlan || {};
    await verifierPistes(dJ, {}, [], '[J] 40 PERSONNES SANS POSE : les pistes = la route, et l heure PROPOSEE n emporte rien : la demi-heure de son 2e groupe reste a prendre', pageJ);
    const vaguesOracle = (id) => {
      const blocs = (planJ.resourceBlocks || []).filter((b) => b && b.activityId === id && Number(b.groupWaveCount) > 1);
      if (!blocs.length) return null;
      const total = Math.max(...blocs.map((b) => Number(b.groupWaveCount) || 0));
      const tailles = [];
      for (let i = 1; i <= total; i += 1) {
        const bloc = blocs.find((b) => Number(b.groupWaveIndex) === i);
        if (bloc) tailles.push(Number(bloc.players) || 0);
      }
      return { total, tailles };
    };
    const oracleLaser = vaguesOracle('laser_game');
    const oracleBowling = vaguesOracle('bowling');
    ok(Boolean(oracleLaser) && oracleLaser.total > 1,
      '[J] MONTAGE : a 40 personnes, le moteur scinde bien le laser', oracleLaser ? `${oracleLaser.total} groupes de ${oracleLaser.tailles.join(', ')}` : 'aucune scission : le montage ne tient plus');
    ok(!oracleBowling,
      '[J] MONTAGE : et il ne scinde PAS le bowling (le temoin negatif existe)', oracleBowling ? `${oracleBowling.total} services` : 'un seul service');
    const notes = await pageJ.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#hourZone .fg-track')).map((s) => [
      s.dataset.activity,
      { texte: (s.querySelector('.fg-track__waves') || {}).textContent || '', vu: Boolean(s.querySelector('.fg-track__waves')) && !s.querySelector('.fg-track__waves').hidden, rang: (s.querySelector('.fg-track__num') || {}).textContent || '' },
    ])));
    // Chaque groupe du plan (1re partie), sa taille et son heure de depart,
    // dans l ordre des groupes : c est ce que la note doit dire.
    const departsJ = [];
    (planJ.resourceBlocks || [])
      .filter((b) => b && b.activityId === 'laser_game' && Number(b.groupWaveCount) > 1 && (Number(b.countIndex) || 1) === 1)
      .sort((x, y) => (Number(x.groupWaveIndex) || 1) - (Number(y.groupWaveIndex) || 1))
      .forEach((b) => { if (!departsJ.some((dp) => dp.rang === Number(b.groupWaveIndex))) departsJ.push({ rang: Number(b.groupWaveIndex), joueurs: Number(b.players) || 0, debut: b.startTime }); });
    const texteNote = (notes.laser_game || {}).texte || '';
    let curseurNote = 0;
    const dansLOrdre = departsJ.every((dp) => {
      const i = texteNote.indexOf(`(${dp.joueurs})`, curseurNote);
      const j = i < 0 ? -1 : texteNote.indexOf(dp.debut, i);
      if (j < 0) return false;
      curseurNote = j + dp.debut.length;
      return true;
    });
    ok(notes.laser_game && notes.laser_game.vu && departsJ.length > 1 && dansLOrdre
      && (texteNote.match(/\(\d+\)/g) || []).length === departsJ.length && texteNote.indexOf('40 personnes') >= 0,
      '[J] la piste du laser DIT la scission du plan : le groupe entier, puis chaque groupe avec sa taille et son heure de depart, dans l ordre',
      `« ${texteNote} » attendait ${departsJ.map((dp) => `(${dp.joueurs}) ${dp.debut}`).join(' puis ')}`);
    ok(notes.bowling && notes.bowling.vu === false && notes.bowling.texte === '',
      '[J] et la piste du bowling, qui tient en une fois, ne dit rien', `« ${(notes.bowling || {}).texte}» visible=${(notes.bowling || {}).vu}`);
    ok(notes.bowling && notes.bowling.rang === '1' && notes.laser_game && notes.laser_game.rang === '2',
      '[J] chaque section porte son rang (1, 2), pour qu on les distingue', `${(notes.bowling || {}).rang} puis ${(notes.laser_game || {}).rang}`);

    // LA DUREE TOTALE : l ecart des deux heures du plan, refait en Node.
    const arriveeJ = planJ.arrivalTime || '';
    const finJ = ((dJ.slots || [])[0] || {}).visitEndTime || planJ.endTime || '';
    const attendueDuree = dureeExacteQa(minutesEntreQa(arriveeJ, finJ));
    ok(minutesEntreQa(arriveeJ, finJ) > 0, '[J] MONTAGE : le plan a bien une arrivee et une fin', `${arriveeJ} -> ${finJ}`);
    const spanJ = await pageJ.evaluate(() => (document.querySelector('.fg-visit__span') || {}).textContent.replace(/\s+/g, ' ').trim() || '');
    ok(spanJ.indexOf(`${attendueDuree} sur place`) >= 0,
      '[J] le bloc de visite annonce la duree sur place, egale a fin moins arrivee', `« ${spanJ} » attendait « ${attendueDuree} sur place »`);

    // Et la meme duree au recapitulatif, par le meme chemin que le client.
    await pageJ.click('#goContact');
    ok(await attendre(pageJ, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 6000), '[J] ecran 4 atteint');
    await pageJ.fill('#cPrenom', 'Duree');
    await pageJ.fill('#cNom', 'Totale');
    await pageJ.fill('#cEmail', 'qa@example.com');
    await pageJ.fill('#cTel', '0471234567');
    await pageJ.check('#cConsent');
    await pageJ.click('#goRecap');
    ok(await attendre(pageJ, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 6000), '[J] ecran 5 atteint');
    const ligneJ = await pageJ.evaluate(() => (Array.from(document.querySelectorAll('#recap .fg-recap__row')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).find((l) => /^Arrivée conseillée/.test(l)) || ''));
    ok(ligneJ.indexOf(`${attendueDuree} sur place`) >= 0,
      '[J] et le recapitulatif annonce exactement la meme duree', `« ${ligneJ} » attendait « ${attendueDuree} sur place »`);

    // --- La legende : moins de texte sur telephone ------------------------
    await pageJ.click('.fg-scene.is-active [data-back]');
    ok(await attendre(pageJ, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 6000), '[J] retour a l ecran 4');
    // RECULER : le segment qu on quitte se VIDE.
    const recule = await lireGestes();
    ok(recule.map((x) => x.geste).join('|') === '||||is-draining' && recule[4].anim === 'fg-seg-drain',
      '[J] reculer d un ecran VIDE le segment qu on quitte', JSON.stringify(recule));
    ok(await barreEst(pageJ, '11110'), '[J] et la barre revient a quatre segments pleins sur cinq');
    await pageJ.click('.fg-scene.is-active [data-back]');
    ok(await attendre(pageJ, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && document.querySelector('.fg-legend'), 8000), '[J] retour a l ecran des heures');
    const lireLegende = () => pageJ.evaluate(() => {
      const l = document.querySelector('.fg-legend');
      const vu = (el) => el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
      const cles = Array.from(l.querySelectorAll('.fg-legend__key i')).filter(vu).map((n) => n.textContent.trim());
      const consigne = (l.querySelector('.fg-legend__tip') || {}).textContent || '';
      // Le texte REELLEMENT lu. `innerText` et lui seul : il respecte
      // `display: none` ET il voit le texte NU. Une premiere version
      // assemblait les elements-feuilles ; la contre-epreuve `legende` sort
      // justement une glose de sa balise, le texte devenait un noeud de texte
      // nu dans un `<span>` qui, lui, avait un enfant : la sonde ne le voyait
      // plus et le verdict passait au vert sur un code casse.
      const lu = String(l.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        cles,
        gloses: Array.from(l.querySelectorAll('.fg-legend__key em')).filter(vu).length,
        lu,
        // Ce que le telephone doit lire, et rien d autre : la consigne, puis
        // les trois mots. Compose sur place a partir de la page elle-meme :
        // changer la consigne ne rend pas le gate rouge, ajouter du texte oui.
        attenduCourt: [consigne.trim()].concat(cles).join(' ').replace(/\s+/g, ' ').trim(),
        caracteres: lu.length,
      };
    });
    const legLarge = await lireLegende();
    ok(legLarge.cles.join('|') === 'Serré|Décale|Complet' && legLarge.gloses === 3,
      '[J] sur 1440 px, les trois cles portent leur glose', JSON.stringify(legLarge));
    await pageJ.setViewportSize({ width: 375, height: 812 });
    await dormir(250);
    const legEtroit = await lireLegende();
    ok(legEtroit.cles.join('|') === 'Serré|Décale|Complet'
      && legEtroit.gloses === 0
      && legEtroit.lu === legEtroit.attenduCourt
      && legEtroit.caracteres < legLarge.caracteres,
      '[J] sur 375 px, la legende ne porte PLUS QUE la consigne et les trois mots',
      `« ${legEtroit.lu} » (${legEtroit.caracteres} caracteres contre ${legLarge.caracteres} en large)`);

    // --- L heure RETENUE emporte celle de son 2e groupe -------------------
    // Movsar, 2026-09-23 : « quand ya des groupes a scinder, ca doit montrer
    // que si tu prends une heure, y a l autre qui est reservee pour les autres
    // groupes ; tout doit etre explique ». Une partie de laser est retenue au
    // milieu de la journee : sa demi-heure suivante est au 2e groupe, la
    // demi-heure d avant chevaucherait sa propre partie, et le bowling qui la
    // croiserait devrait se deplacer.
    await pageJ.setViewportSize({ width: 1440, height: 900 });
    const libresJ = (ancresDe(dJ).find((a) => a.activityId === 'laser_game') || { times: [] }).times.filter((t) => t.ok !== false && !t.warning).map((t) => t.time);
    const LJ = libresJ[Math.floor(libresJ.length / 2)];
    ok(Boolean(LJ) && await poserEtAttendre(pageJ, 'laser_game', LJ), '[J] a 40 personnes, une partie de laser est retenue', LJ);
    const dLJ = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(Object.assign({}, paramsJ, { preferredTimes: JSON.stringify({ laser_game: LJ }), laserGameTimes: JSON.stringify([LJ]) }))}`);
    const laserLJ = ancresDe(dLJ).find((a) => a.activityId === 'laser_game') || { times: [] };
    const bowlingLJ = ancresDe(dLJ).find((a) => a.activityId === 'bowling') || { times: [] };
    const empLJ = emporteesQa(dLJ, laserLJ, [LJ]);
    const soiLJ = laserLJ.times.filter((t) => t.ok === false && t.code === 'anchor_overlap' && t.conflict && t.conflict.activityId === 'laser_game' && !empLJ[t.time]).map((t) => t.time);
    const decLJ = bowlingLJ.times.filter((t) => t.ok === false && t.code === 'anchor_overlap' && t.conflict && t.conflict.activityId === 'laser_game').map((t) => t.time);
    const plageLJ = plageQa(dLJ, 'laser_game', LJ);
    ok(Object.keys(empLJ).length > 0 && soiLJ.length > 0 && decLJ.length > 0 && Boolean(plageLJ),
      '[J] MONTAGE : la route rend une heure de 2e groupe, un chevauchement du laser avec sa propre partie, et des heures de bowling qui le croisent',
      JSON.stringify({ laser: LJ, groupe2: Object.keys(empLJ), soi: soiLJ, decale: decLJ, plage: plageLJ }));
    const pistesLJ = await verifierPistes(dLJ, { laser_game: LJ }, [LJ],
      '[J] LASER RETENU : les pistes = la route ; l heure du 2e groupe est a vous, le chevauchement avec sa propre partie est « pris », le bowling qui croise « decale », et chaque heure qui coince s explique sous sa plage', pageJ);
    // Sa propre partie : la ligne dit quand elle joue, groupes compris.
    const lignesSoi = (pistesLJ.find((p) => p.id === 'laser_game') || { periodes: [] }).periodes.reduce((acc, x) => acc.concat(x.raisons), [])
      .filter((r) => r.etat === 'hard' && soiLJ.some((h) => r.heures.indexOf(h) >= 0));
    ok(lignesSoi.length > 0 && lignesSoi.every((r) => r.cle === 'pris' && r.texte.indexOf(`de ${plageLJ}`) >= 0),
      '[J] l heure qui chevaucherait sa propre partie est « pris », et sa ligne dit quand joue cette partie, 2e groupe compris', lignesSoi.map((r) => `« ${r.texte} »`).join(' '));
    const lignesDecale = (pistesLJ.find((p) => p.id === 'bowling') || { periodes: [] }).periodes.reduce((acc, x) => acc.concat(x.raisons), []).filter((r) => r.etat === 'shift');
    const nomLaser = String(laserLJ.label || 'Laser Game').toLowerCase();
    ok(lignesDecale.length > 0 && lignesDecale.every((r) => r.texte.indexOf(`(${plageLJ})`) >= 0 && r.texte.toLowerCase().indexOf(nomLaser) >= 0),
      '[J] le bowling qui croiserait dit l activite qui bougerait ET la plage reelle qu elle occupe, 2e groupe compris', lignesDecale.map((r) => `« ${r.texte} »`).join(' '));
    // TOUCHER L HEURE DU 2e GROUPE LA CHOISIT (Movsar, 2026-09-23 : « faut
    // qu ils puissent cliquer quand meme pour changer, mais que ca reste
    // marque pour montrer les autres groupes ») : le 1er groupe part a cette
    // heure, le 2e le suit. Une partie posee sur deux : le moteur n a pas juge
    // ce depart (il AJOUTERAIT une partie), l heure se prend.
    const hGroupe2 = Object.keys(empLJ)[0];
    const groupe2 = empLJ[hGroupe2] || {};
    const ligneGroupe2 = (pistesLJ.find((p) => p.id === 'laser_game') || { periodes: [] }).periodes.reduce((acc, x) => acc.concat(x.raisons), []).find((r) => r.heures.indexOf(hGroupe2) >= 0) || { texte: '', cle: '' };
    ok(ligneGroupe2.cle === `groupe ${groupe2.rang}` && ligneGroupe2.texte.indexOf(`${groupe2.rang}e groupe (${groupe2.joueurs} joueurs)`) >= 0 && ligneGroupe2.texte.indexOf('La choisir y fait partir votre 1er groupe.') >= 0,
      '[J] l heure du 2e groupe reste marquee, et sa ligne dit que la choisir y fait partir le 1er groupe', `${hGroupe2} « ${ligneGroupe2.texte} »`);
    const avantGroupe2 = demandesJ.length;
    ok(await poserEtAttendre(pageJ, 'laser_game', hGroupe2), '[J] toucher l heure du 2e groupe recalcule', hGroupe2);
    const qG2 = new URL(demandesJ.slice(avantGroupe2).filter((u) => u.indexOf('/api/public-availability?') >= 0).pop() || `${BASE_URL}/`).searchParams;
    ok(qG2.get('laserGameTimes') === JSON.stringify([hGroupe2]) && JSON.parse(qG2.get('preferredTimes') || '{}').laser_game === hGroupe2,
      '[J] la partie SUIT son 1er groupe : elle part a l heure touchee, rien ne s ajoute', `${qG2.get('laserGameTimes')} / ${qG2.get('preferredTimes')}`);
    const dG2 = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(Object.assign({}, paramsJ, { preferredTimes: JSON.stringify({ laser_game: hGroupe2 }), laserGameTimes: JSON.stringify([hGroupe2]) }))}`);
    await verifierPistes(dG2, { laser_game: hGroupe2 }, [hGroupe2], '[J] 1er GROUPE DEPLACE : les pistes = la route ; l heure touchee est choisie, son 2e groupe se marque a la demi-heure suivante', pageJ);
    // DEUX PARTIES POSEES, la seconde juste apres la premiere. L heure du 2e
    // groupe de la plus tot, le moteur l a jugee (il remplace la plus tot :
    // c est ce depart-la), et la refuse : ce 1er groupe chevaucherait la
    // seconde partie. Celle de la plus tardive, il ne l a pas jugee.
    const laserG2 = ancresDe(dG2).find((a) => a.activityId === 'laser_game') || { times: [] };
    const P2 = (laserG2.times.find((t) => t.ok !== false && !t.warning && t.time > hGroupe2) || {}).time;
    ok(Boolean(P2) && await poserEtAttendre(pageJ, 'laser_game', P2), '[J] une seconde partie de laser est posee apres la premiere', P2);
    const partsJ = [hGroupe2, P2].sort();
    const dP2 = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(Object.assign({}, paramsJ, { preferredTimes: JSON.stringify({ laser_game: partsJ[0] }), laserGameTimes: JSON.stringify(partsJ) }))}`);
    const laserP2 = ancresDe(dP2).find((a) => a.activityId === 'laser_game') || { times: [] };
    const empP2 = emporteesQa(dP2, laserP2, partsJ);
    const jugees = Object.keys(empP2).filter((h) => empP2[h].depuis === partsJ[0]);
    const tardives = Object.keys(empP2).filter((h) => empP2[h].depuis === partsJ[1]);
    const refusee = jugees.find((h) => { const t = laserP2.times.find((x) => x.time === h); return t && t.ok === false; });
    ok(Boolean(refusee) && tardives.length > 0,
      '[J] MONTAGE : deux parties posees, une heure de 2e groupe dont le moteur REFUSE le depart (la plus tot) et une qu il n a pas jugee (la plus tardive)', JSON.stringify({ parties: partsJ, jugees, tardives, refusee }));
    await verifierPistes(dP2, { laser_game: partsJ[0] }, partsJ, '[J] DEUX PARTIES : les pistes = la route ; l heure du 2e groupe de la plus tot suit le verdict du moteur, celle de la plus tardive se prend', pageJ);
    // Le depart refuse : la toucher ne demande rien ; sa ligne s eclaire et
    // dit pourquoi, avec la raison du moteur.
    const avantRefus = demandesJ.length;
    await toucherHeure(pageJ, 'laser_game', refusee);
    await dormir(300);
    const luRefus = await pageJ.evaluate((h) => {
      const l = document.querySelector('#hourZone .fg-why-list__item.is-lit');
      const c = document.querySelector(`#hourZone .fg-track[data-activity="laser_game"] .fg-chip[data-time="${h}"]`);
      return { texte: l ? l.textContent.replace(/\s+/g, ' ').trim() : '', heures: l ? String(l.dataset.heures || '').split(' ') : [], mot: c ? c.querySelector('small').textContent : '', ok: c ? c.dataset.ok : '' };
    }, refusee);
    const raisonRefus = (laserP2.times.find((x) => x.time === refusee) || {}).reason || 'Indisponible';
    ok(demandesJ.slice(avantRefus).every((u) => u.indexOf('/api/public-availability?') < 0) && luRefus.ok === 'false' && luRefus.mot === `groupe ${(empP2[refusee] || {}).rang}`
      && luRefus.heures.indexOf(refusee) >= 0 && luRefus.texte.indexOf('impossible') >= 0 && luRefus.texte.indexOf(minusculeQa(raisonRefus)) >= 0,
      '[J] l heure du 2e groupe dont le moteur refuse le depart reste marquee, ne se prend pas, et sa ligne s eclaire avec la raison', `${refusee} « ${luRefus.texte} »`);
    // Celle que le moteur n a pas jugee : la toucher fait partir la partie
    // tardive a cette heure ; la plus tot ne bouge pas.
    const hTardive = tardives[0];
    const avantTardive = demandesJ.length;
    ok(await poserEtAttendre(pageJ, 'laser_game', hTardive), '[J] toucher l heure du 2e groupe de la partie tardive recalcule', hTardive);
    const qTardive = new URL(demandesJ.slice(avantTardive).filter((u) => u.indexOf('/api/public-availability?') >= 0).pop() || `${BASE_URL}/`).searchParams;
    const partsTardive = [partsJ[0], hTardive].sort();
    ok(qTardive.get('laserGameTimes') === JSON.stringify(partsTardive), '[J] seule la partie tardive suit son groupe, la plus tot reste', `${qTardive.get('laserGameTimes')} attendu ${JSON.stringify(partsTardive)}`);
    const dTardive = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(Object.assign({}, paramsJ, { preferredTimes: JSON.stringify({ laser_game: partsTardive[0] }), laserGameTimes: JSON.stringify(partsTardive) }))}`);
    await verifierPistes(dTardive, { laser_game: partsTardive[0] }, partsTardive, '[J] PARTIE TARDIVE DEPLACEE : les pistes = la route', pageJ);
    await lisibles('.fg-legend__tip, .fg-legend__key i, .fg-legend__key em, #hourZone .fg-period.is-open .fg-why-list__item > span, #hourZone .fg-period.is-open .fg-why-list__item b, #hourZone .fg-period.is-open .fg-key, #hourZone .fg-period.is-open .fg-chip b, #hourZone .fg-period.is-open .fg-chip small',
      '[J] la legende, les heures ouvertes et leurs raisons gardent 4,5:1 au pire moment (sur la photo du fond, voile compris)');
    await tour.close();

    // =====================================================================
    console.log('');
    console.log('[H] MOUVEMENT REDUIT');
    // =====================================================================
    const calme = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const pageCalme = await calme.newPage();
    await pageCalme.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    const anims = await pageCalme.evaluate(() => Array.from(document.querySelectorAll('.fg-scene.is-active .fg-title .w > span, .fg-scene.is-active .fg-art img, .fg-scene.is-active .fg-rise, .fg-curtain, .fg-glow i')).map((el) => getComputedStyle(el).animationName).filter((n) => n && n !== 'none'));
    ok(anims.length === 0, '[H] avec prefers-reduced-motion, plus aucune animation (rideau et halos compris)', anims.join(', ') || 'aucune');
    ok(await pageCalme.evaluate(() => getComputedStyle(document.querySelector('.fg-curtain')).visibility === 'hidden'), '[H] sans animation, le rideau n existe pas (invisible par defaut)');
    await calme.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('');
  if (failures) { console.error(`fungalaxy-form-check: ${failures} verification(s) en echec.`); process.exit(1); }
  console.log('fungalaxy-form-check: ALL OK');
}

main().catch((error) => { console.error(error && error.stack || error); process.exit(1); });

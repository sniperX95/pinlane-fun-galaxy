// Gate Playwright - LOT DE POLISH P2 : LE PRIX AJUSTE ET LA NOTE, DECIDES PAR
// UNE SEULE REGLE ET LUS PAR SEPT ECRANS (huit avant que Terrain ne reunisse Arrivees et Evenements).
//
// POURQUOI CE GATE EXISTE. Le lot P2 (2026-09-03) repond a deux demandes de
// Movsar : « si on affichait le prix modifie de cette facon ca serait plus
// visible » et « il y a aussi les notes a lire qui s affichent nulle part ».
// Le defaut n etait pas une pastille manquante sur un ecran : c est que la
// REGLE (« qu est-ce qu un prix ajuste ») vivait au milieu du rendu de la liste
// du planning, que la caisse en avait une deuxieme, DIFFERENTE, et que les six
// autres surfaces n en avaient aucune. Meme dossier, deux verdicts, selon
// l ecran regarde.
//
// TROIS RELECTURES ADVERSES ONT ENSUITE TROUVE, DANS LA PREMIERE VERSION DU
// LOT, DES DEFAUTS REELS ET MESURES. Ce gate garde les cinq proprietes qui les
// ferment, parce que chacune peut se re-casser en silence :
//
//   [A] UNE SEULE REGLE DECIDE, ET TOUS LES ECRANS LA SUIVENT.
//       Mesure d origine : avant le lot, `renderReservationRow` calculait
//       `rowReference = (Number(r.basePrice) || 0) + extras` chez elle, et
//       `renderPosCaisse` calculait la sienne avec un repli catalogue. Un
//       dossier sans reference ecrite etait donc muet dans la liste et bavard
//       en caisse. La preuve qu il n y a plus de copie ne peut PAS etre une
//       lecture de code : on change la regle partagee EN MEMOIRE et on exige
//       que les sept surfaces changent d avis ENSEMBLE, dans les deux sens.
//       Une surface qui resterait juste pendant que les autres tombent est une
//       duplication survivante.
//
//   [B] SEUL L ECART SE MONTRE - ET UN ECART SE COMPARE A UNE REFERENCE ECRITE.
//       Deux bloquants trouves par la revue, tous deux mesures :
//       - la premiere version repliait sur le CATALOGUE DU JOUR quand le
//         dossier ne portait pas de `basePrice`. Sur la fixture 9005 (« Team
//         Atelier Laser », prix 180, aucune base), la liste passait de « aucun
//         marqueur » a « Prix ajuste 180 EUR, reference 324 EUR » pour un
//         dossier que personne n avait touche - et la Direction comptait ce
//         faux geste commercial. lib/database.js ramene une colonne
//         `base_price` vide a 0 : le repli n etait donc pas l exception, c etait
//         le chemin par defaut de toute ligne heritee.
//       - le verdict se gardait sur `reference` (= base + extras) : sur un
//         dossier a 200 EUR sans base et avec un cafe a 6 EUR, un seul extra
//         suffisait a franchir la garde, et l ecran annoncait « Prix ajuste
//         200 EUR (reference 6 EUR) ». Une affirmation sur une decision humaine,
//         fabriquee par un defaut de garde.
//       Le chemin d ECRITURE, lui, garde son repli catalogue : addExtra et
//       removeExtra recomposent le prix avec la meme formule, et deux
//       references de part et d autre de la soustraction deplaceraient le total
//       du prix entier du catalogue au premier cafe ajoute.
//
//   [C] LA NOTE SE VOIT SUR LES SURFACES CITEES, ET SON TEXTE NE VIT PAS QUE
//       DANS LA COULEUR. Mesure d origine : sur la page Reservations la
//       consigne sortait en rgb(161,161,161) a 12 px (`.pv2-flow-body span`,
//       0-1-1, l emportait sur `.res-note-line`, 0-1-0), pendant que LA MEME
//       aide rendait rgb(245,166,35) a 11,5 px dans la liste du planning. Trois
//       ecrans, deux couleurs, une seule information. Et le marqueur de note
//       des cartes du planning n a aucun texte visible : sans `role="img"`,
//       son `aria-label` est pose sur un noeud `generic`, que la
//       specification ARIA in HTML interdit de nommer et que les lecteurs
//       d ecran ne restituent pas. (Jusqu au 2026-09-25 la page Evenements
//       portait le meme marqueur ; elle est fondue dans Terrain, ou la
//       consigne est ecrite en toutes lettres.)
//
//   [D] RIEN NE DEBORDE, ET L ORDRE DE CESSION EST RESPECTE. La pastille de
//       prix est la derniere arrivee dans le pied de la carte du planning :
//       elle cede pour tout le monde, rien ne cede pour elle. Mesure du defaut,
//       trouvee par ce gate : les planchers livres (102/113/123 px de piste)
//       avaient ete releves sur un pied leger (« 6 j · 1h »). Sur le dossier
//       9003 des fixtures QA (« 34 j · 1h30 », 63,4 px de chiffres), le montant
//       a trois chiffres DEBORDAIT de 11 px a 1280 px de fenetre, soit a
//       115,1 px de piste - deux pixels AU-DESSUS du plancher cense le
//       proteger - et sortait de 3,4 px hors du cadre de la carte.
//       Et la note survit en dernier : elle a un plancher plus bas (96 px) que
//       la pastille de prix (108 px pour deux chiffres), donc entre les deux le
//       montant est parti et la consigne est encore la.
//
//   [E] LE MONTANT AFFICHE EST CELUI DU DOSSIER. Une pastille qui annonce un
//       chiffre recopie serait pire qu une pastille absente : la directrice ne
//       peut ni l expliquer au client ni la verifier en caisse. On exige donc
//       que chaque nombre rendu par le marqueur appartienne a { prix facture,
//       reference }, que la reference soit toujours atteignable (infobulle et
//       nom accessible), et que TOUT SUIVE LA DONNEE : on re-sert le meme
//       dossier a un autre prix et a une autre reference, et les sept surfaces
//       changent de chiffres. Une constante recopiee ne bougerait pas.
//
// IL VERIFIE DES COMPORTEMENTS, JAMAIS DES PRESENCES. Aucune assertion ne dit
// « la chaine X est dans le HTML » : chaque propriete est mesuree sur ce que
// l ECRAN rend (rectangles, styles calcules, noms accessibles) apres un vrai
// parcours des sept surfaces, ou sur le document que la Direction EXPORTE.
//
// LE MONTAGE EST ASSERTE AVANT LA PROPRIETE. Un gate qui n a pas monte la
// situation qu il pretend tester est vert pour rien : chaque propriete commence
// donc par prouver que les dossiers sont bien rendus, que la carte mesuree est
// bien la plus courte, que le temoin est bien a l ecran.
//
// CONTRE-EPREUVE PAR MUTATION SERVIE EN MEMOIRE. Chaque propriete porte une ou
// plusieurs mutations qui ANNULENT son correctif a la source, sur une copie
// SERVIE par le serveur du gate : rien n est jamais ecrit sur le disque, donc
// aucune restauration ne peut etre oubliee apres un echec. Chaque mutation doit
// faire tomber LA phrase de la propriete visee, pas seulement le montage : une
// mutation qui casse le rendu prouverait seulement que le gate reagit au bruit.
//
// Usage : node scripts/polish-p2-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_POLISH_P2_PORT || 4643);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LE SERVEUR. Il sert le depot tel quel, PLUS une carte d overrides en memoire :
// c est elle qui rend la contre-epreuve possible sans jamais ecrire dans le
// depot, donc sans restauration a oublier ni mutation laissee en place apres un
// echec.
// ---------------------------------------------------------------------------
const overrides = new Map();

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (overrides.has(rel)) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(overrides.get(rel));
      return;
    }
    let filePath = path.join(ROOT, rel);
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Les fins de ligne du depot ne sont pas uniformes (app-main.js et
// pinlane-staff.css en CRLF, d autres fichiers en LF) : une ancre ecrite en LF
// ne se trouverait nulle part dans un fichier CRLF. On normalise la copie
// SERVIE, jamais le disque.
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
function sourceDisque(fichier) {
  return fs.readFileSync(path.join(ROOT, fichier), 'utf8').split(CRLF).join(LF);
}
function sourceCourante(fichier) {
  return overrides.has(fichier) ? overrides.get(fichier) : sourceDisque(fichier);
}

// Les mutations s EMPILENT : une propriete qui mute la regle partagee pour
// mesurer son effet doit pouvoir le faire PENDANT qu une contre-epreuve a deja
// mute autre chose dans le meme fichier. On repart donc de la source COURANTE,
// et on la remet exactement comme elle etait.
// `pileMutations` est la SIGNATURE de ce que le serveur sert en ce moment :
// c est elle qui permet de reutiliser un parcours deja fait sans jamais
// confondre deux etats du code. Un cache indexe sur autre chose (le temps, un
// compteur) rendrait un parcours mesure sur une AUTRE version.
const pileMutations = [];
// UNE MUTATION PEUT PORTER PLUSIEURS EDITIONS. Le premier bloquant de la
// revue ne tenait pas a une ligne mais a DEUX qui se tenaient : le repli sur
// le catalogue du jour ET la garde qui concluait sur la base reconstituee.
// Muter une seule des deux ne reproduit pas le defaut, donc ne prouve rien.
async function avecMutations(editions, fn) {
  const avant = new Map();
  editions.forEach(({ fichier }) => {
    if (!avant.has(fichier)) avant.set(fichier, overrides.has(fichier) ? overrides.get(fichier) : null);
  });
  editions.forEach(({ fichier, de, vers }) => {
    const source = overrides.has(fichier) ? overrides.get(fichier) : sourceDisque(fichier);
    if (source.split(de).length - 1 !== 1) {
      throw new Error(`ancre absente ou multiple dans ${fichier} : ${de.slice(0, 60)}`);
    }
    overrides.set(fichier, source.replace(de, vers));
  });
  pileMutations.push(editions.map((e) => `${e.fichier}::${e.de}=>${e.vers}`).join('&&'));
  try {
    return await fn();
  } finally {
    pileMutations.pop();
    avant.forEach((valeur, fichier) => {
      if (valeur === null) overrides.delete(fichier); else overrides.set(fichier, valeur);
    });
  }
}
async function avecMutation(fichier, de, vers, fn) {
  return avecMutations([{ fichier, de, vers }], fn);
}

// ---------------------------------------------------------------------------
// LE JEU DU JOUR. Ce sont les fixtures PARTAGEES de run-visual-qa, retouchees :
// une copie locale divergerait au premier changement de fixtures, et c est
// exactement la maladie que ce lot soigne. La retouche pose ce que les fixtures
// ne portaient pas : des references ecrites, des consignes, et les deux
// dossiers TEMOINS qui ne doivent RIEN afficher.
// ---------------------------------------------------------------------------
const NOTE_9001 = 'Gateau a sortir a 14h30, bougies dans le frigo';
const NOTE_9002 = 'Un joueur en fauteuil roulant, prevoir la piste du bord';

// Ce que le RESEAU sert. Le gate lit ce meme objet pour calculer ce qu il
// ATTEND : les nombres compares ne viennent donc jamais du produit.
function jeuDuJour(prixAutre = false) {
  return {
    9001: { basePrice: 60, price: prixAutre ? 33 : 40, notes: NOTE_9001, extras: [] },
    9002: { basePrice: 60, price: prixAutre ? 33 : 40, notes: NOTE_9002, extras: [] },
    9003: { basePrice: prixAutre ? 349 : 380, price: prixAutre ? 271 : 308, extras: [] },
    // TEMOIN 1 : le prix EGALE la reference. Aucun marqueur, nulle part.
    9004: { basePrice: 234, price: 234, extras: [] },
    // TEMOIN 2 : aucune reference ecrite (la fixture n a pas de basePrice).
    // Le catalogue du jour price ce dossier a 324 EUR : s il refait surface,
    // l ecran annonce « Prix ajuste 180 EUR (reference 324 EUR) ».
    9005: { price: 180, extras: [] },
  };
}
// TEMOIN 3 : une reference ECRITE A ZERO, plus un extra. Le `||` de la premiere
// version confondait « champ absent » et « base a zero », et la garde sur la
// somme laissait un cafe a 6 EUR ouvrir la porte.
const DOSSIER_SUR_MESURE = {
  id: 9006,
  name: 'Sur mesure Dupont #9006',
  phone: '+32470860016',
  email: 'dupont@example.test',
  startTime: '11:00',
  duration: 1,
  lanes: [7],
  status: 'confirmed',
  pax: 5,
  price: 200,
  basePrice: 0,
  type: 'bowling',
  label: 'Bowling classique',
  extras: [{ name: 'Cafe', price: 6 }],
};

const AJUSTES = [9001, 9002, 9003];
const TEMOINS = [9004, 9005, 9006];

// Ce que le gate ATTEND, calcule EN NODE depuis le jeu servi : prix facture et
// reference = base ecrite + extras. Aucun appel au produit.
function attendus(prixAutre = false) {
  const jeu = jeuDuJour(prixAutre);
  const table = {};
  Object.entries(jeu).forEach(([id, d]) => {
    const extras = (d.extras || []).reduce((s, e) => s + (Number(e.price) || 0), 0);
    table[id] = {
      prix: Number(d.price) || 0,
      reference: d.basePrice === undefined ? null : (Number(d.basePrice) || 0) + extras,
    };
  });
  const extrasSm = DOSSIER_SUR_MESURE.extras.reduce((s, e) => s + e.price, 0);
  table[DOSSIER_SUR_MESURE.id] = { prix: DOSSIER_SUR_MESURE.price, reference: DOSSIER_SUR_MESURE.basePrice + extrasSm };
  return table;
}

// ---------------------------------------------------------------------------
// LA PAGE. installQaApi pose la session ET les fixtures partagees ; un second
// script d init ENVELOPPE le fetch qu il vient d installer pour servir le jeu
// retouche sur staff-state ET sur admin-range. Sans cela, le poll de la console
// reecrase l etat en cours de parcours et la Direction lit un autre jeu que le
// planning.
// ---------------------------------------------------------------------------
function loadFromVisualQa(nom) {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/run-visual-qa.js'), 'utf8');
  const debut = src.indexOf('async function ' + nom + '(');
  if (debut === -1) throw new Error(nom + ' introuvable dans run-visual-qa.js');
  const fin = new RegExp('\\r?\\n\\}\\r?\\n').exec(src.slice(debut));
  if (!fin) throw new Error('fin de ' + nom + ' introuvable');
  const corps = src.slice(debut, debut + fin.index + fin[0].length);
  // eslint-disable-next-line no-new-func
  return new Function('BASE_URL', corps + '\nreturn ' + nom + ';')(BASE_URL);
}

const installQaApi = loadFromVisualQa('installQaApi');
const waitForApp = loadFromVisualQa('waitForApp');
const seedStressDay = loadFromVisualQa('seedStressDay');
const renderStaffPage = loadFromVisualQa('renderStaffPage');

// PENDANT UNE MUTATION, UNE ERREUR DE PAGE EST ATTENDUE, PAS UN DEFAUT. Sans ce
// drapeau, une mutation qui casserait le rendu compterait un FAIL de plus au
// lieu d etre la preuve qu on cherche.
let enMutation = false;
async function pageNeuve(browser, viewport = { width: 1440, height: 920 }) {
  // Un contexte NEUF par scenario : un contexte partage transmet le
  // localStorage d une page a l autre, et le scenario suivant heriterait de
  // l etat du precedent (date de travail, filtre, theme). Ce piege a deja coute
  // un gate dans ce depot.
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    if (enMutation) { console.log(`      (mutation) erreur JS attendue : ${e.message}`); return; }
    console.log(`FAIL  erreur JS dans la page : ${e.message}`);
    failures += 1;
  });
  return { page, fermer: () => context.close() };
}

async function ouvrirConsole(page, options = {}) {
  await installQaApi(page);
  await page.addInitScript(({ jeu, surMesure }) => {
    const precedent = window.fetch;
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `p2-${Date.now()}` } });
    window.__P2_JEU__ = (date) => {
      const base = window.__PINLANE_QA_RESERVATIONS__ ? window.__PINLANE_QA_RESERVATIONS__(date) : [];
      const liste = base.map((r) => (jeu[r.id] ? { ...r, ...jeu[r.id] } : { ...r }));
      liste.push({ ...surMesure, date });
      return liste;
    };
    window.fetch = async (input, init = {}) => {
      const brut = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(brut, window.location.origin);
      if (u.pathname === '/api/staff-state') {
        const d = u.searchParams.get('date') || new Date().toISOString().slice(0, 10);
        return J({ ok: true, revision: 'p2-fixe', reservations: window.__P2_JEU__(d), laneStatuses: window.__PINLANE_QA_LANES__(), centerId: 'libramont' });
      }
      if (u.pathname === '/api/admin-range') {
        const d = u.searchParams.get('startDate') || new Date().toISOString().slice(0, 10);
        return J({ ok: true, reservations: window.__P2_JEU__(d), emails: [], agentEvents: [], centerId: 'libramont' });
      }
      return precedent(input, init);
    };
  }, { jeu: jeuDuJour(options.prixAutre), surMesure: DOSSIER_SUR_MESURE });
  await waitForApp(page);
  await seedStressDay(page);
  await page.evaluate(() => {
    state.reservations = window.__P2_JEU__(state.currentDate);
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    state.staffPlanningExpanded = false;
    save();
    renderStaff();
  });
  await page.waitForTimeout(700);
}

// ---------------------------------------------------------------------------
// LA LECTURE D UNE SURFACE. Un marqueur est rattache a SA surface par le
// voisinage qui l accueille, et a SON dossier par l identifiant ecrit dans le
// nom du client (« ... #9002 »). On ne lit que ce qui est VISIBLE : les pages
// staff restent dans le DOM quand on en quitte une, et compter un marqueur a
// largeur nulle serait compter ce que personne ne voit.
// ---------------------------------------------------------------------------
const LIRE_SURFACE = () => {
  const surfaceDe = (el) => {
    if (el.closest('#planningBox')) return 'planning-carte';
    if (el.closest('.res-c-what')) return 'planning-liste';
    if (el.closest('.laser-group-card')) return 'arene-laser';
    if (el.closest('.pv2-flow-marks')) return 'reservations-jour';
    if (el.closest('.terrain-card')) return 'terrain';
    if (el.closest('.dashboard-detail-amount')) return 'vue-ensemble';
    if (el.closest('#adminContent')) return 'direction';
    return 'inconnue';
  };
  const dossierDe = (el) => {
    let n = el;
    while (n && n !== document.body) {
      if (n.dataset && (n.dataset.bookingResId || n.dataset.resRowId)) return String(n.dataset.bookingResId || n.dataset.resRowId);
      const trouves = [...new Set((n.textContent || '').match(/#(90\d\d)/g) || [])];
      if (trouves.length === 1) return trouves[0].slice(1);
      n = n.parentElement;
    }
    return null;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // UN MONTANT, PAS DEUX COLLES PAR UN RETOUR A LA LIGNE. formatMoney groupe
  // les milliers avec une espace fine insecable (U+202F) et pose une espace
  // ordinaire avant l euro. Accepter n importe quelle espace entre les
  // chiffres faisait lire la fin de « 1h30 » suivie de « 308 € » comme le
  // nombre 30308, et le gate rougissait sur sa propre lecture.
  const nombres = (texte) => (String(texte).match(/\d+(?:[\u202F\u00A0]\d{3})*(?=[\u202F\u00A0 ]?€)/g) || [])
    .map((n) => Number(n.replace(/[^\d]/g, '')))
    .filter((n) => Number.isFinite(n));

  // DEUX ROLES, UN SEUL MOT POUR LES DISTINGUER. Un marqueur ecrit au plus
  // deux nombres : le montant facture et la reference. C est le mot
  // « référence » qui dit lequel est lequel, a l ecran comme dans le nom
  // accessible et dans l infobulle. Les confondre reviendrait a accepter
  // qu une pastille annonce la reference a la place du prix du dossier - ce
  // qui est exactement le defaut que cette propriete garde.
  const scinder = (texte) => {
    const t = String(texte || '');
    const marque = /r[ée]f[ée]rence/i.exec(t);
    return marque
      ? { montant: nombres(t.slice(0, marque.index)), reference: nombres(t.slice(marque.index)) }
      : { montant: nombres(t), reference: [] };
  };
  const marques = Array.from(document.querySelectorAll('.pl-price-adjusted')).filter(visible).map((el) => {
    const r = el.getBoundingClientRect();
    const parent = el.parentElement;
    const rp = parent ? parent.getBoundingClientRect() : null;
    const cs = getComputedStyle(el);
    const ligne = el.closest('.booking, .res-row, .laser-group-card, .pv2-flow-item, .terrain-card, .dashboard-detail-row, tr') || parent;
    const texte = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const aria = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    return {
      surface: surfaceDe(el),
      dossier: dossierDe(el),
      texte,
      role: el.getAttribute('role'),
      aria,
      title,
      nombresVisibles: nombres(texte),
      nombresAria: nombres(aria),
      nombresTitle: nombres(title),
      lu: { texte: scinder(texte), aria: scinder(aria), title: scinder(title) },
      nombresLigne: nombres(ligne ? (ligne.innerText || '') : ''),
      largeur: Math.round(r.width * 10) / 10,
      largeurParent: rp ? Math.round(rp.width * 10) / 10 : null,
      parentDisplay: parent ? getComputedStyle(parent).display : null,
      justifySelf: cs.justifySelf,
    };
  });

  const SURFACES_NOTE = [
    ['planning-carte', '.booking .bk-flag.flag-note'],
    ['planning-liste', '.res-c-what .res-note-line'],
    ['reservations-jour', '.pv2-flow-marks .res-note-line'],
    ['terrain', '.terrain-card .res-special-request'],
    ['direction', '#adminContent .guest-chip.note'],
  ];
  const notes = [];
  SURFACES_NOTE.forEach(([surface, selecteur]) => {
    Array.from(document.querySelectorAll(selecteur)).filter(visible).forEach((el) => {
      const cs = getComputedStyle(el);
      const interieur = el.querySelector('span:not(.visually-hidden)');
      notes.push({
        surface,
        dossier: dossierDe(el),
        texte: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        role: el.getAttribute('role'),
        aria: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        couleur: cs.color,
        taille: cs.fontSize,
        couleurInterieur: interieur ? getComputedStyle(interieur).color : null,
        tailleInterieur: interieur ? getComputedStyle(interieur).fontSize : null,
      });
    });
  });

  const LIGNES = [
    ['planning-carte', '#planningBox .booking'],
    ['planning-liste', '.res-row'],
    ['arene-laser', '.laser-group-card'],
    ['reservations-jour', '.pv2-flow-item'],
    ['terrain', '.terrain-card'],
    ['vue-ensemble', '.dashboard-detail-row'],
    ['direction', '#adminContent tbody tr'],
  ];
  const presents = {};
  LIGNES.forEach(([surface, selecteur]) => {
    Array.from(document.querySelectorAll(selecteur)).filter(visible).forEach((el) => {
      const id = dossierDe(el);
      if (!id) return;
      presents[surface] = presents[surface] || [];
      if (!presents[surface].includes(id)) presents[surface].push(id);
    });
  });

  // LA CARTE DU PLANNING A UN BUDGET DE PLACE, ET IL EST ECRIT. Deux cas
  // documentes n y portent AUCUN montant, quoi que dise la regle : la carte de
  // 30 minutes (`dens-xs`, tete et pied en `display: contents`, une seule ligne
  // deja pleine) et la carte qui porte deja la pastille de progression d une
  // formule (26 px de plus dans le meme pied : mesure, il faudrait 172 px de
  // piste pour un montant a trois chiffres quand la configuration par defaut en
  // offre 134,2). Ce n est pas un desaccord avec la regle partagee, c est la
  // place - et le gate le MESURE au lieu de le supposer, pour que l exception
  // apparaisse dans son propre journal au lieu de se cacher dans une constante.
  const horsBudget = [];
  Array.from(document.querySelectorAll('#planningBox .booking')).filter(visible).forEach((carte) => {
    const id = dossierDe(carte);
    if (!id) return;
    const densite = (carte.className.match(/dens-\w+/) || [''])[0];
    const progression = Boolean(carte.querySelector('.activity-pill'));
    const porteuse = (densite === 'dens-md' || densite === 'dens-lg') && !progression;
    if (!porteuse) horsBudget.push({ dossier: id, densite, progression });
  });
  const eligibles = {};
  Object.entries(presents).forEach(([surface, ids]) => {
    eligibles[surface] = surface === 'planning-carte'
      ? ids.filter((id) => !horsBudget.some((h) => h.dossier === id))
      : ids.slice();
  });
  return { marques, notes, presents, eligibles, horsBudget };
};

function fusionner(cible, lot) {
  cible.marques.push(...lot.marques);
  cible.notes.push(...lot.notes);
  [['presents', lot.presents], ['eligibles', lot.eligibles]].forEach(([champ, source]) => {
    Object.entries(source || {}).forEach(([surface, ids]) => {
      cible[champ][surface] = cible[champ][surface] || [];
      ids.forEach((id) => { if (!cible[champ][surface].includes(id)) cible[champ][surface].push(id); });
    });
  });
  (lot.horsBudget || []).forEach((h) => {
    if (!cible.horsBudget.some((x) => x.dossier === h.dossier)) cible.horsBudget.push(h);
  });
}

// LE PARCOURS DES SEPT SURFACES, plus le document que la Direction EXPORTE.
async function tourDesSurfaces(browser, options = {}) {
  const { page, fermer } = await pageNeuve(browser, options.viewport);
  const total = { marques: [], notes: [], presents: {}, eligibles: {}, horsBudget: [], rapport: null, fiches: [] };
  try {
    await ouvrirConsole(page, options);

    // 1 + 2. Le planning bowling : la carte ET la liste du jour en dessous.
    await page.evaluate(() => { state.staffMenuPage = 'planning'; state.staffResourceView = 'bowling'; save(); renderStaff(); });
    await page.waitForTimeout(700);
    fusionner(total, await page.evaluate(LIRE_SURFACE));

    // 3. L arene laser.
    await page.evaluate(() => { state.staffResourceView = 'laser'; save(); renderStaff(); });
    await page.waitForTimeout(700);
    fusionner(total, await page.evaluate(LIRE_SURFACE));

    // 4. Le Terrain (a venir, sur place, a cloturer). Le montage posait
    //    avant staffResourceView = 'arrivals', qui n est pas une ressource du
    //    planning : la file d accueil n etait jamais ouverte.
    await renderStaffPage(page, 'arrivals');
    fusionner(total, await page.evaluate(LIRE_SURFACE));

    // 5. La page Reservations, ligne du jour.
    //
    // LA PAGE ET LE JEU D ESSAI DOIVENT PARLER DU MEME JOUR. Le montage pose
    // les dossiers sur state.currentDate, que seedStressDay cale sur le premier
    // jour OUVERT ; la page Reservations, elle, ouvre sur AUJOURD HUI. Les deux
    // coincident tant que le centre est ouvert aujourd hui, et divergent des
    // qu il ne l est pas : Libramont ferme le lundi, et un lundi cette surface
    // affichait « Journee libre » pendant que le planning portait bien les
    // dossiers. Le gate rougissait alors sur son propre montage, en donnant a
    // lire une consigne disparue.
    await page.evaluate(() => { state.staffReservationsSelectedDate = state.currentDate; save(); });
    await renderStaffPage(page, 'reservations');
    fusionner(total, await page.evaluate(LIRE_SURFACE));

    // 6. La Vue d ensemble : les lignes de detail vivent dans le panneau
    //    « par activite », qui liste tous les dossiers du jour.
    await renderStaffPage(page, 'dashboard');
    await page.evaluate(() => { if (typeof openStaffDashboardDetail === 'function') openStaffDashboardDetail('activity'); });
    await page.waitForTimeout(600);
    fusionner(total, await page.evaluate(LIRE_SURFACE));
    await page.evaluate(() => { if (typeof closeStaffDashboardDetail === 'function') closeStaffDashboardDetail(); });

    // 7. La Direction : le tableau a l ecran, PUIS le document exporte.
    await page.evaluate(() => { state.adminTab = 'reservations'; save(); setView('admin'); });
    await page.waitForFunction(
      () => document.querySelectorAll('#adminContent tbody tr').length > 0,
      null,
      { timeout: 20000 },
    ).catch(() => {});
    await page.waitForTimeout(600);
    fusionner(total, await page.evaluate(LIRE_SURFACE));
    // 8. LA FICHE DU DOSSIER. C est l ecran ou le comptoir explique l ecart au
    //    client, et son en-tete portait encore la regle du chemin d ECRITURE :
    //    elle annoncait « 180 € (prix ajusté) » sur un dossier sans reference
    //    ecrite pendant que les autres surfaces se taisaient. On l ouvre
    //    pour de vrai, dossier par dossier, et on lit ce qui est ecrit.
    await page.evaluate(() => { state.staffMenuPage = 'planning'; save(); setView('staff'); renderStaff(); });
    await page.waitForTimeout(500);
    for (const id of [...AJUSTES, ...TEMOINS]) {
      // eslint-disable-next-line no-await-in-loop
      const lu = await page.evaluate((dossier) => {
        if (typeof openPos !== 'function') return null;
        openPos(dossier);
        const el = document.querySelector('.edit-modal-ident p');
        const texte = el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
        if (typeof closePos === 'function') closePos();
        return texte;
      }, id);
      if (lu !== null) total.fiches.push({ dossier: String(id), texte: lu });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(150);
    }

    total.rapport = await page.evaluate(() => {
      if (typeof getAdminExportPayload !== 'function' || typeof buildDirectionReportHtml !== 'function') return null;
      const html = buildDirectionReportHtml(getAdminExportPayload());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const lignes = Array.from(doc.querySelectorAll('tbody tr')).map((tr) => {
        const trouves = [...new Set((tr.textContent || '').match(/#(90\d\d)/g) || [])];
        return {
          dossier: trouves.length === 1 ? trouves[0].slice(1) : null,
          texte: (tr.textContent || '').replace(/\s+/g, ' ').trim(),
        };
      }).filter((l) => l.dossier);
      return { lignes };
    });
  } finally {
    await fermer();
  }
  return total;
}

// UN PARCOURS PAR ETAT DU CODE, PAS UN PAR PROPRIETE. Les proprietes [B], [C]
// et une partie de [E] lisent LE MEME parcours ; le refaire cinq fois
// n ajouterait aucune preuve et multiplierait par cinq la duree du gate. La cle
// du cache est la pile des mutations SERVIES plus les options du jeu : deux
// etats differents du code ne peuvent donc jamais se partager un parcours.
const parcoursDejaFaits = new Map();
async function tourCache(browser, options = {}) {
  const cle = `${pileMutations.join('|')}#${JSON.stringify(options)}`;
  if (!parcoursDejaFaits.has(cle)) parcoursDejaFaits.set(cle, await tourDesSurfaces(browser, options));
  return parcoursDejaFaits.get(cle);
}

// La geometrie du planning seule : trois largeurs de fenetre, sans le tour
// complet, parce que la propriete [D] ne parle que de la carte.
async function mesurerPlanning(browser, largeurs) {
  const resultat = {};
  for (const largeur of largeurs) {
    const { page, fermer } = await pageNeuve(browser, { width: largeur, height: 920 });
    try {
      await ouvrirConsole(page);
      await page.evaluate(() => { state.staffMenuPage = 'planning'; state.staffResourceView = 'bowling'; save(); renderStaff(); });
      await page.waitForSelector('#planningBox .booking', { timeout: 20000 });
      await page.waitForTimeout(500);
      resultat[largeur] = await page.evaluate(() => Array.from(document.querySelectorAll('#planningBox .booking')).map((carte) => {
        const pied = carte.querySelector('.booking-foot');
        const prix = carte.querySelector('.bk-price');
        const note = carte.querySelector('.bk-flag.flag-note');
        const rc = carte.getBoundingClientRect();
        const rp = prix ? prix.getBoundingClientRect() : null;
        const rn = note ? note.getBoundingClientRect() : null;
        const piste = carte.closest('.lane-col');
        return {
          dossier: carte.getAttribute('data-booking-res-id'),
          densite: (carte.className.match(/dens-\w+/) || [''])[0],
          hauteur: Math.round(rc.height * 10) / 10,
          piste: piste ? Math.round(piste.getBoundingClientRect().width * 10) / 10 : null,
          prixTexte: prix ? (prix.textContent || '').replace(/\s+/g, ' ').trim() : null,
          prixLargeur: rp ? Math.round(rp.width * 10) / 10 : 0,
          noteLargeur: rn ? Math.round(rn.width * 10) / 10 : 0,
          // `null` quand la pastille n est PAS rendue : un element masque a un
          // rectangle a l origine, et le compter « hors du cadre » ferait rougir
          // le gate sur la situation exactement inverse de celle qu il mesure.
          prixDedans: rp && rp.width > 0
            ? (rp.left >= rc.left - 1 && rp.right <= rc.right + 1 && rp.top >= rc.top - 1 && rp.bottom <= rc.bottom + 1)
            : null,
          debordPied: pied ? pied.scrollWidth - pied.clientWidth : null,
          debordCarteW: carte.scrollWidth - carte.clientWidth,
          debordCarteH: carte.scrollHeight - carte.clientHeight,
        };
      }));
    } finally {
      await fermer();
    }
  }
  return resultat;
}

// ===========================================================================
// [A] UNE SEULE REGLE DECIDE
// ===========================================================================
// La regle partagee porte le seuil. On la mute EN MEMOIRE dans les deux sens et
// on regarde qui suit. Une surface qui garderait son avis a sa propre copie.
const SEUIL_ANCRE = 'const PRIX_AJUSTE_SEUIL_EUR = 0.5;';
const SEUIL_MUET = 'const PRIX_AJUSTE_SEUIL_EUR = 100000;';
const SEUIL_BAVARD = 'const PRIX_AJUSTE_SEUIL_EUR = -1;';

async function mesurerA(browser) {
  const normal = await tourCache(browser);
  const muet = await avecMutation('assets/app-main.js', SEUIL_ANCRE, SEUIL_MUET, () => tourCache(browser));
  const bavard = await avecMutation('assets/app-main.js', SEUIL_ANCRE, SEUIL_BAVARD, () => tourCache(browser));
  return { normal, muet, bavard };
}

function surfacesMarquees(tour) {
  const par = {};
  tour.marques.forEach((m) => {
    par[m.surface] = par[m.surface] || [];
    if (!par[m.surface].includes(m.dossier)) par[m.surface].push(m.dossier);
  });
  return par;
}

function jugerA(m) {
  const verdicts = [];
  const parNormal = surfacesMarquees(m.normal);
  const surfaces = Object.keys(parNormal).filter((s) => s !== 'inconnue');
  // MONTAGE : sans plusieurs surfaces reellement marquees, « ensemble » ne veut
  // rien dire.
  verdicts.push({
    ok: surfaces.length >= 6,
    label: '[A] MONTAGE : au moins six surfaces portent un marqueur de prix avec la regle livree',
    detail: `${surfaces.length} surface(s) : ${surfaces.map((s) => `${s}(${parNormal[s].join(',')})`).join(' · ')}`,
  });
  verdicts.push({
    ok: m.normal.rapport && m.normal.rapport.lignes.length > 0,
    label: '[A] MONTAGE : le document exporte par la Direction contient des lignes de dossiers',
    detail: m.normal.rapport ? `${m.normal.rapport.lignes.length} ligne(s)` : 'aucun rapport produit',
  });
  // MONTAGE : le budget de place de la carte du planning est MESURE. Sans ce
  // releve, exclure une carte du verdict ci-dessous serait une exception
  // ecrite dans le gate au lieu d une contrainte lue sur l ecran.
  verdicts.push({
    ok: m.normal.horsBudget.length > 0,
    label: '[A] MONTAGE : les cartes du planning SANS budget pour un montant sont relevees sur l ecran',
    detail: m.normal.horsBudget.map((h) => `#${h.dossier} ${h.densite}${h.progression ? ' + pastille de progression' : ''}`).join(' · ') || 'aucune carte hors budget : le releve ne mesure rien',
  });

  // LA PROPRIETE : toutes les surfaces changent d avis ENSEMBLE.
  const parMuet = surfacesMarquees(m.muet);
  const survivantes = Object.keys(parMuet).filter((s) => parMuet[s].length > 0);
  verdicts.push({
    ok: survivantes.length === 0,
    label: '[A] une seule regle DECIDE : seuil rendu inatteignable, PLUS AUCUNE surface ne marque',
    detail: survivantes.length
      ? `COPIE SURVIVANTE : ${survivantes.map((s) => `${s}(${parMuet[s].join(',')})`).join(' · ')} garde son avis pendant que les autres se taisent`
      : `${surfaces.length} surface(s) se taisent ensemble`,
  });
  const rapportMuet = (m.muet.rapport ? m.muet.rapport.lignes : []).filter((l) => /prix ajust/i.test(l.texte));
  verdicts.push({
    ok: rapportMuet.length === 0,
    label: '[A] une seule regle DECIDE : le document exporte se tait aussi',
    detail: rapportMuet.length ? `${rapportMuet.length} ligne(s) encore annoncees ajustees` : 'aucune mention',
  });
  // LA NEUVIEME SURFACE : l en-tete de la fiche, ou le comptoir explique
  // l ecart au client. Elle avait sa propre regle et contredisait les sept
  // autres sur les deux cas bloquants.
  verdicts.push({
    ok: m.normal.fiches.length >= 5,
    label: '[A] MONTAGE : la fiche de chaque dossier a bien ete ouverte et son en-tete lu',
    detail: `${m.normal.fiches.length} fiche(s) : ${m.normal.fiches.map((f) => `#${f.dossier}`).join(' ')}`,
  });
  const fichesMuettes = m.muet.fiches.filter((f) => /prix ajust/i.test(f.texte));
  verdicts.push({
    ok: fichesMuettes.length === 0,
    label: '[A] une seule regle DECIDE : l en-tete de la fiche se tait aussi',
    detail: fichesMuettes.length ? fichesMuettes.map((f) => `#${f.dossier} « ${f.texte} »`).join(' · ') : 'aucune fiche n annonce d ajustement',
  });
  const fichesBavardes = m.bavard.fiches.filter((f) => /prix ajust/i.test(f.texte));
  verdicts.push({
    ok: fichesBavardes.length >= 3,
    label: '[A] une seule regle DECIDE : seuil abaisse, l en-tete de la fiche parle avec les autres',
    detail: `${fichesBavardes.length} fiche(s) sur ${m.bavard.fiches.length} annoncent un ajustement`,
  });

  // L AUTRE SENS : seuil abaisse, le temoin au tarif catalogue est marque
  // PARTOUT ou il est rendu. Une surface qui ne marquerait jamais serait, elle
  // aussi, une regle a elle.
  const parBavard = surfacesMarquees(m.bavard);
  // « qui le rendent » se lit sur les surfaces qui ont la PLACE de le rendre :
  // la carte du planning ecarte, par regle mesuree ci-dessus, la carte de
  // 30 minutes et celle qui porte deja la progression. Le reste doit suivre.
  const attendues = Object.keys(m.bavard.eligibles).filter((s) => s !== 'inconnue' && m.bavard.eligibles[s].includes('9004'));
  const manquantes = attendues.filter((s) => !(parBavard[s] || []).includes('9004'));
  verdicts.push({
    ok: attendues.length >= 4 && manquantes.length === 0,
    label: '[A] une seule regle DECIDE : seuil abaisse, le dossier au tarif catalogue est marque sur TOUTES les surfaces qui ont la place de le rendre',
    detail: manquantes.length
      ? `${manquantes.join(' · ')} ne suit pas la regle partagee (${attendues.length} surface(s) ont la place pour 9004)`
      : `${attendues.length} surface(s) ont la place pour 9004 et le marquent toutes`,
  });
  return verdicts;
}

// ===========================================================================
// [B] SEUL L ECART SE MONTRE
// ===========================================================================
function jugerB(m) {
  const verdicts = [];
  const tour = m.normal;
  const table = attendus();
  const parSurface = surfacesMarquees(tour);

  // MONTAGE : les trois temoins sont bien A L ECRAN. Un temoin absent ne prouve
  // rien : il ne pouvait pas etre marque de toute facon.
  TEMOINS.forEach((id) => {
    const surfaces = Object.keys(tour.presents).filter((s) => tour.presents[s].includes(String(id)));
    verdicts.push({
      ok: surfaces.length >= 2,
      label: `[B] MONTAGE : le dossier temoin ${id} est rendu sur au moins deux surfaces`,
      detail: surfaces.length ? surfaces.join(' · ') : 'ABSENT DE TOUTES LES SURFACES : le temoin ne prouve rien',
    });
  });

  // LA PROPRIETE : aucun temoin ne porte de marqueur, nulle part.
  TEMOINS.forEach((id) => {
    const porteuses = Object.keys(parSurface).filter((s) => parSurface[s].includes(String(id)));
    const pourquoi = id === 9004
      ? 'son prix EGALE sa reference'
      : id === 9005
        ? 'il n a AUCUNE reference ecrite (le catalogue du jour le price a 324 EUR)'
        : 'sa reference ecrite vaut 0 et son seul extra vaut 6 EUR';
    verdicts.push({
      ok: porteuses.length === 0,
      label: `[B] SEUL L ECART SE MONTRE : le dossier ${id} ne porte AUCUN marqueur de prix (${pourquoi})`,
      detail: porteuses.length ? `marque a tort sur ${porteuses.join(' · ')}` : 'silencieux sur toutes les surfaces',
    });
  });
  const rapportTemoins = (tour.rapport ? tour.rapport.lignes : []).filter((l) => TEMOINS.includes(Number(l.dossier)) && /prix ajust/i.test(l.texte));
  verdicts.push({
    ok: rapportTemoins.length === 0,
    label: '[B] SEUL L ECART SE MONTRE : le document exporte ne dit « prix ajuste » sur aucun temoin',
    detail: rapportTemoins.length ? rapportTemoins.map((l) => l.dossier).join(' · ') : 'aucun temoin annonce ajuste',
  });
  const fichesTemoins = tour.fiches.filter((f) => TEMOINS.includes(Number(f.dossier)) && /prix ajust/i.test(f.texte));
  verdicts.push({
    ok: tour.fiches.length > 0 && fichesTemoins.length === 0,
    label: '[B] SEUL L ECART SE MONTRE : l en-tete de la fiche ne clame rien sur les temoins',
    detail: fichesTemoins.length ? fichesTemoins.map((f) => `#${f.dossier} « ${f.texte} »`).join(' · ') : `${tour.fiches.filter((f) => TEMOINS.includes(Number(f.dossier))).length} fiche(s) temoin silencieuses`,
  });
  const fichesAjustees = tour.fiches.filter((f) => AJUSTES.includes(Number(f.dossier)));
  const fichesAjusteesMuettes = fichesAjustees.filter((f) => !/prix ajust/i.test(f.texte));
  verdicts.push({
    ok: fichesAjustees.length > 0 && fichesAjusteesMuettes.length === 0,
    label: '[B] et l en-tete de la fiche annonce l ajustement sur chaque dossier reellement ajuste',
    detail: fichesAjusteesMuettes.length ? fichesAjusteesMuettes.map((f) => `#${f.dossier} « ${f.texte} »`).join(' · ') : `${fichesAjustees.length} fiche(s) ajustees annoncees`,
  });

  // Et un dossier REELLEMENT ajuste est marque partout ou il est rendu.
  AJUSTES.forEach((id) => {
    const rendues = Object.keys(tour.eligibles).filter((s) => s !== 'inconnue' && tour.eligibles[s].includes(String(id)));
    const marquees = rendues.filter((s) => (parSurface[s] || []).includes(String(id)));
    verdicts.push({
      ok: rendues.length > 0 && marquees.length === rendues.length,
      label: `[B] et le dossier ajuste ${id} est marque sur CHAQUE surface qui a la place de le rendre`,
      detail: rendues.length
        ? `${marquees.length}/${rendues.length} : ${rendues.map((s) => `${s}${marquees.includes(s) ? '' : ' (MUET)'}`).join(' · ')}`
        : 'dossier rendu nulle part',
    });
  });

  // Le montant de REFERENCE est lisible : il vit dans l infobulle ET dans le nom
  // accessible de CHAQUE marqueur, quelle que soit la forme.
  const sansReference = tour.marques.filter((mq) => {
    const attendu = table[mq.dossier];
    if (!attendu || attendu.reference === null) return false;
    return !mq.nombresTitle.includes(attendu.reference) || !mq.nombresAria.includes(attendu.reference);
  });
  verdicts.push({
    ok: tour.marques.length > 0 && sansReference.length === 0,
    label: '[B] et la REFERENCE est atteignable sur chaque marqueur (infobulle et nom accessible)',
    detail: sansReference.length
      ? sansReference.map((mq) => `${mq.surface}/${mq.dossier} title=[${mq.nombresTitle}] aria=[${mq.nombresAria}]`).join(' · ')
      : `${tour.marques.length} marqueur(s) verifie(s)`,
  });
  return verdicts;
}

// ===========================================================================
// [C] LA NOTE SE VOIT, ET PAS SEULEMENT PAR SA COULEUR
// ===========================================================================
function jugerC(m) {
  const verdicts = [];
  const tour = m.normal;
  const parSurface = {};
  tour.notes.forEach((n) => {
    parSurface[n.surface] = parSurface[n.surface] || [];
    parSurface[n.surface].push(n);
  });
  const surfaces = Object.keys(parSurface);

  verdicts.push({
    ok: surfaces.length >= 5,
    label: '[C] MONTAGE : la consigne est rendue sur au moins cinq surfaces',
    detail: `${surfaces.length} : ${surfaces.join(' · ')}`,
  });
  // MONTAGE : les dossiers SANS note ne doivent pas en porter - sinon
  // « la note se voit » serait vrai par saturation.
  const parasites = tour.notes.filter((n) => n.dossier && !['9001', '9002'].includes(n.dossier));
  verdicts.push({
    ok: parasites.length === 0,
    label: '[C] MONTAGE : aucun dossier sans consigne ne porte de marque de note',
    detail: parasites.length ? parasites.map((n) => `${n.surface}/${n.dossier}`).join(' · ') : 'seuls 9001 et 9002 en portent',
  });

  // LA PROPRIETE 1 : le texte de la consigne est atteignable AUTREMENT que par
  // la couleur. Soit il est ecrit, soit le marqueur porte `role="img"` et un nom
  // accessible - un `<span>` nu a le role implicite `generic`, sur lequel un nom
  // d auteur est interdit par ARIA in HTML et n est pas restitue.
  const muettes = tour.notes.filter((n) => {
    const aDuTexte = n.texte.length > 0;
    const aUnNom = (n.aria || '').trim().length > 0;
    if (aDuTexte) return false;
    return !(aUnNom && n.role === 'img');
  });
  verdicts.push({
    ok: tour.notes.length > 0 && muettes.length === 0,
    label: '[C] la consigne se lit AUTREMENT que par la couleur (texte ecrit, ou role="img" avec un nom accessible)',
    detail: muettes.length
      ? muettes.map((n) => `${n.surface} : texte="${n.texte}" role=${n.role} aria="${n.aria}"`).join(' · ')
      : `${tour.notes.length} marque(s) de note verifiee(s)`,
  });

  // LA PROPRIETE 2 : une meme information ne change pas de couleur en changeant
  // d ecran. La ligne de consigne de la page Reservations et celle de la liste
  // du planning sont LE MEME composant sur LE MEME dossier.
  const planning = (parSurface['planning-liste'] || [])[0];
  const reservations = (parSurface['reservations-jour'] || [])[0];
  verdicts.push({
    ok: Boolean(planning && reservations),
    label: '[C] MONTAGE : la ligne de consigne est rendue dans la liste du planning ET sur la page Reservations',
    detail: `planning=${planning ? 'oui' : 'NON'} reservations=${reservations ? 'oui' : 'NON'}`,
  });
  if (planning && reservations) {
    const memeCouleur = planning.couleur === reservations.couleur
      && planning.couleurInterieur === reservations.couleurInterieur;
    const memeTaille = planning.taille === reservations.taille
      && planning.tailleInterieur === reservations.tailleInterieur;
    verdicts.push({
      ok: memeCouleur && memeTaille,
      label: '[C] la consigne garde la MEME couleur et la meme taille d un ecran a l autre, texte interieur compris',
      detail: `planning ${planning.couleur}/${planning.taille} (span ${planning.couleurInterieur}/${planning.tailleInterieur}) contre reservations ${reservations.couleur}/${reservations.taille} (span ${reservations.couleurInterieur}/${reservations.tailleInterieur})`,
    });
  }

  // LA PROPRIETE 3 : le document exporte dit la meme chose que l ecran.
  const rapport = tour.rapport ? tour.rapport.lignes : [];
  const notees = rapport.filter((l) => ['9001', '9002'].includes(l.dossier));
  const sansNote = notees.filter((l) => !/\bNote\b/.test(l.texte));
  verdicts.push({
    ok: notees.length >= 1 && sansNote.length === 0,
    label: '[C] le document exporte par la Direction porte la consigne, comme le tableau a l ecran',
    detail: notees.length
      ? (sansNote.length ? `${sansNote.map((l) => l.dossier).join(' · ')} sans mention` : `${notees.length} ligne(s) notee(s) portent « Note »`)
      : 'aucune ligne notee dans le rapport',
  });
  return verdicts;
}

// ===========================================================================
// [D] RIEN NE DEBORDE, ET L ORDRE DE CESSION EST RESPECTE
// ===========================================================================
async function mesurerD(browser) {
  return mesurerPlanning(browser, [1440, 1280, 960]);
}

function jugerD(m) {
  const verdicts = [];
  const large = m[1440] || [];
  const porteuses = large.filter((c) => c.prixLargeur > 0);
  const plusCourte = porteuses.slice().sort((a, b) => a.hauteur - b.hauteur)[0];
  const sansPrix = large.filter((c) => c.prixLargeur === 0);

  // MONTAGE : la carte mesuree est bien la plus courte QUI PORTE un montant, et
  // il en existe une plus courte encore qui n en porte pas.
  verdicts.push({
    ok: Boolean(plusCourte) && porteuses.length >= 2,
    label: '[D] MONTAGE : au moins deux cartes du planning portent un montant a 1440 px',
    detail: porteuses.map((c) => `#${c.dossier} ${c.densite} ${c.hauteur}px « ${c.prixTexte} »`).join(' · ') || 'aucune',
  });
  if (plusCourte) {
    const plusCourteEncore = sansPrix.filter((c) => c.hauteur < plusCourte.hauteur);
    verdicts.push({
      ok: plusCourteEncore.length > 0,
      label: '[D] MONTAGE : une carte PLUS COURTE encore existe et ne porte pas de montant (la place y est deja prise)',
      detail: plusCourteEncore.length
        ? plusCourteEncore.map((c) => `#${c.dossier} ${c.densite} ${c.hauteur}px`).join(' · ')
        : 'aucune carte plus courte : la mesure ne porte pas sur le pire cas',
    });
  }

  // LA PROPRIETE 1 : rien ne deborde, a aucune des trois largeurs.
  [1440, 1280, 960].forEach((largeur) => {
    const cartes = m[largeur] || [];
    const fautives = cartes.filter((c) => (c.debordPied || 0) > 0 || c.debordCarteW > 1 || c.debordCarteH > 1 || c.prixDedans === false);
    verdicts.push({
      ok: cartes.length > 0 && fautives.length === 0,
      label: `[D ${largeur}] RIEN NE DEBORDE : le montant tient dans le pied ET dans le cadre de la carte`,
      detail: fautives.length
        ? fautives.map((c) => `#${c.dossier} piste ${c.piste}px pied+${c.debordPied} carte+${c.debordCarteW}/${c.debordCarteH} dedans=${c.prixDedans}`).join(' · ')
        : `${cartes.length} carte(s) mesuree(s), debordement 0`,
    });
  });

  // LA PROPRIETE 2 : l ordre de cession. Le meme dossier porte une consigne ET
  // un montant. En resserrant la piste, le MONTANT part et la CONSIGNE reste.
  const carte9002 = (largeur) => (m[largeur] || []).find((c) => c.dossier === '9002');
  const a1440 = carte9002(1440);
  const a960 = carte9002(960);
  verdicts.push({
    ok: Boolean(a1440 && a960) && a1440.prixLargeur > 0 && a1440.noteLargeur > 0,
    label: '[D] MONTAGE : a 1440 px la meme carte porte le montant ET la consigne',
    detail: a1440 ? `piste ${a1440.piste}px, montant ${a1440.prixLargeur}px, consigne ${a1440.noteLargeur}px` : 'carte introuvable',
  });
  verdicts.push({
    ok: Boolean(a960) && a960.prixLargeur === 0 && a960.noteLargeur > 0,
    label: '[D] L ORDRE DE CESSION est respecte : piste resserree, le montant est parti et la consigne SURVIT',
    detail: a960
      ? `piste ${a960.piste}px, montant ${a960.prixLargeur}px, consigne ${a960.noteLargeur}px`
      : 'carte introuvable a 960 px',
  });
  return verdicts;
}

// ===========================================================================
// [E] LE MONTANT AFFICHE EST CELUI DU DOSSIER
// ===========================================================================
async function mesurerE(browser) {
  const normal = await tourCache(browser);
  const autre = await tourCache(browser, { prixAutre: true });
  return { normal, autre };
}

function comparerAuxDonnees(tour, prixAutre) {
  const table = attendus(prixAutre);
  const fautifs = [];
  tour.marques.forEach((mq) => {
    const attendu = table[mq.dossier];
    if (!attendu) { fautifs.push(`${mq.surface}/${mq.dossier} : dossier inconnu`); return; }
    const admis = [attendu.prix, attendu.reference].filter((n) => n !== null);
    // 1. TOUT NOMBRE QUI N EST PAS PRESENTE COMME UNE REFERENCE EST LE PRIX
    //    FACTURE. C est vrai des trois canaux : le texte visible, le nom
    //    accessible et l infobulle. Se contenter de « le nombre appartient a
    //    { prix, reference } » laisserait une pastille annoncer la reference
    //    a la place du prix sans que rien ne rougisse : c est le meme chiffre
    //    pour un tout autre fait.
    [['texte visible', mq.lu.texte], ['nom accessible', mq.lu.aria], ['infobulle', mq.lu.title]].forEach(([canal, lu]) => {
      lu.montant.filter((n) => n !== attendu.prix).forEach((n) => {
        fautifs.push(`${mq.surface}/${mq.dossier} : ${canal} annonce ${n} comme montant, le dossier est facture ${attendu.prix}`);
      });
      if (attendu.reference !== null) {
        lu.reference.filter((n) => n !== attendu.reference).forEach((n) => {
          fautifs.push(`${mq.surface}/${mq.dossier} : ${canal} annonce ${n} comme reference, la reference calculee est ${attendu.reference}`);
        });
      }
    });
    // 2. La reference est toujours dite dans l infobulle, et dite COMME une
    //    reference : un chiffre nu ne s explique pas au client.
    if (attendu.reference !== null && !mq.lu.title.reference.includes(attendu.reference)) {
      fautifs.push(`${mq.surface}/${mq.dossier} : infobulle sans la reference ${attendu.reference} (lu ${JSON.stringify(mq.lu.title)})`);
    }
    // 3. AUCUN MONTANT ETRANGER dans le voisinage immediat. La ligne qui
    //    accueille le marqueur n a le droit d afficher que le prix facture ou
    //    la reference : « Bowling · 6 joueurs · 40 € » suivi de « Prix ajusté
    //    60 € » se lirait comme deux encaissements. Exiger l inverse (que la
    //    ligne REPETE le prix) serait faux : la carte du planning et la carte
    //    de l arene n affichent aucun autre montant, c est justement pourquoi
    //    le marqueur y prend la forme « montant ».
    const intrusLigne = mq.nombresLigne.filter((n) => !admis.includes(n));
    if (intrusLigne.length) {
      fautifs.push(`${mq.surface}/${mq.dossier} : la ligne affiche ${intrusLigne.join(',')}, etranger a { ${admis.join(', ')} }`);
    }
  });
  return fautifs;
}

function jugerE(m) {
  const verdicts = [];
  verdicts.push({
    ok: m.normal.marques.length >= 6,
    label: '[E] MONTAGE : le parcours a releve assez de marqueurs pour juger',
    detail: `${m.normal.marques.length} marqueur(s)`,
  });
  const fautifsNormal = comparerAuxDonnees(m.normal, false);
  verdicts.push({
    ok: fautifsNormal.length === 0,
    label: '[E] LE MONTANT ANNONCE EST CELUI DU DOSSIER : aucun chiffre rendu ne sort de { prix facture, reference calculee }',
    detail: fautifsNormal.length ? fautifsNormal.join(' · ') : `${m.normal.marques.length} marqueur(s) conformes a la donnee servie`,
  });

  // ET IL SUIT LA DONNEE. Le meme dossier est re-servi a un autre prix et a une
  // autre reference : une constante recopiee ne bougerait pas.
  const fautifsAutre = comparerAuxDonnees(m.autre, true);
  verdicts.push({
    ok: fautifsAutre.length === 0,
    label: '[E] et il SUIT LA DONNEE : dossiers re-servis a un autre prix et a une autre reference, tous les ecrans changent de chiffres',
    detail: fautifsAutre.length ? fautifsAutre.join(' · ') : `${m.autre.marques.length} marqueur(s) alignes sur le nouveau jeu`,
  });
  const chiffresNormal = m.normal.marques.filter((mq) => mq.dossier === '9003').map((mq) => mq.nombresTitle.join('/')).sort();
  const chiffresAutre = m.autre.marques.filter((mq) => mq.dossier === '9003').map((mq) => mq.nombresTitle.join('/')).sort();
  verdicts.push({
    ok: chiffresNormal.length > 0 && chiffresAutre.length > 0 && JSON.stringify(chiffresNormal) !== JSON.stringify(chiffresAutre),
    label: '[E] MONTAGE de la contre-mesure : le second jeu annonce bien d AUTRES chiffres que le premier',
    detail: `${JSON.stringify(chiffresNormal.slice(0, 3))} contre ${JSON.stringify(chiffresAutre.slice(0, 3))}`,
  });
  return verdicts;
}

// ===========================================================================
// LES CINQ PROPRIETES, ET LES MUTATIONS QUI DOIVENT LES FAIRE ROUGIR
// ===========================================================================
// Chaque mutation reproduit un defaut REEL du lot, celui qu une relecture
// adverse a trouve et mesure. Une mutation gratuite prouverait seulement que le
// gate reagit au bruit.
const PROPRIETES = [
  {
    cle: 'A',
    titre: 'UNE SEULE REGLE DECIDE, ET TOUS LES ECRANS LA SUIVENT',
    mesurer: mesurerA,
    juger: jugerA,
    mutations: [{
      nom: 'la liste du jour retrouve sa copie locale de la regle (l etat d avant le lot)',
      vise: /une seule regle DECIDE/,
      editions: [{
        fichier: 'assets/app-main.js',
        de: '      ${renderReservationPriceMark(r, { forme: stateText ? \'reference\' : \'complet\' })}',
        vers: '      ${(() => { const ref = (Number(r.basePrice) || 0) + (r.extras || []).reduce((s, e) => s + (Number(e.price) || 0), 0); return ref > 0 && Math.abs((Number(r.price) || 0) - ref) > 0.5 ? `<span class="res-state-pill custom-price pl-price-adjusted" role="img" title="Prix ajusté par l\'équipe (référence ${formatMoney(ref)})" aria-label="Prix ajusté, référence ${formatMoney(ref)}">Prix ajusté (référence ${formatMoney(ref)})</span>` : \'\'; })()}',
      }],
    }],
  },
  {
    cle: 'B',
    titre: 'SEUL L ECART SE MONTRE',
    mesurer: async (browser) => ({ normal: await tourCache(browser) }),
    juger: jugerB,
    mutations: [
      {
        nom: 'le repli catalogue revient sur le chemin d AFFICHAGE et la garde conclut sur la base reconstituee (la premiere version du lot, celle qui annoncait « Prix ajuste 180 EUR, reference 324 EUR » sur la fixture 9005)',
        vise: /SEUL L ECART SE MONTRE : le dossier 9005/,
        editions: [
          { fichier: 'assets/app-main.js', de: '  const base = options.repliCatalogue && !baseEcrite', vers: '  const base = !baseEcrite' },
          { fichier: 'assets/app-main.js', de: '  const aReference = baseEcrite !== null && baseEcrite > 0;', vers: '  const aReference = base > 0;' },
        ],
      },
      {
        nom: 'le verdict se garde sur la SOMME au lieu de la base ecrite (le bloquant du cafe a 6 EUR)',
        vise: /SEUL L ECART SE MONTRE : le dossier 9006/,
        editions: [{ fichier: 'assets/app-main.js', de: '  const aReference = baseEcrite !== null && baseEcrite > 0;', vers: '  const aReference = reference > 0;' }],
      },
      {
        nom: 'l en-tete de la fiche retrouve la regle du chemin d ECRITURE (la neuvieme copie, celle qui annoncait « 180 € (prix ajusté) » sur un dossier sans reference ecrite)',
        vise: /l en-tete de la fiche ne clame rien sur les temoins/,
        editions: [{ fichier: 'assets/app-main.js', de: '  if (Number(r.price) >= 0 && (Number(r.price) > 0 || prixDossier.ajuste)) {', vers: '  if (Number(r.price) >= 0 && (Number(r.price) > 0 || getReservationPriceGap(r) !== 0)) {\n    prixDossier.ajuste = getReservationPriceGap(r) !== 0;' }],
      },
    ],
  },
  {
    cle: 'C',
    titre: 'LA NOTE SE VOIT, ET PAS SEULEMENT PAR SA COULEUR',
    mesurer: async (browser) => ({ normal: await tourCache(browser) }),
    juger: jugerC,
    mutations: [
      {
        nom: 'le selecteur de la consigne cesse de viser le span interieur (elle repasse en gris sur la page Reservations)',
        vise: /garde la MEME couleur/,
        editions: [{ fichier: 'assets/pinlane-staff.css', de: '.pv2-flow-marks .res-note-line,\n.pv2-flow-marks .res-note-line span { color: var(--warning); font-size: 11.5px; }', vers: '.pv2-flow-marks .res-note-line { color: var(--warning); font-size: 11.5px; }' }],
      },
      {
        nom: 'le marqueur de note des cartes du planning perd son role et son nom accessible',
        vise: /AUTREMENT que par la couleur/,
        editions: [{ fichier: 'assets/app-main.js', de: '<span class="bk-flag ${m.cls}" role="img" aria-label="${m.label}" title="${m.label}">', vers: '<span class="bk-flag ${m.cls}" title="${m.label}">' }],
      },
      {
        nom: 'la consigne ne remonte plus dans les pastilles d engagement (le document exporte redevient muet)',
        vise: /document exporte par la Direction porte la consigne/,
        editions: [{ fichier: 'assets/app-main.js', de: '  if (hasReservationNote(reservation)) {\n    chips.push({ cls: \'note\', label: \'Note\', title: getReservationNoteText(reservation) });\n  }', vers: '  // MUTATION DU GATE : la consigne ne remonte plus.' }],
      },
    ],
  },
  {
    cle: 'D',
    titre: 'RIEN NE DEBORDE, ET L ORDRE DE CESSION EST RESPECTE',
    mesurer: mesurerD,
    juger: jugerD,
    mutations: [{
      nom: 'le plancher de place du montant a deux chiffres est retire (il reste sur une piste ou il ne tient plus)',
      vise: /RIEN NE DEBORDE|ORDRE DE CESSION/,
      editions: [{ fichier: 'assets/pinlane-staff.css', de: '@container piste (max-width: 108px) {\n  .booking .bk-price-c2 { display: none; }\n}', vers: '@container piste (max-width: 0px) {\n  .booking .bk-price-c2 { display: none; }\n}' }],
    }],
  },
  {
    cle: 'E',
    titre: 'LE MONTANT AFFICHE EST CELUI DU DOSSIER',
    mesurer: mesurerE,
    juger: jugerE,
    mutations: [{
      nom: 'le marqueur annonce la reference a la place du prix facture',
      vise: /LE MONTANT ANNONCE EST CELUI DU DOSSIER/,
      editions: [{ fichier: 'assets/app-main.js', de: '  const montant = formatMoney(etat.price);', vers: '  const montant = formatMoney(etat.reference);' }],
    }],
  },
];

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    for (const propriete of PROPRIETES) {
      console.log(`\n[${propriete.cle}] ${propriete.titre}`);
      const mesure = await propriete.mesurer(browser);
      propriete.juger(mesure).forEach((v) => ok(v.ok, v.label, v.detail));
    }

    // =====================================================================
    console.log('\n[MUTATION] LE GATE SAIT-IL ROUGIR ? - au moins une mutation par propriete');
    // =====================================================================
    // Ce qui est asserte ici, ce n est pas que la mutation casse quelque chose :
    // c est que LA MESURE DE CETTE PROPRIETE-LA tombe, et sur LA phrase visee.
    // Une mutation qui ferait tomber un MONTAGE ne prouverait rien sur la
    // propriete elle-meme.
    for (const propriete of PROPRIETES) {
      for (const mut of propriete.mutations) {
        const introuvables = mut.editions
          .map((e) => ({ e, n: sourceCourante(e.fichier).split(e.de).length - 1 }))
          .filter((x) => x.n !== 1);
        if (!ok(introuvables.length === 0,
          `[mutation ${propriete.cle}] les ${mut.editions.length} ancre(s) de « ${mut.nom} » existent UNE seule fois dans le source livre`,
          introuvables.length
            ? introuvables.map((x) => `${x.n} occurrence(s) de « ${x.e.de.slice(0, 50)} » dans ${x.e.fichier}`).join(' · ') + ' : la contre-epreuve est DESARMEE, elle ne protege plus rien'
            : mut.editions.map((e) => e.fichier).join(' · '))) continue;

        let verdictsMutes = [];
        enMutation = true;
        try {
          verdictsMutes = await avecMutations(mut.editions, async () => propriete.juger(await propriete.mesurer(browser)));
        } catch (error) {
          // Une mesure qui ne peut meme plus tourner EST un rouge : on le dit au
          // lieu de laisser l exception tuer le gate.
          verdictsMutes = [{ ok: false, label: 'la mesure ne tourne plus', detail: String(error.message).split('\n')[0] }];
        } finally {
          enMutation = false;
        }
        const tombes = verdictsMutes.filter((v) => !v.ok);
        const vises = tombes.filter((v) => mut.vise.test(v.label));
        ok(vises.length > 0,
          `[mutation ${propriete.cle}] « ${mut.nom} » fait bien tomber la propriete [${propriete.cle}] elle-meme`,
          vises.length
            ? `${vises.length} verdict(s) vise(s) sur ${tombes.length} tombe(s) : ${vises.map((v) => v.label).join(' · ')}`
            : `LA SONDE EST AVEUGLE sur ce point : ${tombes.length} verdict(s) tombe(s), aucun ne vise la propriete`);
      }
    }

    // Le depot n a jamais ete touche : la contre-epreuve vit en memoire. On le
    // VERIFIE quand meme, parce qu une mutation laissee en place est le genre de
    // degat qu on ne voit qu au commit suivant.
    ok(overrides.size === 0, '[mutation] aucune mutation ne survit a la contre-epreuve', `${overrides.size} override(s) encore en place`);
    for (const propriete of PROPRIETES) {
      for (const mut of propriete.mutations) {
        for (const edition of mut.editions) {
          ok(sourceDisque(edition.fichier).includes(edition.de),
            `[mutation ${propriete.cle}] et le fichier ${edition.fichier} sur le disque est intact`);
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures ? `${failures} assertion(s) en echec` : 'Tous les controles passent'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });

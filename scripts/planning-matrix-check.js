// Gate Playwright - LE PLANNING A TOUTE TAILLE.
//
// Pourquoi ce gate existe : « le planning, il y a plein de moments ou on ne voit
// pas toutes les infos, quand on agrandit et quand on agrandit plus, F11 aussi ;
// des fois c'est coupe, bug graphique avec les cartes » (Movsar, 2026-08-13).
// Une passe faite a UNE largeur ne prouve rien : le meme ecran casse a 1280 px
// et tient a 1920, et le zoom du navigateur (67 % -> 200 %) change la taille du
// viewport en pixels CSS, exactement comme F11 combine au zoom.
//
// CE QU'IL BALAYE (matrice, pas une largeur) :
//   - 6 ecrans physiques de 1024x768 a 2560x1440
//   - 6 niveaux de zoom navigateur : 67, 80, 100, 125, 150, 200 %
//     (viewport CSS = taille physique / zoom : c'est la definition du zoom)
//   - 3 tailles de centre : 4 pistes (capture Movsar), 8 pistes (defaut),
//     40 pistes (le MAXIMUM que l'ecran Etablissement autorise, min=1 max=40)
//   - 3 modes : fenetre, fenetre + planning agrandi, F11 + planning agrandi
//
// CE QU'IL MESURE (personne ne juge a l'oeil) :
//   1. debordement : une boite dont le rectangle sort de son conteneur clippant
//   2. texte tronque SANS strategie de troncature (ni ellipse ni line-clamp)
//   3. contenu ecrase : scrollHeight/scrollWidth > la carte qui le contient
//   4. chevauchement de cartes dont les creneaux, eux, ne se chevauchent pas
//   5. carte plus etroite que son contenu minimum (le « qui » ne tient plus)
//   6. colonne coupee au bord droit sans possibilite de defiler
//   7. defilement horizontal involontaire de la PAGE
//   8. barre d'heure et en-tete de piste ecrases ou illisibles
//   9. ligne « maintenant » desalignee ou peinte par-dessus la colonne d'heures
//  10. en-tetes qui decrochent quand la grille defile
//  11. contraste WCAG AA mesure dans les DEUX themes
//
// Usage : node scripts/planning-matrix-check.js [--fast]
//   --fast : sous-ensemble (3 ecrans x 3 zooms) pour une boucle de dev rapide.
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_MATRIX_PORT || 4203);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FAST = process.argv.includes('--fast');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Ecrans physiques reels. La hauteur compte autant que la largeur : le mode
// plein ecran calcule la hauteur de ligne a partir de la place disponible.
const SCREENS = FAST
  ? [{ w: 1024, h: 768 }, { w: 1440, h: 900 }, { w: 2560, h: 1440 }]
  : [{ w: 1024, h: 768 }, { w: 1280, h: 800 }, { w: 1440, h: 900 }, { w: 1600, h: 900 }, { w: 1920, h: 1080 }, { w: 2560, h: 1440 }];
const ZOOMS = FAST ? [0.67, 1, 2] : [0.67, 0.8, 1, 1.25, 1.5, 2];
const LANE_COUNTS = [4, 8, 40];
// chrome = hauteur volee par la barre d'onglets + la barre d'adresse (mesuree
// sur Edge : ~120 px). F11 la rend a la page, c'est tout ce que F11 change.
const MODES = [
  { key: 'fenetre', label: 'fenetre', chrome: 120, expanded: false },
  { key: 'fenetre-agrandi', label: 'fenetre + agrandi', chrome: 120, expanded: true },
  { key: 'f11-agrandi', label: 'F11 + agrandi', chrome: 0, expanded: true },
];

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
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

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'clients.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const openWeek = { '0': { open: '10:00', close: '24:00' }, '1': { open: '10:00', close: '24:00' }, '2': { open: '10:00', close: '24:00' }, '3': { open: '10:00', close: '24:00' }, '4': { open: '10:00', close: '24:00' }, '5': { open: '10:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } };
    window.__LANE_COUNT__ = 8;
    const centerFor = (id) => ({
      id, name: 'Centre QA', status: 'active', timezone: 'Europe/Brussels',
      resources: {
        bowling: { laneCount: window.__LANE_COUNT__, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8, preferAdjacentLanes: true },
        laser: { weaponCount: 24, parallelLaunches: 1, canSplitGroupsCleanly: false, requiresCompleteGroupBeforeLaunch: true, riskLevel: 'critical' },
        partyTables: null,
      },
      defaultSchedule: { regular: openWeek, holiday: {} },
      activityAvailability: {}, holidaySettings: { enabled: false, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {}, classification: {}, customActivities: [],
    });
    // Jeu de cartes volontairement HOSTILE : noms longs et courts, durees 30 min
    // (le pire cas de hauteur), 1 h, 1 h 30 et 2 h, gros effectifs (pastille
    // large), notes (tag « Note a lire »), statuts varies. Une carte lisible a
    // 4 pistes doit rester lisible a 40.
    const NAMES = [
      'Anniversaire Marie-Charlotte Vanderstraeten',
      'Ka',
      'Comite d entreprise Delhaize Libramont',
      'Groupe Dupont',
      'Ecole communale Saint-Joseph 3e primaire',
      'Yan',
    ];
    const DURATIONS = [0.5, 1, 1.5, 2];
    const STATUSES = ['pending', 'arrived', 'paid'];
    const build = (date) => {
      const rows = [];
      const lanes = window.__LANE_COUNT__;
      for (let lane = 1; lane <= lanes; lane += 1) {
        const slots = [11 + (lane % 3) * 0.5, 15 + (lane % 4) * 0.5, 20 + (lane % 2) * 0.5];
        slots.forEach((startDec, index) => {
          const seed = lane * 3 + index;
          const duration = DURATIONS[seed % DURATIONS.length];
          const hh = Math.floor(startDec);
          const mm = startDec % 1 ? '30' : '00';
          rows.push({
            id: 90000 + seed,
            name: `${NAMES[seed % NAMES.length]} #${90000 + seed}`,
            phone: '+3247086' + String(1000 + seed),
            email: `qa${seed}@x.test`,
            date,
            startTime: `${String(hh).padStart(2, '0')}:${mm}`,
            duration,
            lanes: [lane],
            status: STATUSES[seed % STATUSES.length],
            pax: 2 + (seed % 11),
            price: 20 + seed,
            type: 'bowling',
            // Le libelle que la PROD sert vraiment. Il valait « Bowling » ici,
            // huit caracteres qui tenaient partout : le gate ne voyait donc
            // jamais le defaut que Movsar a vu en prod, « Bowling Classique »
            // coupe en « Bowl… ». Une donnee de test plus courte que la vraie
            // ne teste rien. Chaine vide = getReservationLabel retombe sur le
            // defaut metier, exactement comme une reservation sans formule.
            label: '',
            // UNE DONNEE DE TEST SANS FORMULE NE TESTE PAS LA CARTE DE FORMULE,
            // et c'est precisement celle que Movsar reclamait le 2026-08-14
            // (« on voit pas formule »). Depuis que la carte ecrit L'OFFRE au
            // lieu de l'activite evidente, un jeu 100 % bowling sans formule ne
            // produit AUCUNE etiquette : la contre-epreuve du masquage n'avait
            // alors plus rien a masquer et passait au vert en ne voyant rien.
            // Un tiers des dossiers porte donc une formule, comme un vrai
            // samedi, ce qui donne aussi le libelle le plus long a loger
            // (« FORMULE 5 · Laser x2 », 20 caracteres contre 7 pour « Bowling »).
            // PAS DE FORMULE ICI, ET C'EST DELIBERE : ce fichier est un fixture
            // PARTAGE, `reservation-sheet-check` en extrait son faux centre. Une
            // formule y fait ouvrir une fiche de formule, plus haute et plus
            // fournie que la fiche simple sur laquelle ses plafonds ont ete
            // mesures (741px pour un plafond de 560). La contre-epreuve du
            // masquage n'en a plus besoin depuis qu'elle mute aussi la duree,
            // dont la largeur ne depend d'aucun conteneur.
            notes: seed % 5 === 0 ? 'Gateau a sortir a la fin de la partie' : '',
          });
        });
      }
      return rows;
    };
    const laneStatuses = () => Array.from({ length: 40 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    // UN SERVEUR NE CHANGE PAS D ETAG QUAND RIEN N A BOUGE. La console lit
    // l ETag avant payload.revision et re-rend des qu il change : un etag
    // horodate faisait re-rendre la console A CHAQUE SONDAGE, et un re-rendu qui
    // tombe pendant un geste detruit la carte tiree ou remet le defilement a
    // zero. Le vrai /api/staff-state pose ETag = snapshot.revision : ici l etag
    // est l empreinte du contenu servi, meme contenu donc meme etag.
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || new Date().toISOString().slice(0, 10); return J({ ok: true, revision: `qa-${d}`, reservations: build(d), laneStatuses: laneStatuses(), centerId: 'libramont' }); }
      // Les notes client internes (API du 2026-10-05, journal Pinlane 378) : la
      // console les precharge pour chaque carte. Absente d ici, elle repondait
      // 404 et tous les gates qui prennent ce mock rougissaient sur « aucune
      // erreur console ». Meme forme que lib/customer-notes.js : chaque dossier
      // a un client, aucun n a encore de note.
      if (u.pathname === '/api/staff-customer-notes' && String(init.method || 'GET').toUpperCase() === 'GET') {
        const sansNote = (id) => ({ eligible: true, clientKey: `p:qa${id}`, note: null });
        const lot = u.searchParams.get('reservationIds');
        if (lot !== null) return J({ ok: true, notesByReservationId: Object.fromEntries(lot.split(',').filter(Boolean).map((id) => [String(Number(id)), sansNote(Number(id))])) });
        return J({ ok: true, ...sansNote(Number(u.searchParams.get('reservationId'))) });
      }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: null });
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        if (action === 'centerConfig') return J({ ok: true, centers: [centerFor(u.searchParams.get('centerId') || 'libramont')], activities: [] });
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      }
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || new Date().toISOString().slice(0, 10); return J({ ok: true, reservations: build(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      return nativeFetch(input, init);
    };
    window.__QA_BUILD__ = build;
    window.__QA_LANES__ = laneStatuses;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

// ---------------------------------------------------------------------------
// L'AUDITEUR, injecte dans la page. Il ne juge rien : il mesure des rectangles.
// ---------------------------------------------------------------------------
const AUDITOR = String.raw`
window.__PLANNING_AUDIT__ = function (ctx) {
  const out = [];
  const seen = new Set();
  const add = (kind, detail) => {
    const key = kind + '||' + detail;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, detail });
  };
  const R = (el) => el.getBoundingClientRect();
  const num = (v) => Math.round(v * 10) / 10;
  const wrap = document.getElementById('planningGridWrap');
  if (!wrap) { add('grille-absente', 'planningGridWrap introuvable'); return out; }
  const grid = wrap.querySelector('.planning-grid');
  if (!grid) { add('grille-absente', 'aucune .planning-grid rendue'); return out; }
  const lanes = [...grid.querySelectorAll('.lane-col')];
  if (!lanes.length) { add('grille-absente', 'aucune piste rendue'); return out; }
  const hourCol = grid.querySelector('.hour-col');
  const wrapRect = R(wrap);

  const visible = (el) => {
    const r = R(el);
    if (r.width < 0.5 || r.height < 0.5) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };

  // Rectangle de clip DUR : on ne compte que les ancetres qui coupent SANS
  // pouvoir defiler. Un conteneur qui defile ne perd rien, il range : compter
  // son bord comme une coupure ferait rougir tout ce qui est sous la ligne de
  // flottaison d'une liste parfaitement saine.
  const hardClip = (el) => {
    const r = { top: -Infinity, left: -Infinity, right: Infinity, bottom: Infinity };
    let stopY = false;
    let stopX = false;
    let p = el.parentElement;
    while (p && p !== document.body && !(stopY && stopX)) {
      const cs = getComputedStyle(p);
      const pr = R(p);
      const scrollsY = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 1;
      const scrollsX = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1;
      if (!stopY) {
        if (scrollsY) stopY = true;
        else if (cs.overflowY === 'hidden' || cs.overflowY === 'clip') { r.top = Math.max(r.top, pr.top); r.bottom = Math.min(r.bottom, pr.bottom); }
      }
      if (!stopX) {
        if (scrollsX) stopX = true;
        else if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') { r.left = Math.max(r.left, pr.left); r.right = Math.min(r.right, pr.right); }
      }
      p = p.parentElement;
    }
    return r;
  };

  // 1. defilement horizontal involontaire de la PAGE : mesure par l'ACTE, pas
  // par la taille du contenu. Un debordement qu'on ne peut pas atteindre n'en
  // est pas un ; ce qu'on interdit, c'est de pouvoir faire glisser la page.
  const scroller = document.scrollingElement || document.documentElement;
  const beforeX = scroller.scrollLeft;
  const overflowX = scroller.scrollWidth - scroller.clientWidth;
  scroller.scrollLeft = 80;
  const movedX = scroller.scrollLeft;
  scroller.scrollLeft = beforeX;
  // Les DEUX conditions : la page contient plus large que son cadre ET on peut
  // reellement la faire glisser. Une seule des deux se declenche sur du bruit
  // de rendu ; les deux ensemble decrivent ce que l'utilisateur subit.
  if (movedX > 1 && overflowX > 1) {
    // Nomme le coupable, sinon la correction se cherche a l'aveugle : le plus
    // profond des elements dont le bord droit sort du cadre.
    // Le bord droit VISIBLE : un rectangle deja coupe par un ancetre qui defile
    // ne pousse pas la page. On intersecte donc avec tous les ancetres qui
    // coupent, quel que soit leur mode.
    const visibleRight = (el) => {
      let right = R(el).right;
      let p = el.parentElement;
      while (p && p !== document.documentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible') right = Math.min(right, R(p).right);
        p = p.parentElement;
      }
      return right;
    };
    const tag = (el) => (el.id ? '#' + el.id : '') + '.' + String(el.className || el.tagName).split(' ').join('.');
    let guilty = '';
    let worst = 1;
    document.querySelectorAll('body *').forEach((el) => {
      const er = R(el);
      if (er.width <= 0 || er.height <= 0) return;
      if (getComputedStyle(el).position === 'fixed') return;
      const excess = visibleRight(el) - scroller.clientWidth;
      if (excess > worst) {
        worst = excess;
        guilty = tag(el) + ' (+' + num(excess) + 'px)';
      }
    });
    if (!guilty) {
      // Personne ne depasse VISIBLEMENT : on trouve le sous-arbre coupable en
      // l'eteignant. C'est brutal, c'est court, et ca ne se trompe pas.
      const base = scroller.scrollWidth;
      const probe = (el) => {
        const prev = el.style.display;
        el.style.display = 'none';
        const w = scroller.scrollWidth;
        el.style.display = prev;
        return w;
      };
      let node = document.body;
      let path = [];
      for (let depth = 0; depth < 8; depth += 1) {
        let next = null;
        [...node.children].forEach((child) => {
          if (next) return;
          if (probe(child) < base - 2) next = child;
        });
        if (!next) break;
        path.push(tag(next));
        node = next;
      }
      guilty = path.length ? 'sous-arbre coupable : ' + path.join(' > ') : 'coupable non localise';
    }
    add('scroll-horizontal-page', 'la page glisse de ' + movedX + 'px (contenu ' + scroller.scrollWidth + ' > cadre ' + scroller.clientWidth + ') : ' + guilty);
  }

  // 2. par carte : contenu ecrase, debordement, hierarchie brisee
  const bookings = [...grid.querySelectorAll('.booking')].filter(visible);
  if (!bookings.length) add('aucune-carte', 'la grille ne rend aucune reservation');
  bookings.forEach((bk) => {
    const r = R(bk);
    // Nomme le coupable : l'enfant direct dont la boite de defilement depasse.
    const widest = () => {
      const parts = [];
      [...bk.children].forEach((c) => {
        parts.push((c.className || c.tagName) + ' sw' + c.scrollWidth + '/cw' + c.clientWidth + '/ow' + c.offsetWidth + '@' + c.offsetLeft);
      });
      return parts.join(' + ');
    };
    if (bk.scrollHeight > bk.clientHeight + 1) add('carte-contenu-ecrase', 'hauteur contenu ' + bk.scrollHeight + ' > carte ' + bk.clientHeight + ' (' + num(r.width) + 'x' + num(r.height) + ')');
    if (bk.scrollWidth > bk.clientWidth + 1) add('carte-contenu-deborde-largeur', 'largeur contenu ' + bk.scrollWidth + ' > carte ' + bk.clientWidth + ', le plus large : ' + widest());
    const lane = bk.closest('.lane-col');
    if (lane) {
      const lr = R(lane);
      if (r.bottom > lr.bottom + 1) add('carte-hors-piste', 'carte deborde de ' + num(r.bottom - lr.bottom) + 'px sous la colonne');
      if (r.right > lr.right + 1 || r.left < lr.left - 1) add('carte-hors-piste', 'carte deborde lateralement de la colonne');
    }
    // hierarchie : QUI (nom) doit toujours etre lisible. Un nom reduit a moins
    // de 4 caracteres visibles ne dit plus qui vient.
    const name = bk.querySelector('.booking-name');
    if (name && visible(name)) {
      const nr = R(name);
      const cs = getComputedStyle(name);
      const charW = parseFloat(cs.fontSize) * 0.55;
      if (nr.width < charW * 4) add('nom-illisible', 'nom large de ' + num(nr.width) + 'px (moins de 4 caracteres) sur carte ' + num(r.width) + 'px');
      const nclip = hardClip(name);
      if (nr.bottom > nclip.bottom + 1) add('nom-coupe-verticalement', 'nom coupe de ' + num(nr.bottom - nclip.bottom) + 'px (carte ' + num(r.width) + 'x' + num(r.height) + ')');
    }
  });

  // 3. texte tronque sans strategie de troncature
  const TEXT_SEL = '.booking-name, .booking .b-tag-text, .booking .bk-pax, .booking .bk-dur, .booking .reservation-tag, .booking .activity-pill, .lane-header .pl, .lane-header .num, .hour-cell, .planning-blocked span, .current-badge';
  [...grid.querySelectorAll(TEXT_SEL)].filter(visible).forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'inline') return;
    if (el.scrollWidth > el.clientWidth + 1) {
      const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      if (cs.textOverflow !== 'ellipsis' && !clamped) {
        add('texte-tronque-sans-ellipse', el.className + ' : ' + el.scrollWidth + ' > ' + el.clientWidth + ' (« ' + (el.textContent || '').trim().slice(0, 24) + ' »)');
      }
    }
    // hauteur de ligne qui ecrase le texte : la boite est plus courte que la
    // ligne de texte qu'elle contient.
    const fs = parseFloat(cs.fontSize) || 0;
    const rr = R(el);
    if (fs && rr.height > 0 && rr.height + 0.5 < fs) add('texte-ecrase-en-hauteur', el.className + ' : boite ' + num(rr.height) + 'px pour une police de ' + fs + 'px');
  });

  // 3 bis. AUCUN FRAGMENT DE MOT, quelle que soit la strategie de troncature.
  // Le detecteur ci-dessus ACCEPTAIT l ellipse : « une troncature annoncee est
  // une troncature honnete ». C est faux pour un element qui peut disparaitre.
  // Movsar, 2026-08-14, sur une capture en fenetre agrandie : « Camille Laurent
  // · Bowl… · ✓ · 6j · 1h ». « Bowl… » n apprend rien, il oblige a deviner.
  // Ces elements-la sont TOUS facultatifs : ils ont le droit de disparaitre,
  // donc ils n ont jamais le droit de s afficher a moitie. Le nom, lui, ne
  // disparait jamais : il garde son ellipse comme dernier recours, et c est
  // l assertion nom-illisible plus haut qui le protege.
  const ENTIER_SEL = '.booking .b-tag-text, .booking .bk-pax, .booking .bk-dur, .booking .reservation-tag, .booking .activity-pill';
  [...grid.querySelectorAll(ENTIER_SEL)].filter(visible).forEach((el) => {
    if (!(el.textContent || '').trim()) return;
    if (el.scrollWidth > el.clientWidth + 1) {
      add('mot-coupe', el.className + ' : « ' + (el.textContent || '').trim().slice(0, 24)
        + ' » rendu sur ' + el.clientWidth + 'px pour ' + el.scrollWidth + 'px de texte (entier ou absent, jamais un morceau)');
    }
  });

  // 4. chevauchement de cartes dont les creneaux ne se chevauchent pas
  const parseRange = (el) => {
    const raw = el.getAttribute('data-range') || '';
    const m = raw.match(/(\d{1,2})[:h](\d{2})\s*-\s*(\d{1,2})[:h](\d{2})/);
    if (!m) return null;
    return { start: Number(m[1]) + Number(m[2]) / 60, end: Number(m[3]) + Number(m[4]) / 60 };
  };
  lanes.forEach((lane) => {
    const cards = [...lane.querySelectorAll('.booking')].filter(visible);
    for (let i = 0; i < cards.length; i += 1) {
      for (let j = i + 1; j < cards.length; j += 1) {
        const a = R(cards[i]);
        const b = R(cards[j]);
        const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlap <= 1) continue;
        const ra = parseRange(cards[i]);
        const rb = parseRange(cards[j]);
        const timeOverlap = ra && rb ? Math.min(ra.end, rb.end) - Math.max(ra.start, rb.start) > 0.001 : true;
        if (!timeOverlap) add('chevauchement-cartes', 'deux cartes se superposent de ' + num(overlap) + 'px alors que leurs creneaux ne se croisent pas');
      }
    }
  });

  // 5. colonne coupee au bord droit sans possibilite de defiler
  const canScrollX = wrap.scrollWidth > wrap.clientWidth + 1;
  lanes.forEach((lane, index) => {
    const lr = R(lane);
    if (lr.width + 0.5 < 44) add('colonne-trop-etroite', 'piste ' + (index + 1) + ' large de ' + num(lr.width) + 'px');
    if (!canScrollX && lr.right > wrapRect.right + 1) add('colonne-coupee', 'piste ' + (index + 1) + ' depasse de ' + num(lr.right - wrapRect.right) + 'px sans defilement possible');
  });

  // 6. barre d'heure : lisible, non ecrasee, jamais coupee
  const hourCells = hourCol ? [...hourCol.querySelectorAll('.hour-cell')].filter(visible) : [];
  hourCells.forEach((cell) => {
    const span = cell.querySelector('span');
    if (!span) return;
    const sr = R(span);
    const cr = R(cell);
    const fs = parseFloat(getComputedStyle(cell).fontSize) || 0;
    if (sr.width > cr.width + 1) add('heure-coupee', 'label « ' + (span.textContent || '').trim() + ' » large de ' + num(sr.width) + ' dans une cellule de ' + num(cr.width));
    // Ecrasement REEL : la cellule est plus courte que la hauteur minimale d'une
    // ligne de texte (1,2 x la police). On ne compare pas a la boite de ligne,
    // qui vaut 1,55 x la police et deborderait sans qu'aucun glyphe soit coupe.
    if (fs && cr.height + 0.5 < fs * 1.2) add('heure-ecrasee', 'cellule de ' + num(cr.height) + 'px pour une police de ' + fs + 'px (minimum ' + num(fs * 1.2) + ')');
  });
  if (hourCol) {
    const hr = R(hourCol);
    if (hr.width + 0.5 < 34) add('colonne-heures-trop-etroite', 'colonne d heures large de ' + num(hr.width) + 'px');
  }

  // 7. en-tete de piste : lisible et collant
  lanes.forEach((lane, index) => {
    const head = lane.querySelector('.lane-header');
    if (!head || !visible(head)) { add('entete-piste-absent', 'piste ' + (index + 1)); return; }
    const hr = R(head);
    const numEl = head.querySelector('.num');
    if (numEl) {
      const nr = R(numEl);
      if (nr.right > hr.right + 1 || nr.left < hr.left - 1) add('entete-piste-coupe', 'numero de piste ' + (index + 1) + ' hors de son en-tete');
    }
  });

  // 8. ligne « maintenant »
  const line = grid.querySelector('.current-line');
  if (line && visible(line)) {
    const lr = R(line);
    const firstLane = R(lanes[0]);
    if (Math.abs(lr.left - firstLane.left) > 1.5) add('ligne-maintenant-desalignee', 'ligne a ' + num(lr.left) + ', premiere piste a ' + num(firstLane.left));
    if (hourCol) {
      const hr = R(hourCol);
      const zLine = Number(getComputedStyle(line).zIndex) || 0;
      const zHour = Number(getComputedStyle(hourCol).zIndex) || 0;
      if (lr.left < hr.right - 1 && zLine > zHour) add('ligne-maintenant-sur-colonne-heures', 'la ligne (z ' + zLine + ') passe par-dessus la colonne d heures (z ' + zHour + ')');
    }
    if (lr.right > wrapRect.right + 1 && !canScrollX) add('ligne-maintenant-coupee', 'la ligne depasse le cadre de ' + num(lr.right - wrapRect.right) + 'px');
  }

  // 9. INFORMATION MASQUEE ALORS QU ELLE TENAIT - le sens INVERSE, celui qui
  //    manquait. Les huit mesures ci-dessus ne savent voir qu un seul defaut :
  //    trop d information pour la place. Elles sont aveugles au defaut
  //    symetrique, et c est exactement celui que Movsar voit : une carte large
  //    de ~290px qui affiche « Camille Laurent · 6j · 1h » avec un grand vide
  //    au milieu, parce que le libelle d activite a saute alors qu il avait
  //    toute la place. Une echelle de degradation sans ce detecteur est un
  //    couteau a un seul tranchant : elle peut effacer une information utile a
  //    n importe quelle taille sans que rien ne rougisse.
  //
  //    ON NE JUGE PAS AU SEUIL, ON MESURE PAR L ACTE : on remet l element
  //    masque, et on regarde ce qui se passe vraiment. Il est masque a tort si
  //    les TROIS conditions tiennent en meme temps :
  //      a. la carte ne deborde pas (ni en largeur ni en hauteur) ;
  //      b. l element montre son texte en entier, ou au moins 4 caracteres ;
  //      c. PERSONNE AU-DESSUS DE LUI NE PAIE : ni le nom ni aucun rang
  //         superieur deja affiche ne perd un pixel quand on le remet.
  //    La condition (c) est celle qui compte, et elle a demande deux essais.
  //    Se contenter du plancher de 4 caracteres du nom faisait rougir le gate
  //    sur des cartes ou remettre la duree RETRECISSAIT le nom de 74 a 38px :
  //    la duree y tenait, mais elle tenait AUX DEPENS du rang au-dessus, ce qui
  //    est exactement ce que la hierarchie interdit. Un seuil de largeur
  //    partage est forcement un peu conservateur, puisque « 6j 1h » et
  //    « 12j 1h30 » n occupent pas la meme place ; ce que le detecteur doit
  //    interdire, ce n est pas cette prudence de quelques pixels, c est une
  //    regle qui efface une information alors que la place etait LIBRE.
  //    Les etiquettes (.reservation-tags) sont HORS de ce detecteur, et c est
  //    la seule exception, ecrite : leur contenu est deja porte ailleurs sur la
  //    meme carte (formule et duree = .b-tag et .bk-dur) ou dans la liste du
  //    jour, et le planning non agrandi les masque par decision produit, pas
  //    par manque de place.
  const NATURAL_DISPLAY = { 'booking-foot': 'flex', 'booking-stats': 'inline-flex', 'b-tag': 'block', 'bk-pax': 'inline-flex', 'bk-dur': 'inline-flex', 'bk-state': 'inline-flex' };
  const naturalDisplay = (el) => {
    const hit = Object.keys(NATURAL_DISPLAY).find((c) => el.classList.contains(c));
    return hit ? NATURAL_DISPLAY[hit] : 'block';
  };
  const minLegible = (el, chars) => {
    const fs = parseFloat(getComputedStyle(el).fontSize) || 11;
    return fs * 0.55 * chars;
  };
  // Rang dans la hierarchie de degradation, du premier qui saute au dernier.
  // L ORDRE EST CELUI DE LA HIERARCHIE ECRITE DANS LA CSS, du premier retire au
  // dernier : etiquettes, libelle, duree, effectif, ETAT, nom (jamais).
  // L etat est passe SOUS l effectif le 2026-08-14 : « qui, puis l etat, puis
  // le reste ». Le libelle se lit sur son enfant .b-tag-text : c est lui que
  // la requete de conteneur affiche ou non ; la boite .b-tag, elle, reste en
  // place pour absorber l espace libre.
  // affichage : la valeur de display a reposer quand on remet l element pour
  // le mesurer (un span rendu en inline ne rapporte ni clientWidth ni
  // scrollWidth, donc « il tenait » deviendrait toujours vrai).
  // entierRequis : cet element ne s affiche jamais a moitie, la question
  // « est-ce qu il tenait ? » veut donc dire « EN ENTIER », pas « au moins
  // quatre caracteres ».
  // marge : la granularite DECLAREE de la regle. Le seuil du libelle vient
  // d une estimation de largeur en unites de caractere, arrondie a l unite
  // superieure : il reserve donc jusqu a ~8px de trop. Une regle prudente de
  // quelques pixels n est pas une regle fausse ; en dessous de cette marge on
  // ne signale rien, au-dessus si.
  const RANKED = [
    { sel: '.b-tag-text', nom: 'libelle d activite', affichage: 'block', entierRequis: true, marge: 8 },
    { sel: '.bk-dur', nom: 'duree' },
    { sel: '.bk-pax', nom: 'effectif' },
    { sel: '.bk-state', nom: 'repere d etat' },
  ];
  bookings.forEach((bk) => {
    const nameEl = bk.querySelector('.booking-name');
    if (!nameEl) return;
    // Largeurs AVANT : le nom et tous les rangs deja affiches. Aucun ne doit
    // perdre un pixel quand on remet un rang inferieur.
    const above = [nameEl, ...RANKED.map((r) => bk.querySelector(r.sel))]
      .filter((el) => el && visible(el))
      .map((el) => [el, R(el).width]);
    // CHAQUE rang se verifie separement : s'arreter au premier visible
    // laisserait passer une duree retiree a tort sous un libelle affiche.
    for (let i = 0; i < RANKED.length; i += 1) {
      const item = RANKED[i];
      const el = bk.querySelector(item.sel);
      // Un repere d'etat ne porte pas de texte : son libelle est son aria-label.
      if (!el) continue;
      if (!((el.textContent || '').trim() || el.getAttribute('aria-label'))) continue;
      if (visible(el)) continue;
      // On force le retour de l element ET de tous ses ancetres masques.
      const undo = [];
      let p = el;
      while (p && p !== bk.parentElement) {
        if (getComputedStyle(p).display === 'none') {
          undo.push([p, p.style.getPropertyValue('display'), p.style.getPropertyPriority('display')]);
          p.style.setProperty('display', (p === el && item.affichage) || naturalDisplay(p), 'important');
        }
        p = p.parentElement;
      }
      if (!undo.length) continue;
      const fits = bk.scrollWidth <= bk.clientWidth + 1 && bk.scrollHeight <= bk.clientHeight + 1;
      const shown = R(el).width;
      // « Il disait quelque chose » : soit son texte tient EN ENTIER (« 1h »
      // fait deux caracteres, exiger 4 le rendrait indetectable), soit il en
      // montre au moins 4, comme le plancher du nom.
      const entier = el.scrollWidth <= el.clientWidth + 1;
      const marge = item.marge || 0;
      const lisible = item.entierRequis
        ? (entier && el.clientWidth - el.scrollWidth >= marge)
        : (entier || shown >= minLegible(el, 4));
      // Personne au-dessus ne paie.
      const paye = above.some(([node, before]) => R(node).width < before - 0.5);
      undo.forEach(([node, value, priority]) => {
        if (value) node.style.setProperty('display', value, priority);
        else node.style.removeProperty('display');
      });
      if (fits && lisible && !paye) {
        add('info-masquee-alors-quelle-tenait', item.nom + ' masque sur une carte de ' + num(R(bk).width) + 'x' + num(R(bk).height)
          + 'px alors qu il tenait (' + num(shown) + 'px affichables, aucun rang superieur ne perd de place)');
      }
    }
  });

  return out;
};

// Sonde de defilement : ce qui doit tenir quand la grille defile.
window.__PLANNING_SCROLL_AUDIT__ = function () {
  const out = [];
  const add = (kind, detail) => out.push({ kind, detail });
  const wrap = document.getElementById('planningGridWrap');
  const grid = wrap && wrap.querySelector('.planning-grid');
  if (!grid) return out;
  const lanes = [...grid.querySelectorAll('.lane-col')];
  const hourCol = grid.querySelector('.hour-col');
  const maxX = wrap.scrollWidth - wrap.clientWidth;
  const maxY = wrap.scrollHeight - wrap.clientHeight;
  const num = (v) => Math.round(v * 10) / 10;
  if (maxX > 4) {
    wrap.scrollLeft = Math.min(maxX, 240);
    const wr = wrap.getBoundingClientRect();
    const hr = hourCol.getBoundingClientRect();
    if (Math.abs(hr.left - wr.left) > 1.5) add('colonne-heures-non-collante', 'colonne d heures a ' + num(hr.left) + ' au lieu de ' + num(wr.left) + ' apres defilement horizontal');
    const line = grid.querySelector('.current-line');
    if (line) {
      const lr = line.getBoundingClientRect();
      const zLine = Number(getComputedStyle(line).zIndex) || 0;
      const zHour = Number(getComputedStyle(hourCol).zIndex) || 0;
      if (lr.left < hr.right - 1 && zLine > zHour) add('ligne-maintenant-sur-colonne-heures', 'apres defilement horizontal, la ligne (z ' + zLine + ') couvre la colonne d heures (z ' + zHour + ')');
    }
    const badge = grid.querySelector('.current-badge');
    if (badge) {
      const br = badge.getBoundingClientRect();
      if (br.left < wr.left - 1 || br.right > wr.right + 1) add('heure-courante-hors-vue', 'le repere d heure courante sort du cadre apres defilement');
    }
    wrap.scrollLeft = 0;
  }
  if (maxY > 4) {
    wrap.scrollTop = Math.min(maxY, 200);
    const wr = wrap.getBoundingClientRect();
    lanes.slice(0, 3).forEach((lane, i) => {
      const head = lane.querySelector('.lane-header');
      if (!head) return;
      const hr = head.getBoundingClientRect();
      if (hr.top < wr.top - 1.5) add('entete-piste-non-collant', 'en-tete de la piste ' + (i + 1) + ' a decroche de ' + num(wr.top - hr.top) + 'px');
    });
    wrap.scrollTop = 0;
  }
  return out;
};

// Contraste WCAG : on remonte la pile pour trouver le premier fond opaque.
window.__PLANNING_CONTRAST__ = function () {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = [c.r, c.g, c.b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const bgOf = (el) => {
    let p = el;
    let acc = null;
    while (p && p !== document.documentElement) {
      const c = parse(getComputedStyle(p).backgroundColor);
      if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) return acc; }
      p = p.parentElement;
    }
    const html = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    return acc ? over(acc, html) : html;
  };
  const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); const hi = Math.max(l1, l2); const lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
  // UN AUDITEUR QUI NE REGARDE QU'UNE REGION NE PROTEGE QUE CETTE REGION.
  //
  // Cette liste ne contenait QUE des selecteurs de la grille, tous prefixes par
  // #planningGridWrap. Les deux echecs AA trouves le 2026-08-14 etaient donc
  // hors de sa portee, a quelques pixels au-dessus : le sous-titre « 8 pistes »
  // des onglets de ressource (4,49:1 sur le fond de l'onglet actif) et la
  // pastille de compte de ces memes onglets (4,00:1). Le gate etait vert et la
  // page etait fausse. La barre d'onglets et l'en-tete de page entrent donc
  // dans la mesure, et les selecteurs portent desormais leur propre racine.
  const SEL = [
    '#planningGridWrap .booking-name',
    '#planningGridWrap .booking .b-tag',
    '#planningGridWrap .booking .bk-pax',
    '#planningGridWrap .booking .bk-dur',
    '#planningGridWrap .booking .bk-state',
    '#planningGridWrap .booking .reservation-tag',
    '#planningGridWrap .hour-cell.major',
    '#planningGridWrap .hour-cell.minor',
    '#planningGridWrap .lane-header .pl',
    '#planningGridWrap .lane-header .num',
    '#planningGridWrap .current-badge',
    '.staff-resource-tab .main',
    '.staff-resource-tab .sub',
    '.staff-resource-tab.active .main',
    '.staff-resource-tab.active .sub',
    '.staff-resource-tab > span:last-child:not(:first-child)',
    '.staff-resource-tab.active > span:last-child:not(:first-child)',
    '.staff-head .sub',
  ];
  const rows = [];
  SEL.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) return;
    const bg = bgOf(el);
    const solid = fg.a >= 0.999 ? fg : over(fg, bg);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    rows.push({ sel, ratio: Math.round(ratio(solid, bg) * 100) / 100, size, required: large ? 3 : 4.5, fg: hex(solid), bg: hex(bg) });
  });
  return rows;
};
`;

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function applyLaneCount(page, laneCount) {
  await page.evaluate(async (count) => {
    window.__LANE_COUNT__ = count;
    const d = '2026-07-18';
    state.currentDate = d;
    state.adminCenterId = 'libramont';
    state.staffMenuPage = 'planning';
    state.staffResourceView = 'bowling';
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    state.reservations = window.__QA_BUILD__(d);
    state.laneStatuses = window.__QA_LANES__();
    setView('staff');
    while (staffCenterConfigCache.loading) { await new Promise((r) => setTimeout(r, 20)); }
    await loadStaffCenterConfig(true);
    renderStaff();
  }, laneCount);
  await page.waitForTimeout(120);
}

async function setExpanded(page, expanded) {
  await page.evaluate((exp) => {
    if (!!state.staffPlanningExpanded !== !!exp) togglePlanningExpanded();
    else renderStaff();
  }, expanded);
  await page.waitForTimeout(90);
}

// Mesurer un contraste pendant qu une transition de couleur court, c est mesurer
// une couleur qui n existe a aucun moment stable. Deux tentatives ont echoue :
// un delai fixe (600 ms le 2026-09-15, encore la couleur de depart, 1,17:1) et
// l attente de `document.getAnimations()` apres deux trames. Cette derniere est
// PIRE, parce qu elle rend la main tout de suite quand aucune transition n a
// encore demarre : le changement de theme rebatit la grille, les transitions des
// elements qui survivent partent APRES ces deux trames, et on mesurait alors la
// couleur de l ancien theme sur le fond du nouveau (d ou « #0a0a0a sur #0a0a0a »
// en sombre : du texte clair-theme sur un fond sombre-theme).
//
// On n attend donc plus un signal indirect : on attend que LA MESURE elle-meme
// ne bouge plus. Deux relevés consecutifs identiques, sinon on recommence, avec
// un plafond pour ne jamais pendre. C est la seule forme qui ne depend ni de la
// charge de la machine ni du moment ou la transition demarre.
async function attendreCouleursStables(page, lire) {
  const PLAFOND = 60; // ~60 trames, soit une seconde de transition largement couverte
  let precedent = null;
  for (let essai = 0; essai < PLAFOND; essai += 1) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const rows = await page.evaluate(lire);
    const empreinte = JSON.stringify((rows || []).map((row) => [row.sel, row.fg, row.bg]));
    if (precedent !== null && empreinte === precedent) return rows;
    precedent = empreinte;
  }
  throw new Error('les couleurs ne se stabilisent pas : mesure impossible');
}

// La ligne « maintenant » n'existe que si l'heure reelle tombe dans la plage du
// jour affiche. On la force pour la mesurer a coup sur, sans dependre de
// l'horloge de la machine qui lance le gate.
async function forceNowLine(page) {
  await page.evaluate(() => {
    if (window.__NOW_PATCHED__) return;
    window.__NOW_PATCHED__ = true;
    const realToday = todayStr;
    window.currentTimeDecimal = () => 15.5;
    window.todayStr = () => state.currentDate || realToday();
  });
}

const MESURES_MAX = 12;

async function runCell(page, ctx) {
  await page.setViewportSize({ width: ctx.vw, height: ctx.vh });
  // Deux trames APRES le rendu : le redimensionnement declenche lui-meme un
  // re-rendu du planning (rAF). Mesurer avant qu'il retombe, c'est mesurer une
  // mise en page a moitie construite.
  await page.evaluate(() => new Promise((resolve) => {
    if (typeof renderStaff === 'function') renderStaff();
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  // DEUX RELEVES IDENTIQUES D AFFILEE, pas un delai fixe. Un delai mesure la
  // machine : sous la charge d une suite complete, 60 ms laissaient la grille
  // a moitie construite et le releve rendait des colonnes de 0 px (suite du
  // 2026-09-18, dix occurrences toutes sur la meme combinaison, zero quand le
  // gate tourne seul).
  //
  // On n attend PAS qu une colonne ait une largeur non nulle : une colonne de
  // 0 px est justement ce que ce gate cherche. On attend que le releve ne
  // BOUGE plus, ce qui est un signal different de son contenu.
  let precedent = null;
  let releve = [];
  let mesures = 0;
  while (mesures < MESURES_MAX) {
    await page.waitForTimeout(60);
    mesures += 1;
    const defects = await page.evaluate(() => window.__PLANNING_AUDIT__());
    const scrollDefects = await page.evaluate(() => window.__PLANNING_SCROLL_AUDIT__());
    releve = [...defects, ...scrollDefects];
    const signature = JSON.stringify(releve);
    if (precedent === signature) return releve;
    precedent = signature;
  }
  // L attente bornee ne sort PAS en silence : ce qui n a jamais tenu en place
  // n a pas ete mesure, et le gate doit le dire au lieu de rendre le dernier
  // releve comme s il faisait foi.
  return [...releve, {
    kind: 'mise-en-page-jamais-stable',
    detail: `releve encore mouvant apres ${mesures} mesures (viewport ${ctx.vw}x${ctx.vh})`,
  }];
}

function report(title, tally, cellCount) {
  const kinds = [...tally.keys()].sort((a, b) => tally.get(b).cells - tally.get(a).cells);
  console.log(`\n${title} (${cellCount} combinaisons mesurees)`);
  if (!kinds.length) { console.log('  aucun defaut'); return 0; }
  console.log('  | defaut | combinaisons | exemple |');
  console.log('  |---|---|---|');
  let total = 0;
  kinds.forEach((k) => {
    const e = tally.get(k);
    total += e.cells;
    console.log(`  | ${k} | ${e.cells} | ${e.sample} |`);
  });
  return total;
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  // Les animations d'arrivee (`.booking.is-neuve` -> `plNeuvePose`, scale .94)
  // deforment les rectangles pendant 300 ms. Un gate qui mesure a cet instant
  // mesure une transformation, pas une mise en page. `reduced-motion` est deja
  // respecte par le CSS (animation: none) : on mesure l'etat pose.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  const tally = new Map();
  let cellCount = 0;
  try {
    await installMock(page);
    await page.addInitScript(AUDITOR);
    await page.goto(`${BASE_URL}/?v=mtx-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.loadStaffCenterConfig === 'function', null, { timeout: 15000 });
    await forceNowLine(page);

    console.log('\n[1] MATRICE : ecrans x zooms x nombre de pistes x modes');
    console.log(`    ecrans ${SCREENS.map((s) => `${s.w}x${s.h}`).join(', ')}`);
    console.log(`    zooms  ${ZOOMS.map((z) => `${Math.round(z * 100)}%`).join(', ')}`);
    console.log(`    pistes ${LANE_COUNTS.join(', ')} (40 = maximum autorise par l ecran Etablissement)`);

    for (const laneCount of LANE_COUNTS) {
      await applyLaneCount(page, laneCount);
      for (const mode of MODES) {
        await setExpanded(page, mode.expanded);
        for (const screen of SCREENS) {
          for (const zoom of ZOOMS) {
            const vw = Math.round(screen.w / zoom);
            const vh = Math.round((screen.h - mode.chrome) / zoom);
            const ctx = { vw, vh, laneCount, mode: mode.label, screen: `${screen.w}x${screen.h}`, zoom: `${Math.round(zoom * 100)}%` };
            const defects = await runCell(page, ctx);
            cellCount += 1;
            const label = `${ctx.laneCount} pistes · ${ctx.mode} · ${ctx.screen} @ ${ctx.zoom} (viewport ${vw}x${vh})`;
            defects.forEach((d) => {
              const entry = tally.get(d.kind) || { cells: 0, sample: '' };
              entry.cells += 1;
              if (!entry.sample) entry.sample = `${label} : ${d.detail}`;
              tally.set(d.kind, entry);
            });
          }
        }
      }
    }

    const totalDefects = report('DEFAUTS TROUVES', tally, cellCount);
    ok(tally.size === 0, `la matrice ne trouve aucun defaut de mise en page (${tally.size} type(s), ${totalDefects} occurrence(s))`);

    console.log('\n[2] CONTRASTE WCAG AA, mesure dans les DEUX themes');
    await applyLaneCount(page, 8);
    await setExpanded(page, false);
    await page.setViewportSize({ width: 1440, height: 780 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => { state.staffTheme = t; document.documentElement.setAttribute('data-theme', t); renderStaff(); }, theme);
      // Les couleurs heritees TRANSITIONNENT au changement de theme. Mesurer
      // trop tot, c'est mesurer une interpolation entre les deux palettes : le
      // gate accusait alors le planning d'un contraste de 1,17:1 qui n'existait
      // a aucun moment stable. On mesure jusqu'a ce que la mesure ne bouge plus.
      const rows = await attendreCouleursStables(page, () => window.__PLANNING_CONTRAST__());
      ok(rows.length >= 8, `theme ${theme} : ${rows.length} elements de texte mesures`);
      rows.forEach((row) => {
        ok(row.ratio >= row.required, `theme ${theme} · ${row.sel} : contraste ${row.ratio}:1 (requis ${row.required}:1, police ${row.size}px, ${row.fg} sur ${row.bg})`);
      });
    }
    await page.evaluate(() => { state.staffTheme = 'light'; document.documentElement.setAttribute('data-theme', 'light'); renderStaff(); });

    console.log('\n[3] CONTRE-EPREUVE : l auditeur rougit quand on casse le planning');
    await applyLaneCount(page, 8);
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.evaluate(() => new Promise((resolve) => {
      renderStaff();
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const cleanBefore = await page.evaluate(() => window.__PLANNING_AUDIT__());
    ok(cleanBefore.length === 0, `etat sain : 0 defaut avant mutation (obtenu ${cleanBefore.length} : ${cleanBefore.map((d) => d.kind + ' / ' + d.detail).join(' | ')})`);
    const mutated = await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'qa-mutation';
      // On remet EXACTEMENT les trois causes racines corrigees : hauteur de
      // carte plus grande que son creneau, largeur de colonne qui ecrase le
      // texte, et nom sans strategie de troncature.
      style.textContent = '#planningGridWrap .booking{min-height:420px !important;}'
        + ' #planningGridWrap .booking-name{text-overflow:clip !important;}';
      document.head.appendChild(style);
      return window.__PLANNING_AUDIT__();
    });
    const mutatedKinds = new Set(mutated.map((d) => d.kind));
    ok(mutatedKinds.has('chevauchement-cartes'), 'contre-epreuve : le chevauchement de cartes est detecte');
    ok(mutatedKinds.has('carte-hors-piste'), 'contre-epreuve : une carte qui sort de sa colonne est detectee');
    ok(mutatedKinds.has('texte-tronque-sans-ellipse'), 'contre-epreuve : un nom tronque sans ellipse est detecte');
    ok(mutated.length > 0, `contre-epreuve : la mutation produit ${mutated.length} defaut(s) la ou l etat sain en produit 0 [${[...mutatedKinds].join(', ')}]`);
    await page.evaluate(() => new Promise((resolve) => {
      const s = document.getElementById('qa-mutation');
      if (s) s.remove();
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const cleanAfter = await page.evaluate(() => window.__PLANNING_AUDIT__());
    ok(cleanAfter.length === 0, `mutation retiree : retour a 0 defaut (obtenu ${cleanAfter.length})`);

    // CONTRE-EPREUVE DU DETECTEUR NEUF, et c est la plus importante du lot :
    // on REMET EXACTEMENT la regle qui produisait le defaut de Movsar, celle
    // qui masquait le libelle d activite sur toute carte d une seule ligne quelle
    // que soit sa largeur. Sans cette contre-epreuve, rien ne prouve que le
    // detecteur voit autre chose que du vide.
    const regression = await page.evaluate(() => new Promise((resolve) => {
      // Pistes a 290px : EXACTEMENT la carte de la capture de Movsar.
      document.getElementById('planningBox').style.setProperty('--planning-lane-w', '290px');
      const style = document.createElement('style');
      style.id = 'qa-mutation-masquage';
      // C est bien le TEXTE qu on masque : depuis le 2026-08-14 la boite
      // `.b-tag` reste toujours en place (elle absorbe l espace libre et sert
      // de conteneur de requete), et c est son enfant que la regle affiche ou
      // non. Masquer la boite reviendrait a muter autre chose que la regle
      // qu on veut mettre en defaut.
      // L OFFRE A CHANGE DE PARENT le 2026-08-14 : elle a quitte le pied pour sa
      // propre ligne (`.booking-offer`), qui repasse en `display: contents` sur
      // une carte d une seule ligne. La mutation ne vise donc plus un parent
      // precis, sinon elle ne mord plus sur rien et la contre-epreuve devient
      // muette : elle vise le TEXTE de l etiquette, ou qu il vive.
      // ET LA MUTATION PORTE SUR DEUX RANGS, PAS UN SEUL. Le libelle est le seul
      // rang dont l affichage depend d une requete de CONTENEUR : sa largeur est
      // la place qui reste, donc « est-ce qu il tenait ? » depend de ce que les
      // autres rangs occupent au meme instant. En muter un deuxieme, dont la
      // largeur est fixe (la duree), rend la contre-epreuve independante de cette
      // negociation : si le detecteur voit l un OU l autre, il n est pas muet.
      style.textContent = '#planningGridWrap .booking.dens-xs .b-tag .b-tag-text{display:none !important;}'
        + '#planningGridWrap .booking.dens-xs .bk-dur{display:none !important;}';
      document.head.appendChild(style);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const card = document.querySelector('#planningGridWrap .booking.dens-xs');
        resolve({ defects: window.__PLANNING_AUDIT__(), cardWidth: card ? Math.round(card.getBoundingClientRect().width) : -1 });
      }));
    }));
    const regressionKinds = new Set(regression.defects.map((d) => d.kind));
    ok(regressionKinds.has('info-masquee-alors-quelle-tenait'),
      `contre-epreuve : le libelle d activite masque alors qu il tenait est detecte (cartes a ${regression.cardWidth}px, ${regression.defects.length} defaut(s))`);
    // Et le sens inverse : masquer un rang qui NE tenait pas ne doit rien
    // declencher, sinon le detecteur interdirait toute degradation.
    await page.evaluate(() => {
      const s = document.getElementById('qa-mutation-masquage');
      if (s) s.remove();
      document.getElementById('planningBox').style.removeProperty('--planning-lane-w');
    });
    // PREUVE QUE LE DETECTEUR EST REELLEMENT EXERCE, et pas simplement muet.
    // « 0 defaut » sur 324 combinaisons ne vaut rien si aucun rang n'est jamais
    // masque : le detecteur ne se serait alors jamais declenche. A 40 pistes,
    // les colonnes tombent a leur plancher de 88px et la degradation opere pour
    // de vrai. On compte les rangs effectivement retires, on exige qu'il y en
    // ait, et on exige que le detecteur reste silencieux dessus : c'est la
    // contre-epreuve inverse, et elle porte sur l'etat SAIN, pas sur une
    // mutation artificielle.
    await page.evaluate(() => {
      const s = document.getElementById('qa-mutation-masquage');
      if (s) s.remove();
    });
    await applyLaneCount(page, 40);
    const legitime = await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const lane = document.querySelector('#planningGridWrap .lane-col');
        const cache = (sel) => [...document.querySelectorAll('#planningGridWrap .booking')]
          .filter((bk) => { const el = bk.querySelector(sel); return el && getComputedStyle(el).display === 'none'; }).length;
        resolve({
          defects: window.__PLANNING_AUDIT__().filter((d) => d.kind === 'info-masquee-alors-quelle-tenait'),
          laneWidth: lane ? Math.round(lane.getBoundingClientRect().width) : -1,
          duresMasquees: cache('.bk-dur'),
          etiquettesMasquees: cache('.reservation-tags'),
        });
      }));
    }));
    ok(legitime.duresMasquees + legitime.etiquettesMasquees > 0,
      `la degradation opere vraiment a ${legitime.laneWidth}px de piste (${legitime.duresMasquees} durees et ${legitime.etiquettesMasquees} blocs d etiquettes retires) : le detecteur est exerce`);
    ok(legitime.defects.length === 0, `contre-epreuve inverse : une degradation legitime ne declenche rien (pistes a ${legitime.laneWidth}px, obtenu ${legitime.defects.length}${legitime.defects.length ? ' : ' + legitime.defects.slice(0, 3).map((d) => d.detail).join(' | ') : ''})`);
    await applyLaneCount(page, 8);
    const afterRegression = await page.evaluate(() => window.__PLANNING_AUDIT__());
    ok(afterRegression.length === 0, `mutations de masquage retirees : retour a 0 defaut (obtenu ${afterRegression.length})`);

    // Contre-epreuve du detecteur de LARGEUR, par le vrai levier du produit :
    // la largeur minimale de piste est un jeton (`--planning-lane-w`). On le
    // rabaisse avec le maximum de pistes autorise : les colonnes tombent alors
    // sous le seuil de lisibilite, et le detecteur doit le voir.
    await applyLaneCount(page, 40);
    const narrow = await page.evaluate(() => new Promise((resolve) => {
      document.getElementById('planningBox').style.setProperty('--planning-lane-w', '4px');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const w = document.querySelector('#planningGridWrap .lane-col');
        resolve({ defects: window.__PLANNING_AUDIT__(), laneWidth: w ? Math.round(w.getBoundingClientRect().width) : -1 });
      }));
    }));
    ok(new Set(narrow.defects.map((d) => d.kind)).has('colonne-trop-etroite'), `contre-epreuve : une colonne ecrasee est detectee (pistes a ${narrow.laneWidth}px)`);
    await page.evaluate(() => new Promise((resolve) => {
      document.getElementById('planningBox').style.removeProperty('--planning-lane-w');
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const narrowClean = await page.evaluate(() => window.__PLANNING_AUDIT__());
    ok(narrowClean.length === 0, `jeton restaure : retour a 0 defaut a 40 pistes (obtenu ${narrowClean.length})`);

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); failures += errs.length; }
  } catch (e) {
    console.error('\nplanning-matrix-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nplanning-matrix-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nplanning-matrix-check: ALL OK');
}

main();

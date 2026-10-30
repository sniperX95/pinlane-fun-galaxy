// LES EN-TETES DES TROIS PLEIN ECRANS NE SE RECOUVRENT JAMAIS (lot I3, 2026-10-09).
//
// L en-tete « sur une ligne » (Movsar, 2026-10-08) laissait la date passer
// sur « Toutes les réservations » de 769 a 960 px : la colonne du titre
// pouvait tomber a zero pendant que les actions gardaient toute leur largeur
// (85 px de recouvrement a 769, 60 a 820). Au telephone, la bascule sortait
// de l ecran des deux cotes (55 px a 390, deja vrai avant). Pour chaque plein
// ecran (Bowling, Laser Game, Planning global, et la liste du jour qui garde
// son propre « Agrandir »), de 360 a 1920 px :
//   [A] le titre, le sous-titre, la date, les actions et la bascule ne se
//       recouvrent pas, et rien ne sort de l en-tete ;
//   [B] le titre se lit en entier : ni coupe, ni cache par un voisin ;
//   [C] la bascule tient dans l ecran, ses trois onglets entiers ;
//   [K] contre-preuves : chaque regle retiree fait rougir sa lettre.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { serveStatic, installMock, boot, BROWSER_PATH } = require('./reserver-v5-check');

const ROOT = path.resolve(__dirname, '..');
const JOUR = '2026-10-10';
const LARGEURS = [360, 390, 430, 600, 601, 768, 769, 800, 820, 860, 900, 959, 960, 1024, 1180, 1280, 1366, 1399, 1400, 1440, 1600, 1799, 1800, 1920];
// « all » est le planning global depuis le 2026-10-12 ; la liste du jour
// s agrandit par son propre bouton (« liste »).
const VUES = ['bowling', 'laser', 'all', 'liste'];

let echecs = 0;
const lignes = [];
// La contre-preuve en cours : elle a mordu des que sa lettre rougit, la suite
// de ses scenarios n apporterait plus rien (2026-10-30, la suite raccourcie ;
// chaque scenario ferme sa page dans un finally).
class Mordu extends Error {}
let attendue = null;
function ok(cond, label, detail = '') {
  lignes.push({ cond: Boolean(cond), label });
  if (!process.env.EPE_SILENCE) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  if (!cond && attendue && label.startsWith(attendue.lettre)) throw new Mordu(label);
  return cond;
}

// Une journee chargee : des compteurs a deux chiffres dans la bascule et un
// sous-titre Laser long (« 12 départs · 114 joueurs · 1 à placer »).
function journee() {
  const hh = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const laser = (minutes, joueurs, countIndex = 1) => ({ type: 'activity', activityId: 'laser_game', label: 'Laser Game', resourceType: 'laser_arena', countIndex, groupWaveIndex: 1, groupWaveCount: 1, manualLaserPass: true, critical: true, start: minutes, end: minutes + 25, startTime: hh(minutes), endTime: hh(minutes + 25), durationMinutes: 25, players: joueurs, groupPlayers: joueurs });
  const plan = (pax, blocs, total) => ({
    resourceBlocks: blocs, laserManual: true,
    laserPassPlan: {
      mode: 'manual_after_first', totalGames: total,
      scheduledPasses: blocs.map(b => ({ countIndex: b.countIndex, status: 'scheduled', pax, startTime: b.startTime })),
      pendingPasses: Array.from({ length: total }, (_, i) => i + 1).filter(k => !blocs.some(b => b.countIndex === k)).map(k => ({ countIndex: k, status: 'pending', pax })),
    },
  });
  let id = 9800;
  const base = (name, pax, extra) => {
    id += 1;
    return { id, centerId: 'libramont', date: JOUR, name, phone: `+32470${String(id).padStart(6, '0')}`, status: 'confirmed', pax, price: 20 * pax, basePrice: 20 * pax, source: 'staff', updatedAt: '2026-10-10T08:00:00.000Z', lanes: [], ...extra };
  };
  const bowling = (name, lanes, startTime, pax) => base(name, pax, { type: 'bowling', lanes, startTime, duration: 1, totalDuration: 1 });
  const groupe = (name, pax, departs, total = departs.length) => base(name, pax, {
    type: 'laser', startTime: departs.length ? hh(departs[0]) : '17:15', duration: total * 0.5, totalDuration: total * 0.5, laserGames: total,
    opsPlan: plan(pax, departs.map((m, i) => laser(m, pax, i + 1)), total),
  });
  return [
    bowling('Famille Martin', [1], '14:00', 6), bowling('Anniversaire Léa', [2, 3], '15:00', 12),
    bowling('Les Lynx', [4], '16:00', 8), bowling('Collège Saint-Joseph', [5, 6], '17:00', 16),
    bowling('Patro d’Arlon', [7], '18:00', 7), bowling('EVJF Sarah', [8], '19:00', 9),
    groupe('Anniv. Noah', 8, [15.5 * 60, 16.5 * 60]), groupe('Séminaire Lutosa', 22, [15 * 60]),
    groupe('Anniv. Emma', 12, [16 * 60, 17 * 60]), groupe('Les Rangers', 6, [16 * 60]),
    groupe('Scouts Bastogne', 18, [19 * 60, 19.5 * 60]), groupe('Kevin', 2, [19.5 * 60]),
    groupe('EVG Thomas', 14, [20 * 60, 20.5 * 60]), groupe('Anniv. Chloé', 10, [], 1),
  ];
}

async function installerServeur(page, dossiers) {
  await page.addInitScript(({ dossiers }) => {
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const precedent = window.fetch;
    window.fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', window.location.origin);
      if (u.pathname === '/api/staff-state' || u.pathname === '/api/admin-range') {
        return J({ ok: true, revision: 'qa-epe', reservations: dossiers, laneStatuses: {}, centerId: 'libramont', syncedAt: new Date().toISOString() });
      }
      return precedent(input, init);
    };
  }, { dossiers });
}

// Mesure dans la page : les cinq zones de l en-tete du plein ecran ouvert.
function mesurer() {
  const tete = [...document.querySelectorAll(':is(.planning-box, .table-box).expanded:not(.hidden) :is(.planning-head, .table-head)')].find((t) => t.getBoundingClientRect().width > 0);
  if (!tete) return null;
  const texteDe = (el) => {
    const x = document.createRange();
    x.selectNodeContents(el);
    const r = x.getBoundingClientRect();
    return r.width ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
  };
  const boite = (sel) => { const e = tete.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? r : null; };
  const h2 = tete.querySelector('h2');
  const nom = h2.querySelector('[id$="TitleText"]') || [...h2.children].find((e) => e.tagName === 'SPAN') || h2;
  const sous = tete.querySelector('.planning-sub');
  const zones = { titre: texteDe(h2), sous: sous ? texteDe(sous) : null, date: boite('.pec-date'), actions: boite(':scope > :is(.planning-actions, .table-actions)'), bascule: boite(':scope > .fs-switch') };
  const noms = Object.keys(zones).filter((k) => zones[k]);
  const recouvre = [];
  for (let i = 0; i < noms.length; i += 1) for (let j = i + 1; j < noms.length; j += 1) {
    const a = zones[noms[i]];
    const c = zones[noms[j]];
    const dx = Math.min(a.right, c.right) - Math.max(a.left, c.left);
    const dy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
    if (dx > 0.5 && dy > 0.5) recouvre.push(`${noms[i]}/${noms[j]} ${Math.round(dx)}px`);
  }
  const bord = tete.getBoundingClientRect();
  const sort = [...tete.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > bord.right + 1 || r.left < bord.left - 1); })
    .slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`);
  // Le titre en entier : pas de coupe, et le point au bout de son texte est
  // bien a lui (aucun voisin peint par-dessus).
  const t = texteDe(nom);
  const auBout = t ? document.elementFromPoint(Math.min(t.right - 2, innerWidth - 1), (t.top + t.bottom) / 2) : null;
  const onglets = [...tete.querySelectorAll('.fs-switch-btn')].map((b) => b.getBoundingClientRect());
  return {
    recouvre,
    sort,
    deborde: Math.max(0, tete.scrollWidth - tete.clientWidth),
    titre: nom.textContent.trim(),
    titreCoupe: nom.scrollWidth > nom.clientWidth + 1 || h2.scrollWidth > h2.clientWidth + 1,
    titreCache: !(auBout && (nom.contains(auBout) || auBout === nom)),
    onglets: onglets.length,
    ongletsDehors: onglets.filter((r) => r.left < -0.5 || r.right > innerWidth + 0.5).length,
  };
}

async function ouvrir(browser, { tactile, mutation }) {
  const ctx = await browser.newContext({ viewport: { width: tactile ? 820 : 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: tactile });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/i.test(m.text())) erreurs.push(m.text()); });
  if (mutation) {
    const source = fs.readFileSync(path.join(ROOT, mutation.fichier), 'utf8').replace(/\r\n/g, '\n');
    const n = source.split(mutation.de).length - 1;
    if (n !== 1) throw new Error(`contre-preuve ${mutation.nom} desarmee : ancre trouvee ${n} fois`);
    const mute = source.replace(mutation.de, () => mutation.vers);
    await page.route(`**/${mutation.fichier}*`, (route) => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: mute }));
  }
  await page.clock.setFixedTime(new Date(`${JOUR}T13:00:00`));
  await installMock(page, { maintenant: new Date(`${JOUR}T13:00:00`).getTime() });
  const dossiers = journee();
  await installerServeur(page, dossiers);
  await boot(page, { installer: false });
  await page.evaluate(({ jour, dossiers }) => { state.currentDate = jour; state.reservations = dossiers; }, { jour: JOUR, dossiers });
  return { ctx, page, erreurs };
}

async function scenarios(browser, mutation = null) {
  for (const tactile of [true, false]) {
    const { ctx, page, erreurs } = await ouvrir(browser, { tactile, mutation });
    try {
      for (const vue of VUES) {
        await page.evaluate(({ vue, jour }) => {
          state.currentDate = jour;
          if (vue === 'liste') { collapseStaffPlanningFullscreen(); setStaffResourceView('all'); toggleTableExpanded(); }
          else goFullscreenResource(vue);
        }, { vue, jour: JOUR });
        const rates = { A: [], B: [], C: [] };
        const titres = new Set();
        let mesurees = 0;
        for (const L of LARGEURS.filter((l) => (tactile ? l < 1200 : l >= 1200))) {
          await page.setViewportSize({ width: L, height: 900 });
          await page.waitForTimeout(120);
          const m = await page.evaluate(mesurer);
          if (!m) { rates.A.push(`${L}: pas d en-tete`); continue; }
          mesurees += 1;
          titres.add(m.titre);
          if (m.recouvre.length || m.sort.length || m.deborde > 1) rates.A.push(`${L}: ${[...m.recouvre, ...m.sort.map((s) => `${s} sort`), m.deborde > 1 ? `deborde ${m.deborde}` : ''].filter(Boolean).join(', ')}`);
          if (m.titreCoupe || m.titreCache) rates.B.push(`${L}: « ${m.titre} »${m.titreCoupe ? ' coupe' : ''}${m.titreCache ? ' cache' : ''}`);
          if (m.onglets !== 3 || m.ongletsDehors) rates.C.push(`${L}: ${m.onglets} onglets, ${m.ongletsDehors} dehors`);
        }
        const ecran = tactile ? 'de 360 a 1199 px' : 'de 1200 a 1920 px';
        // Le prerequis : chaque largeur a mesure l en-tete du BON plein ecran.
        const attendu = { bowling: /^Planning \d+ pistes$/, laser: /^Planning Laser Game$/, all: /^Planning global$/, liste: /^Toutes les réservations$/ }[vue];
        ok(mesurees === LARGEURS.filter((l) => (tactile ? l < 1200 : l >= 1200)).length && titres.size === 1 && attendu.test([...titres][0]),
          `[A] ${vue} ${ecran} : le plein ecran est ouvert a chaque largeur`, `${mesurees} mesures, ${[...titres].join(' / ')}`);
        ok(rates.A.length === 0, `[A] ${vue} ${ecran} : titre, date, actions et bascule ne se recouvrent pas, rien ne sort`, rates.A.slice(0, 4).join(' ; '));
        ok(rates.B.length === 0, `[B] ${vue} ${ecran} : le titre se lit en entier`, rates.B.slice(0, 4).join(' ; '));
        ok(rates.C.length === 0, `[C] ${vue} ${ecran} : la bascule tient dans l ecran`, rates.C.slice(0, 4).join(' ; '));
      }
      ok(erreurs.length === 0, `[A] ${tactile ? 'tablette' : 'ordinateur'} : zero erreur JS ni console`, erreurs.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }
}

// ── [K] LES CONTRE-PREUVES ─────────────────────────────────────────────────
const S = ':is(.planning-box, .table-box).expanded:not(.hidden)';
const MUTATIONS = [
  // L ancienne largeur 236 px recoupe le titre Toutes et son badge : la
  // date se peint dessus. La largeur partagee se teste sur le texte reel.
  { nom: 'colonne', lettre: '[B] liste de 1200 a 1920 px', fichier: 'assets/pinlane-staff.css',
    de: '  grid-template-columns: 320px auto;',
    vers: '  grid-template-columns: 236px auto;' },
  // La date reste a cote du titre sous 1101 px : les actions la recouvrent.
  { nom: 'repli', lettre: '[A] liste de 360 a 1199 px', fichier: 'assets/pinlane-staff.css',
    de: `  ${S} .planning-title-stack > .pec-date { grid-column: 1; grid-row: 3; margin-top: 6px; }\n}\n@media (max-width: 768px) {`,
    vers: '}\n@media (max-width: 768px) {' },
  // Les mots longs de la bascule au telephone : elle sort de l ecran.
  { nom: 'mots', lettre: '[C] bowling de 360 a 1199 px', fichier: 'assets/pinlane-staff.css',
    de: `@media (max-width: 600px) {\n  ${S} .fs-mot { display: none; }\n}`,
    vers: '' },
];

async function main() {
  const serveur = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    await scenarios(browser);
    if (process.argv.includes('--contre-preuves')) {
      console.log('\n[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS) {
        const avant = echecs;
        const garde = lignes.length;
        process.env.EPE_SILENCE = '1';
        attendue = m;
        try { await scenarios(browser, m); } catch (e) { if (!(e instanceof Mordu)) lignes.push({ cond: false, label: `crash ${e.message}` }); }
        attendue = null;
        delete process.env.EPE_SILENCE;
        const rouges = lignes.slice(garde).filter(l => !l.cond).map(l => l.label);
        lignes.length = garde;
        echecs = avant;
        ok(rouges.some(l => l.startsWith(m.lettre)), `[K] mutation ${m.nom} : « ${m.lettre} » rougit`, rouges.slice(0, 3).join(' ; '));
      }
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  console.log(echecs ? `\nentete-plein-ecran-check : ${echecs} echec(s)` : '\nentete-plein-ecran-check: ALL OK, les en-tetes des plein ecrans ne se recouvrent pas.');
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

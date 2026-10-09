// LES CARTES DU PLANNING BOWLING (gate ne le 2026-10-09).
//
// Movsar, 2026-10-08 : « plus beau, plus stylé, des petits badges bien plus
// quali en fonction de ce qu ils ont, super complet, super bien relié entre
// eux, aucune erreur ». Une journee de test qui porte chaque cas (laser a une
// et a deux parties, partie « à placer », formule avec sa progression, prix
// ajuste, 34 joueurs sur 1h30, 30 minutes, 2 heures, les trois etats),
// photographiee en fenetre et en plein ecran de 1920 a 390 px :
//   [A] la carte prend la couleur de son etat, encre comprise, et ses textes
//       font 4,5:1 sur son fond, dans les deux themes ;
//   [B] le badge laser du pied : l heure du planning Laser, « +1 », « à
//       placer » ; complet, ou son pictogramme, ou absent selon la place
//       libre du pied : s il est la il tient en entier, s il manque c est qu il
//       ne tenait pas ; la tete ne dit pas deux fois « laser » ; une formule
//       d une heure garde son offre dans le pied et le laser dans sa tete ;
//   [C] rien ne deborde, le nom garde quatre caracteres ; en plein ecran une
//       heure tient sur deux lignes, 30 minutes sur une en 13 px, 2 heures sur
//       trois ;
//   [D] relie : les heures du badge sont les departs ou le planning Laser
//       montre le groupe ;
//   [K] contre-preuves (--contre-preuves) : chaque regle cassee fait rougir sa
//       lettre.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { serveStatic, installMock, boot, BROWSER_PATH } = require('./reserver-v5-check');

const ROOT = path.resolve(__dirname, '..');
const JOUR = '2026-10-10';
const MAINTENANT = '15:12';

let echecs = 0;
const lignes = [];
function ok(cond, label, detail = '') {
  const l = `${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`;
  lignes.push({ cond: Boolean(cond), label });
  if (!process.env.CB_SILENCE) console.log(l);
  if (!cond) echecs += 1;
  return cond;
}

// ── LA JOURNEE ──────────────────────────────────────────────────────────────
function journee() {
  const min = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const hh = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const laser = (depart, joueurs, extra = {}) => {
    const a = min(depart);
    return { type: 'activity', activityId: 'laser_game', label: 'Laser Game', resourceType: 'laser_arena', countIndex: 1, groupWaveIndex: 1, groupWaveCount: 1, manualLaserPass: true, critical: true, start: a, end: a + 25, startTime: hh(a), endTime: hh(a + 25), durationMinutes: 25, players: joueurs, groupPlayers: joueurs, ...extra };
  };
  const plan = (pax, blocs, total, extra = {}) => ({
    resourceBlocks: blocs, laserManual: true,
    laserPassPlan: {
      mode: 'manual_after_first', totalGames: total,
      scheduledPasses: blocs.map(b => ({ countIndex: b.countIndex || 1, status: 'scheduled', pax, startTime: b.startTime })),
      pendingPasses: Array.from({ length: total }, (_, i) => i + 1).filter(k => !blocs.some(b => (b.countIndex || 1) === k)).map(k => ({ countIndex: k, status: 'pending', pax })),
    },
    ...extra,
  });
  // Au laser, 28 joueurs au plus : au-dela de 30 armes le groupe partirait en
  // deux vagues, et le badge compterait la seconde (« +1 »).
  const programme = (pax, parties) => ({ items: [{ activityId: 'bowling', participants: pax }, ...(parties ? [{ activityId: 'laser_game', games: parties, participants: Math.min(pax, 28) }] : [])] });
  const etapes = ['bowling', 'laser_game', 'arcade_time', 'party_table'].map((activityId, i) => ({ type: 'activity', activityId, startTime: `1${6 + i}:00` }));
  const d = (id, name, lanes, startTime, duration, pax, extra = {}) => ({
    id, centerId: 'libramont', date: JOUR, name, phone: `+32470${String(id).padStart(6, '0')}`, status: 'confirmed', type: 'bowling',
    startTime, duration, totalDuration: duration, pax, lanes, price: 20 * pax, basePrice: 20 * pax, source: 'staff', updatedAt: '2026-10-10T08:00:00.000Z', ...extra,
  });
  return [
    // Pied simple (cas a), une partie posee a 17:00.
    d(9601, 'Collège Saint-Joseph', [1], '18:00', 1, 18, { program: programme(18, 1), opsPlan: plan(18, [laser('17:00', 18)], 1) }),
    // Le pied le plus large du cas a : 34 joueurs, 1h30, deux parties.
    d(9602, 'Patro d’Arlon', [2], '20:00', 1.5, 34, { program: programme(34, 2), opsPlan: plan(34, [laser('17:30', 28), laser('19:00', 28, { countIndex: 2 })], 2) }),
    // Cas b : formule et sa progression, sur une heure (l offre partage le pied).
    d(9603, 'Anniversaire Léa', [3], '16:00', 1, 34, { type: 'formule', formuleId: 'qa-formule', program: programme(34, 1), opsPlan: plan(34, [laser('18:00', 28)], 1, { timeline: etapes }) }),
    // Cas c : prix ajuste a quatre chiffres, 34 joueurs, 1h30, arrives.
    d(9604, 'Famille Dubois', [4], '14:00', 1.5, 34, { status: 'arrived', price: 1290, basePrice: 1340, program: programme(34, 1), opsPlan: plan(34, [laser('16:30', 28)], 1) }),
    // Rien de pose : « à placer ». Payes.
    d(9605, 'Les Lynx', [5], '17:00', 1, 8, { status: 'paid', program: programme(8, 1), opsPlan: plan(8, [], 1) }),
    // Cas c sur une heure.
    d(9611, 'Team Acme', [5], '14:00', 1, 34, { price: 1290, basePrice: 1340, program: programme(34, 1), opsPlan: plan(34, [laser('16:00', 28)], 1) }),
    // 30 minutes, une note : une seule ligne, pas de badge.
    d(9606, 'Kevin', [1], '19:00', 0.5, 2, { notes: 'Gâteau à sortir à 19h', program: programme(2, 1), opsPlan: plan(2, [laser('19:30', 2)], 1) }),
    // 2 heures sans laser.
    d(9607, 'Soirée Sarah', [6], '19:00', 2, 6),
    // Anniversaire, deux parties dont une posee.
    d(9608, 'Anniv. Noah', [7], '16:30', 1, 10, { occasion: 'anniversaire', program: programme(10, 2), opsPlan: plan(10, [laser('18:30', 10)], 2) }),
    // Cas b sur 1h30 (l offre a sa ligne), 34 joueurs.
    d(9609, 'Anniv. Chloé', [8], '18:00', 1.5, 34, { type: 'formule', formuleId: 'qa-formule', program: programme(34, 1), opsPlan: plan(34, [laser('20:00', 28)], 1, { timeline: etapes }) }),
    // Cas a avec l offre dans le pied (formule sans etapes), 34 joueurs.
    d(9610, 'Scouts Bastogne', [8], '14:00', 1, 34, { type: 'formule', formuleId: 'qa-formule', program: programme(34, 1), opsPlan: plan(34, [laser('15:00', 28)], 1) }),
  ];
}
// Ce que le badge doit dire (premier depart, « +N » pour ce qui suit, ou « à
// placer »). Noah : une partie posee a 18:30, une a placer.
const BADGES = { 9601: '17:00', 9602: '17:30 +1', 9603: '18:00', 9604: '16:30', 9605: 'à placer', 9611: '16:00', 9608: '18:30 +1', 9609: '20:00', 9610: '15:00' };
// Les formules : leur offre (« Formule ») occupe le pied d une carte d une
// heure ; elles n y ont pas de badge et gardent le marqueur laser de tete.
const FORMULES = new Set([9603, 9609, 9610]);
const badgeAttendu = (c) => Boolean(BADGES[c.id]) && c.dens !== 'xs' && !(FORMULES.has(c.id) && c.dens === 'md');

async function installerServeur(page, dossiers) {
  await page.addInitScript(({ dossiers }) => {
    window.__CB_DOSSIERS__ = dossiers;
    const J = (p, status = 200) => new Response(JSON.stringify(p), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const precedent = window.fetch;
    window.fetch = async (input, init = {}) => {
      const brut = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(brut, window.location.origin);
      const methode = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-state' || u.pathname === '/api/admin-range') {
        return J({ ok: true, revision: 'qa-cb', reservations: window.__CB_DOSSIERS__, laneStatuses: {}, centerId: 'libramont', syncedAt: new Date().toISOString() });
      }
      // Rien ne s ecrit pendant ce gate.
      if (methode !== 'GET' && /^\/api\//.test(u.pathname)) return J({ ok: false, error: 'qa : lecture seule' }, 400);
      return precedent(input, init);
    };
  }, { dossiers });
}

const APPAREILS = {
  1920: { viewport: { width: 1920, height: 1080 } },
  1700: { viewport: { width: 1700, height: 950 } },
  1440: { viewport: { width: 1440, height: 900 } },
  1280: { viewport: { width: 1280, height: 800 } },
  1024: { viewport: { width: 1024, height: 768 } },
  tablette: { viewport: { width: 820, height: 1180 }, hasTouch: true },
  telephone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
};

async function ouvrir(browser, { appareil = 1440, theme = 'dark', plein = false, mutation = null } = {}) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, ...APPAREILS[appareil] });
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
    await page.route(`**/${mutation.fichier}*`, (route) => route.fulfill({ status: 200, contentType: mutation.fichier.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', body: mute }));
  }
  await page.clock.setFixedTime(new Date(`${JOUR}T${MAINTENANT}:00`));
  await installMock(page, { maintenant: new Date(`${JOUR}T${MAINTENANT}:00`).getTime() });
  await installerServeur(page, journee());
  await boot(page, { installer: false });
  await page.evaluate(({ theme, JOUR, plein }) => {
    state.staffTheme = theme;
    if (typeof applyStaffTheme === 'function') applyStaffTheme();
    state.currentDate = JOUR;
    state.reservations = window.__CB_DOSSIERS__.map(d => JSON.parse(JSON.stringify(d)));
    openStaffPlanningResource('bowling');
    if (plein) { state.staffPlanningExpanded = true; renderStaff(); }
  }, { theme, JOUR, plein });
  await page.waitForSelector('#planningGridWrap .booking[data-booking-res-id="9601"]', { timeout: 10000 });
  // Le changement de theme se fond (150 ms) ; les cartes jouent leur entree.
  await page.waitForTimeout(700);
  return { ctx, page, erreurs };
}

// ── LA MESURE (dans la page) ────────────────────────────────────────────────
// Rend, par carte : densite, largeur de piste, debordements, nom, badge
// (forme vue : complet, pictogramme ou rien ; texte, titre ; dedans sa boite),
// marqueurs laser de la tete, et la place libre de la boite du badge comparee
// a la largeur de chaque forme (forcee visible un instant, puis rendue).
function mesurerDansLaPage() {
  const vis = (e) => Boolean(e) && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  const largeur = (e) => e.getBoundingClientRect().width;
  const largeurForcee = (e) => { const avant = e.style.display; e.style.display = 'inline-flex'; const w = largeur(e); e.style.display = avant; return w; };
  return [...document.querySelectorAll('#planningGridWrap .booking')].map((c) => {
    const r = c.getBoundingClientRect();
    const dedans = (e) => { const b = e.getBoundingClientRect(); return b.left >= r.left - 0.5 && b.right <= r.right + 0.5 && b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5; };
    const dens = (c.className.match(/\bdens-(xs|md|lg)\b/) || [])[1] || '';
    const pied = c.querySelector('.booking-foot');
    const piedBoite = pied && getComputedStyle(pied).display !== 'contents';
    const reste = c.querySelector('.bk-reste');
    const complet = reste && reste.querySelector('.bk-laser:not(.is-compact)');
    const picto = reste && reste.querySelector('.bk-laser.is-compact');
    const nom = c.querySelector('.booking-name');
    const marqueursTete = [...c.querySelectorAll('.booking-head .bk-flag.flag-laser')];
    const police = parseFloat(getComputedStyle(nom).fontSize);
    const sortie = {
      id: Number(c.dataset.bookingResId), dens,
      piste: Math.round(c.closest('.lane-col').getBoundingClientRect().width * 10) / 10,
      // La hauteur que renderPlanning a posee (celle que lit la regle de densite).
      hauteur: parseFloat(c.style.height) || Math.round(r.height),
      debordeL: c.scrollWidth - c.clientWidth,
      debordeH: c.scrollHeight - c.clientHeight,
      debordePied: piedBoite ? pied.scrollWidth - pied.clientWidth : 0,
      nom: Math.round(largeur(nom) * 10) / 10, nomMin: Math.round(0.55 * police * 4 * 10) / 10, police,
      teteLaser: marqueursTete.length ? marqueursTete.some(vis) : null,
      offreVue: [...c.querySelectorAll('.booking-foot .b-tag-text, .booking-offer .b-tag-text')].some(vis),
      badge: null,
    };
    if (complet && picto) {
      const t = complet.querySelector('.bk-laser-t');
      const R = reste.getBoundingClientRect();
      const dansLaBoite = (e) => { const b = e.getBoundingClientRect(); return b.left >= R.left - 0.5 && b.right <= R.right + 0.5 && dedans(e); };
      const forme = vis(complet) ? 'complet' : vis(picto) ? 'picto' : 'rien';
      sortie.badge = {
        forme, texte: t ? t.textContent : '', titre: complet.getAttribute('title') || '',
        dedans: forme === 'complet' ? dansLaBoite(complet) : forme === 'picto' ? dansLaBoite(picto) : null,
        coupe: forme === 'complet' ? complet.scrollWidth - complet.clientWidth : 0,
        // La place de la boite face a chaque forme : une forme plus grande que
        // celle montree, et qui tenait, a ete retiree a tort.
        place: Math.round(reste.clientWidth * 100) / 100,
        largeurComplet: Math.round(largeurForcee(complet) * 100) / 100,
        largeurPicto: Math.round(largeurForcee(picto) * 100) / 100,
      };
    }
    return sortie;
  });
}

const lire = (page) => page.evaluate(mesurerDansLaPage);

// ── LES SCENARIOS ───────────────────────────────────────────────────────────
async function scenarios(browser, mutation = null) {
  // [B] [C] dans chaque appareil, fenetre puis plein ecran (theme sombre : la
  // geometrie ne depend pas du theme).
  const vus = new Set();
  for (const appareil of Object.keys(APPAREILS)) {
    for (const plein of [false, true]) {
      const { ctx, page, erreurs } = await ouvrir(browser, { appareil, plein, mutation });
      const ou = `${appareil}${plein ? ' plein ecran' : ''}`;
      try {
        const cartes = await lire(page);
        const debordent = cartes.filter(c => c.debordeL > 1 || c.debordeH > 1 || c.debordePied > 0);
        ok(debordent.length === 0, `[C] ${ou} : aucune carte ne deborde`, debordent.slice(0, 3).map(c => `${c.id} ${c.dens} L${c.debordeL} H${c.debordeH} pied ${c.debordePied} (piste ${c.piste})`).join(' | '));
        const illisibles = cartes.filter(c => c.nom + 0.5 < c.nomMin);
        ok(illisibles.length === 0, `[C] ${ou} : le nom garde quatre caracteres`, illisibles.slice(0, 3).map(c => `${c.id} ${c.nom}<${c.nomMin}`).join(' | '));
        const avecBadge = cartes.filter(c => c.badge);
        const mauvais = avecBadge.filter(c => c.badge.texte !== BADGES[c.id]);
        ok(avecBadge.length > 0 && mauvais.length === 0, `[B] ${ou} : chaque badge dit son premier depart, « +1 » ou « à placer »`, mauvais.slice(0, 3).map(c => `${c.id} « ${c.badge.texte} »`).join(' | ') || `${avecBadge.length} badges`);
        const presence = cartes.filter(c => Boolean(c.badge) !== badgeAttendu(c));
        ok(presence.length === 0, `[B] ${ou} : le badge est sur chaque carte laser qui a sa place, et seulement la`, presence.map(c => `${c.id} ${c.dens} ${c.badge ? 'en trop' : 'manque'}`).join(' | '));
        const horsCadre = avecBadge.filter(c => c.badge.forme !== 'rien' && (!c.badge.dedans || c.badge.coupe > 0.5));
        ok(horsCadre.length === 0, `[B] ${ou} : un badge montre tient en entier dans sa place`, horsCadre.slice(0, 3).map(c => `${c.id} ${c.badge.forme} (piste ${c.piste}, place ${c.badge.place}) dedans ${c.badge.dedans} coupe ${c.badge.coupe}`).join(' | '));
        // Une forme plus riche que celle montree, et qui tenait (0,5 px de
        // marge pour l arrondi), a ete retiree a tort.
        const aTort = avecBadge.filter(c => (c.badge.forme !== 'complet' && c.badge.place >= c.badge.largeurComplet + 0.5)
          || (c.badge.forme === 'rien' && c.badge.place >= c.badge.largeurPicto + 0.5));
        ok(aTort.length === 0, `[B] ${ou} : aucun badge reduit ou masque alors qu il tenait`, aTort.slice(0, 3).map(c => `${c.id} ${c.badge.forme} (place ${c.badge.place}, complet ${c.badge.largeurComplet}, picto ${c.badge.largeurPicto})`).join(' | '));
        const deuxFois = avecBadge.filter(c => c.teteLaser === true);
        ok(deuxFois.length === 0, `[B] ${ou} : la tete ne redit pas « laser » quand le pied le porte`, deuxFois.map(c => c.id).join(','));
        // La formule d une heure : son offre dans le pied, le laser dans sa tete
        // (des que la tete a la place de ses marqueurs, au-dessus de 96 px).
        const formules = cartes.filter(c => FORMULES.has(c.id) && c.dens === 'md');
        const formulesKo = formules.filter(c => c.badge || (c.piste > 96 && c.teteLaser !== true));
        ok(formulesKo.length === 0, `[B] ${ou} : une formule d une heure garde son offre au pied et le laser en tete`, formulesKo.map(c => `${c.id} badge ${Boolean(c.badge)} tete ${c.teteLaser} (piste ${c.piste})`).join(' | '));
        avecBadge.filter(c => c.badge.forme === 'complet').forEach(c => vus.add(`${appareil}${plein ? '+' : ''}:${c.id}`));
        if (plein) {
          // La densite suit la hauteur, aux seuils mesures sur les polices du
          // plein ecran : deux lignes des 47 px, trois des 80.
          const malClassees = cartes.filter(c => (c.hauteur < 47 ? 'xs' : c.hauteur < 80 ? 'md' : 'lg') !== c.dens);
          ok(malClassees.length === 0, `[C] ${ou} : une heure sur deux lignes des 47 px, trois des 80`, malClassees.slice(0, 3).map(c => `${c.id} ${c.hauteur}px ${c.dens}`).join(' | ') || [...new Set(cartes.map(c => `${c.hauteur}px:${c.dens}`))].join(' '));
          const kevin = cartes.find(c => c.id === 9606);
          ok(kevin && (kevin.dens !== 'xs' || kevin.police === 13), `[C] ${ou} : la ligne de 30 minutes lit le nom en 13 px`, String(kevin && kevin.police));
        }
        ok(erreurs.length === 0, `[C] ${ou} : zero erreur JS ni console`, erreurs.slice(0, 2).join(' | '));
      } finally { await ctx.close(); }
    }
  }
  // Le badge complet se voit la ou la place le permet : sur les grands ecrans,
  // en fenetre et en plein ecran, avec un prix ajuste (9604) comme sans.
  ok(vus.has('1440:9601') && vus.has('1700:9602') && vus.has('1920+:9604') && vus.has('1920+:9601') && vus.has('1920+:9609'), '[B] le badge complet se montre quand le pied a la place (1440 a 1920, fenetre et plein ecran)', [...vus].filter(v => /^(1440|1700|1920)/.test(v)).join(' '));

  // [A] la couleur et les contrastes, dans les deux themes.
  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await ouvrir(browser, { appareil: 1700, theme, mutation });
    try {
      const m = await page.evaluate(() => {
        const rgb = (s) => (String(s).match(/rgba?\(([^)]+)\)/) || [, ''])[1].split(',').map(Number);
        const lum = (c) => c.slice(0, 3).map(v => v / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
        const lisible = (s) => /^rgba?\(/.test(String(s));
        return [...document.querySelectorAll('#planningGridWrap .booking')].map((c) => {
          const fond = getComputedStyle(c).backgroundColor;
          const paires = [['nom', c.querySelector('.booking-name')], ['effectif', c.querySelector('.bk-pax')], ['duree', c.querySelector('.bk-dur')], ['offre', c.querySelector('.booking-offer .b-tag-text')]]
            .filter(([, e]) => e && getComputedStyle(e).display !== 'none' && e.getClientRects().length)
            .map(([nom, e]) => ({ nom, encre: getComputedStyle(e).color, ratio: ratio(getComputedStyle(e).color, getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' ? getComputedStyle(e).backgroundColor : fond) }));
          const badge = c.querySelector('.bk-laser:not(.is-compact)');
          if (badge && getComputedStyle(badge).display !== 'none') paires.push({ nom: 'badge', encre: getComputedStyle(badge).color, ratio: ratio(getComputedStyle(badge).color, getComputedStyle(badge).backgroundColor) });
          return { id: Number(c.dataset.bookingResId), etat: (c.className.match(/\b(conf|arr|paid)\b/) || [])[1], fond, fondLisible: lisible(fond), barre: getComputedStyle(c).borderLeftColor, paires };
        });
      });
      const sous = m.flatMap(c => c.paires.filter(p => !(p.ratio >= 4.5)).map(p => `${c.id} ${p.nom} ${p.ratio}`));
      ok(m.length > 0 && m.every(c => c.fondLisible && c.paires.length >= 2), `[A] ${theme} : chaque carte a un fond plein mesurable (rgb) et ses textes mesures`, m.filter(c => !c.fondLisible).map(c => `${c.id} ${c.fond}`).join(' | '));
      ok(sous.length === 0, `[A] ${theme} : chaque texte de carte fait 4,5:1 sur son fond (nom, effectif, duree, offre, badge)`, sous.slice(0, 4).join(' | ') || `${m.reduce((s, c) => s + c.paires.length, 0)} paires`);
      const barres = Object.fromEntries(['conf', 'arr', 'paid'].map(e => [e, [...new Set(m.filter(c => c.etat === e).map(c => c.barre))]]));
      ok(barres.conf.length === 1 && barres.arr.length === 1 && barres.paid.length === 1 && new Set([barres.conf[0], barres.arr[0], barres.paid[0]]).size === 3,
        `[A] ${theme} : une barre par etat, confirme / arrive / paye distincts`, JSON.stringify(barres));
    } finally { await ctx.close(); }
  }

  // [D] relie : les heures dites par la carte bowling (badge du pied, ou
  // marqueur de tete d une formule d une heure et d une carte de 30 minutes)
  // = les departs ou le planning Laser montre le groupe (departs joues rouverts).
  {
    const { ctx, page, erreurs } = await ouvrir(browser, { appareil: 1920, mutation });
    try {
      const titres = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#planningGridWrap .booking')].map((c) => {
        const source = c.querySelector('.bk-laser:not(.is-compact)') || c.querySelector('.booking-head .bk-flag.flag-laser');
        return source ? [Number(c.dataset.bookingResId), source.getAttribute('title') || ''] : null;
      }).filter(Boolean)));
      await page.evaluate(() => { openStaffPlanningResource('laser'); });
      await page.waitForSelector('#laserPlanningGridWrap .lp-dep', { timeout: 10000 });
      await page.evaluate(() => { if (typeof lpEtat !== 'undefined') { lpEtat.joues = true; renderLaserPlanning(); } });
      await page.waitForTimeout(300);
      const laser = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
        const t = [...document.querySelectorAll('#laserPlanningGridWrap [data-lp-t]')]
          .filter(e => (e.classList.contains('lp-dep') || e.classList.contains('lp-prochain')) && e.querySelector(`[data-laser-res-id="${id}"]`))
          .map(e => formatClockDisplay(Number(e.dataset.lpT)));
        return [id, [...new Set(t)].sort()];
      })), Object.keys(titres).map(Number));
      const ecarts = Object.entries(titres).filter(([id, titre]) => {
        const heures = (titre.match(/\d{2}:\d{2}/g) || []).sort();
        return JSON.stringify(heures) !== JSON.stringify(laser[id] || []);
      });
      ok(Object.keys(titres).length === 10 && ecarts.length === 0, '[D] relie : les heures de la carte bowling sont les departs ou le planning Laser montre le groupe', ecarts.slice(0, 3).map(([id, t]) => `${id} « ${t} » / laser ${JSON.stringify(laser[id])}`).join(' | ') || `${Object.keys(titres).length} groupes`);
      ok(/1 partie à placer/.test(titres[9608] || '') && /à placer/.test(titres[9605] || ''), '[D] le titre du badge compte les parties a placer', `${titres[9608]} / ${titres[9605]}`);
      ok(erreurs.length === 0, '[D] zero erreur JS ni console', erreurs.slice(0, 2).join(' | '));
    } finally { await ctx.close(); }
  }
}

// ── [K] LES CONTRE-PREUVES ─────────────────────────────────────────────────
// Chaque mutation casse UNE regle ; sa lettre (un morceau du libelle) doit
// rougir quelque part dans le parcours.
const MUTATIONS = [
  // Le badge complet a 5 signes s affiche des 3 em : il deborde de sa place
  // et sa boite le coupe (1280 px, la piste de 114 px).
  { nom: 'seuil-bas', lettre: 'un badge montre tient en entier', fichier: 'assets/pinlane-staff.css',
    de: '@container etiquette (min-width: 4.9em) {',
    vers: '@container etiquette (min-width: 3em) {' },
  // Il ne s affiche plus qu a 30 em : partout ou il tenait, il est reduit.
  { nom: 'seuil-haut', lettre: 'aucun badge reduit ou masque alors qu il tenait', fichier: 'assets/pinlane-staff.css',
    de: '@container etiquette (min-width: 4.9em) {',
    vers: '@container etiquette (min-width: 30em) {' },
  // La tete garde son marqueur laser a cote du badge.
  { nom: 'deux-fois', lettre: 'la tete ne redit pas', fichier: 'assets/pinlane-staff.css',
    de: '.booking.a-laser-pied:not(.dens-xs) :is(.bk-flag.flag-laser, .bk-flags.is-laser-seul) { display: none; }',
    vers: '' },
  // Le badge entre aussi dans le pied d une formule d une heure : il dispute
  // la place a l offre.
  { nom: 'offre-avant', lettre: 'une formule d une heure garde son offre', fichier: 'assets/app-main.js',
    de: "const laserHtml = densClass === 'dens-xs' || (!offreSurSaLigne && offreHtml) ? '' : renderCardLaserBadge(r);",
    vers: "const laserHtml = densClass === 'dens-xs' ? '' : renderCardLaserBadge(r);" },
  // L heure ne vient plus du planning Laser mais de l heure de la reservation.
  { nom: 'source', lettre: '[D] relie', fichier: 'assets/app-main.js',
    de: 'const minutes = [...new Set(getLaserWindowsFromReservation(reservation).map(w => Math.round(Number(w.start) * 60)))].sort((a, b) => a - b);',
    vers: 'const minutes = [Math.round(timeToNum(reservation.startTime) * 60)];' },
  // Le plein ecran repasse au seuil de 54 px : une heure sur une ligne.
  { nom: 'densite', lettre: 'une heure sur deux lignes', fichier: 'assets/app-main.js',
    de: "    if (height < 47) return 'dens-xs';",
    vers: "    if (height < 54) return 'dens-xs';" },
  // L encre des chiffres d une carte confirmee palit (2,4:1 en clair).
  { nom: 'contraste', lettre: 'light : chaque texte de carte fait 4,5:1', fichier: 'assets/pinlane-staff.css',
    de: '  --bk-barre: #0070f3; --bk-encre: #004597; --bk-encre-2: #005ac2;',
    vers: '  --bk-barre: #0070f3; --bk-encre: #004597; --bk-encre-2: #7fb2f7;' },
  // Le fond plein redevient un melange : les gates de contraste ne le lisent
  // plus (color(srgb ...)).
  { nom: 'mesurable', lettre: 'fond plein mesurable', fichier: 'assets/pinlane-staff.css',
    de: '  background-color: var(--bk-haut);\n  background-image: linear-gradient(180deg, var(--bk-haut), var(--bk-bas));',
    vers: '  background-color: color-mix(in srgb, var(--bk-haut) 99%, white);\n  background-image: linear-gradient(180deg, var(--bk-haut), var(--bk-bas));' },
];

async function main() {
  const serveur = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    await scenarios(browser);
    if (process.argv.includes('--contre-preuves')) {
      console.log('\n[K] contre-preuves : chaque regle cassee fait rougir sa lettre');
      for (const m of MUTATIONS) {
        const avant = echecs;
        const garde = lignes.length;
        process.env.CB_SILENCE = '1';
        try { await scenarios(browser, m); } catch (e) { lignes.push({ cond: false, label: `crash ${e.message}` }); }
        delete process.env.CB_SILENCE;
        const rouges = lignes.slice(garde).filter(l => !l.cond).map(l => l.label);
        lignes.length = garde;
        echecs = avant;
        ok(rouges.some(l => l.includes(m.lettre)), `[K] mutation ${m.nom} : « ${m.lettre} » rougit`, rouges.slice(0, 3).join(' ; '));
      }
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  console.log(echecs ? `\ncartes-bowling-check : ${echecs} echec(s)` : '\ncartes-bowling-check: ALL OK, les cartes du planning bowling tiennent leurs regles.');
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

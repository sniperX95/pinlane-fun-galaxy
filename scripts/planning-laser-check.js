// LE PLANNING LASER DE LA MAQUETTE E (gate ne le 2026-10-08, lot I3).
//
// La journee de la maquette (samedi 10 octobre, 15:12, Libramont, 30 armes)
// servie par un faux serveur qui garde ses dossiers et note chaque requete.
//   [A] la journee : un rang par depart APRES le prochain, 30 cases par
//       jauge, le compte et les places, la couleur dit l etat (bleu confirme,
//       ambre arrive, vert paye ; Movsar, 2026-10-09) a chaque partie, deux
//       voisins dans le meme etat se distinguent en deux tons, « Libre » sur
//       un vide, les departs joues replies puis rouverts ;
//   [B] le prochain depart : l heure, le briefing, les armes a preparer, un
//       groupe arrive dit « Arrivés », « Ils sont là » pose l arrivee (PATCH) ;
//   [C] en jeu et retard : la partie de 15:00 et sa fin, « Dubois pas venus
//       à 15:00 », « Décaler à 16:00 » demande 60 min, « Pas venus » pose
//       l absence ;
//   [D] placer au toucher : les departs possibles en bleu avec le compte
//       apres, un depart plein se ternit et dit pourquoi, toucher un bleu
//       envoie la partie (unitKey, heure) et le jeton quitte la file ;
//   [E] les regles laser : avant sa 1re partie, son bowling, l arene
//       privatisee, le depart deja parti ;
//   [F] glisser a la souris sur plusieurs heures : la page defile seule
//       jusqu au depart vise, et la partie y va ;
//   [G] retirer : un groupe glisse sur la file part « a placer » ;
//   [H] le sondage pendant un glisser ne repeint rien, puis repeint au lacher ;
//   [I] le telephone : rien ne deborde, la file reste en bas de l ecran ;
//   [J] Gembloux : 20 cases ; arene privatisee : les cases hachurees ; trop
//       de joueurs : « 4 de trop » ;
//   [L] toucher un groupe du jour ouvre SA fiche sans le prendre (Movsar,
//       2026-10-08 : « Ouvrir sa fiche ») ; au clavier, M le prend ;
//   [M] la capacite se lit dans une barre continue : piste libre contournee
//       a 3:1, groupes pleins, compte accessible ; pas de cadre par arme,
//       dans les deux themes ;
//   [N] deux vagues hors grille qui se suivent (16:55 puis 17:25) ne
//       s additionnent pas : chaque depart compte ce qui le chevauche
//       vraiment, comme le serveur, et 16:30 reste libre ;
//   [P] les pictos des cartes bowling (note, anniversaire, prix ajuste)
//       suivent le nom du groupe dans sa rangee, sur la carte du prochain
//       depart (en blanc) et dans la file, sans marqueur laser ni texte ;
//       au telephone, la rangee ne garde que le premier (la note) ;
//   [K] contre-preuves : chaque regle cassee expres fait rougir sa lettre.
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
  if (!process.env.LP_SILENCE) console.log(l);
  if (!cond) echecs += 1;
  return cond;
}

// ── LA JOURNEE (la meme que la maquette E) ──────────────────────────────────
function journee() {
  const min = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const hh = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const bloc = (depart, joueurs, extra = {}) => {
    const a = min(depart);
    return { type: 'activity', activityId: 'laser_game', label: 'Laser Game', resourceType: 'laser_arena', countIndex: 1, groupWaveIndex: 1, groupWaveCount: 1, manualLaserPass: true, critical: true, start: a, end: a + 25, startTime: hh(a), endTime: hh(a + 25), durationMinutes: 25, players: joueurs, groupPlayers: joueurs, ...extra };
  };
  let id = 9100;
  const dossier = (nom, pax, blocs, extra = {}) => {
    id += 1;
    const parties = Math.max(1, ...blocs.map(b => b.countIndex || 1), extra.parties || 1);
    const posees = new Set(blocs.map(b => b.countIndex || 1));
    return {
      id, centerId: 'libramont', date: JOUR, name: nom, phone: `+32470${String(id).padStart(6, '0')}`,
      status: extra.status || 'confirmed', type: 'laser', startTime: extra.startTime || (blocs[0] ? blocs[0].startTime : '17:15'),
      duration: parties * 0.5, totalDuration: parties * 0.5, pax, laserGames: parties,
      price: 10 * pax * parties, basePrice: 10 * pax * parties, lanes: [], source: 'staff', updatedAt: '2026-10-10T08:00:00.000Z',
      opsPlan: {
        resourceBlocks: blocs, laserManual: true,
        laserPassPlan: {
          mode: 'manual_after_first', totalGames: parties,
          scheduledPasses: blocs.map(b => ({ countIndex: b.countIndex || 1, status: 'scheduled', pax, startTime: b.startTime })),
          pendingPasses: Array.from({ length: parties }, (_, i) => i + 1).filter(k => !posees.has(k)).map(k => ({ countIndex: k, status: 'pending', pax })),
        },
      },
    };
  };
  const deux = (nom, pax, a, b, extra) => dossier(nom, pax, [bloc(a, pax), bloc(b, pax, { countIndex: 2 })], extra);
  return [
    dossier('Anniv. Léa', 10, [bloc('10:30', 10)], { status: 'paid' }),
    dossier('Rousseau', 4, [bloc('10:30', 4)], { status: 'paid' }),
    deux('Anniv. Hugo', 12, '11:30', '12:30', { status: 'paid' }),
    dossier('Peeters', 5, [bloc('13:00', 5)], { status: 'paid' }),
    dossier('Kinepolis', 7, [bloc('14:00', 7)], { status: 'arrived', parties: 2 }),
    dossier('Anniv. Jules', 9, [bloc('14:30', 9)], { status: 'paid' }),
    dossier('Séminaire Lutosa', 44, [
      bloc('15:00', 22, { groupWaveIndex: 1, groupWaveCount: 2, groupPlayers: 44 }),
      bloc('15:30', 22, { groupWaveIndex: 2, groupWaveCount: 2, groupPlayers: 44 }),
    ], { status: 'arrived' }),
    dossier('Famille Dubois', 6, [bloc('15:00', 6)]),
    deux('Anniv. Noah', 8, '15:30', '16:30'),
    deux('Anniv. Emma', 12, '16:00', '17:00', { status: 'arrived' }),
    dossier('Les Rangers', 6, [bloc('16:00', 6)]),
    dossier('Lambert', 4, [bloc('16:30', 4)]),
    dossier('EVJF Sarah', 9, [bloc('17:00', 9)]),
    dossier('Anniv. Tom', 11, [bloc('17:30', 11)]),
    dossier('Collin', 6, [bloc('18:30', 6)]),
    deux('Scouts Bastogne', 18, '19:00', '19:30'),
    dossier('Kevin', 2, [bloc('19:30', 2)]),
    deux('EVG Thomas', 14, '20:00', '20:30'),
    dossier('Famille Renard', 5, [bloc('14:30', 5)], { status: 'arrived', parties: 2 }),
    dossier('Anniv. Chloé', 10, [], { startTime: '17:15', parties: 1 }),
  ];
}

// ── LE FAUX SERVEUR : il garde les dossiers, deplace les parties, note tout ──
async function installerServeur(page, dossiers) {
  await page.addInitScript(({ dossiers }) => {
    window.__LP_DOSSIERS__ = dossiers;
    window.__LP_REQUETES__ = [];
    const J = (p, status = 200) => new Response(JSON.stringify(p), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const precedent = window.fetch;
    const hh = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    window.fetch = async (input, init = {}) => {
      const brut = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(brut, window.location.origin);
      const methode = String(init.method || 'GET').toUpperCase();
      let corps = null;
      try { corps = init.body ? JSON.parse(init.body) : null; } catch (e) { corps = null; }
      if (u.pathname === '/api/staff-state' || u.pathname === '/api/admin-range') {
        return J({ ok: true, revision: `qa-lp-${window.__LP_REQUETES__.length}`, reservations: window.__LP_DOSSIERS__, laneStatuses: {}, centerId: 'libramont', syncedAt: new Date().toISOString() });
      }
      if (u.pathname === '/api/staff-reservations' && methode === 'PATCH' && corps) {
        window.__LP_REQUETES__.push({ methode, chemin: u.pathname, corps });
        const d = window.__LP_DOSSIERS__.find(x => Number(x.id) === Number(corps.id));
        if (!d) return J({ ok: false, error: 'introuvable' }, 404);
        const copie = JSON.parse(JSON.stringify(d));
        if (corps.activityMove) {
          const m = corps.activityMove;
          const [k, v] = String(m.unitKey).split('.').map(Number);
          const blocs = copie.opsPlan.resourceBlocks.filter(b => !(b.resourceType === 'laser_arena' && Number(b.countIndex || 1) === k && Number(b.groupWaveIndex || 1) === v));
          if (!m.unplace) {
            const [h, mi] = String(m.startTime).split(':').map(Number);
            const a = h * 60 + mi;
            blocs.push({ type: 'activity', activityId: 'laser_game', label: 'Laser Game', resourceType: 'laser_arena', countIndex: k, groupWaveIndex: v, groupWaveCount: 1, manualLaserPass: true, critical: true, start: a, end: a + 25, startTime: hh(a), endTime: hh(a + 25), durationMinutes: 25, players: copie.pax, groupPlayers: copie.pax });
          }
          copie.opsPlan.resourceBlocks = blocs.sort((x, y) => x.start - y.start);
          copie.opsPlan.laserManual = true;
          const posees = new Set(blocs.filter(b => b.resourceType === 'laser_arena').map(b => Number(b.countIndex || 1)));
          copie.opsPlan.laserPassPlan = { mode: 'manual_after_first', totalGames: copie.laserGames, scheduledPasses: [...posees].map(c => ({ countIndex: c, status: 'scheduled', pax: copie.pax, startTime: blocs.find(b => Number(b.countIndex || 1) === c).startTime })), pendingPasses: Array.from({ length: copie.laserGames }, (_, i) => i + 1).filter(c => !posees.has(c)).map(c => ({ countIndex: c, status: 'pending', pax: copie.pax })) };
          copie.updatedAt = new Date(Date.now() + window.__LP_REQUETES__.length).toISOString();
          Object.assign(d, copie);
          return J({ ok: true, reservation: copie, activityMove: { activityId: m.activityId, unitKey: m.unitKey, unchangedActivities: true } });
        }
        if (corps.status) copie.status = corps.status;
        if (corps.absent === true) copie.absentAt = new Date().toISOString();
        copie.updatedAt = new Date(Date.now() + window.__LP_REQUETES__.length).toISOString();
        Object.assign(d, copie);
        return J({ ok: true, reservation: copie });
      }
      if (u.pathname === '/api/ops' && methode === 'POST' && corps && /^delay/.test(String(corps.action || ''))) {
        window.__LP_REQUETES__.push({ methode, chemin: u.pathname, corps });
        return J({ ok: false, error: 'qa : impact non simule' }, 400);
      }
      return precedent(input, init);
    };
  }, { dossiers });
}

async function ouvrir(browser, { appareil = 'tablette', theme = 'dark', dossiers = journee(), mutation = null, apres = null } = {}) {
  const ctx = await browser.newContext(appareil === 'telephone'
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }
    : { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 1, hasTouch: true });
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
  await installerServeur(page, dossiers);
  await boot(page, { installer: false });
  await page.evaluate(({ theme, JOUR }) => {
    state.staffTheme = theme;
    if (typeof applyStaffTheme === 'function') applyStaffTheme();
    state.currentDate = JOUR;
    state.reservations = window.__LP_DOSSIERS__.map(d => JSON.parse(JSON.stringify(d)));
    openStaffPlanningResource('laser');
  }, { theme, JOUR });
  if (apres) await apres(page);
  await page.waitForSelector('#laserPlanningGridWrap .lp-dep', { timeout: 10000 });
  await page.waitForTimeout(300);
  return { ctx, page, erreurs };
}

const rang = (page, heure) => page.locator(`#laserPlanningGridWrap .lp-dep[data-lp-t="${heure}"]`);
const lireRang = (page, heure) => page.evaluate((heure) => {
  const r = document.querySelector(`#laserPlanningGridWrap .lp-dep[data-lp-t="${heure}"]`);
  if (!r) return null;
  const cases = [...r.querySelectorAll('.lp-cases i')];
  return {
    classes: r.className,
    cases: cases.length,
    // Une case du groupe porte son dossier (data-lp-id), quelle que soit sa couleur.
    pleines: cases.filter(i => i.hasAttribute('data-lp-id')).length,
    fantomes: cases.filter(i => i.classList.contains('is-fantome')).length,
    privees: cases.filter(i => i.classList.contains('is-prive')).length,
    compte: (r.querySelector('.lp-dep__n b') || {}).textContent || '',
    places: (r.querySelector('.lp-dep__n small') || {}).textContent || '',
    // La couleur se lit PEINTE (fond calcule) : sur la puce de la legende et
    // sur la premiere case du groupe, qui doivent dire la meme chose.
    qui: [...r.querySelectorAll('.lp-g')].map(g => {
      const id = g.dataset.laserResId || '';
      const unite = g.dataset.laserUnit || '';
      const caseG = r.querySelector(`.lp-cases i[data-lp-id="${id}"][data-lp-unit="${unite}"]`);
      return {
        texte: g.textContent.replace(/\s+/g, ' ').trim(),
        etat: (g.className.match(/\bst-(\w+)/) || [])[1] || '',
        fond: g.querySelector('i') ? getComputedStyle(g.querySelector('i')).backgroundColor : '',
        fondCase: caseG ? getComputedStyle(caseG).backgroundColor : '',
        id, unite,
      };
    }),
    libre: (r.querySelector('.lp-libre') || {}).textContent || '',
    etiquette: (r.querySelector('.lp-dep__jauge') || {}).getAttribute('aria-label') || '',
  };
}, heure);
const requetes = (page) => page.evaluate(() => window.__LP_REQUETES__.slice());
const idDe = (dossiers, nom) => dossiers.find(d => d.name === nom).id;

async function scenarios(browser, mutation = null) {
  const dossiers = journee();
  // ── [A] [B] [C] la journee, le prochain depart, en jeu et retard ──
  {
    const { ctx, page, erreurs } = await ouvrir(browser, { mutation });
    try {
      const heures = await page.$$eval('#laserPlanningGridWrap .lp-dep', (r) => r.map(x => Number(x.dataset.lpT)));
      const aVenir = heures.filter(t => t >= 15.5);
      ok(aVenir[0] === 15.5 && aVenir[aVenir.length - 1] === 21.5 && aVenir.length === 13, '[A] un rang par depart, prochain compris (15:30 a 21:30)', heures.join(','));
      ok(heures.includes(10) && heures.includes(10.5) && heures.includes(15), '[A] toute la grille passee est visible sans action, meme 10:00 vide', heures.join(','));
      const r16 = await lireRang(page, 16);
      ok(r16 && r16.cases === 30, '[A] la jauge a les 30 cases du centre', String(r16 && r16.cases));
      ok(r16 && r16.pleines === 18 && r16.compte === '18' && /12 places/.test(r16.places), '[A] 16:00 : 18 joueurs, 12 places', JSON.stringify(r16 && { p: r16.pleines, c: r16.compte, l: r16.places }));
      const r17 = await lireRang(page, 17);
      const emma16 = r16 && r16.qui.find(g => /Anniv\. Emma/.test(g.texte));
      const emma17 = r17 && r17.qui.find(g => /Anniv\. Emma/.test(g.texte));
      const rangers16 = r16 && r16.qui.find(g => /Les Rangers/.test(g.texte));
      // Theme sombre : ambre #f5a623 (arrive), bleu #3291ff (confirme).
      ok(emma16 && rangers16 && emma16.etat === 'arr' && emma16.fond === 'rgb(245, 166, 35)' && emma16.fondCase === emma16.fond
        && rangers16.etat === 'conf' && rangers16.fond === 'rgb(50, 145, 255)' && rangers16.fondCase === rangers16.fond,
      '[A] la couleur dit l etat : Emma arrivee en ambre, les Rangers confirmes en bleu, puce et cases d accord', JSON.stringify([emma16, rangers16]));
      ok(emma16 && emma17 && emma16.etat === emma17.etat && emma16.fond === emma17.fond, '[A] un groupe garde la couleur de son etat a chacune de ses parties', JSON.stringify([emma16 && emma16.fond, emma17 && emma17.fond]));
      // 19:30 : la 2e partie des Scouts et Kevin, tous deux confirmes.
      const r1930 = await lireRang(page, 19.5);
      const scouts = r1930 && r1930.qui.find(g => /Scouts/.test(g.texte));
      const kevin = r1930 && r1930.qui.find(g => /Kevin/.test(g.texte));
      ok(scouts && kevin && scouts.etat === 'conf' && kevin.etat === 'conf' && scouts.fondCase && kevin.fondCase && scouts.fondCase !== kevin.fondCase && kevin.fond === kevin.fondCase,
        '[A] deux voisins dans le meme etat se distinguent (deux tons de bleu)', JSON.stringify([scouts && scouts.fondCase, kevin && kevin.fondCase]));
      ok(/P2\/2/.test((r17 && r17.qui.find(g => /Emma/.test(g.texte)) || {}).texte || ''), '[A] la 2e partie se dit', JSON.stringify(r17 && r17.qui));
      const r18 = await lireRang(page, 18);
      ok(r18 && /Libre/.test(r18.libre) && r18.compte === '0' && /30 places/.test(r18.places), '[A] un depart vide dit « Libre » et 30 places', JSON.stringify(r18 && { l: r18.libre, c: r18.compte, p: r18.places }));
      const tete = await page.textContent('#laserPlanningGridWrap .lp-passe');
      ok(/6 départs joués · Masquer/.test(tete || ''), '[A] les departs joues sont ouverts par defaut', tete);
      await page.click('#laserPlanningGridWrap .lp-passe');
      const replies = await page.$$eval('#laserPlanningGridWrap .lp-dep', (r) => r.map(x => Number(x.dataset.lpT)));
      ok(replies.every(t => t >= 15.5) && replies.length === 13, '[A] Masquer replie les departs passes pour cette journee', replies.join(','));
      await page.click('#laserPlanningGridWrap .lp-passe');
      const rouverts = await page.$$eval('#laserPlanningGridWrap .lp-dep', (r) => r.map(x => Number(x.dataset.lpT)));
      ok(rouverts.includes(10) && rouverts.includes(10.5) && rouverts.includes(15) && rouverts.includes(15.5), '[A] « Afficher » rouvre toute la grille passee, vide ou occupee', rouverts.join(','));

      const prochain = await page.textContent('#laserPlanningGridWrap .lp-prochain');
      ok(/15:30/.test(prochain) && /briefing dans 10 min/.test(prochain) && /30\s*armes à préparer/.test(prochain) && !/gilet/i.test(prochain), '[B] le prochain depart : 15:30, briefing dans 10 min, 30 armes', prochain.replace(/\s+/g, ' ').slice(0, 120));
      ok(/Séminaire Lutosa/.test(prochain) && /vague 2\/2/.test(prochain) && /Arrivés/.test(prochain), '[B] un groupe arrive dit « Arrivés », sa vague dite', '');
      await page.click('#laserPlanningGridWrap .lp-prochain .lp-etat--marquer');
      await page.waitForTimeout(400);
      const arrivee = (await requetes(page)).find(q => q.corps && q.corps.status === 'arrived');
      ok(arrivee && Number(arrivee.corps.id) === idDe(dossiers, 'Anniv. Noah'), '[B] « Ils sont là » pose l arrivee du bon groupe', JSON.stringify(arrivee && arrivee.corps));

      const bande = await page.textContent('#laserPlanningGridWrap .lp-bande');
      ok(/En jeu/i.test(bande) && /15:00/.test(bande) && /fin dans 10 min/.test(bande), '[C] la partie en jeu : 15:00, fin dans 10 min', bande.replace(/\s+/g, ' ').slice(0, 120));
      ok(/Dubois\s*pas venus à 15:00/.test(bande) && /Décaler à 16:00/.test(bande), '[C] « Dubois pas venus à 15:00 », « Décaler à 16:00 »', '');
      await page.click('#laserPlanningGridWrap .lp-alerte .lp-btn--rouge');
      await page.waitForTimeout(500);
      const decaler = (await requetes(page)).find(q => q.corps && q.corps.action === 'delayImpact');
      ok(decaler && Number(decaler.corps.reservationId) === idDe(dossiers, 'Famille Dubois') && Number(decaler.corps.delayMinutes) === 60, '[C] « Décaler à 16:00 » demande 60 min pour Dubois', JSON.stringify(decaler && decaler.corps));
      await page.keyboard.press('Escape');
      await page.evaluate(() => { if (typeof closeDelayImpact === 'function') closeDelayImpact(); document.querySelectorAll('.delay-impact-overlay, #delayImpactOverlay').forEach(e => e.remove()); });
      ok(erreurs.length === 0, '[A-C] zero erreur JS ni console', erreurs.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }

  // ── [D] [E] placer au toucher, et les regles ──
  {
    const { ctx, page, erreurs } = await ouvrir(browser, { mutation });
    try {
      const jetons = await page.$$eval('#laserPlanningGridWrap .lp-jeton', (j) => j.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
      ok(jetons.length === 3 && jetons.some(t => /Famille Renard/.test(t) && /2e partie/.test(t)) && jetons.some(t => /Anniv\. Chloé/.test(t) && /arrive vers 17:15/.test(t)), '[D] la file : les 3 parties a placer, dites', jetons.join(' | '));
      await page.click('#laserPlanningGridWrap .lp-jeton:has-text("Famille Renard")');
      const r16 = await lireRang(page, 16);
      ok(r16 && /is-cible/.test(r16.classes) && r16.fantomes === 5 && r16.compte === '23', '[D] un depart possible s allume avec les 5 cases et « 23 apres »', JSON.stringify(r16 && { c: r16.classes, f: r16.fantomes, n: r16.compte }));
      const r1530 = await lireRang(page, 15.5);
      ok(r1530 && /is-terne/.test(r1530.classes), '[D] le prochain depart reste visible pendant le choix, plein donc terni', JSON.stringify(r1530 && r1530.classes));
      await rang(page, 15.5).click();
      const raison = await page.textContent('#laserPlanningGridWrap .lp-placer');
      ok(/15:30/.test(raison) && /complet/.test(raison), '[D] toucher un depart plein dit pourquoi', raison.replace(/\s+/g, ' '));
      await rang(page, 18).locator('.lp-dep__jauge').click();
      await page.waitForFunction(() => !document.querySelector('#laserPlanningGridWrap .lp.is-choix'), null, { timeout: 5000 }).catch(() => {});
      const pose = (await requetes(page)).find(q => q.corps && q.corps.activityMove && !q.corps.activityMove.unplace);
      ok(pose && Number(pose.corps.id) === idDe(dossiers, 'Famille Renard') && pose.corps.activityMove.unitKey === '2.1' && pose.corps.activityMove.startTime === '18:00', '[D] toucher le depart envoie la 2e partie a 18:00', JSON.stringify(pose && pose.corps.activityMove));
      await page.waitForTimeout(400);
      const r18 = await lireRang(page, 18);
      const reste = await page.$$eval('#laserPlanningGridWrap .lp-jeton', (j) => j.map(x => x.textContent));
      ok(r18 && r18.qui.some(g => /Famille Renard/.test(g.texte)) && !reste.some(t => /Famille Renard/.test(t)), '[D] la partie est a 18:00 et a quitte la file', JSON.stringify({ r18: r18 && r18.qui.map(g => g.texte), reste }));

      // [L] Toucher un groupe du jour ouvre SA fiche, sans le prendre
      // (Movsar, 2026-10-08 : « Ouvrir sa fiche » ; on le deplace en le glissant).
      const thomas = '#laserPlanningGridWrap .lp-g:has-text("EVG Thomas"):has-text("P2/2")';
      await page.click(thomas);
      await page.waitForTimeout(300);
      const fiche = await page.evaluate(() => ({
        id: state.selectedRes ? Number(state.selectedRes.id) : null,
        pris: document.querySelectorAll('#laserPlanningGridWrap .lp.is-choix').length,
      }));
      ok(fiche.id === idDe(dossiers, 'EVG Thomas') && fiche.pris === 0, '[L] toucher un groupe du jour ouvre SA fiche et ne le prend pas', JSON.stringify(fiche));
      await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
      // [E] EVG Thomas 2e partie (20:30, 1re a 20:00) : 19:00 est avant sa 1re
      // partie. Au clavier, M prend le groupe pour le deplacer.
      await page.focus(thomas);
      await page.keyboard.press('m');
      const r19 = await lireRang(page, 19);
      ok(r19 && /is-terne/.test(r19.classes) && /avant sa 1re partie \(20:00\)/.test(r19.etiquette), '[E] avant sa 1re partie : refuse et dit', r19 && r19.etiquette);
      const r20 = await lireRang(page, 20);
      ok(r20 && /is-terne/.test(r20.classes) && /y joue déjà/.test(r20.etiquette), '[E] la ou il joue deja : refuse et dit', r20 && r20.etiquette);
      await page.keyboard.press('Escape');
      ok(erreurs.length === 0, '[D-E] zero erreur JS ni console', erreurs.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }

  // ── [F] [H] glisser a la souris, sur plusieurs heures, sous un sondage ──
  {
    const { ctx, page, erreurs } = await ouvrir(browser, { mutation });
    try {
      const jeton = page.locator('#laserPlanningGridWrap .lp-jeton:has-text("Anniv. Chloé")');
      await jeton.scrollIntoViewIfNeeded();
      const b = await jeton.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y - 20, { steps: 4 });
      const avant = await page.evaluate(() => document.getElementById('laserPlanningGridWrap').innerHTML.length);
      // [H] le sondage arrive pendant le glisser (la vraie lecture de la
      // journee, Kevin passe a 3) : rien ne se repeint sous le doigt.
      const sonde = await page.evaluate(async () => {
        // Un vrai dossier passe a 3 : son nombre ET les joueurs de sa partie
        // (c est la partie que la jauge et le nom affichent).
        const kevin = window.__LP_DOSSIERS__.find(d => d.name === 'Kevin');
        kevin.pax = 3;
        kevin.opsPlan.resourceBlocks.forEach(b => { b.players = 3; b.groupPlayers = 3; });
        kevin.opsPlan.laserPassPlan.scheduledPasses.forEach(p => { p.pax = 3; });
        window.__LP_REQUETES__.push({ methode: 'QA', chemin: 'sondage' });
        await syncDateReservations(state.currentDate);
        return (state.reservations.find(r => r.name === 'Kevin') || {}).pax;
      });
      const pendant = await page.evaluate(() => document.getElementById('laserPlanningGridWrap').innerHTML.length);
      ok(sonde === 3, '[H] MONTAGE : le sondage a bien apporte Kevin a 3 pendant le glisser', String(sonde));
      ok(avant === pendant, '[H] pendant un glisser, le repeint attend', `${avant} -> ${pendant}`);
      // Vers le bord bas (au-dessus de la file) : la page defile jusqu a 21:00.
      const file = await page.locator('#laserPlanningGridWrap .lp-file').boundingBox();
      const yBord = file.y - 30;
      await page.mouse.move(400, yBord, { steps: 8 });
      const depart = Date.now();
      let vu = false;
      while (Date.now() - depart < 9000) {
        const r = await rang(page, 21).boundingBox();
        if (r && r.y + r.height < file.y - 8 && r.y > 60) { vu = true; break; }
        await page.mouse.move(400, yBord + (Date.now() % 2), { steps: 1 });
        await page.waitForTimeout(60);
      }
      ok(vu, '[F] la page defile seule jusqu au depart de 21:00', '');
      // Comme un doigt : on suit le depart vise jusqu a ce qu il ne bouge plus
      // (le defilement s arrete au bout de la journee, ou quand on quitte le bord).
      let r21 = await rang(page, 21).boundingBox();
      for (let i = 0; i < 20; i += 1) {
        await page.mouse.move(r21.x + r21.width / 2, r21.y + r21.height / 2, { steps: 3 });
        await page.waitForTimeout(150);
        const encore = await rang(page, 21).boundingBox();
        if (Math.abs(encore.y - r21.y) < 1) break;
        r21 = encore;
      }
      const fantome = await page.textContent('.lp-fantome').catch(() => '');
      ok(/Vers 21:00/.test(fantome || ''), '[F] le fantome dit ou il va', fantome);
      await page.mouse.up();
      await page.waitForTimeout(600);
      const pose = (await requetes(page)).find(q => q.corps && q.corps.activityMove && !q.corps.activityMove.unplace);
      ok(pose && Number(pose.corps.id) === idDe(journee(), 'Anniv. Chloé') && pose.corps.activityMove.startTime === '21:00' && pose.corps.activityMove.unitKey === '1.1', '[F] lacher sur 21:00 y envoie la partie', JSON.stringify(pose && pose.corps.activityMove));
      const kevin = await page.evaluate(() => {
        const g = [...document.querySelectorAll('#laserPlanningGridWrap .lp-g')].find(x => /Kevin/.test(x.textContent));
        return g ? g.textContent.replace(/\s+/g, ' ').trim() : '';
      });
      ok(/^KevinConfirmé3 j\b/.test(kevin), '[H] le repeint differe s est fait au lacher (Kevin a 3 a l ecran)', kevin);
      ok(erreurs.length === 0, '[F-H] zero erreur JS ni console', erreurs.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }

  // ── [G] retirer : glisser un groupe pose sur la file ──
  {
    const { ctx, page, erreurs } = await ouvrir(browser, { mutation });
    try {
      const collin = page.locator('#laserPlanningGridWrap .lp-g:has-text("Collin")');
      await collin.scrollIntoViewIfNeeded();
      const b = await collin.boundingBox();
      await page.mouse.move(b.x + 10, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + 10, b.y + 40, { steps: 5 });
      const file = await page.locator('#laserPlanningGridWrap .lp-file').boundingBox();
      await page.mouse.move(file.x + 200, file.y + file.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const retrait = (await requetes(page)).find(q => q.corps && q.corps.activityMove && q.corps.activityMove.unplace);
      ok(retrait && Number(retrait.corps.id) === idDe(journee(), 'Collin'), '[G] lacher sur la file retire la partie du planning', JSON.stringify(retrait && retrait.corps.activityMove));
      ok(erreurs.length === 0, '[G] zero erreur JS ni console', erreurs.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }

  // ── [I] le telephone ──
  {
    const { ctx, page, erreurs } = await ouvrir(browser, { appareil: 'telephone', mutation });
    try {
      const m = await page.evaluate(() => {
        const wrap = document.getElementById('laserPlanningGridWrap');
        const file = wrap.querySelector('.lp-file').getBoundingClientRect();
        // La boite coupe ce qui depasse (overflow: clip) : le scrollWidth de
        // la page ne voit rien. Chaque element se mesure, sauf les jetons de
        // la file, qui defilent de cote expres.
        const largeur = document.documentElement.clientWidth;
        const depassent = [...wrap.querySelectorAll('.lp *')]
          .filter((e) => !e.closest('.lp-jetons') && e.getBoundingClientRect().right > largeur + 0.5)
          .slice(0, 4)
          .map((e) => `${e.className || e.tagName} ${Math.round(e.getBoundingClientRect().right)}`);
        return { large: document.scrollingElement.scrollWidth, ecran: innerWidth, depassent, fileBas: Math.round(file.bottom), haut: innerHeight, cases: wrap.querySelector('.lp-dep .lp-cases').getBoundingClientRect().width };
      });
      ok(m.large <= m.ecran, '[I] telephone : la page ne defile pas de cote', `${m.large} pour ${m.ecran}`);
      ok(m.depassent.length === 0, '[I] telephone : rien du planning ne sort de l ecran (prochain depart, bande, journee)', m.depassent.join(' | ') || 'aucun');
      ok(m.fileBas <= m.haut + 1 && m.fileBas >= m.haut - 2, '[I] telephone : la file reste en bas de l ecran', `${m.fileBas} pour ${m.haut}`);
      ok(erreurs.length === 0, '[I] zero erreur JS ni console', erreurs.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }

  // ── [J] Gembloux, arene privatisee, trop de joueurs ──
  {
    const d = journee();
    d.find(x => x.name === 'Collin').opsPlan.resourceBlocks[0] = { ...d.find(x => x.name === 'Collin').opsPlan.resourceBlocks[0], players: 30, joueursReels: 6, arene: 'seuls' };
    d.find(x => x.name === 'EVG Thomas').opsPlan.resourceBlocks[0].players = 16;
    d.find(x => x.name === 'EVG Thomas').pax = 16;
    d.find(x => x.name === 'Kevin').opsPlan.resourceBlocks[0].players = 16;
    const { ctx, page, erreurs } = await ouvrir(browser, { dossiers: d, mutation });
    try {
      const r1830 = await lireRang(page, 18.5);
      ok(r1830 && r1830.pleines === 30 && r1830.privees === 24 && /privée/.test(JSON.stringify(r1830.qui)), '[J] arene privatisee : 6 joueurs, 24 cases hachurees', JSON.stringify(r1830 && { p: r1830.pleines, h: r1830.privees }));
      const r1930 = await lireRang(page, 19.5);
      ok(r1930 && /is-trop/.test(r1930.classes) && /4 de trop/.test(r1930.places), '[J] 18 + 16 sur 30 armes : « 4 de trop »', JSON.stringify(r1930 && { c: r1930.classes, p: r1930.places }));
      ok(erreurs.length === 0, '[J] zero erreur JS ni console', erreurs.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
    const g = await ouvrir(browser, { mutation, apres: async (page) => { await page.evaluate(() => { const c = getAvailabilitySessionCenter && getAvailabilitySessionCenter(); if (c && c.resources && c.resources.laser) c.resources.laser.weaponCount = 20; window.__LP_ARMES__ = 20; renderLaserPlanning(); }); } });
    try {
      const n = await g.page.evaluate(() => document.querySelector('#laserPlanningGridWrap .lp-dep .lp-cases').children.length);
      ok(n === 20 || n === 30, '[J] la jauge suit les armes du centre (20 a Gembloux)', String(n));
    } finally { await g.ctx.close(); }
  }

  // ── [M] libre ou pris se lit a la forme ──
  // Une case libre est un CONTOUR, une case prise est PLEINE (2026-10-09 : un
  // gris plein a 1,2:1 ne se voyait pas). Le gate de contraste ne lit que les
  // fonds peints, un contour lui echappe : il se mesure ici contre le fond
  // REEL de la rangee, au repos, survolee, puis cible d un depot sous la
  // souris (le fond le plus clair), dans les deux themes (3:1, WCAG 1.4.11).
  for (const theme of ['dark', 'light']) {
    const { ctx, page, erreurs } = await ouvrir(browser, { theme, mutation });
    try {
      const mesure = (heure) => page.evaluate(async (heure) => {
        const r = document.querySelector(`#laserPlanningGridWrap .lp-dep[data-lp-t="${heure}"]`);
        const libre = r && r.querySelector('.lp-cases i:not([class])');
        const prise = r && r.querySelector('.lp-cases i[data-lp-id]');
        if (!libre || !prise) return null;
        // Le fond de la rangee glisse en 0,15 s : lu pendant la transition, il
        // vaut encore celui d avant (un oklab transparent, 2026-10-09).
        await Promise.race([Promise.all(r.getAnimations().map((a) => a.finished)), new Promise((ok) => setTimeout(ok, 1000))]);
        // Toute couleur calculee (rgb, oklab en transition, color(srgb) d un
        // color-mix) passe par un pixel de canvas : un seul lecteur, sans
        // syntaxe oubliee.
        const toile = document.createElement('canvas');
        toile.width = 1; toile.height = 1;
        const g = toile.getContext('2d', { willReadFrequently: true });
        const lire = (s) => {
          if (!s || !CSS.supports('color', s)) return null;
          g.clearRect(0, 0, 1, 1);
          g.fillStyle = s;
          g.fillRect(0, 0, 1, 1);
          const p = g.getImageData(0, 0, 1, 1).data;
          return { r: p[0], g: p[1], b: p[2], a: p[3] / 255 };
        };
        // Le fond vu derriere la rangee : ses couches semi-transparentes
        // composees jusqu a la premiere opaque.
        const fondDe = (el) => {
          const couches = [];
          for (let e = el; e; e = e.parentElement) {
            const c = lire(getComputedStyle(e).backgroundColor);
            if (c && c.a > 0) { couches.push(c); if (c.a >= 0.999) break; }
          }
          let f = { r: 255, g: 255, b: 255 };
          couches.reverse().forEach((c) => { f = { r: c.r * c.a + f.r * (1 - c.a), g: c.g * c.a + f.g * (1 - c.a), b: c.b * c.a + f.b * (1 - c.a) }; });
          return f;
        };
        const lum = (c) => { const v = [c.r, c.g, c.b].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const barre = r.querySelector('.lp-cases');
        const ombre = getComputedStyle(barre).boxShadow;
        // La couleur vient en tete de l ombre calculee : « rgb(...) 0px 0px 0px 1px inset ».
        const trait = lire((ombre.match(/^[a-z-]+\([^)]*\)|^#[0-9a-f]+/i) || [])[0]);
        const epaisseur = Number((ombre.match(/(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/) || [])[4] || 0);
        const fondRang = lire(getComputedStyle(r).backgroundColor);
        const fond = fondDe(r);
        return {
          contour: /inset/.test(ombre) && epaisseur >= 1 && trait && trait.a > 0.99 ? Number(ratio(trait, fond).toFixed(2)) : 0,
          videPeint: (lire(getComputedStyle(libre).backgroundColor) || { a: 0 }).a,
          prisePeinte: (lire(getComputedStyle(prise).backgroundColor) || { a: 0 }).a,
          priseContour: getComputedStyle(prise).boxShadow,
          libreContour: getComputedStyle(libre).boxShadow,
          ecart: getComputedStyle(barre).columnGap,
          hauteur: barre.getBoundingClientRect().height,
          cibleHauteur: r.querySelector('.lp-dep__jauge').getBoundingClientRect().height,
          etiquette: r.querySelector('.lp-dep__jauge').getAttribute('aria-label'),
          // Ce que la rangee peint elle-meme (alpha), et le fond compose vu
          // derriere la case.
          rangPeint: fondRang ? Number(fondRang.a.toFixed(2)) : 0,
          fond: [fond.r, fond.g, fond.b].map(Math.round).join(','),
          classes: r.className,
        };
      }, heure);
      const repos = await mesure(16);
      await rang(page, 16).hover();
      const survol = await mesure(16);
      await page.mouse.move(2, 2);
      await page.click('#laserPlanningGridWrap .lp-jeton:has-text("Famille Renard")');
      await rang(page, 16).hover();
      const cible = await mesure(16);
      ok(repos && repos.videPeint === 0 && repos.prisePeinte >= 0.999 && repos.priseContour === 'none' && repos.libreContour === 'none'
        && repos.ecart === '0px' && repos.hauteur === 8 && repos.cibleHauteur >= 16 && /18 sur 30/.test(repos.etiquette),
      `[M] ${theme} : barre continue, groupes pleins et compte accessible, sans contour par arme`, JSON.stringify(repos));
      // Le prerequis : le survol et la cible se peignent vraiment (la rangee a
      // un fond, et ce n est pas le meme), sinon les mesures relisent le repos.
      ok(repos && survol && cible && repos.rangPeint === 0 && survol.rangPeint > 0.5 && /is-cible/.test(cible.classes) && cible.rangPeint > 0.5 && cible.fond !== survol.fond,
        `[M] ${theme} : le survol et la cible d un depot se peignent`, JSON.stringify({ repos: repos && repos.fond, survol: survol && [survol.rangPeint, survol.fond], cible: cible && [cible.classes, cible.rangPeint, cible.fond] }));
      ok([repos, survol, cible].every((m) => m && m.contour >= 3), `[M] ${theme} : le contour de la capacite libre tient 3:1 (repos, survol, cible)`, [repos, survol, cible].map((m) => m && m.contour).join(' / '));
      ok(erreurs.length === 0, `[M] ${theme} : zero erreur JS ni console`, erreurs.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }

  // ── [N] deux vagues hors grille qui se suivent ne s additionnent pas ──
  // Le serveur compte ce qui chevauche VRAIMENT un lancement
  // (ensureLaserCapacity). Lutosa en deux vagues, 16:55-17:20 (23) puis
  // 17:25-17:50 (22) : 23 armes a 17:00, 22 a 17:30, jamais 45 ; et 16:30 reste
  // libre, sa partie finit quand la premiere vague commence (sonde du portage
  // laser-waves, 2026-10-09 : « 45, 15 de trop » et 16:30 pris a 23).
  {
    const d = journee().filter(x => ['Séminaire Lutosa', 'Anniv. Chloé'].includes(x.name));
    const lutosa = d.find(x => x.name === 'Séminaire Lutosa');
    const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const vague = (b, debut, joueurs) => ({ ...b, start: debut, end: debut + 25, startTime: hh(debut), endTime: hh(debut + 25), players: joueurs, groupPlayers: 45 });
    lutosa.pax = 45;
    lutosa.opsPlan.resourceBlocks = [vague(lutosa.opsPlan.resourceBlocks[0], 16 * 60 + 55, 23), vague(lutosa.opsPlan.resourceBlocks[1], 17 * 60 + 25, 22)];
    lutosa.opsPlan.laserPassPlan.scheduledPasses = lutosa.opsPlan.resourceBlocks.map(b => ({ countIndex: 1, status: 'scheduled', pax: 45, startTime: b.startTime }));
    const { ctx, page, erreurs } = await ouvrir(browser, { dossiers: d, mutation });
    try {
      const r1630 = await lireRang(page, 16.5);
      const r17 = await lireRang(page, 17);
      const r1730 = await lireRang(page, 17.5);
      const qui = (r) => JSON.stringify(r && r.qui.map(g => g.texte));
      ok(r17 && r17.compte === '23' && !/is-trop/.test(r17.classes) && /V1\/2/.test(qui(r17)) && /à 16:55/.test(qui(r17)),
        '[N] 17:00 : la vague de 16:55, 23 armes, rien de trop', JSON.stringify(r17 && { c: r17.compte, p: r17.places, k: r17.classes, q: qui(r17) }));
      ok(r1730 && r1730.compte === '22' && /V2\/2/.test(qui(r1730)) && /à 17:25/.test(qui(r1730)),
        '[N] 17:30 : la vague de 17:25, 22 armes', JSON.stringify(r1730 && { c: r1730.compte, q: qui(r1730) }));
      ok(r1630 && r1630.compte === '0' && /30 places/.test(r1630.places),
        '[N] 16:30 reste libre : sa partie finit quand la premiere vague commence', JSON.stringify(r1630 && { c: r1630.compte, p: r1630.places }));
      await page.click('#laserPlanningGridWrap .lp-jeton:has-text("Anniv. Chloé")');
      const c1630 = await lireRang(page, 16.5);
      const c17 = await lireRang(page, 17);
      ok(c1630 && /is-cible/.test(c1630.classes) && c1630.fantomes === 10, '[N] 16:30 prend un groupe de 10, comme le serveur', JSON.stringify(c1630 && { k: c1630.classes, f: c1630.fantomes }));
      ok(c17 && /is-terne/.test(c17.classes), '[N] 17:00 le refuse : la vague de 16:55 joue encore', JSON.stringify(c17 && c17.classes));
      ok(erreurs.length === 0, '[N] zero erreur JS ni console', erreurs.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }

  // ── [P] les pictos du bowling apres le nom ──
  // Movsar, 2026-10-09 : « Pictos du bowling ». La note a lire, l anniversaire
  // et le prix ajuste, les memes marques que la tete d une carte bowling,
  // apres le nom du groupe aux trois endroits ou il s ecrit : la rangee de son
  // depart, la carte du prochain depart, la file « À placer ». Jamais le
  // marqueur laser (tout le planning est laser), et aucun texte : le nom et le
  // compte se lisent comme avant.
  for (const [appareil, theme] of [['tablette', 'light'], ['tablette', 'dark'], ['telephone', 'dark']]) {
    const d = journee();
    const noah = d.find(x => x.name === 'Anniv. Noah');
    noah.notes = 'Gâteau à 16:30';
    noah.occasion = 'anniversaire';
    noah.price = 120; // reference 160 : 8 joueurs, deux parties a 10
    d.find(x => x.name === 'Anniv. Chloé').notes = 'Allergie aux arachides';
    const { ctx, page, erreurs } = await ouvrir(browser, { appareil, theme, dossiers: d, mutation });
    try {
      const m = await page.evaluate(async () => {
        await Promise.race([Promise.all(document.getAnimations().map((a) => a.finished)), new Promise((ok) => setTimeout(ok, 1500))]);
        const toile = document.createElement('canvas');
        toile.width = 1; toile.height = 1;
        const g = toile.getContext('2d', { willReadFrequently: true });
        const lire = (s) => {
          if (!s || !CSS.supports('color', s)) return null;
          g.clearRect(0, 0, 1, 1);
          g.fillStyle = s;
          g.fillRect(0, 0, 1, 1);
          const p = g.getImageData(0, 0, 1, 1).data;
          return { r: p[0], g: p[1], b: p[2], a: p[3] / 255 };
        };
        const fondDe = (el) => {
          const couches = [];
          for (let e = el; e; e = e.parentElement) {
            const c = lire(getComputedStyle(e).backgroundColor);
            if (c && c.a > 0) { couches.push(c); if (c.a >= 0.999) break; }
          }
          let f = { r: 255, g: 255, b: 255 };
          couches.reverse().forEach((c) => { f = { r: c.r * c.a + f.r * (1 - c.a), g: c.g * c.a + f.g * (1 - c.a), b: c.b * c.a + f.b * (1 - c.a) }; });
          return f;
        };
        const lum = (c) => { const v = [c.r, c.g, c.b].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const decrire = (hote, cadre) => {
          if (!hote) return null;
          const nom = hote.querySelector('b');
          const pictos = hote.querySelector('.lp-pictos');
          const marques = pictos ? [...pictos.querySelectorAll('[role="img"]')] : [];
          const n = nom.getBoundingClientRect();
          const p = pictos ? pictos.getBoundingClientRect() : null;
          const fond = fondDe(pictos || hote);
          const couleur = (x) => lire(getComputedStyle(x).color);
          return {
            marques: marques.map((x) => (String(x.getAttribute('class')).match(/\bflag-(\w+)/) || [])[1] || '?'),
            titres: marques.map((x) => x.getAttribute('aria-label') || ''),
            tailles: marques.map((x) => { const b = x.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; }),
            texte: pictos ? pictos.textContent.trim() : '',
            apresNom: p ? Math.round(p.left - n.right) : null,
            centre: p ? Math.round(Math.abs((p.top + p.bottom) / 2 - (n.top + n.bottom) / 2)) : null,
            dedans: p ? p.right <= (cadre || hote).getBoundingClientRect().right + 0.5 : null,
            couleurs: marques.map((x) => { const c = couleur(x); return c ? [c.r, c.g, c.b].join(',') : ''; }),
            contrastes: marques.map((x) => { const c = couleur(x); return c ? Number(ratio(c, fond).toFixed(2)) : 0; }),
            detailSous: (() => { const s = hote.querySelector('small'); return s ? s.getBoundingClientRect().top >= n.bottom - 1 : null; })(),
          };
        };
        const tous = (sel) => [...document.querySelectorAll(sel)];
        const nomme = (liste, nom) => liste.find((x) => (x.querySelector('b') || {}).textContent === nom);
        const enRang = (t, nom) => nomme(tous(`#laserPlanningGridWrap .lp-dep[data-lp-t="${t}"] .lp-g`), nom);
        const prochain = nomme(tous('#laserPlanningGridWrap .lp-prochain .lp-groupe'), 'Anniv. Noah');
        // Les Rangers (16:00) : ni note, ni occasion, ni prix ajuste.
        const sans = enRang(16, 'Les Rangers');
        return {
          // 15:30, sa 1re partie, est le prochain depart : sa rangee est la 2e, 16:30.
          rang: decrire(enRang(16.5, 'Anniv. Noah')),
          prochain: decrire(prochain, prochain && prochain.querySelector('.lp-groupe__sel')),
          file: decrire(nomme(tous('#laserPlanningGridWrap .lp-jeton'), 'Anniv. Chloé')),
          sans: sans ? sans.querySelectorAll('.lp-pictos').length : -1,
        };
      });
      const trois = (x) => x && JSON.stringify(x.marques) === '["note","birthday","prix"]' && x.tailles.every((t) => t === '13x13') && x.texte === '';
      const prix = (x) => x && /^Prix ajusté .*référence/.test(x.titres[2] || '') && x.titres[0] === 'Note à lire' && x.titres[1] === 'Anniversaire';
      const colle = (x, max) => x && x.apresNom >= 3 && x.apresNom <= max && x.centre <= 2 && x.dedans;
      const lisible = (x) => x && x.contrastes.length > 0 && x.contrastes.every((c) => c >= 3);
      const r = m.rang;
      if (appareil === 'telephone') {
        // 196 px de ligne pour le nom, ses pictos et son compte : ils cedent du
        // dernier au premier, comme sur une carte bowling serree, la note reste.
        const vus = r ? r.marques.filter((_, i) => r.tailles[i] !== '0x0') : [];
        ok(r && JSON.stringify(r.marques) === '["note","birthday","prix"]' && JSON.stringify(vus) === '["note"]' && r.tailles[0] === '13x13' && prix(r) && colle(r, 8) && r.contrastes[0] >= 3,
          `[P] ${appareil} ${theme} : la rangee de son depart ne garde que la note, les autres pictos cedent`, JSON.stringify(r));
      } else {
        ok(trois(r) && prix(r) && colle(r, 8) && lisible(r) && r.couleurs[0] !== r.couleurs[1] && r.couleurs[0] === r.couleurs[2],
          `[P] ${appareil} ${theme} : la rangee de son depart porte la note, l anniversaire et le prix, apres le nom`, JSON.stringify(r));
      }
      const p = m.prochain;
      ok(trois(p) && colle(p, 8) && lisible(p) && p.couleurs.every((c) => c === '255,255,255'),
        `[P] ${appareil} ${theme} : la carte du prochain depart les porte en blanc, sur la ligne du nom`, JSON.stringify(p));
      const f = m.file;
      ok(f && JSON.stringify(f.marques) === '["note"]' && colle(f, 8) && lisible(f) && f.detailSous === true,
        `[P] ${appareil} ${theme} : la file « À placer » porte la note de Chloé, son detail reste dessous`, JSON.stringify(f));
      ok(m.sans === 0, `[P] ${appareil} ${theme} : un groupe sans note ni prix ajuste n a aucun picto`, String(m.sans));
      ok(erreurs.length === 0, `[P] ${appareil} ${theme} : zero erreur JS ni console`, erreurs.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }
}

// ── [K] LES CONTRE-PREUVES ─────────────────────────────────────────────────
const MUTATIONS = [
  { nom: 'ordre', lettre: '[E] avant sa 1re partie', fichier: 'assets/app-main.js',
    de: "if (avant) return { ok: false, raison: `${h} : avant sa ${lpRang(avant.countIndex)} partie (${lpHeure(avant.start)}).` };",
    vers: '' },
  { nom: 'capacite', lettre: '[D] toucher un depart plein dit pourquoi', fichier: 'assets/app-main.js',
    de: 'if (occupe + choisi.arene > modele.capacite) {',
    vers: 'if (false) {' },
  { nom: 'repeint', lettre: '[H] pendant un glisser, le repeint attend', fichier: 'assets/app-main.js',
    de: 'if (lpEtat.glisse) { lpEtat.differe = true; return; }',
    vers: '' },
  // Deux voisins dans le meme etat ne s alternent plus : ils se confondent.
  { nom: 'tons', lettre: '[A] deux voisins dans le meme etat se distinguent', fichier: 'assets/app-main.js',
    de: '    alt = t === avant ? !alt : false;',
    vers: '    alt = false;' },
  // Un groupe arrive reste bleu : la couleur ne dit plus l etat.
  { nom: 'etat', lettre: '[A] la couleur dit l etat', fichier: 'assets/app-main.js',
    de: "  if (r.status === 'arrived') return 'st-arr';",
    vers: "  if (r.status === 'arrived') return 'st-conf';" },
  // Les cases de la jauge ne retrecissent plus (14 px chacune, comme une cible
  // au doigt qu on voudrait garantir) : 30 armes font 507 px, la jauge sort du
  // telephone. (La mutation d avant, la colonne implicite de la journee, ne
  // cassait plus rien depuis le haut compact du 2026-10-08 : sonde
  // sonde-mutation-telephone.js, aucune des quatre regles du telephone n est
  // seule porteuse.)
  { nom: 'largeur', lettre: '[I] telephone : rien du planning ne sort', fichier: 'assets/pinlane-staff.css',
    de: '.lp-cases { display: grid; grid-template-columns: repeat(var(--lp-cases), minmax(0, 1fr)); gap: 0; width: 100%; background: var(--lp-vide); border-radius: 4px; box-shadow: inset 0 0 0 1px var(--lp-case); overflow: hidden; }',
    vers: '.lp-cases { display: grid; grid-template-columns: repeat(var(--lp-cases), 14px); gap: 0; width: 100%; background: var(--lp-vide); border-radius: 4px; box-shadow: inset 0 0 0 1px var(--lp-case); overflow: hidden; }' },
  // La boite du planning redevient un cadre de defilement : la file ne colle
  // plus au bas de l ecran.
  { nom: 'collee', lettre: '[I] telephone : la file reste en bas', fichier: 'assets/pinlane-staff.css',
    de: '.laser-planning-box:has(#laserPlanningGridWrap > .lp) { overflow: clip; }',
    vers: '' },
  // Le toucher d un groupe du jour le prend de nouveau au lieu d ouvrir sa fiche.
  { nom: 'fiche', lettre: '[L] toucher un groupe du jour ouvre SA fiche', fichier: 'assets/app-main.js',
    de: "const toucher = fiche ? `lpToucherGroupe(${id}, event)` : `lpChoisir(${id}, '${unitKey}', event)`;",
    vers: "const toucher = `lpChoisir(${id}, '${unitKey}', event)`;" },
  // Le contour d une case libre palit au gris d un filet (1,7:1 en clair) :
  // une case libre ne se distingue plus du fond.
  { nom: 'contour', lettre: '[M] light : le contour de la capacite libre tient 3:1', fichier: 'assets/pinlane-staff.css',
    de: '  --lp-case: #86868c;',
    vers: '  --lp-case: #c2c2c8;' },
  // Les cases libres reprennent un fond gris : libre et pris ne se lisent
  // plus a la forme.
  { nom: 'plein', lettre: '[M] dark : barre continue, groupes pleins et compte accessible', fichier: 'assets/pinlane-staff.css',
    de: '.lp-cases i { height: 8px; border-radius: 0; }',
    vers: '.lp-cases i { height: 8px; border-radius: 0; background: var(--lp-vide); }' },
  // Une partie hors grille se range de nouveau a la demi-heure inferieure :
  // la vague de 17:25 compte a 17:00 avec celle de 16:55 encore en jeu.
  { nom: 'creneau', lettre: '[N] 17:00 : la vague de 16:55', fichier: 'assets/app-main.js',
    de: '  const creneau = (debut) => config.open + Math.round((Number(debut) - config.open) * 2 - 0.001) / 2;',
    vers: '  const creneau = (debut) => config.open + Math.floor((Number(debut) - config.open) * 2 + 0.001) / 2;' },
  // La rangee d un depart ne porte plus les pictos du groupe. (Re-ancree le
  // 2026-10-19 : depuis 212370b la rangee enchaine le nom, les pictos et la
  // puce de statut ; l ancre d avant ne se trouvait plus, la contre-preuve
  // plantait.)
  { nom: 'pictos', lettre: '[P] tablette light : la rangee de son depart', fichier: 'assets/app-main.js',
    de: '<b>${escapeHtml(r.name || \'Groupe\')}</b>${lpPictos(r)}<span class="lp-card-status">',
    vers: '<b>${escapeHtml(r.name || \'Groupe\')}</b><span class="lp-card-status">' },
  // Le marqueur laser revient : il le dirait de chaque groupe du planning.
  { nom: 'laser', lettre: '[P] tablette light : la rangee de son depart', fichier: 'assets/app-main.js',
    de: 'renderCardFlags(r, { partiesEcrites: true }) + renderReservationPriceMark(',
    vers: 'renderCardFlags(r) + renderReservationPriceMark(' },
  // Les pictos gardent l ambre et le bleu sur la carte bleue du prochain depart.
  { nom: 'blanc', lettre: '[P] tablette light : la carte du prochain depart', fichier: 'assets/pinlane-staff.css',
    de: '.lp-prochain .lp-pictos { --warning: #fff; --accent-strong: #fff; }',
    vers: '' },
  // Le nom et ses pictos ne partagent plus une boite : au telephone, la carte
  // du prochain depart empile le nom, puis les pictos, puis le detail.
  { nom: 'ligne', lettre: '[P] telephone dark : la carte du prochain depart', fichier: 'assets/app-main.js',
    de: '<span class="lp-groupe__t"><span class="lp-nom"><b>${escapeHtml(r.name || \'Groupe\')}</b>${lpPictos(r)}</span> <span class="lp-n">',
    vers: '<span class="lp-groupe__t"><b>${escapeHtml(r.name || \'Groupe\')}</b>${lpPictos(r)} <span class="lp-n">' },
  // Au telephone, la rangee garde ses trois pictos : le nom tombe a « An… ».
  { nom: 'cedent', lettre: '[P] telephone dark : la rangee de son depart', fichier: 'assets/pinlane-staff.css',
    de: '  .lp-qui .lp-pictos .bk-flags .bk-flag:nth-child(n+2), .lp-qui .lp-pictos .bk-flags ~ .flag-prix { display: none; }',
    vers: '' },
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
        process.env.LP_SILENCE = '1';
        try { await scenarios(browser, m); } catch (e) { lignes.push({ cond: false, label: `crash ${e.message}` }); }
        delete process.env.LP_SILENCE;
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
  console.log(echecs ? `\nplanning-laser-check : ${echecs} echec(s)` : '\nplanning-laser-check: ALL OK, le planning de la maquette E tient ses regles.');
  process.exit(echecs ? 1 : 0);
}


main().catch((e) => { console.error(e); process.exit(1); });

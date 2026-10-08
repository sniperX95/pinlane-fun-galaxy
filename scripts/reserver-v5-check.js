// LA FENETRE RESERVER CREE CE QU ELLE MONTRE (v5, lot I2 de la console,
// 2026-10-08).
//
// Movsar sur les maquettes : « on est le staff, on doit pouvoir faire ce qu on
// veut », « plus que 3 parties », « plus que 2 heures », « tout doit suivre »,
// « elle peut créer mais il doit afficher l erreur avant, après, conflit
// expliqué », « Même client, un envoi ». La fenetre fait juger son plan par le
// serveur (simulation a blanc, dryRun) avant de creer : ce gate garde que ce
// jugement porte sur CE qui sera cree, et que chaque geste du comptoir suit.
//
//   [A] TOUT SUIT. Le dossier que « Créer » envoie est celui que le planning a
//       simule : meme programme, memes heures, memes pistes, memes preferences,
//       meme prix. Seuls le contact et la note s y ajoutent.
//   [B] AU-DELA DU CATALOGUE. 4 parties de laser et 2 h 30 de bowling se posent
//       au « + » de la ligne, se disent « hors catalogue » (la ligne s ouvre au
//       franchissement) et partent telles quelles.
//   [C] UN REFUS SE DIT AVANT, ET « CREER QUAND MEME » LE PORTE. Plan refuse :
//       le verdict l explique (conflit compris), « Créer » n envoie rien et dit
//       quoi faire ; « Créer quand même » envoie le dossier avec forcer.
//   [D] L HORLOGE JUGE CHAQUE HEURE AVEC LE PLANNING. L ouvrir envoie au
//       serveur une variante par heure ; chaque minute dit ce qu il a repondu ;
//       choisir une heure la pose et relance le plan.
//   [E] MEME CLIENT, UN ENVOI. Deux resas partent dans UN POST `dossiers`, le
//       contact commun, sans « forcer » global. Un lot en partie refuse (le
//       serveur repond ok:false, 207) : la resa creee sort de la fenetre, la
//       refusee y reste avec sa raison, et le clic suivant ne renvoie qu elle.
//   [F] LA SAISIE N EST JAMAIS ECRASEE. Un repeint pendant qu on tape le nom
//       garde le champ, son texte et le focus ; il se fait quand le champ rend
//       la main.
//   [G] AU TELEPHONE (390 px). Rien ne deborde de cote ; « Créer » reste a
//       l ecran, la fenetre defilee en haut comme en bas.
//   [H] LA REPONSE D UNE CREATION NE FERME QUE SA FENETRE. « Créer », puis
//       une autre fenetre ouverte avant la reponse : la reponse range le
//       dossier cree au planning et laisse la nouvelle fenetre ouverte (trouve
//       par ce gate le 2026-10-08 : elle la fermait).
//   [*] Zero erreur JS ni erreur console.
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
  // Un refus du plan part quand meme, en silence.
  refus: { fichier: 'assets/app-main.js', de: '  if (!lot && plan && !plan.disponible && !etat.forcer) {', vers: '  if (false) {', vise: ['C'] },
  // L horloge n envoie plus ses heures : les points ne viennent plus du planning.
  horloge: { fichier: 'assets/app-main.js', de: "body: JSON.stringify({ ...base, dryRun: true, candidats: variantes })", vers: "body: JSON.stringify({ ...base, dryRun: true, candidats: [] })", vise: ['D'] },
  // Plusieurs resas : seule celle a l ecran part.
  lot: { fichier: 'assets/app-main.js', de: '  const lot = rvResas.length > 1 && rvResas.includes(etat);', vers: '  const lot = false;', vise: ['E'] },
  // Un lot en partie refuse passe pour une panne : la resa creee reste dans la
  // fenetre, et le clic suivant la recree.
  partiel: { fichier: 'assets/app-main.js', de: '    if (reponse && (Array.isArray(reponse.reservations) || Array.isArray(reponse.echecs))) return reponse;', vers: '    if (false) return reponse;', vise: ['E'] },
  // La reponse d une creation ferme toute fenetre ouverte depuis.
  fermeture: { fichier: 'assets/app-main.js', de: '    if (rvResas === lotSauve) closeQuickBook();', vers: '    if (quickBookState === etat || rvResas.includes(quickBookState)) closeQuickBook();', vise: ['H'] },
  // Le repeint ne respecte plus le champ qu on tape.
  saisie: { fichier: 'assets/app-main.js', de: "  if (actif && actif !== zone && zone.contains(actif) && actif.matches(", vers: "  if (false && actif && actif !== zone && zone.contains(actif) && actif.matches(", vise: ['F'] },
  // Au telephone, le pied ne colle plus en bas : « Créer » sort de l ecran.
  pied: { fichier: 'assets/pinlane-staff.css', de: '  .rv-pied { position: sticky; bottom: 0;', vers: '  .rv-pied { position: static; bottom: 0;', vise: ['G'] },
};

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

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, ACTIVITIES }) => {
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
      if (u.pathname === '/api/staff-reservations' && m === 'GET') return J({ ok: true, client: null, departs: [] });
      if (u.pathname === '/api/staff-reservations' && m === 'POST') {
        const corps = JSON.parse(init.body || '{}');
        if (corps.dryRun && Array.isArray(corps.candidats)) {
          window.__QA_CANDIDATS__.push(corps);
          return J({ ok: true, dryRun: true, plan: planPour(corps), candidats: corps.candidats.map((v) => ({
            heure: v.heure,
            statut: v.heure === '15:00' ? 'ko' : v.heure === '15:30' ? 'partage' : 'ok',
            raison: v.heure === '15:00' ? 'Toutes les pistes sont prises' : v.heure === '15:30' ? 'Partie partagée' : '',
            fin: plus(v.startTime || v.heure, 60),
          })) });
        }
        if (corps.dryRun) { window.__QA_SIMS__.push(corps); return J({ ok: true, dryRun: true, plan: planPour(corps) }); }
        window.__QA_CREES__.push(corps);
        if (window.__QA_RETENUE__) await window.__QA_RETENUE__;
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
  }, { expiresAt, ACTIVITIES });
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

async function boot(page) {
  await installMock(page);
  await page.goto(`${BASE_URL}/?v=rv5-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => window.setView('staff'));
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
  await page.waitForSelector('[data-rv-ligne="laser_game"]', { timeout: 8000 });
  const plusLaser = '[data-rv-ligne="laser_game"] button[aria-label="Laser : une partie de plus"]';
  const plusBowling = '[data-rv-ligne="bowling"] button[aria-label="Bowling : 30 minutes de plus"]';
  for (let i = 0; i < 2; i += 1) await page.click(plusLaser);
  const ouverteApresLaser = await page.evaluate(() => quickBookState.ouverte);
  for (let i = 0; i < 3; i += 1) await page.click(plusBowling);
  await planPose(page, true);
  const lu = await page.evaluate(() => ({
    parties: (document.querySelector('[data-rv-ligne="laser_game"] .rv-qte b') || {}).textContent || '',
    duree: (document.querySelector('[data-rv-ligne="bowling"] .rv-qte b') || {}).textContent || '',
    ouverte: quickBookState.ouverte,
  }));
  await page.evaluate(() => { if (!quickBookState.moreOpen) toggleQuickBookMore(); });
  const bandeaux = await page.evaluate(() => [...document.querySelectorAll('#quickBookOverlay .rv-hors')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  await page.evaluate(() => toggleQuickBookMore());
  await planPose(page, true);
  const simule = await page.evaluate(() => window.__QA_SIMS__[window.__QA_SIMS__.length - 1] || null);
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
  verifier('B', lu.parties === '4' && lu.duree.replace(/\s/g, '') === '2h30', 'MONTAGE : la ligne montre 4 parties et 2 h 30', `${lu.parties} parties, ${lu.duree}`);
  verifier('B', ouverteApresLaser === 'laser_game', 'franchir le catalogue au « + » ouvre la ligne du laser (son bandeau dit le prix)', `ligne ouverte : ${ouverteApresLaser}`);
  verifier('B', bandeaux.some((t) => /4 parties, hors catalogue/.test(t)) && bandeaux.some((t) => /hors catalogue/.test(t) && /2\s*h\s*30/.test(t)), 'les deux depassements se disent « hors catalogue »', bandeaux.join(' | ') || 'aucun bandeau');
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
  await page.evaluate((jour) => {
    window.__QA_REFUS__ = '20:00';
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '20:00', type: 'laser', pax: 8 });
  }, JOUR);
  await planPose(page, false);
  const verdict = await page.evaluate(() => (document.getElementById('rvVerdict') || {}).textContent || '');
  await page.fill('#qbName', 'Groupe Refus');
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForTimeout(900);
  const avant = await page.evaluate(() => ({ posts: window.__QA_CREES__.length, erreur: quickBookState ? quickBookState.error : '', ecran: (document.querySelector('#rvVerdict .qb-warn') || {}).textContent || '' }));
  await page.click('#rvForcer');
  const libelle = await page.evaluate(() => (document.getElementById('rvCreer') || {}).textContent || '');
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  const cree = await page.evaluate(() => window.__QA_CREES__[0] || null);
  const cFerme = await fenetreFermee(page);
  await page.evaluate(() => { window.__QA_REFUS__ = null; });

  verifier('C', /Impossible tel quel/.test(verdict) && /il manque 4 places/.test(verdict), 'AVANT : le verdict dit le refus et son conflit', verdict.replace(/\s+/g, ' ').slice(0, 160));
  verifier('C', avant.posts === 0, '« Créer » sur un plan refuse n envoie rien', `${avant.posts} POST`);
  verifier('C', /Créer quand même/.test(avant.erreur) && /Créer quand même/.test(avant.ecran), 'il dit pourquoi et quoi faire, dans la fenetre', avant.erreur.slice(0, 160));
  verifier('C', /Créer quand même/.test(libelle), '« Créer quand même » change le bouton', libelle.trim());
  verifier('C', Boolean(cree && cree.forcer === true), '« Créer quand même » envoie le dossier avec forcer (cree « a placer »)', cree ? `forcer=${cree.forcer}` : 'aucun POST');
  verifier('C', cFerme, 'le dossier a placer cree, la fenetre se ferme');
}

// ── [D] ───────────────────────────────────────────────────────────────────────
async function scenarioD(page, verifier) {
  await page.evaluate((jour) => {
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: 4 });
  }, JOUR);
  await planPose(page, true);
  const avant = await page.evaluate(() => window.__QA_CANDIDATS__.length);
  await page.click('#rvHeure-bowling');
  await page.waitForSelector('#rvHorloge', { timeout: 5000 });
  await page.waitForFunction((n) => window.__QA_CANDIDATS__.length > n, avant, { timeout: 8000 }).catch(() => {});
  const envoi = await page.evaluate((n) => window.__QA_CANDIDATS__[n] || null, avant);
  await page.waitForFunction(() => quickBookState && quickBookState.candidats && quickBookState.candidats.etat !== 'calcul', null, { timeout: 8000 }).catch(() => {});
  const heure = (hh) => page.locator('#rvHorloge .rv-hc').filter({ has: page.locator('b', { hasText: new RegExp(`^${hh}$`) }) });
  await heure('15').click();
  const minutes = await page.evaluate(() => [...document.querySelectorAll('#rvHorloge .rv-mn')].map((b) => ({ texte: b.querySelector('b') ? b.querySelector('b').textContent : '', cls: b.className, label: b.getAttribute('aria-label') || '' })));
  const sims = await page.evaluate(() => window.__QA_SIMS__.length);
  await heure('16').click();
  await page.locator('#rvHorloge .rv-mn').filter({ has: page.locator('b', { hasText: /^16:00$/ }) }).click();
  await page.waitForFunction((n) => window.__QA_SIMS__.length > n, sims, { timeout: 8000 }).catch(() => {});
  const apres = await page.evaluate(() => ({ heure: quickBookState.startTime, horloge: Boolean(document.getElementById('rvHorloge')), derniere: (window.__QA_SIMS__[window.__QA_SIMS__.length - 1] || {}).startTime }));
  const variantes = envoi && Array.isArray(envoi.candidats) ? envoi.candidats : [];
  const quinze = minutes.find((x) => x.texte === '15:00');
  const quinzeTrente = minutes.find((x) => x.texte === '15:30');

  verifier('D', variantes.length >= 4 && new Set(variantes.map((v) => v.heure)).size === variantes.length && variantes.every((v) => v.startTime === v.heure), 'l horloge envoie au planning une variante par heure (le depart de chacune)', `${variantes.length} variante(s) : ${variantes.slice(0, 6).map((v) => v.heure).join(', ')}`);
  verifier('D', Boolean(quinze && /is-ko/.test(quinze.cls) && /Toutes les pistes sont prises/.test(quinze.label)), '15:00 dit le refus du planning, avec sa raison', quinze ? `${quinze.cls} / ${quinze.label}` : 'absente');
  verifier('D', Boolean(quinzeTrente && /is-att/.test(quinzeTrente.cls)), '15:30 dit l ecart (partie partagee)', quinzeTrente ? quinzeTrente.cls : 'absente');
  verifier('D', apres.heure === '16:00' && !apres.horloge && apres.derniere === '16:00', 'choisir 16:00 pose l heure, ferme l horloge et relance le plan', JSON.stringify(apres));
}

// ── [E] ───────────────────────────────────────────────────────────────────────
async function scenarioE(page, verifier) {
  await page.evaluate((jour) => {
    closeQuickBook();
    openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: 6 });
  }, JOUR);
  await planPose(page, true);
  await page.fill('#qbPhone', '0470 11 22 33');
  await page.fill('#qbName', 'Anniversaire Léa');
  await page.click('#rvEncore');
  await page.waitForFunction(() => rvResas.length === 2 && quickBookState === rvResas[1], null, { timeout: 5000 }).catch(() => {});
  await planPose(page, true);
  const libelle = await page.evaluate(() => (document.getElementById('rvCreer') || {}).textContent || '');
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  const eFerme = await fenetreFermee(page);
  const r = await page.evaluate((eFerme) => ({ posts: window.__QA_CREES__.length, corps: window.__QA_CREES__[0] || null, ferme: eFerme, rangees: state.reservations.filter((x) => Number(x.id) === 7000 || Number(x.id) === 7001).map((x) => x.name) }), eFerme);
  const dossiers = r.corps && Array.isArray(r.corps.dossiers) ? r.corps.dossiers : [];
  verifier('E', /Créer les 2/.test(libelle), 'MONTAGE : la fenetre porte deux resas et le dit sur « Créer »', libelle.trim());
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
  await page.fill('#qbName', 'Anniversaire Léa');
  await page.click('#rvEncore');
  await page.waitForFunction(() => rvResas.length === 2 && quickBookState === rvResas[1], null, { timeout: 5000 }).catch(() => {});
  await planPose(page, true);
  await page.evaluate(() => { window.__QA_CREES__.length = 0; });
  await page.click('#rvCreer');
  await page.waitForFunction(() => window.__QA_CREES__.length >= 1, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const partiel = await page.evaluate(() => ({
    resas: rvResas.length,
    ouverte: quickBookState !== null,
    pax: quickBookState ? quickBookState.pax : null,
    erreur: quickBookState ? quickBookState.error : '',
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
  verifier('E', partiel.ouverte && partiel.resas === 1 && partiel.pax === 4 && /Plus aucune piste libre/.test(partiel.erreur), 'lot en partie refuse : seule la resa refusee reste, avec sa raison', JSON.stringify(partiel));
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
  const r = await page.evaluate(() => ({ ouverte: quickBookState !== null, pax: quickBookState ? quickBookState.pax : null, heure: quickBookState ? quickBookState.startTime : '', rangee: state.reservations.some((x) => x.name === 'Premier client') }));
  verifier('H', r.rangee, 'MONTAGE : la reponse arrivee, le premier dossier entre au planning', JSON.stringify(r));
  verifier('H', r.ouverte && r.pax === 6 && r.heure === '15:00', 'la nouvelle fenetre reste ouverte, avec ce qu on y a pose', JSON.stringify(r));
  await page.evaluate(() => closeQuickBook());
}

const SCENARIOS = { A: scenarioAB, B: scenarioAB, C: scenarioC, D: scenarioD, E: scenarioE, F: scenarioF, G: scenarioG, H: scenarioH };

async function passe(browser, lettres, { bavard = true } = {}) {
  const echecs = new Set();
  const verifier = (lettre, cond, label, detail = '') => {
    if (bavard || !cond) console.log(`${cond ? 'OK  ' : 'FAIL'} [${lettre}] ${label}${detail ? `  ->  ${detail}` : ''}`);
    if (!cond) echecs.add(lettre);
  };
  const tablette = lettres.filter((l) => l !== 'G');
  const lancer = async (viewport, liste) => {
    if (!liste.length) return;
    const contexte = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await contexte.newPage();
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
  if (lettres.includes('G')) await lancer({ width: 390, height: 844 }, ['G']);
  return echecs;
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--contre-preuves'));
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  let rouge = false;
  try {
    if (!arg) {
      const echecs = await passe(browser, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
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

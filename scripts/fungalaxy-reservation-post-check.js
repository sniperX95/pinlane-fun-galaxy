// UNE RESERVATION FAITE PAR LE FORMULAIRE FUN GALAXY ABOUTIT-ELLE VRAIMENT ?
// (2026-09-23, avant de servir ce formulaire sur /reserver/libramont.)
//
// Le gate du formulaire (fungalaxy-form-check) joue le parcours sur le mock du
// tunnel : son POST est FACTICE, il garde le corps recu et repond un dossier
// invente. Il prouve ce que l ecran ENVOIE, pas que le serveur l ACCEPTE. Or
// seule la reservation qui aboutit rapporte quelque chose (lecon du
// 2026-08-21, n4-reservation-post-check).
//
// Ici, tout est vrai sauf la base :
//   - la page est celle de /reserver/libramont, servie par les rewrites de
//     vercel.json appliques dans l ordre (fungalaxy-site.html), et le
//     formulaire y est monte par embed.js, comme sur le site du client ;
//   - le formulaire parle aux VRAIS handlers (public-booking-meta,
//     public-availability, public-reservations) ;
//   - sur les VRAIES lignes de production de Libramont (catalogue, formules,
//     centre, pistes, reservations du jour), lues en SELECT puis refermees ;
//   - dans un double en memoire qui obeit au SQL (celui de
//     n4-reservation-post-check, recopie : ce gate ne doit pas casser l autre).
// La reservation doit aboutir : le handler l insere, la reponse porte SON
// numero (l ecran final ne le montre plus : le SaaS ne s en sert pas), et la
// ligne inseree porte ce que l ecran a montre (centre, jour,
// heure, groupe, prix, contact, mot pour l equipe) ; une formule garde au
// recapitulatif l heure de debut envoyee.
//
// AUCUNE ECRITURE EN PRODUCTION, AUCUN ENVOI. Du fichier .env, seule l adresse
// de la base est lue (jamais une cle d envoi) ; la connexion est refermee
// AVANT que le moindre handler soit charge ; tout appel sortant du processus
// (e-mail, SMS, IA) est ensuite bloque et compte : il doit y en avoir zero.
//
// Trois cas : 4 personnes bowling + laser ; une formule a 6 ; le plus grand
// groupe qui reserve encore en ligne, bowling + laser (des le seuil du centre,
// 31 personnes a Libramont depuis le 2026-09-29, un groupe passe par la
// demande sur mesure : 40 personnes n arrivaient plus aux activites).
//
// Lancement : node scripts/fungalaxy-reservation-post-check.js
// Contre-preuve (ce script sait-il rougir ?) : FG_POST_CASSE=pax sert un
// formulaire qui envoie une personne de trop ; chaque parcours doit rougir.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CENTER = 'libramont';
const PORT = Number(process.env.PINLANE_FG_POST_PORT || 4271);
const BASE = `http://127.0.0.1:${PORT}`;
const EDGE = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = process.env.FG_POST_CASSE || '';
const MUTATIONS = { pax: ['      pax: state.pax,', '      pax: state.pax + 1,'] };
if (CASSE && !MUTATIONS[CASSE]) { console.error(`fungalaxy-reservation-post-check: mutation inconnue ${CASSE}`); process.exit(2); }

let PROD_URL = '';
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^DATABASE_URL=(.*)$/);
  if (m) PROD_URL = m[1].trim().replace(/^["']|["']$/g, '');
}
if (!PROD_URL) {
  console.error('fungalaxy-reservation-post-check: DATABASE_URL absent du .env.');
  process.exit(1);
}
process.env.NODE_ENV = 'test';
process.env.PINLANE_CALENDAR_SYNC = 'off';
delete process.env.VERCEL;

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return Boolean(cond);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendre(frame, fn, ms, arg) {
  try { await frame.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (error) { return false; }
}
// LA FENETRE « ENVIE D UN PEU PLUS ? » s ouvre seule a l arrivee au
// recapitulatif quand le serveur a joint des offres au creneau : un client la
// ferme (« Non merci ») avant de valider, ce parcours aussi. Tant que le
// formulaire n a pas decide de l ouvrir, elle porte data-attendue.
async function passerLaVitrine(f) {
  await attendre(f, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  const ouverte = await f.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); });
  if (ouverte) {
    await f.click('#vitrine .fg-vitrine__non');
    await attendre(f, () => document.querySelector('#vitrine').hidden, 3000);
  }
  return ouverte;
}

// Le jour : un samedi a plus de deux semaines (jamais « aujourd hui », dont
// les heures passent le soir), hors vacances et feries, que le serveur dit
// ouvert. Il est choisi APRES lecture du calendrier servi.
function samediDans(jours) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  c.setUTCDate(c.getUTCDate() + jours);
  while (c.getUTCDay() !== 6) c.setUTCDate(c.getUTCDate() + 1);
  return c.toISOString().slice(0, 10);
}

// ── 1. Lire la production, puis la refermer ─────────────────────────────────
async function lireProduction(dates) {
  const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });
  try {
    const [formulas, steps, activities, centers, clients, reservations, laneStatuses, blocks] = await Promise.all([
      pool.query('select * from formulas;'),
      pool.query('select * from formula_steps;'),
      pool.query('select * from activities;'),
      pool.query('select * from centers;'),
      pool.query('select * from clients;'),
      pool.query('select * from reservations where center_id = $1 and date = any($2::date[]);', [CENTER, dates]),
      pool.query('select * from lane_statuses where center_id = $1;', [CENTER]),
      pool.query('select * from availability_blocks where center_id = $1;', [CENTER]).catch(() => ({ rows: [] })),
    ]);
    const jour = (v) => (v instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(v) : String(v).slice(0, 10));
    return {
      formulas: formulas.rows,
      steps: steps.rows,
      activities: activities.rows,
      centers: centers.rows,
      clients: clients.rows,
      reservations: reservations.rows.map((row) => ({ ...row, date: jour(row.date) })),
      laneStatuses: laneStatuses.rows,
      blocks: blocks.rows,
      formuleOverrides: [],
    };
  } finally {
    await pool.end();
  }
}

// ── 2. Le double, qui obeit au SQL (recopie de n4-reservation-post-check) ────
function undefinedColumn(name, table) {
  const error = new Error(`column "${name}" does not exist (table ${table})`);
  error.code = '42703';
  return error;
}
function project(rows, columnList, table) {
  const columns = String(columnList).split(',').map((part) => part.trim()).filter(Boolean);
  if (columns.length === 1 && columns[0] === '*') return rows.map((row) => ({ ...row }));
  return rows.map((row) => {
    const out = {};
    for (const column of columns) {
      if (!Object.prototype.hasOwnProperty.call(row, column)) throw undefinedColumn(column, table);
      out[column] = row[column];
    }
    return out;
  });
}
function makePool(rows) {
  const inserted = [];
  let nextReservationId = 900001;
  async function query(text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (/^(begin|commit|rollback|savepoint|release savepoint|rollback to savepoint)\b/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 0 };
    const insert = sql.match(/^insert into reservations \(([^)]+)\) values \(([^)]*)\)(?: returning (.+?);?)?$/i);
    if (insert) {
      const columns = insert[1].split(',').map((part) => part.trim());
      const row = { id: nextReservationId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      columns.forEach((column, index) => {
        const value = params[index];
        row[column] = typeof value === 'string' && /^[[{]/.test(value.trim()) ? JSON.parse(value) : value;
      });
      nextReservationId += 1;
      inserted.push(row);
      rows.reservations.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/^insert into /i.test(sql)) return { rows: [], rowCount: 0 };
    if (/^(update|delete|create|alter|drop|comment on)\b/i.test(sql)) return { rows: [], rowCount: 0 };
    const select = sql.match(/^select (.+?) from ([a-z_]+)\b/i);
    if (!select) return { rows: [], rowCount: 0 };
    const columnList = select[1];
    const table = select[2].toLowerCase();
    if (/pg_advisory|now\(\)|current_/i.test(columnList)) return { rows: [], rowCount: 0 };
    const direct = { formulas: rows.formulas, formula_steps: rows.steps, activities: rows.activities, centers: rows.centers, clients: rows.clients, formule_overrides: rows.formuleOverrides };
    if (direct[table]) { const out = project(direct[table], columnList, table); return { rows: out, rowCount: out.length }; }
    if (table === 'reservations') {
      const [date, centerId] = params;
      let list = rows.reservations.filter((row) => row.date === date && row.center_id === centerId);
      if (/status <> 'cancelled'/i.test(sql)) list = list.filter((row) => row.status !== 'cancelled');
      const out = project(list, columnList, table);
      return { rows: out, rowCount: out.length };
    }
    if (table === 'lane_statuses') { const out = project(rows.laneStatuses, columnList, table); return { rows: out, rowCount: out.length }; }
    if (table === 'availability_blocks') { const out = project(rows.blocks, columnList, table); return { rows: out, rowCount: out.length }; }
    return { rows: [], rowCount: 0 };
  }
  return { inserted, query, async connect() { return { query: (t, p) => query(t, p), release() {} }; }, async end() {}, on() {} };
}

// ── 3. Aucun appel sortant, une fois la production refermee ─────────────────
const sortants = [];
function bloquerLeReseau() {
  const local = (u) => /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(String(u || ''));
  const fetchReel = global.fetch;
  global.fetch = async (entree, init) => {
    const url = String((entree && entree.url) || entree);
    if (local(url)) return fetchReel(entree, init);
    sortants.push(url);
    throw new Error(`appel sortant bloque par le gate : ${url}`);
  };
  for (const mod of [require('http'), require('https')]) {
    for (const nom of ['request', 'get']) {
      const reel = mod[nom];
      mod[nom] = function (...args) {
        const a = args[0];
        const hote = typeof a === 'string' ? a : a instanceof URL ? a.href : (a && (a.hostname || a.host)) || '';
        if (!local(hote) && !/^(127\.0\.0\.1|localhost)$/i.test(hote)) {
          sortants.push(String(hote));
          throw new Error(`appel sortant bloque par le gate : ${hote}`);
        }
        return reel.apply(this, args);
      };
    }
  }
}

// ── 4. Le serveur : les rewrites de vercel.json, les vrais handlers ─────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
// Dans l ORDRE du fichier, la premiere regle qui correspond gagne : c est ce
// qui prouve que /reserver/libramont passe avant /reserver/:center.
function reecrire(chemin) {
  for (const r of vercel.rewrites || []) {
    if (/^\/api\//.test(r.destination)) continue;
    const rx = new RegExp('^' + r.source.replace(/:[a-zA-Z]+/g, '[^/]+') + '/?$', 'i');
    if (rx.test(chemin)) return r.destination;
  }
  return chemin;
}
// Les reecritures d API de vercel.json, comme en production : le blocage des
// horaires (/api/public-holds) part vers /api/public-reservations?action=hold.
// Sans elles, le formulaire parlerait a une adresse que ce serveur ignore.
function reecrireApi(url) {
  for (const r of vercel.rewrites || []) {
    if (!/^\/api\//.test(r.destination) || r.source !== url.pathname) continue;
    const dest = new URL(r.destination, BASE);
    url.searchParams.forEach((v, k) => { if (!dest.searchParams.has(k)) dest.searchParams.set(k, v); });
    return dest;
  }
  return url;
}
let visiteur = '10.0.0.1';
function serveur(handlers) {
  return http.createServer(async (req, res) => {
    const url = reecrireApi(new URL(req.url, BASE));
    req.url = `${url.pathname}${url.search}`;
    const api = { '/api/public-booking-meta': handlers.meta, '/api/public-availability': handlers.availability, '/api/public-reservations': handlers.reservations }[url.pathname];
    if (api) {
      // Un visiteur = une adresse : le plafond de requetes par minute
      // s applique a lui comme en production.
      req.headers['x-forwarded-for'] = visiteur;
      res.json = (obj) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
      res.status = (code) => { res.statusCode = code; return res; };
      try { await api(req, res); } catch (error) { if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, message: error.message })); } }
      return;
    }
    if (CASSE && url.pathname === '/assets/fungalaxy-booking.js') {
      const [a, b] = MUTATIONS[CASSE];
      const code = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
      if (code.split(a).length !== 2) { console.error(`fungalaxy-reservation-post-check: la mutation ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      res.end(code.replace(a, b));
      return;
    }
    const cible = reecrire(url.pathname);
    const fichier = path.join(ROOT, decodeURIComponent(cible));
    if (!fichier.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fichier, (err, contenu) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(contenu);
    });
  });
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
async function allerAuJour(f, date) {
  await f.click('#dayBtn');
  const [y, mo] = date.split('-').map(Number);
  const cible = `${MOIS[mo - 1].charAt(0).toUpperCase()}${MOIS[mo - 1].slice(1)} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await f.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await f.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(f, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  if (!(await attendre(f, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading') && !b.disabled; }, 10000, date))) return false;
  await f.click(`#calGrid .fg-cal__day[data-date="${date}"]`);
  return attendre(f, () => document.querySelector('#dayPop').hidden, 3000);
}
async function poserGroupe(f, n) {
  await f.fill('#paxInput', String(n));
  await f.press('#paxInput', 'Tab');
  return attendre(f, (v) => String(document.querySelector('#paxInput').value) === String(v), 3000, n);
}

async function unParcours(page, pool, cas) {
  visiteur = cas.ip;
  const reponses = [];
  const ecoute = (r) => { if (/\/api\/public-reservations/.test(r.url())) reponses.push(r); };
  page.on('response', ecoute);
  await page.goto(`${BASE}/reserver/libramont`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.pinlane-slot iframe', { timeout: 15000 });
  const src = await page.getAttribute('.pinlane-slot iframe', 'src');
  let f = null;
  for (let k = 0; k < 100 && !f; k += 1) { f = page.frames().find((x) => /\/fungalaxy\/libramont\?embed=1/.test(x.url())); if (!f) await dormir(100); }
  ok(Boolean(f) && /\/fungalaxy\/libramont\?embed=1&fond=/.test(src || ''), `[${cas.nom}] /reserver/libramont monte le formulaire par embed.js, en mode embarque`, src || 'aucun cadre');
  if (!f) return;
  ok(await attendre(f, () => document.body.classList.contains('is-embed') && document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 20000), `[${cas.nom}] le catalogue REEL de Libramont est lu par le vrai handler`);
  ok(await allerAuJour(f, cas.date), `[${cas.nom}] le ${cas.date} est choisi`);
  ok(await poserGroupe(f, cas.pax), `[${cas.nom}] ${cas.pax} personnes`);
  await f.click('#goActivities');
  await attendre(f, () => document.querySelector('.fg-scene[data-scene="activites"].is-active'), 8000);
  if (cas.formule) {
    await f.click('#tabFor');
    await attendre(f, () => document.querySelectorAll('#gridFor .fg-card--formule').length > 0, 8000);
    const choisie = await f.evaluate(() => { const c = document.querySelector('#gridFor .fg-card--formule:not(.is-refus)'); return c ? c.dataset.formule : ''; });
    ok(Boolean(choisie), `[${cas.nom}] une formule reservable ce jour-la pour ce groupe`, choisie || 'aucune');
    if (!choisie) return;
    await f.click(`#gridFor .fg-card--formule[data-formule="${choisie}"]`);
    cas.formuleId = choisie;
  } else {
    for (const a of cas.activites) await f.click(`#gridAct .fg-card[data-activity="${a}"]`);
  }
  await f.click('#goHours');
  const heures = await attendre(f, () => !document.querySelector('#hourZone').classList.contains('is-busy') && !document.querySelector('#goContact').disabled, 40000);
  ok(heures, `[${cas.nom}] le vrai moteur rend les heures, et le plan par defaut active « Ces horaires me vont »`);
  if (!heures) return;
  await f.click('#goContact');
  await attendre(f, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 8000);
  await f.fill('#cPrenom', 'Verification'); await f.fill('#cNom', cas.nom); await f.fill('#cEmail', 'verification@example.com'); await f.fill('#cTel', '0470000000');
  // Le mot facultatif pour l equipe (jamais commence par « [ » : le double
  // en memoire relit en JSON une valeur qui commence ainsi).
  await f.fill('#cNote', 'Gâteau au frais');
  // L occasion (requise) : la cle part, et la precision d « Autre » rejoint
  // le mot pour l equipe.
  await f.click(`#occasions .fg-occasion[data-occasion="${cas.occasion}"]`);
  if (cas.precision) await f.fill('#cOccasionAutre', cas.precision);
  await f.check('#cConsent');
  await f.click('#goRecap');
  await attendre(f, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && document.querySelector('#totalAmount'), 8000);
  await passerLaVitrine(f);
  const vu = await f.evaluate(() => ({ total: Number(document.querySelector('#totalAmount').dataset.total), texte: document.querySelector('#recap').textContent.replace(/\s+/g, ' ').trim() }));
  if (cas.formuleId) ok(/Début de la visite à \d{2}:\d{2}/.test(vu.texte), `[${cas.nom}] formule : le recapitulatif garde l heure de debut envoyee`, vu.texte.slice(-160));
  const avant = pool.inserted.length;
  await f.click('#confirmBtn');
  const fini = await attendre(f, () => document.querySelector('.fg-scene[data-scene="fin"].is-active') && document.querySelector('#finBody .fg-done__ticket'), 20000);
  const rep = reponses[reponses.length - 1];
  const corps = rep ? await rep.json().catch(() => null) : null;
  ok(fini && rep && rep.status() >= 200 && rep.status() < 300 && corps && corps.ok !== false, `[${cas.nom}] le VRAI handler accepte la reservation`, rep ? `HTTP ${rep.status()} ${JSON.stringify(corps).slice(0, 160)}` : 'aucune reponse');
  const ligne = pool.inserted.length === avant + 1 ? pool.inserted[pool.inserted.length - 1] : null;
  ok(Boolean(ligne), `[${cas.nom}] une ligne, une seule, est inseree`, `${pool.inserted.length - avant} ligne(s)`);
  if (!ligne) return;
  const idRendu = corps && corps.reservation ? String(corps.reservation.id) : '';
  ok(idRendu === String(ligne.id), `[${cas.nom}] la reponse porte le numero de la ligne inseree`, `${idRendu} / ${ligne.id}`);
  const finTexte = await f.evaluate(() => document.querySelector('#finBody').textContent.replace(/\s+/g, ' ').trim());
  ok(!/n°\s*\d+/.test(finTexte) && !/numéro de réservation/i.test(finTexte), `[${cas.nom}] l ecran final ne montre aucun numero de reservation`, finTexte.slice(0, 140));
  const jour = ligne.date instanceof Date ? ligne.date.toISOString().slice(0, 10) : String(ligne.date).slice(0, 10);
  ok(ligne.center_id === CENTER && jour === cas.date && Number(ligne.pax) === cas.pax, `[${cas.nom}] centre, jour et groupe inseres = ceux choisis`, JSON.stringify({ centre: ligne.center_id, jour, pax: ligne.pax }));
  const prix = Number(ligne.price != null ? ligne.price : ligne.total_price);
  ok(Number.isFinite(prix) && Math.abs(prix - vu.total) < 0.01, `[${cas.nom}] le prix insere = le total affiche au recapitulatif`, `insere ${prix}, affiche ${vu.total}`);
  ok(ligne.email === 'verification@example.com' && /Verification/.test(String(ligne.name || ligne.customer_name || '')), `[${cas.nom}] le contact insere = celui saisi`, JSON.stringify({ nom: ligne.name || ligne.customer_name, email: ligne.email }));
  const notesAttendues = cas.precision ? `Occasion : ${cas.precision}. Gâteau au frais` : 'Gâteau au frais';
  ok(ligne.notes === notesAttendues, `[${cas.nom}] le mot pour l equipe est enregistre par le vrai handler (colonne notes)${cas.precision ? ', precision de l occasion comprise' : ''}`, JSON.stringify(ligne.notes));
  ok(ligne.occasion === cas.occasion, `[${cas.nom}] l occasion est enregistree par le vrai handler (colonne occasion)`, JSON.stringify(ligne.occasion));
  if (cas.formuleId) ok(String(ligne.formule_id || ligne.formula_id || (ligne.program && ligne.program.formuleId) || '') === String(cas.formuleId) || JSON.stringify(ligne).indexOf(`"${cas.formuleId}"`) >= 0, `[${cas.nom}] la formule inseree = celle choisie`, cas.formuleId);
  console.log(`      ligne inseree : ${Object.keys(ligne).sort().join(', ')}`);
  page.off('response', ecoute);
}

(async () => {
  const dates = [samediDans(15), samediDans(22), samediDans(29)];
  console.log(`Centre : ${CENTER} · samedis candidats ${dates.join(', ')}`);
  const rows = await lireProduction(dates);
  console.log(`Production lue en lecture seule, connexion refermee : ${rows.activities.length} activites, ${rows.formulas.length} formules, ${rows.centers.length} centres, ${rows.reservations.length} reservation(s) ces jours-la.`);
  ok(rows.centers.some((c) => c.id === CENTER), 'le centre existe en production');
  bloquerLeReseau();

  const pool = makePool(rows);
  const pgPath = require.resolve(path.join(ROOT, 'node_modules', 'pg'));
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: function FakePool() { return pool; } } };
  // lib/database.js refuse de travailler sans DATABASE_URL (son getPool
  // interne, que la surcharge plus bas ne touche pas). Il recoit une adresse
  // locale qui ne mene nulle part : son Pool est le double, et meme sans lui
  // aucune connexion ne pourrait atteindre la production.
  process.env.DATABASE_URL = 'postgres://verification@127.0.0.1:9/aucune';
  const database = require(path.join(ROOT, 'lib', 'database.js'));
  database.getPool = () => pool;
  const handlers = {
    meta: require(path.join(ROOT, 'api', 'public-booking-meta.js')),
    availability: require(path.join(ROOT, 'api', 'public-availability.js')),
    reservations: require(path.join(ROOT, 'api', 'public-reservations.js')),
  };

  // Le jour retenu : le premier samedi candidat que le VRAI calendrier dit
  // ouvert, hors vacances et feries (les formules les excluent).
  const res = { statusCode: 200, headers: {}, body: '' };
  const faux = { setHeader(k, v) { res.headers[k] = v; }, getHeader(k) { return res.headers[k]; }, end(b) { res.body = b; }, json(o) { res.body = JSON.stringify(o); }, status(c) { res.statusCode = c; return faux; } };
  Object.defineProperty(faux, 'statusCode', { get: () => res.statusCode, set: (v) => { res.statusCode = v; } });
  // La requete meme du formulaire (centerId, calendar, calendarFrom) ; le
  // calendrier revient dans center.calendar, un jour par entree.
  await handlers.meta({ method: 'GET', url: `/api/public-booking-meta?centerId=${CENTER}&calendar=45&calendarFrom=${dates[0]}`, headers: { host: 'gate.local', 'x-forwarded-for': '10.0.0.250' }, socket: { remoteAddress: '10.0.0.250' } }, faux);
  const meta = JSON.parse(res.body || '{}');
  const jours = (meta.center && meta.center.calendar) || [];
  const date = dates.find((d) => { const j = (Array.isArray(jours) ? jours : []).find((x) => x.date === d); return j && j.open && !j.holiday; });
  ok(Boolean(date), 'un samedi candidat est ouvert, hors vacances et feries, selon le vrai calendrier', date || JSON.stringify((Array.isArray(jours) ? jours : []).filter((x) => dates.includes(x.date))).slice(0, 300));
  if (!date) { console.error('fungalaxy-reservation-post-check: pas de jour mesurable.'); process.exit(1); }

  const srv = serveur(handlers);
  await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright-core'));
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    // Le seuil de la demande sur mesure, tel que le VRAI handler le sert.
    const seuil = Number(((meta.center || {}).customRequest || {}).fromPax) || 0;
    const grand = seuil > 1 ? Math.min(40, seuil - 1) : 40;
    const cas = [
      { nom: 'Bowling et laser', ip: '10.0.0.11', date, pax: 4, activites: ['bowling', 'laser_game'], occasion: 'famille' },
      { nom: 'Formule', ip: '10.0.0.12', date, pax: 6, formule: true, occasion: 'anniversaire' },
      { nom: 'Grand groupe', ip: '10.0.0.13', date, pax: grand, activites: ['bowling', 'laser_game'], occasion: 'autre', precision: 'Départ à la retraite' },
    ];
    for (const c of cas) {
      console.log(`\n[${c.nom}] ${c.pax} personnes, ${c.date}`);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e && e.message || e)));
      await unParcours(page, pool, c);
      ok(erreurs.length === 0, `[${c.nom}] aucune erreur de script, page ou cadre`, erreurs.slice(0, 2).join(' | '));
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  ok(sortants.length === 0, 'aucun appel sortant (e-mail, SMS, IA) n est parti du processus', sortants.slice(0, 5).join(', ') || 'zero');
  console.log('');
  if (failures) { console.error(`fungalaxy-reservation-post-check: ${failures} verification(s) en echec.`); process.exit(1); }
  console.log('fungalaxy-reservation-post-check: ALL OK');
})().catch((error) => { console.error(error && error.stack || error); process.exit(1); });

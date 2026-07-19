// Gate du retour marketing en euros (lib/marketing-roi + lien avis Google).
// Zéro réseau, zéro DB : lib/database est patché AVANT tout require applicatif
// (getPool → query routée par fragments SQL, createCommunication → capture).
// Couvre : contrat computeMarketingRoi (mapping sources, sommes, bornes,
// invariants SQL last-touch/annulées/60 j/sent-delivered, erreur → zéros),
// resolveReviewClick (format token, marquage unique, destination stockée),
// endpoint /api/r (302/404/405, jamais de destination en paramètre),
// validation reviewUrl (https + hôtes Google), et le mail post-visite
// (bouton tracké quand configuré, byte-identique côté texte sinon).
const path = require('path');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// ── Patch DB global (avant tout require applicatif) ─────────────────────────
const dbState = {
  sqlLog: [],
  route: null, // (sql, params) => rows | undefined
  created: [],
};
const database = require('../lib/database');
database.getPool = () => ({
  query: async (text, params) => {
    const sql = String(text);
    dbState.sqlLog.push({ sql, params });
    const rows = dbState.route ? dbState.route(sql, params) : undefined;
    return { rows: rows || [] };
  },
});
database.createCommunication = async (row) => { dbState.created.push(row); return { id: 4242, ...row }; };
// Le followup termine par un dispatch immédiat : file vide, zéro DB.
database.listDueCommunications = async () => [];

const marketingRoi = require('../lib/marketing-roi');
const { computeMarketingRoi, resolveReviewClick, MARKETING_SOURCES } = marketingRoi;
const { setAutomationSetting } = require('../lib/ops-communications');
const opsJobs = require('../lib/ops-jobs');

(async () => {
  console.log('[ROI] contrat computeMarketingRoi');
  dbState.route = (sql) => {
    if (sql.includes('marketing_msgs')) {
      return [{
        by_source: [
          { source: 'relance', sent: 5, conversions: 2, revenue: 380 },
          { source: 'birthday_j30', sent: 12, conversions: 3, revenue: 620.4 },
        ],
        review_clicks: 4,
      }];
    }
    return [];
  };
  const roi = await computeMarketingRoi('libramont', { days: 30 });
  ok(roi.revenue === 1000 && roi.conversions === 5 && roi.sent === 17, `totaux sommés depuis les sources (${roi.revenue} €, ${roi.conversions} venues, ${roi.sent} envois)`);
  ok(roi.reviewClicks === 4, 'clics avis Google remontés');
  ok(roi.bySource.length === MARKETING_SOURCES.length, 'TOUTES les sources présentes (même à zéro)');
  const birthday = roi.bySource.find((s) => s.key === 'birthday_j30');
  ok(birthday.revenue === 620 && birthday.label === 'Anniversaires J-30', 'arrondi € + label FR');
  const custom = roi.bySource.find((s) => s.key === 'custom');
  ok(custom.sent === 0 && custom.revenue === 0, 'source sans envoi → zéros propres');

  const roiSql = dbState.sqlLog.find((entry) => entry.sql.includes('marketing_msgs')).sql;
  ok(roiSql.includes('distinct on (res.id)') && roiSql.includes('order by res.id, m.created_at desc'), 'INVARIANT : attribution last-touch (une résa = un seul message, le dernier)');
  // Les annulées ne sont plus exclues par une liste noire ('!= cancelled') mais
  // par une liste BLANCHE des statuts qui prouvent une venue : plus strict, et
  // vérifié pour de vrai par les cas de comportement plus bas.
  ok(roiSql.includes("res.status in ('arrived', 'paid')"), 'INVARIANT : seuls les statuts prouvant une venue comptent (annulées exclues par construction)');
  ok(roiSql.includes("interval '60 days'"), 'INVARIANT : fenêtre 60 jours');
  ok(roiSql.includes("status in ('sent', 'delivered')"), 'INVARIANT : seuls les messages partis comptent');
  ok(!roiSql.includes("'confirmation'") && !roiSql.includes("reminder"), 'INVARIANT : les transactionnels ne sont jamais attribués');

  // ── HONNÊTETÉ DU CHIFFRE : « réservé » n'est PAS « venu » ─────────────────
  // Le filtre vit dans le SQL, donc l'assertion de sous-chaîne ne prouve rien
  // sur le COMPORTEMENT. On extrait les clauses réelles du join et on les
  // ÉVALUE contre des réservations simulées. Toute forme de clause que le
  // test ne sait pas interpréter fait ÉCHOUER : jamais de vert silencieux
  // parce que le parseur n'a pas compris la requête.
  //
  // Statuts réels (database/schema.sql:14 + lib/database.js:10) :
  //   status            : pending | arrived | paid | cancelled
  //   validation_status : draft | requested | staff_review | confirmed | rejected
  // Il n'existe AUCUN statut 'no_show' : un client qui ne vient jamais reste
  // 'pending' à vie. C'est donc 'pending sur une date passée' qui joue le rôle
  // du no-show dans les cas ci-dessous.
  const HONESTY_CLAUSE_RE = /and\s+(res\.(?:status|validation_status|date))\s*(!=|<=|>=|=|<|>|in)\s*(\([^)]*\)|'[^']*'|current_date)/gi;

  function honestyClauses(sql) {
    const found = [];
    let match;
    HONESTY_CLAUSE_RE.lastIndex = 0;
    while ((match = HONESTY_CLAUSE_RE.exec(sql))) {
      found.push({ column: match[1].toLowerCase(), op: match[2].toLowerCase(), operand: match[3].toLowerCase() });
    }
    return found;
  }

  function clauseAccepts(clause, row) {
    const literals = (clause.operand.match(/'([^']*)'/g) || []).map((raw) => raw.slice(1, -1));
    if (clause.column === 'res.status' || clause.column === 'res.validation_status') {
      const value = clause.column === 'res.status' ? row.status : row.validationStatus;
      if (clause.op === 'in') return literals.includes(value);
      if (clause.op === '=') return value === literals[0];
      if (clause.op === '!=') return value !== literals[0];
    }
    if (clause.column === 'res.date' && clause.operand === 'current_date') {
      if (clause.op === '<') return row.daysFromToday < 0;
      if (clause.op === '<=') return row.daysFromToday <= 0;
    }
    throw new Error(`clause non interprétable par le test : ${clause.column} ${clause.op} ${clause.operand}`);
  }

  // → true (comptée en €), false (exclue), ou null si le filtre est incomplet
  //   ou illisible (le test refuse alors de conclure et passe au rouge).
  let lastHonestyError = '';
  function countedAsRevenue(sql, row) {
    try {
      const clauses = honestyClauses(sql);
      if (clauses.length < 3) {
        throw new Error(`filtre incomplet : ${clauses.length} clause(s) statut/validation/date trouvée(s), 3 attendues`);
      }
      return clauses.every((clause) => clauseAccepts(clause, row));
    } catch (error) {
      lastHonestyError = error.message;
      return null;
    }
  }

  const PAST = -3;
  const FUTURE = 5;
  const honoredPaid = { status: 'paid', validationStatus: 'confirmed', daysFromToday: PAST };
  const honoredArrived = { status: 'arrived', validationStatus: 'confirmed', daysFromToday: PAST };
  const neverCame = { status: 'pending', validationStatus: 'confirmed', daysFromToday: PAST };
  const awaitingStaff = { status: 'arrived', validationStatus: 'staff_review', daysFromToday: PAST };
  const futureBooking = { status: 'paid', validationStatus: 'confirmed', daysFromToday: FUTURE };
  const cancelled = { status: 'cancelled', validationStatus: 'confirmed', daysFromToday: PAST };

  ok(countedAsRevenue(roiSql, honoredPaid) === true, 'COMPTÉE : visite passée réellement honorée (payée)');
  ok(countedAsRevenue(roiSql, honoredArrived) === true, 'COMPTÉE : visite passée réellement honorée (client arrivé)');
  ok(countedAsRevenue(roiSql, neverCame) === false, 'EXCLUE : réservation passée restée « pending » (le no-show, faute de statut dédié)');
  ok(countedAsRevenue(roiSql, awaitingStaff) === false, 'EXCLUE : demande encore en « staff_review », pas encore approuvée');
  ok(countedAsRevenue(roiSql, futureBooking) === false, 'EXCLUE : réservation à une date FUTURE (attendue, pas rapportée)');
  ok(countedAsRevenue(roiSql, cancelled) === false, 'EXCLUE : réservation annulée');
  if (lastHonestyError) console.log(`      (dernier refus de conclure : ${lastHonestyError})`);

  const clamped = await computeMarketingRoi('libramont', { days: 9999 });
  ok(clamped.days === 365, 'fenêtre bornée à 365 j');
  dbState.route = () => { throw new Error('db down'); };
  const down = await computeMarketingRoi('libramont', { days: 30 });
  ok(down.revenue === 0 && down.bySource.length === MARKETING_SOURCES.length, 'DB en panne → zéros, jamais de throw');

  console.log('\n[CLIC AVIS] resolveReviewClick');
  dbState.route = () => [];
  dbState.sqlLog.length = 0;
  ok((await resolveReviewClick('pas-un-token')) === null && dbState.sqlLog.length === 0, 'token mal formé → null SANS requête');
  ok((await resolveReviewClick('a'.repeat(32))) === null, 'token inconnu → null');
  let updates = 0;
  dbState.route = (sql) => {
    if (sql.startsWith('select id, payload')) return [{ id: 7, payload: { reviewUrl: 'https://g.page/r/fungalaxy', reviewToken: 'b'.repeat(32) } }];
    if (sql.includes('reviewClickAt')) { updates += 1; return []; }
    return [];
  };
  const click = await resolveReviewClick('B'.repeat(32));
  ok(click && click.url === 'https://g.page/r/fungalaxy' && updates === 1, 'token connu → URL stockée + clic marqué (insensible à la casse)');
  dbState.route = (sql) => {
    if (sql.startsWith('select id, payload')) return [{ id: 7, payload: { reviewUrl: 'https://g.page/r/fungalaxy', reviewClickAt: '2026-07-15T10:00:00Z' } }];
    if (sql.includes('reviewClickAt')) { updates += 1; return []; }
    return [];
  };
  await resolveReviewClick('b'.repeat(32));
  ok(updates === 1, 'déjà cliqué → PAS de second marquage (premier clic conservé)');

  console.log('\n[/api/r] endpoint public');
  // Patch de la fonction AVANT le require du handler (il destructure à l\'import).
  const savedResolve = marketingRoi.resolveReviewClick;
  marketingRoi.resolveReviewClick = async (token) => (token === 'c'.repeat(32) ? { url: 'https://g.page/r/x' } : null);
  const rHandler = require('../api/r.js');
  const fakeRes = () => ({ statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, body: '', end(chunk) { this.body = String(chunk || ''); } });
  const res302 = fakeRes();
  await rHandler({ method: 'GET', url: `/api/r?k=${'c'.repeat(32)}`, headers: { host: 'x' } }, res302);
  ok(res302.statusCode === 302 && res302.headers.location === 'https://g.page/r/x', 'token valide → 302 vers l\'URL STOCKÉE (pas de destination en paramètre)');
  const res404 = fakeRes();
  await rHandler({ method: 'GET', url: '/api/r?k=inconnu', headers: { host: 'x' } }, res404);
  ok(res404.statusCode === 404, 'token inconnu → 404');
  const res405 = fakeRes();
  await rHandler({ method: 'POST', url: '/api/r', headers: { host: 'x' } }, res405);
  ok(res405.statusCode === 405, 'POST → 405');
  marketingRoi.resolveReviewClick = savedResolve;

  console.log('\n[REVIEW URL] validation du réglage (séquence Merci post-visite)');
  const settingsState = { stored: {} };
  const settingsDeps = {
    query: async (text, params) => {
      const sql = String(text);
      if (sql.trim().startsWith('select')) return { rows: [{ settings: settingsState.stored }] };
      settingsState.stored = JSON.parse(params[1]);
      return { rows: [] };
    },
  };
  const saved = await setAutomationSetting('libramont', 'post_visit', { reviewUrl: 'https://g.page/r/fungalaxy-avis' }, settingsDeps);
  ok(saved.post_visit.reviewUrl === 'https://g.page/r/fungalaxy-avis', 'g.page accepté et résolu');
  const savedMaps = await setAutomationSetting('libramont', 'post_visit', { reviewUrl: 'https://search.google.com/local/writereview?placeid=X' }, settingsDeps);
  ok(savedMaps.post_visit.reviewUrl.includes('search.google.com'), 'search.google.com accepté');
  for (const [bad, label] of [
    ['http://g.page/r/x', 'http non chiffré'],
    ['https://evil.com/google.com', 'domaine non-Google'],
    ['https://notgoogle.com.evil.io/x', 'suffixe trompeur'],
  ]) {
    let threw = false;
    try { await setAutomationSetting('libramont', 'post_visit', { reviewUrl: bad }, settingsDeps); } catch (e) { threw = e.expose === true; }
    ok(threw, `rejeté : ${label}`);
  }
  let wrongKey = false;
  try { await setAutomationSetting('libramont', 'reactivation', { reviewUrl: 'https://g.page/x' }, settingsDeps); } catch (e) { wrongKey = e.expose === true; }
  ok(wrongKey, 'reviewUrl sur une autre séquence → rejeté');
  const cleared = await setAutomationSetting('libramont', 'post_visit', { reviewUrl: '' }, settingsDeps);
  ok(!cleared.post_visit.reviewUrl, 'champ vidé → lien effacé');

  console.log('\n[MAIL POST-VISITE] bouton avis tracké');
  const followup = opsJobs.__test.handleReservationFollowup;
  ok(opsJobs.__test.publicBaseUrl() === 'https://www.mngfunglxy.com', 'base publique = domaine prod par défaut');
  // Sans lien configuré : pas de token, pas de bouton.
  settingsState.stored = {};
  dbState.route = (sql) => (sql.trim().startsWith('select') && sql.includes('center_automation_settings') ? [{ settings: settingsState.stored }] : []);
  dbState.created.length = 0;
  // Le balisage hostile est place sur le PRENOM : depuis la refonte des
  // gabarits (2026-07-19) le mail post-visite salue par le prenom seul, donc un
  // nom de famille piege ne traverserait plus le rendu et l'assert ci-dessous
  // passerait sans rien prouver.
  await followup({ payload: { reservation: { email: 'marie@test.be', name: '<b>Marie</b> Dupont', centerId: 'libramont', id: 9, date: '2026-07-14' } } });
  const plain = dbState.created[0];
  ok(plain && !plain.payload.reviewToken && !plain.body.includes('/api/r?k='), 'sans lien configuré → aucun bouton, aucun token');
  // L'assertion negative doit porter sur la charge REELLEMENT injectee. Elle
  // visait `<b>Dupont`, absent du payload depuis que la charge est passee sur le
  // prenom : elle etait donc vraie par construction et ne prouvait plus rien.
  ok(plain.body.includes('&lt;b&gt;') && !plain.body.includes('<b>Marie</b>'), 'nom du client ÉCHAPPÉ dans le HTML (fix injection)');
  ok(plain.payload.textBody.includes('Marie'), 'texte brut intact dans le payload');
  // Avec lien : token 32 hex + bouton tracké + URL stockée.
  settingsState.stored = { post_visit: { reviewUrl: 'https://g.page/r/fungalaxy-avis' } };
  dbState.created.length = 0;
  await followup({ payload: { reservation: { email: 'lucas@test.be', name: 'Lucas', centerId: 'libramont', id: 10, date: '2026-07-14' } } });
  const tracked = dbState.created[0];
  ok(tracked && /^[0-9a-f]{32}$/.test(tracked.payload.reviewToken || ''), 'token 128 bits généré');
  ok(tracked.body.includes(`/api/r?k=${tracked.payload.reviewToken}`) && tracked.body.includes('avis Google'), 'bouton avis tracké dans le mail');
  ok(tracked.payload.reviewUrl === 'https://g.page/r/fungalaxy-avis', 'destination stockée dans le payload (jamais dans l\'URL du lien)');

  if (failures) { console.error(`\nmarketing-roi-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nmarketing-roi-check: ALL OK');
})().catch((error) => { console.error('marketing-roi-check CRASH:', error.stack || error.message); process.exit(1); });

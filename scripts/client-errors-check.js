// Gate de la TELEMETRIE D'ERREURS des consoles staff (lib/client-errors.js,
// table client_errors, database/client-errors-schema.sql).
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif (motif de scripts/founder-cockpit-check.js). Le faux pool
// OBEIT AU TEXTE SQL (il lit les filtres et les parametres dans la requete
// recue) : du code non filtre ou mal parametre ferait virer les assertions au
// rouge, pas au vert.
//
// CE QUE CE GATE PROUVE, chaque point contre-eprouve par MUTATION du code
// (le script mute lib/client-errors.js, verifie que l'assertion ROUGIT,
// restaure par edition inverse : jamais git checkout) :
//
//   (a) CAPS appliques sur la VALEUR passee a l'insert : un message de 5000
//       caracteres est stocke a 500 exactement (et source 300, stack 1500,
//       user_agent 200). Mesure sur les parametres captures, pas sur le code.
//   (b) NORMALISATION du hash : deux stacks identiques a la ligne/colonne
//       pres produisent le MEME stack_hash ; deux stacks differents, deux
//       hashs differents. C'est ce qui fait qu'un bump de version ne cree pas
//       un faux nouveau bug dans le cockpit.
//   (c) RATE-LIMIT comportemental : le 21e appel du meme membre dans l'heure
//       ne produit AUCUN insert (compte des appels du faux pool), repond
//       { ok:true, dropped:true }, n'affecte pas les autres membres, et la
//       fenetre se libere apres une heure.
//   (d) GROUPEMENT : 3 erreurs portant 2 hashs -> 2 groupes aux comptes
//       exacts, membres distincts comptes, ordre lastAt desc, fenetre
//       sinceDays et limit respectees.
//   (e) AUCUN motif de secret ni de PII (email, Bearer, sk-/re_, postgres://,
//       JWT) dans le JSON serialise des groupes, meme quand le client en
//       envoie dans le message et le stack.
//   (f) la telemetrie ne JETTE jamais : base indisponible -> { ok:true,
//       dropped:true }, aucune exception vers la console observee.
//
// Lancement : node scripts/client-errors-check.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// Faux pool pg : capture les INSERT (parametres par colonne) et sert les
// SELECT en obeissant au texte SQL recu (filtres member_id, fenetre horaire,
// group by stack_hash, make_interval, limit).
// ---------------------------------------------------------------------------
const errorRows = [];
const insertLog = [];
let failAllQueries = false;

function reset() {
  errorRows.length = 0;
  insertLog.length = 0;
}

function insertCount() {
  return insertLog.length;
}

function nthInsert(n, colName) {
  const entry = insertLog[n];
  if (!entry) return undefined;
  const idx = entry.cols.indexOf(colName);
  return idx === -1 ? undefined : entry.params[idx];
}

function lastInsert(colName) {
  return nthInsert(insertLog.length - 1, colName);
}

class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text, params = []) {
    if (failAllQueries) throw new Error('base indisponible (simule)');
    const sql = String(text);

    if (/insert into client_errors/i.test(sql)) {
      const cols = (sql.match(/insert into client_errors \(([^)]+)\)/i) || [null, ''])[1]
        .split(',').map((c) => c.trim()).filter(Boolean);
      const row = { id: errorRows.length + 1, occurred_at: new Date() };
      cols.forEach((col, i) => { row[col] = params[i]; });
      errorRows.push(row);
      insertLog.push({ cols, params });
      return { rows: [{ id: row.id }], rowCount: 1 };
    }

    if (/select count\(\*\)::int as recent/i.test(sql)) {
      // Obeissance au texte : le filtre membre et la fenetre horaire ne
      // s'appliquent que si le SQL les contient VRAIMENT. Un code qui
      // oublierait l'un des deux ferait rougir la section [C].
      const m = sql.match(/member_id = \$(\d+)/i);
      const memberId = m ? params[Number(m[1]) - 1] : null;
      const windowed = /interval '1 hour'/i.test(sql);
      const cutoff = Date.now() - 3600 * 1000;
      const n = errorRows.filter((r) =>
        (m ? r.member_id === memberId : true)
        && (!windowed || r.occurred_at.getTime() > cutoff)).length;
      return { rows: [{ recent: n }], rowCount: 1 };
    }

    if (/group by stack_hash/i.test(sql)) {
      const daysMatch = sql.match(/make_interval\(days => \$(\d+)\)/i);
      const limitMatch = sql.match(/limit \$(\d+)/i);
      const days = daysMatch ? Number(params[Number(daysMatch[1]) - 1]) : 3650;
      const limit = limitMatch ? Number(params[Number(limitMatch[1]) - 1]) : errorRows.length;
      const cutoff = Date.now() - days * 86400 * 1000;
      const within = errorRows.filter((r) => r.occurred_at.getTime() > cutoff);
      const byHash = new Map();
      for (const row of within) {
        if (!byHash.has(row.stack_hash)) byHash.set(row.stack_hash, []);
        byHash.get(row.stack_hash).push(row);
      }
      const groups = [...byHash.entries()].map(([hash, rows]) => {
        const sorted = rows.slice().sort((a, b) => (b.occurred_at - a.occurred_at) || (b.id - a.id));
        const latest = sorted[0];
        return {
          stack_hash: hash,
          count: rows.length,
          last_at: new Date(Math.max(...rows.map((r) => r.occurred_at.getTime()))).toISOString(),
          first_at: new Date(Math.min(...rows.map((r) => r.occurred_at.getTime()))).toISOString(),
          centers: [...new Set(rows.map((r) => r.center_id))],
          pages: [...new Set(rows.map((r) => r.page))],
          sample_message: latest.message,
          sample_source: latest.source,
          sample_stack_excerpt: latest.stack_excerpt,
          members_touches: new Set(rows.filter((r) => r.member_id).map((r) => r.member_id)).size,
        };
      });
      groups.sort((a, b) => (a.last_at < b.last_at ? 1 : a.last_at > b.last_at ? -1 : 0));
      return { rows: groups.slice(0, Math.max(0, limit)), rowCount: Math.min(groups.length, limit) };
    }

    return { rows: [], rowCount: 0 };
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';
process.env.ALLOW_INSECURE_STAFF_CODES = 'true';

const libPath = path.join(ROOT, 'lib', 'client-errors.js');
function freshLib() {
  delete require.cache[require.resolve(libPath)];
  return require(libPath);
}
let lib = freshLib();

const HEX40 = /^[0-9a-f]{40}$/;

// Deux stacks du MEME bug a deux versions du bundle : seuls les numeros de
// ligne/colonne different. Un troisieme stack, bug distinct.
const STACK_V1 = 'TypeError: menu is undefined\n    at renderMenu (https://www.mngfunglxy.com/assets/staff-pages-v2.js:1234:56)\n    at dispatch (https://www.mngfunglxy.com/assets/app-main.js:87:9)';
const STACK_V2 = 'TypeError: menu is undefined\n    at renderMenu (https://www.mngfunglxy.com/assets/staff-pages-v2.js:4321:7)\n    at dispatch (https://www.mngfunglxy.com/assets/app-main.js:99:1)';
const STACK_OTHER = 'RangeError: profondeur maximale\n    at boucle (https://www.mngfunglxy.com/assets/staff-pages-v2.js:10:2)';

// ---------------------------------------------------------------------------
// Sondes reutilisees par les sections vertes ET par la contre-preuve par
// mutation : chacune repond "l'invariant tient-il ?" sur le VRAI comportement.
// ---------------------------------------------------------------------------
async function probeCap(mod) {
  reset();
  await mod.recordClientError({ message: 'E'.repeat(5000), memberId: 'probe:cap', stack: STACK_V1 });
  const stored = lastInsert('message');
  return typeof stored === 'string' && stored.length === 500;
}

async function probeNormalization(mod) {
  reset();
  await mod.recordClientError({ message: 'Msg', memberId: 'probe:n1', stack: STACK_V1 });
  await mod.recordClientError({ message: 'Msg', memberId: 'probe:n2', stack: STACK_V2 });
  const h1 = nthInsert(0, 'stack_hash');
  const h2 = nthInsert(1, 'stack_hash');
  return Boolean(h1) && h1 === h2;
}

async function probeRateLimit(mod) {
  reset();
  for (let i = 0; i < 21; i += 1) {
    await mod.recordClientError({ message: `Erreur ${i}`, memberId: 'probe:rate', stack: STACK_V1 });
  }
  return insertCount() === 20;
}

(async () => {
  // =========================================================================
  console.log('[A] caps appliques sur la VALEUR passee a l\'insert');
  // =========================================================================
  reset();
  const bigEntry = {
    message: 'E'.repeat(5000),
    source: 's'.repeat(1000),
    stack: `${STACK_V1}\n${'x'.repeat(4000)}`,
    userAgent: 'u'.repeat(500),
    page: 'p'.repeat(300),
    memberId: 'libramont:qa',
    lineno: '42',
    colno: 7.5,
  };
  const bigRes = await lib.recordClientError(bigEntry);
  ok(bigRes && bigRes.ok === true && bigRes.dropped === false, 'entree valide : { ok:true, dropped:false }');
  ok(insertCount() === 1, `un insert et un seul (obtenu ${insertCount()})`);
  const storedMessage = lastInsert('message');
  ok(typeof storedMessage === 'string' && storedMessage.length === 500,
    `message 5000 chars -> 500 stockes, mesure sur le parametre insere (obtenu ${storedMessage ? storedMessage.length : 'aucun'})`);
  ok(String(lastInsert('source')).length === 300,
    `source 1000 chars -> 300 stockes (obtenu ${String(lastInsert('source')).length})`);
  ok(String(lastInsert('stack_excerpt')).length === 1500,
    `stack 4000+ chars -> stack_excerpt 1500 (obtenu ${String(lastInsert('stack_excerpt')).length})`);
  ok(String(lastInsert('user_agent')).length === 200,
    `user_agent 500 chars -> 200 stockes (obtenu ${String(lastInsert('user_agent')).length})`);
  ok(String(lastInsert('page')).length === 120,
    `page 300 chars -> 120 stockes (obtenu ${String(lastInsert('page')).length})`);
  ok(lastInsert('lineno') === 42, 'lineno "42" -> entier 42');
  ok(lastInsert('colno') === null, 'colno 7.5 (non entier) -> null');
  ok(lastInsert('center_id') === 'libramont', 'centerId absent -> defaut libramont');
  ok(HEX40.test(String(lastInsert('stack_hash'))), 'stack_hash est un sha1 hex de 40 caracteres');

  const emptyRes = await lib.recordClientError({ message: '   ', memberId: 'libramont:qa' });
  ok(emptyRes && emptyRes.ok === true && emptyRes.dropped === true && insertCount() === 1,
    'message vide -> dropped:true, AUCUN insert supplementaire');

  // =========================================================================
  console.log('\n[B] normalisation du hash : meme bug malgre le bump de version');
  // =========================================================================
  ok(await probeNormalization(lib),
    'deux stacks identiques a la ligne/colonne pres -> MEME stack_hash');
  await lib.recordClientError({ message: 'Autre bug', memberId: 'probe:n3', stack: STACK_OTHER });
  const hashPair = nthInsert(0, 'stack_hash');
  const hashOther = nthInsert(2, 'stack_hash');
  ok(Boolean(hashOther) && hashOther !== hashPair,
    'stack different -> stack_hash different');
  ok(HEX40.test(String(hashOther)), 'le hash du second groupe est aussi un sha1 hex');

  reset();
  await lib.recordClientError({ message: 'Sans stack', source: 'https://x/app.js', memberId: 'probe:f1' });
  await lib.recordClientError({ message: 'Sans stack', source: 'https://x/app.js', memberId: 'probe:f2' });
  await lib.recordClientError({ message: 'Sans stack, autre message', source: 'https://x/app.js', memberId: 'probe:f3' });
  ok(nthInsert(0, 'stack_hash') === nthInsert(1, 'stack_hash')
    && nthInsert(0, 'stack_hash') !== nthInsert(2, 'stack_hash'),
  'repli sans stack : hash stable sur message+source, distinct si le message change');

  // =========================================================================
  console.log('\n[C] rate-limit comportemental : 20 max par membre et par heure');
  // =========================================================================
  reset();
  const MEMBER = 'libramont:directrice';
  let droppedBefore21 = 0;
  for (let i = 0; i < 20; i += 1) {
    const res = await lib.recordClientError({ message: `Erreur ${i}`, memberId: MEMBER, stack: STACK_V1 });
    if (!res || res.dropped) droppedBefore21 += 1;
  }
  ok(droppedBefore21 === 0 && insertCount() === 20,
    `les 20 premiers appels inserent tous (inserts: ${insertCount()}, drops: ${droppedBefore21})`);
  const res21 = await lib.recordClientError({ message: 'Erreur 21', memberId: MEMBER, stack: STACK_V1 });
  ok(res21 && res21.ok === true && res21.dropped === true,
    '21e appel : { ok:true, dropped:true }, silencieux, jamais une erreur');
  ok(insertCount() === 20,
    `21e appel : AUCUN insert au faux pool (compte toujours ${insertCount()})`);
  const resOther = await lib.recordClientError({ message: 'Autre poste', memberId: 'gembloux:staff', stack: STACK_V1 });
  ok(resOther && resOther.dropped === false && insertCount() === 21,
    'le plafond est PAR MEMBRE : un autre membre insere normalement');
  // La fenetre est PAR HEURE : on vieillit les lignes du membre plafonne de
  // deux heures, son prochain appel doit inserer de nouveau.
  errorRows.forEach((row) => {
    if (row.member_id === MEMBER) row.occurred_at = new Date(Date.now() - 2 * 3600 * 1000);
  });
  const resAfterWindow = await lib.recordClientError({ message: 'Apres la fenetre', memberId: MEMBER, stack: STACK_V1 });
  ok(resAfterWindow && resAfterWindow.dropped === false && insertCount() === 22,
    'fenetre glissante : une heure plus tard, le meme membre insere de nouveau');

  // =========================================================================
  console.log('\n[D] groupement : 3 erreurs, 2 hashs -> 2 groupes aux comptes exacts');
  // =========================================================================
  reset();
  await lib.recordClientError({ message: 'Msg un', memberId: 'libramont:dir', centerId: 'libramont', page: 'menu', stack: STACK_V1 });
  await lib.recordClientError({ message: 'Msg deux', memberId: 'gembloux:staff', centerId: 'gembloux', page: 'emails', stack: STACK_V2 });
  await lib.recordClientError({ message: 'Msg trois', memberId: 'libramont:dir', centerId: 'libramont', page: 'planning', stack: STACK_OTHER });
  // Horodatage controle : la paire a la derniere occurrence la plus recente.
  errorRows[0].occurred_at = new Date(Date.now() - 3000 * 1000);
  errorRows[1].occurred_at = new Date(Date.now() - 1000 * 1000);
  errorRows[2].occurred_at = new Date(Date.now() - 2000 * 1000);

  const groups = await lib.loadClientErrorGroups({});
  ok(Array.isArray(groups) && groups.length === 2,
    `2 groupes exactement (obtenu ${Array.isArray(groups) ? groups.length : 'aucun'})`);
  const first = groups[0] || {};
  const second = groups[1] || {};
  ok(first.count === 2 && second.count === 1,
    `comptes exacts et ordre lastAt desc : [${first.count}, ${second.count}] attendu [2, 1]`);
  ok(first.stackHash === nthInsert(0, 'stack_hash'),
    'le groupe de tete est celui de la paire normalisee (V1+V2)');
  ok(new Date(first.lastAt) > new Date(second.lastAt),
    'ordre verifie sur les VALEURS lastAt, pas sur une position supposee');
  ok(first.membersTouches === 2 && second.membersTouches === 1,
    `membres distincts comptes (obtenu ${first.membersTouches} et ${second.membersTouches})`);
  ok(Array.isArray(first.centers) && first.centers.length === 2
    && first.centers.includes('libramont') && first.centers.includes('gembloux'),
  'centers[] du groupe de tete : les deux centres touches');
  ok(Array.isArray(first.pages) && first.pages.length === 2
    && first.pages.includes('menu') && first.pages.includes('emails'),
  'pages[] du groupe de tete : les deux pages touchees');
  ok(first.sampleMessage === 'Msg deux',
    `sampleMessage = message de la DERNIERE occurrence (obtenu "${first.sampleMessage}")`);
  ok(new Date(first.firstAt) < new Date(first.lastAt),
    'firstAt < lastAt sur le groupe de deux occurrences');

  const limited = await lib.loadClientErrorGroups({ limit: 1 });
  ok(limited.length === 1 && limited[0].stackHash === first.stackHash,
    'limit=1 : un seul groupe, le plus recent');
  errorRows[2].occurred_at = new Date(Date.now() - 20 * 86400 * 1000);
  const windowed = await lib.loadClientErrorGroups({ sinceDays: 14 });
  const wide = await lib.loadClientErrorGroups({ sinceDays: 90 });
  ok(windowed.length === 1 && wide.length === 2,
    `sinceDays filtre vraiment : 14 j -> ${windowed.length} groupe(s), 90 j -> ${wide.length}`);

  // =========================================================================
  console.log('\n[E] aucun motif de secret ni de PII dans le JSON serialise');
  // =========================================================================
  reset();
  await lib.recordClientError({
    message: 'Echec fetch pour bob.dupont@example.com avec Bearer abc.def.ghi-jkl et cle sk-test1234567890',
    source: 'https://www.mngfunglxy.com/assets/app-main.js',
    stack: 'TypeError: boom\n    at f (https://www.mngfunglxy.com/assets/app-main.js:1:2)\n    postgres://user:motdepasse@host/db eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdef123456',
    memberId: 'libramont:dir',
    userAgent: 'Mozilla/5.0 contact admin@example.com',
  });
  const secretGroups = await lib.loadClientErrorGroups({});
  const serialized = JSON.stringify(secretGroups);
  const SECRET_PATTERNS = [
    ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ['Bearer', /Bearer\s/],
    ['cle sk-', /sk-[A-Za-z0-9_-]{8,}/],
    ['cle re_', /re_[A-Za-z0-9_-]{8,}/],
    ['URL postgres', /postgres(?:ql)?:\/\//],
    ['JWT', /eyJ[A-Za-z0-9_-]{10,}\./],
  ];
  const leaks = SECRET_PATTERNS.filter(([, rx]) => rx.test(serialized)).map(([name]) => name);
  ok(leaks.length === 0,
    `aucun motif de secret dans le JSON des groupes (${leaks.length ? `fuite: ${leaks.join(', ')}` : 'verifie sur le JSON complet'})`);
  ok(!serialized.includes('example.com') && !serialized.includes('motdepasse'),
    'les valeurs sensibles elles-memes sont absentes du JSON');
  ok(String(lastInsert('message')).includes('[expurge]')
    && String(lastInsert('stack_excerpt')).includes('[expurge]'),
  'l\'expurgation a eu lieu AVANT l\'insert (marqueur [expurge] dans les valeurs stockees)');

  // =========================================================================
  console.log('\n[F] la telemetrie ne jette jamais : base indisponible -> drop silencieux');
  // =========================================================================
  failAllQueries = true;
  let threw = false;
  let downRes = null;
  try {
    downRes = await lib.recordClientError({ message: 'Pendant la panne', memberId: 'libramont:dir' });
  } catch (error) {
    threw = true;
  }
  failAllQueries = false;
  ok(!threw && downRes && downRes.ok === true && downRes.dropped === true,
    'base en panne : { ok:true, dropped:true }, aucune exception vers le client');

  // =========================================================================
  console.log('\n[G] contre-preuve par MUTATION : le gate sait rougir, puis restauration inverse');
  // =========================================================================
  async function withMutation(anchor, replacement, probe, label) {
    const original = fs.readFileSync(libPath, 'utf8');
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`client-errors-check: ancre de mutation introuvable ou ambigue (${occurrences} occurrence(s)) : ${label}`);
      process.exit(1);
    }
    const mutated = original.replace(anchor, replacement);
    if (mutated === original) {
      console.error(`client-errors-check: la mutation n'a rien change au fichier : ${label}`);
      process.exit(1);
    }
    fs.writeFileSync(libPath, mutated);
    let holds = true;
    try {
      holds = await probe(freshLib());
    } finally {
      // Restauration par EDITION INVERSE : reecriture du contenu exact
      // d'origine, jamais git checkout.
      fs.writeFileSync(libPath, original);
    }
    if (holds) {
      console.error(`client-errors-check: MUTATION SANS EFFET, le gate ne sait pas rougir sur ce point : ${label}`);
      process.exit(1);
    }
    ok(true, `mutation "${label}" : l'invariant est viole, le gate ROUGIRAIT`);
    lib = freshLib();
    const restoredHolds = await probe(lib);
    ok(restoredHolds, `restauration inverse "${label}" : l'invariant tient de nouveau`);
  }

  await withMutation(
    'const MESSAGE_CAP = 500;',
    'const MESSAGE_CAP = 5000;',
    probeCap,
    'cap message 500 desactive',
  );

  await withMutation(
    ".replace(/\\d+/g, 'N')",
    ".replace(/(?!x)x/g, 'N')",
    probeNormalization,
    'normalisation des chiffres du stack desactivee',
  );

  await withMutation(
    'const MAX_PER_MEMBER_PER_HOUR = 20;',
    'const MAX_PER_MEMBER_PER_HOUR = 999999;',
    probeRateLimit,
    'rate-limit 20/membre/heure desactive',
  );

  if (failures) {
    console.error(`\nclient-errors-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\nclient-errors-check: ALL OK');
})().catch((error) => {
  console.error('client-errors-check: exception', error);
  process.exit(1);
});

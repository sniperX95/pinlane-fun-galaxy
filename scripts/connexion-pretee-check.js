// UNE COUPURE SUR UNE CONNEXION PRETEE NE FAIT PLUS TOMBER LE SERVEUR (2026-11-18, point C6 de la
// verification avant le lancement).
//
// Le trou, verifie dans le code de node-postgres (pg 8.20, pg-pool 3.13) : une connexion qui dort dans
// le pool est ecoutee (lib/database.js, pool.on('error')), mais pg-pool retire cet ecouteur quand il la
// prete (pool.connect(), donc chaque withTransaction) et ne le remet qu au retour. Pendant le pret, une
// coupure du reseau fait emettre 'error' a la connexion elle-meme (Client._handleErrorEvent), en pleine
// requete comme entre deux. Personne ne l ecoutait : Node leve l erreur, et le processus tombe avec
// toutes les demandes qu il servait.
//
// Ce gate joue le VRAI pg, le VRAI pg-pool et la vraie lib/database.js contre un petit serveur local
// qui parle le protocole de Postgres juste assez pour ouvrir une session et repondre aux requetes, et
// qui coupe la connexion quand on le lui demande (zero base, zero reseau sortant) :
//   [A] ENTRE DEUX REQUETES : une transaction attend (son travail n est pas fini) et la connexion est
//       coupee ; le processus ne tombe pas, la transaction echoue, la connexion cassee quitte le pool ;
//   [B] EN PLEINE REQUETE : la connexion est coupee pendant qu une requete attend sa reponse ; la
//       requete echoue chez son appelant, le processus ne tombe pas, la connexion quitte le pool ;
//   [C] LE SERVEUR SERT ENCORE : apres les coupures, une transaction neuve passe sur une connexion
//       neuve ;
//   [D] LA TRACE : une ligne par coupure, avec le code seulement (jamais le mot de passe de l adresse) ;
//   [E] LE CLASSEMENT : l erreur de la coupure se lit comme une panne, en ligne comme au comptoir ;
//   [F] UNE CONNEXION ENDORMIE coupee ne se note qu une fois, par l ecouteur du pool.
// --contre-preuves : la garde retiree en memoire (le disque n est jamais touche) fait rougir ses lettres.
'use strict';
const net = require('net');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const DB = 'lib/database.js';
const CONTRE = process.argv.includes('--contre-preuves');
const SECRET = 'mot-de-passe-du-banc';
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let echecs = 0;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  return cond;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Mutations en memoire.
// ---------------------------------------------------------------------------
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};

// ---------------------------------------------------------------------------
// Le petit serveur : une session sans mot de passe, chaque requete simple rendue vide, et une coupure
// sur demande (RST, comme un reseau qui lache).
// ---------------------------------------------------------------------------
function message(type, corps) {
  const longueur = Buffer.alloc(4);
  longueur.writeInt32BE(corps.length + 4);
  return Buffer.concat([Buffer.from(type), longueur, corps]);
}
const PRET = message('Z', Buffer.from('I'));
const AUTH_OK = message('R', Buffer.from([0, 0, 0, 0]));
const fin = (etiquette) => message('C', Buffer.from(`${etiquette}\0`));

function lancerServeur() {
  const sockets = new Set();
  const etat = { couperA: null, requetes: [] };
  const couper = (socket) => { if (typeof socket.resetAndDestroy === 'function') socket.resetAndDestroy(); else socket.destroy(); };
  const serveur = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let tampon = Buffer.alloc(0);
    let demarre = false;
    socket.on('data', (morceau) => {
      tampon = Buffer.concat([tampon, morceau]);
      for (;;) {
        if (!demarre) {
          if (tampon.length < 8) return;
          const n = tampon.readInt32BE(0);
          if (tampon.length < n) return;
          const protocole = tampon.readInt32BE(4);
          tampon = tampon.subarray(n);
          if (protocole === 80877103) { socket.write('N'); continue; }
          demarre = true;
          socket.write(Buffer.concat([AUTH_OK, PRET]));
          continue;
        }
        if (tampon.length < 5) return;
        const type = String.fromCharCode(tampon[0]);
        const n = tampon.readInt32BE(1);
        if (tampon.length < n + 1) return;
        const corps = tampon.subarray(5, n + 1);
        tampon = tampon.subarray(n + 1);
        if (type === 'X') { socket.end(); return; }
        if (type !== 'Q') continue;
        const sql = corps.toString('utf8').replace(/\0$/, '').trim();
        etat.requetes.push(sql);
        if (etat.couperA && etat.couperA(sql)) { etat.couperA = null; couper(socket); return; }
        socket.write(Buffer.concat([fin(sql.split(/\s+/)[0].toUpperCase()), PRET]));
      }
    });
  });
  return new Promise((resolve) => serveur.listen(0, '127.0.0.1', () => resolve({
    port: serveur.address().port,
    etat,
    couperTout() { sockets.forEach(couper); },
    fermer() { sockets.forEach((s) => s.destroy()); return new Promise((r) => serveur.close(() => r())); },
  })));
}

// ---------------------------------------------------------------------------
// La vraie lib/database.js, chargee neuve (mutations comprises), sur ce serveur.
// ---------------------------------------------------------------------------
const plantages = [];
process.on('uncaughtException', (error) => { plantages.push(String((error && error.message) || error)); });

function charger(port, liste) {
  mutations = liste;
  for (const cle of Object.keys(require.cache)) {
    if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`) && cle !== __filename) delete require.cache[cle];
  }
  process.env.DATABASE_URL = `postgres://banc:${SECRET}@127.0.0.1:${port}/banc`;
  process.env.DATABASE_SSL = 'disable';
  process.env.DATABASE_POOL_MAX = '2';
  try {
    return { db: require(path.join(ROOT, DB)), publique: require(path.join(ROOT, 'lib/demande-publique.js')) };
  } finally { mutations = []; }
}

// Le classement du comptoir n est pas exporte : sa fonction est relue dans le fichier (mutations comprises).
function classementDuComptoir(liste) {
  let source = require('fs').readFileSync(path.join(ROOT, 'api/staff-reservations.js'), 'utf8').split(CRLF).join(LF);
  for (const { fichier, de, vers } of liste) {
    if (fichier !== 'api/staff-reservations.js') continue;
    if (source.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${fichier} : ${de.slice(0, 70)}`);
    source = source.split(de).join(vers);
  }
  const corps = /function estErreurInfra\(error\) \{([\s\S]*?)\n\}/.exec(source);
  // eslint-disable-next-line no-new-func
  return corps ? new Function('error', corps[1]) : () => false;
}

async function scenario(liste) {
  const serveur = await lancerServeur();
  const { db, publique } = charger(serveur.port, liste);
  const pool = db.getPool();
  const traces = [];
  const ecrireAvant = console.error;
  console.error = (...args) => { traces.push(args.map(String).join(' ')); };
  const f = { plantagesA: 0, plantagesB: 0 };
  try {
    // [A] La transaction attend entre deux requetes ; la connexion est coupee pendant ce temps.
    let depart = plantages.length;
    const a = await db.withTransaction(async (client) => {
      await client.query('select 1');
      serveur.couperTout();
      await pause(150);
      return 'fini';
    }).then((v) => `rendu ${v}`, (e) => `echec ${e && e.message}`);
    await pause(50);
    f.plantagesA = plantages.length - depart;
    f.a = a;
    f.poolA = pool.totalCount;
    // [B] La connexion est coupee pendant qu une requete attend sa reponse : l erreur de la requete
    // remonte telle quelle a l appelant de withTransaction (pas celle du ROLLBACK qui suit).
    depart = plantages.length;
    serveur.etat.couperA = (sql) => /pg_sleep/.test(sql);
    let erreurRequete = null;
    let erreurRendue = null;
    await db.withTransaction(async (client) => {
      await client.query('select pg_sleep(10)');
    }).catch((e) => { erreurRendue = e; });
    erreurRequete = erreurRendue;
    await pause(50);
    f.plantagesB = plantages.length - depart;
    f.b = erreurRendue ? String(erreurRendue.message) : 'rendu';
    f.poolB = pool.totalCount;
    // [E] Cette erreur dit « panne » aux deux portes (le client en ligne et le comptoir), jamais
    // « creneau change ».
    const comptoir = classementDuComptoir(liste);
    f.e = erreurRequete ? `${publique.estErreurInfra(erreurRequete)} / ${comptoir(erreurRequete)}` : 'aucune erreur';
    // [C] Une transaction neuve passe.
    f.c = await db.withTransaction(async (client) => { await client.query('select 1'); return 'ok'; }).then((v) => v, (e) => `echec ${e && e.message}`);
    // [F] Une connexion endormie dans le pool (rendue apres [C]) coupee : une seule ligne, celle du pool.
    depart = plantages.length;
    const avant = traces.length;
    serveur.couperTout();
    await pause(150);
    f.f = { plantages: plantages.length - depart, lignes: traces.slice(avant).filter((t) => /\[database:/.test(t)).map((t) => t.split(' ')[0]), pool: pool.totalCount };
  } finally {
    console.error = ecrireAvant;
    await pool.end().catch(() => {});
    await serveur.fermer();
  }
  f.traces = traces.filter((t) => t.includes('[database:client-error]'));
  f.fuite = traces.some((t) => t.includes(SECRET));
  return f;
}

function juger(f, dire) {
  dire(f.plantagesA === 0, '[A] entre deux requetes : la coupure ne fait pas tomber le processus', `${f.plantagesA} plantage(s) ${plantages.slice(-1)[0] || ''}`);
  dire(/^echec /.test(String(f.a)) && f.poolA === 0, '[A] la transaction echoue et la connexion cassee quitte le pool', `${f.a} / ${f.poolA} connexion(s)`);
  dire(f.plantagesB === 0, '[B] en pleine requete : la coupure ne fait pas tomber le processus', `${f.plantagesB} plantage(s) ${plantages.slice(-1)[0] || ''}`);
  dire(/ECONNRESET|Connection terminated/.test(String(f.b)) && f.poolB === 0, '[B] l appelant recoit l erreur de la coupure (pas celle du ROLLBACK) et la connexion quitte le pool', `${f.b} / ${f.poolB} connexion(s)`);
  dire(f.c === 'ok', '[C] apres les coupures, une transaction neuve passe', String(f.c));
  dire(f.traces.length >= 2 && f.traces.every((t) => /\[database:client-error\] \{"code":"[A-Z0-9]+"\}$/.test(t)) && !f.fuite, '[D] une ligne par coupure, le code seulement, jamais le mot de passe', JSON.stringify(f.traces));
  dire(f.e === 'true / true', '[E] la coupure se lit comme une panne en ligne comme au comptoir, jamais comme un creneau pris', String(f.e));
  dire(f.f && f.f.plantages === 0 && JSON.stringify(f.f.lignes) === '["[database:idle-error]"]' && f.f.pool === 0, '[F] une connexion endormie coupee : une seule ligne, celle du pool, et elle quitte le pool', JSON.stringify(f.f));
}

const CONTRE_PREUVES = [
  { nom: 'connexion-pretee-sourde', lettres: ['[A]', '[B]', '[D]'], fichier: DB, de: "    pool.on?.('connect', (client) => {\n", vers: "    pool.on?.('jamais-emis', (client) => {\n", libelle: 'une coupure pendant le pret ferait tomber le processus' },
  { nom: 'trace-bavarde', lettres: ['[D]'], fichier: DB, de: "        console.error('[database:client-error]', JSON.stringify({ code }));\n", vers: "        console.error('[database:client-error]', JSON.stringify({ code }), String(error && error.message), process.env.DATABASE_URL);\n", libelle: 'la trace porterait le message et l adresse de la base' },
  { nom: 'trace-en-double', lettres: ['[F]'], fichier: DB, de: '        if (!pretees.has(client)) return;\n', vers: '', libelle: 'une connexion endormie coupee se noterait deux fois' },
  { nom: 'erreur-du-rollback', lettres: ['[B]'], fichier: DB, de: "    try { await client.query('ROLLBACK'); } catch (perte) { connexionPerdue = perte; }\n", vers: "    await client.query('ROLLBACK');\n", libelle: 'l appelant recevrait l erreur du ROLLBACK au lieu de celle de la coupure' },
  { nom: 'coupure-creneau-pris-en-ligne', lettres: ['[E]'], fichier: 'lib/demande-publique.js', de: '|ECONNREFUSED|ECONNRESET|ETIMEDOUT|', vers: '|ECONNREFUSED|ETIMEDOUT|', libelle: 'le client en ligne lirait « ce creneau vient de changer »' },
  { nom: 'coupure-creneau-pris-au-comptoir', lettres: ['[E]'], fichier: 'api/staff-reservations.js', de: '|ECONNREFUSED|ECONNRESET|ETIMEDOUT|', vers: '|ECONNREFUSED|ETIMEDOUT|', libelle: 'le comptoir lirait le message technique comme un refus' },
];

(async () => {
  if (!CONTRE) {
    juger(await scenario([]), ok);
    console.log(echecs ? `\nconnexion-pretee-check: ${echecs} FAIL` : '\nconnexion-pretee-check: ALL OK - une coupure sur une connexion pretee fait echouer sa demande, jamais le processus');
    process.exit(echecs ? 1 : 0);
  }
  for (const c of CONTRE_PREUVES) {
    const rouges = new Set();
    let mesure = '';
    try {
      juger(await scenario([{ fichier: c.fichier, de: c.de, vers: c.vers }]), (cond, label) => { if (!cond) rouges.add(label.slice(0, 3)); });
      mesure = [...rouges].join(' ');
    } catch (error) {
      mesure = `exception : ${error.message}`;
    }
    ok(c.lettres.every((lettre) => rouges.has(lettre)), `contre-preuve « ${c.nom} » : ${c.lettres.join(', ')} ROUGISSENT (${c.libelle})`, mesure);
  }
  let propres = 0;
  juger(await scenario([]), (cond) => { if (!cond) propres += 1; });
  ok(propres === 0, 'aucune mutation ne survit : tout repasse au vert sur le code du disque');
  console.log(echecs ? `\nconnexion-pretee-check --contre-preuves: ${echecs} FAIL` : '\nconnexion-pretee-check --contre-preuves: ALL OK - chaque garde retiree fait rougir ses lettres');
  process.exit(echecs ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

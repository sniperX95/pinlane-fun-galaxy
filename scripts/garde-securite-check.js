// LA GARDE DE SECURITE SUR TELEGRAM (passe securite du 2026-11-08) : chaque nouveau message
// part au bon sujet, avec ou sans sonnerie comme il faut, sans donnee de client, et chaque
// regle a sa contre-preuve qui la casse en memoire et doit faire rougir ce gate.
//
//   [K] un « plantage » envoye par un seul navigateur arrive sans sonnerie ; le meme vu par
//       un deuxieme visiteur sonne ; et ces signalements publics ont leur propre compteur de
//       rafale : douze faux plantages ne font plus taire une vraie panne du serveur ;
//   [L] la garde du quart d heure relit les refus du journal : une tentative vers un autre
//       client sonne, des codes faux en serie, une personne entree apres des codes faux, une
//       rafale de gestes refuses et un code lu sans le droit arrivent sans sonnerie ; le
//       premier passage annonce sa mise en service et ne rejoue pas l historique ;
//   [M] le bilan securite du lundi a 8 h part dans Bilans, une fois par semaine, avec un
//       verdict ; une lecture ratee dit « je n ai pas pu le lire », jamais un zero ;
//   [N] un mail de client qui donne des ordres a l IA, ou qui cite le numero d un autre
//       client, se signale sans nom ni adresse ; un webhook des mails refuse se signale, et
//       sonne s il etait signe par le fournisseur (plus aucun mail ne rentre).
//
// Zero reseau (Telegram est un faux fetch), zero base (faux 'pg').
// Lancement : node scripts/garde-securite-check.js
'use strict';

for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|ANTHROPIC|OPENAI|KIMI|TELEGRAM|LLM_)/i.test(nom)) delete process.env[nom];
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-garde-securite-2026';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-GARDE-SECURITE';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const F = {
  alertes: path.join(ROOT, 'lib', 'garde-alertes.js'),
  securite: path.join(ROOT, 'lib', 'garde-securite.js'),
  meta: path.join(ROOT, 'api', 'public-booking-meta.js'),
};
const ENV = {
  TELEGRAM_JETON: 'gate-jeton',
  TELEGRAM_CHAT: '424242',
  TELEGRAM_GROUPE: '-100777777',
  TELEGRAM_SUJETS: 'pannes:2,reservations:3,modifications:4,bilans:5',
};
Object.assign(process.env, ENV);
const FILS = { 2: 'pannes', 3: 'reservations', 4: 'modifications', 5: 'bilans' };

let echecs = 0;
function ok(condition, message, detail) {
  if (condition) { console.log(`ok    ${message}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)}`}`);
  return false;
}

// Le faux Telegram : chaque message, son sujet et sa sonnerie.
let TELEGRAM = [];
const fauxTelegram = async (url, init) => {
  const corps = JSON.parse(String((init && init.body) || '{}'));
  TELEGRAM.push({ sujet: FILS[corps.message_thread_id] || 'conversation', sonne: !corps.disable_notification, texte: String(corps.text || '') });
  return { ok: true, status: 200 };
};
globalThis.fetch = fauxTelegram;

// Le faux 'pg' : lignes du journal d audit pour la garde, et ce que le formulaire ecrit.
let LIGNES = [];
let PANNE_DE_LECTURE = false;
class FakePool {
  async query(text, params = []) {
    const sql = String(text);
    if (PANNE_DE_LECTURE && /from\s+(audit_log|communications|ops_worker_runs)\b/i.test(sql)) throw new Error('base injoignable (banc)');
    if (/coalesce\(max\(id\), 0\)::bigint as dernier from audit_log/i.test(sql)) return { rows: [{ dernier: LIGNES.length ? Math.max(...LIGNES.map((l) => l.id)) : 0 }], rowCount: 1 };
    if (/from\s+audit_log\s+a\s+where\s+a\.id\s*>\s*\$1/i.test(sql)) {
      const rows = LIGNES.filter((l) => l.id > Number(params[0])).sort((a, b) => a.id - b.id);
      return { rows, rowCount: rows.length };
    }
    if (/group by 1;\s*$/i.test(sql) && /context->>'empreinte'/.test(sql) && /occurred_at >= \$1::timestamptz/.test(sql)) {
      const n = new Map();
      for (const l of LIGNES.filter((x) => x.action === 'login' && x.outcome === 'denied')) n.set(l.empreinte, (n.get(l.empreinte) || 0) + 1);
      return { rows: [...n].map(([empreinte, k]) => ({ empreinte, n: k })), rowCount: n.size };
    }
    if (/select count\(\*\)::int as recent\s+from client_errors/i.test(sql)) return { rows: [{ recent: 0 }], rowCount: 1 };
    if (/insert into client_errors/i.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
    // Le bilan du lundi : des chiffres connus, pour lire le texte.
    if (/a\.action = 'login' and a\.outcome = 'success'/i.test(sql)) return { rows: [{ center_id: 'libramont', role: 'Manager', n: 12 }, { center_id: 'gembloux', role: 'Direction', n: 3 }], rowCount: 2 };
    if (/a\.action = 'login' and a\.outcome = 'denied'/i.test(sql)) return { rows: [{ center_id: 'libramont', empreinte: 'x', n: 2 }, { center_id: 'gembloux', empreinte: 'y', n: 1 }], rowCount: 2 };
    if (/a\.outcome = 'denied' and a\.action <> 'login'/i.test(sql)) return { rows: [{ denied_reason: '403_permission', n: 4 }, { denied_reason: '401_no_session', n: 90 }, { denied_reason: '403_cross_client', n: 1 }], rowCount: 3 };
    if (/a\.surface = 'api\/staff-auth\.js'/i.test(sql)) return { rows: [{ action: 'regenerateRoleCode', n: 1 }, { action: 'createMember', n: 2 }, { action: 'login', n: 15 }], rowCount: 3 };
    if (/revealRoleCode', 'revealMemberCode'/i.test(sql)) return { rows: [{ qui: 'Ansar', n: 2 }], rowCount: 1 };
    if (/from communications c/i.test(sql)) return { rows: [{ consignes: 1, numeros: 0, recus: 7 }], rowCount: 1 };
    if (/from ops_worker_runs/i.test(sql)) return { rows: [{ task_name: 'sauvegarde', status: 'ok', n: 7, dernier: '2026-11-09T01:15:00.000Z' }, { task_name: 'garde', status: 'ok', n: 672, dernier: '2026-11-09T06:45:00.000Z' }], rowCount: 2 };
    return { rows: [], rowCount: 0 };
  }
  async connect() { const self = this; return { query: (t, p) => self.query(t, p), release() {} }; }
  async end() {}
}
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool, Client: FakePool } };

const lf = (t) => String(t).split('\r\n').join('\n');
function charger(mutations = []) {
  for (const cle of Object.keys(require.cache)) if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`)) delete require.cache[cle];
  delete globalThis.__pinlanePlantagesVus;
  delete globalThis.__pinlaneRateBuckets;
  const parFichier = new Map();
  for (const [fichier, avant, apres] of mutations) {
    if (!parFichier.has(fichier)) parFichier.set(fichier, []);
    parFichier.get(fichier).push([avant, apres]);
  }
  for (const [fichier, paires] of parFichier) {
    let source = lf(fs.readFileSync(fichier, 'utf8'));
    for (const [avant, apres] of paires) {
      if (!source.includes(avant)) throw new Error(`contre-preuve sans ancre dans ${path.relative(ROOT, fichier)} : ${avant.slice(0, 90)}`);
      source = source.replace(avant, () => apres);
    }
    const m = new Module(fichier, module);
    m.filename = fichier;
    m.paths = Module._nodeModulePaths(path.dirname(fichier));
    require.cache[fichier] = m;
    m._compile(source, fichier);
    m.loaded = true;
  }
  TELEGRAM = [];
}

async function signalerPlantage(ip, stack) {
  const handler = require(F.meta);
  const corps = JSON.stringify({ kind: 'erreur-formulaire', centerId: 'libramont', scene: 'date', message: 'x is not a function', source: 'https://www.mngfunglxy.com/assets/fungalaxy-booking.js', lineno: 10, colno: 2, stack });
  const req = { method: 'POST', url: '/api/public-booking-meta', headers: { host: 'www.mngfunglxy.com', 'content-type': 'application/json', 'x-real-ip': ip, origin: 'https://www.mngfunglxy.com' }, socket: { remoteAddress: ip } };
  req[Symbol.asyncIterator] = async function* lire() { yield Buffer.from(corps); };
  const res = { statusCode: 0, body: '', headers: {}, setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; }, getHeader(n) { return this.headers[String(n).toLowerCase()]; }, end(c) { this.body = String(c || ''); }, writeHead(s) { this.statusCode = s; } };
  await handler(req, res);
  return res;
}

const ANCRE = {
  urgentSiPlusieurs: '    const urgent = visiteurs >= 2;',
  rafaleSeparee: "  const rafale = rafales[origine === 'public' ? 'public' : 'serveur'];",
  autreClientSonne: "      urgent: true,\n      texte: `${pluriel(autreClient.length, 'tentative', 'tentatives')} d’ouvrir les données d’un centre d’un autre client",
  lundiSeulement: "  if (jourBelge(instant) !== semaine.lundi || heure < HEURE_BILAN || heure >= FIN_BILAN || dejaEnvoye === semaine.lundi) {",
  inconnuJamaisZero: "  if (s.codesFaux === null) lignes.push(`Codes faux : ${inconnu}.`);",
};

// Les lignes du journal d un quart d heure agite.
function ligne(id, x) {
  return { id, center_id: 'libramont', occurred_at: new Date(Date.parse('2026-11-08T10:00:00Z') + id * 1000).toISOString(), actor_kind: 'staff', actor_label: '', actor_member_id: '', actor_role_id: '', action: 'accessDenied', outcome: 'denied', denied_reason: '', entity_id: '', empreinte: '', centre_demande: '', droit: '', ...x };
}
function quartDHeureAgite() {
  const l = [];
  let id = 100;
  l.push(ligne(++id, { actor_label: 'Direction MI-12', center_id: 'mi-12', actor_member_id: 'mi-12:dir', denied_reason: '403_cross_client', centre_demande: 'libramont' }));
  for (let i = 0; i < 6; i += 1) l.push(ligne(++id, { actor_kind: 'public', actor_label: 'connexion refusee', action: 'login', denied_reason: '401_bad_code', empreinte: '198.51.100.7' }));
  l.push(ligne(++id, { actor_label: 'Marius', action: 'login', outcome: 'success', actor_member_id: 'libramont:marius', empreinte: '198.51.100.7' }));
  for (let i = 0; i < 5; i += 1) l.push(ligne(++id, { actor_label: 'Flavy', actor_member_id: 'libramont:flavy', denied_reason: '403_permission', entity_id: 'payments.view' }));
  l.push(ligne(++id, { actor_label: 'Chef', actor_member_id: 'libramont:chef', action: 'revealMemberCode', denied_reason: '', droit: 'security.codes' }));
  return l;
}

(async () => {
  // =========================================================================
  console.log('[K] les plantages signales par un navigateur');
  // =========================================================================
  charger();
  {
    await signalerPlantage('192.0.2.10', 'TypeError: x\n at a (fungalaxy-booking.js:10:2)');
    ok(TELEGRAM.length === 1 && TELEGRAM[0].sujet === 'pannes' && !TELEGRAM[0].sonne && /^À regarder/.test(TELEGRAM[0].texte), '[K] un seul visiteur : le message part dans Pannes, sans sonnerie', TELEGRAM);
    await signalerPlantage('192.0.2.10', 'TypeError: x\n at a (fungalaxy-booking.js:10:2)');
    ok(TELEGRAM.length === 1, '[K] le meme visiteur qui le renvoie ne fait pas un deuxieme message', TELEGRAM.length);
    await signalerPlantage('192.0.2.11', 'TypeError: x\n at a (fungalaxy-booking.js:10:2)');
    ok(TELEGRAM.length === 2 && TELEGRAM[1].sonne && /^URGENT/.test(TELEGRAM[1].texte) && /2 clients différents/.test(TELEGRAM[1].texte), '[K] un deuxieme visiteur voit le meme plantage : ca sonne', TELEGRAM);
    ok(TELEGRAM.every((m) => !/192\.0\.2|x is not a function|fungalaxy-booking\.js:10/.test(m.texte)), '[K] rien de ce que le navigateur envoie n est recopie, ni son adresse');
  }
  charger();
  {
    const { alerter } = require(F.alertes);
    for (let i = 0; i < 13; i += 1) await alerter(`public:faux:${i}`, `À regarder, Pinlane\nfaux plantage ${i}`, { origine: 'public', silencieux: true });
    const avant = TELEGRAM.length;
    await alerter('serveur:vraie-panne', 'URGENT Pinlane\nPanne du serveur, api/public-reservations.');
    ok(TELEGRAM.length === avant + 1 && /Panne du serveur/.test(TELEGRAM[TELEGRAM.length - 1].texte), '[K] treize faux plantages publics ne font pas taire une vraie panne du serveur', TELEGRAM.slice(-2));
    ok(TELEGRAM.some((m) => /beaucoup d’erreurs signalées d’un coup par des navigateurs/.test(m.texte) && !m.sonne), '[K] la rafale publique se dit une fois, sans sonnerie');
  }
  charger([[F.meta, ANCRE.urgentSiPlusieurs, '    const urgent = true;']]);
  {
    await signalerPlantage('192.0.2.20', 'TypeError: y\n at b (fungalaxy-booking.js:20:1)');
    ok(TELEGRAM.length === 1 && TELEGRAM[0].sonne, '[K] contre-preuve : sans la regle des deux visiteurs, un seul navigateur fait sonner (ce gate le verrait)', TELEGRAM);
  }
  charger([[F.alertes, ANCRE.rafaleSeparee, '  const rafale = rafales.serveur;']]);
  {
    const { alerter } = require(F.alertes);
    for (let i = 0; i < 13; i += 1) await alerter(`public:faux:${i}`, `À regarder, Pinlane\nfaux plantage ${i}`, { origine: 'public', silencieux: true });
    const avant = TELEGRAM.length;
    await alerter('serveur:vraie-panne', 'URGENT Pinlane\nPanne du serveur, api/public-reservations.');
    ok(TELEGRAM.length === avant, '[K] contre-preuve : un seul compteur de rafale, et la vraie panne se tait (ce gate le verrait)', TELEGRAM.length - avant);
  }

  // =========================================================================
  console.log('\n[L] la garde du quart d heure relit les refus');
  // =========================================================================
  charger();
  {
    const g = require(F.securite);
    LIGNES = quartDHeureAgite();
    const neuf = await g.relireLesRefus(new FakePool(), null, { env: process.env, fetcher: fauxTelegram, maintenant: Date.parse('2026-11-08T10:05:00Z') });
    ok(neuf.curseur === Math.max(...LIGNES.map((l) => l.id)) && TELEGRAM.length === 0, '[L] premier passage d un groupe neuf : l historique ne se rejoue pas, la presentation des sujets la porte', { curseur: neuf.curseur, TELEGRAM });
    const premier = await g.relireLesRefus(new FakePool(), null, { env: process.env, fetcher: fauxTelegram, maintenant: Date.parse('2026-11-08T10:05:00Z'), annoncer: true });
    ok(premier.curseur === Math.max(...LIGNES.map((l) => l.id)) && TELEGRAM.length === 1 && TELEGRAM[0].sujet === 'bilans' && /Mise en service de la garde de sécurité/.test(TELEGRAM[0].texte), '[L] premier passage sur un groupe deja en service : la mise en service part dans Bilans, l historique ne se rejoue pas', { curseur: premier.curseur, TELEGRAM });
    TELEGRAM = [];
    const nonPartie = await g.relireLesRefus(new FakePool(), null, { env: process.env, fetcher: async () => ({ ok: false, status: 502 }), maintenant: Date.parse('2026-11-08T10:05:00Z'), annoncer: true });
    ok(nonPartie.curseur === null, '[L] une mise en service non partie se redira au passage suivant', nonPartie);
    const r = await g.relireLesRefus(new FakePool(), 100, { env: process.env, fetcher: fauxTelegram, maintenant: Date.parse('2026-11-08T10:05:00Z') });
    const urgent = TELEGRAM.find((m) => /^URGENT/.test(m.texte));
    const calme = TELEGRAM.find((m) => /^À regarder/.test(m.texte));
    ok(urgent && urgent.sonne && urgent.sujet === 'pannes' && /autre client/.test(urgent.texte), '[L] une tentative vers un autre client : URGENT, dans Pannes, ca sonne', TELEGRAM);
    ok(calme && !calme.sonne && calme.sujet === 'pannes', '[L] le reste arrive dans Pannes, sans sonnerie', TELEGRAM);
    ok(calme && /6 codes faux/.test(calme.texte) && /1 appareil/.test(calme.texte), '[L] les codes faux en serie se comptent, par appareil', calme && calme.texte);
    ok(calme && /Marius est entré à Libramont après 6 codes faux/.test(calme.texte), '[L] une personne entree apres des codes faux se nomme', calme && calme.texte);
    ok(calme && /Flavy \(Libramont\) : 5 gestes refusés faute de droit/.test(calme.texte), '[L] une rafale de gestes refuses a la meme personne se dit', calme && calme.texte);
    ok(calme && /a voulu afficher ou changer un code d’accès sans en avoir le droit/.test(calme.texte), '[L] un code lu sans le droit se dit', calme && calme.texte);
    ok(TELEGRAM.every((m) => !/198\.51\.100|@|\+32/.test(m.texte)), '[L] ni adresse IP, ni mail, ni telephone dans les messages');
    ok(r.curseur === Math.max(...LIGNES.map((l) => l.id)), '[L] le curseur avance quand tout est parti', r.curseur);
    const enPanne = async () => ({ ok: false, status: 502 });
    const rate = await g.relireLesRefus(new FakePool(), 100, { env: process.env, fetcher: enPanne, maintenant: Date.parse('2026-11-08T10:05:00Z') });
    ok(rate.curseur === 100, '[L] un message non parti garde le curseur : il sera redit', rate.curseur);
    TELEGRAM = [];
    let appels = 0;
    const premierEnPanne = async (url, init) => { appels += 1; return appels === 1 ? { ok: false, status: 502 } : fauxTelegram(url, init); };
    const raté = await g.relireLesRefus(new FakePool(), 100, { env: process.env, fetcher: premierEnPanne, maintenant: Date.parse('2026-11-08T10:05:00Z') });
    ok(raté.curseur === 100 && TELEGRAM.length === 0, '[L] le premier message rate : on s arrete, l urgent ne partira pas deux fois', { curseur: raté.curseur, TELEGRAM: TELEGRAM.map((m) => m.texte.slice(0, 30)) });
  }
  charger([[F.securite, ANCRE.autreClientSonne, ANCRE.autreClientSonne.replace('urgent: true', 'urgent: false')]]);
  {
    const g = require(F.securite);
    LIGNES = quartDHeureAgite();
    await g.relireLesRefus(new FakePool(), 100, { env: process.env, fetcher: fauxTelegram, maintenant: Date.parse('2026-11-08T10:05:00Z') });
    ok(!TELEGRAM.some((m) => /^URGENT/.test(m.texte) && m.sonne), '[L] contre-preuve : une tentative vers un autre client qui ne sonne plus (ce gate le verrait)', TELEGRAM.map((m) => m.texte.slice(0, 40)));
  }

  // =========================================================================
  console.log('\n[M] le bilan securite du lundi');
  // =========================================================================
  charger();
  {
    const g = require(F.securite);
    const lundi8h15 = new Date('2026-11-09T07:15:00Z'); // 8 h 15 a Bruxelles
    const r = await g.bilanSecuriteSiLundi(new FakePool(), '', { instant: lundi8h15, env: process.env, fetcher: fauxTelegram });
    const b = TELEGRAM[0];
    ok(r.envoye && r.semaine === '2026-11-09' && b && b.sujet === 'bilans', '[M] lundi 8 h 15 : le bilan part dans Bilans', { r, TELEGRAM });
    ok(b && /Bilan sécurité de la semaine, du lundi 2 novembre au dimanche 8 novembre/.test(b.texte), '[M] il nomme la semaine finie', b && b.texte.split('\n')[0]);
    ok(b && /Verdict : à regarder, 1 tentative vers un autre client ; 1 mail piégé/.test(b.texte), '[M] il donne un verdict, analyse', b && b.texte.split('\n')[1]);
    ok(b && /Connexions réussies : 15 \(Libramont 12, Gembloux 3\)/.test(b.texte) && /Codes faux : 3, depuis 2 appareils/.test(b.texte) && /Sauvegardes de la nuit : 7 sur 7/.test(b.texte), '[M] chaque chiffre vient de la base', b && b.texte);
    ok(b && /2 personne ajoutée|personne ajoutée/.test(b.texte) && /Codes d’accès affichés : Ansar 2/.test(b.texte), '[M] les acces changes et les codes affiches se comptent', b && b.texte);
    TELEGRAM = [];
    const encore = await g.bilanSecuriteSiLundi(new FakePool(), '2026-11-09', { instant: new Date('2026-11-09T07:30:00Z'), env: process.env, fetcher: fauxTelegram });
    ok(!encore.envoye && TELEGRAM.length === 0, '[M] une fois par semaine : le passage suivant ne le redit pas');
    const mardi = await g.bilanSecuriteSiLundi(new FakePool(), '', { instant: new Date('2026-11-10T07:15:00Z'), env: process.env, fetcher: fauxTelegram });
    ok(!mardi.envoye && TELEGRAM.length === 0, '[M] un mardi : rien');
    PANNE_DE_LECTURE = true;
    TELEGRAM = [];
    await g.bilanSecuriteSiLundi(new FakePool(), '', { instant: lundi8h15, env: process.env, fetcher: fauxTelegram });
    PANNE_DE_LECTURE = false;
    const p = TELEGRAM[0] ? TELEGRAM[0].texte : '';
    ok(/Codes faux : je n’ai pas pu le lire/.test(p) && !/Codes faux : aucun/.test(p), '[M] une lecture ratee se dit, elle ne devient pas un zero', p);
  }
  charger([[F.securite, ANCRE.lundiSeulement, '  if (dejaEnvoye === semaine.lundi) {']]);
  {
    const g = require(F.securite);
    const mardi = await g.bilanSecuriteSiLundi(new FakePool(), '', { instant: new Date('2026-11-10T07:15:00Z'), env: process.env, fetcher: fauxTelegram });
    ok(mardi.envoye, '[M] contre-preuve : sans la regle du lundi, le bilan part un mardi (ce gate le verrait)', mardi);
  }
  charger([[F.securite, ANCRE.inconnuJamaisZero, "  if (s.codesFaux === null) lignes.push('Codes faux : aucun.');"]]);
  {
    const g = require(F.securite);
    PANNE_DE_LECTURE = true;
    await g.bilanSecuriteSiLundi(new FakePool(), '', { instant: new Date('2026-11-09T07:15:00Z'), env: process.env, fetcher: fauxTelegram });
    PANNE_DE_LECTURE = false;
    ok(/Codes faux : aucun/.test(TELEGRAM[0] ? TELEGRAM[0].texte : ''), '[M] contre-preuve : une lecture ratee dite « aucun » (ce gate le verrait)');
  }

  // =========================================================================
  console.log('\n[N] les mails pieges et l entree des mails');
  // =========================================================================
  charger();
  {
    const g = require(F.securite);
    await g.signalerMailSuspect({ centerId: 'libramont', securite: { consigneCachee: true, numeroAutreClient: false }, env: process.env, fetcher: fauxTelegram });
    const m = TELEGRAM[0];
    ok(m && m.sujet === 'pannes' && !m.sonne && /consignes adressées à l’IA/.test(m.texte) && /Libramont/.test(m.texte), '[N] un mail qui donne des ordres a l IA : Pannes, sans sonnerie', TELEGRAM);
    await g.signalerMailSuspect({ centerId: 'libramont', securite: { consigneCachee: true, numeroAutreClient: false }, env: process.env, fetcher: fauxTelegram });
    ok(TELEGRAM.length === 1, '[N] une vague de mails pieges ne fait pas une vague de messages', TELEGRAM.length);
    await g.signalerMailSuspect({ centerId: 'gembloux', securite: { consigneCachee: false, numeroAutreClient: true }, env: process.env, fetcher: fauxTelegram });
    ok(TELEGRAM.length === 2 && /numéro de réservation d’un autre client/.test(TELEGRAM[1].texte), '[N] le numero d un autre client se signale aussi', TELEGRAM.map((x) => x.texte.slice(0, 60)));
    TELEGRAM = [];
    await g.signalerWebhookRefuse({ signeParLeFournisseur: true, env: process.env, fetcher: fauxTelegram });
    ok(TELEGRAM[0] && !TELEGRAM[0].sonne && /signé comme venant de Resend/.test(TELEGRAM[0].texte), '[N] webhook signe mais refuse : le message part sans sonnerie (son en-tete se fabrique)', TELEGRAM);
    await g.signalerWebhookRefuse({ signeParLeFournisseur: false, env: process.env, fetcher: fauxTelegram });
    ok(TELEGRAM[1] && !TELEGRAM[1].sonne && /sans signature valide/.test(TELEGRAM[1].texte), '[N] envoi sans signature : sans sonnerie', TELEGRAM);
    await g.signalerWebhookRefuse({ signeParLeFournisseur: false, env: process.env, fetcher: fauxTelegram });
    ok(TELEGRAM.length === 2, '[N] une fois par heure au plus', TELEGRAM.length);
  }
  {
    const source = lf(fs.readFileSync(path.join(ROOT, 'lib', 'email-agent.js'), 'utf8'));
    ok(/securiteDuMail\(demande, numeroNonLie\)/.test(source) && /signalerMailSuspect\(\{ centerId, securite: analysis\.securite/.test(source), '[N] l arrivee d un mail appelle bien la garde (lib/email-agent.js)');
    const webhook = lf(fs.readFileSync(path.join(ROOT, 'api', 'inbound-email.js'), 'utf8'));
    ok(/signalerWebhookRefuse\(\{ signeParLeFournisseur \}\)/.test(webhook) && /crypto\.timingSafeEqual\(a, b\)/.test(webhook), '[N] le webhook refuse se signale, et son secret se compare en temps constant');
  }

  console.log(echecs ? `\ngarde-securite-check: ${echecs} FAIL` : '\ngarde-securite-check: ALL OK');
  process.exit(echecs ? 1 : 0);
})().catch((error) => {
  console.error('garde-securite-check CRASH:', error && error.stack ? error.stack : error);
  process.exit(1);
});

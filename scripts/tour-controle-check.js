'use strict';
// LA TOUR DE CONTROLE ET LA GARDE (Ansar, 2026-11-05 : « agents qui [...] font la garde partout absolument et me
// signale direct si ya des problemes, un endroit ou jpeux voir toutes les reservations [...] dont moi seul aura acces »).
//
//   [S] les requetes ne citent que des colonnes qui existent dans database/*.sql (pas de vrai Postgres ici) ;
//   [P] ce qui ne va pas se lit : mail perdu, garde arretee, centre sans adresse de secours, reservations d essai ;
//   [G] la garde dit quand ca change, une seule fois ; un message non parti se redit ; aucune donnee personnelle ;
//   [C] un client qui rate sa reservation : trace au journal, message tout de suite, sans nom ni telephone ;
//   [F] le vrai formulaire remonte ses plantages, et pas ceux d une extension ni d un reseau coupe ;
//   [U] la vraie console : les deux centres, les filtres, la recherche, le dossier, le rafraichissement qui ne casse
//       rien, et le menu qui ne s ouvre qu au proprietaire ;
//   [X] les contre-preuves : le code d avant, compile ou servi en memoire. Le disque n est jamais ecrit.
//
// Le refus cote serveur (403 pour une Direction) vit dans scripts/founder-cockpit-check.js, avec les autres actions.
// Lancement : node scripts/tour-controle-check.js   (TOUR_PHOTOS=<dossier> garde les images)
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|TELEGRAM|PINLANE_SECOURS)/i.test(nom)) delete process.env[nom];
process.env.DATABASE_URL = 'postgres://banc/banc';
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_TOUR_PORT || 5295);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PHOTOS = process.env.TOUR_PHOTOS || '';
const LF = '\n';

let echecs = 0;
let total = 0;
function ok(condition, message, detail) {
  total += 1;
  if (condition) { console.log(`ok    ${message}`); return; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600)}`}`);
}

// ---------------------------------------------------------------------------
// [S] Le schema, lu dans database/*.sql : chaque requete de la Tour y est confrontee.
// ---------------------------------------------------------------------------
function lireSchema() {
  const tables = {};
  const ajouter = (t, c) => { (tables[t] = tables[t] || new Set()).add(c); };
  const dossier = path.join(ROOT, 'database');
  for (const f of fs.readdirSync(dossier).filter((x) => x.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dossier, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/create table if not exists\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      for (const ligne of m[2].split('\n')) {
        const c = ligne.trim().match(/^([a-z_][a-z0-9_]*)\s+[a-z]/i);
        if (c && !/^(primary|foreign|unique|check|constraint)$/i.test(c[1])) ajouter(m[1], c[1]);
      }
    }
    for (const m of sql.matchAll(/alter table\s+(?:if exists\s+)?(\w+)[^;]*?add column if not exists\s+(\w+)/gi)) ajouter(m[1], m[2]);
    for (const m of sql.matchAll(/alter table\s+(?:if exists\s+)?(\w+)\s+([^;]*);/gi)) for (const a of m[2].matchAll(/add column if not exists\s+(\w+)/gi)) ajouter(m[1], a[1]);
  }
  return tables;
}
const SCHEMA = lireSchema();
const MOTS_SQL = new Set('offset select distinct on from where and or not in is null as group by order desc asc limit count max min sum coalesce filter over int integer text date bigint any interval now at time zone like exists insert into values update set begin rollback commit array_agg lower true false minutes hours days hour minute day hours hours2 nullif cast'.split(' '));
const fautes = new Set();
function verifierColonnes(sql) {
  const propre = sql.replace(/'[^']*'/g, ' ').replace(/\$\d+/g, ' ').replace(/::\s*\w+(\[\])?/g, ' ');
  const lesTables = [...propre.matchAll(/\b(?:from|join|into|update)\s+([a-z_]+)/gi)].map((m) => m[1]).filter((t) => SCHEMA[t]);
  if (!lesTables.length) return;
  const alias = new Set([...propre.matchAll(/\bas\s+([a-z_]+)/gi)].map((m) => m[1]));
  for (const m of propre.matchAll(/\b(?:from|join)\s+[a-z_]+\s+([a-z])\b/gi)) alias.add(m[1]);
  for (const t of propre.matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)) {
    const mot = t[1];
    if (MOTS_SQL.has(mot.toLowerCase()) || alias.has(mot) || SCHEMA[mot] || /^\d/.test(mot)) continue;
    if (!lesTables.some((table) => SCHEMA[table].has(mot))) fautes.add(`${mot} (${lesTables.join(', ')})`);
  }
}

// ---------------------------------------------------------------------------
// La base en memoire, derriere le vrai module pg de lib/database.js.
// ---------------------------------------------------------------------------
const ilYA = (minutes) => new Date(Date.now() - minutes * 60000);
const JOUR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
const DEMAIN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(Date.now() + 86400000));
const BD = {};
function remettre() {
  BD.centres = [
    { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', settings: { config: { secours: { emails: ['secours@fungalaxy.be'] } }, secoursEtat: { [JOUR]: { envoyeA: ilYA(20).toISOString() } } } },
    { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', settings: { config: {} } },
  ];
  const sain = (task_name, minutes = 10) => ({ task_name, status: 'ok', started_at: ilYA(minutes), finished_at: ilYA(minutes), error: null, result: {} });
  BD.runs = [sain('garde'), sain('sonde'), sain('secours'), sain('dispatch-communications', 100), sain('ops-jobs', 600), sain('sauvegarde', 600), sain('agent-orchestrator', 9000)];
  BD.mails = [
    { id: 1, center_id: 'gembloux', reservation_id: 101, template_id: 'confirmation', channel: 'email', direction: 'outbound', recipient: 'emma.dubois@example.be', subject: 'Votre réservation', status: 'failed', attempts: 3, last_error: 'Adresse refusée par le serveur', scheduled_at: ilYA(90), sent_at: null, created_at: ilYA(90) },
    { id: 2, center_id: 'libramont', reservation_id: 102, template_id: 'confirmation', channel: 'email', direction: 'outbound', recipient: 'marc@example.be', subject: 'Votre réservation', status: 'queued', attempts: 0, last_error: null, scheduled_at: ilYA(60), sent_at: null, created_at: ilYA(60) },
    { id: 3, center_id: 'libramont', reservation_id: 103, template_id: 'confirmation', channel: 'email', direction: 'outbound', recipient: 'lea@example.be', subject: 'Votre réservation', status: 'sent', attempts: 1, last_error: null, scheduled_at: ilYA(70), sent_at: ilYA(70), created_at: ilYA(70) },
  ];
  BD.evenements = [{ communication_id: 3, center_id: 'libramont', event_type: 'bounced', occurred_at: ilYA(30) }];
  BD.erreurs = [];
  BD.journal = [];
  const dossier = (id, c) => ({ id, name: 'Client', phone: '0470000000', email: 'client@example.be', date: DEMAIN, start_time: '15:00', duration: 1, total_duration: 1, lanes: [1], pax: 4, status: 'pending', base_price: 78, price: 78, type: 'bowling', label: 'Bowling', channel: 'public', center_id: 'libramont', validation_status: 'confirmed', created_at: ilYA(id), updated_at: ilYA(id), ...c });
  BD.resas = [
    dossier(101, { center_id: 'gembloux', name: 'Emma Dubois', phone: '+33 6 12 34 56 78', email: 'emma.dubois@example.be', pax: 8, price: 208, label: 'Laser Game', type: 'visite', program: { items: [{ activityId: 'laser_game', name: 'Laser Game', participants: 8, minutes: 20, price: 144 }] }, ops_plan: { timeline: [{ startTime: '15:00', endTime: '15:20', activityName: 'Laser Game' }], validation: { niveau: 'normal', raison: 'Groupe de plus de 6' } }, created_at: ilYA(5) }),
    dossier(102, { name: 'Marc Lambert', channel: 'staff', created_at: ilYA(60), validation_status: 'staff_review' }),
    dossier(103, { name: 'Léa Simon', status: 'cancelled', created_at: ilYA(70), date: JOUR }),
    dossier(104, { center_id: 'gembloux', name: 'Essai Démo', email: 'x@demo.fungalaxy.test', created_at: ilYA(80) }),
    dossier(105, { name: 'Simulation', channel: 'sim-client', created_at: ilYA(85) }),
    dossier(106, { center_id: 'gembloux', name: 'Ancien Client', created_at: ilYA(60 * 24 * 12) }),
  ];
  BD.membres = [{ id: 'libramont:platform-owner', center_id: 'libramont', name: 'Ansar', role_id: 'platform-owner', status: 'active', last_seen: ilYA(3) }];
}
remettre();
const groupe = (lignes, cle) => { const m = new Map(); for (const l of lignes) { const k = cle(l); m.set(k, [...(m.get(k) || []), l]); } return [...m.values()]; };
const dernier = (l, c) => l.reduce((a, x) => (x[c] > a ? x[c] : a), l[0][c]);
const jourDe = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(d));
const enLigneReelle = (r) => !/^sim-/.test(r.channel || '');
function repondre(sql, p = []) {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (BD.verifier) verifierColonnes(sql);
  const rows = (lignes) => ({ rows: lignes, rowCount: lignes.length });
  if (/^(begin|rollback|commit)/i.test(s)) return rows([]);
  if (BD.panneEcriture && /^insert/i.test(s)) throw Object.assign(new Error('cannot execute INSERT in a read-only transaction'), { code: '25006' });
  if (/from centers/.test(s)) return rows(BD.centres);
  if (/^insert into ops_worker_runs/.test(s)) { BD.runs.unshift({ task_name: /'sonde', 'sonde'/.test(s) ? 'sonde' : 'essai', status: 'ok', started_at: new Date(), finished_at: new Date(), result: {} }); return rows([{ id: 1 }]); }
  if (/distinct on \(task_name\)/.test(s)) return rows(groupe(BD.runs.filter((r) => p[0].includes(r.task_name)), (r) => r.task_name).map((l) => [...l].sort((a, b) => b.started_at - a.started_at)[0]));
  if (/max\(finished_at\) as dernier_ok/.test(s)) return rows(groupe(BD.runs.filter((r) => p[0].includes(r.task_name) && r.status === 'ok'), (r) => r.task_name).map((l) => ({ task_name: l[0].task_name, dernier_ok: dernier(l, 'finished_at') })));
  if (/select result from ops_worker_runs/.test(s)) return rows(BD.runs.filter((r) => r.task_name === 'garde' && r.status === 'ok').slice(0, 1));
  if (/max\(finished_at\) as le/.test(s)) return rows([{ le: new Date() }]);
  if (/from communications c/.test(s)) return rows(BD.mails.filter((m) => m.reservation_id === p[0]).map((m) => ({ ...m, evenements: BD.evenements.filter((e) => e.communication_id === m.id).map((e) => e.event_type) })));
  if (/reservation_id = any/.test(s)) return rows(groupe(BD.mails.filter((m) => p[0].includes(m.reservation_id)), (m) => `${m.reservation_id}:${m.status}`).map((l) => ({ reservation_id: l[0].reservation_id, status: l[0].status, n: l.length })));
  if (/status = 'failed' and channel = 'email'/.test(s)) return rows(groupe(BD.mails.filter((m) => m.status === 'failed' && !(/not like 'Adresse en erreur%'/.test(s) && /^Adresse en erreur/.test(m.last_error || ''))), (m) => m.center_id).map((l) => ({ center_id: l[0].center_id, n: l.length, dernier: dernier(l, 'created_at') })));
  if (/status = 'queued'/.test(s)) return rows(groupe(BD.mails.filter((m) => m.status === 'queued'), (m) => m.center_id).map((l) => ({ center_id: l[0].center_id, n: l.length, depuis: l[0].created_at })));
  if (/from email_events/.test(s)) return rows(groupe(BD.evenements.filter((e) => /bounced|complained/.test(e.event_type)), (e) => `${e.center_id}:${e.event_type}`).map((l) => ({ center_id: l[0].center_id, event_type: l[0].event_type, n: l.length })));
  if (/count\(\*\)::int as recent from client_errors/.test(s)) return rows([{ recent: BD.erreurs.filter((e) => e.member_id === p[0]).length }]);
  if (/^insert into client_errors/.test(s)) { BD.erreurs.push({ center_id: p[0], page: p[1], message: p[2], source: p[3], stack_hash: p[6], member_id: p[8], occurred_at: new Date() }); return rows([{ id: BD.erreurs.length }]); }
  if (/from client_errors/.test(s)) return rows(groupe(BD.erreurs, (e) => `${e.center_id}:${e.stack_hash}`).map((l) => ({ center_id: l[0].center_id, stack_hash: l[0].stack_hash, message: l[0].message, page: l[0].page, n: l.length, personnes: 1, dernier: dernier(l, 'occurred_at'), chez_le_client: l[0].member_id.startsWith('public:') })));
  if (/^insert into audit_log/i.test(s)) {
    const colonnes = s.match(/\(([^)]+)\) values/i)[1].split(',').map((c) => c.trim());
    BD.journal.push({ ...Object.fromEntries(colonnes.map((c, i) => [c, p[i]])), occurred_at: new Date() });
    return rows([{ id: BD.journal.length }]);
  }
  if (/entity_type = 'formulaire'/.test(s)) return rows(groupe(BD.journal.filter((j) => j.entity_type === 'formulaire'), (j) => `${j.center_id}:${j.action}:${j.denied_reason}`).map((l) => ({ center_id: l[0].center_id, action: l[0].action, raison: l[0].denied_reason || '', n: l.length, dernier: dernier(l, 'occurred_at') })));
  if (/from audit_log/.test(s)) return rows([]);
  if (/from staff_members/.test(s)) return rows(BD.membres);
  if (/count\(\*\) filter/.test(s)) {
    return rows(groupe(BD.resas.filter(enLigneReelle), (r) => r.center_id).map((l) => ({
      center_id: l[0].center_id,
      recues: l.filter((r) => jourDe(r.created_at) === p[0]).length,
      en_ligne: l.filter((r) => jourDe(r.created_at) === p[0] && r.channel === 'public').length,
      visites: l.filter((r) => r.date === p[0] && r.status !== 'cancelled').length,
      joueurs: l.filter((r) => r.date === p[0] && r.status !== 'cancelled').reduce((t, r) => t + r.pax, 0),
      a_valider: l.filter((r) => r.validation_status === 'staff_review' && r.status === 'pending').length,
    })));
  }
  if (/lower\(coalesce\(email/.test(s)) return rows(groupe(BD.resas.filter((r) => (!enLigneReelle(r) || /@demo\.fungalaxy\.test$/.test(r.email)) && r.status !== 'cancelled'), (r) => r.center_id).map((l) => ({ center_id: l[0].center_id, n: l.length, premier: l[0].date })));
  if (/^select \* from reservations where id = /.test(s)) return rows(BD.resas.filter((r) => r.id === p[0]));
  if (/over \(\)::int as total_filtre/.test(s) || /total_filtre/.test(s)) {
    // Les filtres se relisent dans la requete, parametre par parametre : un filtre mal cable se voit.
    const val = (motif) => { const m = s.match(motif); return m ? p[Number(m[1]) - 1] : undefined; };
    const centre = val(/center_id = \$(\d+)/);
    const canal = val(/channel = \$(\d+)/);
    const statut = val(/ status = \$(\d+)/);
    const visite = val(/ date = \$(\d+)::date/);
    const depuis = val(/time zone '[^']*'\)::date >= \$(\d+)::date/);
    const aVenir = val(/ date >= \$(\d+)::date/);
    const lignes = BD.resas.filter(enLigneReelle)
      .filter((r) => !centre || r.center_id === centre).filter((r) => !canal || r.channel === canal).filter((r) => !statut || r.status === statut)
      .filter((r) => !visite || r.date === visite).filter((r) => !depuis || jourDe(r.created_at) >= depuis).filter((r) => !aVenir || r.date >= aVenir)
      .sort((a, b) => b.created_at - a.created_at);
    return rows(lignes.map((l) => ({ ...l, total_filtre: lignes.length })));
  }
  throw new Error(`SQL non simulee : ${s.slice(0, 160)}`);
}
class FauxPool {
  constructor() { this.options = { max: 5 }; this.waitingCount = 0; this.idleCount = 1; this.totalCount = 1; }
  async query(sql, p) { return repondre(typeof sql === 'string' ? sql : sql.text, p); }
  async connect() { return { query: async (sql, p) => repondre(sql, p), release() {} }; }
  on() {}
  async end() {}
}
const cheminPg = require.resolve('pg');
require.cache[cheminPg] = { id: cheminPg, filename: cheminPg, loaded: true, exports: { Pool: FauxPool } };

// Le monde exterieur de Node : Telegram et Resend notes, le reste passe.
const TELEGRAM = [];
const RESEND = [];
let telegramCoupe = false;
const fetchReel = global.fetch;
global.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.includes('api.telegram.org') || u.includes('telegram.banc')) {
    if (telegramCoupe) throw Object.assign(new Error('coupe'), { name: 'TimeoutError' });
    TELEGRAM.push(JSON.parse(options.body).text);
    return new Response('{"ok":true}', { status: 200 });
  }
  if (u.includes('api.resend.com')) { RESEND.push(JSON.parse(options.body)); return new Response('{"id":"banc"}', { status: 200 }); }
  return fetchReel(url, options);
};
process.env.TELEGRAM_JETON = 'banc';
process.env.TELEGRAM_CHAT = '42';
process.env.RESEND_API_KEY = 're_banc';
process.env.RESEND_FROM = 'Fun Galaxy <reservations@fungalaxy.be>';

// Les mutations compilees en memoire, sur le meme crochet que scripts/reserver-banc.js.
let mutations = [];
const compileAvant = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const edits = mutations.filter((e) => e.fichier === rel);
  if (!edits.length) return compileAvant.call(this, contenu, nom);
  let mute = contenu.split('\r\n').join(LF);
  for (const { de, vers } of edits) {
    if (mute.split(de).length !== 2) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compileAvant.call(this, mute, nom);
};

// Les doublures du chemin public, les memes que scripts/centres-dissocies-check.js. La lecture et le reste sont reels.
function mock(rel, exports) { const r = require.resolve(path.join(ROOT, rel)); require.cache[r] = { id: r, filename: r, loaded: true, exports }; }
mock('lib/rate-limit', { enforceRateLimit: () => false, checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }), getClientIp: () => 'banc' });
const kn = require('../lib/ops-knowledge');
kn.refreshCenterOverrides = async () => false;
kn.refreshCatalog = async () => false;
require('../lib/booking-config').refreshFormuleOverrides = async () => false;
const database = require('../lib/database');
let panneBase = false;
let horairesPris = false;
const infra = () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' });
database.readAvailabilitySnapshot = async (date, centerId) => ({ date, centerId, laneStatuses: {}, blocks: [], reservations: [] });
database.readStaffState = database.readAvailabilitySnapshot;
database.createOpsEvent = async () => ({});
database.createSlotHold = async (payload, o) => {
  if (panneBase) throw infra();
  if (horairesPris) throw new Error('Aucune piste disponible pour 1 piste(s)');
  return { expiresAt: new Date(Date.now() + 600000).toISOString(), minutes: 10, jeton: o && o.jeton };
};
database.readMatchingSlotHold = async () => null;
database.readUpsellSlotHold = async () => null;
database.releaseSlotHold = async () => ({ released: 1 });
if (database.reservationDejaConfirmee) database.reservationDejaConfirmee = async () => null;
database.createReservation = async (payload) => {
  if (panneBase) throw infra();
  return { ...payload, id: 900, status: 'pending', opsPlan: payload.opsPlan, price: payload.price, pax: payload.pax, centerId: payload.centerId };
};
require('../lib/reservation-ops').afterReservationCreated = async () => ({ communications: [], warnings: [] });
for (const nom of ['error', 'warn']) { const o = console[nom]; console[nom] = (...a) => { if (!/\[public-|\[garde\]|\[tour-controle\]|TRACE PERDUE|ECRITURE PERDUE|DATABASE_URL/.test(String(a[0]))) o(...a); }; }
const HEURES = { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} };
kn.applyCenterOverrides(new Map([['libramont', { defaultSchedule: HEURES, secours: { emails: ['secours@fungalaxy.be'] } }], ['gembloux', { defaultSchedule: HEURES }]]));
const meta = require('../api/public-booking-meta.js');
const availability = require('../api/public-availability.js');

const charger = (rel) => { const r = require.resolve(path.join(ROOT, rel)); delete require.cache[r]; return require(r); };
const tourReel = () => charger('lib/tour-controle.js');

// Appel direct d un gestionnaire.
const { Readable } = require('stream');
async function appeler(handler, methode, url, corps) {
  const req = Readable.from(corps === undefined ? [] : [Buffer.from(JSON.stringify(corps))]);
  Object.assign(req, { method: methode, url, headers: { host: 'localhost', 'content-type': 'application/json', 'user-agent': 'banc' } });
  const res = { statusCode: 200, entetes: {}, corps: '', setHeader(k, v) { this.entetes[k.toLowerCase()] = v; }, getHeader(k) { return this.entetes[k.toLowerCase()]; }, end(b) { this.corps = String(b || ''); } };
  await handler(req, res);
  let json = {};
  try { json = JSON.parse(res.corps); } catch (e) { json = {}; }
  return { statut: res.statusCode, json };
}

const PERSONNEL = /Emma|Dubois|Marc|Lambert|Léa|Simon|0470|\+33|example\.be|Jean Essai|0471/;

async function preuvesServeur() {
  remettre();
  const tour = tourReel();
  const pool = database.getPool();
  // Toutes les requetes de la Tour passent ici au moins une fois, confrontees au schema.
  BD.verifier = true;
  const lecture = await tour.lireTour(pool, { centre: 'gembloux', canal: 'public', statut: 'pending', visite: DEMAIN });
  const dossier = await tour.lireDossierTour(pool, 101);
  await tour.derniereGardeReussie(pool);
  await tour.essaiEcriture(pool);
  await tour.noterPassageSonde(pool);
  BD.verifier = false;
  const mail3 = BD.mails.find((m) => m.id === 3);
  const statut3 = mail3.status;
  mail3.status = 'delivered';
  const relue = await tour.lireTour(pool, {});
  mail3.status = statut3;
  const ligne103 = relue.reservations.lignes.find((r) => Number(r.id) === 103);
  ok(ligne103 && ligne103.mails.envoyes === 1, '[S] un mail bien recu compte comme parti', ligne103 && ligne103.mails);
  ok(lecture.ok === true && lecture.reservations.lignes.every((r) => r.centre === 'gembloux' && r.canal === 'public'), '[S] la lecture complete tourne, ses filtres vont jusqu a la requete', lecture.reservations);
  ok(dossier && dossier.mails.length === 1 && dossier.plan.etapes.length === 1, '[S] le dossier complet tourne', dossier && dossier.mails);
  ok(await tour.lireDossierTour(pool, 'x') === null && await tour.lireDossierTour(pool, 99999) === null, '[S] un numero de dossier faux ne rend rien');
  const forge = tour.construireFiltres({ centre: "x' or 1=1 --", canal: 'autre', statut: 'autre', visite: '2026-99', quand: 'autre' });
  ok(!/or 1=1|autre/.test(forge.where) && forge.params.length === 1, '[S] des filtres forges n entrent pas dans la requete', forge);

  // [P] Ce qui ne va pas se lit.
  // Un mail parti puis revenu (la boite du client est pleine) n est pas une panne : il a deja sa ligne « est revenu ».
  BD.mails.push({ id: 99901, center_id: 'libramont', reservation_id: 0, status: 'failed', channel: 'email', created_at: ilYA(30), last_error: 'Adresse en erreur (bounce) : boite pleine' });
  const { problemes } = await tour.lireProblemes(pool);
  const a = (cle) => problemes.find((x) => x.cle.startsWith(cle));
  ok(a('mail:echec:gembloux') && a('mail:echec:gembloux').gravite === 'critique', '[P] un mail perdu a Gembloux est urgent', problemes.map((x) => x.cle));
  ok(!a('mail:echec:libramont'), '[P] un mail revenu n est pas compte comme un mail perdu', problemes.map((x) => x.cle));
  BD.mails = BD.mails.filter((m) => m.id !== 99901);
  ok(a('mail:attente:libramont'), '[P] un mail coince depuis plus de 30 min se dit');
  ok(a('mail:bounced:libramont'), '[P] un mail revenu se dit');
  ok(a('secours:sans-adresse:gembloux') && a('secours:sans-adresse:gembloux').gravite === 'attention', '[P] Gembloux sans adresse de secours se dit, a regarder : un choix d Ansar, pas une panne');
  ok(!a('secours:sans-adresse:libramont'), '[P] Libramont a la sienne : rien');
  ok(a('base:fabriquees:gembloux'), '[P] les reservations d essai qui occupent des places se disent');
  ok(!a('tache:'), '[P] temoin : toutes les gardes sont a l heure, rien', problemes.filter((x) => x.cle.startsWith('tache:')).map((x) => x.titre));
  BD.runs.find((r) => r.task_name === 'secours').finished_at = ilYA(120);
  BD.runs.find((r) => r.task_name === 'secours').started_at = ilYA(120);
  BD.runs.push({ task_name: 'ops-jobs', status: 'failed', started_at: ilYA(1), finished_at: ilYA(1), error: 'Base occupée', result: {} });
  BD.runs.find((r) => r.task_name === 'agent-orchestrator').finished_at = ilYA(90000);
  const { problemes: apres } = await tour.lireProblemes(pool);
  const b = (cle) => apres.find((x) => x.cle === cle);
  ok(b('tache:secours:retard') && /ne tourne plus/.test(b('tache:secours:retard').titre), '[P] le planning de secours arrete depuis 2 h est urgent', apres.map((x) => x.cle));
  ok(b('tache:ops-jobs:echec') && /Base occupée/.test(b('tache:ops-jobs:echec').detail), '[P] une tache ratee dit pourquoi');
  ok(!b('tache:agent-orchestrator:retard'), '[P] les agents marketing en retard ne sonnent pas : aucun client n est touche');
  delete process.env.TELEGRAM_JETON;
  const { problemes: sansCanal } = await tour.lireProblemes(pool);
  process.env.TELEGRAM_JETON = 'banc';
  ok(sansCanal.some((x) => x.cle === 'canal:absent'), '[P] sans Telegram, la Tour le dit');

  // Une section en panne se dit et ne couche pas les autres.
  const avecPanne = { query: (sql, p) => { if (/from email_events/.test(sql)) throw new Error('table absente'); return pool.query(sql, p); }, connect: () => pool.connect() };
  const { problemes: partiel } = await tour.lireProblemes(avecPanne);
  ok(partiel.some((x) => x.cle === 'lecture:mails') && partiel.some((x) => x.cle === 'secours:sans-adresse:gembloux'), '[P] une lecture cassee se dit, et le reste de la page reste vrai', partiel.map((x) => x.cle));

  // [G] La garde.
  remettre();
  const passe = async (options = {}) => {
    TELEGRAM.length = 0;
    const r = await tour.lancerGarde({ pool, instant: options.instant || new Date('2026-11-14T12:00:00Z'), ...options });
    BD.runs.unshift({ task_name: 'garde', status: 'ok', started_at: new Date(), finished_at: new Date(), result: r });
    return { r, messages: TELEGRAM.slice() };
  };
  const p1 = await passe();
  ok(p1.messages.length === 1 && /^URGENT Pinlane/.test(p1.messages[0]) && /Gembloux/.test(p1.messages[0]), '[G] premiere fois : un message, urgent', p1.messages);
  ok(!PERSONNEL.test(p1.messages.join(' ')), '[G] aucune donnee personnelle dans le message', p1.messages);
  const p2 = await passe();
  ok(p2.messages.length === 0, '[G] rien de neuf : silence', p2.messages);
  BD.mails = BD.mails.filter((m) => m.status !== 'failed');
  const p3 = await passe();
  ok(p3.messages.length === 1 && /^Réglé, Pinlane/.test(p3.messages[0]) && /mail/.test(p3.messages[0]), '[G] c est regle : il le dit', p3.messages);
  BD.centres.find((c) => c.id === 'libramont').status = 'closed';
  BD.centres.find((c) => c.id === 'libramont').status = 'active';
  BD.centres.find((c) => c.id === 'gembloux').settings = { config: { secours: { emails: ['secours@fungalaxy.be'] } } };
  const p4 = await passe();
  ok(p4.messages.length === 1 && /Réglé/.test(p4.messages[0]), '[G] l adresse de secours posee : regle aussi', p4.messages);
  BD.centres.find((c) => c.id === 'gembloux').settings = { config: {} };
  telegramCoupe = true;
  const p5 = await passe();
  telegramCoupe = false;
  ok(p5.messages.length === 0 && p5.r.envois.includes(false), '[G] Telegram coupe : rien ne part, et rien n est retenu comme dit', p5.r);
  const p6 = await passe();
  ok(p6.messages.length === 1 && /adresse de secours/.test(p6.messages[0]), '[G] au passage suivant, le message part enfin', p6.messages);
  const soir = new Date('2026-11-14T21:30:00Z');
  const p7 = await passe({ instant: soir });
  ok(p7.messages.length === 1 && /^Bilan Pinlane du/.test(p7.messages[0]) && /Libramont/.test(p7.messages[0]) && /Gembloux/.test(p7.messages[0]), '[G] le soir, un bilan des deux centres', p7.messages);
  ok(!PERSONNEL.test(p7.messages.join(' ')), '[G] le bilan ne cite personne', p7.messages);
  const p8 = await passe({ instant: new Date('2026-11-14T21:45:00Z') });
  ok(p8.messages.length === 0, '[G] un seul bilan par soir', p8.messages);

  // La sonde demande : la base ecrit-elle ?
  remettre();
  ok(await tour.essaiEcriture(pool) === true, '[G] la base ecrit : oui');
  BD.panneEcriture = true;
  ok(await tour.essaiEcriture(pool) === false, '[G] la base lit sans ecrire : non');
  BD.panneEcriture = false;
  const nb = BD.runs.length;
  await tour.noterPassageSonde(pool);
  ok(BD.runs.length === nb + 1 && BD.runs[0].task_name === 'sonde', '[G] le passage de la sonde se note : la garde peut la voir tomber');
}

// [C] Le client qui rate sa reservation.
function corpsDemande(jour, c = {}) {
  return { name: 'Jean Essai', phone: '0471234567', email: 'jean.essai@example.be', date: jour, startTime: '11:00', pax: 4, channel: 'public', type: 'visite', label: 'Votre visite', price: 50, quotedPrice: 50, centerId: 'gembloux', program: [{ activityId: 'golf_oclock', participants: 4 }], ...c };
}
async function preuvesClient(jour) {
  remettre();
  require('../lib/garde-alertes').oublierLesAlertes();
  const reservations = charger('api/public-reservations.js');
  TELEGRAM.length = 0;
  RESEND.length = 0;

  panneBase = true;
  const panne = await appeler(reservations, 'POST', '/api/public-reservations', corpsDemande(jour));
  panneBase = false;
  ok(panne.statut === 503, '[C] la base tombe a la confirmation : le client a un message', panne);
  ok(TELEGRAM.length === 1 && /^URGENT Pinlane/.test(TELEGRAM[0]) && /gembloux/.test(TELEGRAM[0]) && TELEGRAM[0].includes(jour), '[C] Ansar le sait tout de suite, avec le centre et le jour', TELEGRAM);
  ok(/n’a pas pu partir/.test(TELEGRAM[0] || ''), '[C] Gembloux sans adresse : le message dit que la demande n est pas partie', TELEGRAM);
  ok(!PERSONNEL.test(TELEGRAM.join(' ')), '[C] ni nom, ni telephone, ni e-mail sur Telegram', TELEGRAM);
  const trace = BD.journal.find((j) => j.action === 'reservation.panne');
  ok(trace && trace.center_id === 'gembloux' && trace.outcome === 'error', '[C] la panne est au journal, sous son centre', trace);
  ok(trace && !PERSONNEL.test(JSON.stringify(trace)), '[C] le journal des essais ne garde aucune donnee personnelle', trace);

  TELEGRAM.length = 0;
  panneBase = true;
  await appeler(reservations, 'POST', '/api/public-reservations', corpsDemande(jour));
  panneBase = false;
  ok(TELEGRAM.length === 0, '[C] la meme panne cinq secondes plus tard : pas un second message', TELEGRAM);
  ok(BD.journal.filter((j) => j.action === 'reservation.panne').length === 2, '[C] mais la seconde est comptee au journal');

  panneBase = true;
  const transmise = await appeler(reservations, 'POST', '/api/public-reservations', corpsDemande(jour, { centerId: 'libramont', price: 30, quotedPrice: 30, program: [{ activityId: 'fun_run', minutes: 15, participants: 4 }] }));
  panneBase = false;
  ok(transmise.statut === 503 && RESEND.length === 1, '[C] Libramont a une boite de secours : la demande y part', { transmise, resend: RESEND.length });
  ok(TELEGRAM.some((t) => /boîte de secours/.test(t) && /libramont/.test(t)), '[C] et le message le dit', TELEGRAM);

  const refus = await appeler(reservations, 'POST', '/api/public-reservations', corpsDemande(jour, { centerId: 'libramont', program: [{ activityId: 'golf_oclock' }] }));
  ok(refus.statut >= 400 && refus.statut < 500, '[C] temoin : le Golf o Clock refuse a Libramont', refus);
  const tr = BD.journal.find((j) => j.action === 'reservation.refusee');
  ok(tr && tr.center_id === 'libramont' && tr.denied_reason, '[C] un refus laisse sa trace, avec son motif', tr);
  ok(tr && !PERSONNEL.test(JSON.stringify(tr)), '[C] sans donnee personnelle', tr);

  const journalAvantForge = BD.journal.length;
  const inconnu = await appeler(reservations, 'POST', '/api/public-reservations', corpsDemande(jour, { centerId: '<script>alert(1)</script>' }));
  ok(inconnu.statut >= 400 && BD.journal.length === journalAvantForge, '[C] un centre forge est refuse et n ecrit rien au journal', BD.journal.map((j) => j.center_id));

  horairesPris = true;
  const pris = await appeler(reservations, 'POST', '/api/public-reservations?action=hold', corpsDemande(jour, { name: '', phone: '', email: '' }));
  horairesPris = false;
  ok(pris.statut === 409 && BD.journal.some((j) => j.action === 'blocage.refuse' && j.denied_reason === 'horaires déjà pris'), '[C] des horaires deja pris se comptent', { pris, journal: BD.journal.map((j) => j.action) });

  TELEGRAM.length = 0;
  panneBase = true;
  const blocage = await appeler(reservations, 'POST', '/api/public-reservations?action=hold', corpsDemande(jour, { name: '', phone: '', email: '' }));
  panneBase = false;
  ok(blocage.statut === 503 && TELEGRAM.some((t) => /ne se retiennent plus/.test(t)), '[C] les horaires qui ne se retiennent plus : un message', { blocage, TELEGRAM });

  const tour = tourReel();
  const { essais } = await tour.lireProblemes(database.getPool());
  ok(essais.some((e) => e.action === 'reservation.panne' && e.centre === 'gembloux' && e.n === 2), '[C] la Tour les relit, par centre et par motif', essais);
  const { problemes } = await tour.lireProblemes(database.getPool());
  ok(problemes.some((p) => p.cle.startsWith('essai:panne:gembloux')), '[C] et les range parmi les problemes urgents', problemes.map((p) => p.cle));
}

// ---------------------------------------------------------------------------
// Le serveur des pages : le vrai formulaire, la vraie console, la vraie Tour sur la base en memoire.
// ---------------------------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
let servies = [];
let panneTour = false;
const serveur = http.createServer(async (rq, rs) => {
  const u = new URL(rq.url, BASE);
  try {
    if (u.pathname === '/api/public-booking-meta' || u.pathname === '/api/healthz') { await meta(rq, rs); return; }
    if (u.pathname === '/api/public-availability') { await availability(rq, rs); return; }
    if (u.pathname === '/api/ops' && /^founderTour/.test(u.searchParams.get('action') || '')) {
      rs.setHeader('Content-Type', 'application/json');
      if (panneTour) { rs.statusCode = 503; rs.end(JSON.stringify({ ok: false, message: 'La base ne répond pas.' })); return; }
      const tour = require('../lib/tour-controle');
      if (u.searchParams.get('action') === 'founderTourDossier') { rs.end(JSON.stringify(await tour.lireDossierTour(database.getPool(), u.searchParams.get('id')))); return; }
      const p = u.searchParams;
      rs.end(JSON.stringify(await tour.lireTour(database.getPool(), { centre: p.get('centre'), canal: p.get('canal'), statut: p.get('statut'), validation: p.get('validation'), quand: p.get('quand'), visite: p.get('visite') })));
      return;
    }
    if (u.pathname === '/api/ops' && rq.method === 'POST') {
      const morceaux = [];
      for await (const m of rq) morceaux.push(m);
      const corps = JSON.parse(Buffer.concat(morceaux).toString('utf8'));
      if (corps.action === 'setEmbedState') BD.centres.find((c) => c.id === corps.centerId).settings.config.embed = { actif: corps.actif };
      rs.setHeader('Content-Type', 'application/json');
      rs.end('{"ok":true}');
      return;
    }
    if (u.pathname.startsWith('/api/')) { rq.resume(); rs.writeHead(204); rs.end(); return; }
    const rel = u.pathname === '/' ? 'index.html' : (/^\/fungalaxy(\/|$)/.test(u.pathname) ? 'fungalaxy.html' : decodeURIComponent(u.pathname.replace(/^\/+/, '')));
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); rs.end('absent'); return; }
    let contenu = fs.readFileSync(f);
    const edits = servies.filter((e) => e.fichier === rel);
    if (edits.length) {
      let texte = contenu.toString('utf8').split('\r\n').join(LF);
      for (const e of edits) {
        if (texte.split(e.de).length !== 2) throw new Error(`ancre absente ou multiple : ${e.de.slice(0, 70)}`);
        texte = texte.split(e.de).join(e.vers);
      }
      contenu = texte;
    }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    rs.end(contenu);
  } catch (e) {
    if (!rs.headersSent) rs.writeHead(500, { 'Content-Type': 'application/json' });
    rs.end(JSON.stringify({ ok: false, message: String(e.message) }));
  }
});

// [F] Le vrai formulaire remonte ses plantages.
async function preuvesFormulaire(browser) {
  remettre();
  require('../lib/garde-alertes').oublierLesAlertes();
  TELEGRAM.length = 0;
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const signaux = [];
  // (une route posee : sans elle, le corps d un sendBeacon reste invisible et le temoin ne prouverait rien)
  await p.route('**/banc-rien', (route) => route.continue());
  p.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/public-booking-meta')) { const c = r.postData() || ''; if (c.includes('erreur-formulaire')) signaux.push(JSON.parse(c)); } });
  await p.goto(`${BASE}/fungalaxy/gembloux`, { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 15000 });
  ok(signaux.length === 0, '[F] temoin : un formulaire sain ne signale rien', signaux);
  // Une vraie erreur, levee par un vrai fichier de la page : un script ajoute qui plante.
  await p.addScriptTag({ url: `${BASE}/assets/tour-faux-plantage.js` }).catch(() => {});
  await p.route('**/assets/banc-plantage.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "throw new Error('plantage de banc, jean.essai@example.be');" }));
  await p.addScriptTag({ url: `${BASE}/assets/banc-plantage.js` }).catch(() => {});
  await p.waitForTimeout(600);
  ok(signaux.length === 1 && /plantage de banc/.test(signaux[0].message) && signaux[0].centerId === 'gembloux', '[F] un plantage part au serveur, avec son centre', signaux);
  ok(!/jean\.essai/.test(BD.erreurs.map((e) => e.message).join(' ')), '[F] une adresse glissee dans le message est expurgee avant d entrer en base', BD.erreurs);
  const groupeErreur = BD.erreurs.find((e) => e.member_id === 'public:gembloux');
  ok(Boolean(groupeErreur), '[F] il entre en base, compte du formulaire de Gembloux', BD.erreurs);
  ok(TELEGRAM.length === 1 && /formulaire de gembloux a planté/.test(TELEGRAM[0]) && !/plantage de banc/.test(TELEGRAM[0]), '[F] Ansar a un message, qui ne recopie rien de ce que le navigateur a envoye', TELEGRAM);
  const { problemes } = await require('../lib/tour-controle').lireProblemes(database.getPool());
  ok(problemes.some((x) => x.cle.startsWith('erreur:client:')), '[F] la Tour le range parmi les urgents', problemes.map((x) => x.cle));

  await p.route('**/assets/banc-plantage-2.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "throw new Error('encore un');" }));
  await p.addScriptTag({ url: `${BASE}/assets/banc-plantage-2.js` }).catch(() => {});
  await p.waitForTimeout(400);
  ok(TELEGRAM.length === 1, '[F] un second plantage dans l heure : pas de second message', TELEGRAM);

  const n = signaux.length;
  await p.evaluate(() => { const e = new ErrorEvent('error', { message: 'bruit d une extension', filename: 'chrome-extension://abc/x.js', lineno: 1 }); window.dispatchEvent(e); });
  await p.evaluate(() => { window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: Object.assign(new Error('annule'), { name: 'AbortError' }) })); });
  await p.evaluate(() => { window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new TypeError('Failed to fetch') })); });
  await p.waitForTimeout(300);
  ok(signaux.length === n, '[F] une extension, une requete annulee, un reseau coupe : aucun signal', signaux.slice(n));
  for (let i = 0; i < 9; i += 1) await p.evaluate((k) => { window.dispatchEvent(new ErrorEvent('error', { message: `boucle ${k}`, filename: `${location.origin}/assets/x.js` })); }, i);
  await p.waitForTimeout(300);
  ok(signaux.length === 5, '[F] une erreur en boucle : cinq signaux au plus par page', signaux.length);
  await ctx.close();
}

// [U] La vraie console.
function doublures({ proprietaire, expiresAt }) {
  const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'direction.view', 'centers.switch', ...(proprietaire ? ['platform.admin'] : [])];
  const session = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'libramont:x', name: 'Ansar' }, role: { id: proprietaire ? 'platform-owner' : 'direction', name: proprietaire ? 'Propriétaire' : 'Direction', locked: true }, permissions: perms };
  const J = (c) => new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });
  const nf = window.fetch.bind(window);
  window.__appelsTour = [];
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    const u = new URL(raw, location.origin);
    if (/^founderTour/.test(u.searchParams.get('action') || '')) { window.__appelsTour.push(u.search); return nf(input, init); }
    if (u.pathname === '/api/ops' && /setEmbedState/.test(String(init.body || ''))) return nf(input, init);
    if (!u.pathname.startsWith('/api/')) return nf(input, init);
    if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session });
    return J({ ok: true, reservations: [], laneStatuses: {}, communications: [], centers: [{ id: 'libramont', name: 'Fun Galaxy Libramont', city: 'Libramont' }, { id: 'gembloux', name: 'Fun Galaxy Gembloux', city: 'Gembloux' }] });
  };
  try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session)); } catch (e) { /* le test le verra */ }
}
async function ouvrirConsole(browser, { proprietaire = true, viewport = { width: 1500, height: 1000 }, theme = 'dark' } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(doublures, { proprietaire, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  await page.goto(`${BASE}/?v=tour-${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined');
  await page.evaluate((t) => { if (typeof hasSavedAuth === 'function') hasSavedAuth(); state.adminCenterId = 'libramont'; state.staffTheme = t; }, theme);
  return { ctx, page };
}
const allerALaTour = (page) => page.evaluate(() => { state.staffMenuPage = 'cockpit-tour'; setView('staff'); if (typeof renderStaff === 'function') renderStaff(); });
// Comme le fondateur : un clic dans le menu. Poser l etat a la main cachait une lecture qui ne partait jamais.
const ouvrirParLeMenu = async (page) => {
  await page.evaluate(() => { setView('staff'); if (typeof renderStaff === 'function') renderStaff(); });
  await page.waitForFunction(() => document.querySelector('[data-fgx-menu-key="cockpit-tour"]'));
  await page.evaluate(() => document.querySelector('[data-fgx-menu-key="cockpit-tour"]').click());
};

async function jouerConsole(browser) {
  remettre();
  // Ajouter une adresse (Ansar : « reglable met rien pour le moment mais on pzeut add ») : de vrais clics, jusqu au champ, sur le bon centre.
  {
    const vue = await ouvrirConsole(browser);
    await ouvrirParLeMenu(vue.page);
    await vue.page.waitForSelector('[data-tour-secours="gembloux"]', { timeout: 15000 });
    ok(await vue.page.locator('[data-tour-secours="libramont"]').count() === 0, '[U] un centre qui a son adresse n a pas le bouton');
    await vue.page.click('[data-tour-secours="gembloux"]');
    await vue.page.waitForFunction(() => document.activeElement && document.activeElement.id === 'estab-secours-emails', null, { timeout: 8000 }).catch(() => {});
    await vue.page.waitForTimeout(800);
    const lire = () => vue.page.evaluate(() => { const b = document.getElementById('estabSaveBtn'); return { page: state.staffMenuPage, centre: state.establishmentCenterId, onglet: state.establishmentTab, sauve: b ? b.getAttribute('onclick') : '', focus: document.activeElement && document.activeElement.id }; });
    const depuisTour = await lire();
    ok(depuisTour.page === 'establishment' && depuisTour.centre === 'gembloux' && depuisTour.onglet === 'regles' && /gembloux/.test(depuisTour.sauve) && depuisTour.focus === 'estab-secours-emails', '[U] « Ajouter une adresse » ouvre le champ de CE centre, pret a ecrire, et le curseur y reste', depuisTour);
    await vue.page.evaluate(() => { state.establishmentEditing = false; state.establishmentCenterId = 'libramont'; state.staffMenuPage = 'secours'; setView('staff'); if (typeof renderStaff === 'function') renderStaff(); });
    await vue.page.waitForSelector('[data-secours-ajouter]', { timeout: 15000 });
    await vue.page.click('[data-secours-ajouter]');
    await vue.page.waitForFunction(() => document.activeElement && document.activeElement.id === 'estab-secours-emails', null, { timeout: 8000 }).catch(() => {});
    const depuisSecours = await lire();
    ok(depuisSecours.page === 'establishment' && depuisSecours.focus === 'estab-secours-emails' && /libramont/.test(depuisSecours.sauve), '[U] la page Secours mene au meme champ, sur le centre affiche', depuisSecours);
    await vue.ctx.close();
  }
  // La serie des revenus : une reponse sans jours ne relance pas la lecture en boucle (84 lectures par seconde, ecran fige, vu par le robot du toucher).
  {
    const dash = await ouvrirConsole(browser);
    const lectures = await dash.page.evaluate(async () => {
      let n = 0;
      const nf = window.fetch;
      window.fetch = function (input) { if (/days=14/.test(String(typeof input === 'string' ? input : input.url))) n += 1; return nf.apply(this, arguments); };
      state.staffMenuPage = 'dashboard';
      setView('staff');
      if (typeof renderStaff === 'function') renderStaff();
      await new Promise((r) => setTimeout(r, 1500));
      window.fetch = nf;
      return n;
    });
    ok(lectures <= 2, '[U] la Vue d ensemble ne relance pas sa lecture en boucle quand la serie revient vide', lectures);
    await dash.ctx.close();
  }
  const { ctx, page } = await ouvrirConsole(browser);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message).slice(0, 200)));
  try {
    await ouvrirParLeMenu(page);
    await page.waitForSelector('[data-tour-etat]');
    await page.waitForSelector('[data-tour-ligne]');
    return await (async () => {
      const lire = () => page.evaluate(() => ({
        etat: (document.querySelector('[data-tour-etat]') || {}).dataset && document.querySelector('[data-tour-etat]').dataset.tourEtat,
        titre: (document.querySelector('[data-tour-etat] strong') || { textContent: '' }).textContent,
        problemes: [...document.querySelectorAll('[data-probleme]')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()),
        centres: [...document.querySelectorAll('[data-tour-centre]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
        lignes: [...document.querySelectorAll('[data-tour-ligne]')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()),
        compte: (document.querySelector('[data-tour-compte]') || { textContent: '' }).textContent,
        taches: [...document.querySelectorAll('[data-tour-tache]')].map((l) => l.getAttribute('data-tour-tache')),
        acces: document.querySelectorAll('[data-tour-acces]').length,
      }));
      const r = { erreurs };
      r.depart = await lire();
      const appelsAvant = await page.evaluate(() => window.__appelsTour.length);
      await page.selectOption('[data-tour-filtre="centre"]', 'gembloux');
      await page.waitForFunction(() => [...document.querySelectorAll('[data-tour-ligne]')].every((l) => /Gembloux/.test(l.textContent)));
      r.gembloux = await lire();
      await page.selectOption('[data-tour-filtre="centre"]', '');
      await page.selectOption('[data-tour-filtre="canal"]', 'staff');
      await page.waitForFunction(() => document.querySelectorAll('[data-tour-ligne]').length === 1);
      r.comptoir = await lire();
      await page.selectOption('[data-tour-filtre="canal"]', '');
      await page.selectOption('[data-tour-filtre="quand"]', '30j');
      await page.waitForFunction(() => /Ancien Client/.test(document.querySelector('#tourListe').textContent));
      r.trenteJours = await lire();
      await page.selectOption('[data-tour-filtre="quand"]', 'avenir');
      await page.waitForFunction(() => !/Ancien Client/.test(document.querySelector('#tourListe').textContent) || document.querySelector('[data-tour-compte]').textContent.includes('5'));
      await page.waitForTimeout(250);
      r.aVenir = await lire();
      await page.selectOption('[data-tour-filtre="quand"]', 'tout');
      await page.waitForFunction(() => /Ancien Client/.test(document.querySelector('#tourListe').textContent));
      r.toutes = await lire();
      await page.selectOption('[data-tour-filtre="quand"]', '7j');
      await page.waitForFunction(() => !/Ancien Client/.test(document.querySelector('#tourListe').textContent));

      // La recherche : dans la page, jamais dans l adresse.
      const avantRecherche = await page.evaluate(() => window.__appelsTour.length);
      await page.click('[data-tour-cherche]');
      await page.keyboard.type('+33 6 12');
      await page.waitForFunction(() => document.querySelectorAll('[data-tour-ligne]').length === 1);
      r.recherche = await lire();
      r.appelsRecherche = (await page.evaluate(() => window.__appelsTour.length)) - avantRecherche;
      r.adresses = await page.evaluate(() => window.__appelsTour.slice());
      // La mise a jour toute seule et le repeint global ne coupent pas la frappe.
      await page.evaluate(async () => { await window.PinlaneTour.charger(); if (typeof renderStaff === 'function') renderStaff(); });
      await page.keyboard.type(' 34');
      r.cherche = await page.evaluate(() => ({ valeur: document.querySelector('[data-tour-cherche]').value, focus: document.activeElement === document.querySelector('[data-tour-cherche]') }));
      await page.fill('[data-tour-cherche]', '');

      // Un dossier ouvert reste ouvert, et dit tout.
      await page.click('[data-tour-ouvrir="101"]');
      await page.waitForSelector('[data-tour-dossier="101"]');
      r.dossier = await page.evaluate(() => { const d = document.querySelector('[data-tour-dossier="101"]'); return { texte: d.textContent.replace(/\s+/g, ' '), mailEchec: Boolean(d.querySelector('[data-tour-mail="failed"]')), tel: (d.querySelector('a[href^="tel:"]') || {}).href || '', brut: d.querySelector('.tour-brut pre').textContent.includes('"centerId"') }; });
      await page.evaluate(() => window.PinlaneTour.charger());
      await page.waitForTimeout(150);
      r.dossierReste = await page.evaluate(() => Boolean(document.querySelector('[data-tour-dossier="101"]')));
      if (PHOTOS) await page.screenshot({ path: path.join(PHOTOS, 'tour-dossier.png'), fullPage: false });

      // Une panne se dit sans jeter ce qu on sait.
      panneTour = true;
      await page.evaluate(() => window.PinlaneTour.charger());
      await page.waitForSelector('[data-tour-etat="vieux"]');
      r.panne = await page.evaluate(() => ({ dit: document.querySelector('[data-tour-etat="vieux"]').textContent, lignes: document.querySelectorAll('[data-tour-ligne]').length }));
      panneTour = false;
      await page.evaluate(() => window.PinlaneTour.charger());
      await page.waitForFunction(() => !document.querySelector('[data-tour-etat="vieux"]'));

      // Le clic sur un centre filtre.
      await page.click('[data-tour-filtrer="gembloux"]');
      await page.waitForFunction(() => document.querySelector('[data-tour-filtre="centre"]').value === 'gembloux' && [...document.querySelectorAll('[data-tour-ligne]')].every((l) => /Gembloux/.test(l.textContent)));
      r.clicCentre = await page.evaluate(() => document.querySelector('[data-tour-filtrer="gembloux"]').getAttribute('aria-pressed'));
      await page.click('[data-tour-filtrer="gembloux"]');
      await page.waitForFunction(() => document.querySelector('[data-tour-filtre="centre"]').value === '');
      r.appels = (await page.evaluate(() => window.__appelsTour.length)) - appelsAvant;

      // Le geste de la panne : couper un centre, le voir, le remettre. Refuser la question ne change rien.
      const formulaireDe = (id) => { const c = BD.centres.find((x) => x.id === id).settings.config.embed; return !c || c.actif !== false; };
      let reponseQuestion = false;
      const questions = [];
      page.on('dialog', (d) => { questions.push(d.message()); (reponseQuestion ? d.accept() : d.dismiss()).catch(() => {}); });
      await page.click('[data-tour-couper="gembloux"]');
      await page.waitForTimeout(250);
      r.coupeRefusee = formulaireDe('gembloux');
      reponseQuestion = true;
      await page.click('[data-tour-couper="gembloux"]');
      await page.waitForFunction(() => /Réservation en ligne coupée/.test(document.querySelector('[data-tour-centre="gembloux"]').textContent));
      r.coupe = { actif: formulaireDe('gembloux'), libramont: formulaireDe('libramont'), bouton: await page.evaluate(() => document.querySelector('[data-tour-couper="gembloux"]').textContent), probleme: await page.evaluate(() => /La réservation en ligne est coupée à Gembloux/.test(document.querySelector('#tourEtat').textContent)), question: questions[questions.length - 1] };
      if (PHOTOS) await page.screenshot({ path: path.join(PHOTOS, 'tour-coupe.png'), fullPage: false });
      await page.click('[data-tour-couper="gembloux"]');
      await page.waitForFunction(() => /Réservation en ligne ouverte/.test(document.querySelector('[data-tour-centre="gembloux"]').textContent));
      r.rouvert = formulaireDe('gembloux');
      r.menu = await page.evaluate(() => (document.querySelector('[data-page="cockpit-tour"], [data-menu-key="cockpit-tour"], [data-key="cockpit-tour"]') || { textContent: '' }).textContent.trim());
      r.debordement = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (PHOTOS) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(PHOTOS, 'tour-haut.png'), fullPage: false });
      }
      return r;
    })();
  } finally {
    await ctx.close();
  }
}
async function preuvesConsole(browser) {
  const r = await jouerConsole(browser);
  ok(r.erreurs.length === 0, '[U] aucune erreur dans la page', r.erreurs);
  ok(r.depart.etat === 'urgent' && /urgent/.test(r.depart.titre), '[U] l etat general dit qu il y a de l urgent', r.depart.titre);
  ok(r.depart.problemes.some((t) => /Gembloux n’a aucune adresse de secours/.test(t)), '[U] le probleme se lit en clair a l ecran', r.depart.problemes);
  ok(r.depart.centres.length === 2 && /GEMBLOUX|Gembloux/.test(r.depart.centres.join(' ')) && /Libramont/.test(r.depart.centres.join(' ')), '[U] les deux centres ont leur bloc', r.depart.centres);
  ok(/Aucune adresse de secours/.test(r.depart.centres.find((c) => /Gembloux/i.test(c)) || ''), '[U] le bloc de Gembloux le dit aussi', r.depart.centres);
  ok(/Planning de secours envoyé/.test(r.depart.centres.find((c) => /Libramont/i.test(c)) || ''), '[U] celui de Libramont dit son dernier envoi', r.depart.centres);
  ok(r.depart.lignes.length === 4 && /Emma Dubois/.test(r.depart.lignes[0]) && /Gembloux/.test(r.depart.lignes[0]), '[U] toutes les reservations, la plus recente en haut, simulations exclues', r.depart.lignes);
  ok(!r.depart.lignes.some((l) => /Simulation/.test(l)), '[U] la simulation ne se melange pas aux vraies');
  ok(/Essai/.test(r.depart.lignes.find((l) => /Essai Démo/.test(l)) || ''), '[U] une reservation d essai porte sa marque');
  ok(/Échec/.test(r.depart.lignes[0]), '[U] le mail perdu se voit sur sa ligne', r.depart.lignes[0]);
  ok(/À valider/.test(r.depart.lignes.find((l) => /Marc Lambert/.test(l)) || ''), '[U] une reservation a valider se voit', r.depart.lignes);
  ok(/Annulée/.test(r.depart.lignes.find((l) => /Léa Simon/.test(l)) || ''), '[U] une reservation annulee se voit', r.depart.lignes);
  ok(r.depart.taches.includes('sonde') && r.depart.taches.includes('garde') && r.depart.taches.includes('secours') && r.depart.taches.includes('sauvegarde') && r.depart.taches.includes('canal'), '[U] chaque garde a sa ligne', r.depart.taches);
  ok(r.depart.acces === 1, '[U] on voit qui a l acces proprietaire', r.depart.acces);
  ok(r.gembloux.lignes.length === 2 && r.gembloux.lignes.every((l) => /Gembloux/.test(l)), '[U] le filtre de centre part au serveur et revient juste', r.gembloux.lignes);
  ok(r.comptoir.lignes.length === 1 && /Marc Lambert/.test(r.comptoir.lignes[0]) && /Comptoir/.test(r.comptoir.lignes[0]), '[U] le filtre de canal aussi', r.comptoir.lignes);
  ok(r.trenteJours.lignes.some((l) => /Ancien Client/.test(l)), '[U] la periode aussi', r.trenteJours.compte);
  ok(r.aVenir.lignes.length === 5 && r.aVenir.lignes.some((l) => /Ancien Client/.test(l)), '[U] les visites a venir, quelle que soit la date de reception', r.aVenir.lignes);
  ok(r.toutes.lignes.length === 5, '[U] toutes, sans borne de date', r.toutes.lignes);
  ok(r.recherche.lignes.length === 1 && /Emma Dubois/.test(r.recherche.lignes[0]), '[U] chercher un numero etranger trouve son dossier', r.recherche.lignes);
  ok(r.appelsRecherche === 0, '[U] la recherche reste dans la page : aucun appel', r.appelsRecherche);
  ok(!r.adresses.some((a) => /Emma|Dubois|%2B33|\+33/.test(a)), '[U] jamais un nom ni un numero dans une adresse', r.adresses);
  ok(r.cherche.focus && r.cherche.valeur === '+33 6 12 34', '[U] la mise a jour et le repeint ne coupent pas la frappe', r.cherche);
  ok(/Emma Dubois/.test(r.dossier.texte) && /emma\.dubois@example\.be/.test(r.dossier.texte) && r.dossier.tel.includes('+33612345678'), '[U] le dossier dit le client, son mail, son numero a appeler', r.dossier);
  ok(r.dossier.mailEchec && /Adresse refusée par le serveur/.test(r.dossier.texte), '[U] le mail perdu dit pourquoi', r.dossier.texte.slice(0, 500));
  ok(/15:00/.test(r.dossier.texte) && /Laser Game/.test(r.dossier.texte) && /Groupe de plus de 6/.test(r.dossier.texte), '[U] l heure par heure et la raison de validation', r.dossier.texte.slice(0, 500));
  ok(r.dossier.brut, '[U] les donnees brutes sont la, repliees');
  ok(r.dossierReste, '[U] le dossier reste ouvert a la mise a jour');
  ok(/dernière mise à jour a échoué/.test(r.panne.dit) && r.panne.lignes > 0, '[U] une lecture ratee se dit, et ce qu on savait reste affiche', r.panne);
  ok(r.clicCentre === 'true', '[U] le clic sur un centre le filtre et le marque', r.clicCentre);
  ok(r.debordement === false, '[U] la page ne deborde pas');
  ok(r.coupeRefusee === true, '[U] couper demande confirmation : sans elle, rien ne change', r.coupeRefusee);
  ok(r.coupe.actif === false && r.coupe.libramont === true && /Remettre/.test(r.coupe.bouton) && r.coupe.probleme && /Gembloux/.test(r.coupe.question), '[U] couper Gembloux se fait en un geste, sans toucher Libramont, et la Tour le dit', r.coupe);
  ok(r.rouvert === true, '[U] et se remet pareil', r.rouvert);

  // Le menu n existe que pour le proprietaire ; une Direction qui force l adresse n y entre pas.
  const direction = await ouvrirConsole(browser, { proprietaire: false });
  await allerALaTour(direction.page);
  await direction.page.waitForTimeout(800);
  const vu = await direction.page.evaluate(() => ({ racine: Boolean(document.querySelector('#tourRacine')), appels: window.__appelsTour.length, menu: /Tour de contrôle/.test((document.querySelector('.fgx-menu, #staffMenu, nav') || document.body).textContent) }));
  ok(!vu.racine && vu.appels === 0, '[U] une Direction qui force la page : pas de Tour, aucun appel', vu);
  ok(!vu.menu, '[U] et aucune entree dans son menu', vu);
  await direction.ctx.close();
  const proprio = await ouvrirConsole(browser);
  await allerALaTour(proprio.page);
  await proprio.page.waitForSelector('#tourRacine');
  const menuProprio = await proprio.page.evaluate(() => /Tour de contrôle/.test(document.body.textContent));
  ok(menuProprio, '[U] le proprietaire la voit dans son menu');
  if (PHOTOS) {
    await proprio.page.waitForSelector('[data-tour-ligne]');
    await proprio.page.screenshot({ path: path.join(PHOTOS, 'tour-complet.png'), fullPage: true });
    await proprio.page.setViewportSize({ width: 390, height: 844 });
    await proprio.page.waitForTimeout(300);
    await proprio.page.screenshot({ path: path.join(PHOTOS, 'tour-telephone.png'), fullPage: false });
  }
  await proprio.ctx.close();
}

// [X] Les contre-preuves.
async function contrePreuves(browser, jour) {
  const remplir = (m) => { mutations = m; };
  const rouge = async (nom, m, rejouer, detail) => {
    remplir(m);
    let vert = true;
    let raison = '';
    try { vert = await rejouer(); } catch (e) { vert = false; raison = e.message; if (/ancre absente/.test(raison)) { remplir([]); ok(false, `[X] ${nom} : ancre morte`, raison); return; } }
    remplir([]);
    ok(!vert, `[X] ${nom} : rougit${detail ? ` (${detail})` : ''}`, raison);
  };
  const FICHIER = 'lib/tour-controle.js';
  await rouge('la garde redit tout a chaque passage', [{ fichier: FICHIER, de: 'const nouveaux = problemes.filter((p) => !precedent[p.cle]);', vers: 'const nouveaux = problemes;' }], async () => {
    const t = tourReel();
    return t.deciderGarde({ a: 'A' }, [{ cle: 'a', titre: 'A', detail: '', gravite: 'critique' }]).messages.length === 0;
  });
  tourReel();
  await rouge('un centre sans adresse de secours ne se dit plus', [{ fichier: FICHIER, de: 'if (!c.secours.adresses) out.push(', vers: 'if (false) out.push(' }], async () => {
    remettre();
    const { problemes } = await tourReel().lireProblemes(database.getPool());
    return problemes.some((p) => p.cle === 'secours:sans-adresse:gembloux');
  });
  await rouge('un message non parti est retenu comme dit', [{ fichier: FICHIER, de: 'if (!r.ok) garde = precedent.dits;', vers: '' }], async () => {
    remettre();
    telegramCoupe = true;
    const r = await tourReel().lancerGarde({ pool: database.getPool(), instant: new Date('2026-11-14T12:00:00Z') });
    telegramCoupe = false;
    return Object.keys(r.dits).length === 0;
  });
  await rouge('une colonne mal ecrite', [{ fichier: FICHIER, de: "where actor_kind = 'public' and entity_type = 'formulaire' and occurred_at >", vers: "where actor_kind = 'public' and entity_type = 'formulaire' and occured_at >" }], async () => {
    remettre();
    fautes.clear();
    BD.verifier = true;
    await tourReel().lireProblemes(database.getPool());
    BD.verifier = false;
    const propre = fautes.size === 0;
    fautes.clear();
    return propre;
  });
  tourReel();
  const FICHE_PUB = 'api/public-reservations.js';
  const panneTelegram = async () => {
    remettre();
    require('../lib/garde-alertes').oublierLesAlertes();
    TELEGRAM.length = 0;
    panneBase = true;
    await appeler(charger(FICHE_PUB), 'POST', '/api/public-reservations', corpsDemande(jour));
    panneBase = false;
    return TELEGRAM.length === 1;
  };
  await rouge('une panne de confirmation ne previent plus', [{ fichier: FICHE_PUB, de: 'alerter(`panne:${centrePanne}:', vers: '(async () => ({}))(`panne:${centrePanne}:' }], panneTelegram);
  await rouge('le journal des essais garde le nom du client', [{ fichier: FICHE_PUB, de: "date: String(c.date || '').slice(0, 10),", vers: "date: String(c.date || '').slice(0, 10), nom: c.name," }], async () => {
    remettre();
    require('../lib/garde-alertes').oublierLesAlertes();
    panneBase = true;
    await appeler(charger(FICHE_PUB), 'POST', '/api/public-reservations', corpsDemande(jour));
    panneBase = false;
    return !PERSONNEL.test(JSON.stringify(BD.journal));
  });
  await rouge('un refus ne laisse plus de trace', [{ fichier: FICHE_PUB, de: "await tracerEssai('reservation.refusee', { corps: corpsRecu, request, statut: statusCode || 400, raison: raw });", vers: '' }], async () => {
    remettre();
    await appeler(charger(FICHE_PUB), 'POST', '/api/public-reservations', corpsDemande(jour, { centerId: 'libramont', program: [{ activityId: 'golf_oclock' }], startTime: '11:00' }));
    return BD.journal.some((j) => j.action === 'reservation.refusee');
  });
  charger(FICHE_PUB);

  // Cote navigateur : le code d avant, servi en memoire, un scenario par piece.
  servies = [{ fichier: 'assets/fungalaxy-booking.js', de: "if (!fichier || fichier.indexOf(window.location.origin) !== 0) return;", vers: '' }];
  const c1 = await browser.newContext();
  const p1 = await c1.newPage();
  const vus = [];
  await p1.route('**/banc-rien', (route) => route.continue());
  p1.on('request', (r) => { if ((r.postData() || '').includes('erreur-formulaire')) vus.push(r.postData()); });
  await p1.goto(`${BASE}/fungalaxy/gembloux`, { waitUntil: 'networkidle', timeout: 45000 });
  await p1.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 15000 });
  await p1.evaluate(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'bruit d une extension', filename: 'chrome-extension://abc/x.js', lineno: 1 })); });
  await p1.waitForTimeout(300);
  await c1.close();
  servies = [];
  ok(vus.length === 1, '[X] le bruit d une extension passerait : rougit', vus.length);

  servies = [{ fichier: 'assets/tour-controle.js', de: "['centre', 'canal', 'statut', 'visite'].forEach((cle) => { if (f[cle]) p.set(cle, f[cle]); });", vers: '' }];
  const { ctx, page } = await ouvrirConsole(browser);
  await allerALaTour(page);
  await page.waitForSelector('[data-tour-ligne]');
  await page.selectOption('[data-tour-filtre="centre"]', 'gembloux');
  await page.waitForTimeout(500);
  const toutes = await page.evaluate(() => [...document.querySelectorAll('[data-tour-ligne]')].every((l) => /Gembloux/.test(l.textContent)));
  await ctx.close();
  servies = [];
  ok(!toutes, '[X] un filtre qui ne part pas au serveur : rougit');

  servies = [{ fichier: 'assets/founder-cockpit.js', de: "if (pageKey === 'cockpit-tour' && window.PinlaneTour && root.querySelector('#tourRacine')) {", vers: 'if (false) {' }];
  const deux = await ouvrirConsole(browser);
  await allerALaTour(deux.page);
  await deux.page.waitForSelector('[data-tour-cherche]');
  await deux.page.click('[data-tour-cherche]');
  await deux.page.keyboard.type('Em');
  await deux.page.evaluate(() => { if (typeof renderStaff === 'function') renderStaff(); });
  const garde = await deux.page.evaluate(() => { const c = document.querySelector('[data-tour-cherche]'); return document.activeElement === c; });
  await deux.ctx.close();
  servies = [];
  ok(!garde, '[X] un repeint global qui vide la page : rougit');
}

(async () => {
  if (PHOTOS) fs.mkdirSync(PHOTOS, { recursive: true });
  await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));
  const m = await (await fetchReel(`${BASE}/api/public-booking-meta?centerId=gembloux&calendar=60&calendarFrom=${new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)}`)).json();
  const jour = m.center.calendar.find((d) => d.weekday === 6 && d.open && !d.holiday);
  ok(Boolean(jour), 'MONTAGE : un samedi normal a venir', m.center && m.center.calendar && m.center.calendar.length);
  await preuvesServeur();
  await preuvesClient(jour.date);
  ok(fautes.size === 0, `[S] toutes les colonnes citees existent dans database/*.sql`, [...fautes]);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    await preuvesFormulaire(browser);
    await preuvesConsole(browser);
    await contrePreuves(browser, jour.date);
  } finally {
    await browser.close();
    serveur.close();
  }
  console.log(echecs ? `\ntour-controle-check: ${echecs} ECHEC(S) sur ${total}` : `\ntour-controle-check: ALL OK (${total})`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

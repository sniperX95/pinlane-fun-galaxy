'use strict';
// LES RETARDS AU PLANNING ET L HEURE DE MAINTENANT (2026-11-24). Le gerant, devant la console en ligne vers 20:15 :
//   « c quoi le petit carré à côté » ;
//   « quand on prend une réservation à l'heure où on est ça les met direct arrivé, mouais ok, mais du coup regarde quand
//     il est 20h15 ça met pas à l'heure vraiment où on est, ça met à 20h, et quand on met en retard manuellement ça
//     décale pas » ;
//   « quand y a un retard on voit [à peine], faut mettre en rouge qu'ils sont arrivés en retard là, et plus visible,
//     bowling et laser game » ; « plein de trucs où c'est pas ingénieux et pas dans les détails ».
// La VRAIE console (scripts/planning-v3-fixtures.js, le samedi « pic » a 15:10, 1366 x 768), le VRAI handler
// api/staff-reservations.js et le vrai moteur sur la base en memoire (scripts/comptoir-banc.js, scripts/reserver-banc.js).
//   [A] LE PETIT CARRE : la case vide devant l heure d une activite dont l heure est venue, le groupe la, que personne
//       n a cochee. Au planning complet, sous l heure, « à lancer » (son heure court) ou « à cocher » (son heure est
//       passee) ; sa bulle dit ou se pose la coche ; un groupe pas encore la n a ni case ni mot. A la carte du planning
//       bowling, la meme case devant l heure porte la meme bulle.
//   [B] RESERVER MAINTENANT PART DE LA MINUTE : a 15:10, un bowling pour 4 s ouvre sur « Créer à 15:10 », pas 15:00 ;
//       la touche de 15:10 dit « maintenant », celle de 15:00 non ; les heures d apres restent rondes ; le dossier nait a
//       15:10, son bowling de 15:10 a 16:10, arrive. Le laser garde ses departs (une demi-heure apres 15:10).
//   [C] LE RETARD POSE A LA MAIN DECALE CE QUI DOIT L ETRE. Le serveur seul (une journee posee) : un groupe ne arrive
//       (cree a 20:16 pour 20:00), « Retard » +16 min : son bowling passe a 20:16 et son laser a 21:16, ecrits avec le
//       retard, aucun autre dossier touche ; la piste reprise a 21:00 : « Ne passe pas », la raison et des heures libres,
//       « Tout décaler » refuse et rien ne s ecrit ; un bowling coche « fait » ne bouge pas ; un groupe attendu se decale
//       comme avant. La console : la fenetre du retard de la fiche dit « Passe » et « Tout décaler » pose le bowling a
//       15:10, cadre rouge « +10 min » au planning ; la piste reprise se dit « Ne passe pas » avec ses heures libres.
//   [D] LE RETARD SE VOIT EN ROUGE, AU PLANNING BOWLING ET AU PLANNING LASER : en retard, la carte est rouge pale,
//       cernee de rouge, sa puce dit les minutes (« 10 min », la bulle « En retard de 10 min, prévu à 15:00 ») et elles
//       courent avec la minute ; arrive en retard, le cadre rouge et « Arrivé avec 9 min de retard » ; un dossier decale
//       par le retard d un autre garde son ambre ; un groupe a l heure n a aucun rouge. Au laser, la carte en retard est
//       rouge et dit « En retard · 1 h 10 », celle arrivee en retard « Arrivé avec 7 min de retard ».
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` rejoue le gate sur du code casse expres, une mutation a la fois, en memoire (la
// console par le serveur de fichiers, le serveur par le crochet de compilation du banc), un seul navigateur a la fois,
// et exige que chacune rougisse sa lettre. Le disque n est jamais touche.
// `--seul=C` ne joue qu une lettre ; `--serveur-seul` ne joue que le serveur de [C] (aucun navigateur) ;
// `--captures` pose les ecrans de chaque sujet dans captures-retards/ (900 px de large au plus, jamais commites) ;
// `--captures --avant` les pose sur le code du commit 54fee3c (la console et le serveur d avant).
// Zero reseau sortant, zero vraie base : rien ne part.

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

delete process.env.RESEND_API_KEY;
delete process.env.POSTGRES_URL;
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fetchOrigine = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) throw new Error(`gate : appel sortant refuse vers ${u.slice(0, 80)}`);
  return fetchOrigine(url, init);
};

const ROOT = path.resolve(__dirname, '..');
// 6733 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_RETARDS_PLANNING_PORT || 6733);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = path.join(ROOT, 'captures-retards');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const SEUL = typeof argument('seul') === 'string' ? argument('seul') : '';
const joue = (lettre) => !SEUL || SEUL === lettre;
const SERVEUR_SEUL = Boolean(argument('serveur-seul'));
const AVANT = Boolean(argument('avant'));
const AVEC_CAPTURES = Boolean(argument('captures')) || AVANT;
const COMMIT_AVANT = '54fee3c';
const lf = (t) => String(t).split('\r\n').join('\n');

const APP = 'assets/app-main.js';
const PG = 'assets/pinlane-planning-global.js';
const PGC = 'assets/pinlane-planning-global.css';
const CSS = 'assets/pinlane-staff.css';
const LIB = 'lib/retard-arrivee.js';

// Les groupes du samedi « pic » (scripts/fixtures/planning-v3).
const ARTHUR = 1600; // arrive, F3, bowling 13:30 a 14:30 pistes 3-4 : passe, pas coche
const LINA = 1601; // arrive, F5, laser 15:00 et 15:30
const JULES = 1598; // attendu, F2, laser 14:00 et 14:30 : en retard
const SACHA = 1604; // attendu, F1, bowling 15:30 : a l heure
const PIROTTE = 1617; // attendue, bowling 14:30 a 16:00 pistes 3-4
const MANON = 1618; // attendus, laser 15:30 : a l heure
const GERARD = 1619; // attendue, bowling 16:00 piste 5
const CLARA = 1634; // attendus, bowling 15:00 a 16:30 pistes 6-7 : +10 min a 15:10
const HENRARD = 1635; // attendue, bowling 16:00 piste 8
const NOEL = 1637; // attendue, bowling 16:30 piste 6

// LES MUTATIONS : une regle retiree a la fois. `lettre` : le scenario qui doit rougir. `serveur` : le code passe par le
// crochet de compilation du banc, sinon la console le recoit du serveur de fichiers.
const RETARD_FIGE = { fichier: LIB, de: '  const arrivee = Math.max(arriveeDuGroupe(current), la);', vers: '  const arrivee = arriveeDuGroupe(current);' };
const MUTATIONS = [
  // [A] la case sans son mot ; la bulle qui ne dit pas ou se pose la coche ; le mot cache ; la carte bowling muette.
  { nom: 'case-sans-mot', lettre: 'A', fichier: PG, de: "    var attendue = t !== '' && !montant && (etat === 'lancer' || etat === 'acocher') ? '<span class=\"gf-x__attend\">' + (etat === 'lancer' ? 'à lancer' : 'à cocher') + '</span>' : '';", vers: "    var attendue = '';" },
  { nom: 'bulle-sans-la-coche', lettre: 'A', fichier: PG, de: "lancer: 'à lancer, pas encore coché : la case se coche dans la fiche du groupe une fois l’activité lancée'", vers: "lancer: 'à lancer, pas encore coché'" },
  { nom: 'mot-cache', lettre: 'A', fichier: PGC, de: '.gf-x__attend { align-self: flex-start;', vers: '.gf-x__attend { display: none; align-self: flex-start;' },
  { nom: 'heure-de-carte-sans-bulle', lettre: 'A', fichier: APP, de: "          <span class=\"bk-time\"${attendue ? ` title=\"${attendue === 'lancer' ? 'À lancer, pas encore coché : la case se coche dans la fiche du groupe une fois le bowling lancé' : 'Pas encore coché : la case se coche dans la fiche du groupe'}\"` : ''}>${formatClockDisplay(st)}</span>", vers: '          <span class="bk-time">${formatClockDisplay(st)}</span>' },
  // [B] la demi-heure en cours (la panne du gerant) ; « maintenant » sur la demi-heure.
  { nom: 'demi-heure-en-cours', lettre: 'B', fichier: APP, de: '  return minute > plancher + 1e-9 ? minute : null;', vers: '  return null;' },
  { nom: 'maintenant-a-la-demi-heure', lettre: 'B', fichier: APP, de: '  const maintenant = rvMinuteDeMaintenant(id) ?? rvPlancherDuJour(s.date);', vers: '  const maintenant = rvPlancherDuJour(s.date);' },
  // [C] le retard pose a la main tient le bowling d un groupe arrive pour commence (la panne du gerant) ; la coche
  // « fait » oubliee (un bowling lance bougerait).
  { nom: 'retard-a-la-main-fige', lettre: 'C', serveur: true, ...RETARD_FIGE },
  { nom: 'coche-ignoree', lettre: 'C', serveur: true, fichier: LIB, de: '  const gelees = new Set([...faites, ...faitesDuDossier(current)]);', vers: '  const gelees = new Set(faites);' },
  // [D] la carte en retard sans son rouge ; arrivee en retard sans cadre ; l ambre garde ; les minutes cachees ou
  // figees ; le laser sans rouge ; le laser arrive en retard muet.
  { nom: 'carte-sans-rouge', lettre: 'D', fichier: CSS, de: 'html[data-theme] .booking.is-en-retard { --bk-haut: var(--danger-soft);', vers: 'html[data-theme] .booking.is-en-retard { --bk-haut-x: var(--danger-soft);' },
  { nom: 'arrive-sans-cadre', lettre: 'D', fichier: APP, de: "      const arriveEnRetard = retardBloc && retardBloc.etat === 'arrive' ? ' is-rt-arrive' : '';", vers: "      const arriveEnRetard = '';" },
  { nom: 'ambre-garde', lettre: 'D', fichier: APP, de: "      const delayedClass = getReservationDelayFlag(r) && !retardBloc ? ' is-delayed' : '';", vers: "      const delayedClass = getReservationDelayFlag(r) ? ' is-delayed' : '';" },
  { nom: 'minutes-cachees', lettre: 'D', fichier: CSS, de: '.booking .bk-rt .bk-rt__court { display: inline;', vers: '.booking .bk-rt .bk-rt__court { display: none;' },
  { nom: 'minutes-figees', lettre: 'D', fichier: APP, de: '    const n = minutesDuRetard(rt, maintenant);\n    const prevu = Number.isFinite(rt.prevu)', vers: '    const n = Math.max(1, rt.annonce);\n    const prevu = Number.isFinite(rt.prevu)' },
  { nom: 'laser-sans-rouge', lettre: 'D', fichier: CSS, de: '.lp .lp-g.is-retard:not(.is-choisi), .lp-compact .lp-g.is-retard:not(.is-choisi) { background: var(--danger-soft);', vers: '.lp .lp-g.is-retard:not(.is-choisi), .lp-compact .lp-g.is-retard:not(.is-choisi) { background: transparent;' },
  { nom: 'laser-arrive-muet', lettre: 'D', fichier: APP, de: "    const statut = retardBloc ? retardBloc.long : r.status === 'paid' ? 'Payé' : r.status === 'arrived' ? 'Arrivé' : 'Confirmé';", vers: "    const statut = r.status === 'paid' ? 'Payé' : enRetard ? 'En retard' : r.status === 'arrived' ? 'Arrivé' : 'Confirmé';" },
];

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : un fil par mutation, l un apres l autre (un seul navigateur a la fois sur la machine).
// ---------------------------------------------------------------------------
function lancer(args, port) {
  return new Promise((ok) => {
    const fil = spawn(process.execPath, [__filename, ...args], { cwd: ROOT, env: { ...process.env, PINLANE_RETARDS_PLANNING_PORT: String(port) } });
    let sortie = '';
    fil.stdout.on('data', (d) => { sortie += d; });
    fil.stderr.on('data', (d) => { sortie += d; });
    const garde = setTimeout(() => fil.kill(), 600000);
    fil.on('close', (code) => { clearTimeout(garde); ok({ code, sortie }); });
  });
}

if (argument('contre-preuves')) {
  (async () => {
    const temoin = await lancer([], PORT);
    if (temoin.code !== 0) {
      console.log(temoin.sortie.split('\n').filter((l) => /ROUGE|Error|erreur/.test(l)).slice(0, 12).join('\n'));
      console.log('\nretards-planning-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
      process.exit(1);
    }
    const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
    const file = MUTATIONS.filter((m) => !voulues || voulues.includes(m.nom));
    let rates = 0;
    for (const m of file) {
      // eslint-disable-next-line no-await-in-loop
      const r = await lancer([`--mutation=${m.nom}`, `--seul=${m.lettre}`], PORT + 1);
      const mord = r.code === 1 && r.sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION|ancre absente/.test(r.sortie);
      if (!mord) rates += 1;
      console.log(`${mord ? 'TUEE   ' : 'VIVANTE'} ${m.nom} (attendu : ROUGE [${m.lettre}], sortie ${r.code})${mord ? '' : `\n${r.sortie.split('\n').filter((l) => /ROUGE|ANCRE|ancre|Error/.test(l)).slice(0, 6).join('\n')}`}`);
    }
    console.log(rates
      ? `\nretards-planning-check --contre-preuves: ${rates} mutation(s) vivante(s)`
      : `\nretards-planning-check --contre-preuves: ALL OK - ${file.length} mutations, chaque regle retiree fait rougir sa lettre`);
    process.exit(rates ? 1 : 0);
  })();
} else {
  principal().catch((error) => { console.error(error); process.exit(1); });
}

async function principal() {
  const nomMutation = typeof argument('mutation') === 'string' ? argument('mutation') : '';
  const mutation = nomMutation ? MUTATIONS.find((m) => m.nom === nomMutation) : null;
  if (nomMutation && !mutation) { console.error(`mutation inconnue : ${nomMutation}`); process.exit(2); }
  // LA CONSOLE D AVANT (--avant) : les fichiers servis tels qu au commit d avant, pour les captures.
  const avant = new Map();
  const texteAvant = (rel) => {
    if (!avant.has(rel)) avant.set(rel, execFileSync('git', ['show', `${COMMIT_AVANT}:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    return avant.get(rel);
  };
  // La console mutee : le texte servi au navigateur. L ancre doit exister une fois, sinon la contre-preuve ne prouverait rien.
  const transformer = (rel, texte) => {
    if (AVANT && [APP, PG, PGC, CSS].includes(rel)) return texteAvant(rel);
    if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
    const t = lf(texte);
    if (t.split(mutation.de).length !== 2) { console.log(`ANCRE DE MUTATION absente ou multiple (${mutation.nom}) dans ${rel}`); process.exit(2); }
    return t.split(mutation.de).join(mutation.vers);
  };
  if (mutation && !mutation.serveur) transformer(mutation.fichier, fs.readFileSync(path.join(ROOT, mutation.fichier), 'utf8'));

  // La base en memoire et le faux 'pg' s installent au require ; le serveur (mute ou non) se monte avant tout autre
  // require du depot.
  const CB = require('./comptoir-banc.js');
  const { B, FX } = CB;
  const editionsServeur = [
    ...(mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : []),
    ...(AVANT ? [{ fichier: RETARD_FIGE.fichier, de: RETARD_FIGE.de, vers: RETARD_FIGE.vers }] : []),
  ];
  const serveur = CB.monterServeur({ mutations: editionsServeur });
  // L heure du serveur des retards : celle que le gate pose (lib/retard-arrivee.js, son horloge reglable).
  const horlogeRetard = require(path.join(ROOT, LIB)).__horloge;
  horlogeRetard.instant = () => new Date(globalThis.__comptoirMaintenant || Date.now());
  const JOUR = CB.JOUR;

  let rouges = 0;
  let lettre = '';
  const section = (titre) => { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); };
  const ok = (condition, quoi, detail) => {
    if (condition) { console.log(`ok    ${quoi}`); return; }
    rouges += 1;
    console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}` : ''}`);
  };
  const planDe = (id) => { const row = B.base.reservations.get(Number(id)); const p = row && row.ops_plan; return typeof p === 'string' ? JSON.parse(p) : (p || {}); };
  // « B15:10-16:10:6.7 L16:15-16:40 » : les jeux du dossier en base.
  const jeux = (id) => (planDe(id).resourceBlocks || []).map((b) => `${b.activityId === 'bowling' ? 'B' : b.activityId === 'laser_game' ? 'L' : b.activityId}${String(b.startTime).slice(0, 5)}-${String(b.endTime).slice(0, 5)}${b.lanes && b.lanes.length ? `:${b.lanes.join('.')}` : ''}`).sort().join(' ');
  const version = (id) => new Date(B.base.reservations.get(Number(id)).updated_at).toISOString();
  const photo = (id) => { const row = B.base.reservations.get(Number(id)); return JSON.stringify({ statut: row.status, heure: row.start_time, pistes: row.lanes, jeux: jeux(id), retard: planDe(id).delayFlag || null }); };

  // UNE CAPTURE : la region donnee, 900 px de large au plus, dans l ecran.
  async function capturer(page, nom, rect) {
    if (!AVEC_CAPTURES || !rect) return;
    fs.mkdirSync(CAPTURES, { recursive: true });
    const vue = page.viewportSize();
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const clip = { x, y, width: Math.max(1, Math.min(900, Math.ceil(rect.width), vue.width - x)), height: Math.max(1, Math.min(Math.ceil(rect.height), vue.height - y)) };
    await page.screenshot({ path: path.join(CAPTURES, `${nom}-${AVANT ? 'avant' : 'apres'}.png`), clip });
    console.log(`capture  ${nom}-${AVANT ? 'avant' : 'apres'}.png (${clip.width} x ${clip.height})`);
  }
  // La boite qui couvre ces elements, avec une marge.
  const boite = (page, selecteurs, marge = 12) => page.evaluate(({ sel, m }) => {
    const r = sel.map((s) => document.querySelector(s)).filter(Boolean).map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.height);
    if (!r.length) return null;
    const x = Math.min(...r.map((b) => b.left)) - m;
    const y = Math.min(...r.map((b) => b.top)) - m;
    return { x, y, width: Math.max(...r.map((b) => b.right)) + m - x, height: Math.max(...r.map((b) => b.bottom)) + m - y };
  }, { sel: selecteurs, m: marge });

  let browser = null;
  let http = null;
  // LA CONSOLE OUVERTE SUR LE SAMEDI A 15:10 (scripts/comptoir-banc.js) : la meme journee en base et a l ecran ;
  // `changer` reecrit des dossiers des deux cotes avant le premier rendu.
  async function ouvrir(changer = null) {
    const m = await CB.ouvrirConsole(browser, serveur, { port: PORT, reservations: changer ? (liste) => changer(liste.map((r) => JSON.parse(JSON.stringify(r)))) : null });
    if (changer) {
      // (la page part de la fixture : les dossiers changes s y posent aussi, a l identique de la base)
      const dossiers = changer(CB.FX.lireFixture('pic').staffState.reservations.map((r) => JSON.parse(JSON.stringify(r))));
      await m.page.evaluate((liste) => {
        const parId = new Map(liste.map((r) => [r.id, r]));
        const jour = window.__FIXTURE__.jour;
        window.__FIXTURE__.jours[jour] = window.__FIXTURE__.jours[jour].map((r) => (parId.has(r.id) ? { ...r, ...parId.get(r.id), name: r.name } : r));
        state.reservations = state.reservations.map((r) => (parId.has(r.id) ? { ...r, ...parId.get(r.id), name: r.name } : r));
        renderStaff();
      }, dossiers);
      await FX.repos(m.page, 300);
    }
    return m;
  }
  const vue = async (page, quoi) => { await page.evaluate((v) => setStaffResourceView(v), quoi); await FX.repos(page, 400); };
  // Un retard note, tel que le serveur l ecrit (lib/delay-flag.js) : le sien, ou celui d un autre groupe qui l a pousse.
  const retardNote = (r, minutes, de, source = r.id) => {
    const [h, mi] = de.split(':').map(Number);
    const a = h * 60 + mi + minutes;
    r.opsPlan = { ...(r.opsPlan || {}), delayFlag: { minutes, from: de, to: `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`, sourceId: source, cleared: false, appliedAt: '2027-01-16T14:00:00.000Z' } };
    return r;
  };

  try {
    if (!SERVEUR_SEUL) {
      const { chromium } = require('playwright-core');
      http = await FX.servir({ port: PORT, transformer });
      browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
    }

    // =======================================================================
    if (joue('A') && !SERVEUR_SEUL) {
      section('[A] LE PETIT CARRE SE DIT EN MOTS : « à lancer », « à cocher », et sa bulle');
      // Les Amis de Clara pointes arrives (bowling 15:00, pistes 6-7) : a 15:10 leur bowling attend sa coche.
      const { ctx, page, erreurs } = await ouvrir((liste) => liste.map((r) => (r.id === CLARA ? { ...r, status: 'arrived' } : r)));
      try {
        const caseDe = (id, titre) => page.evaluate(({ id: i, titre: t }) => {
          const r = document.querySelector(`.gf-r[data-gf-id="${i}"]`);
          const c = r && r.querySelector(`.gf-a[data-gf-titre="${t}"]`);
          const x = c && c.querySelector('.gf-x');
          if (!x) return null;
          const vu = (e) => Boolean(e) && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
          const mot = x.querySelector('.gf-x__attend');
          return { classe: x.className, carre: vu(x.querySelector('.gf-x__ac')), mot: vu(mot) ? mot.textContent.trim() : '', bulle: x.getAttribute('title') || '' };
        }, { id: String(id), titre });
        const clara = await caseDe(CLARA, 'Bowling');
        const arthur = await caseDe(ARTHUR, 'Bowling');
        const sacha = await caseDe(SACHA, 'Bowling');
        ok(clara && /is-lancer/.test(clara.classe) && clara.mot === 'à lancer' && /à lancer, pas encore coché : la case se coche dans la fiche du groupe/.test(clara.bulle),
          '[A] Amis de Clara, la, bowling de 15:00 : sous la case, « à lancer », et la bulle dit ou se pose la coche', clara);
        ok(arthur && /is-acocher/.test(arthur.classe) && arthur.mot === 'à cocher' && /pas encore coché : la case se coche dans la fiche du groupe/.test(arthur.bulle),
          '[A] Anniversaire Arthur, la, bowling de 13:30 passe sans coche : « à cocher »', arthur);
        ok(sacha && !sacha.carre && !sacha.mot, '[A] Anniversaire Sacha, pas encore la : ni case ni mot', sacha);
        await page.evaluate((id) => document.querySelector(`.gf-r[data-gf-id="${id}"]`).scrollIntoView({ block: 'center' }), String(CLARA));
        await FX.repos(page, 200);
        const ligne = await page.evaluate((id) => {
          const r = document.querySelector(`.gf-r[data-gf-id="${id}"]`);
          const c = r.querySelector('.gf-a[data-gf-titre="Bowling"]');
          const a = r.getBoundingClientRect();
          const b = c.getBoundingClientRect();
          const gauche = Math.max(a.left, b.right - 900 + 10);
          return { x: gauche, y: a.top - 6, width: b.right + 10 - gauche, height: a.height + 12 };
        }, String(CLARA));
        await capturer(page, '1-carre', ligne);
        // La meme case a la carte du planning bowling.
        await vue(page, 'bowling');
        const carte = await page.evaluate((id) => {
          const c = document.querySelector(`#planningGridWrap .booking[data-booking-res-id="${id}"]`);
          const t = c && c.querySelector('.bk-time');
          return c ? { classes: c.className, bulle: t ? t.getAttribute('title') || '' : '' } : null;
        }, String(CLARA));
        ok(carte && /is-a-cocher/.test(carte.classes) && /^À lancer, pas encore coché : la case se coche dans la fiche du groupe/.test(carte.bulle),
          '[A] au planning bowling, la case devant l heure de la carte porte la meme bulle', carte);
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (A)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('B') && !SERVEUR_SEUL) {
      section('[B] RESERVER MAINTENANT PART DE LA MINUTE QU IL EST');
      // (la piste 8 libre de 15:00 a 17:00 : la Famille Henrard n est pas dans cette journee)
      const { ctx, page, erreurs, avant } = await ouvrir((liste) => liste.filter((r) => r.id !== HENRARD));
      try {
        const texte = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }, sel);
        const planPose = () => page.waitForFunction(() => {
          const b = document.getElementById('rvCreer');
          if (!b || /cherche|Création/.test(b.textContent) || /cherche/.test((document.getElementById('rvVerdict') || {}).textContent || '')) return false;
          return b.dataset.pret === '1' || Boolean(b.dataset.proche) || Boolean(document.getElementById('rvRefus'));
        }, null, { timeout: 10000 }).catch(() => {});
        await page.evaluate(() => reserverAuComptoir({ type: 'bowling', pax: 4 }));
        await planPose();
        await page.waitForFunction(() => document.querySelectorAll('#quickBookOverlay #rsZ-bowling .rs-h[data-heure]').length > 2, null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
        const creer = await texte('#rvCreer');
        const pretB = await page.evaluate(() => { const b = document.getElementById('rvCreer'); return Boolean(b && b.dataset.pret === '1'); });
        const seances = await page.evaluate(() => [...document.querySelectorAll('#quickBookOverlay #rsZ-bowling .rs-h[data-heure]')].map((b) => ({ h: b.dataset.heure, tag: ((b.querySelector('.rs-h-tag') || {}).textContent || '').trim() })));
        ok(/Créer à 15:10/.test(creer) && pretB, '[B] a 15:10, un bowling pour 4 s ouvre sur « Créer à 15:10 », pas 15:00', `${creer} | pret ${pretB}`);
        const maintenant = seances.find((x) => x.h === '15:10');
        const quinze = seances.find((x) => x.h === '15:00');
        ok(maintenant && maintenant.tag === 'maintenant' && (!quinze || quinze.tag !== 'maintenant'), '[B] la touche de 15:10 dit « maintenant », celle de 15:00 non', seances.slice(0, 4));
        const apres = seances.filter((x) => x.h > '15:10');
        ok(apres.length > 3 && apres.every((x) => /:(00|30)$/.test(x.h)), '[B] les heures d apres restent rondes (15:30, 16:00...)', apres.slice(0, 5).map((x) => x.h));
        await capturer(page, '2-maintenant', await boite(page, ['#quickBookOverlay .qb-modal'], 0));
        // Le dossier nait a 15:10, arrive.
        const tel = await page.evaluate(() => { const c = document.getElementById('qbPhone'); return Boolean(c) && !c.value.trim(); });
        if (tel) await page.fill('#qbPhone', '0470 12 34 56');
        await page.locator('#rvCreer').click();
        await page.waitForFunction(() => document.getElementById('quickBookOverlay').classList.contains('hidden'), null, { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(300);
        const neuf = [...B.base.reservations.keys()].find((id) => !avant.has(id));
        const row = neuf ? B.base.reservations.get(neuf) : null;
        ok(row && String(row.start_time).slice(0, 5) === '15:10' && row.status === 'arrived' && /^B15:10-16:10:\d$/.test(jeux(neuf)),
          '[B] le dossier nait a 15:10, son bowling de 15:10 a 16:10, arrive', row ? { heure: row.start_time, statut: row.status, jeux: jeux(neuf) } : 'aucun dossier cree');
        // Le laser garde ses departs.
        await page.evaluate(() => reserverAuComptoir({ type: 'laser', pax: 4 }));
        await planPose();
        const laser = await texte('#rvCreer');
        const heureLaser = (laser.match(/\d\d:\d\d/) || [''])[0];
        ok(heureLaser > '15:10' && /:(00|30)$/.test(heureLaser), '[B] le laser garde ses departs : une demi-heure apres 15:10', laser);
        await page.evaluate(() => closeQuickBook());
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (B)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('C')) {
      section('[C] LE RETARD POSE A LA MAIN DECALE LE GROUPE, SANS ECRASER LES AUTRES (le serveur)');
      // Une soiree posee le samedi, a 20:16 : la Famille Maintenant, creee a 20:16 pour 20:00, est nee arrivee.
      globalThis.__comptoirMaintenant = FX.instant(JOUR, '20:16').getTime();
      const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
      const enHeure = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const bowling = (debut, pistes, joueurs = 4) => ({ ...CB.blocBowling(debut, 60, pistes, joueurs), start: enMin(debut), end: enMin(debut) + 60 });
      const laser = (debut, joueurs) => ({ ...CB.blocLaser(debut, joueurs), groupWaveIndex: 1 });
      const dossier = (id, nom, { status = 'pending', blocs, pax = 4, progres = {} }) => {
        const debut = Math.min(...blocs.map((b) => b.start));
        const fin = Math.max(...blocs.map((b) => b.end));
        const pistes = [...new Set(blocs.flatMap((b) => b.lanes || []))].sort((a, b) => a - b);
        const avecLaser = blocs.some((b) => b.activityId === 'laser_game');
        return B.ligne(id, {
          date: JOUR, name: nom, start_time: enHeure(debut), duration: 1, total_duration: (fin - debut) / 60, lanes: pistes, pax, status,
          type: avecLaser ? 'visite' : 'bowling', label: avecLaser ? 'Bowling 1h · Laser 1 partie' : 'Bowling',
          program: avecLaser ? { items: [{ activityId: 'bowling', duration: 1, participants: pax }, { activityId: 'laser_game', games: 1, participants: pax }] } : null,
          ops_plan: { startTime: enHeure(debut), endTime: enHeure(fin), resourceBlocks: blocs, timeline: blocs.map((b) => ({ ...b })), conflicts: [], assignedLanes: pistes },
          activity_progress: progres,
        });
      };
      B.semer([
        dossier(700, 'Famille Maintenant', { status: 'arrived', pax: 6, blocs: [bowling('20:00', [1], 6), laser('21:00', 6)] }),
        dossier(701, 'Groupe suivant piste 1', { blocs: [bowling('21:30', [1])] }),
        dossier(702, 'Famille Piste Prise', { status: 'arrived', blocs: [bowling('20:00', [2])] }),
        dossier(703, 'Groupe de 21:00 piste 2', { blocs: [bowling('21:00', [2])] }),
        dossier(704, 'Famille Lancee', { status: 'arrived', blocs: [bowling('20:00', [3])], progres: { 'bowling-1': { done: true, at: '2027-01-16T19:01:00.000Z' } } }),
        dossier(705, 'Famille Attendue', { blocs: [bowling('20:00', [4])] }),
      ]);
      const simuler = (id, minutes = 16) => serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', retard: { id, baseUpdatedAt: version(id), minutes, de: '20:00', faites: [] } });
      const dit = (rep) => ((rep.json && rep.json.etapes) || []).map((e) => `${e.cle} ${e.avant}>${e.apres} ${e.passe ? 'passe' : 'non'}`).join(' | ') || (rep.json && rep.json.refus ? `refus ${rep.json.refus.message}` : 'aucune etape');
      const autres = [701, 702, 703, 704, 705].map(photo).join('\n');
      const s700 = await simuler(700);
      ok(dit(s700) === 'bowling 20:00>20:16 passe | laser_game:1.1 21:00>21:16 passe',
        '[C] ne arrive a 20:16 pour 20:00, « Retard » +16 min : le bowling passe a 20:16 et le laser suit a 21:16', dit(s700));
      const p700 = await serveur.appeler('PATCH', '/api/staff-reservations', { id: 700, centerId: 'libramont', baseUpdatedAt: version(700), retard: { minutes: 16, de: '20:00', faites: [], choix: 'tout', cles: ['bowling', 'laser_game:1.1'], heures: {}, attendues: { bowling: '20:16', 'laser_game:1.1': '21:16' } } });
      const f700 = planDe(700).delayFlag || {};
      ok(p700.statut === 200 && jeux(700) === 'B20:16-21:16:1 L21:16-21:41' && Number(f700.minutes) === 16 && f700.from === '20:00',
        '[C] « Tout décaler » ecrit le bowling a 20:16, le laser a 21:16 et le retard de 16 min, en une ecriture', { statut: p700.statut, message: p700.json && p700.json.message, jeux: jeux(700), retard: f700 });
      ok([701, 702, 703, 704, 705].map(photo).join('\n') === autres, '[C] aucun autre groupe n est touche', [701, 702, 703, 704, 705].map(photo));
      // La piste reprise a 21:00 : la console le dit, rien ne s ecrit.
      const s702 = await simuler(702);
      const b702 = ((s702.json && s702.json.etapes) || []).find((e) => e.cle === 'bowling') || null;
      ok(b702 && b702.apres === '20:16' && b702.passe === false && String(b702.raison || '').length > 10 && Array.isArray(b702.libres) && b702.libres.length > 0 && b702.libres.every((h) => h >= '20:16'),
        '[C] la piste 2 reprise a 21:00 : « Ne passe pas », sa raison et des heures libres (jamais avant 20:16)', b702);
      const avant702 = photo(702);
      const p702 = await serveur.appeler('PATCH', '/api/staff-reservations', { id: 702, centerId: 'libramont', baseUpdatedAt: version(702), retard: { minutes: 16, de: '20:00', faites: [], choix: 'tout', cles: ['bowling'], heures: {}, attendues: { bowling: '20:16' } } });
      ok(p702.statut === 409 && photo(702) === avant702, '[C] « Tout décaler » refuse quand la piste est prise : rien ne s ecrit, ni l heure ni le retard', { statut: p702.statut, message: p702.json && p702.json.message });
      // Un bowling coche « fait » est lance : il ne bouge pas.
      const s704 = await simuler(704);
      ok(!((s704.json && s704.json.etapes) || []).some((e) => e.cle === 'bowling') && !(s704.json && s704.json.refus), '[C] un bowling coche « fait » ne bouge pas', dit(s704));
      // Un groupe attendu se decale comme avant.
      const s705 = await simuler(705);
      ok(dit(s705) === 'bowling 20:00>20:16 passe', '[C] un groupe attendu se decale comme avant', dit(s705));
    }

    if (joue('C') && !SERVEUR_SEUL) {
      section('[C] LE RETARD POSE A LA MAIN, A LA CONSOLE : la fenetre dit ce qui passe, et ce qui ne passe pas');
      const ouvrirLeRetard = async (page) => {
        await page.evaluate((id) => openPos(id), CLARA);
        await page.waitForSelector('#posOverlay .fx-outil-retard', { timeout: 12000 });
        await page.locator('#posOverlay .fx-outil-retard').click();
        await page.locator(`#fxRetard${CLARA} .delay-chip:not(.delay-chip-now)`, { hasText: '+10 min' }).click();
        await page.waitForFunction(() => { const e = document.querySelector('#retardFenetre .rt-etat'); return Boolean(e) && !/Vérification/.test(e.textContent); }, null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(200);
        return page.evaluate(() => {
          const f = document.querySelector('#retardFenetre .rt-fenetre');
          if (!f) return null;
          return {
            etat: (f.querySelector('.rt-etat') || {}).textContent || '',
            etapes: [...f.querySelectorAll('.rt-etape')].map((li) => ({ cle: li.getAttribute('data-rt-cle'), mot: ((li.querySelector('.rt-etape__mot') || {}).textContent || '').trim(), heure: (li.querySelector('.rt-heure') || {}).value || ((li.querySelector('.rt-etape__heures b') || {}).textContent || ''), raison: ((li.querySelector('.rt-etape__raison') || {}).textContent || '').trim(), libres: li.querySelectorAll('.rt-libre').length })),
            choix: [...f.querySelectorAll('[data-rt-choix]')].map((b) => b.getAttribute('data-rt-choix')),
          };
        });
      };
      // Les Amis de Clara, crees a 15:10 pour 15:00, nes arrives ; la piste 6 libre apres 16:30 (Famille Noel absente).
      {
        const { ctx, page, erreurs } = await ouvrir((liste) => liste.filter((r) => r.id !== NOEL).map((r) => (r.id === CLARA ? { ...r, status: 'arrived' } : r)));
        try {
          const f = await ouvrirLeRetard(page);
          const b = f && f.etapes.find((e) => e.cle === 'bowling');
          ok(b && b.mot === 'Passe' && b.heure === '15:10' && f.choix.includes('tout'), '[C] la fenetre du retard de la fiche : « Bowling 15:00 → 15:10, Passe », et « Tout décaler »', f);
          await capturer(page, '3-retard-a-la-main', await boite(page, ['#retardFenetre .rt-fenetre'], 0));
          if (f && f.choix.includes('tout')) {
            await page.locator('#retardFenetre [data-rt-choix="tout"]').click();
            for (let i = 0; i < 60 && !planDe(CLARA).delayFlag; i += 1) await page.waitForTimeout(100);
            await page.waitForTimeout(400);
          } else {
            await page.evaluate(() => fermerFenetreRetard());
          }
          const flag = planDe(CLARA).delayFlag || {};
          ok(jeux(CLARA) === 'B15:10-16:40:6.7' && Number(flag.minutes) === 10, '[C] « Tout décaler » : le bowling part a 15:10, pistes 6-7, le retard note', { jeux: jeux(CLARA), retard: flag });
          await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
          await vue(page, 'bowling');
          const carte = await page.evaluate((id) => {
            const c = document.querySelector(`#planningGridWrap .booking[data-booking-res-id="${id}"]`);
            const p = c && c.querySelector('.bk-rt');
            return c ? { classes: c.className, depart: Number(c.dataset.bookingStart), puce: p ? p.innerText.replace(/\s+/g, ' ').trim() : '' } : null;
          }, String(CLARA));
          ok(carte && Math.abs(carte.depart - (15 + 10 / 60)) < 0.01 && /is-rt-arrive/.test(carte.classes) && /10 min/.test(carte.puce),
            '[C] au planning bowling, la carte part a 15:10, cadre rouge, « 10 min » de retard', carte);
          ok(erreurs.length === 0, '[*] zero erreur JavaScript (C, passe)', erreurs.slice(0, 3).join(' | '));
        } finally { await ctx.close(); }
      }
      // La piste 6 reprise a 16:30 par la Famille Noel : la fenetre le dit, avec les heures libres.
      {
        const { ctx, page, erreurs } = await ouvrir((liste) => liste.map((r) => (r.id === CLARA ? { ...r, status: 'arrived' } : r)));
        try {
          const f = await ouvrirLeRetard(page);
          const b = f && f.etapes.find((e) => e.cle === 'bowling');
          ok(b && b.mot === 'Ne passe pas' && /15:00/.test(b.raison) && b.libres > 0 && !f.choix.includes('tout'),
            '[C] la piste 6 reprise a 16:30 : « Ne passe pas », la raison, « Reste à 15:00 » et les heures libres, jamais « Tout décaler »', f);
          await capturer(page, '3-retard-ne-passe-pas', await boite(page, ['#retardFenetre .rt-fenetre'], 0));
          await page.evaluate(() => fermerFenetreRetard());
          ok(erreurs.length === 0, '[*] zero erreur JavaScript (C, ne passe pas)', erreurs.slice(0, 3).join(' | '));
        } finally { await ctx.close(); }
      }
    }

    // =======================================================================
    if (joue('D') && !SERVEUR_SEUL) {
      section('[D] LE RETARD SE VOIT EN ROUGE, AU PLANNING BOWLING ET AU PLANNING LASER');
      // A 15:10 : Amis de Clara attendus (+10 min) ; Famille Pirotte arrivee avec 9 min de retard ; Famille Gerard poussee
      // par le retard de Clara (pas en retard) ; Jules attendus au laser depuis 14:00 ; Lina arrivee avec 7 min de retard.
      const { ctx, page, erreurs } = await ouvrir((liste) => liste.map((r) => {
        if (r.id === PIROTTE) return retardNote({ ...r, status: 'arrived' }, 9, '14:30');
        if (r.id === GERARD) return retardNote(r, 15, '16:00', CLARA);
        if (r.id === LINA) return retardNote(r, 7, '15:00');
        return r;
      }));
      try {
        const sonde = () => page.evaluate(() => {
          const s = document.createElement('div');
          s.style.background = 'var(--danger-soft)';
          s.style.color = 'var(--danger)';
          document.body.appendChild(s);
          const lu = { pale: getComputedStyle(s).backgroundColor, rouge: getComputedStyle(s).color };
          s.remove();
          return lu;
        });
        const carte = (id) => page.evaluate((i) => {
          const c = document.querySelector(`#planningGridWrap .booking[data-booking-res-id="${i}"]`);
          if (!c) return null;
          const p = c.querySelector('.bk-rt');
          const cs = getComputedStyle(c);
          return { classes: c.className, fond: cs.backgroundColor, ombre: cs.boxShadow, puce: p ? p.innerText.replace(/\s+/g, ' ').trim() : '', bulle: p ? p.getAttribute('title') || '' : '', ambre: Boolean(c.querySelector('.delay-indicator:not(.bk-rt)')) };
        }, String(id));
        await vue(page, 'bowling');
        const { pale, rouge } = await sonde();
        const clara = await carte(CLARA);
        ok(clara && /is-en-retard/.test(clara.classes) && clara.fond === pale && clara.ombre.includes(rouge),
          '[D] bowling, Amis de Clara en retard : toute la carte rouge pale, cernee de rouge', { clara, pale, rouge });
        ok(clara && /\b10 min\b/.test(clara.puce) && clara.bulle === 'En retard de 10 min, prévu à 15:00', '[D] sa puce dit les minutes, « 10 min », la bulle « En retard de 10 min, prévu à 15:00 »', clara);
        const pirotte = await carte(PIROTTE);
        ok(pirotte && /is-rt-arrive/.test(pirotte.classes) && !/is-delayed|is-en-retard/.test(pirotte.classes) && pirotte.ombre.includes(rouge) && /9 min/.test(pirotte.puce) && pirotte.bulle.startsWith('Arrivé avec 9 min de retard, prévu à 14:30'),
          '[D] Famille Pirotte arrivee avec 9 min de retard : cadre rouge, « 9 min », jamais l ambre', pirotte);
        const gerard = await carte(GERARD);
        ok(gerard && /is-delayed/.test(gerard.classes) && !/is-en-retard|is-rt-arrive/.test(gerard.classes) && gerard.ambre && !gerard.puce,
          '[D] Famille Gerard, poussee par le retard de Clara : pas en retard, sa puce ambre', gerard);
        const sacha = await carte(SACHA);
        ok(sacha && !/is-en-retard|is-rt-arrive/.test(sacha.classes) && !sacha.ombre.includes(rouge) && !sacha.puce, '[D] Anniversaire Sacha, a l heure : aucun rouge', sacha);
        await page.evaluate((id) => document.querySelector(`#planningGridWrap .booking[data-booking-res-id="${id}"]`).scrollIntoView({ block: 'center' }), String(CLARA));
        await FX.repos(page, 200);
        await capturer(page, '4-retard-bowling', await boite(page, [`#planningGridWrap .booking[data-booking-res-id="${PIROTTE}"]`, `#planningGridWrap .booking[data-booking-res-id="${CLARA}"]`, `#planningGridWrap .booking[data-booking-res-id="${GERARD}"]`], 14));

        // Le laser.
        await vue(page, 'laser');
        const groupe = (id) => page.evaluate((i) => {
          const c = document.querySelector(`#laserPlanningGridWrap .lp-g[data-laser-res-id="${i}"]`);
          if (!c) return null;
          const cs = getComputedStyle(c);
          return { classes: c.className, fond: cs.backgroundColor, ombre: cs.boxShadow, etat: ((c.querySelector('.lp-card-status') || {}).textContent || '').trim(), bulle: c.getAttribute('title') || '' };
        }, String(id));
        const jules = await groupe(JULES);
        ok(jules && /is-retard/.test(jules.classes) && jules.fond === pale && jules.ombre.includes(rouge) && jules.etat === 'En retard · 1 h 10',
          '[D] laser, Jules attendus depuis 14:00 : la carte rouge pale, cernee, « En retard · 1 h 10 »', jules);
        const lina = await groupe(LINA);
        ok(lina && /is-rt-arrive/.test(lina.classes) && lina.ombre.includes(rouge) && lina.etat === 'Arrivé avec 7 min de retard' && /Arrivé avec 7 min de retard, prévu à 15:00/.test(lina.bulle),
          '[D] laser, Lina arrivee avec 7 min de retard : le cadre rouge et « Arrivé avec 7 min de retard »', lina);
        const manon = await groupe(MANON);
        ok(manon && !/is-retard|is-rt-arrive/.test(manon.classes) && !manon.ombre.includes(rouge), '[D] laser, Amis de Manon a l heure : aucun rouge', manon);
        await page.evaluate((id) => document.querySelector(`#laserPlanningGridWrap .lp-g[data-laser-res-id="${id}"]`).scrollIntoView({ block: 'center' }), String(JULES));
        await FX.repos(page, 200);
        await capturer(page, '4-retard-laser', await boite(page, [`#laserPlanningGridWrap .lp-g[data-laser-res-id="${JULES}"]`, `#laserPlanningGridWrap .lp-g[data-laser-res-id="${LINA}"]`], 40));

        // Les minutes courent : 15:11, la carte de Clara dit 11 min.
        await vue(page, 'bowling');
        await page.clock.setFixedTime(FX.instant(JOUR, '15:11'));
        await page.evaluate(() => tickStaffMinute());
        await FX.repos(page, 300);
        const onze = await carte(CLARA);
        ok(onze && /\b11 min\b/.test(onze.puce) && onze.bulle === 'En retard de 11 min, prévu à 15:00', '[D] la minute passe : « 11 min »', onze);
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (D)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }
  } catch (error) {
    ok(false, `exception : ${error.message}`, String(error.stack || '').split('\n').slice(0, 4).join(' | '));
  } finally {
    if (browser) await browser.close();
    if (http) http.close();
  }

  if (AVANT) {
    console.log(`\nretards-planning-check --avant: captures posees sur le code de ${COMMIT_AVANT} (${rouges} rouge(s) attendu(s), sans verdict)`);
    process.exit(0);
  }
  console.log(rouges
    ? `\nretards-planning-check: ${rouges} ROUGE(S)`
    : '\nretards-planning-check: ALL OK - la case vide se dit en mots, Reserver part de la minute, le retard pose a la main decale et le retard se voit en rouge au bowling et au laser');
  process.exit(rouges ? 1 : 0);
}

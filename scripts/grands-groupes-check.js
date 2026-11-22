'use strict';
// UN GRAND GROUPE AU COMPTOIR (2026-11-22, lib/grand-groupe.js).
//
// Ansar : « Quand ya grand groupe et qu'on réserve sur côté staff logiciel avec réservation par exemple 60
// personne pour bowling il gère pas dutout genre il est comme l'autre qui sait diviser groupe etc pour multi
// activité en plus etc ». La fenetre Reserver envoyait 60 joueurs au bowling comme UN service : dix pistes
// sur huit, chaque heure refusee. Le formulaire en ligne, lui, coupe le groupe sur la place du centre. Ce
// gate joue la VRAIE console (scripts/planning-v3-fixtures.js), le VRAI handler api/staff-reservations.js et
// le vrai moteur (scripts/reserver-banc.js, base en memoire), avec de vrais clics a 1366 x 768, et verifie
// toujours le dossier cree en base, pas seulement l ecran :
//   [A] 60 JOUEURS AU BOWLING SEUL, un dimanche vide : deux groupes l un apres l autre, cinq pistes cote a
//       cote chacun, 390 € ; le planning et la fiche disent « groupe 1 » et « groupe 2 ».
//   [B] 60 JOUEURS AU BOWLING ET AU LASER : deux groupes de 30 qui tournent (le groupe 1 au bowling pendant
//       que le groupe 2 joue au laser, puis ils echangent), 990 €. La page des groupes montre le plan d un
//       coup d oeil et tient a l ecran ; l activite du groupe 1 se change d un toucher et le moteur
//       recalcule ; une taille ne depasse jamais les 30 armes ; planning et fiche par groupe ; « Ils sont
//       58 » a l arrivee refait le plan, les deux groupes et leur ordre restent.
//   [C] LE PLAN IMPOSSIBLE : 60 joueurs a 15:30 un jour ou le laser de 16:30 n a plus que 20 armes. La
//       rangee du bowling le dit (« laser, manque 10 armes »), le ticket aussi (« Laser à 16:30
//       impossible »), et « Prendre 17:30 » propose l heure ou tout le groupe tient ; un toucher, et le
//       dossier nait a 17:30. Rien ne part avant « Créer ».
//   [D] LE SERVEUR, sans navigateur : le prix suit les vrais joueurs de chaque activite (60 au bowling, 40 au
//       laser : 790 €) ; les tailles posees au comptoir (28 et 22) font les blocs et les pistes ; une taille
//       au-dessus des armes est refusee en le disant ; un autre centre se coupe sur sa propre place (Gembloux,
//       20 armes : 3 groupes de 20, deux au bowling en meme temps sur des pistes differentes) ; une
//       modification garde les groupes ; le canal public ne lit jamais la demande (le formulaire en ligne ne
//       change pas).
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` rejoue le gate sur du code casse expres, une mutation a la fois, en
// memoire (le serveur par le crochet de compilation du banc, la console par le serveur de fichiers), et
// exige que chacune rougisse sa lettre. Le disque n est jamais touche. `--seul=B` ne joue qu une lettre,
// `--captures` pose les ecrans dans captures-grands-groupes/ (jamais commites).
// Lancement : node scripts/grands-groupes-check.js [--contre-preuves] [--seul=A] [--captures]
// Zero reseau sortant, zero vraie base : rien ne part.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
const PORT = Number(process.env.PINLANE_GRANDS_GROUPES_PORT || 7741);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = path.join(ROOT, 'captures-grands-groupes');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const SEUL = typeof argument('seul') === 'string' ? argument('seul') : '';
const joue = (lettre) => !SEUL || SEUL === lettre;
const lf = (t) => String(t).split('\r\n').join('\n');

const APP = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const PLANNING = 'assets/pinlane-planning-global.js';
const MOTEUR = 'lib/ops-engine.js';
const GG = 'lib/grand-groupe.js';
const OPS = 'lib/reservation-ops.js';

// LES MUTATIONS : une regle retiree a la fois. `lettre` : le scenario qui doit rougir. `serveur` : le
// code passe par le crochet de compilation du banc, sinon la console le recoit du serveur de fichiers.
const MUTATIONS = [
  // [A] le bowling seul repart en un service (la panne d Ansar) ; le planning et la fiche oublient le groupe.
  { nom: 'bowling-en-un-service', lettre: 'A', fichier: APP, de: "  const programme = s.type === 'visite' || adaptee || rsFmActive(s) || Boolean(rvGrandGroupe());", vers: "  const programme = s.type === 'visite' || adaptee || rsFmActive(s);" },
  { nom: 'planning-sans-groupe', lettre: 'A', fichier: PLANNING, de: "      var groupe = e.groupe ? 'groupe ' + e.groupe : '';", vers: "      var groupe = '';" },
  { nom: 'fiche-sans-groupes', lettre: 'A', fichier: APP, de: "  const groupes = r.status === 'cancelled' ? null : sousGroupesDuDossier(r);", vers: '  const groupes = null;' },
  // [B] plus de rotation ; l activite du groupe 1 ne part pas ; une taille au-dela des armes ; la page deborde.
  { nom: 'sans-rotation', lettre: 'B', serveur: true, fichier: MOTEUR, de: "  const demandeGrandGroupe = input.channel === 'staff' ? lireGrandGroupe(preference.grandGroupe) : null;", vers: '  const demandeGrandGroupe = null;' },
  { nom: 'premier-oublie', lettre: 'B', fichier: APP, de: "  const premier = grand && grand.tourne && grand.ids.includes(voulu.premier) ? voulu.premier : '';", vers: "  const premier = '';" },
  { nom: 'tailles-sans-plafond', lettre: 'B', fichier: APP, de: '  return plafonds.length ? Math.min(...plafonds) : pax;', vers: '  return pax;' },
  { nom: 'groupes-qui-debordent', lettre: 'B', fichier: CSS, de: '.qb-modal.rv.rs .rs-gg-c { display: flex; flex-direction: column; justify-content: center; gap: 1px; min-width: 0; min-height: 52px;', vers: '.qb-modal.rv.rs .rs-gg-c { display: flex; flex-direction: column; justify-content: center; gap: 1px; min-width: 0; min-height: 220px;' },
  { nom: 'sous-groupe-a-deux-endroits', lettre: 'B', serveur: true, fichier: MOTEUR, de: '    const cle = Number(fenetre.sousGroupe) || 0;', vers: '    const cle = 0;' },
  { nom: 'compte-sans-groupes', lettre: 'B', serveur: true, fichier: OPS, de: '    ...(isEdit ? grandGroupeGarde(request) : {}),\n', vers: '' },
  // [C] la rangee se tait, la proche se cherche sur le laser, le refus dit l heure de la ligne.
  { nom: 'rangee-muette', lettre: 'C', fichier: APP, de: '  if (grand && grand.tourne && id === grand.ids[0]) return v;\n', vers: '' },
  { nom: 'proche-sur-le-laser', lettre: 'C', fichier: APP, de: '  const id = grand ? grand.ids[0] : ids.includes(refus.activite) ? refus.activite : ids[0];', vers: '  const id = ids.includes(refus.activite) ? refus.activite : ids[0];' },
  { nom: 'heure-de-la-ligne', lettre: 'C', fichier: APP, de: "  const heureDuGrand = grand ? ((/\\b(\\d{2}:\\d{2})\\b/.exec(raison) || [])[1] || s.startTime || '') : '';", vers: "  const heureDuGrand = '';" },
  // [D] le laser prend les tailles du groupe, les tailles posees sont ignorees, la capacite ne refuse plus,
  // la modification perd les groupes, le canal public lit la demande.
  { nom: 'laser-sur-les-tailles', lettre: 'D', serveur: true, fichier: GG, de: '    const parts = joueurs === personnes ? choisies.slice() : partsAuProrata(joueurs, choisies);', vers: '    const parts = choisies.slice();' },
  { nom: 'tailles-ignorees', lettre: 'D', serveur: true, fichier: GG, de: '    choisies = posees;\n', vers: '' },
  { nom: 'armes-depassees', lettre: 'D', serveur: true, fichier: GG, de: '    const trop = capacite > 0 ? parts.findIndex((part) => part > capacite) : -1;', vers: '    const trop = -1;' },
  { nom: 'modification-sans-groupes', lettre: 'D', serveur: true, fichier: OPS, de: '    ...(isEdit ? grandGroupeGarde(request) : {}),\n', vers: '' },
  { nom: 'public-lit-la-demande', lettre: 'D', serveur: true, fichier: MOTEUR, de: "  const demandeGrandGroupe = input.channel === 'staff' ? lireGrandGroupe(preference.grandGroupe) : null;", vers: '  const demandeGrandGroupe = lireGrandGroupe(preference.grandGroupe);' },
  { nom: 'pistes-du-groupe-partagees', lettre: 'D', serveur: true, fichier: MOTEUR, de: "      const occupees = dejaPoses.length ? [...reservations, pseudoReservationFromBlocks('grand-groupe', dejaPoses)] : reservations;", vers: '      const occupees = reservations;' },
];

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : un fil par mutation, trois a la fois, chacun sur son port.
// ---------------------------------------------------------------------------
function lancer(args, port) {
  return new Promise((ok) => {
    const fil = spawn(process.execPath, [__filename, ...args], { cwd: ROOT, env: { ...process.env, PINLANE_GRANDS_GROUPES_PORT: String(port) } });
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
      console.log('\ngrands-groupes-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
      process.exit(1);
    }
    const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
    const file = MUTATIONS.filter((m) => !voulues || voulues.includes(m.nom));
    let rates = 0;
    const POOL = 3;
    let suivant = 0;
    const travailleur = async (rang) => {
      while (suivant < file.length) {
        const m = file[suivant];
        suivant += 1;
        // eslint-disable-next-line no-await-in-loop
        const r = await lancer([`--mutation=${m.nom}`, `--seul=${m.lettre}`], PORT + 1 + rang);
        const mord = r.code === 1 && r.sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION|ancre absente/.test(r.sortie);
        if (!mord) rates += 1;
        console.log(`${mord ? 'TUEE   ' : 'VIVANTE'} ${m.nom} (attendu : ROUGE [${m.lettre}], sortie ${r.code})${mord ? '' : `\n${r.sortie.split('\n').filter((l) => /ROUGE|ANCRE|ancre|Error/.test(l)).slice(0, 6).join('\n')}`}`);
      }
    };
    await Promise.all(Array.from({ length: POOL }, (_, rang) => travailleur(rang)));
    console.log(rates
      ? `\ngrands-groupes-check --contre-preuves: ${rates} mutation(s) vivante(s)`
      : `\ngrands-groupes-check --contre-preuves: ALL OK - ${file.length} mutations, chaque regle retiree fait rougir sa lettre`);
    process.exit(rates ? 1 : 0);
  })();
} else {
  principal().catch((error) => { console.error(error); process.exit(1); });
}

async function principal() {
  const nomMutation = typeof argument('mutation') === 'string' ? argument('mutation') : '';
  const mutation = nomMutation ? MUTATIONS.find((m) => m.nom === nomMutation) : null;
  if (nomMutation && !mutation) { console.error(`mutation inconnue : ${nomMutation}`); process.exit(2); }
  // La console mutee : le texte servi au navigateur. L ancre doit exister une fois, sinon la contre-preuve
  // ne prouverait rien.
  const transformer = (rel, texte) => {
    if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
    const t = lf(texte);
    if (t.split(mutation.de).length !== 2) { console.log(`ANCRE DE MUTATION absente ou multiple (${mutation.nom}) dans ${rel}`); process.exit(2); }
    return t.split(mutation.de).join(mutation.vers);
  };
  if (mutation && !mutation.serveur) transformer(mutation.fichier, fs.readFileSync(path.join(ROOT, mutation.fichier), 'utf8'));

  // La base en memoire et le faux 'pg' s installent au require ; le serveur (mute ou non) se monte avant
  // tout autre require du depot.
  const B = require('./reserver-banc.js');
  const FX = require('./planning-v3-fixtures.js');
  const HORLOGE_SERVEUR = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };
  const serveur = B.monter({
    mutations: [HORLOGE_SERVEUR, ...(mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [])],
    session: B.sessionDuRole('direction', { nom: 'Accueil' }),
  });
  FX.APPAREILS.comptoir = FX.APPAREILS.comptoir || { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };

  let rouges = 0;
  let lettre = '';
  const section = (titre) => { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); };
  const ok = (condition, quoi, detail) => {
    if (condition) { console.log(`ok    ${quoi}`); return; }
    rouges += 1;
    console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500)}` : ''}`);
  };

  const HEURE = '15:10';
  function ligneDepuis(r) {
    return {
      id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: String(r.name).replace('DÉMO · ', ''), phone: r.phone || '', email: r.email || '',
      date: r.date, start_time: r.startTime, duration: r.duration, total_duration: r.totalDuration ?? r.duration, lanes: (r.lanes || []).map(Number),
      pax: r.pax, status: r.status, base_price: r.basePrice, price: r.price, type: r.type, formule_id: r.formuleId || null, label: r.label,
      occasion: r.occasion || '', extras: r.extras || [], payment_method: r.paymentMethod || null, notes: r.notes || '',
      ops_plan: r.opsPlan || null, risk_level: r.riskLevel || '', risk_score: r.riskScore ?? null, validation_status: r.validationStatus || 'confirmed',
      activity_progress: r.activityProgress || {}, program: r.program || null, companions: r.companions || 0,
      created_at: new Date(r.createdAt), updated_at: new Date(r.updatedAt),
      acquisition: r.acquisition ?? null, client_key: r.clientKey || '', paid_at: r.paidAt ? new Date(r.paidAt) : null,
      amount_paid: r.amountPaid ?? null, discount_reason: r.discountReason || '', absent_at: r.absentAt ? new Date(r.absentAt) : null,
    };
  }
  function semer(fixture) {
    const fx = FX.lireFixture(fixture);
    globalThis.__comptoirMaintenant = FX.instant(fx.staffState.date, HEURE).getTime();
    B.semer(fx.staffState.reservations.map(ligneDepuis));
    return fx;
  }
  const blocsDe = (r) => ((r && r.ops_plan && r.ops_plan.resourceBlocks) || []).filter((b) => ['bowling_lane', 'laser_arena'].includes(b.resourceType));
  const seSuivent = (l) => Array.isArray(l) && l.length > 0 && l.map(Number).sort((a, b) => a - b).every((p, i, t) => i === 0 || p === t[i - 1] + 1);
  const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
  // Un sous-groupe n est jamais a deux endroits : ses passages ne se chevauchent pas.
  const sansChevauchement = (blocs) => {
    const parGroupe = new Map();
    blocs.forEach((b) => { const n = Number(b.sousGroupe) || 0; if (!parGroupe.has(n)) parGroupe.set(n, []); parGroupe.get(n).push(b); });
    return [...parGroupe.values()].every((liste) => liste.sort((x, y) => enMin(x.startTime) - enMin(y.startTime))
      .every((b, i, t) => i === 0 || enMin(b.startTime) >= enMin(t[i - 1].endTime)));
  };
  const resume = (blocs) => blocs.map((b) => `${b.resourceType === 'bowling_lane' ? 'B' : 'L'}${b.sousGroupe || 0}@${b.startTime}x${b.players}${b.lanes && b.lanes.length ? `[${b.lanes.join(',')}]` : ''}`).sort().join(' ');

  // -------------------------------------------------------------------------
  // LA CONSOLE, sur une fixture : la session de direction, les appels du comptoir au vrai handler.
  // -------------------------------------------------------------------------
  let browser = null;
  async function ouvrir(fixture) {
    semer(fixture);
    const m = await FX.monter(browser, {
      fixture, appareil: 'comptoir', theme: 'light', port: PORT, heure: HEURE,
      avantChargement: async (page) => {
        await page.exposeFunction('__fixtureServeur', async (corps) => serveur.appeler('PATCH', '/api/staff-reservations', corps));
        await page.exposeFunction('__vraiAppel', async (methode, url, corps) => serveur.appeler(methode, url, corps));
      },
    });
    const { page } = m;
    page.setDefaultTimeout(12000);
    await page.evaluate(() => {
      const avant = window.fetch;
      window.__appels = [];
      window.fetch = async (input, init) => {
        init = init || {};
        const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
        const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
        const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
        if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
          const corps = init.body ? JSON.parse(init.body) : undefined;
          window.__appels.push({ me, dryRun: Boolean(corps && corps.dryRun) });
          const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
          const j = rep.json || {};
          if (me === 'POST' && !(corps && corps.dryRun) && j.reservation) {
            const jour = j.reservation.date;
            (window.__FIXTURE__.jours[jour] = window.__FIXTURE__.jours[jour] || []).push(j.reservation);
          }
          return json(j, rep.statut);
        }
        return avant(input, init);
      };
    });
    await page.waitForSelector('.btn-new', { timeout: 15000 });
    const avant = new Set([...B.base.reservations.keys()]);
    return { ...m, avant };
  }
  const texte = (page, sel) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);
  const capture = async (page, nom) => {
    if (!argument('captures')) return;
    fs.mkdirSync(CAPTURES, { recursive: true });
    await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  };
  // Le nombre tape dans « Autre », comme au comptoir, puis la tabulation qui le valide.
  async function soixante(page, n = 60) {
    await page.locator('.btn-new').first().click();
    await page.waitForSelector('#qbPax');
    await page.locator('#qbPax').click();
    await page.keyboard.type(String(n));
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => /groupes/.test((document.querySelector('#rsL-groupes') || {}).textContent || ''), null, { timeout: 12000 });
  }
  const pret = (page) => page.waitForFunction(() => { const b = document.querySelector('#rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 15000 });
  async function toucher(page, sel, attente = 0) {
    await page.locator(sel).first().click();
    if (attente) await page.waitForTimeout(attente);
  }
  async function nouveaux(page, avant) {
    for (let i = 0; i < 80; i += 1) {
      const lignes = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
      if (lignes.length) return lignes;
      await page.waitForTimeout(100);
    }
    return [];
  }
  async function creer(page, avant) {
    await page.locator('#qbPhone').fill('0470 12 34 56');
    await page.waitForTimeout(300);
    await pret(page);
    await toucher(page, '#rvCreer');
    const lignes = await nouveaux(page, avant);
    return lignes[0] || null;
  }
  // La ligne du dossier au planning : ce que chaque case dit au survol (« Bowling de 15:30 à 16:30 · groupe 1 »).
  async function casesDuPlanning(page, id) {
    await page.waitForSelector(`.gf-r[data-gf-id="${id}"]`, { timeout: 15000 });
    return page.evaluate((i) => Array.from(document.querySelectorAll(`.gf-r[data-gf-id="${i}"] .gf-x`)).map((x) => x.getAttribute('title') || ''), id);
  }
  async function ouvrirLaFiche(page, id) {
    await page.locator(`.gf-r[data-gf-id="${id}"] .gf-nom__t`).first().click();
    await page.waitForSelector('.fx-programme', { timeout: 15000 });
    await page.waitForTimeout(400);
    return {
      groupes: await texte(page, '#ficheGroupes'),
      programme: await texte(page, '.fx-programme'),
    };
  }
  // Reserver tient sur un ecran de 1366 x 768 (la mesure de scripts/comptoir-check.js) : la colonne de
  // gauche ne defile pas, la fenetre reste dans l ecran.
  const tientALEcran = (page) => page.evaluate(() => {
    const col = document.querySelector('#rsCol');
    const fenetre = document.querySelector('.qb-modal.rv.rs');
    const r = fenetre ? fenetre.getBoundingClientRect() : { top: -1, bottom: 1e6 };
    return { col: col ? col.scrollHeight - col.clientHeight : 99, dehors: r.top < 0 || r.bottom > window.innerHeight ? 1 : 0 };
  });

  const navigateur = ['A', 'B', 'C'].some(joue);
  if (navigateur) {
    const { chromium } = require('playwright-core');
    browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  }
  const http = navigateur ? await FX.servir({ port: PORT, transformer }) : null;
  try {
    // =======================================================================
    if (joue('A')) {
      section('[A] 60 JOUEURS AU BOWLING SEUL : DEUX GROUPES L UN APRES L AUTRE');
      const { ctx, page, erreurs, avant } = await ouvrir('vide');
      try {
        await soixante(page);
        await toucher(page, '.rs-seance [data-activite="bowling"][data-heure="15:30"]');
        await pret(page).catch(() => {});
        const groupes = await texte(page, '#rsL-groupes');
        const bowling = await texte(page, '#rsL-a-bowling');
        ok(/2 groupes, l’un après l’autre/.test(groupes) && /30 et 30 joueurs/.test(groupes), '[A] le ticket dit « 2 groupes, l’un après l’autre », 30 et 30 joueurs', groupes);
        ok(/Groupe 1 à 15:30, groupe 2 à 16:30/.test(bowling) && /pistes \d à \d/.test(bowling) && /390 €/.test(bowling), '[A] la ligne du bowling dit chaque groupe a son heure, ses pistes et 390 €', bowling);
        const creerDit = await texte(page, '#rvCreer');
        ok(/Créer à 15:30/.test(creerDit), '[A] « Créer à 15:30 » : le plan tient (dix pistes sur huit refusaient chaque heure)', creerDit);
        await capture(page, '60-bowling-ticket');
        const r = await creer(page, avant);
        const blocs = blocsDe(r);
        const bowlings = blocs.filter((b) => b.resourceType === 'bowling_lane').sort((x, y) => enMin(x.startTime) - enMin(y.startTime));
        ok(r && Number(r.pax) === 60 && Number(r.price) === 390, '[A] le dossier en base : 60 joueurs, 390 €', r && { pax: r.pax, price: r.price });
        ok(bowlings.length === 2 && bowlings.map((b) => `${b.sousGroupe}@${b.startTime}-${b.endTime}x${b.players}`).join(' ') === '1@15:30-16:30x30 2@16:30-17:30x30',
          '[A] deux services de 30 joueurs, groupe 1 a 15:30, groupe 2 a 16:30', resume(blocs));
        ok(bowlings.every((b) => (b.lanes || []).length === 5 && seSuivent(b.lanes)), '[A] cinq pistes cote a cote pour chaque groupe', bowlings.map((b) => b.lanes));
        const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
        ok(gg && gg.tourne === false && JSON.stringify(gg.tailles) === '[30,30]', '[A] le plan garde ses groupes (tailles 30 et 30, l un apres l autre)', gg);
        const cases = await casesDuPlanning(page, r.id);
        ok(cases.some((t) => /^Bowling de 15:30 à 16:30 · groupe 1 · pistes/.test(t)) && cases.some((t) => /^Bowling de 16:30 à 17:30 · groupe 2 · pistes/.test(t)),
          '[A] le planning dit « groupe 1 » et « groupe 2 » dans les cases du bowling', cases);
        await capture(page, '60-bowling-planning');
        const fiche = await ouvrirLaFiche(page, r.id);
        ok(/2 groupes, l’un après l’autre/.test(fiche.groupes) && /Groupe 1, 30 joueurs : bowling 15:30/.test(fiche.groupes) && /Groupe 2, 30 joueurs : bowling 16:30/.test(fiche.groupes),
          '[A] la fiche dit les groupes, un par ligne', fiche.groupes);
        ok(/pistes \d à \d · groupe 1/.test(fiche.programme) && /pistes \d à \d · groupe 2/.test(fiche.programme), '[A] chaque etape de la fiche porte son groupe', fiche.programme);
        await capture(page, '60-bowling-fiche');
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (A)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('B')) {
      section('[B] 60 JOUEURS AU BOWLING ET AU LASER : DEUX GROUPES QUI TOURNENT');
      const { ctx, page, erreurs, avant } = await ouvrir('vide');
      try {
        await soixante(page);
        await toucher(page, '.rs-seance [data-activite="bowling"][data-heure="15:30"]');
        await pret(page).catch(() => {});
        await toucher(page, '#rsAjout-laser_game');
        await page.waitForFunction(() => /Groupe 2 à 15:30/.test((document.querySelector('#rsL-a-laser_game') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
        await pret(page).catch(() => {});
        const groupes = await texte(page, '#rsL-groupes');
        const bowling = await texte(page, '#rsL-a-bowling');
        const laser = await texte(page, '#rsL-a-laser_game');
        const total = await texte(page, '#rvTotalPied');
        ok(/2 groupes qui tournent/.test(groupes) && /30 et 30 joueurs/.test(groupes), '[B] le ticket dit « 2 groupes qui tournent », 30 et 30 joueurs', groupes);
        ok(/Groupe 1 à 15:30, groupe 2 à 16:30/.test(bowling) && /390 €/.test(bowling), '[B] bowling : groupe 1 a 15:30, groupe 2 a 16:30, 390 €', bowling);
        ok(/Groupe 2 à 15:30, groupe 1 à 16:30/.test(laser) && /600 €/.test(laser), '[B] laser : groupe 2 a 15:30, groupe 1 a 16:30, 600 €', laser);
        ok(/990 €/.test(total), '[B] total 990 €', total);
        const tourne = await texte(page, '#rsTourne-laser_game');
        ok(/Groupe 2 à 15:30, groupe 1 à 16:30\./.test(tourne), '[B] le bloc du laser dit quel groupe y joue a quelle heure', tourne);
        const bouton = await page.evaluate(() => {
          const b = document.querySelector('#rsTourneRegler-laser_game');
          if (!b) return null;
          const st = getComputedStyle(b);
          const rgb = (st.backgroundColor.match(/\d+(\.\d+)?/g) || []).map(Number);
          return { tag: b.tagName, fond: st.backgroundColor, clair: rgb.length >= 3 && (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) > 128, bord: parseFloat(st.borderTopWidth) || 0, souligne: /underline/.test(st.textDecorationLine) };
        });
        ok(bouton && bouton.tag === 'BUTTON' && bouton.clair && bouton.bord >= 1 && !bouton.souligne, '[B] « Régler les groupes » est un bouton encadre, ni noir ni lien', bouton);
        const ecranActivites = await tientALEcran(page);
        ok(ecranActivites.col <= 1 && !ecranActivites.dehors, '[B] Reserver tient a l ecran en 1366 x 768 (activites)', ecranActivites);
        await capture(page, '60-bowling-laser-ticket');
        await toucher(page, '#rsTourneRegler-laser_game');
        await page.waitForSelector('#rsGgGrille', { timeout: 15000 });
        const cellule = (g, a, h) => `#rsGgGrille [data-groupe="${g}"][data-activite="${a}"][data-heure="${h}"]`;
        const grille = await page.evaluate((sels) => sels.map((s) => Boolean(document.querySelector(s))), [cellule(1, 'bowling', '15:30'), cellule(1, 'laser_game', '16:30'), cellule(2, 'laser_game', '15:30'), cellule(2, 'bowling', '16:30')]);
        ok(grille.every(Boolean), '[B] la page des groupes : groupe 1 bowling 15:30 puis laser 16:30, groupe 2 laser 15:30 puis bowling 16:30', grille);
        const phrase = await texte(page, '#rsGgPhrase');
        ok(/Le groupe 1 au bowling pendant que le groupe 2 joue au laser, puis ils échangent\./.test(phrase), '[B] la phrase du plan : le groupe 1 au bowling pendant que le groupe 2 joue au laser', phrase);
        const pas = await page.evaluate(() => Array.from(document.querySelectorAll('.rs-gg-ts [data-groupe="1"]')).filter((b) => b.tagName === 'BUTTON').map((b) => b.disabled));
        ok(pas.length === 2 && pas.every(Boolean), '[B] 30 et 30 avec 30 armes : ni un de plus ni un de moins au groupe 1', pas);
        const ecranGroupes = await tientALEcran(page);
        ok(ecranGroupes.col <= 1 && !ecranGroupes.dehors, '[B] la page des groupes tient a l ecran en 1366 x 768', ecranGroupes);
        await capture(page, '60-bowling-laser-groupes');
        await toucher(page, '#rsGgPremier-laser_game');
        await page.waitForSelector(cellule(1, 'laser_game', '15:30'), { timeout: 15000 }).catch(() => {});
        await pret(page).catch(() => {});
        const apres = await page.evaluate((sels) => sels.map((s) => Boolean(document.querySelector(s))), [cellule(1, 'laser_game', '15:30'), cellule(1, 'bowling', '16:30'), cellule(2, 'bowling', '15:30'), cellule(2, 'laser_game', '16:30')]);
        ok(apres.every(Boolean), '[B] « Groupe 1 : Laser » d un toucher : le moteur recalcule, le groupe 1 commence au laser', apres);
        const bowlingApres = await texte(page, '#rsL-a-bowling');
        ok(/Groupe 2 à 15:30, groupe 1 à 16:30/.test(bowlingApres), '[B] le ticket suit : bowling groupe 2 a 15:30, groupe 1 a 16:30', bowlingApres);
        await capture(page, '60-bowling-laser-groupe-1-au-laser');
        const r = await creer(page, avant);
        const blocs = blocsDe(r);
        ok(r && Number(r.pax) === 60 && Number(r.price) === 990, '[B] le dossier en base : 60 joueurs, 990 €', r && { pax: r.pax, price: r.price });
        ok(resume(blocs) === resume([
          { resourceType: 'laser_arena', sousGroupe: 1, startTime: '15:30', players: 30 },
          { resourceType: 'bowling_lane', sousGroupe: 1, startTime: '16:30', players: 30, lanes: (blocs.find((b) => b.resourceType === 'bowling_lane' && b.sousGroupe === 1) || {}).lanes },
          { resourceType: 'bowling_lane', sousGroupe: 2, startTime: '15:30', players: 30, lanes: (blocs.find((b) => b.resourceType === 'bowling_lane' && b.sousGroupe === 2) || {}).lanes },
          { resourceType: 'laser_arena', sousGroupe: 2, startTime: '16:30', players: 30 },
        ]) && blocs.length === 4, '[B] quatre passages : groupe 1 laser 15:30 puis bowling 16:30, groupe 2 bowling 15:30 puis laser 16:30, 30 joueurs chacun', resume(blocs));
        ok(sansChevauchement(blocs), '[B] aucun groupe n est a deux endroits a la fois', resume(blocs));
        ok(blocs.filter((b) => b.resourceType === 'bowling_lane').every((b) => (b.lanes || []).length === 5 && seSuivent(b.lanes)), '[B] cinq pistes cote a cote par groupe au bowling', blocs.map((b) => b.lanes));
        const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
        ok(gg && gg.tourne === true && gg.premier === 'laser_game' && JSON.stringify(gg.tailles) === '[30,30]', '[B] le plan garde ses groupes : ils tournent, le groupe 1 commence au laser', gg);
        const cases = await casesDuPlanning(page, r.id);
        ok(cases.some((t) => /^Bowling de 15:30 à 16:30 · groupe 2/.test(t)) && cases.some((t) => /^Bowling de 16:30 à 17:30 · groupe 1/.test(t))
          && cases.some((t) => /^Laser à 15:30 · groupe 1/.test(t)) && cases.some((t) => /^Laser à 16:30 · groupe 2/.test(t)),
        '[B] le planning dit le groupe dans chaque case, bowling et laser', cases);
        await capture(page, '60-bowling-laser-planning');
        const fiche = await ouvrirLaFiche(page, r.id);
        ok(/2 groupes qui tournent/.test(fiche.groupes) && /Groupe 1, 30 joueurs : laser 15:30, bowling 16:30/.test(fiche.groupes) && /Groupe 2, 30 joueurs : bowling 15:30, laser 16:30/.test(fiche.groupes),
          '[B] la fiche dit qui joue quoi et quand, groupe par groupe', fiche.groupes);
        await capture(page, '60-bowling-laser-fiche');
        // Le groupe arrive a 58 (« Ils sont 60 », deux fois un de moins, Enregistrer) : le meme moteur
        // refait le plan, les deux groupes et leur ordre restent, 29 et 29, 970 €.
        await page.locator('.fx-programme .fz-compte').first().click();
        await page.waitForSelector('#comptePop', { timeout: 12000 });
        await page.locator('#comptePop [data-compte-pas="-1"]').click();
        await page.locator('#comptePop [data-compte-pas="-1"]').click();
        await page.locator('#comptePop .compte-pop__ok').click();
        let apresCompte = null;
        for (let i = 0; i < 80 && !(apresCompte && Number(apresCompte.pax) === 58); i += 1) {
          await page.waitForTimeout(100);
          apresCompte = B.base.reservations.get(Number(r.id)) || B.base.reservations.get(r.id);
        }
        const blocs58 = blocsDe(apresCompte);
        const gg58 = apresCompte && apresCompte.ops_plan && apresCompte.ops_plan.grandGroupe;
        ok(apresCompte && Number(apresCompte.pax) === 58 && Number(apresCompte.price) === 970
          && resume(blocs58).replace(/\[[^\]]*\]/g, '') === 'B1@16:30x29 B2@15:30x29 L1@15:30x29 L2@16:30x29' && gg58 && gg58.premier === 'laser_game',
        '[B] « Ils sont 58 » : le moteur refait le plan, deux groupes de 29 qui tournent dans le meme ordre, 970 €', apresCompte && `${apresCompte.pax} ${apresCompte.price} ${resume(blocs58)} ${JSON.stringify(gg58)}`);
        await page.waitForFunction(() => /Groupe 1, 29 joueurs : laser 15:30, bowling 16:30/.test((document.querySelector('#ficheGroupes') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {});
        const fiche58 = await texte(page, '#ficheGroupes');
        ok(/Groupe 1, 29 joueurs : laser 15:30, bowling 16:30/.test(fiche58) && /Groupe 2, 29 joueurs : bowling 15:30, laser 16:30/.test(fiche58), '[B] la fiche suit : 29 et 29', fiche58);
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (B)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('C')) {
      section('[C] LE PLAN IMPOSSIBLE LE DIT ET PROPOSE L HEURE OU TOUT LE GROUPE TIENT');
      const { ctx, page, erreurs, avant } = await ouvrir('normal');
      try {
        await soixante(page);
        await toucher(page, '.rs-seance [data-activite="bowling"][data-heure="15:30"]');
        await page.waitForTimeout(800);
        await toucher(page, '#rsAjout-laser_game');
        await page.waitForFunction(() => /Prendre/.test((document.querySelector('#rvCreer') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
        await page.waitForFunction(() => /manque/.test((document.querySelector('.rs-seance .rs-h[data-activite="bowling"][data-heure="15:30"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
        const rangee = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('.rs-seance .rs-h[data-activite="bowling"][data-heure]')).map((b) => [b.dataset.heure, b.textContent.replace(/\s+/g, ' ').trim()])));
        ok(/laser, manque 10 armes/.test(rangee['15:30'] || '') && /laser, manque/.test(rangee['16:00'] || '') && /reste/.test(rangee['17:30'] || ''),
          '[C] la rangee du bowling dit le verdict de tout le groupe : 15:30 « laser, manque 10 armes », 17:30 tient', rangee);
        const laser = await texte(page, '#rsL-a-laser_game');
        ok(/Laser à 16:30, il reste 20 places sur 30, il en faut 30/.test(laser), '[C] la ligne du laser dit pourquoi : il reste 20 places sur 30 a 16:30', laser);
        const dit = await texte(page, '.rs-tk .rs-sr');
        ok(/Laser à 16:30 impossible/.test(dit), '[C] le refus dit l heure qui coince (16:30), pas l heure d une ligne', dit);
        const bouton = await page.evaluate(() => { const b = document.querySelector('#rvCreer'); return b ? { texte: b.textContent.replace(/\s+/g, ' ').trim(), proche: b.dataset.proche || '' } : null; });
        ok(bouton && bouton.proche === '17:30' && /^Prendre 17:30/.test(bouton.texte), '[C] « Prendre 17:30 » : l heure la plus proche ou tout le groupe tient', bouton);
        ok([...B.base.reservations.keys()].every((id) => avant.has(id)), '[C] rien ne part avant « Créer »', [...B.base.reservations.keys()].length);
        await capture(page, '60-impossible-15h30');
        await toucher(page, '#rvCreer');
        await pret(page).catch(() => {});
        const repris = await texte(page, '#rvCreer');
        const bowling = await texte(page, '#rsL-a-bowling');
        ok(/Créer à 17:30/.test(repris) && /Groupe 1 à 17:30, groupe 2 à 18:30/.test(bowling), '[C] un toucher : « Créer à 17:30 », groupe 1 au bowling a 17:30, groupe 2 a 18:30', `${repris} | ${bowling}`);
        await capture(page, '60-impossible-pris-17h30');
        const r = await creer(page, avant);
        const blocs = blocsDe(r);
        ok(r && String(r.start_time).slice(0, 5) === '17:30' && Number(r.price) === 990
          && resume(blocs).replace(/\[[^\]]*\]/g, '') === 'B1@17:30x30 B2@18:30x30 L1@18:30x30 L2@17:30x30',
        '[C] le dossier nait a 17:30 : groupe 1 bowling 17:30 puis laser 18:30, groupe 2 laser 17:30 puis bowling 18:30', r && `${r.start_time} ${r.price} ${resume(blocs)}`);
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (C)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('D')) {
      section('[D] LE SERVEUR : LES VRAIS JOUEURS, LES TAILLES, LA MODIFICATION, LE CANAL PUBLIC');
      const fx = semer('vide');
      const jour = fx.staffState.date;
      const corps = (pax, laser, extra = {}) => ({
        name: 'Groupe Essai', phone: '0470111222', email: '', notes: '', occasion: '', date: jour, startTime: '15:30', duration: 1, totalDuration: 2, lanes: [], pax, status: 'pending', type: 'visite', formuleId: '',
        program: [{ activityId: 'bowling', pax, participants: pax, duration: 1 }, { activityId: 'laser_game', pax, participants: laser, games: 1 }],
        laserGames: 0, extras: [], channel: 'staff', requiresLanes: true, centerId: 'libramont',
        preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: {} },
        ...extra,
      });
      const simuler = async (c) => (await serveur.appeler('POST', '/api/staff-reservations', { ...c, dryRun: true })).json.plan || {};
      const passages = (plan) => (plan.blocs || []).filter((b) => b.sousGroupe).map((b) => `${b.activite === 'bowling' ? 'B' : 'L'}${b.sousGroupe}x${b.joueursReels || b.joueurs}${b.activite === 'bowling' ? `/${(b.pistes || []).length}p` : ''}`).sort().join(' ');

      const partiel = await simuler(corps(60, 40));
      ok(partiel.disponible && Number(partiel.prix) === 790 && passages(partiel) === 'B1x30/5p B2x30/5p L1x20 L2x20',
        '[D] 60 au bowling, 40 au laser : chaque groupe envoie 20 joueurs au laser, 790 €', { prix: partiel.prix, passages: passages(partiel), refus: partiel.refus });
      const tailles = await simuler(corps(50, 50, { preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { tailles: [28, 22] } } }));
      ok(tailles.disponible && passages(tailles) === 'B1x28/5p B2x22/4p L1x28 L2x22' && Number(tailles.prix) === 851,
        '[D] tailles posees 28 et 22 : 5 puis 4 pistes, 28 puis 22 armes, 851 € (9 pistes et 50 joueurs au laser)', { prix: tailles.prix, passages: passages(tailles), refus: tailles.refus });
      const trop = await simuler(corps(60, 60, { preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { tailles: [40, 20] } } }));
      ok(trop.disponible === false && /Groupe 1 : 40 joueurs au laser, 30 armes à la fois/.test(trop.refus || ''), '[D] 40 et 20 avec 30 armes : refuse, et le refus dit pourquoi', trop.refus);
      // Un autre centre, sa propre place (sa configuration, jamais un chiffre du code) : Gembloux a 20 armes,
      // 60 joueurs y font 3 groupes de 20 ; deux groupes au bowling en meme temps n ont jamais une piste commune.
      const gembloux = await simuler({ ...corps(60, 60), centerId: 'gembloux' });
      const quilles = (gembloux.blocs || []).filter((b) => b.activite === 'bowling');
      const ensemble = (a, b) => enMin(a.debut) < enMin(b.fin) && enMin(b.debut) < enMin(a.fin);
      const communes = quilles.some((a, i) => quilles.some((b, j) => j > i && ensemble(a, b) && (a.pistes || []).some((p) => (b.pistes || []).includes(p))));
      const simultanes = quilles.some((a, i) => quilles.some((b, j) => j > i && ensemble(a, b)));
      ok(gembloux.disponible && gembloux.grandGroupe && JSON.stringify(gembloux.grandGroupe.tailles) === '[20,20,20]' && quilles.length === 3 && simultanes && !communes && Number(gembloux.prix) === 1068,
        '[D] Gembloux, 20 armes : 3 groupes de 20, deux groupes au bowling en meme temps sur des pistes differentes, 1068 €', { prix: gembloux.prix, refus: gembloux.refus, bowling: quilles.map((b) => `${b.sousGroupe}@${b.debut}[${(b.pistes || []).join(',')}]`) });

      // Une modification (le depart decale d une demi-heure) garde les groupes et leur ordre.
      const cree = await serveur.appeler('POST', '/api/staff-reservations', corps(60, 60, { preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { premier: 'laser_game' } } }));
      const dossier = cree.json.reservation;
      ok(cree.statut < 300 && dossier && dossier.opsPlan && dossier.opsPlan.grandGroupe && dossier.opsPlan.grandGroupe.premier === 'laser_game', '[D] creation : les groupes tournent, le groupe 1 commence au laser', cree.json.message || (dossier && dossier.opsPlan && dossier.opsPlan.grandGroupe));
      if (dossier) {
        const modif = await serveur.appeler('PATCH', '/api/staff-reservations', { id: dossier.id, centerId: 'libramont', startTime: '16:00', baseUpdatedAt: dossier.updatedAt });
        const apres = B.base.reservations.get(Number(dossier.id)) || B.base.reservations.get(dossier.id);
        const blocs = blocsDe(apres);
        ok(modif.statut < 300 && resume(blocs).replace(/\[[^\]]*\]/g, '') === 'B1@17:00x30 B2@16:00x30 L1@16:00x30 L2@17:00x30' && apres.ops_plan.grandGroupe && apres.ops_plan.grandGroupe.premier === 'laser_game',
          '[D] decale a 16:00, le dossier garde ses deux groupes et leur ordre (groupe 1 laser 16:00 puis bowling 17:00)', `${modif.statut} ${modif.json.message || ''} ${resume(blocs)}`);
      }

      // Le formulaire en ligne : la meme demande, par le chemin de la reservation publique
      // (api/public-reservations.js, prepareReservationOps canal public), ne fait aucun sous-groupe.
      semer('vide');
      const { prepareReservationOps } = require(path.join(ROOT, OPS));
      const demande = { ...corps(60, 60), channel: undefined };
      delete demande.channel;
      const sousGroupesDu = (ops) => ((ops && ops.opsPlan && ops.opsPlan.resourceBlocks) || []).filter((b) => b.sousGroupe).length;
      const enLigne = await prepareReservationOps({ ...demande }, 'public');
      const auComptoir = await prepareReservationOps({ ...demande }, 'staff');
      ok(sousGroupesDu(enLigne) === 0 && sousGroupesDu(auComptoir) > 0, '[D] la demande d un grand groupe ne vaut qu au comptoir : le canal public garde son plan', { public: sousGroupesDu(enLigne), staff: sousGroupesDu(auComptoir), refusPublic: enLigne && enLigne.planRefusal });
    }
  } catch (error) {
    ok(false, `exception : ${error.message}`, String(error.stack || '').split('\n').slice(0, 4).join(' | '));
  } finally {
    if (browser) await browser.close();
    if (http) http.close();
  }

  console.log(rouges
    ? `\ngrands-groupes-check: ${rouges} ROUGE(S)`
    : '\ngrands-groupes-check: ALL OK - un grand groupe se coupe au comptoir comme en ligne, tourne entre bowling et laser, se lit au ticket, au planning et a la fiche, et un plan impossible propose l heure qui tient');
  process.exit(rouges ? 1 : 0);
}

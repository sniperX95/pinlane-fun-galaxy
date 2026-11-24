'use strict';
// LE LASER SEUL EN GROUPES, AU COMPTOIR (2026-11-24, assets/app-main.js rvGrandGroupe, lib/grand-groupe.js).
//
// Le gerant, devant Reserver a Libramont, 35 joueurs au laser seul, demain (30 armes au centre) : « laser game faut faire
// 2 groupe mais on voit pas et c'est super incompréhensible et pas complet ». Le laser seul se coupait en vagues que rien
// ne montrait ni ne reglait, et le bloc disait « 35 armes ». Le serveur sait le planifier en groupes, partie par partie
// (1725811, grands-groupes-check [L]) ; ce gate joue la fenetre : la VRAIE console (scripts/planning-v3-fixtures.js, un
// mardi calme, Reserver pour le lendemain), le VRAI handler api/staff-reservations.js et le vrai moteur
// (scripts/reserver-banc.js, base en memoire), en vrais clics a 1366 x 768. Il lit l ecran et le dossier cree en base.
//   [A] 35 JOUEURS AU LASER SEUL, DEMAIN A 14:00 : le bloc dit « 30 armes à la fois » (jamais « 35 armes ») et ses
//       groupes (« 2 groupes de 18 et 17 joueurs, l’un après l’autre », « Régler les groupes ») ; le ticket dit les deux
//       groupes, chacun son heure ; le dossier nait en deux groupes de 18 et 17, a 14:00 et 14:30, un « Laser Game » a
//       350 €, comme le laser d avant.
//   [B] DEUX PARTIES, LES GROUPES REGLES : la page des groupes, la meme que celle du bowling, montre une case par
//       partie de chaque groupe ; le nombre de groupes ne descend pas sous ce que les armes demandent et monte (3
//       groupes de 12, 12 et 11, que le serveur pose, et la page du laser dit la partie 2 a 15:30, apres la partie 1
//       des trois) ; revenu a deux groupes, l espacement de 1 h 30 reste (groupe 1 a 14:00 puis 15:30) ; une heure
//       tapee qui ne tient pas (la partie 2 du groupe 1 au depart du groupe 2) se dit en rouge sur SA case, avec le
//       groupe et la partie, et rien ne part ; corrigee a la minute, le dossier nait a ces heures-la.
//   [C] UN DOSSIER D AVANT (au laser seul, en vagues, sans programme ni groupes) s ouvre dans Modifier et s enregistre
//       renomme sans etre reecrit : ni programme, ni groupes, ses vagues, son prix, son type et son libelle. Un dossier ne
//       en groupes garde ses groupes de la meme facon.
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` rejoue le gate sur du code casse expres, une mutation a la fois, en memoire (la
// console par le serveur de fichiers, le serveur par le crochet de compilation du banc), UNE A LA FOIS (un seul
// navigateur sur la machine), et exige que chacune rougisse sa lettre. Le disque n est jamais touche.
// `--seul=B` ne joue qu une lettre, `--captures` pose l ecran de [A] dans captures-laser/ (jamais commite).
// Lancement : node scripts/laser-seul-groupes-check.js [--contre-preuves] [--seul=A] [--captures]
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
const PORT = Number(process.env.PINLANE_LASER_SEUL_PORT || 7761);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = path.join(ROOT, 'captures-laser');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const SEUL = typeof argument('seul') === 'string' ? argument('seul') : '';
const joue = (lettre) => !SEUL || SEUL === lettre;
const lf = (t) => String(t).split('\r\n').join('\n');

const APP = 'assets/app-main.js';
const OPS = 'lib/reservation-ops.js';

// LES MUTATIONS : une regle retiree a la fois. `lettre` : le scenario qui doit rougir. `serveur` : le code passe par le
// crochet de compilation du banc, sinon la console le recoit du serveur de fichiers.
const MUTATIONS = [
  // [A] le laser seul sans groupes (la panne du gerant) ; « 35 armes » ; le bloc qui ne dit pas ses groupes ; les groupes
  // a l ecran mais pas dans la demande (le dossier repart en vagues).
  { nom: 'laser-seul-sans-groupes', lettre: 'A', fichier: APP, de: "  if (formule ? !(ids.includes('bowling') && ids.includes('laser_game')) : !ids.includes('bowling') && !laserSeul) return null;", vers: "  if (formule ? !(ids.includes('bowling') && ids.includes('laser_game')) : !ids.includes('bowling')) return null;" },
  { nom: 'trente-cinq-armes', lettre: 'A', fichier: APP, de: "  if (id !== 'bowling') return rsEtat().faits.combien ? `${tarif}, ${rvArmesDites(getQuickVisitParticipants(id))}` : tarif;", vers: "  if (id !== 'bowling') return rsEtat().faits.combien ? `${tarif}, ${rvPluriel(getQuickVisitParticipants(id), 'arme')}` : tarif;" },
  { nom: 'bloc-sans-ses-groupes', lettre: 'A', fichier: APP, de: "  return grand && grand.laserSeul && rsAuTicket('laser_game') && rsEtat().faits.combien ? rsGroupesDuLaserHtml(grand, 'Bloc') : '';", vers: "  return '';" },
  { nom: 'groupes-hors-de-la-demande', lettre: 'A', fichier: APP, de: "  const programme = s.type === 'visite' || adaptee || rsFmActive(s) || (s.type !== 'formule' && Boolean(rvGrandGroupe()));", vers: "  const programme = s.type === 'visite' || adaptee || rsFmActive(s) || (s.type !== 'formule' && Boolean(rvGrandGroupe() && !rvGrandGroupe().laserSeul));" },
  // [B] l espacement efface par les groupes ; une seule case pour les parties ; les heures tapees ne partent pas ; la
  // case rouge sans sa partie ; la phrase sans sa partie ; les departs qui ignorent le nombre de groupes choisi.
  { nom: 'espacement-efface', lettre: 'B', fichier: APP, de: '    if (demande.impose && !grand.laserSeul) {', vers: '    if (demande.impose) {' },
  { nom: 'une-case-pour-les-parties', lettre: 'B', fichier: APP, de: 'cles: Array.from({ length: rvPartiesLaser() }, (_, rang) => rvCleDeLaPartie(rang + 1))', vers: "cles: ['laser_game']" },
  { nom: 'heures-des-parties-non-envoyees', lettre: 'B', fichier: APP, de: "pourDepart: s.startTime, pourActivites: cles.join(',') };", vers: "pourDepart: s.startTime, pourActivites: grand.ids.join(',') };" },
  { nom: 'case-rouge-sans-sa-partie', lettre: 'B', fichier: APP, de: "  return x.activite === 'laser_game' && (!(Number(x.partie) > 0) || rvCleDeLaPartie(x.partie) === cle);", vers: "  return x.activite === 'laser_game';" },
  { nom: 'phrase-sans-sa-partie', lettre: 'B', fichier: APP, de: "    const partie = rvParPartie(grand) && Number(x.partie) > 0 && !/partie \\d/i.test(raison) ? Number(x.partie) : 0;", vers: '    const partie = 0;' },
  { nom: 'departs-sans-les-groupes', lettre: 'B', fichier: APP, de: '  if (grand && grand.laserSeul) return grand.nombre;\n', vers: '' },
  // [C] le dossier d avant recoit le programme du calcul a chaque enregistrement, groupes ou non (la forme du calcul
  // ecrite dans la ligne).
  { nom: 'dossier-d-avant-reecrit', lettre: 'C', serveur: true, fichier: OPS,
    de: "  if (request.type !== 'laser' || itemsProgramme(request).length || !laserSeulEnGroupes(request)) return request;\n  return { ...request, program: { items: [{ activityId: 'laser_game', participants: request.pax, games: request.laserGames || 1 }] } };",
    vers: "  if (request.type !== 'laser' || itemsProgramme(request).length) return request;\n  return Object.assign(request, { program: { items: [{ activityId: 'laser_game', participants: request.pax, games: request.laserGames || 1 }] } });" },
];

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : un fil par mutation, l un apres l autre (un seul navigateur a la fois sur la machine).
// ---------------------------------------------------------------------------
function lancer(args, port) {
  return new Promise((ok) => {
    const fil = spawn(process.execPath, [__filename, ...args], { cwd: ROOT, env: { ...process.env, PINLANE_LASER_SEUL_PORT: String(port) } });
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
      console.log('\nlaser-seul-groupes-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
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
      ? `\nlaser-seul-groupes-check --contre-preuves: ${rates} mutation(s) vivante(s)`
      : `\nlaser-seul-groupes-check --contre-preuves: ALL OK - ${file.length} mutations, chaque regle retiree fait rougir sa lettre`);
    process.exit(rates ? 1 : 0);
  })();
} else {
  principal().catch((error) => { console.error(error); process.exit(1); });
}

async function principal() {
  const nomMutation = typeof argument('mutation') === 'string' ? argument('mutation') : '';
  const mutation = nomMutation ? MUTATIONS.find((m) => m.nom === nomMutation) : null;
  if (nomMutation && !mutation) { console.error(`mutation inconnue : ${nomMutation}`); process.exit(2); }
  // La console mutee : le texte servi au navigateur. L ancre doit exister une fois, sinon la contre-preuve ne prouverait rien.
  const transformer = (rel, texte) => {
    if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
    const t = lf(texte);
    if (t.split(mutation.de).length !== 2) { console.log(`ANCRE DE MUTATION absente ou multiple (${mutation.nom}) dans ${rel}`); process.exit(2); }
    return t.split(mutation.de).join(mutation.vers);
  };
  if (mutation && !mutation.serveur) transformer(mutation.fichier, fs.readFileSync(path.join(ROOT, mutation.fichier), 'utf8'));

  // La base en memoire et le faux 'pg' s installent au require ; le serveur (mute ou non) se monte avant tout autre
  // require du depot.
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
    console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600)}` : ''}`);
  };

  // UN MARDI CALME A LIBRAMONT (la fixture « calme », 15:10) ; Reserver pour le lendemain, un mercredi ouvert de 12:00 a 22:00.
  const FIXTURE = 'calme';
  const HEURE = '15:10';
  const AUJOURD_HUI = FX.lireFixture(FIXTURE).staffState.date;
  const DEMAIN = (() => { const d = new Date(`${AUJOURD_HUI}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  const ligneDe = (id) => B.base.reservations.get(Number(id)) || B.base.reservations.get(id);
  const version = (id) => new Date(ligneDe(id).updated_at).toISOString();
  const blocsDe = (r) => ((r && r.ops_plan && r.ops_plan.resourceBlocks) || []).filter((b) => b.resourceType === 'laser_arena');
  // « G2P1@14:30x17 » : le groupe 2 joue sa partie 1 a 14:30, a 17 joueurs (G0 : une vague, sans groupe).
  const passages = (r) => blocsDe(r).map((b) => `G${Number(b.sousGroupe) || 0}P${Number(b.countIndex) || 1}@${String(b.startTime).slice(0, 5)}x${Number(b.joueursReels || b.players) || 0}`).sort().join(' ');
  const programmeDe = (r) => (r && r.program ? (Array.isArray(r.program) ? r.program : r.program.items || []) : null);

  let browser = null;
  async function ouvrir() {
    globalThis.__comptoirMaintenant = FX.instant(AUJOURD_HUI, HEURE).getTime();
    const m = await FX.monter(browser, {
      fixture: FIXTURE, appareil: 'comptoir', theme: 'light', port: PORT, heure: HEURE,
      avantChargement: async (page) => {
        await page.exposeFunction('__fixtureServeur', async (corps) => serveur.appeler('PATCH', '/api/staff-reservations', corps));
        await page.exposeFunction('__vraiAppel', async (methode, url, corps) => serveur.appeler(methode, url, corps));
      },
    });
    const { page } = m;
    page.setDefaultTimeout(12000);
    await page.evaluate(() => {
      const avant = window.fetch;
      window.fetch = async (input, init) => {
        init = init || {};
        const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
        const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
        const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
        if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
          const corps = init.body ? JSON.parse(init.body) : undefined;
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
    return { ...m, avant: new Set([...B.base.reservations.keys()]) };
  }
  const texte = (page, sel) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);
  const pret = (page) => page.waitForFunction(() => { const b = document.querySelector('#rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 15000 });
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
    await page.locator('#rvCreer').click();
    return (await nouveaux(page, avant))[0] || null;
  }
  // Reserver, demain, le nombre tape dans « Autre », puis le laser pris a la place du bowling propose, a son heure.
  async function laserDemain(page, { joueurs = 35, parties = 1, heure = '14:00' } = {}) {
    await page.locator('.btn-new').first().click();
    await page.waitForSelector('#qbPax');
    await page.locator('.qb-modal.rv button', { hasText: /^Demain$/ }).first().click();
    await page.waitForFunction((j) => quickBookState && quickBookState.date === j, DEMAIN);
    await page.locator('#qbPax').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(joueurs));
    await page.keyboard.press('Tab');
    await page.waitForFunction((n) => quickBookState && Number(quickBookState.pax) === n, joueurs);
    await page.locator('#rsAjout-laser_game').click();
    await page.waitForSelector('.rs-seance [data-activite="laser_game"][data-heure]');
    if (parties > 1) {
      await page.locator(`[data-quoi="laser_game"][data-var="${parties}"]`).first().click();
      await page.waitForFunction((p) => typeof rvPartiesLaser === 'function' && rvPartiesLaser() === p, parties);
    }
    await page.locator(`.rs-seance [data-activite="laser_game"][data-heure="${heure}"]`).first().click();
    await pret(page).catch(() => {});
  }
  // La page des groupes : une rangee par groupe (ce qu elle dit), ses cases (cle@heure, rouge ou non), sa phrase rouge.
  const pageDesGroupes = (page) => page.evaluate(() => ({
    titre: ((document.querySelector('#rsQ') || {}).textContent || '').trim(),
    phrase: ((document.querySelector('#rsGgPhrase') || {}).textContent || '').trim(),
    nombre: ((document.querySelector('.rs-gg-n') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    moins: Boolean((document.querySelector('.rs-gg-n button[aria-label="Nombre de groupes, un de moins"]') || {}).disabled),
    rangees: Array.from(document.querySelectorAll('#rsGgListe .rs-gg-l')).map((l) => l.getAttribute('aria-label')),
    cases: Array.from(document.querySelectorAll('#rsGgListe .rs-gg-c')).map((c) => `${c.dataset.groupe}:${c.dataset.activite}@${c.dataset.heureGroupe}${c.classList.contains('is-ko') ? '!' : ''}`),
    rouges: Array.from(document.querySelectorAll('#rsGgListe .rs-gg-ko')).map((k) => k.textContent.trim()),
    total: ((document.querySelector('#rsGgTotal') || {}).textContent || '').trim(),
  }));
  // Une heure tapee dans une case de la page des groupes, validee par Entree.
  async function taperHeure(page, groupe, cle, frappe) {
    await page.locator(`.rs-gg-h[data-saisie="t:${groupe}-${cle}"]`).click();
    await page.waitForSelector('#rsSaisie');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(frappe);
    await page.keyboard.press('Enter');
  }

  const navigateur = ['A', 'B', 'C'].some(joue);
  if (navigateur) {
    const { chromium } = require('playwright-core');
    browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  }
  const http = navigateur ? await FX.servir({ port: PORT, transformer }) : null;
  try {
    // =======================================================================
    if (joue('A')) {
      section('[A] 35 JOUEURS AU LASER SEUL, DEMAIN A 14:00 : SES GROUPES SE VOIENT, LES ARMES DU CENTRE AUSSI');
      B.semer([]);
      const { ctx, page, erreurs, avant } = await ouvrir();
      try {
        await laserDemain(page);
        const etat = await page.evaluate(() => ({ date: quickBookState.date, pax: quickBookState.pax, type: quickBookState.type, heure: quickBookState.startTime }));
        ok(etat.date !== undefined && etat.pax === 35 && etat.heure === '14:00', 'MONTAGE Reserver, demain, 35 joueurs au laser a 14:00', etat);
        const bloc = await texte(page, '.rs-seance.is-on[aria-label="Laser"] .rs-s-n small');
        const fenetre = await texte(page, '.qb-modal.rv');
        ok(/30 armes à la fois/.test(bloc) && !/35 armes/.test(fenetre), '[A] le bloc du laser dit « 30 armes à la fois », et rien ne dit « 35 armes »', bloc);
        const groupesDuBloc = await texte(page, '#rsGgLaserBloc');
        ok(/^30 armes à la fois : 2 groupes de 18 et 17 joueurs, l’un après l’autre\.\s*Régler les groupes$/.test(groupesDuBloc), '[A] sous ses heures, le bloc dit ses deux groupes et mene a leurs reglages', groupesDuBloc);
        const ticket = await texte(page, '#rsL-groupes');
        ok(/2 groupes, l’un après l’autre/.test(ticket) && /18 et 17 joueurs/.test(ticket) && /Groupe 1 · 18 · Laser 14:00/.test(ticket) && /Groupe 2 · 17 · Laser 14:30/.test(ticket),
          '[A] le ticket dit les deux groupes, leurs joueurs et leur heure', ticket);
        const laser = await texte(page, '#rsL-a-laser_game');
        const creerDit = await texte(page, '#rvCreer');
        ok(/Groupe 1 à 14:00, groupe 2 à 14:30/.test(laser) && /350 €/.test(laser) && /^Créer à 14:00/.test(creerDit), '[A] la ligne du laser : chaque groupe a son heure, 350 € ; « Créer à 14:00 »', { laser, creerDit });
        if (argument('captures')) {
          fs.mkdirSync(CAPTURES, { recursive: true });
          await page.screenshot({ path: path.join(CAPTURES, 'apres-1366.png') });
        }
        const r = await creer(page, avant);
        const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
        const items = programmeDe(r) || [];
        ok(r && r.date === DEMAIN && r.type === 'laser' && r.label === 'Laser Game' && Number(r.pax) === 35 && Number(r.price) === 350 && passages(r) === 'G1P1@14:00x18 G2P1@14:30x17'
          && gg && JSON.stringify(gg.tailles) === '[18,17]' && gg.tourne === false && items.some((i) => i.activityId === 'laser_game' && Number(i.games) === 1),
        '[A] le dossier nait demain en deux groupes, 18 a 14:00 et 17 a 14:30, un « Laser Game » a 350 €', r && { date: r.date, type: r.type, label: r.label, prix: r.price, passages: passages(r), gg, items });
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (A)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('B')) {
      section('[B] DEUX PARTIES ESPACEES DE 1 H 30 : LA PAGE DES GROUPES, UNE CASE PAR PARTIE, CE QUI NE TIENT PAS SUR SA CASE');
      B.semer([]);
      const { ctx, page, erreurs, avant } = await ouvrir();
      try {
        await laserDemain(page, { parties: 2 });
        // Les groupes aux departs du laser d avant : une heure entre ses parties.
        await page.locator('#rsL-groupes').click();
        await page.waitForSelector('#rsGgListe');
        let p = await pageDesGroupes(page);
        ok(p.titre === '35 joueurs en 2 groupes' && /l’un après l’autre, partie par partie : 30 armes à la fois/.test(p.phrase) && /au moins 2 : 30 armes à la fois/.test(p.nombre) && p.moins,
          '[B] la page : 35 joueurs en 2 groupes, partie par partie, pas moins de 2 (30 armes a la fois)', p);
        ok(JSON.stringify(p.rangees) === JSON.stringify(['Groupe 1 · 18 joueurs · Partie 1 14:00 → Partie 2 15:00', 'Groupe 2 · 17 joueurs · Partie 1 14:30 → Partie 2 15:30'])
          && p.cases.join(' ') === '1:laser_game@14:00 1:laser_game_2@15:00 2:laser_game@14:30 2:laser_game_2@15:30' && p.total === '35 joueurs sur 35',
        '[B] une rangee par groupe, une case par partie, chacune son heure', p);
        // Un groupe de plus : 12, 12 et 11, que le serveur pose partie par partie.
        await page.locator('.rs-gg-n button[aria-label="Nombre de groupes, un de plus"]').click();
        await page.waitForFunction(() => /Groupe 3 · 11 joueurs · Partie 1 15:00 → Partie 2 \d\d:\d\d/.test(Array.from(document.querySelectorAll('#rsGgListe .rs-gg-l')).map((l) => l.getAttribute('aria-label')).join('|')), null, { timeout: 15000 }).catch(() => {});
        p = await pageDesGroupes(page);
        ok(JSON.stringify(p.rangees) === JSON.stringify(['Groupe 1 · 12 joueurs · Partie 1 14:00 → Partie 2 15:30', 'Groupe 2 · 12 joueurs · Partie 1 14:30 → Partie 2 16:00', 'Groupe 3 · 11 joueurs · Partie 1 15:00 → Partie 2 16:30']),
          '[B] un groupe de plus : 12, 12 et 11, la partie 2 apres la partie 1 des trois groupes', p.rangees);
        // La page du laser dit les departs de ses parties comme le planning les pose : la partie 2 du groupe 1 a 15:30.
        await page.locator('#rsL-a-laser_game').click();
        await page.waitForSelector('#rvPartie-1');
        const departs = await texte(page, '#rvPartie-0, #rvPartie-1');
        const espacements = await page.evaluate(() => Array.from(document.querySelectorAll('[onclick*="rsEspacement("]')).map((b) => b.textContent.trim()));
        ok(/^14:00\s*partie 1 \| 15:30\s*partie 2$/.test(departs) && JSON.stringify(espacements) === '["1 h 30"]',
          '[B] trois groupes : la page du laser dit la partie 2 a 15:30, et ne propose plus 1 h entre deux parties (trois groupes y passent)', { departs, espacements });
        // Revenu a deux groupes, les parties espacees de 1 h 30 sur la page du laser.
        await page.locator('#rsL-groupes').click();
        await page.waitForSelector('#rsGgListe');
        await page.locator('.rs-gg-n button[aria-label="Nombre de groupes, un de moins"]').click();
        await page.waitForFunction(() => document.querySelectorAll('#rsGgListe .rs-gg-l').length === 2);
        await pret(page).catch(() => {});
        await page.locator('#rsL-a-laser_game').click();
        await page.locator('[onclick*="rsEspacement(90)"]').first().click();
        await page.waitForFunction(() => typeof rvDepartsLaser === 'function' && rvDepartsLaser('14:00').join(' ') === '14:00 15:30');
        await pret(page).catch(() => {});
        const ticket = await texte(page, '#rsL-groupes');
        ok(/Groupe 1 · 18 · Partie 1 14:00 → Partie 2 15:30/.test(ticket) && /Groupe 2 · 17 · Partie 1 14:30 → Partie 2 16:00/.test(ticket),
          '[B] espacees de 1 h 30 : le groupe 1 joue a 14:00 puis 15:30, le groupe 2 a 14:30 puis 16:00', ticket);
        await page.locator('#rsL-groupes').click();
        await page.waitForSelector('#rsGgListe');
        p = await pageDesGroupes(page);
        ok(p.cases.join(' ') === '1:laser_game@14:00 1:laser_game_2@15:30 2:laser_game@14:30 2:laser_game_2@16:00', '[B] la page des groupes suit l espacement', p.cases);
        // La partie 2 du groupe 1 tapee au depart du groupe 2 : 18 + 17 armes sur 30.
        const avantRefus = B.base.reservations.size;
        await taperHeure(page, 1, 'laser_game_2', '1430');
        await page.waitForSelector('#rsGgListe .rs-gg-c.is-ko', { timeout: 15000 }).catch(() => {});
        p = await pageDesGroupes(page);
        const creerRefus = await page.evaluate(() => ({ pret: document.querySelector('#rvCreer').dataset.pret, dit: document.querySelector('#rvCreer').textContent.trim() }));
        ok(p.cases.join(' ') === '1:laser_game@14:00 1:laser_game_2@14:30! 2:laser_game@14:30 2:laser_game_2@16:00'
          && p.rouges.length === 1 && /^Partie 2, laser à 14:30, il reste 13 places sur 30 \(le groupe 2 y joue\), il en faut 18\. Décalez le départ\.$/.test(p.rouges[0]),
        '[B] la partie 2 du groupe 1 a 14:30 : sa case seule est rouge, la phrase dit la partie et ce qui manque', p);
        ok(creerRefus.pret === '0' && B.base.reservations.size === avantRefus, '[B] rien ne part tant que ca ne tient pas', creerRefus);
        // Corrigee a la minute : 15:20 (finie a 15:45, avant la partie 2 du groupe 2).
        await taperHeure(page, 1, 'laser_game_2', '15:20');
        await page.waitForFunction(() => !document.querySelector('#rsGgListe .rs-gg-c.is-ko'), null, { timeout: 15000 }).catch(() => {});
        await pret(page).catch(() => {});
        p = await pageDesGroupes(page);
        ok(p.cases.join(' ') === '1:laser_game@14:00 1:laser_game_2@15:20 2:laser_game@14:30 2:laser_game_2@16:00' && !p.rouges.length && /celles que vous avez posées/.test(p.phrase),
          '[B] corrigee a 15:20 : plus rien de rouge, les heures sont celles posees', p);
        const prix = await page.evaluate(() => (rvPlanCourant() || {}).prix);
        const r = await creer(page, avant);
        const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
        ok(r && r.type && passages(r) === 'G1P1@14:00x18 G1P2@15:20x18 G2P1@14:30x17 G2P2@16:00x17' && Number(r.price) === Number(prix) && Number(prix) > 0
          && gg && JSON.stringify(gg.heures) === JSON.stringify([{ laser_game: '14:00', laser_game_2: '15:20' }, { laser_game: '14:30', laser_game_2: '16:00' }]),
        '[B] le dossier nait a ces heures-la, chaque partie de chaque groupe, au prix annonce', r && { passages: passages(r), prix: [r.price, prix], gg });
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (B)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('C')) {
      section('[C] UN DOSSIER D AVANT (EN VAGUES, SANS PROGRAMME) S OUVRE ET S ENREGISTRE SANS ETRE REECRIT');
      globalThis.__comptoirMaintenant = FX.instant(AUJOURD_HUI, HEURE).getTime();
      B.semer([]);
      const base = { phone: '0470111222', email: '', notes: '', occasion: '', date: AUJOURD_HUI, duration: 0.5, totalDuration: 1, lanes: [], pax: 35, status: 'pending', type: 'laser', formuleId: '', label: 'Laser Game', laserGames: 1, extras: [], channel: 'staff', requiresLanes: false, centerId: 'libramont' };
      const ancien = await serveur.appeler('POST', '/api/staff-reservations', { ...base, name: 'Laser Avant', startTime: '17:00' });
      const enGroupes = await serveur.appeler('POST', '/api/staff-reservations', {
        ...base, name: 'Laser Groupes', startTime: '19:00',
        program: [{ activityId: 'laser_game', pax: 35, participants: 35, games: 1 }],
        preference: { activityOrder: ['laser_game'], preferredTimes: { laser_game: '19:00' }, laserGameTimes: ['19:00'], laserPlacement: 'scheduled', grandGroupe: { impose: true } },
      });
      const a = ancien.json && ancien.json.reservation;
      const g = enGroupes.json && enGroupes.json.reservation;
      const photo = (id) => { const r = ligneDe(id); return { passages: passages(r), program: programmeDe(r), gg: (r.ops_plan || {}).grandGroupe || null, prix: Number(r.price), type: r.type, label: r.label }; };
      const a0 = a ? photo(a.id) : null;
      const g0 = g ? photo(g.id) : null;
      ok(a0 && g0 && a0.passages === 'G0P1@17:00x18 G0P1@17:30x17' && !a0.program && !a0.gg && a0.prix === 350 && g0.passages === 'G1P1@19:00x18 G2P1@19:30x17' && g0.gg,
        'MONTAGE un dossier d avant (deux vagues, ni programme ni groupes, 350 €) et un dossier ne en groupes', { a0, g0, ancien: ancien.statut, enGroupes: enGroupes.statut });
      if (a0 && g0) {
        const { ctx, page, erreurs } = await ouvrir();
        page.on('dialog', (d) => d.accept().catch(() => {}));
        try {
          await page.evaluate((dossiers) => {
            const liste = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
            dossiers.forEach((d) => { liste.push({ ...d }); state.reservations.push({ ...d }); });
            renderStaff();
          }, [a, g]);
          // Modifier, en vrais gestes : le nom change, « Enregistrer » ; le serveur ecrit ou refuse.
          const renommer = async (id, nom) => {
            await page.evaluate((i) => { if (typeof closePos === 'function') closePos(); openPos(i); setTab('modifier'); }, id);
            await page.waitForSelector('#posOverlay .fm', { timeout: 12000 });
            const groupes = await page.evaluate(() => { const z = document.getElementById('editGroupes'); return z ? !z.hidden : false; });
            await page.fill('#editNameInput', nom);
            await page.waitForTimeout(900);
            const avantVersion = version(id);
            await page.locator('#posOverlay .es-save').click();
            for (let i = 0; i < 80 && version(id) === avantVersion && !(await page.evaluate(() => state.editError || '')); i += 1) await page.waitForTimeout(100);
            await page.waitForTimeout(300);
            const erreur = await page.evaluate(() => state.editError || '');
            await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
            return { ecrit: version(id) !== avantVersion, erreur, groupes };
          };
          const ma = await renommer(a.id, 'Laser Avant Renomme');
          const a1 = photo(a.id);
          ok(ma.ecrit && !ma.erreur && ligneDe(a.id).name === 'Laser Avant Renomme' && JSON.stringify(a1) === JSON.stringify(a0),
            '[C] le dossier d avant renomme dans Modifier : ni programme ni groupes ecrits, ses vagues, son prix, son type et son libelle restent', { ...ma, avant: a0, apres: a1 });
          const mg = await renommer(g.id, 'Laser Groupes Renomme');
          const g1 = photo(g.id);
          ok(mg.ecrit && !mg.erreur && ligneDe(g.id).name === 'Laser Groupes Renomme' && JSON.stringify(g1) === JSON.stringify(g0),
            '[C] le dossier en groupes renomme : ses groupes, ses heures et son prix restent', { ...mg, avant: g0, apres: g1 });
          ok(erreurs.length === 0, '[*] zero erreur JavaScript (C)', erreurs.slice(0, 3).join(' | '));
        } finally { await ctx.close(); }
      }
    }
  } catch (error) {
    ok(false, `exception : ${error.message}`, String(error.stack || '').split('\n').slice(0, 4).join(' | '));
  } finally {
    if (browser) await browser.close();
    if (http) http.close();
  }

  console.log(rouges
    ? `\nlaser-seul-groupes-check: ${rouges} ROUGE(S)`
    : '\nlaser-seul-groupes-check: ALL OK - le laser seul plus grand que l arene montre et regle ses groupes a Reserver, partie par partie, dit les armes du centre, et un dossier d avant reste tel quel');
  process.exit(rouges ? 1 : 0);
}

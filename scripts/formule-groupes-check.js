'use strict';
// UNE FORMULE A 60 JOUEURS EN GROUPES, AU COMPTOIR (2026-11-24, assets/app-main.js rvGrandGroupe, lib/ops-engine.js
// planFormulaWithAnchors, lib/grand-groupe.js).
//
// Le gerant a Libramont, la Formule 4 (bowling, deux parties de laser, minigolf) pour 60 joueurs : la fenetre ne montrait
// ni ne reglait ses groupes, alors que le bowling et le laser d une visite les montrent (Ansar, 23/11 : « faut qu'on puisse
// tout modifier et choisir [...] choisir l'heure de passage, choisir de diviser en plus de 2 groupes »). Le serveur sait
// deja poser une formule en groupes qui tournent, aux heures posees (planFormulaWithAnchors lit preference.grandGroupe) ;
// ce gate joue la fenetre : la VRAIE console (scripts/planning-v3-fixtures.js, un mardi calme, Reserver pour le
// lendemain, un mercredi ouvert de 12:00 a 22:00), le VRAI handler api/staff-reservations.js et le vrai moteur
// (scripts/reserver-banc.js, base en memoire), en vrais clics a 1366 x 768. Il lit l ecran et le dossier cree en base.
//   [A] LA FORMULE 4 A 60 JOUEURS, DEMAIN A 15:00 : le plan de sa carte reste (15:00 a 19:55, 2 340 €) et rien ne bascule
//       seul ; le ticket propose « Faire tourner 2 groupes : fin à 17:45, 2 340 € ». Touche, il dit les deux groupes, qui
//       joue quoi et quand, et le dossier nait une FORMULE 4 (pas un programme), en deux groupes de 30 qui tournent, au
//       meme prix.
//   [B] LA PAGE DES GROUPES DE LA FORMULE : combien de groupes, les joueurs de chacun, l heure de chacun a chaque
//       activite ; un groupe de plus (3 groupes de 20) que le serveur pose ; une heure tapee qui ne tient pas se dit en
//       rouge sur SA case et rien ne part ; corrigee a la minute, le dossier nait a ces heures-la, en 3 groupes.
//   [C] RIEN A REGLER : le Kids Fun Day (tout en illimite, aucune place a reserver) ne propose jamais de groupes, ni la
//       Formule 4 prise avec ses arcades a la place du laser ; leur demande ne porte ni groupes ni heures posees.
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` rejoue le gate sur du code casse expres, une mutation a la fois, en memoire (la
// console par le serveur de fichiers), UNE A LA FOIS (un seul navigateur sur la machine), et exige que chacune rougisse
// sa lettre. Le disque n est jamais touche. `--seul=B` ne joue qu une lettre.
// Lancement : node scripts/formule-groupes-check.js [--contre-preuves] [--seul=A]
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
const PORT = Number(process.env.PINLANE_FORMULE_GROUPES_PORT || 7771);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const SEUL = typeof argument('seul') === 'string' ? argument('seul') : '';
const joue = (lettre) => !SEUL || SEUL === lettre;
const lf = (t) => String(t).split('\r\n').join('\n');

const APP = 'assets/app-main.js';

// LES MUTATIONS : une regle retiree a la fois. `lettre` : le scenario qui doit rougir.
const MUTATIONS = [
  // [A] la formule sans groupes (la panne du gerant) ; la formule qui part en programme des qu elle a des groupes ; ses
  // groupes sans heures posees (le serveur garde alors le plan de la carte) ; le ticket sans la ligne des groupes, ou sans
  // l option.
  { nom: 'formule-sans-groupes', lettre: 'A', fichier: APP, de: "  if (!s || s !== quickBookState || s.type === 'activity' || rsFmActive(s)) return null;", vers: "  if (!s || s !== quickBookState || s.type === 'formule' || s.type === 'activity' || rsFmActive(s)) return null;" },
  { nom: 'formule-en-programme', lettre: 'A', fichier: APP, de: "  const programme = s.type === 'visite' || adaptee || rsFmActive(s) || (s.type !== 'formule' && Boolean(rvGrandGroupe()));", vers: "  const programme = s.type === 'visite' || adaptee || rsFmActive(s) || Boolean(rvGrandGroupe());" },
  { nom: 'groupes-hors-de-la-demande', lettre: 'A', fichier: APP, de: '  if (grand && (programme || demande.impose)) {', vers: '  if (grand && programme) {' },
  { nom: 'formule-sans-heure-posee', lettre: 'A', fichier: APP, de: '    if (demande.impose && !grand.laserSeul) {', vers: '    if (programme && demande.impose && !grand.laserSeul) {' },
  { nom: 'ticket-sans-les-groupes', lettre: 'A', fichier: APP, de: '    if (!s.adaptee) return `${lignes.join(\'\')}${rsLigneGrandGroupeHtml()}${rsOptionDesGroupesHtml()}${rsLignesEnPlus()}`;', vers: '    if (!s.adaptee) return `${lignes.join(\'\')}${rsOptionDesGroupesHtml()}${rsLignesEnPlus()}`;' },
  { nom: 'ticket-sans-l-option', lettre: 'A', fichier: APP, de: '    if (!s.adaptee) return `${lignes.join(\'\')}${rsLigneGrandGroupeHtml()}${rsOptionDesGroupesHtml()}${rsLignesEnPlus()}`;', vers: '    if (!s.adaptee) return `${lignes.join(\'\')}${rsLigneGrandGroupeHtml()}${rsLignesEnPlus()}`;' },
  // [B] la formule ne part qu avec « des groupes », sans leur nombre, leurs joueurs ni leurs heures.
  { nom: 'formule-sans-ses-reglages', lettre: 'B', fichier: APP, de: '    preference.grandGroupe = demande;', vers: '    preference.grandGroupe = programme ? demande : { impose: true };' },
  // [C] la variante qui remplace le laser oubliee. (Le Kids Fun Day n a aucune activite a reserver : sa composition est
  // vide, il n a jamais de groupes ; la regle qui ecarte un acces illimite de rvGrandGroupe est un second verrou, qu aucune
  // formule du centre ne peut faire rougir aujourd hui.)
  { nom: 'variante-sans-son-remplacement', lettre: 'C', fichier: APP, de: '  const toutes = rvActivites().filter((id) => !remplacees.includes(id));', vers: '  const toutes = rvActivites();' },
];

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : un fil par mutation, l un apres l autre (un seul navigateur a la fois sur la machine).
// ---------------------------------------------------------------------------
function lancer(args, port) {
  return new Promise((ok) => {
    const fil = spawn(process.execPath, [__filename, ...args], { cwd: ROOT, env: { ...process.env, PINLANE_FORMULE_GROUPES_PORT: String(port) } });
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
      console.log('\nformule-groupes-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
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
      ? `\nformule-groupes-check --contre-preuves: ${rates} mutation(s) vivante(s)`
      : `\nformule-groupes-check --contre-preuves: ALL OK - ${file.length} mutations, chaque regle retiree fait rougir sa lettre`);
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
    if (!mutation || mutation.fichier !== rel) return texte;
    const t = lf(texte);
    if (t.split(mutation.de).length !== 2) { console.log(`ANCRE DE MUTATION absente ou multiple (${mutation.nom}) dans ${rel}`); process.exit(2); }
    return t.split(mutation.de).join(mutation.vers);
  };
  if (mutation) transformer(mutation.fichier, fs.readFileSync(path.join(ROOT, mutation.fichier), 'utf8'));

  const B = require('./reserver-banc.js');
  const FX = require('./planning-v3-fixtures.js');
  const HORLOGE_SERVEUR = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };
  const serveur = B.monter({ mutations: [HORLOGE_SERVEUR], session: B.sessionDuRole('direction', { nom: 'Accueil' }) });
  FX.APPAREILS.comptoir = FX.APPAREILS.comptoir || { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };

  let rouges = 0;
  let lettre = '';
  const section = (titre) => { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); };
  const ok = (condition, quoi, detail) => {
    if (condition) { console.log(`ok    ${quoi}`); return; }
    rouges += 1;
    console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 900)}` : ''}`);
  };

  // UN MARDI CALME A LIBRAMONT (la fixture « calme », 15:10) ; Reserver pour le lendemain, un mercredi.
  const FIXTURE = 'calme';
  const HEURE = '15:10';
  const AUJOURD_HUI = FX.lireFixture(FIXTURE).staffState.date;
  const DEMAIN = (() => { const d = new Date(`${AUJOURD_HUI}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  // « G1:bowling@15:00x30 » : le groupe 1 joue au bowling a 15:00, a 30 (G0 : sans groupe).
  const passages = (r) => ((r && r.ops_plan && r.ops_plan.resourceBlocks) || [])
    .filter((b) => b.resourceType === 'laser_arena' || b.resourceType === 'bowling_lane')
    .map((b) => `G${Number(b.sousGroupe) || 0}:${b.resourceType === 'laser_arena' ? 'laser' : 'bowling'}@${String(b.startTime).slice(0, 5)}x${Number(b.joueursReels || b.players) || 0}`)
    .filter((x, i, l) => l.indexOf(x) === i).sort().join(' ');
  const programmeDe = (r) => (r && r.program ? (Array.isArray(r.program) ? r.program : r.program.items || []) : []);

  let browser = null;
  async function ouvrir() {
    globalThis.__comptoirMaintenant = FX.instant(AUJOURD_HUI, HEURE).getTime();
    const m = await FX.monter(browser, {
      fixture: FIXTURE, appareil: 'comptoir', theme: 'light', port: PORT, heure: HEURE,
      avantChargement: async (page) => {
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
        if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
          const corps = init.body ? JSON.parse(init.body) : undefined;
          const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
          const j = rep.json || {};
          if (me === 'POST' && !(corps && corps.dryRun) && j.reservation) {
            const jour = j.reservation.date;
            (window.__FIXTURE__.jours[jour] = window.__FIXTURE__.jours[jour] || []).push(j.reservation);
          }
          return new Response(JSON.stringify(j), { status: rep.statut, headers: { 'content-type': 'application/json; charset=utf-8' } });
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
  // Reserver, demain, le nombre tape dans « Autre », la formule prise dans « Formules », a son heure.
  async function formuleDemain(page, { formule = 'f4', joueurs = 60, heure = '15:00' } = {}) {
    await page.locator('.btn-new').first().click();
    await page.waitForSelector('#qbPax');
    await page.locator('.qb-modal.rv button', { hasText: /^Demain$/ }).first().click();
    await page.waitForFunction((j) => quickBookState && quickBookState.date === j, DEMAIN);
    await page.locator('#qbPax').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(joueurs));
    await page.keyboard.press('Tab');
    await page.waitForFunction((n) => quickBookState && Number(quickBookState.pax) === n, joueurs);
    await page.locator('#rsFormules').click();
    await page.locator(`#rsF-${formule}`).click();
    await page.waitForFunction((f) => quickBookState && quickBookState.type === 'formule' && quickBookState.formuleId === f, formule);
    if (heure) {
      // (une heure hors de la grille du jour est derriere « Autres »)
      const grille = await page.waitForSelector(`.rs-seance [data-heure="${heure}"]`, { state: 'attached', timeout: 4000 }).then(() => true, () => false);
      if (!grille) await page.locator('.rs-h-autres').first().click();
      await page.waitForSelector(`[data-heure="${heure}"]`, { state: 'attached' });
      await page.locator(`[data-heure="${heure}"]`).first().dispatchEvent('click');
      await page.waitForFunction((h) => quickBookState && quickBookState.startTime === h, heure);
    }
    await pret(page).catch(() => {});
    // (le plan d a cote, celui que l option propose, se calcule a blanc apres le plan courant)
    await page.waitForFunction(() => !quickBookState.autrePlanGroupes || quickBookState.autrePlanGroupes.etat !== 'calcul', null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  // Ce que la fenetre enverrait au serveur pour juger ce plan (le corps de la simulation).
  const demandeEnvoyee = (page) => page.evaluate(() => { const c = rvCorpsDeSimulation(); return c ? (c.reservation || c).preference || null : null; });
  // La page des groupes : une rangee par groupe (ce qu elle dit), ses cases (cle@heure, rouge ou non), sa phrase rouge.
  const pageDesGroupes = (page) => page.evaluate(() => ({
    titre: ((document.querySelector('#rsQ') || {}).textContent || '').trim(),
    phrase: ((document.querySelector('#rsGgPhrase') || {}).textContent || '').trim(),
    rangees: Array.from(document.querySelectorAll('#rsGgListe .rs-gg-l')).map((l) => l.getAttribute('aria-label')),
    cases: Array.from(document.querySelectorAll('#rsGgListe .rs-gg-c')).map((c) => `${c.dataset.groupe}:${c.dataset.activite}@${c.dataset.heureGroupe}${c.classList.contains('is-ko') ? '!' : ''}`),
    rouges: Array.from(document.querySelectorAll('#rsGgListe .rs-gg-ko')).map((k) => k.textContent.trim()),
    total: ((document.querySelector('#rsGgTotal') || {}).textContent || '').trim(),
  }));
  async function taperHeure(page, groupe, cle, frappe) {
    await page.locator(`.rs-gg-h[data-saisie="t:${groupe}-${cle}"]`).click();
    await page.waitForSelector('#rsSaisie');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(frappe);
    await page.keyboard.press('Enter');
  }

  const { chromium } = require('playwright-core');
  browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const http = await FX.servir({ port: PORT, transformer });
  try {
    // =======================================================================
    if (joue('A')) {
      section('[A] LA FORMULE 4 A 60 JOUEURS, DEMAIN A 15:00 : LE PLAN DE SA CARTE RESTE, FAIRE TOURNER SES GROUPES EST AU CHOIX');
      B.semer([]);
      const { ctx, page, erreurs, avant } = await ouvrir();
      try {
        await formuleDemain(page);
        const etat = await page.evaluate(() => ({ date: quickBookState.date, pax: quickBookState.pax, type: quickBookState.type, formule: quickBookState.formuleId, heure: quickBookState.startTime }));
        ok(etat.date === DEMAIN && etat.pax === 60 && etat.formule === 'f4' && etat.heure === '15:00', 'MONTAGE Reserver, demain, la Formule 4 pour 60 joueurs a 15:00', etat);
        // Rien ne bascule seul : le plan de la carte, et l option qui dit ce qu elle change.
        const formule = await texte(page, '#rsL-a-formule');
        const groupesAvant = await texte(page, '#rsL-groupes');
        const option = await texte(page, '#rsGgOption');
        const demandeAvant = await demandeEnvoyee(page);
        ok(/15:00 à 19:55/.test(formule) && /2 340 €/.test(formule) && !groupesAvant && !(demandeAvant && demandeAvant.grandGroupe),
          '[A] le plan de la carte reste : 15:00 a 19:55, 2 340 €, aucun groupe impose', { formule, groupesAvant, demandeAvant });
        ok(option === 'Faire tourner 2 groupes : fin à 17:45, 2 340 €', '[A] le ticket propose « Faire tourner 2 groupes : fin à 17:45, 2 340 € »', option);
        // Touche : les deux groupes, qui joue quoi et quand.
        await page.locator('#rsGgOption').click();
        await page.waitForFunction(() => /2 groupes qui tournent/.test((document.querySelector('#rsL-groupes') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
        await pret(page).catch(() => {});
        await page.waitForFunction(() => !quickBookState.autrePlanGroupes || quickBookState.autrePlanGroupes.etat !== 'calcul', null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(400);
        const ticket = await texte(page, '#rsL-groupes');
        const formuleApres = await texte(page, '#rsL-a-formule');
        const inverse = await texte(page, '#rsGgOption');
        ok(/2 groupes qui tournent/.test(ticket) && /30 et 30 joueurs/.test(ticket) && /Groupe 1 · 30 · Bowling 15:00 → Laser 16:00/.test(ticket) && /Groupe 2 · 30 · Laser 15:00 → Bowling 16:00/.test(ticket),
          '[A] touche : le ticket dit 2 groupes de 30 qui tournent, le groupe 1 au bowling a 15:00 puis au laser a 16:00, le groupe 2 a l inverse', ticket);
        ok(/15:00 à 17:45/.test(formuleApres) && /2 340 €/.test(formuleApres) && inverse === 'Ne pas faire tourner : fin à 19:55, 2 340 €',
          '[A] la formule finit a 17:45, au meme prix, et le ticket propose de revenir au plan de la carte', { formuleApres, inverse });
        const r = await creer(page, avant);
        const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
        const etapes = ((r && r.ops_plan && r.ops_plan.timeline) || []).filter((e) => e.type === 'activity').map((e) => `${e.activityId}@${e.startTime}`);
        ok(r && r.date === DEMAIN && r.type === 'formule' && r.formule_id === 'f4' && r.label === 'FORMULE 4' && Number(r.pax) === 60 && Number(r.price) === 2340 && !programmeDe(r).length
          && gg && gg.tourne === true && Number(gg.nombre) === 2 && JSON.stringify(gg.tailles) === '[30,30]'
          && passages(r) === 'G1:bowling@15:00x30 G1:laser@16:00x30 G1:laser@16:30x30 G2:bowling@16:00x30 G2:laser@15:00x30 G2:laser@15:30x30'
          && etapes.some((e) => e.startsWith('minigolf_blacklight@')),
        '[A] le dossier nait une FORMULE 4 a 2 340 €, sans programme, en deux groupes de 30 qui tournent, minigolf compris', r && { type: r.type, formule: r.formule_id, label: r.label, prix: r.price, programme: programmeDe(r), gg, passages: passages(r), etapes });
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (A)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('B')) {
      section('[B] LA PAGE DES GROUPES DE LA FORMULE : COMBIEN, QUI, QUAND, ET TOUT SE CHANGE');
      B.semer([]);
      const { ctx, page, erreurs, avant } = await ouvrir();
      try {
        await formuleDemain(page);
        await page.locator('#rsGgOption').click();
        await page.waitForFunction(() => /2 groupes qui tournent/.test((document.querySelector('#rsL-groupes') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
        await page.locator('#rsL-groupes').click();
        await page.waitForSelector('#rsGgListe', { timeout: 15000 }).catch(() => {});
        // (le plan des groupes qui tournent arrive du serveur : leurs heures avec lui)
        await page.waitForFunction(() => { const l = Array.from(document.querySelectorAll('#rsGgListe .rs-gg-l')); return l.length && l.every((x) => !/sans heure/.test(x.getAttribute('aria-label'))); }, null, { timeout: 15000 }).catch(() => {});
        let p = await pageDesGroupes(page);
        ok(p.titre === '60 joueurs en 2 groupes'
          && JSON.stringify(p.rangees) === JSON.stringify(['Groupe 1 · 30 joueurs · Bowling 15:00 → Laser 16:00', 'Groupe 2 · 30 joueurs · Laser 15:00 → Bowling 16:00'])
          && p.cases.join(' ') === '1:bowling@15:00 1:laser_game@16:00 2:laser_game@15:00 2:bowling@16:00' && p.total === '60 joueurs sur 60',
        '[B] la page : 60 joueurs en 2 groupes, une rangee par groupe, ses cases dans l ordre de ses heures', p);
        // Un groupe de plus : 20, 20 et 20, que le serveur pose.
        await page.locator('.rs-gg-n button[aria-label="Nombre de groupes, un de plus"]').click();
        await page.waitForFunction(() => document.querySelectorAll('#rsGgListe .rs-gg-l').length === 3 && /Groupe 3 · 20 joueurs · \S+ \d\d:\d\d → \S+ \d\d:\d\d/.test(Array.from(document.querySelectorAll('#rsGgListe .rs-gg-l')).map((l) => l.getAttribute('aria-label')).join('|')), null, { timeout: 15000 }).catch(() => {});
        await pret(page).catch(() => {});
        p = await pageDesGroupes(page);
        ok(p.titre === '60 joueurs en 3 groupes' && p.rangees.length === 3 && p.rangees.every((l) => /^Groupe \d · 20 joueurs · (Bowling|Laser) \d\d:\d\d → (Bowling|Laser) \d\d:\d\d$/.test(l)) && !p.rouges.length && p.total === '60 joueurs sur 60',
          '[B] un groupe de plus : 3 groupes de 20, chacun son heure au bowling et au laser, rien de rouge', p);
        // Le laser du groupe 3 a l heure du laser d un autre groupe : 20 + 20 joueurs sur 30 armes.
        const laserAutre = (p.cases.find((c) => /^[12]:laser_game@/.test(c)) || '').split('@')[1] || '';
        const avantRefus = B.base.reservations.size;
        await taperHeure(page, 3, 'laser_game', laserAutre);
        await page.waitForSelector('#rsGgListe .rs-gg-c.is-ko', { timeout: 15000 }).catch(() => {});
        p = await pageDesGroupes(page);
        const creerRefus = await page.evaluate(() => ({ pret: document.querySelector('#rvCreer').dataset.pret, dit: document.querySelector('#rvCreer').textContent.trim() }));
        ok(laserAutre && p.cases.filter((c) => c.endsWith('!')).join(' ') === `3:laser_game@${laserAutre}!` && p.rouges.length === 1 && /laser/i.test(p.rouges[0]) && /30/.test(p.rouges[0]),
          `[B] le laser du groupe 3 a ${laserAutre || '?'} (un autre groupe y joue) : sa case seule est rouge, la phrase dit ce qui manque`, { laserAutre, ...p });
        ok(creerRefus.pret === '0' && B.base.reservations.size === avantRefus, '[B] rien ne part tant que ca ne tient pas', creerRefus);
        // Corrigee : le laser du groupe 3 a 18:00, apres les deux autres.
        await taperHeure(page, 3, 'laser_game', '18:00');
        await page.waitForFunction(() => !document.querySelector('#rsGgListe .rs-gg-c.is-ko'), null, { timeout: 15000 }).catch(() => {});
        await pret(page).catch(() => {});
        p = await pageDesGroupes(page);
        ok(p.cases.includes('3:laser_game@18:00') && !p.rouges.length && /celles que vous avez posées/.test(p.phrase),
          '[B] corrige a 18:00 : plus rien de rouge, les heures sont celles posees', p);
        const heuresPosees = await page.evaluate(() => (rvDemandeGrandGroupe() || {}).heures || null);
        const prix = await page.evaluate(() => (rvPlanCourant() || {}).prix);
        const r = await creer(page, avant);
        const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
        ok(r && r.type === 'formule' && r.formule_id === 'f4' && !programmeDe(r).length && Number(r.price) === Number(prix) && Number(prix) === 2340
          && gg && Number(gg.nombre) === 3 && JSON.stringify(gg.tailles) === '[20,20,20]' && JSON.stringify(gg.heures) === JSON.stringify(heuresPosees)
          && passages(r).split(' ').includes('G3:laser@18:00x20'),
        '[B] le dossier nait une FORMULE 4 en 3 groupes de 20, a ces heures-la, au prix annonce', r && { prix: [r.price, prix], gg, heuresPosees, passages: passages(r) });
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (B)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('C')) {
      section('[C] RIEN A REGLER : LE KIDS FUN DAY, ET LA FORMULE 4 AVEC SES ARCADES A LA PLACE DU LASER');
      B.semer([]);
      const { ctx, page, erreurs } = await ouvrir();
      try {
        const sansGroupes = async () => {
          const demande = await demandeEnvoyee(page);
          return {
            grand: await page.evaluate(() => rvGrandGroupe()),
            ligne: await texte(page, '#rsL-groupes'),
            option: await texte(page, '#rsGgOption'),
            demande,
          };
        };
        await formuleDemain(page, { formule: 'kfd', heure: '' });
        const kfd = await sansGroupes();
        const kfdEtat = await page.evaluate(() => ({ type: quickBookState.type, formule: quickBookState.formuleId, pax: quickBookState.pax, activites: rvActivites() }));
        ok(kfdEtat.type === 'formule' && kfdEtat.formule === 'kfd' && kfdEtat.pax === 60, 'MONTAGE Reserver, demain (un mercredi), le Kids Fun Day pour 60 joueurs', kfdEtat);
        ok(kfd.grand === null && !kfd.ligne && !kfd.option && !(kfd.demande && (kfd.demande.grandGroupe || kfd.demande.preferredTimes)),
          '[C] le Kids Fun Day (tout en illimite, rien a reserver) ne propose aucun groupe, et sa demande n en porte pas', kfd);
        // La Formule 4 avec 60 min d arcades a la place du laser.
        if (!(await page.locator('#rsF-f4').count())) await page.locator('#rsFormules, #rsChanger').first().click();
        await page.locator('#rsF-f4').click();
        await page.waitForFunction(() => quickBookState.formuleId === 'f4');
        await page.locator('.rs-seance [data-heure="15:00"]').first().click();
        await page.waitForFunction(() => quickBookState.startTime === '15:00');
        await page.locator('#rsL-a-formule').click();
        await page.locator('[data-choix="arcade60"]').first().click();
        await page.waitForFunction(() => quickBookState.formuleChoix === 'arcade60');
        await pret(page).catch(() => {});
        await page.waitForTimeout(600);
        const arcades = await sansGroupes();
        ok(arcades.grand === null && !arcades.ligne && !arcades.option && !(arcades.demande && arcades.demande.grandGroupe) && arcades.demande && arcades.demande.formulaChoice === 'arcade60',
          '[C] la Formule 4 avec ses arcades a la place du laser : aucun groupe a regler, la demande porte le choix des arcades', arcades);
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (C)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }
  } catch (error) {
    ok(false, `exception : ${error.message}`, String(error.stack || '').split('\n').slice(0, 4).join(' | '));
  } finally {
    if (browser) await browser.close();
    if (http) http.close();
  }

  console.log(rouges
    ? `\nformule-groupes-check: ${rouges} ROUGE(S)`
    : '\nformule-groupes-check: ALL OK - une formule a 60 joueurs montre et regle ses groupes au comptoir, et le Kids Fun Day n en propose jamais');
  process.exit(rouges ? 1 : 0);
}
